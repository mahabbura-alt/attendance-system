BEGIN;

-- Satu sumber waktu operasional OMOS:
-- Shift Siang 06:00-18:00, Shift Malam 18:00-06:00 (hari berikutnya).
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS operational_start TIME,
  ADD COLUMN IF NOT EXISTS operational_end TIME;

UPDATE shifts
SET jam_masuk_maks = CASE
      WHEN LOWER(TRIM(nama_shift)) = 'shift siang' THEN TIME '06:10'
      WHEN LOWER(TRIM(nama_shift)) = 'shift malam' THEN TIME '18:10'
      ELSE jam_masuk_maks
    END,
    jam_pulang_min = CASE
      WHEN LOWER(TRIM(nama_shift)) = 'shift siang' THEN TIME '18:00'
      WHEN LOWER(TRIM(nama_shift)) = 'shift malam' THEN TIME '06:00'
      ELSE jam_pulang_min
    END,
    lintas_hari = CASE
      WHEN LOWER(TRIM(nama_shift)) = 'shift siang' THEN FALSE
      WHEN LOWER(TRIM(nama_shift)) = 'shift malam' THEN TRUE
      ELSE lintas_hari
    END,
    operational_start = CASE
      WHEN LOWER(TRIM(nama_shift)) = 'shift siang' THEN TIME '06:00'
      WHEN LOWER(TRIM(nama_shift)) = 'shift malam' THEN TIME '18:00'
      ELSE COALESCE(operational_start, CASE WHEN lintas_hari THEN TIME '18:00' ELSE TIME '06:00' END)
    END,
    operational_end = CASE
      WHEN LOWER(TRIM(nama_shift)) = 'shift siang' THEN TIME '18:00'
      WHEN LOWER(TRIM(nama_shift)) = 'shift malam' THEN TIME '06:00'
      ELSE COALESCE(operational_end, CASE WHEN lintas_hari THEN TIME '06:00' ELSE TIME '18:00' END)
    END;

INSERT INTO shifts (
  nama_shift, jam_masuk_maks, jam_pulang_min, lintas_hari,
  operational_start, operational_end
)
SELECT 'Shift Siang', TIME '06:10', TIME '18:00', FALSE, TIME '06:00', TIME '18:00'
WHERE NOT EXISTS (
  SELECT 1 FROM shifts WHERE LOWER(TRIM(nama_shift)) = 'shift siang'
);

INSERT INTO shifts (
  nama_shift, jam_masuk_maks, jam_pulang_min, lintas_hari,
  operational_start, operational_end
)
SELECT 'Shift Malam', TIME '18:10', TIME '06:00', TRUE, TIME '18:00', TIME '06:00'
WHERE NOT EXISTS (
  SELECT 1 FROM shifts WHERE LOWER(TRIM(nama_shift)) = 'shift malam'
);

-- Pertahankan semua histori: pindahkan setiap FK dari master duplikat ke
-- master paling awal sebelum baris duplikat dihapus.
DO $$
DECLARE
  canonical_siang UUID;
  canonical_malam UUID;
  ref RECORD;
BEGIN
  SELECT id INTO canonical_siang
  FROM shifts
  WHERE LOWER(TRIM(nama_shift)) = 'shift siang'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO canonical_malam
  FROM shifts
  WHERE LOWER(TRIM(nama_shift)) = 'shift malam'
  ORDER BY created_at, id
  LIMIT 1;

  FOR ref IN
    SELECT DISTINCT
      target_ns.nspname AS schema_name,
      target_table.relname AS table_name,
      target_column.attname AS column_name
    FROM pg_constraint fk
    JOIN pg_class target_table ON target_table.oid = fk.conrelid
    JOIN pg_namespace target_ns ON target_ns.oid = target_table.relnamespace
    JOIN LATERAL generate_subscripts(fk.conkey, 1) key_position ON TRUE
    JOIN pg_attribute target_column
      ON target_column.attrelid = fk.conrelid
     AND target_column.attnum = fk.conkey[key_position]
    WHERE fk.contype = 'f'
      AND fk.confrelid = 'shifts'::regclass
  LOOP
    EXECUTE format(
      'UPDATE %I.%I AS target
       SET %I = CASE
         WHEN LOWER(TRIM(source.nama_shift)) = ''shift siang'' THEN $1
         WHEN LOWER(TRIM(source.nama_shift)) = ''shift malam'' THEN $2
         ELSE target.%I
       END
       FROM shifts AS source
       WHERE target.%I = source.id
         AND LOWER(TRIM(source.nama_shift)) IN (''shift siang'', ''shift malam'')',
      ref.schema_name,
      ref.table_name,
      ref.column_name,
      ref.column_name,
      ref.column_name
    ) USING canonical_siang, canonical_malam;
  END LOOP;

  DELETE FROM shifts
  WHERE LOWER(TRIM(nama_shift)) = 'shift siang'
    AND id <> canonical_siang;

  DELETE FROM shifts
  WHERE LOWER(TRIM(nama_shift)) = 'shift malam'
    AND id <> canonical_malam;
END $$;

