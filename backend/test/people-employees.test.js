'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createPeopleDb } = require('./helpers/peopleFixture');
const People = require('../src/services/peopleEmployees');

const opt = { skip: !available };

test('NRP: pola token {YY}{MM}{YYYY}{SEQn}', () => {
  assert.equal(People.formatNrp('PIM-{YY}{MM}-{SEQ4}', { date: '2026-10-19', seq: 132 }), 'PIM-2610-0132');
  assert.equal(People.formatNrp('{YYYY}/{SEQ5}', { date: '2027-01-02', seq: 7 }), '2027/00007');
  assert.throws(() => People.formatNrp('PIM-{YY}', { date: '2026-10-19', seq: 1 }), /SEQ/);
});

test('Kelengkapan data: 10 butir, yang kurang disebutkan', () => {
  const r = People.completeness({ nrp: 'X', nik: '6310000000000001', phone: '08', birth_date: '1990-01-01', address: 'a',
    blood_type: 'O', emergency_contact_name: 'Sri', has_face: true, has_cv: false, marital_status: null });
  assert.equal(r.percent, 80);
  assert.deepEqual(r.missing, ['CV', 'Data keluarga']);
});

function base(f, extra = {}) {
  return {
    nama: 'Rizky Ananda', email: 'rizky@pim.co.id', nik: '6310000000002231', phone: '0821-5530-1189',
    birth_date: '1998-05-21', blood_type: 'O', position_id: f.positions.operatorDt.id, hire_date: '2026-10-19',
    employment_type: 'PKWT', contract_end_date: '2027-10-18', site: 'Pit 3', lokasi_ids: [f.lokasi.pit3.id, f.lokasi.pit1.id],
    ...extra,
  };
}

test('Tambah karyawan: NRP otomatis, Masuk tercatat, probation default, lokasi utama = pertama', opt, async () => {
  const f = await createPeopleDb();
  try {
    const r = await People.createEmployee(f.db, f.scope, f.admin, base(f), { today: '2026-10-12' });
    assert.equal(r.nrp, 'PIM-2610-0001');
    const p = await People.getProfile(f.db, f.scope, r.user_id, { today: '2026-10-12' });
    assert.equal(p.employee.nama, 'Rizky Ananda');
    assert.equal(p.employee.jabatan, 'Operator Dump Truck');
    assert.equal(p.employee.departemen, 'Produksi');
    assert.equal(p.employee.employment_status, 'PROBATION');
    assert.equal(p.employee.probation_end_date, '2027-01-19');
    assert.equal(p.personal.nik_masked, '6310••••••••2231');
    assert.equal(p.personal.nik, undefined, 'NIK lengkap tidak dikirim di profil');
    assert.deepEqual(p.locations.map(l => [l.nama_lokasi, l.is_primary]), [['Pos Pit 3', true], ['Pos Pit 1', false]]);
    assert.equal(p.history[0].movement_type, 'HIRE');
    const user = (await f.db.query(`SELECT employee_id, lokasi_kantor_id, role FROM users WHERE id=$1`, [r.user_id])).rows[0];
    assert.deepEqual(user, { employee_id: 'PIM-2610-0001', lokasi_kantor_id: f.lokasi.pit3.id, role: 'karyawan' });
    const r2 = await People.createEmployee(f.db, f.scope, f.admin, base(f, { email: 'b@pim.co.id', nik: null, nama: 'Budi' }), { today: '2026-10-12' });
    assert.equal(r2.nrp, 'PIM-2610-0002');
  } finally { await f.db.close(); }
});

test('Tambah karyawan: karyawan lama (probation sudah lewat) langsung Aktif', opt, async () => {
  const f = await createPeopleDb();
  try {
    const r = await People.createEmployee(f.db, f.scope, f.admin, base(f, { hire_date: '2023-01-02', employment_type: 'PKWTT', contract_end_date: null }), { today: '2026-10-12' });
    const p = await People.getProfile(f.db, f.scope, r.user_id, { today: '2026-10-12' });
    assert.equal(p.employee.employment_status, 'ACTIVE');
  } finally { await f.db.close(); }
});

