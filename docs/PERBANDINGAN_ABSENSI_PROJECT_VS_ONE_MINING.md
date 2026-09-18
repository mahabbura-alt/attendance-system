# Perbandingan Sistem Absensi: PROJECT vs ONE MINING

> Dokumen ini menyajikan seluruh data perbandingan sistem absensi antara project pendahulu
> `D:\OneDrive\Desktop\PROJECT` dan project `ONE MINING` dalam bentuk tabel, agar memudahkan
> pemilihan bagian mana dari PROJECT yang akan diterapkan/dipertahankan di ONE MINING.
>
> **Status:** Analisis read-only — belum ada perubahan kode yang dilakukan.

---

## 1. Rute (Routing) API Absensi

File rute [`absensi.routes.js`](../backend/src/routes/absensi.routes.js:1) **byte-for-byte identik** antara PROJECT dan ONE MINING.

| # | Method | Endpoint | Fungsi | PROJECT | ONE MINING |
|---|--------|----------|--------|:-------:|:----------:|
| 1 | POST | `/api/absensi/check-lokasi` | Cek lokasi sebelum absen | ✅ Ada | ✅ Ada |
| 2 | POST | `/api/absensi/datang` | Absen masuk (foto + rate limit) | ✅ Ada | ✅ Ada |
| 3 | POST | `/api/absensi/pulang` | Absen keluar (foto + rate limit) | ✅ Ada | ✅ Ada |
| 4 | GET | `/api/absensi/riwayat` | Riwayat absensi karyawan | ✅ Ada | ✅ Ada |
| 5 | GET | `/api/absensi/rekap` | Rekap kehadiran | ✅ Ada | ✅ Ada |
| 6 | GET | `/api/absensi/rekap-hm` | Rekap HM harian | ✅ Ada | ✅ Ada |
| 7 | GET | `/api/absensi/lokasi-kantor` | Lokasi kantor milik user | ✅ Ada | ✅ Ada |
| 8 | GET | `/api/absensi/slip-gaji` | Slip gaji PDF | ✅ Ada | ✅ Ada |

**Kesimpulan:** Tidak ada perubahan API surface. Evolusi terjadi di dalam controller & algoritma, bukan di routing.

---

## 2. Perbandingan Backend — Controller Absensi

File [`absensiController.js`](../backend/src/controllers/absensiController.js:1): PROJECT **655 baris** vs ONE MINING **487 baris**.

| # | Aspek | PROJECT | ONE MINING | Keterangan / Nilai |
|---|-------|---------|-----------|--------------------|
| 1 | **Cache** | In-memory cache (`cache.js`) utk lokasi & shift | Cache dihapus — selalu query DB | ONE MINING lebih sederhana & konsisten |
| 2 | **Join user-lokasi** | `INNER JOIN` → user wajib punya `lokasi_kantor_id` | `LEFT JOIN` → user boleh tanpa lokasi | ONE MINING lebih fleksibel |
| 3 | **Pemilihan shift** | Fallback jam (`Siang`/`Malam` berdasar jam WIB) + `getShiftByName` | `selectAttendanceShift()` berbasis master shift + preferensi roster/akun | ONE MINING tidak bergantung nama shift |
| 4 | **Gate roster** | Tidak ada (hanya sync otomatis dari kamera) | Gate roster: blokir bila status bukan `S`/`M` → `403 ATTENDANCE_NOT_SCHEDULED` | ONE MINING taat jadwal |
| 5 | **Jendela waktu absen** | Tidak ada | Tidak ada pembatasan jam datang; shift tetap divalidasi terhadap master server | Berlaku 24 jam |
| 6 | **Validasi akurasi GPS** | Tidak ada | `validasiAkurasi()` tolak akurasi > 100 m → `403` | ONE MINING baru |
| 7 | **Auto-close sesi** | Dipanggil setelah cek sesi | Dipanggil **sebelum** cek sesi pending | ONE MINING mencegah sesi menggantung |
| 8 | **Sync roster dari kamera** | Ada (`syncRosterFromCamera`) | Dihapus | ONE MINING pisahkan tanggung jawab |
| 9 | **Proteksi durasi min 15 mnt** | Ada (`ABSENSI_ALLOW_ANYTIME` + `percobaan_pulang_awal`) | Dihapus (masih hitung `percobaan_pulang_awal`) | ONE MINING lebih sederhana |
| 10 | **Idempotensi checkout** | Tidak ada | `WHERE id=$7 AND waktu_pulang IS NULL` + `409 ATTENDANCE_ALREADY_CHECKED_OUT` | ONE MINING cegah double-checkout |
| 11 | **Geofence kosong** | `{valid:true}` (fail-open) | `{valid:false, configuration_error:true}` → `503 ATTENDANCE_LOCATION_UNCONFIGURED` (fail-closed) | ONE MINING lebih aman |
| 12 | **Riwayat** | `FULL OUTER JOIN` + `keterangan_presensi` | `SELECT *` sederhana (limit 100) | ONE MINING lebih ringan |
| 13 | **Rekap kehadiran** | Konversi WIB di SQL | Pakai tanggal lokal | ONE MINING lebih sederhana |
| 14 | **Model HM** | `database_hm_harian` (baru) | `database_hm` (lama) | ⚠️ ONE MINING masih model lama |

