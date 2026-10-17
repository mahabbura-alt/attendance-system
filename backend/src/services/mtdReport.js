'use strict';

const FORMULA_VERSION = 'mtd-project-performance-v1';
const key = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const sum = rows => rows.reduce((total, value) => total + (number(value) || 0), 0);
const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;
const dateOnly = value => String(value || '').slice(0, 10);

function parseFilters(query = {}) {
  const year = Number(query.year);
  const month = Number(query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw Object.assign(new Error('Periode MTD tidak valid.'), { status: 422 });
  }
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, month, 1));
  const end = endDate.toISOString().slice(0, 10);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const defaultCutoff = today >= start && today < end ? today : new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const cutoff = String(query.cutoff || defaultCutoff);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || cutoff < start || cutoff >= end) {
    throw Object.assign(new Error('Cutoff harus berada di dalam bulan terpilih.'), { status: 422 });
  }
  return {
    year, month, start, end, days, cutoff,
    area: String(query.area || '').trim(), job: String(query.job || '').trim(),
    material: String(query.material || '').trim(), shiftId: String(query.shift_id || '').trim(),
    compare: String(query.compare || '') === '1',
  };
}

function jobType(job) {
  const units = new Set((job?.materials || []).map(material => key(material.unit)));
  if (units.has('ton') && !units.has('bcm')) return 'coal';
  if (units.has('bcm') && !units.has('ton')) return 'ob';
  return null;
}

function matches(value, filter) { return !filter || key(value) === key(filter); }

function emptyDaily(date) {
  return { date, obActual: 0, coalActual: 0, obBcm: 0, coalBcm: 0, obFuel: 0, coalFuel: 0,
    obPlan: 0, coalPlan: 0, hasObActual: false, hasCoalActual: false, hasFuel: false };
}

function aggregateActual(report, filters) {
  const daily = new Map();
  const areas = new Map();
  const fleets = new Map();
  const noteCells = new Map();
  const productionJobs = new Map((report.jobs || []).map(job => [key(job.jobCode), job]));
  let selectedCells = 0; let materialFuelAmbiguous = false;
  for (const table of report.tables || []) {
    if (!matches(table.area, filters.area)) continue;
    for (const row of table.rows || []) {
      if (row.date > filters.cutoff || !matches(row.shiftId, filters.shiftId)) continue;
      const day = daily.get(row.date) || emptyDaily(row.date);
      const area = areas.get(table.area) || { area: table.area, obActual: 0, coalActual: 0, obBcm: 0, coalBcm: 0, obFuel: 0, coalFuel: 0 };
      for (const [jobCode, cell] of Object.entries(row.values || {})) {
        if (!matches(jobCode, filters.job)) continue;
        const job = productionJobs.get(key(jobCode));
        const type = jobType(job);
        if (!type) continue;
        let production = number(cell.production);
        let bcm = number(cell.bcm);
        if (filters.material) {
          const materialEntry = Object.entries(cell.materials || {}).find(([name]) => matches(name, filters.material));
          if (!materialEntry) continue;
          production = number(materialEntry[1]);
          const materialCount = (job.materials || []).length;
          bcm = materialCount === 1 ? number(cell.bcm) : null;
          materialFuelAmbiguous ||= materialCount > 1;
        }
        selectedCells += 1;
        const hasActual = production != null;
        const fuel = filters.material ? null : number(cell.fuel);
        if (type === 'coal') {
          if (hasActual) { day.coalActual += production; area.coalActual += production; day.hasCoalActual = true; }
          if (bcm != null) { day.coalBcm += bcm; area.coalBcm += bcm; }
          if (fuel != null) { day.coalFuel += fuel; area.coalFuel += fuel; day.hasFuel = true; }
        } else {
          if (hasActual) { day.obActual += production; area.obActual += production; day.hasObActual = true; }
          if (bcm != null) { day.obBcm += bcm; area.obBcm += bcm; }
          if (fuel != null) { day.obFuel += fuel; area.obFuel += fuel; day.hasFuel = true; }
        }
        for (const source of cell.sources || []) {
          if (filters.material && !matches(source.material, filters.material)) continue;
          const id = source.unit || source.fleetId;
          const fleet = fleets.get(id) || { unit: source.unit || id, type, production: 0, bcm: 0, hm: 0,
            planProduction: 0, planEwh: 0, planProductivityWeighted: 0, materials: new Set(), areas: new Set(), jobs: new Set() };
          const sourceProduction = number(source.production);
          if (sourceProduction != null) fleet.production += sourceProduction;
          const sourceBcm = type === 'coal' && sourceProduction != null && number(source.density) > 0
            ? sourceProduction / Number(source.density) : type === 'ob' ? sourceProduction : null;
          if (sourceBcm != null) fleet.bcm += sourceBcm;
          fleet.materials.add(source.material); fleet.areas.add(table.area); fleet.jobs.add(jobCode); fleets.set(id, fleet);
        }
        [...new Set(cell.notes || [])].forEach(note => {
          const noteKey = `${table.area}|${row.date}|${row.shiftId}|${jobCode}|${note}`;
          noteCells.set(noteKey, note);
        });
      }
      daily.set(row.date, day); areas.set(table.area, area);
    }
  }
  return { daily, areas, fleets, noteCells, selectedCells, materialFuelAmbiguous,
    jobs: [...productionJobs.values()] };
}

