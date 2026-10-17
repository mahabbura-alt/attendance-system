-- =====================================================================
-- 088_hse_hazard_report_targets_down.sql (rollback migrasi 088)
-- =====================================================================

DROP FUNCTION IF EXISTS hse_hazard_effective_quota(UUID, TEXT, DATE);

-- Kembalikan tipe entitas audit ke 3 nilai asal
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
  ADD CONSTRAINT hse_inspection_setup_audit_entity_type_check
  CHECK (entity_type IN ('TEMPLATE', 'TARGET', 'SCHEDULE'));

DROP TABLE IF EXISTS hse_hazard_report_scopes;
DROP TABLE IF EXISTS hse_hazard_report_targets;