---

## 3. Perbandingan Algoritma Geofence

File [`geofence.js`](../backend/src/utils/geofence.js:1): PROJECT **73 baris** vs ONE MINING **110 baris**.

| # | Aspek | PROJECT | ONE MINING | Keterangan |
|---|-------|---------|-----------|------------|
| 1 | **Rumus jarak** | Haversine (`hitungJarakMeter`) | Haversine (sama) | Identik |
| 2 | **Multi-point** | `dalamRadiusMultiPoint` | `dalamRadiusMultiPoint` | Identik |
| 3 | **Saat daftar lokasi kosong** | `{valid:true, jarak:0}` → **lolos** (fail-open) | `{valid:false, configuration_error:true}` → **ditolak** (fail-closed) | ONE MINING lebih aman |
| 4 | **Validasi akurasi** | Tidak ada | `validasiAkurasi()` + `MAX_ACCURACY_METER=100` | ONE MINING baru |

---

## 4. Perbandingan Frontend — Geofencing (TEMUAN PENTING)

Perbedaan paling kritis. **PROJECT memiliki bug geofencing di KEDUA varian frontend**, ONE MINING sudah memperbaikinya.

### 4.1 `useOfficeLocationFallback` — admin-dashboard

| # | Aspek | PROJECT | ONE MINING |
|---|-------|---------|-----------|
| 1 | Lokasi file | [`PROJECT/admin-dashboard/karyawan.js`](D:/OneDrive/Desktop/PROJECT/admin-dashboard/karyawan.js:171) | [`admin-dashboard/karyawan.js`](../admin-dashboard/karyawan.js:169) |
| 2 | Perilaku saat GPS gagal | Ambil koordinat **kantor** → set `currentCoords` = koordinat kantor | Set `currentCoords = {lat:null,lng:null}` |
| 3 | `isLocationValid` | `true` (dianggap valid) | `false` |
| 4 | Hasil | **Bypass geofence** — absen dari mana saja | **Fail-closed** — absen ditolak |
| 5 | `enableHighAccuracy` | (mobile-web) `false` | `true` |

**Cuplikan PROJECT (BUGGY):**
```js
if (lat && lng) {
  currentCoords.lat = Number(lat);   // ← koordinat KANTOR
  currentCoords.lng = Number(lng);   // ← bukan lokasi GPS karyawan
  isLocationValid = true;            // ← dianggap valid
  return true;
}
```

**Cuplikan ONE MINING (FIXED):**
```js
// Legacy entry point: failed GPS must never become an office coordinate.
currentCoords = { lat: null, lng: null };
isLocationValid = false;
return false;
```

### 4.2 Fitur tambahan frontend ONE MINING (mobile-web)

| # | Fitur | PROJECT | ONE MINING |
|---|-------|:-------:|:----------:|
| 1 | `getFreshLocation()` (akurasi segar) | ❌ | ✅ |
| 2 | `currentAccuracy` | ❌ | ✅ |
| 3 | Penolakan akurasi > 100 m | ❌ | ✅ |
| 4 | `portalFetch` (helper fetch) | ❌ | ✅ |

---

## 5. File yang Identik (Tidak Berubah)

| # | File | Status |
|---|------|:------:|
| 1 | [`shiftValidator.js`](../backend/src/utils/shiftValidator.js:1) — `statusAbsenDatang`/`statusAbsenPulang` | Identik |
| 2 | [`attendanceSession.js`](../backend/src/services/attendanceSession.js:1) — `autoCloseExpiredSessions` (13 jam) | Identik |
| 3 | [`absensi.routes.js`](../backend/src/routes/absensi.routes.js:1) | Identik |
| 4 | `admin-dashboard/karyawan.html` | Identik (26.670 B) |

