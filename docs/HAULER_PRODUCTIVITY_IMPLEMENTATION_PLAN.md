# Hauler Productivity — Implementation Recommendation

Status: **KONTRAK OPERASIONAL v8: LOADER PRODUCTIVITY MENJADI TARGET / SETTING FLEET HANYA SIMULASI SESI / belum dideploy**
Disusun: 16 September 2026

## Kontrak operasional v8 — Loader sebagai target langsung (29 September 2026)

- **Loader Productivity** pada versi efektif OB/Coal adalah satu-satunya sumber target productivity operasional. Input Ritase, Fleet Capacity, Unit Mapping, Fleet Deployment baru, dan kalkulasi ranking membaca nilai Loader berdasarkan tanggal, JOB, unit excavator, material, serta satuan yang sesuai.
- Properti `fleetProductivity` tetap tersedia hanya sebagai alias kompatibilitas API dan nilainya sama dengan `loaderProductivity`; sistem tidak lagi memakai `MIN(Loader, Truck Fleet)` sebagai target operasional.
- **Hauler Productivity** tetap menjadi database target Dump Truck/Driver untuk Leader Board dan referensi simulasi.
- **Setting Fleet Simulation** bersifat sementara pada sesi browser: tidak mempunyai periode efektif, tidak ikut payload simpan, dan tidak menjadi sumber modul lain. Refresh halaman menghapus hasil simulasi.
- Snapshot Fleet Deployment yang sudah dipublikasikan tidak ditulis ulang. Deployment baru mengambil snapshot Loader Productivity sehingga histori audit tetap utuh.
- Payload planning aktif dinaikkan ke versi `8` dengan `loaderCatalog`; pembacaan `fleetCatalog` lama hanya menjadi fallback migrasi jika record memiliki `loaderProductivity`, bukan hasil Setting Fleet.

Bagian v6 dan v5 di bawah dipertahankan sebagai histori implementasi dan bukan kontrak operasional saat ini.

## Implementasi v6 — pemisahan database Loader dan Setting Fleet (17 September 2026)

- **Loader Productivity** menyimpan satu record per excavator + material per versi efektif OB/Coal. Satu record dapat dihubungkan ke lebih dari satu JOB SPO. Jarak dan truck bukan bagian identitas Loader; backend menolak duplikat excavator + material.
- Kartu Loader hanya menampilkan kapasitas bucket, fill factor, swell factor, cycle time, efisiensi loader, JOB terkait, formula, dan Loader Productivity. Empat kartu muat pada desktop 1440 px; layout menyesuaikan layar sempit.
- **Hauler Productivity** tetap menjadi database input per excavator + truck + material dan jarak 500–2000 meter; tidak menjadi actual production.
- **Setting Fleet** menyimpan kombinasi Loader record + JOB SPO, jarak acuan, serta daftar Dump Truck. Target `Fleet Productivity = MIN(Loader Productivity, jumlah productivity truck terpilih)` dihitung ulang di backend dan dipublikasikan dalam `fleetCatalog` untuk Input Ritase dan JPEG Lapor.
- Versi payload `6` dengan penanda payload `loader-fleet-database-v1`, Loader `loader-productivity-v1`, dan hasil Fleet `fleet-hauler-database-v2` memakai tabel versi efektif dan audit yang sudah ada; tidak ada migrasi database baru. Data v4/v5 dinormalisasi ke Loader + Setting Fleet ketika dibuka di editor, tanpa mengubah histori tersimpan.
- Verifikasi lokal: 113 tes backend dan 17 tes terarah lulus; browser fixture memperlihatkan empat kartu sejajar, dua JOB untuk satu Loader, target Fleet terhitung, tersimpan dan tetap ada setelah refresh, tanpa warning/error console. Simpan melalui API produksi terautentikasi dan deployment v6 belum diverifikasi.

Bagian v5 di bawah merupakan histori implementasi, bukan kontrak tampilan terbaru.

