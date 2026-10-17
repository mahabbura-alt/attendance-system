-- =====================================================================
-- Migration 084: Modul HSE - Setup Inspeksi, Matriks Kewajiban, Versioning, dan Audit
-- Mengacu pada RENCANA_SETUP_INSPEKSI_HSE_V2.md (disesuaikan dengan skema OMOS)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- 1. Perluasan hse_inspection_templates
-- ---------------------------------------------------------------------
ALTER TABLE hse_inspection_templates
  ADD COLUMN IF NOT EXISTS inspection_type       TEXT,
  ADD COLUMN IF NOT EXISTS schedule_cycle        TEXT,
  ADD COLUMN IF NOT EXISTS custom_interval_days  INTEGER,
  ADD COLUMN IF NOT EXISTS setup_reviewed        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS root_id               UUID REFERENCES hse_inspection_templates(id),
  ADD COLUMN IF NOT EXISTS version_no            INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current            BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS locked_at             TIMESTAMPTZ;

-- Backfill root_id untuk template yang sudah ada sebelumnya
UPDATE hse_inspection_templates SET root_id = id WHERE root_id IS NULL;
ALTER TABLE hse_inspection_templates ALTER COLUMN root_id SET NOT NULL;

-- Trigger: Template baru otomatis menjadi akar versinya sendiri jika root_id belum diisi
CREATE OR REPLACE FUNCTION hse_template_set_root() RETURNS trigger AS $$
BEGIN
  IF NEW.root_id IS NULL THEN 
    NEW.root_id := NEW.id; 
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hse_template_set_root ON hse_inspection_templates;
CREATE TRIGGER trg_hse_template_set_root
  BEFORE INSERT ON hse_inspection_templates
  FOR EACH ROW EXECUTE FUNCTION hse_template_set_root();

-- Lepas constraint unik lama pada (tenant_key, project_key, code) agar versioning berfungsi
ALTER TABLE hse_inspection_templates
  DROP CONSTRAINT IF EXISTS hse_inspection_templates_tenant_key_project_key_code_key;

-- Unik per versi kode dalam lingkup tenant & project
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_scope_code_version
  ON hse_inspection_templates (tenant_key, project_key, code, version_no);

-- Unik per root_id dan version_no
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_root_version
  ON hse_inspection_templates (root_id, version_no);

-- Hanya satu versi aktif (is_current = true) per root_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_current_per_root
  ON hse_inspection_templates (root_id) WHERE is_current;

-- CHECK konsistensi sifat, siklus, dan interval (hanya dipaksa setelah ditinjau/setup_reviewed = TRUE)
ALTER TABLE hse_inspection_templates
  DROP CONSTRAINT IF EXISTS chk_template_setup;

ALTER TABLE hse_inspection_templates
  ADD CONSTRAINT chk_template_setup CHECK (
    setup_reviewed = FALSE OR (
      schedule_cycle IS NOT NULL
      AND (
           (inspection_type = 'UNPLANNED' AND schedule_cycle = 'NONE')
        OR (inspection_type = 'PLANNED'
            AND schedule_cycle IN ('DAILY','WEEKLY','MONTHLY','CUSTOM_DAYS'))
      )
      AND (
           (schedule_cycle = 'CUSTOM_DAYS' AND custom_interval_days > 0)
        OR (schedule_cycle <> 'CUSTOM_DAYS' AND custom_interval_days IS NULL)
      )
    )
  );

COMMENT ON COLUMN hse_inspection_templates.inspection_type IS
  'PLANNED (terencana) atau UNPLANNED (tidak terencana / ad-hoc)';
COMMENT ON COLUMN hse_inspection_templates.schedule_cycle IS
  'DAILY, WEEKLY, MONTHLY, CUSTOM_DAYS, atau NONE (khusus UNPLANNED)';
COMMENT ON COLUMN hse_inspection_templates.setup_reviewed IS
  'FALSE untuk template lama yang belum ditinjau; UI menandai "Perlu ditinjau"';
COMMENT ON COLUMN hse_inspection_templates.locked_at IS
  'Terisi saat template pertama kali dipakai inspeksi; butir checklist tidak boleh diubah';

-- ---------------------------------------------------------------------
-- 2. Pembekuan template yang sudah dipakai inspeksi
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hse_lock_template_on_inspection() RETURNS trigger AS $$
BEGIN
  UPDATE hse_inspection_templates
     SET locked_at = COALESCE(locked_at, now())
   WHERE id = NEW.template_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hse_inspection_lock_template ON hse_inspections;
CREATE TRIGGER trg_hse_inspection_lock_template
  AFTER INSERT ON hse_inspections
  FOR EACH ROW EXECUTE FUNCTION hse_lock_template_on_inspection();

CREATE OR REPLACE FUNCTION hse_guard_locked_template_items() RETURNS trigger AS $$
DECLARE
  v_template UUID;
  v_locked   TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'DELETE' THEN 
    v_template := OLD.template_id;
  ELSE 
    v_template := NEW.template_id; 
  END IF;

  SELECT locked_at INTO v_locked
    FROM hse_inspection_templates WHERE id = v_template;

  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION
      'Templat % sudah dipakai inspeksi dan terkunci. Simpan sebagai versi baru.', v_template;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hse_template_items_guard ON hse_inspection_template_items;
