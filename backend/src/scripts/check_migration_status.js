/* ============================================================
 * DIAGNOSTIK STATUS MIGRASI (READ-ONLY)
 * Memeriksa apakah artefak migrasi 011-020 sudah ada di DB produksi.
 * Tidak mengubah data apa pun.
 * ============================================================ */
require('dotenv').config();
const { pool } = require('../config/db');

// Daftar artefak yang harus diperiksa per migrasi
// [nomor_migrasi, label, tipe, nama_objek, kolom_opsional]
const cek = [
  // ---- 011 Breakdown Workflow ----
  ['011', 'tabel breakdown_status_history', 'table', 'breakdown_status_history'],
  ['011', 'tabel breakdown_parts', 'table', 'breakdown_parts'],
  ['011', 'kolom breakdown_logs.current_status', 'column', 'breakdown_logs', 'current_status'],
  ['011', 'kolom breakdown_logs.reported_by', 'column', 'breakdown_logs', 'reported_by'],
  ['011', 'kolom breakdown_logs.pic_id', 'column', 'breakdown_logs', 'pic_id'],
  ['011', 'kolom breakdown_logs.updated_by', 'column', 'breakdown_logs', 'updated_by'],
  ['011', 'kolom breakdown_logs.updated_at', 'column', 'breakdown_logs', 'updated_at'],

  // ---- 012 Unit Performance / Maintenance Events ----
  ['012', 'tabel maintenance_events', 'table', 'maintenance_events'],

  // ---- 013 Breakdown Ready Verification ----
  ['013', 'tabel breakdown_ready_verifications', 'table', 'breakdown_ready_verifications'],
  ['013', 'kolom breakdown_logs.repair_completed_at', 'column', 'breakdown_logs', 'repair_completed_at'],
  ['013', 'kolom breakdown_logs.repair_completed_by', 'column', 'breakdown_logs', 'repair_completed_by'],

  // ---- 014 Standby Verification Workflow ----
  ['014', 'tabel standby_log_audit', 'table', 'standby_log_audit'],
  ['014', 'kolom standby_logs.lifecycle_status', 'column', 'standby_logs', 'lifecycle_status'],
  ['014', 'kolom standby_logs.review_status', 'column', 'standby_logs', 'review_status'],
  ['014', 'kolom standby_logs.source_type', 'column', 'standby_logs', 'source_type'],
  ['014', 'kolom breakdown_logs.release_attempt', 'column', 'breakdown_logs', 'release_attempt'],
  ['014', 'kolom breakdown_status_history.counts_as_breakdown', 'column', 'breakdown_status_history', 'counts_as_breakdown'],
  ['014', 'kolom breakdown_ready_verifications.standby_log_id', 'column', 'breakdown_ready_verifications', 'standby_log_id'],

  // ---- 015 Operational Shift 0600 ----
  ['015', 'kolom shifts.operational_start', 'column', 'shifts', 'operational_start'],
  ['015', 'kolom shifts.operational_end', 'column', 'shifts', 'operational_end'],

  // ---- 016 Standby MOHH Control ----
  ['016', 'tabel standby_shift_closures', 'table', 'standby_shift_closures'],
  ['016', 'tabel standby_shift_closure_audit', 'table', 'standby_shift_closure_audit'],
  ['016', 'kolom master_standby_codes.planning_type', 'column', 'master_standby_codes', 'planning_type'],
  ['016', 'kolom master_standby_codes.control_class', 'column', 'master_standby_codes', 'control_class'],

  // ---- 017 Fleet Ritase Redesign ----
  ['017', 'kolom fleet_mappings.pit_area', 'column', 'fleet_mappings', 'pit_area'],
  ['017', 'kolom fleet_mappings.job_code', 'column', 'fleet_mappings', 'job_code'],
  ['017', 'kolom fleet_mappings.jarak_km', 'column', 'fleet_mappings', 'jarak_km'],
  ['017', 'kolom ritase_logs.period_hour', 'column', 'ritase_logs', 'period_hour'],

  // ---- 018 Truck Factors ----
  ['018', 'tabel truck_factors', 'table', 'truck_factors'],

  // ---- 019 Fleet Material Detail ----
  ['019', 'kolom fleet_mappings.material_detail', 'column', 'fleet_mappings', 'material_detail'],

  // ---- 020 Master Problem Codes ----
  ['020', 'tabel master_problem_codes', 'table', 'master_problem_codes'],

  // ---- 040 Database HM berbasis Input Data ----
  ['040', 'tabel hm_worklog_cutover', 'table', 'hm_worklog_cutover'],
  ['040', 'tabel hm_worklog_reviews', 'table', 'hm_worklog_reviews'],
  ['040', 'tabel hm_worklog_review_audit', 'table', 'hm_worklog_review_audit'],
];

async function cekAda(tipe, nama, kolom) {
  if (tipe === 'table') {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
      [nama]
    );
    return rows.length > 0;
  }
  // column
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [nama, kolom]
  );
  return rows.length > 0;
}

async function main() {
  console.log('=== DIAGNOSTIK STATUS MIGRASI PRODUKSI ===\n');
  const hasil = {};
  for (const [no, label, tipe, nama, kolom] of cek) {
    try {
      const ada = await cekAda(tipe, nama, kolom);
      if (!hasil[no]) hasil[no] = { ada: 0, kurang: 0, rincian: [] };
      if (ada) {
        hasil[no].ada++;
        console.log(`  [OK]   ${no} | ${label}`);
      } else {
        hasil[no].kurang++;
        console.log(`  [MISS] ${no} | ${label}`);
      }
      hasil[no].rincian.push({ label, ada });
    } catch (err) {
      console.log(`  [ERR]  ${no} | ${label} -> ${err.message}`);
      if (!hasil[no]) hasil[no] = { ada: 0, kurang: 0, rincian: [] };
      hasil[no].rincian.push({ label, ada: false, err: err.message });
    }
  }

  console.log('\n=== RINGKASAN PER MIGRASI ===');
  for (const [no, h] of Object.entries(hasil)) {
    const status = h.kurang === 0 ? 'LENGKAP' : `KURANG (${h.kurang} artefak hilang)`;
    console.log(`  Migrasi ${no}: ${status}  [ada=${h.ada}, kurang=${h.kurang}]`);
  }

  if (hasil['040']?.kurang === 0) {
    const { rows } = await pool.query(
      'SELECT effective_date::text AS effective_date FROM hm_worklog_cutover WHERE id = TRUE'
    );
    console.log(`  Migrasi 040 cutover: ${rows[0]?.effective_date || 'TIDAK DITEMUKAN'}`);
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error('Gagal konek DB:', e.message);
  await pool.end();
});
