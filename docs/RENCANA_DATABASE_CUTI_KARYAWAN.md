# Rencana Database Cuti Karyawan

**Status:** IMPLEMENTED + MIGRATED + DEPLOYED BIZNET 2026-10-08 — migration 071–072 aktif dan release `/opt/omos/releases/20261008-040951-cuti-cycle-applications` melayani pengajuan komposit per siklus.
**Domain:** People / Workforce
**Keputusan implementasi terkunci 2026-10-07:** (1) tahun kalender perusahaan; (2) durasi inklusif — 12 s.d. 25 = 14 hari; (3) realisasi parsial berstatus `PARTIAL`/`VARIANCE` dan bernilai 0 periode sampai HR menyelesaikan keputusan; (4) approval berjenjang Atasan + HR oleh aktor berbeda; (5) hak selalu `floor(hari_tahun/siklus)`.
**File:** migration dasar 070, policy mingguan 071, dan pengajuan siklus 072 beserta runner; `backend/src/services/cuti.js`, `controllers/cutiController.js`, routes `/api/admin/cuti/*` di `admin.routes.js`; `admin-dashboard/cuti.js?v=8`, `cuti.css?v=8`; tes `backend/test/leave-cuti.test.js`, `admin-dashboard/cuti.test.js`.
**Prinsip:** Database Cuti adalah sumber data otoritatif. Roster hanya merefleksikan cuti yang telah disetujui dan direalisasikan.

## 1. Struktur halaman

Fitur berada dalam halaman **Roster Karyawan** dengan sub-tab berikut:

1. **Jadwal Roster** — jadwal kerja dan status `CP` yang diturunkan dari realisasi Database Cuti.
2. **Database Cuti** — sumber utama hak, realisasi, sisa, dan proyeksi cuti.
3. **Setup Kebijakan Cuti** — pengaturan berversi per departemen/jabatan untuk HR/Admin berwenang.

`CP` pada roster bukan sumber pemakaian cuti. Jika roster dan Database Cuti berbeda, Database Cuti yang berlaku lalu sistem merekonsiliasi baris roster.

```text
Setup kebijakan jabatan
        ↓
Hak cuti & proyeksi per karyawan
        ↓
Pengajuan cuti → approval
        ↓
Realisasi tanggal cuti disahkan
        ↓
Aktual dan sisa diperbarui
        ↓
Roster mengisi CP otomatis pada tanggal realisasi
```

## 2. Aturan bisnis yang dikunci

### Realisasi menggerakkan roster

Kolom **Realisasi** menyimpan rentang tanggal aktual pengambilan cuti yang telah dikonfirmasi HR, misalnya `12 Sep 2026 s.d. 25 Sep 2026`. Status `APPROVED` menulis jadwal CP berdasarkan tanggal rencana tetapi belum menambah Aktual. Status `REALIZED` mengganti jadwal tersebut dengan tanggal aktual, membuat rekaman realisasi, lalu memperbarui Aktual.

Pembatalan atau koreksi hanya membalikkan `CP` yang dibuat oleh realisasi itu. Override roster manual yang sah tidak boleh dihapus diam-diam; kasus tersebut masuk daftar rekonsiliasi.

### Aktual dan Sisa

Untuk kebijakan `56:14`:

- siklus = 56 hari kerja + 14 hari cuti = 70 hari;
- hak tahunan default = `floor(365 / 70) = 5` periode cuti;
- dua realisasi periodik valid berarti **Aktual = 2 periode**;
- **Sisa = 5 − 2 = 3 periode cuti**.

UI wajib menampilkan periode dan hari, contohnya `2 dari 5 periode · 28 dari 70 hari` dan `3 periode · 42 hari`, agar jumlahnya tidak ambigu. Perhitungan menggunakan versi kebijakan yang berlaku saat realisasi, bukan kebijakan terbaru.

Realisasi parsial tidak boleh langsung dibulatkan menjadi satu periode. Sistem menyimpan hari aktual dan memberi status `PARTIAL`/`VARIANCE` sampai HR memilih aturan yang berlaku: proporsional, digabung dengan realisasi lain, atau dikoreksi.

> **Validasi durasi:** tanggal `12 Sep 2026 s.d. 26 Sep 2026`, jika kedua batas tanggal dihitung inklusif, berarti 15 hari kalender. Untuk kebijakan 14 hari, sistem harus memperlihatkan selisih satu hari; bukan diam-diam menghitungnya tepat satu periode. Konvensi inklusif/eksklusif wajib dikunci.

