# Panduan Pengguna Input Fuel dan Database Fuel OMOS

**Versi panduan:** 1.0  
**Tanggal pemeriksaan implementasi:** 24 September 2026  
**Modul:** Mining Production → `2. Input Fuel`  
**Satuan dasar persediaan:** Liter observed  
**Status dokumen:** sesuai implementasi repository saat ini

---

## 1. Tujuan panduan

Panduan ini menjelaskan penggunaan dua fungsi yang berbeda tetapi saling berhubungan:

1. **Input Fuel** — mencatat pengisian Fuel aktual ke unit berdasarkan pembacaan HM dan/atau KM.
2. **Database Fuel** — memantau persediaan Fuel per lokasi, ledger, FIFO, stock opname, dan analitik penggunaan.

Keduanya tidak boleh dianggap sebagai data yang sama.

| Fungsi | Sumber data utama | Tujuan |
| --- | --- | --- |
| Input Fuel | Log pengisian unit | Mengetahui Fuel aktual, perubahan HM/KM, L/HM, L/KM, target, variance, dan status pemeriksaan. |
| Database Fuel | Transaksi inventory | Mengetahui Fuel masuk, keluar, transfer, saldo lokasi, FIFO, nilai persediaan, dan hasil stock opname. |

> **Penting:** mencatat pengisian unit pada Input Fuel tidak sama dengan mencatat kedatangan Fuel dari supplier. Input Fuel adalah pemakaian ke unit; kedatangan Fuel adalah transaksi `receipt` pada Database Fuel.

---

## 2. Status fitur yang tersedia saat ini

### 2.1 Sudah tersedia pada halaman web

- pencatatan pengisian Fuel per unit;
- pembacaan HM aktual;
- pembacaan KM/odometer;
- perhitungan ΔHM, ΔKM, L/HM, dan L/KM;
- target Fuel berdasarkan standard Fuel Rate unit;
- variance Fuel dan alert data;
- edit data Fuel;
- approval Draft, Submitted, Verified, dan Rejected;
- audit trail;
- bulk delete;
- undo/redo selama sesi kerja;
- import dan export Excel Input Fuel;
- Database Fuel: Overview;
- Database Fuel: Ledger read-only;
- Database Fuel: FIFO & Stock read-only;
- Database Fuel: pembuatan dan approval Stock Opname;
- Database Fuel: Analytics;
- export CSV Database Fuel.

### 2.2 Form operasional Database Fuel

Workspace Database Fuel menyediakan form Receipt, Opening Balance, Transfer, Posting,
Reversal, Void, master produk/lokasi, dan Mapping Sumber. Tab **Mapping Sumber** juga
menampilkan antrean rekonsiliasi dan dapat menerapkan mapping yang valid ke log Input
Fuel yang belum tertaut. Detail komposisi FIFO per transaksi keluar masih dibaca melalui
tab FIFO & Stock dan belum mempunyai drill-down per transaksi.

---

## 3. Persiapan sebelum menggunakan Input Fuel

Pastikan data berikut sudah tersedia:

1. Unit sudah terdaftar pada **List Equipment**.
2. Kode unit, jenis alat, class, dan model sudah benar.
3. `Fuel Rate` unit sudah diatur dalam satuan **Liter/HM**.
4. Unit yang hanya menggunakan odometer sudah ditandai sebagai **Km-only**.
5. Shift sudah tersedia dan aktif.
6. Pembacaan HM/KM berasal dari counter aktual unit, bukan perkiraan.
7. Volume Fuel menggunakan jumlah Liter yang benar-benar diisikan.
8. Fuel ticket atau bukti pengisian tersedia bila prosedur site mewajibkannya.

Untuk Database Fuel, tambahan persiapan yang diperlukan:

1. produk Fuel aktif;
2. lokasi/tank/Fuel Truck aktif;
3. opening balance atau receipt awal;
4. mapping sumber Fuel yang unik;
5. user pembuat dan user penyetuju stock opname yang berbeda.

---

## 4. Membuka halaman Input Fuel

