const test = require('node:test');
const assert = require('node:assert/strict');

const { assertStandbySessionIntervals, assertStandbyLogDeletable } = require('../src/controllers/production.controller');

test('standby session accepts adjacent intervals for one unit', () => {
  assert.doesNotThrow(() => assertStandbySessionIntervals([
    { equipmentId: 'unit-a', start: '2026-08-31T06:00:00+07:00', finish: '2026-08-31T08:00:00+07:00' },
    { equipmentId: 'unit-a', start: '2026-08-31T08:00:00+07:00', finish: '2026-08-31T10:00:00+07:00' }
  ]));
});

test('standby session accepts simultaneous intervals for different units', () => {
  assert.doesNotThrow(() => assertStandbySessionIntervals([
    { equipmentId: 'unit-a', start: '2026-08-31T06:00:00+07:00', finish: '2026-08-31T09:00:00+07:00' },
    { equipmentId: 'unit-b', start: '2026-08-31T07:00:00+07:00', finish: '2026-08-31T08:00:00+07:00' }
  ]));
});

test('standby session rejects overlapping intervals for one unit', () => {
  assert.throws(() => assertStandbySessionIntervals([
    { equipmentId: 'unit-a', start: '2026-08-31T06:00:00+07:00', finish: '2026-08-31T09:00:00+07:00' },
    { equipmentId: 'unit-a', start: '2026-08-31T08:59:00+07:00', finish: '2026-08-31T10:00:00+07:00' }
  ]), /bertumpang tindih/);
});

test('standby session rejects zero or negative duration', () => {
  assert.throws(() => assertStandbySessionIntervals([
    { equipmentId: 'unit-a', start: '2026-08-31T08:00:00+07:00', finish: '2026-08-31T08:00:00+07:00' }
  ]), /lebih akhir/);
});

test('standby delete permits confirmed manual records awaiting review', () => {
  assert.equal(assertStandbyLogDeletable({
    is_system_generated: false, code_is_system: false, code_is_locked: false,
    lifecycle_status: 'confirmed', review_status: 'pending'
  }), true);
});

test('standby delete permits closed system records awaiting review', () => {
  assert.equal(assertStandbyLogDeletable({
    is_system_generated: true, code_is_system: true, code_is_locked: true,
    lifecycle_status: 'confirmed', review_status: 'pending', source_reference_id: 'bd-1'
  }), true);
});

test('standby delete blocks every open system record with generic lifecycle rule', () => {
  assert.throws(() => assertStandbyLogDeletable({
    is_system_generated: true, lifecycle_status: 'open', review_status: 'pending',
    source_reference_id: 'bd-1'
  }), /Tercatat/);
});

test('standby delete protects non-confirmed records tanpa gate review lama', () => {
  assert.throws(() => assertStandbyLogDeletable({ is_system_generated: true, lifecycle_status: 'reclassified', review_status: 'pending' }), /Tercatat/);
  assert.equal(assertStandbyLogDeletable({ is_system_generated: true, lifecycle_status: 'confirmed', review_status: 'approved' }), true);
  assert.throws(() => assertStandbyLogDeletable({ lifecycle_status: 'reclassified', review_status: 'pending' }), /Tercatat/);
  assert.equal(assertStandbyLogDeletable({ lifecycle_status: 'confirmed', review_status: 'approved' }), true);
});
