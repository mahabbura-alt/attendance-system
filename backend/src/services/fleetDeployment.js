'use strict';

const MAX_RANGE_DAYS = 366;
const STATUS = new Set(['draft', 'validated', 'published', 'closed', 'cancelled']);

function isoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Object.assign(new Error('Tanggal wajib berformat YYYY-MM-DD.'), { status: 400 });
  return text;
}

function expandDates(start, end) {
  const from = new Date(`${isoDate(start)}T00:00:00Z`);
  const until = new Date(`${isoDate(end)}T00:00:00Z`);
  if (until < from) throw Object.assign(new Error('Tanggal akhir tidak boleh sebelum tanggal mulai.'), { status: 422 });
  const dates = [];
  for (let cursor = from; cursor <= until; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (dates.length > MAX_RANGE_DAYS) throw Object.assign(new Error(`Rentang maksimum ${MAX_RANGE_DAYS} hari.`), { status: 422 });
  }
  return dates;
}

function scopeFromUser() {
  // Current OMOS authentication schema has no server-authoritative tenant/project
  // columns. Never accept those scopes from a JWT/body fallback. The explicit
  // default scope can be migrated once Core Tenant/Project ownership exists.
  return { tenantKey: 'default', projectKey: 'default' };
}

function normalizePayload(input) {
  const data = input && typeof input === 'object' ? input : {};
  const planningType = String(data.planningType || '').toLowerCase();
  if (!['ob', 'coal'].includes(planningType)) throw Object.assign(new Error('Jenis planning wajib OB atau Coal.'), { status: 422 });
  const assignments = [...new Set((Array.isArray(data.assignments) ? data.assignments : []).map(String).filter(Boolean))];
  if (!assignments.length) throw Object.assign(new Error('Pilih minimal satu fleet excavator.'), { status: 422 });
  return {
    name: String(data.name || '').trim().slice(0, 180),
    dateStart: isoDate(data.dateStart),
    dateEnd: isoDate(data.dateEnd),
    pitArea: String(data.pitArea || '').trim(),
    jobCode: String(data.jobCode || '').trim(),
    material: String(data.material || '').trim(),
    planningType,
    assignments,
    excludedDates: new Set((Array.isArray(data.excludedDates) ? data.excludedDates : []).map(isoDate)),
    revision: Number(data.revision) || null,
  };
}

function dateParts(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  return { year, month, day, key: `${year}:${month}:${day}` };
}

function spoLoss(spoData, jobCode, date) {
  const { year, month, day } = dateParts(date);
  const suffix = `:${year}:${month}:${day}`;
  const legacySuffix = `:${month}:${day}`;
  let total = 0;
  let current = false;
  for (const table of Object.values(spoData?.tables || {})) {
    const code = String(table?.jobCode || table?.job_code || '').trim().toUpperCase();
    if (code !== String(jobCode).toUpperCase()) continue;
    for (const [key, raw] of Object.entries(table?.daily || {})) {
      if (key.startsWith('system:') || !key.endsWith(suffix)) continue;
      current = true;
      total += Math.max(0, Number(raw) || 0);
    }
    if (!current) for (const [key, raw] of Object.entries(table?.daily || {})) {
      if (!key.startsWith('system:') && key.endsWith(legacySuffix) && key.split(':').length === 3) total += Math.max(0, Number(raw) || 0);
    }
  }
  return Math.min(24, total);
}

function dailyEwh(paData, spoData, equipmentId, jobCode, date) {
  const { key } = dateParts(date);
  const values = paData?.values?.PA?.[equipmentId] || {};
  const raw = values[key];
  if (raw === '' || raw === undefined || !Number.isFinite(Number(raw))) return null;
  const available = 24 * (Number(raw) / 100);
  return available > 0 ? Math.max(0, available - spoLoss(spoData, jobCode, date)) : null;
}

function buildDailyRows(payload, catalog, paData, spoData) {
  const dates = expandDates(payload.dateStart, payload.dateEnd).filter(date => !payload.excludedDates.has(date));
  const selected = payload.assignments.map(ref => catalog.find(item => String(item.planRef) === ref)).filter(Boolean);
  return selected.flatMap(plan => dates.map(date => {
    const ewh = dailyEwh(paData, spoData, String(plan.equipmentId), payload.jobCode, date);
    const productivity = Number(plan.fleetProductivity);
    const completePlan = Number.isFinite(productivity) && productivity > 0;
    const completeness = !completePlan ? 'missing-plan' : ewh === null ? 'missing-ewh' : 'complete';
    return {
      operationalDate: date,
      plan,
      ewh,
      plannedProduction: completeness === 'complete' ? ewh * productivity : null,
      completeness,
      reasonCode: completeness === 'missing-plan' ? 'PLAN_PRODUCTIVITY_MISSING' : completeness === 'missing-ewh' ? 'PA_OR_EWH_MISSING' : null,
    };
  }));
}

