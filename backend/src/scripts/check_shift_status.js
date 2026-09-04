const { pool } = require('../config/db');

async function run() {
  const { rows } = await pool.query(`
    SELECT 
      a.id, u.nama, u.email,
      a.tanggal_kerja, a.waktu_datang, a.status_datang,
      s.nama_shift, s.jam_masuk_maks, s.jam_pulang_min,
      s.operational_start, s.operational_end, s.lintas_hari
    FROM absensi a
    JOIN users u ON u.id = a.user_id
    JOIN shifts s ON s.id = a.shift_id
    ORDER BY a.created_at DESC
    LIMIT 5
  `);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
