BEGIN;

-- Preserve assignment history while deactivating only redundant active copies
-- that describe the exact same user/date range. The newest record remains the
-- authoritative assignment.
WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, effective_from, COALESCE(effective_to, 'infinity'::date)
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
  FROM employee_roster_assignments
  WHERE is_active = TRUE
)
UPDATE employee_roster_assignments assignment
SET is_active = FALSE,
    updated_at = now()
FROM ranked_duplicates duplicate
WHERE assignment.id = duplicate.id
  AND duplicate.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roster_assignment_active_exact_range
  ON employee_roster_assignments (
    user_id,
    effective_from,
    (COALESCE(effective_to, 'infinity'::date))
  )
  WHERE is_active = TRUE;

COMMIT;