const normalized = value => String(value || '').trim().toLocaleLowerCase('id-ID');

function contextPlan(catalog, equipmentId, loaderCode, payload) {
  return (catalog || []).find(plan => (
    (String(plan.equipmentId || '') === String(equipmentId || '') || normalized(plan.loaderCode) === normalized(loaderCode))
    && plan.planningType === payload.planningType
    && normalized(plan.material) === normalized(payload.material)
    && String(plan.jobCode || '').trim().toUpperCase() === payload.jobCode.toUpperCase()
  )) || null;
}

function resolveFleetCandidates(payload, catalog, excavators) {
  const equipment = Array.isArray(excavators) ? excavators : [];
  const selected = payload.assignments.map(ref => {
    const directPlan = (catalog || []).find(item => String(item.planRef) === ref);
    const equipmentId = ref.startsWith('equipment:') ? ref.slice('equipment:'.length) : directPlan?.equipmentId;
    const unit = equipment.find(item => String(item.id) === String(equipmentId));
    if (!unit) throw Object.assign(new Error('Sebagian Excavator tidak lagi tersedia pada List Equipment.'), { status: 409 });
    const plan = contextPlan(catalog, unit.id, unit.kode_alat, payload);
    if (plan) return plan;
    return {
      planRef: `equipment:${unit.id}`,
      tableId: `unplanned:${unit.id}`,
      planningType: payload.planningType,
      loaderCode: String(unit.kode_alat || '').trim(),
      equipmentId: unit.id,
      equipmentType: unit.tipe_alat || null,
      equipmentClass: unit.class_unit || null,
      material: payload.material,
      jobCode: payload.jobCode,
      fleetProductivity: null,
      productivityUnit: payload.planningType === 'coal' ? 'Ton/Hr' : 'BCM/Hr',
      source: 'equipment_missing_plan',
      versionId: null,
      density: null,
    };
  });
  if (new Set(selected.map(item => String(item.equipmentId))).size !== selected.length) {
    throw Object.assign(new Error('Excavator yang sama tidak boleh dipilih lebih dari sekali.'), { status: 422 });
  }
  return selected;
}

function buildDailyRowsFromTimeline(payload, selected, catalogByDate, paData, spoData) {
  const dates = expandDates(payload.dateStart, payload.dateEnd).filter(date => !payload.excludedDates.has(date));
  return selected.flatMap(candidate => dates.map(date => {
    const dailyPlan = contextPlan(catalogByDate.get(date) || [], candidate.equipmentId, candidate.loaderCode, payload);
    const plan = dailyPlan || { ...candidate, planRef: candidate.planRef, tableId: candidate.tableId,
      fleetProductivity: null, versionId: null, density: null, source: 'equipment_missing_plan' };
    const ewh = dailyEwh(paData, spoData, String(candidate.equipmentId), payload.jobCode, date);
    const productivity = Number(plan.fleetProductivity);
    const completePlan = Number.isFinite(productivity) && productivity > 0;
    const completeness = !completePlan ? 'missing-plan' : ewh === null ? 'missing-ewh' : 'complete';
    return {
      operationalDate: date,
      plan,
      ewh,
      plannedProduction: completeness === 'complete' ? ewh * productivity : null,
      completeness,
      reasonCode: completeness === 'missing-plan' ? 'PLAN_PRODUCTIVITY_MISSING' : completeness === 'missing-ewh' ? 'PA_OR_EWH_MISSING' : null,
    };
  }));
}

function validateCatalogSelection(payload, catalog) {
  const selected = payload.assignments.map(ref => catalog.find(item => String(item.planRef) === ref)).filter(Boolean);
  if (selected.length !== payload.assignments.length) throw Object.assign(new Error('Sebagian fleet tidak lagi tersedia pada database productivity.'), { status: 409 });
  for (const plan of selected) {
    if (plan.planningType !== payload.planningType || normalized(plan.material) !== normalized(payload.material)
      || String(plan.jobCode || '').trim().toUpperCase() !== payload.jobCode.toUpperCase()) {
      throw Object.assign(new Error(`Fleet ${plan.loaderCode} tidak sesuai dengan JOB, material, atau jenis planning yang dipilih.`), { status: 422 });
    }
  }
  return selected;
}

function statusTransitionAllowed(from, to) {
  const transitions = {
    draft: new Set(['validated', 'published', 'cancelled']),
    validated: new Set(['draft', 'published', 'cancelled']),
    published: new Set(['closed', 'cancelled']),
    closed: new Set(), cancelled: new Set(),
  };
  return Boolean(STATUS.has(to) && transitions[from]?.has(to));
}

module.exports = {
  MAX_RANGE_DAYS, STATUS, isoDate, expandDates, scopeFromUser, normalizePayload,
  dailyEwh, buildDailyRows, contextPlan, resolveFleetCandidates, buildDailyRowsFromTimeline,
  validateCatalogSelection, statusTransitionAllowed,
};
