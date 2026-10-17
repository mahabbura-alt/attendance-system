# Rencana Implementasi Productivity Report Ranking

Status: **IMPLEMENTED — selesai 24 September 2026 (9 keputusan §12 dikunci owner)**
Implementasi: core murni `productivityRankingCore.js` + domain service
`productivityRanking.js` (satu domain result untuk ranking & Data Control);
endpoint lama diganti kontrak baru + `GET .../data-control` (paginasi, filter
server-side, sort); frontend 2 tab (Ranking 2×2 + Data Control 6 subtab,
highlight hyperlink, drawer lineage); DW exclude per segmen
(`NON_PRODUCTION_JOB_DW`). Tanpa migrasi baru (P2: tabel kecil, seq scan cost
rendah — indeks eksisting cukup). Browser review lokal selesai; deploy menunggu
owner.
Tanggal: 24 September 2026
Modul: Mining Production → 9. Productivity Report

Pembaruan desain: **Data Control, hyperlink highlight, dan exclusion JOB DW**.

### Audit implementasi 24 September 2026

Kesesuaian yang sudah diverifikasi terhadap rencana:

- filter periode, area, JOB, jenis planning, dan material dipakai bersama oleh
  Ranking dan Data Control;
- empat ranking, Gross sebagai basis utama, Net sebagai informasi sekunder,
  HM, expected production berbobot, Loader/Hauler plan efektif, Truck Factor,
  pemisahan OB/Coal, atribusi operator/driver, dan exclusion JOB DW dihitung di
  backend authoritative;
- Data Control memiliki filter/paginasi server-side, reason code, lineage
  drawer, impact highlight, dan hyperlink highlight menuju hasil terfilter;
- unit/JOB/material yang belum lengkap tidak diranking sebagai 0%; dan
- perbaikan runtime browser memastikan modul tidak lagi gagal dengan pesan
  `global is not defined`.

Deviasi yang masih terbuka dan tidak memblokir kalkulasi utama:

- PIT/Area, JOB, dan Material masih berupa pencarian teks, belum dropdown dari
  master authoritative;
- subtab `Riwayat Proses` baru menunjukkan metadata kalkulasi terakhir pada
  sesi halaman, belum merupakan histori snapshot persisten;
- kartu highlight ditampilkan pada tab Ranking; tab Data Control baru memiliki
  ringkasan teks kesiapan, belum deretan kartu highlight tersendiri;
- endpoint Data Control memfilter dan memaginasi di server, tetapi domain rows
  masih disusun di memori sebelum pagination sehingga perlu evaluasi indeks /
  materialized snapshot bila volume multi-project tumbuh besar; dan
- validasi rekonsiliasi terhadap data produksi aktual serta deploy production
  masih menunggu tahapan release terpisah.

## 1. Tujuan

Mengubah halaman Productivity Report menjadi leaderboard produktivitas berbasis
range periode, JOB, material, plan efektif, produksi aktual Input Ritase, dan HM
Input Data. Halaman menyediakan empat ranking:

1. Top 10 Excavator Productivity;
2. Top 10 Dump Truck Productivity;
3. Top 10 Operator Excavator Productivity;
4. Top 10 Driver DT Productivity.

Halaman juga menyediakan fitur **Data Control** sebagai lapisan rekonsiliasi
read-only sebelum leaderboard. Data Control menyajikan dataset pembentuk ranking
yang sudah dipisahkan menurut periode, PIT/Area, JOB, jenis produksi, material,
unit/personel, status validasi, dan reason code. Tujuannya agar pengguna tidak
perlu memeriksa Input Ritase, Input Data, Planning, dan Truck Factor satu per satu.

Ranking tidak lagi memakai total volume mentah dari kolom legacy
`ritase_logs.production_volume`. Backend harus menghitung ulang data authoritative
dari Ritase, Truck Factor, planning efektif, dan HM.

## 2. Kondisi Implementasi Eksisting

Endpoint eksisting:

```text
GET /api/admin/production/productivity-report
```

Kekurangan implementasi sekarang:

- tidak menerima range tanggal;
- tidak memfilter PIT/Area, JOB, kategori, atau material;
- hanya menjumlahkan `ritase_logs.production_volume`;
- `production_volume` bukan lagi sumber utama pada grid Input Ritase baru;
- belum menggunakan Truck Factor efektif;
- belum memperhitungkan Non Prod / Inpit;
- belum mengambil HM dari Input Data;
- belum membaca Loader/Hauler Productivity versi efektif;
- belum memisahkan BCM dan Ton;
- query operator masih bergantung pada `ritase_logs.operator_id`, sedangkan grid
  Ritase baru tidak menjadikannya sumber operator authoritative;
- frontend hanya merender ranking Excavator dan Dump Truck;
- angka yang ditampilkan masih volume `BCM/MT`, bukan achievement productivity.

Endpoint lama perlu diganti secara kompatibel dengan kontrak response baru,
bukan ditambah dengan kalkulasi paralel di browser.

## 3. Kontrak Formula

### 3.1 Gross dan net production

