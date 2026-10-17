BEGIN;

-- Preserve the exact set of incidents that were still waiting for the retired
-- second-stage verification so the migration can resolve only those records.
CREATE TEMP TABLE retired_breakdown_ready_ids (
  breakdown_id UUID PRIMARY KEY,
  equipment_id UUID NOT NULL,
  release_at TIMESTAMPTZ NOT NULL
) ON COMMIT DROP;

INSERT INTO retired_breakdown_ready_ids (breakdown_id, equipment_id, release_at)
SELECT id, equipment_id, COALESCE(repair_completed_at, updated_at, CURRENT_TIMESTAMP)
FROM breakdown_logs
WHERE deleted_at IS NULL
  AND status = 'open'
  AND current_status = 'awaiting_verification';

-- End legacy waiting segments at the maintenance release time. They remain in
-- history for audit, but never add breakdown hours (counts_as_breakdown=false).
UPDATE breakdown_status_history h
SET ended_at = GREATEST(h.started_at, r.release_at),
    note = COALESCE(h.note, 'Workflow Verifikasi Ready dihentikan; unit release langsung oleh Maintenance.')
FROM retired_breakdown_ready_ids r
WHERE h.breakdown_id = r.breakdown_id
  AND h.status = 'awaiting_verification'
  AND h.ended_at IS NULL;

UPDATE breakdown_logs bl
SET status = 'resolved',
    current_status = 'resolved',
    finish_time = r.release_at,
    repair_completed_at = r.release_at,
    repair_completed_by = COALESCE(bl.repair_completed_by, bl.updated_by, bl.created_by),
    total_breakdown_hours = COALESCE((
      SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(h.ended_at, r.release_at) - h.started_at)) / 3600))
      FROM breakdown_status_history h
      WHERE h.breakdown_id = bl.id AND h.counts_as_breakdown = TRUE
    ), 0),
    updated_at = CURRENT_TIMESTAMP
FROM retired_breakdown_ready_ids r
WHERE bl.id = r.breakdown_id;

UPDATE equipment e
SET status_alat = 'Ready'
WHERE e.id IN (SELECT equipment_id FROM retired_breakdown_ready_ids)
  AND NOT EXISTS (
    SELECT 1 FROM breakdown_logs active
    WHERE active.equipment_id = e.id
      AND active.status = 'open'
      AND active.deleted_at IS NULL
  );

-- Retire every generated verification standby from operational views and KPI
-- calculations while retaining its before/after record in the standby audit.
INSERT INTO standby_log_audit (standby_log_id, action, before_data, after_data, changed_by)
SELECT sl.id,
       'retire_breakdown_ready_workflow',
       to_jsonb(sl),
       to_jsonb(sl) || jsonb_build_object(
         'lifecycle_status', 'cancelled',
         'total_standby_hours', 0,
         'deleted_at', CURRENT_TIMESTAMP,
         'retirement_reason', 'Breakdown release sekarang langsung menjadi Ready'
       ),
       NULL
FROM standby_logs sl
WHERE sl.deleted_at IS NULL
  AND sl.source_type = 'breakdown_verification';

UPDATE standby_logs
SET lifecycle_status = 'cancelled',
    finish_time = COALESCE(finish_time, start_time),
    total_standby_hours = 0,
    review_status = 'approved',
    reclassified_at = CURRENT_TIMESTAMP,
    reclassified_reason = 'Workflow Verifikasi Ready dihentikan; tidak dihitung sebagai Standby.',
    deleted_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE deleted_at IS NULL
  AND source_type = 'breakdown_verification';

-- Keep the master row for foreign-key history, but remove it from all active
-- master-data choices. Temporarily lift its legacy protection trigger only for
-- this controlled migration, then restore the generic guard.
DROP TRIGGER IF EXISTS trg_protect_locked_standby_code ON master_standby_codes;

UPDATE master_standby_codes
SET is_system = TRUE,
    is_locked = TRUE,
    deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE kode = 'STB-SYS-01';

CREATE TRIGGER trg_protect_locked_standby_code
BEFORE UPDATE OR DELETE ON master_standby_codes
FOR EACH ROW EXECUTE FUNCTION protect_locked_standby_code();

-- Future breakdown rows can no longer enter the retired intermediate status.
ALTER TABLE breakdown_logs
  DROP CONSTRAINT IF EXISTS breakdown_logs_current_status_check;
ALTER TABLE breakdown_logs
  ADD CONSTRAINT breakdown_logs_current_status_check
  CHECK (current_status IN (
    'mechanic_progress', 'waiting_part', 'waiting_tool',
    'waiting_manpower', 'waiting_vendor', 'resolved'
  ));

COMMENT ON TABLE breakdown_ready_verifications IS
  'Historical audit only. Workflow retired by migration 046; application no longer writes or exposes this table.';

COMMIT;
