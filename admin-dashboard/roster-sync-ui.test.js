'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

test('Roster exposes descriptive dropdowns and actionable synchronization gaps', () => {
  const app = read('app.js');
  const css = read('style.css');
  const html = read('index.html');

  assert.match(app, /S: 'S · Shift Siang'/);
  assert.match(app, /CP: 'CP · Cuti Periodik'/);
  assert.match(app, /api\/admin\/roster\/jabatan\?\$\{periodeRoster\}/);
  assert.match(app, /jumlah_karyawan_belum_sinkron/);
  assert.match(app, /Setup & Sinkronkan/);
  assert.match(app, /day\?\.source === 'leave_sync'/);
  assert.match(css, /\.roster-sync-summary--warning/);
  assert.match(css, /\.roster-day-select:disabled/);
  assert.match(html, /Setiap sel memakai dropdown status/);
});
