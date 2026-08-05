/**
 * Jalankan: npm run seed:admin -- admin@perusahaan.com password_baru_yang_kuat
 * Script ini meng-update password_hash akun admin yang sudah ada di sql/schema.sql
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

async function main() {
  const [, , email, password] = process.argv;

  if (!email || !password) {
    console.error('Cara pakai: npm run seed:admin -- <email> <password>');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  const { rowCount } = await pool.query(
    `UPDATE users SET password_hash = $1 WHERE email = $2 AND role = 'admin'`,
    [hash, email]
  );

  if (rowCount === 0) {
    console.error(`Tidak ada akun admin dengan email ${email}. Cek dulu isi tabel users.`);
  } else {
    console.log(`Password admin (${email}) berhasil diperbarui.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
