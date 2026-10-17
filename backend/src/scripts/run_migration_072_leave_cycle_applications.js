'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/072_leave_cycle_applications.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`SELECT count(*)::int AS columns_ok
    FROM information_schema.columns WHERE table_name='employee_leave_requests'
      AND column_name IN ('application_group_id','projection_start','projection_end','owning_year')`);
  console.log(JSON.stringify({ migration: '072_leave_cycle_applications', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
