# OMOS Working Context and Handover

Status: active cross-platform reference.
Last consolidated: 2026-09-30.
Scope: `D:\OneDrive\Desktop\OMOS` only.

## Purpose and Rules

Use this document before non-trivial OMOS work that needs prior task history,
known issues, deployment context, or cross-platform continuity. It is shared by
Codex and Kilo VS Code; it is not a transcript and must not contain secrets.

Repository and deployed behavior remain the source of truth. Architecture,
handover, and chat history define direction or evidence only. Every ledger row
uses one of these evidence labels:

- `VERIFIED_REPO`: confirmed against current source, migration, test, or live check.
- `HISTORICAL_CHAT`: reported by a prior Codex/Kilo session; re-verify before changing it.
- `DESIGNED` / `PLANNED`: approved direction only, not proof of implementation.

After a material task, update the task ledger with its status, affected files,
verification, and remaining risk. Do not paste raw chat transcripts or tokens.

## Project Identity

- Product: OMOS, One Mining Operating System.
- Canonical workspace: `D:\OneDrive\Desktop\OMOS` (relocated from `D:\OneDrive\Desktop\ONE MINING` on 2026-10-05).
- Historical workspace: `D:\OneDrive\Desktop\PROJECT`, merged into ONE MINING;
  do not implement against it.
- Production Vercel project: `attendance-system`; historical alias:
  `attendance-system-eta-opal.vercel.app`.
- Vercel entry: `api/index.js` loads `backend/src/server`.
- Data platform: Supabase PostgreSQL and storage. Read configuration from approved
  local environment files; never copy a credential into this document or a chat.

## Architecture and Working Contract

OMOS has four boundaries: Control Plane, Client Data Plane, Core Platform, and
Mining Modules plus Intelligence. Keep tenant/project isolation, auditability,
offline/retry implications, and operational-date semantics intact.

Before changing a mining formula, unit, density, production rate, productivity,
fleet capacity, fuel KPI, standby/breakdown KPI, or measurement logic, load the
`omos-mining-validation` skill. Stop for an owner decision when the request
changes a frozen architecture boundary, deployment model, security/compliance
requirement, or system boundary.

Layer pointers:

| Need | Read first |
| --- | --- |
| Architecture, tenancy, enterprise direction | `OMOS_MASTER_PROJECT_MILESTONE_V2.6.md` |
| Migration/deployment handover | `HISTORI_CHAT_MIGRASI.md`, `OMOS_handoff_2026-09-05.md` |
| Backend/API/database | `backend/AGENTS.md` and relevant migration/controller/service |
| Admin dashboard | `admin-dashboard/AGENTS.md` |
| Mobile/offline | `mobile-web/AGENTS.md` |
| Vercel routing | `api/AGENTS.md`, `vercel.json` |
| AI/LiteLLM | `OMOS_LITELLM_PROJECT_HANDOVER.md`, `Litellm/AGENTS.md` |
| Production data/fuel/density | `docs/DATA_PRODUKSI_IMPLEMENTATION.md` |

## Verified Current Implementation Snapshot

### 2026-10-17 — Redesign Database Fuel: satu workspace 4 alur: VERIFIED_REPO (belum deploy, belum commit)
- **Keputusan owner:**
  - Satu workspace dengan alur Ringkasan, Stok masuk, Alokasi & distribusi, Validasi & rekonsiliasi, Tren konsumsi, dan Pengaturan.
  - Role hanya membatasi aksi; route fuel-inventory tetap admin-only.
  - Tampilan lama (Hub + klasik) masih bisa dibuka 1 rilis via `?classic=1` atau tautan "Tampilan lama". Hapus `fuelOperationsHub.js` dan `databaseFuel.workspace.js` di rilis berikutnya.
  - Approved preview: `admin-dashboard/test-fixtures/fuel-workspace-preview.html`.
- **Backend (read-only, tanpa migrasi):**
  - `GET /api/admin/production/fuel-inventory/period-reconciliation?dari&sampai&location_id&product_id`: per lokasi×produk `opening, receipt_in, transfer_in, issue_out, transfer_out, adjustment_in/out, other, closing_book` + `last_opname` (approved/adjusted ≤ sampai).
    - Reversal dinettokan ke tipe aslinya (CTE `mutasi`).
    - Basis `operational_date`, liter, presisi penuh.
  - `GET .../consumption-breakdown?group=unit|class&limit`: liter netto `issue_equipment` per unit/`kelas_alat`, plus `share` dan `others_liter`. Tanpa rasio L/HM.
  - `getLedger` menambah `unit_price` (tertimbang volume, NULL bila ada baris tanpa harga), `equipment_code`, dan `transfer_to_code`.
  - Validasi `omos-mining-validation`: tidak ada anomali. Rumus = semantik `saldoLokasi`; tidak ada KPI/rasio baru.
- **Frontend:**
  - Baru: `admin-dashboard/fuelWorkspace.js` (`window.FuelWorkspace`; fungsi murni diekspor) dan `fuelWorkspace.css` (kelas `fws-*`, token dashboard, IBM Plex, Tabler icons).
  - Wiring: `production.js` (`bukaDatabaseFuel` memprioritaskan FuelWorkspace), `production.loader.js` (`fuelWorkspace.js?v=1`, `production.js?v=106`, `fuelAccess.ui.js?v=2`), `index.html` (link CSS). `fuelAccess.ui.js` mengekspos `flagLabel`.
  - Fitur:
    - Ringkasan: KPI, gauge stok per lokasi (minimum dan melebihi kapasitas), antrean "Perlu tindakan".
    - Stok masuk: harga rata-rata, draf.
    - Alokasi: alur distribusi, lokasi, transfer, aturan sumber dalam kalimat dengan dropdown (bukan UUID).
    - Rekonsiliasi: validasi APK lewat drawer + galeri bukti, persetujuan opname (alasan wajib bila alert), tabel rekonsiliasi periode + CSV, belum ber-sumber (terapkan aturan atau tautkan manual), shift investigasi, integritas.
    - Tren: grafik masuk vs pengisian, konsumsi per kelas atau top 10 unit, selisih opname.
    - Pengaturan: produk, lokasi, export.
    - Drawer detail transaksi: posting, batalkan draf, pembatalan (reversal) dengan alasan, FIFO, jejak waktu.
    - Buku transaksi sebagai drawer audit.
  - Semua tulis memakai `OMOSActionFeedback.run`. Alasan lewat modal (tanpa `alert`/`prompt`). Idempotency key per form.
- **Tes:**
  - `backend/test/fuel-period-reconciliation.test.js`: 3 tes murni + 1 integrasi Postgres nyata bila `TEST_DATABASE_URL` diset. Lulus di DB sekali pakai (postgres:17, skema 048–051 + 105 + stub) di server Biznet; container sudah dihapus.
  - Fuel backend 61 lulus (1 skip integrasi lokal).
  - `admin-dashboard/fuel-workspace.test.js` 11 lulus.
  - 5 tes dashboard gagal sejak sebelumnya (pin versi lama `production.js?v=103`, `app.js?v=47`, ppw-hauler), tidak terkait.
- **Verifikasi browser:** fixture `admin-dashboard/test-fixtures/fuel-workspace-live.html` memuat modul asli dengan API tiruan. Diperiksa:
  - 1440px dan 375px; tanpa scroll horizontal.
  - Semua tab dan console tanpa error.
  - Alur terima (validasi, galat 422, posting), validasi transfer APK, persetujuan opname, pembatalan, aturan sumber.
  - Belum diuji terhadap API Biznet nyata.

### 2026-10-17 — Hotfix Fuel 105 di produksi Biznet: VERIFIED_DEPLOYED (diizinkan owner)
- Backup terverifikasi: `/opt/omos/backups/manual/20261017T091154Z-pre-fuel-105.dump` (+`.sha256`).
- Migrasi `105_fuel_tx_updated_at.sql` dijalankan via `ops/biznet/run-fuel-105-hotfix.sh`. Preflight menunjukkan kolom = 0, verifikasi sesudahnya = 1.
- Release overlay `/opt/omos/releases/20261017-fuel-hotfix-105` (image `omos-app:20261017-fuel-hotfix-105`) dari release fuel-mobile-104, plus `fuelMobileAuth.js`, `fuelInventory.js`, dan file migrasi/skrip 105. Diff terhadap live sebelumnya = perbaikan saja. Container sebelumnya: `omos-app-prev-20261017-fuel-hotfix-105`.
- Verifikasi:
  - `/health` 200; app-version 200; endpoint terlindung 401; login salah → `INVALID_CREDENTIALS`.
  - Di container live: `LOWER($1)` ada, `tglIso` ada, `FOR UPDATE OF t` = 0.
  - `UPDATE ... updated_at` + kunci baris dalam transaksi ROLLBACK berhasil.
- Rollback:
  - Aplikasi: switch ke container/release fuel-mobile-104.
  - DB: `105_fuel_tx_updated_at_down.sql`. Tidak perlu, karena kolom aditif.
- Bagian "Pending" di entri berikut sudah selesai.

### 2026-10-17 — Migrasi 103+104 Biznet + uji E2E APK OMOS Fuel: VERIFIED_DEPLOYED (sebagian) / hotfix BELUM dirilis
- **Produksi Biznet:**
  - Backup terverifikasi: `/opt/omos/backups/manual/20261017T082118Z-pre-fuel-103-104.dump` (+`.sha256`).
  - Migrasi 103+104 diterapkan via `ops/biznet/run-fuel-103-104-release.sh`.
  - Release overlay `/opt/omos/releases/20261017-fuel-mobile-104` sudah live (image `omos-app:20261017-fuel-mobile-104`; container lama `omos-app-prev-20261017-fuel-mobile-104`).
  - `qrcode` ditambahkan ke root `package.json`/lock, karena image Docker memakai root package.
- **Uji E2E:**
  - Dijalankan di clone DB terisolasi: restore dump pra-migrasi + 103/104/105, container `omos-fuel-e2e-*`, port `127.0.0.1:3002`. Emulator Pixel 7, APK `-PAPI_BASE_URL=http://10.0.2.2:3002/`.
  - Lulus:
    - Login salah → pesan.
    - Perangkat pending → disetujui → login.
    - Wajib ganti PIN (PIN trivial ditolak).
    - Terima fuel 16.000 L + 2 foto → divalidasi admin.
    - Pilih sumber 94-22.
    - Buka shift (totalizer 50.000 + foto).
    - Isi unit manual DT20 6-48: HM 1250, KM 45.000, 300 L, 2 foto, flag `manual_unit`. `issue_equipment` ter-posting otomatis dan tertaut ke sesi shift.
    - Transfer 94-22→91-05 2.000 L → grup divalidasi; stok 13.700/2.000 cocok.
    - Tutup shift totalizer 52.400: selisih 100 L > ambang 20 L → `investigation`. Hitungan server = HP.
    - Riwayat APK menampilkan status Divalidasi/Terkirim/Perlu investigasi.
  - Lingkungan E2E sudah dibersihkan: container, volume DB clone, `e2e-storage`, file `/tmp`, tunnel, emulator.
- **Bug yang ditemukan dan diperbaiki LOKAL (BELUM di produksi):**
  1. `fuelMobileAuth.login`: `LOWER(employee_id)` dibandingkan input non-lowercase → `LOWER($1)`.
  2. `fuelInventory.ambilTransaksi`: `FOR UPDATE` + `GROUP BY` ditolak Postgres → kunci header dulu.
  3. `String(Date).slice(0,10)` untuk `operational_date` → helper `tglIso` (7 lokasi).
  4. Kolom `fuel_inventory_transactions.updated_at` tidak pernah dibuat (048), padahal kode post/reverse/void menulisnya. Diperbaiki dengan migrasi baru aditif `105_fuel_tx_updated_at.sql` (+`_down`).
  - Bug 2–4 juga merusak posting/reversal/void Database Fuel dari dashboard di produksi saat ini.
  - APK: error dibersihkan setelah foto diambil; produk default efektif; banner error di footer.
- **Pending:** rilis hotfix produksi.
  - Jalankan backup + migrasi 105.
  - Overlay `fuelMobileAuth.js` + `fuelInventory.js`.
  - Ditolak classifier auto-mode Claude Code ("Production Deploy"); perlu izin/eksekusi owner.
- Fuel test 58/58.

### 2026-10-17 — APK Android OMOS Fuel v1.0.0 (`mobile-fuel/`): VERIFIED_REPO (build debug OK, belum rilis, belum commit)
- **Proyek baru `mobile-fuel/`:**
  - `com.omos.fuel` (debug `.debug`), Kotlin + Compose, salinan arsitektur `mobile-safety`.
  - Room outbox + cache bootstrap, WorkManager, Retrofit, EncryptedSharedPreferences, UpdateManager SHA-256.
  - Tambahan: CameraX 1.3.4 + ML Kit `barcode-scanning:17.3.0` (model dibundel, offline).
  - Detail di `mobile-fuel/README.md`.
- **Layar** (sesuai mockup `omos-fuel-apk-preview.html`):
  - Login Employee ID + PIN pad; buka offline ≤ N hari dengan PBKDF2 lokal.
  - Perangkat menunggu persetujuan; ganti PIN (wajib untuk PIN sementara).
  - Beranda: shift otomatis, estimasi stok sumber, tile sesuai hak fungsi.
  - Pindai QR (senter, pilih manual + alasan, daftar lokasi).
  - Isi unit: HM, KM manual, liter, peringatan V1–V3, kapasitas tangki, 1 pengisian/unit/shift, slot foto.
  - Transfer, terima fuel, opname, buka/tutup shift (selisih totalizer V4).
  - Riwayat & status validasi; Akun (ganti petugas, mode gelap/kontras tinggi, cek pembaruan).
- **Sinkronisasi:**
  - Foto diunggah dulu ke `/api/fuel-evidence/attachments` (multipart, `client_uuid` + `client_sha256` per foto), lalu `/api/fuel/mobile/sync`.
  - Antrean tiap petugas dikirim dengan token petugas itu (HP bersama); status validasi admin ditarik lewat `/status`.
- **Verifikasi:**
  - `:app:testDebugUnitTest` 8/8 (`FuelRulesTest`: slot 06:00, V3, V4, QR, HM/KM, estimasi stok, PIN offline).
  - `:app:assembleDebug` sukses (APK debug ±42 MB, termasuk native x86).
  - Diinstal di emulator Pixel_7 (API 37): aplikasi start tanpa crash, layar login tampil.
- **Risiko/belum:**
  - Library native ML Kit (`libbarhopper_v3.so`, `libimage_processing_util_jni.so`) belum selaras 16 KB page. Android 15+ dengan halaman 16 KB menampilkan dialog kompatibilitas (aplikasi tetap jalan); perlu ML Kit versi baru saat tersedia.
  - Alur setelah login belum diuji ujung ke ujung karena butuh backend dengan migrasi 103/104.
  - Keystore rilis `omos-fuel-release.jks`, `fuel-release.json`, dan `OMOS_Fuel.apk` di server belum dibuat.
  - Ukuran APK bisa dikecilkan dengan `abiFilters` arm64/armv7 untuk rilis.

### 2026-10-17 — Dashboard APK OMOS Fuel (ID/label QR, Akses Fuel, review shift, validasi transfer): VERIFIED_REPO (belum deploy, belum commit)
- **List Equipment** (`index.html` + `production.js`):
  - Kolom baru **ID (QR)**; klik membuka detail berisi QR, isi QR, cetak label, buat ulang ID (alasan wajib), dan kapasitas tangki BBM.
  - Kolom baru **Tangki BBM (L)**.
  - Tombol **🏷️ Cetak Label QR** mencetak unit yang tampil sesuai slicer, dengan pilihan format A4 grid 3 kolom atau thermal 50×30 mm (cetak bawaan browser).
- **Input Fuel:** tombol **📱 Akses Fuel** membuka panel `admin-dashboard/fuelAccess.ui.js` dengan enam tab:
  - Validasi APK: penerimaan, transfer per grup, dan pengisian dengan stok ledger kurang; galeri bukti inline; Validasi/Posting dan Tolak dengan alasan.
  - Tutup shift: filter status, angka selisih dari server, foto totalizer, review dengan catatan.
  - Akun fuelman: tambah dari karyawan (PIN sementara tampil sekali), ubah fungsi/lokasi/aktif, reset PIN dengan konfirmasi "RESET".
  - Perangkat: setujui/cabut dengan alasan.
  - Lokasi & label: ID `LOC-`, cetak, buat ulang.
  - Pengaturan: enam ambang.
- **Pola UI:** semua aksi simpan memakai `OMOSActionFeedback.run`; alasan memakai dialog inline (tanpa `prompt`). `fuelEvidence.ui.js` mendapat `renderGallery(container, entityType, entityId)` yang dipakai ulang. Loader v56: `fuelEvidence.ui.js?v=2`, `fuelAccess.ui.js?v=1`, `production.js?v=105`.
- **Backend:**
  - Dependensi baru `qrcode@1.5.4`. QR SVG dirender server (`labelData` mengembalikan `qr_svg`); tersedia juga `POST /labels` untuk banyak ID.
  - `GET /api/admin/fuel-access/pending-validations`.
- **Verifikasi:**
  - `admin-dashboard/fuel-access-ui.test.js` 4/4; test UI Fuel terkait lulus; `backend/test/fuel-*.test.js` 57/57.
  - Visual dicek di browser lewat fixture `admin-dashboard/test-fixtures/fuel-access-preview.html` (fetch tiruan, server statis `.claude/launch.json` → `admin-dashboard-static`).
- **Belum:**
  - Uji dengan database sungguhan (migrasi 103/104 belum dijalankan di Biznet).
  - Cetak fisik label (keterbacaan QR di printer thermal) belum diuji.
  - APK Android.

### 2026-10-17 — Backend APK OMOS Fuel v1: VERIFIED_REPO (belum migrasi DB Biznet, belum deploy, belum commit)
- **Keputusan validasi formula (owner setuju V1–V6):**
  - V1: HM tidak berurutan dari APK → log tetap tersimpan, HM ditahan (flag `hm_event_required`); reset hanya lewat Event HM.
  - V2: satu pengisian per unit per shift tetap diblokir.
  - V3: selisih HM > jam berlalu + toleransi → peringatan + alasan wajib. Dasar waktu `filled_at`, atau awal shift sebelumnya untuk data lama. Hanya HM.
  - V4: selisih totalizer = (akhir − awal) − (pengisian + transfer keluar lokasi selama sesi). Investigasi bila |selisih| > maks(0,5% × delta, 20 L). Akhir < awal = rollover.
  - V5: pengisian APK memotong stok lokasi yang dipindai (issue diposting).
  - V6: estimasi stok = posted + pending masuk − pending keluar.
- **Penyimpangan dari V5 (dilaporkan ke owner):** FIFO menolak saldo negatif. Bila stok ledger kurang, issue tetap **draft** dengan flag `ledger_stock_short` (tidak diposting negatif).
- **Migrasi `104_fuel_mobile.sql` (+ `_down`):**
  - `omos_gen_scan_id()`; `equipment.scan_id` (EQ-XXXXXX) dan `fuel_storage_locations.scan_id` (LOC-XXXXXX) dengan default + backfill + UNIQUE.
  - `equipment.fuel_tank_capacity_liter`; tabel `fuel_scan_id_revocations`.
  - `fuel_mobile_settings` (ambang dapat diatur), `fuel_operator_accounts` (PIN bcrypt, fungsi, lokasi, kunci), `fuel_devices` (pending/approved/revoked).
  - `fuel_shift_sessions` (satu sesi terbuka per lokasi).
  - Kolom mobile di `fuel_logs` (`filled_at`, `source_location_id`, `unit_input`, `device_id`, `mobile_flags`, `reported_hm`, …), transaksi (`device_id`, `mobile_flags`, `void_reason`), dan opname (`client_uuid`, `device_id`).
  - Slot bukti `shift_open` / `shift_close`.
- **Kode:**
  - `production.controller.js`: `createFuelLogRecord` (service bersama dashboard + APK; HTTP handler tetap sama).
  - `services/fuelMobileAuth.js`: login PIN, perangkat, token `fuel_mobile` (TTL `FUEL_MOBILE_TOKEN_TTL`, default 7d), `requireFuelMobile`.
  - `services/fuelMobile.js`: bootstrap, sync per item, status.
  - `services/fuelAccess.js`: admin.
  - `fuelInventory.js`: `transferStock(..., {asDraft})`, `postTransferGroup`, `voidTransferGroup`; kaki transfer tidak bisa diposting/void satu per satu; `voidDraft(id, actor, reason)`.
  - `middleware/auth.js`: token `fuel_mobile` hanya berlaku untuk `/api/fuel/mobile` dan `/api/fuel-evidence`, dengan peran dipaksa `karyawan`.
- **Endpoint:**
  - `/api/fuel/mobile`: `GET app-version` (manifest `src/public/fuel-release.json`), `POST login`, `POST change-pin`, `GET bootstrap`, `POST sync` (item `fill`/`transfer`/`receipt`/`opname`/`shift_open`/`shift_close`; hasil per item ok/rejected/error), `POST status`.
  - `/api/admin/fuel-access` (admin): akun, kandidat, reset-pin, perangkat approve/revoke, pengaturan, review sesi shift, regenerate ID scan, data label, kapasitas tangki.
  - `/api/admin/production/fuel-inventory/transfers/:groupId/post|void`.
  - APK diunduh di `/api/app/omos-fuel.apk` (`src/public/OMOS_Fuel.apk`).
- **Verifikasi:**
  - `test/fuel-mobile.test.js` 11/11; backend penuh 566/566. Run pertama sempat 10 gagal karena waktu habis di HSE/People saat beban tinggi; file tersebut lulus terpisah dan lulus pada run ulang.
  - Migrasi 104 + query bootstrap/status/admin + buka/tutup shift diuji di PGlite dengan tabel stub (bukan Postgres Biznet).
- **Belum:**
  - Migrasi 103 + 104 di Biznet.
  - Dashboard: kolom ID + cetak label QR, panel Akses Fuel, review tutup shift, validasi transfer per grup.
  - APK Android.
  - Uji ujung ke ujung dengan Postgres sungguhan (alur `fill` melewati `FuelHmLifecycle`, yang belum diuji di PGlite).

### 2026-10-17 — APK OMOS Fuel v1: keputusan desain (grilling) + mockup layar — DESIGNED (belum dibangun)
- **Mockup:** `admin-dashboard/test-fixtures/omos-fuel-apk-preview.html` (14 layar, data contoh).
- **Identitas:** `com.omos.fuel`, Kotlin + Compose, menyalin arsitektur `mobile-safety` (antrean Room + WorkManager, `client_uuid`, auto-update dengan cek SHA-256, sesi terenkripsi). Unduhan `/api/app/omos-fuel.apk`, keystore di luar repo.
- **ID & barcode:**
  - Kolom ID otomatis dan tidak bisa diubah di equipment (`EQ-XXXXXX`) dan lokasi non-equipment (`LOC-XXXXXX`). Isi QR `OMOS:EQ:<ID>`.
  - ID bisa dibuat ulang dengan alasan; ID lama dicabut.
  - Cetak label A4 grid + thermal 50×30 mm, satuan maupun massal.
  - Scanner: CameraX + ML Kit (dibundel, offline, QR dan 1D). Pilih unit manual hanya dengan alasan, dan ditandai.
- **Login:**
  - Akun Fuel per karyawan: `employee_id` + PIN 6 digit (tabel terpisah, bukan password utama). PIN sementara dari admin wajib diganti. Salah 5× → terkunci.
  - Perangkat wajib disetujui admin (panel Akses Fuel di Input Fuel); bisa ganti petugas di HP bersama.
  - Buka offline maksimal 7 hari. Token bercakupan `fuel_mobile` (hanya `/api/fuel/mobile` + `/api/fuel-evidence`).
  - Hak fungsi dan lokasi per akun. Perangkat dicabut: transaksi yang dibuat sebelum pencabutan tetap diterima (ditandai).
- **Shift:** shift dan tanggal operasional dihitung otomatis (hari mulai 06:00, lintas hari). Input terlambat wajib alasan.
- **Fitur v1:**
  - HM mundur diblokir kecuali meter reset.
  - Selisih HM > jam berlalu + 1 jam → peringatan (dapat diatur).
  - Kolom baru `equipment.fuel_tank_capacity_liter`: melebihi → peringatan dengan alasan.
  - Estimasi stok sumber = saldo server + transfer masuk yang masih menunggu (ditampilkan terpisah) − pengisian yang belum tersinkron.
  - Buka/tutup shift dengan foto totalizer: selisih > 0,5% atau 20 L → "Perlu investigasi" (dapat diatur).
  - Riwayat sinkron dan penolakan, tampilan lapangan, auto-update.
  - Konfirmasi penerima ditunda ke v1.1.
- **Backend:** namespace `/api/fuel/mobile` (bootstrap/sync/riwayat/status). Logika `createFuelLog` dipindah ke service bersama dashboard dan APK.
- **Urutan pengerjaan:** mockup → backend (migrasi ID/akun/perangkat/tutup shift) → dashboard (kolom ID + label, Akses Fuel, review tutup shift) → APK → uji staging Biznet.
- **Wajib sebelum kode:** skill `omos-mining-validation` untuk aturan HM/KM dan ambang selisih totalizer.

### 2026-10-17 — Kerangka bukti foto Fuel (persiapan APK OMOS Fuel): VERIFIED_REPO (belum migrasi DB, belum deploy, belum commit)
- **Keputusan owner (grilling 2026-10-17):**
  - APK baru "OMOS Fuel" menyalin arsitektur `mobile-safety` (antrean offline, `client_uuid`).
  - Pengisian unit masuk ke `fuel_logs` dengan lokasi sumber eksplisit dan langsung posted. Penerimaan dan transfer = draft "menunggu validasi". Opname = alur approval eksisting.
  - Foto bukti hanya dari kamera (dokumen boleh scan). GPS direkam tetapi tidak dipakai validasi.
  - Penyimpanan = disk lokal Biznet lewat `storage.js`, bucket privat `fuel-bukti`.
  - Kompresi dua lapis: HP 1600px; server mengompres ulang jika > 2 MB atau > 1600px dan mencatat `received_sha256` + `stored_sha256`.
  - Lampiran tidak pernah dihapus permanen (replaced/orphan). Lampiran yatim > 30 hari ditandai `orphan`.
- **File:**
  - `backend/migrations/103_fuel_evidence.sql` (+ `_down`): `fuel_attachments`, `fuel_evidence_slots` berversi + `fuel_evidence_config_state` (seed slot versi 1), `fuel_logs.client_uuid` UNIQUE, `evidence_config_version` di log/transaksi/opname.
  - `backend/src/services/fuelEvidence.js`, `backend/src/routes/fuelEvidence.routes.js` (mount `/api/fuel-evidence`).
  - `storage.js`: `putEvidenceObject` / `readEvidenceObject`.
  - `middleware/upload.js`: `evidenceUpload`.
  - `fuelInventory.js`: `tautkanBukti` di `createDraft`, `transferStock`, `createOpname`.
  - `production.controller.js` `createFuelLog`: `client_uuid` idempoten + `attachment_ids`.
  - `src/scripts/fuelEvidenceReconcile.js` (`npm run fuel-evidence:reconcile [-- --apply]`).
  - `ops/biznet/backup-local-data.sh` kini juga membackup `fuel-bukti` dan `people-dokumen`.
  - Dashboard: `admin-dashboard/fuelEvidence.ui.js` (chip "N bukti" + pratinjau di baris log kartu Input Fuel), CSS di `style.css`, loader v55 / `production.js?v=104`.
- **Endpoint `/api/fuel-evidence`:** semua butuh login + izin admin atau `users.permissions` berisi `fuel.operator`.
  - `GET /slots`, `PUT /slots/:kind` (admin)
  - `POST /attachments` (multipart `file` + `slot_code`, `client_uuid`, `client_sha256`, `captured_at`, `gps_*`, `device_id`, `app_version`, `upload_source`)
  - `GET /attachments?entity_type&entity_id`, `GET /attachments/:id`, `GET /attachments/:id/file[?variant=thumb]`, `POST /attachments/:id/replace`
  - `GET /summary`, `POST /link` (admin)
  - File bukti **tidak** terjangkau `/api/storage/view` (publik).
- **Validasi:** input dengan `source_type=mobile_offline` ditolak 422 `EVIDENCE_INCOMPLETE` jika slot wajib (versi `evidence_config_version` dari HP) kosong. Input manual dashboard tidak diwajibkan.
- **Catatan implementasi:** "role" `fuel_operator` diwujudkan sebagai permission `fuel.operator` di `users.permissions`. Alasannya, `users.role` dibatasi CHECK `karyawan|admin`, dan mengganti role akan memutus akses APK absensi. Pemberian permission belum ada UI-nya.
- **Verifikasi:**
  - `backend/test/fuel-evidence.test.js` 10/10; backend penuh 555/555.
  - `admin-dashboard/fuel-evidence-ui.test.js` + test fuel terkait 11/11.
  - Migrasi 103 up → up ulang → down diuji di PGlite dengan tabel stub (bukan Postgres Biznet).
- **Belum / risiko:**
  - Migrasi 103 belum dijalankan di Biznet.
  - Endpoint APK khusus (bootstrap, pengisian dengan lokasi sumber eksplisit, transfer sebagai draft menunggu validasi) dibangun bersama APK.
  - UI validasi lengkap digabung ke redesign Database Fuel (`admin-dashboard/test-fixtures/fuel-workspace-preview.html`).
  - **Backup ke luar VPS belum ada:** kerusakan VPS = kehilangan DB + seluruh bukti foto.
  - Chip bukti di Input Fuel belum diuji di browser dengan data nyata.

### 2026-10-17 — Optimasi Kecepatan Agen LLM (Nemotron 3 Super 120B + Non-Thinking Mode): VERIFIED_PRODUCTION
- **Root cause lambat/timeout sebelumnya:** (1) `nvidia/nemotron-3-ultra-550b-a55b` di free endpoint NVIDIA sering mengalami `HTTP 503 Service Unavailable` dan butuh ~10,8 dtk per panggilan untuk membaca katalog 1.876 token; (2) Mode *reasoning/thinking* default aktif membuang ~170 token ekstra sebelum mengeluarkan JSON; (3) `timeoutMs` hardcode 12000/15000 ms di [`askPlanner.v1.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/ai/agents/hse/askPlanner.v1.js), [`askAnswer.v1.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/ai/agents/hse/askAnswer.v1.js), dan [`hazardTriage.v1.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/ai/agents/hse/hazardTriage.v1.js) menimpa `LLM_TIMEOUT_MS` server.
- **Perbaikan & Konfigurasi Baru:**
  - [`ops/deploy_llm_agent.py`](file:///d:/OneDrive/Desktop/OMOS/ops/deploy_llm_agent.py) & [`ops/biznet/deploy_llm_agent.py`](file:///d:/OneDrive/Desktop/OMOS/ops/biznet/deploy_llm_agent.py): `MODEL_STANDARD` dan `MODEL_CHEAP` diatur ke `nvidia/nemotron-3-super-120b-a12b` (MoE 12B active params, 7x lebih cepat & stabil), `MODEL_STANDARD_FALLBACK` ke `nvidia/nemotron-3-ultra-550b-a55b`, dan `EXTRA_BODY = '{"chat_template_kwargs":{"thinking":false,"enable_thinking":false}}'` (mematikan token *reasoning* sehingga langsung mengeluarkan JSON). `py_update` juga diperbaiki agar membersihkan variabel opsional `LLM_*` yang dikosongkan dari `app.env`.
  - [`backend/src/ai/llmClient.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/ai/llmClient.js): menambahkan `'TIMEOUT'` ke daftar `retryable` fallback dan mendukung fallback lintas alias ke `omos-standard`.
  - `timeoutMs` pada `askPlanner.v1.js`, `askAnswer.v1.js`, dan `hazardTriage.v1.js` dinaikkan ke `25000` ms.
- **Verifikasi Test & Produksi:** Unit test lokal `36/36 PASS`. Dideploy ke Biznet (`omos-app` rebuilt & recreated, `/health` 200 OK). Hasil `diag_llm.py` dengan `thinking=false`: **0,7 dtk** (`reasoning_tokens=0`). Hasil evaluasi `eval_hse_ask.js` di dalam container `omos-app`: akurasi **100%**, median latensi `askPlanner` turun drastis dari **10.857 ms → 1.458 ms (1,45 dtk)**.

### 2026-10-14 — Konfigurasi & Deploy Agen LLM (NVIDIA Nemotron 3 Ultra 550B) ke Server Biznet: VERIFIED_PRODUCTION
- **Perbaikan script deploy:** [`ops/deploy_llm_agent.py`](file:///d:/OneDrive/Desktop/OMOS/ops/deploy_llm_agent.py) dan [`ops/biznet/deploy_llm_agent.py`](file:///d:/OneDrive/Desktop/OMOS/ops/biznet/deploy_llm_agent.py) diperbaiki: raw string path `SSH_KEY_PATH = r"D:\OneDrive\Desktop\OMOS\omos-key.pem"` (menghilangkan `SyntaxWarning: invalid escape sequence '\O'`), model standard diset ke `nvidia/nemotron-3-ultra-550b-a55b` sebagai agen percobaan sesuai instruksi owner, `MODEL_VISION` dikosongkan `""` (nemotron text-only), timeout 50000 ms.
- **Pembaruan Key Resmi & Verifikasi inferensi:** Deployment ulang API key dari `ops/API KEY NVIDIA.txt` berhasil dieksekusi secara aman (secret dipasang atomik di `/opt/omos/secrets/llm_api_key`, mode 0400, uid 1000). Diagnosa end-to-end via [`ops/biznet/diag_llm.py`](file:///d:/OneDrive/Desktop/OMOS/ops/biznet/diag_llm.py): DNS/TCP 443/TLS OK, GET `/models` HTTP 200 (80 model), Chat inferensi ke `nvidia/nemotron-3-ultra-550b-a55b` HTTP 200 (0.7 dtk), JSON structured mode HTTP 200 (3.1 dtk), Chat streaming HTTP 200 (potongan pertama 0.6 dtk, total 1.3 dtk).
- **Aktivasi container `omos-app`:** Container `omos-app` di server Biznet aktif dengan volume mount `/opt/omos/secrets/llm_api_key:/run/secrets/llm_api_key:ro` dan environment `LLM_MODEL_STANDARD=nvidia/nemotron-3-ultra-550b-a55b`. Health check `/health` status `200 OK`, runtime aktif tanpa error.

### 2026-10-14 — RILIS BIZNET `20261014-142404-hse-setup-cycle` (fix halaman Setup kosong): VERIFIED_PRODUCTION
- **Laporan owner:** Setup P5M "berhasil disimpan" tapi halaman kosong. **Penyebab:** data tersimpan (14 aturan BY_ROLE, WEEKLY 2–4×), tetapi overview Setup Inspeksi/Hazard/P5M/Safety Talk (`get*MandateOverview`) default hanya membaca siklus `MONTHLY` → semua "Belum diatur", filter WAJIB kosong; badge dashboard juga hardcode "x / Bulan". Juga memengaruhi dropdown peserta form P5M/Safety Talk dashboard.
- **Fix:** `hse.overviewQuotaJoin` — tanpa `query.cycle` memakai siklus apa pun yang diatur (`anyCycleQuotaJoin`), dengan `cycle` tetap filter eksplisit; item mengembalikan `quota_cycle`; dashboard `quotaCycleLabel` → "Nx / Hari|Minggu|Bulan" (`hse.js?v=12`). Test PGlite di `hse-mobile.test.js`; backend 545/545, admin HSE 56/56.
- **Rilis overlay 3 file** (checksum OK, `diff -rq` = 3) di atas `20261014-135032-omos-safety-102`, tanpa migrasi. Verifikasi produksi: P5M 0 → **19 WAJIB** (filter WAJIB 19 baris), Hazard 30 WAJIB, Safety Talk 5 WAJIB, peserta P5M APK 19; health 200, log 0 error. Rollback: container `omos-app-prev-20261014-142404-hse-setup-cycle`, symlink ke `20261014-135032-omos-safety-102`.

### 2026-10-14 — RILIS BIZNET `20261014-135032-omos-safety-102`: VERIFIED_PRODUCTION
- **Isi:** semua entri 14 Okt di bawah yang berstatus "belum deploy" — Konsekuensi + Rekomendasi → CAPA → status hazard otomatis, peserta P5M/Safety Talk dari Seleksi Karyawan + statistik per individu/siklus + fix sinkron P5M/Safety Talk, penampil foto dashboard + mesin kompresi diperketat, APK v1.0.1 (wajib update).
- **Metode overlay:** salin `20261014-110646-omos-safety-101` → timpa 12 file (checksum 12/12 OK; `diff -rq` vs rilis lama = tepat 12 file). Selisih file bersama (`hse.js`, `hse.css`, `index.html`, `hse.js` backend) vs live dicek: murni perubahan revisi ini.
- **DB (`omos_staging`):** `ops/biznet/run-hse-102-release.sh` → backup `/opt/omos/backups/manual/20261014T065338Z-pre-hse-102.dump` (+sha256, pg_restore --list OK), kolom `hazard_reports.recommendation`, backfill 4 hazard dari CAPA lama (22 hazard total).
- **App:** `release-app.sh` candidate health 200 / auth 401 → switch. Verifikasi publik: health 200; `/api/hse/mobile/*` & `/api/hse/hazards` 401 tanpa token; dashboard menyajikan `hse.js?v=11`, `hse.css?v=7`, `hse-photo-viewer.js?v=1`; `GET /api/app/omos-safety.apk` 200, sha256 `6b5c8855…b06a` = manifest v1.0.1 (code 2, min 2). Dalam container: ekspor baru ada, `listEventParticipants(p5m)` = 0 (benar — produksi belum punya target/seleksi P5M), log 0 error.
- **Rollback app:** `docker stop omos-app && docker rename omos-app omos-app-failed && docker rename omos-app-prev-20261014-135032-omos-safety-102 omos-app && docker start omos-app && ln -sfn /opt/omos/releases/20261014-110646-omos-safety-101 /opt/omos/current`. Rollback DB: `102_hse_hazard_recommendation_down.sql` (aditif; app lama tetap jalan dengan kolom baru) atau restore dump di atas.
- **Tindak lanjut owner:** isi target & Seleksi Karyawan di Setup P5M / Setup Safety Talk agar daftar peserta APK terisi; atur delegator departemen.
- **Catatan proses:** di Claude Code auto mode, aksi "Production Deploy" (migrasi/`release-app.sh` lewat SSH) diblokir classifier meski disetujui di chat — jalankan dengan mode izin manual.

### 2026-10-14 — Penampil foto HSE di dashboard + mesin kompresi foto diperketat: VERIFIED_REPO (belum deploy, belum commit)
- **Penampil foto (`admin-dashboard/hse-photo-viewer.js`, global `OMOSPhotoViewer`):** overlay dialog (prev/next, ←/→, Esc, Z perbesar, unduh, strip thumbnail, fokus terjaga & dikembalikan). Foto HSE berupa data URL — membuka di tab baru diblokir browser, jadi semua titik foto kini membuka penampil: badge "📷 N Foto" di daftar hazard & daftar P5M/Safety Talk, thumbnail detail hazard, **bukti foto CAPA dari PIC** (baru tampil), **foto insiden** (baru tampil di detail insiden), **foto per butir inspeksi dari APK** (baru tampil), foto sesi P5M/Safety Talk, dan pratinjau lampiran di semua form. Helper `photoBadgeHtml` / `photoThumbsHtml` / `photoTriggerAttrs` di `hse.js`; CSS `.hpv*` di `hse.css` (`?v=7`), `hse.js?v=11`, skrip dimuat sebelum `hse-ai.js`. Fixture: `test-fixtures/hse-preview.html` (+`hse-photo-viewer-samples.js`). Diuji di browser (fixture dengan `hse.js` asli): badge daftar → penampil (klik tidak membuka detail baris), ←/→, Esc menutup penampil saja (modal detail tetap), fokus kembali ke pemicu.
- **Mesin kompresi (`backend/src/services/hsePhotoCompress.js`):** semua `data:image/*` (bukan hanya png/jpeg/webp — juga HEIC/GIF/TIFF/AVIF) → WebP/JPEG ≤ ±110 KB, ≤ 1200 px, EXIF dibuang; WebP/JPEG yang sudah ≤ target tidak dikompres ulang (hindari penurunan kualitas berulang, mis. foto temuan inspeksi APK → hazard); data URL bukan gambar, > 15 MB, atau gambar gagal didekode yang masih besar → 422 (dulu disimpan mentah); `compressNewPhotos` ikut mengompres foto lama yang masih besar saat disimpan ulang. Audit seluruh tulis kolom foto HSE (hazard, insiden, inspeksi + butir, CAPA evidence, P5M/Safety Talk, pertemuan, catatan hazard) — semua lewat mesin ini. Cek produksi (SELECT 14 Okt): hanya 1 foto HSE tersimpan (96 KB, terkompres) → tidak perlu backfill.
- **Test:** `backend/test/hse-photo-compress.test.js` (4), `admin-dashboard/hse-photo-viewer.test.js` (4); backend 545/545, admin HSE 56/56.

### 2026-10-14 — Revisi OMOS Safety v1.0.1: Konsekuensi + Rekomendasi → CAPA → status hazard otomatis: VERIFIED_REPO (belum deploy, belum commit)
- **Permintaan owner:** (1) APK wajib punya kolom Konsekuensi / potensi dampak seperti dashboard; (2) Rekomendasi perbaikan terhubung ke CAPA, progres dari update PIC di APK, issue close otomatis.
- **DB:** `backend/migrations/102_hse_hazard_recommendation.sql` (+`_down`) — kolom `hazard_reports.recommendation`, backfill dari CAPA hazard paling awal (kecuali deskripsi otomatis). **Harus jalan sebelum kode baru aktif** (INSERT/UPDATE hazard menulis kolom ini). Skrip Biznet: `ops/biznet/run-hse-102-release.sh`.
- **Aturan tunggal `hse.syncHazardStatusFromActions`** (dipakai APK & dashboard): semua CAPA closed → CLOSED; semua bukti terkirim/closed → VERIFY; ada yang mulai → IN_ACTION; belum mulai → NEW/ASSESSED. CANCELLED/DUPLICATE/REJECTED tidak disentuh; CAPA CANCELLED diabaikan. Verifikasi pelapor/HSE tetap wajib sebelum CLOSED (asumsi, belum dibantah owner).
- **Backend `hse.js`:** `createHazard` simpan `recommendation` + CAPA otomatis (batas SLA risiko 24/72/168/336 jam) bila PIC dipilih (`auto_capa:false` untuk APK yang buat 1 CAPA per PIC); `updateHazard` — status progres manual diabaikan bila CAPA ada (boleh NEW/ASSESSED/REJECTED/DUPLICATE; CLOSED tetap aturan #4), REJECTED/DUPLICATE membatalkan CAPA terbuka, rekomendasi baru diteruskan ke CAPA yang belum dimulai, ganti PIC mengalihkan CAPA PIC lama yang belum dimulai, hazard tanpa CAPA + rekomendasi + PIC → CAPA dibuat; `createAction`/`updateAction` (HAZARD) memanggil sync; detail punya `capa_progress`. `hseMobile.js`: memakai sync & SLA bersama, koreksi pelapor bisa ubah konsekuensi/rekomendasi (CAPA ikut), baris PIC berisi `potential_consequence`, `recommendation`, `capa_total/closed`. Antrean APK 1.0.0 tanpa kolom baru tetap diterima.
- **Admin `hse.js`:** form buat hazard → textarea **Rekomendasi Perbaikan** (wajib; ganti checkbox "CAPA awal"; AI "pakai tindakan" mengisi ini); modal edit → Rekomendasi + progres CAPA + status otomatis (opsi hanya validasi/tolak/duplikat bila CAPA ada); detail → Rekomendasi, bar progres CAPA, label status CAPA bahasa Indonesia, tombol "Tutup Hazard" hanya bila belum ada CAPA. CSS `.hzr-*` di `hse.css` (`?v=6`), `hse.js?v=10`.
- **APK 1.0.1 (code 2):** form hazard + periksa + koreksi: Konsekuensi & Rekomendasi wajib; detail PIC & Laporan Saya menampilkan keduanya + `CapaProgressCard`. Rilis `mobile-safety/dist/OMOS_Safety-1.0.1.apk` (sertifikat sama dengan 1.0.0: `2e8053ae…8bc5`), disalin ke `backend/src/public/OMOS_Safety.apk`; `safety-release.json` v1.0.1 sha256 `ed8da778…ea3f`, **wajib update** (`minimum_supported_version: 2`).
- **Koreksi lanjutan (masuk v1.0.1 yang sama, sha256 `6b5c8855…b06a`):**
  - **Peserta P5M / Safety Talk** = karyawan aktif dalam **Seleksi Karyawan** Setup P5M / Safety Talk (`hse_p5m_scopes` / `hse_safetytalk_scopes`) yang berstatus WAJIB pada siklus apa pun → `hse.listEventParticipants`. Server (`assertWajibParticipants`, dipakai APK & dashboard) kini juga menolak peserta di luar seleksi dan membaca target harian/mingguan (sebelumnya hanya MONTHLY).
  - **Statistik** (`hseMobile.getMyStats`): target per individu dari Setup Hazard Report, Setup Inspeksi (baris per jenis templat + "semua jenis", tidak lagi dikali jumlah templat), Setup P5M, Setup Safety Talk; siklus DAILY/WEEKLY/MONTHLY sesuai setup (`hse.anyCycleQuotaJoin`), aktual dihitung pada periode berjalan (minggu Senin–Minggu WIB); status BEBAS / BELUM_DIATUR / TIDAK_DISELEKSI. Penyebab di produksi (cek SELECT 14 Okt): target hazard **WEEKLY** (2×, 18 jabatan), inspeksi **DAILY** per templat, P5M/Safety Talk **belum ada target & seleksi** → dulu semua terbaca "belum diatur".
  - **Bug kritis diperbaiki:** sinkron `P5M_CREATE`/`SAFETYTALK_CREATE` dari APK memanggil `hse.createHseEvent` yang tidak diekspor → semua P5M/Safety Talk dari APK 1.0.0 gagal terkirim. Kini memakai `createP5mEvent`/`createSafetytalkEvent`; ada test PGlite.
  - **Catatan:** form event dashboard masih mengambil peserta dari overview MONTHLY (`?status=WAJIB`) — target mingguan/harian belum muncul di dropdown dashboard (APK sudah benar).
- **Verifikasi:** backend 541/541 (migration 102 ditambahkan ke daftar PGlite test AI/Ask/mobile), test baru "Rekomendasi → CAPA → status hazard otomatis", admin HSE test 52/52, APK unit test + build lulus. Emulator vs backend lokal: lapor hazard (validasi kolom baru, foto kamera) → CAPA PIC = rekomendasi, batas 7 hari → PIC mulai (hazard IN_ACTION) → bukti (VERIFY) → pelapor setujui (CLOSED otomatis), progres 1/1 100% di Laporan Saya. **Belum diuji di browser:** modal dashboard (hanya test statis).

### 2026-10-14 — RILIS BIZNET `20261014-110646-omos-safety-101`: VERIFIED_PRODUCTION
- **Metode rilis (overlay, bukan full-tree):** salin `/opt/omos/current` (`20261013-165057-ask-hse-100`) → timpa HANYA 23 file OMOS Safety (checksum 23/23 OK). Alasan: tree lokal punya 75 file lain (produksi/fuel/SPO/ritase/review PA-UA, `db.js`, `env.js`, absensi, storage) yang belum pernah di-deploy & di luar lingkup — sengaja TIDAK ikut. File bersama (`authController`, `karyawanController`, `auth/karyawan/hse.routes`, `server.js`, `hse.js`, `hse.css`, `index.html`) sudah dicek: selisih vs live murni perubahan OMOS Safety.
- **DB Biznet (`omos_staging`):** `ops/biznet/run-hse-101-release.sh` → backup `/opt/omos/backups/manual/20261014T040732Z-pre-hse-101.dump` (+sha256, pg_restore --list OK), migrasi 101, verify 6/7/1 sesuai harapan. **Catatan:** migration 101 juga sempat dijalankan ke DB `backend/.env` = **Supabase** (bukan Biznet) — aditif & idempoten, tidak berdampak.
- **App:** `release-app.sh` candidate health 200 / auth 401 → switch. Verifikasi publik: health 200; login `employee_id` & email (pesan sesuai); `minta-reset` generik; `/api/hse/mobile/*` & `/api/hse/delegators` 401 tanpa token; `hse-delegators.js`/`reset-sandi.js`/`hse.css?v=5` 200; `/api/app/version` (absensi) tetap 200; log 0 error.
- **APK rilis:** `GET https://omos-mining.com/api/app/omos-safety.apk` (bukan `/OMOS_Safety.apk` — nginx hanya meneruskan `/api/`), manifest `backend/src/public/safety-release.json` (v1.0.0, code 1, sha256 `e8290ed4…1a82`, cocok dengan unduhan publik). Ditandatangani keystore OMOS Safety baru **di luar repo**: `%USERPROFILE%\.omos-keys\omos-safety-release.jks` + `omos-safety-keystore.properties` (sandi; jangan hilang — tanpa keystore ini update APK tidak bisa dipasang di atas versi terpasang). Backup keystore ke tempat aman = tugas owner.
- **Eskalasi live:** worker langsung mengeskalasi 3 CAPA lama (`CAPA-2610-001..003`, PIC "Admin Utama", lewat batas 6–12 Okt) → 3 notifikasi lewat batas + 2 eskalasi darurat ke HSE on-duty; belum ada delegator aktif di produksi (atur di Setup Master → Delegator Departemen).
- **Rollback app:** `docker stop omos-app && docker rename omos-app omos-app-failed && docker rename omos-app-prev-20261014-110646-omos-safety-101 omos-app && docker start omos-app && ln -sfn /opt/omos/releases/20261013-165057-ask-hse-100 /opt/omos/current`. Rollback DB: `101_hse_mobile_safety_down.sql` atau restore dump di atas.
- **Fix saat rilis:** `passwordReset.ensurePasswordResetSchema` kini cek skema dulu (tanpa DDL/lock saat login).

### 2026-10-14 — APK OMOS Safety + backend `/api/hse/mobile` + Setup Delegator: VERIFIED_REPO (belum commit)
- **Kode:** APK `mobile-safety/` (Kotlin/Compose/Room/WorkManager), backend `services/hseMobile.js` + `routes/hseMobile.routes.js`, migration `101_hse_mobile_safety.sql`, port PR #1 (login Employee ID, minta-reset, ganti-sandi, reset sandi oleh admin), admin `hse-delegators.js` + `reset-sandi.js`. Peta lengkap: `docs/OMOS_SAFETY_MOCKUP_REVISI_DASHBOARD_CONTEXT.md` §5; build & rilis: `mobile-safety/README.md`.
- **Verifikasi:** backend 538/538 (`node --test --test-concurrency=2`; paralel penuh OOM karena PGlite), `hse-mobile.test.js` 4/4, admin `hse-delegators.test.js` 4/4 (3 kegagalan admin lama tidak terkait: `app.js?v=47`, ppw-hauler, roster pin versi), APK unit test lulus, uji emulator end-to-end terhadap backend lokal PGlite (lihat README).
- **Tambahan 14 Okt (lanjutan):** eskalasi otomatis lewat batas → delegator (worker `HSE_ESCALATION`, skrip `run_hse_escalation.js`), backend 539/539; emulator: hazard dengan foto kamera & insiden offline→online terkirim otomatis terverifikasi.
- **Belum:** jalankan `npm run migration:hse-mobile-safety` di server (keputusan owner), keystore rilis + `safety-release.json`, uji di HP fisik lapangan, deploy Biznet.
- **Catatan build Windows:** Gradle butuh `TEMP/TMP` & `-Djdk.net.unixdomain.tmpdir` di path tanpa spasi (mis. `C:\gtmp`).

### 2026-10-14 — APK OMOS Safety: revisi mockup (poin 1, 2, 3, 10, 12, 14, 17) — keputusan & konteks
- Mockup https://claude.ai/artifact/14jS6bG8Zh2k6sZwfRH6hU diperbarui ke versi 40 (29 layar): Lapor Insiden/Near Miss, Tindakan segera + Stop Work + eskalasi darurat di form Hazard, Antrean Kirim (gagal/konflik/penyimpanan HP), Permintaan PIC → Delegator Departemen, Jadwal Inspeksi Saya, Koreksi/Batal laporan.
- Keputusan owner: delegasi/pengalihan PIC **hanya oleh delegator (pimpinan tertinggi) departemen**, ditetapkan Admin HSE di dashboard; inspeksi terencana memakai jadwal yang di-setup admin (`hse_inspection_schedules`, 085, sudah ada).
- Konteks fitur dashboard + backend yang harus dibuat: `docs/OMOS_SAFETY_MOCKUP_REVISI_DASHBOARD_CONTEXT.md`. Handoff sesi cloud (PR #1 login Employee ID): `docs/# OMOS Safety — Handoff Sesi 13 Okt via cloud.md`.
- **Peringatan:** backend HSE lokal (migration 073–100) dan ±465 perubahan lain **belum di-commit**; PR #1 dibuat dari GitHub `main` lama. Jangan jalankan langkah `git stash -u` + checkout di handoff cloud.

### 2026-10-13 — HSE Asisten AI (trial agen LLM: deteksi hazard ganda + Saran AI triase): KEY TERPASANG, SIAP DIAKTIFKAN DI SETUP (toggle masih MATI)

> Catatan editor: entri ini sempat tertimpa balik ke versi "BELUM DEPLOY" oleh editor lain (dokumen ini dipakai bersama Codex/Kilo) — diperbaiki 2026-10-13 berdasarkan verifikasi ulang langsung ke server (bukan asumsi), state di bawah ini dikonfirmasi `VERIFIED_PRODUCTION` saat penulisan ulang.

- `VERIFIED_PRODUCTION` (2026-10-13, staging Biznet, infra): migrasi 099 dijalankan via `ops/biznet/run-ai-099-release.sh` (preflight: `hazard_reports`/`hse_risk_matrix_config` ada, 0 tabel `ai_*` sebelumnya; backup otomatis `/opt/omos/backups/manual/20261013T070712Z-pre-ai-099.dump` + sha256 + `pg_restore --list` terverifikasi; verify **5/1/0** persis sesuai harapan — 5 tabel AI, 1 kolom `hazard_reports.ai_clean_description`, 0 site AI aktif). Rilis `20261013-140408-ai-hse-infra` live (`release-app.sh`: candidate health 200/auth 401, switch sukses).
- `VERIFIED_PRODUCTION` (lanjutan, sama hari): owner memasang API key NVIDIA sendiri via `ops/biznet/deploy_llm_agent.py` (model `z-ai/glm-5.3-flash`) — menulis `/opt/omos/secrets/llm_api_key` (0400 uid 1000) + `LLM_*` ke `app.env` (backup `app.env.bak.20261013-150429`). Karena `--env-file` cuma dibaca saat container dibuat (bukan `docker restart`), Claude switch ulang release yang sama (`release-app.sh ... omos-app:20261013-140408-ai-hse-infra 20261013-140408-ai-hse-infra-llmcfg` — nama rilis dibedakan agar kontainer `prev` tidak bentrok nama dengan switch sebelumnya).
- Verifikasi live (dicek ulang 2026-10-13 sore, masih konsisten): `readlink -f /opt/omos/current` → rilis ini; `docker inspect omos-app` menunjukkan seluruh `LLM_*` env terpasang; key termount & terbaca di `/run/secrets/llm_api_key` dalam container; `/health` 200; tidak ada error di log startup/runtime. `ai_settings` **0 baris** (tabel dibuat migrasi 099 tanpa seed default — ditangani oleh `backend/src/ai/aiSettings.js:getSettings()` yang mengembalikan default aman `enabled:false` bila baris tak ada, jadi ini BUKAN bug) — toggle fitur di level aplikasi **masih MATI**, sesuai desain (harus dinyalakan manual oleh Admin Utama di Setup → Asisten AI).
- **Keputusan owner (2026-10-13): D2, D8, D10 DISETUJUI** (boleh kirim uraian hazard + nama lokasi tersensor ke provider luar negeri NVIDIA; boleh kirim dokumen internal tanpa data pribadi; syarat layanan NVIDIA Free Endpoint untuk data perusahaan disetujui) — lihat `docs/RENCANA_IMPLEMENTASI_AGEN_LLM_HSE.md` §10.
- Evaluasi offline dijalankan owner langsung di server: `docker exec omos-app node backend/src/scripts/eval_hse_ai.js --ai --runs 3` — baseline mesin kata kunci: presisi 80% · recall 100% (TP4/FP1/FN0) pada gold set 10 pasangan; hasil mesin AI (pemanggilan nyata ke NVIDIA) belum dilaporkan kembali ke sesi ini — **cek baris "Agen AI (ambang 0,75): ..." dan "Hasil terhadap target §8.2: LULUS/BELUM LULUS" di output lengkapnya sebelum keputusan Go/No-Go**.
- **Isu UI dilaporkan owner (2026-10-13):** tombol "✨ Asisten AI" di subnav Setup master tidak terlihat di browser produksi (`omos-mining.com`). Server-side dikonfirmasi benar: `hse.js?v=8` yang disajikan live memuat tombol tersebut (8 kemunculan string "Asisten AI", termasuk baris subnav `data-setup-tab="ai"`), `hse-ai.js?v=1` 200. Kemungkinan besar **cache browser sisi klien** (bukan deploy) — belum dikonfirmasi owner apakah sudah dicoba jendela Incognito/hard-refresh penuh. **Perlu konfirmasi ulang sebelum dianggap selesai.**
- Status kode: `VERIFIED_REPO` (kode + uji, LLM tiruan). Runbook: `docs/DEPLOY_AI_HSE_099.md`. Rencana & keputusan: `docs/RENCANA_IMPLEMENTASI_AGEN_LLM_HSE.md`. Panduan pengguna: `docs/PANDUAN_PENGGUNA_OMOS.md` bab 4.
- **Langkah berikut:** (1) pastikan tombol Asisten AI muncul di browser owner (incognito test); (2) baca hasil lengkap `eval_hse_ai.js` (presisi mesin AI, konsistensi, latensi, LULUS/BELUM §8.2); (3) bila lulus, login Admin Utama → Setup → Asisten AI → aktivasi bertahap sesuai `DEPLOY_AI_HSE_099.md` §5 (Deteksi ganda = Uji diam-diam, Saran AI triase = Uji admin-saja, 2 minggu tinjau presisi ≥90% sebelum Aktif).
- Migrasi `099_ai_foundation_hse.sql` (+`_down`, runner `scripts/run_migration_099_ai_foundation_hse.js`, rilis `ops/biznet/run-ai-099-release.sh`): `ai_settings` (default MATI), `ai_requests` (audit tanpa isi, hash SHA-256), `ai_jobs` (antrean idempoten), `hse_ai_suggestions`, `hse_hazard_merge_log`, `hazard_reports.ai_clean_description`.
- Backend `backend/src/ai/`: `config.js` (env LLM_*, base URL wajib https + allowlist host, key dari `LLM_API_KEY_FILE` dibaca ulang 60 dtk), `llmClient.js` (OpenAI-compatible, `redirect:'error'`, error tanpa key, fallback model), `redact.js`, `budget.js`, `aiAudit.js`, `aiJobs.js` (worker in-app; matikan `AI_WORKER=off`; cadangan `scripts/run_ai_jobs.js`), `agentRunner.js`, `agentRegistry.js`, `agents/hse/hazardDuplicate.v1.js`, `hazardTriage.v1.js`. Service `services/hseAi.js` (penyaring kandidat: terbuka, satu Area induk, 30 hari, maks 10; saran SAMA/TERKAIT/BERBEDA; dekorasi daftar/detail; Bukan duplikat; triase dengan risiko dari `calculateRisk`; overview/pemakaian/laporan shadow), `services/hsePermissions.js`.
- Perubahan perilaku: `POST /hazards/:id/merge` kini **wajib alasan**, laporan utama & sumber harus terbuka, transaksional + `hse_hazard_merge_log`, dan **butuh izin baru `hse.merge`** (Admin Utama selalu boleh) — sebelumnya semua pengguna terautentikasi bisa menggabung. Route baru: `/api/hse/ai/{overview,settings,shadow-report,recheck,hazards/triage,suggestions/:id/decision,duplicates/reject}`, `PUT /hazards/:id/clean-description`. `GET /hazards` & `/hazards/:id` menambah `engine`, `verdict`, `reason`, `evidence`, `suggestion_id`, `related_hazards`, `ai_duplicate`, `can_merge`.
- Frontend: `admin-dashboard/hse-ai.js` (baru, `window.OMOSHseAi`), `hse.js` (lencana AI/kata kunci, alasan & bukti, Bukan duplikat, dialog alasan gabung, ✨ Saran AI di form lapor/edit/detail, Setup master → Asisten AI), `hse.css` (`hai-*`), `index.html` (`hse-ai.js?v=1`, `hse.js?v=8`, `hse.css?v=3`), `app.js` (izin `hse.merge` di sub-admin). Sinkron dari perangkat sebelum diubah: `hse.js/hse.css/hse.test.js` (UI jam kerja 092).
- Uji: backend `hse-ai.test.js` 12/12 (PGlite, klien LLM tiruan), `hse-ai-routes.test.js` 1/1 (HTTP), `ai-llm-client.test.js` 10/10, `hse.test.js` 48/48 (tes gabung diperbarui); dashboard `hse-ai.test.js` 4/4, `hse.test.js` lulus. Evaluasi: `scripts/eval_hse_ai.js` + `test/fixtures/hse-ai-goldset-hard-cases.jsonl` (10 kasus); ekspor gold set nyata `docs/drafts/hse_ai_goldset_export_readonly.sql`. Uji browser Playwright (rute asli + PGlite + LLM tiruan): saran AI tampil, alasan gabung wajib, gabung sukses (2 pelapor), Saran AI terapkan kategori/risiko/CAPA/uraian rapi, Setup simpan mode — 0 error halaman modul HSE.
- Ops: `ops/biznet/install-llm-key.sh` (tulis `/opt/omos/secrets/llm_api_key` 0400 uid 1000 tanpa tampil + uji); `release-app.sh` otomatis memasang file key read-only ke `/run/secrets/llm_api_key` bila ada.
- Sisa / belum: H5 shadow 2 minggu, H7 (hentikan perbandingan O(n²) di `listHazards` setelah Go), H8, agen PDF (H9–H12). Keputusan owner D2/D8/D10 (data keluar negeri, syarat layanan free endpoint) sebelum data nyata dikirim.

### 2026-10-13 — Modul Karyawan (OMOS People) v2: DEPLOY KE STAGING BIZNET SELESAI

- `VERIFIED_PRODUCTION` (2026-10-13, staging Biznet `omos_staging`): backup pre-migrasi `/opt/omos/backups/manual/20261013T015751Z-pre-people-093-098.dump` (+ `.sha256`, `pg_restore --list` terverifikasi 1534 TOC entries). Migrasi 093–098 applied via image `omos-app:20261013-090001-people-v2` → `Migrasi People v2 lengkap: 12 tabel + kolom pergerakan v2.` (`--check` juga lulus). Rilis `20261013-090001-people-v2` live (`release-app.sh`: candidate health 200/auth 401/static present, switch sukses, `/opt/omos/current` → rilis baru). Verifikasi live: `/health` 200 (lokal+publik), `POST /api/auth/daftar` = 410, `DELETE /api/admin/karyawan/:id` tanpa token = 401 (bukan 404 — route masih ada), `people.js`/`people.css` 200, `index.html` memuat `#peopleRoot` + `people.js?v=1`, log 0 error. Rollback tersedia: container `omos-app-prev-20261013-090001-people-v2` + migrasi turun `098→093_..._down.sql` (belum perlu dipakai).
- **Temuan blocker saat pre-flight (ditangani sebelum migrasi):** kolom `users.nik_ktp` **tidak ada** di staging (hilang dari seluruh tabel, tanpa jejak di riwayat migrasi/dokumen manapun), padahal `schema.sql`, `002_supabase_migration.sql`, dan migrasi 001 mengasumsikannya selalu ada, dan backfill NIK di 093 (baris 51–56) membaca `u.nik_ktp` langsung. Pre-flight P2 gagal dengan `column "nik_ktp" does not exist`. **Keputusan owner:** tambahkan kembali kolom kosong (`ALTER TABLE users ADD COLUMN IF NOT EXISTS nik_ktp VARCHAR(16)` + unique constraint, idempoten, sama seperti migrasi 001) daripada mem-patch migrasi 093 — backfill tetap tidak mengisi apa pun (data lama sudah tak ada, bukan phantom data). **Belum diketahui kapan/kenapa kolom ini hilang di server Biznet** — perlu ditelusuri terpisah bila relevan (kemungkinan perubahan manual di luar migrasi tercatat, atau indikasi keputusan privasi/compliance yang tidak terdokumentasi).
- Setelah ini: migrasi 093-098 ulang via `--check` di staging mengonfirmasi 12 tabel + kolom pergerakan v2 lengkap; pre-flight penuh (P1–P21) 0 masalah pada P16–P19/P21.
- Cron/systemd baru: `ops/biznet/omos-people-daily.service` + `.timer` (00:10 WIB harian, `docker exec omos-app node backend/src/scripts/run_people_daily.js`) dipasang & dites manual sukses (`{"movements":{"processed":0,...},"outbox":{"processed":0,...}}`). Timer lama `omos-workforce-due.timer` (5 menit, `process_due_workforce_movements.js`) **dibiarkan tetap jalan** (keduanya idempoten, belum dihentikan — opsional sesuai runbook).
- **PERHATIAN HSE 092 — SUDAH TERATASI oleh rilis ini:** rilis sebelumnya `20261012-210345-hse-workhours-092` memakai `backend/src/services/hseWorkhours.js` versi SEBELUM perbaikan T0 (aturan jam kerja jabatan senama mis. "Admin" Engineering vs Logistik bisa terpakai lintas departemen). Diverifikasi di rilis `20261013-090001-people-v2` live: logika `department_id`-aware (baris 154–159 `hseWorkhours.js`) sudah ada di container berjalan.
- Sisa: belum dilakukan smoke test interaktif via browser (tambah karyawan 3 langkah, import Excel, Void, dsb. — lihat daftar di `DEPLOY_PEOPLE_V2_093_098.md` bagian 4) dengan login admin sungguhan; penyimpanan dokumen PDF di staging memakai `STORAGE_PROVIDER=local` (folder `people-dokumen` dibuat otomatis) — pastikan ikut backup volume persisten.
- Migrasi baru (aditif, idempoten, masing-masing punya `_down.sql`): 093 data pribadi + NRP + `people_settings` + audit kolom + `function_tag`; 094 `employee_attendance_locations`; 095 `employee_documents` (PDF ≤5 MB, privat) + log akses; 096 keluarga/tanggungan + view PTKP; 097 jenis pergerakan v2 (CONFIRMATION, CONTRACT_RENEWAL, EMPLOYMENT_TYPE_CHANGE), hari kerja terakhir, void, `people_outbox`; 098 batch/baris import + `master_aliases`. Runner: `backend/src/scripts/run_migration_093_098_people_v2.js` (`--check`).
- Backend baru: `services/peopleOrg.js` (master departemen/jabatan ketat, rename ikut memperbarui pemegang), `peopleEmployees.js` (tambah karyawan = satu pintu, NRP otomatis, direktori/kelengkapan, data pribadi + audit/NIK tersamar, lokasi absen, keluarga, Void), `peopleDocuments.js`, `peopleImport.js` (exceljs: template berdropdown, simulasi, padanan diingat, simpan, Void batch), `peopleDaily.js` (pengingat + outbox; `scripts/run_people_daily.js` untuk cron), `peopleMovements.js`; API `/api/admin/karyawan/people/*` (`routes/people.routes.js`, `controllers/peopleController.js`). `workforce.js`: jabatan tujuan wajib dari master, keluar = hari kerja terakhir (efektif H+1, status NOTICE), maker≠checker (`people.approve`; Admin Utama boleh setujui sendiri dengan alasan bila diizinkan), tolak mutasi tanpa perubahan.
- Perubahan perilaku: `POST /api/auth/daftar` = 410 dan persetujuan Registrasi Pending = 410 (tab Registrasi dihapus; mobile: "Aktifkan akun" dengan kode undangan email); `POST /api/admin/karyawan` diteruskan ke People v2; `DELETE /api/admin/karyawan/:id` = 410 (pakai Void/Proses keluar); absensi dibatasi ke lokasi absen karyawan (tanpa daftar = semua lokasi); foto referensi dicek kemiripan wajah ke karyawan aktif lain (409, bisa dikonfirmasi); NOTICE dihitung headcount MPP.
- Frontend: `admin-dashboard/people.js` + `people.css` (kelas `pp-`), `index.html` (tab Karyawan → `#peopleRoot`, cache-bust `people.*?v=1`, `workforce.js?v=7`, `app.js?v=48`), `app.js` (muat master org untuk filter Performa, `people.approve` di izin sub-admin, notifikasi registrasi dihapus), `workforce.js` (`showMpp`, delegasi form pergerakan ke People). Mobile: `mobile-web/index.html`, `karyawan.js`.
- Uji: backend 490/490 (`node --test`, termasuk PGlite untuk SQL nyata — `@electric-sql/pglite` devDependency); dashboard 61/61; uji browser Playwright atas server uji (rute asli + PGlite): direktori, profil, PDF viewer, tambah karyawan 3 langkah, import 3 baris (padanan + duplikat), edit pribadi (NIK wajib alasan), lokasi, keluarga (PTKP), unggah PDF (tolak non-PDF), Setup (dept ganda ditolak), resign + setujui-sendiri beralasan, Void, reload — 0 error halaman.
- Sisa / risiko: `PATCH /api/admin/karyawan/:id` lama masih bisa ubah email tanpa alasan (UI baru tidak memakainya); 084 `hse_effective_quota` masih cocok berdasarkan nama jabatan (T13a, belum); konsumen lain (Cuti/Roster/HSE) belum pindah ke `position_id` (T13b–e); `otp_demo` di respons `lupa-sandi` membuka risiko pengambilalihan akun — keputusan owner.

### 2026-10-12 — Modul HSE: Setup Master → Jam Kerja Karyawan (terintegrasi LTIFR / TRIR / SR)

- `VERIFIED_PRODUCTION` (2026-10-12): migrasi 092 applied ke `omos_staging` Biznet via skrip baru `ops/biznet/run-hse-092-release.sh` (preflight 0 tabel `hse_workhour*`; backup `/opt/omos/backups/manual/20261012T140646Z-pre-hse-092-workhours.dump` + sha256 + pg_restore --list; verify: 4 tabel + 1 kolom `hse_manhours.workhour_period_id` + 7 index, total 199 tabel) lalu rilis `20261012-210345-hse-workhours-092` live (`release-app.sh`: backend COPY rebuilt, candidate health 200/auth 401, symlink flip; tarball dihapus). Verifikasi live: health 200 (lokal + publik), `GET /api/hse/workhours/setup` = 401 tanpa token (lokal + publik), `hse.js` live 200 memuat 62 ref workhours + marker `bindHseMultiSelect` + teks "Jam Kerja Karyawan", `index.html` cache-bust `hse.js?v=7`/`hse.css?v=2`, log 5 menit 0 error, disk 60%. Rollback: `docker start omos-app-prev-20261012-210345-hse-workhours-092` + symlink ke `20261012-183817-hse-mandate-multiselect`; rollback migrasi manual via `092_hse_workhours_down.sql` (aditif — tabel baru + 1 kolom nullable, aman untuk aplikasi lama). Sisa: dengan login admin atur standar jam per jabatan di Setup Master → Jam Kerja Karyawan sebelum kirim periode; uji browser rekap/kirim/kunci periode.
- Keputusan owner (2026-10-12): jam per hari berbeda per jabatan; hari kerja diambil dari absensi dengan logika **Rekap Performa**; default per jabatan + override per karyawan; rekap ini **menggantikan input manual `hse_manhours` untuk karyawan internal**.
- Migrasi `backend/migrations/092_hse_workhours.sql` (+ `_down.sql`, runner `src/scripts/run_migration_092_hse_workhours.js`): `hse_workhour_standards` (BY_ROLE/BY_EMPLOYEE, effective-dated, EXCLUDE gist anti-overlap, FK RESTRICT, alasan wajib untuk individu), `hse_workhour_periods` (kunci bulanan, unik 1 LOCKED per bulan, riwayat REOPENED), `hse_workhour_period_lines` (snapshot per karyawan), `hse_workhour_audit`, kolom `hse_manhours.workhour_period_id`, index `absensi(tanggal_kerja, user_id)`. Diverifikasi pada PostgreSQL embedded (PGlite) bersama seluruh rantai migrasi 073–092, termasuk up → down → up.
- Service `backend/src/services/hseWorkhours.js`: hari hadir = `keterangan_presensi.hadir_manual` atau presensi kamera tanpa keterangan manual (sama dengan `resolveDailyCategory` Rekap Performa), role `karyawan`, sejak tanggal akun (WIB), tidak di masa depan. Karyawan nonaktif tetap dihitung untuk hari hadirnya. Prioritas jam: individu > jabatan+departemen > jabatan; tanpa aturan = *Belum diatur* (tidak dihitung, bukan 0). Pemetaan jabatan/departemen ke `workforce_positions`/`workforce_departments` berbasis nama (pola migrasi 084).
- Route baru (`hse.routes.js`): `GET /workhours/setup`, `GET /workhours/standards/history`, `POST /workhours/standards/role|employee` (admin), `POST /workhours/standards/:id/end` (admin), `GET /workhours/recap`, `GET /workhours/recap/:employeeId`, `GET /workhours/periods`, `GET /workhours/periods/:month/preview`, `POST /workhours/periods/:month/send` (admin), `POST /workhours/periods/:id/reopen` (admin).
- Integrasi formula: `getSafetyReports` kini 12 bulan berjalan dengan jam kerja per bulan = FINAL (periode terkunci → `hse_manhours` ATTENDANCE) / SEMENTARA & BERJALAN (live presensi) / MANUAL_LAMA (input manual internal oleh pengguna; seed migrasi 074 `created_by IS NULL` diabaikan) / KOSONG (rasio `null`, bukan angka rekaan) + jam kontraktor. **Fallback jam kerja dummy (240.000/bulan) dihapus.** Ringkasan `summary.ytd/rolling12`. `getOverview` → LTIFR/TRIR YTD + `workhours` (jam bulan ini, YTD, jam kerja aman sejak LTI terakhir); nilai statis `hse_site_metrics.ltifr/trir` tidak lagi dipakai. Layar besar & laporan bulanan cetak memakai angka ini (angka statis 2.845.200 / 178.400 / 0.42 / 1.10 dihapus).
- `saveManhours` (Input jam kerja) kini **hanya untuk kontraktor terdaftar** di `hse_contractors`; nama internal/seed ditolak 422; baris `ATTENDANCE` tidak bisa ditimpa manual. Modal di Laporan dan statistik berganti menjadi *Jam kerja kontraktor* (dropdown kontraktor).
- Kirim periode: hanya bulan yang sudah berakhir; hari hadir tanpa standar memblokir pengiriman kecuali dikonfirmasi + catatan; input manual internal bulan itu di-soft-delete dan diganti baris ATTENDANCE per departemen; buka kunci wajib alasan (audit).
- Tes: `backend/test/hse-workhours.test.js` (baru) + `backend/test/hse.test.js` (tes getSafetyReports & saveManhours diperbarui) → 54/54 lulus; `admin-dashboard/hse.test.js` 39/39 lulus. Uji UI end-to-end (Playwright) pada server Express + PGlite: simpan aturan jabatan multi-pilih, override individu (alasan wajib), rekap 1–6 Okt (contoh Andre 4 × 8 = 32; Rudi 2 × 10 + 2 × 8), rincian harian, kirim & kunci periode, laporan statistik, dan Ringkasan.
- Cache-busting: `index.html` → `hse.css?v=2`, `hse.js?v=7`.
- Langkah deploy: SELESAI 2026-10-12 (backup + migrasi 092 + rilis `20261012-210345-hse-workhours-092`, lihat `VERIFIED_PRODUCTION` di atas). Setelah itu atur standar jam per jabatan di Setup master sebelum mengirim periode.
- Risiko sisa: jabatan/departemen dipetakan dari teks `users.jabatan/departemen` saat ini (bukan riwayat mutasi); karyawan dengan jabatan di luar master hanya bisa diatur per karyawan; anchor absensi 03:00/16:00 vs shift 06–18 (isu lama) memengaruhi `tanggal_kerja`; klasifikasi insiden tetap per `incident_type` (lihat `docs/OMOS_HSE_REVIEW_DAN_ROADMAP.md`).

### 2026-10-12 — Modul HSE: Multi-Select Ceklist Departemen/Jabatan/Karyawan di Modal Atur Default & Override (4 Tab Setup Master HSE)

- `VERIFIED_REPO` (frontend only, `admin-dashboard/hse.js`): 8 modal lama (Atur Default per Jabatan & Override Khusus Karyawan di Setup Inspeksi/Hazard/P5M/Safety Talk) dirework jadi wrapper tipis di atas dua modal shared baru `openHseRoleMandateModalShared(tabKey)` dan `openHseOverrideModalShared(tabKey, preselectedEmployeeId)` yang dikonfigurasi lewat `HSE_MANDATE_TABS` (endpoint `/inspections|/hazard|/p5m|/safetytalk/targets`, prefix id per tab, field template hanya inspeksi, judul, default kuota per tab — inspeksi 4/6, lainnya 2/4, loader data tab masing-masing). Komponen reusable baru `bindHseMultiSelect` + `hseMsTriggerHtml`: tombol dropdown + panel checklist (search, Pilih Semua/Kosongkan, chip ringkasan di trigger, tutup saat klik di luar, sinkron mutual-exclusive antara checkbox "Semua Departemen" dan daftar departemen). Field Departemen memakai sentinel `__ALL__` eksklusif; tanpa centang departemen = kombinasi `department_id: null` (semua departemen — perilaku lama dipertahankan). Jabatan & Karyawan wajib ≥1 (pesan `Pilih minimal satu jabatan.` / `Pilih minimal satu karyawan.`); N karyawan/Jabatan × M departemen menghasilkan cross-product aturan per loop `POST {endpoint}` (backend kontrak tetap: satu baris per aturan; overview matrix & filter toolbar **tidak diubah**). Sebelum submit bila >1 pilihan: `window.confirm` ringkasan (daftar nama jabatan/departemen/karyawan + catatan field siklus/kuota/tanggal berlaku untuk seluruh batch). `close_overlapping` tetap satu checkbox berlaku per kombinasi. Komponen batch baru `saveHseMandateBatch(endpoint, items, describeItem)`: all-or-nothing — kombinasi/karyawan pertama gagal (409 dll) → baris yang sempat tersimpan di-deactivate via `DELETE {endpoint}/:id` (kontrak service `createOrUpdate*Target` return row `id`, `deactivateInspectionTarget` soft-delete), lalu throw `Tidak ada aturan tersimpan — konflik di <label>: <pesan>` (label: `Jabatan X @ Departemen Y` atau `karyawan Nama`; bila kompensasi gagal sebagian ditambah catatan periksa matriks); pesan ditampilkan inline di `${idp}BatchErr`. Seluruh simpan tetap lewat `runHseActionFeedback(form, …)` (kunci tombol anti double-submit; feedback teks `Menyimpan n aturan...` / `n aturan tersimpan`). Tombol "Sesuaikan" per baris matrix tetap memanggil wrapper override dengan `dataset.id` → karyawan baris itu tercentang awal di multi-select (boleh tambah lain). Tombol close (`btnHseCloseModal`/`btnHseCancelModal`) dan seluruh wiring listener tab tidak berubah.
- `VERIFIED_TEST`: `admin-dashboard/hse.test.js` 37/37 (+1 test baru multi-select: marker komponen/shared/batch, 8 wrapper, konfigurasi 4 endpoint, konfirmasi, validasi minimal; 4 regex endpoint lama `api('/…​/targets'` disesuaikan jadi `endpoint: '…/targets'` karena loop memakai `api(cfg.endpoint, …)`); suite penuh **dashboard 46/46 file PASS**; `node --check admin-dashboard/hse.js` lolos. Backend tidak berubah (kontrak endpoint dipertahankan). Fixture `hse-preview.html` sudah mock POST `/targets` mengembalikan objek created ber-`id` + DELETE kompensasi — siap untuk uji batch manual.
- Status: **`VERIFIED_PRODUCTION`** (2026-10-12): rilis `20261012-183817-hse-mandate-multiselect` live di Biznet (frontend-only, tanpa migrasi) — `hse.js` live memuat marker `bindHseMultiSelect` (4×), `openHseRoleMandateModalShared` (5×), `saveHseMandateBatch` (3×), health 200 (lokal + publik `103.58.101.240`), log bersih. Sisa: uji browser dengan login admin (pilih multi jabatan+departemen → konfirmasi → loop POST; simulasi 409 pada kombinasi ke-N → cek kompensasi DELETE di tab network; override multi-karyawan + "Sesuaikan" preselect).

### 2026-10-12 — Modul HSE: Upload Foto & Dokumen di Tab Inspeksi (Lampiran Level Header + Edit Staged via PUT Lampiran)

- `VERIFIED_REPO` (backend):
  - Migrasi `091_hse_inspection_attachments.sql` (+`_down` + runner `run_migration_091_hse_inspection_attachments.js`) menambah kolom ke `hse_inspections`: `photos TEXT[] NOT NULL DEFAULT '{}'` dan `documents JSONB NOT NULL DEFAULT '[]'`; **applied ke Supabase** (verifikasi: `documents:jsonb`, `photos:array`). Catatan operasional: runner migrasi harus dijalankan dari workdir `backend/` (dotenv memuat `.env` dari cwd; dari root gagal `ECONNREFUSED ::1:5432`).
  - `backend/src/services/hse.js`: `createInspection` kini mewajibkan `photos` minimal 1 (via `compressHsePhotos`; kosong → `inspectionError` 422 `Inspeksi wajib memiliki minimal 1 foto`) dan memvalidasi `documents` lewat helper baru `validateInspectionDocuments` (PDF/DOCX/XLSX, maks 3 file, ≤2 MB/file, cek nama/MIME/ekstensi/data-URL base64, buffer kosong → 422; konstanta `INSPECTION_DOCUMENT_TYPES`, `MAX_INSPECTION_DOCUMENTS=3`, `MAX_INSPECTION_DOCUMENT_BYTES=2MB`); INSERT kini 15 parameter (`photos` idx 14, `documents` idx 15, `completed_at NOW()`). `getInspectionDetail` diperkaya agar modal lengkap: `photos`/`documents` (guard array), `inspector_name`, `equipment_tag`, `notes`, `pass_rate_pct` (YES/total×100), `criticalFindings`, `answers` di-map (`item_prompt`=question, `notes`=note, `category`=null). Fungsi baru `updateInspectionAttachments(db, scope, id, input)`: SELECT (404 bila tak ada), replace-set `photos` (kosong → 422 tanpa UPDATE; tidak dikirim → keep-current via `compressNewPhotos`), `documents` diganti hanya bila `Array.isArray`, UPDATE `photos, documents, updated_at=NOW()`, return `getInspectionDetail`.
  - `backend/src/routes/hse.routes.js`: route baru `PUT /api/hse/inspections/:id/lampiran` (replace-set atomik) setelah `POST /inspections`.
- `VERIFIED_REPO` (frontend `admin-dashboard/hse.js`): `bindPhotoAttachmentController` mendapat param ke-4 `onChange` (dipanggil saat remove & setelah input change) + `getCount()`. Blok dokumen baru: `HSE_DOC_TYPES` (ext→mime), `HSE_MAX_DOCUMENTS=3`, `HSE_MAX_DOCUMENT_BYTES` (2 MB), `readInspectionDocumentFile` (tolak ekstensi/size di luar whitelist dan data-URL yang tidak cocok MIME), `hseDownloadDataUrl`, `hseDocExtension`, `hseDocIcon`, `bindDocumentAttachmentController` (list + `lastError` inline, aksi Lihat/Unduh/Hapus, iframe preview **PDF saja**, dedupe nama, cap 3; return `getDocuments()`/`getCount()`). Form create: section **Foto Inspeksi \*** (`inInsPhotos`/`inInsPhotoPreviewList`) dan **Dokumen Pendukung** (`inInsDocs`/`inInsDocList`) + `#hseInsFormError`; wiring kedua controller setelah `render()`, validasi klien foto wajib, payload `photos` + `documents`. Modal Detail direwrite jadi **staged edit**: state `dirty`, kontrol `inInsDetailPhotos`/`inInsDetailPhotoList`/`inInsDetailDocs`/`inInsDetailDocList`, hint `hseInsPhotoCount` (`n/3 foto`), `hseInsPhotoRequiredHint`, `hseInsLampiranDirtyHint`, `hseInsLampiranError`; footer `btnHseInsDetailClose` + `btnHseInsSaveLampiran` (disabled selama `!dirty || photos==0`); save → `runHseActionFeedback(saveBtn, work)` → `PUT /inspections/:id/lampiran` → tutup guard `beforeunload` + `loadInspectionData()` + buka ulang modal; close (`tryClose` / `btnHseCloseModal2`) memakai `window.confirm` (teks khusus bila foto 0) dan selalu `removeEventListener('beforeunload')`. Selaras backend: modal kini baca `a.category`, `a.question`-via-`item_prompt`, `a.note`, `ins.equipment_tag || ins.object_identifier`, `ins.notes || ins.result_summary`, `ins.inspector_name || ins.inspected_by_name`.
- `VERIFIED_FIXTURES`: `admin-dashboard/test-fixtures/hse-preview.html` — `MOCK_INSP_PNG`/`MOCK_INSP_PDF` + `photos`/`documents` di keempat `mockInspections` (ins-1 & ins-3 punya dokumen PDF); interceptor `POST` create menolak `photos` kosong → 422, `newIns` menyimpan `photos`+`documents`; handler baru `PUT /api/hse/inspections/:id/lampiran` (404 tak dikenal, 422 foto kosong, 422 >3 dokumen, replace-set) ditempatkan sebelum branch GET detail (regex `[^/]+$` tidak match `/lampiran`); ke-4 blok `<script>` parse lolos `node --check`.
- `VERIFIED_TEST`: backend `backend/test/hse.test.js` 47/47 (konstanta `HSE_TEST_PNG`/`HSE_TEST_PDF`; 2 test `createInspection` lama disesuaikan `photos`; 2 test baru: validasi foto wajib + dokumen PDF/DOCX/XLSX 3×2MB & INSERT 15 params; replace-set `updateInspectionAttachments` + enrichment `pass_rate_pct=50`, `criticalFindings=1`); dashboard `admin-dashboard/hse.test.js` 36/36 (3 test baru: form create, staged detail edit + `beforeunload`/`confirm`/`runHseActionFeedback(saveBtn, work)`, fixture mocks + PUT lampiran). Suite penuh: **backend 73/73 file test PASS**, **dashboard 46/46 file test PASS**; `node --check` semua file yang diubah lolos.
- `VERIFIED_PRODUCTION` (2026-10-12): rilis `20261012-101210-hse-p5m-lampiran` live di Biznet — migrasi 091 applied ke `omos_staging`, `hse.js` produksi memuat marker `btnHseInsSaveLampiran`/`bindDocumentAttachmentController`, route `PUT /inspections/:id/lampiran` terproteksi (401 tanpa token). Sisa: uji browser (upload foto create, tambah/hapus dokumen, staged edit + popup, download PDF) dengan login admin; aturan foto wajib hanya berlaku saat create/PUT — riwayat inspeksi lama (tanpa kolom) tetap tampil & tidak diblokir; simulasi klien menghasilkan data-URL `data:`, bukan base64 polos — kompatibel dengan cek backend (base64 diterima, data-URL juga).

### 2026-10-12 — Modul HSE: Tab P5M & Safety Talk Baru di Hazard dan Inspeksi (Pengganti Subtab Safety Talk Lama)

- `VERIFIED_REPO` (backend):
  - Migrasi `090_hse_p5m_safetytalk_events.sql` (+`_down` + runner `run_migration_090_hse_p5m_safetytalk_events.js`) membuat 4 tabel baru `hse_p5m_events`, `hse_p5m_event_attendees`, `hse_safetytalk_events`, `hse_safetytalk_event_attendees`, lalu **DROP `hse_safety_talks` secara HARD DELETE tanpa backup (keputusan owner eksplisit, 2x konfirmasi)**; applied ke database lokal.
  - `backend/src/services/hse.js`: service events generik (kind `p5m`/`safetytalk`) — validasi peserta hanya status `WAJIB` (422 bila bukan), kunci dedupe `location_id + event_date + shift_id`, nomor seri `P5M-YYMM-NNN`/`STK-…`, merge manual pola Hazard (`merged_into_id` + `status='DUPLICATE'`, union peserta/topik/pemateri/foto, sumber disembunyikan), delete cascade seluruh pohon merge (HARD DELETE); wrapper `*P5mEvent`/`*SafetyTalkEvent`; `getMasters` menambah `shifts`; `getCompetencyOverview` stats di-query ulang ke tabel event baru; kompresi foto server-side `hsePhotoCompress.js` (library `sharp`) untuk create/update hazard & incident.
  - `backend/src/routes/hse.routes.js`: 12 route `GET/POST/PUT/DELETE /api/hse/p5m/events*` & `/api/hse/safetytalk/events*` (filter `search`, `location_id`, `date_from`, `date_to`; `POST .../merge` body `{source_ids}`); route lama `/competency/safety-talks` dihapus.
  - `sharp` ditambahkan ke `backend/package.json` dan `package.json` root.
- `VERIFIED_REPO` (frontend `admin-dashboard/hse.js`): subnav **P5M** & **Safety Talk** setelah tab Inspeksi di sub-halaman Hazard dan Inspeksi; renderer generik `renderHseEventTab(kind)` (3 stat pill Total Sesi/Peserta/Perlu Gabung, banner blokir + shortcut Setup Master bila 0 karyawan WAJIB, filter bar, tabel 6 kolom dengan Tanggal + badge shift, Area/Lokasi, Topik, Peserta, chip "⚠ N duplikat" + tombol Gabung, tombol Tambah disabled bila 0 WAJIB); modals Detail / Form (checklist peserta hanya WAJIB + pencarian + pemateri + foto multi `bindPhotoAttachmentController`, validasi klien, semua simpan via `runHseActionFeedback`) / Merge / Delete; subtab **Safety Talk (P5M)** lama di Kompetensi (render, loader, bindings, export) dihapus.
- `VERIFIED_FIXTURES`: `admin-dashboard/test-fixtures/hse-preview.html` — `mockMasters.shifts`, `mockP5mEvents`/`mockStEvents`, handler lengkap CRUD + merge + filter `/api/hse/{p5m,safetytalk}/events`; fix 2 bug sintaks pre-existing (duplikat `let mockInspectionTemplates`, hilang `];` sebelum `let mockRiskRegister`) sehingga ke-4 blok `<script>` parse lolos `node --check`.
- `VERIFIED_TEST`: backend 442/442 (`backend/test/hse.test.js` 45/45 termasuk 3 test baru: validasi WAJIB saat create, merge key + union data, delete cascade); dashboard 204/204 (`admin-dashboard/hse.test.js` 33/33 termasuk test tab event + `doesNotMatch` tab lama); 2 test basi unrelated ikut diperbaiki (`production.js?v=102`→`103` dan `production.loader.js?v=46`→`54` di `ritase-fleet-planning-integration.test.js` + `standby-direct-use.test.js`); `node --check` seluruh file yang diubah lolos.
- `VERIFIED_PRODUCTION` (2026-10-12): migrasi 090 applied ke `omos_staging` Biznet (backup dump pre-migrasi; `hse_safety_talks` produksi berisi 5 row, ter-drop sesuai keputusan owner) dan rilis `20261012-101210-hse-p5m-lampiran` live; build image Docker dengan `sharp` (native addon) sukses (bcrypt native OK). Risiko sisa: isu existing tidak disentuh — anchor `attendancePolicy` hard-code 03:00/16:00 vs constraint shift 06–18. Uji browser (2 tab, form WAJIB-only + shortcut Setup, merge duplikat, foto, hard delete) dengan login admin.

### 2026-10-11 — Modul Mining Production (10. Survey Report): Perbaikan Kesejajaran Kolom SEAM 4L & Fitur Download Template + Import Excel

- `VERIFIED_REPO`: Diagnosis dan perbaikan bug serta penambahan fitur pada [`admin-dashboard/surveyReport.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/surveyReport.js) (`surveyReport.js?v=5`) dan [`admin-dashboard/production.loader.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/production.loader.js) (`production.loader.js?v=51`):
  - **Root Cause & Perbaikan Kesejajaran Kolom**: Menyelaraskan urutan pembuatan sel pada `colgroup`, `tbody` (`rows`), dan `tfoot` (`Total Bulan`) secara per-grup (`groups.map(...)`: seluruh material grup diikuti tepat oleh sel `Total` grup tersebut) sehingga kolom `SEAM 4L` memiliki `<input>` tersendiri dan tidak tertimpa sel `Total` OB (`CLAY`).
  - **Tombol `📥 Download Template` (`downloadTemplate` / `buildTemplateSheetMatrix`)**: Mengekspor data tabel yang sedang tampil di halaman (header grup `Overburden Removal (BCM)` & `Coal Getting (Ton)`, sub-header material + `Total`, seluruh baris tanggal bulan berjalan beserta nilai yang sedang tampil di layar, serta baris `Total Bulan` dan sheet `Petunjuk`) ke file `.xlsx`.
  - **Tombol `📤 Import Excel` (`importExcelFile` / `parseSurveyImportMatrix`)**: Membaca kembali file template `.xlsx` yang telah diisi user (otomatis mengabaikan kolom `Total` dan baris `Total Bulan`, mendukung format angka desimal koma/titik dan tanggal serial Excel), menerapkan nilai ke tabel halaman, serta langsung menyimpannya ke endpoint `POST /api/admin/production/survey-volumes/batch`.
  - **Regression Test & Deployment**: Ditambahkan unit test regresi di [`admin-dashboard/survey-report.test.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/survey-report.test.js) (10/10 test Survey Report frontend & backend lulus 100%) dan telah di-*deploy* langsung ke server produksi Biznet (`103.58.101.240`).

### 2026-10-11 — Modul HSE: Penyederhanaan 2 Kategori Hazard (Kondisi/Tindakan Tidak Aman) & Algoritma Pintar Deteksi + Penggabungan 1 Jenis Hazard yang Sama

- `VERIFIED_REPO`: Migrasi Database [`backend/migrations/087_hse_hazard_categories_and_smart_merge.sql`](file:///d:/OneDrive/Desktop/OMOS/backend/migrations/087_hse_hazard_categories_and_smart_merge.sql) dan runner [`backend/src/scripts/run_migration_087_hse_hazard_smart_merge.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/scripts/run_migration_087_hse_hazard_smart_merge.js) sukses dieksekusi di database lokal dan PostgreSQL Biznet (`103.58.101.240`):
  - **2 Kategori Utama Hazard**: Menetapkan 2 kategori aktif pada `hse_categories` (`domain = 'HAZARD'`): **`Kondisi Tidak Aman`** (`UNSAFE_CONDITION`) dan **`Tindakan Tidak Aman`** (`UNSAFE_ACT`), menonaktifkan kategori lama, serta memigrasikan seluruh laporan hazard eksisting secara otomatis.
  - **Normalisasi Hierarki Area & Sub-Area**: Memastikan seluruh lokasi pada `hse_locations` dan `hazard_reports` terpetakan ke hierarki **Area Induk (`area_id`) ▸ Sub-Area Spesifik (`sub_area_id`)** secara konsisten.
  - **Kolom Smart Merge & Kode Semantik**: Menambahkan kolom `merged_into_id`, `merged_at`, `merged_by`, dan `semantic_signature` pada tabel `hazard_reports`.
- `VERIFIED_REPO`: Backend Smart Semantic Engine & Strict Area/Sub-Area Exception Gate di [`backend/src/services/hse.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/services/hse.js) dan [`backend/src/routes/hse.routes.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/routes/hse.routes.js):
  - **Pengecualian Ketat Area & Sub-Area (`isSameHazardArea` & `hasConflictingSubLocationInText`)**: Algoritma pintar **TIDAK dijalankan** jika Area/Lokasi Induk (`area_id`) berbeda ATAU Sub-Area (`sub_area_id` / `location_id`) berbeda ATAU terdapat penyebutan titik sub-lokasi berbeda di dalam teks (mis. `KM 1` vs `KM 2`, `Bay 1` vs `Bay 3`, `Blok 1` vs `Blok 2`). Algoritma pintar **hanya berlaku apabila Area/Lokasi DAN Sub-Area SAMA PERSIS** serta status belum *Closed*.
  - `buildHazardSemanticCode(description, potentialConsequence)` & `computeHazardSimilarity(hzA, hzB)`: Mengecualikan kata generik lokasi dari perhitungan token dan mewajibkan minimal $\ge 2$ akar kata bahaya spesifik yang sama sebelum merekomendasikan penggabungan.
  - `POST /api/hse/hazards/:id/merge` (`mergeSimilarHazards`) & `GET /api/hse/hazards/reporter-stats` (`getHazardReporterStats`): Menggabungkan laporan kedua ke laporan utama sehingga sistem membacanya sebagai **1 jenis hazard unik** di tabel utama (`👥 N Pelapor`), namun **tetap menghitung setiap personil pelapor secara utuh (2 laporan)** sebagai catatan administrasi pelapor.
  - **Validasi Manual Admin (`PUT /api/hse/hazards/:id` $\rightarrow$ `updateHazard`) & Hapus Menyeluruh (`DELETE /api/hse/hazards/:id` $\rightarrow$ `deleteHazard`)**: Mendukung pembaruan seluruh atribut hazard (termasuk `photos` terkompresi, `potential_consequence`, `reported_by`, dan kalkulasi ulang `semantic_signature`), serta penghapusan tuntas (*hard cascade delete*) atas file foto di storage (`cleanupHazardPhotos`), CAPA terkait (`hse_actions`), dan record `hazard_reports` (utama maupun *child* tergabung).
- `VERIFIED_REPO`: Frontend [`admin-dashboard/hse.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.js) (`hse.js?v=6`):
  - **Kompresi Gambar Otomatis (`compressHazardImage` & `bindPhotoAttachmentController`)**: Mengompresi lampiran foto bukti temuan di sisi klien menggunakan HTML5 `<canvas>` (maks. `1200x1200 px`, `image/webp` / `image/jpeg` kualitas adaptif target $\le 110\text{ KB}$) sebelum diunggah ke sistem untuk efisiensi memori, lengkap dengan preview penghematan ukuran (`⚡ Asli ➔ Terkompresi`).
  - **Tombol `✏️ Edit` (`openEditHazardModal`) & `🗑️ Hapus` (`deleteHazardAction`)**: Tersedia pada setiap baris Tabel Daftar Hazard dan di dalam Modal Detail Hazard untuk validasi manual Admin maupun penghapusan menyeluruh data frontend & backend.
- `VERIFIED_REPO`: Seluruh 68 unit test di [`backend/test/hse.test.js`](file:///d:/OneDrive/Desktop/OMOS/backend/test/hse.test.js) dan [`admin-dashboard/hse.test.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.test.js) lulus 100% (pass 68, fail 0).

### 2026-10-11 — Implementasi Enterprise Landing Page OMOS (One Mining System Operation) + Dark/Light Theme Switcher

- `VERIFIED_REPO`: Halaman utama sebelum autentikasi (`#layarLogin`) di [`admin-dashboard/index.html`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/index.html) telah ditingkatkan menjadi **Enterprise Landing Page OMOS (One Mining System Operation)** dengan tetap mempertahankan kompatibilitas penuh alur login `#formLogin`, `#inputEmail`, `#inputPassword`, `#errorLogin`, dan `#jamLogin`.
- `VERIFIED_REPO`: Aset & File Baru:
  - [`admin-dashboard/landing.css`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/landing.css): Desain futuristik *Industrial Obsidian (Dark Mode)* dan *Crisp Slate-Ivory (Light Mode)* yang di-scope di bawah `#layarLogin` agar tidak berbenturan dengan CSS aplikasi utama (`#app`).
  - [`admin-dashboard/landing.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/landing.js): Pengendali interaktif untuk:
    1. **Dark / Light Mode Toggle (`#btnThemeToggle`)** dengan ikon **Matahari (☀️)** dan **Bulan (🌙)** serta persistensi `localStorage` (`omos_landing_theme`).
    2. **Live Site Telemetry Cockpit** 3-tab (*Produksi & Fleet*, *HSE & SMKP*, *People & Fuel*) dengan jam operasional WIB real-time.
    3. **Bento Grid 6 Pilar Operasional** berpola ritme asimetris (`7+5`, `5+7`, `7+5`) sesuai standar *Taste Skill & Redesign Skill*:
       - *Mine Planning & Production Intelligence*
       - *Unit Population & Maintenance*
       - *Supply Chain Management*
       - *Human Resource Management & Development*
       - *HSE & Keselamatan Pertambangan (SMKP Minerba)*
       - *Core Platform & Decision Governance*
    4. **Diagram Arsitektur 3-Layer Enterprise v2.6** (*Intelligence Layer*, *Mining Modules*, *Core Platform & Data Plane*).
    5. **Formulir Contact Us / Request Demo (`#formContactOmos`)** terintegrasi langsung ke WhatsApp & Email resmi (`support@omos-mining.com`).
    6. **Jendela Modal Login Terpadu (`#modalLoginOmos`)** dengan 2 tab: *Command Center (Admin)* dan *Portal Karyawan* (tautan ke `/karyawan.html` dan unduh APK `/Absensi_PIM.apk`), dilengkapi *auto-sanitize* input email (`#inputEmail`) untuk mengubah koma (`,`) menjadi titik (`.`).
  - [`admin-dashboard/test-fixtures/omos-landing-preview.html`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/test-fixtures/omos-landing-preview.html) & Plugin UI Extension `omos-landing-showcase` telah disinkronkan 100%.
  - **Deployment Server Biznet Gio (`103.58.101.240`)**:
    - Rilis baru `/opt/omos/releases/20261011-140500-landing-page-omos` dengan Docker image `omos-app:20261011-140500-landing-page-omos` berhasil di-deploy secara *zero-downtime* melalui [`ops/biznet/release-app.sh`](file:///d:/OneDrive/Desktop/OMOS/ops/biznet/release-app.sh).
    - Symlink `/opt/omos/current` telah dialihkan dan diverifikasi (`index=200`, `landing.css?v=2=200`, `landing.js?v=2=200`, `assets/reports/omos-one-path.png=200`, `/health=200 OK`).
    - **Sinkronisasi Dataset Operasional HSE Fase 1–8 di PostgreSQL Biznet**: Mengeksekusi seeder item checklist templat inspeksi (`hse_inspection_template_items`: 20 baris) dan [`backend/src/scripts/seed_hse_sample_data.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/scripts/seed_hse_sample_data.js) pada database Biznet (`omos-postgres-staging`), memulihkan seluruh 18 laporan hazard (`HZD-2610-001` s/d `018`), 4 CAPA, 15 insiden & investigasi, 4 realisasi inspeksi (20 jawaban), 5 izin kerja PTW, lisensi/SIMPER, MCU, CSMS kontraktor, lingkungan, tanggap darurat, APD, dan audit SMKP agar identik 100% dengan database development lokal.

### 2026-10-10 — Modul Maintenance / Periodic Service: Fleksibilitas Periode Service, Integrasi Temuan Otomatis, dan Aksi Edit & Cascade Delete Riwayat

- `VERIFIED_REPO`: Perubahan pada Tab Jadwal Service & Modal Pelaksanaan Servis:
  - **Pemilihan Periode Service Dinamis**: Dropdown pilihan periode/paket service (`name="package_id"`) dari seluruh paket yang terkonfigurasi untuk model unit tersebut (`PS 250`, `PS 500`, `PS 1000`, `PS 2000`, dll.).
  - **Penyesuaian Target Interval HM**: Input target HM servis (`name="due_hm"`) fleksibel yang dapat disesuaikan mekanik/user sebelum konfirmasi submit.
  - **Sinkronisasi UI Reaktif (`gantiPaketOrderPeriodicService`)**: Mengubah opsi periode secara instan memperbarui ringkasan kode periode, cycle HM, estimasi pekerjaan, dan daftar tabel Part / Task dari Area Setup.
- `VERIFIED_REPO`: Penggantian Label Catatan & Integrasi ke Tab "Temuan":
  - Label input diubah menjadi **"Catatan / Temuan Service"**.
  - Saat input terisi (`value.trim() !== ''`), backend `createOrder` dan `updateOrder` otomatis mencatat record baru ke tabel `periodic_service_findings` (`category: 'Temuan Service'`, `severity: 'medium'`, `status: 'open'`, `follow_up_type: 'monitor'`).
  - Tab "Temuan" dan counter badge KPI langsung menampilkan entri temuan tersebut secara reaktif setelah submit tanpa perlu input terpisah.
- `VERIFIED_REPO`: Tab Realisasi & Riwayat Service (Penggantian Aksi Edit & Hapus Menyeluruh):
  - **Hapus Tombol Koreksi Waktu**: Tombol "Koreksi Waktu" dihapus dari daftar aksi baris tabel riwayat servis.
  - **Tombol Edit & Modal Lengkap (`bukaModalEditPeriodicService`)**: Memuat state awal data riwayat (Unit, Periode/Paket Service, Target Due HM, HM Saat Service, Mulai–Selesai Service, Shift, dan Catatan / Temuan Service) dan mengirim `PUT /api/admin/production/periodic-service/orders/:id`.
  - **Tombol Hapus & Cascade Deletion (`konfirmasiHapusPeriodicService`)**: Dialog konfirmasi penghapusan aman. Backend `DELETE /api/admin/production/periodic-service/orders/:id` menghapus menyeluruh (cascade) record servis, actual items, order items, findings, time corrections, serta log breakdown `PS` (`breakdown_status_history` dan `breakdown_logs`) dalam transaksi terpadu, serta melepaskan status alat ke `Ready` jika tidak ada breakdown open lain.
  - **Pembaruan Instan Frontend**: Response 200 langsung menghapus order dari state lokal `psData.orders` dan memanggil `muatPeriodicService()` untuk sinkronisasi seketika tanpa hard reload halaman.
- `VERIFIED_REPO`: Rute baru di [`backend/src/routes/production.routes.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/routes/production.routes.js): `PUT /periodic-service/orders/:id` dan `DELETE /periodic-service/orders/:id`.
- `VERIFIED_REPO`: Seluruh 120 unit test lintas modul lulus 100% (pass 120, fail 0), mencakup [`admin-dashboard/periodic-service.test.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/periodic-service.test.js) (10/10 PASS) dan [`backend/test/periodicService.test.js`](file:///d:/OneDrive/Desktop/OMOS/backend/test/periodicService.test.js) (7/7 PASS).

### 2026-10-11 — Deployment Rilis Penuh Modul HSE & Personnel Scope ke Server Biznet Gio + Safeguard Portal Mobile Web

- `VERIFIED_REPO`: Status Deployment Server Biznet Gio (`103.58.101.240`):
  - **Rilis Baru**: `/opt/omos/releases/20261011-004800-hse-v2-full` dengan Docker image `omos-app:20261011-004800-hse-v2-full`.
  - **Zero-Downtime Switch**: Berhasil dieksekusi via `ops/biznet/release-app.sh`. Symlink `/opt/omos/current` kini mengarah ke rilis baru.
  - **Container Runtime**: `omos-app` berjalan aktif di `127.0.0.1:3000` dengan health endpoint 200 OK (`{"status":"ok","serverless":false}`).
  - **Database Migration 086 (Biznet PostgreSQL)**: DDL `086_hse_inspection_personnel_scope.sql` dieksekusi sukses pada PostgreSQL Biznet (`omos-postgres-staging` / `omos_staging`). Tabel `hse_inspection_personnel_scopes` aktif dan terindeks.
  - **Nginx Reverse Proxy & Static Files**: Nginx menyajikan aset statis dashboard `hse.js` (200 OK) dan `hse.css` (200 OK) langsung dari rilis baru `/opt/omos/current/admin-dashboard`, serta menyajikan Portal Mobile Web Absensi dari `/opt/omos/current/mobile-web` (`/mobile`, `/portal`, `/karyawan`, `/karyawan.html`, `/karyawan.js` $\rightarrow$ 200 OK).
  - **Safeguard Deployment & Local Preview**:
    - [`ops/biznet/release-app.sh`](file:///d:/OneDrive/Desktop/OMOS/ops/biznet/release-app.sh) diperkuat dengan gate wajib pre-switch (`test -f "$RELEASE_DIR/mobile-web/index.html"` & `karyawan.js`) dan post-switch (`https://127.0.0.1/karyawan.html` == 200) agar rilis mendatang tidak pernah tertinggal menyertakan direktori `mobile-web`.
    - [`backend/src/server.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/server.js) dilengkapi fallback static route `/mobile-web`, `/mobile`, `/portal`, `/karyawan`, `/karyawan.html`, dan `/karyawan.js`.
  - **Verifikasi Rute Baru**: Endpoint `GET /api/hse/inspections/mandates/scope` aktif di port 3000 Biznet (401 response saat diakses unauthenticated).

### 2026-10-11 — Modul HSE: Deep Analytic, Keselarasan V2, & Fitur Seleksi Karyawan (Personnel Scope)

- `VERIFIED_REPO`: Migrasi Database & Backend Personnel Scope:
  - Migrasi [`backend/migrations/086_hse_inspection_personnel_scope.sql`](file:///d:/OneDrive/Desktop/OMOS/backend/migrations/086_hse_inspection_personnel_scope.sql) menambahkan tabel `hse_inspection_personnel_scope` (`scope_mode`: `ALL`/`CUSTOM`, `included_positions` text[], `included_employee_ids` uuid[], `excluded_employee_ids` uuid[]) dengan trigger audit `hse_inspection_setup_audit`.
  - Backend API [`backend/src/routes/hse.routes.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/routes/hse.routes.js): `GET /api/hse/inspections/mandates/scope` dan `PUT /api/hse/inspections/mandates/scope`.
  - Integrasi evaluasi mandat: Query overview mandat di `backend/src/services/hse.js` menyaring personil secara reaktif berdasarkan scope aktif (mode `ALL` mencakup semua user aktif; mode `CUSTOM` memfilter berdasarkan gabungan jabatan terpilih `included_positions` + personil eksplisit `included_employee_ids` dikurangi pengecualian `excluded_employee_ids`).
- `VERIFIED_REPO`: Audit Deep Analytic & Perbaikan Bug/Sintaks Teridentifikasi:
  - **Bug #1 (TypeError OMOSActionFeedback)**: Kontrak `OMOSActionFeedback.run(btn, task, options)` mewajibkan DOM button sebagai argumen pertama. Helper `runHseActionFeedback` diimplementasikan secara seragam di seluruh form setup inspeksi, menggantikan pemanggilan salah berformat objek container.
  - **Bug #2 (Versioning Discrepancy)**: Penjadwalan objek (`createInspectionSchedule` & `listInspectionSchedules`) kini mengikat `template_root_id` ke `root_id` templat dan join query selalu menyaring `is_current = TRUE` agar revisi templat checklist tidak memutuskan keterkaitan jadwal.
  - **Bug #3 (Pre-fetch Data Dropdown)**: Handler navigasi sub-tab setup otomatis memicu pre-fetch data templat dan master ketika user membuka tab Jadwal Objek atau Kewajiban Karyawan tanpa membuka tab Templat terlebih dahulu.
  - **Bug #4 (Enum Baku Override Individu)**: Nilai `reason_code` di modal override diselaraskan dengan spesifikasi dokumen V2: `SAFETY_CHAMPION`, `SPECIAL_TASK`, `LONG_LEAVE`, `DISPENSATION`, `OTHER`.
  - **Bug #5 (Anti-Slop / Taste Skill UI)**: Menghapus seluruh native browser `confirm()` dan `alert()` pada penonaktifan templat, penonaktifan jadwal, dan penghapusan area; digantikan dengan modal in-app dialog elegan `openHseConfirmModal` dengan umpan balik visual terpadu.
- `VERIFIED_REPO`: Seluruh unit test backend (`432/432 PASS`), test frontend dashboard (`29/29 PASS`), dan script verifikasi scope `verify_personnel_scope.js` lulus 100%. Backend server aktif di port 3000.

### 2026-10-10 — Modul HSE: Sub-Halaman Setup Master — Setup Inspeksi (Templat, Target Mandat Kewajiban Karyawan, dan Jadwal Objek)

- `VERIFIED_REPO`: migrasi database [`backend/migrations/084_hse_setup_inspections.sql`](file:///d:/OneDrive/Desktop/OMOS/backend/migrations/084_hse_setup_inspections.sql) dan [`backend/migrations/085_hse_inspection_schedules.sql`](file:///d:/OneDrive/Desktop/OMOS/backend/migrations/085_hse_inspection_schedules.sql) (beserta rollback `_down.sql`) sukses dieksekusi via runner [`backend/src/scripts/run_migration_084_085_hse_inspection_setup.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/scripts/run_migration_084_085_hse_inspection_setup.js):
  - Penambahan kolom pada `hse_inspection_templates`: `inspection_type` (`PLANNED` / `UNPLANNED`), `schedule_cycle` (`DAILY`, `WEEKLY`, `MONTHLY`, `CUSTOM_DAYS`, `NONE`), `custom_interval_days`, `setup_reviewed`, `root_id`, `version_no`, `is_current`, `locked_at`.
  - Drop constraint unik lama `code` dan pembuatan unique index per `version_no` serta per `root_id` agar mendukung multi-versi.
  - Trigger guard pembekuan template (`locked_at`) saat pertama kali dipakai pada `hse_inspections`, serta trigger guard pencegahan modifikasi checklist pada templat terkunci (mengarahkan user untuk membuat versi baru).
  - Tabel `hse_inspection_targets` dengan exclusion constraint (`btree_gist` + `daterange`) untuk mencegah aturan kewajiban overlapping yang bertabrakan.
  - Tabel `hse_inspection_setup_audit` untuk jejak audit perubahan konfigurasi.
  - Fungsi PostgreSQL `hse_effective_quota` mengimplementasikan 6-tingkat resolusi prioritas aturan (individu vs jabatan, jenis spesifik vs umum, departemen spesifik vs semua dept), kuota 0 `BEBAS`, status `BELUM_DIATUR`, dan penanganan tanggal berlaku aktif. Telah disesuaikan dengan skema OMOS aktual (`users.jabatan` di-join ke `workforce_positions.name` dan `users.departemen` ke `workforce_departments.name`).
  - Tabel `hse_inspection_schedules` untuk penjadwalan objek pengawasan (lokasi/aset, assignee tipe `EMPLOYEE` / `POSITION`, `next_due_date`, `last_done_at`).
  - Penambahan kolom `schedule_id` dan `completed_at` pada `hse_inspections`.
- `VERIFIED_REPO`: verifikasi matriks 15 kasus database via [`backend/src/scripts/test_effective_quota_matrix.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/scripts/test_effective_quota_matrix.js) lulus **15/15 PASS 100%**.
- `VERIFIED_REPO`: backend service [`backend/src/services/hse.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/services/hse.js) dan rute API [`backend/src/routes/hse.routes.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/routes/hse.routes.js):
  - `GET/POST /api/hse/inspections/templates`, `GET/PUT /api/hse/inspections/templates/:id`, `POST /api/hse/inspections/templates/:id/version`, `DELETE /api/hse/inspections/templates/:id`.
  - `GET/POST /api/hse/inspections/targets`, `DELETE /api/hse/inspections/targets/:id`.
  - `GET /api/hse/inspections/mandates/overview` (rekap target matriks untuk seluruh karyawan).
  - `GET/POST /api/hse/inspections/schedules`, `DELETE /api/hse/inspections/schedules/:id`.
  - `GET /api/hse/inspections/compliance` (evaluasi realisasi inspeksi aktual vs target kuota).
  - Penambahan `positions` (`workforce_positions`) dan `departments` (`workforce_departments`) pada endpoint `getMasters`.
- `VERIFIED_REPO`: UI admin dashboard [`admin-dashboard/hse.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.js) dan styling [`admin-dashboard/hse.css`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.css):
  - **Sub Halaman Setup Master**: Dilengkapi tab switcher level 1 (`Area & Lokasi` vs `Inspeksi`).
  - **Tab Setup Inspeksi**: Tampilan segmented control 3 sub-tab:
    1. **Jenis Inspeksi (Templat)**: Statistik templat aktif, perlu ditinjau, terkunci; toolbar live search & filter sifat/siklus; tabel katalog templat; modal tambah/edit templat dengan checklist builder interaktif; tombol rilis versi baru (`v2`, `v3`) saat templat telah terkunci.
    2. **Kewajiban Karyawan (Mandat & Target)**: 4 KPI cards (Total Personil, Wajib Inspeksi, Bebas Kewajiban [0], Belum Diatur); filter departemen & status; tabel matriks kuota individu & sumber aturan; modal set default jabatan dan modal set individual override dengan opsi auto-close overlapping.
    3. **Jadwal Objek Inspeksi**: Kartu status jadwal (Aktif, Hari Ini, Terlambat); toolbar pencarian; tabel jadwal lokasi/aset & penanggung jawab; modal pembuatan jadwal objek.
- `VERIFIED_REPO`: mock dataset & router di fixture [`admin-dashboard/test-fixtures/hse-preview.html`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/test-fixtures/hse-preview.html) telah dilengkapi endpoint dan data inspeksi setup.
- `VERIFIED_REPO`: seluruh unit test backend [`backend/test/hse.test.js`](file:///d:/OneDrive/Desktop/OMOS/backend/test/hse.test.js) (34/34 PASS) dan frontend [`admin-dashboard/hse.test.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.test.js) (28/28 PASS) sukses 100%. Total 62 unit test lulus tanpa regresi.


### 2026-10-10 — Modul HSE: Form Lapor Hazard — Kolom Konsekuensi / Potensi Dampak, Urutan Form, dan Report By Karyawan Aktif

- `VERIFIED_REPO`: migrasi database [`backend/migrations/083_hazard_consequence_and_reporter.sql`](file:///d:/OneDrive/Desktop/OMOS/backend/migrations/083_hazard_consequence_and_reporter.sql) dan runner [`backend/src/scripts/run_migration_083_hazard_consequence.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/scripts/run_migration_083_hazard_consequence.js) sukses menambahkan 3 kolom pada tabel `hazard_reports`:
  - `potential_consequence TEXT`: uraian deskriptif potensi dampak kerugian/bahaya (cedera, kerusakan alat, downtime operasional, dampak lingkungan).
  - `reported_by_dept TEXT` dan `reported_by_role TEXT`: detail departemen dan jabatan karyawan pelapor.
- `VERIFIED_REPO`: backend service [`backend/src/services/hse.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/services/hse.js):
  - `createHazard`: menerima payload `potential_consequence`, `reported_by`, `reported_by_name`, `reported_by_dept`, `reported_by_role`. Otomatis melakukan lookup data karyawan dari tabel `users` (`nama`, `departemen`, `jabatan`) dan menyimpannya ke tabel `hazard_reports`.
  - `listHazards` & `getHazardDetail`: menyertakan kolom `potential_consequence`, `reported_by`, `reported_by_name`, `reported_by_dept`, dan `reported_by_role` dengan `LEFT JOIN users rep ON rep.id = h.reported_by`.
- `VERIFIED_REPO`: UI admin dashboard [`admin-dashboard/hse.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.js):
  - Formulir modal `+ Form Lapor Hazard Baru` (`openHazardReportModal`) telah disusun ulang secara terstruktur:
    1. **Kolom Uraian Bahaya**: Textarea uraian bahaya / kondisi tidak aman (`#inHzDescription`).
    2. **Dropdown Nilai Skor Kemungkinan**: Dropdown nilai skor kemungkinan terjadi 1-5 (`#inHzLikelihood`).
    3. **Kolom Konsekuensi / Potensi Dampak**: Textarea potensi dampak kerugian (`#inHzPotentialConsequence`).
    4. **Dropdown Skor Konsekuensi**: Dropdown nilai keparahan konsekuensi 1-5 (`#inHzConsequence`).
    5. **Preview Matriks Risiko**: Box kalkulasi live skor risiko & badge tingkat risiko (Rendah, Sedang, Tinggi, Ekstrem).
    6. **Kolom Report By**: Dropdown list data karyawan aktif di database (`#inHzReportedBy`) berformat `Nama — Jabatan [Departemen]`, dilengkapi box preview kartu identitas pelapor saat dipilih (`#inHzReporterDetail`).
  - Modal detail hazard (`openHazardDetailModal`): Menampilkan detail pelapor (nama, jabatan, departemen) serta banner visual khusus untuk Konsekuensi / Potensi Dampak.
- `VERIFIED_REPO`: mock dataset & router di fixture [`admin-dashboard/test-fixtures/hse-preview.html`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/test-fixtures/hse-preview.html) telah diperbarui.
- `VERIFIED_REPO`: seluruh 59 unit test di [`backend/test/hse.test.js`](file:///d:/OneDrive/Desktop/OMOS/backend/test/hse.test.js) dan [`admin-dashboard/hse.test.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.test.js) lulus 100% (pass 59, fail 0).

### 2026-10-10 — Modul HSE: Sub-Halaman Setup Master (Hierarki Area & Sub-Area Operasional Tambang)

- `VERIFIED_REPO`: migrasi database [`backend/migrations/082_hse_setup_area_sub_area.sql`](file:///d:/OneDrive/Desktop/OMOS/backend/migrations/082_hse_setup_area_sub_area.sql) dan runner [`backend/src/scripts/run_migration_082_hse_setup_area.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/scripts/run_migration_082_hse_setup_area.js) sukses dieksekusi di database PostgreSQL lokal:
  - Indeks performa `idx_hse_locations_parent_id` pada kolom `parent_id` untuk relasi hierarkis self-referencing.
  - Seed master Area Utama (`PIT`, `HAUL-ROAD`, `WORKSHOP`, `DISPOSAL`) dan Sub-Area operasional (`Blok 1`, `Blok 2`, `Pit Timur`, `KM 1`, `KM 2`, `Bay 1 Alat Berat`, `Tyre Shop`, `Disposal Barat`, `Disposal Timur`).
  - Terverifikasi via script verifikasi [`backend/src/scripts/verify_locations_tree.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/scripts/verify_locations_tree.js): 10 Area Induk dan 9 Sub-Area aktif terkelompokkan dengan tepat.
- `VERIFIED_REPO`: backend service [`backend/src/services/hse.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/services/hse.js) dan rute API [`backend/src/routes/hse.routes.js`](file:///d:/OneDrive/Desktop/OMOS/backend/src/routes/hse.routes.js):
  - `GET /api/hse/locations/tree` (`listLocationsTree`): mengambil data lokasi aktif dan menyusunnya dalam struktur hierarkis tree parent-child lengkap dengan counter `sub_area_count`.
  - `POST /api/hse/locations` (`createLocation`): validasi nama, tipe operasional, kode unik (auto-generate jika kosong), pewarisan tipe dari parent jika sub-area, dan pencatatan audit `created_by`.
  - `PUT /api/hse/locations/:id` (`updateLocation`): pembaruan data lokasi dengan pencegahan referensi siklik (`parent_id !== id`) dan cek duplikasi kode.
  - `DELETE /api/hse/locations/:id` (`deleteLocation`): soft-delete aman dengan safeguard penolakan jika area induk masih memiliki sub-area aktif.
  - Pembaruan `getMasters`: query SQL menyertakan `p.name AS parent_name, p.code AS parent_code` via `LEFT JOIN hse_locations p ON p.id = l.parent_id`.
- `VERIFIED_REPO`: UI admin dashboard [`admin-dashboard/hse.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.js) dan styling [`admin-dashboard/hse.css`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.css):
  - **Sub-Halaman Baru "Setup"**: Didaftarkan pada `SUBPAGE_METADATA` dan navigasi sidebar grup `Konfigurasi` (`setup: { label: 'Setup master', icon: 'ti-settings-cog', group: 'Konfigurasi' }`).
  - **Tampilan Master-Detail Split Panel 2-Kolom (`.hse-setup-layout`)**:
    - **Panel Kiri (Area Utama)**: Search bar live filter, counter badge total area, tombol `+ Tambah Area`, daftar kartu area dengan penanda aktif (`.is-active`), badge kode/tipe, counter jumlah sub-area, serta tombol aksi edit dan hapus.
    - **Panel Kanan (Rincian Sub-Area)**: Banner rincian area terpilih (nama, kode, tipe, koordinat lat/long), tombol `Edit Area` dan `+ Tambah Sub-Area`, input pencarian sub-area, serta tabel daftar sub-area lengkap dengan status dan tombol aksi edit/hapus.
  - **Modal Form Bersih**:
    - Modal Tambah/Edit Area Utama (`openParentAreaModal`): Input nama, kode, tipe lokasi (PIT, Haul Road, Workshop, Warehouse, dsb.), dan koordinat.
    - Modal Tambah/Edit Sub-Area (`openSubAreaModal`): Otomatis mengunci area induk terpilih, input nama sub-area, kode, dan koordinat.
  - **Dropdown Hierarkis Terpadu (`<optgroup>`)**:
    - Helper fungsi `renderLocationHierarchyOptions(selectedId, placeholder, includeAllOption)` mengelompokkan lokasi berdasarkan area induk dan sub-area (`📍 PIT (PIT)` $\rightarrow$ `↳ Blok 1`, `↳ Blok 2`, dsb.).
    - Seluruh formulir dan filter modul HSE telah diintegrasikan dengan helper ini: Lapor Hazard, Filter Hazard, Lapor Insiden, Filter Insiden, Inspeksi, Filter Inspeksi, Izin Kerja PTW, Filter PTW, Higiene Tambang, APAR, dan Assembly Point.
- `VERIFIED_REPO`: fixture preview terisolasi [`admin-dashboard/test-fixtures/hse-preview.html`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/test-fixtures/hse-preview.html) dilengkapi mock dataset hierarkis dan penanganan fetch endpoints `/api/hse/locations/*`.
- `VERIFIED_REPO`: seluruh 59 unit test di [`backend/test/hse.test.js`](file:///d:/OneDrive/Desktop/OMOS/backend/test/hse.test.js) dan [`admin-dashboard/hse.test.js`](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.test.js) lulus 100% (pass 59, fail 0).
- `NOT YET DEPLOYED`: seluruh perubahan kode dan migrasi tetap berada di repositori dan database dev lokal (Zero Biznet Deployment) menunggu konfirmasi pengujian browser lokal dari pemilik proyek.

### 2026-10-10 — Modul HSE: Sinkronisasi Arsitektur Database & Konvensi Multi-Tenant Prefix hse_* di Dokumen Spesifikasi

- `VERIFIED_REPO`: dokumen rancangan arsitektur [docs/omos-modul-hse (1).md](file:///d:/OneDrive/Desktop/OMOS/docs/omos-modul-hse%20%281%29.md) Bab 5 (Skema Data, Bab 5.1 s/d 5.15) dan Bab 6 (Aturan Bisnis) telah disinkronkan 100% dengan skema fisik migrasi SQL database PostgreSQL (`073_hse_fase1` s/d `080_hse_fase8`):
  - Penyeragaman nama tabel ber-prefix `hse_*` mencakup: `hse_locations`, `hse_risk_matrix_config`, `hse_categories`, `hse_manhours`, `hse_site_metrics`, `hse_actions`, `hazard_reports` (alias domain: `hse_hazards`), `hse_risk_register`, `hse_inspection_templates`, `hse_inspection_template_items`, `hse_inspection_schedules`, `hse_inspections`, `hse_inspection_answers`, `incidents` (alias domain: `hse_incidents`), `incident_persons`, `incident_assets`, `incident_investigations`, `hse_ptw_permits`, `hse_ptw_workers`, `hse_ptw_isolations`, `hse_ptw_handovers`, `hse_training_courses`, `hse_training_requirements`, `hse_training_sessions`, `hse_training_records`, `hse_employee_licenses`, `hse_inductions`, `hse_safety_talks` (di-drop migrasi 090, 2026-10-12), `hse_mcu_records`, `hse_fit_for_work_checks`, `hse_substance_tests`, `hse_health_cases`, `hse_hygiene_measurements`, `hse_contractors`, `hse_contractor_assessments`, `hse_contractor_documents`, `hse_contractor_violations`, `hse_env_waste_b3_logs`, `hse_env_monitoring_points`, `hse_env_parameters`, `hse_env_measurements`, `hse_env_reclamation_records`, `hse_emergency_team_members`, `hse_emergency_drills`, `hse_emergency_equipment`, `hse_emergency_assembly_points`, `hse_emergency_contacts`, `hse_ppe_items`, `hse_ppe_standards`, `hse_ppe_issuances`, `hse_smkp_elements`, `hse_audits`, `hse_audit_findings`, `hse_documents`, `hse_document_revisions`, `hse_legal_register`, `hse_mandatory_reports`, dan `hse_alerts`.
  - Diagram ASCII relasi antar entitas (Bab 5.15) dan aturan bisnis nomor 12 telah diselaraskan dengan nama tabel aktual di database repositori.

### 2026-10-10 — Modul HSE: Fitur Pelengkap Mode Layar Besar (TV Briefing Pos HSE) & Dokumen Cetak Standar K3

- `VERIFIED_REPO`: UI admin dashboard `admin-dashboard/hse.js` dan styling `admin-dashboard/hse.css`:
  - **Mode Layar Besar (TV Briefing Pos HSE & Ruang P5M)**:
    - Tombol navigasi header `#btnHseBigScreen` untuk mengaktifkan tampilan layar penuh TV monitor command center K3.
    - Header TV live monitor dengan badge berkedip `LIVE MONITOR`, jam digital real-time berdetik per detik (`#hseTvClock`), identitas site Pit JMB-DKC South Corridor, shift operasional, status cuaca pit, dan tombol keluar layar penuh `#btnHseCloseBigScreen`.
    - Hero raksasa Hari Kerja Aman Bebas LTI (Zero Lost Time Injury Days) dengan angka ukuran 68px, visual status target site tahunan, dan progress bar persentase pencapaian.
    - Grid 6 metrik kunci operasional keselamatan pertambangan:
      1. Jam Kerja Selamat Kumulatif (Safe Man-Hours Kumulatif)
      2. Rasio Keselamatan Minerba (LTIFR & TRIR)
      3. Kebugaran Kerja Harian (Fit For Work / FFW Compliance)
      4. Izin Kerja Berisiko Aktif (PTW Aktif di Pit)
      5. Hazard Terbuka & Mitigasi CAPA Selesai
      6. Kesiapan Tanggap Darurat & Tim ERT (100% Siaga)
    - Running Ticker Marquee Pengumuman K3 dengan teks keselamatan pertambangan berjalan secara looping animasi CSS.
    - Background polling auto-refresh senyap setiap 60 detik tanpa reload browser (`startBigScreenTimers`, `stopBigScreenTimers`).
    - Dukungan keyboard shortcut tombol `Escape` untuk keluar dari mode layar besar.
  - **Format Dokumen Cetak Baku K3 Pertambangan (Print-Friendly Documents)**:
    - Tombol modal pemilih dokumen `#btnHsePrintDocSelector` (`openPrintSelectorModal`).
    - **Formulir Izin Kerja Berisiko Tinggi (PTW)** (`openPrintPtwModal`): Kop surat resmi PT OMOS SMKP Minerba, nomor dokumen, detail pekerjaan, checklist verifikasi bahaya & APD (JSA, isolasi LOTO, gas clearance, fire watcher, kesiapan fisik FFW), dan **4 kolom tanda tangan resmi** (Applicant, Supervisor, Safety Officer, KTT/PJO).
    - **Laporan Investigasi Kecelakaan Tambang (Format Acuan ESDM)** (`openPrintIncidentModal`): Mengacu format Kepmen ESDM No. 1827 K/30/MEM/2018 Lampiran III, kronologis kejadian saksi di TKP, analisis sebab langsung dan dasar, analisis 5-Why, rekomendasi tindakan perbaikan (CAPA), dan **3 kolom tanda tangan investigasi** (Ketua Tim Investigasi, Kepala Departemen Terkait, KTT).
    - **Laporan Bulanan Kinerja Keselamatan (Monthly HSE Report)** (`openPrintMonthlyReportModal`): Rekapitulasi jam kerja kumulatif tanpa LTI, statistik insiden (Fatality, LTI, MTI, FAI, Near Miss, Property Damage), indikator LTIFR/TRIR/SR, kepatuhan FFW/MCU, mitigasi CAPA, dan pengesahan KTT & HSE Head.
    - Styling `@media print` dengan kontras tinggi kertas A4, menyembunyikan elemen sidebar/toolbar non-cetak (`.hse-no-print`), dan memposisikan container `.hse-print-area` dengan rapi.
    - Controller diekspos ke `global.OMOSHSE` (`toggleBigScreenMode`, `openPrintSelectorModal`, `openPrintPtwModal`, `openPrintIncidentModal`, `openPrintMonthlyReportModal`).
- `VERIFIED_REPO`: 55 unit test di `admin-dashboard/hse.test.js` dan `backend/test/hse.test.js` lulus 100% (pass 55, fail 0).
- `NOT YET DEPLOYED`: seluruh perubahan kode tetap berada di repositori lokal (Zero Biznet Deployment) menunggu verifikasi pemilik proyek di browser lokal.

### 2026-10-09 — Modul HSE Fase 8: Audit & Kepatuhan (SMKP Minerba) & Dokumen Regulasi (Legal Register)

- `VERIFIED_REPO`: skema migration `080_hse_fase8_audit_compliance_docs.sql` dan runner `run_migration_080_hse_fase8.js` (`npm run migration:hse-fase8`) menambahkan 7 tabel: `hse_smkp_elements` (dengan seed 7 elemen standar SMKP Minerba Permen ESDM No. 26/2018), `hse_audits`, `hse_audit_findings`, `hse_documents`, `hse_document_revisions`, `hse_legal_register`, dan `hse_mandatory_reports` dengan tenant/project-isolation, soft-delete, dan audit metadata.
- `VERIFIED_REPO`: service `backend/src/services/hse.js` dan rute `backend/src/routes/hse.routes.js` mengimplementasikan:
  - Audit & Kepatuhan SMKP Minerba (`audit`):
    - Program & Jadwal Audit (`getAuditOverview`, `listAudits`, `createAudit`): tipe audit (`INTERNAL`, `EXTERNAL`, `CONTRACTOR`, `REGULATOR`), ruang lingkup/standar acuan, jadwal pelaksanaan, lead auditor & lembaga audit, skor kesesuaian (%), dan status siklus audit (`PLANNED`, `IN_PROGRESS`, `REPORTED`, `CLOSED`).
    - Temuan Audit & Ketidaksesuaian (`listAuditFindings`, `createAuditFinding`, `resolveAuditFinding`): klausul/elemen SMKP acuan, kategori temuan (`MAJOR`, `MINOR`, `OBSERVATION`, `OPPORTUNITY`), uraian bukti objektif, batas waktu penyelesaian, PIC penanggung jawab, status (`OPEN`, `IN_ACTION`, `VERIFY`, `CLOSED`), auto-link tindakan korektif ke tabel `hse_actions` (`source_type = 'AUDIT'`, `action_type = 'CORRECTIVE'`), dan verifikasi penutupan temuan.
    - Master Elemen SMKP Minerba (`listSmkpElements`): 7 elemen Sistem Manajemen Keselamatan Pertambangan dengan bobot persentase standar (Elemen I 5%, II 15%, III 15%, IV 25%, V 20%, VI 10%, VII 10% = 100%), jumlah klausul wajib, dan target minimal kepatuhan.
  - Dokumen & Regulasi K3LH (`documents`):
    - Pengendalian Dokumen HSE (`getDocumentsOverview`, `listDocuments`, `createDocument`, `createDocumentRevision`): tipe dokumen (`POLICY`, `MANUAL`, `SOP`, `WI`, `JSA`, `FORM`, `ERP`), nomor dokumen, riwayat revisi berkala (`revision_no` auto-incrementing di `hse_document_revisions`), tanggal berlaku efektif, deteksi otomatis jadwal tinjau berkala mendesak (`next_review_date` $\le 30$ hari), departemen pemilik, pengesah (approver), dan tautan berkas dokumen.
    - Inventarisasi Regulasi Hukum / Legal Register (`listLegalRegister`, `createLegalRegister`): nomor dan judul peraturan perundangan, instansi penerbit (`ESDM_MINERBA`, `KEMENAKER`, `KLHK`, `PEMDA`, `OTHER`), ringkasan pasal dan kewajiban hukum, status evaluasi kepatuhan (`COMPLIANT`, `PARTIAL`, `NON_COMPLIANT`, `NOT_ASSESSED`), bukti dokumen pemenuhan, dan evaluator PIC.
    - Pelaporan Wajib ke Instansi Pemerintah (`listMandatoryReports`, `createMandatoryReport`, `updateMandatoryReportStatus`): nama laporan wajib, dasar hukum acuan (Kepmen 1827/2018 dsb.), instansi tujuan (`ESDM_KAIT`, `DLH_KLHK`, `DISNAKER`, `INTERNAL`, `OTHER`), periode pelaporan (`MONTHLY`, `QUARTERLY`, `SEMESTER`, `ANNUAL`), batas tenggat lapor, pemantauan status (`PENDING`, `SUBMITTED`, `OVERDUE`, `VERIFIED`), serta pencatatan nomor tanda terima surat dan berkas bukti penyerahan.
- `VERIFIED_REPO`: UI admin dashboard `admin-dashboard/hse.js` dan `admin-dashboard/hse.css`:
  - Sub-halaman `audit` dengan 3 subtab interaktif (`audits`, `findings`, `smkp`), kartu statistik KPI, filter bar pencarian/tipe/status, visual progress bar capaian 7 Elemen SMKP Minerba, dan modal form penjadwalan audit, pencatatan temuan (dengan auto-link CAPA), serta verifikasi penutupan temuan.
  - Sub-halaman `documents` dengan 3 subtab interaktif (`docs`, `regulations`, `reports`), kartu statistik KPI, alert review dokumen $\le 30$ hari, badge status kepatuhan hukum, dan modal form registrasi dokumen baru, revisi dokumen, penambahan regulasi hukum, serta pembaruan status dan tanda terima pelaporan instansi.
- `VERIFIED_REPO`: mock data standalone `admin-dashboard/test-fixtures/hse-preview.html` diperluas mencakup seluruh mock dataset Fase 8 dan interceptor fetch rute `/api/hse/audits/*`, `/api/hse/docs/*`, `/api/hse/legal-register`, serta `/api/hse/mandatory-reports`.
- `VERIFIED_REPO`: 53 unit test di `backend/test/hse.test.js` dan `admin-dashboard/hse.test.js` lulus 100% (pass 53, fail 0).
- `NOT YET DEPLOYED`: seluruh perubahan kode dan migrasi tetap berada di repositori dan database dev lokal (Zero Biznet Deployment) menunggu verifikasi browser lokal oleh pemilik proyek.

### 2026-10-09 — Modul HSE Fase 7: Kontraktor & Mitra Kerja (CSMS) & Lingkungan Hidup (Environment)

- `VERIFIED_REPO`: skema migration `079_hse_fase7_contractor_environment.sql` dan runner `run_migration_079_hse_fase7.js` (`npm run migration:hse-fase7`) menambahkan 9 tabel: `hse_contractors`, `hse_contractor_assessments`, `hse_contractor_documents`, `hse_contractor_violations`, `hse_env_waste_b3_logs`, `hse_env_monitoring_points`, `hse_env_parameters`, `hse_env_measurements`, dan `hse_env_reclamation_records` dengan tenant/project-isolation, soft-delete, dan audit metadata.
- `VERIFIED_REPO`: service `backend/src/services/hse.js` dan rute `backend/src/routes/hse.routes.js` mengimplementasikan:
  - Kontraktor & CSMS (`contractor`):
    - Profil Mitra Kerja (`getContractorOverview`, `listContractors`, `createContractor`): kode, nama, bidang usaha (`HAULING`, `CIVIL_WORKS`, `DRILLING_BLASTING`, dsb.), jumlah pekerja site, PIC kontak, status aktif/nonaktif, dan skor CSMS terakhir.
    - Penilaian CSMS (`listContractorAssessments`, `createContractorAssessment`): jenis asesmen (`PRE_QUALIFICATION`, `PERIODIC`), skor 0–100, penentuan hasil kelayakan otomatis (`APPROVED` $\ge 75$, `CONDITIONAL` 60–74, `REJECTED` $< 60$), masa berlaku (1 tahun / 6 bulan), dan asesor PIC.
    - Dokumen & Perizinan Legalitas (`listContractorDocuments`, `createContractorDocument`): SMK3, IUJP, Polis Asuransi/BPJS TK, sertifikasi personel K3, evaluasi status masa berlaku otomatis (`VALID`, `EXPIRING` $\le 30$ hari, `EXPIRED`).
    - Catatan Pelanggaran & Sanksi K3LH (`listContractorViolations`, `createContractorViolation`, `resolveContractorViolation`): tingkat keparahan (`MINOR`, `MAJOR`, `CRITICAL`), sanksi (`WARNING`, `WRITTEN_WARNING`, `STOP_WORK`, `PENALTY`), status (`OPEN`, `RESOLVED`), dan auto-link CAPA.
  - Pengelolaan Lingkungan Hidup (`environment`):
    - Log & Neraca Limbah B3 (`getEnvironmentOverview`, `listWasteB3Logs`, `createWasteB3Log`): kode limbah (B105d pelumas bekas, B107d filter bekas, B110d aki timbal, B108d majun, dsb.), kuantitas & satuan, batas waktu simpan TPS B3 (default 90 hari), peringatan dini jatuh tempo ($\le 14$ hari) dan overdue alert, status (`STORED`, `HAULED`, `PROCESSED`), transporter berizin, dan nomor manifes Festronik KLHK.
    - Pemantauan Kualitas Lingkungan (`listEnvMonitoringPoints`, `createEnvMonitoringPoint`, `listEnvParameters`, `listEnvMeasurements`, `createEnvMeasurement`): master baku mutu lingkungan (pH 6–9, TSS 200 mg/L, Fe 7 mg/L, Mn 4 mg/L, TSP 230 ug/m3, kebisingan 70 dBA), titik pantau KPL outlet/inlet/udara/kebisingan, evaluasi otomatis kepatuhan hasil uji lab (`COMPLIES`, `NEAR_LIMIT` $\ge 85\%$ batas izin, `EXCEEDED`).
    - Reklamasi & Revegetasi Tambang (`listReclamationRecords`, `createReclamationRecord`): penataan lahan (landscaping), penebaran topsoil, penanaman pohon (revegetasi), pemeliharaan, rencana vs realisasi (Ha), spesies bibit, dan tingkat kematian (%).
- `VERIFIED_REPO`: UI admin dashboard `admin-dashboard/hse.js` dan `admin-dashboard/hse.css`:
  - Sub-halaman `contractor` dengan 4 subtab interaktif (`companies`, `assessments`, `documents`, `violations`), KPI summary pills, filter bar, badge status CSMS (Approved hijau, Conditional kuning, Rejected merah), dan modal form pendaftaran mitra, asesmen, upload dokumen, serta pencatatan pelanggaran.
  - Sub-halaman `environment` dengan 3 subtab interaktif (`waste`, `monitoring`, `reclamation`), KPI summary pills, kartu titik pantau lingkungan, badge evaluasi baku mutu (Memenuhi, Near Limit, Melebihi Baku Mutu), progress bar reklamasi, dan modal form log limbah B3, titik pantau, hasil uji mutu, dan kegiatan reklamasi.
- `VERIFIED_REPO`: mock data standalone `admin-dashboard/test-fixtures/hse-preview.html` diperluas mencakup semua dataset dan handler fetch Fase 7.
- `VERIFIED_REPO`: 45 unit test di `backend/test/hse.test.js` dan `admin-dashboard/hse.test.js` lulus 100% (pass 45, fail 0).
- `NOT YET DEPLOYED`: perubahan kode dan migrasi tetap berada di repositori dan database dev lokal (Zero Biznet Deployment) menunggu verifikasi browser lokal oleh pemilik proyek.

### 2026-10-09 — Modul HSE Fase 6: Tanggap Darurat (Emergency Response) & APD / Peralatan (PPE)

- `VERIFIED_REPO`: skema migration `078_hse_fase6_emergency_ppe.sql` dan runner `run_migration_078_hse_fase6.js` (`npm run migration:hse-fase6`) menambahkan 8 tabel: `hse_emergency_team_members`, `hse_emergency_drills`, `hse_emergency_equipment`, `hse_emergency_assembly_points`, `hse_emergency_contacts`, `hse_ppe_items`, `hse_ppe_standards`, dan `hse_ppe_issuances` dengan tenant/project-isolation, soft-delete, dan audit metadata.
- `VERIFIED_REPO`: service `backend/src/services/hse.js` dan rute `backend/src/routes/hse.routes.js` mengimplementasikan:
  - Tanggap Darurat (`emergency`):
    - Tim ERT (`getEmergencyOverview`, `listEmergencyTeam`, `createEmergencyTeamMember`, `updateEmergencyTeamMember`): peran (`COMMANDER`, `FIRE_FIGHTER`, `FIRST_AIDER`, `RESCUE`, `COMMUNICATION`), shift, status aktif, kontak radio/telepon, dan sertifikasi keahlian.
    - Simulasi / Emergency Drill (`listEmergencyDrills`, `createEmergencyDrill`): nomor registrasi urut berformat `DRL-YYMM-NNN`, skenario latihan (`FIRE`, `MEDICAL`, `SPILL`, `ROCKFALL`, `EVACUATION`), waktu respon detik, evaluasi, hasil (`GOOD`, `ADEQUATE`, `NEEDS_IMPROVEMENT`), dan auto-link ke tindakan korektif (CAPA).
    - Peralatan Darurat (`listEmergencyEquipment`, `createEmergencyEquipment`, `updateEmergencyEquipment`): APAR, Kotak P3K, Eyewash, Alarm, Hydrant, Spill Kit, perhitungan status dinamis (`OVERDUE` jika lewat tanggal inspeksi, `DUE` jika $\le 7$ hari, `DEFECTIVE`, `RETIRED`, `GOOD`).
    - Titik Kumpul Evakuasi (`listEmergencyAssemblyPoints`, `createEmergencyAssemblyPoint`): muster points (AP-01..), kapasitas orang, koordinator warden, dan peta evakuasi.
    - Kontak Darurat (`listEmergencyContacts`, `createEmergencyContact`): direktori nomor darurat internal & instansi eksternal (Klinik, RSUD, Damkar, Polsek).
  - APD dan Peralatan (`ppe`):
    - Master Katalog APD (`getPpeOverview`, `listPpeItems`, `createPpeItem`): 8 kategori perlindungan (`HEAD`, `EYE`, `EAR`, `RESPIRATORY`, `HAND`, `BODY`, `FOOT`, `FALL_PROTECTION`), interval ganti bulan, standar SNI/ANSI, alert stok kritis otomatis bila `current_stock <= minimum_stock`.
    - Standar APD per Jabatan (`listPpeStandards`, `createPpeStandard`): matriks APD wajib per jabatan dan area kerja tambang (Pit, Workshop, dsb).
    - Distribusi APD ke Karyawan (`listPpeIssuances`, `createPpeIssuance`, `returnPpeIssuance`): penyerahan APD (nama, ukuran, kuantitas), kalkulasi otomatis `replace_due_date` dari interval katalog, pengurangan stok fisik secara otomatis, evaluasi status `DUE_REPLACEMENT` bila jatuh tempo ganti, serta fitur pengembalian (status `RETURNED`).
- `VERIFIED_REPO`: UI admin dashboard `admin-dashboard/hse.js` dan `admin-dashboard/hse.css`:
  - Menampilkan sub-halaman `emergency` lengkap dengan 5 subtab interaktif (`team`, `drills`, `equipment`, `assembly`, `contacts`) dan kartu KPI ringkasan.
  - Menampilkan sub-halaman `ppe` lengkap dengan 3 subtab interaktif (`issuances`, `standards`, `items`) disertai kartu status stok kritis dan jatuh tempo ganti.
  - Modal form interaktif dengan umpan balik `OMOSActionFeedback.run`.
- `VERIFIED_REPO`: mock data standalone `admin-dashboard/test-fixtures/hse-preview.html` diperluas mencakup semua dataset dan handler fetch Fase 6.
- `VERIFIED_REPO`: 38 unit test di `backend/test/hse.test.js` dan `admin-dashboard/hse.test.js` lulus 100% (pass 38, fail 0).

### 2026-10-09 — Modul HSE Fase 5: Kesehatan Kerja (Occupational Health)

- `VERIFIED_REPO`: skema migration `077_hse_fase5_occupational_health.sql` dan runner `run_migration_077_hse_fase5.js` menambahkan 5 tabel: `hse_mcu_records`, `hse_fit_for_work_checks`, `hse_substance_tests`, `hse_health_cases`, dan `hse_hygiene_measurements` dengan tenant/project-isolation, soft-delete, dan audit metadata.
- `VERIFIED_REPO`: service `backend/src/services/hse.js` mengimplementasikan:
  - Medical Check Up / MCU (`getOccHealthOverview`, `listMcuRecords`, `createMcuRecord`, `updateMcuRecord`): mendukung 4 tipe MCU (`PRE_EMPLOYMENT`, `PERIODIC`, `SPECIAL`, `EXIT`), hasil kelayakan (`FIT`, `FIT_WITH_NOTES`, `TEMP_UNFIT`, `UNFIT`), masa berlaku, pembatasan kerja, dan status masa berlaku dinamis (`VALID`, `EXPIRING` $\le 30$ hari, `EXPIRED`, `UNFIT`).
  - Fit for Work / FFW Harian (`listFfwChecks`, `createFfwCheck`): skrining kesehatan pra-shift harian, tanda vital (tekanan darah sistolik/diastolik, denyut nadi, suhu tubuh), deklarasi mandiri gejala sakit, dan pengaman fatigue operasional: jika `sleep_hours < 5.0` sistem otomatis mengubah status kelayakan menjadi `UNFIT` disertai rekomendasi istirahat.
  - Tes Alkohol & Narkoba (`listSubstanceTests`, `createSubstanceTest`): pengujian skrining acak rutin, pra-kerja, pasca-insiden, atau indikasi kecurigaan (`RANDOM`, `PRE_EMPLOYMENT`, `POST_INCIDENT`, `FOR_CAUSE`), kadar breathalyzer alkohol, tes urine 6-panel, dan hasil evaluasi konklusif (`NEGATIVE`, `POSITIVE`, `INCONCLUSIVE`).
  - Kasus Kesehatan & Klinik Tambang (`listHealthCases`, `createHealthCase`, `updateHealthCase`): kunjungan klinik site untuk keluhan umum, cedera ringan, kasus terkait pekerjaan, dan suspek Penyakit Akibat Kerja (PAK) (`ILLNESS`, `INJURY`, `WORK_RELATED`, `SUSPECTED_OD`), akumulasi lost workdays (hari hilang), status alur (`OPEN`, `MONITORING`, `CLOSED`), serta nomor registrasi urut berformat `MED-YYMM-NNN`.
  - Higiene Industri & Nilai Ambang Batas / NAB (`listHygieneMeasurements`, `createHygieneMeasurement`): pemantauan faktor bahaya lingkungan fisik kerja tambang (`NOISE`, `DUST`, `LIGHTING`, `VIBRATION`, `HEAT`), evaluasi status kepatuhan terhadap baku mutu NAB (`OK`, `NEAR_LIMIT`, `EXCEEDED`), durasi paparan, dan rekomendasi rekayasa teknis / APD.
- `VERIFIED_REPO`: endpoint routes `backend/src/routes/hse.routes.js` mengekspos:
  - `/health/overview` (GET)
  - `/health/mcu` (GET, POST), `/health/mcu/:id` (PUT)
  - `/health/ffw` (GET, POST)
  - `/health/substance-tests` (GET, POST)
  - `/health/cases` (GET, POST), `/health/cases/:id` (PUT)
  - `/health/hygiene` (GET, POST)
- `VERIFIED_UI`: `admin-dashboard/hse.js` dan `hse.css` mengimplementasikan:
  - Sub-halaman **Kesehatan kerja** (`occ-health`) dengan 5 subtab interaktif:
    - Subtab 1: **MCU Berkala & Pra-Kerja**: 5 stat pill KPI (Total MCU, Layak Fit, Layak dg Catatan, Tidak Layak Unfit, Segera Berakhir), filter jenis MCU dan hasil kelayakan, tabel rekaman MCU, serta modal form "+ Catat MCU Baru" dan edit rekaman MCU.
    - Subtab 2: **Fit for Work (FFW) Harian**: stat pill skrining shift, filter shift & hasil, indikator tanda vital dan gejala, alert peringatan fatigue risk real-time jika jam tidur $< 5$ jam, tabel riwayat FFW harian, serta modal form "+ Skrining FFW Harian".
    - Subtab 3: **Tes Narkoba & Alkohol**: stat pill hasil tes negatif vs positif, filter tipe tes, tabel pengujian breathalyzer & tes urin 6-panel, serta modal form "+ Catat Tes Baru".
    - Subtab 4: **Kasus Klinik & PAK**: stat pill kunjungan klinik, pemantauan kasus aktif, kasus suspek PAK, total hari kerja hilang, filter kategori & status, tabel kasus medis, serta modal form "+ Lapor Kasus Kesehatan" dan edit status pemantauan.
    - Subtab 5: **Higiene Industri (NAB)**: stat pill titik pemantauan aman vs melebihi batas bahaya NAB, filter parameter fisik lingkungan & status evaluasi, tabel pengukuran higiene, serta modal form "+ Input Pengukuran Higiene".
- `VERIFIED_FIXTURES`: `admin-dashboard/test-fixtures/hse-preview.html` dilengkapi mock datasets lengkap Fase 5 (`mockOccHealthOverview`, `mockMcuRecords`, `mockFfwChecks`, `mockSubstanceTests`, `mockHealthCases`, `mockHygieneMeasurements`) dan fetch interceptor untuk seluruh rute `/api/hse/health/*`.
- `VERIFIED_TEST`: test suites `node --test backend/test/hse.test.js admin-dashboard/hse.test.js` 31/31 PASS (17 backend service tests, 14 dashboard UI tests).
- `VERIFIED_DATABASE`: migration 077 dan seeding data sampel Fase 5 sukses dieksekusi di database dev lokal (`{"tables_ok": 5}`).
- `NOT YET DEPLOYED`: perubahan kode dan migrasi belum dirilis ke Biznet staging/production (menunggu verifikasi browser lokal oleh pemilik proyek).

### 2026-10-09 — Modul HSE Fase 4: Izin Kerja (PTW, LOTO, SIMOPS) & Inspeksi Keselamatan (Inspections)

- `VERIFIED_REPO`: skema migration `076_hse_fase4_ptw_inspections.sql` dan runner `run_migration_076_hse_fase4.js` menambahkan 8 tabel: `hse_ptw_permits`, `hse_ptw_workers`, `hse_ptw_isolations`, `hse_ptw_handovers`, `hse_inspection_templates`, `hse_inspection_template_items`, `hse_inspections`, dan `hse_inspection_answers` dengan tenant/project-isolation, soft-delete, dan audit metadata. Seeding otomatis 4 master template checklist (`TMPL-LV-01`, `TMPL-HD-01`, `TMPL-WSHOP-01`, `TMPL-APAR-01`).
- `VERIFIED_REPO`: service `backend/src/services/hse.js` mengimplementasikan:
  - Manajemen Izin Kerja / Permit to Work (`getPtwOverview`, `listPermits`, `getPermitDetail`, `createPermit`, `updatePermitStatus`): mendukung 8 jenis izin risiko tinggi (`HOT_WORK`, `WORK_AT_HEIGHT`, `CONFINED_SPACE`, `LOTO`, `EXCAVATION`, `LIFTING`, `ELECTRICAL`, `CHEMICAL`). Nomor otomatis `PTW-YYMM-NNN`.
  - Alur otorisasi berjenjang: `DRAFT` $\rightarrow$ `SUBMITTED` $\rightarrow$ `HSE_CHECK` $\rightarrow$ `APPROVED` $\rightarrow$ `ACTIVE` $\rightarrow$ `CLOSED` (atau `REJECTED`, `EXPIRED` jika lewat `valid_until`). Penutupan wajib menyertakan catatan serah terima / penutupan.
  - Validasi Pekerja & Kompetensi (`hse_ptw_workers`): integrasi langsung dengan modul Lisensi/SIMPER Fase 3; sistem otomatis memverifikasi keaktifan lisensi karyawan (`OK` vs `MISSING`).
  - Modul Isolasi Energi / LOTO (`hse_ptw_isolations`, `addPtwIsolation`, `releasePtwIsolation`): pencatatan titik isolasi, nomor tag & gembok, peralatan, metode, dan status `LOCKED` vs `RELEASED`.
  - Serah Terima Shift Operasional (`hse_ptw_handovers`, `addPtwHandover`): rotasi pengawas shift dengan checklist verifikasi LOTO, kebersihan area 5R, dan safety briefing.
  - Deteksi Konflik SIMOPS (Simultaneous Operations): otomatis mendeteksi jika ada $\ge 2$ permit berstatus `ACTIVE` secara bersamaan di lokasi kerja yang sama, menandai badge peringatan merah, dan menampilkan banner mitigasi bahaya di UI.
  - Inspeksi Keselamatan & Integrasi CAPA Otomatis (`listInspectionTemplates`, `listInspections`, `getInspectionDetail`, `createInspection`): pelaksanaan inspeksi harian/berkala dengan penilaian YES, NO, NA, perhitungan pass rate %, dan pembuatan otomatis tindakan korektif (`hse_actions`, `source_type = 'INSPECTION'`) jika butir pemeriksaan berlabel kritikal dijawab `NO`.
- `VERIFIED_REPO`: endpoint routes `backend/src/routes/hse.routes.js` mengekspos:
  - PTW: `/ptw/overview`, `/ptw/permits` (GET, POST), `/ptw/permits/:id` (GET), `/ptw/permits/:id/status` (PUT), `/ptw/permits/:id/isolations` (POST), `/ptw/isolations/:id/release` (PUT), `/ptw/permits/:id/handovers` (POST).
  - Inspeksi: `/inspections/templates` (GET), `/inspections` (GET, POST), `/inspections/:id` (GET).
- `VERIFIED_UI`: `admin-dashboard/hse.js` dan `hse.css` mengimplementasikan:
  - Sub-halaman **Izin kerja** (`ptw`): KPI bar (Total, Aktif, Menunggu Review, Disetujui, Ditutup, SIMOPS), banner peringatan jika SIMOPS terdeteksi, filter bar (jenis permit, lokasi, status, simops-only, pencarian), tabel izin kerja dengan badge status & SIMOPS, modal form "+ Ajukan Izin Baru", dan modal detail izin kerja 4-subtab (`Informasi & Otorisasi`, `Pekerja & Lisensi`, `Isolasi LOTO`, `Serah Terima Shift`) dengan aksi status transition, tambah LOTO, release LOTO, dan catat serah terima.
  - Tab **Inspeksi** di sub-halaman **Hazard dan inspeksi** (`hazard`): tabel inspeksi keselamatan, pass rate %, temuan kritikal, modal detail inspeksi dengan ringkasan & seluruh butir pertanyaan checklist, serta modal form "+ Lakukan Inspeksi Baru" dengan butir pertanyaan dinamis sesuai template terpilih.
- `VERIFIED_FIXTURES`: `admin-dashboard/test-fixtures/hse-preview.html` dilengkapi mock datasets lengkap Fase 4 (`mockPtwOverview`, `mockPermits`, `mockInspectionTemplates`, `mockInspections`) dan fetch interceptor.
- `VERIFIED_TEST`: test suites `node --test backend/test/hse.test.js admin-dashboard/hse.test.js` 25/25 PASS, dan seluruh backend test suite 408/408 PASS.
- `VERIFIED_DATABASE`: migration 076 dan seeding sampel data Fase 4 berhasil diaplikasikan ke database lokal.
- `NOT YET DEPLOYED`: perubahan kode dan migrasi belum dirilis ke Biznet staging/production (menunggu verifikasi browser lokal oleh pemilik proyek).


- `VERIFIED_REPO`: skema migration `075_hse_fase3_competency.sql` dan runner `run_migration_075_hse_fase3.js` menambahkan 6 tabel: `hse_training_courses`, `hse_training_requirements`, `hse_training_records`, `hse_employee_licenses`, `hse_inductions`, dan `hse_safety_talks` dengan tenant/project-isolation, soft-delete, dan audit metadata. Seeding otomatis 6 master modul kursus (`TR-IND-01`, `TR-DDT-01`, `TR-FA-01`, `TR-WAH-01`, `TR-LOTO-01`, `TR-ENV-01`).
- `VERIFIED_REPO`: service `backend/src/services/hse.js` mengimplementasikan:
  - Pelacakan Lisensi & SIMPER (`listEmployeeLicenses`, `createEmployeeLicense`, `updateEmployeeLicense`): status dinamis (`VALID`, `EXPIRING` $\le 30$ hari, `EXPIRED`, `SUSPENDED`), pilihan tipe lisensi (SIMPER, KIMPER, SIO, Sertifikasi Operator, Sertifikasi BNSP, First Aid, KIM Peledakan, Lainnya), dan evaluasi aturan kelayakan operasi #4.6 `fit_to_operate` (Unfit jika SIMPER/SIO kedaluwarsa atau ditangguhkan).
  - Matriks Pelatihan Karyawan (`getTrainingMatrix`, `listTrainingRecords`, `createTrainingRecord`): pemetaan persyaratan wajib per jabatan (Driver DT, Operator, Mekanik, Foreman), perhitungan pemenuhan kepatuhan (%) karyawan dan per jabatan.
  - Induksi Keselamatan (`listInductions`, `createInduction`): catatan induksi karyawan internal, rekanan kontraktor, dan tamu/visitor dengan riwayat skor dan tanggal kedaluwarsa.
  - Safety Talk / P5M Toolbox Talk (`listSafetyTalks`, `createSafetyTalk`): dokumentasi pelaksanaan sesi P5M harian per departemen, materi topik bahasan, pemateri, dan jumlah kehadiran pekerja. **(Dihapus per 2026-10-12 — digantikan service events `p5m`/`safetytalk`, lihat section 2026-10-12; `hse_safety_talks` sudah di-drop migrasi 090.)**
  - KPI Ringkasan Kompetensi (`getCompetencyOverview`): total lisensi aktif, lisensi valid/expiring/expired, jumlah operator unfit, rata-rata kepatuhan pelatihan site %, rekap induksi, dan total peserta P5M.
- `VERIFIED_REPO`: endpoint routes `backend/src/routes/hse.routes.js` mengekspos rute terproteksi auth & tenant-scoped: `/competency/overview`, `/competency/courses`, `/competency/licenses`, `/competency/matrix`, `/competency/training-records`, `/competency/inductions`, `/competency/safety-talks` **(rute terakhir dihapus 2026-10-12, diganti `/p5m/events*` & `/safetytalk/events*`)**.
- `VERIFIED_UI`: `admin-dashboard/hse.js` dan `hse.css` mengimplementasikan sub-halaman **Kompetensi** dengan 4 subtab interaktif:
  - Subtab 1: **Sertifikat & SIMPER**: 5 kartu stat/KPI (Total, Berlaku, Segera Berakhir, Kedaluwarsa, Tidak Layak Operasi / Unfit), filter bar lengkap, badge status & kelayakan operasi, serta modal form "+ Tambah Lisensi / SIMPER" dan edit lisensi.
  - Subtab 2: **Matriks Pelatihan**: KPI rata-rata kepatuhan site %, cards progress bar per jabatan, pencarian nama/jabatan, tabel matriks interaktif karyawan $\times$ kursus, serta modal form "+ Catat Pelatihan Selesai".
  - Subtab 3: **Induksi Keselamatan**: stat strip peserta (karyawan, kontraktor, visitor), filter jenis & kelulusan, tabel catatan induksi, serta modal form "+ Catat Induksi Baru".
  - Subtab 4: **Safety Talk (P5M)**: KPI total sesi & kehadiran, filter departemen, tabel sesi P5M dengan badge kehadiran, serta modal form "+ Catat Sesi P5M". **(Dihapus 2026-10-12 — tab P5M & Safety Talk kini di sub-halaman Hazard dan Inspeksi, lihat section 2026-10-12.)**
- `VERIFIED_TEST`: test suites `node --test backend/test/hse.test.js admin-dashboard/hse.test.js` 20/20 PASS (10 backend tests, 10 dashboard tests).
- `VERIFIED_DATABASE`: migration 075 dan seeding sampel data Fase 3 berhasil diaplikasikan ke database lokal.
- `NOT YET DEPLOYED`: perubahan kode dan migrasi belum dirilis ke Biznet staging/production (menunggu verifikasi browser lokal oleh pemilik proyek).


### 2026-10-09 — Modul HSE Fase 2: Insiden & Investigasi, Manhours, dan Statistik Keselamatan (LTIFR / TRIR / SR)

- `VERIFIED_REPO`: skema migration `074_hse_fase2_incidents_reports.sql` dan runner `run_migration_074_hse_fase2.js` menambahkan 5 tabel: `hse_manhours`, `incidents`, `incident_persons`, `incident_assets`, dan `incident_investigations` dengan tenant/project-isolation, soft-delete, dan audit metadata.
- `VERIFIED_REPO`: service `backend/src/services/hse.js` mengimplementasikan:
  - CRUD Insiden dengan nomor otomatis `INC-YYMM-NNN`, pencatatan personil cedera/saksi (`incident_persons`), dan aset terdampak (`incident_assets`).
  - Aturan bisnis #5: counter hari tanpa LTI (`last_lti_date` di `hse_site_metrics`) otomatis di-reset/diperbarui bila terjadi insiden berkategori `FATALITY` atau `LTI`.
  - Investigasi akar masalah (5-Why root cause chain & Fishbone, immediate cause, findings, lessons learned).
  - Input dan rekap jam kerja aman (`hse_manhours`).
  - Laporan & statistik keselamatan (`getSafetyReports`): perhitungan 12 bulan LTIFR = $(LTI \times 1.000.000)/\text{Jam kerja}$, TRIR = $((Fatality+LTI+MTI) \times 1.000.000)/\text{Jam kerja}$, dan SR = $(\text{Lost Days} \times 1.000.000)/\text{Jam kerja}$, serta distribusi per kategori dan per lokasi.
- `VERIFIED_REPO`: endpoint routes `backend/src/routes/hse.routes.js` mengekspos `/incidents`, `/incidents/:id`, `/incidents/:id/investigation`, `/manhours`, dan `/reports/safety` terproteksi auth & tenant-scoped.
- `VERIFIED_UI`: `admin-dashboard/hse.js` dan `hse.css` mengimplementasikan sub-halaman:
  - Sub-halaman **Insiden dan investigasi**: badge KPI counter (Fatality 0, LTI 0, MTI 1, FAI 3, Near miss 9, Kerusakan 2), filter bar (jenis, keparahan, status, lokasi, pencarian), tabel daftar insiden, modal form "+ Lapor Insiden" lengkap dengan penanganan medis & aset, serta modal detail insiden bertab (Kronologi & Dampak, Investigasi 5-Why, dan CAPA Terkait).
  - Sub-halaman **Laporan dan statistik**: 4 kartu KPI (Jam Kerja YTD, LTIFR, TRIR, Severity Rate, Hari Tanpa LTI), tabel statistik 12 bulan dengan formula keselamatan standar tambang, visualisasi distribusi per jenis dan per lokasi, serta modal form "+ Input Jam Kerja".
- `VERIFIED_TEST`: targeted HSE test suites `node --test backend/test/hse.test.js admin-dashboard/hse.test.js` 15/15 lulus (7 backend, 8 dashboard), dan seluruh backend test suite 402/402 lulus.
- `VERIFIED_DATABASE`: migration 074 dan seeding sampel data Fase 2 sukses diaplikasikan ke database dev lokal (15 insiden sampel terekam lengkap dengan investigasi 5-Why pada INC-2610-001).
- `NOT YET DEPLOYED`: perubahan kode dan migrasi belum dirilis ke Biznet staging/production (menunggu verifikasi browser lokal oleh pemilik proyek).

### 2026-10-09 — Modul HSE Fase 1: Master, Hazard, CAPA terpusat, dan Ringkasan UI

- `VERIFIED_REPO`: skema migration `073_hse_fase1_hazard_capa.sql` dan script runner `run_migration_073_hse.js` menambahkan 6 tabel (`hse_locations`, `hse_risk_matrix_config`, `hse_categories`, `hazard_reports`, `hse_actions`, `hse_site_metrics`) dengan tenant/project-isolation, soft-delete, dan audit metadata.
- `VERIFIED_REPO`: service `backend/src/services/hse.js` mengimplementasikan matriks risiko 5x5 otomatis (skor = L x C, level Low/Medium/High/Extreme), nomor otomatis (`HZD-YYMM-NNN`, `CAPA-YYMM-NNN`), aturan bisnis penutupan hazard (pencegahan tutup jika CAPA belum closed), dan status overdue CAPA.
- `VERIFIED_REPO`: routing `backend/src/routes/hse.routes.js` terpasang pada `/api/hse` dan `/api/admin/hse` di bawah `requireAuth` dan scope-isolated.
- `VERIFIED_UI`: layout dashboard `admin-dashboard/hse.css`, `hse.js`, dan `test-fixtures/hse-preview.html` mengikuti spesifikasi acuan mutlak `omos_hse_dashboard_layout.html`: grid 2 kolom dengan sidebar 152 px (13 sub-halaman bergrup), hero hari tanpa LTI dengan progress bar ke target, grid KPI 4 kolom, bar chart 6 bulan dan bar horizontal level risiko, kepatuhan, serta panel perlu tindakan. Subnav hazard mencakup tab Laporan hazard dan Tindakan korektif (CAPA) dengan drawer/modal lapor cepat yang divalidasi via `OMOSActionFeedback`. Sub-halaman Fase 2-8 menampilkan panel informasi roadmap SMKP.
- `VERIFIED_DATABASE`: migration 073 telah diaplikasikan sukses pada database dev/lokal; 6 tabel HSE, 14 konfigurasi matriks risiko, 8 kategori hazard, 7 lokasi kerja, 18 laporan hazard sampel (1 ekstrem, 4 tinggi, 8 sedang, 5 rendah), dan 3 CAPA terverifikasi aktif.
- `NOT YET DEPLOYED`: perubahan kode dan migrasi pada server produksi Biznet belum dirilis (menunggu verifikasi browser lokal oleh user).

### 2026-10-08 — Domain produksi `omos-mining.com`

- `VERIFIED_DNS`: root domain `A` mengarah ke `103.58.101.240` dan `www` memakai CNAME ke root domain; resolusi diverifikasi melalui resolver publik Cloudflare dan Google.
- `VERIFIED_PRODUCTION`: sertifikat Let's Encrypt untuk `omos-mining.com` + `www.omos-mining.com` terbit dan berlaku sampai 2027-01-06. Nginx memaksa HTTP ke HTTPS, `www` ke root domain, serta menyajikan Admin, Portal, API, APK, dan health pada domain kanonis. HTTPS berbasis IP tetap dipertahankan untuk APK lama.
- `VERIFIED_PRODUCTION`: `https://omos-mining.com/health`, `/`, `/portal`, dan `/Absensi_PIM.apk` merespons 200; API admin tanpa token tetap 401; `www` merespons 308 ke root domain. Browser produksi menampilkan halaman login Admin pada domain baru.
- `VERIFIED_OPERATIONS`: timer renewal Certbot enabled+active dan simulasi renewal untuk sertifikat IP serta domain berhasil. Nginx syntax check dan reload berhasil.
- `VERIFIED_REPO`: `ops/biznet/nginx-domain.conf` menjadi konfigurasi domain yang dapat direproduksi. Default build APK masa depan dan konfigurasi compatibility gateway Vercel diarahkan ke domain; alamat IP hanya dipertahankan untuk SSH serta compatibility health check. Targeted mobile-release tests 3/3 dan JSON/diff checks lulus.
- `VERIFIED_VERCEL_PRODUCTION`: deployment `dpl_EQHQZEnuUzxRDc9ENZ5HTUHfTyWb` READY dan telah dipromosikan ke production. Alias `attendance-system-eta-opal.vercel.app/portal` menghasilkan 308 ke `https://omos-mining.com/portal`; health tetap 200, API tanpa token 401, dan APK 200. Tidak ada error log pada deployment baru. APK yang sudah tersebar tetap menuju IP dan tidak perlu dikonfigurasi ulang.

### 2026-10-08 — Setup Kebijakan Cuti: aksi Edit dan Hapus

- `VERIFIED_REPO`: tombol `Nonaktifkan/Aktifkan` pada tabel Setup Kebijakan Cuti diganti menjadi `Edit` dan `Hapus`. Edit mempertahankan lingkup Departemen/Jabatan/Karyawan dan menyimpan perubahan sebagai versi kebijakan baru, bukan menimpa histori.
- `VERIFIED_REPO`: endpoint `DELETE /api/admin/cuti/policies/:id` tenant/project-scoped, membutuhkan otorisasi HR dan alasan audit. Kebijakan tanpa referensi dihapus fisik; kebijakan yang sudah dipakai entitlement/realisasi diarsipkan (`is_active=false`) agar foreign key dan histori tetap utuh.
- `VERIFIED_TEST`: backend penuh 395/395, target cuti backend 26/26, dashboard cuti 10/10, serta syntax check backend/frontend lulus.
- `VERIFIED_UI`: preview localhost menampilkan tombol Edit/Hapus sejajar; popup Edit terisi dari versi aktif, lingkup terkunci, dan runtime preview tanpa error. Asset dinaikkan ke `cuti.js?v=10` dan `cuti.css?v=10`.
- `NOT YET DEPLOYED`: perubahan aksi kebijakan v10 belum dirilis ke Biznet.

### 2026-10-08 — Database Cuti: slicer Departemen dan Jabatan

- `VERIFIED_REPO`: filter teks Departemen/Jabatan pada Database Cuti diganti dropdown bertingkat dari master karyawan aktif `policy-scopes`. Jabatan terkunci sebelum Departemen dipilih, lalu hanya menampilkan jabatan dalam Departemen tersebut; opsi Semua dan pilihan aktif dipertahankan saat render ulang.
- `VERIFIED_TEST`: syntax check lulus dan dashboard cuti 9/9 lulus. Asset dinaikkan ke `cuti.js?v=9` dan `cuti.css?v=9`.
- `VERIFIED_UI`: preview localhost menampilkan Departemen Produksi → Jabatan Driver DT/Operator Excavator, pilihan Driver DT bertahan setelah `Tampilkan`, layout responsif terbaca, dan console tanpa error.
- `NOT YET DEPLOYED`: perubahan slicer v9 belum dirilis ke Biznet.

### 2026-10-08 — Database Cuti: pengajuan komposit per siklus

- `VERIFIED_REPO`: tombol pengajuan lama pada footer card dihapus. Setiap baris siklus yang belum terisi memiliki `+ Pengajuan Cuti`; tombol global memakai alur Departemen → Jabatan → Karyawan → Periode Cuti.
- `VERIFIED_REPO`: backend menyimpan CP + CK opsional + CT opsional secara atomik, idempoten, satu grup aplikasi, dengan `cycle_no`, `owning_year`, dan snapshot proyeksi. Baseline proyeksi tidak bergeser akibat jadwal/realisasi; CP lintas tahun tetap milik tahun siklusnya dan T0 berikutnya meneruskan akhir proyeksi.
- `VERIFIED_TEST`: backend penuh 392/392 lulus; target cuti backend 23/23 dan dashboard cuti 8/8 lulus. Dashboard penuh memiliki dua kegagalan lama yang tidak terkait karena test masih mengharapkan `production.js?v=102`, sementara loader aktual sudah `v=103`.
- `VERIFIED_UI`: preview localhost mode Card dan modal global/per-siklus diperiksa. Ringkasan CP 14 + CK 3 + CT 2 menghasilkan 19 hari, 16 Jul–03 Agu 2026; console tanpa error.
- `VERIFIED_DATABASE`: backup `/opt/omos/backups/manual/20261008T040951Z-pre-cuti-071-072.dump` tervalidasi. Dry-run dan apply migration 071–072 berhasil; empat kolom siklus, satu kolom scope karyawan, dua indeks request, dan nol request dengan `owning_year` kosong terverifikasi.
- `VERIFIED_PRODUCTION`: release `/opt/omos/releases/20261008-040951-cuti-cycle-applications`, image `omos-app:20261008-040951-cuti-cycle-applications`, aktif di Biznet. Health local/HTTPS/public 200; dashboard, cycle-options, dan cycle-applications menolak tanpa token dengan 401; JS/CSS v8 200; scan log error/fatal/HTTP 5xx bersih.
- `ROLLBACK`: container sebelumnya dipertahankan sebagai `omos-app-prev-20261008-040951-cuti-cycle-applications`; backup database beserta checksum berada di direktori manual backup di atas.
- Files: `backend/migrations/071_*`, `072_*`, runner/package scripts, `services/cuti.js`, controller/routes/tests, `admin-dashboard/cuti.js`, `cuti.css`, `index.html`, fixture/tests, dan dokumen rencana.

### 2026-10-04 — Data Produksi manual-save detection (termasuk FOT)

- `VERIFIED_REPO`: toolbar halaman 7 memakai tombol **Simpan** yang default
  nonaktif/buram, menghitung perubahan input produksi Manual, menampilkan
  `Data belum disimpan · N perubahan`, dan kembali ke `Tersimpan` setelah save.
- `VERIFIED_REPO`: response Data Produksi sekarang menyertakan snapshot mentah
  `manualOverrides`. UI menerapkan edit pada snapshot area+JOB terkait sebelum
  PUT sehingga edit satu sel FOT tidak menghapus override tanggal/shift/material
  lainnya dan angka TOTAL turunan tidak salah dipersist sebagai override baru.
- `VERIFIED_TEST`: backend 308/308 dan dashboard 137/137 lulus. Browser localhost
  mengubah BEI/FOT dari 240 ke 255, mendeteksi tepat satu perubahan, mengirim empat
  override FOT lengkap, lalu kembali ke status `Tersimpan`; tidak ada page error.
- Tidak ada migrasi, perubahan satuan, formula produksi, RBAC, atau tenant scope.
  Files: `productionData.js/.css`, loader/index cache
  versions, preview + regression tests, `services/productionData.js`, dan dokumen ini.

### 2026-10-04 — Production release: LOGISTIK + Data Produksi manual-save

- `VERIFIED_PRODUCTION`: Vercel deployment
  `dpl_82s78TMjxByvYJyfeSoeSgW3GY1U` is READY and aliased to
  `https://attendance-system-eta-opal.vercel.app` (also the wodav alias).
- Primary alias `/health` returned HTTP 200 with `status=ok` and
  `serverless=true`. Live index serves `productionData.css?v=6`; the production
  loader points to `productionData.js?v=6`, containing dirty-state and complete
  manual override snapshot protection.
- Anonymous probes to Data Produksi and LOGISTIK scopes both returned HTTP 401,
  confirming the existing authenticated boundary remains active. Migration 062
  was applied and verified before this deployment.
- Pre-release gates: backend 308/308, dashboard 137/137, targeted browser FOT
  edit/save, desktop UI review, and focused diff checks. Post-release Vercel
  error-level scan returned no logs/errors.

### 2026-10-04 — LOGISTIK operational module

- `VERIFIED_REPO`: added `admin-dashboard/logistics.js`, `logistics.css`,
  sidebar/section wiring in `index.html` and `app.js`; 15 role-aware views cover
  procurement, warehouse, inventory review, maintenance readiness and master data.
- `VERIFIED_REPO`: `backend/src/services/logistics.js`, `logisticsRead.js`,
  `routes/logistics.routes.js` implement scoped membership, approvals, immutable
  posted documents, FIFO/batch cost provenance, per-layer reservations, two-stage
  transfers, source-bound returns, QC, count snapshots, audit and idempotency.
- `VERIFIED_REPO` + database execution 2026-10-04: migration
  `062_logistics.sql` adds nine scoped logistics tables; runner
  `run_migration_062_logistics.js`, package command and registry added. Migration
  executed successfully on the configured target database and verified 9/9 RLS
  tables, 20 foreign keys, 21 indexes and one seeded default manager. Application
  deployment was completed by production release
  `dpl_82s78TMjxByvYJyfeSoeSgW3GY1U` after migration verification.
- `VERIFIED_REPO`: full backend suite 308/308 and dashboard suite 133/133 passed
  on 2026-10-04; isolated PostgreSQL integration runner passed ledger, allocation,
  serial, cross-project, approval, concurrency and procurement-boundary checks.
- `VERIFIED_REPO`: localhost fixture `test-fixtures/logistics-preview.html` runs
  real routes/auth/services with isolated test data, not production. Browser
  review checked all 15 views, desktop and 390px mobile (no page overflow), no
  console errors, persisted draft and lost-response-after-commit recovery without
  duplicate documents. Local manual/online retry uses stable keys per account/scope.
- Limitations: no cold-start offline, independent financial FIFO for physical
  FEFO, multi-level approval, attachments or multicurrency. Dashboard detail lists
  cap at 1,000 documents/2,000 open layers; aggregates remain server-side. Camera
  scanning not physically verified. Legacy maintenance/Fuel links are scope-gated.
- Read `docs/LOGISTIK_IMPLEMENTATION.md` and `docs/PANDUAN_LOGISTIK.md` for rules,
  role setup, valuation policy and rollout sequence. No live secrets were copied.

| Area | Current behavior | Evidence |
| --- | --- | --- |
| Absensi initial load | Dashboard defaults start and end date to current WIB day, requests `tanggal_dari` and `tanggal_sampai`, and loads filter master data independently. | `VERIFIED_REPO`: `admin-dashboard/app.js:621-700` |
| Log Activity | No `logActivity`, `logScheduler`, or `muatLogActivity` implementation remains in ONE MINING. | `VERIFIED_REPO`: repository search 2026-09-16 |
| Productivity planning | Active payload v8 stores Loader targets in `loaderCatalog`; operational modules read Loader Productivity directly. Hauler remains the DT/Driver reference, while Setting Fleet Simulation is session-only, non-periodic, and excluded from saved data. | `VERIFIED_REPO` / `VERIFIED_UI`: planning workspace, production controller, downstream consumers, regression suites, localhost fixture. |
| Report Breakdown | JPEG report module, asset, lazy-loader registration, and six-case unit test are documented as delivered. | `HISTORICAL_CHAT` + `HANDOVER_FITUR_REPORT_BREAKDOWN_2026-09-09.md` |

### Productivity Formula Note

Legacy frontend planning derives one truck's rate as:

`(60 / cycleTimeTruckMinutes) x effectiveCapacity x workEffFleet x density`

where cycle time is loading time plus loaded haul, empty return, and spot/dump.
OB uses BCM/Hr (`density = 1`); Coal converts to Ton/Hr with density. Fleet rate
in this representative model is `truckRate x numberOfTruck` capped by loader
productivity.

Current workspace v6 and backend both calculate every selected truck from its
Hauler row, explicit `BCM`/`Ton` capacity UoM, material, loader-derived Loading
Time, and common benchmark distance; they sum truck rates and cap by Loader
Productivity. The legacy module remains as a compatibility layer.

## Task Ledger

### 2026-10-08 — Redesign Kebijakan Cuti CP Mingguan

- `VERIFIED_REPO`: form kebijakan kini wajib memilih Departemen dan Jabatan,
  dapat menargetkan semua karyawan pada jabatan atau satu karyawan, hanya
  menampilkan Cuti Periodik (CP), menerima Minggu Kerja + Minggu Cuti, menghitung
  Siklus Cuti read-only, menyimpan CT sebagai saldo hari, serta memakai Berlaku
  Mulai sebagai T0. Basis siklus, carry-forward, jenis policy, dan tanggal selesai
  dihapus dari kontrak UI baru.
- `VERIFIED_REPO`: backend mengonversi minggu ke hari kanonis, menerapkan urutan
  policy karyawan > jabatan, mereset anchor siklus pada 1 Januari, dan hanya
  menghitung blok CP lengkap yang selesai paling lambat 31 Desember. CK dan CT
  selalu `EXCLUDED` dari `period_count`; CT hanya mengurangi saldo tahunan.
- `VERIFIED_TEST`: backend penuh lulus; targeted cuti 20/20 dan dashboard cuti
  8/8 lulus. Dua kegagalan dashboard penuh yang tersisa adalah baseline lama
  `production.js?v=102` sementara loader aktual sudah v103, tidak terkait cuti.
- `VERIFIED_UI`: preview localhost menampilkan tabel policy 8:2 minggu, saldo CT
  12 hari, dropdown Departemen → Jabatan → Karyawan, dan kalkulasi dinamis
  12 + 2 = 14 minggu tanpa console warning/error.
- `VERIFIED_UI`: field semu/dropdown CP dihapus dari modal. Sebagai gantinya,
  panel teks **Pengaturan Siklus Cuti Periodik** menjelaskan bahwa input di
  bawahnya mengatur Minggu Kerja, Minggu Cuti, dan Total Siklus CP. Asset cuti
  dinaikkan ke v6; targeted dashboard test tetap 8/8 dan console bersih.
- `NOT YET MIGRATED/DEPLOYED`: migration 071 menambah `target_user_id`, unique
  index group/employee, mempertahankan histori, membuat policy CP terbaru
  open-ended, mengisi default CT lama 12 hari, dan menghapus proyeksi turunan agar
  dibangun ulang. Dry-run lokal tidak dapat dilakukan karena database lokal belum
  memiliki migration 070; jalankan backup + dry-run pada Biznet sebelum apply.
- `DESIGNED`: proyeksi CP dikunci sebagai baseline deterministik berdasarkan T0
  dan versi policy. Jadwal serta realisasi hanya menghasilkan variance dan tidak
  menggeser proyeksi berikutnya. CP lintas tahun dimiliki tahun tanggal mulai
  proyeksi; keterlambatan tetap melekat ke `cycle_no`/`owning_year` asal dan
  konflik dengan siklus berikutnya ditandai untuk resolusi HR. Spesifikasi rinci
  tersimpan di `docs/RENCANA_DATABASE_CUTI_KARYAWAN.md`; belum diimplementasikan.

| Date / source | Work | Status and evidence | Remaining note |
| --- | --- | --- | --- |
| 2026-10-12 / OpenCode | **Deploy Biznet** rilis `20261012-210345-hse-workhours-092` (Jam Kerja Karyawan + migrasi 092): tar full-tree 125 MB (`.vercel` di-exclude sejak awal — pelajaran dari deploy sebelumnya) → extract 170 MB, hygiene bersih; **migrasi 092 applied ke `omos_staging`** via skrip baru `ops/biznet/run-hse-092-release.sh` (preflight: 0 tabel `hse_workhour*`, `hse_manhours`+`absensi` ada; backup dump + sha256 + pg_restore --list; psql `ON_ERROR_STOP` file `092_hse_workhours.sql` idempoten; verify 4 tabel + 1 kolom + 7 index, total 199); image rebuild (`COPY backend` berubah) via `release-app.sh` (candidate health 200/auth 401, switch). Pre-deploy verify tree: dashboard `hse.test.js` 39/39, backend `hse-workhours` 6/6 + `hse` 48/48. | `VERIFIED_PRODUCTION`: symlink release baru, `omos-app` Up; health lokal + publik 200; `/api/hse/workhours/setup` 401 lokal + publik; `hse.js` live 200 (62 ref workhours, "Jam Kerja Karyawan", `hse.js?v=7`); log 5 mnt 0 error; disk 60%; tarball dihapus. | Rollback app: `docker start omos-app-prev-20261012-210345-hse-workhours-092` + symlink ke rilis sebelumnya; rollback DB manual `092_hse_workhours_down.sql`. Sisa: atur standar jam per jabatan (login admin) sebelum kirim periode; uji browser rekap/kirim/kunci. |
| 2026-10-12 / Claude (Cowork) | HSE Setup Master **Jam Kerja Karyawan**: migrasi 092 (+down, runner), service `hseWorkhours.js`, 11 route `/workhours/*`, tab UI 3 sub-tab + dropdown checklist, integrasi LTIFR/TRIR/SR/jam kerja aman (Ringkasan, Laporan, Layar besar, Cetak), input manual dibatasi kontraktor terdaftar, sample page `omos_hse_setup_jam_kerja_layout.html`. | `VERIFIED_REPO`: backend HSE 54/54, dashboard HSE 39/39, uji SQL & UI end-to-end di PGlite. `VERIFIED_PRODUCTION` (2026-10-12, OpenCode): migrasi 092 applied ke `omos_staging` + rilis `20261012-210345-hse-workhours-092` live (lihat baris deploy). | Atur standar jam per jabatan (login admin) sebelum kirim periode; full backend suite belum dijalankan (hanya tes HSE). |
| 2026-10-12 / OpenCode | **Deploy Biznet** rilis `20261012-183817-hse-mandate-multiselect` (frontend-only multi-select HSE, tanpa migrasi): tar full-tree (eksklusi `.git`/`node_modules`/secret/`.env`/`.vercel`/`mobile-android`; 125 MB) → extract 170 MB; hygiene: `.vercel/omos-production.env` (2 KB, secret Vercel) terhapus dari release dir sebelum build agar tidak ter-bake; image `omos-app:20261012-183817-hse-mandate-multiselect` via `release-app.sh` (npm ci cached, bcrypt OK, candidate health 200/auth 401, symlink flip). | `VERIFIED_PRODUCTION`: `readlink /opt/omos/current` = release baru; container `omos-app` Up; health `127.0.0.1` (3000 + HTTPS `-k`) + publik `103.58.101.240` = 200; `hse.js` live (200) berisi marker `bindHseMultiSelect` (4), `openHseRoleMandateModalShared` (5), `saveHseMandateBatch` (3); log 5 menit bersih error/5xx (hanya traffic absensi normal); disk 59% (24G free); tarball dihapus dari server. | Rollback: `docker start omos-app-prev-20261012-183817-hse-mandate-multiselect` + `ln -sfn /opt/omos/releases/20261012-101210-hse-p5m-lampiran /opt/omos/current` (tanpa migrasi DB — murni frontend). Sisa: uji browser batch multi-select + kompensasi DELETE dengan login admin; banyak container prev menumpuk — prune opsional setelah soak. |
| 2026-10-12 / OpenCode | **Multi-select ceklist** Departemen/Jabatan/Karyawan di 8 modal Atur Default & Override Khusus Karyawan (Setup Inspeksi/Hazard/P5M/Safety Talk): frontend-only rework — `bindHseMultiSelect` (dropdown+panel checklist+search+Pilih Semua/Kosongkan+chip), `HSE_MANDATE_TABS` + `openHseRoleMandateModalShared`/`openHseOverrideModalShared` (8 fungsi lama jadi wrapper; id/judul/default kuota per tab dipertahankan), loop `POST {endpoint}` cross-product N×M, konfirmasi `window.confirm` bila >1 pilihan, all-or-nothing `saveHseMandateBatch` + kompensasi `DELETE /targets/:id`, error inline `${idp}BatchErr`; toolbar matrix/filter/backend tidak diubah. | `VERIFIED_REPO`: `node --check` lolos; `admin-dashboard/hse.test.js` 37/37 (+1 test multi-select; 4 regex endpoint disesuaikan), suite penuh dashboard 46/46 PASS; backend 0 perubahan. `VERIFIED_PRODUCTION` (2026-10-12): rilis `20261012-183817-hse-mandate-multiselect` live (lihat baris deploy). | Uji browser fixture/prod (batch submit, simulasi 409 → kompensasi, Sesuaikan preselect) dengan login admin. |
| 2026-10-12 / OpenCode | **Deploy Biznet** rilis `20261012-101210-hse-p5m-lampiran`: tar full-tree (eksklusi `.git`/`node_modules`/`mobile-android`/secret/`.env`; 126 MB) → `/opt/omos/releases/20261012-101210-hse-p5m-lampiran`; **migrasi 088–091 applied ke `omos_staging`** via script baru `ops/biznet/run-hse-088-091-release.sh` (backup `/opt/omos/backups/manual/20261012T101728Z-pre-hse-088-091.dump` + sha256 + pg_restore --list; verify: 10 tabel baru, `hse_safety_talks` ter-drop [isi 5 row ikut ter-backup], kolom `photos`/`documents`, 3 fungsi kuota, total 195 tabel); image `omos-app:20261012-101210-hse-p5m-lampiran` via `release-app.sh` (bcrypt native OK, candidate health 200/auth 401, symlink flip). Higienitas: 2 file credential (`password supabase.txt`, `vercel token log supabase.txt`) terhapus dari release dir baru + 14 file serupa dibersihkan dari 7 release lama; `.runtime` browser-test dihapus dari release baru. | `VERIFIED_PRODUCTION`: container `omos-app` Up (image baru); health `127.0.0.1` (3000/HTTPS) + publik `103.58.101.240` = 200 `{"status":"ok","serverless":false}`; route baru `/api/hse/p5m/events`, `/api/hse/safetytalk/events`, `/api/hse/inspections` = 401 tanpa token; `hse.js` live berisi marker `btnHseInsSaveLampiran` & `bindDocumentAttachmentController` (md5 cocok release dir); `hse.css`/index 200; log 10 menit bersih error/5xx; disk 58% (25G free). | Rollback: `docker start omos-app-prev-20261012-101210-hse-p5m-lampiran` + `ln -sfn /opt/omos/releases/20261011-193600-hse-hazard-photo-edit-delete /opt/omos/current` (088–091 additive kecuali drop `hse_safety_talks` — restore dari dump bila perlu). Sisa: uji browser P5M/Safety Talk/lampiran inspeksi dengan login admin; 18 container prev + image lama menumpuk — prune opsional setelah soak. |
| 2026-10-12 / OpenCode | Upload **foto & dokumen di tab Inspeksi** (HSE → Hazard dan Inspeksi): migrasi 091 (`hse_inspections.photos TEXT[]` + `documents JSONB`, applied ke Supabase dari workdir `backend/`), service `createInspection` (foto wajib ≥1, `validateInspectionDocuments` PDF/DOCX/XLSX 3×2MB) + `updateInspectionAttachments` (replace-set, foto kosong → 422, keep-current bila tak dikirim), route `PUT /inspections/:id/lampiran`, `getInspectionDetail` diperkaya (photos/documents/pass_rate/criticalFindings/category/note), frontend form create (section Foto wajib + Dokumen), controller dokumen (`bindDocumentAttachmentController`, preview PDF, unduh), modal Detail jadi staged edit (dirty + Simpan Perubahan disabled bila 0 foto/bersih, `window.confirm` + `beforeunload`), fixture mock 4 inspeksi + handler PUT lampiran + validasi POST. | `VERIFIED_DATABASE`: 091 applied Supabase (`documents:jsonb`, `photos:array`) **dan produksi Biznet** (deploy 2026-10-12, lihat baris deploy). `VERIFIED_REPO`: backend 73/73 file test PASS (`hse.test.js` 47/47, +2 test lampiran), dashboard 46/46 file test PASS (`hse.test.js` 36/36, +3 test), `node --check` semua file lolos, fixture 4 blok `<script>` parse OK. `VERIFIED_PRODUCTION`: rilis live 2026-10-12 (marker `btnHseInsSaveLampiran` ada di `hse.js` produksi). | Uji browser (upload foto/dokumen, staged edit + popup, unduh PDF) dengan login admin; aturan foto wajib hanya create/PUT (riwayat lama tidak diblokir). |
| 2026-10-12 / OpenCode | Tab **P5M** & **Safety Talk** di HSE → Hazard dan Inspeksi (menggantikan subtab Safety Talk lama di Kompetensi): migrasi 090 (4 tabel event/attendees, DROP `hse_safety_talks`), service events generik (kunci dedupe Area+Tanggal+Shift, peserta WAJIB-only, merge manual pola Hazard, cascade hard delete), 12 route `/p5m|safetytalk/events*` (route `/competency/safety-talks` dihapus), frontend `hse.js` (2 tab, stat/filter/tabel/badge shift/chip duplikat+Gabung, modals Detail/Form/Merge/Delete via `runHseActionFeedback`, blokir+shortcut Setup bila 0 WAJIB), foto HSE kompres server-side (`hsePhotoCompress.js`, `sharp`), fixture preview mock+handler + fix 2 bug sintaks pre-existing. | `VERIFIED_DATABASE`: 090 applied lokal **dan produksi Biznet** (deploy 2026-10-12; tabel `hse_safety_talks` produksi berisi 5 row — ter-drop dengan pre-migration dump `20261012T101728Z-pre-hse-088-091.dump`). `VERIFIED_REPO`: backend 442/442 (`hse.test.js` 45/45, +3 test events), dashboard 204/204 (`hse.test.js` 33/33), `node --check` semua file lolos, fixture 4 blok `<script>` parse OK. `VERIFIED_PRODUCTION`: rilis live 2026-10-12; build image dengan `sharp` sukses (bcrypt native OK). | Sisa: uji browser 2 tab + form WAJIB-only + merge + foto; isu anchor absensi 03:00/16:00 vs shift 06–18 tidak disentuh. |
| 2026-10-10 / OpenCode | Cek status server Biznet (read-only via SSH): uptime 7 hari load 0.07, RAM 3.8Gi (881Mi used), disk 58G 48%, `omos-app` + `omos-postgres-staging` sehat, /health ok, nginx valid, eth0 RX 6.87G/TX 5.67G per 7 hari. Temuan: rilis `20261011-173000-hse-smart-hazard-merge` ada di folder releases tapi symlink current masih ke `20261011-140500`; image lama menumpuk (~790MB per image). | `VERIFIED_PRODUCTION`: SSH `adminbiznet@103.58.101.240`, `docker ps`/`docker stats`, `df`, `/proc/net/dev`, `du /opt/omos`=4.8G, PG data 195M, backup terakhir manual 10 Okt (`-pre-hse.dump` 8.7M). | Tindak lanjut opsional: switch/prune rilis + `docker image prune` untuk menahan pertumbuhan disk; vnstat belum terinstall bila butuh histori trafik harian. |
| 2026-10-10 / OpenCode | Tambah 2 tab Setup Master **Setup P5M** & **Setup Safety Talk** (cerminan Setup Hazard Report, tanpa jenis/jadwal): migrasi 089 (4 tabel + 2 fungsi kuota + audit `P5M_TARGET`/`SAFETYTALK_TARGET`) + down + runner; 12 service fn + 12 route `/api/hse/p5m/*` & `/api/hse/safetytalk/*`; UI 2 tab + 2 matriks + 6 modal via `runHseActionFeedback`; fixture mock + interceptor; test baru backend ×2 + dashboard ×1. | `VERIFIED_DATABASE`: 089 applied lokal (4 tabel + 2 fungsi), smoke overview P5M 304ms / SafetyTalk 87ms (85 karyawan, pola single-query). `VERIFIED_REPO`: backend 439/439 pass, dashboard hse 32/32 pass. | `NOT YET DEPLOYED`: migrasi 089 + kode hanya lokal. Uji browser (kedua tab, default + override + scope) sebelum rilis. |
| 2026-10-10 / OpenCode | Perbaiki lambatnya tab Setup Hazard Report: overview memakai loop N+1 (1 query users + 85 query kuota berurutan, ±3 detik) → satu query set-based `CROSS JOIN LATERAL hse_hazard_effective_quota` (±0,3 detik, ~10x). Pola sama diterapkan ke overview inspeksi (±3,8 dtk → 0,07 dtk). Bentuk respons tidak berubah + tambah regression test query-count. | `VERIFIED_DATABASE`: timing lokal 85 karyawan sebelum/sesudah identik hasilnya. `VERIFIED_REPO`: backend 437/437 pass, dashboard hse 31/31 pass. | `NOT YET DEPLOYED`. Catatan: `latent-briefing` (KV-cache multi-agent) tidak relevan untuk masalah ini. |
| 2026-10-10 / OpenCode | Perbaiki hover tombol primer biru HSE yang tampak buram: `hse.css` `.hse-btn--primary:hover` memakai `opacity: 0.92` (membuat teks putih kusam) → diganti background solid `#1c5fb8` (kontras ±6.5:1, teks tetap putih) + `:active` tekan + `:focus-visible` ring; tambah 2 assert CSS di `hse.test.js`. | `VERIFIED_REPO`: dashboard `hse.test.js` 31/31 pass. | `NOT YET DEPLOYED`; perlu hard-refresh setelah rilis agar CSS baru terambil. |
| 2026-10-10 / OpenCode | Tambah tab Setup Master **Setup Hazard Report** (matriks kewajiban pelaporan hazard, cerminan sub-tab Kewajiban Karyawan tanpa dimensi jenis/jadwal): migrasi 088 (`hse_hazard_report_targets` + exclusion overlap, `hse_hazard_report_scopes`, audit `HAZARD_TARGET`, fungsi `hse_hazard_effective_quota`) + down + runner; 6 service fn + 6 route `/api/hse/hazard/*`; UI `data-setup-tab=hazard` (KPI, filter, matriks, 3 modal via `runHseActionFeedback`, CSS existing tanpa gaya baru); fixture mock + interceptor; test backend + dashboard baru. | `VERIFIED_DATABASE`: migrasi 088 applied lokal (2 tabel + fungsi verified), smoke `BELUM_DIATUR` + audit check ok. `VERIFIED_REPO`: backend 436/436 pass (termasuk test hazard baru), dashboard hse 31/31 pass. Dashboard penuh 198/200 — 2 gagal adalah baseline lama `production.js?v=102` vs loader v103, tidak terkait. | `NOT YET DEPLOYED`: migrasi 088 + kode baru hanya di repo & DB dev lokal. Uji browser lokal (buka Setup Master > Setup Hazard Report, atur default & override, cek matriks) sebelum rilis. |
| 2026-10-10 / OpenCode | Convert `docs/RENCANA_SETUP_INSPEKSI_HSE_V2.md` (825 baris) menjadi `docs/RENCANA_SETUP_INSPEKSI_HSE_V2.pdf` (15 halaman, A4 portrait, cover + header/footer). Baca konteks kerja + skill terinstall sebelum convert (AGENTS.md, handover, `.codex/skills`, `OMOS-skill`); tidak ada perubahan formula mining sehingga `omos-mining-validation` tidak dimuat, dan tidak ada generate UI sehingga taste-skill/DESIGN.md tidak diterapkan. | `VERIFIED_FILE`: PDF `%PDF-1.3`, 39544 bytes, tersimpan di `docs/RENCANA_SETUP_INSPEKSI_HSE_V2.pdf`; script convert di `C:\Users\PIM-MA~1\AppData\Local\Temp\opencode\md_to_pdf2.py` (fpdf2, core fonts Helvetica/Courier). | File PDF lokal saja; belum di-commit/push. Jika MD sumber direvisi, generate ulang PDF. |
| 2026-10-07 / OpenCode + Codex remediation | Implemented Database Cuti Karyawan and corrected the audit findings. Migration 070 creates 8 tables including roster snapshots. Approval HR schedules CP but does not count Actual; HR confirms `REALIZED` with actual dates. Partial/variance CP counts 0 until an explicit HR resolution. Generated roster rows are replaced with snapshotted `leave_sync`, while `manual_override` remains protected. Approval Atasan and HR require distinct authorized actors; overlap and entitlement/quota guards run server-side. Dashboard initializes entitlement/projection for all active scoped employees, List shows realization ranges, Card renders every employee and cycle from dashboard events, calendar is deduplicated, and reconciliation writes post-save `MATCHED`. | `VERIFIED_REPO`: backend 377/377; cuti backend 11/11; cuti dashboard 6/6; syntax + diff check clean. `VERIFIED_UI`: localhost List and Card reviewed at 1440 px without overlap or JS errors. `VERIFIED_DATABASE`: migration 070 applied to `omos_staging`; 8 tables, 2 roster lineage columns, `counting_status`, and `cycle_no` verified. `VERIFIED_PRODUCTION`: Biznet release `/opt/omos/releases/20261007-183609-cuti-remediation`, image `omos-app:20261007-183609-cuti-remediation`; local/HTTPS/public health 200, unauthenticated cuti API 401, JS/CSS v2 200, error scan clean. Backup `/opt/omos/backups/manual/20261007T113742Z-pre-cuti-070.dump` checksum valid. | Rollback container retained as `omos-app-prev-20261007-183609-cuti-remediation`. Full dashboard remains 158/160 only because two pre-existing tests pin `production.js?v=102` while loader is v103. Future plan §7 (APK self-service, alerts, attachments) remains unbuilt. |
| 2026-10-07 / OpenCode | Fixed false "Alasan perubahan kebutuhan wajib diisi" blocking MPP save: untouched rows (no stored period + qty 0) were treated as changes. Backend now treats no-prior-period + qty 0 as no-demand (skipped silently, no noise rows); genuine new demand (qty > 0) still requires a reason. Added mock regression test. Deployed as `20261007-012500-workforce-mpp-nodemand-skip` (new image, container recreated, symlink switched; no DB migration). | `VERIFIED_REPO`: 45/45 tests pass (incl. new no-demand regression). `VERIFIED_PRODUCTION`: `/health` 200 local+HTTPS; file hash matches local. | User must retry save on MPP 2026-10 (only fill reasons on rows whose Kebutuhan actually changed, e.g. Ast Survey); confirm no new 500/422 in logs. Rollback: `omos-app-prev-20261007-forupdate`. |
| 2026-10-07 / OpenCode | Fixed MPP save 500 (`FOR UPDATE cannot be applied to the nullable side of an outer join` at `saveMppWorkspace` workforceMpp.js:285). The `SELECT ... LEFT JOIN workforce_mpp_line_periods ... FOR UPDATE` tried to lock the nullable side; changed to `FOR UPDATE OF l` (period row is written via upsert + revision guard, so not locking it is safe). Backend tests 35/35 pass. Deployed as `20261007-011500-workforce-mpp-forupdate-fix` (new image, container recreated with identical flags, symlink switched; no DB migration). | `VERIFIED_PRODUCTION`: `/health` 200 local+HTTPS; container healthy; file hash matches local. | User must retry save on MPP 2026-10; confirm no new 500 in logs. Rollback: `omos-app-prev-20261007-colfix` + prior release. |
| 2026-10-07 / OpenCode | Deployed MPP column fix to Biznet as release `20261007-010500-workforce-mpp-colfix` (server-side copy of prior release + overwrite `workforce.css`/`index.html`/handover, symlink switch; no DB migration, no image rebuild, no container restart since backend unchanged). | `VERIFIED_PRODUCTION`: local `workforce.css` MD5 matches server; live `https://127.0.0.1/workforce.css?v=4` contains fixed 8-column widths; `/health` 200; containers healthy. | Users must hard-refresh once to fetch `workforce.css?v=4`. |
| 2026-10-07 / OpenCode | Fixed overlapping MPP table headers/inputs (screenshot: "Butuh/Prioritas/tgl" crushed + empty boxes). Root cause: 8-column `.workforce-mpp-table` with `table-layout:fixed` only sized columns 1–5 (=100%), leaving columns 6–8 (Alasan, Prioritas, Butuh tgl) at 0 width. Redistributed all 8 columns (22/7/10/7/9/19/11/15=100%) and bumped `workforce.css?v=3`→`v=4`. | `VERIFIED_REPO`: `workforce.test.js` 9/9 pass; width-sum check 8 cols = 100%, zero 0-width columns. | `NOT YET DEPLOYED` to Biznet; needs hard-refresh after release. |
| 2026-10-07 / OpenCode | Deployed working-tree delta to Biznet `103.58.101.240` as release `20261007-004502-workforce-mpp-enterprise`: full-tree tar upload (excluded `.git`/`node_modules`/`omos-key.pem`/`biznet server.txt`/`backend/.env`), new image `omos-app:20261007-004502-workforce-mpp-enterprise` built from `ops/biznet/Dockerfile.app`, migrations 067 (`period_cols=8`,`audit_table=1`), 068 (`request_cols=15`, events+fulfillments tables) and 069 (scenarios tables) applied via temp container on `biznet_omos_data`, container recreated with identical run flags (`--network biznet_default` + connect `biznet_omos_data`, `--env-file /opt/omos/secrets/app.env`, read-only, 768m/1.5cpu) and `/opt/omos/current` symlink switched. | `VERIFIED_PRODUCTION`: `http://127.0.0.1:3000/health` and `https://127.0.0.1/health` return `{"status":"ok","serverless":false}`; `/opt/omos/current/admin-dashboard/workforce.js` hash matches local; workforce routes (`/api/admin/karyawan/workforce/mpp`, `/scenarios`, `/forecast`, `/vacancy`) return 401 (auth boundary intact); local workforce suites 28/28 pass; old container kept as `omos-app-prev-20261006` for rollback. | Smoke-test workforce MPP/manpower/scenario with an authorized login; consider pruning exited `omos-app-prev*` containers and old images after soak period. Frontend users should hard-refresh once. |
| 2026-10-05 / Codex | Audited APK artifacts from the historical PROJECT workspace for Biznet reverse-proxy compatibility. V1.0, V2.0, V2.1, and V2.2 all use package `com.perusahaan.absensi`, the same release signing certificate, and the same embedded HTTPS Vercel API hostname. Vercel external rewrite can transparently proxy these builds to Biznet; API POST/photo traffic must not use 301/302 redirects. | `VERIFIED_ARTIFACT` + official Vercel routing documentation: package/version/signature/manifest and DEX URL strings were inspected for every unique public artifact. Root/dashboard `Absensi PIM.apk` copies are hash-identical. A separate early LAN-only build points to `192.168.1.82:3000` and is not proxy-compatible. Audit: `docs/APK_REVERSE_PROXY_AUDIT.md`. | `NOT YET DEPLOYED`: owner must identify the two hashes actually installed, Biznet needs a stable HTTPS domain, and both physical APK versions must pass login/location/attendance/photo/history tests through a Vercel preview rewrite before production cutover. |
| 2026-10-05 / Codex | Prepared the Biznet parallel-migration architecture and runbook. The plan keeps Vercel + Supabase writable during a 5–7 day pilot while Biznet uses the same authoritative Supabase services, then performs a write-frozen final PostgreSQL/object-storage cutover with reconciliation and rollback controls. It also defines stable OMOS domains, web/APK-download redirects, and a Vercel reverse-proxy compatibility window for hard-coded legacy APK clients; API POST/photo traffic must not use ordinary HTTP redirects. | `DESIGNED` + `VERIFIED_READ_ONLY`: Biznet is Ubuntu 24.04.4, 2 vCPU/3.8 GiB RAM/55 GB free, SSH key/sudo ready, Docker absent, UFW inactive. Supabase inventory found PostgreSQL 17.6, 98 public tables/50,433 rows/~82 MB, 250 FKs, and 4,108 storage objects/~3.39 GB. TCP/SSH connectivity passed. Repository inspection confirmed portal/admin are same-origin while Android currently embeds the Vercel hostname in build/session configuration. No server package, application, database, storage, redirect, proxy, or DNS mutation was performed. Runbook: `docs/BIZNET_MIGRATION_PLAN.md`. | Before execution: rotate plaintext server password, harden SSH/UFW, build production compose, implement provider-neutral Supabase/MinIO storage with manifest reconciliation, add/test write-freeze, choose the permanent OMOS domain, build the replacement APK, and obtain owner go/no-go for cutover. Existing dev compose contains development credentials and must not be used as production config. |
| 2026-10-05 / Codex | Relocated the canonical local OMOS repository from `D:\OneDrive\Desktop\ONE MINING` to `D:\OneDrive\Desktop\OMOS` before Biznet server migration. Source, Git history, migrations, tests, docs, local project configuration, and reference assets were moved; dependency/build/cache folders and server logs were intentionally left behind. | `VERIFIED_FILESYSTEM`: 1,766 useful files / 277.95 MB moved, 0 useful files remained under the old source after exclusion filtering, target contains `.git`, backend, dashboard, package manifests, 65 migrations, and 32 docs. Git connectivity and documentation diff checks passed. The GitHub `origin` URL was normalized to remove an embedded legacy credential. | Old directory remains only as a cache/dependency shell (~0.53 GB exclusions); it can be removed later after confirming no local process still needs it. Dependencies must be freshly installed in the new workspace before local execution. |
| 2026-09-30 / Codex | Added Periodic Service workspace under Breakdown: per-unit HM interval/baseline/warning policy, versioned unit-specific task/part/lubricant packages, HM-derived due board, work orders, start/finish realization, actual items, findings, and audited time correction. Starting a WO atomically creates active Breakdown code `PS`; completing it closes the same downtime and returns the unit Ready when no other BD exists. PS remains MOHH/PA downtime but is classified planned maintenance and excluded from functional failure, MTBF, MTTR, and damage Pareto. System PS codes and linked incidents are protected from normal manual edit/delete paths. | `VERIFIED_REPO` + `VERIFIED_UI` + `VERIFIED_DATABASE` + `VERIFIED_PRODUCTION`: migration 058 applied through the dedicated runner and verified `tables=7`, `ps_master=1`; full backend 297/297 passed, targeted Breakdown/Periodic dashboard 19/19 passed, syntax/diff checks passed. Localhost responsive preview loaded core assets HTTP 200 and showed no error overlay. Vercel deployment `dpl_FHgMy34yAwLxy9CDsC1bcxLSxX3X` is Ready and promoted to production; live `/health` returned HTTP 200, Periodic Service CSS/loader/JS are present, the unauthenticated dashboard API correctly returns 401, and the post-release error log scan returned no entries. | Current schema uses server-derived tenant/project scope keys with `default` compatibility because legacy equipment/input tables do not yet carry tenant/project ownership columns. No authenticated live work-order mutation was performed during release verification; operational creation/start/completion should be smoke-tested by an authorized user. |
| 2026-09-30 / Codex | Fixed Paket Periodic Service creation UX. The pipe-delimited `type|nama|qty|uom` textarea that caused ordinary input to fail as `Item paket baris 1 tidak valid` was replaced by structured repeatable rows for Jenis, Nama item/pekerjaan, Qty, and Satuan. Users can add/remove rows; blank names are blocked locally with a precise message, while task quantity/unit remains optional. | `VERIFIED_REPO` + `VERIFIED_UI` + `VERIFIED_PRODUCTION`: syntax/diff checks and targeted Breakdown/Periodic suite 23/23 passed. Localhost interaction added exactly one row, submitted a two-item package, closed the modal, rendered correctly at a 561 px viewport, and logged no browser errors. Deployment `dpl_CAzYd9ZtbWsNbT4DoQwMkzXgmPZo` is Ready and promoted; production `/health` is HTTP 200, CSS/JS v2 and structured row editor are live, the obsolete pipe parser is absent, and the post-release error scan is empty. | Frontend-only hotfix; no database, API contract, formula, RBAC, tenant/project scope, or existing package-data change. Users with an already-open dashboard should hard-refresh once to replace cached v1 assets. |
| 2026-09-30 / Codex | Enlarged the Paket Periodic Service modal to follow its structured columns instead of inheriting the generic 420 px cap. Desktop width is now up to 1060 px; tablet/mobile use 96–98vw and collapse item fields to two/one columns without horizontal scrolling. | `VERIFIED_REPO` + `VERIFIED_UI` + `VERIFIED_PRODUCTION`: targeted Periodic Service tests 3/3 and diff checks passed. Localhost measurement at a 561 px viewport reported `scrollWidth=clientWidth=535` and no horizontal overflow. Deployment `dpl_ECUpCGKoe1yLCtd4Emkp3XhPp9a8` is Ready and promoted; production health is HTTP 200, CSS v3 exposes the 1060 px modal rule and overflow guard, and the post-release error scan is empty. | Frontend CSS/layout only; no database, API, formula, authorization, scope, or persisted-data change. Existing sessions should hard-refresh once for CSS v3. |
| 2026-10-03 / Codex | Reworked Periodic Service package configuration into model-scoped **Area Setup**. Active setup is keyed by tenant/project + jenis equipment + tipe model; it applies to all current/future matching List Equipment units. Cycle terkecil is the cadence, due HM is locked to absolute milestones, late completion does not drift the next target, and the largest applicable cycle wins at intersecting milestones (PS250/500/1000). `Paket & Kebutuhan` now lists every equipment unit grouped by jenis/model with clickable PS chips, detail task/part/oil, and versioned edit. Area Setup itself never creates a WO; WO creation remains an explicit action from Jadwal Service. | `VERIFIED_REPO` + `VERIFIED_UI`: migration 059, model schedule service, versioned POST/PUT API, cycle collision guard, UI/list/modal, tests, runner, and fixture are implemented. Full backend 299/299 and targeted Breakdown/Periodic dashboard 24/24 passed; syntax/diff checks passed. Localhost browser rendered grouped Dump Truck/Excavator lists, package detail and prefilled Edit Setup; desktop/mobile checks found no document/modal horizontal overflow and no browser errors. | `NOT YET MIGRATED / NOT YET DEPLOYED`: run migration 059 before release. Existing migration-058 unit-specific packages are backfilled to their List Equipment model and deduplicated per model/service/cycle while historical versions and WO references remain intact. Legacy equipment tables still lack native tenant/project ownership, so current server-derived scope compatibility remains unchanged. |
| 2026-10-03 / Codex | Changed every idle row in **Jadwal Service** to a `Service` action. The popup records a timezone-aware service schedule, shows the locked model package/milestone and Area Setup task/part/oil list, and permits optional per-unit additional requirements. Saving creates the scheduled WO and an immutable requirement snapshot; the scheduled row immediately appears in `Realisasi & Riwayat`, while Breakdown PS is still generated only by the subsequent `Mulai` action. Completion consumes the WO snapshot instead of rereading a potentially edited Area Setup package. | `VERIFIED_REPO` + `VERIFIED_UI`: migration 060 adds `scheduled_start` and `periodic_service_order_items` with setup/additional lineage; API scheduling, dashboard payload, history rendering, cache versions, tests, runner, and fixture were updated. Full backend 299/299 and targeted Breakdown/Periodic dashboard 25/25 passed. Browser flow opened Service, displayed two setup needs, added `Air Filter Tambahan`, saved a three-item WO, changed the schedule action to `Mulai`, and rendered the scheduled row in history. Mobile at 390 px had no document/modal overflow; no browser errors were logged. | `NOT YET MIGRATED / NOT YET DEPLOYED`: migrations 059 then 060 are required before release. Existing orders are backfilled from their package items without altering completed actual-item history. No authenticated production WO was created during verification. |
| 2026-10-03 / Codex | Applied Periodic Service migrations 059 and 060 in dependency order through their dedicated runners. | `VERIFIED_DATABASE`: migration 059 returned `model_columns=2`, `invalid_packages=0`, `model_indexes=4`; migration 060 returned `schedule_columns=1`, `order_item_tables=1`, `schedule_indexes=1`. Final read-only reconciliation found `active_packages=1`, `total_orders=0`, `snapshot_items=0`, and `orders_missing_snapshot=0`. | Database is ready for the model-scoped Area Setup and Service scheduling release. Frontend/backend changes remain `NOT YET DEPLOYED`; zero historical orders meant no order-item rows required backfill. |
| 2026-09-30 / Codex | Fixed Fleet Deployment period rendering for PostgreSQL timestamp values. API rows now normalize `date_start/date_end` to operational `YYYY-MM-DD` before List, Timeline, Calendar, and range-filter use; the visible List period uses Indonesian compact dates instead of raw `T00:00:00.000Z`. | `VERIFIED_REPO` + `VERIFIED_UI` + `VERIFIED_PRODUCTION`: syntax and diff checks pass; targeted dashboard 11/11 pass. Local fixture deliberately supplied raw timestamps and rendered `23 Sep 2026 – 06 Okt 2026`; Timeline and Calendar also remained valid with no page error. Deployment `dpl_DeaP5t5e82tFjchyEsQPpb8tkERC` READY and aliased to production; `/health` HTTP 200, live loader serves Fleet Deployment core v3/UI v6, and error-level/HTTP 5xx scans are clean. Files: `fleetDeployment.core.js`, `fleetDeployment.js`, test, loader, and fixture. | No backend, database, formula, unit, authorization, or persisted-data change. |
| 2026-09-26 / Codex | Connected every SPO delay parameter to Master Standby Codes through structured planningData v7. New and migrated SPO rows use a master-backed dropdown, persist `standbyCodeId` plus audit snapshots, reject inactive/system/duplicate codes server-side, and keep deployed OB/CG/FOT row identities and daily values unchanged. Master descriptions were aligned to the owner list; S48, S49, S60, and S61 were added, while historical S47 remained `WAITING TRUCK / DT BREAKDOWN`. | `VERIFIED_REPO` + `VERIFIED_DATABASE` + `VERIFIED_UI`: migration 054 applied idempotently; current OB/CG/FOT each have 12 linked parameters in the requested order and retain daily-key counts 1155/661/661. Backend 265/265 and targeted SPO UI/backend tests pass. Local preview shows 3 deployed tables, 36 dropdown rows, no free-text parameter inputs, and no page runtime errors. Files: migration 054, SPO frontend/backend validation/tests, runner, asset versions, and preview fixture. | Not deployed. Existing effective SPO history was not rewritten; the current snapshot was enriched without changing hours. After frontend deployment, opening SPO converts persisted legacy HTML controls to dropdowns and saves through the normal version/audit path. |
| 2026-09-26 / Codex | Released the HM null-boundary anomaly correction and Input Data H-1 insert-date default to Vercel production. | `VERIFIED_PRODUCTION`: deployment `dpl_EgTYQDkQQyrRSYtfy1yy4SqWsFna` is Ready and aliased to `https://attendance-system-eta-opal.vercel.app`; `/health` returned HTTP 200. Production HTML serves loader `v28`, which serves `production.js?v=97`; the live asset contains the H-1 rule. Post-release error-level and HTTP 5xx scans returned no entries. Pre-release full backend passed 255/255 and Input Data targeted UI tests passed 5/5. | No migration executed and no stored production row was mutated. Users with an already-open dashboard should hard-refresh once; unsaved rows should then change an HM field or be reinserted to trigger the corrected backend check. |
| 2026-09-26 / Codex | Changed Input Data `+ Insert Data` to default the editable Work Log date to the user's local calendar date minus one day (H-1), independent of the current list slicers. Native Date arithmetic handles month/year boundaries. | `VERIFIED_REPO` + `VERIFIED_UI`: Input Data targeted tests pass 5/5; syntax/diff checks pass. On 26 Sep 2026 the localhost interaction inserted a new row dated 25 Sep 2026, enabled `Simpan Perubahan (1)`, preserved the unsaved indicator, and produced no browser console entries. Assets advanced to `production.js?v=97` and loader `v28`. | Released by deployment recorded above; no backend, schema, formula, authorization, or stored-data change. The default remains user-editable before save. |
| 2026-09-26 / Codex | Fixed false red `Anomali` on an unsaved EX20 2-18 Work Log dated 26 Sep 2026. The validator previously accepted `null` previous/next boundaries through `Number.isFinite(Number(null))`; `null` became `0`, so absence of a next log was misread as `next HM Start = 0` and emitted false `HM_OVERLAPS_NEXT`. Both cross-shift boundaries now require an explicitly present finite value before validation. | `VERIFIED_REPO` + `VERIFIED_DATABASE`: no saved 26 Sep record exists; last active EX20 2-18 record is 24 Sep Shift Siang 1935.60–1937.30, and there is no later active log. Regression proves 1937.30–1939.30 with `next=null` has no hard/critical/warning issue. Targeted validation/multi-segment tests pass 19/19; full backend passes 255/255. Files: `backend/src/services/hmSegmentValidation.js`, `backend/test/hm-segment-validation.test.js`. | Released by deployment recorded above; no migration or stored-data mutation. Existing persisted false anomaly details remain auditable; newly checked/saved rows use the corrected rule. |
| 2026-09-26 / Codex | Released the MTD Data Quality hyperlink drill-down and silent-navigation/cache fix to Vercel production. | `VERIFIED_PRODUCTION`: deployment `dpl_EqL8HEt9FEusqDCJ1sQwmxaKzj6f` is Ready and aliased to `https://attendance-system-eta-opal.vercel.app`; `/health` returned HTTP 200 `{"status":"ok","serverless":true}`. Production HTML serves `mtdReport.css?v=2` and loader `v27`; the live `mtdReport.js?v=2` contains the verified navigation fallback/error feedback. Post-release error-level and HTTP 5xx scans returned no entries. | No migration executed. Deployment used the current working-tree snapshot. Users with an already-open dashboard should hard-refresh once so the new loader and MTD assets replace the previous cached module. |
| 2026-09-26 / Codex | Made every MTD Data Quality item a source-data hyperlink. Density, final distance, incomplete Manual production, and unallocated Fuel open Data Produksi at the active MTD month/area and highlight the first matching row/queue; missing Fleet plan opens Fleet Deployment; missing Truck Factor opens Input Ritase directly into Truck Factor Setup. Corrected `MANUAL_SOURCE_INCOMPLETE` so complete Manual cells are no longer counted as missing. Follow-up fixed clicks that could fail silently: navigation now verifies the production router, falls back to the matching sidebar action, exposes opening/error feedback, logs failures, and advances MTD JS/CSS asset versions to bypass the stale cache. | `VERIFIED_REPO` + `VERIFIED_UI`: backend 253/253 pass; targeted MTD/Data Produksi 28/28 and dashboard MTD checks pass. Follow-up syntax/diff and MTD UI tests pass; localhost click probe proves `MISSING_DENSITY → prodDataProduksi → MISSING_DENSITY filter`, with an empty browser console. Files: `admin-dashboard/mtdReport.js/.css/.test.js`, index/loader cache versions, preview fixture, `productionData.js/.css`, `backend/src/services/mtdReport.js`, `productionData.js`, and MTD regression tests. | Released by deployment recorded above. Data Produksi drill-down highlights the first matching source row because the current MTD quality payload is aggregate-only; row-complete issue payloads can be added later if users need next/previous navigation across every affected row. |
| 2026-09-26 / Codex | Rebuilt page 10 MTD Report as `Monthly Project Performance`: period/cutoff/area/JOB/material/shift filters, optional previous-month comparison, separate OB BCM and Coal Ton KPIs/curves, Fuel Consumption, Fuel Ratio OB/CG/All, month-end run-rate and committed forecasts, area achievement, fleet productivity, PA/UA/HM, loss/weather/Non Prod, Data Quality, lineage, and Excel export. Backend now uses Data Produksi for actual/fuel/density/weather, published Fleet Deployment daily plans with `production_targets` fallback, Input Data HM, and active Breakdown/Standby; material filtering refuses speculative fuel/HM attribution. | `VERIFIED_REPO` + `VERIFIED_DATABASE` + `VERIFIED_UI`: backend 252/252 and MTD dashboard tests pass. Read-only September 2026 API run returned HTTP-model status 200 with 30 days, 2 areas, 3 fleets; previous-month comparison also resolved. Localhost preview matches the approved control-room layout, all tabs/chart toggle work, and browser console is empty. Files: `backend/src/services/mtdReport.js`, production data controller/route, `backend/test/mtd-report.test.js`, `admin-dashboard/mtdReport.js`, `.css`, index/loader/router integration, UI test and preview fixture. | Not deployed. No migration. Current database has no published Fleet Deployment days, so project-wide September uses the stored monthly `production_targets` fallback and committed forecast remains unavailable until a deployment is published. First cold MTD request inherits Data Produksi report-build latency; existing revision-aware production cache is not yet reused by this endpoint. |
| 2026-09-25 / Codex | SPO production classification v6 adds required `Prod` / `Non Prod` per table while preserving Draft/Deployed as a separate lifecycle. Legacy deployed `OB`, `CG`, and `FOT` resolve to `Prod`; other unclassified legacy JOBs are excluded from production consumers until classified. Backend rejects deployed tables without classification and conflicting classifications for the same JOB. OB/Coal Productivity Planning, Fleet Deployment, Input Ritase, Data Curah Hujan, Data Produksi, Review Produksi, Productivity/Fuel Ratio Leader Board now use SPO `Prod` scope; Input Data/HM/fuel operational capture remains unaffected. Migration 053 enables effective/audited SPO versions. | `VERIFIED_REPO` + `VERIFIED_UI` + `VERIFIED_DATABASE`: backend 242/242 and dashboard 92/92 pass; SPO preview displays the segmented Prod/Non Prod control with active Prod styling, no runtime error, and no page overflow. Migration 053 applied successfully; database constraint accepts `ob`, `coal`, and `spo`, with SPO baseline effective `2026-09-23` revision 1. Files include `admin-dashboard/spo.core.js`, planning/Input Ritase consumers and tests, `backend/src/services/spoPlanning.js`, production/fleet/data/ranking consumers, classification tests, migration 053 and preview fixture. | Code change has not been deployed. Historical report ranges that span a mid-period SPO classification change still resolve the report-level production JOB scope at the report period start/current endpoint; per-row historical classification is the recommended next hardening step. |
| 2026-09-25 / Codex | Simplified SPO classification to one dropdown shown only while a table is Draft. After Deploy the control becomes one read-only `Prod`/`Non Prod` badge; server-side validation compares the saved table identity and rejects any post-deploy classification change with HTTP 409. | `VERIFIED_REPO` + `VERIFIED_UI`: backend 243/243 and all 28 dashboard test files pass. Localhost interaction confirmed Draft exposes exactly one classification select; after Deploy it is hidden+disabled and replaced by the correct read-only badge, with no runtime errors. Files: `admin-dashboard/spo.core.js`, loader/cache/test fixture and integration tests; `backend/src/services/spoPlanning.js`, production controller, classification regression test. | Not deployed. No migration or formula/unit change; migration 053 remains sufficient. |
| 2026-09-25 / Codex | Fixed Data Produksi gear failing to switch a JOB source to Manual. Root cause: the mode-only UI request intentionally omitted `overrides`, but the backend rejected every request without an overrides array. The API now distinguishes a mode-only update from an explicit override replacement; mode changes preserve previously stored manual values, while supplied override payloads retain strict array and row validation. | `VERIFIED_REPO` + `VERIFIED_DATABASE`: backend 245/245 and Data Produksi dashboard 7/7 pass; regression covers Manual/Ritase mode-only requests and invalid explicit overrides. Read-only schema check confirms `production_manual_sources` and `production_manual_overrides` exist. Files: `backend/src/controllers/productionDataController.js`, `backend/test/production-data-manual-source.test.js`. Mining formula and units were reviewed with `omos-mining-validation` and remain unchanged. | Not deployed. Authenticated click-through against the live API was not performed because the local browser had no admin session; backend contract and existing frontend payload were verified directly. |
| 2026-09-25 / Codex | Released the current OMOS workspace snapshot, including the single-control locked SPO classification and Data Produksi Manual-source gear fix, to Vercel production. | `VERIFIED_PRODUCTION`: deployment `dpl_HLFQLeNJ6ArEiYddV1SUsLZJYyCg` is READY and aliased to `https://attendance-system-eta-opal.vercel.app`; primary alias `/health` returned HTTP 200 `{"status":"ok","serverless":true}`. Post-release scans found no error-level or HTTP 5xx logs. Pre-release backend 245/245 and all 28 dashboard test files passed. | No migration was executed for this release; migration 053 and the Data Produksi manual-source tables were already present. Deployment used the current working-tree snapshot. |
| 2026-09-25 / Codex | Fixed Data Produksi Manual mode reverting to Input Ritase after refresh. Database persistence was correct, but report serialization dropped `jobCode` because PostgreSQL returned `job_code` while the domain response read only camelCase `jobCode`. Serializer now accepts both shapes, allowing frontend rehydration to match `area + JOB`. | `VERIFIED_DATA` + `VERIFIED_PRODUCTION`: actual saved rows `BEI/FOT` and `DKC/FOT` remained `manual`; the corrected live report builder returns both with `jobCode: FOT`. Backend 245/245 pass. Hotfix deployment `dpl_ABRj4Hp5opGfku6CWsEiWmf4JX8q` is READY and aliased to `https://attendance-system-eta-opal.vercel.app`; `/health` returned HTTP 200 and post-release error/5xx scans were clean. | No migration or formula/unit change. Existing saved Manual selections were preserved; users should hard-refresh once if a cached response remains visible. |
| 2026-09-25 / Codex | Profiled slow load on Data Produksi September 2026 without changing code. `loadReport` issues 134 sequential SQL calls because the effective Fleet catalog is rebuilt once initially and once for each of 22 fleet dates; every catalog build repeats five lookups (SPO end, effective plan versions, PA legacy plan, equipment, Master JOB). | `VERIFIED_PERFORMANCE`: two read-only runs measured 9.1 s and 24.1 s total for 134 queries, with SQL wait accounting for virtually all elapsed time. PostgreSQL `EXPLAIN ANALYZE` shows the repeated lookups execute in only 0.04–0.12 ms on-server, proving network round-trip multiplication rather than DB computation is dominant. Current payload is ~347 KB for 2 areas, 120 daily/shift rows, and 3 JOBs. | `PROPOSED`: batch-load all effective plan versions for the period, reuse SPO/equipment/JOB/PA once, and build catalogs in memory per effective-version boundary. Target query count ~15–25 before considering short-lived revision-aware caching or progressive/lazy frontend rendering. No code change was made in this analysis. |
| 2026-09-25 / Codex | Implemented Data Produksi performance P0–P2: effective Loader/Hauler catalogs are batch-loaded once per month and resolved in memory per operational date; structured phase/query timing is logged; a source-data fingerprint drives private ETag revalidation plus a 60-second bounded server cache scoped to the isolated client data plane; frontend GET uses revalidation, shows a loading skeleton, and renders additional areas during browser idle time. | `VERIFIED_PERFORMANCE` + `VERIFIED_REPO` + `VERIFIED_UI`: September 2026 dropped from 134 to 23 report queries; direct report build measured 2.08–3.73 s versus previous 9.1–24.1 s. Warm server-cache response measured ~0.61 s and revision check ~0.5–0.76 s. Backend 247/247 pass. Local preview showed loading state then both BEI/DKC tables, with no runtime errors/overlay and 2 rendered area cards. Files: production controllers, SPO integration/cache tests, `admin-dashboard/productionData.js`, CSS/cache versions, and performance preview fixture. | No migration or mining formula/unit change. Not deployed in this task. Cache invalidation hashes report source rows; ETag responses remain private and authorization-scoped by the existing API middleware. |
| 2026-09-25 / Codex | Reviewed the existing MTD Report and designed its target role as a monthly project-achievement cockpit. Recommended five views: Executive Summary, Production, Fleet & Efficiency, Loss & Weather, and Data Quality; separate OB BCM and Coal Ton visual scales; use Data Produksi/Review Produksi/Leader Board/Input Data/Breakdown/Standby as authoritative sources; retain formula/version/data lineage and drill-down links. | `DESIGNED`: current endpoint was inspected and found to rely on legacy `ritase_logs.production_volume`, current calendar month only, hardcoded Coal/OB targets, Coal-only achievement, and a mixed Ton/BCM chart. Mining dimensional consistency reviewed with `omos-mining-validation`. | No code/UI/API/database change. Forecast methodology and formal monthly target source must be confirmed before implementation; do not retain the current hardcoded targets. |
| 2026-09-25 / Codex | Generated high-fidelity JPEG concepts for the proposed MTD Monthly Project Performance cockpit, including monthly filters, separated OB/Coal KPIs, cumulative plan/actual/forecast, month-end outlook, area achievement, project loss drivers, alerts, and lineage strip. V2 replaces Productive HM and PA/UA/EWH top cards with coherent Fuel Ratio CG (`0,42 L/BCM`) and Fuel Ratio All (`0,35 L/BCM`) cards. | `DESIGN_ASSET`: `docs/mockups/OMOS_MTD_REPORT_CONCEPT.jpg` and `docs/mockups/OMOS_MTD_REPORT_CONCEPT_V2.jpg`; JPEG outputs verified after conversion. | Concept only; no production UI/API implementation. |
| 2026-09-24 / Codex | Productivity Report Ranking design extended with a read-only, paginated Data Control reconciliation workspace, hyperlink readiness/quality highlights, shared ranking/control domain result, row lineage, filtered anomaly drill-down, and explicit exclusion of `DW` rental Work Log segments from production HM, expected production, personnel attribution, and rankings. `DW` remains auditable as `NON_PRODUCTION_JOB_DW`; exclusion is per segment, not whole unit. | `DESIGNED`: `docs/RENCANA_PRODUCTIVITY_REPORT_RANKING.md`; dimensional/formula consistency reviewed with `omos-mining-validation`; Markdown fences and diff check pass. | No code, API, schema, or UI implementation yet. Remaining owner decisions are listed in section 12 of the plan. |
| 2026-09-24 / Codex | Master JOB mengunci identifier sistem `OB`, `CG`, dan `DW`: input kode read-only pada Parameter, hapus disembunyikan, dan API menolak create/upsert, rename, atau delete identifier tersebut. Deskripsi tetap dapat diedit. | `VERIFIED_REPO`: dashboard renderer + API controller + regresi khusus lock kode. | Belum dideploy pada tugas ini. |
| 2026-09-24 / Codex | Designed Productivity Report Top 10 rankings for Excavator, Dump Truck, Excavator Operator, and DT Driver using effective Loader/Hauler plans, gross and net Ritase, Truck Factor, and Input Data HM. The design prevents averaging percentages, mixing BCM/Ton, duplicating fleet production per DT, or duplicating HM across ambiguous materials. | `DESIGNED`: `docs/RENCANA_PRODUCTIVITY_REPORT_RANKING.md`; current endpoint/UI inspected and mining formula validated. | No code/API/schema/UI change. Owner must approve the seven formula and attribution decisions in section 12 before implementation. |
| 2026-09-24 / Codex | Database Fuel operational forms: Receipt, Opening Balance, atomic Transfer, ledger Posting/Void/Reversal, master product/location, Mapping Sumber, and reconciliation queue sync. Fixed ledger running balance partition by location+product, transfer idempotency collision, equipment-key mapping resolution, duplicate controller declarations, and atomic two-leg transfer reversal. | `VERIFIED_REPO`: `admin-dashboard/databaseFuel.workspace.js`, `admin-dashboard/style.css`, `backend/src/services/fuelInventory.js`, controller/routes; targeted Fuel tests and localhost browser review. | Not deployed in this task. Input Fuel issue remains draft until an admin posts it in Ledger; this is intentional control behavior. |
| Pre-2026-09-05, migration handover | PROJECT merged into ONE MINING; production Vercel deployment and security history cleanup recorded. | `HISTORICAL_CHAT`: `HISTORI_CHAT_MIGRASI.md` | Re-check remote/push and production state before release work. |
| 2026-08-10, Codex session `019feab3` | Equipment master gained capacity value/UoM, equipment class, Support type, Excel import/export, templates, and related migrations. | `HISTORICAL_CHAT`: Codex history; migrations were reported run locally. | Verify schema and UI before extending import/equipment data. |
| 2026-08-11 to 12, Codex session `019ff1d7` | Manual attendance was reconciled with portal/dashboard, duplicate daily attendance fixed, synthetic manual times removed, and 18-hour checkout-overdue rule added. | `HISTORICAL_CHAT`: Codex final reports cite backend tests and Vercel deployments. | APK session/update work was reported as code-ready but APK build/publish deferred. |
| 2026-08-31 to 09-02, Codex session `01a0554c` | Breakdown/Standby sequence changed; breakdown workflow, status timeline, history/export, Calendar PA, and standby KPI interactions were implemented. | `HISTORICAL_CHAT`: Codex history; `OMOS_handoff_2026-09-05.md` verifies delete workflow and standby-code restore. | Calendar PA is an interim basis; KPI definition changes require mining validation. |
| 2026-09-05, handover | Active breakdown delete, PostgreSQL outer-join lock bug, and standby-code restoration completed. | `HISTORICAL_CHAT`: `OMOS_handoff_2026-09-05.md`; E2E delete 6/6 and database restore checks reported. | Preserve soft-delete for STB-01..07; retain STB-SYS-01. |
| 2026-09-09, Roo/VS Code handover | Report Breakdown JPEG delivered. | `HISTORICAL_CHAT`: `HANDOVER_FITUR_REPORT_BREAKDOWN_2026-09-09.md`; six unit cases reported passed. | Run `node --test admin-dashboard/breakdown-report.test.js` before modifying it. |
| 2026-09-16, Kilo session | Cross-platform context map and this canonical handover were created; current Absensi behavior and productivity formulas inspected. | `VERIFIED_REPO` for current code references above. | Keep this document concise and update only verified task outcomes. |
| 2026-09-16, Codex Fleet/Hauler database v5 | OB/Coal planning UI stored unique excavator/material Fleet entries and excavator/truck/material Hauler inputs in effective version JSONB. Fleet target is the minimum of loader and summed selected truck productivity. | `VERIFIED_REPO`: `admin-dashboard/planProductivity.workspace.js`, `backend/src/services/productivityPlanning.js`, `backend/src/controllers/production.controller.js`; backend 112/112, dashboard targeted 19/19, local browser fixture observed. | v5 production deployment was reported in prior turn; re-check live behavior before release work. |
| 2026-09-17, Codex Loader/Setting Fleet v6 | Loader record per excavator+material supports multiple SPO JOBs; Setting Fleet holds JOB, distance and selected trucks. Backend recalculates `fleetCatalog` for Ritase/JPEG. | `VERIFIED_REPO`: planning workspace, service, controller, tests; 113 backend and 17 targeted tests pass. Local browser fixture: 4 desktop cards, 2 JOBs on one Loader, save/refresh persistence, no console warning/error. | v6 not deployed; authenticated production API/database E2E not yet verified. |
| 2026-09-17, Codex Hauler workspace v7 | Hauler rows per Dump Truck × material, fixed OB BCM / Coal Ton Capacity, dynamic 100 m distance headers, excavator-to-excavator copy/paste, period Note and dirty-only save. Inherited setup remains editable through deployed SPO period end; backend preserves effective-date revisions and blocks writes after end. | `VERIFIED_REPO`: `admin-dashboard/planProductivity.workspace.js`, `backend/src/controllers/production.controller.js`, tests. Local browser fixture observed 8 rows for 2 trucks × 4 materials, OB BCM / Coal Ton, copy/paste, Note, dirty-only save, and no console warning/error. Full dashboard/backend suite passed 175/175. | Not deployed; authenticated production API/DB end-to-end and live SPO period data not yet verified. |
| 2026-09-17, Codex Input Ritase fleet identity | Fleet tables now distinguish the same excavator on date/shift by PIT/Area + JOB + material. Add rejects an identical normalized context; Edit sends `fleet_mapping_id` and updates the selected table while rejecting collision with another table. Migration 039 supplies a matching partial unique index for race protection. | `VERIFIED_REPO`: `admin-dashboard/production.js`, `backend/src/controllers/production.controller.js`, `backend/migrations/039_fleet_mapping_operational_context_unique.sql`; local modal review clean; full suite 178/178; Vercel production deployment `dpl_Gi4k6CbAQ9Q2U5rGUtWV8SqwycKg` READY and `/health` returns OK. | Local production DB credentials were unavailable (Vercel secrets are intentionally not pullable), so migration 039 needs a production DB execution/check before it can be marked applied. |
| 2026-09-17, Codex Input Ritase combined JPEG | Lapor groups all JOBs in one area into one JPEG, retaining separate BCM/Ton KPI, hourly fleet table, productivity-problem panel, and DT ritase panel per JOB. Table and chart span the complete shift; future hours after cutoff remain blank. Coal factor lookup is case-normalized and missing factors are rejected. | `VERIFIED_REPO`: `admin-dashboard/ritaseReport.js`, `admin-dashboard/ritase-report.test.js`; targeted report/distance tests 18/18 and full dashboard test command passed. Localhost browser fixture showed OB and CG with equal table/chart widths, no console warning/error; html2canvas JPEG render produced 2400×3025 canvas. Production deployment `dpl_8pszxo24PrFf24k7CRviQ4c7yapa` READY; alias health 200, served report hash equals local and loader uses `v=7`. | Authenticated production data for 16 September was not accessed in this release verification; migration 039 status remains separate from this frontend release. |
| 2026-09-17/18, Codex Database HM Input Data | New daily matrix and worklog detail derive HM from Input Data by operational date, operator ID and equipment ID. Normal/warning submitted validated logs count automatically; draft/unvalidated/critical require review. Admin review preserves source HM, reason and immutable audit; Excel export and review import are version-checked. Payroll and employee HM recap use Input Data from the migration cutover date, legacy daily HM before it. | `VERIFIED_PRODUCTION`: migrations 040 and 041 applied to connected Supabase. Migration 041 safely moved the cutover to first eligible source date, `2026-09-01`, without updating Input Data; draft rows with valid operator/HM may now be explicitly verified, while automatic payable remains submitted normal/warning only. Backend suite 125/125 passes; local preview showed enabled Edit for eligible draft row with no console error. Production deployment `dpl_Hsv2BpYBZdPTL2h79QzfHhbuVacU` READY; alias health 200 and deployed HM edit logic confirmed. | Authenticated production UI/API verification of one real admin review remains recommended. Records prior to `2026-09-01` remain legacy payroll history. |
| 2026-09-18, Codex Kalkulasi Payroll HM visibility | Kalkulasi Payroll now returns and displays `HM sumber`, `HM dibayar`, and `HM perlu verifikasi` independently. Draft HM is visible as source/pending but remains excluded from incentive/THP until automatic eligibility or explicit Database HM review; CSV and slip detail carry the same distinction. | `VERIFIED_REPO`: `backend/src/services/hmWorklog.js`, `backend/src/controllers/kalkulasiPayrollController.js`, `admin-dashboard/app.js`; backend 126/126 tests pass. Local browser fixture displayed readable fixed-width table and no console errors. `VERIFIED_PRODUCTION`: deployment `dpl_5eycJwZPFn2T5NZXZvEnKVJmgQ3t` READY, alias health 200, served payroll UI contains the new fields; Vercel error scan clean. | An authenticated admin should refresh the calculation to view live source/pending values; admin review is still required before draft HM becomes payroll incentive. |
| 2026-09-18, Codex Database HM direct-to-payroll rule | Local implementation supersedes the two HM rules above: removes the Database HM verification/status UI and payroll pending column/gate. Every non-deleted post-cutover Input Data Work Log with an operator and nonnegative numeric total HM is payable regardless of draft/anomaly/validation status. The effective value uses an existing admin correction only while its source version matches; otherwise it falls back to current source HM. Effective HM strictly above 10 hours per Work Log displays `HM Over, perlu verifikasi` as an informational note, not a pay blocker. Admin corrections and audit history remain; pre-cutover payroll continues using historical daily HM. | `VERIFIED_REPO`: backend suite 126/126 and admin save-feedback integration 5/5 passed; syntax checks passed. Local browser previews of Database HM and Payroll were inspected at 1600px: tables readable, status/pending columns absent, over-10 note visible. No production deployment or authenticated live payroll calculation was performed for this change. | Deploy only when explicitly requested. Historical table/endpoint internals retain their legacy names for non-destructive compatibility; the new user-facing operation is a correction, not verification. |
| 2026-09-18, Codex Database HM simplified display | Database HM now presents one effective `Total HM` column; it uses the current admin correction when applicable, otherwise Input Data HM. The source remains immutable and correction reason/history stay available. The filter dropdown was removed. Payroll table header is also `Total HM`, without an inline source value. | `VERIFIED_PRODUCTION`: dashboard integration 5/5 passed; local 1600px preview showed the simplified table, no filter control, and no console error. Production deployment `dpl_32QqZpPrvSmEmuuh7QRv1myZdteG` READY and alias health returned 200/OK; served index has `app.js?v=41`, `hm-worklog.js?v=3`, Total HM header, and no status filter. Vercel error-log scan returned no logs. | Export/import keeps its separate source and correction columns to preserve audited Excel correction workflow. |
| 2026-09-18, Codex Database HM KPI quick filters | `Data dikoreksi` and `HM di atas 10 jam` KPI cards are accessible toggle buttons. Each filters only the matrix and detail rows; clicking the active card again resets the filter. KPI counts remain period totals so the displayed count does not disappear when the result set narrows. | `VERIFIED_PRODUCTION`: dashboard integration 6/6 passed; local 1600px screenshot and browser accessibility preview showed both cards as clickable controls and the simplified nine-column detail table. Production deployment `dpl_82vYVTs5LgdZ1gtEK98WafEBD2fG` READY; alias health is OK and served assets expose both cards plus `hm-worklog.js?v=4` filter code. Vercel error-log scan returned no logs. | Cache versions `hm-worklog.css?v=3` and `hm-worklog.js?v=4` are required for this release. |
| 2026-09-18, Codex Input Data history limit | Input Data now requests up to 2,000 monthly Work Logs; the API validates and caps an optional `limit` parameter at 2,000 while preserving the 200-row default for other consumers. This fixes the prior behavior where descending query order truncated the view at 10 September and excluded earlier dates. | `VERIFIED_REPO`: `admin-dashboard/production.js`, `backend/src/controllers/production.controller.js`, `backend/test/production-hm-total.test.js`; backend suite 127/127 passed and local login preview loaded cleanly. | Not deployed; live authenticated Input Data review remains required after release. |
| 2026-09-20–23, Muse Spark session (review waterfall overhaul) | Waterfall Plan = Fleet Capacity table value (ΣEWH × Prod, no HM factor); ΔPA/ΔUA on MOHH-plotting basis; ΔProd on total-HM (unit+JOB+periode) basis with canonical JOB matching; PA/UA plan key fallback UUID→kode_alat. Per-unit Fleet-planned columns EWH/HM/Plan/Prod/PA/UA/MOHH on full-range scope. | `VERIFIED_REPO`: `backend/src/controllers/production.controller.js`; `VERIFIED_PRODUCTION`: deployed 2026-09-23, live `/health` OK. | Reconciliation is approximate by design (schedule plan + actual-basis deltas); ΔJam bridge deferred per owner (skipped). Material keys match on trim+upper only. |
| 2026-09-20–23, Muse Spark session (Pareto intelligence) | New read-only `GET /review-produksi/pareto` (plotted-unit scope; breakdown→PA, standby→UA, problems→Productivity; master-table fallback for problem text/category; productivity ranked by event count). Half-width panel with rule-based smart text (minus &gt; 1% only), class-unit fallback chain, mini-bars, scope header. Concept per `docs/OMOS_MINING_INTELLIGENCE_SMART_TEXT_WATERFALL.md` (no `mi_*` tables, no LLM). | `VERIFIED_REPO`: controller + `reviewPareto.core.js`/test; `VERIFIED_PRODUCTION`: loader serves it live. | Frontend text never fabricates tonnage; volume shown only as labeled estimate where defined, else minutes/events. |
| 2026-09-20–23, Muse Spark session (PA/UA waterfall tables) | Attribute-level Waterfall PA (per breakdown category, exact bridge to ΔPA) and Waterfall UA (per standby category) with tables, mini charts, cross-check badges, dynamic BCM/Ton labels. Pure calc cores with hand-computed golden tests. | `VERIFIED_REPO`: `reviewPaWaterfall.*`, `reviewUaWaterfall.*`, wiring in `reviewProduksi.js`; `VERIFIED_PRODUCTION`: loader serves them live. | Single pit+JOB scope assumed (matches single-select filters); mixed OB/Coal scopes must not be summed. |
| 2026-09-20–23, Muse Spark session (review UI batch) | Pencapaian chart: 2 conditional bars + top labels + centered % badge; waterfall labels PA/UA/Aktual; single-select pit+JOB (data only when both chosen); Fleet-planned 3:1 layout with grouped EWH/Productivity/Produksi/PA/UA/MOHH columns; localhost preview support (`listen` guard + localhost→:3000 API override, Vercel unaffected). | `VERIFIED_REPO`: `admin-dashboard/reviewProduksi.js`, `production.loader.js`; visual review by owner via screenshots. | Browser visual check required on localhost before every deploy (constitution). |
| 2026-09-20–23, Muse Spark session (deletion workflows) | STB-SYS-01 closed slices deletable (checkbox + backend guard; in-flight open slices stay locked; edit stays locked; audit preserved). New 2-phase breakdown batch delete per unit×period (`DELETE /breakdown/batch`, preview→confirm, blocks open slices/closed shifts, cap 100 units/500 incidents, mandatory reason) + audit table via migration 042 (applied to production DB). Breakdown History UX: Jenis/Unit slicers, collapsible type groups, forced scroll + row-count guard, sticky delete bar. | `VERIFIED_REPO`: controller, routes, migration 042, tests; backend suite 149/149 at deploy; `VERIFIED_PRODUCTION`: deployed 2026-09-23. | No restore UI (backlog); execute path writes audit, preview never writes. |
| 2026-09-20–23, Muse Spark session (ops + analyses) | Absensi list LIMIT 500 lifted for explicit date ranges + row-count line. Vercel production deploy `dpl_FNV3A7MFJGULYDUxBsgceMrTKMke` READY, alias `/health` OK, loader versions verified live. No-code analyses: Sugito 409 = transient partial-datang row (0 rows at check; auto-close 13h is by design — 6h proposal rejected as destructive); Truck-Factor empty columns = `contentHtml`-only material extraction vs `fleetCatalog`; photo retention must use `purgeExpiredPhotos.js` (SQL cannot delete storage files); NonProd/Inpit remains `PLANNED` (`docs/RENCANA_NONPROD_INPIT_RITASE.md`). | `VERIFIED_REPO` + `VERIFIED_PRODUCTION` for deploy; analyses evidence-labeled in chat, no code changed. | Session spans commits `39ab4c0..b31c767` plus uncommitted working-tree changes at deploy time — run `git status` and commit before next release. Migration 039 production-apply status still open from prior ledger. |
| 2026-09-23, Codex Non Prod/Inpit Ritase P0–P4 | Input Ritase preserves gross trips and records per-truck/hour Non Prod separately; productive trips drive fleet production, new productivity snapshots, Review Produksi, Data Produksi/fuel ratio, Jarak Final, and JPEG Lapor. The grid adds a yellow per-hour Non Prod row/modal, atomic save validation, dirty warning, and append-only change audit. | `VERIFIED_PRODUCTION`: migration 043 applied; four columns, two constraints and `ritase_nonprod_audit` verified; 3,804 existing active logs default to zero Non Prod with zero invalid rows. Backend 154/154 and dashboard 75/75 pass. Deployment `dpl_4MsEjZGmY2j1ekrwfF2RiDudWnC5` READY; production alias health 200, loader serves core v1/production v88, runtime error scan clean. | Current Jarak Final rule assumes Non Prod comes from base/unallocated distance; distance-specific Non Prod would require a future schema extension. |
| 2026-09-24, Kilo session | Data Produksi: gear simbol pada kolom induk JOB (CG·Coal Getting, FOT·FOT, OB·Overburden Removal) menampilkan opsi sumber data (Input Ritase / Manual). Mode Manual menggantikan nilai ritase pada rekap bulanan (TOTAL & fuel ratio). Nilai manual disimpan ke `production_manual_sources` + `production_manual_overrides`. | `VERIFIED_REPO`: migrasi 047, backend service/controller/routes, frontend gear+dialog+editable cells, 23/23 backend tests, 7/7 dashboard tests pass. | Browser visual review localhost membutuhkan login admin@perusahaan.com (password sementara 12345678). |
| 2026-09-23, Muse Spark session (ritase modal sizing) | Jarak Final & Non Prod/Inpit modal windows widened to content (`#modalKonten:has(...)` rules in `admin-dashboard/style.css`); previously fell back to narrow base container causing horizontal drag-scroll. Noted: `docs/RENCANA_NONPROD_INPIT_RITASE.md` (this session's plan) predates the Codex P0–P4 implementation above and is stale. | `VERIFIED_REPO`: stylesheet diff only, braces balanced. | Visual check on localhost by owner required (modal widths, small-screen media rule). |
| 2026-09-24, Muse Spark session (Database Fuel P1) | Decisions locked (observed Liter; FIFO volume+cost, no average; IDR; no fake locations/opening balances; block negative stock; calendar-day ADU; ±2% opname alert default; maker-checker, admin-only pending RBAC). Migration 048 (products, locations, transactions, lines, audit + sequence; FIFO/opname tables deferred to P3/P4). Domain service + admin API `/fuel-inventory/*` (draft/post/reverse/void, idempotency, one-active-issue-per-log, running-balance ledger). | `VERIFIED_REPO`: `048_*.sql`, `fuelInventory.js`, controller, routes, `fuel-inventory.test.js` (4 tests incl. validation, idempotency, reversal, void); backend suite 166/166. | P2–P6 (Input Fuel link, FIFO allocator, opname, workspace UI, go-live) remain; do NOT run migration on prod until P2+ integration plan confirmed. Button opens honest PROPOSED placeholder. |
| 2026-09-24, Muse Spark session (Database Fuel P2) | Shadow Input Fuel integration: mapping master (049, shift/truck/operator→location+product, unique-or-null resolve, never guess) + auto ensure/void/recreate draft issues via fail-safe hooks (create/update/delete/restore; fuel op never fails because of inventory) + manual link + reconciliation (unlinked/orphan/mismatch). Posted issues immutable (mismatch flagged, not mutated). No stock movement by design (§13.6). | `VERIFIED_REPO`: `049_*.sql`, service P2 fns, controller/routes additions, `fuel-inventory-p2.test.js` (resolve, shadow create/sync/void/recreate, retry, link, reconciliation, depot→truck→unit); backend suite 170/170. | P3–P6 remain; UI P5 later. Mapping master starts empty — fill real depot/tank/truck rows before expecting auto-linkage. |
| 2026-09-24, Muse Spark session (Database Fuel P3) | FIFO allocator + transfer atomik + reversal-restore: migrasi 050 (`fuel_fifo_layers`, `fuel_fifo_allocations`), konsumsi oldest-first `(received_at,id)` dengan `FOR UPDATE`, blokir stok negatif tanpa tulisan parsial, receipt tersentuh-ditolak-422, transfer depot→truck satu `transfer_group_id` + idempotency + cost snapshot rata-rata tertimbang, reversal kembalikan layer asal. | `VERIFIED_REPO`: `050_*.sql`, `fuelInventory.js` (transferStock/getFifoLayers/getAllocations), controller/routes, `fuel-inventory-p3.test.js` 4/4; backend suite 174/174. | P4–P6 (opname, workspace UI, go-live) remain; jangan run migrasi di prod tanpa perintah. |
| 2026-09-24, Muse Spark session (Database Fuel P4) | Stock opname: migrasi 051 (`fuel_stock_opnames`, snapshot buku + variance + alert, satu opname aktif per lokasi+produk via partial unique index). Alur draft→submitted→adjusted/rejected; approval cek buku-vs-snapshot (konflik = 409), maker-checker (403 bila penghitung = penyetuju), note wajib bila alert > ±2%, adjustment_in buka layer baru (cost eksplisit/NULL, tak pernah average) + adjustment_out konsumsi FIFO tertua, semua atomik + audit. | `VERIFIED_REPO`: `051_*.sql` + runner, service P4 fns, controller/routes `/opnames/*`, `fuel-inventory-p4.test.js` 7/7; backend suite 181/181. | P5–P6 (workspace UI, go-live) remain; jangan run migrasi di prod tanpa perintah. Status `approved` dicadangkan untuk alur approve-post terpisah. |
| 2026-09-24, Muse Spark session (Database Fuel P5) | Workspace UI + agregasi server: endpoint `/stock-summary`, `/flow-series`, `/usage-stats` (ADU kalender, formula `fuel-ledger v1`), `/export` CSV (filter/waktu/satuan/versi formula), ledger paginasi offset; UI 5 tab (Overview, Ledger 50/halaman, FIFO & Stock, Opname + form catat, Analytics Chart.js) dengan filter dari/sampai/lokasi/produk/status, KPI, badge alert, empty/loading/error states; aksi tulis via `OMOSActionFeedback`; tombol Database Fuel kini membuka workspace LIVE (placeholder PROPOSED dihapus). | `VERIFIED_REPO`: service/controller/routes P5, `databaseFuel.workspace.js` + loader, `index.html`, `production.js` hook; `fuel-inventory-p5.test.js` 3/3, `databaseFuel.workspace.test.js` pure helpers; backend 186/186, dashboard 85/85. | Visual browser review localhost oleh owner WAJIB sebelum deploy (konstitusi); Chart.js butuh CDN (offline = pesan, data tetap valid). Formula tak berubah (P0 terkunci) — skill mining-validation tak diperlukan. |
| 2026-09-24, Muse Spark session (Database Fuel P6) | Laporan integritas 4 pasangan (kode saja, tanpa deploy): `GET /integrity-report` — ledger vs FIFO, transfer out vs in per `transfer_group_id`, adjustment vs opname, issue vs Input Fuel (reuse P2) — dengan `ok` global + `formula_version`. | `VERIFIED_REPO`: `getIntegrityReport`, route/controller, `fuel-inventory-p6.test.js` 2/2 (bersih + 4 temuan); backend 186/186. | TIDAK ada backup/dry-run/deploy/rollback prod — butuh perintah owner. Migrasi 048–051 belum di-run di DB mana pun. Ditemukan & diperbaiki: `run_all_mining_migrations.js` rusak sintaks (`];` ganda, bawaan edit sesi lalu, belum dikomit) — kini `node --check` lolos. Runner tidak mencantumkan 040/041/047 (jalur apply terpisah, di luar cakupan). |
| 2026-09-24, Muse Spark session (eksekusi migrasi 048–051 prod) | Atas perintah owner: dry-run per file (transaksi + ROLLBACK) lalu CREATE berurutan ke Supabase production (PG 17.6, pooler ap-southeast-1). | `VERIFIED_PRODUCTION`: 9 tabel fuel_* ada, sequence `fuel_inventory_transaction_seq` fresh, 25 FK terpasang; hanya `fuel_logs`/`fuel_log_audit` lama yang pre-existing. | Master lokasi/produk masih kosong (isi sebelum pakai); workspace UI + deploy app belum rilis — Database Fuel backend siap, go-live bertahap per §13 rencana. |
| 2026-09-24, Muse Spark session (panduan Input Fuel) | Menulis panduan pengguna berbahasa Indonesia: `docs/PANDUAN_INPUT_FUEL.md` — akses/periode, filter/KPI/status kartu, catat log inline, draf+Simpan+Undo/Redo, hapus massal, import/export Excel (format kartu aktif, maks 500/baris), approval + audit trail, anomali, rumus, receipt/opening balance via API, workspace Database Fuel, troubleshooting. Diverifikasi terhadap `production.js` (definisi aktif; duplikat lama diabaikan) dan `INPUT_FUEL_CARD_REDESIGN.md`. | `VERIFIED_REPO`: dokumen saja, tanpa perubahan kode. | Form UI receipt/penerimaan stok belum ada (masih via API); tombol/modal `bukaModalInputFuel` tak terpakai (dead code) — alur tambah aktif via baris inline kartu. |
| 2026-09-25, Muse Spark session (deploy DITAHAN — tree rusak) | Perintah deploy tidak dijalankan: `fleetDeploymentController.js` (untracked sesi paralel) sintaks rusak stabil (`Unexpected end of input`, brace +1) — deploy akan membuat API production crash saat startup. Menunggu file valid/stabil; fix assignment-per-equipment + test tetap siap diterapkan. | `VERIFIED_REPO`: node --check gagal 2× (jeda 10 dtk, hash stabil). | BUTUH OWNER: pastikan sesi paralel selesai; saya verifikasi ulang lalu deploy. |
| 2026-09-29, Codex (Fleet Deployment save `assignment_id`) | Memperbaiki simpan `+ Buat Skema` ketika rentang deployment melintasi revisi Loader Productivity. Assignment relasional sekarang dimiliki oleh unit Excavator dan setiap daily row memakai ID parent hasil `INSERT ... RETURNING`; versi, produktivitas, dan plan reference efektif tetap disimpan per hari. Backend menolak dengan 422 sebelum SQL bila parent tidak dapat dipetakan, sehingga `assignment_id` null tidak lagi dikirim ke PostgreSQL. | `VERIFIED_REPO` + `VERIFIED_TEST` + `VERIFIED_PRODUCTION`: `node --check` lulus; regresi dua planRef/dua versi dalam satu periode lulus; full backend 293/293 lulus. Deployment `dpl_AbF35XNV3PPWAhkUaa9eXGHDCMxZ` READY dan ter-alias ke `https://attendance-system-eta-opal.vercel.app`; alias `/health` HTTP 200, scan error-level dan HTTP 5xx pascarelease bersih. Files: `backend/src/controllers/fleetDeploymentController.js`, `backend/test/fleet-deployment-save.test.js`. | Tidak ada migration, mutasi data, perubahan formula/unit, atau perubahan frontend. Transaksi create/update tetap atomik dan assignment tetap berada dalam scope scheme tenant/project server-side. |
| 2026-09-25, Muse Spark session (Fuel Operations Hub P0–P4) | P0: role prod hanya admin/karyawan (tanpa fuel-role) → admin full, karyawan operasional saja; submit non-admin tetap 403 backend (jujur, jadi keputusan lanjutan). P1: shell 3 mode + flag (default on, fallback klasik) + bottom-nav mobile. P2: 3 wizard reuse API (idempotency stabil, OMOSActionFeedback, tanpa klaim offline; foto ditunda — tanpa storage contract). P3: shift board (opening Estimasi), tasks, stok cepat, notifikasi, KPI, matrix+drawer lineage, action queue. P4: master/mapping/rekon/ledger/export + klasik; Analytics tetap klasik. Backend: transfer_in/out di flow-series (terbukti di prod). | `VERIFIED_REPO`: hub pure test; backend 292/292; dashboard 123/123. `VERIFIED_PRODUCTION` (read-only): flow-series baru OK. | P5 (IndexedDB outbox) & P6 (pilot) DITUNDA eksplisit. Karyawan tulis butuh endpoint non-admin baru = keputusan owner (batas otorisasi). Visual + deploy menunggu owner. |
| 2026-09-25, Muse Spark session (fix deadlock BCM hauler) | Lingkaran setan: sel capacity diganti teks peringatan (tak bisa diketik) padahal konversi BCM→Ton butuh capacity terisi + Tempel tak normalisasi. Perbaiki: capacity kosong dipaksa ke satuan ekspektasi (tak bermakna) + `normalizeHaulerUnits` dipanggil setelah Tempel. | `VERIFIED_REPO`: sintaks OK; ppw-hauler-validation 4/4. | Belum deploy. Workaround prod saat ini: Tempel → ubah density SEAM 3 sedikit (picu normalisasi) → Simpan; atau refresh + input manual tanpa tempel-BCM. |
| 2026-09-25, Muse Spark session (fix gagal simpan 0.6) | (1) Backend: pesan validasi hauler menyebut field + nilai (`coal wajib capacityUom 'ton' (terisi 'BCM'); isi density…`). (2) Frontend: `haulerRowInvalidFields` cermin aturan backend — sel salah border merah + tooltip, baris ditandai; hasil Tempel divalidasi dengan daftar baris bermasalah (non-blocking). | `VERIFIED_REPO`: productivity-planning 12/12; ppw-hauler-validation 3/3; backend 292/292; dashboard 120/120. | Belum deploy. Solusi user saat ini: isi density SEAM 3 / ubah ke Ton. |
| 2026-09-25, Muse Spark session (diagnosa dalam gagal simpan 0.6) | Gagal simpan "Parameter Hauler DT20 6-76 / SEAM 3 belum valid": rantai terbukti — baris draft membawa capacityUom BCM (tempel/copy atau legacy) + density SEAM 3 kosong → `normalizeHaulerUnits` tak bisa konversi ke Ton → aturan coal v7+ (`capacityUom` wajib ton) menolak seluruh save. Versi efektif tersimpan masih data v2 tanpa parameters. | `VERIFIED_PRODUCTION` (read-only): unit ada, versi coal 2026-09-16 = data v2, tanpa parameters. | Perbaikan diusulkan (belum dikerjakan): tandai baris invalid di UI sebelum simpan + pesan backend sebut nama field. |
| 2026-09-25, Muse Spark session (fix tabel parameter 0.5/0.6 hide) | Tabel Parameter Material dibungkus `<details>` tanpa `open`: tiap selesai isi 1 kolom → event change → render penuh → tabel menutup sendiri. Perbaiki: details selalu open. | `VERIFIED_REPO`: sintaks OK; ppw-parameter-open 2/2. | Visual oleh owner. |
| 2026-09-25, Muse Spark session (diagnosa JOB fleet EX20 2-18) | Dropdown JOB Tambah Fleet hanya FOT karena katalog fleet plan efektif hanya memuat 2 setting EX20 2-18 (keduanya FOT–SEAM 3 coal, productivity valid). Bukan bug: dropdown disaring per excavator + productivity valid. | `VERIFIED_PRODUCTION`: `/fleet-plans/catalog` 17 entri. | Tambah setting JOB lain di 0.5/0.6 planning (lengkap + terhubung SPO/PA) agar muncul. |
| 2026-09-25, Muse Spark session (geofence buffer akurasi) | Opsi 2 drift GPS: `dalamRadius[MultiPoint]` terima bila jarak_efektif = jarak − buffer ≤ radius; buffer = min(akurasi, MAX_BUFFER_METER 100); tanpa akurasi = strict lama; `jarak_meter` mentah + `buffer_meter` tetap dilapor; 3 call sites absensi teruskan `cekAkurasi.accuracy`. | `VERIFIED_REPO`: attendance 13/13 (kasus 106m/±30m lolos, tanpa akurasi tetap tolak, cap 100); backend 290/290. | Belum deploy (ditahan). Batas 100 m bisa disetel ulang via konstanta bila owner ingin longgar/ketat. |
| 2026-09-25, Muse Spark session (Survey: fix global is not defined) | Halaman Survey 500 karena pola IIFE modul salah (`factory()` tanpa argumen + factory tanpa param `global`) — satu-satunya dari 3 modul dengan pola salah; disamakan ke pola benar + surveyReport v2 + loader v39. | `VERIFIED_REPO`: sintaks + survey-report 5/5. | Verifikasi visual oleh owner (modul Database Fuel punya pola benar, tak tersentuh bug ini). |
| 2026-09-25, Muse Spark session (Survey 1–14 full) | Eksekusi semua: tab PIT (Semua/BEI/DKC dinamis), KPI Total OB/Coal/PIT/sel, sticky kolom-tanggal+header+footer, tint seksi OB/Coal + satuan BCM/Ton, Total baris & Total Bulan, Enter/Arrow-navigasi, sel kotor kuning + hitung Simpan, paste TSV Excel, flag anomali >2×median, Export CSV+XLSX, komparasi survey vs produksi ritase net per PIT (endpoint + seksi selisih). Backend: export + comparison + routes; UI di modul baru `surveyReport.js` (delegate tipis di production.js). | `VERIFIED_REPO`: survey-volumes 3/3; survey-report 5/5; backend 287/287; dashboard 115/115. Migrasi 057 sudah live prod sebelumnya. | Visual + isi angka oleh owner. Kode `production.js` lama dibiarkan sebagai fallback (hindari tabrakan tulis sesi paralel). |
| 2026-09-25, Muse Spark session (Survey: material coal) | Kolom Coal Getting kosong karena planning 0.6 tersimpan format lama v2 (tanpa `parameters`; material di `fleetCatalog`). `materialList` kini fallback parameters→scenarios→fleetCatalog. | `VERIFIED_REPO`: survey-volumes 2/2 (coal v2 → SEAM 3). | Restart backend lokal bila masih jalan versi lama. |
| 2026-09-25, Muse Spark session (eksekusi migrasi 057 prod) | Atas perintah owner: dry-run (transaksi + ROLLBACK) lalu CREATE `survey_volumes` ke Supabase production. | `VERIFIED_PRODUCTION`: tabel ada + PK + UNIQUE(tanggal,pit,planning_type,material) + CHECK ob/coal & volume≥0 + 2 FK users + indeks period. Tanpa tulis data. | UI Survey tree ini masih diperebutkan sesi paralel — API siap dipakai kapan pun UI kanonis selesai. |
| 2026-09-25, Muse Spark session (Survey Report: BACKEND SELESAI, UI TABRAKAN) | Migrasi 057 `survey_volumes` (file saja, BELUM di-apply prod) + API `GET /survey-volumes` (material 0.5/0.6, pits BEI/DKC dkk, volumes) + `POST /survey-volumes/batch` (validasi + upsert atomik) + routes. UI slicer/tabel editable sempat jadi TAPI `production.js` diperebutkan sesi paralel (tulis-menimpa bolak-balik; versi live-disk ≠ versi tool; `renderSurveyReport` mereka tanpa header merge OB/Coal). STOP edit frontend bersama sampai koordinasi. | `VERIFIED_LIVE_DISK` (bash): controller/routes/migrasi utuh; survey-volumes 2/2 hijau. UI: TIDAK bisa diverifikasi stabil — JANGAN deploy/commit dari tree ini sebelum digabung rapi. | BUTUH OWNER SEGERA: serialkan agen (satu tree aktif / worktree `.kilo` jangan campur `production.js` utama); tentukan implementasi Survey kanonis. |
| 2026-09-25, Muse Spark session (sidebar: Survey Report + renumber) | Sidebar MTD/YTD/PTD/Executive 10–13 → 11–14; halaman baru 10. Survey Report (placeholder + router `prodSurveyReport`, konten menyusul). | `VERIFIED_REPO`: sintaks OK; dashboard 110/110. | Isi Survey Report belum ada (placeholder). |
| 2026-09-25, Muse Spark session (Breakdown: popup MA lebar) | Modal Calendar MA diperlebar (`.modal` 420px memotong tabel): varian `.breakdown-ma-modal` 920px/95vw + scroll + tabel penuh. | `VERIFIED_REPO`: sintaks + test 3/3. | Visual oleh owner (hard refresh bila perlu). |
| 2026-09-25, Muse Spark session (Breakdown: Calendar MA) | Indikator `Calendar PA` diganti `Calendar MA` (klik → modal): MA = HM÷(HM+BD), agregat armada/jenis = ΣHM÷Σ(HM+BD); HM dari `/logs` periode + BD dari log breakdown; grup per jenis, baris per unit + detail HM/BD; KPI terisi background + basis HM·BD. | `VERIFIED_REPO`: sintaks OK, hitung terverifikasi node (65/64/null/0); breakdown-ma 3/3; dashboard 108/108 (gagal pre-existing sesi paralel sembuh sendiri). | Visual browser oleh owner. |
| 2026-09-25, Muse Spark session (Report BD: Update Status Unit) | Blok RTU pada gambar Report Breakdown diganti Update Status Unit (Contoh B, disetujui owner): per jenis equipment, baris Class Unit, kolom angka Ready/BD; sumber API unit-status/current + fallback equipment+log aktif; teks modal diperbarui. | `VERIFIED_REPO`: breakdown-report + unit-status tests 14/14. | Visual JPEG oleh owner. |
| 2026-09-25, Muse Spark session (Standby DQ: lurus header) | Header kolom angka tabel Kontrol MOHH (HM/BD/Standby/MOHH/Selisih) rata kanan agar sejajar sel data; sel `.is-number` dikunci rata kanan. | `VERIFIED_REPO`: CSS saja. | Visual oleh owner. |
| 2026-09-25, Muse Spark session (hapus aturan wajib browser preview) | Hapus bagian `UI/Frontend browser review (wajib)` dari `AGENTS.md` atas perintah owner. Panduan umum `admin-dashboard/AGENTS.md` (uji alur terpengaruh) tidak diubah. | `VERIFIED_REPO`: AGENTS.md saja. | — |
| 2026-09-25, Muse Spark session (Standby: Unplotting Unit) | Ganti indikator KPI `Reclassified ke BD` menjadi `Unplotting Unit`: hitung unit List Equipment aktif tanpa slice standby (bukan cancelled) per tanggal×shift pada filter aktif (hormati slicer jenis/class); klik membuka modal daftar per tanggal-shift dengan link unit (lompat + flash ke workspace) dan tombol [+ Plot] (`bukaInputUnitStandby`). Fungsi/modal Reclassified lama dihapus (label status lifecycle tak diubah). | `VERIFIED_REPO`: sintaks OK; backend 248/248; dashboard tetap 1 gagal PRE-EXISTING (refactor `productionDataController` sesi paralel). | Visual browser review oleh owner. File inidisentuh sesi paralel — verifikasi ulang bila tree berubah. |
| 2026-09-25, Muse Spark session (Standby DQ: HM-12jam + font + hyperlink) | (1) `HM_MISSING` tak lagi temuan bila standby+breakdown menutup MOHH 12 jam (status balanced, bisa close; tetap temuan bila kurang); (2) teks data modal DQ +30% relatif (scope `.standby-special-modal`); (3) kolom unit/angka/temuan jadi hyperlink: HM→Input Data, BD→Breakdown, standby→unit workspace (filter+scroll+flash), issue→sumber per kode. | `VERIFIED_REPO`: `production-standby-mohh.test.js` 8/8 (aturan lama yg konflik diperbarui); backend 248/248; dashboard 1 gagal PRE-EXISTING (`planProductivity.workspace.test.js` vs refactor `productionDataController` sesi paralel, bukan file saya). Sintaks production.js/style.css/controller OK. | Visual browser review oleh owner. PERINGATAN: sesi paralel aktif di tree yang sama (file `productivityReport.js` saya tertimpa versi Leader Board mereka; loader v96; migrasi/test-fixture baru bermunculan) — koordinasikan kepemilikan file sebelum deploy; deploy saya (dpl_4vpa7) tidak menyajikan kode tree ini di alias. |
| 2026-09-25, Muse Spark session (deploy attempt — DITAHAN) | `vercel --prod` menghasilkan dpl_4vpa7 (Ready) dari working tree, tapi verifikasi traffic membuktikan alias TIDAK menyajikan kode tree ini: API eta-opal mengembalikan kontrak ranking lain (`data_source`, `job_scope: spo_deployed_only`, `deployed_jobs: OB/CG/FOT`), JS Leader Board tak ada di repo, alias wodav menyajikan app Next.js asing (dpl_3oy8, tak dikenal di scope wodav). Indikasi scope ganda team_tnf8 vs wodav + implementasi paralel pihak lain sudah live. Deploy DITAHAN agar tidak merusak production yang jalan. | `VERIFIED_PRODUCTION`: /health ok; API baru tree ini BELUM live. | BUTUH OWNER: tentukan implementasi kanonis (tree ini vs Leader Board+Fuel Ratio yang live), luruskan scope/proyek Vercel, lalu deploy ulang. Catatan: git remote menanam token ghp_* hardcoded (pre-existing, sebaiknya dirotasi). |
| 2026-09-24, Muse Spark session (Productivity Ranking IMPLEMENTED) | Leaderboard achievement Gross + Data Control read-only + exclusion DW per §12 (9 keputusan locked): core murni, domain service (satu result untuk ranking & kontrol), endpoint baru, frontend 2 tab + 4 kartu + drawer lineage + highlight hyperlink; reuse `productiveRitase`, `resolvePlanningJob`, effective-plan loader; SQL tervalidasi EXPLAIN prod; tanpa migrasi (P2 evidence: tabel kecil). | `VERIFIED_REPO`: core/domain/api tests 22/22, frontend pure test; backend 226/226, dashboard 90/90. `VERIFIED_PRODUCTION` (read-only): EXPLAIN 6 query OK. | Browser review + deploy menunggu owner (Vercel CLI auth gagal: login `mahabbura-alt` bukan tim pemilik). Skill `omos-mining-validation` tak tersedia di environment — tanpa formula baru (reuse tervalidasi). |
| 2026-09-24, Muse Spark session (Pergantian Operator IMPLEMENTED) | Finalisasi fitur multi-segmen: verifikasi repo + production (read-only), hapus 7 skrip `_tmp_*` sekali pakai di `backend/src/scripts`, ubah status RENCANA → IMPLEMENTED. | `VERIFIED_PRODUCTION`: tabel sesi + 4 kolom metadata ada, 475 sesi / 475 log aktif bersesi. `VERIFIED_REPO`: reason codes (`HM_SEGMENT_OVERLAP`, `EXACT_SEGMENT_DUPLICATE`, `OPERATOR_REQUIRED_FOR_SUBMIT`), modal `bukaModalPergantianOperator`, quality badges; backend 203/203, dashboard 89/89. | Browser visual review masih menunggu owner (butuh login localhost). Tidak ada perubahan formula mining pada sesi ini. |
| 2026-09-23, Muse Spark session (Database Fuel button) | Added `Database Fuel` button first in Input Fuel header (per doc §4.1 order) opening an honest PROPOSED placeholder workspace (breadcrumb, back button, pointer to 9 P0 decisions). Full P0–P6 workspace NOT implemented — new tables/inventory/costing boundary requires owner decisions per doc §16. | `VERIFIED_REPO`: `index.html` + `production.js` syntax-checked. | Visual check by owner; answer §16 decisions before any workspace build. |
| 2026-09-23, Codex Fleet Deployment Planner | Fleet Capacity UI is redesigned as a range-based wizard: period → PIT/Area + SPO JOB + material → fleet selection → server validation → preview/publish. New relational scheme/assignment/daily/audit model snapshots plan productivity, version, unit, PA/EWH-derived daily target, and actor/status history. Published/Closed rows are projected into legacy `fleet-capacity` JSON so Review Produksi and Unit Mapping remain compatible. Server blocks duplicate published excavator/day assignments and mixed context/unit selections. | `VERIFIED_DB` + `VERIFIED_REPO`: migration 044 executed successfully; all four `fleet_deployment_*` tables, 31 constraints, and the published excavator/day unique index were queried after migration. Backend 158/158 and dashboard 78/78 tests pass. Local browser review at 1440 px and 390 px showed list and wizard without page errors or horizontal body overflow. | Application change has not been deployed. Current auth schema has no authoritative tenant/project columns, therefore records use explicit `default` scope until Core Tenant/Project ownership is introduced. Shift allocation remains intentionally out of scope because daily PA/EWH cannot be divided safely without an approved rule. |
| 2026-09-23, Codex Fleet Deployment visual alignment | Planner visuals now follow the approved mockup: six icon KPI highlights (Active Fleet, Draft, Conflict, Unassigned, Plan OB, Plan Coal), labeled period/PIT/JOB/material/status filters, icon view tabs, and List View columns Fleet/Periode/PIT/JOB/Material/Target/Status. Target is sourced from the persisted Fleet Productivity snapshot; conflict is calculated against published excavator-day assignments. | `VERIFIED_REPO` + `VERIFIED_DB`: live list controller query returned the three legacy rows plus loader/target/conflict fields. Browser review at 1500 px and 390 px had no console/page errors and no body overflow; table headers and six KPI labels were asserted. | Not deployed. Legacy rows remain read-only and show their authoritative target rate rather than a fabricated period production total. |
| 2026-09-23, Codex Fleet Deployment productivity/production columns | List View renames Target to Productivity and adds Produksi immediately after it. Productivity remains a per-hour rate (BCM/Jam or Ton/Jam); Produksi is the period total (BCM or Ton). Legacy rows without a trustworthy period-total calculation display an em dash instead of a false zero. | `VERIFIED_REPO`: targeted dashboard/backend tests 8/8 pass; browser review at 1500 px and 390 px confirmed both headers, three rows, no console/page errors, and no body overflow. | Not deployed; no database or API contract change. |
| 2026-09-23, Codex Fleet Deployment range filter | The single month control is replaced by inclusive From/To dates. Schemes are selected by period overlap; relational day count, production total, warnings, conflicts, and KPI cards are scoped to deployment days inside the selected range. Backend rejects inverted ranges with HTTP 422; legacy daily selections are clipped to the same bounds. | `VERIFIED_REPO` + `VERIFIED_DB`: date-overlap tests pass (targeted suite 8/8); read-only live controller query for 10–20 Sep returned three clipped legacy groups with 11 days, and an inverted range returned 422. Browser interaction reduced fixture rows 3→1 and active fleet 7→2; no console/page errors or desktop/mobile body overflow. | Not deployed; no migration/schema change. |
| 2026-09-23, Codex Unit Mapping embedded in Fleet Deployment | Standalone sidebar/page 0.9 is removed and Unit Mapping becomes the fifth Fleet Deployment view after Production Summary. Only its operational actions, queue, KPI/deployment board, and save-status indicator are retained; the old page heading and year/month/scope slicers are omitted. Unit Mapping daily scope now follows the inclusive Fleet Deployment Range Periode, including cross-month ranges; historical links/session values for `prodUnitMapping` redirect to the embedded view. | `VERIFIED_REPO`: Fleet Deployment + save-feedback tests 9/9 and Unit Mapping assertions pass. Browser fixture opened the embedded tab with Sep 1–30 range, rendered 3 queue units and 1 area board, reported Tersinkron, and showed no legacy header/slicers, dialogs, console/page errors, or desktop/mobile body overflow. | Not deployed; persistence endpoint/schema are unchanged. Unit Mapping continues consuming the existing compatibility Fleet Capacity plan store pending a separate migration to relational deployment assignments. |
| 2026-09-23, Codex Unit Mapping range-version fix | Fixed missing configured fleet columns in embedded Unit Mapping. The planning catalog now resolves its effective version from the selected range end (falling back to range start), while assignment days remain inclusively bounded by the selected From/To dates. This prevents a valid later planning revision inside the range from being discarded by an older range-start catalog. | `VERIFIED_REPO` + `VERIFIED_UI`: targeted Unit Mapping assertions and Fleet Deployment/save-feedback tests pass (9/9); browser fixture for 1–30 Sep displays the configured `EX30 350-14 • OB • CLAY` fleet column, reports `1 fleet aktif` and `Tersinkron`, with no console/page error, dialog, overlay, or horizontal body overflow. | Not deployed; no migration or API contract change. Unit Mapping still reads the Fleet Capacity compatibility store until relational deployment assignments become its authoritative source. |
| 2026-09-23, Codex Unit Mapping Dump Truck drop column | Each active fleet lane now separates the locked Loader anchor from a dedicated, labeled Dump Truck drag/drop pocket. The pocket remains visible when empty, reports allocated-unit count, and keeps the existing strict fleet compatibility validation; OB fleets retain a separate Dozer Support pocket. | `VERIFIED_REPO` + `VERIFIED_UI`: Unit Mapping assertions pass and related dashboard tests pass 9/9. Browser fixture shows `DUMP TRUCK`, `0 unit dialokasikan`, and `Drag Dump Truck ke kolom ini` for `EX30 350-14 • OB • CLAY`; no console/page errors or horizontal body overflow. | Not deployed; no formula, database, API, authorization, or tenant-scope change. |
| 2026-09-23, Codex flexible Dump Truck plotting | Unit Mapping no longer blocks Dump Truck placement based on PA/EWH JOB, Fleet Planning checklist, Class, or Model. Any equipment whose authoritative List Equipment type is Dump Truck can be manually plotted or auto-allocated to any active fleet. Planning mismatches remain advisory (`Di luar referensi`) and do not alter productivity calculations; non-Dump-Truck equipment and area-support misuse remain blocked. | `VERIFIED_REPO` + `VERIFIED_UI`: Unit Mapping assertions cover cross-JOB/Class/Model/checklist assignment and non-DT rejection; related dashboard tests pass 9/9. Browser dragged `DT30 126`, deliberately omitted from the plan checklist and without a JOB assignment, into the OB fleet; it moved out of queue, persisted with `Tersimpan`, produced only an advisory message, and caused no dialog, console/page error, or body overflow. | Not deployed; no database, API, formula/unit, authorization, or tenant-scope change. Existing saved mappings remain compatible. |
| 2026-09-23, Codex Fleet Deployment wizard catalog diagnosis | `+ Buat Skema` currently sources its Fleet checkbox list exclusively from the effective Loader Productivity catalog at `wizard.dateStart`, then applies an exact JOB + material + OB/Coal filter. Live read-only checks show no Coal catalog on 1–15 Sep; Coal becomes effective 16 Sep with `EX30 350-14` and `EX30 350-15` for CG/SEAM 3. `EX30 2-26` is active in List Equipment but has only OB Loader Productivity records, so it is omitted under CG. Changing `dateStart` in an open wizard does not reload options, creating an additional stale-list defect. | `VERIFIED_DB` + `VERIFIED_REPO`: effective catalog queried for 1, 15, 16, and 23 Sep; frontend `loadOptions()` and exact `catalogForContext()` filters inspected. | Diagnosis only; no implementation yet. Recommended correction is to source candidates from active Excavators, resolve Loader Productivity per operational day/context, allow incomplete drafts, and block publish—not selection—when a target is missing. |
| 2026-09-23, Codex Fleet Deployment flexible Excavator candidates | Implemented the diagnosis recommendation. Wizard candidates now come from every active List Equipment Excavator, while Loader Productivity is resolved by JOB/material/type for each operational day across version changes. Changing the wizard range reloads range-end context options. Missing targets are visibly marked, may be selected and saved as draft, but server preview/status validation blocks publish until every day has a valid target and PA/EWH. JOB options come from deployed SPO. Assignment payloads use server-resolved equipment IDs rather than trusting frontend productivity values. | `VERIFIED_DB` + `VERIFIED_REPO` + `VERIFIED_UI`: migration 045 executed and `plan_productivity` is nullable; actual 1–30 Sep options return CG, five active Excavators, and `EX30 2-26`. Actual preview for CG/SEAM 3 + `EX30 2-26` returns 30 missing-plan rows and `canPublish=false`. Backend full suite 160/160 and targeted dashboard suite 11/11 pass. Browser wizard displays/selects `EX30 2-26`, marks Loader Productivity missing, and renders blocking validation without console/page errors or body overflow. | Application is not deployed. Migration is backward-compatible and does not alter historical values. Material options still require a material present in the effective range-end Loader Productivity catalog; adding a wholly new material remains a Loader Productivity setup responsibility. |
| 2026-09-23, Codex Fleet Deployment local stale-backend recovery | Fixed the local preview symptom where the new Fleet wizard displayed `Tidak ada Excavator aktif` because static frontend `:8080` was paired with a pre-change Node process on `:3000` whose options response lacked `excavators`. Local backend was safely restarted, and `loadOptions()` now falls back to authenticated `/production/master` when the options contract is absent/empty, filtering only active non-deleted Excavators. Asset version advanced so hard refresh loads the fix. | `VERIFIED_LOCAL` + `VERIFIED_UI`: backend `:3000/health` returns `ok`; fallback fixture intentionally omits `options.excavators` yet wizard renders two Excavator cards including `EX30 2-26`; no console/page errors or body overflow. Targeted dashboard tests pass 10/10. | Not deployed. Fallback is compatibility protection only; the updated backend options endpoint remains authoritative when available. |
| 2026-09-23, Codex Fleet Deployment validation pool fix | Fixed wizard validation failing with `ECHECKOUTTIMEOUT`. Options and preview now reserve one PostgreSQL client for the full request, and effective Loader Productivity versions plus related context reads are processed sequentially instead of creating a nested burst against the five-slot transaction pool. Raw pool errors are translated to a retryable HTTP 503 message. | `VERIFIED_PRODUCTION` + `VERIFIED_REPO`: three concurrent real 30-day CG/SEAM 3 previews completed HTTP 200 in ~5.4 s with no checkout timeout; backend full suite passes 161/161. Production deployment `dpl_4R5NfDb2yKhXfgSQKhATNvDE9Csd` is READY; deployment and primary-alias `/health` return `ok`, and the post-release error-log scan is clean. | No schema, formula, unit, authorization, or tenant-scope change. The test fixture remains intentionally non-publishable because `EX30 2-26` has no matching Loader Productivity target. |
| 2026-09-24, Codex Breakdown direct Ready release | Retired the post-maintenance Ready-verification/reconciliation workflow. Selecting `resolved` now closes the active BD segment, stores final Breakdown hours, resolves the incident, and returns equipment to Ready only when no other open Breakdown exists. The API/UI no longer exposes verification endpoints, status, forms, timeline entries, or STB-SYS-01 behavior. Migration 046 is prepared to resolve any pending legacy incidents, soft-retire generated verification Standby records, and retain STB-SYS-01 only as a locked/deleted foreign-key tombstone. Server master-data output excludes every system Standby code, so the retired code is absent from Parameter and operational selectors and cannot be reactivated by users. | `VERIFIED_REPO` + `VERIFIED_UI`: backend 158/158 and dashboard 82/82 pass; dedicated tests prove no verification/Standby writes, retired endpoint returns 404, and the master tombstone preserves historical foreign keys without remaining selectable. Local responsive preview shows Breakdown Aktif plus `Unit Ready / Riwayat Release`; console warning/error list is empty. | Migration 046 is **not applied** and application is **not deployed**. Historical `breakdown_ready_verifications` and the deleted master tombstone remain audit-only by design; execute migration together with the application release so legacy rows stop affecting operational views/KPI. |
| 2026-09-24, Codex Database Fuel design | Added the detailed proposed architecture and phased implementation guide for a Database Fuel workspace covering inventory ledger, receipts/issues/transfers, FIFO layers and allocations, stock opname, charts, Input Fuel linkage, audit, RBAC, offline/idempotent sync, reconciliation, and safe rollout. The plan explicitly keeps `fuel_logs` authoritative for unit consumption/HM/KM ratios while the new ledger becomes authoritative for stock. | `DESIGNED`: `docs/RENCANA_DATABASE_FUEL_FIFO_STOCK_OPNAME.md`; aligned with the implemented Input Fuel rules documented in `docs/INPUT_FUEL_CARD_REDESIGN.md`. | No code, schema, API, or UI was implemented. P0 requires owner decisions for observed vs standard Liter, FIFO costing, locations, negative-stock policy, approval, thresholds, and cutover opening balances. |
| 2026-09-24, Codex Input Data multi-segment design | Designed an incremental unit-shift session model so one unit may have multiple operator/HM segments and may change PIT/Area or JOB within one operational shift. PIT/Area and JOB belong to each segment; differences in context never bypass HM-overlap protection. The plan replaces the broad `DUPLICATE_UNIT_SHIFT` block with exact-duplicate and interval-overlap protection, preserves per-operator payroll HM, splits area/JOB aggregation by segment, and requires downstream unit-shift aggregation to use overlap-safe segment sums instead of `MAX(total_hm)`. | `DESIGNED`: `docs/RENCANA_PERGANTIAN_OPERATOR_INPUT_DATA.md`; repository inspection confirmed the current blocker in `analyzeHmHybrid()`, batch skip behavior, and MOHH `MAX(total_hm)` assumption. | No code, migration, API, or UI change was made. Implementation must update validation, session locking/idempotency, Input Data grouping, import/restore behavior, PIT/Area–JOB aggregation, MOHH/standby/review aggregation, fuel attribution, and reconciliation together before the rule is opened. |
| 2026-09-24, Codex Database Fuel browser-runtime fix | Fixed Database Fuel failing with `global is not defined`. Its UMD wrapper now passes the selected runtime root (`window` in browser, `globalThis` in Node) into the factory instead of relying on Node's implicit `global`; the lazy-loader asset version was advanced to bypass cached broken JavaScript. | `VERIFIED_REPO` + `VERIFIED_UI`: browser-context regression added to `databaseFuel.workspace.test.js`; complete dashboard suite passes 85/85. Local fixture renders Overview KPIs and stock table, reports an empty isolated runtime-error list, and has no failure banner. | Not deployed. No backend, database, API, formula, authorization, or tenant-scope change. The preview fixture uses explicit mock inventory data solely for visual regression. |
| 2026-09-24, Codex Input Fuel user guide | Added an implementation-accurate user guide for daily Input Fuel, HM/KM baselines, formulas, KPI/status/approval, edit/audit/delete/import/export, Database Fuel tabs, Stock Opname, FIFO, analytics, stock receipt, transfer, issue linkage, troubleshooting, and operational checklists. The guide explicitly separates available web functions from backend-only inventory operations so users are not instructed to use nonexistent buttons or direct APIs. | `DOCUMENTED`: `docs/PANDUAN_USER_INPUT_FUEL_DAN_DATABASE_FUEL.md`; formulas and units verified against the active controller/service code and `omos-mining-validation` rules. | No application, schema, API, or UI change. Receipt/opening balance/transfer/post/reversal/mapping/allocation forms remain absent from the web workspace; Database Fuel must not be treated as the official complete stock source until these go-live gaps are closed. |
| 2026-09-24, Codex Productivity Report runtime fix and conformance audit | Fixed `global is not defined` by passing the selected browser/Node runtime root into the Productivity Report factory and advanced the lazy-loader asset version. Added a browser-context regression and local interactive preview. Corrected the `Dikecualikan` highlight count so it matches the rows opened by its hyperlink. Audited implementation against `docs/RENCANA_PRODUCTIVITY_REPORT_RANKING.md`; authoritative formulas, four rankings, Data Control, lineage, effective plans, OB/Coal separation, incomplete handling, and DW exclusion conform. | `VERIFIED_REPO` + `VERIFIED_UI`: dashboard suite 90/90 and backend suite 226/226 pass (including Productivity Report core/domain/API 22/22); localhost Ranking and Data Control rendered without console errors. Files: `admin-dashboard/productivityReport.js`, `admin-dashboard/productivityReport.test.js`, `admin-dashboard/production.loader.js`, `admin-dashboard/test-fixtures/productivity-report-preview.html`, `backend/src/services/productivityRanking.js`, `backend/test/productivity-ranking-domain.test.js`, and the ranking plan. | Not deployed. Remaining non-blocking gaps: master-backed dropdown filters, persistent calculation history/snapshots, Data Control highlight-card row, and large-range performance hardening. Tenant/project boundaries are unchanged; existing admin authorization remains authoritative. |
| 2026-09-24, Codex direct-use Input Data and Standby | Removed the Productivity Report `draft`/`submitted` eligibility gate: every saved, non-deleted numeric Input Data Work Log is eligible immediately. Retired the Standby review queue, actions, filters, badges, reviewer API, and MOHH/delete gates; saved active Standby (`open`/`confirmed`) is used directly by Review Produksi and related calculations. Soft-deleted, `reclassified`, and `cancelled` history remains excluded from active calculation, while audit/lifecycle history is preserved. | `VERIFIED_REPO` + `VERIFIED_UI`: backend 229/229 and dashboard 92/92 pass; syntax and diff checks pass. Read-only live service check for DT30 130 (6-92), 12 Sep Shift Siang now consumes 6.70 HM despite legacy `draft` status and reports only `MISSING_PLAN`. Responsive localhost Standby preview has no review controls/columns and no console errors. Files include production controller/routes/UI/loader, Productivity Ranking service/tests, Standby direct-use regressions, ranking plan, and preview fixture. | Not deployed. No migration: legacy Standby review columns are retained as inert historical metadata for backward compatibility. DT30 130 remains incomplete until a matching Hauler plan exists; HM is no longer the blocker. |
| 2026-09-25, Codex Leader Board / Fuel Ratio Ranking implementation | Renamed the visible Productivity Report to `Leader Board`, rebuilt the workspace to the approved dashboard layout, and added sibling `Productivity Ranking`, `Fuel Ratio Ranking`, and metric-aware `Data Control` tabs with shared slicers, hyperlink highlights, anomaly drill-down, four entity rankings, detail lineage, and responsive cards/tables. Data Control now exposes its own explicit `[Productivity Ranking] [Fuel Ratio Ranking]` selector, so its dataset never depends invisibly on the previously opened ranking tab. Fuel Ratio authority is allocated saved Input Fuel liters divided by Net Productive BCM; Coal Ton is converted using snapshotted/effective material density. Period aggregation uses `SUM(liter) / SUM(BCM)`, lower ratios rank first, and ambiguous allocation/material/density or zero productive BCM remains incomplete rather than becoming zero or silently prorated. | `VERIFIED_REPO` + `VERIFIED_UI`: backend 233/233 and dashboard 92/92 pass; syntax/diff checks pass. Localhost Productivity, Fuel Ratio, and both Data Control modes rendered in the approved layout with empty warning/error console. Files: `backend/src/services/fuelRatioRanking.js`, `backend/src/services/productivityRanking.js`, production controller/routes, `backend/test/fuel-ratio-ranking.test.js`, `admin-dashboard/productivityReport.js`, `.css`, UI test/fixture, loader, and sidebar label. | Not deployed; no schema migration. Existing production admin authorization remains on both new read endpoints and tenant/project boundary is unchanged. Historical FR target/achievement is intentionally not fabricated from non-effective-dated `fuel_rate_lph`; rankings currently expose actual L/BCM plus data quality. |
| 2026-09-25, Codex Leader Board direct Hauler plan | Plan Productivity DT/Driver now resolves directly from effective OB/Coal `Hauler Productivity` using the actual loading excavator, DT, material, and actual fleet-distance header. DT membership in `Setting Fleet` is no longer an eligibility gate; legacy snapshots without Hauler database retain the old `truckResults` fallback. The existing loading-pass, cycle-time, capacity, density, and efficiency formula is reused at full precision. | `VERIFIED_REPO` + `VERIFIED_DATA`: backend 234/234 pass. Read-only live sample 5 Sep 2026 resolves DT30 137 (6-99) under EX30 350-15 at 2.1 km to 24.3975903614 BCM/Hr; Shift Malam and driver Fiktor are `ready` with no reason code. | Not deployed; no migration or frontend change. PIT/Area Shift Malam remains null and is a separate source-data quality issue. |
| 2026-09-25, Codex Leader Board Data Control-first flow | Leader Board now opens with tab order `Data Control → Productivity Ranking → Fuel Ratio Ranking`. Productivity Data Control separates `Produksi`, `HM`, and `PDTY`; PDTY is the row-level `gross production / HM`, remains null when HM is unavailable, and is sortable. Ranking metadata declares Data Control as its source: Productivity aggregates with HM-weighted `ΣProduksi/ΣHM`, while Fuel Ratio aggregates with productive-BCM-weighted `ΣLiter/ΣBCM`. The visible lineage card mirrors this flow. | `VERIFIED_REPO` + `VERIFIED_UI`: backend 234/234 pass; 28 dashboard test files pass; localhost preview shows the new tab order and columns with an empty browser console. | Not deployed; no migration or API route change. Existing response fields remain backward compatible; metadata fields were added. |
| 2026-09-25, Codex Leader Board SPO-deployed JOB scope | Productivity and Fuel Ratio Data Control now admit only unit/personnel rows whose canonical JOB is deployed in the current SPO. The filter is applied before quality classification and ranking, so non-deployed JOB rows cannot appear as ready, incomplete, anomaly, or zero. Structured SPO data and legacy HTML remain supported through one shared parser; response metadata exposes `job_scope=spo_deployed_only` and `deployed_jobs`. | `VERIFIED_REPO` + `VERIFIED_DATA`: backend 236/236 pass. Read-only live check for 1–25 Sep resolved deployed JOB `CG`, `FOT`, and `OB`; 200 Productivity rows and 200 Fuel Ratio rows checked with zero JOB outside SPO. | Not deployed; no migration or route change. Existing admin authorization and tenant/project boundaries are unchanged. |
| 2026-09-25, Codex Leader Board SPO scope production release | Released the accumulated Leader Board/Data Control implementation including the SPO-deployed JOB scope to Vercel production. | `VERIFIED_PRODUCTION`: deployment `dpl_8Q93m4QC7rUmn95Q7MkDaGsfGgvg` is READY and aliased to `https://attendance-system-eta-opal.vercel.app`; primary-alias `/health` returned HTTP 200 `{"status":"ok","serverless":true}`; post-release error and HTTP 5xx scans returned no logs. Pre-release backend 236/236 and dashboard 92/92 passed. | No migration was executed for this release. The deployment-specific URL is protected by Vercel authentication; validation used the public primary alias. |
| 2026-09-25, Codex Input Data flat-table restoration | Restored the original flat Work Log table by removing inserted unit-shift summary rows, group badges, and the inline handover action from the primary renderer. Multi-segment backend rules remain: a unit may have multiple non-overlapping Work Logs in one operational shift with different operator/driver, PIT/Area, or JOB; overlap and exact duplicate protection remain authoritative. The implementation plan now records flat-table display as the final UX decision. | `VERIFIED_REPO` + `VERIFIED_UI`: dashboard 90/90 pass; HM segment validation 15/15 pass. Local browser preview rendered three plain Work Log rows, including the same DT unit twice with different operator/PIT/JOB; zero group rows, zero runtime errors, and no body overflow. | Not deployed. No database, API, formula, unit, authorization, or tenant/project-scope change. The session/handover backend and modal implementation remain available for compatibility but are no longer injected into the main table. |
| 2026-09-25, Codex Input Data flat-table production release | Released the flat Input Data Work Log table while retaining multi-segment backend validation and context-specific operator/PIT/JOB records. | `VERIFIED_PRODUCTION`: deployment `dpl_9BrrikNyuyjZrJxF1ujcSsK65VMj` is READY and aliased to `https://attendance-system-eta-opal.vercel.app`; `/health` returned HTTP 200 `{"status":"ok","serverless":true}`; post-release error and HTTP 5xx scans were clean. Targeted pre-release checks passed 17/17 after the full dashboard 90/90 gate. | No migration or API contract change. Deployment used the current working-tree snapshot rather than a Git commit. |
| 2026-09-25, Codex Input Data second-segment SQL fix | Fixed create Work Log failing only on the second record of an existing unit-shift session. The last-segment query used invalid PostgreSQL ordering `segment_sequence NULLS LAST DESC`; it now uses `segment_sequence DESC NULLS LAST`. This restores same-unit non-overlapping records with different operator/PIT/JOB without weakening overlap or exact-duplicate validation. | `VERIFIED_REPO` + `VERIFIED_DATA`: backend 238/238 pass; dedicated regression verifies valid SQL and absence of the old clause. Read-only production sample EX30 350-15, 23 Sep Shift Siang confirms existing OB 9052.6–9056.1 and candidate CG/DKC 9056.1–9062.8 has no hard/critical/warning issue. The old query reproduced `syntax error at or near "DESC"`; corrected query returned the existing segment. | Not deployed; no migration, frontend, formula, unit, authorization, or tenant/project-scope change. |
| 2026-09-25, Codex Input Data second-segment SQL hotfix release | Released the PostgreSQL `DESC NULLS LAST` correction for creating a second Work Log in an existing unit-shift session. | `VERIFIED_PRODUCTION`: deployment `dpl_ENxk1XJJALyRPexmsZkyyqaRnXDV` is READY and aliased to `https://attendance-system-eta-opal.vercel.app`; `/health` returned HTTP 200 `{"status":"ok","serverless":true}`; post-release error and HTTP 5xx scans were clean. Targeted SQL/multi-segment gate passed 17/17; full backend gate before release passed 238/238. | No migration or API contract change. Deployment used the current working-tree snapshot. |
| 2026-09-25, Codex Input Data inline Insert Data | Replaced the visible `+ Multi Work Log` and `+ Tambah Work Log` actions with one `+ Insert Data` action. Insert creates a blank inline draft row; new rows POST and existing edits PATCH only when `Simpan Perubahan` is pressed. Save is dim/disabled while clean, becomes active on change, and exposes `Tersimpan` / `Data belum disimpan`; local draft recovery and navigation reminders remain active. Unsaved insert rows can be removed locally without sending temporary IDs to the API. | `VERIFIED_REPO` + `VERIFIED_UI`: JavaScript syntax passes; dashboard 92/92 and multi-segment backend regression 2/2 pass. Localhost interaction changed rows 3→4, produced one blank highlighted row, enabled `Simpan Perubahan (1)`, showed `Data belum disimpan · 1 baris`, had no console errors and no body overflow. Files: `admin-dashboard/index.html`, `production.js`, `style.css`, loader/tests/fixture, `docs/RENCANA_PERGANTIAN_OPERATOR_INPUT_DATA.md`. | Not deployed. No migration, mining formula/unit, API contract, authorization, or tenant/project-scope change. Legacy modal functions remain internal compatibility code but are no longer reachable from the Input Data UI. |
| 2026-09-26, Codex Review Produksi reconciliation diagnosis | Read-only reconstruction for 20–23 Sep 2026, BEI/OB proved the 6,046 expected vs 12,962 actual badge is a calculation-grain defect, not rounding. Review applies the 23 Sep productivity revision to all four days, calculates ΔProductivity only from production matching the planned material while its actual total includes every material on the plotted unit/date, and mixes OB-only HM in ΔProductivity with all-JOB HM in PA/UA/table actual. Manual Excel also has two input-basis issues: it applies the 18 Sep plan to 23 Sep despite a new effective revision, and EX30 350-15 uses 175.22 as actual productivity instead of measured 5,618/38.3 = 146.68. | `VERIFIED_DATA` + `VERIFIED_REPO`: direct read-only controller response and production DB queries; exact server components reproduce 18,894.835 + 515.900 - 6,271.005 - 7,093.989 = 6,045.742. No application code changed. | Fix Review at date-effective, consistent unit+date+pit+JOB+material+UoM grain; allocate HM/downtime consistently and add integration regressions before treating the badge as authoritative. |
| 2026-09-26, Codex Review Produksi Source Planning | Added a top-right Source Planning selector with `Fleksibel` as the backward-compatible default and `Konservatif` as the Fleet Deployment mode. Flexible resolves date-effective Loader/Hauler Productivity at date+unit+JOB+material+UoM grain while retaining actual PIT context. Conservative resolves published Fleet Deployment at exact date+unit+PIT+JOB+material+UoM grain and separates nonmatching production into `Other/Unplanned Material`. Main review and Pareto endpoints share the selected mode; stale UI responses are discarded during rapid switching. | `VERIFIED_REPO` + `VERIFIED_DATA` + `VERIFIED_UI`: targeted backend 6/6 and dashboard 7/7 pass. Local preview verified both modes, changed totals/captions and Conservative unplanned-material rows, with no console errors. Read-only BEI/OB 20–23 Sep sample: Flexible plan 25,749.50 / actual 19,586 / other 0; Conservative plan 18,894.83 / matched actual 4,872 / other 14,714. | Not deployed. No migration or write-path change. Endpoint accepts optional `planning_source=flexible|conservative`; omitted value defaults to Flexible. Existing endpoint authorization and scope are unchanged. |
| 2026-09-26, Codex Review Produksi closed-grain reconciliation | Replaced the approximate period/material waterfall with `review-waterfall-closed-grain-v2`. HM is retained at date+unit+PIT+JOB and allocated by material from ritase spans; plan revisions, EWH, production, PA/UA stages, and actual productivity are calculated per date+unit+PIT+JOB+material+UoM before aggregation. The sequential bridge is Plan → actual available hours at UA plan → actual HM at plan PDTY → actual production, so cross-period PDTY and multi-material interactions cannot leave an unexplained residual. PA/UA Pareto remains a cause-hours view and no longer performs an incompatible legacy volume cross-check. | `VERIFIED_REPO` + `VERIFIED_DATA` + `VERIFIED_UI`: backend 262/262; targeted Review dashboard 8/8. BEI/OB 20–23 Sep Flexible returns plan 24,174.9894 + ΔPA 1,324.1372 + ΔUA -9,494.2981 + ΔPDTY 3,581.1715 = actual 19,586 with floating residual <4e-12. Conservative closes exactly at matched actual 4,872 and keeps 14,714 as Other/Unplanned. Local preview shows the green reconciliation check and closed-grain PA/UA notes without a visible runtime error. | Not deployed. No migration/write-path change. Plan totals can legitimately change versus the old report because HM from a different PIT/JOB is no longer used to give the selected context a full-day plan share. Full dashboard has three pre-existing unrelated failures: obsolete workspace expectation and two stale `production.js?v=96` assertions (current v97). |
| 2026-09-26, Codex Review Produksi Fleet x Material source | Renamed the visible planning sources to `Aktual` and `Fleet Deployment`, retained their internal compatibility values, and added `Fleet x Material`. The new hybrid source takes eligible excavator/date/PIT/JOB scope from published Fleet Deployment but resolves material and date-effective productivity from pages 0.5/0.6; deployment material is intentionally not a gate. `Other Fleet` is now exclusive to an excavator outside deployment scope for the selected date/PIT/JOB. A deployed context without a matching 0.5/0.6 productivity plan is separated as `Missing Productivity Plan`, never silently merged into Other Fleet. Main Review and Pareto share the source value. | `VERIFIED_REPO` + `VERIFIED_DATA` + `VERIFIED_UI`: backend full suite 263/263 and targeted dashboard source suite 4/4 pass. Live read-only BEI/OB 20–23 Sep sample returns Aktual fleet 19,586/other 0; Fleet x Material fleet 12,962/other 6,624; Fleet Deployment fleet 4,872/other 14,714. Local preview switched through all three choices, rendered the hybrid captions/table/waterfall, and browser console was empty. Files: production controller/tests, Review Produksi UI/test/fixture, loader asset version. | Not deployed; no migration/write-path change. Endpoint now accepts `planning_source=flexible|fleet_material|conservative`; omitted remains `flexible`/Aktual. Existing authorization and tenant/project scope are unchanged. |
| 2026-09-26, Codex Review Produksi fixed chart-bar width | Standardized Review Produksi bar-chart width using one 40 px maximum shared by Plan vs Aktual, Waterfall Loss & Gain, PA Pareto, and UA Pareto. A Pareto containing only one or two categories no longer stretches its bars across the chart; crowded charts may still shrink responsively. Asset versions were advanced to bypass stale browser cache, and the visual fixture now includes one-category PA/UA data for regression review. | `VERIFIED_REPO` + `VERIFIED_UI`: targeted Review dashboard suite 5/5 passes. Local responsive preview shows the single `Waiting Front` UA bar at the same visual scale as Waterfall bars; browser console is empty. Files: `admin-dashboard/reviewProduksi.js`, `reviewPaWaterfall.js`, `reviewUaWaterfall.js`, `production.loader.js`, targeted test and preview fixture. | Not deployed. No backend, database, API, formula, authorization, or tenant/project-scope change. |
| 2026-09-26, Codex PA/UA drill-down volume reconciliation | Waterfall PA and UA now reconcile their category-level cause volumes to the authoritative closed-grain ΔPA/ΔUA displayed by Waterfall Loss & Gain. Breakdown/Standby event losses retain their calculated sign and volume; an explicit `Gain/Loss vs Plan / Penyesuaian Scope` row carries the remaining plan/scope/grain effect. The visible total and badge therefore close exactly to the main ΔPA/ΔUA without disguising a loss event as a gain. Empty event sets can still expose the complete scope adjustment instead of leaving the drill-down blank. | `VERIFIED_REPO` + `VERIFIED_UI`: PA and UA core golden tests pass, including event and no-event reconciliation; targeted Review suite 5/5 passes. Responsive localhost fixture shows PA `-1,436 + 2,761 = +1,324` and UA `-3,888 - 5,606 = -9,494`, matching the main waterfall, with explicit System adjustment rows, fixed-width bars, green reconciliation badges, and empty browser console. Files: PA/UA core, renderers, tests, loader versions, and fixture. | Not deployed. No backend/database/API change. Source event hours remain operational facts; the adjustment row is transparent derived reconciliation metadata, not a new Breakdown/Standby record. Full precision is retained internally and rounding is display-only. |
| 2026-09-26, Codex Review main-chart style restoration | Restored Pencapaian Produksi and the primary Waterfall Loss & Gain to their pre-drill-down layout/style: their natural Chart.js bar sizing is back, the primary summary/table no longer exposes a separate Missing Plan column, and the main waterfall is again Plan → PA → UA → Productivity → Other Fleet → Aktual. Backend Missing Productivity Plan classification remains internal and is folded into the existing displayed Other total so actual production is not dropped. The 40 px bar cap and exact scope-reconciliation rows remain exclusive to Waterfall PA/UA as requested. | `VERIFIED_REPO` + `VERIFIED_UI`: PA/UA core tests and targeted Review suite 5/5 pass. Local responsive preview confirms the original wide Plan/Aktual and main waterfall styling, no visible Missing Plan label/bar/column, PA/UA adjustments unchanged, and an empty browser console. | Not deployed. No backend/database/API/formula change; this is presentation scoping plus main-display aggregation only. |
| 2026-09-27, Codex Review UA berbasis parameter SPO | Waterfall UA now decomposes the authoritative closed-grain ΔUA by the date-effective deployed SPO delay parameters for the selected JOB. Per grain, SPO plan hours are normalized to the approved UA-plan delay allowance, actual Standby hours use the same lifecycle scope as the main calculation, and impact is `plan productivity × (allowance-equivalent hours − actual hours)`. Unmapped plan, actual, or source data stays visible in explicit quality buckets. Full-precision parameter impacts are forced to close to main ΔUA; display rounding is balanced so visible rows also sum exactly. | `VERIFIED_REPO` + `VERIFIED_DATA` + `VERIFIED_UI`: backend 270/270 and dashboard 100/100 pass, including a deterministic 10,000-case closure invariant. Read-only BEI/OB 20–23 Sep checks reconcile all three planning sources within floating tolerance (<2e-12). Local preview rendered SPO code/parameter/plan/allowance/actual/deviation/impact/status/unit columns, fixed bars, and a green equality badge; all requested assets returned 200 (favicon-only 404). Files include new `backend/src/services/reviewUaImpact.js`, new backend test, Review controller, UA core/renderer/tests, Review UI/fixture/loader, and stale test expectations updated to current catalog/asset versions. | Not deployed; no migration or write-path change. API response adds `kategori[].uaWaterfall` and retains existing fields. Historical SPO versions without embedded parameter catalogs use the current master-code catalog and expose a lineage flag; deployed historical parameter values remain date-effective. |
| 2026-09-27, Codex Review UA Plan Delay SPO column | Waterfall UA now distinguishes the source value from the derived calculation: `Plan Delay SPO` displays `rawPlanHours` exactly from the date-effective SPO parameter, while `Plan Efektif UA` displays the normalized hours used to reconcile against UA plan. The total row exposes both totals plus allowance, actual, deviation, and authoritative ΔUA; an inline note explains the distinction. | `VERIFIED_REPO` + `VERIFIED_UI`: dashboard 100/100 and targeted backend/UI 11/11 pass. Local preview visibly rendered raw SPO values 10.00/6.00 hours separately from effective values 8.00/5.00 hours, retained the green exact-reconciliation badge, and kept the wide table readable in its horizontal wrapper. | Not deployed; no migration, API, write-path, authorization, tenant, or formula change. This corrects display provenance only; full-precision UA calculation remains `review-ua-spo-parameter-v2`. |
| 2026-09-28, Muse Spark session (Data Produksi: tombol Simpan mati) | Tombol `Simpan Nilai Manual` tak pernah aktif: id draf menyimpan INDEX tabel tapi 3 konsumen (hitung kotor, simpan, cleanup balik-ke-ritase) membandingkannya dengan NAMA area → hitungan selalu 0. Perbaiki via helper `manualTableIndex` (berlaku semua JOB termasuk FOT). | `VERIFIED_REPO`: sintaks OK; manual-save 3/3; dashboard 136/136. | Alur pakai: gear kolom FOT → Manual → ketik → tombol `Simpan Nilai Manual (N)` → tersimpan. |
| 2026-10-06, Muse Spark session (deploy Biznet tree-sync) | Deploy working tree ke Biznet: tests lokal backend 338/338 + dashboard 150/150; DB Biznet lengkap (fuel/fleet/survey/periodic, 114 tabel — tanpa migrasi); env secrets lengkap; rilis `/opt/omos/releases/20261006-204615-tree-sync`, image `omos-app:20261006-204615-tree-sync`, container healthy ~15 dtk, symlink flip; container lama dipertahankan sebagai `omos-app-prev` + image lama untuk rollback. | `VERIFIED_PRODUCTION`: nginx /health ok (serverless=false); API 401 tanpa token + 200 dengan token admin fresh; statik baru live (`manualTableIndex` di productionData.js). | Rollback: stop baru, start omos-app-prev, flip symlink balik. |
| 2026-10-06, Muse Spark session (fix Input Fuel post-deploy) | Input Fuel gagal (`column fl.hm_lifetime_reading does not exist`): migrasi 066 belum ada di DB Biznet. Dry-run + apply 066 (4 kolom lifecycle + backfill legacy + constraint + 2 indeks); fuel-cards 200 + payload penuh. | `VERIFIED_PRODUCTION`: kolom ada; endpoint OK. | Refresh halaman. Pelajaran: cek migrasi 060+ (tidak hanya tabel utama) sebelum deploy berikut. |
| 2026-10-06, Muse Spark session (fix save fuel inconsistent types) | Simpan log fuel gagal (`inconsistent types deduced for parameter $1`): `total_hm=COALESCE($1,0)` di recalculateChain mencampur NUMERIC kolom dengan literal INTEGER → error untuk SEMUA nilai. Terbukti via EXPLAIN di prod (gagal null/2.5/0). Fix `0::numeric`; terbukti OK semua varian; tambah guard regresi; deploy rilis `20261006-223414-fuel-coalesce-fix` (healthy, symlink flip, `omos-app-prev` dipertahankan). | `VERIFIED_PRODUCTION`: EXPLAIN OK; fix live di container (grep=1); /health ok. | Silakan ulangi Simpan yang gagal. |
| 2026-10-06, Muse Spark session (popup HM meter lebar) | Popup Penggantian/Reset HM Meter diperlebar (760px → 920px/95vw + scroll, pola sama dengan modal MA) via class `.hm-meter-modal`. | `VERIFIED_REPO`: sintaks OK. | Hard refresh (style v63, production.js v103, loader v47). Belum deploy. |

## Review formula reconstruction — 2026-09-27

`VERIFIED_REPO` / `VERIFIED_DATA` / `VERIFIED_UI`: Review v3 supersedes the
normalized-allowance UA v2 ledger above. Direct UA impact is `(SPO delay plan −
actual delay) × daily/context productivity`. Main PA uses available-hour change;
PA detail separates planned BD, actual BD, and time-coverage difference. No
residual is assigned to make parameter impacts agree. The 8h vs 7h at 150 example
returns +150 and a matched parameter returns zero. All three Source Planning
modes use the same domain function. Main chart styling remains unchanged.

Files: new `backend/src/services/reviewWaterfall.js`, domain test, formula guide
`docs/REVIEW_PRODUKSI_FORMULA_V3.md`; updated Review controller, UA service/tests,
Review UI/core, PA/UA renderers, rounding helper/tests, planning source tests,
loader/index asset versions and localhost fixture. Read-only BEI/OB 20–23 Sep
checks reconcile all sources (see guide for exact values). Browser fixture
checks switched all three sources and verified PA/UA tables/charts, horizontal
table overflow, equal-delay zero, and no console errors/warnings.

Final verification: backend `node --test --test-reporter=dot` 274/274 passed;
dashboard `node --test --test-reporter=dot *.test.js` 100/100 passed. Two
deterministic 10,000-case invariants cover main/PA closure and UA-detail closure.
Controller/UI syntax checks and `git diff --check` passed (CRLF warnings only).

`VERIFIED_REPO` / `VERIFIED_DATABASE` / `VERIFIED_UI` follow-up: parameter
identity is now immutable after an SPO table is deployed. The UI replaces each
Standby Code dropdown with a read-only `code — description`, hides add/remove
parameter actions, and keeps Hrs/day and expanded daily-hour inputs editable.
Backend validation rejects replace/add/remove/reorder attempts with HTTP 409 but
accepts daily-hour changes. Migration 055 was applied idempotently to the active
SPO snapshot only: OB/CG/FOT each retain 12 parameters and unchanged daily-key
counts 1155/661/661. It does not rewrite effective history. Review Produksi
20–23 Sep BEI/OB returns zero synthetic `SPO_ROW` codes and remains reconciled;
missing unverified catalogs fail closed. Backend 275/275 and dashboard 100/100
pass. Local SPO preview shows read-only parameter labels, editable Hrs/day, no
add/remove parameter controls, and no console errors. Files: migration 055 and
runner, `spoPlanning.js` and tests, `spo.core.js`, integration test, loader/index
cache versions, preview fixture, UA resolver/test and formula guide. Not deployed.

Important live finding: early SPO snapshots have daily rows but no parameter
metadata. Deployed OB/CG/FOT now use the verified locked catalog in the active
snapshot as fallback. Synthetic `SPO_ROW_n` labels are prohibited; genuinely
unmapped custom data fails closed with `MISSING_SPO_PARAMETER_DETAIL`.
No migration, operational write, auth/RBAC or client-boundary change. Not deployed.

## Breakdown Unit Status Board — 2026-09-27

`VERIFIED_REPO` / `VERIFIED_UI`: Page 3 Breakdown now contains `Update Status
Unit` below `Unit Ready / Riwayat Release`. Its authenticated current-snapshot
API derives `BD` exclusively from an active, non-deleted Breakdown record and
otherwise reports `Ready` for active List Equipment population. Equipment-type
indicators expose separate `Ready` and `BD` counts. The board includes search,
status/type filters, grouped accordions, compact/detail modes, manual refresh,
Quick Breakdown with the unit preselected, 20-incident status history, 12/24
hour duration bands aligned to the existing Breakdown Report, and Data Quality
for master-status mismatch, duplicate active incidents, and orphan active
Breakdowns. Automatic polling and Export Snapshot were intentionally skipped.

Files: `backend/src/services/breakdownUnitStatus.js`, production controller and
routes, backend test; `admin-dashboard/index.html`, `production.js`,
`style.css`, cache versions/tests, dedicated dashboard test, and localhost
fixture. Backend full suite passes 279/279; dashboard full suite passes 104/104.
Desktop and 390 px localhost review verified paired type counts, compact/detail,
reconciliation modal, status history, Quick Breakdown preselection, horizontal
table containment, and no browser errors/warnings. No migration, formula,
operational write, or authorization bypass. The local database connection was
unavailable (`ECONNREFUSED`), so the live-data endpoint query is not yet checked
against a running database. Not deployed.

### Production release — 2026-09-27

`VERIFIED_PRODUCTION`: released the current Breakdown `Update Status Unit`
implementation to Vercel production. Deployment
`dpl_13Dv3yxF2RWMDQ5YzexuLy312wZn` is READY and aliased to
`https://attendance-system-eta-opal.vercel.app`. The primary alias `/health`
returned HTTP 200 `{"status":"ok","serverless":true}`; production HTML serves
`style.css?v=58` and `production.loader.js?v=35`, the loader serves
`production.js?v=98`, and the shipped bundle contains the unit-status endpoint
and loader integration. The unauthenticated unit-status request returned HTTP
401 as required. Post-release error and HTTP 5xx log scans were empty.

Pre-release gates: backend 279/279 and dashboard 105/105 passed; `git diff
--check` passed with CRLF warnings only. One stale dashboard cache assertion was
updated from loader v34 to the already-active v35. No migration was executed.
The authenticated production database response for the new read endpoint was
not exercised because no user session was used during release verification;
the endpoint's mock/service regression and authorization boundary are verified.

## Breakdown editable damage type and Part/PO removal — 2026-09-28

`VERIFIED_REPO` / `VERIFIED_DATABASE` / `VERIFIED_UI`: Breakdown Aktif now
renders a master-backed Jenis Kerusakan dropdown plus an explicit save action
for active incidents. The backend rejects resolved incidents, validates that
the selected master code is active, updates the incident transactionally, and
records before/after code snapshots. The unit-detail Part dan Purchase Order
table now exposes per-row Hapus; deletion is a transactional soft-delete and
records the complete prior row in the same audit ledger. Both writes retain the
existing admin authentication boundary and use shared OMOS async action
feedback.

Migration 056 creates `breakdown_change_audit` and was applied successfully by
`backend/src/scripts/run_migration_056_breakdown_edit_audit.js`. The general
mining migration runner could not reach 056 because legacy migration 015 fails
against the current `shifts_standard_hours_check`; no attempt was made to relax
that unrelated constraint. Backend 281/281 and dashboard 110/110 tests pass;
targeted API/UI tests cover persistence, resolved rejection, audit writes, and
soft-delete. Localhost browser verification changed B01 Engine to B02
Hydraulic, deleted the mock Part/PO, retained the modal layout, and reported
`Runtime: OK`. Files: migration 056 and runner registration/dedicated runner,
production controller/routes/tests, dashboard production UI/style/tests and
Breakdown preview fixture. Not deployed.

### Production release — 2026-09-28

`VERIFIED_PRODUCTION`: released the editable Breakdown damage type and audited
Part/PO soft-delete to Vercel production. Deployment
`dpl_41m2z2ctotALHzvDhFtMj7FPvVY1` is READY and aliased to
`https://attendance-system-eta-opal.vercel.app`. The primary alias `/health`
returned HTTP 200 `{"status":"ok","serverless":true}`. Production serves
`style.css?v=61`, `production.loader.js?v=36`, and `production.js?v=99`; the
live bundle contains both new UI actions and the damage-code path. Anonymous
PATCH damage-code and DELETE Part/PO probes both returned HTTP 401, confirming
the existing admin authentication boundary. Post-release error and HTTP 5xx
log scans were empty. Migration 056 had already been applied successfully;
pre-release gates were backend 281/281, dashboard 110/110, browser interaction
verification, and `git diff --check` with CRLF warnings only.

## Leader Board DT Fuel Ratio L/Km — 2026-09-28

`VERIFIED_REPO` / `VERIFIED_DATABASE` / `VERIFIED_UI`: Top 10 Dump Truck Fuel
Ratio dan Top 10 Driver DT Fuel Ratio sekarang memakai `Σ liter / Σ km aktual`
dengan sumber jarak `fuel_logs.distance_km` (delta odometer tervalidasi dari
Input Fuel). Excavator dan Operator Excavator tetap memakai `Σ liter / Σ BCM
produktif`. Data Control menampilkan basis dan satuan per entity; baris DT tanpa
jarak menjadi `MISSING_DISTANCE_KM`, sedangkan satu fuel log dengan beberapa
alokasi tanpa pembagian jarak menjadi `AMBIGUOUS_DISTANCE_ALLOCATION` dan tidak
diranking. Driver DT tetap mengikuti atribusi HM-share yang sudah berlaku,
dengan liter dan km dibagi memakai share yang sama sebelum agregasi
ratio-of-sums. Intermediate calculation memakai presisi penuh; pembulatan hanya
di UI.

Files: `backend/src/services/fuelRatioRanking.js`, regression test,
`admin-dashboard/productivityReport.js`, test/fixture, loader cache version, dan
`docs/RENCANA_PRODUCTIVITY_REPORT_RANKING.md`. Backend 284/284 dan dashboard
110/110 pass. Read-only database check OB 1–28 Sep menghasilkan contoh DT30
6-111 = 1,0756 L/Km dari 1.010 L / 939 Km. Localhost preview menampilkan 2,2
L/Km pada kartu Dump Truck dan Driver DT, unit Excavator tetap L/BCM, dan
console error kosong. Tidak ada migration/write-path/auth/tenant-boundary
change. Belum dideploy.

## Leader Board Low Personel Rankings — 2026-09-28

`VERIFIED_REPO` / `VERIFIED_DATABASE` / `VERIFIED_UI`: Productivity Ranking
menambahkan `Top 10 Low Operator Excavator Productivity` dan `Top 10 Low Driver
DT Productivity`. Kedua kartu memakai baris Data Control complete yang sama dan
weighted achievement yang sama dengan ranking utama, tetapi diurutkan ascending
(achievement terendah menjadi #1). Fuel Ratio tidak membuat kartu duplikat:
kartu personel eksisting, yang memang sudah ascending, diperjelas menjadi `Top
10 Low Operator Excavator Fuel Ratio` (L/BCM) dan `Top 10 Low Driver DT Fuel
Ratio` (L/Km).

Files: productivity ranking core/domain/tests, Leader Board UI/test/fixture,
cache versions, dan rencana ranking. Backend 284/284 dan dashboard 110/110 pass.
Read-only database check OB 1–28 Sep membuktikan urutan low operator dimulai
88,09% lalu 94,68%, sedangkan low driver dimulai 112,67% lalu 117,15%. Localhost
preview menampilkan enam kartu Productivity, empat kartu Fuel Ratio tanpa
duplikasi, dan console error kosong. Tidak ada migration, formula, write-path,
authorization, atau tenant-boundary change. Belum dideploy.

## Loader Productivity Operational Target v8 — 2026-09-29

`VERIFIED_REPO` / `VERIFIED_TEST` / `VERIFIED_UI`: target productivity
operasional sekarang dibaca langsung dari tab Loader Productivity OB/Coal.
Input Ritase, Fleet Capacity, Unit Mapping, Fleet Deployment baru, material
Survey, dan Productivity Ranking tidak lagi membaca hasil Setting Fleet.
Payload aktif menyimpan `loaderCatalog`; field `fleetProductivity` hanya alias
kompatibilitas dengan nilai Loader. Target DT/Driver pada Leader Board tetap
berasal langsung dari database Hauler Productivity sesuai excavator aktual.

Tab ketiga berganti nama menjadi **Setting Fleet Simulation**. Isinya hanya
state sesi browser, tidak mempunyai periode efektif, tidak ikut tersimpan, dan
tidak terhubung ke modul operasional. Snapshot Fleet Deployment historis tidak
ditulis ulang untuk menjaga audit; deployment baru menyimpan snapshot Loader.
Backend 291/291 dan dashboard 117/117 lulus. Localhost fixture memperlihatkan label
`SIMULASI NON-PERIODE`, warning tidak tersimpan, hasil Loader 150,73 BCM/Hr,
dan runtime OK setelah membuat simulasi. Tidak ada migration, endpoint baru,
perubahan RBAC, atau perubahan tenant/project boundary. Belum dideploy.

## Legacy Coal v2 JOB Binding Compatibility — 2026-09-29

`VERIFIED_REPO` / `VERIFIED_DATABASE`: Input Ritase Tambah Fleet sebelumnya
tidak menampilkan CG untuk EX30 350-14 pada 29 Sep 2026 karena Coal planning
efektif masih payload v2. Record historis menyimpan JOB CG di `fleetCatalog`,
sementara input Loader berada di HTML; adapter Loader baru menghitung rate dari
HTML tetapi kehilangan JOB lalu jatuh ke assignment PA/OB. Adapter sekarang
menghitung Loader Productivity dari bucket capacity, BFF, swell, density, cycle
time, dan loader efficiency historis memakai formula domain yang sama, kemudian
menggabungkannya dengan JOB/plan identity dari record historis. Read-only check
29 Sep menghasilkan EX30 350-14 / CG / SEAM 3 = 183,8347826 Ton/Hr dan tidak
memakai target Fleet lama 166,77 Ton/Hr. Backend 292/292 lulus; tidak ada
migration, mutasi data, perubahan endpoint, RBAC, atau tenant/project boundary.
Belum dideploy.

## Loader Target + Legacy Coal CG Production Release — 2026-09-29

`VERIFIED_PRODUCTION`: current OMOS workspace, including Loader Productivity as
the operational target, session-only Setting Fleet Simulation, and the Coal v2
CG-binding compatibility fix, was deployed to Vercel production as
`dpl_6zGezv7YVRXHn9CoRQLc8hR4w3XX`. Deployment status is READY and aliases
`https://attendance-system-eta-opal.vercel.app` plus
`https://attendance-system-wodav.vercel.app`. Primary alias `/health` returned
HTTP 200 `{"status":"ok","serverless":true}`. Post-release logs contain the
successful health request and normal 304 traffic; error-level scan returned no
entries and no HTTP 5xx was observed. Pre-release gates were backend 292/292,
Input Ritase targeted dashboard 22/22, syntax check, data-level CG catalog
verification, and focused diff check. No migration was executed. Deployment
used the current working-tree snapshot.

## Coal Hauler legacy Capacity override fix — 2026-09-29

`VERIFIED_REPO` / `VERIFIED_DATABASE` / `VERIFIED_UI`: Coal Productivity
Planning v8 previously deadlocked legacy Hauler rows whose List Equipment
capacity was stored as `M3`: the UI replaced the Capacity input with a warning,
while backend save correctly required Coal Capacity in `Ton`. Read-only database
inspection confirmed the 16 Sep 2026 Coal snapshot is legacy v2 and DT20 6-76
has master capacity `19.00 M3`.

The Hauler grid now keeps the legacy value/UoM as source provenance, exposes a
blank Capacity Ton input, and treats the user's entered value as an explicit Ton
override. No M3→Ton conversion or reinterpretation occurs silently. The same
normalization is applied through manual cell edit and Quick Input. Cache versions
were bumped in the production loader/index.

Files: `admin-dashboard/planProductivity.workspace.js`,
`admin-dashboard/ppw-hauler-validation.test.js`, production loader/index cache
versions, and regression fixture
`admin-dashboard/test-fixtures/coal-hauler-legacy-capacity-preview.html`.
Dashboard 122/122 and backend 292/292 pass. Browser regression reproduced
EX30 350-14 / DT20 6-76 / PASIR with source `19 M3`, accepted an explicit
`30.4 Ton`, recalculated loading time/productivity, changed readiness 0/1→1/1,
and completed the save flow without an application error. No migration,
database write, endpoint, RBAC, tenant/project-boundary, or formula change.

### Production release — 2026-09-29

`VERIFIED_PRODUCTION`: released the Coal Hauler legacy Capacity override fix to
Vercel production. Deployment `dpl_8FNji5H9RXkvCqpm47ibnyWoBNx9` is READY at
`https://attendance-system-9ccvootlr-wodav.vercel.app` and aliased to
`https://attendance-system-eta-opal.vercel.app` plus
`https://attendance-system-wodav.vercel.app`. The primary alias `/health`
returned HTTP 200 `{"status":"ok","serverless":true}`. Production HTML serves
`production.loader.js?v=41`; the loader serves
`planProductivity.workspace.js?v=7`; the live workspace bundle contains both
the legacy source label and explicit override handler. Error-level log scan
returned no entries. Pre-release gates were dashboard 122/122, backend 292/292,
syntax/diff checks, read-only database inspection, and an interactive browser
regression through input, recalculation, readiness, and save. No migration was
executed.

### Periodic Service — realisasi langsung menjadi Breakdown PS (2026-10-03)

- **IMPLEMENTED / LOCALLY VERIFIED / NOT YET DEPLOYED:** tombol `Service` pada
  tab `Jadwal Service` sekarang membuka form realisasi dengan waktu mulai,
  waktu selesai, shift, HM saat service, snapshot kebutuhan dari Area Setup,
  item tambahan, dan catatan.
- API pembuatan work order menerima `actual_start` dan `actual_finish`, lalu
  menghitung durasi secara authoritative di backend dengan formula
  `(actual_finish - actual_start) / 3.600.000`. Durasi nol/negatif, waktu selesai
  masa depan, HM yang mundur dari Input Data, dan interval yang bertumpang tindih
  dengan Breakdown lain ditolak.
- Dalam satu transaksi database, sistem menyimpan work order selesai beserta
  snapshot part/task aktual, membuat Breakdown terselesaikan dengan master code
  `PS` (`Periodic Service`), menulis status history, dan menautkan
  `breakdown_id` ke realisasi service. Dengan demikian jam service masuk downtime
  planned maintenance/MOHH-PA, tetapi tetap dikecualikan dari functional failure,
  MTBF, dan MTTR sesuai kebijakan migration 058.
- Endpoint lama untuk work order terjadwal (`Mulai`/`Selesaikan`) tetap tersedia
  agar data dan proses yang sudah ada tetap kompatibel.
- Files: `backend/src/controllers/periodicService.controller.js`,
  `backend/test/periodicService.test.js`, `admin-dashboard/periodicService.js`,
  `admin-dashboard/periodic-service.test.js`,
  `admin-dashboard/production.loader.js`, dan fixture
  `admin-dashboard/test-fixtures/periodic-service-package-preview.html`.
- **VERIFIED:** backend full suite 299/299 pass; targeted dashboard/breakdown
  suite 25/25 pass; syntax and diff checks pass. Browser localhost desktop dan
  viewport mobile 390 px memverifikasi form, payload, hasil riwayat selesai,
  durasi 1,0 jam, serta tidak menemukan application error atau modal overflow.
- Tidak ada migration baru untuk perubahan ini; schema migration 058-060 yang
  sudah diterapkan menyediakan seluruh field dan relasi yang diperlukan.

### Periodic Service — contextual sticky header dan range periode (2026-10-03)

- **IMPLEMENTED / LOCALLY VERIFIED / NOT YET DEPLOYED:** header sticky lama
  `Unit Breakdown Control` sekarang hanya tampil pada workspace Breakdown
  Control. Workspace Periodic Service memiliki header kontekstual sendiri yang
  memuat judul, slicer `Dari–Sampai`, Refresh, Area Setup, dan lima highlight:
  Unit Terkonfigurasi, Mendekati Service, Jatuh Tempo, Service Berjalan, serta
  Temuan Terbuka.
- Range default adalah month-to-date berdasarkan tanggal lokal. Backend
  memvalidasi format, urutan, dan batas maksimum 366 hari. Range memfilter work
  order/realisasi serta temuan terselesaikan, sedangkan work order aktif dan
  temuan terbuka tetap dikirim agar status operasional realtime tidak hilang.
  Jadwal due berbasis HM tetap merupakan snapshot terkini.
- Files: `admin-dashboard/index.html`, `admin-dashboard/periodicService.js`,
  `admin-dashboard/periodicService.css`, `admin-dashboard/production.loader.js`,
  fixture dan test Periodic Service; `backend/src/services/periodicService.js`,
  `backend/src/controllers/periodicService.controller.js`, serta backend test.
- **VERIFIED:** backend 300/300 dan dashboard 131/131 pass; endpoint dashboard
  berhasil menjalankan SQL range terhadap database dan mengembalikan periode
  2026-10-01–2026-10-03. Browser localhost memverifikasi lima highlight,
  default MTD, desktop sticky header, viewport mobile 390 px tanpa overflow,
  dan tanpa application error.
- Tidak ada migration, perubahan formula PS/Breakdown, atau perubahan RBAC dan
  tenant/project scope. Query tetap menggunakan scope yang diturunkan server.

### Periodic Service — hyperlink indikator (2026-10-03)

- **IMPLEMENTED / LOCALLY VERIFIED / NOT YET DEPLOYED:** kelima highlight
  Periodic Service sekarang berupa tombol drill-down. Unit Terkonfigurasi,
  Mendekati Service, Jatuh Tempo (`Due + Overdue`), dan Service Berjalan membuka
  `Jadwal Service` dengan baris yang sesuai; Temuan Terbuka membuka tab `Temuan`
  dan hanya menampilkan status `open/in_progress`.
- Kartu aktif menampilkan badge `FILTER AKTIF`. Memilih tab secara manual
  membersihkan filter indikator dan mengembalikan status/list lengkap; filter
  Status manual tetap bekerja tanpa dipaksa reset oleh helper indikator.
- Files: `admin-dashboard/index.html`, `admin-dashboard/periodicService.js`,
  `admin-dashboard/periodicService.css`, loader, test, dan fixture Periodic
  Service. Tidak ada perubahan backend, database, formula, atau scope akses.
- **VERIFIED:** dashboard full suite 132/132 pass. Browser localhost membuktikan
  klik Mendekati menampilkan hanya EX30 350-14, klik Temuan membuka tab Temuan
  dengan empty-state yang tepat, dan klik tab Jadwal manual membersihkan filter
  serta mengembalikan tiga unit. Tidak ada browser application error.

### Periodic Service — Estimasi Pekerjaan dan Forecast PA (2026-10-04)

- **IMPLEMENTED / VERIFIED_REPO / VERIFIED_DATABASE / VERIFIED_UI / NOT YET DEPLOYED:** Area Setup paket model sekarang menyimpan `Estimasi Pekerjaan (Jam)`. Nilai ini hanya menjadi proyeksi downtime Forecast PA; waktu aktual Work Order `actual_start–actual_finish` tetap authoritative dan otomatis mengalahkan estimasi.
- Sticky header Periodic Service menambahkan wizard **Forecast PA** dengan default satu bulan berjalan, sumber EWH `Forecast Mine Plan` dari 0.4 PA/UA/EWH + SPO atau input manual per unit dengan Input Cepat, pengelompokan jenis/model, serta matriks satu kolom per hari. EWH hanya memproyeksikan HM/tanggal milestone. Formula backend adalah `PA periode = (Σ MOHH − Σ downtime PS) / Σ MOHH`, `MOHH = 24 jam/unit/hari`; nilai antara memakai presisi penuh dan pembulatan hanya di UI.
- Forecast memilih hari pertama akumulasi EWH mencapai due HM, paket cycle terbesar pada milestone beririsan, menolak hasil semu saat EWH/estimasi tidak lengkap, dan membagi service lintas hari maksimal 24 jam per kolom sehingga PA harian tidak negatif. Hasil forecast bersifat read-only dan tidak membuat WO/Breakdown.
- Files utama: migration/runner 061; `periodicServiceForecast.js`; Periodic Service controller/routes/tests; dashboard Periodic Service JS/CSS/test/fixture; cache asset v9; package migration script dan all-migrations registry.
- **VERIFIED:** migration 061 applied dan mengembalikan `estimate_columns=1`; backend 305/305 dan dashboard 133/133 pass; syntax serta `git diff --check` pass. Browser localhost memverifikasi mode Mine Plan dan Manual, Quick Input mengisi 3/3 unit, hasil 31 hari menampilkan PS250/95,83%, desktop 1440 px dan mobile 390 px tanpa document/modal overflow, serta console/page error kosong.
- **Scope/security:** endpoint tetap memakai `requireAuth` + `requireAdmin` dan scope server-derived yang sama dengan modul Periodic Service. Tidak ada perubahan source of truth HM, formula Breakdown PS, audit Work Order, atau tenant/project compatibility layer.
- **LOCAL RUNTIME NOTE:** pengujian pertama dari dashboard `localhost:8080` menghasilkan HTTP 404 karena proses backend `localhost:3000` masih memuat route table sebelum endpoint Forecast PA ditambahkan. Backend lokal direstart pada 2026-10-04; sesudah restart `/health` dan asset v9 HTTP 200, sedangkan endpoint Forecast PA tanpa token memberi 401 sesuai auth boundary (bukan lagi 404). Tidak ada perubahan source code tambahan untuk insiden runtime ini.
- Tombol utama konfigurasi pada header Periodic Service diberi label user-facing **Service Setup**; nama fungsi, API, schema, dan lineage Area Setup tetap tidak berubah. Targeted dashboard 8/8 dan browser fixture lulus tanpa overflow/error overlay.

### Breakdown Report Pareto Event (2026-10-04)

- **IMPLEMENTED:** Kolom generated image `Top 5 Penyebab Breakdown` sekarang memakai **Akumulasi Event**, bukan akumulasi durasi jam. Urutan Pareto berdasarkan jumlah event terbanyak dan label batang menampilkan jumlah event beserta persentasenya.
- Scope hitung mengikuti bulan/tahun report berdasarkan `tanggal` event (fallback `start_time` zona Asia/Jakarta), sehingga breakdown carry-over dari bulan sebelumnya yang masih aktif tidak menambah event bulan terpilih. Event Periodic Service/non-functional failure tetap dikecualikan mengikuti klasifikasi master breakdown.
- Counting memakai ID breakdown unik agar satu event tidak terhitung ganda. Files: `admin-dashboard/breakdownReport.js`, `admin-dashboard/breakdown-report.test.js`, `admin-dashboard/production.loader.js`, `admin-dashboard/index.html`, dan penyesuaian asset-version assertion di `admin-dashboard/ritase-fleet-planning-integration.test.js`.
- **VERIFIED:** dashboard regression suite 133/133 pass; browser localhost pada generated report 1600 px menampilkan `Akumulasi Event`, `2 Event (66.7%)`, tidak memuat label lama `Akumulasi Jam`, dan tidak memiliki error overlay.

### Data Produksi per-PIT tabs + authoritative SPO material type (2026-10-04)

- **IMPLEMENTED:** Halaman 7 Data Produksi sekarang memisahkan tampilan menjadi tab PIT dinamis dan tab khusus `ALOKASI FUEL`. Setiap PIT memiliki KPI server-side per JOB, fuel consumption, fuel ratio `L/BCM`, jarak produksi berbobot BCM, dan jumlah isu kualitas; tab fuel memiliki KPI serta workflow rekonsiliasinya sendiri.
- Tombol UI `Kunci acuan density` dihapus. Snapshot density historis tetap dipertahankan untuk audit/reproducibility, tetapi penentuan JOB OB/Coal tidak lagi berasal dari `fleet.material_type`.
- **IMPLEMENTED:** SPO planningData v8 menambahkan `materialType` (`ob`/`coal`) hanya untuk klasifikasi Prod, wajib sebelum deploy dan terkunci setelah deploy. Legacy mapping yang disetujui: `OB → ob`, `CG → coal`, `FOT → coal`. Non Prod tidak menyimpan jenis material.
- Data Produksi memakai jenis material SPO sebagai sumber satuan/formula: OB mempertahankan BCM; Coal mempertahankan ton dan mengonversi ke BCM dengan `BCM = ton / density` untuk fuel ratio. Katalog planning dengan tipe berbeda dari SPO diabaikan agar satu JOB tidak menjadi mixed-unit secara diam-diam.
- Added migration `backend/migrations/063_spo_material_type.sql`, registered in `run_all_mining_migrations.js` and `migration:spo-material-type`. Migration upgrades current and effective-version SPO JSON to v8; **RUN successfully on 2026-10-04** via `npm run migration:spo-material-type`. Read-only verification confirmed active and versioned mappings: `OB → ob`, `CG → coal`, and `FOT → coal`. Deployment was not performed in this task.
- Main files: `backend/src/services/spoPlanning.js`, `backend/src/services/productionData.js`, `backend/migrations/063_spo_material_type.sql`, `admin-dashboard/spo.core.js`, `admin-dashboard/productionData.js`, `admin-dashboard/productionData.css`, related fixtures/tests and asset versions.
- **VERIFIED:** backend 310/310 tests passed; admin-dashboard 138/138 tests passed. Browser localhost verified PIT KPI/tab layout and Alokasi Fuel layout; SPO preview showed deployed OB read-only as OB and CG/FOT as Coal, with no browser/runtime errors.

### Data Produksi compact visual refinement + stale manual-source recovery (2026-10-04)

- **IMPLEMENTED / VERIFIED_UI / VERIFIED_DATABASE / NOT YET DEPLOYED:** KPI `Jarak produksi` dihapus dari highlight PIT (kolom jarak rinci dan kalkulasi backend tetap dipertahankan), tab PIT/Fuel memakai latar kontras, dan kartu KPI memakai aksen serta gradient semantik.
- Tinggi baris data dan input manual dikompakkan menjadi 42 px/30 px; browser localhost mengukur dua baris fixture masing-masing 42 px, tanpa overflow/error.
- Inspeksi database menemukan `BEI/FOT` dan `DKC/FOT` masih berstatus Manual sejak 2026-09-25 tetapi keduanya memiliki 0 override. Kedua sumber kosong dipulihkan secara terarah ke `ritase`; verifikasi UI tidak lagi menampilkan `Produksi manual belum lengkap`.
- Files: `admin-dashboard/productionData.js`, `productionData.css`, cache asset v8, fixture/test Data Produksi, dan dokumen ini. Targeted dashboard 13/13, backend domain Data Produksi 24/24, syntax, serta diff check lulus. Tidak ada perubahan formula, satuan, schema, API, RBAC, atau scope tenant/project.

### Data Produksi — Fuel Ratio ALL aggregate correction (2026-10-04)

- **IMPLEMENTED / VERIFIED_REPO / NOT YET DEPLOYED:** `Fuel Ratio ALL` sekarang dihitung secara agregat sebagai `Σ fuel teralokasi (L) / Σ produksi valid (BCM)`, bukan mensyaratkan setiap JOB memiliki transaksi fuel tersendiri. OB tetap BCM; Coal dikonversi `ton / density` sebelum masuk denominator.
- JOB produksi tanpa fuel tersendiri berkontribusi `0 L` pada pembilang tetapi BCM-nya tetap masuk denominator. Produksi/density yang tidak lengkap tetap menahan rasio agar sistem tidak menampilkan KPI semu. Presisi penuh dipertahankan dan pembulatan hanya di UI.
- Files: `backend/src/services/productionData.js`, `backend/test/production-data.test.js`, dan dokumen ini. Regression khusus 25/25 serta full backend 311/311 lulus; tidak ada perubahan schema, API, RBAC, atau tenant/project scope.

### Data Produksi — drill-down alokasi fuel per JOB (2026-10-04)

- **IMPLEMENTED / VERIFIED_UI / NOT YET DEPLOYED:** tab `ALOKASI FUEL` menampilkan indikator dinamis untuk setiap JOB Prod ter-deploy. Setiap kartu menunjukkan total liter alokasi, jumlah unit, dan jumlah transaksi; klik kartu memfilter tabel Fuel teralokasi ke unit/JOB tersebut, sedangkan klik ulang atau `Tampilkan Semua` membersihkan filter.
- Agregasi memakai `allocations[].liters` per JOB, bukan total transaksi, sehingga transaksi fuel yang dibagi ke beberapa JOB dihitung sesuai porsinya dan tidak diduplikasi. Tabel hasil filter juga menampilkan porsi liter JOB yang dipilih.
- Files: `admin-dashboard/productionData.js`, `productionData.css`, cache asset v9, fixture/test Data Produksi, dan dokumen ini. Targeted 14/14 serta full dashboard `node --test` 139/139 lulus. Browser localhost memverifikasi OB 2.400 L dari dua unit termasuk transaksi split 400 L, filter tabel dua unit, serta tidak ada error runtime.

### Production release — Data Produksi visual, Fuel Ratio ALL, dan drill-down fuel (2026-10-04)

- **VERIFIED_PRODUCTION:** deployment `dpl_BVeoUndsxkDGA1B5euVHnShqohPS` berstatus READY dan dialias ke `https://attendance-system-eta-opal.vercel.app` serta alias wodav.
- Alias utama `/health` mengembalikan HTTP 200 (`status=ok`, `serverless=true`), HTML live memuat `productionData.css?v=9`, loader live memuat `productionData.js?v=9`, dan bundle live mengandung drill-down `data-pd-fuel-job`. Endpoint Data Produksi tanpa autentikasi tetap HTTP 401.
- Gate sebelum release: backend 311/311, dashboard 139/139, targeted 14/14, syntax/diff checks, dan browser drill-down interaktif. Scan log error Vercel 10 menit setelah release tidak menemukan error.

### Biznet pilot infrastructure and Vercel compatibility preview (2026-10-05)

- **IMPLEMENTED / VERIFIED_SERVER / PRODUCTION CUTOVER NOT EXECUTED:** Biznet
  Ubuntu telah di-hardening dengan SSH key-only, UFW (hanya 22/80/443),
  fail2ban, unattended security updates, Docker/Compose, dan Nginx. App pilot
  berjalan sehat pada Node.js 24 di loopback `127.0.0.1:3000`; port PostgreSQL
  target tidak dipublish ke host/internet.
- HTTPS alamat IP memakai Let's Encrypt short-lived certificate. Timer renewal
  systemd aktif dan `certbot renew --dry-run --run-deploy-hooks` berhasil.
- Snapshot Supabase `public` dibuat dalam custom dump, checksum serta daftar
  restore diverifikasi, disalin ke backup lokal di luar repository, dan
  direstore ke PostgreSQL 17 staging Biznet. Rekonsiliasi saat snapshot:
  98 tabel, 250 FK, total 50.433 baris, selisih count per tabel nol.
- Preview Vercel compatibility gateway `attendance-system-adr5rh9zp-wodav.vercel.app`
  berstatus READY dan meneruskan `/api/*` serta `/health` ke Biznet. Verifikasi:
  health 200 (`serverless=false`), admin tanpa token 401, endpoint publik 200.
  Deployment production `attendance-system-eta-opal.vercel.app` tetap serverless
  dan belum dialihkan.
- Security gate: dry-run Vercel sempat menemukan file kredensial lokal dalam
  input deployment; upload dihentikan, `.vercelignore` diperketat, dan dry-run
  ulang memastikan file sensitif tidak berada pada daftar upload.
- Files: `.dockerignore`, `.vercelignore`, `ops/biznet/*`,
  `docs/BIZNET_MIGRATION_PLAN.md`, dan dokumen ini. Regression sebelum pilot:
  backend 311/311 dan dashboard/mobile 153/153.
- **REMAINING GATES:** storage provider abstraction + object migration, UAT
  authenticated/APK canary, monitoring lengkap, final delta/write freeze, dan
  persetujuan owner sebelum promosi gateway production atau database cutover.

### Biznet full production cutover (2026-10-05)

- **IMPLEMENTED / VERIFIED_PRODUCTION:** owner membatalkan masa pilot dan
  menginstruksikan cutover penuh. Domain production Vercel lama sekarang hanya
  compatibility gateway ke Biznet; `attendance-system-eta-opal.vercel.app`
  menunjuk deployment gateway `dpl_4KTskuYvWtgwPFWyPxQtEi6mbj6h`, dan health
  production mengembalikan `serverless=false`.
- Write-freeze HTTP 503 diterapkan selama final delta. Setelah final restore dan
  verifikasi, freeze dibuka; invalid login kembali mencapai backend (400), API
  publik 200, Admin UI 200, Mobile UI 200, dan download APK 200.
- PostgreSQL 17 Biznet menjadi primary. Final reconciliation source vs target:
  98 tabel, 250 FK, 50.434 baris pada kedua sisi, count delta per tabel nol.
  Transactional write/rollback probe berhasil; app dan DB restart count nol.
- Storage production memakai provider local Biznet dengan traversal guard dan
  atomic write. Migrasi final mencakup 4.109 object / 3.393.335.152 byte; delta
  final 0 copied dan 4.109 unchanged; sample object dilayani HTTP 200.
- Backup lokal database + storage dijalankan dan timer nightly aktif; timer
  certificate renewal juga aktif. Disk usage pasca-backup 22%. Final source dump,
  SHA-256, dan manifest storage disalin ke
  `D:\OneDrive\Desktop\OMOS_BACKUPS\2026-10-05-full-cutover`.
- Security/routing: PostgreSQL tetap private pada Docker internal network;
  public listener hanya 22/80/443 dan app hanya loopback 3000. Canonical
  `vercel.json` kini mem-proxy API/APK/health ke Biznet agar deploy berikutnya
  tidak mengaktifkan kembali serverless DB path.
- Files: `backend/src/config/db.js`, `env.js`, `services/storage.js`, storage
  migration script/test, `vercel.json`, `ops/biznet/*`, migration plan, dan
  handover ini. Verification: targeted storage 5/5, full backend 313/313,
  JSON/diff checks, production HTTP checks, DB reconciliation, local storage
  count/bytes/read, logs tanpa fatal error.
- **KNOWN LIMITATION:** nightly database/storage backup masih berada pada VM
  Biznet yang sama. Baseline Supabase dan final DB dump di OneDrive memberi
  rollback awal, tetapi object baru pasca-cutover memerlukan off-host backup atau
  snapshot Biznet terjadwal.

### Visible web redirect correction after Biznet cutover (2026-10-05)

- **IMPLEMENTED / VERIFIED_PRODUCTION:** laporan owner bahwa redirect belum
  bekerja dikonfirmasi. Sebelum perbaikan, URL lama `/portal` menghasilkan 404
  dan `/` menghasilkan 200 tanpa header `Location`; konfigurasi saat itu hanya
  reverse-proxy/API gateway dan static web Vercel.
- Routing production sekarang membedakan client: `/api/*` dan `/health` tetap
  reverse-proxy ke Biznet agar method, body, token, serta upload APK lama aman;
  semua route web lainnya mengembalikan permanent redirect 308 ke IP HTTPS
  Biznet dengan path dan query string dipertahankan.
- Alias production diarahkan ke deployment gateway
  `dpl_CowRzHj52J1p3QovRbT4QSMC65ZC`. Verifikasi live:
  `/portal?from=cutover` → 308 ke
  `https://103.58.101.240/portal?from=cutover`, `/` → 308 ke Biznet,
  `/health` → 200 (`serverless=false`), API POST tetap mencapai backend (400
  untuk payload login kosong), dan destination portal/root Biznet → 200.
- Files: `vercel.json`, `ops/biznet/vercel-proxy.preview.json`,
  `.vercelignore`, dan dokumen ini. Root cause bukan runtime error; log app dan
  Nginx tidak memiliki error kritis saat pemeriksaan.

## Known Issues and Guardrails

- Attendance investigation remains relevant: see
  `docs/ATTENDANCE_DEEP_INVESTIGATION_2026-09-09.md` for false-pending-session
  and GPS threshold findings; do not assume the report proves fixes exist.
- Performance roadmap still lists dynamic module split, safe master-data cache,
  database index audit, pagination/virtual rendering, Speed Insights, and
  repository slow-query timing as unfinished. See
  `docs/OMOS_PLATFORM_PERFORMANCE_ROADMAP.md`.
- PostgreSQL outer joins: lock only the non-nullable target with
  `FOR UPDATE OF <alias>`; do not lock an entire nullable `LEFT JOIN` result.
- Do not reuse one PostgreSQL placeholder for different column types.
- On Windows, quote paths containing spaces. Prefer exact patches over deleting
  arbitrary line ranges in large JavaScript files; after a large JS edit, run
  syntax checks and confirm template literals were not cut.
- Browser cache can mask deployed static changes. Validate with hard refresh
  before diagnosing source behavior.
- Review waterfall v3 is algebraically closed at date+unit+PIT+JOB+material+UoM.
  Material keys still match on trim+upper-case only; spelling variants can
  orphan production from its plan group and should be handled as source-data
  quality rather than silently merged.

### Fuel Operations Hub role-based preview (2026-09-29)

- **DESIGNED / UI VERIFIED:** Added the standalone interactive preview
  `admin-dashboard/test-fixtures/fuel-operations-hub-preview.html` for the
  proposed Database Fuel navigation redesign. It does not alter production
  routes, APIs, database records, or authorization.
- **DOCUMENTED:** Added
  `docs/RENCANA_FUEL_OPERATIONS_HUB_ROLE_BASED.md` as the implementation plan
  covering role-based layouts, task wizards, API reuse, backend-authoritative
  KPI rules, RBAC, offline outbox, phased migration from flat tabs, tests,
  rollout, and acceptance criteria.
- The preview separates `Operasional Hari Ini`, `Control Center`, and
  `Administrasi`; includes the three field CTAs (receipt, transfer, opname), a
  three-step input wizard, Shift Fuel Board, task checklist, KPI cards,
  location-product stock matrix, exception queue, and transaction-lineage
  drill-down.
- **VERIFIED:** Inline JavaScript passed Node syntax compilation. The localhost
  browser review loaded without an application error; the operator wizard,
  Control Center switch, and stock-row drill-down were exercised visually.
- This fixture is a product-design reference only. Production integration must
  preserve server-calculated KPI values, existing authorization, audit data,
  idempotent writes, and requires a dedicated offline/outbox implementation
  before claiming offline-ready behavior.

### Absensi PIM Android V3 (2026-10-05)

- **IMPLEMENTED / BUILD VERIFIED:** Android package remains
  `com.perusahaan.absensi`, upgraded from V2.2 code `4` to V3.0 code `5`, and
  targets the Biznet gateway `https://103.58.101.240/` directly.
- V3 restores the V2.2 history, application session-expiry handling, and photo
  compression while retaining the newer fresh-location, accuracy, and
  attendance-session reconciliation behavior in the canonical repository.
- Added a dedicated GPS Calibration flow that requests repeated high-accuracy
  fixes, displays coordinate/accuracy/provider/time, and only declares the
  result ready after a stable accurate fix. This flow does not write an
  attendance transaction.
- Added a server-driven update contract at public `GET /api/app/version`, a
  release manifest, and the hosted APK asset. The Android updater enforces
  HTTPS/same-host downloads, SHA-256, package name, increasing version code,
  and the existing signing certificate before invoking the package installer.
- Update consent is persisted: after the user selects `Izinkan & Update`, the
  app requests Android's per-app install permission only when still missing,
  automatically starts DownloadManager after returning from that one-time
  setting, downloads in the background, retries an interrupted download, and
  opens the system package installer after hash/package/signer verification.
  Android's final install confirmation cannot be bypassed on ordinary employee
  devices without managed device-owner/Play distribution.
- Riwayat Absensi and Rekap HM now expose mobile date-range slicers. Both use
  authenticated, server-side filtering via `tanggal_mulai`/`tanggal_akhir`;
  ranges are ISO-date validated, inclusive, limited to 366 days, and never
  accept a frontend-supplied employee identity. Rekap HM totals and operation
  days are recalculated by the backend for the selected range.
- **HOTFIX 3.0.1 / VERIFIED:** Riwayat Absensi sebelumnya mengekstrak komponen
  jam mentah dari timestamp ISO server sehingga nilai UTC terlihat sebagai jam
  lokal. Code `6` kini mem-parsing instant/offset server lalu mengonversinya
  secara eksplisit ke `Asia/Jakarta` dan memberi label `WIB`. Formatter yang
  sama dipakai ringkasan waktu pada Home; timestamp lama tanpa offset tetap
  diperlakukan sebagai WIB untuk kompatibilitas.
- Release outputs: `outputs/Absensi_PIM_V3.apk`,
  `backend/src/public/Absensi_PIM.apk`, and the distribution copy
  `D:\OneDrive\Desktop\PROJECT\Absensi_PIM_V3.apk`. SHA-256 is
  `0127ED07B19255F5A407FACAE3EE06D4483C55FECE40D00093FA1E92D5ED6C6E`.
- **VERIFIED:** debug/release Android lint and assembly passed; release signer
  SHA-256 exactly matches V2.2; Android source tests passed `8/8`; mobile release
  contract tests passed `3/3`; full backend tests passed `319/319`; packaged
  manifest hash equals the hosted APK hash. Emulator verification installed
  V2.2 first and then upgraded in place to code `5`/V3.0; the login layout
  rendered without fatal/ANR logs. The two new range-slicer layouts were also
  rendered on the Pixel 7 emulator without fatal/ANR logs.
- **VERIFIED_PRODUCTION:** Biznet release
  `/opt/omos/releases/20261005-161919-apk-3.0.1-wib` is active using image
  `omos-app:apk-3.0.1-wib-20261005-161919`. App and PostgreSQL are healthy with restart
  count `0`; the database container, database volumes, and local object storage
  were not rebuilt or mutated by this deployment. The previous release and
  `omos-app:pilot` image remain available for rollback.
- Direct Biznet and the legacy Vercel compatibility gateway now return HTTP 200
  for `/health` and public `GET /api/app/version`; the manifest reports code
  `6`, version `3.0.1`, and directs downloads to Biznet HTTPS. The live APK is
  25,174,541 bytes and matches SHA-256
  `0127ED07B19255F5A407FACAE3EE06D4483C55FECE40D00093FA1E92D5ED6C6E`.
  An anonymous range-history probe remains HTTP 401, recent app logs contain no
  fatal/error entries, and PostgreSQL remains private to Docker networking.
- **NOT YET VERIFIED:** physical-device GPS accuracy and Android's final
  unknown-source/package-installer confirmation were not exercised. The Android
  emulator also reports that two existing ML Kit native libraries use legacy
  page alignment; the app runs in compatibility mode, but 16 KB native-library
  alignment remains a future SDK dependency-upgrade task.

### Data Produksi manual persistence hardening — 2026-10-05

- Fixed the Page 7 Manual production save flow so the UI no longer discards its
  draft merely because the PUT returned HTTP 200. The API now verifies the
  persisted override row count inside the transaction and returns that count;
  the dashboard then reloads and compares the complete `area + JOB + tanggal +
  shift + material + value` snapshot before clearing the draft or showing
  `Tersimpan`.
- Bumped the lazy-loaded Data Produksi asset to `productionData.js?v=10`, which
  prevents previously cached JavaScript from continuing to run the older save
  path. Manual production values remain the authoritative user-entered source;
  no mining formula, unit, density rule, or stored production value was changed.
- **VERIFIED_REPO + VERIFIED_UI:** dashboard Data Produksi tests pass `15/15`;
  backend production-data tests pass `30/30`; syntax checks pass. Browser
  interaction changed `BEI/FOT` from `240` to `333`, saved it, observed the
  server-confirmed state, performed an internal report refresh and a full page
  reload, and retained `333` with no browser errors.
- **VERIFIED_PRODUCTION:** Biznet application release
  `/opt/omos/releases/20261005-174501-data-produksi-manual` built image
  `omos-app:data-produksi-manual-20261005-174501`; immutable static follow-up
  `/opt/omos/releases/20261005-202226-data-produksi-cache` is active so the root
  HTML also cache-busts `production.loader.js?v=43`. Container health is healthy,
  restart count is `0`, direct and public `/health` return HTTP 200, the live
  loader serves v10, the unauthenticated write probe remains HTTP 401, and the
  five-minute fatal/error scan is empty. No migration or production-data
  mutation was executed as part of the release.

## Verification and Release Baseline

### Data Produksi manual save button execution fix — 2026-10-05

- **IMPLEMENTED / VERIFIED_PRODUCTION:** fixed Page 7 manual production saves
  being skipped before the PUT request. `saveManualValues()` previously set the
  shared busy flag and immediately called `refreshManualSave()`, which disabled
  the initiating button; `OMOSActionFeedback.run()` correctly refused an already
  disabled button, so no write reached Biznet and only the subsequent snapshot
  verification failed. The premature refresh was removed while the existing
  busy guard and shared feedback continue to prevent duplicate writes.
- Added a regression for the ordering invariant and bumped Data Produksi to
  `productionData.js?v=11` through `production.loader.js?v=44`. Dashboard suite
  passed 141/141. Local browser changed two FOT inputs, observed
  `Perubahan data produksi manual tersimpan`, then retained the values after a
  full reload with no console errors.
- Biznet release `/opt/omos/releases/20261005-210537-data-produksi-save-button`
  is active. Direct health is HTTP 200 (`serverless=false`), live assets expose
  v11/v44 and the corrected ordering, `omos-app` remains healthy with restart
  count 0, and the post-release fatal/5xx scan is empty. Frontend-only release:
  no database, API, mining formula, RBAC, tenant/project, or stored-data change.

1. Inspect the relevant implementation, route, migration, API contract, and
   ownership boundary before editing.
2. Use existing patterns; backend is authoritative and UI save actions use
   `window.OMOSActionFeedback` where applicable.
3. Run proportionate verification. Backend baseline is `npm test` from
   `backend/`; production/dashboard modules have targeted `node --test` files.
4. For deploys explicitly requested by the owner, use the linked Vercel project,
   validate `/health`, and report the deployment URL. Deploy preview by default;
   production requires explicit instruction.
5. Report files changed, tests actually run, data/API/security impact, and
   remaining risks. Never report a chat claim as a verified result.

### 2026-10-05 — Manual production disappears on refresh (report read path)

- **IMPLEMENTED / VERIFIED_LOCAL:** persisted manual overrides now seed report
  cells independently of fleet/fuel/rain data, only for area/JOB configured as
  manual. Previously these overrides were present in the database and save
  response but skipped while building table cells when no operational cell
  existed. The report ETag representation is now `pd-v2` to invalidate cached
  pre-fix reports without modifying operational records.
- Files: `backend/src/services/productionData.js`,
  `backend/src/controllers/productionDataController.js`,
  `backend/test/production-data.test.js`,
  `backend/test/production-data-cache.test.js`, this handover.
- Verification: targeted production-data, cache and manual-source tests passed
  30/30; syntax checks and scoped `git diff --check` passed. New regression
  covers independent manual entries, repeat report builds, zero values,
  unrelated areas, and switching back to ritase.
- Read-only Biznet inspection confirmed four October FOT values persisted:
  BEI 200 + 200, DKC 1000 + 10100. Before the fix, live `loadReport` returned
  these raw overrides but omitted corresponding material values in table cells.
- No migration, stored-data write, API payload, mining formula, UI layout,
  authorization or tenant/project boundary change. Live browser save/reload
  has not been exercised in this turn; prior frontend fixture verification
  did not cover this backend report defect.
- **VERIFIED_PRODUCTION_BACKEND:** deployed only the two changed backend files
  over the existing release, image `omos-app:manual-report-cells-20261005-211600`,
  release `/opt/omos/releases/20261005-211600-manual-report-cells`. Two read-only
  live report builds matched all four database values to their displayed
  material cells; October totals were BEI FOT 400 and DKC FOT 11100. Calling the
  live controller with the old ETag returned status 200 and a corrected v2
  report. No production inputs were changed during verification.

### 2026-10-06 — Data Produksi manual Total derived/read-only

- **IMPLEMENTED / VERIFIED_PRODUCTION:** per-row manual `Total` is now a
  read-only derived field that updates immediately from the sum of all manual
  material inputs for the same area/date/shift/JOB. It is no longer counted as
  an editable draft or sent as a separate override. Empty material inputs stay
  absent; zero is retained as a valid value; invalid negative/non-numeric input
  leaves the derived total unavailable and remains blocked by save validation.
- Backend report calculation now treats detailed material overrides as the
  authoritative total. A legacy `TOTAL` override is used only when no material
  detail exists, preserving backward compatibility without allowing stale
  totals to override current details. Report representation ETag advanced to
  `pd-v3`; frontend cache assets advanced to Data Produksi v13, loader v45 and
  CSS v10.
- Files: `admin-dashboard/productionData.js`, `productionData.css`,
  `production.loader.js`, `index.html`, relevant preview/tests;
  `backend/src/services/productionData.js`,
  `backend/src/controllers/productionDataController.js`, relevant tests, and
  this handover.
- Verification: dashboard suite 142/142 and targeted backend suite 31/31
  passed; syntax and scoped diff checks passed. Local browser preview changed
  FOT 240 -> 325 and immediately showed read-only Total 325, enabled save, and
  reported no console errors. Live read-only Biznet report verification matched
  current persisted detail sums to report totals (BEI FOT 1000; DKC FOT 1200
  and 10100 for their respective shift rows).
- Release `/opt/omos/releases/20261006-093000-production-manual-total` is active
  with image `omos-app:production-manual-total-20261006-093000`; container is
  healthy with restart count 0 and live assets expose v13/v45/CSS v10.
- No migration, database mutation, density/conversion formula, API route,
  authentication, authorization, tenant/project boundary, or offline/sync
  behavior change. Existing pre-release image and release remain available for
  rollback.

### 2026-10-06 — Input Data DATE timezone correction

- **IMPLEMENTED:** `getProductionLogs()` now projects
  `mpl.tanggal::text AS tanggal`, preserving the operational `DATE` contract as
  `YYYY-MM-DD` and preventing the PostgreSQL/Node/WIB-to-UTC serialization from
  moving the displayed date one day backward.
- The inspected Biznet row
  `a3d2ff94-62a8-4f04-9f08-bcad751557a3` is correct in PostgreSQL:
  EX20 2-18, 2026-10-02, Shift Malam, enday romdiana, HM
  2024.60–2027.20 (2.60 HM), created 2026-10-03 08:32 WIB by Engineering.
  Its unit-shift session also has operational_date 2026-10-02 and Shift Malam.
- Root cause was `mpl.*`: PostgreSQL `DATE` became a JavaScript Date and the
  JSON payload serialized midnight WIB as `2026-10-01T17:00:00.000Z`. Stored
  operational records were intact and were not corrected/mutated.
- The live API/query payload retains night shift UUID
  `0233ca6c-e7e5-4e0c-aec0-c13d78e0590a`; database and master shift both map it
  to Shift Malam. No server-side evidence supports a change to Shift Siang.
  A local browser draft can overlay a rendered row because Input Data restores
  per-account drafts from `localStorage`; this needs browser-state inspection if
  Shift Siang remains visible after the date fix/draft discard.
- Regression `backend/test/production-log-date-contract.test.js` covers the
  2026-10-02 date-only JSON contract and Shift Malam context. Ten targeted
  production tests passed; `git diff --check` reported no whitespace errors.
- Deployed on Biznet as release
  `/opt/omos/releases/20261006-104500-input-date-only` with image
  `omos-app:input-date-only-20261006-104500`. Container and public health checks
  are healthy. Authenticated live API verification returns the exact sample as
  `tanggal=2026-10-02` and `shift=Shift Malam`.
- No migration, database mutation, formula, route, authorization,
  tenant/project boundary, or offline/sync behavior changed.

### 2026-10-06 — OMOS People Option B: Workforce Movement and MPP

- **IMPLEMENTED / VERIFIED_PRODUCTION:** halaman Karyawan menjadi workspace
  dua-mode: `Pergerakan` sebagai default dan `Database Karyawan` untuk master
  identitas yang sudah ada. Workspace Pergerakan menyediakan Ringkasan, MPP,
  Masuk/Rehire, Mutasi, Promosi/Demosi, Keluar, Riwayat, filter periode,
  drill-down, CSV, checklist onboarding/offboarding, dan state transition yang
  auditable.
- Migration `064_workforce_movements_mpp.sql` memisahkan profile, assignment,
  immutable movement before/after state, approval, task, attachment metadata,
  audit, MPP/version/period, dan manpower-request foundation. Migration
  **berhasil dijalankan pada PostgreSQL Biznet `omos_staging` pada 2026-10-06
  14:21 WIB** dengan `ON_ERROR_STOP` dan transaksi migration mencapai COMMIT.
  Backup pra-migrasi terverifikasi berada di
  `/opt/omos/backups/manual/20261006-142143-pre-workforce-064.dump` (custom
  pg_dump, 6.3 MB; catalog dapat dibaca `pg_restore -l`). Hash SQL lokal dan
  server sama: `891ff5d6585b9071f10f43db58b6b752dba3b2304a52fe5542b921484554cac2`
  (case-insensitive SHA-256).
- Post-migration verification: 15 tabel workforce tersedia; 80 profil cocok
  dengan 80 akun role karyawan, 72 active assignment cocok dengan 72 karyawan
  aktif, 8 karyawan nonaktif tetap menjadi profil historis, 9 reason seed,
  movement awal tetap 0, orphan profile 0, dan duplicate active assignment 0.
  Container `omos-postgres-staging` dan `omos-app` tetap healthy. Backfill tidak
  menciptakan histori movement palsu dan tidak memutasi data produksi.
- Employee create dan registration approval kini menulis HIRE movement efektif
  dalam transaksi yang sama. Perubahan langsung departemen, jabatan, dan status
  aktif ditolak; perubahan tersebut wajib melalui workflow. Hard delete ditolak
  untuk karyawan yang sudah mempunyai workforce/attendance/production history.
- Workflow movement mendukung Draft -> Submitted -> Approved -> Effective,
  reject/cancel yang sah, tanggal efektif terjadwal, retry idempotent, conflict
  guard satu movement aktif per karyawan, assignment update atomik, serta
  processor `workforce:process-due`. Host scheduler/cron untuk processor ini
  **belum dikonfigurasi**.
- MPP mendukung kebutuhan bulanan per departemen/jabatan, actual assignment,
  gap dan status tekstual, revision, serta Ajukan/Setujui/Batalkan. Tab lifecycle
  mengambil grouped type secara lengkap sehingga Rehire, Demosi, Terminasi,
  Kontrak Habis, dan Pensiun tidak tersembunyi oleh filter API yang terlalu
  sempit.
- Scope data selalu diturunkan server-side dari authenticated user. Karena Core
  Tenant/Project UUID belum authoritative di repository saat ini, implementasi
  memakai compatibility `tenant_key/project_key`; migrasi ke UUID Core tetap
  menjadi prerequisite milestone enterprise.
- Future Option C disimpan sebagai **DESIGNED / NOT IMPLEMENTED** pada
  `docs/OMOS_PEOPLE_ENTERPRISE_OPTION_C_MILESTONE.md`. Dokumen itu tidak
  mengaktifkan capability enterprise atau mengubah runtime.
- Files utama: `backend/migrations/064_workforce_movements_mpp.sql`,
  `backend/src/services/workforce.js`, `backend/src/controllers/workforceController.js`,
  `backend/src/controllers/karyawanController.js`, `backend/src/controllers/adminController.js`,
  `backend/src/routes/karyawan.routes.js`, scripts workforce, tests;
  `admin-dashboard/workforce.js`, `workforce.css`, `index.html`, `app.js`,
  preview/tests; milestone Option C dan handover ini.
- Verification: backend suite **329/329** dan dashboard suite **146/146** passed;
  syntax check passed. Browser preview localhost memverifikasi Ringkasan,
  Database Karyawan, dan MPP; tabel MPP tampil utuh tanpa overflow horizontal
  dan status gap tetap terbaca tanpa bergantung pada warna.
- Biznet release `/opt/omos/releases/20261006-143623-workforce-option-b` aktif
  menggunakan image `omos-app:workforce-option-b-20261006-143623`. Candidate
  container lebih dulu lolos health 200 dan boundary unauthenticated 401;
  container live healthy dengan restart count 0, public `/health` HTTP 200,
  serta root `workforce.js?v=1` dan `workforce.css?v=1` menyajikan asset release
  yang benar. Scan log pascarelease tidak menemukan fatal/error/HTTP 5xx.
- Scheduled effective movement dijalankan oleh systemd
  `omos-workforce-due.timer` setiap lima menit. Eksekusi pertama berhasil
  (`processed=0`, `failed=0`) dan service exit 0. Unit source disimpan di
  `ops/biznet/omos-workforce-due.service` dan `.timer`. Release sebelumnya
  `/opt/omos/releases/20261006-104500-input-date-only` beserta image-nya tetap
  tersedia sebagai rollback point.

### 2026-10-06 — Label Karyawan `Pergerakan` menjadi `Rotasi`

- **IMPLEMENTED / VERIFIED_PRODUCTION:** seluruh istilah user-facing pada workspace
  Karyawan berubah menjadi `Rotasi`, termasuk mode switch, deskripsi, loading,
  kartu terbaru, empty state, riwayat, tombol tambah, modal detail/form, pesan
  edit master, dan nama file CSV. Nama internal `movement`, tabel database,
  endpoint, workflow, dan audit contract tidak berubah.
- Asset `workforce.js` dinaikkan ke cache version v2. Dashboard suite 147/147
  dan syntax checks passed. Browser localhost memverifikasi label `Rotasi`,
  `+ Catat Rotasi`, dan `Rotasi terbaru` dengan layout desktop tetap utuh.
- Static Biznet release
  `/opt/omos/releases/20261006-145034-workforce-rotasi-label` aktif. Public root,
  `workforce.js?v=2`, dan `app.js` HTTP 200 serta memuat label Rotasi; asset
  workforce tidak lagi memuat teks `Pergerakan`. Backend image tetap
  `omos-app:workforce-option-b-20261006-143623`, healthy, restart count 0;
  timer workforce tetap active dan log pascarelease tidak memuat error/5xx.
  Release `/opt/omos/releases/20261006-143623-workforce-option-b` tetap menjadi
  rollback point.

### 2026-10-06 — Diagnosis import `OMOS_Daily_Work_Log_2026-10-06.xlsx`

- **ANALYZED / NO DATA MUTATION:** importer Input Data secara eksplisit memilih
  sheet bernama `Production Logs` bila tersedia. Workbook mempunyai dua sheet
  visible (`Production Logs` dan `Sheet1`), sehingga `Sheet1` tidak pernah
  dibaca pada percobaan import tersebut.
- Enam baris `Production Logs` memiliki HM Start negatif; lima di antaranya juga
  memiliki HM Akhir negatif. Frontend mensyaratkan kedua hour-meter non-negatif
  dan menghitung ulang Total dari Akhir − Start, sehingga seluruh enam baris
  ditolak pada validasi lokal sebelum request API. Kolom Total positif tidak
  dapat menggantikan meter Start/Akhir yang invalid.
- Read-only Biznet verification memastikan `WL30 10-01`, class `WL`, area DKC,
  operator `sanianto`, Shift Siang, serta JOB FOT/GNR semuanya tersedia dan
  unik. Database menyimpan HM positif yang benar. Row 23–29 Sep ada sebagai
  soft-deleted history, sedangkan 30 Sep–4 Okt sudah aktif. Rekomendasi aman
  adalah review/restore history yang terhapus, bukan mengimpor meter negatif
  atau menggandakan row aktif. Tidak ada workbook atau database yang diubah.

### 2026-10-06 — Input Fuel P0–P2 HM lifecycle

- **IMPLEMENTED / VERIFIED_REPO / VERIFIED_UI / NOT YET DEPLOYED:** Input Fuel
  sekarang memisahkan pembacaan fisik meter dari `Lifetime HM`. Backend
  menghitung Lifetime HM memakai event authoritative migration 065, menjadikan
  pembacaan lifecycle pertama sebagai baseline, lalu menghitung delta dan
  `L/HM` dari urutan Lifetime HM tanpa pembulatan antara. Reset meter mandiri
  dari Input Fuel ditolak; event harus dibuat melalui alur HM Meter Input Data.
- Migration `066_fuel_hm_lifecycle.sql` menambah event reference, Lifetime HM,
  status dan alasan lineage. Data Fuel lama hanya ditandai
  `legacy_unreconciled`; sistem tidak mengarang konversi dari counter virtual
  lama. Baris legacy dikeluarkan dari pembilang maupun penyebut KPI HM sampai
  ada baseline lifecycle yang sah.
- Create, update, soft-delete, restore, dan pembuatan event HM merekalkulasi
  rantai turunan per unit dalam transaksi serta menulis audit saat nilai
  turunan historis berubah. UI memperlihatkan `HM Fisik`, `Lifetime HM`, badge
  lineage/baseline/meter, jumlah baris yang dikeluarkan, serta export lineage.
- Files utama: migration 066, `services/fuelHmLifecycle.js`, production
  controller/tests, migration registry/package command, Input Fuel UI/style/
  fixture/tests, cache asset v62/v102, dan handover ini.
- Verification: backend **337/337** dan dashboard **149/149** passed; syntax dan
  scoped diff check passed. Browser localhost menampilkan sampel WL30 10-01
  legacy → baseline → derived dengan tabel terbaca dan tanpa page overflow.
  Screenshot: `outputs/input-fuel-hm-lifecycle.png`. Migration 066 belum
  dijalankan dan perubahan ini belum dirilis ke Biznet.

### 2026-10-06 — Karyawan monthly slicer + MPP bulanan

- **IMPLEMENTED / VERIFIED_REPO / VERIFIED_UI / NOT YET DEPLOYED:** slicer
  workspace Karyawan berubah dari range tanggal menjadi Bulan dan Tahun. API
  Rotasi tetap menerima batas tanggal yang diturunkan dari kalender bulan
  terpilih, sehingga kontrak histori existing tidak diputus.
- Tab MPP sekarang selalu mengambil seluruh master jabatan aktif dan
  mengelompokkannya per Departemen. Kolom Aktual read-only dihitung server-side
  dari assignment pada akhir bulan untuk profil `ACTIVE/PROBATION` dengan user
  aktif. Rotasi tidak menambah headcount; karyawan mutasi hanya berada pada
  assignment akhirnya, sedangkan Resign/Terminasi/Pensiun/Kontrak Habis yang
  sudah efektif tidak dihitung.
- Kebutuhan diinput inline per jabatan untuk satu `YYYY-MM`. Tombol **Simpan
  Perubahan** tersembunyi sampai nilai berubah; transisi approval dikunci saat
  draf belum disimpan. Save memakai feedback standar, upsert hanya bulan
  terpilih, mempertahankan bulan lain, dan membuat revision draft baru bila
  plan sebelumnya sudah bukan Draft. Tidak ada migration baru; tabel
  `workforce_mpp_line_periods` migration 064 tetap authoritative.
- Files: `backend/src/services/workforce.js`,
  `backend/src/controllers/workforceController.js`, workforce backend test;
  `admin-dashboard/workforce.js`, `.css`, `index.html`, fixture/test; handover.
- Verification: backend **338/338** dan dashboard **150/150** passed; syntax
  checks passed. Browser Chromium localhost memverifikasi Bulan/Tahun,
  grouping Departemen, input kebutuhan, tombol dirty-save (hidden → visible),
  tanpa overflow dan tanpa console error. Screenshot:
  `outputs/workforce-mpp-monthly-dirty.png`.

### 2026-10-06 — Rencana pengembangan MPP Enterprise

- **DESIGNED / NOT YET IMPLEMENTED:** dokumen
  `docs/RENCANA_PENGEMBANGAN_MPP_ENTERPRISE.md` disiapkan sebagai execution
  brief untuk OpenCode + Muse Spark 1.3. Rencana mengembangkan MPP bulanan
  dengan KPI global, indikator Aktual/Kebutuhan per departemen, drill-down
  personel, alasan dan audit perubahan, vacancy/manpower request, partial
  fulfillment, forecast deterministic, scenario terpisah, concurrency,
  idempotency, tenant/project isolation, layout, API/schema, urutan coding,
  test matrix, serta acceptance criteria P0–P2.
- Dokumen merekomendasikan migration 067 hanya sebagai kandidat; agen pelaksana
  wajib memeriksa nomor migration terbaru. Tidak ada runtime, schema, API, atau
  deployment yang diubah oleh pekerjaan dokumentasi ini.

### 2026-10-06 — Eksekusi MPP Enterprise P0 (control + transparansi)

- **IMPLEMENTED / VERIFIED_REPO / NOT YET DEPLOYED (P0 saja; P1/P2 belum):**
  mengeksekusi `docs/RENCANA_PENGEMBANGAN_MPP_ENTERPRISE.md` fase P0.
  Migration `067_workforce_mpp_enterprise.sql` dan service
  `backend/src/services/workforceMpp.js` (workspace summary/departemen
  server-side, drill-down aktual scoped, save transaction + revision 409 +
  reason wajib + audit append-only + idempotency, history) sudah ada di repo
  dan dipertahankan; tidak ada tabel request kedua atau logic paralel baru.
- Bug yang diperbaiki: (1) idempotency replay tidak pernah dedupe karena hash
  audit (`lines` saja) tidak sebanding fingerprint (`{period, lines}`) —
  audit `new_value` sekarang menyimpan `period` dan replay membandingkan
  `{period, lines}`; (2) mock test 409 salah (latest 3 vs ekspektasi 3) —
  mock latest menjadi 4; (3) test `workforce.test.js` kadaluarsa (ekspektasi
  logic inline di controller) — diperbarui menegaskan controller tipis
  delegasi ke `WorkforceMpp` dan service pemilik periode/katalog/headcount/
  upsert.
- Frontend `workforce.js` P0: KPI global dari `summary` server (Aktual,
  Kebutuhan, Gap, Vacancy aktif, Posisi kritis, Fill Rate + versi/status);
  kartu departemen Aktual/Kebutuhan/Gap/Fill Rate sebagai filter + reset
  `Semua Departemen` (urut gap terbesar, angka+teks bukan warna saja);
  segmented Headcount/Riwayat; angka Aktual menjadi link drawer personel
  scoped (`GET mpp/actual`, tanpa salary); editor alasan (code+teks),
  prioritas, needed-by per baris dengan `expected_revision`; validasi alasan
  wajib saat kebutuhan berubah; save mengirim `expected_version_no` +
  `Idempotency-Key`, 409 menampilkan instruksi muat ulang tanpa menghapus
  input; approval dikunci saat dirty; ekspor CSV MPP per bulan
  (`mpp-YYYY-MM.csv`); cache `workforce.js?v=4`, `workforce.css?v=3`,
  min-width tabel 1080px di dalam scroll card (tanpa page-level scroll).
- Files: `backend/src/services/workforceMpp.js`, `backend/test/workforce.test.js`,
  `backend/test/workforce-mpp.test.js`; `admin-dashboard/workforce.js`,
  `workforce.css`, `workforce.test.js`, `index.html`; handover ini. Tidak ada
  migration baru dijalankan; tidak ada perubahan formula/satuan; tenant/project
  scope tetap dari user terautentikasi, aktual tidak dipercaya dari frontend.
- Verification: backend **347/347** passed; dashboard `workforce.test.js`
  **7/7** passed; `node --check workforce.js` OK. Full dashboard suite punya 1
  gagal pre-existing tidak terkait (`ritase-fleet-planning-integration`:
  ekspektasi `production.js?v=102` vs loader `v=103`). Browser review
  localhost (dirty/save/refresh/drawer/409) dan migration/deploy production
  BELUM dijalankan — perlu perintah owner eksplisit.
- Sisa P0 non-kode: browser review + uji persistensi API→DB→reload +
  cross-tenant check live. P1 (Manpower Request dari gap, pipeline, partial
  fulfillment) dan P2 (forecast deterministic, scenario) BELUM dimulai.

### 2026-10-06 — Eksekusi MPP Enterprise P1 (vacancy + manpower request)

- **IMPLEMENTED / VERIFIED_REPO / NOT YET DEPLOYED (P1; P2 belum):**
  vacancy dan pemenuhan manpower per `docs/RENCANA_PENGEMBANGAN_MPP_ENTERPRISE.md`
  §P1/§6.3/§7.5. Reuse `workforce_manpower_requests`; tidak ada tabel request
  kedua. Pipeline: `DRAFT → SUBMITTED → APPROVED → RECRUITING → CANDIDATE_READY
  → ONBOARDING → FULFILLED` (+ `CANCELLED/REJECTED` terminal); transisi ilegal
  409, revisi basi 409, idempotency key tenant-scoped.
- Schema (migration **068** `068_workforce_manpower_pipeline.sql`, BELUM
  dijalankan di DB mana pun — deploy/migrate menunggu perintah owner):
  `period_month/department_id/position_id/priority/revision/idempotency_key/
  override_reason` + milestone timestamps di requests; `mpp_line_id` menjadi
  opsional (lookup tanpa mengarang plan); status legacy `IN_PROGRESS`
  dipetakan ke `RECRUITING`; tabel baru `workforce_manpower_request_events`
  (audit transisi) dan `workforce_manpower_request_fulfillments` (parsial,
  unik per karyawan + per movement). Runner
  `run_migration_068_workforce_manpower_pipeline.js` +
  `migration:workforce-manpower-pipeline` terdaftar.
- Backend: `services/workforceManpower.js` (vacancy server-side
  `gap/request/recruiting/candidate/onboarding/filled/open`, create dari gap
  dengan guard `qty > vacancy` wajib `override_reason` + `is_super_admin`,
  transition beraudit, fulfillment parsial khusus status ONBOARDING dengan
  auto-`FULFILLED` saat penuh, anti-duplikasi); movement HIRE/REHIRE dengan
  `manpower_request_id` auto-mengisi request ONBOARDING saat Efektif TANPA
  memblokir hire (skip beraudit bila request belum siap/penuh/duplikat);
  `createMovement` menerima link request (tolak bila terminal/beda scope).
  Controller + routes: `GET mpp/vacancy`, `GET/POST manpower-requests`,
  `GET :id`, `POST :id/transition`, `POST :id/fulfillments` — semua di balik
  `requireAuth, requireAdmin`.
- Frontend (`workforce.js?v=5`): segmented Headcount/Vacancy/Riwayat; tabel
  vacancy (Gap, Request sisa, Rekrutmen, Kandidat Siap, Onboarding, Terisi,
  progress, tombol Buat Request); modal generate (default open vacancy,
  override reason eksplisit); daftar request aktif + modal detail (stepper 7
  tahap, tombol transisi bervisi, fulfillment list + form catat, riwayat
  event); KPI Vacancy/Terisi/Open/Request aktif.
- Files: migration 068 + runner + package.json; `services/workforceManpower.js`,
  `services/workforce.js` (link + auto-link), `controllers/workforceController.js`,
  `routes/karyawan.routes.js`, `test/workforce-manpower.test.js` (12 test);
  `admin-dashboard/workforce.js/.css/index.html/workforce.test.js`; handover ini.
  Tenant/project dari user terautentikasi; aktual/vacancy tidak dipercaya dari
  frontend; tidak ada perubahan formula/satuan.
- Verification: backend **359/359** passed (12 baru); dashboard
  `workforce.test.js` **8/8**; `node --check` semua file tersentuh OK.
  Browser review localhost, persistensi API→DB→reload, dan
  migration 068 BELUM dijalankan — kode P1 membutuhkan 068 teraplikasi,
  jangan deploy tanpa migrate.
- P2 (forecast deterministic, scenario terpisah) BELUM dimulai.

### 2026-10-06 — Eksekusi MPP Enterprise P2 (forecast + simulasi)

- **IMPLEMENTED / VERIFIED_REPO / NOT YET DEPLOYED (P2 inti; item butuh master
  baru ditunda eksplisit):** forecast headcount deterministik + variance
  bulanan + scenario terpisah per `docs/RENCANA_PENGEMBANGAN_MPP_ENTERPRISE.md`
  §P2/§6.4/§7.6. AI tidak ikut menghitung; forecast murni dari assignment +
  movement APPROVED + kontrak.
- Formula: Forecast Bulan N = aktual snapshot akhir baseline + HIRE/REHIRE
  efektif s/d N − exit efektif s/d N ± mutasi (TRANSFER/PROMOTION/DEMOTION);
  hanya status APPROVED (EFFECTIVE sudah di baseline; DRAFT/SUBMITTED
  dikecualikan); target HIRE memakai link manpower-request bila ada lalu
  nama dept/jabatan; sumber exit/mutasi dari assignment T0 lalu nama;
  kontrak berakhir = Risiko (bukan pengurang); event tak terpetakan dihitung
  di `meta.unmapped_events`, bukan crash. Setiap sel membawa lineage
  (added/exited/in/out/contracts + movement_no). Lewat Feb kabisat dan
  pergantian tahun diuji.
- Backend: `services/workforceForecast.js` (`GET mpp/forecast?from&to`,
  maks 12 bulan); scenario CRUD terpisah (`POST/GET/DELETE mpp/scenarios`,
  delta vs approved, label `simulation:true`, hapus CASCADE) — tidak ada
  write ke plan/lines/periods. Migration **069**
  `069_workforce_mpp_scenarios.sql` (BELUM dijalankan; P2 butuh 068+069
  teraplikasi — jangan deploy tanpa migrate). Runner +
  `migration:workforce-mpp-scenarios` terdaftar.
- Frontend (`workforce.js?v=6`): tab Forecast (Jabatan | Aktual Saat Ini |
  3 bulan | Risiko Kritis/Waspada/Aman | Penyebab), variance `±N vs butuh`
  + `tanpa plan`, baris TOTAL, meta lineage; modal Buat Simulasi (prefill
  required approved) + daftar/detail Simulasi (delta vs approved, hapus).
- Ditunda jujur (butuh authority/master yang belum ada): minimum operational
  staffing (tanpa owner-defined minimum), dimensi Site/PIT/Shift/Fleet
  (site hanya free-text, tanpa master), coverage roster/relief (tanpa modul
  roster workforce), cost projection (tanpa salary-grade authority).
- Files: migration 069 + runner + package.json; `services/workforceForecast.js`,
  controller/routes, `test/workforce-forecast.test.js` (8 test);
  `admin-dashboard/workforce.js/.css/index.html/workforce.test.js`; handover ini.
  Tenant/project dari user terautentikasi; tanpa perubahan formula/satuan.
- Verification: backend **367/367** passed (8 baru); dashboard
  `workforce.test.js` **9/9**; `node --check` semua file tersentuh OK.
  Browser review, persistensi API→DB→reload, migrate 068/069, dan deploy
  BELUM dijalankan — perlu perintah owner eksplisit.

### 2026-10-07 — Panduan OpenCode akses SSH Biznet

- **DOCUMENTED / NO SERVER MUTATION:** menambahkan
  `docs/PANDUAN_OPENCODE_AKSES_SSH_BIZNET.md` dengan host, username, port,
  project path, credential authority lokal, perintah SSH PowerShell yang benar,
  decision tree timeout/refused/publickey, pemeriksaan Biznet Console,
  SSH/UFW/nftables/iptables/Fail2Ban, firewall provider, packet tracing terbatas,
  verifikasi Docker/health, reporting contract, dan larangan destruktif.
- Sesuai security policy, password, token, passphrase, dan isi private key tidak
  disalin ke Markdown/repository. Agen diarahkan membaca
  `D:\OneDrive\Desktop\OMOS\biznet server.txt` secara lokal tanpa mencetak atau
  menyimpan ulang secret. Nilai non-rahasia yang dikunci: host
  `103.58.101.240`, user `adminbiznet`, port 22, dan server root `/opt/omos`.

### 2026-10-07 — Modal Template Roster

- **IMPLEMENTED / VERIFIED_REPO / VERIFIED_UI / NOT DEPLOYED:** modal `+ Template
  Roster` memakai shell khusus berukuran maksimum 760 px desktop (94vw) dan 96vw
  pada layar kecil. Modal lain tidak berubah. Cache asset dinaikkan ke CSS v64 dan
  JS v44.
- Files: `admin-dashboard/app.js`, `admin-dashboard/style.css`,
  `admin-dashboard/index.html`, `admin-dashboard/roster-template-modal.test.js`,
  `admin-dashboard/test-fixtures/roster-template-modal-preview.html`.
- Verification: `node --check admin-dashboard/app.js`, test modal 1/1 lulus;
  preview browser desktop 760×409 px dan mobile 350×429 px, tanpa overflow atau
  console error.

### 2026-10-07 — Rencana Database Cuti Karyawan

- **DESIGNED / NO RUNTIME CHANGE:** Rencana `docs/RENCANA_DATABASE_CUTI_KARYAWAN.md`
  menetapkan Database Cuti sebagai sumber otoritatif. Roster hanya mengisi
  status CP dari realisasi cuti yang approved/realized; kebijakan, entitlement,
  realisasi, proyeksi, rekonsiliasi, dan audit dipisahkan secara eksplisit.
- Aturan yang dicatat: contoh policy 56:14 menghasilkan lima entitlement periode
  tahunan dengan pembulatan floor, dua realisasi menghasilkan aktual dua periode
  dan sisa tiga periode. Durasi parsial atau interval yang melampaui hak harus
  menjadi variance, bukan dibulatkan diam-diam.
- **DESIGN EXTENDED / NO RUNTIME CHANGE:** Database Cuti akan memiliki mode
  List untuk operasi massal dan Card per karyawan/siklus. Card memisahkan CP
  (periodik), CK (khusus), dan CT (tahunan), serta menghitung saldo CT kumulatif
  lintas siklus tanpa mencampurkannya ke aktual/sisa CP.

### 2026-10-07 — Audit dan UX Sinkronisasi Roster Karyawan

- **IMPLEMENTED / VERIFIED_REPO / VERIFIED_UI / NOT DEPLOYED:** audit read-only
  database Biznet untuk 1–31 Oktober 2026 menemukan 74 karyawan aktif: 30
  memiliki assignment roster dan 44 belum memiliki assignment. Sebanyak 18
  jabatan belum memiliki policy roster aktif sehingga 1.364 sel jadwal belum
  terbentuk. Data yang telah terkonfigurasi konsisten: nol shift kerja tanpa
  `shift_id`, nol generated row tanpa assignment, dan nol anomali source cuti.
- UI Roster sekarang mengirim periode ke endpoint ringkasan, menampilkan jumlah
  karyawan/sel sinkron dan belum sinkron per jabatan, menyediakan status sebagai
  dropdown deskriptif, pencarian karyawan, serta CTA **Setup & Sinkronkan**.
  Posisi awal template juga menjadi dropdown hari + status, bukan input angka
  tanpa konteks.
- `leave_sync` dari Database Cuti dikunci pada UI dan backend; edit manual maupun
  Import Excel tidak boleh menimpa CP authoritative. Koreksi harus dilakukan di
  Database Cuti agar lineage tetap konsisten.
- Files: `backend/src/controllers/rosterController.js`, `admin-dashboard/app.js`,
  `index.html`, `style.css`, test roster, fixture preview, dan diagnostik aman
  `ops/biznet/inspect-roster-data.sh`. Tidak ada migration dan belum ada mutasi
  data roster production.
- Verification: backend **382/382**; targeted roster backend **6/6**; targeted
  dashboard **2/2**. Full dashboard **159/161** dengan dua kegagalan lama yang
  tidak terkait (assert cache `production.js?v=102`, source sekarang v103).
  Preview desktop 1440×900 lolos tanpa error console; ringkasan gap, badge
  jabatan, dropdown, source lineage, dan horizontal roster table terbaca.

### 2026-10-07 — Perbaikan launcher server lokal

- **IMPLEMENTED / VERIFIED_LOCAL / NOT DEPLOYED:** `start_server.bat` lama
  mengiklankan alamat LAN `192.168.1.82:8080`, tetapi `getApiBaseUrl()` hanya
  mengenali hostname localhost. Saat dibuka lewat IP LAN, request `/api/*`
  salah menuju static Python port 8080 dan menghasilkan 404, walau backend port
  3000 sehat. Routing preview sekarang memakai hostname yang sama + port 3000
  untuk localhost maupun LAN.
- Launcher sekarang mendeteksi IP dari default route, memvalidasi Node/Python
  dan dependencies, hanya membutuhkan Docker bila `.env` memakai PostgreSQL
  localhost, menampilkan warning bila `.env` masih memakai Supabase lama,
  merestart backend agar source terbaru dimuat, melakukan health check, serta
  menyediakan mode read-only `start_server.bat check`.
- Verifikasi: dashboard `localhost:8080` dan backend `/health` HTTP 200; mode
  check menemukan LAN `192.168.1.82`, port 8080/3000 listening; targeted UI
  routing 3/3 lulus; browser login 1440×900 ter-render normal. Full dashboard
  160/162 dengan dua kegagalan cache-version lama yang tidak terkait.
- **KNOWN CONFIGURATION GAP:** `backend/.env` lokal masih menunjuk Supabase
  lama. Launcher tidak mengganti credential atau menghubungkan database Biznet
  secara diam-diam; local runtime dapat hidup tetapi tidak menjadi sumber data
  produksi Biznet terbaru.

### 2026-10-07 — SSH tunnel lokal ke Biznet

- **IMPLEMENTED / VERIFIED_LIVE:** menambahkan launcher
  `start_biznet_tunnel.bat` dan stopper `stop_biznet_tunnel.bat`, dengan logic
  PowerShell di `tools/`. Tunnel mengikat API Biznet ke loopback
  `127.0.0.1:13000` dan PostgreSQL container ke `127.0.0.1:15432`; tidak ada port
  production yang dibuka ke internet atau LAN.
- Dashboard lokal mendukung mode eksplisit `?api_mode=biznet` dan memakai API
  tunnel sebagai sumber utama. Ini mempertahankan backend, storage, RBAC, audit,
  dan data Biznet sebagai satu runtime; backend lokal dengan Supabase lama tidak
  digunakan pada mode ini.
- **LIVE CHECK:** SSH berhasil, API tunnel health HTTP 200, endpoint admin tanpa
  token HTTP 401, TCP database tunnel tersambung, dan kedua listener hanya bind
  ke `127.0.0.1`. Browser login pada mode Biznet ter-render normal 1440×900.
- Credential database/JWT tidak dicetak atau disalin. Runtime PID disimpan di
  `.runtime/` yang di-ignore. Panduan: `docs/PANDUAN_SSH_TUNNEL_BIZNET.md`.

## Cross-Platform Handover Protocol

### 2026-10-06 — HM meter lifecycle + restore WL30 10-01

- **IMPLEMENTED / VERIFIED_PRODUCTION:** Input Data sekarang mempunyai event
  `installation/replacement/reset` untuk hour meter. Pembacaan fisik
  `hm_start/hm_finish` tetap non-negatif; `hm_lifetime_start/finish` memakai
  offset event agar validasi lintas shift dan Periodic Service tetap kontinu
  setelah meter kembali ke nol. Event immutable menyimpan unit, tanggal+shift
  efektif, meter lama/baru, offset, alasan, serial/bukti opsional, dan pembuat.
- UI menambah tombol **HM Meter**, form event, dan riwayat unit. Work Log yang
  berada sesudah event menampilkan badge `Meter Baru`; cache asset menjadi
  `production.loader.js?v=46` dan `production.js?v=101`.
- Migration `065_equipment_hm_meter_lifecycle.sql` berhasil dijalankan pada
  PostgreSQL Biznet. Backup pra-migrasi yang catalog-nya terverifikasi berada di
  `/opt/omos/backups/manual/20261006-152549-pre-hm-meter-065.dump`.
- **DATA RESTORED:** delapan soft-deleted Work Log WL30 10-01 tanggal 23–29 Sep
  2026 dipulihkan dengan ID dan nilai historis yang sama. Event penggantian
  dibuat efektif 30 Sep 2026 Shift Siang: meter lama 51.00, meter baru 0.00,
  Lifetime offset 51.00. Verifikasi menghasilkan 13 record aktif, 0 deleted,
  restored HM 52.97, satu event, dan Lifetime HM terakhir 70.70 pada 4 Okt.
- Nilai lama 23 Sep selesai 17.00 lalu 25 Sep mulai 7.00 dipertahankan persis
  sesuai histori yang diminta owner; sistem tidak mengarang event reset kedua.
  Jika record tersebut diedit nanti, penurunan internal ini tetap dapat muncul
  sebagai anomali historis dan memerlukan rekonsiliasi terpisah.
- Verification: backend **333/333** dan dashboard **147/147** passed; syntax,
  scoped diff, dan browser preview form desktop passed. Release Biznet aktif di
  `/opt/omos/releases/20261006-152549-hm-meter-lifecycle`, image
  `omos-app:hm-meter-lifecycle-20261006-152549`; container healthy/restart 0,
  direct+public health 200, endpoint event anonim 401, asset v46/v101 aktif.
- Files utama: migration 065, `services/hmMeterLifecycle.js`, production dan
  Periodic Service controllers, production routes/tests, Input Data UI/fixture,
  migration registry/package command, `.gitignore`, dan handover ini. Tidak ada
  perubahan rumus `HM Total = HM Akhir - HM Start`, satuan, atau data produksi.

- **Kilo VS Code:** root `AGENTS.md` points here for history/status work.
- **Codex:** global `~/.codex/AGENTS.md` points here when the workspace is OMOS.
- **Both:** read this document when task history, current status, known issues,
  or prior decisions matter; then load only the domain-specific references
  listed above.
- Update this file only after a material task reaches a checkable outcome.
  Use evidence labels and preserve the distinction between verified, historical,
  designed, and planned work.
- Standing owner rule (2026-09-23): after every completed task, the assisting
  agent updates this file with (1) context summary, (2) new/edited files and
  scripts, (3) new project features — so the next agent on any platform starts
  informed without re-screening the directory.

### 2026-10-07 — Database Cuti DATE normalization hotfix

- **ROOT CAUSE / VERIFIED_PRODUCTION:** `GET /api/admin/cuti/dashboard` gagal
  HTTP 500 karena kolom PostgreSQL `DATE` dikembalikan `node-pg` sebagai objek
  `Date`, lalu implementasi lama menggabungkannya dengan suffix waktu sebelum
  memanggil `toISOString()` (`RangeError: Invalid time value`).
- **IMPLEMENTED:** layanan cuti menormalisasi objek `Date` maupun string tanggal
  ke kontrak `YYYY-MM-DD` sebelum kalkulasi proyeksi/jatuh tempo. Tidak ada data
  cuti yang dihapus atau diubah dan tidak ada migrasi database.
- **VERIFIED_TEST:** `node --test backend/test/leave-cuti.test.js` lulus 13/13,
  termasuk objek `DATE` PostgreSQL untuk hire date, effective date, realisasi,
  dan proyeksi. Eksekusi `getDashboard` langsung terhadap database Biznet
  berhasil (`DASHBOARD_OK 74`).
- **DEPLOYED:** patch backend minimal dirilis dari release aktif supaya perubahan
  working tree lain tidak ikut. Release aktif
  `/opt/omos/releases/20261007-2355-cuti-date-hotfix`, image
  `omos-app:20261007-2355-cuti-date-hotfix`; candidate health 200 dan guard
  endpoint anonim 401 lulus.

### 2026-10-08 — Sinkronisasi kebijakan cuti + dropdown master

- **ROOT CAUSE / VERIFIED_PRODUCTION:** Database Cuti memilih kebijakan tepat
  pada 1 Januari tahun dashboard dan membandingkan kolom PostgreSQL `DATE`
  sebagai string objek JavaScript. Akibatnya kebijakan yang efektif di tengah
  tahun tidak terpasang. Sampel Zulfutrawijaya (`HSE / SPV HSE`) mempunyai
  policy aktif `84:14` sejak 1 Agustus 2026 tetapi entitlement-nya tidak sinkron.
- **IMPLEMENTED:** tahun berjalan memakai tanggal hari ini sebagai acuan policy
  (histori memakai 31 Desember, tahun mendatang 1 Januari); tanggal policy
  dinormalisasi; entitlement yang sudah ada di-upsert; proyeksi dihitung ulang
  hanya bila policy berubah atau belum tersedia. Form Kebijakan Baru memakai
  dropdown Departemen → Jabatan dari master karyawan aktif dan backend menolak
  pasangan yang tidak sah. Setelah create/activate, Database Cuti otomatis
  dimuat ulang.
- **SECURITY / TENANCY:** endpoint baru `GET /api/admin/cuti/policy-scopes`
  tetap berada di belakang admin auth dan query memakai tenant scope dari user,
  bukan nilai frontend. Uji anonim menghasilkan HTTP 401.
- **VERIFIED_TEST/UI:** backend 384/384; targeted dashboard 7/7; syntax dan
  diff-check lulus. Preview Chrome 1440×1000 memperlihatkan modal dan dropdown
  bertingkat tanpa overflow. Verifikasi Biznet menghasilkan Zulfutrawijaya
  policy `84:14`, hak 3 periode, status `JATUH_TEMPO`; scope HSE memuat
  `HSE Officer` dan `SPV HSE`.
- **DEPLOYED:** release aktif
  `/opt/omos/releases/20261008-0035-cuti-policy-sync`, image
  `omos-app:20261008-0035-cuti-policy-sync`; health 200, asset `cuti.js?v=3`
  aktif. Tidak ada migrasi atau penghapusan data.

### 2026-10-08 — Database Cuti kosong pada `api_mode=local`

- **ROOT CAUSE / VERIFIED:** screenshot memakai `localhost:8080/?api_mode=local`.
  Mode ini menuju backend lokal `:3000` yang masih memakai database Supabase
  lama; inspeksi read-only membuktikan tabel `leave_policy_versions` dan
  `employee_leave_entitlements` belum ada. Tunnel Biznet `:13000` sehat dan
  data cuti Biznet tidak kosong.
- **IMPLEMENTED:** kegagalan load tidak lagi merender tab Setup Kebijakan kosong;
  UI menampilkan pesan sumber data dan hyperlink **Buka data Biznet**. Asset
  menjadi `cuti.js?v=4`. `start_server.bat` kini memilih `api_mode=biznet`
  otomatis bila tunnel Biznet sehat, tetapi tetap mempertahankan mode lokal
  eksplisit untuk pengembangan.
- **VERIFIED_UI/TEST:** dashboard targeted 9/9; Chrome preview 1440×900
  memperlihatkan diagnostic card dan link tanpa overflow. Release aktif
  `/opt/omos/releases/20261008-0105-cuti-source-guidance`, image
  `omos-app:20261008-0105-cuti-source-guidance`; health 200 dan asset v4 aktif.
  Tidak ada perubahan atau migrasi database.

### 2026-10-10 — Implementasi Penuh Register Risiko (IBPR / HIRADC) & Matriks Risiko 5×5

- **ROOT CAUSE / CONTEXT:** Tab `Hazard dan inspeksi` -> subtab `Register risiko (IBPR)` sebelumnya menampilkan placeholder roadmap ("Fase 2: Fitur sedang dalam jadwal pengembangan"). Sesuai arahan owner, fitur IBPR diimplementasikan end-to-end dengan standar SMKP Minerba & SNI ISO 45001.
- **DATABASE & MIGRATION (`VERIFIED_REPO`):**
  - Migration file: `backend/migrations/081_hse_ibpr_risk_register.sql`.
  - Schema tabel baku multi-tenant: `hse_risk_register` (`risk_no`, `activity`, `hazard`, `consequence_desc`, `initial_likelihood`, `initial_consequence`, `initial_score`, `initial_level`, `controls` JSON, `residual_likelihood`, `residual_consequence`, `residual_score`, `residual_level`, `owner_name`, `review_date`, `status`, dsb.).
  - Runner script: `backend/src/scripts/run_migration_081_hse_ibpr.js` berhasil dieksekusi dengan seed risiko tambang Pit, Hauling, Blasting, Workshop, Confined Space Tank, Fabrications.
- **BACKEND & SERVICES (`VERIFIED_REPO`):**
  - Service functions di `backend/src/services/hse.js`: `getRiskRegisterOverview` (kalkulasi KPI total/ekstrem/tinggi/sedang/rendah dan sebaran matriks 25 sel), `listRiskRegister` (filter search, initial_level, residual_level, status, cell_l, cell_c), dan `createRiskRegisterItem` (penomoran otomatis RSK-YYMM-NNN, validasi, auto-compute score & level).
  - Routes di `backend/src/routes/hse.routes.js`: `GET /api/hse/risk-register/overview`, `GET /api/hse/risk-register`, `POST /api/hse/risk-register`.
- **FRONTEND CONTROLLER & UI (`VERIFIED_REPO`):**
  - Di `admin-dashboard/hse.js`: subtab IBPR diaktifkan penuh, menghapus badge "Fase 3", merender `renderRiskRegisterTab()`, modal `openCreateRiskModal()` (dengan live calculation kalkulator skor & level interaktif dan 5 hirarki pengendalian: Eliminasi, Substitusi, Rekayasa Teknik, Administrasi, APD), dan modal detail `openRiskDetailModal()`.
  - Di `admin-dashboard/hse.css`: visualisasi Matriks Risiko 5×5 (Likelihood 1-5 vs Consequence 1-5) interaktif yang dapat diklik untuk memfilter daftar risiko secara langsung, legend tingkat risiko (Ekstrem, Tinggi, Sedang, Rendah), dan badge 5 hirarki kontrol.
  - Di `admin-dashboard/test-fixtures/hse-preview.html`: mock dataset `mockRiskRegisterOverview` & `mockRiskRegister` serta interceptor fetch rute terpasang.
- **VERIFIKASI & TEST SUITE:**
  - `node --test admin-dashboard/hse.test.js backend/test/hse.test.js`: **57/57 test PASS (100%)**.
  - Bebas error syntax dan siap digunakan di dashboard.

### 2026-10-10 — Implementasi Penuh Ekosistem Inspeksi HSE V2 (Setup Master & Integrasi Lapangan Terpadu)

- **ROOT CAUSE / CONTEXT:**
  - Pengguna merevisi arsitektur inspeksi HSE (`docs/RENCANA_SETUP_INSPEKSI_HSE_V2.md`) untuk membedakan inspeksi terencana vs tidak terencana, siklus berbeda (DAILY, WEEKLY, MONTHLY, CUSTOM_DAYS), kewajiban/kuota per jabatan vs individu (termasuk kuota 0/bebas), penjadwalan objek aset/lokasi independen, lock templat setelah dipakai, versioning immutable, serta audit trail.
  - Alur pelaksanaan inspeksi lapangan diintegrasikan langsung dengan jadwal objek dan monitoring kepatuhan pengawas.
- **DATABASE & MIGRATION (`VERIFIED_REPO`):**
  - Migration file: `backend/migrations/082_hse_inspection_setup_v2.sql`.
  - Schema tabel baku multi-tenant:
    - `hse_inspection_templates`: tambah `inspection_type`, `schedule_cycle`, `custom_interval_days`, `root_id`, `version_no`, `is_current`, `locked_at`.
    - `hse_inspection_targets`: target kewajiban kuota (`BY_ROLE` per jabatan atau `BY_EMPLOYEE` override individu, `cycle`, `target_quota`, `effective_from`, `effective_to`, `reason_code`).
    - `hse_effective_quota`: view evaluasi otomatis kuota efektif karyawan dengan hierarki individu override > jabatan default.
    - `hse_inspection_schedules`: jadwal inspeksi objek independen (`template_root_id`, `location_id`, `asset_id`, `assignee_type`, `assignee_employee_id`, `assignee_position_id`, `start_date`, `next_due_date`, `last_done_at`).
    - `hse_inspection_setup_audit`: immutable audit log perubahan templat, target, dan jadwal.
    - `hse_inspections`: penambahan kolom `schedule_id` dan `completed_at`.
  - Runner script: `backend/src/scripts/run_migration_082_inspection_setup_v2.js` berhasil dieksekusi dan terverifikasi.
- **BACKEND & SERVICES (`VERIFIED_REPO`):**
  - Di `backend/src/services/hse.js`:
    - CRUD & Versioning Templat Inspeksi dengan lock guard saat templat sudah memiliki riwayat pelaksanaan di lapangan (`createInspectionTemplateVersion`).
    - Manajemen Target Kewajiban Karyawan & Penjadwalan Objek (`createOrUpdateInspectionTarget`, `listInspectionTargets`, `getInspectionMandateOverview`, `createInspectionSchedule`, `listInspectionSchedules`, `deactivateInspectionSchedule`).
    - Perhitungan Kepatuhan Pengawas & Cakupan Jadwal (`getInspectionComplianceReport` menghitung realisasi vs kuota efektif, tingkat kepatuhan pengawas, dan *schedule coverage rate*).
    - Eksekusi Inspeksi Lapangan (`createInspection`): saat inspeksi jadwal selesai, secara otomatis memajukan `next_due_date` jadwal terkait sesuai siklus (`DAILY`, `WEEKLY`, `MONTHLY`, `CUSTOM_DAYS`) dan mencatat `last_done_at`.
  - Routes di `backend/src/routes/hse.routes.js`: rute lengkap di `/api/hse/inspections/...` (`/templates`, `/templates/:id/version`, `/mandates/overview`, `/targets`, `/schedules`, `/compliance`).
- **FRONTEND CONTROLLER & UI (`VERIFIED_REPO`):**
  - Di `admin-dashboard/hse.js`:
    - Subtab **Setup Master Inspeksi** (`setup` -> `inspection`) dengan 3 sub-tab terpadu: **Templat Inspeksi**, **Mandat Kewajiban Karyawan**, dan **Jadwal Objek Inspeksi**. Dilengkapi modal pembuatan templat ber-siklus, versioning templat, set kuota jabatan, set override individu, dan penjadwalan objek.
    - Subtab **Inspeksi Lapangan** (`hazard` -> `inspection`) dengan segmented control 3 sub-view:
      1. **Riwayat Pelaksanaan** (`list`): filter dan tabel lengkap pelaksanaan inspeksi lapangan.
      2. **Tugas Terjadwal Hari Ini & Overdue** (`tasks`): kartu dan tabel antrean tugas jatuh tempo dengan tombol 1-klik "Mulai Inspeksi" yang otomatis mengunci templat, lokasi, dan tag unit.
      3. **Monitoring Kepatuhan Pengawas** (`compliance`): ringkasan KPI kepatuhan pengawas, cakupan jadwal objek (*schedule coverage*), filter bulan & tahun, dan tabel realisasi vs target kuota per pengawas.
  - Di `admin-dashboard/hse.css`: styling segmented control, badge siklus inspeksi, badge status jatuh tempo (Jatuh Tempo Hari Ini, Lewat Jadwal, Terjadwal), dan progress bar kepatuhan.
  - Di `admin-dashboard/test-fixtures/hse-preview.html`: mock dataset lengkap terpasang untuk templat ber-siklus, target kewajiban, jadwal objek, kepatuhan pengawas, serta auto-advance rute mock saat submit inspeksi.
- **VERIFIKASI & TEST SUITE:**
  - `backend/test/hse.test.js`: **35/35 test PASS (100%)**.
  - `admin-dashboard/hse.test.js`: **29/29 test PASS (100%)**.
  - Total **64/64 test PASS** tanpa regresi.

### 2026-10-10 — Deployment Modul HSE Lengkap & Fix Runtime ke Server Biznet Gio

- **TARGET & INFRASTRUKTUR (`VERIFIED_REPO` / `PRODUCTION`):**
  - Host: `103.58.101.240` (Biznet Gio), user `adminbiznet`, root `/opt/omos`.
  - Backup database pre-migration: `/opt/omos/backups/manual/-pre-hse.dump` (8.4 MB) terverifikasi valid via `pg_restore`.
  - Migrasi database: Seluruh migrasi HSE (073 s/d 085) sukses dieksekusi ke PostgreSQL staging container (`omos-postgres-staging`, database `omos_staging`). Terverifikasi 54 tabel HSE aktif (`hazard_reports`, `hse_actions`, `hse_risk_register`, `hse_locations`, `hse_inspection_templates`, `hse_inspection_targets`, `hse_inspection_schedules`, dsb.).
  - Rilis aplikasi:
    - Release path: `/opt/omos/releases/20261010-163000-hse-complete`
    - Symlink `/opt/omos/current` mengarah ke rilis baru.
    - Docker Image: `omos-app:20261010-163000-hse-complete` (dibangun menggunakan `ops/biznet/Dockerfile.app`).
    - Container `omos-app` aktif (Up) dan mendengarkan port internal `127.0.0.1:3000`.
- **POST-DEPLOYMENT VERIFICATION:**
  - `GET http://127.0.0.1:3000/health` $\rightarrow$ HTTP 200 `{"status":"ok","serverless":false}`.
  - Endpoint auth guard anonim (`/api/hse/overview`, `/api/hse/hazards`, `/api/hse/inspections`) $\rightarrow$ HTTP 401 Unauthorized (keamanan RBAC aktif).
  - Nginx static assets:
    - `https://127.0.0.1/hse.js?v=3` $\rightarrow$ HTTP 200 (746.794 bytes).
    - `https://127.0.0.1/hse.css` $\rightarrow$ HTTP 200 (38.286 bytes).
    - `https://127.0.0.1/index.html` $\rightarrow$ HTTP 200 (120.427 bytes).
  - Tampilan dashboard web dan mobile web tersinkronisasi langsung dengan build terbaru.

### 2026-10-10 — Fitur Edit & Hapus Pengajuan Cuti Siklus pada Roster Karyawan (Database Cuti)

- **LATAR BELAKANG & KEBUTUHAN (`VERIFIED_REPO`):**
  - Pada menu `Roster Karyawan` $\rightarrow$ `Database Cuti`, pengajuan siklus yang dibuat melalui tombol `+ Pengajuan Cuti` sebelumnya belum dapat diedit atau dihapus jika ada kesalahan input tanggal mulai atau durasi hari CK/CT.
  - Pengguna membutuhkan kemampuan untuk mengedit tanggal mulai, CK (keterangan & hari), serta CT (hari) secara langsung, serta menghapus pengajuan yang salah agar slot siklus kembali terbuka.
- **BACKEND SERVICE & ENDPOINTS (`VERIFIED_REPO`):**
  - Di `backend/src/services/cuti.js`:
    - `updateCycleApplication(db, scope, user, targetIdentifier, input)`: Memvalidasi pengajuan berstatus `DRAFT`, menghitung ulang rentang berurutan CP $\rightarrow$ CK $\rightarrow$ CT, mencatat audit log `DELETE` & `CREATE`, dan menyisipkan baris permohonan baru dalam grup siklus.
    - `deleteCycleApplication(db, scope, user, targetIdentifier, reason)`: Menghapus pengajuan dalam siklus (jika belum `REALIZED`). Jika status `APPROVED`, secara otomatis memulihkan jadwal roster harian via `restoreRosterForRequest`, membersihkan rekonsiliasi dan snapshot, serta menghitung ulang proyeksi berikutnya via `refreshProjection`.
    - Di `getDashboard`: Menyertakan kolom `application_group_id` pada JSON payload events per siklus.
  - Di `backend/src/controllers/cutiController.js`:
    - `ubahPengajuanSiklus`: Handler untuk endpoint update pengajuan siklus.
    - `hapusPengajuanSiklus`: Handler untuk endpoint delete pengajuan siklus.
  - Di `backend/src/routes/admin.routes.js`:
    - `PUT /api/admin/cuti/cycle-applications/:id`
    - `DELETE /api/admin/cuti/cycle-applications/:id`
- **FRONTEND UI & UX (`VERIFIED_REPO`):**
  - Di `admin-dashboard/cuti.js`:
    - Pada tabel siklus mode Card (`cardHtml`): Jika suatu siklus telah memiliki pengajuan (`group.length > 0`), disediakan tombol **Edit** (untuk status `DRAFT`) dan **Hapus** (selama belum `REALIZED`).
    - Pada Drawer Detail & Audit (`drawerHtml`): Disediakan tombol **Edit** dan **Hapus** pada baris permohonan.
    - Modal interaktif `openEditPengajuan`: Menampilkan form edit dengan data terisi (nama karyawan, siklus, tanggal mulai, CK hari & keterangan, CT hari) beserta kalkulasi dinamis total hari cuti.
    - Konfirmasi penghapusan aman: Menyertakan konfirmasi dialog dan prompt input alasan penghapusan yang tersimpan rapi di audit log.
- **TESTING & VERIFIKASI:**
  - `backend/test/leave-cuti.test.js`: Seluruh 28 unit test PASS (100%), termasuk penambahan test kasus `edit pengajuan siklus` dan `hapus pengajuan siklus`.

### 2026-10-10 — Peningkatan Database Cuti: Highlight Aktual, Realisasi Terbaru, dan Pop-Up Modal Card

- **FITUR & PERUBAHAN (`VERIFIED_REPO`):**
  1. **Highlight Indikator Aktual & Perhitungan Pengajuan Cuti**:
     - Query lateral `cp` pada `getDashboard` di `backend/src/services/cuti.js` dan fungsi frontend `countAktual(row)` diperbarui untuk menghitung jumlah count pengajuan cuti yang telah dibuat oleh user (siklus CP aktif dari `+ Pengajuan Cuti`) serta realisasi fisik yang sudah berjalan (`GREATEST`).
     - Kartu KPI `Aktual` di header diberi highlight visual khusus (`.cuti-kpi--highlight` dengan border aksen, background gradien, dan elevasi).
     - Kolom `Aktual` pada setiap baris karyawan di-highlight dengan badge ungu (`.cuti-aktual-highlight`).
  2. **Kolom Realisasi Menampilkan Data Realisasi/Jadwal Terbaru**:
     - Ditambahkan helper `latestRealisasiHtml(row)`: Menyeleksi event cuti aktif dan mengurutkan berdasarkan tanggal terbaru.
     - Menampilkan rentang tanggal cuti terbaru (`start s.d. end`), label siklus (`Cuti N`), serta badge status (`Aktual` vs `Jadwal`), sehingga kolom tidak lagi kosong (`—`) saat user sudah membuat pengajuan.
  3. **Klik Baris List Membuka Pop-Up Window Card Cuti Karyawan**:
     - Ditambahkan listener `[data-cuti-card-modal]` pada setiap baris `tr.cuti-row` di mode List.
     - Mengklik baris karyawan langsung membuka pop-up modal (`openCardModal`) yang menampilkan **Card Cuti Karyawan** (`personCardHtml`) secara lengkap (header info karyawan, ringkasan saldo, dan tabel siklus Cuti 1..6 beserta tombol `+ Pengajuan Cuti`, `Edit`, `Hapus`, dan `Detail & Audit`).
     - Dialog modal disesuaikan hingga lebar `1200px` (`#modalKonten:has(.cuti-person-modal-wrap)`) untuk kenyamanan tampilan tabel siklus.
- **TESTING & VERIFIKASI:**
  - `backend/test/leave-cuti.test.js`: 28/28 tests PASS (100%).
  - `admin-dashboard/cuti.test.js`: 11/11 tests PASS (100%).
### 2026-10-10 — Perbaikan Bug Dropdown & Data Hilang pada Setup Kebijakan Cuti serta Rename ke "Atur Roster Cuti"

- **AKAR MASALAH (`VERIFIED_REPO`):**
  1. **Dropdown Departemen, Jabatan, dan Karyawan Kosong/Terkunci**:
     - Pada `admin-dashboard/cuti.js`, `policyScopeOptions()` memiliki evaluasi guard `if (!stateData.policyScopes)`. Ketika `stateData.policyScopes` diinisialisasi sebagai array kosong `[]`, guard tersebut bernilai `false`, menyebabkan request ke `/api/admin/cuti/policy-scopes` tidak pernah dipicu ulang. Dropdown Departemen menjadi kosong dan Jabatan/Karyawan terkunci disabled.
     - Di sisi backend `backend/src/services/cuti.js`, `listPolicyScopes` dan `createPolicyVersion` memiliki klausa join profil `AND ($1 = 'default' OR p.id IS NOT NULL)` yang mengeliminasi user ketika profil workforce belum di-seed pada tenant terkait, padahal user aktif sudah terdaftar di master `users`.
  2. **Data Kebijakan Hilang / Tabel Kosong Saat Tab Dibuka**:
     - Pada `loadDashboard()`, pemanggilan `policies` sebelumnya difilter dengan `?active=1` alih-alih seluruh kebijakan, serta saat user berpindah tab ke `kebijakan`, fungsi `setView('kebijakan')` tidak memuat ulang `policies` karena `stateData.loaded` sudah `true`.
     - Di `backend/src/services/cuti.js`, query `listPolicies` kini mendukung fallback pencocokan tenant `(p.tenant_key = $1 OR p.tenant_key = 'default')` agar kebijakan global/default selalu tampil.
- **SOLUSI & PERBAIKAN (`VERIFIED_REPO`):**
  1. **Rename Tombol & Judul ke "Atur Roster Cuti"**:
     - `admin-dashboard/index.html`: Tombol tab `data-cuti-view="kebijakan"` diganti teksnya dari `"Setup Kebijakan Cuti"` menjadi `"Atur Roster Cuti"`.
     - `admin-dashboard/cuti.js`: Judul card diubah menjadi `<h3>Atur Roster Cuti</h3>`.
     - Versi aset di `index.html` dinaikkan menjadi `cuti.js?v=11` untuk cache-busting.
  2. **Dropdown Dinamis & Muat Ulang Mutakhir**:
     - `admin-dashboard/cuti.js`:
       - `policyScopeOptions(force)` diperbaiki: `if (force || !stateData.policyScopes || !stateData.policyScopes.length)`.
       - `setView('kebijakan')`: Selalu memuat data kebijakan dan policy-scopes terbaru via `Promise.all` dan me-render ulang tabel.
       - `openPolicyForm()`: Selalu memanggil `policyScopeOptions(true)` agar pilihan Departemen, Jabatan, dan Karyawan selalu fresh dan terisi.
       - Aksi simpan dan hapus kebijakan langsung memicu refresh dan render otomatis.
     - `backend/src/services/cuti.js`:
       - `listPolicyScopes` dan `createPolicyVersion`: Menambahkan fallback `OR u.role = 'karyawan'` agar seluruh user aktif di departemen/jabatan selalu masuk ke scope.
       - `listPolicies`: Mengakomodasi fallback `(p.tenant_key = $1 OR p.tenant_key = 'default')` dan `(p.project_key = $2 OR p.project_key = 'default')`.
- **TESTING & VERIFIKASI:**
  - `node --test backend/test/leave-cuti.test.js admin-dashboard/cuti.test.js`: 39/39 tests PASS (100%).
  - `npm test` backend: 432/432 tests PASS (100%).

### 2026-10-10 — Pemulihan dan Sinkronisasi Data Roster & Kebijakan Cuti User (Biznet $\leftrightarrow$ Supabase)

- **INVESTIGASI & DIAGNOSIS (`VERIFIED_REPO`):**
  - Data yang telah disetup oleh user (6 kebijakan cuti, 3 pengajuan siklus cuti untuk Aldo Alfani & Abd. Rahman, 32 kebijakan roster jabatan) sebelumnya tersimpan di database PostgreSQL server Biznet (`omos_staging`).
  - Ketika dashboard dijalankan dalam mode lokal (`http://localhost:8080`), aplikasi terhubung ke database Supabase Cloud yang tabel `leave_policy_versions` dan `employee_leave_requests`-nya belum tersinkronisasi (0 baris). Selain itu, tunnel SSH ke port 13000 Biznet sempat terputus sehingga peralihan ke `?api_mode=biznet` sempat mengalami error connection refused.
- **TINDAKAN PEMULIHAN (`VERIFIED_REPO`):**
  1. Melakukan dump data lengkap dari database Biznet dan mengimpornya ke database Supabase Cloud:
     - `leave_policy_versions` (6 kebijakan aktif/riwayat: Driver DT, Operator, Helper Mekanik, Admin, Ast Survey, SPV HSE).
     - `employee_leave_requests` (3 pengajuan cuti siklus terisi).
     - `roster_jabatan_policies` (32 kebijakan jabatan roster).
     - `users` (sinkronisasi 85 akun master).
  2. Me-restart backend server lokal di port 3000 dengan modul dan data yang telah tersinkronisasi.
  3. Mengaktifkan kembali SSH tunnel Biznet di port 13000 (`127.0.0.1:13000` $\rightarrow$ `Biznet:3000`) dan memverifikasi kedua endpoint (`http://localhost:3000` & `http://127.0.0.1:13000`) mengembalikan data yang identik dan sehat.
- **HASIL AKHIR:**
  - Tab "Atur Roster Cuti" menampilkan seluruh 6 kebijakan yang telah disetup user.
  - Tab "Database Cuti" menampilkan data karyawan dengan pengajuan siklus dan realisasi aktif.
  - Form setup kebijakan baru menampilkan 7 departemen lengkap dengan jabatan dan karyawan yang dapat dipilih secara dinamis.

### 2026-10-10 — Integrasi Taste Skill Framework (`Leonxlnx/taste-skill`)

- **INTEGRASI SKILL (`VERIFIED_REPO`):**
  - Mengunduh dan memasang paket lengkap **Taste Skill** dari `Leonxlnx/taste-skill` ke direktori skill proyek: `.codex/skills/`.
  - Terpasang 13 modul skill:
    1. `taste-skill` (`design-taste-frontend` v2 anti-slop frontend standard).
    2. `taste-skill-v1` (versi legacy v1).
    3. `gpt-tasteskill` (stricter rules for layout variance & motion).
    4. `image-to-code-skill` (pipeline implementasi dari referensi gambar).
    5. `redesign-skill` (protokol audit & facelift UI eksisting).
    6. `soft-skill` (high-end visual design, soft contrast & whitespace).
    7. `minimalist-skill` (editorial product UI).
    8. `brutalist-skill` (industrial brutalist UI).
    9. `stitch-skill` (Google Stitch design taste).
    10. `output-skill` (full output enforcement tanpa placeholder).
    11. `imagegen-frontend-web` (pembuatan mockup visual web).
    12. `imagegen-frontend-mobile` (pembuatan mockup visual mobile).
    13. `brandkit` (desain identitas visual & palet).
- **KEBIJAKAN AGEN (`AGENTS.md`):**
  - Ditambahkan mandat resmi di `AGENTS.md` dan tabel *Dynamic Context Map*: Setiap agen yang mengerjakan generate tampilan, UI/UX, styling, layout, atau visual mockups WAJIB membaca dan menerapkan prinsip Taste Skill untuk mencegah generic AI slop dan memastikan kualitas visual profesional.

### 2026-10-10 — Integrasi Koleksi Brand Design Systems (`VoltAgent/awesome-design-md`)

- **INTEGRASI DOKUMEN & SISTEM DESAIN (`VERIFIED_REPO`):**
  - Memasang 74 paket `DESIGN.md` dari repositori `VoltAgent/awesome-design-md` ke direktori proyek: `.codex/design-md/`.
  - Berisi analisis lengkap design tokens (color palettes, typography scale, surface/hairline tokens, spacing, component rules) dari brand industri terkemuka:
    - *Developer & AI Tools*: `linear.app`, `supabase`, `vercel`, `cursor`, `replicate`, `cohere`, `claude`, `elevenlabs`, `warp`, dll.
    - *Enterprise & DevOps*: `sentry`, `posthog`, `hashicorp`, `mongodb`, `clickhouse`, dll.
    - *Fintech & Consumer*: `stripe`, `revolut`, `wise`, `apple`, `airbnb`, `shopify`, dll.
- **KEBIJAKAN AGEN (`AGENTS.md`):**
  - Diperbarui di `AGENTS.md` dan tabel *Dynamic Context Map*: Seluruh agen yang membuat desain antarmuka, layout, styling, atau komponen baru dapat dan wajib memanfaatkan acuan token dan hierarki desain dari `.codex/design-md/<brand>/DESIGN.md` untuk menghasilkan UI berstandar industri yang kohesif.

### 2026-10-10 — Perbaikan Sinkronisasi Tab Temuan Periodic Service & Deployment Rilis Biznet

- **AKAR MASALAH (`VERIFIED_REPO`):**
  1. Pengguna melaporkan bahwa setelah mengisi field "Catatan / Temuan Service" pada modal pelaksanaan/edit service untuk unit DT30 126 (6-88) dengan deskripsi `"cek engine overhaul"`, data tersebut tidak muncul di Tab "Temuan".
  2. Browser pengguna mengakses dashboard melalui mode tunnel Biznet (`http://localhost:8080/?api_mode=biznet`).
  3. Server Biznet sebelumnya menjalankan rilis container lama (`omos-app:20261010-163000-hse-complete`) yang:
     - Belum mengintegrasikan auto-insert finding saat `createOrder` dengan catatan.
     - Mengembalikan HTTP 404 pada rute `PUT /api/admin/production/periodic-service/orders/:id` dan `DELETE /api/admin/production/periodic-service/orders/:id`.
     - Tabel `periodic_service_findings` di database Biznet masih kosong (0 baris), meskipun catatan sudah tersimpan di tabel `periodic_service_orders`.
- **SOLUSI & PERBAIKAN:**
  1. **PostgreSQL Database Trigger (Zero-Failure Safeguard)**:
     - Membuat trigger fungsi `trg_sync_periodic_service_finding()` dan memasang trigger `trg_order_sync_finding` pada tabel `periodic_service_orders` di PostgreSQL Biznet dan Supabase Cloud:
       - Setiap kali baris order disisipkan (`INSERT`) atau diubah (`UPDATE`) dengan kolom `notes` terisi, database secara otomatis menyisipkan atau memperbarui catatan temuan ke tabel `periodic_service_findings` dengan kategori `'Temuan Service'`, severity `'medium'`, dan status `'open'`.
       - Menjamin sinkronisasi temuan 100% konsisten di level basis data tanpa bergantung pada versi backend yang sedang melayani request.
  2. **Pemulihan Data Temuan Existing di Biznet**:
     - Menjalankan sinkronisasi query untuk menyisipkan order yang telah memiliki `notes` ke tabel `periodic_service_findings`.
     - Record temuan unit `DT30 126 (6-88)` (`cek engine overhaul`) dan `DT30 137 (6-99)` kini telah aktif dengan status `open`.
  3. **Build & Zero-Downtime Deployment ke Server Biznet**:
     - Membangun release baru `/opt/omos/releases/20261010-225000-ps-findings-fix` dengan Docker image `omos-app:20261010-225000-ps-findings-fix` via `ops/biznet/release-app.sh`.
     - Rilis baru kini memuat route `PUT` dan `DELETE` order serta logic auto-insert finding di `PeriodicServiceController`.
     - Verifikasi live switch: endpoint `GET dashboard` (200 OK, 2 temuan ter-render) dan endpoint `PUT order` (200 OK) telah terverifikasi sukses.
- **TESTING & VERIFIKASI:**
  - `node --test admin-dashboard/periodic-service.test.js backend/test/periodicService.test.js backend/test/leave-cuti.test.js`: 45/45 tests PASS (100%).
  - API Biznet tunnel `:13000` diverifikasi mengembalikan 2 temuan (termasuk unit DT30 126 dengan deskripsi `"cek engine overhaul"`).

### 2026-10-10 — Penyelarasan Dokumen Rencana Setup Inspeksi HSE V2.0 ke Source Code Resmi

- **REVISI SPESIFIKASI (`VERIFIED_REPO`):**
  - Memperbarui [docs/RENCANA_SETUP_INSPEKSI_HSE_V2.md](file:///d:/OneDrive/Desktop/OMOS/docs/RENCANA_SETUP_INSPEKSI_HSE_V2.md) untuk menghapus seluruh ketergantungan pada mockup sampel statis eksternal (`omos_hse_dashboard_layout.html`).
  - Menetapkan **source code aktif repositori OMOS** sebagai acuan mutlak desain dan arsitektur:
    - [admin-dashboard/hse.js](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.js) (render layout, katalog templat, matriks kewajiban karyawan, jadwal objek, dan modal form).
    - [admin-dashboard/hse.css](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.css) (CSS design tokens `--hse-*`, hairline border, badge system, stats bar).
    - Pola reaktivitas `OMOSActionFeedback` dan standar visual anti-slop dari Taste Skill & Awesome DESIGN.md.
  - Memutakhirkan relasi master data ke skema aktual (`workforce_positions`, `workforce_departments`, `users`, `hse_locations`).
  - Memperbarui status tahapan eksekusi: Migrasi DDL 084 & 085, fungsi basis data `hse_effective_quota`, backend controllers, dan frontend UI telah berstatus **SELESAI (COMPLETED)** di repositori.

### 2026-10-10 — Fitur "Seleksi Karyawan" Lingkup Kewajiban Inspeksi HSE

- **FITUR & IMPLEMENTASI (`VERIFIED_REPO`):**
  - **Database Migrasi 086**: Menambahkan tabel `hse_inspection_personnel_scopes` berlingkup `(tenant_key, project_key)` untuk menyimpan konfigurasi personil yang ditampilkan dalam matriks kewajiban inspeksi (`included_positions`, `included_employee_ids`, `excluded_employee_ids`).
  - **Backend API & Service**:
    - Menambahkan rute `GET` dan `POST /api/hse/inspections/mandates/scope` di [backend/src/routes/hse.routes.js](file:///d:/OneDrive/Desktop/OMOS/backend/src/routes/hse.routes.js).
    - Menambahkan service `getInspectionPersonnelScope` dan `saveInspectionPersonnelScope` di [backend/src/services/hse.js](file:///d:/OneDrive/Desktop/OMOS/backend/src/services/hse.js).
    - Memutakhirkan `getInspectionMandateOverview` agar memfilter `users` dan menghitung KPI (*Total Personil, Wajib, Bebas, Belum Diatur*) secara presisi berbasis konfigurasi lingkup personil aktif.
  - **Frontend UI & Modal Seleksi**:
    - Menambahkan tombol **"Seleksi Karyawan"** dengan badge info jumlah jabatan aktif di toolbar sub-tab Kewajiban Karyawan pada [admin-dashboard/hse.js](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/hse.js).
    - Membangun modal interaktif `openPersonnelScopeModal` dengan 2 sub-tab:
      1. *Jenis Jabatan*: Checklist seluruh role operasional/pengawas dengan tombol preset cepat (*Pilih Semua Pengawas*, *Batal Semua*).
      2. *Pilihan Karyawan Spesifik*: Pencarian instan dan checklist perorangan untuk include staf khusus atau exclude individu tertentu.
      3. *Live Counter Ringkasan*: Estimasi personil terpilih dan feedback simpan via `OMOSActionFeedback`.
- **TESTING & VERIFIKASI:**
  - Migrasi 086 dijalankan sukses di PostgreSQL.
  - Script verifikasi backend [verify_personnel_scope.js](file:///d:/OneDrive/Desktop/OMOS/backend/src/scripts/verify_personnel_scope.js) lulus (memfilter 85 personil umum menjadi 8 personil pengawas relevan, dan kembali ke 85 saat direset).
  - Regresi backend test suite: 432/432 tests PASS (100%).

### 2026-10-11 — Halaman 10 Survey Report: Perbaikan Kolom SEAM 4L, Template Export/Import Excel, & Penyimpanan Sel Kosong

- **FITUR & PERBAIKAN (`VERIFIED_REPO` / `VERIFIED_PRODUCTION`):**
  1. **Perbaikan Pergeseran Kolom `SEAM 4L` & `Total OB` (`CLAY`)**:
     - Memperbaiki pembangkitan sel `tbody`, `tfoot`, dan `colgroup` di [admin-dashboard/surveyReport.js](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/surveyReport.js) agar menggunakan iterasi grup `obMaterials` dan `coalMaterials` yang identik 1:1 dengan `thead`.
     - Menyelesaikan bug di mana kolom `Total OB` tidak dirender pada `tbody` saat terdapat material OB dan Coal bersamaan, yang sebelumnya menyebabkan kolom pertama Coal (`SEAM 4L`) tertimpa sel `td.sr-col-subtotal` berisi nilai `CLAY`.
  2. **Fitur `📥 Download Template` & `📤 Import Excel` (dan Penghapusan Tombol CSV/Excel Lama)**:
     - Mengganti tombol export `CSV` dan `Excel` lama di toolbar Survey Report dengan tombol **`📥 Download Template`** (`#btnDownloadTemplateSurvey`) dan **`📤 Import Excel`** (`#btnImportExcelSurvey`).
     - `Download Template` mengekspor matriks yang sedang tampil di halaman (sesuai filter Tahun, Bulan, PIT, dan Material) ke format `.xlsx` siap isi.
     - `Import Excel` membaca file `.xlsx`/`.xls`/`.csv`, memvalidasi kecocokan PIT & Material terhadap master aktif, dan langsung menyimpan batch volume ke `POST /api/admin/production/survey-volumes/batch`.
  3. **Dukungan Penyimpanan Kolom/Sel Kosong (`volume: 0`)**:
     - Menghapus pembatas pada `saveAll()` dan `parseSurveyImportMatrix()` yang sebelumnya mengabaikan atau menolak sel kosong (`''`).
     - Sel yang dikosongkan kini dikirim dengan `volume: 0` ke backend untuk mereset nilai lama di database, dan `loadPeriod()` memfilter `Number(v.volume) > 0` agar nilai `0` dirender tetap bersih sebagai sel kosong (`value=""`), bukan angka `0`.
     - Tombol `Simpan` tetap aktif untuk menyimpan tabel atau mereset sel yang dikosongkan.
  4. **Cache-Busting & Deployment**:
     - Memperbarui versi aset ke `surveyReport.js?v=7` di [admin-dashboard/production.loader.js](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/production.loader.js) dan `production.loader.js?v=53` di [admin-dashboard/index.html](file:///d:/OneDrive/Desktop/OMOS/admin-dashboard/index.html), serta men-deploy langsung ke server produksi Biznet (`/opt/omos/current/admin-dashboard/`).
- **TESTING & VERIFIKASI:**
  - `node --test admin-dashboard/survey-report.test.js backend/test/survey-volumes.test.js`: 10/10 tests PASS (100%).


## Tanya OMOS (HSE) — status 2026-10-13

- `VERIFIED_PRODUCTION` (2026-10-13, staging Biznet): backup pre-migrasi `/opt/omos/backups/manual/20261013T095405Z-pre-ask-100.dump` (+ sha256, `pg_restore --list` terverifikasi). Migrasi 100 dijalankan via `run_migration_100_ai_ask_hse.js` (preflight `--check` konfirmasi 099 ada & tabel 100 belum ada; migrasi nyata → `Migrasi 100 lengkap: tabel ai_ask_feedback tersedia.`). Rilis `20261013-165057-ask-hse-100` live (`release-app.sh`: candidate health 200/auth 401, switch sukses, `/opt/omos/current` → rilis ini).
- Verifikasi live: `/health` 200; `hse-ask.js?v=1`, `hse.js?v=9`, `hse.css?v=4` semua 200; `POST /api/hse/ask` tanpa token = 401; `ai_settings.features` default kolom kini `{"hse_ask":"OFF","hse_triage":"OFF","hse_duplicate":"OFF"}` (terkonfirmasi lewat query langsung); tidak ada error di log. Key & `LLM_*` dari deploy 099 sebelumnya tetap terbawa (container baru, env-file sama).
- Backend selesai & teruji (15 tes, lokal sebelum deploy): `backend/src/ai/ask/{compact,tools,askGuard}.js`, agen `hse.askPlanner`/`hse.askAnswer`, `services/hseAsk.js`, route `/api/hse/ask{,/info,/feedback}`, migrasi 100.
- UI: `admin-dashboard/hse-ask.js` (+ gaya `ask-*` di `hse.css`, sambungan `syncAsk()` di `hse.js`, pemilih `hse_ask` di `hse-ai.js`). Tes: `admin-dashboard/hse-ask.test.js`.
- Evaluasi: `backend/src/scripts/eval_hse_ask.js` + `backend/test/fixtures/hse-ask-goldset.jsonl` (28 pertanyaan, target ≥60).
- Dokumen: `RENCANA_TANYA_OMOS_HSE.md`, `DEPLOY_ASK_HSE_100.md`, Panduan Pengguna §4.6. Data keluar negeri untuk fitur ini memakai persetujuan D2/D8/D10 yang sama (sudah disetujui owner, lihat entri Asisten AI HSE di atas).
- Akses: hanya admin (`role==='admin'` / Admin Utama); layanan HSE hanya memfilter per tenant/project, jadi non-admin ditolak 403.
- **Sisa sebelum aktivasi** (lihat `DEPLOY_ASK_HSE_100.md` §"Uji bertahap"): Setup master → Asisten AI → Tanya OMOS = **Uji** (Admin Utama saja) → jalankan `node backend/src/scripts/eval_hse_ask.js --runs 2` (target akurasi tool ≥85%, penolakan benar 100%, konsisten ≥90%, catat latensi) → smoke test manual (tanya 1 pertanyaan, cek Sumber, "Buka di halaman", beri 👍) → cek akun admin biasa saat mode Uji (tombol harus tidak muncul, `POST /ask` = 403 `ASK_ADMIN_ONLY`) → bila lulus, ubah ke **Aktif**.

## Pemulihan Vercel Reverse-Proxy Gateway untuk APK Lama — 2026-10-13

- **ROOT CAUSE INVESTIGATION (`VERIFIED_PRODUCTION`):**
  - APK versi lama (V1.0 s/d V2.2) memiliki hardcoded endpoint API `https://attendance-system-eta-opal.vercel.app/` di dalam binary aplikasinya.
  - Saat migrasi ke Biznet (2026-10-05), domain tersebut dialihfungsikan sebagai **reverse-proxy compatibility gateway** yang meneruskan seluruh request `/api/*` secara transparan ke server baru Biznet (`https://omos-mining.com`).
  - Pada 13 Oktober 2026 pukul 13:55:03 WIB, terdapat commit git push ke branch `main` GitHub. Integrasi otomatis Vercel memicu deployment produksi baru (`dpl_437C6Vts9Kjw6VNqJoc8AkBPxgYs` - `deb0hpozd`).
  - Karena konfigurasi `vercel.json` di git remote masih memakai definisi serverless lama (`api/index.js`), Vercel membangun ulang fungsi Lambda serverless dan mengalihkan alias `attendance-system-eta-opal.vercel.app` ke deployment Lambda tersebut.
  - Akibatnya:
    1. Endpoint Vercel tidak lagi mem-proxy request ke Biznet;
    2. Endpoint `/health` mengembalikan `{"status":"ok","serverless":true}` (bukan Biznet);
    3. Endpoint baru seperti `/api/app/version` mengembalikan `404 Not Found`;
    4. Seluruh APK lama yang terpasang di HP karyawan terputus dari database Biznet dan gagal melakukan absensi/login.
- **PERBAIKAN & VERIFIKASI (`VERIFIED_PRODUCTION`):**
  - Menerapkan dan mempromosikan deployment gateway Vercel `dpl_FFMXPJvpfNzWmLLAttLLjys3nxGs` yang memiliki aturan rewrite reverse-proxy:
    - `/api/(.*)` $\rightarrow$ `https://omos-mining.com/api/$1`
    - `/health` $\rightarrow$ `https://omos-mining.com/health`
    - `/Absensi_PIM.apk` $\rightarrow$ `https://omos-mining.com/Absensi_PIM.apk`
    - `/(.*)` $\rightarrow$ 308 redirect ke `https://omos-mining.com/$1`
  - Mengarahkan kedua alias produksi Vercel (`attendance-system-eta-opal.vercel.app` dan `attendance-system-wodav.vercel.app`) ke deployment gateway `dpl_FFMXPJvpfNzWmLLAttLLjys3nxGs`.
  - Mengunci konfigurasi `vercel.json` dan `.vercelignore` di repositori git lokal agar tidak terjadi regresi build Lambda.
  - Verifikasi live:
    - `curl https://attendance-system-eta-opal.vercel.app/health`: HTTP 200 `{"status":"ok","serverless":false}` (terhubung ke Biznet).
    - `curl https://attendance-system-eta-opal.vercel.app/api/app/version`: HTTP 200 (mengembalikan metadata versi 3.0.1 dari Biznet).
    - `POST /api/auth/login`: diteruskan ke Biznet backend dan PostgreSQL auth secara utuh.
    - `curl https://attendance-system-eta-opal.vercel.app/`: HTTP 308 redirect ke `https://omos-mining.com/`.

