-- =========================================================
-- 023: Ubah ambang batas telat (jam_masuk_maks) absensi
-- ---------------------------------------------------------
-- Shift Siang : jam_masuk_maks 06:10 -> 07:00 WIB
-- Shift Malam : jam_masuk_maks 18:10 -> 19:00 WIB
--
-- Catatan penting:
--  * HANYA jam_masuk_maks (ambang telat absensi) yang diubah.
--  * jam_pulang_min, operational_start/end, dan lintas_hari TIDAK
--    diubah (jam operasional produksi tetap 06:00/18:00).
--  * Migration 015 menambahkan CHECK constraint
--    `shifts_standard_hours_check` yang memaksa jam_masuk_maks
--    Siang=06:10 & Malam=18:10. Constraint tsb di-drop lalu
--    dibuat ulang dengan nilai baru agar UPDATE tidak ditolak.
--
-- Idempotent: aman dijalankan berulang.
-- =========================================================

-- 1) Lepas constraint lama yang memaksa nilai 06:10 / 18:10.
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_standard_hours_check;

-- 2) Perbarui ambang batas telat absensi (hanya jam_masuk_maks).
UPDATE shifts
SET jam_masuk_maks = CASE
      WHEN LOWER(TRIM(nama_shift)) = 'shift siang' THEN TIME '07:00'
      WHEN LOWER(TRIM(nama_shift)) = 'shift malam' THEN TIME '19:00'
      ELSE jam_masuk_maks
    END;

-- 3) Buat ulang constraint dengan nilai jam_masuk_maks yang baru.
--    Nilai lain (jam_pulang_min, operational_start/end, lintas_hari)
--    tetap mengikuti standar migration 015.
ALTER TABLE shifts ADD CONSTRAINT shifts_standard_hours_check CHECK (
  LOWER(TRIM(nama_shift)) NOT IN ('shift siang', 'shift malam')
  OR (
    LOWER(TRIM(nama_shift)) = 'shift siang'
    AND operational_start = TIME '06:00'
    AND operational_end = TIME '18:00'
    AND jam_masuk_maks = TIME '07:00'
    AND jam_pulang_min = TIME '18:00'
    AND lintas_hari = FALSE
  )
  OR (
    LOWER(TRIM(nama_shift)) = 'shift malam'
    AND operational_start = TIME '18:00'
    AND operational_end = TIME '06:00'
    AND jam_masuk_maks = TIME '19:00'
    AND jam_pulang_min = TIME '06:00'
    AND lintas_hari = TRUE
  )
);
