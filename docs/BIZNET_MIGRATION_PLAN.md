# OMOS Biznet Migration Plan

Status: `PRODUCTION CUTOVER COMPLETE / BIZNET PRIMARY`  
Prepared: 2026-10-05  
Canonical source: `D:\OneDrive\Desktop\OMOS`

## 1. Tujuan dan aturan utama

Migrasi memindahkan aplikasi OMOS, seluruh data aplikasi PostgreSQL, dan object
storage ke server Biznet tanpa menghentikan Vercel + Supabase selama masa uji
sekitar satu minggu.

Aturan keselamatan data:

1. Hanya ada **satu database writable yang otoritatif** pada setiap fase.
2. Selama pilot, Vercel dan Biznet memakai Supabase yang sama sebagai database
   dan storage primer. Ini mencegah split-brain dan kehilangan transaksi.
3. PostgreSQL dan object storage Biznet disiapkan sebagai target non-produksi,
   di-refresh dan direkonsiliasi, tetapi belum menerima transaksi karyawan.
4. Cutover database dilakukan dalam maintenance window dengan write freeze,
   final backup, restore, validasi, lalu perpindahan endpoint.
5. Vercel/Supabase tetap tersedia sebagai rollback sampai Biznet dinyatakan
   stabil dan selisih data nol.
6. Tidak ada kredensial yang ditulis ke repository, image, compose file, log,
   atau dokumen migrasi.

## 2. Baseline terverifikasi

### Sumber saat ini

- Runtime: Vercel, entry `api/index.js` ke Express backend.
- Database: Supabase PostgreSQL 17.6.
- Database aplikasi: 98 tabel `public`, 50.433 baris, 78 tabel berisi data.
- Ukuran database saat inventory: sekitar 82 MB.
- Integritas relasional: 250 foreign key, 2 sequence, dan 189 function di
  schema `public`.
- Data yang harus ikut mencakup People/HR, karyawan, absensi, roster, payroll,
  master data, HM, produksi, ritase, standby, breakdown, fuel, periodic service,
  fleet, planning, audit, dan logistik.
- Storage Supabase:
  - `absensi-foto`: 4.087 object, sekitar 3,39 GB.
  - `log-activity`: 21 object, sekitar 0,52 MB.
- Aplikasi saat ini menulis foto melalui Supabase Storage. Environment MinIO
  tersedia, tetapi implementasi aktif `storage.js` masih Supabase-specific.

### Target Biznet

- Ubuntu 24.04.4 LTS, timezone Asia/Jakarta.
- 2 vCPU, RAM 3,8 GiB.
- Disk root 58 GB, sekitar 55 GB tersedia saat inventory.
- SSH key authentication dan non-interactive sudo tersedia.
- Docker/Compose belum terpasang.
- Firewall UFW belum aktif.
- Hanya SSH port 22 yang sedang listen.

### Temuan keamanan awal

- `biznet server.txt` di-ignore oleh Git dan tidak tracked.
- ACL private key lokal telah dikunci hanya untuk pemilik.
- Password server yang tersimpan sebagai plaintext harus dipindahkan ke password
  manager dan dirotasi sebelum go-live.
- `docker-compose.yml` eksisting berisi kredensial development dan tidak boleh
  digunakan langsung pada server produksi.

## 3. Arsitektur transisi

### Fase pilot satu minggu

```text
Karyawan ──> Vercel OMOS ───────┐
                                ├──> Supabase PostgreSQL (PRIMARY WRITABLE)
Tester ────> Biznet OMOS ───────┘
                                └──> Supabase Storage (PRIMARY WRITABLE)

Biznet PostgreSQL + MinIO
└── target restore/read-only untuk verifikasi, bukan sumber transaksi
```

Kedua aplikasi harus menggunakan konfigurasi JWT, timezone, formula, dan source
code revision yang sama. Akses Biznet selama pilot menggunakan subdomain khusus,
TLS, dan daftar tester terbatas. Tidak ada dual-write database.

