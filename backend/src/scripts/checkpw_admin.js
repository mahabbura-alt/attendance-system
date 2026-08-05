require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query("SELECT password_hash FROM users WHERE email = 'admin@perusahaan.com'").then(async r => {
  if (!r.rows.length) { console.log('admin not found'); p.end(); return; }
  const hash = r.rows[0].password_hash;
  const candidates = ['admin123', 'password', 'Admin123', 'prima123', 'admin', 'admin@123', '123456'];
  for (const pw of candidates) {
    if (await bcrypt.compare(pw, hash)) { console.log('FOUND:', pw); p.end(); return; }
  }
  console.log('Password not in common list');
  p.end();
}).catch(e => { console.error(e.message); p.end(); });
