const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../src/config/db');
const domain = require('../src/services/productionData');

test('Alokasi Cepat memvalidasi dry-run, commit atomik, audit batch, dan retry idempoten', async () => {
  const actor = randomUUID(); const employee = randomUUID(); const shift = randomUUID(); const equipment = [randomUUID(), randomUUID()];
  const fuels = equipment.map((equipment_id, index) => ({ id: randomUUID(), tanggal: '2026-09-02', shift_id: shift,
    equipment_id, fuel_filled: index ? 75 : 50, kode_alat: `DT-${index + 1}` }));
  const saved = new Map(); let audits = []; let batches = []; let rules = []; let snapshot;
  const oldConnect = pool.connect; const oldQuery = pool.query; const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomUUID();
  pool.query = async (sql, args) => ({ rows: [{ id: args[0], role: args[0] === actor ? 'admin' : 'karyawan' }] });
  pool.connect = async () => ({ release() {}, async query(sql, args = []) {
    if (sql === 'BEGIN') { snapshot = { saved: new Map(saved), audits: [...audits], batches: [...batches], rules: [...rules] }; return { rows: [] }; }
    if (sql === 'ROLLBACK') {
      saved.clear(); snapshot.saved.forEach((value, id) => saved.set(id, value)); audits = snapshot.audits; batches = snapshot.batches; rules = snapshot.rules; return { rows: [] };
    }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('WHERE f.id=ANY')) return { rows: fuels.filter(fuel => args[0].includes(fuel.id)).sort((a, b) => a.id.localeCompare(b.id)) };
    if (sql.includes('WHERE fuel_log_id=ANY')) return { rows: args[0].flatMap(id => saved.has(id) ? [saved.get(id)] : []) };
    if (sql.includes('INSERT INTO production_fuel_allocation_batches')) {
      const batch = { id: randomUUID(), transaction_count: args[0], total_liters: args[1], reason: args[2], created_by: args[3] };
      batches.push(batch); return { rows: [batch] };
    }
    if (sql.includes('INSERT INTO production_fuel_allocation_sets')) {
      const previous = saved.get(args[0]); const row = { fuel_log_id: args[0], source_fingerprint: args[1],
        allocations: JSON.parse(args[2]), reason: args[3], updated_by: args[4], revision: (previous?.revision || 0) + 1 };
      saved.set(args[0], row); return { rows: [row] };
    }
    if (sql.includes('INSERT INTO production_fuel_allocation_audit')) { audits.push({ fuelId: args[0], batchId: args[4] }); return { rows: [] }; }
    if (sql.includes('FROM production_fuel_allocation_rules WHERE')) return { rows: rules.filter(rule => args[0].includes(rule.equipment_id) && rule.effective_from === args[1]) };
    if (sql.includes('INSERT INTO production_fuel_allocation_rules')) {
      const direct = sql.includes('effective_from,is_active'); const id = randomUUID();
      rules.push({ id, equipment_id: args[0], area_name: args[1], job_code: args[2], effective_from: args[3], is_active: direct ? args[4] : true,
        reason: direct ? args[5] : args[4], source_batch_id: direct ? null : args[5], created_by: args[6], created_at: new Date().toISOString() }); return { rows: [{ id }] };
    }
    if (sql.includes('FROM production_fuel_allocation_rules r')) return { rows: rules };
    if (sql.includes('SELECT id,kode_alat FROM equipment')) return { rows: [{ id: args[0], kode_alat: fuels.find(fuel => fuel.equipment_id === args[0])?.kode_alat || 'TEST' }] };
    if (sql.includes('SELECT a.* FROM production_fuel_allocation_sets')) return { rows: [...saved.values()] };
    if (sql.includes('FROM fuel_logs f')) return { rows: fuels };
    if (sql.includes("planning_type = 'spo'")) return { rows: [{ data_json: { deployedJobs: ['OB'] } }] };
    if (sql.includes('FROM master_job_codes')) return { rows: [{ job_code: 'OB', job_desc: 'Overburden Removal' }] };
    if (sql.includes('SELECT DISTINCT TRIM(lokasi)')) return { rows: [{ name: 'BEI' }] };
    if (sql.includes('SELECT id, nama_shift')) return { rows: [{ id: shift, nama_shift: 'Siang' }] };
    return { rows: [] };
  } });
  const app = express(); app.use(express.json()); app.use('/production', require('../src/routes/production.routes'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/production`;
  const token = id => jwt.sign({ id, role: 'admin' }, process.env.JWT_SECRET);
  const post = (body, id = actor) => fetch(`${url}/production-data/fuel/batch`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${token(id)}` } : {}) }, body: JSON.stringify(body) });
  const postRule = body => fetch(`${url}/production-data/fuel-allocation-rules`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token(actor)}` }, body: JSON.stringify(body) });
  const items = fuels.map(fuel => ({ id: fuel.id, fingerprint: domain.fingerprint(fuel), revision: 0, area: 'BEI', jobCode: 'OB' }));
  try {
    assert.equal((await post({ reason: 'Verifikasi pengawas', items }, null)).status, 401);
    assert.equal((await post({ reason: 'Verifikasi pengawas', items }, employee)).status, 403);
    assert.equal((await post({ reason: 'Verifikasi pengawas', items: [items[0], items[0]] })).status, 422);
    let response = await post({ dryRun: true, reason: 'Verifikasi pengawas', items });
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).summary.totalLiters, 125);
    assert.equal(saved.size, 0); assert.equal(audits.length, 0); assert.equal(batches.length, 0);

    response = await post({ reason: 'Verifikasi pengawas', items: [items[0], { ...items[1], fingerprint: 'stale' }] });
    assert.equal(response.status, 409); assert.equal(saved.size, 0, 'satu konflik membatalkan seluruh batch');

    response = await post({ reason: 'Verifikasi pengawas', items });
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.changed, 2); assert.equal(saved.size, 2); assert.equal(audits.length, 2); assert.equal(batches.length, 1);
    assert.ok(audits.every(audit => audit.batchId === batches[0].id));
    assert.equal(saved.get(fuels[1].id).allocations[0].liters, 75);

    response = await post({ reason: 'Verifikasi pengawas', items });
    assert.equal(response.status, 200); assert.equal((await response.json()).changed, 0);
    assert.equal(audits.length, 2); assert.equal(batches.length, 1);

    response = await post({ reason: 'Verifikasi pengawas', items, createRules: true, effectiveFrom: '2026-09-02' });
    assert.equal(response.status, 200); const ruleResult = await response.json();
    assert.equal(ruleResult.rulesCreated, 2); assert.equal(rules.length, 2); assert.equal(batches.length, 2);
    response = await post({ reason: 'Verifikasi pengawas', items, createRules: true, effectiveFrom: '2026-09-02' });
    assert.equal(response.status, 200); assert.equal((await response.json()).rulesCreated, 0); assert.equal(batches.length, 2);
    response = await postRule({ equipmentId: equipment[0], area: 'BEI', jobCode: 'OB', effectiveFrom: '2026-09-03', active: false, reason: 'Unit dipindahkan sementara' });
    assert.equal(response.status, 201); assert.equal(rules.length, 3); assert.equal(rules[2].is_active, false);
  } finally {
    await new Promise(resolve => server.close(resolve)); pool.connect = oldConnect; pool.query = oldQuery;
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  }
});
