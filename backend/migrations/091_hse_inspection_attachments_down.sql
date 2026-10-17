-- Rollback migrasi 091_hse_inspection_attachments.sql
-- Menghapus kolom lampiran inspeksi (data lampiran ikut hilang).

ALTER TABLE hse_inspections
  DROP COLUMN IF EXISTS photos,
  DROP COLUMN IF EXISTS documents;
