BEGIN;

ALTER TABLE fleet_mappings
  ADD COLUMN IF NOT EXISTS pic_user_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_fleet_mappings_pic_user
  ON fleet_mappings (pic_user_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ritase_productivity_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_mapping_id UUID NOT NULL REFERENCES fleet_mappings(id),
  tanggal DATE NOT NULL,
  shift_id UUID REFERENCES shifts(id),
  excavator_id UUID REFERENCES equipment(id),
  pit_area VARCHAR(150),
  job_code VARCHAR(20),
  material VARCHAR(100),
  period_hour SMALLINT NOT NULL CHECK (period_hour BETWEEN 0 AND 23),
  plan_productivity NUMERIC(18,6) NOT NULL CHECK (plan_productivity > 0),
  actual_productivity NUMERIC(18,6) NOT NULL CHECK (actual_productivity >= 0),
  productivity_unit VARCHAR(20) NOT NULL,
  achievement_percentage NUMERIC(12,6) NOT NULL CHECK (achievement_percentage >= 0),
  shortfall_production NUMERIC(18,6) NOT NULL CHECK (shortfall_production >= 0),
  warning_threshold NUMERIC(6,2) NOT NULL DEFAULT 95,
  critical_threshold NUMERIC(6,2) NOT NULL DEFAULT 85,
  formula_version VARCHAR(30) NOT NULL DEFAULT 'ritase-hourly-v1',
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','closed')),
  notes TEXT,
  evidence_url TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ritase_productivity_exception_hour
  ON ritase_productivity_exceptions (fleet_mapping_id, period_hour)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ritase_productivity_exception_history
  ON ritase_productivity_exceptions (tanggal DESC, shift_id, pit_area, job_code)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ritase_productivity_exception_problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id UUID NOT NULL REFERENCES ritase_productivity_exceptions(id) ON DELETE CASCADE,
  problem_code_id UUID NOT NULL REFERENCES master_problem_codes(id),
  problem_code_snapshot VARCHAR(20) NOT NULL,
  problem_category_snapshot VARCHAR(20) NOT NULL,
  problem_description_snapshot VARCHAR(200) NOT NULL,
  impact_minutes NUMERIC(6,2) NOT NULL CHECK (impact_minutes > 0 AND impact_minutes <= 60),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ritase_exception_problem
  ON ritase_productivity_exception_problems (exception_id, problem_code_id)
  WHERE deleted_at IS NULL;

COMMIT;
