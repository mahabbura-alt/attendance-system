# Audit Teknis Halaman 8 — Review Produksi

**Project:** OMOS — One Mining Operating System  
**Tanggal audit:** 23 September 2026  
**Status:** Hasil inspeksi repository; belum diimplementasikan  
**Ruang lingkup:** formula mining, API/backend, struktur data historis, frontend/UI, Pareto dan Smart Text

## 1. Ringkasan Eksekutif

Halaman Review Produksi sudah memiliki fondasi visual dan perhitungan dasar yang berjalan. Lima test Review/Waterfall/Pareto yang tersedia juga lulus. Namun, halaman ini belum aman dijadikan rekonsiliasi final untuk kasus multi-material, multi-JOB, perubahan planning historis, atau campuran satuan BCM dan Ton.

Masalah utama bukan kesalahan parsing atau sintaks JavaScript, tetapi ketidaktepatan **grain data**, **data lineage**, **atribusi waktu/JOB/material**, dan **versi planning**. Kondisi tertentu dapat menghasilkan angka yang secara teknis valid tetapi secara operasional tidak mewakili scope yang dipilih user.

## 2. Prinsip Validasi Mining

Review Produksi harus mempertahankan konsistensi berikut:

- Produksi OB dihitung dalam **BCM**.
- Produksi Coal dihitung dalam **Ton**.
- Produktivitas OB menggunakan **BCM/jam**.
- Produktivitas Coal menggunakan **Ton/jam**.
- PA aktual dihitung dari HM, Standby, dan Breakdown pada konteks unit serta periode yang sama.
- UA aktual dihitung dari HM dan Standby pada konteks unit serta periode yang sama.
- Data historis harus memakai konfigurasi yang efektif pada tanggal operasional, bukan konfigurasi terbaru saat laporan dibuka.
- BCM dan Ton tidak boleh dijumlahkan dalam satu KPI.
- Presisi penuh dipertahankan selama kalkulasi dan pembulatan hanya dilakukan pada display.

## 3. Temuan P0 — Risiko Kesalahan Angka

### 3.1 HM dan PA/UA berpotensi dipakai berulang pada multi-material

Backend membentuk kelompok per `excavator + material`, tetapi aktual HM, Standby, dan Breakdown dibentuk dari total unit selama seluruh periode. Nilai aktual unit tersebut kemudian digunakan kembali pada setiap kelompok material.

Dampak:

- Delta PA dan Delta UA dapat dihitung lebih dari sekali.
- HM yang sama dapat menjadi pembagi productivity beberapa kelompok material.
- Delta Productivity dapat membesar secara tidak wajar.
- Periode yang berisi perpindahan material atau JOB menjadi tidak akurat.

Repository sudah membentuk `allocatedHmByUnitMaterial`, tetapi hasil alokasi tersebut belum digunakan pada kalkulasi akhir.

**Rekomendasi:** hitung aktual pada grain minimum:

```text
operational_date
+ shift
+ pit
+ job
+ excavator
+ material
+ uom
+ planning_version
```

### 3.2 Planning historis memakai konfigurasi terbaru

Review memanggil katalog productivity tanpa tanggal efektif dan mengambil Fleet Capacity, PA/UA/EWH, serta SPO terbaru. Perubahan planning sekarang dapat mengubah laporan historis.

Tabel `productivity_plan_versions` sudah tersedia untuk OB dan Coal, tetapi belum digunakan per tanggal oleh Review Produksi.

Untuk periode yang melintasi beberapa perubahan planning, response API harus mengembalikan sekumpulan versi sumber, bukan memaksakan satu `planning_version_id` untuk seluruh rentang.

**Rekomendasi:** resolusi planning dilakukan per tanggal operasional dan response menyertakan:

```json
{
  "source_versions": [
    {
      "planning_type": "ob",
      "version_id": "...",
      "effective_from": "2026-09-01",
      "effective_until": "2026-09-15",
      "revision": 2
    }
  ]
}
```

### 3.3 Referensi planning yang dipilih saat Tambah Fleet tidak disimpan

`fleet_plan_ref` diterima dan divalidasi saat fleet dibuat, tetapi tidak disimpan pada `fleet_mappings`. Setelah fleet tersimpan, sistem mencocokkan target kembali berdasarkan excavator, material, dan JOB.

Risiko:

- Target historis berubah setelah planning diedit.
- Fleet tidak memiliki referensi pasti ke formula yang digunakan saat dibuat.
- Audit tidak dapat menjelaskan asal target secara penuh.

