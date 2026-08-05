-- Jalankan SEKALI pada database yang sudah ada, setelah backup terverifikasi.
-- Periksa hasil query pertama. Jika ada lebih dari satu sesi terbuka per user,
-- selesaikan atau arsipkan data tersebut sebelum menjalankan CREATE UNIQUE INDEX.

SELECT user_id, COUNT(*) AS sesi_terbuka
FROM absensi
WHERE waktu_pulang IS NULL
GROUP BY user_id
HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_user_pending
    ON absensi (user_id)
    WHERE waktu_pulang IS NULL;

ALTER TABLE lokasi_kantor
    ADD CONSTRAINT lokasi_kantor_radius_meter_valid
    CHECK (radius_meter BETWEEN 1 AND 10000) NOT VALID;

ALTER TABLE lokasi_kantor
    VALIDATE CONSTRAINT lokasi_kantor_radius_meter_valid;
