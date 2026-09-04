ALTER TABLE mining_production_logs
  ADD COLUMN IF NOT EXISTS hm_anomaly_status VARCHAR(20) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS hm_anomaly_reason TEXT,
  ADD COLUMN IF NOT EXISTS hm_anomaly_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS hm_validated_at TIMESTAMPTZ;

