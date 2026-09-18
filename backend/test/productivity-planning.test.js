'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const planning = require('../src/services/productivityPlanning');
const controller = require('../src/controllers/production.controller');

test('batas setup periode mengikuti tahun akhir tabel SPO deployed', async () => {
  const db = { query: async () => ({ rows: [{ data_json: { tables: {
    ob: { deployed: true, endYear: 2028 },
    coal: { deployed: true, endYear: 2029 },
    draft: { deployed: false, endYear: 2035 }
  } } }] }) };
  assert.equal(await controller.getSpoPeriodEnd(db), '2029-12-31');
});

test('fleet heterogen menjumlahkan produktivitas setiap truck dan dibatasi loader', () => {
  const result = planning.calculateHeterogeneousFleet({
    planningType: 'ob',
    parameter: { fill: 0.9, swell: 1.3 },
    loader: { capacity: 2.1, capacityUom: 'm3' },
    scenario: { jobCode: 'OB', cycleTimeLoading: 25, workEffLoader: 0.72, loadedSpeed: 15,
      emptySpeed: 30, spotDumpTime: 2, distance: 1.2, workEffFleet: 0.765 },
    trucks: [{ id: 'dt-11', capacity: 11, capacityUom: 'BCM' }, { id: 'dt-14', capacity: 14, capacityUom: 'BCM' }]
  });
  assert.equal(result.truckResults.length, 2);
  assert.ok(result.truckFleetProductivity > result.truckResults[0].productivity);
  assert.equal(result.fleetProductivity, Math.min(result.loaderProductivity, result.truckFleetProductivity));
  assert.equal(result.productivityUnit, 'BCM/Hr');
});

test('coal mengalikan kapasitas BCM dengan density Ton/BCM tepat satu kali', () => {
  const base = { jobCode: 'CG', cycleTimeLoading: 25, workEffLoader: 0.7, loadedSpeed: 15,
    emptySpeed: 30, spotDumpTime: 2, distance: 1, workEffFleet: 0.8 };
  const bcm = planning.calculateHeterogeneousFleet({ planningType: 'coal', scenario: base,
    parameter: { fill: 1, swell: 1, density: 1.3 }, loader: { capacity: 2 },
    trucks: [{ id: 'bcm', capacity: 10, capacityUom: 'BCM' }] });
  const ton = planning.calculateHeterogeneousFleet({ planningType: 'coal', scenario: base,
    parameter: { fill: 1, swell: 1, density: 1.3 }, loader: { capacity: 2 },
    trucks: [{ id: 'ton', capacity: 13, capacityUom: 'Ton' }] });
  assert.ok(Math.abs(bcm.truckFleetProductivity - ton.truckFleetProductivity) < 1e-9);
  assert.equal(bcm.productivityUnit, 'Ton/Hr');
});

test('hauler matrix memakai meter sebagai key dan menolak Ton untuk output OB BCM', () => {
  const valid = planning.calculateHaulerProductivity({ planningType: 'ob', distanceMeters: 500,
    truck: { capacity: 11, capacityUom: 'BCM' }, parameter: {},
    profile: { loadingTime: 3, loadedSpeed: 15, emptySpeed: 30, spotDumpTime: 2, workEfficiency: 0.8 } });
  assert.ok(valid.productivity > 0);
  assert.equal(valid.productivityUnit, 'BCM/Hr');
  assert.equal(planning.calculateHaulerProductivity({ planningType: 'ob', distanceMeters: 500,
    truck: { capacity: 20, capacityUom: 'Ton' }, parameter: {},
    profile: { loadingTime: 3, loadedSpeed: 15, emptySpeed: 30, spotDumpTime: 2, workEfficiency: 0.8 } }), null);
});

test('unit dump truck nonaktif tetap dapat diaudit tetapi scenario tidak siap menjadi target', () => {
  const result = planning.calculateHeterogeneousFleet({ planningType: 'ob',
    parameter: { fill: 0.9, swell: 1.3 }, loader: { capacity: 2.1 },
    scenario: { jobCode: 'OB', cycleTimeLoading: 25, workEffLoader: 0.72, loadedSpeed: 15,
      emptySpeed: 30, spotDumpTime: 2, distance: 1.2, workEffFleet: 0.765 },
    trucks: [{ id: 'dt-old', capacity: 11, capacityUom: 'BCM', active: false }] });
  assert.ok(result.fleetProductivity > 0);
  assert.equal(result.complete, false);
});

