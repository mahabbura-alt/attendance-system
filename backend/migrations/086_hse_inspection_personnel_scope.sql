-- =====================================================================
-- Migrasi 086: Lingkup Personil Seleksi Kewajiban Inspeksi HSE
-- (HSE Inspection Personnel Scope Configuration)
-- =====================================================================

CREATE TABLE IF NOT EXISTS hse_inspection_personnel_scopes (
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

CREATE INDEX IF NOT EXISTS idx_hse_insp_personnel_scope_keys
  ON hse_inspection_personnel_scopes(tenant_key, project_key);

COMMENT ON TABLE hse_inspection_personnel_scopes IS
  'Menyimpan konfigurasi lingkup personil yang ditampilkan dalam matriks kewajiban inspeksi HSE per project site';
