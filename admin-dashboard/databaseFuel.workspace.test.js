const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('./databaseFuel.workspace.js');

// --- wrapper browser tidak boleh bergantung pada variabel Node `global` ---
const browserWindow = {};
const browserContext = vm.createContext({
  window: browserWindow,
  globalThis: browserWindow,
  URLSearchParams,
  Intl,
  Date,
  Number,
  String,
  Array,
  Object,
  Boolean,
  Math,
  JSON,
});
const browserSource = fs.readFileSync(path.join(__dirname, 'databaseFuel.workspace.js'), 'utf8');
vm.runInContext(browserSource, browserContext, { filename: 'databaseFuel.workspace.js' });
assert.equal(typeof browserWindow.DatabaseFuelWorkspace?.open, 'function');

// --- format tampilan (tak pernah menebak angka) ---
assert.equal(core.fmtLiter(1234.5), '1.234,5 L');
assert.equal(core.fmtLiter(null), '—');
assert.equal(core.fmtLiter(NaN), '—');
assert.equal(core.fmtIDR(7000), 'Rp7.000');
assert.equal(core.fmtPct(10), '+10%');
assert.equal(core.fmtPct(-25.5), '-25,5%');
assert.equal(core.fmtPct(null), '—');

// --- badge status jujur ---
assert.deepEqual(core.statusBadge('adjusted'), ['DISESUAIKAN', '#15803d']);
assert.deepEqual(core.statusBadge('submitted'), ['DIAJUKAN', '#b45309']);
assert.deepEqual(core.statusBadge('produced'), ['PRODUCED', '#475569'], 'status asing tampil apa adanya');

// --- paginasi: halaman lanjut hanya bila baris melebihi limit ---
assert.equal(core.halamanAda([1, 2, 3], 2), true);
assert.equal(core.halamanAda([1, 2], 2), false);
assert.equal(core.halamanAda([], 50), false);

// --- dataset chart dari series backend apa adanya ---
const ds = core.buildFlowDataset([
  { tanggal: '2026-09-19', masuk: 1000, keluar: 0, issue: 0 },
  { tanggal: '2026-09-20', masuk: 0, keluar: 300, issue: 300 },
]);
assert.deepEqual(ds.labels, ['2026-09-19', '2026-09-20']);
assert.deepEqual(ds.masuk, [1000, 0]);
assert.deepEqual(ds.issue, [0, 300]);
assert.deepEqual(core.buildFlowDataset(null).labels, []);

const dv = core.buildVarianceDataset([
  { operational_date: '2026-09-22', id: 'op-abcdef', variance_percent: 10, variance_alert: true },
  { operational_date: '2026-09-23', id: 'op-ghijkl', variance_percent: null, variance_alert: true },
], 20);
assert.equal(dv.persen.length, 2);
assert.deepEqual(dv.tanpaBasis, [true, false], 'pct null ditandai tanpa basis (urutan kronologis menanjak)');
assert.deepEqual(dv.alert, [true, true]);

// --- URL export membawa filter + tipe tab ---
const url = core.exportUrl('ledger', { dari: '2026-09-01', sampai: '2026-09-22', location_id: 'L1', product_id: '', status: '' });
assert.ok(url.startsWith('/api/admin/production/fuel-inventory/export?'));
assert.ok(url.includes('type=ledger'));
assert.ok(url.includes('location_id=L1'));
assert.ok(!url.includes('product_id'), 'filter kosong tidak dikirim');

// --- escape HTML untuk injeksi aman ---
assert.equal(core.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
assert.equal(core.esc(null), '');

const receipt = core.buildInboundPayload({ transaction_type:'receipt', operational_date:'2026-09-24', product_id:'p1', destination_location_id:'l1', quantity_liter:'1250.5', unit_price:'13750', idempotency_key:'receipt:test' });
assert.equal(receipt.lines[0].direction, 'in');
assert.equal(receipt.lines[0].quantity_liter, 1250.5);
assert.equal(receipt.lines[0].unit_price, 13750);
assert.throws(() => core.buildInboundPayload({ quantity_liter:0 }), /lebih dari 0/);
assert.equal(core.mappingValid({ shift_id:'s1', product_id:'p1', location_id:'l1' }), true);
assert.equal(core.mappingValid({ product_id:'p1', location_id:'l1' }), false);

console.log('databaseFuel.workspace pure helpers: OK');
