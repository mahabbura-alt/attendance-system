# Rencana Implementasi — Modul Karyawan (OMOS People) v2

Tanggal: 2026-10-12 · Status: **RENCANA — belum ada kode/migrasi yang dijalankan**

Sumber keputusan:
- Contoh tampilan: `admin-dashboard/assets/sample page/omos_karyawan_layout.html` (revisi ke-3, catatan owner 2026-10-12)
- Rancangan DB keluarga: `docs/drafts/employee_family_schema_DRAFT.sql`
- Pre-flight data nyata (read-only): `docs/drafts/karyawan_preflight_readonly.sql`
- Rujukan arsitektur: `docs/OMOS_PEOPLE_ENTERPRISE_OPTION_C_MILESTONE.md`, `docs/omos-modul-karyawan.md`, `OMOS_MASTER_PROJECT_MILESTONE_V2.6.md`

Skill yang dipakai: **to-spec** (format spesifikasi: masalah, solusi, user story, keputusan implementasi, keputusan test) dan **to-tickets** (pecahan tiket *tracer-bullet* vertikal dengan blocker; perubahan lebar memakai pola *expand–contract*). Issue tracker belum dikonfigurasi, jadi tiket ditulis di dokumen ini (bagian 9). Tiket baru dipecah menjadi file per tiket setelah owner menyetujui susunannya.

---

## 1. Problem Statement

Admin HR sudah bisa mencatat karyawan dan pergerakan. Tapi data yang sama punya beberapa sumber yang tidak sinkron, sehingga modul lain (Cuti, Roster, HSE, Produksi, Payroll) bisa salah membaca jabatan seseorang:

- Jabatan dan departemen datang dari tiga tempat berbeda: daftar yang ditulis langsung di dashboard, isian bebas pendaftar HP, dan isian bebas form Rotasi. Isian bebas itu bahkan otomatis membuat jabatan baru di master.
- NRP tidak wajib; karyawan dari registrasi HP disetujui tanpa NRP.
- Tidak ada data pribadi, keluarga, CV, atau dokumen kompetensi di profil karyawan.
- Proses keluar menonaktifkan akun tepat di hari kerja terakhir, dan pergerakan yang jatuh tempo tidak diterapkan otomatis.
- Satu admin bisa membuat sekaligus menyetujui pengajuannya sendiri.

## 2. Solution

Halaman Karyawan v2 sesuai contoh tampilan:
- **Direktori**: status Aktif/Probation/Notice/Keluar, masa kerja, kontrak, wajah, CV & kompetensi (PDF bisa diklik), kelengkapan data.
- **Profil**: Ringkasan, Data pribadi, Keluarga, Kepegawaian (riwayat), Dokumen, Audit.
- **Tambah karyawan**: satu-satunya pintu masuk, wizard 3 langkah (Identitas+Keluarga opsional → Kepegawaian → Absensi & dokumen); lokasi absen bisa lebih dari satu.
- **Pergerakan**: jenis lengkap; alasan diisi manual; site diisi manual; maker ≠ checker; diterapkan otomatis tiap 00:05 WIB.
- **Pengingat**: kontrak, probation, dokumen kedaluwarsa, keluar terjadwal.
- **Setup master**: + Departemen, + Jabatan, pola NRP, checklist.
- Pendaftaran mandiri dari HP ditutup.

## 3. Keputusan owner yang sudah dikunci (2026-10-12)

1. Karyawan baru **hanya** lewat admin dashboard; tab/alur Pendaftaran dihapus.
2. Departemen bisa ditambah dari Setup master; jabatan dipilih dari master (dropdown).
3. Site dan alasan pergerakan **diisi manual** (teks), tanpa master Site/Alasan.
4. Lokasi absen per karyawan bisa **lebih dari satu** (dropdown ceklis).
5. CV dan sertifikat kompetensi diunggah sebagai **PDF** dan bisa dilihat langsung dari Direktori/Profil.
6. Data keluarga & jumlah tanggungan **opsional**, boleh diisi belakangan; kolom DB disiapkan.

## 4. Analisa konflik dengan DB & data lama

Diverifikasi terhadap kode di repo (bukan dari handover). **Tingkat**: 🔴 bisa merusak/membocorkan data · 🟠 perilaku berubah/perlu keputusan · 🟡 utang teknis.

