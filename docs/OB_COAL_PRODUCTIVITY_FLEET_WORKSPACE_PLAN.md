# OB & Coal Productivity — Fleet Workspace and Highlight Plan

Status: **CORE IMPLEMENTED IN REPOSITORY / migrasi, browser E2E, dan deployment belum dijalankan**  
Disusun: 16 September 2026
Revisi: 16 September 2026 — setup berbasis periode efektif

Implementasi repository mencakup workspace Fleet–Material–Scenario, highlight, checklist Dump Truck multi-class, formula fleet heterogen authoritative di backend, effective-period versioning, audit, migrasi data existing, dan resolver tanggal operasional untuk consumer terkait.

Catatan verifikasi: Fleet Capacity memakai tanggal referensi pada tahun aktif dan Unit Mapping memakai awal periode yang dipilih. Perhitungan lintas beberapa perubahan versi di dalam satu tahun/bulan belum dipecah per hari pada dua modul tersebut; Input Ritase dan Data Produksi sudah membaca versi menurut tanggal operasional fleet. Migrasi 038 dan uji browser→API→database perlu dijalankan sebelum dinyatakan siap produksi.

## Tujuan

Mengubah OB Productivity Planning dan Coal Productivity Planning dari kumpulan kartu tabel independen menjadi workspace berbasis fleet yang lebih ringkas, mudah dipindai, dan tetap mempertahankan seluruh konfigurasi planning serta integrasi Input Ritase.

Sumber kebenaran tetap:

- Excavator dan kapasitas bucket: List Equipment.
- Material, Bucket Fill Factor, Swell Factor, serta Coal Density: tabel Parameter pada halaman planning terkait.
- JOB: tabel SPO berstatus Deployed.
- Fleet Productivity: formula planning OMOS yang sudah ada. Presisi penuh dipertahankan; pembulatan hanya pada tampilan.
- OB Productivity: `BCM/Hr`.
- Coal Productivity: `Ton/Hr`. Density tetap diperlakukan sebagai `Ton/BCM` sesuai formula yang sudah berlaku.

## Setup berbasis periode efektif

Seluruh setup pada OB Productivity Planning dan Coal Productivity Planning harus mengikuti pola **effective dating** yang sudah dipakai oleh **Truck Factor Setup** di Input Ritase.

Aturan utamanya:

1. User memilih **Tanggal Berlaku** pada header halaman planning.
2. Sistem membaca versi terbaru dengan `effective_from <= tanggal yang dipilih` untuk planning type terkait.
3. Jika tidak ada versi tepat pada tanggal tersebut, halaman menampilkan nilai versi sebelumnya sebagai **Mewarisi setup sejak [tanggal]**.
4. Nilai warisan tidak disalin ke periode baru hanya karena halaman dibuka atau disimpan tanpa perubahan.
5. Perubahan user membuat versi baru yang berlaku mulai tanggal terpilih dan otomatis dipakai periode berikutnya sampai ada versi yang lebih baru.
6. Versi sebelumnya tidak ditimpa sehingga target dan konfigurasi historis tetap dapat direkonstruksi.
7. Penghapusan nilai pada versi aktif hanya menghapus override pada tanggal efektif tersebut dan mengembalikan kombinasi terkait ke versi sebelumnya, dengan konfirmasi dampak.

Kontrol header yang direkomendasikan:

- **Tanggal Berlaku**;
- badge **Versi aktif sejak [tanggal]**, **Mewarisi versi [tanggal]**, atau **Belum ada setup**;
- tombol **Lihat Riwayat** dan **Bandingkan Versi**;
- tombol **Buat Versi Periode** ketika halaman masih menampilkan nilai warisan;
- tombol **Simpan Setup Periode** setelah versi pada tanggal tersebut dibuat.

`+ Tambah Fleet`, pengaturan material, scenario, dan matriks highlight selalu bekerja di dalam versi periode yang sedang dipilih. Highlight wajib menampilkan badge tanggal sumber agar user tidak mengira nilai warisan sebagai konfigurasi baru.

