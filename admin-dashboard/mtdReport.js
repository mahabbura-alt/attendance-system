/* Monthly Project Performance — authoritative calculations are supplied by backend. */
(function (global, factory) {
  const api = factory(global);
  if (global) global.MtdReportUI = api.ui;
  if (typeof module === 'object' && module.exports) module.exports = api.pure;
})(typeof window !== 'undefined' ? window : globalThis, function createMtdReport(global) {
  'use strict';

  const state = { opened: false, activeTab: 'executive', chartMode: 'ob', report: null, chart: null };
  const tabNames = {
    executive: 'Executive Summary', production: 'Production', fleet: 'Fleet & Efficiency',
    loss: 'Loss & Weather', quality: 'Data Quality',
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const num = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—'
    : new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(Number(value));
  const pct = value => value == null ? '—' : `${num(value, 1)}%`;
  const ratio = value => value == null ? '—' : `${num(value, 3)} L/BCM`;
  const tone = value => value == null ? 'neutral' : Number(value) >= 100 ? 'good' : Number(value) >= 80 ? 'warn' : 'bad';
  const periodLabel = period => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(period.year, period.month - 1, 1)));
  const sourceLabel = value => ({ fleet_deployment: 'Fleet Deployment', monthly_target: 'Target Bulanan', unavailable: 'Belum tersedia' }[value] || value);

  function defaultPeriod() {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  function queryFromForm(root) {
    const q = new URLSearchParams();
    ['year', 'month', 'cutoff', 'area', 'job', 'material', 'shift_id'].forEach(name => {
      const value = root.querySelector(`[name="${name}"]`)?.value;
      if (value) q.set(name, value);
    });
    if (root.querySelector('[name="compare"]')?.checked) q.set('compare', '1');
    return q;
  }

  function apiUrl(path) {
    if (typeof global.getProdApiUrl === 'function') return global.getProdApiUrl(path);
    const base = typeof global.getApiBaseUrl === 'function' ? global.getApiBaseUrl() : '';
    return `${base}${path}`;
  }

  function authHeaders() {
    if (typeof global.getProdAuthHeaders === 'function') return global.getProdAuthHeaders();
    const token = global.state?.token || localStorage.getItem('token') || '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function progress(value) {
    const width = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="mtd-progress"><span style="width:${width}%"></span></div>`;
  }

  function kpiCard(icon, label, value, detail, accent, help = '') {
    return `<article class="mtd-kpi" style="--accent:${accent}" title="${esc(help)}">
      <div class="mtd-kpi__head"><span class="mtd-kpi__icon">${icon}</span><span>${esc(label)}</span></div>
      <strong>${value}</strong><small>${detail}</small>
    </article>`;
  }

  function filterOptions(items, value, labelKey, valueKey) {
    return (items || []).map(item => {
      const v = valueKey ? item[valueKey] : item;
      const label = labelKey ? item[labelKey] : item;
      return `<option value="${esc(v)}" ${String(v) === String(value || '') ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
  }

  function renderShell(root) {
    const d = defaultPeriod();
    root.innerHTML = `<div class="mtd-page">
      <header class="mtd-hero">
        <div><div class="mtd-eyebrow">PROJECT PERFORMANCE / MONTHLY</div>
          <h2>Monthly Project Performance</h2>
          <p>Control room pencapaian produksi, efisiensi fleet, fuel, loss, dan kesiapan data.</p></div>
        <div class="mtd-hero__actions"><button type="button" data-action="export">⇩ Export Excel</button><span class="mtd-live"><i></i> Live data</span></div>
      </header>
      <form class="mtd-filters" data-role="filters">
        <label>Tahun<input type="number" name="year" min="2000" max="2100" value="${d.year}"></label>
        <label>Bulan<select name="month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${d.month === i + 1 ? 'selected' : ''}>${new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(new Date(2026, i, 1))}</option>`).join('')}</select></label>
        <label>Cutoff<input type="date" name="cutoff"></label>
        <label>PIT / Area<select name="area"><option value="">Semua area</option></select></label>
        <label>JOB<select name="job"><option value="">Semua JOB</option></select></label>
        <label>Material<select name="material"><option value="">Semua material</option></select></label>
        <label>Shift<select name="shift_id"><option value="">Semua shift</option></select></label>
        <label class="mtd-compare"><input type="checkbox" name="compare"><span>Bandingkan bulan lalu</span></label>
        <button class="mtd-primary" type="submit">↻ Tampilkan</button>
      </form>
      <div data-role="content" class="mtd-loading"><span></span><p>Menyusun resume bulanan…</p></div>
    </div>`;
    root.querySelector('[data-role="filters"]').addEventListener('submit', event => { event.preventDefault(); load(root); });
    root.addEventListener('click', handleClick);
  }

  function populateFilters(root, report) {
    const form = root.querySelector('[data-role="filters"]');
    if (!form) return;
    const values = Object.fromEntries(new FormData(form));
    const p = report.meta.period;
    form.elements.cutoff.max = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.days).padStart(2, '0')}`;
    form.elements.cutoff.min = p.start;
    form.elements.cutoff.value = p.cutoff;
    form.elements.area.innerHTML = `<option value="">Semua area</option>${filterOptions(report.filters.areas, values.area)}`;
    form.elements.job.innerHTML = `<option value="">Semua JOB</option>${filterOptions(report.filters.jobs, values.job, 'code', 'code')}`;
    form.elements.material.innerHTML = `<option value="">Semua material</option>${filterOptions(report.filters.materials, values.material)}`;
    form.elements.shift_id.innerHTML = `<option value="">Semua shift</option>${filterOptions(report.filters.shifts, values.shift_id, 'nama_shift', 'id')}`;
  }

  function renderReport(root, report) {
    const content = root.querySelector('[data-role="content"]');
    const s = report.summary; const p = report.meta.period;
    const active = key => state.activeTab === key ? 'is-active' : '';
    content.className = '';
    const comparison = report.comparison ? `<div class="mtd-compare-strip">Vs ${esc(periodLabel(report.comparison.period))}: OB <b>${num(report.comparison.summary.ob.actual)} BCM</b> · CG <b>${num(report.comparison.summary.coal.actual)} Ton</b> · Fuel <b>${num(report.comparison.summary.fuel.liters, 0)} L</b></div>` : '';
    content.innerHTML = `<div class="mtd-context">
      <div><b>${esc(periodLabel(p))}</b><span>Cutoff ${esc(p.cutoff)}</span></div>
      <div>Basis: <b>produksi net setelah Non Prod</b> · Target OB: <b>${esc(sourceLabel(report.meta.targetSource.ob))}</b> · Target CG: <b>${esc(sourceLabel(report.meta.targetSource.coal))}</b></div>
      <div class="mtd-readiness ${tone(s.quality.readiness)}">Data readiness ${pct(s.quality.readiness)}</div>
    </div>${comparison}
    <section class="mtd-kpis">
      ${kpiCard('▰', 'OB Achievement', pct(s.ob.achievement), `${num(s.ob.actual)} / ${num(s.ob.target)} BCM`, '#0f9d75', 'Actual OB dibanding target bulanan')}
      ${kpiCard('◆', 'Coal Achievement', pct(s.coal.achievement), `${num(s.coal.actual)} / ${num(s.coal.target)} Ton`, '#315be8', 'Actual Coal dibanding target bulanan')}
      ${kpiCard('◉', 'Fuel Consumption', `${num(s.fuel.liters, 0)} L`, `OB ${num(s.fuel.obLiters, 0)} · CG ${num(s.fuel.coalLiters, 0)}`, '#f59e0b')}
      ${kpiCard('↯', 'Fuel Ratio OB', ratio(s.fuel.ratioOb), 'Liter per BCM OB', '#db7c0b')}
      ${kpiCard('↯', 'Fuel Ratio CG', ratio(s.fuel.ratioCoal), 'Coal dikonversi Ton ÷ density', '#7c3aed')}
      ${kpiCard('↯', 'Fuel Ratio All', ratio(s.fuel.ratioAll), 'Liter / (OB BCM + Coal BCM)', '#0891b2')}
    </section>
    <nav class="mtd-tabs" aria-label="Bagian MTD Report">${Object.entries(tabNames).map(([key, label]) => `<button type="button" class="${active(key)}" data-tab="${key}">${esc(label)}</button>`).join('')}</nav>
    <div data-role="tab">${renderTab(report)}</div>`;
    renderChart(root, report);
  }

  function renderTab(report) {
    if (state.activeTab === 'production') return renderProduction(report);
    if (state.activeTab === 'fleet') return renderFleet(report);
    if (state.activeTab === 'loss') return renderLoss(report);
    if (state.activeTab === 'quality') return renderQuality(report);
    return renderExecutive(report);
  }

  function outlook(metric, label) {
    return `<div class="mtd-outlook-row"><div><b>${esc(label)}</b><small>${num(metric.actual)} ${metric.unit} aktual</small></div>
      <div class="mtd-outlook-values"><span>Run-rate <b>${num(metric.runRateForecast)}</b></span><span>Committed <b>${num(metric.committedForecast)}</b></span><span>Need/day <b>${num(metric.requiredDailyRate)}</b></span></div>
      ${progress(metric.achievement)}</div>`;
  }

  function renderExecutive(report) {
    const s = report.summary;
    return `<section class="mtd-exec-grid">
      <article class="mtd-panel mtd-chart-panel"><header><div><h3>Cumulative Plan vs Actual</h3><p>Kurva tetap sampai akhir bulan; actual setelah cutoff dibiarkan kosong.</p></div>
        <div class="mtd-segment"><button type="button" data-chart="ob" class="${state.chartMode === 'ob' ? 'is-active' : ''}">OB · BCM</button><button type="button" data-chart="coal" class="${state.chartMode === 'coal' ? 'is-active' : ''}">CG · Ton</button></div></header>
        <div class="mtd-chart"><canvas id="mtdCumulativeChart"></canvas></div></article>
      <article class="mtd-panel mtd-outlook"><header><div><h3>Month-End Outlook</h3><p>Forecast transparan, tanpa mencampur satuan.</p></div></header>
        ${outlook(s.ob, 'Overburden')}${outlook(s.coal, 'Coal Getting')}
        <div class="mtd-mini-metrics"><span>PA <b>${pct(s.operation.pa)}</b></span><span>UA <b>${pct(s.operation.ua)}</b></span><span>HM <b>${num(s.operation.productiveHm)} jam</b></span></div></article>
      <article class="mtd-panel"><header><div><h3>Achievement by Area</h3><p>Plan berasal dari fleet deployment yang published.</p></div></header>${renderAreas(report.areas)}</article>
      <article class="mtd-panel"><header><div><h3>Project Loss Drivers</h3><p>Durasi dan volume loss MTD.</p></div></header>${renderLossCards(report.losses)}</article>
      <article class="mtd-panel mtd-alert-panel"><header><div><h3>Priority Alerts</h3><p>Klik untuk membuka Data Quality.</p></div><button type="button" data-tab="quality">Lihat semua →</button></header>${renderAlerts(report.quality)}</article>
    </section>`;
  }

  function renderAreas(areas) {
    if (!areas.length) return '<div class="mtd-empty">Belum ada area dengan produksi pada periode ini.</div>';
    return `<div class="mtd-area-list">${areas.map(row => `<div><b>${esc(row.area)}</b><span>OB ${pct(row.obAchievement)}</span>${progress(row.obAchievement)}<span>CG ${pct(row.coalAchievement)}</span>${progress(row.coalAchievement)}</div>`).join('')}</div>`;
  }

  function renderLossCards(loss) {
    const rows = [['Breakdown', loss.breakdownHours, 'jam'], ['Standby', loss.standbyHours, 'jam'], ['Rain', loss.rainHours, 'jam'],
      ['Slippery', loss.slipperyHours, 'jam'], ['Non Prod OB', loss.nonprodObBcm, 'BCM'], ['Non Prod CG', loss.nonprodCoalTon, 'Ton']];
    return `<div class="mtd-loss-cards">${rows.map(([label, value, unit]) => `<div><span>${esc(label)}</span><b>${num(value)} ${unit}</b></div>`).join('')}</div>`;
  }

  function renderAlerts(items) {
    if (!items.length) return '<div class="mtd-empty mtd-empty--good">✓ Tidak ada isu prioritas pada filter aktif.</div>';
    return `<div class="mtd-alerts">${items.slice(0, 5).map(item => `<a href="#quality-${esc(item.code)}" data-quality-code="${esc(item.code)}"><i class="${esc(item.severity)}">!</i><span><b>${esc(item.label)}</b><small>${esc(item.code)}</small></span><strong>${num(item.count, 0)}</strong><em>→</em></a>`).join('')}</div>`;
  }

  function renderProduction(report) {
    return `<article class="mtd-panel"><header><div><h3>Daily Production Ledger</h3><p>OB dan Coal disajikan dalam satuan asalnya.</p></div></header><div class="mtd-table-wrap"><table><thead><tr><th>Tanggal</th><th>Plan OB</th><th>Actual OB</th><th>Plan CG</th><th>Actual CG</th><th>OB Cum.</th><th>CG Cum.</th></tr></thead><tbody>${report.daily.map(row => `<tr><td>${esc(row.date)}</td><td>${num(row.obPlan)}</td><td>${num(row.obActual)}</td><td>${num(row.coalPlan)}</td><td>${num(row.coalActual)}</td><td>${num(row.obActualCumulative)}</td><td>${num(row.coalActualCumulative)}</td></tr>`).join('')}</tbody></table></div></article>`;
  }

  function renderFleet(report) {
    const o = report.summary.operation;
    return `<section><div class="mtd-operation-strip"><span>Productive HM <b>${num(o.productiveHm)} jam</b></span><span>PA <b>${pct(o.pa)}</b></span><span>UA <b>${pct(o.ua)}</b></span><span>Breakdown <b>${num(o.breakdownHours)} jam</b></span><span>Standby <b>${num(o.standbyHours)} jam</b></span></div>
      <article class="mtd-panel"><header><div><h3>Fleet Performance</h3><p>Produktivitas = produksi unit ÷ HM unit; dibanding loader plan bila tersedia.</p></div></header><div class="mtd-table-wrap"><table><thead><tr><th>Unit</th><th>Type</th><th>Area / JOB</th><th>Material</th><th>Produksi</th><th>HM</th><th>Productivity</th><th>Plan</th><th>Achievement</th></tr></thead><tbody>${report.fleets.length ? report.fleets.map(row => `<tr><td><b>${esc(row.unit)}</b></td><td>${esc(String(row.type || '').toUpperCase())}</td><td>${esc(row.areas.join(', '))}<small>${esc(row.jobs.join(', '))}</small></td><td>${esc(row.materials.join(', '))}</td><td>${num(row.production)}</td><td>${num(row.hm)}</td><td>${num(row.productivity)}</td><td>${num(row.planProductivity)}</td><td><span class="mtd-badge ${tone(row.achievement)}">${pct(row.achievement)}</span></td></tr>`).join('') : '<tr><td colspan="9" class="mtd-empty">Belum ada data fleet pada filter aktif.</td></tr>'}</tbody></table></div></article></section>`;
  }

  function renderLoss(report) {
    return `<section class="mtd-loss-layout"><article class="mtd-panel"><header><div><h3>Loss & Weather Summary</h3><p>Loss produksi dan durasi gangguan operasional.</p></div></header>${renderLossCards(report.losses)}</article>
      <article class="mtd-panel"><header><div><h3>Operational Notes</h3><p>Aturan interpretasi angka.</p></div></header><ul class="mtd-notes"><li>Non Prod adalah volume ritase yang dikeluarkan dari produksi net.</li><li>Rain dan Slippery mengikuti kejadian per area, JOB, tanggal, dan shift.</li><li>Breakdown dan Standby mengikuti unit produktif yang cocok dengan filter.</li><li>Filter material menonaktifkan HM/fuel bila atribusi material tidak deterministik.</li></ul></article></section>`;
  }

  function renderQuality(report) {
    return `<section class="mtd-quality-layout"><article class="mtd-panel"><header><div><h3>Data Quality Control</h3><p>Readiness ${pct(report.summary.quality.readiness)} · ${num(report.summary.quality.issues, 0)} isu.</p></div></header><div class="mtd-quality-status" data-role="quality-status" role="status" aria-live="polite"></div>${renderAlerts(report.quality)}</article>
      <article class="mtd-panel"><header><div><h3>Data Lineage</h3><p>Sumber dan perannya dalam laporan.</p></div></header><div class="mtd-lineage">${report.lineage.map((item, index) => `<div><i>${index + 1}</i><span><b>${esc(item.source)}</b><small>${esc(item.role)}</small></span></div>`).join('')}</div><footer>Formula: <b>${esc(report.meta.formulaVersion)}</b> · Generated ${esc(new Date(report.meta.generatedAt).toLocaleString('id-ID'))}</footer></article></section>`;
  }

  async function renderChart(root, report) {
    const canvas = root.querySelector('#mtdCumulativeChart');
    if (!canvas) return;
    try {
      const ChartLib = global.Chart || await global.OMOSLoadLibrary?.('chart');
      if (!ChartLib) return;
      if (state.chart) state.chart.destroy();
      const type = state.chartMode; const color = type === 'ob' ? '#0f9d75' : '#315be8';
      state.chart = new ChartLib(canvas, { type: 'line', data: {
        labels: report.daily.map(row => row.date.slice(8, 10)), datasets: [
          { label: 'Plan', data: report.daily.map(row => row[`${type}PlanCumulative`]), borderColor: '#8aa0b8', borderDash: [6, 5], pointRadius: 0, borderWidth: 2 },
          { label: 'Actual', data: report.daily.map(row => row[`${type}ActualCumulative`]), borderColor: color, backgroundColor: `${color}22`, fill: true, pointRadius: 2, borderWidth: 3, tension: .25 },
        ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false }, title: { display: true, text: 'Tanggal' } }, y: { beginAtZero: true, title: { display: true, text: type === 'ob' ? 'BCM' : 'Ton' } } } } });
    } catch (error) { canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'mtd-empty', textContent: `Grafik tidak tersedia: ${error.message}` })); }
  }

  function setQualityStatus(message, level = '') {
    const status = document.querySelector('#mtdReportRoot [data-role="quality-status"]');
    if (!status) return;
    status.textContent = message || '';
    status.className = `mtd-quality-status${level ? ` is-${level}` : ''}`;
  }

  async function openProductionTab(tabName) {
    if (typeof global.bukaTabProduksi === 'function') {
      await global.bukaTabProduksi(tabName);
      const target = document.getElementById(`tab-${tabName}`);
      if (!target || !target.hidden) return;
    }
    const button = document.querySelector(`.sidebar__tab[data-tab="${tabName}"]`);
    if (!button) throw new Error('Menu halaman tujuan tidak tersedia. Muat ulang halaman lalu coba lagi.');
    button.click();
    await new Promise(resolve => global.requestAnimationFrame?.(resolve) || setTimeout(resolve, 0));
  }

  async function navigateQuality(code, link) {
    const period = state.report?.meta?.period || {};
    link?.classList.add('is-opening');
    link?.setAttribute('aria-busy', 'true');
    setQualityStatus(`Membuka sumber data ${code}…`, 'loading');
    try {
      if (code === 'MISSING_TRUCK_FACTOR') {
        await openProductionTab('prodInputRitase');
        if (typeof global.bukaModalTruckFactor === 'function') global.bukaModalTruckFactor();
        return;
      }
      if (code === 'MISSING_PLAN') {
        await openProductionTab('prodFleetCapacity');
        document.getElementById('fleetDeploymentRoot')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      await openProductionTab('prodDataProduksi');
      if (typeof global.ProductionData?.openIssue !== 'function') {
        throw new Error('Fitur penunjuk data belum selesai dimuat.');
      }
      await global.ProductionData.openIssue({ code, year: period.year, month: period.month, area: period.area || '' });
    } catch (error) {
      console.error('[MTD Data Quality Navigation]', error);
      setQualityStatus(`Gagal membuka data terkait: ${error.message}`, 'error');
    } finally {
      link?.classList.remove('is-opening');
      link?.removeAttribute('aria-busy');
    }
  }

  async function handleClick(event) {
    const root = event.currentTarget; const tab = event.target.closest('[data-tab]')?.dataset.tab;
    if (tab) { state.activeTab = tab; renderReport(root, state.report); return; }
    const qualityLink = event.target.closest('[data-quality-code]');
    const qualityCode = qualityLink?.dataset.qualityCode;
    if (qualityCode) { event.preventDefault(); await navigateQuality(qualityCode, qualityLink); return; }
    const chart = event.target.closest('[data-chart]')?.dataset.chart;
    if (chart) { state.chartMode = chart; renderReport(root, state.report); return; }
    if (event.target.closest('[data-action="export"]')) exportWorkbook();
  }

  async function exportWorkbook() {
    if (!state.report) return;
    try {
      const XLSX = global.XLSX || await global.OMOSLoadLibrary('xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.report.daily), 'Daily Production');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.report.areas), 'Area Achievement');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.report.fleets), 'Fleet Performance');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.report.quality), 'Data Quality');
      const p = state.report.meta.period;
      XLSX.writeFile(workbook, `OMOS_MTD_${p.year}-${String(p.month).padStart(2, '0')}.xlsx`);
    } catch (error) { alert(`Export gagal: ${error.message}`); }
  }

  async function load(root) {
    const content = root.querySelector('[data-role="content"]');
    content.className = 'mtd-loading'; content.innerHTML = '<span></span><p>Menyusun resume bulanan…</p>';
    try {
      const response = await fetch(apiUrl(`/api/admin/production/mtd-report?${queryFromForm(root)}`), { headers: authHeaders() });
      const report = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(report.error || `HTTP ${response.status}`);
      state.report = report; populateFilters(root, report); renderReport(root, report);
    } catch (error) {
      content.className = 'mtd-error'; content.innerHTML = `<b>MTD Report gagal dimuat</b><span>${esc(error.message)}</span><button type="button" data-action="retry">Coba Lagi</button>`;
      content.querySelector('[data-action="retry"]')?.addEventListener('click', () => load(root));
    }
  }

  async function open() {
    const root = document.getElementById('mtdReportRoot');
    if (!root) return;
    if (!state.opened) { renderShell(root); state.opened = true; }
    await load(root);
  }

  return { ui: { open }, pure: { tone, periodLabel, sourceLabel } };
});
