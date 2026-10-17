# Rencana Pengembangan MPP Enterprise OMOS

Status: **DESIGNED / NOT YET IMPLEMENTED**  
Modul: **People → Karyawan → MPP**  
Target pelaksana: **OpenCode + Muse Spark 1.3**  
Repository: `D:\OneDrive\Desktop\OMOS`

## 1. Tujuan

Mengembangkan tab MPP dari grid kebutuhan bulanan menjadi pusat perencanaan,
pengendalian vacancy, dan tindak lanjut pemenuhan manpower yang:

- tetap memakai periode bulanan;
- menampilkan seluruh jabatan aktif dalam kelompok departemen;
- menghitung aktual dari data assignment karyawan aktif, bukan input manual;
- menyimpan kebutuhan, alasan, catatan, versi, dan audit;
- menampilkan indikator Aktual dan Kebutuhan untuk setiap departemen;
- menyediakan drill-down nama karyawan;
- mengubah gap yang disetujui menjadi Manpower Request;
- memantau pemenuhan sebagian sampai kebutuhan terpenuhi;
- menampilkan forecast berdasarkan rotasi efektif terjadwal;
- tetap tenant-aware, project-aware, auditable, dan aman dari overwrite paralel.

## 2. Baseline Implementasi Saat Ini

Jangan membangun ulang modul dari nol. Extend implementasi berikut:

- Frontend: `admin-dashboard/workforce.js`, `workforce.css`, `index.html`.
- API: `backend/src/controllers/workforceController.js`.
- Domain People: `backend/src/services/workforce.js`.
- Routes: `backend/src/routes/karyawan.routes.js`.
- Schema awal: `backend/migrations/064_workforce_movements_mpp.sql`.
- Test: `backend/test/workforce.test.js` dan
  `admin-dashboard/workforce.test.js`.

Baseline yang harus dipertahankan:

1. Slicer halaman memakai Bulan dan Tahun.
2. API MPP memakai `period=YYYY-MM`.
3. Baris bersumber dari master jabatan aktif dan dikelompokkan per departemen.
4. Aktual dihitung server-side dari assignment pada akhir bulan untuk profil
   `ACTIVE/PROBATION` dan user aktif.
5. Kebutuhan diedit inline; tombol `Simpan Perubahan` hanya muncul saat dirty.
6. Penyimpanan satu bulan tidak menghapus bulan lain.
7. Plan non-Draft direvisi sebagai versi Draft baru.
8. Approval existing: `DRAFT → SUBMITTED → APPROVED`.

## 3. Prinsip Data dan Definisi

### 3.1 Dimensi utama

Setiap data MPP minimal mempunyai:

- `tenant_key` atau `tenant_id` authoritative;
- `project_key` atau `project_id` authoritative;
- `period_month` dalam bentuk tanggal hari pertama bulan;
- `department_id`;
- `position_id`;
- `plan_id` dan `version_no`;
- sumber, pembuat, waktu, dan alasan perubahan.

Frontend tidak boleh menentukan tenant/project. Scope harus diturunkan dari
user terautentikasi.

### 3.2 Aktual

`Aktual` adalah jumlah unik karyawan yang memenuhi seluruh kondisi berikut pada
tanggal terakhir bulan terpilih:

- user aktif;
- profil tidak terhapus;
- employment status `ACTIVE` atau `PROBATION`;
- assignment berada pada tenant dan project yang sama;
- assignment efektif pada tanggal snapshot;
- departemen dan jabatan cocok dengan master yang ditampilkan.

Mutasi tidak menambah headcount. Karyawan hanya dihitung pada assignment yang
berlaku pada tanggal snapshot. Resign, Terminasi, Pensiun, dan Kontrak Habis yang
sudah efektif tidak dihitung.

### 3.3 Kebutuhan, gap, dan status

```text
Gap = Kebutuhan - Aktual

Gap > 0  → Kurang
Gap = 0  → Sesuai
Gap < 0  → Lebih
```

Jangan menampilkan status hanya dengan warna. Selalu sertakan angka dan teks.

### 3.4 Ringkasan departemen

Untuk setiap departemen:

