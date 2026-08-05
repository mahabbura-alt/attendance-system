const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL || '';
const isCloudDb =
  dbUrl.includes('supabase') ||
  dbUrl.includes('pooler.supabase.com') ||
  dbUrl.includes('render.com') ||
  dbUrl.includes('railway') ||
  process.env.DB_SSL === 'true';

const pool = new Pool({
  connectionString: dbUrl,
  ssl: isCloudDb ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10_000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15_000),
});

pool.on('error', (err) => {
  console.error('⚠️ [PostgreSQL Pool Error]', err.message);
});

/**
 * Execute a query with automatic retry mechanism for transient network issues.
 * @param {string} text 
 * @param {Array} params 
 * @param {number} maxRetries 
 */
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
      const delayMs = attempt * 300;
      console.warn(`⚠️ [DB Query Retry] Attempt ${attempt}/${maxRetries} failed (${err.code || err.message}). Retrying in ${delayMs}ms...`);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw lastErr;
}

module.exports = { pool, queryWithRetry };
