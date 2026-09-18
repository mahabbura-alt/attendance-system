const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyHmWorklog, getHmPayableDailyRows, getHmPayableSum, getHmPayrollSummary } = require('../src/services/hmWorklog');
const { updateWorklogReview } = require('../src/controllers/hmWorklogController');
const { pool } = require('../src/config/db');

const base = {
  status: 'submitted', operator_id: 'operator-1', hm_validated_at: '2026-09-17T07:00:00Z',
  hm_anomaly_status: 'normal', total_hm: '9.50', updated_at: '2026-09-17T07:00:00Z',
  work_log_id: null, review_paid_hm: null, source_updated_at: null,
};

test('HM valid masuk payroll tanpa gerbang status atau validasi', () => {
  assert.equal(classifyHmWorklog(base).payable_hm, 9.5);
  assert.equal(classifyHmWorklog({ ...base, hm_anomaly_status: 'warning' }).payable_hm, 9.5);
  assert.equal(classifyHmWorklog({ ...base, hm_anomaly_status: 'confirmed' }).payable_hm, 9.5);
  assert.equal(classifyHmWorklog({ ...base, status: 'draft', hm_validated_at: null }).payable_hm, 9.5);
});

test('HM >10 jam hanya memberi catatan; koreksi dan sumber terbaru tetap masuk payroll', () => {
  assert.equal(classifyHmWorklog({ ...base, total_hm: '10.00' }).hm_note, '');
  assert.equal(classifyHmWorklog({ ...base, total_hm: '10.01' }).hm_note, 'HM Over, perlu verifikasi');
  assert.equal(classifyHmWorklog({ ...base, total_hm: '10.01' }).payable_hm, 10.01);
  const corrected = { ...base, total_hm: '12.00', work_log_id: 'log-1', review_paid_hm: '7.25', source_updated_at: base.updated_at };
  assert.equal(classifyHmWorklog(corrected).payable_hm, 7.25);
  assert.equal(classifyHmWorklog(corrected).hm_note, '');
  const stale = { ...corrected, updated_at: '2026-09-17T08:00:00Z' };
  assert.equal(classifyHmWorklog(stale).payable_hm, 12);
  assert.equal(classifyHmWorklog(stale).hm_note, 'HM Over, perlu verifikasi');
});

test('Work Log draft dapat dikoreksi tanpa mengubah HM sumber', () => {
  const draft = { ...base, status: 'draft' };
  assert.equal(classifyHmWorklog(draft).payable_hm, 9.5);
  const corrected = { ...draft, work_log_id: 'log-draft-1', review_paid_hm: '8.75', source_updated_at: draft.updated_at };
  assert.equal(classifyHmWorklog(corrected).payable_hm, 8.75);
  assert.equal(classifyHmWorklog(corrected).hm_adjusted, true);
});

test('Payroll memakai HM lama sebelum tanggal efektif dan HM Input Data setelahnya', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM hm_worklog_cutover')) return { rows: [{ effective_date: '2026-09-17' }] };
    return { rows: [{ tanggal: '2026-09-16', jam_operasi: '8.00' }, { tanggal: '2026-09-17', jam_operasi: '7.50' }] };
  } };
  assert.equal(await getHmPayableSum(db, 'user-1', '2026-09-16', '2026-09-17'), 15.5);
  assert.deepEqual(calls[1].params, ['user-1', '2026-09-16', '2026-09-17', '2026-09-17']);
  assert.doesNotMatch(calls[1].sql, /mpl\.status = 'submitted'|mpl\.hm_validated_at IS NOT NULL/);
  assert.match(calls[1].sql, /h\.tanggal < \$4::date/);
});

test('Ringkasan payroll memakai semua HM valid tanpa kolom perlu verifikasi', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM hm_worklog_cutover')) return { rows: [{ effective_date: '2026-09-01' }] };
    return { rows: [{ source_hm: '12.50', payable_hm: '12.50' }] };
  } };
  assert.deepEqual(await getHmPayrollSummary(db, 'user-1', '2026-09-01', '2026-09-25'), {
    source_hm: 12.5, payable_hm: 12.5,
  });
  assert.doesNotMatch(calls[1].sql, /pending_hm|mpl\.status = 'submitted'|mpl\.hm_validated_at IS NOT NULL/);
});

test('Admin dapat mengoreksi HM Work Log draft tanpa mengubah HM sumber', async () => {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('FROM hm_worklog_cutover')) return { rows: [{ effective_date: '2026-09-17' }] };
      if (sql.includes('FROM mining_production_logs')) return { rows: [{
        id: '11111111-1111-4111-8111-111111111111', tanggal: '2026-09-17',
        operator_id: '22222222-2222-4222-8222-222222222222', status: 'draft',
        hm_anomaly_status: 'warning', hm_validated_at: null,
        updated_at: new Date('2026-09-17T08:00:00Z'), total_hm: '9.50',
      }] };
      if (sql.includes('FROM hm_worklog_reviews')) return { rows: [] };
      if (sql.includes('INSERT INTO hm_worklog_reviews')) return { rows: [{ paid_hm: '8.50', reason: 'Cek manual', work_log_id: '11111111-1111-4111-8111-111111111111' }] };
      return { rows: [] };
    },
    release: () => {},
  });
  const response = { body: null, json(value) { this.body = value; return this; }, status() { return this; } };
  try {
    await updateWorklogReview({ params: { id: '11111111-1111-4111-8111-111111111111' },
      user: { id: '33333333-3333-4333-8333-333333333333' }, body: { paid_hm: 8.5, reason: 'Cek manual' } },
    response, (error) => { throw error; });
    assert.match(response.body.message, /berhasil/);
    assert.ok(queries.some((sql) => sql.includes('FOR UPDATE')));
    assert.ok(queries.some((sql) => sql.includes('INSERT INTO hm_worklog_review_audit')));
    assert.ok(!queries.some((sql) => sql.includes('UPDATE mining_production_logs')));
  } finally { pool.connect = originalConnect; }
});

test('Koreksi periode sebelum cutover ditolak agar payroll historis tidak berubah', async () => {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({ query: async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM mining_production_logs')) return { rows: [{
      id: '11111111-1111-4111-8111-111111111111', tanggal: '2026-09-16',
      operator_id: '22222222-2222-4222-8222-222222222222', status: 'submitted',
      hm_anomaly_status: 'normal', hm_validated_at: new Date(), updated_at: new Date(), total_hm: '8.00',
    }] };
    if (sql.includes('FROM hm_worklog_cutover')) return { rows: [{ effective_date: '2026-09-17' }] };
    return { rows: [] };
  }, release: () => {} });
  const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  try {
    await updateWorklogReview({ params: { id: '11111111-1111-4111-8111-111111111111' },
      user: { id: '33333333-3333-4333-8333-333333333333' }, body: { paid_hm: 7, reason: 'Koreksi manual' } },
    response, (error) => { throw error; });
    assert.equal(response.code, 409);
    assert.ok(!queries.some((sql) => sql.includes('INSERT INTO hm_worklog_reviews')));
  } finally { pool.connect = originalConnect; }
});
