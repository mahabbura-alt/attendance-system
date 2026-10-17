# OMOS — Handoff Sesi (2026-09-05)

Dokumen handoff untuk agen baru melanjutkan pekerjaan pada **OMOS (One Mining Operating System)**.
Dibuat dari riwayat sesi ini. Semua pekerjaan dilakukan pada salinan proyek **`D:\OneDrive\Desktop\ONE MINING`** (deployed ke Vercel + Supabase).

> **Relokasi 2026-10-05:** repository kanonis sekarang berada di `D:\OneDrive\Desktop\OMOS`. Referensi `ONE MINING` di bawah ini adalah konteks historis; gunakan path baru untuk pekerjaan aktif.

> **Catatan workspace saat ini:** gunakan path absolut `D:/OneDrive/Desktop/OMOS` untuk pekerjaan aktif.

---

## 1. Konteks Proyek

- Ada dua salinan proyek: `D:\OneDrive\Desktop\PROJECT` (lebih baru, primer) dan `D:\OneDrive\Desktop\ONE MINING` (lebih lama, **deployed** ke Vercel + Supabase).
- Semua pekerjaan terbaru dilakukan di **ONE MINING** dan di-deploy ke Vercel production.
- URL produksi: `https://attendance-system-eta-opal.vercel.app`
- Skills tersimpan sebagai file di `D:\OneDrive\Desktop\OMOS\.roo\skills\<name>\SKILL.md` (BUKAN di registry skill tool — baca sebagai file bila perlu).
- Bahasa komunikasi dengan user: **Bahasa Indonesia**.

### Kredensial (RAHASIA — jangan dicetak/log)
- Vercel token & password DB Supabase **tidak boleh ditulis ulang di dokumen ini**. Referensi lokasi:
  - DB: `backend/.env`, `.env.supabase`, `.env.production` → variabel `DATABASE_URL` (Supabase pooler, region `aws-0-ap-southeast-1`).
  - Deploy Vercel: token tersimpan di riwayat sesi sebelumnya (baca dari konteks bila perlu, jangan commit).

---

## 2. Ringkasan Pekerjaan Sesi Ini

Sesi ini menyelesaikan **3 (tiga) task** pada modul Production (Mining Module):

### Task A — Fitur Hapus pada Tabel Breakdown Aktif (SELESAI)
- Menambahkan fitur delete pada tabel breakdown aktif.
- Implementasi + E2E test lulus (6/6).
- Script diagnostik sementara (`diag_breakdown_schema.js`, `e2e_verify_breakdown_delete.js`) sudah dihapus.
- Sudah di-deploy ke Vercel, health check HTTP 200.

### Task B — Bug "FOR UPDATE cannot be applied to the nullable side of an outer join" (SELESAI)
- **Gejala:** tidak bisa hapus data breakdown, muncul notifikasi error tersebut.
- **Akar masalah:** metode `deleteBreakdownLog` memakai `LEFT JOIN equipment` dengan `FOR UPDATE` pada seluruh query. PostgreSQL tidak mengizinkan `FOR UPDATE` pada sisi nullable dari outer join.
- **Perbaikan:** di [`production.controller.js`](D:/OneDrive/Desktop/OMOS/backend/src/controllers/production.controller.js:3627) — ubah `FOR UPDATE` menjadi `FOR UPDATE OF bl` (mengunci hanya tabel `breakdown_logs`, sisi non-nullable).
- Sudah di-deploy ke Vercel, health check HTTP 200.

### Task C — Restore Parameter Standby Codes (SELESAI)
- **Permintaan user:** data di Parameter Standby Codes berubah setelah migrasi; ingin dikembalikan.
- **Diagnosis:** DB produksi hanya berisi kode generik STB-01..07 (hasil seed SQL), sedangkan kode operasional asli (S02–S45 dari `PARAMETER.xlsx` sheet "Daily STB") hilang setelah migrasi.
- **Keputusan user (via dialog konfirmasi):** "Restore 44 kode S DAN hapus kode generik STB-01..07 (hanya sisakan S-codes + STB-SYS-01)".
- **Eksekusi:** restore 44 kode S (S02–S45) + soft-delete STB-01..07 + pertahankan STB-SYS-01.
- **Verifikasi:** 45 kode aktif (S02–S45 + STB-SYS-01), 7 soft-deleted (STB-01..07), 0 referensi FK yatim di `standby_logs`.
- **Catatan:** murni restorasi data → **tidak perlu redeploy Vercel** (frontend membaca dinamis dari `getMasterData`).

