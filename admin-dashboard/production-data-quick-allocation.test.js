'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'productionData.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'productionData.css'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');

test('Alokasi Cepat menyediakan filter, checklist, preview server, dan commit batch', () => {
  assert.match(source, /data-pd-action="quick-allocation"/);
  assert.match(source, /id="pdBulkSelectAll"/);
  assert.match(source, /data-bulk-field="area"/);
  assert.match(source, /data-bulk-field="jobCode"/);
  assert.match(source, /dryRun/);
  assert.match(source, /\/production-data\/fuel\/batch/);
  assert.match(source, /OMOSActionFeedback\.run/);
  assert.match(source, /Maksimal 100 transaksi/);
  assert.match(source, /Gunakan Rekomendasi/);
  assert.match(source, /pdBulkCreateRules/);
});

test('modal batch responsif dan konteks tabel tetap terlihat saat scroll', () => {
  assert.match(css, /\.pd-dialog\.pd-dialog--wide/);
  assert.match(css, /\.pd-bulk-scroll thead th\s*\{[^}]*position:sticky/);
});

test('asset Alokasi Cepat menggunakan cache version terbaru', () => {
  assert.match(index, /productionData\.css\?v=10/);
  assert.match(loader, /productionData\.js\?v=13/);
});

test('P3 menampilkan kualitas, rekonsiliasi, umur antrean, dan unit bermasalah', () => {
  assert.match(source, /Kualitas Alokasi Fuel/);
  assert.match(source, /Status rekonsiliasi/);
  assert.match(source, /oldestPendingDays/);
  assert.match(source, /topUnmappedUnits/);
});

test('P2 menyediakan pengelolaan aturan efektif-bertanggal', () => {
  assert.match(source, /Aturan Alokasi Fuel Efektif/);
  assert.match(source, /\/production-data\/fuel-allocation-rules/);
  assert.match(source, /Nonaktif mulai tanggal/);
});

test('kolom induk JOB menyediakan gear sumber data (Input Ritase / Manual)', () => {
  assert.match(source, /data-pd-source=/);
  assert.match(source, /data-pd-source-area=/);
  assert.match(source, /openManualSource/);
  assert.match(source, /name="pdSource"/);
  assert.match(source, /Input Ritase/);
  assert.match(source, /\/production-data\/manual-source/);
  assert.match(source, /data-pd-manual-job=/);
  assert.match(source, /data-pd-action="save-manual"/);
  assert.match(source, /manualSources/);
});

test('CSS menyediakan gaya gear, input manual, dan opsi sumber', () => {
  assert.match(css, /\.pd-gear/);
  assert.match(css, /\.pd-manual-input/);
  assert.match(css, /\.pd-source-option/);
});

test('tab PIT dan Alokasi Fuel mempunyai KPI sendiri tanpa tombol kunci density', () => {
  assert.match(source, /data-pd-tab/);
  assert.match(source, /ALOKASI FUEL/);
  assert.match(source, /Fuel consumption/);
  assert.match(source, /qualityIssueCount/);
  assert.doesNotMatch(source, /\['Jarak produksi', summary\.distanceKm/);
  assert.match(source, /summaryCards/);
  assert.doesNotMatch(source, /Kunci acuan density/);
  assert.match(css, /\.pd-tabs/);
  assert.match(css, /\.pd-tabs button\.is-active/);
  assert.match(css, /\.pd-summary-card--rose/);
  assert.match(css, /height:42px/);
});

test('Data Produksi memakai revalidasi HTTP dan tab area terisolasi', () => {
  assert.match(source, /cache:\s*method === 'GET' \? 'no-cache' : 'no-store'/);
  assert.match(source, /data-pd-tab/);
  assert.match(source, /ALOKASI FUEL/);
  assert.match(source, /renderActiveTab/);
  assert.match(source, /class="pd-loading"/);
  assert.match(css, /@keyframes pd-loading/);
});

test('tab Alokasi Fuel memiliki indikator per JOB dan drill-down unit tanpa menggandakan transaksi split', () => {
  assert.match(source, /function fuelJobAllocations\(\)/);
  assert.match(source, /part\.jobCode === job\.jobCode/);
  assert.match(source, /displayLiters: liters/);
  assert.match(source, /Alokasi Fuel per JOB/);
  assert.match(source, /data-pd-fuel-job/);
  assert.match(source, /jobAllocation\.items/);
  assert.match(css, /\.pd-fuel-job-card\.is-active/);
});
