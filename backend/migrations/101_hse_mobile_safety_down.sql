-- Rollback 101_hse_mobile_safety.sql
-- PERINGATAN: menghapus data permintaan PIC, delegator, notifikasi, revisi, timeline, dan Pertemuan K3.
-- Hazard berstatus CANCELLED dikembalikan ke REJECTED agar constraint lama tetap valid.
-- Kolom users.must_change_password & password_reset_requests (milik 043) TIDAK dihapus.

BEGIN;

DROP TABLE IF EXISTS hse_meetings;
DROP INDEX IF EXISTS uq_hse_safetytalk_events_client_uuid;
ALTER TABLE hse_safetytalk_events DROP COLUMN IF EXISTS client_uuid;
DROP INDEX IF EXISTS uq_hse_p5m_events_client_uuid;
ALTER TABLE hse_p5m_events DROP COLUMN IF EXISTS client_uuid;
DROP INDEX IF EXISTS uq_hse_inspections_client_uuid;
ALTER TABLE hse_inspections DROP COLUMN IF EXISTS client_uuid;
ALTER TABLE hse_inspection_answers DROP COLUMN IF EXISTS photo;

DROP INDEX IF EXISTS uq_incidents_client_uuid;
ALTER TABLE incidents
  DROP COLUMN IF EXISTS client_uuid,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS immediate_action,
  DROP COLUMN IF EXISTS unit_code,
  DROP COLUMN IF EXISTS reported_category,
  DROP COLUMN IF EXISTS is_urgent;

DROP TABLE IF EXISTS hse_notifications;
DROP TABLE IF EXISTS hse_pic_requests;
DROP TABLE IF EXISTS hse_department_delegators;

ALTER TABLE hse_actions
  DROP COLUMN IF EXISTS due_at,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS extension_count,
  DROP COLUMN IF EXISTS evidence_note,
  DROP COLUMN IF EXISTS rejected_at,
  DROP COLUMN IF EXISTS rejected_reason,
  DROP COLUMN IF EXISTS escalated_at;

DROP TABLE IF EXISTS hse_hazard_events;
DROP TABLE IF EXISTS hse_hazard_revisions;

UPDATE hazard_reports SET status = 'REJECTED' WHERE status = 'CANCELLED';
ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_status_check;
ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_status_check
  CHECK (status IN ('NEW','ASSESSED','IN_ACTION','VERIFY','CLOSED','REJECTED','DUPLICATE'));

DROP INDEX IF EXISTS uq_hazard_reports_client_uuid;
ALTER TABLE hazard_reports
  DROP COLUMN IF EXISTS client_uuid,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS immediate_action,
  DROP COLUMN IF EXISTS stop_work,
  DROP COLUMN IF EXISTS is_urgent,
  DROP COLUMN IF EXISTS occurred_at,
  DROP COLUMN IF EXISTS revision_no,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancel_reason;

COMMIT;
