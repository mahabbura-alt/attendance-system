# LOGISTIK — panduan operasional dan kesiapan rilis

Status 4 Oktober 2026: implementasi dan pengujian selesai; Migration 062 sudah
dijalankan serta diverifikasi pada database target, kemudian aplikasi dideploy
ke Vercel production melalui deployment `dpl_82s78TMjxByvYJyfeSoeSgW3GY1U`.

## Aktivasi

1. Migration `062_logistics.sql` sudah dijalankan menggunakan
   `npm run migration:logistics`. Jangan menjalankan mutasi manual di luar migrasi.
2. Deploy backend dan dashboard bersama. Endpoint modul: `/api/logistics`.
3. Admin Utama mendapat membership awal pada scope legacy `default/default`.
   Atur akses akun lain melalui Master Data. Keanggotaan project diverifikasi backend.
4. Isi master barang, gudang dan supplier sebelum memasukkan saldo awal.
   Sediakan akun pembuat dan pemberi persetujuan berbeda.

## Alur utama

- Kebutuhan: Material Request → PR → Penawaran Supplier → PO → Pengiriman → Penerimaan/QC.
- Dokumen disimpan sebagai draft; transaksi stok berlaku setelah posting, bukan saat draft dibuat.
- Saldo awal, PO, permintaan, PR, opname dan adjustment mengikuti persetujuan yang tersedia.
  Pembuat tidak boleh menyetujui dokumennya sendiri.
- Reservasi menahan stok per layer. Issue merekam pemakaian dan biaya.
- Transfer mengurangi gudang asal saat dispatch; gudang tujuan bertambah saat receipt.
- Retur pemakaian harus merujuk issue asal; biaya dikembalikan sesuai sumbernya.
- Opname menyimpan snapshot. Jika stok bergerak setelah snapshot, posting ditolak dan perlu pengecekan ulang.
- Barang expired, karantina atau rusak tidak menjadi stok siap pakai.
- Dokumen posted tidak diedit atau dihapus; koreksi melalui transaksi referensi.

## Master dan biaya

Gunakan satuan dasar barang yang konsisten. Sistem tidak mengonversi dus ke pcs
atau liter ke kg secara implisit. Harga barang masuk wajib eksplisit.
Barang reguler memakai FIFO. Barang FEFO/serial memakai biaya batch terpilih
(specific identification), bukan financial FIFO terpisah dari pemilihan fisik.
Barang konsinyasi dipisahkan dari nilai persediaan milik perusahaan.

Maintenance Readiness membaca kebutuhan Periodic Service dan Breakdown legacy
hanya pada scope asal. Pencocokan katalog memerlukan kode barang/satuan yang
sesuai; rekomendasi tidak otomatis mengeluarkan stok. Fuel memakai sistem
Database Fuel eksisting, tidak menyalin atau menghitung ulang ledger fuel.

## Peran

| Peran | Fungsi |
| --- | --- |
| Requester | Permintaan kebutuhan |
| Storekeeper | Penerimaan, gudang, pengeluaran dan QC |
| Buyer | Pengadaan dan akses biaya |
| Approver | Persetujuan dan akses biaya |
| Manager | Master serta alur operasional lengkap |
| Auditor | Baca dan penelusuran biaya |

Penetapan akses dilakukan Admin Utama. Nilai biaya disaring di server bagi
peran tanpa hak biaya; menyembunyikan kolom frontend bukan pengaman utama.

## Koneksi dan retry

Form menyimpan draft pada perangkat per akun/project. Jika respons penyimpanan
terputus, payload masuk antrean lokal dengan request key stabil. Retry manual
atau saat online tidak menggandakan transaksi. Jangan membersihkan data browser
sebelum antrean selesai. Draft lokal belum berarti transaksi telah tercatat server.

## Batas rilis ini

- Belum mendukung cold-start offline/PWA atau sinkronisasi antarperangkat.
- Dashboard menampilkan maksimal 1.000 dokumen terbaru dan 2.000 layer terbuka;
  KPI posisi stok dihitung server, tidak dari daftar terbatas tersebut.
- Belum ada workflow approval bertingkat berbasis nominal, invoice/payment,
  multi-currency, lampiran dokumen, atau financial FIFO independen dari FEFO.
- Barcode keyboard/lookup tersedia; kamera bergantung dukungan BarcodeDetector
  dan belum diuji dengan perangkat scanner/kamera fisik.
- Integrasi equipment/maintenance/Fuel legacy dibatasi ke scope asal; onboarding
  project baru memerlukan pemetaan sumber yang memiliki ownership project.

## Bukti verifikasi

- `node --test backend/test/*.test.js`: 308 lulus.
- `node --test admin-dashboard/*.test.js`: 133 lulus.
- `backend/src/scripts/verify_logistics_integration.js`: PostgreSQL terisolasi,
  FIFO, FEFO, reservation batch/serial, transfer, retur, QC, stock snapshot,
  idempotency, concurrency draft, batas PO dan isolasi project lulus.
- Browser localhost: 15 subhalaman, desktop 1440 px dan mobile 390 px,
  refresh/persistence serta respons simpan hilang setelah commit diuji;
  retry menghasilkan satu transaksi, console tanpa error.
- Fixture tidak memakai database produksi.
