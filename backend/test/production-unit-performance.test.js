'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateUnitPerformanceMetrics,
  maintenanceDurationHours,
} = require('../src/controllers/production.controller');

test('Unit Performance separates calendar PA, scheduled MA, MTBF and MTBR', () => {
  const result = calculateUnitPerformanceMetrics({
    calendarHours: 744,
    excludedHours: 24,
    breakdownDowntime: 20,
    scheduledServiceDowntime: 10,
    inspectionDowntime: 2,
    correctiveRepairDowntime: 3,
    actualHm: 300,
    functionalFailures: 2,
    correctiveRepairs: 3,
    repairHours: [5, 7],
  });

  assert.equal(result.scheduledHours, 720);
  assert.equal(result.physicalDowntime, 35);
  assert.equal(result.pa, (709 / 744) * 100);
  assert.equal(result.ma, (685 / 720) * 100);
  assert.equal(result.mtbfHours, 150);
  assert.equal(result.mtbrHours, 100);
  assert.equal(result.mttrHours, 6);
  assert.equal(result.totalRepairHours, 12);
  assert.equal(result.completedRepairCount, 2);
});

test('Unit Performance keeps unavailable reliability metrics null when HM or events are missing', () => {
  const result = calculateUnitPerformanceMetrics({ calendarHours: 24 });
  assert.equal(result.pa, 100);
  assert.equal(result.ma, 100);
  assert.equal(result.mtbfHours, null);
  assert.equal(result.mtbrHours, null);
  assert.equal(result.mttrHours, null);
});

test('Maintenance duration retains full precision', () => {
  const result = maintenanceDurationHours('2026-08-31T01:00:00.000Z', '2026-08-31T02:15:30.000Z');
  assert.equal(result, 1.2583333333333333);
});
