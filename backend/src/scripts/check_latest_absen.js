const { pool } = require('../config/db');

async function run() {
  const { rows } = await pool.query(`
    SELECT a.id, u.nama, a.tanggal_kerja, a.waktu_datang, a.foto_datang_url
    FROM absensi a
    JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT 5
  `);
  console.log(rows);
  await pool.end();
}

run();
