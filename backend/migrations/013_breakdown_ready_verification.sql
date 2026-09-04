BEGIN;

ALTER TABLE breakdown_logs
  ADD COLUMN IF NOT EXISTS repair_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS repair_completed_by UUID REFERENCES users(id);

UPDATE breakdown_logs
SET repair_completed_at = COALESCE(repair_completed_at, finish_time),
    repair_completed_by = COALESCE(repair_completed_by, updated_by, created_by)
WHERE status = 'resolved' AND repair_completed_at IS NULL;

ALTER TABLE breakdown_logs
  DROP CONSTRAINT IF EXISTS breakdown_logs_current_status_check;
ALTER TABLE breakdown_logs
  ADD CONSTRAINT breakdown_logs_current_status_check
  CHECK (current_status IN (
    'mechanic_progress', 'waiting_part', 'waiting_tool',
    'waiting_manpower', 'waiting_vendor', 'awaiting_verification', 'resolved'
  ));

ALTER TABLE breakdown_status_history
  DROP CONSTRAINT IF EXISTS breakdown_status_history_status_check;
ALTER TABLE breakdown_status_history
  ADD CONSTRAINT breakdown_status_history_status_check
  CHECK (status IN (
    'mechanic_progress', 'waiting_part', 'waiting_tool',
    'waiting_manpower', 'waiting_vendor', 'awaiting_verification'
  ));

CREATE TABLE IF NOT EXISTS breakdown_ready_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  breakdown_id UUID NOT NULL REFERENCES breakdown_logs(id) ON DELETE CASCADE,
  result VARCHAR(20) NOT NULL CHECK (result IN ('approved', 'rejected')),
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  meter_hm NUMERIC(14,2),
  location TEXT,
  note TEXT,
  verified_by UUID NOT NULL REFERENCES users(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (meter_hm IS NULL OR meter_hm >= 0)
);

CREATE INDEX IF NOT EXISTS idx_breakdown_ready_verifications_incident
  ON breakdown_ready_verifications (breakdown_id, verified_at DESC);

INSERT INTO breakdown_ready_verifications (
  breakdown_id, result, checklist, note, verified_by, verified_at
)
SELECT
  bl.id,
  'approved',
  '{"legacy":true}'::jsonb,
  'Migrasi otomatis: unit telah selesai sebelum fitur Verifikasi Ready diterapkan.',
  COALESCE(bl.updated_by, bl.created_by),
  COALESCE(bl.finish_time, bl.updated_at, bl.created_at, now())
FROM breakdown_logs bl
WHERE bl.status = 'resolved'
  AND COALESCE(bl.updated_by, bl.created_by) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM breakdown_ready_verifications brv WHERE brv.breakdown_id = bl.id
  );

COMMIT;
