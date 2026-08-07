require('dotenv').config();
const { pool } = require('../config/db');

async function checkWodav() {
  const { rows: uRows } = await pool.query("SELECT id FROM users WHERE LOWER(nama)='wodav' LIMIT 1");
  if (!uRows.length) return;
  const uid = uRows[0].id;

  const tglMulai = '2026-07-26';
  const tglAkhir = '2026-08-25';

  const { rows: absRows } = await pool.query(
    'SELECT tanggal_kerja, waktu_datang FROM absensi WHERE user_id=$1 AND tanggal_kerja BETWEEN $2 AND $3',
    [uid, tglMulai, tglAkhir]
  );
  const { rows: manRows } = await pool.query(
    'SELECT tanggal, kategori, catatan FROM keterangan_presensi WHERE user_id=$1 AND tanggal BETWEEN $2 AND $3',
    [uid, tglMulai, tglAkhir]
  );

  console.log('=== ABSENSI WODAV ===');
  console.log(absRows);
  console.log('=== KETERANGAN PRESENSI WODAV ===');
  console.log(manRows);

  pool.end();
}
checkWodav().catch(e => { console.error(e); pool.end(); });