---

## 3. Detail Teknis Task C (Standby Codes) — PENTING UNTUK KONTEKS

### Sumber data
- **PARAMETER.xlsx** (sheet "Daily STB") = sumber kebenaran 44 kode operasional: S02 "Slippery", S03 "Libur", S04 "General safety talk/P5M", S05 "P2H", S06 "Refueling", S07 "Lubricating", S08 "Pengecekan Mekanik", S09 "Before meal & rest time", S10 "Istirahat", S11 "After meal & rest time", S12 "Before change shift", S13 "Change Shift", S14 "Friday Pray", S15 "Other", S16 "No Operator", S17 "Persiapan Front", S18 "Persiapan Jalan", S19 "Persiapan Disposal", S20 "Engineering Delay", S21 "Travel Unit / Pindah Front", S22 "Kabut", S23 "No Fuel", S24 "Hazard", S25 "Kurang Hauler", S26 "Stop From Client", S27 "Washing Unit", S28 "No Unit Support", S29 "Waiting Time After Rain", S30 "Tunggu Tongkang", S31 "Persiapan RampDoor", S32 "Tunggu Elv. Sungai", S33 "ROM/Jetty Penuh", S34 "Waiting Instruction", S35 "No Excavator", S36 "Tower Lamp Padam", S37 "Lately Start", S38 "Tongkang kandas", S39 "Waiting Transport", S40 "Trimming coal", S41 "Driver fatigue", S42 "tongkang penuh", S43 "Jalan licin", S44 "Collecting Coal Jetty", S45 "Coal habis".
- **Seed SQL** [`003_mining_production_schema.sql`](D:/OneDrive/Desktop/OMOS/backend/sql/003_mining_production_schema.sql:487) menanam kode generik STB-01..07 (ON CONFLICT DO NOTHING).
- **Migrasi 014** menambah STB-SYS-01 (sistem, terkunci) + kolom `is_system`/`is_locked`.

### Skema tabel `master_standby_codes`
Kolom penting: `kode`, `kategori`, `deskripsi`, `planning_type` (default 'unplanned'), `control_class` (default 'controllable'), `owner_department` (default 'Production'), `requires_description`, `requires_evidence`, `is_system`, `is_locked`, `deleted_at`, `updated_at`. Memakai pola **soft-delete** (`deleted_at IS NULL`).

### Frontend (data-driven, tidak perlu perubahan kode)
- Endpoint [`getMasterData()`](D:/OneDrive/Desktop/OMOS/backend/src/controllers/production.controller.js:1035) mengembalikan `standbyCodes` via `SELECT * FROM master_standby_codes WHERE deleted_at IS NULL ORDER BY kode`.
- UI Parameter Standby Codes dirender dari `masterProdData.standbyCodes` di [`production.js`](D:/OneDrive/Desktop/OMOS/admin-dashboard/production.js:525).
- Dropdown memfilter `!code.is_system && !code.is_locked` (mis. `standbyCodeOptions` line 4336, `standbyManualCodeEditOptions` line 5144, `standbyV2ManualCodeOptions` line 5653).
- Export verifikasi standby tetap valid karena memfilter `row['Kode Standby'] === 'STB-SYS-01'` (line 6143) — STB-SYS-01 dipertahankan.

### Pelajaran teknis (berguna untuk sesi berikutnya)
1. **PostgreSQL FOR UPDATE:** tidak bisa diterapkan pada sisi nullable outer join → gunakan `FOR UPDATE OF <alias_tabel>` untuk mengunci hanya tabel non-nullable.
2. **Parameter typing PostgreSQL:** tidak boleh memakai placeholder yang sama ($2) untuk dua kolom bertipe beda (VARCHAR vs TEXT) → error "inconsistent types deduced for parameter". Gunakan parameter terpisah.
3. **Windows cmd:** tidak punya utilitas Unix (`head`, `grep`, `sed`). Gunakan perintah bawaan Windows / PowerShell.

---

## 4. Status & Sisa Pekerjaan

Semua task sesi ini **SELESAI** dan terverifikasi. Tidak ada pekerjaan yang menggantung pada kode.

**Satu-satunya hal yang perlu user lakukan:** muat ulang (refresh) halaman tab Standby untuk melihat 45 kode Parameter Standby Codes yang sudah kembali.

