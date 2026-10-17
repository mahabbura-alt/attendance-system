-- =====================================================================
-- 094_people_attendance_locations.sql — Lokasi absen per karyawan (T6)
--
-- Aturan (keputusan D1, 2026-10-12):
--   * Karyawan TANPA baris di tabel ini = boleh absen di semua lokasi
--     (perilaku lama, tidak ada yang tiba-tiba gagal absen).
--   * Karyawan DENGAN baris = hanya boleh absen di lokasi yang tercatat.
--   * users.lokasi_kantor_id tetap dipakai sebagai lokasi utama (peta mini).
-- =====================================================================
CREATE TABLE IF NOT EXISTS employee_attendance_locations (
  employee_profile_id UUID NOT NULL REFERENCES workforce_employee_profiles(id) ON DELETE RESTRICT,
  lokasi_kantor_id    UUID NOT NULL REFERENCES lokasi_kantor(id) ON DELETE CASCADE,
  is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_profile_id, lokasi_kantor_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_attendance_primary
  ON employee_attendance_locations (employee_profile_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_employee_attendance_lokasi
  ON employee_attendance_locations (lokasi_kantor_id);
