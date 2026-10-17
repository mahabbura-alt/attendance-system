'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function run() {
  console.log('Running Migration 077: HSE Fase 5 - Kesehatan Kerja (Occupational Health)...');
  const sqlPath = path.join(__dirname, '../../migrations/077_hse_fase5_occupational_health.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);

  // Verifikasi tabel
  const checkTables = [
    'hse_mcu_records',
    'hse_fit_for_work_checks',
    'hse_substance_tests',
    'hse_health_cases',
    'hse_hygiene_measurements',
  ];

  const res = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1)
  `, [checkTables]);

  console.log(JSON.stringify({
    migration: '077_hse_fase5_occupational_health',
    tables_found: res.rows.map(r => r.table_name),
    tables_ok: res.rows.length,
  }, null, 2));

  await pool.end();
}

run().catch(err => {
  console.error('Migration 077 failed:', err);
  process.exit(1);
});
