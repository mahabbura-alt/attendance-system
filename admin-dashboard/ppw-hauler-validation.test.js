'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'planProductivity.workspace.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

test('validator baris hauler mencerminkan aturan backend per field', () => {
  assert.match(source, /function haulerRowInvalidFields\(row, planningType\)/);
  assert.match(source, /workEfficiency harus desimal 0–1/);
  assert.match(source, /coal wajib satuan 'Ton'/);
  assert.match(source, /OB wajib satuan 'BCM'/);
});

test('input invalid ditandai merah + tooltip sebelum Simpan', () => {
  assert.match(source, /ppw-invalid/);
  assert.match(source, /ppw-row-invalid/);
  assert.match(css, /\.ppw-hauler input\.ppw-invalid\{border-color:#dc2626/);
});

test('hasil Tempel divalidasi dengan daftar baris bermasalah', () => {
  assert.match(source, /Tempel selesai, tetapi baris berikut belum valid/);
  assert.match(source, /haulerRowInvalidFields\(target, context\.type\)/);
});

test('anti-deadlock: capacity kosong dipaksa ke satuan ekspektasi + normalisasi saat Tempel', () => {
  assert.match(source, /Capacity kosong belum bermakna apa-apa/);
  assert.match(source, /row\.capacityUom = context\.type === 'coal' \? 'Ton' : 'BCM';/);
  assert.match(source, /Normalisasi langsung: BCM yang density-nya tersedia terkonversi/);
  assert.match(source, /normalizeHaulerUnits\(context\);\n        markDirty\(context\); render\(context\);/);
});

test('capacity legacy tetap dapat dioverride eksplisit tanpa konversi satuan diam-diam', () => {
  assert.match(source, /function assignHaulerField\(context, row, field, value\)/);
  assert.match(source, /row\.sourceCapacity = row\.capacity/);
  assert.match(source, /row\.sourceCapacityUom = row\.capacityUom/);
  assert.match(source, /row\.capacityUom = expectedUom/);
  assert.match(source, /Sumber lama: /);
  assert.match(source, /Masukkan Capacity /);
  assert.match(source, /assignHaulerField\(context, row, event\.target\.dataset\.haulerRowField/);
});
