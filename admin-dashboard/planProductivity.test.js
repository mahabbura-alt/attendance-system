const assert = require('node:assert/strict');
const {
  calculateProductivityValues,
  buildFactorTableData,
  buildFactorTableHtml,
  buildCoalParameterTable,
  buildFleetCatalog,
  tableTemplate,
  setFleetOptions,
  setDumpTruckOptions,
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

const coalParameters = [
  { material: 'CLAY', density: 1.3, fill: 0.9, swell: 1.3 },
];
const coalParameterHtml = buildCoalParameterTable(coalParameters);
assert.match(coalParameterHtml, /Material Density/i, 'coal parameter table should contain density header');
assert.match(coalParameterHtml, /Bucket Fill Factor/i, 'coal parameter table should contain fill-factor header');
assert.match(coalParameterHtml, /Swell Factor/i, 'coal parameter table should contain swell-factor header');

const coalFleetHtml = tableTemplate('coal-productivity-test', { material: 'CLAY' }, coalParameters);
assert.match(coalFleetHtml, /<input[^>]*readonly[^>]*data-plan-productivity-field="bucketFillFactor"/i, 'coal bucket fill factor must be read-only');
assert.match(coalFleetHtml, /<input[^>]*readonly[^>]*data-plan-productivity-field="swellFactor"/i, 'coal swell factor must be read-only');
assert.match(coalFleetHtml, /value="0.9"/, 'coal fill factor should be read from selected material parameter');
assert.match(coalFleetHtml, /value="1.3"/, 'coal swell factor should be read from selected material parameter');
assert.match(coalFleetHtml, /data-fleet-productivity="[0-9.]+"/, 'fleet table must expose the full-precision productivity for structured persistence');
assert.match(coalFleetHtml, /data-fleet-productivity-unit="Ton\/Hr"/, 'coal fleet catalog must preserve Ton/Hr');
assert.equal(typeof buildFleetCatalog, 'function', 'structured fleet catalog builder must be exported');

const boundFleetHtml = tableTemplate('plan-productivity-job', {
  material: 'CLAY',
  jobCode: 'OB',
  jobDescription: 'Overburden Removal',
}, coalParameters);
assert.match(boundFleetHtml, /data-plan-job-code="OB"/, 'fleet table must persist the canonical JOB code');
assert.match(boundFleetHtml, /data-plan-job-description="Overburden Removal"/, 'fleet table must preserve the JOB description snapshot');
assert.match(boundFleetHtml, /JOB: OB/, 'fleet table header must expose its JOB binding');

// Regression: pilihan excavator/dump truck tersimpan harus dipertahankan saat
// tabel di-render ulang sebelum opsi equipment dimuat (fleetOptions/dumpTruckOptions
// masih kosong). Sebelumnya nilai terpilih hilang karena tidak ada <option> yang cocok,
// sehingga data tampak tidak tersimpan setelah refresh halaman.
const preservedHtml = tableTemplate('plan-productivity-preserve', {
  fleetName: 'PC2000',
  dumpTruck: 'HD785',
  material: 'CLAY',
}, coalParameters);
assert.match(preservedHtml, /<option value="PC2000" selected>PC2000<\/option>/, 'saved excavator must be preserved as a selected fallback option when options not yet loaded');
assert.match(preservedHtml, /<option value="HD785" selected>HD785<\/option>/, 'saved dump truck must be preserved as a selected fallback option when options not yet loaded');

// Saat nilai terpilih memang ada di daftar opsi, tidak boleh ada duplikat fallback.
setFleetOptions([{ value: 'EXC-01', capacity: 6 }]);
setDumpTruckOptions([{ value: 'DT-01', capacity: 30 }]);
const withOptionsHtml = tableTemplate('plan-productivity-opt', {
  fleetName: 'EXC-01',
  dumpTruck: 'DT-01',
  material: 'CLAY',
}, coalParameters);
const fleetOptionCount = (withOptionsHtml.match(/value="EXC-01"/g) || []).length;
const dumpTruckOptionCount = (withOptionsHtml.match(/value="DT-01"/g) || []).length;
assert.equal(fleetOptionCount, 1, 'no duplicate fallback option when the value exists in the option list');
assert.equal(dumpTruckOptionCount, 1, 'no duplicate fallback option for dump truck when the value exists in the option list');

console.log('planProductivity tests passed');
