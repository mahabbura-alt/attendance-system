-- =====================================================================
-- PRE-FLIGHT READ-ONLY — Modul Karyawan (OMOS People)
-- Tujuan : mengukur konflik data nyata sebelum migrasi 093+.
-- Aman   : hanya SELECT, dibungkus transaksi READ ONLY. Tidak mengubah data.
-- Jalankan di server (contoh):
--   docker exec -i omos-postgres-staging psql -U <user> -d omos_staging \
--     -v ON_ERROR_STOP=1 < karyawan_preflight_readonly.sql > preflight.txt
-- Kirim isi preflight.txt (tanpa data pribadi) untuk ditinjau.
-- =====================================================================
BEGIN TRANSACTION READ ONLY;

\echo '== P1. Tipe kolom users.permissions (schema.sql = JSONB, kode = text[])'
SELECT data_type, udt_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='users' AND column_name='permissions';

\echo '== P2. Karyawan per status & kelengkapan NRP'
SELECT is_active,
       COUNT(*)                                                     AS total,
       COUNT(*) FILTER (WHERE NULLIF(TRIM(employee_id),'') IS NULL) AS tanpa_nrp,
       COUNT(*) FILTER (WHERE nik_ktp IS NOT NULL)                  AS ada_nik_di_users,
       COUNT(*) FILTER (WHERE compreface_subject IS NULL)           AS tanpa_wajah,
       COUNT(*) FILTER (WHERE compreface_subject = email)           AS subject_email,
       COUNT(*) FILTER (WHERE compreface_subject = id::text)        AS subject_userid
FROM users WHERE role='karyawan' GROUP BY is_active ORDER BY is_active DESC;

\echo '== P3. NRP users vs profil workforce berbeda'
SELECT COUNT(*) AS nrp_berbeda
FROM users u JOIN workforce_employee_profiles p ON p.user_id=u.id
WHERE COALESCE(TRIM(u.employee_id),'') <> COALESCE(TRIM(p.employee_number),'');

\echo '== P4. Karyawan aktif tanpa profil / tanpa assignment aktif'
SELECT
  COUNT(*) FILTER (WHERE p.id IS NULL) AS tanpa_profil,
  COUNT(*) FILTER (WHERE p.id IS NOT NULL AND a.id IS NULL) AS tanpa_assignment_aktif,
  COUNT(*) FILTER (WHERE a.id IS NOT NULL AND a.position_id IS NULL) AS assignment_tanpa_position_id
FROM users u
LEFT JOIN workforce_employee_profiles p ON p.user_id=u.id AND p.deleted_at IS NULL
LEFT JOIN workforce_employee_assignments a ON a.employee_profile_id=p.id AND a.status='ACTIVE' AND a.effective_to IS NULL
WHERE u.role='karyawan' AND u.is_active;

\echo '== P5. Teks jabatan/departemen di users yang TIDAK cocok master (per nama, tanpa beda huruf)'
SELECT TRIM(u.departemen) AS departemen, TRIM(u.jabatan) AS jabatan, COUNT(*) AS karyawan,
       BOOL_OR(d.id IS NOT NULL) AS dept_ada_di_master,
       BOOL_OR(pos.id IS NOT NULL) AS jabatan_ada_di_master
FROM users u
LEFT JOIN workforce_departments d ON lower(d.name)=lower(TRIM(u.departemen))
LEFT JOIN workforce_positions pos ON pos.department_id=d.id AND lower(pos.name)=lower(TRIM(u.jabatan))
WHERE u.role='karyawan' AND u.is_active
GROUP BY 1,2
HAVING NOT BOOL_OR(pos.id IS NOT NULL)
ORDER BY karyawan DESC;

\echo '== P6. Nama jabatan yang sama di lebih dari satu departemen (ambigu untuk join berbasis nama)'
SELECT lower(p.name) AS jabatan, COUNT(DISTINCT p.department_id) AS jumlah_departemen,
       STRING_AGG(DISTINCT d.name, ', ') AS departemen
FROM workforce_positions p JOIN workforce_departments d ON d.id=p.department_id
GROUP BY lower(p.name) HAVING COUNT(DISTINCT p.department_id) > 1;

\echo '== P7. Variasi penulisan jabatan (beda spasi/huruf besar) di users'
SELECT lower(regexp_replace(TRIM(jabatan),'\s+',' ','g')) AS kunci, COUNT(DISTINCT jabatan) AS variasi,
       STRING_AGG(DISTINCT jabatan, ' | ') AS contoh
FROM users WHERE role='karyawan' AND jabatan IS NOT NULL
GROUP BY 1 HAVING COUNT(DISTINCT jabatan) > 1;

\echo '== P8. Status profil & data kontrak/probation yang kosong'
SELECT employment_status, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE probation_end_date IS NULL) AS probation_end_kosong,
       COUNT(*) FILTER (WHERE contract_end_date IS NULL) AS contract_end_kosong,
       COUNT(*) FILTER (WHERE hire_date IS NULL) AS hire_date_kosong
FROM workforce_employee_profiles WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 1;

