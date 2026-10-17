const test = require('node:test');
const assert = require('node:assert/strict');
const ReviewUaImpact = require('../src/services/reviewUaImpact');

const near = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
};

test('legacy SPO without a verified catalog fails closed and never invents SPO_ROW codes', () => {
  const data={tables:{ob:{deployed:true,jobCode:'OB',daily:{'1:2026:9:20':5,'4:2026:9:20':3}}}};
  const result=ReviewUaImpact.extractSpoDelayPlan({source:{dataJson:data},jobCode:'OB',resolvePlanningJob:job=>({job_code:job}) ,operationalDate:'2026-09-20'});
  assert.equal(result.items.length,0);
  assert.ok(result.flags.includes('MISSING_SPO_PARAMETER_DETAIL'));
  assert.equal(JSON.stringify(result).includes('SPO_ROW'),false);
});

test('dampak parameter SPO menutup persis delta UA utama', () => {
  const productivity = 150;
  const availablePlan = 21.6;
  const planDelay = 3.6;
  const hm = 16;
  const standby = 4;
  const uaPlan = (availablePlan - planDelay) / availablePlan;
  const authoritative = productivity * (planDelay - standby);
  const result = ReviewUaImpact.buildUaCellImpact({
    productivityPlan: productivity,
    availablePlanHours: availablePlan,
    actualAvailableHours: hm + standby,
    targetPlanDelayHours: planDelay,
    standbyActualHours: standby,
    planItems: [
      { key: 'id:s01', standbyCodeId: 's01', code: 'S01', description: 'Hujan', rawHours: 2.4 },
      { key: 'id:s06', standbyCodeId: 's06', code: 'S06', description: 'Refueling', rawHours: 1.2 },
    ],
    actualItems: [
      { key: 'id:s01', standbyCodeId: 's01', code: 'S01', description: 'Hujan', hours: 3 },
      { key: 'id:s06', standbyCodeId: 's06', code: 'S06', description: 'Refueling', hours: 1 },
    ],
    authoritativeDelta: authoritative,
    unit: 'EX30 350-14',
  });
  near(result.total, authoritative);
  near(result.items.reduce((sum, row) => sum + row.rawPlanHours, 0), 3.6);
  assert.equal(result.items.some(row => row.code === 'UNMAPPED_UA_SOURCE'), false);
  const aggregate = {};
  ReviewUaImpact.mergeUaImpact(aggregate, result, [], { versionId: 'spo-v1', effectiveFrom: '2026-09-01', revision: 1 });
  const final = ReviewUaImpact.finalizeUaImpact(aggregate, authoritative);
  assert.equal(final.reconciled, true);
  near(final.parameterImpactTotal, final.authoritativeDeltaUa);
  assert.equal(final.items.length, 2);
  assert.equal(final.formulaVersion, 'review-ua-spo-direct-v3');
});

test('rincian tidak menormalisasi plan delay atau memalsukan rekonsiliasi', () => {
  const availablePlan = 12;
  const productivity = 100;
  const hm = 5;
  const standby = 5;
  const authoritative = productivity * hm;
  const result = ReviewUaImpact.buildUaCellImpact({
    productivityPlan: productivity,
    availablePlanHours: availablePlan,
    actualAvailableHours: hm + standby,
    targetPlanDelayHours: availablePlan,
    standbyActualHours: standby,
    planItems: [
      { key: 'id:a', code: 'A', description: 'A', rawHours: 10 },
      { key: 'id:b', code: 'B', description: 'B', rawHours: 10 },
    ],
    actualItems: [{ key: 'id:a', code: 'A', description: 'A', hours: 5 }],
    authoritativeDelta: authoritative,
  });
  near(result.total, 1500);
  near(result.items.reduce((sum, row) => sum + row.rawPlanHours, 0), 20);
  near(result.items.reduce((sum, row) => sum + row.planHours, 0), 20);
  const aggregate = {};
  ReviewUaImpact.mergeUaImpact(aggregate, result);
  assert.equal(ReviewUaImpact.finalizeUaImpact(aggregate, authoritative).reconciled, false);
});

