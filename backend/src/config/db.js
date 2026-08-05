const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres.lpezydpyzvfydbhwimqq:vxOtEE428k3UmFv4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const isCloudDb = true;

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
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