ALTER TABLE shifts
  ALTER COLUMN operational_start SET NOT NULL,
  ALTER COLUMN operational_end SET NOT NULL;

ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_operational_range_check;
ALTER TABLE shifts ADD CONSTRAINT shifts_operational_range_check
  CHECK (operational_start <> operational_end);

ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_standard_hours_check;
ALTER TABLE shifts ADD CONSTRAINT shifts_standard_hours_check CHECK (
  LOWER(TRIM(nama_shift)) NOT IN ('shift siang', 'shift malam')
  OR (
    LOWER(TRIM(nama_shift)) = 'shift siang'
    AND operational_start = TIME '06:00'
    AND operational_end = TIME '18:00'
    AND jam_masuk_maks = TIME '06:10'
    AND jam_pulang_min = TIME '18:00'
    AND lintas_hari = FALSE
  )
  OR (
    LOWER(TRIM(nama_shift)) = 'shift malam'
    AND operational_start = TIME '18:00'
    AND operational_end = TIME '06:00'
    AND jam_masuk_maks = TIME '18:10'
    AND jam_pulang_min = TIME '06:00'
    AND lintas_hari = TRUE
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_normalized_name
  ON shifts (LOWER(TRIM(nama_shift)));

COMMENT ON COLUMN shifts.operational_start IS 'Awal shift operasional; bukan batas toleransi absensi.';
COMMENT ON COLUMN shifts.operational_end IS 'Akhir shift operasional; dapat berada pada hari berikutnya.';

-- Tabel kejadian yang memiliki timestamp menjadi sumber kebenaran. Tanggal dan
-- shift turunannya diselaraskan kembali tanpa mengubah timestamp aktual.
WITH canonical AS (
  SELECT
    (SELECT id FROM shifts WHERE LOWER(TRIM(nama_shift)) = 'shift siang' LIMIT 1) AS siang_id,
    (SELECT id FROM shifts WHERE LOWER(TRIM(nama_shift)) = 'shift malam' LIMIT 1) AS malam_id
), derived AS (
  SELECT sl.id,
    ((sl.start_time AT TIME ZONE 'Asia/Jakarta')::date
      - CASE WHEN (sl.start_time AT TIME ZONE 'Asia/Jakarta')::time < TIME '06:00' THEN 1 ELSE 0 END
    ) AS operational_date,
    CASE
      WHEN (sl.start_time AT TIME ZONE 'Asia/Jakarta')::time >= TIME '06:00'
       AND (sl.start_time AT TIME ZONE 'Asia/Jakarta')::time < TIME '18:00'
      THEN canonical.siang_id ELSE canonical.malam_id
    END AS operational_shift_id
  FROM standby_logs sl CROSS JOIN canonical
  WHERE sl.start_time IS NOT NULL
)
UPDATE standby_logs target
SET tanggal = derived.operational_date,
    shift_id = derived.operational_shift_id
FROM derived
WHERE target.id = derived.id;

WITH canonical AS (
  SELECT
    (SELECT id FROM shifts WHERE LOWER(TRIM(nama_shift)) = 'shift siang' LIMIT 1) AS siang_id,
    (SELECT id FROM shifts WHERE LOWER(TRIM(nama_shift)) = 'shift malam' LIMIT 1) AS malam_id
), derived AS (
  SELECT bl.id,
    ((bl.start_time AT TIME ZONE 'Asia/Jakarta')::date
      - CASE WHEN (bl.start_time AT TIME ZONE 'Asia/Jakarta')::time < TIME '06:00' THEN 1 ELSE 0 END
    ) AS operational_date,
    CASE
      WHEN (bl.start_time AT TIME ZONE 'Asia/Jakarta')::time >= TIME '06:00'
       AND (bl.start_time AT TIME ZONE 'Asia/Jakarta')::time < TIME '18:00'
      THEN canonical.siang_id ELSE canonical.malam_id
    END AS operational_shift_id
  FROM breakdown_logs bl CROSS JOIN canonical
  WHERE bl.start_time IS NOT NULL
)
UPDATE breakdown_logs target
SET tanggal = derived.operational_date,
    shift_id = derived.operational_shift_id
FROM derived
WHERE target.id = derived.id;

WITH canonical AS (
  SELECT
    (SELECT id FROM shifts WHERE LOWER(TRIM(nama_shift)) = 'shift siang' LIMIT 1) AS siang_id,
    (SELECT id FROM shifts WHERE LOWER(TRIM(nama_shift)) = 'shift malam' LIMIT 1) AS malam_id
), source AS (
  SELECT me.id, COALESCE(me.actual_start, me.scheduled_start) AS event_start
  FROM maintenance_events me
  WHERE COALESCE(me.actual_start, me.scheduled_start) IS NOT NULL
), derived AS (
  SELECT source.id,
    ((source.event_start AT TIME ZONE 'Asia/Jakarta')::date
      - CASE WHEN (source.event_start AT TIME ZONE 'Asia/Jakarta')::time < TIME '06:00' THEN 1 ELSE 0 END
    ) AS operational_date,
    CASE
      WHEN (source.event_start AT TIME ZONE 'Asia/Jakarta')::time >= TIME '06:00'
       AND (source.event_start AT TIME ZONE 'Asia/Jakarta')::time < TIME '18:00'
      THEN canonical.siang_id ELSE canonical.malam_id
    END AS operational_shift_id
  FROM source CROSS JOIN canonical
)
UPDATE maintenance_events target
SET tanggal = derived.operational_date,
    shift_id = derived.operational_shift_id
FROM derived
WHERE target.id = derived.id;

COMMIT;