| # | Temuan | Bukti di kode | Dampak | Penanganan dalam rencana |
|---|---|---|---|---|
| K1 🔴 | **Jabatan punya 3 sumber + dibuat otomatis**. `ensureOrg()` membuat departemen/jabatan baru dari teks bebas; form Tambah memakai `DEPARTEMEN_JABATAN_MAP` yang ditulis langsung; registrasi HP memakai isian pendaftar. | `backend/src/services/workforce.js` (`ensureOrg`, `recordInitialHire`), `admin-dashboard/app.js` baris 11, `authController.daftar` | Master tercemar salah ketik; karyawan lepas dari aturan yang mencocokkan teks | T2: semua form memakai ID master; `ensureOrg` diganti lookup ketat; daftar di `app.js` dihapus |
| K2 🔴 | **Modul lain mencocokkan jabatan sebagai teks**: Cuti (`TRIM(u.jabatan) = …`), Roster (`roster_jabatan_policies.jabatan_key`), HSE (join `workforce_positions.name`), Produksi (`LIKE '%operator%'`, `'%pengawas%'`, `= 'driver dt'`), Payroll (kolom `jabatan` sendiri). | `services/cuti.js`, `migrations/029`, `services/hse.js`, `production.controller.js` ±2061–2090, `payrollController.js` | Mengganti nama jabatan bisa memutus aturan; master di repo punya jabatan **"Admin" di dua departemen** (Engineering & Logistik), sehingga pencocokan nama saja ambigu | `users.jabatan/departemen` dipertahankan sebagai **salinan** yang hanya ditulis mesin pergerakan. Ganti nama jabatan ikut memperbarui salinan dan `jabatan_key` roster. Konsumen dipindah ke `position_id` bertahap (T13, *expand–contract*) |
| K3 🔴 | **Pencocokan jabatan berdasarkan nama saja di HSE**: (a) Jam Kerja (092, **belum deploy**): departemen hanya dicek bila aturan diberi departemen. (b) Fungsi `hse_effective_quota` (084, **sudah di produksi**): jabatan dan departemen di-join terpisah lewat nama, sehingga jabatan bernama sama di dua departemen menghasilkan dua baris. | `services/hseWorkhours.js` `ruleLateral()`, `migrations/084` fungsi `hse_effective_quota` | Aturan "Admin (Engineering)" ikut berlaku untuk "Admin (Logistik)" → jam kerja/LTIFR dan kuota inspeksi salah | **T0**: perbaiki 092 (cocokkan departemen milik jabatan aturan) + test, wajib sebelum deploy 092. Fungsi 084 diperbaiki di T13a; sementara itu pre-flight P6 menunjukkan apakah nama ganda sudah ada di produksi |
| K4 🔴 | **Endpoint `/api/storage/view` publik tanpa login**: siapa pun yang tahu key bisa membuka file. Layanan storage juga hanya untuk JPEG (content-type & prefix `absensi/` ditulis langsung). | `routes/storage.routes.js`, `services/storage.js` | CV/sertifikat/KTP **tidak boleh** lewat jalur ini | T7: endpoint dokumen terpisah dengan login + izin + audit; validasi PDF (magic bytes `%PDF`), maks 5 MB, prefix `people/` |
| K5 🔴 | **Hapus permanen** masih ada dan menghapus payroll berdasarkan **kecocokan nama**. Jalur ini praktis tak tercapai (semua karyawan punya profil = "punya riwayat"), tapi kodenya tetap berbahaya. Beberapa tabel HSE memakai `ON DELETE CASCADE` ke `users`. | `karyawanController.hapusKaryawan`, `migrations/075` | Bisa menghapus data orang lain bernama sama / riwayat HSE | T12: ganti dengan **Void** (soft, beralasan, hanya bila belum ada transaksi); endpoint DELETE ditutup |
| K6 🟠 | **Lokasi absen saat ini tidak membatasi**: absen dicek ke **semua** `lokasi_kantor`; `users.lokasi_kantor_id` hanya untuk peta mini. | `absensiController` (`getSemuaLokasiKantor` + `dalamRadiusMultiPoint`) | Fitur "multi lokasi per karyawan" **mengubah perilaku** jadi lebih ketat | T6 + keputusan **D1**: backfill semua karyawan dengan semua lokasi (perilaku sama), lalu admin mempersempit |
| K7 🟠 | **NRP ganda**: `users.employee_id` (unik, nullable) dan `workforce_employee_profiles.employee_number`; `ensureProfile()` menimpa nomor profil dari users. Registrasi HP tidak mengisi NRP. Payroll mencocokkan lewat NRP **atau nama**. | `services/workforce.js`, `services/employeeIdentity.js`, `payrollController.js` | NRP kosong → payroll jatuh ke pencocokan nama | T4: NRP wajib untuk karyawan baru (pola dari Setup); backfill NRP kosong (D5); satu penulis, `users.employee_id` jadi salinan |
| K8 🟠 | **Data pribadi**: `users.nik_ktp` (unik) ada tapi tak dipakai form admin. Arsitektur Option C menetapkan `users` = identitas login, **bukan** wadah data HR. | `sql/schema.sql`, Option C milestone | Menaruh NIK/alamat/keluarga di `users` melanggar arah arsitektur | Tabel baru `workforce_employee_personal` (1:1 profil) + keluarga ke profil; nilai `users.nik_ktp` yang ada disalin, kolom lama dibiarkan (contract nanti) |
| K9 🟠 | **Kompetensi tumpang tindih dengan HSE**: sudah ada `hse_employee_licenses` (SIMPER dll., `file_url`, `expiry_date`) dan `hse_training_records` (`valid_until`). | `migrations/075` | Dua tempat menyimpan sertifikat yang sama | Keputusan **D4**: dokumen PDF disimpan sekali (`employee_documents`); lisensi/training HSE merujuk `document_id`. Tab Kompetensi membaca keduanya |
| K10 🟠 | **Pendaftaran mandiri dipakai aplikasi lama**: `POST /api/auth/daftar` dan `GET /api/auth/opsi-pendaftaran` dipakai mobile-web & APK. Ada baris `registrasi_pending` yang mungkin masih menunggu. Izin sub-admin punya kunci `registrasi`. | `routes/auth.routes.js`, `mobile-web/karyawan.js`, `app.js` ±3998 | APK lama akan error kalau endpoint hilang begitu saja | T3: selesaikan antrian dulu; endpoint `daftar` → **410** dengan pesan jelas; form daftar disembunyikan; tabel lama jadi arsip baca-saja; kunci izin `registrasi` dibuang |
| K11 🟠 | **Cek wajah ganda saat approval tidak pernah jalan** (kunci storage dipakai sebagai URL) dan subject CompreFace tidak seragam (email vs user.id). | `adminController.prosesRegistrasi`, `karyawanController.uploadFotoReferensi` | Dua akun bisa berwajah sama | T4: cek kemiripan wajah memakai buffer foto yang diunggah admin; subject baru = `user.id`; subject lama tidak diubah |
| K12 🟠 | **Jenis pergerakan baru ditolak DB**: CHECK `movement_type` hanya 9 jenis. Status `NOTICE` ada di CHECK profil tapi tak pernah dipakai. Keluar menonaktifkan akun pada tanggal efektif. Jadwal `process-due` belum dipasang. | `migrations/064`, `services/workforce.js`, handover 2026-10-06 | Lulus probation / perpanjang kontrak tidak bisa dicatat; karyawan tak bisa absen pulang di hari terakhir | T9/T10: ganti CHECK (nama constraint dicek di pre-flight P10), kolom `last_working_day`, status NOTICE, nonaktif H+1 00:05 WIB, cron harian |
| K13 🟠 | **Izin hanya di frontend**: `users.permissions` cuma memfilter tab; backend memakai `requireAdmin` untuk semuanya. Tipe kolom berbeda antara `schema.sql` (JSONB) dan komentar kode (text[]). | `middleware/auth.js`, `adminController` | Pemisahan pembuat/penyetuju tidak bisa ditegakkan | T11: cek izin `people.approve` di backend; tipe kolom dipastikan via pre-flight P1 |
| K14 🟡 | Kolom `probation_end_date`, `contract_end_date` ada tapi tidak pernah diisi; status PROBATION tidak pernah berakhir. | `migrations/064`, `recordInitialHire` | Pengingat tidak punya data | T4 mengisi saat tambah; T9 jenis "Lulus probation"; backfill manual lewat pre-flight P8 |
| K15 🟡 | Kartu KPI Database Karyawan memakai nama departemen yang ditulis langsung. | `app.js renderTabelKaryawan` | Departemen baru tidak terhitung | T5: KPI dihitung dari data, bukan nama tetap |
| K16 🟡 | Migrasi terakhir di repo **092 (HSE Jam Kerja) belum di-deploy**. | handover 2026-10-12 | Urutan migrasi bisa kacau | Deploy 092 (setelah T0) **sebelum** 093+; semua migrasi People idempoten + punya `_down.sql` |
| K17 🟡 | Arah arsitektur Option C: perubahan lintas modul lewat **event**, People tidak boleh diam-diam mengubah tabel modul lain. | Option C milestone | Efek keluar (roster, cuti, wajah) bisa jadi saling tergantung | Tabel `people_outbox` + pemroses idempoten; tiap modul memproses event-nya sendiri |

