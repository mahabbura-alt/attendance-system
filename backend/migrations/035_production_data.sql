BEGIN;

-- Operational data belongs to this deployment's isolated client database,
-- matching fuel_logs and fleet_mappings; no client-supplied tenant selector.
CREATE TABLE IF NOT EXISTS production_fuel_allocation_sets (
  fuel_log_id UUID PRIMARY KEY REFERENCES fuel_logs(id),
  source_fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  allocations JSONB NOT NULL CHECK (jsonb_typeof(allocations) = 'array'),
  reason TEXT NOT NULL,
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS production_fuel_allocation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_log_id UUID NOT NULL REFERENCES fuel_logs(id),
  previous_value JSONB,
  new_value JSONB NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_fuel_allocation_audit_source
  ON production_fuel_allocation_audit(fuel_log_id, created_at DESC);

-- Snapshot is explicit, append-only and tied to fleet identity/material/JOB.
CREATE TABLE IF NOT EXISTS production_density_snapshots (
  fleet_mapping_id UUID NOT NULL REFERENCES fleet_mappings(id),
  identity_key TEXT NOT NULL,
  density NUMERIC NOT NULL CHECK (density > 0),
  plan_ref TEXT NOT NULL,
  plan_updated_at TIMESTAMPTZ,
  captured_by UUID NOT NULL REFERENCES users(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fleet_mapping_id, identity_key)
);
COMMIT;
