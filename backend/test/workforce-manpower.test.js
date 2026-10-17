'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Manpower = require('../src/services/workforceManpower');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

function fakePool(routes) {
  const log = [];
  const client = {
    release() {},
    async query(sql, params) {
      log.push({ sql, params });
      for (const [marker, handler] of routes) {
        if (sql.includes(marker)) return handler(sql, params);
      }
      throw new Error('Unexpected SQL: ' + String(sql).slice(0, 90));
    },
  };
  return { log, pool: { connect: async () => client, query: (sql, params) => client.query(sql, params) } };
}

const SCOPE = { tenantKey: 'default', projectKey: 'default' };
const ADMIN = { id: 'admin-1', is_super_admin: false };
const SUPER = { id: 'super-1', is_super_admin: true };

const workspaceRoutes = () => [
  ['FROM workforce_mpp_plans', async () => ({ rows: [{ id: 'plan-1', version_no: 1, status: 'DRAFT' }] })],
  ['FROM workforce_positions pos', async () => ({ rows: [
    { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'pos-1', position_snapshot: 'Operator',
      line_id: 'l1', is_critical: true, required_qty: 60, actual: 54, reason_code: null, reason_text: null,
      notes: null, period_notes: null, priority: 'NORMAL', needed_by: null, revision: 1 },
  ] })],
];

function createPool(vacancyActual = 54) {
  const events = [];
  const lines = [
    { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'pos-1', position_snapshot: 'Operator',
      line_id: 'l1', is_critical: true, required_qty: 60, actual: vacancyActual, reason_code: null, reason_text: null,
      notes: null, period_notes: null, priority: 'NORMAL', needed_by: null, revision: 1 },
  ];
  return { events, ...fakePool([
    ['FROM workforce_manpower_requests', async () => ({ rows: [] })],
    ['FROM workforce_positions p JOIN', async () => ({ rows: [
      { id: 'pos-1', name: 'Operator', department_id: 'd1', department_name: 'Produksi' },
    ] })],
    ['FROM workforce_mpp_plans', async () => ({ rows: [{ id: 'plan-1', version_no: 1, status: 'DRAFT' }] })],
    ['FROM workforce_positions pos', async () => ({ rows: lines })],
    ['JOIN workforce_mpp_plans p ON p.id = l.plan_id', async () => ({ rows: [] })],
    ['nextval(', async () => ({ rows: [{ seq: 7 }] })],
    ['INSERT INTO workforce_manpower_requests', async (sql, params) => ({
      rows: [{ id: 'req-1', request_no: 'MR-2610-000007', qty: params[7], filled_qty: 0, status: 'DRAFT', revision: 1 }],
    })],
    ['INSERT INTO workforce_manpower_request_events', async (sql, params) => { events.push(params); return { rows: [] }; }],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]) };
}

test('pipeline DRAFT→…→FULFILLED eksplisit dan terminal buntu', () => {
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.DRAFT, ['SUBMITTED', 'CANCELLED']);
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.SUBMITTED, ['APPROVED', 'REJECTED', 'CANCELLED']);
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.APPROVED, ['RECRUITING', 'CANCELLED']);
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.RECRUITING, ['CANDIDATE_READY', 'CANCELLED']);
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.CANDIDATE_READY, ['ONBOARDING', 'CANCELLED']);
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.ONBOARDING, ['FULFILLED', 'CANCELLED']);
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.FULFILLED, []);
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.CANCELLED, []);
  assert.deepEqual(Manpower.REQUEST_TRANSITIONS.REJECTED, []);
});

test('create: dalam vacancy tersimpan + event CREATE + nomor MR', async () => {
  const { events, pool } = createPool(54);
  const { request, vacancy, deduped } = await Manpower.createRequest(pool, ADMIN, {
    period: '2026-10', position_id: 'pos-1', qty: 3, reason: 'Tambah fleet', priority: 'high',
  });
  assert.equal(deduped, false);
  assert.equal(vacancy, 6);
  assert.match(request.request_no, /^MR-\d{4}-\d{6}$/);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'req-1');
  assert.equal(events[0][2], 'Tambah fleet');
});

