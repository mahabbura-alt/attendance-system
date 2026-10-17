-- 050: FIFO layers + allocations untuk Database Fuel (P3).
-- Layer dibuat dari setiap line transaksi masuk yang diposting; outbound
-- mengonsumsi layer tertua (received_at, id) dengan row lock. Reversal
-- mengembalikan ke layer asal berdasarkan allocation (bukan layer baru).
CREATE TABLE IF NOT EXISTS fuel_fifo_layers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_line_id     UUID REFERENCES fuel_inventory_lines(id),
  location_id         UUID NOT NULL REFERENCES fuel_storage_locations(id),
  product_id          UUID REFERENCES fuel_products(id),
  received_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  initial_quantity    NUMERIC(16,3) NOT NULL CHECK (initial_quantity > 0),
  remaining_quantity  NUMERIC(16,3) NOT NULL CHECK (remaining_quantity >= 0),
  unit_cost           NUMERIC(18,4),
  batch_number        VARCHAR(100),
  quality_expiry_at   TIMESTAMPTZ,
  status              VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'exhausted', 'reversed')),
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fuel_fifo_lookup
  ON fuel_fifo_layers (location_id, product_id, status, received_at, id);

CREATE TABLE IF NOT EXISTS fuel_fifo_allocations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_line_id    UUID NOT NULL REFERENCES fuel_inventory_lines(id) ON DELETE CASCADE,
  fifo_layer_id       UUID NOT NULL REFERENCES fuel_fifo_layers(id),
  allocated_quantity  NUMERIC(16,3) NOT NULL CHECK (allocated_quantity > 0),
  unit_cost_snapshot  NUMERIC(18,4),
  allocated_value     NUMERIC(20,4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (outbound_line_id, fifo_layer_id)
);

COMMENT ON TABLE fuel_fifo_layers IS 'P3: FIFO layer per lokasi+produk; konsumsi oldest-first dengan FOR UPDATE.';
COMMENT ON TABLE fuel_fifo_allocations IS 'P3: jejak alokasi outbound->layer; dasar reversal ke layer asal.';
