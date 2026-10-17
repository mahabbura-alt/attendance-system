BEGIN;

ALTER TABLE ritase_logs
  ADD COLUMN IF NOT EXISTS nonprod_ritase_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nonprod_updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS nonprod_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_ritase_nonprod_nonnegative'
  ) THEN
    ALTER TABLE ritase_logs ADD CONSTRAINT ck_ritase_nonprod_nonnegative
      CHECK (nonprod_ritase_count >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_ritase_nonprod_not_over_gross'
  ) THEN
    ALTER TABLE ritase_logs ADD CONSTRAINT ck_ritase_nonprod_not_over_gross
      CHECK (nonprod_ritase_count <= ritase_count);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ritase_nonprod_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ritase_log_id UUID NOT NULL REFERENCES ritase_logs(id),
  fleet_mapping_id UUID NOT NULL REFERENCES fleet_mappings(id),
  dump_truck_id UUID NOT NULL REFERENCES equipment(id),
  period_hour SMALLINT NOT NULL CHECK (period_hour BETWEEN 0 AND 23),
  gross_ritase_count INTEGER NOT NULL CHECK (gross_ritase_count >= 0),
  previous_nonprod_ritase_count INTEGER NOT NULL CHECK (previous_nonprod_ritase_count >= 0),
  new_nonprod_ritase_count INTEGER NOT NULL CHECK (new_nonprod_ritase_count >= 0),
  formula_version VARCHAR(50) NOT NULL DEFAULT 'productive-ritase-v1',
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ritase_nonprod_audit_log
  ON ritase_nonprod_audit (ritase_log_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ritase_nonprod_audit_fleet
  ON ritase_nonprod_audit (fleet_mapping_id, period_hour, changed_at DESC);

COMMENT ON COLUMN ritase_logs.nonprod_ritase_count IS
  'Bagian ritase bruto yang tidak dihitung sebagai produksi. Ritase produktif = ritase_count - nonprod_ritase_count.';
COMMENT ON TABLE ritase_nonprod_audit IS
  'Audit append-only perubahan Non Prod / Inpit per fleet, dump truck, dan jam.';

COMMIT;
