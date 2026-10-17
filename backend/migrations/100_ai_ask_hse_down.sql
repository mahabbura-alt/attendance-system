-- Rollback 100_ai_ask_hse.sql. Menghapus umpan balik Tanya OMOS (data audit ai_requests tidak disentuh).
BEGIN;
DROP TABLE IF EXISTS ai_ask_feedback;
ALTER TABLE IF EXISTS ai_settings
  ALTER COLUMN features SET DEFAULT '{"hse_duplicate":"OFF","hse_triage":"OFF"}'::jsonb;
COMMIT;
