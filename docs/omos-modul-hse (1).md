# OMOS — Modul HSE (Health, Safety, and Environment)

Dokumen rancangan halaman, sub-halaman, wireframe, fitur, dan skema data untuk modul **HSE** di OMOS, mengacu pada praktik standar HSE pertambangan (SMKP Minerba dan pedoman teknik pertambangan yang baik).

> **Catatan regulasi:** daftar dokumen wajib, format laporan, dan ambang batas (mis. NAB kebisingan, baku mutu lingkungan) harus dicocokkan dengan KTT/tim HSE di site dan peraturan yang berlaku pada izin masing-masing. Dokumen ini menyiapkan *struktur data dan alur*, nilai ambang dibuat dapat dikonfigurasi.

---

## 0. Referensi Tampilan Mutlak (Source of Truth UI)

**File contoh tampilan halaman HSE:**

```
D:\OneDrive\Desktop\OMOS\admin-dashboard\assets\sample page\omos_hse_dashboard_layout.html
```

**Aturan penggunaan:**

1. File di atas adalah **acuan mutlak tampilan** halaman HSE di OMOS. Implementasi UI (komponen, jarak, tipografi, warna, susunan) wajib mengikuti file ini.
2. Wireframe ASCII di dokumen ini menjelaskan **struktur dan isi**; file HTML contoh menentukan **tampilan akhir**. Bila keduanya berbeda, **file HTML yang berlaku**.
3. File contoh baru mencakup sub-halaman **Ringkasan**. Sub-halaman lain (Hazard, Insiden, Izin kerja, dst.) belum punya contoh sendiri, jadi dibuat dengan **komponen dan pola yang sama** seperti pada contoh (lihat tabel di bawah) hingga contoh baru ditambahkan di folder `sample page`.
4. Setiap perubahan tampilan dilakukan di file contoh terlebih dahulu, baru diterapkan ke aplikasi dan didokumentasikan di sini.

**Spesifikasi yang tercermin dari contoh (halaman Ringkasan):**

| Elemen | Spesifikasi |
|---|---|
| Wadah halaman | Kartu latar abu muda (`surface-1`), radius 12 px, padding 12 px |
| Grid utama | 2 kolom: sidebar tetap 152 px + konten fleksibel, jarak 12 px |
| Sidebar | Kartu putih, border 0,5 px, radius 8 px; label kelompok 11 px warna redup; item 12 px, padding 6×8 px, ikon Tabler outline di kiri teks; item aktif berlatar aksen (`bg-accent`) dengan teks aksen tebal 500 |
| Header halaman | Judul 16 px/500 (`HSE`), subjudul 12 px (site · periode) di kiri; dua tombol 12 px di kanan: `Laporan` dan `Lapor hazard` |
| Hero hari tanpa LTI | Strip hijau (`bg-success`), radius 8 px; angka besar 30 px/500, label 13 px/500, keterangan rekor dan target 12 px, progress bar 6 px lebar ±110 px dengan persentase di bawahnya |
| Kartu KPI | Grid 4 kolom, jarak 8 px; kartu putih bergaris 0,5 px, padding 8×10 px; label 11 px, nilai 18 px/500, keterangan 11 px (hijau bila membaik, redup bila stabil, merah bila ada risiko) |
| Baris grafik | 2 kolom sejajar: **Laporan hazard, 6 bulan** (bar vertikal warna aksen, tinggi area ±84 px, label bulan 11 px) dan **Hazard terbuka per level risiko** (bar horizontal tebal 8 px: Ekstrem merah, Tinggi kuning, Sedang biru, Rendah hijau, dengan angka di kanan) |
| Baris bawah | 2 kolom: **Kepatuhan** (4 progress bar tebal 5 px dengan label dan persentase) dan **Perlu tindakan** (daftar dengan titik status 8 px berwarna merah/kuning/biru + teks 12 px) |
| Warna progress kepatuhan | Hijau bila memenuhi target, kuning bila di bawah target. Pada contoh: 94% dan 97% hijau, 91% dan 88% kuning. Target dibuat dapat dikonfigurasi |
| Tipografi | Hanya dua bobot: 400 dan 500. Sentence case. Tanpa emoji. Ukuran minimum 11 px |
| Ikon | Tabler Icons gaya outline saja |
| Warna | Selalu memakai token tema (surface, border, teks, fill role), bukan hex tetap, agar otomatis mendukung mode gelap |
| Gaya | Datar: tanpa gradien, bayangan, atau efek blur. Border 0,5 px |

**Pola komponen contoh yang dipakai ulang di sub-halaman lain:**

| Pola di contoh | Dipakai di |
|---|---|
| Sidebar sub-halaman bergrup | Seluruh halaman HSE (konsisten) |
| Header + tombol aksi (`Laporan`, `Lapor hazard`) | Seluruh halaman HSE |
| Kartu KPI 4 kolom | Bagian atas setiap sub-halaman daftar |
| Kartu panel putih bergaris (judul 12 px/500 + isi) | Grafik, daftar, dan panel ringkasan di semua sub-halaman |
| Progress bar + persentase | Kepatuhan pelatihan, MCU, inspeksi, skor audit, progres reklamasi |
| Bar horizontal level risiko | Register risiko, temuan audit per kategori |
| Daftar titik status (merah/kuning/biru) | Panel "Perlu tindakan", alert, ringkasan per sub-halaman |
| Strip hero berwarna | Pesan penting per sub-halaman (mis. izin kerja aktif, status kesiapan darurat) |

> **Catatan sinkronisasi:** spesifikasi di atas disusun dari tata letak halaman Ringkasan HSE yang dirancang pada tahap perancangan. Bila file `omos_hse_dashboard_layout.html` sudah diubah setelah itu, nilai pada tabel ini perlu disesuaikan dengan versi file terbaru.

---

## 1. Tujuan Modul

1. Satu tempat untuk seluruh data HSE site: hazard, insiden, izin kerja, kompetensi, kesehatan, lingkungan, darurat, audit, dan dokumen.
2. Memberi angka keselamatan yang akurat (LTIFR, TRIR, hari tanpa LTI) secara otomatis.
3. Memastikan **tindak lanjut tidak hilang**: setiap temuan, hazard, atau insiden menghasilkan tindakan korektif (CAPA) yang dipantau sampai tuntas.
4. Menjaga **kelayakan personel dan alat** (SIMPER, MCU, pelatihan, APAR, APD) lewat alert masa berlaku.
5. Menyiapkan data siap pakai untuk laporan ke manajemen dan Inspektur Tambang.

---

## 2. Struktur Navigasi

```
HSE (menu utama, sidebar sub-halaman)
│
├── PANTAU
│   ├── Ringkasan                  (halaman default)
│   └── Laporan dan statistik
│
├── RISIKO DAN INSIDEN
│   ├── Hazard dan inspeksi
│   ├── Insiden dan investigasi
│   └── Izin kerja
│
├── MANUSIA
│   ├── Kompetensi
│   ├── Kesehatan kerja
│   └── Kontraktor
│
├── LINGKUNGAN DAN DARURAT
│   ├── Lingkungan
│   ├── Tanggap darurat
│   └── APD dan peralatan
│
└── KEPATUHAN
    ├── Audit dan temuan
    └── Dokumen dan regulasi
```

| Slug | Label | Ikon (Tabler) |
|---|---|---|
| `overview` | Ringkasan | `layout-dashboard` |
| `reports` | Laporan dan statistik | `chart-line` |
| `hazard` | Hazard dan inspeksi | `alert-triangle` |
| `incident` | Insiden dan investigasi | `first-aid-kit` |
| `ptw` | Izin kerja | `file-certificate` |
| `competency` | Kompetensi | `school` |
| `occ-health` | Kesehatan kerja | `heartbeat` |
| `contractor` | Kontraktor | `building-store` |
| `environment` | Lingkungan | `leaf` |
| `emergency` | Tanggap darurat | `flame` |
| `ppe` | APD dan peralatan | `helmet` |
| `audit` | Audit dan temuan | `clipboard-check` |
| `documents` | Dokumen dan regulasi | `books` |

---

## 3. Layout Umum

### 3.1 Kerangka halaman

> Tampilan akhir mengikuti file contoh di bagian 0 (`omos_hse_dashboard_layout.html`).

```
┌───────────────────────────────────────────────────────────────────────────┐
│ HSE                                          Site: JMB-DKC ▾  Okt 2026 ▾ │
│                                          [Laporan]   [+ Lapor hazard]    │
├────────────────┬──────────────────────────────────────────────────────────┤
│ PANTAU         │                                                          │
│ ▸ Ringkasan    │                                                          │
│   Laporan...   │            (konten sub-halaman terpilih)                 │
│ RISIKO...      │                                                          │
│   Hazard...    │                                                          │
│   Insiden...   │                                                          │
│   Izin kerja   │                                                          │
│ MANUSIA        │                                                          │
│   ...          │                                                          │
└────────────────┴──────────────────────────────────────────────────────────┘
```

- **Sidebar sub-halaman** dikelompokkan dengan label kelompok kecil. Sub-halaman aktif diberi latar aksen.
- **Filter global** (site, periode) di header, berlaku untuk semua sub-halaman.
- **Tombol `Lapor hazard`** selalu ada di header, di semua sub-halaman. Ini aksi paling sering dan harus bisa dilakukan dalam kurang dari satu menit.
- **Badge angka** pada item sidebar untuk hal yang perlu tindakan (mis. Hazard dan inspeksi `18`, Izin kerja `3`).

### 3.2 Pola halaman daftar (dipakai di sebagian besar sub-halaman)

```
┌──────────────────────────────────────────────────────────────┐
│ [KPI kecil] [KPI kecil] [KPI kecil] [KPI kecil]              │
├──────────────────────────────────────────────────────────────┤
│ [Cari...]  [Filter ▾] [Filter ▾] [Status ▾]  [Tampilan: ☰ ▦] │
├──────────────────────────────────────────────────────────────┤
│ No | Tanggal | Judul/Objek | Kategori | Level | Status | Aksi │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
                                          ┌──────────────────┐
     (klik baris → drawer kanan)      →   │ Detail           │
                                          │ Riwayat          │
                                          │ Lampiran         │
                                          │ Tindakan korektif│
                                          └──────────────────┘
```

### 3.3 Pola drawer detail

1. Header: nomor, judul, badge status dan level
2. Informasi inti
3. Lampiran (foto, dokumen)
4. Tindakan korektif terkait (daftar CAPA)
5. Riwayat status (timeline)
6. Komentar
7. Aksi sesuai peran

