BEGIN;

-- Draft deployment schemes may include an active Excavator whose Loader
-- Productivity is not configured for every operational day. Published rows
-- remain protected by fleet_deployment_days.completeness validation.
ALTER TABLE fleet_deployment_assignments
  ALTER COLUMN plan_productivity DROP NOT NULL;

COMMIT;
