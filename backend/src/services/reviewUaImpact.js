'use strict';

const FORMULA_VERSION = 'review-ua-spo-direct-v3';

const number = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
const finite = value => Number.isFinite(number(value));
const text = value => String(value || '').trim();
const upper = value => text(value).toUpperCase();

function toleranceFor(value) {
  return Math.max(1e-8, Math.abs(number(value) || 0) * 1e-10);
}

function findSpoTable(dataJson, jobCode, masterJobs, resolvePlanningJob) {
  const wanted = upper(jobCode);
  return Object.entries(dataJson?.tables || {}).map(([tableId, table]) => ({ tableId, table }))
    .find(({ table }) => {
      if (!table?.deployed) return false;
      const resolved = resolvePlanningJob(table.jobCode || table.job_code || table.jobDescription, masterJobs);
      return upper(resolved?.job_code || table.jobCode || table.job_code) === wanted;
    }) || null;
}

function buildSpoSources(versionRows, currentDataJson) {
  const sources = (Array.isArray(versionRows) ? versionRows : []).map(row => ({
    versionId: row.id || null,
    effectiveFrom: text(row.effective_from),
    revision: finite(row.revision) ? number(row.revision) : null,
    dataJson: row.data_json || {},
    source: 'effective-version',
  })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.effectiveFrom))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || (a.revision || 0) - (b.revision || 0));
  if (!sources.length && currentDataJson) {
    sources.push({ versionId: null, effectiveFrom: null, revision: null, dataJson: currentDataJson, source: 'current-snapshot' });
  }
  return sources;
}

function resolveSpoSource(sources, operationalDate) {
  const dated = (sources || []).filter(source => source.effectiveFrom && source.effectiveFrom <= operationalDate);
  if (dated.length) return { ...dated[dated.length - 1], fallbackReason: null };
  const earliest = (sources || []).find(source => source.effectiveFrom);
  if (earliest) return { ...earliest, fallbackReason: 'SPO_HISTORY_FALLBACK' };
  const current = (sources || [])[0];
  return current ? { ...current, fallbackReason: 'SPO_CURRENT_SNAPSHOT_FALLBACK' } : null;
}

function dailyValue(daily, rowId, operationalDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(operationalDate));
  if (!match) return 0;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const current = `${rowId}:${year}:${month}:${day}`;
  const legacy = `${rowId}:${month}:${day}`;
  const value = daily?.[current] ?? daily?.[legacy] ?? 0;
  return Math.max(0, finite(value) ? number(value) : 0);
}

function extractSpoDelayPlan(options = {}) {
  const source = options.source;
  if (!source) return { items: [], flags: ['MISSING_EFFECTIVE_SPO'], lineage: null };
  const main = findSpoTable(source.dataJson, options.jobCode, options.masterJobs, options.resolvePlanningJob);
  if (!main) return { items: [], flags: ['MISSING_JOB_SPO'], lineage: lineageOf(source) };
  const fallback = findSpoTable(options.parameterFallbackData, options.jobCode, options.masterJobs, options.resolvePlanningJob);
  let parameters = Array.isArray(main.table?.parameters) && main.table.parameters.length
    ? main.table.parameters : (Array.isArray(fallback?.table?.parameters) ? fallback.table.parameters : []);
  const flags = [];
  if ((!Array.isArray(main.table?.parameters) || !main.table.parameters.length) && parameters.length) {
    flags.push('PARAMETER_CATALOG_CURRENT_FALLBACK');
  }
  if (source.fallbackReason) flags.push(source.fallbackReason);
  const items = parameters.map(parameter => ({
    key: text(parameter.standbyCodeId) ? `id:${text(parameter.standbyCodeId)}` : `code:${upper(parameter.codeSnapshot) || `row:${text(parameter.rowId)}`}`,
    standbyCodeId: text(parameter.standbyCodeId) || null,
    code: text(parameter.codeSnapshot) || null,
    description: text(parameter.descriptionSnapshot) || text(parameter.codeSnapshot) || 'Parameter SPO',
    rawHours: dailyValue(main.table?.daily || {}, text(parameter.rowId), options.operationalDate),
    rowId: text(parameter.rowId),
  })).filter(item => item.rawHours > 0 || item.standbyCodeId || item.code);
  if (!items.length) flags.push('MISSING_SPO_PARAMETER_DETAIL');
  return { items, flags: [...new Set(flags)], lineage: lineageOf(source) };
}

function lineageOf(source) {
  return source ? {
    versionId: source.versionId || null,
    effectiveFrom: source.effectiveFrom || null,
    revision: source.revision,
    source: source.source,
  } : null;
}