1. Login sebagai admin yang mempunyai akses Mining Production.
2. Buka menu **Mine Planning**.
3. Pilih **2. Input Fuel**.
4. Tentukan **Tahun** dan **Bulan** pada bagian atas halaman.
5. Tunggu sampai kartu KPI dan daftar unit selesai dimuat.

Halaman awal menampilkan:

- tombol Database Fuel;
- Export dan Import;
- Mode Hapus;
- Undo dan Redo;
- Simpan Perubahan;
- filter unit;
- KPI periode;
- kelompok kartu berdasarkan jenis alat;
- kartu detail masing-masing unit.

---

## 5. Memahami filter Input Fuel

### 5.1 Tahun dan Bulan

Menentukan periode data yang akan dibaca dan diedit. Perubahan periode akan memuat ulang seluruh kartu unit.

### 5.2 Pencarian unit

Kolom pencarian dapat digunakan untuk mencari:

- kode unit;
- class unit;
- model unit.

### 5.3 Jenis Alat

Menyaring unit berdasarkan jenis, misalnya Excavator, Dump Truck, Dozer, Fuel Truck, atau jenis lain yang tersedia pada List Equipment.

### 5.4 Class

Menyaring unit berdasarkan class equipment.

### 5.5 Status

| Filter | Arti |
| --- | --- |
| Semua Status | Menampilkan semua unit. |
| Terkoneksi | Unit mempunyai log dan tidak mempunyai anomali pada periode aktif. |
| Anomali | Unit mempunyai minimal satu log yang perlu diperiksa. |
| Belum Ada Data | Unit belum memiliki log pengisian pada periode aktif. |

Tombol **Reset Filter** mengembalikan filter ke kondisi awal.

---

## 6. Memahami KPI Input Fuel

| KPI | Penjelasan |
| --- | --- |
| Fuel Actual | Jumlah seluruh Fuel yang diisikan pada data yang tampil, dalam Liter. |
| Fuel Target | Standard Fuel Rate × total ΔHM valid. |
| Variance | Selisih Fuel aktual terhadap target, dalam Liter dan persen. |
| Weighted Fuel/HM | Total Fuel ÷ total ΔHM valid. |
| Weighted Fuel/KM | Total Fuel ÷ total ΔKM valid untuk unit mobile. |
| Data Alerts | Jumlah unit yang mempunyai data perlu diperiksa. |

KPI mengikuti filter aktif. Bila filter hanya menampilkan satu jenis/class/unit, KPI juga hanya menghitung data tersebut.

---

## 7. Memahami kartu unit

Setiap kartu unit menampilkan:

- kode unit;
- class dan model;
- total Fuel periode;
- standard Fuel Rate;
- weighted L/HM;
- weighted L/KM atau target;
- variance;
- status koneksi data.

Klik header kartu untuk membuka detail transaksi unit.

Pada detail tersedia:

| Kolom | Arti |
| --- | --- |
| Tanggal | Tanggal operasional pengisian. |
| Shift | Shift saat pengisian. |
| HM | Pembacaan HM aktual pada saat pengisian. |
| ΔHM | Selisih HM terhadap pembacaan sebelumnya. |
| KM | Pembacaan odometer aktual. |
| ΔKM | Selisih KM terhadap pembacaan sebelumnya. |
| Fuel (L) | Volume yang benar-benar diisikan. |
| Ltr/HM | Konsumsi berdasarkan ΔHM. |
| Ltr/KM | Konsumsi berdasarkan ΔKM. |
| Variance | Deviasi terhadap target Fuel. |
| Status | Kualitas data dan approval. |
| Keterangan | Fuel ticket dan catatan. |

---

## 8. Cara input pengisian Fuel harian

### 8.1 Input melalui kartu unit

