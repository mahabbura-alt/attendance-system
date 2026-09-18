# Aplikasi Absensi Karyawan

Struktur proyek:

- `backend/` — API Node.js, skema PostgreSQL, migrasi, dan tes backend.
- `mobile-android/` — aplikasi Android native dan Gradle Wrapper.
- `admin-dashboard/` — dashboard admin web statis.
- `docs/` — panduan operasional dan keamanan data biometrik.

Baca [docs/OPERATIONS.md](docs/OPERATIONS.md) untuk rilis serta [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) untuk pengelolaan data biometrik.

Backend Node.js/Express untuk aplikasi absensi Android — validasi geofencing (radius 50m),
verifikasi wajah via CompreFace, dan aturan shift 2 sesuai dokumen requirement.

## 1. Konfigurasi Vercel

```bash
vercel link
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

## 2. Setup Supabase PostgreSQL

Jalankan skema terhadap database Supabase:

```bash
psql "$DATABASE_URL" -f backend/sql/schema.sql
```

Skema ini otomatis membuat 2 shift standar (Shift 1 & Shift 2) dan 1 baris akun admin
dengan `password_hash` placeholder. **Jangan lupa** update password admin sebelum dipakai:

```bash
npm run seed:admin -- admin@perusahaan.com password_yang_kuat
```

## 3. Setup Supabase Storage

Buat bucket `absensi-foto` di Supabase Storage. Backend mengaksesnya melalui
`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`; tidak ada fallback storage lokal.

## 4. Setup CompreFace (verifikasi wajah, gratis & self-hosted)

Jalankan CompreFace via Docker (lihat dokumentasi resminya di
https://github.com/exadel-inc/CompreFace untuk `docker-compose.yml` terbaru).
Setelah jalan:

1. Buka dashboard CompreFace, buat aplikasi baru, buat service **Recognition**.
2. Salin API key service Recognition ke `.env` (`COMPREFACE_RECOGNITION_API_KEY`).
3. Untuk setiap karyawan baru, daftarkan foto referensinya sebagai *subject*
   (lihat `src/services/compreface.js` → `daftarkanWajahReferensi`), lalu simpan
   subject id itu ke kolom `users.compreface_subject`.

## 5. Deploy production

```bash
vercel --prod
```

## 6. Endpoint yang tersedia

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| POST | `/api/auth/login` | Login, body `{ email, password }` |
| POST | `/api/absensi/datang` | Absen datang (butuh JWT). multipart: `latitude`, `longitude`, file `foto` |
| POST | `/api/absensi/pulang` | Absen pulang (butuh JWT). Sama seperti di atas |
| GET  | `/api/absensi/riwayat` | Riwayat absensi karyawan yang login |
| GET  | `/api/admin/absensi` | (admin) semua data absensi seluruh karyawan |
| PATCH | `/api/admin/absensi/:id` | (admin) edit manual + otomatis tercatat di audit_log |
| GET  | `/api/admin/audit-log/:absensiId` | (admin) riwayat perubahan manual pada satu record absensi |
| GET  | `/api/admin/karyawan` | (admin) daftar semua karyawan + status wajah terdaftar atau belum |
| POST | `/api/admin/karyawan` | (admin) buat akun karyawan baru. body: `{ nama, email, password, shift_id, lokasi_kantor_id }` |
| POST | `/api/admin/karyawan/:id/foto-referensi` | (admin) daftarkan/tambah foto referensi wajah ke CompreFace. multipart file `foto` |
| GET  | `/api/admin/lokasi` | (admin) daftar lokasi kantor |
| POST | `/api/admin/lokasi` | (admin) buat lokasi kantor baru. body: `{ nama_lokasi, latitude, longitude, radius_meter }` |

Semua endpoint (kecuali `/login`) butuh header:
`Authorization: Bearer <token>`

## 7. Alur setup karyawan baru (untuk admin)

1. `POST /api/admin/lokasi` — buat dulu titik lokasi kantor (kalau belum ada).
2. `POST /api/admin/karyawan` — buat akun karyawan (perlu `shift_id` dari tabel `shifts` yang sudah di-seed, dan `lokasi_kantor_id` dari langkah 1).
3. `POST /api/admin/karyawan/:id/foto-referensi` — upload foto wajah karyawan tsb. Ini yang mendaftarkan wajah ke CompreFace sekaligus menyimpan arsipnya di Supabase Storage. Bisa dipanggil berkali-kali untuk menambah sampel wajah yang sama supaya matching lebih akurat.

Setelah langkah 3 selesai, karyawan baru bisa login dan absen — verifikasi wajahnya akan dicocokkan ke sampel yang didaftarkan di langkah ini.

## 8. Status implementasi dan batasan

- Endpoint `PATCH /api/admin/karyawan/:id` tersedia untuk memperbarui data, mereset password, atau menonaktifkan/mengaktifkan karyawan.
- Dashboard admin (UI web) — endpoint di atas baru bentuk API, belum ada tampilannya.
- Liveness detection (kedipan/gerak kepala) — ini logic yang jalan di sisi Android
  (ML Kit), bukan di backend.
- Rate limiting login dan absensi tersedia. Pada deployment multi-instance, pindahkan state rate limit ke Redis atau gateway API.
- Retensi foto absensi tersedia melalui `backend/src/scripts/purgeExpiredPhotos.js`; penghapusan tetap nonaktif sampai `PHOTO_RETENTION_DAYS` ditetapkan dan perintah execute dijalankan.
