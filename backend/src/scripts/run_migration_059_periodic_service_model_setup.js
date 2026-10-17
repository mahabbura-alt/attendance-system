'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function main() {
  const migrationPath = path.join(__dirname, '../../migrations/059_periodic_service_model_setup.sql');
  await pool.query(fs.readFileSync(migrationPath, 'utf8'));
  const verification = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='periodic_service_packages'
          AND column_name IN ('equipment_class','equipment_model'))::int AS model_columns,
      (SELECT COUNT(*) FROM periodic_service_packages
        WHERE deleted_at IS NULL AND (equipment_class IS NULL OR equipment_model IS NULL))::int AS invalid_packages,
      (SELECT COUNT(*) FROM pg_indexes
        WHERE schemaname='public' AND indexname IN (
          'uq_periodic_service_package_model_active',
          'uq_periodic_service_package_model_version',
          'uq_periodic_service_package_model_cycle_active',
          'idx_periodic_service_package_model_cycle'
        ))::int AS model_indexes
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
