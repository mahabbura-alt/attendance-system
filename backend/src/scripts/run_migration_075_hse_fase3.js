'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/075_hse_fase3_competency.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_name IN (
        'hse_training_courses',
        'hse_training_requirements',
        'hse_training_records',
        'hse_employee_licenses',
        'hse_inductions',
        'hse_safety_talks'
      )) AS tables_ok,
      (SELECT count(*)::int FROM hse_training_courses WHERE tenant_key='default') AS courses_count
  `);
  console.log(JSON.stringify({ migration: '075_hse_fase3_competency', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
