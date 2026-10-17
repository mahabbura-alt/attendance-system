BEGIN;

-- -------------------------------------------------------------
-- OMOS HSE: Tambah Kolom Konsekuensi / Potensi Dampak & Detail Pelapor
-- -------------------------------------------------------------

ALTER TABLE hazard_reports 
  ADD COLUMN IF NOT EXISTS potential_consequence TEXT,
  ADD COLUMN IF NOT EXISTS reported_by_dept TEXT,
  ADD COLUMN IF NOT EXISTS reported_by_role TEXT;

COMMIT;