**Yang tidak bentrok** (aman dipakai ulang): status pergerakan, idempotency key, revisi, guard satu pergerakan aktif, `reason_text` (alasan manual), `site_name` di assignment (site manual), `workforce_departments` dengan unik nama per scope (untuk + Departemen), pola lampiran di `workforce_movement_attachments`, dan cek `is_active` di setiap request (akses langsung tercabut saat nonaktif).

### 4.1 Pre-flight wajib sebelum coding

Jalankan `docs/drafts/karyawan_preflight_readonly.sql` di `omos_staging` (hanya SELECT, transaksi READ ONLY). Hasilnya menentukan ukuran pekerjaan T1:

| Kode | Mengukur |
|---|---|
| P1 | Tipe kolom `users.permissions` |
| P2 | Karyawan tanpa NRP, NIK di users, tanpa wajah, jenis subject wajah |
| P3–P4 | NRP beda users vs profil; karyawan tanpa profil/assignment/position_id |
| P5–P7 | Jabatan/departemen yang tidak cocok master, nama jabatan ganda lintas departemen, variasi penulisan |
| P8–P10 | Kontrak/probation kosong; pergerakan jatuh tempo; nama constraint CHECK |
| P11–P12 | Registrasi tertunda; sebaran lokasi absen |
| P13 | Tabel yang ikut terhapus bila user dihapus (CASCADE) |
| P14 | Nama karyawan ganda (risiko payroll) |
| P15 | Status migrasi 092 dan tabel HSE kompetensi |

