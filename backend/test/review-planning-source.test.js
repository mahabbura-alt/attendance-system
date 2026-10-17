const test = require('node:test');
const assert = require('node:assert/strict');

const Controller = require('../src/controllers/production.controller');

test('Review Planning Source default Aktual, menerima Fleet x Material, dan menolak nilai lain', () => {
  assert.equal(Controller.normalizeReviewPlanningSource(), 'flexible');
  assert.equal(Controller.normalizeReviewPlanningSource('Conservative'), 'conservative');
  assert.equal(Controller.normalizeReviewPlanningSource('fleet_material'), 'fleet_material');
  assert.throws(() => Controller.normalizeReviewPlanningSource('legacy'), /flexible, conservative, atau fleet_material/);
});

test('Fleksibel mencocokkan tanggal unit JOB material satuan tanpa menjadikan PIT sebagai kunci plan', () => {
  const catalog = [{
    catalogDate: '2026-09-20', equipmentId: 'ex-1', loaderCode: 'EX-01', jobCode: 'OB',
    material: 'CLAY', planningType: 'ob', fleetProductivity: 150.75,
    productivityUnit: 'BCM/Hr', versionId: 'version-1', effectiveFrom: '2026-09-18',
  }];
  const fleets = [{
    tanggal: '2026-09-20', excavatorId: 'ex-1', jobCode: 'OB', material: 'clay',
    materialType: 'Overburden', pit: 'BEI',
  }];
  const cells = Controller.buildFlexibleReviewPlottedCells(catalog, fleets);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].pit, 'BEI');
  assert.equal(cells[0].productivity, 150.75);
  assert.equal(cells[0].planningVersionId, 'version-1');
});

test('Fleksibel tidak memakai plan ambigu atau plan dengan material berbeda', () => {
  const plan = {
    catalogDate: '2026-09-20', equipmentId: 'ex-1', loaderCode: 'EX-01', jobCode: 'OB',
    material: 'CLAY', planningType: 'ob', fleetProductivity: 150, productivityUnit: 'BCM/Hr',
  };
  const fleet = {
    tanggal: '2026-09-20', excavatorId: 'ex-1', jobCode: 'OB', material: 'CLAY',
    materialType: 'Overburden', pit: 'BEI',
  };
  assert.equal(Controller.buildFlexibleReviewPlottedCells([plan, { ...plan, tableId: 'duplicate' }], [fleet]).length, 0);
  assert.equal(Controller.buildFlexibleReviewPlottedCells([plan], [{ ...fleet, material: 'TOP SOIL' }]).length, 0);
});

test('Konservatif memprioritaskan snapshot relasional Fleet Deployment per unit-hari', () => {
  const relational = [{ equipmentId: 'ex-1', tanggal: '2026-09-20', material: 'CLAY' }];
  const legacy = [
    { equipmentId: 'ex-1', tanggal: '2026-09-20', material: 'SUB SOIL' },
    { equipmentId: 'ex-2', tanggal: '2026-09-20', material: 'CLAY' },
  ];
  assert.deepEqual(Controller.mergeConservativeReviewCells(relational, legacy), [relational[0], legacy[1]]);
});

test('Kunci konservatif membedakan PIT dan material', () => {
  const base = { tanggal: '2026-09-20', excavatorId: 'ex-1', pit: 'BEI', jobCode: 'OB', material: 'CLAY', materialType: 'Overburden' };
  assert.notEqual(Controller.reviewFleetContextKey(base), Controller.reviewFleetContextKey({ ...base, pit: 'DKC' }));
  assert.notEqual(Controller.reviewFleetContextKey(base), Controller.reviewFleetContextKey({ ...base, material: 'TOP SOIL' }));
});

test('Fleet x Material memakai scope deployment tanpa mengunci material deployment', () => {
  const catalog = [{
    catalogDate: '2026-09-20', equipmentId: 'ex-1', loaderCode: 'EX-01', jobCode: 'OB',
    material: 'TOP SOIL', planningType: 'ob', fleetProductivity: 165,
    productivityUnit: 'BCM/Hr', versionId: 'plan-top-soil', effectiveFrom: '2026-09-18',
  }];
  const fleets = [
    { tanggal: '2026-09-20', excavatorId: 'ex-1', pit: 'BEI', jobCode: 'OB', material: 'TOP SOIL', materialType: 'OB' },
    { tanggal: '2026-09-20', excavatorId: 'ex-2', pit: 'BEI', jobCode: 'OB', material: 'TOP SOIL', materialType: 'OB' },
  ];
  const deployment = [{
    tanggal: '2026-09-20', equipmentId: 'ex-1', pit: 'BEI', jobCode: 'OB',
    material: 'CLAY', planningType: 'ob', productivityUnit: 'BCM/Hr', productivity: 140,
  }];
  const cells = Controller.buildFleetMaterialReviewPlottedCells(catalog, fleets, deployment);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].equipmentId, 'ex-1');
  assert.equal(cells[0].material, 'TOP SOIL');
  assert.equal(cells[0].productivity, 165);
  assert.equal(Controller.reviewDeploymentScopeKey(cells[0]), Controller.reviewDeploymentScopeKey(deployment[0]));
});

test('Waterfall harian tertutup saat plan productivity berubah antarperiode', () => {
  const first = Controller.calculateClosedReviewWaterfallCell({
    availablePlanHours: 21.6, delayPlanHours: 3.6,
    productivityPlan: 150,
    uaPlan: 18 / 21.6,
    hmActual: 16,
    standbyActual: 4,
    actualProduction: 2720,
  });
  const second = Controller.calculateClosedReviewWaterfallCell({
    availablePlanHours: 19.2, delayPlanHours: 7.2,
    productivityPlan: 180,
    uaPlan: 12 / 19.2,
    hmActual: 10,
    standbyActual: 5,
    actualProduction: 1900,
  });
  const rows = [first, second];
  const plan = rows.reduce((sum, row) => sum + row.plan, 0);
  const dppa = rows.reduce((sum, row) => sum + row.dppa, 0);
  const dpua = rows.reduce((sum, row) => sum + row.dpua, 0);
  const dProd = rows.reduce((sum, row) => sum + row.dProd, 0);
  const actual = rows.reduce((sum, row) => sum + row.actualProduction, 0);
  assert.ok(Math.abs((plan + dppa + dpua + dProd) - actual) < 1e-9);
  assert.equal(actual, 4620);
});

test('Waterfall material memakai HM material sendiri dan tidak menyisakan cross-term', () => {
  const clay = Controller.calculateClosedReviewWaterfallCell({
    availablePlanHours: 10, delayPlanHours: 2, productivityPlan: 140,
    hmActual: 5, standbyActual: 2, actualProduction: 900,
  });
  const topSoil = Controller.calculateClosedReviewWaterfallCell({
    availablePlanHours: 10 / 0.75, delayPlanHours: 10 / 0.75 - 10, productivityPlan: 175,
    hmActual: 9, standbyActual: 1, actualProduction: 1350,
  });
  const total = [clay, topSoil].reduce((sum, row) => sum + row.plan + row.dppa + row.dpua + row.dProd, 0);
  assert.ok(Math.abs(total - 2250) < 1e-9);
});
