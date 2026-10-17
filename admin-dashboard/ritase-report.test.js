'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  elapsedSlotsBeforeCutoff,
  plannedNonProductiveReason,
  buildScopes,
  buildReportModel,
  buildAreaReportModel,
  chartSeriesFor,
  hourlyPerformanceTone,
  reportMarkup
} = require('./ritaseReport.js');

const dashboardHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const loaderSource = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');

function fleet(overrides = {}) {
  return {
    id: 'fleet-1',
    tanggal: '2026-09-07',
    shift_id: 'shift-day',
    nama_shift: 'Shift Siang',
    operational_start: '06:00:00',
    operational_end: '18:00:00',
    lintas_hari: false,
    excavator_kode: 'EX30 350-15',
    pit_area: 'BEI',
    job_code: 'OB',
    job_desc: 'Overburden Removal',
    material_type: 'Overburden',
    material_detail: 'CLAY',
    plan_status: 'synced',
    plan_productivity: 100,
    plan_productivity_unit: 'BCM/Hr',
    trucks: [{
      dump_truck_id: 'dt-1',
      kode_alat: 'DT30 126',
      tipe_alat: 'SANY 430',
      hours: { 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 2, 13: 2, 14: 99 }
    }],
    productivity_exceptions: [],
    ...overrides
  };
}

test('cutoff 14:00 only includes completed slots 06:00 through 13:00', () => {
  assert.deepEqual(elapsedSlotsBeforeCutoff(fleet(), 14), [6, 7, 8, 9, 10, 11, 12, 13]);
});

test('report target excludes planned downtime while actual keeps all saved slots before cutoff', () => {
  const item = fleet();
  const snapshot = {
    tanggal: '2026-09-07',
    fleets: [item],
    truckFactors: { 'OB|SANY 430|CLAY': 10 }
  };
  const scope = buildScopes(snapshot.fleets)[0];
  const model = buildReportModel(snapshot, scope.key, 14);
  assert.equal(model.elapsedHours, 8);
  assert.equal(model.productiveHours, 6);
  assert.equal(model.target, 600);
  assert.equal(model.actual, 160);
  assert.equal(model.ritase, 16);
  assert.equal(model.reportedHour, 13);
  assert.equal(model.reportedHourLabel, '13:00-13:59');
  assert.equal(model.fleets[0].truckTotals[0].ritase, 2);
  assert.equal(model.hourlyTotals.some(item => item.hour === 14), false);
});

test('Shift Siang excludes Change Shift 06:00 and break 12:00 from running target', () => {
  assert.equal(plannedNonProductiveReason(fleet(), 6)?.label, 'CHANGE SHIFT');
  assert.equal(plannedNonProductiveReason(fleet(), 12)?.label, 'ISTIRAHAT');
  assert.equal(plannedNonProductiveReason(fleet(), 7), null);
});

test('Shift Malam excludes Change Shift 18:00 and break 00:00 from running target', () => {
  const nightFleet = fleet({
    operational_start: '18:00:00',
    operational_end: '06:00:00',
    lintas_hari: true,
    change_shift_start: '18:00:00',
    change_shift_end: '19:00:00',
    break_start: '00:00:00',
    break_end: '01:00:00'
  });
  assert.equal(plannedNonProductiveReason(nightFleet, 18)?.label, 'CHANGE SHIFT');
  assert.equal(plannedNonProductiveReason(nightFleet, 0)?.label, 'ISTIRAHAT');
  assert.equal(plannedNonProductiveReason(nightFleet, 19), null);
});

test('planned downtime does not require a manually saved zero ritase', () => {
  const item = fleet({ trucks: [{
    dump_truck_id: 'dt-1', kode_alat: 'DT30 126', tipe_alat: 'SANY 430', hours: { 7: 2 }
  }] });
  const snapshot = { tanggal: '2026-09-07', fleets: [item], truckFactors: { 'OB|SANY 430|CLAY': 10 } };
  const scope = buildScopes(snapshot.fleets)[0];
  const model = buildReportModel(snapshot, scope.key, 8);

  assert.equal(model.productiveHours, 1);
  assert.equal(model.target, 100);
  assert.equal(model.actual, 20);
  assert.equal(model.fleets[0].hourly.find(hour => hour.hour === 6).nonProductiveReason, 'CHANGE SHIFT');
});

test('running target matches the approved Shift Siang cutoff simulation', () => {
  const hours = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [index + 6, 0]));
  const item = fleet({ trucks: [{ dump_truck_id: 'dt-1', kode_alat: 'DT30 126', tipe_alat: 'SANY 430', hours }] });
  const snapshot = { tanggal: '2026-09-07', fleets: [item], truckFactors: { 'OB|SANY 430|CLAY': 10 } };
  const scope = buildScopes(snapshot.fleets)[0];

  assert.deepEqual([11, 13, 14, 17].map(cutoff => {
    const model = buildReportModel(snapshot, scope.key, cutoff);
    return [model.productiveHours, model.target];
  }), [[4, 400], [5, 500], [6, 600], [9, 900]]);
});

test('report scopes keep BCM and Ton production separate', () => {
  const scopes = buildScopes([
    fleet(),
    fleet({ id: 'fleet-2', material_type: 'Coal', plan_productivity_unit: 'Ton/Hr' })
  ]);
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.map(scope => scope.unit).sort(), ['BCM', 'Ton']);
});

