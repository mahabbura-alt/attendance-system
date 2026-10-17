-- Rollback 102: hapus kolom rekomendasi (deskripsi CAPA tetap utuh di hse_actions).
BEGIN;
ALTER TABLE hazard_reports DROP COLUMN IF EXISTS recommendation;
COMMIT;
