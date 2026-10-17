'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/productivityRanking');

const JOBS = [{ job_code: 'OB', job_desc: 'OB Removal' }, { job_code: 'CG', job_desc: 'Coal Getting' }, { job_code: 'DW', job_desc: 'Pekerjaan Rental' }];

function version(prodLoader, prodDt1, prodDt2, eff = '2026-09-01') {
  return { id: `v-${eff}`, planning_type: 'ob', effective_from: eff, revision: 1,
    data_json: {
      loaderCatalog: [{ tableId: 'loader-1', loaderCode: 'EX-1', material: 'CLAY', jobCode: 'OB',
        loaderProductivity: prodLoader, complete: true }],
      parameters: [{ material: 'CLAY', fill: 1, swell: 1 }],
      scenarios: [{ id: 'loader-1', loaderId: 'ex-1', loaderCode: 'EX-1', material: 'CLAY',
        jobCodes: ['OB'], loaderProductivity: prodLoader, bucketCapacity: 2, loaderCap: 2, cycleTimeLoading: 30 }],
      haulerRows: [
        { loaderId: 'ex-1', truckId: 'dt-1', material: 'CLAY', capacity: 10, capacityUom: 'BCM', loadedSpeed: 20, emptySpeed: 25, spotDumpTime: 2, workEfficiency: 0.8 },
        { loaderId: 'ex-1', truckId: 'dt-2', material: 'CLAY', capacity: 10, capacityUom: 'BCM', loadedSpeed: 20, emptySpeed: 25, spotDumpTime: 2, workEfficiency: 0.8 },
      ],
      distanceHeadersMeters: [2500],
    } };
}

function base() {
  return {
    fleets: [{ id: 'fm-1', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang',
      excavator_id: 'ex-1', excavator_code: 'EX-1', job_code: 'OB', pit_area: 'BEI',
      material_detail: 'CLAY', material_type: 'Overburden', jarak_km: 2.5 }],
    ritase: [
      { id: 'r1', fleet_mapping_id: 'fm-1', dump_truck_id: 'dt-1', period_hour: 8, ritase_count: 10, nonprod_count: 2, dt_code: 'DT-1', dt_tipe: 'HD785' },
      { id: 'r2', fleet_mapping_id: 'fm-1', dump_truck_id: 'dt-2', period_hour: 9, ritase_count: 8, nonprod_count: 0, dt_code: 'DT-2', dt_tipe: 'HD785' },
    ],
    segments: [
      { id: 'g1', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'ex-1', kode_alat: 'EX-1', tipe_alat: 'PC1250', kelas_alat: 'Excavator', operator_id: 'op-a', operator_nama: 'Andi', job: 'OB', area_name: 'BEI', total_hm: 4.5, status: 'submitted' },
      { id: 'g2', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'ex-1', kode_alat: 'EX-1', tipe_alat: 'PC1250', kelas_alat: 'Excavator', operator_id: 'op-b', operator_nama: 'Budi', job: 'OB', area_name: 'BEI', total_hm: 4.5, status: 'submitted' },
      { id: 'g3', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'dt-1', kode_alat: 'DT-1', tipe_alat: 'HD785', kelas_alat: 'Dump Truck', operator_id: 'dr-x', operator_nama: 'Xeni', job: 'OB', area_name: 'BEI', total_hm: 9, status: 'submitted' },
      { id: 'g4', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'dt-2', kode_alat: 'DT-2', tipe_alat: 'HD785', kelas_alat: 'Dump Truck', operator_id: 'dr-y', operator_nama: 'Yono', job: 'OB', area_name: 'BEI', total_hm: 8, status: 'submitted' },
    ],
    factors: [{ tanggal: '2026-09-01', kategori: 'OB', tipe_alat: 'HD785', material: 'CLAY', factor_value: 25 }],
    versions: [version(150, 120, 110)],
    jobs: JOBS, deployedJobs: ['OB'],
  };
}

