-- =====================================================================
-- 092_hse_workhours_down.sql (rollback migrasi 092)
-- Catatan: baris hse_manhours source = 'ATTENDANCE' hasil kirim periode
-- tetap ada; hanya rujukan workhour_period_id yang dilepas.
-- =====================================================================

DROP INDEX IF EXISTS idx_absensi_tanggal_user;
DROP INDEX IF EXISTS idx_hse_manhours_workhour_period;
ALTER TABLE hse_manhours DROP COLUMN IF EXISTS workhour_period_id;

DROP TABLE IF EXISTS hse_workhour_audit;
DROP TABLE IF EXISTS hse_workhour_period_lines;
DROP TABLE IF EXISTS hse_workhour_periods;
DROP TABLE IF EXISTS hse_workhour_standards;