### Resolusi versi untuk consumer

- Input Ritase memilih planning berdasarkan **tanggal operasional fleet**, bukan tanggal browser atau waktu request.
- Pencarian menggunakan `planning_type` dan versi paling akhir dengan `effective_from <= tanggal fleet`.
- `planRef`, hasil formula, satuan, `formulaVersion`, dan `effective_from` disalin sebagai snapshot ketika fleet/ritase dibuat atau disimpan.
- Perubahan planning periode baru tidak mengubah target yang sudah tersimpan pada transaksi historis.
- Fleet Capacity, Unit Mapping, Data Produksi, dan laporan yang membaca planning wajib memakai resolver periode yang sama; tidak boleh membaca record planning terbaru tanpa konteks tanggal.
- OB dan Coal mempunyai rangkaian versi independen, tetapi memakai pola UI dan resolver yang sama.

### Isi snapshot versi

Satu versi periode memuat konfigurasi utuh agar perhitungan dapat diaudit:

- daftar fleet dan scenario;
- referensi JOB dari SPO;
- material serta snapshot Bucket Fill Factor dan Swell Factor;
- snapshot Coal Density untuk Coal;
- daftar ID Dump Truck dan snapshot kapasitasnya;
- seluruh parameter input scenario;
- hasil formula dengan presisi penuh;
- satuan dan versi formula;
- pembuat, waktu pembuatan/perubahan, serta referensi versi sebelumnya.

Perubahan Parameter pada tanggal baru tidak boleh menghitung ulang versi historis. Parameter baru masuk ke snapshot versi periode baru; versi lama tetap menggunakan snapshot yang berlaku ketika disimpan.

### Konflik dan backdate

- Satu planning type hanya boleh memiliki satu versi per `effective_from`.
- Menyimpan ulang tanggal efektif yang sama memperbarui draft/versi tanggal tersebut dengan audit perubahan; tidak membuat duplikat.
- Membuat versi backdate di antara dua versi lama wajib menampilkan rentang tanggal yang terdampak sebelum disimpan.
- Penyimpanan memakai optimistic concurrency/version token agar tab lama tidak menimpa perubahan user lain.
- Nilai numerik disimpan dengan presisi penuh; pembulatan tetap hanya pada tampilan.

## Konsep halaman

Hierarki data dan navigasi:

```text
Planning Type (OB / Coal)
└── Fleet (Excavator)
    └── Material dari Parameter
        └── Planning Scenario (JOB + Class/Unit Dump Truck + jarak + parameter operasi)
```

Halaman awal hanya menampilkan daftar fleet/excavator yang telah ditambahkan user. Tombol **+ Tambah Tabel Baru** diganti menjadi **+ Tambah Fleet**.

Saat tombol dipilih:

1. Tampilkan dialog pemilihan unit.
2. Dropdown hanya memuat equipment aktif dengan jenis/class Excavator dari List Equipment.
3. Unit yang sudah menjadi fleet pada planning type yang sama dinonaktifkan agar tidak membuat parent fleet ganda.
4. OB dan Coal tetap merupakan konteks berbeda; satu excavator boleh tersedia pada kedua halaman jika dibutuhkan.
5. Kapasitas bucket tetap read-only dan mengikuti List Equipment.

## Daftar fleet awal

Gunakan accordion/list card satu baris per excavator, bukan seluruh form terbuka sekaligus. Informasi ringkas yang direkomendasikan:

- kode excavator;
- jumlah material yang sudah dikonfigurasi dibanding total material Parameter;
- jumlah planning scenario;
- daftar JOB yang digunakan;
- rentang Fleet Productivity;
- status kelengkapan: **Lengkap**, **Perlu dilengkapi**, atau **Belum diset**;
- waktu terakhir tersimpan jika tersedia.

Klik baris fleet membuka workspace fleet tersebut. Secara default seluruh fleet tertutup agar halaman tetap ringan untuk puluhan unit.

## Workspace fleet yang direkomendasikan

### 1. Material Overview

Tampilkan tabel ringkas satu baris per material dari Parameter:

| Material | Parameter sumber | Skenario | Target Productivity | Status | Aksi |
| --- | --- | ---: | --- | --- | --- |
| PASIR | BFF / Swell / Density* | 1 | 150 BCM/Hr | Lengkap | Buka |
| CLAY | BFF / Swell / Density* | 2 | 132–150 BCM/Hr | Multi-skenario | Buka |
| BLASTING | BFF / Swell / Density* | 0 | — | Belum diset | Atur |

`Density` hanya ada pada Coal. Nilai parameter bersifat read-only dan selalu mengikuti tabel Parameter.

Semua material Parameter ditampilkan, termasuk yang belum memiliki planning scenario. Dengan demikian user dapat melihat konfigurasi yang masih kosong tanpa membuat tabel manual terlebih dahulu.

### 2. Material Detail

Klik material membuka detail di bawah tabel atau side panel. Parameter dipisahkan menjadi dua kelompok:

**Parameter material — read-only**

- Bucket Capacity dari List Equipment;
- Bucket Fill Factor;
- Swell Factor;
- Coal Density bila halaman Coal.

**Parameter scenario — editable**

- JOB dari SPO Deployed;
- Class Unit Dump Truck melalui slicer;
- daftar unit Dump Truck melalui dropdown checklist;
- Cycle Time Loading;
- Work Efficiency Loader;
- Loaded Speed;
- Empty Speed;
- Spot & Dump Time;
- Distance;
- Work Efficiency Fleet.

**Parameter scenario — derived/read-only**

- Number of Truck = jumlah ID unit Dump Truck unik yang dicentang;
- Dump Truck Capacity = kapasitas masing-masing unit dari List Equipment.

Loader Capacity dan Loader Productivity tetap mengikuti formula yang sudah ada. Number of Pass, Loading Time, Truck Cycle Time, Truck Productivity, Fleet Match, dan Fleet Productivity memakai formula existing untuk armada homogen; scenario multi-class/multi-kapasitas mengikuti keputusan formula fleet heterogen pada bagian akhir dokumen.

### 3. Pemilihan Dump Truck multi-unit

Kontrol Dump Truck menggunakan combobox/dropdown checklist, bukan single-select:

1. Slicer **Class Unit** berfungsi sebagai filter dan dapat menampilkan satu, beberapa, atau semua class.
2. Sistem menampilkan equipment aktif kategori Dump Truck/Hauler yang sesuai filter class.
3. Setiap opsi menampilkan checkbox, kode unit, tipe/model, dan kapasitas dari List Equipment.
4. Tersedia pencarian kode/model, tombol **Pilih Semua Hasil Filter**, **Kosongkan**, dan indikator `n unit dipilih`.
5. Setelah dropdown ditutup, unit terpilih ditampilkan sebagai chips atau daftar ringkas agar user dapat melihat unit aktual tanpa membuka dropdown.
6. `Number of Truck` bersifat read-only dan selalu dihitung dari jumlah `equipment_id` unik yang dipilih.
7. Unit yang menjadi tidak aktif atau terhapus dari List Equipment tidak hilang diam-diam dari plan tersimpan; tampilkan sebagai **Unit tidak aktif — perlu ditinjau** dan tandai scenario incomplete.

Satu scenario boleh memilih Dump Truck dari beberapa Class Unit. Perubahan slicer hanya mengubah daftar yang sedang ditampilkan dan tidak menghapus pilihan dari class lain. Chips unit terpilih dikelompokkan per Class Unit agar komposisi fleet tetap mudah diaudit.

Kode unit dan Class Unit yang sama boleh digunakan kembali pada beberapa scenario. Tidak ada global exclusivity antar-scenario. Duplikasi `equipment_id` hanya dicegah di dalam checklist scenario yang sama agar `Number of Truck` tidak terhitung ganda.

Formula existing memakai satu `dumpTruckCapacity` dan sebelumnya mengasumsikan armada homogen. Karena skenario baru dapat berisi beberapa class/kapasitas, sistem tidak boleh memakai kapasitas unit pertama atau rata-rata kapasitas secara implisit. Definisi formula fleet heterogen harus disetujui sebelum implementasi perhitungan; lihat bagian **Keputusan formula terbuka**.