Implementasi terbaru tersedia sebagai mode **Hauler Productivity** pada masing-masing halaman OB dan Coal. Matriks jarak 500–2000 meter per 100 meter sekarang memakai input per excavator, Dump Truck, dan material. Bagian rencana di bawah section implementasi terbaru mencatat rancangan awal Material + Class + Model untuk histori keputusan; verifikasi perilaku saat ini tetap harus memakai repository.

## Implementasi database periode terbaru (16 September 2026)

- Fleet per excavator dan material hanya boleh satu pada setiap versi OB/Coal; backend menolak duplikat meski JOB, truck, atau jaraknya berbeda.
- Parameter hauling berada di baris Hauler yang dikunci dengan `loaderId + truckId + material`; kapasitas per rit dan satuannya menjadi input operasional. Ini tidak mengubah kapasitas master List Equipment.
- Loading Time diturunkan dari capacity volume truck, bucket efektif excavator, dan Cycle Time Loading. Hasil tidak tersedia ketika sumbernya belum lengkap.
- Jarak acuan target dipilih pada tampilan Hauler per excavator/material, 500–2000 meter interval 100 meter.
- Fleet Productivity tetap `MIN(Loader Productivity, jumlah productivity truck terpilih)`. Backend menghitung ulang hasil authoritative dan menyimpannya pada `fleetCatalog` versi efektif yang dikonsumsi Input Ritase serta laporan JPEG.
- Versi payload `5` dan formula `fleet-hauler-database-v2` disimpan pada `productivity_plan_versions.data_json`, memakai revision dan audit yang sudah ada. Tidak diperlukan tabel/migrasi baru untuk perubahan ini.
- UI memindahkan input capacity, speed, Spot & Dump, dan Work Efficiency ke matriks Hauler; panel Input Cepat menerapkan field yang dipilih pada unit dalam filter aktif.
- Data payload versi 4 yang dibuka di editor dinormalisasi ke model baru saat penyimpanan berikutnya; target lama tetap tersimpan di histori versi sebelumnya.
- Verifikasi: 112 tes backend, 19 tes dashboard terarah, dan browser fixture lokal untuk kartu Fleet serta tabel Hauler. Production deployment belum dijalankan untuk perubahan ini.

Catatan historis: sebelum payload v5, Profile Hauler merupakan referensi tersendiri. Pada implementasi v5, baris Hauler yang dipilih Fleet justru menjadi sumber resmi Truck Fleet Productivity dan target Fleet; angka ini tetap tidak menggantikan produksi aktual dari ritase.

## Tujuan

Menyediakan matriks produktivitas teoritis per unit Dump Truck/Hauler, material, dan jarak angkut sehingga user dapat membandingkan kemampuan unit secara konsisten sebelum menyusun Fleet Planning.

Fitur ini merupakan planning/reference tool. Nilainya bukan actual production dan tidak boleh menggantikan data ritase aktual.

## Sumber data

- Unit: seluruh equipment kategori Dump Truck/Hauler yang masih tercatat pada List Equipment, baik aktif maupun nonaktif, dengan status yang terlihat jelas. Default filter menampilkan unit aktif; user dapat memilih **Semua Status**.
- Kode unit, Class Unit, tipe/model, status, kapasitas, dan satuan kapasitas: List Equipment.
- Material OB dan Coal: Parameter pada OB Productivity Planning dan Coal Productivity Planning.
- Bucket Fill Factor dan Swell Factor tetap milik konteks loader/fleet; tidak dipakai langsung untuk mengubah kapasitas hauler tanpa formula yang disetujui.
- Coal Density: Parameter Coal (`Ton/BCM`).
- Parameter operasi hauler: profile terstruktur yang diinput user, dengan sumber dan versi formula tersimpan.

## Navigasi

Tambahkan fitur **Hauler Productivity** pada kelompok Mine Planning. Halaman awal memiliki:

