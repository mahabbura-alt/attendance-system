// Read-only verification: migration is exercised inside a rollback transaction.
// Run from repository root: node backend/src/scripts/verify_production_data.js
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.supabase') });
const { pool } = require('../config/db');
const { loadReport } = require('../controllers/productionDataController');
(async () => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const migration = fs.readFileSync(path.join(__dirname, '../../migrations/035_production_data.sql'), 'utf8');
    await db.query(migration.replace(/^BEGIN;|^COMMIT;/gm, ''));
    const r = await loadReport(db, { year: 2026, month: 9 });
    console.log(JSON.stringify({ areas: r.areas, jobs: r.jobs.map(j => ({ code: j.jobCode, materials: j.materials.length })),
      rowCounts: r.tables.map(t => t.rows.length), fuel: r.fuelSummary, queueCount: r.queue.length,
      densityCandidates: r.densityCandidates.length }));
    if (Math.abs(r.fuelSummary.total - r.fuelSummary.allocated - r.fuelSummary.pending) > 0.000001) throw new Error('Fuel reconciliation failed');
    const source = await db.query(`SELECT COALESCE(SUM(fuel_filled),0)::float AS total FROM fuel_logs WHERE deleted_at IS NULL AND tanggal >= '2026-09-01' AND tanggal < '2026-10-01'`);
    if (Math.abs(source.rows[0].total - r.fuelSummary.total) > 0.000001) throw new Error('Fuel source total mismatch');
    console.log('Database report and migration verification passed; rolling back all schema changes.');
  } finally { await db.query('ROLLBACK'); db.release(); await pool.end(); }
})().catch(error => { console.error({ code: error.code, message: error.message }); process.exitCode = 1; });
