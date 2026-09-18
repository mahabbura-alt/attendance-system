// ============================================================
// PORTAL MOBILE ABSENSI KARYAWAN — PT PRIMA INDOJAYA MANDIRI
// ============================================================

const API_BASE = window.location.origin;
const ATTENDANCE_TIME_ZONE = 'Asia/Jakarta';

function formatAttendanceTime(value) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return '—';
  return `${instant.toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', timeZone: ATTENDANCE_TIME_ZONE
  })} WIB`;
}

function formatAttendanceWorkDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

let userToken = localStorage.getItem('token_karyawan');
let currentUser = null;
let currentCoords = { lat: null, lng: null };
let currentAccuracy = null; // radius akurasi GPS dalam meter (pos.coords.accuracy)
let isLocationValid = false;
let currentAbsenType = 'datang'; // 'datang' | 'pulang'
let videoStream = null;
let capturedBlob = null;
let attendanceSubmitInProgress = false;

function isPendingAttendanceSession(row) {
  if (typeof row?.is_pending_session === 'boolean') return row.is_pending_session;
  return Boolean(row?.waktu_datang && !row?.waktu_pulang);
}

function isCompletedAttendanceSession(row) {
  return Boolean(row?.waktu_datang && row?.waktu_pulang);
}

// Handle expiry on every authenticated request, including after a long shift.
async function portalFetch(url, options = {}) {
  const requestOptions = { ...options };
  const timeoutMs = Number(requestOptions.timeoutMs || 15000);
  delete requestOptions.timeoutMs;
  const sentToken = new Headers(requestOptions.headers || {}).get('Authorization');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  requestOptions.signal = controller.signal;
  let response;
  try {
    response = await fetch(url, requestOptions);
  } catch (cause) {
    const timedOut = cause?.name === 'AbortError' || controller.signal.aborted;
    const error = new Error(timedOut
      ? 'Koneksi ke server melewati batas waktu. Status absensi akan diperiksa ulang.'
      : 'Koneksi ke server terputus. Status absensi akan diperiksa ulang.');
    error.code = timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 && sentToken && sentToken === `Bearer ${userToken}`) {
    logout();
    const notice = document.getElementById('loginAlert');
    if (notice) {
      notice.textContent = 'Sesi login berakhir. Silakan masuk kembali untuk melanjutkan absensi.';
      notice.style.display = 'block';
    }
    throw new Error('Sesi login berakhir. Silakan masuk kembali.');
  }
  return response;
}

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  if (userToken) {
    initPortal();
  } else {
    showView('viewLogin');
  }

  document.getElementById('formLogin').addEventListener('submit', handleLogin);
  document.getElementById('formDaftar')?.addEventListener('submit', handleDaftar);
  document.getElementById('formMintaOtp')?.addEventListener('submit', handleMintaOtpReset);
  document.getElementById('formResetPass')?.addEventListener('submit', handleResetSandi);
});

// -------------------------------------------------------------
// JAM DIGITAL
// -------------------------------------------------------------
function startClock() {
  function update() {
    const now = new Date();
    const clockEl = document.getElementById('digitalClock');
    const dateEl = document.getElementById('digitalDate');
    if (clockEl) {
      clockEl.textContent = `${now.toLocaleTimeString('id-ID', { hour12: false, timeZone: ATTENDANCE_TIME_ZONE })} WIB`;
    }
    if (dateEl) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: ATTENDANCE_TIME_ZONE };
      dateEl.textContent = now.toLocaleDateString('id-ID', options);
    }
  }
  update();
  setInterval(update, 1000);
}

// -------------------------------------------------------------
// VIEW & TAB SWITCHING
// -------------------------------------------------------------
function showView(viewId) {
  const loginView = document.getElementById('viewLogin');
  const daftarView = document.getElementById('viewDaftar');
  const lupaView = document.getElementById('viewLupaSandi');
  const mainView = document.getElementById('viewMain');

  if (loginView) loginView.style.display = viewId === 'viewLogin' ? 'flex' : 'none';
  if (daftarView) daftarView.style.display = viewId === 'viewDaftar' ? 'block' : 'none';
  if (lupaView) lupaView.style.display = viewId === 'viewLupaSandi' ? 'block' : 'none';
  if (mainView) mainView.style.display = viewId === 'viewMain' ? 'block' : 'none';

  if (viewId === 'viewDaftar') {
    muatOpsiPendaftaranDaftar();
  }
  if (viewId === 'viewLupaSandi') {
    document.getElementById('formMintaOtp')?.reset();
    document.getElementById('formResetPass').style.display = 'none';
    document.getElementById('formMintaOtp').style.display = 'flex';
    document.getElementById('lupaAlert').style.display = 'none';
    document.getElementById('lupaSuccessAlert').style.display = 'none';
  }
}