### Arsitektur setelah cutover

```text
Internet
   │
Nginx / TLS
   │
OMOS Node.js (private container network)
   ├── PostgreSQL 17 (private, tidak publish port 5432)
   └── MinIO (private; console hanya melalui VPN/SSH tunnel)

Backup terenkripsi ──> lokasi eksternal di luar VM Biznet
```

Vercel tidak langsung dihapus. Setelah cutover, Vercel berada dalam maintenance
atau read-only standby agar tidak menulis kembali ke snapshot Supabase lama.

## 4. Tahapan implementasi

### P0 — Security dan fondasi server

1. Patch Ubuntu dan aktifkan automatic security updates.
2. Rotasi password awal; pakai SSH key-only dan nonaktifkan password login SSH
   setelah key kedua/emergency key diverifikasi.
3. Aktifkan UFW: allow SSH, HTTP, HTTPS; deny inbound lain.
4. Pasang fail2ban, Docker Engine, Compose plugin, dan log rotation.
5. Buat user/service directory khusus, misalnya `/opt/omos`, dengan owner non-root.
6. Siapkan DNS pilot dan TLS Let's Encrypt.
7. Simpan secrets di root-owned environment file dengan mode `600`, bukan Git.
8. Batasi Postgres, MinIO API, dan MinIO console pada private Docker network.
9. Tambahkan monitoring CPU, RAM, disk, container health, HTTP latency, error rate,
   database connections, backup age, dan certificate expiry.

**Gate:** UFW aktif, SSH key-only diuji dari sesi kedua, tidak ada database/storage
port publik, dan recovery console Biznet dapat diakses.

### P1 — Packaging aplikasi Biznet

1. Buat deployment compose produksi terpisah dari compose development saat ini.
2. Service minimum: `nginx`, `app`, `postgres`, `minio`, dan `backup`.
3. Image aplikasi dibangun reproducible dari lockfile dan commit yang sama dengan
   Vercel; jangan mount source writable ke container produksi.
4. Nginx melayani `admin-dashboard`, `mobile-web`, APK, dan reverse proxy `/api`
   serta `/health` ke backend.
5. Tambahkan healthcheck aplikasi, Postgres, dan MinIO; gunakan restart policy.
6. Tetapkan resource limit agar satu service tidak menghabiskan RAM 4 GB.
7. Untuk pilot, environment Biznet tetap menunjuk ke Supabase DB dan Storage.

**Gate:** login, dashboard, mobile web, APK download, upload/read foto, export,
import, dan seluruh API kritis bekerja melalui HTTPS Biznet.

### P2 — Initial database restore ke target

Gunakan PostgreSQL client 17 agar sesuai dengan server sumber.

1. Ambil backup konsisten schema `public` dengan format custom, tanpa owner/ACL.
2. Simpan checksum SHA-256 dan metadata waktu/source revision.
3. Buat extension target yang dipakai aplikasi: `pgcrypto`, `uuid-ossp`, dan
   extension lain yang terbukti direferensikan oleh schema aplikasi.
4. Restore ke database staging Biznet yang kosong.
5. Jangan menyalin schema managed Supabase (`auth`, `realtime`, `vault`) secara
   membabi buta. Autentikasi OMOS saat ini menggunakan tabel aplikasi di `public`;
   schema managed hanya dipindahkan jika dependency audit membuktikannya perlu.
6. Jalankan `ANALYZE`, periksa invalid constraint, function, trigger, sequence,
   index, dan migration/schema version.
7. Refresh staging target secara nightly selama pilot. Karena database saat ini
   kecil, full refresh lebih aman daripada membuat CDC sementara yang rumit.

Contoh bentuk backup; nilai koneksi harus berasal dari secret environment:

```bash
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file=/secure-backup/omos-public.dump
sha256sum /secure-backup/omos-public.dump > /secure-backup/omos-public.dump.sha256
```

