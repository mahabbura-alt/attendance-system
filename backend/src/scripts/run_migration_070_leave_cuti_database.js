'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/070_leave_cuti_database.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables
        WHERE table_name IN ('leave_policy_versions','employee_leave_entitlements',
          'employee_leave_requests','employee_leave_realisations',
          'employee_leave_projections','leave_roster_reconciliation','leave_audit_log',
          'leave_roster_snapshots')) AS leave_tables,
      (SELECT count(*)::int FROM information_schema.check_constraints
        WHERE constraint_name = 'employee_roster_daily_source_check') AS roster_source_check
  `);
  console.log(JSON.stringify({ migration: '070_leave_cuti_database', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
