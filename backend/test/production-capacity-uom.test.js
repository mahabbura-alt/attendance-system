'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ProductionController = require('../src/controllers/production.controller');

test('Dozer and Bulldozer receive BCM/Hr when capacity UoM is blank', () => {
  assert.equal(ProductionController.resolveCapacityUom('Dozer', 700, ''), 'BCM/Hr');
  assert.equal(ProductionController.resolveCapacityUom('Support Bulldozer', 500, null), 'BCM/Hr');
  assert.equal(ProductionController.resolveCapacityUom('DOZER SUPPORT', '350.0', undefined), 'BCM/Hr');
});

test('Explicit UoM remains authoritative and non-Dozer types are not guessed', () => {
  assert.equal(ProductionController.resolveCapacityUom('Dozer', 700, 'LCM/Hr'), 'LCM/Hr');
  assert.equal(ProductionController.resolveCapacityUom('Excavator', 6, ''), null);
  assert.equal(ProductionController.resolveCapacityUom('Bulldozer', '', ''), null);
});
