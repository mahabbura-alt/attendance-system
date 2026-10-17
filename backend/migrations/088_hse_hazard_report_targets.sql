-- =====================================================================
-- 088_hse_hazard_report_targets.sql
-- Setup Hazard Report: matriks kewajiban pelaporan hazard per karyawan.
-- Cerminan hse_inspection_targets (084) TANPA dimensi jenis/template:
-- prioritas INDIVIDUAL > ROLE, dept spesifik > semua dept, 3 status
-- (WAJIB / BEBAS / BELUM_DIATUR) lewat hse_hazard_effective_quota().
-- Prasyarat: PostgreSQL 12+ (btree_gist untuk exclusion constraint).
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- 1. Matriks kewajiban pelaporan hazard
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_hazard_report_targets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key       TEXT NOT NULL DEFAULT 'default',
  project_key      TEXT NOT NULL DEFAULT 'default',
  target_type      TEXT NOT NULL CHECK (target_type IN ('BY_ROLE', 'BY_EMPLOYEE')),

  -- Lingkup aturan (diisi sesuai target_type)
  position_id      UUID REFERENCES workforce_positions(id)   ON DELETE RESTRICT,
  department_id    UUID REFERENCES workforce_departments(id) ON DELETE RESTRICT,
  employee_id      UUID REFERENCES users(id)                 ON DELETE RESTRICT,

  cycle            TEXT NOT NULL DEFAULT 'MONTHLY'
                   CHECK (cycle IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  target_quota     INTEGER NOT NULL DEFAULT 1 CHECK (target_quota >= 0),
  proration_mode   TEXT NOT NULL DEFAULT 'NONE'
                   CHECK (proration_mode IN ('NONE', 'BY_ATTENDANCE')),

  effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,

  reason_code      TEXT,   -- wajib untuk override individu
  notes            TEXT,

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES users(id),
  updated_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at       TIMESTAMPTZ,

  -- Bentuk baris harus konsisten dengan tipenya
  CONSTRAINT chk_hazard_target_shape CHECK (
       (target_type = 'BY_ROLE'
          AND position_id IS NOT NULL AND employee_id IS NULL)
    OR (target_type = 'BY_EMPLOYEE'
          AND employee_id IS NOT NULL AND position_id IS NULL AND department_id IS NULL)
  ),
  CONSTRAINT chk_hazard_target_period CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_hazard_override_reason CHECK (target_type = 'BY_ROLE' OR reason_code IS NOT NULL),

  -- Tidak boleh ada dua aturan aktif yang tumpang tindih untuk lingkup yang sama
  CONSTRAINT ex_hazard_target_role_overlap EXCLUDE USING gist (
    tenant_key  WITH =,
    project_key WITH =,
    position_id WITH =,
    (COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    cycle WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (target_type = 'BY_ROLE' AND is_active AND deleted_at IS NULL),

  CONSTRAINT ex_hazard_target_emp_overlap EXCLUDE USING gist (
    tenant_key  WITH =,
    project_key WITH =,
    employee_id WITH =,
    cycle WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (target_type = 'BY_EMPLOYEE' AND is_active AND deleted_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_hse_hz_target_role
  ON hse_hazard_report_targets (tenant_key, project_key, position_id) WHERE target_type = 'BY_ROLE';
CREATE INDEX IF NOT EXISTS idx_hse_hz_target_emp
  ON hse_hazard_report_targets (employee_id) WHERE target_type = 'BY_EMPLOYEE';

COMMENT ON TABLE hse_hazard_report_targets IS
  'Matriks kewajiban pelaporan hazard (Setup Hazard Report): default per jabatan + override per karyawan. 0 = bebas (disengaja); ketiadaan aturan = Belum diatur.';
COMMENT ON COLUMN hse_hazard_report_targets.target_quota IS
  '0 = bebas kewajiban (disengaja). Ketiadaan aturan = "Belum diatur", bukan 0.';

-- ---------------------------------------------------------------------
-- 2. Lingkup personil matriks kewajiban hazard (cerminan 086)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_hazard_report_scopes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key            TEXT NOT NULL DEFAULT 'default',
  project_key           TEXT NOT NULL DEFAULT 'default',
  scope_mode            TEXT NOT NULL DEFAULT 'CUSTOM' CHECK (scope_mode IN ('ALL', 'CUSTOM')),
  included_positions    TEXT[] NOT NULL DEFAULT '{}',
  included_employee_ids UUID[] NOT NULL DEFAULT '{}',
  excluded_employee_ids UUID[] NOT NULL DEFAULT '{}',
  notes                 TEXT,
  updated_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_key, project_key)
);

CREATE INDEX IF NOT EXISTS idx_hse_hz_report_scope_keys
  ON hse_hazard_report_scopes(tenant_key, project_key);

COMMENT ON TABLE hse_hazard_report_scopes IS
  'Menyimpan konfigurasi lingkup personil yang ditampilkan dalam matriks kewajiban pelaporan hazard per project site';

-- ---------------------------------------------------------------------
-- 3. Perluas tipe entitas audit setup agar mencakup target hazard
-- ---------------------------------------------------------------------
DO $$
DECLARE cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'hse_inspection_setup_audit'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%entity_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE hse_inspection_setup_audit DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE hse_inspection_setup_audit
  ADD CONSTRAINT chk_hse_setup_audit_entity
  CHECK (entity_type IN ('TEMPLATE', 'TARGET', 'SCHEDULE', 'HAZARD_TARGET'));

-- ---------------------------------------------------------------------
-- 4. Fungsi kuota efektif pelaporan hazard
-- Prioritas: INDIVIDUAL (0) > ROLE (2); dept spesifik (0) > semua dept (1).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hse_hazard_effective_quota(
  p_employee_id UUID,
  p_cycle       TEXT,
  p_on_date     DATE
) RETURNS TABLE (rule_id UUID, source TEXT, quota INTEGER, status TEXT) AS $$
  WITH emp AS (
    SELECT
      u.id,
      wp.id AS position_id,
      wd.id AS department_id
    FROM users u
    LEFT JOIN workforce_positions wp
      ON lower(trim(wp.name)) = lower(trim(COALESCE(u.jabatan, '')))
    LEFT JOIN workforce_departments wd
      ON lower(trim(wd.name)) = lower(trim(COALESCE(u.departemen, '')))
    WHERE u.id = p_employee_id
  ),
  cand AS (
    SELECT t.id,
           t.target_quota,
           CASE WHEN t.target_type = 'BY_EMPLOYEE' THEN 'INDIVIDUAL' ELSE 'ROLE' END AS source,
           CASE WHEN t.target_type = 'BY_EMPLOYEE' THEN 0 ELSE 2 END AS rnk,
           CASE WHEN t.department_id IS NULL THEN 1 ELSE 0 END      AS dept_generic
      FROM hse_hazard_report_targets t, emp
     WHERE t.is_active
       AND t.deleted_at IS NULL
       AND t.cycle = p_cycle
       AND t.effective_from <= p_on_date
       AND (t.effective_to IS NULL OR t.effective_to >= p_on_date)
       AND (
            (t.target_type = 'BY_EMPLOYEE' AND t.employee_id = emp.id)
         OR (t.target_type = 'BY_ROLE'
             AND emp.position_id IS NOT NULL
             AND t.position_id = emp.position_id
             AND (t.department_id IS NULL OR t.department_id = emp.department_id))
       )
  )
  SELECT * FROM (
    SELECT id, source, target_quota,
           CASE WHEN target_quota > 0 THEN 'WAJIB' ELSE 'BEBAS' END
      FROM cand
     ORDER BY rnk, dept_generic
     LIMIT 1
  ) best
  UNION ALL
  SELECT NULL::uuid, 'NONE', NULL::integer, 'BELUM_DIATUR'
   WHERE NOT EXISTS (SELECT 1 FROM cand);
$$ LANGUAGE sql STABLE;
