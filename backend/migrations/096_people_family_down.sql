DROP VIEW IF EXISTS v_employee_family_summary;
DROP TABLE IF EXISTS employee_family_audit;
DROP TABLE IF EXISTS employee_family_members;
ALTER TABLE workforce_employee_profiles
  DROP COLUMN IF EXISTS family_updated_by, DROP COLUMN IF EXISTS family_updated_at,
  DROP COLUMN IF EXISTS marital_status_since, DROP COLUMN IF EXISTS marital_status;
