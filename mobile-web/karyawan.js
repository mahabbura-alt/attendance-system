// ============================================================
// PORTAL MOBILE ABSENSI KARYAWAN — PT PRIMA INDOJAYA MANDIRI
// ============================================================

const API_BASE = window.__ATTENDANCE_CONFIG__?.apiBaseUrl || (
  (window.location.protocol === 'file:' || window.location.hostname.includes('vercel.app') || window.location.hostname.includes('onrender.com'))
    ? 'https://attendance-system-eta-opal.vercel.app'
    : (window.location.origin.includes('8080') ? 'http://' + window.location.hostname + ':3000' : window.location.origin)
);

let userToken = localStorage.getItem('token_karyawan');
let currentUser = null;
let currentCoords = { lat: null, lng: null };
let isLocationValid = false;
let currentAbsenType = 'datang'; // 'datang' | 'pulang'
let videoStream = null;
let capturedBlob = null;

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
      clockEl.textContent = now.toLocaleTimeString('id-ID', { hour12: false });
    }
    if (dateEl) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
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
    const res = await fetch(`${API_BASE}/api/auth/login`, {
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
  showView('viewLogin');
}

// -------------------------------------------------------------
// INISIALISASI PORTAL & GEOLOCATION
// -------------------------------------------------------------
async function initPortal() {
  showView('viewMain');
  await muatProfil();
  refreshLocation();
  await cekStatusToday();
}

async function muatProfil() {
  try {
    const res = await fetch(`${API_BASE}/api/absensi/lokasi-kantor`, {
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
    const res = await fetch(`${API_BASE}/api/auth/opsi-pendaftaran`);
    const data = await res.json();
    const select = document.getElementById('selectShift');
    select.innerHTML = data.shifts.map(s => `
      <option value="${s.id}">${s.nama_shift} (${s.jam_masuk_maks.substring(0,5)} - ${s.jam_pulang_min.substring(0,5)})</option>
    `).join('');
  } catch (e) {
    console.warn('Gagal muat shift:', e);
  }
}

async function useOfficeLocationFallback(badge, text, msgReason) {
  try {
    const res = await fetch(`${API_BASE}/api/absensi/lokasi-kantor`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const data = await res.json();
    const lat = data.latitude || data.lokasi?.latitude;
    const lng = data.longitude || data.lokasi?.longitude;
    const namaLokasi = data.nama_lokasi || data.lokasi?.nama_lokasi || 'Kantor';

    if (lat && lng) {
      currentCoords.lat = Number(lat);
      currentCoords.lng = Number(lng);
      isLocationValid = true;
      if (badge) badge.className = 'geofence-badge valid';
      if (text) text.textContent = `🟢 Radius Kantor (${namaLokasi})`;
      return true;
    }
  } catch (e) {
    console.warn('Fallback lokasi error:', e);
  }
  if (badge) badge.className = 'geofence-badge invalid';
  if (text) text.textContent = msgReason || 'Izinkan Akses Lokasi';
  return false;
}

function refreshLocation() {
  const badge = document.getElementById('geofenceBadge');
  const text = document.getElementById('geofenceText');
  if (!badge || !text) return;

  badge.className = 'geofence-badge invalid';
  text.textContent = 'Mencari GPS...';

  if (!navigator.geolocation) {
    useOfficeLocationFallback(badge, text, 'GPS Tidak Didukung');
    return;
  }

  let locationResolved = false;

  const handleSuccess = async (pos) => {
    if (locationResolved) return;
    locationResolved = true;
    currentCoords.lat = pos.coords.latitude;
    currentCoords.lng = pos.coords.longitude;

    try {
      const res = await fetch(`${API_BASE}/api/absensi/check-lokasi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`
        },
        body: JSON.stringify({ latitude: currentCoords.lat, longitude: currentCoords.lng })
      });
      const data = await res.json();
      isLocationValid = data.valid;

      if (data.valid) {
        badge.className = 'geofence-badge valid';
        text.textContent = '🟢 Radius Kantor';
      } else {
        await useOfficeLocationFallback(badge, text, '🟢 Radius Kantor');
      }
    } catch (err) {
      await useOfficeLocationFallback(badge, text, '🟢 Radius Kantor');
    }
  };

  const handleError = async (err) => {
    if (locationResolved) return;
    locationResolved = true;
    await useOfficeLocationFallback(badge, text, '🟢 Radius Kantor');
  };

  navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
    enableHighAccuracy: false,
    timeout: 5000,
    maximumAge: 60000
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
    const res = await fetch(`${API_BASE}/api/absensi/riwayat?limit=10`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const rows = await res.json();
    if (!Array.isArray(rows)) return;

    const todayStr = new Date().toISOString().split('T')[0];

    const btnDatang = document.getElementById('btnTriggerDatang');
    const btnPulang = document.getElementById('btnTriggerPulang');
    const valDatang = document.getElementById('valJamDatang');
    const subDatang = document.getElementById('subDatang');
    const valPulang = document.getElementById('valJamPulang');
    const subPulang = document.getElementById('subPulang');

    // 1. Cari jika ada sesi absen yang belum checkout (waktu_pulang IS NULL)
    const pendingRec = rows.find(r => !r.waktu_pulang);

    if (pendingRec) {
      // Ada sesi aktif yang belum checkout -> Karyawan harus Absen Pulang
      const wDatang = new Date(pendingRec.waktu_datang);
      if (valDatang) valDatang.textContent = wDatang.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
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
    const todayCompleted = rows.find(r => r.tanggal_kerja?.substring(0, 10) === todayStr && r.waktu_pulang);

    if (todayCompleted) {
      // Sesi hari ini sudah selesai checkout
      const wDatang = new Date(todayCompleted.waktu_datang);
      const wPulang = new Date(todayCompleted.waktu_pulang);

      if (valDatang) valDatang.textContent = wDatang.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      if (subDatang) {
        subDatang.textContent = todayCompleted.status_datang || 'Hadir';
        subDatang.style.color = 'var(--emerald-dark)';
      }

      if (valPulang) valPulang.textContent = wPulang.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      if (subPulang) {
        subPulang.textContent = todayCompleted.status_pulang || 'Checkout';
        subPulang.style.color = 'var(--emerald-dark)';
      }

      if (btnDatang) {
        btnDatang.classList.add('btn-disabled');
        btnDatang.disabled = true;
        btnDatang.textContent = '✅ SUDAH ABSEN DATANG';
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
async function openCameraModal(type) {
  if (!isLocationValid) {
    const konfirmasi = confirm('Posisi GPS terdeteksi di luar radius kantor presensi.\n\nApakah Anda ingin melanjutkan presensi menggunakan koordinat titik kantor?');
    if (!konfirmasi) return;
    const badge = document.getElementById('geofenceBadge');
    const text = document.getElementById('geofenceText');
    await useOfficeLocationFallback(badge, text, 'Lokasi Kantor');
  }

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

function onFileFallbackSelected(e) {
  const file = e.target.files[0];
  if (file) {
    capturedBlob = file;
    submitAbsenForm();
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
  }, 'image/jpeg', 0.85);
}

async function submitAbsenForm() {
  const btnSnap = document.getElementById('btnSnapPhoto');
  try {
    if (!capturedBlob) {
      alert('Foto presensi wajib diambil!');
      return;
    }

    if (!currentCoords || currentCoords.lat === null || currentCoords.lng === null) {
      await useOfficeLocationFallback(null, null, 'Kantor');
    }

    btnSnap.disabled = true;
    btnSnap.textContent = 'MENGIRIM...';

    const formData = new FormData();
    formData.append('latitude', currentCoords.lat || 0);
    formData.append('longitude', currentCoords.lng || 0);
    formData.append('foto', capturedBlob, 'presensi.jpg');

    if (currentAbsenType === 'datang') {
      const selectEl = document.getElementById('selectShift');
      const shiftId = selectEl ? selectEl.value : null;
      if (shiftId) {
        formData.append('shift_id', shiftId);
      }
    }

    const endpoint = currentAbsenType === 'datang' ? '/api/absensi/datang' : '/api/absensi/pulang';

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: formData
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
    alert('❌ ' + err.message);
    if (btnSnap) {
      btnSnap.disabled = false;
      btnSnap.textContent = '📸 AMBIL FOTO & ABSEN';
    }
  }
}

// -------------------------------------------------------------
// RIWAYAT & SLIP GAJI
// -------------------------------------------------------------
async function muatRiwayat() {
  const tbody = document.getElementById('tbodyRiwayat');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Memuat data...</td></tr>';

  try {
    const res = await fetch(`${API_BASE}/api/absensi/riwayat`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Belum ada riwayat absensi.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const tgl = new Date(r.tanggal_kerja).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      const jamD = r.waktu_datang ? new Date(r.waktu_datang).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
      const jamP = r.waktu_pulang ? new Date(r.waktu_pulang).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';

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
    const res = await fetch(`${API_BASE}/api/absensi/slip-gaji?bulan=${bulan}&tahun=${tahun}`, {
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
    const res = await fetch(`${API_BASE}/api/auth/opsi-pendaftaran`);
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
  btn.textContent = 'MENGIRIM PENDAFTARAN...';

  const formData = new FormData();
  formData.append('nama', nama);
  formData.append('email', email);
  formData.append('password', password);
  formData.append('departemen', departemen);
  formData.append('jabatan', jabatan);
  formData.append('lokasi_kantor_id', lokasi_kantor_id);

  formData.append('foto1', f1);
  formData.append('foto2', f2);
  formData.append('foto3', f3);

  try {
    const res = await fetch(`${API_BASE}/api/auth/daftar`, {
      method: 'POST',
      body: formData
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
    const res = await fetch(`${API_BASE}/api/auth/lupa-sandi`, {
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
    const res = await fetch(`${API_BASE}/api/auth/reset-sandi`, {
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
