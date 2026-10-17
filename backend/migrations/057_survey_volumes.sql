-- 057: volume survey per PIT untuk halaman Survey Report.
-- Satu baris per tanggal + PIT + jenis (ob/coal) + material. Idempoten.
CREATE TABLE IF NOT EXISTS survey_volumes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal       DATE NOT NULL,
  pit_area      VARCHAR(150) NOT NULL,
  planning_type VARCHAR(20) NOT NULL CHECK (planning_type IN ('ob', 'coal')),
  material      VARCHAR(100) NOT NULL,
  volume        NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (volume >= 0),
  created_by    UUID REFERENCES users(id),
  updated_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tanggal, pit_area, planning_type, material)
);
CREATE INDEX IF NOT EXISTS idx_survey_volumes_period
  ON survey_volumes (tanggal, pit_area);

COMMENT ON TABLE survey_volumes IS 'Volume hasil survey per tanggal, PIT, jenis OB/Coal, dan material. Diisi manual dari halaman Survey Report; kolom material mengikuti parameter 0.5/0.6 Productivity Planning.';