- judul, penjelasan singkat, status autosave;
- material selector/tabs;
- slicer Class Unit;
- slicer tipe/model;
- pencarian kode unit;
- filter kelengkapan data;
- tombol **Parameter Hauler**;
- matriks productivity.

Material ditampilkan satu per satu agar tabel tidak menjadi terlalu lebar. User dapat berpindah material melalui tabs/dropdown tanpa kehilangan filter unit.

## Matriks utama

Baris tetap:

- kode unit;
- Class Unit;
- tipe/model;
- kapasitas dan UoM;
- status aktif/nonaktif;
- status kelengkapan parameter.

Kolom jarak default menggunakan integer meter sebagai nilai internal:

```text
500, 600, 700, 800, 900,
1000, 1100, 1200, 1300, 1400,
1500, 1600, 1700, 1800, 1900, 2000 meter
```

Label UI ditampilkan `0,5 km` sampai `2,0 km` dengan interval `0,1 km`. Integer meter mencegah error floating-point sebagai key data.

Setiap sel menampilkan Hauler Productivity per unit:

- material OB: `BCM/Hr`;
- material Coal: `Ton/Hr`;
- data tidak lengkap: `—`, bukan nol;
- tooltip: cycle time, kapasitas, loading time, loaded/empty speed, spot & dump, work efficiency, density, formula version, dan sumber parameter.

Kolom identitas unit dibuat sticky. Header jarak sticky dan area matriks mempunyai horizontal scroll. Untuk layar sempit, user dapat memilih rentang jarak atau menampilkan hanya beberapa kolom favorit.

## Parameter Hauler

Parameter dipisahkan secara tegas:

### Read-only dari master

- Equipment ID;
- kode unit;
- Class Unit;
- tipe/model;
- kapasitas unit;
- satuan kapasitas;
- status aktif.

### Read-only dari material

- material;
- density untuk Coal;
- satuan output.

### Editable sebagai profile operasi

- Loading Time (menit);
- Loaded Speed (km/jam);
- Empty Speed (km/jam);
- Spot & Dump Time (menit);
- Work Efficiency Hauler (rasio 0–1).

Jarak tidak disimpan berulang per unit karena berasal dari header matriks. Parameter editable dapat dikelola sebagai profile `Material + Class Unit + Tipe/Model`, kemudian diwariskan ke unit yang cocok. Unit override hanya disediakan jika benar-benar diperlukan dan harus diberi indikator **Override** serta alasan perubahan.

Pendekatan profile menghindari input parameter yang sama puluhan kali sekaligus tetap mendukung unit khusus.

## Formula

Formula mengikuti komponen Truck Productivity yang sudah digunakan OMOS:

```text
Travel Loaded Time (min) = distance_km / loaded_speed_kmh × 60
Travel Empty Time  (min) = distance_km / empty_speed_kmh × 60

Truck Cycle Time (min) =
  loading_time
  + travel_loaded_time
  + travel_empty_time
  + spot_dump_time

Hauler Productivity =
  60 / truck_cycle_time
  × effective_capacity
  × work_efficiency
```

Konversi material:

- kapasitas `BCM`: OB menggunakan kapasitas langsung;
- kapasitas `BCM` untuk Coal: `Ton/Hr = BCM/Hr × density (Ton/BCM)`;
- kapasitas `Ton` untuk Coal: gunakan kapasitas ton langsung dan jangan kalikan density lagi;
- kapasitas `Ton` untuk OB tidak dapat dikonversi ke BCM tanpa density OB yang sah; tampilkan incomplete;
- kapasitas/UoM kosong atau tidak dikenal tidak boleh diasumsikan sebagai BCM.

Presisi penuh dipertahankan dalam perhitungan. UI membulatkan maksimal dua desimal.

### Catatan operasional penting

Loading Time bergantung pada kombinasi loader, material, dan kondisi operasi. Karena fitur ini berdiri per hauler, angka tersebut harus ditampilkan sebagai **asumsi profile**, bukan karakteristik permanen unit. Jika nanti profile dihubungkan ke Fleet Scenario tertentu, sumber loader/scenario harus ikut disimpan.

