require('dotenv').config();
const { pool } = require('../config/db');

async function inspectWodav() {
  const { rows: uRows } = await pool.query("SELECT id, nama FROM users WHERE LOWER(nama)='wodav' LIMIT 1");
  if (!uRows.length) return;
  const uid = uRows[0].id;

  const tglMulai = '2026-07-26';
  const tglAkhir = '2026-08-25';

  const { rows: absRows } = await pool.query(
    "SELECT id, tanggal_kerja::text AS tgl_str, waktu_datang, waktu_pulang FROM absensi WHERE user_id=$1 AND tanggal_kerja BETWEEN $2 AND $3 ORDER BY tanggal_kerja ASC",
    [uid, tglMulai, tglAkhir]
  );
  const { rows: manRows } = await pool.query(
    "SELECT id, tanggal::text AS tgl_str, kategori, catatan FROM keterangan_presensi WHERE user_id=$1 AND tanggal BETWEEN $2 AND $3 ORDER BY tanggal ASC",
    [uid, tglMulai, tglAkhir]
  );

  console.log('=== ABSENSI TABLE ===');
  absRows.forEach(r => {
    const dStr = r.tgl_str ? r.tgl_str.split('T')[0] : '';
    const d = new Date(`${dStr}T00:00:00`);
    const dayName = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][d.getDay()];
    console.log(`ID: ${r.id} | TglKerja: ${dStr} (${dayName}, Day ${d.getDay()}) | Datang: ${r.waktu_datang} | Pulang: ${r.waktu_pulang}`);
  });

  console.log('\n=== KETERANGAN PRESENSI TABLE ===');
  manRows.forEach(r => {
    const dStr = r.tgl_str ? r.tgl_str.split('T')[0] : '';
    const d = new Date(`${dStr}T00:00:00`);
    const dayName = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][d.getDay()];
    console.log(`ID: ${r.id} | Tanggal: ${dStr} (${dayName}, Day ${d.getDay()}) | Kategori: ${r.kategori} | Catatan: ${r.catatan}`);
  });

  pool.end();
}
inspectWodav().catch(e => { console.error(e); pool.end(); });
