'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ProductionController = require('../src/controllers/production.controller');

test('kode master JOB inti dikenali sebagai read only', () => {
  for (const code of ['OB', 'CG', 'DW', ' ob ', 'cg']) {
    assert.equal(ProductionController.isReadOnlyMasterJobCode(code), true);
  }
  for (const code of ['', 'FOT', 'GNR', null]) {
    assert.equal(ProductionController.isReadOnlyMasterJobCode(code), false);
  }
});
