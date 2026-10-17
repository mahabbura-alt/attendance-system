BEGIN;

ALTER TABLE employee_leave_requests
  ADD COLUMN IF NOT EXISTS application_group_id UUID,
  ADD COLUMN IF NOT EXISTS projection_start DATE,
  ADD COLUMN IF NOT EXISTS projection_end DATE,
  ADD COLUMN IF NOT EXISTS owning_year INTEGER;

ALTER TABLE employee_leave_requests
  DROP CONSTRAINT IF EXISTS employee_leave_requests_owning_year_check;
ALTER TABLE employee_leave_requests
  ADD CONSTRAINT employee_leave_requests_owning_year_check
  CHECK (owning_year IS NULL OR owning_year BETWEEN 2000 AND 2200);

UPDATE employee_leave_requests
SET owning_year = EXTRACT(YEAR FROM planned_start)::int
WHERE owning_year IS NULL;

CREATE INDEX IF NOT EXISTS idx_leave_request_cycle_owner
  ON employee_leave_requests
    (tenant_key, project_key, user_id, owning_year, cycle_no, status);
CREATE INDEX IF NOT EXISTS idx_leave_request_application_group
  ON employee_leave_requests(application_group_id)
  WHERE application_group_id IS NOT NULL;

COMMIT;
