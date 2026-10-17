BEGIN;

ALTER TABLE periodic_service_orders
  ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_periodic_service_orders_scope_schedule
  ON periodic_service_orders (tenant_key, project_key, scheduled_start DESC)
  WHERE status IN ('scheduled','in_progress','awaiting_verification');

CREATE TABLE IF NOT EXISTS periodic_service_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES periodic_service_orders(id) ON DELETE CASCADE,
  package_item_id UUID REFERENCES periodic_service_package_items(id) ON DELETE SET NULL,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('setup','additional')),
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('task','part','lubricant','consumable','other')),
  item_code VARCHAR(100),
  item_name VARCHAR(200) NOT NULL,
  specification TEXT,
  planned_qty NUMERIC(14,3) CHECK (planned_qty IS NULL OR planned_qty > 0),
  uom VARCHAR(30),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id, sort_order)
);

INSERT INTO periodic_service_order_items
  (order_id,package_item_id,source_type,item_type,item_code,item_name,specification,planned_qty,uom,is_required,sort_order,created_by)
SELECT o.id,i.id,'setup',i.item_type,i.item_code,i.item_name,i.specification,i.planned_qty,i.uom,i.is_required,
       ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY i.sort_order,i.created_at,i.id)-1,
       o.created_by
FROM periodic_service_orders o
JOIN periodic_service_package_items i ON i.package_id=o.package_id
WHERE NOT EXISTS (SELECT 1 FROM periodic_service_order_items oi WHERE oi.order_id=o.id)
ON CONFLICT (order_id,sort_order) DO NOTHING;

COMMENT ON TABLE periodic_service_order_items IS
  'Snapshot kebutuhan Work Order PS saat dijadwalkan. source_type setup berasal dari Area Setup; additional ditambahkan khusus untuk WO tersebut.';
COMMENT ON COLUMN periodic_service_orders.scheduled_start IS
  'Waktu rencana service lengkap dengan zona waktu. scheduled_date dipertahankan untuk kompatibilitas histori.';

COMMIT;
