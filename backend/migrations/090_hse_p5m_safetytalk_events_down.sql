-- =====================================================================
-- 090_hse_p5m_safetytalk_events.sql — DOWN
-- Mengembalikan tabel lama hse_safety_talks (KOSONG — data hard DELETE
-- pada migrasi 090 tidak dapat dipulihkan via down migration, sesuai
-- keputusan owner) dan menjatuhkan tabel event baru.
-- =====================================================================
DROP TABLE IF EXISTS hse_safetytalk_event_attendees;
DROP TABLE IF EXISTS hse_safetytalk_events;
DROP TABLE IF EXISTS hse_p5m_event_attendees;
DROP TABLE IF EXISTS hse_p5m_events;

CREATE TABLE IF NOT EXISTS hse_safety_talks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  talk_date DATE NOT NULL,
  department_name TEXT NOT NULL,
  topic TEXT NOT NULL,
  led_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  led_by_name TEXT NOT NULL,
  attendee_count INTEGER NOT NULL DEFAULT 1 CHECK (attendee_count >= 1),
  notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_safety_talks_scope ON hse_safety_talks(tenant_key, project_key, talk_date DESC);
