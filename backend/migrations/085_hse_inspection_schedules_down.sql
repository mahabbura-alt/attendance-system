-- =====================================================================
-- Rollback Migration 085: Modul HSE - Jadwal Objek Inspeksi
-- =====================================================================

ALTER TABLE hse_inspections
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS schedule_id;

DROP TABLE IF EXISTS hse_inspection_schedules CASCADE;
