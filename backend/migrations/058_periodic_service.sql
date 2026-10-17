BEGIN;

ALTER TABLE master_breakdown_codes
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_planned_maintenance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS counts_as_function_failure BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS counts_as_mohh_breakdown BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO master_breakdown_codes
  (kode, kategori, deskripsi, is_system, is_planned_maintenance,
   counts_as_function_failure, counts_as_mohh_breakdown)
VALUES
  ('PS', 'Periodic Service',
   'Downtime planned maintenance yang dibuat otomatis dari modul Periodic Service.',
   TRUE, TRUE, FALSE, TRUE)
ON CONFLICT (kode) DO UPDATE SET
  kategori = EXCLUDED.kategori,
  deskripsi = EXCLUDED.deskripsi,
  is_system = TRUE,
  is_planned_maintenance = TRUE,
  counts_as_function_failure = FALSE,
  counts_as_mohh_breakdown = TRUE,
  deleted_at = NULL,
  updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS periodic_service_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(100) NOT NULL DEFAULT 'default',
  project_key VARCHAR(100) NOT NULL DEFAULT 'default',
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  interval_hm NUMERIC(14,3) NOT NULL CHECK (interval_hm > 0),
  warning_hm NUMERIC(14,3) NOT NULL DEFAULT 50 CHECK (warning_hm >= 0),
  baseline_hm NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (baseline_hm >= 0),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_periodic_service_policy_scope_unit
  ON periodic_service_policies (tenant_key, project_key, equipment_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS periodic_service_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(100) NOT NULL DEFAULT 'default',
  project_key VARCHAR(100) NOT NULL DEFAULT 'default',
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  service_code VARCHAR(50) NOT NULL,
  service_name VARCHAR(180) NOT NULL,
  cycle_hm NUMERIC(14,3) NOT NULL CHECK (cycle_hm > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_periodic_service_package_version
  ON periodic_service_packages (tenant_key, project_key, equipment_id, service_code, version)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS periodic_service_package_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES periodic_service_packages(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('task','part','lubricant','consumable','other')),
  item_code VARCHAR(100),
  item_name VARCHAR(200) NOT NULL,
  specification TEXT,
  planned_qty NUMERIC(14,3) CHECK (planned_qty IS NULL OR planned_qty > 0),
  uom VARCHAR(30),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS periodic_service_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(100) NOT NULL DEFAULT 'default',
  project_key VARCHAR(100) NOT NULL DEFAULT 'default',
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  policy_id UUID REFERENCES periodic_service_policies(id),
  package_id UUID REFERENCES periodic_service_packages(id),
  breakdown_id UUID UNIQUE REFERENCES breakdown_logs(id),
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','in_progress','awaiting_verification','completed','cancelled')),
  due_hm NUMERIC(14,3) NOT NULL CHECK (due_hm >= 0),
  warning_hm_snapshot NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (warning_hm_snapshot >= 0),
  scheduled_date DATE,
  actual_start TIMESTAMPTZ,
  actual_finish TIMESTAMPTZ,
  actual_service_hm NUMERIC(14,3) CHECK (actual_service_hm IS NULL OR actual_service_hm >= 0),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  completed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (actual_finish IS NULL OR (actual_start IS NOT NULL AND actual_finish >= actual_start))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_periodic_service_open_order_per_unit
  ON periodic_service_orders (tenant_key, project_key, equipment_id)
  WHERE status IN ('scheduled','in_progress','awaiting_verification');

CREATE INDEX IF NOT EXISTS idx_periodic_service_orders_scope_status
  ON periodic_service_orders (tenant_key, project_key, status, scheduled_date DESC);

CREATE TABLE IF NOT EXISTS periodic_service_actual_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES periodic_service_orders(id) ON DELETE CASCADE,
  package_item_id UUID REFERENCES periodic_service_package_items(id),
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('task','part','lubricant','consumable','other')),
  item_name VARCHAR(200) NOT NULL,
  planned_qty NUMERIC(14,3),
  actual_qty NUMERIC(14,3) CHECK (actual_qty IS NULL OR actual_qty >= 0),
  uom VARCHAR(30),
  completion_status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (completion_status IN ('completed','partial','not_done','not_applicable')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS periodic_service_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key VARCHAR(100) NOT NULL DEFAULT 'default',
  project_key VARCHAR(100) NOT NULL DEFAULT 'default',
  order_id UUID NOT NULL REFERENCES periodic_service_orders(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  category VARCHAR(80),
  severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  description TEXT NOT NULL,
  recommendation TEXT,
  follow_up_type VARCHAR(30) NOT NULL DEFAULT 'monitor'
    CHECK (follow_up_type IN ('monitor','planned_repair','create_breakdown','stop_unit')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','cancelled')),
  due_date DATE,
  pic_id UUID REFERENCES users(id),
  linked_breakdown_id UUID REFERENCES breakdown_logs(id),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_periodic_service_findings_scope_status
  ON periodic_service_findings (tenant_key, project_key, status, severity);

CREATE TABLE IF NOT EXISTS periodic_service_time_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES periodic_service_orders(id),
  breakdown_id UUID NOT NULL REFERENCES breakdown_logs(id),
  previous_start TIMESTAMPTZ NOT NULL,
  previous_finish TIMESTAMPTZ NOT NULL,
  corrected_start TIMESTAMPTZ NOT NULL,
  corrected_finish TIMESTAMPTZ NOT NULL,
  previous_hours NUMERIC(14,6) NOT NULL,
  corrected_hours NUMERIC(14,6) NOT NULL,
  reason TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (corrected_finish >= corrected_start)
);

CREATE INDEX IF NOT EXISTS idx_periodic_service_corrections_order
  ON periodic_service_time_corrections (order_id, changed_at DESC);

COMMENT ON TABLE periodic_service_orders IS
  'Work order Periodic Service. Saat dimulai membuat Breakdown PS; saat selesai menutup interval downtime yang sama.';
COMMENT ON COLUMN periodic_service_orders.actual_service_hm IS
  'Meter HM pada saat service selesai; bukan durasi service dan tidak boleh dihitung dari selisih waktu.';

COMMIT;
