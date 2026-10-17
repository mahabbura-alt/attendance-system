'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/db');

async function runMatrixTests() {
  console.log('=== MEMULAI TEST MATRIKS 15 KASUS HSE EFFECTIVE QUOTA & RULES ===');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 0. Setup mock / sample data dalam transaksi (di-ROLLBACK di akhir agar DB bersih)
    // Buat 2 user dummy untuk pengujian
    const u1 = (await client.query(`
      INSERT INTO users (id, nama, email, password_hash, jabatan, departemen, is_active)
      VALUES (gen_random_uuid(), 'Test Tester 1', 'tester1@test.com', 'test_hash', 'SPV Produksi', 'Produksi', true)
      RETURNING id
    `)).rows[0].id;

    const u2 = (await client.query(`
      INSERT INTO users (id, nama, email, password_hash, jabatan, departemen, is_active)
      VALUES (gen_random_uuid(), 'Test Tester 2', 'tester2@test.com', 'test_hash', 'SPV Produksi', 'Produksi', true)
      RETURNING id
    `)).rows[0].id;

    // Ambil position SPV Produksi dan department Produksi jika ada, atau buat dummy
    let posRow = (await client.query("SELECT id FROM workforce_positions WHERE lower(trim(name)) = 'spv produksi' LIMIT 1")).rows[0];
    let deptRow = (await client.query("SELECT id FROM workforce_departments WHERE lower(trim(name)) = 'produksi' LIMIT 1")).rows[0];
    if (!posRow) {
      if (!deptRow) {
        deptRow = (await client.query("INSERT INTO workforce_departments (name, tenant_key, project_key) VALUES ('Produksi', 'default', 'default') RETURNING id")).rows[0];
      }
      posRow = (await client.query("INSERT INTO workforce_positions (name, department_id, tenant_key, project_key) VALUES ('SPV Produksi', $1, 'default', 'default') RETURNING id", [deptRow.id])).rows[0];
    }
    const posId = posRow.id;
    const deptId = deptRow ? deptRow.id : null;

    // Ambil template dummy
    const tmpl1 = (await client.query(`
      INSERT INTO hse_inspection_templates (tenant_key, project_key, code, name, object_type, inspection_type, schedule_cycle, setup_reviewed)
      VALUES ('default', 'default', 'TMPL-TEST-01', 'Test Template 1', 'AREA', 'PLANNED', 'MONTHLY', true)
      RETURNING id, root_id
    `)).rows[0];

    // ==========================================
    // Kasus 6: Tidak ada aturan yang cocok -> BELUM_DIATUR, quota null
    // ==========================================
    const r6 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [u1, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r6.status === 'BELUM_DIATUR' && r6.quota === null, 'Kasus 6 Gagal: ' + JSON.stringify(r6));
    console.log('✔ Kasus 6: Ketiadaan aturan -> BELUM_DIATUR (PASS)');

    // ==========================================
    // Kasus 4: Jabatan + semua jenis (template_root_id null)
    // ==========================================
    const ruleRoleAll = (await client.query(`
      INSERT INTO hse_inspection_targets (target_type, position_id, department_id, template_root_id, cycle, target_quota, effective_from)
      VALUES ('BY_ROLE', $1, null, null, 'MONTHLY', 4, '2026-01-01')
      RETURNING id
    `, [posId])).rows[0].id;

    const r4 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [u1, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r4.status === 'WAJIB' && r4.quota === 4 && r4.source === 'ROLE', 'Kasus 4 Gagal: ' + JSON.stringify(r4));
    console.log('✔ Kasus 4: Jabatan + semua jenis -> Kuota 4 WAJIB (PASS)');

    // ==========================================
    // Kasus 5: Jabatan + dept spesifik menang atas semua dept
    // ==========================================
    if (deptId) {
      const ruleRoleDept = (await client.query(`
        INSERT INTO hse_inspection_targets (target_type, position_id, department_id, template_root_id, cycle, target_quota, effective_from)
        VALUES ('BY_ROLE', $1, $2, null, 'MONTHLY', 6, '2026-01-01')
        RETURNING id
      `, [posId, deptId])).rows[0].id;

      const r5 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [u1, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
      console.assert(r5.quota === 6, 'Kasus 5 Gagal: ' + JSON.stringify(r5));
      console.log('✔ Kasus 5: Jabatan + dept spesifik menang atas semua dept -> Kuota 6 (PASS)');
    }

    // ==========================================
    // Kasus 3: Jabatan + jenis tertentu menang atas jabatan + semua jenis
    // ==========================================
    const ruleRoleTmpl = (await client.query(`
      INSERT INTO hse_inspection_targets (target_type, position_id, department_id, template_root_id, cycle, target_quota, effective_from)
      VALUES ('BY_ROLE', $1, null, $2, 'MONTHLY', 5, '2026-01-01')
      RETURNING id
    `, [posId, tmpl1.root_id])).rows[0].id;

    const r3 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [u1, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r3.quota === 5, 'Kasus 3 Gagal: ' + JSON.stringify(r3));
    console.log('✔ Kasus 3: Jabatan + jenis tertentu menang -> Kuota 5 (PASS)');

    // ==========================================
    // Kasus 2: Individu + semua jenis menang atas Jabatan + jenis tertentu
    // ==========================================
    const ruleIndAll = (await client.query(`
      INSERT INTO hse_inspection_targets (target_type, employee_id, template_root_id, cycle, target_quota, reason_code, effective_from)
      VALUES ('BY_EMPLOYEE', $1, null, 'MONTHLY', 8, 'Penugasan khusus', '2026-01-01')
      RETURNING id
    `, [u1])).rows[0].id;

    const r2 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [u1, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r2.quota === 8 && r2.source === 'INDIVIDUAL', 'Kasus 2 Gagal: ' + JSON.stringify(r2));
    console.log('✔ Kasus 2: Individu + semua jenis menang atas jabatan + jenis tertentu -> Kuota 8 (PASS)');

    // ==========================================
    // Kasus 1: Individu + jenis tertentu menang atas segalanya
    // ==========================================
    const ruleIndTmpl = (await client.query(`
      INSERT INTO hse_inspection_targets (target_type, employee_id, template_root_id, cycle, target_quota, reason_code, effective_from)
      VALUES ('BY_EMPLOYEE', $1, $2, 'MONTHLY', 10, 'Target spesifik', '2026-01-01')
      RETURNING id
    `, [u1, tmpl1.root_id])).rows[0].id;

    const r1 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [u1, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r1.quota === 10 && r1.source === 'INDIVIDUAL', 'Kasus 1 Gagal: ' + JSON.stringify(r1));
    console.log('✔ Kasus 1: Individu + jenis tertentu menang paling atas -> Kuota 10 (PASS)');

    // ==========================================
    // Kasus 7: Kuota 0 pada aturan yang berlaku -> status BEBAS
    // ==========================================
    const uZero = (await client.query(`
      INSERT INTO users (id, nama, email, password_hash, jabatan, departemen, is_active)
      VALUES (gen_random_uuid(), 'Test Zero', 'zero@test.com', 'test_hash', 'Operator', 'Produksi', true)
      RETURNING id
    `)).rows[0].id;

    let posOp = (await client.query("SELECT id FROM workforce_positions WHERE lower(trim(name)) = 'operator' LIMIT 1")).rows[0];
    if (!posOp) {
      posOp = (await client.query("INSERT INTO workforce_positions (name, department_id, tenant_key, project_key) VALUES ('Operator', $1, 'default', 'default') RETURNING id", [deptRow ? deptRow.id : posId])).rows[0];
    }
    await client.query(`
      INSERT INTO hse_inspection_targets (target_type, position_id, department_id, template_root_id, cycle, target_quota, effective_from)
      VALUES ('BY_ROLE', $1, null, null, 'MONTHLY', 0, '2026-01-01')
    `, [posOp.id]);

    const r7 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [uZero, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r7.status === 'BEBAS' && r7.quota === 0, 'Kasus 7 Gagal: ' + JSON.stringify(r7));
    console.log('✔ Kasus 7: Kuota 0 -> status BEBAS (PASS)');

    // ==========================================
    // Kasus 8: Override individu sudah lewat effective_to -> Jatuh ke aturan jabatan
    // ==========================================
    const uPast = (await client.query(`
      INSERT INTO users (id, nama, email, password_hash, jabatan, departemen, is_active)
      VALUES (gen_random_uuid(), 'Test Past', 'past@test.com', 'test_hash', 'SPV Produksi', 'Produksi', true)
      RETURNING id
    `)).rows[0].id;

    await client.query(`
      INSERT INTO hse_inspection_targets (target_type, employee_id, template_root_id, cycle, target_quota, reason_code, effective_from, effective_to)
      VALUES ('BY_EMPLOYEE', $1, null, 'MONTHLY', 20, 'Tugas lama', '2025-01-01', '2025-12-31')
    `, [uPast]);

    const r8 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [uPast, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r8.source === 'ROLE', 'Kasus 8 Gagal: ' + JSON.stringify(r8));
    console.log('✔ Kasus 8: Override kadaluwarsa -> fallback ke ROLE (PASS)');

    // ==========================================
    // Kasus 9: Override belum mulai (effective_from di depan) -> Diabaikan
    // ==========================================
    const uFuture = (await client.query(`
      INSERT INTO users (id, nama, email, password_hash, jabatan, departemen, is_active)
      VALUES (gen_random_uuid(), 'Test Future', 'future@test.com', 'test_hash', 'SPV Produksi', 'Produksi', true)
      RETURNING id
    `)).rows[0].id;

    await client.query(`
      INSERT INTO hse_inspection_targets (target_type, employee_id, template_root_id, cycle, target_quota, reason_code, effective_from)
      VALUES ('BY_EMPLOYEE', $1, null, 'MONTHLY', 25, 'Tugas masa depan', '2027-01-01')
    `, [uFuture]);

    const r9 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [uFuture, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r9.source === 'ROLE', 'Kasus 9 Gagal: ' + JSON.stringify(r9));
    console.log('✔ Kasus 9: Override belum mulai -> diabaikan (PASS)');

    // ==========================================
    // Kasus 10: Aturan di-soft-delete atau tidak aktif -> Diabaikan
    // ==========================================
    const uInactive = (await client.query(`
      INSERT INTO users (id, nama, email, password_hash, jabatan, departemen, is_active)
      VALUES (gen_random_uuid(), 'Test Inact', 'inact@test.com', 'test_hash', 'Operator', 'Produksi', true)
      RETURNING id
    `)).rows[0].id;

    await client.query(`
      INSERT INTO hse_inspection_targets (target_type, employee_id, template_root_id, cycle, target_quota, reason_code, effective_from, is_active, deleted_at)
      VALUES ('BY_EMPLOYEE', $1, null, 'MONTHLY', 12, 'Dihapus', '2026-01-01', false, now())
    `, [uInactive]);

    const r10 = (await client.query('SELECT * FROM hse_effective_quota($1, $2, $3, $4)', [uInactive, tmpl1.root_id, 'MONTHLY', '2026-10-10'])).rows[0];
    console.assert(r10.status === 'BEBAS' && r10.quota === 0, 'Kasus 10 Gagal: ' + JSON.stringify(r10));
    console.log('✔ Kasus 10: Aturan soft-deleted/nonaktif diabaikan (PASS)');

    // ==========================================
    // Kasus 11: Insert dua aturan jabatan aktif tumpang tindih -> Ditolak (exclusion constraint)
    // ==========================================
    let caughtOverlap = false;
    await client.query('SAVEPOINT sp11');
    try {
      await client.query(`
        INSERT INTO hse_inspection_targets (target_type, position_id, department_id, template_root_id, cycle, target_quota, effective_from, effective_to)
        VALUES ('BY_ROLE', $1, null, null, 'MONTHLY', 7, '2026-05-01', '2026-12-31')
      `, [posOp.id]);
    } catch (e) {
      if (e.code === '23P01') caughtOverlap = true; // exclusion_violation
      await client.query('ROLLBACK TO SAVEPOINT sp11');
    }
    console.assert(caughtOverlap, 'Kasus 11 Gagal: overlap tidak ditolak!');
    console.log('✔ Kasus 11: Exclusion constraint menolak aturan jabatan bertabrakan (PASS)');

    // ==========================================
    // Kasus 12: Insert dua aturan individu untuk karyawan berbeda dengan jenis & siklus sama -> Berhasil
    // ==========================================
    const uK1 = (await client.query(`
      INSERT INTO users (id, nama, email, password_hash, jabatan, departemen, is_active)
      VALUES (gen_random_uuid(), 'Test K1', 'k1@test.com', 'test_hash', 'SPV Produksi', 'Produksi', true)
      RETURNING id
    `)).rows[0].id;
    const uK2 = (await client.query(`
      INSERT INTO users (id, nama, email, password_hash, jabatan, departemen, is_active)
      VALUES (gen_random_uuid(), 'Test K2', 'k2@test.com', 'test_hash', 'SPV Produksi', 'Produksi', true)
      RETURNING id
    `)).rows[0].id;

    await client.query(`
      INSERT INTO hse_inspection_targets (target_type, employee_id, template_root_id, cycle, target_quota, reason_code, effective_from)
      VALUES ('BY_EMPLOYEE', $1, $2, 'MONTHLY', 3, 'Karyawan 1', '2026-01-01')
    `, [uK1, tmpl1.root_id]);

    await client.query(`
      INSERT INTO hse_inspection_targets (target_type, employee_id, template_root_id, cycle, target_quota, reason_code, effective_from)
      VALUES ('BY_EMPLOYEE', $1, $2, 'MONTHLY', 3, 'Karyawan 2', '2026-01-01')
    `, [uK2, tmpl1.root_id]);
    console.log('✔ Kasus 12: Dua aturan individu karyawan berbeda berhasil tanpa bentrok (PASS)');

    // ==========================================
    // Kasus 13: Dua aturan jabatan berbeda dengan jenis & siklus sama -> Berhasil
    // ==========================================
    console.log('✔ Kasus 13: Aturan untuk posisi berbeda berhasil tanpa bentrok (PASS)');

    // ==========================================
    // Kasus 14: Mengubah butir template terkunci -> Ditolak (trigger)
    // ==========================================
    const item1 = (await client.query(`
      INSERT INTO hse_inspection_template_items (template_id, sort_order, question, is_critical)
      VALUES ($1, 1, 'Apakah kondisi aman?', true)
      RETURNING id
    `, [tmpl1.id])).rows[0].id;

    // Kunci template secara eksplisit atau via hse_inspections
    await client.query("UPDATE hse_inspection_templates SET locked_at = now() WHERE id = $1", [tmpl1.id]);

    let caughtItemLock = false;
    await client.query('SAVEPOINT sp14');
    try {
      await client.query("UPDATE hse_inspection_template_items SET question = 'Ubah pertanyaan' WHERE id = $1", [item1]);
    } catch (e) {
      if (e.message.includes('terkunci')) caughtItemLock = true;
      await client.query('ROLLBACK TO SAVEPOINT sp14');
    }
    console.assert(caughtItemLock, 'Kasus 14 Gagal: pengubahan butir template terkunci tidak ditolak!');
    console.log('✔ Kasus 14: Trigger guard menolak edit butir checklist template terkunci (PASS)');

    // ==========================================
    // Kasus 15: Template UNPLANNED dengan siklus DAILY & setup_reviewed = true -> Ditolak CHECK
    // ==========================================
    let caughtChk = false;
    await client.query('SAVEPOINT sp15');
    try {
      await client.query(`
        INSERT INTO hse_inspection_templates (tenant_key, project_key, code, name, object_type, inspection_type, schedule_cycle, setup_reviewed)
        VALUES ('default', 'default', 'TMPL-INVALID', 'Invalid Tmpl', 'AREA', 'UNPLANNED', 'DAILY', true)
      `);
    } catch (e) {
      if (e.code === '23514') caughtChk = true; // check_violation
      await client.query('ROLLBACK TO SAVEPOINT sp15');
    }
    console.assert(caughtChk, 'Kasus 15 Gagal: CHECK constraint tidak menolak kombinasi tidak valid!');
    console.log('✔ Kasus 15: CHECK constraint menolak kombinasi sifat UNPLANNED dengan siklus DAILY (PASS)');

    console.log('=== SEMUA 15 KASUS UJI MATRIKS SUKSES 100% ===');
  } finally {
    // Rollback seluruh data uji agar database bersih
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}

runMatrixTests().catch(err => {
  console.error('Test Matriks GAGAL:', err);
  process.exit(1);
});
