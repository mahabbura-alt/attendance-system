BEGIN;

-- Repair only the current SPO snapshot. Effective history stays immutable.
-- Daily delay values and row IDs are not changed; this adds the stable master
-- identity needed by Review Produksi and by the deployed-parameter lock.
WITH requested(row_id, kode, ord) AS (
  VALUES
    ('1','S01',1), ('2','S02',2), ('3','S03',3), ('4','S10',4),
    ('5','S48',5), ('6','S49',6), ('7','S13',7), ('8','S60',8),
    ('9','S06',9), ('10','S14',10), ('11','S05',11), ('12','S61',12)
), catalog AS (
  SELECT jsonb_agg(jsonb_build_object(
    'rowId', requested.row_id,
    'standbyCodeId', code.id::text,
    'codeSnapshot', code.kode,
    'descriptionSnapshot', COALESCE(NULLIF(code.deskripsi,''), code.kategori),
    'planningTypeSnapshot', code.planning_type,
    'controlClassSnapshot', code.control_class,
    'ownerDepartmentSnapshot', code.owner_department
  ) ORDER BY requested.ord) AS parameters
  FROM requested
  JOIN master_standby_codes code ON code.kode = requested.kode
  WHERE code.deleted_at IS NULL AND COALESCE(code.is_system,FALSE)=FALSE
), repaired AS (
  SELECT p.planning_type,
         jsonb_object_agg(entry.key,
           CASE WHEN COALESCE((entry.value->>'deployed')::boolean,FALSE)
                  AND (jsonb_typeof(entry.value->'parameters') <> 'array'
                    OR jsonb_array_length(COALESCE(entry.value->'parameters','[]'::jsonb)) = 0)
             THEN entry.value || jsonb_build_object('parameters', catalog.parameters)
             ELSE entry.value END) AS tables
  FROM productivity_plans p
  CROSS JOIN catalog
  CROSS JOIN LATERAL jsonb_each(COALESCE(p.data_json->'tables','{}'::jsonb)) entry
  WHERE p.planning_type='spo'
    AND jsonb_array_length(COALESCE(catalog.parameters,'[]'::jsonb))=12
  GROUP BY p.planning_type
)
UPDATE productivity_plans p
SET data_json = jsonb_set(
                  jsonb_set(COALESCE(p.data_json,'{}'::jsonb), '{tables}', repaired.tables, TRUE),
                  '{version}', '7'::jsonb, TRUE),
    updated_at = CURRENT_TIMESTAMP
FROM repaired
WHERE p.planning_type=repaired.planning_type;

COMMIT;
