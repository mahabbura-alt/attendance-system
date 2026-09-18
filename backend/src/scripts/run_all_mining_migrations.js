/* ============================================================
 * RUNNER MIGRASI MINING PRODUCTION (SKEMA DASAR + 011-020)
 * Menerapkan file SQL secara berurutan ke DB produksi.
 * Semua file idempoten (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 * ============================================================ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const BASE_DIR = path.join(__dirname, '../..'); // backend/

// Urutan file yang akan dijalankan
const files = [
  { label: 'SKEMA DASAR (003_mining_production_schema)', rel: 'sql/003_mining_production_schema.sql' },
  { label: '011 Breakdown Workflow', rel: 'migrations/011_breakdown_workflow.sql' },
  { label: '012 Unit Performance / Maintenance Events', rel: 'migrations/012_unit_performance_maintenance_events.sql' },
  { label: '013 Breakdown Ready Verification', rel: 'migrations/013_breakdown_ready_verification.sql' },
  { label: '014 Standby Verification Workflow', rel: 'migrations/014_standby_verification_workflow.sql' },
  { label: '015 Operational Shift 06:00', rel: 'migrations/015_operational_shift_0600.sql' },
  { label: '016 Standby MOHH Control', rel: 'migrations/016_standby_mohh_control.sql' },
  { label: '017 Fleet Ritase Redesign', rel: 'migrations/017_fleet_ritase_redesign.sql' },
  { label: '018 Truck Factors', rel: 'migrations/018_truck_factors.sql' },
  { label: '019 Fleet Material Detail', rel: 'migrations/019_fleet_material_detail.sql' },
  { label: '020 Master Problem Codes', rel: 'migrations/020_master_problem_codes.sql' },
  { label: '021 Add equipment lokasi & keterangan', rel: 'migrations/021_add_equipment_lokasi_keterangan.sql' },
  { label: '027 Rainfall Logs', rel: 'migrations/027_rainfall_logs.sql' },
  { label: '028 Rainfall Intensity MM', rel: 'migrations/028_rainfall_intensity_mm.sql' },
  { label: '029 Roster Jabatan Policy', rel: 'migrations/029_roster_jabatan_policy.sql' },
  { label: '030 Correct Roster Jabatan Policy', rel: 'migrations/030_correct_roster_jabatan_policy.sql' },
  { label: '031 Roster Assignment Duplicate Guard', rel: 'migrations/031_roster_assignment_duplicate_guard.sql' },
  { label: '032 Truck Factor Effective-Date Index', rel: 'migrations/032_truck_factor_effective_date_index.sql' },
  { label: '033 Shift Planned Non-Productive Windows', rel: 'migrations/033_shift_planned_nonproductive_windows.sql' },
  { label: '034 Ritase Weighted Final Distance', rel: 'migrations/034_ritase_weighted_final_distance.sql' },
  { label: '035 Data Produksi', rel: 'migrations/035_production_data.sql' },
  { label: '036 Production Fuel Quick Allocation', rel: 'migrations/036_production_fuel_quick_allocation.sql' },
  { label: '037 Production Fuel Allocation Rules', rel: 'migrations/037_production_fuel_allocation_rules.sql' },
  { label: '038 Productivity Plan Effective Versions', rel: 'migrations/038_productivity_plan_effective_versions.sql' },
  { label: '039 Fleet Mapping Operational Context Unique', rel: 'migrations/039_fleet_mapping_operational_context_unique.sql' },
];

async function main() {
  console.log('=== MULAI MIGRASI MINING PRODUCTION ===\n');
  let sukses = 0;
  let gagal = 0;

  for (const f of files) {
    const fullPath = path.join(BASE_DIR, f.rel);
    if (!fs.existsSync(fullPath)) {
      console.log(`  [SKIP] ${f.label} -> file tidak ditemukan: ${f.rel}`);
      continue;
    }
    const sql = fs.readFileSync(fullPath, 'utf8');
    try {
      await pool.query(sql);
      console.log(`  [OK]   ${f.label}`);
      sukses++;
    } catch (err) {
      console.log(`  [FAIL] ${f.label} -> ${err.message}`);
      gagal++;
      // Hentikan bila ada kegagalan agar tidak lanjut ke migrasi dependen
      console.log('\n⚠️  Migrasi dihentikan karena ada kegagalan. Perbaiki lalu jalankan ulang.');
      break;
    }
  }

  console.log(`\n=== SELESAI: sukses=${sukses}, gagal=${gagal} ===`);
  await pool.end();
  process.exit(gagal > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('Fatal:', e.message);
  await pool.end();
  process.exit(1);
});
