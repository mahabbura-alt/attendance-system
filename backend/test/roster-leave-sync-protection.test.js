'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRosterDailyOverride } = require('../src/controllers/rosterController');

test('manual roster override cannot replace a Database Cuti synchronized day', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM employee_roster_daily') && sql.includes('FOR UPDATE')) {
        return { rows: [{ source: 'leave_sync' }] };
      }
      throw new Error(`Unexpected SQL after leave lock: ${sql}`);
    },
  };

  await assert.rejects(
    applyRosterDailyOverride({
      client,
      userId: 'employee-1',
      tanggal: '2026-10-07',
      statusValue: 'S',
      catatan: null,
      adminId: 'admin-1',
    }),
    error => error.statusCode === 409 && /Database Cuti/.test(error.message),
  );
  assert.equal(queries.length, 1);
});
