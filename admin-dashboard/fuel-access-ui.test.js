const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('./fuelAccess.ui.js');

test('labelSheetHtml: A4 grid vs thermal 50×30 mm, isi di-escape', () => {
  const labels = [{ scan_id: 'EQ-7K3M9Q', kode: 'HD-012', kelas: 'HD785', class_unit: '<b>x</b>', qr_svg: '<svg></svg>' }];
  const a4 = ui.labelSheetHtml(labels, 'a4');
  assert.match(a4, /@page\{size:A4/);
  assert.match(a4, /grid-template-columns:repeat\(3,1fr\)/);
  assert.match(a4, /EQ-7K3M9Q/);
  assert.match(a4, /&lt;b&gt;x&lt;\/b&gt;/, 'teks di-escape');
  const thermal = ui.labelSheetHtml(labels, 'thermal');
  assert.match(thermal, /@page\{size:50mm 30mm/);
  assert.match(thermal, /page-break-after:always/);
});

test('describeVariance menampilkan angka server, rollover jelas', () => {
  assert.equal(ui.describeVariance({ variance_liter: 90, variance_pct: 1.1042 }), '+90 L (1,1%)');
  assert.equal(ui.describeVariance({ variance_liter: -12.5, variance_pct: -0.4 }), '-12,5 L (-0,4%)');
  assert.equal(ui.describeVariance({ variance_liter: null, totalizer_open: 999990, totalizer_close: 120 }), 'Rollover / reset meter');
});

test('label fungsi & tanda mobile berbahasa Indonesia', () => {
  assert.equal(ui.functionLabel('fill'), 'Isi unit');
  assert.equal(ui.flagLabel('ledger_stock_short'), 'Stok ledger kurang');
  assert.equal(ui.fmtL(16000), '16.000 L');
});

test('integrasi: loader, tombol Akses Fuel, kolom ID & tangki di List Equipment', () => {
  const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');
  assert.ok(loader.indexOf('fuelAccess.ui.js') > -1 && loader.indexOf('fuelAccess.ui.js') < loader.indexOf("'production.js"));
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="btnAksesFuel"/);
  assert.match(html, /cetakLabelEquipmentTerfilter\(\)/);
  assert.match(html, /<th rowspan="2"[^>]*>ID \(QR\)<\/th>/);
  assert.match(html, /<th rowspan="2">Tangki BBM \(L\)<\/th>/);
  const prod = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
  assert.match(prod, /FuelAccessUi\?\.openEquipmentId/);
  assert.match(prod, /colspan="16"/);
  const src = fs.readFileSync(path.join(__dirname, 'fuelAccess.ui.js'), 'utf8');
  assert.doesNotMatch(src, /\bprompt\(/, 'alasan memakai dialog inline, bukan prompt()');
  assert.match(src, /OMOSActionFeedback/, 'aksi simpan memakai feedback standar');
});
