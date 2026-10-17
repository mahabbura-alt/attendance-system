-- Migration 076: Modul HSE Fase 4 - Izin Kerja (Permit to Work / PTW, LOTO, SIMOPS) & Inspeksi Keselamatan
-- Mengacu pada OMOS HSE Specification Section 4.5, 4.3.3, 5.3, dan 5.5

-- -------------------------------------------------------------
-- 1. IZIN KERJA (PTW - PERMIT TO WORK)
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hse_ptw_permits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  permit_no TEXT NOT NULL,
  permit_type TEXT NOT NULL CHECK (permit_type IN (
    'HOT_WORK', 'WORK_AT_HEIGHT', 'CONFINED_SPACE', 'LOTO',
    'EXCAVATION', 'LIFTING', 'ELECTRICAL', 'CHEMICAL'
  )),
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name TEXT,
  work_description TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT 'PT Internal Site JMB-DKC',
  requested_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by_name TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  hazards_controls JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'SUBMITTED', 'HSE_CHECK', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED', 'EXPIRED'
  )),
  approved_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  closed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_by_name TEXT,
  closed_at TIMESTAMPTZ,
  closure_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, permit_no)
);

CREATE INDEX IF NOT EXISTS idx_hse_ptw_scope ON hse_ptw_permits(tenant_key, project_key, status);
CREATE INDEX IF NOT EXISTS idx_hse_ptw_validity ON hse_ptw_permits(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_hse_ptw_location ON hse_ptw_permits(location_id);

-- Pekerja yang terlibat dalam PTW & validasi kompetensi
CREATE TABLE IF NOT EXISTS hse_ptw_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES hse_ptw_permits(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  worker_name TEXT NOT NULL,
  position_name TEXT,
  competency_check TEXT NOT NULL DEFAULT 'OK' CHECK (competency_check IN ('OK', 'EXPIRED', 'MISSING')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_ptw_workers_permit ON hse_ptw_workers(permit_id);

-- Isolasi Energi / LOTO (Lockout Tagout)
CREATE TABLE IF NOT EXISTS hse_ptw_isolations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES hse_ptw_permits(id) ON DELETE CASCADE,
  isolation_point TEXT NOT NULL,
  lock_no TEXT NOT NULL,
  applied_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_by_name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  removed_by_name TEXT,
  removed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'LOCKED' CHECK (status IN ('LOCKED', 'RELEASED')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_ptw_isolations_permit ON hse_ptw_isolations(permit_id);

-- Serah terima izin antar shift
CREATE TABLE IF NOT EXISTS hse_ptw_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES hse_ptw_permits(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_user_name TEXT NOT NULL,
  to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_name TEXT NOT NULL,
  handover_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checklist_verified BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_ptw_handovers_permit ON hse_ptw_handovers(permit_id);

-- -------------------------------------------------------------
-- 2. INSPEKSI KESELAMATAN (SAFETY INSPECTIONS)
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hse_inspection_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN (
    'VEHICLE', 'HEAVY_EQUIPMENT', 'AREA', 'FIRE_EQUIPMENT', 'ELECTRICAL', 'HAZMAT_STORAGE', 'OTHER'
  )),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, code)
);

CREATE INDEX IF NOT EXISTS idx_hse_insp_template_scope ON hse_inspection_templates(tenant_key, project_key);

CREATE TABLE IF NOT EXISTS hse_inspection_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES hse_inspection_templates(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  question TEXT NOT NULL,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  guidance TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_insp_items_tmpl ON hse_inspection_template_items(template_id, sort_order);

CREATE TABLE IF NOT EXISTS hse_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  inspection_no TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES hse_inspection_templates(id) ON DELETE RESTRICT,
  template_name TEXT,
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name TEXT,
  object_identifier TEXT NOT NULL,
  inspected_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  inspected_by_name TEXT NOT NULL,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('DRAFT', 'COMPLETED')),
  result_summary TEXT,
  findings_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, inspection_no)
);

CREATE INDEX IF NOT EXISTS idx_hse_inspections_scope ON hse_inspections(tenant_key, project_key, inspected_at DESC);

CREATE TABLE IF NOT EXISTS hse_inspection_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES hse_inspections(id) ON DELETE CASCADE,
  item_id UUID REFERENCES hse_inspection_template_items(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  answer TEXT NOT NULL CHECK (answer IN ('YES', 'NO', 'NA')),
  note TEXT,
  action_id UUID REFERENCES hse_actions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_insp_answers_insp ON hse_inspection_answers(inspection_id);

-- -------------------------------------------------------------
-- 3. SEED MASTER TEMPLAT INSPEKSI
-- -------------------------------------------------------------

INSERT INTO hse_inspection_templates (tenant_key, project_key, code, name, object_type, description)
VALUES
  ('default', 'default', 'TMPL-LV-01', 'Inspeksi Sarana Kendaraan Ringan (LV 4x4)', 'VEHICLE', 'Pemeriksaan kelayakan harian kendaraan operasional ringan sarana tambang.'),
  ('default', 'default', 'TMPL-HD-01', 'Pre-Start Check Alat Berat (Dump Truck / Excavator)', 'HEAVY_EQUIPMENT', 'Inspeksi keselamatan harian unit alat berat sebelum shift produksi.'),
  ('default', 'default', 'TMPL-WSHOP-01', 'Inspeksi Keselamatan Workshop & Housekeeping (5R)', 'AREA', 'Audit kerapihan lingkungan kerja bengkel, housekeeping, dan penampungan limbah.'),
  ('default', 'default', 'TMPL-APAR-01', 'Inspeksi Bulanan Alat Pemadam Api Ringan (APAR)', 'FIRE_EQUIPMENT', 'Pemeriksaan tekanan tabung, pin pengaman, selang, dan segel APAR site.')
ON CONFLICT (tenant_key, project_key, code) DO NOTHING;
