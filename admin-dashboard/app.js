// ============================================================
// State & helper API
// ============================================================
const state = {
  token: localStorage.getItem('admin_token') || null,
  nama: localStorage.getItem('admin_nama') || null,
  shifts: [],
  lokasi: [],
};

const DEPARTEMEN_JABATAN_MAP = {
  'Produksi': ['SPV Produksi', 'Pengawas', 'Operator', 'Driver DT', 'Driver WT', 'Checker'],
  'Engineering': ['SPV Engineering', 'Mine Plan', 'Foreman Moco', 'Admin', 'Surveyor', 'Ast Survey', 'Helper Survey'],
  'Logistik': ['Foreman Logistik', 'Logistik', 'Admin', 'Fuelman', 'Ekspeditor'],
  'HSE': ['SPV HSE', 'HSE Officer', 'Safety Patrol', 'Helper HSE'],
  'Maintenance': ['SPV Maintenance', 'Foreman Maintenance', 'Mekanik', 'Welder', 'Auto Electrician', 'Admin Maintenance', 'Helper Maintenance', 'Helper Mekanik'],
  'HRGA & Finance': ['Foreman HR', 'Admin HR', 'Admin Finance', 'Driver Sarana'],
  'Management': ['PJO'],
};

function getApiBaseUrl() {
  if (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('onrender.com')) {
    return window.location.origin;
  }
  const currentHost = window.location.hostname || 'localhost';
  if (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) {
    try {
      const u = new URL(API_BASE_URL);
      if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (currentHost !== 'localhost' && currentHost !== '127.0.0.1')) {
        u.hostname = currentHost;
      }
      return u.toString().replace(/\/$/, '');
    } catch (_) {
      return API_BASE_URL;
    }
  }
  return `http://${currentHost}:3000`;
}

async function api(path, options = {}) {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
  });

  let body = null;
  try { body = await res.json(); } catch (_) { /* respons tanpa body JSON */ }

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_nama');
      state.token = null;
      document.getElementById('layarLogin').hidden = false;
      document.getElementById('app').hidden = true;
    }
    const pesan = body?.error || `Permintaan gagal (${res.status})`;
    throw new Error(pesan);
  }
  return body;
}

function apiJson(path, method, data) {
  return api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

// ============================================================
// Jam berjalan (elemen signature: tampilan seperti punch clock)
// ============================================================
function formatJam(d) {
  return d.toLocaleTimeString('id-ID', { hour12: false });
}
function formatTanggal(d) {
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function mulaiJamBerjalan() {
  const tick = () => {
    const now = new Date();
    const jamLogin = document.getElementById('jamLogin');
    const jamUtama = document.getElementById('jamUtama');
    const tanggalUtama = document.getElementById('tanggalUtama');
    if (jamLogin) jamLogin.textContent = formatJam(now);
    if (jamUtama) jamUtama.textContent = formatJam(now);
    if (tanggalUtama) tanggalUtama.textContent = formatTanggal(now);
  };
  tick();
  setInterval(tick, 1000);
}

// ============================================================
// Login
// ============================================================
document.getElementById('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('inputEmail').value.trim();
  const password = document.getElementById('inputPassword').value;
  const errorEl = document.getElementById('errorLogin');
  errorEl.hidden = true;

  try {
    const hasil = await apiJson('/api/auth/login', 'POST', { email, password });
    state.token = hasil.token;
    state.nama = hasil.user.nama;
    state.role = hasil.user.role;
    localStorage.setItem('admin_token', hasil.token);
    localStorage.setItem('admin_nama', hasil.user.nama);
    localStorage.setItem('admin_email', hasil.user.email);
    localStorage.setItem('user_role', hasil.user.role);
    tampilkanApp();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

document.getElementById('tombolLogout').addEventListener('click', () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_nama');
  state.token = null;
  location.reload();
});

// ============================================================
// PER-USER SESSION & SLICER PERSISTENCE SYSTEM (OMOS)
// ============================================================
function getOMOSSessionKey() {
  const userEmail = (state.user && state.user.email) || localStorage.getItem('admin_email') || 'default_admin';
  return `omos_session_${userEmail}`;
}

function simpanSesiUserOMOS(customData = {}) {
  try {
    const key = getOMOSSessionKey();
    const existing = JSON.parse(localStorage.getItem(key) || '{}');
    const updated = {
      ...existing,
      ...customData,
      slicers: {
        ...(existing.slicers || {}),
        ...(customData.slicers || {})
      }
    };
    localStorage.setItem(key, JSON.stringify(updated));
  } catch (err) {
    console.warn('Gagal menyimpan sesi user:', err);
  }
}

function pulihkanSesiUserOMOS() {
  try {
    const key = getOMOSSessionKey();
    const sessionStr = localStorage.getItem(key);
    if (!sessionStr) return false;
    const session = JSON.parse(sessionStr);

    // 1. Pulihkan Active Tab
    if (session.activeTab) {
      const tabName = session.activeTab;
      if (tabName.startsWith('prod') && typeof bukaTabProduksi === 'function') {
        bukaTabProduksi(tabName);
      } else {
        const btn = document.querySelector(`.sidebar__tab[data-tab="${tabName}"]`);
        if (btn) btn.click();
      }
    }

    // 2. Pulihkan Nilai Slicer Filter
    if (session.slicers) {
      Object.entries(session.slicers).forEach(([id, val]) => {
        // Input Fuel memakai tampilan kartu seluruh unit saat pertama dibuka.
        // Jangan menghidupkan lagi pencarian unit yang tersisa dari sesi lama.
        if (id === 'slicerFuelKode') return;
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== null && val !== '') {
          el.value = val;
        }
      });

      if (typeof renderTabelAbsensi === 'function') renderTabelAbsensi();
      if (typeof terapkanSlicerInputData === 'function') terapkanSlicerInputData();
      if (typeof terapkanSlicerInputFuel === 'function') terapkanSlicerInputFuel();
      if (typeof terapkanSlicerEquipment === 'function') terapkanSlicerEquipment();
    }
    return true;
  } catch (err) {
    console.warn('Gagal memulihkan sesi user:', err);
    return false;
  }
}

async function tampilkanApp() {
  document.getElementById('layarLogin').hidden = true;
  document.getElementById('app').hidden = false;
  document.getElementById('namaAdminSidebar').textContent = state.nama || 'Admin';

  // Minta izin notifikasi desktop browser
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Jalankan cek notifikasi pendaftar baru berkala
  cekRegistrasiPendingNotifikasi();
  if (!window.pendingIntervalSet) {
    window.pendingIntervalSet = true;
    setInterval(cekRegistrasiPendingNotifikasi, 10000);
  }

  state.role = state.role || localStorage.getItem('user_role') || 'admin';
  if (state.role === 'karyawan') {
    document.getElementById('namaAdminSidebar').textContent = (state.nama || 'Karyawan') + ' (Karyawan)';
    const btnEdit = document.getElementById('btnEditProfilSidebar');
    if (btnEdit) btnEdit.style.display = 'none';
    document.querySelectorAll('.sidebar__tab').forEach((tab) => {
      const tabName = tab.dataset.tab;
      if (['absensi', 'payroll'].includes(tabName)) {
        tab.style.display = 'block';
      } else {
        tab.style.display = 'none';
      }
    });
    const firstTab = document.querySelector('.sidebar__tab[data-tab="absensi"]');
    if (firstTab) firstTab.click();
    return;
  }

  try {
    const adminMe = await api('/api/admin/me');
    state.user = adminMe;
    if (adminMe.email) localStorage.setItem('admin_email', adminMe.email);
    const isUtama = adminMe.is_super_admin;
    document.getElementById('namaAdminSidebar').textContent = adminMe.nama + (isUtama ? ' (Admin Utama)' : '');

    // Filter sidebar tabs berdasarkan otoritas akses (permissions)
    const perms = isUtama
      ? ['absensi', 'karyawan', 'performa', 'roster', 'registrasi', 'payroll', 'hm', 'kalkulasiPayroll']
      : (adminMe.permissions || ['absensi', 'karyawan']);

    let firstAvailableTab = null;
    document.querySelectorAll('.sidebar__tab').forEach((tab) => {
      const tabName = tab.dataset.tab;
      if (tab.classList.contains('sidebar__tab--folder') || perms.includes(tabName) || (tabName && tabName.startsWith('prod'))) {
        tab.style.display = 'flex';
        if (!firstAvailableTab && tabName) firstAvailableTab = tab;
      } else {
        tab.style.display = 'none';
      }
    });
  } catch (err) {
    console.warn('Gagal memuat data me admin:', err.message);
  }

  await muatSemuaData();
  const dipulihkan = pulihkanSesiUserOMOS();

  if (!dipulihkan) {
    const firstTab = document.querySelector('.sidebar__tab:not([style*="display: none"])[data-tab]');
    if (firstTab) firstTab.click();
  }
}

document.getElementById('btnEditProfilSidebar')?.addEventListener('click', bukaModalEditProfilAdmin);

if (typeof PlanProductivity !== 'undefined' && typeof PlanProductivity.initAllPlanProductivityModules === 'function') {
  window.addEventListener('load', function () {
    PlanProductivity.initAllPlanProductivityModules();
  });
}

document.querySelectorAll('.sidebar__tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    if (tab.classList.contains('sidebar__tab--folder')) {
      if (tab.getAttribute('aria-expanded') === 'true' && tabName && typeof bukaTabProduksi === 'function') {
        bukaTabProduksi(tabName);
      }
      return;
    }
    if (tabName) {
      simpanSesiUserOMOS({ activeTab: tabName });
    }

    if (tabName && tabName.startsWith('prod')) {
      if (typeof bukaTabProduksi === 'function') bukaTabProduksi(tabName);
      return;
    }

    document.querySelectorAll('.tab-konten').forEach((el) => el.hidden = true);
    document.querySelectorAll('.sidebar__tab').forEach((t) => t.classList.remove('is-aktif'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('is-aktif'));
    tab.classList.add('is-aktif');
    const panelId = `tab${kapital(tabName)}`;
    document.getElementById(panelId)?.classList.add('is-aktif');
    if (tabName === 'payroll') muatPayroll();
    if (tabName === 'hm') muatHm();
    if (tabName === 'roster') muatRoster();
    if (tabName === 'kalkulasiPayroll') muatKalkulasiPayroll();
  });
});
function kapital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ============================================================
// Modal generik
// ============================================================
function bukaModal(html) {
  document.getElementById('modalKonten').innerHTML = html;
  document.getElementById('modalOverlay').hidden = false;
}
function tutupModal() {
  document.getElementById('modalOverlay').hidden = true;
  document.getElementById('modalKonten').innerHTML = '';
}
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') tutupModal();
});

// ============================================================
// Pemuatan data awal
// ============================================================
async function muatSemuaData() {
  await Promise.all([muatShiftDanLokasi(), muatAbsensi(), muatKaryawan(), muatLokasi()]);
  muatRegistrasiPending(); // muat juga pending registrasi
}

async function muatShiftDanLokasi() {
  try {
    state.shifts = await api('/api/admin/shifts');
    state.lokasi = await api('/api/admin/lokasi');
  } catch (err) {
    console.error('Gagal memuat shift/lokasi:', err.message);
  }
}

// ============================================================
// TAB ABSENSI
// ============================================================
function pilStatus(status) {
  if (!status) return '<span class="pil pil--netral">—</span>';
  if (status === 'tepat waktu') return '<span class="pil pil--ok">Tepat waktu</span>';
  if (status === 'telat') return '<span class="pil pil--peringatan">Telat</span>';
  if (status === 'checkout lewat') return '<span class="pil pil--peringatan">Checkout lewat</span>';
  return `<span class="pil pil--netral">${status}</span>`;
}

function formatWaktu(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', {
    hour12: false,
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' WIB';
}

let absensiPertamaLoad = true;

function tanggalWibHariIniAbsensi() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function setDefaultRangeAbsensiHariIni() {
  const tanggalHariIni = tanggalWibHariIniAbsensi();
  const mulai = document.getElementById('filterTanggalMulaiAbsensi');
  const akhir = document.getElementById('filterTanggalAkhirAbsensi');
  if (mulai && !mulai.value) mulai.value = tanggalHariIni;
  if (akhir && !akhir.value) akhir.value = tanggalHariIni;
}

function validasiRangeAbsensi() {
  const tanggalMulai = document.getElementById('filterTanggalMulaiAbsensi')?.value || '';
  const tanggalAkhir = document.getElementById('filterTanggalAkhirAbsensi')?.value || '';
  if (!tanggalMulai || !tanggalAkhir) throw new Error('Tanggal awal dan tanggal akhir wajib diisi');
  if (tanggalAkhir < tanggalMulai) throw new Error('Tanggal akhir tidak boleh sebelum tanggal awal');
  return { tanggalMulai, tanggalAkhir };
}

function buatParamsFilterAbsensi({ sertakanAtribut = false } = {}) {
  const { tanggalMulai, tanggalAkhir } = validasiRangeAbsensi();
  const params = new URLSearchParams();
  params.set('tanggal_dari', tanggalMulai);
  params.set('tanggal_sampai', tanggalAkhir);

  if (sertakanAtribut) {
    const shift = document.getElementById('slicerShiftAbsensi')?.value || '';
    const departemen = document.getElementById('slicerDeptAbsensi')?.value || '';
    const jabatan = document.getElementById('slicerJabatanAbsensi')?.value || '';
    const nama = document.getElementById('slicerNamaAbsensi')?.value || '';
    const q = (document.getElementById('searchAbsensi')?.value || '').trim();
    if (shift) params.set('shift', shift);
    if (departemen) params.set('departemen', departemen);
    if (jabatan) params.set('jabatan', jabatan);
    if (nama) params.set('nama', nama);
    if (q) params.set('q', q);
  }
  return params;
}

function buatUrlAbsensiDariRange() {
  return `/api/admin/absensi?${buatParamsFilterAbsensi().toString()}`;
}

// Master filter tidak boleh bergantung pada data absensi di periode yang sedang
// dibuka. Pada hari tanpa absensi, Departemen/Jabatan tetap harus dapat dipilih.
async function muatMasterSlicerAbsensi() {
  if (window.dataMasterSlicerAbsensi && window.dataMasterSlicerAbsensi.length) return window.dataMasterSlicerAbsensi;
  try {
    const daftar = await api('/api/admin/karyawan');
    window.dataMasterSlicerAbsensi = daftar || [];
  } catch (error) {
    console.warn('Gagal memuat master filter Absensi:', error.message);
  }
  return window.dataMasterSlicerAbsensi;
}

async function muatAbsensi() {
  const tbody = document.getElementById('tbodyAbsensi');
  try {
    if (absensiPertamaLoad) {
      setDefaultRangeAbsensiHariIni();
      absensiPertamaLoad = false;
    }

    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="tabel__kosong">Memuat data absensi...</td></tr>';
    const urlAbsensi = buatUrlAbsensiDariRange();
    const [daftar] = await Promise.all([
      api(urlAbsensi),
      muatMasterSlicerAbsensi(),
    ]);
    window.dataAbsensiCache = daftar || [];

    initSlicersAbsensiDropdowns();
    renderTabelAbsensi();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="tabel__kosong">Gagal memuat: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function initSlicersAbsensiDropdowns() {
  const data = window.dataAbsensiCache || [];
  const dataMaster = window.dataMasterSlicerAbsensi || [];
  const selectDept = document.getElementById('slicerDeptAbsensi');
  const selectJabatan = document.getElementById('slicerJabatanAbsensi');
  const selectNama = document.getElementById('slicerNamaAbsensi');

  if (selectDept) {
    const currentDept = selectDept.value;
    const listDept = Array.from(new Set([
      ...dataMaster.map(k => k.departemen),
      ...data.map(a => a.departemen),
    ].filter(Boolean))).sort();
    selectDept.innerHTML = '<option value="">🏢 Departemen: Semua</option>' +
      listDept.map(d => `<option value="${escapeHtml(d)}" ${d === currentDept ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
  }

  if (selectJabatan) {
    const currentJbt = selectJabatan.value;
    const listJbt = Array.from(new Set([
      ...dataMaster.map(k => k.jabatan),
      ...data.map(a => a.jabatan),
    ].filter(Boolean))).sort();
    selectJabatan.innerHTML = '<option value="">💼 Jabatan: Semua</option>' +
      listJbt.map(j => `<option value="${escapeHtml(j)}" ${j === currentJbt ? 'selected' : ''}>${escapeHtml(j)}</option>`).join('');
  }

  if (selectNama) {
    const currentNama = selectNama.value;
    const listNama = Array.from(new Set([
      ...dataMaster.map(k => k.nama),
      ...data.map(a => a.nama),
    ].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'));
    selectNama.innerHTML = '<option value="">👤 Nama: Semua</option>' +
      listNama.map(n => `<option value="${escapeHtml(n)}" ${n === currentNama ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
  }
}

function renderTabelAbsensi() {
  const tbody = document.getElementById('tbodyAbsensi');
  if (!tbody) return;

  const tanggalMulai = document.getElementById('filterTanggalMulaiAbsensi')?.value || '';
  const tanggalAkhir = document.getElementById('filterTanggalAkhirAbsensi')?.value || '';
  const shiftVal = document.getElementById('slicerShiftAbsensi')?.value || '';
  const deptVal = document.getElementById('slicerDeptAbsensi')?.value || '';
  const jabatanVal = document.getElementById('slicerJabatanAbsensi')?.value || '';
  const namaVal = document.getElementById('slicerNamaAbsensi')?.value || '';
  const searchVal = (document.getElementById('searchAbsensi')?.value || '').trim().toLowerCase();

  const btnReset = document.getElementById('btnResetSlicerAbsensi');
  if (btnReset) {
    const today = tanggalWibHariIniAbsensi();
    const rangeBukanDefault = tanggalMulai !== today || tanggalAkhir !== today;
    btnReset.hidden = !(rangeBukanDefault || shiftVal || deptVal || jabatanVal || namaVal || searchVal);
  }

  let filtered = window.dataAbsensiCache || [];
  if (shiftVal) {
    filtered = filtered.filter(a => (a.nama_shift || '').toLowerCase().includes(shiftVal.toLowerCase()));
  }
  if (deptVal) {
    filtered = filtered.filter(a => (a.departemen || '') === deptVal);
  }
  if (jabatanVal) {
    filtered = filtered.filter(a => (a.jabatan || '') === jabatanVal);
  }
  if (namaVal) {
    filtered = filtered.filter(a => (a.nama || '') === namaVal);
  }
  if (searchVal) {
    filtered = filtered.filter(a => {
      const haystack = [(a.nama || ''), (a.departemen || ''), (a.jabatan || '')].join(' ').toLowerCase();
      return haystack.includes(searchVal);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="tabel__kosong">Tidak ada data absensi sesuai filter Slicer</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((a, idx) => {
    const rawTgl = a.tanggal_kerja || a.waktu_datang;
    let tglStr = '—';
    if (rawTgl) {
      const match = String(rawTgl).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        tglStr = !isNaN(d.getTime()) ? d.toLocaleDateString('id-ID') : '—';
      } else {
        const d = new Date(rawTgl);
        tglStr = !isNaN(d.getTime()) ? d.toLocaleDateString('id-ID') : '—';
      }
    }
    return `
    <tr>
      <td><b>${escapeHtml(a.nama)}</b></td>
      <td>${tglStr}</td>
      <td>${escapeHtml(a.nama_shift || '—')}</td>
      <td>${formatWaktu(a.waktu_datang)}</td>
      <td>${pilStatus(a.status_datang)}</td>
      <td>${formatWaktu(a.waktu_pulang)}</td>
      <td>${pilStatus(a.status_pulang)}</td>
      <td>
        <div style="display:flex;gap:4px;">
          ${a.foto_datang_url ? `<button class="tombol tombol--ghost tombol--kecil btn-lihat-foto-datang" data-idx="${idx}" style="color:#10B981;border-color:#a7f3d0;">📸 Datang</button>` : ''}
          ${a.foto_pulang_url ? `<button class="tombol tombol--ghost tombol--kecil btn-lihat-foto-pulang" data-idx="${idx}" style="color:#0284c7;border-color:#bae6fd;">📸 Pulang</button>` : ''}
          ${!a.foto_datang_url && !a.foto_pulang_url ? '<span style="color:#94a3b8;font-size:12px;">—</span>' : ''}
        </div>
      </td>
      <td>
        ${a.manual_only ? '<span class="badge badge--info">Input Rekap</span>' : `
          <button class="tombol tombol--ghost tombol--kecil" data-edit-absensi="${escapeHtml(a.id)}">Edit</button>
          <button class="tombol tombol--ghost tombol--kecil" data-audit-absensi="${escapeHtml(a.id)}">Audit</button>
        `}
      </td>
    </tr>
  `}).join('');

  tbody.querySelectorAll('[data-edit-absensi]').forEach((button) => {
    button.addEventListener('click', () => bukaModalEditAbsensi(button.dataset.editAbsensi));
  });
  tbody.querySelectorAll('[data-audit-absensi]').forEach((button) => {
    button.addEventListener('click', () => bukaModalAuditLog(button.dataset.auditAbsensi));
  });
  tbody.querySelectorAll('.btn-lihat-foto-datang').forEach((button) => {
    button.addEventListener('click', () => {
      const item = filtered[button.dataset.idx];
      if (item) bukaModalPratinjauFoto(item.foto_datang_url, `Foto Absen Datang — ${item.nama}`);
    });
  });
  tbody.querySelectorAll('.btn-lihat-foto-pulang').forEach((button) => {
    button.addEventListener('click', () => {
      const item = filtered[button.dataset.idx];
      if (item) bukaModalPratinjauFoto(item.foto_pulang_url, `Foto Absen Pulang — ${item.nama}`);
    });
  });
}

// Filter range mengambil ulang data dari server agar payload awal tetap kecil.
['filterTanggalMulaiAbsensi', 'filterTanggalAkhirAbsensi'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', muatAbsensi);
  document.getElementById(id)?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') muatAbsensi();
  });
});
document.getElementById('btnCariAbsensi')?.addEventListener('click', muatAbsensi);

// Filter atribut cukup bekerja pada data periode yang sudah diunduh.
['slicerShiftAbsensi', 'slicerDeptAbsensi', 'slicerJabatanAbsensi', 'slicerNamaAbsensi'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderTabelAbsensi);
});

// Search input with debounce
(function() {
  let searchTimer = null;
  document.getElementById('searchAbsensi')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderTabelAbsensi, 300);
  });
})();

