-- =========================================================
-- MIGRATION 002: FULL SUPABASE CLOUD POSTGRESQL SCHEMA
-- Target: PostgreSQL 16 / Supabase
-- Features: Idempotent, Safe, Transactional, Zero Data Loss
-- =========================================================

BEGIN;

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABEL shifts
CREATE TABLE IF NOT EXISTS shifts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_shift      VARCHAR(50) NOT NULL,
    jam_masuk_maks  TIME NOT NULL,
    jam_pulang_min  TIME NOT NULL,
    lintas_hari     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. TABEL lokasi_kantor
CREATE TABLE IF NOT EXISTS lokasi_kantor (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_lokasi   VARCHAR(100) NOT NULL,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    radius_meter  INTEGER NOT NULL DEFAULT 50 CHECK (radius_meter BETWEEN 1 AND 10000),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. TABEL users
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama                VARCHAR(150) NOT NULL,
    email               VARCHAR(150) NOT NULL UNIQUE,
    nik_ktp             VARCHAR(16) UNIQUE,
    jabatan             VARCHAR(100),
    departemen          VARCHAR(100),
    password_hash       TEXT NOT NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'karyawan' CHECK (role IN ('karyawan', 'admin')),
    shift_id            UUID REFERENCES shifts(id),
    lokasi_kantor_id    UUID REFERENCES lokasi_kantor(id),
    foto_referensi_url  TEXT,
    compreface_subject  VARCHAR(150),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_super_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    permissions         JSONB DEFAULT '["absensi", "karyawan", "performa", "registrasi", "payroll", "hm", "kalkulasiPayroll"]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. TABEL registrasi_pending
CREATE TABLE IF NOT EXISTS registrasi_pending (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama                  VARCHAR(150) NOT NULL,
    email                 VARCHAR(150) NOT NULL UNIQUE,
    nik_ktp               VARCHAR(16),
    jabatan               VARCHAR(100),
    departemen            VARCHAR(100),
    password_hash         TEXT NOT NULL,
    shift_id              UUID REFERENCES shifts(id),
    lokasi_kantor_id      UUID REFERENCES lokasi_kantor(id),
    foto_referensi_1_url  TEXT,
    foto_referensi_2_url  TEXT,
    foto_referensi_3_url  TEXT,
    status                VARCHAR(20) NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'disetujui', 'ditolak')),
    catatan_admin         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    diproses_at           TIMESTAMPTZ
);

-- 6. TABEL password_reset_tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. TABEL absensi
CREATE TABLE IF NOT EXISTS absensi (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES users(id),
    shift_id                  UUID NOT NULL REFERENCES shifts(id),
    tanggal_kerja             DATE NOT NULL,
    waktu_datang              TIMESTAMPTZ,
    lokasi_datang_lat         DOUBLE PRECISION,
    lokasi_datang_lng         DOUBLE PRECISION,
    foto_datang_url           TEXT,
    face_match_score_datang   NUMERIC(5,4),
    status_datang             VARCHAR(20) CHECK (status_datang IN ('tepat waktu', 'telat')),
    waktu_pulang              TIMESTAMPTZ,
    lokasi_pulang_lat         DOUBLE PRECISION,
    lokasi_pulang_lng         DOUBLE PRECISION,
    foto_pulang_url           TEXT,
    face_match_score_pulang   NUMERIC(5,4),
    status_pulang             VARCHAR(20) CHECK (status_pulang IN ('tepat waktu', 'checkout lewat')),
    percobaan_pulang_awal     INTEGER DEFAULT 0,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. TABEL audit_log
CREATE TABLE IF NOT EXISTS audit_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id         UUID NOT NULL REFERENCES users(id),
    absensi_id       UUID NOT NULL REFERENCES absensi(id),
    data_sebelum     JSONB,
    data_sesudah     JSONB,
    alasan           TEXT,
    waktu_perubahan  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INDEXES & CONSTRAINTS (SAFE / IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens (token) WHERE used = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_user_pending ON absensi (user_id) WHERE waktu_pulang IS NULL;
CREATE INDEX IF NOT EXISTS idx_absensi_user_tanggal ON absensi (user_id, tanggal_kerja);
CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON absensi (tanggal_kerja);

COMMIT;
