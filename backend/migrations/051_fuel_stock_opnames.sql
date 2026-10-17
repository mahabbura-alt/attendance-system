-- 051: Stock opname untuk Database Fuel (P4).
-- Opname tidak pernah menimpa ledger: snapshot buku dicatat saat hitung,
-- approval membuat transaksi adjustment (opname_adjustment_in/out) yang
-- tertaut ke opname. Satu lokasi+produk hanya boleh punya satu opname aktif.
CREATE TABLE IF NOT EXISTS fuel_stock_opnames (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES fuel_storage_locations(id),
  product_id          UUID NOT NULL REFERENCES fuel_products(id),
  operational_date    DATE NOT NULL,
  counted_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  book_quantity_snapshot NUMERIC(16,3) NOT NULL,
  physical_quantity   NUMERIC(16,3) NOT NULL CHECK (physical_quantity >= 0),
  variance_quantity   NUMERIC(16,3) NOT NULL,
  variance_percent    NUMERIC(12,6),
  variance_alert      BOOLEAN NOT NULL DEFAULT FALSE,
  measurement_method  VARCHAR(50),
  evidence_url        TEXT,
  note                TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'adjusted')),
  counted_by          VARCHAR(100),
  submitted_by        VARCHAR(100),
  submitted_at        TIMESTAMPTZ,
  approved_by         VARCHAR(100),
  approved_at         TIMESTAMPTZ,
  reject_reason       TEXT,
  adjustment_transaction_id UUID REFERENCES fuel_inventory_transactions(id),
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Satu opname aktif (draft/submitted) per lokasi+produk; riwayat final bebas ganda.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_opname_active
  ON fuel_stock_opnames (location_id, product_id)
  WHERE status IN ('draft', 'submitted');
CREATE INDEX IF NOT EXISTS idx_fuel_opname_history
  ON fuel_stock_opnames (location_id, product_id, operational_date DESC);

COMMENT ON TABLE fuel_stock_opnames IS 'P4: stock opname; snapshot buku + fisik + variance; adjustment via transaksi tertaut, ledger tidak ditimpa.';
