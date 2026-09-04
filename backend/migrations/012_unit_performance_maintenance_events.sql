-- Unit Performance foundation: scheduled service, inspection, corrective
-- repair and approved calendar exclusions.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS maintenance_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal                 DATE NOT NULL,
    shift_id                UUID REFERENCES shifts(id),
    equipment_id            UUID NOT NULL REFERENCES equipment(id),
    event_type              VARCHAR(30) NOT NULL CHECK (event_type IN ('scheduled_service', 'inspection', 'corrective_repair', 'calendar_exclusion')),
    status                  VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    title                   VARCHAR(180) NOT NULL,
    component               VARCHAR(150),
    description             TEXT,
    failure_mode            VARCHAR(180),
    failure_cause           TEXT,
    corrective_action       TEXT,
    scheduled_start         TIMESTAMPTZ NOT NULL,
    scheduled_finish        TIMESTAMPTZ NOT NULL,
    actual_start            TIMESTAMPTZ,
    actual_finish           TIMESTAMPTZ,
    downtime_hours          NUMERIC(14,6) NOT NULL DEFAULT 0,
    affects_availability    BOOLEAN NOT NULL DEFAULT TRUE,
    functional_failure      BOOLEAN NOT NULL DEFAULT FALSE,
    service_interval_hm     NUMERIC(12,2),
    meter_hm                NUMERIC(12,2),
    reported_by             UUID REFERENCES users(id),
    pic_id                  UUID REFERENCES users(id),
    remark                  TEXT,
    created_by              UUID REFERENCES users(id),
    updated_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    CHECK (scheduled_finish >= scheduled_start),
    CHECK (actual_finish IS NULL OR (actual_start IS NOT NULL AND actual_finish >= actual_start)),
    CHECK (downtime_hours >= 0),
    CHECK (service_interval_hm IS NULL OR service_interval_hm > 0),
    CHECK (meter_hm IS NULL OR meter_hm >= 0)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_events_period ON maintenance_events (tanggal, event_type, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_events_equipment ON maintenance_events (equipment_id, scheduled_start) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_events_pic ON maintenance_events (pic_id, scheduled_start) WHERE deleted_at IS NULL;
