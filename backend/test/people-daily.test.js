'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createPeopleDb } = require('./helpers/peopleFixture');
const People = require('../src/services/peopleEmployees');
const Workforce = require('../src/services/workforce');
const Daily = require('../src/services/peopleDaily');

const opt = { skip: !available };
const actor = u => ({ ...u, tenant_id: 'default', project_id: 'default' });
const TODAY = '2026-10-12';

async function add(f, nama, extra = {}) {
  return People.createEmployee(f.db, f.scope, f.admin, {
    nama, email: `${nama.toLowerCase().replace(/\s+/g, '.')}@pim.co.id`, position_id: f.positions.operatorDt.id,
    hire_date: '2024-01-15', employment_type: 'PKWTT', lokasi_ids: [f.lokasi.pit3.id], ...extra,
  }, { today: TODAY });
}

test('Pengingat: kontrak ≤60 hari, probation ≤30 hari, dokumen kedaluwarsa, masa pemberitahuan', opt, async () => {
  const f = await createPeopleDb();
  try {
    await add(f, 'Kontrak Dekat', { employment_type: 'PKWT', contract_end_date: '2026-11-05' });
    await add(f, 'Kontrak Jauh', { employment_type: 'PKWT', contract_end_date: '2027-06-01' });
    await add(f, 'Kontrak Lewat', { employment_type: 'PKWT', contract_end_date: '2026-10-01' });
    await add(f, 'Baru Masuk', { hire_date: '2026-07-20' }); // probation s/d 2026-10-20
    const doc = await add(f, 'Punya SIO');
    const { profileId } = await People.profileFor(f.db, f.scope, doc.user_id);
    await f.db.query(`INSERT INTO employee_documents (employee_profile_id, doc_type, title, expiry_date, storage_key, original_filename, size_bytes, sha256)
      VALUES ($1, 'COMPETENCY', 'SIO DT', '2026-11-30', 'people/x.pdf', 'sio.pdf', 10, repeat('a', 64))`, [profileId]);

    const r = await Daily.getReminders(f.db, f.scope, { today: TODAY });
    const by = kind => r.items.filter(i => i.kind === kind).map(i => i.nama);
    assert.deepEqual(by('CONTRACT_END'), ['Kontrak Lewat', 'Kontrak Dekat']);
    assert.equal(r.items.find(i => i.nama === 'Kontrak Lewat').severity, 'OVERDUE');
    assert.deepEqual(by('PROBATION_END'), ['Baru Masuk']);
    assert.equal(r.items.find(i => i.kind === 'PROBATION_END').days, 8);
    assert.deepEqual(by('DOCUMENT_EXPIRY'), ['Punya SIO']);
    assert.equal(r.items[0].nama, 'Kontrak Lewat', 'yang lewat tanggal di atas');

    // Pengajuan perpanjangan kontrak yang sedang berjalan menghapus pengingatnya.
    const dekat = (await People.getDirectory(f.db, f.scope, { q: 'Kontrak Dekat', today: TODAY })).rows[0];
    await Workforce.createMovement(f.db, actor(f.admin), { movement_type: 'CONTRACT_RENEWAL', employee_id: dekat.id,
      effective_date: '2026-11-06', contract_end_date: '2027-11-05', reason: 'Kinerja baik' });
    const r2 = await Daily.getReminders(f.db, f.scope, { today: TODAY });
    assert.deepEqual(r2.items.filter(i => i.kind === 'CONTRACT_END').map(i => i.nama), ['Kontrak Lewat']);
  } finally { await f.db.close(); }
});