### 3.4 Sistem warna dan status

| Makna | Warna | Contoh pemakaian |
|---|---|---|
| Ekstrem / lewat tenggat / tidak layak | Merah | Risiko ekstrem, CAPA overdue, SIMPER kedaluwarsa |
| Tinggi / perlu perhatian | Kuning-amber | Risiko tinggi, dokumen habis ≤30 hari |
| Sedang / informasi | Biru | Risiko sedang, izin kerja aktif |
| Rendah / aman / selesai | Hijau | Risiko rendah, CAPA selesai |
| Netral | Abu-abu | Draft, ditutup, tidak berlaku |

Aturan: **status selalu disertai teks/angka**, tidak hanya warna, agar terbaca saat dicetak hitam-putih.

### 3.5 Matriks risiko (dapat dikonfigurasi)

Matriks 5×5, skor = Kemungkinan (L) × Konsekuensi (C). Contoh ambang awal:

| Skor | Level |
|---|---|
| 1–4 | Rendah |
| 5–9 | Sedang |
| 10–16 | Tinggi |
| 17–25 | Ekstrem |

Ambang, label, dan deskripsi tiap skala L dan C disimpan di `hse_risk_matrix_config` supaya dapat disesuaikan dengan matriks risiko perusahaan.

### 3.6 Pelaporan mobile

Form `Lapor hazard` dan `Lapor near miss` dirancang mobile-first: foto (kamera langsung), lokasi (pilih area atau GPS), kategori, deskripsi singkat, tingkat risiko perkiraan. Maksimal 5 isian wajib.

---

## 4. Sub-halaman

### 4.1 Ringkasan (`overview`)

**Tujuan:** gambaran kondisi keselamatan site dalam satu layar, plus daftar hal yang perlu ditindaklanjuti.

**Acuan tampilan:** halaman ini harus identik dengan `omos_hse_dashboard_layout.html` (lihat bagian 0). Wireframe di bawah hanya menjelaskan isi dan urutan.

```
┌───────────────────────────────────────────────────────────────────┐
│ ● 142  Hari kerja tanpa LTI                                       │
│        Rekor site: 210 hari · target 250 hari    [████░░░] 57%    │
├──────────────┬──────────────┬──────────────┬─────────────────────┤
│ LTIFR        │ TRIR         │ Near miss    │ Hazard terbuka      │
│ 0,42         │ 1,10         │ 9            │ 18                  │
│ turun 0,61   │ stabil       │ bulan ini    │ 1 risiko ekstrem    │
├──────────────┴──────────────┼──────────────┴─────────────────────┤
│ Laporan hazard, 6 bulan     │ Hazard terbuka per level risiko    │
│ [bar chart]                 │ [bar horizontal]                   │
├─────────────────────────────┼────────────────────────────────────┤
│ Kepatuhan                   │ Perlu tindakan                     │
│ Induksi/pelatihan   94%     │ ● 2 CAPA lewat tenggat             │
│ MCU berlaku         97%     │ ● 7 SIMPER habis ≤30 hari          │
│ SIMPER berlaku      91%     │ ● 5 MCU jatuh tempo bulan ini      │
│ Inspeksi terlaksana 88%     │ ● 4 APAR perlu inspeksi            │
│                             │ ● 3 izin kerja aktif hari ini      │
└─────────────────────────────┴────────────────────────────────────┘
```

**Fitur:**
- Counter **Hari tanpa LTI** dihitung dari tanggal LTI terakhir, dengan rekor dan target yang dapat diatur.
- Semua kartu dapat diklik → menuju sub-halaman terkait dengan filter sudah terisi.
- Panel *Perlu tindakan* diurutkan berdasarkan urgensi (lewat tenggat → akan jatuh tempo → informasi).
- Perbandingan dengan periode sebelumnya di tiap KPI.
- Mode layar besar (display mode) untuk dipajang di ruang HSE / pos.

---

### 4.2 Laporan dan statistik (`reports`)

**Tujuan:** analitik tren dan laporan siap cetak.

```
┌───────────────────────────────────────────────────────────────┐
│ Periode: [Bulan ▾ Okt 2026]  Bandingkan: [Bulan lalu ▾]       │
│ Dimensi: ( Site | Departemen | Kontraktor | Lokasi )          │
├───────────────────────────────────────────────────────────────┤
│ Tabel statistik bulanan                                       │
│ Bulan | Jam kerja | LTI | MTI | FAI | NM | LTIFR | TRIR | SR  │
│ ...                                                           │
├──────────────────────────────┬────────────────────────────────┤
│ Tren LTIFR dan TRIR (12 bln) │ Insiden per kategori           │
│ [line chart]                 │ [donut/bar]                    │
├──────────────────────────────┼────────────────────────────────┤
│ Insiden per jam/shift        │ Insiden per lokasi (heatmap)   │
├──────────────────────────────┴────────────────────────────────┤
│ Laporan: [Bulanan HSE] [Statistik kecelakaan] [CAPA] [Ekspor] │
└───────────────────────────────────────────────────────────────┘
```

**Fitur:**
- Statistik dihitung otomatis dari data insiden dan jam kerja (`hse_manhours`), tidak diinput ulang.
- Laporan bulanan HSE siap ekspor PDF/Excel.
- Perbandingan antar periode, antar departemen, dan antar kontraktor.
- Heatmap insiden per lokasi dan per jam kerja untuk melihat pola.
- Templat laporan dapat disimpan dan dijadwalkan (mis. otomatis tiap tanggal 1).

---

### 4.3 Hazard dan inspeksi (`hazard`)

Terdiri dari 4 tab internal: **Laporan hazard**, **Register risiko (IBPR)**, **Inspeksi**, **Tindakan korektif**.

#### 4.3.1 Tab Laporan hazard

```
┌─────────────────────────────────────────────────────────────────┐
│ Terbuka 18 │ Ekstrem 1 │ Lewat tenggat 2 │ Ditutup bln ini 31   │
├─────────────────────────────────────────────────────────────────┤
│ [Cari]  [Lokasi ▾] [Kategori ▾] [Level ▾] [Status ▾]  [☰ ▦ Peta]│
├─────────────────────────────────────────────────────────────────┤
│ No       Tanggal  Lokasi     Kategori   Level    PIC     Status │
│ HZD-001  06 Okt   Pit 2      Jalan      Tinggi   Andi    Proses │
│ HZD-002  06 Okt   Workshop   Housekeep  Rendah   Budi    Baru   │
└─────────────────────────────────────────────────────────────────┘
```

**Alur status:** Baru → Dinilai → Dalam tindakan → Verifikasi → Ditutup (atau Ditolak/Duplikat).

**Fitur:**
- Tampilan tabel, kanban, dan peta lokasi.
- Penilaian risiko otomatis dari matriks (L × C).
- Pembuatan tindakan korektif langsung dari hazard dengan PIC dan tenggat.
- Deteksi duplikat (lokasi + kategori + waktu berdekatan).
- Kategori hazard dapat dikonfigurasi (jalan/haul road, alat berat, listrik, ketinggian, bahan kimia, kebersihan, dsb.).

#### 4.3.2 Tab Register risiko (IBPR)

```
┌─────────────────────────────────────────────────────────────────┐
│ Aktivitas | Bahaya | Dampak | Risiko awal | Pengendalian | Sisa │
│ Hauling   | Jalan licin | Kecelakaan unit | 20 Ekstrem | ... | 8 Sedang │
└─────────────────────────────────────────────────────────────────┘
        [Matriks risiko 5×5 dengan sebaran jumlah risiko]
```

**Fitur:**
- Penilaian risiko awal dan risiko sisa (residual) per bahaya.
- Hirarki pengendalian: eliminasi, substitusi, rekayasa, administratif, APD.
- Pemilik risiko dan tanggal tinjau ulang (alert tinjau ulang berkala).
- Matriks 5×5 interaktif: klik sel → daftar risiko pada sel tersebut.

#### 4.3.3 Tab Inspeksi

```
┌─────────────────────────────────────────────────────────────────┐
│ Jadwal bulan ini: terlaksana 44 / 50 (88%)                      │
├─────────────────────────────────────────────────────────────────┤
│ Templat       Objek/Lokasi  Terjadwal  Pelaksana  Temuan  Status │
│ Inspeksi HD   HD-021        08 Okt     Rudi       2       Selesai│
│ Inspeksi APAR Workshop      10 Okt     Siti       -       Terjadwal│
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- Templat inspeksi (checklist) dapat dibuat: kendaraan ringan, alat berat, area kerja, APAR, instalasi listrik, tempat penyimpanan B3, dsb.
- Jadwal berulang (harian, mingguan, bulanan).
- Pengisian checklist di mobile, jawaban Ya/Tidak/N-A + foto + catatan.
- Item "Tidak" otomatis menghasilkan temuan dan tindakan korektif.

#### 4.3.4 Tab Tindakan korektif (CAPA)

Daftar terpusat **semua tindakan** dari hazard, insiden, inspeksi, audit, dan simulasi darurat.

```
┌─────────────────────────────────────────────────────────────────┐
│ Sumber | Tindakan | PIC | Tenggat | Status | Bukti penutupan    │
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:** filter per sumber, PIC, dan status; indikator keterlambatan; verifikasi penutupan oleh HSE officer; eskalasi otomatis bila lewat tenggat.

---