Permintaan ranking memasukkan Non Prod. Karena Non Prod pada Input Ritase secara
resmi tidak dihitung sebagai produksi terhitung/dibayar, dua metrik harus tetap
dipisahkan:

```text
Gross Ritase = ritase_count
Net Ritase   = ritase_count - nonprod_ritase_count

Gross Volume = Gross Ritase × Truck Factor efektif
Net Volume   = Net Ritase × Truck Factor efektif
```

Ketentuan:

- ranking utama menggunakan **Gross Productivity Achievement**;
- nilai Gross memasukkan Non Prod sesuai permintaan;
- Net Productivity ditampilkan sebagai informasi sekunder;
- Input Ritase, JPEG Lapor, Data Produksi, Fuel Ratio, dan produksi dibayar tetap
  menggunakan formula net yang sudah berlaku;
- implementasi ranking tidak boleh mengubah transaksi atau angka produksi resmi.

### 3.2 Actual productivity

HM diperlukan pada seluruh leaderboard agar angka tetap berdimensi productivity:

```text
Gross Actual Productivity = Σ Gross Volume / Σ HM
Net Actual Productivity   = Σ Net Volume / Σ HM
```

Satuan:

- OB: BCM/Hr;
- Coal: Ton/Hr.

### 3.3 Plan dan achievement kumulatif

Jangan menjumlahkan atau merata-ratakan persentase harian. Gunakan expected
production sebagai denominator:

```text
Expected Production = Σ (Plan Productivity efektif × HM terkait)

Gross Achievement (%) =
  Σ Gross Volume / Σ Expected Production × 100

Net Achievement (%) =
  Σ Net Volume / Σ Expected Production × 100

Weighted Plan Productivity =
  Σ (Plan Productivity efektif × HM terkait) / Σ HM
```

Semua kalkulasi antara mempertahankan presisi penuh. Pembulatan hanya dilakukan
pada response display atau frontend.

### 3.4 Formula version

Response harus membawa versi formula yang eksplisit, misalnya:

```text
productivity-ranking-gross-v1
operator-volume-hm-share-v1
```

### 3.5 Exclusion JOB DW

Kode JOB `DW` adalah pekerjaan rental/non-produksi dan tidak boleh menjadi HM
produksi. Aturan ini diterapkan pada granularitas **segmen Work Log**, bukan pada
unit secara keseluruhan:

- HM segmen dengan JOB kanonis `DW` tidak masuk `Σ HM` Actual Productivity;
- HM `DW` tidak membentuk Expected Production atau Weighted Plan Productivity;
- HM `DW` tidak digunakan untuk alokasi volume Operator Excavator maupun Driver DT;
- segmen `DW` tidak masuk keempat leaderboard;
- segmen `DW` tetap ditampilkan pada Data Control dengan status `Dikecualikan`
  dan reason code `NON_PRODUCTION_JOB_DW`;
- jika unit yang sama bekerja pada `OB`/`CG` dan `DW` dalam satu shift, hanya
  segmen HM `OB`/`CG` yang dihitung; HM `DW` tidak boleh mengurangi atau
  mendilusi productivity JOB produksi;
- HM `DW` tidak boleh dipindahkan atau dijadikan fallback untuk JOB produksi
  walaupun unit, tanggal, dan shift cocok.

Dengan demikian, formula aktual tetap:

```text
Gross Actual Productivity = Σ Gross Volume produksi / Σ HM produksi non-DW
Net Actual Productivity   = Σ Net Volume produksi / Σ HM produksi non-DW
```

## 4. Sumber Data Authoritative

### 4.1 Plan Excavator

Sumber:

- halaman 0.5 OB Productivity Planning untuk JOB kategori OB;
- halaman 0.6 Coal Productivity Planning untuk JOB kategori Coal;
- `Loader Productivity` pada versi planning efektif tanggal operasional.

Kunci pencocokan:

```text
tanggal efektif + excavator + JOB kanonis + material + planning type
```

Digunakan oleh:

- Top 10 Excavator;
- Top 10 Operator Excavator.

### 4.2 Plan Dump Truck

Sumber:

- parameter baris unit dari tab `Hauler Productivity` pada halaman planning OB
  atau Coal;
- versi planning efektif pada tanggal operasional;
- tab kode excavator yang sama dengan excavator aktual yang melakukan loading;
- header jarak yang sama dengan jarak aktual fleet;
- material, kapasitas, density, loading time otomatis, speed, spot/dump time, dan
  work efficiency yang berlaku pada versi tersebut.

Kunci pencocokan:

```text
tanggal efektif + planning type + excavator aktual + dump truck + material + jarak aktual
```

Digunakan oleh:

- Top 10 Dump Truck;
- Top 10 Driver DT.

Total Truck Fleet Productivity tidak boleh dipakai sebagai plan satu Dump Truck.
Keanggotaan Dump Truck pada `Setting Fleet` tidak menjadi syarat plan ranking;
`Setting Fleet` tetap digunakan oleh workflow penyusunan armada, bukan sebagai
gate database Hauler.

### 4.3 Produksi aktual