test('kapasitas Dump Truck tanpa UoM eksplisit tidak menghasilkan target semu', () => {
  const scenario = { jobCode: 'OB', cycleTimeLoading: 25, workEffLoader: 0.72,
    loadedSpeed: 15, emptySpeed: 30, spotDumpTime: 2, distance: 1.2, workEffFleet: 0.765 };
  const result = planning.calculateHeterogeneousFleet({ planningType: 'ob', scenario,
    parameter: { fill: 0.9, swell: 1.3 }, loader: { capacity: 2.1 },
    trucks: [{ id: 'dt-unknown', capacity: 11, capacityUom: '' }] });
  assert.equal(result.truckResults[0].productivity, 0);
  assert.equal(result.complete, false);
  assert.equal(planning.calculateHaulerProductivity({ planningType: 'ob', distanceMeters: 1000,
    truck: { capacity: 11, capacityUom: '' }, parameter: {},
    profile: { loadingTime: 3, loadedSpeed: 15, emptySpeed: 30, spotDumpTime: 2, workEfficiency: 0.8 } }), null);
});

test('backend menghitung ulang target dan membiarkan Parameter material yang belum digunakan tetap draft', async () => {
  const loaderId = '00000000-0000-4000-8000-000000000001';
  const truckId = '00000000-0000-4000-8000-000000000002';
  const db = { query: async () => ({ rows: [
    { id: loaderId, kode_alat: 'EX-01', kelas_alat: 'Excavator', kapasitas_unit: 2.1, kapasitas_unit_uom: 'm3' },
    { id: truckId, kode_alat: 'DT-01', kelas_alat: 'Dump Truck', class_unit: 'DT30', tipe_alat: 'SANY', kapasitas_unit: 11,
      kapasitas_unit_uom: 'BCM', is_active: true }
  ] }) };
  const result = await controller.validateAndCalculatePlanningData(db, 'ob', {
    version: 4,
    parameters: [{ material: 'CLAY', fill: 0.9, swell: 1.3 }, { material: 'SOIL', fill: '', swell: '' }],
    scenarios: [{ id: 'ob-scenario-1', loaderId, material: 'CLAY', jobCode: 'OB', dumpTruckIds: [truckId],
      cycleTimeLoading: 25, workEffLoader: 0.72, loadedSpeed: 15, emptySpeed: 30,
      spotDumpTime: 2, distance: 1.2, workEffFleet: 0.765, fleetProductivity: 999999 }]
  }, '2026-09-16');
  assert.ok(result.fleetCatalog[0].fleetProductivity > 0);
  assert.notEqual(result.fleetCatalog[0].fleetProductivity, 999999);
  assert.equal(result.fleetCatalog[0].numberOfTruck, 1);
  assert.equal(result.fleetCatalog[0].effectiveFrom, '2026-09-16');
});

test('kecepatan hauling yang kosong tidak dihitung sebagai waktu tempuh nol', () => {
  const result = planning.calculateHeterogeneousFleet({ planningType: 'ob',
    parameter: { fill: 0.9, swell: 1.3 }, loader: { capacity: 2.1 },
    scenario: { jobCode: 'OB', cycleTimeLoading: 25, workEffLoader: 0.72,
      loadedSpeed: 0, emptySpeed: 30, spotDumpTime: 2, distance: 1.2, workEffFleet: 0.765 },
    trucks: [{ id: 'dt-01', capacity: 11, capacityUom: 'BCM' }] });
  assert.equal(result.fleetProductivity, 0);
  assert.equal(result.complete, false);
});

