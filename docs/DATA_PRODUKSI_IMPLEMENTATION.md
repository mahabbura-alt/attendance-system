# Data Produksi — rekap bulanan per area

Implementasi 9 September 2026. Referensi tampilan: `D:/OneDrive/Desktop/data produksi.xlsx`, sheet1 C4:AC9.

## Perilaku

- Tab 7 menggantikan Shift Report dengan Data Produksi (`prodDataProduksi`). UI, fungsi cetak/ringkasan, dan endpoint Shift Report lama telah dihapus. Tidak ada penghapusan transaksi produksi/fuel/cuaca.
- Pilihan tahun/bulan, area; dua baris per tanggal operasional untuk shift siang/malam yang tersedia di database. Shift dengan nama khusus yang mempunyai transaksi dalam periode ikut dimunculkan agar data tidak hilang.
- Area mengikuti lokasi List Equipment serta area yang memiliki data historis dalam periode. BEI/DKC tidak di-hardcode.
- JOB mengikuti SPO deployed; JOB pada transaksi historis tetap ditampilkan. Material mengikuti fleet catalog OB/Coal dan transaksi historis.
- Lampiran sebenarnya memuat tiga material OB + TOTAL dan lima material CG + TOTAL. Jumlah material bersifat dinamis, bukan enam kolom kosong tetap. Per JOB tersedia material, total, jarak; kelompok lintas JOB: fuel, fuel ratio, intensitas hujan, durasi hujan, slippery.
- Tanggal/shift dan header tetap terlihat saat scroll. Angka produksi tebal, detail sumber melalui total JOB, footer bulanan, ekspor XLSX per area.
- Semua agregasi dan fuel ratio termasuk ALL dihitung backend. Frontend hanya memformat angka dan mengonversi menit ke jam untuk tampilan.

## Sumber dan formula

1. Produksi: `ritase_logs` per fleet/truck/jam × `truck_factors.factor_value` terakhir dengan tanggal <= tanggal fleet, kategori/tipe/material sesuai implementasi Input Ritase. Tidak memakai `production_volume` legacy yang bisa kosong untuk input grid.
2. Coal: ton / density (ton/BCM) = BCM; fuel ratio = liter teralokasi / BCM. Tiap fleet dikonversi dahulu dengan density masing-masing. Rasio bulanan memakai total liter / total BCM; tidak merata-ratakan rasio shift.
3. Density: catalog Coal Productivity Planning (`equipmentId + jobCode + material + planningType`), dengan kompatibilitas pembacaan field density dari HTML planning tersimpan untuk catalog lama. Tanpa satu match/density positif, tampil incomplete. Tidak menggunakan density default 1.
4. `Kunci acuan density` menangkap nilai/reference/tanggal planning/aktor secara append-only per fleet + identitas unit/JOB/material/type. Sebelum dikunci, tampil indikator sumber planning saat ini. Perubahan identitas fleet membutuhkan snapshot baru; snapshot lama tidak ditimpa.
5. Jarak: reuse `calculateWeightedFleetDistance`, memasukkan `ritase_distance_allocations`; gabungan fleet berbobot BCM, sehingga coal dengan density berbeda tidak dicampur berdasarkan satuan ton dan BCM.
6. Fuel = volume **pengisian**, bukan pengukuran konsumsi bersih. Kolom Fuel Consumpt mempertahankan judul template; definisi dijelaskan di status halaman.
7. Hujan: `rainfall_logs` per area/tanggal operasional/shift/JOB. Intensity mm satu desimal; duplikat interval persis sama dihitung sekali, nilai pengukuran bertentangan ditandai. Interval durasi overlap digabung; jam setelah tengah malam dipetakan memakai operational_start shift. Tidak ada total curah hujan ALL lintas JOB yang berpotensi menggandakan kejadian.
8. Keterangan menampilkan remark Input Data dan masalah kelengkapan. Nol tersimpan dibedakan dari data tidak tersedia (`—`). Total material dengan unit campuran tidak dipaksakan menjadi satu angka.

9. **Sumber data produksi per JOB** (halaman 7. Data Produksi): Kolom induk JOB (CG·Coal Getting, FOT·FOT, OB·Overburden Removal) menunjukkan gear ⚙ yang memilih sumber data:
   - **Input Ritase** (default) — nilai produksi dari agregasi Input Ritase sistem.
   - **Manual** — admin ketik nilai produksi per tanggal/shift/material; nilai tersebut menggantikan ritase pada rekap bulanan (TOTAL bulan dan fuel ratio). Data manual disimpan dalam tabel `production_manual_sources` + `production_manual_overrides` dan tidak merusak histori ritase.
   - Pilih Manual, ubah kolom produksi, lalu klik **Simpan** pada toolbar. Tombol
     default buram/nonaktif dan otomatis aktif ketika nilai benar-benar berbeda.
     Status menampilkan `Data belum disimpan · N perubahan`, kemudian kembali
     menjadi `Tersimpan` setelah server mengonfirmasi penyimpanan.
   - Save mengirim snapshot override lengkap hanya untuk kombinasi area+JOB yang
     berubah. Karena itu perubahan satu sel FOT tidak menghapus nilai manual pada
     tanggal, shift, material, atau baris FOT lain dalam periode yang sama.

## Alokasi fuel