function switchTab(tabId, el) {
  document.querySelectorAll('.tab-page').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(tabId).classList.add('active');
  if (el) el.classList.add('active');

  if (tabId === 'tabRiwayat') muatRiwayat();
}

// -------------------------------------------------------------
// AUTH & LOGIN
// -------------------------------------------------------------
async function handleLogin(e) {
  e.preventDefault();
  const alertEl = document.getElementById('loginAlert');
  const btn = document.getElementById('btnSubmitLogin');
  alertEl.style.display = 'none';

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  btn.disabled = true;
  btn.textContent = 'MEMPROSES...';

  try {
    const res = await portalFetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error('Email atau password salah / Periksa format email');
    }
    if (!res.ok) throw new Error(data?.error || 'Login gagal');

    userToken = data.token;
    localStorage.setItem('token_karyawan', userToken);
    initPortal();
  } catch (err) {
    alertEl.textContent = err.message;
    alertEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'MASUK PORTAL';
  }
}

function logout() {
  localStorage.removeItem('token_karyawan');
  userToken = null;
  currentUser = null;
  closeCameraModal();
  isLocationValid = false;
  currentCoords = { lat: null, lng: null };
  showView('viewLogin');
}

// -------------------------------------------------------------
// INISIALISASI PORTAL & GEOLOCATION
// -------------------------------------------------------------
async function initPortal() {
  showView('viewMain');
  await muatProfil();
  if (!userToken) return;
  refreshLocation();
  await cekStatusToday();
}

async function muatProfil() {
  try {
    const res = await portalFetch(`${API_BASE}/api/absensi/lokasi-kantor`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    if (res.status === 401) {
      logout();
      return;
    }
    if (!res.ok) throw new Error('Sesi berakhir');
    const data = await res.json();

    document.getElementById('userName').textContent = data.user?.nama || 'Karyawan';
    document.getElementById('userSub').textContent = `${data.user?.jabatan || 'Staff'} • ${data.user?.departemen || 'Operational'}`;
    document.getElementById('userInitial').textContent = (data.user?.nama || 'K')[0].toUpperCase();
  } catch (err) {
    console.warn('Profil load notice:', err.message);
  }
}

async function muatOpsiShift() {
  try {
    const res = await portalFetch(`${API_BASE}/api/auth/opsi-pendaftaran`);
    const data = await res.json();
    const select = document.getElementById('selectShift');
    select.innerHTML = data.shifts.map(s => `
      <option value="${s.id}">${s.nama_shift} (${s.jam_masuk_maks.substring(0,5)} - ${s.jam_pulang_min.substring(0,5)})</option>
    `).join('');
  } catch (e) {
    console.warn('Gagal muat shift:', e);
  }
}

function refreshLocation() {
  const badge = document.getElementById('geofenceBadge');
  const text = document.getElementById('geofenceText');
  if (!badge || !text) return;

  badge.className = 'geofence-badge invalid';
  text.textContent = 'Mencari GPS...';

  if (!navigator.geolocation) {
    badge.className = 'geofence-badge invalid';
    text.textContent = 'GPS Tidak Didukung';
    return;
  }

  let locationResolved = false;

  const handleSuccess = async (pos) => {
    if (locationResolved) return;
    locationResolved = true;
    currentCoords.lat = pos.coords.latitude;
    currentCoords.lng = pos.coords.longitude;
    currentAccuracy = (typeof pos.coords.accuracy === 'number' && isFinite(pos.coords.accuracy))
      ? pos.coords.accuracy
      : null;

    try {
      const res = await portalFetch(`${API_BASE}/api/absensi/check-lokasi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`
        },
        body: JSON.stringify({
          latitude: currentCoords.lat,
          longitude: currentCoords.lng,
          accuracy: currentAccuracy
        })
      });
      const data = await res.json();
      isLocationValid = res.ok && data.valid === true;

      if (isLocationValid) {
        badge.className = 'geofence-badge valid';
        text.textContent = `🟢 Lokasi sah: ${data.namaLokasi || 'Area resmi'}`;
      } else {
        // Lokasi di luar radius: tampilkan pesan jelas, jangan diam-diam ganti koordinat.
        const jarak = data.jarakMeter || data.jarak_meter || 0;
        badge.className = 'geofence-badge invalid';
        if (data.message || data.error) {
          text.textContent = data.message || data.error;
          return;
        }
        text.textContent = `🔴 Di luar radius (${Math.round(jarak)}m)`;
      }
    } catch (err) {
      badge.className = 'geofence-badge invalid';
      text.textContent = 'Gagal cek lokasi. Ketuk untuk coba lagi.';
    }
  };

  const handleError = async (err) => {
    if (locationResolved) return;
    locationResolved = true;
    // Jangan ganti koordinat dengan titik kantor. Beri tahu user GPS gagal.
    badge.className = 'geofence-badge invalid';
    text.textContent = 'GPS tidak tersedia. Ketuk untuk coba lagi.';
  };

  navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
    enableHighAccuracy: true,
    timeout: 8000,
    maximumAge: 0
  });

  // Safety fallback jika browser tidak pernah merespons callback GPS
  setTimeout(() => {
    if (!locationResolved) {
      handleError(new Error('GPS Timeout'));
    }
  }, 5500);
}