### 4.4 Insiden dan investigasi (`incident`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Bulan ini: LTI 0 │ MTI 1 │ FAI 3 │ Near miss 9 │ Kerusakan 2    │
├─────────────────────────────────────────────────────────────────┤
│ [Cari] [Jenis ▾] [Lokasi ▾] [Keparahan ▾] [Status ▾]            │
├─────────────────────────────────────────────────────────────────┤
│ No      Tanggal  Jenis        Lokasi   Keparahan  Investigasi    │
│ INC-014 03 Okt   Near miss    Pit 1    Potensi T  Selesai        │
│ INC-015 05 Okt   FAI          Workshop Ringan     Proses         │
└─────────────────────────────────────────────────────────────────┘
```

**Jenis insiden:** fatality, LTI (hari hilang), MTI (perawatan medis), FAI (P3K), near miss, kerusakan properti/alat, kebakaran, lingkungan (tumpahan), kecelakaan kendaraan.

**Drawer detail insiden:**
1. Kronologi singkat, waktu, lokasi, kondisi cuaca/penerangan
2. Orang terlibat (karyawan/kontraktor), jenis cedera, bagian tubuh, hari hilang
3. Alat/aset terlibat dan estimasi kerugian
4. Potensi keparahan (actual vs potential)
5. Investigasi: metode (5 Why / fishbone), tim, akar masalah, faktor penyebab
6. Tindakan korektif dan pencegahan
7. Lampiran: foto, sketsa, saksi, laporan resmi
8. Pelaporan eksternal (jika diwajibkan) dan statusnya

**Fitur:**
- Klasifikasi *actual* dan *potential* severity.
- Investigasi bertahap dengan templat 5 Why dan fishbone.
- Pelaporan cepat (notifikasi instan ke HSE dan manajemen untuk jenis tertentu).
- Penghitungan hari hilang otomatis untuk LTI dan pembaruan counter hari tanpa LTI.
- Pelajaran dari insiden (*lessons learned*) yang bisa dibagikan sebagai safety alert.

---

### 4.5 Izin kerja (`ptw`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Aktif hari ini 3 │ Menunggu persetujuan 2 │ Kedaluwarsa 0       │
├─────────────────────────────────────────────────────────────────┤
│ Jenis: [Semua ▾]  Lokasi [▾]  Status [▾]            [+ Izin baru]│
├─────────────────────────────────────────────────────────────────┤
│ No      Jenis          Lokasi    Pekerjaan     Berlaku      Status│
│ PTW-031 Kerja panas    Workshop  Pengelasan    08:00-16:00  Aktif │
│ PTW-032 Ruang terbatas Tangki    Pembersihan   09:00-12:00  Menunggu│
└─────────────────────────────────────────────────────────────────┘
```

**Jenis izin:** kerja panas, ketinggian, ruang terbatas, isolasi energi/LOTO, galian, pengangkatan/lifting, listrik, bahan kimia.

**Alur:** Draft → Diajukan → Diperiksa HSE → Disetujui → Aktif → Selesai/Ditutup (atau Ditolak/Kedaluwarsa).

**Fitur:**
- Checklist bahaya dan pengendalian spesifik per jenis izin.
- Daftar pekerja yang terlibat; sistem memeriksa **kompetensi dan masa berlaku** (mis. sertifikat kerja di ketinggian) sebelum disetujui.
- Modul **LOTO**: titik isolasi, nomor gembok, pemasang dan pelepas, tercatat dengan waktu.
- Izin otomatis kedaluwarsa di akhir waktu berlaku.
- Serah terima antar shift untuk izin yang berlanjut.
- Penutupan izin: area dinyatakan aman, peralatan dikembalikan.
- Peta/daftar izin aktif per lokasi untuk menghindari konflik pekerjaan (SIMOPS).

---

### 4.6 Kompetensi (`competency`)

Tab internal: **Matriks pelatihan**, **Sertifikat dan lisensi**, **Induksi**, **Pelatihan**, **Safety talk**.

```
┌─────────────────────────────────────────────────────────────────┐
│ Kepatuhan pelatihan 94% │ Sertifikat habis ≤30 hr 7 │ Induksi... │
├─────────────────────────────────────────────────────────────────┤
│ Matriks pelatihan (jabatan × kursus)                            │
│             | Induksi | P3K | Kerja ketinggian | Defensive drive │
│ Operator HD |   ✓     |  ✓  |       -          |      ✓         │
│ Welder      |   ✓     |  ✓  |      ✓ (exp 2 bln)|     -         │
│ Foreman     |   ✓     |  ✗  |       ✓          |      ✓         │
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- **Matriks pelatihan** per jabatan: kursus wajib, masa berlaku, status per karyawan (valid, akan habis, kedaluwarsa, belum).
- **Sertifikat dan lisensi:** SIMPER/KIMPER, SIO, sertifikat operator, P3K, dan lainnya, dengan tanggal terbit, kedaluwarsa, dan berkas.
- **Induksi:** karyawan, kontraktor, dan tamu; catatan hasil tes dan tanggal berlaku.
- **Pelatihan:** jadwal sesi, peserta, kehadiran, nilai, sertifikat.
- **Safety talk (P5M/toolbox):** topik, tanggal, pemimpin, daftar hadir, cakupan per departemen.
- Alert otomatis 60/30/7 hari sebelum kedaluwarsa.
- Karyawan dengan dokumen wajib kedaluwarsa ditandai **tidak layak operasi** dan terlihat di modul Karyawan.

---

### 4.7 Kesehatan kerja (`occ-health`)

> **Data sensitif.** Akses dibatasi untuk petugas medis/HSE yang berwenang. Pengguna lain hanya melihat status kelayakan (layak/tidak layak/layak dengan catatan), bukan detail medis.

Tab internal: **MCU**, **Fit for work**, **Tes alkohol dan narkoba**, **Kasus kesehatan**, **Higiene industri**.

```
┌─────────────────────────────────────────────────────────────────┐
│ MCU berlaku 97% │ Jatuh tempo bln ini 5 │ FFW tidak layak hari ini 2│
├─────────────────────────────────────────────────────────────────┤
│ MCU                                                             │
│ Karyawan | Jenis | Tgl MCU | Hasil | Berlaku s/d | Status       │
│ Budi S.  | Berkala| 12 Mar | Layak | 12 Mar 27  | Valid         │
│ Andi P.  | Berkala| 02 Nov 25| Layak dg catatan | 02 Nov 26 | Segera habis│
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- **MCU:** pra-kerja, berkala, khusus, dan keluar; hasil kelayakan; jadwal berikutnya otomatis.
- **Fit for work harian:** pengecekan sebelum shift (istirahat, kondisi, hasil), dengan hasil layak/tidak layak dan tindak lanjut.
- **Tes alkohol/narkoba:** acak dan terjadwal, hasil, tindakan.
- **Kasus kesehatan kerja:** keluhan terkait pekerjaan, penyakit akibat kerja, hari hilang.
- **Higiene industri:** pengukuran kebisingan, debu, pencahayaan, getaran per area dibandingkan nilai ambang.
- Alert MCU jatuh tempo; hasil "tidak layak" otomatis memperbarui status kelayakan di profil karyawan.

---

### 4.8 Kontraktor (`contractor`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Kontraktor aktif 8 │ Skor rata-rata 82 │ Dokumen akan habis 3   │
├─────────────────────────────────────────────────────────────────┤
│ Kontraktor | Skor HSE | TRIR | Dokumen | Pelanggaran | Status   │
│ CV Maju    |   88     | 0,9  | Lengkap | 0           | Baik     │
│ PT Karya   |   71     | 1,8  | 2 habis | 3           | Pantau   │
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- Evaluasi keselamatan kontraktor (pra-kualifikasi dan berkala) dengan skor.
- Kelengkapan dokumen (SMK3/izin/asuransi/sertifikat personel) dengan masa berlaku.
- Statistik insiden dan jam kerja per kontraktor (LTIFR/TRIR per kontraktor).
- Catatan pelanggaran dan sanksi (peringatan, penghentian pekerjaan sementara).
- Tautan ke daftar personel kontraktor dan status kompetensinya.

---

### 4.9 Lingkungan (`environment`)

Tab internal: **Limbah B3**, **Pemantauan kualitas**, **Reklamasi**.

```
┌─────────────────────────────────────────────────────────────────┐
│ Limbah B3 bulan ini: 1.250 kg │ Parameter di atas baku mutu: 0  │
├─────────────────────────────────────────────────────────────────┤
│ Pemantauan kualitas                                             │
│ Titik | Parameter | Hasil | Baku mutu | Tanggal | Status        │
│ Outlet kolam | pH  | 7,2   | 6–9       | 04 Okt  | Memenuhi     │
│ Outlet kolam | TSS | 180   | 200       | 04 Okt  | Mendekati    │
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- **Limbah B3:** pencatatan timbulan per jenis dan sumber, penyimpanan sementara, pengangkut, nomor manifes, batas waktu simpan.
- **Pemantauan:** titik pantau (air, udara, debu, kebisingan), parameter, hasil lab, baku mutu yang dapat dikonfigurasi, status memenuhi/melampaui.
- **Tumpahan dan insiden lingkungan** terhubung ke sub-halaman Insiden.
- **Reklamasi:** luas area, kegiatan (penataan, penanaman), progres vs rencana.
- Grafik tren per parameter dengan garis baku mutu.

---

### 4.10 Tanggap darurat (`emergency`)

Tab internal: **Tim ERT**, **Simulasi (drill)**, **Peralatan darurat**, **Titik kumpul**.

```
┌─────────────────────────────────────────────────────────────────┐
│ Anggota ERT 24 │ Drill tahun ini 4/6 │ APAR perlu inspeksi 4    │
├─────────────────────────────────────────────────────────────────┤
│ Peralatan darurat                                               │
│ Jenis | Lokasi | No seri | Inspeksi terakhir | Berikutnya | Status│
│ APAR 6 kg | Workshop | A-014 | 01 Sep | 01 Okt | Terlambat     │
│ Eyewash | Gudang B3  | E-002 | 15 Sep | 15 Okt | Baik          │
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- **Tim ERT:** anggota, peran, sertifikasi, dan jadwal siaga.
- **Drill:** skenario, tanggal, peserta, waktu respon, evaluasi, dan temuan (otomatis jadi CAPA).
- **Peralatan darurat:** APAR, kotak P3K, eyewash, alarm, hidran; lokasi, kapasitas, jadwal inspeksi, kadaluarsa isi.
- **Titik kumpul** dan rute evakuasi per area (dokumen/peta terlampir).
- Kontak darurat internal dan eksternal (klinik, rumah sakit, pemadam, polisi) yang bisa dibuka cepat.

---

### 4.11 APD dan peralatan (`ppe`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Stok kritis 3 │ Penggantian jatuh tempo 12 │ Kepatuhan APD 96%  │
├─────────────────────────────────────────────────────────────────┤
│ Standar APD per jabatan | Distribusi | Stok | Penggantian         │
├─────────────────────────────────────────────────────────────────┤
│ Karyawan | Item        | Tgl serah | Ganti berikut | Status      │
│ Budi S.  | Helm safety  | 01 Mar 26 | 01 Mar 28     | Valid       │
│ Andi P.  | Sepatu safety| 10 Jan 26 | 10 Jul 26     | Perlu ganti │
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- **Standar APD per jabatan/area** (helm, sepatu, rompi, kacamata, sarung tangan, masker, ear plug, harness, dsb.).
- **Distribusi per karyawan** dengan tanggal penyerahan, ukuran, dan jadwal penggantian.
- **Stok** terhubung ke GudangSite (permintaan otomatis saat stok di bawah minimum).
- Pengembalian APD saat karyawan keluar (terhubung ke checklist offboarding).
- Alert penggantian dan kerusakan.

