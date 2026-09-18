/* Runner migrasi 022: tambah kolom km_only pada equipment (produksi) */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env.supabase') });
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/022_add_equipment_km_only.sql'), 'utf8');
  try {
    await pool.query(sql);
    const check = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name='equipment' AND column_name='km_only'`
    );
    console.log('✅ Migrasi 022 berhasil. Kolom km_only:', JSON.stringify(check.rows[0] || null));
  } catch (err) {
    console.error('❌ Gagal migrasi 022:', err.message);
  } finally {
    await pool.end();
  }
}

run();
