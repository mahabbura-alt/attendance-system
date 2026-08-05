/**
 * Create missing payroll and database_hm tables in Supabase Cloud
 */
require('dotenv').config();
const { Pool } = require('pg');

const supaPool = new Pool({
  connectionString: 'postgresql://postgres.lpezydpyzvfydbhwimqq:vxOtEE428k3UmFv4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('⚡ Adding missing columns and tables to Supabase Cloud...');

  await supaPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50);`);
  console.log('  ✅ Column u.employee_id ready');

  await supaPool.query(`
    CREATE TABLE IF NOT EXISTS payroll (
        id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id                   VARCHAR(50) UNIQUE,
        nama_karyawan                 VARCHAR(150) NOT NULL,
        date_in                       TEXT,
        site                          VARCHAR(100),
        kota                          VARCHAR(100),
        jabatan                       VARCHAR(100),
        gaji_pokok                    NUMERIC(15,2) DEFAULT 0,
        tunjangan_kehadiran_per_hari  NUMERIC(15,2) DEFAULT 0,
        tunjangan_jabatan             NUMERIC(15,2) DEFAULT 0,
        insentif_hm_per_jam           NUMERIC(15,2) DEFAULT 0,
        created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('  ✅ Table "payroll" ready');

  await supaPool.query(`
    CREATE TABLE IF NOT EXISTS database_hm (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tanggal        DATE NOT NULL,
        shift_id       UUID REFERENCES shifts(id),
        kode_unit      VARCHAR(50) NOT NULL,
        operator_id    UUID REFERENCES users(id),
        nama_operator  VARCHAR(150),
        hm_awal        NUMERIC(10,2) NOT NULL DEFAULT 0,
        hm_akhir       NUMERIC(10,2) NOT NULL DEFAULT 0,
        total_hm       NUMERIC(10,2) GENERATED ALWAYS AS (GREATEST(0, hm_akhir - hm_awal)) STORED,
        keterangan     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('  ✅ Table "database_hm" ready');

  await supaPool.end();
  console.log('🎉 All missing tables successfully created in Supabase!');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  supaPool.end();
});