---

### 4.12 Audit dan temuan (`audit`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Audit tahun ini 3 │ Temuan terbuka 11 │ Lewat tenggat 1          │
├─────────────────────────────────────────────────────────────────┤
│ Audit | Jenis | Lingkup | Tanggal | Auditor | Temuan | Status   │
│ SMKP internal | Internal | Seluruh site | 10 Sep | Tim HSE | 6 | Selesai │
├─────────────────────────────────────────────────────────────────┤
│ Temuan: Kategori (Mayor/Minor/Observasi) | Klausul | Tenggat | Status│
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- Jadwal audit tahunan (internal, eksternal, kontraktor, regulator).
- Pencatatan temuan per klausul/elemen, kategori (mayor, minor, observasi), bukti.
- Temuan otomatis menjadi CAPA dengan PIC dan tenggat.
- Skor/persentase kesesuaian per elemen (grafik radar atau bar).
- Riwayat dan pembanding audit tahun ke tahun.

---

### 4.13 Dokumen dan regulasi (`documents`)

Tab internal: **Dokumen HSE**, **Daftar regulasi**, **Pelaporan wajib**.

```
┌─────────────────────────────────────────────────────────────────┐
│ Dokumen aktif 86 │ Perlu ditinjau ≤30 hr 5 │ Laporan jatuh tempo 1│
├─────────────────────────────────────────────────────────────────┤
│ No dokumen | Judul | Jenis | Rev | Berlaku | Tinjau | Status    │
│ HSE-SOP-012| SOP Kerja Panas | SOP | 03 | 01 Jan 26 | 01 Jan 27 | Aktif│
├─────────────────────────────────────────────────────────────────┤
│ Pelaporan wajib: Jenis | Periode | Tenggat | Terkirim | Status   │
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- **Dokumen HSE:** SOP, instruksi kerja, kebijakan, formulir, rencana darurat; kontrol revisi, tanggal berlaku, pemilik, tanggal tinjau.
- **Daftar regulasi (legal register):** nama dan nomor aturan, persyaratan ringkas, penerapan, status kepatuhan, PIC.
- **Pelaporan wajib:** laporan berkala ke instansi terkait, tenggat, status pengiriman, dan berkas.
- Pencarian teks penuh dan tag.
- Alert tinjau ulang dokumen dan tenggat laporan.

---

## 5. Skema Data

**Standar Konvensi Arsitektur Database OMOS:**
1. Seluruh tabel modul HSE terisolasi multi-tenant dengan konvensi baku prefix **`hse_*`** yang telah termigrasi di database PostgreSQL (`073_hse_fase1` s/d `080_hse_fase8`).
2. **Kolom standar di semua tabel** (tidak diulang di bawah): `id` (uuid, PK), `tenant_id` (uuid), `site_id` (uuid, bila relevan), `created_by`, `created_at`, `updated_at`. Penghapusan memakai soft delete (`deleted_at`) untuk data yang berkaitan dengan audit dan kepatuhan.

### 5.1 Master dan konfigurasi

**`hse_locations`** (master titik lokasi pit, hauling, workshop, dll.)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `code`, `name` | text | Mis. `PIT-2` / Pit 2 |
| `type` | enum | `PIT`, `HAUL_ROAD`, `WORKSHOP`, `WAREHOUSE`, `OFFICE`, `CAMP`, `DISPOSAL`, `OTHER` |
| `parent_id` | uuid | Hierarki area |
| `latitude`, `longitude` | numeric | Opsional |

**`hse_risk_matrix_config`** (konfigurasi matriks risiko 5×5)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `kind` | enum | `LIKELIHOOD`, `CONSEQUENCE`, `LEVEL` |
| `value` | int | Skala 1–5, atau skor minimum untuk level |
| `label` | text | Nama skala/level |
| `description` | text | Penjelasan |
| `color` | text | Token warna |

**`hse_categories`** (kategori hazard, insiden, temuan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `domain` | enum | `HAZARD`, `INCIDENT`, `FINDING`, `ENV_INCIDENT` |
| `code`, `label` | text | — |
| `is_active` | boolean | — |

**`hse_manhours`** (dasar perhitungan resmi LTIFR/TRIR/SR)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `period_month` | date | Hari pertama bulan |
| `company_id` | uuid | Perusahaan/kontraktor |
| `department_id` | uuid | Opsional |
| `hours` | numeric | Total jam kerja orang |
| `source` | enum | `ATTENDANCE`, `MANUAL` |

Unik: `(tenant_id, site_id, period_month, company_id, department_id)`. Bila modul absensi tersedia, jam kerja diisi otomatis dari sana.

**`hse_site_metrics`** (counter rekor site dan hari tanpa LTI)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `last_lti_date` | date | Tanggal LTI terakhir |
| `record_days` | int | Rekor tertinggi site |
| `target_days` | int | Target tahunan site |

### 5.2 Tindakan korektif terpusat

**`hse_actions`** (CAPA terpusat, dipakai semua modul)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `action_no` | text | Mis. `CAPA-2610-001` |
| `source_type` | enum | `HAZARD`, `INCIDENT`, `INSPECTION`, `AUDIT`, `DRILL`, `RISK`, `OTHER` |
| `source_id` | uuid | Rujukan polimorfik ke sumber |
| `description` | text | Tindakan yang harus dilakukan |
| `action_type` | enum | `CORRECTIVE`, `PREVENTIVE`, `IMMEDIATE` |
| `pic_employee_id` | uuid | Penanggung jawab |
| `due_date` | date | Tenggat |
| `status` | enum | `OPEN`, `IN_PROGRESS`, `DONE_PENDING_VERIFY`, `CLOSED`, `OVERDUE`, `CANCELLED` |
| `completed_at` | timestamp | — |
| `verified_by`, `verified_at` | — | Verifikasi HSE |
| `evidence_url` | text[] | Bukti penutupan |

Indeks: `(tenant_id, status, due_date)`, `(source_type, source_id)`.

### 5.3 Hazard, risiko, inspeksi

**`hazard_reports`** (nama tabel fisik: `hazard_reports`, alias domain: `hse_hazards`)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `report_no` | text | `HZD-2610-001` |
| `reported_by` | uuid | Karyawan pelapor |
| `report_date`, `report_time` | date, time | — |
| `location_id` | uuid | FK → hse_locations |
| `category_id` | uuid | FK → hse_categories |
| `description` | text | Uraian bahaya |
| `photos` | text[] | Foto temuan |
| `likelihood`, `consequence` | int | Skala 1–5 |
| `risk_score` | int | L × C |
| `risk_level` | enum | `LOW`, `MEDIUM`, `HIGH`, `EXTREME` |
| `assigned_to` | uuid | PIC |
| `status` | enum | `NEW`, `ASSESSED`, `IN_ACTION`, `VERIFY`, `CLOSED`, `REJECTED`, `DUPLICATE` |
| `closed_at` | timestamp | — |

**`hse_risk_register`** (IBPR / register risiko)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `risk_no` | text | — |
| `activity` | text | Aktivitas/proses tambang |
| `department_id` | uuid | — |
| `hazard` | text | Sumber bahaya |
| `consequence_desc` | text | Dampak |
| `initial_likelihood`, `initial_consequence` | int | Risiko awal |
| `initial_score`, `initial_level` | int, enum | — |
| `controls` | jsonb | Daftar pengendalian + tingkat hirarki |
| `residual_likelihood`, `residual_consequence` | int | Risiko sisa |
| `residual_score`, `residual_level` | int, enum | — |
| `owner_id` | uuid | Pemilik risiko |
| `review_date` | date | Tinjau berikutnya |
| `status` | enum | `ACTIVE`, `UNDER_REVIEW`, `RETIRED` |

**`hse_inspection_templates`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `name` | text | Mis. Inspeksi harian HD, P2H unit |
| `object_type` | enum | `VEHICLE`, `HEAVY_EQUIPMENT`, `AREA`, `FIRE_EQUIPMENT`, `ELECTRICAL`, `HAZMAT_STORAGE`, `OTHER` |
| `is_active` | boolean | — |

**`hse_inspection_template_items`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `template_id` | uuid | FK → hse_inspection_templates |
| `sort_order` | int | — |
| `question` | text | Butir pemeriksaan checklist |
| `is_critical` | boolean | Jika gagal (NO) → wajib auto-create CAPA |

**`hse_inspection_schedules`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `template_id` | uuid | FK → hse_inspection_templates |
| `location_id`, `asset_id` | uuid | Objek yang diinspeksi |
| `frequency` | enum | `DAILY`, `WEEKLY`, `MONTHLY`, `QUARTERLY`, `ONCE` |
| `next_due_date` | date | — |
| `assigned_to` | uuid | Pelaksana inspeksi |

**`hse_inspections`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `inspection_no` | text | `INSP-2610-001` |
| `schedule_id` | uuid | Opsional |
| `template_id` | uuid | FK → hse_inspection_templates |
| `location_id`, `asset_id` | uuid | — |
| `inspected_by` | uuid | — |
| `inspected_at` | timestamp | — |
| `status` | enum | `DRAFT`, `COMPLETED` |
| `result_summary` | text | — |

**`hse_inspection_answers`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `inspection_id` | uuid | FK → hse_inspections |
| `item_id` | uuid | FK → hse_inspection_template_items |
| `answer` | enum | `YES`, `NO`, `NA` |
| `note` | text | — |
| `photos` | text[] | — |
| `action_id` | uuid | Terisi FK → hse_actions bila butir kritikal gagal |

### 5.4 Insiden dan investigasi

**`incidents`** (nama tabel fisik: `incidents`, alias domain: `hse_incidents`)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `incident_no` | text | `INC-2610-001` |
| `incident_type` | enum | `FATALITY`, `LTI`, `MTI`, `FAI`, `NEAR_MISS`, `PROPERTY_DAMAGE`, `FIRE`, `ENVIRONMENTAL`, `VEHICLE_ACCIDENT` |
| `occurred_at` | timestamp | Waktu kejadian |
| `location_id` | uuid | FK → hse_locations |
| `department_id` | uuid | — |
| `company_id` | uuid | Perusahaan/kontraktor terkait |
| `description` | text | Kronologi fakta kejadian |
| `weather`, `lighting` | text | Kondisi cuaca & penerangan |
| `actual_severity` | enum | `NONE`, `MINOR`, `MODERATE`, `MAJOR`, `CATASTROPHIC` |
| `potential_severity` | enum | Sama seperti di atas |
| `estimated_loss` | numeric | Estimasi kerugian finansial |
| `reported_by`, `reported_at` | — | — |
| `status` | enum | `REPORTED`, `INVESTIGATING`, `ACTION`, `CLOSED` |
| `external_report_required` | boolean | Perlu pelaporan eksternal (ESDM/KAIT $\le$ 24 jam) |
| `external_report_status` | enum | `NOT_REQUIRED`, `PENDING`, `SUBMITTED` |
| `photos`, `attachments` | text[] | — |

**`incident_persons`** (nama tabel fisik: `incident_persons`, alias domain: `hse_incident_persons`)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `incident_id` | uuid | FK → incidents |
| `employee_id` | uuid | Karyawan internal (null bila kontraktor/tamu) |
| `person_name`, `company_name` | text | Untuk kontraktor/tamu |
| `role_in_incident` | enum | `INJURED`, `WITNESS`, `INVOLVED` |
| `injury_type` | text | Jenis cedera |
| `body_part` | text | Bagian tubuh |
| `treatment` | enum | `NONE`, `FIRST_AID`, `MEDICAL`, `HOSPITALIZED` |
| `lost_days` | int | Hari hilang (dasar perhitungan LTI & SR) |
| `returned_to_work_at` | date | Tanggal kembali bekerja |

**`incident_assets`** (nama tabel fisik: `incident_assets`, alias domain: `hse_incident_assets`)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `incident_id` | uuid | FK → incidents |
| `asset_id` | uuid | Unit/alat tambang terkait |
| `damage_description` | text | Uraian kerusakan aset |
| `repair_cost` | numeric | Biaya perbaikan |

**`incident_investigations`** (nama tabel fisik: `incident_investigations`, alias domain: `hse_incident_investigations`)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `incident_id` | uuid | FK → incidents |
| `method` | enum | `FIVE_WHY`, `FISHBONE`, `TAPROOT`, `OTHER` |
| `lead_id` | uuid | Ketua tim investigasi |
| `team_member_ids` | uuid[] | Anggota tim investigasi |
| `immediate_cause` | text | Penyebab langsung (KTA & TTA) |
| `root_causes` | jsonb | Daftar akar masalah + kategori 5-Why |
| `findings` | text | Temuan fakta lapangan |
| `started_at`, `completed_at` | timestamp | — |
| `status` | enum | `OPEN`, `IN_REVIEW`, `COMPLETED` |
| `lessons_learned` | text | Pelajaran K3 / Safety Alert |

### 5.5 Izin kerja (PTW)

**`hse_ptw_permits`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `permit_no` | text | `PTW-2610-031` |
| `permit_type` | enum | `HOT_WORK`, `WORK_AT_HEIGHT`, `CONFINED_SPACE`, `LOTO`, `EXCAVATION`, `LIFTING`, `ELECTRICAL`, `CHEMICAL` |
| `location_id` | uuid | FK → hse_locations |
| `work_description` | text | Deskripsi pekerjaan berisiko |
| `company_id` | uuid | Pelaksana (internal/kontraktor) |
| `requested_by` | uuid | Pemohon izin |
| `valid_from`, `valid_until` | timestamp | Masa berlaku jam izin |
| `hazards_controls` | jsonb | Checklist verifikasi bahaya dan APD |
| `status` | enum | `DRAFT`, `SUBMITTED`, `HSE_CHECK`, `APPROVED`, `ACTIVE`, `CLOSED`, `REJECTED`, `EXPIRED` |
| `approved_by`, `approved_at` | — | Otorisasi KTT / Safety Officer |
| `closed_by`, `closed_at` | — | Penutupan izin |
| `closure_note` | text | Pernyataan area aman ditinggalkan |

**`hse_ptw_workers`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `permit_id` | uuid | FK → hse_ptw_permits |
| `employee_id` | uuid | Kru pelaksana |
| `competency_check` | enum | `OK`, `EXPIRED`, `MISSING` |

**`hse_ptw_isolations`** (LOTO / Isolasi Energi)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `permit_id` | uuid | FK → hse_ptw_permits |
| `isolation_point` | text | Titik isolasi energi |
| `lock_no` | text | Nomor gembok & danger tag |
| `applied_by`, `applied_at` | — | Petugas pemasang isolasi |
| `removed_by`, `removed_at` | — | Petugas pelepas isolasi |

**`hse_ptw_handovers`** (serah terima antar shift)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `permit_id` | uuid | FK → hse_ptw_permits |
| `from_user`, `to_user` | uuid | Pengawas shift keluar & masuk |
| `handover_at` | timestamp | Waktu serah terima |
| `note` | text | Catatan kondisi lapangan |

### 5.6 Kompetensi

**`hse_training_courses`** (master kursus dan pelatihan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `code`, `name` | text | Mis. `SAF-01` / Defensive Driving Pit |
| `category` | enum | `INDUCTION`, `SAFETY`, `HEALTH`, `ENVIRONMENT`, `TECHNICAL`, `OTHER` |
| `validity_months` | int | Masa berlaku bulan (null = seumur hidup) |
| `provider` | text | Lembaga pelatihan (internal/BNSP) |

**`hse_training_requirements`** (matriks pelatihan wajib per jabatan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `position_id` | uuid | Jabatan karyawan |
| `course_id` | uuid | FK → hse_training_courses |
| `is_mandatory` | boolean | Wajib untuk jabatan |

Unik: `(position_id, course_id)`.

**`hse_training_sessions`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `course_id` | uuid | FK → hse_training_courses |
| `session_date` | date | Tanggal pelaksanaan |
| `trainer` | text | Instruktur |
| `location` | text | Ruang training |
| `capacity` | int | Kuota peserta |

**`hse_training_records`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `employee_id` | uuid | Peserta training |
| `course_id` | uuid | FK → hse_training_courses |
| `session_id` | uuid | Opsional |
| `completed_date` | date | Tanggal selesai |
| `score` | numeric | Nilai kelulusan |
| `result` | enum | `PASSED`, `FAILED`, `ATTENDED` |
| `valid_until` | date | Dihitung dari `validity_months` |
| `certificate_url` | text | Berkas sertifikat digital |

**`hse_employee_licenses`** (SIMPER/KIMPER, SIO, dll.)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `employee_id` | uuid | Pemegang lisensi |
| `license_type` | enum | `SIMPER`, `KIMPER`, `SIO`, `OPERATOR_CERT`, `FIRST_AID`, `OTHER` |
| `license_no` | text | Nomor SIMPER / lisensi |
| `class_or_unit` | text | Kelas alat/kendaraan (mis. DT, Exca, LV) |
| `issued_by` | text | Penerbit lisensi |
| `issued_date`, `expiry_date` | date | Tanggal terbit & kedaluwarsa |
| `file_url` | text | Scan berkas SIMPER |
| `status` | enum | `VALID`, `EXPIRING`, `EXPIRED`, `SUSPENDED` |

**`hse_inductions`** (induksi keselamatan pertambangan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `person_type` | enum | `EMPLOYEE`, `CONTRACTOR`, `VISITOR` |
| `employee_id` | uuid | Bila karyawan internal |
| `person_name`, `company_name`, `id_no` | text | Bila kontraktor/tamu luar |
| `induction_date` | date | Tanggal induksi |
| `test_score` | numeric | Nilai pemahaman K3 |
| `result` | enum | `PASSED`, `FAILED` |
| `valid_until` | date | Tanggal masa berlaku induksi |

**`hse_safety_talks`** (P5M / toolbox meeting)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `talk_date` | date | Tanggal briefing P5M |
| `department_id` | uuid | Departemen / seksi |
| `topic` | text | Topik bahaya K3 |
| `led_by` | uuid | Pengawas / supervisor pemateri |
| `notes` | text | Catatan masukan pekerja |
| `attendee_ids` | uuid[] | Daftar hadir kru tambang |

### 5.7 Kesehatan kerja (akses terbatas)

**`hse_mcu_records`** (pemeriksaan kesehatan berkala / MCU)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `employee_id` | uuid | Karyawan terperiksa |
| `mcu_type` | enum | `PRE_EMPLOYMENT`, `PERIODIC`, `SPECIAL`, `EXIT` |
| `mcu_date` | date | Tanggal pemeriksaan |
| `provider` | text | Klinik / RS rujukan |
| `fitness_result` | enum | `FIT`, `FIT_WITH_NOTES`, `TEMP_UNFIT`, `UNFIT` |
| `restrictions` | text | Pembatasan kerja / rekomendasi dokter |
| `valid_until` | date | Masa berlaku sertifikat MCU |
| `report_url` | text | Scan berkas medis rahasia |

**`hse_fit_for_work_checks`** (skrining kebugaran harian sebelum shift)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `employee_id` | uuid | Pekerja / operator |
| `check_date`, `shift` | date, text | Tanggal & shift kerja |
| `sleep_hours` | numeric | Durasi tidur lelap (< 5 jam auto-UNFIT) |
| `self_declaration` | jsonb | Kuesioner kondisi fisik harian |
| `result` | enum | `FIT`, `UNFIT`, `NEED_REVIEW` |
| `action_taken` | text | Tindakan penanganan (istirahat/konseling) |
| `checked_by` | uuid | Paramedis / pengawas pos |

**`hse_substance_tests`** (skrining narkoba & alkohol / breathalyzer)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `employee_id` | uuid | Karyawan teruji |
| `test_date` | date | Waktu pengujian |
| `test_type` | enum | `ALCOHOL`, `DRUG` |
| `trigger` | enum | `RANDOM`, `SCHEDULED`, `POST_INCIDENT`, `REASONABLE_SUSPICION` |
| `result` | enum | `NEGATIVE`, `POSITIVE`, `INCONCLUSIVE` |
| `action_taken` | text | Tindakan disiplin / medis |

**`hse_health_cases`** (kasus rawat jalan, PAK, & rujukan tambang)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `employee_id` | uuid | Pasien karyawan |
| `case_date` | date | Tanggal kunjungan klinik |
| `case_type` | enum | `COMPLAINT`, `OCCUPATIONAL_DISEASE`, `WORK_RELATED_INJURY`, `OTHER` |
| `is_work_related` | boolean | Terkait Penyakit Akibat Kerja (PAK) |
| `lost_days` | int | Hari istirahat dokter |
| `status` | enum | `OPEN`, `MONITORING`, `CLOSED` |
| `notes` | text | Catatan penanganan medis |

**`hse_hygiene_measurements`** (pengukuran higiene industri & lingkungan kerja)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `location_id` | uuid | Area kerja (pit, workshop, genset) |
| `parameter` | enum | `NOISE`, `DUST`, `LIGHTING`, `VIBRATION`, `TEMPERATURE`, `OTHER` |
| `measured_at` | date | Tanggal pengukuran |
| `value` | numeric | Nilai riil lapangan |
| `unit` | text | dB, mg/m³, lux, m/s² |
| `threshold` | numeric | Nilai Ambang Batas (NAB) regulasi |
| `status` | enum | `OK`, `NEAR_LIMIT`, `EXCEEDED` |

**Aturan akses:** tabel di bagian ini hanya dapat dibaca peran *Medis/HSE berwenang*. Peran lain melihat **status kelayakan turunan** (`FIT/UNFIT/EXPIRING`) tanpa detail diagnosis atau hasil.

### 5.8 Kontraktor & Mitra Kerja (CSMS)

**`hse_contractors`** (master perusahaan kontraktor & sub-kontraktor)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `company_name` | text | Nama PT / CV mitra kerja |
| `business_type` | enum | `MINING_SERVICES`, `HAULING`, `CIVIL`, `SECURITY`, `CATERING`, `OTHER` |
| `iu_jp_number` | text | Nomor Izin Usaha Jasa Pertambangan (IUJP) |
| `pjo_name` | text | Nama Penanggung Jawab Operasional (PJO) |
| `pjo_phone` | text | Kontak darurat PJO |
| `contract_start`, `contract_end` | date | Masa berlaku kontrak kerja di site |
| `csms_score` | numeric | Skor kualifikasi K3 (0–100) |
| `csms_grade` | enum | `HIGH_RISK`, `MEDIUM_RISK`, `LOW_RISK` |
| `is_active` | boolean | Status aktif beroperasi |

**`hse_contractor_assessments`** (evaluasi kualifikasi K3 kontraktor / CSMS)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `company_id` | uuid | FK → hse_contractors |
| `assessment_date` | date | Tanggal penilaian |
| `assessment_type` | enum | `PREQUALIFICATION`, `PERIODIC` |
| `score` | numeric | Skor total capaian (0–100) |
| `assessor_id` | uuid | Auditor / tim penilai HSE |
| `result` | enum | `APPROVED` ($\ge 75$), `CONDITIONAL` ($60-74$), `REJECTED` ($< 60$) |
| `notes` | text | Rekomendasi perbaikan SMKP |

**`hse_contractor_documents`** (legalitas perizinan K3 kontraktor)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `company_id` | uuid | FK → hse_contractors |
| `doc_type` | enum | `SMK3`, `PERMIT`, `INSURANCE`, `PERSONNEL_CERT`, `OTHER` |
| `doc_no` | text | Nomor polis / izin / sertifikat |
| `issued_date`, `expiry_date` | date | Masa berlaku dokumen legal |
| `file_url` | text | Berkas scan dokumen |
| `status` | enum | `VALID`, `EXPIRING`, `EXPIRED` |

**`hse_contractor_violations`** (pelanggaran K3 & sanksi mitra kerja)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `company_id` | uuid | FK → hse_contractors |
| `violation_date` | date | Waktu pelanggaran |
| `description` | text | Kronologi pelanggaran K3 |
| `severity` | enum | `MINOR`, `MAJOR`, `CRITICAL` |
| `sanction` | enum | `WARNING`, `WRITTEN_WARNING`, `STOP_WORK`, `PENALTY`, `TERMINATION_RECOMMENDED` |
| `status` | enum | `OPEN`, `RESOLVED` |

### 5.9 Lingkungan Hidup

**`hse_env_waste_b3_logs`** (logbook neraca limbah B3)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `log_date` | date | Tanggal masuk TPS |
| `waste_type` | text | Jenis limbah (oli bekas, filter, majun, aki bekas) |
| `source_location_id` | uuid | FK → hse_locations (sumber timbulan) |
| `quantity` | numeric | Jumlah berat/volume |
| `unit` | enum | `KG`, `LITER`, `UNIT` |
| `storage_location_id` | uuid | FK → hse_locations (TPS B3 berizin) |
| `storage_deadline` | date | Batas waktu simpan (default 90 hari) |
| `hauler` | text | Perusahaan pengangkut berizin KLHK |
| `manifest_no` | text | Nomor Festronik / manifes B3 |
| `hauled_date` | date | Tanggal pengangkutan keluar site |
| `status` | enum | `STORED`, `HAULED`, `PROCESSED` |

**`hse_env_monitoring_points`** (titik penaatan pemantauan lingkungan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `code`, `name` | text | Mis. `SP-01` / Outlet Kolam Pengendapan (Sediment Pond) |
| `media` | enum | `WATER`, `AIR`, `DUST`, `NOISE`, `SOIL` |
| `location_id` | uuid | FK → hse_locations |
| `latitude`, `longitude` | numeric | Titik koordinat GPS |

**`hse_env_parameters`** (master baku mutu lingkungan hidup)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `media` | enum | Sama seperti di atas |
| `name` | text | pH, TSS, Fe, Mn, PM10, PM2.5 |
| `unit` | text | mg/L, $\mu$g/Nm³, dB |
| `limit_min`, `limit_max` | numeric | Baku mutu izin lingkungan (AMDAL/UKL-UPL) |

**`hse_env_measurements`** (hasil uji laboratorium sampling)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `point_id` | uuid | FK → hse_env_monitoring_points |
| `parameter_id` | uuid | FK → hse_env_parameters |
| `measured_at` | date | Tanggal sampling |
| `value` | numeric | Nilai hasil uji lab |
| `lab` | text | Laboratorium penguji terakreditasi KAN |
| `status` | enum | `COMPLIES`, `NEAR_LIMIT`, `EXCEEDED` (dihitung otomatis) |
| `report_url` | text | Berkas sertifikat hasil uji (CoA) |

**`hse_env_reclamation_records`** (reklamasi dan revegetasi pascatambang)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `area_name` | text | Blok/pit yang direklamasi |
| `activity` | enum | `LANDSCAPING`, `TOPSOIL`, `PLANTING`, `MAINTENANCE` |
| `planned_ha`, `actual_ha` | numeric | Luas rencana vs realisasi (hektar) |
| `period_month` | date | Periode bulan pelaksanaan |
| `notes` | text | Jumlah bibit tertanam / jenis tanaman pionir |

### 5.10 Tanggap darurat

**`hse_emergency_team_members`** (tim tanggap darurat / ERT)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `employee_id` | uuid | Karyawan anggota tim rescue |
| `role` | enum | `COMMANDER`, `FIRE_FIGHTER`, `FIRST_AIDER`, `RESCUE`, `COMMUNICATION`, `OTHER` |
| `certification_ids` | uuid[] | Rujukan lisensi/sertifikat kompetensi rescue |
| `is_active` | boolean | Status kesiapan tugas darurat |

**`hse_emergency_drills`** (simulasi tanggap darurat & evaluasi)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `drill_date` | date | Waktu simulasi |
| `scenario` | enum | `FIRE`, `MEDICAL`, `SPILL`, `ROCKFALL`, `EVACUATION`, `OTHER` |
| `location_id` | uuid | FK → hse_locations |
| `participant_count` | int | Jumlah peserta drill |
| `response_time_sec` | int | Waktu tanggap respon darurat (detik) |
| `evaluation` | text | Catatan evaluasi kelemahan simulasi |
| `result` | enum | `GOOD`, `ADEQUATE`, `NEEDS_IMPROVEMENT` |
| `report_url` | text | Laporan hasil simulasi drill |

**`hse_emergency_equipment`** (sarana & prasarana proteksi darurat)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `equipment_type` | enum | `FIRE_EXTINGUISHER`, `FIRST_AID_BOX`, `EYEWASH`, `ALARM`, `HYDRANT`, `SPILL_KIT`, `OTHER` |
| `serial_no` | text | Nomor seri / kode registrasi |
| `location_id` | uuid | FK → hse_locations |
| `capacity` | text | Kapasitas (mis. 6 kg DCP, 50 L Foam) |
| `last_inspection_date`, `next_inspection_date` | date | Jadwal inspeksi berkala |
| `content_expiry_date` | date | Kedaluwarsa isi media pemadam/obat |
| `status` | enum | `GOOD`, `DUE`, `OVERDUE`, `DEFECTIVE`, `RETIRED` |

**`hse_emergency_assembly_points`** (titik kumpul evakuasi darurat)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `code`, `name` | text | Kode titik kumpul (mis. TK-01 Pit Office) |
| `location_id` | uuid | FK → hse_locations |
| `capacity` | int | Daya tampung evakuasi personel |
| `map_url` | text | Peta denah rute evakuasi |

**`hse_emergency_contacts`** (nomor darurat internal & eksternal)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `category` | enum | `INTERNAL`, `CLINIC`, `HOSPITAL`, `FIRE_DEPT`, `POLICE`, `OTHER` |
| `name`, `phone` | text | Nama instansi & kontak darurat |
| `notes` | text | Saluran radio HT / narahubung |

### 5.11 APD dan peralatan

**`hse_ppe_items`** (katalog master APD)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `code`, `name` | text | Helm, sepatu tambang, rompi reflektif, body harness |
| `category` | enum | `HEAD`, `EYE`, `EAR`, `RESPIRATORY`, `HAND`, `BODY`, `FOOT`, `FALL_PROTECTION`, `OTHER` |
| `replace_interval_months` | int | Masa pakai normal / interval penggantian (bulan) |
| `inventory_item_id` | uuid | Tautan integrasi stok ke GudangSite |

**`hse_ppe_standards`** (standar matrik APD wajib per jabatan/area)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `position_id` | uuid | Jabatan / posisi kerja |
| `location_type` | enum | Spesifik area pit / workshop / office |
| `ppe_item_id` | uuid | FK → hse_ppe_items |
| `quantity` | int | Jumlah standar wajib dibagikan |

**`hse_ppe_issuances`** (distribusi & pengembalian APD per karyawan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `employee_id` | uuid | Penerima APD |
| `ppe_item_id` | uuid | FK → hse_ppe_items |
| `size` | text | Ukuran sepatu/helm/rompi |
| `quantity` | int | Jumlah unit diserahkan |
| `issued_date` | date | Tanggal penyerahan |
| `replace_due_date` | date | Batas jadwal penggantian otomatis |
| `reason` | enum | `NEW_HIRE`, `REPLACEMENT`, `DAMAGED`, `LOST`, `ADDITIONAL` |
| `returned_date` | date | Tanggal pengembalian (saat mutasi/keluar) |
| `issued_by` | uuid | Petugas logistik K3 / HSE |

### 5.12 Audit dan temuan (SMKP Minerba)

**`hse_smkp_elements`** (7 Elemen baku SMKP Permen ESDM No. 26/2018)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `element_no` | int | 1 sampai 7 |
| `name` | text | Kebijakan, Perencanaan, Organisasi, Implementasi, Evaluasi, Dokumentasi, Tinjauan |
| `weight_percent` | numeric | Bobot persentase standar SMKP |
| `sub_element_count` | int | Jumlah klausul wajib |

**`hse_audits`** (program & jadwal audit K3 pertambangan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `audit_no` | text | `AUD-2610-001` |
| `audit_type` | enum | `INTERNAL`, `EXTERNAL`, `CONTRACTOR`, `REGULATOR` |
| `scope` | text | Ruang lingkup & kriteria standar audit |
| `audit_date_start`, `audit_date_end` | date | Rentang tanggal audit lapangan |
| `lead_auditor` | text | Nama ketua auditor / lembaga audit |
| `overall_score` | numeric | Skor kesesuaian penerapan (%) |
| `status` | enum | `PLANNED`, `IN_PROGRESS`, `REPORTED`, `CLOSED` |
| `report_url` | text | Laporan audit lengkap (PDF) |

**`hse_audit_findings`** (ketidaksesuaian temuan audit SMKP)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `audit_id` | uuid | FK → hse_audits |
| `finding_no` | text | Nomor registrasi temuan |
| `element_or_clause` | text | Klausul / elemen SMKP yang dilanggar |
| `category` | enum | `MAJOR`, `MINOR`, `OBSERVATION`, `OPPORTUNITY` |
| `description` | text | Bukti ketidaksesuaian objektif |
| `evidence` | text[] | Lampiran foto/dokumen temuan |
| `due_date` | date | Batas waktu tindak lanjut (CAPA) |
| `status` | enum | `OPEN`, `IN_ACTION`, `VERIFY`, `CLOSED` |

*Catatan integrasi:* Setiap temuan berstatus MAJOR/MINOR otomatis menghasilkan tindakan korektif di `hse_actions` (`source_type = 'AUDIT'`).

### 5.13 Dokumen dan regulasi

**`hse_documents`** (pengendalian dokumen K3LH terstruktur)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `doc_no` | text | Mis. `HSE-SOP-012` |
| `title` | text | Judul dokumen resmi |
| `doc_type` | enum | `POLICY`, `MANUAL`, `SOP`, `WI`, `JSA`, `FORM`, `ERP` |
| `revision_no` | int | Nomor revisi berjalan |
| `effective_date` | date | Tanggal mulai berlaku |
| `next_review_date` | date | Jadwal tinjau berkala |
| `owner_id` | uuid | Penanggung jawab dokumen |
| `file_url` | text | Berkas dokumen digital |
| `status` | enum | `DRAFT`, `ACTIVE`, `UNDER_REVIEW`, `OBSOLETE` |
| `tags` | text[] | Tag kata kunci pencarian |

**`hse_document_revisions`** (riwayat revisi dokumen)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `document_id` | uuid | FK → hse_documents |
| `revision_no` | int | Nomor revisi baru |
| `change_summary` | text | Ringkasan riwayat perubahan |
| `file_url` | text | Berkas versi revisi |
| `approved_by`, `approved_at` | — | Otorisasi KTT / Pengesah |

**`hse_legal_register`** (inventarisasi regulasi hukum & evaluasi kepatuhan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `regulation_title` | text | Judul undang-undang / permen / kepmen |
| `regulation_no` | text | Nomor dan tahun regulasi |
| `issuer` | enum | `ESDM_MINERBA`, `KEMENAKER`, `KLHK`, `PEMDA`, `OTHER` |
| `requirement_summary` | text | Ringkasan pasal dan kewajiban hukum |
| `is_applicable` | boolean | Relevan terhadap operasional site |
| `compliance_status` | enum | `COMPLIANT`, `PARTIAL`, `NON_COMPLIANT`, `NOT_ASSESSED` |
| `pic_id` | uuid | Penanggung jawab pemenuhan |
| `last_assessed_at` | date | Tanggal evaluasi kepatuhan terakhir |
| `file_url` | text | Tautan berkas bukti kepatuhan |

**`hse_mandatory_reports`** (pelaporan wajib ke instansi pemerintah)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `report_name` | text | Nama laporan (Laporan Triwulan K3, Neraca B3, dll.) |
| `legal_basis` | text | Dasar hukum acuan (Kepmen 1827/2018 Lamp. III) |
| `recipient_agency` | enum | `ESDM_KAIT`, `DLH_KLHK`, `DISNAKER`, `INTERNAL`, `OTHER` |
| `period_type` | enum | `MONTHLY`, `QUARTERLY`, `SEMESTER`, `ANNUAL` |
| `period_label` | text | Label periode (mis. Triwulan II 2026) |
| `deadline_date` | date | Batas tenggat penyerahan wajib |
| `submission_date` | date | Tanggal riil penyerahan |
| `status` | enum | `PENDING`, `SUBMITTED`, `OVERDUE`, `VERIFIED` |
| `receipt_no` | text | Nomor tanda terima registrasi surat |
| `receipt_file_url` | text | Scan tanda terima resmi instansi |

### 5.14 Notifikasi

**`hse_alerts`** (alert sistem K3 yang digenerate otomatis)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `alert_type` | enum | `CAPA_OVERDUE`, `LICENSE_EXPIRING`, `MCU_DUE`, `TRAINING_EXPIRING`, `INSPECTION_DUE`, `EQUIPMENT_DUE`, `DOC_REVIEW_DUE`, `REPORT_DUE`, `CONTRACTOR_DOC_EXPIRING`, `WASTE_STORAGE_DEADLINE`, `RISK_REVIEW_DUE` |
| `severity` | enum | `INFO`, `WARNING`, `CRITICAL` |
| `ref_type`, `ref_id` | text, uuid | Objek rujukan |
| `message` | text | Deskripsi pesan peringatan |
| `due_date` | date | Tenggat waktu |
| `assigned_to` | uuid | Penerima notifikasi |
| `status` | enum | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` |