1. Pilih Tahun dan Bulan.
2. Cari kode unit menggunakan kolom pencarian.
3. Buka kelompok jenis alat.
4. Klik kartu unit yang akan diisi.
5. Klik **+ Insert Data**.
6. Isi **Tanggal** sesuai tanggal operasional.
7. Pilih **Shift**.
8. Isi **HM** dengan angka counter aktual.
9. Isi **KM/Odometer** bila unit menggunakan odometer atau termasuk unit mobile.
10. Isi **Fuel (L)** dengan jumlah Liter yang benar-benar masuk ke unit.
11. Isi **Ticket** bila tersedia.
12. Isi **Keterangan** bila ada informasi tambahan.
13. Periksa hasil kalkulasi sementara.
14. Klik **Simpan** pada bagian atas halaman.
15. Tunggu animasi penyimpanan selesai dan pastikan tombol kembali ke kondisi tersimpan.

### 8.2 Kolom wajib

Untuk unit normal berbasis HM:

- tanggal;
- shift;
- HM aktual;
- Fuel lebih besar dari 0 Liter.

Untuk unit `Km-only`:

- tanggal;
- shift;
- KM/Odometer;
- Fuel lebih besar dari 0 Liter;
- HM bersifat opsional.

Untuk unit mobile yang mendukung analisis jarak, KM harus diisi agar L/KM dapat dihitung dengan benar.

### 8.3 Contoh input

Pembacaan sebelumnya:

- HM: 1.250,00;
- KM: 24.000,00.

Pembacaan saat pengisian:

- HM: 1.258,00;
- KM: 24.120,00;
- Fuel diisikan: 320 Liter;
- standard Fuel Rate: 35 L/HM.

Hasil:

```text
ΔHM          = 1.258 - 1.250 = 8 HM
ΔKM          = 24.120 - 24.000 = 120 KM
Fuel/HM      = 320 / 8 = 40 L/HM
Fuel/KM      = 320 / 120 = 2,6667 L/KM
Target Fuel  = 35 × 8 = 280 Liter
Variance     = 320 - 280 = +40 Liter
Variance %   = 40 / 280 × 100% = +14,2857%
```

Tampilan dapat membulatkan angka, tetapi kalkulasi internal menggunakan presisi penuh.

---

## 9. Baseline HM dan KM

Sistem menghitung ΔHM dan ΔKM terhadap pembacaan sebelumnya untuk unit yang sama.

### 9.1 Pengisian pertama

Pada pembacaan pertama, sistem belum mempunyai baseline sebelumnya. Akibatnya:

- HM/KM aktual tetap tersimpan;
- ΔHM atau ΔKM belum dapat dihitung;
- L/HM atau L/KM belum tampil;
- status dapat menampilkan `Periksa` dengan kode baseline belum tersedia.

Pembacaan pertama tidak boleh diisi dengan angka selisih. Tetap masukkan angka counter aktual.

### 9.2 Pembacaan berikutnya

Pembacaan harus lebih besar daripada pembacaan sebelumnya, kecuali memang terjadi reset atau penggantian meter.

> Jangan mengisi HM harian seperti `8 jam` bila angka counter aktual adalah `1.258`. Sistem membutuhkan counter kumulatif untuk menghitung delta.

---

## 10. Reset atau penggantian HM/odometer

Gunakan fungsi reset hanya jika:

- HM meter diganti;
- odometer diganti;
- counter benar-benar kembali ke angka lebih kecil;
- terdapat kejadian teknis yang dapat dibuktikan.

Langkah melalui form Pengisian Fuel Aktual:

1. pilih unit;
2. isi tanggal dan shift;
3. isi pembacaan meter yang baru;
4. centang **Reset/penggantian HM atau odometer**;
5. isi **Alasan reset** secara jelas;
6. tambahkan URL lampiran bila tersedia;
7. simpan.

Pada record reset:

- sistem tidak memakai selisih terhadap counter lama untuk menghitung rasio;
- record menjadi titik baseline baru;
- alasan reset tersimpan untuk audit.

Jangan memakai reset untuk memperbaiki salah ketik biasa. Gunakan edit data dan koreksi nilai yang salah.

---

## 11. Memahami status kualitas data

Status kualitas dihitung otomatis dan berbeda dengan status approval.

| Status | Makna |
| --- | --- |
| Normal | Tidak ditemukan masalah utama. |
| Periksa | Ada peringatan, misalnya baseline belum tersedia, variance tinggi, atau KM belum lengkap. |
| Anomali | Ditemukan konflik kritis, misalnya HM tidak meningkat atau duplikasi unit/tanggal/shift. |

