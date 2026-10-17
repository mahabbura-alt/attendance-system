-- ============================================================================
-- Migrasi 078: OMOS Modul HSE - Fase 6: Tanggap Darurat & APD / Peralatan
-- Acuan: docs/omos-modul-hse (1).md (Sections 4.10, 4.11, 5.10, 5.11, 6, 11)
-- ============================================================================

-- 1. TIM TANGGAP DARURAT (ERT - Emergency Response Team)
CREATE TABLE IF NOT EXISTS hse_emergency_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  employee_name VARCHAR(255) NOT NULL,
  employee_nrp VARCHAR(50),
  department_name VARCHAR(100),
  position_name VARCHAR(100),
  role VARCHAR(50) NOT NULL DEFAULT 'RESCUE', -- COMMANDER, FIRE_FIGHTER, FIRST_AIDER, RESCUE, COMMUNICATION, OTHER
  certifications TEXT, -- mis. Basic Fire Fighter, P3K Tambang Kemenaker, High Angle Rescue
  shift VARCHAR(50) DEFAULT 'SHIFT_1',
  phone_no VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ert_tenant_project ON hse_emergency_team_members (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ert_role ON hse_emergency_team_members (tenant_key, project_key, role) WHERE deleted_at IS NULL;

-- 2. SIMULASI & LATIHAN TANGGAP DARURAT (Emergency Drills)
CREATE TABLE IF NOT EXISTS hse_emergency_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  drill_no VARCHAR(50) NOT NULL,
  drill_date DATE NOT NULL,
  scenario VARCHAR(50) NOT NULL, -- FIRE, MEDICAL, SPILL, ROCKFALL, EVACUATION, OTHER
  scenario_title VARCHAR(255) NOT NULL,
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name VARCHAR(150),
  participant_count INT NOT NULL DEFAULT 0,
  response_time_sec INT, -- waktu respon dalam detik
  evaluation TEXT,
  result VARCHAR(50) NOT NULL DEFAULT 'ADEQUATE', -- GOOD, ADEQUATE, NEEDS_IMPROVEMENT
  report_url TEXT,
  action_id UUID REFERENCES hse_actions(id) ON DELETE SET NULL, -- auto-link CAPA temuan drill
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_drills_tenant_project ON hse_emergency_drills (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_drills_date ON hse_emergency_drills (tenant_key, project_key, drill_date DESC) WHERE deleted_at IS NULL;

-- 3. PERALATAN DARURAT (Emergency Equipment: APAR, P3K, Eyewash, Hydrant, Spill Kit)
CREATE TABLE IF NOT EXISTS hse_emergency_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  equipment_code VARCHAR(50) NOT NULL, -- mis. APAR-WS-001, BOX-P3K-01
  equipment_type VARCHAR(50) NOT NULL, -- FIRE_EXTINGUISHER, FIRST_AID_BOX, EYEWASH, ALARM, HYDRANT, SPILL_KIT, OTHER
  serial_no VARCHAR(100),
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name VARCHAR(150) NOT NULL,
  capacity VARCHAR(50), -- mis. 6 kg DCP, 50 Liter, 25 Item
  last_inspection_date DATE,
  next_inspection_date DATE,
  content_expiry_date DATE, -- kedaluwarsa isi serbuk/cairan
  status VARCHAR(50) NOT NULL DEFAULT 'GOOD', -- GOOD, DUE, OVERDUE, DEFECTIVE, RETIRED
  inspector_name VARCHAR(100),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_em_eq_tenant_project ON hse_emergency_equipment (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_em_eq_type ON hse_emergency_equipment (tenant_key, project_key, equipment_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_em_eq_status ON hse_emergency_equipment (tenant_key, project_key, status) WHERE deleted_at IS NULL;

-- 4. TITIK KUMPUL EVAKUASI (Emergency Assembly Points)
CREATE TABLE IF NOT EXISTS hse_emergency_assembly_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  code VARCHAR(50) NOT NULL, -- mis. AP-01, AP-02
  name VARCHAR(150) NOT NULL,
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name VARCHAR(150) NOT NULL,
  capacity_persons INT DEFAULT 50,
  warden_name VARCHAR(100), -- koordinator area/evakuasi
  map_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_assembly_tenant_project ON hse_emergency_assembly_points (tenant_key, project_key) WHERE deleted_at IS NULL;

-- 5. KONTAK DARURAT (Emergency Contacts)
CREATE TABLE IF NOT EXISTS hse_emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  category VARCHAR(50) NOT NULL DEFAULT 'INTERNAL', -- INTERNAL, CLINIC, HOSPITAL, FIRE_DEPT, POLICE, OTHER
  name VARCHAR(150) NOT NULL,
  phone_no VARCHAR(100) NOT NULL,
  alternate_phone VARCHAR(100),
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_contacts_tenant_project ON hse_emergency_contacts (tenant_key, project_key) WHERE deleted_at IS NULL;

-- 6. MASTER KATALOG APD (PPE Items)
CREATE TABLE IF NOT EXISTS hse_ppe_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  code VARCHAR(50) NOT NULL, -- mis. PPE-HELM, PPE-BOOTS
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL, -- HEAD, EYE, EAR, RESPIRATORY, HAND, BODY, FOOT, FALL_PROTECTION, OTHER
  replace_interval_months INT NOT NULL DEFAULT 12,
  standard_specification TEXT, -- mis. SNI/ANSI Z89.1 Type 1 Class E
  inventory_item_id UUID, -- tautan GudangSite jika ada
  current_stock INT DEFAULT 0,
  minimum_stock INT DEFAULT 10,
  unit VARCHAR(20) DEFAULT 'PCS',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ppe_items_tenant_project ON hse_ppe_items (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ppe_items_category ON hse_ppe_items (tenant_key, project_key, category) WHERE deleted_at IS NULL;

-- 7. STANDAR APD WAJIB PER JABATAN / AREA (PPE Standards)
CREATE TABLE IF NOT EXISTS hse_ppe_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  position_name VARCHAR(100) NOT NULL, -- mis. Operator HD, Welder, Mekanik, Driver Hauling, Foreman
  location_type VARCHAR(50), -- PIT, WORKSHOP, OFFICE, DISPOSAL, PROCESSING, ALL
  ppe_item_id UUID NOT NULL REFERENCES hse_ppe_items(id) ON DELETE CASCADE,
  mandatory BOOLEAN NOT NULL DEFAULT true,
  quantity INT NOT NULL DEFAULT 1,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ppe_std_tenant_project ON hse_ppe_standards (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ppe_std_position ON hse_ppe_standards (tenant_key, project_key, position_name) WHERE deleted_at IS NULL;

-- 8. DISTRIBUSI & PENYERAHAN APD KE KARYAWAN (PPE Issuances)
CREATE TABLE IF NOT EXISTS hse_ppe_issuances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_name VARCHAR(255) NOT NULL,
  employee_nrp VARCHAR(50),
  department_name VARCHAR(100),
  position_name VARCHAR(100),
  ppe_item_id UUID NOT NULL REFERENCES hse_ppe_items(id) ON DELETE CASCADE,
  ppe_item_name VARCHAR(150) NOT NULL,
  ppe_category VARCHAR(50) NOT NULL,
  size VARCHAR(20), -- S, M, L, XL, 40, 41, 42, dsb.
  quantity INT NOT NULL DEFAULT 1,
  issued_date DATE NOT NULL,
  replace_due_date DATE NOT NULL,
  reason VARCHAR(50) NOT NULL DEFAULT 'NEW_HIRE', -- NEW_HIRE, REPLACEMENT, DAMAGED, LOST, ADDITIONAL
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, DUE_REPLACEMENT, RETURNED, DISPOSED
  returned_date DATE,
  issued_by_name VARCHAR(100),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ppe_iss_tenant_project ON hse_ppe_issuances (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ppe_iss_employee ON hse_ppe_issuances (tenant_key, project_key, employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ppe_iss_due ON hse_ppe_issuances (tenant_key, project_key, replace_due_date) WHERE deleted_at IS NULL;
