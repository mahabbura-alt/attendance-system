-- =====================================================================
-- 092_hse_workhours.sql
-- HSE Setup Master → Jam kerja karyawan.
--
-- 1. hse_workhour_standards  : standar jam kerja per hari (jabatan/departemen
--                              atau per karyawan), effective-dated, anti overlap.
-- 2. hse_workhour_periods    : penguncian rekap bulanan ("Kirim ke jam kerja HSE").
-- 3. hse_workhour_period_lines: snapshot per karyawan saat periode dikunci.
-- 4. hse_workhour_audit      : jejak perubahan standar dan periode.
-- 5. hse_manhours            : kolom rujukan periode agar baris ATTENDANCE
--                              bisa ditelusuri ke snapshot asalnya.
--
-- Hari hadir TIDAK disimpan di sini: dihitung dari sumber yang sama dengan
-- Rekap Performa (absensi + keterangan_presensi), lalu dibekukan saat kirim.
-- Rujukan jabatan/departemen: workforce_positions / workforce_departments
-- (pola sama dengan hse_inspection_targets, migrasi 084).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- 1. Standar jam kerja per hari
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_workhour_standards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key     TEXT NOT NULL DEFAULT 'default',
  project_key    TEXT NOT NULL DEFAULT 'default',
  target_type    TEXT NOT NULL CHECK (target_type IN ('BY_ROLE', 'BY_EMPLOYEE')),

  position_id    UUID REFERENCES workforce_positions(id)   ON DELETE RESTRICT,
  department_id  UUID REFERENCES workforce_departments(id) ON DELETE RESTRICT,
  employee_id    UUID REFERENCES users(id)                 ON DELETE RESTRICT,

  hours_per_day  NUMERIC(4,2) NOT NULL CHECK (hours_per_day > 0 AND hours_per_day <= 24),

  effective_from DATE NOT NULL,
  effective_to   DATE,

  reason_code    TEXT,   -- wajib untuk BY_EMPLOYEE
  notes          TEXT,
  batch_id       UUID,   -- satu kali simpan dari form (multi jabatan/karyawan)

  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     UUID REFERENCES users(id),
  updated_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMPTZ,

  CONSTRAINT chk_whs_shape CHECK (
       (target_type = 'BY_ROLE'     AND position_id IS NOT NULL AND employee_id IS NULL)
    OR (target_type = 'BY_EMPLOYEE' AND employee_id IS NOT NULL AND position_id IS NULL AND department_id IS NULL)
  ),
  CONSTRAINT chk_whs_period CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_whs_reason CHECK (target_type = 'BY_ROLE' OR reason_code IS NOT NULL),

  -- Tidak boleh ada dua aturan aktif yang tumpang tindih untuk lingkup yang sama
  CONSTRAINT ex_whs_role_overlap EXCLUDE USING gist (
    tenant_key  WITH =,
    project_key WITH =,
    position_id WITH =,
    (COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (target_type = 'BY_ROLE' AND is_active AND deleted_at IS NULL),

  CONSTRAINT ex_whs_emp_overlap EXCLUDE USING gist (
    tenant_key  WITH =,
    project_key WITH =,
    employee_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (target_type = 'BY_EMPLOYEE' AND is_active AND deleted_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_whs_role
  ON hse_workhour_standards (tenant_key, project_key, position_id, department_id)
  WHERE target_type = 'BY_ROLE' AND is_active AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_whs_emp
  ON hse_workhour_standards (tenant_key, project_key, employee_id)
  WHERE target_type = 'BY_EMPLOYEE' AND is_active AND deleted_at IS NULL;

COMMENT ON TABLE hse_workhour_standards IS
  'Standar jam kerja per hari hadir. Prioritas: BY_EMPLOYEE > BY_ROLE+departemen > BY_ROLE. Tanpa aturan = Belum diatur (bukan 0 jam).';

-- ---------------------------------------------------------------------
-- 2. Periode bulanan terkunci (Kirim ke jam kerja HSE)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_workhour_periods (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key        TEXT NOT NULL DEFAULT 'default',
  project_key       TEXT NOT NULL DEFAULT 'default',
  period_month      DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  status            TEXT NOT NULL DEFAULT 'LOCKED' CHECK (status IN ('LOCKED', 'REOPENED')),
  total_hours       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_hours >= 0),
  employee_count    INTEGER NOT NULL DEFAULT 0,
  present_days      INTEGER NOT NULL DEFAULT 0,
  uncounted_days    INTEGER NOT NULL DEFAULT 0,
  uncounted_note    TEXT,
  sent_by           UUID REFERENCES users(id),
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reopened_by       UUID REFERENCES users(id),
  reopened_at       TIMESTAMPTZ,
  reopen_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_whp_reopen CHECK (status = 'LOCKED' OR (reopen_reason IS NOT NULL AND reopened_at IS NOT NULL))
);

-- Hanya satu periode terkunci per bulan; riwayat REOPENED tetap tersimpan
CREATE UNIQUE INDEX IF NOT EXISTS uq_whp_locked_month
  ON hse_workhour_periods (tenant_key, project_key, period_month)
  WHERE status = 'LOCKED';
CREATE INDEX IF NOT EXISTS idx_whp_scope
  ON hse_workhour_periods (tenant_key, project_key, period_month DESC);

-- ---------------------------------------------------------------------
-- 3. Snapshot per karyawan saat periode dikunci
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_workhour_period_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id          UUID NOT NULL REFERENCES hse_workhour_periods(id) ON DELETE RESTRICT,
  employee_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  employee_name      TEXT,
  employee_no        TEXT,
  position_name      TEXT,
  department_name    TEXT,
  present_days       INTEGER NOT NULL DEFAULT 0 CHECK (present_days >= 0),
  counted_days       INTEGER NOT NULL DEFAULT 0 CHECK (counted_days >= 0),
  counted_hours      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (counted_hours >= 0),
  standard_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{hours, days, source, rule_id}]
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period_id, employee_id)
);

-- ---------------------------------------------------------------------
-- 4. Audit
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_workhour_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key   TEXT NOT NULL DEFAULT 'default',
  project_key  TEXT NOT NULL DEFAULT 'default',
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('STANDARD', 'PERIOD')),
  entity_id    UUID,
  action       TEXT NOT NULL CHECK (action IN ('CREATE', 'SUPERSEDE', 'END', 'LOCK', 'REOPEN')),
  old_values   JSONB,
  new_values   JSONB,
  reason       TEXT,
  changed_by   UUID REFERENCES users(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wha_scope ON hse_workhour_audit (tenant_key, project_key, changed_at DESC);

-- ---------------------------------------------------------------------
-- 5. hse_manhours: rujukan ke periode jam kerja (baris source = ATTENDANCE)
-- ---------------------------------------------------------------------
ALTER TABLE hse_manhours
  ADD COLUMN IF NOT EXISTS workhour_period_id UUID REFERENCES hse_workhour_periods(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_hse_manhours_workhour_period
  ON hse_manhours (workhour_period_id) WHERE workhour_period_id IS NOT NULL;

-- Data presensi dibaca per rentang tanggal oleh rekap jam kerja
CREATE INDEX IF NOT EXISTS idx_absensi_tanggal_user ON absensi (tanggal_kerja, user_id);
