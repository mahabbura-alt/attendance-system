-- =====================================================================
-- 089_hse_p5m_safetytalk_targets_down.sql (rollback migrasi 089)
-- =====================================================================

DROP FUNCTION IF EXISTS hse_safetytalk_effective_quota(UUID, TEXT, DATE);
DROP FUNCTION IF EXISTS hse_p5m_effective_quota(UUID, TEXT, DATE);

DO $$
DECLARE cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'hse_inspection_setup_audit'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%entity_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE hse_inspection_setup_audit DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE hse_inspection_setup_audit
  ADD CONSTRAINT chk_hse_setup_audit_entity
  CHECK (entity_type IN ('TEMPLATE', 'TARGET', 'SCHEDULE', 'HAZARD_TARGET'));

DROP TABLE IF EXISTS hse_safetytalk_scopes;
DROP TABLE IF EXISTS hse_safetytalk_targets;
DROP TABLE IF EXISTS hse_p5m_scopes;
DROP TABLE IF EXISTS hse_p5m_targets;
