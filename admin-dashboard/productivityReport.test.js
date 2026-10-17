const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('./productivityReport.js');

// Wrapper browser wajib meneruskan window ke factory; regresi untuk bug
// "global is not defined" sebelum request ranking dijalankan.
const browserWindow = {};
const browserContext = vm.createContext({
  window: browserWindow,
  globalThis: browserWindow,
  URLSearchParams,
  Intl,
  Date,
  console,
});
const browserSource = fs.readFileSync(path.join(__dirname, 'productivityReport.js'), 'utf8');
vm.runInContext(browserSource, browserContext);
assert.equal(typeof browserWindow.ProductivityRankingUI?.open, 'function');

// --- tone threshold kontrak §8.2 ---
assert.equal(core.toneClass(110.57), 'green');
assert.equal(core.toneClass(100), 'green');
assert.equal(core.toneClass(99.9), 'yellow');
assert.equal(core.toneClass(80), 'yellow');
assert.equal(core.toneClass(79.9), 'red');
assert.equal(core.toneClass(null), 'grey', 'incomplete bukan 0% merah');
assert.equal(core.toneClass(undefined), 'grey');

// --- format display ---
assert.equal(core.fmtPct(110.567), '110,57%');
assert.equal(core.fmtPct(null), '—');
assert.equal(core.fmtVol(10000), '10.000');
assert.equal(core.fmtHM(4.5), '4,5 HM');
assert.equal(core.fmtRatio(0.2854), '0,285 L/BCM');
assert.equal(core.fmtRatio(2.4567, 'L/Km'), '2,457 L/Km');
assert.equal(core.fmtRatio(null), '—');

// --- slicer mengirim query yang benar ---
const q = core.buildQuery({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', area: 'BEI', job: 'OB', planning_type: 'ob', material: '', page: 1, page_size: 50 });
assert.ok(q.includes('tanggal_dari=2026-09-01'));
assert.ok(q.includes('planning_type=ob'));
assert.ok(!q.includes('material='), 'filter kosong tidak dikirim');
const qc = core.buildQuery({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', entity_type: 'excavator', control_status: 'ready', sort: 'tanggal', dir: 'desc' });
assert.ok(qc.includes('entity_type=excavator'));
assert.ok(qc.includes('control_status=ready'));

// --- highlight → filter Data Control yang tepat ---
assert.deepEqual(core.highlightTarget({ filter: { control_status: 'ready' } }), { entity_type: '', control_status: 'ready', reason_code: '' });
assert.deepEqual(core.highlightTarget({ filter: { control_status: 'excluded', reason_code: 'NON_PRODUCTION_JOB_DW' } }), { entity_type: '', control_status: 'excluded', reason_code: 'NON_PRODUCTION_JOB_DW' });
assert.deepEqual(core.highlightTarget(null), { entity_type: '', control_status: '', reason_code: '' });

// --- paginasi ---
assert.equal(core.pageCount(438, 50), 9);
assert.equal(core.pageCount(0, 50), 1);

// --- escape seluruh data API ---
assert.equal(core.esc('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
assert.equal(core.esc(null), '');

assert.ok(browserSource.includes('Leader Board'));
assert.ok(browserSource.includes('Fuel Ratio Ranking'));
assert.ok(browserSource.includes('Top 10 Low Operator Excavator Productivity'));
assert.ok(browserSource.includes('Top 10 Low Driver DT Productivity'));
assert.ok(browserSource.includes('Top 10 Low Operator Excavator Fuel Ratio'));
assert.ok(browserSource.includes('Top 10 Low Driver DT Fuel Ratio'));
assert.ok(browserSource.includes('/fuel-ratio'));
assert.ok(browserSource.includes("ubahMetricControl('productivity')"));
assert.ok(browserSource.includes("ubahMetricControl('fuel')"));
assert.ok(browserSource.indexOf('data-pr-tab="control"') < browserSource.indexOf('data-pr-tab="ranking"'),
  'Data Control harus menjadi tab pertama');
assert.ok(browserSource.includes("tab: 'control'"), 'Data Control menjadi alur awal/default');
assert.ok(browserSource.includes("'Plan', 'Produksi', 'HM', 'PDTY', 'Achievement'"));
assert.ok(browserSource.includes('Productivity aktual = Produksi ÷ HM'));
assert.ok(browserSource.includes('value="actual_productivity">PDTY'));

console.log('productivityReport pure helpers: OK');
