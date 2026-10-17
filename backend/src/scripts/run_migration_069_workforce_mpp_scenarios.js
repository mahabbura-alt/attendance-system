'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/069_workforce_mpp_scenarios.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_name='workforce_mpp_scenarios') AS scenarios_table,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_name='workforce_mpp_scenario_lines') AS scenario_lines_table
  `);
  console.log(JSON.stringify({ migration: '069_workforce_mpp_scenarios', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
