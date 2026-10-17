-- 100_ai_ask_hse.sql
-- Tanya OMOS (tanya-jawab data HSE): umpan balik pengguna atas jawaban AI.
-- Aditif & idempoten. Pasangan rollback: 100_ai_ask_hse_down.sql. Butuh migrasi 099.
-- Rencana: docs/RENCANA_TANYA_OMOS_HSE.md §7.
-- Catatan: isi pertanyaan/jawaban TIDAK disimpan (audit hanya hash di ai_requests).
-- Mode fitur "hse_ask" disimpan di ai_settings.features (JSONB) — default OFF, tanpa perubahan skema.

BEGIN;

ALTER TABLE ai_settings
  ALTER COLUMN features SET DEFAULT '{"hse_duplicate":"OFF","hse_triage":"OFF","hse_ask":"OFF"}'::jsonb;

CREATE TABLE IF NOT EXISTS ai_ask_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  request_id UUID NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating IN (1, -1)),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_ai_ask_feedback UNIQUE (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_ask_feedback_scope_time ON ai_ask_feedback(tenant_key, project_key, created_at DESC);

COMMIT;
