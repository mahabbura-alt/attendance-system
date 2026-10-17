BEGIN;

CREATE TABLE IF NOT EXISTS logistics_memberships (
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_key TEXT NOT NULL,
  project_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('requester','storekeeper','buyer','approver','manager','auditor')),
  PRIMARY KEY(user_id,tenant_key,project_key)
);
INSERT INTO logistics_memberships(user_id,tenant_key,project_key,role)
SELECT id,'default','default','manager' FROM users WHERE is_super_admin=TRUE AND is_active=TRUE
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS logistics_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL, project_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('item','warehouse','supplier')),
  code TEXT NOT NULL, name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_key,project_key,kind,code),
  UNIQUE(tenant_key,project_key,id)
);

CREATE TABLE IF NOT EXISTS logistics_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL, project_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('request','pr','quote','po','shipment','opening','receipt','issue','reservation','transfer','return','supplier_return','count','adjustment','loan','tool_return','component')),
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','posted','dispatched','received','closed','cancelled')),
  source_id UUID,
  warehouse_id UUID, destination_id UUID, supplier_id UUID,
  document_date DATE NOT NULL,
  due_date DATE,
  data JSONB NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_key,project_key,id), UNIQUE(tenant_key,project_key,number),
  FOREIGN KEY(tenant_key,project_key,source_id) REFERENCES logistics_documents(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,warehouse_id) REFERENCES logistics_masters(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,destination_id) REFERENCES logistics_masters(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,supplier_id) REFERENCES logistics_masters(tenant_key,project_key,id)
);
CREATE INDEX IF NOT EXISTS logistics_documents_scope ON logistics_documents(tenant_key,project_key,kind,document_date DESC);

CREATE TABLE IF NOT EXISTS logistics_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL, project_key TEXT NOT NULL,
  document_id UUID NOT NULL, item_id UUID NOT NULL,
  quantity NUMERIC(18,6) NOT NULL CHECK(quantity>=0),
  unit_cost NUMERIC(18,6) CHECK(unit_cost>=0),
  batch TEXT, serial TEXT, expiry DATE,
  condition TEXT NOT NULL DEFAULT 'good' CHECK(condition IN ('good','quarantine','damaged')),
  FOREIGN KEY(tenant_key,project_key,document_id) REFERENCES logistics_documents(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,item_id) REFERENCES logistics_masters(tenant_key,project_key,id),
  UNIQUE(tenant_key,project_key,id)
);
CREATE INDEX IF NOT EXISTS logistics_lines_document ON logistics_lines(document_id);

CREATE TABLE IF NOT EXISTS logistics_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL, project_key TEXT NOT NULL,
  item_id UUID NOT NULL, warehouse_id UUID NOT NULL, line_id UUID NOT NULL,
  original_quantity NUMERIC(18,6) NOT NULL CHECK(original_quantity>0),
  remaining NUMERIC(18,6) NOT NULL CHECK(remaining>=0 AND remaining<=original_quantity),
  unit_cost NUMERIC(18,6) NOT NULL CHECK(unit_cost>=0),
  batch TEXT, serial TEXT, expiry DATE,
  condition TEXT NOT NULL CHECK(condition IN ('good','quarantine','damaged')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_key,project_key,item_id) REFERENCES logistics_masters(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,warehouse_id) REFERENCES logistics_masters(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,line_id) REFERENCES logistics_lines(tenant_key,project_key,id),
  UNIQUE(tenant_key,project_key,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_serial_at_one_location ON logistics_layers(tenant_key,project_key,item_id,serial) WHERE serial IS NOT NULL AND remaining>0;
CREATE INDEX IF NOT EXISTS logistics_layers_available ON logistics_layers(tenant_key,project_key,warehouse_id,item_id,received_at) WHERE remaining>0;

CREATE TABLE IF NOT EXISTS logistics_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL, project_key TEXT NOT NULL,
  document_id UUID NOT NULL, line_id UUID NOT NULL, layer_id UUID NOT NULL,
  quantity NUMERIC(18,6) NOT NULL CHECK(quantity<>0),
  unit_cost NUMERIC(18,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_key,project_key,document_id) REFERENCES logistics_documents(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,line_id) REFERENCES logistics_lines(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,layer_id) REFERENCES logistics_layers(tenant_key,project_key,id)
);
CREATE INDEX IF NOT EXISTS logistics_movements_scope ON logistics_movements(tenant_key,project_key,created_at);

CREATE TABLE IF NOT EXISTS logistics_reservations (
  tenant_key TEXT NOT NULL, project_key TEXT NOT NULL,
  document_id UUID NOT NULL, item_id UUID NOT NULL, warehouse_id UUID NOT NULL,
  layer_id UUID NOT NULL,
  remaining NUMERIC(18,6) NOT NULL CHECK(remaining>=0),
  PRIMARY KEY(document_id,item_id,layer_id),
  FOREIGN KEY(tenant_key,project_key,document_id) REFERENCES logistics_documents(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,item_id) REFERENCES logistics_masters(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,warehouse_id) REFERENCES logistics_masters(tenant_key,project_key,id),
  FOREIGN KEY(tenant_key,project_key,layer_id) REFERENCES logistics_layers(tenant_key,project_key,id)
);

CREATE TABLE IF NOT EXISTS logistics_audit (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL, project_key TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  entity_id UUID, action TEXT NOT NULL,
  before_data JSONB, after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS logistics_audit_scope ON logistics_audit(tenant_key,project_key,entity_id,created_at);
CREATE TABLE IF NOT EXISTS logistics_idempotency (
  tenant_key TEXT NOT NULL, project_key TEXT NOT NULL, actor_id UUID NOT NULL REFERENCES users(id),
  request_key UUID NOT NULL, request_hash TEXT NOT NULL, response JSONB NOT NULL,
  PRIMARY KEY(tenant_key,project_key,actor_id,request_key)
);

-- Operational access is through authenticated application routes. Prevent direct
-- PostgREST/anonymous access when deployed on Supabase; backend owner retains access.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['logistics_memberships','logistics_masters','logistics_documents','logistics_lines','logistics_layers','logistics_movements','logistics_reservations','logistics_audit','logistics_idempotency'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',table_name);
  END LOOP;
END $$;

COMMIT;