Sumber:

- `fleet_mappings` untuk tanggal, shift, excavator, PIT/Area, JOB, material,
  kategori OB/Coal, dan jarak;
- `ritase_logs` untuk Dump Truck, jam, ritase bruto, dan Non Prod;
- `truck_factors` efektif pada tanggal operasional berdasarkan kategori, tipe
  unit, dan material.

Aturan agregasi:

- produksi Excavator adalah jumlah volume seluruh DT pada fleet tersebut;
- produksi satu DT hanya berasal dari baris ritase DT tersebut;
- produksi fleet tidak boleh digandakan ke setiap DT;

### 4.4 Alur Data Control dan ranking

`Data Control` adalah dataset rekonsiliasi yang dibentuk lebih dahulu dari
sumber authoritative. Setiap baris Productivity menampilkan:

Sebelum rekonsiliasi, sistem membentuk scope JOB dari konfigurasi SPO yang
berstatus **deployed**. Hanya unit dan personel dengan JOB kanonis yang terdapat
dalam scope tersebut yang boleh membentuk baris Data Control, baik untuk
Productivity maupun Fuel Ratio. JOB yang hanya tersedia di Master JOB, masih
draft di SPO, sudah tidak deployed, atau tidak dapat dipetakan ke kode kanonis
harus dikeluarkan sebelum kalkulasi kualitas data dan ranking. Jika SPO tidak
memiliki JOB deployed, dataset harus kosong dan sistem tidak boleh fallback ke
seluruh Master JOB. Metadata API membawa `job_scope=spo_deployed_only` dan daftar
`deployed_jobs` agar keputusan scope dapat diaudit.

```text
PDTY aktual = Produksi bruto baris / HM baris
```

Jika HM nol atau belum tersedia, PDTY tetap kosong dan baris tidak diubah
menjadi nilai nol semu. `Productivity Ranking` hanya mengelompokkan baris Data
Control sesuai entity, JOB, dan material, lalu menggunakan agregasi berbobot HM:

```text
PDTY periode = Σ Produksi / Σ HM
Plan berbobot = Σ (Plan baris × HM baris) / Σ HM
Achievement = Σ Produksi / Σ (Plan baris × HM baris) × 100%
```

`Fuel Ratio Ranking` juga dibentuk dari Data Control Fuel Ratio. Basisnya
dibedakan secara dimensional menurut jenis equipment:

```text
Excavator / Operator Excavator = Σ Liter / Σ BCM produktif
Dump Truck / Driver DT         = Σ Liter / Σ Km aktual odometer
```

Dengan demikian ranking tidak merata-ratakan persentase, PDTY harian, ataupun
Fuel Ratio harian secara aritmetika. Jarak DT berasal dari
`fuel_logs.distance_km`, yaitu delta odometer tervalidasi pada Input Fuel;
jarak rencana Fleet dan jarak hauling per ritase bukan denominator Fuel Ratio.
Baris DT tanpa jarak positif tetap kosong dengan `MISSING_DISTANCE_KM`.
Jika satu Fuel Log dibagi ke lebih dari satu konteks produksi sementara jarak
tidak dialokasikan eksplisit, sistem menandainya
`AMBIGUOUS_DISTANCE_ALLOCATION` dan tidak memprorata KM secara diam-diam.
- Truck Factor hilang tidak boleh diubah menjadi nol secara diam-diam pada
  perhitungan produksi dan Excavator L/BCM;
- Truck Factor bukan denominator maupun prasyarat Dump Truck L/Km.

Urutan kartu personel:

- Top Operator/Driver Productivity: achievement tertinggi ke terendah;
- Top 10 Low Operator/Driver Productivity: achievement terendah ke tertinggi;
- Top 10 Low Operator Excavator Fuel Ratio: Fuel Ratio L/BCM terendah;
- Top 10 Low Driver DT Fuel Ratio: Fuel Ratio L/Km terendah.

Sel incomplete/ambiguous tetap tidak masuk kedua arah ranking. Kartu Low
Productivity memakai dataset, grain, dan formula weighted achievement yang sama;
yang berubah hanya arah pengurutan, bukan perhitungan KPI.

### 4.4 HM aktual

Sumber:

```text
mining_production_logs.total_hm
```

Kriteria dasar:

- `deleted_at IS NULL`;
- kode JOB kanonis terdapat pada daftar JOB SPO berstatus deployed;
- `total_hm` numerik dan tidak negatif;
- operator tersedia untuk ranking personel;
- tanggal operasional berada pada range inklusif;
- pencocokan memakai tanggal, shift, equipment, JOB kanonis, dan area bila
  tersedia;
- `job` kanonis bukan `DW`;
- Work Log yang telah disimpan user langsung sah sebagai denominator ranking,
  tanpa gate status `draft`/`submitted`;
- kelengkapan sumber tetap dinilai melalui reason code kualitas data, bukan status
  penyimpanan;
- Work Log `DW` masuk ringkasan exclusion Data Control, bukan missing-HM dan
  bukan denominator ranking.

