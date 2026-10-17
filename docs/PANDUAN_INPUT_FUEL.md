# Panduan Pengguna — Input Fuel & Database Fuel

Halaman **Input Fuel** (`Produksi → Input Fuel`) mencatat setiap pengisian BBM ke unit
(HM/KM aktual + liter yang diisikan) sekaligus memantau efisiensi (Ltr/HM, Ltr/Km,
variance terhadap target). Tombol **🗄️ Database Fuel** di header membuka workspace
stok (saldo depot/tank/truck, ledger, FIFO, opname) yang datanya terpisah dari
log pengisian unit.

> Dua konsep penting:
> - **Log Fuel** = catatan pengisian ke *unit* (siapa, kapan, berapa liter, HM/KM berapa).
> - **Ledger Database Fuel** = catatan *stok* (terima, pakai, transfer, opname) per lokasi.
>   Log Fuel yang lokasi sumbernya valid otomatis membuat issue di ledger (mode shadow);
>   stok depot tidak berkurang dua kali.

---

## 1. Membuka halaman & periode aktif

1. Buka menu **Produksi → Input Fuel**.
2. Pilih **Tahun** dan **Bulan** di header. Saat pertama dibuka, periode otomatis
   = bulan berjalan; daftar tahun diisi dari periode yang pernah ada + data log.
3. Kartu unit yang tampil selalu mengikuti periode aktif. Ganti bulan untuk
   melihat/mengisi data bulan lain.

## 2. Filter, KPI, dan status kartu

**Filter** (di atas kartu): pencarian kode/Jenis Alat/class/model, **Jenis Alat**,
**Class**, **Status** (`Semua / Terkoneksi / Anomali / Belum Ada Data`), dan tombol
**Reset Filter**. Angka `N unit` menunjukkan jumlah kartu yang tampil.

**Kartu KPI** (6 kartu di atas daftar):
| Kartu | Arti |
| --- | --- |
| Fuel Actual | Total liter yang diisikan pada periode aktif |
| Fuel Target | Target = Standard Fuel Rate × total ΔHM |
| Variance | Actual − Target (Liter dan %). Merah bila boros |
| Weighted Fuel/HM | Σ Fuel ÷ Σ jam operasi (bukan rata-rata per baris) |
| Weighted Fuel/KM | Sama untuk jarak; hanya unit mobile (🚚) |
| Data Alerts | Jumlah unit bermasalah; teks kecil = unit terisi dari total unit |

**Status kartu unit:**
- 🟢 **Terkoneksi** — unit punya log pada periode.
- 🟡 **Perlu diperiksa** — ada anomali (duplikat, selisih negatif, rasio janggal, dsb).
- ⚪ **Belum ada data** — unit belum punya log periode ini.

**Header kartu** menampilkan: kode unit, class, model, ikon (⚙ stasioner / 🚚 mobile),
total Fuel, Std. Fuel Rate, Ltr/HM, Ltr/Km *atau* Target (unit stasioner tidak
memakai Ltr/Km), dan Variance % (kuning > 0 %, merah > 20 %).
Klik header untuk membuka/menutup. Detail harian dimuat malas (*lazy*) per kartu,
jadi puluhan kartu tetap ringan. Grup Jenis Alat bisa di-collapse; tiap grup
menampilkan jumlah unit, total liter, dan jumlah alert.

## 3. Mencatat pengisian baru (log Fuel)

1. Klik header kartu unit → bagian detail terbuka.
2. Klik tombol tambah baris di tabel detail (baris baru otomatis terisi tanggal
   = sehari setelah log terakhir unit tersebut, dan kursor langsung ke HM).
3. Isi kolom:
   - **Tanggal** dan **Shift** (kombinasi Unit + Tanggal + Shift harus unik —
     duplikat ditolak/ditandai anomali).
   - **HM reading** (counter aktual saat pengisian).
   - **KM/Odometer** — *wajib* untuk unit mobile/🚚 dan unit Km-only, opsional
     untuk unit stasioner (1 angka = 1 km).
   - **Fuel diisi (Liter)** — volume aktual yang masuk ke tangki unit (wajib > 0).
   - **No. tiket** dan **keterangan** bila ada.
   - Reset meter (ganti meter): tandai lewat flag reset + alasan agar selisih
     negatif tidak dianggap anomali.
3. Ltr/Jam dan Ltr/Km **dihitung otomatis dan read-only**:
   `ΔHM = HM sekarang − HM sebelumnya`, `Ltr/Jam = Fuel ÷ ΔHM` (analog untuk KM).
   Baris pertama tanpa baseline menampilkan `—`.
4. Baris baru berstatus **Baru** sampai disimpan. Perubahan Anda tersimpan
   **sementara sebagai draf** (tetap ada walau halaman di-refresh — saat kembali
   akan ditanya simpan atau buang).
