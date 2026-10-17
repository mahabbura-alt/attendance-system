'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/db');

async function main() {
  console.log('--- Menjalankan Migrasi 084: Setup Inspeksi, Matriks Target, dan Versioning ---');
  const sql084 = fs.readFileSync(path.join(__dirname, '../../migrations/084_hse_setup_inspections.sql'), 'utf8');
  await pool.query(sql084);
  console.log('Migrasi 084 selesai sukses.');

  console.log('--- Menjalankan Migrasi 085: Jadwal Objek Inspeksi ---');
  const sql085 = fs.readFileSync(path.join(__dirname, '../../migrations/085_hse_inspection_schedules.sql'), 'utf8');
  await pool.query(sql085);
  console.log('Migrasi 085 selesai sukses.');

  // Verifikasi tabel hse_inspection_targets dan hse_inspection_schedules
  const resTables = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('hse_inspection_targets', 'hse_inspection_setup_audit', 'hse_inspection_schedules')
    ORDER BY table_name
  `);

  const resCols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'hse_inspection_templates' 
      AND column_name IN ('inspection_type', 'schedule_cycle', 'custom_interval_days', 'setup_reviewed', 'root_id', 'version_no', 'is_current', 'locked_at')
    ORDER BY column_name
  `);

  console.log('Verifikasi tabel baru:', resTables.rows.map(r => r.table_name));
  console.log('Verifikasi kolom template:', resCols.rows.map(r => `${r.column_name} (${r.data_type})`));

  await pool.end();
}

main().catch(err => {
  console.error('Migrasi GAGAL:', err);
  process.exit(1);
});
