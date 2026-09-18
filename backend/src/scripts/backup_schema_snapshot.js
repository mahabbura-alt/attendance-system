/* ============================================================
 * BACKUP SNAPSHOT SKEMA (READ-ONLY)
 * Merekam kondisi skema DB produksi sebelum migrasi ke file JSON.
 * Tidak mengubah data apa pun.
 * ============================================================ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function main() {
  const waktu = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(__dirname, `../../backup_schema_${waktu}.json`);

  // 1. Semua tabel + jumlah kolom
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' ORDER BY table_name`
  );

  const snapshot = {
    dibuat: new Date().toISOString(),
    database: (await pool.query('SELECT current_database() AS db')).rows[0].db,
    tabel: [],
  };

  for (const t of tables.rows) {
    const cols = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [t.table_name]
    );
    let count = 0;
    try {
      count = Number((await pool.query(`SELECT COUNT(*) AS c FROM "${t.table_name}"`)).rows[0].c);
    } catch {}
    snapshot.tabel.push({
      nama: t.table_name,
      jumlah_baris: count,
      kolom: cols.rows.map((c) => `${c.column_name}:${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`),
    });
  }

  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log('✅ Backup snapshot skema tersimpan ke:', outFile);
  console.log('   Total tabel:', snapshot.tabel.length);
  await pool.end();
}

main().catch(async (e) => {
  console.error('Gagal backup:', e.message);
  await pool.end();
});
