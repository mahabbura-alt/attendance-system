/**
 * Create payroll_config table in Supabase Cloud
 */
require('dotenv').config();
const { Pool } = require('pg');

const supaPool = new Pool({
  connectionString: 'postgresql://postgres.lpezydpyzvfydbhwimqq:vxOtEE428k3UmFv4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('⚡ Creating payroll_config table in Supabase Cloud...');

  await supaPool.query(`
    CREATE TABLE IF NOT EXISTS payroll_config (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        periode_key           VARCHAR(20) UNIQUE NOT NULL,
        hari_libur_reguler    VARCHAR(50) DEFAULT 'minggu',
        hari_libur_nasional   TEXT DEFAULT '',
        catatan               TEXT,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log('  ✅ Table "payroll_config" created with unique constraint on periode_key');

  await supaPool.end();
  console.log('🎉 payroll_config schema updated successfully!');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  supaPool.end();
});
