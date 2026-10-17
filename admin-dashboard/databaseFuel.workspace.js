/*
 * Database Fuel workspace — transaksi stok, ledger, FIFO, opname, analitik, dan mapping sumber.
 * Seluruh angka berasal dari API agregat backend (/api/admin/production/fuel-inventory);
 * browser tidak pernah memuat seluruh ledger (ledger memakai paginasi offset).
 * Fungsi murni di bawah diekspor untuk regression test node.
 */
(function (global, factory) {
  const api = factory(global);
  if (global) global.DatabaseFuelWorkspace = api.workspace;
  if (typeof module === 'object' && module.exports) module.exports = api.pure;
})(typeof window !== 'undefined' ? window : globalThis, function createDatabaseFuelWorkspace(global) {
  'use strict';

  const BASE = '/api/admin/production/fuel-inventory';
  const LEDGER_LIMIT = 50;

  /* ---------- fungsi murni (diuji via node) ---------- */

  function fmtLiter(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(Number(v))} L`;
  }

  function fmtIDR(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(v))}`;
  }

  function fmtPct(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${Number(v) > 0 ? '+' : ''}${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(v))}%`;
  }

  function statusBadge(status) {
    const peta = {
      draft: ['DRAF', '#64748b'], submitted: ['DIAJUKAN', '#b45309'],
      approved: ['DISETUJUI', '#1d4ed8'], adjusted: ['DISESUAIKAN', '#15803d'],
      rejected: ['DITOLAK', '#b91c1c'], posted: ['POSTED', '#15803d'],
      reversed: ['REVERSED', '#7c3aed'], void: ['VOID', '#64748b'],
    };
    const s = String(status || '').toLowerCase();
    return peta[s] || [String(status || '—').toUpperCase(), '#475569'];
  }

  function halamanAda(rows, limit) {
    return Array.isArray(rows) && rows.length > limit;
  }

  function buildFlowDataset(series) {
    const data = Array.isArray(series) ? series : [];
    return {
      labels: data.map(r => r.tanggal),
      masuk: data.map(r => Number(r.masuk || 0)),
      keluar: data.map(r => Number(r.keluar || 0)),
      issue: data.map(r => Number(r.issue || 0)),
    };
  }

  function buildVarianceDataset(opnames, maksimal = 20) {
    const data = (Array.isArray(opnames) ? opnames : []).slice(0, maksimal).reverse();
    return {
      labels: data.map(r => `${String(r.operational_date || '').slice(0, 10)} ${r.id ? String(r.id).slice(0, 8) : ''}`),
      persen: data.map(r => (r.variance_percent == null ? 0 : Number(r.variance_percent))),
      tanpaBasis: data.map(r => r.variance_percent == null),
      alert: data.map(r => Boolean(r.variance_alert)),
    };
  }

  function exportUrl(type, filters = {}) {
    const q = new URLSearchParams({ type });
    for (const k of ['dari', 'sampai', 'location_id', 'product_id', 'status']) {
      if (filters[k] != null && filters[k] !== '') q.set(k, filters[k]);
    }
    return `${BASE}/export?${q.toString()}`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function buildInboundPayload(input = {}) {
    const type = String(input.transaction_type || 'receipt');
    if (!['receipt', 'opening_balance'].includes(type)) throw new Error('Jenis penerimaan tidak valid.');
    const qty = Number(input.quantity_liter);
    if (!(qty > 0)) throw new Error('Quantity harus lebih dari 0 Liter.');
    return {
      transaction_type: type, operational_date: input.operational_date,
      transaction_at: input.transaction_at || undefined,
      product_id: input.product_id, destination_location_id: input.destination_location_id,
      document_number: input.document_number || null,
      supplier_reference: input.supplier_reference || null,
      reason: input.reason || null, source_type: 'manual',
      idempotency_key: input.idempotency_key,
      lines: [{ direction: 'in', quantity_liter: qty,
        unit_price: input.unit_price === '' || input.unit_price == null ? null : Number(input.unit_price),
        batch_number: input.batch_number || null, source_reference: input.source_reference || null }],
    };
  }

  function mappingValid(input = {}) {
    return Boolean((input.shift_id || input.truck_equipment_id || input.operator_id)
      && input.product_id && input.location_id);
  }

  /* ---------- state + API (browser) ---------- */

  const state = {
    dibuka: false, tab: 'overview', halamanLedger: 0,
    masters: { locations: [], products: [], equipment: [], shifts: [], operators: [] },
    cache: {},
  };

  function todayStr() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  function defaultDari() {
    const t = new Date();
    t.setDate(t.getDate() - 29);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

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

  async function fwMutate(path, method, body) {
    const res = await fetch(apiUrl(`${BASE}${path}`), {
      method, headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function feedback() {
    return global.OMOSActionFeedback || null;
  }

  async function jalankanTombol(button, task) {
    const fb = feedback();
    if (fb && button) return fb.run(button, task);
    return task();
  }

  function bacaFilter() {
    const v = id => document.getElementById(id)?.value || '';
    return {
      dari: v('dbfDari') || defaultDari(), sampai: v('dbfSampai') || todayStr(),
      location_id: v('dbfLokasi') || '', product_id: v('dbfProduk') || '',
      status: v('dbfStatus') || '',
    };
  }

  function opsiLokasi() {
    return state.masters.locations.map(l => `<option value="${esc(l.id)}">${esc(l.location_code)} — ${esc(l.location_name || '')}</option>`).join('');
  }

  function opsiProduk() {
    return state.masters.products.map(p => `<option value="${esc(p.id)}">${esc(p.product_code)}</option>`).join('');
  }

  function opsi(items, valueKey, labelFn, kosong = '— Pilih —') {
    return `<option value="">${esc(kosong)}</option>` + (items || []).map(item =>
      `<option value="${esc(item[valueKey])}">${esc(labelFn(item))}</option>`).join('');
  }

  function idempotencyKey(prefix) {
    const id = global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}:${id}`;
  }

  function tutupModal() { document.getElementById('dbfModalOverlay')?.remove(); }

  function bukaModal(judul, isi) {
    tutupModal();
    const overlay = document.createElement('div');
    overlay.id = 'dbfModalOverlay';
    overlay.className = 'dbf-modal-overlay';
    overlay.innerHTML = `<section class="dbf-modal" role="dialog" aria-modal="true" aria-labelledby="dbfModalTitle">
      <header><div><small>DATABASE FUEL</small><h3 id="dbfModalTitle">${esc(judul)}</h3></div>
        <button type="button" class="tombol tombol--ghost" onclick="DatabaseFuelWorkspace.tutupModal()">✕</button></header>
      <div class="dbf-modal__body">${isi}</div></section>`;
    overlay.addEventListener('click', event => { if (event.target === overlay) tutupModal(); });
    document.body.appendChild(overlay);
  }

  function badgeHtml(status) {
    const [label, warna] = statusBadge(status);
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:${warna};border:1px solid ${warna}33;background:${warna}11;">${esc(label)}</span>`;
  }

  function tabelStil(head, rows) {
    if (!rows.length) return '<div class="tabel__kosong" style="padding:16px;">Belum ada data untuk filter ini.</div>';
    return `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px;">`
      + `<thead><tr>${head.map(h => `<th style="text-align:left;padding:8px;border-bottom:2px solid #e2e8f0;color:#475569;white-space:nowrap;">${esc(h)}</th>`).join('')}</tr></thead>`
      + `<tbody>${rows.map(r => `<tr>${r.map(c => `<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function kpiHtml(items) {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;">`
      + items.map(k => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#fff;">`
        + `<div style="font-size:11px;color:#64748b;margin-bottom:4px;">${esc(k.label)}</div>`
        + `<div style="font-size:18px;font-weight:700;color:${esc(k.warna || '#0f172a')};">${k.nilai}</div>`
        + (k.sub ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${k.sub}</div>` : '')
        + `</div>`).join('') + `</div>`;
  }

  function panelSibuk(id, pesan) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="fuel-loading-state">${esc(pesan || 'Memuat…')}</div>`;
  }

  function panelGalat(id, error) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div style="padding:14px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;color:#991b1b;font-size:13px;">Gagal memuat: ${esc(error?.message || error)}</div>`;
  }

  /* ---------- bangun kerangka ---------- */

  function bangunKerangka() {
    const host = document.getElementById('databaseFuelWorkspace');
    if (!host) return;
    host.innerHTML = `
      <p style="font-size:12px;color:#64748b;">Input Fuel / <strong>Database Fuel</strong></p>
      <div class="tabel-wrap" style="padding:16px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <h3 style="margin:0;">🗄️ Database Fuel</h3>
          <span style="font-size:11px;font-weight:700;color:#15803d;border:1px solid #15803d33;background:#15803d11;border-radius:999px;padding:2px 8px;">LIVE</span>
          <span style="flex:1;"></span>
          <button class="tombol tombol--ghost" onclick="tutupDatabaseFuel()">← Kembali ke Input Fuel</button>
        </div>
        <div class="dbf-actionbar">
          <button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.bukaPenerimaan('receipt')">＋ Receipt / Kedatangan</button>
          <button class="tombol" onclick="DatabaseFuelWorkspace.bukaPenerimaan('opening_balance')">Opening Balance</button>
          <button class="tombol" onclick="DatabaseFuelWorkspace.bukaTransfer()">⇄ Transfer Stok</button>
          <span>Transaksi masuk dapat disimpan sebagai draf atau langsung diposting. Transfer selalu diposting atomik.</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:12px;">
          <label style="font-size:12px;">Dari<br><input id="dbfDari" type="date" class="input-filter" value="${defaultDari()}"></label>
          <label style="font-size:12px;">Sampai<br><input id="dbfSampai" type="date" class="input-filter" value="${todayStr()}"></label>
          <label style="font-size:12px;">Lokasi<br><select id="dbfLokasi" class="input-filter"><option value="">Semua</option></select></label>
          <label style="font-size:12px;">Produk<br><select id="dbfProduk" class="input-filter"><option value="">Semua</option></select></label>
          <label style="font-size:12px;">Status<br><select id="dbfStatus" class="input-filter"><option value="">Semua</option><option value="draft">Draft</option><option value="submitted">Diajukan</option><option value="adjusted">Disesuaikan</option><option value="rejected">Ditolak</option><option value="posted">Posted</option><option value="reversed">Reversed</option><option value="void">Void</option></select></label>
          <button class="tombol" onclick="DatabaseFuelWorkspace.refresh()">Tampilkan</button>
          <button class="tombol tombol--ghost" onclick="DatabaseFuelWorkspace.exportCsv(this)">📥 Export CSV</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;" id="dbfTabs">
          ${[['overview', 'Overview'], ['ledger', 'Ledger'], ['fifo', 'FIFO & Stock'], ['opname', 'Stock Opname'], ['analytics', 'Analytics'], ['mapping', 'Mapping Sumber']]
            .map(([k, l]) => `<button class="tombol tombol--ghost" data-dbf-tab="${k}" onclick="DatabaseFuelWorkspace.pindahTab('${k}')">${l}</button>`).join('')}
        </div>
        <div id="dbfPanel"></div>
        <p style="font-size:11px;color:#64748b;margin:10px 0 0;">Satuan: Liter observed • Formula <code>fuel-ledger v1</code> • ADU basis hari kalender • Alert opname &gt; ±2%</p>
      </div>`;
    document.getElementById('dbfLokasi').addEventListener('change', () => void muatTab());
    document.getElementById('dbfProduk').addEventListener('change', () => void muatTab());
  }

  function tandaiTab() {
    document.querySelectorAll('#dbfTabs [data-dbf-tab]').forEach(b => {
      const aktif = b.dataset.dbfTab === state.tab;
      b.classList.toggle('tombol--utama', aktif);
      b.classList.toggle('tombol--ghost', !aktif);
    });
  }

  /* ---------- tab: overview ---------- */

  async function muatOverview() {
    const f = bacaFilter();
    panelSibuk('dbfPanel', 'Memuat ringkasan stok…');
    try {
      const q = new URLSearchParams();
      if (f.location_id) q.set('location_id', f.location_id);
      if (f.product_id) q.set('product_id', f.product_id);
      const [ringkas, pakai, integritas] = await Promise.all([
        fwGet(`/stock-summary${q.size ? `?${q}` : ''}`),
        fwGet(`/usage-stats?dari=${f.dari}&sampai=${f.sampai}${f.location_id ? `&location_id=${f.location_id}` : ''}${f.product_id ? `&product_id=${f.product_id}` : ''}`),
        fwGet('/integrity-report?limit=5').catch(() => null),
      ]);
      const totalStok = ringkas.reduce((s, r) => s + Number(r.balance_liter || 0), 0);
      const totalNilai = ringkas.reduce((s, r) => s + Number(r.fifo_value_idr || 0), 0);
      const unknown = ringkas.reduce((s, r) => s + Number(r.unknown_cost_layers || 0), 0);
      const kpi = [
        { label: 'Total Stok', nilai: esc(fmtLiter(totalStok)) },
        { label: 'Nilai Persediaan (cost diketahui)', nilai: esc(fmtIDR(totalNilai)), sub: unknown ? `${unknown} layer cost tak diketahui (tak di-average)` : 'semua layer bercost' },
        { label: 'ADU', nilai: esc(fmtLiter(pakai.adu_liter_per_day)), sub: `basis ${esc(pakai.basis)} • ${pakai.day_count} hari` },
        { label: 'Days of Stock', nilai: pakai.days_of_stock == null ? '—' : Number(pakai.days_of_stock).toFixed(1), sub: pakai.days_of_stock == null ? 'ADU nol / tanpa lokasi' : 'closing ÷ ADU' },
        { label: 'Integritas', nilai: integritas ? (integritas.ok ? '✅ OK' : '⚠️ Temuan') : '—', warna: integritas && !integritas.ok ? '#b45309' : undefined,
          sub: integritas ? `ledger≠FIFO:${integritas.ledger_fifo.length} transfer:${integritas.transfers.length} adj:${integritas.adjustments.length}` : '' },
      ];
      document.getElementById('dbfPanel').innerHTML = kpiHtml(kpi)
        + tabelStil(['Lokasi', 'Produk', 'Saldo Buku', 'FIFO', 'Nilai (Rp)', 'Layer Open', 'Cost?'],
          ringkas.map(r => [
            esc(r.location_code || r.location_id), esc(r.product_code || '—'),
            esc(fmtLiter(r.balance_liter)), esc(fmtLiter(r.fifo_liter)), esc(fmtIDR(r.fifo_value_idr)),
            esc(r.open_layers),
            Number(r.unknown_cost_layers) ? `<span style="color:#b45309;font-weight:600;">${r.unknown_cost_layers} tak diketahui</span>` : 'lengkap',
          ]));
    } catch (error) { panelGalat('dbfPanel', error); }
  }

  /* ---------- tab: ledger ---------- */

  async function muatLedger() {
    const f = bacaFilter();
    panelSibuk('dbfPanel', 'Memuat ledger…');
    try {
      const q = new URLSearchParams({ limit: String(LEDGER_LIMIT + 1), offset: String(state.halamanLedger * LEDGER_LIMIT) });
      if (f.dari) q.set('dari', f.dari);
      if (f.sampai) q.set('sampai', f.sampai);
      if (f.location_id) q.set('location_id', f.location_id);
      if (f.product_id) q.set('product_id', f.product_id);
      if (f.status) q.set('status', f.status);
      const rows = await fwGet(`/transactions?${q}`);
      const adaLanjut = halamanAda(rows, LEDGER_LIMIT);
      const tampil = rows.slice(0, LEDGER_LIMIT);
      document.getElementById('dbfPanel').innerHTML = tabelStil(
        ['Tanggal', 'Nomor', 'Jenis', 'Status', 'Asal → Tujuan', 'Produk', 'Quantity', 'Saldo Lokasi', 'Aksi'],
        tampil.map(r => {
          let aksi = '—';
          if (r.status === 'draft') aksi = `<div class="dbf-row-actions"><button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.posting('${esc(r.id)}',this)">Posting</button><button class="tombol tombol--ghost" onclick="DatabaseFuelWorkspace.voidDraft('${esc(r.id)}',this)">Void</button></div>`;
          else if (r.status === 'posted' && r.transaction_type !== 'reversal') aksi = `<button class="tombol tombol--ghost" onclick="DatabaseFuelWorkspace.reversal('${esc(r.id)}',this)">Reversal</button>`;
          return [esc(String(r.operational_date || '').slice(0, 10)), esc(r.transaction_number), esc(r.transaction_type),
            badgeHtml(r.status), `${esc(r.source_code || '—')} → ${esc(r.destination_code || '—')}`,
            esc(r.product_code || '—'), esc(fmtLiter(r.quantity_liter)), esc(fmtLiter(r.running_balance)), aksi];
        }))
        + `<div style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:12px;color:#64748b;">
            <button class="tombol tombol--ghost" ${state.halamanLedger === 0 ? 'disabled' : ''} onclick="DatabaseFuelWorkspace.halamanLedger(-1)">← Sebelumnya</button>
            <span>Halaman ${state.halamanLedger + 1}</span>
            <button class="tombol tombol--ghost" ${adaLanjut ? '' : 'disabled'} onclick="DatabaseFuelWorkspace.halamanLedger(1)">Berikutnya →</button>
          </div>`;
    } catch (error) { panelGalat('dbfPanel', error); }
  }

  /* ---------- tab: FIFO ---------- */

  async function muatFifo() {
    const f = bacaFilter();
    panelSibuk('dbfPanel', 'Memuat layer FIFO…');
    try {
      const q = new URLSearchParams();
      if (f.location_id) q.set('location_id', f.location_id);
      if (f.product_id) q.set('product_id', f.product_id);
      const [ringkas, lapis] = await Promise.all([
        fwGet(`/stock-summary${q.size ? `?${q}` : ''}`),
        fwGet(`/fifo-layers${q.size ? `?${q}` : ''}`),
      ]);
      document.getElementById('dbfPanel').innerHTML
        = `<h4 style="margin:0 0 8px;">Ringkasan per Lokasi × Produk</h4>`
        + tabelStil(['Lokasi', 'Produk', 'Saldo Buku', 'FIFO', 'Selisih', 'Nilai (Rp)'],
          ringkas.map(r => {
            const selisih = Number(r.balance_liter || 0) - Number(r.fifo_liter || 0);
            return [esc(r.location_code || r.location_id), esc(r.product_code || '—'),
              esc(fmtLiter(r.balance_liter)), esc(fmtLiter(r.fifo_liter)),
              Math.abs(selisih) > 0.001 ? `<span style="color:#b91c1c;font-weight:700;">${esc(fmtLiter(selisih))}</span>` : esc(fmtLiter(0)),
              esc(fmtIDR(r.fifo_value_idr))];
          }))
        + `<h4 style="margin:14px 0 8px;">Layer FIFO (open)</h4>`
        + tabelStil(['Lokasi', 'Diterima', 'Awal', 'Sisa', 'Cost/L', 'Batch', 'Status'],
          lapis.slice(0, 200).map(l => [
            esc(l.location_code || l.location_id), esc(String(l.received_at || '').slice(0, 10)),
            esc(fmtLiter(l.initial_quantity)), esc(fmtLiter(l.remaining_quantity)),
            l.unit_cost == null ? '<span style="color:#b45309;">tak diketahui</span>' : esc(fmtIDR(l.unit_cost)),
            esc(l.batch_number || '—'), badgeHtml(l.status),
          ]))
        + (lapis.length > 200 ? `<p style="font-size:11px;color:#64748b;">Menampilkan 200 dari ${lapis.length} layer — persempit filter lokasi.</p>` : '');
    } catch (error) { panelGalat('dbfPanel', error); }
  }

  /* ---------- tab: opname ---------- */

  function formOpnameHtml() {
    return `<h4 style="margin:0 0 8px;">Catat Opname Baru</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:14px;">
        <label style="font-size:12px;">Lokasi<br><select id="dbfOpLok" class="input-filter">${opsiLokasi()}</select></label>
        <label style="font-size:12px;">Produk<br><select id="dbfOpProd" class="input-filter">${opsiProduk()}</select></label>
        <label style="font-size:12px;">Tanggal<br><input id="dbfOpTgl" type="date" class="input-filter" value="${todayStr()}"></label>
        <label style="font-size:12px;">Fisik (L)<br><input id="dbfOpFisik" type="number" min="0" step="0.001" class="input-filter" style="width:130px;"></label>
        <label style="font-size:12px;">Metode<br><select id="dbfOpMet" class="input-filter"><option value="dipstick">Dipstick</option><option value="sounding">Sounding</option><option value="flow_meter">Flow meter</option><option value="lainnya">Lainnya</option></select></label>
        <label style="font-size:12px;">Bukti (URL)<br><input id="dbfOpBukti" type="url" class="input-filter" style="width:180px;" placeholder="https://…"></label>
        <label style="font-size:12px;">Catatan<br><input id="dbfOpNote" type="text" class="input-filter" style="width:180px;"></label>
        <button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.buatOpname(this)">Simpan Draf</button>
      </div>`;
  }

  async function muatOpname() {
    const f = bacaFilter();
    panelSibuk('dbfPanel', 'Memuat riwayat opname…');
    try {
      const q = new URLSearchParams({ limit: '100' });
      if (f.location_id) q.set('location_id', f.location_id);
      if (f.product_id) q.set('product_id', f.product_id);
      if (f.status) q.set('status', f.status);
      const rows = await fwGet(`/opnames?${q}`);
      const kodeLokasi = id => state.masters.locations.find(l => String(l.id) === String(id))?.location_code || String(id || '—').slice(0, 8);
      document.getElementById('dbfPanel').innerHTML = formOpnameHtml()
        + `<h4 style="margin:0 0 8px;">Riwayat</h4>`
        + tabelStil(['Tanggal', 'Lokasi', 'Buku', 'Fisik', 'Selisih', 'Var%', 'Status', 'Aksi'],
          rows.map(r => {
            const aksi = r.status === 'draft'
              ? `<button class="tombol tombol--ghost" onclick="DatabaseFuelWorkspace.submitOpname('${esc(r.id)}', this)">Ajukan</button>`
              : r.status === 'submitted'
                ? `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
                     <input data-dbf-note="${esc(r.id)}" placeholder="Alasan (wajib bila alert)" class="input-filter" style="width:160px;font-size:12px;">
                     <input data-dbf-harga="${esc(r.id)}" type="number" min="0" step="0.01" placeholder="Rp/L opsional" class="input-filter" style="width:110px;font-size:12px;">
                     <button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.setujuiOpname('${esc(r.id)}', this)">Setujui</button>
                     <button class="tombol tombol--ghost" onclick="DatabaseFuelWorkspace.tolakOpname('${esc(r.id)}', this)">Tolak</button>
                   </div>`
                : `<span style="font-size:11px;color:#64748b;">${r.adjustment_transaction_id ? `adj: ${esc(String(r.adjustment_transaction_id).slice(0, 8))}…` : '—'}</span>`;
            return [
              esc(String(r.operational_date || '').slice(0, 10)), esc(kodeLokasi(r.location_id)),
              esc(fmtLiter(r.book_quantity_snapshot)), esc(fmtLiter(r.physical_quantity)),
              esc(fmtLiter(r.variance_quantity)),
              r.variance_alert ? `<span style="color:#b91c1c;font-weight:700;">${esc(fmtPct(r.variance_percent))} ⚠</span>` : esc(fmtPct(r.variance_percent)),
              badgeHtml(r.status), aksi,
            ];
          }));
    } catch (error) { panelGalat('dbfPanel', error); }
  }

  /* ---------- tab: analytics ---------- */

  let chartArus = null;
  let chartVar = null;

  async function muatAnalytics() {
    const f = bacaFilter();
    panelSibuk('dbfPanel', 'Memuat analitik…');
    try {
      const q = new URLSearchParams({ dari: f.dari, sampai: f.sampai });
      if (f.location_id) q.set('location_id', f.location_id);
      if (f.product_id) q.set('product_id', f.product_id);
      const [arus, pakai, opnames] = await Promise.all([
        fwGet(`/flow-series?${q}`),
        fwGet(`/usage-stats?${q}`),
        fwGet(`/opnames?${(() => { const s = new URLSearchParams({ limit: '20' }); if (f.location_id) s.set('location_id', f.location_id); if (f.product_id) s.set('product_id', f.product_id); return s; })()}`),
      ]);
      document.getElementById('dbfPanel').innerHTML = kpiHtml([
        { label: 'Total Issue', nilai: esc(fmtLiter(pakai.total_issue_liter)), sub: `${pakai.day_count} hari kalender` },
        { label: 'ADU', nilai: esc(fmtLiter(pakai.adu_liter_per_day)), sub: `formula ${esc(pakai.formula_version)}` },
        { label: 'Days of Stock', nilai: pakai.days_of_stock == null ? '—' : Number(pakai.days_of_stock).toFixed(1) },
      ])
        + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;">
             <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;"><h4 style="margin:0 0 8px;">Masuk vs Keluar (L/hari)</h4><div style="position:relative;height:260px;"><canvas id="dbfChartArus"></canvas></div></div>
             <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;"><h4 style="margin:0 0 8px;">Variance Opname (% • merah = alert)</h4><div style="position:relative;height:260px;"><canvas id="dbfChartVar"></canvas></div></div>
           </div>`;
      await gambarChart();
      async function gambarChart() {
        let lib = global.Chart || null;
        if (!lib && typeof global.OMOSLoadLibrary === 'function') {
          try { lib = await global.OMOSLoadLibrary('chart'); } catch (e) { /* offline: tampilkan pesan */ }
        }
        const c1 = document.getElementById('dbfChartArus');
        const c2 = document.getElementById('dbfChartVar');
        if (!lib || !c1 || !c2) {
          if (c1) c1.parentElement.innerHTML = '<div class="tabel__kosong">Chart.js tak tersedia (offline?) — data tabel tetap valid.</div>';
          return;
        }
        const ds = buildFlowDataset(arus);
        if (chartArus) chartArus.destroy();
        chartArus = new lib(c1, { type: 'bar',
          data: { labels: ds.labels, datasets: [
            { label: 'Masuk', data: ds.masuk, backgroundColor: '#16a34a' },
            { label: 'Keluar', data: ds.keluar, backgroundColor: '#dc2626' },
            { label: 'Issue unit', data: ds.issue, backgroundColor: '#f59e0b' },
          ] },
          options: { responsive: true, maintainAspectRatio: false } });
        const dv = buildVarianceDataset(opnames);
        if (chartVar) chartVar.destroy();
        chartVar = new lib(c2, { type: 'bar',
          data: { labels: dv.labels, datasets: [
            { label: 'Var%', data: dv.persen,
              backgroundColor: dv.alert.map(a => (a ? '#dc2626' : '#3b82f6')) },
          ] },
          options: { responsive: true, maintainAspectRatio: false } });
      }
    } catch (error) { panelGalat('dbfPanel', error); }
  }

  /* ---------- tab: mapping + master sumber ---------- */

  function namaMaster(items, id, keys) {
    const row = (items || []).find(item => String(item.id) === String(id));
    return row ? (keys.map(k => row[k]).find(Boolean) || String(id).slice(0, 8)) : (id ? String(id).slice(0, 8) : 'Semua');
  }

  async function muatMapping() {
    panelSibuk('dbfPanel', 'Memuat mapping sumber dan rekonsiliasi…');
    try {
      const [mappings, rek] = await Promise.all([fwGet('/mappings'), fwGet('/reconciliation?limit=100')]);
      const locOptions = opsi(state.masters.locations.filter(x => x.is_active !== false), 'id', x => `${x.location_code} — ${x.location_name || ''}`);
      const productOptions = opsi(state.masters.products.filter(x => x.is_active !== false), 'id', x => `${x.product_code} — ${x.product_name || ''}`);
      const eqOptions = opsi(state.masters.equipment, 'id', x => `${x.kode_alat || x.kode_unit || 'Unit'} — ${x.tipe_alat || x.kelas_alat || ''}`, 'Semua unit');
      const shiftOptions = opsi(state.masters.shifts, 'id', x => x.nama_shift || x.nama || x.kode_shift || 'Shift', 'Semua shift');
      const operatorOptions = opsi(state.masters.operators, 'id', x => `${x.nama || 'Operator'}${x.jabatan ? ` — ${x.jabatan}` : ''}`, 'Semua operator');
      document.getElementById('dbfPanel').innerHTML = `
        <div class="dbf-settings-grid">
          <section class="dbf-setting-card"><h4>Produk Fuel</h4><p>Master produk yang dicatat pada ledger.</p>
            <div class="dbf-form-grid"><label>Kode<input id="dbfProdCode" class="input-filter" placeholder="BIOSOLAR-B35"></label><label>Nama<input id="dbfProdName" class="input-filter" placeholder="Biosolar B35"></label><label>Density kg/L<input id="dbfProdDensity" type="number" min="0" step="0.001" class="input-filter"></label></div>
            <button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.simpanProduk(this)">Simpan Produk</button></section>
          <section class="dbf-setting-card"><h4>Lokasi Penyimpanan</h4><p>Depot, tangki, atau fuel truck sumber stok.</p>
            <div class="dbf-form-grid"><label>Kode<input id="dbfLocCode" class="input-filter" placeholder="FT-BEI"></label><label>Nama<input id="dbfLocName" class="input-filter" placeholder="Fuel Tank BEI"></label><label>Tipe<select id="dbfLocType" class="input-filter"><option value="tank">Tank</option><option value="depot">Depot</option><option value="fuel_truck">Fuel Truck</option></select></label><label>Kapasitas (L)<input id="dbfLocCap" type="number" min="0" step="0.001" class="input-filter"></label><label>Minimum (L)<input id="dbfLocMin" type="number" min="0" step="0.001" class="input-filter"></label></div>
            <button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.simpanLokasi(this)">Simpan Lokasi</button></section>
        </div>
        <section class="dbf-setting-card" style="margin-top:12px;"><h4>Mapping Sumber Input Fuel</h4><p>Pilih minimal satu kunci. Mapping paling spesifik digunakan; konflik pada tingkat spesifik yang sama masuk antrean rekonsiliasi.</p>
          <div class="dbf-form-grid"><label>Shift<select id="dbfMapShift" class="input-filter">${shiftOptions}</select></label><label>Kode Unit Pengguna<select id="dbfMapTruck" class="input-filter">${eqOptions}</select></label><label>Operator<select id="dbfMapOperator" class="input-filter">${operatorOptions}</select></label><label>Produk<select id="dbfMapProd" class="input-filter">${productOptions}</select></label><label>Lokasi sumber<select id="dbfMapLoc" class="input-filter">${locOptions}</select></label><label>Prioritas<input id="dbfMapPriority" type="number" class="input-filter" value="100"></label></div>
          <div class="dbf-row-actions"><button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.simpanMapping(this)">Simpan Mapping</button><button class="tombol" onclick="DatabaseFuelWorkspace.sinkronkanAntrean(this)">Terapkan ke Antrean (${rek.unlinkedLogs?.length || 0})</button></div>
        </section>
        <div class="dbf-settings-grid" style="margin-top:12px;">
          <section class="dbf-setting-card"><h4>Mapping Aktif</h4>${tabelStil(['Shift / Unit / Operator', 'Produk', 'Lokasi', 'Prioritas'], (mappings || []).filter(m => m.is_active !== false).map(m => [
            `${esc(namaMaster(state.masters.shifts,m.shift_id,['nama_shift','nama']))}<br>${esc(namaMaster(state.masters.equipment,m.truck_equipment_id,['kode_alat','kode_unit']))}<br>${esc(namaMaster(state.masters.operators,m.operator_id,['nama']))}`,
            esc(m.product_code || m.product_id), esc(m.location_code || m.location_id), esc(m.priority || 100)]))}</section>
          <section class="dbf-setting-card"><h4>Antrean Rekonsiliasi</h4>${kpiHtml([
            {label:'Belum tertaut',nilai:String(rek.unlinkedLogs?.length || 0)}, {label:'Orphan',nilai:String(rek.orphanIssues?.length || 0)}, {label:'Qty mismatch',nilai:String(rek.mismatched?.length || 0)}])}
            ${tabelStil(['Tanggal','Unit','Liter','Status mapping'], (rek.unlinkedLogs || []).slice(0,20).map(r => [esc(r.tanggal),esc(r.kode_alat || r.equipment_id),esc(fmtLiter(r.fuel_filled)),r.dapatDipetakan?'<span style="color:#15803d;font-weight:700;">Siap</span>':`<span style="color:#b45309;">${esc(r.alasanMapping || 'belum ada')}</span>`]))}</section>
        </div>`;
    } catch (error) { panelGalat('dbfPanel', error); }
  }

  /* ---------- orkestrasi ---------- */

  async function muatMaster() {
    try {
      const [lok, prod, master] = await Promise.all([
        fwGet('/locations'), fwGet('/products'),
        (async () => {
          const res = await fetch(apiUrl('/api/admin/production/master'), { headers: { ...authHeaders() } });
          if (!res.ok) throw new Error(`Master produksi gagal (${res.status})`);
          return res.json();
        })().catch(() => ({})),
      ]);
      state.masters.locations = Array.isArray(lok) ? lok : [];
      state.masters.products = Array.isArray(prod) ? prod : [];
      state.masters.equipment = Array.isArray(master.equipment) ? master.equipment : [];
      state.masters.shifts = Array.isArray(master.shifts) ? master.shifts : [];
      state.masters.operators = Array.isArray(master.operators) ? master.operators : [];
      const selLok = document.getElementById('dbfLokasi');
      const selProd = document.getElementById('dbfProduk');
      if (selLok) selLok.innerHTML = '<option value="">Semua</option>' + opsiLokasi();
      if (selProd) selProd.innerHTML = '<option value="">Semua</option>' + opsiProduk();
    } catch (error) { /* master opsional; filter tetap jalan */ }
  }

  async function muatTab() {
    tandaiTab();
    if (state.tab === 'overview') return muatOverview();
    if (state.tab === 'ledger') return muatLedger();
    if (state.tab === 'fifo') return muatFifo();
    if (state.tab === 'opname') return muatOpname();
    if (state.tab === 'analytics') return muatAnalytics();
    return muatMapping();
  }

  const workspace = {
    open() {
      if (!document.getElementById('dbfPanel')) bangunKerangka();
      if (!state.dibuka) { state.dibuka = true; void muatMaster().then(() => muatTab()); }
      else void muatTab();
    },
    refresh() { state.halamanLedger = 0; return muatTab(); },
    pindahTab(k) { state.tab = k; state.halamanLedger = 0; return muatTab(); },
    halamanLedger(d) { state.halamanLedger = Math.max(0, state.halamanLedger + d); return muatLedger(); },
    tutupModal,
    bukaPenerimaan(type) {
      const opening = type === 'opening_balance';
      bukaModal(opening ? 'Opening Balance' : 'Receipt / Kedatangan Stok', `
        <div class="dbf-notice">${opening ? 'Gunakan hanya untuk saldo awal saat go-live atau migrasi. Alasan wajib diisi.' : 'Catat fuel yang benar-benar diterima. Dokumen pemasok dan batch menjaga traceability FIFO.'}</div>
        <div class="dbf-form-grid dbf-form-grid--modal">
          <label>Tanggal operasional<input id="dbfTxDate" type="date" class="input-filter" value="${todayStr()}"></label>
          <label>Waktu transaksi<input id="dbfTxAt" type="datetime-local" class="input-filter"></label>
          <label>Lokasi tujuan<select id="dbfTxLoc" class="input-filter">${opsi(state.masters.locations.filter(x=>x.is_active!==false),'id',x=>`${x.location_code} — ${x.location_name||''}`)}</select></label>
          <label>Produk<select id="dbfTxProd" class="input-filter">${opsi(state.masters.products.filter(x=>x.is_active!==false),'id',x=>`${x.product_code} — ${x.product_name||''}`)}</select></label>
          <label>Quantity (Liter)<input id="dbfTxQty" type="number" min="0.001" step="0.001" class="input-filter"></label>
          <label>Harga per Liter (Rp)<input id="dbfTxPrice" type="number" min="0" step="0.01" class="input-filter"></label>
          <label>Nomor dokumen<input id="dbfTxDoc" class="input-filter" placeholder="DO/PO/BA"></label>
          <label>Referensi pemasok<input id="dbfTxSupplier" class="input-filter"></label>
          <label>Batch<input id="dbfTxBatch" class="input-filter"></label>
          <label class="dbf-span-2">Alasan / catatan<input id="dbfTxReason" class="input-filter" placeholder="${opening ? 'Wajib: sumber dan tanggal cut-off saldo' : 'Opsional'}"></label>
        </div>
        <footer class="dbf-modal__footer"><button class="tombol tombol--ghost" onclick="DatabaseFuelWorkspace.tutupModal()">Batal</button><button class="tombol" onclick="DatabaseFuelWorkspace.simpanPenerimaan('${type}',false,this)">Simpan Draf</button><button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.simpanPenerimaan('${type}',true,this)">Simpan & Posting</button></footer>`);
    },
    bukaTransfer() {
      bukaModal('Transfer Stok Antar Lokasi', `<div class="dbf-notice">Transfer menghasilkan dua kaki ledger (keluar dan masuk) dalam satu transaksi database. Keduanya berhasil bersama atau dibatalkan bersama.</div>
        <div class="dbf-form-grid dbf-form-grid--modal">
          <label>Tanggal operasional<input id="dbfTrDate" type="date" class="input-filter" value="${todayStr()}"></label>
          <label>Produk<select id="dbfTrProd" class="input-filter">${opsi(state.masters.products.filter(x=>x.is_active!==false),'id',x=>`${x.product_code} — ${x.product_name||''}`)}</select></label>
          <label>Lokasi asal<select id="dbfTrFrom" class="input-filter">${opsi(state.masters.locations.filter(x=>x.is_active!==false),'id',x=>`${x.location_code} — ${x.location_name||''}`)}</select></label>
          <label>Lokasi tujuan<select id="dbfTrTo" class="input-filter">${opsi(state.masters.locations.filter(x=>x.is_active!==false),'id',x=>`${x.location_code} — ${x.location_name||''}`)}</select></label>
          <label>Quantity (Liter)<input id="dbfTrQty" type="number" min="0.001" step="0.001" class="input-filter"></label>
          <label class="dbf-span-2">Alasan / dokumen<input id="dbfTrReason" class="input-filter" placeholder="Nomor surat jalan / tujuan transfer"></label>
        </div><footer class="dbf-modal__footer"><button class="tombol tombol--ghost" onclick="DatabaseFuelWorkspace.tutupModal()">Batal</button><button class="tombol tombol--utama" onclick="DatabaseFuelWorkspace.simpanTransfer(this)">Transfer & Posting</button></footer>`);
    },
    async simpanPenerimaan(type, langsungPosting, button) {
      const v = id => document.getElementById(id)?.value || '';
      if (!v('dbfTxDate') || !v('dbfTxLoc') || !v('dbfTxProd') || !(Number(v('dbfTxQty')) > 0)) { alert('Tanggal, lokasi, produk, dan quantity wajib diisi.'); return; }
      if (type === 'opening_balance' && !v('dbfTxReason').trim()) { alert('Alasan opening balance wajib diisi.'); return; }
      await jalankanTombol(button, async () => {
        const payload = buildInboundPayload({ transaction_type:type, operational_date:v('dbfTxDate'), transaction_at:v('dbfTxAt') ? new Date(v('dbfTxAt')).toISOString() : undefined, destination_location_id:v('dbfTxLoc'), product_id:v('dbfTxProd'), quantity_liter:v('dbfTxQty'), unit_price:v('dbfTxPrice'), document_number:v('dbfTxDoc'), supplier_reference:v('dbfTxSupplier'), batch_number:v('dbfTxBatch'), reason:v('dbfTxReason'), idempotency_key:idempotencyKey(type) });
        const draft = await fwMutate('/transactions','POST',payload);
        if (langsungPosting) await fwMutate(`/transactions/${draft.id}/post`,'POST');
        tutupModal(); state.tab='ledger'; state.halamanLedger=0; await muatTab();
      }).catch(error => alert(`Gagal menyimpan: ${error.message}`));
    },
    async simpanTransfer(button) {
      const v = id => document.getElementById(id)?.value || '';
      if (!v('dbfTrDate') || !v('dbfTrFrom') || !v('dbfTrTo') || !v('dbfTrProd') || !(Number(v('dbfTrQty')) > 0)) { alert('Tanggal, asal, tujuan, produk, dan quantity wajib diisi.'); return; }
      if (v('dbfTrFrom') === v('dbfTrTo')) { alert('Lokasi asal dan tujuan harus berbeda.'); return; }
      await jalankanTombol(button, async () => {
        await fwMutate('/transfers','POST',{ operational_date:v('dbfTrDate'), from_location_id:v('dbfTrFrom'), to_location_id:v('dbfTrTo'), product_id:v('dbfTrProd'), quantity_liter:Number(v('dbfTrQty')), reason:v('dbfTrReason')||null, source_type:'manual', idempotency_key:idempotencyKey('transfer') });
        tutupModal(); state.tab='ledger'; state.halamanLedger=0; await muatTab();
      }).catch(error => alert(`Transfer gagal: ${error.message}`));
    },
    async posting(id, button) { await jalankanTombol(button, async()=>{await fwMutate(`/transactions/${id}/post`,'POST');await muatLedger();}).catch(e=>alert(`Posting gagal: ${e.message}`)); },
    async voidDraft(id, button) { if (!confirm('Void transaksi draf ini?')) return; await jalankanTombol(button,async()=>{await fwMutate(`/transactions/${id}/void`,'POST');await muatLedger();}).catch(e=>alert(`Void gagal: ${e.message}`)); },
    async reversal(id, button) { const reason=prompt('Alasan reversal (wajib):',''); if(!reason?.trim())return; await jalankanTombol(button,async()=>{await fwMutate(`/transactions/${id}/reverse`,'POST',{reason:reason.trim()});await muatLedger();}).catch(e=>alert(`Reversal gagal: ${e.message}`)); },
    async simpanProduk(button) { const v=id=>document.getElementById(id)?.value||''; await jalankanTombol(button,async()=>{await fwMutate('/products','POST',{product_code:v('dbfProdCode'),product_name:v('dbfProdName'),density_kg_l:v('dbfProdDensity')||null});await muatMaster();await muatMapping();}).catch(e=>alert(`Produk gagal disimpan: ${e.message}`)); },
    async simpanLokasi(button) { const v=id=>document.getElementById(id)?.value||''; await jalankanTombol(button,async()=>{await fwMutate('/locations','POST',{location_code:v('dbfLocCode'),location_name:v('dbfLocName'),storage_type:v('dbfLocType'),capacity_liter:v('dbfLocCap')||null,minimum_stock_liter:v('dbfLocMin')||null});await muatMaster();await muatMapping();}).catch(e=>alert(`Lokasi gagal disimpan: ${e.message}`)); },
    async simpanMapping(button) { const v=id=>document.getElementById(id)?.value||''; const payload={shift_id:v('dbfMapShift')||null,truck_equipment_id:v('dbfMapTruck')||null,operator_id:v('dbfMapOperator')||null,product_id:v('dbfMapProd'),location_id:v('dbfMapLoc'),priority:Number(v('dbfMapPriority')||100)}; if(!mappingValid(payload)){alert('Pilih minimal satu kunci serta produk dan lokasi.');return;} await jalankanTombol(button,async()=>{await fwMutate('/mappings','POST',payload);await muatMapping();}).catch(e=>alert(`Mapping gagal disimpan: ${e.message}`)); },
    async sinkronkanAntrean(button) { await jalankanTombol(button,async()=>{const h=await fwMutate('/reconciliation/sync','POST',{limit:200});alert(`Sinkronisasi selesai: ${h.created} dibuat, ${h.synced} sudah sinkron, ${h.skipped} dilewati, ${h.errors?.length||0} gagal.`);await muatMapping();}).catch(e=>alert(`Sinkronisasi gagal: ${e.message}`)); },
    async exportCsv() {
      const f = bacaFilter();
      const tipe = { overview: 'summary', ledger: 'ledger', fifo: 'summary', opname: 'opnames', analytics: 'flow' }[state.tab] || 'ledger';
      const res = await fetch(apiUrl(exportUrl(tipe, f)), { headers: { ...authHeaders() } });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `database-fuel-${tipe}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    async buatOpname(button) {
      const g = id => document.getElementById(id)?.value || '';
      const fisik = Number(g('dbfOpFisik'));
      if (!g('dbfOpLok') || !g('dbfOpProd') || !g('dbfOpTgl') || !(fisik >= 0)) {
        alert('Lokasi, produk, tanggal, dan fisik (≥ 0) wajib diisi.');
        return;
      }
      await jalankanTombol(button, async () => {
        const op = await fwMutate('/opnames', 'POST', {
          location_id: g('dbfOpLok'), product_id: g('dbfOpProd'), operational_date: g('dbfOpTgl'),
          physical_quantity: fisik, measurement_method: g('dbfOpMet') || null,
          evidence_url: g('dbfOpBukti') || null, note: g('dbfOpNote') || null,
        });
        await fwMutate(`/opnames/${op.id}/submit`, 'POST');
        await muatOpname();
      }).catch(error => alert(`Gagal mencatat opname: ${error.message}`));
    },
    async submitOpname(id, button) {
      await jalankanTombol(button, async () => {
        await fwMutate(`/opnames/${id}/submit`, 'POST');
        await muatOpname();
      }).catch(error => alert(`Gagal mengajukan: ${error.message}`));
    },
    async setujuiOpname(id, button) {
      const note = document.querySelector(`[data-dbf-note="${CSS.escape(String(id))}"]`)?.value || '';
      const hargaTxt = document.querySelector(`[data-dbf-harga="${CSS.escape(String(id))}"]`)?.value || '';
      await jalankanTombol(button, async () => {
        await fwMutate(`/opnames/${id}/approve`, 'POST', {
          note: note || undefined, unit_price: hargaTxt === '' ? undefined : Number(hargaTxt),
        });
        await muatOpname();
      }).catch(error => alert(`Gagal menyetujui: ${error.message}`));
    },
    async tolakOpname(id, button) {
      const alasan = document.querySelector(`[data-dbf-note="${CSS.escape(String(id))}"]`)?.value || '';
      if (!alasan.trim()) { alert('Alasan reject wajib diisi pada kolom catatan.'); return; }
      await jalankanTombol(button, async () => {
        await fwMutate(`/opnames/${id}/reject`, 'POST', { reason: alasan });
        await muatOpname();
      }).catch(error => alert(`Gagal menolak: ${error.message}`));
    },
  };

  return {
    pure: { fmtLiter, fmtIDR, fmtPct, statusBadge, halamanAda, buildFlowDataset, buildVarianceDataset, exportUrl, esc, buildInboundPayload, mappingValid },
    workspace,
  };
});