Skrip sudah diuji di PGlite (16 query lolos; contoh deteksi: "Admin" ganda di Engineering & Logistik, variasi "Admin" / "admin ").

## 5. Keputusan yang masih perlu owner (memblokir tiket tertentu)

| Kode | Pertanyaan | Rekomendasi | Memblokir |
|---|---|---|---|
| D1 | Lokasi absen yang dicentang **membatasi** tempat absen, atau hanya informasi? | Membatasi, tapi semua karyawan diisi awal dengan **semua lokasi** sehingga tidak ada yang tiba-tiba gagal absen | T6 |
| D2 | Kontrak/probation, dokumen & kompetensi masuk milestone Option C2 ("future"). Setuju ditarik ke sekarang (Option B+)? | Ya, terbatas: tanpa workflow designer, tanpa self-service | T7, T9, T10 |
| D3 | Dokumen PDF disimpan tanpa pemindaian malware (prasyarat Option C)? | Boleh untuk tahap ini dengan mitigasi: PDF saja, cek magic bytes, 5 MB, hanya admin, disajikan dengan `Content-Disposition` + CSP sandbox; pemindaian ditambah nanti | T7 |
| D4 | Sertifikat kompetensi: satu sumber dengan HSE? | Ya: file di `employee_documents`, lisensi/training HSE merujuk ke dokumen | T7 |
| D5 | NRP kosong untuk karyawan lama: dibuat otomatis dari pola, atau diisi manual HR? | Daftar dari pre-flight P2 → HR isi manual; sisa dibuat otomatis | T4 |
| D6 | Karyawan yang di-Void: email boleh dipakai ulang? | Ya: email lama diberi akhiran `+void-<tanggal>` agar akun baru bisa memakai email aslinya | T12 |
| D7 | Siapa saja **HR Approver** (boleh menyetujui pergerakan)? | Daftar nama/admin dari owner | T11 |

## 6. User stories

