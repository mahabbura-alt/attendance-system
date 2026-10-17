# Rencana Implementasi: Non Prod / Inpit pada Input Ritase

Status: **IMPLEMENTED & DEPLOYED — migrasi 043 diterapkan**  
Terakhir diverifikasi: 2026-09-23  
Validasi domain: skill `omos-mining-validation`

## 1. Definisi bisnis dan formula

Sumber data tetap dipisahkan agar historis dan audit tidak rusak:

- `ritase_bruto`: ritase aktual yang dimasukkan pada baris Dump Truck.
- `ritase_nonprod`: bagian ritase bruto yang tidak dihitung sebagai produksi.
- `ritase_produktif = ritase_bruto - ritase_nonprod`.
- `produksi = ritase_produktif × Truck Factor efektif`.

Semua ritase berupa bilangan bulat dengan aturan:

`0 ≤ ritase_nonprod ≤ ritase_bruto`

Contoh jam 07:00:

- DT 30: bruto 6, non-prod 2, produktif 4 rit.
- DT 31: bruto 5, non-prod 3, produktif 2 rit.
- Tombol jam 07:00 menampilkan **5 Rit**, yaitu total non-prod, bukan total
  produktif.

Nilai lama otomatis diperlakukan `nonprod = 0`. Ritase bruto tidak ditimpa
atau dikurangi secara fisik.

## 2. Rancangan UI

Di setiap tabel fleet, tepat di bawah `TOTAL RIT/JAM`, ditambahkan baris
`NON PROD / INPIT`.

- Setiap kolom jam berisi tombol solid kuning `Non Prod`.
- Jika sudah ada input, label menjadi total per jam, misalnya `5 Rit`.
- Klik tombol membuka modal berisi Kode Unit, Ritase Bruto, input Non Prod,
  dan Ritase Produktif read-only.
- Footer modal menampilkan total bruto, non-prod, dan produktif secara live.
- Nilai modal menjadi draft tabel dan disimpan atomik bersama tombol
  `Simpan Ritase`; gunakan `OMOSActionFeedback` untuk mencegah submit ganda.
- Jika bruto diturunkan di bawah non-prod, simpan ditolak dengan pesan yang
  menyebut unit dan jam. Sistem tidak melakukan auto-clamp karena itu akan
  mengubah data operasional tanpa persetujuan user.
- Kolom total paling kanan menampilkan total non-prod fleet selama shift.
- Baris `TOTAL RIT/JAM` tetap berarti bruto. Baris `Productivity` dan total
  produksi menggunakan ritase produktif.

API mengembalikan tiga nilai secara eksplisit (`gross`, `nonprod`,
`productive`) agar halaman lain tidak menebak arti `total_ritase`.

## 3. Penyimpanan dan audit

### Migrasi 043

Tambahkan pada `ritase_logs`:

- `nonprod_ritase_count INTEGER NOT NULL DEFAULT 0`.
- CHECK `nonprod_ritase_count >= 0`.
- CHECK `nonprod_ritase_count <= ritase_count`.
- `nonprod_updated_by UUID REFERENCES users(id)`.
- `nonprod_updated_at TIMESTAMPTZ`.

Tambahkan audit append-only `ritase_nonprod_audit` yang menyimpan tenant/project
scope jika tersedia pada schema, fleet, truck, jam, nilai sebelum/sesudah,
aktor, waktu, dan sumber perubahan. Unique key ritase yang sekarang tidak
berubah.

Backend tetap menjadi authority. Payload batch divalidasi terhadap:

- fleet dan Dump Truck yang benar-benar terikat;
- tanggal/shift/fleet dari server, bukan dipercaya dari browser saja;
- integer non-negatif;
- non-prod tidak lebih besar dari bruto;
- idempotent upsert dalam satu transaksi.

## 4. Satu helper formula authoritative

Buat helper domain backend, misalnya:

`productiveRitase(gross, nonprod)`

Helper mengembalikan bruto, non-prod, produktif, dan status valid. Semua
kalkulasi backend wajib memakai helper/ekspresi kanonis yang sama. Frontend
hanya memakai padanan helper untuk preview; backend tetap memvalidasi ulang.

## 5. Dampak dan konfrontasi dengan fitur terhubung

| Konsumen | Perilaku sekarang | Perubahan wajib |
|---|---|---|
| Grid Input Ritase | `ritase × factor` | Productivity dan Total Produksi memakai ritase produktif; Total Rit/Jam tetap bruto. |
| Pdty Problem / History | Snapshot actual dari ritase bruto | Snapshot baru memakai ritase produktif. Snapshot historis lama tidak ditulis ulang. |
| JPEG Lapor | KPI, chart, tabel jam, DT dan achievement memakai bruto | Produksi/achievement memakai produktif. Tampilkan KPI Ritase Produktif; bruto dan non-prod menjadi informasi pembanding agar definisi tidak ambigu. |
| Data Produksi | Volume/material/fuel ratio memakai bruto | Produksi, BCM conversion, fuel ratio, dan material memakai produktif. |
| Review Produksi / waterfall | Aktual produksi memakai bruto | Aktual produksi memakai produktif agar loss/gain konsisten. |
| Jarak Final | Pembobotan memakai semua ritase | Alokasi jarak dibatasi oleh ritase produktif, bukan bruto. Non-prod diasumsikan berasal dari ritase dasar yang tidak dialokasikan. Konflik existing ditolak dan ditampilkan ke user. |
| Dashboard/API legacy | Sebagian memakai `production_volume` lama, sebagian grid fleet | Audit tiap query. Endpoint legacy tidak diubah bila memang tidak mengonsumsi fleet grid; jangan mencampur dua sumber. |

