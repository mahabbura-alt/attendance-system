'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createPeopleDb } = require('./helpers/peopleFixture');
const Workforce = require('../src/services/workforce');

const opt = { skip: !available };
const actor = u => ({ ...u, tenant_id: 'default', project_id: 'default' });

async function seedEmployee(f, { nama = 'Andre Saputra', position = f.positions.operatorDt, dept = f.departments.produksi, status = 'ACTIVE', type = 'PKWT' } = {}) {
  const one = async (s, p) => (await f.db.query(s, p)).rows[0];
  const u = await one(`INSERT INTO users (nama, email, password_hash, role, jabatan, departemen, employee_id)
    VALUES ($1, $2, 'x', 'karyawan', $3, $4, $5) RETURNING id`, [nama, `${nama.split(' ')[0].toLowerCase()}@pim.co.id`, position.name, dept.name, `PIM-${Math.floor(Math.random() * 1e6)}`]);
  const p = await one(`INSERT INTO workforce_employee_profiles (user_id, hire_date, employment_status, employment_type, contract_end_date)
    VALUES ($1, '2024-01-15', $2, $3, '2026-11-05') RETURNING id`, [u.id, status, type]);
  await f.db.query(`INSERT INTO workforce_employee_assignments (employee_profile_id, department_id, position_id, department_snapshot, position_snapshot, site_name, employment_type, effective_from, status)
    VALUES ($1, $2, $3, $4, $5, 'Pit 3', $6, '2024-01-15', 'ACTIVE')`, [p.id, dept.id, position.id, dept.name, position.name, type]);
  return { userId: u.id, profileId: p.id };
}

test('Pergerakan: alasan wajib diisi manual; jabatan tujuan harus dari master; site bebas', opt, async () => {
  const f = await createPeopleDb();
  try {
    const e = await seedEmployee(f);
    const base = { movement_type: 'TRANSFER', employee_id: e.userId, effective_date: '2026-11-01' };
    await assert.rejects(Workforce.createMovement(f.db, actor(f.admin), { ...base, after_state: { position_id: f.positions.foreman.id, site: 'Pit 1' } }),
      err => err.statusCode === 422 && /alasan/i.test(err.message));
    await assert.rejects(Workforce.createMovement(f.db, actor(f.admin), { ...base, reason: 'Kebutuhan Pit 1', after_state: { department: 'Produksi', position: 'Operator DT' } }),
      err => err.statusCode === 422);
    const m = await Workforce.createMovement(f.db, actor(f.admin), { ...base, reason: 'Penguatan pengawasan Pit 1', after_state: { position_id: f.positions.foreman.id, site: 'Pit 1 (sementara)' } });
    assert.equal(m.reason_text, 'Penguatan pengawasan Pit 1');
    assert.equal(m.after_state.position, 'Foreman Produksi');
    assert.equal(m.after_state.department, 'Produksi');
    assert.equal(m.after_state.position_id, f.positions.foreman.id);
    assert.equal(m.after_state.site, 'Pit 1 (sementara)');
    const n = (await f.db.query(`SELECT COUNT(*)::int AS n FROM workforce_positions`)).rows[0].n;
    assert.equal(n, 5, 'tidak ada jabatan baru yang dibuat');
  } finally { await f.db.close(); }
});

test('Pergerakan: pembuat tidak bisa menyetujui sendiri; super admin hanya dengan alasan; perlu izin people.approve', opt, async () => {
  const f = await createPeopleDb();
  try {
    const e = await seedEmployee(f);
    const m = await Workforce.createMovement(f.db, actor(f.approver), { movement_type: 'TRANSFER', employee_id: e.userId, effective_date: '2026-11-01',
      reason: 'Rotasi pit', after_state: { position_id: f.positions.operatorDt.id, site: 'Pit 1' } });
    await Workforce.transitionMovement(f.db, actor(f.approver), m.id, 'SUBMITTED');
    await assert.rejects(Workforce.transitionMovement(f.db, actor(f.approver), m.id, 'APPROVED'), err => err.statusCode === 403);
    const noPerm = (await f.db.query(`INSERT INTO users (nama, email, password_hash, role) VALUES ('Sub Admin','sub@pim.co.id','x','admin') RETURNING id, role, is_super_admin, permissions`)).rows[0];
    await assert.rejects(Workforce.transitionMovement(f.db, actor(noPerm), m.id, 'APPROVED'), err => err.statusCode === 403);
    const ok = await Workforce.transitionMovement(f.db, actor(f.admin), m.id, 'APPROVED', { comment: 'OK' });
    assert.equal(ok.status, 'APPROVED');

    const own = await Workforce.createMovement(f.db, actor(f.admin), { movement_type: 'TRANSFER', employee_id: (await seedEmployee(f, { nama: 'Budi Lain' })).userId,
      effective_date: '2026-11-01', reason: 'Rotasi', after_state: { position_id: f.positions.foreman.id } });
    await Workforce.transitionMovement(f.db, actor(f.admin), own.id, 'SUBMITTED');
    await assert.rejects(Workforce.transitionMovement(f.db, actor(f.admin), own.id, 'APPROVED'), err => err.statusCode === 403 && /alasan/i.test(err.message));
    const self = await Workforce.transitionMovement(f.db, actor(f.admin), own.id, 'APPROVED', { self_approval_reason: 'Admin HR tunggal di site' });
    assert.equal(self.self_approval_reason, 'Admin HR tunggal di site');
  } finally { await f.db.close(); }
});

