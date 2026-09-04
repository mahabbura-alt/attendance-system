# OMOS Input Fuel — Card Redesign & Calculation Notes

Status: diimplementasikan pada 30 Agustus 2026.

## Keputusan final

- Counter KM menggunakan skala 1 angka = 1 km.
- Fuel adalah volume aktual yang diisikan ke unit.
- HM dicatat terpisah sebagai counter aktual saat pengisian Fuel; bukan mengambil HM Daily Work Log.
- Rasio dihitung dari selisih counter terhadap transaksi sebelumnya dan menggunakan presisi penuh.
- Data historis tidak dihapus; ketidaklengkapan baseline dan duplikasi lama ditandai sebagai anomaly untuk ditinjau.

## Tujuan

- Mengganti tabel Fuel global dengan kartu per unit.
- Satu unit aktif pada List Equipment menghasilkan satu kartu.
- Kartu dikelompokkan berdasarkan Jenis Alat dari List Equipment.
- Riwayat/database Fuel lama dipertahankan dan dimigrasikan; yang dihapus hanya tampilan tabel lama.

## Interpretasi tabel referensi

Kolom referensi: Tanggal, Shift, HM, KM, Fuel, Ltr/Jam, Ltr/Km, Keterangan.

- HM dan KM terlihat sebagai counter kumulatif.
- Jam operasi periode = HM sekarang − HM sebelumnya.
- Jarak periode = KM sekarang − KM sebelumnya.
- Ltr/Jam = Fuel periode ÷ selisih HM.
- Counter KM menggunakan kilometer aktual tanpa faktor pengali.
- Ltr/Km = Fuel diisikan ÷ selisih KM aktual.
- Baris pertama suatu periode harus mengambil pembacaan terakhir sebelum periode tersebut; jika baseline belum ada, rasio ditampilkan `—`.
- Ringkasan periode direkomendasikan memakai weighted ratio:
  - Ltr/Jam periode = Σ Fuel ÷ Σ jam operasi.
  - Ltr/Km periode = Σ Fuel ÷ Σ jarak aktual.
  - Bukan rata-rata aritmetika rasio per baris.

## Struktur kartu yang direkomendasikan

Header kartu:

- Kode Unit.
- Jenis Alat.
- Class.
- Tipe Model.
- Standard Fuel Rate.
- Status kelengkapan/koneksi data.

Isi kartu:

- Tanggal dan Shift.
- HM reading atau HM Start/Akhir.
- KM/odometer reading.
- Fuel aktual (liter).
- Ltr/Jam dan Ltr/Km otomatis, read-only.
- Keterangan.

Footer kartu:

- Total Fuel.
- Total HM dan jarak.
- Weighted Ltr/Jam.
- Weighted Ltr/Km.
- Target, variance, dan status efisiensi.

## Aturan operasional

- Unique record: Unit + Tanggal + Shift.
- HM Fuel berdiri sendiri sebagai pembacaan aktual pada saat pengisian.
- KM membutuhkan sumber baru: manual, import, atau telematics.
- Fuel aktual perlu definisi tunggal: volume dispensed atau konsumsi bersih.
- Unit stasioner seperti Excavator/Dozer memakai KPI utama Ltr/Jam; Ltr/Km ditampilkan `N/A`.
- Unit mobile seperti Dump Truck dapat memakai Ltr/Jam dan Ltr/Km.
- Counter reset, meter replacement, dan rollover harus memiliki flag khusus dan audit trail.

## Visual dan performa

- Satu kartu lebar penuh per baris karena tabel memiliki banyak kolom.
- Group Jenis Alat bersifat collapse/expand dan menampilkan jumlah unit serta ringkasan liter.
- Kartu default ringkas; detail harian dibuka saat kartu diklik.
- Filter Tahun, Bulan, Jenis Alat, Class, Unit, Status, dan anomali.
- Data harian dimuat lazy per kartu agar puluhan unit tidak diunduh sekaligus.
- Header/footer kartu tetap terlihat saat detail kartu digulir.
- Status warna: hijau normal, kuning perlu konfirmasi, merah anomali, abu-abu belum lengkap.

## Validasi yang direkomendasikan

- Selisih HM/KM negatif atau nol yang tidak wajar.
- Duplikasi Unit + Tanggal + Shift.
- Fuel negatif atau melebihi kapasitas tangki.
- Ltr/Jam melampaui batas Class/Standard Fuel Rate.
- Pengisian Fuel dengan HM nol.
- Data Work Log, unit, shift, atau operator tidak ditemukan.
- Preview validasi sebelum import dan blokir hanya kesalahan matematis/fundamental.

## Keputusan yang telah dikonfirmasi

1. Satu angka counter KM mewakili 1 km.
2. Fuel adalah volume yang diisikan.
3. HM diinput terpisah sebagai counter aktual saat pengisian.
4. Data lama dipertahankan dan dimigrasikan ke kartu.
