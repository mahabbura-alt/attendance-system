'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Cuti = require('../src/services/cuti');

test('durasi inklusif terkunci: 12-25 Sep = 14 hari, 12-26 = 15 hari', () => {
  assert.equal(Cuti.inclusiveDays('2026-09-12', '2026-09-25'), 14);
  assert.equal(Cuti.inclusiveDays('2026-09-12', '2026-09-26'), 15);
  assert.throws(() => Cuti.inclusiveDays('2026-09-26', '2026-09-12'), /tidak boleh sebelum/);
});

test('hak selalu floor: 56:14 memberi 5 periode termasuk tahun kabisat', () => {
  assert.equal(Cuti.periodEntitlement(56, 14, 2026), 5);
  assert.equal(Cuti.periodEntitlement(56, 14, 2028), 5);
  assert.equal(Cuti.periodEntitlement(0, 0, 2026), 0);
  assert.equal(Cuti.daysInYear(2028), 366);
  assert.equal(Cuti.daysInYear(2026), 365);
});

test('hak CP mengikuti T0, prorata tanggal mulai, dan tahun pemilik siklus', () => {
  const fullYear = { effective_from: '2026-01-01', effective_to: null, work_days: 56, leave_days: 14 };
  assert.deepEqual(Cuti.periodicCycleStarts(fullYear, 2026), [
    '2026-02-26', '2026-05-07', '2026-07-16', '2026-09-24', '2026-12-03',
  ]);
  assert.equal(Cuti.policyPeriodEntitlement(fullYear, 2026), 5);
  const midYear = { effective_from: '2026-08-01', effective_to: null, work_days: 84, leave_days: 14 };
  assert.deepEqual(Cuti.periodicCycleStarts(midYear, 2026), ['2026-10-24']);
  assert.equal(Cuti.policyPeriodEntitlement(midYear, 2026), 1);
  assert.equal(Cuti.policyPeriodEntitlement(midYear, 2027), 3);
});

test('CP terakhir boleh lintas tahun dan T0 berikutnya meneruskan akhir proyeksi', () => {
  const shifted = { effective_from: '2026-01-25', effective_to: null, work_days: 56, leave_days: 14 };
  const year2026 = Cuti.annualCycleProjections(shifted, 2026);
  assert.equal(year2026.length, 5);
  assert.deepEqual(year2026.at(-1), {
    owning_year: 2026, cycle_no: 5, t0_date: '2026-11-01',
    projected_start: '2026-12-27', projected_end: '2027-01-09',
    cp_days: 14, work_days: 56,
  });
  const year2027 = Cuti.annualCycleProjections(shifted, 2027);
  assert.equal(year2027[0].t0_date, '2027-01-10');
  assert.equal(year2027[0].projected_start, '2027-03-07');
});

test('tanggal acuan kebijakan mengikuti tahun dashboard', () => {
  const now = new Date('2026-10-08T03:00:00.000Z');
  assert.equal(Cuti.policyReferenceDate(2025, now), '2025-12-31');
  assert.equal(Cuti.policyReferenceDate(2026, now), '2026-10-08');
  assert.equal(Cuti.policyReferenceDate(2027, now), '2027-01-01');
});

test('kebijakan tengah tahun dari DATE PostgreSQL cocok ke departemen dan jabatan', () => {
  const policy = { id: 'policy-hse', department: 'HSE', position: 'SPV HSE', leave_type: 'CP',
    work_days: 84, leave_days: 14, version_no: 1, is_active: true,
    effective_from: new Date('2026-08-01T00:00:00.000Z'),
    effective_to: new Date('2026-12-31T00:00:00.000Z') };
  assert.equal(Cuti.policyAt([policy], { departemen: 'HSE', jabatan: 'SPV HSE' }, 'CP', '2026-10-08')?.id, 'policy-hse');
  assert.equal(Cuti.policyAt([policy], { departemen: 'HSE', jabatan: 'Safety Officer' }, 'CP', '2026-10-08'), null);
  assert.equal(Cuti.policyAt([policy], { departemen: 'HSE', jabatan: 'SPV HSE' }, 'CP', '2026-07-31'), null);
});