**Rekomendasi:** simpan snapshot berikut ketika fleet dibuat atau diedit:

- `fleet_plan_ref`
- `planning_version_id`
- `plan_productivity`
- `productivity_unit`
- `formula_version`
- `density_snapshot` untuk Coal
- `plan_effective_from`

### 3.4 BCM dan Ton masih dapat tercampur

Satuan kategori ditentukan menjadi Ton apabila terdapat setidaknya satu cell Coal. Jika scope berisi data OB dan Coal, volume dapat terakumulasi tetapi hanya diberi satu label satuan.

**Rekomendasi:** agregasi wajib dipisahkan berdasarkan UoM. Backend harus menolak agregasi mixed-UoM atau mengembalikan section terpisah untuk BCM dan Ton.

### 3.5 Klasifikasi Planned Fleet vs Other Fleet belum cukup spesifik

Klasifikasi saat ini terutama memakai `excavator + tanggal`. Material, shift, PIT, JOB, dan referensi planning belum menjadi identitas lengkap.

Contoh risiko: EX30 direncanakan untuk CLAY tetapi aktual bekerja pada PASIR pada tanggal yang sama. Produksi PASIR dapat dianggap produksi planned.

**Rekomendasi:** gunakan identitas:

```text
fleet_plan_ref
+ operational_date
+ shift
+ pit
+ job
+ material
+ uom
```

### 3.6 Breakdown dan Standby belum terikat tepat ke JOB

HM memiliki konteks JOB, sedangkan Breakdown dan Standby pada Review direkap berdasarkan unit dan tanggal. Jika satu unit berpindah JOB, downtime unit dapat masuk ke JOB yang sedang dilihat walaupun kejadiannya berasal dari JOB lain.

Pareto juga mengambil JOB pertama dari fleet unit-tanggal dan belum melakukan filtering Breakdown/Standby secara ketat berdasarkan JOB.

**Rekomendasi jangka pendek:** tampilkan event tersebut sebagai `Shared / Belum teralokasi` dan jangan masukkan ke Pareto JOB tertentu.

**Rekomendasi target:** simpan `pit_id`, `job_id`, `shift_id`, dan operational context pada event Breakdown/Standby atau gunakan tabel alokasi yang auditable.

### 3.7 Status Standby yang tidak dihitung masih dapat masuk Review

Workflow Standby mengecualikan `reclassified` dan `cancelled`, tetapi query Review hanya memeriksa `deleted_at IS NULL`.

Risiko:

- Standby yang dibatalkan tetap menurunkan UA.
- Event yang sudah direklasifikasi menjadi Breakdown dapat dihitung dua kali.

**Rekomendasi:** gunakan aturan counted yang sama dengan workflow Standby dan tetapkan kebijakan untuk `pending`, `approved`, serta `returned`.

### 3.8 Smart Text dapat menyebut gain sebagai masalah

Pemicu Smart Text memakai nilai absolut delta lebih dari 1%, sedangkan output selalu berstatus negatif. Delta positif dapat menghasilkan kalimat seperti “Productivity berada di bawah target”.

**Rekomendasi:** Root Cause Analysis hanya dipicu bila:

```text
delta < -(threshold × plan)
```

Gain positif dapat ditampilkan sebagai insight terpisah tanpa narasi masalah.

## 4. Temuan P1 — Reliabilitas dan Kualitas Data

### 4.1 Truck factor kosong dianggap produksi nol

Truck factor yang tidak ditemukan menghasilkan volume `0`. Sistem tidak membedakan:

- produksi memang nol;
- unit tidak beroperasi;
- truck factor belum tersedia;
- data gagal dihitung.

**Rekomendasi:** gunakan status kualitas data `complete`, `missing-factor`, `inactive`, dan `calculation-error`.

### 4.2 Formula fallback di frontend

Frontend mencoba menghitung ulang Plan, Delta PA, dan Delta UA jika data backend tidak tersedia. Formula agregat frontend dapat berbeda dari formula per-unit backend.

**Rekomendasi:** seluruh kalkulasi authoritative berada di backend. Frontend hanya merender nilai, reason code, dan status completeness.

### 4.3 Breakdown lintas periode belum menggunakan interval overlap

Review menjumlahkan `total_breakdown_hours` berdasarkan tanggal record. Breakdown yang dimulai sebelum periode atau berakhir setelah periode dapat dihitung seluruhnya atau tidak dihitung sama sekali.

**Rekomendasi:** gunakan irisan interval terhadap batas periode dan hanya hitung segment `counts_as_breakdown = true`.

