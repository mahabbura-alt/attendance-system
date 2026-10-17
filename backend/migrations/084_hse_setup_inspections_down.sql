-- =====================================================================
-- Rollback Migration 084: Modul HSE - Setup Inspeksi
-- =====================================================================

DROP FUNCTION IF EXISTS hse_effective_quota(UUID, UUID, TEXT, DATE);
DROP TABLE IF EXISTS hse_inspection_setup_audit CASCADE;
DROP TABLE IF EXISTS hse_inspection_targets CASCADE;

DROP TRIGGER IF EXISTS trg_hse_template_items_guard ON hse_inspection_template_items;
DROP FUNCTION IF EXISTS hse_guard_locked_template_items();

DROP TRIGGER IF EXISTS trg_hse_inspection_lock_template ON hse_inspections;
DROP FUNCTION IF EXISTS hse_lock_template_on_inspection();

DROP TRIGGER IF EXISTS trg_hse_template_set_root ON hse_inspection_templates;
DROP FUNCTION IF EXISTS hse_template_set_root();

DROP INDEX IF EXISTS uq_template_current_per_root;
DROP INDEX IF EXISTS uq_template_root_version;
DROP INDEX IF EXISTS uq_template_scope_code_version;

ALTER TABLE hse_inspection_templates
  DROP CONSTRAINT IF EXISTS chk_template_setup,
  DROP COLUMN IF EXISTS locked_at,
  DROP COLUMN IF EXISTS is_current,
  DROP COLUMN IF EXISTS version_no,
  DROP COLUMN IF EXISTS root_id,
  DROP COLUMN IF EXISTS setup_reviewed,
  DROP COLUMN IF EXISTS custom_interval_days,
  DROP COLUMN IF EXISTS schedule_cycle,
  DROP COLUMN IF EXISTS inspection_type;

-- Kembalikan unique constraint lama jika diperlukan
ALTER TABLE hse_inspection_templates
  ADD CONSTRAINT hse_inspection_templates_tenant_key_project_key_code_key
  UNIQUE (tenant_key, project_key, code);
