require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query("SELECT email FROM users WHERE role = 'admin' LIMIT 3").then(r=>{
  r.rows.forEach(u => console.log(u.email));
  p.end();
}).catch(e => { console.error(e.message); p.end(); });
