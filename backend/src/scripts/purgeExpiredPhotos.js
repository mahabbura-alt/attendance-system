/**
 * Retensi foto Supabase Storage.
 * npm run retention:dry / npm run retention:execute
 */
require('dotenv').config();
const { pool } = require('../config/db');
const { hapusFoto } = require('../services/storage');

const RETENTION_DAYS = Number(process.env.PHOTO_RETENTION_DAYS);
const DRY_RUN = !process.argv.includes('--execute');

async function main() {
  if (!RETENTION_DAYS || RETENTION_DAYS <= 0) {
    console.log('PHOTO_RETENTION_DAYS belum diset atau tidak valid. Script berhenti.');
    process.exit(0);
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  const { rows } = await pool.query(
    `SELECT id, foto_datang_url, foto_pulang_url, tanggal_kerja
     FROM absensi
     WHERE tanggal_kerja < $1
       AND (foto_datang_url IS NOT NULL OR foto_pulang_url IS NOT NULL)`,
    [cutoffDate.toISOString().split('T')[0]]
  );

  let berhasil = 0;
  let gagal = 0;
  for (const row of rows) {
    const photos = [
      { value: row.foto_datang_url, column: 'foto_datang_url' },
      { value: row.foto_pulang_url, column: 'foto_pulang_url' },
    ].filter((item) => item.value);

    for (const photo of photos) {
      try {
        if (!DRY_RUN) {
          await hapusFoto(photo.value);
          await pool.query(`UPDATE absensi SET ${photo.column} = NULL WHERE id = $1`, [row.id]);
        }
        console.log(`${DRY_RUN ? '[DRY]' : '[HAPUS]'} ${photo.value} (${row.tanggal_kerja})`);
        berhasil++;
      } catch (error) {
        console.error(`[GAGAL] ${photo.value}: ${error.message}`);
        gagal++;
      }
    }
  }

  console.log(`Selesai. Berhasil: ${berhasil}, Gagal: ${gagal}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
