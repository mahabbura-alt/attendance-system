'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ProductionController = require('../src/controllers/production.controller');

test('HM Total uses HM Akhir minus HM Start with two-decimal database precision', () => {
  assert.equal(ProductionController.calculateHmTotal(1250, 1260.5), 10.5);
  assert.equal(ProductionController.calculateHmTotal('10.25', '11.50'), 1.25);
});

test('HM range rejects negative values and meter rollback', () => {
  assert.throws(() => ProductionController.calculateHmTotal(100, 99), /tidak boleh lebih kecil/i);
  assert.throws(() => ProductionController.calculateHmTotal(-1, 10), /angka positif/i);
  assert.throws(() => ProductionController.calculateHmTotal('abc', 10), /angka positif/i);
});

test('Production log query limit keeps the default bounded and permits a monthly Input Data request', () => {
  assert.equal(ProductionController.resolveProductionLogLimit(), 200);
  assert.equal(ProductionController.resolveProductionLogLimit('2000'), 2000);
  assert.equal(ProductionController.resolveProductionLogLimit('0'), 1);
  assert.equal(ProductionController.resolveProductionLogLimit('9000'), 2000);
  assert.equal(ProductionController.resolveProductionLogLimit('bukan-angka'), 200);
});