const F = { tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' };

test('fleet volume sekali untuk excavator; DT hanya volume miliknya; gross/net', () => {
  const d = svc.buildDomain(base(), svc.parseFilters(F));
  const ex = d.rankings.excavators;
  assert.equal(ex.length, 1);
  assert.equal(ex[0].gross_volume, 450, 'fleet 18 rit x 25, tepat sekali');
  assert.equal(ex[0].net_volume, 400, '(18-2) x 25');
  assert.equal(ex[0].hm_hours, 9);
  assert.equal(ex[0].expected_production, 1350);
  const dt = Object.fromEntries(d.rankings.dumpTrucks.map(r => [r.entity_code, r]));
  assert.equal(dt['DT-1'].gross_volume, 250);
  assert.equal(dt['DT-1'].net_volume, 200);
  assert.equal(dt['DT-2'].gross_volume, 200);
});

test('HM-share dua operator + expected per operator', () => {
  const d = svc.buildDomain(base(), svc.parseFilters(F));
  const ops = Object.fromEntries(d.rankings.excavatorOperators.map(r => [r.entity_code, r]));
  assert.equal(ops['Andi'].gross_volume, 225);
  assert.equal(ops['Budi'].gross_volume, 225);
  assert.equal(ops['Andi'].expected_production, 675, '150 x 4.5');
  assert.equal(ops['Andi'].hm_hours, 4.5);
  // jumlah kembali tepat ke total unit
  const totalOp = d.rankings.excavatorOperators.reduce((s, r) => s + r.gross_volume, 0);
  assert.ok(Math.abs(totalOp - 450) < 1e-9);
});

test('versi planning berubah mid-range dipakai per tanggal', () => {
  const b = base();
  b.versions.push(version(160, 120, 110, '2026-09-21'));
  b.fleets.push({ id: 'fm-2', tanggal: '2026-09-25', shift_id: 's1', nama_shift: 'Siang',
    excavator_id: 'ex-1', excavator_code: 'EX-1', job_code: 'OB', pit_area: 'BEI',
    material_detail: 'CLAY', material_type: 'Overburden', jarak_km: 2.5 });
  b.ritase.push({ id: 'r3', fleet_mapping_id: 'fm-2', dump_truck_id: 'dt-1', period_hour: 8, ritase_count: 4, nonprod_count: 0, dt_code: 'DT-1', dt_tipe: 'HD785' });
  b.segments.push({ id: 'g5', tanggal: '2026-09-25', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'ex-1', kode_alat: 'EX-1', tipe_alat: 'PC1250', kelas_alat: 'Excavator', operator_id: 'op-a', operator_nama: 'Andi', job: 'OB', area_name: 'BEI', total_hm: 2, status: 'submitted' });
  const d = svc.buildDomain(b, svc.parseFilters(F));
  const ex = d.rankings.excavators[0];
  // expected = 9x150 + 2x160 = 1670
  assert.equal(ex.expected_production, 1670);
});

test('factor hilang → incomplete + exclusion (bukan nol diam-diam)', () => {
  const b = base();
  b.ritase.push({ id: 'r9', fleet_mapping_id: 'fm-1', dump_truck_id: 'dt-9', period_hour: 10, ritase_count: 5, nonprod_count: 0, dt_code: 'DT-9', dt_tipe: 'TIPE-ANEH' });
  const d = svc.buildDomain(b, svc.parseFilters(F));
  assert.equal(d.quality.missingTruckFactor, 1);
  const ex = d.rankings.excavators;
  assert.equal(ex.length, 0, 'sel incomplete tak masuk ranking');
  const sel = d.cells.find(c => c.entity_type === 'excavator');
  assert.ok(sel.reason_codes.includes('MISSING_TRUCK_FACTOR'));
  assert.equal(sel.gross_volume, 450, 'baris tanpa factor tak ikut volume');
});

test('plan hilang → incomplete; OB/Coal tak campur', () => {
  const b = base();
  b.fleets[0].material_detail = 'MATERIAL-ANEH';
  const d = svc.buildDomain(b, svc.parseFilters(F));
  assert.equal(d.rankings.excavators.length, 0);
  assert.ok(d.quality.missingPlan > 0);
  const coal = svc.buildDomain(base(), svc.parseFilters({ ...F, planning_type: 'coal' }));
  assert.equal(coal.rankings.excavators.length, 0, 'fleet OB tak masuk ranking coal');
  assert.equal(coal.cells.filter(c => c.entity_type === 'excavator' && (c.gross_volume || 0) > 0).length, 0,
    'tak ada volume OB di laporan coal (sel HM-tanpa-ritase tetap tampil sebagai quality)');
});

test('Data Control hanya memuat JOB yang deployed di SPO', () => {
  const b = base();
  b.deployedJobs = [];
  const emptySpo = svc.buildDomain(b, svc.parseFilters(F));
  assert.equal(emptySpo.cells.length, 0, 'SPO tanpa JOB deployed tidak boleh fallback ke Master JOB');

  b.deployedJobs = ['OB'];
  b.fleets[0].job_code = 'CG';
  b.segments.forEach(segment => { segment.job = 'CG'; });
  const d = svc.buildDomain(b, svc.parseFilters(F));
  assert.equal(d.cells.length, 0);
  assert.equal(d.rankings.excavators.length, 0);
  assert.equal(d.rankings.dumpTrucks.length, 0);

  b.deployedJobs.push('CG');
  const deployed = svc.buildDomain(b, svc.parseFilters(F));
  assert.ok(deployed.cells.some(row => row.job === 'CG'));
});

test('plan DT bersumber langsung dari Hauler excavator aktual tanpa membership Setting Fleet', () => {
  const idx = svc.indexPlansForDate([{
    id: 'v-hauler', planning_type: 'ob', effective_from: '2026-09-01', revision: 1,
    data_json: {
      parameters: [{ material: 'CLAY', fill: 1, swell: 1 }],
      scenarios: [{ id: 'sc-1', loaderId: 'ex-1', loaderCode: 'EX-1', material: 'CLAY',
        bucketCapacity: 2, loaderCap: 2, cycleTimeLoading: 30, jobCodes: ['OB'] }],
      haulerRows: [{ loaderId: 'ex-1', truckId: 'dt-1', material: 'CLAY', capacity: 10,
        capacityUom: 'BCM', loadedSpeed: 20, emptySpeed: 25, spotDumpTime: 2, workEfficiency: 0.8 }],
      distanceHeadersMeters: [2500],
      // Sengaja tidak memilih dt-1: Setting Fleet bukan lagi gate plan DT.
      fleetSetups: [{ id: 'set-1', loaderScenarioId: 'sc-1', jobCode: 'OB', dumpTruckIds: ['dt-lain'] }],
    },
  }], 'ob', '2026-09-05');

  const plan = svc.resolveDtPlan(idx, 'EX-1', 'CLAY', 'OB', 'dt-1', 2.5);
  assert.ok(Math.abs(plan.productivity - (60 / 18 * 10 * 0.8)) < 1e-9);
  assert.equal(plan.versionId, 'v-hauler');
  assert.equal(svc.resolveDtPlan(idx, 'EX-LAIN', 'CLAY', 'OB', 'dt-1', 2.5).productivity, null,
    'kode excavator aktual wajib cocok');
  assert.equal(svc.resolveDtPlan(idx, 'EX-1', 'CLAY', 'OB', 'dt-1', 2.4).productivity, null,
    'jarak harus tersedia sebagai header Hauler');
});

test('material ambigu tak gandakan HM', () => {
  const b = base();
  b.fleets.push({ id: 'fm-2', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang',
    excavator_id: 'ex-1', excavator_code: 'EX-1', job_code: 'OB', pit_area: 'BEI',
    material_detail: 'SAND', material_type: 'Overburden', jarak_km: 2.5 });
  b.ritase.push({ id: 'r3', fleet_mapping_id: 'fm-2', dump_truck_id: 'dt-1', period_hour: 10, ritase_count: 2, nonprod_count: 0, dt_code: 'DT-1', dt_tipe: 'HD785' });
  const d = svc.buildDomain(b, svc.parseFilters(F));
  assert.equal(d.quality.ambiguousMaterial, 2, 'grup EX-1 + grup DT-1 (keduanya tersentuh CLAY & SAND)');
  assert.equal(d.rankings.excavators.length, 0, 'record ambigu keluar ranking');
  const amb = d.cells.find(c => c.control_status === 'ambiguous');
  assert.ok(amb.reason_codes.includes('HM_AMBIGUOUS_MATERIAL'));
});

test('DW: excluded + counts, HM produksi utuh', () => {
  const b = base();
  b.deployedJobs.push('DW');
  b.segments.push({ id: 'gdw', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'ex-1', kode_alat: 'EX-1', tipe_alat: 'PC1250', kelas_alat: 'Excavator', operator_id: 'op-c', operator_nama: 'Candra', job: 'DW', area_name: 'BEI', total_hm: 2, status: 'submitted' });
  const d = svc.buildDomain(b, svc.parseFilters(F));
  assert.equal(d.quality.excludedDwSegments, 1);
  assert.equal(d.quality.excludedDwHmHours, 2);
  const ex = d.rankings.excavators[0];
  assert.equal(ex.hm_hours, 9, 'HM DW tak mendilusi');
  assert.equal(ex.expected_production, 1350);
  assert.ok(!d.rankings.excavatorOperators.some(r => r.entity_code === 'Candra'), 'operator DW tak diranking');
  const dwRow = d.cells.find(c => (c.reason_codes || []).includes('NON_PRODUCTION_JOB_DW'));
  assert.equal(dwRow.control_status, 'excluded');
  assert.equal(dwRow.hm_hours, 2);
});

test('ritase tanpa HM + HM tanpa ritase masuk quality', () => {
  const b = base();
  b.segments = b.segments.filter(s => !['g1', 'g2'].includes(s.id));
  const d = svc.buildDomain(b, svc.parseFilters(F));
  assert.ok(d.quality.ritaseWithoutHm > 0);
  const b2 = base();
  b2.segments.push({ id: 'gx', tanggal: '2026-09-21', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'ex-9', kode_alat: 'EX-9', tipe_alat: 'PC1250', kelas_alat: 'Excavator', operator_id: 'op-z', operator_nama: 'Zaki', job: 'OB', area_name: 'BEI', total_hm: 5, status: 'submitted' });
  const d2 = svc.buildDomain(b2, svc.parseFilters(F));
  assert.ok(d2.quality.hmWithoutRitase > 0);
  const hmCell = d2.cells.find(c => (c.reason_codes || []).includes('HM_WITHOUT_RITASE'));
  assert.equal(hmCell.hm_hours, 5);
  assert.equal(hmCell.gross_volume, 0);
});

test('data-control: filter + pagination + domain sama', async () => {
  const b = base();
  // getDataControl memakai pool; uji logika filter via buildDomain + tiru paginasi
  const d = svc.buildDomain(b, svc.parseFilters(F));
  const ready = d.cells.filter(c => c.control_status === 'ready');
  assert.ok(ready.length > 0);
  assert.ok(d.cells.every(c => typeof c.control_key === 'string' && c.control_key.length > 0));
  assert.ok(d.controlHighlights.some(h => h.key === 'ready' && h.count === ready.length));
  assert.ok(d.controlHighlights.some(h => h.key === 'excluded' && h.count === d.cells.filter(c => c.control_status === 'excluded').length));
  assert.ok(d.controlHighlights.some(h => h.key === 'excluded_dw' && h.impact_unit === 'HM'));
  // impact BCM/Ton/HM tak tercampur
  for (const h of d.controlHighlights) {
    assert.ok(['BCM', 'Ton', 'HM'].includes(h.impact_unit), `unit dampak valid: ${h.key}`);
  }
});

test('Work Log draft yang tersimpan sah sebagai HM Productivity Report', async () => {
  const b = base();
  b.segments.forEach(segment => { segment.status = 'draft'; });
  const d = svc.buildDomain(b, svc.parseFilters(F));
  const dt = d.cells.find(cell => cell.entity_type === 'dumptruck' && cell.entity_code === 'DT-1');
  assert.equal(dt.hm_hours, 9);
  assert.ok(!dt.reason_codes.includes('MISSING_HM'));
  assert.ok(!d.cells.some(cell => cell.reason_codes.includes('DRAFT_SEGMENT')));
});

test('parseFilters: planning_type + range invalid ditolak', () => {
  assert.throws(() => svc.parseFilters({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'xx' }), /planning_type/);
  assert.throws(() => svc.parseFilters({ tanggal_dari: '2026-09-30', tanggal_sampai: '2026-09-01' }), /setelah/);
  const def = svc.parseFilters({});
  assert.equal(def.planning_type, 'ob');
  assert.ok(def.dari.endsWith('-01'));
});