test('Pergerakan keluar: Notice sampai hari kerja terakhir, akun nonaktif H+1, event outbox tercatat', opt, async () => {
  const f = await createPeopleDb();
  try {
    const e = await seedEmployee(f);
    const m = await Workforce.createMovement(f.db, actor(f.approver), { movement_type: 'RESIGN', employee_id: e.userId,
      last_working_day: '2026-10-20', reason: 'Pindah domisili', rehire_eligible: true });
    assert.equal(m.effective_date instanceof Date ? m.effective_date.toISOString().slice(0, 10) : String(m.effective_date).slice(0, 10), '2026-10-21');
    await Workforce.transitionMovement(f.db, actor(f.approver), m.id, 'SUBMITTED');
    await Workforce.transitionMovement(f.db, actor(f.admin), m.id, 'APPROVED');
    const prof = async () => (await f.db.query(`SELECT employment_status, last_working_day::text AS lwd FROM workforce_employee_profiles WHERE id=$1`, [e.profileId])).rows[0];
    assert.deepEqual(await prof(), { employment_status: 'NOTICE', lwd: '2026-10-20' });
    const active = async () => (await f.db.query(`SELECT is_active FROM users WHERE id=$1`, [e.userId])).rows[0].is_active;

    let results = await Workforce.processDueMovements(f.db, '2026-10-20');
    assert.equal(results.length, 0, 'belum jatuh tempo pada hari kerja terakhir');
    assert.equal(await active(), true);

    results = await Workforce.processDueMovements(f.db, '2026-10-21', { today: '2026-10-21' });
    assert.deepEqual(results.map(r => r.status), ['EFFECTIVE']);
    assert.equal(await active(), false);
    assert.equal((await prof()).employment_status, 'INACTIVE');
    const asg = (await f.db.query(`SELECT effective_to::text AS t, status FROM workforce_employee_assignments WHERE employee_profile_id=$1`, [e.profileId])).rows[0];
    assert.deepEqual(asg, { t: '2026-10-20', status: 'CLOSED' });
    const ev = (await f.db.query(`SELECT event_type, payload->>'last_working_day' AS lwd FROM people_outbox`)).rows;
    assert.deepEqual(ev, [{ event_type: 'EMPLOYEE_EXITED', lwd: '2026-10-20' }]);
  } finally { await f.db.close(); }
});

test('Pergerakan status kerja: lulus probation, perpanjang kontrak, ubah ke PKWTT', opt, async () => {
  const f = await createPeopleDb();
  try {
    const run = async (input, userId) => {
      const m = await Workforce.createMovement(f.db, actor(f.approver), { employee_id: userId, effective_date: '2026-10-01', reason: 'Evaluasi', ...input });
      await Workforce.transitionMovement(f.db, actor(f.approver), m.id, 'SUBMITTED');
      await Workforce.transitionMovement(f.db, actor(f.admin), m.id, 'APPROVED');
      return Workforce.transitionMovement(f.db, actor(f.admin), m.id, 'EFFECTIVE', {}, { today: '2026-10-12' });
    };
    const prof = async id => (await f.db.query(`SELECT employment_status, employment_type, contract_end_date::text AS ced, contract_no FROM workforce_employee_profiles WHERE id=$1`, [id])).rows[0];

    const siti = await seedEmployee(f, { nama: 'Siti Rahma', status: 'PROBATION' });
    await assert.rejects(Workforce.createMovement(f.db, actor(f.approver), { employee_id: siti.userId, movement_type: 'CONFIRMATION', effective_date: '2026-10-01', reason: 'Hasil evaluasi', evaluation_result: 'FAILED' }),
      err => err.statusCode === 422 && /Terminasi/.test(err.message));
    await run({ movement_type: 'CONFIRMATION', evaluation_result: 'PASSED' }, siti.userId);
    assert.equal((await prof(siti.profileId)).employment_status, 'ACTIVE');

    const hendra = await seedEmployee(f, { nama: 'Hendra Gunawan' });
    await assert.rejects(Workforce.createMovement(f.db, actor(f.approver), { employee_id: hendra.userId, movement_type: 'CONTRACT_RENEWAL', effective_date: '2026-10-01', reason: 'Hasil evaluasi' }), err => err.statusCode === 422);
    await run({ movement_type: 'CONTRACT_RENEWAL', contract_no: 'PKWT/PIM/2026/1187', contract_start_date: '2026-11-06', contract_end_date: '2027-11-05' }, hendra.userId);
    assert.deepEqual(await prof(hendra.profileId), { employment_status: 'ACTIVE', employment_type: 'PKWT', ced: '2027-11-05', contract_no: 'PKWT/PIM/2026/1187' });

    const budi = await seedEmployee(f, { nama: 'Budi Hartono' });
    await run({ movement_type: 'EMPLOYMENT_TYPE_CHANGE', after_state: { employment_type: 'PKWTT' } }, budi.userId);
    const b = await prof(budi.profileId);
    assert.equal(b.employment_type, 'PKWTT');
    assert.equal(b.ced, null);
  } finally { await f.db.close(); }
});

test('Pergerakan penempatan tanpa perubahan apa pun ditolak', opt, async () => {
  const f = await createPeopleDb();
  try {
    const e = await seedEmployee(f);
    await assert.rejects(Workforce.createMovement(f.db, actor(f.admin), { movement_type: 'TRANSFER', employee_id: e.userId, effective_date: '2026-11-01',
      reason: 'Rotasi', after_state: { position_id: f.positions.operatorDt.id } }), err => err.statusCode === 422 && /Tidak ada perubahan/.test(err.message));
    const ok = await Workforce.createMovement(f.db, actor(f.admin), { movement_type: 'TRANSFER', employee_id: e.userId, effective_date: '2026-11-01',
      reason: 'Rotasi pit', after_state: { position_id: f.positions.operatorDt.id, site: 'Pit 1' } });
    assert.equal(ok.after_state.site, 'Pit 1');
  } finally { await f.db.close(); }
});
