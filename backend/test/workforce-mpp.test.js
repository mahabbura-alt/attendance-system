'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Mpp = require('../src/services/workforceMpp');

test('fill rate null-safe dan gap status berlabel teks', () => {
  assert.equal(Mpp.fillRate(90, 100), 0.9);
  assert.equal(Mpp.fillRate(120, 100), 1, 'dibatasi 1 (min actual/required)');
  assert.equal(Mpp.fillRate(0, 0), null, 'kebutuhan nol -> null, bukan 0%/100% buatan');
  assert.equal(Mpp.fillRate(5, null), null);
  assert.equal(Mpp.gapStatus(3), 'Kurang');
  assert.equal(Mpp.gapStatus(0), 'Sesuai');
  assert.equal(Mpp.gapStatus(-2), 'Lebih');
});

test('ringkasan garis dan departemen: gap, vacancy, kritis, urutan', () => {
  const lines = [
    { department_id: 'd2', department_snapshot: 'Maintenance', position_id: 'p3', actual: 61, required_qty: 66, is_critical: false },
    { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'p1', actual: 54, required_qty: 60, is_critical: true },
    { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'p2', actual: 8, required_qty: 8, is_critical: false },
  ];
  const summary = Mpp.summarizeLines(lines);
  assert.deepEqual({ actual: summary.actual, required: summary.required, gap: summary.gap }, { actual: 123, required: 134, gap: 11 });
  assert.equal(summary.open_vacancy, 11);
  assert.equal(summary.critical_positions, 1);
  assert.ok(Math.abs(summary.fill_rate - 123 / 134) < 1e-12);
  const depts = Mpp.departmentSummaries(lines);
  assert.equal(depts.length, 2);
  assert.equal(depts[0].department_name, 'Produksi', 'gap terbesar dulu');
  assert.equal(depts[0].gap, 6);
  assert.equal(depts[1].department_name, 'Maintenance');
});

function fakePool(routes) {
  const log = [];
  const client = {
    release() {},
    async query(sql, params) {
      log.push({ sql, params });
      for (const [marker, handler] of routes) {
        if (sql.includes(marker)) return handler(sql, params);
      }
      throw new Error('Unexpected SQL: ' + String(sql).slice(0, 80));
    },
  };
  return { log, pool: { connect: async () => client, query: (sql, params) => client.query(sql, params) } };
}

const SCOPE = { tenantKey: 'default', projectKey: 'default' };
const USER = { id: 'actor-1' };