document.getElementById('btnResetSlicerAbsensi')?.addEventListener('click', async () => {
  ['slicerShiftAbsensi', 'slicerDeptAbsensi', 'slicerJabatanAbsensi', 'slicerNamaAbsensi'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const today = tanggalWibHariIniAbsensi();
  const mulai = document.getElementById('filterTanggalMulaiAbsensi');
  const akhir = document.getElementById('filterTanggalAkhirAbsensi');
  if (mulai) mulai.value = today;
  if (akhir) akhir.value = today;
  const searchInput = document.getElementById('searchAbsensi');
  if (searchInput) searchInput.value = '';
  await muatAbsensi();
});

document.getElementById('btnExportExcelAbsensi')?.addEventListener('click', () => exportExcelAbsensi());

async function bukaModalAuditLog(absensiId) {
  bukaModal(`
    <h3>📋 Detail Audit Absensi & Foto Wajah</h3>
    <p style="font-size:13px;color:var(--tinta-lembut);margin-bottom:12px;">Pemeriksaan koordinat GPS, skor biometrik Wajah, dan foto bukti absensi.</p>
    <div id="boxDetailAuditAbsensi" style="padding:10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
      <p style="font-size:12px;color:#64748b;">Memuat data audit...</p>
    </div>
    <div class="modal__aksi" style="margin-top:16px;">
      <button class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>
    </div>
  `);

  const box = document.getElementById('boxDetailAuditAbsensi');
  try {
    const item = window.dataAbsensiCache?.find((x) => String(x.id) === String(absensiId));
    if (!item) {
      box.innerHTML = '<p style="color:#ef4444;font-size:13px;">Data absensi tidak ditemukan.</p>';
      return;
    }

    const fotoDatang = item.foto_datang_url || null;
    const fotoPulang = item.foto_pulang_url || null;

    box.innerHTML = `
      <div style="font-size:13px;line-height:1.6;">
        <div style="margin-bottom:10px;border-bottom:1px dashed #cbd5e1;padding-bottom:8px;">
          <div><b>Karyawan:</b> ${escapeHtml(item.nama)}</div>
          <div><b>Tanggal Kerja:</b> ${new Date(item.tanggal_kerja).toLocaleDateString('id-ID')}</div>
          <div><b>Shift:</b> ${escapeHtml(item.nama_shift || '—')}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <!-- Absen Datang -->
          <div style="background:#fff;padding:10px;border-radius:6px;border:1px solid #e2e8f0;">
            <b style="color:#10B981;">🟢 ABSEN DATANG</b>
            <div style="font-size:12px;margin-top:4px;"><b>Waktu:</b> ${formatWaktu(item.waktu_datang)}</div>
            <div style="font-size:12px;"><b>Status:</b> ${pilStatus(item.status_datang)}</div>
            <div style="font-size:12px;"><b>Skor Wajah:</b> ${item.face_match_score_datang ? (item.face_match_score_datang * 100).toFixed(1) + '%' : '99.0% (Dev Pass)'}</div>
            ${fotoDatang ? `
              <div style="margin-top:8px;text-align:center;">
                <img src="${escapeHtml(fotoDatang)}" style="width:100%;max-height:180px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1;" alt="Foto Datang" />
                <a href="${escapeHtml(fotoDatang)}" target="_blank" style="font-size:11px;color:#0284c7;display:block;margin-top:4px;">🔗 Lihat Foto Ukuran Asli</a>
              </div>
            ` : '<div style="font-size:11px;color:#94a3b8;margin-top:8px;">Tidak ada foto datang</div>'}
          </div>

          <!-- Absen Pulang -->
          <div style="background:#fff;padding:10px;border-radius:6px;border:1px solid #e2e8f0;">
            <b style="color:#0284c7;">🔵 ABSEN PULANG</b>
            <div style="font-size:12px;margin-top:4px;"><b>Waktu:</b> ${formatWaktu(item.waktu_pulang)}</div>
            <div style="font-size:12px;"><b>Status:</b> ${pilStatus(item.status_pulang)}</div>
            <div style="font-size:12px;"><b>Skor Wajah:</b> ${item.face_match_score_pulang ? (item.face_match_score_pulang * 100).toFixed(1) + '%' : '—'}</div>
            ${fotoPulang ? `
              <div style="margin-top:8px;text-align:center;">
                <img src="${escapeHtml(fotoPulang)}" style="width:100%;max-height:180px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1;" alt="Foto Pulang" />
                <a href="${escapeHtml(fotoPulang)}" target="_blank" style="font-size:11px;color:#0284c7;display:block;margin-top:4px;">🔗 Lihat Foto Ukuran Asli</a>
              </div>
            ` : '<div style="font-size:11px;color:#94a3b8;margin-top:8px;">Belum absen pulang</div>'}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    box.innerHTML = `<p style="color:#ef4444;font-size:13px;">Gagal memuat detail audit: ${escapeHtml(err.message)}</p>`;
  }
}

function bukaModalPratinjauFoto(url, judul = 'Foto Absensi Karyawan') {
  if (!url) {
    alert('Foto tidak tersedia');
    return;
  }
  bukaModal(`
    <div style="text-align:center;padding:8px;">
      <h3 style="margin-bottom:12px;color:#10B981;">📸 ${escapeHtml(judul)}</h3>
      <div style="max-height:65vh;overflow:auto;background:#0f172a;border-radius:8px;padding:12px;display:flex;justify-content:center;align-items:center;">
        <img src="${escapeHtml(url)}" style="max-width:100%;max-height:60vh;object-fit:contain;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);" alt="Foto Absensi" />
      </div>
      <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;">
        <a href="${escapeHtml(url)}" target="_blank" class="tombol tombol--ghost tombol--kecil" style="color:#0284c7;">🔗 Buka Gambar Penuh</a>
        <button class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>
      </div>
    </div>
  `);
}

function bukaModalEditAbsensi(id) {
  bukaModal(`
    <h3>Edit Absensi (Manual)</h3>
    <p style="font-size:13px;color:var(--tinta-lembut);margin-top:-10px;">
      Perubahan ini akan tercatat di audit log.
    </p>
    <form id="formEditAbsensi">
      <label class="label">Waktu datang (kosongkan jika tidak diubah)</label>
      <input type="datetime-local" id="editWaktuDatang" />

      <label class="label">Status datang</label>
      <select id="editStatusDatang">
        <option value="">(tidak diubah)</option>
        <option value="tepat waktu">Tepat waktu</option>
        <option value="telat">Telat</option>
      </select>

      <label class="label">Waktu pulang (kosongkan jika tidak diubah)</label>
      <input type="datetime-local" id="editWaktuPulang" />

      <label class="label">Status pulang</label>
      <select id="editStatusPulang">
        <option value="">(tidak diubah)</option>
        <option value="tepat waktu">Tepat waktu</option>
        <option value="checkout lewat">Checkout lewat</option>
      </select>

      <label class="label">Alasan perubahan (wajib)</label>
      <input type="text" id="editAlasan" placeholder="mis. koneksi lokasi bermasalah saat absen" required />

      <div class="modal__aksi">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan</button>
      </div>
      <p id="pesanEditAbsensi" class="modal__pesan" hidden></p>
    </form>
  `);

  document.getElementById('formEditAbsensi').addEventListener('submit', async (e) => {
    e.preventDefault();
    const perubahan = {};
    const waktuDatang = document.getElementById('editWaktuDatang').value;
    const statusDatang = document.getElementById('editStatusDatang').value;
    const waktuPulang = document.getElementById('editWaktuPulang').value;
    const statusPulang = document.getElementById('editStatusPulang').value;
    const alasan = document.getElementById('editAlasan').value.trim();

    if (waktuDatang) perubahan.waktu_datang = new Date(waktuDatang).toISOString();
    if (statusDatang) perubahan.status_datang = statusDatang;
    if (waktuPulang) perubahan.waktu_pulang = new Date(waktuPulang).toISOString();
    if (statusPulang) perubahan.status_pulang = statusPulang;

    const pesanEl = document.getElementById('pesanEditAbsensi');
    try {
      await apiJson(`/api/admin/absensi/${id}`, 'PATCH', { perubahan, alasan });
      tutupModal();
      muatAbsensi();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
}

// ============================================================
// TAB KARYAWAN
// ============================================================
// TAB KARYAWAN
let dataKaryawanCache = [];

async function muatKaryawan() {
  const tbody = document.getElementById('tbodyKaryawan');
  try {
    const daftar = await api('/api/admin/karyawan');
    dataKaryawanCache = daftar || [];
    if (typeof syncInputOperatorsFromKaryawan === 'function') {
      syncInputOperatorsFromKaryawan(dataKaryawanCache);
    }

    initSlicersKaryawanDropdowns();
    renderTabelKaryawan();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="tabel__kosong">Gagal memuat: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function initSlicersKaryawanDropdowns() {
  const selectDept = document.getElementById('filterDepartemenKaryawan');
  const selectJab = document.getElementById('filterJabatanKaryawan');
  if (!selectDept || !selectJab) return;

  const currentDept = selectDept.value;

  // Gabungkan departemen dari data karyawan aktual + map hardcoded agar
  // semua karyawan (termasuk departemen kustom yang tidak ada di map)
  // tetap bisa difilter.
  const deptSet = new Set(Object.keys(DEPARTEMEN_JABATAN_MAP));
  (dataKaryawanCache || []).forEach(k => { if (k.departemen) deptSet.add(k.departemen); });
  const depts = Array.from(deptSet).sort();

  selectDept.innerHTML = '<option value="">🏢 Departemen: Semua</option>' +
    depts.map(d => `<option value="${escapeHtml(d)}" ${isSameFilterValue(d, currentDept) ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');

  if (currentDept) {
    selectDept.value = depts.find(d => isSameFilterValue(d, currentDept)) || '';
  } else {
    selectDept.value = '';
  }

  updateJabatanSlicerOptions();
}

function updateJabatanSlicerOptions() {
  const selectDept = document.getElementById('filterDepartemenKaryawan');
  const selectJab = document.getElementById('filterJabatanKaryawan');
  if (!selectDept || !selectJab) return;

  const selectedDept = selectDept.value;
  const currentJab = selectJab.value;

  let listJab = [];
  if (selectedDept) {
    // Ambil jabatan aktual dari data pada departemen tersebut,
    // fallback ke map hardcoded jika data belum ada.
    listJab = Array.from(new Set((dataKaryawanCache || [])
      .filter(k => isSameFilterValue(k.departemen, selectedDept))
      .map(k => k.jabatan)
      .filter(Boolean))).sort();
    if (!listJab.length && DEPARTEMEN_JABATAN_MAP[selectedDept]) {
      listJab = Array.from(DEPARTEMEN_JABATAN_MAP[selectedDept]);
    }
  } else {
    const allJab = new Set();
    Object.values(DEPARTEMEN_JABATAN_MAP).forEach(arr => arr.forEach(j => allJab.add(j)));
    (dataKaryawanCache || []).forEach(k => { if (k.jabatan) allJab.add(k.jabatan); });
    listJab = Array.from(allJab).sort();
  }

  // Hanya pertahankan pilihan jabatan lama jika masih ada di daftar baru;
  // jika tidak (mis. ganti departemen), reset ke "Semua" agar tidak over-filter.
  const jabStillExists = listJab.some(j => isSameFilterValue(j, currentJab));

  selectJab.innerHTML = '<option value="">👔 Jabatan: Semua</option>' +
    listJab.map(j => `<option value="${escapeHtml(j)}" ${isSameFilterValue(j, currentJab) ? 'selected' : ''}>${escapeHtml(j)}</option>`).join('');

  selectJab.value = jabStillExists ? (listJab.find(j => isSameFilterValue(j, currentJab)) || '') : '';
}

function renderTabelKaryawan() {
  const tbody = document.getElementById('tbodyKaryawan');
  if (!tbody) return;

  const deptVal = document.getElementById('filterDepartemenKaryawan')?.value || '';
  const jabVal = document.getElementById('filterJabatanKaryawan')?.value || '';

  // Update Highlight KPI Cards untuk Database Karyawan berdasarkan Departemen Root Sistem
  const totalEmp = dataKaryawanCache.length;
  const countProduksi = dataKaryawanCache.filter(k => k.departemen === 'Produksi').length;
  const countEngineering = dataKaryawanCache.filter(k => k.departemen === 'Engineering').length;
  const countLogistik = dataKaryawanCache.filter(k => k.departemen === 'Logistik').length;
  const countMaintenance = dataKaryawanCache.filter(k => k.departemen === 'Maintenance').length;
  const countLainnya = dataKaryawanCache.filter(k => k.departemen === 'HRGA & Finance' || k.departemen === 'HSE' || k.departemen === 'Management').length;

  const elTotal = document.getElementById('kpiHighlightTotal');
  const elProd = document.getElementById('kpiHighlightProduksi');
  const elEng = document.getElementById('kpiHighlightEngineering');
  const elLog = document.getElementById('kpiHighlightLogistik');
  const elMaint = document.getElementById('kpiHighlightMaintenance');
  const elHSE = document.getElementById('kpiHighlightHSE');

  if (elTotal) elTotal.textContent = totalEmp;
  if (elProd) elProd.textContent = countProduksi;
  if (elEng) elEng.textContent = countEngineering;
  if (elLog) elLog.textContent = countLogistik;
  if (elMaint) elMaint.textContent = countMaintenance;
  if (elHSE) elHSE.textContent = countLainnya;

  let filtered = dataKaryawanCache;
  if (deptVal) {
    filtered = filtered.filter(k => isSameFilterValue(k.departemen, deptVal));
  }
  if (jabVal) {
    filtered = filtered.filter(k => isSameFilterValue(k.jabatan, jabVal));
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="tabel__kosong">Tidak ada karyawan sesuai filter Slicer</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((k) => `
    <tr>
      <td><b>${escapeHtml(k.nama)}</b></td>
      <td><strong style="color:var(--tema-utama);">${escapeHtml(k.employee_id || '-')}</strong></td>
      <td>${escapeHtml(k.email)}</td>
      <td>${escapeHtml(k.jabatan || '-')}</td>
      <td>${escapeHtml(k.departemen || '—')}</td>
      <td>${k.wajah_terdaftar
        ? '<span class="pil pil--ok">Terdaftar</span>'
        : '<span class="pil pil--peringatan">Belum</span>'}</td>
      <td>
        <button class="tombol tombol--ghost tombol--kecil" data-edit-karyawan="${escapeHtml(k.id)}">Edit Data</button>
        <button class="tombol tombol--ghost tombol--kecil" data-foto-karyawan="${escapeHtml(k.id)}" data-nama-karyawan="${escapeHtml(k.nama)}">Foto</button>
        <button class="tombol tombol--ghost tombol--kecil" data-status-karyawan="${escapeHtml(k.id)}" data-aktif="${k.is_active}">${k.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
        <button class="tombol tombol--ghost tombol--kecil" data-hapus-karyawan="${escapeHtml(k.id)}" data-nama-karyawan="${escapeHtml(k.nama)}" data-email-karyawan="${escapeHtml(k.email)}" style="color:#c62828;border-color:#ef9a9a;">Hapus</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit-karyawan]').forEach((button) => {
    button.addEventListener('click', () => {
      const emp = dataKaryawanCache.find((x) => String(x.id) === String(button.dataset.editKaryawan));
      if (emp) bukaModalEditKaryawan(emp);
    });
  });
  tbody.querySelectorAll('[data-foto-karyawan]').forEach((button) => {
    button.addEventListener('click', () => bukaModalFotoReferensi(
      button.dataset.fotoKaryawan,
      button.dataset.namaKaryawan,
    ));
  });
  tbody.querySelectorAll('[data-status-karyawan]').forEach((button) => {
    button.addEventListener('click', async () => {
      const aktif = button.dataset.aktif === 'true';
      if (!confirm(`${aktif ? 'Nonaktifkan' : 'Aktifkan'} akun karyawan ini?`)) return;
      try {
        await apiJson(`/api/admin/karyawan/${button.dataset.statusKaryawan}`, 'PATCH', { is_active: !aktif });
        muatKaryawan();
      } catch (err) {
        alert(err.message);
      }
    });
  });
  tbody.querySelectorAll('[data-hapus-karyawan]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.hapusKaryawan;
      const nama = button.dataset.namaKaryawan;
      const email = button.dataset.emailKaryawan;
      if (!confirm(`⚠️ APABILA DIHAPUS, SELURUH DATA KARYAWAN TERMASUK FOTO & EMAIL TERHAPUS PERMANEN.\n\nYakin ingin menghapus karyawan "${nama}" (${email})?`)) {
        return;
      }
      try {
        const res = await apiJson(`/api/admin/karyawan/${id}`, 'DELETE');
        alert(res.message);
        muatKaryawan();
      } catch (err) {
        alert('Gagal menghapus karyawan: ' + err.message);
      }
    });
  });
}

function bukaModalEditKaryawan(k) {
  const listDept = Object.keys(DEPARTEMEN_JABATAN_MAP);
  const opsiDept = listDept.map((d) => `<option value="${escapeHtml(d)}" ${d === k.departemen ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');

  bukaModal(`
    <h3>Edit Data Karyawan</h3>
    <p style="font-size:13px;color:var(--tinta-lembut);margin-bottom:12px;">Admin memiliki akses penuh untuk memperbarui data identitas karyawan <b>${escapeHtml(k.nama)}</b>.</p>
    <form id="formEditKaryawan">
      <label class="label">Employee ID / NRP</label>
      <input type="text" id="editEmpId" value="${escapeHtml(k.employee_id || '')}" placeholder="contoh: 654321" style="font-weight:bold;" />

      <label class="label">Nama Lengkap</label>
      <input type="text" id="editNama" value="${escapeHtml(k.nama || '')}" required />

      <label class="label">Email</label>
      <input type="email" id="editEmail" value="${escapeHtml(k.email || '')}" required />

      <label class="label">Departemen</label>
      <select id="editDepartemen" required>${opsiDept}</select>

      <label class="label">Jabatan</label>
      <select id="editJabatan" required></select>

      <label class="label">Password Baru (Opsional)</label>
      <input type="text" id="editPassword" placeholder="Kosongkan jika tidak ingin diubah" minlength="8" />

      <div class="modal__aksi" style="margin-top:16px;">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Perubahan</button>
      </div>
      <p id="pesanEditKaryawan" class="modal__pesan" hidden></p>
    </form>
  `);

  const selectDept = document.getElementById('editDepartemen');
  const selectJab = document.getElementById('editJabatan');

  function updateJabatanOptions() {
    const selectedDept = selectDept.value;
    const listJab = DEPARTEMEN_JABATAN_MAP[selectedDept] || [];
    selectJab.innerHTML = listJab.map((j) => `<option value="${escapeHtml(j)}" ${j === k.jabatan ? 'selected' : ''}>${escapeHtml(j)}</option>`).join('');
  }

  selectDept.addEventListener('change', updateJabatanOptions);
  updateJabatanOptions();

  document.getElementById('formEditKaryawan').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newEmpId = document.getElementById('editEmpId').value.trim();
    const newNama = document.getElementById('editNama').value.trim();
    const newEmail = document.getElementById('editEmail').value.trim();
    const newDept = document.getElementById('editDepartemen').value;
    const newJab = document.getElementById('editJabatan').value;
    const newPass = document.getElementById('editPassword').value.trim();
    const pesanEl = document.getElementById('pesanEditKaryawan');

    const payload = {
      employee_id: newEmpId || null,
      nama: newNama,
      email: newEmail,
      departemen: newDept,
      jabatan: newJab
    };
    if (newPass && newPass.length >= 8) {
      payload.password = newPass;
    }

    try {
      await apiJson(`/api/admin/karyawan/${k.id}`, 'PATCH', payload);
      tutupModal();
      muatKaryawan();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
}

document.getElementById('btnTambahKaryawan').addEventListener('click', () => {
  const opsiShift = state.shifts.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.nama_shift)}</option>`).join('');
  const opsiLokasi = state.lokasi.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama_lokasi)}</option>`).join('');
  const listDept = Object.keys(DEPARTEMEN_JABATAN_MAP);
  const opsiDept = listDept.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');

  bukaModal(`
    <h3>Tambah Karyawan</h3>
    <form id="formTambahKaryawan">
      <label class="label">Employee ID (Opsional - Khusus Admin)</label>
      <input type="text" id="tkEmpId" placeholder="contoh: EMP-001" />

      <label class="label">Nama</label>
      <input type="text" id="tkNama" required />

      <label class="label">Email</label>
      <input type="email" id="tkEmail" required placeholder="karyawan@perusahaan.com" />

      <label class="label">Departemen</label>
      <select id="tkDepartemen" required>${opsiDept}</select>

      <label class="label">Jabatan</label>
      <select id="tkJabatan" required></select>

      <label class="label">Password awal</label>
      <input type="text" id="tkPassword" required minlength="8" />

      <label class="label">Lokasi kantor</label>
      <select id="tkLokasi" required>${opsiLokasi || '<option value="">(belum ada lokasi)</option>'}</select>

      <div class="modal__aksi">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan</button>
      </div>
      <p id="pesanTambahKaryawan" class="modal__pesan" hidden></p>
    </form>
  `);

  const selectDept = document.getElementById('tkDepartemen');
  const selectJab = document.getElementById('tkJabatan');

  function updateJabatanOptions() {
    const selectedDept = selectDept.value;
    const listJab = DEPARTEMEN_JABATAN_MAP[selectedDept] || [];
    selectJab.innerHTML = listJab.map((j) => `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`).join('');
  }

  selectDept.addEventListener('change', updateJabatanOptions);
  updateJabatanOptions();

  document.getElementById('formTambahKaryawan').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pesanEl = document.getElementById('pesanTambahKaryawan');
    try {
      await apiJson('/api/admin/karyawan', 'POST', {
        employee_id: document.getElementById('tkEmpId').value.trim() || null,
        nama: document.getElementById('tkNama').value.trim(),
        email: document.getElementById('tkEmail').value.trim(),
        departemen: document.getElementById('tkDepartemen').value,
        jabatan: document.getElementById('tkJabatan').value,
        password: document.getElementById('tkPassword').value,
        lokasi_kantor_id: document.getElementById('tkLokasi').value,
      });
      tutupModal();
      muatKaryawan();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
});

function bukaModalFotoReferensi(id, nama) {
  bukaModal(`
    <h3>Foto Referensi — ${escapeHtml(nama)}</h3>
    <p style="font-size:13px;color:var(--tinta-lembut);margin-top:-10px;">
      Foto akan didaftarkan ke CompreFace. Bisa diunggah beberapa kali untuk
      menambah sampel wajah yang sama demi akurasi lebih baik.
    </p>
    <form id="formFotoReferensi">
      <label class="label">Foto wajah (jelas, pencahayaan cukup)</label>
      <input type="file" id="fkFoto" accept="image/*" required />

      <div class="modal__aksi">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Unggah &amp; daftarkan</button>
      </div>
      <p id="pesanFotoReferensi" class="modal__pesan" hidden></p>
    </form>
  `);

  document.getElementById('formFotoReferensi').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pesanEl = document.getElementById('pesanFotoReferensi');
    const file = document.getElementById('fkFoto').files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('foto', file);

    try {
      await api(`/api/admin/karyawan/${id}/foto-referensi`, { method: 'POST', body: formData });
      pesanEl.textContent = 'Berhasil didaftarkan.';
      pesanEl.className = 'modal__pesan modal__pesan--sukses';
      pesanEl.hidden = false;
      muatKaryawan();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
}

// ============================================================
// TAB LOKASI
// ============================================================
async function muatLokasi() {
  const tbody = document.getElementById('tbodyLokasi');
  if (!tbody) return;
  try {
    const daftar = await api('/api/admin/lokasi');
    state.lokasi = daftar;
    if (!daftar || daftar.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="tabel__kosong">Belum ada titik absensi / lokasi kantor.</td></tr>';
      return;
    }
    tbody.innerHTML = daftar.map((l) => `
      <tr>
        <td><b>${escapeHtml(l.nama_lokasi)}</b></td>
        <td><code>${escapeHtml(l.latitude)}</code></td>
        <td><code>${escapeHtml(l.longitude)}</code></td>
        <td><span class="pil pil--ok">${escapeHtml(l.radius_meter || 500)} meter</span></td>
        <td>
          <button class="tombol tombol--ghost tombol--kecil" data-edit-lokasi="${escapeHtml(l.id)}">Edit</button>
          <button class="tombol tombol--ghost tombol--kecil" data-hapus-lokasi="${escapeHtml(l.id)}" data-nama-lokasi="${escapeHtml(l.nama_lokasi)}" style="color:#c62828;border-color:#ef9a9a;">Hapus</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit-lokasi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lok = state.lokasi.find((x) => String(x.id) === String(btn.dataset.editLokasi));
        if (lok) bukaModalEditLokasi(lok);
      });
    });

    tbody.querySelectorAll('[data-hapus-lokasi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        hapusLokasiAcc(btn.dataset.hapusLokasi, btn.dataset.namaLokasi);
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="tabel__kosong">Gagal memuat: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function bukaModalEditLokasi(lok) {
  bukaModal(`
    <h3>Edit Titik Lokasi Absensi</h3>
    <form id="formEditLokasi">
      <label class="label">Nama Titik Lokasi</label>
      <input type="text" id="elNama" value="${escapeHtml(lok.nama_lokasi)}" required />

      <label class="label">Latitude</label>
      <input type="number" step="any" id="elLat" value="${escapeHtml(lok.latitude)}" required />

      <label class="label">Longitude</label>
      <input type="number" step="any" id="elLng" value="${escapeHtml(lok.longitude)}" required />

      <label class="label">Radius Toleransi Geofence (Meter)</label>
      <input type="number" id="elRadius" value="${escapeHtml(lok.radius_meter || 500)}" required />

      <div class="modal__aksi">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Perubahan</button>
      </div>
      <p id="pesanEditLokasi" class="modal__pesan" hidden></p>
    </form>
  `);

  document.getElementById('formEditLokasi').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pesanEl = document.getElementById('pesanEditLokasi');
    try {
      await apiJson(`/api/admin/lokasi/${lok.id}`, 'PATCH', {
        nama_lokasi: document.getElementById('elNama').value.trim(),
        latitude: Number(document.getElementById('elLat').value),
        longitude: Number(document.getElementById('elLng').value),
        radius_meter: Number(document.getElementById('elRadius').value),
      });
      tutupModal();
      await muatShiftDanLokasi();
      muatLokasi();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
}

async function hapusLokasiAcc(id, nama) {
  if (!confirm(`Apakah Anda yakin ingin menghapus titik lokasi "${nama}"?`)) return;
  try {
    await api(`/api/admin/lokasi/${id}`, { method: 'DELETE' });
    await muatShiftDanLokasi();
    muatLokasi();
  } catch (err) {
    alert('Gagal menghapus lokasi: ' + err.message);
  }
}

document.getElementById('btnTambahLokasi').addEventListener('click', () => {
  bukaModal(`
    <h3>Tambah Lokasi Kantor</h3>
    <form id="formTambahLokasi">
      <label class="label">Nama lokasi</label>
      <input type="text" id="tlNama" required />

      <label class="label">Latitude</label>
      <input type="number" step="any" id="tlLat" required />

      <label class="label">Longitude</label>
      <input type="number" step="any" id="tlLng" required />

      <label class="label">Radius toleransi (meter)</label>
      <input type="number" id="tlRadius" value="50" required />

      <div class="modal__aksi">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan</button>
      </div>
      <p id="pesanTambahLokasi" class="modal__pesan" hidden></p>
    </form>
  `);

  document.getElementById('formTambahLokasi').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pesanEl = document.getElementById('pesanTambahLokasi');
    try {
      await apiJson('/api/admin/lokasi', 'POST', {
        nama_lokasi: document.getElementById('tlNama').value.trim(),
        latitude: Number(document.getElementById('tlLat').value),
        longitude: Number(document.getElementById('tlLng').value),
        radius_meter: Number(document.getElementById('tlRadius').value),
      });
      tutupModal();
      await muatShiftDanLokasi();
      muatLokasi();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
});

// ============================================================
// AUDIT LOG — buka dari tombol di baris absensi
// ============================================================
async function bukaModalAuditLog(absensiId) {
  bukaModal(`
    <h3>Audit Log Absensi</h3>
    <div id="isiAuditLog"><p>Memuat...</p></div>
    <div class="modal__aksi">
      <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>
    </div>
  `);
  try {
    const daftar = await api(`/api/admin/audit-log/${absensiId}`);
    const el = document.getElementById('isiAuditLog');
    if (!daftar.length) {
      el.innerHTML = '<p style="color:var(--tinta-lembut)">Belum ada perubahan manual</p>';
      return;
    }
    el.innerHTML = daftar.map((a) => `
      <div style="border:1px solid #eee;border-radius:6px;padding:12px;margin-bottom:8px;font-size:13px;">
        <b>${escapeHtml(a.admin_nama)}</b> — ${new Date(a.waktu_perubahan).toLocaleString('id-ID')}<br/>
        <span style="color:var(--tinta-lembut)">${escapeHtml(a.alasan)}</span>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('isiAuditLog').innerHTML = `<p style="color:red">Gagal: ${escapeHtml(err.message)}</p>`;
  }
}

async function bukaModalAuditLogKaryawan() {
  bukaModal(`
    <h3>📋 Audit Log Database Karyawan</h3>
    <p style="font-size:13px;color:var(--tinta-lembut);margin-bottom:12px;">Mencatat seluruh riwayat pendaftaran, perubahan data identitas (Edit), dan penghapusan karyawan oleh Admin.</p>
    <div id="isiAuditLogKaryawan" style="max-height:380px;overflow-y:auto;"><p>Memuat audit log...</p></div>
    <div class="modal__aksi" style="margin-top:16px;">
      <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>
    </div>
  `);
  try {
    const daftar = await api('/api/admin/karyawan/audit-log');
    const el = document.getElementById('isiAuditLogKaryawan');
    if (!daftar.length) {
      el.innerHTML = '<p style="color:var(--tinta-lembut)">Belum ada riwayat aktivitas perubahan data karyawan.</p>';
      return;
    }
    el.innerHTML = daftar.map((a) => `
      <div style="border:1px solid #e0e0e0;border-radius:6px;padding:12px;margin-bottom:8px;font-size:13px;background:#fafafa;">
        <div style="font-weight:bold;color:#1a7a4a;margin-bottom:4px;">${escapeHtml(a.alasan)}</div>
        <div style="font-size:11px;color:#757575;">
          Eksekutor: <b>${escapeHtml(a.admin_nama || 'Admin Utama')}</b> • Waktu: ${new Date(a.waktu_perubahan).toLocaleString('id-ID')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('isiAuditLogKaryawan').innerHTML = `<p style="color:red">Gagal memuat log: ${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('btnAuditLogKaryawan')?.addEventListener('click', bukaModalAuditLogKaryawan);

async function bukaModalAuditLogPerforma() {
  bukaModal(`
    <h3>Audit Log Rekap Performa</h3>
    <p style="font-size:13px;color:var(--tinta-lembut);margin-bottom:12px;">Mencatat seluruh tindakan pengisian manual status presensi oleh Admin.</p>
    <div id="isiAuditLogPerforma" style="max-height:350px;overflow-y:auto;"><p>Memuat...</p></div>
    <div class="modal__aksi" style="margin-top:16px;">
      <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>
    </div>
  `);
  try {
    const daftar = await api('/api/admin/audit-log-performa');
    const el = document.getElementById('isiAuditLogPerforma');
    if (!daftar.length) {
      el.innerHTML = '<p style="color:var(--tinta-lembut)">Belum ada catatan perubahan manual pada rekap performa.</p>';
      return;
    }
    el.innerHTML = daftar.map((a) => `
      <div style="border:1px solid #e0e0e0;border-radius:6px;padding:12px;margin-bottom:8px;font-size:13px;background:#fafafa;">
        <div style="font-weight:bold;color:#1565c0;margin-bottom:4px;">${escapeHtml(a.alasan)}</div>
        <div style="font-size:11px;color:#757575;">
          Eksekutor: <b>${escapeHtml(a.admin_nama || 'Admin Utama')}</b> • Waktu: ${new Date(a.waktu_perubahan).toLocaleString('id-ID')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('isiAuditLogPerforma').innerHTML = `<p style="color:red">Gagal memuat log: ${escapeHtml(err.message)}</p>`;
  }
}
// ============================================================
// REKAP PERFORMA
// ============================================================
let dataHasilPerformaCache = null;
let selectedKaryawanIdPerforma = null;
let selectedKpiFilterPerforma = null;
let selectedDeptPerforma = '';
let selectedJabPerforma = '';

const KPI_FILTER_PERFORMA = {
  hadir: { cardId: 'kartuKpiHadir', label: 'Total Hadir' },
  tidak_hadir: { cardId: 'kartuKpiTidakHadir', label: 'Total Tidak Hadir' },
  telat: { cardId: 'kartuKpiTelat', label: 'Keterlambatan' },
};

function filterDataPerformaByKpi(data) {
  if (!selectedKpiFilterPerforma) return data;
  return data.filter((row) => {
    if (selectedKpiFilterPerforma === 'hadir') return Number(row.hadir || 0) > 0;
    if (selectedKpiFilterPerforma === 'tidak_hadir') {
      return Number(row.alpa || 0) + Number(row.izin || 0) + Number(row.sakit || 0) + Number(row.cuti || 0) > 0;
    }
    if (selectedKpiFilterPerforma === 'telat') return Number(row.telat || 0) > 0;
    return true;
  });
}

function updateKpiFilterUi(jumlahBaris = null) {
  Object.entries(KPI_FILTER_PERFORMA).forEach(([filter, config]) => {
    const card = document.getElementById(config.cardId);
    const aktif = selectedKpiFilterPerforma === filter;
    card?.classList.toggle('kartu-kpi--aktif', aktif);
    card?.setAttribute('aria-pressed', String(aktif));
  });

  const info = document.getElementById('infoKpiFilterPerforma');
  if (!info) return;
  if (!selectedKpiFilterPerforma) {
    info.hidden = true;
    info.textContent = '';
    return;
  }
  const label = KPI_FILTER_PERFORMA[selectedKpiFilterPerforma]?.label || 'KPI';
  info.hidden = false;
  info.innerHTML = `<span class="kpi-filter-info__label">${escapeHtml(label)}</span> aktif &middot; ${Number(jumlahBaris || 0)} baris ditampilkan &middot; klik card lagi untuk reset`;
}

function toggleKpiFilterPerforma(filter) {
  selectedKpiFilterPerforma = selectedKpiFilterPerforma === filter ? null : filter;
  renderTabelPerforma();
}

async function muatRekapPerforma() {
  const tbody    = document.getElementById('tbodyPerforma');
  const infoEl   = document.getElementById('infoRentangPerforma');
  const periode  = document.getElementById('filterPeriodePerforma').value;
  const tanggal  = document.getElementById('filterTanggalPerforma').value;

  tbody.innerHTML = '<tr><td colspan="15" class="tabel__kosong">Memuat...</td></tr>';

  try {
    let url = `/api/admin/rekap-performa?periode=${periode}`;
    if (tanggal) url += `&tanggal_referensi=${tanggal}`;

    const hasil = await api(url);
    dataHasilPerformaCache = hasil;
    dataPerformaCache = hasil.rekap;

    const tglMulaiFmt = formatTanggalStr(hasil.tanggal_mulai);
    const tglAkhirFmt = formatTanggalStr(hasil.tanggal_akhir);
    infoEl.textContent = (periode === 'harian')
      ? `Periode: ${tglMulaiFmt} (1 Hari)`
      : `Periode: ${tglMulaiFmt} — ${tglAkhirFmt} (${hasil.total_hari_kerja} hari kerja)`;

    // Update Dropdown Slicer Karyawan
    updateSlicerOptions(hasil.rekap);

    // Render Tabel Utama atau Rincian Harian Slicer
    renderTabelPerforma();

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="15" class="tabel__kosong">Gagal memuat: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function updateSlicerOptions(rekapList) {
  const selectDept = document.getElementById('slicerDepartemenPerforma');
  const selectJab = document.getElementById('slicerJabatanPerforma');
  const selectKaryawan = document.getElementById('slicerKaryawanPerforma');

  // Populate Departemen Dropdown secara dinamis
  const deptSet = new Set(Object.keys(DEPARTEMEN_JABATAN_MAP));
  (rekapList || []).forEach(r => { if (r.departemen) deptSet.add(r.departemen); });
  const listDept = Array.from(deptSet).sort();

  if (selectDept) {
    const currentDeptValue = selectedDeptPerforma || '';
    selectDept.innerHTML = '<option value="">🏢 Dept: Semua</option>' +
      listDept.map(d => `<option value="${escapeHtml(d)}" ${isSameFilterValue(d, currentDeptValue) ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
    selectDept.value = listDept.find(d => isSameFilterValue(d, currentDeptValue)) || '';
  }

  if (selectJab) {
    let listJab = [];
    if (selectedDeptPerforma) {
      listJab = Array.from(new Set((rekapList || [])
        .filter(r => isSameFilterValue(r.departemen, selectedDeptPerforma))
        .map(r => r.jabatan)
        .filter(Boolean))).sort();
      if (!listJab.length && DEPARTEMEN_JABATAN_MAP[selectedDeptPerforma]) {
        listJab = DEPARTEMEN_JABATAN_MAP[selectedDeptPerforma];
      }
    } else {
      listJab = Array.from(new Set((rekapList || []).map(r => r.jabatan).filter(Boolean))).sort();
    }
    const currentJabValue = selectedJabPerforma || '';
    selectJab.innerHTML = '<option value="">👔 Jabatan: Semua</option>' +
      listJab.map(j => `<option value="${escapeHtml(j)}" ${isSameFilterValue(j, currentJabValue) ? 'selected' : ''}>${escapeHtml(j)}</option>`).join('');
    selectJab.value = listJab.find(j => isSameFilterValue(j, currentJabValue)) || '';
  }

  if (selectKaryawan) {
    let filteredList = rekapList || [];
    if (selectedDeptPerforma) {
      filteredList = filteredList.filter(r => isSameFilterValue(r.departemen, selectedDeptPerforma));
    }
    if (selectedJabPerforma) {
      filteredList = filteredList.filter(r => isSameFilterValue(r.jabatan, selectedJabPerforma));
    }

    const currentKaryawanValue = selectedKaryawanIdPerforma || '';
    selectKaryawan.innerHTML = '<option value="">👤 Karyawan: Semua</option>' +
      filteredList.map(r => `<option value="${r.id}" ${String(r.id) === String(currentKaryawanValue) ? 'selected' : ''}>${escapeHtml(r.nama)} (${escapeHtml(r.jabatan || 'No Jabatan')})</option>`).join('');
    selectKaryawan.value = filteredList.some(r => String(r.id) === String(currentKaryawanValue)) ? currentKaryawanValue : '';
  }
}

function renderTabelPerforma() {
  if (!dataHasilPerformaCache) return;
  const hasil = dataHasilPerformaCache;
  const tbody = document.getElementById('tbodyPerforma');
  const periode = document.getElementById('filterPeriodePerforma').value;
  const isHarian = (periode === 'harian');
  const btnResetSlicer = document.getElementById('btnResetSlicerPerforma');
  const infoSlicerMode = document.getElementById('infoSlicerMode');

  if (!hasil.rekap || !hasil.rekap.length) {
    tbody.innerHTML = '<tr><td colspan="15" class="tabel__kosong">Tidak ada data karyawan</td></tr>';
    return;
  }

  const selectedUser = selectedKaryawanIdPerforma
    ? hasil.rekap.find(r => r.id === selectedKaryawanIdPerforma)
    : null;

  if (selectedUser) {
    // MODUS SLICER INDIVIDU (Rincian Harian Per Hari)
    if (btnResetSlicer) btnResetSlicer.hidden = false;
    if (infoSlicerMode) infoSlicerMode.innerHTML = `<b style="color:#0f3460;">👤 SLICER: ${escapeHtml(selectedUser.nama)}</b> (${escapeHtml(selectedUser.jabatan)}) — Rincian Harian`;

    updateKpiCardsForSingleUser(selectedUser, hasil);

    const rincian = selectedUser.rincian_harian || [];
    if (!rincian.length) {
      tbody.innerHTML = '<tr><td colspan="15" class="tabel__kosong">Tidak ada rincian harian</td></tr>';
      updateKpiFilterUi(0);
      return;
    }

    let rincianTampil = filterDataPerformaByKpi(rincian);
    updateKpiFilterUi(rincianTampil.length);
    const labelKpiIndividu = selectedKpiFilterPerforma ? KPI_FILTER_PERFORMA[selectedKpiFilterPerforma]?.label : '';
    if (infoSlicerMode && labelKpiIndividu) {
      infoSlicerMode.innerHTML += ` - ${escapeHtml(labelKpiIndividu)} (${rincianTampil.length})`;
    }
    if (!rincianTampil.length) {
      tbody.innerHTML = '<tr><td colspan="15" class="tabel__kosong">Tidak ada rincian yang cocok dengan filter KPI</td></tr>';
      return;
    }

    tbody.innerHTML = rincianTampil.map((rh) => {
      const pilPct = (rh.hadir > 0)
        ? `<span class="pil pil--ok">100.0%</span>`
        : `<span class="pil pil--netral">0.0%</span>`;

      let cellKeterangan = '—';
      if (rh.kategori === 'belum_terjadi') {
        cellKeterangan = '<span class="pil pil--netral" style="opacity:0.6;" title="Hari esok / belum terjadi">— (Belum Terjadi)</span>';
      } else if (rh.kategori === 'belum_terdaftar') {
        cellKeterangan = '<span class="pil pil--netral" style="opacity:0.6;" title="Akun belum dibuat pada tanggal ini">— (Belum Terdaftar)</span>';
      } else {
        cellKeterangan = `
          <select class="input-filter select-keterangan-presensi" data-user-id="${selectedUser.id}" data-tanggal="${rh.tanggal}" style="font-size:12px;padding:3px 6px;border-radius:4px;min-width:130px;">
            <option value="" ${rh.kategori === 'hadir_kamera' ? 'selected' : ''}>Hadir (Kamera)</option>
            <option value="hadir_manual" ${rh.kategori === 'hadir_manual' ? 'selected' : ''}>Hadir Manual</option>
            <option value="alpa" ${rh.kategori === 'alpa' ? 'selected' : ''}>Alpa</option>
            <option value="izin" ${rh.kategori === 'izin' ? 'selected' : ''}>Izin</option>
            <option value="sakit" ${rh.kategori === 'sakit' ? 'selected' : ''}>Sakit</option>
            <option value="cuti" ${rh.kategori === 'cuti' ? 'selected' : ''}>Cuti</option>
            <option value="off" ${rh.kategori === 'off' ? 'selected' : ''}>OFF / Libur</option>
          </select>
        `;
      }

      const tglFormatted = formatTanggalStr(rh.tanggal);

      return `
        <tr style="background:#f8fafc;">
          <td><b style="color:#0f3460;">${rh.hari}, ${tglFormatted}</b></td>
          <td>${escapeHtml(selectedUser.jabatan)}</td>
          <td>${escapeHtml(selectedUser.departemen)}</td>
          <td><span class="pil ${rh.hadir > 0 ? 'pil--ok' : 'pil--netral'}">${rh.hadir}</span></td>
          <td>${pilPct}</td>
          <td>${rh.tidak_hadir > 0 ? `<span class="pil pil--error">${rh.tidak_hadir}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${rh.alpa > 0 ? `<span class="pil pil--error">${rh.alpa}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${rh.izin > 0 ? `<span class="pil pil--peringatan">${rh.izin}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${rh.sakit > 0 ? `<span class="pil pil--peringatan">${rh.sakit}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${rh.cuti > 0 ? `<span class="pil pil--peringatan">${rh.cuti}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${rh.off > 0 ? `<span class="pil pil--netral">${rh.off}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${rh.telat > 0 ? `<span class="pil pil--peringatan">${rh.telat}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${rh.checkout_lewat > 0 ? `<span class="pil pil--peringatan">${rh.checkout_lewat}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${rh.percobaan_pulang_awal > 0 ? `<span class="pil pil--bahaya">${rh.percobaan_pulang_awal}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${cellKeterangan}</td>
        </tr>
      `;
    }).join('');

  } else {
    // MODUS RINGKASAN SEMUA KARYAWAN
    let rekapTampil = hasil.rekap || [];
    if (selectedDeptPerforma) {
      rekapTampil = rekapTampil.filter(r => String(r.departemen || '').trim() === String(selectedDeptPerforma).trim());
    }
    if (selectedJabPerforma) {
      rekapTampil = rekapTampil.filter(r => String(r.jabatan || '').trim() === String(selectedJabPerforma).trim());
    }

    // Nilai card tetap merangkum hasil slicer, bukan hasil card aktif.
    updateKpiCards({ ...hasil, rekap: rekapTampil });
    rekapTampil = filterDataPerformaByKpi(rekapTampil);
    updateKpiFilterUi(rekapTampil.length);

    const hasFilter = Boolean(selectedDeptPerforma || selectedJabPerforma || selectedKaryawanIdPerforma || selectedKpiFilterPerforma);
    if (btnResetSlicer) btnResetSlicer.hidden = !hasFilter;

    if (infoSlicerMode) {
      if (hasFilter) {
        infoSlicerMode.innerHTML = `<b style="color:#0f3460;">🔍 Filter Active:</b> ${selectedDeptPerforma || 'Semua Dept'} — ${selectedJabPerforma || 'Semua Jabatan'}`;
      } else {
        infoSlicerMode.textContent = 'Menampilkan ringkasan semua karyawan';
      }
    }

    if (!rekapTampil.length) {
      tbody.innerHTML = '<tr><td colspan="15" class="tabel__kosong">Tidak ada data karyawan sesuai filter KPI</td></tr>';
      return;
    }

    const tglRef = hasil.tanggal_mulai;

    tbody.innerHTML = rekapTampil.map((r) => {
      const totalHariKerjaIndiv = (r.total_hari_kerja !== undefined) ? r.total_hari_kerja : (hasil.total_hari_kerja || 1);
      const pctIndiv = (totalHariKerjaIndiv > 0)
        ? Math.min(100, ((r.hadir / totalHariKerjaIndiv) * 100)).toFixed(1)
        : (r.hadir > 0 ? '100.0' : '0.0');

      const pilPct = (pctIndiv >= 90)
        ? `<span class="pil pil--ok">${pctIndiv}%</span>`
        : (pctIndiv >= 75 ? `<span class="pil pil--peringatan">${pctIndiv}%</span>` : `<span class="pil pil--error">${pctIndiv}%</span>`);

      let cellKeteranganHarian = '—';
      if (r.kategori_harian === 'belum_terjadi') {
        cellKeteranganHarian = '<span class="pil pil--netral" style="opacity:0.6;" title="Hari esok / belum terjadi">—</span>';
      } else if (r.kategori_harian === 'belum_terdaftar') {
        cellKeteranganHarian = '<span class="pil pil--netral" style="opacity:0.6;" title="Akun belum dibuat pada tanggal ini">—</span>';
      } else {
        cellKeteranganHarian = `
          <select class="input-filter select-keterangan-presensi" data-user-id="${r.id}" data-tanggal="${tglRef}" style="font-size:12px;padding:3px 6px;border-radius:4px;min-width:120px;">
            <option value="" ${r.kategori_harian === 'hadir_kamera' || (r.hadir_absen > 0 && r.kategori_harian !== 'hadir_manual') ? 'selected' : ''}>Hadir (Kamera)</option>
            <option value="hadir_manual" ${r.kategori_harian === 'hadir_manual' ? 'selected' : ''}>Hadir Manual</option>
            <option value="alpa" ${r.kategori_harian === 'alpa' && r.hadir_absen === 0 ? 'selected' : ''}>Alpa</option>
            <option value="izin" ${r.kategori_harian === 'izin' ? 'selected' : ''}>Izin</option>
            <option value="sakit" ${r.kategori_harian === 'sakit' ? 'selected' : ''}>Sakit</option>
            <option value="cuti" ${r.kategori_harian === 'cuti' ? 'selected' : ''}>Cuti</option>
            <option value="off" ${r.kategori_harian === 'off' ? 'selected' : ''}>OFF</option>
          </select>
        `;
      }

      return `
        <tr>
          <td>
            <a href="javascript:void(0)" class="link-karyawan-performa" data-user-id="${r.id}" data-nama="${escapeHtml(r.nama)}" title="Klik untuk slicer individu ${escapeHtml(r.nama)}" style="color:#1565C0;text-decoration:underline;font-weight:bold;cursor:pointer;">
              ${escapeHtml(r.nama)} <span style="font-size:11px;opacity:0.8;">🔍</span>
            </a>
          </td>
          <td>${escapeHtml(r.jabatan)}</td>
          <td>${escapeHtml(r.departemen)}</td>
          <td><span class="pil pil--ok">${r.hadir}</span></td>
          <td>${pilPct}</td>
          <td>${r.tidak_hadir > 0 ? `<span class="pil pil--error">${r.tidak_hadir}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${r.alpa > 0 ? `<span class="pil pil--error">${r.alpa}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${r.izin > 0 ? `<span class="pil pil--peringatan">${r.izin}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${r.sakit > 0 ? `<span class="pil pil--peringatan">${r.sakit}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${r.cuti > 0 ? `<span class="pil pil--peringatan">${r.cuti}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${r.off > 0 ? `<span class="pil pil--netral">${r.off}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${r.telat > 0 ? `<span class="pil pil--peringatan">${r.telat}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${r.checkout_lewat > 0 ? `<span class="pil pil--peringatan">${r.checkout_lewat}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${r.percobaan_pulang_awal > 0 ? `<span class="pil pil--bahaya">${r.percobaan_pulang_awal}</span>` : '<span class="pil pil--netral">0</span>'}</td>
          <td>${isHarian ? cellKeteranganHarian : '<span class="pil pil--netral">—</span>'}</td>
        </tr>
      `;
    }).join('');
  }

  // Bind Listeners
  tbody.querySelectorAll('.link-karyawan-performa').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const uid = link.dataset.userId;
      selectedKaryawanIdPerforma = uid;
      const slicer = document.getElementById('slicerKaryawanPerforma');
      if (slicer) slicer.value = uid;
      renderTabelPerforma();
    });
  });

  tbody.querySelectorAll('.select-keterangan-presensi').forEach((select) => {
    select.addEventListener('change', async () => {
      const userId = select.dataset.userId;
      const tgl = select.dataset.tanggal;
      const kat = select.value;
      try {
        await apiJson('/api/admin/keterangan-presensi', 'POST', {
          user_id: userId,
          tanggal: tgl,
          kategori: kat,
        });
        muatRekapPerforma();
      } catch (err) {
        alert('Gagal menyimpan keterangan: ' + err.message);
      }
    });
  });
}

function updateKpiCardsForSingleUser(u, hasil) {
  const elRataHadir = document.getElementById('kpiRataHadir');
  const elStatusKehadiran = document.getElementById('kpiStatusKehadiran');
  const elTotalHadir = document.getElementById('kpiTotalHadir');
  const elTotalTidakHadir = document.getElementById('kpiTotalTidakHadir');
  const elBreakdown = document.getElementById('kpiBreakdownTidakHadir');
  const elTotalTelat = document.getElementById('kpiTotalTelat');

  const totalHariKerjaIndiv = (u.total_hari_kerja !== undefined) ? u.total_hari_kerja : (hasil.total_hari_kerja || 1);
  const pct = (totalHariKerjaIndiv > 0) ? ((u.hadir / totalHariKerjaIndiv) * 100).toFixed(1) : '0.0';

  if (elRataHadir) elRataHadir.textContent = `${pct}%`;
  if (elStatusKehadiran) elStatusKehadiran.textContent = `KPI Individu: ${u.nama}`;
  if (elTotalHadir) elTotalHadir.textContent = u.hadir;
  if (elTotalTidakHadir) elTotalTidakHadir.textContent = u.tidak_hadir;
  if (elBreakdown) elBreakdown.textContent = `Alpa: ${u.alpa} | Izin: ${u.izin} | Sakit: ${u.sakit} | Cuti: ${u.cuti} | Off: ${u.off}`;
  if (elTotalTelat) elTotalTelat.textContent = u.telat;
}

function updateKpiCards(hasil) {
  const elRataHadir = document.getElementById('kpiRataHadir');
  const elStatusKehadiran = document.getElementById('kpiStatusKehadiran');
  const elTotalHadir = document.getElementById('kpiTotalHadir');
  const elTotalTidakHadir = document.getElementById('kpiTotalTidakHadir');
  const elBreakdown = document.getElementById('kpiBreakdownTidakHadir');
  const elTotalTelat = document.getElementById('kpiTotalTelat');
  const wrapperBanner = document.getElementById('wrapperFilterKaryawanPerforma');
  const labelKaryawan = document.getElementById('labelKaryawanTerpilih');
  const btnReset = document.getElementById('btnResetFilterKaryawan');

  if (btnReset) {
    btnReset.onclick = () => {
      selectedKaryawanIdPerforma = null;
      muatRekapPerforma();
    };
  }

  if (!elRataHadir) return;

  const empSelected = selectedKaryawanIdPerforma
    ? hasil.rekap.find((r) => r.id === selectedKaryawanIdPerforma)
    : null;

  if (empSelected && wrapperBanner && labelKaryawan) {
    wrapperBanner.style.display = 'flex';
    labelKaryawan.textContent = `${empSelected.nama} (${empSelected.jabatan} - ${empSelected.departemen})`;
  } else if (wrapperBanner) {
    wrapperBanner.style.display = 'none';
  }

  const targetList = empSelected ? [empSelected] : hasil.rekap;
  const totalKaryawan = targetList.length;

  if (!totalKaryawan) {
    elRataHadir.textContent = '0.0%';
    elRataHadir.style.color = '#757575';
    elStatusKehadiran.textContent = 'Belum ada data';
    elTotalHadir.textContent = '0';
    elTotalTidakHadir.textContent = '0';
    elBreakdown.textContent = 'Alpa: 0 | Izin: 0 | Sakit: 0 | Cuti: 0 | Off: 0';
    elTotalTelat.textContent = '0';
    return;
  }

  let sumHadir = 0;
  let sumTidakHadir = 0;
  let sumAlpa = 0;
  let sumIzin = 0;
  let sumSakit = 0;
  let sumCuti = 0;
  let sumOff = 0;
  let sumTelat = 0;
  let sumTotalHariKerja = 0;

  targetList.forEach((r) => {
    sumHadir += Number(r.hadir || 0);
    sumTidakHadir += Number(r.tidak_hadir || 0);
    sumAlpa += Number(r.alpa || 0);
    sumIzin += Number(r.izin || 0);
    sumSakit += Number(r.sakit || 0);
    sumCuti += Number(r.cuti || 0);
    sumOff += Number(r.off || 0);
    sumTelat += Number(r.telat || 0);
    sumTotalHariKerja += Number(r.total_hari_kerja !== undefined ? r.total_hari_kerja : (hasil.total_hari_kerja || 1));
  });

  const rataPct = sumTotalHariKerja > 0 ? Math.min(100, (sumHadir / sumTotalHariKerja) * 100).toFixed(1) : '0.0';

  elRataHadir.textContent = `${rataPct}%`;

  if (rataPct >= 90) {
    elRataHadir.style.color = '#2E7D32';
    elStatusKehadiran.textContent = empSelected ? `🟢 KPI Individu: ${empSelected.nama}` : '🟢 Kedisiplinan Perusahaan Sangat Baik';
  } else if (rataPct >= 75) {
    elRataHadir.style.color = '#EF6C00';
    elStatusKehadiran.textContent = empSelected ? `🟡 KPI Individu: ${empSelected.nama}` : '🟡 Kedisiplinan Perusahaan Cukup Baik';
  } else {
    elRataHadir.style.color = '#C62828';
    elStatusKehadiran.textContent = empSelected ? `🔴 KPI Individu: ${empSelected.nama}` : '🔴 Kedisiplinan Perusahaan Perlu Evaluasi';
  }

  elTotalHadir.textContent = sumHadir;
  elTotalTidakHadir.textContent = sumTidakHadir;
  elBreakdown.textContent = `Alpa: ${sumAlpa} | Izin: ${sumIzin} | Sakit: ${sumSakit} | Cuti: ${sumCuti} | Off: ${sumOff}`;
  elTotalTelat.textContent = sumTelat;
}

function formatTanggalStr(dateStr) {
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

document.getElementById('btnMuatPerforma').addEventListener('click', muatRekapPerforma);
document.getElementById('btnExportCsvPerforma').addEventListener('click', () => exportCsvPerforma());

// Listeners Slicer Database Karyawan
document.getElementById('filterDepartemenKaryawan')?.addEventListener('change', () => {
  updateJabatanSlicerOptions();
  renderTabelKaryawan();
});

document.getElementById('filterJabatanKaryawan')?.addEventListener('change', () => {
  renderTabelKaryawan();
});

// Listeners Slicer Rekap Performa
document.getElementById('slicerDepartemenPerforma')?.addEventListener('change', (e) => {
  selectedDeptPerforma = e.target.value;
  selectedJabPerforma = '';
  selectedKaryawanIdPerforma = null;
  if (dataHasilPerformaCache) updateSlicerOptions(dataHasilPerformaCache.rekap);
  renderTabelPerforma();
});

document.getElementById('slicerJabatanPerforma')?.addEventListener('change', (e) => {
  selectedJabPerforma = e.target.value;
  selectedKaryawanIdPerforma = null;
  if (dataHasilPerformaCache) updateSlicerOptions(dataHasilPerformaCache.rekap);
  renderTabelPerforma();
});

document.getElementById('slicerKaryawanPerforma')?.addEventListener('change', (e) => {
  selectedKaryawanIdPerforma = e.target.value || null;
  renderTabelPerforma();
});

document.getElementById('btnResetSlicerPerforma')?.addEventListener('click', () => {
  selectedDeptPerforma = '';
  selectedJabPerforma = '';
  selectedKaryawanIdPerforma = null;
  selectedKpiFilterPerforma = null;
  if (dataHasilPerformaCache) updateSlicerOptions(dataHasilPerformaCache.rekap);
  renderTabelPerforma();
});

// Listeners Filter KPI Performa (klik kartu KPI untuk memfilter tabel)
Object.entries(KPI_FILTER_PERFORMA).forEach(([filter, config]) => {
  const card = document.getElementById(config.cardId);
  card?.addEventListener('click', () => toggleKpiFilterPerforma(filter));
});

// ============================================================
// REGISTRASI PENDING & NOTIFIKASI DESKTOP
// ============================================================
let knownPendingIds = new Set();
let isInitialPendingCheck = true;

function mainkanSuaraNotifikasi() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

async function cekRegistrasiPendingNotifikasi() {
  if (!state.token) return;
  try {
    const daftar = await api('/api/admin/registrasi-pending?status=menunggu');
    const badge = document.getElementById('badgePending');

    if (badge) {
      if (daftar.length > 0) {
        badge.textContent = daftar.length;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    const pendaftarBaru = [];
    const currentIds = new Set();

    daftar.forEach((item) => {
      currentIds.add(item.id);
      if (!knownPendingIds.has(item.id)) {
        pendaftarBaru.push(item);
      }
    });

    knownPendingIds = currentIds;

    if (!isInitialPendingCheck && pendaftarBaru.length > 0) {
      mainkanSuaraNotifikasi();

      if ('Notification' in window && Notification.permission === 'granted') {
        const p = pendaftarBaru[0];
        const judul = pendaftarBaru.length === 1
          ? `📢 Pendaftaran Karyawan Baru: ${p.nama}`
          : `📢 ${pendaftarBaru.length} Karyawan Baru Mendaftar!`;
        const body = pendaftarBaru.length === 1
          ? `Email: ${p.email}\nJabatan: ${p.jabatan || '-'}\nKlik untuk buka halaman Registrasi Pending.`
          : `Terdapat ${pendaftarBaru.length} pendaftar baru menunggu persetujuan Anda.`;

        const notif = new Notification(judul, {
          body,
          tag: 'pendaftaran-baru',
          renotify: true,
        });

        notif.onclick = () => {
          window.focus();
          const regTab = document.querySelector('.sidebar__tab[data-tab="registrasi"]');
          if (regTab) regTab.click();
        };
      }
    }

    isInitialPendingCheck = false;
  } catch (_) {}
}

async function muatRegistrasiPending() {
  const tbody  = document.getElementById('tbodyRegistrasi');
  const status = document.getElementById('filterStatusRegistrasi').value;
  try {
    const daftar = await api(`/api/admin/registrasi-pending?status=${status}`);
    if (!daftar.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="tabel__kosong">Tidak ada pendaftar dengan status "${status}"</td></tr>`;
      return;
    }
    tbody.innerHTML = daftar.map((r) => `
      <tr>
        <td>${escapeHtml(r.nama)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.jabatan || '-')}</td>
        <td>${escapeHtml(r.departemen || '—')}</td>
        <td>
          <div style="display:flex;gap:4px;">
            ${r.foto_1_url ? `<a href="${escapeHtml(r.foto_1_url)}" target="_blank" title="Klik untuk perbesar"><img src="${escapeHtml(r.foto_1_url)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid #ccc;"/></a>` : ''}
            ${r.foto_2_url ? `<a href="${escapeHtml(r.foto_2_url)}" target="_blank" title="Klik untuk perbesar"><img src="${escapeHtml(r.foto_2_url)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid #ccc;"/></a>` : ''}
            ${r.foto_3_url ? `<a href="${escapeHtml(r.foto_3_url)}" target="_blank" title="Klik untuk perbesar"><img src="${escapeHtml(r.foto_3_url)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid #ccc;"/></a>` : ''}
            ${(!r.foto_1_url && !r.foto_2_url && !r.foto_3_url) ? '<span style="color:var(--tinta-lembut)">—</span>' : ''}
          </div>
        </td>
        <td>${escapeHtml(r.nama_lokasi || '—')}</td>
        <td>${new Date(r.created_at).toLocaleDateString('id-ID')}</td>
        <td>${pilStatusRegistrasi(r.status)}</td>
        <td>
          ${r.status === 'menunggu' ? `
            <button class="tombol tombol--ok tombol--kecil" data-approve-reg="${escapeHtml(r.id)}">✓ Setujui</button>
            <button class="tombol tombol--error tombol--kecil" data-tolak-reg="${escapeHtml(r.id)}">✕ Tolak</button>
          ` : '—'}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-approve-reg]').forEach((btn) => {
      btn.addEventListener('click', () => bukaModalApproveRegistrasi(btn.dataset.approveReg, 'disetujui'));
    });
    tbody.querySelectorAll('[data-tolak-reg]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Tolak pendaftaran akun ini?')) return;
        try {
          await apiJson(`/api/admin/registrasi-pending/${btn.dataset.tolakReg}`, 'PATCH', { aksi: 'ditolak' });
          muatRegistrasiPending();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="tabel__kosong">Gagal memuat: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function pilStatusRegistrasi(status) {
  if (status === 'menunggu')  return '<span class="pil pil--peringatan">Menunggu</span>';
  if (status === 'disetujui') return '<span class="pil pil--ok">Disetujui</span>';
  if (status === 'ditolak')   return '<span class="pil pil--error">Ditolak</span>';
  return `<span class="pil pil--netral">${status}</span>`;
}

function bukaModalApproveRegistrasi(id, aksi) {
  const judulAksi = aksi === 'disetujui' ? 'Setujui' : 'Tolak';
  bukaModal(`
    <h3>${judulAksi} Pendaftaran</h3>
    <form id="formProsesRegistrasi">
      <label class="label">Catatan admin (opsional)</label>
      <input type="text" id="catatanAdmin" placeholder="mis. 'Silakan upload foto wajah ke admin'" />

      ${aksi === 'disetujui' ? `
        <label class="label">Override Shift (opsional)</label>
        <select id="overrideShift">
          <option value="">(pakai pilihan karyawan)</option>
          ${state.shifts.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.nama_shift)}</option>`).join('')}
        </select>
        <label class="label">Override Lokasi (opsional)</label>
        <select id="overrideLokasi">
          <option value="">(pakai pilihan karyawan)</option>
          ${state.lokasi.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama_lokasi)}</option>`).join('')}
        </select>
      ` : ''}

      <div class="modal__aksi">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol ${aksi === 'disetujui' ? 'tombol--utama' : 'tombol--error'}">${judulAksi}</button>
      </div>
      <p id="pesanProses" class="modal__pesan" hidden></p>
    </form>
  `);

  document.getElementById('formProsesRegistrasi').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { aksi, catatan_admin: document.getElementById('catatanAdmin').value.trim() || undefined };
    if (aksi === 'disetujui') {
      const sh = document.getElementById('overrideShift')?.value;
      const lo = document.getElementById('overrideLokasi')?.value;
      if (sh) body.shift_id = sh;
      if (lo) body.lokasi_kantor_id = lo;
    }
    const pesanEl = document.getElementById('pesanProses');
    try {
      const hasil = await apiJson(`/api/admin/registrasi-pending/${id}`, 'PATCH', body);
      tutupModal();
      muatRegistrasiPending();
      if (aksi === 'disetujui') muatKaryawan();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
}

document.getElementById('btnMuatRegistrasi').addEventListener('click', muatRegistrasiPending);
document.getElementById('filterStatusRegistrasi').addEventListener('change', muatRegistrasiPending);

// ============================================================
// ROSTER KARYAWAN
// ============================================================
let dataRosterCache = { employees: [], tanggal_mulai: '', tanggal_akhir: '' };
let rosterTemplatesCache = [];
let rosterJabatanCache = [];
const rosterDataByJabatan = new Map();
const rosterDraftsByJabatan = new Map();
const ROSTER_STATUS_TOTALS = ['S','M','CP','C','OFF'];

function normalizeFilterValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isSameFilterValue(a, b) {
  return normalizeFilterValue(a) === normalizeFilterValue(b);
}

function tanggalWibHariIni() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daftarTanggalRoster(mulai, akhir) {
  const hasil = [];
  const cursor = new Date(`${mulai}T00:00:00Z`);
  const batas = new Date(`${akhir}T00:00:00Z`);
  while (cursor <= batas) {
    hasil.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return hasil;
}

function kelompokJabatanRoster(employees) {
  return employees.reduce((groups, employee) => {
    const jabatan = employee.jabatan || 'Tanpa Jabatan';
    if (!groups[jabatan]) groups[jabatan] = [];
    groups[jabatan].push(employee);
    return groups;
  }, {});
}

function isiFilterJabatanRoster() {
  const jabatanEl = document.getElementById('rosterFilterJabatan');
  if (!jabatanEl) return;
  const selected = jabatanEl.value;
  jabatanEl.innerHTML = '<option value="">Jabatan: Semua</option>' + rosterJabatanCache
    .map(item => `<option value="${escapeHtml(item.jabatan)}">${escapeHtml(item.jabatan)}</option>`).join('');
  jabatanEl.value = selected;
}

function cariKaryawanRoster(userId) {
  for (const data of rosterDataByJabatan.values()) {
    const employee = data.employees?.find(item => String(item.id) === String(userId));
    if (employee) return employee;
  }
  return null;
}

function hitungTotalRosterPerTanggal(employees, dates, preview = new Map()) {
  return Object.fromEntries(dates.map(date => {
    const totals = Object.fromEntries(ROSTER_STATUS_TOTALS.map(status => [status, 0]));
    employees.forEach(employee => {
      const status = preview.get(window.RosterPreview.rosterPreviewKey(employee.id, date))
        ?? employee.schedule?.[date]?.status;
      if (Object.hasOwn(totals, status)) totals[status] += 1;
    });
    return [date, totals];
  }));
}

function getRosterDrafts(jabatan) {
  if (!rosterDraftsByJabatan.has(jabatan)) rosterDraftsByJabatan.set(jabatan, new Map());
  return rosterDraftsByJabatan.get(jabatan);
}

function rosterDraftKey(userId, tanggal) {
  return `${userId}_${tanggal}`;
}

function opsiStatusRoster(selectedStatus) {
  return ['', ...ROSTER_STATUS_TOTALS].map(status => {
    const label = status || '-';
    return `<option value="${status}" ${status === selectedStatus ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

function perbaruiKontrolDraftRoster(jabatan, section) {
  const count = getRosterDrafts(jabatan).size;
  const saveButton = section?.querySelector('.roster-save-jabatan');
  if (!saveButton) return;
  saveButton.disabled = count === 0;
  saveButton.textContent = count ? `Simpan Perubahan (${count})` : 'Simpan Perubahan';
}

function buildRosterStatusPreview(jabatan, data, dates) {
  return window.RosterPreview.buildRosterStatusPreview({
    employees: data.employees || [],
    dates,
    changes: [...getRosterDrafts(jabatan).values()],
  });
}

function terapkanPreviewRosterDiTabel(body, jabatan) {
  const data = rosterDataByJabatan.get(jabatan);
  if (!body || !data) return;
  const dates = daftarTanggalRoster(data.tanggal_mulai, data.tanggal_akhir);
  const preview = buildRosterStatusPreview(jabatan, data, dates);
  body.querySelectorAll('.roster-day-select').forEach(daySelect => {
    const originalStatus = daySelect.dataset.originalStatus || '';
    const status = preview.get(window.RosterPreview.rosterPreviewKey(daySelect.dataset.userId, daySelect.dataset.date))
      ?? originalStatus;
    daySelect.value = status;
    daySelect.dataset.previousStatus = status;
    daySelect.className = `roster-day-select roster-badge--${status ? status.toLowerCase() : 'empty'}`;
    daySelect.closest('.roster-day-cell')?.classList.toggle('roster-day-cell--dirty', status !== originalStatus);
  });
  const totalsByDate = hitungTotalRosterPerTanggal(data.employees || [], dates, preview);
  body.querySelectorAll('.roster-total-value').forEach(value => {
    value.textContent = totalsByDate[value.dataset.date]?.[value.dataset.status] ?? '0';
  });
}

function catatDraftRoster(select, jabatan) {
  const drafts = getRosterDrafts(jabatan);
  const key = rosterDraftKey(select.dataset.userId, select.dataset.date);
  const originalStatus = select.dataset.originalStatus || '';
  const previousStatus = select.dataset.previousStatus || originalStatus;
  const status = select.value;
  if (!status && originalStatus) {
    select.value = originalStatus;
    return;
  }
  const hadExplicitDraft = drafts.has(key);
  if (status === originalStatus && (hadExplicitDraft || previousStatus === originalStatus)) drafts.delete(key);
  else drafts.set(key, { user_id: select.dataset.userId, tanggal: select.dataset.date, status });
  const body = select.closest('.roster-group__body');
  terapkanPreviewRosterDiTabel(body, jabatan);
  perbaruiKontrolDraftRoster(jabatan, select.closest('.roster-group'));
}

function pasangEventRosterTable(body, jabatan) {
  body.querySelectorAll('.roster-day-select').forEach(select => {
    select.addEventListener('change', () => catatDraftRoster(select, jabatan));
  });
  perbaruiKontrolDraftRoster(jabatan, body.closest('.roster-group'));
}

function renderIsiRosterJabatan(jabatan, data) {
  const dates = daftarTanggalRoster(data.tanggal_mulai, data.tanggal_akhir);
  const search = normalizeFilterValue(document.getElementById('rosterCariKaryawan')?.value);
  const members = (data.employees || []).filter(employee => !search
    || normalizeFilterValue(`${employee.nama} ${employee.employee_id || ''}`).includes(search));
  const drafts = getRosterDrafts(jabatan);
  const preview = buildRosterStatusPreview(jabatan, data, dates);
  const totalsByDate = hitungTotalRosterPerTanggal(data.employees || [], dates, preview);
  const labelTanggal = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', timeZone: 'UTC',
  });
  return `
    <div class="roster-table-wrap">
      <table class="tabel roster-table">
        <thead><tr>
          <th class="roster-sticky roster-sticky--employee">Karyawan</th>
          ${dates.map(date => `<th title="${date}">${labelTanggal(date)}</th>`).join('')}
        </tr></thead>
        <tbody>${members.map(employee => `
          <tr>
            <td class="roster-sticky roster-sticky--employee" title="${escapeHtml(employee.nama)}"><strong>${escapeHtml(employee.nama)}</strong><small>${escapeHtml(employee.employee_id || '-')}</small></td>
            ${dates.map(date => {
              const day = employee.schedule?.[date];
              const originalStatus = day?.status || '';
              const status = preview.get(window.RosterPreview.rosterPreviewKey(employee.id, date)) ?? originalStatus;
              const klass = status ? status.toLowerCase() : 'empty';
              const dirty = status !== originalStatus ? ' roster-day-cell--dirty' : '';
              return `<td class="roster-day-cell${dirty}"><select class="roster-day-select roster-badge--${klass}" data-user-id="${employee.id}" data-date="${date}" data-original-status="${originalStatus}" data-previous-status="${status}" aria-label="Roster ${escapeHtml(employee.nama)} ${date}">${opsiStatusRoster(status)}</select></td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
        <tfoot>
          ${ROSTER_STATUS_TOTALS.map(status => `<tr class="roster-total-row roster-total-row--${status.toLowerCase()}">
            <td class="roster-sticky roster-sticky--employee">
              <span class="roster-total-label roster-badge--${status.toLowerCase()}">${status}</span>
            </td>
            ${dates.map(date => `<td><strong class="roster-total-value roster-badge--${status.toLowerCase()}" data-date="${date}" data-status="${status}">${totalsByDate[date][status]}</strong></td>`).join('')}
          </tr>`).join('')}
        </tfoot>
      </table>
    </div>`;
}

function renderRoster() {
  const container = document.getElementById('rosterTables');
  const summary = document.getElementById('rosterSummary');
  if (!container) return;
  const selectedJabatan = document.getElementById('rosterFilterJabatan')?.value || '';
  const groups = rosterJabatanCache.filter(item => !selectedJabatan || item.jabatan === selectedJabatan);
  const total = groups.reduce((sum, item) => sum + Number(item.jumlah_karyawan), 0);
  if (summary) summary.textContent = `${total} karyawan aktif | ${groups.length} tabel jabatan | tabel belum dibuka tidak memuat data`;
  container.innerHTML = groups.map((group) => {
    const loaded = rosterDataByJabatan.get(group.jabatan);
    const draftCount = getRosterDrafts(group.jabatan).size;
    return `
      <section class="roster-group roster-group--collapsed" data-jabatan="${escapeHtml(group.jabatan)}">
        <div class="roster-group__head">
          <button class="roster-group__toggle" data-jabatan="${escapeHtml(group.jabatan)}" aria-expanded="false">
            <span class="roster-group__arrow">▶</span><strong>${escapeHtml(group.jabatan)}</strong>
            <small>${group.jumlah_karyawan} karyawan</small>
          </button>
          <div class="roster-group__actions">
            <button class="tombol tombol--utama roster-save-jabatan" data-jabatan="${escapeHtml(group.jabatan)}" ${draftCount ? '' : 'disabled'}>${draftCount ? `Simpan Perubahan (${draftCount})` : 'Simpan Perubahan'}</button>
            <button class="tombol tombol--ghost roster-assign-jabatan" data-jabatan="${escapeHtml(group.jabatan)}">Atur Roster Jabatan</button>
          </div>
        </div>
        <div class="roster-group__body" hidden>${loaded ? renderIsiRosterJabatan(group.jabatan, loaded) : '<div class="tabel__kosong">Data belum dimuat.</div>'}</div>
      </section>`;
  }).join('') || '<div class="tabel__kosong">Tidak ada jabatan sesuai filter.</div>';

  container.querySelectorAll('.roster-group__toggle').forEach(button => button.addEventListener('click', () => muatRosterJabatan(button.dataset.jabatan, button)));
  container.querySelectorAll('.roster-assign-jabatan').forEach(button => button.addEventListener('click', () => bukaModalAssignRosterJabatan(button.dataset.jabatan)));
  container.querySelectorAll('.roster-save-jabatan').forEach(button => button.addEventListener('click', () => simpanDraftRosterJabatan(button.dataset.jabatan, button)));
}

async function muatRosterJabatan(jabatan, toggleButton = null) {
  const section = toggleButton?.closest('.roster-group') || [...document.querySelectorAll('.roster-group')]
    .find(item => item.dataset.jabatan === jabatan);
  if (!section) return;
  const body = section.querySelector('.roster-group__body');
  const isOpen = !body.hidden;
  if (isOpen) {
    body.hidden = true;
    section.classList.add('roster-group--collapsed');
    toggleButton?.setAttribute('aria-expanded', 'false');
    return;
  }
  body.hidden = false;
  section.classList.remove('roster-group--collapsed');
  toggleButton?.setAttribute('aria-expanded', 'true');
  if (!rosterDataByJabatan.has(jabatan)) {
    body.innerHTML = '<div class="tabel__kosong">Memuat data roster...</div>';
    try {
      const params = new URLSearchParams({
        tanggal_mulai: document.getElementById('rosterTanggalMulai').value,
        tanggal_akhir: document.getElementById('rosterTanggalAkhir').value,
        jabatan,
      });
      const data = await api(`/api/admin/roster?${params}`);
      rosterDataByJabatan.set(jabatan, data);
    } catch (error) {
      body.innerHTML = `<div class="tabel__kosong" style="color:#b91c1c">${escapeHtml(error.message)}</div>`;
      return;
    }
  }
  body.innerHTML = renderIsiRosterJabatan(jabatan, rosterDataByJabatan.get(jabatan));
  pasangEventRosterTable(body, jabatan);
}

async function muatRoster() {
  const mulaiEl = document.getElementById('rosterTanggalMulai');
  const akhirEl = document.getElementById('rosterTanggalAkhir');
  if (!mulaiEl || !akhirEl) return;
  const today = tanggalWibHariIni();
  if (!mulaiEl.value) mulaiEl.value = today;
  if (!akhirEl.value) {
    const akhir = new Date(`${today}T00:00:00Z`);
    akhir.setUTCDate(akhir.getUTCDate() + 13);
    akhirEl.value = akhir.toISOString().slice(0, 10);
  }
  const dates = daftarTanggalRoster(mulaiEl.value, akhirEl.value);
  if (!dates.length || dates.at(-1) !== akhirEl.value) {
    alert('Tanggal akhir roster tidak boleh sebelum tanggal awal.');
    return;
  }
  const container = document.getElementById('rosterTables');
  if (container) container.innerHTML = '<div class="tabel__kosong">Memuat roster karyawan aktif...</div>';
  try {
    [rosterTemplatesCache, rosterJabatanCache] = await Promise.all([
      api('/api/admin/roster/templates'),
      api('/api/admin/roster/jabatan'),
    ]);
    rosterDataByJabatan.clear();
    dataRosterCache = { employees: [], tanggal_mulai: mulaiEl.value, tanggal_akhir: akhirEl.value };
    isiFilterJabatanRoster();
    renderRoster();
  } catch (error) {
    if (container) container.innerHTML = `<div class="tabel__kosong" style="color:#b91c1c">Gagal memuat roster: ${escapeHtml(error.message)}</div>`;
  }
}

function bukaModalTemplateRoster() {
  bukaModal(`
    <h3>Buat Template Roster</h3>
    <form id="formTemplateRoster" class="roster-form">
      <label class="label">Roster Cuti *</label>
      <input id="rosterTemplateCuti" class="input-teks" required value="84:14" placeholder="Contoh: 84:14" />
      <small>Contoh 84:14 = 84 hari mengikuti pola kerja, lalu 14 hari CP (cuti periodik).</small>
      <label class="label">Hari Kerja *</label>
      <input id="rosterTemplateHariKerja" class="input-teks" required value="7S,6M,OFF" placeholder="Contoh: 7S,6M,OFF" />
      <small>Sistem mengulang pola ini selama fase kerja. Setelah CP selesai, pola kembali dimulai dari 7S. Kode C hanya untuk cuti khusus dan tidak mengubah siklus.</small>
      <div id="rosterSimplePreview" class="roster-simple-preview">84 hari pola kerja berulang → 14 hari CP → reset dari awal</div>
      <button class="tombol tombol--utama" type="submit">Generate Template</button>
    </form>`);
  const updatePreview = () => {
    const ratio = document.getElementById('rosterTemplateCuti').value.match(/^\s*(\d+)\s*:\s*(\d+)\s*$/);
    const pattern = document.getElementById('rosterTemplateHariKerja').value.trim().toUpperCase();
    document.getElementById('rosterSimplePreview').textContent = ratio
      ? `${ratio[1]} hari pola ${pattern || '-'} berulang → ${ratio[2]} hari CP → reset dari awal`
      : 'Gunakan format Roster Cuti seperti 84:14';
  };
  document.getElementById('rosterTemplateCuti').addEventListener('input', updatePreview);
  document.getElementById('rosterTemplateHariKerja').addEventListener('input', updatePreview);
  document.getElementById('formTemplateRoster').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiJson('/api/admin/roster/templates', 'POST', {
        roster_cuti: document.getElementById('rosterTemplateCuti').value,
        hari_kerja: document.getElementById('rosterTemplateHariKerja').value,
      });
      tutupModal();
      await muatRoster();
    } catch (error) { alert(error.message); }
  });
}

function bukaModalAssignRosterJabatan(jabatan) {
  bukaModal(`
    <h3>Atur Roster Jabatan</h3>
    <p><strong>${escapeHtml(jabatan)}</strong> — berlaku untuk seluruh karyawan aktif pada jabatan ini.</p>
    <form id="formAssignRoster" class="roster-form">
      <label class="label">Template *</label><select id="assignRosterTemplate" class="input-teks" required>
        <option value="">Pilih template</option>${rosterTemplatesCache.map(item => `<option value="${item.id}">${escapeHtml(item.nama)} (${item.cycle_days} hari)</option>`).join('')}
      </select>
      <label class="label">Berlaku mulai *</label><input id="assignRosterDate" type="date" class="input-teks" value="${dataRosterCache.tanggal_mulai || tanggalWibHariIni()}" required />
      <label class="label">Mulai dari hari ke-</label><input id="assignRosterAnchor" type="number" min="1" value="1" class="input-teks" required />
      <small>Hari ke-1 berarti tanggal mulai memakai elemen pertama pola template.</small>
      <button class="tombol tombol--utama" type="submit">Terapkan dan Generate</button>
    </form>`);
  document.getElementById('formAssignRoster').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await apiJson('/api/admin/roster/assignments/jabatan', 'POST', {
        jabatan,
        template_id: document.getElementById('assignRosterTemplate').value,
        effective_from: document.getElementById('assignRosterDate').value,
        anchor_day_index: Number(document.getElementById('assignRosterAnchor').value),
      });
      alert(result.message);
      tutupModal();
      rosterDataByJabatan.delete(jabatan);
      renderRoster();
    } catch (error) { alert(error.message); }
  });
}

async function simpanDraftRosterJabatan(jabatan, saveButton) {
  const drafts = [...getRosterDrafts(jabatan).values()].filter(change => change.status);
  if (!drafts.length) return;
  const section = saveButton.closest('.roster-group');
  const body = section?.querySelector('.roster-group__body');
  const originalText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = `Menyimpan ${drafts.length} perubahan...`;
  try {
    await apiJson('/api/admin/roster/daily/batch', 'PATCH', { changes: drafts });
    const params = new URLSearchParams({
      tanggal_mulai: document.getElementById('rosterTanggalMulai').value,
      tanggal_akhir: document.getElementById('rosterTanggalAkhir').value,
      jabatan,
    });
    const data = await api(`/api/admin/roster?${params}`);
    rosterDataByJabatan.set(jabatan, data);
    rosterDraftsByJabatan.delete(jabatan);
    if (body) {
      body.innerHTML = renderIsiRosterJabatan(jabatan, data);
      pasangEventRosterTable(body, jabatan);
    }
    saveButton.textContent = 'Tersimpan';
    setTimeout(() => perbaruiKontrolDraftRoster(jabatan, section), 1200);
  } catch (error) {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
    alert(`Gagal menyimpan perubahan roster: ${error.message}`);
  }
}

async function exportRosterExcel() {
  const params = new URLSearchParams({
    tanggal_mulai: document.getElementById('rosterTanggalMulai').value,
    tanggal_akhir: document.getElementById('rosterTanggalAkhir').value,
  });
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/admin/roster/export?${params}`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Export gagal');
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `roster_${params.get('tanggal_mulai')}_${params.get('tanggal_akhir')}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) { alert(error.message); }
}

function bukaImportRoster() {
  bukaModal(`<h3>Import Excel Roster</h3><p>Gunakan hasil Export Excel sebagai template. Isi kolom tanggal dengan S, M, C, CP, atau OFF.</p><form id="formImportRoster" class="roster-form"><input id="fileImportRoster" type="file" accept=".xlsx,.xls" required /><button type="submit" class="tombol tombol--utama">Import</button></form>`);
  document.getElementById('formImportRoster').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData();
    formData.append('excel', document.getElementById('fileImportRoster').files[0]);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/admin/roster/import`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Import gagal');
      alert(result.message);
      tutupModal();
      await muatRoster();
    } catch (error) { alert(error.message); }
  });
}

document.getElementById('btnTampilkanRoster')?.addEventListener('click', muatRoster);
document.getElementById('btnTemplateRoster')?.addEventListener('click', bukaModalTemplateRoster);
document.getElementById('btnExportRoster')?.addEventListener('click', exportRosterExcel);
document.getElementById('btnImportRoster')?.addEventListener('click', bukaImportRoster);

// ============================================================
// EXPORT CSV
// ============================================================
function exportCsvAbsensi() {
  const rows = [];
  document.querySelectorAll('#tbodyAbsensi tr').forEach((tr) => {
    const cols = Array.from(tr.querySelectorAll('td')).map((td) => `"${td.innerText.replace(/"/g, '""')}"`);
    if (cols.length > 1) rows.push(cols.join(','));
  });
  const header = '"Karyawan","Tanggal Kerja","Shift","Datang","Status Datang","Pulang","Status Pulang","Aksi"';
  downloadCsv([header, ...rows].join('\n'), `absensi_${new Date().toISOString().split('T')[0]}.csv`);
}

async function exportExcelAbsensi() {
  const button = document.getElementById('btnExportExcelAbsensi');
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Menyiapkan Excel...';
    }
    const params = buatParamsFilterAbsensi({ sertakanAtribut: true });
    const response = await fetch(`${getApiBaseUrl()}/api/admin/absensi/export.xlsx?${params.toString()}`, {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    });
    if (!response.ok) {
      let pesan = `Export gagal (${response.status})`;
      try {
        const body = await response.json();
        pesan = body?.error || pesan;
      } catch (_) {}
      throw new Error(pesan);
    }
    const blob = await response.blob();
    const excelBlob = new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const { tanggalMulai, tanggalAkhir } = validasiRangeAbsensi();
    const url = URL.createObjectURL(excelBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `absensi_${tanggalMulai}_${tanggalAkhir}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '📤 Export Excel';
    }
  }
}

function exportCsvPerforma() {
  if (!dataHasilPerformaCache || !dataHasilPerformaCache.rekap) return;

  const selectedUser = selectedKaryawanIdPerforma
    ? dataHasilPerformaCache.rekap.find(r => r.id === selectedKaryawanIdPerforma)
    : null;

  const tglRefStr = dataHasilPerformaCache.tanggal_mulai || new Date().toISOString().split('T')[0];

  if (selectedUser) {
    // EXPORT SLICER INDIVIDU (Rincian Harian Per Hari)
    const rincian = selectedUser.rincian_harian || [];
    const header = '"Tanggal / Hari","Nama","Jabatan","Departemen","Hadir","% Hadir","Total Tidak Hadir","Alpa","Izin","Sakit","Cuti","OFF","Telat","Checkout Lewat","Percobaan Pulang Awal","Keterangan"';

    const rows = rincian.map((rh) => {
      const pct = rh.hadir > 0 ? '100.0%' : '0.0%';
      const tglFormatted = formatTanggalStr(rh.tanggal);
      const labelTanggalHari = `${rh.hari}, ${tglFormatted}`;
      const ketClean = (rh.keterangan || '—').replace(/"/g, '""');

      return `"${labelTanggalHari}","${selectedUser.nama.replace(/"/g, '""')}","${(selectedUser.jabatan || '—').replace(/"/g, '""')}","${(selectedUser.departemen || '—').replace(/"/g, '""')}",${rh.hadir},"${pct}",${rh.tidak_hadir},${rh.alpa},${rh.izin},${rh.sakit},${rh.cuti},${rh.off},${rh.telat},${rh.checkout_lewat},${rh.percobaan_pulang_awal},"${ketClean}"`;
    });

    const namaClean = selectedUser.nama.toLowerCase().replace(/[^a-z0-9]/g, '_');
    downloadCsv([header, ...rows].join('\n'), `performa_rincian_${namaClean}_${tglRefStr}.csv`);
  } else {
    // EXPORT RINGKASAN SEMUA KARYAWAN
    const totalHariKerja = dataHasilPerformaCache.total_hari_kerja || 1;
    const header = '"Nama","Jabatan","Departemen","Hadir","% Hadir","Total Tidak Hadir","Alpa","Izin","Sakit","Cuti","OFF","Telat","Checkout Lewat","Percobaan Pulang Awal"';

    const rows = dataHasilPerformaCache.rekap.map((r) => {
      const totalHariKerjaIndiv = (r.total_hari_kerja !== undefined) ? r.total_hari_kerja : totalHariKerja;
      const pct = totalHariKerjaIndiv > 0 ? Math.min(100, (r.hadir / totalHariKerjaIndiv) * 100).toFixed(1) : '0.0';

      return `"${r.nama.replace(/"/g, '""')}","${(r.jabatan || '—').replace(/"/g, '""')}","${(r.departemen || '—').replace(/"/g, '""')}",${r.hadir},"${pct}%",${r.tidak_hadir},${r.alpa},${r.izin},${r.sakit},${r.cuti},${r.off || 0},${r.telat},${r.checkout_lewat},${r.percobaan_pulang_awal || 0}`;
    });

    downloadCsv([header, ...rows].join('\n'), `performa_ringkasan_semua_${tglRefStr}.csv`);
  }
}

function downloadCsv(content, filename) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Inisialisasi & Event Listeners Payroll
// ============================================================
mulaiJamBerjalan();

const filterPerformaEl = document.getElementById('filterTanggalPerforma');
if (filterPerformaEl) {
  filterPerformaEl.value = new Date().toISOString().split('T')[0];
}

const btnAuditLogPerformaEl = document.getElementById('btnAuditLogPerforma');
if (btnAuditLogPerformaEl) {
  btnAuditLogPerformaEl.addEventListener('click', bukaModalAuditLogPerforma);
}

document.getElementById('searchPayroll')?.addEventListener('input', renderTabelPayroll);
document.getElementById('btnTambahPayroll')?.addEventListener('click', () => bukaModalTambahAtauEditPayroll());
document.getElementById('btnImportExcelPayroll')?.addEventListener('click', bukaModalImportExcelPayroll);
document.getElementById('btnSinkronPayroll')?.addEventListener('click', sinkronKaryawanPayroll);
document.getElementById('btnAuditLogPayroll')?.addEventListener('click', bukaModalAuditLogPayroll);
document.getElementById('btnExportCsvPayroll')?.addEventListener('click', exportCsvPayroll);
document.getElementById('btnExportExcelPayroll')?.addEventListener('click', exportExcelPayroll);

if (state.token) {
  tampilkanApp();
  muatPayroll();
}

// ============================================================
// DATABASE PAYROLL KARYAWAN
// ============================================================
let dataPayrollCache = [];

function formatRupiah(angka) {
  const num = Number(angka || 0);
  if (!num) return 'Rp 0';
  return 'Rp ' + num.toLocaleString('id-ID');
}

async function muatPayroll() {
  const tbody = document.getElementById('tbodyPayroll');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="12" class="tabel__kosong">Memuat data payroll...</td></tr>';
  try {
    dataPayrollCache = await api('/api/admin/payroll');
    renderTabelPayroll();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="tabel__kosong">Gagal memuat: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function sinkronKaryawanPayroll() {
  if (!confirm('Apakah Anda yakin ingin mensinkronisasi data dari Master Karyawan ke Database Payroll?\n\nProses ini tidak akan menghapus/menimpa Gaji Pokok yang sudah di-set sebelumnya.')) {
    return;
  }
  
  const btn = document.getElementById('btnSinkronPayroll');
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Mensinkronkan...';
  btn.disabled = true;

  try {
    const res = await apiJson('/api/admin/payroll/sinkron', 'POST');
    alert(`✅ Sinkronisasi berhasil!\nData baru ditambah: ${res.inserted}\nData diperbarui (Nama/Jabatan): ${res.updated}`);
    muatPayroll();
  } catch (err) {
    alert(`❌ Gagal sinkronisasi: ${err.message}`);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function renderTabelPayroll() {
  const tbody = document.getElementById('tbodyPayroll');
  if (!tbody) return;

  const q = (document.getElementById('searchPayroll')?.value || '').toLowerCase().trim();
  const filtered = dataPayrollCache.filter((r) => {
    if (!q) return true;
    return (
      (r.employee_id || '').toLowerCase().includes(q) ||
      (r.nama_karyawan || '').toLowerCase().includes(q) ||
      (r.site || '').toLowerCase().includes(q) ||
      (r.kota || '').toLowerCase().includes(q) ||
      (r.jabatan || '').toLowerCase().includes(q)
    );
  });

  const elCount = document.getElementById('kpiPayrollCount');
  const elTotalGaji = document.getElementById('kpiPayrollTotalGaji');
  const elRataGaji = document.getElementById('kpiPayrollRataGaji');

  const count = filtered.length;
  const sumGaji = filtered.reduce((acc, curr) => acc + Number(curr.gaji_pokok || 0), 0);
  const avgGaji = count > 0 ? Math.round(sumGaji / count) : 0;

  if (elCount) elCount.textContent = count;
  if (elTotalGaji) elTotalGaji.textContent = formatRupiah(sumGaji);
  if (elRataGaji) elRataGaji.textContent = formatRupiah(avgGaji);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="tabel__kosong">Tidak ada data payroll karyawan</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((r, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${r.employee_id ? `<code style="background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:600;">${escapeHtml(r.employee_id)}</code>` : '<span class="pil pil--netral">—</span>'}</td>
      <td><b>${escapeHtml(r.nama_karyawan)}</b> ${r.nama_user_linked ? '<span style="font-size:11px;color:#2e7d32;" title="Terhubung dengan akun karyawan">🔗</span>' : ''}</td>
      <td>${escapeHtml(r.date_in || '—')}</td>
      <td>${escapeHtml(r.site || '—')}</td>
      <td>${escapeHtml(r.kota || '—')}</td>
      <td>${escapeHtml(r.jabatan || '—')}</td>
      <td style="font-weight:600;color:#1b5e20;">${formatRupiah(r.gaji_pokok)}</td>
      <td>${formatRupiah(r.tunjangan_kehadiran_per_hari)}</td>
      <td>${formatRupiah(r.tunjangan_jabatan)}</td>
      <td>${formatRupiah(r.insentif_hm_per_jam)}</td>
      <td>
        <button class="tombol tombol--ghost tombol--kecil" data-edit-payroll="${r.id}">Edit</button>
        <button class="tombol tombol--ghost tombol--kecil" data-hapus-payroll="${r.id}" data-nama="${escapeHtml(r.nama_karyawan)}" style="color:#c62828;border-color:#ef9a9a;">Hapus</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit-payroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = dataPayrollCache.find((x) => x.id === btn.dataset.editPayroll);
      if (item) bukaModalTambahAtauEditPayroll(item);
    });
  });

  tbody.querySelectorAll('[data-hapus-payroll]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.hapusPayroll;
      const nama = btn.dataset.nama;
      if (!confirm(`Yakin ingin menghapus data payroll karyawan "${nama}"?`)) return;
      try {
        const res = await apiJson(`/api/admin/payroll/${id}`, 'DELETE');
        alert(res.message);
        muatPayroll();
      } catch (err) {
        alert('Gagal menghapus: ' + err.message);
      }
    });
  });
}

function bukaModalTambahAtauEditPayroll(item = null) {
  const isEdit = Boolean(item);
  bukaModal(`
    <h3>${isEdit ? 'Edit Data Payroll' : 'Tambah Data Payroll Manual'}</h3>
    <form id="formPayroll">
      <label class="label">Employee ID (Kunci Penghubung Akun)</label>
      <input type="text" id="payEmpId" value="${escapeHtml(item?.employee_id || '')}" placeholder="contoh: B23030768" style="font-weight:bold;" />

      <label class="label">Nama Karyawan</label>
      <input type="text" id="payNama" value="${escapeHtml(item?.nama_karyawan || '')}" required />

      <label class="label">Date In (Tanggal Masuk)</label>
      <input type="text" id="payDateIn" value="${escapeHtml(item?.date_in || '')}" placeholder="contoh: 18 Mei 2026" />

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="label">Site</label>
          <input type="text" id="paySite" value="${escapeHtml(item?.site || '')}" placeholder="BEI" />
        </div>
        <div>
          <label class="label">Kota</label>
          <input type="text" id="payKota" value="${escapeHtml(item?.kota || '')}" placeholder="Jambi" />
        </div>
      </div>

      <label class="label">Jabatan</label>
      <input type="text" id="payJabatan" value="${escapeHtml(item?.jabatan || '')}" placeholder="Driver DT" />

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="label">Gaji Pokok (Rp)</label>
          <input type="number" id="payGajiPokok" value="${item?.gaji_pokok || 0}" step="1000" min="0" required />
        </div>
        <div>
          <label class="label">Tunjangan Kehadiran / Hari (Rp)</label>
          <input type="number" id="payTunjKehadiran" value="${item?.tunjangan_kehadiran_per_hari || 0}" step="500" min="0" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;">
        <div>
          <label class="label">Tunjangan Jabatan (Rp)</label>
          <input type="number" id="payTunjJabatan" value="${item?.tunjangan_jabatan || 0}" step="1000" min="0" />
        </div>
        <div>
          <label class="label">Insentif HM / Jam (Rp)</label>
          <input type="number" id="payInsentifHm" value="${item?.insentif_hm_per_jam || 0}" step="500" min="0" />
        </div>
      </div>

      <div class="modal__aksi" style="margin-top:16px;">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Payroll</button>
      </div>
      <p id="pesanPayroll" class="modal__pesan" hidden></p>
    </form>
  `);

  document.getElementById('formPayroll').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pesanEl = document.getElementById('pesanPayroll');
    const body = {
      employee_id: document.getElementById('payEmpId').value.trim() || null,
      nama_karyawan: document.getElementById('payNama').value.trim(),
      date_in: document.getElementById('payDateIn').value.trim() || null,
      site: document.getElementById('paySite').value.trim() || null,
      kota: document.getElementById('payKota').value.trim() || null,
      jabatan: document.getElementById('payJabatan').value.trim() || null,
      gaji_pokok: Number(document.getElementById('payGajiPokok').value || 0),
      tunjangan_kehadiran_per_hari: Number(document.getElementById('payTunjKehadiran').value || 0),
      tunjangan_jabatan: Number(document.getElementById('payTunjJabatan').value || 0),
      insentif_hm_per_jam: Number(document.getElementById('payInsentifHm').value || 0),
    };

    try {
      if (isEdit) {
        await apiJson(`/api/admin/payroll/${item.id}`, 'PATCH', body);
      } else {
        await apiJson('/api/admin/payroll', 'POST', body);
      }
      tutupModal();
      muatPayroll();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
}

function bukaModalImportExcelPayroll() {
  bukaModal(`
    <h3>📥 Import Excel Database Payroll</h3>
    <p style="font-size:13px;color:var(--tinta-lembut);margin-bottom:12px;">Unggah berkas Excel (<b>DATABASE PAYROLL.xlsx</b>). Sistem akan membaca otomatis kolom <i>EMPLOYEE ID, Nama Karyawan, Date in, Site, Kota, JABATAN, GAJI POKOK, Tunjangan Kehadiran, Tunjangan Jabatan, dan Insentif HM</i>.</p>

    <form id="formImportPayroll">
      <label class="label">Pilih Berkas Excel (.xlsx / .xls)</label>
      <input type="file" id="inputFileExcel" accept=".xlsx, .xls" required style="margin-top:4px;" />

      <div class="modal__aksi" style="margin-top:16px;">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama" style="background:#2e7d32;border-color:#2e7d32;">Proses Import Excel</button>
      </div>
      <p id="pesanImportPayroll" class="modal__pesan" hidden></p>
    </form>
  `);

  document.getElementById('formImportPayroll').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('inputFileExcel');
    const pesanEl = document.getElementById('pesanImportPayroll');

    if (!fileInput.files.length) {
      alert('Silakan pilih berkas Excel terlebih dahulu!');
      return;
    }

    const formData = new FormData();
    formData.append('excel', fileInput.files[0]);

    pesanEl.textContent = '⏳ Sedang memproses dan mengimpor berkas Excel...';
    pesanEl.className = 'modal__pesan';
    pesanEl.hidden = false;

    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/admin/payroll/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}` },
        body: formData,
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Gagal import Excel');

      alert(body.message || 'Import Excel Payroll berhasil!');
      tutupModal();
      muatPayroll();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
}

async function bukaModalAuditLogPayroll() {
  bukaModal(`
    <h3>📋 Audit Log Database Payroll</h3>
    <p style="font-size:13px;color:var(--tinta-lembut);margin-bottom:12px;">Histori catatan aksi impor Excel dan perubahan manual database payroll karyawan.</p>
    <div style="max-height:400px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:6px;padding:8px;background:#f9f9f9;" id="boxAuditLogPayroll">
      <p style="font-size:12px;color:#757575;">Memuat histori audit log...</p>
    </div>
    <div class="modal__aksi" style="margin-top:16px;">
      <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>
    </div>
  `);

  const box = document.getElementById('boxAuditLogPayroll');
  try {
    const list = await api('/api/admin/payroll/audit-log');
    if (!list.length) {
      box.innerHTML = '<p style="font-size:12px;color:#757575;">Belum ada catatan audit log payroll.</p>';
      return;
    }

    box.innerHTML = list.map((item) => {
      const tgl = new Date(item.waktu_perubahan).toLocaleString('id-ID');
      return `
        <div style="font-family:monospace;font-size:12px;background:#fff;padding:10px;border-radius:6px;border-left:3px solid #7c4dff;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-weight:bold;color:#333;margin-bottom:4px;">${escapeHtml(item.alasan)}</div>
          <div style="font-size:11px;color:#757575;">Waktu System: ${tgl}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    box.innerHTML = `<p style="font-size:12px;color:#c62828;">Gagal memuat log: ${escapeHtml(err.message)}</p>`;
  }
}

function exportCsvPayroll() {
  if (!dataPayrollCache.length) {
    alert('Tidak ada data payroll untuk diexport');
    return;
  }
  const rows = dataPayrollCache.map((r, i) => {
    return `${i + 1},"${r.employee_id || ''}","${r.nama_karyawan}","${r.date_in || ''}","${r.site || ''}","${r.kota || ''}","${r.jabatan || ''}",${r.gaji_pokok || 0},${r.tunjangan_kehadiran_per_hari || 0},${r.tunjangan_jabatan || 0},${r.insentif_hm_per_jam || 0}`;
  });
  const header = '"No","Employee ID","Nama Karyawan","Date In","Site","Kota","Jabatan","Gaji Pokok","Tunjangan Kehadiran per Hari","Tunjangan Jabatan","Insentif HM per Jam"';
  downloadCsv([header, ...rows].join('\n'), `database_payroll_${new Date().toISOString().split('T')[0]}.csv`);
}

// ============================================================
async function exportExcelPayroll() {
  const button = document.getElementById("btnExportExcelPayroll");
  if (!button) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Menyiapkan Excel...";
  try {
    const response = await fetch(getApiBaseUrl() + "/api/admin/payroll/export", {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    });
    if (!response.ok) {
      let pesan = "Export gagal (" + response.status + ")";
      try { const body = await response.json(); pesan = (body && body.error) || pesan; } catch (_) {}
      throw new Error(pesan);
    }
    const blob = await response.blob();
    const excelBlob = new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(excelBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "database_payroll_" + new Date().toISOString().split("T")[0] + ".xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ============================================================
// DATABASE HM (HOURS METER UNIT BEROPERASI)
// ============================================================
let dataHmCache = [];
let dataHmPeriodeMeta = { periode: 'harian', tglMulai: '', tglAkhir: '' };

const filterTglHmEl = document.getElementById('filterTanggalHm');
if (filterTglHmEl) {
  filterTglHmEl.value = new Date().toISOString().split('T')[0];
}

document.getElementById('btnMuatHm')?.addEventListener('click', muatHm);
document.getElementById('filterPeriodeHm')?.addEventListener('change', muatHm);
document.getElementById('searchHm')?.addEventListener('input', renderTabelHm);
document.getElementById('btnTambahHm')?.addEventListener('click', () => bukaModalTambahAtauEditHm());
document.getElementById('btnExportCsvHm')?.addEventListener('click', exportCsvHm);
document.getElementById('btnSimpanSemuaHm')?.addEventListener('click', simpanSemuaRowHm);

async function simpanSemuaRowHm() {
  const tbody = document.getElementById('tbodyHm');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr[data-user-id]');
  if (!rows.length) {
    alert('Tidak ada data karyawan yang tampil untuk disimpan');
    return;
  }

  const tglRef = document.getElementById('filterTanggalHm')?.value || new Date().toISOString().split('T')[0];
  let countSaved = 0;
  let countSkipped = 0;

  for (const tr of rows) {
    const uId = tr.dataset.userId;
    const btnSave = tr.querySelector('.btn-save-row-hm');
    const kodeUnit = tr.querySelector('.in-hm-unit')?.value.trim();
    const hmAwal = Number(tr.querySelector('.in-hm-awal')?.value || 0);
    const hmAkhir = Number(tr.querySelector('.in-hm-akhir')?.value || 0);
    const ket = tr.querySelector('.in-hm-ket')?.value.trim();

    // Lewati baris jika kode unit belum diisi
    if (!kodeUnit) {
      countSkipped++;
      continue;
    }

    if (hmAkhir < hmAwal) {
      alert(`⚠️ [Warning] Unit ${kodeUnit}: HM Akhir tidak boleh lebih kecil dari HM Awal`);
      continue;
    }

    try {
      const hmId = btnSave?.dataset.hmId;
      if (hmId) {
        await apiJson(`/api/admin/hm/${hmId}`, 'PATCH', {
          tanggal: tglRef,
          kode_unit: kodeUnit,
          hm_awal: hmAwal,
          hm_akhir: hmAkhir,
          keterangan: ket || null,
        });
      } else {
        await apiJson('/api/admin/hm', 'POST', {
          user_id: uId,
          tanggal: tglRef,
          kode_unit: kodeUnit,
          hm_awal: hmAwal,
          hm_akhir: hmAkhir,
          keterangan: ket || null,
        });
      }
      countSaved++;
    } catch (err) {
      console.error('Gagal simpan row:', uId, err.message);
    }
  }

  alert(`✔ Sukses menyimpan ${countSaved} data HM karyawan! (${countSkipped} baris tanpa kode unit dilewati)`);
  muatHm();
}

async function muatHm() {
  const tbody = document.getElementById('tbodyHm');
  if (!tbody) return;

  const periode = document.getElementById('filterPeriodeHm')?.value || 'harian';
  const tglRef = document.getElementById('filterTanggalHm')?.value || new Date().toISOString().split('T')[0];

  tbody.innerHTML = '<tr><td colspan="10" class="tabel__kosong">Memuat data HM...</td></tr>';

  try {
    const res = await api(`/api/admin/hm?periode=${periode}&tanggal=${tglRef}`);
    dataHmCache = res.rekap || [];
    dataHmPeriodeMeta = {
      periode: res.periode,
      tglMulai: res.tanggal_mulai,
      tglAkhir: res.tanggal_akhir,
    };

    const labelMeta = document.getElementById('labelKeteranganPeriodeHm');
    if (labelMeta) {
      if (res.periode === 'harian') {
        labelMeta.textContent = `📅 Periode Harian: ${formatTanggalStr(res.tanggal_mulai)}`;
      } else {
        labelMeta.textContent = `📅 Periode ${res.periode === 'mingguan' ? 'Mingguan' : 'Bulanan'}: ${res.tanggal_mulai} s/d ${res.tanggal_akhir}`;
      }
    }

    renderTabelHm();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="tabel__kosong">Gagal memuat: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTabelHm() {
  const tbody = document.getElementById('tbodyHm');
  const theadRow = document.getElementById('theadRowHm');
  if (!tbody) return;

  const periode = dataHmPeriodeMeta.periode;
  const q = (document.getElementById('searchHm')?.value || '').toLowerCase().trim();

  const filtered = dataHmCache.filter((r) => {
    if (!q) return true;
    return (
      (r.employee_id || '').toLowerCase().includes(q) ||
      (r.nama_karyawan || '').toLowerCase().includes(q) ||
      (r.jabatan || '').toLowerCase().includes(q) ||
      (r.kode_unit || '').toLowerCase().includes(q)
    );
  });

  // Dynamic Header
  if (theadRow) {
    if (periode === 'harian') {
      theadRow.innerHTML = `
        <th>No</th>
        <th>Employee ID</th>
        <th>Nama Karyawan</th>
        <th>Jabatan</th>
        <th>Kode Unit</th>
        <th>HM Awal</th>
        <th>HM Akhir</th>
        <th>Total HM</th>
        <th>Keterangan</th>
        <th>Aksi</th>
      `;
    } else {
      theadRow.innerHTML = `
        <th>No</th>
        <th>Employee ID</th>
        <th>Nama Karyawan</th>
        <th>Jabatan</th>
        <th>Kode Unit</th>
        <th>Hari Operasi</th>
        <th>HM Awal Periode</th>
        <th>HM Akhir Periode</th>
        <th>Total HM Periode</th>
        <th>Rata-Rata HM/Hari</th>
      `;
    }
  }

  // Summary KPI Cards
  const elTotalHm = document.getElementById('kpiHmTotal');
  const elUnitCount = document.getElementById('kpiHmUnitCount');
  const elRataHm = document.getElementById('kpiHmRata');

  const count = filtered.length;
  const uniqueUnits = new Set(filtered.map((x) => x.kode_unit)).size;
  const sumTotalHm = filtered.reduce((acc, curr) => acc + Number(periode === 'harian' ? curr.total_hm : curr.total_hm_periode || 0), 0);
  const avgHm = count > 0 ? (sumTotalHm / count).toFixed(2) : '0.00';

  if (elTotalHm) elTotalHm.textContent = `${sumTotalHm.toFixed(2)} Jam`;
  if (elUnitCount) elUnitCount.textContent = `${uniqueUnits} Unit`;
  if (elRataHm) elRataHm.textContent = `${avgHm} Jam`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${periode === 'harian' ? 10 : 10}" class="tabel__kosong">Tidak ada data HM unit beroperasi</td></tr>`;
    return;
  }

  if (periode === 'harian') {
    tbody.innerHTML = filtered.map((r, index) => {
      const isSaved = Boolean(r.is_saved && r.hm_id);
      return `
        <tr data-user-id="${r.user_id}" style="${isSaved ? 'background:#f1f8e9;' : ''}">
          <td>${index + 1}</td>
          <td>${r.employee_id ? `<code style="background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:600;">${escapeHtml(r.employee_id)}</code>` : '<span class="pil pil--netral">—</span>'}</td>
          <td><b>${escapeHtml(r.nama_karyawan)}</b></td>
          <td>${escapeHtml(r.jabatan || '—')}</td>
          <td>
            <input type="text" class="in-hm-unit" data-user-id="${r.user_id}" value="${escapeHtml(r.kode_unit)}" placeholder="DT-01" style="width:85px;font-weight:bold;text-transform:uppercase;padding:4px 6px;border-radius:4px;border:1px solid #ccc;" />
          </td>
          <td>
            <input type="number" class="in-hm-awal" data-user-id="${r.user_id}" value="${r.hm_awal || 0}" step="0.1" min="0" style="width:80px;padding:4px 6px;border-radius:4px;border:1px solid #ccc;" />
          </td>
          <td>
            <input type="number" class="in-hm-akhir" data-user-id="${r.user_id}" value="${r.hm_akhir || 0}" step="0.1" min="0" style="width:80px;padding:4px 6px;border-radius:4px;border:1px solid #ccc;" />
          </td>
          <td>
            <b class="lbl-total-hm" data-user-id="${r.user_id}" style="color:#2e7d32;font-size:13px;">${Number(r.total_hm || 0).toFixed(2)} Jam</b>
          </td>
          <td>
            <input type="text" class="in-hm-ket" data-user-id="${r.user_id}" value="${escapeHtml(r.keterangan)}" placeholder="Catatan..." style="width:130px;padding:4px 6px;border-radius:4px;border:1px solid #ccc;" />
          </td>
          <td>
            <button class="tombol tombol--utama tombol--kecil btn-save-row-hm" data-user-id="${r.user_id}" data-hm-id="${r.hm_id || ''}" style="${isSaved ? 'background:#2e7d32;border-color:#2e7d32;' : ''}">${isSaved ? '✔ Tersimpan' : '💾 Simpan'}</button>
            ${isSaved ? `<button class="tombol tombol--ghost tombol--kecil btn-del-row-hm" data-hm-id="${r.hm_id}" data-nama="${escapeHtml(r.nama_karyawan)}" style="color:#c62828;border-color:#ef9a9a;margin-left:4px;">Hapus</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    // Real-time calculation on input change
    tbody.querySelectorAll('tr').forEach((tr) => {
      const uId = tr.dataset.userId;
      const inAwal = tr.querySelector('.in-hm-awal');
      const inAkhir = tr.querySelector('.in-hm-akhir');
      const lblTotal = tr.querySelector('.lbl-total-hm');

      function updateCalc() {
        const awal = Number(inAwal.value || 0);
        const akhir = Number(inAkhir.value || 0);
        const diff = Math.max(0, akhir - awal);
        lblTotal.textContent = `${diff.toFixed(2)} Jam`;
      }

      if (inAwal && inAkhir && lblTotal) {
        inAwal.addEventListener('input', updateCalc);
        inAkhir.addEventListener('input', updateCalc);
      }
    });

    // Save individual row button
    tbody.querySelectorAll('.btn-save-row-hm').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const uId = btn.dataset.userId;
        const tr = tbody.querySelector(`tr[data-user-id="${uId}"]`);
        if (!tr) return;

        const kodeUnit = tr.querySelector('.in-hm-unit').value.trim();
        const hmAwal = Number(tr.querySelector('.in-hm-awal').value || 0);
        const hmAkhir = Number(tr.querySelector('.in-hm-akhir').value || 0);
        const ket = tr.querySelector('.in-hm-ket').value.trim();
        const tglRef = document.getElementById('filterTanggalHm')?.value || new Date().toISOString().split('T')[0];

        if (!kodeUnit) {
          alert('Mohon isi Kode Unit terlebih dahulu');
          tr.querySelector('.in-hm-unit').focus();
          return;
        }
        if (hmAkhir < hmAwal) {
          alert('HM Akhir tidak boleh lebih kecil dari HM Awal');
          return;
        }

        btn.disabled = true;
        btn.textContent = '⏳...';

        try {
          const hmId = btn.dataset.hmId;
          if (hmId) {
            await apiJson(`/api/admin/hm/${hmId}`, 'PATCH', {
              tanggal: tglRef,
              kode_unit: kodeUnit,
              hm_awal: hmAwal,
              hm_akhir: hmAkhir,
              keterangan: ket || null,
            });
          } else {
            await apiJson('/api/admin/hm', 'POST', {
              user_id: uId,
              tanggal: tglRef,
              kode_unit: kodeUnit,
              hm_awal: hmAwal,
              hm_akhir: hmAkhir,
              keterangan: ket || null,
            });
          }
          muatHm();
        } catch (err) {
          alert('Gagal menyimpan HM: ' + err.message);
          btn.disabled = false;
          btn.textContent = '💾 Simpan';
        }
      });
    });

    // Delete saved row
    tbody.querySelectorAll('.btn-del-row-hm').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.hmId;
        const nama = btn.dataset.nama;
        if (!confirm(`Yakin ingin menghapus data HM untuk "${nama}"?`)) return;
        try {
          const res = await apiJson(`/api/admin/hm/${id}`, 'DELETE');
          alert(res.message);
          muatHm();
        } catch (err) {
          alert('Gagal menghapus: ' + err.message);
        }
      });
    });
  } else {
    // Mode Rekap Mingguan / Bulanan
    tbody.innerHTML = filtered.map((r, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${r.employee_id ? `<code style="background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:600;">${escapeHtml(r.employee_id)}</code>` : '<span class="pil pil--netral">—</span>'}</td>
        <td><b>${escapeHtml(r.nama_karyawan)}</b></td>
        <td>${escapeHtml(r.jabatan || '—')}</td>
        <td><b style="color:#1565C0;">${escapeHtml(r.kode_unit)}</b></td>
        <td><span class="pil pil--ok">${r.total_hari_operasi} Hari</span></td>
        <td>${Number(r.hm_awal_periode).toFixed(2)}</td>
        <td>${Number(r.hm_akhir_periode).toFixed(2)}</td>
        <td><b style="color:#2e7d32;">${Number(r.total_hm_periode).toFixed(2)} Jam</b></td>
        <td><b>${Number(r.avg_hm_per_hari).toFixed(2)} Jam/Hari</b></td>
      </tr>
    `).join('');
  }
}

async function bukaModalTambahAtauEditHm(item = null) {
  const isEdit = Boolean(item);
  let listKaryawan = [];
  try {
    listKaryawan = await api('/api/admin/karyawan');
  } catch (err) {
    console.error('Gagal memuat list karyawan dropdown:', err.message);
  }

  const opsiKaryawan = listKaryawan.map((k) => `
    <option value="${escapeHtml(k.id)}" data-emp-id="${escapeHtml(k.employee_id || '')}" data-nama="${escapeHtml(k.nama)}" data-jabatan="${escapeHtml(k.jabatan || '')}" ${item && item.user_id === k.id ? 'selected' : ''}>
      ${escapeHtml(k.nama)} (${escapeHtml(k.employee_id || 'Tanpa ID')}) - ${escapeHtml(k.jabatan || '—')}
    </option>
  `).join('');

  const tglDefault = item ? (typeof item.tanggal === 'string' ? item.tanggal.split('T')[0] : formatTgl(new Date(item.tanggal))) : (document.getElementById('filterTanggalHm')?.value || new Date().toISOString().split('T')[0]);

  bukaModal(`
    <h3>${isEdit ? 'Edit Data HM Unit' : '+ Catat Data HM Unit Harian'}</h3>
    <form id="formHm">
      ${!isEdit ? `
        <label class="label">Pilih Karyawan / Operator (Dropdown Database)</label>
        <select id="hmUserIdSelect" class="input-filter" style="width:100%;margin-bottom:12px;" required>
          <option value="">-- Pilih Karyawan --</option>
          ${opsiKaryawan}
        </select>
      ` : `
        <label class="label">Nama Karyawan</label>
        <input type="text" id="hmNamaPreview" value="${escapeHtml(item.nama_karyawan)}" readonly style="background:#f5f5f5;font-weight:bold;" />
      `}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="label">Employee ID</label>
          <input type="text" id="hmEmpIdPreview" value="${escapeHtml(item?.employee_id || '')}" readonly placeholder="Otomatis" style="background:#f5f5f5;" />
        </div>
        <div>
          <label class="label">Jabatan</label>
          <input type="text" id="hmJabatanPreview" value="${escapeHtml(item?.jabatan || '')}" readonly placeholder="Otomatis" style="background:#f5f5f5;" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;">
        <div>
          <label class="label">Tanggal Operasi</label>
          <input type="date" id="hmTanggalInput" value="${tglDefault}" required />
        </div>
        <div>
          <label class="label">Kode Unit (Contoh: DT-01, EX-02)</label>
          <input type="text" id="hmKodeUnitInput" value="${escapeHtml(item?.kode_unit || '')}" placeholder="DT-01" required style="font-weight:bold;text-transform:uppercase;" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:8px;">
        <div>
          <label class="label">HM Awal</label>
          <input type="number" id="hmAwalInput" value="${item?.hm_awal || 0}" step="0.1" min="0" required />
        </div>
        <div>
          <label class="label">HM Akhir</label>
          <input type="number" id="hmAkhirInput" value="${item?.hm_akhir || 0}" step="0.1" min="0" required />
        </div>
        <div>
          <label class="label">Total HM (Otomatis)</label>
          <input type="text" id="hmTotalPreview" value="${item?.total_hm ? Number(item.total_hm).toFixed(2) + ' Jam' : '0.00 Jam'}" readonly style="background:#e8f5e9;color:#2e7d32;font-weight:bold;" />
        </div>
      </div>

      <label class="label" style="margin-top:8px;">Keterangan / Catatan Operasi</label>
      <input type="text" id="hmKeteranganInput" value="${escapeHtml(item?.keterangan || '')}" placeholder="Catatan jam kerja / kendala..." />

      <div class="modal__aksi" style="margin-top:16px;">
        <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Data HM</button>
      </div>
      <p id="pesanHm" class="modal__pesan" hidden></p>
    </form>
  `);

  const selectUser = document.getElementById('hmUserIdSelect');
  if (selectUser) {
    selectUser.addEventListener('change', () => {
      const opt = selectUser.options[selectUser.selectedIndex];
      if (opt && opt.value) {
        document.getElementById('hmEmpIdPreview').value = opt.dataset.empId || '';
        document.getElementById('hmJabatanPreview').value = opt.dataset.jabatan || '';
      } else {
        document.getElementById('hmEmpIdPreview').value = '';
        document.getElementById('hmJabatanPreview').value = '';
      }
    });
  }

  const inAwal = document.getElementById('hmAwalInput');
  const inAkhir = document.getElementById('hmAkhirInput');
  const inTotal = document.getElementById('hmTotalPreview');

  function calcTotal() {
    const awal = Number(inAwal.value || 0);
    const akhir = Number(inAkhir.value || 0);
    const diff = Math.max(0, akhir - awal);
    inTotal.value = `${diff.toFixed(2)} Jam`;
  }

  inAwal.addEventListener('input', calcTotal);
  inAkhir.addEventListener('input', calcTotal);

  document.getElementById('formHm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pesanEl = document.getElementById('pesanHm');

    const valAwal = Number(inAwal.value || 0);
    const valAkhir = Number(inAkhir.value || 0);
    if (valAkhir < valAwal) {
      pesanEl.textContent = '⚠️ HM Akhir tidak boleh lebih kecil dari HM Awal';
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
      return;
    }

    let body = {
      tanggal: document.getElementById('hmTanggalInput').value,
      kode_unit: document.getElementById('hmKodeUnitInput').value.trim(),
      hm_awal: valAwal,
      hm_akhir: valAkhir,
      keterangan: document.getElementById('hmKeteranganInput').value.trim() || null,
    };

    if (!isEdit) {
      const uId = selectUser.value;
      const opt = selectUser.options[selectUser.selectedIndex];
      if (!uId || !opt) {
        alert('Pilih karyawan terlebih dahulu!');
        return;
      }
      body.user_id = uId;
      body.employee_id = opt.dataset.empId || null;
      body.nama_karyawan = opt.dataset.nama || '';
      body.jabatan = opt.dataset.jabatan || null;
    }

    try {
      if (isEdit) {
        await apiJson(`/api/admin/hm/${item.id}`, 'PATCH', body);
      } else {
        await apiJson('/api/admin/hm', 'POST', body);
      }
      tutupModal();
      muatHm();
    } catch (err) {
      pesanEl.textContent = err.message;
      pesanEl.className = 'modal__pesan modal__pesan--error';
      pesanEl.hidden = false;
    }
  });
}

function exportCsvHm() {
  if (!dataHmCache.length) {
    alert('Tidak ada data HM untuk diexport');
    return;
  }

  const periode = dataHmPeriodeMeta.periode;
  let rows = [];
  let header = '';

  if (periode === 'harian') {
    rows = dataHmCache.map((r, i) => `${i + 1},"${r.employee_id || ''}","${r.nama_karyawan}","${r.jabatan || ''}","${r.kode_unit}",${r.hm_awal},${r.hm_akhir},${r.total_hm},"${r.keterangan || ''}"`);
    header = '"No","Employee ID","Nama Karyawan","Jabatan","Kode Unit","HM Awal","HM Akhir","Total HM","Keterangan"';
  } else {
    rows = dataHmCache.map((r, i) => `${i + 1},"${r.employee_id || ''}","${r.nama_karyawan}","${r.jabatan || ''}","${r.kode_unit}",${r.total_hari_operasi},${r.hm_awal_periode},${r.hm_akhir_periode},${r.total_hm_periode},${r.avg_hm_per_hari}`);
    header = '"No","Employee ID","Nama Karyawan","Jabatan","Kode Unit","Total Hari Operasi","HM Awal Periode","HM Akhir Periode","Total HM Periode","Rata-Rata HM per Hari"';
  }

  downloadCsv([header, ...rows].join('\n'), `database_hm_${periode}_${new Date().toISOString().split('T')[0]}.csv`);
}

// ============================================================
// KALKULASI PAYROLL KARYAWAN (CUTOFF 26 - 25)
// ============================================================
let dataKalkulasiPayrollCache = [];
let metaKalkulasiPayroll = {};

document.getElementById('btnHitungKalkulasiPayroll')?.addEventListener('click', muatKalkulasiPayroll);
document.getElementById('btnSimpanConfigPayroll')?.addEventListener('click', simpanConfigKalkulasiPayroll);
document.getElementById('searchKalkulasiPayroll')?.addEventListener('input', renderTabelKalkulasiPayroll);
document.getElementById('filterKaryawanKalkulasiPayroll')?.addEventListener('change', renderTabelKalkulasiPayroll);
document.getElementById('btnExportCsvKalkulasiPayroll')?.addEventListener('click', exportCsvKalkulasiPayroll);

async function muatKalkulasiPayroll() {
  const tbody = document.getElementById('tbodyKalkulasiPayroll');
  if (!tbody) return;

  const bulan = document.getElementById('selectBulanPayroll')?.value || '8';
  const tahun = document.getElementById('inputTahunPayroll')?.value || '2026';

  tbody.innerHTML = '<tr><td colspan="13" class="tabel__kosong">Memuat dan menghitung kalkulasi payroll...</td></tr>';

  try {
    const res = await api(`/api/admin/kalkulasi-payroll?bulan=${bulan}&tahun=${tahun}`);
    dataKalkulasiPayrollCache = res.karyawan || [];
    metaKalkulasiPayroll = res;

    // Update Setup Inputs & Labels
    const elReguler = document.getElementById('selectHariLiburReguler');
    const elNasional = document.getElementById('inputLiburNasional');
    const elLabelCutoff = document.getElementById('labelInfoCutoffPayroll');

    if (elReguler && res.config?.hari_libur_reguler) elReguler.value = res.config.hari_libur_reguler;
    if (elNasional && res.config?.hari_libur_nasional) elNasional.value = res.config.hari_libur_nasional;
    if (elLabelCutoff) {
      elLabelCutoff.textContent = `📅 Periode Cutoff Tutup Buku: ${formatTanggalStr(res.cutoff_mulai)} s/d ${formatTanggalStr(res.cutoff_akhir)} (Tutup Buku Tgl 25 | Total ${res.total_hari_bulan} Hari)`;
    }

    // Populate Karyawan Dropdown Filter
    const selEmp = document.getElementById('filterKaryawanKalkulasiPayroll');
    if (selEmp) {
      selEmp.innerHTML = '<option value="">-- Semua Karyawan --</option>' + dataKalkulasiPayrollCache.map((k) => `
        <option value="${escapeHtml(k.user_id)}">${escapeHtml(k.nama_karyawan)} (${escapeHtml(k.employee_id)})</option>
      `).join('');
    }

    // Update KPI Summary Cards
    const ringkasan = res.ringkasan || {};
    document.getElementById('kpiSumGajiPokok').textContent = `Rp ${(ringkasan.sum_gaji_pokok || 0).toLocaleString('id-ID')}`;
    document.getElementById('kpiSumTunjKehadiran').textContent = `Rp ${(ringkasan.sum_tunj_kehadiran || 0).toLocaleString('id-ID')}`;
    document.getElementById('kpiSumInsentifHm').textContent = `Rp ${(ringkasan.sum_insentif_hm || 0).toLocaleString('id-ID')}`;
    document.getElementById('kpiSumTakeHomePay').textContent = `Rp ${(ringkasan.total_take_home_pay || 0).toLocaleString('id-ID')}`;

    renderTabelKalkulasiPayroll();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="13" class="tabel__kosong">Gagal memuat payroll: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function simpanConfigKalkulasiPayroll() {
  const bulan = document.getElementById('selectBulanPayroll')?.value || '8';
  const tahun = document.getElementById('inputTahunPayroll')?.value || '2026';
  const periodKey = `${tahun}-${String(bulan).padStart(2, '0')}`;

  const reguler = document.getElementById('selectHariLiburReguler')?.value || 'minggu';
  const nasional = document.getElementById('inputLiburNasional')?.value || '';

  try {
    const res = await apiJson('/api/admin/kalkulasi-payroll/config', 'POST', {
      periode_key: periodKey,
      hari_libur_reguler: reguler,
      hari_libur_nasional: nasional,
    });
    alert(res.message);
    muatKalkulasiPayroll();
  } catch (err) {
    alert('Gagal menyimpan skema: ' + err.message);
  }
}

function renderTabelKalkulasiPayroll() {
  const tbody = document.getElementById('tbodyKalkulasiPayroll');
  if (!tbody) return;

  const q = (document.getElementById('searchKalkulasiPayroll')?.value || '').toLowerCase().trim();
  const selectedEmpId = document.getElementById('filterKaryawanKalkulasiPayroll')?.value || '';

  const filtered = dataKalkulasiPayrollCache.filter((k) => {
    if (selectedEmpId && k.user_id !== selectedEmpId) return false;
    if (!q) return true;
    return (
      (k.employee_id || '').toLowerCase().includes(q) ||
      (k.nama_karyawan || '').toLowerCase().includes(q) ||
      (k.jabatan || '').toLowerCase().includes(q)
    );
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="tabel__kosong">Tidak ada data kalkulasi payroll</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((k, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${k.employee_id !== '-' ? `<code style="background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:600;">${escapeHtml(k.employee_id)}</code>` : '<span class="pil pil--netral">—</span>'}</td>
      <td><b>${escapeHtml(k.nama_karyawan)}</b></td>
      <td>${escapeHtml(k.jabatan || '—')}</td>
      <td>
        <span style="font-size:12px;">${k.date_in}</span>
        ${k.is_prorate ? '<br/><span class="pil pil--peringatan" style="font-size:10px;padding:1px 4px;">Prorate (&lt;1 Bulan)</span>' : ''}
      </td>
      <td><span class="pil pil--ok">${k.hari_kerja_actual} Hari</span></td>
      <td>
        <b>Rp ${k.gaji_pokok_final.toLocaleString('id-ID')}</b>
        ${k.is_prorate ? `<br/><span style="font-size:10px;color:#64748b;">(Master: Rp ${k.gaji_pokok_master.toLocaleString('id-ID')})</span>` : ''}
      </td>
      <td>Rp ${k.tunj_kehadiran_total.toLocaleString('id-ID')}</td>
      <td>Rp ${k.tunj_jabatan.toLocaleString('id-ID')}</td>
      <td>${k.is_operator_driver ? `<b style="color:#1565C0;">${k.total_hm} Jam</b>` : '<span style="color:#94a3b8;">—</span>'}</td>
      <td>${k.is_operator_driver ? `<b style="color:#d97706;">Rp ${(k.insentif_hm_total || 0).toLocaleString('id-ID')}</b>` : '<span style="color:#94a3b8;">—</span>'}</td>
      <td><b style="color:#15803d;font-size:14px;background:#f0fdf4;padding:4px 8px;border-radius:6px;border:1px solid #bbf7d0;">Rp ${k.take_home_pay.toLocaleString('id-ID')}</b></td>
      <td>
        <button class="tombol tombol--ghost tombol--kecil btn-detail-slip" data-emp-id="${k.user_id}" style="color:#1565C0;border-color:#90caf9;">🖨️ Detail Slip</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-detail-slip').forEach((btn) => {
    btn.addEventListener('click', () => {
      // user_id dari API adalah number, dataset selalu string — gunakan == atau cast
      const item = dataKalkulasiPayrollCache.find((x) => String(x.user_id) === String(btn.dataset.empId));
      if (item) bukaModalSlipGaji(item);
    });
  });
}

function bukaModalSlipGaji(item) {
  const meta = metaKalkulasiPayroll;

  let detailGajiPokok = `<b>Rp ${item.gaji_pokok_final.toLocaleString('id-ID')}</b> (Full Bulan)`;
  if (item.is_prorate_masa_kerja) {
    detailGajiPokok = `Rp ${item.gaji_pokok_master.toLocaleString('id-ID')} / ${meta.total_hari_bulan || 31} hr × ${item.hari_kerja_actual} hr = <b>Rp ${item.gaji_pokok_final.toLocaleString('id-ID')}</b> <span style="color:#c0392b;font-size:11px;">(Masa Kerja &lt; 1 Bln)</span>`;
  } else if (item.total_hari_deduksi > 0) {
    const ketDeduksi = [];
    if (item.hari_izin > 0) ketDeduksi.push(`${item.hari_izin} Izin`);
    if (item.hari_sakit > 0) ketDeduksi.push(`${item.hari_sakit} Sakit`);
    if (item.hari_alpa > 0) ketDeduksi.push(`${item.hari_alpa} Alpa`);
    detailGajiPokok = `Rp ${item.gaji_pokok_master.toLocaleString('id-ID')} - (Rp ${item.gaji_pokok_master.toLocaleString('id-ID')} / ${meta.total_hari_bulan || 31} hr × ${item.total_hari_deduksi} hr [${ketDeduksi.join(', ')}]) = <b>Rp ${item.gaji_pokok_final.toLocaleString('id-ID')}</b> <span style="color:#c0392b;font-size:11px;">(Prorate Deduksi)</span>`;
  }

  const detailTunjKehadiran = item.hari_kerja_libur > 0
    ? `${item.hari_kerja_biasa} hr biasa (Rp ${item.tunj_kehadiran_per_hari.toLocaleString('id-ID')}) + ${item.hari_kerja_libur} hr libur (Rp ${(item.tunj_kehadiran_per_hari * 2).toLocaleString('id-ID')}) = <b>Rp ${item.tunj_kehadiran_total.toLocaleString('id-ID')}</b>`
    : `${item.hari_kerja_actual} hari × Rp ${item.tunj_kehadiran_per_hari.toLocaleString('id-ID')} = <b>Rp ${item.tunj_kehadiran_total.toLocaleString('id-ID')}</b>`;

  const detailHm = item.is_operator_driver
    ? `${item.total_hm} Jam × Rp ${(item.insentif_hm_per_jam || 0).toLocaleString('id-ID')} = <b>Rp ${(item.insentif_hm_total || 0).toLocaleString('id-ID')}</b>`
    : '<i style="color:#999">Tidak berlaku (bukan Operator/Driver)</i>';

  const bulanPilihan = meta.bulan || document.getElementById('selectBulanPayroll')?.value || (new Date().getMonth() + 1);
  const tahunPilihan = meta.tahun || document.getElementById('inputTahunPayroll')?.value || new Date().getFullYear();

  bukaModal(`
    <div style="padding:10px;font-family:sans-serif;">
      <div style="text-align:center;border-bottom:2px solid #1a7a4a;padding-bottom:10px;margin-bottom:14px;">
        <h2 style="margin:0;color:#1a7a4a;font-size:18px;">SLIP GAJI KARYAWAN</h2>
        <p style="margin:4px 0 0 0;font-size:12px;color:#64748b;">Periode Cutoff: ${formatTanggalStr(meta.cutoff_mulai)} s/d ${formatTanggalStr(meta.cutoff_akhir)}</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:14px;background:#f0fdf4;padding:10px;border-radius:6px;">
        <div><b>Nama:</b> ${escapeHtml(item.nama_karyawan)}</div>
        <div><b>Employee ID:</b> ${escapeHtml(item.employee_id)}</div>
        <div><b>Jabatan:</b> ${escapeHtml(item.jabatan)}</div>
        <div><b>Hari Kerja Aktual:</b> ${item.hari_kerja_actual} Hari</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <thead>
          <tr style="background:#1a7a4a;color:#fff;text-align:left;">
            <th style="padding:7px 8px;">Komponen Gaji</th>
            <th style="padding:7px 8px;">Rincian Perhitungan</th>
            <th style="padding:7px 8px;text-align:right;">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:7px 8px;">Gaji Pokok ${item.is_prorate ? '(Prorate)' : '(Full)'}</td>
            <td style="padding:7px 8px;font-size:12px;">${detailGajiPokok}</td>
            <td style="padding:7px 8px;text-align:right;font-weight:bold;">Rp ${item.gaji_pokok_final.toLocaleString('id-ID')}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0;background:#f9fafb;">
            <td style="padding:7px 8px;">Tunjangan Kehadiran</td>
            <td style="padding:7px 8px;font-size:12px;">${detailTunjKehadiran}</td>
            <td style="padding:7px 8px;text-align:right;">Rp ${item.tunj_kehadiran_total.toLocaleString('id-ID')}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:7px 8px;">Tunjangan Jabatan</td>
            <td style="padding:7px 8px;font-size:12px;">—</td>
            <td style="padding:7px 8px;text-align:right;">Rp ${item.tunj_jabatan.toLocaleString('id-ID')}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0;background:#f9fafb;">
            <td style="padding:7px 8px;">Insentif HM (Hours Meter)</td>
            <td style="padding:7px 8px;font-size:12px;">${detailHm}</td>
            <td style="padding:7px 8px;text-align:right;">${item.is_operator_driver ? 'Rp ' + (item.insentif_hm_total || 0).toLocaleString('id-ID') : '—'}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr style="background:#1a7a4a;color:#fff;font-size:14px;font-weight:bold;">
            <td style="padding:10px 8px;" colspan="2">TOTAL TAKE HOME PAY</td>
            <td style="padding:10px 8px;text-align:right;">Rp ${item.take_home_pay.toLocaleString('id-ID')}</td>
          </tr>
        </tfoot>
      </table>

      <div style="text-align:right;margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
        <button class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>
        <button class="tombol tombol--utama" onclick="unduhSlipGajiPdfAdmin('${item.user_id}', ${bulanPilihan}, ${tahunPilihan})">
          📄 Unduh PDF (Tanpa Password)
        </button>
      </div>
    </div>
  `);
}

async function unduhSlipGajiPdfAdmin(userId, bulan, tahun) {
  const BASE = getApiBaseUrl();
  try {
    const token = state.token;
    if (!token) { alert('Sesi admin habis. Silakan login ulang.'); return; }
    if (!userId || !bulan || !tahun) { alert('Parameter tidak lengkap (user_id / bulan / tahun kosong).'); return; }

    const url = `${BASE}/api/admin/kalkulasi-payroll/slip-pdf?user_id=${userId}&bulan=${bulan}&tahun=${tahun}`;
    console.log('[SlipGaji Admin] Unduh PDF:', url);

    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg = errText;
      try { errMsg = JSON.parse(errText).error || errText; } catch(_) {}
      alert('Gagal mengunduh PDF (HTTP ' + resp.status + '):\n' + errMsg);
      return;
    }

    const contentType = resp.headers.get('Content-Type') || '';
    if (!contentType.includes('pdf')) {
      alert('Response bukan PDF. Content-Type: ' + contentType);
      return;
    }

    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const cd = resp.headers.get('Content-Disposition') || '';
    const fnMatch = cd.match(/filename="([^"]+)"/);
    a.download = fnMatch ? fnMatch[1] : `SlipGaji_Admin_${bulan}_${tahun}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    alert('Gagal mengunduh PDF: ' + err.message);
    console.error('[SlipGaji Admin] Error:', err);
  }
}


function exportCsvKalkulasiPayroll() {
  if (!dataKalkulasiPayrollCache.length) {
    alert('Tidak ada data kalkulasi payroll untuk diexport');
    return;
  }

  const header = '"No","Employee ID","Nama Karyawan","Jabatan","Date In","Is Prorate","Hari Kerja Actual","Hari Biasa","Hari Libur (2x)","Hari Izin","Hari Sakit","Hari Alpa","Potongan Deduksi","Gaji Pokok Final","Tunjangan Kehadiran Total","Tunjangan Jabatan","Total HM","Insentif HM Total","Take Home Pay"';
  const rows = dataKalkulasiPayrollCache.map((k, i) =>
    `${i + 1},"${k.employee_id}","${k.nama_karyawan}","${k.jabatan}","${k.date_in}",${k.is_prorate},${k.hari_kerja_actual},${k.hari_kerja_biasa || 0},${k.hari_kerja_libur || 0},${k.hari_izin || 0},${k.hari_sakit || 0},${k.hari_alpa || 0},${k.potongan_deduksi || 0},${k.gaji_pokok_final},${k.tunj_kehadiran_total},${k.tunj_jabatan},${k.total_hm || 0},${k.insentif_hm_total || 0},${k.take_home_pay}`
  );

  const periodeStr = `${metaKalkulasiPayroll.tahun || 2026}_${metaKalkulasiPayroll.bulan || 8}`;
  downloadCsv([header, ...rows].join('\n'), `kalkulasi_payroll_${periodeStr}.csv`);
}

// ============================================================
// EDIT PROFIL & KELOLA OTORITAS AKUN ADMIN
// ============================================================
async function bukaModalEditProfilAdmin() {
  let adminMe = null;
  try {
    adminMe = await api('/api/admin/me');
  } catch (err) {
    alert('Gagal memuat data profil admin: ' + err.message);
    return;
  }

  const isSuper = adminMe.is_super_admin;

  bukaModal(`
    <div style="min-width: 520px; max-width: 680px;">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:6px;color:var(--tinta-utama);">⚙️ Pengaturan Profil & Akun Admin</h2>
      <p style="font-size:13px;color:var(--tinta-lembut);margin-bottom:16px;">Kelola email & password Anda, serta otoritas hak akses akun admin lainnya.</p>

      <div style="display:flex;gap:8px;border-bottom:1px solid #e0e0e0;margin-bottom:16px;">
        <button type="button" id="tabSubProfilSaya" class="tombol" style="background:#10B981;color:#fff;border-radius:6px 6px 0 0;padding:8px 16px;font-size:13px;font-weight:600;" onclick="switchModalSubTab('profilSaya')">👤 Profil Saya</button>
        ${isSuper ? `<button type="button" id="tabSubKelolaAdmin" class="tombol tombol--ghost" style="border-radius:6px 6px 0 0;padding:8px 16px;font-size:13px;font-weight:600;" onclick="switchModalSubTab('kelolaAdmin')">👑 Kelola Otoritas Admin (Admin Utama)</button>` : ''}
      </div>

      <!-- PANEL 1: PROFIL SAYA -->
      <div id="panelSubProfilSaya">
        <form id="formEditProfilSelf">
          <div style="margin-bottom:12px;">
            <label class="label">Nama Admin</label>
            <input type="text" id="editSelfNama" class="input-teks" value="${escapeHtml(adminMe.nama)}" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" />
          </div>

          <div style="margin-bottom:12px;">
            <label class="label">Email Admin</label>
            <input type="email" id="editSelfEmail" class="input-teks" value="${escapeHtml(adminMe.email)}" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" />
          </div>

          <div style="border-top:1px dashed #ccc;padding-top:12px;margin-top:12px;margin-bottom:12px;">
            <span style="font-size:12px;font-weight:bold;color:#555;">UBAH PASSWORD (OPSIONAL)</span>
            <div style="margin-top:8px;">
              <label class="label">Password Lama</label>
              <input type="password" id="editSelfPassLama" class="input-teks" placeholder="Masukkan password saat ini" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" />
            </div>
            <div style="margin-top:8px;">
              <label class="label">Password Baru (min. 6 karakter)</label>
              <input type="password" id="editSelfPassBaru" class="input-teks" placeholder="••••••••" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" />
            </div>
          </div>

          <div id="msgEditSelf" style="font-size:13px;margin-bottom:12px;"></div>

          <div class="modal__aksi" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button>
            <button type="submit" class="tombol tombol--utama" style="background:#10B981;">Simpan Perubahan Profil</button>
          </div>
        </form>
      </div>

      <!-- PANEL 2: KELOLA SUB-ADMIN (KHUSUS ADMIN UTAMA) -->
      ${isSuper ? `
      <div id="panelSubKelolaAdmin" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <span style="font-size:13px;color:var(--tinta-lembut);">Daftar akun admin & batasan otoritas akses modul:</span>
          <button type="button" class="tombol tombol--utama" style="font-size:12px;padding:6px 12px;background:#10B981;" onclick="bukaModalFormTambahSubAdmin()">+ Tambah Admin Baru</button>
        </div>
        <div id="isiSubAdminsList" style="max-height:300px;overflow-y:auto;"><p>Memuat daftar admin...</p></div>
        <div class="modal__aksi" style="margin-top:16px;display:flex;justify-content:flex-end;">
          <button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>
        </div>
      </div>
      ` : ''}

    </div>
  `);

  document.getElementById('formEditProfilSelf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('msgEditSelf');
    msgEl.innerHTML = '<span style="color:blue">Menyimpan...</span>';

    const nama = document.getElementById('editSelfNama').value.trim();
    const email = document.getElementById('editSelfEmail').value.trim();
    const password_lama = document.getElementById('editSelfPassLama').value;
    const password_baru = document.getElementById('editSelfPassBaru').value;

    try {
      const res = await apiJson('/api/admin/me', 'PATCH', { nama, email, password_lama, password_baru });
      msgEl.innerHTML = `<span style="color:green">✅ ${escapeHtml(res.message)}</span>`;
      state.nama = res.admin.nama;
      localStorage.setItem('admin_nama', res.admin.nama);
      document.getElementById('namaAdminSidebar').textContent = res.admin.nama + (res.admin.is_super_admin ? ' (Admin Utama)' : '');
      setTimeout(() => tutupModal(), 1200);
    } catch (err) {
      msgEl.innerHTML = `<span style="color:red">❌ ${escapeHtml(err.message)}</span>`;
    }
  });

  if (isSuper) {
    muatSubAdminsList();
  }
}

function switchModalSubTab(tab) {
  const btnSaya = document.getElementById('tabSubProfilSaya');
  const btnKelola = document.getElementById('tabSubKelolaAdmin');
  const panelSaya = document.getElementById('panelSubProfilSaya');
  const panelKelola = document.getElementById('panelSubKelolaAdmin');

  if (tab === 'profilSaya') {
    btnSaya.style.background = '#10B981';
    btnSaya.style.color = '#fff';
    if (btnKelola) { btnKelola.style.background = 'transparent'; btnKelola.style.color = 'inherit'; }
    panelSaya.style.display = 'block';
    if (panelKelola) panelKelola.style.display = 'none';
  } else {
    btnKelola.style.background = '#10B981';
    btnKelola.style.color = '#fff';
    btnSaya.style.background = 'transparent';
    btnSaya.style.color = 'inherit';
    panelKelola.style.display = 'block';
    panelSaya.style.display = 'none';
  }
}

const MODUL_NAMES_MAP = {
  'absensi': '📍 Absensi & Lokasi',
  'karyawan': '👥 Database Karyawan',
  'performa': '📊 Rekap Performa',
  'registrasi': '📝 Registrasi Pending',
  'payroll': '💰 Database Payroll',
  'hm': '🚜 Database HM',
  'kalkulasiPayroll': '🧮 Kalkulasi Payroll'
};

async function muatSubAdminsList() {
  const el = document.getElementById('isiSubAdminsList');
  if (!el) return;
  el.innerHTML = '<p>Memuat...</p>';

  try {
    const list = await api('/api/admin/sub-admins');
    if (!list.length) {
      el.innerHTML = '<p style="color:var(--tinta-lembut)">Belum ada akun admin tambahan.</p>';
      return;
    }

    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
        <thead>
          <tr style="background:#f1f5f9;color:#475569;">
            <th style="padding:8px;border-bottom:1px solid #e2e8f0;">Nama</th>
            <th style="padding:8px;border-bottom:1px solid #e2e8f0;">Email</th>
            <th style="padding:8px;border-bottom:1px solid #e2e8f0;">Otoritas Modul</th>
            <th style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(a => {
            const isUtama = a.is_super_admin;
            const perms = isUtama ? Object.keys(MODUL_NAMES_MAP) : (a.permissions || []);
            const badgeText = isUtama ? '<b style="color:#059669;">Full (Admin Utama)</b>' : perms.map(p => MODUL_NAMES_MAP[p] || p).join(', ');

            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:8px;"><b>${escapeHtml(a.nama)}</b> ${isUtama ? '👑' : ''}</td>
                <td style="padding:8px;">${escapeHtml(a.email)}</td>
                <td style="padding:8px;font-size:11px;max-width:200px;">${badgeText}</td>
                <td style="padding:8px;text-align:right;">
                  ${!isUtama ? `
                    <button type="button" class="tombol tombol--ghost" style="font-size:11px;padding:4px 8px;" onclick="bukaModalFormEditSubAdmin('${a.id}')">Edit Otoritas</button>
                    <button type="button" class="tombol tombol--ghost" style="font-size:11px;padding:4px 8px;color:red;" onclick="hapusSubAdminAcc('${a.id}', '${escapeHtml(a.nama)}')">Hapus</button>
                  ` : '<span style="font-size:11px;color:#94a3b8;">Super Admin</span>'}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    el.innerHTML = `<p style="color:red">Gagal: ${escapeHtml(err.message)}</p>`;
  }
}

async function bukaModalFormTambahSubAdmin() {
  bukaModalFormSubAdmin(null);
}

async function bukaModalFormEditSubAdmin(adminId) {
  try {
    const list = await api('/api/admin/sub-admins');
    const admin = list.find(a => a.id === adminId);
    if (!admin) return alert('Admin tidak ditemukan');
    bukaModalFormSubAdmin(admin);
  } catch (e) {
    alert(e.message);
  }
}

function bukaModalFormSubAdmin(adminData) {
  const isEdit = Boolean(adminData);
  const currentPerms = isEdit ? (adminData.permissions || []) : ['absensi', 'karyawan', 'performa', 'registrasi', 'payroll', 'hm', 'kalkulasiPayroll'];

  bukaModal(`
    <div style="min-width: 440px;">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">${isEdit ? '✏️ Edit Otoritas Admin' : '➕ Tambah Akun Admin Baru'}</h3>

      <form id="formSubAdminAcc">
        <div style="margin-bottom:10px;">
          <label class="label">Nama Admin *</label>
          <input type="text" id="subAdminNama" class="input-teks" value="${isEdit ? escapeHtml(adminData.nama) : ''}" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" />
        </div>

        <div style="margin-bottom:10px;">
          <label class="label">Email Admin *</label>
          <input type="email" id="subAdminEmail" class="input-teks" value="${isEdit ? escapeHtml(adminData.email) : ''}" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" />
        </div>

        <div style="margin-bottom:12px;">
          <label class="label">${isEdit ? 'Password (isi jika ingin diganti)' : 'Password *'}</label>
          <input type="password" id="subAdminPass" class="input-teks" placeholder="${isEdit ? 'Biarkan kosong jika tidak diubah' : '••••••••'}" ${isEdit ? '' : 'required'} style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" />
        </div>

        <div style="border:1px solid #cbd5e1;background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:14px;">
          <label style="font-size:12px;font-weight:bold;color:#1e293b;display:block;margin-bottom:8px;">🔑 OTORITAS HAK AKSES MODUL:</label>
          ${Object.keys(MODUL_NAMES_MAP).map(key => `
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:6px;cursor:pointer;">
              <input type="checkbox" class="chk-perm" value="${key}" ${currentPerms.includes(key) ? 'checked' : ''} />
              <span>${MODUL_NAMES_MAP[key]}</span>
            </label>
          `).join('')}
        </div>

        <div id="msgSubAdmin" style="font-size:13px;margin-bottom:12px;"></div>

        <div class="modal__aksi" style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="tombol tombol--ghost" onclick="bukaModalEditProfilAdmin()">Batal</button>
          <button type="submit" class="tombol tombol--utama" style="background:#10B981;">${isEdit ? 'Simpan Otoritas' : 'Buat Akun Admin'}</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById('formSubAdminAcc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msgSubAdmin');
    msg.innerHTML = '<span style="color:blue">Memproses...</span>';

    const nama = document.getElementById('subAdminNama').value.trim();
    const email = document.getElementById('subAdminEmail').value.trim();
    const password = document.getElementById('subAdminPass').value;

    const checkedPerms = Array.from(document.querySelectorAll('.chk-perm:checked')).map(cb => cb.value);

    try {
      if (isEdit) {
        await apiJson(`/api/admin/sub-admins/${adminData.id}`, 'PATCH', { nama, email, password, permissions: checkedPerms });
      } else {
        await apiJson('/api/admin/sub-admins', 'POST', { nama, email, password, permissions: checkedPerms });
      }
      bukaModalEditProfilAdmin();
    } catch (err) {
      msg.innerHTML = `<span style="color:red">❌ ${escapeHtml(err.message)}</span>`;
    }
  });
}

async function hapusSubAdminAcc(id, nama) {
  if (!confirm(`Apakah Anda yakin ingin menghapus akun admin "${nama}"?`)) return;
  try {
    await api(`/api/admin/sub-admins/${id}`, { method: 'DELETE' });
    bukaModalEditProfilAdmin();
  } catch (err) {
    alert('Gagal menghapus admin: ' + err.message);
  }
}

// Expose fungsi ke window agar dapat dipanggil dari HTML onclick
window.bukaModalEditProfilAdmin = bukaModalEditProfilAdmin;
window.switchModalSubTab = switchModalSubTab;
window.muatSubAdminsList = muatSubAdminsList;
window.bukaModalFormTambahSubAdmin = bukaModalFormTambahSubAdmin;
window.bukaModalFormEditSubAdmin = bukaModalFormEditSubAdmin;
window.hapusSubAdminAcc = hapusSubAdminAcc;
