-- Rollback 099_ai_foundation_hse.sql. Menghapus seluruh data saran & audit AI.
BEGIN;
DROP TABLE IF EXISTS hse_hazard_merge_log;
ALTER TABLE hazard_reports DROP COLUMN IF EXISTS ai_clean_description;
DROP TABLE IF EXISTS hse_ai_suggestions;
DROP TABLE IF EXISTS ai_jobs;
DROP TABLE IF EXISTS ai_requests;
DROP TABLE IF EXISTS ai_settings;
COMMIT;
