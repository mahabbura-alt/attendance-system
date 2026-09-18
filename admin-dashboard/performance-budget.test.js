const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = __dirname;
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// P2 regression gate: halaman awal harus tetap ringan. Library dashboard
// produksi dimuat oleh loader setelah user memasuki Mine Planning.
assert.match(index, /production\.loader\.js\?v=\d+/);
assert.doesNotMatch(index, /<script[^>]+production\.js/);
assert.doesNotMatch(index, /<script[^>]+xlsx\.full\.min\.js/);
assert.doesNotMatch(index, /<script[^>]+chart\.js/);
assert.doesNotMatch(index, /<script[^>]+html2pdf/);

assert.match(app, /OMOS_PERFORMANCE_BUDGET/);
assert.match(app, /mulaiObservabilityBrowserOMOS/);
assert.match(app, /Server-Timing/);

console.log('performance budget regression tests passed');