test('Tambah karyawan: validasi — PKWT wajib akhir kontrak, lokasi ≥1, email/NIK/NRP ganda, jabatan di luar master', opt, async () => {
  const f = await createPeopleDb();
  try {
    const c = (x) => People.createEmployee(f.db, f.scope, f.admin, base(f, x), { today: '2026-10-12' });
    await assert.rejects(c({ contract_end_date: null }), e => e.statusCode === 422 && /kontrak/i.test(e.message));
    await assert.rejects(c({ lokasi_ids: [] }), e => e.statusCode === 422 && /lokasi/i.test(e.message));
    await assert.rejects(c({ nik: '123' }), e => e.statusCode === 422);
    await assert.rejects(c({ position_id: null, department: 'Produksi', position: 'Operator DT' }), e => e.statusCode === 422);
    await c({});
    await assert.rejects(c({ nik: '6310000000009999' }), e => e.statusCode === 409 && /email/i.test(e.message));
    await assert.rejects(c({ email: 'lain@pim.co.id' }), e => e.statusCode === 409 && /NIK/.test(e.message));
    await assert.rejects(c({ email: 'lain2@pim.co.id', nik: null, nrp: 'pim-2610-0001' }), e => e.statusCode === 409 && /NRP/.test(e.message));
    const users = (await f.db.query(`SELECT COUNT(*)::int AS n FROM users WHERE role='karyawan'`)).rows[0].n;
    assert.equal(users, 1, 'percobaan gagal tidak meninggalkan data');
  } finally { await f.db.close(); }
});

test('Direktori: status, filter departemen/jabatan, dan kelengkapan data', opt, async () => {
  const f = await createPeopleDb();
  try {
    await People.createEmployee(f.db, f.scope, f.admin, base(f), { today: '2026-10-12' });
    await People.createEmployee(f.db, f.scope, f.admin, base(f, { nama: 'Dewi', email: 'dewi@pim.co.id', nik: null, position_id: f.positions.adminLog.id,
      hire_date: '2025-02-10', employment_type: 'PKWTT', contract_end_date: null }), { today: '2026-10-12' });
    const all = await People.getDirectory(f.db, f.scope, { today: '2026-10-12' });
    assert.equal(all.rows.length, 2);
    assert.deepEqual(all.summary, { active: 2, probation: 1, notice: 0, ending_soon: 0, incomplete: 2, exited: 0, total: 2 });
    const log = await People.getDirectory(f.db, f.scope, { department_ids: [f.departments.logistik.id], today: '2026-10-12' });
    assert.deepEqual(log.rows.map(r => r.nama), ['Dewi']);
    const rizky = all.rows.find(r => r.nama === 'Rizky Ananda');
    assert.equal(rizky.completeness.percent, 50);
    assert.ok(rizky.completeness.missing.includes('Alamat'));
    assert.ok(rizky.completeness.missing.includes('Foto wajah'));
  } finally { await f.db.close(); }
});

test('Data pribadi: ubah NIK wajib alasan, audit per kolom (NIK tersamar), tampilkan NIK tercatat', opt, async () => {
  const f = await createPeopleDb();
  try {
    const r = await People.createEmployee(f.db, f.scope, f.admin, base(f), { today: '2026-10-12' });
    await assert.rejects(People.updatePersonal(f.db, f.scope, f.admin, r.user_id, { nik: '6310000000005555' }), e => e.statusCode === 422 && /alasan/i.test(e.message));
    await People.updatePersonal(f.db, f.scope, f.admin, r.user_id, { nik: '6310000000005555', phone: '0812-0000-1111', reason: 'Salah ketik saat input' });
    const nik = await People.revealNik(f.db, f.scope, f.admin, r.user_id);
    assert.equal(nik, '6310000000005555');
    const p = await People.getProfile(f.db, f.scope, r.user_id, { today: '2026-10-12' });
    const nikAudit = p.audit.find(a => a.field === 'nik' && a.entity === 'PERSONAL');
    assert.equal(nikAudit.old_value, '6310••••••••2231');
    assert.equal(nikAudit.new_value, '6310••••••••5555');
    assert.equal(nikAudit.reason, 'Salah ketik saat input');
    assert.ok(p.audit.find(a => a.field === 'nik' && a.entity === 'ACCOUNT' && /Tampilkan/.test(a.reason || '')));
  } finally { await f.db.close(); }
});