function aggregatePlans(planRows, targetRow, filters) {
  const daily = new Map(); const areas = new Map(); const fleets = new Map();
  const matching = (planRows || []).filter(row => matches(row.pit_area_snapshot, filters.area)
    && matches(row.job_code_snapshot, filters.job) && matches(row.material_snapshot, filters.material));
  const complete = matching.filter(row => row.completeness === 'complete' && number(row.planned_production) != null);
  for (const row of complete) {
    const date = dateOnly(row.operational_date);
    const day = daily.get(date) || { ob: 0, coal: 0 };
    const type = row.planning_type;
    day[type] += Number(row.planned_production);
    daily.set(date, day);
    const area = areas.get(row.pit_area_snapshot) || { area: row.pit_area_snapshot, obPlan: 0, coalPlan: 0 };
    area[`${type}Plan`] += Number(row.planned_production); areas.set(area.area, area);
    const id = row.loader_code_snapshot || row.excavator_id;
    const fleet = fleets.get(id) || { unit: row.loader_code_snapshot || id, type, planProduction: 0, planEwh: 0,
      planProductivityWeighted: 0, materials: new Set(), areas: new Set(), jobs: new Set() };
    fleet.planProduction += Number(row.planned_production);
    const ewh = number(row.planned_ewh) || 0; const productivity = number(row.plan_productivity) || 0;
    fleet.planEwh += ewh; fleet.planProductivityWeighted += productivity * ewh;
    fleet.materials.add(row.material_snapshot); fleet.areas.add(row.pit_area_snapshot); fleet.jobs.add(row.job_code_snapshot);
    fleets.set(id, fleet);
  }
  const canUseMonthlyTarget = !filters.area && !filters.job && !filters.material && !filters.shiftId;
  const hasObDeployment = complete.some(row => row.planning_type === 'ob');
  const hasCoalDeployment = complete.some(row => row.planning_type === 'coal');
  const obTarget = hasObDeployment ? sum(complete.filter(row => row.planning_type === 'ob').map(row => row.planned_production))
    : canUseMonthlyTarget ? number(targetRow?.target_ob_bcm) : null;
  const coalTarget = hasCoalDeployment ? sum(complete.filter(row => row.planning_type === 'coal').map(row => row.planned_production))
    : canUseMonthlyTarget ? number(targetRow?.target_coal_mt) : null;
  return { daily, areas, fleets, matching, incomplete: matching.filter(row => row.completeness !== 'complete'),
    obTarget, coalTarget,
    obSource: hasObDeployment ? 'fleet_deployment' : obTarget != null ? 'monthly_target' : 'unavailable',
    coalSource: hasCoalDeployment ? 'fleet_deployment' : coalTarget != null ? 'monthly_target' : 'unavailable' };
}

