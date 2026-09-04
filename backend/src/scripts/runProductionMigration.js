const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function migrate() {
  console.log('🔄 Menjalankan migrasi SQL Tahap 2: Mining Production Management System...');
  const sqlPath = path.join(__dirname, '../../sql/003_mining_production_schema.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  try {
    await pool.query(sqlContent);
    console.log('✅ Migrasi SQL Mining Production berhasil dilaksanakan!');
  } catch (err) {
    console.error('❌ Gagal menjalankan migrasi SQL:', err);
  } finally {
    await pool.end();
  }
}

migrate();
