const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('./fuelEvidence.ui.js');

test('safeHttpUrl hanya meloloskan tautan http(s) untuk lampiran lama', () => {
  assert.equal(ui.safeHttpUrl('https://contoh.test/a.jpg'), 'https://contoh.test/a.jpg');
  assert.equal(ui.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(ui.safeHttpUrl('https://x.test/"onmouseover=1'), null);
  assert.equal(ui.safeHttpUrl(''), null);
});

test('chipLabel dan chunk', () => {
  assert.equal(ui.chipLabel(0), '');
  assert.equal(ui.chipLabel(3), '3 bukti');
  assert.deepEqual(ui.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('loader memuat fuelEvidence.ui.js sebelum production.js dan baris log punya slot bukti', () => {
  const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');
  assert.ok(loader.indexOf('fuelEvidence.ui.js') > -1 && loader.indexOf('fuelEvidence.ui.js') < loader.indexOf("'production.js"));
  const prod = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
  assert.match(prod, /data-fuel-evidence=/);
  assert.match(prod, /FuelEvidenceUi\?\.hydrate\(body\)/);
});