## 5. Aturan Atribusi HM dan Volume

### 5.1 Unit Excavator

```text
Produksi = total Gross/Net Volume semua DT pada fleet excavator
HM       = total HM Input Data excavator pada konteks yang sama
Plan     = Loader Productivity efektif
```

### 5.2 Unit Dump Truck

```text
Produksi = Gross/Net Volume milik DT
HM       = total HM Input Data DT pada konteks yang sama
Plan     = Hauler Productivity individual DT
```

### 5.3 Operator Excavator

Operator berasal dari segmen Input Data excavator. Bila satu excavator memiliki
beberapa operator dalam konteks tanggal–shift–JOB yang sama, volume dialokasikan
secara proporsional terhadap HM:

```text
Volume Operator =
  Volume Excavator × HM Operator / Total HM Operator pada konteks tersebut
```

Expected production setiap operator tetap menggunakan plan Excavator × HM
operator.

### 5.4 Driver Dump Truck

Driver berasal dari segmen Input Data DT. Bila satu DT memiliki beberapa driver
pada konteks yang sama:

```text
Volume Driver =
  Volume DT × HM Driver / Total HM Driver pada konteks tersebut
```

Expected production setiap driver menggunakan plan DT × HM driver.

### 5.5 Material ambigu

Input Data saat ini memiliki JOB dan PIT/Area, tetapi belum selalu memiliki
material atau `fleet_mapping_id`. Bila satu unit pada tanggal–shift–JOB yang sama
cocok ke lebih dari satu material/fleet:

- jangan menyalin HM penuh ke setiap material;
- jangan melakukan pro-rata berdasarkan produksi tanpa penandaan;
- keluarkan record dari ranking resmi;
- tandai `HM_AMBIGUOUS_MATERIAL`;
- tampilkan jumlah dan detailnya pada panel kualitas data.

Pengembangan yang direkomendasikan adalah menambah `fleet_mapping_id` atau
`material_snapshot` pada segmen Input Data agar atribusi berikutnya menjadi
deterministik.

### 5.6 JOB non-produksi DW

Data Control melakukan klasifikasi JOB sebelum matching HM ke Ritase atau plan.
Setiap segmen `DW` dihentikan pada tahap klasifikasi dengan reason code
`NON_PRODUCTION_JOB_DW`. Sistem tidak mencoba mencarikan material, fleet, Loader
Plan, Hauler Plan, atau Truck Factor untuk segmen tersebut. Jumlah segmen, total
HM, unit, operator/driver, periode, dan PIT/Area tetap tersedia untuk audit.

## 6. Pemisahan OB dan Coal

BCM dan Ton tidak boleh dijumlahkan. Filter harus menyediakan:

- Range tanggal;
- PIT/Area;
- JOB;
- Jenis produksi: OB atau Coal;
- Material.

Bila pengguna memilih Semua Material, hasil harus dipisah per material dan
satuan. Sistem tidak boleh menghasilkan satu achievement gabungan dari volume
BCM dan Ton.

Default yang direkomendasikan:

- tanggal awal: awal bulan berjalan;
- tanggal akhir: hari operasional berjalan;
- jenis produksi: OB;
- JOB dan material: Semua, tetapi kartu tetap memisahkan material;
- range maksimum: 366 hari.

## 7. Kontrak API yang Direncanakan

```http
GET /api/admin/production/productivity-report
  ?tanggal_dari=YYYY-MM-DD
  &tanggal_sampai=YYYY-MM-DD
  &area=BEI
  &job=OB
  &planning_type=ob
  &material=CLAY
```

Data Control menggunakan kontrak paginated terpisah agar tabel audit tidak
memperbesar response leaderboard:

```http
GET /api/admin/production/productivity-report/data-control
  ?tanggal_dari=YYYY-MM-DD
  &tanggal_sampai=YYYY-MM-DD
  &area=BEI
  &job=OB
  &planning_type=ob
  &material=CLAY
  &entity_type=excavator
  &control_status=ready
  &reason_code=MISSING_HM
  &page=1
  &page_size=50
```

Endpoint ranking dan Data Control wajib memakai domain service serta formula
version yang sama. Data Control bukan kalkulasi paralel di frontend.

Struktur response:

```json
{
  "meta": {
    "tanggal_dari": "2026-09-01",
    "tanggal_sampai": "2026-09-30",
    "planning_type": "ob",
    "unit": "BCM/Hr",
    "production_basis": "gross_including_nonprod",
    "formula_version": "productivity-ranking-gross-v1"
  },
  "rankings": {
    "excavators": [],
    "dumpTrucks": [],
    "excavatorOperators": [],
    "dumpTruckDrivers": []
  },
  "quality": {
    "missingHm": 0,
    "missingPlan": 0,
    "missingTruckFactor": 0,
    "ambiguousMaterial": 0,
    "ritaseWithoutHm": 0,
    "hmWithoutRitase": 0,
    "excludedDwSegments": 0,
    "excludedDwHmHours": 0
  },
  "controlHighlights": [
    {
      "key": "ready",
      "label": "Siap Ranking",
      "count": 438,
      "impact_value": 12500,
      "impact_unit": "BCM",
      "filter": { "control_status": "ready" }
    },
    {
      "key": "excluded_dw",
      "label": "JOB DW Dikecualikan",
      "count": 12,
      "impact_value": 84.5,
      "impact_unit": "HM",
      "filter": {
        "control_status": "excluded",
        "reason_code": "NON_PRODUCTION_JOB_DW"
      }
    }
  ]
}
```

