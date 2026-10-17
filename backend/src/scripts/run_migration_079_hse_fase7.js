'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function run() {
  console.log('Running Migration 079: HSE Fase 7 - Kontraktor (CSMS) & Lingkungan Hidup...');
  const sqlPath = path.join(__dirname, '../../migrations/079_hse_fase7_contractor_environment.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);

  // Verifikasi 9 tabel
  const checkTables = [
    'hse_contractors',
    'hse_contractor_assessments',
    'hse_contractor_documents',
    'hse_contractor_violations',
    'hse_env_waste_b3_logs',
    'hse_env_monitoring_points',
    'hse_env_parameters',
    'hse_env_measurements',
    'hse_env_reclamation_records',
  ];

  const res = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1)
  `, [checkTables]);

  console.log(JSON.stringify({
    migration: '079_hse_fase7_contractor_environment',
    tables_found: res.rows.map(r => r.table_name),
    tables_ok: res.rows.length,
  }, null, 2));

  await pool.end();
}

run().catch(err => {
  console.error('Migration 079 failed:', err);
  pool.end();
  process.exit(1);
});
