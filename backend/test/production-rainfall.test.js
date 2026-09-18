'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ProductionController = require('../src/controllers/production.controller');

test('rainfall period builds an exclusive next-month boundary', () => {
  assert.deepEqual(ProductionController.rainfallPeriod(2026, 12), {
    year: 2026, month: 12, start: '2026-12-01', end: '2027-01-01'
  });
});

test('rainfall row preserves manual time readings and accepts a night-shift rollover', () => {
  const result = ProductionController.normalizeRainfallRow({
    operational_date: '2026-09-08', shift_id: 'shift-night', area_name: 'BEI', job_code: 'OB',
    rain_start: '23:30', rain_finish: '01:15', intensity_mm: '12.31',
    slippery_start: '01:15', slippery_finish: '03:00'
  }, ProductionController.rainfallPeriod(2026, 9));
  assert.equal(result.rain_start, '23:30:00');
  assert.equal(result.rain_finish, '01:15:00');
  assert.equal(result.intensity_mm, 12.3);
});

test('rainfall interval pairs and intensity are validated', () => {
  const period = ProductionController.rainfallPeriod(2026, 9);
  const base = { operational_date: '2026-09-08', shift_id: 'shift-day', area_name: 'DKC', job_code: 'CG' };
  assert.throws(() => ProductionController.normalizeRainfallRow({ ...base, rain_start: '08:00' }, period), /berpasangan/);
  assert.throws(() => ProductionController.normalizeRainfallRow({ ...base, rain_start: '08:00', rain_finish: '09:00' }, period), /Intensitas/);
  assert.throws(() => ProductionController.normalizeRainfallRow({ ...base, rain_start: '08:00', rain_finish: '09:00', intensity_mm: 'Lebat' }, period), /angka non-negatif/);
  assert.throws(() => ProductionController.normalizeRainfallRow({ ...base, rain_start: '08:00', rain_finish: '09:00', intensity_mm: '-0.1' }, period), /angka non-negatif/);
});
