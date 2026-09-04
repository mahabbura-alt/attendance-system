BEGIN;

ALTER TABLE master_standby_codes
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO master_standby_codes (
  kode, kategori, deskripsi, is_system, is_locked, deleted_at, updated_at
) VALUES (
  'STB-SYS-01',
  'Waiting Production Verification',
  'Unit selesai diperbaiki dan menunggu verifikasi ready oleh Produksi.',
  TRUE,
  TRUE,
  NULL,
  CURRENT_TIMESTAMP
)
ON CONFLICT (kode) DO UPDATE SET
  kategori = EXCLUDED.kategori,
  deskripsi = EXCLUDED.deskripsi,
  is_system = TRUE,
  is_locked = TRUE,
  deleted_at = NULL,
  updated_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION protect_locked_standby_code()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_locked THEN
    RAISE EXCEPTION 'Kode standby sistem tidak dapat dihapus.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_locked AND (
    NEW.kode IS DISTINCT FROM OLD.kode OR
    NEW.kategori IS DISTINCT FROM OLD.kategori OR
    NEW.deskripsi IS DISTINCT FROM OLD.deskripsi OR
    NEW.is_system IS DISTINCT FROM TRUE OR
    NEW.is_locked IS DISTINCT FROM TRUE OR
    NEW.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Kode standby sistem bersifat read only.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_locked_standby_code ON master_standby_codes;
CREATE TRIGGER trg_protect_locked_standby_code
BEFORE UPDATE OR DELETE ON master_standby_codes
FOR EACH ROW EXECUTE FUNCTION protect_locked_standby_code();

ALTER TABLE standby_logs
  ALTER COLUMN finish_time DROP NOT NULL,
  ALTER COLUMN total_standby_hours TYPE NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_reference_id UUID,
  ADD COLUMN IF NOT EXISTS source_sequence INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS is_system_generated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS reclassified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reclassified_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

UPDATE standby_logs
SET lifecycle_status = CASE WHEN finish_time IS NULL THEN 'open' ELSE 'confirmed' END,
    source_type = COALESCE(NULLIF(source_type, ''), 'manual'),
    source_sequence = GREATEST(1, COALESCE(source_sequence, 1)),
    updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);

ALTER TABLE standby_logs DROP CONSTRAINT IF EXISTS standby_logs_lifecycle_status_check;
ALTER TABLE standby_logs ADD CONSTRAINT standby_logs_lifecycle_status_check
  CHECK (lifecycle_status IN ('open', 'confirmed', 'reclassified', 'cancelled'));
ALTER TABLE standby_logs DROP CONSTRAINT IF EXISTS standby_logs_review_status_check;
ALTER TABLE standby_logs ADD CONSTRAINT standby_logs_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'returned'));
ALTER TABLE standby_logs DROP CONSTRAINT IF EXISTS standby_logs_source_sequence_check;
ALTER TABLE standby_logs ADD CONSTRAINT standby_logs_source_sequence_check
  CHECK (source_sequence >= 1);
ALTER TABLE standby_logs DROP CONSTRAINT IF EXISTS standby_logs_time_order_check;
ALTER TABLE standby_logs ADD CONSTRAINT standby_logs_time_order_check
  CHECK (finish_time IS NULL OR finish_time >= start_time);

CREATE UNIQUE INDEX IF NOT EXISTS uq_standby_system_source_attempt
  ON standby_logs (source_type, source_reference_id, source_sequence)
  WHERE source_reference_id IS NOT NULL AND is_system_generated = TRUE;
CREATE INDEX IF NOT EXISTS idx_standby_logs_period_unit
  ON standby_logs (start_time, finish_time, equipment_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_standby_logs_filters
  ON standby_logs (standby_code_id, shift_id, review_status, lifecycle_status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS standby_log_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standby_log_id UUID NOT NULL REFERENCES standby_logs(id) ON DELETE CASCADE,
  action VARCHAR(40) NOT NULL,
  before_data JSONB,
  after_data JSONB,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_standby_log_audit_log
  ON standby_log_audit (standby_log_id, changed_at DESC);

ALTER TABLE breakdown_logs
  ADD COLUMN IF NOT EXISTS release_attempt INTEGER NOT NULL DEFAULT 0;

ALTER TABLE breakdown_status_history
  ADD COLUMN IF NOT EXISTS counts_as_breakdown BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE breakdown_status_history
SET counts_as_breakdown = FALSE
WHERE status = 'awaiting_verification';

ALTER TABLE breakdown_ready_verifications
  ADD COLUMN IF NOT EXISTS rejection_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS standby_log_id UUID REFERENCES standby_logs(id),
  ADD COLUMN IF NOT EXISTS related_breakdown_id UUID REFERENCES breakdown_logs(id),
  ADD COLUMN IF NOT EXISTS ready_effective_at TIMESTAMPTZ;
UPDATE breakdown_ready_verifications
SET ready_effective_at=verified_at
WHERE result='approved' AND ready_effective_at IS NULL;
ALTER TABLE breakdown_ready_verifications
  DROP CONSTRAINT IF EXISTS breakdown_ready_verifications_rejection_type_check;
ALTER TABLE breakdown_ready_verifications
  ADD CONSTRAINT breakdown_ready_verifications_rejection_type_check CHECK (
    (result = 'approved' AND rejection_type IS NULL)
    OR (result = 'rejected' AND rejection_type IN ('same_fault', 'new_fault'))
    OR (result = 'rejected' AND rejection_type IS NULL)
  );

COMMIT;
