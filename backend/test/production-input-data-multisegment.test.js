'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controller = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'controllers', 'production.controller.js'),
  'utf8'
);

test('create Work Log kedua memakai urutan PostgreSQL DESC NULLS LAST yang valid', () => {
  assert.match(controller, /ORDER BY segment_sequence DESC NULLS LAST, hm_finish DESC LIMIT 1/);
  assert.doesNotMatch(controller, /ORDER BY segment_sequence NULLS LAST DESC/);
});

test('create Work Log tetap memvalidasi konteks segmen dan tidak memakai DUPLICATE_UNIT_SHIFT sebagai hard block', () => {
  const createStart = controller.indexOf('static async createProductionLog');
  const createEnd = controller.indexOf('static async createProductionLogsBatch', createStart);
  const createHandler = controller.slice(createStart, createEnd);
  assert.match(createHandler, /areaName: area_name/);
  assert.match(createHandler, /job,/);
  assert.doesNotMatch(createHandler, /DUPLICATE_UNIT_SHIFT/);
});
