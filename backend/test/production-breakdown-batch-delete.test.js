'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { pool } = require('../src/config/db');

function buatApp(fixture) {
  const actor = randomUUID();
  const dihapusInsiden = new Set();
  const dihapusSlice = new Set();
  const tulis = [];
  const hidup = () => ({
    incidents: fixture.incidents.filter(r => !dihapusInsiden.has(r.id)),
    slices: fixture.slices.filter(r => !dihapusSlice.has(r.id)),
  });
  const oldQuery = pool.query; const oldConnect = pool.connect; const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomUUID();
  pool.query = async sql => {
    if (sql.includes('FROM users')) return { rows: [{ id: actor, role: 'admin' }] };
    return { rows: [] };
  };
  pool.connect = async () => ({ release() {}, async query(sql, args = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: actor }] };
    if (sql.includes('FOR UPDATE')) {
      return { rows: hidup().incidents.filter(r => args[0].includes(String(r.id))).map(r => ({ id: r.id })) };
    }
    if (sql.includes('FROM breakdown_logs bl JOIN equipment')) return { rows: hidup().incidents };
    if (sql.includes("source_type = 'breakdown_verification'")) return { rows: hidup().slices };
    if (sql.includes('FROM standby_shift_closures')) return { rows: fixture.closures || [] };
    if (sql.includes('DELETE FROM breakdown_ready_verifications') || sql.includes('DELETE FROM breakdown_status_history')) {
      tulis.push({ op: 'hard', sql }); return { rows: [] };
    }
    if (sql.includes('UPDATE breakdown_parts SET deleted_at')) { tulis.push({ op: 'parts', sql }); return { rows: [] }; }
    if (sql.includes('UPDATE breakdown_logs SET deleted_at')) {
      for (const row of hidup().incidents) if (args[0].includes(String(row.id))) dihapusInsiden.add(String(row.id));
      tulis.push({ op: 'logs', sql }); return { rows: [] };
    }
    if (sql.includes('UPDATE standby_logs SET deleted_at')) {
      dihapusSlice.add(String(args[0])); tulis.push({ op: 'slice', sql });
      return { rows: [{ id: args[0] }] };
    }
    if (sql.includes('INSERT INTO breakdown_delete_audit')) { tulis.push({ op: 'audit', args }); return { rows: [{ id: 'audit-1' }] }; }
    if (sql.includes('INSERT INTO standby_log_audit')) { tulis.push({ op: 'slice-audit', sql }); return { rows: [] }; }
    return { rows: [] };
  } });
  const app = express(); app.use(express.json()); app.use('/production', require('../src/routes/production.routes'));
  const token = jwt.sign({ id: actor, role: 'admin' }, process.env.JWT_SECRET);
  return { app, tulis, restore() { pool.query = oldQuery; pool.connect = oldConnect; process.env.JWT_SECRET = oldSecret; } };
}

async function jalan(app, body) {
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const token = app._token;
    const res = await fetch(`http://127.0.0.1:${server.address().port}/production/breakdown/batch`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } finally { server.close(); }
}

const EQ_A = randomUUID(); const EQ_B = randomUUID(); const SHIFT = randomUUID();
const insiden = (id, eq, tgl) => ({ id, equipment_id: eq, tanggal: tgl, shift_id: SHIFT, status: 'open', kode_alat: eq === EQ_A ? 'EX-01' : 'EX-02' });

test('pratinjau agregat per unit tanpa dependensi standby verifikasi', async () => {
  const { app, tulis, restore } = buatApp({
    incidents: [insiden('i1', EQ_A, '2026-09-05'), insiden('i2', EQ_A, '2026-09-06')],
    slices: [{ id: 's1', equipment_id: EQ_A, lifecycle_status: 'open', source_reference_id: 'i1', source_sequence: 1, kode_alat: 'EX-01' }],
    closures: [],
  });
  app._token = jwt.sign({ id: 'x', role: 'admin' }, process.env.JWT_SECRET);
  try {
    const { status, data } = await jalan(app, { unit_ids: [EQ_A], tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30' });
    assert.equal(status, 200);
    assert.equal(data.preview, true);
    assert.equal(data.totals.incidents, 2);
    assert.equal(data.units[0].unit, 'EX-01');
    assert.equal(data.blockedOpen, undefined);
    assert.equal(data.canExecute, true);
    assert.equal(tulis.length, 0);
  } finally { restore(); }
});

test('validasi menolak input tak lengkap', async () => {
  const { app, restore } = buatApp({ incidents: [], slices: [], closures: [] });
  app._token = jwt.sign({ id: 'x', role: 'admin' }, process.env.JWT_SECRET);
  try {
    let r = await jalan(app, { unit_ids: [], tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30' });
    assert.equal(r.status, 400);
    r = await jalan(app, { unit_ids: [EQ_A], tanggal_dari: '2026-09-30', tanggal_sampai: '2026-09-01' });
    assert.equal(r.status, 422);
    r = await jalan(app, { unit_ids: [EQ_A], tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30' });
    assert.equal(r.status, 404);
  } finally { restore(); }
});

test('eksekusi tetap diblokir ketika shift Standby sudah ditutup', async () => {
  const mk = (slices, closures) => buatApp({ incidents: [insiden('i1', EQ_A, '2026-09-05')], slices, closures });
  const t = mk([], [{ tanggal: '2026-09-05', shift_id: SHIFT, equipment_id: EQ_A, kode_alat: 'EX-01' }]);
  t.app._token = jwt.sign({ id: 'x', role: 'admin' }, process.env.JWT_SECRET);
  try {
    const r = await jalan(t.app, { unit_ids: [EQ_A], tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', alasan: 'data ganda', confirm: true });
    assert.equal(r.status, 409);
    assert.equal(r.data.blockedShifts.length, 1);
  } finally { t.restore(); }
});

test('eksekusi tanpa alasan ditolak; sukses menulis audit + soft-delete', async () => {
  const { app, tulis, restore } = buatApp({
    incidents: [insiden('i1', EQ_A, '2026-09-05'), insiden('i2', EQ_B, '2026-09-06')],
    slices: [{ id: 's9', equipment_id: EQ_A, lifecycle_status: 'confirmed', source_reference_id: 'i1', source_sequence: 1, kode_alat: 'EX-01' }],
    closures: [],
  });
  app._token = jwt.sign({ id: 'x', role: 'admin' }, process.env.JWT_SECRET);
  try {
    let r = await jalan(app, { unit_ids: [EQ_A, EQ_B], tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', confirm: true });
    assert.equal(r.status, 400);
    r = await jalan(app, { unit_ids: [EQ_A, EQ_B], tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', alasan: 'duplikat input lapangan', confirm: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.deleted, 2);
    assert.equal(r.data.standbyDeleted, undefined);
    assert.equal(r.data.auditId, 'audit-1');
    const audit = tulis.find(w => w.op === 'audit');
    assert.ok(audit && audit.args[6] === 'duplikat input lapangan');
    assert.ok(tulis.some(w => w.op === 'logs'));
    assert.equal(tulis.some(w => w.op === 'slice'), false);
    r = await jalan(app, { unit_ids: [EQ_A, EQ_B], tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', alasan: 'x', confirm: true });
    assert.equal(r.status, 404);
  } finally { restore(); }
});
