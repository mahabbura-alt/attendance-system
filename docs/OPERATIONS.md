# Panduan Operasional dan Rilis

## Konfigurasi aman

1. Salin `backend/.env.example` menjadi `backend/.env` di server; jangan pernah mengirim `.env` ke Git, ZIP, email, atau dashboard.
2. Isi semua variabel dengan nilai produksi. Gunakan secret acak minimal 32 byte untuk `JWT_SECRET`.
3. Set `CORS_ORIGINS` hanya ke URL dashboard HTTPS yang digunakan, tanpa wildcard.
4. Jalankan API dan dashboard di balik reverse proxy HTTPS. Aplikasi Android menolak HTTP biasa.
5. Tetapkan `TZ=Asia/Jakarta` pada proses backend/container.

## Database dan storage

1. Backup PostgreSQL serta bucket MinIO sebelum migrasi atau rilis.
2. Jalankan `backend/migrations/001_production_hardening.sql` sekali pada database lama.
3. Uji restore backup secara berkala; backup yang tidak pernah direstore belum terbukti dapat dipakai.
4. Foto MinIO harus tetap privat; akses hanya lewat presigned URL yang masa berlakunya pendek.

## Retensi foto absensi

Penghapusan foto selalu dinonaktifkan sampai `PHOTO_RETENTION_DAYS` diisi dengan angka hari yang disetujui. Setelah backup dan persetujuan kebijakan retensi:

```powershell
cd backend
npm run retention:dry
npm run retention:execute
```

Perintah pertama hanya menghitung kandidat. Perintah kedua menghapus objek foto absensi dari MinIO dan mengosongkan referensinya di database; record absensi tidak dihapus.

## Menjalankan dependensi pengembangan

Untuk PostgreSQL dan MinIO lokal, gunakan `backend/docker-compose.dev.yml`. Nilai password di file tersebut hanya untuk komputer pengembangan dan tidak boleh digunakan di produksi.

## Build Android

Tambahkan URL API HTTPS pada `mobile-android/local.properties` untuk pengembangan lokal (file ini diabaikan Git):

```properties
API_BASE_URL=https://api.contoh-perusahaan.com/
```

Kemudian:

```powershell
cd mobile-android
.\gradlew.bat test
.\gradlew.bat assembleDebug
.\gradlew.bat bundleRelease
```

Untuk rilis, buat keystore terpisah dan kelola password signing melalui secret CI; jangan taruh keystore atau password di repositori.

## Checklist sebelum produksi

- Semua kredensial lama telah dirotasi.
- TLS, DNS, CORS, dan `API_BASE_URL` telah diuji pada perangkat fisik.
- Login, datang, pulang, shift malam, GPS palsu, lokasi di luar radius, wajah tidak cocok, koneksi putus, dan akun nonaktif diuji.
- Dashboard mampu membuat karyawan, daftar lokasi, unggah referensi wajah, dan membaca audit log.
- Perubahan dan penonaktifan karyawan telah diuji oleh admin yang berwenang.
- Backup dan pemulihan PostgreSQL/MinIO berhasil diuji.
