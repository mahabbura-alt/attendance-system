-- =====================================================================
-- 093_people_personal_nrp.sql — OMOS People v2 (rencana T2/T4/T5)
--
-- 1. people_settings              : pengaturan per tenant (pola NRP, nomor urut,
--                                   versi master, pemisahan peran).
-- 2. workforce_employee_personal  : data pribadi 1:1 dengan profil karyawan
--                                   (bukan di users — users = identitas login).
-- 3. workforce_employee_field_audit: audit per kolom (nilai lama/baru, alasan).
-- 4. workforce_positions.function_tag: fungsi jabatan untuk modul lain
--                                   (pengganti LIKE '%operator%').
--
-- Aditif & idempoten. Kolom lama (users.nik_ktp, users.jabatan, ...) tidak
-- diubah; NIK yang sudah ada di users disalin ke data pribadi.
-- =====================================================================

CREATE TABLE IF NOT EXISTS people_settings (
  tenant_key                 TEXT PRIMARY KEY DEFAULT 'default',
  nrp_pattern                TEXT NOT NULL DEFAULT 'PIM-{YY}{MM}-{SEQ4}',
  nrp_seq                    BIGINT NOT NULL DEFAULT 0 CHECK (nrp_seq >= 0),
  probation_months           INTEGER NOT NULL DEFAULT 3 CHECK (probation_months BETWEEN 0 AND 12),
  master_version             BIGINT NOT NULL DEFAULT 1,
  require_checklist_before_effective BOOLEAN NOT NULL DEFAULT FALSE,
  allow_super_admin_self_approval    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by                 UUID REFERENCES users(id),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_people_nrp_pattern CHECK (nrp_pattern ~ '\{SEQ[3-6]\}')
);
INSERT INTO people_settings (tenant_key) VALUES ('default') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS workforce_employee_personal (
  employee_profile_id        UUID PRIMARY KEY REFERENCES workforce_employee_profiles(id) ON DELETE RESTRICT,
  tenant_key                 TEXT NOT NULL DEFAULT 'default',
  nik                        VARCHAR(16) CHECK (nik IS NULL OR nik ~ '^[0-9]{16}$'),
  birth_place                TEXT,
  birth_date                 DATE CHECK (birth_date IS NULL OR birth_date BETWEEN DATE '1900-01-01' AND CURRENT_DATE),
  gender                     TEXT CHECK (gender IS NULL OR gender IN ('M','F')),
  phone                      TEXT CHECK (phone IS NULL OR phone ~ '^[0-9+() -]{6,20}$'),
  address                    TEXT,
  blood_type                 TEXT CHECK (blood_type IS NULL OR blood_type IN ('A','B','AB','O')),
  emergency_contact_name     TEXT,
  emergency_contact_relation TEXT,
  emergency_contact_phone    TEXT,
  updated_by                 UUID REFERENCES users(id),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_personal_nik
  ON workforce_employee_personal (tenant_key, nik) WHERE nik IS NOT NULL;

-- Salin NIK lama yang valid (16 digit) dari users ke data pribadi.
INSERT INTO workforce_employee_personal (employee_profile_id, tenant_key, nik)
SELECT p.id, p.tenant_key, u.nik_ktp
FROM workforce_employee_profiles p
JOIN users u ON u.id = p.user_id
WHERE u.nik_ktp ~ '^[0-9]{16}$'
ON CONFLICT (employee_profile_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workforce_employee_field_audit (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key           TEXT NOT NULL DEFAULT 'default',
  employee_profile_id  UUID NOT NULL REFERENCES workforce_employee_profiles(id) ON DELETE RESTRICT,
  entity               TEXT NOT NULL CHECK (entity IN ('PERSONAL','ACCOUNT','FAMILY','LOCATIONS','DOCUMENT','PROFILE','IMPORT')),
  field                TEXT NOT NULL,
  old_value            TEXT,
  new_value            TEXT,
  reason               TEXT,
  actor_id             UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_employee_field_audit_profile
  ON workforce_employee_field_audit (employee_profile_id, created_at DESC);

ALTER TABLE workforce_positions
  ADD COLUMN IF NOT EXISTS function_tag TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_workforce_positions_function_tag') THEN
    ALTER TABLE workforce_positions ADD CONSTRAINT chk_workforce_positions_function_tag
      CHECK (function_tag IS NULL OR function_tag IN ('OPERATOR','SUPERVISOR','MECHANIC','DRIVER','STAFF','OTHER'));
  END IF;
END $$;
