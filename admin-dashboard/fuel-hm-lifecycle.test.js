const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');

test('Input Fuel exposes physical and Lifetime HM lineage without an independent reset control', () => {
  assert.match(source, /HM Fisik/);
  assert.match(source, /Lifetime HM/);
  assert.match(source, /Legacy · rekonsiliasi/);
  assert.match(source, /Meter diganti/);
  assert.doesNotMatch(source, /id="ifcReset"/);
  assert.doesNotMatch(source, /id="ifcResetReason"/);
  assert.match(source, /Event HM di halaman Input Data/);
});

test('Fuel modal save uses the shared action feedback helper', () => {
  assert.match(source, /window\.OMOSActionFeedback\.run\(button,task\)/);
});