Struktur response Data Control:

```json
{
  "meta": {
    "formula_version": "productivity-ranking-gross-v1",
    "generated_at": "2026-09-24T14:32:00+07:00",
    "page": 1,
    "page_size": 50,
    "total_rows": 438
  },
  "summary": {
    "readiness_percentage": 92.6,
    "ready": 438,
    "excluded": 17,
    "missingPlan": 3,
    "missingHm": 8,
    "missingTruckFactor": 4,
    "ambiguousMaterial": 2,
    "excludedDwSegments": 12,
    "excludedDwHmHours": 84.5
  },
  "rows": [
    {
      "control_key": "stable-derived-key",
      "control_status": "ready",
      "reason_codes": [],
      "tanggal": "2026-09-16",
      "shift": "Shift Siang",
      "entity_type": "excavator",
      "entity_code": "EX30 350-14",
      "entity_name": null,
      "area": "BEI",
      "job": "OB",
      "material": "CLAY",
      "unit": "BCM/Hr",
      "plan_productivity": 150.73,
      "gross_volume": 1551,
      "net_volume": 1496,
      "hm_hours": 10,
      "actual_productivity": 155.1,
      "expected_production": 1507.3,
      "achievement_percentage": 102.9,
      "source_counts": {
        "ritaseRows": 50,
        "workLogSegments": 1,
        "planningVersions": 1,
        "truckFactors": 5
      }
    }
  ]
}
```

Struktur baris ranking:

```json
{
  "rank": 1,
  "entity_id": "uuid",
  "entity_code": "EX30 350-15",
  "entity_name": "Nama operator bila personel",
  "job": "OB",
  "material": "CLAY",
  "unit": "BCM/Hr",
  "gross_volume": 10000,
  "net_volume": 9500,
  "hm_hours": 60,
  "actual_productivity": 166.6667,
  "net_productivity": 158.3333,
  "weighted_plan_productivity": 150.73,
  "expected_production": 9043.8,
  "achievement_percentage": 110.57,
  "data_quality": "complete"
}
```

Backend adalah satu-satunya authority kalkulasi. Frontend hanya merender response.

## 8. Rekomendasi Tampilan

### 8.1 Header dan slicer

Di bawah judul tampilkan satu filter bar:

```text
[Tanggal Dari] [Tanggal Sampai] [PIT/Area] [JOB] [OB/Coal] [Material] [Tampilkan]
```

Tampilkan metadata kecil:

- formula version;
- basis Gross termasuk Non Prod;
- waktu data diperbarui;
- satuan aktif.

### 8.2 Grid ranking

Gunakan grid 2 × 2:

1. Top 10 Excavator Productivity;
2. Top 10 Dump Truck Productivity;
3. Top 10 Operator Excavator Productivity;
4. Top 10 Driver DT Productivity.

Setiap baris menampilkan:

- nomor ranking;
- kode unit atau nama personel;
- JOB dan material;
- achievement besar dalam persen;
- Gross Actual Productivity;
- Weighted Plan Productivity;
- Net Productivity sebagai nilai sekunder;
- Gross Volume dan total HM;
- badge kelengkapan data.

Conditional formatting:

- hijau: achievement ≥ 100%;
- kuning: 80% sampai < 100%;
- merah: < 80%;
- abu-abu: data tidak lengkap, tidak masuk ranking.

### 8.3 Panel kualitas data

Tambahkan highlight di atas leaderboard:

- HM belum cocok ke fleet/material;
- plan Loader/Hauler hilang;
- Truck Factor hilang;
- plan ambigu;
- ritase tanpa HM;
- HM tanpa ritase.
- JOB `DW` dikecualikan dari HM produksi.

Seluruh highlight wajib berupa hyperlink interaktif, bukan kartu informasi pasif.
Ketika diklik, aplikasi berpindah ke tab Data Control dan langsung menerapkan
filter yang bersesuaian. Contoh:

| Highlight | Filter tujuan |
| --- | --- |
| Siap Ranking | `control_status=ready` |
| Dikecualikan | `control_status=excluded` |
| Plan Hilang | `reason_code=MISSING_PLAN` |
| HM Hilang | `reason_code=MISSING_HM` |
| Truck Factor Hilang | `reason_code=MISSING_TRUCK_FACTOR` |
| Material Ambigu | `reason_code=HM_AMBIGUOUS_MATERIAL` |
| JOB DW Dikecualikan | `reason_code=NON_PRODUCTION_JOB_DW` |

Hyperlink harus mendukung keyboard, memiliki fokus yang terlihat, membawa
`aria-label`, dan tetap mempertahankan seluruh filter periode/konteks aktif.

