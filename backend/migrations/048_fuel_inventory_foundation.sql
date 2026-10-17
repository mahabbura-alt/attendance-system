-- 044: fondasi Database Fuel (P1) — master + ledger + audit.
-- FIFO/opname menyusul di migrasi P3/P4. Idempoten (IF NOT EXISTS).
CREATE SEQUENCE IF NOT EXISTS fuel_inventory_transaction_seq;

CREATE TABLE IF NOT EXISTS fuel_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code    VARCHAR(50) UNIQUE NOT NULL,
  product_name    VARCHAR(150) NOT NULL,
  base_uom        VARCHAR(10) NOT NULL DEFAULT 'L' CHECK (base_uom = 'L'),
  density_kg_l    NUMERIC(10,4),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fuel_storage_locations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID,
  project_id          UUID,
  area_id             UUID,
  location_code       VARCHAR(50) UNIQUE NOT NULL,
  location_name       VARCHAR(150) NOT NULL,
  storage_type        VARCHAR(20) NOT NULL DEFAULT 'tank'
    CHECK (storage_type IN ('depot', 'tank', 'fuel_truck')),
  equipment_id        UUID REFERENCES equipment(id),
  capacity_liter      NUMERIC(16,3),
  minimum_stock_liter NUMERIC(16,3),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fuel_locations_scope
  ON fuel_storage_locations (tenant_id, project_id, area_id);

CREATE TABLE IF NOT EXISTS fuel_inventory_transactions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID,
  project_id                  UUID,
  area_id                     UUID,
  transaction_number          VARCHAR(40) UNIQUE NOT NULL,
  transaction_type            VARCHAR(30) NOT NULL CHECK (transaction_type IN (
    'opening_balance', 'receipt', 'issue_equipment', 'transfer_out',
    'transfer_in', 'return', 'loss',
    'opname_adjustment_in', 'opname_adjustment_out', 'reversal')),
  operational_date            DATE NOT NULL,
  transaction_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shift_id                    UUID REFERENCES shifts(id),
  product_id                  UUID REFERENCES fuel_products(id),
  source_location_id          UUID REFERENCES fuel_storage_locations(id),
  destination_location_id     UUID REFERENCES fuel_storage_locations(id),
  equipment_id                UUID REFERENCES equipment(id),
  operator_id                 UUID REFERENCES users(id),
  fuel_log_id                 UUID REFERENCES fuel_logs(id),
  document_number             VARCHAR(100),
  supplier_reference          VARCHAR(150),
  transfer_group_id           UUID,
  status                      VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'reversed', 'void')),
  source_type                 VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source_type IN (
    'manual', 'input_fuel', 'import', 'mobile_offline', 'integration',
    'stock_opname', 'system_reversal')),
  reason                      TEXT,
  idempotency_key             VARCHAR(100) UNIQUE,
  created_by                  UUID REFERENCES users(id),
  posted_by                   UUID REFERENCES users(id),
  reversed_by                 UUID REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at                   TIMESTAMPTZ,
  reversed_at                 TIMESTAMPTZ,
  reversal_of_transaction_id  UUID REFERENCES fuel_inventory_transactions(id),
  version                     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_fuel_tx_status_date
  ON fuel_inventory_transactions (status, operational_date);
CREATE INDEX IF NOT EXISTS idx_fuel_tx_locations
  ON fuel_inventory_transactions (source_location_id, destination_location_id);
CREATE INDEX IF NOT EXISTS idx_fuel_tx_fuel_log
  ON fuel_inventory_transactions (fuel_log_id) WHERE fuel_log_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fuel_inventory_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES fuel_inventory_transactions(id) ON DELETE CASCADE,
  direction       VARCHAR(4) NOT NULL CHECK (direction IN ('in', 'out')),
  quantity_liter  NUMERIC(16,3) NOT NULL CHECK (quantity_liter > 0),
  unit_price      NUMERIC(18,4),
  total_value     NUMERIC(20,4),
  batch_number    VARCHAR(100),
  source_reference VARCHAR(150),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fuel_lines_tx
  ON fuel_inventory_lines (transaction_id);

CREATE TABLE IF NOT EXISTS fuel_inventory_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     VARCHAR(50) NOT NULL,
  entity_id       UUID NOT NULL,
  action          VARCHAR(50) NOT NULL,
  before_data     JSONB,
  after_data      JSONB,
  reason          TEXT,
  tenant_id       UUID,
  project_id      UUID,
  actor_id        UUID REFERENCES users(id),
  origin_device_id VARCHAR(100),
  sync_operation_id VARCHAR(100),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fuel_audit_entity
  ON fuel_inventory_audit (entity_type, entity_id, changed_at DESC);

COMMENT ON TABLE fuel_inventory_transactions IS 'Ledger inventory Fuel P1 (FIFO/opname menyusul). Saldo = agregat lines posted.';
