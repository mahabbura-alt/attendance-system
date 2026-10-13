# OMOS Safety — Handoff Sesi 13 Okt 2026

Rangkuman teknis pekerjaan sesi cloud (Claude Code) untuk modul HSE / APK **OMOS Safety**,
dan langkah memindahkannya ke direktori proyek lokal `D:\OneDrive\Desktop\OMOS`.

> Sesi cloud **tidak** pernah menyentuh `D:\OneDrive\Desktop\OMOS`. Semua perubahan kode ada di GitHub.

## 1. Lokasi perubahan

| Item | Nilai |
| --- | --- |
| Repo | `mahabbura-alt/attendance-system` |
| Branch | `claude/omos-hse-modul-review-m9qcrv` |
| Pull request | https://github.com/mahabbura-alt/attendance-system/pull/1 (base `main`, belum di-merge) |
| Commit | `269765d` feat(auth): login Employee ID dan reset sandi lewat admin · `8691d07` chore: script npm migration 043 |
| Mockup UI APK | https://claude.ai/artifact/14jS6bG8Zh2k6sZwfRH6hU (privat, 23 layar) |

## 2. Perubahan kode (PR #1)

### Backend
| File | Perubahan |
| --- | --- |
| `backend/src/services/passwordReset.js` (baru) | `resolveLoginIdentifier()` (Employee ID didahulukan, fallback email), `generateTemporaryPassword()` (10 karakter, tanpa 0/O/1/l/I), `ensurePasswordResetSchema()` (pastikan skema saat runtime, cached) |
| `backend/src/controllers/authController.js` | `login` menerima `employee_id` atau `email`; dibungkus try/catch → `next(err)`; respons tambah `employee_id, jabatan, departemen, shift_id, lokasi_kantor_id, must_change_password`. Baru: `mintaResetSandi`, `gantiSandi` |
| `backend/src/routes/auth.routes.js` | `POST /api/auth/minta-reset` (publik), `POST /api/auth/ganti-sandi` (requireAuth) |
| `backend/src/controllers/karyawanController.js` | Baru: `daftarPermintaanReset`, `resetPasswordKaryawan` (transaksi: set hash + `must_change_password=TRUE`, tandai request `done`, tulis `audit_log` tanpa sandi) |
| `backend/src/routes/karyawan.routes.js` | `GET /api/admin/karyawan/reset-requests`, `POST /api/admin/karyawan/:id/reset-password` (requireAuth + requireAdmin) |
| `backend/migrations/043_login_employee_id_password_reset_requests.sql` (baru) | `users.must_change_password BOOLEAN NOT NULL DEFAULT FALSE`; tabel `password_reset_requests` (status `pending/done/rejected`, unique pending per user) |
| `backend/package.json` | script `migration:login-employee-reset` |
| `backend/test/auth-employee-login.test.js` (baru) | 6 test resolver identitas & sandi sementara |

### Admin dashboard
| File | Perubahan |
| --- | --- |
| `admin-dashboard/index.html` | Panel `#panelResetSandi` di tab Karyawan |
| `admin-dashboard/app.js` | `muatPermintaanResetSandi()`, `resetSandiKaryawan()`, tombol **Reset Sandi** per baris karyawan |

### Kontrak API ringkas
```
POST /api/auth/login            { employee_id | email, password }
POST /api/auth/minta-reset      { employee_id }            → respons generik (anti-enumerasi)
POST /api/auth/ganti-sandi      { password_lama, password_baru }   (Bearer token)
GET  /api/admin/karyawan/reset-requests                        (admin)
POST /api/admin/karyawan/:id/reset-password → { temp_password } sekali tampil (admin)
```

## 3. Status database

Migration 043 **sudah dijalankan** oleh owner pada database di `backend\.env` (13 Okt 2026) dan terverifikasi:
`{ tabel: 'password_reset_requests', kolom: '1' }`. Migration idempoten; aman dijalankan ulang.

Catatan Windows: `Out-File -Encoding utf8` di PowerShell 5 menambah BOM yang membuat PostgreSQL error
`syntax error at or near "﻿"`. Gunakan `npm run migration:login-employee-reset` (setelah checkout branch) atau buang BOM
dengan `.replace(/^\uFEFF/,'')`.

## 4. Verifikasi yang sudah dilakukan
- `cd backend && npm test` → 151 test lulus (0 gagal).
- Admin dashboard dibuka di Chromium headless dengan API dimock: panel & tombol tampil, tanpa error JS.
- **Belum**: endpoint diuji terhadap database nyata; review visual di lingkungan owner.

## 5. Memindahkan ke `D:\OneDrive\Desktop\OMOS`

Saat sesi ini berakhir, working tree lokal memiliki perubahan belum di-commit pada file yang sama dengan PR #1:
`admin-dashboard/app.js`, `admin-dashboard/index.html`, `backend/package.json`,
`backend/src/controllers/karyawanController.js`, `backend/src/routes/auth.routes.js`, `backend/src/routes/karyawan.routes.js`.
Asal perubahan itu belum diketahui — **jangan ditimpa**.

```powershell
cd "D:\OneDrive\Desktop\OMOS"
git status                                        # catat branch & file berubah
git stash push -u -m "backup-lokal-sebelum-pr1"   # amankan perubahan lokal
git fetch origin
git checkout claude/omos-hse-modul-review-m9qcrv  # ambil seluruh perubahan sesi ini
git stash list
git stash show --stat stash@{0}                   # tinjau isi cadangan
git stash show -p stash@{0} > backup-lokal.diff   # opsional: simpan diff untuk ditinjau
```

