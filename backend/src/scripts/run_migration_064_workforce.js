'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/064_workforce_movements_mpp.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM workforce_employee_profiles) AS profiles,
      (SELECT count(*)::int FROM workforce_employee_assignments WHERE status='ACTIVE') AS active_assignments,
      (SELECT count(*)::int FROM workforce_movement_reasons) AS reasons
  `);
  console.log(JSON.stringify({ migration: '064_workforce_movements_mpp', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
