'use strict';

/**
 * Migrasi 099 — fondasi agen LLM + trial HSE (ai_settings, ai_requests, ai_jobs,
 * hse_ai_suggestions, hse_hazard_merge_log, hazard_reports.ai_clean_description).
 *   node backend/src/scripts/run_migration_099_ai_foundation_hse.js [--check]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const TABLES = ['ai_settings', 'ai_requests', 'ai_jobs', 'hse_ai_suggestions', 'hse_hazard_merge_log'];

async function verify(client) {
  const t = await client.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name`, [TABLES]);
  const c = await client.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hazard_reports' AND column_name = 'ai_clean_description'`);
  return { tables: t.rows.map(r => r.table_name), column: c.rows.length === 1 };
}

async function main() {
  const client = await pool.connect();
  let failed = false;
  try {
    if (!process.argv.includes('--check')) {
      const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/099_ai_foundation_hse.sql'), 'utf8');
      await client.query(sql); // berkas memuat BEGIN/COMMIT sendiri
    }
    const v = await verify(client);
    console.log('Tabel:', v.tables.join(', ') || '(tidak ada)');
    if (v.tables.length !== TABLES.length || !v.column) {
      console.error('Verifikasi 099 gagal: tabel/kolom belum lengkap.');
      failed = true;
    } else {
      console.log('Migrasi 099 lengkap: 5 tabel AI + kolom hazard_reports.ai_clean_description.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migrasi 099 gagal:', err.message);
    failed = true;
  } finally {
    client.release();
    await pool.end().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
}

main();
