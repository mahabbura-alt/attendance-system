'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildReportModel,
  reportMarkup,
  generateBreakdownJpeg
} = require('./breakdownReport.js');

const dashboardHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const loaderSource = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');
const productionSource = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');

test('UI Breakdown memakai release Ready langsung tanpa workflow verifikasi lama', () => {
  assert.match(productionSource, /Release Unit Ready/);
  assert.doesNotMatch(productionSource, /bukaModalReadyVerification|ready-verification|STB-SYS-01/);
  assert.doesNotMatch(dashboardHtml, /awaiting_verification/);
  assert.match(dashboardHtml, /Unit Ready \/ Riwayat Release/);
  assert.doesNotMatch(dashboardHtml, /Selesai Perbaikan &amp; Verifikasi|Selesai Perbaikan & Verifikasi/);
});

function sampleEquipment() {
  return [
    { id: 'eq-1', kode_alat: 'EXC-01', kelas_alat: 'Excavator', tipe_alat: 'Komatsu PC400' },
    { id: 'eq-2', kode_alat: 'DT-03', kelas_alat: 'Dump Truck', tipe_alat: 'CAT 773E' },
    { id: 'eq-3', kode_alat: 'GD-01', kelas_alat: 'Motor Grader', tipe_alat: 'CAT 140M' },
    { id: 'eq-4', kode_alat: 'EXC-02', kelas_alat: 'Excavator', tipe_alat: 'Komatsu PC400' },
    { id: 'eq-5', kode_alat: 'DT-01', kelas_alat: 'Dump Truck', tipe_alat: 'SANY 430' }
  ];
}

function sampleLogs() {
  return [
    {
      id: 'bd-1',
      equipment_id: 'eq-2',
      kode_alat: 'DT-03',
      current_status: 'waiting_part',
      kode_breakdown: 'BD-07',
      kategori_breakdown: 'Engine Overheating',
      start_time: '2026-09-08T06:00:00.000Z',
      elapsed_breakdown_hours: 28.5,
      pic_name: 'Budi Santoso',
      description: 'Radiator bocor',
      parts: [
        { part_detail: 'Filter Radiator', po_number: 'PO-2609-001' }
      ]
    },
    {
      id: 'bd-2',
      equipment_id: 'eq-1',
      kode_alat: 'EXC-01',
      current_status: 'mechanic_progress',
      kode_breakdown: 'BD-12',
      kategori_breakdown: 'Hydraulic System',
      start_time: '2026-09-08T14:00:00.000Z',
      elapsed_breakdown_hours: 14.0,
      pic_name: 'Ahmad Fauzi',
      description: 'Hose boom pecah',
      parts: []
    },
    {
      id: 'bd-3',
      equipment_id: 'eq-4',
      kode_alat: 'EXC-02',
      current_status: 'resolved',
      kode_breakdown: 'BD-03',
      kategori_breakdown: 'Electrical',
      start_time: '2026-09-07T08:00:00.000Z',
      finish_time: '2026-09-07T12:00:00.000Z',
      elapsed_breakdown_hours: 4.0,
      pic_name: 'Eko Prasetyo',
      parts: []
    },
    {
      id: 'bd-4',
      equipment_id: 'eq-5',
      kode_alat: 'DT-01',
      current_status: 'resolved',
      kode_breakdown: 'BD-09',
      kategori_breakdown: 'Tire / Undercarriage',
      start_time: '2026-09-06T10:00:00.000Z',
      finish_time: '2026-09-06T18:30:00.000Z',
      elapsed_breakdown_hours: 8.5,
      pic_name: 'Budi Santoso',
      parts: []
    }
  ];
}

const sampleMetrics = {
  totalBdHours: 55.0,
  openBreakdowns: 2,
  affectedUnits: 4,
  mttrHours: 6.25,
  mtbfHours: 124.3,
  calendarPa: 87.4
};

