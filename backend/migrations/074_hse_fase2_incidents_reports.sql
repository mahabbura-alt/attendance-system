BEGIN;

-- OMOS Fase 2: HSE Insiden & Investigasi, Manhours, Laporan & Statistik
-- Tabel: hse_manhours, incidents, incident_persons, incident_assets, incident_investigations

CREATE TABLE IF NOT EXISTS hse_manhours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  period_month DATE NOT NULL,
  company_id UUID,
  company_name TEXT DEFAULT 'PT internal',
  department_id UUID,
  department_name TEXT DEFAULT 'Operasional',
  hours NUMERIC(12, 2) NOT NULL CHECK (hours >= 0),
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('ATTENDANCE', 'MANUAL')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, period_month, company_name, department_name)
);

CREATE INDEX IF NOT EXISTS idx_hse_manhours_period ON hse_manhours(tenant_key, project_key, period_month);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  incident_no TEXT NOT NULL,
  incident_type TEXT NOT NULL CHECK (incident_type IN (
    'FATALITY', 'LTI', 'MTI', 'FAI', 'NEAR_MISS',
    'PROPERTY_DAMAGE', 'FIRE', 'ENVIRONMENTAL', 'VEHICLE_ACCIDENT'
  )),
  occurred_at TIMESTAMPTZ NOT NULL,
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name TEXT,
  department_name TEXT,
  company_name TEXT,
  description TEXT NOT NULL,
  weather TEXT,
  lighting TEXT,
  actual_severity TEXT NOT NULL DEFAULT 'MINOR' CHECK (actual_severity IN ('NONE', 'MINOR', 'MODERATE', 'MAJOR', 'CATASTROPHIC')),
  potential_severity TEXT NOT NULL DEFAULT 'MODERATE' CHECK (potential_severity IN ('NONE', 'MINOR', 'MODERATE', 'MAJOR', 'CATASTROPHIC')),
  estimated_loss NUMERIC(14, 2) DEFAULT 0,
  reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_by_name TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'REPORTED' CHECK (status IN ('REPORTED', 'INVESTIGATING', 'ACTION', 'CLOSED')),
  external_report_required BOOLEAN NOT NULL DEFAULT FALSE,
  external_report_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (external_report_status IN ('NOT_REQUIRED', 'PENDING', 'SUBMITTED')),
  photos TEXT[] DEFAULT '{}'::text[],
  attachments TEXT[] DEFAULT '{}'::text[],
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, incident_no)
);

CREATE INDEX IF NOT EXISTS idx_incidents_scope_occurred ON incidents(tenant_key, project_key, incident_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS incident_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  person_name TEXT NOT NULL,
  company_name TEXT,
  role_in_incident TEXT NOT NULL DEFAULT 'INJURED' CHECK (role_in_incident IN ('INJURED', 'WITNESS', 'INVOLVED')),
  injury_type TEXT,
  body_part TEXT,
  treatment TEXT NOT NULL DEFAULT 'NONE' CHECK (treatment IN ('NONE', 'FIRST_AID', 'MEDICAL', 'HOSPITALIZED')),
  lost_days INTEGER NOT NULL DEFAULT 0 CHECK (lost_days >= 0),
  returned_to_work_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_incident_persons_inc ON incident_persons(incident_id);

CREATE TABLE IF NOT EXISTS incident_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  asset_code TEXT NOT NULL,
  asset_name TEXT,
  damage_description TEXT,
  repair_cost NUMERIC(14, 2) DEFAULT 0 CHECK (repair_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_incident_assets_inc ON incident_assets(incident_id);

CREATE TABLE IF NOT EXISTS incident_investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'FIVE_WHY' CHECK (method IN ('FIVE_WHY', 'FISHBONE', 'TAPROOT', 'OTHER')),
  lead_id UUID REFERENCES users(id) ON DELETE SET NULL,
  lead_name TEXT,
  team_members TEXT,
  immediate_cause TEXT,
  root_causes JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings TEXT,
  lessons_learned TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'COMPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, incident_id)
);

-- Seed initial manhours data (6 bulan terakhir) agar perhitungan LTIFR / TRIR / SR presisi
INSERT INTO hse_manhours (tenant_key, project_key, period_month, company_name, department_name, hours, source)
VALUES
  ('default', 'default', '2026-05-01', 'PT JMB-DKC', 'All Departments', 238000.00, 'MANUAL'),
  ('default', 'default', '2026-06-01', 'PT JMB-DKC', 'All Departments', 242000.00, 'MANUAL'),
  ('default', 'default', '2026-07-01', 'PT JMB-DKC', 'All Departments', 245000.00, 'MANUAL'),
  ('default', 'default', '2026-08-01', 'PT JMB-DKC', 'All Departments', 240000.00, 'MANUAL'),
  ('default', 'default', '2026-09-01', 'PT JMB-DKC', 'All Departments', 244000.00, 'MANUAL'),
  ('default', 'default', '2026-10-01', 'PT JMB-DKC', 'All Departments', 239000.00, 'MANUAL')
ON CONFLICT (tenant_key, project_key, period_month, company_name, department_name) DO UPDATE SET
  hours = EXCLUDED.hours;

COMMIT;