test('actual standby tanpa kode dan plan UA tanpa rincian menjadi reason bucket eksplisit', () => {
  const result = ReviewUaImpact.buildUaCellImpact({
    productivityPlan: 120,
    availablePlanHours: 20,
    actualAvailableHours: 12,
    targetPlanDelayHours: 2,
    standbyActualHours: 3,
    planItems: [],
    actualItems: [],
    authoritativeDelta: 120 * ((12 * 2 / 20) - 3),
  });
  assert.equal(result.items.some(row => row.code === 'UNMAPPED_PLAN_UA'), false);
  assert.ok(result.items.some(row => row.code === 'UNMAPPED_ACTUAL_STANDBY'));
  near(result.total, -360);
});

test('resolver memakai versi SPO efektif dan katalog parameter current sebagai fallback historis', () => {
  const versions = ReviewUaImpact.buildSpoSources([
    { id: 'v1', effective_from: '2026-09-10', revision: 1, data_json: { tables: { ob: {
      deployed: true, jobCode: 'OB', daily: { '1:2026:9:12': 2 }, parameters: [],
    } } } },
    { id: 'v2', effective_from: '2026-09-20', revision: 1, data_json: { tables: { ob: {
      deployed: true, jobCode: 'OB', daily: { '1:2026:9:22': 4 }, parameters: [],
    } } } },
  ], {});
  const source = ReviewUaImpact.resolveSpoSource(versions, '2026-09-12');
  assert.equal(source.versionId, 'v1');
  const resolved = ReviewUaImpact.extractSpoDelayPlan({
    source,
    parameterFallbackData: { tables: { ob: { deployed: true, jobCode: 'OB', parameters: [
      { rowId: '1', standbyCodeId: 's01', codeSnapshot: 'S01', descriptionSnapshot: 'Hujan' },
    ] } } },
    jobCode: 'OB', operationalDate: '2026-09-12', masterJobs: [],
    resolvePlanningJob: value => ({ job_code: String(value || '') }),
  });
  assert.equal(resolved.items[0].rawHours, 2);
  assert.ok(resolved.flags.includes('PARAMETER_CATALOG_CURRENT_FALLBACK'));
  assert.equal(resolved.lineage.versionId, 'v1');
});

test('10000 kombinasi deterministik mempertahankan jumlah dampak sama dengan delta UA', () => {
  let seed = 73;
  const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  for (let index = 0; index < 10000; index += 1) {
    const productivity = 1 + random() * 500;
    const availablePlan = 1 + random() * 23;
    const targetPlanDelay = random() * availablePlan;
    const actualAvailable = random() * 24;
    const standbyActual = random() * actualAvailable;
    const hm = actualAvailable - standbyActual;
    const uaPlan = (availablePlan - targetPlanDelay) / availablePlan;
    const authoritative = productivity * (targetPlanDelay - standbyActual);
    const p1 = random(); const p2 = random(); const p3 = random(); const ps = p1 + p2 + p3;
    const a1 = random(); const a2 = random(); const a3 = random(); const as = a1 + a2 + a3;
    const result = ReviewUaImpact.buildUaCellImpact({
      productivityPlan: productivity,
      availablePlanHours: availablePlan,
      actualAvailableHours: actualAvailable,
      targetPlanDelayHours: targetPlanDelay,
      standbyActualHours: standbyActual,
      planItems: [p1, p2, p3].map((value, i) => ({ key: `id:${i}`, code: `S${i}`, rawHours: value / ps * targetPlanDelay })),
      actualItems: [a1, a2, a3].map((value, i) => ({ key: `id:${i}`, code: `S${i}`, hours: value / as * standbyActual })),
      authoritativeDelta: authoritative,
    });
    near(result.total, authoritative, ReviewUaImpact.toleranceFor(authoritative));
  }
});
