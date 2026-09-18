-- =========================================================
-- 022: Tambah kolom km_only pada tabel equipment
-- ---------------------------------------------------------
-- Flag manual per-unit untuk menandai unit yang hanya
-- menyediakan pembacaan KM/Odometer (tanpa HM) pada input
-- Fuel. Bila km_only = TRUE, kolom HM pada input Fuel menjadi
-- OPSIONAL (tidak wajib diisi) dan sistem menghitung rasio
-- berbasis jarak (Ltr/Km) saja.
--
-- Idempotent: aman dijalankan berulang.
-- =========================================================

ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS km_only BOOLEAN NOT NULL DEFAULT FALSE;
