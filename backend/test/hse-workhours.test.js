'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/services/hseWorkhours');

const scope = { tenantKey: 'default', projectKey: 'default' };

test('HSE workhours buildRecap: hari hadir × jam per hari yang berlaku (contoh Andre 4 × 8 = 32)', () => {
  const employees = [
    { id: 'andre', nama: 'Andre Saputra', employee_id: '10231', jabatan: 'Admin site', departemen: 'Office', is_active: true, created_date: '2026-01-01' },
    { id: 'rudi', nama: 'Rudi Hartono', employee_id: '10088', jabatan: 'Mekanik', departemen: 'Plant', is_active: true, created_date: '2026-01-01' },
    { id: 'wawan', nama: 'Wawan Setiawan', employee_id: '10266', jabatan: 'Driver LV', departemen: 'GA', is_active: true, created_date: '2026-01-01' },
    { id: 'joko', nama: 'Joko Susilo', employee_id: '10077', jabatan: 'Operator DT', departemen: 'Produksi', is_active: false, created_date: '2026-01-01' },
    { id: 'old', nama: 'Nonaktif Tanpa Hadir', jabatan: 'X', is_active: false, created_date: '2026-01-01' },
  ];
  const p = (user_id, work_date, hours, type = 'BY_ROLE') => ({ user_id, work_date, rule_id: hours == null ? null : 'r', hours_per_day: hours == null ? null : String(hours), target_type: hours == null ? null : type });
  const presentRows = [
    ...['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05'].map(d => p('andre', d, 8)),
    p('rudi', '2026-10-01', 10), p('rudi', '2026-10-02', 10), p('rudi', '2026-10-03', 10),
    p('rudi', '2026-10-05', 8, 'BY_EMPLOYEE'), p('rudi', '2026-10-06', 8, 'BY_EMPLOYEE'),
    p('wawan', '2026-10-01', null), p('wawan', '2026-10-02', null),
    p('joko', '2026-10-01', 11), p('joko', '2026-10-02', 11),
  ];
  const manualMap = new Map([['andre_2026-10-03', 'off'], ['andre_2026-10-06', 'sakit']]);
  const { items, summary } = W.buildRecap({ employees, presentRows, manualMap, from: '2026-10-01', to: '2026-10-06', today: '2026-10-12', withDays: true });

  const andre = items.find(i => i.employee_id === 'andre');
  assert.equal(andre.present_days, 4);
  assert.equal(andre.counted_hours, 32);
  assert.equal(andre.status, 'COUNTED');
  assert.equal(andre.absent_days, 1); // sakit 06 Okt; OFF 03 Okt bukan tidak hadir
  assert.equal(andre.days.find(d => d.date === '2026-10-03').label, 'OFF');

  const rudi = items.find(i => i.employee_id === 'rudi');
  assert.equal(rudi.counted_hours, 46); // 3 × 10 + 2 × 8
  assert.equal(rudi.status, 'MIXED');
  assert.deepEqual(rudi.breakdown.map(b => [b.hours, b.days]), [[10, 3], [8, 2]]);

  const wawan = items.find(i => i.employee_id === 'wawan');
  assert.equal(wawan.status, 'NOT_SET');
  assert.equal(wawan.counted_hours, 0);
  assert.equal(wawan.uncounted_days, 2);

  const joko = items.find(i => i.employee_id === 'joko');
  assert.equal(joko.counted_hours, 22); // nonaktif tetap dihitung untuk hari hadirnya
  assert.equal(joko.absent_days, 0);
  assert.ok(!items.find(i => i.employee_id === 'old'));

  assert.equal(summary.total_hours, 32 + 46 + 22);
  assert.equal(summary.uncounted_days, 2);
  assert.equal(summary.uncounted_employees, 1);
  assert.equal(summary.inactive_employees, 1);
});

