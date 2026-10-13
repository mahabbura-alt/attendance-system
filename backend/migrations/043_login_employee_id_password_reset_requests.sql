-- 043_login_employee_id_password_reset_requests.sql
-- OMOS Safety: login memakai Employee ID dan reset sandi lewat admin.
-- Karyawan lapangan banyak yang tidak aktif memakai email, sehingga OTP email
-- diganti permintaan reset yang ditangani admin. Admin membuat sandi sementara
-- dan karyawan wajib menggantinya setelah login (must_change_password).
-- Idempoten: aman dijalankan ulang; backend juga memastikan skema ini saat runtime.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'rejected')),
  source VARCHAR(32) NOT NULL DEFAULT 'mobile',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ
);

-- Satu permintaan pending per karyawan; permintaan berulang tidak menumpuk.
CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_requests_pending
  ON password_reset_requests (user_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status
  ON password_reset_requests (status, requested_at DESC);

COMMIT;