Data yang disimpan per scenario:

- `dumpTruckClasses[]`;
- `dumpTruckIds[]` sebagai identitas utama;
- snapshot `dumpTruckCodes[]`, tipe/model, dan kapasitas untuk keterlacakan tampilan;
- `numberOfTruck` hasil turunan, bukan nilai input bebas;
- legacy `dumpTruckCode` tetap tersedia selama masa kompatibilitas dan menunjuk unit pertama, tetapi consumer baru wajib memakai class dan daftar ID eksplisit.

### 4. Multi-scenario

Satu material dapat mempunyai lebih dari satu planning scenario ketika JOB, dump truck, jarak, atau konfigurasi operasinya berbeda. Gunakan tombol **+ Tambah Skenario** di dalam material.

Scenario tidak boleh dirata-ratakan atau saling menimpa. Setiap scenario mempertahankan:

- `tableId` dan `planRef` stabil;
- JOB;
- material;
- daftar Class Unit dan ID Dump Truck;
- jarak;
- parameter input;
- hasil formula;
- satuan;
- referensi waktu pembaruan.

Pendekatan ini mencegah target Input Ritase menjadi ambigu.

## Highlight Fleet Material Productivity

Highlight ditempatkan setelah header halaman dan sebelum daftar fleet.

- Baris: fleet/excavator unik.
- Kolom: seluruh material dari Parameter sesuai urutan user.
- Isi sel: Fleet Productivity dari scenario yang cocok.
- OB memakai `BCM/Hr`; Coal memakai `Ton/Hr`.
- Material tanpa scenario menampilkan `—`.
- Presisi perhitungan tidak dipotong; tampilan maksimal dua desimal.
- Header dan kolom Fleet sticky, dengan horizontal scroll untuk layar sempit.

Jika hanya ada satu scenario pada kombinasi Fleet × Material, tampilkan satu angka. Jika lebih dari satu, tampilkan nilai bertumpuk dengan label `JOB · jarak`; tooltip menampilkan JOB, Class Unit Dump Truck, kode unit terpilih, jarak, dan jumlah truck. Jangan menghitung rata-rata scenario.

## Migrasi data existing

Migrasi wajib non-destruktif:

1. Baca `planningData.fleetCatalog` dan HTML planning tersimpan yang sekarang.
2. Kelompokkan record berdasarkan `loaderCode`, kemudian `material`.
3. Setiap tabel lama menjadi satu planning scenario.
4. Pertahankan `tableId`, `planRef`, JOB, nilai input, hasil, dan satuan.
5. Nilai `dumpTruck` single-select lama dimigrasikan menjadi `dumpTruckIds[]` berisi unit tersebut dan `numberOfTruck = 1` hanya jika identitas unit berhasil ditemukan. Nilai `numberOfTruck` legacy yang lebih besar tidak boleh digunakan untuk mengarang unit-unit yang tidak pernah dipilih; scenario ditandai **Perlu pilih unit aktual** sampai user melengkapinya.
6. Jangan menggabungkan record yang terlihat sama karena dapat memiliki konteks JOB/jarak berbeda.
7. Pertahankan `fleetCatalog` dalam bentuk flat untuk kompatibilitas backend, Fleet Capacity, Input Ritase, Data Produksi, dan data historis.
8. Fleet Capacity dan Unit Mapping membaca `dumpTruckClasses[]`/`dumpTruckIds[]` lebih dahulu, lalu fallback ke `dumpTruckCode` untuk plan lama. Consumer baru tidak boleh mengandalkan unit pertama untuk memvalidasi seluruh fleet.
9. Struktur workspace hanya menjadi representasi UI/metadata tambahan; consumer lama tetap menerima catalog yang kompatibel.

## Sinkronisasi dan penyimpanan