### P3 — Migrasi object storage

1. Tambahkan abstraction storage provider di backend: `SupabaseStorageProvider`
   dan `MinioStorageProvider`; controller tidak boleh mengenal provider.
2. Gunakan object key stabil dan simpan provenance/provider. Jangan menjadikan
   public URL provider sebagai identitas permanen file.
3. Export object kedua bucket dengan manifest:
   `bucket`, `object_key`, `size`, `content_type`, `etag/checksum`, dan status.
4. Upload ke MinIO dengan key identik dan retry idempotent.
5. Verifikasi jumlah object, total byte, dan checksum sampel/seluruh object.
6. Selama pilot, Supabase tetap writable. Jalankan delta copy sebelum cutover.
7. Saat cutover, ubah upload baru ke MinIO dan gunakan fallback read Supabase
   hanya untuk object yang belum tervalidasi.
8. Jangan menghapus bucket Supabase sampai retention rollback berakhir.

**Blocker:** cutover storage tidak boleh dilakukan sebelum provider abstraction,
manifest reconciliation, dan read fallback lulus pengujian.

### P4 — UAT paralel

Periode yang direkomendasikan: 5–7 hari.

1. Vercel tetap jalur karyawan produksi.
2. Biznet hanya untuk tester/kelompok canary, tetapi tetap membaca/menulis ke
   Supabase primer sehingga data tetap satu sumber.
3. Uji role/RBAC dan project scope, karyawan, absensi, roster, payroll, input data,
   fuel, ritase, produksi, standby, breakdown, periodic service, planning,
   leaderboard, report, logistics, audit, foto, import/export, dan APK.
4. Bandingkan response endpoint kritis antara Vercel dan Biznet pada filter sama.
5. Jalankan load test terkontrol; target awal untuk VM ini harus ditentukan dari
   trafik produksi nyata, bukan angka asumsi.
6. Catat latency p50/p95, error rate, memory peak, DB pool saturation, dan disk.
7. Lakukan restore drill dari backup target ke database terpisah.

### P5 — Final database dan storage cutover

1. Turunkan DNS TTL minimal 24 jam sebelumnya.
2. Umumkan maintenance window dan aktifkan server-side write freeze pada Vercel.
3. Pastikan tidak ada transaksi in-flight dan catat high-water mark tiap tabel
   kritis.
4. Ambil final `pg_dump`, checksum, dan final storage delta.
5. Restore target dari database kosong; jangan restore menimpa database uji.
6. Jalankan rekonsiliasi wajib pada bagian 5.
7. Ubah environment Biznet ke Postgres/MinIO lokal dan restart terkontrol.
8. Jalankan smoke test authenticated dan transaksi canary.
9. Alihkan domain produksi ke Biznet.
10. Pertahankan Vercel/Supabase dalam maintenance/read-only standby.

Tidak boleh membuka kembali write pada kedua sisi setelah final backup.

### P6 — Hypercare dan decommission bertahap

1. Monitor intensif minimal 72 jam dan lanjutkan observasi sampai satu minggu.
2. Backup database harian dan WAL/incremental sesuai target RPO; backup harus
   terenkripsi dan berada di luar VM Biznet.
3. Backup object storage terpisah dari sinkronisasi MinIO.
4. Setelah owner menyetujui rekonsiliasi dan rollback window berakhir, barulah
   rencanakan penghentian Vercel/Supabase. Tidak termasuk scope eksekusi saat ini.

## 5. Rekonsiliasi wajib

Rekonsiliasi dijalankan untuk initial restore, refresh nightly, dan final cutover.

