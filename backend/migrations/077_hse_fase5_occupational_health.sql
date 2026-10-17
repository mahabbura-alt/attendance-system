-- Migration 077: Modul HSE Fase 5 - Kesehatan Kerja (Occupational Health)
-- Cakupan: MCU, Fit for Work (FFW), Tes Alkohol & Narkoba, Kasus Kesehatan, dan Higiene Industri

-- 1. Tabel MCU Karyawan (Medical Check Up)
CREATE TABLE IF NOT EXISTS hse_mcu_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
  project_key VARCHAR(64) NOT NULL DEFAULT 'default',
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_name VARCHAR(255),
  employee_nrp VARCHAR(64),
  employee_position VARCHAR(128),
  mcu_type VARCHAR(32) NOT NULL DEFAULT 'PERIODIC', -- PRE_EMPLOYMENT, PERIODIC, SPECIAL, EXIT
  mcu_date DATE NOT NULL,
  provider VARCHAR(255) NOT NULL DEFAULT 'Klinik Site JMB-DKC', -- Klinik / RS Rekanan
  fitness_result VARCHAR(32) NOT NULL DEFAULT 'FIT', -- FIT, FIT_WITH_NOTES, TEMP_UNFIT, UNFIT
  restrictions TEXT, -- Catatan pembatasan kerja (misal: tidak boleh di ketinggian, angkat beban max 15kg)
  valid_until DATE NOT NULL,
  report_url TEXT,
  doctor_name VARCHAR(128),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_mcu_scope ON hse_mcu_records(tenant_key, project_key, deleted_at);
CREATE INDEX IF NOT EXISTS idx_hse_mcu_emp ON hse_mcu_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_hse_mcu_date ON hse_mcu_records(mcu_date);

-- 2. Tabel Fit for Work (FFW) Harian Pra-Shift
CREATE TABLE IF NOT EXISTS hse_fit_for_work_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
  project_key VARCHAR(64) NOT NULL DEFAULT 'default',
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_name VARCHAR(255),
  employee_nrp VARCHAR(64),
  employee_position VARCHAR(128),
  check_date DATE NOT NULL DEFAULT CURRENT_DATE,
  shift VARCHAR(32) NOT NULL DEFAULT 'SHIFT_1', -- SHIFT_1, SHIFT_2
  sleep_hours NUMERIC(4, 1) NOT NULL DEFAULT 7.0,
  blood_pressure VARCHAR(32), -- Misal: 120/80
  heart_rate INT, -- bpm
  body_temperature NUMERIC(4, 1), -- derajat celcius
  self_declaration JSONB DEFAULT '{}'::jsonb, -- Jawaban kondisi fisik (pusing, obat tidur, dll)
  result VARCHAR(32) NOT NULL DEFAULT 'FIT', -- FIT, UNFIT, NEED_REVIEW
  action_taken TEXT, -- Rekomendasi/tindakan (istirahat, obat klinik, ganti operator)
  checked_by_id UUID,
  checked_by_name VARCHAR(128),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_ffw_scope ON hse_fit_for_work_checks(tenant_key, project_key, deleted_at);
CREATE INDEX IF NOT EXISTS idx_hse_ffw_date ON hse_fit_for_work_checks(check_date, shift);
CREATE INDEX IF NOT EXISTS idx_hse_ffw_emp ON hse_fit_for_work_checks(employee_id);

-- 3. Tabel Tes Skrining Alkohol dan Narkoba
CREATE TABLE IF NOT EXISTS hse_substance_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
  project_key VARCHAR(64) NOT NULL DEFAULT 'default',
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_name VARCHAR(255),
  employee_nrp VARCHAR(64),
  employee_position VARCHAR(128),
  test_date DATE NOT NULL DEFAULT CURRENT_DATE,
  test_type VARCHAR(32) NOT NULL DEFAULT 'ALCOHOL', -- ALCOHOL, DRUG, BOTH
  trigger_reason VARCHAR(32) NOT NULL DEFAULT 'RANDOM', -- RANDOM, SCHEDULED, POST_INCIDENT, REASONABLE_SUSPICION
  alcohol_level NUMERIC(6, 3) DEFAULT 0.000, -- BAC (Blood Alcohol Content) / BrAC
  drug_panel_result VARCHAR(32) DEFAULT 'NEGATIVE', -- NEGATIVE, POSITIVE, INCONCLUSIVE
  overall_result VARCHAR(32) NOT NULL DEFAULT 'NEGATIVE', -- NEGATIVE, POSITIVE, INCONCLUSIVE
  tested_by_id UUID,
  tested_by_name VARCHAR(128),
  witness_name VARCHAR(128),
  action_taken TEXT, -- Ditangguhkan kerja, investigasi HRD, dll jika positif
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_substance_scope ON hse_substance_tests(tenant_key, project_key, deleted_at);
CREATE INDEX IF NOT EXISTS idx_hse_substance_date ON hse_substance_tests(test_date);

-- 4. Tabel Kasus Kesehatan Kerja & Keluhan Klinik
CREATE TABLE IF NOT EXISTS hse_health_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
  project_key VARCHAR(64) NOT NULL DEFAULT 'default',
  case_no VARCHAR(64) NOT NULL,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_name VARCHAR(255),
  employee_nrp VARCHAR(64),
  employee_position VARCHAR(128),
  case_date DATE NOT NULL DEFAULT CURRENT_DATE,
  case_type VARCHAR(32) NOT NULL DEFAULT 'COMPLAINT', -- COMPLAINT, OCCUPATIONAL_DISEASE, WORK_RELATED_INJURY, OTHER
  is_work_related BOOLEAN NOT NULL DEFAULT false,
  diagnosis_summary TEXT NOT NULL,
  treatment TEXT,
  lost_days INT NOT NULL DEFAULT 0,
  medic_name VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN', -- OPEN, MONITORING, CLOSED
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_cases_scope ON hse_health_cases(tenant_key, project_key, deleted_at);
CREATE INDEX IF NOT EXISTS idx_hse_cases_emp ON hse_health_cases(employee_id);

-- 5. Tabel Pemantauan Higiene Industri Lingkungan Kerja
CREATE TABLE IF NOT EXISTS hse_hygiene_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
  project_key VARCHAR(64) NOT NULL DEFAULT 'default',
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name VARCHAR(255),
  sampling_point VARCHAR(255) NOT NULL, -- Titik spesifik misal: Generator Room, Lathe Area Workshop, Pit 1 Front
  parameter VARCHAR(32) NOT NULL, -- NOISE, DUST, LIGHTING, VIBRATION, TEMPERATURE, OTHER
  measured_at DATE NOT NULL DEFAULT CURRENT_DATE,
  measured_value NUMERIC(10, 2) NOT NULL,
  unit VARCHAR(32) NOT NULL, -- dBA, mg/m3, Lux, m/s2, °C
  threshold_nab NUMERIC(10, 2) NOT NULL, -- Nilai Ambang Batas (NAB)
  status VARCHAR(32) NOT NULL DEFAULT 'OK', -- OK, NEAR_LIMIT, EXCEEDED
  instrument_used VARCHAR(128), -- Sound Level Meter, Dust Sampler, Lux Meter
  measured_by VARCHAR(128),
  mitigation_required TEXT, -- Jika EXCEEDED, rekomendasikan earplug/respirator/tambah lampu
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_hygiene_scope ON hse_hygiene_measurements(tenant_key, project_key, deleted_at);
CREATE INDEX IF NOT EXISTS idx_hse_hygiene_loc ON hse_hygiene_measurements(location_id);