### 5.15 Relasi ringkas arsitektur database

```
hse_locations ──< hazard_reports, incidents, hse_ptw_permits, hse_inspections,
                  hse_emergency_equipment, hse_env_monitoring_points, hse_env_waste_b3_logs

hazard_reports ─────────┐
incidents ──────────────┤
hse_inspections ────────┼──< hse_actions   (source_type + source_id)
hse_audit_findings ─────┤
hse_emergency_drills ───┤
hse_risk_register ──────┘

incidents 1──< incident_persons / incident_assets / incident_investigations
hse_inspection_templates 1──< hse_inspection_template_items
hse_inspections 1──< hse_inspection_answers ──> hse_actions
hse_ptw_permits 1──< hse_ptw_workers / hse_ptw_isolations / hse_ptw_handovers
hse_training_courses 1──< hse_training_requirements / hse_training_records
users/employees 1──< hse_employee_licenses / hse_training_records / hse_mcu_records /
                     hse_ppe_issuances / incident_persons / hse_fit_for_work_checks
hse_audits 1──< hse_audit_findings
hse_documents 1──< hse_document_revisions
hse_env_monitoring_points 1──< hse_env_measurements >── hse_env_parameters
hse_contractors 1──< hse_contractor_assessments / hse_contractor_documents / hse_contractor_violations
```

