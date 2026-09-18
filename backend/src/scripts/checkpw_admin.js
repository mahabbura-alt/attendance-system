require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const verificationEmail = process.env.OMOS_VERIFY_ADMIN_EMAIL;
const verificationPassword = process.env.OMOS_VERIFY_PASSWORD;

if (!verificationEmail || !verificationPassword) {
  console.error('OMOS_VERIFY_ADMIN_EMAIL dan OMOS_VERIFY_PASSWORD wajib tersedia.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT password_hash FROM users WHERE email = $1', [verificationEmail]).then(async (result) => {
  if (!result.rows.length) {
    console.log('Admin tidak ditemukan.');
    await pool.end();
    return;
  }
  const valid = await bcrypt.compare(verificationPassword, result.rows[0].password_hash);
  console.log(valid ? 'Credential verification succeeded.' : 'Credential verification failed.');
  await pool.end();
}).catch(async (error) => {
  console.error(error.message);
  await pool.end();
  process.exitCode = 1;
});
