'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Productivity = require('../src/services/productivityRanking');
const FuelRatio = require('../src/services/fuelRatioRanking');

const JOBS = [{ job_code: 'OB', job_desc: 'Overburden' }, { job_code: 'CG', job_desc: 'Coal Getting' }];

function fixture(type = 'ob') {
  const coal = type === 'coal';
  const material = coal ? 'SEAM 3' : 'CLAY';
  const job = coal ? 'CG' : 'OB';
  const materialType = coal ? 'Coal' : 'Overburden';
  const factor = coal ? 15 : 20;
  return {
    base: {
      fleets: [{ id: 'fm-1', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', excavator_id: 'ex-1', excavator_code: 'EX-1', job_code: job, pit_area: 'BEI', material_detail: material, material_type: materialType, jarak_km: 2 }],
      ritase: [{ id: 'r1', fleet_mapping_id: 'fm-1', dump_truck_id: 'dt-1', period_hour: 8, ritase_count: 10, nonprod_count: 2, dt_code: 'DT-1', dt_tipe: 'HD785' }],
      segments: [
        { id: 's-ex-a', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'ex-1', kode_alat: 'EX-1', tipe_alat: 'PC', kelas_alat: 'Excavator', operator_id: 'op-a', operator_nama: 'Andi', job, area_name: 'BEI', total_hm: 4 },
        { id: 's-ex-b', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'ex-1', kode_alat: 'EX-1', tipe_alat: 'PC', kelas_alat: 'Excavator', operator_id: 'op-b', operator_nama: 'Budi', job, area_name: 'BEI', total_hm: 4 },
        { id: 's-dt', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'dt-1', kode_alat: 'DT-1', tipe_alat: 'HD785', kelas_alat: 'Dump Truck', operator_id: 'dr-a', operator_nama: 'Dani', job, area_name: 'BEI', total_hm: 8 },
      ],
      factors: [{ tanggal: '2026-09-01', kategori: coal ? 'Coal' : 'OB', tipe_alat: 'HD785', material, factor_value: factor }],
      versions: [{ id: 'v-1', planning_type: type, effective_from: '2026-09-01', data_json: {
        parameters: [{ material, density: coal ? 1.5 : null }],
        fleetCatalog: [{ tableId: 'set-1', loaderCode: 'EX-1', material, jobCode: job, loaderProductivity: 100, complete: true, truckResults: [{ id: 'dt-1', productivity: 80 }] }],
        fleetSetups: [{ id: 'set-1', jobCode: job, dumpTruckIds: ['dt-1'], benchmarkDistanceMeters: 2000 }],
      } }],
      jobs: JOBS, deployedJobs: [job],
    },
    fuel: [
      { id: 'f-ex', tanggal: '2026-09-20', shift_id: 's1', equipment_id: 'ex-1', fuel_filled: 64, kode_alat: 'EX-1', kelas_alat: 'Excavator' },
      { id: 'f-dt', tanggal: '2026-09-20', shift_id: 's1', equipment_id: 'dt-1', fuel_filled: 80, distance_km: 40, kode_alat: 'DT-1', kelas_alat: 'Dump Truck' },
    ],
    allocations: [], snapshots: [],
  };
}

test('OB memakai SUM liter / productive BCM dan mengurutkan FR terendah', () => {
  const data = fixture('ob');
  const filters = Productivity.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' });
  const result = FuelRatio.buildFuelRatioDomain(data, filters);
  // 10 rit - 2 Non Prod = 8 rit x 20 = 160 BCM.
  assert.equal(result.rankings.excavators[0].actual_fuel_ratio, 64 / 160);
  assert.equal(result.rankings.dumpTrucks[0].unit, 'L/Km');
  assert.equal(result.rankings.dumpTrucks[0].distance_km, 40);
  assert.equal(result.rankings.dumpTrucks[0].actual_fuel_ratio, 80 / 40);
  assert.equal(result.rankings.dumpTruckDrivers[0].unit, 'L/Km');
  assert.equal(result.rankings.dumpTruckDrivers[0].actual_fuel_ratio, 80 / 40);
  assert.equal(result.rankings.excavatorOperators.length, 2);
  assert.equal(result.rankings.excavatorOperators[0].liters, 32, 'liter dibagi HM-share 50:50');
  assert.equal(result.rankings.excavatorOperators[0].actual_fuel_ratio, 64 / 160);
});

test('Coal mengonversi Ton ke BCM per density sebelum menghitung L/BCM', () => {
  const data = fixture('coal');
  const filters = Productivity.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'coal' });
  const result = FuelRatio.buildFuelRatioDomain(data, filters);
  // Net 8 rit x 15 = 120 Ton; density 1.5 = 80 BCM; 64/80 = 0.8.
  assert.equal(result.rankings.excavators[0].net_bcm, 80);
  assert.equal(result.rankings.excavators[0].actual_fuel_ratio, 0.8);
  assert.equal(result.rankings.dumpTrucks[0].actual_fuel_ratio, 2, 'DT tetap memakai Liter/Km, bukan density Coal');
});

