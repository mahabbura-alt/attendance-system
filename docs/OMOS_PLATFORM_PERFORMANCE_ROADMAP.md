# OMOS Platform Performance Roadmap

Tanggal inspeksi: 6 September 2026  
Sumber inspeksi: rekaman proses refresh dashboard OMOS berdurasi 11,43 detik.

## Ringkasan Temuan

Ketika pengguna melakukan refresh dari **OB Productivity Planning**, aplikasi sempat kembali ke halaman default **Absensi**, memuat data Absensi dan master HR, kemudian baru memulihkan halaman OB Productivity Planning. Akibatnya, pengguna melihat perpindahan halaman yang tidak diperlukan dan server menerima request untuk modul yang tidak sedang digunakan.

Penyebab utama yang ditemukan:

1. Tab terakhir baru dipulihkan setelah seluruh data awal selesai dimuat.
2. Data Absensi, karyawan, shift, lokasi, dan registrasi dimuat untuk setiap refresh tanpa memperhatikan tab aktif.
3. Master produksi dimuat saat `DOMContentLoaded`, meskipun pengguna berada di modul nonproduksi.
4. Seluruh modul dashboard dan library berat dimuat secara eager pada halaman pertama.
5. Backend serverless masih menjalankan pemeriksaan serta schema SQL saat cold start.

## Sasaran Pengalaman Pengguna

- Shell OMOS terlihat dalam waktu kurang dari 0,5 detik pada koneksi normal.
- Tab aktif kembali tanpa flash atau perpindahan ke halaman lain.
- Tab aktif dapat digunakan sekitar 1–1,5 detik pada kondisi warm.
- Filter, periode, dan konteks kerja pengguna tidak hilang setelah refresh.
- Modul yang tidak dibuka tidak mengambil data operasional.
- Loading, empty state, error state, dan status sinkronisasi dapat dibedakan dengan jelas.

## P0 — Correct Startup Flow

Status: **Diimplementasikan, diverifikasi, dan dideploy ke production**

### Ruang lingkup

- [x] Membaca tab terakhir sebelum aplikasi ditampilkan.
- [x] Mengaktifkan shell tab tersebut sebelum render pertama.
- [x] Menampilkan loading skeleton hanya pada area konten.
- [x] Menghapus full bootstrap data yang tidak berkaitan dengan tab aktif.
- [x] Memuat dependency data berdasarkan tab aktif.
- [x] Menghilangkan pemanggilan master produksi otomatis pada semua halaman.
- [x] Menghilangkan pemanggilan Payroll otomatis ketika startup.
- [x] Mencegah event navigasi produksi terpasang dua kali.
- [x] Verifikasi browser: refresh dari OB Productivity tetap berada di OB Productivity.
- [x] Verifikasi browser: refresh dari modul HR tetap berada di modul HR.
- [x] Verifikasi browser: pengguna tanpa akses produksi diarahkan ke tab pertama yang diizinkan.

### Acceptance criteria

1. Refresh dari suatu tab tidak menampilkan tab Absensi sebagai halaman perantara.
2. Startup hanya memanggil API yang diperlukan tab aktif, selain validasi sesi dan notifikasi ringan.
3. Sidebar tetap terlihat selama loading dan area konten menampilkan skeleton yang stabil.
4. Navigasi tab setelah startup tetap memuat data sesuai kebutuhan.

## P1 — Actual Load-Time Reduction

Status: **Tahap 1 diimplementasikan, diverifikasi, dan dideploy ke production**

### Rencana

- [x] Menunda pemuatan seluruh modul produksi sampai pengguna memasuki Mine Planning.
- [x] Memuat XLSX, PDF, dan Chart.js hanya ketika tab yang membutuhkannya dibuka.
- [x] Deduplicate request master produksi yang berjalan bersamaan.
- [x] Memindahkan schema creation runtime yang aktif ke migration `024_runtime_schema_hardening.sql`.
- [ ] Pecah `production.js` menjadi modul per dashboard dan muat dengan dynamic import.
- [ ] Terapkan stale-while-revalidate untuk master data yang aman di-cache.
- Tambahkan endpoint bootstrap kecil sesuai domain bila beberapa request selalu berjalan bersama.
- [ ] Audit indeks query Supabase berdasarkan query yang paling sering dan paling lambat.
- [ ] Terapkan pagination atau virtual rendering untuk dataset besar.

### Acceptance criteria

1. [x] Bundle startup tidak lagi membawa seluruh fitur ekspor, chart, dan dashboard produksi.
2. [x] Tidak ada schema SQL yang dijalankan saat serverless cold start.
3. [x] Request master yang sama hanya berjalan sekali pada satu siklus pemuatan.
4. [ ] Tabel besar tidak merender seluruh histori sekaligus.

## P2 — Enterprise Performance & Observability

Status: **Tahap 1 diimplementasikan, diverifikasi, dan siap dideploy**

### Rencana

- [x] Tambahkan pengukuran `performance.mark` untuk request API dan pemuatan tab.
- [x] Tambahkan `Server-Timing` untuk keseluruhan proses backend per request.
- [x] Gunakan request ID untuk menelusuri browser hingga backend.
- [x] Tambahkan log runtime terstruktur: route, status, request ID, durasi.
- [x] Tampilkan status `Memuat`, `Tersinkron`, dan `Perlu diperiksa` di dashboard.
- [x] Pantau FCP, LCP, CLS, INP, dan long task secara lokal di browser tanpa mengirim data operasional.
- [x] Tetapkan performance budget dan regression gate untuk mencegah library berat masuk ke initial load.
- [ ] Aktifkan Vercel Speed Insights pada dashboard Vercel untuk agregasi real-user metrics.
- [ ] Tambahkan slow query timing spesifik di repository database.
- Prefetch tab yang paling mungkin dibuka berikutnya hanya ketika browser idle.
- Tambahkan status offline dan waktu pembaruan terakhir setelah offline queue tersedia.

## Arsitektur Startup Target

```text
Refresh
  -> baca tab terakhir dari sesi/URL
  -> tampilkan shell OMOS dan skeleton tab aktif
  -> validasi sesi dan hak akses
  -> pulihkan filter tab
  -> muat data tab aktif saja
  -> render dan tandai tersinkron
  -> prefetch opsional ketika browser idle
```

## Catatan Implementasi

- Optimasi dilakukan secara bertahap tanpa rewrite framework.
- `localStorage` tetap menjadi fallback konteks pengguna. Pada tahap berikutnya, URL tab dapat dijadikan sumber utama agar bookmark serta Back/Forward browser bekerja konsisten.
- Cache hanya boleh menyimpan data yang sesuai user/tenant dan harus mempunyai versi atau waktu kedaluwarsa.
- Perubahan performa tidak boleh mengubah formula, unit, atau sumber kebenaran data operasional tambang.
