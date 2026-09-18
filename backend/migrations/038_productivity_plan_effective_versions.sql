BEGIN;

CREATE TABLE IF NOT EXISTS productivity_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_type VARCHAR(20) NOT NULL CHECK (planning_type IN ('ob', 'coal')),
  effective_from DATE NOT NULL,
  content_html TEXT NOT NULL,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  previous_version_id UUID REFERENCES productivity_plan_versions(id),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (planning_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_productivity_plan_versions_effective
  ON productivity_plan_versions (planning_type, effective_from DESC);

CREATE TABLE IF NOT EXISTS productivity_plan_version_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES productivity_plan_versions(id),
  planning_type VARCHAR(20) NOT NULL,
  effective_from DATE NOT NULL,
  revision INTEGER NOT NULL,
  previous_data_json JSONB,
  new_data_json JSONB NOT NULL,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_productivity_plan_version_audit_version
  ON productivity_plan_version_audit (version_id, changed_at DESC);

-- Preserve the current OB/Coal configuration as the first auditable baseline.
-- Existing update timestamp supplies the baseline date in the operational WIB timezone.
-- No older historical effective date is invented.
INSERT INTO productivity_plan_versions
  (planning_type, effective_from, content_html, data_json, revision, created_at, updated_at)
SELECT planning_type, (updated_at AT TIME ZONE 'Asia/Jakarta')::date,
       content_html, data_json, 1, updated_at, updated_at
FROM productivity_plans
WHERE planning_type IN ('ob', 'coal')
ON CONFLICT (planning_type, effective_from) DO NOTHING;

COMMIT;
