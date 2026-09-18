const test = require('node:test');
const assert = require('node:assert/strict');
const ProductionController = require('../src/controllers/production.controller');

test('Truck Factor dibaca sebagai versi efektif, bukan hanya record tepat pada tanggal ritase', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
  const start = source.indexOf('static async getTruckFactors');
  const end = source.indexOf('static async getPreviousTruckFactors', start);
  const handler = source.slice(start, end);

  assert.match(handler, /DISTINCT ON \(kategori, tipe_alat, UPPER\(material\)\)/);
  assert.match(handler, /WHERE tanggal <= \$1::date/);
  assert.match(handler, /ORDER BY kategori, tipe_alat, UPPER\(material\), tanggal DESC/);
  assert.match(handler, /source_tanggal/);
});

test('snapshot productivity per jam memakai Truck Factor efektif pada tanggal fleet', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
  const start = source.indexOf('async function getRitaseHourlySnapshot');
  const end = source.indexOf('class ProductionController', start);
  const snapshot = source.slice(start, end);

  assert.match(snapshot, /LEFT JOIN LATERAL/);
  assert.match(snapshot, /WHERE tanggal <= \$3::date/);
  assert.match(snapshot, /ORDER BY tanggal DESC/);
});

test('fleet Ritase payload exposes configured Change Shift and break windows', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/033_shift_planned_nonproductive_windows.sql'), 'utf8');

  assert.match(source, /s\.change_shift_start, s\.change_shift_end, s\.break_start, s\.break_end/);
  assert.match(migration, /TIME '06:00'[\s\S]*TIME '07:00'/);
  assert.match(migration, /TIME '12:00'[\s\S]*TIME '13:00'/);
  assert.match(migration, /TIME '18:00'[\s\S]*TIME '19:00'/);
  assert.match(migration, /TIME '00:00'[\s\S]*TIME '01:00'/);
});

test('klasifikasi productivity menggunakan batas 95% dan 85% tanpa pembulatan formula', () => {
  const achieved = ProductionController.classifyRitaseProductivity({ plan: 140.77, actual: 140, complete: true });
  assert.equal(achieved.state, 'achieved');
  assert.equal(achieved.achievement, (140 / 140.77) * 100);

  const near = ProductionController.classifyRitaseProductivity({ plan: 100, actual: 90, complete: true });
  assert.equal(near.state, 'near');
  assert.equal(near.shortfall, 10);

  const below = ProductionController.classifyRitaseProductivity({ plan: 100, actual: 84.999, complete: true });
  assert.equal(below.state, 'below');
});

test('data yang belum lengkap tidak disalahartikan sebagai productivity nol', () => {
  const result = ProductionController.classifyRitaseProductivity({ plan: 100, actual: 0, complete: false });
  assert.deepEqual(result, { state: 'incomplete', achievement: null, shortfall: null });
});

test('ritase lengkap bernilai nol diklasifikasikan fleet tidak beroperasi', () => {
  const result = ProductionController.classifyRitaseProductivity({ plan: 140.77, actual: 0, complete: true });
  assert.deepEqual(result, { state: 'inactive', achievement: 0, shortfall: 140.77 });
});
