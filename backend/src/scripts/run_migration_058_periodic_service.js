'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function main() {
  const migrationPath = path.join(__dirname, '../../migrations/058_periodic_service.sql');
  await pool.query(fs.readFileSync(migrationPath, 'utf8'));
  const verification = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'periodic_service_%')::int AS tables,
      (SELECT COUNT(*) FROM master_breakdown_codes
        WHERE UPPER(kode)='PS' AND deleted_at IS NULL
          AND is_system=TRUE AND is_planned_maintenance=TRUE
          AND counts_as_function_failure=FALSE
          AND counts_as_mohh_breakdown=TRUE)::int AS ps_master
  `);
  console.log(JSON.stringify(verification.rows[0]));
}

main()
  .then(() => pool.end())
  .catch(async error => {
    console.error(error.message);
    await pool.end();
    process.exitCode = 1;
  });
