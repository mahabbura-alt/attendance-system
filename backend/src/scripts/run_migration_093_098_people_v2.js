require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

/**
 * Migrasi OMOS People v2 (093–098). Tiap file dijalankan dalam transaksinya
 * sendiri dan diverifikasi. Semua file idempoten; aman diulang.
 *
 *   node src/scripts/run_migration_093_098_people_v2.js           # jalankan
 *   node src/scripts/run_migration_093_098_people_v2.js --check   # hanya cek
 */
const FILES = [
  '093_people_personal_nrp.sql',
  '094_people_attendance_locations.sql',
  '095_people_documents.sql',
  '096_people_family.sql',
  '097_people_movement_v2.sql',
  '098_people_import.sql',
];
const EXPECTED_TABLES = [
  'people_settings', 'workforce_employee_personal', 'workforce_employee_field_audit',
  'employee_attendance_locations', 'employee_documents', 'employee_document_access_log',
  'employee_family_members', 'employee_family_audit', 'people_outbox',
  'employee_import_batches', 'employee_import_rows', 'master_aliases',
];

async function verify(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [EXPECTED_TABLES]);
  const found = new Set(rows.map(r => r.table_name));
  const missing = EXPECTED_TABLES.filter(t => !found.has(t));
  const col = await client.query(`SELECT 1 FROM information_schema.columns
     WHERE table_name = 'workforce_employee_movements' AND column_name = 'last_working_day'`);
  return { missing, movementV2: col.rows.length === 1 };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const client = await pool.connect();
  let failed = false;
  try {
    if (!checkOnly) {
      for (const file of FILES) {
        const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations', file), 'utf8');
        console.log(`Menjalankan ${file}...`);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`${file}: ${err.message}`);
        }
      }
    }
    const result = await verify(client);
    if (result.missing.length || !result.movementV2) {
      console.error('Verifikasi gagal:', JSON.stringify(result));
      failed = true;
    } else {
      console.log(`Migrasi People v2 lengkap: ${EXPECTED_TABLES.length} tabel + kolom pergerakan v2.`);
    }
  } catch (err) {
    console.error('Migrasi gagal:', err.message);
    failed = true;
  } finally {
    client.release();
    await pool.end().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
}

main();