1. Sebagai admin HR, saya ingin menambah karyawan hanya dari dashboard, supaya tidak ada akun liar dari pendaftaran HP.
2. Sebagai admin HR, saya ingin NRP dibuat otomatis dari pola yang bisa saya ubah, supaya nomor konsisten dan tidak dobel.
3. Sebagai admin HR, saya ingin memilih departemen dan jabatan dari daftar, supaya tidak ada salah ketik yang memutus aturan cuti/roster/HSE.
4. Sebagai admin HR, saya ingin menambah departemen baru dari Setup master, supaya struktur organisasi bisa berkembang tanpa coding.
5. Sebagai admin HR, saya ingin menambah jabatan di bawah departemen tertentu, supaya jabatan bernama sama di departemen berbeda tetap terpisah.
6. Sebagai admin HR, saya ingin sistem menolak departemen/jabatan yang namanya sudah ada (tanpa beda huruf besar/kecil).
7. Sebagai admin HR, saya ingin mengisi data pribadi (NIK, tanggal lahir, HP, alamat, golongan darah, kontak darurat) di satu tempat.
8. Sebagai admin HR, saya ingin NIK dicek unik saat disimpan, supaya satu orang tidak punya dua data.
9. Sebagai admin HR, saya ingin mengisi data keluarga belakangan tanpa menghalangi penyimpanan karyawan.
10. Sebagai staf payroll, saya ingin melihat jumlah tanggungan dan perkiraan PTKP yang dihitung dari anggota keluarga.
11. Sebagai admin HR, saya ingin menentukan lebih dari satu lokasi absen per karyawan, supaya karyawan yang berpindah pos tetap bisa absen.
12. Sebagai karyawan, saya ingin absen di salah satu lokasi yang ditetapkan untuk saya, dan mendapat pesan jelas bila di luar lokasi.
13. Sebagai admin HR, saya ingin mengunggah CV (PDF) dan melihatnya langsung dari Direktori.
14. Sebagai admin HR, saya ingin mengunggah beberapa sertifikat kompetensi (PDF) beserta masa berlakunya.
15. Sebagai petugas HSE, saya ingin sertifikat yang diunggah HR langsung terbaca di data kompetensi HSE.
16. Sebagai admin HR, saya ingin file selain PDF atau di atas 5 MB ditolak dengan pesan yang jelas.
17. Sebagai pemilik data, saya ingin dokumen pribadi hanya bisa dibuka oleh admin yang login, dan setiap pembukaan tercatat.
18. Sebagai admin HR, saya ingin melihat Direktori dengan status (Aktif, Probation, Notice, Keluar), masa kerja, tanggal kontrak, wajah, CV/kompetensi, dan kelengkapan data.
19. Sebagai admin HR, saya ingin menyaring Direktori per departemen dan jabatan (bisa pilih lebih dari satu).
20. Sebagai admin HR, saya ingin membuka profil karyawan dan melihat riwayat penempatan beserta alasan tiap perubahan.
21. Sebagai admin HR, saya ingin mencatat mutasi/promosi/demosi dengan departemen & jabatan dari master dan site yang saya ketik sendiri.
22. Sebagai admin HR, saya ingin wajib menulis alasan untuk setiap pergerakan.
23. Sebagai admin HR, saya ingin mencatat "Lulus probation", "Perpanjangan kontrak", dan "Ubah status kerja".
24. Sebagai admin HR, saya ingin mencatat resign dengan hari kerja terakhir, supaya karyawan tetap bisa absen sampai hari itu.
25. Sebagai karyawan yang resign, saya ingin akun saya tetap aktif sampai hari kerja terakhir.
26. Sebagai HR Approver, saya ingin menyetujui pergerakan yang dibuat orang lain, dan sistem mencegah saya menyetujui pengajuan saya sendiri.
27. Sebagai admin HR, saya ingin pergerakan yang disetujui diterapkan otomatis pada tanggal efektif tanpa saya klik.
28. Sebagai admin HR, saya ingin pengingat kontrak habis (H-60), probation berakhir (H-30), dokumen kedaluwarsa, dan keluar terjadwal.
29. Sebagai admin HR, saya ingin membatalkan karyawan yang salah input (Void) tanpa menghapus jejaknya.
30. Sebagai admin HR, saya ingin semua perubahan data pribadi tercatat (nilai lama, baru, pengubah, alasan).
31. Sebagai pengguna modul Cuti/Roster/HSE, saya ingin aturan tetap berlaku walau nama jabatan diganti.
32. Sebagai pengguna APK lama, saya ingin pesan jelas "pendaftaran hanya lewat admin" bila mencoba mendaftar.
33. Sebagai admin, saya ingin Manpower Request terisi otomatis saat menambah karyawan yang ditautkan ke MR.