| Area | Pemeriksaan |
| --- | --- |
| Schema | 98 tabel aplikasi, function, trigger, index, FK, sequence, extension |
| Seluruh tabel | `count(*)` sumber vs target dan daftar selisih |
| Primary key | jumlah distinct PK, null PK, duplicate business key |
| Karyawan/Users | jumlah aktif/nonaktif, role, relasi employee-user |
| Absensi | jumlah per tanggal/shift/status, min/max timestamp, foto terhubung |
| Produksi | jumlah per tanggal/PIT/JOB/shift, total ritase/volume/HM |
| Fuel | jumlah transaksi, total liter per tanggal/JOB, allocation dan audit |
| Downtime | standby, breakdown, periodic service, status aktif/selesai |
| Planning | versi/effective date, fleet deployment, SPO dan audit |
| Audit | jumlah record, min/max waktu, referensi actor/transaksi |
| Logistics | dokumen, ledger, FIFO layer, allocation, serial, approval |
| Storage | object count, total bytes, missing key, checksum/etag |
| Waktu | timezone Asia/Jakarta dan operational-date/shift boundary |

Final gate memerlukan:

```text
critical_table_count_delta = 0
orphan_foreign_key = 0
missing_storage_object = 0
duplicate_business_key = 0
failed_smoke_test = 0
```

Angka agregat mining dibandingkan dengan toleransi formula yang sudah berlaku;
migrasi tidak boleh mengubah formula, unit, density, atau rounding.

## 6. Rollback

### Sebelum Biznet menerima write produksi

- Arahkan trafik kembali ke Vercel.
- Supabase masih primer; tidak ada transaksi yang perlu dikembalikan.

### Setelah Biznet menerima write produksi

- Jangan sekadar mengarahkan DNS kembali karena Supabase sudah menjadi snapshot
  lama.
- Aktifkan maintenance, ekspor delta transaksi Biznet sejak cutover, verifikasi,
  lalu apply balik secara terkontrol ke Supabase sebelum Vercel writable kembali.
- Simpan audit siapa, kapan, dan record apa yang direplikasi balik.

Rollback dinyatakan selesai hanya jika rekonsiliasi kembali menghasilkan nol
selisih pada data kritis.

## 7. Kapasitas dan risiko

VM 2 vCPU/4 GB/60 GB cukup untuk pilot satu node dengan tuning, tetapi memiliki
single point of failure dan ruang terbatas untuk pertumbuhan foto serta backup.

Minimum kontrol:

- Alert disk 70% warning, 80% critical, 90% stop non-critical upload.
- Jangan menyimpan banyak generasi backup pada disk yang sama.
- Gunakan external encrypted backup/object storage.
- Batasi memory Node, Postgres, dan MinIO; pantau OOM/restart.
- Siapkan snapshot VM sebelum cutover dan restore test terpisah.

Untuk production enterprise disarankan memisahkan database/object storage atau
menambah managed backup, secondary node, dan storage volume yang dapat diperbesar.

## 8. Jadwal yang direkomendasikan

| Hari | Aktivitas |
| --- | --- |
| 0 | Security hardening, DNS pilot, Docker, monitoring |
| 1 | Deploy Biznet app yang masih memakai Supabase primer |
| 2 | Initial DB restore dan initial storage copy ke target |
| 3–7 | UAT/canary, nightly refresh, reconciliation, restore drill |
| 7 | Go/no-go review dan final cutover rehearsal |
| 8 | Write freeze, final dump/delta, reconciliation, DNS cutover |
| 9–15 | Hypercare; Vercel/Supabase tetap standby |

## 9. Go/no-go checklist

- [ ] SSH key-only, UFW, fail2ban, TLS, secret file permission selesai.
- [ ] Docker production compose tidak mengandung default credential.
- [ ] Commit/image revision Vercel dan Biznet tercatat.
- [ ] Biznet UAT seluruh modul lulus.
- [ ] Backup database dan storage dapat direstore.
- [ ] Storage provider abstraction dan fallback lulus.
- [ ] Rekonsiliasi initial dan rehearsal menghasilkan nol selisih kritis.
- [ ] Monitoring dan alert aktif.
- [ ] Write-freeze dan maintenance mode telah diuji.
- [ ] Rollback rehearsal dan PIC/escalation path tersedia.
- [ ] Owner memberi persetujuan cutover.

