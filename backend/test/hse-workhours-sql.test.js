'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createTestDb } = require('./helpers/pgliteDb');
const W = require('../src/services/hseWorkhours');

const scope = { tenantKey: 'default', projectKey: 'default' };
const MIGRATIONS = ['migrations/064_workforce_movements_mpp.sql', 'migrations/073_hse_fase1_hazard_capa.sql',
  'migrations/074_hse_fase2_incidents_reports.sql', 'migrations/079_hse_fase7_contractor_environment.sql',
  'migrations/092_hse_workhours.sql'];

async function seedTwoAdmins(db) {
  const q = (s, p) => db.query(s, p);
  const dept = async name => (await q(`INSERT INTO workforce_departments (tenant_key, project_key, code, name) VALUES ('default','default',$1,$1) RETURNING id`, [name])).rows[0].id;
  const eng = await dept('Engineering');
  const log = await dept('Logistik');
  const pos = async (d, n) => (await q(`INSERT INTO workforce_positions (tenant_key, project_key, department_id, name) VALUES ('default','default',$1,$2) RETURNING id`, [d, n])).rows[0].id;
  const adminEng = await pos(eng, 'Admin');
  await pos(log, 'Admin');
  const user = async (nama, dep) => (await q(`INSERT INTO users (nama, email, password_hash, role, jabatan, departemen, created_at)
    VALUES ($1, $2, 'x', 'karyawan', 'Admin', $3, '2026-01-01') RETURNING id`, [nama, `${nama}@x.id`, dep])).rows[0].id;
  const rina = await user('Rina', 'Engineering');
  const budi = await user('Budi', 'Logistik');
  const shift = (await q(`SELECT id FROM shifts ORDER BY created_at LIMIT 1`)).rows[0]?.id
    || (await q(`INSERT INTO shifts (nama_shift, jam_masuk_maks, jam_pulang_min, operational_start, operational_end)
      VALUES ('Shift Test','06:10','18:00','06:00','18:00') RETURNING id`)).rows[0].id;
  for (const u of [rina, budi]) {
    await q(`INSERT INTO absensi (user_id, shift_id, tanggal_kerja, waktu_datang) VALUES ($1, $2, '2026-10-01', '2026-10-01T07:00:00+07:00')`, [u, shift]);
  }
  return { adminEng, rina, budi };
}

test('Jam kerja HSE: aturan "Admin (Engineering)" tanpa departemen tidak berlaku untuk "Admin (Logistik)"', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const { adminEng, rina, budi } = await seedTwoAdmins(db);
    await db.query(`INSERT INTO hse_workhour_standards (target_type, position_id, hours_per_day, effective_from)
      VALUES ('BY_ROLE', $1, 10, '2026-01-01')`, [adminEng]);

    const recap = await W.getWorkhourRecap(db, scope, { from: '2026-10-01', to: '2026-10-01' });
    const item = id => recap.items.find(i => i.employee_id === id);
    assert.equal(item(rina).counted_hours, 10);
    assert.equal(item(budi).counted_hours, 0);
    assert.equal(item(budi).status, 'NOT_SET');
  } finally { await db.close(); }
});
