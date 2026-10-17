const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');

test('setiap fleet menampilkan Jarak Setup dan tombol Jarak Final', () => {
  assert.match(source, /Jarak Setup:/);
  assert.match(source, /onclick="bukaJarakFinal/);
  assert.match(source, /Jarak Final:/);
});

test('modal jarak final mengikat alokasi ke dump truck, jam, ritase, jarak dan satuan', () => {
  assert.match(source, /data-distance-truck/);
  assert.match(source, /data-distance-hour/);
  assert.match(source, /data-distance-ritase/);
  assert.match(source, /data-distance-value/);
  assert.match(source, /data-distance-unit/);
  assert.match(source, /ritase\/distance-allocations/);
});

test('browser tidak mengizinkan pengaturan jarak dari ritase yang belum disimpan', () => {
  assert.match(source, /Simpan perubahan ritase fleet terlebih dahulu/);
});

test('loader memakai versi asset terbaru untuk menghindari cache lama', () => {
  assert.ok(Number(loader.match(/'production\.js\?v=(\d+)'/)?.[1]) >= 84);
  assert.match(loader, /'ritaseReport\.js\?v=8'/);
});
