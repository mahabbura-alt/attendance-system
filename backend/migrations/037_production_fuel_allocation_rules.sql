BEGIN;

CREATE TABLE IF NOT EXISTS production_fuel_allocation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  area_name TEXT NOT NULL CHECK (NULLIF(TRIM(area_name), '') IS NOT NULL),
  job_code TEXT NOT NULL CHECK (NULLIF(TRIM(job_code), '') IS NOT NULL),
  effective_from DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  source_batch_id UUID REFERENCES production_fuel_allocation_batches(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (equipment_id, effective_from)
);

CREATE INDEX IF NOT EXISTS production_fuel_allocation_rules_lookup
  ON production_fuel_allocation_rules(equipment_id, effective_from DESC, created_at DESC);

COMMIT;
