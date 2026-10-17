/*
 * Fuel Operations Hub — role-based task flows (Operasional / Control / Admin).
 * Memakai API fuel-inventory eksisting; browser tidak menghitung KPI authoritative.
 * Estimasi eksplisit dilabeli. Draft wizard in-memory (tanpa klaim offline).
 * Fungsi murni diekspor untuk regression test node.
 */
(function (global, factory) {
  const api = factory(global);
  if (global) global.FuelOperationsHub = api.ui;
  if (typeof module === 'object' && module.exports) module.exports = api.pure;
})(typeof window !== 'undefined' ? window : globalThis, function createFuelOperationsHub(global) {
  'use strict';

  const BASE = '/api/admin/production/fuel-inventory';
  const FLAG_KEY = 'fms_fuel_hub';
  const LAST_MODE_KEY = 'fms_fuel_hub_mode';

  /* ---------- murni ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtL(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(Number(v))} L`;
  }

  function fmtRp(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(v))}`;
  }

  function fmtPct(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(v))}%`;
  }

  function todayStr(d) {
    const t = d instanceof Date ? d : new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  function newOpId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function roleOf() {
    const r = (global.state && global.state.role) || (typeof localStorage !== 'undefined' ? localStorage.getItem('user_role') : '') || 'admin';
    return String(r || 'admin').toLowerCase();
  }

  function modesFor(role) {
    if (String(role) === 'admin') return ['operasional', 'control', 'admin'];
    return ['operasional'];
  }

  function hubEnabled() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(FLAG_KEY) === 'off') return false;
      if (typeof location !== 'undefined' && /[?&]classic=1/.test(location.search)) return false;
    } catch (e) { /* abaikan */ }
    return true;
  }

  function validQty(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  }

  function ringkasanTerima({ produk, qty, lokasi }) {
    return `${produk} ${fmtL(qty)} diterima di ${lokasi}.`;
  }

  function ringkasanTransfer({ produk, qty, asal, tujuan }) {
    return `Transfer ${produk} ${fmtL(qty)} dari ${asal} ke ${tujuan}.`;
  }

  function ringkasanOpname({ produk, qty, lokasi }) {
    return `Opname ${produk} ${fmtL(qty)} di ${lokasi}.`;
  }

  function statusTone(status) {
    const s = String(status || '').toLowerCase();
    if (['posted', 'synced', 'ready', 'adjusted', 'valid'].includes(s)) return 'ok';
    if (['approved'].includes(s)) return 'ok';
    if (['draft', 'submitted', 'queued', 'syncing', 'waiting'].includes(s)) return 'warn';
    if (['rejected', 'conflict', 'failed', 'error'].includes(s)) return 'bad';
    if (['reversed', 'void', 'excluded'].includes(s)) return 'muted';
    return 'info';
  }

  /* ---------- browser ---------- */

  const state = {
    dibuka: false, role: 'admin', modes: ['operasional', 'control', 'admin'], mode: 'control',
    date: '', shift: 'Siang', locationId: '', productId: '',
    masters: { products: [], locations: [] }, online: true, cache: {},
  };

  function apiUrl(path) {
    if (typeof global.getProdApiUrl === 'function') return global.getProdApiUrl(path);
    throw new Error('API produksi belum tersedia.');
  }

  function authHeaders() {
    if (typeof global.getProdAuthHeaders === 'function') return global.getProdAuthHeaders();
    return {};
  }

  async function fwGet(path) {
    const res = await fetch(apiUrl(`${BASE}${path}`), { headers: { ...authHeaders() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function fwPost(path, body) {
    const res = await fetch(apiUrl(`${BASE}${path}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function namaLokasi(id) {
    const l = state.masters.locations.find(x => String(x.id) === String(id));
    return l ? (l.location_code || l.location_name) : String(id || '—').slice(0, 8);
  }

  function namaProduk(id) {
    const p = state.masters.products.find(x => String(x.id) === String(id));
    return p ? (p.product_code || p.product_name) : String(id || '—').slice(0, 8);
  }

  function badge(status, label) {
    return `<span class="fhub-badge is-${statusTone(status)}">${esc(label || status || '—')}</span>`;
  }

  function sibuk(el, pesan) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) el.innerHTML = `<div class="fhub-loading">${esc(pesan || 'Memuat…')}</div>`;
  }

  function galat(el, error) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) el.innerHTML = `<div class="fhub-error">Gagal memuat: ${esc(error?.message || error)}</div>`;
  }

  function opsiMaster(list, codeKey, nameKey, selected) {
    return (list || []).map(x => `<option value="${esc(x.id)}"${String(x.id) === String(selected) ? ' selected' : ''}>${esc(x[codeKey] || x[nameKey] || x.id)}</option>`).join('');
  }

  /* ----- shell ----- */

  function kerangka() {
    const host = document.getElementById('databaseFuelWorkspace');
    if (!host) return;
    host.innerHTML = `<div id="fhubRoot">
      <p style="font-size:12px;color:#64748b;">Input Fuel / <strong>Fuel Operations Hub</strong></p>
      <div class="fhub-head">
        <div><h3>⛽ Fuel Operations Hub</h3><p>Aktivitas BBM harian, kontrol stok, dan integritas data.</p></div>
        <div class="fhub-sync" id="fhubSync"></div>
      </div>
      <div class="fhub-toolbar">
        <div class="fhub-tabs" role="tablist" id="fhubTabs"></div>
        <div class="fhub-context">
          <label>Tanggal <input type="date" id="fhubDate"></label>
          <label>Shift <select id="fhubShift"><option>Siang</option><option>Malam</option></select></label>
          <label>Lokasi <select id="fhubLoc"></select></label>
          <button class="tombol tombol--ghost" id="fhubClassic" type="button">Tampilan klasik</button>
        </div>
      </div>
      <div id="fhubPanel"></div>
      <nav class="fhub-bottomnav" aria-label="Navigasi bawah">
        <button type="button" data-fhub-nav="operasional"><b>⌂</b>Beranda</button>
        <button type="button" data-fhub-nav="__aksi"><b>＋</b>Aksi</button>
        <button type="button" data-fhub-nav="__riwayat"><b>◷</b>Riwayat</button>
        <button type="button" data-fhub-nav="__lain"><b>☰</b>Lainnya</button>
      </nav>
      <p class="fhub-foot">Satuan Liter observed · formula fuel-ledger v1 · <span id="fhubRole"></span></p>
    </div>`;
    document.getElementById('fhubDate').value = state.date;
    document.getElementById('fhubShift').value = state.shift;
    document.getElementById('fhubLoc').innerHTML = opsiMaster(state.masters.locations, 'location_code', 'location_name', state.locationId);
    document.getElementById('fhubLoc').addEventListener('change', e => { state.locationId = e.target.value; void muatMode(); });
    document.getElementById('fhubDate').addEventListener('change', e => { state.date = e.target.value || todayStr(); void muatMode(); });
    document.getElementById('fhubShift').addEventListener('change', e => { state.shift = e.target.value; void muatMode(); });
    document.getElementById('fhubClassic').addEventListener('click', () => bukaKlasik());
    document.querySelectorAll('[data-fhub-nav]').forEach(b => b.addEventListener('click', () => navigasiBawah(b.dataset.fhubNav)));
    tandaiSync();
  }

  function tandaiSync() {
    const el = document.getElementById('fhubSync');
    if (el) el.innerHTML = state.online
      ? '<span class="fhub-dot ok"></span>Online · tersinkron'
      : '<span class="fhub-dot bad"></span>Offline · aksi dinonaktifkan';
    const role = document.getElementById('fhubRole');
    if (role) role.textContent = `mode: ${state.modes.join(', ')} (role ${state.role})`;
  }

  function tandaiTab() {
    const tabs = document.getElementById('fhubTabs');
    if (!tabs) return;
    const label = { operasional: 'Operasional Hari Ini', control: 'Control Center', admin: 'Administrasi' };
    tabs.innerHTML = state.modes.map(m => `<button type="button" role="tab" data-fhub-mode="${m}" class="${m === state.mode ? 'is-active' : ''}">${label[m]}</button>`).join('');
    tabs.querySelectorAll('[data-fhub-mode]').forEach(b => b.addEventListener('click', () => {
      state.mode = b.dataset.fhubMode;
      try { localStorage.setItem(LAST_MODE_KEY, state.mode); } catch (e) {}
      void muatMode();
    }));
  }

  function navigasiBawah(kunci) {
    if (kunci === '__aksi') {
      if (state.mode !== 'operasional') { state.mode = 'operasional'; return void muatMode().then(scrollKeAksi); }
      return scrollKeAksi();
    }
    if (kunci === '__riwayat') {
      if (state.mode !== 'operasional') { state.mode = 'operasional'; return void muatMode().then(scrollKeRiwayat); }
      return scrollKeRiwayat();
    }
    if (kunci === '__lain') {
      state.mode = state.modes.includes('admin') ? 'admin' : state.modes[state.modes.length - 1];
      return void muatMode();
    }
    state.mode = 'operasional';
    return void muatMode();
  }

  function scrollKeAksi() {
    document.getElementById('fhubCta')?.scrollIntoView({ block: 'center' });
  }

  function scrollKeRiwayat() {
    document.getElementById('fhubRiwayat')?.scrollIntoView({ block: 'center' });
  }

  function bukaKlasik() {
    const host = document.getElementById('databaseFuelWorkspace');
    if (!host) return;
    host.innerHTML = '';
    if (window.DatabaseFuelWorkspace && typeof window.DatabaseFuelWorkspace.open === 'function') {
      window.DatabaseFuelWorkspace.open();
    }
  }

  async function muatMaster() {
    const [prod, lok] = await Promise.all([fwGet('/products'), fwGet('/locations')]);
    state.masters.products = Array.isArray(prod) ? prod : [];
    state.masters.locations = Array.isArray(lok) ? lok : [];
    if (!state.locationId && state.masters.locations.length) state.locationId = state.masters.locations[0].id;
    if (!state.productId && state.masters.products.length) state.productId = state.masters.products[0].id;
  }

  async function muatMode() {
    tandaiTab();
    tandaiSync();
    const panel = document.getElementById('fhubPanel');
    if (!panel) return;
    if (state.mode === 'operasional') return muatOperasional(panel);
    if (state.mode === 'control') return muatControl(panel);
    return muatAdmin(panel);
  }

  /* ----- operasional ----- */

  async function muatOperasional(panel) {
    panel.innerHTML = `<div id="fhubCta" class="fhub-cta">
        <button type="button" class="fhub-cta-card is-green" data-wiz="terima"><b>📥</b><span><strong>Terima Solar</strong><small>Catat kedatangan dari pemasok</small></span><i>›</i></button>
        <button type="button" class="fhub-cta-card is-blue" data-wiz="transfer"><b>🚛</b><span><strong>Transfer BBM</strong><small>Pindah antarlokasi/tangki</small></span><i>›</i></button>
        <button type="button" class="fhub-cta-card is-amber" data-wiz="opname"><b>📋</b><span><strong>Catat Opname</strong><small>Ukur fisik stok aktual</small></span><i>›</i></button>
      </div>
      <div class="fhub-grid"><section class="fhub-card" id="fhubBoard"><div class="fhub-chead"><span>SHIFT FUEL BOARD</span></div><div class="fhub-loading">Memuat…</div></section>
      <section class="fhub-card"><div class="fhub-chead"><span>TUGAS SHIFT</span></div><div id="fhubTasks"><div class="fhub-loading">Memuat…</div></div></section></div>
      <div class="fhub-grid"><section class="fhub-card"><div class="fhub-chead"><span>STOK CEPAT PER LOKASI</span></div><div id="fhubQuick"><div class="fhub-loading">Memuat…</div></div></section>
      <section class="fhub-card"><div class="fhub-chead"><span>NOTIFIKASI PENTING</span></div><div id="fhubNotif"><div class="fhub-loading">Memuat…</div></div></section></div>
      <section class="fhub-card" id="fhubRiwayat"><div class="fhub-chead"><span>TRANSAKSI TERAKHIR DI LOKASI</span></div><div id="fhubRecent"><div class="fhub-loading">Memuat…</div></div></section>`;
    panel.querySelectorAll('[data-wiz]').forEach(b => b.addEventListener('click', () => bukaWizard(b.dataset.wiz)));
    try {
      const [bal, flow, sum, rek, opnames, integ] = await Promise.all([
        fwGet(`/balance?location_id=${encodeURIComponent(state.locationId)}${state.productId ? `&product_id=${encodeURIComponent(state.productId)}` : ''}`).catch(() => ({ balance: null })),
        fwGet(`/flow-series?dari=${state.date}&sampai=${state.date}${state.locationId ? `&location_id=${encodeURIComponent(state.locationId)}` : ''}${state.productId ? `&product_id=${encodeURIComponent(state.productId)}` : ''}`).catch(() => []),
        fwGet('/stock-summary').catch(() => []),
        fwGet('/reconciliation?limit=50').catch(() => ({ unlinkedLogs: [], orphanIssues: [], mismatched: [] })),
        fwGet(`/opnames?location_id=${encodeURIComponent(state.locationId)}&limit=100`).catch(() => []),
        fwGet('/integrity-report?limit=5').catch(() => null),
      ]);
      const saldo = Number(bal.balance);
      const hari = Array.isArray(flow) ? flow[0] : null;
      const masuk = Number(hari?.masuk || 0); const keluar = Number(hari?.keluar || 0);
      const tin = Number(hari?.transfer_in || 0); const tout = Number(hari?.transfer_out || 0);
      const awal = Number.isFinite(saldo) ? saldo - masuk + keluar : null;
      const lok = state.masters.locations.find(l => String(l.id) === String(state.locationId)) || {};
      const kap = Number(lok.capacity_liter) || 0;
      const reorder = Number(lok.minimum_stock_liter) || 0;
      const pctKap = kap > 0 && Number.isFinite(saldo) ? Math.min(100, (saldo / kap) * 100) : null;
      const elB = document.getElementById('fhubBoard');
      if (elB) elB.innerHTML = `<div class="fhub-chead"><span>SHIFT FUEL BOARD · ${esc(namaLokasi(state.locationId))}</span>${badge(saldo != null && reorder && saldo <= reorder ? 'warn' : 'ok', saldo != null && reorder && saldo <= reorder ? 'Di bawah reorder' : 'Sehat')}</div>
        <div class="fhub-kpis">
          <div><span>Stok Awal (Estimasi)</span><strong>${esc(fmtL(awal))}</strong></div>
          <div><span>Fuel Masuk</span><strong>${esc(fmtL(masuk))}</strong></div>
          <div><span>Fuel Keluar</span><strong>${esc(fmtL(keluar))}</strong></div>
          <div><span>Transfer ${esc(fmtL(tin))} / ${esc(fmtL(tout))}</span><strong>Masuk / Keluar</strong></div>
          <div class="is-main"><span>Estimasi Stok</span><strong>${esc(fmtL(saldo))}</strong></div>
        </div>
        <div class="fhub-meter"><div><span>Kapasitas ${esc(fmtL(kap))}</span><div class="fhub-bar"><i style="width:${pctKap == null ? 0 : pctKap}%"></i></div><b>${pctKap == null ? '—' : pctKap.toFixed(0) + '%'}</b></div>
        <div><span>Batas reorder ${esc(fmtL(reorder))}</span></div></div>`;
      const unmapped = (rek.unlinkedLogs || []).length;
      const opHariIni = (Array.isArray(opnames) ? opnames : []).filter(o => String(o.operational_date || '').slice(0, 10) === state.date);
      const submitted = (Array.isArray(opnames) ? opnames : []).filter(o => o.status === 'submitted');
      const tugas = [
        { label: 'Stok awal tersedia', sub: Number.isFinite(saldo) ? fmtL(saldo) : 'belum ada data', st: Number.isFinite(saldo) ? 'ok' : 'warn' },
        { label: 'Receipt tercatat hari ini', sub: masuk > 0 ? fmtL(masuk) : 'belum ada', st: masuk > 0 ? 'ok' : 'muted' },
        { label: 'Transaksi belum dimapping', sub: `${unmapped} antrean`, st: unmapped ? 'bad' : 'ok', aksi: unmapped ? 'admin' : '' },
        { label: 'Opname hari ini', sub: opHariIni.length ? `${opHariIni.length} tercatat` : 'belum ada', st: opHariIni.length ? 'ok' : 'warn' },
        { label: 'Sinkronisasi', sub: state.online ? 'online · tersinkron' : 'offline · aksi dinonaktifkan', st: state.online ? 'ok' : 'bad' },
      ];
      const elT = document.getElementById('fhubTasks');
      if (elT) elT.innerHTML = tugas.map(t => `<div class="fhub-task"><i class="is-${t.st}">●</i><div><b>${esc(t.label)}</b><small>${esc(t.sub)}</small></div>${badge(t.st, t.st === 'ok' ? 'Selesai' : t.st === 'muted' ? 'Info' : t.st === 'warn' ? 'Menunggu' : 'Tindakan')}</div>`).join('')
        + (submitted.length ? `<button type="button" class="fhub-link" data-goto="admin">Ada ${submitted.length} opname menunggu approval →</button>` : '');
      elT?.querySelector('[data-goto]')?.addEventListener('click', () => { state.mode = state.modes.includes('admin') ? 'admin' : state.mode; void muatMode(); });
      const elQ = document.getElementById('fhubQuick');
      if (elQ) elQ.innerHTML = `<table class="fhub-table"><thead><tr><th>Lokasi</th><th>Produk</th><th>Stok</th><th>Status</th></tr></thead><tbody>${(sum || []).slice(0, 5).map(r => `<tr><td>${esc(r.location_code || '')}</td><td>${esc(r.product_code || '')}</td><td class="is-number"><b>${esc(fmtL(r.balance_liter))}</b></td><td>${badge(Number(r.balance_liter) <= 0 ? 'bad' : 'ok', Number(r.balance_liter) <= 0 ? 'Kosong' : 'Aman')}</td></tr>`).join('') || '<tr><td colspan="4">Belum ada data.</td></tr>'}</tbody></table>`;
      const notif = [];
      if (integ && !integ.ok) {
        if ((integ.ledger_fifo || []).length) notif.push({ t: `Selisih ledger vs FIFO (${integ.ledger_fifo.length})`, s: 'Perlu pemeriksaan', st: 'bad' });
        if ((integ.transfers || []).length) notif.push({ t: `Transfer pincang (${integ.transfers.length})`, s: 'Perlu pemeriksaan', st: 'bad' });
        if ((integ.adjustments || []).length) notif.push({ t: `Adjustment tanpa opname (${integ.adjustments.length})`, s: 'Perlu pemeriksaan', st: 'bad' });
      }
        if (submitted.length) notif.push({ t: `${submitted.length} opname menunggu approval`, s: 'Maker-checker', st: 'warn' });
      const elN = document.getElementById('fhubNotif');
      if (elN) elN.innerHTML = notif.length
        ? notif.map(n => `<div class="fhub-task"><i class="is-${n.st}">●</i><div><b>${esc(n.t)}</b><small>${esc(n.s)}</small></div></div>`).join('')
        : '<p class="fhub-empty">Tidak ada notifikasi penting.</p>';
      const elR = document.getElementById('fhubRecent');
      if (elR) {
        const recent = await fwGet(`/transactions?location_id=${encodeURIComponent(state.locationId)}&limit=15`).catch(() => []);
        elR.innerHTML = `<table class="fhub-table"><thead><tr><th>Tanggal</th><th>Nomor</th><th>Jenis</th><th>Status</th></tr></thead><tbody>${(recent || []).map(t => `<tr><td>${esc(String(t.operational_date || '').slice(0, 10))}</td><td>${esc(t.transaction_number || '')}</td><td>${esc(t.transaction_type || '')}</td><td>${badge(t.status)}</td></tr>`).join('') || '<tr><td colspan="4">Belum ada transaksi.</td></tr>'}</tbody></table>`;
      }
    } catch (error) {
      galat(panel, error);
    }
  }

  /* ----- wizard ----- */

  const wiz = { jenis: null, step: 0, fields: {}, opId: null, dirty: false };

  function opsiLokasi(selected) {
    return opsiMaster(state.masters.locations, 'location_code', 'location_name', selected);
  }

  function opsiProduk(selected) {
    return opsiMaster(state.masters.products, 'product_code', 'product_name', selected);
  }

  function bukaWizard(jenis) {
    wiz.jenis = jenis; wiz.step = 0; wiz.opId = newOpId(); wiz.dirty = false;
    wiz.fields = { tanggal: state.date, shift: state.shift, location_id: state.locationId, product_id: state.productId };
    gambarWizard();
  }

  function wizardJudul() {
    return wiz.jenis === 'terima' ? 'Terima Solar' : wiz.jenis === 'transfer' ? 'Transfer BBM' : 'Catat Opname';
  }

  function gambarWizard() {
    const overlay = document.getElementById('modalOverlay');
    const konten = document.getElementById('modalKonten');
    if (!overlay || !konten) return;
    overlay.hidden = false;
    const f = wiz.fields;
    const langkah = [0, 1, 2].map(i => `<span class="fhub-step${i === wiz.step ? ' is-active' : ''}"><i>${i + 1}</i>${['Konteks', 'Kuantitas', 'Konfirmasi'][i]}</span>`).join('');
    let isi = '';
    if (wiz.step === 0) {
      isi = `<h4>Langkah 1 — Konteks</h4><p class="fhub-muted">Tanggal ${esc(f.tanggal || '')} · Shift ${esc(f.shift || '')}</p>
        <div class="fhub-formgrid">
        ${wiz.jenis === 'transfer'
          ? `<label>Lokasi Sumber<select data-wf="from_location_id">${opsiLokasi(f.from_location_id)}</select></label>
             <label>Lokasi Tujuan<select data-wf="to_location_id">${opsiLokasi(f.to_location_id)}</select></label>`
          : `<label>Lokasi ${wiz.jenis === 'terima' ? 'Tujuan' : ''}<select data-wf="location_id">${opsiLokasi(f.location_id)}</select></label>`}
        <label>Produk<select data-wf="product_id">${opsiProduk(f.product_id)}</select></label>
        </div>`;
    } else if (wiz.step === 1) {
      isi = `<h4>Langkah 2 — Kuantitas & Bukti</h4>
        <div class="fhub-formgrid">
        <label>Quantity (Liter)<input type="number" min="0.001" step="0.001" data-wf="quantity_liter" value="${esc(f.quantity_liter || '')}"></label>
        ${wiz.jenis === 'terima' ? `<label>Nomor DO / Dokumen<input data-wf="document_number" value="${esc(f.document_number || '')}"></label>
        <label>Supplier<input data-wf="supplier" value="${esc(f.supplier || '')}"></label>` : ''}
        ${wiz.jenis === 'transfer' ? `<label>Catatan<input data-wf="reason" value="${esc(f.reason || '')}"></label>` : ''}
        ${wiz.jenis === 'opname' ? `<label>Metode ukur<select data-wf="measurement_method"><option value="">—</option>${['dipstick', 'sounding', 'flow_meter', 'lainnya'].map(m => `<option${f.measurement_method === m ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
        <label>Catatan<input data-wf="note" value="${esc(f.note || '')}"></label>` : ''}
        ${wiz.jenis === 'terima' && state.role === 'admin' ? `<label>Harga per Liter (Rp, opsional)<input type="number" min="0" step="0.01" data-wf="unit_price" value="${esc(f.unit_price || '')}"></label>` : ''}
        </div>
        <p class="fhub-muted">Foto/struk: simpan manual — upload bukti terpusat belum tersedia.</p>`;
    } else {
      const ringkas = wiz.jenis === 'terima'
        ? ringkasanTerima({ produk: namaProduk(f.product_id), qty: f.quantity_liter, lokasi: namaLokasi(f.location_id) })
        : wiz.jenis === 'transfer'
          ? ringkasanTransfer({ produk: namaProduk(f.product_id), qty: f.quantity_liter, asal: namaLokasi(f.from_location_id), tujuan: namaLokasi(f.to_location_id) })
          : ringkasanOpname({ produk: namaProduk(f.product_id), qty: f.quantity_liter, lokasi: namaLokasi(f.location_id) });
      isi = `<h4>Langkah 3 — Konfirmasi</h4><div class="fhub-confirm">${esc(ringkas)}</div>
        <p class="fhub-muted">Tanggal ${esc(f.tanggal || '')} · Shift ${esc(f.shift || '')}${wiz.jenis === 'opname' ? ' · butuh approval penyetuju berbeda' : ''}${state.online ? '' : ' · <b>OFFLINE — pengiriman dinonaktifkan</b>'}</p>`;
    }
    konten.innerHTML = `<div class="fhub-dialog"><header><div><small>WIZARD</small><h3>${wizardJudul()}</h3></div><button type="button" class="tombol" data-wz="tutup">Tutup</button></header>
      <div class="fhub-steps">${langkah}</div><div class="fhub-wizbody">${isi}</div>
      <footer><button type="button" class="tombol tombol--ghost" data-wz="kembali">${wiz.step === 0 ? 'Batal' : 'Kembali'}</button>
      <button type="button" class="tombol tombol--utama" data-wz="lanjut" ${!state.online && wiz.step === 2 ? 'disabled' : ''}>${wiz.step === 2 ? 'Kirim Transaksi' : 'Lanjutkan'}</button></footer></div>`;
    konten.querySelectorAll('[data-wf]').forEach(el => el.addEventListener('input', () => {
      wiz.fields[el.dataset.wf] = el.value;
      wiz.dirty = true;
    }));
    konten.querySelector('[data-wz="tutup"]').addEventListener('click', () => {
      if (wiz.dirty && !confirm('Tutup wizard? Isian yang belum dikirim akan hilang.')) return;
      tutupModal();
    });
    konten.querySelector('[data-wz="kembali"]').addEventListener('click', () => {
      if (wiz.step === 0) return tutupModal();
      wiz.step -= 1;
      gambarWizard();
    });
    konten.querySelector('[data-wz="lanjut"]').addEventListener('click', e => void wizardLanjut(e.target));
  }

  function tutupModal() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.hidden = true;
    const konten = document.getElementById('modalKonten');
    if (konten) konten.innerHTML = '';
  }

  function validasiWizard() {
    const f = wiz.fields;
    if (!f.product_id) return 'Produk wajib dipilih.';
    if (wiz.jenis === 'transfer') {
      if (!f.from_location_id || !f.to_location_id) return 'Lokasi sumber dan tujuan wajib dipilih.';
      if (String(f.from_location_id) === String(f.to_location_id)) return 'Lokasi sumber dan tujuan tidak boleh sama.';
    } else if (!f.location_id) return 'Lokasi wajib dipilih.';
    if (wiz.step >= 1 && !validQty(f.quantity_liter)) return 'Quantity harus angka > 0 Liter.';
    return null;
  }

  async function wizardLanjut(button) {
    if (wiz.step < 2) {
      const salah = validasiWizard();
      if (salah) { alert(salah); return; }
      wiz.step += 1;
      gambarWizard();
      return;
    }
    const salah = validasiWizard();
    if (salah) { alert(salah); return; }
    const fb = (global.OMOSActionFeedback && typeof global.OMOSActionFeedback.run === 'function' && button)
      ? { run: fn => global.OMOSActionFeedback.run(button, fn) } : null;
    const kirim = async () => {
      const f = wiz.fields;
      if (wiz.jenis === 'terima') {
        const draf = await fwPost('/transactions', {
          transaction_type: 'receipt', operational_date: f.tanggal, product_id: f.product_id,
          destination_location_id: f.location_id, document_number: f.document_number || null,
          supplier_reference: f.supplier || null,
          lines: [{ direction: 'in', quantity_liter: Number(f.quantity_liter),
            unit_price: f.unit_price === '' || f.unit_price == null ? null : Number(f.unit_price) }],
        });
        const posted = await fwPost(`/transactions/${draf.id}/post`, {});
        return { id: posted.id, nomor: posted.transaction_number };
      }
      if (wiz.jenis === 'transfer') {
        const hasil = await fwPost('/transfers', {
          from_location_id: f.from_location_id, to_location_id: f.to_location_id,
          product_id: f.product_id, quantity_liter: Number(f.quantity_liter),
          operational_date: f.tanggal, reason: f.reason || null, idempotency_key: wiz.opId,
        });
        return { id: (hasil.transactions || [])[0] || hasil.transfer_group_id, nomor: hasil.transfer_group_id };
      }
      const op = await fwPost('/opnames', {
        location_id: f.location_id, product_id: f.product_id, operational_date: f.tanggal,
        physical_quantity: Number(f.quantity_liter), measurement_method: f.measurement_method || null,
        note: f.note || null,
      });
      const sub = await fwPost(`/opnames/${op.id}/submit`, {});
      return { id: sub.id, nomor: 'menunggu approval (maker-checker)' };
    };
    try {
      const hasil = fb ? await fb.run(kirim) : await kirim();
      wiz.dirty = false;
      const konten = document.getElementById('modalKonten');
      if (konten) konten.innerHTML = `<div class="fhub-dialog"><header><div><small>BERHASIL</small><h3>${wizardJudul()} terkirim</h3></div><button type="button" class="tombol" onclick="document.getElementById('modalOverlay').hidden=true">Tutup</button></header>
        <div class="fhub-wizbody"><div class="fhub-confirm">${esc(wizardRingkasanAkhir())}</div><p class="fhub-muted">Referensi: ${esc(hasil.nomor || hasil.id || '—')}</p></div></div>`;
      void muatMode();
    } catch (error) {
      alert(`Gagal mengirim: ${error.message}`);
    }
  }

  function wizardRingkasanAkhir() {
    const f = wiz.fields;
    if (wiz.jenis === 'terima') return ringkasanTerima({ produk: namaProduk(f.product_id), qty: f.quantity_liter, lokasi: namaLokasi(f.location_id) });
    if (wiz.jenis === 'transfer') return ringkasanTransfer({ produk: namaProduk(f.product_id), qty: f.quantity_liter, asal: namaLokasi(f.from_location_id), tujuan: namaLokasi(f.to_location_id) });
    return ringkasanOpname({ produk: namaProduk(f.product_id), qty: f.quantity_liter, lokasi: namaLokasi(f.location_id) });
  }

  /* ----- control ----- */

  async function muatControl(panel) {
    panel.innerHTML = `<div class="fhub-kpis" id="fhubKpi"><div class="fhub-loading">Memuat KPI…</div></div>
      <section class="fhub-card"><div class="fhub-chead"><span>STOCK MATRIX · LOKASI × PRODUK</span></div><div id="fhubMatrix"><div class="fhub-loading">Memuat…</div></div></section>
      <div class="fhub-grid"><section class="fhub-card"><div class="fhub-chead"><span>ACTION QUEUE</span></div><div id="fhubQueue"><div class="fhub-loading">Memuat…</div></div></section>
      <section class="fhub-card"><div class="fhub-chead"><span>DATA LINEAGE</span></div><div id="fhubLineage"><p class="fhub-empty">Klik baris lokasi untuk menelusuri transaksi, FIFO, dan opname.</p></div></section></div>`;
    try {
      const sampai = state.date;
      const dari30 = new Date(`${sampai}T00:00:00Z`);
      dari30.setUTCDate(dari30.getUTCDate() - 29);
      const dari = dari30.toISOString().slice(0, 10);
      const [sum, use, integ, rek, submitted] = await Promise.all([
        fwGet('/stock-summary'),
        fwGet(`/usage-stats?dari=${dari}&sampai=${sampai}`).catch(() => null),
        fwGet('/integrity-report?limit=20').catch(() => null),
        fwGet('/reconciliation?limit=50').catch(() => ({ unlinkedLogs: [], orphanIssues: [], mismatched: [] })),
        fwGet('/opnames?status=submitted&limit=50').catch(() => []),
      ]);
      const rows = Array.isArray(sum) ? sum : [];
      const totalStok = rows.reduce((s, r) => s + Number(r.balance_liter || 0), 0);
      const totalNilai = rows.reduce((s, r) => s + Number(r.fifo_value_idr || 0), 0);
      const elK = document.getElementById('fhubKpi');
      if (elK) elK.innerHTML = `
        <article><small>Total Stok</small><b>${esc(fmtL(totalStok))}</b><span>${rows.length} kombinasi lokasi×produk</span></article>
        <article><small>Nilai Persediaan</small><b>${esc(fmtRp(totalNilai))}</b><span>valuasi FIFO (cost diketahui)</span></article>
        <article><small>ADU 30 Hari</small><b>${esc(fmtL(use?.adu_liter_per_day))}</b><span>basis ${esc(use?.basis || 'calendar')}</span></article>
        <article><small>Days of Stock</small><b>${use?.days_of_stock == null ? '—' : Number(use.days_of_stock).toFixed(1)}</b><span>${esc(use?.formula_version || '')}</span></article>
        <article><small>Integritas</small><b>${integ ? (integ.ok ? '✅ OK' : '⚠ Temuan') : '—'}</b><span>${integ ? `ledger≠FIFO:${(integ.ledger_fifo || []).length} transfer:${(integ.transfers || []).length} adj:${(integ.adjustments || []).length}` : ''}</span></article>`;
      const elM = document.getElementById('fhubMatrix');
      if (elM) elM.innerHTML = `<div class="fhub-scrollx"><table class="fhub-table"><thead><tr><th>Lokasi</th><th>Produk</th><th>Buku</th><th>FIFO</th><th>Selisih</th><th>Status</th></tr></thead><tbody>${rows.map((r, i) => {
        const selisih = Number(r.balance_liter || 0) - Number(r.fifo_liter || 0);
        const ok = Math.abs(selisih) <= 0.001;
        return `<tr data-lineage="${i}" style="cursor:pointer;"><td><b>${esc(r.location_code || '')}</b></td><td>${esc(r.product_code || '')}</td><td class="is-number">${esc(fmtL(r.balance_liter))}</td><td class="is-number">${esc(fmtL(r.fifo_liter))}</td><td class="is-number" style="${ok ? '' : 'color:#b91c1c;font-weight:800;'}">${esc(fmtL(selisih))}</td><td>${badge(ok ? 'ok' : 'bad', ok ? 'Valid' : 'Review')}</td></tr>`;
      }).join('') || '<tr><td colspan="6">Belum ada data.</td></tr>'}</tbody></table></div>`;
      elM?.querySelectorAll('[data-lineage]').forEach(tr => tr.addEventListener('click', () => {
        const r = rows[Number(tr.dataset.lineage)];
        if (r) void muatLineage(r.location_id, r.product_id, `${r.location_code} × ${r.product_code}`);
      }));
      const antre = [];
      (integ?.ledger_fifo || []).forEach(x => antre.push({ t: `Selisih ledger vs FIFO`, s: `${x.location_code || ''} ${x.product_code || ''}: buku ${fmtL(x.balance_liter)} vs FIFO ${fmtL(x.fifo_liter)}`, st: 'bad', ke: 'ledger' }));
      (integ?.transfers || []).forEach(x => antre.push({ t: 'Transfer pincang', s: `grup ${(x.transfer_group_id || '').slice(0, 8)}…`, st: 'bad', ke: 'ledger' }));
      (integ?.adjustments || []).forEach(x => antre.push({ t: 'Adjustment bermasalah', s: `${x.transaction_number || x.id || ''} (${x.masalah || ''})`, st: 'bad', ke: 'ledger' }));
      (rek.unlinkedLogs || []).slice(0, 10).forEach(l => antre.push({ t: 'Issue belum dimapping', s: `log ${String(l.id || '').slice(0, 8)}… · ${fmtL(l.fuel_filled)}`, st: 'warn', ke: 'mapping' }));
      (submitted || []).forEach(o => antre.push({ t: 'Opname menunggu approval', s: `${fmtL(o.physical_quantity)} · ${String(o.operational_date || '').slice(0, 10)}`, st: 'warn', ke: 'klasik' }));
      const elQ = document.getElementById('fhubQueue');
      if (elQ) elQ.innerHTML = antre.length
        ? antre.slice(0, 20).map((a, i) => `<button type="button" class="fhub-tasklink" data-antre="${i}"><i class="is-${a.st}">●</i><div><b>${esc(a.t)}</b><small>${esc(a.s)}</small></div><span>›</span></button>`).join('')
        : '<p class="fhub-empty">Nihil — semua antrean bersih.</p>';
      elQ?.querySelectorAll('[data-antre]').forEach(b => b.addEventListener('click', () => {
        const a = antre[Number(b.dataset.antre)];
        if (!a) return;
        if (a.ke === 'klasik') { bukaKlasik(); return; }
        state.mode = 'admin';
        state.adminView = a.ke === 'mapping' ? 'mapping' : 'ledger';
        void muatMode();
      }));
    } catch (error) {
      galat(panel, error);
    }
  }

  async function muatLineage(locationId, productId, judul) {
    const el = document.getElementById('fhubLineage');
    if (!el) return;
    el.innerHTML = '<div class="fhub-loading">Menelusuri lineage…</div>';
    try {
      const q = `location_id=${encodeURIComponent(locationId)}${productId ? `&product_id=${encodeURIComponent(productId)}` : ''}`;
      const [txns, layers] = await Promise.all([
        fwGet(`/transactions?${q}&limit=30`),
        fwGet(`/fifo-layers?${q}`),
      ]);
      let alokasi = '—';
      if (txns.length) {
        try {
          const al = await fwGet(`/allocations?transaction_id=${encodeURIComponent(txns[0].id)}`);
          alokasi = al.length ? al.map(a => `${Number(a.allocated_quantity)} L ← layer ${String(a.fifo_layer_id || '').slice(0, 8)}… @${a.unit_cost_snapshot == null ? '?' : fmtRp(a.unit_cost_snapshot)}`).join('<br>') : 'tanpa alokasi (inbound)';
        } catch (e) { alokasi = 'gagal memuat alokasi'; }
      }
      el.innerHTML = `<b>${esc(judul)}</b>
        <div class="fhub-timeline">
          <div><b>Transaksi terakhir (${txns.length})</b><br><small>${txns.map(t => `${esc(String(t.operational_date || '').slice(0, 10))} · ${esc(t.transaction_type)} · ${esc(t.transaction_number || '')} · ${badge(t.status)}`).join('<br>') || '—'}</small></div>
          <div><b>Alokasi FIFO transaksi terbaru</b><br><small>${alokasi}</small></div>
          <div><b>Layer FIFO open (${layers.length})</b><br><small>${layers.slice(0, 8).map(l => `${fmtL(l.remaining_quantity)} @${l.unit_cost == null ? '?' : fmtRp(l.unit_cost)}${l.batch_number ? ` · ${esc(l.batch_number)}` : ''}`).join('<br>') || '—'}</small></div>
        </div>
        <p class="fhub-muted">Formula fuel-ledger v1 · angka dari API, bukan hitungan browser.</p>`;
    } catch (error) {
      galat(el, error);
    }
  }

  /* ----- admin ----- */

  async function muatAdmin(panel) {
    const view = state.adminView || 'menu';
    if (view === 'menu') {
      panel.innerHTML = `<div class="fhub-tools">
        ${[['master', '🗃️', 'Master Data', 'Produk, lokasi, tangki'],
          ['mapping', '🧭', 'Mapping Sumber', 'Resolusi lokasi issue'],
          ['rekon', '✅', 'Rekonsiliasi', 'Antrean unlinked/orphan/mismatch'],
          ['ledger', '📒', 'Ledger & FIFO', 'Transaksi + layer per filter'],
          ['export', '⬇️', 'Export', 'CSV per tipe + filter']].map(([k, ikon, nama, des]) => `
        <button type="button" class="fhub-tool" data-admin="${k}"><span>${ikon}</span><div><b>${nama}</b><small>${des}</small></div><span>›</span></button>`).join('')}
        <button type="button" class="fhub-tool" data-admin="klasik"><span>🗂️</span><div><b>Tampilan Klasik</b><small>5 tab workspace + Analytics</small></div><span>›</span></button>
      </div>
      <p class="fhub-muted">Analytics & chart lengkap tetap di tampilan klasik selama masa transisi.</p>`;
      panel.querySelectorAll('[data-admin]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.admin === 'klasik') { bukaKlasik(); return; }
        state.adminView = b.dataset.admin;
        void muatMode();
      }));
      return;
    }
    panel.innerHTML = `<button type="button" class="tombol tombol--ghost" id="fhubBack">← Administrasi</button><div id="fhubAdminBody"><div class="fhub-loading">Memuat…</div></div>`;
    document.getElementById('fhubBack').addEventListener('click', () => { state.adminView = 'menu'; void muatMode(); });
    const body = document.getElementById('fhubAdminBody');
    try {
      if (view === 'master') return muatAdminMaster(body);
      if (view === 'mapping') return muatAdminMapping(body);
      if (view === 'rekon') return muatAdminRekon(body);
      if (view === 'ledger') return muatAdminLedger(body);
      if (view === 'export') return muatAdminExport(body);
    } catch (error) {
      galat(body, error);
    }
  }

  async function muatAdminMaster(body) {
    await muatMaster();
    const render = () => {
      body.innerHTML = `<div class="fhub-grid">
        <section class="fhub-card"><div class="fhub-chead"><span>PRODUK</span></div>
        <table class="fhub-table"><tbody>${state.masters.products.map(p => `<tr><td><b>${esc(p.product_code)}</b><br><small>${esc(p.product_name || '')}</small></td><td>${p.is_active === false ? badge('muted', 'Nonaktif') : badge('ok', 'Aktif')}</td></tr>`).join('') || '<tr><td>Belum ada.</td></tr>'}</tbody></table>
        <div class="fhub-formgrid"><label>Kode*<input id="fhubNPCode"></label><label>Nama*<input id="fhubNPName"></label><label>Densitas<input id="fhubNPDens" type="number" step="0.0001" min="0"></label><button class="tombol tombol--utama" id="fhubNPAdd" type="button">+ Produk</button></div></section>
        <section class="fhub-card"><div class="fhub-chead"><span>LOKASI / TANK</span></div>
        <table class="fhub-table"><tbody>${state.masters.locations.map(l => `<tr><td><b>${esc(l.location_code)}</b><br><small>${esc(l.location_name || '')} · ${esc(l.storage_type || '')}</small></td><td class="is-number">${esc(fmtL(l.capacity_liter))}</td></tr>`).join('') || '<tr><td>Belum ada.</td></tr>'}</tbody></table>
        <div class="fhub-formgrid"><label>Kode*<input id="fhubNLCode"></label><label>Nama*<input id="fhubNLName"></label>
        <label>Tipe<select id="fhubNLType"><option value="depot">depot</option><option value="tank">tank</option><option value="fuel_truck">fuel_truck</option></select></label>
        <label>Kapasitas (L)<input id="fhubNLCap" type="number" min="0" step="1"></label>
        <label>Minimum (L)<input id="fhubNLMin" type="number" min="0" step="1"></label>
        <button class="tombol tombol--utama" id="fhubNLAdd" type="button">+ Lokasi</button></div></section></div>`;
      const jalankan = (btn, fn) => {
        const fb = global.OMOSActionFeedback && typeof global.OMOSActionFeedback.run === 'function' ? global.OMOSActionFeedback : null;
        if (fb && btn) return fb.run(btn, fn).then(() => muatAdminMaster(body)).catch(e => alert(`Gagal: ${e.message}`));
        return fn().then(() => muatAdminMaster(body)).catch(e => alert(`Gagal: ${e.message}`));
      };
      document.getElementById('fhubNPAdd').addEventListener('click', e => jalankan(e.target, () => fwPost('/products', {
        product_code: document.getElementById('fhubNPCode').value,
        product_name: document.getElementById('fhubNPName').value,
        density_kg_l: document.getElementById('fhubNPDens').value === '' ? null : Number(document.getElementById('fhubNPDens').value),
      }).then(() => muatMaster())));
      document.getElementById('fhubNLAdd').addEventListener('click', e => jalankan(e.target, () => fwPost('/locations', {
        location_code: document.getElementById('fhubNLCode').value,
        location_name: document.getElementById('fhubNLName').value,
        storage_type: document.getElementById('fhubNLType').value,
        capacity_liter: document.getElementById('fhubNLCap').value === '' ? null : Number(document.getElementById('fhubNLCap').value),
        minimum_stock_liter: document.getElementById('fhubNLMin').value === '' ? null : Number(document.getElementById('fhubNLMin').value),
      }).then(() => muatMaster())));
    };
    render();
  }

  async function muatAdminMapping(body) {
    const maps = await fwGet('/mappings').catch(() => []);
    body.innerHTML = `<section class="fhub-card"><div class="fhub-chead"><span>MAPPING SUMBER (${(maps || []).length})</span></div>
      <table class="fhub-table"><thead><tr><th>Shift</th><th>Truck</th><th>Operator</th><th>Produk</th><th>Lokasi</th><th>Aktif</th></tr></thead><tbody>${(maps || []).map(m => `<tr><td>${esc(m.shift_id ? String(m.shift_id).slice(0, 8) : '—')}</td><td>${esc(m.truck_equipment_id ? String(m.truck_equipment_id).slice(0, 8) : '—')}</td><td>${esc(m.operator_id ? String(m.operator_id).slice(0, 8) : '—')}</td><td>${esc(m.product_code || '')}</td><td>${esc(m.location_code || '')}</td><td>${m.is_active === false ? badge('muted', 'Mati') : badge('ok', 'Aktif')}</td></tr>`).join('') || '<tr><td colspan="6">Belum ada mapping — issue baru masuk antrean.</td></tr>'}</tbody></table>
      <div class="fhub-formgrid"><label>Shift ID<input id="fhubMShift" placeholder="opsional"></label><label>Truck/Equipment ID<input id="fhubMTruck" placeholder="opsional"></label><label>Operator ID<input id="fhubMOp" placeholder="opsional"></label>
      <label>Produk*<select id="fhubMProd">${opsiMaster(state.masters.products, 'product_code', 'product_name')}</select></label>
      <label>Lokasi*<select id="fhubMLoc">${opsiMaster(state.masters.locations, 'location_code', 'location_name')}</select></label>
      <button class="tombol tombol--utama" id="fhubMAdd" type="button">+ Mapping</button></div>
      <p class="fhub-muted">Minimal satu kunci (shift/truck/operator). Resolusi: cocok unik → lokasi; selain itu antrean.</p></section>`;
    document.getElementById('fhubMAdd').addEventListener('click', e => {
      const fb = global.OMOSActionFeedback && typeof global.OMOSActionFeedback.run === 'function' ? global.OMOSActionFeedback : null;
      const fn = () => fwPost('/mappings', {
        shift_id: document.getElementById('fhubMShift').value || null,
        truck_equipment_id: document.getElementById('fhubMTruck').value || null,
        operator_id: document.getElementById('fhubMOp').value || null,
        product_id: document.getElementById('fhubMProd').value,
        location_id: document.getElementById('fhubMLoc').value,
      }).then(() => muatAdminMapping(body));
      if (fb) fb.run(e.target, fn).catch(err => alert(`Gagal: ${err.message}`));
      else fn().catch(err => alert(`Gagal: ${err.message}`));
    });
  }

  async function muatAdminRekon(body) {
    const rek = await fwGet('/reconciliation?limit=100');
    const tabel = (judul, rows, kolom) => `<h4>${esc(judul)} (${rows.length})</h4>${rows.length ? `<div class="fhub-scrollx"><table class="fhub-table"><thead><tr>${kolom.map(k => `<th>${esc(k[1])}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${kolom.map(k => `<td>${esc(r[k[0]] == null ? '' : typeof r[k[0]] === 'object' ? JSON.stringify(r[k[0]]) : r[k[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="fhub-empty">Nihil.</p>'}`;
    body.innerHTML = `<section class="fhub-card"><div class="fhub-chead"><span>ANTREAN REKONSILIASI</span></div><div style="padding:0 12px 12px;">
      ${tabel('Log tanpa issue', rek.unlinkedLogs || [], [['id', 'Log'], ['tanggal', 'Tanggal'], ['fuel_filled', 'Liter'], ['equipment_id', 'Unit']])}
      ${tabel('Issue yatim', rek.orphanIssues || [], [['id', 'Issue'], ['transaction_number', 'Nomor'], ['status', 'Status']])}
      ${tabel('Qty tidak cocok', rek.mismatched || [], [['id', 'Issue'], ['fuel_log_id', 'Log'], ['fuel_filled', 'Log L'], ['qty', 'Issue L']])}
      <h4>Tautkan manual</h4>
      <div class="fhub-formgrid"><label>Fuel Log ID*<input id="fhubLLog"></label><label>Lokasi*<select id="fhubLLoc">${opsiMaster(state.masters.locations, 'location_code', 'location_name')}</select></label><label>Produk*<select id="fhubLProd">${opsiMaster(state.masters.products, 'product_code', 'product_name')}</select></label>
      <button class="tombol tombol--utama" id="fhubLGo" type="button">Tautkan</button></div></div></section>`;
    document.getElementById('fhubLGo').addEventListener('click', e => {
      const fb = global.OMOSActionFeedback && typeof global.OMOSActionFeedback.run === 'function' ? global.OMOSActionFeedback : null;
      const fn = () => fwPost('/issues/link', {
        fuel_log_id: document.getElementById('fhubLLog').value,
        location_id: document.getElementById('fhubLLoc').value,
        product_id: document.getElementById('fhubLProd').value,
      }).then(() => muatAdminRekon(body));
      if (fb) fb.run(e.target, fn).then(() => alert('Issue tertaut.')).catch(err => alert(`Gagal: ${err.message}`));
      else fn().then(() => alert('Issue tertaut.')).catch(err => alert(`Gagal: ${err.message}`));
    });
  }

  async function muatAdminLedger(body) {
    body.innerHTML = `<section class="fhub-card"><div class="fhub-chead"><span>LEDGER & FIFO</span></div><div style="padding:0 12px 12px;">
      <div class="fhub-formgrid"><label>Tipe<select id="fhubFTipe"><option value="">Semua</option>${['receipt', 'issue_equipment', 'transfer_out', 'transfer_in', 'return', 'loss', 'opname_adjustment_in', 'opname_adjustment_out', 'opening_balance', 'reversal'].map(t => `<option>${t}</option>`).join('')}</select></label>
      <label>Status<select id="fhubFStatus"><option value="">Semua</option>${['draft', 'posted', 'reversed', 'void'].map(t => `<option>${t}</option>`).join('')}</select></label>
      <button class="tombol" id="fhubFGo" type="button">Tampilkan</button></div>
      <div id="fhubFTabel"></div></div></section>`;
    let halaman = 0;
    const muat = async () => {
      const q = new URLSearchParams({ limit: '51', offset: String(halaman * 50) });
      const tipe = document.getElementById('fhubFTipe').value;
      const st = document.getElementById('fhubFStatus').value;
      if (tipe) q.set('type', tipe);
      if (st) q.set('status', st);
      const rows = await fwGet(`/transactions?${q}`);
      const adaLanjut = Array.isArray(rows) && rows.length > 50;
      const tampil = (rows || []).slice(0, 50);
      document.getElementById('fhubFTabel').innerHTML = `<div class="fhub-scrollx"><table class="fhub-table"><thead><tr><th>Tanggal</th><th>Nomor</th><th>Jenis</th><th>Status</th><th>Asal → Tujuan</th><th>Saldo Jalan</th></tr></thead><tbody>${tampil.map(t => `<tr data-tx="${esc(t.id)}" style="cursor:pointer;"><td>${esc(String(t.operational_date || '').slice(0, 10))}</td><td>${esc(t.transaction_number || '')}</td><td>${esc(t.transaction_type || '')}</td><td>${badge(t.status)}</td><td>${esc(t.source_code || '—')} → ${esc(t.destination_code || '—')}</td><td class="is-number">${esc(fmtL(t.running_balance))}</td></tr>`).join('') || '<tr><td colspan="6">Belum ada data.</td></tr>'}</tbody></table></div>
        <div class="fhub-pager"><button type="button" class="tombol tombol--ghost" data-pg="-1" ${halaman === 0 ? 'disabled' : ''}>←</button><span>Halaman ${halaman + 1}</span><button type="button" class="tombol tombol--ghost" data-pg="1" ${adaLanjut ? '' : 'disabled'}>→</button></div>
        <div id="fhubFTLineage"></div>`;
      document.querySelectorAll('#fhubFTabel [data-pg]').forEach(b => b.addEventListener('click', () => { halaman = Math.max(0, halaman + Number(b.dataset.pg)); void muat(); }));
      document.querySelectorAll('#fhubFTabel [data-tx]').forEach(tr => tr.addEventListener('click', async () => {
        const host = document.getElementById('fhubFTLineage');
        host.innerHTML = '<div class="fhub-loading">Menelusuri…</div>';
        try {
          const al = await fwGet(`/allocations?transaction_id=${encodeURIComponent(tr.dataset.tx)}`);
          host.innerHTML = al.length
            ? `<b>Alokasi FIFO</b><br><small>${al.map(a => `${fmtL(a.allocated_quantity)} ← layer ${esc(String(a.fifo_layer_id || '').slice(0, 8))}… @${a.unit_cost_snapshot == null ? '?' : fmtRp(a.unit_cost_snapshot)}`).join('<br>')}</small>`
            : '<small>Tanpa alokasi (inbound/draft).</small>';
        } catch (e) { host.innerHTML = `<small>Gagal: ${esc(e.message)}</small>`; }
      }));
    };
    document.getElementById('fhubFGo').addEventListener('click', () => { halaman = 0; void muat().catch(e => galat(document.getElementById('fhubFTabel'), e)); });
    await muat().catch(e => galat(document.getElementById('fhubFTabel'), e));
  }

  async function muatAdminExport(body) {
    body.innerHTML = `<section class="fhub-card"><div class="fhub-chead"><span>EXPORT CSV</span></div><div style="padding:0 12px 12px;">
      <div class="fhub-formgrid"><label>Tipe<select id="fhubXType"><option value="ledger">ledger</option><option value="summary">summary</option><option value="flow">flow</option><option value="opnames">opnames</option></select></label>
      <label>Dari<input type="date" id="fhubXDari" value="${state.date}"></label><label>Sampai<input type="date" id="fhubXSampai" value="${state.date}"></label>
      <button class="tombol tombol--utama" id="fhubXGo" type="button">📥 Unduh</button></div>
      <p class="fhub-muted">File mencantumkan filter, waktu, satuan Liter, dan versi formula.</p></div></section>`;
    document.getElementById('fhubXGo').addEventListener('click', () => {
      const q = new URLSearchParams({ type: document.getElementById('fhubXType').value, dari: document.getElementById('fhubXDari').value, sampai: document.getElementById('fhubXSampai').value });
      if (state.locationId) q.set('location_id', state.locationId);
      fetch(apiUrl(`${BASE}/export?${q}`), { headers: { ...authHeaders() } }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      }).then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `database-fuel-${document.getElementById('fhubXType').value}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }).catch(error => alert(`Export gagal: ${error.message}`));
    });
  }

  /* ----- entry ----- */

  const ui = {
    available() { return hubEnabled(); },
    open() {
      state.role = roleOf();
      state.modes = modesFor(state.role);
      try {
        const last = localStorage.getItem(LAST_MODE_KEY);
        state.mode = state.modes.includes(last) ? last : state.modes.includes('control') && state.role === 'admin' ? 'control' : state.modes[0];
      } catch (e) { state.mode = state.role === 'admin' ? 'control' : 'operasional'; }
      state.date = todayStr();
      state.shift = 'Siang';
      state.adminView = 'menu';
      if (!document.getElementById('fhubRoot')) kerangka();
      if (typeof window !== 'undefined' && window.addEventListener && !state.onlineBound) {
        state.onlineBound = true;
        window.addEventListener('online', () => { state.online = true; tandaiSync(); });
        window.addEventListener('offline', () => { state.online = false; tandaiSync(); });
      }
      state.online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      muatMaster().then(() => {
        const loc = document.getElementById('fhubLoc');
        if (loc) loc.innerHTML = opsiMaster(state.masters.locations, 'location_code', 'location_name', state.locationId);
        const s = document.getElementById('fhubShift');
        if (s) s.value = state.shift;
        const d = document.getElementById('fhubDate');
        if (d) d.value = state.date;
        return muatMode();
      }).catch(error => {
        const panel = document.getElementById('fhubPanel');
        if (panel) galat(panel, error);
      });
    },
    refresh() { return muatMode(); },
  };

  return {
    pure: { esc, fmtL, fmtRp, fmtPct, todayStr, newOpId, roleOf, modesFor, hubEnabled, validQty, ringkasanTerima, ringkasanTransfer, ringkasanOpname, statusTone },
    ui,
  };
});
