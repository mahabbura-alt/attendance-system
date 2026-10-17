-- =====================================================================
-- Migration 085: Modul HSE - Jadwal Objek Inspeksi (hse_inspection_schedules)
-- Mengacu pada RENCANA_SETUP_INSPEKSI_HSE_V2.md Bagian 3.3
-- =====================================================================

CREATE TABLE IF NOT EXISTS hse_inspection_schedules (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key           TEXT NOT NULL DEFAULT 'default',
  project_key          TEXT NOT NULL DEFAULT 'default',
  template_root_id     UUID NOT NULL REFERENCES hse_inspection_templates(id) ON DELETE RESTRICT,
  location_id          UUID REFERENCES hse_locations(id) ON DELETE RESTRICT,
  asset_id             UUID,
  assignee_type        TEXT NOT NULL CHECK (assignee_type IN ('EMPLOYEE', 'POSITION')),
  assignee_employee_id UUID REFERENCES users(id)               ON DELETE RESTRICT,
  assignee_position_id UUID REFERENCES workforce_positions(id) ON DELETE RESTRICT,
  start_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  next_due_date        DATE,
  last_done_at         TIMESTAMPTZ,
  notes                TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMPTZ,
  CONSTRAINT chk_sched_object CHECK (location_id IS NOT NULL OR asset_id IS NOT NULL),
  CONSTRAINT chk_sched_assignee CHECK (
       (assignee_type = 'EMPLOYEE' AND assignee_employee_id IS NOT NULL AND assignee_position_id IS NULL)
    OR (assignee_type = 'POSITION' AND assignee_position_id IS NOT NULL AND assignee_employee_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_hse_insp_sched_due
  ON hse_inspection_schedules (tenant_key, project_key, next_due_date)
  WHERE is_active AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hse_insp_sched_tmpl
  ON hse_inspection_schedules (template_root_id);

CREATE INDEX IF NOT EXISTS idx_hse_insp_sched_location
  ON hse_inspection_schedules (location_id);

-- ---------------------------------------------------------------------
-- Tambahkan kolom penaut ke hse_inspections
-- ---------------------------------------------------------------------
ALTER TABLE hse_inspections
  ADD COLUMN IF NOT EXISTS schedule_id   UUID REFERENCES hse_inspection_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;

-- Backfill completed_at untuk inspeksi lama yang berstatus COMPLETED
UPDATE hse_inspections
   SET completed_at = inspected_at
 WHERE status = 'COMPLETED' AND completed_at IS NULL;