Peringatan yang digunakan sistem saat ini:

| Kode | Penjelasan | Tindakan |
| --- | --- | --- |
| `HM_BASELINE_MISSING` | Belum ada pembacaan HM sebelumnya. | Pastikan ini benar-benar transaksi pertama. |
| `HM_NOT_INCREASING` | HM tidak lebih besar dari sebelumnya. | Koreksi HM atau gunakan prosedur reset bila meter benar-benar diganti. |
| `DUPLICATE_UNIT_SHIFT` | Lebih dari satu log untuk unit/tanggal/shift yang sama. | Periksa apakah record ganda. |
| `HIGH_FUEL_VARIANCE` | Variance lebih dari 20%. | Periksa Fuel, HM, standard rate, ticket, dan kondisi unit. |
| `KM_REQUIRED_FOR_MOBILE` | Unit mobile belum memiliki KM. | Isi pembacaan odometer. |

Alert bukan perintah otomatis untuk menghapus data. Lakukan pemeriksaan terhadap bukti lapangan terlebih dahulu.

---

## 12. Status approval Input Fuel

| Status | Penggunaan |
| --- | --- |
| Draft | Data baru atau masih diperiksa. |
| Submitted | Data sudah diajukan untuk pemeriksaan. |
| Verified | Data telah diverifikasi. |
| Rejected | Data ditolak dan perlu tindakan. |

Cara mengubah status:

1. buka kartu unit;
2. cari record;
3. gunakan dropdown approval pada kolom Status;
4. pilih status yang diinginkan;
5. tunggu halaman selesai memperbarui data.

Perubahan status disimpan dalam audit trail. Status `Verified` menyimpan admin dan waktu verifikasi.

---

## 13. Edit data Input Fuel

1. Buka kartu unit.
2. Klik kolom yang ingin dikoreksi.
3. Ubah tanggal, shift, HM, KM, Fuel, ticket, atau keterangan.
4. Periksa kalkulasi yang diperbarui.
5. Klik **Simpan Perubahan**.
6. Tunggu proses selesai.

Setelah data utama diedit:

- status approval kembali ke Draft;
- target dan rasio dihitung ulang;
- perubahan dicatat pada audit;
- draft issue inventory disinkronkan bila mapping sumber tersedia.

Jangan berpindah halaman atau refresh sebelum perubahan disimpan. Sistem menyediakan peringatan perubahan belum disimpan, tetapi pengguna tetap harus memastikan proses save selesai.

---

## 14. Audit trail

Klik tombol `↗` pada record untuk membuka Audit Trail Fuel.

Audit memperlihatkan:

- jenis tindakan;
- waktu perubahan;
- pengguna yang melakukan perubahan;
- histori create, update, delete, restore, dan approval.

Gunakan audit ketika:

- angka berubah setelah pemeriksaan;
- status approval berbeda;
- terdapat selisih dengan Fuel ticket;
- perlu mengetahui siapa yang mengoreksi data.

---

## 15. Hapus, Undo, dan Redo

### 15.1 Menghapus beberapa log

1. Klik **Hapus Log Fuel** atau tombol Hapus.
2. Centang record yang ingin dihapus.
3. Gunakan **Pilih seluruh log yang sedang terbuka** bila diperlukan.
4. Periksa jumlah record terpilih.
5. Klik **Hapus Terpilih**.
6. Konfirmasi tindakan.

Penghapusan menggunakan soft-delete sehingga histori tetap dapat diaudit.

### 15.2 Undo dan Redo

- **Undo** membatalkan tindakan terakhir yang masih tersedia pada histori sesi.
- **Redo** menerapkan kembali tindakan yang baru dibatalkan.

Jangan menganggap Undo/Redo sebagai pengganti proses koreksi resmi setelah data digunakan untuk laporan.

---

## 16. Export dan Import Input Fuel

### 16.1 Export Excel

1. pilih Tahun dan Bulan;
2. klik **Export**;
3. sistem menghasilkan file `OMOS_Fuel_Card_<tahun>-<bulan>.xlsx`;
4. simpan file sebagai arsip atau template import.

