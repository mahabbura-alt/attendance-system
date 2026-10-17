'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function main() {
  const migrationPath = path.join(__dirname, '../../migrations/061_periodic_service_forecast_pa.sql');
  await pool.query(fs.readFileSync(migrationPath, 'utf8'));
  const verification = await pool.query(`
    SELECT COUNT(*)::int AS estimate_columns
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='periodic_service_packages'
      AND column_name='estimated_duration_hours'
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
