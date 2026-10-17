-- 101_hse_mobile_safety.sql
-- OMOS Safety (APK HSE lapangan): sinkronisasi offline idempoten, tindakan segera / Stop Work,
-- koreksi & pembatalan laporan, permintaan PIC ke Delegator Departemen, notifikasi (polling),
-- Pertemuan K3 / Umum, serta login Employee ID + reset sandi lewat admin.
-- Rujukan keputusan: docs/OMOS_SAFETY_MOCKUP_REVISI_DASHBOARD_CONTEXT.md
-- Idempoten: aman dijalankan ulang. Rollback: 101_hse_mobile_safety_down.sql

BEGIN;

-- ---------------------------------------------------------------
-- 1. Login Employee ID & reset sandi lewat admin (salinan idempoten 043 PR #1)
-- ---------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'rejected')),
  source VARCHAR(32) NOT NULL DEFAULT 'mobile',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_requests_pending
  ON password_reset_requests (user_id) WHERE status = 'pending';

-- ---------------------------------------------------------------
-- 2. Hazard: idempotensi, tindakan segera, Stop Work, koreksi/batal
-- ---------------------------------------------------------------
ALTER TABLE hazard_reports
  ADD COLUMN IF NOT EXISTS client_uuid UUID,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'WEB',
  ADD COLUMN IF NOT EXISTS immediate_action TEXT,
  ADD COLUMN IF NOT EXISTS stop_work BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision_no INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hazard_reports_client_uuid
  ON hazard_reports (tenant_key, project_key, client_uuid) WHERE client_uuid IS NOT NULL;

-- Status CANCELLED = dibatalkan pelapor sebelum diproses (tetap tercatat, tidak dihitung statistik).
ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_status_check;
ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_status_check
  CHECK (status IN ('NEW','ASSESSED','IN_ACTION','VERIFY','CLOSED','REJECTED','DUPLICATE','CANCELLED'));

-- Revisi laporan (koreksi pelapor): isi lama disimpan utuh.
CREATE TABLE IF NOT EXISTS hse_hazard_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  hazard_id UUID NOT NULL REFERENCES hazard_reports(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  changed_fields TEXT[] NOT NULL DEFAULT '{}'::text[],
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hazard_id, revision_no)
);

-- Timeline hazard (riwayat status untuk pelapor, PIC, delegator, HSE).
CREATE TABLE IF NOT EXISTS hse_hazard_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  hazard_id UUID NOT NULL REFERENCES hazard_reports(id) ON DELETE CASCADE,
  action_id UUID REFERENCES hse_actions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  note TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_uuid UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hse_hazard_events_hazard ON hse_hazard_events (hazard_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_hazard_events_client_uuid
  ON hse_hazard_events (tenant_key, project_key, client_uuid) WHERE client_uuid IS NOT NULL;

-- ---------------------------------------------------------------
-- 3. Tindak lanjut PIC (hse_actions): batas waktu presisi & bukti
-- ---------------------------------------------------------------
ALTER TABLE hse_actions
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_note TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

-- ---------------------------------------------------------------
-- 4. Delegator Departemen (diatur Admin HSE) & permintaan PIC
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_department_delegators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  department_id UUID NOT NULL REFERENCES workforce_departments(id) ON DELETE RESTRICT,
  delegator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  backup_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_delegator_backup_diff CHECK (backup_user_id IS NULL OR backup_user_id <> delegator_user_id),
  CONSTRAINT chk_delegator_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
-- Satu delegator aktif per departemen; riwayat disimpan dengan menonaktifkan baris lama.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_department_delegators_active
  ON hse_department_delegators (tenant_key, project_key, department_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_hse_department_delegators_user
  ON hse_department_delegators (delegator_user_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS hse_pic_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  client_uuid UUID,
  hazard_id UUID NOT NULL REFERENCES hazard_reports(id) ON DELETE CASCADE,
  action_id UUID NOT NULL REFERENCES hse_actions(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  department_id UUID REFERENCES workforce_departments(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('REASSIGN','EXTEND')),
  reason TEXT NOT NULL,
  proposed_department_id UUID REFERENCES workforce_departments(id) ON DELETE SET NULL,
  proposed_due_date DATE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','FORWARDED')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  new_pic_id UUID REFERENCES users(id) ON DELETE SET NULL,
  forwarded_department_id UUID REFERENCES workforce_departments(id) ON DELETE SET NULL,
  approved_due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_pic_requests_client_uuid
  ON hse_pic_requests (tenant_key, project_key, client_uuid) WHERE client_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_pic_requests_pending_action
  ON hse_pic_requests (action_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_hse_pic_requests_dept_status
  ON hse_pic_requests (tenant_key, project_key, department_id, status);

-- ---------------------------------------------------------------
-- 5. Notifikasi in-app (diambil APK lewat polling; tanpa push pihak ketiga)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_notifications (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  ref_type TEXT,
  ref_id UUID,
  is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hse_notifications_user_cursor ON hse_notifications (user_id, id);
CREATE INDEX IF NOT EXISTS idx_hse_notifications_user_unread ON hse_notifications (user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------
-- 6. Insiden, inspeksi, P5M, Safety Talk: idempotensi sinkronisasi
-- ---------------------------------------------------------------
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS client_uuid UUID,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'WEB',
  ADD COLUMN IF NOT EXISTS immediate_action TEXT,
  ADD COLUMN IF NOT EXISTS unit_code TEXT,
  ADD COLUMN IF NOT EXISTS reported_category TEXT,
  ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_client_uuid
  ON incidents (tenant_key, project_key, client_uuid) WHERE client_uuid IS NOT NULL;

ALTER TABLE hse_inspections ADD COLUMN IF NOT EXISTS client_uuid UUID;
-- Foto bukti per butir "Tidak OK" dari APK.
ALTER TABLE hse_inspection_answers ADD COLUMN IF NOT EXISTS photo TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_inspections_client_uuid
  ON hse_inspections (tenant_key, project_key, client_uuid) WHERE client_uuid IS NOT NULL;

ALTER TABLE hse_p5m_events ADD COLUMN IF NOT EXISTS client_uuid UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_p5m_events_client_uuid
  ON hse_p5m_events (tenant_key, project_key, client_uuid) WHERE client_uuid IS NOT NULL;

ALTER TABLE hse_safetytalk_events ADD COLUMN IF NOT EXISTS client_uuid UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_safetytalk_events_client_uuid
  ON hse_safetytalk_events (tenant_key, project_key, client_uuid) WHERE client_uuid IS NOT NULL;

-- ---------------------------------------------------------------
-- 7. Pertemuan K3 / Umum (peserta lintas departemen, pemateri bisa eksternal)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  client_uuid UUID,
  meeting_no TEXT NOT NULL,
  meeting_kind TEXT NOT NULL DEFAULT 'K3' CHECK (meeting_kind IN ('K3','UMUM')),
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  start_time TIME,
  location_id UUID REFERENCES hse_locations(id) ON DELETE SET NULL,
  location_name TEXT,
  leader_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  leader_name TEXT,
  leader_is_external BOOLEAN NOT NULL DEFAULT FALSE,
  participant_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  participant_names TEXT[] NOT NULL DEFAULT '{}'::text[],
  external_participants TEXT[] NOT NULL DEFAULT '{}'::text[],
  notes TEXT,
  photos TEXT[] NOT NULL DEFAULT '{}'::text[],
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_key, project_key, meeting_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_meetings_client_uuid
  ON hse_meetings (tenant_key, project_key, client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hse_meetings_scope_date ON hse_meetings (tenant_key, project_key, meeting_date DESC);

COMMIT;
