/* ============================================================
 * CLEANUP: hapus fleet test yang dibuat saat verifikasi fix
 * (id fleet test: 87181347-57e5-4793-be76-68724fb06b50)
 * ============================================================ */
require('dotenv').config();
const { pool } = require('../config/db');

const TEST_FLEET_ID = '87181347-57e5-4793-be76-68724fb06b50';

async function main() {
  // Hapus ikatan dump truck fleet test
  const trucks = await pool.query('DELETE FROM fleet_mapping_trucks WHERE fleet_mapping_id = $1', [TEST_FLEET_ID]);
  // Hapus fleet test
  const fleet = await pool.query('DELETE FROM fleet_mappings WHERE id = $1', [TEST_FLEET_ID]);
  console.log(`Deleted fleet_mapping_trucks: ${trucks.rowCount}, fleet_mappings: ${fleet.rowCount}`);
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('Fatal:', e.message);
  await pool.end();
  process.exit(1);
});
