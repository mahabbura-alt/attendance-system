-- 102_hse_hazard_recommendation.sql
-- Rekomendasi perbaikan disimpan di laporan hazard (sumber deskripsi CAPA untuk PIC).
-- Status hazard dihitung otomatis dari progres CAPA (lihat hse.syncHazardStatusFromActions).
-- Aditif & idempoten. Rollback: 102_hse_hazard_recommendation_down.sql

BEGIN;

ALTER TABLE hazard_reports ADD COLUMN IF NOT EXISTS recommendation TEXT;

-- Isi dari CAPA hazard paling awal untuk laporan yang sudah punya CAPA (hanya baris yang masih kosong),
-- kecuali deskripsi otomatis sistem.
UPDATE hazard_reports h
SET recommendation = first_capa.description
FROM (
  SELECT DISTINCT ON (source_id) source_id, description
  FROM hse_actions
  WHERE source_type = 'HAZARD' AND deleted_at IS NULL
  ORDER BY source_id, created_at ASC
) first_capa
WHERE first_capa.source_id = h.id
  AND h.recommendation IS NULL
  AND first_capa.description NOT LIKE 'Tindak lanjut hazard:%'
  AND first_capa.description NOT LIKE 'Temuan kritis inspeksi%';

COMMIT;
