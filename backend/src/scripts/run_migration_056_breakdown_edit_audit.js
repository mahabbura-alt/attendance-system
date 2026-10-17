'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function main() {
  const migrationPath = path.join(__dirname, '../../migrations/056_breakdown_edit_audit.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await pool.query(sql);
  console.log('Migration 056 Breakdown Edit Audit applied successfully.');
}

main()
  .catch(error => {
    console.error(`Migration 056 failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