test('Lokasi absen: daftar lokasi membatasi; mode Semua lokasi mengosongkan batas', opt, async () => {
  const f = await createPeopleDb();
  try {
    const r = await People.createEmployee(f.db, f.scope, f.admin, base(f), { today: '2026-10-12' });
    let allowed = await People.getAllowedLocations(f.db, r.user_id);
    assert.deepEqual(allowed.map(l => l.nama_lokasi).sort(), ['Pos Pit 1', 'Pos Pit 3']);
    await People.setAttendanceLocations(f.db, f.scope, f.admin, r.user_id, { mode: 'ALL' });
    allowed = await People.getAllowedLocations(f.db, r.user_id);
    assert.equal(allowed, null, 'null = semua lokasi');
    await assert.rejects(People.setAttendanceLocations(f.db, f.scope, f.admin, r.user_id, { mode: 'ASSIGNED', lokasi_ids: [] }), e => e.statusCode === 422);
  } finally { await f.db.close(); }
});

test('Keluarga: opsional, tanggungan & PTKP dari anggota', opt, async () => {
  const f = await createPeopleDb();
  try {
    const r = await People.createEmployee(f.db, f.scope, f.admin, base(f), { today: '2026-10-12' });
    let fam = await People.getFamily(f.db, f.scope, r.user_id);
    assert.equal(fam.summary, null);
    fam = await People.saveFamily(f.db, f.scope, f.admin, r.user_id, { marital_status: 'MARRIED', reason: 'Data awal', members: [
      { full_name: 'Sri', relationship: 'SPOUSE', is_dependent: true },
      { full_name: 'Rafa', relationship: 'CHILD', is_dependent: true, birth_date: '2017-09-11' },
      { full_name: 'Adik', relationship: 'SIBLING', is_dependent: true },
      { full_name: '  ', relationship: 'CHILD' },
    ] });
    assert.equal(fam.members.length, 3, 'baris tanpa nama diabaikan');
    assert.deepEqual([fam.summary.dependent_count, fam.summary.ptkp_estimate], [3, 'K/1']);
    fam = await People.saveFamily(f.db, f.scope, f.admin, r.user_id, { marital_status: 'MARRIED', members: fam.members.filter(m => m.relationship !== 'SIBLING') });
    assert.equal(fam.members.length, 2);
  } finally { await f.db.close(); }
});

test('Void: ditolak bila sudah ada absensi; bila belum, akun nonaktif & email bisa dipakai ulang', opt, async () => {
  const f = await createPeopleDb();
  try {
    const a = await People.createEmployee(f.db, f.scope, f.admin, base(f), { today: '2026-10-12' });
    await assert.rejects(People.voidEmployee(f.db, f.scope, f.admin, a.user_id, {}), e => e.statusCode === 422);
    const res = await People.voidEmployee(f.db, f.scope, f.admin, a.user_id, { reason: 'Salah input, data ganda' }, { today: '2026-10-12' });
    assert.match(res.email, /^rizky\+void-20261012-[0-9a-f]{6}@pim\.co\.id$/);
    const again = await People.createEmployee(f.db, f.scope, f.admin, base(f, { nik: '6310000000002232' }), { today: '2026-10-12' });
    assert.ok(again.user_id);
    const dir = await People.getDirectory(f.db, f.scope, { today: '2026-10-12', status: 'ALL' });
    assert.equal(dir.rows.length, 1, 'karyawan Void tidak tampil di direktori');

    const shift = (await f.db.query(`SELECT id FROM shifts LIMIT 1`)).rows[0]?.id
      || (await f.db.query(`INSERT INTO shifts (nama_shift, jam_masuk_maks, jam_pulang_min, operational_start, operational_end) VALUES ('S','06:10','18:00','06:00','18:00') RETURNING id`)).rows[0].id;
    await f.db.query(`INSERT INTO absensi (user_id, shift_id, tanggal_kerja, waktu_datang) VALUES ($1, $2, '2026-10-12', now())`, [again.user_id, shift]);
    await assert.rejects(People.voidEmployee(f.db, f.scope, f.admin, again.user_id, { reason: 'coba void' }), e => e.statusCode === 409 && /absensi/i.test(e.message));
  } finally { await f.db.close(); }
});
