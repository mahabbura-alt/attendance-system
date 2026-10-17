-- =====================================================================
-- 096_people_family.sql — Data keluarga & jumlah tanggungan (T8)
-- Berasal dari docs/drafts/employee_family_schema_DRAFT.sql (disetujui owner
-- 2026-10-12). Semua kolom opsional; tanggungan dihitung dari anggota
-- (is_dependent), PTKP hanya perkiraan (anak & orang tua/mertua, maks. 3).
-- =====================================================================

-- 1. Status pernikahan di profil karyawan (tabel dari migrasi 064)
ALTER TABLE workforce_employee_profiles
  ADD COLUMN IF NOT EXISTS marital_status TEXT
    CHECK (marital_status IN ('SINGLE','MARRIED','DIVORCED','WIDOWED')),
  ADD COLUMN IF NOT EXISTS marital_status_since DATE,
  ADD COLUMN IF NOT EXISTS family_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS family_updated_by UUID REFERENCES users(id);

-- 2. Anggota keluarga
CREATE TABLE IF NOT EXISTS employee_family_members (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key           TEXT NOT NULL DEFAULT 'default',
  employee_profile_id  UUID NOT NULL REFERENCES workforce_employee_profiles(id) ON DELETE RESTRICT,
  full_name            TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  relationship         TEXT NOT NULL
                         CHECK (relationship IN ('SPOUSE','CHILD','PARENT','SIBLING','OTHER')),  -- PARENT termasuk mertua
  gender               TEXT CHECK (gender IN ('M','F')),
  birth_date           DATE CHECK (birth_date IS NULL OR birth_date <= CURRENT_DATE),
  nik                  TEXT CHECK (nik IS NULL OR nik ~ '^[0-9]{16}$'),  -- opsional, ditampilkan tersamar
  is_dependent         BOOLEAN NOT NULL DEFAULT FALSE,                   -- "Ditanggung"
  is_emergency_contact BOOLEAN NOT NULL DEFAULT FALSE,
  phone                TEXT,
  notes                TEXT,
  created_by           UUID REFERENCES users(id),
  updated_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMPTZ,
  deleted_reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_efm_profile
  ON employee_family_members (employee_profile_id)
  WHERE deleted_at IS NULL;

-- NIK anggota keluarga tidak boleh dobel untuk karyawan yang sama
CREATE UNIQUE INDEX IF NOT EXISTS uq_efm_profile_nik
  ON employee_family_members (employee_profile_id, nik)
  WHERE nik IS NOT NULL AND deleted_at IS NULL;

-- 3. Audit perubahan data keluarga (nilai lama/baru + alasan)
CREATE TABLE IF NOT EXISTS employee_family_audit (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key           TEXT NOT NULL DEFAULT 'default',
  employee_profile_id  UUID NOT NULL REFERENCES workforce_employee_profiles(id) ON DELETE RESTRICT,
  family_member_id     UUID REFERENCES employee_family_members(id) ON DELETE RESTRICT,
  action               TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','MARITAL_CHANGE')),
  old_values           JSONB,
  new_values           JSONB,
  reason               TEXT,
  changed_by           UUID REFERENCES users(id),
  changed_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_efa_profile ON employee_family_audit (employee_profile_id, changed_at DESC);

-- 4. Ringkasan untuk Direktori/Payroll: jumlah tanggungan & perkiraan PTKP
CREATE OR REPLACE VIEW v_employee_family_summary AS
SELECT p.id AS employee_profile_id,
       p.user_id,
       p.marital_status,
       COUNT(m.id) FILTER (WHERE m.is_dependent)                              AS dependent_count,
       COUNT(m.id) FILTER (WHERE m.relationship = 'CHILD')                    AS child_count,
       CASE WHEN p.marital_status IS NULL THEN NULL
            ELSE (CASE WHEN p.marital_status = 'MARRIED' THEN 'K/' ELSE 'TK/' END)
                 || LEAST(3, COUNT(m.id) FILTER (WHERE m.is_dependent AND m.relationship IN ('CHILD','PARENT')))
       END                                                                    AS ptkp_estimate
FROM workforce_employee_profiles p
LEFT JOIN employee_family_members m
  ON m.employee_profile_id = p.id AND m.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.user_id, p.marital_status;
