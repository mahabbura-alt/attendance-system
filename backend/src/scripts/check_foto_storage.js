const { pool } = require('../config/db');

async function run() {
  const { rows } = await pool.query(`
    SELECT 
      a.id, u.nama, u.email,
      a.foto_datang_url,
      a.foto_pulang_url,
      a.waktu_datang,
      a.created_at
    FROM absensi a
    JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT 10
  `);
  for (const r of rows) {
    const urlType = (url) => {
      if (!url) return 'NULL';
      if (url.startsWith('https://lpezydpyzvfydbhwimqq.supabase.co')) return 'SUPABASE_PUBLIC_URL ✅';
      if (url.startsWith('data:image/')) return 'BASE64 (storage penuh)';
      if (url.startsWith('absensi/')) return 'MinIO path';
      return 'UNKNOWN: ' + url.slice(0, 60);
    };
    console.log(`[${r.nama}] foto_datang: ${urlType(r.foto_datang_url)} | foto_pulang: ${urlType(r.foto_pulang_url)}`);
  }
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
