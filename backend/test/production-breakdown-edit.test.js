'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/config/db');

test('perubahan jenis kerusakan dan penghapusan Part/PO tersimpan secara auditable', async () => {
  const actorId = randomUUID();
  const breakdownId = randomUUID();
  const partId = randomUUID();
  const oldCodeId = randomUUID();
  const newCodeId = randomUUID();
  const writes = [];
  let damageResolved = false;
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
      if (sql.includes('SELECT id,status,current_status,breakdown_code_id')) {
        return { rows: [{ id: breakdownId, status: damageResolved ? 'resolved' : 'open', current_status: damageResolved ? 'resolved' : 'mechanic_progress', breakdown_code_id: oldCodeId }] };
      }
      if (sql.includes('FROM master_breakdown_codes') && args[0] === newCodeId) {
        return { rows: [{ id: newCodeId, kode: 'B02', kategori: 'Hydraulic', deskripsi: 'Hydraulic issue' }] };
      }
      if (sql.includes('FROM master_breakdown_codes') && args[0] === oldCodeId) {
        return { rows: [{ id: oldCodeId, kode: 'B01', kategori: 'Engine', deskripsi: 'Engine issue' }] };
      }
      if (sql.includes('UPDATE breakdown_logs') && sql.includes('breakdown_code_id')) {
        writes.push({ type: 'damage_update', args }); return { rows: [] };
      }
      if (sql.includes("'damage_code_changed'")) {
        writes.push({ type: 'damage_audit', args }); return { rows: [] };
      }
      if (sql.includes('SELECT id FROM breakdown_logs') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: breakdownId }] };
      }
      if (sql.includes('FROM breakdown_parts') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: partId, breakdown_id: breakdownId, part_detail: 'Hose', po_number: 'PO-01', quantity: '1', po_status: 'ordered' }] };
      }
      if (sql.includes('UPDATE breakdown_parts') && sql.includes('RETURNING id,deleted_at')) {
        writes.push({ type: 'part_soft_delete', args });
        return { rows: [{ id: partId, deleted_at: '2026-09-28T01:00:00.000Z' }] };
      }
      if (sql.includes("'part_deleted'")) {
        writes.push({ type: 'part_audit', args }); return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
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
    const damageResponse = await fetch(`${base}/breakdown/${breakdownId}/damage-code`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ breakdown_code_id: newCodeId }),
    });
    assert.equal(damageResponse.status, 200);
    const damageBody = await damageResponse.json();
    assert.equal(damageBody.breakdown_code_id, newCodeId);
    assert.equal(damageBody.kategori_breakdown, 'Hydraulic');
    assert.ok(writes.some(write => write.type === 'damage_update' && write.args[1] === newCodeId));
    assert.ok(writes.some(write => write.type === 'damage_audit'));

    damageResolved = true;
    const resolvedResponse = await fetch(`${base}/breakdown/${breakdownId}/damage-code`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ breakdown_code_id: newCodeId }),
    });
    assert.equal(resolvedResponse.status, 400);
    assert.match((await resolvedResponse.json()).error, /hanya dapat diubah pada breakdown aktif/i);

    const partResponse = await fetch(`${base}/breakdown/${breakdownId}/parts/${partId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(partResponse.status, 200);
    assert.ok(writes.some(write => write.type === 'part_soft_delete' && write.args[0] === partId));
    assert.ok(writes.some(write => write.type === 'part_audit'));
  } finally {
    server.close();
    pool.query = oldQuery;
    pool.connect = oldConnect;
    process.env.JWT_SECRET = oldSecret;
  }
});

test('migrasi audit breakdown mempertahankan Part/PO sebagai soft-delete', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/056_breakdown_edit_audit.sql'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS breakdown_change_audit/);
  assert.match(migration, /damage_code_changed/);
  assert.match(migration, /part_deleted/);
  assert.match(controller, /SET deleted_at=CURRENT_TIMESTAMP,updated_by=\$3/);
  assert.doesNotMatch(controller, /DELETE FROM breakdown_parts\s+WHERE id=\$1/i);
});