Kolom export meliputi tanggal, shift, unit, HM, KM, Fuel, rasio, target, variance, approval, ticket, dan keterangan.

### 16.2 Import Excel

Gunakan file hasil Export terbaru sebagai template.

1. klik **Import**;
2. pilih file `.xlsx` atau `.xls`;
3. pastikan tidak ada perubahan draft yang belum disimpan;
4. periksa preview validasi;
5. konfirmasi import;
6. baca jumlah record berhasil dan gagal.

Aturan import saat ini:

- maksimal 500 baris;
- tanggal harus valid;
- shift harus dikenal sistem;
- kode unit harus ada pada List Equipment;
- HM wajib untuk unit non-Km-only;
- KM wajib untuk unit Km-only;
- Fuel harus lebih besar dari 0;
- unit/tanggal/shift tidak boleh duplikat di dalam file;
- formula rasio dan alert dihitung ulang oleh sistem.

Jangan mengubah nama header pada template export.

---

## 17. Membuka Database Fuel

1. Dari halaman Input Fuel, klik **Database Fuel**.
2. Workspace akan menampilkan breadcrumb `Input Fuel / Database Fuel`.
3. Pilih rentang **Dari** dan **Sampai**.
4. Pilih filter Lokasi, Produk, atau Status bila diperlukan.
5. Klik **Tampilkan**.
6. Gunakan **Kembali ke Input Fuel** untuk kembali ke kartu unit.

Filter periode digunakan oleh ledger dan analitik. Ringkasan stok menunjukkan kondisi stock berdasarkan transaksi inventory yang tersedia.

---

## 18. Tab Overview Database Fuel

Overview menyediakan:

| Informasi | Penjelasan |
| --- | --- |
| Total Stok | Total saldo buku seluruh lokasi yang sesuai filter. |
| Nilai Persediaan | Nilai berdasarkan layer FIFO yang mempunyai cost. |
| ADU | Average Daily Usage berdasarkan issue equipment dan hari kalender. |
| Days of Stock | Closing stock ÷ ADU. |
| Integritas | Ringkasan rekonsiliasi ledger, FIFO, transfer, adjustment, dan issue. |

Tabel lokasi menampilkan:

- lokasi;
- produk;
- saldo buku;
- saldo FIFO;
- nilai persediaan;
- jumlah layer open;
- kelengkapan cost.

Jika saldo buku dan FIFO berbeda, jangan membuat adjustment manual sebelum akar selisih ditemukan.

---

## 19. Tab Ledger

Ledger menampilkan transaksi inventory secara kronologis:

- tanggal;
- nomor transaksi;
- jenis transaksi;
- status;
- lokasi asal dan tujuan;
- produk;
- saldo berjalan.

Status transaksi:

| Status | Dampak terhadap stok |
| --- | --- |
| Draft | Belum memengaruhi stok. |
| Posted | Sudah memengaruhi stok. |
| Reversed | Transaksi asli sudah dibalik melalui reversal. |
| Void | Draft dibatalkan sebelum posting. |

Gunakan tombol halaman Sebelumnya/Berikutnya karena ledger dibatasi 50 baris per halaman.

---

## 20. Tab FIFO & Stock

Tab ini menampilkan dua bagian:

### 20.1 Ringkasan lokasi × produk

- saldo buku;
- saldo FIFO;
- selisih;
- nilai persediaan.

### 20.2 Layer FIFO open

- lokasi;
- tanggal penerimaan;
- volume awal;
- sisa volume;
- cost per Liter;
- batch;
- status layer.

Sistem memakai layer tertua berdasarkan waktu penerimaan, kemudian ID sebagai urutan penentu bila waktunya sama.

Contoh:

```text
Batch A tersisa 100 L @ Rp13.500/L
Batch B tersedia 500 L @ Rp13.800/L
Issue 300 L

Alokasi FIFO:
100 L dari Batch A
200 L dari Batch B
```

Sistem tidak memakai average cost sebagai pengganti FIFO.

---

## 21. Stock Opname

### 21.1 Membuat Stock Opname

