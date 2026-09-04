BEGIN;

ALTER TABLE breakdown_logs
  ADD COLUMN IF NOT EXISTS current_status VARCHAR(30) NOT NULL DEFAULT 'mechanic_progress',
  ADD COLUMN IF NOT EXISTS reported_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS pic_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE breakdown_logs
SET current_status = CASE WHEN status = 'resolved' THEN 'resolved' ELSE 'mechanic_progress' END,
    reported_by = COALESCE(reported_by, created_by),
    updated_at = COALESCE(updated_at, created_at, now())
WHERE current_status IS DISTINCT FROM CASE WHEN status = 'resolved' THEN 'resolved' ELSE 'mechanic_progress' END
   OR reported_by IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'breakdown_logs_current_status_check'
  ) THEN
    ALTER TABLE breakdown_logs
      ADD CONSTRAINT breakdown_logs_current_status_check
      CHECK (current_status IN (
        'mechanic_progress', 'waiting_part', 'waiting_tool',
        'waiting_manpower', 'waiting_vendor', 'resolved'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS breakdown_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  breakdown_id UUID NOT NULL REFERENCES breakdown_logs(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL CHECK (status IN (
    'mechanic_progress', 'waiting_part', 'waiting_tool',
    'waiting_manpower', 'waiting_vendor'
  )),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  note TEXT,
  changed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_breakdown_status_open_segment
  ON breakdown_status_history (breakdown_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_breakdown_status_history_incident
  ON breakdown_status_history (breakdown_id, started_at);

CREATE TABLE IF NOT EXISTS breakdown_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  breakdown_id UUID NOT NULL REFERENCES breakdown_logs(id) ON DELETE CASCADE,
  part_detail TEXT NOT NULL,
  po_number VARCHAR(100),
  quantity NUMERIC(12,2),
  po_status VARCHAR(30) NOT NULL DEFAULT 'requested',
  eta_date DATE,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (quantity IS NULL OR quantity > 0),
  CHECK (po_status IN ('requested', 'po_process', 'ordered', 'arrived', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_breakdown_parts_incident
  ON breakdown_parts (breakdown_id)
  WHERE deleted_at IS NULL;

INSERT INTO breakdown_status_history (
  breakdown_id, status, started_at, ended_at, note, changed_by, created_at
)
SELECT
  bl.id,
  'mechanic_progress',
  bl.start_time,
  CASE WHEN bl.status = 'resolved' THEN COALESCE(bl.finish_time, bl.start_time) ELSE NULL END,
  'Migrasi otomatis dari log breakdown lama',
  bl.created_by,
  COALESCE(bl.created_at, now())
FROM breakdown_logs bl
WHERE NOT EXISTS (
  SELECT 1 FROM breakdown_status_history bsh WHERE bsh.breakdown_id = bl.id
);

CREATE INDEX IF NOT EXISTS idx_breakdown_logs_period_unit
  ON breakdown_logs (tanggal, equipment_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_breakdown_logs_current_status
  ON breakdown_logs (current_status)
  WHERE deleted_at IS NULL;

COMMIT;