// -------------------------------------------------------------
// STATUS HARI INI & LOGIK ABSEN
// -------------------------------------------------------------
async function cekStatusToday() {
  try {
    const res = await portalFetch(`${API_BASE}/api/absensi/riwayat?limit=10`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const rows = await res.json();
    if (!Array.isArray(rows)) return;

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

    const btnDatang = document.getElementById('btnTriggerDatang');
    const btnPulang = document.getElementById('btnTriggerPulang');
    const valDatang = document.getElementById('valJamDatang');
    const subDatang = document.getElementById('subDatang');
    const valPulang = document.getElementById('valJamPulang');
    const subPulang = document.getElementById('subPulang');

    // 1. Cari jika ada sesi absen yang belum checkout (waktu_pulang IS NULL)
    // Baris keterangan_presensi (cuti/izin/sakit/alpa) juga muncul di endpoint
    // riwayat, tetapi bukan sesi kamera. Sesi pending wajib memiliki clock-in.
    const pendingRec = rows.find(isPendingAttendanceSession);

    if (pendingRec) {
      // Ada sesi aktif yang belum checkout -> Karyawan harus Absen Pulang
      if (valDatang) valDatang.textContent = formatAttendanceTime(pendingRec.waktu_datang);
      if (subDatang) {
        subDatang.textContent = pendingRec.status_datang || 'Hadir';
        subDatang.style.color = 'var(--emerald-dark)';
      }

      if (btnDatang) {
        btnDatang.classList.add('btn-disabled');
        btnDatang.disabled = true;
        btnDatang.textContent = '✅ SUDAH ABSEN DATANG';
      }

      if (btnPulang) {
        btnPulang.classList.remove('btn-disabled');
        btnPulang.disabled = false;
        btnPulang.textContent = '🔴 ABSEN PULANG';
      }
      return;
    }

    // 2. Jika tidak ada sesi pending, cek apakah ada sesi hari ini yang sudah checkout
    const todayCompleted = rows.find(r => r.tanggal_kerja?.substring(0, 10) === todayStr && isCompletedAttendanceSession(r));

    if (todayCompleted) {
      // Sesi hari ini sudah selesai checkout
      if (valDatang) valDatang.textContent = formatAttendanceTime(todayCompleted.waktu_datang);
      if (subDatang) {
        subDatang.textContent = todayCompleted.status_datang || 'Hadir';
        subDatang.style.color = 'var(--emerald-dark)';
      }

      if (valPulang) valPulang.textContent = formatAttendanceTime(todayCompleted.waktu_pulang);
      if (subPulang) {
        subPulang.textContent = todayCompleted.status_pulang || 'Checkout';
        subPulang.style.color = 'var(--emerald-dark)';
      }

      if (btnDatang) {
        // Sesi selesai tidak boleh memblokir sesi berikutnya; server memvalidasi jam.
        btnDatang.classList.remove('btn-disabled');
        btnDatang.disabled = false;
        btnDatang.textContent = '🟢 ABSEN DATANG';
      }

      if (btnPulang) {
        btnPulang.classList.add('btn-disabled');
        btnPulang.disabled = true;
        btnPulang.textContent = '✅ SUDAH CHECKOUT';
      }
    } else {
      // Belum ada absen sama sekali
      if (btnDatang) {
        btnDatang.classList.remove('btn-disabled');
        btnDatang.disabled = false;
        btnDatang.textContent = '🟢 ABSEN DATANG';
      }

      if (btnPulang) {
        btnPulang.classList.add('btn-disabled');
        btnPulang.disabled = true;
        btnPulang.textContent = '🔴 ABSEN PULANG';
      }
    }
  } catch (e) {
    console.warn('Gagal cek status today:', e);
  }
}

// -------------------------------------------------------------
// KAMERA & PRESENSI SUBMIT
// -------------------------------------------------------------
function fitImageDimensions(width, height, maxDimension = 960) {
  const safeWidth = Number(width) || 1;
  const safeHeight = Number(height) || 1;
  const scale = Math.min(1, maxDimension / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

async function compressImageBlob(blob, { maxDimension = 960, quality = 0.75 } = {}) {
  if (!blob || blob.size <= 600 * 1024) return blob;

  let source;
  let releaseSource = () => {};
  if (typeof createImageBitmap === 'function') {
    source = await createImageBitmap(blob);
    releaseSource = () => source.close?.();
  } else {
    source = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(blob);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Foto tidak dapat diproses. Ambil foto ulang.'));
      };
      image.src = url;
    });
  }

  try {
    const originalWidth = source.width || source.naturalWidth;
    const originalHeight = source.height || source.naturalHeight;
    const dimensions = fitImageDimensions(originalWidth, originalHeight, maxDimension);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    canvas.getContext('2d').drawImage(source, 0, 0, dimensions.width, dimensions.height);
    const compressed = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error('Kompresi foto gagal. Ambil foto ulang.')),
        'image/jpeg',
        quality,
      );
    });
    return compressed.size < blob.size ? compressed : blob;
  } finally {
    releaseSource();
  }
}