### 4.4 Query Pareto tidak deterministik pada data besar

Breakdown, Standby, dan Productivity Problem dibatasi `LIMIT 5000` tanpa `ORDER BY` yang stabil.

**Rekomendasi:** gunakan pagination atau agregasi SQL langsung, disertai urutan deterministik dan indikator `truncated` bila data dipotong.

### 4.5 Rentang periode tidak dibatasi

Endpoint dapat diminta menghitung periode sangat panjang dalam satu request sinkron.

**Rekomendasi:** batasi review interaktif, misalnya maksimal 31 atau 93 hari. Laporan lebih panjang diproses sebagai ekspor/background job.

### 4.6 PIT masih bergantung pada `equipment.lokasi`

Project telah memiliki `production_pits` dan `fleet_mappings.pit_area`, tetapi daftar/filter Review masih berasal dari lokasi unit. Perpindahan lokasi master equipment dapat memengaruhi data historis.

**Rekomendasi:** jadikan `production_pits.id` sebagai identitas area dan simpan `pit_name_snapshot` untuk histori.

### 4.7 JOB, PIT, dan material masih banyak memakai teks bebas

Rename, perbedaan kapitalisasi, atau spasi dapat memutus hubungan antarhalaman.

**Rekomendasi:** gunakan stable ID dengan snapshot label:

- `job_id` + `job_code_snapshot`
- `pit_id` + `pit_name_snapshot`
- `material_id` + `material_name_snapshot`

### 4.8 Toleransi rekonsiliasi tidak konsisten

Rekonsiliasi utama memakai toleransi relatif 1% terhadap plan, sedangkan Waterfall PA/UA memakai selisih absolut maksimal satu BCM/Ton.

**Rekomendasi:** gunakan kebijakan tunggal:

```text
abs(selisih) <= max(toleransi_absolut, plan × toleransi_persen)
```

### 4.9 Endpoint utama belum memiliki test integrasi

Test backend tersedia untuk Pareto dasar, tetapi belum ada test integrasi untuk `/review-produksi` utama.

Kasus yang belum terlindungi:

- multi-material;
- multi-JOB;
- perubahan versi plan;
- mixed BCM/Ton;
- missing truck factor;
- Standby cancelled/reclassified;
- breakdown lintas periode;
- actual material berbeda dari planning.

## 5. Temuan P2 — Frontend dan UX

### 5.1 Race condition request periode

Perubahan tanggal saat request sebelumnya berjalan dapat diabaikan karena `state.memuat`. Data yang tampil dapat tertinggal dari filter input terbaru.

### 5.2 Race condition Pareto

Saat Pareto sedang dimuat, perubahan PIT/JOB tidak memulai request baru. Respons filter lama dapat tampil pada filter baru.

**Rekomendasi:** gunakan `AbortController` dan request sequence ID.

### 5.3 Data lama dapat tetap terlihat setelah refresh gagal

Ketika request baru gagal, state data dihapus tetapi chart/tabel sebelumnya tidak selalu dibersihkan.

**Rekomendasi:** tampilkan explicit error state dan sembunyikan seluruh hasil lama.

### 5.4 Layout belum responsif

Grid chart/Pareto dan Planned/Other Fleet menggunakan pembagian kolom desktop tetap tanpa breakpoint lokal.

**Rekomendasi:** pada layar sempit ubah menjadi satu kolom, gunakan sticky header untuk tabel, dan pertahankan horizontal scroll yang terlihat.

### 5.5 Belum ada informasi lineage dan completeness

Pengguna belum dapat melihat:

- versi plan yang digunakan;
- waktu kalkulasi;
- formula version;
- jumlah record valid/tidak lengkap;
- factor atau HM yang belum tersedia;
- status rekonsiliasi sumber.

## 6. Rekomendasi Rencana Implementasi

### P0 — Integrity Foundation

1. Definisikan grain agregasi Review Produksi.
2. Persist `fleet_plan_ref` dan snapshot target saat fleet dibuat.
3. Resolve plan per tanggal efektif.
4. Pisahkan BCM dan Ton.
5. Isolasi HM, Standby, dan Breakdown per konteks tanggal/JOB/material.
6. Perbaiki Planned vs Other Fleet menggunakan referensi plan/konteks lengkap.
7. Terapkan status event yang counted secara konsisten.
8. Perbaiki trigger Smart Text menjadi negative-only.

### P1 — Data Quality dan Performance

