-- SPO v8: authoritative material type for production JOB formulas.
-- Legacy deployed JOB mapping approved by project owner: OB=ob, CG/FOT=coal.

CREATE OR REPLACE FUNCTION pg_temp.omos_spo_material_type_patch(document jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  WITH source AS (
    SELECT COALESCE(document, '{}'::jsonb) AS doc
  ), patched_tables AS (
    SELECT COALESCE(jsonb_object_agg(entry.key,
      CASE upper(COALESCE(entry.value->>'jobCode', ''))
        WHEN 'OB' THEN entry.value || '{"materialType":"ob"}'::jsonb
        WHEN 'CG' THEN entry.value || '{"materialType":"coal"}'::jsonb
        WHEN 'FOT' THEN entry.value || '{"materialType":"coal"}'::jsonb
        ELSE entry.value
      END) FILTER (WHERE entry.key IS NOT NULL), '{}'::jsonb) AS value
    FROM source
    LEFT JOIN LATERAL jsonb_each(COALESCE(source.doc->'tables', '{}'::jsonb)) entry ON true
  ), patched_jobs AS (
    SELECT COALESCE(jsonb_agg(
      CASE upper(COALESCE(entry.value->>'jobCode', ''))
        WHEN 'OB' THEN entry.value || '{"materialType":"ob"}'::jsonb
        WHEN 'CG' THEN entry.value || '{"materialType":"coal"}'::jsonb
        WHEN 'FOT' THEN entry.value || '{"materialType":"coal"}'::jsonb
        ELSE entry.value
      END), '[]'::jsonb) AS value
    FROM source
    LEFT JOIN LATERAL jsonb_array_elements(COALESCE(source.doc->'deployedJobs', '[]'::jsonb)) entry ON true
    WHERE entry.value IS NOT NULL
  )
  SELECT jsonb_set(
    jsonb_set(
      jsonb_set(source.doc, '{tables}', patched_tables.value, true),
      '{deployedJobs}', patched_jobs.value, true
    ),
    '{version}', '8'::jsonb, true
  )
  FROM source, patched_tables, patched_jobs;
$$;

UPDATE productivity_plans
SET data_json = pg_temp.omos_spo_material_type_patch(data_json),
    updated_at = CURRENT_TIMESTAMP
WHERE planning_type = 'spo';

UPDATE productivity_plan_versions
SET data_json = pg_temp.omos_spo_material_type_patch(data_json)
WHERE planning_type = 'spo';