### Risiko khusus Jarak Final

Input non-prod hanya menyimpan jumlah per truck-jam, bukan jaraknya. Karena itu
tidak mungkin menentukan secara matematis alokasi jarak non-prod bila satu
truck-jam mempunyai lebih dari satu jarak. Aturan tahap awal yang paling aman:

1. non-prod dianggap berasal dari ritase pada jarak setup/base;
2. seluruh `ritase_distance_allocations` dianggap ritase produktif;
3. jumlah alokasi jarak per truck-jam wajib `≤ ritase produktif`;
4. jika input non-prod membuat alokasi existing melebihi batas, transaksi
   ditolak dan user diminta memperbaiki Jarak Final.

Jika bisnis kelak membutuhkan non-prod spesifik per jarak, schema harus
ditingkatkan menjadi alokasi `(truck, jam, jarak, productive/nonprod)`; jangan
menggunakan pembagian proporsional tersembunyi.

## 6. Rencana kerja

### P0 — Kontrak data dan regression map

- Tetapkan istilah bruto/non-prod/produktif di API dan UI.
- Inventarisasi seluruh ekspresi `ritase_count × factor_value` dan agregasi
  ritase pada controller, `productionData`, report JPEG, Review Produksi, serta
  final-distance.
- Bekukan dataset uji contoh 6−2 dan 5−3.

### P1 — Database dan domain backend

- Migrasi 043 dengan default/backward compatibility dan audit table.
- Helper produktif kanonis.
- Extend GET fleet agar mengirim non-prod dan produktif per truck-jam.
- Extend POST `/ritase/hours` agar bruto + non-prod tersimpan atomik.
- Validasi ownership fleet/truck serta aturan jarak di dalam transaksi.

### P2 — Sinkronisasi seluruh formula

- Hourly snapshot dan Productivity Problem.
- Data Produksi dan fuel ratio.
- Review Produksi/waterfall.
- JPEG Lapor dan KPI ritase.
- Jarak Final dengan guard terhadap ritase produktif.

### P3 — Frontend Input Ritase

- Baris tombol kuning dan modal per jam.
- Draft state per fleet/truck/jam tanpa state paralel.
- Live calculation bruto/non-prod/produktif.
- Integrasi save feedback, unsaved-change behavior, keyboard navigation, dan
  pesan konflik Jarak Final.

### P4 — Verifikasi

- Unit: `6−2=4`, `5−3=2`, total tombol `5 Rit`.
- Boundary: 0, sama dengan bruto, lebih besar dari bruto, bruto diturunkan,
  Truck Factor kosong, Coal/OB, shift lintas tengah malam.
- Regression: JPEG report, Data Produksi, Review Produksi, final distance,
  Productivity History, dan data lama `NULL/default 0`.
- Concurrency/idempotency: dua save dan revision conflict.
- Full backend/dashboard suite serta browser localhost review sebelum deploy.

## 7. Keputusan yang direkomendasikan

Rencana implementasi memakai keputusan berikut kecuali owner mengubahnya:

1. tombol menampilkan **total non-prod**;
2. Total Rit/Jam tetap **bruto**;
3. produksi, productivity, achievement, fuel ratio dan report memakai
   **ritase produktif**;
4. data tidak pernah auto-clamp;
5. Jarak Final memakai ritase produktif dengan asumsi non-prod berasal dari
   jarak dasar;
6. snapshot histori lama tetap immutable; hanya snapshot sesudah fitur aktif
   yang memakai formula baru;
7. perubahan formula diberi `formula_version` baru dan tanggal efektif agar
   laporan historis sebelum aktivasi tidak berubah.

## 8. Hasil implementasi P0–P4

- `ritase_logs` menyimpan bruto dan Non Prod secara terpisah; audit perubahan
  menggunakan `ritase_nonprod_audit`.
- API grid mengekspos nilai bruto, Non Prod, dan produktif per jam serta total.
- save batch melakukan validasi fleet/truck, batas nilai, duplikasi slot, dan
  konflik Jarak Final di dalam satu transaksi.
- Input Ritase menampilkan baris `NON PROD / INPIT`, tombol per jam, modal
  per-unit, kalkulasi live, dirty-state, dan proteksi submit ganda.
- Productivity, histori baru, Review Produksi, Data Produksi/fuel ratio, Jarak
  Final, serta JPEG Lapor memakai ritase produktif.
- Browser localhost diverifikasi pada viewport desktop dan sempit: modal dapat
  dibuka, tabel tetap mempunyai horizontal scroll pada viewport sempit, modal
  muat dalam viewport, dan tidak ada console error.
- Regression suite yang tersedia lulus. Migrasi 043 diterapkan pada database
  terkonfigurasi tanggal 2026-09-23 dan aplikasi dideploy ke production Vercel
  sebagai deployment `dpl_4MsEjZGmY2j1ekrwfF2RiDudWnC5`.
