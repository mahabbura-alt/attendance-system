-- Standby MOHH control, shift closing/freeze, and standby-code governance.

ALTER TABLE master_standby_codes
  ADD COLUMN IF NOT EXISTS planning_type VARCHAR(20) NOT NULL DEFAULT 'unplanned',
  ADD COLUMN IF NOT EXISTS control_class VARCHAR(20) NOT NULL DEFAULT 'controllable',
  ADD COLUMN IF NOT EXISTS owner_department VARCHAR(80) NOT NULL DEFAULT 'Production',
  ADD COLUMN IF NOT EXISTS requires_description BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requires_evidence BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE master_standby_codes ADD CONSTRAINT master_standby_codes_planning_type_check
    CHECK (planning_type IN ('planned','unplanned'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE master_standby_codes ADD CONSTRAINT master_standby_codes_control_class_check
    CHECK (control_class IN ('controllable','uncontrollable'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS standby_shift_closures (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_date        DATE NOT NULL,
  shift_id                UUID NOT NULL REFERENCES shifts(id),
  equipment_id            UUID NOT NULL REFERENCES equipment(id),
  status                  VARCHAR(20) NOT NULL DEFAULT 'closed' CHECK (status IN ('closed','reopened')),
  target_mohh_hours       NUMERIC(14,6) NOT NULL DEFAULT 12,
  hm_hours_snapshot       NUMERIC(14,6) NOT NULL DEFAULT 0,
  breakdown_hours_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0,
  standby_hours_snapshot  NUMERIC(14,6) NOT NULL DEFAULT 0,
  accounted_hours_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0,
  balance_hours_snapshot  NUMERIC(14,6) NOT NULL DEFAULT 0,
  close_note              TEXT,
  closed_by               UUID REFERENCES users(id),
  closed_at               TIMESTAMPTZ,
  reopened_by             UUID REFERENCES users(id),
  reopened_at             TIMESTAMPTZ,
  reopen_reason           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (operational_date, shift_id, equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_standby_shift_closures_scope
  ON standby_shift_closures (operational_date, shift_id, equipment_id, status);

CREATE TABLE IF NOT EXISTS standby_shift_closure_audit (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_id        UUID NOT NULL REFERENCES standby_shift_closures(id) ON DELETE CASCADE,
  action            VARCHAR(30) NOT NULL,
  snapshot          JSONB NOT NULL DEFAULT '{}'::jsonb,
  note              TEXT,
  changed_by        UUID REFERENCES users(id),
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_standby_shift_closure_audit
  ON standby_shift_closure_audit (closure_id, changed_at DESC);
