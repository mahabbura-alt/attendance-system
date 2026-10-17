'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function run() {
  console.log('Running Migration 081: HSE IBPR / Register Risiko Pertambangan...');
  const sqlPath = path.join(__dirname, '../../migrations/081_hse_ibpr_risk_register.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);

  const res = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'hse_risk_register';
  `);
  console.log(`Verified table exists:`, res.rows.map(r => r.table_name));

  const countRes = await pool.query('SELECT count(*) FROM hse_risk_register');
  console.log(`Verified risk register items: ${countRes.rows[0].count} rows`);
  console.log('Migration 081 HSE IBPR completed successfully!');
  await pool.end();
}

run().catch(err => {
  console.error('Migration 081 failed:', err);
  process.exit(1);
});