```text
Aktual Departemen    = Σ Aktual seluruh jabatan departemen
Kebutuhan Departemen = Σ Kebutuhan seluruh jabatan departemen
Gap Departemen       = Kebutuhan Departemen - Aktual Departemen
Fill Rate            = Σ min(Aktual, Kebutuhan) / Σ Kebutuhan × 100%
```

Jika kebutuhan nol, Fill Rate harus `null/—`, bukan 0% atau 100% buatan.

### 3.5 Vacancy

```text
Vacancy = max(Kebutuhan - Aktual, 0)
Open Vacancy = max(Vacancy - Filled/In Onboarding, 0)
```

Jumlah permintaan rekrut tidak boleh melebihi vacancy kecuali user memberikan
override beralasan dan mempunyai permission khusus.

## 4. Layout yang Direkomendasikan

### 4.1 Header dan slicer

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Man Power Planning                                      [Bulan] [Tahun]     │
│ Snapshot aktual pada akhir bulan · Draft/Revisi 3        [Terapkan]          │
│                                         [Ekspor] [+ Manpower Request]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

Slicer Bulan dan Tahun tetap menjadi filter tunggal untuk seluruh sub-view.

### 4.2 KPI global

```text
[ Aktual 248 ] [ Kebutuhan 275 ] [ Gap 27 ] [ Vacancy Aktif 21 ]
[ Posisi Kritis 3 ] [ Fill Rate 90,2% ]
```

Klik KPI harus memfilter atau membuka drill-down yang sesuai.

### 4.3 Indikator highlight per departemen

Letakkan di bawah KPI global dalam horizontal scroll yang responsif.

```text
┌ PRODUKSI ─────────────────┐ ┌ MAINTENANCE ──────────────┐
│ Aktual       142          │ │ Aktual        61          │
│ Kebutuhan    155          │ │ Kebutuhan     66          │
│ Gap          -13 Kurang   │ │ Gap           -5 Kurang   │
│ Fill Rate    91,6%        │ │ Fill Rate     92,4%       │
└───────────────────────────┘ └────────────────────────────┘
```

Ketentuan:

- kartu departemen menjadi hyperlink/filter;
- klik kartu hanya menampilkan jabatan dari departemen tersebut;
- sediakan kartu `Semua Departemen` untuk reset filter;
- warna hijau untuk sesuai, merah untuk kurang, amber untuk lebih;
- angka tetap terlihat tanpa mengandalkan warna;
- urutan: departemen dengan gap terbesar terlebih dahulu, lalu alfabetis;
- kartu memperlihatkan `Aktual` dan `Kebutuhan` sebagai angka utama yang setara.

### 4.4 Segmented view

```text
[ Headcount ] [ Vacancy ] [ Forecast ] [ Riwayat ]
```

#### Headcount

```text
┌ DEPARTEMEN PRODUKSI ─ Aktual 142 · Kebutuhan 155 · Gap -13 ────────────────┐
│ Jabatan       Aktual  Kebutuhan  Gap  Status  Vacancy  Catatan       Aksi │
│ Operator HD      54      [60]     -6  Kurang      6    SIMPER aktif  Detail│
│ Foreman           8       [8]      0  Sesuai      0    —             Detail│
└─────────────────────────────────────────────────────────────────────────────┘
```

- Klik angka Aktual membuka drawer daftar karyawan.
- Kebutuhan editable hanya untuk role yang berhak.
- Perubahan kebutuhan menampilkan field alasan/catatan sebelum disimpan.
- `Simpan Perubahan` sticky di kanan atas card dan hanya muncul saat dirty.
- Approval tidak dapat dijalankan sebelum dirty state disimpan.

#### Vacancy

```text
Jabatan | Gap | Request | Recruiting | Candidate Ready | Onboarding | Filled
```

Setiap baris menampilkan progress pemenuhan dan tombol
`Buat/Tambah Manpower Request`.

#### Forecast

Tampilkan minimal tiga bulan ke depan:

```text
Jabatan | Aktual Saat Ini | Nov | Des | Jan | Risiko | Penyebab
```

Forecast deterministic berasal dari assignment dan rotasi terjadwal, bukan AI.
AI hanya boleh memberi penjelasan/rekomendasi terpisah.