test('buildReportModel correctly splits active vs resolved units and sorts active by downtime descending', () => {
  const model = buildReportModel(sampleLogs(), sampleEquipment(), sampleMetrics, 2026, 9);
  assert.equal(model.activeLogs.length, 2);
  assert.equal(model.resolvedLogs.length, 2);
  assert.equal(model.activeLogs[0].kode_alat, 'DT-03');
  assert.equal(model.activeLogs[1].kode_alat, 'EXC-01');
  assert.equal(model.metrics.totalIncidents, 4);
  assert.equal(model.metrics.openCount, 2);
});

test('Periodic Service remains downtime but is excluded from failure Pareto and incident count', () => {
  const ps = {
    id: 'ps-1', equipment_id: 'eq-1', kode_alat: 'EXC-01', current_status: 'resolved',
    kode_breakdown: 'PS', kategori_breakdown: 'Periodic Service', is_planned_maintenance: true,
    counts_as_function_failure: false, start_time: '2026-09-09T01:00:00.000Z',
    finish_time: '2026-09-09T03:00:00.000Z', elapsed_breakdown_hours: 2
  };
  const model = buildReportModel([...sampleLogs(), ps], sampleEquipment(), { ...sampleMetrics, functionalFailures: 4 }, 2026, 9);
  assert.equal(model.metrics.totalIncidents, 4);
  assert.equal(model.paretoCategories.some(item => item.name === 'Periodic Service'), false);
  assert.equal(model.resolvedLogs.some(log => log.kode_breakdown === 'PS'), true);
});

function sampleUnitStatus() {
  return {
    groups: [
      { equipmentType: 'Excavator', ready: 1, breakdown: 1, units: [
        { unitCode: 'EXC-01', equipmentClass: 'Komatsu PC400', status: 'Ready' },
        { unitCode: 'EXC-02', equipmentClass: 'Komatsu PC400', status: 'BD' }
      ] },
      { equipmentType: 'Dump Truck', ready: 2, breakdown: 0, units: [
        { unitCode: 'DT-03', equipmentClass: 'CAT 773E', status: 'Ready' },
        { unitCode: 'DT-01', equipmentClass: 'SANY 430', status: 'Ready' }
      ] },
      { equipmentType: 'Motor Grader', ready: 0, breakdown: 1, units: [
        { unitCode: 'GD-01', equipmentClass: 'CAT 140M', status: 'BD' }
      ] }
    ]
  };
}

test('buildReportModel groups Update Status Unit by type then class with Ready/BD counts', () => {
  const model = buildReportModel(sampleLogs(), sampleEquipment(), sampleMetrics, 2026, 9, sampleUnitStatus());
  assert.equal(model.statusGroups.length, 3);
  const excavator = model.statusGroups.find(group => group.equipmentType === 'Excavator');
  assert.equal(excavator.total, 2);
  assert.equal(excavator.ready, 1);
  assert.equal(excavator.breakdown, 1);
  assert.deepEqual(excavator.classes, [{ className: 'Komatsu PC400', ready: 1, bd: 1 }]);
  const dumpTruck = model.statusGroups.find(group => group.equipmentType === 'Dump Truck');
  assert.equal(dumpTruck.classes.length, 2);
  assert.equal(model.statusTotal, 5);
});

test('buildReportModel falls back to equipment + active logs without unit status', () => {
  const model = buildReportModel(sampleLogs(), sampleEquipment(), sampleMetrics, 2026, 9, null);
  const dumpTruck = model.statusGroups.find(group => group.equipmentType === 'Dump Truck');
  assert.ok(dumpTruck, 'tipe dari equipment tetap terbentuk');
  const bdClass = dumpTruck.classes.find(row => row.className === 'CAT 773E');
  assert.equal(bdClass.bd, 1, 'unit dengan log aktif = BD');
  assert.equal(bdClass.ready, 0);
});

