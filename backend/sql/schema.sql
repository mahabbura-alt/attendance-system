-- Skema database Aplikasi Absensi Karyawan
-- Target: PostgreSQL 13+
-- Versi: 2.0 (rolling shift, registrasi mandiri, reset password)

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- untuk gen_random_uuid()

-- =========================================================
-- Tabel shifts
-- =========================================================
CREATE TABLE shifts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_shift      VARCHAR(50) NOT NULL,        -- 'Shift 1' / 'Shift 2'
    jam_masuk_maks  TIME NOT NULL,               -- 07:10 / 18:10
    jam_pulang_min  TIME NOT NULL,               -- 18:00 / 07:00
    lintas_hari     BOOLEAN NOT NULL DEFAULT FALSE, -- true untuk Shift 2 (malam)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Tabel lokasi_kantor
-- =========================================================
CREATE TABLE lokasi_kantor (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_lokasi   VARCHAR(100) NOT NULL,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    radius_meter  INTEGER NOT NULL DEFAULT 50 CHECK (radius_meter BETWEEN 1 AND 10000),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Tabel users
-- =========================================================
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama                VARCHAR(150) NOT NULL,
    email               VARCHAR(150) NOT NULL UNIQUE,
    nik_ktp             VARCHAR(16) UNIQUE,          -- NIK KTP (16 digit)
    jabatan             VARCHAR(100),                -- Jabatan/Posisi
    departemen          VARCHAR(100),                -- Departemen/Divisi
    password_hash       TEXT NOT NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'karyawan' CHECK (role IN ('karyawan', 'admin')),
    -- shift_id nullable karena rolling shift: karyawan memilih shift saat absen
    shift_id            UUID REFERENCES shifts(id),
    lokasi_kantor_id    UUID REFERENCES lokasi_kantor(id),
    foto_referensi_url  TEXT,           -- foto wajah acuan untuk matching di CompreFace
    compreface_subject  VARCHAR(150),   -- subject id yang didaftarkan ke CompreFace
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Tabel registrasi_pending
-- Karyawan mendaftar mandiri → admin approve → akun dibuat
-- =========================================================
CREATE TABLE registrasi_pending (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama            VARCHAR(150) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    nik_ktp         VARCHAR(16) NOT NULL UNIQUE,
    jabatan         VARCHAR(100),
    departemen      VARCHAR(100),
    password_hash   TEXT NOT NULL,
    -- Karyawan pilih sendiri saat mendaftar
    shift_id        UUID REFERENCES shifts(id),
    lokasi_kantor_id UUID REFERENCES lokasi_kantor(id),
    -- 3 foto referensi wajah yang diupload karyawan saat mendaftar
    foto_referensi_1_url TEXT,
    foto_referensi_2_url TEXT,
    foto_referensi_3_url TEXT,
    -- Status approval
    status          VARCHAR(20) NOT NULL DEFAULT 'menunggu'
                        CHECK (status IN ('menunggu', 'disetujui', 'ditolak')),
    catatan_admin   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    diproses_at     TIMESTAMPTZ
);

-- =========================================================
-- Tabel password_reset_tokens
-- Token satu pakai, dikirim ke email karyawan
-- =========================================================
CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prt_token ON password_reset_tokens (token) WHERE used = FALSE;

-- =========================================================
-- Tabel absensi
-- =========================================================
CREATE TABLE absensi (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES users(id),
    -- shift_id dipilih karyawan saat absen (rolling shift)
    shift_id                  UUID NOT NULL REFERENCES shifts(id),
    tanggal_kerja             DATE NOT NULL,  -- tanggal shift dimulai

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

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Satu user hanya boleh punya satu record aktif (belum checkout) pada satu waktu
CREATE UNIQUE INDEX uq_absensi_user_pending
    ON absensi (user_id)
    WHERE waktu_pulang IS NULL;

CREATE INDEX idx_absensi_user_tanggal ON absensi (user_id, tanggal_kerja);
CREATE INDEX idx_absensi_tanggal ON absensi (tanggal_kerja);

-- =========================================================
-- Tabel audit_log
-- =========================================================
CREATE TABLE audit_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id         UUID NOT NULL REFERENCES users(id),
    absensi_id       UUID NOT NULL REFERENCES absensi(id),
    data_sebelum     JSONB,
    data_sesudah     JSONB,
    alasan           TEXT,
    waktu_perubahan  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Seed data awal: 2 shift rolling + 1 akun admin
-- =========================================================
INSERT INTO shifts (nama_shift, jam_masuk_maks, jam_pulang_min, lintas_hari) VALUES
    ('Shift Siang', '07:10:00', '18:00:00', FALSE),  -- 07:00-18:00, toleransi masuk 07:10
    ('Shift Malam', '18:10:00', '07:00:00', TRUE);   -- 18:00-07:00 (lintas hari)

-- Akun admin contoh (ganti password via: npm run seed:admin -- admin@perusahaan.com <password>)
INSERT INTO users (nama, email, password_hash, role) VALUES
    ('Admin Utama', 'admin@perusahaan.com', 'GANTI_DENGAN_HASH_BCRYPT', 'admin');
