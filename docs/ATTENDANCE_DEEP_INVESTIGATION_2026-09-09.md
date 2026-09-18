# Investigasi Mendalam Kegagalan Absensi OMOS

## Ringkasan Eksekutif

Investigasi menemukan dua akar masalah yang dapat menjelaskan laporan karyawan tidak dapat melakukan absensi melalui portal web.

1. **False pending session pada portal dan APK.** Endpoint riwayat mengembalikan gabungan absensi kamera dan keterangan presensi manual. Baris cuti, izin, sakit, atau status manual tidak memiliki `waktu_datang` maupun `waktu_pulang`. Klien sebelumnya menganggap setiap baris dengan `waktu_pulang = null` sebagai sesi aktif, sehingga tombol Absen Datang dapat terkunci walaupun tidak ada sesi nyata pada tabel absensi.
2. **Kebijakan akurasi GPS tidak konsisten.** Backend menerima akurasi GPS sampai 500 meter, tetapi portal web dan source APK menolak di atas 100 meter sebelum request absensi dikirim. Perangkat dengan fix GPS 101–500 meter dapat gagal di sisi klien meskipun backend seharusnya masih melakukan validasi geofence.

Hipotesis bahwa lokasi yang dipilih saat pendaftaran mengikat karyawan ke satu titik absensi **tidak terbukti pada backend saat ini**. `check-lokasi`, Absen Datang, dan Absen Pulang mengambil seluruh lokasi resmi dari tabel `lokasi_kantor` dan menerima posisi yang berada di dalam salah satunya.[^1]

## Cakupan

Komponen yang diperiksa:

- portal karyawan `/karyawan.html`;
- source APK Android;
- frontend state tombol dan rekonsiliasi request;
- controller, session cleanup, geofence, autentikasi, dan route backend;
- routing dan deployment Vercel;
- regression test backend, portal, dan dashboard;
- runtime log dan health endpoint production.

Tidak dilakukan percobaan absensi menggunakan identitas atau foto karyawan. Audit agregat database production juga tidak dapat dilakukan dari koneksi lokal karena koneksi database lokal menolak koneksi (`ECONNREFUSED`).

## Temuan 1 — Tombol Absen Datang Terkunci Tanpa Sesi Nyata

### Alur penyebab

Endpoint riwayat menggunakan `FULL OUTER JOIN` antara `absensi` dan `keterangan_presensi` agar status manual tetap muncul pada riwayat.[^2] Baris manual dapat berbentuk:

```text
waktu_datang = null
waktu_pulang = null
kategori_manual = cuti | izin | sakit | alpa | hadir_manual
```

Logika klien sebelumnya:

```javascript
rows.find(row => !row.waktu_pulang)
```

Karena `!null` bernilai benar, baris manual dianggap sesi pending. Dampaknya:

- tombol Absen Datang dinonaktifkan;
- tombol Absen Pulang diaktifkan;
- tampilan memberi kesan ada sesi lama yang belum ditutup;
- backend sebenarnya dapat tidak memiliki sesi aktif sama sekali.

Pola yang sama ditemukan pada:

- status awal portal web;
- rekonsiliasi portal setelah koneksi terputus;
- halaman utama APK;
- rekonsiliasi APK setelah koneksi terputus.[^3]

### Perbaikan

Sesi aktif sekarang wajib memenuhi dua kondisi:

```text
waktu_datang tersedia
AND waktu_pulang belum tersedia
```

Backend juga menambahkan kontrak eksplisit:

```json
{
  "is_attendance_record": true,
  "is_pending_session": true
}
```

Portal memprioritaskan `is_pending_session` dari server dan tetap memiliki fallback berbasis timestamp untuk kompatibilitas selama rollout. Source APK menggunakan pola yang sama.[^2][^3]

## Temuan 2 — Penolakan Lokasi Bukan Karena Lokasi Pendaftaran

### Aturan backend aktual

Walaupun `users.lokasi_kantor_id` masih disimpan untuk profil, token, dan minimap, field tersebut tidak digunakan untuk menentukan sah atau tidaknya lokasi absensi. Ketiga jalur operasional berikut memanggil daftar seluruh lokasi:

- `POST /api/absensi/check-lokasi`;
- `POST /api/absensi/datang`;
- `POST /api/absensi/pulang`.[^1]

Setiap posisi dibandingkan dengan seluruh lokasi resmi menggunakan Haversine. Posisi diterima apabila berada dalam radius minimal satu lokasi.[^4]

Kesimpulan: karyawan yang mendaftar dengan lokasi Kantor tetap dapat absen di lokasi Tambang, dan sebaliknya, selama titik tersebut ada pada master lokasi dan koordinat berada dalam radius.

### Akar masalah yang ditemukan

Backend menetapkan `MAX_ACCURACY_METER = 500`, tetapi portal dan APK memakai batas lokal 100 meter.[^4] Akibatnya request dengan accuracy 101–500 meter berhenti di perangkat dan tidak pernah dinilai oleh backend.

Perbaikan yang diterapkan:

- portal tidak lagi membuat keputusan independen berdasarkan angka 100 meter;
- nilai accuracy tetap dikirim ke backend;
- backend menjadi sumber keputusan tunggal;
- source APK diselaraskan menjadi 500 meter;
- konfigurasi lokasi dengan koordinat/radius kosong atau tidak valid diabaikan;
- bila tidak ada lokasi valid, backend mengembalikan configuration error dan gagal secara tertutup.

