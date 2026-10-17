-- 104_fuel_mobile.sql
-- Backend APK OMOS Fuel v1 (keputusan grilling + validasi formula 2026-10-17):
--   ID scan (QR OMOS:EQ:<ID>) di equipment & lokasi fuel, kapasitas tangki BBM unit,
--   akun Fuel per karyawan (PIN), perangkat yang disetujui admin, sesi buka/tutup shift
--   (totalizer), pengaturan ambang, kolom jejak mobile pada log/transaksi/opname.
-- Idempoten: aman dijalankan ulang. Rollback: 104_fuel_mobile_down.sql

BEGIN;

-- ---------------------------------------------------------------
-- 1. Generator ID scan: <PREFIX>-XXXXXX, alfabet tanpa 0/1/I/L/O/U (30^6 kombinasi)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION omos_gen_scan_id(prefix TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alfabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  hasil TEXT := '';
BEGIN
  FOR i IN 1..6 LOOP
    hasil := hasil || substr(alfabet, 1 + floor(random() * length(alfabet))::int, 1);
  END LOOP;
  RETURN prefix || '-' || hasil;
END $$;

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS scan_id VARCHAR(12),
  ADD COLUMN IF NOT EXISTS fuel_tank_capacity_liter NUMERIC(12,2)
    CHECK (fuel_tank_capacity_liter IS NULL OR fuel_tank_capacity_liter > 0);
ALTER TABLE fuel_storage_locations ADD COLUMN IF NOT EXISTS scan_id VARCHAR(12);

-- Isi ID untuk baris lama; ulangi bila bentrok (peluang sangat kecil).
DO $$
DECLARE r RECORD; calon TEXT;
BEGIN
  FOR r IN SELECT id FROM equipment WHERE scan_id IS NULL LOOP
    LOOP
      calon := omos_gen_scan_id('EQ');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM equipment WHERE scan_id = calon);
    END LOOP;
    UPDATE equipment SET scan_id = calon WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM fuel_storage_locations WHERE scan_id IS NULL LOOP
    LOOP
      calon := omos_gen_scan_id('LOC');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM fuel_storage_locations WHERE scan_id = calon);
    END LOOP;
    UPDATE fuel_storage_locations SET scan_id = calon WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE equipment ALTER COLUMN scan_id SET DEFAULT omos_gen_scan_id('EQ');
