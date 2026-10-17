BEGIN;

-- OMOS Fase 1: HSE (Health, Safety, and Environment)
-- Master: hse_locations, hse_risk_matrix_config, hse_categories
-- Transaksi: hazard_reports, hse_actions (CAPA terpusat)
-- Metrik Site: hse_site_metrics

CREATE TABLE IF NOT EXISTS hse_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PIT','HAUL_ROAD','WORKSHOP','WAREHOUSE','OFFICE','CAMP','DISPOSAL','OTHER')),
  parent_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, code)
);

CREATE INDEX IF NOT EXISTS idx_hse_locations_scope ON hse_locations(tenant_key, project_key, is_active);

CREATE TABLE IF NOT EXISTS hse_risk_matrix_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL CHECK (kind IN ('LIKELIHOOD','CONSEQUENCE','LEVEL')),
  value INTEGER NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, kind, value)
);

CREATE TABLE IF NOT EXISTS hse_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  domain TEXT NOT NULL CHECK (domain IN ('HAZARD','INCIDENT','FINDING','ENV_INCIDENT')),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key, domain, code)
);

CREATE INDEX IF NOT EXISTS idx_hse_categories_domain ON hse_categories(tenant_key, project_key, domain, is_active);

CREATE TABLE IF NOT EXISTS hse_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  action_no TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('HAZARD','INCIDENT','INSPECTION','AUDIT','DRILL','RISK','OTHER')),
  source_id UUID,
  description TEXT NOT NULL,
  action_type TEXT NOT NULL DEFAULT 'CORRECTIVE' CHECK (action_type IN ('CORRECTIVE','PREVENTIVE','IMMEDIATE')),
  pic_employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  pic_name TEXT,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE_PENDING_VERIFY','CLOSED','OVERDUE','CANCELLED')),
  completed_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  evidence_url TEXT[] DEFAULT '{}'::text[],
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, action_no)
);

CREATE INDEX IF NOT EXISTS idx_hse_actions_scope_status ON hse_actions(tenant_key, project_key, status, due_date);
CREATE INDEX IF NOT EXISTS idx_hse_actions_source ON hse_actions(source_type, source_id);

CREATE TABLE IF NOT EXISTS hazard_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  report_no TEXT NOT NULL,
  reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_by_name TEXT,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  report_time TIME NOT NULL DEFAULT CURRENT_TIME,
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name TEXT,
  category_id UUID REFERENCES hse_categories(id) ON DELETE SET NULL,
  category_name TEXT,
  description TEXT NOT NULL,
  photos TEXT[] DEFAULT '{}'::text[],
  likelihood INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  consequence INTEGER NOT NULL CHECK (consequence BETWEEN 1 AND 5),
  risk_score INTEGER NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH','EXTREME')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_name TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ASSESSED','IN_ACTION','VERIFY','CLOSED','REJECTED','DUPLICATE')),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  close_notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_key, project_key, report_no)
);

CREATE INDEX IF NOT EXISTS idx_hazard_reports_scope ON hazard_reports(tenant_key, project_key, status, risk_level, report_date DESC);

CREATE TABLE IF NOT EXISTS hse_site_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  last_lti_date DATE NOT NULL,
  site_record_days INTEGER NOT NULL DEFAULT 210,
  target_days INTEGER NOT NULL DEFAULT 250,
  ltifr NUMERIC(10, 2) NOT NULL DEFAULT 0.42,
  ltifr_prev NUMERIC(10, 2) DEFAULT 0.61,
  trir NUMERIC(10, 2) NOT NULL DEFAULT 1.10,
  trir_trend TEXT DEFAULT 'stabil',
  near_miss_month INTEGER NOT NULL DEFAULT 9,
  compliance_training NUMERIC(5, 2) DEFAULT 94.0,
  compliance_mcu NUMERIC(5, 2) DEFAULT 97.0,
  compliance_simper NUMERIC(5, 2) DEFAULT 91.0,
  compliance_inspection NUMERIC(5, 2) DEFAULT 88.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key)
);

