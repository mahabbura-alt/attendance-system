BEGIN;

-- =========================================================
-- 019 — FLEET MATERIAL GRANULAR (untuk lookup truck factor)
-- =========================================================
-- Material granular (PASIR/CLAY/...) pada fleet, menjadi kriteria
-- lookup truck factor bersama (kategori, tipe dump truck, material).
-- Kategori tetap disimpan di material_type ('Overburden'/'Coal').
-- =========================================================

ALTER TABLE fleet_mappings
  ADD COLUMN IF NOT EXISTS material_detail VARCHAR(100);

COMMENT ON COLUMN fleet_mappings.material_detail IS 'Material granular (PASIR/CLAY/BATUBARA/...) dari Truck Factor Setup; kriteria lookup truck factor per (kategori, tipe_alat, material).';

COMMIT;
