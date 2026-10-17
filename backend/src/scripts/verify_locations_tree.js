'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../config/db');
const hseService = require('../services/hse');

async function main() {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const res = await hseService.listLocationsTree(pool, scope);
  console.log(`Total Area Induk: ${res.totalAreas}`);
  console.log(`Total Sub-Area: ${res.totalSubAreas}`);
  res.items.forEach(p => {
    console.log(`📍 [${p.code}] ${p.name} (${p.type}) -> ${p.sub_areas.length} sub-area`);
    p.sub_areas.forEach(s => {
      console.log(`   ↳ [${s.code}] ${s.name} (${s.type})`);
    });
  });
  await pool.end();
}

main().catch(err => {
  console.error('Error verifying locations tree:', err);
  process.exit(1);
});