## 3. Layout Database Cuti

### Header dan filter

- Tahun/siklus cuti (default tahun berjalan), departemen, jabatan, status, dan pencarian karyawan.
- Tombol `Kalender Cuti`, `Pengajuan Cuti`, `Rekonsiliasi Roster`, dan export.

### Indikator highlight

| Indikator | Definisi |
|---|---|
| Karyawan aktif | Populasi aktif dalam filter. |
| Hak periode | Total entitlement periode dalam tahun/siklus. |
| Aktual | Periode/hari yang sudah direalisasikan. |
| Sisa cuti | Hak dikurangi realisasi dan penyesuaian disahkan. |
| Jatuh tempo ≤30 hari | Proyeksi cuti berikutnya dalam 30 hari. |
| Perlu rekonsiliasi | Realisasi Database Cuti belum sama dengan CP roster. |

### Tabel utama

| Karyawan | Departemen / Jabatan | Kebijakan | Hak | Realisasi | Aktual | Sisa cuti | Proyeksi berikutnya | Status |
|---|---|---|---:|---|---:|---:|---|---|
| Ahmad | Produksi / Operator EX | 56:14 | 5 periode | 12–25 Sep; 01–14 Mar | 2 periode | 3 periode | 21 Nov 2026 | Aman |

Klik baris membuka panel detail berisi timeline, pengajuan/approval, hari aktual, CP roster yang diturunkan, versi kebijakan, dan audit before/after.

### Mode tampilan: List dan Card

Database Cuti menyediakan segmented control **List | Card**. Kedua mode memakai filter, kebijakan, dan data yang sama; perbedaannya hanya cara menyajikan data.

#### List

Mode default untuk operasi massal. Tampilannya adalah tabel utama di atas, dengan sorting, filter, export, dan aksi per karyawan. Nilai Aktual dan Sisa adalah agregasi tahunan/siklus yang sama dengan mode Card.

#### Card

Mode Card menampilkan satu kartu per karyawan, mengikuti struktur lampiran dan mengutamakan audit tiap siklus cuti. Header kartu:

```text
DEPARTEMEN  : Produksi
JABATAN     : Driver DT
NAMA        : Alex
PERIODE     : 56:14
```

Bagian isi terdiri dari baris Cuti 1, Cuti 2, dan seterusnya hingga jumlah hak periode pada tahun/siklus. Kolomnya:

| Siklus | Jadwal Cuti | CP: Proyeksi | CP: Realisasi | CK: Realisasi | Keterangan | CT: Realisasi | Sisa Tahunan |
|---|---|---|---|---:|---|---:|---:|
| Cuti 1 | CP 14 hari + CK 3 hari + CT 3 hari = 20 hari | 14–28 Mar | 18 Mar–01 Apr | 3 hari | Cuti melahirkan | 3 hari | 9 hari |
| Cuti 2 | CP 14 hari = 14 hari | 02–16 Jun | 02–16 Jun | — | — | — | 9 hari |

Jadwal Cuti adalah komposisi rencana, bukan bukti pemakaian. Sistem menyusun durasi jadwal dengan rumus berikut:

```text
durasi_jadwal_siklus = CP_policy_days
                     + CK_approved_days_yang_dilekatkan_ke_siklus
                     + CT_approved_or_planned_days_yang_dilekatkan_ke_siklus
```

Legenda wajib tersedia pada kartu:

- **CP**: cuti periodik dari kebijakan roster, misalnya 14 hari.
- **CK**: cuti khusus; tidak mengurangi hak cuti tahunan.
- **CT**: cuti tahunan; mengurangi saldo cuti tahunan.

Card memakai tiga perhitungan terpisah:

```text
aktual_periodik = jumlah realisasi CP valid pada tahun/siklus
sisa_periodik   = hak_periode_tahun - aktual_periodik + penyesuaian_periodik
sisa_tahunan    = hak_tahunan_hari + carry_forward - jumlah CT actual/approved
```

Dengan hak cuti tahunan 12 hari, realisasi CT 3 hari di Cuti 1 menghasilkan saldo 9 hari. Jika tiga hari CT lagi direalisasikan pada Cuti 3, saldo menjadi 6 hari. Nilai saldo tahunan bersifat kumulatif lintas Cuti 1, Cuti 2, dan seterusnya; bukan di-reset pada setiap kartu siklus.

