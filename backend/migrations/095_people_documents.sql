-- =====================================================================
-- 095_people_documents.sql — Dokumen karyawan PDF: CV, kompetensi, dll. (T7)
--
-- * File disimpan di storage terpisah dari foto absensi dan hanya bisa
--   dibuka lewat endpoint ber-login (BUKAN /api/storage/view yang publik).
-- * Hanya PDF, maksimal 5 MB, dicek isi file (%PDF) oleh backend.
-- * Satu CV aktif per karyawan; mengganti CV = CV lama di-nonaktifkan.
-- * Lisensi & pelatihan HSE dapat merujuk dokumen yang sama (satu sumber).
-- =====================================================================
CREATE TABLE IF NOT EXISTS employee_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key           TEXT NOT NULL DEFAULT 'default',
  employee_profile_id  UUID NOT NULL REFERENCES workforce_employee_profiles(id) ON DELETE RESTRICT,
  doc_type             TEXT NOT NULL CHECK (doc_type IN ('CV','COMPETENCY','KTP','CONTRACT','MCU','OTHER')),
  title                TEXT NOT NULL CHECK (length(trim(title)) > 0),
  doc_number           TEXT,
  issued_date          DATE,
  expiry_date          DATE,
  storage_key          TEXT NOT NULL,
  original_filename    TEXT NOT NULL,
  mime_type            TEXT NOT NULL DEFAULT 'application/pdf' CHECK (mime_type = 'application/pdf'),
  size_bytes           INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256               TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by          UUID REFERENCES users(id),
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMPTZ,
  deleted_by           UUID REFERENCES users(id),
  delete_reason        TEXT,
  CONSTRAINT chk_employee_documents_dates CHECK (expiry_date IS NULL OR issued_date IS NULL OR expiry_date >= issued_date)
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_profile
  ON employee_documents (employee_profile_id, doc_type) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_documents_active_cv
  ON employee_documents (employee_profile_id) WHERE doc_type = 'CV' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry
  ON employee_documents (tenant_key, expiry_date) WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_document_access_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES employee_documents(id) ON DELETE RESTRICT,
  action       TEXT NOT NULL CHECK (action IN ('UPLOAD','VIEW','DELETE')),
  actor_id     UUID REFERENCES users(id),
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_employee_document_access_doc
  ON employee_document_access_log (document_id, created_at DESC);

-- Satu sumber kompetensi dengan HSE (D4): rujukan opsional ke dokumen.
DO $$
BEGIN
  IF to_regclass('public.hse_employee_licenses') IS NOT NULL THEN
    ALTER TABLE hse_employee_licenses ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES employee_documents(id) ON DELETE SET NULL;
  END IF;
  IF to_regclass('public.hse_training_records') IS NOT NULL THEN
    ALTER TABLE hse_training_records ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES employee_documents(id) ON DELETE SET NULL;
  END IF;
END $$;
