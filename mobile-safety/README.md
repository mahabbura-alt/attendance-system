# OMOS Safety (APK HSE lapangan)

Aplikasi Android offline-first untuk modul HSE OMOS: Lapor Hazard, Insiden / Near Miss, Inspeksi (terjadwal &
tidak terjadwal), P5M, Safety Talk / General, Pertemuan K3 / Umum, Laporan untuk Saya (PIC), Verifikasi,
Delegasi PIC (khusus delegator departemen), Riwayat + koreksi/batal, Antrean Kirim & Penyimpanan, Notifikasi
(polling), Statistik, Profil + pembaruan self-hosted.

Keputusan desain & aturan bisnis: `docs/OMOS_SAFETY_MOCKUP_REVISI_DASHBOARD_CONTEXT.md`,
`docs/# OMOS Safety — Handoff Sesi 13 Okt via cloud.md`. Mockup: https://claude.ai/artifact/14jS6bG8Zh2k6sZwfRH6hU

## Arsitektur singkat

| Lapisan | Isi |
| --- | --- |
| UI | Jetpack Compose + Material 3 (`ui/`, `ui/screens/`), navigasi `MainActivity.kt` |
| Data | Room (`data/db/AppDb.kt`: antrean `outbox`, `cache` offline, `notifications`), Retrofit (`data/Api.kt`) |
| Sinkronisasi | `sync/SyncWorker.kt` (WorkManager periodik ±15 menit + segera saat ada data baru) |
| Foto | `data/PhotoStore.kt` — kamera saja (bukan galeri), kompres ±300 KB / 1280 px, disimpan internal, dikirim sebagai data URL |
| Pembaruan | `update/UpdateManager.kt` — unduh → verifikasi SHA-256 → 1 ketuk Install; wajib bila < `minimum_supported_version` |

Backend: `backend/src/routes/hseMobile.routes.js` → `/api/hse/mobile/*` (service `backend/src/services/hseMobile.js`,
migration `backend/migrations/101_hse_mobile_safety.sql`). Semua tulisan lewat `POST /api/hse/mobile/sync`
dengan `client_uuid` (idempoten — kirim ulang tidak membuat data ganda). Login: `POST /api/auth/login { employee_id, password }`.

## Build

Prasyarat: JDK 17, Android SDK 34 (`local.properties` → `sdk.dir`).

```powershell
# Windows: path TEMP berisi spasi membuat JDK gagal membuka socket ("Unable to establish loopback connection").
$env:TEMP="C:\gtmp"; $env:TMP="C:\gtmp"; $env:JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\gtmp -Djava.io.tmpdir=C:\gtmp"
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:assembleDebug                                   # server produksi https://omos-mining.com/
.\gradlew.bat :app:assembleDebug -PAPI_BASE_URL=http://10.0.2.2:3000/   # emulator → backend lokal
```

### Rilis (v1.0.0 live 14 Okt 2026 — rilis Biznet `20261014-110646-omos-safety-101`)
Keystore: `%USERPROFILE%\.omos-keys\omos-safety-release.jks` + `omos-safety-keystore.properties` (muat ke env lalu `assembleRelease`). Unduhan: `https://omos-mining.com/api/app/omos-safety.apk`.
Untuk versi berikutnya: naikkan `versionCode`/`versionName`, build rilis, perbarui `safety-release.json` (sha256, `apk_path: /api/app/omos-safety.apk`).

1. Buat keystore rilis **baru khusus OMOS Safety**, simpan di luar repo (jangan commit `*.jks`).
2. Build: `.\gradlew.bat :app:assembleRelease -POMOS_SAFETY_STORE_FILE=... -POMOS_SAFETY_STORE_PASSWORD=... -POMOS_SAFETY_KEY_ALIAS=... -POMOS_SAFETY_KEY_PASSWORD=...`
   (atau variabel environment dengan nama sama).
3. Salin APK ke server `backend/src/public/OMOS_Safety.apk` (disajikan di `/OMOS_Safety.apk`) dan buat
   `backend/src/public/safety-release.json` (format sama dengan `mobile-release.json`: `version_code`, `version_name`,
   `minimum_supported_version`, `mandatory`, `apk_path: "/OMOS_Safety.apk"`, `sha256`, `release_notes`). Manifest wajib HTTPS.
4. APK debug (`dist/OMOS_Safety-1.0.0-debug.apk`) hanya untuk uji: APK rilis yang ditandatangani kunci berbeda
   **tidak bisa** meng-update APK debug — uninstall dulu.

### v1.0.1 (code 2) — 14 Okt 2026, belum deploy
Konsekuensi / potensi dampak & Rekomendasi perbaikan wajib; rekomendasi = CAPA per PIC; status hazard otomatis dari progres CAPA
(`hse.syncHazardStatusFromActions`, migration `102_hse_hazard_recommendation.sql` — jalankan sebelum backend baru aktif).
Juga: peserta P5M/Safety Talk dari Seleksi Karyawan Setup Master, Statistik target per individu (harian/mingguan/bulanan), fix sinkron P5M/Safety Talk.
APK `dist/OMOS_Safety-1.0.1.apk`, manifest wajib update (`minimum_supported_version: 2`). `dist/OMOS_Safety-1.0.1-debug-emulator.apk`
menunjuk ke `http://10.0.2.2:3000/` (khusus emulator).

## Uji yang sudah dijalankan (14 Okt 2026)
- Backend: `backend/test/hse-mobile.test.js` (PGlite, 5 test termasuk eskalasi) + seluruh suite 539/539 lulus (`node --test --test-concurrency=2`).
- APK: unit test `RiskTest` (ambang risiko & SLA sama dengan backend).
- Emulator Pixel_7 terhadap backend lokal PGlite (route asli, DB in-memory): login Employee ID, bootstrap master,
  form hazard + matriks risiko + banner darurat (HSE on-duty dari roster), PIC mulai tindak lanjut → tersinkron,
  minta perpanjangan → delegator setujui → server `extension_count=1`, batas 23:59:59 WIB, notifikasi polling, mode gelap.
- Lanjutan (emulator dengan `-gpu host -camera-back emulated`): **Lapor Hazard dengan foto kamera** end-to-end (foto terkompres,
  PIC dipilih, server menerima HZD + foto + tindakan segera), **offline-first**: insiden dibuat saat mode pesawat → tersimpan
  "Menunggu dikirim" → terkirim otomatis < 25 detik setelah sinyal kembali; indikator Online/Offline mengikuti jaringan HP.
- Catatan emulator: dengan `-gpu swiftshader_indirect` aplikasi kamera bawaan macet — pakai `-gpu host`.
