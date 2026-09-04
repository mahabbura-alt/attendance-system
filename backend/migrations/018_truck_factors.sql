BEGIN;

-- =========================================================
-- 018 — TRUCK FACTOR SETUP
-- =========================================================
-- Acuan kalkulasi ritase dump truck menjadi hasil produksi.
-- Satu nilai truck factor = payload (hasil produksi) per ritase,
-- untuk kombinasi (periode, kategori OB/Coal, tipe dump truck, material).
-- Nilai disimpan per periode (tanggal) agar dapat dievaluasi dari waktu ke waktu.
-- =========================================================

CREATE TABLE IF NOT EXISTS truck_factors (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal       DATE NOT NULL,                     -- periode (dari filter tab Input Ritase)
    kategori      VARCHAR(10) NOT NULL CHECK (kategori IN ('OB', 'Coal')),
    tipe_alat     VARCHAR(100) NOT NULL,             -- TIPE MODEL dump truck (dari List Equipment)
    material      VARCHAR(100) NOT NULL,             -- material (dari OB/Coal Productivity Planning)
    factor_value  NUMERIC(14,4),                     -- payload per ritase (BCM/rit OB, Ton/rit Coal)
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_truck_factor
  ON truck_factors (tanggal, kategori, tipe_alat, material);

CREATE INDEX IF NOT EXISTS idx_truck_factors_tgl
  ON truck_factors (tanggal);

COMMENT ON TABLE truck_factors IS 'Nilai truck factor per periode per tipe dump truck per material (acuan payload ritase -> produksi).';
COMMENT ON COLUMN truck_factors.factor_value IS 'Hasil produksi per ritase: BCM/rit untuk OB, Ton/rit untuk Coal.';

COMMIT;