\echo '== P9. Pergerakan per status & yang sudah lewat tanggal efektif tapi belum diterapkan'
SELECT status, movement_type, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status='APPROVED' AND effective_date <= CURRENT_DATE) AS jatuh_tempo_belum_efektif
FROM workforce_employee_movements GROUP BY 1,2 ORDER BY 1,2;

\echo '== P10. Nama constraint CHECK movement_type (dipakai saat menambah jenis baru)'
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='workforce_employee_movements'::regclass AND contype='c';

\echo '== P11. Registrasi mandiri yang masih tertunda'
SELECT status, COUNT(*) FROM registrasi_pending GROUP BY status ORDER BY status;

\echo '== P12. Lokasi absen: jumlah lokasi & karyawan per lokasi utama'
SELECT l.nama_lokasi, l.radius_meter, COUNT(u.id) AS karyawan_aktif
FROM lokasi_kantor l LEFT JOIN users u ON u.lokasi_kantor_id=l.id AND u.role='karyawan' AND u.is_active
GROUP BY l.id, l.nama_lokasi, l.radius_meter ORDER BY 3 DESC;
SELECT COUNT(*) FILTER (WHERE lokasi_kantor_id IS NULL) AS aktif_tanpa_lokasi
FROM users WHERE role='karyawan' AND is_active;

\echo '== P13. Data turunan yang ikut terhapus bila users dihapus (FK ON DELETE CASCADE ke users)'
SELECT c.conrelid::regclass AS tabel, c.conname
FROM pg_constraint c
WHERE c.contype='f' AND c.confrelid='users'::regclass AND c.confdeltype='c'
ORDER BY 1;

\echo '== P14. Duplikat nama karyawan (risiko pencocokan payroll berbasis nama) — hanya jumlah, tanpa nama'
SELECT COUNT(*) AS kelompok_nama_ganda, COALESCE(SUM(n),0) AS karyawan_terlibat
FROM (SELECT COUNT(*) AS n FROM users WHERE role='karyawan' GROUP BY lower(TRIM(nama)) HAVING COUNT(*) > 1) x;

\echo '== P15. Migrasi terakhir yang sudah ada (cek 092 sebelum 093+)'
SELECT to_regclass('public.hse_workhour_standards') AS mig_092,
       to_regclass('public.employee_family_members') AS family_draft,
       to_regclass('public.hse_employee_licenses') AS hse_licenses,
       to_regclass('public.hse_training_records') AS hse_training;

\echo '== P16. NIK di users: tidak valid & GANDA (093 menyalin NIK 16 digit ke kolom UNIK — ganda = migrasi GAGAL)'
SELECT COUNT(*) FILTER (WHERE nik_ktp IS NOT NULL AND nik_ktp !~ '^[0-9]{16}$') AS nik_tidak_valid_dilewati,
       (SELECT COUNT(*) FROM (SELECT nik_ktp FROM users WHERE nik_ktp ~ '^[0-9]{16}$'
          AND id IN (SELECT user_id FROM workforce_employee_profiles) GROUP BY nik_ktp HAVING COUNT(*) > 1) d) AS nik_ganda_kelompok
FROM users;

\echo '== P17. NRP (employee_id) ganda tanpa beda huruf/spasi'
SELECT COUNT(*) AS nrp_ganda_kelompok FROM (
  SELECT lower(TRIM(employee_id)) FROM users WHERE NULLIF(TRIM(employee_id),'') IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1) x;

\echo '== P18. Email ganda tanpa beda huruf (login & undangan memakai lower(email))'
SELECT COUNT(*) AS email_ganda_kelompok FROM (SELECT lower(TRIM(email)) FROM users GROUP BY 1 HAVING COUNT(*) > 1) x;

\echo '== P19. Nama departemen / jabatan ganda dalam satu departemen (People v2 menganggap unik)'
SELECT 'departemen' AS jenis, COUNT(*) AS kelompok FROM (
  SELECT tenant_key, project_key, lower(regexp_replace(trim(name),'\s+',' ','g')) FROM workforce_departments GROUP BY 1,2,3 HAVING COUNT(*) > 1) a
UNION ALL
SELECT 'jabatan', COUNT(*) FROM (
  SELECT department_id, lower(regexp_replace(trim(name),'\s+',' ','g')) FROM workforce_positions GROUP BY 1,2 HAVING COUNT(*) > 1) b;

\echo '== P20. Prasyarat lain: kolom password_reset_tokens.used, ekstensi btree_gist & pgcrypto'
SELECT column_name FROM information_schema.columns WHERE table_name='password_reset_tokens' ORDER BY ordinal_position;
SELECT extname FROM pg_extension WHERE extname IN ('btree_gist','pgcrypto') ORDER BY 1;

\echo '== P21. Tabel People v2 yang sudah ada (harus kosong sebelum 093)'
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
  ('people_settings','workforce_employee_personal','employee_attendance_locations','employee_documents',
   'employee_family_members','people_outbox','employee_import_batches','master_aliases');

ROLLBACK;
