# Panduan Pengguna OMOS

Panduan cara mengoperasikan OMOS (One Mining Operating System) untuk admin dan pengguna di site.
Setiap modul punya bab sendiri. Bab baru ditambahkan seiring modul selesai didokumentasikan.

| Bab | Modul | Status |
| --- | --- | --- |
| 1 | [Karyawan (OMOS People)](#1-karyawan-omos-people) | Tersedia — berlaku mulai rilis People v2 |
| 2 | Absensi | Menyusul |
| 3 | Roster & Cuti | Menyusul |
| 4 | [HSE — Asisten AI (trial)](#4-hse--asisten-ai-trial) | Tersedia sebagian — berlaku mulai rilis migrasi 099 |
| 5 | Produksi | Menyusul |

Terakhir diperbarui: 13 Oktober 2026.

---

## 1. Karyawan (OMOS People)

Halaman **Karyawan** adalah satu-satunya tempat mencatat karyawan, mulai dari masuk sampai keluar.
Semua perubahan tercatat dan bisa ditelusuri siapa yang mengubah, kapan, dan apa alasannya.

### 1.1 Prinsip utama

- **Karyawan baru hanya ditambahkan admin** dari dashboard, lewat **Tambah karyawan** atau **Import Excel**.
  Pendaftaran mandiri dari aplikasi HP sudah ditutup.
- **Departemen dan jabatan selalu dipilih dari master** (Setup master). Tidak bisa diketik bebas, supaya
  Cuti, Roster, HSE, dan MPP membaca data yang sama.
- **Jabatan dan departemen tidak diedit langsung.** Perubahannya selalu lewat **Pergerakan**
  (mutasi, promosi, dan sebagainya), sehingga riwayatnya tidak hilang.
- **Data tidak dihapus permanen.** Salah input diselesaikan dengan **Void**; karyawan berhenti dicatat dengan **Proses keluar**.

### 1.2 Bagian halaman

Bagian atas halaman berisi tombol:

| Tombol | Fungsi |
| --- | --- |
| **Ekspor** | Unduh daftar karyawan yang sedang tampil (sesuai filter) ke CSV. |
| **Import Excel** | Tambah banyak karyawan sekaligus dari template Excel (lihat 1.6). |
| **Ajukan pergerakan** | Catat mutasi, promosi, perpanjangan kontrak, keluar, dan lain-lain (lihat 1.7). |
| **Tambah karyawan** | Daftarkan satu karyawan baru (lihat 1.4). |

Di bawahnya ada lima tab:

| Tab | Isi |
| --- | --- |
| **Direktori** | Daftar karyawan, filter, dan profil. |
| **Pergerakan** | Pengajuan yang menunggu persetujuan, yang terjadwal, draft, dan riwayatnya. |
| **MPP** | Kebutuhan tenaga kerja per departemen/jabatan (modul MPP yang sudah ada). |
| **Pengingat** | Kontrak, probation, dan sertifikat yang akan berakhir, serta karyawan yang akan keluar. |
| **Setup master** | Departemen, jabatan, pola NRP, dan aturan probation. |

Angka kecil di tab **Pergerakan** menunjukkan jumlah pengajuan yang menunggu persetujuan. Angka di tab
**Pengingat** menunjukkan hal yang sudah mendesak (14 hari lagi atau sudah lewat).

### 1.3 Direktori

**Kartu ringkasan** di atas bisa diklik untuk langsung memfilter daftar:

- **Karyawan aktif** — semua yang masih bekerja, termasuk Probation dan Notice.
- **Probation** — karyawan yang masih dalam masa percobaan.
- **Notice** — sudah disetujui keluar, tetapi masih bekerja sampai hari kerja terakhir.
- **Kontrak/probation ≤ 30 hari** — perlu segera diputuskan.
- **Data belum lengkap** — tanpa foto wajah, tanpa CV, atau kelengkapan di bawah 80%.

**Mencari dan memfilter:**

- Kotak cari menerima nama, NRP, jabatan, departemen, atau email.
- **Departemen** dan **Jabatan** bisa dipilih lebih dari satu. Daftar jabatan dikelompokkan per departemen,
  sehingga "Admin" Engineering dan "Admin" Logistik terlihat terpisah.
- Tombol status: *Semua aktif, Aktif, Probation, Notice, Keluar (alumni), Semua.*

**Kolom tabel:**

| Kolom | Arti |
| --- | --- |
| Karyawan | Nama dan NRP. |
| Jabatan · Departemen | Penempatan saat ini dan site. |
| Status | Aktif, Probation, Notice, atau Keluar. |
| Masa kerja | Dihitung dari tanggal masuk. |
| Kontrak / tanggal penting | Akhir kontrak, akhir probation, atau hari kerja terakhir, dengan sisa hari. |
| Wajah | Sudah/belum punya foto wajah untuk absensi. |
| CV & kompetensi | Klik **CV** atau **Kompetensi** untuk membuka PDF. Tombol kuning berarti belum ada; klik untuk mengunggah. |
| Kelengkapan | Persentase dari 10 butir data (lihat 1.5). Arahkan kursor ke angka untuk melihat yang belum ada. |

**Klik baris** untuk membuka profil karyawan.

### 1.4 Tambah karyawan

Klik **Tambah karyawan**. Form terdiri dari tiga langkah. Kolom bertanda * wajib diisi; kolom lain boleh dilengkapi nanti dari profil.

**Langkah 1 — Identitas**

- Nama lengkap* dan Email login*. Email dipakai karyawan untuk masuk aplikasi dan harus unik.
- NIK KTP (16 digit, dicek unik), tempat & tanggal lahir, jenis kelamin, No. HP, golongan darah, alamat, kontak darurat.
- **Data keluarga** (opsional): status pernikahan dan anggota keluarga. Centang *Ditanggung* untuk anggota yang
  menjadi tanggungan. Jumlah tanggungan dan perkiraan PTKP dihitung otomatis.

**Langkah 2 — Kepegawaian**

- Departemen* dan Jabatan* — dipilih dari master. Jika jabatan belum ada, tambahkan dulu di **Setup master**.
- Tanggal masuk*.
- NRP — kosongkan agar dibuat otomatis dari pola NRP. Contoh NRP berikutnya tampil di kolom.
- Tipe kerja*: PKWT, PKWTT, atau Harian. **Kontrak berakhir** wajib untuk PKWT.
- **Probation berakhir** — terisi otomatis (lihat 1.8), boleh diubah.
- Atasan langsung, Site (isi manual, mis. "Pit 3"), dan Manpower Request (bila karyawan mengisi kebutuhan MPP).

**Langkah 3 — Absensi & dokumen**

- **Lokasi absen*** — pilih minimal satu. Boleh lebih dari satu; karyawan bisa absen di lokasi mana pun yang
  dicentang. Lokasi yang dicentang pertama menjadi lokasi utama.
- Shift (opsional; kosong = mengikuti roster).
- Foto wajah, CV, dan sertifikat kompetensi (PDF) — boleh diunggah sekarang atau nanti dari profil.
- **Akses aplikasi:**
  - *Kirim undangan ke email* (disarankan) — karyawan menerima kode lewat email, lalu membuat password sendiri.
    Kode berlaku 7 hari.
  - *Buat password awal* — admin menentukan password (minimal 8 karakter) dan menyampaikannya ke karyawan.

Klik **Simpan karyawan**. Setelah tersimpan:

- NRP dibuat dan akun aktif.
- Penempatan tercatat sebagai pergerakan **Masuk**.
- Checklist onboarding dibuat: MCU, safety induction, APD, ID card & akses site.

Bila foto wajah mirip dengan karyawan aktif lain, sistem menahan foto tersebut dan menampilkan namanya.
Ini untuk mencegah satu orang punya dua akun. Karyawan tetap tersimpan; foto bisa diunggah ulang dari profil
setelah dipastikan bukan orang yang sama.

**Cara karyawan mengaktifkan akun:** buka aplikasi → **AKTIFKAN AKUN** di halaman masuk → isi email login dan
kode undangan → buat password baru.

### 1.5 Profil karyawan

Klik baris karyawan di Direktori. Profil terbuka di panel kanan.

Tombol di atas profil menyesuaikan status karyawan:

| Tombol | Kapan muncul |
| --- | --- |
| Mutasi / promosi | Karyawan masih bekerja. |
| Lulus probation | Status Probation. |
| Perpanjang kontrak | Punya tanggal akhir kontrak. |
| Proses keluar | Karyawan masih bekerja dan belum Notice. |
| Proses rehire | Karyawan sudah keluar. |
| Foto wajah / Tambah sampel wajah | Selalu. Foto bisa ditambah beberapa kali untuk akurasi. |

**Sub-halaman profil:**

- **Ringkasan** — status, masa kerja, hubungan kerja, atasan, kelengkapan data, CV/kompetensi, dan data
  terkait (absensi bulan ini, lokasi absen, tanggungan, email login).
- **Data pribadi** — klik **Edit** untuk mengubah. Mengubah **NIK** atau **email** wajib disertai alasan.
  NIK ditampilkan tersamar; klik **Tampilkan** untuk melihat lengkap (tercatat di Audit).
- **Keluarga** — status pernikahan, anggota keluarga, jumlah tanggungan, dan perkiraan PTKP. Klik **Edit** untuk
  mengubah. Perkiraan PTKP hanya acuan; keputusan akhir tetap di Payroll.
- **Kepegawaian** — NRP, penempatan, site, lokasi absen (klik **Ubah**), tipe kerja, tanggal masuk, probation,
  dan riwayat pergerakan.
- **Dokumen** — CV, sertifikat kompetensi, dan dokumen kepegawaian (KTP, kontrak, MCU, lainnya).
- **Audit** — 50 perubahan terakhir: nilai lama, nilai baru, siapa yang mengubah, dan alasannya.

**Kelengkapan data** dihitung dari 10 butir (masing-masing 10%):
NRP, NIK, No. HP, tanggal lahir, alamat, golongan darah, kontak darurat, foto wajah, CV, data keluarga.

**Lokasi absen.** Di Kepegawaian → **Ubah**:

- *Lokasi tertentu* — karyawan hanya bisa absen di lokasi yang dicentang. Absen di luar radius lokasi tersebut
  ditolak, dan pesan di aplikasi menyebut lokasi yang diizinkan.
- *Semua lokasi* — karyawan boleh absen di semua lokasi resmi.

Karyawan lama yang belum pernah diatur lokasinya otomatis termasuk *Semua lokasi*.

**Dokumen PDF:**

- Hanya PDF, maksimal 5 MB. File lain ditolak.
- Klik dokumen untuk melihat langsung di OMOS; ada tombol **Buka tab baru** dan **Unduh**.
- Isi **Berlaku sampai** pada sertifikat yang punya masa berlaku, supaya muncul di tab Pengingat.
- Hanya ada satu CV aktif. Mengunggah CV baru menggantikan yang lama; CV lama tetap tercatat di audit.
- **Hapus** dokumen wajib disertai alasan. Dokumen dinonaktifkan, bukan dihapus permanen.
- Dokumen hanya bisa dibuka oleh admin yang sudah login, dan setiap akses tercatat.

**Void.** Di Kepegawaian → **Void**. Gunakan hanya untuk **salah input** (mis. email salah, data dobel)
pada karyawan yang **belum punya** absensi, keterangan presensi, HM, atau payroll. Akun dinonaktifkan dan
emailnya bisa dipakai lagi. Bila sudah ada transaksi, Void ditolak; gunakan **Proses keluar**.

### 1.6 Import Excel

Untuk menambah banyak karyawan sekaligus (maksimal 1.000 baris, 5 MB per file).

1. Klik **Import Excel** → **Template .xlsx**. Template selalu diunduh baru, karena daftar pilihannya diambil
   dari master saat itu.
2. Isi sheet **Karyawan**. Kolom wajib (bertanda *): Nama lengkap, Email login, **Departemen · Jabatan**,
   Tanggal masuk, Status kerja, **Lokasi absen 1**. Kolom lain boleh dikosongkan dan dilengkapi nanti.
   - Departemen · Jabatan dan Lokasi dipilih dari daftar (dropdown), jangan diketik bebas.
   - Lokasi absen 2 dan 3 diisi bila karyawan boleh absen di lebih dari satu lokasi.
   - NIK dan No. HP biarkan sebagai teks, jangan diubah menjadi angka (Excel memotong angka panjang).
   - Akhir kontrak wajib untuk PKWT. Probation dihitung otomatis (lihat 1.8).
3. Klik **Pilih file .xlsx**. OMOS menampilkan **simulasi** lebih dulu — belum ada data yang tersimpan.
4. Periksa hasil per baris: **Siap**, **Perlu dicek** (tersimpan tapi dengan catatan), atau **Error**
   (tidak disimpan).
5. Bila ada nilai yang tidak dikenal (mis. "Operator DT" atau "Pit 3"), OMOS menampilkan **saran terdekat**.
   Pilih padanannya → **Terapkan padanan**. Centang **Ingat padanan** agar nilai yang sama otomatis dikenali di
   import berikutnya. OMOS tidak pernah menebak sendiri dan tidak pernah membuat jabatan/lokasi baru dari Excel.
6. Pilih apakah undangan email dikirim, lalu klik **Simpan N karyawan**. Baris error dilewati; email, NIK, atau
   NRP yang sudah terdaftar tidak dibuat ulang.

Salah file? Buka **Import Excel** → **Riwayat import** → **Void batch**. Semua karyawan dari batch itu di-Void,
kecuali yang sudah punya transaksi (dipertahankan dan disebutkan).

### 1.7 Pergerakan

Semua perubahan status dan penempatan dicatat sebagai **pergerakan**.

**Jenis pergerakan:**

| Kelompok | Jenis | Isian khusus |
| --- | --- | --- |
| Status kerja | Lulus probation | Tanggal efektif; hasil *Lulus* atau *Diperpanjang* (dengan tanggal probation baru). |
| | Perpanjangan kontrak | Nomor kontrak, tanggal mulai dan berakhir. |
| | Ubah status kerja | Tipe kerja baru (PKWT wajib tanggal akhir kontrak). |
| Penempatan | Mutasi, Promosi, Demosi | Departemen & jabatan tujuan (dari master), site tujuan (isi manual). |
| Keluar | Resign, Terminasi, Kontrak habis, Pensiun | Hari kerja terakhir; boleh direhire atau tidak. |
| Masuk kembali | Rehire | Departemen, jabatan, site, tipe kerja. |

**Alasan wajib diisi manual** untuk semua jenis. Alasan tampil di riwayat dan dibaca penyetuju.
Mutasi/promosi yang tidak mengubah apa pun (jabatan, site, dan tipe kerja sama) ditolak.

**Alur:**

1. **Draft** — tersimpan, belum diajukan. Bisa diajukan atau dibatalkan.
2. **Menunggu persetujuan** — sudah diajukan ke penyetuju.
3. **Terjadwal** — disetujui; diterapkan otomatis setiap hari setelah tanggal efektif tiba.
4. **Efektif** — perubahan sudah berlaku. Jabatan, departemen, dan status karyawan ikut berubah.

Pengajuan juga bisa **Ditolak** (dengan alasan) atau **Dibatalkan**.

**Siapa yang boleh menyetujui:**

- Admin Utama, atau sub-admin dengan izin **Approver Pergerakan Karyawan**
  (diatur di pengaturan sub-admin).
- **Pembuat pengajuan tidak boleh menyetujui pengajuannya sendiri.** Pengecualian: Admin Utama boleh menyetujui
  pengajuannya sendiri dengan alasan tertulis, bila diizinkan di Setup master (untuk site dengan satu admin HR).

**Karyawan keluar:**

- Isi **hari kerja terakhir**. Karyawan masih bisa absen sampai tanggal itu.
- Setelah disetujui, status menjadi **Notice**.
- Sehari setelah hari kerja terakhir, akun otomatis nonaktif, status menjadi **Keluar**, dan roster setelah
  tanggal itu ditutup.
- Checklist offboarding dibuat: cabut akses, pengembalian aset/APD, final settlement, arsip foto wajah.
  Centang di **Lihat** → Checklist.
- CV, sertifikat, dan riwayat tetap tersimpan sebagai arsip alumni. Karyawan bisa direhire dengan NRP yang sama.

**Mulai tanggal efektif**, Roster, aturan Cuti, dan jam kerja HSE mengikuti penempatan baru. Data sebelum
tanggal itu tetap memakai penempatan lama.

### 1.8 Probation (masa percobaan)

**Dari mana tanggal probation berasal?**
Probation tidak perlu diinput dari nol. Sistem menghitungnya otomatis:

> **Probation berakhir = Tanggal masuk + Lama probation default**

- *Lama probation default* diatur di **Setup master → Pola NRP & probation → Lama probation default (bulan)**.
  Bawaannya 3 bulan.
- Di **Tambah karyawan** (langkah 2), kolom **Probation berakhir** sudah terisi otomatis dan boleh diubah manual.
- **Import Excel** tidak punya kolom probation; setiap baris memakai rumus yang sama.

**Status setelah karyawan disimpan:**

- Tanggal akhir probation masih di masa depan → status **Probation**.
- Tanggal akhir probation sudah lewat (mis. mendaftarkan karyawan lama yang masuk 2022) → langsung **Aktif**.

**Saat probation berakhir:**

- Status **tidak berubah sendiri**. Karyawan muncul di tab **Pengingat** mulai 30 hari sebelum tanggal berakhir.
- HR mencatat pergerakan **Lulus probation**:
  - *Lulus* → status menjadi **Aktif**.
  - *Diperpanjang* → isi tanggal probation berakhir yang baru.
  - Tidak lulus → catat sebagai pergerakan **Terminasi** dengan alasan hasil evaluasi.

> **Catatan aturan ketenagakerjaan (perlu dikonfirmasi HR/legal PT PIM):**
> Menurut UU 13/2003 — yang tetap berlaku setelah UU Cipta Kerja:
>
> - **Pasal 58:** PKWT (kontrak) **tidak boleh** mensyaratkan masa percobaan. Bila tetap disyaratkan, syarat itu
>   batal demi hukum dan masa kerjanya tetap dihitung. Pekerja harian termasuk PKWT.
> - **Pasal 60:** masa percobaan hanya untuk **PKWTT**, paling lama **3 bulan**.
>
> Saat ini OMOS masih memberi probation otomatis ke semua tipe kerja dan mengizinkan setelan sampai 12 bulan.
> Perbaikan yang diusulkan: probation otomatis hanya untuk PKWTT; PKWT dan Harian langsung Aktif; batas
> maksimal 3 bulan; karyawan PKWT yang terlanjur berstatus Probation ditandai untuk dikoreksi.
> Sampai perbaikan itu diterapkan: setelah mendaftarkan karyawan PKWT/Harian, catat pergerakan
> **Lulus probation** dengan hasil *Lulus* dan tanggal efektif = tanggal masuk, agar statusnya menjadi Aktif.
> Konsultasikan kebijakan ini dengan HR/legal.

### 1.9 Pengingat

Tab **Pengingat** mengumpulkan hal yang perlu ditindaklanjuti:

| Kartu | Isi | Tindakan langsung |
| --- | --- | --- |
| Kontrak berakhir | 60 hari ke depan atau sudah lewat, belum ada pengajuan | **Perpanjang** atau **Akhiri kontrak** |
| Probation berakhir | 30 hari ke depan atau sudah lewat, belum ada keputusan | **Catat hasil probation** |
| Dokumen & sertifikat kedaluwarsa | Berlaku ≤ 60 hari lagi atau sudah lewat | **Unggah yang baru** |
| Keluar terjadwal | Karyawan berstatus Notice | Lihat checklist offboarding yang belum selesai |

Setelah pengajuan dibuat (mis. perpanjangan kontrak diajukan), karyawan tersebut hilang dari pengingat.
Sertifikat juga hilang dari pengingat setelah diunggah versi baru dengan **nama dokumen yang sama** dan masa berlaku lebih lama.

### 1.10 Setup master

**Departemen & jabatan**

- **+ Departemen** — nama (tidak boleh sama dengan yang sudah ada, tanpa membedakan huruf besar/kecil) dan jabatan
  awal (pisahkan dengan koma).
- **+ Jabatan** di setiap departemen. Nama jabatan boleh sama di departemen berbeda (mis. "Admin").
- Klik nama jabatan untuk mengubah nama, fungsi (Operator, Pengawas, Mekanik, Driver, Staf), tanda **jabatan
  kritis** (ditandai di MPP bila kosong), atau menonaktifkan.
- Mengganti nama ikut memperbarui karyawan pemegang jabatan tersebut.
- Jabatan atau departemen yang masih dipegang karyawan aktif **tidak bisa dinonaktifkan**. Pindahkan karyawannya
  dulu lewat Pergerakan.

**Pola NRP & probation** (hanya Admin Utama)

- Pola NRP memakai token: `{YYYY}` atau `{YY}` tahun masuk, `{MM}` bulan masuk, `{SEQ3}`–`{SEQ6}` nomor urut.
  Contoh `PIM-{YY}{MM}-{SEQ4}` → `PIM-2610-0007`. NRP tidak dipakai ulang walau karyawan keluar.
- Lama probation default (lihat 1.8).
- **Wajibkan checklist selesai sebelum Efektif** — bila aktif, pergerakan tidak bisa diterapkan sebelum checklist
  wajib selesai.
- **Admin Utama boleh menyetujui pengajuannya sendiri** — dengan alasan tertulis.

### 1.11 Pertanyaan umum

**Karyawan tidak bisa absen di lokasi baru.**
Cek profil → Kepegawaian → Lokasi absen. Tambahkan lokasinya, atau pilih *Semua lokasi*.

**Jabatan yang dibutuhkan tidak ada di pilihan.**
Tambahkan di Setup master → departemen terkait → **+ Jabatan**, lalu ulangi.

**Ingin mengubah jabatan karyawan.**
Gunakan **Mutasi / promosi** di profil. Jabatan tidak bisa diedit langsung.

**Salah mendaftarkan karyawan.**
Bila belum ada absensi/payroll: profil → Kepegawaian → **Void**. Bila sudah ada: **Proses keluar**.

**Karyawan belum menerima email undangan.**
Karyawan bisa membuka aplikasi → **Lupa Password** → masukkan email untuk meminta kode baru.

**Ada pengajuan di Registrasi Pending dari sistem lama.**
Pengajuan lama tidak bisa disetujui lagi. Daftarkan ulang lewat **Tambah karyawan** atau **Import Excel**.

**Tombol Setujui tidak aktif.**
Pengajuan itu Anda buat sendiri, atau akun Anda belum punya izin **Approver Pergerakan Karyawan**.
Minta admin lain menyetujui, atau minta Admin Utama memberi izin.

---

## 4. HSE — Asisten AI (trial)

Bab ini baru membahas **Asisten AI** di modul HSE. Bagian HSE lainnya menyusul.

Asisten AI membantu dua pekerjaan: **mendeteksi laporan hazard ganda** dan **memberi saran triase** saat laporan dibuat.
AI **hanya menyarankan**. Menggabungkan laporan, menetapkan risiko, dan membuat CAPA tetap diputuskan HSE officer.
Semua hasil AI diberi label **"Saran AI — perlu dicek"**.

### 4.1 Prinsip

- **Skor dan level risiko selalu dihitung OMOS** dari matriks 5×5. AI hanya menyarankan nilai Kemungkinan dan Akibat beserta alasannya.
- **Uraian asli pelapor tidak pernah diubah.** "Uraian rapi" dari AI disimpan terpisah.
- **Data pribadi tidak dikirim ke AI.** Nama, nomor HP, email, dan NIK disensor otomatis sebelum dikirim.
- **Bila AI mati atau gagal**, OMOS kembali memakai cek kata kunci lama. Pelaporan tidak terganggu.

### 4.2 Laporan hazard ganda

Setiap laporan baru atau yang diubah dicek di belakang layar terhadap laporan terbuka di **Area yang sama** dalam 30 hari terakhir.
Hasilnya muncul di daftar dan detail hazard:

| Tanda | Arti | Yang perlu dilakukan |
| --- | --- | --- |
| 🤖 **Kemungkinan laporan sama · dicek AI** | AI menilai objek bahaya **dan** titiknya sama | Baca **Alasan AI** dan bukti yang disorot, lalu **Gabungkan** atau **Bukan duplikat** |
| ↺ **Pola berulang** | Jenis bahaya sama tetapi di titik/objek berbeda (mis. KM 2 dan KM 4) | Jangan digabung. Pertimbangkan tindakan sistemik bila sering muncul |
| 🔤 **Cek kata kunci** | Laporan belum dicek AI; ini hasil mesin kata kunci lama | Periksa manual seperti biasa |

**Menggabungkan laporan**

1. Klik **Gabungkan** pada saran.
2. Isi **alasan penggabungan** (wajib), mis. "objek & titik sama: kabel panel genset workshop".
3. Laporan yang digabung menjadi DUPLIKAT. Pelapornya tetap tercatat dan CAPA-nya dipindah ke laporan utama.

Laporan utama harus masih terbuka. Laporan yang sudah ditutup atau sudah digabung tidak bisa dipakai.
Butuh izin **HSE: Gabung / Tolak Laporan Hazard Ganda** (atau Admin Utama).

**Bukan duplikat**

Klik **Bukan duplikat** lalu isi alasan singkat. Pasangan itu tidak akan disarankan lagi.
Alasan dipakai untuk mengukur akurasi AI, jadi isi dengan jelas (mis. "unit berbeda: DT-12 vs DT-21").

### 4.3 Saran AI saat melapor (✨ Saran AI)

Tombol **✨ Saran AI** ada di form lapor hazard, form edit, dan detail hazard.

1. Isi **uraian bahaya** dan **konsekuensi** dulu (minimal 10 karakter).
2. Klik **✨ Saran AI** dan tunggu ± 5–15 detik.
3. Tinjau setiap saran, lalu klik **Terapkan** hanya pada yang sesuai:
   - **Kategori**: Kondisi Tidak Aman atau Tindakan Tidak Aman.
   - **Risiko**: Kemungkinan × Akibat beserta alasannya. Skor dan level di form ikut berubah.
   - **Tindakan segera**: **Pakai sebagai CAPA** mengisi tindakan korektif awal.
   - **Perlu dilengkapi**: pertanyaan bila uraian kurang jelas. Lengkapi uraian bila perlu.
   - **Uraian rapi**: versi uraian yang lebih baku, disimpan terpisah dari uraian asli.
4. Simpan form seperti biasa. Bila tidak ada yang cocok, klik **Abaikan saran**.

Di detail hazard, **Terapkan** langsung menyimpan perubahan ke laporan itu.

### 4.4 Setup master → Asisten AI (Admin Utama)

| Pengaturan | Fungsi |
| --- | --- |
| **Aktifkan Asisten AI untuk site ini** | Sakelar utama. Bila mati, semua fitur AI mati. |
| **Deteksi laporan hazard ganda** | **Mati** · **Uji diam-diam** (AI menilai di belakang, tampilan tetap cek kata kunci) · **Aktif** |
| **Saran AI triase** | **Mati** · **Uji** (hanya Admin Utama yang melihat tombol) · **Aktif** |
| **Ambang keyakinan** | Di bawah ambang (default 0,75), saran tampil sebagai Pola berulang, bukan saran gabung. |
| **Jendela pencarian** | Rentang hari laporan yang dibandingkan (default 30). |
| **Batas biaya & panggilan** | Bila tercapai, AI berhenti sementara dan cek kata kunci dipakai. |
| **Periksa ulang semua laporan terbuka** | Antrekan ulang pemeriksaan AI untuk seluruh laporan terbuka. |

Bagian **Pemakaian bulan ini** menampilkan jumlah panggilan, token, perkiraan biaya, dan kecepatan.
Bagian **Perbandingan AI vs cek kata kunci** dipakai selama uji diam-diam untuk memutuskan apakah AI boleh diaktifkan.

API key tidak pernah diisi atau ditampilkan di dashboard. Key dipasang tim IT langsung di server.

### 4.6 Tanya OMOS (tanya-jawab data HSE)

Tombol **✨ Tanya OMOS** (pojok kanan bawah halaman HSE) menjawab pertanyaan tentang **data yang ada di halaman HSE**, misalnya
"Berapa hazard risiko tinggi yang masih terbuka bulan ini?" atau "Izin kerja apa yang sedang aktif?".

- **Hanya membaca.** Tanya OMOS tidak membuat, mengubah, atau menghapus data, dan tidak menjawab hal di luar data HSE.
- **Siapa yang bisa memakai:** admin HSE. Saat masa uji (mode Uji), hanya Admin Utama.
- **Setiap jawaban berlabel "Jawaban AI — cek sumbernya"** dan memuat baris **Sumber** (data mana, filter apa). Klik **Buka di halaman …** untuk memeriksa angkanya langsung.
- **Angka dijaga.** Bila jawaban AI memuat angka yang tidak ada di data, jawaban tidak ditampilkan; yang tampil adalah **tabel sumbernya**.
- **Nama orang disamarkan** sebelum dikirim ke AI dan dikembalikan hanya pada tampilan jawaban Anda.
- **Bila gagal** (model lambat/tidak tersedia), muncul pesan jelas; tidak pernah jawaban karangan. Coba lagi atau persempit pertanyaan (sebut periode/lokasi).
- **Batas:** 500 karakter per pertanyaan; 20 pertanyaan/jam dan 100/hari per pengguna (Admin Utama tidak dibatasi). Riwayat percakapan tidak disimpan; hanya 3 pertanyaan terakhir di layar yang dipakai sebagai konteks.
- Tombol 👍/👎 menilai jawaban (isi jawaban tidak disimpan, hanya penilaian).

**Mengaktifkan (Admin Utama):** Setup master → Asisten AI → **Tanya OMOS**: Mati → **Uji** (hanya Admin Utama) → **Aktif** (semua admin).

### 4.5 Pertanyaan umum

**Tombol ✨ Saran AI tidak muncul.**
Fitur triase masih Mati atau Uji di Setup → Asisten AI. Pada mode Uji, hanya Admin Utama yang melihat tombol.

**Muncul "Asisten AI belum dikonfigurasi" atau "tidak merespons".**
Isi form secara manual seperti biasa. Laporkan ke admin bila terjadi terus-menerus.

**Tombol Gabungkan tidak ada atau ditolak.**
Akun Anda belum punya izin **HSE: Gabung / Tolak Laporan Hazard Ganda**. Minta Admin Utama mencentangnya.

**Saran AI salah.**
Klik **Bukan duplikat** atau **Abaikan saran**. Keputusan Anda dicatat untuk perbaikan AI.

