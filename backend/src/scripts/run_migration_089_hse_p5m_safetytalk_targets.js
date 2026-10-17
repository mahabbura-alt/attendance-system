require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Running Migration 089: HSE P5M & Safety Talk Targets...');
    const sqlPath = path.resolve(__dirname, '../../migrations/089_hse_p5m_safetytalk_targets.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('Migration 089 completed successfully!');

    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('hse_p5m_targets', 'hse_p5m_scopes', 'hse_safetytalk_targets', 'hse_safetytalk_scopes')
    `);
    console.log('Verified tables exist:', res.rows.map(r => r.table_name));

    const fnRes = await client.query(`
      SELECT proname FROM pg_proc WHERE proname IN ('hse_p5m_effective_quota', 'hse_safetytalk_effective_quota')
    `);
    console.log('Verified functions exist:', fnRes.rows.map(r => r.proname));
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
