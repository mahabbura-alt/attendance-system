/*
 * Database Fuel: satu workspace dengan 4 alur bisnis (Stok masuk, Alokasi & distribusi,
 * Validasi & rekonsiliasi, Tren konsumsi) + Ringkasan dan Pengaturan.
 * Menggantikan Fuel Operations Hub dan tampilan klasik (fallback ?classic=1 selama 1 rilis).
 * Semua angka stok/rekonsiliasi berasal dari API (formula fuel-ledger v1); browser hanya
 * memformat dan menyusun tampilan. Fungsi murni diekspor untuk regression test node.
 */
(function (global, factory) {
  const api = factory(global);
  if (global) global.FuelWorkspace = api.ui;
  if (typeof module === 'object' && module.exports) module.exports = api.pure;
})(typeof window !== 'undefined' ? window : globalThis, function createFuelWorkspace(global) {
  'use strict';

  const INV = '/api/admin/production/fuel-inventory';
  const ACC = '/api/admin/fuel-access';
  const TAB_KEY = 'omos_fuel_ws_tab';
  const ALERT_PCT = 2;

  /* ================= fungsi murni ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const nf = (max, min = 0) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: max, minimumFractionDigits: min });

  function fmtNum(v, max = 0) {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return '-';
    return nf(max).format(Number(v));
  }

  function fmtL(v, max = 0) {
    const s = fmtNum(v, max);
    return s === '-' ? s : `${s} L`;
  }

  function fmtRp(v) {
    if (v == null || !Number.isFinite(Number(v))) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return `Rp${nf(2).format(n / 1e9)} M`;
    if (Math.abs(n) >= 1e6) return `Rp${nf(1).format(n / 1e6)} jt`;
    return `Rp${nf(0).format(n)}`;
  }

  function fmtPct(v, max = 1) {
    if (v == null || !Number.isFinite(Number(v))) return '-';
    return `${nf(max).format(Number(v))}%`;
  }

  /** Selisih bertanda: minus memakai tanda minus tipografis agar mudah dibaca. */
  function fmtSigned(v, suffix = '') {
    if (v == null || !Number.isFinite(Number(v))) return '-';
    const n = Number(v);
    const s = nf(Math.abs(n) < 10 ? 1 : 0).format(Math.abs(n));
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}${s}${suffix}`;
  }

  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fmtTgl(iso, withYear = false) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '-';
    return `${Number(m[3])} ${BULAN[Number(m[2]) - 1]}${withYear ? ` ${m[1]}` : ''}`;
  }

  function fmtWaktu(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '-';
    return `${d.getDate()} ${BULAN[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function fmtPeriode(dari, sampai) {
    const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(dari || '');
    const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(sampai || '');
    if (!a || !b) return '-';
    if (a[1] === b[1] && a[2] === b[2]) return `${Number(a[3])}-${Number(b[3])} ${BULAN[Number(b[2]) - 1]} ${b[1]}`;
    return `${fmtTgl(dari, a[1] !== b[1])} - ${fmtTgl(sampai, true)}`;
  }

  /** Preset periode; basis tanggal operasional lokal. */
  function presetPeriode(key, today = new Date()) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (key === '30_hari') {
      const d = new Date(t); d.setDate(d.getDate() - 29);
      return { dari: isoDate(d), sampai: isoDate(t) };
    }
    if (key === 'bulan_lalu') {
      const awal = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const akhir = new Date(t.getFullYear(), t.getMonth(), 0);
      return { dari: isoDate(awal), sampai: isoDate(akhir) };
    }
    return { dari: isoDate(new Date(t.getFullYear(), t.getMonth(), 1)), sampai: isoDate(t) };
  }

  function jumlahHari(dari, sampai) {
    const a = Date.parse(`${dari}T00:00:00Z`);
    const b = Date.parse(`${sampai}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  /** Glosarium UI: istilah teknis backend → bahasa operasional. API tidak berubah. */
  const TIPE = {
    receipt: 'Penerimaan', opening_balance: 'Saldo awal', issue_equipment: 'Pengisian unit',
    transfer_out: 'Transfer keluar', transfer_in: 'Transfer masuk', return: 'Retur',
    loss: 'Susut / hilang', opname_adjustment_in: 'Penyesuaian opname (+)',
    opname_adjustment_out: 'Penyesuaian opname (−)', reversal: 'Pembatalan',
  };

  function tipeLabel(type) {
    return TIPE[String(type || '')] || String(type || '-');
  }

  const STATUS = {
    draft: ['Draf', 'wr'], posted: ['Posted', 'ok'], reversed: ['Dibatalkan', 'mu'], void: ['Ditolak', 'bd'],
    submitted: ['Menunggu persetujuan', 'wr'], approved: ['Disetujui', 'ok'], adjusted: ['Disesuaikan', 'ok'],
    rejected: ['Ditolak', 'bd'],
  };

  function statusInfo(status, sourceType) {
    const s = String(status || '').toLowerCase();
    if (s === 'draft' && sourceType === 'mobile_offline') return ['Menunggu validasi', 'wr'];
    return STATUS[s] || [String(status || '-'), 'mu'];
  }

  const SUMBER = { mobile_offline: ['APK', 'apk'], manual: ['Dashboard', ''], input_fuel: ['Input Fuel', ''],
    import: ['Excel', ''], integration: ['Integrasi', ''], stock_opname: ['Opname', ''], system_reversal: ['Sistem', ''] };

  function sumberInfo(sourceType) {
    return SUMBER[String(sourceType || '')] || [String(sourceType || '-'), ''];
  }

  const JENIS_LOKASI = { tank: 'Tangki', depot: 'Depot', fuel_truck: 'Fuel truck' };

  /** Status stok lokasi vs kapasitas & minimum (tampilan saja). */
  function statusStok(balance, capacity, minimum) {
    const bal = Number(balance || 0);
    const cap = Number(capacity) > 0 ? Number(capacity) : null;
    const min = Number(minimum) > 0 ? Number(minimum) : null;
    const pct = cap ? Math.max(0, Math.min(100, (bal / cap) * 100)) : null;
    const minPct = cap && min ? Math.max(0, Math.min(100, (min / cap) * 100)) : null;
    if (bal <= 0) return { pct, minPct, tone: 'bd', label: 'Kosong' };
    if (min != null && bal < min) return { pct, minPct, tone: 'wr', label: 'Di bawah minimum' };
    if (cap && bal > cap * 1.001) return { pct, minPct, tone: 'wr', label: 'Melebihi kapasitas' };
    return { pct, minPct, tone: 'ok', label: 'Aman' };
  }

  /** Gabung ringkasan stok (lokasi×produk) dengan master lokasi → satu baris per lokasi. */
  function posisiLokasi(summary, locations, productId = '') {
    const peta = new Map();
    for (const l of locations || []) {
      if (l.is_active === false) continue;
      peta.set(String(l.id), { location: l, balance: 0, value: 0, unknownCost: 0, products: [] });
    }
    for (const r of summary || []) {
      if (productId && String(r.product_id) !== String(productId)) continue;
      const key = String(r.location_id);
      if (!peta.has(key)) peta.set(key, { location: { id: r.location_id, location_code: r.location_code, location_name: r.location_name }, balance: 0, value: 0, unknownCost: 0, products: [] });
      const row = peta.get(key);
      row.balance += Number(r.balance_liter || 0);
      row.value += Number(r.fifo_value_idr || 0);
      row.unknownCost += Number(r.unknown_cost_layers || 0);
      row.products.push(r.product_code);
    }
    return [...peta.values()].map(r => ({ ...r, status: statusStok(r.balance, r.location.capacity_liter, r.location.minimum_stock_liter) }))
      .sort((a, b) => String(a.location.location_code || '').localeCompare(String(b.location.location_code || '')));
  }

  /** Antrean "Perlu tindakan" diurutkan dari dampak terbesar. */
  function antreanTindakan({ pending = [], unlinked = [], submitted = [], integrity = null, posisi = [], investigations = [], rekon = [] } = {}) {
    const items = [];
    const pendingStok = pending.filter(p => p.kind !== 'issue_short');
    const short = pending.filter(p => p.kind === 'issue_short');
    if (pendingStok.length) {
      const rc = pendingStok.filter(p => p.kind === 'receipt').length;
      items.push({ tone: 'wr', icon: 'ti-photo-check', go: 'rek', w: 90,
        title: `${pendingStok.length} transaksi APK menunggu validasi foto`,
        sub: `${rc} penerimaan, ${pendingStok.length - rc} transfer. Stok belum berubah.` });
    }
    if (short.length) items.push({ tone: 'bd', icon: 'ti-gas-station-off', go: 'rek', w: 95,
      title: `${short.length} pengisian APK tertahan stok buku kurang`, sub: 'Periksa penerimaan yang belum diposting' });
    if (unlinked.length) {
      const liter = unlinked.reduce((s, r) => s + Number(r.fuel_filled || 0), 0);
      items.push({ tone: 'bd', icon: 'ti-route-off', go: 'rek', w: 85,
        title: `${unlinked.length} pengisian unit belum ber-sumber`, sub: `Stok lokasi belum berkurang, ${fmtL(liter)}` });
    }
    for (const r of rekon) {
      const o = r.last_opname;
      if (o && o.variance_alert) items.push({ tone: 'bd', icon: 'ti-percentage', go: 'rek', w: 80,
        title: `Selisih ${r.location_code} ${fmtSigned(o.variance_percent, '%')}`, sub: `Opname ${fmtTgl(o.operational_date)} melebihi ambang ±${ALERT_PCT}%` });
    }
    if (investigations.length) items.push({ tone: 'bd', icon: 'ti-gauge', go: 'rek', w: 75,
      title: `${investigations.length} tutup shift perlu investigasi`, sub: 'Selisih totalizer di atas ambang' });
    if (submitted.length) items.push({ tone: 'wr', icon: 'ti-checklist', go: 'rek', w: 60,
      title: `${submitted.length} opname menunggu persetujuan`, sub: 'Disetujui oleh user berbeda dari pencatat' });
    if (integrity && integrity.ok === false) {
      const n = (integrity.ledger_fifo || []).length + (integrity.transfers || []).length + (integrity.adjustments || []).length;
      items.push({ tone: 'bd', icon: 'ti-alert-triangle', go: 'rek', w: 70, title: `${n} temuan integritas data`, sub: 'Buku vs lapisan biaya, transfer, atau penyesuaian' });
    }
    for (const p of posisi) {
      if (p.status.label === 'Melebihi kapasitas') {
        items.push({ tone: 'wr', icon: 'ti-database-exclamation', go: 'set', w: 55, title: `${p.location.location_code} melebihi kapasitas`,
          sub: `Saldo buku ${fmtL(p.balance)} di atas kapasitas ${fmtL(p.location.capacity_liter)}. Periksa data kapasitas atau transaksi.` });
      } else if (p.status.tone === 'wr' || p.status.tone === 'bd') {
        items.push({ tone: 'wr', icon: 'ti-arrow-down-bar', go: 'alok', w: p.status.tone === 'bd' ? 65 : 50,
          title: `${p.location.location_code} ${p.status.label.toLowerCase()}`, sub: `${fmtL(p.balance)} tersisa. Rencanakan transfer atau penerimaan.` });
      }
    }
    return items.sort((a, b) => b.w - a.w);
  }

  /** Tampilan selisih rekonsiliasi dari opname terakhir (nilai server). */
  function selisihView(row) {
    const o = row && row.last_opname;
    if (!o) return { tone: 'wr', label: 'Belum opname', physical: null };
    const tone = o.variance_alert ? 'bd' : 'ok';
    const pct = o.variance_percent == null ? '' : ` · ${fmtSigned(o.variance_percent, '%')}`;
    return { tone, label: `${fmtSigned(o.variance_quantity, ' L')}${pct}`, physical: o.physical_quantity, date: o.operational_date };
  }

  function penyesuaianBersih(row) {
    return Number(row.adjustment_in || 0) - Number(row.adjustment_out || 0) + Number(row.other || 0);
  }

  /** Harga rata-rata tertimbang volume dari baris penerimaan ber-harga (indikator tampilan). */
  function hargaRataRata(rows) {
    let liter = 0; let nilai = 0; let tanpa = 0;
    for (const r of rows || []) {
      if (r.status !== 'posted' && r.status !== 'reversed') continue;
      if (r.unit_price == null) { tanpa += 1; continue; }
      liter += Number(r.quantity_liter || 0);
      nilai += Number(r.quantity_liter || 0) * Number(r.unit_price);
    }
    return { harga: liter > 0 ? nilai / liter : null, tanpaHarga: tanpa };
  }

  function mappingKalimat(m, masters = {}) {
    const cari = (list, id, keys) => {
      const x = (list || []).find(i => String(i.id) === String(id));
      return x ? keys.map(k => x[k]).find(Boolean) : null;
    };
    const bagian = [];
    if (m.truck_equipment_id) bagian.push(`Unit/truck ${cari(masters.equipment, m.truck_equipment_id, ['kode_alat', 'kode_unit']) || 'tidak dikenal'}`);
    if (m.operator_id) bagian.push(`operator ${cari(masters.operators, m.operator_id, ['nama']) || 'tidak dikenal'}`);
    bagian.push(m.shift_id ? `shift ${cari(masters.shifts, m.shift_id, ['nama_shift', 'nama', 'kode_shift']) || 'tidak dikenal'}` : 'semua shift');
    return bagian.join(', ');
  }

  function validasiTerima(f) {
    if (!f.operational_date) return 'Tanggal operasional wajib diisi.';
    if (!f.destination_location_id) return 'Lokasi tujuan wajib dipilih.';
    if (!f.product_id) return 'Produk wajib dipilih.';
    if (!(Number(f.quantity_liter) > 0)) return 'Jumlah liter harus lebih dari 0.';
    if (f.unit_price !== '' && f.unit_price != null && !(Number(f.unit_price) >= 0)) return 'Harga per liter tidak valid.';
    return null;
  }

  function payloadTerima(f, jenis = 'receipt') {
    return {
      transaction_type: jenis, operational_date: f.operational_date, product_id: f.product_id,
      destination_location_id: f.destination_location_id, document_number: f.document_number || null,
      supplier_reference: f.supplier_reference || null, reason: f.reason || null, source_type: 'manual',
      idempotency_key: f.idempotency_key || undefined,
      lines: [{ direction: 'in', quantity_liter: Number(f.quantity_liter),
        unit_price: f.unit_price === '' || f.unit_price == null ? null : Number(f.unit_price),
        batch_number: f.batch_number || null }],
    };
  }

  function validasiTransfer(f) {
    if (!f.operational_date) return 'Tanggal operasional wajib diisi.';
    if (!f.from_location_id || !f.to_location_id) return 'Lokasi asal dan tujuan wajib dipilih.';
    if (String(f.from_location_id) === String(f.to_location_id)) return 'Lokasi asal dan tujuan tidak boleh sama.';
    if (!f.product_id) return 'Produk wajib dipilih.';
    if (!(Number(f.quantity_liter) > 0)) return 'Jumlah liter harus lebih dari 0.';
    return null;
  }

  function validasiOpname(f) {
    if (!f.operational_date) return 'Tanggal operasional wajib diisi.';
    if (!f.location_id) return 'Lokasi wajib dipilih.';
    if (!f.product_id) return 'Produk wajib dipilih.';
    const n = Number(f.physical_quantity);
    if (f.physical_quantity === '' || !Number.isFinite(n) || n < 0) return 'Hasil ukur fisik harus angka ≥ 0 liter.';
    return null;
  }

  function batangKonsumsi(items) {
    const maks = Math.max(0, ...(items || []).map(i => Number(i.liter || 0)));
    return (items || []).map(i => ({ ...i, width: maks > 0 ? Math.max(2, (Number(i.liter || 0) / maks) * 100) : 0 }));
  }

  function newOpId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function classicRequested() {
    try {
      if (typeof location !== 'undefined' && /[?&]classic=1/.test(location.search)) return true;
    } catch (e) { /* abaikan */ }
    return false;
  }

  /* ================= browser ================= */

  const TABS = [
    { key: 'ring', label: 'Ringkasan' },
    { key: 'masuk', no: 1, label: 'Stok masuk' },
    { key: 'alok', no: 2, label: 'Alokasi & distribusi' },
    { key: 'rek', no: 3, label: 'Validasi & rekonsiliasi' },
    { key: 'tren', no: 4, label: 'Tren konsumsi' },
    { key: 'set', label: 'Pengaturan' },
  ];

  const state = {
    tab: 'ring', dari: '', sampai: '', preset: 'bulan_ini', locationId: '', productId: '',
    masters: { products: [], locations: [], equipment: [], shifts: [], operators: [] },
    mastersLoaded: false, charts: [], seq: 0, badge: 0, consumptionGroup: 'class',
  };

  function apiUrl(path) {
    if (typeof global.getProdApiUrl === 'function') return global.getProdApiUrl(path);
    return path;
  }

  function authHeaders() {
    return typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  }

  async function call(path, { method = 'GET', body } = {}) {
    const res = await fetch(apiUrl(path), {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code });
    return data;
  }

  const inv = (path, opts) => call(`${INV}${path}`, opts);

  function q(params) {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') s.set(k, v);
    return s.toString();
  }

  function filterQ(extra = {}) {
    return q({ dari: state.dari, sampai: state.sampai, location_id: state.locationId, product_id: state.productId, ...extra });
  }

  function host() { return document.getElementById('databaseFuelWorkspace'); }
  function $(sel, root) { return (root || host() || document).querySelector(sel); }
  function $$(sel, root) { return [...(root || host() || document).querySelectorAll(sel)]; }

  function namaLokasi(id) {
    const l = state.masters.locations.find(x => String(x.id) === String(id));
    return l ? l.location_code : '-';
  }

  function namaProduk(id) {
    const p = state.masters.products.find(x => String(x.id) === String(id));
    return p ? (p.product_name || p.product_code) : '-';
  }

  function badge(label, tone = 'mu') { return `<span class="fws-b fws-b--${tone}">${esc(label)}</span>`; }
  function srcTag(sourceType) {
    const [label, cls] = sumberInfo(sourceType);
    return `<span class="fws-src${cls ? ` fws-src--${cls}` : ''}">${esc(label)}</span>`;
  }
  function statusBadge(row) { const [l, t] = statusInfo(row.status, row.source_type); return badge(l, t); }

  function skeleton(rows = 4) {
    return `<div class="fws-skel" aria-busy="true">${Array.from({ length: rows }, () => '<i></i>').join('')}</div>`;
  }

  function errorBox(error, retry) {
    return `<div class="fws-error" role="alert"><i class="ti ti-alert-circle"></i><div><b>Gagal memuat data</b><span>${esc(error?.message || error)}</span></div>${retry ? '<button type="button" class="fws-btn fws-btn--sm" data-fws-retry>Coba lagi</button>' : ''}</div>`;
  }

  function empty(title, sub, action = '') {
    return `<div class="fws-empty"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}${action}</div>`;
  }

  function opsi(list, codeKey, nameKey, selected, kosong) {
    return (kosong ? `<option value="">${esc(kosong)}</option>` : '') + (list || []).map(x => `<option value="${esc(x.id)}"${String(x.id) === String(selected || '') ? ' selected' : ''}>${esc(x[codeKey] || x[nameKey] || x.id)}${x[nameKey] && x[codeKey] && x[nameKey] !== x[codeKey] ? ` · ${esc(x[nameKey])}` : ''}</option>`).join('');
  }

  function lokasiAktif() { return state.masters.locations.filter(l => l.is_active !== false); }
  function produkAktif() { return state.masters.products.filter(p => p.is_active !== false); }

  function feedback(button, task) {
    const fb = global.OMOSActionFeedback;
    if (fb && typeof fb.run === 'function' && button) return fb.run(button, task);
    return task();
  }

  /* ----- toast, alasan, drawer, modal ----- */

  let toastTimer = null;
  function toast(pesan, tone = 'ok') {
    let el = document.getElementById('fwsToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fwsToast';
      el.className = 'fws-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = pesan;
    el.dataset.tone = tone;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), tone === 'bad' ? 6000 : 3200);
  }

  function lapisan(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
    return el;
  }

  function tutupModal() {
    const el = document.getElementById('fwsModal');
    if (el) { el.innerHTML = ''; el.className = ''; }
    document.removeEventListener('keydown', escModal);
  }

  function escModal(e) { if (e.key === 'Escape') tutupModal(); }

  /** Modal generik: render(body) mengisi form, onSubmit(button, form) mengembalikan promise. */
  function modal({ crumb, title, body, submit, onSubmit, secondary, wide }) {
    const el = lapisan('fwsModal');
    el.className = 'fws-modal-bg is-show';
    el.innerHTML = `<div class="fws-modal${wide ? ' fws-modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="fwsModalTitle">
      <header><div>${crumb ? `<small>${esc(crumb)}</small>` : ''}<h2 id="fwsModalTitle">${esc(title)}</h2></div>
        <button type="button" class="fws-btn fws-btn--icon" data-close aria-label="Tutup"><i class="ti ti-x"></i></button></header>
      <form class="fws-form" novalidate>${body}<p class="fws-form__err" role="alert" hidden></p></form>
      <footer><button type="button" class="fws-btn" data-close>Batal</button><div class="fws-row">
        ${secondary ? `<button type="button" class="fws-btn" data-secondary>${esc(secondary.label)}</button>` : ''}
        <button type="button" class="fws-btn fws-btn--pri" data-submit>${esc(submit || 'Simpan')}</button></div></footer></div>`;
    const form = el.querySelector('form');
    const err = el.querySelector('.fws-form__err');
    const tampilErr = pesan => { err.textContent = pesan || ''; err.hidden = !pesan; };
    form.addEventListener('input', () => { if (!err.hidden) tampilErr(''); });
    el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', tutupModal));
    el.addEventListener('mousedown', e => { if (e.target === el) tutupModal(); });
    document.addEventListener('keydown', escModal);
    const jalankan = (button, fn) => async () => {
      tampilErr('');
      try { await fn(button, form, tampilErr); } catch (error) { tampilErr(error.message); }
    };
    el.querySelector('[data-submit]').addEventListener('click', e => void jalankan(e.currentTarget, onSubmit)());
    if (secondary) el.querySelector('[data-secondary]').addEventListener('click', e => void jalankan(e.currentTarget, secondary.onSubmit)());
    form.addEventListener('submit', e => { e.preventDefault(); el.querySelector('[data-submit]').click(); });
    setTimeout(() => form.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 30);
    return { el, form, tampilErr };
  }

  function nilaiForm(form) {
    const out = {};
    form.querySelectorAll('[name]').forEach(i => { out[i.name] = i.value; });
    return out;
  }

  /** Minta alasan (wajib) lewat modal, bukan prompt(). */
  function mintaAlasan({ title, crumb, label = 'Alasan', placeholder = '', submit = 'Simpan', optional = false }) {
    return new Promise(resolve => {
      let selesai = false;
      modal({
        crumb, title, submit,
        body: `<label class="fws-field fws-field--full"><span>${esc(label)}${optional ? '' : ' <span class="fws-req">*</span>'}</span>
          <textarea name="alasan" rows="3" placeholder="${esc(placeholder)}"></textarea><small>Tercatat di jejak audit.</small></label>`,
        onSubmit: async (button, form, tampilErr) => {
          const v = form.querySelector('[name=alasan]').value.trim();
          if (!v && !optional) { tampilErr('Alasan wajib diisi.'); return; }
          selesai = true;
          tutupModal();
          resolve(v || '');
        },
      });
      const obs = new MutationObserver(() => {
        if (!document.querySelector('#fwsModal .fws-modal')) { obs.disconnect(); if (!selesai) resolve(null); }
      });
      obs.observe(document.getElementById('fwsModal'), { childList: true });
    });
  }

  function tutupDrawer() {
    const el = document.getElementById('fwsDrawer');
    if (!el) return;
    el.classList.remove('is-show');
    document.removeEventListener('keydown', escDrawer);
    global.FuelEvidenceUi?.lepasBlob?.();
  }

  function escDrawer(e) { if (e.key === 'Escape' && !document.querySelector('#fwsModal .fws-modal')) tutupDrawer(); }

  function drawer(html) {
    const el = lapisan('fwsDrawer');
    el.className = 'fws-drawer-wrap is-show';
    el.innerHTML = `<div class="fws-drawer-bg" data-close></div><aside class="fws-drawer" aria-label="Detail transaksi">${html}</aside>`;
    el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', tutupDrawer));
    document.addEventListener('keydown', escDrawer);
    return el.querySelector('.fws-drawer');
  }

  /* ----- kerangka ----- */

  function kerangka() {
    const h = host();
    if (!h) return;
    h.innerHTML = `<div class="fws" id="fwsRoot">
      <div class="fws-head">
        <div><div class="fws-crumb">Input Fuel / Database Fuel</div><h2>Database Fuel</h2>
          <p>Stok masuk, distribusi, rekonsiliasi, dan tren konsumsi fuel dalam satu alur.</p></div>
        <div class="fws-row"><span class="fws-sync" id="fwsSync"></span>
          <button type="button" class="fws-btn" id="fwsBack"><i class="ti ti-arrow-left"></i>Kembali ke Input Fuel</button></div>
      </div>
      <div class="fws-ctx">
        <div class="fws-row fws-row--wrap">
          <label>Periode<select id="fwsPreset"><option value="bulan_ini">Bulan ini</option><option value="30_hari">30 hari terakhir</option><option value="bulan_lalu">Bulan lalu</option><option value="custom">Rentang lain</option></select></label>
          <label class="fws-custom" hidden>Dari<input type="date" id="fwsDari"></label>
          <label class="fws-custom" hidden>Sampai<input type="date" id="fwsSampai"></label>
          <label>Lokasi<select id="fwsLokasi"></select></label>
          <label>Produk<select id="fwsProduk"></select></label>
          <span class="fws-periode" id="fwsPeriode"></span>
        </div>
        <div class="fws-row">
          <div class="fws-menu"><button type="button" class="fws-btn fws-btn--pri" id="fwsCatat" aria-haspopup="true" aria-expanded="false"><i class="ti ti-plus"></i>Catat transaksi<i class="ti ti-chevron-down"></i></button>
            <div class="fws-menu__list" id="fwsCatatMenu" role="menu" hidden>
              <button type="button" role="menuitem" data-aksi="terima"><b>Terima fuel</b><small>Kedatangan dari transportir (DO)</small></button>
              <button type="button" role="menuitem" data-aksi="transfer"><b>Transfer antar-lokasi</b><small>Tangki ke fuel truck, depot ke depot</small></button>
              <button type="button" role="menuitem" data-aksi="opname"><b>Catat opname fisik</b><small>Ukur stok aktual (dipstick / sounding)</small></button>
            </div></div>
        </div>
      </div>
      <nav class="fws-tabs" role="tablist" id="fwsTabs"></nav>
      <div id="fwsView" class="fws-view"></div>
      <p class="fws-foot">Satuan liter observed. Angka stok dan rekonsiliasi dihitung server (formula fuel-ledger v1); basis tanggal operasional.
        <a href="?classic=1" id="fwsClassic">Tampilan lama</a></p>
    </div>`;
    $('#fwsBack').addEventListener('click', () => { if (typeof global.tutupDatabaseFuel === 'function') global.tutupDatabaseFuel(); });
    $('#fwsPreset').addEventListener('change', e => {
      state.preset = e.target.value;
      $$('.fws-custom').forEach(l => { l.hidden = state.preset !== 'custom'; });
      if (state.preset !== 'custom') { Object.assign(state, presetPeriode(state.preset)); muat(); }
    });
    const ubahTanggal = () => {
      const d = $('#fwsDari').value; const s = $('#fwsSampai').value;
      if (!d || !s) return;
      if (d > s) { toast('Tanggal "dari" tidak boleh setelah "sampai".', 'bad'); return; }
      state.dari = d; state.sampai = s; muat();
    };
    $('#fwsDari').addEventListener('change', ubahTanggal);
    $('#fwsSampai').addEventListener('change', ubahTanggal);
    $('#fwsLokasi').addEventListener('change', e => { state.locationId = e.target.value; muat(); });
    $('#fwsProduk').addEventListener('change', e => { state.productId = e.target.value; muat(); });
    const menu = $('#fwsCatatMenu');
    const btn = $('#fwsCatat');
    btn.addEventListener('click', () => { menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
    document.addEventListener('click', e => { if (!e.target.closest('.fws-menu')) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    $$('[data-aksi]', menu).forEach(b => b.addEventListener('click', () => { menu.hidden = true; aksi(b.dataset.aksi); }));
    $('#fwsClassic').addEventListener('click', e => { e.preventDefault(); bukaKlasik(); });
    gambarTabs();
    tandaiSync();
  }

  function gambarTabs() {
    const el = $('#fwsTabs');
    if (!el) return;
    el.innerHTML = TABS.map(t => `<button type="button" role="tab" class="fws-tab${t.key === state.tab ? ' is-on' : ''}" aria-selected="${t.key === state.tab}" data-tab="${t.key}">
      ${t.no ? `<span class="fws-tab__no">${t.no}</span>` : ''}${esc(t.label)}${t.key === 'rek' && state.badge ? ` <span class="fws-b fws-b--bd">${state.badge}</span>` : ''}</button>`).join('');
    $$('[data-tab]', el).forEach(b => b.addEventListener('click', () => pindahTab(b.dataset.tab)));
  }

  function pindahTab(tab) {
    state.tab = tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* abaikan */ }
    gambarTabs();
    muat();
  }

  function tandaiSync() {
    const el = $('#fwsSync');
    if (!el) return;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    el.className = `fws-sync${online ? '' : ' is-off'}`;
    el.innerHTML = online ? '<i class="ti ti-cloud-check"></i>Online' : '<i class="ti ti-cloud-off"></i>Offline, aksi simpan dinonaktifkan';
  }

  function isiFilter() {
    $('#fwsPreset').value = state.preset;
    $('#fwsDari').value = state.dari;
    $('#fwsSampai').value = state.sampai;
    $('#fwsLokasi').innerHTML = opsi(lokasiAktif(), 'location_code', 'location_name', state.locationId, 'Semua lokasi');
    $('#fwsProduk').innerHTML = opsi(produkAktif(), 'product_code', 'product_name', state.productId, 'Semua produk');
    $('#fwsPeriode').textContent = fmtPeriode(state.dari, state.sampai);
  }

  async function muatMaster(force = false) {
    if (state.mastersLoaded && !force) return;
    const [prod, lok, master] = await Promise.all([
      inv('/products'), inv('/locations'),
      call('/api/admin/production/master').catch(() => ({})),
    ]);
    state.masters.products = Array.isArray(prod) ? prod : [];
    state.masters.locations = Array.isArray(lok) ? lok : [];
    state.masters.equipment = Array.isArray(master.equipment) ? master.equipment : [];
    state.masters.shifts = Array.isArray(master.shifts) ? master.shifts : [];
    state.masters.operators = Array.isArray(master.operators) ? master.operators : [];
    state.mastersLoaded = true;
  }

  function hapusChart() {
    state.charts.forEach(c => { try { c.destroy(); } catch (e) { /* abaikan */ } });
    state.charts = [];
  }

  /** Muat ulang tab aktif; abaikan respons usang bila filter berubah lagi. */
  function muat() {
    const view = $('#fwsView');
    if (!view) return Promise.resolve();
    isiFilter();
    hapusChart();
    const seq = ++state.seq;
    const aktif = () => seq === state.seq;
    const loaders = { ring: muatRingkasan, masuk: muatMasuk, alok: muatAlokasi, rek: muatRekon, tren: muatTren, set: muatPengaturan };
    view.innerHTML = skeleton(6);
    return (loaders[state.tab] || muatRingkasan)(view, aktif).catch(error => {
      if (!aktif()) return;
      view.innerHTML = errorBox(error, true);
      view.querySelector('[data-fws-retry]')?.addEventListener('click', () => muat());
    });
  }

  function kpi(items) {
    return `<div class="fws-kpis">${items.map(k => `<div class="fws-kpi"><span class="fws-kpi__l"${k.tip ? ` title="${esc(k.tip)}"` : ''}>${esc(k.label)}${k.tip ? ' <i class="ti ti-info-circle"></i>' : ''}</span>
      <strong class="fws-kpi__v${k.tone ? ` is-${k.tone}` : ''}">${esc(k.value)}</strong><span class="fws-kpi__s">${esc(k.sub || '')}</span></div>`).join('')}</div>`;
  }

  function card({ title, sub, actions = '', body, cls = '' }) {
    return `<section class="fws-card ${cls}"><div class="fws-card__h"><div><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions ? `<div class="fws-row">${actions}</div>` : ''}</div>${body}</section>`;
  }

  /** Nomor dokumen tampilan: transfer menyimpan no. surat jalan di kolom alasan. */
  function dokTx(r) {
    const transfer = ['transfer_out', 'transfer_in'].includes(r.transaction_type);
    return r.document_number || (transfer ? r.reason : null) || r.transaction_number || '-';
  }

  function tabelTransaksi(rows, { kolom = ['waktu', 'jenis', 'dok', 'arah', 'liter', 'sumber', 'status'], kosong = 'Belum ada transaksi pada periode ini.' } = {}) {
    if (!rows.length) return empty(kosong, '');
    const head = { waktu: '<th>Tanggal</th>', jenis: '<th>Jenis</th>', dok: '<th>Dokumen</th>', arah: '<th>Asal / tujuan</th>',
      liter: '<th class="n">Liter</th>', harga: '<th class="n">Rp/L</th>', transportir: '<th>Transportir</th>',
      ke: '<th>Ke lokasi</th>', sumber: '<th>Sumber</th>', status: '<th>Status</th>' };
    const sel = r => ({
      waktu: `<td>${esc(fmtTgl(r.operational_date))}<small>${esc(jamCatat(r))}</small></td>`,
      jenis: `<td>${badge(tipeLabel(r.transaction_type), r.transaction_type === 'receipt' ? 'in' : 'mu')}</td>`,
      dok: `<td class="fws-code">${esc(dokTx(r))}</td>`,
      arah: `<td>${esc(r.source_code || (r.transaction_type === 'receipt' ? 'Transportir' : '-'))} <i class="ti ti-arrow-right fws-arrow"></i> ${esc(r.destination_code || r.equipment_code || '-')}</td>`,
      liter: `<td class="n">${esc(fmtNum(r.quantity_liter, 1))}</td>`,
      harga: `<td class="n">${r.unit_price == null ? badge('Belum ada', 'wr') : esc(fmtNum(r.unit_price, 0))}</td>`,
      transportir: `<td>${esc(r.supplier_reference || '-')}</td>`,
      ke: `<td>${esc(r.destination_code || '-')}</td>`,
      sumber: `<td>${srcTag(r.source_type)}</td>`,
      status: `<td>${statusBadge(r)}</td>`,
    });
    return `<div class="fws-scroll"><table class="fws-table"><thead><tr>${kolom.map(k => head[k]).join('')}</tr></thead><tbody>
      ${rows.map((r, i) => { const s = sel(r); return `<tr class="is-click" tabindex="0" data-row="${i}">${kolom.map(k => s[k]).join('')}</tr>`; }).join('')}</tbody></table></div>`;
  }

  /** Jam pencatatan; tanggal ikut ditulis bila berbeda dari tanggal operasional (entri terlambat). */
  function jamCatat(r) {
    const w = fmtWaktu(r.created_at);
    if (w === '-') return '';
    return w.startsWith(`${fmtTgl(r.operational_date)} `) ? `dicatat ${w.split(' ').pop()}` : `dicatat ${w}`;
  }

  function pasangBarisDrawer(container, rows) {
    $$('[data-row]', container).forEach(tr => {
      const buka = () => bukaDetail(rows[Number(tr.dataset.row)]);
      tr.addEventListener('click', e => { if (!e.target.closest('button,a')) buka(); });
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') buka(); });
    });
  }

  /* ----- Ringkasan ----- */

  async function muatRingkasan(view, aktif) {
    const [sum, use, pending, rek, submitted, integ, recent, rekon, inves] = await Promise.all([
      inv(`/stock-summary?${q({ location_id: state.locationId, product_id: state.productId })}`),
      inv(`/usage-stats?${filterQ()}`).catch(() => null),
      call(`${ACC}/pending-validations`).catch(() => []),
      inv('/reconciliation?limit=200').catch(() => ({ unlinkedLogs: [] })),
      inv(`/opnames?${q({ status: 'submitted', location_id: state.locationId, product_id: state.productId, limit: 100 })}`).catch(() => []),
      inv('/integrity-report?limit=20').catch(() => null),
      inv(`/transactions?${filterQ({ limit: 8 })}`).catch(() => []),
      inv(`/period-reconciliation?${filterQ()}`).catch(() => ({ rows: [] })),
      call(`${ACC}/shift-sessions?status=investigation`).catch(() => []),
    ]);
    if (!aktif()) return;
    const lokasiFilter = state.locationId ? state.masters.locations.filter(l => String(l.id) === String(state.locationId)) : state.masters.locations;
    const posisi = posisiLokasi(sum, lokasiFilter, state.productId);
    const totalStok = posisi.reduce((s, p) => s + p.balance, 0);
    const nilai = posisi.reduce((s, p) => s + p.value, 0);
    const tanpaHarga = posisi.reduce((s, p) => s + p.unknownCost, 0);
    const adu = use?.adu_liter_per_day;
    const ketahanan = adu > 0 ? totalStok / adu : null;
    const antre = antreanTindakan({ pending, unlinked: rek.unlinkedLogs || [], submitted, integrity: integ, posisi, investigations: inves, rekon: rekon.rows || [] });
    setBadge(antre.filter(a => a.go === 'rek').length);
    view.innerHTML = kpi([
      { label: 'Total stok', value: fmtL(totalStok), sub: `${posisi.length} lokasi penyimpanan` },
      { label: 'Nilai persediaan', value: fmtRp(nilai), sub: tanpaHarga ? `metode FIFO, ${tanpaHarga} batch tanpa harga` : 'metode FIFO' },
      { label: 'Rata-rata pemakaian/hari', value: fmtL(adu), sub: `${use?.day_count || jumlahHari(state.dari, state.sampai)} hari kalender`, tip: 'Total pengisian unit dibagi jumlah hari kalender periode' },
      { label: 'Ketahanan stok', value: ketahanan == null ? '-' : `${fmtNum(ketahanan, 1)} hari`, sub: ketahanan == null ? 'belum ada pemakaian' : 'stok saat ini dibagi rata-rata pemakaian', tip: 'Total stok dibagi rata-rata pemakaian per hari' },
    ])
      + `<div class="fws-grid fws-grid--split">
        ${card({ title: 'Posisi stok per lokasi', sub: 'Garis merah menandai batas minimum (reorder)', actions: '<button type="button" class="fws-btn fws-btn--sm fws-btn--ghost" data-go="alok">Detail<i class="ti ti-chevron-right"></i></button>',
          body: posisi.length ? posisi.map(p => `<div class="fws-tank"><div class="fws-tank__t"><span><b>${esc(p.location.location_code)}</b><small>${esc(JENIS_LOKASI[p.location.storage_type] || p.location.location_name || '')}</small></span>${badge(p.status.label, p.status.tone)}</div>
            <div class="fws-gauge" role="img" aria-label="${esc(`${p.location.location_code} ${p.status.pct == null ? '' : `${Math.round(p.status.pct)}% kapasitas`}`)}"><i class="is-${p.status.tone}" style="width:${p.status.pct == null ? 0 : p.status.pct}%"></i>${p.status.minPct != null ? `<em style="left:${p.status.minPct}%"></em>` : ''}</div>
            <div class="fws-tank__m"><span>${esc(fmtNum(p.balance))}${p.location.capacity_liter ? ` / ${esc(fmtNum(p.location.capacity_liter))}` : ''} L</span><span>${p.status.pct == null ? 'kapasitas belum diisi' : `${Math.round(p.status.pct)}%`}</span></div></div>`).join('')
            : empty('Belum ada lokasi penyimpanan', 'Tambahkan lokasi di tab Pengaturan.') })}
        ${card({ title: 'Perlu tindakan', sub: 'Diurutkan dari dampak terbesar', actions: antre.length ? badge(String(antre.length), 'bd') : '',
          body: antre.length ? antre.map(a => `<button type="button" class="fws-todo" data-go="${a.go}"><span class="fws-todo__ic is-${a.tone}"><i class="ti ${a.icon}"></i></span><span class="fws-todo__tx">${esc(a.title)}<small>${esc(a.sub)}</small></span><i class="ti ti-chevron-right"></i></button>`).join('')
            : empty('Semua beres', 'Tidak ada validasi, selisih, atau antrean yang menunggu.') })}
      </div>`
      + card({ title: 'Aktivitas terakhir', sub: 'Klik baris untuk detail, bukti foto, dan aksi',
        actions: '<button type="button" class="fws-btn fws-btn--sm fws-btn--ghost" data-buku>Lihat semua transaksi<i class="ti ti-chevron-right"></i></button>',
        body: tabelTransaksi(recent), cls: 'fws-mt' });
    $$('[data-go]', view).forEach(b => b.addEventListener('click', () => pindahTab(b.dataset.go)));
    view.querySelector('[data-buku]')?.addEventListener('click', bukaBukuTransaksi);
    pasangBarisDrawer(view, recent);
  }

  function setBadge(n) {
    if (state.badge === n) return;
    state.badge = n;
    gambarTabs();
  }

  /* ----- 1 Stok masuk ----- */

  async function muatMasuk(view, aktif) {
    const rows = await inv(`/transactions?${filterQ({ type: 'receipt', limit: 300 })}`);
    if (!aktif()) return;
    const sah = rows.filter(r => r.status === 'posted' || r.status === 'reversed');
    const total = sah.filter(r => r.status === 'posted').reduce((s, r) => s + Number(r.quantity_liter || 0), 0);
    const { harga, tanpaHarga } = hargaRataRata(rows.filter(r => r.status === 'posted'));
    const draf = rows.filter(r => r.status === 'draft').length;
    const dariApk = rows.filter(r => r.status === 'draft' && r.source_type === 'mobile_offline').length;
    view.innerHTML = kpi([
      { label: 'Total diterima', value: fmtL(total), sub: `${rows.filter(r => r.status === 'posted').length} dokumen posted` },
      { label: 'Harga rata-rata', value: harga == null ? '-' : `Rp${fmtNum(harga)}/L`, sub: 'tertimbang volume, hanya baris ber-harga' },
      { label: 'Penerimaan tanpa harga', value: fmtNum(tanpaHarga), sub: tanpaHarga ? 'nilai persediaan belum lengkap' : 'semua ber-harga', tone: tanpaHarga ? 'wr' : '' },
      { label: 'Menunggu validasi', value: fmtNum(draf), sub: draf ? `${dariApk} dari APK, stok belum bertambah` : 'tidak ada draf', tone: draf ? 'wr' : '' },
    ]) + card({
      title: 'Penerimaan fuel', sub: 'Fuel masuk dari transportir ke lokasi penyimpanan. Stok bertambah setelah status Posted.',
      actions: '<button type="button" class="fws-btn fws-btn--sm" data-saldo-awal>Saldo awal</button><button type="button" class="fws-btn fws-btn--sm fws-btn--pri" data-terima><i class="ti ti-plus"></i>Terima fuel</button>',
      body: tabelTransaksi(rows, { kolom: ['waktu', 'dok', 'transportir', 'ke', 'liter', 'harga', 'sumber', 'status'], kosong: 'Belum ada penerimaan pada periode ini.' }),
    });
    view.querySelector('[data-terima]').addEventListener('click', () => aksi('terima'));
    view.querySelector('[data-saldo-awal]').addEventListener('click', () => aksi('saldo_awal'));
    pasangBarisDrawer(view, rows);
  }

  /* ----- 2 Alokasi & distribusi ----- */

  async function muatAlokasi(view, aktif) {
    const [sum, transfers, mappings, rek, flow] = await Promise.all([
      inv(`/stock-summary?${q({ product_id: state.productId })}`),
      inv(`/transactions?${filterQ({ type: 'transfer_out', limit: 200 })}`),
      inv('/mappings').catch(() => []),
      inv('/reconciliation?limit=200').catch(() => ({ unlinkedLogs: [] })),
      inv(`/period-reconciliation?${filterQ()}`).catch(() => ({ rows: [], total: {} })),
    ]);
    if (!aktif()) return;
    const lokasi = state.locationId ? state.masters.locations.filter(l => String(l.id) === String(state.locationId)) : state.masters.locations;
    const posisi = posisiLokasi(sum, lokasi, state.productId);
    const tujuanTransfer = {};
    for (const r of transfers) {
      if (r.status !== 'posted') continue;
      const key = r.source_code || '-';
      tujuanTransfer[key] = (tujuanTransfer[key] || 0) + Number(r.quantity_liter || 0);
    }
    const aktifMap = (mappings || []).filter(m => m.is_active !== false);
    const unlinked = rek.unlinkedLogs || [];
    view.innerHTML = card({
      title: 'Jaringan penyimpanan dan alur distribusi',
      sub: `Dari mana fuel datang, disimpan di mana, dan disalurkan ke mana. Periode ${fmtPeriode(state.dari, state.sampai)}.`,
      body: (flow.rows || []).length ? `<div class="fws-flows">${flow.rows.map(r => `<div class="fws-flow">
          <div class="fws-node${r.receipt_in ? '' : ' is-dim'}"><b>Transportir</b><small>${esc(fmtL(r.receipt_in))} masuk</small></div><i class="ti ti-arrow-right"></i>
          <div class="fws-node is-main"><b>${esc(r.location_code)}</b><small>${esc(JENIS_LOKASI[r.storage_type] || '')}${r.transfer_in ? `, transfer masuk ${esc(fmtL(r.transfer_in))}` : ''}</small></div><i class="ti ti-arrow-right"></i>
          <div class="fws-node${r.transfer_out ? '' : ' is-dim'}"><b>Transfer keluar</b><small>${esc(fmtL(r.transfer_out))}</small></div>
          <div class="fws-node${r.issue_out ? '' : ' is-dim'}"><b>Pengisian unit</b><small>${esc(fmtL(r.issue_out))}</small></div></div>`).join('')}</div>`
        : empty('Belum ada pergerakan stok pada periode ini.', ''),
    })
      + `<div class="fws-grid fws-grid--half fws-mt">
        ${card({ title: 'Lokasi penyimpanan', sub: 'Stok saat ini per lokasi',
          body: posisi.length ? `<div class="fws-scroll"><table class="fws-table"><thead><tr><th>Lokasi</th><th>Tipe</th><th class="n">Stok</th><th class="n">Kapasitas</th><th class="n">Minimum</th><th>Status</th></tr></thead><tbody>
            ${posisi.map(p => `<tr><td><b>${esc(p.location.location_code)}</b><small>${esc(p.location.location_name || '')}</small></td><td>${esc(JENIS_LOKASI[p.location.storage_type] || '-')}</td>
              <td class="n${p.status.tone !== 'ok' ? ` is-${p.status.tone}` : ''}">${esc(fmtNum(p.balance))}</td><td class="n">${esc(fmtNum(p.location.capacity_liter))}</td><td class="n">${esc(fmtNum(p.location.minimum_stock_liter))}</td><td>${badge(p.status.label, p.status.tone)}</td></tr>`).join('')}</tbody></table></div>`
            : empty('Belum ada lokasi', 'Tambahkan di tab Pengaturan.') })}
        ${card({ title: 'Transfer antar-lokasi', sub: 'Dua sisi (keluar dan masuk) tercatat sekaligus',
          actions: '<button type="button" class="fws-btn fws-btn--sm" data-transfer><i class="ti ti-plus"></i>Transfer</button>',
          body: transfers.length ? `<div class="fws-scroll"><table class="fws-table"><thead><tr><th>Tanggal</th><th>Asal / tujuan</th><th>Dokumen</th><th class="n">Liter</th><th>Status</th></tr></thead><tbody>
            ${transfers.map((r, i) => `<tr class="is-click" tabindex="0" data-row="${i}"><td>${esc(fmtTgl(r.operational_date))}</td><td>${esc(r.source_code || '-')} <i class="ti ti-arrow-right fws-arrow"></i> ${esc(r.transfer_to_code || r.destination_code || 'lokasi tujuan')}</td>
              <td class="fws-code">${esc(dokTx(r))}</td><td class="n">${esc(fmtNum(r.quantity_liter, 1))}</td><td>${statusBadge(r)}</td></tr>`).join('')}</tbody></table></div>`
            : empty('Belum ada transfer pada periode ini.', '') })}
      </div>`
      + card({
        title: 'Aturan sumber pengisian unit',
        sub: 'Setiap pengisian di Input Fuel otomatis mengurangi stok lokasi sesuai aturan ini. Aturan paling spesifik menang; konflik pada tingkat sama masuk antrean rekonsiliasi.',
        actions: `${unlinked.length ? badge(`${unlinked.length} belum ber-sumber`, 'wr') : badge('Semua pengisian ber-sumber', 'ok')}<button type="button" class="fws-btn fws-btn--sm fws-btn--pri" data-aturan><i class="ti ti-plus"></i>Tambah aturan</button>`,
        cls: 'fws-mt',
        body: aktifMap.length ? `<div class="fws-scroll"><table class="fws-table"><thead><tr><th>Jika pengisian oleh</th><th>Maka stok diambil dari</th><th>Produk</th><th class="n">Prioritas</th><th>Status</th></tr></thead><tbody>
          ${(mappings || []).map(m => `<tr><td>${esc(mappingKalimat(m, state.masters))}</td><td><b>${esc(m.location_code || namaLokasi(m.location_id))}</b></td><td>${esc(m.product_code || namaProduk(m.product_id))}</td><td class="n">${esc(m.priority ?? 100)}</td><td>${m.is_active === false ? badge('Nonaktif', 'mu') : badge('Aktif', 'ok')}</td></tr>`).join('')}</tbody></table></div>`
          : empty('Belum ada aturan sumber', 'Tanpa aturan, pengisian unit dari Input Fuel masuk antrean "belum ber-sumber".'),
      });
    view.querySelector('[data-transfer]').addEventListener('click', () => aksi('transfer'));
    view.querySelector('[data-aturan]').addEventListener('click', formAturan);
    pasangBarisDrawer(view, transfers);
  }

  function formAturan() {
    const eq = state.masters.equipment.map(e => ({ id: e.id, kode: e.kode_alat || e.kode_unit, nama: e.tipe_alat || e.kelas_alat }));
    const sh = state.masters.shifts.map(s => ({ id: s.id, kode: s.nama_shift || s.nama || s.kode_shift }));
    const op = state.masters.operators.map(o => ({ id: o.id, kode: o.nama, nama: o.jabatan }));
    modal({
      crumb: 'Alokasi & distribusi', title: 'Tambah aturan sumber', submit: 'Simpan aturan',
      body: `<p class="fws-hint fws-field--full">Isi minimal satu kunci (unit, operator, atau shift). Stok pengisian yang cocok akan diambil dari lokasi sumber.</p>
        <label class="fws-field">Unit / fuel truck<select name="truck_equipment_id">${opsi(eq, 'kode', 'nama', '', 'Semua unit')}</select></label>
        <label class="fws-field">Operator<select name="operator_id">${opsi(op, 'kode', 'nama', '', 'Semua operator')}</select></label>
        <label class="fws-field">Shift<select name="shift_id">${opsi(sh, 'kode', null, '', 'Semua shift')}</select></label>
        <label class="fws-field">Prioritas<input name="priority" type="number" value="100" min="0" step="1"><small>Angka kecil diperiksa lebih dulu.</small></label>
        <label class="fws-field"><span>Lokasi sumber <span class="fws-req">*</span></span><select name="location_id">${opsi(lokasiAktif(), 'location_code', 'location_name', state.locationId, 'Pilih lokasi')}</select></label>
        <label class="fws-field"><span>Produk <span class="fws-req">*</span></span><select name="product_id">${opsi(produkAktif(), 'product_code', 'product_name', state.productId || produkAktif()[0]?.id, 'Pilih produk')}</select></label>`,
      onSubmit: async (button, form, tampilErr) => {
        const f = nilaiForm(form);
        if (!(f.truck_equipment_id || f.operator_id || f.shift_id)) { tampilErr('Pilih minimal satu kunci: unit, operator, atau shift.'); return; }
        if (!f.location_id || !f.product_id) { tampilErr('Lokasi sumber dan produk wajib dipilih.'); return; }
        await feedback(button, () => inv('/mappings', { method: 'POST', body: {
          truck_equipment_id: f.truck_equipment_id || null, operator_id: f.operator_id || null, shift_id: f.shift_id || null,
          location_id: f.location_id, product_id: f.product_id, priority: Number(f.priority || 100) } }));
        tutupModal();
        toast('Aturan sumber tersimpan.');
        muat();
      },
    });
  }

  /* ----- 3 Validasi & rekonsiliasi ----- */

  async function muatRekon(view, aktif) {
    const [pending, rekon, rek, submitted, integ, inves] = await Promise.all([
      call(`${ACC}/pending-validations`).catch(() => []),
      inv(`/period-reconciliation?${filterQ()}`),
      inv('/reconciliation?limit=200').catch(() => ({ unlinkedLogs: [], orphanIssues: [], mismatched: [] })),
      inv(`/opnames?${q({ status: 'submitted', location_id: state.locationId, product_id: state.productId, limit: 100 })}`).catch(() => []),
      inv('/integrity-report?limit=20').catch(() => null),
      call(`${ACC}/shift-sessions?status=investigation`).catch(() => []),
    ]);
    if (!aktif()) return;
    const rows = rekon.rows || [];
    const unlinked = rek.unlinkedLogs || [];
    const siap = unlinked.filter(r => r.dapatDipetakan).length;
    const jenisApk = { receipt: ['Penerimaan', 'in'], transfer: ['Transfer', 'mu'], issue_short: ['Pengisian, stok kurang', 'wr'] };
    const integItems = integ ? [
      ['Saldo buku sama dengan lapisan biaya', (integ.ledger_fifo || []).length],
      ['Transfer berpasangan', (integ.transfers || []).length],
      ['Penyesuaian bertaut opname', (integ.adjustments || []).length],
    ] : [];
    setBadge(antreanTindakan({ pending, unlinked, submitted, integrity: integ, investigations: inves, rekon: rows }).filter(a => a.go === 'rek').length);
    const t = rekon.total || {};
    view.innerHTML = `<div class="fws-grid fws-grid--split">
      ${card({ title: 'Perlu validasi bukti', sub: 'Penerimaan dan transfer dari APK. Stok baru berubah setelah divalidasi.',
        actions: `${pending.length ? badge(String(pending.length), 'wr') : ''}<button type="button" class="fws-btn fws-btn--sm fws-btn--ghost" data-akses>Akses Fuel<i class="ti ti-external-link"></i></button>`,
        body: pending.length ? `<div class="fws-scroll"><table class="fws-table"><thead><tr><th>Masuk</th><th>Jenis</th><th>Dokumen</th><th>Lokasi</th><th class="n">Liter</th><th>Bukti</th><th></th></tr></thead><tbody>
          ${pending.map((r, i) => { const [l, tn] = jenisApk[r.kind] || ['Transaksi', 'mu']; return `<tr><td>${esc(fmtWaktu(r.created_at))}<small>${esc(r.created_by_nama || '')}</small></td><td>${badge(l, tn)}</td>
            <td class="fws-code">${esc(dokApk(r))}</td>
            <td>${r.kind === 'transfer' ? `${esc(r.source_code)} <i class="ti ti-arrow-right fws-arrow"></i> ${esc(r.transfer_to_code || '-')}` : r.kind === 'receipt' ? esc(r.destination_code) : `${esc(r.source_code)} <i class="ti ti-arrow-right fws-arrow"></i> ${esc(r.kode_alat || 'unit')}`}</td>
            <td class="n">${esc(fmtNum(r.quantity_liter, 1))}</td><td><span class="fws-att"><i class="ti ti-paperclip"></i>${esc(r.attachment_count)}</span></td>
            <td><button type="button" class="fws-btn fws-btn--sm" data-periksa="${i}">Periksa</button></td></tr>`; }).join('')}</tbody></table></div>`
          : empty('Tidak ada transaksi APK yang menunggu.', 'Penerimaan dan transfer dari APK muncul di sini sebelum stok berubah.') })}
      ${card({ title: 'Menunggu persetujuan opname', sub: 'Disetujui oleh user berbeda dari pencatat (maker-checker)',
        actions: submitted.length ? badge(String(submitted.length), 'wr') : '',
        body: submitted.length ? submitted.map((o, i) => `<div class="fws-line"><div><b>${esc(namaLokasi(o.location_id))}</b> ${esc(fmtTgl(o.operational_date))}<small>${esc(o.measurement_method || 'metode tidak dicatat')}</small></div>
            <div class="n"><b>${esc(fmtL(o.physical_quantity))}</b><small>buku ${esc(fmtL(o.book_quantity_snapshot))}</small>${badge(fmtSigned(o.variance_percent, '%'), o.variance_alert ? 'bd' : 'ok')}</div>
            <div class="fws-row"><button type="button" class="fws-btn fws-btn--sm fws-btn--pri" data-setujui="${i}">Setujui</button><button type="button" class="fws-btn fws-btn--sm" data-tolak-op="${i}">Tolak</button></div></div>`).join('')
          : empty('Tidak ada opname yang menunggu.', '') })}
    </div>`
      + card({ title: `Rekonsiliasi stok ${fmtPeriode(state.dari, state.sampai)}`, sub: 'Membandingkan stok menurut catatan (buku) dengan hasil ukur fisik terakhir',
        actions: '<button type="button" class="fws-btn fws-btn--sm" data-export-rekon><i class="ti ti-download"></i>CSV</button><button type="button" class="fws-btn fws-btn--sm fws-btn--pri" data-opname><i class="ti ti-plus"></i>Catat opname fisik</button>',
        cls: 'fws-mt',
        body: rows.length ? `<div class="fws-scroll"><table class="fws-table fws-table--rekon"><thead><tr><th>Lokasi</th><th class="n">Saldo awal</th><th class="n">+ Masuk</th><th class="n">+ Transfer masuk</th><th class="n">− Transfer keluar</th><th class="n">− Pengisian unit</th><th class="n">± Penyesuaian</th><th class="n">= Saldo buku</th><th class="n">Fisik terakhir</th><th class="n">Selisih</th></tr></thead><tbody>
          ${rows.map(r => { const s = selisihView(r); return `<tr><td><b>${esc(r.location_code)}</b><small>${esc(r.product_code)}</small></td><td class="n">${esc(fmtNum(r.opening))}</td><td class="n">${esc(fmtNum(r.receipt_in))}</td><td class="n">${esc(fmtNum(r.transfer_in))}</td>
            <td class="n">${esc(fmtNum(r.transfer_out))}</td><td class="n">${esc(fmtNum(r.issue_out))}</td><td class="n">${esc(fmtSigned(penyesuaianBersih(r)))}</td><td class="n"><b>${esc(fmtNum(r.closing_book))}</b></td>
            <td class="n">${s.physical == null ? '-' : `${esc(fmtNum(s.physical))}<small>${esc(fmtTgl(s.date))}</small>`}</td><td class="n">${badge(s.label, s.tone)}</td></tr>`; }).join('')}</tbody>
          ${rows.length > 1 ? `<tfoot><tr><td>Total</td><td class="n">${esc(fmtNum(t.opening))}</td><td class="n">${esc(fmtNum(t.receipt_in))}</td><td class="n">${esc(fmtNum(t.transfer_in))}</td><td class="n">${esc(fmtNum(t.transfer_out))}</td><td class="n">${esc(fmtNum(t.issue_out))}</td><td class="n">${esc(fmtSigned(Number(t.adjustment_in || 0) - Number(t.adjustment_out || 0) + Number(t.other || 0)))}</td><td class="n">${esc(fmtNum(t.closing_book))}</td><td></td><td></td></tr></tfoot>` : ''}</table></div>
          <p class="fws-eq">Saldo buku = saldo awal + masuk + transfer masuk − transfer keluar − pengisian unit ± penyesuaian opname. Pembatalan sudah dinettokan ke kategori asalnya. Merah bila selisih opname melebihi ±${ALERT_PCT}%.</p>`
          : empty('Belum ada pergerakan stok pada periode ini.', 'Catat penerimaan atau saldo awal terlebih dahulu.') })
      + `<div class="fws-grid fws-grid--third fws-mt">
        ${card({ title: 'Belum ber-sumber', sub: 'Pengisian unit yang belum mengurangi stok lokasi mana pun',
          actions: unlinked.length ? badge(String(unlinked.length), 'bd') : badge('0', 'ok'),
          body: unlinked.length ? `<div class="fws-list">${unlinked.slice(0, 8).map((r, i) => `<div class="fws-line"><div>${esc(fmtTgl(r.tanggal))} <b>${esc(r.kode_alat || 'unit')}</b></div><div class="n">${esc(fmtL(r.fuel_filled, 1))}</div><div>${r.dapatDipetakan ? badge('Siap', 'ok') : `<button type="button" class="fws-btn fws-btn--sm" data-tautkan="${i}">Tautkan</button>`}</div></div>`).join('')}</div>
            ${unlinked.length > 8 ? `<p class="fws-muted">+${unlinked.length - 8} lainnya</p>` : ''}
            <div class="fws-row fws-mt-s"><button type="button" class="fws-btn fws-btn--sm fws-btn--pri" data-sync ${siap ? '' : 'disabled'}>Terapkan aturan (${siap})</button></div>`
            : empty('Semua pengisian sudah ber-sumber.', '') })}
        ${card({ title: 'Tutup shift perlu investigasi', sub: 'Selisih totalizer fuel truck di atas ambang',
          actions: inves.length ? badge(String(inves.length), 'bd') : badge('0', 'ok'),
          body: inves.length ? `<div class="fws-list">${inves.slice(0, 6).map(s => `<div class="fws-line"><div><b>${esc(s.location_code || '')}</b> ${esc(fmtTgl(s.operational_date || s.opened_at))}<small>${esc(s.close_reason || s.reason || '')}</small></div><div class="n">${badge(fmtSigned(s.variance_liter ?? s.variance, ' L'), 'bd')}</div></div>`).join('')}</div>
            <div class="fws-row fws-mt-s"><button type="button" class="fws-btn fws-btn--sm" data-akses-shift>Tinjau di Akses Fuel</button></div>`
            : empty('Tidak ada shift yang perlu diinvestigasi.', '') })}
        ${card({ title: 'Integritas sistem', sub: 'Pemeriksaan otomatis konsistensi data',
          actions: integ ? badge(integ.ok ? 'OK' : 'Temuan', integ.ok ? 'ok' : 'bd') : badge('Tidak tersedia', 'mu'),
          body: integ ? `<div class="fws-list">${integItems.map(([l, n]) => `<div class="fws-line"><div>${esc(l)}</div><div>${n ? badge(`${n} temuan`, 'bd') : badge('Cocok', 'ok')}</div></div>`).join('')}
            <div class="fws-line"><div>Jumlah liter log vs stok</div><div>${(rek.mismatched || []).length ? badge(`${rek.mismatched.length} beda`, 'bd') : badge('Cocok', 'ok')}</div></div></div>`
            : empty('Laporan integritas tidak dapat dimuat.', '') })}
      </div>`;
    view.querySelector('[data-akses]')?.addEventListener('click', () => global.FuelAccessUi?.open?.('validasi'));
    view.querySelector('[data-akses-shift]')?.addEventListener('click', () => global.FuelAccessUi?.open?.('shift'));
    $$('[data-periksa]', view).forEach(b => b.addEventListener('click', () => periksaApk(pending[Number(b.dataset.periksa)])));
    view.querySelector('[data-opname]')?.addEventListener('click', () => aksi('opname'));
    view.querySelector('[data-export-rekon]')?.addEventListener('click', e => unduhRekonCsv(e.currentTarget, rekon));
    view.querySelector('[data-sync]')?.addEventListener('click', e => {
      feedback(e.currentTarget, () => inv('/reconciliation/sync', { method: 'POST', body: { limit: 200 } }))
        .then(r => { toast(`${Number(r?.created || 0) + Number(r?.synced || 0)} pengisian ditautkan sesuai aturan${r?.errors?.length ? `, ${r.errors.length} gagal` : ''}.`, r?.errors?.length ? 'bad' : 'ok'); muat(); })
        .catch(error => toast(`Gagal menerapkan aturan: ${error.message}`, 'bad'));
    });
    $$('[data-tautkan]', view).forEach(b => b.addEventListener('click', () => tautkanManual(unlinked[Number(b.dataset.tautkan)])));
    $$('[data-setujui]', view).forEach(b => b.addEventListener('click', async () => {
      const o = submitted[Number(b.dataset.setujui)];
      let note = '';
      if (o.variance_alert) {
        note = await mintaAlasan({ crumb: 'Persetujuan opname', title: `Setujui opname ${namaLokasi(o.location_id)}`, label: `Selisih ${fmtSigned(o.variance_percent, '%')} melewati ambang. Alasan persetujuan`, submit: 'Setujui' });
        if (note == null) return;
      }
      feedback(b, () => inv(`/opnames/${o.id}/approve`, { method: 'POST', body: { note } }))
        .then(() => { toast('Opname disetujui; penyesuaian stok diposting.'); muat(); })
        .catch(error => toast(`Persetujuan gagal: ${error.message}`, 'bad'));
    }));
    $$('[data-tolak-op]', view).forEach(b => b.addEventListener('click', async () => {
      const o = submitted[Number(b.dataset.tolakOp)];
      const alasan = await mintaAlasan({ crumb: 'Persetujuan opname', title: `Tolak opname ${namaLokasi(o.location_id)}`, placeholder: 'Contoh: pengukuran perlu diulang', submit: 'Tolak opname' });
      if (!alasan) return;
      feedback(b, () => inv(`/opnames/${o.id}/reject`, { method: 'POST', body: { reason: alasan } }))
        .then(() => { toast('Opname ditolak.'); muat(); })
        .catch(error => toast(`Penolakan gagal: ${error.message}`, 'bad'));
    }));
  }

  function unduhRekonCsv(button, rekon) {
    const kolom = ['location_code', 'product_code', 'opening', 'receipt_in', 'transfer_in', 'transfer_out', 'issue_out', 'adjustment_in', 'adjustment_out', 'other', 'closing_book'];
    const sel = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const baris = (rekon.rows || []).map(r => [...kolom.map(k => r[k]), r.last_opname?.physical_quantity ?? '', r.last_opname?.operational_date ?? '', r.last_opname?.variance_quantity ?? '', r.last_opname?.variance_percent ?? ''].map(sel).join(','));
    const csv = [`# rekonsiliasi periode ${rekon.dari} s.d. ${rekon.sampai}; satuan liter; basis ${rekon.basis}; formula ${rekon.formula_version}`,
      [...kolom, 'opname_physical', 'opname_date', 'opname_variance_l', 'opname_variance_pct'].join(','), ...baris].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `rekonsiliasi-fuel-${rekon.dari}-${rekon.sampai}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function dokApk(r) {
    return r.document_number || (r.kind === 'transfer' ? r.reason : null) || r.transaction_number || '-';
  }

  function periksaApk(r) {
    if (!r) return;
    const el = drawer(`<header class="fws-drawer__h"><div><small>${esc(r.kind === 'transfer' ? 'Transfer' : r.kind === 'receipt' ? 'Penerimaan' : 'Pengisian unit')} ${srcTag('mobile_offline')}</small>
        <h2>${esc(fmtL(r.quantity_liter, 1))} ${r.kind === 'receipt' ? `ke ${esc(r.destination_code)}` : r.kind === 'transfer' ? `${esc(r.source_code)} ke ${esc(r.transfer_to_code || '-')}` : `${esc(r.source_code)} ke ${esc(r.kode_alat || 'unit')}`}</h2></div>
        <button type="button" class="fws-btn fws-btn--icon" data-close aria-label="Tutup"><i class="ti ti-x"></i></button></header>
      <div class="fws-drawer__b">
        ${(r.mobile_flags || []).length ? `<div class="fws-flag"><i class="ti ti-alert-triangle"></i><span>Ditandai APK: ${esc((r.mobile_flags || []).map(f => global.FuelAccessUi?.flagLabel?.(f) || f).join(', '))}</span></div>` : ''}
        <h4>Bukti foto</h4><div data-galeri>${skeleton(2)}</div>
        <dl class="fws-dl"><dt>Status</dt><dd>${badge('Menunggu validasi', 'wr')} stok belum berubah</dd>
          <dt>Dokumen</dt><dd class="fws-code">${esc(dokApk(r))}</dd>
          ${r.supplier_reference ? `<dt>Transportir</dt><dd>${esc(r.supplier_reference)}</dd>` : ''}
          <dt>Produk</dt><dd>${esc(r.product_code || '-')}</dd>
          <dt>Dicatat oleh</dt><dd>${esc(r.created_by_nama || '-')} ${r.device_code ? `<small>${esc(r.device_code)}</small>` : ''}</dd>
          <dt>Masuk server</dt><dd>${esc(fmtWaktu(r.created_at))}</dd></dl>
      </div>
      <footer class="fws-drawer__f">${r.kind === 'issue_short' ? '' : '<button type="button" class="fws-btn" data-tolak>Tolak</button>'}<button type="button" class="fws-btn fws-btn--pri" data-validasi>${r.kind === 'issue_short' ? 'Posting' : 'Validasi dan posting'}</button></footer>`);
    el.querySelector('[data-close]').addEventListener('click', tutupDrawer);
    const galeri = el.querySelector('[data-galeri]');
    if (global.FuelEvidenceUi?.renderGallery) global.FuelEvidenceUi.renderGallery(galeri, 'transaction', r.id).catch(error => { galeri.innerHTML = errorBox(error); });
    else galeri.innerHTML = empty('Galeri bukti belum dimuat.', '');
    el.querySelector('[data-validasi]').addEventListener('click', e => {
      const path = r.kind === 'transfer' ? `/transfers/${r.transfer_group_id}/post` : `/transactions/${r.id}/post`;
      feedback(e.currentTarget, () => inv(path, { method: 'POST' }))
        .then(() => { tutupDrawer(); toast(`${dokApk(r)} divalidasi dan diposting.`); muat(); })
        .catch(error => toast(`Validasi gagal: ${error.message}`, 'bad'));
    });
    el.querySelector('[data-tolak]')?.addEventListener('click', async e => {
      const button = e.currentTarget;
      const alasan = await mintaAlasan({ crumb: 'Validasi APK', title: 'Tolak transaksi', placeholder: 'Contoh: foto surat jalan tidak terbaca', submit: 'Tolak transaksi' });
      if (!alasan) return;
      const path = r.kind === 'transfer' ? `/transfers/${r.transfer_group_id}/void` : `/transactions/${r.id}/void`;
      feedback(button, () => inv(path, { method: 'POST', body: { reason: alasan } }))
        .then(() => { tutupDrawer(); toast('Transaksi ditolak; alasan terkirim ke APK.'); muat(); })
        .catch(error => toast(`Penolakan gagal: ${error.message}`, 'bad'));
    });
  }

  function tautkanManual(log) {
    if (!log) return;
    modal({
      crumb: 'Belum ber-sumber', title: `Tautkan pengisian ${log.kode_alat || 'unit'}`, submit: 'Tautkan',
      body: `<p class="fws-hint fws-field--full">${esc(fmtTgl(log.tanggal, true))}, ${esc(fmtL(log.fuel_filled, 1))}. ${esc(log.alasanMapping ? `Aturan: ${log.alasanMapping}.` : '')} Pilih lokasi yang benar-benar mengisi unit ini; stok lokasi tersebut akan berkurang.</p>
        <label class="fws-field"><span>Lokasi sumber <span class="fws-req">*</span></span><select name="location_id">${opsi(lokasiAktif(), 'location_code', 'location_name', '', 'Pilih lokasi')}</select></label>
        <label class="fws-field"><span>Produk <span class="fws-req">*</span></span><select name="product_id">${opsi(produkAktif(), 'product_code', 'product_name', state.productId || produkAktif()[0]?.id, 'Pilih produk')}</select></label>`,
      onSubmit: async (button, form, tampilErr) => {
        const f = nilaiForm(form);
        if (!f.location_id || !f.product_id) { tampilErr('Lokasi dan produk wajib dipilih.'); return; }
        await feedback(button, () => inv('/issues/link', { method: 'POST', body: { fuel_log_id: log.id, location_id: f.location_id, product_id: f.product_id } }));
        tutupModal();
        toast('Pengisian ditautkan; stok lokasi diperbarui.');
        muat();
      },
    });
  }

  /* ----- 4 Tren konsumsi ----- */

  async function muatTren(view, aktif) {
    const [flow, use, cons, opnames] = await Promise.all([
      inv(`/flow-series?${filterQ()}`),
      inv(`/usage-stats?${filterQ()}`).catch(() => null),
      inv(`/consumption-breakdown?${filterQ({ group: state.consumptionGroup, limit: 10 })}`).catch(() => ({ items: [], total_liter: 0 })),
      inv(`/opnames?${q({ location_id: state.locationId, product_id: state.productId, limit: 30 })}`).catch(() => []),
    ]);
    if (!aktif()) return;
    const series = Array.isArray(flow) ? flow : [];
    const puncak = series.reduce((m, r) => (Number(r.issue || 0) > Number(m?.issue || 0) ? r : m), null);
    const sumAll = await inv(`/stock-summary?${q({ location_id: state.locationId, product_id: state.productId })}`).catch(() => []);
    if (!aktif()) return;
    const stok = (sumAll || []).reduce((s, r) => s + Number(r.balance_liter || 0), 0);
    const adu = use?.adu_liter_per_day;
    const bars = batangKonsumsi(cons.items || []);
    const opSelesai = (opnames || []).filter(o => ['approved', 'adjusted'].includes(o.status));
    view.innerHTML = kpi([
      { label: 'Total pengisian unit', value: fmtL(use?.total_issue_liter), sub: `${use?.day_count || jumlahHari(state.dari, state.sampai)} hari kalender` },
      { label: 'Rata-rata pemakaian/hari', value: fmtL(adu), sub: 'basis hari kalender', tip: 'Total pengisian unit dibagi jumlah hari kalender periode' },
      { label: 'Hari tertinggi', value: puncak ? fmtL(puncak.issue) : '-', sub: puncak ? fmtTgl(puncak.tanggal, true) : 'belum ada pengisian' },
      { label: 'Ketahanan stok', value: adu > 0 ? `${fmtNum(stok / adu, 1)} hari` : '-', sub: `stok saat ini ${fmtL(stok)}` },
    ])
      + card({ title: 'Fuel masuk vs pengisian unit per hari', sub: 'Liter. Batang: penerimaan transportir. Garis: pengisian unit.',
        body: series.length ? '<div class="fws-chart"><canvas id="fwsChartFlow" aria-label="Grafik fuel masuk dan pengisian unit per hari"></canvas></div>' : empty('Belum ada pergerakan pada periode ini.', '') })
      + `<div class="fws-grid fws-grid--half fws-mt">
        ${card({ title: state.consumptionGroup === 'class' ? 'Konsumsi per kelas unit' : 'Top 10 unit', sub: `Liter netto pada periode terpilih${cons.total_liter ? `, total ${fmtL(cons.total_liter)}` : ''}`,
          actions: `<select class="fws-select-sm" data-group aria-label="Kelompokkan konsumsi"><option value="class"${state.consumptionGroup === 'class' ? ' selected' : ''}>Per kelas</option><option value="unit"${state.consumptionGroup === 'unit' ? ' selected' : ''}>Top 10 unit</option></select>`,
          body: bars.length ? `<div class="fws-bars">${bars.map(b => `<div class="fws-bar"><span title="${esc(b.label)}">${esc(b.label)}${b.unit_count > 1 ? `<small>${b.unit_count} unit</small>` : b.kelas ? `<small>${esc(b.kelas)}</small>` : ''}</span><span class="fws-bar__t"><i style="width:${b.width}%"></i></span><span class="n">${esc(fmtL(b.liter))}<small>${esc(fmtPct(b.share * 100))}</small></span></div>`).join('')}
            ${cons.others_liter > 0 ? `<div class="fws-bar is-other"><span>Lainnya</span><span></span><span class="n">${esc(fmtL(cons.others_liter))}</span></div>` : ''}</div>`
            : empty('Belum ada pengisian unit pada periode ini.', '') })}
        ${card({ title: 'Tren selisih opname', sub: `% per opname disetujui. Merah melewati ±${ALERT_PCT}%.`,
          body: opSelesai.length ? '<div class="fws-chart fws-chart--sm"><canvas id="fwsChartVar" aria-label="Grafik selisih opname"></canvas></div>' : empty('Belum ada opname yang disetujui.', '') })}
      </div>`;
    view.querySelector('[data-group]').addEventListener('change', e => { state.consumptionGroup = e.target.value; muat(); });
    if (!series.length && !opSelesai.length) return;
    let Chart = global.Chart || null;
    if (!Chart && typeof global.OMOSLoadLibrary === 'function') {
      try { Chart = await global.OMOSLoadLibrary('chart'); } catch (e) { Chart = null; }
    }
    if (!aktif()) return;
    if (!Chart) {
      $$('.fws-chart', view).forEach(c => { c.innerHTML = empty('Grafik tidak tersedia (offline).', 'Data tabel dan angka KPI tetap valid.'); });
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const aksen = css.getPropertyValue('--aksen').trim() || '#2F6F5E';
    const muted = '#5B6478';
    const grid = '#E4E1D8';
    const base = { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { boxWidth: 10, color: muted } } },
      scales: { x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true } }, y: { grid: { color: grid }, ticks: { color: muted } } } };
    const c1 = document.getElementById('fwsChartFlow');
    if (c1) state.charts.push(new Chart(c1, {
      data: { labels: series.map(r => fmtTgl(r.tanggal)), datasets: [
        { type: 'bar', label: 'Masuk dari transportir', data: series.map(r => Math.max(0, Number(r.masuk || 0) - Number(r.transfer_in || 0))), backgroundColor: 'rgba(47,111,94,.30)', borderRadius: 3, order: 2 },
        { type: 'line', label: 'Pengisian unit', data: series.map(r => Number(r.issue || 0)), borderColor: '#1f5fbf', backgroundColor: '#1f5fbf', tension: 0.3, pointRadius: 2, order: 1 },
      ] },
      options: { ...base, interaction: { mode: 'index', intersect: false },
        plugins: { ...base.plugins, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtL(c.parsed.y)}` } } },
        scales: { ...base.scales, y: { ...base.scales.y, ticks: { color: muted, callback: v => (Math.abs(v) >= 1000 ? `${fmtNum(v / 1000, 1)}k` : v) } } } },
    }));
    const c2 = document.getElementById('fwsChartVar');
    if (c2) {
      const data = opSelesai.slice(0, 20).reverse();
      state.charts.push(new Chart(c2, { type: 'bar',
        data: { labels: data.map(o => `${fmtTgl(o.operational_date)} ${namaLokasi(o.location_id)}`), datasets: [{ label: 'Selisih %',
          data: data.map(o => (o.variance_percent == null ? 0 : Number(o.variance_percent))),
          backgroundColor: data.map(o => (o.variance_alert ? '#B91C1C' : aksen)), borderRadius: 3 }] },
        options: { ...base, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtSigned(c.parsed.y, '%') } } },
          scales: { ...base.scales, y: { ...base.scales.y, ticks: { color: muted, callback: v => `${v}%` } } } } }));
    }
  }

  /* ----- Pengaturan ----- */

  async function muatPengaturan(view, aktif) {
    await muatMaster(true);
    if (!aktif()) return;
    view.innerHTML = `<div class="fws-grid fws-grid--third">
      ${card({ title: 'Produk fuel', sub: 'Jenis BBM yang dicatat', actions: '<button type="button" class="fws-btn fws-btn--sm" data-produk><i class="ti ti-plus"></i>Produk</button>',
        body: state.masters.products.length ? `<table class="fws-table"><thead><tr><th>Kode</th><th>Nama</th><th class="n">Densitas</th><th></th></tr></thead><tbody>${state.masters.products.map(p => `<tr><td class="fws-code">${esc(p.product_code)}</td><td>${esc(p.product_name || '')}</td><td class="n">${p.density_kg_l == null ? '-' : `${esc(fmtNum(p.density_kg_l, 3))} kg/L`}</td><td>${p.is_active === false ? badge('Nonaktif', 'mu') : ''}</td></tr>`).join('')}</tbody></table>`
          : empty('Belum ada produk', 'Tambahkan produk BBM pertama.') })}
      ${card({ title: 'Lokasi penyimpanan', sub: 'Tangki, depot, fuel truck', actions: '<button type="button" class="fws-btn fws-btn--sm" data-lokasi><i class="ti ti-plus"></i>Lokasi</button>',
        body: state.masters.locations.length ? `<table class="fws-table"><thead><tr><th>Kode</th><th>Tipe</th><th class="n">Kapasitas</th><th class="n">Minimum</th></tr></thead><tbody>${state.masters.locations.map(l => `<tr><td class="fws-code">${esc(l.location_code)}<small>${esc(l.location_name || '')}</small></td><td>${esc(JENIS_LOKASI[l.storage_type] || '-')}</td><td class="n">${esc(fmtL(l.capacity_liter))}</td><td class="n">${esc(fmtL(l.minimum_stock_liter))}</td></tr>`).join('')}</tbody></table>`
          : empty('Belum ada lokasi', 'Tambahkan tangki atau fuel truck pertama.') })}
      ${card({ title: 'Export data', sub: 'CSV mencantumkan filter, satuan, dan versi formula',
        body: `<div class="fws-stack">${[['ledger', 'Buku transaksi'], ['summary', 'Posisi stok'], ['flow', 'Arus harian'], ['opnames', 'Riwayat opname']].map(([k, l]) => `<button type="button" class="fws-btn" data-export="${k}"><i class="ti ti-download"></i>${esc(l)} (CSV)</button>`).join('')}</div>` })}
    </div>
    ${card({ title: 'Slot foto bukti dan akses APK', sub: 'Slot foto per jenis transaksi, akun petugas, perangkat, dan label QR dikelola di panel Akses Fuel.', cls: 'fws-mt',
      actions: '<button type="button" class="fws-btn fws-btn--sm" data-akses-set>Buka Akses Fuel<i class="ti ti-external-link"></i></button>', body: '' })}`;
    view.querySelector('[data-produk]').addEventListener('click', formProduk);
    view.querySelector('[data-lokasi]').addEventListener('click', formLokasi);
    view.querySelector('[data-akses-set]').addEventListener('click', () => global.FuelAccessUi?.open?.('pengaturan'));
    $$('[data-export]', view).forEach(b => b.addEventListener('click', () => unduhExport(b, b.dataset.export)));
  }

  function unduhExport(button, type) {
    feedback(button, async () => {
      const res = await fetch(apiUrl(`${INV}/export?${filterQ({ type })}`), { headers: { ...authHeaders() } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `database-fuel-${type}-${state.dari}-${state.sampai}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }).catch(error => toast(`Export gagal: ${error.message}`, 'bad'));
  }

  function formProduk() {
    modal({
      crumb: 'Pengaturan', title: 'Tambah produk fuel', submit: 'Simpan produk',
      body: `<label class="fws-field"><span>Kode <span class="fws-req">*</span></span><input name="product_code" placeholder="BIOSOLAR-B40" autocomplete="off"></label>
        <label class="fws-field"><span>Nama <span class="fws-req">*</span></span><input name="product_name" placeholder="Biosolar B40"></label>
        <label class="fws-field">Densitas (kg/L)<input name="density_kg_l" type="number" min="0" step="0.0001" inputmode="decimal"><small>Opsional, untuk konversi massa.</small></label>`,
      onSubmit: async (button, form, tampilErr) => {
        const f = nilaiForm(form);
        if (!f.product_code.trim() || !f.product_name.trim()) { tampilErr('Kode dan nama produk wajib diisi.'); return; }
        await feedback(button, () => inv('/products', { method: 'POST', body: { product_code: f.product_code.trim(), product_name: f.product_name.trim(), density_kg_l: f.density_kg_l === '' ? null : Number(f.density_kg_l) } }));
        tutupModal(); toast('Produk tersimpan.'); state.mastersLoaded = false; muat();
      },
    });
  }

  function formLokasi() {
    modal({
      crumb: 'Pengaturan', title: 'Tambah lokasi penyimpanan', submit: 'Simpan lokasi',
      body: `<label class="fws-field"><span>Kode <span class="fws-req">*</span></span><input name="location_code" placeholder="FT-BEI" autocomplete="off"></label>
        <label class="fws-field"><span>Nama <span class="fws-req">*</span></span><input name="location_name" placeholder="Fuel tank utama"></label>
        <label class="fws-field">Tipe<select name="storage_type"><option value="tank">Tangki</option><option value="depot">Depot</option><option value="fuel_truck">Fuel truck</option></select></label>
        <label class="fws-field">Kapasitas (L)<input name="capacity_liter" type="number" min="0" step="1" inputmode="numeric"></label>
        <label class="fws-field">Batas minimum (L)<input name="minimum_stock_liter" type="number" min="0" step="1" inputmode="numeric"><small>Di bawah angka ini ditandai perlu reorder.</small></label>`,
      onSubmit: async (button, form, tampilErr) => {
        const f = nilaiForm(form);
        if (!f.location_code.trim() || !f.location_name.trim()) { tampilErr('Kode dan nama lokasi wajib diisi.'); return; }
        await feedback(button, () => inv('/locations', { method: 'POST', body: { location_code: f.location_code.trim(), location_name: f.location_name.trim(), storage_type: f.storage_type,
          capacity_liter: f.capacity_liter === '' ? null : Number(f.capacity_liter), minimum_stock_liter: f.minimum_stock_liter === '' ? null : Number(f.minimum_stock_liter) } }));
        tutupModal(); toast('Lokasi tersimpan.'); state.mastersLoaded = false; muat();
      },
    });
  }

  /* ----- aksi catat transaksi ----- */

  function hariIni() { return isoDate(new Date()); }

  function aksi(jenis) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { toast('Sedang offline. Simpan transaksi setelah koneksi kembali.', 'bad'); return; }
    if (jenis === 'terima' || jenis === 'saldo_awal') return formTerima(jenis === 'saldo_awal' ? 'opening_balance' : 'receipt');
    if (jenis === 'transfer') return formTransfer();
    if (jenis === 'opname') return formOpname();
    return undefined;
  }

  function formTerima(jenis) {
    const opId = newOpId();
    const saldoAwal = jenis === 'opening_balance';
    const simpan = posting => async (button, form, tampilErr) => {
      const f = { ...nilaiForm(form), idempotency_key: `${opId}` };
      const salah = validasiTerima(f);
      if (salah) { tampilErr(salah); return; }
      const hasil = await feedback(button, async () => {
        const draf = await inv('/transactions', { method: 'POST', body: payloadTerima(f, jenis) });
        return posting ? inv(`/transactions/${draf.id}/post`, { method: 'POST' }) : draf;
      });
      tutupModal();
      toast(posting ? `${saldoAwal ? 'Saldo awal' : 'Penerimaan'} ${fmtL(f.quantity_liter)} ke ${namaLokasi(f.destination_location_id)} diposting.` : `Draf ${hasil.transaction_number || ''} tersimpan. Stok berubah setelah diposting.`);
      muat();
    };
    modal({
      crumb: 'Catat transaksi', title: saldoAwal ? 'Saldo awal lokasi' : 'Terima fuel dari transportir', submit: 'Simpan dan posting',
      secondary: { label: 'Simpan draf', onSubmit: simpan(false) },
      body: `<p class="fws-hint fws-field--full">${saldoAwal ? 'Hanya untuk go-live atau migrasi: stok awal lokasi sebelum transaksi pertama tercatat.' : 'Catat fuel yang benar-benar diterima. Nomor DO dan batch menjaga ketertelusuran biaya (FIFO).'}</p>
        <label class="fws-field"><span>Tanggal operasional <span class="fws-req">*</span></span><input type="date" name="operational_date" value="${esc(hariIni())}"></label>
        <label class="fws-field"><span>Lokasi tujuan <span class="fws-req">*</span></span><select name="destination_location_id">${opsi(lokasiAktif(), 'location_code', 'location_name', state.locationId, 'Pilih lokasi')}</select></label>
        <label class="fws-field"><span>Produk <span class="fws-req">*</span></span><select name="product_id">${opsi(produkAktif(), 'product_code', 'product_name', state.productId || produkAktif()[0]?.id, 'Pilih produk')}</select></label>
        <label class="fws-field"><span>Jumlah (liter) <span class="fws-req">*</span></span><input type="number" name="quantity_liter" min="0" step="0.001" inputmode="decimal"></label>
        <label class="fws-field">Harga per liter (Rp)<input type="number" name="unit_price" min="0" step="0.01" inputmode="decimal"><small>Kosongkan bila belum diketahui; nilai persediaan ditandai belum lengkap.</small></label>
        ${saldoAwal ? '<label class="fws-field">Catatan<input name="reason" placeholder="Contoh: saldo awal go-live"></label>' : `<label class="fws-field">No. DO / dokumen<input name="document_number" placeholder="DO-88214" autocomplete="off"></label>
        <label class="fws-field">Transportir<input name="supplier_reference" placeholder="Nama transportir"></label>
        <label class="fws-field">Batch<input name="batch_number" autocomplete="off"></label>`}`,
      onSubmit: simpan(true),
    });
  }

  function formTransfer() {
    const opId = newOpId();
    modal({
      crumb: 'Catat transaksi', title: 'Transfer antar-lokasi', submit: 'Simpan transfer',
      body: `<p class="fws-hint fws-field--full">Dua sisi (keluar dari asal, masuk ke tujuan) diposting sekaligus dengan biaya FIFO asal.</p>
        <label class="fws-field"><span>Tanggal operasional <span class="fws-req">*</span></span><input type="date" name="operational_date" value="${esc(hariIni())}"></label>
        <label class="fws-field"><span>Produk <span class="fws-req">*</span></span><select name="product_id">${opsi(produkAktif(), 'product_code', 'product_name', state.productId || produkAktif()[0]?.id, 'Pilih produk')}</select></label>
        <label class="fws-field"><span>Dari lokasi <span class="fws-req">*</span></span><select name="from_location_id">${opsi(lokasiAktif(), 'location_code', 'location_name', state.locationId, 'Pilih lokasi asal')}</select></label>
        <label class="fws-field"><span>Ke lokasi <span class="fws-req">*</span></span><select name="to_location_id">${opsi(lokasiAktif(), 'location_code', 'location_name', '', 'Pilih lokasi tujuan')}</select></label>
        <label class="fws-field"><span>Jumlah (liter) <span class="fws-req">*</span></span><input type="number" name="quantity_liter" min="0" step="0.001" inputmode="decimal"></label>
        <label class="fws-field">No. surat jalan / catatan<input name="reason" autocomplete="off"></label>`,
      onSubmit: async (button, form, tampilErr) => {
        const f = nilaiForm(form);
        const salah = validasiTransfer(f);
        if (salah) { tampilErr(salah); return; }
        await feedback(button, () => inv('/transfers', { method: 'POST', body: {
          from_location_id: f.from_location_id, to_location_id: f.to_location_id, product_id: f.product_id,
          quantity_liter: Number(f.quantity_liter), operational_date: f.operational_date, reason: f.reason || null, idempotency_key: opId } }));
        tutupModal();
        toast(`Transfer ${fmtL(f.quantity_liter)} ${namaLokasi(f.from_location_id)} ke ${namaLokasi(f.to_location_id)} diposting.`);
        muat();
      },
    });
  }

  function formOpname() {
    modal({
      crumb: 'Catat transaksi', title: 'Catat opname fisik', submit: 'Ajukan persetujuan',
      body: `<p class="fws-hint fws-field--full">Hasil ukur dibandingkan saldo buku saat ini. Penyesuaian stok diposting setelah disetujui user lain (maker-checker).</p>
        <label class="fws-field"><span>Tanggal operasional <span class="fws-req">*</span></span><input type="date" name="operational_date" value="${esc(hariIni())}"></label>
        <label class="fws-field"><span>Lokasi <span class="fws-req">*</span></span><select name="location_id">${opsi(lokasiAktif(), 'location_code', 'location_name', state.locationId, 'Pilih lokasi')}</select></label>
        <label class="fws-field"><span>Produk <span class="fws-req">*</span></span><select name="product_id">${opsi(produkAktif(), 'product_code', 'product_name', state.productId || produkAktif()[0]?.id, 'Pilih produk')}</select></label>
        <label class="fws-field"><span>Hasil ukur fisik (liter) <span class="fws-req">*</span></span><input type="number" name="physical_quantity" min="0" step="0.001" inputmode="decimal"></label>
        <label class="fws-field">Metode ukur<select name="measurement_method"><option value="">Pilih metode</option><option value="dipstick">Dipstick</option><option value="sounding">Sounding</option><option value="flow_meter">Flow meter</option><option value="lainnya">Lainnya</option></select></label>
        <label class="fws-field">Catatan<input name="note"></label>`,
      onSubmit: async (button, form, tampilErr) => {
        const f = nilaiForm(form);
        const salah = validasiOpname(f);
        if (salah) { tampilErr(salah); return; }
        const op = await feedback(button, async () => {
          const o = await inv('/opnames', { method: 'POST', body: { location_id: f.location_id, product_id: f.product_id, operational_date: f.operational_date,
            physical_quantity: Number(f.physical_quantity), measurement_method: f.measurement_method || null, note: f.note || null } });
          return inv(`/opnames/${o.id}/submit`, { method: 'POST' });
        });
        tutupModal();
        toast(`Opname ${namaLokasi(f.location_id)} diajukan. Selisih ${fmtSigned(op.variance_percent, '%')}; menunggu persetujuan.`);
        muat();
      },
    });
  }

  /* ----- drawer detail transaksi ----- */

  async function bukaDetail(r) {
    if (!r) return;
    const [stLabel, stTone] = statusInfo(r.status, r.source_type);
    const keluar = ['issue_equipment', 'transfer_out', 'loss', 'opname_adjustment_out'].includes(r.transaction_type);
    const tujuan = r.destination_code || r.equipment_code || '-';
    const el = drawer(`<header class="fws-drawer__h"><div><small>${esc(tipeLabel(r.transaction_type))} <span class="fws-code">${esc(r.transaction_number || '')}</span> ${srcTag(r.source_type)}</small>
        <h2>${esc(fmtL(r.quantity_liter, 1))} ${keluar ? `dari ${esc(r.source_code || '-')}${r.equipment_code ? ` ke ${esc(r.equipment_code)}` : ''}` : `ke ${esc(tujuan)}`}</h2></div>
        <button type="button" class="fws-btn fws-btn--icon" data-close aria-label="Tutup"><i class="ti ti-x"></i></button></header>
      <div class="fws-drawer__b">
        <h4>Bukti foto</h4><div data-galeri>${skeleton(2)}</div>
        <dl class="fws-dl">
          <dt>Status</dt><dd>${badge(stLabel, stTone)} ${r.status === 'draft' ? 'belum mengubah stok' : r.status === 'reversed' ? 'dinettokan oleh transaksi pembatalan' : ''}</dd>
          <dt>Tanggal operasional</dt><dd>${esc(fmtTgl(r.operational_date, true))}</dd>
          <dt>Produk</dt><dd>${esc(r.product_name || r.product_code || '-')}</dd>
          <dt>Asal / tujuan</dt><dd>${esc(r.source_code || (r.transaction_type === 'receipt' ? 'Transportir' : '-'))} <i class="ti ti-arrow-right fws-arrow"></i> ${esc(tujuan)}</dd>
          <dt>Dokumen</dt><dd class="fws-code">${esc(dokTx(r))}</dd>
          ${r.supplier_reference ? `<dt>Transportir</dt><dd>${esc(r.supplier_reference)}</dd>` : ''}
          ${r.unit_price != null ? `<dt>Harga</dt><dd>Rp${esc(fmtNum(r.unit_price, 2))} / L, total ${esc(fmtRp(Number(r.unit_price) * Number(r.quantity_liter || 0)))}</dd>` : ''}
          ${r.reason ? `<dt>Catatan</dt><dd>${esc(r.reason)}</dd>` : ''}
          ${r.void_reason ? `<dt>Alasan ditolak</dt><dd>${esc(r.void_reason)}</dd>` : ''}
          ${['posted', 'reversed'].includes(r.status) && r.running_balance != null ? `<dt>Saldo berjalan</dt><dd>${esc(fmtL(r.running_balance, 1))} <small>di lokasi buku setelah transaksi ini</small></dd>` : ''}
        </dl>
        <h4>Lapisan biaya (FIFO)</h4><div data-fifo>${skeleton(1)}</div>
        <h4>Jejak waktu</h4>
        <div class="fws-tl"><div>Dicatat<small>${esc(fmtWaktu(r.created_at))}</small></div>
          ${r.posted_at ? `<div>Diposting<small>${esc(fmtWaktu(r.posted_at))}</small></div>` : ''}
          ${r.reversed_at ? `<div>Dibatalkan<small>${esc(fmtWaktu(r.reversed_at))}</small></div>` : ''}</div>
      </div>
      <footer class="fws-drawer__f" data-aksi-drawer></footer>`);
    el.querySelector('[data-close]').addEventListener('click', tutupDrawer);
    const galeri = el.querySelector('[data-galeri]');
    if (global.FuelEvidenceUi?.renderGallery) global.FuelEvidenceUi.renderGallery(galeri, 'transaction', r.id).catch(error => { galeri.innerHTML = errorBox(error); });
    else galeri.innerHTML = empty('Galeri bukti belum dimuat.', '');
    const fifo = el.querySelector('[data-fifo]');
    inv(`/allocations?transaction_id=${encodeURIComponent(r.id)}`).then(al => {
      if (!Array.isArray(al) || !al.length) {
        fifo.innerHTML = `<p class="fws-muted">${keluar ? 'Belum ada alokasi biaya (draf atau tanpa stok).' : r.status === 'posted' ? `Membentuk lapisan biaya ${esc(fmtL(r.quantity_liter, 1))}${r.unit_price != null ? ` @ Rp${esc(fmtNum(r.unit_price, 2))}` : ' tanpa harga'}.` : 'Lapisan biaya terbentuk setelah diposting.'}</p>`;
        return;
      }
      fifo.innerHTML = `<table class="fws-table"><thead><tr><th class="n">Liter</th><th class="n">Rp/L</th><th>Batch</th></tr></thead><tbody>${al.map(a => `<tr><td class="n">${esc(fmtNum(a.allocated_quantity, 1))}</td><td class="n">${a.unit_cost_snapshot == null ? badge('Tanpa harga', 'wr') : esc(fmtNum(a.unit_cost_snapshot, 2))}</td><td class="fws-code">${esc(a.batch_number || '-')}</td></tr>`).join('')}</tbody></table>`;
    }).catch(error => { fifo.innerHTML = `<p class="fws-muted">Gagal memuat alokasi: ${esc(error.message)}</p>`; });
    gambarAksiDrawer(el.querySelector('[data-aksi-drawer]'), r);
  }

  function gambarAksiDrawer(foot, r) {
    const grup = r.transfer_group_id && ['transfer_in', 'transfer_out'].includes(r.transaction_type);
    const tombol = [];
    if (r.status === 'draft') {
      tombol.push('<button type="button" class="fws-btn" data-dr="void">Tolak / batalkan draf</button>');
      tombol.push('<button type="button" class="fws-btn fws-btn--pri" data-dr="post">Posting</button>');
    } else if (r.status === 'posted' && r.transaction_type !== 'reversal' && r.source_type !== 'system_reversal') {
      tombol.push('<button type="button" class="fws-btn fws-btn--danger" data-dr="reverse">Batalkan transaksi</button>');
    }
    if (!tombol.length) { foot.remove(); return; }
    foot.innerHTML = tombol.join('');
    foot.querySelector('[data-dr="post"]')?.addEventListener('click', e => {
      const path = grup ? `/transfers/${r.transfer_group_id}/post` : `/transactions/${r.id}/post`;
      feedback(e.currentTarget, () => inv(path, { method: 'POST' }))
        .then(() => { tutupDrawer(); toast('Transaksi diposting; stok diperbarui.'); muat(); })
        .catch(error => toast(`Posting gagal: ${error.message}`, 'bad'));
    });
    foot.querySelector('[data-dr="void"]')?.addEventListener('click', async e => {
      const button = e.currentTarget;
      const alasan = await mintaAlasan({ crumb: 'Detail transaksi', title: 'Batalkan draf', placeholder: 'Contoh: dokumen DO salah', submit: 'Batalkan draf' });
      if (!alasan) return;
      const path = grup ? `/transfers/${r.transfer_group_id}/void` : `/transactions/${r.id}/void`;
      feedback(button, () => inv(path, { method: 'POST', body: { reason: alasan } }))
        .then(() => { tutupDrawer(); toast('Draf dibatalkan.'); muat(); })
        .catch(error => toast(`Gagal: ${error.message}`, 'bad'));
    });
    foot.querySelector('[data-dr="reverse"]')?.addEventListener('click', async e => {
      const button = e.currentTarget;
      const alasan = await mintaAlasan({ crumb: 'Detail transaksi', title: grup ? 'Batalkan transfer (kedua sisi)' : 'Batalkan transaksi',
        label: 'Alasan pembatalan', placeholder: 'Contoh: salah input liter', submit: 'Batalkan transaksi' });
      if (!alasan) return;
      feedback(button, () => inv(`/transactions/${r.id}/reverse`, { method: 'POST', body: { reason: alasan } }))
        .then(() => { tutupDrawer(); toast('Transaksi dibatalkan; stok dikembalikan dengan transaksi pembatalan.'); muat(); })
        .catch(error => toast(`Pembatalan gagal: ${error.message}`, 'bad'));
    });
  }

  /* ----- buku transaksi (drawer audit) ----- */

  function bukaBukuTransaksi() {
    let halaman = 0;
    let tipe = '';
    let cari = '';
    const el = drawer(`<header class="fws-drawer__h"><div><small>${esc(fmtPeriode(state.dari, state.sampai))}</small><h2>Buku transaksi</h2></div>
        <button type="button" class="fws-btn fws-btn--icon" data-close aria-label="Tutup"><i class="ti ti-x"></i></button></header>
      <div class="fws-drawer__b"><div class="fws-row fws-row--wrap fws-mb">
        <select data-tipe aria-label="Jenis transaksi"><option value="">Semua jenis</option>${Object.entries(TIPE).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
        <input type="search" data-cari placeholder="Cari nomor atau dokumen" aria-label="Cari nomor atau dokumen"></div><div data-isi>${skeleton(6)}</div></div>`);
    el.classList.add('fws-drawer--wide');
    el.querySelector('[data-close]').addEventListener('click', tutupDrawer);
    const isi = el.querySelector('[data-isi]');
    const muatBuku = async () => {
      isi.innerHTML = skeleton(6);
      try {
        const rows = await inv(`/transactions?${filterQ({ type: tipe, search: cari, limit: 51, offset: halaman * 50 })}`);
        const tampil = rows.slice(0, 50);
        isi.innerHTML = tabelTransaksi(tampil, { kolom: ['waktu', 'jenis', 'dok', 'arah', 'liter', 'status'] })
          + `<div class="fws-pager"><button type="button" class="fws-btn fws-btn--sm" data-pg="-1" ${halaman ? '' : 'disabled'}><i class="ti ti-chevron-left"></i></button><span>Halaman ${halaman + 1}</span><button type="button" class="fws-btn fws-btn--sm" data-pg="1" ${rows.length > 50 ? '' : 'disabled'}><i class="ti ti-chevron-right"></i></button></div>`;
        $$('[data-pg]', isi).forEach(b => b.addEventListener('click', () => { halaman = Math.max(0, halaman + Number(b.dataset.pg)); void muatBuku(); }));
        pasangBarisDrawer(isi, tampil);
      } catch (error) { isi.innerHTML = errorBox(error); }
    };
    el.querySelector('[data-tipe]').addEventListener('change', e => { tipe = e.target.value; halaman = 0; void muatBuku(); });
    let t = null;
    el.querySelector('[data-cari]').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { cari = e.target.value.trim(); halaman = 0; void muatBuku(); }, 300); });
    void muatBuku();
  }

  function bukaKlasik() {
    const h = host();
    if (!h) return;
    h.innerHTML = '';
    if (global.DatabaseFuelWorkspace && typeof global.DatabaseFuelWorkspace.open === 'function') global.DatabaseFuelWorkspace.open();
  }

  /* ----- entry ----- */

  const ui = {
    available() { return !classicRequested(); },
    async open() {
      if (!state.dari) Object.assign(state, presetPeriode(state.preset));
      try { const t = localStorage.getItem(TAB_KEY); if (TABS.some(x => x.key === t)) state.tab = t; } catch (e) { /* abaikan */ }
      kerangka();
      if (!state.onlineBound) {
        state.onlineBound = true;
        global.addEventListener?.('online', tandaiSync);
        global.addEventListener?.('offline', tandaiSync);
      }
      const view = $('#fwsView');
      if (view) view.innerHTML = skeleton(6);
      try {
        await muatMaster();
      } catch (error) {
        if (view) {
          view.innerHTML = errorBox(error, true);
          view.querySelector('[data-fws-retry]')?.addEventListener('click', () => ui.open());
        }
        return;
      }
      await muat();
    },
    refresh() { return muat(); },
    tab(key) { if (TABS.some(t => t.key === key)) pindahTab(key); },
  };

  return {
    pure: {
      esc, fmtNum, fmtL, fmtRp, fmtPct, fmtSigned, fmtTgl, fmtPeriode, presetPeriode, jumlahHari,
      tipeLabel, statusInfo, sumberInfo, statusStok, posisiLokasi, antreanTindakan, selisihView,
      penyesuaianBersih, hargaRataRata, mappingKalimat, validasiTerima, payloadTerima, validasiTransfer,
      validasiOpname, batangKonsumsi, classicRequested,
    },
    ui,
  };
});
