-- =====================================================================
-- 098_people_import.sql — Import karyawan dari Excel (T15)
--
-- * Batch & baris import menyimpan hasil cek per baris (VALID/WARNING/ERROR)
--   sebelum ada karyawan yang dibuat (simulasi), lalu hasil simpan.
-- * master_aliases: padanan teks → master (departemen/jabatan/lokasi) yang
--   dikonfirmasi admin ("Operator DT" → Operator Dump Truck). Alias jabatan
--   selalu terikat ke departemen.
-- * Tidak pernah membuat departemen/jabatan/lokasi baru dari isi Excel.
-- =====================================================================
CREATE TABLE IF NOT EXISTS employee_import_batches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key         TEXT NOT NULL DEFAULT 'default',
  project_key        TEXT NOT NULL DEFAULT 'default',
  file_name          TEXT NOT NULL,
  file_sha256        TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  template_version   TEXT,
  master_version     BIGINT,
  status             TEXT NOT NULL DEFAULT 'VALIDATED'
                       CHECK (status IN ('VALIDATED','COMMITTED','PARTIAL','CANCELLED','VOIDED')),
  total_rows         INTEGER NOT NULL DEFAULT 0,
  valid_rows         INTEGER NOT NULL DEFAULT 0,
  warning_rows       INTEGER NOT NULL DEFAULT 0,
  error_rows         INTEGER NOT NULL DEFAULT 0,
  committed_rows     INTEGER NOT NULL DEFAULT 0,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_by       UUID REFERENCES users(id),
  committed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_employee_import_batches_scope
  ON employee_import_batches (tenant_key, project_key, created_at DESC);

CREATE TABLE IF NOT EXISTS employee_import_rows (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           UUID NOT NULL REFERENCES employee_import_batches(id) ON DELETE RESTRICT,
  row_no             INTEGER NOT NULL CHECK (row_no > 0),
  raw                JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL CHECK (status IN ('VALID','WARNING','ERROR','COMMITTED','SKIPPED')),
  messages           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_user_id    UUID REFERENCES users(id),
  UNIQUE (batch_id, row_no)
);

CREATE TABLE IF NOT EXISTS master_aliases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key     TEXT NOT NULL DEFAULT 'default',
  project_key    TEXT NOT NULL DEFAULT 'default',
  kind           TEXT NOT NULL CHECK (kind IN ('DEPARTMENT','POSITION','LOCATION')),
  alias_key      TEXT NOT NULL CHECK (length(alias_key) > 0),
  target_id      UUID NOT NULL,
  department_id  UUID REFERENCES workforce_departments(id) ON DELETE CASCADE,
  usage_count    INTEGER NOT NULL DEFAULT 0,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_master_alias_position_dept CHECK (kind <> 'POSITION' OR department_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_aliases
  ON master_aliases (tenant_key, project_key, kind, alias_key,
                     COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid));