function buildDailySeries(filters, actual, plans) {
  const rows = []; let obActualCumulative = 0; let coalActualCumulative = 0; let obPlanCumulative = 0; let coalPlanCumulative = 0;
  for (let day = 1; day <= filters.days; day += 1) {
    const date = `${filters.start.slice(0, 8)}${String(day).padStart(2, '0')}`;
    const actualDay = actual.daily.get(date) || emptyDaily(date);
    let planDay = plans.daily.get(date) || { ob: 0, coal: 0 };
    if (plans.obSource === 'monthly_target') planDay = { ...planDay, ob: plans.obTarget / filters.days };
    if (plans.coalSource === 'monthly_target') planDay = { ...planDay, coal: plans.coalTarget / filters.days };
    if (date <= filters.cutoff) {
      obActualCumulative += actualDay.obActual; coalActualCumulative += actualDay.coalActual;
    }
    obPlanCumulative += planDay.ob; coalPlanCumulative += planDay.coal;
    rows.push({ date, obActual: date <= filters.cutoff ? actualDay.obActual : null,
      coalActual: date <= filters.cutoff ? actualDay.coalActual : null, obPlan: planDay.ob, coalPlan: planDay.coal,
      obActualCumulative: date <= filters.cutoff ? obActualCumulative : null,
      coalActualCumulative: date <= filters.cutoff ? coalActualCumulative : null,
      obPlanCumulative, coalPlanCumulative });
  }
  return rows;
}

function metricSummary(type, actual, target, planToDate, daily, filters, source) {
  const unit = type === 'coal' ? 'Ton' : 'BCM';
  const elapsedDays = Number(filters.cutoff.slice(8, 10));
  const remainingDays = Math.max(0, filters.days - elapsedDays);
  const runRateForecast = elapsedDays > 0 ? actual / elapsedDays * filters.days : null;
  const remainingCommittedPlan = daily.filter(row => row.date > filters.cutoff)
    .reduce((total, row) => total + Number(row[`${type}Plan`] || 0), 0);
  const committedForecast = source === 'fleet_deployment' ? actual + remainingCommittedPlan : null;
  return { unit, actual, target, planToDate, achievement: ratio(actual, target) == null ? null : ratio(actual, target) * 100,
    mtdAchievement: ratio(actual, planToDate) == null ? null : ratio(actual, planToDate) * 100,
    gap: target == null ? null : actual - target, runRateForecast, committedForecast,
    requiredDailyRate: target != null && remainingDays > 0 ? Math.max(0, target - actual) / remainingDays : null,
    targetSource: source };
}

function qualityItems(actual, plans, productionReport, filters) {
  const notes = [...actual.noteCells.values()];
  const countNote = pattern => notes.filter(note => pattern.test(note)).length;
  const items = [
    { code: 'MISSING_TRUCK_FACTOR', label: 'Truck Factor belum lengkap', count: countNote(/truck factor/i), severity: 'critical' },
    { code: 'MISSING_DENSITY', label: 'Density Coal belum dikunci/tersedia', count: countNote(/density/i), severity: 'critical' },
    { code: 'MISSING_DISTANCE', label: 'Jarak final belum lengkap', count: countNote(/jarak/i), severity: 'warning' },
    { code: 'MANUAL_SOURCE_INCOMPLETE', label: 'Produksi Manual belum lengkap', count: countNote(/Produksi manual belum lengkap/i), severity: 'warning' },
    { code: 'MISSING_PLAN', label: 'Fleet plan belum lengkap', count: plans.incomplete.length + (plans.obTarget == null ? 1 : 0) + (plans.coalTarget == null ? 1 : 0), severity: 'warning' },
    { code: 'FUEL_UNALLOCATED', label: 'Fuel belum dialokasikan', count: (!filters.area && !filters.job && !filters.material) ? (productionReport.queue || []).length : 0, severity: 'warning' },
    { code: 'MATERIAL_ATTRIBUTION', label: 'Fuel/HM tidak dapat dialokasikan per material', count: actual.materialFuelAmbiguous ? 1 : 0, severity: 'info' },
  ].filter(item => item.count > 0);
  const issueCount = items.reduce((total, item) => total + item.count, 0);
  const denominator = Math.max(1, actual.selectedCells + plans.matching.length);
  return { items, readiness: Math.max(0, 100 - issueCount / denominator * 100), issueCount };
}

