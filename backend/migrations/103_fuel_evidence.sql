-- 103_fuel_evidence.sql
-- Kerangka bukti foto/dokumen Fuel untuk APK OMOS Fuel dan unggah manual dashboard.
-- Keputusan owner (grilling 2026-10-17): file di storage lokal (bucket privat fuel-bukti),
-- metadata di tabel umum fuel_attachments, slot wajib dikonfigurasi & berversi,
-- tidak ada hapus permanen (replaced/tombstoned/orphan), dua hash (HP vs tersimpan).
-- Idempoten: aman dijalankan ulang. Rollback: 103_fuel_evidence_down.sql

BEGIN;

-- ---------------------------------------------------------------
-- 1. Konfigurasi slot bukti berversi
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_evidence_config_state (
  id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_version  INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO fuel_evidence_config_state (id, current_version) VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

-- Satu baris = satu slot pada rentang versi [valid_from_version, valid_to_version).
-- Transaksi offline divalidasi dengan versi yang berlaku saat dibuat di HP.
CREATE TABLE IF NOT EXISTS fuel_evidence_slots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_kind    VARCHAR(30) NOT NULL CHECK (transaction_kind IN ('issue_equipment', 'transfer', 'receipt', 'opname')),
  slot_code           VARCHAR(40) NOT NULL CHECK (slot_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label               VARCHAR(120) NOT NULL,
  is_required         BOOLEAN NOT NULL DEFAULT TRUE,
  capture_source      VARCHAR(20) NOT NULL DEFAULT 'camera' CHECK (capture_source IN ('camera', 'camera_or_scan')),
  sort_order          INTEGER NOT NULL DEFAULT 100,
  valid_from_version  INTEGER NOT NULL CHECK (valid_from_version >= 1),
  valid_to_version    INTEGER CHECK (valid_to_version IS NULL OR valid_to_version > valid_from_version),
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_evidence_slots_current
  ON fuel_evidence_slots (transaction_kind, slot_code) WHERE valid_to_version IS NULL;
CREATE INDEX IF NOT EXISTS idx_fuel_evidence_slots_kind_version
  ON fuel_evidence_slots (transaction_kind, valid_from_version, valid_to_version);

-- Seed versi 1 sesuai keputusan Q2 (hanya bila belum ada slot sama sekali).
INSERT INTO fuel_evidence_slots (transaction_kind, slot_code, label, is_required, capture_source, sort_order, valid_from_version)
SELECT v.kind, v.code, v.label, v.req, v.src, v.ord, 1
FROM (VALUES
  ('issue_equipment', 'flow_meter',     'Flow meter / totalizer',           TRUE,  'camera',         10),
  ('issue_equipment', 'hm_km',          'HM / KM unit',                     TRUE,  'camera',         20),
  ('transfer',        'flow_meter',     'Flow meter',                       TRUE,  'camera',         10),
  ('transfer',        'surat_jalan',    'Surat jalan',                      TRUE,  'camera_or_scan', 20),
  ('receipt',         'delivery_order', 'DO / surat jalan transportir',     TRUE,  'camera_or_scan', 10),
  ('receipt',         'segel',          'Segel tangki transportir',         TRUE,  'camera',         20),
  ('receipt',         'flow_meter',     'Flow meter / sounding',            FALSE, 'camera',         30),
  ('opname',          'alat_ukur',      'Alat ukur (dipstick / sounding)',  TRUE,  'camera',         10)
) AS v(kind, code, label, req, src, ord)
WHERE NOT EXISTS (SELECT 1 FROM fuel_evidence_slots);

-- ---------------------------------------------------------------
-- 2. Lampiran (metadata; isi file di storage bucket fuel-bukti)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_attachments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid              UUID,
  entity_type              VARCHAR(20) CHECK (entity_type IN ('fuel_log', 'transaction', 'opname')),
  entity_id                UUID,
  slot_code                VARCHAR(40) NOT NULL,
  storage_key              TEXT NOT NULL,
  thumbnail_key            TEXT,
  mime_type                VARCHAR(40) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size                INTEGER NOT NULL CHECK (byte_size > 0),
  width                    INTEGER,
  height                   INTEGER,
  original_byte_size       INTEGER,
  client_sha256            CHAR(64) CHECK (client_sha256 IS NULL OR client_sha256 ~ '^[0-9a-f]{64}$'),
  received_sha256          CHAR(64) NOT NULL CHECK (received_sha256 ~ '^[0-9a-f]{64}$'),
  stored_sha256            CHAR(64) NOT NULL CHECK (stored_sha256 ~ '^[0-9a-f]{64}$'),
  server_recompressed      BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_id          UUID REFERENCES fuel_attachments(id) ON DELETE SET NULL,
  captured_at              TIMESTAMPTZ,
  gps_lat                  NUMERIC(9,6) CHECK (gps_lat IS NULL OR gps_lat BETWEEN -90 AND 90),
  gps_lng                  NUMERIC(9,6) CHECK (gps_lng IS NULL OR gps_lng BETWEEN -180 AND 180),
  device_id                VARCHAR(100),
  app_version              VARCHAR(40),
  upload_source            VARCHAR(20) NOT NULL DEFAULT 'dashboard' CHECK (upload_source IN ('mobile', 'dashboard')),
  status                   VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'tombstoned', 'orphan')),
  replaced_by_id           UUID REFERENCES fuel_attachments(id) ON DELETE SET NULL,
  status_reason            TEXT,
  status_changed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  status_changed_at        TIMESTAMPTZ,
  uploaded_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_at                TIMESTAMPTZ,
  CHECK ((entity_type IS NULL) = (entity_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_attachments_client_uuid
  ON fuel_attachments (client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fuel_attachments_entity
  ON fuel_attachments (entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fuel_attachments_stored_hash ON fuel_attachments (stored_sha256);
CREATE INDEX IF NOT EXISTS idx_fuel_attachments_client_hash
  ON fuel_attachments (client_sha256) WHERE client_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fuel_attachments_unlinked
  ON fuel_attachments (uploaded_at) WHERE entity_id IS NULL;

COMMENT ON TABLE fuel_attachments IS 'Bukti foto/dokumen Fuel. File di storage bucket fuel-bukti; tidak pernah dihapus permanen oleh aplikasi.';

-- ---------------------------------------------------------------
-- 3. Idempotensi APK + versi konfigurasi bukti pada entitas
-- ---------------------------------------------------------------
ALTER TABLE fuel_logs
  ADD COLUMN IF NOT EXISTS client_uuid UUID,
  ADD COLUMN IF NOT EXISTS evidence_config_version INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_logs_client_uuid
  ON fuel_logs (client_uuid) WHERE client_uuid IS NOT NULL;

ALTER TABLE fuel_inventory_transactions
  ADD COLUMN IF NOT EXISTS evidence_config_version INTEGER;
ALTER TABLE fuel_stock_opnames
  ADD COLUMN IF NOT EXISTS evidence_config_version INTEGER;

COMMIT;
