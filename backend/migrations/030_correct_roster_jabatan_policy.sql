BEGIN;

-- Migration 029 initially ranked historical assignments by population only.
-- Correct an active policy that accidentally points to an ended period by using
-- the dominant open-ended assignment for the same jabatan.
WITH assignment_candidates AS (
  SELECT
    MIN(TRIM(u.jabatan)) AS jabatan,
    LOWER(REGEXP_REPLACE(TRIM(u.jabatan), '\s+', ' ', 'g')) AS jabatan_key,
    a.template_id,
    a.effective_from,
    a.effective_to,
    a.anchor_day_index,
    COUNT(*) AS employee_count,
    MAX(a.updated_at) AS last_updated
  FROM employee_roster_assignments a
  JOIN users u ON u.id = a.user_id
  JOIN roster_templates rt ON rt.id = a.template_id AND rt.is_active = TRUE
  WHERE a.is_active = TRUE
    AND a.effective_to IS NULL
    AND u.role = 'karyawan'
    AND u.is_active = TRUE
    AND NULLIF(TRIM(u.jabatan), '') IS NOT NULL
  GROUP BY
    LOWER(REGEXP_REPLACE(TRIM(u.jabatan), '\s+', ' ', 'g')),
    a.template_id, a.effective_from, a.effective_to, a.anchor_day_index
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY jabatan_key
    ORDER BY employee_count DESC, last_updated DESC, effective_from DESC
  ) AS priority
  FROM assignment_candidates
)
UPDATE roster_jabatan_policies policy
SET jabatan = ranked.jabatan,
    template_id = ranked.template_id,
    effective_from = ranked.effective_from,
    effective_to = ranked.effective_to,
    anchor_day_index = ranked.anchor_day_index,
    updated_at = now()
FROM ranked
WHERE ranked.priority = 1
  AND policy.jabatan_key = ranked.jabatan_key
  AND policy.is_active = TRUE
  AND policy.effective_to IS NOT NULL;

COMMIT;