5. Klik **Simpan** (tombol menampilkan jumlah perubahan, mis. `Simpan (3)`).
   Sistem menyimpan satu per satu; bila ada yang gagal, yang berhasil tetap
   tersimpan dan daftar gagal ditampilkan — perbaiki lalu Simpan lagi.

> Jangan menekan Simpan dua kali — tombol dikunci otomatis selama menyimpan.

## 4. Mengubah & menghapus log

- **Ubah:** edit langsung sel di tabel kartu, lalu **Simpan**.
- **Hapus massal:** klik **Hapus** (atau **Hapus Log Fuel**) → mode hapus aktif
  (tombol berubah menjadi **Tutup Mode Hapus**) → centang baris (atau **Pilih
  seluruh log yang sedang terbuka**) → **Hapus Terpilih** → konfirmasi.
  Hapus bersifat *soft-delete*: data disembunyikan dari laporan & KPI tetapi
  jejak audit tersimpan dan masih bisa dikembalikan via **Undo**.
- **Undo/Redo:** membatalkan/mengulang hingga 100 aksi terakhir (tambah, ubah,
  hapus). Undo atas hapus = mengembalikan data; undo atas tambah = menghapus
  data yang baru dibuat. Tombol nonaktif bila tidak ada aksi.
- Jika log yang dihapus sudah terhubung ke ledger stok (issue posted), sistem
  membuat reversal inventory otomatis agar stok kembali benar.

## 5. Import & Export Excel

**Export** (`📊 Export`): mengunduh `OMOS_Fuel_Card_<tahun>-<bulan>.xlsx` berisi
*seluruh log periode aktif* (bukan hanya yang tampil) dengan 16 kolom: Tanggal,
Shift, Kode Unit, Jenis Alat, Class, Tipe Model, HM Reading, KM Reading, Fuel
Diisikan, Ltr/Jam, Ltr/Km, Target, Variance %, Approval, Fuel Ticket,
Keterangan. File ini juga menjadi **template resmi import**.

**Import** (`⬆ Import`):
1. Siapkan file berformat sama seperti hasil Export (sheet `Fuel Logs`,
   header mengandung `KODE UNIT`). Yang dibaca: Tanggal (kolom A), Shift (B),
   Kode Unit (C), HM Reading (G), KM (H), Fuel Liter (I, wajib > 0), Fuel
   Ticket (O), Keterangan (P). Maksimal **500 baris** per file.
2. Selesaikan dulu draf yang tertunda (Simpan/buang) — import diblokir bila ada
   draf.
3. Pilih file → sistem validasi *dulu*: tanggal/shift valid, kode unit ada di
   List Equipment, HM valid (unit Km-only wajib isi KM), Fuel > 0, dan tidak
   ada duplikat unit/tanggal/shift di dalam file. Semua kesalahan ditampilkan
   per nomor baris Excel; **tidak ada yang tersimpan sebelum Anda konfirmasi**.
4. Konfirmasi → baris valid dibuat satu per satu; rasio dan anomali dihitung
   ulang sistem; hasilnya diringkas (berhasil X, gagal Y + alasannya) dan
   masuk histori Undo.

## 6. Approval & audit trail

Setiap baris log punya kolom status approval + tombol **↗**:
- **Draft** → **Submitted** (diajukan) → **Verified** (disetujui) atau
  **Rejected** (ditolak). Ubah lewat dropdown di baris; gagal akan ada pesan.
- Tombol **↗** membuka **Audit Trail**: siapa melakukan apa dan kapan
  (aksi, waktu, pelaku/Sistem).

## 7. Anomali — arti dan tindak lanjut

Status baris/kartu **Perlu diperiksa** muncul bila, misalnya: duplikat
Unit+Tanggal+Shift, selisih HM/KM negatif atau nol yang tak wajar, Fuel negatif
atau melebihi kapasitas tangki, Ltr/Jam jauh di atas Standard Fuel Rate,
pengisian dengan HM nol, atau referensi (unit/shift/operator) tidak ditemukan.
Data lama yang tidak lengkap/duplikat **tidak dihapus** — hanya ditandai agar
ditinjau. Cara beresin: koreksi angkanya (lalu Simpan), lengkapi baseline
sebelumnya, atau tandai reset meter bila memang ganti meter.

## 8. Rumus yang dipakai (acuan)

