-- ============================================================================
-- OMOS HSE Module - Migration 080: Fase 8 Audit, SMKP Minerba & Dokumen Regulasi
-- ============================================================================

-- 1. Tabel Master Elemen SMKP Minerba (7 Elemen berdasarkan Permen ESDM No. 26/2018)
CREATE TABLE IF NOT EXISTS hse_smkp_elements (
    id VARCHAR(64) PRIMARY KEY,
    element_no INT NOT NULL UNIQUE,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    weight_pct NUMERIC(5, 2) NOT NULL DEFAULT 14.28,
    clause_count INT NOT NULL DEFAULT 5,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed Master 7 Elemen SMKP Minerba
INSERT INTO hse_smkp_elements (id, element_no, code, name, description, weight_pct, clause_count, sort_order)
VALUES
    ('smkp-elem-1', 1, 'ELEM-I', 'Kebijakan Keselamatan Pertambangan', 'Penyusunan, penetapan, komunikasi, dan tinjauan kebijakan keselamatan pertambangan', 5.00, 3, 1),
    ('smkp-elem-2', 2, 'ELEM-II', 'Perencanaan Keselamatan Pertambangan', 'Penelaahan awal, identifikasi bahaya, IBPR, kepatuhan hukum, dan target sasaran K3', 15.00, 6, 2),
    ('smkp-elem-3', 3, 'ELEM-III', 'Organisasi dan Personel', 'Struktur KTT, PJO, Komite Keselamatan, Kelaikan Kerja, dan Pelatihan Diklat Personel', 15.00, 8, 3),
    ('smkp-elem-4', 4, 'ELEM-IV', 'Implementasi Keselamatan Pertambangan', 'Pengelolaan operasional, lingkungan, kesehatan, KO pertambangan, dan tanggap darurat', 25.00, 10, 4),
    ('smkp-elem-5', 5, 'ELEM-V', 'Pemantauan, Evaluasi, dan Tindak Lanjut', 'Inspeksi berkala, audit internal, investigasi insiden, dan penutupan tindakan korektif', 20.00, 7, 5),
    ('smkp-elem-6', 6, 'ELEM-VI', 'Dokumentasi Keselamatan Pertambangan', 'Manual SMKP, prosedur kerja SOP, instruksi kerja, pengendalian dokumen dan rekaman', 10.00, 4, 6),
    ('smkp-elem-7', 7, 'ELEM-VII', 'Tinjauan Manajemen dan Peningkatan Kinerja', 'Rapat tinjauan manajemen berkala oleh KTT/Direksi dan perbaikan berkelanjutan', 10.00, 3, 7)
ON CONFLICT (element_no) DO NOTHING;

-- 2. Tabel Program & Pelaksanaan Audit
CREATE TABLE IF NOT EXISTS hse_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
    project_key VARCHAR(64) NOT NULL DEFAULT 'default',
    audit_no VARCHAR(64) NOT NULL,
    audit_type VARCHAR(32) NOT NULL CHECK (audit_type IN ('INTERNAL', 'EXTERNAL', 'CONTRACTOR', 'REGULATOR')),
    scope VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    audit_date_start DATE NOT NULL,
    audit_date_end DATE NOT NULL,
    lead_auditor VARCHAR(255) NOT NULL,
    auditor_team TEXT,
    overall_score NUMERIC(5, 2),
    status VARCHAR(32) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'REPORTED', 'CLOSED')),
    report_url TEXT,
    notes TEXT,
    created_by VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_hse_audits_tenant_project ON hse_audits (tenant_key, project_key);
CREATE INDEX IF NOT EXISTS idx_hse_audits_status ON hse_audits (status);
CREATE INDEX IF NOT EXISTS idx_hse_audits_date ON hse_audits (audit_date_start);

-- 3. Tabel Temuan Audit (Audit Findings)
CREATE TABLE IF NOT EXISTS hse_audit_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
    project_key VARCHAR(64) NOT NULL DEFAULT 'default',
    audit_id UUID NOT NULL REFERENCES hse_audits(id) ON DELETE CASCADE,
    audit_no VARCHAR(64),
    finding_no VARCHAR(64) NOT NULL,
    element_or_clause VARCHAR(255) NOT NULL,
    category VARCHAR(32) NOT NULL CHECK (category IN ('MAJOR', 'MINOR', 'OBSERVATION', 'OPPORTUNITY')),
    description TEXT NOT NULL,
    evidence TEXT,
    action_id UUID,
    pic_name VARCHAR(255),
    due_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_ACTION', 'VERIFY', 'CLOSED')),
    resolution_notes TEXT,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_hse_audit_findings_audit ON hse_audit_findings (audit_id);
