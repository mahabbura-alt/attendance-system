/**
 * Add nama_karyawan column to database_hm in Supabase Cloud
 */
require('dotenv').config();
const { Pool } = require('pg');

const supaPool = new Pool({
  connectionString: 'postgresql://postgres.lpezydpyzvfydbhwimqq:vxOtEE428k3UmFv4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('⚡ Adding missing nama_karyawan column to database_hm in Supabase Cloud...');

  await supaPool.query(`ALTER TABLE database_hm ADD COLUMN IF NOT EXISTS nama_karyawan VARCHAR(150);`);
  console.log('  ✅ Column nama_karyawan added to database_hm');

  await supaPool.end();
  console.log('🎉 database_hm schema updated successfully!');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  supaPool.end();
});
