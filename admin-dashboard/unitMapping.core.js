(function (global) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DRAFT_KEY = 'omos:unit-mapping:draft:v1';
  const state = {
    startYear: new Date().getFullYear(),
    endYear: new Date().getFullYear(),
    activeYear: new Date().getFullYear(),
    activeMonth: 1,
    scope: 'month',
    activeWeek: 1,
    activeDay: 1,
    weeklyModel: 'week-of-year',
    weekStartDay: 1,
    search: '',
    queueFilter: 'all',
    assignments: {},
    dozerFleetAssignments: {},
    undoStack: [],
    redoStack: [],
    dragUnitId: '',
  };

  let equipment = [];
  let plans = [];
  let periodicSelections = {};
  let pitAssignments = {};
  let paAssignments = {};
  let loadingPromise = null;
  let saveTimer = null;

  const api = path => typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(path) : path;
  const auth = () => typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
  const unitId = unit => String(unit?.id ?? unit?.kode_alat ?? '').trim();
  const dateKey = (year, month, day) => `${year}:${month}:${day}`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const byCode = code => equipment.find(unit => normalize(unit.kode_alat) === normalize(code));
  const jobOfUnit = unit => paAssignments[unitId(unit)] || '';
  const isDumpTruck = unit => normalize(unit?.kelas_alat) === 'dump truck';
  const isExcavator = unit => normalize(unit?.kelas_alat) === 'excavator';
  const isDozer = unit => {
    const equipmentType = normalize(unit?.kelas_alat);
    return equipmentType.includes('dozer') || equipmentType.includes('bulldozer');
  };
  const isObRemoval = plan => normalize(plan?.job) === 'ob removal';
  const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
  const dateAt = (year, month, day) => new Date(year, month - 1, day);
  const toDatePart = date => ({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });

  function fieldValue(table, name) {
    const field = table.querySelector(`[data-plan-productivity-field="${name}"]`);
    if (!field) return '';
    if (field.tagName === 'SELECT') return field.querySelector('option[selected]')?.value || field.value || '';
    return field.getAttribute('value') ?? field.value ?? '';
  }

  function parsePlans(payload, type) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${payload?.contentHtml || ''}</div>`, 'text/html');
    return [...doc.querySelectorAll('.plan-productivity-table')].map((table, index) => {
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

  function enrichPlans() {
    plans.forEach(plan => {
      plan.loaderUnit = byCode(plan.loaderCode);
      plan.dumpTruckUnit = byCode(plan.dumpTruckCode);
      plan.dumpTruckModel = normalize(plan.dumpTruckUnit?.tipe_alat);
      plan.dumpTruckClass = normalize(plan.dumpTruckUnit?.class_unit);
      plan.job = jobOfUnit(plan.loaderUnit);
    });
  }

  function extractSpoPeriod(payload) {
    const tables = Object.values(payload?.planningData?.tables || {});
    if (!tables.length) return;
    state.startYear = Math.min(...tables.map(table => Number(table.startYear) || state.startYear));
    state.endYear = Math.max(...tables.map(table => Number(table.endYear) || state.startYear));
    state.weeklyModel = tables[0].weeklyModel || state.weeklyModel;
    state.weekStartDay = Number(tables[0].weekStartDay ?? state.weekStartDay);
    state.activeYear = Math.min(Math.max(state.activeYear, state.startYear), state.endYear);
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
    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      const date = dateAt(year, month, day);
      if (current.length && date.getDay() === weekStart()) {
        groups.push(current);
        current = [];
      }
      current.push(day);
    }
    if (current.length) groups.push(current);
    return groups.map((days, index) => ({
      days,
      label: `Week ${state.weeklyModel.endsWith('year') || state.weeklyModel === 'week-of-year'
        ? weekNumber(dateAt(year, month, days[0]), weekStart()) : index + 1}`,
    }));
  }

  function buildTargetDays(year, month, scope, week, day, groups = null) {
    if (scope === 'day') return [{ year, month, day }];
    if (scope === 'week') return (groups || weekGroups(year, month))[week - 1]?.days
      .map(value => ({ year, month, day: value })) || [];
    return Array.from({ length: daysInMonth(year, month) }, (_, index) => ({ year, month, day: index + 1 }));
  }

  function targetDays() {
    return buildTargetDays(state.activeYear, state.activeMonth, state.scope, state.activeWeek, state.activeDay);
  }

  function fleetAssignmentKey(loaderCode) {
    return `fleet:${normalize(loaderCode)}`;
  }

  function availableAreas() {
    const found = new Map();
    equipment.forEach(unit => {
      const area = String(unit?.lokasi || '').trim();
      if (area && !found.has(normalize(area))) found.set(normalize(area), area);
    });
    return [...found.values()].sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
  }

  function findActiveFleetInstances(planList, selections, pits, days) {
    const grouped = new Map();
    (planList || []).forEach(plan => {
      const schedule = selections?.[plan.id] || {};
      const pit = pits?.[fleetAssignmentKey(plan.loaderCode)] || {};
      (days || []).forEach(part => {
        const key = dateKey(part.year, part.month, part.day);
        const area = String(pit[key] || '').trim();
        if (schedule[key] !== true || !area) return;
        const instanceKey = `${plan.id}|${normalize(area)}`;
        if (!grouped.has(instanceKey)) grouped.set(instanceKey, { key: instanceKey, plan, area, dayKeys: [] });
        grouped.get(instanceKey).dayKeys.push(key);
      });
    });
    return [...grouped.values()];
  }

  function activeInstances() {
    return findActiveFleetInstances(plans, periodicSelections, pitAssignments, targetDays());
  }

  function strictDumpTruckCompatibility(unit, plan, assignedJob = jobOfUnit(unit)) {
    if (!isDumpTruck(unit)) return { ok: false, reason: 'Hanya Dump Truck yang dapat ditempatkan ke fleet.' };
    if (!plan?.dumpTruckClass) return { ok: false, reason: 'Class Dump Truck pada Fleet Planning belum tersedia.' };
    if (normalize(unit.class_unit) !== plan.dumpTruckClass) {
      return { ok: false, reason: `Class ${unit.class_unit || '—'} tidak sesuai rencana ${plan.dumpTruckUnit?.class_unit || '—'}.` };
    }
    if (!plan.job || normalize(assignedJob) !== normalize(plan.job)) {
      return { ok: false, reason: `JOB unit ${assignedJob || 'belum diisi'} tidak sesuai ${plan.job || 'JOB fleet belum tersedia'}.` };
    }
    const modelWarning = Boolean(plan.dumpTruckModel && normalize(unit.tipe_alat) !== plan.dumpTruckModel);
    return {
      ok: true,
      reason: '',
      modelWarning,
      warning: modelWarning ? `Model ${unit.tipe_alat || '—'} berbeda dari rencana ${plan.dumpTruckUnit?.tipe_alat || '—'}.` : '',
    };
  }

  function dumpTruckGuidance(plan) {
    const model = String(plan?.dumpTruckUnit?.tipe_alat || '').trim();
    const unitClass = String(plan?.dumpTruckUnit?.class_unit || '').trim();
    if (!model && !unitClass) return 'Class Dump Truck belum diatur di Fleet Planning';
    return `Class wajib: ${unitClass || '—'}${model ? ` • Model rencana: ${model}` : ''}`;
  }

  function assignmentStore(id) {
    state.assignments[id] ||= {};
    return state.assignments[id];
  }

  function dozerFleetStore(id) {
    state.dozerFleetAssignments[id] ||= {};
    return state.dozerFleetAssignments[id];
  }

  function dozerAssignmentsForDay(id, key) {
    const allocations = state.dozerFleetAssignments?.[id]?.[key];
    return Array.isArray(allocations) ? allocations : [];
  }

  function isCompatibleDozerUom(uom) {
    const value = normalize(uom).replace(/\s+/g, '');
    return ['bcm/hr', 'bcm/jam', 'bcm/hour', 'bcm/h', 'bcmperhour'].includes(value);
  }

  function dozerCapacity(unit) {
    const value = Number(String(unit?.kapasitas_unit ?? '').replace(',', '.'));
    return Number.isFinite(value) && value >= 0 && isCompatibleDozerUom(unit?.kapasitas_unit_uom)
      ? value : null;
  }

  function canShareDozerInArea(allocations, area) {
    return (allocations || []).every(item => normalize(item?.area) === normalize(area));
  }

  function assignmentSignature(assignment) {
    if (!assignment) return '';
    return [assignment.role || '', assignment.area || '', assignment.fleetPlanId || ''].join('|');
  }

  function summarizeAssignments(store, keys) {
    const values = keys.map(key => store?.[key]).filter(Boolean);
    const signatures = [...new Set(values.map(assignmentSignature))];
    return {
      count: values.length,
      total: keys.length,
      assignment: signatures.length === 1 ? values[0] : null,
      mixed: signatures.length > 1,
      empty: values.length === 0,
      partial: values.length > 0 && values.length < keys.length,
    };
  }

  function classifyQueueUnit(unit) {
    if (isDumpTruck(unit)) return 'dump-truck';
    if (isExcavator(unit)) return 'excavator-support';
    if (isDozer(unit)) return 'dozer-support';
    return 'support';
  }

  function snapshotAssignments() {
    return JSON.parse(JSON.stringify({
      assignments: state.assignments || {},
      dozerFleetAssignments: state.dozerFleetAssignments || {},
    }));
  }

  function restoreAssignments(snapshot) {
    state.assignments = snapshot?.assignments || {};
    state.dozerFleetAssignments = snapshot?.dozerFleetAssignments || {};
  }

  function pushHistory() {
    state.undoStack.push(snapshotAssignments());
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.redoStack = [];
  }

  function loaderIdsForDays(instances = activeInstances()) {
    return new Set(instances.map(instance => unitId(instance.plan.loaderUnit)).filter(Boolean));
  }

  function unitSummary(unit) {
    return summarizeAssignments(state.assignments[unitId(unit)] || {}, targetDays().map(part => dateKey(part.year, part.month, part.day)));
  }

  function dozerFleetSummary(unit, keys = targetDays().map(part => dateKey(part.year, part.month, part.day))) {
    const id = unitId(unit);
    const values = keys.map(key => dozerAssignmentsForDay(id, key));
    const count = values.filter(value => value.length > 0).length;
    const areas = new Set(values.flat().map(item => normalize(item.area)).filter(Boolean));
    return {
      count,
      total: keys.length,
      empty: count === 0,
      partial: count > 0 && count < keys.length,
      mixed: areas.size > 1,
      allocations: values.flat(),
    };
  }

  function assignmentMatchesInstance(assignment, instance) {
    return assignment?.role === 'dump-truck'
      && assignment.fleetPlanId === instance.plan.id
      && normalize(assignment.area) === normalize(instance.area);
  }

  function assignedUnitsForInstance(instance) {
    return equipment.filter(unit => isDumpTruck(unit)).map(unit => ({
      unit,
      summary: unitSummary(unit),
      compatibility: strictDumpTruckCompatibility(unit, instance.plan),
    }))
      .filter(item => item.summary.assignment
        && assignmentMatchesInstance(item.summary.assignment, instance)
        && item.compatibility.ok);
  }

  function assignedDozersForInstance(instance) {
    return equipment.filter(isDozer).map(unit => {
      const summary = dozerFleetSummary(unit, instance.dayKeys);
      return { unit, summary };
    }).filter(item => item.summary.allocations.some(allocation => allocation.fleetPlanId === instance.plan.id
      && normalize(allocation.area) === normalize(instance.area)));
  }

  function assignedSupportForArea(area) {
    return equipment.map(unit => ({ unit, summary: unitSummary(unit) }))
      .filter(item => item.summary.assignment
        && !isDumpTruck(item.unit)
        && item.summary.assignment.role !== 'dump-truck'
        && normalize(item.summary.assignment.area) === normalize(area));
  }

  function dozerReference(instance) {
    const fleetRate = Number(instance.plan?.computed?.fleetProductivity);
    if (!Number.isFinite(fleetRate) || fleetRate <= 0) return { label: 'Fleet productivity belum tersedia', tone: 'muted' };
    const scopedInstances = activeInstances();
    let shareTotal = 0;
    let measuredDays = 0;
    instance.dayKeys.forEach(key => {
      let dayShare = 0;
      equipment.filter(isDozer).forEach(unit => {
        const capacity = dozerCapacity(unit);
        if (capacity === null) return;
        const activePlanIds = new Set(scopedInstances.filter(item => item.dayKeys.includes(key)
          && normalize(item.area) === normalize(instance.area) && isObRemoval(item.plan)).map(item => item.plan.id));
        const allocations = dozerAssignmentsForDay(unitId(unit), key)
          .filter(item => normalize(item.area) === normalize(instance.area) && activePlanIds.has(item.fleetPlanId));
        if (!allocations.some(item => item.fleetPlanId === instance.plan.id)) return;
        const supportedPlans = new Set(allocations.map(item => item.fleetPlanId));
        const demand = [...supportedPlans].reduce((sum, planId) => {
          const plan = plans.find(item => item.id === planId);
          const rate = Number(plan?.computed?.fleetProductivity);
          return sum + (Number.isFinite(rate) && rate > 0 ? rate : 0);
        }, 0);
        dayShare += demand > 0 ? capacity * fleetRate / demand : 0;
      });
      shareTotal += dayShare;
      measuredDays += 1;
    });
    const effectiveRate = measuredDays ? shareTotal / measuredDays : 0;
    const format = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(value);
    if (!effectiveRate) return { label: 'Belum ada Dozer BCM/Hr', tone: 'muted' };
    return {
      label: `Referensi Dozer ${format(effectiveRate)} / Fleet ${format(fleetRate)} BCM/Hr`,
      tone: effectiveRate < fleetRate ? 'warning' : 'ok',
      note: effectiveRate < fleetRate ? 'Kapasitas Dozer di bawah kebutuhan Fleet' : 'Kapasitas Dozer memadai',
    };
  }

  function validSummaryDestination(unit, summary, instances) {
    if (isDozer(unit)) {
      const dozerSummary = dozerFleetSummary(unit);
      if (!dozerSummary.empty && !summary.empty) return false;
      return !dozerSummary.empty || (summary?.assignment && !summary.mixed
        && summary.assignment.role !== 'dump-truck'
        && availableAreas().some(area => normalize(area) === normalize(summary.assignment.area)));
    }
    if (!summary?.assignment || summary.mixed) return false;
    const assignment = summary.assignment;
    if (assignment.role === 'dump-truck') {
      const instance = instances.find(item => assignmentMatchesInstance(assignment, item));
      return Boolean(instance && strictDumpTruckCompatibility(unit, instance.plan).ok);
    }
    return !isDumpTruck(unit) && availableAreas().some(area => normalize(area) === normalize(assignment.area));
  }

  function setStatus(message, tone = 'ok') {
    const host = document.getElementById('unitMappingStatus');
    if (!host) return;
    host.textContent = message;
    host.dataset.tone = tone;
  }

  function applyUnitAssignment(id, destination) {
    const unit = equipment.find(item => unitId(item) === id);
    if (!unit) return { ok: false, reason: 'Unit tidak ditemukan.' };
    const instances = activeInstances();
    if (loaderIdsForDays(instances).has(id)) return { ok: false, reason: 'Loader produksi merupakan anchor read-only dari PIT Area Setup.' };
    const days = targetDays();
    const store = assignmentStore(id);
    const dozerStore = dozerFleetStore(id);

    if (destination.type === 'queue') {
      pushHistory();
      days.forEach(part => {
        const key = dateKey(part.year, part.month, part.day);
        delete store[key];
        delete dozerStore[key];
      });
      return { ok: true };
    }

    if (destination.type === 'fleet') {
      const instance = instances.find(item => item.key === destination.instanceKey);
      if (!instance) return { ok: false, reason: 'Fleet tidak aktif pada periode atau area ini.' };
      if (isDozer(unit)) {
        if (!isObRemoval(instance.plan)) return { ok: false, reason: 'Dozer hanya dapat menjadi support pada fleet dengan JOB OB Removal.' };
        const conflicts = instance.dayKeys.some(key => !canShareDozerInArea(dozerAssignmentsForDay(id, key), instance.area));
        if (conflicts) return { ok: false, reason: 'Dozer sudah diplot pada fleet di area lain dalam periode yang sama.' };
        pushHistory();
        instance.dayKeys.forEach(key => {
          delete store[key];
          const allocations = dozerAssignmentsForDay(id, key);
          if (!allocations.some(item => item.fleetPlanId === instance.plan.id && normalize(item.area) === normalize(instance.area))) {
            dozerStore[key] = [...allocations, { role: 'dozer-support', area: instance.area, fleetPlanId: instance.plan.id }];
          }
        });
        return { ok: true };
      }
      const compatible = strictDumpTruckCompatibility(unit, instance.plan);
      if (!compatible.ok) return compatible;
      pushHistory();
      days.forEach(part => {
        const key = dateKey(part.year, part.month, part.day);
        delete store[key];
        delete dozerStore[key];
      });
      instance.dayKeys.forEach(key => { store[key] = { role: 'dump-truck', area: instance.area, fleetPlanId: instance.plan.id }; });
      return { ok: true, warning: compatible.warning };
    }

    if (destination.type === 'area') {
      if (isDumpTruck(unit)) return { ok: false, reason: 'Dump Truck harus dialokasikan ke fleet, bukan langsung ke area support.' };
      if (!availableAreas().some(area => normalize(area) === normalize(destination.area))) return { ok: false, reason: 'Area tidak tersedia pada List Equipment.' };
      pushHistory();
      days.forEach(part => {
        const key = dateKey(part.year, part.month, part.day);
        delete dozerStore[key];
        store[key] = {
          role: isExcavator(unit) ? 'excavator-support' : 'support',
          area: destination.area,
          fleetPlanId: '',
        };
      });
      return { ok: true };
    }
    return { ok: false, reason: 'Tujuan alokasi tidak dikenali.' };
  }

  function unitCard(unit, summary, options = {}) {
    const category = classifyQueueUnit(unit);
    const coverage = summary && summary.count > 0 && summary.count < summary.total ? `${summary.count}/${summary.total} hari` : '';
    const capacity = isDozer(unit) ? dozerCapacity(unit) : null;
    const capacityLabel = isDozer(unit)
      ? (capacity === null ? `${unit?.kapasitas_unit ?? '—'} • set UoM` : `${capacity} BCM/Hr`)
      : (unit.class_unit || unit.kelas_alat || '—');
    return `<article class="um-unit-card um-unit-card--${category}" draggable="${options.locked ? 'false' : 'true'}" data-unit-drag="${escapeHtml(unitId(unit))}" title="${escapeHtml(options.locked ? 'Loader aktif — read only' : `${unit.kode_alat} • ${unit.tipe_alat || 'Tanpa model'}`)}">
      <div class="um-unit-card__main"><strong>${escapeHtml(unit.kode_alat || '—')}</strong><small>${escapeHtml(unit.tipe_alat || 'Model belum diisi')}</small></div>
      <div class="um-unit-card__meta"><span>${escapeHtml(capacityLabel)}</span>${coverage ? `<em>${coverage}</em>` : ''}${options.badge ? `<em class="${options.badge.tone === 'warning' ? 'is-warning' : ''}">${escapeHtml(options.badge.label)}</em>` : ''}${options.locked ? '<em class="is-locked">Anchor</em>' : ''}</div>
    </article>`;
  }

  function renderQueue(instances) {
    const host = document.getElementById('unitMappingQueue');
    if (!host) return;
    const loaderIds = loaderIdsForDays(instances);
    const cards = { 'excavator-support': [], 'dump-truck': [], 'dozer-support': [], support: [], mixed: [] };
    equipment.forEach(unit => {
      const id = unitId(unit);
      if (!id || loaderIds.has(id)) return;
      const summary = unitSummary(unit);
      const dozerSummary = isDozer(unit) ? dozerFleetSummary(unit) : null;
      if (validSummaryDestination(unit, summary, instances)) return;
      if (state.search && !normalize(`${unit.kode_alat} ${unit.kelas_alat} ${unit.class_unit} ${unit.tipe_alat}`).includes(normalize(state.search))) return;
      const hasConflict = summary.mixed || (isDozer(unit) && !summary.empty && !dozerSummary.empty)
        || (!summary.empty && !validSummaryDestination(unit, summary, instances));
      const category = hasConflict ? 'mixed' : classifyQueueUnit(unit);
      if (state.queueFilter !== 'all' && state.queueFilter !== category) return;
      cards[category].push(unitCard(unit, summary));
    });
    const section = (label, key, color) => `<div class="um-queue-section"><div class="um-queue-section__head"><span style="--queue-color:${color}">${escapeHtml(label)}</span><b>${cards[key].length}</b></div><div class="um-card-list">${cards[key].join('') || '<small class="um-empty">Tidak ada unit</small>'}</div></div>`;
    host.innerHTML = `<aside class="um-queue-panel">
      <div class="um-queue-title"><div><h3>Unit Queue</h3><small>Drag unit ke area atau fleet</small></div><span>${Object.values(cards).reduce((sum, list) => sum + list.length, 0)}</span></div>
      <div class="um-queue-drop" data-unit-drop="queue">↩ Lepaskan di sini untuk mengembalikan unit</div>
      <div class="um-queue-scroll" aria-label="Daftar unit antre">
        ${section('Excavator Support', 'excavator-support', '#7c3aed')}
        ${section('Dump Truck', 'dump-truck', '#0284c7')}
        ${section('Dozer Support', 'dozer-support', '#d97706')}
        ${section('Support Equipment', 'support', '#16a34a')}
        ${cards.mixed.length ? section('Mixed Allocation', 'mixed', '#dc2626') : ''}
      </div>
    </aside>`;
  }

  function renderFleetCard(instance) {
    const plan = instance.plan;
    const assigned = assignedUnitsForInstance(instance);
    const dozers = isObRemoval(plan) ? assignedDozersForInstance(instance) : [];
    const complete = assigned.filter(item => !item.summary.partial).length;
    const shortage = Math.max(0, plan.requiredTrucks - complete);
    const reference = isObRemoval(plan) ? dozerReference(instance) : null;
    const truckGuidance = dumpTruckGuidance(plan);
    return `<section class="um-fleet-card" data-fleet-instance="${escapeHtml(instance.key)}">
      <div class="um-fleet-card__head">
        <div><strong>${escapeHtml(plan.loaderCode)}</strong><small>${plan.type === 'coal' ? 'Coal' : 'OB'} • ${escapeHtml(plan.job || 'JOB belum diisi')} • ${escapeHtml(plan.values.material || 'Material belum diisi')}</small></div>
        <span class="${shortage ? 'is-short' : 'is-ready'}">DT ${complete}/${plan.requiredTrucks}</span>
      </div>
      <div class="um-loader-anchor">${unitCard(plan.loaderUnit || { kode_alat: plan.loaderCode }, null, { locked: true })}</div>
      <div class="um-drop-zone um-drop-zone--fleet ${shortage ? 'needs-unit' : ''}" data-unit-drop="fleet" data-instance-key="${escapeHtml(instance.key)}">
        <div class="um-drop-zone__label">Dump Truck Composition <small>${instance.dayKeys.length} hari aktif</small></div>
        <div class="um-card-list">${assigned.map(item => unitCard(item.unit, item.summary, item.compatibility.modelWarning ? { badge: { label: 'Model beda', tone: 'warning' } } : {})).join('') || `<small class="um-empty um-empty--guide">Drop Dump Truck dengan Class yang kompatibel di sini<strong>${escapeHtml(truckGuidance)}</strong></small>`}</div>
      </div>
      ${isObRemoval(plan) ? `<div class="um-drop-zone um-drop-zone--dozer" data-unit-drop="fleet" data-instance-key="${escapeHtml(instance.key)}">
        <div class="um-drop-zone__label">Dozer Support <small>${reference?.note || 'Acuan kemampuan, tidak memengaruhi produksi'}</small></div>
        <div class="um-card-list">${dozers.map(item => unitCard(item.unit, item.summary, { badge: { label: 'Support', tone: reference?.tone } })).join('') || '<small class="um-empty">Drop Dozer untuk acuan dukungan OB</small>'}</div>
        <div class="um-dozer-reference is-${escapeHtml(reference?.tone || 'muted')}">${escapeHtml(reference?.label || 'Acuan Dozer belum tersedia')} <small>Read-only • tidak mengubah formula Production Planning</small></div>
      </div>` : ''}
    </section>`;
  }

  function renderBoard(instances) {
    const host = document.getElementById('unitMappingBoard');
    if (!host) return;
    const areas = availableAreas();
    host.innerHTML = `<div class="um-area-board">${areas.map((area, index) => {
      const areaInstances = instances.filter(instance => normalize(instance.area) === normalize(area));
      const support = assignedSupportForArea(area);
      return `<article class="um-area-column um-area-color-${index % 6}">
        <header class="um-area-head"><div><span></span><h3>${escapeHtml(area)}</h3></div><small>${areaInstances.length} fleet aktif</small></header>
        <div class="um-area-fleets">${areaInstances.map(renderFleetCard).join('') || '<div class="um-no-fleet">Tidak ada fleet aktif pada periode ini</div>'}</div>
        <div class="um-drop-zone um-drop-zone--support" data-unit-drop="area" data-area="${escapeHtml(area)}">
          <div class="um-drop-zone__label">Area Support <small>${support.length} unit</small></div>
          <div class="um-card-list">${support.map(item => unitCard(item.unit, item.summary)).join('') || '<small class="um-empty">Drop Excavator Support atau unit support</small>'}</div>
        </div>
      </article>`;
    }).join('') || '<div class="um-board-empty">Belum ada area dari List Equipment.</div>'}</div>`;
  }

  function calculateKpis(instances) {
    const loaderIds = loaderIdsForDays(instances);
    let assigned = 0;
    let unallocated = 0;
    let mixed = 0;
    equipment.forEach(unit => {
      if (loaderIds.has(unitId(unit))) return;
      const summary = unitSummary(unit);
      const dozerSummary = isDozer(unit) ? dozerFleetSummary(unit) : null;
      if (summary.mixed || (isDozer(unit) && !summary.empty && !dozerSummary.empty)
        || (!summary.empty && !validSummaryDestination(unit, summary, instances))) mixed += 1;
      else if (summary.empty) unallocated += 1;
      else assigned += 1;
    });
    const shortage = instances.reduce((sum, instance) => {
      const complete = assignedUnitsForInstance(instance).filter(item => !item.summary.partial).length;
      return sum + Math.max(0, instance.plan.requiredTrucks - complete);
    }, 0);
    return { fleets: instances.length, assigned, unallocated, shortage, mixed };
  }

  function formatRate(value, empty = '—') {
    return Number.isFinite(value) && value > 0
      ? new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
      : empty;
  }

  function formatFleetClassLabel(value) {
    let label = String(value || '').trim();
    if (!label) return 'Class Belum Diisi';
    label = label
      .replace(/^(?:EXCAVATOR|EXC|EX)[\s_-]*/i, '')
      .replace(/(\d)\s*(?:TON|T)\b/gi, '$1 T')
      .replace(/\s+class$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${label || 'Belum Diisi'} Class`;
  }

  function summarizeFleetByClassAndJob(instances) {
    const unique = new Map();
    (instances || []).forEach(instance => {
      const plan = instance?.plan || {};
      const category = plan.type === 'coal' ? 'CG' : 'OB';
      const job = String(plan.job || category).trim();
      const classLabel = formatFleetClassLabel(plan.loaderUnit?.class_unit);
      const key = [category, normalize(job), normalize(plan.loaderCode), normalize(classLabel)].join('|');
      if (!unique.has(key)) unique.set(key, { category, classLabel });
    });
    const grouped = { OB: new Map(), CG: new Map() };
    unique.forEach(item => grouped[item.category].set(
      item.classLabel,
      (grouped[item.category].get(item.classLabel) || 0) + 1,
    ));
    const rows = category => [...grouped[category].entries()]
      .map(([classLabel, count]) => ({ classLabel, count }))
      .sort((a, b) => a.classLabel.localeCompare(b.classLabel, 'id-ID', { numeric: true, sensitivity: 'base' }));
    return { OB: rows('OB'), CG: rows('CG') };
  }

  function areaOverview(area, areaInstances) {
    const obRate = areaInstances.filter(instance => instance.plan.type === 'ob')
      .reduce((sum, instance) => sum + (Number(instance.plan.computed?.fleetProductivity) || 0), 0);
    const coalRate = areaInstances.filter(instance => instance.plan.type === 'coal')
      .reduce((sum, instance) => sum + (Number(instance.plan.computed?.fleetProductivity) || 0), 0);
    const activePlanIds = new Set(areaInstances.map(instance => instance.plan.id));
    const dozers = equipment.filter(isDozer).filter(unit => targetDays().some(part => {
      const key = dateKey(part.year, part.month, part.day);
      return dozerAssignmentsForDay(unitId(unit), key).some(allocation => normalize(allocation.area) === normalize(area)
        && activePlanIds.has(allocation.fleetPlanId));
    }));
    const support = assignedSupportForArea(area);
    const rows = [];
    areaInstances.forEach(instance => {
      const planLabel = `${instance.plan.loaderCode} • ${instance.plan.type === 'coal' ? 'CG' : 'OB'}`;
      rows.push({ code: instance.plan.loaderCode, role: 'Fleet Loader', fleet: planLabel, note: instance.plan.values.material || 'Material belum diisi' });
      assignedUnitsForInstance(instance).forEach(item => rows.push({
        code: item.unit.kode_alat,
        role: item.compatibility.modelWarning ? 'Dump Truck • Model beda' : 'Dump Truck',
        fleet: planLabel,
        note: item.unit.class_unit || 'Class belum diisi',
      }));
      assignedDozersForInstance(instance).forEach(item => rows.push({
        code: item.unit.kode_alat,
        role: 'Dozer Support',
        fleet: planLabel,
        note: dozerCapacity(item.unit) === null ? 'Set UoM BCM/Hr' : `${formatRate(dozerCapacity(item.unit))} BCM/Hr`,
      }));
    });
    support.forEach(item => rows.push({
      code: item.unit.kode_alat,
      role: isDozer(item.unit) ? 'Dozer Area Support' : (isExcavator(item.unit) ? 'Excavator Support' : 'Area Support'),
      fleet: 'Area Support',
      note: item.unit.tipe_alat || item.unit.class_unit || '—',
    }));
    const fleetUnits = areaInstances.flatMap(instance => {
      const fleet = `${instance.plan.loaderCode} • ${instance.plan.type === 'coal' ? 'CG' : 'OB'}`;
      return [
        { code: instance.plan.loaderCode, role: 'Fleet Loader', note: `${fleet} • ${instance.plan.values.material || 'Material belum diisi'}` },
        ...assignedUnitsForInstance(instance).map(item => ({
          code: item.unit.kode_alat,
          role: item.compatibility.modelWarning ? 'Dump Truck • Model beda' : 'Dump Truck',
          note: `${fleet} • ${item.unit.class_unit || 'Class belum diisi'}`,
        })),
      ];
    });
    const fleetGroups = areaInstances.map(instance => {
      const fleetLabel = `${instance.plan.type === 'coal' ? 'CG' : 'OB'} • ${instance.plan.values.material || 'Material belum diisi'}`;
      return {
        instanceKey: instance.key,
        type: instance.plan.type,
        code: instance.plan.loaderCode,
        label: fleetLabel,
        items: [
          { id: unitId(instance.plan.loaderUnit) || instance.plan.loaderCode, code: instance.plan.loaderCode, role: 'Fleet Loader', note: `${fleetLabel} • Loader Anchor`, locked: true },
          ...assignedUnitsForInstance(instance).map(item => ({
            id: unitId(item.unit),
            code: item.unit.kode_alat,
            role: item.compatibility.modelWarning ? 'Dump Truck • Model beda' : 'Dump Truck',
            note: `${instance.plan.loaderCode} • ${item.unit.class_unit || 'Class belum diisi'}`,
          })),
        ],
        dozerItems: assignedDozersForInstance(instance).map(item => ({
          id: unitId(item.unit),
          code: item.unit.kode_alat,
          role: 'Dozer Support',
          note: dozerCapacity(item.unit) === null ? 'Set UoM BCM/Hr' : `${formatRate(dozerCapacity(item.unit))} BCM/Hr`,
        })),
      };
    });
    const dozerUnits = dozers.map(unit => {
      const fleetNames = new Set(targetDays().flatMap(part => dozerAssignmentsForDay(unitId(unit), dateKey(part.year, part.month, part.day))
        .filter(allocation => normalize(allocation.area) === normalize(area) && activePlanIds.has(allocation.fleetPlanId))
        .map(allocation => plans.find(plan => plan.id === allocation.fleetPlanId)?.loaderCode)).filter(Boolean));
      return {
        code: unit.kode_alat,
        role: 'Dozer Support',
        note: `${[...fleetNames].join(', ') || 'Fleet OB'} • ${dozerCapacity(unit) === null ? 'Set UoM BCM/Hr' : `${formatRate(dozerCapacity(unit))} BCM/Hr`}`,
      };
    });
    const supportUnits = support.map(item => ({
      id: unitId(item.unit),
      code: item.unit.kode_alat,
      role: isDozer(item.unit) ? 'Dozer Area Support' : (isExcavator(item.unit) ? 'Excavator Support' : 'Area Support'),
      note: item.unit.tipe_alat || item.unit.class_unit || '—',
    }));
    const capacity = dozers.reduce((sum, unit) => sum + (dozerCapacity(unit) || 0), 0);
    return {
      obRate,
      coalRate,
      dozers,
      dozerCapacity: capacity,
      dozerMissingUom: dozers.filter(unit => dozerCapacity(unit) === null).length,
      support,
      rows,
      fleetUnits,
      fleetGroups,
      dozerUnits,
      supportUnits,
      fleetClassSummary: summarizeFleetByClassAndJob(areaInstances),
      unitCount: fleetUnits.length + dozerUnits.length + supportUnits.length,
    };
  }

  function renderKpis(instances) {
    const host = document.getElementById('unitMappingKpis');
    if (!host) return;
    const areas = availableAreas();
    host.innerHTML = areas.map((area, index) => {
      const areaInstances = instances.filter(instance => normalize(instance.area) === normalize(area));
      const overview = areaOverview(area, areaInstances);
      const unitItem = item => `<button type="button" class="um-allocation-item ${item.locked ? 'is-anchor' : ''}" draggable="${item.locked ? 'false' : 'true'}"${item.locked ? '' : ` data-unit-drag="${escapeHtml(item.id || item.code)}"`} data-unit-matrix data-code="${escapeHtml(item.code)}" data-role="${escapeHtml(item.role)}" data-note="${escapeHtml(item.note)}" aria-label="${escapeHtml(`${item.code}: ${item.role}. ${item.note}`)}"><span>${escapeHtml(item.code)}</span><small>${escapeHtml(item.role)}</small></button>`;
      const fleetLane = group => {
        const tone = group.type === 'coal' ? 'cg' : 'ob';
        const jobLabel = group.type === 'coal' ? 'Fleet CG' : 'Fleet OB';
        const dozerPocket = group.type === 'coal' ? '' : `<div class="um-dozer-drop-pocket" data-unit-drop="fleet" data-instance-key="${escapeHtml(group.instanceKey)}" data-accept="dozer">
          <div><strong>Dozer Support</strong><small>Acuan dukungan • tidak mengubah produksi</small></div>
          <div class="um-dozer-drop-pocket__list">${group.dozerItems.map(unitItem).join('') || '<small>Drop Dozer di sini</small>'}</div>
        </div>`;
        return `<section class="um-allocation-lane is-${tone}" data-unit-drop="fleet" data-instance-key="${escapeHtml(group.instanceKey)}" data-accept="dump-truck">
          <header><div><small>${jobLabel}</small><strong>${escapeHtml(`${group.code} • ${group.label}`)}</strong></div><span>${group.items.length + group.dozerItems.length}</span></header>
          <div class="um-allocation-lane__list">${group.items.map(unitItem).join('') || '<small class="um-allocation-lane__empty">Drop Dump Truck di sini</small>'}</div>
          ${dozerPocket}
        </section>`;
      };
      const supportLane = `<section class="um-allocation-lane is-support" data-unit-drop="area" data-area="${escapeHtml(area)}" data-accept="support">
        <header><div><small>Support Area</small><strong>${escapeHtml(area)}</strong></div><span>${overview.supportUnits.length}</span></header>
        <div class="um-allocation-lane__list">${overview.supportUnits.map(unitItem).join('') || '<small class="um-allocation-lane__empty">Drop unit support di sini</small>'}</div>
      </section>`;
      const allocationLanes = overview.fleetGroups.map(fleetLane).join('') + supportLane;
      const fleetClassGroup = category => {
        const rows = overview.fleetClassSummary[category];
        return `<section class="um-fleet-class-group is-${category.toLowerCase()}"><b>${category}</b><div>${rows.map(row => `<span><strong>${row.count}</strong> Fleet <em>${escapeHtml(row.classLabel)}</em></span>`).join('') || '<span>Belum ada fleet</span>'}</div></section>`;
      };
      const dozerNote = overview.dozers.length
        ? `${overview.dozers.length} Dozer${overview.dozerMissingUom ? ` • ${overview.dozerMissingUom} UoM belum BCM/Hr` : ''}`
        : 'Belum ada Dozer fleet';
      return `<article class="um-area-kpi um-area-color-${index % 6}">
        <header><div><span></span><h3>${escapeHtml(area)}</h3></div><small>${areaInstances.length} fleet aktif • ${overview.support.length} support area</small></header>
        <div class="um-area-kpi__metrics">
          <div><small>Total Productivity Fleet OB</small><strong>${formatRate(overview.obRate)}</strong><span>BCM/Hr</span></div>
          <div><small>Total Productivity Fleet CG</small><strong>${formatRate(overview.coalRate)}</strong><span>Ton/Hr</span></div>
          <div><small>Daya Dukung Dozer</small><strong>${formatRate(overview.dozerCapacity)}</strong><span>BCM/Hr • ${escapeHtml(dozerNote)}</span></div>
          <div class="um-fleet-class-summary"><small>Jumlah Fleet Berdasarkan Class &amp; JOB</small><div>${fleetClassGroup('OB')}${fleetClassGroup('CG')}</div></div>
        </div>
        <details class="um-area-kpi__details" open>
          <summary>Unit Deployment <span>${overview.unitCount} unit</span></summary>
          <div class="um-allocation-board">${allocationLanes}</div>
          <div class="um-allocation-selection" data-unit-matrix-selection>Pilih kode unit untuk melihat detail alokasi.</div>
        </details>
      </article>`;
    }).join('') || '<div class="um-board-empty">Belum ada area kerja dari PIT Area Setup.</div>';
  }

  function renderPeriodCaption() {
    const groups = weekGroups(state.activeYear, state.activeMonth);
    if (state.scope === 'day') {
      const date = dateAt(state.activeYear, state.activeMonth, state.activeDay);
      return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (state.scope === 'week') return `${groups[state.activeWeek - 1]?.label || `Week ${state.activeWeek}`} • ${MONTHS[state.activeMonth - 1]} ${state.activeYear}`;
    return `${MONTHS[state.activeMonth - 1]} ${state.activeYear}`;
  }

  function syncControls() {
    const year = document.getElementById('unitMappingYear');
    const month = document.getElementById('unitMappingMonth');
    const scope = document.getElementById('unitMappingScope');
    const week = document.getElementById('unitMappingWeek');
    const day = document.getElementById('unitMappingDay');
    if (year) {
      year.innerHTML = Array.from({ length: state.endYear - state.startYear + 1 }, (_, index) => `<option value="${state.startYear + index}">${state.startYear + index}</option>`).join('');
      year.value = String(state.activeYear);
    }
    if (month) {
      month.innerHTML = MONTHS.map((label, index) => `<option value="${index + 1}">${label}</option>`).join('');
      month.value = String(state.activeMonth);
    }
    if (scope) scope.value = state.scope;
    const groups = weekGroups(state.activeYear, state.activeMonth);
    state.activeWeek = Math.min(Math.max(1, state.activeWeek), groups.length || 1);
    if (week) {
      week.innerHTML = groups.map((group, index) => `<option value="${index + 1}">${escapeHtml(group.label)} (${group.days[0]}–${group.days[group.days.length - 1]} ${MONTHS[state.activeMonth - 1]})</option>`).join('');
      week.value = String(state.activeWeek);
      week.closest('label').hidden = state.scope !== 'week';
    }
    state.activeDay = Math.min(Math.max(1, state.activeDay), daysInMonth(state.activeYear, state.activeMonth));
    if (day) {
      day.innerHTML = Array.from({ length: daysInMonth(state.activeYear, state.activeMonth) }, (_, index) => `<option value="${index + 1}">${index + 1} ${MONTHS[state.activeMonth - 1]}</option>`).join('');
      day.value = String(state.activeDay);
      day.closest('label').hidden = state.scope !== 'day';
    }
    const caption = document.getElementById('unitMappingPeriodCaption');
    if (caption) caption.textContent = renderPeriodCaption();
    const undo = document.getElementById('unitMappingUndo');
    const redo = document.getElementById('unitMappingRedo');
    if (undo) undo.disabled = state.undoStack.length === 0;
    if (redo) redo.disabled = state.redoStack.length === 0;
  }

  function render() {
    syncControls();
    const instances = activeInstances();
    renderKpis(instances);
    renderQueue(instances);
  }

  function save(immediate = false) {
    clearTimeout(saveTimer);
    const draft = { savedAt: new Date().toISOString(), assignments: state.assignments, dozerFleetAssignments: state.dozerFleetAssignments };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (error) { console.warn('Draft Unit Mapping tidak dapat disimpan:', error); }
    const persist = async () => {
      setStatus('Menyimpan…', 'pending');
      try {
        const response = await fetch(api('/api/admin/production/productivity-plans/unit-mapping'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify({ contentHtml: '<div data-unit-mapping-storage="true"></div>', planningData: { version: 2, assignments: state.assignments, dozerFleetAssignments: state.dozerFleetAssignments } }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        try { localStorage.removeItem(DRAFT_KEY); } catch (error) { console.warn('Draft Unit Mapping tidak dapat dibersihkan:', error); }
        setStatus('Tersimpan', 'ok');
      } catch (error) {
        console.error('Gagal menyimpan Unit Mapping:', error);
        setStatus('Gagal menyimpan — draft lokal aman', 'error');
      }
    };
    if (immediate) return persist();
    saveTimer = setTimeout(persist, 350);
    return null;
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(snapshotAssignments());
    restoreAssignments(state.undoStack.pop());
    render();
    save(true);
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(snapshotAssignments());
    restoreAssignments(state.redoStack.pop());
    render();
    save(true);
  }

  function autoAllocateDumpTrucks() {
    const instances = activeInstances();
    const loaderByDay = new Map();
    instances.forEach(instance => instance.dayKeys.forEach(key => {
      loaderByDay.set(key, (loaderByDay.get(key) || new Set()).add(unitId(instance.plan.loaderUnit)));
    }));
    const before = snapshotAssignments();
    let allocated = 0;
    instances.forEach(instance => instance.dayKeys.forEach(key => {
      const already = equipment.filter(unit => assignmentMatchesInstance(state.assignments[unitId(unit)]?.[key], instance)).length;
      let needed = Math.max(0, instance.plan.requiredTrucks - already);
      if (!needed) return;
      const candidates = equipment.filter(unit => isDumpTruck(unit)
        && !loaderByDay.get(key)?.has(unitId(unit))
        && !state.assignments[unitId(unit)]?.[key]
        && strictDumpTruckCompatibility(unit, instance.plan).ok)
        .sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID'));
      candidates.slice(0, needed).forEach(unit => {
        assignmentStore(unitId(unit))[key] = { role: 'dump-truck', area: instance.area, fleetPlanId: instance.plan.id };
        allocated += 1;
        needed -= 1;
      });
    }));
    if (!allocated) {
      restoreAssignments(before);
      setStatus('Tidak ada DT kompatibel yang dapat dialokasikan', 'warning');
      return;
    }
    state.undoStack.push(before);
    state.redoStack = [];
    render();
    save(true);
    setStatus(`${allocated} assignment harian DT berhasil dibuat`, 'ok');
  }

  function previousDateForTarget(part, targetLength) {
    const current = dateAt(part.year, part.month, part.day);
    if (state.scope === 'month') {
      const previousMonth = new Date(part.year, part.month - 2, 1);
      const previousDay = Math.min(part.day, daysInMonth(previousMonth.getFullYear(), previousMonth.getMonth() + 1));
      return { year: previousMonth.getFullYear(), month: previousMonth.getMonth() + 1, day: previousDay };
    }
    current.setDate(current.getDate() - targetLength);
    return toDatePart(current);
  }

  function copyPreviousPeriod() {
    const days = targetDays();
    const areas = new Set(availableAreas().map(normalize));
    const before = snapshotAssignments();
    let copied = 0;
    equipment.forEach(unit => {
      const id = unitId(unit);
      const store = state.assignments[id] || {};
      days.forEach(part => {
        const target = dateKey(part.year, part.month, part.day);
        const previous = previousDateForTarget(part, days.length);
        const source = store[dateKey(previous.year, previous.month, previous.day)];
        delete store[target];
        if (!source || !areas.has(normalize(source.area))) return;
        if (source.role === 'dump-truck') {
          const active = findActiveFleetInstances(plans, periodicSelections, pitAssignments, [part])
            .find(instance => instance.plan.id === source.fleetPlanId && normalize(instance.area) === normalize(source.area));
          if (!active || !strictDumpTruckCompatibility(unit, active.plan).ok) return;
        } else if (isDumpTruck(unit)) return;
        state.assignments[id] ||= store;
        store[target] = { ...source };
        copied += 1;
      });
    });
    equipment.filter(isDozer).forEach(unit => {
      const id = unitId(unit);
      const store = state.dozerFleetAssignments[id] || {};
      days.forEach(part => {
        const target = dateKey(part.year, part.month, part.day);
        const previous = previousDateForTarget(part, days.length);
        const source = Array.isArray(store[dateKey(previous.year, previous.month, previous.day)])
          ? store[dateKey(previous.year, previous.month, previous.day)] : [];
        delete store[target];
        if (!source.length || !canShareDozerInArea(source, source[0].area)) return;
        const active = findActiveFleetInstances(plans, periodicSelections, pitAssignments, [part]);
        const valid = source.filter(allocation => {
          const instance = active.find(item => item.plan.id === allocation.fleetPlanId
            && normalize(item.area) === normalize(allocation.area));
          return Boolean(instance && isObRemoval(instance.plan));
        });
        if (!valid.length || !canShareDozerInArea(valid, valid[0].area)) return;
        state.dozerFleetAssignments[id] ||= store;
        store[target] = valid.map(allocation => ({ ...allocation, role: 'dozer-support' }));
        copied += valid.length;
      });
    });
    if (!copied) {
      restoreAssignments(before);
      setStatus('Periode sebelumnya tidak memiliki mapping valid untuk disalin', 'warning');
      return;
    }
    state.undoStack.push(before);
    state.redoStack = [];
    render();
    save(true);
    setStatus(`${copied} assignment harian berhasil disalin`, 'ok');
  }

  function bindOnce() {
    const panel = document.getElementById('tab-prodUnitMapping');
    if (!panel || panel.dataset.unitMappingBound) return;
    panel.dataset.unitMappingBound = 'true';
    panel.addEventListener('change', event => {
      if (event.target.matches('#unitMappingYear')) state.activeYear = Number(event.target.value);
      else if (event.target.matches('#unitMappingMonth')) { state.activeMonth = Number(event.target.value); state.activeWeek = 1; state.activeDay = 1; }
      else if (event.target.matches('#unitMappingScope')) state.scope = event.target.value;
      else if (event.target.matches('#unitMappingWeek')) state.activeWeek = Number(event.target.value);
      else if (event.target.matches('#unitMappingDay')) state.activeDay = Number(event.target.value);
      else if (event.target.matches('#unitMappingQueueFilter')) state.queueFilter = event.target.value;
      else return;
      render();
    });
    panel.addEventListener('input', event => {
      if (!event.target.matches('#unitMappingSearch')) return;
      state.search = event.target.value;
      renderQueue(activeInstances());
    });
    panel.addEventListener('click', event => {
      const matrixCell = event.target.closest('[data-unit-matrix]');
      if (matrixCell) {
        const card = matrixCell.closest('.um-area-kpi');
        card?.querySelectorAll('[data-unit-matrix]').forEach(cell => cell.classList.toggle('is-selected', cell === matrixCell));
        const selection = card?.querySelector('[data-unit-matrix-selection]');
        if (selection) selection.textContent = `${matrixCell.dataset.code} • ${matrixCell.dataset.role} — ${matrixCell.dataset.note}`;
      } else if (event.target.closest('#unitMappingUndo')) undo();
      else if (event.target.closest('#unitMappingRedo')) redo();
      else if (event.target.closest('#unitMappingAutoAllocate')) autoAllocateDumpTrucks();
      else if (event.target.closest('#unitMappingCopyPrevious')) copyPreviousPeriod();
    });
    panel.addEventListener('dragstart', event => {
      const card = event.target.closest('[data-unit-drag]');
      if (!card || card.getAttribute('draggable') === 'false') return;
      state.dragUnitId = card.dataset.unitDrag;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.dragUnitId);
      card.classList.add('is-dragging');
    });
    panel.addEventListener('dragend', event => {
      event.target.closest('[data-unit-drag]')?.classList.remove('is-dragging');
      panel.querySelectorAll('.is-drag-over').forEach(element => element.classList.remove('is-drag-over'));
      state.dragUnitId = '';
    });
    panel.addEventListener('dragover', event => {
      const zone = event.target.closest('[data-unit-drop]');
      if (!zone) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      zone.classList.add('is-drag-over');
    });
    panel.addEventListener('dragleave', event => {
      const zone = event.target.closest('[data-unit-drop]');
      if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('is-drag-over');
    });
    panel.addEventListener('drop', event => {
      const zone = event.target.closest('[data-unit-drop]');
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove('is-drag-over');
      const id = event.dataTransfer.getData('text/plain') || state.dragUnitId;
      const draggedUnit = equipment.find(unit => unitId(unit) === id);
      const accept = zone.dataset.accept;
      if ((accept === 'dozer' && !isDozer(draggedUnit)) || (accept === 'dump-truck' && !isDumpTruck(draggedUnit))) {
        const reason = accept === 'dozer'
          ? 'Area ini khusus Dozer/Bulldozer support.'
          : 'Komposisi fleet hanya menerima Dump Truck. Gunakan pocket Dozer Support untuk unit Dozer/Bulldozer.';
        setStatus(reason, 'error');
        alert(reason);
        return;
      }
      const destination = zone.dataset.unitDrop === 'fleet'
        ? { type: 'fleet', instanceKey: zone.dataset.instanceKey }
        : zone.dataset.unitDrop === 'area'
          ? { type: 'area', area: zone.dataset.area }
          : { type: 'queue' };
      const result = applyUnitAssignment(id, destination);
      if (!result.ok) {
        setStatus(result.reason, 'error');
        alert(result.reason);
        return;
      }
      render();
      const saveResult = save(true);
      if (result.warning) Promise.resolve(saveResult).then(() => setStatus(`Tersimpan • ${result.warning}`, 'warning'));
    });
  }

  async function loadSources() {
    const paths = [
      '/api/admin/production/master',
      '/api/admin/production/productivity-plans/spo',
      '/api/admin/production/productivity-plans/pa-ua-ewh',
      '/api/admin/production/productivity-plans/ob',
      '/api/admin/production/productivity-plans/coal',
      '/api/admin/production/productivity-plans/fleet-capacity',
      '/api/admin/production/productivity-plans/unit-mapping',
    ];
    const responses = await Promise.all(paths.map(path => fetch(api(path), { headers: auth() })));
    if (!responses[0].ok) throw new Error(`Master HTTP ${responses[0].status}`);
    const [master, spo, pae, ob, coal, fleet, saved] = await Promise.all(responses.map(async response => response.ok ? response.json() : {}));
    equipment = master.equipment || [];
    paAssignments = pae.planningData?.assignments?.PA || {};
    extractSpoPeriod(spo);
    plans = [...parsePlans(ob, 'ob'), ...parsePlans(coal, 'coal')];
    enrichPlans();
    periodicSelections = fleet.planningData?.periodicSelections || {};
    pitAssignments = fleet.planningData?.pitAssignments || {};
    state.assignments = saved.planningData?.assignments || {};
    state.dozerFleetAssignments = saved.planningData?.dozerFleetAssignments || {};
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft && (Date.parse(draft.savedAt || 0) || 0) > (Date.parse(saved.updatedAt || 0) || 0)) {
        state.assignments = draft.assignments || state.assignments;
        state.dozerFleetAssignments = draft.dozerFleetAssignments || state.dozerFleetAssignments;
      }
    } catch (error) { console.warn('Draft Unit Mapping tidak dapat dipulihkan:', error); }
  }

  async function init() {
    bindOnce();
    if (loadingPromise) return loadingPromise;
    setStatus('Memuat sumber data…', 'pending');
    loadingPromise = (async () => {
      try {
        await loadSources();
        render();
        setStatus('Tersinkron', 'ok');
      } catch (error) {
        console.error('Gagal memuat Unit Mapping:', error);
        const host = document.getElementById('unitMappingKpis');
        if (host) host.innerHTML = `<div class="um-load-error">Gagal memuat Unit Mapping: ${escapeHtml(error.message)}</div>`;
        setStatus('Gagal memuat data', 'error');
      } finally {
        loadingPromise = null;
      }
    })();
    return loadingPromise;
  }

  const publicApi = { init, refresh: init };
  if (typeof module !== 'undefined' && module.exports) module.exports = {
    normalize,
    buildTargetDays,
    summarizeAssignments,
    findActiveFleetInstances,
    classifyQueueUnit,
    strictDumpTruckCompatibility,
    dumpTruckGuidance,
    isCompatibleDozerUom,
    canShareDozerInArea,
    formatFleetClassLabel,
    summarizeFleetByClassAndJob,
  };
  global.UnitMappingPlanning = publicApi;
}(typeof window !== 'undefined' ? window : globalThis));
