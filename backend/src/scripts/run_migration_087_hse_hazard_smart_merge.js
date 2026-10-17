'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function run() {
  console.log('Running Migration 087: HSE Hazard 2 Categories (Kondisi/Tindakan Tidak Aman) & Smart Merge...');
  const sqlPath = path.join(__dirname, '../../migrations/087_hse_hazard_categories_and_smart_merge.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);

  const catsRes = await pool.query(`
    SELECT code, label, is_active
    FROM hse_categories
    WHERE domain = 'HAZARD' AND is_active = TRUE
    ORDER BY sort_order ASC
  `);

  const hzDistRes = await pool.query(`
    SELECT category_name, count(*)::int AS total
    FROM hazard_reports
    WHERE deleted_at IS NULL
    GROUP BY category_name
    ORDER BY category_name
  `);

  console.log(JSON.stringify({
    migration: '087_hse_hazard_categories_and_smart_merge',
    active_hazard_categories: catsRes.rows,
    hazard_distribution: hzDistRes.rows,
  }, null, 2));

  await pool.end();
}

run().catch(err => {
  console.error('Migration 087 failed:', err);
  pool.end();
  process.exit(1);
});