CREATE TRIGGER trg_hse_template_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON hse_inspection_template_items
  FOR EACH ROW EXECUTE FUNCTION hse_guard_locked_template_items();

-- ---------------------------------------------------------------------
-- 3. Matriks Kewajiban Inspeksi (hse_inspection_targets)
-- Rujukan: workforce_positions(id) dan workforce_departments(id)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_inspection_targets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key       TEXT NOT NULL DEFAULT 'default',
  project_key      TEXT NOT NULL DEFAULT 'default',
  target_type      TEXT NOT NULL CHECK (target_type IN ('BY_ROLE', 'BY_EMPLOYEE')),

  -- Lingkup aturan sesuai OMOS master data
  position_id      UUID REFERENCES workforce_positions(id)   ON DELETE RESTRICT,
  department_id    UUID REFERENCES workforce_departments(id) ON DELETE RESTRICT,
  employee_id      UUID REFERENCES users(id)                 ON DELETE RESTRICT,

  -- NULL = berlaku untuk semua jenis inspeksi. Merujuk ke akar versi (root_id).
  template_root_id UUID REFERENCES hse_inspection_templates(id) ON DELETE RESTRICT,

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

  CONSTRAINT chk_target_shape CHECK (
       (target_type = 'BY_ROLE'
          AND position_id IS NOT NULL AND employee_id IS NULL)
    OR (target_type = 'BY_EMPLOYEE'
          AND employee_id IS NOT NULL AND position_id IS NULL AND department_id IS NULL)
  ),
  CONSTRAINT chk_target_period CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_override_reason CHECK (target_type = 'BY_ROLE' OR reason_code IS NOT NULL),

  -- Cegah aturan aktif tumpang tindih untuk lingkup yang sama
  CONSTRAINT ex_target_role_overlap EXCLUDE USING gist (
    tenant_key  WITH =,
    project_key WITH =,
    position_id WITH =,
    (COALESCE(department_id,    '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE(template_root_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    cycle WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (target_type = 'BY_ROLE' AND is_active AND deleted_at IS NULL),

  CONSTRAINT ex_target_emp_overlap EXCLUDE USING gist (
    tenant_key  WITH =,
    project_key WITH =,
    employee_id WITH =,
    (COALESCE(template_root_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    cycle WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (target_type = 'BY_EMPLOYEE' AND is_active AND deleted_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_hse_insp_target_role
  ON hse_inspection_targets (tenant_key, project_key, position_id) WHERE target_type = 'BY_ROLE';
CREATE INDEX IF NOT EXISTS idx_hse_insp_target_emp
  ON hse_inspection_targets (employee_id) WHERE target_type = 'BY_EMPLOYEE';
CREATE INDEX IF NOT EXISTS idx_hse_insp_target_tmpl
  ON hse_inspection_targets (template_root_id);

COMMENT ON COLUMN hse_inspection_targets.target_quota IS
  '0 = bebas kewajiban (disengaja). Ketiadaan aturan = "Belum diatur", bukan 0.';
COMMENT ON COLUMN hse_inspection_targets.template_root_id IS
  'NULL = semua jenis inspeksi. Mengacu akar versi agar versi baru tidak memutus aturan.';

-- ---------------------------------------------------------------------
-- 4. Audit Log Perubahan Setup Inspeksi
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_inspection_setup_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key  TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  entity_type TEXT NOT NULL CHECK (entity_type IN ('TEMPLATE', 'TARGET', 'SCHEDULE')),
  entity_id   UUID NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DEACTIVATE', 'NEW_VERSION')),
  old_values  JSONB,
  new_values  JSONB,
  reason      TEXT,
  changed_by  UUID REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_insp_audit_entity
  ON hse_inspection_setup_audit (entity_type, entity_id, changed_at DESC);

-- ---------------------------------------------------------------------
-- 5. Fungsi Penentuan Kuota Efektif (hse_effective_quota)
-- Disesuaikan dengan tabel users & workforce_positions OMOS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hse_effective_quota(
  p_employee_id      UUID,
  p_template_root_id UUID,
  p_cycle            TEXT,
  p_on_date          DATE
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
           ( CASE WHEN t.target_type = 'BY_EMPLOYEE' THEN 0 ELSE 2 END
           + CASE WHEN t.template_root_id IS NULL    THEN 1 ELSE 0 END ) AS rnk,
           CASE WHEN t.department_id IS NULL THEN 1 ELSE 0 END           AS dept_generic
      FROM hse_inspection_targets t, emp
     WHERE t.is_active
       AND t.deleted_at IS NULL
       AND t.cycle = p_cycle
       AND t.effective_from <= p_on_date
       AND (t.effective_to IS NULL OR t.effective_to >= p_on_date)
       AND (t.template_root_id = p_template_root_id OR t.template_root_id IS NULL)
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
