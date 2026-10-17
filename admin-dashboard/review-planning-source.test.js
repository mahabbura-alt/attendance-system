const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'reviewProduksi.js'), 'utf8');
const paSource = fs.readFileSync(path.join(__dirname, 'reviewPaWaterfall.js'), 'utf8');
const uaSource = fs.readFileSync(path.join(__dirname, 'reviewUaWaterfall.js'), 'utf8');

test('Review Produksi menampilkan tiga Source Planning dengan default Aktual', () => {
  assert.match(source, /planningSource:\s*'flexible'/);
  assert.match(source, /id="rpPlanningSourceMenu"/);
  assert.match(source, /data-rp-planning-source="flexible"/);
  assert.match(source, /data-rp-planning-source="conservative"/);
  assert.match(source, /data-rp-planning-source="fleet_material"/);
  assert.match(source, /Source Planning · Aktual/);
  assert.match(source, /Fleet Deployment/);
  assert.match(source, /Fleet x Material/);
});

test('Review Produksi mengirim source terpilih ke endpoint utama dan Pareto', () => {
  assert.match(source, /planning_source:\s*state\.planningSource/);
  assert.match(source, /params\.set\('planning_source', state\.planningSource\)/);
});

test('Data Quality menampilkan material dan reason code tanpa kolom Missing Plan utama', () => {
  assert.match(source, /Other \/ Data Quality/);
  assert.match(source, /row\.material/);
  assert.match(source, /row\.reason/);
  assert.doesNotMatch(source, />Missing Plan</);
});

test('Drill-down PA dan UA mengenali formula authoritative masing-masing', () => {
  assert.match(paSource, /row\.paWaterfall/);
  assert.match(paSource, /ΔPA utama/);
  assert.match(paSource, /balanceRoundedImpacts/);
  assert.match(uaSource, /review-ua-spo-direct-v3/);
  assert.match(uaSource, /Plan Delay SPO/);
  assert.doesNotMatch(uaSource, /Plan Efektif UA|Allowance setara/);
  assert.match(uaSource, /row\.rawPlanHours/);
  assert.match(uaSource, /Total dampak parameter sama dengan ΔUA Waterfall Loss &amp; Gain/);
  assert.match(uaSource, /balanceRoundedImpacts/);
});

test('batas lebar batang hanya diterapkan pada Waterfall PA dan UA', () => {
  assert.doesNotMatch(source, /maxBarThickness/);
  assert.match(paSource, /const PARETO_BAR_MAX_THICKNESS = 40/);
  assert.match(paSource, /maxBarThickness: PARETO_BAR_MAX_THICKNESS/);
  assert.match(uaSource, /const PARETO_BAR_MAX_THICKNESS = 40/);
  assert.match(uaSource, /maxBarThickness: PARETO_BAR_MAX_THICKNESS/);
});
