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

test('buildReportModel groups Ready to Use units by equipment class', () => {
  const model = buildReportModel(sampleLogs(), sampleEquipment(), sampleMetrics, 2026, 9);
  assert.ok(model.rtuGroupMap.has('Excavator'));
  assert.ok(model.rtuGroupMap.has('Dump Truck'));
  assert.equal(model.rtuGroupMap.get('Excavator').length, 1);
  assert.equal(model.rtuGroupMap.get('Dump Truck').length, 1);
});

test('buildReportModel calculates Pareto top 5 breakdown causes', () => {
  const model = buildReportModel(sampleLogs(), sampleEquipment(), sampleMetrics, 2026, 9);
  assert.ok(model.paretoCategories.length > 0);
  assert.equal(model.paretoCategories[0].name, 'Engine Overheating');
});

test('reportMarkup generates complete HTML structure with brandings and badges', () => {
  const model = buildReportModel(sampleLogs(), sampleEquipment(), sampleMetrics, 2026, 9);
  const html = reportMarkup(model);
  assert.match(html, /BREAKDOWN STATUS REPORT/i);
  assert.match(html, /assets\/reports\/prima-company-logo\.jpg/);
  assert.match(html, /assets\/reports\/omos-one-path\.png/);
  assert.match(html, /UNIT BREAKDOWN AKTIF/i);
  assert.match(html, /UNIT READY TO USE/i);
  assert.match(html, /TOTAL BD/);
  assert.match(html, /Jam \/ BD/);
  assert.match(html, /PO: PO-2609-001/);
  assert.match(html, /&gt;24 Jam Kritis/);
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