**Bug lingkungan (bukan kode OMOS):** user melaporkan jendela task Roo menjadi abu-abu/tidak bisa diakses setelah sesi terlalu panjang. Ini masalah webview ekstensi Roo/VS Code, bukan bug aplikasi OMOS. Solusi: `Developer: Reload Window`, lalu lanjutkan dari riwayat task. Jika sesi berikutnya masih panjang, pertimbangkan membuat handoff/ringkasan berkala.

---

## 5. Suggested Skills (untuk agen berikutnya)

- **`omos-mining-validation`** — WAJIB dibaca sebelum mengubah formula/unit/KPI produksi, standby, fleet, atau definisi kode di masa depan. Disiplin 6 langkah; langkah 5 mengharuskan dialog konfrontasi dengan user sebelum implementasi yang menyentuh KPI.
- **`handoff`** — untuk membuat dokumen handoff berikutnya bila sesi berlanjut panjang.
- **`context-compression`** — bila konteks sesi membengkak dan perlu diringkas.
- **`code-review`** — bila ingin meninjau perubahan sejak titik tertentu (mis. perubahan `FOR UPDATE OF bl`).
- **`diagnosing-bugs`** — untuk bug runtime/regresi di masa depan.

---

## 6. Referensi File Kunci

| File | Keterangan |
|------|-----------|
| [`production.controller.js`](D:/OneDrive/Desktop/OMOS/backend/src/controllers/production.controller.js) | Controller Production (~4717 baris). `getMasterData` line 1035; `deleteBreakdownLog` line 3617 (perbaikan `FOR UPDATE OF bl` di line 3627). |
| [`production.js`](D:/OneDrive/Desktop/OMOS/admin-dashboard/production.js) | Frontend Production (~8155 baris). Render standby codes line 525. |
| [`003_mining_production_schema.sql`](D:/OneDrive/Desktop/OMOS/backend/sql/003_mining_production_schema.sql) | Seed STB-01..07 (line 487). |
| `backend/migrations/014_standby_verification_workflow.sql` | Kolom `is_system`/`is_locked` + insert STB-SYS-01. |
| [`PARAMETER.xlsx`](D:/OneDrive/Desktop/OMOS/PARAMETER.xlsx) | Sumber kebenaran 44 kode S (sheet "Daily STB"). |
| [`importParameterExcel.js`](D:/OneDrive/Desktop/OMOS/backend/src/scripts/importParameterExcel.js) | Import parameter dari Excel (menyisipkan kode berawalan 'S'). |
| [`db.js`](D:/OneDrive/Desktop/OMOS/backend/src/config/db.js) | Pool koneksi DB. |
| `backend/backup_schema_2026-09-04T16-21-00-676Z.json` | Snapshot skema (hanya skema, tanpa baris data). |

---

## 7. Laporan Perubahan (format standar OMOS)

**IMPLEMENTED**
- Fitur hapus pada tabel breakdown aktif (Task A).
- Fix bug `FOR UPDATE` pada `deleteBreakdownLog` (Task B).
- Restore 44 kode S + soft-delete STB-01..07 + pertahankan STB-SYS-01 (Task C).

**FILES CHANGED**
- [`production.controller.js`](D:/OneDrive/Desktop/OMOS/backend/src/controllers/production.controller.js:3627) — `FOR UPDATE` → `FOR UPDATE OF bl`.

**DATABASE CHANGES**
- `master_standby_codes`: 44 kode S di-restore (aktif), 7 kode STB-01..07 di-soft-delete, STB-SYS-01 dipertahankan. Total 45 kode aktif.

**API CHANGES**
- Tidak ada perubahan API (frontend data-driven via `getMasterData`).

**TESTS EXECUTED**
- E2E breakdown delete (6/6) — Task A.
- Verifikasi restore standby (45 aktif, 7 soft-deleted, 0 orphan FK) — Task C.

**SECURITY/TENANT IMPACT**
- Tidak ada perubahan lintas-tenant; operasi terbatas pada tabel master `master_standby_codes` (data master, bukan data operasional tenant).

**KNOWN LIMITATIONS**
- Kode STB-01..07 hanya di-soft-delete (masih ada di DB, `deleted_at` terisi), bukan dihapus permanen — sengaja untuk keamanan/rollback.
- Bug jendela task Roo (abu-abu) adalah masalah lingkungan ekstensi, bukan kode OMOS.

**RECOMMENDED NEXT STEP**
- User melakukan refresh halaman tab Standby untuk melihat 45 kode.
- Bila sesi berlanjut panjang, buat handoff/ringkasan berkala untuk menghindari jendela task macet.