#### Riwayat

```text
Waktu | Periode | Departemen/Jabatan | Sebelum | Sesudah | User | Alasan | Versi
```

### 4.5 Drawer aktual

Klik Aktual membuka drawer kanan tanpa meninggalkan MPP:

- nama dan employee ID;
- status aktif/probation;
- departemen dan jabatan;
- tanggal efektif assignment;
- tipe kerja dan grade;
- tanggal akhir kontrak jika tersedia;
- kompetensi penting/SIMPER jika modulnya tersedia;
- rotasi efektif berikutnya bila ada.

Data drawer harus berasal dari API scoped, bukan dari daftar karyawan yang sudah
dimuat seluruhnya di browser.

## 5. Fase Implementasi

### P0 — Control dan transparansi MPP

1. Indikator departemen Aktual/Kebutuhan/Gap/Fill Rate.
2. Drill-down Aktual per jabatan.
3. Alasan perubahan kebutuhan wajib saat nilai berubah.
4. Catatan, priority, needed-by, dan critical flag per jabatan/bulan.
5. Riwayat perubahan kebutuhan.
6. Optimistic concurrency agar dua admin tidak saling menimpa.
7. Export CSV/Excel sesuai bulan dan filter departemen.

### P1 — Vacancy dan pemenuhan

1. Generate Manpower Request dari gap.
2. Status pipeline:
   `DRAFT → SUBMITTED → APPROVED → RECRUITING → CANDIDATE_READY → ONBOARDING → FULFILLED`.
3. Partial fulfillment.
4. Link HIRE/REHIRE ke Manpower Request.
5. KPI vacancy terbuka dan posisi kritis.
6. Approval dan audit setiap transisi.

### P2 — Forecast dan intelligence

1. Forecast headcount dari rotasi terjadwal.
2. Perbandingan bulan dan variance.
3. Minimum operational staffing.
4. Dimensi Site/PIT/Shift/Fleet bila master authoritative sudah tersedia.
5. Coverage roster dan relief manpower.
6. Scenario planning terpisah dari approved plan.
7. Cost projection jika salary-grade authority sudah disepakati.

Jangan menggabungkan semua P2 dalam satu perubahan besar. Implementasikan per
vertical slice yang dapat diuji dan di-rollback.

## 6. Rencana Database

Gunakan migration baru, disarankan `067_workforce_mpp_enterprise.sql`. Nomor
harus dikonfirmasi ulang terhadap migration terbaru saat coding dimulai.

### 6.1 Extend kebutuhan bulanan

Tambahkan ke `workforce_mpp_line_periods`:

| Kolom | Tipe | Tujuan |
|---|---|---|
| `reason_code` | text nullable | kategori alasan perubahan |
| `reason_text` | text nullable | alasan rinci |
| `notes` | text nullable | kompetensi/kondisi khusus |
| `priority` | text | `LOW/NORMAL/HIGH/CRITICAL` |
| `needed_by` | date nullable | batas kebutuhan tersedia |
| `revision` | integer default 1 | optimistic concurrency |
| `updated_by` | uuid FK users | pengubah terakhir |
| `updated_at` | timestamptz | waktu perubahan |

Constraint:

- `needed_by` harus berada pada atau setelah awal bulan MPP;
- kebutuhan tidak negatif;
- priority menggunakan check constraint;
- index pada `(period_month, line_id)` sudah ada dari primary key.

### 6.2 Audit kebutuhan MPP

Tabel baru `workforce_mpp_requirement_audit`:

- `id` UUID;
- `tenant_key`, `project_key`;
- `plan_id`, `line_id`, `period_month`;
- `action` (`CREATE/UPDATE/REVISION/APPROVAL`);
- `previous_value` JSONB;
- `new_value` JSONB;
- `actor_id`;
- `reason`;
- `source` (`web/import/system`);
- `idempotency_key` nullable;
- `created_at`.

Audit harus append-only.

### 6.3 Manpower Request

Reuse `workforce_manpower_requests`; jangan membuat tabel request kedua.

Extend bila belum tersedia:

- `period_month`;
- `department_id`, `position_id`;
- `priority`;
- `needed_by`;
- `status` tambahan pipeline;
- `revision`;
- `idempotency_key` tenant-scoped;
- timestamps setiap milestone.

Tambahkan `workforce_manpower_request_events` untuk audit transisi dan
`workforce_manpower_request_fulfillments` untuk partial fulfillment yang
menautkan profile/movement HIRE atau REHIRE.

### 6.4 Forecast

Jangan menyimpan hasil forecast dasar bila dapat dihitung deterministik. Simpan
hanya scenario user pada tabel terpisah, misalnya:

- `workforce_mpp_scenarios`;
- `workforce_mpp_scenario_lines`.

Approved MPP tidak boleh ditimpa scenario.

## 7. Kontrak API yang Disarankan

### 7.1 Workspace MPP

`GET /api/admin/karyawan/workforce/mpp?period=2026-10&department_id=...`

Response minimum:

```json
{
  "period": "2026-10",
  "snapshot_date": "2026-10-31",
  "plan": { "id": "...", "version_no": 3, "status": "DRAFT" },
  "summary": {
    "actual": 248,
    "required": 275,
    "gap": 27,
    "open_vacancy": 21,
    "critical_positions": 3,
    "fill_rate": 0.902
  },
  "departments": [
    {
      "department_id": "...",
      "department_name": "Produksi",
      "actual": 142,
      "required": 155,
      "gap": 13,
      "fill_rate": 0.916
    }
  ],
  "lines": []
}
```

Agregasi global dan departemen harus dihitung backend agar UI bukan authority.

### 7.2 Simpan kebutuhan bulan

`PUT /api/admin/karyawan/workforce/mpp`

```json
{
  "period": "2026-10",
  "expected_plan_id": "uuid",
  "expected_version_no": 3,
  "idempotency_key": "uuid",
  "lines": [
    {
      "position_id": "uuid",
      "required_qty": 60,
      "reason_code": "FLEET_EXPANSION",
      "reason_text": "Tambahan satu fleet OB",
      "notes": "SIMPER HD wajib",
      "priority": "HIGH",
      "needed_by": "2026-10-15",
      "expected_revision": 2
    }
  ]
}
```

Server wajib:

- memvalidasi jabatan berada pada tenant/project user;
- menolak duplikat position;
- melakukan transaction dan row lock;
- mengembalikan 409 jika revision berubah;
- menulis audit before/after;
- menjaga bulan lain tetap utuh;
- tidak mempercayai nilai Aktual dari frontend.

### 7.3 Drill-down Aktual

`GET /api/admin/karyawan/workforce/mpp/actual?period=2026-10&position_id=...`

Response berisi snapshot date, jumlah, dan daftar personel scoped. Jangan
mengirim salary atau data sensitif yang tidak dibutuhkan.

### 7.4 Riwayat

`GET /api/admin/karyawan/workforce/mpp/history?period=2026-10&position_id=...`

### 7.5 Manpower Request

- `POST /workforce/manpower-requests`
- `GET /workforce/manpower-requests?period=...`
- `POST /workforce/manpower-requests/:id/transition`
- `POST /workforce/manpower-requests/:id/fulfillments`

Semua write menerima idempotency key dan revision.

### 7.6 Forecast

`GET /workforce/mpp/forecast?from=2026-10&to=2027-01`

Formula forecast minimum:

```text
Forecast Aktual Bulan N
= Aktual snapshot awal
+ HIRE/REHIRE efektif sampai akhir bulan N
- RESIGN/TERMINATION/CONTRACT_END/RETIREMENT efektif sampai akhir bulan N
± perpindahan assignment akibat TRANSFER/PROMOTION/DEMOTION
```

Setiap angka forecast harus menyediakan lineage jumlah event pembentuknya.

## 8. Struktur Kode Target

Hindari menambah seluruh logic ke controller dan `workforce.js` frontend yang
sudah padat.

