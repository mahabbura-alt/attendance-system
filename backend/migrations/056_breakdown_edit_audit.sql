BEGIN;

CREATE TABLE IF NOT EXISTS breakdown_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  breakdown_id UUID NOT NULL REFERENCES breakdown_logs(id),
  part_id UUID REFERENCES breakdown_parts(id),
  action VARCHAR(40) NOT NULL CHECK (action IN ('damage_code_changed', 'part_deleted')),
  before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_data JSONB,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_breakdown_change_audit_incident
  ON breakdown_change_audit (breakdown_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_breakdown_change_audit_part
  ON breakdown_change_audit (part_id, changed_at DESC)
  WHERE part_id IS NOT NULL;

COMMENT ON TABLE breakdown_change_audit IS
  'Jejak audit perubahan jenis kerusakan dan soft-delete Part/PO pada insiden breakdown.';

COMMIT;
