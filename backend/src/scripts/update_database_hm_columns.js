/**
 * Update database_hm table columns in Supabase Cloud to match hmController.js expectations
 */
require('dotenv').config();
const { Pool } = require('pg');

const supaPool = new Pool({
  connectionString: 'postgresql://postgres.lpezydpyzvfydbhwimqq:vxOtEE428k3UmFv4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('⚡ Adding missing columns to database_hm in Supabase Cloud...');

  await supaPool.query(`ALTER TABLE database_hm ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);`);
  await supaPool.query(`ALTER TABLE database_hm ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50);`);
  await supaPool.query(`ALTER TABLE database_hm ADD COLUMN IF NOT EXISTS jabatan VARCHAR(100);`);
  console.log('  ✅ Columns user_id, employee_id, jabatan added to database_hm');

  await supaPool.end();
  console.log('🎉 database_hm schema updated successfully!');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  supaPool.end();
});
