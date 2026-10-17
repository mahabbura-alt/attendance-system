'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/082_hse_setup_area_sub_area.sql'), 'utf8');
  await pool.query(sql);

  const parentRes = await pool.query(`
    SELECT count(*)::int AS parents 
    FROM hse_locations 
    WHERE parent_id IS NULL AND deleted_at IS NULL
  `);

  const subRes = await pool.query(`
    SELECT count(*)::int AS subs 
    FROM hse_locations 
    WHERE parent_id IS NOT NULL AND deleted_at IS NULL
  `);

  console.log(JSON.stringify({
    migration: '082_hse_setup_area_sub_area',
    parentAreas: parentRes.rows[0]?.parents || 0,
    subAreas: subRes.rows[0]?.subs || 0
  }));
}

main().then(() => pool.end()).catch(async error => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