```text
backend/src/
├─ controllers/workforceController.js       # HTTP orchestration tipis
├─ services/workforce.js                    # lifecycle existing
├─ services/workforceMpp.js                 # agregasi MPP, save, history
├─ services/workforceManpowerRequest.js      # vacancy workflow
└─ services/workforceForecast.js             # forecast deterministic

admin-dashboard/
├─ workforce.js                             # workspace shell existing
├─ workforceMpp.core.js                     # pure helpers/state/formula display
├─ workforceMpp.js                          # API + DOM interaction
├─ workforce.css
└─ tests/fixture existing pattern
```

Reuse `window.OMOSActionFeedback` untuk semua write.

## 9. Urutan Coding Ideal

### Step 1 — Audit baseline

1. Baca `AGENTS.md`, handover, milestone, dan dokumen ini.
2. Jalankan test baseline backend/dashboard.
3. Inspeksi migration terakhir; tentukan nomor migration aktual.
4. Verifikasi schema production/staging secara read-only.
5. Catat dirty working tree; jangan menimpa perubahan unrelated.

### Step 2 — Kunci kontrak domain

1. Tambahkan pure function periode bulanan dan agregasi department.
2. Definisikan status vacancy/request dalam constant tunggal.
3. Definisikan formula Fill Rate dan guard kebutuhan nol.
4. Tambahkan unit test normal, nol, surplus, dan critical vacancy.

### Step 3 — Migration P0

1. Buat migration idempotent.
2. Tambahkan constraint, FK, index, dan audit table.
3. Jangan mengubah data historis tanpa backfill eksplisit.
4. Uji migration dalam transaction rollback lebih dahulu.
5. Tambahkan migration ke registry dan package command.

### Step 4 — Backend vertical slice

1. Extract query/agregasi dari controller ke `workforceMpp.js`.
2. Implement summary dan department highlights server-side.
3. Implement actual drill-down.
4. Implement save dengan transaction, revision, reason, audit, idempotency.
5. Implement history.
6. Pertahankan auth admin dan scope tenant/project existing.
7. Tambahkan endpoint test termasuk Tenant A tidak dapat membaca Tenant B.

### Step 5 — Frontend P0

1. Tambahkan KPI global.
2. Render kartu departemen dari response API.
3. Tambahkan department filter dan reset.
4. Tambahkan drawer Aktual.
5. Tambahkan reason/note editor saat kebutuhan berubah.
6. Pertahankan dirty button dan before-unload warning.
7. Disable approval saat dirty.
8. Render loading, empty, error, conflict 409, dan retry state.

### Step 6 — Vacancy workflow P1

1. Extend existing manpower request schema/service.
2. Generate request dengan context period/position/gap.
3. Implement pipeline dan partial fulfillment.
4. Link HIRE/REHIRE ke fulfillment.
5. Tambahkan Vacancy view dan progress.

### Step 7 — Forecast P2

1. Bangun service deterministic dari assignment + movement.
2. Tambahkan lineage per bulan/jabatan.
3. Render Forecast view.
4. Scenario disimpan terpisah dan diberi label `Simulation`.
5. Jangan campurkan forecast dengan Aktual atau approved MPP.

### Step 8 — Verification

1. Jalankan targeted tests.
2. Jalankan seluruh backend dan dashboard test.
3. Jalankan syntax/lint/diff check.
4. Buka localhost pada desktop dan mobile viewport.
5. Verifikasi console, overflow, keyboard navigation, dirty/save/refresh.
6. Verifikasi API → DB → reload untuk persistence.
7. Baru siapkan migration/deploy setelah browser review lulus.

## 10. Test Matrix Minimum

### Backend

- bulan normal, Februari leap year, pergantian tahun;
- actual hanya user/profile aktif;
- mutasi dihitung di assignment tujuan, bukan dua jabatan;
- exit efektif sebelum snapshot tidak dihitung;
- exit setelah snapshot masih dihitung pada bulan sebelumnya;
- departemen tanpa personel tetap tampil dengan Aktual 0;
- kebutuhan 0, sesuai, kurang, dan lebih;
- penyimpanan Oktober tidak menghapus September/November;
- approved plan menghasilkan revision Draft;
- duplicate position ditolak;
- stale revision menghasilkan 409;
- retry idempotency tidak menggandakan audit/request;
- cross-tenant/project ID ditolak;
- permission viewer tidak boleh write/approve;
- audit before/after lengkap.

