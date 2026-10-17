# Rencana Implementasi Pergantian Operator pada Input Data

**Status:** IMPLEMENTED — selesai 24 Sep 2026, terverifikasi terhadap repo & production
**Implementasi:** migrasi `052_unit_shift_segments.sql` teraplikasi di production
(tabel `production_unit_shift_sessions` + 4 kolom metadata; backfill 475 sesi / 475 log aktif);
domain service `hmSegmentValidation.js` + reason codes; MOHH `SUM`; endpoint session/segment;
tabel datar dengan input inline `Insert Data`, dirty-state, dan satu aksi `Simpan Perubahan`.
Backend multi-segmen tetap authoritative; UI modal tambah/multi tidak lagi diekspos.
**Ruang lingkup:** Halaman `1. Input Data`, Work Log/HM, Database HM, Kalkulasi Payroll, dan konsumen data turunannya  
**Tujuan:** satu unit boleh memiliki lebih dari satu operator, PIT/Area, dan JOB dalam satu tanggal operasional dan shift, tanpa menggandakan HM unit, HM payroll operator, maupun agregasi produksi.

## 1. Latar belakang dan hasil inspeksi

Kondisi aktual di lapangan memungkinkan pergantian operator/driver pada unit yang sama dalam satu shift. Contoh:

| Tanggal operasional | Shift | Unit | Operator | HM Awal | HM Akhir | Total HM |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 24 Sep 2026 | Siang | DT30 126 | Operator A | 1.000,0 | 1.004,5 | 4,5 |
| 24 Sep 2026 | Siang | DT30 126 | Operator B | 1.004,5 | 1.009,0 | 4,5 |

Hasil yang benar:

- HM unit pada shift tersebut = **9,0 HM**;
- HM Operator A untuk payroll = **4,5 HM**;
- HM Operator B untuk payroll = **4,5 HM**;
- pergantian pada batas `1.004,5` sah dan bukan duplikasi.

Implementasi saat ini belum mendukung kasus tersebut karena:

1. `analyzeHmHybrid()` memberi hard block `DUPLICATE_UNIT_SHIFT` apabila sudah ada Work Log dengan `equipment_id + tanggal + shift_id` yang sama.
2. endpoint Multi Work Log melewati unit yang sudah memiliki record pada tanggal dan shift tersebut.
3. pemeriksaan kontinuitas HM hanya mencari shift sebelum dan sesudah; belum mengurutkan beberapa segmen di dalam shift yang sama.
4. agregasi kontrol MOHH memakai `MAX(total_hm)` per unit/shift. Setelah multi-operator diizinkan, nilai ini akan kehilangan segmen lain dan harus diganti dengan agregasi segmen yang aman.
5. tabel `mining_production_logs` secara struktur sudah dapat menampung beberapa baris, tetapi belum memiliki identitas sesi unit-shift, urutan pergantian, dan proteksi overlap yang memadai.

## 2. Keputusan desain

### 2.1 Model data operasional

Satu Work Log menjadi **satu segmen penugasan operator**, bukan lagi representasi tunggal seluruh unit-shift.

Kunci bisnis kelompoknya adalah:

`scope proyek + tanggal operasional + shift + unit`

Di dalam kelompok tersebut boleh terdapat satu atau lebih segmen. Setiap segmen memiliki operator, HM awal, HM akhir, PIT/Area, JOB, konteks kerja, dan urutan sendiri. PIT/Area dan JOB adalah atribut segmen, bukan atribut yang dikunci pada seluruh sesi unit-shift.

### 2.2 Rule yang diubah

Rule lama:

> Satu unit hanya boleh memiliki satu Work Log pada tanggal dan shift yang sama.

Rule baru:

> Satu unit boleh memiliki beberapa Work Log pada tanggal dan shift yang sama selama interval HM antarsegmen tidak saling tumpang tindih. Operator, PIT/Area, dan JOB pada setiap segmen boleh sama ataupun berbeda.

Pergantian operator bukan syarat mutlak untuk membuat segmen berikutnya. Segmen baru juga sah ketika unit berpindah PIT/Area atau JOB di tengah shift, walaupun operatornya tetap sama. Operator yang sama dapat kembali mengoperasikan unit pada bagian shift berikutnya, misalnya setelah break atau pergantian sementara, selama intervalnya berbeda dan tidak overlap.

