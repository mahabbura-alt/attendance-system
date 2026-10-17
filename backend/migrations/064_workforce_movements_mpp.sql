BEGIN;

-- Compatibility ownership keys are derived server-side while Core Tenant and
-- Project UUID ownership is not yet authoritative in this legacy data plane.
-- They must be migrated, not trusted from request payloads, when Core lands.
CREATE SEQUENCE IF NOT EXISTS workforce_movement_no_seq;

CREATE TABLE IF NOT EXISTS workforce_department_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, code)
);

CREATE TABLE IF NOT EXISTS workforce_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  group_id UUID REFERENCES workforce_department_groups(id),
  code TEXT,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_departments_scope_name
  ON workforce_departments (tenant_key, project_key, lower(name));

CREATE TABLE IF NOT EXISTS workforce_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  department_id UUID NOT NULL REFERENCES workforce_departments(id),
  code TEXT,
  name TEXT NOT NULL,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_positions_department_name
  ON workforce_positions (tenant_key, project_key, department_id, lower(name));

CREATE TABLE IF NOT EXISTS workforce_employee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  user_id UUID UNIQUE REFERENCES users(id),
  employee_number TEXT,
  hire_date DATE,
  employment_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (employment_status IN ('PRE_HIRE','PROBATION','ACTIVE','NOTICE','INACTIVE')),
  employment_type TEXT,
  grade TEXT,
  contract_end_date DATE,
  probation_end_date DATE,
  rehire_eligible BOOLEAN,
  source TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_profile_employee_number
  ON workforce_employee_profiles (tenant_key, employee_number)
  WHERE employee_number IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS workforce_employee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  employee_profile_id UUID NOT NULL REFERENCES workforce_employee_profiles(id),
  department_id UUID REFERENCES workforce_departments(id),
  position_id UUID REFERENCES workforce_positions(id),
  department_snapshot TEXT,
  position_snapshot TEXT,
  site_name TEXT,
  company_name TEXT,
  grade TEXT,
  supervisor_user_id UUID REFERENCES users(id),
  employment_type TEXT,
  work_pattern TEXT,
  effective_from DATE NOT NULL,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PLANNED','ACTIVE','CLOSED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'movement',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_active_assignment
  ON workforce_employee_assignments (tenant_key, project_key, employee_profile_id)
  WHERE status='ACTIVE' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_workforce_assignment_effective
  ON workforce_employee_assignments (tenant_key, project_key, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS workforce_movement_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  movement_type TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, movement_type, code)
);

CREATE TABLE IF NOT EXISTS workforce_employee_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  movement_no TEXT NOT NULL,
  employee_profile_id UUID NOT NULL REFERENCES workforce_employee_profiles(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN
    ('HIRE','REHIRE','TRANSFER','PROMOTION','DEMOTION','RESIGN','TERMINATION','CONTRACT_END','RETIREMENT')),
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_date DATE NOT NULL,
  reason_id UUID REFERENCES workforce_movement_reasons(id),
  reason_text TEXT,
  notes TEXT,
  before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','SUBMITTED','APPROVED','REJECTED','EFFECTIVE','CANCELLED')),
  idempotency_key TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  effective_by UUID REFERENCES users(id),
  effective_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, movement_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_movement_idempotency
  ON workforce_employee_movements (tenant_key, project_key, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workforce_movement_employee_date
  ON workforce_employee_movements (tenant_key, project_key, employee_profile_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_workforce_movement_status
  ON workforce_employee_movements (tenant_key, project_key, status, effective_date);

CREATE TABLE IF NOT EXISTS workforce_movement_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id UUID NOT NULL REFERENCES workforce_employee_movements(id),
  step_no INTEGER NOT NULL,
  step_label TEXT NOT NULL,
  approver_user_id UUID REFERENCES users(id),
  decision TEXT NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING','APPROVED','REJECTED','SKIPPED')),
  comment TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (movement_id, step_no)
);

CREATE TABLE IF NOT EXISTS workforce_movement_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id UUID NOT NULL REFERENCES workforce_employee_movements(id),
  document_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  checksum_sha256 TEXT,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workforce_movement_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id UUID NOT NULL REFERENCES workforce_employee_movements(id),
  task_kind TEXT NOT NULL CHECK (task_kind IN ('ONBOARDING','OFFBOARDING')),
  task_code TEXT NOT NULL,
  task_name TEXT NOT NULL,
  assigned_to UUID REFERENCES users(id),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE','WAIVED')),
  completed_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (movement_id, task_code)
);

CREATE TABLE IF NOT EXISTS workforce_movement_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id UUID NOT NULL REFERENCES workforce_employee_movements(id),
  action TEXT NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  actor_id UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workforce_mpp_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 2200),
  version_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','SUPERSEDED','CANCELLED')),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  revision_note TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, period_year, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_mpp_current
  ON workforce_mpp_plans (tenant_key, project_key, period_year)
  WHERE is_current=TRUE;