test('HSE workhours helpers: frequency rate, month keys, internal company, master mapping', () => {
  assert.equal(W.frequencyRate(1, 200000), 5);
  assert.equal(W.frequencyRate(1, 0), null);
  assert.equal(W.frequencyRate(0, 100000), 0);
  assert.deepEqual(W.lastMonthKeys('2026-02-15', 3), ['2026-02', '2026-01', '2025-12']);
  assert.equal(W.monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(W.monthLabel('2026-10'), 'Okt 2026');
  assert.ok(W.isInternalCompany('PT internal'));
  assert.ok(W.isInternalCompany(''));
  assert.ok(!W.isInternalCompany('CV Maju'));

  const positions = [
    { id: 'p1', name: 'Mekanik', department_id: 'd1' },
    { id: 'p2', name: 'Mekanik', department_id: 'd2' },
  ];
  const departments = [{ id: 'd1', name: 'Plant' }, { id: 'd2', name: 'Workshop' }];
  assert.deepEqual(W.mapEmployeeToMaster({ jabatan: ' mekanik ', departemen: 'Workshop' }, positions, departments), { position_id: 'p2', department_id: 'd2' });
  assert.deepEqual(W.mapEmployeeToMaster({ jabatan: 'Tidak ada', departemen: 'Plant' }, positions, departments), { position_id: null, department_id: 'd1' });
  // Jabatan bernama sama di departemen lain tidak boleh dipinjam.
  assert.deepEqual(W.mapEmployeeToMaster({ jabatan: 'Mekanik', departemen: 'Gudang' }, positions, departments), { position_id: null, department_id: null });
  // Tanpa departemen: hanya dipetakan bila nama jabatan unik.
  assert.deepEqual(W.mapEmployeeToMaster({ jabatan: 'Mekanik', departemen: '' }, positions, departments), { position_id: null, department_id: null });
  assert.deepEqual(W.mapEmployeeToMaster({ jabatan: 'Welder', departemen: '' }, [...positions, { id: 'p3', name: 'Welder', department_id: 'd2' }], departments), { position_id: 'p3', department_id: null });
});

test('HSE workhours saveRoleStandards validates input before touching data', async () => {
  const db = { query: async () => ({ rows: [] }) };
  const user = { id: 'admin' };
  await assert.rejects(() => W.saveRoleStandards(db, scope, user, {}), /minimal satu jabatan/);
  await assert.rejects(() => W.saveRoleStandards(db, scope, user, { position_ids: ['p'], department_ids: ['d'], employee_ids: ['e'], hours_per_day: 0, effective_from: '2026-10-01' }), /lebih dari 0/);
  await assert.rejects(() => W.saveRoleStandards(db, scope, user, { position_ids: ['p'], department_ids: ['d'], employee_ids: ['e'], hours_per_day: 25, effective_from: '2026-10-01' }), /paling banyak 24/);
  await assert.rejects(() => W.saveRoleStandards(db, scope, user, { position_ids: ['p'], department_ids: ['d'], employee_ids: ['e'], hours_per_day: 8, effective_from: '2026-13-01' }), /Tanggal berlaku/);
});

test('HSE workhours saveEmployeeOverrides requires reason and blocks locked periods', async () => {
  const user = { id: 'admin' };
  const base = { employee_ids: ['e1'], hours_per_day: 8, effective_from: '2026-09-15' };
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(() => W.saveEmployeeOverrides(db, scope, user, base), /Alasan wajib/);
  await assert.rejects(() => W.saveEmployeeOverrides(db, scope, user, { ...base, reason_code: 'BEBAS' }), /tidak dikenal/);
  const lockedDb = {
    query: async sql => (sql.includes('FROM hse_workhour_periods') ? { rows: [{ month_key: '2026-09' }] } : { rows: [] }),
  };
  await assert.rejects(
    () => W.saveEmployeeOverrides(lockedDb, scope, user, { ...base, reason_code: 'PENUGASAN_KHUSUS' }),
    err => err.statusCode === 409 && /Sep 2026 sudah dikirim/.test(err.message),
  );
});

test('HSE workhours getMonthlyManhours: FINAL vs live vs manual lama vs kosong', async () => {
  const keys = W.lastMonthKeys(W.todayWib(), 4);
  const [cur, m1, m2, m3] = keys;
  const db = {
    query: async sql => {
      if (sql.includes('FROM hse_manhours m')) {
        return { rows: [
          { month_key: m1, attendance_hours: '5000', internal_manual_hours: '0', contractor_hours: '300' },
          { month_key: m2, attendance_hours: '0', internal_manual_hours: '240000', contractor_hours: '0' },
          { month_key: m3, attendance_hours: '0', internal_manual_hours: '0', contractor_hours: '0' },
        ] };
      }
      if (sql.includes('FROM hse_workhour_periods')) return { rows: [{ month_key: m1 }] };
      if (sql.includes('FROM present_hours')) return { rows: [{ month_key: cur, hours: '800', present_days: 80, uncounted_days: 2, employee_count: 10 }] };
      return { rows: [] };
    },
  };
  const map = await W.getMonthlyManhours(db, scope, keys);
  assert.deepEqual(map.get(cur), { hours: 800, internalHours: 800, contractorHours: 0, uncountedDays: 2, status: 'BERJALAN' });
  assert.equal(map.get(m1).status, 'FINAL');
  assert.equal(map.get(m1).hours, 5300);
  assert.equal(map.get(m2).status, 'MANUAL_LAMA');
  assert.equal(map.get(m3).status, 'KOSONG');
});

test('HSE workhours sendWorkhourPeriod rejects running month and unconfirmed uncounted days', async () => {
  const user = { id: 'admin' };
  const curMonth = W.todayWib().slice(0, 7);
  const emptyDb = { query: async () => ({ rows: [] }) };
  await assert.rejects(() => W.sendWorkhourPeriod(emptyDb, scope, user, curMonth), err => err.statusCode === 422 && /belum berakhir/.test(err.message));

  const prevMonth = W.lastMonthKeys(W.todayWib(), 2)[1];
  const day = `${prevMonth}-10`;
  const db = {
    query: async sql => {
      if (sql.includes('FROM users u') && sql.includes("u.role = 'karyawan'")) {
        return { rows: [{ id: 'e1', nama: 'Wawan', jabatan: 'Driver LV', departemen: 'GA', is_active: true, created_date: '2026-01-01' }] };
      }
      if (sql.includes('FROM present_hours')) return { rows: [{ user_id: 'e1', work_date: day, rule_id: null, hours_per_day: null, target_type: null }] };
      return { rows: [] };
    },
  };
  await assert.rejects(() => W.sendWorkhourPeriod(db, scope, user, prevMonth, {}), err => err.statusCode === 422 && err.code === 'UNCOUNTED_DAYS');
  await assert.rejects(() => W.sendWorkhourPeriod(db, scope, user, prevMonth, { acknowledge_uncounted: true }), /Catatan wajib/);
});