test('buildReportModel calculates Pareto top 5 by event count for the selected month', () => {
  const logs = [
    { id: 'long-1', tanggal: '2026-09-02', start_time: '2026-09-02T00:00:00Z', kategori_breakdown: 'Engine', elapsed_breakdown_hours: 100 },
    { id: 'many-1', tanggal: '2026-09-03', start_time: '2026-09-03T00:00:00Z', kategori_breakdown: 'Electrical', elapsed_breakdown_hours: 1 },
    { id: 'many-2', tanggal: '2026-09-04', start_time: '2026-09-04T00:00:00Z', kategori_breakdown: 'Electrical', elapsed_breakdown_hours: 1 },
    { id: 'carry-over', tanggal: '2026-08-31', start_time: '2026-08-31T00:00:00Z', kategori_breakdown: 'Carry Over', elapsed_breakdown_hours: 200 }
  ];
  const model = buildReportModel(logs, sampleEquipment(), sampleMetrics, 2026, 9);
  assert.equal(model.paretoCategories[0].name, 'Electrical');
  assert.equal(model.paretoCategories[0].events, 2);
  assert.equal(model.paretoCategories[0].pct, (2 / 3) * 100);
  assert.equal(model.totalParetoEvents, 3);
  assert.equal(model.paretoCategories.some(item => item.name === 'Carry Over'), false);
});

test('reportMarkup generates Update Status Unit section with Ready/BD columns', () => {
  const model = buildReportModel(sampleLogs(), sampleEquipment(), sampleMetrics, 2026, 9, sampleUnitStatus());
  const html = reportMarkup(model);
  assert.match(html, /BREAKDOWN STATUS REPORT/i);
  assert.match(html, /assets\/reports\/prima-company-logo\.jpg/);
  assert.match(html, /assets\/reports\/omos-one-path\.png/);
  assert.match(html, /UNIT BREAKDOWN AKTIF/i);
  assert.match(html, /UPDATE STATUS UNIT/i);
  assert.doesNotMatch(html, /UNIT READY TO USE/i);
  assert.match(html, /Class Unit/);
  assert.match(html, /Ready/);
  assert.match(html, /BD/);
  assert.match(html, /Komatsu PC400/);
  assert.match(html, /TOTAL BD/);
  assert.match(html, /Jam \/ BD/);
  assert.match(html, /PO: PO-2609-001/);
  assert.match(html, /&gt;24 Jam Kritis/);
  assert.match(html, /Top 5 Penyebab Breakdown \(Akumulasi Event\)/);
  assert.match(html, /1 Event \(25\.0%\)/);
  assert.doesNotMatch(html, /Top 5 Penyebab Breakdown \(Akumulasi Jam\)/);
});

test('index.html contains Report Breakdown button wired to bukaLaporanBreakdown()', () => {
  assert.match(dashboardHtml, /bukaLaporanBreakdown\(\)/);
  assert.match(dashboardHtml, /Report Breakdown/);
});

test('production.loader.js loads breakdownReport.js', () => {
  assert.match(loaderSource, /breakdownReport\.js/);
});

// Regression: reportMarkup mengembalikan "<style>…</style>" di depan elemen
// visual ".br-page". Jika generator menangkap firstElementChild pada container,
// ia akan meng-capture tag <style> (kosong) dan menghasilkan JPEG kosong.
// Generator wajib menargetkan .br-page secara eksplisit.
test('reportMarkup places visual .br-page after the leading <style> block', () => {
  const model = buildReportModel(sampleLogs(), sampleEquipment(), sampleMetrics, 2026, 9);
  const html = reportMarkup(model);
  const styleIndex = html.indexOf('<style>');
  const pageIndex = html.indexOf('<div class="br-page">');
  assert.ok(styleIndex >= 0, 'markup harus memuat <style>');
  assert.ok(pageIndex >= 0, 'markup harus memuat .br-page');
  assert.ok(styleIndex < pageIndex, '<style> berada sebelum .br-page sehingga firstElementChild akan menunjuk ke <style>');
});

test('generateBreakdownJpeg targets .br-page instead of firstElementChild', () => {
  const source = generateBreakdownJpeg.toString();
  assert.match(source, /querySelector\(['"]\.br-page['"]\)/);
  assert.doesNotMatch(source, /firstElementChild/);
});
