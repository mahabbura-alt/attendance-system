'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../backend/src/routes/production.routes.js'), 'utf8');

test('Breakdown Aktif exposes saved damage-code editor backed by authenticated API', () => {
  assert.match(source, /breakdown-damage-editor/);
  assert.match(source, /simpanJenisKerusakanBreakdown/);
  assert.match(source, /OMOSActionFeedback\.run\(button/);
  assert.match(source, /\/breakdown\/\$\{encodeURIComponent\(breakdownId\)\}\/damage-code/);
  assert.match(routes, /router\.patch\('\/breakdown\/:id\/damage-code'/);
  assert.match(css, /\.breakdown-damage-editor/);
});

test('detail Breakdown exposes auditable Part and PO delete action', () => {
  assert.match(source, /hapusPartBreakdown/);
  assert.match(source, /Riwayat penghapusan tetap disimpan untuk audit/);
  assert.match(source, /\/parts\/\$\{encodeURIComponent\(partId\)\}/);
  assert.match(routes, /router\.delete\('\/breakdown\/:id\/parts\/:partId'/);
  assert.match(source, /<th>Aksi<\/th>/);
});
