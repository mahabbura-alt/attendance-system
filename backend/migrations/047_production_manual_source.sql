BEGIN;

-- =========================================================
-- 047 — DATA PRODUKSI: SUMBER DATA MANUAL PER AREA + JOB
-- =========================================================
-- Kolom induk JOB (mis. CG · Coal Getting, FOT, OB · Overburden Removal)
-- pada halaman 7. Data Produksi dapat memilih sumber data:
--   'ritase' (default) = agregasi otomatis dari Input Ritase, atau
--   'manual'           = nilai produksi diketik admin per tanggal/shift.
-- Nilai manual menggantikan nilai ritase pada rekap bulanan
-- (TOTAL bulan dan fuel ratio). Cakupan per area + JOB.
-- Data sumber (ritase_logs) tidak dimutasi.
-- =========================================================

-- Mode sumber per area + JOB.
CREATE TABLE IF NOT EXISTS production_manual_sources (
  area TEXT NOT NULL,
  job_code TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ritase' CHECK (source IN ('ritase','manual')),
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (area, job_code)
);

-- Nilai produksi manual per area + JOB + tanggal operasional + shift + material.
-- material = 'TOTAL' untuk kolom Total JOB, atau nama material untuk kolom material.
CREATE TABLE IF NOT EXISTS production_manual_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area TEXT NOT NULL,
  job_code TEXT NOT NULL,
  tanggal DATE NOT NULL,
  shift_id UUID NOT NULL REFERENCES shifts(id),
  material TEXT NOT NULL,
  value NUMERIC NOT NULL CHECK (value >= 0),
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (area, job_code, tanggal, shift_id, material)
);

CREATE INDEX IF NOT EXISTS idx_production_manual_overrides_lookup
  ON production_manual_overrides (area, job_code, tanggal);

COMMENT ON TABLE production_manual_sources IS 'Sumber data per area+JOB pada Data Produksi: ritase (default) atau manual.';
COMMENT ON COLUMN production_manual_sources.source IS 'ritase = agregasi Input Ritase; manual = nilai diketik admin.';
COMMENT ON TABLE production_manual_overrides IS 'Nilai produksi manual per area+JOB+tanggal+shift+material; menggantikan ritase pada rekap bulanan.';
COMMENT ON COLUMN production_manual_overrides.material IS 'TOTAL untuk kolom Total JOB; selain itu nama material.';
COMMIT;