Setelah ditinjau:
- Jika cadangan berisi pekerjaan lain yang masih dibutuhkan → `git stash apply stash@{0}`, selesaikan konflik, commit.
- Jika cadangan hanya salinan lama dari fitur yang sama → biarkan di stash (atau `git stash drop` setelah yakin).

Verifikasi lokal:
```powershell
cd backend
npm install
npm test
```

## 6. Deploy

- **Production = server Biznet via SSH**, bukan Vercel. Server tidak auto-deploy dari GitHub:
  setelah PR #1 di-merge ke `main`, perlu `git pull` di server lalu restart backend (prosedur Biznet belum terdokumentasi di repo).
- Vercel GitHub App **masih terpasang** di repo (bot Vercel membuat preview untuk PR #1). Bila tidak dipakai lagi, cabut di
  GitHub → Settings → Applications → Vercel, atau hapus proyek Vercel `attendance-system`.
- Dokumen repo (`vercel.json`, `api/`, `AGENTS.md`, `OMOS_handoff_2026-09-05.md`) masih menyebut Vercel → perlu diperbarui
  ke prosedur Biznet.
- Sesuai `AGENTS.md`: review visual admin dashboard di browser lokal wajib sebelum deploy frontend.

## 7. Keputusan desain APK OMOS Safety (disepakati)
- Distribusi **self-hosted APK** (bukan Play Store); auto-update = cek versi → unduh background → verifikasi SHA-256 → 1 tap Install;
  update wajib bila di bawah `min_supported_version_code` (Android tidak mengizinkan install diam-diam tanpa MDM).
- Stack: Kotlin + Jetpack Compose, Material 3, `minSdk 26`, Room (offline-first), WorkManager (sync), Retrofit.
- Offline-first: tiap record punya `client_uuid` (idempotency), outbox per item dengan status Menunggu/Mengirim/Terkirim/Gagal.
- Login: Employee ID + sandi akun OMOS yang sama; semua user aktif yang punya `employee_id`.
- Modul: Hazard Report, Inspeksi, P5M, Safety Talk / General, Pertemuan K3 / Umum, Laporan untuk Saya (PIC), Statistik, Notifikasi.

### Aturan bisnis dari review mockup
- **Hazard**: jenis Kondisi/Tindakan Tidak Aman; lokasi dropdown bertingkat Main Area → Sub Area (Setup Area, Master Setup HSE);
  waktu kejadian (default sekarang, bisa diubah); temuan + rekomendasi manual; foto wajib 1, maks 3; PIC multi-pilih
  (centang jabatan = semua personel terdaftar di Setup Master Hazard); matriks risiko 5×5 dengan definisi dari master;
  layar Periksa & Kirim.
- **Siklus hazard**: Open → In Progress → Menunggu verifikasi → Closed; verifikasi oleh HSE/pelapor; tolak → kembali ke PIC
  dengan alasan. Batas waktu: Ekstrem 24 jam, Tinggi 3 hari, Sedang 7 hari, Rendah 14 hari; lewat batas → eskalasi ke atasan PIC.
- **Notifikasi** timbal balik di setiap perpindahan status (push + layar notifikasi).
- **Inspeksi**: jenis inspeksi dropdown dari Setup Master Inspeksi; pertanyaan otomatis per jenis; OK/Tidak OK/N/A;
  Tidak OK → catatan + foto wajib + opsi jadikan hazard dengan PIC sendiri; **Insert kolom** item manual (lebih dari satu);
  peserta checklist dari anggota tim inspeksi di master.
- **P5M**: topik dari master (+ Lainnya manual), peserta dari karyawan aktif roster shift, foto wajib 1.
  Fitur "di roster, belum hadir" **dihapus** atas permintaan owner.
- **Safety Talk / General** & **Pertemuan K3 / Umum**: peserta lintas departemen (Departemen → Jabatan → Nama),
  lokasi bertingkat + opsi Lainnya (isi manual), pemateri/pimpinan bisa eksternal, lampiran opsional.
- **Statistik**: target vs aktual per modul per bulan berjalan (target dari Setup Target HSE per jabatan).
- **Lupa sandi**: minta reset ke admin (bukan OTP email); wajib ganti sandi sementara setelah login.

## 8. Belum dikerjakan
- Kode APK `mobile-safety/` belum dibuat (baru mockup).
- Backend modul HSE (tabel hazard, attachment, event/timeline, master area/kategori/PIC/inspeksi/target, endpoint sync idempoten,
  endpoint versi APK, notifikasi push) belum dibuat.
- Halaman admin: Setup Master HSE (area, PIC hazard, template inspeksi, topik P5M, target), verifikasi hazard, rilis APK.
- Role "atasan" belum ada; reset sandi saat ini hanya oleh admin.
- Temuan keamanan yang **ditunda owner** (tetap berisiko karena sandi dipakai bersama aplikasi absensi):
  `lupaSandi` mengembalikan `otp_demo` di respons; `daftar` me-log `req.body` (berisi password);
  `GET /api/storage/view` tanpa auth; keystore `mobile-android/app/pim-release.jks` ter-commit.
