'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/db');

async function main() {
  const sample = await pool.query(
    "SELECT id, nama, departemen, jabatan, employee_id, role, is_active FROM users WHERE is_active = TRUE ORDER BY nama LIMIT 5"
  );
  console.log('Sample users:', sample.rows);
  await pool.end();
}

main().catch(console.error);