- Highlight dan Material Overview diperbarui langsung ketika draft berubah.
- Draft UI tetap dapat memakai antrean autosave lokal, tetapi publikasi ke database harus melalui **Simpan Setup Periode** agar versi efektif tidak tercipta tanpa tindakan eksplisit user.
- Nilai warisan tetap read-only sampai user memilih **Buat Versi Periode**; versi baru dimulai sebagai salinan nilai efektif terakhir.
- Simpan memakai `OMOSActionFeedback`, mengunci field/tombol selama request, dan membawa revision token.
- Gagal simpan tidak boleh menghapus draft layar.
- Tombol/field dikunci selama request untuk mencegah double submit.
- Perubahan parameter material merefresh seluruh scenario terkait, tetapi tidak mengubah identitas `planRef`.
- Perubahan checklist unit merefresh `Number of Truck`, validasi kapasitas, Fleet Match, dan Fleet Productivity pada draft yang sama.
- Penghapusan fleet harus memakai konfirmasi dampak karena plan dapat direferensikan Input Ritase. Implementasi penghapusan historis perlu tetap menjaga record transaksi yang sudah memakai snapshot target.

## Rencana implementasi

### P0 — Effective-period foundation dan migrasi kompatibel

- Tambahkan penyimpanan versi untuk `ob` dan `coal` dengan `effective_from`, revision, audit actor, serta relasi ke versi sebelumnya.
- Migrasikan record `productivity_plans` existing sebagai baseline melalui tanggal efektif yang ditentukan saat migrasi; jangan mengarang tanggal historis.
- Buat resolver bersama `getEffectiveProductivityPlan(planningType, operationalDate)` dan gunakan pada semua consumer.
- Tambahkan selector Tanggal Berlaku, status versi aktif/warisan, riwayat, serta alur **Buat Versi Periode**.
- Tambahkan builder `Fleet → Material → Scenario` dari catalog flat existing.
- Ubah tombol menjadi **+ Tambah Fleet** dan buat selector Excavator dari List Equipment.
- Render daftar accordion fleet tertutup secara default.
- Migrasikan tampilan existing tanpa mengubah `tableId`/`planRef`.

### P1 — Material workspace

- Render semua material Parameter pada setiap fleet.
- Tambahkan Material Overview, Material Detail, dan **+ Tambah Skenario**.
- Pisahkan field source-of-truth read-only dari parameter scenario editable.
- Tambahkan slicer multi-filter Class Unit, dropdown checklist unit, pencarian, selected chips per class, serta `Number of Truck` read-only.
- Simpan ID unit aktual, izinkan pemakaian unit yang sama antar-scenario, dan cegah duplikasi ID hanya di dalam scenario yang sama.
- Implementasikan kalkulasi fleet heterogen setelah keputusan formula disetujui.
- Pertahankan formula OB/Coal dan autosave existing.

### P2 — Highlight dan UX enterprise

- Implementasikan matriks Fleet Material Productivity.
- Tambahkan status kelengkapan, empty state, sticky header/kolom, overflow horizontal, keyboard navigation, dan tampilan layar kecil.
- Sinkronkan highlight, overview, dan detail secara real-time.

### P3 — Regression dan verifikasi

- Uji carry-forward tanpa membuat salinan fisik, perubahan pada periode baru, override tanggal yang sama, dan penyisipan backdate.
- Uji bahwa versi baru tidak mengubah target transaksi historis serta Input Ritase mengambil versi berdasarkan tanggal operasional.
- Uji optimistic concurrency, audit actor, dan rollback saat penyimpanan gagal.
- Uji migrasi planning lama dan refresh/persistence.
- Uji material tambah/rename/hapus.
- Uji satu dan beberapa scenario per Fleet × Material.
- Uji filter Class Unit, pencarian, pilih semua, hapus pilihan, unit nonaktif, ID duplikat, dan perhitungan otomatis Number of Truck.
- Uji pilihan class campuran, pemakaian unit/class yang sama antar-scenario, kapasitas kosong, dan kapasitas tidak konsisten.
- Uji satuan serta density Coal.
- Uji kompatibilitas catalog lama/baru dengan Fleet Capacity, Unit Mapping, Input Ritase, dan Data Produksi.
- Uji autosave success/failure/re-entry serta responsive layout.

