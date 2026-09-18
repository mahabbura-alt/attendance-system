'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Rainfall = require('./rainfall.core.js');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');
const rainfallSource = fs.readFileSync(path.join(__dirname, 'rainfall.core.js'), 'utf8');

test('Daily Dashboard is replaced by Data Curah Hujan and module is lazy-loaded', () => {
  assert.match(html, /6\. 🌧️ Data Curah Hujan/);
  assert.doesNotMatch(html, /Daily Production Dashboard \(Mine Control\)/);
  assert.match(loader, /'rainfall\.core\.js\?v=3'/);
  assert.match(rainfallSource, /Intensitas \(mm\)/);
  assert.match(rainfallSource, /type="number" min="0" step="0\.1"/);
});

test('empty rainfall entry validates required operational context', () => {
  assert.match(Rainfall.validateRow({ rain_start: '08:00', rain_finish: '09:00', intensity_mm: '2.0' }), /Tanggal, Shift, dan JOB/);
});

test('a complete slippery-only entry is allowed', () => {
  assert.equal(Rainfall.validateRow({ operational_date: '2026-09-08', shift_id: 'siang', job_code: 'OB', slippery_start: '10:00', slippery_finish: '11:00' }), '');
});
