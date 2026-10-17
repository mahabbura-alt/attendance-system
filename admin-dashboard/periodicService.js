(function (global) {
  'use strict';

  let psData = { units: [], packages: [], orders: [], findings: [], shifts: [], personnel: [], counts: {} };
  let psLoaded = false;
  let psIndicatorFilter = '';
  let forecastState = null;

  const esc = value => typeof global.escapeMinePlanning === 'function'
    ? global.escapeMinePlanning(value == null ? '' : String(value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = (value, digits = 1) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? '—' : Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const dateTime = value => value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const dateInput = (value = new Date()) => {
    const d = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };
  const localDate = (value = new Date()) => {
    const d = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  };
  const auth = () => typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  const apiUrl = path => typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(path) : path;

  async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), { ...options, headers: { 'Content-Type': 'application/json', ...auth(), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function modal(markup) {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalKonten');
    if (!overlay || !content) return;
    content.innerHTML = markup;
    overlay.hidden = false;
  }

  function closeModal() {
    if (typeof global.tutupModalGenerik === 'function') global.tutupModalGenerik();
    else {
      const overlay = document.getElementById('modalOverlay');
      if (overlay) overlay.hidden = true;
    }
  }

  function unitById(id) { return psData.units.find(unit => String(unit.id) === String(id)); }
  function orderById(id) { return psData.orders.find(order => String(order.id) === String(id)); }
  function packageById(id) { return psData.packages.find(pack => String(pack.id) === String(id)); }
  function unitModel(unit = {}) { return String(unit.tipe_alat || unit.class_unit || unit.kode_alat || 'Tanpa Model').trim(); }
  function normalized(value) { return String(value || '').trim().toLocaleLowerCase('id-ID'); }
  function inlineArg(value) { return encodeURIComponent(String(value == null ? '' : value)); }
  function packagesForUnit(id) {
    const unit = unitById(id);
    if (!unit) return [];
    return psData.packages.filter(pack => normalized(pack.equipment_class) === normalized(unit.kelas_alat)
      && normalized(pack.equipment_model) === normalized(unitModel(unit)))
      .sort((a, b) => Number(a.cycle_hm) - Number(b.cycle_hm));
  }
  function effectiveStatus(unit) { return unit.open_order_status === 'in_progress' ? 'in_progress' : (unit.due?.status || 'not_configured'); }
  const statusLabel = { normal: 'Normal', upcoming: 'Mendekati', due: 'Due', overdue: 'Overdue', in_progress: 'Service Berjalan', not_configured: 'Belum Diatur', missing_hm: 'HM Belum Ada' };

  function initializePeriodRange() {
    const from = document.getElementById('psPeriodFrom');
    const to = document.getElementById('psPeriodTo');
    if (!from || !to) return null;
    const today = localDate();
    if (!from.value) from.value = `${today.slice(0, 7)}-01`;
    if (!to.value) to.value = today;
    if (from.value > to.value) throw new Error('Tanggal selesai tidak boleh lebih awal dari tanggal mulai.');
    return { dateFrom: from.value, dateTo: to.value };
  }

  function dashboardPath() {
    const range = initializePeriodRange();
    if (!range) return '/api/admin/production/periodic-service/dashboard';
    const query = new URLSearchParams({ date_from: range.dateFrom, date_to: range.dateTo });
    return `/api/admin/production/periodic-service/dashboard?${query}`;
  }

  global.switchBreakdownWorkspace = function switchBreakdownWorkspace(mode) {
    const periodic = mode === 'periodic';
    const breakdownHeader = document.getElementById('breakdownControlHeader');
    if (breakdownHeader) breakdownHeader.hidden = periodic;
    document.getElementById('breakdownControlWorkspace').hidden = periodic;
    document.getElementById('periodicServiceWorkspace').hidden = !periodic;
    document.getElementById('btnBreakdownControlWorkspace').classList.toggle('is-active', !periodic);
    document.getElementById('btnPeriodicServiceWorkspace').classList.toggle('is-active', periodic);
    if (periodic && !psLoaded) void global.muatPeriodicService();
  };

  function renderIndicatorState() {
    document.querySelectorAll('[data-ps-indicator]').forEach(button => {
      const active = button.dataset.psIndicator === psIndicatorFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  global.hapusFilterIndikatorPeriodicService = function hapusFilterIndikatorPeriodicService(resetStatus = false) {
    psIndicatorFilter = '';
    if (resetStatus) {
      const statusSelect = document.getElementById('psStatusFilter');
      if (statusSelect) statusSelect.value = '';
    }
    renderIndicatorState();
  };

  global.bukaDataIndikatorPeriodicService = function bukaDataIndikatorPeriodicService(indicator) {
    if (!['configured', 'upcoming', 'overdue', 'in_progress', 'findings'].includes(indicator)) return;
    psIndicatorFilter = indicator;
    const statusSelect = document.getElementById('psStatusFilter');
    if (statusSelect) statusSelect.value = ['upcoming', 'in_progress'].includes(indicator) ? indicator : '';
    renderIndicatorState();
    const view = indicator === 'findings' ? 'findings' : 'schedule';
    global.switchPeriodicView(view, true);
    if (view === 'schedule') global.renderPeriodicSchedule();
    else renderFindings();
    const panel = document.getElementById(view === 'schedule' ? 'psViewSchedule' : 'psViewFindings');
    global.requestAnimationFrame?.(() => panel?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  global.switchPeriodicView = function switchPeriodicView(view, preserveIndicator = false) {
    if (!preserveIndicator) global.hapusFilterIndikatorPeriodicService(true);
    ['schedule', 'packages', 'history', 'findings'].forEach(name => {
      const panel = document.getElementById(`psView${name[0].toUpperCase()}${name.slice(1)}`);
      if (panel) panel.hidden = name !== view;
    });
    document.querySelectorAll('[data-ps-view]').forEach(button => button.classList.toggle('is-active', button.dataset.psView === view));
    if (!preserveIndicator && psLoaded) {
      if (view === 'schedule') global.renderPeriodicSchedule();
      if (view === 'findings') renderFindings();
    }
  };

  global.muatPeriodicService = async function muatPeriodicService() {
    const body = document.getElementById('psScheduleBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="9" class="tabel__kosong">Memuat jadwal service berbasis HM…</td></tr>';
    try {
      psData = await request(dashboardPath());
      psLoaded = true;
      const types = [...new Set(psData.units.map(unit => unit.kelas_alat || unit.class_unit || unit.tipe_alat || 'Lainnya'))].sort();
      const typeSelect = document.getElementById('psTypeFilter');
      const selected = typeSelect.value;
      typeSelect.innerHTML = '<option value="">Semua Jenis Unit</option>' + types.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
      typeSelect.value = types.includes(selected) ? selected : '';
      const periodText = psData.period ? ` · ${psData.period.dateFrom} s.d. ${psData.period.dateTo}` : '';
      document.getElementById('psUpdatedAt').textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID')}${periodText}`;
      renderKpis(); global.renderPeriodicSchedule(); renderPackages(); renderHistory(); renderFindings();
    } catch (error) {
      body.innerHTML = `<tr><td colspan="9" class="teks-error">Gagal memuat Periodic Service: ${esc(error.message)}. Pastikan migrasi 058 sudah dijalankan.</td></tr>`;
    }
  };

  function renderKpis() {
    const counts = psData.counts || {};
    document.getElementById('psKpiConfigured').textContent = String(psData.units.filter(unit => packagesForUnit(unit.id).length).length);
    document.getElementById('psKpiUpcoming').textContent = String(counts.upcoming || 0);
    document.getElementById('psKpiOverdue').textContent = String((counts.overdue || 0) + (counts.due || 0));
    document.getElementById('psKpiProgress').textContent = String(counts.in_progress || 0);
    document.getElementById('psKpiFindings').textContent = String(psData.findings.filter(item => ['open', 'in_progress'].includes(item.status)).length);
  }

  global.renderPeriodicSchedule = function renderPeriodicSchedule() {
    const body = document.getElementById('psScheduleBody');
    if (!body) return;
    const search = String(document.getElementById('psSearch')?.value || '').toLowerCase();
    const status = document.getElementById('psStatusFilter')?.value || '';
    const type = document.getElementById('psTypeFilter')?.value || '';
    const units = psData.units.filter(unit => {
      const haystack = `${unit.kode_alat} ${unit.kelas_alat} ${unit.class_unit} ${unit.tipe_alat}`.toLowerCase();
      const unitStatus = effectiveStatus(unit);
      const indicatorMatch = !psIndicatorFilter || psIndicatorFilter === 'findings'
        || (psIndicatorFilter === 'configured' && packagesForUnit(unit.id).length > 0)
        || (psIndicatorFilter === 'upcoming' && unitStatus === 'upcoming')
        || (psIndicatorFilter === 'overdue' && ['due', 'overdue'].includes(unitStatus))
        || (psIndicatorFilter === 'in_progress' && unitStatus === 'in_progress');
      return indicatorMatch && (!search || haystack.includes(search)) && (!status || unitStatus === status)
        && (!type || (unit.kelas_alat || unit.class_unit || unit.tipe_alat || 'Lainnya') === type);
    });
    body.innerHTML = units.map(unit => {
      const state = effectiveStatus(unit);
      const due = unit.due || {};
      const openOrder = unit.open_order_id ? orderById(unit.open_order_id) : null;
      let orderAction = '';
      if (openOrder?.status === 'scheduled') orderAction = `<button class="tombol tombol--kecil tombol--utama" onclick="bukaModalMulaiPeriodicService('${esc(openOrder.id)}')">Mulai</button>`;
      else if (openOrder?.status === 'in_progress') orderAction = `<button class="tombol tombol--kecil tombol--utama" onclick="bukaModalSelesaiPeriodicService('${esc(openOrder.id)}')">Selesaikan</button>`;
      else orderAction = `<button class="tombol tombol--kecil tombol--utama" onclick="bukaModalOrderPeriodicService('${esc(unit.id)}')">Service</button>`;
      const progress = Number.isFinite(Number(due.progressPercent)) ? Math.min(100, Math.max(0, Number(due.progressPercent))) : 0;
      return `<tr><td class="periodic-unit-cell"><strong>${esc(unit.kode_alat)}</strong><small>${esc(unit.kelas_alat || unit.class_unit || unit.tipe_alat || '—')}</small></td>
        <td><strong>${number(unit.current_hm)}</strong><small>${unit.hm_date ? `<br>${esc(unit.hm_date)}` : ''}</small></td>
        <td>${number(unit.last_service_hm ?? unit.baseline_hm)}<small>${unit.last_service_at ? `<br>${esc(dateTime(unit.last_service_at))}` : '<br>baseline'}</small></td>
        <td><strong>${number(due.baseCycleHm, 0)} HM</strong><small><br>${esc(due.serviceCode || 'Belum setup')}</small></td><td><strong>${number(due.nextDueHm)}</strong><div class="ps-progress"><i style="width:${progress}%"></i></div></td>
        <td>${due.remainingHm == null ? '—' : `<strong>${number(due.remainingHm)}</strong> HM`}</td><td><span class="ps-status ${esc(state)}">${esc(statusLabel[state] || state)}</span></td>
        <td>${openOrder ? `<strong>${esc(openOrder.service_code || 'WO PS')}</strong><small><br>${esc(openOrder.status)}</small>` : '—'}</td>
        <td><div class="ps-actions">${orderAction}</div></td></tr>`;
    }).join('') || '<tr><td colspan="9" class="tabel__kosong">Tidak ada unit yang sesuai filter.</td></tr>';
  };

  function renderPackages() {
    const root = document.getElementById('psPackageGrid'); if (!root) return;
    const groups = new Map();
    for (const unit of psData.units) {
      const equipmentClass = String(unit.kelas_alat || 'Tanpa Jenis').trim();
      const model = unitModel(unit);
      if (!groups.has(equipmentClass)) groups.set(equipmentClass, new Map());
      if (!groups.get(equipmentClass).has(model)) groups.get(equipmentClass).set(model, []);
      groups.get(equipmentClass).get(model).push(unit);
    }
    root.innerHTML = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'id-ID')).map(([equipmentClass, models]) => `
      <section class="ps-package-type-group"><header><div><span>JENIS EQUIPMENT</span><h4>${esc(equipmentClass)}</h4></div><b>${[...models.values()].reduce((total, units) => total + units.length, 0)} unit</b></header>
        ${[...models.entries()].sort(([a], [b]) => a.localeCompare(b, 'id-ID', { numeric: true })).map(([model, units]) => {
          const packs = psData.packages.filter(pack => normalized(pack.equipment_class) === normalized(equipmentClass) && normalized(pack.equipment_model) === normalized(model)).sort((a, b) => Number(a.cycle_hm) - Number(b.cycle_hm));
          const chips = packs.length ? packs.map(pack => `<button type="button" class="ps-period-chip" onclick="bukaDetailPaketPeriodicService('${esc(pack.id)}')"><b>${esc(pack.service_code)}</b><span>${number(pack.cycle_hm, 0)} HM · ${number(pack.estimated_duration_hours)} Jam</span></button>`).join('') : '<span class="ps-status not_configured">Belum disetup</span>';
          return `<article class="ps-package-model-group"><header><div><small>TIPE MODEL</small><h5>${esc(model)}</h5></div><button type="button" class="tombol tombol--kecil" onclick="bukaAreaSetupPeriodicServiceScope('${inlineArg(equipmentClass)}','${inlineArg(model)}')">+ Periode Service</button></header>
            <div class="tabel-wrap"><table class="tabel ps-package-list"><thead><tr><th>Kode Unit</th><th>Class</th><th>Periode Service & Kebutuhan</th></tr></thead><tbody>${units.sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true })).map(unit => `<tr><td><strong>${esc(unit.kode_alat)}</strong></td><td>${esc(unit.class_unit || '—')}</td><td><div class="ps-period-list">${chips}</div></td></tr>`).join('')}</tbody></table></div></article>`;
        }).join('')}
      </section>`).join('') || '<p class="tabel__kosong">List Equipment belum tersedia.</p>';
  }

  function duration(order) { return order.actual_start && order.actual_finish ? (new Date(order.actual_finish) - new Date(order.actual_start)) / 3600000 : null; }
  function renderHistory() {
    const body = document.getElementById('psHistoryBody'); if (!body) return;
    body.innerHTML = psData.orders.map(order => `<tr><td><strong>${esc(order.kode_alat)}</strong></td><td>${esc(order.service_code || 'PS')}<small><br>${esc(order.service_name || 'Tanpa paket')} · ${(order.planned_items || []).length} kebutuhan</small></td><td><span class="ps-status ${order.status === 'in_progress' ? 'in_progress' : 'normal'}">${esc(order.status)}</span></td><td>${number(order.due_hm)} HM</td><td><strong>${esc(dateTime(order.scheduled_start || order.scheduled_date))}</strong>${order.actual_start ? `<small><br>Mulai: ${esc(dateTime(order.actual_start))}</small>` : ''}${order.actual_finish ? `<small><br>Selesai: ${esc(dateTime(order.actual_finish))}</small>` : ''}</td><td>${number(duration(order))} Jam</td><td>${number(order.actual_service_hm)} HM</td><td>${esc(order.open_findings || 0)}</td><td><div class="ps-actions"><button type="button" class="tombol tombol--kecil" onclick="bukaModalEditPeriodicService('${esc(order.id)}')">Edit</button><button type="button" class="tombol tombol--kecil tombol--bahaya" onclick="konfirmasiHapusPeriodicService('${esc(order.id)}','${esc(order.kode_alat)}')">Hapus</button></div></td></tr>`).join('') || '<tr><td colspan="9" class="tabel__kosong">Belum ada work order Periodic Service.</td></tr>';
  }

  function renderFindings() {
    const root = document.getElementById('psFindingList'); if (!root) return;
    const findings = psIndicatorFilter === 'findings'
      ? psData.findings.filter(finding => ['open', 'in_progress'].includes(finding.status))
      : psData.findings;
    root.innerHTML = findings.map(finding => `<article class="periodic-finding-card severity-${esc(finding.severity)}"><strong>${esc(finding.kode_alat)}</strong><span class="ps-status ${finding.status === 'resolved' ? 'normal' : 'upcoming'}">${esc(finding.severity)} · ${esc(finding.status)}</span><div><h4>${esc(finding.category || 'Temuan Service')}</h4><p>${esc(finding.description)}${finding.recommendation ? ` · ${esc(finding.recommendation)}` : ''}</p></div><div class="ps-actions">${finding.status !== 'resolved' ? `<button class="tombol tombol--kecil" onclick="updatePeriodicFinding('${esc(finding.id)}','in_progress',this)">Proses</button><button class="tombol tombol--kecil tombol--utama" onclick="updatePeriodicFinding('${esc(finding.id)}','resolved',this)">Selesai</button>` : ''}</div></article>`).join('') || `<p class="tabel__kosong">${psIndicatorFilter === 'findings' ? 'Tidak ada temuan terbuka.' : 'Tidak ada temuan Periodic Service.'}</p>`;
  }

  function defaultForecastRange() {
    const now = new Date();
    return {
      dateFrom: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      dateTo: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    };
  }

  function forecastGroups(rows) {
    const groups = new Map();
    (rows || []).forEach(row => {
      const key = `${row.equipmentClass || 'Tanpa Jenis'}|${row.equipmentModel || 'Tanpa Model'}`;
      if (!groups.has(key)) groups.set(key, { equipmentClass: row.equipmentClass || 'Tanpa Jenis', equipmentModel: row.equipmentModel || 'Tanpa Model', rows: [] });
      groups.get(key).rows.push(row);
    });
    return [...groups.values()].sort((a, b) => `${a.equipmentClass}|${a.equipmentModel}`.localeCompare(`${b.equipmentClass}|${b.equipmentModel}`, 'id-ID', { numeric: true }));
  }

  function renderForecastSetup() {
    const state = forecastState;
    modal(`<section class="ps-modal ps-forecast-modal"><header><div><span>FORECAST PERIODIC SERVICE</span><h3>Forecast PA</h3><p>Proyeksi tanggal service dari sisa HM dan EWH harian. Hasil ini tidak membuat Work Order atau Breakdown.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-forecast-steps"><b class="is-active">1 · Konteks</b><span>2 · EWH Unit</span><span>3 · Forecast PA</span></div><form id="psForecastSetupForm" class="ps-form-grid"><label>Range mulai<input name="date_from" type="date" value="${esc(state.dateFrom)}" required></label><label>Range selesai<input name="date_to" type="date" value="${esc(state.dateTo)}" required></label><label class="is-wide">Sumber estimasi EWH<select name="source"><option value="mine_plan"${state.source === 'mine_plan' ? ' selected' : ''}>Forecast Mine Plan · halaman 0.4 PA, UA & EWH</option><option value="manual"${state.source === 'manual' ? ' selected' : ''}>Input Manual · EWH jam/hari per unit</option></select></label><div class="ps-forecast-definition is-wide"><b>Pemisahan formula</b><span>EWH memproyeksikan pertambahan HM dan tanggal due. Forecast PA hanya mengurangi MOHH 24 jam dengan downtime PS.</span><code>PA periode = (Σ MOHH − Σ jam PS) / Σ MOHH</code></div></form><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="button" class="tombol tombol--utama" onclick="lanjutForecastPaPeriodicService(this)">Lanjutkan</button></footer></section>`);
  }

  function renderForecastManual() {
    const groups = forecastGroups(psData.units.map(unit => ({ equipmentId: unit.id, unitCode: unit.kode_alat, equipmentClass: unit.kelas_alat, equipmentModel: unitModel(unit) })));
    const rows = groups.map(group => `<tr class="ps-forecast-group"><th colspan="3">${esc(group.equipmentClass)} · ${esc(group.equipmentModel)}</th></tr>${group.rows.map(row => `<tr><td><strong>${esc(row.unitCode)}</strong></td><td>${esc(row.equipmentModel)}</td><td><input data-forecast-ewh="${esc(row.equipmentId)}" type="number" min="0" max="24" step="0.01" value="${esc(forecastState.manualEwh[row.equipmentId] ?? '')}" placeholder="Jam/hari"></td></tr>`).join('')}`).join('');
    modal(`<section class="ps-modal ps-forecast-modal"><header><div><span>FORECAST PERIODIC SERVICE</span><h3>Input Manual EWH</h3><p>Isi estimasi jam operasi efektif per hari untuk setiap unit.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-forecast-steps"><span>1 · Konteks</span><b class="is-active">2 · EWH Unit</b><span>3 · Forecast PA</span></div><div class="ps-forecast-quick"><label>Input cepat seluruh unit<input id="psForecastQuickEwh" type="number" min="0" max="24" step="0.01" placeholder="Contoh: 14"></label><button type="button" class="tombol" onclick="terapkanEwhCepatForecastPa()">Terapkan ke Semua</button></div><div class="tabel-wrap ps-forecast-manual-table"><table class="tabel"><thead><tr><th>Unit</th><th>Tipe Model</th><th>EWH Jam/Hari</th></tr></thead><tbody>${rows}</tbody></table></div><footer><button type="button" class="tombol" onclick="kembaliSetupForecastPa()">Kembali</button><button type="button" class="tombol tombol--utama" onclick="prosesForecastPaPeriodicService(this)">Proses Forecast</button></footer></section>`);
  }

  function forecastDayCell(day) {
    if (day.pa === null) return '<td class="is-missing" title="EWH atau Estimasi Pekerjaan belum lengkap">—<small>Data belum lengkap</small></td>';
    const events = (day.events || []).map(event => `<small class="ps-forecast-event ${esc(event.source)}">${esc(event.serviceCode)} · ${number(event.durationHours)}j</small>`).join('');
    return `<td class="${events ? 'is-service' : ''}"><b>${number(day.pa, 2)}%</b>${events}</td>`;
  }

  function renderForecastResult() {
    const result = forecastState.result;
    const completeRows = result.rows.filter(row => row.complete);
    const totalMohh = completeRows.reduce((sum, row) => sum + Number(row.totalMohh || 0), 0);
    const totalDowntime = completeRows.reduce((sum, row) => sum + Number(row.totalDowntimeHours || 0), 0);
    const aggregatePa = totalMohh > 0 ? ((totalMohh - totalDowntime) / totalMohh) * 100 : null;
    const eventCount = result.rows.reduce((sum, row) => sum + row.days.reduce((daySum, day) => daySum + day.events.length, 0), 0);
    const headers = result.dates.map(date => `<th>${esc(date.slice(8, 10))}<small>${esc(new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { month: 'short' }))}</small></th>`).join('');
    const groups = forecastGroups(result.rows);
    const body = groups.map(group => `<tr class="ps-forecast-group"><th colspan="${result.dates.length + 6}">${esc(group.equipmentClass)} · ${esc(group.equipmentModel)} · ${group.rows.length} unit</th></tr>${group.rows.map(row => {
      const ewhValues = row.days.map(day => Number(day.ewh)).filter(Number.isFinite);
      const avgEwh = ewhValues.length ? ewhValues.reduce((sum, value) => sum + value, 0) / ewhValues.length : null;
      return `<tr><td class="ps-forecast-unit"><strong>${esc(row.unitCode)}</strong><small>HM ${number(row.currentHm)} · ${esc(row.hmDate || '—')}</small></td><td>${esc(row.serviceCode || 'Belum setup')}<small>Next ${number(row.nextDueHm)} HM</small></td><td>${avgEwh === null ? '—' : `${number(avgEwh)} Jam`}<small>${result.source === 'mine_plan' ? esc(row.sourceJob || 'JOB belum dipetakan') : 'Manual'}</small></td>${row.days.map(forecastDayCell).join('')}<td class="ps-forecast-period"><strong>${row.periodPa === null ? '—' : `${number(row.periodPa, 2)}%`}</strong><small>BD ${number(row.totalDowntimeHours)} jam</small></td></tr>`;
    }).join('')}`).join('');
    modal(`<section class="ps-modal ps-forecast-modal ps-forecast-result"><header><div><span>FORECAST PERIODIC SERVICE</span><h3>Forecast PA · ${esc(result.period.dateFrom)} s.d. ${esc(result.period.dateTo)}</h3><p>${esc(result.formula)}</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-forecast-steps"><span>1 · Konteks</span><span>2 · EWH Unit</span><b class="is-active">3 · Forecast PA</b></div><div class="ps-forecast-kpis"><article><small>Unit</small><strong>${result.rows.length}</strong></article><article><small>Data Lengkap</small><strong>${completeRows.length}/${result.rows.length}</strong></article><article><small>Event PS</small><strong>${eventCount}</strong></article><article><small>Forecast PA Gabungan</small><strong>${aggregatePa === null ? '—' : `${number(aggregatePa, 2)}%`}</strong></article></div><div class="tabel-wrap ps-forecast-grid"><table class="tabel"><thead><tr><th>Unit</th><th>Next Service</th><th>EWH</th>${headers}<th>PA Periode</th></tr></thead><tbody>${body}</tbody></table></div><p class="ps-help"><b>Lineage:</b> ${result.source === 'mine_plan' ? 'EWH diturunkan dari PA unit dan SPO JOB halaman 0.4.' : 'EWH berasal dari input manual wizard.'} Durasi aktual Work Order mengalahkan Estimasi Pekerjaan Area Setup. Forecast tidak menulis Breakdown.</p><footer><button type="button" class="tombol" onclick="kembaliSetupForecastPa()">Ubah Parameter</button><button type="button" class="tombol tombol--utama" onclick="tutupModalGenerik()">Tutup</button></footer></section>`);
  }

  global.bukaForecastPaPeriodicService = function bukaForecastPaPeriodicService() {
    const range = defaultForecastRange();
    forecastState = { ...range, source: 'mine_plan', manualEwh: {}, result: null };
    renderForecastSetup();
  };

  global.kembaliSetupForecastPa = function kembaliSetupForecastPa() { renderForecastSetup(); };

  global.lanjutForecastPaPeriodicService = function lanjutForecastPaPeriodicService(button) {
    const form = document.getElementById('psForecastSetupForm');
    if (!form?.reportValidity()) return;
    if (form.date_from.value > form.date_to.value) return alert('Tanggal selesai tidak boleh lebih awal dari tanggal mulai.');
    forecastState.dateFrom = form.date_from.value;
    forecastState.dateTo = form.date_to.value;
    forecastState.source = form.source.value;
    if (forecastState.source === 'manual') renderForecastManual();
    else void global.prosesForecastPaPeriodicService(button);
  };

  global.terapkanEwhCepatForecastPa = function terapkanEwhCepatForecastPa() {
    const quick = document.getElementById('psForecastQuickEwh');
    const value = Number(quick?.value);
    if (!Number.isFinite(value) || value < 0 || value > 24) return alert('Input cepat EWH harus 0–24 jam/hari.');
    document.querySelectorAll('[data-forecast-ewh]').forEach(input => { input.value = String(value); });
  };

  global.prosesForecastPaPeriodicService = async function prosesForecastPaPeriodicService(button) {
    if (forecastState.source === 'manual') {
      const inputs = [...document.querySelectorAll('[data-forecast-ewh]')];
      const missing = inputs.find(input => input.value === '');
      if (missing) { missing.focus(); return alert('Lengkapi EWH manual seluruh unit atau gunakan Input Cepat.'); }
      forecastState.manualEwh = Object.fromEntries(inputs.map(input => [input.dataset.forecastEwh, input.value]));
    }
    const original = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Menghitung…'; }
    try {
      forecastState.result = await request('/api/admin/production/periodic-service/forecast-pa', { method: 'POST', body: JSON.stringify({
        date_from: forecastState.dateFrom, date_to: forecastState.dateTo, source: forecastState.source, manual_ewh: forecastState.manualEwh
      }) });
      renderForecastResult();
    } catch (error) {
      alert(`Gagal membuat Forecast PA: ${error.message}`);
    } finally {
      if (button?.isConnected) { button.disabled = false; button.textContent = original; }
    }
  };

  global.bukaModalPolicyPeriodicService = function (equipmentId) {
    const unit = unitById(equipmentId); if (!unit) return;
    modal(`<form id="psPolicyForm" class="ps-modal"><header><div><h3>Atur Interval · ${esc(unit.kode_alat)}</h3><p>Baseline adalah meter HM service terakhir sebelum modul digunakan.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-form-grid"><label>Interval service (HM)<input name="interval_hm" type="number" min="0.001" step="0.001" value="${esc(unit.interval_hm || 250)}" required></label><label>Warning sebelum due (HM)<input name="warning_hm" type="number" min="0" step="0.001" value="${esc(unit.warning_hm ?? 50)}" required></label><label>Baseline HM<input name="baseline_hm" type="number" min="0" step="0.001" value="${esc(unit.baseline_hm ?? unit.current_hm ?? 0)}" required></label><label>Status<select name="is_enabled"><option value="true"${unit.is_enabled !== false ? ' selected' : ''}>Aktif</option><option value="false"${unit.is_enabled === false ? ' selected' : ''}>Nonaktif</option></select></label><p class="ps-help is-wide">HM aktual read-only: <b>${number(unit.current_hm)}</b>, bersumber dari HM Akhir terbaru pada Input Data.</p></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button class="tombol tombol--utama" type="submit">Simpan Policy</button></footer></form>`);
    document.getElementById('psPolicyForm').addEventListener('submit', event => runWrite(event, async form => request(`/api/admin/production/periodic-service/policies/${encodeURIComponent(equipmentId)}`, { method: 'PUT', body: JSON.stringify({ interval_hm: form.interval_hm.value, warning_hm: form.warning_hm.value, baseline_hm: form.baseline_hm.value, is_enabled: form.is_enabled.value === 'true', revision: unit.revision || undefined }) })));
  };

  function modelOptionValue(equipmentClass, model) { return encodeURIComponent(JSON.stringify({ equipmentClass, model })); }
  function modelOptions(selectedClass = '', selectedModel = '') {
    const groups = new Map();
    psData.units.forEach(unit => {
      const equipmentClass = String(unit.kelas_alat || 'Tanpa Jenis').trim();
      const model = unitModel(unit);
      if (!groups.has(equipmentClass)) groups.set(equipmentClass, new Set());
      groups.get(equipmentClass).add(model);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'id-ID')).map(([equipmentClass, models]) => `<optgroup label="${esc(equipmentClass)}">${[...models].sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true })).map(model => {
      const selected = normalized(equipmentClass) === normalized(selectedClass) && normalized(model) === normalized(selectedModel);
      return `<option value="${modelOptionValue(equipmentClass, model)}"${selected ? ' selected' : ''}>${esc(model)}</option>`;
    }).join('')}</optgroup>`).join('');
  }
  const packageItemTypes = [
    ['task', 'Task / Pekerjaan'],
    ['part', 'Sparepart'],
    ['lubricant', 'Oli / Lubricant'],
    ['consumable', 'Consumable'],
    ['other', 'Lainnya']
  ];
  let packageItemSequence = 0;
  function packageItemRow(item = {}) {
    packageItemSequence += 1;
    return `<div class="ps-package-item-row" data-package-item-row="${packageItemSequence}">
      <label>Jenis<select name="package_item_type">${packageItemTypes.map(([value, label]) => `<option value="${value}"${String(item.item_type || 'task') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="ps-package-item-name">Nama item / pekerjaan<input name="package_item_name" value="${esc(item.item_name || '')}" placeholder="Contoh: Engine Oil 15W-40" required></label>
      <label>Qty<input name="package_item_qty" type="number" min="0.001" step="0.001" value="${esc(item.planned_qty ?? '')}" placeholder="Opsional"></label>
      <label>Satuan<input name="package_item_uom" value="${esc(item.uom || '')}" placeholder="Liter / Pcs"></label>
      <button type="button" class="tombol ps-package-item-remove" onclick="hapusBarisItemPaketPeriodicService(this)" aria-label="Hapus item">Hapus</button>
    </div>`;
  }
  global.tambahBarisItemPaketPeriodicService = function tambahBarisItemPaketPeriodicService() {
    document.getElementById('psPackageItems')?.insertAdjacentHTML('beforeend', packageItemRow());
  };
  global.hapusBarisItemPaketPeriodicService = function hapusBarisItemPaketPeriodicService(button) {
    const row = button.closest('[data-package-item-row]');
    const root = row?.parentElement;
    if (!row || !root) return;
    if (root.querySelectorAll('[data-package-item-row]').length === 1) {
      row.querySelector('[name="package_item_type"]').value = 'task';
      row.querySelectorAll('input').forEach(input => { input.value = ''; });
      row.querySelector('[name="package_item_name"]').focus();
      return;
    }
    row.remove();
  };
  function collectPackageItems(form) {
    const items = [...form.querySelectorAll('[data-package-item-row]')].map((row, index) => {
      const itemType = row.querySelector('[name="package_item_type"]')?.value || 'task';
      const itemName = row.querySelector('[name="package_item_name"]')?.value.trim() || '';
      const plannedQty = row.querySelector('[name="package_item_qty"]')?.value.trim() || '';
      const uom = row.querySelector('[name="package_item_uom"]')?.value.trim() || '';
      if (!itemName) throw new Error(`Nama item / pekerjaan baris ${index + 1} wajib diisi.`);
      return { item_type: itemType, item_name: itemName, planned_qty: plannedQty || null, uom: uom || null };
    });
    if (!items.length) throw new Error('Paket service minimal memiliki satu task, sparepart, atau oli.');
    return items;
  }
  global.bukaModalAreaSetupPeriodicService = function (packageId = '', selectedClass = '', selectedModel = '') {
    const existing = packageId ? packageById(packageId) : null;
    if (packageId && !existing) return;
    packageItemSequence = 0;
    const equipmentClass = existing?.equipment_class || selectedClass;
    const equipmentModel = existing?.equipment_model || selectedModel;
    const itemRows = (existing?.items?.length ? existing.items : [{}]).map(item => packageItemRow(item)).join('');
    modal(`<form id="psPackageForm" class="ps-modal"><header><div><h3>${existing ? 'Edit' : 'Area Setup'} Periodic Service</h3><p>Setup berlaku untuk semua unit dengan Jenis Equipment dan Tipe Model yang sama. Penyimpanan edit membuat versi baru agar histori WO tetap utuh.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-form-grid"><label>TIPE MODEL<select name="model_scope" required><option value="">Pilih Tipe Model</option>${modelOptions(equipmentClass, equipmentModel)}</select></label><label>Periode Service / Cycle HM<input name="cycle_hm" type="number" min="0.001" step="0.001" value="${esc(existing?.cycle_hm ?? '')}" placeholder="250" required></label><label>Estimasi Pekerjaan (Jam)<input name="estimated_duration_hours" type="number" min="0.001" max="24" step="0.001" value="${esc(existing?.estimated_duration_hours ?? '')}" placeholder="Contoh: 1.5" required><small>Acuan Forecast PA; tidak mengunci waktu aktual service.</small></label><label>Kode Paket<input name="service_code" value="${esc(existing?.service_code || '')}" placeholder="PS250" required></label><label>Nama Paket<input name="service_name" value="${esc(existing?.service_name || '')}" placeholder="Service 250 HM" required></label><div class="is-wide ps-package-items-section"><div class="ps-package-items-title"><div><strong>Task / Sparepart / Oli</strong><small>Tambahkan kebutuhan service satu per satu. Tidak perlu lagi menggunakan format atau tanda pemisah khusus.</small></div><button type="button" class="tombol" onclick="tambahBarisItemPaketPeriodicService()">+ Tambah Item</button></div><div id="psPackageItems" class="ps-package-items">${itemRows}</div></div><p class="ps-help is-wide"><b>Rule HM:</b> cycle terkecil menjadi cadence. Pada milestone yang beririsan, paket dengan cycle terbesar digunakan. Estimasi hanya untuk forecast; realisasi tetap memakai waktu Mulai–Selesai dari user.</p></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">${existing ? 'Simpan Perubahan' : 'Simpan Area Setup'}</button></footer></form>`);
    document.getElementById('psPackageForm').addEventListener('submit', event => runWrite(event, async form => {
      const items = collectPackageItems(event.currentTarget);
      const scope = JSON.parse(decodeURIComponent(form.model_scope.value));
      const path = existing ? `/api/admin/production/periodic-service/packages/${encodeURIComponent(existing.id)}` : '/api/admin/production/periodic-service/packages';
      return request(path, { method: existing ? 'PUT' : 'POST', body: JSON.stringify({ equipment_class: scope.equipmentClass, equipment_model: scope.model, cycle_hm: form.cycle_hm.value, estimated_duration_hours: form.estimated_duration_hours.value, service_code: form.service_code.value, service_name: form.service_name.value, items }) });
    }));
  };
  global.bukaAreaSetupPeriodicServiceScope = function bukaAreaSetupPeriodicServiceScope(equipmentClass, equipmentModel) {
    global.bukaModalAreaSetupPeriodicService('', decodeURIComponent(equipmentClass), decodeURIComponent(equipmentModel));
  };
  global.bukaModalPaketPeriodicService = global.bukaModalAreaSetupPeriodicService;

  global.bukaDetailPaketPeriodicService = function bukaDetailPaketPeriodicService(packageId) {
    const pack = packageById(packageId); if (!pack) return;
    modal(`<section class="ps-modal ps-package-detail"><header><div><span>TIPE MODEL · ${esc(pack.equipment_class)}</span><h3>${esc(pack.equipment_model)} · ${esc(pack.service_code)}</h3><p>${esc(pack.service_name)} · ${number(pack.cycle_hm, 0)} HM · Estimasi ${number(pack.estimated_duration_hours)} Jam · versi ${esc(pack.version)}</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="tabel-wrap"><table class="tabel"><thead><tr><th>Jenis</th><th>Task / Part / Oli</th><th>Qty</th><th>Satuan</th></tr></thead><tbody>${(pack.items || []).map(item => `<tr><td>${esc(item.item_type)}</td><td><strong>${esc(item.item_name)}</strong></td><td>${item.planned_qty == null ? '—' : number(item.planned_qty)}</td><td>${esc(item.uom || '—')}</td></tr>`).join('')}</tbody></table></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Tutup</button><button type="button" class="tombol tombol--utama" onclick="bukaModalAreaSetupPeriodicService('${esc(pack.id)}')">Edit Setup</button></footer></section>`);
  };

  let serviceExtraSequence = 0;
  function serviceExtraItemRow() {
    serviceExtraSequence += 1;
    return `<div class="ps-package-item-row" data-service-extra-row="${serviceExtraSequence}">
      <label>Jenis<select name="service_extra_type">${packageItemTypes.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label class="ps-package-item-name">Nama tambahan<input name="service_extra_name" placeholder="Part atau pekerjaan tambahan" required></label>
      <label>Qty<input name="service_extra_qty" type="number" min="0.001" step="0.001" placeholder="Opsional"></label>
      <label>Satuan<input name="service_extra_uom" placeholder="Liter / Pcs"></label>
      <button type="button" class="tombol ps-package-item-remove" onclick="this.closest('[data-service-extra-row]').remove()" aria-label="Hapus kebutuhan tambahan">Hapus</button>
    </div>`;
  }
  global.tambahKebutuhanServiceTambahan = function tambahKebutuhanServiceTambahan() {
    document.getElementById('psServiceExtraItems')?.insertAdjacentHTML('beforeend', serviceExtraItemRow());
  };
  function collectServiceExtraItems(form) {
    return [...form.querySelectorAll('[data-service-extra-row]')].map((row, index) => {
      const itemName = row.querySelector('[name="service_extra_name"]')?.value.trim() || '';
      if (!itemName) throw new Error(`Nama kebutuhan tambahan baris ${index + 1} wajib diisi.`);
      const plannedQty = row.querySelector('[name="service_extra_qty"]')?.value.trim() || '';
      return {
        item_type: row.querySelector('[name="service_extra_type"]')?.value || 'task',
        item_name: itemName,
        planned_qty: plannedQty || null,
        uom: row.querySelector('[name="service_extra_uom"]')?.value.trim() || null
      };
    });
  }

  global.gantiPaketOrderPeriodicService = function gantiPaketOrderPeriodicService(packageId, equipmentId) {
    const pack = packageById(packageId);
    const unit = unitById(decodeURIComponent(equipmentId));
    if (!pack || !unit) return;
    const summaryCode = document.getElementById('psOrderSummaryCode');
    if (summaryCode) summaryCode.textContent = pack.service_code;
    const summaryCycle = document.getElementById('psOrderSummaryCycle');
    if (summaryCycle) summaryCycle.textContent = `${number(pack.cycle_hm, 0)} HM`;
    const summaryDuration = document.getElementById('psOrderSummaryDuration');
    if (summaryDuration) summaryDuration.textContent = `${number(pack.estimated_duration_hours)} Jam`;
    const targetHmInput = document.getElementById('psOrderDueHm');
    if (targetHmInput && !targetHmInput.dataset.userEdited) {
      targetHmInput.value = unit.due?.nextDueHm ?? pack.cycle_hm;
    }
    const setupRows = (pack.items || []).map(item => `<tr><td>${esc(item.item_type)}</td><td><strong>${esc(item.item_name)}</strong></td><td>${item.planned_qty == null ? '—' : number(item.planned_qty)}</td><td>${esc(item.uom || '—')}</td></tr>`).join('');
    const setupTableBody = document.getElementById('psOrderSetupItemsBody');
    if (setupTableBody) {
      setupTableBody.innerHTML = setupRows || '<tr><td colspan="4" class="tabel__kosong">Tidak ada kebutuhan pada setup.</td></tr>';
    }
  };

  global.bukaModalOrderPeriodicService = function (equipmentId) {
    const unit = unitById(equipmentId);
    if (!unit) return;
    const availablePacks = packagesForUnit(equipmentId);
    if (!availablePacks.length) {
      modal(`<section class="ps-modal"><header><div><h3>Service · ${esc(unit.kode_alat)}</h3><p>Unit belum memiliki Area Setup Periodic Service untuk tipe model ${esc(unitModel(unit))}.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><p class="ps-warning">Buat periode service dan kebutuhan model terlebih dahulu sebelum menjadwalkan unit.</p><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Tutup</button><button type="button" class="tombol tombol--utama" onclick="bukaAreaSetupPeriodicServiceScope('${inlineArg(unit.kelas_alat)}','${inlineArg(unitModel(unit))}')">Buka Area Setup</button></footer></section>`);
      return;
    }
    const selectedPackId = availablePacks.some(p => String(p.id) === String(unit?.due?.packageId))
      ? String(unit.due.packageId)
      : String(availablePacks[0].id);
    const pack = packageById(selectedPackId) || availablePacks[0];
    serviceExtraSequence = 0;
    const setupRows = (pack.items || []).map(item => `<tr><td>${esc(item.item_type)}</td><td><strong>${esc(item.item_name)}</strong></td><td>${item.planned_qty == null ? '—' : number(item.planned_qty)}</td><td>${esc(item.uom || '—')}</td></tr>`).join('');
    modal(`<form id="psOrderForm" class="ps-modal ps-service-schedule"><header><div><span>REALISASI PERIODIC SERVICE</span><h3>Service · ${esc(unit.kode_alat)}</h3><p>Interval mulai–selesai dicatat sebagai Breakdown PS dan masuk perhitungan jam breakdown/MOHH.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-service-summary"><article><small>Periode Service</small><strong id="psOrderSummaryCode">${esc(pack.service_code)}</strong><span id="psOrderSummaryCycle">${number(pack.cycle_hm, 0)} HM</span></article><article><small>Estimasi Pekerjaan</small><strong id="psOrderSummaryDuration">${number(pack.estimated_duration_hours)} Jam</strong><span>Acuan forecast, bukan pengunci aktual</span></article><article><small>Milestone</small><strong>${number(unit.due.nextDueHm)} HM</strong><span>Sisa ${number(unit.due.remainingHm)} HM</span></article><article><small>Tipe Model</small><strong>${esc(unitModel(unit))}</strong><span>${esc(unit.kelas_alat || '—')}</span></article></div><div class="ps-form-grid"><label class="is-wide">Periode Service / Target Paket<select name="package_id" id="psOrderPackageSelect" onchange="gantiPaketOrderPeriodicService(this.value, '${inlineArg(unit.id)}')" required>${availablePacks.map(p => `<option value="${esc(p.id)}"${String(p.id) === String(pack.id) ? ' selected' : ''}>${esc(p.service_code)} — ${number(p.cycle_hm, 0)} HM (${esc(p.service_name || '')})</option>`).join('')}</select></label><label>Target HM Servis<input name="due_hm" id="psOrderDueHm" type="number" min="0" step="0.001" value="${esc(unit.due?.nextDueHm ?? pack.cycle_hm)}" oninput="this.dataset.userEdited='true'" required></label><label>Mulai Service<input name="actual_start" type="datetime-local" value="${dateInput(new Date(Date.now() - 3600000))}" required></label><label>Selesai Service<input name="actual_finish" type="datetime-local" value="${dateInput()}" required></label><label>Shift Service<select name="shift_id" required><option value="">Pilih Shift</option>${shiftOptions()}</select></label><label>HM Saat Service<input name="actual_service_hm" type="number" min="0" step="0.001" value="${esc(unit.current_hm ?? '')}" required></label><p class="ps-warning is-wide">Selesai service harus sudah terjadi. Sistem menghitung durasi aktual dari timestamp mulai–selesai; Estimasi Pekerjaan tidak mengubah input user dan hanya dipakai Forecast PA.</p><div class="is-wide ps-service-requirements"><div><strong>Part / Task dari Area Setup</strong><small>Snapshot kebutuhan ini dikunci ke realisasi service.</small></div><div class="tabel-wrap"><table class="tabel"><thead><tr><th>Jenis</th><th>Part / Task</th><th>Qty</th><th>Satuan</th></tr></thead><tbody id="psOrderSetupItemsBody">${setupRows || '<tr><td colspan="4" class="tabel__kosong">Tidak ada kebutuhan pada setup.</td></tr>'}</tbody></table></div></div><div class="is-wide ps-package-items-section"><div class="ps-package-items-title"><div><strong>Part / Task Tambahan</strong><small>Opsional, hanya berlaku untuk realisasi unit ini.</small></div><button type="button" class="tombol" onclick="tambahKebutuhanServiceTambahan()">+ Tambah Part / Task</button></div><div id="psServiceExtraItems" class="ps-package-items"></div></div><label class="is-wide">Catatan / Temuan Service<textarea name="notes" rows="3" placeholder="Catatan pelaksanaan service atau temuan kendala unit"></textarea></label></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan & Catat Breakdown PS</button></footer></form>`);
    document.getElementById('psOrderForm').addEventListener('submit', event => runWrite(event, form => {
      const additionalItems = collectServiceExtraItems(event.currentTarget);
      const startVal = form.actual_start.value;
      let finishVal = form.actual_finish.value;
      const startDate = new Date(startVal);
      let finishDate = new Date(finishVal);
      if (finishDate <= startDate) {
        throw new Error('Selesai service harus lebih akhir dari mulai service.');
      }
      if (finishDate.getTime() > Date.now() + 60000) {
        const finishMinus12h = new Date(finishDate.getTime() - 12 * 3600000);
        if (finishMinus12h > startDate && finishMinus12h <= new Date()) {
          const hours = ((finishMinus12h - startDate) / 3600000).toFixed(1);
          const useAm = confirm(`Waktu selesai (${finishVal.replace('T', ' ')}) terdeteksi di masa depan.\nApakah Anda bermaksud jam selesai ${finishMinus12h.getHours().toString().padStart(2, '0')}:${finishMinus12h.getMinutes().toString().padStart(2, '0')} (AM / Siang, durasi ${hours} jam)?\n\nKlik OK untuk menggunakan AM.\nKlik Cancel untuk tetap menggunakan waktu yang diinput.`);
          if (useAm) {
            finishDate = finishMinus12h;
            form.actual_finish.value = dateInput(finishDate);
          }
        }
      }
      return request('/api/admin/production/periodic-service/orders', { method: 'POST', body: JSON.stringify({ equipment_id: equipmentId, package_id: form.package_id.value, due_hm: form.due_hm.value, actual_start: startDate.toISOString(), actual_finish: finishDate.toISOString(), shift_id: form.shift_id.value, actual_service_hm: form.actual_service_hm.value, notes: form.notes.value, additional_items: additionalItems }) });
    }));
  };

  function shiftOptions() { return (psData.shifts || []).map(shift => `<option value="${esc(shift.id)}">${esc(shift.nama_shift || 'Shift')}</option>`).join(''); }
  global.bukaModalMulaiPeriodicService = function (orderId) {
    const order = orderById(orderId);
    modal(`<form id="psStartForm" class="ps-modal"><header><div><h3>Mulai Periodic Service · ${esc(order.kode_alat)}</h3><p>Sistem akan membuat Breakdown aktif dengan kode PS.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-form-grid"><label>Waktu Mulai<input name="started_at" type="datetime-local" value="${dateInput()}" required></label><label>Shift<select name="shift_id" required><option value="">Pilih Shift</option>${shiftOptions()}</select></label><label class="is-wide">Catatan<textarea name="note" rows="3"></textarea></label><p class="ps-warning is-wide">Setelah dimulai, unit berstatus BD dan jam PS masuk komponen MOHH.</p></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Mulai & Generate PS</button></footer></form>`);
    document.getElementById('psStartForm').addEventListener('submit', event => runWrite(event, form => request(`/api/admin/production/periodic-service/orders/${encodeURIComponent(orderId)}/start`, { method: 'POST', body: JSON.stringify({ started_at: new Date(form.started_at.value).toISOString(), shift_id: form.shift_id.value, note: form.note.value }) })));
  };

  global.bukaModalSelesaiPeriodicService = function (orderId) {
    const order = orderById(orderId);
    modal(`<form id="psCompleteForm" class="ps-modal"><header><div><h3>Selesaikan PS · ${esc(order.kode_alat)}</h3><p>Waktu selesai menutup Breakdown PS dan melepaskan unit Ready bila tidak ada BD lain.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-form-grid"><label>Waktu Selesai<input name="finished_at" type="datetime-local" value="${dateInput()}" required></label><label>HM Saat Service<input name="actual_service_hm" type="number" min="0" step="0.001" required></label><label class="is-wide">Catatan Realisasi<textarea name="note" rows="2"></textarea></label><label class="is-wide">Temuan (opsional)<textarea name="finding" rows="2" placeholder="Contoh: kebocoran ringan pada hose boom"></textarea></label><label>Severity<select name="severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Tindak Lanjut<select name="follow_up_type"><option value="monitor">Monitor</option><option value="planned_repair">Planned Repair</option><option value="create_breakdown">Create Breakdown</option><option value="stop_unit">Stop Unit</option></select></label></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Selesaikan Service</button></footer></form>`);
    document.getElementById('psCompleteForm').addEventListener('submit', event => runWrite(event, form => request(`/api/admin/production/periodic-service/orders/${encodeURIComponent(orderId)}/complete`, { method: 'POST', body: JSON.stringify({ finished_at: new Date(form.finished_at.value).toISOString(), actual_service_hm: form.actual_service_hm.value, note: form.note.value, findings: form.finding.value.trim() ? [{ description: form.finding.value, severity: form.severity.value, follow_up_type: form.follow_up_type.value }] : [] }) })));
  };

  global.bukaModalEditPeriodicService = function (orderId) {
    const order = orderById(orderId);
    if (!order) return;
    const unit = unitById(order.equipment_id);
    const availablePacks = packagesForUnit(order.equipment_id);
    const currentPackId = String(order.package_id || '');
    const packOptions = availablePacks.length
      ? availablePacks.map(p => `<option value="${esc(p.id)}"${String(p.id) === currentPackId ? ' selected' : ''}>${esc(p.service_code)} — ${number(p.cycle_hm, 0)} HM (${esc(p.service_name || '')})</option>`).join('')
      : `<option value="${esc(order.package_id || '')}" selected>${esc(order.service_code || 'PS')}</option>`;

    modal(`<form id="psEditOrderForm" class="ps-modal ps-service-schedule"><header><div><span>EDIT REALISASI PERIODIC SERVICE</span><h3>Edit Service · ${esc(order.kode_alat)}</h3><p>Ubah parameter riwayat servis unit ini.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-form-grid"><label class="is-wide">Kode Unit<input value="${esc(order.kode_alat)} (${esc(unit?.kelas_alat || order.kelas_alat || '—')})" disabled readonly></label><label class="is-wide">Periode Service / Target Paket<select name="package_id">${packOptions}</select></label><label>Target HM Servis<input name="due_hm" type="number" min="0" step="0.001" value="${esc(order.due_hm ?? '')}" required></label><label>HM Saat Service<input name="actual_service_hm" type="number" min="0" step="0.001" value="${esc(order.actual_service_hm ?? '')}" required></label><label>Mulai Service<input name="actual_start" type="datetime-local" value="${dateInput(order.actual_start ? new Date(order.actual_start) : (order.scheduled_start ? new Date(order.scheduled_start) : new Date()))}" required></label><label>Selesai Service<input name="actual_finish" type="datetime-local" value="${dateInput(order.actual_finish ? new Date(order.actual_finish) : new Date())}" required></label><label>Shift Service<select name="shift_id">${shiftOptions()}</select></label><label class="is-wide">Catatan / Temuan Service<textarea name="notes" rows="3" placeholder="Catatan atau temuan service">${esc(order.notes || '')}</textarea></label></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Perubahan</button></footer></form>`);

    const shiftSelect = document.querySelector('#psEditOrderForm select[name="shift_id"]');
    if (shiftSelect && order.shift_id) shiftSelect.value = order.shift_id;

    document.getElementById('psEditOrderForm').addEventListener('submit', event => runWrite(event, form => {
      return request(`/api/admin/production/periodic-service/orders/${encodeURIComponent(orderId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          package_id: form.package_id.value,
          due_hm: form.due_hm.value,
          actual_service_hm: form.actual_service_hm.value,
          actual_start: new Date(form.actual_start.value).toISOString(),
          actual_finish: new Date(form.actual_finish.value).toISOString(),
          shift_id: form.shift_id.value || null,
          notes: form.notes.value
        })
      });
    }));
  };

  global.konfirmasiHapusPeriodicService = function (orderId, kodeAlat) {
    modal(`<section class="ps-modal"><header><div><span>KONFIRMASI PENGHAPUSAN</span><h3>Hapus Riwayat Service · ${esc(kodeAlat)}</h3><p>Tindakan ini akan menghapus permanen record service dan log breakdown terkait.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-warning is-wide"><p><b>Peringatan:</b> Seluruh riwayat pelaksanaan service, snapshot kebutuhan, log breakdown PS, serta temuan terkait work order ini akan dihapus dari database secara menyeluruh.</p></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="button" id="btnConfirmDeletePs" class="tombol tombol--bahaya" onclick="eksekusiHapusPeriodicService('${esc(orderId)}')">Ya, Hapus Menyeluruh</button></footer></section>`);
  };

  global.eksekusiHapusPeriodicService = async function (orderId) {
    const button = document.getElementById('btnConfirmDeletePs');
    try {
      await global.OMOSActionFeedback.run(button, async () => {
        await request(`/api/admin/production/periodic-service/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
        psData.orders = (psData.orders || []).filter(order => String(order.id) !== String(orderId));
      });
      closeModal();
      await global.muatPeriodicService();
      if (typeof global.muatProdBreakdown === 'function') void global.muatProdBreakdown();
    } catch (error) {
      alert(`Gagal menghapus riwayat service: ${error.message}`);
    }
  };

  global.bukaModalKoreksiPeriodicService = function (orderId) {
    const order = orderById(orderId);
    modal(`<form id="psCorrectionForm" class="ps-modal"><header><div><h3>Koreksi Durasi PS · ${esc(order.kode_alat)}</h3><p>Koreksi waktu tersimpan pada audit; durasi tidak diketik langsung.</p></div><button type="button" class="tombol" onclick="tutupModalGenerik()">×</button></header><div class="ps-form-grid"><label>Mulai<input name="started_at" type="datetime-local" value="${dateInput(new Date(order.actual_start))}" required></label><label>Selesai<input name="finished_at" type="datetime-local" value="${dateInput(new Date(order.actual_finish))}" required></label><label class="is-wide">Alasan Koreksi<textarea name="reason" rows="3" required></textarea></label><p class="ps-warning is-wide">Selisih yang dikurangi dari PS harus direkonsiliasi sebagai HM, Standby, BD lain, atau gap MOHH. Sistem tidak memindahkannya diam-diam.</p></div><footer><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Koreksi</button></footer></form>`);
    document.getElementById('psCorrectionForm').addEventListener('submit', event => runWrite(event, form => request(`/api/admin/production/periodic-service/orders/${encodeURIComponent(orderId)}/time`, { method: 'PATCH', body: JSON.stringify({ started_at: new Date(form.started_at.value).toISOString(), finished_at: new Date(form.finished_at.value).toISOString(), reason: form.reason.value }) })));
  };

  global.updatePeriodicFinding = async function (id, status, button) {
    try { await global.OMOSActionFeedback.run(button, () => request(`/api/admin/production/periodic-service/findings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) })); await global.muatPeriodicService(); }
    catch (error) { alert(error.message); }
  };

  async function runWrite(event, action) {
    event.preventDefault(); const form = event.currentTarget; const button = event.submitter;
    try {
      await global.OMOSActionFeedback.run(button, () => action(form.elements));
      closeModal(); await global.muatPeriodicService();
      if (typeof global.muatProdBreakdown === 'function') void global.muatProdBreakdown();
    } catch (error) { alert(error.message); }
  }
})(window);
