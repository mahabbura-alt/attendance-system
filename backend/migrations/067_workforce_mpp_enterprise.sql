BEGIN;

-- P0 MPP Enterprise: alasan/catatan/prioritas per bulan, concurrency revision,
-- dan audit kebutuhan. Idempoten; tidak mengubah data historis.
ALTER TABLE workforce_mpp_line_periods ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE workforce_mpp_line_periods ADD COLUMN IF NOT EXISTS reason_text TEXT;
ALTER TABLE workforce_mpp_line_periods ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE workforce_mpp_line_periods ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE workforce_mpp_line_periods ADD COLUMN IF NOT EXISTS needed_by DATE;
ALTER TABLE workforce_mpp_line_periods ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workforce_mpp_line_periods ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE workforce_mpp_line_periods ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_mpp_period_priority') THEN
    ALTER TABLE workforce_mpp_line_periods ADD CONSTRAINT ck_mpp_period_priority
      CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_mpp_period_needed_by') THEN
    ALTER TABLE workforce_mpp_line_periods ADD CONSTRAINT ck_mpp_period_needed_by
      CHECK (needed_by IS NULL OR needed_by >= date_trunc('month', period_month)::date);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workforce_mpp_requirement_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  plan_id UUID REFERENCES workforce_mpp_plans(id),
  line_id UUID REFERENCES workforce_mpp_lines(id),
  period_month DATE NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','REVISION','APPROVAL')),
  previous_value JSONB,
  new_value JSONB,
  actor_id UUID REFERENCES users(id),
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mpp_requirement_audit_lookup
  ON workforce_mpp_requirement_audit (tenant_key, project_key, period_month, line_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpp_requirement_audit_idempotency
  ON workforce_mpp_requirement_audit (tenant_key, project_key, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE workforce_mpp_requirement_audit IS 'Audit append-only perubahan kebutuhan MPP per bulan (P0 enterprise).';

COMMIT;