test('Dump Truck tanpa jarak odometer valid tidak diranking sebagai nol Liter/Km', () => {
  const data = fixture('ob');
  data.fuel.find(row => row.id === 'f-dt').distance_km = null;
  const filters = Productivity.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' });
  const result = FuelRatio.buildFuelRatioDomain(data, filters);
  const control = result.controls.find(row => row.entity_type === 'dumptruck');
  assert.equal(control.unit, 'L/Km');
  assert.equal(control.actual_fuel_ratio, null);
  assert.equal(control.control_status, 'incomplete');
  assert.ok(control.reason_codes.includes('MISSING_DISTANCE_KM'));
  assert.equal(result.rankings.dumpTrucks.length, 0);
  assert.equal(result.rankings.dumpTruckDrivers.length, 0);
});

test('Jarak DT tidak diprorata diam-diam ketika satu fuel log dibagi ke beberapa alokasi', () => {
  const data = fixture('ob');
  data.allocations = [{ fuel_log_id: 'f-dt', revision: 1, allocations: [
    { area: 'BEI', jobCode: 'OB', liters: 40 },
    { area: 'BEI', jobCode: 'OB', liters: 40 },
  ] }];
  const filters = Productivity.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' });
  const result = FuelRatio.buildFuelRatioDomain(data, filters);
  const control = result.controls.find(row => row.entity_type === 'dumptruck');
  assert.equal(control.control_status, 'ambiguous');
  assert.ok(control.reason_codes.includes('AMBIGUOUS_DISTANCE_ALLOCATION'));
  assert.equal(result.rankings.dumpTrucks.length, 0);
});

test('Rasio periode DT memakai total liter / total KM, bukan rata-rata rasio harian', () => {
  const data = fixture('ob');
  data.base.fleets.push({ ...data.base.fleets[0], id: 'fm-2', tanggal: '2026-09-21' });
  data.base.ritase.push({ ...data.base.ritase[0], id: 'r2', fleet_mapping_id: 'fm-2' });
  data.base.segments.push(...data.base.segments.map(row => ({ ...row, id: `${row.id}-2`, tanggal: '2026-09-21' })));
  data.fuel.push({ ...data.fuel.find(row => row.id === 'f-dt'), id: 'f-dt-2', tanggal: '2026-09-21', fuel_filled: 60, distance_km: 10 });
  const filters = Productivity.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' });
  const result = FuelRatio.buildFuelRatioDomain(data, filters);
  const row = result.rankings.dumpTrucks[0];
  assert.equal(row.liters, 140);
  assert.equal(row.distance_km, 50);
  assert.equal(row.actual_fuel_ratio, 140 / 50);
});

test('Fuel Ratio Data Control mengecualikan JOB yang belum deployed di SPO', () => {
  const data = fixture('ob');
  const filters = Productivity.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' });
  data.base.deployedJobs = [];
  const emptySpo = FuelRatio.buildFuelRatioDomain(data, filters);
  assert.equal(emptySpo.controls.length, 0, 'SPO tanpa JOB deployed tidak boleh fallback ke seluruh fuel/produksi');

  data.base.deployedJobs = ['CG'];
  const result = FuelRatio.buildFuelRatioDomain(data, filters);
  assert.equal(result.controls.length, 0);
  assert.equal(result.rankings.excavators.length, 0);
  assert.equal(result.rankings.dumpTrucks.length, 0);
});

test('Fuel pada dua material tidak diprorata diam-diam', () => {
  const data = fixture('ob');
  data.base.fleets.push({ ...data.base.fleets[0], id: 'fm-2', material_detail: 'SAND' });
  data.base.ritase.push({ ...data.base.ritase[0], id: 'r2', fleet_mapping_id: 'fm-2' });
  data.base.factors.push({ ...data.base.factors[0], material: 'SAND' });
  const filters = Productivity.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' });
  const result = FuelRatio.buildFuelRatioDomain(data, filters);
  assert.ok(result.controls.some(row => row.reason_codes.includes('FUEL_AMBIGUOUS_MATERIAL')));
  assert.equal(result.rankings.excavators.length, 0);
});

test('Rasio periode memakai total liter / total BCM, bukan rata-rata rasio', () => {
  const data = fixture('ob');
  const copyFleet = { ...data.base.fleets[0], id: 'fm-2', tanggal: '2026-09-21' };
  data.base.fleets.push(copyFleet);
  data.base.ritase.push({ ...data.base.ritase[0], id: 'r2', fleet_mapping_id: 'fm-2', ritase_count: 20, nonprod_count: 0 });
  data.base.segments.push(...data.base.segments.map(row => ({ ...row, id: `${row.id}-2`, tanggal: '2026-09-21' })));
  data.fuel.push({ ...data.fuel[0], id: 'f-ex-2', tanggal: '2026-09-21', fuel_filled: 40 });
  const filters = Productivity.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' });
  const result = FuelRatio.buildFuelRatioDomain(data, filters);
  const row = result.rankings.excavators[0];
  assert.equal(row.actual_fuel_ratio, (64 + 40) / (160 + 400));
});
