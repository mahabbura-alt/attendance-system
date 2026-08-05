/**
 * Script retensi foto: hapus foto absensi dari MinIO yang melebihi masa retensi
 *
 * Cara pakai:
 *   npm run retention:dry      — simulasi (tampilkan daftar foto yang akan dihapus)
 *   npm run retention:execute  — hapus sungguhan
 *
 * Butuh PHOTO_RETENTION_DAYS di .env. Contoh: PHOTO_RETENTION_DAYS=180
 */
require('dotenv').config();
const { pool } = require('../config/db');
const { minioClient } = require('../config/minio');

const BUCKET = process.env.MINIO_BUCKET || 'absensi-foto';
const RETENTION_DAYS = Number(process.env.PHOTO_RETENTION_DAYS);
const DRY_RUN = !process.argv.includes('--execute');

async function main() {
  if (!RETENTION_DAYS || RETENTION_DAYS <= 0) {
    console.log('PHOTO_RETENTION_DAYS belum diset atau tidak valid. Script berhenti.');
    process.exit(0);
  }

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (tidak ada yang dihapus)' : 'EXECUTE (foto akan dihapus!)'}`);
  console.log(`Retensi: ${RETENTION_DAYS} hari`);
  console.log('---');

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const { rows } = await pool.query(
    `SELECT id, foto_datang_url, foto_pulang_url, tanggal_kerja
     FROM absensi
     WHERE tanggal_kerja < $1
       AND (foto_datang_url IS NOT NULL OR foto_pulang_url IS NOT NULL)`,
    [cutoffDate.toISOString().split('T')[0]]
  );

  console.log(`Ditemukan ${rows.length} record absensi dengan foto melebihi retensi.`);

  let hapusBerhasil = 0;
  let hapusGagal = 0;

  for (const row of rows) {
    const urlsUntukHapus = [
      { key: row.foto_datang_url, kolom: 'foto_datang_url' },
      { key: row.foto_pulang_url, kolom: 'foto_pulang_url' },
    ].filter((x) => x.key);

    for (const { key, kolom } of urlsUntukHapus) {
      try {
        if (!DRY_RUN) {
          await minioClient.removeObject(BUCKET, key);
          await pool.query(`UPDATE absensi SET ${kolom} = NULL WHERE id = $1`, [row.id]);
        }
        console.log(`${DRY_RUN ? '[DRY]' : '[HAPUS]'} ${key} (absensi: ${row.tanggal_kerja})`);
        hapusBerhasil++;
      } catch (err) {
        console.error(`[GAGAL] ${key}: ${err.message}`);
        hapusGagal++;
      }
    }
  }

  console.log('---');
  console.log(`Selesai. Berhasil: ${hapusBerhasil}, Gagal: ${hapusGagal}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