## 7. Implementation decisions

### 7.1 Model data (skema)

| Migrasi | Isi | Catatan konflik |
|---|---|---|
| **093 people_personal_nrp** | `workforce_employee_personal` (1:1 profil: NIK unik per tenant, tgl lahir, HP, alamat, gol. darah, kontak darurat); `people_settings` (pola NRP, nomor urut per tenant); kolom `position_id` wajib untuk assignment **baru** (CHECK `NOT VALID` agar data lama tidak gagal) | Salin `users.nik_ktp` yang terisi; kolom lama tidak dihapus |
| **094 people_attendance_locations** | `employee_attendance_locations (employee_profile_id, lokasi_kantor_id, is_primary)` unik per pasangan; backfill sesuai D1 | `users.lokasi_kantor_id` tetap = lokasi utama (peta mini) |
| **095 people_documents** | `employee_documents` (jenis: CV / KOMPETENSI / KTP / KONTRAK / MCU / LAINNYA, judul, nomor, terbit, berlaku s/d, storage_key, mime, size, sha256, uploaded_by, soft delete); `employee_document_access_log`; `hse_employee_licenses.document_id` dan `hse_training_records.document_id` (nullable) | Pola sama dengan `workforce_movement_attachments` |
| **096 people_family** | Dari `docs/drafts/employee_family_schema_DRAFT.sql` (sudah diuji PGlite) | Merujuk profil, bukan `users` |
| **097 people_movement_v2** | CHECK `movement_type` + `CONFIRMATION`, `CONTRACT_RENEWAL`, `EMPLOYMENT_TYPE_CHANGE`; kolom `last_working_day`, `contract_no`; profil: `voided_at`, `void_reason`; `people_outbox` (event idempoten) | Nama constraint lama dari pre-flight P10 |

Aturan umum: semua migrasi idempoten (`IF NOT EXISTS`), punya `_down.sql` dan runner verifikasi (pola 092), diuji naik-turun-naik di PGlite sebelum di staging, dengan backup `pg_dump` sebelum dijalankan.

### 7.2 Aturan domain

- **Satu penulis**: penempatan (departemen, jabatan, site, atasan) hanya berubah lewat mesin pergerakan. `users.jabatan/departemen/employee_id` = salinan yang diperbarui oleh mesin itu dan oleh *rename* master.
- **Jabatan selalu berpasangan dengan departemen** (ID), tidak pernah nama saja.
- **Keluar**: setelah disetujui, status profil jadi NOTICE; akun nonaktif **H+1 pukul 00:05 WIB** setelah `last_working_day`; assignment ditutup pada `last_working_day`.
- **Tanggungan** dihitung dari anggota keluarga (`is_dependent`), tidak disimpan sebagai angka. PTKP = status nikah + anak/orang tua/mertua yang ditanggung, maks. 3, dan **hanya perkiraan**.
- **Void** hanya boleh bila belum ada absensi, produksi, payroll, cuti, atau HSE; selain itu wajib lewat pergerakan Keluar.
- **Efek ke modul lain** ditulis sebagai event di `people_outbox` (mis. `EMPLOYEE_EXITED`, `ASSIGNMENT_CHANGED`), lalu diproses idempoten oleh pemroses modul tujuan.

### 7.3 Kontrak API (ringkas)

