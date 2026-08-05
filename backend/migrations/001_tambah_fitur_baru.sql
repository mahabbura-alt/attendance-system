-- Migration 001: Tambah Fitur Baru (rolling shift, registrasi mandiri, reset password)
-- Jalankan: npm run migration
-- CATATAN: Jalankan ini hanya pada database yang sudah ada (schema v1)
-- Untuk instalasi baru, cukup jalankan sql/schema.sql

BEGIN;

-- -------------------------------------------------------
-- Tambah kolom baru ke tabel users
-- -------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS nik_ktp    VARCHAR(16),
    ADD COLUMN IF NOT EXISTS jabatan    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS departemen VARCHAR(100);

-- Tambah unique constraint untuk nik_ktp
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_nik_ktp_key'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_nik_ktp_key UNIQUE (nik_ktp);
    END IF;
END $$;

-- Jadikan shift_id nullable (rolling shift: dipilih saat absen, bukan fixed di user)
ALTER TABLE users ALTER COLUMN shift_id DROP NOT NULL;

ALTER TABLE registrasi_pending
    ADD COLUMN IF NOT EXISTS foto_referensi_1_url TEXT,
    ADD COLUMN IF NOT EXISTS foto_referensi_2_url TEXT,
    ADD COLUMN IF NOT EXISTS foto_referensi_3_url TEXT;
CREATE TABLE IF NOT EXISTS registrasi_pending (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama            VARCHAR(150) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    nik_ktp         VARCHAR(16) NOT NULL UNIQUE,
    jabatan         VARCHAR(100),
    departemen      VARCHAR(100),
    password_hash   TEXT NOT NULL,
    shift_id        UUID REFERENCES shifts(id),
    lokasi_kantor_id UUID REFERENCES lokasi_kantor(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'menunggu'
                        CHECK (status IN ('menunggu', 'disetujui', 'ditolak')),
    catatan_admin   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    diproses_at     TIMESTAMPTZ
);

-- -------------------------------------------------------
-- Tabel password_reset_tokens (jika belum ada)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prt_token
    ON password_reset_tokens (token) WHERE used = FALSE;

-- -------------------------------------------------------
-- Tambah index baru untuk performa rekap
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_absensi_tanggal
    ON absensi (tanggal_kerja);

-- Update nama shift (Shift 1 → Shift Siang, Shift 2 → Shift Malam)
UPDATE shifts SET nama_shift = 'Shift Siang' WHERE nama_shift = 'Shift 1';
UPDATE shifts SET nama_shift = 'Shift Malam' WHERE nama_shift = 'Shift 2';

COMMIT;