ALTER TABLE fuel_storage_locations ALTER COLUMN scan_id SET DEFAULT omos_gen_scan_id('LOC');
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_scan_id ON equipment (scan_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_locations_scan_id ON fuel_storage_locations (scan_id);

-- ID yang dicabut (stiker hilang/dicuri) — scan ID lama → pesan "ID sudah dicabut".
CREATE TABLE IF NOT EXISTS fuel_scan_id_revocations (
  scan_id         VARCHAR(12) PRIMARY KEY,
  target_type     VARCHAR(20) NOT NULL CHECK (target_type IN ('equipment', 'location')),
  target_id       UUID NOT NULL,
  replaced_by     VARCHAR(12),
  reason          TEXT NOT NULL,
  revoked_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- 2. Pengaturan ambang (dapat diatur admin; nilai awal keputusan owner)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_mobile_settings (
  id                         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hm_gap_tolerance_hours     NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (hm_gap_tolerance_hours >= 0),
  totalizer_tolerance_pct    NUMERIC(6,3) NOT NULL DEFAULT 0.5 CHECK (totalizer_tolerance_pct >= 0),
  totalizer_tolerance_liter  NUMERIC(10,2) NOT NULL DEFAULT 20 CHECK (totalizer_tolerance_liter >= 0),
  offline_pin_days           INTEGER NOT NULL DEFAULT 7 CHECK (offline_pin_days BETWEEN 1 AND 30),
  pin_max_attempts           INTEGER NOT NULL DEFAULT 5 CHECK (pin_max_attempts BETWEEN 3 AND 10),
  late_entry_grace_hours     NUMERIC(6,2) NOT NULL DEFAULT 2 CHECK (late_entry_grace_hours >= 0),
  updated_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO fuel_mobile_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- 3. Akun Fuel (PIN terpisah dari password utama) & perangkat
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_operator_accounts (
  user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash              TEXT NOT NULL,
  must_change_pin       BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_functions     TEXT[] NOT NULL DEFAULT ARRAY['fill','transfer','shift']::text[]
    CHECK (allowed_functions <@ ARRAY['fill','transfer','receipt','opname','shift']::text[]),
  allowed_location_ids  UUID[] NOT NULL DEFAULT '{}'::uuid[],
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts       INTEGER NOT NULL DEFAULT 0,
  locked_at             TIMESTAMPTZ,
  pin_changed_at        TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuel_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_uid      VARCHAR(100) NOT NULL UNIQUE,
  device_code     VARCHAR(12) NOT NULL UNIQUE DEFAULT omos_gen_scan_id('DV'),
  device_name     VARCHAR(100),
  model           VARCHAR(100),
  app_version     VARCHAR(40),
  status          VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
  registered_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  revoked_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at      TIMESTAMPTZ,
  revoke_reason   TEXT,
  last_seen_at    TIMESTAMPTZ,
  last_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- 4. Sesi shift fuel truck/tangki: totalizer awal & akhir
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_shift_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid            UUID UNIQUE,
  location_id            UUID NOT NULL REFERENCES fuel_storage_locations(id),
  shift_id               UUID REFERENCES shifts(id),
  operational_date       DATE NOT NULL,
  device_id              UUID REFERENCES fuel_devices(id) ON DELETE SET NULL,
  opened_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_at              TIMESTAMPTZ NOT NULL,
  totalizer_open         NUMERIC(16,2) NOT NULL CHECK (totalizer_open >= 0),
  close_client_uuid      UUID UNIQUE,
  closed_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at              TIMESTAMPTZ,
  totalizer_close        NUMERIC(16,2) CHECK (totalizer_close IS NULL OR totalizer_close >= 0),
  meter_delta_liter      NUMERIC(16,3),
  recorded_out_liter     NUMERIC(16,3),
  variance_liter         NUMERIC(16,3),
  variance_pct           NUMERIC(9,4),
  threshold_liter        NUMERIC(16,3),
  status                 VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'investigation', 'reviewed')),
  close_reason           TEXT,
  review_note            TEXT,
  reviewed_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at            TIMESTAMPTZ,
  formula_version        VARCHAR(40) NOT NULL DEFAULT 'fuel-totalizer v1',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Satu sesi terbuka per lokasi.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_shift_sessions_open
  ON fuel_shift_sessions (location_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_fuel_shift_sessions_status
  ON fuel_shift_sessions (status, operational_date DESC);

-- ---------------------------------------------------------------
-- 5. Jejak mobile pada log/transaksi/opname
-- ---------------------------------------------------------------
ALTER TABLE fuel_logs
  ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_location_id UUID REFERENCES fuel_storage_locations(id),
  ADD COLUMN IF NOT EXISTS unit_input VARCHAR(10) CHECK (unit_input IS NULL OR unit_input IN ('scan', 'manual')),
  ADD COLUMN IF NOT EXISTS unit_input_reason VARCHAR(40),
  ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES fuel_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift_session_id UUID REFERENCES fuel_shift_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mobile_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mobile_reason TEXT,
  ADD COLUMN IF NOT EXISTS reported_hm NUMERIC(14,2);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_mobile_flags
  ON fuel_logs USING gin (mobile_flags) WHERE jsonb_array_length(mobile_flags) > 0;

ALTER TABLE fuel_inventory_transactions
  ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES fuel_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mobile_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE fuel_stock_opnames
  ADD COLUMN IF NOT EXISTS client_uuid UUID,
  ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES fuel_devices(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_stock_opnames_client_uuid
  ON fuel_stock_opnames (client_uuid) WHERE client_uuid IS NOT NULL;

-- ---------------------------------------------------------------
-- 6. Bukti foto totalizer buka/tutup shift (memperluas migrasi 103)
-- ---------------------------------------------------------------
ALTER TABLE fuel_evidence_slots DROP CONSTRAINT IF EXISTS fuel_evidence_slots_transaction_kind_check;
ALTER TABLE fuel_evidence_slots ADD CONSTRAINT fuel_evidence_slots_transaction_kind_check
  CHECK (transaction_kind IN ('issue_equipment', 'transfer', 'receipt', 'opname', 'shift_open', 'shift_close'));
ALTER TABLE fuel_attachments DROP CONSTRAINT IF EXISTS fuel_attachments_entity_type_check;
ALTER TABLE fuel_attachments ADD CONSTRAINT fuel_attachments_entity_type_check
  CHECK (entity_type IN ('fuel_log', 'transaction', 'opname', 'shift_session'));

INSERT INTO fuel_evidence_slots (transaction_kind, slot_code, label, is_required, capture_source, sort_order, valid_from_version)
SELECT v.kind, v.code, v.label, v.req, 'camera', v.ord, 1
FROM (VALUES
  ('shift_open',  'totalizer_awal',  'Totalizer awal',  TRUE,  10),
  ('shift_open',  'tangki',          'Foto tangki',     FALSE, 20),
  ('shift_close', 'totalizer_akhir', 'Totalizer akhir', TRUE,  10)
) AS v(kind, code, label, req, ord)
WHERE NOT EXISTS (SELECT 1 FROM fuel_evidence_slots s WHERE s.transaction_kind = v.kind);

COMMIT;