## 10. Status eksekusi saat ini

Terverifikasi pada 2026-10-05:

- fondasi server terpasang: Docker/Compose, Nginx, UFW, fail2ban, automatic
  security updates, SSH key-only, dan timezone Asia/Jakarta;
- aplikasi pilot berjalan dalam container Node.js 24 dan hanya dipublish ke
  loopback `127.0.0.1:3000` di belakang Nginx;
- HTTPS alamat IP menggunakan Let's Encrypt short-lived certificate, timer
  renewal aktif, dan simulated renewal berhasil;
- aplikasi Biznet masih memakai Supabase sebagai database/storage primer;
- backup schema `public` PostgreSQL telah dibuat, checksum dan daftar restore
  diverifikasi, lalu direstore ke PostgreSQL 17 staging yang tidak membuka port
  database ke internet;
- rekonsiliasi initial restore: 98 tabel, 250 foreign key, 50.433 baris, dan
  selisih count per tabel nol pada waktu snapshot;
- deployment preview Vercel compatibility gateway telah dibuat dan mem-proxy
  `/api/*` serta `/health` ke Biznet; preview health 200, batas admin 401 tanpa
  token, dan endpoint publik 200;
- Vercel production tetap memakai runtime serverless lama dan belum dipromosikan
  ke gateway Biznet; Supabase tetap primary writable.

Status yang belum dilakukan pada fase pilot awal (superseded oleh keputusan
full cutover di bawah):

- migrasi object storage serta provider abstraction MinIO;
- UAT authenticated seluruh modul dan APK canary;
- monitoring/alert operasional lengkap dan restore drill terpisah;
- write freeze, final delta, perpindahan database/storage primary;
- promosi gateway Vercel ke production atau penghentian Vercel/Supabase.

### Full cutover 2026-10-05

Atas perubahan keputusan owner, masa pilot dibatalkan dan cutover penuh
dilaksanakan pada hari yang sama:

- domain Vercel lama dipertahankan sebagai compatibility gateway untuk APK dan
  portal yang sudah tersebar, tetapi seluruh `/api/*` serta `/health` diproxy ke
  Biznet; response health production menunjukkan `serverless=false`;
- maintenance write-freeze diterapkan sebelum final dump/delta dan baru dibuka
  setelah Biznet local data plane lulus verifikasi;
- final PostgreSQL source dan target sama-sama berisi 50.434 baris dengan
  perbedaan count per tabel nol;
- aplikasi production memakai PostgreSQL 17 lokal `omos_staging`, bukan
  `DATABASE_URL` Supabase;
- 4.109 object storage dengan total 3.393.335.152 byte telah disalin dan delta
  final menunjukkan 4.109 object unchanged; upload/read/delete baru memakai
  local storage Biznet;
- Supabase tidak lagi menjadi writable primary, tetapi data lama tidak dihapus
  agar tetap tersedia sebagai snapshot rollback;
- backup harian database + object storage aktif melalui systemd, tiga generasi
  lokal dipertahankan; final database dump dan manifest juga disalin ke media
  lokal di luar repository;
- full backend regression setelah cutover lulus 313/313.

Risiko tersisa setelah cutover: backup harian berada pada disk VM yang sama.
Salinan final database berada di luar VM dan Supabase menyimpan baseline object
lama, tetapi backup object baru pasca-cutover perlu diarahkan ke storage off-host
atau snapshot Biznet untuk memenuhi target disaster recovery enterprise.

## 11. Redirect, domain, dan kompatibilitas APK

### Domain permanen

Jangan menjadikan hostname milik provider sebagai alamat permanen client.
Siapkan domain yang dikendalikan OMOS, misalnya:

```text
portal.<domain-omos>    web karyawan
admin.<domain-omos>     dashboard admin
api.<domain-omos>       API APK/web
download.<domain-omos>  APK
```

