BEGIN;

-- Input Fuel menyimpan pembacaan fisik sebagai bukti dan Lifetime HM sebagai
-- basis kontinu untuk validasi serta perhitungan L/HM. Data historis tidak
-- ditebak ulang karena sebagian memakai counter virtual lama.
ALTER TABLE fuel_logs
  ADD COLUMN IF NOT EXISTS hm_meter_event_id UUID REFERENCES equipment_hm_meter_events(id),
  ADD COLUMN IF NOT EXISTS hm_lifetime_reading NUMERIC(16,2),
  ADD COLUMN IF NOT EXISTS hm_lineage_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS hm_lineage_reason TEXT;

UPDATE fuel_logs
SET hm_lineage_status = 'legacy_unreconciled',
    hm_lineage_reason = COALESCE(NULLIF(BTRIM(hm_lineage_reason), ''),
      'Pembacaan dibuat sebelum integrasi lifecycle HM; basis counter perlu direkonsiliasi.')
WHERE hm_lineage_status IS NULL;

ALTER TABLE fuel_logs
  ALTER COLUMN hm_lineage_status SET DEFAULT 'legacy_unreconciled',
  ALTER COLUMN hm_lineage_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fuel_logs_hm_lineage_status_check'
  ) THEN
    ALTER TABLE fuel_logs ADD CONSTRAINT fuel_logs_hm_lineage_status_check
      CHECK (hm_lineage_status IN ('legacy_unreconciled','baseline','derived','needs_reconciliation'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_lifetime_hm
  ON fuel_logs (equipment_id, tanggal, shift_id, hm_lifetime_reading)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_meter_event
  ON fuel_logs (hm_meter_event_id)
  WHERE hm_meter_event_id IS NOT NULL;

COMMIT;