Perubahan ini tidak memperbesar radius lokasi. Jarak aktual terhadap titik resmi tetap divalidasi menggunakan radius setiap lokasi.

## Observability dan Audit

Runtime Vercel tidak menghasilkan error log untuk jendela 24 jam yang diperiksa. Karena penolakan 403/409 merupakan respons bisnis dan bukan exception 500, kejadian tersebut sebelumnya sulit dibedakan dari dashboard log umum.

Controller sekarang menghasilkan event terstruktur `attendance_decision` dengan:

- request ID;
- aksi `check-lokasi`, `datang`, atau `pulang`;
- outcome accepted/rejected;
- reason code;
- user ID;
- akurasi dalam meter bila tersedia;
- jarak ke lokasi terdekat;
- ID lokasi terdekat.

Koordinat mentah dan foto tidak ditulis ke log. Reason code API juga ditambahkan untuk membedakan:

- `ATTENDANCE_ACTIVE_SESSION_EXISTS`;
- `ATTENDANCE_GPS_ACCURACY_REJECTED`;
- `ATTENDANCE_OUTSIDE_APPROVED_GEOFENCES`;
- `ATTENDANCE_LOCATION_ACCEPTED`.

## Matriks Risiko

| Risiko | Bukti | Dampak | Status |
| --- | --- | --- | --- |
| Baris manual dianggap sesi pending | Reproduksi regression test portal | Tombol datang terkunci | Diperbaiki lokal |
| Portal menolak accuracy 101–500 m | Kondisi hardcoded pada deployed JS | Request tidak pernah sampai backend | Diperbaiki lokal |
| APK memakai predicate pending yang sama | Source `HomeActivity` dan `AbsenActivity` | Tombol APK dapat terkunci | Source diperbaiki; APK belum dibangun |
| Lokasi pendaftaran mengikat geofence | Tidak ditemukan pada tiga endpoint absensi | Dugaan awal tidak terbukti | Tidak ada perubahan rule |
| Master lokasi invalid | Utility menerima data tanpa sanitasi ketat | Hasil nearest location dapat menyesatkan | Diperketat |
| Kurang reason-code runtime | Vercel tidak memiliki log penolakan yang mudah diaudit | Investigasi insiden lambat | Logging ditambahkan |

## Verifikasi

- Backend: 83 test lulus.
- Portal web: 11 test lulus.
- Admin dashboard: 46 test lulus.
- Total: 140 test lulus, 0 gagal.
- JavaScript syntax check lulus.
- `git diff --check` lulus pada file terkait.
- Health production saat investigasi: `{"status":"ok","serverless":true}`.
- Asset production yang aktif saat investigasi masih memuat dua kondisi lama (`!waktu_pulang` dan `currentAccuracy > 100`), sehingga perbaikan lokal belum berlaku di production sebelum deployment.

Build APK belum berhasil dijalankan pada host ini. Java 8 tidak memenuhi kebutuhan Android Gradle Plugin 8.6; percobaan menggunakan JBR Android Studio kemudian terhenti karena Gradle tidak dapat membuat koneksi loopback. Karena itu, perubahan source APK belum diklaim sebagai build APK terverifikasi.

## Rekomendasi Lanjutan

1. Deploy backend dan portal web setelah review agar false pending dan kebijakan GPS tunggal aktif di production.
2. Build dan distribusikan APK baru menggunakan JDK 17 pada environment Android yang sehat.
3. Tambahkan halaman admin “Attendance Diagnostics” berbasis reason code, tanpa memperlihatkan koordinat mentah kepada role yang tidak berwenang.
4. Ubah minimap APK agar dapat menampilkan seluruh lokasi resmi, bukan hanya lokasi profil, supaya visual konsisten dengan rule multi-point.
5. Lakukan audit agregat setelah deployment: jumlah `ACTIVE_SESSION_EXISTS`, `GPS_ACCURACY_REJECTED`, dan `OUTSIDE_APPROVED_GEOFENCES` per versi klien dan area.

## Sumber

[^1]: OMOS, [`backend/src/controllers/absensiController.js`](../backend/src/controllers/absensiController.js), implementasi `absenDatang`, `absenPulang`, dan `checkLokasi`, diakses 9 September 2026.
[^2]: OMOS, [`backend/src/controllers/absensiController.js`](../backend/src/controllers/absensiController.js) dan [`mobile-web/karyawan.js`](../mobile-web/karyawan.js), kontrak riwayat dan state tombol portal, diakses 9 September 2026.
[^3]: OMOS, [`mobile-android/app/src/main/java/com/perusahaan/absensi/ui/HomeActivity.kt`](../mobile-android/app/src/main/java/com/perusahaan/absensi/ui/HomeActivity.kt) dan [`AbsenActivity.kt`](../mobile-android/app/src/main/java/com/perusahaan/absensi/ui/AbsenActivity.kt), state sesi APK, diakses 9 September 2026.
[^4]: OMOS, [`backend/src/utils/geofence.js`](../backend/src/utils/geofence.js) dan [`mobile-android/app/src/main/java/com/perusahaan/absensi/location/LocationHelper.kt`](../mobile-android/app/src/main/java/com/perusahaan/absensi/location/LocationHelper.kt), kebijakan geofence dan akurasi, diakses 9 September 2026.
