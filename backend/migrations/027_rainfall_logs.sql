BEGIN;

CREATE TABLE IF NOT EXISTS rainfall_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_date DATE NOT NULL,
  shift_id UUID NOT NULL REFERENCES shifts(id),
  area_name VARCHAR(200) NOT NULL,
  job_code VARCHAR(20) NOT NULL,
  rain_start TIME,
  rain_finish TIME,
  intensity VARCHAR(100),
  slippery_start TIME,
  slippery_finish TIME,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT rainfall_rain_interval_pair CHECK ((rain_start IS NULL) = (rain_finish IS NULL)),
  CONSTRAINT rainfall_slippery_interval_pair CHECK ((slippery_start IS NULL) = (slippery_finish IS NULL)),
  CONSTRAINT rainfall_has_operational_event CHECK (rain_start IS NOT NULL OR slippery_start IS NOT NULL),
  CONSTRAINT rainfall_intensity_required CHECK (rain_start IS NULL OR NULLIF(TRIM(intensity), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_rainfall_logs_period_area
  ON rainfall_logs (operational_date, area_name, shift_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rainfall_logs_job_period
  ON rainfall_logs (job_code, operational_date)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS rainfall_log_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rainfall_log_id UUID NOT NULL REFERENCES rainfall_logs(id),
  action VARCHAR(20) NOT NULL CHECK (action IN ('create','update','delete')),
  previous_value JSONB,
  new_value JSONB,
  actor_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rainfall_log_audit_record
  ON rainfall_log_audit (rainfall_log_id, created_at DESC);

COMMIT;