function buildReport(input) {
  const { productionReport, planRows = [], targetRow = null, workRows = [], breakdownRows = [], standbyRows = [],
    nonprodRows = [], filters, comparison = null } = input;
  const actual = aggregateActual(productionReport, filters);
  const plans = aggregatePlans(planRows, targetRow, filters);
  const daily = buildDailySeries(filters, actual, plans);
  const cutoffRows = daily.filter(row => row.date <= filters.cutoff);
  const obActual = sum(cutoffRows.map(row => row.obActual)); const coalActual = sum(cutoffRows.map(row => row.coalActual));
  const obPlanToDate = sum(cutoffRows.map(row => row.obPlan)); const coalPlanToDate = sum(cutoffRows.map(row => row.coalPlan));

  const productiveJobs = new Set((productionReport.jobs || []).map(job => key(job.jobCode)));
  const filteredWork = workRows.filter(row => dateOnly(row.tanggal) <= filters.cutoff && productiveJobs.has(key(row.job))
    && matches(row.area_name, filters.area) && matches(row.job, filters.job) && matches(row.shift_id, filters.shiftId));
  const hmAttributionAvailable = !filters.material;
  const hm = hmAttributionAvailable ? sum(filteredWork.map(row => row.total_hm)) : null;
  const eligibleUnits = new Set(filteredWork.map(row => String(row.equipment_id)));
  const hasScopedFilter = Boolean(filters.area || filters.job || filters.material || filters.shiftId);
  const lossMatches = row => dateOnly(row.tanggal) <= filters.cutoff
    && (hasScopedFilter ? eligibleUnits.has(String(row.equipment_id)) : (!eligibleUnits.size || eligibleUnits.has(String(row.equipment_id))));
  const breakdownHours = hmAttributionAvailable ? sum(breakdownRows.filter(lossMatches).map(row => row.total_breakdown_hours)) : null;
  const standbyHours = hmAttributionAvailable ? sum(standbyRows.filter(lossMatches).map(row => row.total_standby_hours)) : null;
  const pa = hm != null ? ratio(hm + standbyHours, hm + standbyHours + breakdownHours) : null;
  const ua = hm != null ? ratio(hm, hm + standbyHours) : null;

  const workHmByUnit = new Map();
  for (const row of filteredWork) {
    const unit = row.kode_alat || row.equipment_id;
    workHmByUnit.set(unit, (workHmByUnit.get(unit) || 0) + Number(row.total_hm || 0));
  }
  for (const [unit, plan] of plans.fleets) {
    const fleet = actual.fleets.get(unit) || { unit, type: plan.type, production: 0, bcm: 0, materials: new Set(), areas: new Set(), jobs: new Set() };
    fleet.planProduction = plan.planProduction; fleet.planEwh = plan.planEwh;
    fleet.planProductivity = plan.planEwh > 0 ? plan.planProductivityWeighted / plan.planEwh : null;
    plan.materials.forEach(value => fleet.materials.add(value)); plan.areas.forEach(value => fleet.areas.add(value)); plan.jobs.forEach(value => fleet.jobs.add(value));
    actual.fleets.set(unit, fleet);
  }
  const fleetRows = [...actual.fleets.values()].map(fleet => {
    const unitHm = workHmByUnit.get(fleet.unit) || 0;
    const productivity = unitHm > 0 ? fleet.production / unitHm : null;
    return { unit: fleet.unit, type: fleet.type, materials: [...fleet.materials], areas: [...fleet.areas], jobs: [...fleet.jobs],
      production: fleet.production, bcm: fleet.bcm, hm: unitHm, productivity, planProductivity: fleet.planProductivity || null,
      achievement: productivity != null && fleet.planProductivity > 0 ? productivity / fleet.planProductivity * 100 : null };
  }).sort((a, b) => (b.production || 0) - (a.production || 0));

  const areaNames = new Set([...actual.areas.keys(), ...plans.areas.keys()]);
  const areaRows = [...areaNames].sort().map(areaName => {
    const a = actual.areas.get(areaName) || {}; const p = plans.areas.get(areaName) || {};
    return { area: areaName, obActual: a.obActual || 0, coalActual: a.coalActual || 0,
      obPlan: p.obPlan || null, coalPlan: p.coalPlan || null,
      obAchievement: p.obPlan > 0 ? (a.obActual || 0) / p.obPlan * 100 : null,
      coalAchievement: p.coalPlan > 0 ? (a.coalActual || 0) / p.coalPlan * 100 : null };
  });

  const filteredNonprod = nonprodRows.filter(row => dateOnly(row.tanggal) <= filters.cutoff && matches(row.pit_area, filters.area)
    && matches(row.job_code, filters.job) && matches(row.material_detail, filters.material) && matches(row.shift_id, filters.shiftId));
  let rainMinutes = 0; let slipperyMinutes = 0;
  for (const table of productionReport.tables || []) {
    if (!matches(table.area, filters.area)) continue;
    for (const row of table.rows || []) {
      if (row.date > filters.cutoff || !matches(row.shiftId, filters.shiftId)) continue;
      for (const [jobCode, cell] of Object.entries(row.values || {})) {
        if (!matches(jobCode, filters.job)) continue;
        rainMinutes += number(cell.rainMinutes) || 0; slipperyMinutes += number(cell.slipperyMinutes) || 0;
      }
    }
  }
  const quality = qualityItems(actual, plans, productionReport, filters);
  const obFuel = sum([...actual.daily.values()].map(day => day.obFuel)); const coalFuel = sum([...actual.daily.values()].map(day => day.coalFuel));
  const obBcm = sum([...actual.daily.values()].map(day => day.obBcm)); const coalBcm = sum([...actual.daily.values()].map(day => day.coalBcm));
  const allFuel = obFuel + coalFuel; const allBcm = obBcm + coalBcm;

  return {
    meta: { formulaVersion: FORMULA_VERSION, generatedAt: new Date().toISOString(), period: filters,
      cutoff: filters.cutoff, productionBasis: 'net_productive_after_nonprod', densityBasis: 'effective_or_locked_snapshot',
      targetSource: { ob: plans.obSource, coal: plans.coalSource } },
    filters: { areas: productionReport.areas || [], jobs: (productionReport.jobs || []).map(job => ({ code: job.jobCode, description: job.jobDescription })),
      materials: [...new Set((productionReport.jobs || []).flatMap(job => (job.materials || []).map(material => material.name)))].sort(),
      shifts: productionReport.shifts || [] },
    summary: {
      ob: metricSummary('ob', obActual, plans.obTarget, obPlanToDate, daily, filters, plans.obSource),
      coal: metricSummary('coal', coalActual, plans.coalTarget, coalPlanToDate, daily, filters, plans.coalSource),
      fuel: { liters: filters.material ? null : allFuel, ratioOb: filters.material ? null : ratio(obFuel, obBcm),
        ratioCoal: filters.material ? null : ratio(coalFuel, coalBcm), ratioAll: filters.material ? null : ratio(allFuel, allBcm),
        obLiters: filters.material ? null : obFuel, coalLiters: filters.material ? null : coalFuel },
      operation: { productiveHm: hm, breakdownHours, standbyHours, pa: pa == null ? null : pa * 100,
        ua: ua == null ? null : ua * 100, rainHours: rainMinutes / 60, slipperyHours: slipperyMinutes / 60 },
      quality: { readiness: quality.readiness, issues: quality.issueCount },
    },
    daily, areas: areaRows, fleets: fleetRows,
    losses: { breakdownHours, standbyHours, rainHours: rainMinutes / 60, slipperyHours: slipperyMinutes / 60,
      nonprodObBcm: sum(filteredNonprod.filter(row => row.planning_type === 'ob').map(row => row.nonprod_volume)),
      nonprodCoalTon: sum(filteredNonprod.filter(row => row.planning_type === 'coal').map(row => row.nonprod_volume)) },
    quality: quality.items,
    comparison,
    lineage: [
      { source: 'Data Produksi', role: 'Actual produksi, fuel, density, hujan' },
      { source: 'Fleet Deployment / Production Target', role: 'Plan bulanan dan harian' },
      { source: 'Input Data', role: 'HM produktif dan konteks unit' },
      { source: 'Breakdown & Standby', role: 'PA, UA, dan loss hours' },
      { source: 'MTD Snapshot', role: FORMULA_VERSION },
    ],
  };
}

module.exports = { FORMULA_VERSION, parseFilters, buildReport, aggregateActual, aggregatePlans, metricSummary };
