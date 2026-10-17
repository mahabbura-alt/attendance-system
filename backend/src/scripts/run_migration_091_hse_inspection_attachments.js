require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Running Migration 091: HSE Inspection Attachments...');
    const sqlPath = path.resolve(__dirname, '../../migrations/091_hse_inspection_attachments.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('Migration 091 completed successfully!');

    const res = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hse_inspections'
        AND column_name IN ('photos', 'documents')
      ORDER BY column_name
    `);
    console.log('Verified columns:', res.rows.map(r => `${r.column_name}:${r.data_type}`));
    if (res.rows.length !== 2) {
      console.error('Expected 2 columns (photos, documents), got', res.rows.length);
      process.exit(1);
    }
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