## UX profesional dan informatif

### Ringkasan atas

- total Dump Truck;
- unit siap dihitung;
- unit incomplete;
- productivity minimum/median/maksimum pada jarak yang sedang disorot;
- material dan satuan aktif;
- waktu pembaruan terakhir.

### Interaksi

- klik sel membuka panel rincian formula;
- klik baris membandingkan kurva productivity unit terhadap jarak;
- user dapat memilih maksimal beberapa unit untuk mode Compare;
- pencarian kode unit dan filter Class/model selalu tersedia;
- tombol reset filter;
- empty/error/loading state yang jelas;
- autosave memakai `OMOSActionFeedback` serta mengunci submit untuk mencegah double click.

### Visual

- gunakan data bars atau gradasi biru netral untuk menunjukkan besar nilai;
- jangan memakai hijau/merah sebagai status pencapaian karena matriks ini belum mempunyai target;
- gunakan merah hanya untuk error data dan kuning untuk parameter incomplete/override;
- freeze kolom Unit, Class, Model, dan Capacity.

## Integrasi

- OB/Coal Fleet Workspace menampilkan profile Hauler pada versi periode yang sama, tetapi parameter scenario tetap diset manual. Integrasi profile sebagai sumber default scenario memerlukan keputusan eksplisit untuk armada heterogen; sistem tidak merata-ratakan profile berbeda secara implisit.
- Nilai scenario tetap dihitung/snapshot pada `planRef` agar perubahan profile berikutnya tidak diam-diam mengubah histori Input Ritase.
- Fleet Capacity dan Unit Mapping membaca daftar ID unit serta Class Unit eksplisit.
- Data Produksi tetap memakai actual ritase dan Truck Factor; matriks Hauler tidak menjadi actual production source.

## Penyimpanan dan audit

Untuk implementasi awal, profile Hauler disimpan sebagai bagian dari versi efektif OB/Coal yang relevan. Dengan demikian material, Coal Density, scenario, profile Hauler, formula version, dan tanggal berlaku tetap berada pada satu snapshot yang konsisten. Endpoint tidak menerima planning type bebas.

Payload minimal:

- `version`;
- `formulaVersion`;
- rentang jarak default dalam meter;
- profiles per material/class/model;
- unit overrides beserta alasan;
- snapshot identity material dan density;
- `updatedAt` dari server.

API tetap berada di router admin dengan autentikasi dan otorisasi server. Skema current belum mempunyai `tenant_id/project_id`; fitur tidak boleh menerima scope tersebut hanya dari frontend dan tidak memperluas boundary database client saat ini.

Untuk tahap enterprise berikutnya, tambahkan histori versi/audit append-only sebelum fitur dipakai sebagai basis approval formal.

## Data quality rules

- Kode unit wajib unik mengikuti List Equipment.
- Kapasitas harus positif dan mempunyai UoM eksplisit.
- Kecepatan harus positif.
- Loading Time dan Spot & Dump tidak boleh negatif.
- Work Efficiency berada pada rentang `0 < value ≤ 1`.
- Coal Density harus positif.
- Parameter incomplete tidak menghasilkan angka nol semu.
- Unit nonaktif tetap terlihat pada matriks dan plan tersimpan dengan badge status, tetapi tidak digunakan untuk membuat profile/assignment operasional baru. Unit soft-deleted hanya dipertahankan melalui snapshot historis dan tidak ditampilkan sebagai unit current.
- Perubahan sumber master ditandai agar user dapat meninjau kembali hasil.

## Tahapan implementasi

### P0 — Core dan kontrak data

- Tambahkan pure calculation module untuk cycle time dan hauler productivity.
- Tambahkan unit/UoM validation serta coal conversion.
- Tambahkan structured planning payload dan backend allowlist `hauler`.
- Tambahkan unit test formula, boundary, missing source, dan precision.

