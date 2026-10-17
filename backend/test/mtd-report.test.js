'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Mtd = require('../src/services/mtdReport');

function fixture() {
  const filters = Mtd.parseFilters({ year: 2026, month: 9, cutoff: '2026-09-10' });
  return { filters, productionReport: {
    areas: ['BEI'], shifts: [{ id: 's1', nama_shift: 'Siang' }], queue: [],
    jobs: [
      { jobCode: 'OB', materials: [{ name: 'CLAY', unit: 'BCM' }] },
      { jobCode: 'CG', materials: [{ name: 'SEAM 3', unit: 'Ton' }] },
    ],
    tables: [{ area: 'BEI', rows: [{ date: '2026-09-05', shiftId: 's1', values: {
      OB: { production: 200, bcm: 200, fuel: 40, sources: [{ unit: 'EX-1', production: 200, material: 'CLAY' }] },
      CG: { production: 150, bcm: 100, fuel: 60, sources: [{ unit: 'EX-2', production: 150, density: 1.5, material: 'SEAM 3' }] },
    } }] }],
  }, planRows: [], targetRow: { target_ob_bcm: 3000, target_coal_mt: 1500 },
  workRows: [
    { tanggal: '2026-09-05', shift_id: 's1', equipment_id: 'ex1', kode_alat: 'EX-1', area_name: 'BEI', job: 'OB', total_hm: 4 },
    { tanggal: '2026-09-05', shift_id: 's1', equipment_id: 'ex2', kode_alat: 'EX-2', area_name: 'BEI', job: 'CG', total_hm: 3 },
  ], breakdownRows: [{ tanggal: '2026-09-05', equipment_id: 'ex1', total_breakdown_hours: 1 }],
  standbyRows: [{ tanggal: '2026-09-05', equipment_id: 'ex1', total_standby_hours: 1 }], nonprodRows: [], };
}

test('MTD menjaga OB BCM dan Coal Ton terpisah serta FR Coal memakai BCM density', () => {
  const report = Mtd.buildReport(fixture());
  assert.equal(report.summary.ob.actual, 200);
  assert.equal(report.summary.coal.actual, 150);
  assert.equal(report.summary.fuel.ratioOb, 40 / 200);
  assert.equal(report.summary.fuel.ratioCoal, 60 / 100);
  assert.equal(report.summary.fuel.ratioAll, 100 / 300);
});

test('target bulanan menjadi fallback plan linear dan forecast tidak mengarang committed plan', () => {
  const report = Mtd.buildReport(fixture());
  assert.equal(report.summary.ob.targetSource, 'monthly_target');
  assert.equal(report.daily[0].obPlan, 100);
  assert.equal(report.summary.ob.committedForecast, null);
  assert.equal(report.summary.ob.runRateForecast, 600);
});

test('material filter tidak mengatribusikan fuel dan HM secara spekulatif', () => {
  const input = fixture();
  input.filters = Mtd.parseFilters({ year: 2026, month: 9, cutoff: '2026-09-10', material: 'CLAY' });
  const report = Mtd.buildReport(input);
  assert.equal(report.summary.fuel.liters, null);
  assert.equal(report.summary.operation.productiveHm, null);
  assert.equal(report.summary.operation.pa, null);
  assert.equal(report.summary.ob.target, null, 'target proyek tidak boleh diwariskan ke filter material');
});

test('fleet deployment published mengalahkan fallback target bulanan', () => {
  const input = fixture();
  input.planRows = [{ operational_date: '2026-09-05', pit_area_snapshot: 'BEI', job_code_snapshot: 'OB', material_snapshot: 'CLAY',
    planning_type: 'ob', planned_production: 180, planned_ewh: 2, plan_productivity: 90, loader_code_snapshot: 'EX-1', completeness: 'complete' }];
  const report = Mtd.buildReport(input);
  assert.equal(report.summary.ob.targetSource, 'fleet_deployment');
  assert.equal(report.summary.ob.target, 180);
  assert.equal(report.summary.ob.committedForecast, 200);
});

test('quality manual hanya menghitung sel manual yang belum lengkap', () => {
  const input = fixture();
  input.productionReport.tables[0].rows[0].values.OB.notes = ['Produksi manual'];
  input.productionReport.tables[0].rows[0].values.CG.notes = ['Produksi manual belum lengkap'];
  const report = Mtd.buildReport(input);
  assert.equal(report.quality.find(item => item.code === 'MANUAL_SOURCE_INCOMPLETE')?.count, 1);
});
