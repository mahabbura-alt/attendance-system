-- Rollback 097. Pergerakan berjenis baru harus dibatalkan/dihapus dulu,
-- jika ada, sebelum CHECK lama dipasang kembali.
DROP TABLE IF EXISTS people_outbox;
ALTER TABLE workforce_employee_profiles
  DROP COLUMN IF EXISTS void_reason, DROP COLUMN IF EXISTS voided_by, DROP COLUMN IF EXISTS voided_at,
  DROP COLUMN IF EXISTS last_working_day, DROP COLUMN IF EXISTS contract_no;
DROP INDEX IF EXISTS idx_workforce_movement_last_working_day;
ALTER TABLE workforce_employee_movements
  DROP CONSTRAINT IF EXISTS chk_movement_evaluation_result,
  DROP CONSTRAINT IF EXISTS chk_movement_contract_dates,
  DROP CONSTRAINT IF EXISTS chk_movement_last_working_day;
ALTER TABLE workforce_employee_movements
  DROP COLUMN IF EXISTS self_approval_reason, DROP COLUMN IF EXISTS rehire_eligible,
  DROP COLUMN IF EXISTS evaluation_result, DROP COLUMN IF EXISTS contract_end_date,
  DROP COLUMN IF EXISTS contract_start_date, DROP COLUMN IF EXISTS contract_no,
  DROP COLUMN IF EXISTS last_working_day;
ALTER TABLE workforce_employee_movements DROP CONSTRAINT IF EXISTS workforce_employee_movements_movement_type_check;
ALTER TABLE workforce_employee_movements
  ADD CONSTRAINT workforce_employee_movements_movement_type_check CHECK (movement_type IN
    ('HIRE','REHIRE','TRANSFER','PROMOTION','DEMOTION','RESIGN','TERMINATION','CONTRACT_END','RETIREMENT'));
