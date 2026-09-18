const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../src/services/productionData');
const { calculateWeightedFleetDistance } = require('../src/controllers/production.controller');

function fixture() {
  return { period: domain.period(2026, 9), jobs: [{ jobCode: 'OB' }, { jobCode: 'CG' }], areas: ['BEI', 'DKC'],
    shifts: [{ id: 'day', nama_shift: 'Siang' }, { id: 'night', nama_shift: 'Malam' }],
    catalog: [{ equipmentId: 'ex1', loaderCode: 'EX1', jobCode: 'CG', material: 'SEAM 1', planningType: 'coal', density: 1.5, planRef: 'coal:1' }],
    fleets: [{ id: 'f1', tanggal: '2026-09-01', shift_id: 'day', excavator_id: 'ex1', excavator_kode: 'EX1', pit_area: 'BEI', job_code: 'CG', material_detail: 'SEAM 1', material_type: 'Coal', jarak_km: 2 }],
    hours: [{ fleet_mapping_id: 'f1', dump_truck_id: 'dt1', period_hour: 8, ritase_count: 10, factor_value: 15 }],
    distances: [], rain: [], fuel: [{ id: 'fuel1', tanggal: '2026-09-01', shift_id: 'day', equipment_id: 'ex1', fuel_filled: 50 }],
    workLogs: [{ tanggal: '2026-09-01', shift_id: 'day', equipment_id: 'ex1', area_name: 'BEI', job: 'CG' }], manual: [], snapshots: [] };
}
const report = data => domain.buildReport(data, calculateWeightedFleetDistance);
const first = r => r.tables.find(t => t.area === 'BEI').rows[0].values.CG;