Perbedaan PIT/Area atau JOB tidak boleh dipakai untuk meloloskan dua interval HM yang overlap. Proteksi overlap tetap berlaku pada unit, tanggal operasional, dan shift yang sama karena satu unit fisik tidak dapat mencatat dua kenaikan HM pada saat yang sama.

### 2.3 Rule validasi HM

Interval diperlakukan sebagai rentang setengah terbuka `[HM Awal, HM Akhir)`. Dengan demikian:

- `segmen A selesai 1.004,5` dan `segmen B mulai 1.004,5` = **valid**;
- `segmen A 1.000,0–1.005,0` dan `segmen B 1.004,5–1.009,0` = **hard block overlap**;
- record dengan operator, HM awal, HM akhir, unit, tanggal, dan shift yang identik = **hard block duplikat persis**;
- HM akhir lebih kecil daripada HM awal = mengikuti mekanisme meter reset yang sudah ada; tidak boleh otomatis dianggap pergantian operator;
- gap HM antarsegmen = **peringatan**, bukan hard block, karena unit dapat berhenti atau tidak beroperasi;
- total HM harian tetap mengikuti kontrol maksimum yang berlaku saat ini;
- peringatan lebih dari 12 HM harus dievaluasi pada **total unit-shift**, bukan hanya masing-masing segmen;
- status `draft` boleh belum lengkap, tetapi record `submitted` wajib memiliki operator dan interval HM yang valid.

Toleransi kontinuitas `0,10 HM` yang saat ini dipakai tetap dipertahankan pada tahap awal agar perubahan tidak diam-diam mengganti kebijakan HM. Nilai ini perlu dipindahkan ke konfigurasi kebijakan pada pengembangan berikutnya.

## 3. Rekomendasi struktur data

### 3.1 Pendekatan incremental yang direkomendasikan

Tetap gunakan `mining_production_logs` sebagai sumber segmen agar Database HM dan payroll tidak perlu dipindahkan ke model baru secara besar-besaran. Tambahkan metadata berikut melalui migration:

| Kolom | Fungsi |
| --- | --- |
| `unit_shift_session_id` UUID | Mengelompokkan seluruh segmen pada unit, tanggal operasional, shift, dan scope proyek yang sama. |
| `segment_sequence` SMALLINT | Menyimpan urutan kronologis segmen di dalam sesi. |
| `handover_reason` VARCHAR | Alasan standar, misalnya pergantian operator, perpindahan PIT/Area, pergantian JOB, break, atau koreksi admin. |
| `handover_note` TEXT | Catatan opsional untuk konteks operasional/audit. |
| `source_log_id` UUID nullable | Relasi ke segmen sebelumnya ketika record dibuat melalui aksi “Pergantian Operator”. |

`total_hm` tetap generated dari `hm_finish - hm_start`. Tidak perlu menyimpan ulang total pada tabel sesi.

### 3.2 Tabel induk sesi

Untuk menjaga integritas dan memudahkan locking, disarankan menambah tabel induk `production_unit_shift_sessions`:

- `id`;
- scope tenant/project yang tersedia pada arsitektur berjalan;
- `operational_date`;
- `shift_id`;
- `equipment_id`;
- `status` (`draft`, `submitted`, `closed`);
- `created_by`, `created_at`, `updated_by`, `updated_at`;
- unique aktif pada scope + tanggal operasional + shift + unit.

Tabel ini bukan pengganti Work Log. Ia hanya menjadi identitas kelompok dan titik lock transaksi. Pada kondisi repository sekarang, scope proyek yang tersedia harus dipakai secara konsisten; ketika Core Tenant/Project menjadi authoritative, constraint wajib diperluas dengan `tenant_id` dan `project_id`.

### 3.3 Proteksi database

Validasi frontend tidak cukup. Database/backend harus mencegah race condition saat dua admin menyimpan segmen secara bersamaan.

Rencana proteksi:

1. lock baris `production_unit_shift_sessions` saat create/update/delete segmen;
2. periksa overlap terhadap semua segmen aktif dalam sesi pada transaction yang sama tanpa membedakan operator, PIT/Area, atau JOB;
3. tambah partial unique constraint untuk duplikat persis;
4. bila extension PostgreSQL yang dibutuhkan tersedia dan telah diverifikasi, tambah exclusion constraint berbasis numeric range `[hm_start, hm_finish)` untuk perlindungan overlap di lapisan database;
5. soft-deleted record tidak ikut memblokir segmen aktif;
6. restore record wajib menjalankan ulang validasi overlap, tidak boleh sekadar menghapus `deleted_at`.