## Dampak arsitektur

- Membutuhkan perluasan formula jika satu scenario memilih kapasitas/class Dump Truck yang berbeda; formula existing tidak boleh dipakai seolah-olah seluruh unit homogen.
- Membutuhkan migrasi database karena tabel `productivity_plans` saat ini memakai `planning_type` sebagai primary key dan selalu menimpa satu record OB/Coal.
- Endpoint planning harus menerima tanggal operasional/effective date dan mengembalikan `sourceEffectiveFrom`, status inherited/exact, revision, serta snapshot planning.
- Resolver versi harus berada di backend/application service dan digunakan bersama oleh UI planning, Fleet Catalog, Input Ritase, Fleet Capacity, Unit Mapping, serta Data Produksi.
- Catalog flat tetap dapat dipertahankan di dalam snapshot versi untuk kompatibilitas, tetapi consumer tidak boleh lagi mengambil record terbaru tanpa tanggal.
- Otorisasi tetap mengikuti endpoint Productivity Planning admin yang ada.
- Audit minimal menyimpan actor, waktu, versi sebelumnya, effective date, dan ringkasan perubahan.
- Skema sekarang belum membawa `tenant_id/project_id` pada data planning; migrasi tidak boleh menerima scope dari frontend dan harus mengikuti scope server-side ketika boundary tenant/project tersedia.

## Keputusan yang dikunci dalam rancangan

- Satu parent fleet per excavator per planning type.
- Material berasal dari Parameter, bukan teks bebas di scenario.
- Satu material dapat memiliki banyak scenario.
- Satu scenario dapat menggunakan beberapa Class Unit.
- Kode unit dan Class Unit yang sama dapat digunakan kembali pada scenario lain.
- Number of Truck selalu merupakan jumlah unit aktual yang dipilih, bukan input manual.
- Identitas pilihan menggunakan `equipment_id`; kode unit hanya snapshot/label.
- Scenario tidak pernah dirata-ratakan.
- Flat `fleetCatalog` dipertahankan untuk kompatibilitas integrasi.
- Nilai highlight adalah ringkasan read-only, bukan sumber formula baru.
- Setup menggunakan effective date; versi terakhir otomatis berlaku ke periode berikutnya sampai ada perubahan baru.
- Membuka periode tanpa perubahan tidak membuat duplikat data.
- Input Ritase dan consumer lain selalu meresolusikan versi dari tanggal operasional.
- Versi planning historis dan snapshot transaksi tidak boleh dihitung ulang oleh perubahan periode baru.

## Keputusan formula fleet heterogen — disetujui

**Temuan:** formula sekarang menghitung Truck Productivity menggunakan satu `dumpTruckCapacity`, kemudian mengalikannya dengan `numberOfTruck`. Formula tersebut tidak mewakili satu scenario berisi truck dengan kapasitas berbeda.

Hitung setiap unit terpilih menggunakan kapasitas aktualnya dari List Equipment, lalu jumlahkan kemampuan seluruh truck. Secara konseptual:

```text
Truck Productivity Fleet = Σ Truck Productivity per unit
Fleet Productivity = minimum(Loader Productivity, Truck Productivity Fleet)
```

Untuk setiap unit, Number of Pass, Loading Time, dan Truck Cycle Time dihitung dari kapasitas unit tersebut dengan input jarak/kecepatan/efisiensi scenario yang sama. OB tetap menghasilkan `BCM/Hr`; Coal dikonversi menggunakan density material menjadi `Ton/Hr`. Presisi penuh disimpan dan pembulatan hanya untuk tampilan.

Kapasitas rata-rata atau kapasitas unit pertama tidak digunakan karena hasil dapat berubah akibat urutan pilihan dan tidak mewakili komposisi fleet aktual.

Status formula fleet heterogen: **DISETUJUI pemilik proyek pada 16 September 2026; siap menjadi acuan implementasi**.