### 8.4 Navigasi Productivity Report

Gunakan dua tab utama:

```text
[ Productivity Ranking ] [ Data Control ]
```

Filter periode, PIT/Area, JOB, jenis produksi, dan material berada di header
bersama sehingga konteks tidak berubah ketika pengguna berpindah tab.

### 8.5 Highlight Data Readiness

Tab Data Control menampilkan highlight berikut:

- Kesiapan Data (%);
- Siap Ranking;
- Dikecualikan;
- Plan Hilang;
- HM Hilang;
- Truck Factor Hilang;
- Material Ambigu;
- JOB DW Dikecualikan, termasuk total HM yang tidak masuk denominator.

Kesiapan Data tidak cukup dihitung dari jumlah baris. Response harus membawa
jumlah record dan nilai dampak (`impact_value` + `impact_unit`) agar pengguna
dapat memprioritaskan anomali bermuatan produksi/HM besar. BCM, Ton, dan HM tidak
boleh dijumlahkan menjadi satu angka dampak.

### 8.6 Subtab Data Control

```text
[ Excavator ] [ Dump Truck ] [ Operator Excavator ] [ Driver DT ]
[ Anomali & Mapping ] [ Riwayat Proses ]
```

Tabel utama menggunakan kolom ringkas:

| Kolom | Isi |
| --- | --- |
| Status | Siap Ranking, Perlu Dilengkapi, Ambigu, atau Dikecualikan |
| Tanggal / Shift | tanggal operasional dan shift sumber |
| Unit / Personel | kode unit atau nama + ID karyawan |
| Area · JOB · Material | konteks operasional kanonis |
| Plan | Weighted Plan Productivity dan satuan |
| Actual | Gross Actual Productivity dan satuan |
| HM | HM produksi yang lolos klasifikasi |
| Achievement | Gross Achievement (%) |
| Validasi | reason code utama dan jumlah issue |

Tabel bersifat read-only, server-side pagination, sticky header, dan dapat
diurutkan. Baris tidak lengkap tidak ditampilkan sebagai `0%`.

### 8.7 Drawer detail dan lineage

Klik baris membuka drawer tanpa meninggalkan halaman. Drawer menampilkan:

1. konteks: tanggal, shift, area, JOB, material, fleet, dan excavator induk;
2. plan: productivity, jarak, versi efektif, serta sumber Loader/Hauler;
3. actual: gross ritase, Non Prod, net ritase, Truck Factor, gross/net volume;
4. HM dan atribusi: segmen HM, operator/driver, metode HM-share;
5. hasil: actual, expected production, weighted plan, gross/net achievement;
6. lineage: ID sumber Ritase, Input Data, Planning Version, Truck Factor Version,
   formula version, dan waktu kalkulasi;
7. validasi: seluruh reason code, dampak, serta rekomendasi tindakan.

### 8.8 Anomali & Mapping

Antrean anomali minimal memuat:

- material ambigu;
- HM tanpa Ritase;
- Ritase tanpa HM;
- Truck Factor hilang;
- Loader/Hauler Plan hilang;
- JOB `DW` dikecualikan.

Perbaikan tidak boleh mengubah angka hasil kalkulasi secara manual. Pengguna
hanya diarahkan ke sumber authoritative atau, pada pengembangan mapping, memilih
relasi sumber yang sah. Perubahan mapping harus efektif-bertanggal dan menyimpan
aktor, waktu, nilai sebelum/sesudah, alasan, serta source record.

### 8.9 Status kontrol

- `ready`: lengkap dan dapat masuk ranking;
- `incomplete`: sumber wajib belum tersedia;
- `ambiguous`: terdapat lebih dari satu mapping yang valid;
- `excluded`: sengaja tidak masuk ranking, termasuk JOB `DW`.

Hanya `ready` yang masuk leaderboard. `excluded` bukan error dan tidak boleh
mengurangi readiness sebagai kegagalan kualitas apabila reason code-nya
`NON_PRODUCTION_JOB_DW`; jumlahnya tetap dilaporkan terpisah untuk audit.

## 9. Rencana Implementasi

### P0 — Kontrak formula dan kebijakan

- kunci Gross Productivity sebagai ranking utama;
- pastikan produksi net resmi tidak berubah;
- tetapkan HM untuk seluruh kategori;
- tetapkan seluruh Work Log tersimpan dan tidak dihapus sebagai denominator
  resmi tanpa gate `draft`/`submitted`;
- tetapkan HM-share sebagai metode sementara atribusi operator;
- tetapkan penanganan material ambigu;
- kunci JOB `DW` sebagai non-produksi dan keluarkan hanya segmen HM `DW`;
- kunci status dan reason code Data Control;
- tetapkan batas range dan pembulatan display;
- tulis formula version dan reason code.

Output P0: spesifikasi formula dan unit test murni sebelum query produksi dibuat.

### P1 — Domain service backend

Buat service terpisah, misalnya:

```text
backend/src/services/productivityRanking.js
```

Tanggung jawab service:

- validasi range/filter;
- canonical matching JOB dan material;
- load planning efektif per tanggal secara batch;
- hitung Gross/Net Volume dari Ritase dan Truck Factor;
- load dan kelompokkan HM Input Data;
- klasifikasikan JOB sebelum matching dan hasilkan exclusion
  `NON_PRODUCTION_JOB_DW`;
- resolve plan Loader dan plan individual DT;
- atribusi volume operator/driver berbasis HM share;
- hitung expected production, weighted plan, actual, dan achievement;
- urutkan dan ambil Top 10;
- hasilkan exclusion/data-quality summary.
- hasilkan satu dataset kontrol bersama untuk response ranking dan Data Control;
- bawa source counts, impact value/unit, formula version, dan lineage key.

Controller hanya menangani HTTP, autentikasi, parameter, dan response.

### P2 — Query, indeks, dan performa

- gunakan query range inklusif dengan batas akhir eksklusif internal;
- hindari satu query planning untuk setiap tanggal;
- kelompokkan versi planning berdasarkan effective date;
- evaluasi indeks:
  - `fleet_mappings(tanggal, shift_id, excavator_id, job_code, material_detail)`;
  - `ritase_logs(fleet_mapping_id, dump_truck_id, period_hour)`;
  - `mining_production_logs(tanggal, shift_id, equipment_id, operator_id, job)`
    dengan kondisi `deleted_at IS NULL`;
- tambahkan migration indeks hanya bila `EXPLAIN` membuktikan kebutuhan;
- jangan membuat tabel cache pada tahap pertama;
- bila response periode tahunan berat, tambahkan aggregate cache terpisah setelah
baseline performa tersedia.

Endpoint Data Control wajib memakai pagination dan filter server-side. Jangan
mengirim seluruh detail setahun ke browser. `control_key` harus stabil/deterministik
untuk drill-down, tetapi tidak boleh dipercaya sebagai otorisasi data.

### P3 — Frontend Productivity Report

- tambahkan range tanggal dan slicer konteks;
- ubah dua kartu lama ke response achievement baru;
- tambah dua kartu personel;
- tambah tab `Productivity Ranking` dan `Data Control` dengan filter bersama;
- tambah highlight Data Readiness yang seluruhnya berfungsi sebagai hyperlink;
- klik highlight membuka Data Control dengan filter status/reason code yang tepat;
- tambah subtab Excavator, Dump Truck, Operator Excavator, Driver DT, Anomali &
  Mapping, serta Riwayat Proses;
- tambah tabel paginated, drawer detail, lineage, dan status kontrol;
- tampilkan `JOB DW Dikecualikan` beserta jumlah segmen dan total HM;
- tambahkan loading, empty, incomplete, dan error state;
- tampilkan tooltip formula Gross versus Net;
- tampilkan panel kualitas data;
- gunakan DOM escaping untuk seluruh data API;
- frontend tidak menghitung KPI authoritative;
- karena halaman read-only, tidak ada tombol simpan baru.

### P4 — Pengujian

Backend dan domain test minimal:

1. OB menggunakan BCM/Hr dan Coal menggunakan Ton/Hr;
2. OB dan Coal tidak pernah tercampur;
3. perubahan versi planning di tengah range;
4. Non Prod masuk Gross tetapi dikeluarkan dari Net;
5. Truck Factor berbeda per DT;
6. Fleet volume hanya sekali untuk Excavator;
7. DT hanya menerima volume miliknya;
8. dua operator satu excavator dialokasikan sesuai HM share;
9. dua driver satu DT dialokasikan sesuai HM share;
10. material ambigu tidak menggandakan HM;
11. plan atau Truck Factor hilang tidak diubah menjadi nol;
12. ritase tanpa HM dan HM tanpa ritase masuk quality summary;
13. persentase kumulatif menggunakan expected production;
14. range terbalik dan lebih dari batas ditolak;
15. canonical JOB mapping tetap konsisten.
16. segmen HM `DW` tidak masuk Actual Productivity dan Expected Production;
17. unit dengan segmen produksi dan `DW` hanya memakai HM segmen produksi;
18. HM `DW` tidak menjadi fallback untuk OB/CG walaupun unit/shift cocok;
19. Data Control dan leaderboard memakai domain result serta formula version sama;
20. exclusion `DW` membawa jumlah segmen dan total HM tanpa dianggap missing-HM;
21. kesiapan data memisahkan dampak BCM, Ton, dan HM.

Frontend test minimal:

- slicer mengirim query yang benar;
- empat kartu tampil;
- ranking diurutkan descending;
- format achievement dan satuan benar;
- incomplete row tidak ditempatkan sebagai 0%;
- error API dan empty state terbaca jelas;
- warna threshold sesuai kontrak.
- setiap highlight dapat difokuskan keyboard dan membuka filter Data Control;
- filter periode/konteks tetap dipertahankan ketika berpindah tab;
- klik `JOB DW Dikecualikan` hanya menampilkan reason code
  `NON_PRODUCTION_JOB_DW`;