## 4. Perubahan domain dan backend

### 4.1 Refactor validasi HM

Pisahkan validasi menjadi domain service agar create, update, import, restore, batch, dan preview memakai rule identik:

1. validasi nilai HM pada segmen;
2. cari sesi unit-shift;
3. muat seluruh segmen aktif dan urutkan menurut `hm_start`, lalu `segment_sequence`;
4. cek exact duplicate dan overlap terhadap segmen sebelum/sesudah; perbedaan operator, PIT/Area, atau JOB tidak menghapus konflik overlap HM;
5. hitung total unit-shift dari seluruh segmen;
6. hitung total unit-day dari seluruh shift;
7. cari kontinuitas lintas shift menggunakan segmen pertama/terakhir, bukan `created_at`;
8. kembalikan `hardIssues`, `criticalIssues`, `warnings`, serta ringkasan sesi.

Kode `DUPLICATE_UNIT_SHIFT` tidak lagi dipakai sebagai hard block umum. Ganti dengan reason code yang spesifik:

- `EXACT_SEGMENT_DUPLICATE`;
- `HM_SEGMENT_OVERLAP`;
- `HM_SEGMENT_GAP`;
- `UNIT_SHIFT_OVER_LIMIT`;
- `DAILY_OVER_24`;
- `OPERATOR_REQUIRED_FOR_SUBMIT`.

### 4.2 API

Pertahankan endpoint Work Log eksisting untuk kompatibilitas, tetapi perluas kontraknya dengan metadata sesi. Tambahkan aksi eksplisit:

- `POST /production/unit-shift-sessions/:sessionId/segments` — menambah segmen pergantian operator;
- `GET /production/unit-shift-sessions/:sessionId` — detail sesi dan ringkasan HM;
- update/delete/restore Work Log tetap berdasarkan `logId`, tetapi divalidasi dalam konteks sesi;
- respons list menyertakan `session_id`, `segment_sequence`, `session_total_hm`, `operator_count`, `handover_count`, dan badge kualitas data.

Semua assignment operator, unit, shift, dan scope wajib diverifikasi dari database serta otorisasi server. Backend tidak boleh mempercayai scope proyek dari frontend saja.

### 4.3 Insert Data dan import

- Tombol `+ Multi Work Log` dan `+ Tambah Work Log` tidak lagi diekspos pada halaman.
- Tombol `+ Insert Data` membuat satu baris kosong langsung di tabel. Baris tetap
  menjadi draft lokal sampai user menekan `Simpan Perubahan`.
- Tombol simpan nonaktif/buram ketika tidak ada perubahan. Setelah insert atau edit,
  tombol aktif dan indikator berubah dari `Tersimpan` menjadi `Data belum disimpan`.
- Unit yang sudah memiliki sesi tidak dilabeli “duplikat”; record berikutnya tetap
  dikirim sebagai segmen baru dan backend memvalidasi exact duplicate serta overlap HM.
- Import Excel boleh memuat beberapa baris untuk unit/shift yang sama.
- Seluruh baris dalam satu sesi divalidasi sebagai satu batch sebelum commit; bila satu baris overlap, transaksi sesi tersebut ditolak dengan nomor baris dan interval konflik.
- Import harus idempotent menggunakan fingerprint atau idempotency key agar retry tidak menggandakan segmen.

## 5. Rencana UX halaman Input Data

### 5.1 Tampilan tabel — keputusan final

Tampilan utama tetap memakai tabel datar seperti Input Data awal: satu Work Log
ditampilkan sebagai satu baris tanpa header grup unit-shift, badge grup, atau
tombol pergantian di antara baris. Kode unit yang sama boleh tampil beberapa
kali dalam tanggal/shift yang sama ketika segmen operasionalnya berbeda,
termasuk perbedaan operator/driver, PIT/Area, atau JOB.

Model sesi unit-shift tetap dipertahankan di backend untuk validasi interval HM,
rekonsiliasi, payroll, dan audit. Penyederhanaan tampilan ini tidak mengembalikan
rule lama `DUPLICATE_UNIT_SHIFT` dan tidak menghapus proteksi overlap atau exact
duplicate.

