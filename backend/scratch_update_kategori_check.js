require('dotenv').config();
const { pool } = require('./src/config/db');

async function main() {
  try {
    await pool.query(`
      ALTER TABLE keterangan_presensi DROP CONSTRAINT IF EXISTS keterangan_presensi_kategori_check;
      ALTER TABLE keterangan_presensi ADD CONSTRAINT keterangan_presensi_kategori_check CHECK (kategori IN ('hadir_manual', 'alpa', 'izin', 'sakit', 'cuti'));
    `);
    console.log('✅ TABLE keterangan_presensi CONSTRAINT UPDATED OK');
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    pool.end();
  }
}

main();
