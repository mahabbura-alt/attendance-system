'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { pool } = require('../src/config/db');
const {
  DEFAULT_DURATION_THRESHOLDS,
  buildBreakdownUnitStatus,
  durationLevel,
} = require('../src/services/breakdownUnitStatus');

test('unit status derives BD only from active breakdown and counts Ready/BD per equipment type', () => {
  const equipment = [
    { id: 'eq-1', kode_alat: 'EX-01', kelas_alat: 'Excavator', status_alat: 'Ready' },
    { id: 'eq-2', kode_alat: 'EX-02', kelas_alat: 'Excavator', status_alat: 'Breakdown' },
    { id: 'eq-3', kode_alat: 'DT-01', kelas_alat: 'Dump Truck', status_alat: 'Ready' },
  ];
  const active = [{ id: 'bd-1', equipment_id: 'eq-2', current_status: 'waiting_part', start_time: '2026-09-27T00:00:00Z', elapsed_breakdown_hours: 13 }];
  const result = buildBreakdownUnitStatus(equipment, active, { generatedAt: '2026-09-27T12:00:00Z' });

  assert.deepEqual(result.summary, { total: 3, ready: 2, breakdown: 1 });
  const excavator = result.groups.find(group => group.equipmentType === 'Excavator');
  assert.deepEqual({ total: excavator.total, ready: excavator.ready, breakdown: excavator.breakdown }, { total: 2, ready: 1, breakdown: 1 });
  assert.equal(excavator.units[0].unitCode, 'EX-02');
  assert.equal(excavator.units[0].activeIncident.durationLevel, 'warning');
  assert.equal(result.reconciliation.status, 'matched');
});

test('reconciliation flags stale master status, duplicate active incidents, and orphan breakdowns', () => {
  const equipment = [
    { id: 'eq-1', kode_alat: 'EX-01', kelas_alat: 'Excavator', status_alat: 'Ready' },
    { id: 'eq-2', kode_alat: 'DT-01', kelas_alat: 'Dump Truck', status_alat: 'Breakdown' },
  ];
  const active = [
    { id: 'bd-1', equipment_id: 'eq-1', start_time: '2026-09-27T01:00:00Z', elapsed_breakdown_hours: 25 },
    { id: 'bd-2', equipment_id: 'eq-1', start_time: '2026-09-27T02:00:00Z', elapsed_breakdown_hours: 1 },
    { id: 'bd-orphan', equipment_id: 'eq-x', kode_alat: 'ORPHAN', start_time: '2026-09-27T03:00:00Z' },
  ];
  const result = buildBreakdownUnitStatus(equipment, active);
  const codes = result.reconciliation.issues.map(issue => issue.code);
  assert.ok(codes.includes('STATUS_MASTER_MISMATCH'));
  assert.ok(codes.includes('MULTIPLE_ACTIVE_BREAKDOWNS'));
  assert.ok(codes.includes('ORPHAN_ACTIVE_BREAKDOWN'));
  assert.equal(result.reconciliation.status, 'needs_attention');
  assert.equal(result.summary.total, 2);
});

test('duration indicators retain full hours and use existing 12/24 hour display bands', () => {
  assert.deepEqual(DEFAULT_DURATION_THRESHOLDS, {
    warningHours: 12,
    criticalHours: 24,
    basis: 'Satu shift operasional (12 jam) dan standar kritis Breakdown Report (24 jam).',
  });
  assert.equal(durationLevel(11.999), 'normal');
  assert.equal(durationLevel(12), 'warning');
  assert.equal(durationLevel(23.999), 'warning');
  assert.equal(durationLevel(24), 'critical');
});

test('current unit-status endpoint is authenticated and returns authoritative grouped snapshot', async () => {
  const actorId = randomUUID();
  const equipmentId = randomUUID();
  const breakdownId = randomUUID();
  const oldQuery = pool.query;
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomUUID();
  pool.query = async sql => {
    if (sql.includes('FROM users')) return { rows: [{ id: actorId, role: 'admin', is_active: true }] };
    if (sql.includes('FROM equipment') && sql.includes('COALESCE(is_active,TRUE)=TRUE')) {
      return { rows: [{ id: equipmentId, kode_alat: 'EX-01', kelas_alat: 'Excavator', status_alat: 'Breakdown' }] };
    }
    if (sql.includes('FROM breakdown_logs bl') && sql.includes("bl.status='open'")) {
      return { rows: [{ id: breakdownId, equipment_id: equipmentId, current_status: 'mechanic_progress', start_time: new Date().toISOString(), elapsed_breakdown_hours: 2 }] };
    }
    return { rows: [] };
  };

  const app = express();
  app.use(express.json());
  app.use('/production', require('../src/routes/production.routes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/production`;
    assert.equal((await fetch(`${base}/breakdown/unit-status/current`)).status, 401);
    const token = jwt.sign({ id: actorId, role: 'admin' }, process.env.JWT_SECRET);
    const response = await fetch(`${base}/breakdown/unit-status/current`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.summary, { total: 1, ready: 0, breakdown: 1 });
    assert.equal(body.groups[0].ready, 0);
    assert.equal(body.groups[0].breakdown, 1);
  } finally {
    server.close();
    pool.query = oldQuery;
    process.env.JWT_SECRET = oldSecret;
  }
});