---

## 6. Ukuran File Frontend

| # | File | PROJECT | ONE MINING | Selisih |
|---|------|---------|-----------|---------|
| 1 | `mobile-web/karyawan.js` | 28.897 B | 29.937 B | +1.040 B |
| 2 | `admin-dashboard/karyawan.js` | 24.302 B | 22.226 B | −2.076 B |
| 3 | `mobile-web/index.html` | 27.083 B | 27.863 B | +780 B |
| 4 | `admin-dashboard/karyawan.html` | 26.670 B | 26.670 B | 0 (identik) |

---

## 7. Ringkasan — Fitur yang Hanya Ada di PROJECT (Kandidat untuk Diterapkan)

Berikut daftar fitur/logika yang **ada di PROJECT tetapi TIDAK ada di ONE MINING** — kandidat yang mungkin ingin Anda terapkan kembali:

| # | Fitur PROJECT | Lokasi | Manfaat | Risiko / Catatan |
|---|---------------|--------|---------|------------------|
| 1 | **Model HM `database_hm_harian`** | `rekapHmKaryawan` | Model HM harian lebih baru/akurat | ONE MINING masih `database_hm` (regresi) |
| 2 | **Sync roster otomatis dari kamera** | `syncRosterFromCamera` | Roster ter-update saat absen kamera | Bisa konflik dengan gate roster ketat |
| 3 | **Proteksi durasi min 15 mnt** | `ABSENSI_ALLOW_ANYTIME` | Cegah absen pulang terlalu cepat | Dihapus di ONE MINING |
| 4 | **Riwayat `FULL OUTER JOIN` + `keterangan_presensi`** | `riwayat` | Riwayat lebih lengkap | Lebih berat query |
| 5 | **Rekap kehadiran konversi WIB di SQL** | `rekapKehadiran` | Akurasi zona waktu | ONE MINING pakai tanggal lokal |
| 6 | **Cache in-memory** | `cache.js` | Performa lebih cepat | Risiko data basi |

---

## 8. Ringkasan — Fitur yang Hanya Ada di ONE MINING (Penguatan yang Sudah Ada)

Fitur berikut **sudah ada & lebih baik di ONE MINING** — umumnya TIDAK perlu di-revert ke versi PROJECT:

| # | Fitur ONE MINING | Lokasi | Manfaat |
|---|------------------|--------|---------|
| 1 | Gate roster (`S`/`M` only) | `absenDatang` | Kepatuhan jadwal |
| 2 | Pemilihan shift 24 jam dari konfigurasi | `attendancePolicy.js` | Tidak memblokir karyawan berdasarkan jam datang |
| 3 | Validasi akurasi GPS (>100 m ditolak) | `geofence.js` + frontend | Cegah koordinat kasar |
| 4 | Geofence fail-closed (lokasi kosong → 503) | `geofence.js` | Keamanan |
| 5 | Idempotensi checkout (`waktu_pulang IS NULL`) | `absenPulang` | Cegah double-checkout |
| 6 | Auto-close sesi sebelum cek pending | `absenDatang` | Cegah sesi menggantung |
| 7 | Frontend geofencing FIXED (tanpa fallback kantor) | `karyawan.js` (kedua varian) | Cegah bypass geofence |

---

## 9. Technical Debt yang Tersisa di ONE MINING

| # | Isu | Keterangan |
|---|-----|-----------|
| 1 | `rekapHmKaryawan` masih pakai `database_hm` (model lama) | PROJECT sudah migrasi ke `database_hm_harian` — perlu diselaraskan |
| 2 | Belum ada `tenant_id`/`project_id` pada tabel absensi | Masih single-tenant — relevan untuk target multi-klien OMOS |
| 3 | Belum ada offline-first/sync queue pada alur absensi | Masih online-only — prinsip OMOS menuntut evaluasi offline |

---

## Cara Menggunakan Dokumen Ini

1. Tinjau **Bagian 7** — daftar fitur PROJECT yang belum ada di ONE MINING.
2. Tandai fitur yang ingin Anda terapkan (mis. model HM `database_hm_harian`, sync roster, proteksi durasi, dll).
3. Sampaikan pilihan Anda, lalu saya akan menerapkan fitur terpilih ke ONE MINING dengan tetap menjaga penguatan keamanan yang sudah ada (Bagian 8).
