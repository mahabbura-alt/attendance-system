'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/067_workforce_mpp_enterprise.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_name='workforce_mpp_line_periods'
          AND column_name IN ('reason_code','reason_text','notes','priority','needed_by','revision','updated_by','updated_at')) AS period_cols,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_name='workforce_mpp_requirement_audit') AS audit_table
  `);
  console.log(JSON.stringify({ migration: '067_workforce_mpp_enterprise', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