Selama pilot, domain dapat menunjuk ke Biznet tanpa mengubah domain Vercel.
Setelah cutover, DNS domain permanen tetap menunjuk Biznet sehingga migrasi
infrastruktur berikutnya tidak memerlukan APK baru.

Jika domain belum tersedia, pilot masih dapat berjalan dengan alamat IP Biznet
sebagai external origin. Origin **wajib HTTPS dengan sertifikat IP publik yang
valid**; jangan meneruskan token, GPS, dan foto melalui HTTP atau sertifikat
self-signed. Let’s Encrypt menyediakan IP address certificate berumur pendek
sekitar enam hari, sehingga Certbot/ACME renewal harus otomatis dan alert expiry
harus diuji sebelum trafik karyawan diarahkan.

```text
APK/portal lama
  -> HTTPS Vercel
  -> external rewrite
  -> HTTPS <IP-Biznet> dengan IP certificate valid
```

Mode tanpa domain cocok untuk pilot dan compatibility window, tetapi bukan target
jangka panjang karena bergantung pada IP tetap, renewal sertifikat yang sangat
sering, dan Vercel sebagai front door bagi APK lama.

### Portal web dan download APK

- Route web lama di Vercel boleh memberikan redirect `308` ke Biznet dengan path
  dan query string dipertahankan.
- Route download APK lama boleh memberikan redirect `302/307` ke APK terbaru di
  Biznet.
- TLS Biznet harus valid sebelum redirect diaktifkan.
- Jangan redirect login/admin ke alamat IP; gunakan hostname HTTPS.

### APK lama

APK eksisting mengandung hostname Vercel pada konfigurasi build dan fallback
session. Karena absensi mengirim `POST` multipart termasuk foto dan token, API
lama **tidak boleh mengandalkan redirect 301/302**. Client HTTP dapat mengubah
method, membuang body, atau tidak meneruskan header sensitif.

Audit artifact pada 2026-10-05 mengonfirmasi build V1.0, V2.0, V2.1, dan V2.2
semuanya memakai hostname Vercel yang sama, package yang sama, dan signing
certificate yang sama. Detail hash dan test matrix tersedia di
`docs/APK_REVERSE_PROXY_AUDIT.md`.

Masa kompatibilitas yang aman:

```text
APK lama
  -> Vercel /api/* compatibility gateway
  -> HTTPS Biznet /api/*

APK baru
  -> https://api.<domain-omos>/api/*
  -> Biznet
```

Gateway harus reverse-proxy, bukan redirect, dan mempertahankan method, body,
`Authorization`, content type, response status, request ID, serta batas upload.
Gateway tidak menyimpan data atau memiliki business logic.

### Rollout APK

1. Build APK baru menggunakan domain API permanen, bukan hostname Vercel/IP.
2. Publikasikan APK baru di Biznet dan melalui link download lama.
3. Pertahankan proxy Vercel untuk APK lama selama 30–60 hari atau sampai telemetry
   menunjukkan tidak ada request client lama.
4. Tampilkan minimum-supported-version dan pesan wajib update sebelum proxy lama
   dihentikan.
5. Setelah seluruh client pindah, nonaktifkan proxy bertahap dan rotasi secret
   yang digunakan selama masa kompatibilitas.

### Acceptance redirect/gateway

- [ ] Portal lama menuju halaman Biznet dengan path/query yang benar.
- [ ] Link APK lama mengunduh APK Biznet dengan checksum yang dipublikasikan.
- [ ] APK lama berhasil login, check lokasi, absen datang/pulang, upload foto,
      dan membaca riwayat melalui gateway.
- [ ] APK baru tidak lagi menghubungi hostname Vercel.
- [ ] Tidak ada redirect loop, mixed content, atau CORS failure.
- [ ] Log membedakan trafik APK lama, APK baru, portal, dan admin tanpa mencatat
      token atau data foto.
