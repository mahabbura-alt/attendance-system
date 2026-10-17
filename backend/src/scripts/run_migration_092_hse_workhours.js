require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function runMigration() {
  const client = await pool.connect();
  let failed = false;
  try {
    console.log('Running Migration 092: HSE Jam Kerja Karyawan...');
    const sqlPath = path.resolve(__dirname, '../../migrations/092_hse_workhours.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('hse_workhour_standards', 'hse_workhour_periods', 'hse_workhour_period_lines', 'hse_workhour_audit')
      ORDER BY table_name
    `);
    const col = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'hse_manhours' AND column_name = 'workhour_period_id'
    `);
    console.log('Verified tables:', res.rows.map(r => r.table_name));
    if (res.rows.length !== 4 || col.rows.length !== 1) {
      console.error('Verifikasi gagal: tabel/kolom migrasi 092 tidak lengkap.');
      failed = true;
    } else {
      console.log('Migration 092 completed successfully!');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', err.message);
    failed = true;
  } finally {
    client.release();
    await pool.end().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
}

runMigration();
