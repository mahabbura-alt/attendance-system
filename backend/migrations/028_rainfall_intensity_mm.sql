BEGIN;

-- Keep the original free-text intensity field for audit/backward compatibility.
-- All new operational entries use the explicitly measured millimetre value.
ALTER TABLE rainfall_logs
  ADD COLUMN IF NOT EXISTS intensity_mm NUMERIC(10,1);

-- Preserve any historical numeric records without attempting to coerce descriptive
-- legacy values such as "Lebat" into a measurement.
UPDATE rainfall_logs
SET intensity_mm = ROUND(TRIM(intensity)::NUMERIC, 1)
WHERE intensity_mm IS NULL
  AND NULLIF(TRIM(intensity), '') ~ '^[0-9]+(\.[0-9]+)?$';

ALTER TABLE rainfall_logs
  DROP CONSTRAINT IF EXISTS rainfall_intensity_required;

ALTER TABLE rainfall_logs
  DROP CONSTRAINT IF EXISTS rainfall_intensity_mm_non_negative;

ALTER TABLE rainfall_logs
  DROP CONSTRAINT IF EXISTS rainfall_intensity_mm_required;

ALTER TABLE rainfall_logs
  ADD CONSTRAINT rainfall_intensity_mm_non_negative
    CHECK (intensity_mm IS NULL OR intensity_mm >= 0),
  ADD CONSTRAINT rainfall_intensity_mm_required
    CHECK (rain_start IS NULL OR intensity_mm IS NOT NULL);

COMMENT ON COLUMN rainfall_logs.intensity IS
  'Legacy descriptive rainfall intensity retained for audit only.';
COMMENT ON COLUMN rainfall_logs.intensity_mm IS
  'Measured rainfall intensity in millimetres, captured to one decimal place.';

COMMIT;