async function openCameraModal(type) {
  // Validasi lokasi dilakukan saat submit dengan fix GPS segar (getFreshLocation),
  // bukan dengan koordinat kantor pengganti. Buka kamera langsung.
  currentAbsenType = type;
  document.getElementById('modalCameraTitle').textContent = type === 'datang' ? '📸 Absen Datang (Selfie)' : '📸 Absen Pulang (Selfie)';
  document.getElementById('modalCamera').style.display = 'flex';

  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('capturedCanvas');
  canvas.style.display = 'none';
  video.style.display = 'block';

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = videoStream;
  } catch (err) {
    console.warn('Kamera langsung tidak didukung, menggunakan file fallback:', err.message);
    document.getElementById('fallbackFileInput').click();
  }
}

function closeCameraModal() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  document.getElementById('modalCamera').style.display = 'none';
}

async function onFileFallbackSelected(e) {
  const file = e.target.files[0];
  if (file) {
    try {
      capturedBlob = await compressImageBlob(file);
      await submitAbsenForm();
    } catch (error) {
      alert('❌ ' + error.message);
    }
  }
}

function takeSnapshotAndSubmit() {
  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('capturedCanvas');
  const context = canvas.getContext('2d');

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    capturedBlob = blob;
    submitAbsenForm();
  }, 'image/jpeg', 0.75);
}