test('create: melebihi vacancy wajib alasan + super admin', async () => {
  const over = { period: '2026-10', position_id: 'pos-1', qty: 10 };
  await assert.rejects(
    Manpower.createRequest(createPool(54).pool, ADMIN, over),
    /melebihi vacancy/);
  await assert.rejects(
    Manpower.createRequest(createPool(54).pool, ADMIN, { ...over, override_reason: 'Direksi minta' }),
    /hanya untuk super admin/);
  const { request } = await Manpower.createRequest(createPool(54).pool, SUPER,
    { ...over, override_reason: 'Direksi minta' });
  assert.equal(request.status, 'DRAFT');
});

test('create: idempotent replay mengembalikan request yang sama', async () => {
  let stored = null;
  const { pool } = fakePool([
    ['FROM workforce_manpower_requests', async sql =>
      (sql.startsWith('SELECT *') ? { rows: stored ? [stored] : [] } : { rows: [] })],
    ['FROM workforce_positions p JOIN', async () => ({ rows: [
      { id: 'pos-1', name: 'Operator', department_id: 'd1', department_name: 'Produksi' },
    ] })],
    ['FROM workforce_mpp_plans', async () => ({ rows: [{ id: 'plan-1', version_no: 1, status: 'DRAFT' }] })],
    ['FROM workforce_positions pos', async () => ({ rows: [
      { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'pos-1', position_snapshot: 'Operator',
        line_id: 'l1', is_critical: false, required_qty: 60, actual: 54, revision: 1 },
    ] })],
    ['JOIN workforce_mpp_plans p ON p.id = l.plan_id', async () => ({ rows: [] })],
    ['nextval(', async () => ({ rows: [{ seq: 1 }] })],
    ['INSERT INTO workforce_manpower_requests', async () => {
      stored = { id: 'req-9', request_no: 'MR-2610-000001', status: 'DRAFT' };
      return { rows: [stored] };
    }],
    ['INSERT INTO workforce_manpower_request_events', async () => ({ rows: [] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  const input = { period: '2026-10', position_id: 'pos-1', qty: 2 };
  const first = await Manpower.createRequest(pool, ADMIN, input, 'key-p1');
  assert.equal(first.deduped, false);
  const second = await Manpower.createRequest(pool, ADMIN, input, 'key-p1');
  assert.equal(second.deduped, true);
  assert.equal(second.request.id, 'req-9');
});

test('transition: ilegal 409, revisi basi 409, FULFILLED parsial 422', async () => {
  const mk = current => fakePool([
    ['FROM workforce_manpower_requests', async sql =>
      (sql.includes('FOR UPDATE') ? { rows: [current] } : { rows: [] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]).pool;
  await assert.rejects(
    Manpower.transitionRequest(mk({ id: 'r', status: 'DRAFT', revision: 1 }), ADMIN, 'r', 'APPROVED', {}),
    /tidak diizinkan/);
  await assert.rejects(
    Manpower.transitionRequest(
      mk({ id: 'r', status: 'SUBMITTED', revision: 3 }), ADMIN, 'r', 'APPROVED', { expected_revision: 2 }),
    /Muat ulang/);
  await assert.rejects(
    Manpower.transitionRequest(
      mk({ id: 'r', status: 'ONBOARDING', revision: 1, filled_qty: 1, qty: 3 }), ADMIN, 'r', 'FULFILLED', {}),
    /Belum terpenuhi penuh/);
});

test('transition: APPROVED menulis approved_by + milestone + event', async () => {
  const events = [];
  const { pool } = fakePool([
    ['FROM workforce_manpower_requests', async sql => (sql.includes('FOR UPDATE')
      ? { rows: [{ id: 'r1', status: 'SUBMITTED', revision: 2, filled_qty: 0, qty: 2 }] }
      : { rows: [] })],
    ['UPDATE workforce_manpower_requests SET status', async () => ({ rows: [{ id: 'r1', status: 'APPROVED', revision: 3 }] })],
    ['INSERT INTO workforce_manpower_request_events', async (sql, params) => { events.push(params); return { rows: [] }; }],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  const { request, unchanged } = await Manpower.transitionRequest(pool, ADMIN, 'r1', 'APPROVED', { reason: 'OK' });
  assert.equal(unchanged, false);
  assert.equal(request.status, 'APPROVED');
  assert.deepEqual([events[0][1], events[0][2]], ['SUBMITTED', 'APPROVED']);
});

test('fulfillment: status bukan ONBOARDING ditolak, overshoot ditolak', async () => {
  const mk = current => fakePool([
    ['FROM workforce_manpower_requests', async () => ({ rows: [current] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]).pool;
  await assert.rejects(
    Manpower.addFulfillment(mk({ id: 'r', status: 'RECRUITING', filled_qty: 0, qty: 2 }), ADMIN, 'r', { employee_user_id: 'u1' }),
    /hanya dapat dicatat pada status ONBOARDING/);
  await assert.rejects(
    Manpower.addFulfillment(mk({ id: 'r', status: 'ONBOARDING', filled_qty: 2, qty: 2 }), ADMIN, 'r', { employee_user_id: 'u1' }),
    /Melebihi kebutuhan/);
});

test('fulfillment: parsial lalu penuh otomatis FULFILLED; duplikat 409', async () => {
  const run = async (filled, qty, failInsert) => {
    let state = { id: 'r1', status: 'ONBOARDING', filled_qty: filled, qty };
    const { pool } = fakePool([
      ['FROM workforce_manpower_requests', async sql => {
        if (sql.includes('FOR UPDATE')) return { rows: [state] };
        return { rows: [] };
      }],
      ['FROM workforce_employee_profiles p', async () => ({ rows: [{ id: 'prof-1' }] })],
      ['INSERT INTO workforce_manpower_request_fulfillments', async () => {
        if (failInsert) { const e = new Error('duplikat'); e.code = '23505'; throw e; }
        state = { ...state, filled_qty: state.filled_qty + 1 };
        return { rows: [] };
      }],
      ['UPDATE workforce_manpower_requests', async sql => {
        if (sql.includes("'FULFILLED'")) state = { ...state, status: 'FULFILLED' };
        return { rows: [state] };
      }],
      ['INSERT INTO workforce_manpower_request_events', async () => ({ rows: [] })],
      ['BEGIN', async () => ({ rows: [] })],
      ['COMMIT', async () => ({ rows: [] })],
      ['ROLLBACK', async () => ({ rows: [] })],
    ]);
    return Manpower.addFulfillment(pool, ADMIN, 'r1', { employee_user_id: 'u-emp' });
  };
  const partial = await run(0, 3, false);
  assert.equal(partial.request.status, 'ONBOARDING');
  assert.equal(partial.request.filled_qty, 1);
  const full = await run(2, 3, false);
  assert.equal(full.request.status, 'FULFILLED');
  await assert.rejects(run(0, 3, true), /sudah tercatat memenuhi/);
});

test('linkMovementFulfillment: tanpa link / status belum siap -> skip beraudit; siap -> linked', async () => {
  const none = await Manpower.linkMovementFulfillment({ query: async () => { throw new Error('no db'); } },
    SCOPE, { movement_type: 'HIRE' }, 'actor');
  assert.equal(none.linked, false);

  const audits = [];
  const mkSkip = status => fakePool([
    ['FROM workforce_manpower_requests', async () => ({ rows: [{ id: 'req-1', status, filled_qty: 0, qty: 2 }] })],
    ['INSERT INTO workforce_movement_audit', async (sql, params) => { audits.push(params); return { rows: [] }; }],
  ]).pool;
  const client = await mkSkip('RECRUITING').connect();
  const skipped = await Manpower.linkMovementFulfillment(client, SCOPE,
    { id: 'mov-1', movement_type: 'HIRE', manpower_request_id: 'req-1', employee_profile_id: 'prof-1' }, 'actor');
  assert.equal(skipped.linked, false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0][3], 'request-status-RECRUITING');

  let reqState = { id: 'req-1', status: 'ONBOARDING', filled_qty: 1, qty: 2 };
  const { pool } = fakePool([
    ['FROM workforce_manpower_requests', async () => ({ rows: [reqState] })],
    ['INSERT INTO workforce_manpower_request_fulfillments', async () => {
      reqState = { ...reqState, filled_qty: 2 }; return { rows: [] };
    }],
    ['UPDATE workforce_manpower_requests', async sql => {
      if (sql.includes("'FULFILLED'")) reqState = { ...reqState, status: 'FULFILLED' };
      return { rows: [reqState] };
    }],
    ['INSERT INTO workforce_manpower_request_events', async () => ({ rows: [] })],
  ]);
  const ready = await Manpower.linkMovementFulfillment((await pool.connect()), SCOPE,
    { id: 'mov-2', movement_type: 'HIRE', manpower_request_id: 'req-1', employee_profile_id: 'prof-1' }, 'actor');
  assert.equal(ready.linked, true);
  assert.equal(ready.request.status, 'FULFILLED');
});

test('getVacancy: agregat request aktif per jabatan + open vacancy', async () => {
  const db = { query: async sql => {
    if (sql.includes('FROM workforce_mpp_plans')) return { rows: [{ id: 'plan-1', version_no: 1, status: 'DRAFT' }] };
    if (sql.includes('FROM workforce_positions pos')) {
      return { rows: [
        { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'p1', position_snapshot: 'Operator',
          line_id: 'l1', is_critical: true, required_qty: 60, actual: 54, revision: 1 },
        { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'p2', position_snapshot: 'Foreman',
          line_id: 'l2', is_critical: false, required_qty: 8, actual: 8, revision: 1 },
      ] };
    }
    if (sql.includes('FROM workforce_manpower_requests')) {
      return { rows: [{ position_id: 'p1', status: 'RECRUITING', qty: 4, filled: 1 }] };
    }
    throw new Error('Unexpected SQL: ' + String(sql).slice(0, 60));
  } };
  const vacancy = await Manpower.getVacancy(db, SCOPE, '2026-10');
  const op = vacancy.lines.find(row => row.position_id === 'p1');
  assert.equal(op.vacancy, 6);
  assert.equal(op.requested, 3);
  assert.equal(op.filled, 1);
  assert.equal(op.open_vacancy, 5);
  assert.equal(vacancy.summary.open_vacancy, 5);
  assert.equal(vacancy.summary.critical_positions, 1);
});

test('migration 068 memisahkan pipeline, event audit, dan fulfillment', () => {
  const sql = read('migrations/068_workforce_manpower_pipeline.sql');
  for (const table of ['workforce_manpower_request_events', 'workforce_manpower_request_fulfillments']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /CANDIDATE_READY/);
  assert.match(sql, /uq_manpower_request_idempotency/);
  assert.match(sql, /uq_manpower_fulfillment_movement/);
  assert.match(sql, /IN_PROGRESS/);
});

test('manpower routes behind admin auth; movement create supports request link', () => {
  const routes = read('src/routes/karyawan.routes.js');
  assert.ok(routes.indexOf('router.use(requireAuth, requireAdmin)') < routes.indexOf("router.get('/workforce/manpower-requests'"));
  for (const path of ['/workforce/mpp/vacancy', '/workforce/manpower-requests',
    '/workforce/manpower-requests/:id/transition', '/workforce/manpower-requests/:id/fulfillments']) {
    assert.match(routes, new RegExp(path.replace(/[/:]/g, '\\$&')));
  }
  const service = read('src/services/workforce.js');
  assert.match(service, /manpower_request_id/);
  assert.match(service, /linkMovementFulfillment/);
});