- drawer menampilkan source lineage dan seluruh reason code;
- pagination, loading, empty, dan error state Data Control terbaca jelas.

### P5 — Rekonsiliasi dan visual verification

- hitung manual satu Excavator dan satu DT sebagai golden dataset;
- cocokkan Gross/Net Volume terhadap Input Ritase;
- cocokkan HM terhadap Input Data;
- rekonsiliasi HM produksi dengan total HM Input Data dikurangi segmen `DW`;
- buktikan unit yang bekerja pada OB/CG dan DW tidak kehilangan HM produksi;
- pastikan total volume hasil alokasi operator kembali tepat ke total unit;
- uji periode satu bulan dan satu tahun;
- lakukan browser review desktop dan mobile;
- cek layout, overflow, loading, empty state, dan console error;
- dokumentasikan formula serta exclusion pada panduan pengguna;
- deploy hanya setelah owner menyetujui hasil rekonsiliasi.

## 10. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Gross dianggap produksi dibayar | KPI membingungkan | Label eksplisit Gross termasuk Non Prod; tampilkan Net sekunder |
| HM digandakan ke beberapa material | Achievement salah | Exclude material ambigu; jangan menebak |
| Persentase harian dirata-ratakan | Ranking bias | Gunakan total actual ÷ total expected |
| Plan revisi baru mengubah histori | Audit lemah | Resolve versi efektif per tanggal dan bawa version ID/formula version |
| Fleet volume digandakan per DT | Produksi berlebih | Excavator sum fleet sekali; DT memakai volume masing-masing |
| Missing Truck Factor menjadi nol | Unit jatuh ke ranking bawah palsu | Status incomplete dan exclusion |
| Pergantian operator tak punya timestamp jam | Atribusi tidak presisi | HM-share v1; rencanakan operator per slot Ritase |
| BCM dan Ton tercampur | Hasil tidak berdimensi | Wajib pisah planning type/material/unit |
| HM rental DW ikut denominator produksi | Productivity dan achievement turun secara palsu | Klasifikasi JOB lebih dahulu; exclude segmen `DW` dengan reason code eksplisit |
| Seluruh unit dikeluarkan karena pernah bekerja pada DW | HM produksi valid ikut hilang | Exclusion diterapkan per segmen Work Log, bukan per unit/range |
| Highlight hanya informatif | User tetap mencari sumber secara manual | Semua highlight hyperlink ke Data Control dengan filter yang persisten |
| Data Control dan ranking berbeda hasil | Kepercayaan dan audit rusak | Keduanya wajib memakai satu domain result dan formula version |
| Query range panjang berat | Timeout | Batasi 366 hari, batch effective-plan lookup, indeks berbasis evidence |

## 11. Rekomendasi Pengembangan Lanjutan

1. Tambahkan `fleet_mapping_id` atau `material_snapshot` pada segmen Input Data.
2. Tambahkan operator/driver per slot jam pada Input Ritase untuk atribusi langsung.
3. Sediakan drill-down dari ranking menuju tanggal, shift, fleet, ritase, HM, plan,
   dan reason code pembentuk achievement.
4. Tambahkan toggle Gross/Net tanpa mengubah default dan tanpa mencampur formula.
5. Tambahkan export Excel yang membawa source counts, plan version, formula version,
   exclusion, dan timestamp.
6. Tambahkan data freshness badge serta reconciliation status.
7. Setelah volume data besar, pertimbangkan materialized aggregate per hari dengan
   mekanisme refresh yang idempoten dan tetap menyimpan lineage sumber.
8. Tambahkan fitur opsional `Kunci Hasil Periode` yang menyimpan snapshot input,
   formula version, exclusion, serta hasil final untuk audit bulanan.
9. Tambahkan deep-link aman dari Data Control menuju Input Data, Input Ritase,
   Loader/Hauler Productivity, dan Truck Factor Setup pada record sumber terkait.

## 12. Keputusan berikut ini sudah disetujui, silahkan lakukan coding

1. Ranking utama disetujui memakai **Gross Productivity termasuk Non Prod**.
2. Produksi net resmi pada modul lain tetap tidak berubah.
3. HM digunakan pada keempat leaderboard, bukan hanya kartu personel.
4. Work Log yang sudah disimpan langsung sah untuk ranking resmi tanpa gate
   `draft`/`submitted`; record yang dihapus tetap dikecualikan.
5. Material ambigu dikeluarkan dan ditandai, bukan diprorata secara diam-diam.
6. Operator/driver multi-segmen memakai HM actual sesuai kode unit dan kode job di halaman input data
7. OB dan Coal/material berbeda tidak pernah digabung menjadi satu achievement.
8. Data Control menjadi dataset rekonsiliasi read-only yang sama dengan sumber
   leaderboard; seluruh highlight menjadi hyperlink filter/drill-down.
9. JOB `DW` disetujui sebagai rental/non-produksi: segmen HM `DW` dikeluarkan
   dari denominator, expected production, atribusi personel, dan ranking, tetapi
   tetap tersedia sebagai exclusion audit `NON_PRODUCTION_JOB_DW`.