test('Harian: resign efektif L+1 → outbox EMPLOYEE_EXITED diproses sekali (idempoten)', opt, async () => {
  const f = await createPeopleDb();
  try {
    const e = await add(f, 'Andre Saputra');
    const m = await Workforce.createMovement(f.db, actor(f.approver), { movement_type: 'RESIGN', employee_id: e.user_id,
      last_working_day: '2026-10-20', reason: 'Pindah domisili' });
    await Workforce.transitionMovement(f.db, actor(f.approver), m.id, 'SUBMITTED');
    await Workforce.transitionMovement(f.db, actor(f.admin), m.id, 'APPROVED', { comment: 'OK' });

    const notice = await Daily.getReminders(f.db, f.scope, { today: TODAY });
    const n = notice.items.find(i => i.kind === 'NOTICE');
    assert.equal(n.date, '2026-10-20');
    assert.ok(n.open_tasks > 0, 'tugas offboarding terhitung');

    const run1 = await Daily.runDaily(f.db, { today: '2026-10-21' });
    assert.equal(run1.movements.processed, 1);
    assert.equal(run1.movements.failed, 0);
    const exited = run1.outbox.results.find(r => r.event_type === 'EMPLOYEE_EXITED');
    assert.equal(exited.status, 'DONE');
    const run2 = await Daily.runDaily(f.db, { today: '2026-10-22' });
    assert.equal(run2.outbox.processed, 0);
    const u = (await f.db.query(`SELECT is_active FROM users WHERE id = $1`, [e.user_id])).rows[0];
    assert.equal(u.is_active, false);
  } finally { await f.db.close(); }
});

test('Outbox EMPLOYEE_EXITED: roster setelah hari terakhir dihapus, penugasan roster ditutup', opt, async () => {
  const f = await createPeopleDb();
  try {
    const e = await add(f, 'Roster Orang');
    await f.db.exec(`CREATE TABLE employee_roster_assignments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
        effective_from DATE NOT NULL, effective_to DATE, is_active BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE employee_roster_daily (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, tanggal DATE NOT NULL);`);
    await f.db.query(`INSERT INTO employee_roster_assignments (user_id, effective_from) VALUES ($1, '2026-01-01'), ($1, '2026-12-01')`, [e.user_id]);
    await f.db.query(`INSERT INTO employee_roster_daily (user_id, tanggal) SELECT $1, d::date FROM generate_series('2026-10-18'::date, '2026-10-25', '1 day') d`, [e.user_id]);
    const out = await Daily.HANDLERS.EMPLOYEE_EXITED(f.db, { payload: { user_id: e.user_id, last_working_day: '2026-10-20' } });
    assert.deepEqual(out, { roster_days_removed: 5, roster_assignments_closed: 2 });
    const left = (await f.db.query(`SELECT MAX(tanggal)::text AS d FROM employee_roster_daily`)).rows[0].d;
    assert.equal(left, '2026-10-20');
    const a = (await f.db.query(`SELECT effective_to::text AS t, is_active FROM employee_roster_assignments ORDER BY effective_from`)).rows;
    assert.deepEqual(a, [{ t: '2026-10-20', is_active: true }, { t: null, is_active: false }]);
  } finally { await f.db.close(); }
});

test('Daftar pergerakan per status (tanpa batas periode) + hitungan', opt, async () => {
  const Movements = require('../src/services/peopleMovements');
  const f = await createPeopleDb();
  try {
    const e = await add(f, 'Andre Saputra');
    const m = await Workforce.createMovement(f.db, actor(f.approver), { movement_type: 'RESIGN', employee_id: e.user_id,
      last_working_day: '2027-03-20', reason: 'Pindah domisili' });
    let r = await Movements.listMovements(f.db, f.scope, { view: 'draft', today: TODAY });
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].group, 'KELUAR');
    assert.equal(r.rows[0].created_by_name, 'Approver HR');
    await Workforce.transitionMovement(f.db, actor(f.approver), m.id, 'SUBMITTED');
    r = await Movements.listMovements(f.db, f.scope, { view: 'approval', group: 'KELUAR', today: TODAY });
    assert.equal(r.rows.length, 1, 'efektif 2027 tetap tampil di Menunggu persetujuan');
    assert.equal(r.counts.approval, 1);
    r = await Movements.listMovements(f.db, f.scope, { view: 'riwayat', today: '2024-01-20' });
    assert.equal(r.rows.length, 1, 'HIRE efektif ada di riwayat');
    assert.equal(r.counts.masuk_bulan_ini, 1);
  } finally { await f.db.close(); }
});
