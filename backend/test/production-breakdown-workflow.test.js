'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateBreakdownCalendarMetrics,
  normalizeReadyVerification,
  assertIndependentReadyVerifier,
  assertIndependentStandbyReviewer,
  splitStandbyIntoOperationalSlices,
  operationalDateForInstant,
  validateStandbyBatchWindow
} = require('../src/controllers/production.controller');

test('Breakdown Calendar PA uses period days, active units, and 24 calendar hours', () => {
  const result = calculateBreakdownCalendarMetrics({
    periodDays: 31,
    activeUnitCount: 10,
    totalBdHours: 124,
    totalIncidents: 4,
    mttrHours: 8.75,
  });

  assert.equal(result.calendarHours, 7440);
  assert.equal(result.uptimeHours, 7316);
  assert.equal(result.calendarPa, (7316 / 7440) * 100);
  assert.equal(result.mtbfHours, 7316 / 4);
  assert.equal(result.mttrHours, 8.75);
});

test('Breakdown Calendar PA retains full precision and clamps impossible negative uptime', () => {
  const result = calculateBreakdownCalendarMetrics({
    periodDays: 1,
    activeUnitCount: 1,
    totalBdHours: 30,
    totalIncidents: 2,
    mttrHours: 0,
  });

  assert.equal(result.calendarHours, 24);
  assert.equal(result.uptimeHours, 0);
  assert.equal(result.calendarPa, 0);
  assert.equal(result.mtbfHours, 0);
});

test('Ready verification approval requires every safety checklist and location', () => {
  const result = normalizeReadyVerification({
    result: 'approved',
    location: 'Workshop Utama',
    meter_hm: '1234.50',
    checklist: {
      functional_test: true,
      no_leak_or_alarm: true,
      safety_devices: true,
      tools_cleared: true,
      safe_to_operate: true,
    },
  });

  assert.equal(result.result, 'approved');
  assert.equal(result.meterHm, 1234.5);
  assert.equal(result.checklist.safe_to_operate, true);
});

test('Ready verification rejects incomplete approval and incomplete rejection classification', () => {
  assert.throws(() => normalizeReadyVerification({
    result: 'approved',
    location: 'Pit',
    checklist: { functional_test: true },
  }), /Seluruh checklist/);
  assert.throws(() => normalizeReadyVerification({ result: 'rejected' }), /Catatan penolakan/);
  assert.throws(() => normalizeReadyVerification({ result: 'rejected', note: 'Masih bocor' }), /Jenis penolakan/);
  assert.throws(() => normalizeReadyVerification({
    result: 'rejected', note: 'Temuan baru', rejection_type: 'new_fault'
  }), /Kode dan deskripsi/);
});

test('Ready verification classifies same fault and new fault explicitly', () => {
  const same = normalizeReadyVerification({ result: 'rejected', note: 'Masih bocor', rejection_type: 'same_fault' });
  assert.equal(same.rejectionType, 'same_fault');
  const next = normalizeReadyVerification({
    result: 'rejected', note: 'Ban sobek saat test', rejection_type: 'new_fault',
    new_breakdown_code_id: 'bd-code', new_description: 'Tyre sobek'
  });
  assert.equal(next.rejectionType, 'new_fault');
  assert.equal(next.newFault.description, 'Tyre sobek');
});

test('Standby event is split at 18:00 operational shift boundary without rounding', () => {
  const slices = splitStandbyIntoOperationalSlices({
    id: 'stb-1', start_time: '2026-08-30T17:30:00+07:00', finish_time: '2026-08-30T19:00:00+07:00',
    lifecycle_status: 'confirmed'
  }, '2026-08-30', '2026-08-30', { siang: 'day', malam: 'night' });
  assert.equal(slices.length, 2);
  assert.equal(slices[0].counted_hours, 0.5);
  assert.equal(slices[1].counted_hours, 1);
});

test('Reclassified verification standby remains auditable but counts zero hours', () => {
  const slices = splitStandbyIntoOperationalSlices({
    id: 'stb-2', start_time: '2026-08-30T10:00:00+07:00', finish_time: '2026-08-30T11:00:00+07:00',
    lifecycle_status: 'reclassified'
  }, '2026-08-30', '2026-08-30', { siang: 'day', malam: 'night' });
  assert.equal(slices.length, 1);
  assert.equal(slices[0].raw_hours, 1);
  assert.equal(slices[0].counted_hours, 0);
});

test('Ready verification enforces an independent validator', () => {
  assert.equal(assertIndependentReadyVerifier('maintenance-user', 'operations-user'), true);
  assert.throws(() => assertIndependentReadyVerifier('same-user', 'same-user'), error => {
    assert.equal(error.statusCode, 403);
    return /user lain/.test(error.message);
  });
});

test('Standby review enforces maker-checker separation', () => {
  assert.equal(assertIndependentStandbyReviewer('record-maker', 'standby-reviewer'), true);
  assert.throws(() => assertIndependentStandbyReviewer('same-user', 'same-user'), error => {
    assert.equal(error.statusCode, 403);
    return /user lain/.test(error.message);
  });
});

test('Multi Unit standby keeps every interval inside the selected operational shift', () => {
  const siang = validateStandbyBatchWindow(
    '2026-08-31', 'siang', '2026-08-31T06:15:00+07:00', '2026-08-31T08:45:00+07:00'
  );
  const malam = validateStandbyBatchWindow(
    '2026-08-31', 'malam', '2026-08-31T23:00:00+07:00', '2026-09-01T02:30:00+07:00'
  );
  assert.equal(siang.totalHours, 2.5);
  assert.equal(malam.totalHours, 3.5);
  assert.throws(() => validateStandbyBatchWindow(
    '2026-08-31', 'siang', '2026-08-31T17:00:00+07:00', '2026-08-31T19:00:00+07:00'
  ), /06:00–18:00/);
  assert.throws(() => validateStandbyBatchWindow(
    '2026-08-31', 'malam', '2026-08-31T17:00:00+07:00', '2026-08-31T19:00:00+07:00'
  ), /18:00–06:00/);
});

test('Hari operasional berpindah tepat pada pukul 06:00 WIB', () => {
  assert.equal(operationalDateForInstant('2026-09-01T05:59:59+07:00'), '2026-08-31');
  assert.equal(operationalDateForInstant('2026-09-01T06:00:00+07:00'), '2026-09-01');
});
