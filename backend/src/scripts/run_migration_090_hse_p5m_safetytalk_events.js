require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Running Migration 090: HSE P5M & Safety Talk Events...');
    const sqlPath = path.resolve(__dirname, '../../migrations/090_hse_p5m_safetytalk_events.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('Migration 090 completed successfully!');

    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'hse_p5m_events', 'hse_p5m_event_attendees',
          'hse_safetytalk_events', 'hse_safetytalk_event_attendees',
          'hse_safety_talks'
        )
      ORDER BY table_name
    `);
    console.log('Verified tables:', res.rows.map(r => r.table_name), '(hse_safety_talks harus TIDAK ada)');
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