### P1 — Parameter profile

- Buat Material/Class/Model profile editor.
- Unit override tidak diaktifkan pada implementasi awal; profile tetap dikendalikan pada level Material + Class + Model untuk mencegah parameter liar per unit.
- Integrasikan material OB/Coal dan List Equipment.
- Tambahkan autosave/feedback standar.

### P2 — Matriks dan usability

- Render semua Dump Truck dengan matriks jarak 500–2000 meter per 100 meter.
- Tambahkan material tabs, slicer, search, sticky context, tooltip, detail drawer, dan responsive overflow.
- Tambahkan summary quality dan mode compare.

### P3 — Integrasi dan verifikasi

- Integrasikan profile ke Fleet Workspace dengan snapshot pada scenario.
- Regression Fleet Capacity, Unit Mapping, Input Ritase, dan Data Produksi.
- Uji layar rendah, keyboard, refresh/persistence, request failure, dan double-submit.
- Verifikasi browser → API → database serta audit source/formula version.

## Rekomendasi pengembangan lanjutan

- rentang jarak configurable dengan default tetap 500–2000 meter;
- grafik kurva productivity vs distance untuk unit yang dibandingkan;
- ekspor Excel dengan parameter assumptions dan formula version;
- effective-date profile agar perubahan mendatang tidak mengubah plan periode sebelumnya;
- scenario simulation untuk road condition atau kecepatan berbeda;
- data-quality dashboard untuk kapasitas/UoM/master equipment yang belum lengkap.

## Batas implementasi

- Tidak mengubah actual ritase atau Truck Factor.
- Tidak mencampur `BCM/Hr` dan `Ton/Hr` dalam satu agregasi.
- Tidak menganggap nilai kosong sebagai nol.
- Tidak menggunakan formula AI; seluruh kalkulasi deterministik dan dapat diaudit.
- Kode aplikasi untuk core Hauler sudah tersedia; migrasi database dan verifikasi end-to-end belum dijalankan.

## Implementasi workspace v7 (2026-09-17)

- Pada tab OB, Capacity Hauler selalu BCM; pada tab Coal selalu Ton. Satu baris dibuat untuk setiap kombinasi Dump Truck × material Parameter pada excavator aktif. Loading Time tetap hasil perhitungan, bukan input manual.
- Nilai Coal lama dengan UoM BCM dikonversi ke Ton menggunakan density material saat versi lama dimuat; nilai asal disimpan sebagai `sourceCapacityBcm`. Nilai lama tanpa UoM eksplisit tidak ditebak atau dipakai sebagai angka target lengkap. Histori versi lama tidak ditulis ulang.
- Header jarak dapat ditambah/hapus dengan kelipatan 100 meter, dibatasi 500–50.000 meter dan 80 kolom. Header yang sedang menjadi acuan Setting Fleet tidak bisa dihapus.
- Input Hauler pada excavator aktif dapat disalin ke excavator lain berdasarkan pasangan unit Dump Truck + material. Penempelan meminta konfirmasi sebelum menimpa input tujuan; Loading Time dihitung ulang menurut excavator tujuan.
- Setup OB/Coal menggunakan versi tanggal efektif: data terakhir dibaca otomatis pada hari berikutnya hingga akhir periode SPO deployed. Simpan hanya muncul setelah perubahan, dan perpindahan periode/halaman maupun refresh menampilkan pengingat bila belum disimpan. Tombol Riwayat dan Buat Versi Periode tidak ditampilkan; riwayat versi/audit backend tetap ada.
- Tombol Note menjelaskan pewarisan dan contoh perubahan tanggal. Label versi menjadi “Data periode ini update dari [tanggal]”. Tidak ada migrasi skema baru pada tahap ini.
- Batasan yang masih perlu verifikasi produksi: periode SPO berbasis `endYear` tabel deployed (akhir 31 Desember), sehingga perlu audit data SPO live; browser fixture lokal tidak menggantikan API/DB produksi terautentikasi.
