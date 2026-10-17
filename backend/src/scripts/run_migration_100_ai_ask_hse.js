'use strict';

/**
 * Migrasi 100 — Tanya OMOS (tabel ai_ask_feedback). Butuh migrasi 099.
 *   node backend/src/scripts/run_migration_100_ai_ask_hse.js [--check]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function verify(client) {
  const base = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_requests'`);
  const t = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_ask_feedback'`);
  return { has099: base.rows.length === 1, has100: t.rows.length === 1 };
}

async function main() {
  const client = await pool.connect();
  let failed = false;
  try {
    const pre = await verify(client);
    if (!pre.has099) throw new Error('Migrasi 099 belum dijalankan (ai_requests tidak ada).');
    if (!process.argv.includes('--check')) {
      const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/100_ai_ask_hse.sql'), 'utf8');
      await client.query(sql); // berkas memuat BEGIN/COMMIT sendiri
    }
    const v = await verify(client);
    if (!v.has100) {
      console.error('Verifikasi 100 gagal: tabel ai_ask_feedback belum ada.');
      failed = true;
    } else {
      console.log('Migrasi 100 lengkap: tabel ai_ask_feedback tersedia.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migrasi 100 gagal:', err.message);
    failed = true;
  } finally {
    client.release();
    await pool.end().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
}

main();