| Metode | Endpoint | Catatan |
|---|---|---|
| GET/POST/PATCH | `/api/admin/karyawan/org/departments`, `/org/positions` | + Departemen / + Jabatan; nama unik per scope; nonaktif, bukan hapus |
| GET | `/api/admin/karyawan/directory` | Read model Direktori (status, masa kerja, kontrak, dokumen, kelengkapan) + filter multi |
| GET | `/api/admin/karyawan/:id/profile` | Ringkasan + pribadi + kepegawaian + riwayat |
| POST | `/api/admin/karyawan` (v2) | Wizard; `position_id` wajib; NRP dari pola; idempotency key |
| PATCH | `/api/admin/karyawan/:id/personal` | Wajib alasan untuk NIK/email; audit per kolom |
| PUT | `/api/admin/karyawan/:id/attendance-locations` | Minimal satu lokasi |
| GET/PUT | `/api/admin/karyawan/:id/family` | Opsional; ringkasan tanggungan dari view |
| POST/GET | `/api/admin/karyawan/:id/documents`, `/documents/:docId/file` | Upload PDF (multer khusus PDF); file disajikan lewat login + audit, **bukan** `/api/storage/view` |
| POST | `/api/admin/karyawan/:id/void` | Alasan wajib; tolak bila ada transaksi |
| POST | `/workforce/movements` (v2) | `reason` wajib; `site` teks; jenis baru; `last_working_day` untuk keluar |
| POST | `/workforce/movements/:id/transition` | APPROVE ditolak bila approver = pembuat atau tanpa izin `people.approve` |
| POST | `/api/auth/daftar` | **410 Gone**: "Pendaftaran hanya melalui admin" |

### 7.4 Frontend

- Mengikuti contoh tampilan (sumber kebenaran UI). Modul baru `admin-dashboard/people.js` + `people.css`, dengan pola state/render sama seperti `hse.js`; `workforce.js` (MPP) tetap.
- Setiap aksi simpan memakai `window.OMOSActionFeedback.run` (aturan wajib admin-dashboard).
- Cache-bust `index.html` dinaikkan. Tab Registrasi dan kunci izinnya dihapus, `DEPARTEMEN_JABATAN_MAP` dibuang.
- Mobile-web: tampilan "Daftar" disembunyikan, diganti info "Hubungi admin".

## 8. Testing decisions

- **Seam utama = layanan People** (fungsi service dengan `db.query`), sama seperti test `workforce*.test.js` dan `hse-workhours.test.js`. Test hanya melihat perilaku luar (input → baris DB/hasil), bukan detail implementasi.
- **SQL nyata di PGlite** (+btree_gist) untuk setiap migrasi: naik → turun → naik, CHECK menolak data salah, view menghitung benar (prior art: uji 092 dan draft keluarga).
- **Kasus wajib**:
  - Jabatan "Admin" di dua departemen tidak saling tertukar (T0, T13).
  - Rename jabatan tetap mempertahankan aturan Cuti/Roster/HSE.
  - Resign: absen masih boleh di `last_working_day`, ditolak H+1.
  - Maker ≠ checker.
  - PDF palsu (bukan `%PDF`) ditolak; file > 5 MB ditolak; file tidak bisa dibuka tanpa token.
  - `/api/auth/daftar` mengembalikan 410.
  - Void ditolak bila sudah ada absensi.
  - Lokasi absen: di luar semua lokasi yang dicentang ditolak, di salah satunya diterima.
- **UI**: test `admin-dashboard/*.test.js` untuk render & re-entry tombol simpan; Playwright screenshot desktop/HP/gelap seperti sample page.
- **Regresi**: seluruh `backend/test` dijalankan (bukan hanya People), karena K2 menyentuh Cuti, Roster, HSE, dan Produksi.

## 9. Tiket (tracer-bullet, urut blocker)

> Format to-tickets. Status semua: *menunggu persetujuan susunan*. Tiket 13a–13e memakai pola *expand–contract* karena dampaknya melebar ke banyak modul.