// Ambil fix GPS segar (presisi tinggi, tanpa cache) untuk dipakai saat submit.
// Mengembalikan Promise { lat, lng, accuracy } atau menolak dengan pesan jelas.
function getFreshLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Perangkat tidak mendukung GPS. Aktifkan lokasi & izinkan akses lokasi.'));
      return;
    }
    let resolved = false;
    const finish = (fn, arg) => {
      if (resolved) return;
      resolved = true;
      fn(arg);
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => finish(resolve, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: (typeof pos.coords.accuracy === 'number' && isFinite(pos.coords.accuracy))
          ? pos.coords.accuracy
          : null
      }),
      (err) => finish(reject, new Error('Gagal membaca GPS. Pastikan lokasi/GPS aktif & izinkan akses lokasi, lalu coba lagi.')),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
    // Safety timeout bila browser tidak pernah memanggil callback
    setTimeout(() => finish(reject, new Error('Sinyal GPS lambat. Coba lagi di tempat terbuka.')), 9000);
  });
}

async function submitAbsenForm() {
  const btnSnap = document.getElementById('btnSnapPhoto');
  if (attendanceSubmitInProgress) return;
  try {
    if (!capturedBlob) {
      alert('Foto presensi wajib diambil!');
      return;
    }

    attendanceSubmitInProgress = true;
    btnSnap.disabled = true;
    btnSnap.textContent = 'MENYIAPKAN FOTO...';
    capturedBlob = await compressImageBlob(capturedBlob);
    btnSnap.textContent = 'MEMERIKSA GPS...';

    // Selalu ambil fix GPS segar saat submit agar tidak memakai koordinat basi
    // dari saat halaman dimuat. Tolak bila akurasi terlalu rendah.
    const fix = await getFreshLocation();
    currentCoords.lat = fix.lat;
    currentCoords.lng = fix.lng;
    currentAccuracy = fix.accuracy;

    btnSnap.textContent = 'MENGIRIM...';

    const formData = new FormData();
    formData.append('latitude', currentCoords.lat);
    formData.append('longitude', currentCoords.lng);
    if (currentAccuracy !== null) formData.append('accuracy', String(currentAccuracy));
    formData.append('foto', capturedBlob, 'presensi.jpg');

    if (currentAbsenType === 'datang') {
      const selectEl = document.getElementById('selectShift');
      const shiftId = selectEl ? selectEl.value : null;
      if (shiftId) {
        formData.append('shift_id', shiftId);
      }
    }

    const endpoint = currentAbsenType === 'datang' ? '/api/absensi/datang' : '/api/absensi/pulang';

    const res = await portalFetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: formData,
      timeoutMs: 45000
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal mengirim presensi');

    alert(`✅ Berhasil! ${data.message || 'Presensi tercatat'}`);
    closeCameraModal();
    if (btnSnap) {
      btnSnap.disabled = false;
      btnSnap.textContent = '📸 AMBIL FOTO & ABSEN';
    }
    cekStatusToday();
  } catch (err) {
    if (err.code === 'REQUEST_TIMEOUT' || err.code === 'NETWORK_ERROR') {
      const recovered = await reconcileAttendanceAfterConnectionLoss(currentAbsenType);
      if (recovered) return;
    }
    alert('❌ ' + err.message);
  } finally {
    attendanceSubmitInProgress = false;
    if (btnSnap) {
      btnSnap.disabled = false;
      btnSnap.textContent = '📸 AMBIL FOTO & ABSEN';
    }
  }
}

async function reconcileAttendanceAfterConnectionLoss(type) {
  try {
    const response = await portalFetch(`${API_BASE}/api/absensi/riwayat`, {
      headers: { Authorization: `Bearer ${userToken}` },
      timeoutMs: 10000,
    });
    if (!response.ok) return false;
    const rows = await response.json();
    const recentThreshold = Date.now() - (5 * 60 * 1000);
    const attendanceRows = Array.isArray(rows) ? rows : [];
    const hasPendingSession = attendanceRows.some(isPendingAttendanceSession);
    const hasRecentEvent = attendanceRows.some((row) => {
      const value = type === 'datang' ? row.waktu_datang : row.waktu_pulang;
      const timestamp = value ? new Date(value).getTime() : 0;
      return Number.isFinite(timestamp) && timestamp >= recentThreshold;
    });
    const confirmed = type === 'datang'
      ? hasPendingSession && hasRecentEvent
      : !hasPendingSession && attendanceRows.some(isCompletedAttendanceSession) && hasRecentEvent;
    if (!confirmed) return false;
    alert('✅ Absensi sudah tercatat di server. Konfirmasi awal terputus, tetapi data berhasil ditemukan kembali.');
    closeCameraModal();
    await cekStatusToday();
    return true;
  } catch (_) {
    return false;
  }
}