Cuti Khusus hanya menampilkan realisasi hari serta alasan/keterangan. Ia tidak menambah Aktual Periodik dan tidak mengurangi Sisa Tahunan, kecuali kebijakan tenant secara eksplisit menyatakan sebaliknya.

Interaksi Card:

- setiap baris siklus yang belum memiliki CP menampilkan `+ Pengajuan Cuti` dan mengunci karyawan serta nomor siklus;
- klik baris siklus membuka detail pengajuan, approval, lampiran, dan audit;
- badge hijau untuk realisasi sesuai rencana, kuning untuk perbedaan durasi, merah untuk belum sinkron dengan roster;
- tombol Lihat di Roster membawa pengguna ke tanggal CP hasil realisasi;
- kartu dapat dicetak atau diekspor per karyawan tanpa mengubah data.

Untuk layar kecil, satu kartu memakai scroll horizontal pada tabel siklus atau mengubah setiap siklus menjadi accordion; kolom realisasi dan saldo tidak boleh dipotong.

### Setup Kebijakan Cuti

| Departemen | Jabatan | Basis siklus | Hari kerja | Hak/durasi cuti | Berlaku mulai | Status |
|---|---|---|---:|---:|---|---|
| Produksi | Operator EX | Roster | 56 | 14 hari | 01 Jan 2026 | Aktif |

Form policy mencakup jenis cuti, basis siklus (roster/tanggal masuk/kalender perusahaan), hari kerja, hari cuti, periode efektif, prorata, carry-forward, dan catatan. Perubahan policy wajib berversi, tidak menulis ulang sejarah.

## 4. Struktur data target

| Entitas | Fungsi |
|---|---|
| `leave_policy_versions` | Kebijakan per tenant/project, departemen, jabatan, periode berlaku, basis dan aturan siklus. |
| `employee_leave_entitlements` | Snapshot hak per karyawan/tahun: periode/hari, saldo awal, carry-forward, penyesuaian. |
| `employee_leave_requests` | Pengajuan, rentang rencana, alasan, lampiran, approval, `cycle_no`, `owning_year`, snapshot proyeksi, dan grup aplikasi CP/CK/CT. |
| `employee_leave_realisations` | Rentang aktual, hari aktual, ekuivalen periode, status, sumber, dan policy version. Pemicu roster CP. |
| `employee_leave_projections` | Forecast cuti berikutnya dan basis perhitungannya. |
| `leave_roster_reconciliation` | Perbedaan Database Cuti terhadap roster CP. |
| `leave_audit_log` | Siapa/apa/kapan/nilai lama/nilai baru/alasan/approval. |

Seluruh entitas operasional memiliki ownership tenant/project yang ditentukan server-side, bukan dari payload frontend.

## 5. Rumus dan basis proyeksi

```text
siklus_hari       = hari_kerja_kebijakan + hari_cuti_kebijakan
hak_periode_tahun = floor(hari_dalam_siklus_tahun / siklus_hari)
aktual_periode    = jumlah realisasi periodik valid
sisa_periode      = hak_periode_tahun + penyesuaian_periode - aktual_periode
```

### Keputusan final proyeksi siklus — 2026-10-08

Proyeksi CP adalah **baseline tetap dan deterministik**. Jadwal yang disetujui
maupun tanggal realisasi tidak boleh menggeser proyeksi siklus berikutnya.

```text
siklus_hari       = (minggu_kerja + minggu_cuti) × 7
CP_n_mulai        = T0 + minggu_kerja × 7 + (n - 1) × siklus_hari
CP_n_selesai      = CP_n_mulai + minggu_cuti × 7 - 1
owning_year       = tahun(CP_n_mulai)
T0_lanjutan       = CP_terakhir_proyeksi_selesai + 1 hari
```

- CP yang mulai pada Desember dan selesai pada Januari tetap dimiliki tahun
  tanggal mulai. Ia terlihat pada kedua tahun kalender, tetapi dihitung satu kali.
- Policy yang mulai setelah 1 Januari dihitung prorata berdasarkan jumlah awal
  CP yang jatuh sampai 31 Desember, maksimal hak normal `floor(52 / minggu_siklus)`.
- T0 tahun berikutnya meneruskan tanggal setelah akhir **proyeksi** siklus tahun
  sebelumnya; bukan akhir jadwal yang disetujui dan bukan akhir realisasi.
