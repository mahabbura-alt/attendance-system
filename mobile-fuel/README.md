# OMOS Fuel (APK fuelman lapangan)

Aplikasi Android offline-first untuk pencatatan BBM di lapangan:

- **Isi unit** — pindai QR unit, catat HM/KM/liter, dan foto bukti.
- **Transfer antar lokasi** dan **terima fuel** dari transportir — keduanya menunggu validasi admin.
- **Opname fisik** — mengikuti alur approval maker-checker.
- **Buka/tutup shift** dengan totalizer, lengkap dengan perhitungan selisih.
- **Riwayat & status sinkron**, **ganti petugas** di HP bersama, dan pembaruan self-hosted.

Keputusan desain: sesi grilling + validasi formula 17 Okt 2026 (lihat `docs/OMOS_WORKING_CONTEXT_AND_HANDOVER.md`).
Mockup: `admin-dashboard/test-fixtures/omos-fuel-apk-preview.html`.

## Arsitektur singkat

| Lapisan | Isi |
| --- | --- |
| UI | Jetpack Compose + Material 3 (`ui/`, `ui/screens/`), navigasi `MainActivity.kt`. Tombol besar, mode gelap dan kontras tinggi. |
| Data | Room (`data/db/AppDb.kt`: antrean `outbox`, `cache` bootstrap) dan Retrofit (`data/Api.kt`). |
| Aturan lapangan | `data/FuelRules.kt` — cermin `backend/src/services/fuelMobile.js`. Server tetap penentu akhir. |
| Sesi | `data/Session.kt` (EncryptedSharedPreferences) — beberapa petugas per HP, token + hash PIN offline per petugas (`data/OfflinePin.kt`, PBKDF2). |
| Pindai | `scan/QrScanner.kt` — CameraX + ML Kit barcode (model dibundel, offline). Membaca QR `OMOS:EQ:<ID>` / `OMOS:LOC:<ID>` dan barcode 1D. |
| Foto | `data/PhotoStore.kt` — kamera bawaan (bukan galeri), kompres ≤1600 px / ±300 KB, SHA-256 dari file terkompres. |
| Sinkronisasi | `sync/SyncWorker.kt` (periodik ±15 menit + segera). Foto diunggah dulu ke `/api/fuel-evidence/attachments` (idempoten per `client_uuid` foto), lalu transaksi dikirim ke `/api/fuel/mobile/sync` dengan `attachment_ids`. |
| Pembaruan | `update/UpdateManager.kt` — unduh → verifikasi SHA-256 → 1 ketuk Install. |

Backend: `backend/src/routes/fuelMobile.routes.js` (`/api/fuel/mobile/*`), `backend/src/routes/fuelEvidence.routes.js`, migrasi 103 + 104.
Login: `POST /api/fuel/mobile/login { employee_id, pin, device_uid }`. Token bercakupan `fuel_mobile` (hanya API Fuel).

### Aturan yang dicek di HP (server menghitung ulang)

- **Shift dan tanggal operasional** dihitung otomatis (hari mulai 06:00 WIB; 06–18 siang).
- **HM/KM:**
  - KM mundur diblokir.
  - HM mundur tetap disimpan, tetapi HM ditahan (perlu Event HM di Input Data).
  - Selisih HM > jam berlalu + toleransi → alasan wajib.
- **Pengisian:** satu pengisian per unit per shift; liter > kapasitas tangki → alasan wajib.
- **Tutup shift:** selisih = (totalizer akhir − awal) − (pengisian + transfer keluar). Investigasi bila |selisih| > maks(0,5% × meter, 20 L); ambang bisa diatur dari dashboard.
- **Estimasi stok sumber** = posted + pending masuk − pending keluar (server) − keluar yang belum terkirim (HP).

## Build

Prasyarat: JDK 17, Android SDK 34 (`local.properties` → `sdk.dir`).

```powershell
# Windows: path TEMP berisi spasi membuat JDK gagal membuka socket.
$env:TEMP="C:\gtmp"; $env:TMP="C:\gtmp"; $env:JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\gtmp -Djava.io.tmpdir=C:\gtmp"
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:assembleDebug                                        # server produksi https://omos-mining.com/
.\gradlew.bat :app:assembleDebug -PAPI_BASE_URL=http://10.0.2.2:3000/   # emulator → backend lokal
```

### Rilis

1. Keystore rilis (dibuat 17 Okt 2026, terpisah dari Safety, alias `omos-fuel`): `%USERPROFILE%\.omos-keys\omos-fuel-release.jks`. Variabel `OMOS_FUEL_*` ada di `omos-fuel-keystore.properties` di folder yang sama. Sidik jari sertifikat SHA-256: `c7f96b70…eaa75a25`.
   - Simpan cadangan kedua file di tempat aman. Tanpa keystore ini, update tidak bisa dipasang di atas versi terpasang.
   - Build dari Git Bash:
     `while IFS='=' read -r k v; do v="${v%$''}"; [ -n "$k" ] && export "$k=$v"; done < "$USERPROFILE/.omos-keys/omos-fuel-keystore.properties"`
     lalu `./gradlew.bat :app:assembleRelease -PAPI_BASE_URL=https://omos-mining.com/`.
   - Naikkan `versionCode`/`versionName` di `app/build.gradle.kts` untuk setiap rilis.
2. Salin APK ke `backend/src/public/OMOS_Fuel.apk`. File diunduh di `https://omos-mining.com/api/app/omos-fuel.apk`.
3. Isi `backend/src/public/fuel-release.json`: `version_code`, `version_name`, `minimum_supported_version`, `sha256`, dan `apk_path: /api/app/omos-fuel.apk`.
4. Deploy overlay Biznet: salin `/opt/omos/current` ke folder rilis baru, timpa kedua file di `backend/src/public/`, lalu `ops/biznet/release-app.sh`. APK tidak ikut git (`*.apk` di-ignore).

### Syarat sebelum dipakai di lapangan

- Migrasi 103 + 104 sudah dijalankan.
- Admin membuat akun fuelman, menyetujui perangkat (Input Fuel → Akses Fuel), dan menempel label QR unit/lokasi (List Equipment → Cetak Label QR).