- `Jam operasi = HM sekarang − HM sebelumnya`; `Jarak = KM sekarang − KM sebelumnya`.
- `Ltr/Jam = Fuel ÷ jam operasi`; `Ltr/Km = Fuel ÷ jarak` (presisi penuh).
- Ringkasan periode memakai **weighted ratio** (`ΣFuel ÷ Σjam`), bukan rata-rata.
- `Target = Standard Fuel Rate × ΔHM`; `Variance = Actual − Target`.
- Fuel = volume aktual yang diisikan (observed Liter). HM Fuel adalah counter
  aktual saat pengisian, bukan dari Daily Work Log.

## 9. Kedatangan stok baru & saldo depot (Database Fuel)

Stok (penerimaan supplier, saldo depot/tank/truck) **tidak** dicatat di kartu
unit — melainkan di ledger Database Fuel. Saat ini pencatatan penerimaan
dilakukan via API (form UI-nya belum ada — minta ke admin/IT bila perlu
dibuatkan):

1. **Draf receipt** — `POST /api/admin/production/fuel-inventory/transactions`
   (header `Authorization: Bearer <token admin>`, body JSON):
   ```json
   {
     "transaction_type": "receipt",
     "operational_date": "2026-09-24",
     "product_id": "<uuid-produk>",
     "destination_location_id": "<uuid-depot-tujuan>",
     "document_number": "DO-SUPPLIER-123",
     "lines": [{ "direction": "in", "quantity_liter": 5000, "unit_price": 10800, "batch_number": "B-001" }]
   }
   ```
   Ambil `<uuid-produk>` dari `GET /products` dan `<uuid-depot>` dari
   `GET /locations`. `unit_price` = harga per liter (Rp).
2. **Posting** — `POST /api/admin/production/fuel-inventory/transactions/<id>/post`.
   Stok bertambah dan membentuk FIFO layer (harga tercatat per batch).
3. **Saldo awal (go-live)** — sama seperti receipt tetapi
   `"transaction_type": "opening_balance"`, berdasarkan hasil opname fisik
   yang disetujui. Jangan menebak dari total historis log.
4. **Cek saldo** — `GET /api/admin/production/fuel-inventory/balance?location_id=<uuid>`
   atau lihat tab Overview workspace.
5. **Koreksi salah input** — jangan hapus: `POST .../transactions/<id>/reverse`
   dengan `{"reason": "..."}` (reversal mengembalikan FIFO ke layer asal;
   receipt yang lapisannya sudah terpakai akan ditolak demi integritas).

Alur terkait yang sudah tersedia:
- **Depot → fuel truck:** `POST /transfers` (`from_location_id`, `to_location_id`,
  `product_id`, `quantity_liter`, `operational_date`, `idempotency_key`) — atomik,
  retry aman.
- **Opname:** tab Stock Opname di workspace (catat fisik → ajukan → setujui
  oleh orang berbeda; selisih > ±2 % wajib alasan; approval membuat adjustment
  otomatis).
- **Laporan integritas:** `GET /integrity-report` (cek ledger≠FIFO, transfer
  pincang, adjustment tanpa opname, issue vs Input Fuel) — jalankan berkala.

## 10. Workspace Database Fuel (tombol 🗄️)

Membuka 5 tab (data selalu dari server, bukan hasil hitungan browser):
- **Overview** — KPI Total Stok, Nilai Persediaan (hanya cost yang diketahui;
  layer tanpa harga *tidak* di-average), ADU + basis hari kalender, Days of
  Stock, status integritas, dan tabel per lokasi × produk.
- **Ledger** — seluruh transaksi + saldo jalan, 50 baris/halaman.
- **FIFO & Stock** — ringkasan buku vs FIFO (selisih merah = perlu investigasi)
  dan daftar layer (sisa, cost/L, batch, status).
- **Stock Opname** — form catat + riwayat + tombol Ajukan/Setujui/Tolak
  (dialog konfirmasi; maker-checker ditegakkan).
- **Analytics** — grafik Masuk vs Keluar per hari, grafik variance opname
  (merah = alert), dan angka ADU/formula.
- **Filter** dari/sampai/lokasi/produk/status berlaku per tab; **Export CSV**
  mengikuti tab aktif dan mencantumkan filter, waktu, satuan, dan versi formula.

## 11. Masalah umum

| Gejala | Penyebab & solusi |
| --- | --- |
| `Library Excel belum siap` | Pustaka CDN belum termuat — refresh halaman lalu ulangi |
| Import ditolak padahal file benar | Masih ada draf tertunda → Simpan/buang dulu; atau header bukan format Export |
| `Sudah ada opname aktif` | Satu lokasi+produk hanya boleh 1 opname draft/diajukan — selesaikan dulu |
| Approval opname `stok buku berubah` | Ada transaksi masuk setelah penghitungan — buat opname baru |
| Variance % besar tiba-tiba | Cek baseline HM/KM sebelumnya dan flag reset meter |
| Tombol Simpan nonaktif | Tidak ada draf — semua sudah tersimpan |
