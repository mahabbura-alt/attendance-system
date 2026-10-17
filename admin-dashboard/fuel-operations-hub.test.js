const assert = require('node:assert/strict');
const hub = require('./fuelOperationsHub.js');

// --- format & util murni ---
assert.equal(hub.fmtL(13260), '13.260 L');
assert.equal(hub.fmtL(null), '—');
assert.equal(hub.fmtRp(682100000), 'Rp682.100.000');
assert.equal(hub.fmtPct(102.9), '102,9%');
assert.equal(hub.todayStr(new Date(2026, 8, 29)), '2026-09-29');

// --- operation id stabil per wizard (idempotency retry) ---
const a = hub.newOpId();
const b = hub.newOpId();
assert.ok(a && b && a !== b, 'op id unik per wizard');
assert.ok(/op-|[0-9a-f-]{8}/.test(a), 'format id stabil');

// --- role gating: admin full, non-admin operasional saja ---
assert.deepEqual(hub.modesFor('admin'), ['operasional', 'control', 'admin']);
assert.deepEqual(hub.modesFor('karyawan'), ['operasional']);
assert.deepEqual(hub.modesFor('operator'), ['operasional']);

// --- validasi kuantitas: hanya angka > 0 ---
assert.equal(hub.validQty('2000'), true);
assert.equal(hub.validQty(0), false);
assert.equal(hub.validQty(-5), false);
assert.equal(hub.validQty(''), false);
assert.equal(hub.validQty('abc'), false);

// --- ringkasan bahasa alami konfirmasi wizard ---
assert.equal(
  hub.ringkasanTerima({ produk: 'Solar B35', qty: 2000, lokasi: 'Fuel Station BEI' }),
  'Solar B35 2.000 L diterima di Fuel Station BEI.');
assert.equal(
  hub.ringkasanTransfer({ produk: 'Solar B35', qty: 1000, asal: 'DEPOT', tujuan: 'TRUCK-1' }),
  'Transfer Solar B35 1.000 L dari DEPOT ke TRUCK-1.');
assert.equal(
  hub.ringkasanOpname({ produk: 'Solar B35', qty: 13180, lokasi: 'Fuel Station BEI' }),
  'Opname Solar B35 13.180 L di Fuel Station BEI.');

// --- status tone selalu teks + warna (warna tak pernah sendirian) ---
assert.equal(hub.statusTone('posted'), 'ok');
assert.equal(hub.statusTone('draft'), 'warn');
assert.equal(hub.statusTone('rejected'), 'bad');
assert.equal(hub.statusTone('reversed'), 'muted');
assert.equal(hub.statusTone('xyz'), 'info');

// --- escape seluruh data API ---
assert.equal(hub.esc('<script>'), '&lt;script&gt;');
assert.equal(hub.esc(null), '');

console.log('fuelOperationsHub pure: OK');
