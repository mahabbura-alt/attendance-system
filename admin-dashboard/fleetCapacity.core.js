(function (global) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PERIODIC_DRAFT_KEY = 'omos:fleet-periodic-setup:draft:v1';
  const state = {
    startYear: new Date().getFullYear(),
    endYear: new Date().getFullYear(),
    activeYear: new Date().getFullYear(),
    jobFilter: '',
    typeFilter: '',
    mode: 'baseline',
    weeklyModel: 'week-of-year',
    weekStartDay: 1,
    openMonth: 0,
    openWeek: 0,
    selectedPitLocation: '',
    periodicSelections: {},
    pitAssignments: {},
    rowOrder: [],
    pitRowOrder: [],
  };

  let equipment = [];
  let plans = [];
  let spoTablesByJob = {};
  let paAssignments = {};
  let paValues = {};
  let automaticAssignments = {};
  let loadingPromise = null;
  let saveTimer = null;

  const api = path => typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(path) : path;
  const auth = () => typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  const unitKey = unit => String(unit?.id ?? unit?.kode_alat ?? '').trim();
  const valueKey = (year, month, day) => `${year}:${month}:${day}`;
  const isDumpTruck = unit => /dump\s*truck/i.test(String(unit?.kelas_alat || ''));
  const byCode = code => equipment.find(unit => String(unit.kode_alat || '').trim() === String(code || '').trim());
  const jobOfUnit = unit => paAssignments[unitKey(unit)] || '';
  const daysOf = (year, month) => Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1);
  const dateAt = (year, month, day) => new Date(year, month - 1, day);
  const formatNumber = (value, digits = 2) => Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  function fieldValue(table, name) {
    const field = table.querySelector(`[data-plan-productivity-field="${name}"]`);
    if (!field) return '';
    if (field.tagName === 'SELECT') return field.querySelector('option[selected]')?.value || field.value || '';
    return field.getAttribute('value') ?? field.value ?? '';
  }

  function parsePlans(payload, type) {
    const parser = new DOMParser();
    const documentCopy = parser.parseFromString(`<div>${payload?.contentHtml || ''}</div>`, 'text/html');
    return [...documentCopy.querySelectorAll('.plan-productivity-table')].map((table, index) => {
      const values = {};
      [
        'fleetName', 'dumpTruck', 'material', 'bucketCapacity', 'bucketFillFactor',
        'swellFactor', 'dumpTruckCapacity', 'workEffLoader', 'cycleTimeLoading',
        'loadedSpeed', 'emptySpeed', 'spotDumpTime', 'distance', 'workEffFleet',
        'numberOfTruck', 'density',
      ].forEach(name => { values[name] = fieldValue(table, name); });

      const loaderCode = values.fleetName;
      return {
        id: table.dataset.planTableId || `${type}-${index}-${loaderCode}`,
        type,
        values,
        loaderCode,
        dumpTruckCode: values.dumpTruck,
        requiredTrucks: Math.max(0, Math.round(Number(values.numberOfTruck) || 0)),
        computed: global.PlanProductivity?.calculateProductivityValues(values) || {},
      };
    }).filter(plan => plan.loaderCode);
  }

  function extractSpoContext(payload) {
    const parser = new DOMParser();
    const documentCopy = parser.parseFromString(`<div>${payload?.contentHtml || ''}</div>`, 'text/html');
    const planningTables = payload?.planningData?.tables || {};
    spoTablesByJob = {};

    [...documentCopy.querySelectorAll('.spo-table')]
      .filter(table => /^\s*deployed\s*$/i.test(table.querySelector('[data-spo-status]')?.textContent || ''))
      .forEach(table => {
        const job = table.querySelector('[data-spo-job]')?.getAttribute('value')?.trim();
        const id = table.dataset.spoTableId;
        if (job && id && !spoTablesByJob[job]) spoTablesByJob[job] = planningTables[id] || {};
      });

    const tables = Object.values(planningTables);
    if (!tables.length) return;
    state.startYear = Math.min(...tables.map(table => Number(table.startYear) || state.startYear));
    state.endYear = Math.max(...tables.map(table => Number(table.endYear) || state.startYear));
    state.weeklyModel = tables[0].weeklyModel || state.weeklyModel;
    state.weekStartDay = Number(tables[0].weekStartDay ?? state.weekStartDay);
    state.activeYear = Math.min(Math.max(state.activeYear, state.startYear), state.endYear);
  }

  function enrichPlans() {
    plans.forEach(plan => {
      plan.loaderUnit = byCode(plan.loaderCode);
      plan.dumpTruckUnit = byCode(plan.dumpTruckCode);
      plan.dumpTruckModel = String(plan.dumpTruckUnit?.tipe_alat || '').trim().toLowerCase();
      plan.job = jobOfUnit(plan.loaderUnit);
      plan.unit = plan.type === 'coal' ? 'Ton' : 'BCM';
    });
  }

  function compatibleTrucks(plan) {
    if (!plan.job || !plan.dumpTruckModel) return [];
    return equipment.filter(unit => isDumpTruck(unit)
      && jobOfUnit(unit) === plan.job
      && String(unit.tipe_alat || '').trim().toLowerCase() === plan.dumpTruckModel);
  }

  function buildAutomaticAssignments() {
    automaticAssignments = {};
    const usedUnits = new Set();
    plans.forEach(plan => {
      automaticAssignments[plan.id] = compatibleTrucks(plan)
        .filter(unit => !usedUnits.has(unitKey(unit)))
        .slice(0, plan.requiredTrucks);
      automaticAssignments[plan.id].forEach(unit => usedUnits.add(unitKey(unit)));
    });
  }

  function spoDailyLoss(job, year, month, day) {
    const daily = spoTablesByJob[job]?.daily || {};
    const currentSuffix = `:${year}:${month}:${day}`;
    const legacySuffix = `:${month}:${day}`;
    let total = 0;
    let hasCurrentYear = false;

    Object.entries(daily).forEach(([key, raw]) => {
      if (key.startsWith('system:') || !key.endsWith(currentSuffix)) return;
      hasCurrentYear = true;
      total += Math.max(0, Number(raw) || 0);
    });
    if (!hasCurrentYear) Object.entries(daily).forEach(([key, raw]) => {
      if (!key.startsWith('system:') && key.endsWith(legacySuffix) && key.split(':').length === 3) {
        total += Math.max(0, Number(raw) || 0);
      }
    });
    return Math.min(24, total);
  }

  function dailyEwh(unit, job, year, month, day) {
    if (!unit || !job || !spoTablesByJob[job]) return null;
    const values = paValues[unitKey(unit)] || {};
    const rawPa = values[valueKey(year, month, day)];
    if (rawPa === '' || rawPa === undefined || !Number.isFinite(Number(rawPa))) return null;
    const availableAfterPa = 24 * (Number(rawPa) / 100);
    return availableAfterPa > 0
      ? Math.max(0, availableAfterPa - spoDailyLoss(job, year, month, day))
      : null;
  }

  function annualEwh(unit, job) {
    if (!unit || !job || !spoTablesByJob[job]) return null;
    let totalEwh = 0;

    for (let month = 1; month <= 12; month += 1) {
      for (const day of daysOf(state.activeYear, month)) {
        const value = dailyEwh(unit, job, state.activeYear, month, day);
        if (value === null) return null;
        totalEwh += value;
      }
    }
    return totalEwh;
  }

  function capacityResult(plan) {
    const loaderRate = Number(plan.computed.loaderProductivity);
    const truckRate = Number(plan.computed.truckProductivity);
    const loaderEwh = annualEwh(plan.loaderUnit, plan.job);
    const assignedTrucks = automaticAssignments[plan.id] || [];
    const truckEwhValues = assignedTrucks.map(unit => annualEwh(unit, plan.job));

    if (!plan.job || !plan.loaderUnit || !Number.isFinite(loaderRate) || loaderRate <= 0
      || !Number.isFinite(truckRate) || truckRate <= 0 || loaderEwh === null
      || !assignedTrucks.length || truckEwhValues.some(value => value === null)) {
      return { target: null, bottleneck: 'DATA' };
    }

    const loaderCapacity = loaderRate * loaderEwh;
    const haulerCapacity = truckRate * truckEwhValues.reduce((sum, value) => sum + value, 0);
    const tolerance = Math.max(loaderCapacity, haulerCapacity) * 0.03;
    return {
      target: Math.min(loaderCapacity, haulerCapacity),
      bottleneck: Math.abs(loaderCapacity - haulerCapacity) <= tolerance
        ? 'BALANCED'
        : loaderCapacity < haulerCapacity ? 'LOADER' : 'HAULER',
    };
  }

  function visiblePlans(type) {
    return plans.filter(plan => !type || plan.type === type);
  }

  function plansForSelectedArea() {
    if (!state.selectedPitLocation) return [];
    return orderedPlans().filter(plan => visiblePlans().includes(plan)
      && Object.entries(pitStore(plan.loaderCode)).some(([key, location]) => key.startsWith(`${state.activeYear}:`) && location === state.selectedPitLocation));
  }

  function totalTarget(type) {
    const selected = visiblePlans(type);
    if (!selected.length) return null;
    const results = selected.map(capacityResult);
    return results.some(result => result.target === null)
      ? null
      : results.reduce((sum, result) => sum + result.target, 0);
  }

  function kpiCard(label, value, caption, color) {
    return `<div style="background:#fff;border:1px solid #dbe7f5;border-top:4px solid ${color};border-radius:10px;padding:12px;min-height:88px;box-sizing:border-box;">
      <div style="font-size:10px;letter-spacing:.08em;color:#64748b;font-weight:800;">${escapeHtml(label)}</div>
      <div style="font-size:21px;color:#1e293b;font-weight:800;margin-top:8px;">${value}</div>
      <div style="font-size:10px;color:#64748b;margin-top:5px;">${escapeHtml(caption)}</div>
    </div>`;
  }

  function renderKpis() {
    const host = document.getElementById('fleetCapacityKpis');
    if (!host) return;

    const all = visiblePlans();
    const results = all.map(capacityResult);
    const assigned = all.reduce((sum, plan) => sum + (automaticAssignments[plan.id] || []).length, 0);
    const required = all.reduce((sum, plan) => sum + plan.requiredTrucks, 0);
    const balanced = results.filter(result => result.bottleneck === 'BALANCED').length;
    const alerts = results.filter(result => result.bottleneck === 'DATA').length
      + all.filter(plan => (automaticAssignments[plan.id] || []).length < plan.requiredTrucks).length;
    const obTarget = totalTarget('ob');
    const coalTarget = totalTarget('coal');

    host.innerHTML = [
      kpiCard('OB CALCULATED TARGET', obTarget === null ? '—' : `${formatNumber(obTarget)} BCM`, `Periode ${state.activeYear}`, '#0284c7'),
      kpiCard('COAL CALCULATED TARGET', coalTarget === null ? '—' : `${formatNumber(coalTarget)} Ton`, `Periode ${state.activeYear}`, '#7c3aed'),
      kpiCard('ACTIVE FLEET', String(all.length), `${balanced} fleet balanced`, '#2f7d68'),
      kpiCard('TRUCK ASSIGNED / REQUIRED', `${assigned} / ${required}`, `Gap ${Math.max(0, required - assigned)} unit`, '#f59e0b'),
      kpiCard('DATA & CAPACITY ALERTS', String(alerts), alerts ? 'Perlu perhatian' : 'Tidak ada alert', '#dc2626'),
    ].join('');
  }

  function weekStart() {
    return String(state.weeklyModel).startsWith('manual-') ? Number(state.weekStartDay) : 1;
  }

  function weekNumber(date, startDay) {
    const first = new Date(date.getFullYear(), 0, 1);
    const offset = (first.getDay() - startDay + 7) % 7;
    return Math.floor((Math.floor((date - first) / 86400000) + offset) / 7) + 1;
  }

  function weekGroups(year, month) {
    const groups = [];
    let current = [];
    daysOf(year, month).forEach(day => {
      const date = dateAt(year, month, day);
      if (current.length && date.getDay() === weekStart()) {
        groups.push(current);
        current = [];
      }
      current.push(day);
    });
    if (current.length) groups.push(current);
    return groups.map((days, index) => ({
      days,
      label: `Week ${state.weeklyModel.endsWith('year') || state.weeklyModel === 'week-of-year'
        ? weekNumber(dateAt(year, month, days[0]), weekStart()) : index + 1}`,
    }));
  }

  function periodColumns() {
    const columns = [];
    for (let month = 1; month <= 12; month += 1) {
      if (state.openMonth === month) {
        weekGroups(state.activeYear, month).forEach((group, index) => {
          const week = index + 1;
          if (state.openWeek === week) group.days.forEach(day => columns.push({
            type: 'day', month, week, day,
            label: `${day}-${MONTHS[month - 1]}<br><small>${dateAt(state.activeYear, month, day).toLocaleDateString('en-US', { weekday: 'short' })}</small>`,
          }));
          columns.push({ type: 'week', month, week, label: `${state.openWeek === week ? '▼' : '▶'} ${group.label}` });
        });
      }
      columns.push({ type: 'month', month, label: `${state.openMonth === month ? '▼' : '▶'} ${MONTHS[month - 1]}-${String(state.activeYear).slice(-2)}` });
    }
    columns.push({ type: 'year', label: `Tahun ${state.activeYear}` });
    return columns;
  }

  function periodColumnKey(column) {
    return [column.type, column.month || 0, column.week || 0, column.day || 0].join('-');
  }

  function periodHeader(column, minimumWidth) {
    const expandable = ['month', 'week'].includes(column.type);
    return `<th class="fc-period-header fc-period--${column.type}" data-fc-column="${periodColumnKey(column)}" data-periodic-header="${column.type}" data-month="${column.month || ''}" data-week="${column.week || ''}" style="min-width:${minimumWidth}px;cursor:${expandable ? 'pointer' : 'default'};">${column.label}</th>`;
  }

  function contextBar(items) {
    return `<div class="fc-context-bar">${items.map(item => `<span class="fc-context-item"><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.value)}</strong></span>`).join('')}</div>`;
  }

  function tableLegend(extra = '') {
    return `<div class="fc-legend"><span><i class="fc-legend__dot fc-legend__dot--month"></i>Bulan</span><span><i class="fc-legend__dot fc-legend__dot--week"></i>Minggu</span><span><i class="fc-legend__dot fc-legend__dot--day"></i>Hari</span>${extra}</div>`;
  }

  function areaColorIndex(value) {
    return [...String(value || '')].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 0) % 6;
  }

  function columnDays(column) {
    if (column.type === 'day') return [{ month: column.month, day: column.day }];
    if (column.type === 'week') return (weekGroups(state.activeYear, column.month)[column.week - 1]?.days || [])
      .map(day => ({ month: column.month, day }));
    if (column.type === 'month') return daysOf(state.activeYear, column.month).map(day => ({ month: column.month, day }));
    return MONTHS.flatMap((_, index) => daysOf(state.activeYear, index + 1).map(day => ({ month: index + 1, day })));
  }

  function periodicKey(month, day) {
    return `${state.activeYear}:${month}:${day}`;
  }

  function selectionStore(planId) {
    state.periodicSelections[planId] ||= {};
    return state.periodicSelections[planId];
  }

  function fleetAssignmentKey(loaderCode) {
    return `fleet:${String(loaderCode || '').trim().toLocaleLowerCase('id-ID')}`;
  }

  function pitStore(loaderCode) {
    const key = String(loaderCode || '').startsWith('fleet:') ? loaderCode : fleetAssignmentKey(loaderCode);
    state.pitAssignments[key] ||= {};
    return state.pitAssignments[key];
  }

  function availablePitLocations() {
    const found = new Map();
    equipment.forEach(unit => {
      const location = String(unit?.lokasi || '').trim();
      const key = location.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
      if (location && !found.has(key)) found.set(key, location);
    });
    return [...found.values()].sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
  }

  function activeColumnDays(planId, column) {
    const store = selectionStore(planId);
    return columnDays(column).filter(({ month, day }) => store[periodicKey(month, day)] === true);
  }

  function summarizePitValues(values) {
    if (!Array.isArray(values) || !values.length) return { value: '', mixed: false };
    const normalized = [...new Set(values.map(value => String(value || '').trim()))];
    return normalized.length === 1
      ? { value: normalized[0], mixed: false }
      : { value: '', mixed: true };
  }

  function pitColumnState(loaderCode, column) {
    const days = columnDays(column);
    const store = pitStore(loaderCode);
    return { enabled: true, ...summarizePitValues(days.map(({ month, day }) => store[periodicKey(month, day)] || '')) };
  }

  function setPitAssignment(loaderCode, column, location) {
    const store = pitStore(loaderCode);
    columnDays(column).forEach(({ month, day }) => {
      const key = periodicKey(month, day);
      if (location) store[key] = location;
      else delete store[key];
    });
  }

  function deduplicateFleetPlans(planList) {
    const found = new Map();
    (planList || []).forEach(plan => {
      const key = fleetAssignmentKey(plan.loaderCode);
      if (!found.has(key)) found.set(key, { key, loaderCode: plan.loaderCode, loaderUnit: plan.loaderUnit });
    });
    return [...found.values()];
  }

  function uniqueFleetRows() {
    const uniqueRows = deduplicateFleetPlans(plans);
    const found = new Map(uniqueRows.map(row => [row.key, row]));
    const availableKeys = new Set(found.keys());
    state.pitRowOrder = state.pitRowOrder.filter(key => availableKeys.has(key));
    found.forEach((_, key) => { if (!state.pitRowOrder.includes(key)) state.pitRowOrder.push(key); });
    return state.pitRowOrder.map(key => found.get(key)).filter(Boolean);
  }

  function migratePitAssignments(rawAssignments) {
    const migrated = {};
    Object.entries(rawAssignments || {}).forEach(([sourceKey, days]) => {
      const plan = plans.find(item => item.id === sourceKey);
      const targetKey = sourceKey.startsWith('fleet:') ? sourceKey : plan ? fleetAssignmentKey(plan.loaderCode) : '';
      if (!targetKey || !days || typeof days !== 'object') return;
      migrated[targetKey] ||= {};
      Object.entries(days).forEach(([dateKey, location]) => {
        if (!migrated[targetKey][dateKey] && location) migrated[targetKey][dateKey] = location;
      });
    });
    return migrated;
  }

  function checkboxState(planId, column) {
    const days = columnDays(column);
    const store = selectionStore(planId);
    const selected = days.filter(({ month, day }) => store[periodicKey(month, day)] === true).length;
    return { checked: days.length > 0 && selected === days.length, indeterminate: selected > 0 && selected < days.length };
  }

  function findPeriodConflict(planList, selections, planId, dateKeys) {
    const plan = planList.find(item => item.id === planId);
    if (!plan?.loaderCode) return null;
    const loaderCode = String(plan.loaderCode).trim().toLowerCase();
    for (const other of planList) {
      if (other.id === planId || String(other.loaderCode || '').trim().toLowerCase() !== loaderCode) continue;
      const otherStore = selections[other.id] || {};
      const key = dateKeys.find(dateKey => otherStore[dateKey] === true);
      if (key) return { plan: other, key };
    }
    return null;
  }

  function conflictingSelection(planId, column) {
    const days = columnDays(column);
    const keys = days.map(({ month, day }) => periodicKey(month, day));
    const conflict = findPeriodConflict(plans, state.periodicSelections, planId, keys);
    if (!conflict) return null;
    const index = keys.indexOf(conflict.key);
    return { plan: conflict.plan, date: days[index] };
  }

  function periodicCheckbox(planId, column) {
    const status = checkboxState(planId, column);
    const conflict = status.checked ? null : conflictingSelection(planId, column);
    const title = conflict ? `Konflik: fleet sudah running untuk material ${conflict.plan.values.material || 'lain'} pada ${conflict.date.day}-${MONTHS[conflict.date.month - 1]}-${state.activeYear}` : 'Tentukan fleet running';
    return `<input type="checkbox" data-periodic-check data-plan-id="${escapeHtml(planId)}" data-period-type="${column.type}" data-month="${column.month || ''}" data-week="${column.week || ''}" data-day="${column.day || ''}" ${status.checked ? 'checked' : ''} data-indeterminate="${status.indeterminate ? 'true' : 'false'}" data-has-conflict="${conflict ? 'true' : 'false'}" title="${escapeHtml(title)}" aria-label="Fleet running ${escapeHtml(column.label.replace(/<[^>]+>/g, ' '))}" style="width:16px;height:16px;cursor:pointer;accent-color:#15803d;${conflict ? 'outline:2px solid #fca5a5;outline-offset:1px;' : ''}">`;
  }

  function orderedPlans() {
    const availableIds = new Set(plans.map(plan => plan.id));
    state.rowOrder = state.rowOrder.filter(id => availableIds.has(id));
    plans.forEach(plan => { if (!state.rowOrder.includes(plan.id)) state.rowOrder.push(plan.id); });
    return state.rowOrder.map(id => plans.find(plan => plan.id === id)).filter(Boolean);
  }

  function renderPeriodicTable() {
    const host = document.getElementById('fleetPeriodicSetup');
    if (!host) return;
    const previousScroll = host.querySelector('[data-periodic-scroll]');
    const previousLeft = previousScroll?.scrollLeft || 0;
    const previousTop = previousScroll?.scrollTop || 0;
    const columns = periodColumns();
    const rows = plansForSelectedArea();
    const planOptions = rows.map(plan => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.loaderCode)} - ${plan.type === 'coal' ? 'Coal' : 'OB'}</option>`).join('');

    host.innerHTML = `<section class="fc-card fc-card--periodic">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <div><h3 style="margin:0;font-size:17px;color:#0f172a;">Fleet Periodic Setup — ${escapeHtml(state.selectedPitLocation)}</h3><div style="font-size:11px;color:#64748b;margin-top:3px;">Checklist menentukan fleet running pada area terpilih. Klik header bulan atau minggu untuk membuka detail periodenya.</div></div>
        <span style="font-size:11px;color:#64748b;">${rows.length} fleet planning • Periode mengikuti SPO</span>
      </div>
      ${contextBar([{ label: 'Area aktif', value: state.selectedPitLocation }, { label: 'Tahun', value: state.activeYear }, { label: 'Fleet', value: `${rows.length} planning` }])}
      ${tableLegend('<span><i class="fc-legend__check">✓</i>Fleet aktif</span><span><i class="fc-legend__mixed">−</i>Partial</span>')}
      <div data-periodic-scroll style="overflow:auto;max-height:62vh;border:1px solid #cbd5e1;border-radius:7px;overscroll-behavior:contain;">
        <table class="fc-grid" style="width:max-content;min-width:100%;table-layout:fixed;">
          <thead><tr>${['Fleet','Class','Material','Pdty'].map((label, index) => `<th class="fc-sticky-head" style="left:${[0,150,245,365][index]}px;z-index:${70-index};width:${[150,95,120,125][index]}px;min-width:${[150,95,120,125][index]}px;">${label}</th>`).join('')}${columns.map(column => periodHeader(column, column.type === 'day' ? 66 : 84)).join('')}</tr></thead>
          <tbody>${rows.map(plan => `<tr data-periodic-row="${escapeHtml(plan.id)}">
            <td style="position:sticky;left:0;z-index:45;width:150px;min-width:150px;padding:4px;border:1px solid #e2e8f0;background:#fff;"><select data-periodic-fleet="${escapeHtml(plan.id)}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;font-weight:700;">${planOptions.replace(`value="${escapeHtml(plan.id)}"`, `value="${escapeHtml(plan.id)}" selected`)}</select></td>
            <td style="position:sticky;left:150px;z-index:44;width:95px;min-width:95px;padding:6px;border:1px solid #e2e8f0;background:#fff;font-weight:700;">${escapeHtml(plan.loaderUnit?.class_unit || '—')}</td>
            <td style="position:sticky;left:245px;z-index:43;width:120px;min-width:120px;padding:6px;border:1px solid #e2e8f0;background:#fff;font-weight:700;overflow-wrap:anywhere;">${escapeHtml(plan.values.material || '—')}</td>
            <td title="Fleet Productivity" style="position:sticky;left:365px;z-index:42;width:125px;min-width:125px;padding:6px;border:1px solid #e2e8f0;background:#fff;text-align:right;font-weight:800;white-space:nowrap;">${Number.isFinite(Number(plan.computed.fleetProductivity)) ? `${formatNumber(plan.computed.fleetProductivity)} ${plan.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr'}` : '—'}</td>
            ${columns.map(column => { const check = checkboxState(plan.id, column); return `<td class="fc-period-cell fc-period-cell--${column.type} ${check.checked ? 'is-active' : ''} ${check.indeterminate ? 'is-partial' : ''}" data-fc-column="${periodColumnKey(column)}">${periodicCheckbox(plan.id, column)}</td>`; }).join('')}
          </tr>`).join('') || `<tr><td colspan="${columns.length + 4}" style="padding:18px;text-align:center;color:#64748b;">Belum ada fleet yang disimpan pada OB atau Coal Productivity Planning.</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
    host.querySelectorAll('[data-indeterminate="true"]').forEach(input => { input.indeterminate = true; });
    const nextScroll = host.querySelector('[data-periodic-scroll]');
    if (nextScroll) {
      nextScroll.scrollLeft = previousLeft;
      nextScroll.scrollTop = previousTop;
    }
  }

  function pitLocationSelect(loaderCode, column, locations) {
    const status = pitColumnState(loaderCode, column);
    const options = [
      '<option value="">Pilih area</option>',
      status.mixed ? '<option value="__mixed__" selected disabled>Mixed</option>' : '',
      ...locations.map(location => `<option value="${escapeHtml(location)}" ${!status.mixed && status.value === location ? 'selected' : ''}>${escapeHtml(location)}</option>`),
    ].join('');
    return `<select data-pit-location data-loader-code="${escapeHtml(loaderCode)}" data-period-type="${column.type}" data-month="${column.month || ''}" data-week="${column.week || ''}" data-day="${column.day || ''}" title="Pilih lokasi PIT untuk periode ini" style="width:100%;min-width:${column.type === 'day' ? 86 : 104}px;padding:5px 18px 5px 5px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;font-size:11px;">${options}</select>`;
  }

  function renderPitAreaSetup() {
    const host = document.getElementById('fleetPitAreaSetup');
    if (!host) return;
    const previousScroll = host.querySelector('[data-pit-scroll]');
    const previousLeft = previousScroll?.scrollLeft || 0;
    const previousTop = previousScroll?.scrollTop || 0;
    const columns = periodColumns();
    const locations = availablePitLocations();
    const rows = uniqueFleetRows();
    const fleetOptions = rows.map(row => `<option value="${escapeHtml(row.key)}">${escapeHtml(row.loaderCode)}</option>`).join('');

    host.innerHTML = `<section class="fc-card fc-card--pit">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <div><h3 style="margin:0;font-size:17px;color:#0f172a;">PIT Area Setup</h3><div style="font-size:11px;color:#64748b;margin-top:3px;">Satu fleet hanya tampil satu kali. Lokasi bersumber dari List Equipment dan dapat diatur per tahun, bulan, minggu, atau hari.</div></div>
        <span style="font-size:11px;color:#64748b;">${locations.length} lokasi • ${rows.length} fleet unik</span>
      </div>
      ${contextBar([{ label: 'Tahun', value: state.activeYear }, { label: 'Area tersedia', value: locations.length }, { label: 'Fleet unik', value: rows.length }])}
      ${tableLegend('<span><i class="fc-legend__mixed">−</i>Mixed</span>')}
      <div data-pit-scroll style="overflow:auto;max-height:62vh;border:1px solid #cbd5e1;border-radius:7px;overscroll-behavior:contain;">
        <table class="fc-grid" style="width:max-content;min-width:100%;table-layout:fixed;">
          <thead><tr>${['Fleet','Class'].map((label, index) => `<th class="fc-sticky-head" style="left:${[0,150][index]}px;z-index:${70-index};width:${[150,95][index]}px;min-width:${[150,95][index]}px;">${label}</th>`).join('')}${columns.map(column => periodHeader(column, column.type === 'day' ? 96 : 114)).join('')}</tr></thead>
          <tbody>${rows.map(row => `<tr data-pit-row="${escapeHtml(row.key)}">
            <td style="position:sticky;left:0;z-index:45;width:150px;min-width:150px;padding:4px;border:1px solid #e2e8f0;background:#fff;"><select data-pit-fleet="${escapeHtml(row.key)}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;font-weight:700;">${fleetOptions.replace(`value="${escapeHtml(row.key)}"`, `value="${escapeHtml(row.key)}" selected`)}</select></td>
            <td style="position:sticky;left:150px;z-index:44;width:95px;min-width:95px;padding:6px;border:1px solid #e2e8f0;background:#fff;font-weight:700;">${escapeHtml(row.loaderUnit?.class_unit || '—')}</td>
            ${columns.map(column => `<td class="fc-period-cell fc-period-cell--${column.type}" data-fc-column="${periodColumnKey(column)}">${pitLocationSelect(row.loaderCode, column, locations)}</td>`).join('')}
          </tr>`).join('') || `<tr><td colspan="${columns.length + 2}" style="padding:18px;text-align:center;color:#64748b;">Belum ada fleet yang disimpan pada OB atau Coal Productivity Planning.</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
    const nextScroll = host.querySelector('[data-pit-scroll]');
    if (nextScroll) {
      nextScroll.scrollLeft = previousLeft;
      nextScroll.scrollTop = previousTop;
    }
  }

  function renderPitAreaSelector() {
    const host = document.getElementById('fleetPitAreaSelector');
    if (!host) return;
    const locations = availablePitLocations();
    if (state.selectedPitLocation && !locations.includes(state.selectedPitLocation)) state.selectedPitLocation = '';
    host.innerHTML = `<section class="fc-card fc-area-selector">
      <div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:9px;">Pilih Area PIT</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">${locations.map(location => `<button type="button" class="fc-area-button fc-area-color-${areaColorIndex(location)} ${state.selectedPitLocation === location ? 'is-selected' : ''}" data-pit-area-button="${escapeHtml(location)}"><span class="fc-area-button__dot"></span>${escapeHtml(location)}</button>`).join('') || '<span style="font-size:12px;color:#b45309;">Belum ada lokasi pada List Equipment.</span>'}</div>
    </section>`;
  }

  function productionForColumn(plan, column, pitLocation = '') {
    const pit = pitStore(plan.loaderCode);
    const activeDays = activeColumnDays(plan.id, column)
      .filter(({ month, day }) => !pitLocation || pit[periodicKey(month, day)] === pitLocation);
    if (!activeDays.length) return { value: null, reason: 'Fleet tidak dijadwalkan running pada periode ini' };
    const productivity = Number(plan.computed.fleetProductivity);
    if (!Number.isFinite(productivity) || productivity <= 0) return { value: null, reason: 'Fleet Productivity belum tersedia' };
    const ewhValues = [];
    for (const { month, day } of activeDays) {
      const ewh = dailyEwh(plan.loaderUnit, plan.job, state.activeYear, month, day);
      if (ewh === null) return { value: null, reason: `EWH ${plan.loaderCode} atau JOB belum lengkap` };
      ewhValues.push(ewh);
    }
    return { value: calculateCheckedProduction(productivity, ewhValues), reason: '' };
  }

  function calculateCheckedProduction(productivity, ewhValues) {
    const rate = Number(productivity);
    if (!Array.isArray(ewhValues) || !ewhValues.length || !Number.isFinite(rate) || rate <= 0
      || ewhValues.some(value => value === null || value === '' || !Number.isFinite(Number(value)))) return null;
    return ewhValues.reduce((total, value) => total + (Number(value) * rate), 0);
  }

  function productionTableSection(type, columns, allRows) {
    const rows = allRows.filter(plan => plan.type === type);
    const title = type === 'coal' ? 'Coal' : 'OB';
    const unit = type === 'coal' ? 'Ton' : 'BCM';
    const rateUnit = `${unit}/Hr`;
    const planOptions = rows.map(plan => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.loaderCode)} - ${title}</option>`).join('');
    const results = new Map();
    const maximumByColumn = new Map();
    rows.forEach(plan => columns.forEach(column => {
      const result = productionForColumn(plan, column, state.selectedPitLocation);
      const columnKey = periodColumnKey(column);
      results.set(`${plan.id}|${columnKey}`, result);
      if (result.value !== null) maximumByColumn.set(columnKey, Math.max(maximumByColumn.get(columnKey) || 0, result.value));
    }));

    const heatClass = (value, column) => {
      const maximum = maximumByColumn.get(periodColumnKey(column)) || 0;
      if (!maximum || value === null) return '';
      const ratio = value / maximum;
      if (ratio >= 0.75) return 'fc-heat-4';
      if (ratio >= 0.50) return 'fc-heat-3';
      if (ratio >= 0.25) return 'fc-heat-2';
      return 'fc-heat-1';
    };
    const totalForColumn = column => {
      const columnResults = rows.map(plan => results.get(`${plan.id}|${periodColumnKey(column)}`));
      const dataGap = columnResults.some(result => result?.value === null && !String(result.reason).startsWith('Fleet tidak dijadwalkan'));
      const values = columnResults.filter(result => result?.value !== null).map(result => result.value);
      return dataGap || !values.length ? null : values.reduce((sum, value) => sum + value, 0);
    };

    return `<section class="fc-card fc-production-card fc-production-card--${type}">
      <div class="fc-card-heading">
        <div><h3>Production Planning ${title} — ${escapeHtml(state.selectedPitLocation)}</h3><div>Produksi = EWH Excavator × Fleet Productivity. Hanya periode aktif pada area ini yang dihitung.</div></div>
        <span class="fc-unit-badge">${unit} • Read only</span>
      </div>
      ${contextBar([{ label: 'Area aktif', value: state.selectedPitLocation }, { label: 'Tahun', value: state.activeYear }, { label: `Fleet ${title}`, value: rows.length }, { label: 'Satuan', value: unit }])}
      ${tableLegend('<span class="fc-heat-legend">Rendah</span><span class="fc-heat-scale"></span><span class="fc-heat-legend">Tinggi</span>')}
      <div data-production-scroll="${type}" style="overflow:auto;max-height:62vh;border:1px solid #cbd5e1;border-radius:7px;overscroll-behavior:contain;">
        <table class="fc-grid" style="width:max-content;min-width:100%;table-layout:fixed;">
          <thead><tr>${['Fleet','Class','Material','Pdty','Unit'].map((label, index) => `<th class="fc-sticky-head" style="left:${[0,150,245,365,490][index]}px;z-index:${70-index};width:${[150,95,120,125,70][index]}px;min-width:${[150,95,120,125,70][index]}px;">${label}</th>`).join('')}${columns.map(column => periodHeader(column, column.type === 'day' ? 92 : 112)).join('')}</tr></thead>
          <tbody>${rows.map(plan => `<tr data-production-row="${escapeHtml(plan.id)}">
            <td class="fc-sticky-cell" style="left:0;width:150px;min-width:150px;"><select data-production-fleet="${escapeHtml(plan.id)}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;font-weight:700;">${planOptions.replace(`value="${escapeHtml(plan.id)}"`, `value="${escapeHtml(plan.id)}" selected`)}</select></td>
            <td class="fc-sticky-cell" style="left:150px;width:95px;min-width:95px;font-weight:700;">${escapeHtml(plan.loaderUnit?.class_unit || '—')}</td>
            <td class="fc-sticky-cell" style="left:245px;width:120px;min-width:120px;font-weight:700;overflow-wrap:anywhere;">${escapeHtml(plan.values.material || '—')}</td>
            <td class="fc-sticky-cell" title="Fleet Productivity" style="left:365px;width:125px;min-width:125px;text-align:right;font-weight:800;white-space:nowrap;">${Number.isFinite(Number(plan.computed.fleetProductivity)) ? formatNumber(plan.computed.fleetProductivity) : '—'}</td>
            <td class="fc-sticky-cell fc-unit-cell" style="left:490px;width:70px;min-width:70px;">${rateUnit}</td>
            ${columns.map(column => { const result = results.get(`${plan.id}|${periodColumnKey(column)}`); return `<td class="fc-period-cell fc-period-cell--${column.type} fc-production-value ${heatClass(result.value, column)}" data-fc-column="${periodColumnKey(column)}" title="${escapeHtml(result.reason || `EWH × Fleet Productivity (${unit})`)}">${result.value === null ? '—' : formatNumber(result.value)}</td>`; }).join('')}
          </tr>`).join('') || `<tr><td colspan="${columns.length + 5}" class="fc-empty-state">Belum ada fleet ${title} yang dialokasikan ke ${escapeHtml(state.selectedPitLocation)} pada tahun ${state.activeYear}.</td></tr>`}
          ${rows.length ? `<tr class="fc-total-row"><td colspan="4" class="fc-total-label">Total Production ${title} — ${escapeHtml(state.selectedPitLocation)}</td><td class="fc-total-unit">${unit}</td>${columns.map(column => { const total = totalForColumn(column); return `<td data-fc-column="${periodColumnKey(column)}">${total === null ? '—' : formatNumber(total)}</td>`; }).join('')}</tr>` : ''}</tbody>
        </table>
      </div>
    </section>`;
  }

  function renderProductionPlanning() {
    const host = document.getElementById('fleetProductionPlanning');
    if (!host) return;
    const previousScroll = {};
    host.querySelectorAll('[data-production-scroll]').forEach(element => {
      previousScroll[element.dataset.productionScroll] = { left: element.scrollLeft, top: element.scrollTop };
    });
    const columns = periodColumns();
    const rows = plansForSelectedArea();
    host.innerHTML = `<div class="fc-production-stack">${productionTableSection('ob', columns, rows)}${productionTableSection('coal', columns, rows)}</div>`;
    host.querySelectorAll('[data-production-scroll]').forEach(element => {
      const saved = previousScroll[element.dataset.productionScroll];
      if (!saved) return;
      element.scrollLeft = saved.left;
      element.scrollTop = saved.top;
    });
  }

  function setPeriodSelection(planId, column, checked) {
    if (checked) {
      const conflict = conflictingSelection(planId, column);
      if (conflict) return { ok: false, conflict };
    }
    const store = selectionStore(planId);
    columnDays(column).forEach(({ month, day }) => {
      const key = periodicKey(month, day);
      if (checked) store[key] = true;
      else delete store[key];
    });
    return { ok: true };
  }

  function savePeriodicSetup(immediate = false) {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(PERIODIC_DRAFT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        periodicSelections: state.periodicSelections,
        pitAssignments: state.pitAssignments,
        rowOrder: state.rowOrder,
        pitRowOrder: state.pitRowOrder,
      }));
    } catch (error) { console.warn('Draft Fleet Periodic Setup tidak dapat disimpan:', error); }
    const persist = async () => {
      const status = document.getElementById('fleetCapacityStatus');
      if (status) status.textContent = 'Menyimpan…';
      try {
        const response = await fetch(api('/api/admin/production/productivity-plans/fleet-capacity'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify({
            contentHtml: '<div data-fleet-periodic-storage="true"></div>',
            planningData: { version: 3, periodicSelections: state.periodicSelections, pitAssignments: state.pitAssignments, rowOrder: state.rowOrder, pitRowOrder: state.pitRowOrder },
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        try { localStorage.removeItem(PERIODIC_DRAFT_KEY); } catch (error) { console.warn('Draft Fleet Periodic Setup tidak dapat dibersihkan:', error); }
        if (status) status.textContent = 'Tersimpan';
      } catch (error) {
        console.error('Gagal menyimpan Fleet Periodic Setup:', error);
        if (status) status.textContent = 'Gagal menyimpan';
      }
    };
    if (immediate) return persist();
    saveTimer = setTimeout(persist, 350);
    return null;
  }

  function syncControls() {
    const year = document.getElementById('fleetCapacityYear');
    if (year) {
      year.innerHTML = Array.from({ length: state.endYear - state.startYear + 1 }, (_, index) => {
        const value = state.startYear + index;
        return `<option value="${value}">${value}</option>`;
      }).join('');
      year.value = String(state.activeYear);
    }

    const jobs = [...new Set(plans.map(plan => plan.job).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const job = document.getElementById('fleetCapacityJob');
    if (job) {
      job.innerHTML = `<option value="">Semua JOB</option>${jobs.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
      job.value = state.jobFilter;
    }
    const type = document.getElementById('fleetCapacityType');
    if (type) type.value = state.typeFilter;
    const mode = document.getElementById('fleetCapacityMode');
    if (mode) mode.value = state.mode;
  }

  function renderPlanningTables() {
    renderPitAreaSetup();
    renderPitAreaSelector();
    const guide = document.getElementById('fleetAreaPlanningGuide');
    const content = document.getElementById('fleetAreaPlanningContent');
    if (guide) guide.hidden = Boolean(state.selectedPitLocation);
    if (content) content.hidden = !state.selectedPitLocation;
    if (state.selectedPitLocation) {
      renderPeriodicTable();
      renderProductionPlanning();
    } else {
      const periodic = document.getElementById('fleetPeriodicSetup');
      const production = document.getElementById('fleetProductionPlanning');
      if (periodic) periodic.innerHTML = '';
      if (production) production.innerHTML = '';
    }
  }

  function bindOnce() {
    const panel = document.getElementById('tab-prodFleetCapacity');
    if (!panel || panel.dataset.capacityBound) return;
    panel.dataset.capacityBound = 'true';
    panel.addEventListener('change', event => {
      if (event.target.matches('#fleetCapacityYear')) state.activeYear = Number(event.target.value);
      else if (event.target.matches('#fleetCapacityJob')) state.jobFilter = event.target.value;
      else if (event.target.matches('#fleetCapacityType')) state.typeFilter = event.target.value;
      else if (event.target.matches('#fleetCapacityMode')) state.mode = event.target.value;
      else if (event.target.matches('[data-periodic-check]')) {
        const plan = plans.find(item => item.id === event.target.dataset.planId);
        const result = setPeriodSelection(event.target.dataset.planId, {
          type: event.target.dataset.periodType,
          month: Number(event.target.dataset.month),
          week: Number(event.target.dataset.week),
          day: Number(event.target.dataset.day),
        }, event.target.checked);
        if (!result.ok) {
          const conflictDate = `${result.conflict.date.day}-${MONTHS[result.conflict.date.month - 1]}-${state.activeYear}`;
          alert(`Fleet ${plan?.loaderCode || ''} tidak dapat dijalankan untuk material ${plan?.values.material || 'ini'} pada periode tersebut. Fleet yang sama sudah aktif untuk material ${result.conflict.plan.values.material || 'lain'} pada ${conflictDate}. Hapus checklist yang aktif terlebih dahulu.`);
          renderPlanningTables();
          return;
        }
        renderPlanningTables();
        savePeriodicSetup(true);
        return;
      } else if (event.target.matches('[data-pit-location]')) {
        setPitAssignment(event.target.dataset.loaderCode, {
          type: event.target.dataset.periodType,
          month: Number(event.target.dataset.month),
          week: Number(event.target.dataset.week),
          day: Number(event.target.dataset.day),
        }, event.target.value);
        renderPlanningTables();
        savePeriodicSetup(true);
        return;
      } else if (event.target.matches('[data-pit-fleet]')) {
        const currentId = event.target.dataset.pitFleet;
        const nextId = event.target.value;
        const currentIndex = state.pitRowOrder.indexOf(currentId);
        const nextIndex = state.pitRowOrder.indexOf(nextId);
        if (currentIndex >= 0 && nextIndex >= 0) [state.pitRowOrder[currentIndex], state.pitRowOrder[nextIndex]] = [state.pitRowOrder[nextIndex], state.pitRowOrder[currentIndex]];
        renderPlanningTables();
        savePeriodicSetup(true);
        return;
      } else if (event.target.matches('[data-periodic-fleet],[data-production-fleet]')) {
        const currentId = event.target.dataset.periodicFleet || event.target.dataset.productionFleet;
        const nextId = event.target.value;
        const currentIndex = state.rowOrder.indexOf(currentId);
        const nextIndex = state.rowOrder.indexOf(nextId);
        if (currentIndex >= 0 && nextIndex >= 0) [state.rowOrder[currentIndex], state.rowOrder[nextIndex]] = [state.rowOrder[nextIndex], state.rowOrder[currentIndex]];
        renderPlanningTables();
        savePeriodicSetup(true);
        return;
      }
      else return;
      renderKpis();
      renderPlanningTables();
    });
    panel.addEventListener('click', event => {
      if (event.target.closest('[data-periodic-check],[data-pit-location],[data-periodic-fleet],[data-pit-fleet],[data-production-fleet]')) return;
      const areaButton = event.target.closest('[data-pit-area-button]');
      if (areaButton) {
        state.selectedPitLocation = areaButton.dataset.pitAreaButton;
        renderPlanningTables();
        return;
      }
      const header = event.target.closest('[data-periodic-header]');
      if (!header || !['month', 'week'].includes(header.dataset.periodicHeader)) return;
      if (header.dataset.periodicHeader === 'month') {
        const month = Number(header.dataset.month);
        state.openMonth = state.openMonth === month ? 0 : month;
        state.openWeek = 0;
      } else {
        const week = Number(header.dataset.week);
        state.openWeek = state.openWeek === week ? 0 : week;
      }
      renderPlanningTables();
    });
    panel.addEventListener('pointerover', event => {
      const cell = event.target.closest('[data-fc-column]');
      const table = cell?.closest('.fc-grid');
      if (!cell || !table) return;
      const key = cell.dataset.fcColumn;
      table.querySelectorAll(`[data-fc-column="${key}"]`).forEach(item => item.classList.add('is-column-focus'));
    });
    panel.addEventListener('pointerout', event => {
      const cell = event.target.closest('[data-fc-column]');
      const table = cell?.closest('.fc-grid');
      if (!cell || !table) return;
      const key = cell.dataset.fcColumn;
      if (event.relatedTarget?.closest?.(`[data-fc-column="${key}"]`)) return;
      table.querySelectorAll(`[data-fc-column="${key}"]`).forEach(item => item.classList.remove('is-column-focus'));
    });
  }

  async function loadSources() {
    const responses = await Promise.all([
      fetch(api('/api/admin/production/master'), { headers: auth() }),
      fetch(api('/api/admin/production/productivity-plans/spo'), { headers: auth() }),
      fetch(api('/api/admin/production/productivity-plans/pa-ua-ewh'), { headers: auth() }),
      fetch(api('/api/admin/production/productivity-plans/ob'), { headers: auth() }),
      fetch(api('/api/admin/production/productivity-plans/coal'), { headers: auth() }),
      fetch(api('/api/admin/production/productivity-plans/fleet-capacity'), { headers: auth() }),
    ]);
    if (!responses[0].ok) throw new Error(`Master HTTP ${responses[0].status}`);
    const payloads = await Promise.all(responses.map(async response => response.ok ? response.json() : {}));
    const [master, spo, pae, ob, coal, saved] = payloads;

    equipment = master.equipment || [];
    paAssignments = pae.planningData?.assignments?.PA || {};
    paValues = pae.planningData?.values?.PA || {};
    extractSpoContext(spo);
    plans = [...parsePlans(ob, 'ob'), ...parsePlans(coal, 'coal')];
    enrichPlans();
    buildAutomaticAssignments();
    let needsPitMigration = Number(saved.planningData?.version || 0) < 3;
    state.periodicSelections = saved.planningData?.periodicSelections || {};
    state.pitAssignments = migratePitAssignments(saved.planningData?.pitAssignments || {});
    state.rowOrder = Array.isArray(saved.planningData?.rowOrder) ? saved.planningData.rowOrder : [];
    state.pitRowOrder = Array.isArray(saved.planningData?.pitRowOrder) ? saved.planningData.pitRowOrder : [];
    try {
      const draft = JSON.parse(localStorage.getItem(PERIODIC_DRAFT_KEY) || 'null');
      const serverTime = Date.parse(saved.updatedAt || 0) || 0;
      const draftTime = Date.parse(draft?.savedAt || 0) || 0;
      if (draft && draftTime > serverTime) {
        state.periodicSelections = draft.periodicSelections || state.periodicSelections;
        state.pitAssignments = migratePitAssignments(draft.pitAssignments || state.pitAssignments);
        state.rowOrder = Array.isArray(draft.rowOrder) ? draft.rowOrder : state.rowOrder;
        state.pitRowOrder = Array.isArray(draft.pitRowOrder) ? draft.pitRowOrder : state.pitRowOrder;
        needsPitMigration = true;
      }
    } catch (error) { console.warn('Draft Fleet Periodic Setup tidak dapat dipulihkan:', error); }
    orderedPlans();
    uniqueFleetRows();
    if (needsPitMigration) setTimeout(() => savePeriodicSetup(true), 0);
  }

  async function init() {
    bindOnce();
    if (loadingPromise) return loadingPromise;
    state.selectedPitLocation = '';
    const status = document.getElementById('fleetCapacityStatus');
    if (status) status.textContent = 'Memuat sumber data…';
    loadingPromise = (async () => {
      try {
        await loadSources();
        syncControls();
        renderPlanningTables();
        if (status) status.textContent = 'Tersinkron';
      } catch (error) {
        console.error('Gagal memuat Fleet Capacity:', error);
        const host = document.getElementById('fleetPitAreaSetup');
        if (host) host.innerHTML = `<div style="padding:16px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;">Gagal memuat Fleet Capacity: ${escapeHtml(error.message)}</div>`;
        if (status) status.textContent = 'Gagal memuat data';
      } finally {
        loadingPromise = null;
      }
    })();
    return loadingPromise;
  }

  const publicApi = { init, refresh: init };
  if (typeof module !== 'undefined' && module.exports) module.exports = { findPeriodConflict, calculateCheckedProduction, summarizePitValues, deduplicateFleetPlans };
  global.FleetCapacityPlanning = publicApi;
}(typeof window !== 'undefined' ? window : globalThis));
