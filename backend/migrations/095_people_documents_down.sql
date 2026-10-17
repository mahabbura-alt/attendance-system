DO $$
BEGIN
  IF to_regclass('public.hse_employee_licenses') IS NOT NULL THEN
    ALTER TABLE hse_employee_licenses DROP COLUMN IF EXISTS document_id;
  END IF;
  IF to_regclass('public.hse_training_records') IS NOT NULL THEN
    ALTER TABLE hse_training_records DROP COLUMN IF EXISTS document_id;
  END IF;
END $$;
DROP TABLE IF EXISTS employee_document_access_log;
DROP TABLE IF EXISTS employee_documents;
-- File PDF di storage tidak dihapus otomatis (bersihkan manual bila perlu).