---

## 6. Aturan Bisnis

1. **Risiko dihitung otomatis:** `risk_score = likelihood × consequence`; level dari `hse_risk_matrix_config`. Pengguna tidak mengetik level secara manual.
2. **Semua tindakan lewat satu tabel** (`hse_actions`). Hazard, insiden, inspeksi, audit, dan drill tidak punya tabel tindakan sendiri.
3. **Status CAPA `OVERDUE`** diberikan otomatis oleh job harian saat `due_date` lewat dan status belum `CLOSED`.
4. **Penutupan hazard/insiden** hanya bisa dilakukan bila semua CAPA terkait berstatus `CLOSED` (atau dibatalkan dengan alasan).
5. **Hari tanpa LTI** = selisih hari antara hari ini dan `occurred_at` LTI/Fatality terakhir; rekor disimpan terpisah.
6. **Kelayakan operasi karyawan** (`fit_to_operate`) bernilai tidak layak bila salah satu berikut berlaku: SIMPER/lisensi kedaluwarsa, MCU `UNFIT/TEMP_UNFIT` atau kedaluwarsa, pelatihan wajib jabatan kedaluwarsa. Status ini dibaca oleh modul Karyawan dan Izin kerja.
7. **Izin kerja tidak bisa disetujui** bila ada pekerja dengan `competency_check ≠ OK`.
8. **Izin kerja otomatis `EXPIRED`** saat `valid_until` terlewat tanpa penutupan; sistem membuat alert ke HSE.
9. **Inspeksi:** jawaban `NO` pada butir `is_critical` otomatis membuat CAPA dan menandai objek (alat/area) perlu tindak lanjut sebelum dipakai.
10. **Jam kerja (`hse_manhours`) wajib terisi** sebelum LTIFR/TRIR periode tersebut ditampilkan sebagai final; bila belum, tampil dengan label "sementara".
11. **Data kesehatan tidak pernah ditampilkan ke peran umum**; yang dibagikan hanya status kelayakan turunan.
12. **Pengukuran lingkungan**: status `COMPLIES/NEAR_LIMIT/EXCEEDED` dihitung dari `hse_env_parameters`; nilai melampaui otomatis membuat alert `CRITICAL` dan saran pembuatan CAPA.
13. **Limbah B3 melewati `storage_deadline`** memicu alert dan ditandai di dashboard.
14. **Dokumen `OBSOLETE`** tidak muncul dalam pencarian default, tetapi riwayatnya tetap tersimpan.
15. **Data audit tidak dihapus permanen**; perubahan dicatat (siapa, kapan, apa).

