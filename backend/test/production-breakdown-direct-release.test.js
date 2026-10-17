'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/config/db');

test('STB-SYS-01 dipensiunkan dari Parameter tanpa memutus foreign key histori', () => {
  const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/046_retire_breakdown_ready_verification.sql'), 'utf8');
  assert.match(controller, /deleted_at IS NULL AND COALESCE\(is_system,FALSE\)=FALSE/);
  assert.match(migration, /SET is_system = TRUE,\s+is_locked = TRUE,\s+deleted_at = COALESCE\(deleted_at, CURRENT_TIMESTAMP\)/);
  assert.doesNotMatch(migration, /DELETE FROM master_standby_codes/);
});

test('release Ready menyelesaikan breakdown langsung tanpa verifikasi atau standby turunan', async () => {
  const actorId = randomUUID();
  const breakdownId = randomUUID();
  const equipmentId = randomUUID();
  const segmentId = randomUUID();
  const writes = [];
  const oldQuery = pool.query;
  const oldConnect = pool.connect;
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomUUID();

  pool.query = async sql => {
    if (sql.includes('FROM users')) return { rows: [{ id: actorId, role: 'admin', is_active: true }] };
    return { rows: [] };
  };
  pool.connect = async () => ({
    release() {},
    async query(sql, args = []) {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: actorId }] };
      if (sql.includes('SELECT * FROM breakdown_logs') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: breakdownId, equipment_id: equipmentId, status: 'open', current_status: 'mechanic_progress' }] };
      }
      if (sql.includes('FROM breakdown_status_history') && sql.includes('ended_at IS NULL')) {
        return { rows: [{ id: segmentId, started_at: '2026-09-01T01:00:00.000Z' }] };
      }
      if (sql.includes('UPDATE breakdown_status_history') && sql.includes('SET ended_at')) {
        writes.push({ type: 'close_segment', args }); return { rows: [] };
      }
      if (sql.includes('SUM(GREATEST') && sql.includes('counts_as_breakdown=TRUE')) return { rows: [{ hours: 4.5 }] };
      if (sql.includes('UPDATE breakdown_logs') && sql.includes("status = 'resolved'")) {
        writes.push({ type: 'resolve', sql, args }); return { rows: [] };
      }
      if (sql.includes('SELECT 1 FROM breakdown_logs') && sql.includes("status='open'")) return { rows: [] };
      if (sql.includes("UPDATE equipment SET status_alat='Ready'")) {
        writes.push({ type: 'equipment_ready', args }); return { rows: [] };
      }
      writes.push({ type: 'unexpected', sql, args });
      return { rows: [] };
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/production', require('../src/routes/production.routes'));
  const token = jwt.sign({ id: actorId, role: 'admin' }, process.env.JWT_SECRET);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const base = `http://127.0.0.1:${server.address().port}/production`;
    const response = await fetch(`${base}/breakdown/${breakdownId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'resolved', changed_at: '2026-09-01T05:30:00.000Z', note: 'Perbaikan selesai' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'resolved');
    assert.ok(writes.some(write => write.type === 'close_segment' && write.args[2] === true && write.args[3] === 'Perbaikan selesai'));
    assert.ok(writes.some(write => write.type === 'resolve' && write.args[4] === 4.5));
    assert.ok(writes.some(write => write.type === 'equipment_ready'));
    assert.equal(writes.some(write => /awaiting_verification|breakdown_verification|standby_logs/i.test(write.sql || '')), false);

    const retired = await fetch(`${base}/breakdown/${breakdownId}/ready-verification`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}',
    });
    assert.equal(retired.status, 404);
  } finally {
    server.close();
    pool.query = oldQuery;
    pool.connect = oldConnect;
    process.env.JWT_SECRET = oldSecret;
  }
});
