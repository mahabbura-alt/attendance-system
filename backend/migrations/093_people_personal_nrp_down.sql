-- Rollback 093 (data pribadi & pengaturan People). Data di users tidak tersentuh.
ALTER TABLE workforce_positions DROP CONSTRAINT IF EXISTS chk_workforce_positions_function_tag;
ALTER TABLE workforce_positions DROP COLUMN IF EXISTS function_tag;
DROP TABLE IF EXISTS workforce_employee_field_audit;
DROP TABLE IF EXISTS workforce_employee_personal;
DROP TABLE IF EXISTS people_settings;
