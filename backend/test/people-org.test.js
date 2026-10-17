'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createPeopleDb } = require('./helpers/peopleFixture');
const Org = require('../src/services/peopleOrg');

const opt = { skip: !available };

test('Master: + Departemen dengan jabatan awal; nama ganda (beda huruf/spasi) ditolak', opt, async () => {
  const f = await createPeopleDb();
  try {
    const created = await Org.createDepartment(f.db, f.scope, f.admin, { name: '  Plant  ', positions: ['Mekanik', ' mekanik ', 'Welder'] });
    assert.equal(created.department.name, 'Plant');
    assert.deepEqual(created.department.positions.map(p => p.name).sort(), ['Mekanik', 'Welder']);
    await assert.rejects(Org.createDepartment(f.db, f.scope, f.admin, { name: 'plant' }), e => e.statusCode === 409);
    await assert.rejects(Org.createDepartment(f.db, f.scope, f.admin, { name: '   ' }), e => e.statusCode === 422);

    const org = await Org.listOrg(f.db, f.scope);
    assert.ok(org.departments.find(d => d.name === 'Plant'));
    assert.ok(org.master_version > 1, 'versi master naik setiap master berubah');
  } finally { await f.db.close(); }
});

test('Master: + Jabatan unik per departemen; "Admin" boleh ada di dua departemen', opt, async () => {
  const f = await createPeopleDb();
  try {
    const p = await Org.createPosition(f.db, f.scope, f.admin, { department_id: f.departments.produksi.id, name: 'Admin' });
    assert.equal(p.position.name, 'Admin');
    await assert.rejects(Org.createPosition(f.db, f.scope, f.admin, { department_id: f.departments.produksi.id, name: 'ADMIN' }), e => e.statusCode === 409);
    await assert.rejects(Org.createPosition(f.db, f.scope, f.admin, { department_id: '00000000-0000-0000-0000-000000000000', name: 'X' }), e => e.statusCode === 422);
  } finally { await f.db.close(); }
});

test('Master: ganti nama jabatan ikut memperbarui salinan teks karyawan pemegangnya saja', opt, async () => {
  const f = await createPeopleDb();
  try {
    const mk = async (nama, jabatan, departemen) => (await f.db.query(`INSERT INTO users (nama, email, password_hash, role, jabatan, departemen)
      VALUES ($1, $4, 'x', 'karyawan', $2, $3) RETURNING id`, [nama, jabatan, departemen, `${nama}@x.id`])).rows[0].id;
    const rina = await mk('rina', 'Admin', 'Engineering');
    const budi = await mk('budi', 'Admin', 'Logistik');
    const res = await Org.updatePosition(f.db, f.scope, f.admin, f.positions.adminEng.id, { name: 'Admin Engineering' });
    assert.equal(res.position.name, 'Admin Engineering');
    assert.equal(res.updated_employees, 1);
    const jab = async id => (await f.db.query(`SELECT jabatan FROM users WHERE id=$1`, [id])).rows[0].jabatan;
    assert.equal(await jab(rina), 'Admin Engineering');
    assert.equal(await jab(budi), 'Admin');
  } finally { await f.db.close(); }
});

test('Master: jabatan/departemen yang masih dipegang karyawan aktif tidak bisa dinonaktifkan', opt, async () => {
  const f = await createPeopleDb();
  try {
    await f.db.query(`INSERT INTO users (nama, email, password_hash, role, jabatan, departemen) VALUES ('fajar','fajar@x.id','x','karyawan','Fuelman','Logistik')`);
    await assert.rejects(Org.updatePosition(f.db, f.scope, f.admin, f.positions.fuelman.id, { is_active: false }), e => e.statusCode === 409);
    await assert.rejects(Org.updateDepartment(f.db, f.scope, f.admin, f.departments.logistik.id, { is_active: false }), e => e.statusCode === 409);
    const ok = await Org.updatePosition(f.db, f.scope, f.admin, f.positions.foreman.id, { is_active: false });
    assert.equal(ok.position.is_active, false);
  } finally { await f.db.close(); }
});

test('Master: resolvePosition hanya menerima pasangan departemen–jabatan yang aktif (tidak pernah membuat baru)', opt, async () => {
  const f = await createPeopleDb();
  try {
    const r = await Org.resolvePosition(f.db, f.scope, { position_id: f.positions.adminLog.id });
    assert.deepEqual([r.department_name, r.position_name], ['Logistik', 'Admin']);
    await assert.rejects(Org.resolvePosition(f.db, f.scope, { position_id: f.positions.adminLog.id, department_id: f.departments.engineering.id }), e => e.statusCode === 422);
    const byName = await Org.resolvePosition(f.db, f.scope, { department: 'engineering ', position: ' admin' });
    assert.equal(byName.position_id, f.positions.adminEng.id);
    await assert.rejects(Org.resolvePosition(f.db, f.scope, { department: 'Produksi', position: 'Operator DT' }), e => e.statusCode === 422);
    const count = (await f.db.query(`SELECT COUNT(*)::int AS n FROM workforce_positions`)).rows[0].n;
    assert.equal(count, 5);
  } finally { await f.db.close(); }
});