test('database Fleet memakai baris Hauler per excavator dan material sebagai target authoritative', async () => {
  const loaderId = '00000000-0000-4000-8000-000000000011';
  const truckId = '00000000-0000-4000-8000-000000000012';
  const db = { query: async () => ({ rows: [
    { id: loaderId, kode_alat: 'EX-11', kelas_alat: 'Excavator', kapasitas_unit: 2.1, kapasitas_unit_uom: 'm3', is_active: true },
    { id: truckId, kode_alat: 'DT-12', kelas_alat: 'Dump Truck', kapasitas_unit: 9,
      kapasitas_unit_uom: 'BCM', is_active: true }
  ] }) };
  const scenario = { id: 'fleet-11-clay', loaderId, material: 'CLAY', jobCode: 'OB', dumpTruckIds: [truckId],
    cycleTimeLoading: 25, workEffLoader: 0.72, benchmarkDistanceMeters: 1200,
    fleetProductivity: 999999 };
  const payload = { version: 5, parameters: [{ material: 'CLAY', fill: 0.9, swell: 1.3 }],
    scenarios: [scenario], haulerRows: [{ loaderId, truckId, material: 'CLAY', capacity: 11,
      capacityUom: 'BCM', loadedSpeed: 15, emptySpeed: 30, spotDumpTime: 2, workEfficiency: 0.765 }] };
  const result = await controller.validateAndCalculatePlanningData(db, 'ob', payload, '2026-09-17');
  const rate = result.fleetCatalog[0].fleetProductivity;
  assert.ok(rate > 0 && rate < 999999);
  assert.equal(rate, Math.min(result.fleetCatalog[0].loaderProductivity, result.fleetCatalog[0].truckProductivity));
  assert.equal(result.fleetCatalog[0].formulaVersion, planning.FLEET_DATABASE_FORMULA_VERSION);
  assert.equal(result.fleetCatalog[0].complete, true);
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'ob', {
    ...payload, scenarios: [scenario, { ...scenario, id: 'duplicate', benchmarkDistanceMeters: 500 }]
  }, '2026-09-17'), /sudah tersedia/);
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'ob', {
    ...payload, haulerRows: [...payload.haulerRows, { ...payload.haulerRows[0] }]
  }, '2026-09-17'), /duplikat/);
});

test('database Hauler menghitung loading time dari kapasitas per material dan Coal density sekali', () => {
  const input = { planningType: 'coal', scenario: { jobCode: 'CG', cycleTimeLoading: 30,
    workEffLoader: 0.7, benchmarkDistanceMeters: 1000 },
  parameter: { fill: 1, swell: 1, density: 1.3 }, loader: { capacity: 2 },
  trucks: [{ id: 'DT1', active: true }], haulerRows: [{ truckId: 'DT1', capacity: 13,
    capacityUom: 'Ton', loadedSpeed: 20, emptySpeed: 25, spotDumpTime: 2, workEfficiency: 0.8 }] };
  const result = planning.calculateFleetFromHaulerRows(input);
  assert.equal(result.truckResults[0].passes, 5);
  assert.equal(result.truckResults[0].loadingTime, 2.5);
  assert.ok(result.truckResults[0].productivity > 0);
  const incomplete = planning.calculateFleetFromHaulerRows({ ...input,
    haulerRows: [{ ...input.haulerRows[0], spotDumpTime: '' }] });
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.fleetProductivity, 0);
});