1. buka tab **Stock Opname**;
2. pilih Lokasi;
3. pilih Produk;
4. pilih Tanggal;
5. isi jumlah fisik dalam Liter;
6. pilih metode pengukuran: Dipstick, Sounding, Flow meter, atau Lainnya;
7. isi URL bukti bila tersedia;
8. isi catatan;
9. klik **Simpan Draf**.

Implementasi saat ini langsung membuat draft dan mengirimkannya menjadi `Submitted` dalam satu aksi UI.

### 21.2 Memahami hasil opname

```text
Variance Liter = Stock Fisik - Stock Buku Snapshot
Variance %     = Variance Liter / Stock Buku Snapshot × 100%
```

Jika stock buku nol, Variance % ditampilkan sebagai `—` karena tidak dapat dihitung secara dimensional.

### 21.3 Approval opname

User penyetuju:

1. membuka record berstatus Submitted;
2. mengisi catatan bila diperlukan;
3. mengisi harga per Liter bila adjustment-in membutuhkan cost;
4. klik **Setujui** atau **Tolak**.

Aturan:

- pembuat/penghitung tidak boleh menyetujui opname sendiri;
- variance di atas ±2% wajib mempunyai alasan approval;
- bila saldo buku berubah setelah opname dibuat, approval ditolak dan opname baru harus dibuat;
- fisik lebih besar dari buku membuat adjustment-in;
- fisik lebih kecil dari buku membuat adjustment-out;
- adjustment-out memakai FIFO tertua;
- adjustment-in membuka layer baru dengan cost yang diberikan atau cost tidak diketahui;
- sistem tidak meng-average cost adjustment-in.

### 21.4 Reject opname

1. isi alasan pada kolom catatan;
2. klik **Tolak**;
3. record berubah menjadi Rejected;
4. buat opname baru bila pengukuran perlu diulang.

---

## 22. Tab Analytics

Analytics menampilkan:

- total issue;
- ADU;
- Days of Stock;
- grafik Fuel masuk versus keluar per hari;
- grafik variance stock opname.

Rumus:

```text
ADU = Total Issue Equipment / jumlah hari kalender pada periode
Days of Stock = Closing Stock / ADU
```

Days of Stock tidak tersedia bila ADU nol atau tidak dapat dihitung.

Chart menggunakan Chart.js dari CDN. Jika site sedang offline dan library chart tidak tersedia, pesan chart akan tampil, tetapi data tabel tetap menjadi acuan.

---

## 23. Export CSV Database Fuel

1. atur periode dan filter;
2. buka tab yang ingin diekspor;
3. klik **Export CSV**;
4. file yang dihasilkan menyesuaikan tab:
   - Overview/FIFO → summary;
   - Ledger → ledger;
   - Stock Opname → daftar opname;
   - Analytics → flow series.

File export menyertakan filter, waktu, satuan, dan versi formula yang digunakan.

---

## 24. Kedatangan stok baru dari supplier

### 24.1 Status implementasi saat ini

Form **Receipt / Kedatangan Stok** dan **Opening Balance** tersedia pada toolbar Database Fuel.

### 24.2 Data yang wajib disiapkan

Sebelum form receipt dioperasikan, siapkan:

- tanggal operasional;
- waktu penerimaan aktual;
- lokasi/tank tujuan;
- produk Fuel;
- jumlah Liter observed;
- supplier;
- nomor DO/surat jalan/invoice;
- nomor batch;
- harga per Liter dalam IDR bila costing digunakan;
- catatan kualitas atau density bila diperlukan untuk dokumen, bukan untuk mengubah satuan inventory;
- bukti penerimaan;
- pembuat dan penyetuju transaksi.

### 24.3 Alur operasional

1. buka Database Fuel;
2. klik **Receipt / Kedatangan**;
4. pilih lokasi tujuan dan produk;
5. masukkan tanggal/waktu penerimaan;
6. masukkan volume Liter observed;
7. masukkan supplier, nomor dokumen, batch, dan harga/Liter;
8. simpan sebagai Draft atau pilih **Simpan & Posting**;
10. periksa kembali volume, lokasi, dan dokumen;
11. lakukan Posting;
12. pastikan receipt muncul di Ledger;
13. pastikan FIFO membuat layer baru;
14. pastikan saldo lokasi bertambah sesuai volume posted.

