ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id_unique
  ON users (employee_id)
  WHERE employee_id IS NOT NULL;
