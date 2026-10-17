BEGIN;

-- Standby Codes tetap menjadi source of truth. Untuk kode yang sudah ada,
-- hanya keterangannya yang diselaraskan; kategori dan metadata operasional
-- existing tidak diubah agar histori Standby tetap konsisten.
UPDATE master_standby_codes AS target
SET deskripsi = source.deskripsi,
    deleted_at = NULL,
    updated_at = CURRENT_TIMESTAMP
FROM (VALUES
  ('S01', 'Hujan'),
  ('S02', 'Slippery'),
  ('S03', 'Libur'),
  ('S10', 'Istirahat'),
  ('S13', 'Change Shift'),
  ('S06', 'Refueling'),
  ('S14', 'Sholat Jum''at'),
  ('S05', 'P2H')
) AS source(kode, deskripsi)
WHERE target.kode = source.kode
  AND COALESCE(target.is_locked, FALSE) = FALSE;

-- Kode baru untuk parameter SPO yang belum memiliki benchmark master.
INSERT INTO master_standby_codes (
  kode, kategori, deskripsi, planning_type, control_class,
  owner_department, requires_description, requires_evidence,
  is_system, is_locked, deleted_at, updated_at
)
VALUES
  ('S48', 'Jeda sahur/buka puasa', 'Jeda sahur/buka puasa', 'unplanned', 'controllable', 'Production', FALSE, FALSE, FALSE, FALSE, NULL, CURRENT_TIMESTAMP),
  ('S49', 'Survey Pick Up', 'Survey Pick Up', 'unplanned', 'controllable', 'Production', FALSE, FALSE, FALSE, FALSE, NULL, CURRENT_TIMESTAMP),
  ('S60', 'Truck Scale Delay', 'Truck Scale Delay', 'unplanned', 'controllable', 'Production', FALSE, FALSE, FALSE, FALSE, NULL, CURRENT_TIMESTAMP),
  ('S61', 'General Safety Talk', 'General Safety Talk', 'unplanned', 'controllable', 'Production', FALSE, FALSE, FALSE, FALSE, NULL, CURRENT_TIMESTAMP)
ON CONFLICT (kode) DO UPDATE SET
  deskripsi = EXCLUDED.deskripsi,
  deleted_at = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(master_standby_codes.is_locked, FALSE) = FALSE;

-- Enrich current deployed SPO snapshot with stable master IDs. Row identity and
-- daily values are preserved; only the parameter reference/snapshot is added.
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
), enriched AS (
  SELECT p.planning_type,
         jsonb_object_agg(entry.key,
           CASE WHEN COALESCE((entry.value->>'deployed')::boolean,FALSE)
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
                  jsonb_set(COALESCE(p.data_json,'{}'::jsonb), '{tables}', enriched.tables, TRUE),
                  '{version}', '7'::jsonb, TRUE),
    updated_at = CURRENT_TIMESTAMP
FROM enriched
WHERE p.planning_type=enriched.planning_type;

COMMIT;