### 24.4 Koreksi penerimaan

- draft yang salah dapat divoid;
- transaksi posted tidak boleh diedit atau dihapus;
- posted yang salah harus direversal dengan alasan;
- reversal penerimaan ditolak bila layer receipt sudah terpakai, demi integritas FIFO;
- bila layer sudah terpakai, koreksi memerlukan prosedur rekonsiliasi yang ditetapkan admin.

Opening Balance hanya digunakan saat go-live/migrasi dan mewajibkan alasan serta cut-off yang dapat diaudit.

---

## 25. Transfer antar lokasi atau Fuel Truck

### 25.1 Konsep

Fuel Truck diperlakukan sebagai lokasi inventory bergerak.

```text
Depot → Fuel Truck = transfer
Fuel Truck → Unit  = issue equipment
```

Transfer membuat dua kaki atomik:

- transfer-out dari lokasi asal;
- transfer-in ke lokasi tujuan.

### 25.2 Status implementasi

Form **Transfer Stok** tersedia pada toolbar Database Fuel dan langsung memposting dua kaki secara atomik.

### 25.3 Data transfer yang diperlukan

- lokasi asal;
- lokasi tujuan;
- produk;
- volume Liter;
- tanggal operasional;
- alasan atau nomor dokumen;
- idempotency/reference yang stabil.

### 25.4 Rule

- lokasi asal dan tujuan tidak boleh sama;
- saldo negatif diblokir;
- transfer-out mengonsumsi FIFO lokasi asal;
- transfer-in membawa cost snapshot dari asal;
- kedua kaki harus berhasil bersama atau gagal bersama.

---

## 26. Hubungan Input Fuel dengan pengurangan stok

Alur target:

```text
Input Fuel disimpan
→ sistem mencari mapping sumber yang unik
→ membuat draft issue equipment
→ issue diposting
→ stock lokasi berkurang
→ FIFO layer tertua dialokasikan
```

Kondisi implementasi saat ini:

- Input Fuel tetap berhasil disimpan walaupun inventory gagal atau mapping belum tersedia;
- sistem mencoba membuat/memperbarui **draft issue** sebagai shadow integration;
- draft issue belum mengurangi stok;
- bila mapping tidak ada atau ambigu, sistem tidak menebak lokasi;
- tab Mapping Sumber menyediakan master mapping dan antrean rekonsiliasi;
- tombol **Terapkan ke Antrean** membuat draft issue untuk baris yang mendapat mapping unik;
- draft issue diposting atau divoid dari kolom Aksi pada tab Ledger.

Akibatnya, pengguna tidak boleh menganggap angka Fuel Actual pada Input Fuel otomatis sama dengan Fuel Keluar pada Database Fuel.

---

## 27. Checklist operasional harian

### Awal shift

- [ ] Pilih periode yang benar.
- [ ] Pastikan unit dan standard Fuel Rate tersedia.
- [ ] Pastikan pembacaan terakhir masuk akal.
- [ ] Pastikan Fuel ticket tersedia.
- [ ] Pastikan lokasi/tank sumber diketahui secara operasional.

### Saat pengisian unit

- [ ] Catat HM aktual.
- [ ] Catat KM aktual untuk unit mobile/Km-only.
- [ ] Catat Liter aktual.
- [ ] Catat ticket dan keterangan.
- [ ] Jangan mengisi angka delta sebagai pembacaan counter.

### Setelah input

- [ ] Klik Simpan.
- [ ] Pastikan tidak ada draft tertinggal.
- [ ] Periksa status Periksa/Anomali.
- [ ] Verifikasi data terhadap ticket.
- [ ] Ubah approval sesuai proses site.

### Akhir shift/hari

- [ ] Periksa KPI Fuel Actual dan variance.
- [ ] Filter unit Anomali.
- [ ] Export data bila diperlukan.
- [ ] Periksa Database Fuel Overview dan integritas.
- [ ] Periksa draft inventory yang belum dapat diposting setelah UI tersedia.
- [ ] Lakukan stock opname sesuai jadwal.

