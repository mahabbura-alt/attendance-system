-- Migration 075: Modul HSE Fase 3 - Kompetensi (Pelatihan, Lisensi/SIMPER, Induksi, Safety Talk/P5M)
-- Mengikuti spesifikasi arsitektur OMOS HSE Section 4.6 & 5.6

-- 1. Master Kursus Pelatihan
CREATE TABLE IF NOT EXISTS hse_training_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('INDUCTION', 'SAFETY', 'HEALTH', 'ENVIRONMENT', 'TECHNICAL', 'OTHER')),
  validity_months INTEGER,
  provider TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, code)
);

CREATE INDEX IF NOT EXISTS idx_hse_training_courses_scope ON hse_training_courses(tenant_key, project_key);

-- 2. Matriks Persyaratan Pelatihan per Jabatan
CREATE TABLE IF NOT EXISTS hse_training_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  position_name TEXT NOT NULL,
  course_id UUID NOT NULL REFERENCES hse_training_courses(id) ON DELETE CASCADE,
  is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, position_name, course_id)
);

CREATE INDEX IF NOT EXISTS idx_hse_training_req_scope ON hse_training_requirements(tenant_key, project_key, position_name);

-- 3. Catatan Penyelesaian Pelatihan Karyawan
CREATE TABLE IF NOT EXISTS hse_training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES hse_training_courses(id) ON DELETE CASCADE,
  completed_date DATE NOT NULL,
  score NUMERIC(5, 2),
  result TEXT NOT NULL DEFAULT 'PASSED' CHECK (result IN ('PASSED', 'FAILED', 'ATTENDED')),
  valid_until DATE,
  certificate_no TEXT,
  certificate_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_training_records_emp ON hse_training_records(tenant_key, project_key, employee_id);

-- 4. Lisensi, SIMPER, SIO Karyawan
CREATE TABLE IF NOT EXISTS hse_employee_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_type TEXT NOT NULL CHECK (license_type IN ('SIMPER', 'KIMPER', 'SIO', 'OPERATOR_CERT', 'BNSP', 'FIRST_AID', 'BLASTING_KIM', 'OTHER')),
  license_no TEXT NOT NULL,
  class_or_unit TEXT,
  issued_by TEXT,
  issued_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'EXPIRING', 'EXPIRED', 'SUSPENDED')),
  file_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, employee_id, license_type, license_no)
);

CREATE INDEX IF NOT EXISTS idx_hse_licenses_scope ON hse_employee_licenses(tenant_key, project_key, employee_id, status);

-- 5. Catatan Induksi Keselamatan
CREATE TABLE IF NOT EXISTS hse_inductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  person_type TEXT NOT NULL DEFAULT 'EMPLOYEE' CHECK (person_type IN ('EMPLOYEE', 'CONTRACTOR', 'VISITOR')),
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  person_name TEXT,
  company_name TEXT,
  id_no TEXT,
  induction_date DATE NOT NULL,
  test_score NUMERIC(5, 2),
  result TEXT NOT NULL DEFAULT 'PASSED' CHECK (result IN ('PASSED', 'FAILED')),
  valid_until DATE,
  inductor_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_inductions_scope ON hse_inductions(tenant_key, project_key, person_type, induction_date DESC);

-- 6. Safety Talks / P5M (Toolbox Talk)
CREATE TABLE IF NOT EXISTS hse_safety_talks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  talk_date DATE NOT NULL,
  department_name TEXT NOT NULL,
  topic TEXT NOT NULL,
  led_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  led_by_name TEXT NOT NULL,
  attendee_count INTEGER NOT NULL DEFAULT 1 CHECK (attendee_count >= 1),
  notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_safety_talks_scope ON hse_safety_talks(tenant_key, project_key, talk_date DESC);

-- 7. Seed Master Kursus Pelatihan Standar Tambang
INSERT INTO hse_training_courses (tenant_key, project_key, code, name, category, validity_months, provider)
VALUES
  ('default', 'default', 'TR-IND-01', 'Induksi Keselamatan Pertambangan Umum', 'INDUCTION', 12, 'HSE Internal'),
  ('default', 'default', 'TR-DDT-01', 'Defensive Driving Training (DDT) Haul Road', 'SAFETY', 24, 'External Provider Bersertifikat'),
  ('default', 'default', 'TR-FA-01', 'Pertolongan Pertama Pada Kecelakaan (P3K)', 'HEALTH', 24, 'Klinik Site / PMI'),
  ('default', 'default', 'TR-WAH-01', 'Bekerja Pada Ketinggian (Working at Height)', 'SAFETY', 24, 'HSE Internal'),
  ('default', 'default', 'TR-LOTO-01', 'Lockout Tagout (LOTO) & Isolasi Energi', 'TECHNICAL', 24, 'Plant Maintenance / HSE'),
  ('default', 'default', 'TR-ENV-01', 'Pengelolaan Limbah B3 dan Spill Response', 'ENVIRONMENT', 36, 'Environmental Dept')
ON CONFLICT (tenant_key, project_key, code) DO NOTHING;
