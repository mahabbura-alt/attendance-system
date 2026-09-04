BEGIN;

-- =========================================================
-- 017 — INPUT RITASE REDESIGN (Fleet-centered, per-jam)
-- =========================================================
-- Konsep baru:
--   * Satu fleet = 1 Excavator (loader) + N Dump Truck (hauler)
--     + header fleet: PIT/Area, JOB, material, jarak (km).
--   * Ritase dicatat per jam per dump truck (satu baris per jam),
--     dengan kolom periode jam mengikuti jendela shift operasional.
--   * Total produksi dikalkulasi dari tabel acuan payload
--     (kalkulasi menyusul; kolom production_volume tetap dipertahankan).
-- Data lama tidak dihapus; baris lama tanpa fleet tidak tampil
-- pada grid fleet baru (fleet_mapping_id IS NULL).
-- =========================================================

-- 1) Header fleet: tambah field PIT/Area, JOB, jarak (km)
ALTER TABLE fleet_mappings
  ADD COLUMN IF NOT EXISTS pit_area   VARCHAR(150),
  ADD COLUMN IF NOT EXISTS job_code   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS jarak_km   NUMERIC(10,2);

COMMENT ON COLUMN fleet_mappings.pit_area IS 'PIT / Area kerja fleet; dropdown berasal dari nilai area_name pada INPUT DATA (mining_production_logs).';
COMMENT ON COLUMN fleet_mappings.job_code IS 'Kode JOB (master_job_codes), mis. OB/OR/OG/CG/CH.';
COMMENT ON COLUMN fleet_mappings.jarak_km IS 'Jarak angkut (km), input manual per fleet.';

-- 2) Ritase per jam: kolom slot jam (0-23)
ALTER TABLE ritase_logs
  ADD COLUMN IF NOT EXISTS period_hour SMALLINT NOT NULL DEFAULT 0
    CHECK (period_hour BETWEEN 0 AND 23);

COMMENT ON COLUMN ritase_logs.period_hour IS 'Slot jam (0-23) tempat ritase dicatat. Nilai 0 dipakai data lama yang tidak memiliki rincian per jam.';

-- 3) Data lama: beri nilai period_hour aman (jika ada baris yang NULL dari versi lama)
UPDATE ritase_logs SET period_hour = 0 WHERE period_hour IS NULL;

-- 4) Dedupe pengaman sebelum unique index (baris fleet lama yang duplikat,
--    pertahankan baris terbaru)
DELETE FROM ritase_logs a
USING ritase_logs b
WHERE a.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND a.fleet_mapping_id IS NOT NULL
  AND a.id <> b.id
  AND a.tanggal = b.tanggal
  AND a.shift_id = b.shift_id
  AND a.fleet_mapping_id = b.fleet_mapping_id
  AND a.dump_truck_id = b.dump_truck_id
  AND a.period_hour = b.period_hour
  AND a.created_at < b.created_at;

-- 5) Idempotensi: satu baris per (fleet, dump truck, jam) per shift
CREATE UNIQUE INDEX IF NOT EXISTS uq_ritase_fleet_truck_hour
  ON ritase_logs (tanggal, shift_id, fleet_mapping_id, dump_truck_id, period_hour)
  WHERE deleted_at IS NULL AND fleet_mapping_id IS NOT NULL;

-- 6) Index pencarian grid fleet
CREATE INDEX IF NOT EXISTS idx_ritase_fleet
  ON ritase_logs (fleet_mapping_id, period_hour)
  WHERE deleted_at IS NULL AND fleet_mapping_id IS NOT NULL;

COMMIT;
