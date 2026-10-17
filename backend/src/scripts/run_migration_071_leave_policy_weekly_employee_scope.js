'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/071_leave_policy_weekly_employee_scope.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='leave_policy_versions' AND column_name='target_user_id') AS target_scope,
    (SELECT count(*)::int FROM pg_indexes
      WHERE tablename='leave_policy_versions'
        AND indexname IN ('uq_leave_policy_group_version','uq_leave_policy_employee_version')) AS scope_indexes`);
  console.log(JSON.stringify({ migration: '071_leave_policy_weekly_employee_scope', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
