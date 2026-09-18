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
  assert.match(index, /productionData\.css\?v=3/);
  assert.match(loader, /productionData\.js\?v=3/);
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