---

## 7. Definisi KPI

| KPI | Rumus |
|---|---|
| Hari tanpa LTI | Hari sejak LTI/fatality terakhir |
| LTIFR | Jumlah LTI × 1.000.000 ÷ total jam kerja |
| TRIR | Jumlah kasus tercatat (fatality + LTI + MTI) × 1.000.000 ÷ total jam kerja |
| Severity rate | Total hari hilang × 1.000.000 ÷ total jam kerja |
| Rasio near miss | Jumlah near miss ÷ jumlah insiden cedera |
| Hazard terbuka | Jumlah hazard berstatus belum `CLOSED`, dikelompokkan per level |
| Waktu penutupan hazard | Rata-rata hari dari laporan sampai `CLOSED` |
| Ketepatan penutupan CAPA | CAPA ditutup sebelum tenggat ÷ total CAPA ditutup |
| Kepatuhan pelatihan | Karyawan dengan seluruh pelatihan wajib valid ÷ total karyawan aktif |
| Kepatuhan MCU | Karyawan dengan MCU berlaku ÷ total karyawan aktif |
| Kepatuhan SIMPER | Operator dengan SIMPER berlaku ÷ total operator |
| Inspeksi terlaksana | Inspeksi selesai ÷ inspeksi terjadwal pada periode |
| Cakupan safety talk | Departemen yang menjalankan P5M ÷ total departemen (per minggu) |
| Pemenuhan baku mutu | Pengukuran memenuhi ÷ total pengukuran |
| Kesiapan darurat | Peralatan darurat berstatus `GOOD` ÷ total peralatan darurat |
| Skor kontraktor | Rata-rata skor asesmen terakhir per kontraktor |