test('kebijakan karyawan spesifik mengalahkan kebijakan jabatan dan tidak bocor ke karyawan lain', () => {
  const common = { id: 'group', target_user_id: null, department: 'HSE', position: 'SPV HSE',
    leave_type: 'CP', work_days: 56, leave_days: 14, version_no: 2, is_active: true,
    effective_from: '2026-01-01', effective_to: null };
  const specific = { ...common, id: 'specific', target_user_id: 'user-z', work_days: 84, version_no: 1 };
  assert.equal(Cuti.policyAt([common, specific], { id: 'user-z', departemen: 'HSE', jabatan: 'SPV HSE' }, 'CP', '2026-10-08').id, 'specific');
  assert.equal(Cuti.policyAt([common, specific], { id: 'user-a', departemen: 'HSE', jabatan: 'SPV HSE' }, 'CP', '2026-10-08').id, 'group');
});

test('ringkasan hak/aktual/sisa periodik dan tahunan', () => {
  const summary = Cuti.summarizeLeave({
    periodEntitlement: 5, periodAdjustment: 0, realisedPeriods: 2,
    annualEntitlement: 12, carryForward: 0, annualAdjustment: 0, ctDays: 3,
  });
  assert.deepEqual(summary, { hak: 5, aktual: 2, sisa: 3, sisaTahunan: 9 });
});

test('proyeksi = akhir realisasi + hari kerja + 1', () => {
  assert.equal(Cuti.projectNextLeave('2026-09-25', 56), '2026-11-21');
  assert.equal(Cuti.projectNextLeave(null, 56), null);
});

test('proyeksi dan jatuh tempo menerima DATE PostgreSQL berupa objek Date', () => {
  assert.equal(Cuti.asIsoDate(new Date('2026-09-25T00:00:00.000Z')), '2026-09-25');
  assert.equal(Cuti.asIsoDate(new Date(2026, 8, 25)), '2026-09-25');
  assert.equal(Cuti.projectNextLeave(new Date('2026-09-25T00:00:00.000Z'), 56), '2026-11-21');
  assert.equal(Cuti.projectNextLeave(new Date(2026, 8, 25), 56), '2026-11-21');
  assert.equal(Cuti.withinDays(new Date('2026-10-20T00:00:00.000Z'), '2026-10-07', 30), true);
  assert.equal(Cuti.withinDays(new Date(2026, 9, 20), '2026-10-07', 30), true);
});

test('refreshProjection memakai T0 kebijakan, bukan tanggal masuk', async () => {
  let savedNext = null;
  const { pool } = fakePool([
    ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-date', nama: 'Rina',
      jabatan: 'Driver DT', departemen: 'Produksi', hire_date: new Date('2026-01-10T00:00:00.000Z') }] })],
    ['FROM leave_policy_versions', async () => ({ rows: [{ id: 'pol-date', work_days: 56,
      leave_days: 14, version_no: 1, basis: 'hire_date',
      effective_from: new Date('2026-01-01T00:00:00.000Z') }] })],
    ['SELECT cycle_no FROM employee_leave_requests', async () => ({ rows: [] })],
    ['INSERT INTO employee_leave_projections', async (sql, params) => {
      savedNext = params[4];
      return { rows: [] };
    }],
  ]);
  const result = await Cuti.refreshProjection(pool.query.bind(pool), SCOPE, 'user-date', 2026);
  assert.equal(result.next_leave_start, '2026-02-26');
  assert.equal(savedNext, '2026-02-26');
  assert.match(result.basis, /T0 2026-01-01/);
  assert.match(result.basis, /baseline tetap Cuti 1/);
});

