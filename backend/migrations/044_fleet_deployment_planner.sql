BEGIN;

CREATE TABLE IF NOT EXISTS fleet_deployment_schemes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(100) NOT NULL DEFAULT 'default',
  project_key VARCHAR(100) NOT NULL DEFAULT 'default',
  name VARCHAR(180) NOT NULL,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  pit_id UUID REFERENCES production_pits(id),
  pit_area_snapshot VARCHAR(100) NOT NULL,
  job_id UUID REFERENCES master_job_codes(id),
  job_code_snapshot VARCHAR(50) NOT NULL,
  material_snapshot VARCHAR(120) NOT NULL,
  planning_type VARCHAR(20) NOT NULL CHECK (planning_type IN ('ob','coal')),
  productivity_unit VARCHAR(20) NOT NULL CHECK (productivity_unit IN ('BCM/Hr','Ton/Hr')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','validated','published','closed','cancelled')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  published_by UUID REFERENCES users(id),
  closed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CHECK (date_end >= date_start)
);

CREATE INDEX IF NOT EXISTS idx_fleet_deployment_schemes_scope_period
  ON fleet_deployment_schemes (tenant_key, project_key, date_start, date_end)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fleet_deployment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id UUID NOT NULL REFERENCES fleet_deployment_schemes(id) ON DELETE CASCADE,
  tenant_key VARCHAR(100) NOT NULL DEFAULT 'default',
  project_key VARCHAR(100) NOT NULL DEFAULT 'default',
  excavator_id UUID NOT NULL REFERENCES equipment(id),
  fleet_plan_ref VARCHAR(180) NOT NULL,
  plan_table_id VARCHAR(180) NOT NULL,
  loader_code_snapshot VARCHAR(80) NOT NULL,
  productivity_plan_version_id UUID REFERENCES productivity_plan_versions(id),
  plan_productivity NUMERIC(16,4) NOT NULL CHECK (plan_productivity > 0),
  productivity_unit VARCHAR(20) NOT NULL CHECK (productivity_unit IN ('BCM/Hr','Ton/Hr')),
  formula_version VARCHAR(100),
  density_snapshot NUMERIC(16,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheme_id, excavator_id)
);

CREATE INDEX IF NOT EXISTS idx_fleet_deployment_assignments_scheme
  ON fleet_deployment_assignments (scheme_id);

CREATE TABLE IF NOT EXISTS fleet_deployment_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id UUID NOT NULL REFERENCES fleet_deployment_schemes(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES fleet_deployment_assignments(id) ON DELETE CASCADE,
  tenant_key VARCHAR(100) NOT NULL DEFAULT 'default',
  project_key VARCHAR(100) NOT NULL DEFAULT 'default',
  operational_date DATE NOT NULL,
  excavator_id UUID NOT NULL REFERENCES equipment(id),
  loader_code_snapshot VARCHAR(80) NOT NULL,
  pit_area_snapshot VARCHAR(100) NOT NULL,
  job_code_snapshot VARCHAR(50) NOT NULL,
  material_snapshot VARCHAR(120) NOT NULL,
  planning_type VARCHAR(20) NOT NULL CHECK (planning_type IN ('ob','coal')),
  productivity_plan_version_id UUID REFERENCES productivity_plan_versions(id),
  plan_productivity NUMERIC(16,4),
  productivity_unit VARCHAR(20) NOT NULL CHECK (productivity_unit IN ('BCM/Hr','Ton/Hr')),
  planned_ewh NUMERIC(12,4),
  planned_production NUMERIC(18,4),
  completeness VARCHAR(30) NOT NULL DEFAULT 'complete'
    CHECK (completeness IN ('complete','missing-plan','missing-ewh')),
  reason_code VARCHAR(80),
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (assignment_id, operational_date)
);

CREATE INDEX IF NOT EXISTS idx_fleet_deployment_days_scope_date
  ON fleet_deployment_days (tenant_key, project_key, operational_date)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_deployment_published_excavator_day
  ON fleet_deployment_days (tenant_key, project_key, operational_date, excavator_id)
  WHERE is_published = TRUE AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fleet_deployment_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id UUID NOT NULL REFERENCES fleet_deployment_schemes(id) ON DELETE CASCADE,
  tenant_key VARCHAR(100) NOT NULL DEFAULT 'default',
  project_key VARCHAR(100) NOT NULL DEFAULT 'default',
  action VARCHAR(40) NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  reason TEXT,
  actor_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_deployment_audit_scheme
  ON fleet_deployment_audit (scheme_id, created_at DESC);

COMMIT;