CREATE INDEX IF NOT EXISTS idx_hse_audit_findings_status ON hse_audit_findings (status);
CREATE INDEX IF NOT EXISTS idx_hse_audit_findings_category ON hse_audit_findings (category);

-- 4. Tabel Master Dokumen HSE
CREATE TABLE IF NOT EXISTS hse_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
    project_key VARCHAR(64) NOT NULL DEFAULT 'default',
    doc_no VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    doc_type VARCHAR(32) NOT NULL CHECK (doc_type IN ('POLICY', 'SOP', 'WORK_INSTRUCTION', 'FORM', 'EMERGENCY_PLAN', 'OTHER')),
    revision_no INT NOT NULL DEFAULT 0,
    effective_date DATE NOT NULL,
    next_review_date DATE,
    owner_name VARCHAR(255) NOT NULL,
    file_url TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'OBSOLETE')),
    tags TEXT,
    summary TEXT,
    created_by VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_hse_documents_tenant_project ON hse_documents (tenant_key, project_key);
CREATE INDEX IF NOT EXISTS idx_hse_documents_status ON hse_documents (status);
CREATE INDEX IF NOT EXISTS idx_hse_documents_type ON hse_documents (doc_type);

-- 5. Tabel Riwayat Revisi Dokumen HSE
CREATE TABLE IF NOT EXISTS hse_document_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
    project_key VARCHAR(64) NOT NULL DEFAULT 'default',
    document_id UUID NOT NULL REFERENCES hse_documents(id) ON DELETE CASCADE,
    revision_no INT NOT NULL,
    change_summary TEXT NOT NULL,
    file_url TEXT,
    approved_by_name VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_doc_revisions_doc ON hse_document_revisions (document_id);

-- 6. Tabel Legal Register (Kepatuhan Peraturan Perundang-undangan K3LH)
CREATE TABLE IF NOT EXISTS hse_legal_register (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
    project_key VARCHAR(64) NOT NULL DEFAULT 'default',
    regulation_title VARCHAR(255) NOT NULL,
    regulation_no VARCHAR(128) NOT NULL,
    issuer VARCHAR(64) NOT NULL DEFAULT 'ESDM_MINERBA' CHECK (issuer IN ('ESDM_MINERBA', 'KEMENAKER', 'KLHK', 'KEMENKES', 'PEMDA', 'OTHER')),
    requirement_summary TEXT NOT NULL,
    is_applicable BOOLEAN NOT NULL DEFAULT true,
    compliance_status VARCHAR(32) NOT NULL DEFAULT 'COMPLIANT' CHECK (compliance_status IN ('COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_ASSESSED')),
    pic_name VARCHAR(255),
    last_assessed_at DATE,
    file_url TEXT,
    notes TEXT,
    created_by VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_hse_legal_register_tenant_project ON hse_legal_register (tenant_key, project_key);
CREATE INDEX IF NOT EXISTS idx_hse_legal_register_compliance ON hse_legal_register (compliance_status);

-- 7. Tabel Pelaporan Wajib Instansi (Mandatory Statutory Reporting)
CREATE TABLE IF NOT EXISTS hse_mandatory_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_key VARCHAR(64) NOT NULL DEFAULT 'default',
    project_key VARCHAR(64) NOT NULL DEFAULT 'default',
    report_code VARCHAR(64) NOT NULL,
    report_name VARCHAR(255) NOT NULL,
    agency VARCHAR(64) NOT NULL CHECK (agency IN ('ESDM_KAIT', 'DLH_KLHK', 'DISNAKER', 'INTERNAL')),
    period_type VARCHAR(32) NOT NULL CHECK (period_type IN ('MONTHLY', 'QUARTERLY', 'SEMESTER', 'ANNUAL', 'INCIDENT')),
    period_label VARCHAR(64) NOT NULL,
    deadline_date DATE NOT NULL,
    submission_date DATE,
    receipt_no VARCHAR(128),
    file_url TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'OVERDUE', 'VERIFIED')),
    pic_name VARCHAR(255),
    notes TEXT,
    created_by VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_hse_mandatory_reports_tenant_project ON hse_mandatory_reports (tenant_key, project_key);
CREATE INDEX IF NOT EXISTS idx_hse_mandatory_reports_status ON hse_mandatory_reports (status);
CREATE INDEX IF NOT EXISTS idx_hse_mandatory_reports_deadline ON hse_mandatory_reports (deadline_date);
