const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres.lpezydpyzvfydbhwimqq:vxOtEE428k3UmFv4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const isCloudDb = true;

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 5_000, // Tutup koneksi idle di Node.js sebelum diputus oleh Supabase PgBouncer (port 6543)
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on('error', (err) => {
  // Abaikan warning termination koneksi idle karena diputus secara otomatis oleh PgBouncer/Vercel
  if (err.message.includes('Connection terminated') || err.code === '57P01') {
    return;
  }
  console.error('⚠️ [PostgreSQL Pool Error]', err.message);
});

async function queryWithRetry(text, params, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      lastErr = err;
      const isTransient = ['ECONNRESET', 'ETIMEDOUT', '57P01', '57P02', '57P03', '08006', '08001'].includes(err.code);
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delayMs = attempt * 200;
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw lastErr;
}

module.exports = { pool, queryWithRetry };
