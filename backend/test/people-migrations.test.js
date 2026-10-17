'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createTestDb, readSql } = require('./helpers/pgliteDb');

const BASE = ['migrations/064_workforce_movements_mpp.sql', 'migrations/073_hse_fase1_hazard_capa.sql',
  'migrations/075_hse_fase3_competency.sql'];
const PEOPLE = ['093_people_personal_nrp', '094_people_attendance_locations', '095_people_documents',
  '096_people_family', '097_people_movement_v2', '098_people_import'];
const up = n => `migrations/${n}.sql`;
const down = n => `migrations/${n}_down.sql`;

const NEW_TABLES = ['people_settings', 'workforce_employee_personal', 'workforce_employee_field_audit',
  'employee_attendance_locations', 'employee_documents', 'employee_document_access_log',
  'employee_family_members', 'employee_family_audit', 'people_outbox', 'employee_import_batches',
  'employee_import_rows', 'master_aliases'];

async function tables(db) {
  const { rows } = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  return new Set(rows.map(r => r.table_name));
}

test('Migrasi People 093–098: naik, idempoten, turun, naik lagi', { skip: !available }, async () => {
  const db = await createTestDb(BASE);
  try {
    await db.query(`INSERT INTO users (nama, email, password_hash, role, nik_ktp) VALUES
      ('Andre', 'andre@x.id', 'x', 'karyawan', '6310000000000007'), ('Lama', 'lama@x.id', 'x', 'karyawan', '123')`);
    await db.exec(`INSERT INTO workforce_employee_profiles (user_id, employee_number) SELECT id, NULL FROM users`);
    for (const n of PEOPLE) await db.exec(readSql(up(n)));
    for (const n of PEOPLE) await db.exec(readSql(up(n))); // idempoten
    const after = await tables(db);
    NEW_TABLES.forEach(t => assert.ok(after.has(t), `tabel ${t} ada`));

    // NIK valid di users disalin; NIK tidak valid diabaikan.
    const { rows: nik } = await db.query(`SELECT nik FROM workforce_employee_personal`);
    assert.deepEqual(nik.map(r => r.nik), ['6310000000000007']);

    // Jenis pergerakan baru diterima DB.
    const prof = (await db.query(`SELECT p.id, u.id AS uid FROM workforce_employee_profiles p JOIN users u ON u.id=p.user_id WHERE u.nama='Andre'`)).rows[0];
    await db.query(`INSERT INTO workforce_employee_movements (movement_no, employee_profile_id, movement_type, effective_date, created_by)
      VALUES ('MOV-T-1', $1, 'CONFIRMATION', '2026-11-03', $2)`, [prof.id, prof.uid]);
    await assert.rejects(db.query(`INSERT INTO workforce_employee_movements (movement_no, employee_profile_id, movement_type, effective_date, created_by, last_working_day)
      VALUES ('MOV-T-2', $1, 'TRANSFER', '2026-11-03', $2, '2026-11-01')`, [prof.id, prof.uid]), /chk_movement_last_working_day/);
    // Dokumen non-PDF ditolak DB.
    await assert.rejects(db.query(`INSERT INTO employee_documents (employee_profile_id, doc_type, title, storage_key, original_filename, mime_type, size_bytes, sha256)
      VALUES ($1, 'CV', 'CV', 'k', 'a.png', 'image/png', 10, repeat('a', 64))`, [prof.id]));
    await db.query(`DELETE FROM workforce_employee_movements WHERE movement_no='MOV-T-1'`);

    for (const n of [...PEOPLE].reverse()) await db.exec(readSql(down(n)));
    const downed = await tables(db);
    NEW_TABLES.forEach(t => assert.ok(!downed.has(t), `tabel ${t} terhapus`));
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='workforce_employee_movements'`)).rows.map(r => r.column_name);
    assert.ok(!cols.includes('last_working_day'));

    for (const n of PEOPLE) await db.exec(readSql(up(n)));
    assert.ok((await tables(db)).has('employee_import_rows'));
  } finally { await db.close(); }
});
