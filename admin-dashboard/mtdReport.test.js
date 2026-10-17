'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./mtdReport.js');

assert.equal(core.tone(100), 'good');
assert.equal(core.tone(80), 'warn');
assert.equal(core.tone(79.9), 'bad');
assert.equal(core.tone(null), 'neutral');
assert.equal(core.sourceLabel('fleet_deployment'), 'Fleet Deployment');
assert.equal(core.sourceLabel('monthly_target'), 'Target Bulanan');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');
assert.match(html, /id="mtdReportRoot"/);
assert.match(html, /mtdReport\.css/);
assert.match(loader, /mtdReport\.js/);
const source = fs.readFileSync(path.join(__dirname, 'mtdReport.js'), 'utf8');
assert.match(source, /data-quality-code/);
assert.match(source, /MISSING_TRUCK_FACTOR/);
assert.match(source, /ProductionData\.openIssue/);
assert.match(source, /openProductionTab/);
assert.match(source, /Gagal membuka data terkait/);
assert.match(loader, /mtdReport\.js\?v=2/);
console.log('mtdReport.test.js passed');
