BEGIN;

-- Truck Factor is read as an effective-dated configuration: the latest
-- version at or before the Input Ritase date applies. This index supports
-- lookup per category, dump-truck type, material and effective date without
-- altering any historical Truck Factor values.
CREATE INDEX IF NOT EXISTS idx_truck_factors_effective_lookup
  ON truck_factors (kategori, tipe_alat, UPPER(material), tanggal DESC);

COMMIT;