function buildUaCellImpact(options = {}) {
  const productivity = Math.max(0, finite(options.productivityPlan) ? number(options.productivityPlan) : 0);
  const standbyActual = Math.max(0, finite(options.standbyActualHours) ? number(options.standbyActualHours) : 0);
  const planShare = Math.max(0, Math.min(1, finite(options.planShare) ? number(options.planShare) : 1));
  const actualShare = Math.max(0, Math.min(1, finite(options.actualShare) ? number(options.actualShare) : 1));
  const authoritative = finite(options.authoritativeDelta) ? number(options.authoritativeDelta) : null;
  const unit = text(options.unit) || null;
  const rows = new Map();
  const ensure = item => {
    const key = item.key || (item.standbyCodeId ? `id:${item.standbyCodeId}` : `code:${upper(item.code) || 'UNMAPPED'}`);
    if (!rows.has(key)) rows.set(key, {
      key,
      standbyCodeId: item.standbyCodeId || null,
      code: item.code || null,
      description: item.description || item.code || 'Tidak terpetakan',
      rawPlanHours: 0,
      planHours: 0,
      actualHours: 0,
      allowanceHours: 0,
      varianceHours: 0,
      impact: 0,
      flags: new Set(),
      units: new Map(),
    });
    return rows.get(key);
  };

  const planItems = Array.isArray(options.planItems) ? options.planItems : [];
  for (const item of planItems) {
    const row = ensure(item);
    row.rawPlanHours += Math.max(0, number(item.rawHours) || 0) * planShare;
  }
  for (const row of rows.values()) row.planHours = row.rawPlanHours;

  const actualItems = Array.isArray(options.actualItems) ? options.actualItems : [];
  let mappedActual = 0;
  for (const item of actualItems) {
    const hours = Math.max(0, number(item.hours) || 0) * actualShare;
    if (!(hours > 0)) continue;
    const row = ensure(item);
    row.actualHours += hours;
    mappedActual += hours;
  }
  const actualGap = standbyActual - mappedActual;
  if (Math.abs(actualGap) > toleranceFor(standbyActual)) {
    const row = ensure({ key: 'system:UNMAPPED_ACTUAL_STANDBY', code: 'UNMAPPED_ACTUAL_STANDBY', description: 'Standby aktual tidak terpetakan' });
    row.actualHours += actualGap;
    row.flags.add('UNMAPPED_ACTUAL_STANDBY');
  }

  for (const row of rows.values()) {
    row.allowanceHours = row.planHours; // legacy response alias; no rescaling.
    row.varianceHours = row.planHours - row.actualHours;
    row.impact = productivity * row.varianceHours;
    if (unit) row.units.set(unit, (row.units.get(unit) || 0) + Math.abs(row.impact));
  }
  let total = [...rows.values()].reduce((sum, row) => sum + row.impact, 0);
  // A mismatch is reported by finalizeUaImpact; never fabricate an adjustment.
  return { items: [...rows.values()], total, authoritativeDelta: authoritative };
}

function mergeUaImpact(target, cellResult, extraFlags = [], lineage = null) {
  if (!target.items) target.items = new Map();
  if (!target.flags) target.flags = new Set();
  if (!target.lineage) target.lineage = new Map();
  for (const flag of extraFlags || []) target.flags.add(flag);
  if (lineage) target.lineage.set(`${lineage.versionId || 'snapshot'}|${lineage.effectiveFrom || 'current'}|${lineage.revision || ''}`, lineage);
  for (const item of cellResult?.items || []) {
    let row = target.items.get(item.key);
    if (!row) {
      row = { ...item, flags: new Set(), units: new Map() };
      row.rawPlanHours = 0; row.planHours = 0; row.actualHours = 0; row.allowanceHours = 0;
      row.varianceHours = 0; row.impact = 0;
      target.items.set(item.key, row);
    }
    row.rawPlanHours += item.rawPlanHours || 0;
    row.planHours += item.planHours || 0;
    row.actualHours += item.actualHours || 0;
    row.allowanceHours += item.allowanceHours || 0;
    row.varianceHours += item.varianceHours || 0;
    row.impact += item.impact || 0;
    for (const flag of item.flags || []) row.flags.add(flag);
    for (const [unit, weight] of item.units || []) row.units.set(unit, (row.units.get(unit) || 0) + weight);
  }
}

function finalizeUaImpact(target, authoritativeDelta) {
  const authoritative = finite(authoritativeDelta) ? number(authoritativeDelta) : null;
  const items = [...(target.items || new Map()).values()].map(row => ({
    key: row.key,
    standbyCodeId: row.standbyCodeId,
    code: row.code,
    description: row.description,
    rawPlanHours: row.rawPlanHours,
    planHours: row.planHours,
    actualHours: row.actualHours,
    allowanceHours: row.allowanceHours,
    varianceHours: row.varianceHours,
    impact: row.impact,
    flags: [...row.flags],
    units: [...row.units.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([unit]) => unit),
  })).filter(row => Math.abs(row.planHours) > 1e-12 || Math.abs(row.actualHours) > 1e-12 || Math.abs(row.impact) > 1e-8)
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact) || String(a.code || '').localeCompare(String(b.code || '')));
  const total = items.reduce((sum, row) => sum + row.impact, 0);
  const difference = authoritative == null ? null : total - authoritative;
  return {
    formulaVersion: FORMULA_VERSION,
    calculationGrain: 'date+unit+pit+job+material+uom+standby_code',
    items,
    planDelayHours: items.reduce((sum, row) => sum + row.planHours, 0),
    actualDelayHours: items.reduce((sum, row) => sum + row.actualHours, 0),
    parameterImpactTotal: total,
    authoritativeDeltaUa: authoritative,
    difference,
    reconciled: difference != null && Math.abs(difference) <= toleranceFor(authoritative),
    flags: [...(target.flags || new Set())],
    lineage: [...(target.lineage || new Map()).values()],
  };
}

module.exports = {
  FORMULA_VERSION,
  buildSpoSources,
  resolveSpoSource,
  extractSpoDelayPlan,
  buildUaCellImpact,
  mergeUaImpact,
  finalizeUaImpact,
  toleranceFor,
};
