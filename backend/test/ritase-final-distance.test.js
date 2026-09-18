const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ProductionController = require('../src/controllers/production.controller');

const calculate = ProductionController.calculateWeightedFleetDistance;

test('jarak final memakai pembobotan volume dengan konversi 200 meter menjadi 0,2 km', () => {
  const result = calculate({
    setupDistanceKm: 2.1,
    trucks: [{ dump_truck_id: 'dt-1', factor_value: 11, hours: { 8: 160 } }],
    allocations: [{ dump_truck_id: 'dt-1', period_hour: 8, ritase_count: 10, distance_km: 0.2 }]
  });

  assert.equal(result.complete, true);
  assert.equal(result.totalVolume, 1760);
  assert.equal(result.adjustedVolume, 110);
  assert.equal(result.finalDistanceKm, 1.98125);
});

test('pembobotan memakai volume sehingga Truck Factor berbeda memengaruhi jarak final', () => {
  const result = calculate({
    setupDistanceKm: 3,
    trucks: [
      { dump_truck_id: 'dt-a', factor_value: 10, hours: { 8: 10 } },
      { dump_truck_id: 'dt-b', factor_value: 20, hours: { 8: 10 } }
    ],
    allocations: [{ dump_truck_id: 'dt-a', period_hour: 8, ritase_count: 10, distance_km: 1 }]
  });

  assert.equal(result.finalDistanceKm, 700 / 300);
});

test('tanpa penyimpangan, jarak final sama dengan jarak setup', () => {
  const result = calculate({
    setupDistanceKm: 2.1,
    trucks: [{ dump_truck_id: 'dt-1', factor_value: 11, hours: { 8: 150 } }],
    allocations: []
  });
  assert.equal(result.finalDistanceKm, 2.1);
  assert.equal(result.status, 'setup-only');
});

test('alokasi jarak tidak boleh melebihi ritase tersimpan pada truck dan jam yang sama', () => {
  assert.throws(() => calculate({
    setupDistanceKm: 2.1,
    trucks: [{ dump_truck_id: 'dt-1', factor_value: 11, hours: { 8: 5 } }],
    allocations: [{ dump_truck_id: 'dt-1', period_hour: 8, ritase_count: 6, distance_km: 0.2 }]
  }), /melebihi ritase tersimpan/);
});

test('alokasi tidak dapat ditempatkan pada jam tanpa ritase tersimpan', () => {
  assert.throws(() => calculate({
    setupDistanceKm: 2.1,
    trucks: [{ dump_truck_id: 'dt-1', factor_value: 11, hours: { 8: 0 } }],
    allocations: [{ dump_truck_id: 'dt-1', period_hour: 8, ritase_count: 1, distance_km: 0.2 }]
  }), /melebihi ritase tersimpan/);
});

test('API dan migration menyimpan sumber nilai, satuan, formula version, serta soft delete', () => {
  const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/production.routes.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/034_ritase_weighted_final_distance.sql'), 'utf8');

  assert.match(routes, /ritase\/distance-allocations/);
  assert.match(controller, /input_distance, input_unit, distance_km/);
  assert.match(controller, /weighted-final-distance-v1/);
  assert.match(migration, /deleted_at TIMESTAMPTZ/);
  assert.match(migration, /CHECK \(input_unit IN \('m', 'km'\)\)/);
});
