-- Roster Karyawan: template eksplisit, assignment efektif, jadwal harian, dan audit.
CREATE TABLE IF NOT EXISTS roster_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nama VARCHAR(150) NOT NULL UNIQUE,
  roster_kerja_hari INTEGER NOT NULL DEFAULT 0 CHECK (roster_kerja_hari >= 0),
  roster_cuti_hari INTEGER NOT NULL DEFAULT 0 CHECK (roster_cuti_hari >= 0),
  pola_shift VARCHAR(150),
  cycle_days INTEGER NOT NULL CHECK (cycle_days BETWEEN 1 AND 366),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roster_template_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES roster_templates(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL CHECK (day_index BETWEEN 1 AND 366),
  status VARCHAR(4) NOT NULL CHECK (status IN ('S','M','C','CP','OFF')),
  UNIQUE(template_id, day_index)
);

CREATE TABLE IF NOT EXISTS employee_roster_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES roster_templates(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  anchor_day_index INTEGER NOT NULL DEFAULT 1 CHECK (anchor_day_index BETWEEN 1 AND 366),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_roster_assignment_user_dates
  ON employee_roster_assignments(user_id, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS employee_roster_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tanggal DATE NOT NULL,
  status VARCHAR(4) NOT NULL CHECK (status IN ('S','M','C','CP','OFF')),
  shift_id UUID REFERENCES shifts(id),
  assignment_id UUID REFERENCES employee_roster_assignments(id) ON DELETE SET NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','manual_override')),
  catatan TEXT,
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, tanggal)
);
CREATE INDEX IF NOT EXISTS idx_roster_daily_date_user
  ON employee_roster_daily(tanggal, user_id);

CREATE TABLE IF NOT EXISTS roster_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  aksi VARCHAR(50) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
