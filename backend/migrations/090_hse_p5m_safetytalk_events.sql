-- =====================================================================
-- 090_hse_p5m_safetytalk_events.sql
-- Tab operasional P5M & Safety Talk (Hazard dan Inspeksi):
-- pencatatan pelaksanaan event + peserta per-orang, dengan dukungan
-- merge manual gaya hazard (merged_into_id + status DUPLICATE).
--
-- Kunci deteksi data ganda (algoritma pintar, sisi aplikasi):
--   location_id + event_date + shift_id (exact, topik bukan kunci).
--
-- Otorisasi owner (grilling Q22/Q27): data lama hse_safety_talks
-- DI-HARD DELETE permanen tanpa backup, tab lama digantikan tab baru.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Event P5M
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_p5m_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key       TEXT NOT NULL DEFAULT 'default',
  project_key      TEXT NOT NULL DEFAULT 'default',
  event_no         TEXT NOT NULL,

  event_date       DATE NOT NULL,
  shift_id         UUID NOT NULL REFERENCES shifts(id),
  shift_name       TEXT NOT NULL,
  location_id      UUID NOT NULL REFERENCES hse_locations(id),
  location_name    TEXT NOT NULL,

  topics           TEXT[] NOT NULL DEFAULT '{}',
  led_by_ids       UUID[]  NOT NULL DEFAULT '{}',
  led_by_names     TEXT[]  NOT NULL DEFAULT '{}',
  photos           TEXT[]  NOT NULL DEFAULT '{}',

  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'DUPLICATE')),
  merged_into_id   UUID REFERENCES hse_p5m_events(id),
  merged_at        TIMESTAMPTZ,
  merged_by        UUID,

  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_hse_p5m_events_no UNIQUE (tenant_key, project_key, event_no)
);

CREATE INDEX IF NOT EXISTS idx_hse_p5m_events_scope
  ON hse_p5m_events(tenant_key, project_key, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_hse_p5m_events_dupe_key
  ON hse_p5m_events(tenant_key, project_key, location_id, event_date, shift_id)
  WHERE merged_into_id IS NULL AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_hse_p5m_events_merged
  ON hse_p5m_events(merged_into_id) WHERE merged_into_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hse_p5m_event_attendees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key    TEXT NOT NULL DEFAULT 'default',
  project_key   TEXT NOT NULL DEFAULT 'default',
  event_id      UUID NOT NULL REFERENCES hse_p5m_events(id) ON DELETE CASCADE,
  employee_id   UUID,
  employee_no   TEXT,
  nama          TEXT NOT NULL,
  jabatan       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_p5m_attendees_event
  ON hse_p5m_event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_hse_p5m_attendees_emp
  ON hse_p5m_event_attendees(tenant_key, project_key, employee_id);

-- ---------------------------------------------------------------------
-- 2. Event Safety Talk
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hse_safetytalk_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key       TEXT NOT NULL DEFAULT 'default',
  project_key      TEXT NOT NULL DEFAULT 'default',
  event_no         TEXT NOT NULL,

  event_date       DATE NOT NULL,
  shift_id         UUID NOT NULL REFERENCES shifts(id),
  shift_name       TEXT NOT NULL,
  location_id      UUID NOT NULL REFERENCES hse_locations(id),
  location_name    TEXT NOT NULL,

  topics           TEXT[] NOT NULL DEFAULT '{}',
  led_by_ids       UUID[]  NOT NULL DEFAULT '{}',
  led_by_names     TEXT[]  NOT NULL DEFAULT '{}',
  photos           TEXT[]  NOT NULL DEFAULT '{}',

  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'DUPLICATE')),
  merged_into_id   UUID REFERENCES hse_safetytalk_events(id),
  merged_at        TIMESTAMPTZ,
  merged_by        UUID,

  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_hse_safetytalk_events_no UNIQUE (tenant_key, project_key, event_no)
);

CREATE INDEX IF NOT EXISTS idx_hse_safetytalk_events_scope
  ON hse_safetytalk_events(tenant_key, project_key, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_hse_safetytalk_events_dupe_key
  ON hse_safetytalk_events(tenant_key, project_key, location_id, event_date, shift_id)
  WHERE merged_into_id IS NULL AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_hse_safetytalk_events_merged
  ON hse_safetytalk_events(merged_into_id) WHERE merged_into_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hse_safetytalk_event_attendees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key    TEXT NOT NULL DEFAULT 'default',
  project_key   TEXT NOT NULL DEFAULT 'default',
  event_id      UUID NOT NULL REFERENCES hse_safetytalk_events(id) ON DELETE CASCADE,
  employee_id   UUID,
  employee_no   TEXT,
  nama          TEXT NOT NULL,
  jabatan       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hse_safetytalk_attendees_event
  ON hse_safetytalk_event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_hse_safetytalk_attendees_emp
  ON hse_safetytalk_event_attendees(tenant_key, project_key, employee_id);

-- ---------------------------------------------------------------------
-- 3. Hard DELETE data lama (otorisasi eksplisit owner, tanpa backup)
--    Tab Safety Talk lama di view Kompetensi digantikan tab baru.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS hse_safety_talks;
