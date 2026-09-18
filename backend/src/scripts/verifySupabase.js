/**
 * Automated Verification Script for Supabase PostgreSQL Migration
 * Usage: node src/scripts/verifySupabase.js
 */
require('dotenv').config();
const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

async function verify() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET wajib tersedia untuk menjalankan verifikasi Supabase.');
  }
  if (!process.env.OMOS_VERIFY_PASSWORD) {
    throw new Error('OMOS_VERIFY_PASSWORD wajib tersedia untuk simulasi login verifikasi.');
  }

  console.log('🔍 [VERIFICATION] Mulai pengujian koneksi dan integritas database Supabase...\n');

  // 1. Connection Test
  console.log('1️⃣ Memeriksa koneksi database...');
  const nowRes = await pool.query('SELECT NOW() as db_time, current_database() as db_name, version() as version');
  console.log(`   ✅ Connected to: ${nowRes.rows[0].db_name} (${nowRes.rows[0].version.split(' ')[0]})`);
  console.log(`   🕒 Waktu server DB: ${nowRes.rows[0].db_time}\n`);

  // 2. Table Integrity Check
  console.log('2️⃣ Memeriksa keberadaan tabel...');
  const expectedTables = ['shifts', 'lokasi_kantor', 'users', 'registrasi_pending', 'password_reset_tokens', 'absensi', 'audit_log'];
  for (const table of expectedTables) {
    const res = await pool.query(`SELECT COUNT(*) as count FROM "${table}"`);
    console.log(`   📊 Tabel [${table}]: ${res.rows[0].count} baris`);
  }
  console.log('   ✅ Semua 7 tabel terverifikasi di Supabase Cloud.\n');

  // 3. User & Admin Verification
  console.log('3️⃣ Memeriksa data user & admin...');
  const userRes = await pool.query('SELECT email, role, is_active FROM users WHERE is_active = TRUE ORDER BY role, email');
  if (userRes.rows.length === 0) {
    throw new Error('Tabel users kosong! Migrasi data belum selesai.');
  }
  console.log(`   ✅ Ditemukan ${userRes.rows.length} user aktif.`);
  for (const u of userRes.rows) {
    console.log(`      - [${u.role.toUpperCase()}] ${u.email}`);
  }
  console.log('');

  // 4. Test Login Authentication
  console.log('4️⃣ Simulasi verifikasi autentikasi login...');
  const testUser = userRes.rows.find(u => u.email === 'admin@perusahaan.com') || userRes.rows[0];
  const authRes = await pool.query('SELECT id, password_hash, role FROM users WHERE email = $1', [testUser.email]);
  if (!authRes.rows[0]) {
    throw new Error(`User ${testUser.email} tidak ditemukan.`);
  }
  const isMatch = await bcrypt.compare(process.env.OMOS_VERIFY_PASSWORD, authRes.rows[0].password_hash);
  if (!isMatch) {
    throw new Error(`Kredensial verifikasi untuk '${testUser.email}' tidak cocok.`);
  }
  console.log(`   ✅ Query dan validasi kredensial user '${testUser.email}' berhasil.`);

  // 5. Test JWT Token Generation
  const token = jwt.sign({ id: authRes.rows[0].id, role: authRes.rows[0].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  console.log(`   ✅ Generasi JWT Token berhasil (${token.substring(0, 25)}...)\n`);

  console.log('🎉 [SUCCESS] Seluruh verifikasi Supabase PostgreSQL 100% SUKSES!');
  await pool.end();
}

verify().catch(async (err) => {
  console.error('\n❌ [VERIFICATION FAILED]:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