---

## 28. Kesalahan umum dan penyelesaiannya

| Masalah | Penyebab umum | Tindakan |
| --- | --- | --- |
| L/HM kosong | Belum ada baseline atau HM tidak meningkat | Periksa pembacaan sebelumnya. |
| L/KM kosong | KM tidak diisi atau belum ada baseline KM | Isi odometer aktual. |
| Variance sangat tinggi | Fuel, HM, atau standard rate salah | Cocokkan ticket dan List Equipment. |
| HM ditolak | Lebih kecil/sama dari sebelumnya | Koreksi atau gunakan reset resmi. |
| Unit tidak muncul | Unit tidak aktif atau filter terlalu sempit | Reset filter dan periksa List Equipment. |
| Import ditolak | Header/format/duplikat tidak valid | Gunakan hasil Export terbaru. |
| Saldo Database Fuel kosong | Belum ada receipt/opening balance posted | Jangan isi angka fiktif; tunggu form receipt dan data valid. |
| Input Fuel tidak mengurangi stok | Issue masih draft atau mapping tidak unik | Periksa mapping/antrian setelah UI tersedia. |
| Approval opname gagal | Maker-checker atau saldo buku berubah | Gunakan approver lain atau buat opname baru. |
| Adjustment-out gagal | FIFO stock tidak cukup | Rekonsiliasi receipt/transfer terlebih dahulu. |
| Chart tidak muncul | Chart.js tidak tersedia saat offline | Gunakan tabel/KPI; coba kembali saat library tersedia. |

---

## 29. Larangan operasional

Jangan:

- memasukkan estimasi sebagai pembacaan HM/KM aktual;
- menggunakan delta HM sebagai counter HM;
- mengubah status Verified tanpa pemeriksaan;
- memakai reset meter untuk menutupi salah input;
- membuat lokasi, receipt, atau opening balance fiktif hanya agar saldo muncul;
- menginput Fuel receipt sebagai Input Fuel unit;
- mengedit transaksi posted secara langsung;
- menghapus histori untuk menyembunyikan selisih;
- menggunakan API langsung sebagai pengganti form operasional;
- menganggap draft inventory sudah mengubah saldo;
- menganggap nilai Input Fuel dan Ledger pasti sama sebelum rekonsiliasi.

---

## 30. Rekomendasi sebelum Database Fuel dinyatakan go-live

Fitur Database Fuel sebaiknya belum dijadikan sumber stok resmi sampai tersedia:

1. form master produk dan lokasi;
2. form receipt dan opening balance;
3. form transfer;
4. form posting, void, dan reversal;
5. pengaturan mapping sumber;
6. antrian issue yang belum teralokasi;
7. detail audit transaksi inventory;
8. detail alokasi FIFO;
9. permission/RBAC per tindakan;
10. SOP cutover dan opening balance yang disetujui;
11. rekonsiliasi parallel terhadap catatan stok site;
12. pelatihan maker-checker stock opname.

Sebelum kelengkapan tersebut tersedia, gunakan Input Fuel sebagai sumber pengisian/konsumsi unit, sedangkan Database Fuel diperlakukan sebagai workspace inventory yang masih dalam tahap go-live bertahap.

---

## 31. Ringkasan alur yang benar

```text
KEDATANGAN SUPPLIER
Receipt posted → FIFO layer baru → saldo tank bertambah

TRANSFER
Tank asal → transfer-out → transfer-in → Fuel Truck/lokasi tujuan

PENGISIAN UNIT
Input Fuel → draft issue → validasi sumber → posted issue → FIFO berkurang

STOCK OPNAME
Hitung fisik → submit → maker-checker → adjustment → saldo direkonsiliasi

PELAPORAN
Overview + Ledger + FIFO + Analytics + Export
```

Pada implementasi web saat ini, Input Fuel, Receipt, Opening Balance, Transfer, Mapping Sumber,
Posting/Reversal/Void, Stock Opname, FIFO, dan pelaporan tersedia dalam satu workspace.