> Catatan: faktor pengali (1.000.000 atau 200.000) dan definisi kasus tercatat dapat disesuaikan dengan kebijakan perusahaan; buat sebagai pengaturan, bukan nilai tetap di kode.

---

## 8. Hak Akses

| Peran | Lihat | Buat/ubah | Menyetujui | Catatan |
|---|---|---|---|---|
| Admin HSE | Semua | Semua | Izin kerja, CAPA, dokumen | Akses penuh termasuk data kesehatan |
| Petugas medis | Kesehatan kerja (penuh), insiden (terkait) | Kesehatan kerja | — | Satu-satunya yang melihat detail medis |
| Supervisor/Foreman | Data departemennya | Lapor hazard/insiden, isi inspeksi, ajukan izin kerja | CAPA departemennya | — |
| Kepala departemen | Data departemennya | Sama seperti supervisor | Izin kerja (level departemen) | — |
| Manajemen | Ringkasan, laporan, audit | Tidak | Dokumen kebijakan, laporan | Tanpa detail medis |
| Karyawan | Dokumen/SOP, status pribadi (pelatihan, SIMPER, MCU berlaku/tidak) | Lapor hazard dan near miss | — | Dapat melapor dari mobile |
| Kontraktor (eksternal) | Datanya sendiri | Lapor hazard, ajukan izin kerja | — | Opsional, tergantung model SaaS |

---

## 9. Integrasi dengan Modul OMOS Lain

| Modul | Integrasi |
|---|---|
| **Karyawan / Database Karyawan** | Lisensi, MCU, pelatihan, dan APD menempel di profil karyawan; status `fit_to_operate` ditampilkan di profil |
| **Pergerakan Karyawan (Masuk)** | Karyawan baru wajib selesai induksi, MCU pra-kerja, dan serah terima APD sebelum onboarding berstatus selesai |
| **Pergerakan Karyawan (Keluar)** | Pengembalian APD dan ID tambang masuk checklist clearance; MCU keluar dicatat |
| **MPP** | Kebutuhan jabatan HSE (officer, medis, ERT, pengawas) direncanakan di MPP |
| **Absensi** | Sumber jam kerja untuk `hse_manhours` dan data shift untuk fit for work |
| **Alat berat / produksi** | Insiden dan inspeksi dihubungkan ke unit/aset; unit yang gagal inspeksi kritikal ditandai |
| **GudangSite** | Stok APD dan alat darurat; permintaan otomatis saat stok di bawah minimum |
| **Kontraktor / Vendor** | Data perusahaan kontraktor dipakai bersama asesmen dan statistik HSE |

---

## 10. Notifikasi dan Alert

| Alert | Pemicu | Penerima | Saluran |
|---|---|---|---|
| CAPA lewat tenggat | `due_date` terlewat | PIC + atasan + HSE | In-app, WhatsApp/email |
| Lisensi akan habis | 60/30/7 hari sebelum | Karyawan, atasan, HSE | In-app, email |
| MCU jatuh tempo | 60/30 hari sebelum | Karyawan, HSE/medis | In-app, email |
| Pelatihan akan habis | 60/30 hari sebelum | Karyawan, atasan | In-app |
| Inspeksi terjadwal/terlambat | Hari H dan H+1 | Pelaksana, HSE | In-app, push mobile |
| Peralatan darurat jatuh tempo | 14 hari sebelum | HSE, ERT | In-app |
| Insiden baru (jenis berat) | Saat dilaporkan | Manajemen + HSE | Push, WhatsApp |
| Risiko ekstrem baru | Saat dinilai | HSE + kepala departemen | Push, WhatsApp |
| Pengukuran melampaui baku mutu | Saat input hasil | HSE, lingkungan | In-app, email |
| Batas simpan limbah B3 | 14 hari sebelum | PIC lingkungan | In-app |
| Dokumen perlu tinjau | 30 hari sebelum | Pemilik dokumen | In-app, email |
| Laporan wajib jatuh tempo | 14/7 hari sebelum | PIC pelaporan | In-app, email |

---

## 11. Tahapan Implementasi

| Fase | Cakupan | Nilai |
|---|---|---|
| 1 | Master (lokasi, matriks risiko, kategori), **Hazard**, **hse_actions (CAPA)**, form laporan mobile, **Ringkasan** dasar | Pelaporan lapangan mulai jalan, tindak lanjut terpantau |
| 2 | **Insiden dan investigasi**, `hse_manhours`, **Laporan dan statistik** (LTIFR, TRIR, hari tanpa LTI) | Angka keselamatan resmi otomatis |
| 3 | **Kompetensi** (lisensi, matriks pelatihan, induksi, safety talk), status `fit_to_operate`, integrasi profil karyawan | Kelayakan personel terkendali |
| 4 | **Izin kerja** (termasuk LOTO), **Inspeksi** dengan templat dan jadwal | Kontrol pekerjaan berisiko |
| 5 | **Kesehatan kerja** (MCU, FFW, tes, higiene industri) dengan pembatasan akses | Kesehatan terintegrasi, data aman |
| 6 | **Tanggap darurat**, **APD dan peralatan** (terhubung GudangSite) | Kesiapan darurat dan logistik APD |
| 7 | **Lingkungan**, **Kontraktor** | Kepatuhan lingkungan dan pengelolaan kontraktor |
| 8 | **Audit dan temuan**, **Dokumen dan regulasi**, notifikasi lengkap, laporan terjadwal, mode layar besar | Kepatuhan menyeluruh dan siap audit |

---

## 12. Catatan UX

- Jadikan **pelaporan hazard** sebagai jalur tercepat di seluruh aplikasi (tombol selalu terlihat, bisa offline-first bila memungkinkan, karena sinyal di area tambang sering lemah).
- Gunakan **bahasa lapangan** pada label: "Lapor hazard", "Near miss", "P5M", "Izin kerja", bukan istilah ERP generik.
- Setiap angka KPI yang dapat diklik harus membawa pengguna ke daftar data pembentuknya (drill-down), agar angka bisa dipertanggungjawabkan.
- Empty state yang ramah, mis. *"Belum ada hazard terbuka. Kerja bagus"* + tombol `Lapor hazard`.
- Tabel di mobile berubah menjadi kartu; drawer detail menjadi halaman penuh; checklist inspeksi dirancang satu pertanyaan per layar dengan tombol besar Ya/Tidak/N-A.
- Dukung cetak: formulir izin kerja, laporan investigasi, dan laporan bulanan harus punya tampilan cetak/PDF yang rapi dengan kolom tanda tangan.
- Mode **layar besar** pada Ringkasan (angka besar, refresh otomatis) untuk dipasang di pos HSE atau ruang briefing.
- Hindari mengandalkan warna saja; selalu sertakan teks/angka status.
- Setiap sub-halaman baru dibuat sebagai file contoh HTML di folder `sample page` lebih dulu (mengikuti pola pada bagian 0), disetujui, baru diimplementasikan ke aplikasi.

---

## 13. Setup Master — Jam kerja karyawan (migrasi 092)

**Tujuan:** sumber resmi jam kerja karyawan internal untuk LTIFR, TRIR, severity rate, dan jam kerja aman. Menggantikan input manual `hse_manhours` untuk karyawan internal; input manual tetap untuk kontraktor yang terdaftar di HSE → Kontraktor.

**Acuan tampilan:** `admin-dashboard/assets/sample page/omos_hse_setup_jam_kerja_layout.html`.

| Sub-tab | Isi |
|---|---|
| Standar per jabatan | Jam kerja per hari per jabatan (+ departemen), berlaku mulai tanggal tertentu, versi & riwayat. Form memakai dropdown checklist multi-pilih: jabatan, departemen, nama karyawan. Semua karyawan dicentang → aturan jabatan; sebagian → aturan per karyawan. |
| Standar per karyawan | Nilai akhir tiap karyawan aktif dengan sumber (Jabatan / Individu / Belum diatur), override individu (alasan wajib, multi pilih), akhiri override. |
| Rekap jam kerja | Periode dari–sampai; hari hadir dari Rekap Performa; total jam = jam per hari yang berlaku pada tanggal hadir; rincian harian; ekspor CSV; kirim & kunci per bulan ke jam kerja HSE, buka kunci dengan alasan. |

**Aturan:**
1. Hari hadir = keterangan manual `hadir_manual`, atau presensi kamera tanpa keterangan manual pada tanggal itu (sama dengan Rekap Performa). Tanggal = `absensi.tanggal_kerja` (tanggal shift dimulai).
2. Prioritas jam per hari: override individu > jabatan + departemen > jabatan. Tanpa aturan = *Belum diatur*: hari hadir tercatat, jam tidak dihitung (bukan 0).
3. Karyawan nonaktif tetap dihitung untuk hari hadirnya di masa lalu.
4. Jam kerja bulanan untuk statistik: **Final** (periode terkunci) / **Sementara** atau **Berjalan** (dihitung live dari presensi) / **Manual lama** (input manual internal sebelum fitur ini) / **Kosong** (rasio tidak dihitung). Ditambah jam kontraktor.
5. Periode hanya bisa dikirim setelah bulan berakhir. Tanggal berlaku aturan baru tidak boleh jatuh pada bulan yang sudah terkunci.

**Tabel:** `hse_workhour_standards`, `hse_workhour_periods`, `hse_workhour_period_lines`, `hse_workhour_audit`, kolom `hse_manhours.workhour_period_id`.
