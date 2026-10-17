'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lifecycle = require('../src/services/hmMeterLifecycle');

test('resolveContext mengubah pembacaan fisik menjadi Lifetime HM memakai offset event aktif', async () => {
  const db = {
    async query(sql) {
      assert.match(sql, /equipment_hm_meter_events/);
      return { rows: [{ id: 'event-1', event_type: 'replacement', lifetime_offset: 10500 }] };
    },
  };
  const result = await lifecycle.resolveContext(db, {
    equipmentId: 'unit-1', tanggal: '2026-09-30', shiftId: 'shift-1', hmStart: 0, hmFinish: 2.6,
  });
  assert.equal(result.offset, 10500);
  assert.equal(result.lifetimeStart, 10500);
  assert.equal(result.lifetimeFinish, 10502.6);
});

test('resolveContext tanpa event mempertahankan HM fisik', async () => {
  const db = { async query() { return { rows: [] }; } };
  const result = await lifecycle.resolveContext(db, {
    equipmentId: 'unit-1', tanggal: '2026-09-29', shiftId: 'shift-1', hmStart: 10490, hmFinish: 10496,
  });
  assert.equal(result.offset, 0);
  assert.equal(result.lifetimeStart, 10490);
  assert.equal(result.lifetimeFinish, 10496);
});

test('createEvent menghitung offset berantai dan merekonsiliasi work log sesudah event', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT id,nama_shift FROM shifts/.test(sql)) return { rows: [{ id: 'shift-1', nama_shift: 'Shift Siang' }] };
      if (/SELECT id,kode_alat FROM equipment/.test(sql)) return { rows: [{ id: 'unit-1', kode_alat: 'WL30 10-01' }] };
      if (/SELECT ev\.id FROM equipment_hm_meter_events/.test(sql)) return { rows: [] };
      if (/SELECT ev\.lifetime_offset::float/.test(sql)) return { rows: [{ lifetime_offset: 1000 }] };
      if (/INSERT INTO equipment_hm_meter_events/.test(sql)) return { rows: [{ id: 'event-2', lifetime_offset: 10500 }] };
      if (/UPDATE mining_production_logs/.test(sql)) return { rowCount: 5, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const event = await lifecycle.createEvent(db, {
    equipmentId: 'unit-1', effectiveDate: '2026-09-30', effectiveShiftId: 'shift-1',
    eventType: 'replacement', oldMeterFinal: 9500, newMeterInitial: 0,
    reason: 'Penggantian meter berdasarkan WO',
  }, 'user-1');
  assert.equal(event.lifetime_offset, 10500);
  const update = calls.find(call => /UPDATE mining_production_logs/.test(call.sql));
  assert.equal(update.params[1], 10500);
});

test('nilai meter negatif tetap ditolak', () => {
  assert.throws(() => lifecycle.finiteNonNegative(-1, 'HM'), /nol atau positif/);
});
