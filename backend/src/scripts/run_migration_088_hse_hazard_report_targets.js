require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Running Migration 088: HSE Hazard Report Targets & Scopes...');
    const sqlPath = path.resolve(__dirname, '../../migrations/088_hse_hazard_report_targets.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('Migration 088 completed successfully!');

    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('hse_hazard_report_targets', 'hse_hazard_report_scopes')
    `);
    console.log('Verified tables exist:', res.rows.map(r => r.table_name));

    const fnRes = await client.query(`
      SELECT proname FROM pg_proc WHERE proname = 'hse_hazard_effective_quota'
    `);
    console.log('Verified function exists:', fnRes.rows.map(r => r.proname));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

runMigration();
