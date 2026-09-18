BEGIN;

CREATE TABLE IF NOT EXISTS production_fuel_allocation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_count INTEGER NOT NULL CHECK (transaction_count > 0 AND transaction_count <= 100),
  total_liters NUMERIC NOT NULL CHECK (total_liters > 0),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE production_fuel_allocation_audit
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES production_fuel_allocation_batches(id);

CREATE INDEX IF NOT EXISTS production_fuel_allocation_audit_batch
  ON production_fuel_allocation_audit(batch_id, created_at DESC)
  WHERE batch_id IS NOT NULL;

COMMIT;
