-- ============================================================================
-- Migrasi 079: OMOS Modul HSE - Fase 7: Kontraktor (CSMS) & Lingkungan Hidup
-- Acuan: docs/omos-modul-hse (1).md (Sections 4.8, 4.9, 5.8, 5.9, 6, 11)
-- ============================================================================

-- 1. DAFTAR PERUSAHAAN MITRA KERJA / KONTRAKTOR (HSE Contractor Registry)
CREATE TABLE IF NOT EXISTS hse_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  company_code VARCHAR(50) NOT NULL, -- mis. KTR-001, PT-PMA
  company_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(100), -- HAULING, EARTHMOVING, DRILLING_BLASTING, CIVIL_WORKS, CATERING, SECURITY, OTHER
  pic_name VARCHAR(150),
  pic_phone VARCHAR(50),
  pic_email VARCHAR(100),
  office_address TEXT,
  worker_count INT DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ctr_tenant_project ON hse_contractors (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ctr_name ON hse_contractors (tenant_key, project_key, company_name) WHERE deleted_at IS NULL;

-- 2. PENILAIAN & EVALUASI KESELAMATAN KONTRAKTOR (CSMS Assessments)
CREATE TABLE IF NOT EXISTS hse_contractor_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  contractor_id UUID NOT NULL REFERENCES hse_contractors(id) ON DELETE CASCADE,
  contractor_name VARCHAR(255) NOT NULL,
  assessment_date DATE NOT NULL,
  assessment_type VARCHAR(50) NOT NULL DEFAULT 'PREQUALIFICATION', -- PREQUALIFICATION, PERIODIC, POST_CONTRACT
  score NUMERIC(5,2) NOT NULL DEFAULT 0, -- Skor 0.00 - 100.00
  result VARCHAR(50) NOT NULL DEFAULT 'APPROVED', -- APPROVED (>=75), CONDITIONAL (60-74), REJECTED (<60)
  assessor_name VARCHAR(150),
  valid_until DATE,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ctr_ass_tenant_project ON hse_contractor_assessments (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ctr_ass_contractor ON hse_contractor_assessments (tenant_key, project_key, contractor_id) WHERE deleted_at IS NULL;

-- 3. KELENGKAPAN DOKUMEN & PERIZINAN KONTRAKTOR (Contractor Documents)
CREATE TABLE IF NOT EXISTS hse_contractor_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  contractor_id UUID NOT NULL REFERENCES hse_contractors(id) ON DELETE CASCADE,
  contractor_name VARCHAR(255) NOT NULL,
  doc_type VARCHAR(50) NOT NULL, -- SMK3, IUJP, PERMIT, INSURANCE, PERSONNEL_CERT, AMDAL_UKL_UPL, OTHER
  doc_no VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  issued_date DATE,
  expiry_date DATE,
  file_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'VALID', -- VALID, EXPIRING, EXPIRED
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ctr_docs_tenant_project ON hse_contractor_documents (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ctr_docs_contractor ON hse_contractor_documents (tenant_key, project_key, contractor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ctr_docs_expiry ON hse_contractor_documents (tenant_key, project_key, expiry_date) WHERE deleted_at IS NULL;

-- 4. PELANGGARAN & SANKSI KONTRAKTOR (Contractor Violations)
CREATE TABLE IF NOT EXISTS hse_contractor_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  contractor_id UUID NOT NULL REFERENCES hse_contractors(id) ON DELETE CASCADE,
  contractor_name VARCHAR(255) NOT NULL,
  violation_date DATE NOT NULL,
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name VARCHAR(150),
  description TEXT NOT NULL,
  severity VARCHAR(50) NOT NULL DEFAULT 'MINOR', -- MINOR, MAJOR, CRITICAL
  sanction VARCHAR(50) NOT NULL DEFAULT 'WARNING', -- WARNING, WRITTEN_WARNING, STOP_WORK, PENALTY, TERMINATION_RECOMMENDED
  action_id UUID REFERENCES hse_actions(id) ON DELETE SET NULL, -- auto-link CAPA temuan pelanggaran
  status VARCHAR(50) NOT NULL DEFAULT 'OPEN', -- OPEN, RESOLVED
  reported_by VARCHAR(150),
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ctr_viol_tenant_project ON hse_contractor_violations (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_ctr_viol_contractor ON hse_contractor_violations (tenant_key, project_key, contractor_id) WHERE deleted_at IS NULL;

-- 5. LOG & NERACA LIMBAH B3 (Waste B3 Logs)
CREATE TABLE IF NOT EXISTS hse_env_waste_b3_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  log_date DATE NOT NULL,
  waste_code VARCHAR(50), -- mis. B105d (Oli Bekas), B107d (Filter), B110d (Aki)
  waste_name VARCHAR(150) NOT NULL, -- Oli Bekas, Filter Oli Bekas, Majun Terkontaminasi, Aki Bekas, Limbah Medis Klinis
  source_location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  source_location_name VARCHAR(150) NOT NULL, -- Workshop, Fuel Bay, Genset Power Plant, Klinik
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(20) NOT NULL DEFAULT 'KG', -- KG, LITER, DRUM, UNIT
  storage_location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  storage_location_name VARCHAR(150) DEFAULT 'TPS Limbah B3 Site',
  storage_deadline DATE, -- Maks 90/180/365 hari sesuai izin TPS B3
  hauler_company VARCHAR(150), -- PT Pengangkut Berizin KLHK (mis. PT Wastec, PT Prasadha)
  manifest_no VARCHAR(100), -- Nomor Dokumen Festronik / Manifes
  hauled_date DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'STORED', -- STORED, HAULED, PROCESSED
  pic_name VARCHAR(100),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_waste_b3_tenant_project ON hse_env_waste_b3_logs (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_waste_b3_status ON hse_env_waste_b3_logs (tenant_key, project_key, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_waste_b3_deadline ON hse_env_waste_b3_logs (tenant_key, project_key, storage_deadline) WHERE deleted_at IS NULL;

-- 6. TITIK PANTAU LINGKUNGAN (Environmental Monitoring Points)
CREATE TABLE IF NOT EXISTS hse_env_monitoring_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  point_code VARCHAR(50) NOT NULL, -- mis. SW-01, AMB-01, EM-GEN-01
  name VARCHAR(150) NOT NULL, -- Outlet Kolam Pengendapan Sedimen 1 (KPL 01), Udara Ambien Simpang Hauling KM 2
  media VARCHAR(50) NOT NULL, -- WATER (Air Permukaan/Limbah), AIR (Udara Ambien/Emisi), DUST (Debu Jatuh), NOISE (Bising Lingkungan), SOIL (Tanah)
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name VARCHAR(150),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_env_points_tenant_project ON hse_env_monitoring_points (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_env_points_media ON hse_env_monitoring_points (tenant_key, project_key, media) WHERE deleted_at IS NULL;

-- 7. MASTER PARAMETER & BAKU MUTU LINGKUNGAN (Environmental Parameters)
CREATE TABLE IF NOT EXISTS hse_env_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  media VARCHAR(50) NOT NULL, -- WATER, AIR, DUST, NOISE, SOIL
  parameter_name VARCHAR(100) NOT NULL, -- pH, TSS, Fe (Besi Terlarut), Mn (Mangan Terlarut), SO2, NO2, TSP
  unit VARCHAR(20) NOT NULL, -- mg/L, ppm, µg/Nm³, dBA
  limit_min NUMERIC(10,2), -- mis. 6.00 untuk pH air
  limit_max NUMERIC(10,2) NOT NULL, -- mis. 9.00 untuk pH air, 200.00 untuk TSS, 7.00 untuk Fe
  standard_reference VARCHAR(150), -- Permen LHK No. P.5/2022, Kepmen LH 113/2003, PP 22/2021
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_env_params_tenant_project ON hse_env_parameters (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_env_params_media ON hse_env_parameters (tenant_key, project_key, media) WHERE deleted_at IS NULL;

-- 8. PENGUKURAN KUALITAS & UJI LAB LINGKUNGAN (Environmental Measurements)
CREATE TABLE IF NOT EXISTS hse_env_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  point_id UUID NOT NULL REFERENCES hse_env_monitoring_points(id) ON DELETE CASCADE,
  point_name VARCHAR(150) NOT NULL,
  parameter_id UUID NOT NULL REFERENCES hse_env_parameters(id) ON DELETE CASCADE,
  parameter_name VARCHAR(100) NOT NULL,
  media VARCHAR(50) NOT NULL,
  measured_at DATE NOT NULL,
  measured_value NUMERIC(10,2) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  limit_min NUMERIC(10,2),
  limit_max NUMERIC(10,2) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'COMPLIES', -- COMPLIES (Memenuhi), NEAR_LIMIT (Mendekati), EXCEEDED (Melampaui)
  lab_name VARCHAR(150), -- Laboratorium Terakreditasi KAN (mis. Sucofindo, Intertek)
  report_no VARCHAR(100), -- Nomor Sertifikat Hasil Uji (SHU)
  report_url TEXT,
  pic_sampler VARCHAR(100),
  corrective_action TEXT, -- saran mitigasi bila exceeded
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_env_meas_tenant_project ON hse_env_measurements (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_env_meas_point ON hse_env_measurements (tenant_key, project_key, point_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_env_meas_status ON hse_env_measurements (tenant_key, project_key, status) WHERE deleted_at IS NULL;

-- 9. REKLAMASI & REVEGETASI LAHAN TAMBANG (Mine Reclamation Records)
CREATE TABLE IF NOT EXISTS hse_env_reclamation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(50) NOT NULL DEFAULT 'default',
  project_key VARCHAR(50) NOT NULL DEFAULT 'default',
  area_name VARCHAR(150) NOT NULL, -- Disposal Barat Blok 1, Bekas Tambang Pit 1 Utara
  activity VARCHAR(50) NOT NULL, -- LANDSCAPING (Penataan Lahan/Regrading), TOPSOIL (Penebaran Tanah Pucuk), PLANTING (Penanaman Cover Crop/Fast Growing), MAINTENANCE (Penyulaman & Pemupukan)
  planned_ha NUMERIC(8,2) NOT NULL DEFAULT 0,
  actual_ha NUMERIC(8,2) NOT NULL DEFAULT 0,
  period_month DATE NOT NULL, -- Periode Bulan Reklamasi (YYYY-MM-01)
  tree_species VARCHAR(255), -- Sengon Buto, Johar, Trembesi, Akasia, Mahoni
  trees_planted_count INT DEFAULT 0,
  mortality_rate_percent NUMERIC(5,2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_env_rec_tenant_project ON hse_env_reclamation_records (tenant_key, project_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_env_rec_period ON hse_env_reclamation_records (tenant_key, project_key, period_month DESC) WHERE deleted_at IS NULL;
