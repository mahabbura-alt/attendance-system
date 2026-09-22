-- 042_audit_log_absensi_nullable.sql
-- Aturan mutlak Rekap Performa: admin dapat menimpa presensi kamera lewat
-- keterangan_presensi. Entri audit untuk penimpaan itu disimpan dengan
-- absensi_id = NULL (sudah dilakukan oleh simpanKeteranganPresensi).
-- Skema lama memaksa absensi_id NOT NULL, jadi relaksasi diperlukan agar
-- histori penimpaan rekap konsisten dan bisa ditampilkan kembali per baris
-- absensi (modal Histori) untuk antisipasi pengembalian ke presensi kamera.

BEGIN;

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_absensi_id_fkey;
ALTER TABLE audit_log ALTER COLUMN absensi_id DROP NOT NULL;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_absensi_id_fkey
  FOREIGN KEY (absensi_id) REFERENCES absensi(id);

CREATE INDEX IF NOT EXISTS idx_audit_log_absensi_id ON audit_log (absensi_id);

COMMIT;