'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function main() {
  const migrationPath = path.join(__dirname, '../../migrations/060_periodic_service_schedule_items.sql');
  await pool.query(fs.readFileSync(migrationPath, 'utf8'));
  const verification = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='periodic_service_orders'
          AND column_name='scheduled_start')::int AS schedule_columns,
      (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='periodic_service_order_items')::int AS order_item_tables,
      (SELECT COUNT(*) FROM pg_indexes
        WHERE schemaname='public' AND indexname='idx_periodic_service_orders_scope_schedule')::int AS schedule_indexes
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
