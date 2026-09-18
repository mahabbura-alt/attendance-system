/* ============================================================
 * VERIFIKASI KONEKSI & KONDISI TABEL DASAR (READ-ONLY)
 * Memastikan kita terhubung ke DB produksi yang benar dan
 * memeriksa kondisi tabel dasar yang seharusnya sudah ada.
 * ============================================================ */
require('dotenv').config();
const { pool } = require('../config/db');

async function main() {
  // 1. Info koneksi
  const info = await pool.query(
    `SELECT current_database() AS db, current_user AS usr,
            inet_server_addr() AS host, NOW() AS waktu`
  );
  console.log('=== INFO KONEKSI ===');
  console.log('  DB      :', info.rows[0].db);
  console.log('  User    :', info.rows[0].usr);
  console.log('  Host    :', info.rows[0].host);
  console.log('  Waktu   :', info.rows[0].waktu.toISOString());

  // 2. Daftar semua tabel public
  console.log('\n=== DAFTAR TABEL PUBLIC ===');
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' ORDER BY table_name`
  );
  tables.rows.forEach((r) => console.log('  -', r.table_name));

  // 3. Jumlah baris tabel dasar terkait migrasi 011-020
  console.log('\n=== JUMLAH BARIS TABEL DASAR ===');
  const tabelDasar = [
    'breakdown_logs', 'standby_logs', 'fleet_mappings', 'ritase_logs',
    'shifts', 'master_standby_codes', 'master_breakdown_codes',
    'mining_production_logs', 'fuel_logs', 'equipment', 'users',
  ];
  for (const t of tabelDasar) {
    try {
      const res = await pool.query(`SELECT COUNT(*) AS c FROM "${t}"`);
      console.log(`  ${t}: ${res.rows[0].c} baris`);
    } catch (e) {
      console.log(`  ${t}: TIDAK ADA (${e.message.split('\n')[0]})`);
    }
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error('Gagal:', e.message);
  await pool.end();
});