// -------------------------------------------------------------
// RIWAYAT & SLIP GAJI
// -------------------------------------------------------------
async function muatRiwayat() {
  const tbody = document.getElementById('tbodyRiwayat');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Memuat data...</td></tr>';

  try {
    const res = await portalFetch(`${API_BASE}/api/absensi/riwayat`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Belum ada riwayat absensi.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const tgl = formatAttendanceWorkDate(r.tanggal_kerja);
      const jamD = r.waktu_datang ? formatAttendanceTime(r.waktu_datang) : '-';
      const jamP = r.waktu_pulang ? formatAttendanceTime(r.waktu_pulang) : '-';

      return `
        <tr>
          <td><b>${tgl}</b></td>
          <td>${jamD}</td>
          <td>${jamP}</td>
          <td><span style="color:var(--emerald-dark); font-weight:700;">${r.status_datang || 'Hadir'}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:red;">Gagal memuat: ${err.message}</td></tr>`;
  }
}

async function downloadSlipGaji() {
  const bulan = document.getElementById('slipBulan').value;
  const tahun = document.getElementById('slipTahun').value;

  try {
    const res = await portalFetch(`${API_BASE}/api/absensi/slip-gaji?bulan=${bulan}&tahun=${tahun}`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Gagal mengunduh slip gaji');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SlipGaji_Karyawan_${bulan}_${tahun}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

// -------------------------------------------------------------
// PENDAFTARAN KARYAWAN BARU
// -------------------------------------------------------------
let opsiPendaftaranCache = null;

async function muatOpsiPendaftaranDaftar() {
  try {
    const res = await portalFetch(`${API_BASE}/api/auth/opsi-pendaftaran`);
    opsiPendaftaranCache = await res.json();

    const deptSelect = document.getElementById('daftarDept');
    if (deptSelect && opsiPendaftaranCache.departemen_jabatan) {
      deptSelect.innerHTML = '<option value="">-- Pilih Departemen --</option>' +
        Object.keys(opsiPendaftaranCache.departemen_jabatan).map(d => `<option value="${d}">${d}</option>`).join('');
    }

    const lokasiSelect = document.getElementById('daftarLokasi');
    if (lokasiSelect && opsiPendaftaranCache.lokasi) {
      lokasiSelect.innerHTML = '<option value="">-- Pilih Lokasi Kantor/Site --</option>' +
        opsiPendaftaranCache.lokasi.map(l => `<option value="${l.id}">${l.nama_lokasi}</option>`).join('');
    }
  } catch (e) {
    console.warn('Gagal muat opsi pendaftaran:', e);
  }
}

function onDeptChanged(deptName) {
  const jabSelect = document.getElementById('daftarJabatan');
  if (!jabSelect) return;

  if (!deptName || !opsiPendaftaranCache?.departemen_jabatan?.[deptName]) {
    jabSelect.innerHTML = '<option value="">-- Pilih Jabatan --</option>';
    return;
  }

  const jabatans = opsiPendaftaranCache.departemen_jabatan[deptName];
  jabSelect.innerHTML = '<option value="">-- Pilih Jabatan --</option>' +
    jabatans.map(j => `<option value="${j}">${j}</option>`).join('');
}

async function handleDaftar(e) {
  e.preventDefault();
  const alertEl = document.getElementById('daftarAlert');
  const succEl = document.getElementById('daftarSuccessAlert');
  const btn = document.getElementById('btnSubmitDaftar');

  alertEl.style.display = 'none';
  succEl.style.display = 'none';

  const nama = document.getElementById('daftarNama').value.trim();
  const email = document.getElementById('daftarEmail').value.trim();
  const password = document.getElementById('daftarPassword').value;
  const departemen = document.getElementById('daftarDept').value;
  const jabatan = document.getElementById('daftarJabatan').value;
  const lokasi_kantor_id = document.getElementById('daftarLokasi').value;

  const f1 = document.getElementById('daftarFoto1').files[0];
  const f2 = document.getElementById('daftarFoto2').files[0];
  const f3 = document.getElementById('daftarFoto3').files[0];

  if (!f1 || !f2 || !f3) {
    alertEl.textContent = 'Harap sertakan 3 sampel foto wajah referensi';
    alertEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'MENYIAPKAN FOTO...';

  let compressedPhotos;
  try {
    compressedPhotos = await Promise.all([f1, f2, f3].map((file) => compressImageBlob(file)));
  } catch (error) {
    alertEl.textContent = error.message;
    alertEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'KIRIM PENDAFTARAN';
    return;
  }
  btn.textContent = 'MENGIRIM PENDAFTARAN...';

  const formData = new FormData();
  formData.append('nama', nama);
  formData.append('email', email);
  formData.append('password', password);
  formData.append('departemen', departemen);
  formData.append('jabatan', jabatan);
  formData.append('lokasi_kantor_id', lokasi_kantor_id);

  formData.append('foto1', compressedPhotos[0], 'sample1.jpg');
  formData.append('foto2', compressedPhotos[1], 'sample2.jpg');
  formData.append('foto3', compressedPhotos[2], 'sample3.jpg');

  try {
    const res = await portalFetch(`${API_BASE}/api/auth/daftar`, {
      method: 'POST',
      body: formData,
      timeoutMs: 60000,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Pendaftaran gagal');

    succEl.textContent = '🎉 Pendaftaran Berhasil Dikirim! Akun Anda sedang menunggu persetujuan Admin.';
    succEl.style.display = 'block';
    document.getElementById('formDaftar').reset();

    setTimeout(() => {
      showView('viewLogin');
      succEl.style.display = 'none';
    }, 3000);
  } catch (err) {
    alertEl.textContent = err.message;
    alertEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'KIRIM PENDAFTARAN';
  }
}

// -------------------------------------------------------------
// LUPA PASSWORD & RESET AKUN
// -------------------------------------------------------------
async function handleMintaOtpReset(e) {
  e.preventDefault();
  const alertEl = document.getElementById('lupaAlert');
  const succEl = document.getElementById('lupaSuccessAlert');
  const btn = document.getElementById('btnMintaOtp');

  alertEl.style.display = 'none';
  succEl.style.display = 'none';

  const email = document.getElementById('lupaEmail').value.trim();
  btn.disabled = true;
  btn.textContent = 'MENGIRIM KODE OTP...';

  try {
    const res = await portalFetch(`${API_BASE}/api/auth/lupa-sandi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal meminta reset password');

    let msgText = data.message;
    if (data.otp_demo) {
      msgText += ` [KODE OTP DEMO: ${data.otp_demo}]`;
      document.getElementById('resetToken').value = data.otp_demo;
    }
    succEl.textContent = msgText;
    succEl.style.display = 'block';

    document.getElementById('formMintaOtp').style.display = 'none';
    document.getElementById('formResetPass').style.display = 'flex';
  } catch (err) {
    alertEl.textContent = err.message;
    alertEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'KIRIM KODE OTP RESET 📩';
  }
}

async function handleResetSandi(e) {
  e.preventDefault();
  const alertEl = document.getElementById('lupaAlert');
  const succEl = document.getElementById('lupaSuccessAlert');
  const btn = document.getElementById('btnSubmitReset');

  alertEl.style.display = 'none';

  const email = document.getElementById('lupaEmail').value.trim();
  const token = document.getElementById('resetToken').value.trim();
  const password_baru = document.getElementById('resetPassBaru').value;

  btn.disabled = true;
  btn.textContent = 'MENYIMPAN PASSWORD...';

  try {
    const res = await portalFetch(`${API_BASE}/api/auth/reset-sandi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, password_baru })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal mereset password');

    succEl.textContent = '🎉 ' + data.message;
    succEl.style.display = 'block';

    setTimeout(() => {
      showView('viewLogin');
    }, 2500);
  } catch (err) {
    alertEl.textContent = err.message;
    alertEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'SIMPAN PASSWORD BARU 🔒';
  }
}

window.showView = showView;
window.onDeptChanged = onDeptChanged;
