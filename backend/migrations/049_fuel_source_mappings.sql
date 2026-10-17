-- 049: master mapping sumber Fuel untuk integrasi Input Fuel (P2, mode shadow).
-- Resolusi di service: cocok unik => lokasi+produk; ambigu/tidak ada => NULL
-- (masuk daftar rekonsiliasi, TIDAK ditebak). Minimal satu kunci harus diisi.
CREATE TABLE IF NOT EXISTS fuel_source_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id            UUID REFERENCES shifts(id),
  truck_equipment_id  UUID REFERENCES equipment(id),
  operator_id         UUID REFERENCES users(id),
  product_id          UUID REFERENCES fuel_products(id),
  location_id         UUID NOT NULL REFERENCES fuel_storage_locations(id),
  priority            INTEGER NOT NULL DEFAULT 100,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (shift_id IS NOT NULL)::int
    + (truck_equipment_id IS NOT NULL)::int
    + (operator_id IS NOT NULL)::int >= 1
  )
);
CREATE INDEX IF NOT EXISTS idx_fuel_source_mappings_active
  ON fuel_source_mappings (is_active);

COMMENT ON TABLE fuel_source_mappings IS 'P2 shadow: resolusi lokasi sumber issue_equipment; tanpa baris cocok = antrean rekonsiliasi.';
