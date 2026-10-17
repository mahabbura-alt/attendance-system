'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/083_hazard_consequence_and_reporter.sql'), 'utf8');
  await pool.query(sql);

  const res = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'hazard_reports' AND column_name IN ('potential_consequence', 'reported_by_dept', 'reported_by_role')
  `);

  console.log(JSON.stringify({
    migration: '083_hazard_consequence_and_reporter',
    addedColumns: res.rows
  }));
  await pool.end();
}

main().catch(err => {
  console.error('Migration 083 error:', err);
  process.exit(1);
});
