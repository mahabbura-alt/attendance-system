BEGIN;

CREATE TABLE IF NOT EXISTS roster_jabatan_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jabatan VARCHAR(150) NOT NULL,
  jabatan_key VARCHAR(150) NOT NULL,
  template_id UUID NOT NULL REFERENCES roster_templates(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  anchor_day_index INTEGER NOT NULL DEFAULT 1 CHECK (anchor_day_index BETWEEN 1 AND 366),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roster_jabatan_policy_active
  ON roster_jabatan_policies (jabatan_key)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_roster_jabatan_policy_dates
  ON roster_jabatan_policies (jabatan_key, effective_from, effective_to);

-- Bootstrap the current position policy from the most common active assignment.
-- This preserves the roster configuration already applied through "Atur Roster Jabatan"
-- and makes it available to active employees added after that operation.
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
    AND u.role = 'karyawan'
    AND u.is_active = TRUE
    AND NULLIF(TRIM(u.jabatan), '') IS NOT NULL
  GROUP BY
    LOWER(REGEXP_REPLACE(TRIM(u.jabatan), '\s+', ' ', 'g')),
    a.template_id, a.effective_from, a.effective_to, a.anchor_day_index
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY jabatan_key
    ORDER BY (effective_to IS NULL) DESC, employee_count DESC, last_updated DESC, effective_from DESC
  ) AS priority
  FROM assignment_candidates
)
INSERT INTO roster_jabatan_policies
  (jabatan, jabatan_key, template_id, effective_from, effective_to, anchor_day_index)
SELECT jabatan, jabatan_key, template_id, effective_from, effective_to, anchor_day_index
FROM ranked
WHERE priority = 1
ON CONFLICT DO NOTHING;

COMMIT;
