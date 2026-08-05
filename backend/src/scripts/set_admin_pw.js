require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const testPw = 'AdminTest123!';
bcrypt.hash(testPw, 10).then(hash => {
  return pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [hash, 'admin@perusahaan.com']);
}).then(() => {
  console.log('Admin password set to: ' + testPw);
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