test('v6 memisahkan Loader per material dan Setting Fleet per JOB untuk katalog Ritase', async () => {
  const loaderId = '00000000-0000-4000-8000-000000000021';
  const truckId = '00000000-0000-4000-8000-000000000022';
  const db = { query: async () => ({ rows: [
    { id: loaderId, kode_alat: 'EX-21', kelas_alat: 'Excavator', kapasitas_unit: 2.1, is_active: true },
    { id: truckId, kode_alat: 'DT-22', kelas_alat: 'Dump Truck', kapasitas_unit: 9,
      kapasitas_unit_uom: 'BCM', is_active: true }
  ] }) };
  const payload = { version: 6, parameters: [{ material: 'CLAY', fill: 0.9, swell: 1.3 }],
    scenarios: [{ id: 'loader-clay', loaderId, material: 'CLAY', jobCodes: ['OB', 'FOT'],
      cycleTimeLoading: 25, workEffLoader: 0.72, loaderProductivity: 999999 }],
    haulerRows: [{ loaderId, truckId, material: 'CLAY', capacity: 11, capacityUom: 'BCM',
      loadedSpeed: 15, emptySpeed: 30, spotDumpTime: 2, workEfficiency: 0.765 }],
    fleetSetups: [
      { id: 'setting-ob', loaderScenarioId: 'loader-clay', jobCode: 'OB',
        dumpTruckIds: [truckId], benchmarkDistanceMeters: 1000 },
      { id: 'setting-fot', loaderScenarioId: 'loader-clay', jobCode: 'FOT',
        dumpTruckIds: [truckId], benchmarkDistanceMeters: 1500 }
    ] };
  const saved = await controller.validateAndCalculatePlanningData(db, 'ob', payload, '2026-09-17');
  assert.equal(saved.scenarios.length, 1);
  assert.equal(saved.fleetCatalog.length, 2);
  assert.ok(saved.scenarios[0].loaderProductivity > 0);
  assert.notEqual(saved.scenarios[0].loaderProductivity, 999999);
  assert.ok(saved.fleetCatalog[0].fleetProductivity > saved.fleetCatalog[1].fleetProductivity);
  assert.equal(saved.fleetCatalog[0].fleetProductivity,
    Math.min(saved.fleetCatalog[0].loaderProductivity, saved.fleetCatalog[0].truckProductivity));
  assert.equal(saved.fleetCatalog[0].planRef, 'ob:setting-ob');
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'ob', {
    ...payload, scenarios: [...payload.scenarios, { ...payload.scenarios[0], id: 'loader-duplicate' }]
  }, '2026-09-17'), /sudah ada/);
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'ob', {
    ...payload, fleetSetups: [...payload.fleetSetups, { ...payload.fleetSetups[0], id: 'setting-duplicate' }]
  }, '2026-09-17'), /sudah ada/);
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'ob', {
    ...payload, fleetSetups: [payload.fleetSetups[0], { ...payload.fleetSetups[1], planRef: 'ob:setting-ob' }]
  }, '2026-09-17'), /referensi Setting Fleet duplikat/);
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'ob', {
    ...payload, fleetSetups: [{ ...payload.fleetSetups[0], dumpTruckIds: 'invalid' }]
  }, '2026-09-17'), /Daftar Dump Truck Setting Fleet tidak valid/);
});

test('v7 menambah header jarak dan mengunci satuan Capacity sesuai jenis planning', async () => {
  const loaderId = '00000000-0000-4000-8000-000000000031';
  const truckId = '00000000-0000-4000-8000-000000000032';
  const db = { query: async () => ({ rows: [
    { id: loaderId, kode_alat: 'EX-31', kelas_alat: 'Excavator', kapasitas_unit: 2.1, is_active: true },
    { id: truckId, kode_alat: 'DT-32', kelas_alat: 'Dump Truck', kapasitas_unit: 9,
      kapasitas_unit_uom: 'BCM', is_active: true }
  ] }) };
  const base = { version: 7, parameters: [{ material: 'COAL', density: 1.3, fill: 0.9, swell: 1.3 }],
    scenarios: [{ id: 'coal-loader', loaderId, material: 'COAL', jobCodes: ['CG'],
      cycleTimeLoading: 25, workEffLoader: 0.72 }],
    haulerRows: [{ loaderId, truckId, material: 'COAL', capacity: 14.3, capacityUom: 'Ton',
      loadedSpeed: 15, emptySpeed: 30, spotDumpTime: 2, workEfficiency: 0.765 }],
    distanceHeadersMeters: [500, 600, 2100],
    fleetSetups: [{ id: 'coal-fleet', loaderScenarioId: 'coal-loader', jobCode: 'CG',
      dumpTruckIds: [truckId], benchmarkDistanceMeters: 2100 }] };
  const saved = await controller.validateAndCalculatePlanningData(db, 'coal', base, '2026-09-17');
  assert.equal(saved.version, 7);
  assert.equal(saved.fleetCatalog[0].productivityUnit, 'Ton/Hr');
  assert.equal(saved.fleetCatalog[0].fleetProductivity > 0, true);
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'coal', {
    ...base, haulerRows: [{ ...base.haulerRows[0], capacityUom: 'BCM' }]
  }, '2026-09-17'), /belum valid/);
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'coal', {
    ...base, distanceHeadersMeters: [500, 550, 2100]
  }, '2026-09-17'), /Header jarak/);
  await assert.rejects(controller.validateAndCalculatePlanningData(db, 'coal', {
    ...base, distanceHeadersMeters: [500, 600]
  }, '2026-09-17'), /harus tersedia sebagai header/);
});
