/* ============================================================
 * RUNNER MIGRASI 021 (tambah kolom lokasi & keterangan equipment)
 * ============================================================ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const BASE_DIR = path.join(__dirname, '../..'); // backend/
const files = [
  { label: '021 Add equipment lokasi & keterangan', rel: 'migrations/021_add_equipment_lokasi_keterangan.sql' },
];

async function main() {
  console.log('=== MULAI MIGRASI 021 ===\n');
  let sukses = 0;
  let gagal = 0;
  for (const f of files) {
    const fullPath = path.join(BASE_DIR, f.rel);
    if (!fs.existsSync(fullPath)) {
      console.log(`  [SKIP] ${f.label} -> file tidak ditemukan: ${f.rel}`);
      continue;
    }
    const sql = fs.readFileSync(fullPath, 'utf8');
    try {
      await pool.query(sql);
      console.log(`  [OK]   ${f.label}`);
      sukses++;
    } catch (err) {
      console.log(`  [FAIL] ${f.label} -> ${err.message}`);
      gagal++;
      break;
    }
  }
  console.log(`\n=== SELESAI: sukses=${sukses}, gagal=${gagal} ===`);
  await pool.end();
  process.exit(gagal > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('Fatal:', e.message);
  await pool.end();
  process.exit(1);
});