- Realisasi hanya memperbarui roster aktual, status pemakaian, dan variance.
  Ia tidak melakukan cascade/reschedule terhadap CP berikutnya.

Untuk setiap siklus, sistem menyimpan tiga rentang yang tidak saling menimpa:

| Rentang | Fungsi |
|---|---|
| Proyeksi | Baseline perhitungan siklus, immutable untuk versi policy tersebut. |
| Jadwal disetujui | Keputusan operasional HR/atasan; dapat berbeda dari proyeksi. |
| Realisasi | Tanggal aktual yang terjadi dan menjadi sumber CP roster aktual. |

Jika karyawan mundur dari proyeksi:

```text
schedule_variance_days = jadwal_mulai - proyeksi_mulai
actual_variance_days   = aktual_mulai - proyeksi_mulai
```

- nilai negatif = lebih awal, nol = sesuai, positif = terlambat;
- siklus tetap diidentifikasi dengan `cycle_no` dan `owning_year` baseline;
- realisasi yang baru terjadi pada tahun berikutnya tetap menyelesaikan saldo
  siklus pemiliknya, bukan otomatis memakai hak tahun berikutnya;
- bila keterlambatan bertabrakan dengan proyeksi CP berikutnya, sistem memberi
  status `CYCLE_AT_RISK`/`OVERLAP`, tetapi tidak menggeser baseline otomatis;
- jika dua siklus berpotensi diklaim oleh satu realisasi, HR wajib memilih
  `cycle_no` yang diselesaikan. Sistem tidak menggabungkan atau menebak siklus.

CT dan CK dapat dilekatkan pada baris jadwal yang sama untuk presentasi, tetapi
tidak memengaruhi baseline, nomor siklus, atau proyeksi CP. CT tetap dihitung per
hari kalender dan CK tetap independen dari saldo periodik/tahunan.

### Pengajuan komposit per siklus

- Tombol global meminta Departemen → Jabatan → Karyawan → Periode Cuti.
- Tombol pada card langsung mengunci karyawan dan `cycle_no` baris tersebut.
- Tanggal mulai CP boleh disesuaikan tanpa mengubah tanggal proyeksi baseline.
- CK opsional membutuhkan keterangan dan jumlah hari; CT opsional membutuhkan jumlah hari.
- Sistem menyusun CP → CK → CT secara berurutan, menampilkan rentang gabungan dan total hari sebelum simpan.
- Satu simpan menulis seluruh komponen dalam satu transaksi dan satu `application_group_id`; kegagalan salah satu komponen membatalkan semuanya.
- Pengajuan aktif pada siklus yang sama ditolak dan retry memakai idempotency key.

## 6. Kontrol dan integrasi

- Draft pengajuan tidak mengubah roster; approval/realisasi adalah prasyarat CP.
- Tulis realisasi bersifat idempotent untuk mencegah CP ganda saat retry/sinkron.
- Data absensi `cuti` lama dimigrasikan sebagai kandidat realisasi dan diberi status verifikasi jika sumber atau approval tidak lengkap.
- Kalender cuti memperlihatkan konflik coverage shift/manpower, tetapi tidak otomatis menolak pengajuan.
- Payroll hanya mengonsumsi hasil yang disahkan; aturan paid leave/potongan bukan asumsi dari modul ini.

## 7. Opsi pengembangan lanjutan

1. Pengajuan mandiri melalui APK dengan approval berjenjang atasan dan HR.
2. Kalender kapasitas departemen untuk benturan cuti, coverage shift, relief, dan MPP.
3. Alert 30/14/7 hari sebelum jatuh tempo serta daftar overdue.
4. Lampiran surat cuti, tiket perjalanan, surat medis, dan reason code per tenant.
5. Dashboard compliance: hak, pemakaian, overdue, dan variance roster/absensi.
6. Policy prorata, carry-forward, serta expiry sebagai konfigurasi berversi.

## 8. Keputusan yang diperlukan sebelum coding

1. Tahun/siklus: kalender, anniversary `hire_date`, atau periode perusahaan?
2. Apakah awal dan akhir realisasi dihitung inklusif?
3. Aturan cuti parsial terhadap satu periode cuti?
4. Rantai approver per departemen/jabatan dan apakah HR selalu wajib?
5. Apakah hak 5 periode pada policy `56:14` selalu memakai pembulatan `floor`, atau membutuhkan entitlement eksplisit untuk tahun kabisat/carry-forward?