test('CK dan CT tidak pernah membentuk period_count atau memakai policy CP', async () => {
  for (const leaveType of ['CK', 'CT']) {
    let payload;
    const fake = fakePool([
      ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-independent', nama: 'Ayu', jabatan: 'Admin', departemen: 'HR' }] })],
      ['INSERT INTO employee_leave_realisations', async (sql, params) => {
        payload = params;
        return { rows: [{ period_count: params[7], variance_days: params[8], counting_status: params[9] }] };
      }],
    ]);
    const { pool } = fake;
    const client = await pool.connect();
    const result = await Cuti.buildRealisation((sql, params) => client.query(sql, params), SCOPE,
      USER, { id: `req-${leaveType}`, user_id: 'user-independent', leave_type: leaveType },
      '2026-10-01', '2026-10-03', null, 'approval');
    assert.equal(result.period_count, 0);
    assert.equal(result.counting_status, 'EXCLUDED');
    assert.equal(payload[8], 0);
    assert.equal(fake.log.some(item => String(item.sql).includes('FROM leave_policy_versions')), false);
  }
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
      throw new Error('Unexpected SQL: ' + String(sql).slice(0, 90));
    },
  };
  return { log, pool: { connect: async () => client, query: (sql, params) => client.query(sql, params) } };
}

const SCOPE = { tenantKey: 'default', projectKey: 'default' };
const USER = { id: 'actor-hr', permissions: ['karyawan'] };

