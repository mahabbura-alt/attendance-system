-- Database HM sourced from Input Data. Existing payroll HM before cutover is retained.
CREATE TABLE IF NOT EXISTS hm_worklog_cutover (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO hm_worklog_cutover (id, effective_date)
VALUES (TRUE, (now() AT TIME ZONE 'Asia/Jakarta')::date)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS hm_worklog_reviews (
  work_log_id UUID PRIMARY KEY REFERENCES mining_production_logs(id),
  paid_hm NUMERIC(10,2) NOT NULL CHECK (paid_hm >= 0 AND paid_hm <= 24),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  source_updated_at TIMESTAMPTZ NOT NULL,
  reviewed_by UUID NOT NULL REFERENCES users(id),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hm_worklog_reviews_reviewer
  ON hm_worklog_reviews (reviewed_by, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS hm_worklog_review_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_log_id UUID NOT NULL REFERENCES mining_production_logs(id),
  previous_value JSONB,
  new_value JSONB NOT NULL,
  changed_by UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hm_worklog_review_audit_log
  ON hm_worklog_review_audit (work_log_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_mining_production_logs_hm_operator_date
  ON mining_production_logs (operator_id, tanggal)
  WHERE deleted_at IS NULL;
