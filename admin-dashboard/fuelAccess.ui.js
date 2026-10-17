/*
 * Akses Fuel (APK OMOS Fuel) — panel admin di halaman Input Fuel + ID/label QR di List Equipment.
 * Tab: Validasi APK · Tutup Shift · Akun · Perangkat · Lokasi & Label · Pengaturan.
 * Semua angka/aturan dari API (/api/admin/fuel-access, /fuel-inventory); browser hanya menampilkan.
 * Aksi simpan memakai OMOSActionFeedback.run (wajib per admin-dashboard/AGENTS.md).
 */
(function (global, factory) {
  const api = factory(global);
  if (global) global.FuelAccessUi = api.ui;
  if (typeof module === 'object' && module.exports) module.exports = api.pure;
})(typeof window !== 'undefined' ? window : globalThis, function createFuelAccessUi(global) {
  'use strict';

  const ACCESS = '/api/admin/fuel-access';
  const INV = '/api/admin/production/fuel-inventory';

  /* ---------- fungsi murni (diuji via node) ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtL(v, digits = 0) {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return '—';
    return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(Number(v))} L`;
  }

  function fmtNum(v, digits = 2) {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return '—';
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(Number(v));
  }

  function fmtWaktu(v) {
    const t = Date.parse(v || '');
    if (!Number.isFinite(t)) return '—';
    return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
  }

  const FUNCTION_LABELS = { fill: 'Isi unit', transfer: 'Transfer', receipt: 'Terima fuel', opname: 'Opname', shift: 'Buka/tutup shift' };
  const FLAG_LABELS = {
    manual_unit: 'Unit dipilih manual', late_entry: 'Dicatat terlambat', over_tank_capacity: 'Melebihi tangki',
    hm_gap_exceeded: 'Selisih HM > waktu', hm_event_required: 'Perlu Event HM', ledger_stock_short: 'Stok ledger kurang',
    device_revoked: 'Perangkat dicabut',
  };
  const SESSION_STATUS = { open: ['Terbuka', 'in'], closed: ['Ditutup', 'ok'], investigation: ['Perlu investigasi', 'bad'], reviewed: ['Sudah direview', 'muted'] };
  const DEVICE_STATUS = { pending: ['Menunggu', 'warn'], approved: ['Disetujui', 'ok'], revoked: ['Dicabut', 'muted'] };

  function functionLabel(code) { return FUNCTION_LABELS[code] || code; }
  function flagLabel(code) { return FLAG_LABELS[code] || code; }

  /** Lembar label siap cetak. format: 'a4' (grid 3 kolom) | 'thermal' (50×30 mm per halaman). */
  function labelSheetHtml(labels, format = 'a4', org = 'OMOS · One Mining Operating System') {
    const thermal = format === 'thermal';
    const page = thermal ? '@page{size:50mm 30mm;margin:0}' : '@page{size:A4;margin:10mm}';
    const item = l => `<div class="lbl"><div class="qr">${l.qr_svg || ''}</div><div class="tx">
        <div class="id">${esc(l.scan_id)}</div><div class="kode">${esc(l.kode)}</div>
        <div class="sub">${esc([l.kelas, l.class_unit].filter(Boolean).join(' · '))}</div><div class="org">${esc(org)}</div></div></div>`;
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Label QR OMOS (${labels.length})</title><style>
      ${page}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;color:#000}
      .sheet{display:${thermal ? 'block' : 'grid'};grid-template-columns:repeat(3,1fr);gap:4mm}
      .lbl{display:flex;gap:2.5mm;align-items:center;border:${thermal ? '0' : '0.3mm dashed #888'};padding:${thermal ? '1.5mm' : '3mm'};
        ${thermal ? 'width:50mm;height:30mm;page-break-after:always;' : 'height:34mm;'}break-inside:avoid}
      .qr{width:${thermal ? '26mm' : '28mm'};height:${thermal ? '26mm' : '28mm'};flex:none}.qr svg{width:100%;height:100%}
      .tx{min-width:0;line-height:1.15}.id{font:700 ${thermal ? '9pt' : '10pt'} ui-monospace,Consolas,monospace;letter-spacing:.04em}
      .kode{font-weight:800;font-size:${thermal ? '11pt' : '13pt'};margin-top:1mm}.sub{font-size:7pt;margin-top:.6mm}.org{font-size:5.5pt;color:#333;margin-top:1.2mm}
      @media screen{body{padding:12px;background:#f1f5f9}.lbl{background:#fff}}
    </style></head><body><div class="sheet">${labels.map(item).join('')}</div>
    <script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});<\/script></body></html>`;
  }

  /** Ringkasan selisih totalizer untuk tampilan (angka dari server). */
  function describeVariance(s) {
    if (s.variance_liter == null) return s.totalizer_close != null && Number(s.totalizer_close) < Number(s.totalizer_open) ? 'Rollover / reset meter' : '—';
    const pct = s.variance_pct == null ? '' : ` (${fmtNum(s.variance_pct, 2)}%)`;
    return `${Number(s.variance_liter) > 0 ? '+' : ''}${fmtNum(s.variance_liter, 1)} L${pct}`;
  }

  /* ---------- browser ---------- */

  const state = { tab: 'validasi', locations: [], host: null };

  function apiUrl(path) {
    if (typeof global.getProdApiUrl === 'function') return global.getProdApiUrl(path);
    return path;
  }
  function headers() { return typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {}; }

  async function call(path, { method = 'GET', body } = {}) {
    const res = await fetch(apiUrl(path), {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.code, status: res.status });
    return data;
  }

  function run(button, task) {
    const fb = global.OMOSActionFeedback;
    return fb && button ? fb.run(button, task) : task();
  }

  function pill(text, tone) { return `<span class="fa-pill is-${tone}">${esc(text)}</span>`; }

  function notify(message, tone = 'ok') {
    const el = state.host?.querySelector('[data-fa-notice]');
    if (!el) return;
    el.className = `fa-notice is-${tone}`;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(notify.t);
    notify.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  /** Dialog alasan inline di dalam panel (pengganti dialog prompt bawaan browser). */
  function askReason(title, { label = 'Alasan', placeholder = '', confirm = 'Simpan', required = true } = {}) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'fa-ask';
      wrap.innerHTML = `<form class="fa-ask__box" novalidate><h4>${esc(title)}</h4>
          <label class="fa-field"><span>${esc(label)}</span><textarea rows="3" placeholder="${esc(placeholder)}"></textarea>
          <small class="fa-field__err" hidden>${esc(label)} wajib diisi.</small></label>
          <div class="fa-ask__act"><button type="button" class="tombol tombol--ghost" data-batal>Batal</button><button type="submit" class="tombol tombol--utama">${esc(confirm)}</button></div></form>`;
      state.host.appendChild(wrap);
      const ta = wrap.querySelector('textarea');
      const errEl = wrap.querySelector('.fa-field__err');
      ta.focus();
      ta.addEventListener('input', () => { errEl.hidden = true; });
      const selesai = v => { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-batal]').addEventListener('click', () => selesai(null));
      wrap.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const v = ta.value.trim();
        if (required && !v) { errEl.hidden = false; return; }
        selesai(v);
      });
    });
  }

  function showSecret(title, nama, pin) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-ask';
    wrap.innerHTML = `<div class="fa-ask__box"><h4>${esc(title)}</h4>
        <p class="fa-muted">PIN sementara untuk <b>${esc(nama)}</b>. Tampil <b>sekali</b>; sampaikan langsung ke petugas. PIN wajib diganti saat login pertama di APK.</p>
        <div class="fa-pin">${esc(pin)}</div>
        <div class="fa-ask__act"><button type="button" class="tombol tombol--utama" data-ok>Sudah dicatat</button></div></div>`;
    state.host.appendChild(wrap);
    wrap.querySelector('[data-ok]').addEventListener('click', () => wrap.remove());
  }

  function loading(el, text = 'Memuat…') { if (el) el.innerHTML = `<div class="fuel-loading-state">${esc(text)}</div>`; }
  function failed(el, error) {
    if (!el) return;
    const migrasi = error.code === 'MIGRATION_REQUIRED';
    el.innerHTML = `<div class="fuel-card-error">${migrasi ? 'Skema OMOS Fuel belum tersedia di database (migrasi 103/104 belum dijalankan).' : `Gagal memuat: ${esc(error.message)}`}</div>`;
  }

  async function muatLokasi() {
    try {
      const rows = await call(`${INV}/locations`);
      state.locations = Array.isArray(rows) ? rows.filter(l => l.is_active !== false) : [];
    } catch (error) { state.locations = []; }
  }
  function kodeLokasi(id) { return state.locations.find(l => String(l.id) === String(id))?.location_code || '—'; }

  /* ----- kerangka panel ----- */

  const TABS = [['validasi', 'Validasi APK'], ['shift', 'Tutup shift'], ['akun', 'Akun fuelman'], ['perangkat', 'Perangkat'], ['lokasi', 'Lokasi & label'], ['pengaturan', 'Pengaturan']];

  function open(tab = 'validasi') {
    const overlay = document.getElementById('modalOverlay');
    const konten = document.getElementById('modalKonten');
    if (!overlay || !konten) return;
    state.tab = tab;
    overlay.hidden = false;
    konten.innerHTML = `<section class="fa-panel" aria-labelledby="faTitle">
        <header class="fa-head"><div><small>INPUT FUEL · APK OMOS FUEL</small><h3 id="faTitle">Akses Fuel</h3></div>
          <button type="button" class="tombol tombol--ghost" data-fa-close>Tutup</button></header>
        <nav class="fa-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-fa-tab="${k}">${esc(l)}<b data-fa-badge="${k}" hidden></b></button>`).join('')}</nav>
        <div class="fa-notice" data-fa-notice hidden></div>
        <div class="fa-body" data-fa-body></div></section>`;
    state.host = konten.querySelector('.fa-panel');
    state.host.querySelector('[data-fa-close]').addEventListener('click', close);
    state.host.querySelectorAll('[data-fa-tab]').forEach(b => b.addEventListener('click', () => pindah(b.dataset.faTab)));
    void muatLokasi().then(() => pindah(tab));
    void hitungBadge();
  }

  function close() {
    global.FuelEvidenceUi?.lepasBlob?.();
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.hidden = true;
  }

  async function hitungBadge() {
    try {
      const [val, sesi, dev] = await Promise.all([
        call(`${ACCESS}/pending-validations`), call(`${ACCESS}/shift-sessions?status=investigation`), call(`${ACCESS}/devices`),
      ]);
      const set = (k, n) => { const b = state.host?.querySelector(`[data-fa-badge="${k}"]`); if (b) { b.textContent = n; b.hidden = !n; } };
      set('validasi', val.length); set('shift', sesi.length); set('perangkat', dev.filter(d => d.status === 'pending').length);
    } catch (error) { /* badge opsional */ }
  }

  function pindah(tab) {
    state.tab = tab;
    state.host.querySelectorAll('[data-fa-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.faTab === tab)));
    const body = state.host.querySelector('[data-fa-body]');
    ({ validasi: tabValidasi, shift: tabShift, akun: tabAkun, perangkat: tabPerangkat, lokasi: tabLokasi, pengaturan: tabPengaturan }[tab] || tabValidasi)(body);
  }

  function refresh() { pindah(state.tab); void hitungBadge(); }

  /* ----- tab: validasi APK ----- */

  async function tabValidasi(body) {
    loading(body, 'Memuat antrean validasi…');
    try {
      const rows = await call(`${ACCESS}/pending-validations`);
      if (!rows.length) {
        body.innerHTML = '<div class="fa-empty"><b>Tidak ada transaksi APK yang menunggu.</b><span>Penerimaan dan transfer dari APK muncul di sini sebelum stok berubah.</span></div>';
        return;
      }
      const jenis = { receipt: ['Penerimaan', 'in'], transfer: ['Transfer', 'muted'], issue_short: ['Pengisian · stok kurang', 'warn'] };
      body.innerHTML = `<p class="fa-muted">Periksa foto bukti sebelum memvalidasi. Validasi memposting transaksi ke ledger; tolak membatalkan dengan alasan yang dikirim balik ke APK.</p>
        <div class="fa-scroll"><table class="fa-table"><thead><tr><th>Masuk</th><th>Jenis</th><th>Dokumen</th><th>Lokasi</th><th class="n">Liter</th><th>Bukti</th><th>Oleh</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => {
          const [label, tone] = jenis[r.kind];
          const lokasi = r.kind === 'transfer' ? `${esc(r.source_code)} → ${esc(r.transfer_to_code || '—')}` : r.kind === 'receipt' ? `→ ${esc(r.destination_code)}` : `${esc(r.source_code)} → ${esc(r.kode_alat || 'unit')}`;
          const flags = (r.mobile_flags || []).map(f => pill(flagLabel(f), 'warn')).join(' ');
          return `<tr><td>${esc(fmtWaktu(r.created_at))}</td><td>${pill(label, tone)}</td>
            <td><span class="fa-code">${esc(r.document_number || (r.kind === 'transfer' ? r.reason : null) || r.transaction_number)}</span>${r.supplier_reference ? `<small>${esc(r.supplier_reference)}</small>` : ''}</td>
            <td>${lokasi}</td><td class="n">${esc(fmtL(r.quantity_liter, 1))}</td>
            <td><button type="button" class="fa-link" data-galeri="${i}">${r.attachment_count} foto</button> ${flags}</td>
            <td>${esc(r.created_by_nama || '—')}<small>${esc(r.device_code || '')}</small></td>
            <td class="fa-act"><button type="button" class="tombol tombol--utama tombol--kecil" data-validasi="${i}">${r.kind === 'issue_short' ? 'Posting' : 'Validasi'}</button>
              ${r.kind === 'issue_short' ? '' : `<button type="button" class="tombol tombol--ghost tombol--kecil" data-tolak="${i}">Tolak</button>`}</td></tr>
            <tr class="fa-gal" data-gal-row="${i}" hidden><td colspan="8"><div data-gal="${i}"></div></td></tr>`;
        }).join('')}</tbody></table></div>`;
      body.querySelectorAll('[data-galeri]').forEach(b => b.addEventListener('click', () => {
        const i = b.dataset.galeri;
        const row = body.querySelector(`[data-gal-row="${i}"]`);
        row.hidden = !row.hidden;
        if (!row.hidden) void global.FuelEvidenceUi?.renderGallery(body.querySelector(`[data-gal="${i}"]`), 'transaction', rows[i].id)
          .catch(error => failed(body.querySelector(`[data-gal="${i}"]`), error));
      }));
      body.querySelectorAll('[data-validasi]').forEach(b => b.addEventListener('click', () => {
        const r = rows[b.dataset.validasi];
        const path = r.kind === 'transfer' ? `${INV}/transfers/${r.transfer_group_id}/post` : `${INV}/transactions/${r.id}/post`;
        run(b, () => call(path, { method: 'POST' }))
          .then(() => { notify(`${r.document_number || r.transaction_number} divalidasi dan diposting.`); refresh(); })
          .catch(error => notify(`Validasi gagal: ${error.message}`, 'bad'));
      }));
      body.querySelectorAll('[data-tolak]').forEach(b => b.addEventListener('click', async () => {
        const r = rows[b.dataset.tolak];
        const alasan = await askReason(`Tolak ${r.document_number || r.reason || r.transaction_number}`, { placeholder: 'Contoh: foto surat jalan tidak terbaca', confirm: 'Tolak transaksi' });
        if (!alasan) return;
        const path = r.kind === 'transfer' ? `${INV}/transfers/${r.transfer_group_id}/void` : `${INV}/transactions/${r.id}/void`;
        run(b, () => call(path, { method: 'POST', body: { reason: alasan } }))
          .then(() => { notify('Transaksi ditolak; alasan terkirim ke APK.'); refresh(); })
          .catch(error => notify(`Penolakan gagal: ${error.message}`, 'bad'));
      }));
    } catch (error) { failed(body, error); }
  }

  /* ----- tab: tutup shift ----- */

  async function tabShift(body, status = 'investigation') {
    loading(body, 'Memuat sesi shift…');
    try {
      const rows = await call(`${ACCESS}/shift-sessions${status ? `?status=${status}` : ''}`);
      body.innerHTML = `<div class="fa-bar"><p class="fa-muted">Selisih = (totalizer akhir − awal) − (pengisian + transfer keluar selama sesi). Investigasi bila |selisih| melewati ambang.</p>
          <label class="fa-inline">Status <select data-shift-filter><option value="investigation">Perlu investigasi</option><option value="">Semua</option><option value="open">Terbuka</option><option value="closed">Ditutup</option><option value="reviewed">Sudah direview</option></select></label></div>
        ${rows.length ? `<div class="fa-scroll"><table class="fa-table"><thead><tr><th>Tanggal · shift</th><th>Lokasi</th><th>Petugas</th><th class="n">Totalizer awal</th><th class="n">Totalizer akhir</th><th class="n">Meter</th><th class="n">Tercatat keluar</th><th class="n">Selisih</th><th class="n">Ambang</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((s, i) => {
          const [label, tone] = SESSION_STATUS[s.status] || [s.status, 'muted'];
          return `<tr><td>${esc(s.operational_date)}<small>${esc(s.nama_shift || '')}</small></td><td><b>${esc(s.location_code)}</b></td>
            <td>${esc(s.opened_by_nama || '—')}<small>${s.closed_by_nama ? `tutup: ${esc(s.closed_by_nama)}` : ''}</small></td>
            <td class="n">${esc(fmtNum(s.totalizer_open, 1))}</td><td class="n">${esc(fmtNum(s.totalizer_close, 1))}</td>
            <td class="n">${esc(fmtL(s.meter_delta_liter, 1))}</td><td class="n">${esc(fmtL(s.recorded_out_liter, 1))}</td>
            <td class="n ${s.status === 'investigation' ? 'is-bad' : ''}">${esc(describeVariance(s))}</td><td class="n">${esc(fmtL(s.threshold_liter, 1))}</td>
            <td>${pill(label, tone)}${s.close_reason ? `<small>${esc(s.close_reason)}</small>` : ''}${s.review_note ? `<small>Review: ${esc(s.review_note)}</small>` : ''}</td>
            <td class="fa-act"><button type="button" class="fa-link" data-foto="${i}">Foto</button>
              ${s.status === 'investigation' ? `<button type="button" class="tombol tombol--utama tombol--kecil" data-review="${i}">Review</button>` : ''}</td></tr>
            <tr class="fa-gal" data-gal-row="${i}" hidden><td colspan="11"><div data-gal="${i}"></div></td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="fa-empty"><b>Tidak ada sesi pada filter ini.</b><span>Sesi muncul setelah fuelman membuka/menutup shift di APK.</span></div>'}`;
      const sel = body.querySelector('[data-shift-filter]');
      sel.value = status;
      sel.addEventListener('change', () => tabShift(body, sel.value));
      body.querySelectorAll('[data-foto]').forEach(b => b.addEventListener('click', () => {
        const i = b.dataset.foto;
        const row = body.querySelector(`[data-gal-row="${i}"]`);
        row.hidden = !row.hidden;
        if (!row.hidden) void global.FuelEvidenceUi?.renderGallery(body.querySelector(`[data-gal="${i}"]`), 'shift_session', rows[i].id)
          .catch(error => failed(body.querySelector(`[data-gal="${i}"]`), error));
      }));
      body.querySelectorAll('[data-review]').forEach(b => b.addEventListener('click', async () => {
        const s = rows[b.dataset.review];
        const note = await askReason(`Review selisih ${s.location_code} · ${s.operational_date}`, { label: 'Hasil investigasi', placeholder: 'Temuan dan tindak lanjut', confirm: 'Tandai sudah direview' });
        if (!note) return;
        run(b, () => call(`${ACCESS}/shift-sessions/${s.id}/review`, { method: 'POST', body: { note } }))
          .then(() => { notify('Sesi ditandai sudah direview.'); tabShift(body, status); void hitungBadge(); })
          .catch(error => notify(`Review gagal: ${error.message}`, 'bad'));
      }));
    } catch (error) { failed(body, error); }
  }

  /* ----- tab: akun ----- */

  function lokasiChecklist(name, selected = []) {
    const pilih = new Set((selected || []).map(String));
    return state.locations.length
      ? state.locations.map(l => `<label class="fa-check"><input type="checkbox" name="${name}" value="${esc(l.id)}"${pilih.has(String(l.id)) ? ' checked' : ''}> ${esc(l.location_code)} <small>${esc(l.storage_type || '')}</small></label>`).join('')
      : '<span class="fa-muted">Belum ada lokasi penyimpanan. Tambahkan di Database Fuel.</span>';
  }

  function fungsiChecklist(name, selected = []) {
    const pilih = new Set(selected || []);
    return Object.keys(FUNCTION_LABELS).map(k => `<label class="fa-check"><input type="checkbox" name="${name}" value="${k}"${pilih.has(k) ? ' checked' : ''}> ${esc(FUNCTION_LABELS[k])}</label>`).join('');
  }

  const nilaiCek = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

  async function tabAkun(body) {
    loading(body, 'Memuat akun fuelman…');
    try {
      const rows = await call(`${ACCESS}/accounts`);
      body.innerHTML = `<div class="fa-bar"><p class="fa-muted">Login APK memakai Employee ID + PIN 6 digit (terpisah dari password akun utama). Salah PIN berulang mengunci akun.</p>
          <button type="button" class="tombol tombol--utama" data-akun-baru>+ Tambah akun</button></div>
        <div data-akun-form hidden></div>
        ${rows.length ? `<div class="fa-scroll"><table class="fa-table"><thead><tr><th>Petugas</th><th>Fungsi</th><th>Lokasi</th><th>Status</th><th>Perangkat terakhir</th><th></th></tr></thead><tbody>
        ${rows.map((a, i) => `<tr><td><b>${esc(a.nama)}</b><small>${esc(a.employee_id)} · ${esc(a.jabatan || '')}</small></td>
          <td>${(a.allowed_functions || []).map(f => pill(functionLabel(f), 'in')).join(' ') || '—'}</td>
          <td>${(a.allowed_location_ids || []).map(id => `<span class="fa-code">${esc(kodeLokasi(id))}</span>`).join(' ') || '<span class="is-bad">Belum ditugaskan</span>'}</td>
          <td>${a.locked_at ? pill('Terkunci', 'bad') : a.is_active ? pill('Aktif', 'ok') : pill('Nonaktif', 'muted')}${a.must_change_pin ? `<small>PIN sementara</small>` : ''}</td>
          <td>${esc(a.last_device_code || '—')}<small>${esc(fmtWaktu(a.last_seen_at))}</small></td>
          <td class="fa-act"><button type="button" class="fa-link" data-ubah="${i}">Ubah</button><button type="button" class="fa-link" data-reset="${i}">Reset PIN</button></td></tr>
          <tr data-ubah-row="${i}" hidden><td colspan="6"></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="fa-empty"><b>Belum ada akun fuelman.</b><span>Tambah akun dari data karyawan, tetapkan fungsi dan lokasi, lalu berikan PIN sementara.</span></div>'}`;
      body.querySelector('[data-akun-baru]').addEventListener('click', () => formAkunBaru(body.querySelector('[data-akun-form]'), body));
      body.querySelectorAll('[data-ubah]').forEach(b => b.addEventListener('click', () => {
        const i = b.dataset.ubah;
        const a = rows[i];
        const tr = body.querySelector(`[data-ubah-row="${i}"]`);
        tr.hidden = !tr.hidden;
        if (tr.hidden) return;
        const td = tr.querySelector('td');
        td.innerHTML = `<div class="fa-edit"><div><span class="fa-label">Fungsi</span><div class="fa-checks">${fungsiChecklist(`f${i}`, a.allowed_functions)}</div></div>
          <div><span class="fa-label">Lokasi yang boleh dipakai</span><div class="fa-checks">${lokasiChecklist(`l${i}`, a.allowed_location_ids)}</div></div>
          <label class="fa-check"><input type="checkbox" data-aktif${a.is_active ? ' checked' : ''}> Akun aktif</label>
          <div class="fa-ask__act"><button type="button" class="tombol tombol--utama tombol--kecil" data-simpan>Simpan perubahan</button></div></div>`;
        td.querySelector('[data-simpan]').addEventListener('click', e => run(e.currentTarget, () => call(`${ACCESS}/accounts/${a.user_id}`, {
          method: 'PATCH', body: { functions: nilaiCek(td, `f${i}`), location_ids: nilaiCek(td, `l${i}`), is_active: td.querySelector('[data-aktif]').checked },
        })).then(() => { notify(`Akses ${a.nama} diperbarui.`); tabAkun(body); }).catch(error => notify(`Gagal menyimpan: ${error.message}`, 'bad')));
      }));
      body.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', async () => {
        const a = rows[b.dataset.reset];
        const ok = await askReason(`Reset PIN ${a.nama}?`, { label: 'Ketik RESET untuk melanjutkan', confirm: 'Reset PIN' });
        if (!ok) return;
        if (ok.trim().toUpperCase() !== 'RESET') { notify('Reset dibatalkan (konfirmasi tidak sesuai).', 'warn'); return; }
        run(b, () => call(`${ACCESS}/accounts/${a.user_id}/reset-pin`, { method: 'POST' }))
          .then(hasil => { showSecret('PIN baru', a.nama, hasil.temp_pin); tabAkun(body); })
          .catch(error => notify(`Reset gagal: ${error.message}`, 'bad'));
      }));
    } catch (error) { failed(body, error); }
  }

  function formAkunBaru(box, body) {
    box.hidden = false;
    box.innerHTML = `<div class="fa-edit fa-edit--new"><label class="fa-field"><span>Cari karyawan (nama / Employee ID)</span>
        <input type="search" data-cari placeholder="Nama atau Employee ID"></label>
        <label class="fa-field"><span>Karyawan</span><select data-kandidat><option value="">— Pilih —</option></select>
        <small class="fa-field__err" data-err-kandidat hidden>Pilih karyawan.</small></label>
        <div><span class="fa-label">Fungsi</span><div class="fa-checks">${fungsiChecklist('fbaru', ['fill', 'transfer', 'shift'])}</div></div>
        <div><span class="fa-label">Lokasi yang boleh dipakai</span><div class="fa-checks">${lokasiChecklist('lbaru')}</div></div>
        <div class="fa-ask__act"><button type="button" class="tombol tombol--ghost" data-batal>Batal</button><button type="button" class="tombol tombol--utama" data-buat>Buat akun & PIN</button></div></div>`;
    const sel = box.querySelector('[data-kandidat]');
    let t;
    const cari = async q => {
      try {
        const rows = await call(`${ACCESS}/candidates?q=${encodeURIComponent(q)}`);
        sel.innerHTML = '<option value="">— Pilih —</option>' + rows.map(r => `<option value="${esc(r.id)}">${esc(r.nama)} · ${esc(r.employee_id)}${r.jabatan ? ` · ${esc(r.jabatan)}` : ''}</option>`).join('');
      } catch (error) { notify(`Gagal mencari karyawan: ${error.message}`, 'bad'); }
    };
    void cari('');
    box.querySelector('[data-cari]').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => cari(e.target.value), 250); });
    sel.addEventListener('change', () => { box.querySelector('[data-err-kandidat]').hidden = true; });
    box.querySelector('[data-batal]').addEventListener('click', () => { box.hidden = true; box.innerHTML = ''; });
    box.querySelector('[data-buat]').addEventListener('click', e => {
      if (!sel.value) { box.querySelector('[data-err-kandidat]').hidden = false; return; }
      const nama = sel.selectedOptions[0]?.textContent || '';
      run(e.currentTarget, () => call(`${ACCESS}/accounts`, { method: 'POST', body: {
        user_id: sel.value, functions: nilaiCek(box, 'fbaru'), location_ids: nilaiCek(box, 'lbaru'),
      } })).then(hasil => { showSecret('Akun fuel dibuat', nama, hasil.temp_pin); tabAkun(body); })
        .catch(error => notify(`Gagal membuat akun: ${error.message}`, 'bad'));
    });
  }

  /* ----- tab: perangkat ----- */

  async function tabPerangkat(body) {
    loading(body, 'Memuat perangkat…');
    try {
      const rows = await call(`${ACCESS}/devices`);
      body.innerHTML = `<p class="fa-muted">Perangkat baru otomatis terdaftar saat login pertama dan menunggu persetujuan. Perangkat yang dicabut tidak bisa membuat transaksi baru; data yang dicatat sebelum pencabutan tetap diterima dan ditandai.</p>
        ${rows.length ? `<div class="fa-scroll"><table class="fa-table"><thead><tr><th>Kode</th><th>Perangkat</th><th>Didaftarkan</th><th>Terakhir aktif</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((d, i) => {
          const [label, tone] = DEVICE_STATUS[d.status] || [d.status, 'muted'];
          return `<tr><td><span class="fa-code">${esc(d.device_code)}</span></td><td>${esc(d.device_name || d.model || '—')}<small>${esc(d.model || '')} · app ${esc(d.app_version || '?')}</small></td>
            <td>${esc(d.registered_by_nama || '—')}<small>${esc(fmtWaktu(d.created_at))}</small></td><td>${esc(d.last_user_nama || '—')}<small>${esc(fmtWaktu(d.last_seen_at))}</small></td>
            <td>${pill(label, tone)}${d.revoke_reason ? `<small>${esc(d.revoke_reason)}</small>` : ''}</td>
            <td class="fa-act">${d.status !== 'approved' ? `<button type="button" class="tombol tombol--utama tombol--kecil" data-setujui="${i}">Setujui</button>` : ''}
              ${d.status !== 'revoked' ? `<button type="button" class="tombol tombol--ghost tombol--kecil" data-cabut="${i}">Cabut</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="fa-empty"><b>Belum ada perangkat terdaftar.</b><span>Perangkat muncul setelah fuelman login pertama kali di APK.</span></div>'}`;
      body.querySelectorAll('[data-setujui]').forEach(b => b.addEventListener('click', () => {
        const d = rows[b.dataset.setujui];
        run(b, () => call(`${ACCESS}/devices/${d.id}/approve`, { method: 'POST' }))
          .then(() => { notify(`Perangkat ${d.device_code} disetujui.`); refresh(); })
          .catch(error => notify(`Gagal: ${error.message}`, 'bad'));
      }));
      body.querySelectorAll('[data-cabut]').forEach(b => b.addEventListener('click', async () => {
        const d = rows[b.dataset.cabut];
        const alasan = await askReason(`Cabut perangkat ${d.device_code}`, { placeholder: 'Contoh: HP hilang / rusak', confirm: 'Cabut perangkat' });
        if (!alasan) return;
        run(b, () => call(`${ACCESS}/devices/${d.id}/revoke`, { method: 'POST', body: { reason: alasan } }))
          .then(() => { notify(`Perangkat ${d.device_code} dicabut.`); refresh(); })
          .catch(error => notify(`Gagal: ${error.message}`, 'bad'));
      }));
    } catch (error) { failed(body, error); }
  }

  /* ----- tab: lokasi & label ----- */

  async function tabLokasi(body) {
    loading(body, 'Memuat ID lokasi…');
    try {
      const rows = await call(`${ACCESS}/labels?target_type=location`);
      body.innerHTML = `<div class="fa-bar"><p class="fa-muted">Tangki dan depot memakai ID <span class="fa-code">LOC-…</span>. Fuel truck memakai ID unitnya (cetak dari List Equipment).</p>
          <button type="button" class="tombol tombol--utama" data-cetak-semua>Cetak semua label</button></div>
        ${rows.length ? `<div class="fa-label-grid">${rows.map((l, i) => `<article class="fa-label-card"><div class="fa-qr">${l.qr_svg || ''}</div>
          <div><span class="fa-code">${esc(l.scan_id)}</span><b>${esc(l.kode)}</b><small>${esc(l.nama || '')} · ${esc(l.kelas || '')}</small>
          <div class="fa-label-card__act"><button type="button" class="fa-link" data-cetak="${i}">Cetak</button><button type="button" class="fa-link" data-regen="${i}">Buat ulang ID</button></div></div></article>`).join('')}</div>`
        : '<div class="fa-empty"><b>Belum ada lokasi penyimpanan.</b><span>Tambahkan tangki/depot di Database Fuel.</span></div>'}`;
      body.querySelector('[data-cetak-semua]').addEventListener('click', () => cetakLabel({ targetType: 'location', rows }));
      body.querySelectorAll('[data-cetak]').forEach(b => b.addEventListener('click', () => cetakLabel({ targetType: 'location', rows: [rows[b.dataset.cetak]] })));
      body.querySelectorAll('[data-regen]').forEach(b => b.addEventListener('click', async () => {
        const l = rows[b.dataset.regen];
        const alasan = await askReason(`Buat ulang ID ${l.kode}`, { placeholder: 'Contoh: stiker hilang', confirm: 'Buat ulang ID' });
        if (!alasan) return;
        run(b, () => call(`${ACCESS}/scan-ids/regenerate`, { method: 'POST', body: { target_type: 'location', target_id: l.id, reason: alasan } }))
          .then(hasil => { notify(`ID ${hasil.old_scan_id} dicabut, ID baru ${hasil.scan_id}. Cetak ulang labelnya.`, 'warn'); tabLokasi(body); })
          .catch(error => notify(`Gagal: ${error.message}`, 'bad'));
      }));
    } catch (error) { failed(body, error); }
  }

  /* ----- tab: pengaturan ----- */

  const SETTINGS = [
    ['hm_gap_tolerance_hours', 'Toleransi selisih HM vs waktu', 'jam', 0.1],
    ['totalizer_tolerance_pct', 'Ambang selisih totalizer (persen)', '%', 0.01],
    ['totalizer_tolerance_liter', 'Ambang selisih totalizer (minimum)', 'L', 1],
    ['late_entry_grace_hours', 'Batas input terlambat tanpa alasan', 'jam', 0.5],
    ['offline_pin_days', 'Masa berlaku PIN offline', 'hari', 1],
    ['pin_max_attempts', 'Batas salah PIN sebelum terkunci', 'kali', 1],
  ];

  async function tabPengaturan(body) {
    loading(body, 'Memuat pengaturan…');
    try {
      const s = await call(`${ACCESS}/settings`);
      body.innerHTML = `<form class="fa-settings" novalidate><p class="fa-muted">Nilai berlaku untuk seluruh APK pada sinkronisasi berikutnya. Ambang totalizer: investigasi bila |selisih| &gt; maks(persen × meter, minimum liter).</p>
        ${SETTINGS.map(([k, label, unit, step]) => `<label class="fa-field"><span>${esc(label)}</span><div class="fa-input-unit"><input type="number" step="${step}" min="0" name="${k}" value="${esc(s[k])}"><em>${esc(unit)}</em></div></label>`).join('')}
        <div class="fa-ask__act"><button type="submit" class="tombol tombol--utama">Simpan pengaturan</button></div></form>`;
      const form = body.querySelector('form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const data = Object.fromEntries(SETTINGS.map(([k]) => [k, Number(form.elements[k].value)]));
        run(form.querySelector('[type=submit]'), () => call(`${ACCESS}/settings`, { method: 'PUT', body: data }))
          .then(() => notify('Pengaturan disimpan.'))
          .catch(error => notify(`Gagal menyimpan: ${error.message}`, 'bad'));
      });
    } catch (error) { failed(body, error); }
  }

  /* ---------- label & ID di List Equipment ---------- */

  /**
   * Cetak label. Tanpa `format` → tampilkan pilihan A4 / thermal; jendela cetak dibuka
   * sinkron di handler klik pilihan agar tidak diblokir popup blocker.
   */
  function cetakLabel(opts = {}) {
    if (!opts.format) {
      document.querySelector('.fa-chooser')?.remove();
      const box = document.createElement('div');
      box.className = 'fa-chooser';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Pilih format label');
      box.innerHTML = `<div class="fa-chooser__box"><h4>Format label QR</h4>
          <button type="button" class="fa-chooser__opt" data-fmt="a4"><b>Lembar A4</b><small>Grid 3 kolom, printer kantor biasa</small></button>
          <button type="button" class="fa-chooser__opt" data-fmt="thermal"><b>Label thermal 50×30 mm</b><small>Satu label per halaman, printer label</small></button>
          <button type="button" class="tombol tombol--ghost" data-batal>Batal</button></div>`;
      document.body.appendChild(box);
      box.querySelector('[data-batal]').addEventListener('click', () => box.remove());
      box.addEventListener('click', e => { if (e.target === box) box.remove(); });
      box.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => { box.remove(); cetakLabel({ ...opts, format: b.dataset.fmt }); }));
      return;
    }
    const { targetType = 'equipment', ids = [], kelas = null, rows = null, format } = opts;
    const w = global.open('', '_blank');
    if (!w) { alert('Popup diblokir browser. Izinkan popup untuk mencetak label.'); return; }
    w.document.write('<p style="font-family:sans-serif">Menyiapkan label…</p>');
    const ambil = rows ? Promise.resolve(rows)
      : call(`${ACCESS}/labels`, { method: 'POST', body: { target_type: targetType, ids, kelas } });
    ambil.then(labels => {
      w.document.open();
      w.document.write(labelSheetHtml(labels.filter(l => l.scan_id), format));
      w.document.close();
    }).catch(error => { w.document.body.innerHTML = `<p style="font-family:sans-serif;color:#b91c1c">Gagal: ${esc(error.message)}</p>`; });
  }

  /** Detail ID satu unit: QR, cetak, buat ulang ID, kapasitas tangki BBM. */
  async function openEquipmentId(equipmentId) {
    const overlay = document.getElementById('modalOverlay');
    const konten = document.getElementById('modalKonten');
    if (!overlay || !konten) return;
    overlay.hidden = false;
    konten.innerHTML = '<section class="fa-panel fa-panel--small"><div class="fuel-loading-state">Memuat ID unit…</div></section>';
    state.host = konten.querySelector('.fa-panel');
    try {
      const [label] = await call(`${ACCESS}/labels?target_type=equipment&ids=${encodeURIComponent(equipmentId)}`);
      // masterProdData = `let` global di production.js (lingkup leksikal global bersama, bukan window).
      const master = typeof masterProdData !== 'undefined' ? masterProdData : null; // eslint-disable-line no-undef
      const unit = (master?.equipment || []).find(u => String(u.id) === String(equipmentId)) || {};
      if (!label) throw new Error('Unit tidak ditemukan.');
      state.host.innerHTML = `<header class="fa-head"><div><small>ID UNIT · QR UNTUK APK OMOS FUEL</small><h3>${esc(label.kode)}</h3></div>
          <button type="button" class="tombol tombol--ghost" data-fa-close>Tutup</button></header>
        <div class="fa-notice" data-fa-notice hidden></div>
        <div class="fa-id"><div class="fa-qr fa-qr--big">${label.qr_svg || ''}</div>
          <div class="fa-id__info"><span class="fa-label">ID</span><div class="fa-id__code">${esc(label.scan_id)}</div>
            <span class="fa-label">Isi QR</span><div class="fa-code">${esc(label.qr_payload)}</div>
            <span class="fa-label">Unit</span><div>${esc([label.kelas, label.class_unit, label.nama].filter(Boolean).join(' · '))}</div>
            <div class="fa-ask__act fa-ask__act--start"><button type="button" class="tombol tombol--utama" data-cetak>Cetak label</button><button type="button" class="tombol tombol--ghost" data-regen>Buat ulang ID</button></div></div></div>
        <form class="fa-settings fa-tank" novalidate><label class="fa-field"><span>Kapasitas tangki BBM</span><div class="fa-input-unit"><input type="number" min="0" step="1" name="cap" value="${esc(unit.fuel_tank_capacity_liter ?? '')}" placeholder="Kosongkan bila belum diketahui"><em>L</em></div>
          <small class="fa-muted">Dipakai APK untuk peringatan bila pengisian melebihi kapasitas.</small></label>
          <div class="fa-ask__act fa-ask__act--start"><button type="submit" class="tombol">Simpan kapasitas</button></div></form>`;
      state.host.querySelector('[data-fa-close]').addEventListener('click', close);
      state.host.querySelector('[data-cetak]').addEventListener('click', () => cetakLabel({ rows: [label] }));
      state.host.querySelector('[data-regen]').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const alasan = await askReason(`Buat ulang ID ${label.kode}`, { placeholder: 'Contoh: stiker hilang / rusak', confirm: 'Buat ulang ID' });
        if (!alasan) return;
        run(btn, () => call(`${ACCESS}/scan-ids/regenerate`, { method: 'POST', body: { target_type: 'equipment', target_id: equipmentId, reason: alasan } }))
          .then(async hasil => {
            if (unit) unit.scan_id = hasil.scan_id;
            await openEquipmentId(equipmentId);
            notify(`ID ${hasil.old_scan_id} dicabut; ID baru ${hasil.scan_id}. Cetak ulang labelnya.`, 'warn');
            global.terapkanSlicerEquipment?.();
          }).catch(error => notify(`Gagal: ${error.message}`, 'bad'));
      });
      const form = state.host.querySelector('.fa-tank');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const v = form.elements.cap.value;
        run(form.querySelector('[type=submit]'), () => call(`${ACCESS}/equipment/${equipmentId}/tank-capacity`, { method: 'PUT', body: { fuel_tank_capacity_liter: v === '' ? null : Number(v) } }))
          .then(hasil => { unit.fuel_tank_capacity_liter = hasil.fuel_tank_capacity_liter; notify('Kapasitas tangki disimpan.'); global.terapkanSlicerEquipment?.(); })
          .catch(error => notify(`Gagal: ${error.message}`, 'bad'));
      });
    } catch (error) {
      state.host.innerHTML = `<header class="fa-head"><h3>ID unit</h3><button type="button" class="tombol tombol--ghost" data-fa-close>Tutup</button></header><div data-err></div>`;
      failed(state.host.querySelector('[data-err]'), error);
      state.host.querySelector('[data-fa-close]').addEventListener('click', close);
    }
  }

  return {
    pure: { esc, fmtL, fmtNum, functionLabel, flagLabel, labelSheetHtml, describeVariance },
    ui: { open, close, openEquipmentId, cetakLabel, flagLabel },
  };
});