test('kebijakan baru menerima minggu, menyimpan hari kanonis, dan scope karyawan', async () => {
  let insertParams;
  const { pool } = fakePool([
    ['SELECT u.id, u.nama FROM users u', async () => ({ rows: [{ id: 'user-z', nama: 'Zulfutra' }] })],
    ['SELECT COALESCE(MAX(version_no)', async () => ({ rows: [{ max_no: 1 }] })],
    ['INSERT INTO leave_policy_versions', async (sql, params) => {
      insertParams = params;
      return { rows: [{ id: 'policy-v2', leave_type: 'CP', version_no: 2 }] };
    }],
    ['UPDATE leave_policy_versions', async () => ({ rows: [] })],
    ['DELETE FROM employee_leave_projections', async () => ({ rows: [] })],
    ['INSERT INTO leave_audit_log', async () => ({ rows: [] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  const policy = await Cuti.createPolicyVersion(pool, SCOPE, USER, {
    department: 'HSE', position: 'SPV HSE', target_user_id: 'user-z',
    work_weeks: 12, leave_weeks: 2, annual_days: 12,
    effective_from: '2026-08-01', note: 'Kebijakan Zulfutra',
  });
  assert.equal(policy.version_no, 2);
  assert.equal(insertParams[4], 'user-z');
  assert.equal(insertParams[5], 'CP');
  assert.equal(insertParams[6], 84);
  assert.equal(insertParams[7], 14);
  assert.equal(insertParams[8], 12);
  assert.equal(insertParams[9], 'policy_effective');
  assert.equal(insertParams[11], null);
});

test('kebijakan mingguan menolak pecahan dan tidak menerima scope kosong', async () => {
  const { pool } = fakePool([]);
  await assert.rejects(Cuti.createPolicyVersion(pool, SCOPE, USER, {
    department: 'HSE', position: 'SPV HSE', work_weeks: 8.5, leave_weeks: 2,
    annual_days: 12, effective_from: '2026-01-01',
  }), /bilangan bulat/);
  await assert.rejects(Cuti.createPolicyVersion(pool, SCOPE, USER, {
    department: '', position: '', work_weeks: 8, leave_weeks: 2,
    annual_days: 12, effective_from: '2026-01-01',
  }), /wajib dipilih/);
});

test('hapus kebijakan tanpa referensi menghapus fisik dengan audit tenant-scoped', async () => {
  let deleted = false;
  let auditAction;
  const { pool, log } = fakePool([
    ['SELECT * FROM leave_policy_versions', async () => ({ rows: [{ id: 'pol-delete', effective_from: '2026-01-01', is_active: true }] })],
    ['SELECT\n        (SELECT COUNT(*)::int FROM employee_leave_entitlements', async () => ({ rows: [{ entitlements: 0, realisations: 0 }] })],
    ['INSERT INTO leave_audit_log', async (sql, params) => { auditAction = params[3]; return { rows: [] }; }],
    ['DELETE FROM leave_policy_versions', async () => { deleted = true; return { rows: [] }; }],
    ['DELETE FROM employee_leave_projections', async () => ({ rows: [] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  const result = await Cuti.deletePolicyVersion(pool, SCOPE, USER, 'pol-delete', 'Duplikat setup');
  assert.equal(result.deleted, true);
  assert.equal(result.archived, false);
  assert.equal(deleted, true);
  assert.equal(auditAction, 'DELETE');
  const select = log.find(item => String(item.sql).includes('FOR UPDATE'));
  assert.deepEqual(select.params, ['pol-delete', 'default', 'default']);
});

test('hapus kebijakan yang sudah dipakai mengarsipkan tanpa merusak histori', async () => {
  let archived = false;
  let physicallyDeleted = false;
  let auditAction;
  const { pool } = fakePool([
    ['SELECT * FROM leave_policy_versions', async () => ({ rows: [{ id: 'pol-used', effective_from: '2026-01-01', is_active: true }] })],
    ['SELECT\n        (SELECT COUNT(*)::int FROM employee_leave_entitlements', async () => ({ rows: [{ entitlements: 2, realisations: 1 }] })],
    ['UPDATE leave_policy_versions SET is_active = FALSE', async () => {
      archived = true;
      return { rows: [{ id: 'pol-used', effective_from: '2026-01-01', is_active: false }] };
    }],
    ['INSERT INTO leave_audit_log', async (sql, params) => { auditAction = params[3]; return { rows: [] }; }],
    ['DELETE FROM leave_policy_versions', async () => { physicallyDeleted = true; return { rows: [] }; }],
    ['DELETE FROM employee_leave_projections', async () => ({ rows: [] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  const result = await Cuti.deletePolicyVersion(pool, SCOPE, USER, 'pol-used', 'Kebijakan diganti');
  assert.equal(result.deleted, false);
  assert.equal(result.archived, true);
  assert.equal(result.references, 3);
  assert.equal(archived, true);
  assert.equal(physicallyDeleted, false);
  assert.equal(auditAction, 'ARCHIVE_DELETE');
});

test('hapus kebijakan wajib menyertakan alasan audit', async () => {
  const { pool } = fakePool([]);
  await assert.rejects(Cuti.deletePolicyVersion(pool, SCOPE, USER, 'pol-1', ''), /Alasan penghapusan/);
});

test('transisi APPROVED hanya membentuk jadwal CP dan belum menambah realisasi/Aktual', async () => {
  let dailyInserts = 0;
  let reconInserts = 0;
  const requestRow = { id: 'req-1', user_id: 'user-1', leave_type: 'CP',
    planned_start: '2026-09-12', planned_end: '2026-09-25', status: 'SUPERVISOR_APPROVED',
    supervisor_by: 'actor-supervisor' };
  const { pool } = fakePool([
    ['SELECT * FROM employee_leave_requests', async () => ({ rows: [{ ...requestRow }] })],
    ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-1', nama: 'Ahmad',
      jabatan: 'Operator EX', departemen: 'Produksi', hire_date: '2024-01-10' }] })],
    ['FROM leave_policy_versions', async () => ({ rows: [{ id: 'pol-1', work_days: 56,
      leave_days: 14, annual_days: 12, effective_from: '2026-01-01', effective_to: null, version_no: 1 }] })],
    ['INSERT INTO employee_leave_entitlements', async () => ({ rows: [{ period_entitlement: 5,
      period_adjustment: 0, annual_entitlement_days: 12 }] })],
    ['LEFT JOIN employee_leave_realisations real', async () => ({ rows: [{ used: 0 }] })],
    ['UPDATE employee_leave_requests', async () => ({ rows: [{ ...requestRow, status: 'APPROVED', hr_by: 'actor-hr' }] })],
    ['FROM employee_roster_daily', async () => ({ rows: [] })],
    ['INSERT INTO leave_roster_snapshots', async () => ({ rows: [] })],
    ['INSERT INTO employee_roster_daily', async (sql, params) => {
      dailyInserts += 1;
      assert.match(sql, /'CP'/);
      assert.equal(params[4], 'req-1');
      return { rows: [] };
    }],
    ['INSERT INTO leave_roster_reconciliation', async () => { reconInserts += 1; return { rows: [] }; }],
    ['INSERT INTO leave_audit_log', async () => ({ rows: [] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  const result = await Cuti.transitionRequest(pool, SCOPE, USER, 'req-1', 'APPROVED');
  assert.equal(result.request.status, 'APPROVED');
  assert.equal(result.realisation, null);
  assert.equal(dailyInserts, 14);
  assert.equal(reconInserts, 14);
  assert.equal(result.roster.written, 14);
});

test('transisi ilegal DRAFT -> APPROVED ditolak 422', async () => {
  const { pool } = fakePool([
    ['FROM employee_leave_requests', async () => ({ rows: [{ id: 'req-9', status: 'DRAFT' }] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  await assert.rejects(Cuti.transitionRequest(pool, SCOPE, USER, 'req-9', 'APPROVED'), /tidak diizinkan/);
});

test('CP roster tidak menimpa manual_override, dicatat OVERRIDDEN', async () => {
  let reconState = null;
  const { pool } = fakePool([
    ['FROM employee_roster_daily', async () => ({ rows: [{ id: 'rd-1', status: 'S', source: 'manual_override' }] })],
    ['INSERT INTO leave_roster_reconciliation', async (sql, params) => { reconState = params[7]; return { rows: [] }; }],
  ]);
  const client = await pool.connect();
  const roster = await Cuti.syncRosterForRealisation(
    (sql, params) => client.query(sql, params), SCOPE,
    { id: 'real-2', user_id: 'user-2', leave_type: 'CP',
      actual_start: '2026-10-01', actual_end: '2026-10-01', created_by: 'actor-hr' });
  assert.equal(roster.written, 0);
  assert.equal(roster.skipped, 1);
  assert.equal(reconState, 'OVERRIDDEN');
});

test('realisasi CP parsial disimpan sebagai PARTIAL dan belum dihitung satu periode', async () => {
  let insertPayload = null;
  const { pool } = fakePool([
    ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-3', nama: 'Sari',
      jabatan: 'Driver DT', departemen: 'Produksi' }] })],
    ['FROM leave_policy_versions', async () => ({ rows: [{ id: 'pol-cp', work_days: 56,
      leave_days: 14, version_no: 2 }] })],
    ['INSERT INTO employee_leave_realisations', async (sql, params) => {
      insertPayload = params;
      return { rows: [{ id: 'real-3', request_id: 'req-3', user_id: 'user-3',
        actual_days: params[6], period_count: params[7], variance_days: params[8],
        counting_status: params[9] }] };
    }],
  ]);
  const client = await pool.connect();
  const result = await Cuti.buildRealisation((sql, params) => client.query(sql, params), SCOPE,
    USER, { id: 'req-3', user_id: 'user-3', leave_type: 'CP' },
    '2026-10-01', '2026-10-07', 'kembali lebih awal', 'approval');
  assert.equal(result.actual_days, 7);
  assert.equal(result.period_count, 0);
  assert.equal(result.variance_days, -7);
  assert.equal(result.counting_status, 'PARTIAL');
  assert.equal(insertPayload[9], 'PARTIAL');
});

test('CK/CT wajib dilekatkan ke nomor siklus', async () => {
  const { pool } = fakePool([
    ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-4', nama: 'Dina' }] })],
  ]);
  await assert.rejects(Cuti.createRequest(pool, SCOPE, USER, {
    user_id: 'user-4', leave_type: 'CT', planned_start: '2026-10-10', planned_end: '2026-10-12',
  }), /Nomor siklus wajib/);
});

test('pengajuan siklus menyimpan CP, CK, dan CT atomik pada tahun pemilik yang sama', async () => {
  const inserts = [];
  const groupIds = new Set();
  const { pool, log } = fakePool([
    ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-cycle', nama: 'Zulfutra',
      jabatan: 'SPV HSE', departemen: 'HSE' }] })],
    ['FROM leave_policy_versions', async () => ({ rows: [{ id: 'policy-cycle', work_days: 56,
      leave_days: 14, version_no: 3, annual_days: 12,
      effective_from: '2026-01-01', effective_to: null }] })],
    ['SELECT cycle_no,status,planned_start', async () => ({ rows: [] })],
    ['idempotency_key = ANY', async () => ({ rows: [] })],
    ['SELECT id FROM employee_leave_requests', async () => ({ rows: [] })],
    ['INSERT INTO employee_leave_requests', async (sql, params) => {
      inserts.push(params);
      groupIds.add(params[10]);
      return { rows: [{ id: `req-${params[3]}`, leave_type: params[3],
        planned_start: params[4], planned_end: params[5], cycle_no: params[6],
        application_group_id: params[10], owning_year: params[13] }] };
    }],
    ['INSERT INTO leave_audit_log', async () => ({ rows: [] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  const result = await Cuti.createCycleApplication(pool, SCOPE, USER, {
    user_id: 'user-cycle', owning_year: 2026, cycle_no: 5,
    planned_start: '2026-12-10', ck_reason: 'Pernikahan', ck_days: 3, ct_days: 2,
    idempotency_key: 'cycle-application-1',
  });
  assert.equal(result.deduped, false);
  assert.equal(result.total_start, '2026-12-10');
  assert.equal(result.total_end, '2026-12-28');
  assert.equal(result.total_days, 19);
  assert.equal(inserts.length, 3);
  assert.deepEqual(inserts.map(item => [item[3], item[4], item[5], item[13]]), [
    ['CP', '2026-12-10', '2026-12-23', 2026],
    ['CK', '2026-12-24', '2026-12-26', 2026],
    ['CT', '2026-12-27', '2026-12-28', 2026],
  ]);
  assert.equal(groupIds.size, 1);
  assert.equal(log.filter(item => item.sql === 'BEGIN').length, 1);
  assert.equal(log.filter(item => item.sql === 'COMMIT').length, 1);
});

test('pengajuan siklus gagal seluruhnya bila CK tidak memiliki keterangan', async () => {
  const { pool, log } = fakePool([
    ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-cycle', nama: 'Zulfutra',
      jabatan: 'SPV HSE', departemen: 'HSE' }] })],
    ['FROM leave_policy_versions', async () => ({ rows: [{ id: 'policy-cycle', work_days: 56,
      leave_days: 14, version_no: 3, annual_days: 12,
      effective_from: '2026-01-01', effective_to: null }] })],
    ['SELECT cycle_no,status,planned_start', async () => ({ rows: [] })],
  ]);
  await assert.rejects(Cuti.createCycleApplication(pool, SCOPE, USER, {
    user_id: 'user-cycle', owning_year: 2026, cycle_no: 1,
    planned_start: '2026-02-26', ck_days: 2, ct_days: 0,
    idempotency_key: 'cycle-application-invalid',
  }), /Keterangan cuti khusus wajib/);
  assert.equal(log.some(item => item.sql === 'BEGIN'), false);
  assert.equal(log.some(item => item.sql.includes('INSERT INTO employee_leave_requests')), false);
});

test('approval HR harus memakai aktor berbeda dari approval Atasan', async () => {
  const requestRow = { id: 'req-same', user_id: 'user-5', leave_type: 'CP',
    planned_start: '2026-10-01', planned_end: '2026-10-14',
    status: 'SUPERVISOR_APPROVED', supervisor_by: USER.id };
  const { pool } = fakePool([
    ['SELECT * FROM employee_leave_requests', async () => ({ rows: [requestRow] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);
  await assert.rejects(Cuti.transitionRequest(pool, SCOPE, USER, requestRow.id, 'APPROVED'),
    /pengguna berbeda/);
});

test('Database Cuti menimpa roster generated tetapi menyimpan snapshot dan hasil MATCHED', async () => {
  let updated = 0;
  let snapshotted = 0;
  let reconState = null;
  const { pool } = fakePool([
    ['FROM employee_roster_daily', async () => ({ rows: [{ id: 'rd-generated', status: 'S',
      shift_id: 'shift-1', assignment_id: 'assign-1', source: 'generated', catatan: null }] })],
    ['INSERT INTO leave_roster_snapshots', async () => { snapshotted += 1; return { rows: [] }; }],
    ['UPDATE employee_roster_daily', async () => { updated += 1; return { rows: [] }; }],
    ['INSERT INTO leave_roster_reconciliation', async (sql, params) => { reconState = params[7]; return { rows: [] }; }],
  ]);
  const client = await pool.connect();
  const roster = await Cuti.syncRosterForRequest((sql, params) => client.query(sql, params), SCOPE,
    { id: 'req-generated', user_id: 'user-6', leave_type: 'CP',
      planned_start: '2026-10-20', planned_end: '2026-10-20' }, USER.id);
  assert.deepEqual(roster, { written: 1, skipped: 0 });
  assert.equal(snapshotted, 1);
  assert.equal(updated, 1);
  assert.equal(reconState, 'MATCHED');
});

test('edit pengajuan siklus memperbarui tanggal mulai, CK, dan CT serta mencatat audit', async () => {
  const existingCP = {
    id: 'req-cp-1', application_group_id: 'group-123', user_id: 'user-cycle', leave_type: 'CP',
    planned_start: '2026-02-26', planned_end: '2026-03-11', cycle_no: 1, owning_year: 2026, status: 'DRAFT',
  };
  const existingCK = {
    id: 'req-ck-1', application_group_id: 'group-123', user_id: 'user-cycle', leave_type: 'CK',
    planned_start: '2026-03-12', planned_end: '2026-03-13', cycle_no: 1, owning_year: 2026, status: 'DRAFT',
    reason: 'Urusan keluarga',
  };
  const deletedIds = [];
  const insertedTypes = [];
  const audits = [];
  const { pool, log } = fakePool([
    ['SELECT * FROM employee_leave_requests', async () => ({ rows: [existingCP, existingCK] })],
    ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-cycle', nama: 'Zulfutra', jabatan: 'SPV HSE', departemen: 'HSE' }] })],
    ['FROM leave_policy_versions', async () => ({ rows: [{ id: 'policy-cycle', work_days: 56, leave_days: 14, version_no: 3, annual_days: 12, effective_from: '2026-01-01', effective_to: null }] })],
    ['SELECT cycle_no,status,planned_start', async () => ({ rows: [] })],
    ['SELECT id FROM employee_leave_requests', async () => ({ rows: [] })],
    ['INSERT INTO leave_audit_log', async (sql, params) => { audits.push(params); return { rows: [] }; }],
    ['DELETE FROM employee_leave_requests', async (sql, params) => { deletedIds.push(...params[0]); return { rowCount: params[0].length }; }],
    ['INSERT INTO employee_leave_requests', async (sql, params) => {
      insertedTypes.push({ type: params[3], start: params[4], end: params[5], reason: params[7] });
      return { rows: [{ id: `new-${params[3]}`, application_group_id: params[10], leave_type: params[3], status: 'DRAFT' }] };
    }],
    ['SELECT * FROM employee_leave_entitlements', async () => ({ rows: [] })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);

  const result = await Cuti.updateCycleApplication(pool, SCOPE, USER, 'group-123', {
    owning_year: 2026,
    cycle_no: 1,
    planned_start: '2026-03-01',
    ck_days: 1,
    ck_reason: 'Acara wisuda',
    ct_days: 2,
  });

  assert.equal(result.total_start, '2026-03-01');
  assert.equal(result.total_end, '2026-03-17'); // 14 CP (03-01 sd 03-14) + 1 CK (03-15) + 2 CT (03-16 sd 03-17) = 17 hari
  assert.equal(result.total_days, 17);
  assert.deepEqual(deletedIds, ['req-cp-1', 'req-ck-1']);
  assert.equal(insertedTypes.length, 3);
  assert.deepEqual(insertedTypes.map(item => item.type), ['CP', 'CK', 'CT']);
  assert.equal(log.filter(item => item.sql === 'BEGIN').length, 1);
  assert.equal(log.filter(item => item.sql === 'COMMIT').length, 1);
  assert.ok(audits.length >= 2);
});

test('hapus pengajuan siklus membersihkan permohonan dan memulihkan roster jika APPROVED', async () => {
  const existingCP = {
    id: 'req-cp-app', application_group_id: 'group-del', user_id: 'user-cycle', leave_type: 'CP',
    planned_start: '2026-02-26', planned_end: '2026-03-11', cycle_no: 1, owning_year: 2026, status: 'APPROVED',
  };
  let rosterRestored = 0;
  let deletedRequests = 0;
  let deletedSnapshots = 0;
  const { pool, log } = fakePool([
    ['SELECT * FROM employee_leave_requests', async () => ({ rows: [existingCP] })],
    ['SELECT * FROM leave_roster_snapshots', async () => ({ rows: [{ id: 'snap-1', tanggal: '2026-02-26', previous_exists: true, previous_status: 'P', previous_source: 'generated' }] })],
    ['SELECT id,source,leave_request_id FROM employee_roster_daily', async () => ({ rows: [{ id: 'rd-1', source: 'leave_sync', leave_request_id: 'req-cp-app' }] })],
    ['UPDATE employee_roster_daily', async () => { rosterRestored += 1; return { rowCount: 1 }; }],
    ['UPDATE leave_roster_snapshots', async () => ({ rowCount: 1 })],
    ['INSERT INTO leave_audit_log', async () => ({ rows: [] })],
    ['DELETE FROM leave_roster_reconciliation', async () => ({ rowCount: 1 })],
    ['DELETE FROM leave_roster_snapshots', async () => { deletedSnapshots += 1; return { rowCount: 1 }; }],
    ['DELETE FROM employee_leave_requests', async () => { deletedRequests += 1; return { rowCount: 1 }; }],
    ['FROM users u LEFT JOIN', async () => ({ rows: [{ id: 'user-cycle', nama: 'Zulfutra', jabatan: 'SPV HSE', departemen: 'HSE' }] })],
    ['FROM leave_policy_versions', async () => ({ rows: [{ id: 'policy-cycle', work_days: 56, leave_days: 14, version_no: 3, annual_days: 12, effective_from: '2026-01-01', effective_to: null }] })],
    ['SELECT cycle_no FROM employee_leave_requests', async () => ({ rows: [] })],
    ['INSERT INTO employee_leave_projections', async () => ({ rowCount: 1 })],
    ['BEGIN', async () => ({ rows: [] })],
    ['COMMIT', async () => ({ rows: [] })],
    ['ROLLBACK', async () => ({ rows: [] })],
  ]);

  const result = await Cuti.deleteCycleApplication(pool, SCOPE, USER, 'group-del', 'Dibatalkan oleh user');
  assert.equal(result.success, true);
  assert.equal(result.deleted_count, 1);
  assert.equal(deletedSnapshots, 1);
  assert.equal(deletedRequests, 1);
  assert.equal(rosterRestored, 1);
  assert.equal(log.filter(item => item.sql === 'BEGIN').length, 1);
  assert.equal(log.filter(item => item.sql === 'COMMIT').length, 1);
});

