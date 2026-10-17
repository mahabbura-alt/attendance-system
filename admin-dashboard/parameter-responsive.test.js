const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = __dirname;
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const production = fs.readFileSync(path.join(root, 'production.js'), 'utf8');

const parameterStart = index.indexOf('<section id="tab-prodParamStandbyBd"');
const parameterEnd = index.indexOf('<!-- ================= 0.3 SPO', parameterStart);
assert.ok(parameterStart >= 0 && parameterEnd > parameterStart, 'Section Parameter harus tersedia');
const parameterSection = index.slice(parameterStart, parameterEnd);

assert.match(parameterSection, /class="tab-konten parameter-page"/);
assert.match(parameterSection, /class="parameter-grid"/);
assert.match(parameterSection, /class="tabel parameter-table parameter-standby-table"/);
assert.match(parameterSection, /<th class="parameter-code-column">Kode<\/th>/);
assert.doesNotMatch(parameterSection, />Governance<\/th>/);
assert.match(parameterSection, /colspan="4" class="tabel__kosong">Memuat kode standby/);
assert.strictEqual((parameterSection.match(/class="parameter-scroll-indicator"/g) || []).length, 4);

assert.match(style, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
assert.match(style, /@media \(max-width:\s*1180px\)/);
assert.match(style, /\.parameter-table-scroll[\s\S]*?overflow-x:\s*auto\s*!important/);
assert.match(style, /\.parameter-table thead th[\s\S]*?position:\s*sticky/);
assert.match(style, /\.parameter-standby-table \.parameter-code-column[\s\S]*?min-width:\s*110px/);

const renderStart = production.indexOf('async function muatProdParamStandbyBd()');
const saveStart = production.indexOf('async function simpanDelayMaster', renderStart);
assert.ok(renderStart >= 0 && saveStart > renderStart, 'Renderer Parameter harus tersedia');
const renderSection = production.slice(renderStart, saveStart);
assert.doesNotMatch(renderSection, /class="standby-code-governance"/);
assert.match(renderSection, /data-planning-type=/);
assert.match(renderSection, /setupParameterTableInteractions\(\)/);
assert.match(renderSection, /readOnlyJobCodes = new Set\(\['OB', 'CG', 'DW'\]\)/);
assert.match(renderSection, /data-job-code-locked=/);
assert.match(renderSection, /Kode JOB sistem tidak dapat diubah/);
assert.match(renderSection, /Kode sistem tidak dapat dihapus/);

assert.match(production, /wrapper\.tabIndex = 0/);
assert.match(production, /wrapper\.addEventListener\('wheel'/);
assert.match(production, /wrapper\.addEventListener\('keydown'/);
assert.match(production, /row\.dataset\.planningType/);
assert.match(production, /row\.dataset\.requiresDescription === 'true'/);

console.log('parameter responsive regression tests passed');
