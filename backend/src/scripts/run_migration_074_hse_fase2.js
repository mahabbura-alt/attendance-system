'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/074_hse_fase2_incidents_reports.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_name IN ('hse_manhours','incidents','incident_persons','incident_assets','incident_investigations')) AS tables_ok,
      (SELECT count(*)::int FROM hse_manhours WHERE tenant_key='default') AS manhours_rows
  `);
  console.log(JSON.stringify({ migration: '074_hse_fase2_incidents_reports', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
