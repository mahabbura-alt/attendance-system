BEGIN;

ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS hm_reading NUMERIC(12,2);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS odometer_reading NUMERIC(14,2);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS hm_delta NUMERIC(12,4);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS distance_km NUMERIC(14,4);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS fuel_per_km NUMERIC(14,6);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS source_type VARCHAR(24) NOT NULL DEFAULT 'manual';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS fuel_ticket_no VARCHAR(100);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS record_status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS is_meter_reset BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS meter_reset_reason TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS anomaly_status VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS anomaly_details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Rasio Fuel/HM adalah nilai turunan. Pada pembacaan pertama suatu unit tidak
-- ada baseline counter, sehingga rasio harus NULL (ditampilkan sebagai "—"),
-- bukan 0. Presisi database disimpan 6 desimal; UI tetap menampilkan 2 desimal.
ALTER TABLE fuel_logs ALTER COLUMN fuel_per_hm TYPE NUMERIC(14,6) USING fuel_per_hm::NUMERIC(14,6);
ALTER TABLE fuel_logs ALTER COLUMN fuel_per_hm DROP NOT NULL;
ALTER TABLE fuel_logs ALTER COLUMN fuel_per_hm DROP DEFAULT;

UPDATE fuel_logs
SET hm_reading = COALESCE(hm_reading, hm_finish),
    hm_delta = COALESCE(hm_delta, NULLIF(total_hm, 0)),
    record_status = CASE WHEN record_status = 'draft' THEN 'migrated' ELSE record_status END,
    source_type = CASE WHEN source_type = 'manual' THEN 'legacy' ELSE source_type END
WHERE hm_reading IS NULL OR hm_delta IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_equipment_period
ON fuel_logs (equipment_id, tanggal, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_status
ON fuel_logs (approval_status, anomaly_status)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fuel_log_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_log_id     UUID NOT NULL REFERENCES fuel_logs(id),
    action          VARCHAR(30) NOT NULL,
    before_data     JSONB,
    after_data      JSONB,
    changed_by      UUID REFERENCES users(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fuel_log_audit_log
ON fuel_log_audit (fuel_log_id, changed_at DESC);

COMMIT;
