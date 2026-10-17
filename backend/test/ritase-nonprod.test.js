'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRitase, productiveRitase, productionFromRitase, FORMULA_VERSION } = require('../src/services/ritaseProductivity');
const { calculateWeightedFleetDistance } = require('../src/controllers/production.controller');

test('ritase produktif mempertahankan bruto dan mengurangi Non Prod / Inpit', () => {
  assert.deepEqual(normalizeRitase(6, 2), { gross: 6, nonprod: 2, productive: 4, formulaVersion: FORMULA_VERSION });
  assert.equal(productiveRitase(5, 3), 2);
  assert.equal(productionFromRitase(6, 2, 11), 44);
});

test('Non Prod menerima batas 0 dan sama dengan bruto, tetapi menolak nilai invalid', () => {
  assert.equal(productiveRitase(6, 0), 6);
  assert.equal(productiveRitase(6, 6), 0);
  assert.throws(() => productiveRitase(6, 7), /tidak boleh melebihi/);
  assert.throws(() => productiveRitase(6.5, 1), /bilangan bulat/);
  assert.throws(() => productiveRitase(6, -1), /bilangan bulat/);
});

test('Jarak Final memakai ritase produktif dan membatasi alokasi terhadap nilai net', () => {
  const result = calculateWeightedFleetDistance({
    setupDistanceKm: 2.1,
    trucks: [{ dump_truck_id: 'dt-1', factor_value: 10, hours: { 7: 10 }, nonprod_hours: { 7: 2 } }],
    allocations: [{ dump_truck_id: 'dt-1', period_hour: 7, ritase_count: 3, distance_km: 0.2 }]
  });
  assert.equal(result.totalVolume, 80);
  assert.equal(result.finalDistanceKm, 111 / 80);
  assert.throws(() => calculateWeightedFleetDistance({
    setupDistanceKm: 2.1,
    trucks: [{ dump_truck_id: 'dt-1', factor_value: 10, hours: { 7: 10 }, nonprod_hours: { 7: 2 } }],
    allocations: [{ dump_truck_id: 'dt-1', period_hour: 7, ritase_count: 9, distance_km: 0.2 }]
  }), /melebihi ritase produktif/);
});

test('migration dan controller menjaga data bruto, audit, dan formula produktif', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/043_ritase_nonprod_inpit.sql'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
  assert.match(migration, /nonprod_ritase_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CHECK \(nonprod_ritase_count <= ritase_count\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ritase_nonprod_audit/);
  assert.match(controller, /INSERT INTO ritase_nonprod_audit/);
  assert.match(controller, /productiveRitase\(row\.ritase_count, row\.nonprod_ritase_count\)/);
  assert.match(controller, /FOR UPDATE/);
});
