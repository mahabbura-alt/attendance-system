BEGIN;

-- P1 MPP Enterprise: vacancy/manpower-request pipeline.
-- Reuse workforce_manpower_requests; tidak membuat tabel request kedua.
-- Idempoten; tidak mengubah data historis selain pemetaan status legacy
-- IN_PROGRESS -> RECRUITING (satu-satunya status yang tidak ada di pipeline baru).

CREATE SEQUENCE IF NOT EXISTS workforce_manpower_request_no_seq;

-- Legacy 064 hanya mengenal IN_PROGRESS; pipeline P1 memakai RECRUITING.
UPDATE workforce_manpower_requests SET status = 'RECRUITING'
  WHERE status = 'IN_PROGRESS';

ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS period_month DATE;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES workforce_departments(id);
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES workforce_positions(id);
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS recruiting_at TIMESTAMPTZ;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS candidate_ready_at TIMESTAMPTZ;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS onboarding_at TIMESTAMPTZ;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE workforce_manpower_requests
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- mpp_line_id opsional: request P1 menaut langsung ke department/position dan
-- periode; baris MPP hanya diisi bila plan line yang cocok sudah ada (tidak
-- mengarang plan baru).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workforce_manpower_requests' AND column_name = 'mpp_line_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE workforce_manpower_requests ALTER COLUMN mpp_line_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_manpower_requests_status_check') THEN
    ALTER TABLE workforce_manpower_requests DROP CONSTRAINT workforce_manpower_requests_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manpower_request_status') THEN
    ALTER TABLE workforce_manpower_requests ADD CONSTRAINT ck_manpower_request_status
      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','RECRUITING','CANDIDATE_READY','ONBOARDING','FULFILLED','CANCELLED','REJECTED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manpower_request_priority') THEN
    ALTER TABLE workforce_manpower_requests ADD CONSTRAINT ck_manpower_request_priority
      CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manpower_request_period') THEN
    ALTER TABLE workforce_manpower_requests ADD CONSTRAINT ck_manpower_request_period
      CHECK (period_month IS NULL OR date_trunc('month', period_month)::date = period_month);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manpower_request_needed_by') THEN
    ALTER TABLE workforce_manpower_requests ADD CONSTRAINT ck_manpower_request_needed_by
      CHECK (period_month IS NULL OR needed_by >= date_trunc('month', period_month)::date);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_manpower_request_idempotency
  ON workforce_manpower_requests (tenant_key, project_key, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manpower_request_lookup
  ON workforce_manpower_requests (tenant_key, project_key, period_month, position_id, status);

-- Audit transisi pipeline (append-only).
CREATE TABLE IF NOT EXISTS workforce_manpower_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES workforce_manpower_requests(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_manpower_request_events_lookup
  ON workforce_manpower_request_events (request_id, created_at);

-- Partial fulfillment: satu baris per karyawan yang memenuhi request,
-- menaut ke movement HIRE/REHIRE bila ada.
CREATE TABLE IF NOT EXISTS workforce_manpower_request_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  request_id UUID NOT NULL REFERENCES workforce_manpower_requests(id) ON DELETE CASCADE,
  employee_profile_id UUID NOT NULL REFERENCES workforce_employee_profiles(id),
  movement_id UUID REFERENCES workforce_employee_movements(id),
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  fulfilled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, employee_profile_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_manpower_fulfillment_movement
  ON workforce_manpower_request_fulfillments (request_id, movement_id)
  WHERE movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manpower_fulfillment_request
  ON workforce_manpower_request_fulfillments (tenant_key, project_key, request_id);

COMMENT ON TABLE workforce_manpower_request_events IS 'Audit append-only transisi pipeline Manpower Request (P1 enterprise).';
COMMENT ON TABLE workforce_manpower_request_fulfillments IS 'Partial fulfillment Manpower Request tertaut HIRE/REHIRE (P1 enterprise).';

COMMIT;
