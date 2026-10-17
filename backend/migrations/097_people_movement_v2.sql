-- =====================================================================
-- 097_people_movement_v2.sql — Pergerakan karyawan v2 (T9/T10/T11/T12)
--
-- * Jenis baru: CONFIRMATION (lulus probation), CONTRACT_RENEWAL,
--   EMPLOYMENT_TYPE_CHANGE.
-- * last_working_day: karyawan keluar tetap aktif sampai hari ini;
--   dinonaktifkan otomatis H+1 oleh penjadwal harian.
-- * Data kontrak pada pergerakan; persetujuan diri sendiri (super admin)
--   wajib alasan.
-- * Void karyawan salah input (pengganti hapus permanen).
-- * people_outbox: event lintas modul yang diproses idempoten.
-- =====================================================================

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'workforce_employee_movements'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%movement_type%'
  LOOP
    EXECUTE format('ALTER TABLE workforce_employee_movements DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE workforce_employee_movements
  ADD CONSTRAINT workforce_employee_movements_movement_type_check CHECK (movement_type IN
    ('HIRE','REHIRE','TRANSFER','PROMOTION','DEMOTION','RESIGN','TERMINATION','CONTRACT_END','RETIREMENT',
     'CONFIRMATION','CONTRACT_RENEWAL','EMPLOYMENT_TYPE_CHANGE'));

ALTER TABLE workforce_employee_movements
  ADD COLUMN IF NOT EXISTS last_working_day DATE,
  ADD COLUMN IF NOT EXISTS contract_no TEXT,
  ADD COLUMN IF NOT EXISTS contract_start_date DATE,
  ADD COLUMN IF NOT EXISTS contract_end_date DATE,
  ADD COLUMN IF NOT EXISTS evaluation_result TEXT,
  ADD COLUMN IF NOT EXISTS rehire_eligible BOOLEAN,
  ADD COLUMN IF NOT EXISTS self_approval_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_movement_last_working_day') THEN
    ALTER TABLE workforce_employee_movements ADD CONSTRAINT chk_movement_last_working_day
      CHECK (last_working_day IS NULL OR movement_type IN ('RESIGN','TERMINATION','CONTRACT_END','RETIREMENT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_movement_contract_dates') THEN
    ALTER TABLE workforce_employee_movements ADD CONSTRAINT chk_movement_contract_dates
      CHECK (contract_end_date IS NULL OR contract_start_date IS NULL OR contract_end_date >= contract_start_date);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_movement_evaluation_result') THEN
    ALTER TABLE workforce_employee_movements ADD CONSTRAINT chk_movement_evaluation_result
      CHECK (evaluation_result IS NULL OR evaluation_result IN ('PASSED','EXTENDED','FAILED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workforce_movement_last_working_day
  ON workforce_employee_movements (tenant_key, last_working_day)
  WHERE last_working_day IS NOT NULL;

ALTER TABLE workforce_employee_profiles
  ADD COLUMN IF NOT EXISTS contract_no TEXT,
  ADD COLUMN IF NOT EXISTS last_working_day DATE,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE TABLE IF NOT EXISTS people_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key    TEXT NOT NULL DEFAULT 'default',
  event_type    TEXT NOT NULL,
  aggregate_id  UUID NOT NULL,
  dedupe_key    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at  TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  UNIQUE (tenant_key, event_type, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_people_outbox_pending
  ON people_outbox (created_at) WHERE processed_at IS NULL;
