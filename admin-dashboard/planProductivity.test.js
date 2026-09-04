const assert = require('node:assert/strict');
const {
  calculateProductivityValues,
  buildFactorTableData,
  buildFactorTableHtml,
} = require('./planProductivity.core.js');

const values = {
  bucketCapacity: 3.2,
  bucketFillFactor: 0.9,
  swellFactor: 1.3,
  dumpTruckCapacity: 12,
  workEffLoader: 0.7,
  cycleTimeLoading: 23,
  loadedSpeed: 15,
  emptySpeed: 30,
  spotDumpTime: 2,
  distance: 1.2,
  workEffFleet: 0.765,
  numberOfTruck: 5,
};

const result = calculateProductivityValues(values);

assert.ok(Math.abs(result.loaderCap - 2.22) < 0.05, `loaderCap should be ~2.22, got ${result.loaderCap}`);
assert.equal(result.numPass, 5, `numPass should be 5, got ${result.numPass}`);
assert.ok(Math.abs(result.loadingTime - 1.92) < 0.1, `loadingTime should be ~1.92, got ${result.loadingTime}`);
assert.ok(Math.abs(result.cycleTimeTruck - 11.12) < 0.2, `cycleTimeTruck should be ~11.12, got ${result.cycleTimeTruck}`);
assert.ok(Math.abs(result.loaderProductivity - 244.6) < 5, `loaderProductivity should be ~244.6, got ${result.loaderProductivity}`);
assert.ok(Math.abs(result.truckProductivity - 49.56) < 2, `truckProductivity should be ~49.56, got ${result.truckProductivity}`);
assert.ok(Math.abs(result.fleetMatch - 1.01) < 0.1, `fleetMatch should be ~1.01, got ${result.fleetMatch}`);
assert.ok(Math.abs(result.fleetProductivity - 244.6) < 5, `fleetProductivity should be ~244.6, got ${result.fleetProductivity}`);

const precisionResult = calculateProductivityValues({
  bucketCapacity: 6,
  bucketFillFactor: 0.9,
  swellFactor: 1.3,
  dumpTruckCapacity: 30,
  workEffLoader: 0.7,
  cycleTimeLoading: 23,
  loadedSpeed: 15,
  emptySpeed: 30,
  spotDumpTime: 2,
  distance: 1.2,
  workEffFleet: 0.765,
  numberOfTruck: 5,
});
assert.ok(Math.abs(precisionResult.loaderProductivity - 455.1170568561873) < 0.000001, `loaderProductivity must retain full precision, got ${precisionResult.loaderProductivity}`);

const coalResult = calculateProductivityValues({ ...values, density: 1.3 });
assert.ok(Math.abs(coalResult.truckProductivity - result.truckProductivity * 1.3) < 0.000001, `coal truck productivity must convert BCM/Hr to Ton/Hr with density, got ${coalResult.truckProductivity}`);

const swellRows = buildFactorTableData('swell', [
  { material: 'PASIR', value: 1.2 },
  { material: 'CLAY', value: 1.3 },
]);
assert.equal(swellRows.length, 2, 'swell rows should be preserved');
assert.equal(swellRows[0].material, 'PASIR', 'first row should keep material name');
assert.ok(typeof buildFactorTableHtml === 'function', 'factor table HTML builder should exist');
assert.match(buildFactorTableHtml('swell', swellRows), /Tabel Swell Factor/i, 'swel factor HTML should include label');

console.log('planProductivity tests passed');