1. Buat service backend khusus untuk kalkulasi Review Produksi.
2. Hapus fallback formula authoritative dari frontend.
3. Tambahkan completeness dan reason code pada response API.
4. Terapkan filter PIT/JOB di SQL/API utama.
5. Tambahkan range limit, pagination/agregasi Pareto, dan indeks berdasarkan hasil `EXPLAIN`.
6. Gunakan ID stabil untuk JOB, PIT, material, tenant, dan project.
7. Tambahkan test integrasi untuk seluruh kasus risiko.

### P2 — Enterprise UX

1. Data Quality Summary.
2. Drill-down KPI ke record sumber.
3. Compare Period.
4. Frozen/Closed Report Snapshot.
5. Action Register untuk hasil Pareto.
6. Audit Panel berisi versi plan, formula, waktu kalkulasi, dan sumber data.
7. Layout responsif untuk layar kecil/VGA rendah.

### P3 — Mining Intelligence

1. Pareto Productivity berdasarkan durasi dampak atau shortfall terukur, bukan jumlah event saja.
2. Event fact layer yang tetap terikat tenant, project, PIT, JOB, shift, unit, dan tanggal operasional.
3. Rekomendasi tindakan berbasis rule/evidence yang auditable.
4. AI hanya menjelaskan fakta terhitung dan tidak boleh mengubah angka atau mengarang root cause.

## 7. Fitur yang Direkomendasikan

### Data Quality Summary

Tampilkan jumlah:

- fleet lengkap;
- plan tidak ditemukan;
- truck factor kosong;
- HM belum teralokasi;
- event tanpa JOB;
- mixed UoM;
- record belum approved bila approval menjadi syarat.

### Drill-down Data Lineage

Klik Plan, Delta PA, Delta UA, Delta Productivity, atau Aktual membuka:

- unit;
- tanggal dan shift;
- PIT/JOB/material;
- source record;
- jam/volume;
- formula dan versi;
- completeness/status.

### Frozen Report

Laporan yang sudah ditutup menyimpan snapshot sumber dan hasil sehingga tidak berubah ketika planning atau master data diperbarui.

### Compare Period

Perbandingan dapat disediakan terhadap:

- hari sebelumnya;
- shift sebelumnya;
- periode sebelumnya;
- target/budget;
- fleet atau PIT lain dengan UoM yang sama.

### Action Register

Setiap problem dominan dapat memiliki:

- PIC;
- target penyelesaian;
- status tindakan;
- catatan;
- lampiran;
- bukti penutupan;
- histori perubahan.

## 8. Verifikasi Audit

Test yang dijalankan:

```text
backend/test/review-produksi-pareto.test.js
admin-dashboard/reviewProduksi.core.test.js
admin-dashboard/reviewPareto.core.test.js
admin-dashboard/reviewPaWaterfall.core.test.js
admin-dashboard/reviewUaWaterfall.core.test.js
```

Hasil:

```text
5 test lulus
0 gagal
```

Catatan: test yang lulus membuktikan formula golden-case dan Pareto dasar tetap berjalan, tetapi belum melindungi kasus P0/P1 yang ditemukan dalam audit ini.

## 9. Dampak Keamanan dan Multi-Client

Endpoint Review Produksi sudah berada di belakang `requireAuth` dan `requireAdmin`. Namun, query operasional belum menunjukkan boundary `tenant_id` dan `project_id` pada data Review.

Untuk arah OMOS multi-client, seluruh fact, plan, dan snapshot Review harus memiliki ownership tenant/project dan scope tersebut harus diperoleh dari sesi backend, bukan payload frontend.

## 10. Keputusan yang Diperlukan Sebelum Implementasi

1. Bagaimana HM/Standby/Breakdown dialokasikan ketika satu unit bekerja pada beberapa JOB/material?
   - pencatatan langsung per konteks — direkomendasikan;
   - alokasi proporsional dengan rule versioned;
   - atau masuk kelompok `Shared / Belum teralokasi`.
2. Apakah Review hanya menghitung data approved/closed atau juga data operasional pending?
3. Kapan sebuah laporan dianggap frozen/final?
4. Berapa toleransi rekonsiliasi yang disepakati per UoM?
5. Berapa rentang maksimum untuk review interaktif?

## 11. Status Implementasi

- **IMPLEMENTED:** belum ada perubahan aplikasi dari audit ini.
- **VERIFIED:** source code dan test terkait telah diinspeksi; lima test targeted lulus.
- **PROPOSED:** seluruh P0–P3 pada dokumen ini.
- **NOT YET VERIFIED:** akurasi hasil terhadap sampel produksi nyata multi-JOB/multi-material di database production.

