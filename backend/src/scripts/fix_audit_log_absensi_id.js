/**
 * Make absensi_id nullable in audit_log table in Supabase Cloud
 */
require('dotenv').config();
const { Pool } = require('pg');

const supaPool = new Pool({
  connectionString: 'postgresql://postgres.lpezydpyzvfydbhwimqq:vxOtEE428k3UmFv4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('⚡ Making absensi_id nullable in audit_log table in Supabase Cloud...');

  await supaPool.query(`ALTER TABLE audit_log ALTER COLUMN absensi_id DROP NOT NULL;`);

  console.log('  ✅ Column absensi_id is now nullable in audit_log table');

  await supaPool.end();
  console.log('🎉 audit_log schema updated successfully!');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  supaPool.end();
});