-- SEED DATA DEFAULT UNTUK FASE 1
INSERT INTO hse_risk_matrix_config (tenant_key, project_key, kind, value, label, description, color, sort_order)
VALUES
  ('default','default','LIKELIHOOD',1,'Hampir tidak mungkin','Kemungkinan terjadi kurang dari 1x per 5 tahun','green',1),
  ('default','default','LIKELIHOOD',2,'Kecil kemungkinan','Dapat terjadi 1x dalam 1-5 tahun','green',2),
  ('default','default','LIKELIHOOD',3,'Mungkin','Dapat terjadi 1x dalam 1 tahun','blue',3),
  ('default','default','LIKELIHOOD',4,'Sangat mungkin','Dapat terjadi beberapa kali dalam 1 tahun','yellow',4),
  ('default','default','LIKELIHOOD',5,'Hampir pasti','Dapat terjadi berulang dalam 1 bulan','red',5),
  ('default','default','CONSEQUENCE',1,'Tidak signifikan','P3K ringan, tanpa kerusakan alat / stop operasi','green',1),
  ('default','default','CONSEQUENCE',2,'Kecil','Perawatan medis ringan, kerusakan unit minor','green',2),
  ('default','default','CONSEQUENCE',3,'Sedang','Cedera hari kerja hilang (LTI ringan), stop shift','blue',3),
  ('default','default','CONSEQUENCE',4,'Berat','Cacat tetap, kerusakan unit berat / stop kerja berhari-hari','yellow',4),
  ('default','default','CONSEQUENCE',5,'Bencana / Fatal','Kematian (Fatality), kerusakan lingkungan luas','red',5),
  ('default','default','LEVEL',1,'Rendah','Skor 1-4: Tindakan rutin dan pemantauan berkala','green',1),
  ('default','default','LEVEL',5,'Sedang','Skor 5-9: Perlu tindakan terencana dalam 14 hari','blue',2),
  ('default','default','LEVEL',10,'Tinggi','Skor 10-16: Perlu tindakan segera dalam 48 jam','yellow',3),
  ('default','default','LEVEL',17,'Ekstrem','Skor 17-25: Hentikan pekerjaan, tindakan darurat segera','red',4)
ON CONFLICT (tenant_key, project_key, kind, value) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order;

INSERT INTO hse_categories (tenant_key, project_key, domain, code, label, is_active, sort_order)
VALUES
  ('default','default','HAZARD','ROAD','Jalan Tambang & Hauling',TRUE,1),
  ('default','default','HAZARD','EQUIP','Alat Berat & Unit Kendaraan',TRUE,2),
  ('default','default','HAZARD','ELEC','Listrik & Instalasi Kabel',TRUE,3),
  ('default','default','HAZARD','HEIGHT','Ketinggian & Tangga Kerja',TRUE,4),
  ('default','default','HAZARD','HOUSEKEEP','Kebersihan & Kerapihan (5R)',TRUE,5),
  ('default','default','HAZARD','CHEMICAL','Bahan Kimia & B3',TRUE,6),
  ('default','default','HAZARD','ENV','Lingkungan, Air & Tumpahan',TRUE,7),
  ('default','default','HAZARD','OTHER','Lain-lain',TRUE,8)
ON CONFLICT (tenant_key, project_key, domain, code) DO UPDATE SET
  label = EXCLUDED.label, is_active = EXCLUDED.is_active, sort_order = EXCLUDED.sort_order;

INSERT INTO hse_locations (tenant_key, project_key, code, name, type)
VALUES
  ('default','default','PIT-1','Pit 1 Selatan','PIT'),
  ('default','default','PIT-2','Pit 2 Utara','PIT'),
  ('default','default','HAUL-KM2','Main Haul Road KM 2-4','HAUL_ROAD'),
  ('default','default','WSHOP-01','Main Workshop & Bay Tambang','WORKSHOP'),
  ('default','default','GUDANG-B3','TPS Limbah B3 & Gudang Site','WAREHOUSE'),
  ('default','default','OFFICE-DKC','Kantor Utama Site JMB-DKC','OFFICE'),
  ('default','default','DISP-TIMUR','Disposal Timur','DISPOSAL')
ON CONFLICT (tenant_key, project_key, code) DO UPDATE SET
  name = EXCLUDED.name, type = EXCLUDED.type;

INSERT INTO hse_site_metrics (tenant_key, project_key, last_lti_date, site_record_days, target_days, ltifr, ltifr_prev, trir, trir_trend, near_miss_month, compliance_training, compliance_mcu, compliance_simper, compliance_inspection)
VALUES
  ('default','default',CURRENT_DATE - INTERVAL '142 days',210,250,0.42,0.61,1.10,'stabil',9,94.0,97.0,91.0,88.0)
ON CONFLICT (tenant_key, project_key) DO UPDATE SET
  last_lti_date = EXCLUDED.last_lti_date,
  site_record_days = EXCLUDED.site_record_days,
  target_days = EXCLUDED.target_days,
  ltifr = EXCLUDED.ltifr,
  ltifr_prev = EXCLUDED.ltifr_prev,
  trir = EXCLUDED.trir,
  trir_trend = EXCLUDED.trir_trend,
  near_miss_month = EXCLUDED.near_miss_month;

COMMIT;
