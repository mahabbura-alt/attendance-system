const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateFuelReadingMetrics } = require('../src/controllers/production.controller');

test('Fuel card uses actual counter deltas without rounding intermediate values', () => {
  const result = calculateFuelReadingMetrics({
    hmReading: 110.25,
    odometerReading: 1012.5,
    fuelFilled: 25,
    isMeterReset: false,
    meterResetReason: '',
  }, {
    duplicateCount: 0,
    previous: { hm_reading: 100, odometer_reading: 1000 },
    next: null,
    equipment: { fuel_rate_lph: 2, kelas_alat: 'Dump Truck' },
  });

  assert.equal(result.hmDelta, 10.25);
  assert.equal(result.distanceKm, 12.5);
  assert.equal(result.fuelPerHm, 25 / 10.25);
  assert.equal(result.fuelPerKm, 2);
  assert.equal(result.targetFuel, 20.5);
  assert.equal(result.variance, 4.5);
});

test('Fuel card leaves ratios empty when a prior counter baseline is unavailable', () => {
  const result = calculateFuelReadingMetrics({
    hmReading: 150,
    odometerReading: null,
    fuelFilled: 30,
    isMeterReset: false,
    meterResetReason: '',
  }, {
    duplicateCount: 0,
    previous: null,
    next: null,
    equipment: { fuel_rate_lph: 5, kelas_alat: 'Excavator' },
  });

  assert.equal(result.hmDelta, null);
  assert.equal(result.fuelPerHm, null);
  assert.equal(result.targetFuel, null);
  assert.ok(result.warnings.some(item => item.code === 'HM_BASELINE_MISSING'));
});

test('Fuel card blocks duplicate unit-date-shift and non-increasing counters', () => {
  const result = calculateFuelReadingMetrics({
    hmReading: 99,
    odometerReading: 999,
    fuelFilled: 20,
    isMeterReset: false,
    meterResetReason: '',
  }, {
    duplicateCount: 1,
    previous: { hm_reading: 100, odometer_reading: 1000 },
    next: null,
    equipment: { fuel_rate_lph: 5, kelas_alat: 'Dump Truck' },
  });

  assert.equal(result.anomalyStatus, 'critical');
  assert.deepEqual(result.issues.map(item => item.code), [
    'DUPLICATE_UNIT_SHIFT',
    'HM_NOT_INCREASING',
    'KM_NOT_INCREASING',
  ]);
});