| No | Tiket | Diblokir oleh | Yang dihasilkan (bisa didemokan) |
|---|---|---|---|
| **T0** | Perbaiki pencocokan jabatan di Jam Kerja HSE | — | Aturan "Admin (Engineering)" tidak berlaku untuk "Admin (Logistik)"; test baru; 092 siap deploy |
| **T1** | Pre-flight & bersih data | — | Hasil P1–P15; daftar pemetaan jabatan liar → master disetujui owner; daftar NRP kosong |
| **T2** | Master Departemen & Jabatan | T1 | Setup master + Departemen/+ Jabatan berfungsi; semua form memakai ID; `ensureOrg` tidak lagi membuat master; `DEPARTEMEN_JABATAN_MAP` dihapus |
| **T3** | Tutup pendaftaran mandiri | T1 | Antrian tertunda diselesaikan; `daftar` → 410; form HP disembunyikan; tab Registrasi hilang |
| **T4** | Tambah karyawan v2 (migrasi 093) | T2 | Wizard 3 langkah; NRP dari pola; data pribadi; kontrak/probation terisi; cek wajah ganda bekerja; MR terisi |
| **T5** | Direktori & Profil | T4 | Direktori baru (filter multi, status, kelengkapan) + profil (Ringkasan, Data pribadi, Kepegawaian, Audit); KPI dari data |
| **T6** | Lokasi absen multi (094) | T4, D1 | Ceklis lokasi di wizard & profil; validasi absen per karyawan; backfill sesuai D1 |
| **T7** | Dokumen CV & kompetensi PDF (095) | T5, D2–D4 | Unggah/lihat PDF dari Direktori & Profil; endpoint aman + audit; HSE merujuk dokumen |
| **T8** | Data keluarga (096) | T5 | Kotak keluarga di wizard; tab Keluarga + edit; tanggungan & PTKP dari view |
| **T9** | Pergerakan v2 (097) | T2, D2 | Alasan wajib manual, site manual, jenis baru, hari kerja terakhir + NOTICE |
| **T10** | Penjadwal harian & Pengingat | T9, T7 | Cron 00:05 WIB (jatuh tempo, nonaktif H+1, pengingat); tab Pengingat; outbox diproses |
| **T11** | Pemisahan peran | T9, D7 | Izin `people.approve` di backend; maker ≠ checker; UI menyembunyikan Setujui untuk pembuat |
| **T12** | Void menggantikan hapus permanen | T5, D6 | Endpoint DELETE ditutup; Void beralasan; payroll tidak lagi dihapus berdasarkan nama |
| **T13a** | HSE membaca `position_id` | T2, T0 | Jam kerja & kuota inspeksi via assignment, bukan nama |
| **T13b** | Cuti membaca `position_id` | T2 | Resolusi kebijakan via ID; test lama tetap hijau |
| **T13c** | Roster membaca `position_id` | T2 | `roster_jabatan_policies` diberi `position_id`; rename aman |
| **T13d** | Produksi memakai "fungsi jabatan" | T2 | Flag operator/pengawas di master menggantikan `LIKE '%operator%'` |
| **T13e** | Payroll menaut via NRP saja | T4 | Pencocokan nama dihapus setelah NRP lengkap |
| **T14** | Dokumentasi, staging, produksi | semua | Handover diperbarui; migrasi 093–097 di staging lalu produksi dengan backup & rollback |

Urutan rilis yang disarankan: **R1** (T0 → deploy 092) → **R2** (T1–T5) → **R3** (T6–T9) → **R4** (T10–T12) → **R5** (T13a–e). Setiap rilis bisa dipakai sendiri dan bisa di-rollback.

## 10. Deploy & rollback

- Per rilis: `pg_dump` sebelum migrasi → migrasi di `omos_staging` → smoke test → `release-app.sh` (rollback container otomatis) → verifikasi `/health`, 401 tanpa token, alur utama.
- Rollback data: setiap migrasi punya `_down.sql`; tabel baru bisa dibuang tanpa menyentuh data lama, karena kolom lama tidak dihapus di rencana ini.
- APK lama: endpoint `daftar` mengembalikan 410 dengan pesan, bukan 404 atau 500.

## 11. Out of scope

Workflow designer multi-level, self-service karyawan, ATS/rekrutmen kandidat, pemindaian malware dokumen, integrasi HRIS/payroll eksternal, analitik lintas tenant, sinkron offline. Semuanya tetap di Option C. Penghapusan kolom lama (`users.jabatan`, `users.departemen`, `users.nik_ktp`, `users.lokasi_kantor_id`) juga tidak dilakukan; *contract* baru setelah semua konsumen pindah dan pre-flight ulang bersih.

## 12. Catatan lanjutan

- Tiket T13 adalah perubahan lebar: jangan digabung dalam satu PR; tiap modul satu tiket dengan test modulnya.
- Fungsi `hse_effective_quota` (migrasi 084) juga mencocokkan nama jabatan, jadi masuk cakupan T13a.
- Setelah susunan tiket disetujui, tiap tiket dipecah ke file terpisah (`.scratch/people-v2/issues/NN-*.md`) sesuai format to-tickets.
