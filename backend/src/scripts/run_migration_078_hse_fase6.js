'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function run() {
  console.log('Running Migration 078: HSE Fase 6 - Tanggap Darurat & APD / Peralatan...');
  const sqlPath = path.join(__dirname, '../../migrations/078_hse_fase6_emergency_ppe.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);

  // Verifikasi 8 tabel
  const checkTables = [
    'hse_emergency_team_members',
    'hse_emergency_drills',
    'hse_emergency_equipment',
    'hse_emergency_assembly_points',
    'hse_emergency_contacts',
    'hse_ppe_items',
    'hse_ppe_standards',
    'hse_ppe_issuances',
  ];

  const res = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1)
  `, [checkTables]);

  console.log(JSON.stringify({
    migration: '078_hse_fase6_emergency_ppe',
    tables_found: res.rows.map(r => r.table_name),
    tables_ok: res.rows.length,
  }, null, 2));

  await pool.end();
}

run().catch(err => {
  console.error('Migration 078 failed:', err);
  process.exit(1);
});
