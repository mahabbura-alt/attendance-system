-- Bring already-valid Input Data into Database HM without rewriting source HM.
-- This only moves the effective date backwards to the first eligible Work Log.
UPDATE hm_worklog_cutover
SET effective_date = LEAST(
  effective_date,
  COALESCE((
    SELECT MIN(tanggal)
    FROM mining_production_logs
    WHERE deleted_at IS NULL
      AND operator_id IS NOT NULL
      AND hm_validated_at IS NOT NULL
      AND total_hm IS NOT NULL
      AND total_hm >= 0
  ), effective_date)
)
WHERE id = TRUE;
