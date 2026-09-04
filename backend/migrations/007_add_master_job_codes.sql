CREATE TABLE IF NOT EXISTS master_job_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_code VARCHAR(20) NOT NULL UNIQUE,
  job_desc VARCHAR(200) NOT NULL,
  is_reference BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

INSERT INTO master_job_codes (job_code, job_desc, is_reference) VALUES
  ('DW', 'Daywork', TRUE),
  ('G05', 'General Disposal Area', TRUE),
  ('G06', 'General Pipa, Gorong2', TRUE),
  ('G07', 'General Infrastructure Area', TRUE),
  ('G08', 'Membersihkan Spoil', TRUE),
  ('G09', 'Membersihkan Vessel', TRUE),
  ('G10', 'Perbaikan Jalan', TRUE),
  ('G11', 'Support Buat Tanggul Muat Lumpur', TRUE),
  ('G12', 'Sidecast to Final Dump', TRUE),
  ('G13', 'Tarik/Angkat Alat Lain', TRUE),
  ('GNR', 'General', TRUE),
  ('G04', 'Day Work', TRUE),
  ('OB', 'OB Blasting', TRUE),
  ('OR', 'OB Ripping', TRUE),
  ('OG', 'OB Freedig', TRUE),
  ('BG', 'Coal Barging', TRUE),
  ('LY', 'Layering', TRUE),
  ('OS', 'Spoil', TRUE),
  ('TS', 'Top Soil', TRUE),
  ('MD', 'Mud Original Lembek', TRUE),
  ('MC', 'Mud Original Cair', TRUE),
  ('CG', 'Coal Getting', TRUE),
  ('CH', 'Coal Hauling', TRUE)
ON CONFLICT (job_code) DO NOTHING;
