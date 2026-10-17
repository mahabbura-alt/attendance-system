BEGIN;

ALTER TABLE periodic_service_packages
  ADD COLUMN IF NOT EXISTS equipment_class VARCHAR(120),
  ADD COLUMN IF NOT EXISTS equipment_model VARCHAR(180);

UPDATE periodic_service_packages p
SET equipment_class = COALESCE(NULLIF(TRIM(p.equipment_class), ''), NULLIF(TRIM(e.kelas_alat), ''), 'Tanpa Jenis'),
    equipment_model = COALESCE(NULLIF(TRIM(p.equipment_model), ''), NULLIF(TRIM(e.tipe_alat), ''), NULLIF(TRIM(e.class_unit), ''), e.kode_alat)
FROM equipment e
WHERE p.equipment_id = e.id
  AND (p.equipment_class IS NULL OR TRIM(p.equipment_class) = ''
    OR p.equipment_model IS NULL OR TRIM(p.equipment_model) = '');

UPDATE periodic_service_packages
SET equipment_class = COALESCE(NULLIF(TRIM(equipment_class), ''), 'Tanpa Jenis'),
    equipment_model = COALESCE(NULLIF(TRIM(equipment_model), ''), 'Tanpa Model');

ALTER TABLE periodic_service_packages
  ALTER COLUMN equipment_id DROP NOT NULL,
  ALTER COLUMN equipment_class SET NOT NULL,
  ALTER COLUMN equipment_model SET NOT NULL;

DROP INDEX IF EXISTS uq_periodic_service_package_model_active;
DROP INDEX IF EXISTS uq_periodic_service_package_model_version;
DROP INDEX IF EXISTS uq_periodic_service_package_model_cycle_active;

WITH versioned AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_key, project_key, LOWER(TRIM(equipment_class)), LOWER(TRIM(equipment_model)), UPPER(TRIM(service_code))
           ORDER BY created_at ASC, updated_at ASC, id ASC
         ) AS model_version
  FROM periodic_service_packages
  WHERE deleted_at IS NULL
)
UPDATE periodic_service_packages p
SET version = v.model_version
FROM versioned v
WHERE p.id = v.id AND p.version <> v.model_version;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_key, project_key, LOWER(TRIM(equipment_class)), LOWER(TRIM(equipment_model)), UPPER(TRIM(service_code))
           ORDER BY version DESC, updated_at DESC, created_at DESC, id DESC
         ) AS position
  FROM periodic_service_packages
  WHERE deleted_at IS NULL AND is_active = TRUE
)
UPDATE periodic_service_packages p
SET is_active = FALSE,
    updated_at = CURRENT_TIMESTAMP
FROM ranked r
WHERE p.id = r.id AND r.position > 1;

WITH ranked_cycle AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_key, project_key, LOWER(TRIM(equipment_class)), LOWER(TRIM(equipment_model)), cycle_hm
           ORDER BY version DESC, updated_at DESC, created_at DESC, id DESC
         ) AS position
  FROM periodic_service_packages
  WHERE deleted_at IS NULL AND is_active = TRUE
)
UPDATE periodic_service_packages p
SET is_active = FALSE,
    updated_at = CURRENT_TIMESTAMP
FROM ranked_cycle r
WHERE p.id = r.id AND r.position > 1;

CREATE UNIQUE INDEX uq_periodic_service_package_model_active
  ON periodic_service_packages (
    tenant_key, project_key, LOWER(TRIM(equipment_class)), LOWER(TRIM(equipment_model)), UPPER(TRIM(service_code))
  )
  WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE UNIQUE INDEX uq_periodic_service_package_model_version
  ON periodic_service_packages (
    tenant_key, project_key, LOWER(TRIM(equipment_class)), LOWER(TRIM(equipment_model)), UPPER(TRIM(service_code)), version
  )
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_periodic_service_package_model_cycle_active
  ON periodic_service_packages (
    tenant_key, project_key, LOWER(TRIM(equipment_class)), LOWER(TRIM(equipment_model)), cycle_hm
  )
  WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_periodic_service_package_model_cycle
  ON periodic_service_packages (
    tenant_key, project_key, LOWER(TRIM(equipment_class)), LOWER(TRIM(equipment_model)), cycle_hm
  )
  WHERE deleted_at IS NULL AND is_active = TRUE;

COMMENT ON COLUMN periodic_service_packages.equipment_class IS
  'Snapshot jenis equipment dari List Equipment untuk scope Area Setup Periodic Service.';
COMMENT ON COLUMN periodic_service_packages.equipment_model IS
  'Tipe/model equipment dari List Equipment. Paket aktif diwariskan ke seluruh unit dengan jenis dan model yang sama.';
COMMENT ON COLUMN periodic_service_packages.equipment_id IS
  'Referensi unit legacy untuk lineage paket sebelum model-based Area Setup; paket baru menggunakan equipment_class + equipment_model.';

COMMIT;
