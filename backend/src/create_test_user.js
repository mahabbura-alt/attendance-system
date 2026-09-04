const bcrypt = require('bcrypt');
const { pool } = require('./config/db');

async function main() {
  try {
    const hash = await bcrypt.hash('password123', 10);
    const kantorRes = await pool.query("SELECT id FROM lokasi_kantor WHERE nama_lokasi = 'KANTOR' LIMIT 1");
    const shiftRes = await pool.query("SELECT id FROM shifts LIMIT 1");

    const res = await pool.query(
      `INSERT INTO users (nama, email, password_hash, role, jabatan, departemen, lokasi_kantor_id, shift_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email) DO UPDATE SET password_hash = $3
       RETURNING *`,
      [
        'Tester MultiLokasi',
        'test.multilokasi@perusahaan.com',
        hash,
        'karyawan',
        'Driver Dump Truck',
        'Logistik',
        kantorRes.rows[0].id,
        shiftRes.rows[0].id
      ]
    );

    console.log('✅ TEST USER CREATED/UPDATED SUCCESSFULLY:', res.rows[0].email);
    process.exit(0);
  } catch (e) {
    console.error('❌ ERROR:', e);
    process.exit(1);
  }
}

main();
