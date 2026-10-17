'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/073_hse_fase1_hazard_capa.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_name IN ('hse_locations','hse_risk_matrix_config','hse_categories','hse_actions','hazard_reports','hse_site_metrics')) AS tables_ok,
      (SELECT count(*)::int FROM hse_risk_matrix_config WHERE tenant_key='default') AS matrix_rows,
      (SELECT count(*)::int FROM hse_categories WHERE tenant_key='default') AS category_rows,
      (SELECT count(*)::int FROM hse_locations WHERE tenant_key='default') AS location_rows
  `);
  console.log(JSON.stringify({ migration: '073_hse_fase1_hazard_capa', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