test('save: alasan wajib saat qty berubah, 409 saat revisi basi, audit tertulis', async () => {
  const audits = [];
  const { pool } = fakePool([
    ['FROM workforce_mpp_requirement_audit', async () => ({ rows: [] })],
    ['FROM workforce_positions pos JOIN', async () => ({ rows: [{ position_id: 'pos-1', position_name: 'Operator', department_id: 'dep-1', department_name: 'Produksi' }], rowCount: 1 })],
    ['FROM workforce_mpp_plans', async () => ({ rows: [] })],
    ['INSERT INTO workforce_mpp_plans', async () => ({ rows: [{ id: 'plan-1', version_no: 1, status: 'DRAFT' }] })],
    ['FROM workforce_mpp_lines l', async () => ({ rows: [] })],
    ['INSERT INTO workforce_mpp_lines', async () => ({ rows: [{ id: 'line-1' }] })],
    ['INSERT INTO workforce_mpp_line_periods', async () => ({ rows: [] })],
    ['INSERT INTO workforce_mpp_requirement_audit', async (sql, params) => { audits.push(params); return { rows: [] }; }],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  // Tanpa alasan saat qty berubah dari nol -> 422.
  await assert.rejects(
    Mpp.saveMppWorkspace(pool, USER, { period: '2026-10', lines: [{ position_id: 'pos-1', required_qty: 5 }] }),
    /Alasan perubahan kebutuhan/);
  // Dengan alasan -> tersimpan + audit CREATE.
  const ok = await Mpp.saveMppWorkspace(pool, USER, { period: '2026-10',
    lines: [{ position_id: 'pos-1', required_qty: 5, reason_code: 'FLEET_EXPANSION', priority: 'high', needed_by: '2026-10-15' }] });
  assert.equal(ok.plan.id, 'plan-1');
  assert.equal(audits.length, 1);
  assert.equal(audits[0][5], 'CREATE');
  assert.equal(audits[0][9], 'FLEET_EXPANSION');
  const tersimpan = JSON.parse(audits[0][7]);
  assert.equal(tersimpan.priority, 'HIGH');
  assert.equal(tersimpan.needed_by, '2026-10-15');
});

test('save: baris baru tanpa demand (qty 0) tidak butuh alasan dan tidak menulis noise', async () => {
  let lineInserts = 0, lineUpdates = 0, periodUpserts = 0, audits = 0;
  const catalog = [
    { position_id: 'pos-1', position_name: 'Admin', department_id: 'dep-1', department_name: 'Engineering' },
    { position_id: 'pos-2', position_name: 'Surveyor', department_id: 'dep-1', department_name: 'Engineering' },
  ];
  const { pool } = fakePool([
    ['FROM workforce_mpp_requirement_audit', async () => ({ rows: [] })],
    ['FROM workforce_positions pos JOIN', async (sql, params) => {
      const rows = catalog.filter(row => (params[0] || []).map(String).includes(row.position_id));
      return { rows, rowCount: rows.length };
    }],
    ['FROM workforce_mpp_plans', async () => ({ rows: [{ id: 'plan-1', version_no: 2, status: 'DRAFT' }] })],
    ['FROM workforce_mpp_lines l', async () => ({ rows: [{ id: 'line-9', required_qty: null, revision: null,
      reason_code: null, reason_text: null, notes: null, priority: null, needed_by: null }] })],
    ['INSERT INTO workforce_mpp_lines', async () => { lineInserts += 1; return { rows: [{ id: 'line-x' }] }; }],
    ['UPDATE workforce_mpp_lines', async () => { lineUpdates += 1; return { rows: [] }; }],
    ['INSERT INTO workforce_mpp_line_periods', async () => { periodUpserts += 1; return { rows: [] }; }],
    ['INSERT INTO workforce_mpp_requirement_audit', async () => { audits += 1; return { rows: [] }; }],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  // Baris tak tersentuh (qty 0, tanpa alasan/prioritas/needed-by): lolos tanpa tulis apa pun.
  const untouched = await Mpp.saveMppWorkspace(pool, USER, { period: '2026-10',
    lines: [{ position_id: 'pos-1', required_qty: 0 }] });
  assert.equal(untouched.plan.id, 'plan-1');
  assert.equal(lineInserts, 0, 'tidak insert workforce_mpp_lines');
  assert.equal(lineUpdates, 0, 'tidak update workforce_mpp_lines');
  assert.equal(periodUpserts, 0, 'tidak upsert periode');
  assert.equal(audits, 0, 'tidak tulis audit');
  // Demand baru tanpa alasan: tetap 422 menyebut jabatannya.
  await assert.rejects(
    Mpp.saveMppWorkspace(pool, USER, { period: '2026-10',
      lines: [{ position_id: 'pos-2', required_qty: 3 }] }),
    /Alasan perubahan kebutuhan Surveyor wajib diisi/);
  // Demand baru beralasan: tersimpan + audit CREATE.
  const created = await Mpp.saveMppWorkspace(pool, USER, { period: '2026-10',
    lines: [{ position_id: 'pos-2', required_qty: 3, reason_code: 'PROYEK_BARU' }] });
  assert.equal(created.plan.id, 'plan-1');
  assert.equal(periodUpserts, 1);
  assert.equal(audits, 1);
});

test('save: expected_version_no dan expected_revision basi -> 409', async () => {
  const { pool } = fakePool([
    ['FROM workforce_mpp_requirement_audit', async () => ({ rows: [] })],
    ['FROM workforce_positions pos JOIN', async () => ({ rows: [{ position_id: 'pos-1', position_name: 'Operator', department_id: 'dep-1', department_name: 'Produksi' }], rowCount: 1 })],
    ['SELECT version_no FROM workforce_mpp_plans', async () => ({ rows: [{ version_no: 4 }] })],
    ['SELECT * FROM workforce_mpp_plans', async () => ({ rows: [{ id: 'plan-9', version_no: 2, status: 'DRAFT' }] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  await assert.rejects(
    Mpp.saveMppWorkspace(pool, USER, { period: '2026-10', expected_version_no: 3,
      lines: [{ position_id: 'pos-1', required_qty: 1, reason_code: 'X' }] }),
    /Muat ulang sebelum menyimpan/);
});

test('save: idempotent replay mengembalikan plan tanpa tulis ulang', async () => {
  let storedAudit = null;
  let periodUpserts = 0;
  const lines = [{ position_id: 'pos-1', required_qty: 5, reason_code: 'X' }];
  const { pool } = fakePool([
    ['FROM workforce_mpp_requirement_audit', async () => ({ rows: storedAudit ? [storedAudit] : [] })],
    ['FROM workforce_positions pos JOIN', async () => ({ rows: [{ position_id: 'pos-1', position_name: 'Operator', department_id: 'dep-1', department_name: 'Produksi' }], rowCount: 1 })],
    ['FROM workforce_mpp_plans', async () => ({ rows: [] })],
    ['INSERT INTO workforce_mpp_plans', async () => ({ rows: [{ id: 'plan-1', version_no: 1, status: 'DRAFT' }] })],
    ['FROM workforce_mpp_lines l', async () => ({ rows: [] })],
    ['INSERT INTO workforce_mpp_lines', async () => ({ rows: [{ id: 'line-1' }] })],
    ['INSERT INTO workforce_mpp_line_periods', async () => { periodUpserts += 1; return { rows: [] }; }],
    ['INSERT INTO workforce_mpp_requirement_audit', async (sql, params) => {
      storedAudit = { new_value: JSON.parse(params[7]) };
      return { rows: [] };
    }],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  const first = await Mpp.saveMppWorkspace(pool, USER, { period: '2026-10', lines }, 'key-123');
  assert.equal(first.deduped, false);
  assert.equal(periodUpserts, 1);
  const second = await Mpp.saveMppWorkspace(pool, USER, { period: '2026-10', lines }, 'key-123');
  assert.equal(second.deduped, true);
  assert.equal(periodUpserts, 1, 'replay tidak menulis ulang');
});

test('getMppWorkspace: agregat departemen + summary dari baris', async () => {
  const db = { query: async sql => {
    if (sql.includes('FROM workforce_mpp_plans')) return { rows: [{ id: 'plan-1', version_no: 2, status: 'DRAFT' }] };
    if (sql.includes('FROM workforce_positions pos')) {
      return { rows: [
        { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'p1', position_snapshot: 'Operator',
          line_id: 'l1', is_critical: true, required_qty: 60, actual: 54 },
        { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'p2', position_snapshot: 'Foreman',
          line_id: 'l2', is_critical: false, required_qty: 8, actual: 8 },
      ] };
    }
    throw new Error('Unexpected SQL: ' + String(sql).slice(0, 60));
  } };
  const ws = await Mpp.getMppWorkspace(db, SCOPE, '2026-10');
  assert.equal(ws.period, '2026-10');
  assert.equal(ws.snapshot_date, '2026-10-31');
  assert.equal(ws.lines.length, 2);
  assert.equal(ws.lines[0].gap, 6);
  assert.equal(ws.lines[0].vacancy, 6);
  assert.equal(ws.lines[0].status, 'Kurang');
  assert.equal(ws.departments.length, 1);
  assert.equal(ws.departments[0].gap, 6);
  assert.equal(ws.summary.required, 68);
  assert.equal(ws.summary.critical_positions, 1);
});

test('getActualDetail: 404 untuk jabatan di luar scope, tanpa gaji', async () => {
  const empty = { query: async () => ({ rows: [] }) };
  await assert.rejects(Mpp.getActualDetail(empty, SCOPE, '2026-10', 'pos-x'), /tidak tersedia pada project/);
  const db = { query: async sql => {
    if (sql.includes('FROM workforce_positions p JOIN')) {
      return { rows: [{ id: 'pos-1', name: 'Operator', department_id: 'd1', department_name: 'Produksi' }] };
    }
    return { rows: [{ nama: 'Andi', employee_id: 'E-1', employment_status: 'ACTIVE', grade: 'G5',
      employment_type: 'Tetap', contract_end_date: null, department_snapshot: 'Produksi',
      position_snapshot: 'Operator', effective_from: '2026-01-05' }] };
  } };
  const detail = await Mpp.getActualDetail(db, SCOPE, '2026-10', 'pos-1');
  assert.equal(detail.count, 1);
  assert.equal(detail.personnel[0].nama, 'Andi');
  assert.ok(!('salary' in detail.personnel[0]) && !('gaji' in detail.personnel[0]));
});

test('getMppHistory: filter periode dan jabatan', async () => {
  const seen = [];
  const db = { query: async (sql, params) => {
    seen.push({ sql, params });
    return { rows: [{ id: 'a1', action: 'UPDATE' }] };
  } };
  const rows = await Mpp.getMppHistory(db, SCOPE, { period: '2026-10', position_id: 'pos-1', limit: 10 });
  assert.equal(rows.length, 1);
  const { sql, params } = seen[0];
  assert.match(sql, /period_month/);
  assert.match(sql, /position_id/);
  assert.ok(params.includes('pos-1'));
});