- Acuan `mining_production_logs`: tanggal operasional, shift_id, equipment_id; kemudian cocokkan kode JOB dan area dengan laporan.
- Tujuan tunggal area/JOB -> otomatis. Duplikat catatan dengan tujuan yang sama tidak menggandakan liter. Tidak ada match/tujuan ambigu -> antrean manual.
- Manual mendukung pembagian liter ke beberapa area/JOB. Total bagian harus tepat sama dengan transaksi fuel; positif, dua desimal, tanpa tujuan ganda.
- Fingerprint transaksi mencakup tanggal/shift/unit/volume. Jika sumber berubah, alokasi manual lama masuk antrean peninjauan.
- Alokasi manual yang masih valid dipertahankan ketika Input Data berubah. User dapat mengedit melalui bagian Fuel teralokasi.
- Penyimpanan menggunakan lock baris sumber, pemeriksaan revisi, retry idempoten dan audit previous/new/actor/time. Tidak ada pembagian otomatis berdasarkan HM yang belum disetujui user.
- **Alokasi Cepat (P0)** memproses 1–100 transaksi antrean dalam bulan operasional yang sama. User dapat memfilter, memilih baris, menerapkan Area/JOB massal, mengubah tujuan per baris, lalu menjalankan pemeriksaan server sebelum commit.
- Commit Alokasi Cepat bersifat atomik: satu fingerprint/revision/tujuan tidak valid membatalkan seluruh batch. Setiap transaksi wajib teralokasi 100% sebesar volume pengisiannya; audit tetap per transaksi dan dihubungkan oleh `batch_id`.
- Tombol pemeriksaan dan penyimpanan memakai feedback async standar OMOS serta mengunci form selama request untuk mencegah double-submit.
- **P1 rekomendasi**: antrean menampilkan kandidat Area/JOB dari Input Data ambigu, alokasi manual sebelum perubahan sumber, atau alokasi valid terakhir unit. Rekomendasi bersifat bantuan dan tidak disimpan tanpa konfirmasi.
- **P2 aturan efektif unit**: fallback otomatis dapat dibuat dari Alokasi Cepat atau menu Aturan Alokasi. Prioritas tetap manual transaksi → Input Data unik → aturan efektif. Versi aturan baru memakai tanggal efektif baru sehingga histori sebelumnya tidak ditimpa; snapshot nonaktif menghentikan fallback mulai tanggal tersebut.
- **P3 kualitas data**: halaman menampilkan persentase alokasi, rekonsiliasi `total = teralokasi + antrean`, umur antrean tertua, sumber alokasi, penyebab antrean, dan unit yang paling sering tidak terpetakan.
- UI memakai `OMOSActionFeedback.run`; form terkunci saat request, draft dipertahankan saat gagal. Tidak ada localStorage berisi data alokasi sensitif.

## Database, API, batas akses

Migration `035_production_data.sql` sudah diterapkan pada Supabase dari konfigurasi backend. Tabel tambahan: `production_fuel_allocation_sets`, `production_fuel_allocation_audit`, `production_density_snapshots`. Data sumber tidak dimutasi.

- GET `/api/admin/production/production-data?year=YYYY&month=M` — transaksi snapshot read-only, no-store.
- PUT `/api/admin/production/production-data/fuel/:id` — fingerprint/revision/allocations/reason; actor dari autentikasi server.
- POST `/api/admin/production/production-data/density-snapshots` — year/month; snapshot dihitung ulang dari sumber server.

Semua endpoint berada di router dengan requireAuth + requireAdmin. Skema sumber saat ini tidak mempunyai tenant_id/project_id; boundary mengikuti database client yang dikonfigurasi server. Tidak menerima tenant/project dari request untuk mengganti database/cakupan. Belum merupakan implementasi multi-tenant shared-database atau RBAC per proyek; migrasi arsitektur tersebut memerlukan pekerjaan terpisah.

## Verifikasi

- Unit tests: formula coal, snapshot, missing density/TF, kecocokan fuel, duplikasi, pembagian manual, perubahan sumber, dynamic JOB, total bulanan, weighted distance, overlap hujan, kalender.
- API integration dengan database tiruan: 401 tanpa login, 403 meski JWT mencoba memberi role admin kepada karyawan, validasi 422, 409 konflik, retry tanpa audit ganda, 404 source hilang.
- `backend/src/scripts/verify_production_data.js`: query data Supabase, validasi schema dalam rollback, rekonsiliasi total fuel terhadap query sumber.
- `tools/verify-production-data-ui.cjs`: headless Edge memakai modul UI asli dan fixture terisolasi; 1366px/640px, dynamic JOB, scroll, error menyimpan/draft, double submit, refresh; ekspor XLSX dua worksheet dengan merged headers dan 60 baris per area. Fixture tidak menulis transaksi produksi.
- Seluruh suite backend dan admin lulus setelah memperbarui tes cache agar menerima versi asset yang lebih baru.

## Status rilis dan batasan

Kode lokal siap rilis; deployment Vercel untuk fitur ini belum dijalankan dalam tugas ini. Aset lama tetap aktif sampai rilis.

Snapshot density tidak dapat merekonstruksi density lama yang sudah diubah sebelum snapshot pertama. Acuan awal berasal dari planning yang tersedia, ditampilkan transparan dan dikunci secara eksplisit.
Truck factor mengikuti mekanisme effective-date yang sudah ada; laporan merupakan rekap operasional dinamis, bukan period closing akuntansi.
Saat offline/gagal memuat, halaman menampilkan error dan tombol Perbarui; alokasi gagal tidak dianggap tersimpan. Belum ada antrean offline persisten.