### 5.2 Input segmen baru — keputusan final

Segmen baru dibuat melalui `+ Insert Data`, bukan modal atau header grup. User mengisi
tanggal, shift, unit, class, operator/driver, PIT/Area, HM, JOB, dan deskripsi langsung
pada baris kosong. Seluruh record baru dan edit record lama disimpan lewat tombol
`Simpan Perubahan`; feedback global mengunci tombol selama request berlangsung.
Draft dipertahankan secara lokal dan memicu pengingat ketika user pindah halaman atau
refresh sebelum menyimpan.

### 5.3 Editing dan navigasi

- editing satu segmen tidak boleh otomatis mengubah segmen operator lain;
- perubahan interval yang menyebabkan overlap harus ditolak sebelum save;
- pindah halaman/refresh saat ada perubahan belum tersimpan memunculkan reminder;
- bila shift sudah ditutup/frozen, perubahan mengikuti mekanisme reopen dan alasan koreksi yang berlaku;
- audit drawer memperlihatkan siapa mengubah operator atau HM, nilai lama/baru, waktu, dan alasan.

## 6. Dampak dan penyesuaian modul terhubung

### 6.1 Database HM dan Kalkulasi Payroll

- satu segmen tetap menjadi satu baris HM operator;
- HM payroll tiap operator menggunakan `total_hm` segmennya, bukan total sesi unit;
- koreksi HM di Database HM tetap tidak mengubah sumber Input Data sesuai konsep koreksi yang berlaku;
- bila satu operator memiliki beberapa segmen non-overlap, payroll menjumlahkan seluruh segmen operator tersebut;
- total payroll semua operator pada satu sesi harus dapat direkonsiliasi dengan total HM unit-shift, kecuali ada koreksi Database HM yang diaudit.

### 6.2 MOHH, PA/UA, Standby, dan Review Produksi

- ganti agregasi `MAX(total_hm)` menjadi `SUM(total_hm)` pada level unit-shift;
- penjumlahan hanya aman setelah overlap diblokir;
- jumlah record tidak boleh lagi dianggap jumlah unit karena satu unit dapat memiliki beberapa segmen;
- gunakan `COUNT(DISTINCT equipment_id)` untuk jumlah unit dan `COUNT(*)` hanya untuk jumlah segmen;
- proses close shift/standby memakai ringkasan sesi unit, bukan salah satu baris operator;
- agregasi per PIT/Area dan JOB wajib menjumlahkan segmen sesuai konteks masing-masing apabila unit berpindah area atau pekerjaan di tengah shift;
- total seluruh agregasi PIT/Area–JOB untuk satu sesi harus dapat direkonsiliasi kembali dengan total HM unit-shift tanpa duplikasi.

### 6.3 Input Fuel dan Database Fuel

- pencocokan fuel tidak boleh mengambil operator pertama secara arbitrer ketika ada beberapa segmen;
- bila Input Fuel memiliki operator dan waktu/HM yang cukup, hubungkan ke segmen yang sesuai;
- bila tidak cukup untuk menentukan segmen, pertahankan fuel pada unit-shift dan tampilkan antrian alokasi operator, bukan menebak;
- total konsumsi unit tidak boleh diduplikasi ke setiap operator.

### 6.4 Export, dashboard, dan API konsumen

- export detail memuat `Session ID`, urutan segmen, alasan pergantian, serta total segmen;
- export ringkasan memuat satu baris per unit-shift;
- konsumen yang sebelumnya mengasumsikan satu record per unit-shift harus diarahkan ke view/service agregasi authoritative;
- sediakan compatibility view `production_unit_shift_summary` untuk mengurangi duplikasi formula agregasi di banyak controller.

## 7. Migrasi data historis

Migration harus bersifat additive dan reversible:

1. buat tabel sesi dan kolom metadata nullable;
2. backfill satu sesi untuk setiap kombinasi scope + tanggal + shift + unit yang aktif;
3. set seluruh record lama sebagai `segment_sequence = 1`;
4. verifikasi tidak ada kombinasi historis ganda yang tersembunyi sebelum memasang constraint;
5. buat index untuk pencarian sesi, operator, serta interval HM;
6. baru aktifkan constraint setelah laporan validasi bersih;
7. jangan mengubah `total_hm`, operator, HM awal/akhir, atau data payroll historis selama backfill.