### Frontend

- Bulan/Tahun mengubah seluruh view konsisten;
- indikator departemen sesuai response server;
- klik kartu memfilter tabel;
- klik Aktual membuka daftar personel;
- tombol Simpan hidden saat bersih dan visible saat dirty;
- reason wajib ketika kebutuhan berubah;
- approval disabled ketika dirty;
- 409 menampilkan instruksi reload tanpa menghapus input user;
- save berhasil bertahan setelah refresh;
- mobile tidak memaksa page-level horizontal scroll;
- warna selalu disertai angka dan teks.

### End-to-end

1. Ubah kebutuhan jabatan.
2. Simpan dengan alasan.
3. Refresh dan pastikan nilai tetap.
4. Ajukan lalu setujui MPP.
5. Buat Manpower Request dari gap.
6. Penuhi sebagian.
7. Efektifkan HIRE/REHIRE.
8. Pastikan Aktual naik dan vacancy turun tepat satu kali.

## 11. Security, Audit, dan Concurrency

- Jangan menerima tenant/project/actual dari frontend sebagai authority.
- Query detail personel wajib menggunakan scope authenticated user.
- Semua write menggunakan transaction.
- Gunakan `FOR UPDATE` pada plan/requirement yang diubah.
- Gunakan revision compare-and-set dan HTTP 409.
- Gunakan idempotency key untuk request yang dapat diulang.
- Simpan WHO, WHAT, WHEN, TENANT, PROJECT, BEFORE, AFTER, REASON, SOURCE.
- Approval harus role-based di backend, bukan hanya menyembunyikan tombol.
- Jangan log token, salary, dokumen pribadi, atau payload sensitif.

## 12. Offline dan Resilience

MPP adalah fungsi admin desktop; jangan mengklaim offline penuh sebelum outbox
platform tersedia. Minimal:

- draft input tidak hilang ketika request gagal;
- tampilkan status belum tersimpan;
- retry memakai idempotency key yang sama;
- conflict tidak menimpa data terbaru;
- refresh hanya setelah save authoritative sukses;
- export dapat digunakan sebagai snapshot, bukan backup database.

## 13. Acceptance Criteria

P0 dianggap selesai jika:

1. Bulan/Tahun menjadi filter konsisten.
2. Semua jabatan aktif tampil per departemen.
3. Setiap departemen mempunyai indikator Aktual dan Kebutuhan.
4. Angka departemen sama dengan penjumlahan baris jabatan.
5. Aktual tidak dapat diedit dan memiliki drill-down personel.
6. Kebutuhan dapat diedit dengan alasan dan audit.
7. Tombol Simpan hanya muncul saat dirty.
8. Save bertahan setelah refresh dan tidak menghapus bulan lain.
9. Conflict paralel ditolak dengan 409.
10. Tenant/project isolation, full tests, dan browser review lulus.

P1 selesai jika gap dapat menjadi request, dipenuhi parsial, ditautkan ke
HIRE/REHIRE, serta vacancy berkurang tanpa duplikasi.

P2 selesai jika forecast deterministic dapat direkonsiliasi ke assignment dan
movement, sedangkan scenario tetap terpisah dari official MPP.

## 14. Instruksi Eksekusi untuk OpenCode + Muse Spark 1.3

Gunakan prompt kerja berikut sebagai pembuka:

```text
Implementasikan docs/RENCANA_PENGEMBANGAN_MPP_ENTERPRISE.md secara bertahap.
Repository adalah source of truth implementasi sekarang. Mulai dari P0 dan
jangan melanjutkan ke P1/P2 sebelum P0 lulus test, browser review, persistence,
tenant/project isolation, concurrency, dan audit. Reuse schema/API/workflow
workforce existing. Jangan membuat modul MPP paralel, jangan menghitung Aktual
di browser, dan jangan deploy atau menjalankan migration production tanpa
perintah eksplisit owner.
```

Output setiap fase wajib menyebut:

- implemented;
- files changed;
- database/API impact;
- tests actually executed;
- browser verification;
- tenant/security impact;
- known limitations;
- migration/deploy status.

