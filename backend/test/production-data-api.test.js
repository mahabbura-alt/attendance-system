const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../src/config/db');
const domain = require('../src/services/productionData');

test('API auth, server validation, idempotent retry, revision conflict and audit', async () => {
  const actor = randomUUID(); const employee = randomUUID();
  const fuel = { id: randomUUID(), tanggal: '2026-09-01', shift_id: randomUUID(), equipment_id: randomUUID(), fuel_filled: 50, kode_alat: 'TEST' };
  let saved; let audits = 0; let snapshot;
  const oldConnect = pool.connect; const oldQuery = pool.query; const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomUUID();
  pool.query = async (sql, args) => ({ rows: [{ id: args[0], role: args[0] === actor ? 'admin' : 'karyawan' }] });
  pool.connect = async () => ({ release() {}, async query(sql, args = []) {
    const placeholders = [...String(sql).matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
    const expectedParameters = placeholders.length ? Math.max(...placeholders) : 0;
    assert.equal(args.length, expectedParameters, `SQL bind count mismatch: ${String(sql).trim().slice(0, 80)}`);
    if (sql.startsWith('BEGIN')) { snapshot = { saved, audits }; return { rows: [] }; }
    if (sql === 'ROLLBACK') { saved = snapshot.saved; audits = snapshot.audits; return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('FROM fuel_logs WHERE id=')) return { rows: args[0] === fuel.id ? [fuel] : [] };
    if (sql.includes('SELECT * FROM production_fuel_allocation_sets')) return { rows: saved ? [saved] : [] };
    if (sql.includes('INSERT INTO production_fuel_allocation_sets')) {
      saved = { fuel_log_id: args[0], source_fingerprint: args[1], revision: (saved?.revision || 0) + 1,
        allocations: JSON.parse(args[2]).map(p => ({ liters: p.liters, jobCode: p.jobCode, area: p.area })), reason: args[3], updated_by: args[4] };
      return { rows: [saved] };
    }
    if (sql.includes('INSERT INTO production_fuel_allocation_audit')) { audits++; return { rows: [] }; }
    if (sql.includes('SELECT a.* FROM production_fuel_allocation_sets')) return { rows: saved ? [saved] : [] };
    if (sql.includes('FROM fuel_logs f')) return { rows: [fuel] };
    if (sql.includes("planning_type = 'spo'")) return { rows: [{ data_json: { deployedJobs: ['OB'] } }] };
    if (sql.includes('FROM master_job_codes')) return { rows: [{ job_code: 'OB', job_desc: 'Overburden Removal' }] };
    if (sql.includes('SELECT DISTINCT TRIM(lokasi)')) return { rows: [{ name: 'BEI' }] };
    if (sql.includes('SELECT id, nama_shift')) return { rows: [{ id: fuel.shift_id, nama_shift: 'Siang' }] };
    return { rows: [] };
  } });
  const app = express(); app.use(express.json()); app.use('/production', require('../src/routes/production.routes'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/production`;
  const token = id => jwt.sign({ id, role: 'admin' }, process.env.JWT_SECRET);
  const request = (path, id, body) => fetch(url + path, { method: body ? 'PUT' : 'GET', headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${token(id)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await request('/production-data?year=2026&month=9')).status, 401);
    assert.equal((await request('/production-data?year=2026&month=9', employee)).status, 403, 'JWT role cannot override current database role');
    assert.equal((await request('/production-data?year=2026&month=99', actor)).status, 422);
    const response = await request('/production-data?year=2026&month=9', actor);
    assert.equal(response.status, 200); assert.equal((await response.json()).queue.length, 1);
    const body = { fingerprint: domain.fingerprint(fuel), revision: 0, allocations: [{ area: 'BEI', jobCode: 'OB', liters: 50 }], reason: 'Verifikasi Input Data' };
    const endpoint = `/production-data/fuel/${fuel.id}`;
    assert.equal((await request(endpoint, actor, body)).status, 200);
    assert.equal((await request(endpoint, actor, body)).status, 200, 'Retry equivalent JSONB does not conflict');
    assert.equal(audits, 1); assert.equal(saved.revision, 1);
    assert.equal((await request(endpoint, actor, { ...body, reason: 'Perubahan admin lain' })).status, 409);
    assert.equal((await request(endpoint, actor, { ...body, revision: 1, allocations: [{ ...body.allocations[0], liters: 51 }] })).status, 422);
    assert.equal((await request(endpoint, actor, { ...body, fingerprint: 'stale', revision: 1 })).status, 409);
    assert.equal((await request(`/production-data/fuel/${randomUUID()}`, actor, body)).status, 404);
    assert.equal(audits, 1); assert.equal(saved.allocations[0].liters, 50);
  } finally {
    await new Promise(resolve => server.close(resolve)); pool.connect = oldConnect; pool.query = oldQuery;
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  }
});