test('one area JPEG includes OB and CG as separate unit-safe sections with the old problem panels', () => {
  const ob = fleet({ tanggal: '2026-09-16' });
  const coal = fleet({
    id: 'fleet-coal', tanggal: '2026-09-16', excavator_kode: 'EX-COAL',
    job_code: 'CG', job_desc: 'Coal Getting', material_type: 'Coal',
    material_detail: 'Coal', plan_productivity: 80, plan_productivity_unit: 'Ton/Hr',
    trucks: [{ dump_truck_id: 'dt-coal', kode_alat: 'DT-COAL', tipe_alat: 'SANY 430', hours: { 7: 3 } }],
    productivity_exceptions: [{ period_hour: 7, problems: [{ problem: 'Jalan licin', impact_minutes: 20 }] }]
  });
  const snapshot = {
    tanggal: '2026-09-16', fleets: [ob, coal],
    truckFactors: { 'OB|SANY 430|CLAY': 10, 'Coal|SANY 430|COAL': 12 }
  };
  const combined = buildAreaReportModel(snapshot, 'BEI', 8);
  const html = reportMarkup(combined);
  assert.equal(combined.sections.length, 2);
  assert.deepEqual(combined.sections.map(section => section.scope.unit), ['BCM', 'Ton']);
  assert.deepEqual(combined.sections.map(section => section.actual), [40, 36]);
  assert.equal((html.match(/Top Productivity Problems/g) || []).length, 2);
  assert.equal((html.match(/Hourly Fleet Performance \(/g) || []).length, 2);
  assert.equal((html.match(/data-ritase-report-chart/g) || []).length, 2);
  assert.match(html, /Jalan licin/);
  assert.match(html, /OB \+ CG/);
  assert.match(html, /09:00/);
  assert.match(html, /17:00/);
  assert.match(html, /rr-hour-pending/);
  assert.doesNotMatch(html, /TOTAL PRODUCTION \(BCM \/ Ton\)/);
});

test('chart axes keep all shift hours at early cutoff and leave future production blank', () => {
  const item = fleet({ tanggal: '2026-09-16', trucks: [{
    dump_truck_id: 'dt-1', kode_alat: 'DT30 126', tipe_alat: 'SANY 430', hours: { 7: 2 }
  }] });
  const snapshot = { tanggal: '2026-09-16', fleets: [item], truckFactors: { 'OB|SANY 430|CLAY': 10 } };
  const section = buildReportModel(snapshot, buildScopes(snapshot.fleets)[0].key, 8);
  const series = chartSeriesFor(section);
  assert.equal(series.labels.length, 12);
  assert.deepEqual(series.labels.slice(0, 3), ['06:00', '07:00', '08:00']);
  assert.equal(series.actual[0], 0);
  assert.equal(series.actual[1], 20);
  assert.equal(series.actual[2], null);
  assert.equal(series.target[2], null);
});

test('missing Coal Truck Factor is rejected instead of counted as zero', () => {
  const item = fleet({ job_code: 'CG', material_type: 'Coal', material_detail: 'Coal', plan_productivity_unit: 'Ton/Hr' });
  const snapshot = { tanggal: item.tanggal, fleets: [item], truckFactors: { 'Coal|SANY 430|COAL': null } };
  assert.throws(() => buildAreaReportModel(snapshot, 'BEI', 8), /Truck Factor belum lengkap/);
});

test('report refuses missing Truck Factor instead of treating production as zero', () => {
  const item = fleet();
  const snapshot = { tanggal: '2026-09-07', fleets: [item], truckFactors: {} };
  const scope = buildScopes(snapshot.fleets)[0];
  assert.throws(() => buildReportModel(snapshot, scope.key, 14), /Truck Factor belum lengkap/);
});

test('hourly production conditional formatting uses the approved 100% and 80% thresholds', () => {
  assert.equal(hourlyPerformanceTone(150.73, 150.73), 'achieved');
  assert.equal(hourlyPerformanceTone(150.72, 150.73), 'near');
  assert.equal(hourlyPerformanceTone(120.584, 150.73), 'near');
  assert.equal(hourlyPerformanceTone(120.583, 150.73), 'below');
  assert.equal(hourlyPerformanceTone(null, 150.73), 'neutral');
});

test('JPEG report renders bold conditional cells and keeps hourly dump-truck grouping per fleet', () => {
  const item = fleet();
  const snapshot = { tanggal: '2026-09-07', fleets: [item], truckFactors: { 'OB|SANY 430|CLAY': 10 } };
  const scope = buildScopes(snapshot.fleets)[0];
  const model = buildReportModel(snapshot, scope.key, 14);
  const html = reportMarkup(model);

  assert.match(html, /rr-hour-below/);
  assert.match(html, /rr-hour-cell[^>]*><strong>/);
  assert.match(html, /Tercapai &ge;100%/);
  assert.match(html, /RITASE PER UNIT DUMP TRUCK/);
  assert.match(html, /CHANGE SHIFT/);
  assert.match(html, /ISTIRAHAT/);
  assert.match(html, /6 jam produktif/);
  assert.match(html, /13:00-13:59/);
  assert.match(html, /DT30 126/);
  assert.match(html, />2 rit</);
});

test('Input Ritase exposes the red 3D Lapor action and loads its report module', () => {
  assert.match(dashboardHtml, /class="tombol ritase-report-button" onclick="bukaLaporanRitase\(\)"/);
  assert.match(loaderSource, /'ritaseReport\.js\?v=8'/);
  assert.match(loaderSource, /html2canvas\.min\.js/);
});
