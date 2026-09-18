'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findOrProvisionRosterAssignment } = require('../src/controllers/rosterController');

test('missing employee assignment is provisioned from active jabatan policy', async () => {
  const queries = [];
  let assignmentExists = false;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM users')) return { rows: [{ id: 'employee-1', jabatan: 'Driver DT' }] };
      if (sql.includes('FROM employee_roster_assignments a')) {
        return { rows: assignmentExists ? [{ id: 'assignment-1', template_id: 'template-1', roster_cuti_hari: 14 }] : [] };
      }
      if (sql.includes('FROM roster_jabatan_policies')) {
        return { rows: [{ id: 'policy-1', template_id: 'template-1', effective_from: '2026-09-07', effective_to: null, anchor_day_index: 1 }] };
      }
      if (sql.includes('INSERT INTO employee_roster_assignments')) {
        assignmentExists = true;
        return { rows: [{ id: 'assignment-1' }] };
      }
      if (sql.includes('INSERT INTO roster_audit_log')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await findOrProvisionRosterAssignment({
    client,
    userId: 'employee-1',
    tanggal: '2026-09-08',
    adminId: 'admin-1',
  });

  assert.equal(result.id, 'assignment-1');
  assert.ok(queries.some(sql => sql.includes('auto_assign_from_jabatan_policy')));
  assert.ok(queries.some(sql => sql.includes('INSERT INTO employee_roster_assignments')));
});

test('missing assignment remains blocked when jabatan has no active policy', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{ id: 'employee-1', jabatan: 'Driver DT' }] };
      if (sql.includes('FROM employee_roster_assignments a')) return { rows: [] };
      if (sql.includes('FROM roster_jabatan_policies')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  await assert.rejects(
    findOrProvisionRosterAssignment({ client, userId: 'employee-1', tanggal: '2026-09-08', adminId: 'admin-1' }),
    /Roster jabatan Driver DT belum memiliki kebijakan aktif/,
  );
});

test('date inside CP gap reuses adjacent assignment without provisioning policy', async () => {
  const queries = [];
  let assignmentQueryCount = 0;
  const adjacentAssignment = {
    id: 'assignment-before-cp',
    template_id: 'template-1',
    effective_from_iso: '2026-09-07',
    effective_to_iso: '2026-09-10',
    roster_cuti_hari: 14,
  };
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM users')) return { rows: [{ id: 'employee-1', jabatan: 'Driver DT' }] };
      if (sql.includes('FROM employee_roster_assignments a')) {
        assignmentQueryCount += 1;
        return { rows: assignmentQueryCount === 1 ? [] : [adjacentAssignment] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await findOrProvisionRosterAssignment({
    client,
    userId: 'employee-1',
    tanggal: '2026-09-11',
    adminId: 'admin-1',
  });

  assert.equal(result.id, adjacentAssignment.id);
  assert.equal(assignmentQueryCount, 2);
  assert.ok(!queries.some(sql => sql.includes('FROM roster_jabatan_policies')));
  assert.ok(!queries.some(sql => sql.includes('INSERT INTO employee_roster_assignments')));
});