test('coal: 150 ton / density 1.5 = 100 BCM; 50 L / 100 = 0.5 L/BCM', () => {
  const result = report(fixture()); const cell = first(result);
  assert.equal(cell.production, 150); assert.equal(cell.bcm, 100); assert.equal(cell.fuelRatio, 0.5);
  assert.equal(cell.distanceKm, 2); assert.equal(result.queue.length, 0);
  assert.equal(result.tables[0].rows.length, 60); assert.equal(result.tables.length, 2);
});
test('density dikunci tidak berubah ketika planning diperbarui', () => {
  const data = fixture(); data.catalog[0].density = 2;
  data.snapshots.push({ fleet_mapping_id: 'f1', identity_key: domain.identity(data.fleets[0]), density: 1.5, plan_ref: 'coal:1' });
  assert.equal(first(report(data)).fuelRatio, 0.5);
});
test('density kosong/ambigu tidak boleh diganti 1 dan tidak menghasilkan rasio', () => {
  for (const mutate of [d => { d.catalog[0].density = null; }, d => { d.catalog.push({ ...d.catalog[0] }); }]) {
    const d = fixture(); mutate(d); const c = first(report(d));
    assert.equal(c.production, 150); assert.equal(c.bcm, null); assert.equal(c.fuelRatio, null);
  }
});
test('truck factor kosong membedakan incomplete dari nol produksi', () => {
  const d = fixture(); d.hours[0].factor_value = null;
  assert.equal(first(report(d)).production, null); assert.equal(first(report(d)).fuelRatio, null);
  d.hours[0].ritase_count = 0; assert.equal(first(report(d)).production, 0);
});
test('fuel tidak cocok tanggal/shift/unit atau job masuk antrean', () => {
  for (const field of ['tanggal','shift_id','equipment_id','job','area_name']) {
    const d = fixture(); d.workLogs[0][field] = 'other'; const r = report(d);
    assert.equal(r.queue.length, 1, field); assert.equal(r.fuelSummary.pending, 50); assert.equal(first(r).fuel, null);
  }
});
test('duplikat work log tujuan sama tidak menggandakan fuel; tujuan berbeda antre', () => {
  const d = fixture(); d.workLogs.push({ ...d.workLogs[0] });
  assert.equal(first(report(d)).fuel, 50);
  d.workLogs[1].area_name = 'DKC'; assert.equal(report(d).queue.length, 1);
});
test('P1 memberi rekomendasi yang dapat dijelaskan untuk Input Data ambigu dan alokasi sebelumnya', () => {
  const d = fixture(); d.areas.push('DKC'); d.workLogs.push({ ...d.workLogs[0], area_name: 'DKC' });
  let queued = report(d).queue[0];
  assert.equal(queued.reasonCode, 'ambiguous_input'); assert.equal(queued.suggestionSource, 'Input Data'); assert.equal(queued.suggestions.length, 2);
  d.workLogs = []; d.allocationHistory = [{ equipment_id: 'ex1', tanggal: '2026-08-31', updated_at: '2026-08-31T10:00:00Z',
    allocations: [{ area: 'BEI', jobCode: 'CG', liters: 40 }] }];
  queued = report(d).queue[0];
  assert.deepEqual(queued.suggestions, [{ area: 'BEI', jobCode: 'CG' }]); assert.equal(queued.suggestionSource, 'Alokasi sebelumnya');
});
test('P2 aturan efektif mengisi fallback tanpa mengambil alih Input Data unik atau histori manual', () => {
  const d = fixture(); d.workLogs = []; d.rules = [{ id: 'rule1', equipment_id: 'ex1', kode_alat: 'EX1', area_name: 'DKC', job_code: 'OB',
    effective_from: '2026-09-01', is_active: true, created_at: '2026-09-01T00:00:00Z' }];
  let result = report(d); assert.equal(result.queue.length, 0); assert.equal(result.allocated[0].mode, 'rule');
  assert.equal(result.tables.find(t => t.area === 'DKC').rows[0].values.OB.fuel, 50);
  d.workLogs = [{ tanggal: '2026-09-01', shift_id: 'day', equipment_id: 'ex1', area_name: 'BEI', job: 'CG' }];
  result = report(d); assert.equal(result.allocated[0].mode, 'automatic'); assert.equal(first(result).fuel, 50);
  d.manual = [{ fuel_log_id: 'fuel1', source_fingerprint: domain.fingerprint(d.fuel[0]), revision: 1,
    allocations: [{ area: 'BEI', jobCode: 'CG', liters: 50 }] }];
  result = report(d); assert.equal(result.allocated[0].mode, 'manual');
});
test('P3 kualitas fuel merekonsiliasi total dan merangking unit antrean', () => {
  const d = fixture(); d.workLogs = []; d.fuel[0].kode_alat = 'EX1';
  const result = report(d); assert.equal(result.fuelQuality.allocationPercent, 0); assert.equal(result.fuelQuality.reconciled, true);
  assert.equal(result.fuelQuality.reconciliationDifference, 0); assert.equal(result.fuelQuality.reasonCounts.no_input, 1);
  assert.equal(result.fuelQuality.topUnmappedUnits[0].unit, 'EX1');
  assert.equal(result.fuelQuality.topUnmappedUnits[0].liters, 50);
});
test('alokasi manual dibagi, liter utuh dan fingerprint sumber harus tetap sama', () => {
  const d = fixture(); d.workLogs = [];
  d.manual.push({ fuel_log_id: 'fuel1', source_fingerprint: domain.fingerprint(d.fuel[0]), revision: 1,
    allocations: [{ area: 'BEI', jobCode: 'CG', liters: 30 }, { area: 'DKC', jobCode: 'OB', liters: 20 }] });
  assert.equal(first(report(d)).fuel, 30); assert.equal(report(d).fuelSummary.allocated, 50);
  d.fuel[0].fuel_filled = 60;
  assert.equal(report(d).queue.length, 1); assert.equal(report(d).fuelSummary.pending, 60);
});
test('validasi alokasi menolak kurang/lebih, tujuan asing, duplikat, dan negatif', () => {
  const jobs = [{ jobCode: 'CG' }]; const areas = ['BEI'];
  const good = { area: 'BEI', jobCode: 'CG', liters: 50 };
  assert.deepEqual(domain.validateAllocation([good], 50, jobs, areas), [good]);
  for (const items of [[{ ...good, liters: 49 }], [{ ...good, liters: -50 }], [{ ...good, area: 'foreign' }], [{ ...good, jobCode: 'foreign' }], [good, good]])
    assert.throws(() => domain.validateAllocation(items, 50, jobs, areas));
});
test('JOB FOT dan material baru muncul dinamis; historis tetap tersedia', () => {
  const d = fixture(); d.jobs.push({ jobCode: 'FOT' });
  d.catalog.push({ ...d.catalog[0], jobCode: 'FOT', material: 'NEW' });
  d.jobs = d.jobs.filter(j => j.jobCode !== 'CG');
  const r = report(d); assert.equal(r.jobs.find(j => j.jobCode === 'FOT').materials[0].name, 'NEW');
  assert.ok(r.jobs.find(j => j.jobCode === 'CG'));
});
test('rekap rasio bulanan menggunakan total L / total BCM, bukan rata-rata rasio', () => {
  const d = fixture();
  d.fleets.push({ ...d.fleets[0], id: 'f2', tanggal: '2026-09-02' });
  d.hours.push({ ...d.hours[0], fleet_mapping_id: 'f2', ritase_count: 30 });
  d.fuel.push({ ...d.fuel[0], id: 'fuel2', tanggal: '2026-09-02', fuel_filled: 30 });
  d.workLogs.push({ ...d.workLogs[0], tanggal: '2026-09-02' });
  assert.equal(report(d).tables.find(t => t.area === 'BEI').totals.CG.fuelRatio, 80 / 400);
});
test('jarak final memasukkan dumping berbeda dan rekap bobot BCM', () => {
  const d = fixture(); d.distances.push({ fleet_mapping_id: 'f1', dump_truck_id: 'dt1', period_hour: 8, ritase_count: 2, distance_km: 0.2 });
  assert.equal(first(report(d)).distanceKm, (8 * 15 * 2 + 2 * 15 * 0.2) / 150);
});
test('hujan lintas tengah malam dan overlap dihitung sekali per JOB/shift', () => {
  const rows = [{ rain_start: '23:00', rain_finish: '01:00', operational_start: '18:00' }, { rain_start: '00:30', rain_finish: '02:00', operational_start: '18:00' }];
  assert.equal(domain.unionMinutes(rows, 'rain_start', 'rain_finish'), 180);
  assert.equal(domain.unionMinutes([], 'rain_start', 'rain_finish'), null);
});
test('periode leap year, pergantian tahun dan input tidak valid', () => {
  assert.equal(domain.period(2028, 2).days, 29); assert.equal(domain.period(2026, 12).end, '2027-01-01');
  assert.throws(() => domain.period(2026, 13)); assert.throws(() => domain.period('x', 1));
});

test('material case berbeda memakai header kanonis dan tidak kehilangan produksi', () => {
  const d = fixture(); d.fleets[0].material_detail = 'seam 1';
  assert.equal(first(report(d)).materials['SEAM 1'], 150);
});
test('material/JOB dengan ton dan BCM campuran tidak dijumlahkan sebagai satu unit', () => {
  const d = fixture(); d.catalog.push({ ...d.catalog[0], planningType: 'ob' });
  const r = report(d); assert.equal(r.jobs.find(j => j.jobCode === 'CG').unit, 'mixed');
  assert.equal(first(r).materials['SEAM 1'], null);
  assert.equal(first(r).bcm, 100);
});

module.exports.fixture = fixture;
