/**
 * Create keterangan_presensi table in Supabase Cloud
 */
require('dotenv').config();
const { Pool } = require('pg');

const supaPool = new Pool({
  connectionString: 'postgresql://postgres.lpezydpyzvfydbhwimqq:vxOtEE428k3UmFv4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('⚡ Creating keterangan_presensi table in Supabase Cloud...');

  await supaPool.query(`
    CREATE TABLE IF NOT EXISTS keterangan_presensi (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tanggal     DATE NOT NULL,
        kategori    VARCHAR(30) NOT NULL CHECK (kategori IN ('hadir_manual', 'alpa', 'izin', 'sakit', 'cuti', 'off')),
        catatan     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_keterangan_presensi_user_tanggal UNIQUE (user_id, tanggal)
    );
  `);

  console.log('  ✅ Table "keterangan_presensi" created with unique constraint uq_keterangan_presensi_user_tanggal');

  await supaPool.end();
  console.log('🎉 keterangan_presensi schema updated successfully!');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  supaPool.end();
});