Rollback aplikasi harus tetap dapat membaca record karena kolom lama tidak dihapus pada rilis pertama. Rollback schema tidak boleh menghapus sesi yang sudah berisi multi-segmen; cukup hentikan pemakaian fitur sampai rollback data yang terkontrol tersedia.

## 8. Tahapan implementasi

### P0 — Konfirmasi kebijakan dan baseline

- tetapkan alasan pergantian yang disediakan;
- pastikan status shift/frozen dan hak koreksi;
- inventaris seluruh query yang mengasumsikan satu baris per unit-shift;
- ambil baseline jumlah Work Log, total HM per hari, payroll HM, dan MOHH untuk rekonsiliasi;
- pastikan ownership/scope data yang authoritative pada deployment aktif.

**Exit criteria:** daftar consumer lengkap dan hasil baseline tersimpan tanpa perubahan data.

### P1 — Schema dan domain validation

- buat migration tabel sesi serta metadata segmen;
- backfill historis;
- buat domain service validasi overlap/kontinuitas/agregasi;
- pasang transaction lock dan constraint aman;
- buat compatibility summary view/service.

**Exit criteria:** dua segmen berurutan diterima; overlap dan exact duplicate ditolak; data historis tidak berubah.

### P2 — API dan backend consumer

- perluas create/update/check/delete/restore;
- tambah endpoint session/segment;
- ubah batch dan import;
- ubah MOHH, Review Produksi, standby close, serta konsumen agregat lain dari row-based menjadi session-summary;
- pastikan error API memakai reason code yang dapat ditindaklanjuti.

**Exit criteria:** seluruh endpoint menghasilkan total sesi konsisten dan tidak ada query utama memakai `MAX(total_hm)` sebagai HM unit-shift.

### P3 — Frontend Input Data

- pertahankan tabel datar satu Work Log per baris;
- gunakan `+ Insert Data` untuk menambah draft inline, tanpa modal tambah/multi;
- simpan insert dan edit melalui satu tombol `Simpan Perubahan` dengan indikator
  `Tersimpan` / `Data belum disimpan`;
- pertahankan badge validasi HM per baris;
- integrasikan save feedback, dirty-state reminder, edit, delete, restore, import, dan export;
- uji responsive serta keyboard navigation.

**Exit criteria:** user dapat menambah baris kedua untuk unit yang sama langsung di tabel,
mengubah operator/PIT/JOB, dan menyimpan seluruh draft tanpa modal serta tanpa kehilangan
proteksi overlap/exact duplicate dari backend.

### P4 — Database HM, payroll, fuel, dan rekonsiliasi

- verifikasi Database HM membaca setiap segmen operator;
- verifikasi payroll menjumlahkan HM per operator;
- sesuaikan pencocokan fuel agar tidak ambigu;
- tambah laporan rekonsiliasi `total HM unit` vs `total HM seluruh segmen operator`;
- validasi output dashboard dan Review Produksi sebelum/sesudah perubahan.

**Exit criteria:** tidak ada HM hilang/ganda dan seluruh selisih dapat dijelaskan melalui audit koreksi.

### P5 — Rollout terkendali

- jalankan migration terlebih dahulu pada staging/backup production clone;
- lakukan browser review halaman Input Data;
- lakukan parallel reconciliation minimal satu periode operasional;
- aktifkan fitur melalui feature flag;
- pantau overlap rejection, gap warning, koreksi, dan selisih payroll;
- deploy production hanya setelah migration, test, visual review, dan rollback checklist lulus.

## 9. Acceptance criteria

1. Unit yang sama dapat memiliki dua operator atau lebih pada tanggal operasional dan shift yang sama.
2. Unit yang sama dapat memiliki beberapa PIT/Area dan JOB pada tanggal operasional dan shift yang sama, termasuk ketika operator tidak berubah.
3. Batas HM akhir operator lama sama dengan HM awal operator baru diterima.
4. Interval HM yang overlap ditolak oleh backend meskipun operator, PIT/Area, atau JOB berbeda dan request dikirim langsung tanpa frontend.
5. Retry request yang sama tidak membuat segmen ganda.
6. Total HM unit-shift adalah jumlah segmen aktif non-overlap.
7. HM payroll masing-masing operator hanya berasal dari segmennya.
8. MOHH/PA/UA/Review Produksi tidak kehilangan segmen dan tidak menggandakan unit.
9. Pergantian PIT/Area atau JOB pada segmen berikutnya tercermin pada agregasi sesuai konteks segmen.
10. Edit/delete/restore memicu validasi dan rekalkulasi sesi.
11. Seluruh perubahan menyimpan actor, timestamp, nilai lama/baru, sumber, dan alasan.
12. Shift malam memakai tanggal operasional, bukan sekadar tanggal kalender perangkat.
13. User dengan scope proyek lain tidak dapat membaca atau mengubah sesi ini.

