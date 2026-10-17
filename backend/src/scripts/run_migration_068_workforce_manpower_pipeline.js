'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/068_workforce_manpower_pipeline.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_name='workforce_manpower_requests'
          AND column_name IN ('period_month','department_id','position_id','priority','revision','idempotency_key','override_reason','submitted_at','approved_at','recruiting_at','candidate_ready_at','onboarding_at','fulfilled_at','cancelled_at','rejected_at')) AS request_cols,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_name='workforce_manpower_request_events') AS events_table,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_name='workforce_manpower_request_fulfillments') AS fulfillments_table,
      (SELECT count(*)::int FROM workforce_manpower_requests WHERE status='IN_PROGRESS') AS legacy_in_progress
  `);
  console.log(JSON.stringify({ migration: '068_workforce_manpower_pipeline', ...rows[0] }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
