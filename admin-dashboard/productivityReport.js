/*
 * Leader Board — Productivity Ranking, Fuel Ratio Ranking, dan Data Control.
 * Frontend hanya merender response backend; tidak menghitung KPI authoritative.
 * Fungsi murni diekspor untuk regression test node.
 */
(function (global, factory) {
  const api = factory(global);
  if (global) global.ProductivityRankingUI = api.ui;
  if (typeof module === 'object' && module.exports) module.exports = api.pure;
})(typeof window !== 'undefined' ? window : globalThis, function createProductivityRankingUI(global) {
  'use strict';

  const BASE = '/api/admin/production/productivity-report';
  const PAGE_SIZE = 50;

  /* ---------- murni ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toneClass(achievement) {
    if (achievement == null) return 'grey';
    const a = Number(achievement);
    if (!Number.isFinite(a)) return 'grey';
    if (a >= 100) return 'green';
    if (a >= 80) return 'yellow';
    return 'red';
  }

  function fmtPct(v, digits = 2) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(Number(v))}%`;
  }

  function fmtVol(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(Number(v));
  }

  function fmtHM(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(v))} HM`;
  }

  function fmtRatio(v, unit = 'L/BCM') {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(Number(v))} ${unit}`;
  }

  function buildQuery(filters = {}) {
    const q = new URLSearchParams();
    for (const k of ['tanggal_dari', 'tanggal_sampai', 'area', 'job', 'planning_type', 'material',
      'entity_type', 'control_status', 'reason_code', 'page', 'page_size', 'sort', 'dir']) {
      if (filters[k] != null && filters[k] !== '') q.set(k, filters[k]);
    }
    return q.toString();
  }

  function highlightTarget(highlight) {
    const f = (highlight && highlight.filter) || {};
    return {
      entity_type: f.entity_type || '',
      control_status: f.control_status || '',
      reason_code: f.reason_code || '',
    };
  }

  function pageCount(total, size) {
    const s = Math.max(1, Number(size) || PAGE_SIZE);
    return Math.max(1, Math.ceil(Number(total || 0) / s));
  }

  /* ---------- browser ---------- */

  const state = {
    dibuka: false, tab: 'control', metric: 'productivity', subtab: 'excavator',
    filters: null, ranking: null, control: null, controlPage: 1, sort: 'tanggal', dir: 'desc',
    drawer: null,
  };

  function todayStr() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  function monthStart() { return todayStr().slice(0, 8) + '01'; }

  function apiUrl(path) {
    if (typeof global.getProdApiUrl === 'function') return global.getProdApiUrl(path);
    throw new Error('API produksi belum tersedia.');
  }

  function authHeaders() {
    if (typeof global.getProdAuthHeaders === 'function') return global.getProdAuthHeaders();
    return {};
  }

  async function fwGet(path) {
    const res = await fetch(apiUrl(path), { headers: { ...authHeaders() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function bacaFilter() {
    const v = id => document.getElementById(id)?.value || '';
    return {
      tanggal_dari: v('prDari') || monthStart(), tanggal_sampai: v('prSampai') || todayStr(),
      area: v('prArea') || '', job: v('prJob') || '',
      planning_type: v('prTipe') || 'ob', material: v('prMaterial') || '',
      control_status: v('prStatus') || '',
    };
  }

  const TONE = {
    green: '#15803d', yellow: '#b45309', red: '#b91c1c', grey: '#64748b',
  };

  function badgeStatus(status) {
    const peta = { ready: ['Siap Ranking', '#15803d'], incomplete: ['Perlu Dilengkapi', '#b45309'], ambiguous: ['Ambigu', '#7c3aed'], excluded: ['Dikecualikan', '#64748b'] };
    const [label, warna] = peta[String(status)] || [String(status || '—'), '#475569'];
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:${warna};border:1px solid ${warna}33;background:${warna}11;">${esc(label)}</span>`;
  }

  function kartuRanking(judul, ikon, rows, unit, metric = 'productivity') {
    const isi = rows.length ? rows.map(r => {
      const tone = metric === 'fuel' ? (Number(r.actual_fuel_ratio) <= 0 ? 'grey' : 'green') : toneClass(r.achievement_percentage);
      const ratioUnit = r.unit || 'L/BCM';
      const utama = metric === 'fuel' ? fmtRatio(r.actual_fuel_ratio, ratioUnit) : fmtPct(r.achievement_percentage);
      const detail1 = metric === 'fuel'
        ? `${fmtVol(r.liters)} L / ${fmtVol(r.denominator_value)} ${r.denominator_unit || (ratioUnit === 'L/Km' ? 'Km' : 'BCM')}`
        : `${fmtVol(r.actual_productivity)} / ${fmtVol(r.weighted_plan_productivity)} ${unit}`;
      const detail2 = metric === 'fuel'
        ? `gross ${fmtVol(r.gross_bcm)} BCM · ${fmtHM(r.hm_hours)}`
        : `net ${fmtVol(r.net_productivity)} · ${fmtVol(r.gross_volume)} vol · ${fmtHM(r.hm_hours)}`;
      return `<div class="lb-rank-row">
        <div class="lb-rank-no">#${r.rank}</div>
        <div><div class="lb-rank-name">${esc(r.entity_code)}</div>`
        + (r.entity_name && r.entity_name !== r.entity_code ? ` <span style="color:#64748b;">(${esc(r.entity_name)})</span>` : '')
        + `<div class="lb-rank-context">${esc(r.job || '')}${r.material ? ' · ' + esc(r.material) : ''}${r.parent_unit_code ? ' · ' + esc(r.parent_unit_code) : ''}</div></div>
        <div class="lb-rank-value"><strong style="color:${TONE[tone]};">${esc(utama)}</strong>
        <small>${esc(detail1)}</small><small>${esc(detail2)}</small></div>
      </div>`;
    }).join('') : '<div class="lb-empty">Belum ada data lengkap. Periksa Data Control.</div>';
    return `<section class="lb-card"><div class="lb-card-head"><span class="lb-card-icon">${ikon}</span>${esc(judul)}</div>${isi}</section>`;
  }

  function highlightHtml(highlights) {
    if (!highlights || !highlights.length) return '';
    const colors = ['#059669','#2563eb','#64748b','#dc2626','#dc2626','#d97706','#7c3aed'];
    return `<div class="lb-highlights">` + highlights.slice(0, 8).map((h, i) => `
      <button type="button" data-pr-hl="${i}" aria-label="Buka Data Control: ${esc(h.label)}"
        class="lb-highlight" style="--tone:${colors[i] || '#2563eb'}">
        <span class="lb-highlight-label">${esc(h.label)}</span><span class="lb-highlight-value">${esc(h.count)}</span>
        <span class="lb-highlight-impact">${h.impact_value ? `${esc(fmtVol(h.impact_value))} ${esc(h.impact_unit || '')}` : 'Klik untuk memfilter data'}</span>
      </button>`).join('') + `</div>`;
  }

  function tabelKontrol(rows, metric = 'productivity') {
    if (!rows.length) return '<div class="lb-empty">Tidak ada baris untuk filter ini.</div>';
    const fuel = metric === 'fuel';
    const head = fuel
      ? ['Status', 'Tanggal / Shift', 'Unit / Personel', 'Area · JOB · Material', 'Fuel', 'Basis Aktual', 'HM', 'Fuel Ratio', 'Validasi']
      : ['Status', 'Tanggal / Shift', 'Unit / Personel', 'Area · JOB · Material', 'Plan', 'Produksi', 'HM', 'PDTY', 'Achievement', 'Validasi'];
    const body = rows.map(r => {
      const alasan = (r.reason_codes || []).join(', ');
      return `<tr data-pr-row="${esc(r.control_key)}" style="cursor:pointer;">
        <td>${badgeStatus(r.control_status)}</td>
        <td style="white-space:nowrap;">${esc(String(r.tanggal || '').slice(0, 10))}<br><span style="color:#64748b;font-size:11px;">${esc(r.shift || '')}</span></td>
        <td><strong>${esc(r.entity_code || '')}</strong>${r.entity_name && r.entity_name !== r.entity_code ? `<br><span style="color:#64748b;font-size:11px;">${esc(r.entity_name)}</span>` : ''}${r.parent_unit_code ? `<br><span style="color:#64748b;font-size:11px;">⤷ ${esc(r.parent_unit_code)}</span>` : ''}</td>
        <td style="font-size:12px;">${esc(r.area || '—')} · ${esc(r.job || '—')} · ${esc(r.material || '—')}</td>
        <td style="text-align:right;">${esc(fuel ? `${fmtVol(r.liters)} L` : fmtVol(r.plan_productivity))}</td>
        <td style="text-align:right;">${esc(fuel ? `${fmtVol(r.denominator_value)} ${r.denominator_unit || 'BCM'}` : fmtVol(r.gross_volume))}</td>
        <td style="text-align:right;">${esc(fmtHM(r.hm_hours))}</td>
        ${fuel ? '' : `<td style="text-align:right;font-weight:700;">${esc(fmtVol(r.actual_productivity))}</td>`}
        <td style="text-align:right;font-weight:700;color:${fuel ? TONE.green : TONE[toneClass(r.achievement_percentage)]};">${esc(fuel ? fmtRatio(r.actual_fuel_ratio, r.unit || 'L/BCM') : fmtPct(r.achievement_percentage))}</td>
        <td style="font-size:11px;color:#64748b;">${esc(alasan || '—')}</td>
      </tr>`;
    }).join('');
    return `<div class="lb-table-wrap"><table class="lb-table">
      <thead><tr>${head.map(h => `<th${h === 'PDTY' ? ' title="Productivity aktual = Produksi ÷ HM"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  function drawerHtml(r, metric = 'productivity') {
    if (!r) return '';
    const fuel = metric === 'fuel';
    const lin = r.lineage || {};
    const src = r.source_counts || {};
    const baris = (k, v) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px;"><span style="color:#64748b;">${esc(k)}</span><strong style="text-align:right;">${v}</strong></div>`;
    return `<div style="position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:60;" onclick="ProductivityRankingUI.tutupDrawer()">
      <aside role="dialog" aria-label="Detail lineage" onclick="event.stopPropagation()"
        style="position:absolute;right:0;top:0;bottom:0;width:min(480px,94vw);background:#fff;overflow-y:auto;padding:18px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <h3 style="margin:0;flex:1;">${esc(r.entity_code || '')} ${badgeStatus(r.control_status)}</h3>
          <button class="tombol tombol--ghost" onclick="ProductivityRankingUI.tutupDrawer()">Tutup</button>
        </div>
        <h4 style="margin:10px 0 4px;font-size:13px;">Konteks</h4>
        ${baris('Tanggal / Shift', esc(String(r.tanggal || '').slice(0, 10)) + ' / ' + esc(r.shift || '—'))}
        ${baris('Area · JOB · Material', esc(`${r.area || '—'} · ${r.job || '—'} · ${r.material || '—'}`))}
        ${baris('Satuan', esc(r.unit || '—'))}
        ${fuel ? `<h4 style="margin:10px 0 4px;font-size:13px;">Fuel Ratio</h4>
        ${baris('Fuel dialokasikan', esc(`${fmtVol(r.liters)} L`))}
        ${r.unit === 'L/Km'
          ? baris('Jarak aktual odometer', esc(`${fmtVol(r.distance_km)} Km`))
          : `${baris('Gross volume', esc(`${fmtVol(r.gross_bcm)} BCM`))}${baris('Net productive volume', esc(`${fmtVol(r.net_bcm)} BCM`))}`}
        ${baris('HM produksi', esc(fmtHM(r.hm_hours)))}
        ${baris('Hasil', esc(fmtRatio(r.actual_fuel_ratio, r.unit || 'L/BCM')))}` : `<h4 style="margin:10px 0 4px;font-size:13px;">Plan</h4>
        ${baris('Weighted plan', esc(fmtVol(r.plan_productivity)))}
        ${baris('Plan version', esc((lin.plan_version_id || '—')))}
        <h4 style="margin:10px 0 4px;font-size:13px;">Actual</h4>
        ${baris('Gross volume', esc(fmtVol(r.gross_volume)))}
        ${baris('Net volume', esc(fmtVol(r.net_volume)))}
        ${baris('HM produksi', esc(fmtHM(r.hm_hours)))}
        ${baris('Ritase / segmen / factor', esc(`${src.ritaseRows ?? '—'} / ${src.workLogSegments ?? '—'} / ${src.truckFactors ?? '—'}`))}
        <h4 style="margin:10px 0 4px;font-size:13px;">Hasil</h4>
        ${baris('Actual', esc(fmtVol(r.actual_productivity)))}
        ${baris('Expected', esc(fmtVol(r.expected_production)))}
        ${baris('Achievement', esc(fmtPct(r.achievement_percentage)))}
        ${baris('Net achievement', esc(fmtPct(r.net_achievement_percentage)))}`}
        <h4 style="margin:10px 0 4px;font-size:13px;">Validasi</h4>
        ${baris('Reason codes', esc((r.reason_codes || []).join(', ') || '—'))}
        <h4 style="margin:10px 0 4px;font-size:13px;">Lineage</h4>
        ${baris('Formula', esc(lin.formula_version || '—') + (lin.operator_share_version ? ' / ' + esc(lin.operator_share_version) : ''))}
        ${baris('Dihitung', esc(lin.calculated_at || '—'))}
        ${baris('Fleet IDs', esc((lin.fleet_ids || []).slice(0, 5).join(', ') || '—'))}
        ${baris('Segmen IDs', esc((lin.segment_ids || []).slice(0, 5).join(', ') || '—'))}
      </aside></div>`;
  }

  function bangunKerangka() {
    const host = document.querySelector('#tab-prodProductivityReport');
    if (!host) return;
    host.innerHTML = `<div id="prankingRoot" class="lb-shell">
      <div class="lb-header">
        <div><h2 class="lb-title">Leader Board</h2>
        <p class="lb-subtitle">Ranking kinerja produksi dan efisiensi fuel dengan Data Control yang transparan.</p></div>
        <nav class="lb-tabs" aria-label="Mode Leader Board">
          <button class="lb-tab is-active" data-pr-tab="control" onclick="ProductivityRankingUI.pindahTab('control')">Data Control</button>
          <button class="lb-tab" data-pr-tab="ranking" onclick="ProductivityRankingUI.pindahTab('ranking')">Productivity Ranking</button>
          <button class="lb-tab" data-pr-tab="fuel" onclick="ProductivityRankingUI.pindahTab('fuel')">Fuel Ratio Ranking</button>
        </nav>
      </div>
      <div class="lb-filters">
        <label class="lb-field">Range Periode<div style="display:flex;gap:5px"><input id="prDari" type="date" style="width:50%"><input id="prSampai" type="date" style="width:50%"></div></label>
        <label class="lb-field">PIT / Area<input id="prArea" type="text" placeholder="Semua PIT / Area"></label>
        <label class="lb-field">JOB<input id="prJob" type="text" placeholder="Semua JOB"></label>
        <label class="lb-field">Jenis Produksi<select id="prTipe"><option value="ob">OB</option><option value="coal">Coal</option></select></label>
        <label class="lb-field">Material<input id="prMaterial" type="text" placeholder="Semua Material"></label>
        <label class="lb-field">Status Data<select id="prStatus"><option value="">Semua Status</option><option value="ready">Siap</option><option value="incomplete">Perlu dilengkapi</option><option value="ambiguous">Ambigu</option><option value="excluded">Dikecualikan</option></select></label>
        <button class="lb-process" onclick="ProductivityRankingUI.refresh()">⟳ Proses Ulang Data</button>
      </div>
      <div id="prMeta" class="lb-meta"></div>
      <div id="prPanel"></div>
      <div id="prDrawerHost"></div>
    </div>`;
    document.getElementById('prDari').value = monthStart();
    document.getElementById('prSampai').value = todayStr();
  }

  function tandaiTab() {
    document.querySelectorAll('[data-pr-tab]').forEach(b => {
      const aktif = b.dataset.prTab === state.tab;
      b.classList.toggle('is-active', aktif);
    });
  }

  function sibuk(pesan) {
    document.getElementById('prPanel').innerHTML = `<div class="lb-loading">${esc(pesan)}</div>`;
  }

  function galat(error) {
    document.getElementById('prPanel').innerHTML = `<div class="lb-error">Gagal memuat: ${esc(error?.message || error)}</div>`;
  }

  async function muatRanking() {
    sibuk('Memuat ranking…');
    try {
      state.filters = bacaFilter();
      const isFuel = state.metric === 'fuel';
      const endpoint = isFuel ? `${BASE}/fuel-ratio` : BASE;
      const data = await fwGet(`${endpoint}?${buildQuery(state.filters)}`);
      state.ranking = data;
      const m = data.meta || {};
      document.getElementById('prMeta').innerHTML = `<span><strong>Sumber:</strong> ${esc(m.data_source === 'data_control' ? 'Data Control' : (m.data_source || ''))}</span><span><strong>Formula:</strong> ${esc(m.formula_version || '')}</span><span><strong>Agregasi:</strong> ${esc(m.aggregation_method || '')}</span><span><strong>Basis:</strong> ${esc(m.production_basis || '')}</span><span><strong>Satuan:</strong> ${esc(m.unit || '')}</span><span><strong>Diperbarui:</strong> ${esc((m.generated_at || '').slice(0, 19).replace('T', ' '))}</span>`;
      const r = data.rankings || {};
      const unit = m.unit || '';
      document.getElementById('prPanel').innerHTML = highlightHtml(data.controlHighlights)
        + `<div class="lb-ranking-grid">`
        + kartuRanking(isFuel ? 'Top 10 Excavator Fuel Ratio' : 'Top 10 Excavator Productivity', '🏆', r.excavators || [], unit, state.metric)
        + kartuRanking(isFuel ? 'Top 10 Dump Truck Fuel Ratio' : 'Top 10 Dump Truck Productivity', '🚛', r.dumpTrucks || [], unit, state.metric)
        + kartuRanking(isFuel ? 'Top 10 Low Operator Excavator Fuel Ratio' : 'Top 10 Operator Excavator Productivity', '👷', r.excavatorOperators || [], unit, state.metric)
        + kartuRanking(isFuel ? 'Top 10 Low Driver DT Fuel Ratio' : 'Top 10 Driver DT Productivity', '🧑‍✈️', r.dumpTruckDrivers || [], unit, state.metric)
        + (isFuel ? '' : kartuRanking('Top 10 Low Operator Excavator Productivity', '📉', r.lowExcavatorOperators || [], unit, state.metric))
        + (isFuel ? '' : kartuRanking('Top 10 Low Driver DT Productivity', '📉', r.lowDumpTruckDrivers || [], unit, state.metric))
        + `</div>`;
      document.querySelectorAll('[data-pr-hl]').forEach(b => b.addEventListener('click', () => {
        const h = (data.controlHighlights || [])[Number(b.dataset.prHl)];
        const t = highlightTarget(h);
        state.subtab = 'anomali';
        state.hlFilter = t;
        state.controlPage = 1;
        state.tab = 'control';
        void muatTab();
      }));
    } catch (error) { galat(error); }
  }

  const SUBTABS = [
    ['excavator', 'Excavator'], ['dumptruck', 'Dump Truck'],
    ['operator', 'Operator Excavator'], ['driver', 'Driver DT'],
    ['anomali', 'Anomali & Mapping'], ['riwayat', 'Riwayat Proses'],
  ];

  async function muatControl() {
    sibuk('Memuat Data Control…');
    try {
      state.filters = bacaFilter();
      if (state.subtab === 'riwayat') return muatRiwayat();
      const isFuel = state.metric === 'fuel';
      const params = { ...state.filters, page: state.controlPage, page_size: PAGE_SIZE, sort: state.sort, dir: state.dir };
      if (state.subtab === 'anomali') {
        params.control_status = (state.hlFilter && state.hlFilter.control_status) || 'incomplete,ambiguous,excluded';
        params.reason_code = (state.hlFilter && state.hlFilter.reason_code) || '';
        if (!params.reason_code) delete params.reason_code;
      } else if (state.hlFilter && (state.hlFilter.control_status || state.hlFilter.reason_code)) {
        params.control_status = state.hlFilter.control_status || '';
        params.reason_code = state.hlFilter.reason_code || '';
        if (!params.control_status) delete params.control_status;
        if (!params.reason_code) delete params.reason_code;
      } else {
        params.entity_type = state.subtab;
      }
      const endpoint = isFuel ? `${BASE}/fuel-ratio/data-control` : `${BASE}/data-control`;
      const data = await fwGet(`${endpoint}?${buildQuery(params)}`);
      state.control = data;
      const meta = data.meta || {};
      const sum = data.summary || {};
      document.getElementById('prMeta').innerHTML = `<span><strong>Formula:</strong> ${esc(meta.formula_version || '')}</span><span><strong>Mode:</strong> ${isFuel ? 'Fuel Ratio' : 'Productivity'}</span><span><strong>Siap:</strong> ${esc(sum.ready ?? '—')}</span><span><strong>Diperbarui:</strong> ${esc((meta.generated_at || '').slice(0, 19).replace('T', ' '))}</span>`;
      const subtabHtml = SUBTABS.map(([k, l]) => `<button class="lb-subtab ${state.subtab === k ? 'is-active' : ''}" onclick="ProductivityRankingUI.pindahSubtab('${k}')">${l}</button>`).join('');
      const pages = pageCount(meta.total_rows, meta.page_size);
      const anomalies = isFuel
        ? [
          ['🛢️','Fuel belum dialokasikan',sum.missingFuelAllocation || 0,'MISSING_FUEL_ALLOCATION'],
          ['⛏️','Fuel tanpa produksi',sum.fuelWithoutProduction || 0,'FUEL_WITHOUT_PRODUCTION'],
          ['🚛','Produksi tanpa fuel',sum.productionWithoutFuel || 0,'PRODUCTION_WITHOUT_FUEL'],
          ['🛣️','Jarak DT bermasalah',(sum.missingDistanceKm || 0) + (sum.ambiguousDistanceAllocation || 0),'MISSING_DISTANCE_KM,AMBIGUOUS_DISTANCE_ALLOCATION'],
          ['🧊','Density/material bermasalah',(sum.missingDensity || 0) + (sum.ambiguousMaterial || 0),'MISSING_DENSITY'],
        ]
        : [
          ['◫','Plan hilang',sum.missingPlan || 0,'MISSING_PLAN'],
          ['⏱','HM hilang',sum.missingHm || 0,'MISSING_HM'],
          ['🚛','Truck Factor hilang',sum.missingTruckFactor || 0,'MISSING_TRUCK_FACTOR'],
          ['◇','Material ambigu',sum.ambiguousMaterial || 0,'AMBIGUOUS_MATERIAL'],
        ];
      const anomalyHtml = anomalies.map(([icon,label,count,reason]) => `<button class="lb-anomaly" data-pr-reason="${esc(reason)}" type="button"><span class="lb-anomaly-icon">${icon}</span><span><strong>${esc(label)}</strong><small>Klik untuk melihat data terkait</small></span><span class="lb-anomaly-value">${esc(count)}</span></button>`).join('');
      document.getElementById('prPanel').innerHTML = `
        <div class="lb-control-switch" role="group" aria-label="Pilih dataset Data Control"><strong>Data Control</strong>
          <button type="button" class="lb-metric-tab ${isFuel ? '' : 'is-active'}" aria-pressed="${isFuel ? 'false' : 'true'}" onclick="ProductivityRankingUI.ubahMetricControl('productivity')">Productivity Ranking</button>
          <button type="button" class="lb-metric-tab ${isFuel ? 'is-active' : ''}" aria-pressed="${isFuel ? 'true' : 'false'}" onclick="ProductivityRankingUI.ubahMetricControl('fuel')">Fuel Ratio Ranking</button>
        </div><div class="lb-control-layout"><section class="lb-panel">
          <div class="lb-panel-head"><h3>Dataset Siap Ranking</h3><span>${esc(meta.total_rows || 0)} baris · kesiapan ${sum.readiness_percentage == null ? '—' : Number(sum.readiness_percentage).toFixed(1) + '%'}</span></div>
          <div class="lb-subtabs">${subtabHtml}<label style="margin-left:auto;font-size:11px">Urut <select id="prSort" onchange="ProductivityRankingUI.ubahSort(this.value)"><option value="tanggal">Tanggal</option><option value="${isFuel ? 'actual_fuel_ratio' : 'achievement_percentage'}">${isFuel ? 'Fuel Ratio' : 'Achievement'}</option>${isFuel ? '' : '<option value="actual_productivity">PDTY</option>'}<option value="${isFuel ? 'liters' : 'gross_volume'}">${isFuel ? 'Liter' : 'Produksi'}</option></select></label><button class="lb-subtab" onclick="ProductivityRankingUI.balikDir()">${state.dir === 'asc' ? '↑ Naik' : '↓ Turun'}</button></div>
          ${tabelKontrol(data.rows || [], state.metric)}
          <div class="lb-pagination"><button class="tombol tombol--ghost" ${meta.page <= 1 ? 'disabled' : ''} onclick="ProductivityRankingUI.halamanControl(-1)">← Sebelumnya</button><span>Halaman ${meta.page} dari ${pages}</span><button class="tombol tombol--ghost" ${meta.page >= pages ? 'disabled' : ''} onclick="ProductivityRankingUI.halamanControl(1)">Berikutnya →</button></div>
        </section><aside class="lb-side-stack">
          <section class="lb-panel"><div class="lb-panel-head"><h3>Anomali Prioritas</h3></div>${anomalyHtml}</section>
          <section class="lb-panel"><div class="lb-panel-head"><h3>Alur Proses Data</h3></div><div class="lb-lineage"><div><span>${isFuel ? '🛢️' : '⛏️'}</span>Sumber authoritative</div><b>→</b><div><span>🗄️</span>Data Control</div><b>→</b><div><span>⚖️</span>Weighted average</div><b>→</b><div><span>🏆</span>${isFuel ? 'Fuel Ratio Ranking' : 'Productivity Ranking'}</div></div></section>
        </aside></div>`;
      const sortSel = document.getElementById('prSort');
      if (sortSel) sortSel.value = state.sort;
      document.querySelectorAll('[data-pr-row]').forEach(tr => tr.addEventListener('click', () => {
        const row = (data.rows || []).find(r => String(r.control_key) === tr.dataset.prRow);
        state.drawer = row || null;
        document.getElementById('prDrawerHost').innerHTML = drawerHtml(state.drawer, state.metric);
      }));
      document.querySelectorAll('[data-pr-reason]').forEach(button => button.addEventListener('click', () => {
        state.subtab = 'anomali'; state.hlFilter = { reason_code: button.dataset.prReason || '' }; state.controlPage = 1; void muatControl();
      }));
    } catch (error) { galat(error); }
  }

  function muatRiwayat() {
    const c = state.control;
    const sum = (c && c.summary) || {};
    const meta = (c && c.meta) || {};
    document.getElementById('prPanel').innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${SUBTABS.map(([k, l]) => `<button class="tombol ${state.subtab === k ? '' : 'tombol--ghost'}" onclick="ProductivityRankingUI.pindahSubtab('${k}')">${l}</button>`).join('')}</div>
      <div class="tabel-wrap" style="padding:16px;font-size:13px;">
        <h4 style="margin:0 0 8px;">Riwayat Proses Kalkulasi</h4>
        <p style="color:#64748b;">Snapshot terakhir dihitung ulang dari sumber authoritative setiap kali filter dimuat (tanpa cache).</p>
        <div>Formula: <code>${esc(meta.formula_version || 'productivity-ranking-gross-v1')}</code> + <code>${esc(meta.operator_share_version || 'operator-volume-hm-share-v1')}</code></div>
        <div>Dihitung: ${esc((meta.generated_at || '').slice(0, 19).replace('T', ' '))}</div>
        <div>Total baris: ${esc(meta.total_rows ?? '—')} · Siap: ${esc(sum.ready ?? '—')} · Belum lengkap: ${esc(sum.incomplete ?? '—')} · Ambigu: ${esc(sum.ambiguous ?? '—')} · Dikecualikan: ${esc(sum.excluded ?? '—')}</div>
      </div>`;
  }

  function muatTab() {
    tandaiTab();
    document.getElementById('prMeta').innerHTML = '';
    if (state.tab === 'ranking' || state.tab === 'fuel') {
      state.metric = state.tab === 'fuel' ? 'fuel' : 'productivity';
      return muatRanking();
    }
    return muatControl();
  }

  const ui = {
    open() {
      if (!document.getElementById('prankingRoot')) bangunKerangka();
      if (!state.dibuka) { state.dibuka = true; }
      return muatTab();
    },
    refresh() { state.controlPage = 1; state.hlFilter = null; return muatTab(); },
    pindahTab(k) { state.tab = k; if (k === 'ranking') state.metric = 'productivity'; if (k === 'fuel') state.metric = 'fuel'; state.controlPage = 1; if (k === 'control' && !['excavator', 'dumptruck', 'operator', 'driver', 'anomali', 'riwayat'].includes(state.subtab)) state.subtab = 'excavator'; return muatTab(); },
    pindahSubtab(k) { state.subtab = k; state.controlPage = 1; state.hlFilter = null; return muatControl(); },
    ubahMetricControl(metric) { state.metric = metric === 'fuel' ? 'fuel' : 'productivity'; state.controlPage = 1; state.hlFilter = null; state.subtab = 'excavator'; return muatControl(); },
    halamanControl(d) { state.controlPage = Math.max(1, state.controlPage + d); return muatControl(); },
    ubahSort(v) { state.sort = v; state.controlPage = 1; return muatControl(); },
    balikDir() { state.dir = state.dir === 'asc' ? 'desc' : 'asc'; return muatControl(); },
    tutupDrawer() { state.drawer = null; const h = document.getElementById('prDrawerHost'); if (h) h.innerHTML = ''; },
  };

  return {
    pure: { esc, toneClass, fmtPct, fmtVol, fmtHM, fmtRatio, buildQuery, highlightTarget, pageCount },
    ui,
  };
});
