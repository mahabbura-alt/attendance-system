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

test('Fuel card validates physical meter resets with Lifetime HM from the authoritative event', () => {
  const result = calculateFuelReadingMetrics({
    hmReading: 4.8,
    hmLifetimeReading: 55.8,
    hmLineageStatus: 'derived',
    odometerReading: null,
    fuelFilled: 44,
    isMeterReset: false,
  }, {
    duplicateCount: 0,
    previous: { hm_reading: 2.6, hm_lifetime_reading: 53.6, hm_lineage_status: 'derived' },
    next: null,
    equipment: { fuel_rate_lph: 20, kelas_alat: 'Wheel Loader' },
  });

  assert.equal(result.hmLifetimeReading, 55.8);
  assert.ok(Math.abs(result.hmDelta - 2.2) < 1e-9);
  assert.ok(Math.abs(result.fuelPerHm - 20) < 1e-9);
  assert.equal(result.issues.length, 0);
});

test('Fuel card starts a baseline instead of mixing a legacy counter with Lifetime HM', () => {
  const result = calculateFuelReadingMetrics({
    hmReading: 4.8,
    hmLifetimeReading: 55.8,
    hmLineageStatus: 'derived',
    odometerReading: null,
    fuelFilled: 44,
    isMeterReset: false,
  }, {
    duplicateCount: 0,
    previous: { hm_reading: 54, hm_lifetime_reading: null, hm_lineage_status: 'legacy_unreconciled' },
    next: null,
    equipment: { fuel_rate_lph: 20, kelas_alat: 'Wheel Loader' },
  });

  assert.equal(result.hmDelta, null);
  assert.equal(result.hmLineageStatus, 'baseline');
  assert.ok(result.warnings.some(item => item.code === 'HM_BASELINE_MISSING'));
  assert.equal(result.issues.length, 0);
});

test('Fuel card rejects independent manual meter reset flags', () => {
  const result = calculateFuelReadingMetrics({
    hmReading: 1,
    hmLifetimeReading: 101,
    hmLineageStatus: 'derived',
    odometerReading: null,
    fuelFilled: 10,
    isMeterReset: true,
  }, {
    duplicateCount: 0,
    previous: null,
    next: null,
    equipment: { fuel_rate_lph: 10, kelas_alat: 'Excavator' },
  });

  assert.equal(result.issues[0].code, 'METER_EVENT_REQUIRED');
});
