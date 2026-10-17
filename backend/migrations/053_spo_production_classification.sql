BEGIN;

ALTER TABLE productivity_plan_versions
  DROP CONSTRAINT IF EXISTS productivity_plan_versions_planning_type_check;

ALTER TABLE productivity_plan_versions
  ADD CONSTRAINT productivity_plan_versions_planning_type_check
  CHECK (planning_type IN ('ob', 'coal', 'spo'));

-- Preserve the current SPO configuration as the first effective baseline.
-- Legacy OB/CG/FOT classification is resolved as Prod by the application until
-- the administrator saves the v6 SPO payload explicitly.
INSERT INTO productivity_plan_versions
  (planning_type, effective_from, content_html, data_json, revision, created_at, updated_at)
SELECT planning_type, (updated_at AT TIME ZONE 'Asia/Jakarta')::date,
       content_html, data_json, 1, updated_at, updated_at
FROM productivity_plans
WHERE planning_type = 'spo'
ON CONFLICT (planning_type, effective_from) DO NOTHING;

COMMIT;
