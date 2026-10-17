BEGIN;

-- Siklus hidup hour meter. Pembacaan fisik tetap disimpan pada hm_start / hm_finish,
-- sedangkan kolom lifetime menjaga kontinuitas setelah meter diganti atau di-reset.
CREATE TABLE IF NOT EXISTS equipment_hm_meter_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name        VARCHAR(100) NOT NULL DEFAULT 'PIM Mining Project',
  equipment_id        UUID NOT NULL REFERENCES equipment(id),
  event_type          VARCHAR(24) NOT NULL DEFAULT 'replacement'
                        CHECK (event_type IN ('installation','replacement','reset')),
  effective_date      DATE NOT NULL,
  effective_shift_id  UUID NOT NULL REFERENCES shifts(id),
  old_meter_final     NUMERIC(14,2) NOT NULL CHECK (old_meter_final >= 0),
  new_meter_initial   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (new_meter_initial >= 0),
  previous_offset     NUMERIC(16,2) NOT NULL DEFAULT 0,
  lifetime_offset     NUMERIC(16,2) NOT NULL,
  old_meter_serial    VARCHAR(100),
  new_meter_serial    VARCHAR(100),
  reason              TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  evidence_url        TEXT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_name, equipment_id, effective_date, effective_shift_id)
);

CREATE INDEX IF NOT EXISTS idx_hm_meter_events_equipment_effective
  ON equipment_hm_meter_events (project_name, equipment_id, effective_date DESC, created_at DESC);

ALTER TABLE mining_production_logs
  ADD COLUMN IF NOT EXISTS hm_meter_event_id UUID REFERENCES equipment_hm_meter_events(id),
  ADD COLUMN IF NOT EXISTS hm_lifetime_start NUMERIC(16,2),
  ADD COLUMN IF NOT EXISTS hm_lifetime_finish NUMERIC(16,2);

UPDATE mining_production_logs
SET hm_lifetime_start = hm_start,
    hm_lifetime_finish = hm_finish
WHERE hm_lifetime_start IS NULL OR hm_lifetime_finish IS NULL;

CREATE INDEX IF NOT EXISTS idx_prod_logs_lifetime_hm
  ON mining_production_logs (equipment_id, tanggal, shift_id, hm_lifetime_finish)
  WHERE deleted_at IS NULL;

COMMIT;
