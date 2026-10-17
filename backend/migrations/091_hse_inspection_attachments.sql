-- =====================================================================
-- 091_hse_inspection_attachments.sql
-- Lampiran pada tab Inspeksi (Hazard dan Inspeksi):
--   photos    : data-URL base64 (pola hazard, kompresi sharp di server)
--   documents : JSONB [{name, mime, size, data}] base64 (PDF/DOCX/XLSX)
--
-- Keputusan owner (grilling 2026-10-12):
--   * Lampiran level HEADER record inspeksi (bukan per item checklist).
--   * Foto WAJIB >= 1 untuk setiap inspeksi baru (divalidasi saat
--     create & saat PUT lampiran; riwayat lama tidak diblokir).
--   * Dokumen opsional, boleh saat create atau sesudahnya.
--   * Edit lampiran pasca-create = staged di modal Detail + satu
--     PUT /inspections/:id/lampiran (replace-set atomik).
-- =====================================================================

ALTER TABLE hse_inspections
  ADD COLUMN IF NOT EXISTS photos    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS documents JSONB  NOT NULL DEFAULT '[]';
