BEGIN;

-- P0 Database Cuti Karyawan (docs/RENCANA_DATABASE_CUTI_KARYAWAN.md, keputusan owner 2026-10-07):
-- tahun kalender perusahaan, durasi inklusif, realisasi parsial masuk variance,
-- approval berjenjang Atasan + HR, hak selalu floor(hari_tahun/siklus).
-- Idempoten; tidak mengubah data roster/absensi historis.

CREATE TABLE IF NOT EXISTS leave_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  department TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  leave_type TEXT NOT NULL CHECK (leave_type IN ('CP','CK','CT')),
  work_days INTEGER NOT NULL CHECK (work_days >= 0),
  leave_days INTEGER NOT NULL CHECK (leave_days >= 0),
  annual_days INTEGER NOT NULL DEFAULT 12 CHECK (annual_days >= 0),
  basis TEXT NOT NULL DEFAULT 'hire_date' CHECK (basis IN ('hire_date','roster_start','policy_effective')),
  prorata BOOLEAN NOT NULL DEFAULT FALSE,
  carry_forward BOOLEAN NOT NULL DEFAULT TRUE,
  carry_max_days INTEGER NOT NULL DEFAULT 0 CHECK (carry_max_days >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (leave_type <> 'CP' OR work_days + leave_days > 0),
  UNIQUE (tenant_key, project_key, department, position, leave_type, version_no)
);
CREATE INDEX IF NOT EXISTS idx_leave_policy_lookup
  ON leave_policy_versions(tenant_key, project_key, leave_type, is_active);

CREATE TABLE IF NOT EXISTS employee_leave_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  policy_version_id UUID REFERENCES leave_policy_versions(id),
  period_entitlement INTEGER NOT NULL DEFAULT 0 CHECK (period_entitlement >= 0),
  period_adjustment INTEGER NOT NULL DEFAULT 0,
  annual_entitlement_days INTEGER NOT NULL DEFAULT 12 CHECK (annual_entitlement_days >= 0),
  carry_forward_days INTEGER NOT NULL DEFAULT 0 CHECK (carry_forward_days >= 0),
  annual_adjustment_days INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, user_id, year)
);
CREATE INDEX IF NOT EXISTS idx_leave_entitlement_year
  ON employee_leave_entitlements(tenant_key, project_key, year);

CREATE TABLE IF NOT EXISTS employee_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('CP','CK','CT')),
  planned_start DATE NOT NULL,
  planned_end DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','SUPERVISOR_APPROVED','APPROVED','REALIZED','REJECTED','CANCELLED')),
  cycle_no INTEGER CHECK (cycle_no IS NULL OR cycle_no >= 1),
  supervisor_by UUID REFERENCES users(id),
  supervisor_at TIMESTAMPTZ,
  hr_by UUID REFERENCES users(id),
  hr_at TIMESTAMPTZ,
  reject_reason TEXT,
  idempotency_key TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (planned_end >= planned_start),
  UNIQUE (tenant_key, project_key, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_leave_request_user
  ON employee_leave_requests(tenant_key, project_key, user_id, status);

CREATE TABLE IF NOT EXISTS employee_leave_realisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  request_id UUID NOT NULL REFERENCES employee_leave_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actual_start DATE NOT NULL,
  actual_end DATE NOT NULL,
  actual_days INTEGER NOT NULL CHECK (actual_days >= 1),
  period_count INTEGER NOT NULL DEFAULT 1 CHECK (period_count >= 0),
  variance_days INTEGER NOT NULL DEFAULT 0,
  counting_status TEXT NOT NULL DEFAULT 'COUNTED'
    CHECK (counting_status IN ('COUNTED','PARTIAL','VARIANCE','EXCLUDED')),
  policy_version_id UUID REFERENCES leave_policy_versions(id),
  status TEXT NOT NULL DEFAULT 'REALIZED'
    CHECK (status IN ('REALIZED','CORRECTED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'approval'
    CHECK (source IN ('approval','correction','attendance_import')),
  note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (actual_end >= actual_start),
  UNIQUE (request_id)
);
CREATE INDEX IF NOT EXISTS idx_leave_realisation_user
  ON employee_leave_realisations(tenant_key, project_key, user_id, status);

CREATE TABLE IF NOT EXISTS employee_leave_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  next_leave_start DATE,
  basis TEXT NOT NULL DEFAULT '',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, user_id, year)
);

CREATE TABLE IF NOT EXISTS leave_roster_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  request_id UUID NOT NULL REFERENCES employee_leave_requests(id) ON DELETE CASCADE,
  realisation_id UUID REFERENCES employee_leave_realisations(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tanggal DATE NOT NULL,
  expected_status TEXT NOT NULL DEFAULT 'CP',
  actual_status TEXT,
  state TEXT NOT NULL DEFAULT 'MISMATCH'
    CHECK (state IN ('MATCHED','MISMATCH','OVERRIDDEN')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, tanggal)
);
CREATE INDEX IF NOT EXISTS idx_leave_recon_state
  ON leave_roster_reconciliation(tenant_key, project_key, state);

CREATE TABLE IF NOT EXISTS leave_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id UUID,
  before_value JSONB,
  after_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_leave_audit_entity
  ON leave_audit_log(tenant_key, project_key, entity, entity_id);

-- Snapshot nilai roster sebelum Database Cuti mengambil alih satu tanggal.
-- Digunakan untuk pembatalan/koreksi agar jadwal generated sebelumnya pulih,
-- sementara manual_override yang dibuat sesudahnya tetap dipertahankan.
CREATE TABLE IF NOT EXISTS leave_roster_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  request_id UUID NOT NULL REFERENCES employee_leave_requests(id) ON DELETE CASCADE,
  realisation_id UUID REFERENCES employee_leave_realisations(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tanggal DATE NOT NULL,
  previous_exists BOOLEAN NOT NULL DEFAULT FALSE,
  previous_status VARCHAR(4),
  previous_shift_id UUID REFERENCES shifts(id),
  previous_assignment_id UUID REFERENCES employee_roster_assignments(id) ON DELETE SET NULL,
  previous_source VARCHAR(20),
  previous_catatan TEXT,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, tanggal)
);
CREATE INDEX IF NOT EXISTS idx_leave_roster_snapshot_active
  ON leave_roster_snapshots(tenant_key, project_key, user_id, tanggal)
  WHERE restored_at IS NULL;

-- Roster CP turunan cuti memakai source baru agar override manual tidak tertimpa diam-diam.
ALTER TABLE employee_roster_daily DROP CONSTRAINT IF EXISTS employee_roster_daily_source_check;
ALTER TABLE employee_roster_daily
  ADD CONSTRAINT employee_roster_daily_source_check
  CHECK (source IN ('generated','manual_override','leave_sync'));
ALTER TABLE employee_roster_daily
  ADD COLUMN IF NOT EXISTS leave_request_id UUID REFERENCES employee_leave_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leave_realisation_id UUID REFERENCES employee_leave_realisations(id) ON DELETE SET NULL;

COMMIT;