CREATE TABLE IF NOT EXISTS workforce_mpp_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES workforce_mpp_plans(id) ON DELETE CASCADE,
  department_id UUID REFERENCES workforce_departments(id),
  position_id UUID REFERENCES workforce_positions(id),
  department_snapshot TEXT NOT NULL,
  position_snapshot TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT '',
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  UNIQUE (plan_id, department_snapshot, position_snapshot, grade, employment_type)
);

CREATE TABLE IF NOT EXISTS workforce_mpp_line_periods (
  line_id UUID NOT NULL REFERENCES workforce_mpp_lines(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  required_qty INTEGER NOT NULL CHECK (required_qty >= 0),
  PRIMARY KEY (line_id, period_month),
  CHECK (date_trunc('month', period_month)::date = period_month)
);

CREATE TABLE IF NOT EXISTS workforce_manpower_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  request_no TEXT NOT NULL,
  mpp_line_id UUID NOT NULL REFERENCES workforce_mpp_lines(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  filled_qty INTEGER NOT NULL DEFAULT 0 CHECK (filled_qty >= 0 AND filled_qty <= qty),
  needed_by DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','IN_PROGRESS','FULFILLED','CANCELLED')),
  requested_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, request_no)
);
ALTER TABLE workforce_employee_movements
  ADD COLUMN IF NOT EXISTS manpower_request_id UUID REFERENCES workforce_manpower_requests(id);

-- Bootstrap current employees without inventing historical movement events.
INSERT INTO workforce_employee_profiles
  (tenant_key, user_id, employee_number, hire_date, employment_status, source)
SELECT 'default', u.id, u.employee_id, u.created_at::date,
       CASE WHEN u.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END,
       'legacy_backfill'
FROM users u
WHERE u.role='karyawan'
ON CONFLICT (user_id) DO UPDATE SET
  employee_number=EXCLUDED.employee_number,
  employment_status=EXCLUDED.employment_status,
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO workforce_departments (tenant_key, project_key, code, name)
SELECT 'default', 'default', upper(regexp_replace(trim(u.departemen), '[^A-Za-z0-9]+', '_', 'g')), trim(u.departemen)
FROM users u
WHERE u.role='karyawan' AND nullif(trim(u.departemen), '') IS NOT NULL
GROUP BY trim(u.departemen)
ON CONFLICT DO NOTHING;

INSERT INTO workforce_positions (tenant_key, project_key, department_id, code, name)
SELECT 'default', 'default', d.id,
       upper(regexp_replace(trim(u.jabatan), '[^A-Za-z0-9]+', '_', 'g')), trim(u.jabatan)
FROM users u
JOIN workforce_departments d ON d.tenant_key='default' AND d.project_key='default'
  AND lower(d.name)=lower(trim(u.departemen))
WHERE u.role='karyawan' AND nullif(trim(u.jabatan), '') IS NOT NULL
GROUP BY d.id, trim(u.jabatan)
ON CONFLICT DO NOTHING;

INSERT INTO workforce_employee_assignments
  (tenant_key, project_key, employee_profile_id, department_id, position_id,
   department_snapshot, position_snapshot, effective_from, status, source)
SELECT 'default', 'default', p.id, d.id, pos.id, u.departemen, u.jabatan,
       COALESCE(p.hire_date, CURRENT_DATE), 'ACTIVE', 'legacy_backfill'
FROM workforce_employee_profiles p
JOIN users u ON u.id=p.user_id
LEFT JOIN workforce_departments d ON d.tenant_key='default' AND d.project_key='default'
  AND lower(d.name)=lower(COALESCE(u.departemen,''))
LEFT JOIN workforce_positions pos ON pos.tenant_key='default' AND pos.project_key='default'
  AND pos.department_id=d.id AND lower(pos.name)=lower(COALESCE(u.jabatan,''))
WHERE p.deleted_at IS NULL AND u.is_active=TRUE
  AND NOT EXISTS (
    SELECT 1 FROM workforce_employee_assignments a
    WHERE a.employee_profile_id=p.id AND a.tenant_key='default' AND a.project_key='default'
      AND a.status='ACTIVE' AND a.effective_to IS NULL
  );

INSERT INTO workforce_movement_reasons (tenant_key, movement_type, code, label) VALUES
  ('default','HIRE','NEW_POSITION','Penambahan posisi baru'),
  ('default','HIRE','REPLACEMENT','Pengganti karyawan'),
  ('default','TRANSFER','OPERATIONAL_NEED','Kebutuhan operasional'),
  ('default','PROMOTION','PERFORMANCE','Kinerja dan kompetensi'),
  ('default','DEMOTION','ORGANIZATION_REVIEW','Evaluasi organisasi'),
  ('default','RESIGN','VOLUNTARY','Mengundurkan diri'),
  ('default','TERMINATION','DISCIPLINARY','Terminasi/disiplin'),
  ('default','CONTRACT_END','CONTRACT_COMPLETE','Kontrak berakhir'),
  ('default','RETIREMENT','RETIREMENT_AGE','Pensiun')
ON CONFLICT DO NOTHING;

COMMIT;