## 10. Skenario pengujian wajib

| Skenario | Hasil yang diharapkan |
| --- | --- |
| A `100–105`, B `105–110` | Valid; total unit 10; masing-masing operator 5. |
| A `100–106`, B `105–110` | B ditolak karena overlap 1 HM. |
| A `100–105`, B `105,5–110` | Diterima dengan warning gap 0,5 HM. |
| A `100–103`, B `103–106`, A `106–109` | Valid; operator A menerima total 6 HM, B 3 HM. |
| Operator A, BEI/OB `100–104`; Operator A, DKC/CG `104–109` | Valid; total unit 9 HM dan agregasi konteks terbagi 4 HM ke BEI/OB serta 5 HM ke DKC/CG. |
| BEI/OB `100–105`; DKC/CG `104–109` | Segmen kedua ditolak; perbedaan PIT/Area dan JOB tidak menghapus overlap 1 HM. |
| Request segmen identik dikirim dua kali | Hanya satu segmen tersimpan. |
| Dua admin menyimpan interval overlap bersamaan | Salah satu transaksi ditolak secara deterministik. |
| Edit segmen tengah melewati segmen berikutnya | Ditolak; data lama tetap utuh. |
| Restore segmen yang kini overlap | Restore ditolak dengan detail konflik. |
| Shift malam melewati tengah malam | Tetap masuk tanggal operasional dan sesi yang benar. |
| PIT/Area atau JOB berubah setelah handover | HM/produksi terpisah menurut konteks segmen tanpa menggandakan total unit. |
| Fuel tanpa operator yang tegas | Masuk antrian alokasi; sistem tidak menebak operator. |
| Segmen dikoreksi di Database HM | Payroll memakai koreksi audit; Input Data sumber tidak berubah. |

## 11. Risiko utama dan mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Hanya menghapus `DUPLICATE_UNIT_SHIFT` | Overlap dan HM ganda lolos | Wajib implementasikan validasi interval + transaction lock sebelum membuka rule. |
| Consumer memakai `MAX(total_hm)` | HM unit lebih kecil dari aktual | Gunakan summary service/view dan audit seluruh query. |
| Consumer menjumlahkan unit per row | Jumlah unit membengkak | Gunakan `COUNT(DISTINCT equipment_id)` pada KPI unit. |
| Payroll menerima total sesi untuk tiap operator | Pembayaran ganda | Payroll tetap berbasis segmen/operator. |
| Fuel dipetakan ke operator pertama | Attribution salah | Match deterministik atau antrian manual. |
| Edit/delete mengubah urutan | Gap/overlap tersembunyi | Validasi ulang seluruh sesi dalam satu transaction. |
| Request bersamaan | Segmen ganda/overlap | Session row lock + idempotency + constraint DB. |
| Scope proyek tidak konsisten | Kebocoran data lintas klien | Resolve scope dari auth/server dan sertakan pada session key. |

## 12. Non-goals pada perubahan awal

- tidak mengubah formula `total_hm = hm_finish - hm_start`;
- tidak mengubah kebijakan payroll, tarif, atau pembulatan;
- tidak mengubah aturan meter reset tanpa spesifikasi terpisah;
- tidak mengalokasikan fuel ke operator secara otomatis jika bukti penentu tidak tersedia;
- tidak menghapus atau menulis ulang Work Log historis;
- tidak menganggap durasi jam dinding sama dengan perubahan HM.

## 13. Rekomendasi final

Implementasi tidak boleh dilakukan hanya dengan menghapus validasi duplikat. Solusi yang aman adalah menjadikan Work Log sebagai **segmen operator dalam satu sesi unit-shift**, memblokir overlap secara transactional, dan menyediakan satu ringkasan authoritative untuk semua modul hilir. Pendekatan ini mendukung kondisi aktual pergantian driver tanpa mengorbankan integritas HM, payroll, produksi, fuel, dan audit.
