BEGIN;

-- P2 MPP Enterprise: scenario planning terpisah dari approved MPP.
-- Scenario tidak pernah menimpa workforce_mpp_plans/lines/line_periods.
-- Idempoten; tidak mengubah data historis.

CREATE TABLE IF NOT EXISTS workforce_mpp_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  base_period DATE NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (date_trunc('month', base_period)::date = base_period)
);

CREATE TABLE IF NOT EXISTS workforce_mpp_scenario_lines (
  scenario_id UUID NOT NULL REFERENCES workforce_mpp_scenarios(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  department_id UUID REFERENCES workforce_departments(id),
  position_id UUID REFERENCES workforce_positions(id),
  department_snapshot TEXT NOT NULL,
  position_snapshot TEXT NOT NULL,
  required_qty INTEGER NOT NULL CHECK (required_qty >= 0),
  notes TEXT,
  PRIMARY KEY (scenario_id, period_month, position_id),
  CHECK (date_trunc('month', period_month)::date = period_month)
);
CREATE INDEX IF NOT EXISTS idx_mpp_scenario_lookup
  ON workforce_mpp_scenarios (tenant_key, project_key, base_period, created_at DESC);

COMMENT ON TABLE workforce_mpp_scenarios IS 'Simulasi MPP (P2 enterprise). Terpisah dari approved plan; selalu dilabeli Simulation di UI.';
COMMENT ON TABLE workforce_mpp_scenario_lines IS 'Baris kebutuhan simulasi per jabatan per bulan.';

COMMIT;
