# Histori Chat & Konteks Proyek — OMOS (ONE MINING)

> File ini disiapkan untuk migrasi histori chat. Setelah workspace berpindah ke
> Workspace kanonis dipindahkan pada 2026-10-05 ke `D:\OneDrive\Desktop\OMOS`. Nama `ONE MINING` di bagian historis tetap dipertahankan sebagai konteks asal.

## 1. Identitas Proyek

- **Nama**: OMOS (One Mining Operating System) / Attendance System
- **Direktori utama saat ini**: `D:\OneDrive\Desktop\OMOS`
- **Direktori sumber lama**: `D:\OneDrive\Desktop\PROJECT` (sudah di-merge ke ONE MINING)
- **Pemilik**: User (owner OMOS)
- **Akun Vercel / GitHub**: `mahabbura-alt` / `wodav`

## 2. Ringkasan Pekerjaan Besar (Selesai)

1. **Merge PROJECT → ONE MINING** (Opsi 2, ONE MINING sebagai base final).
   - Seluruh fitur 7 tab dasar + modul Production dari PROJECT diport ke ONE MINING.
   - Backend Absensi PROJECT di-refactor & disinkronkan.
2. **Deploy ONE MINING ke Vercel** — proyek `attendance-system`.
3. **Pembersihan keamanan**: Supabase service role key dihapus dari seluruh riwayat git
   (git filter-branch), force-push ke GitHub main.

## 3. Struktur Direktori Penting

```
D:\OneDrive\Desktop\OMOS\
├── api\index.js                 → entry Vercel (require backend/src/server)
├── backend\src\
│   ├── server.js                → app Express + mount semua route
│   ├── config\                  → env.js, db.js, minio.js
│   ├── controllers\             → absensiController.js, dll.
│   ├── routes\                  → absensi.routes.js, storage.routes.js, dll.
│   ├── services\storage.js      → Supabase/MinIO/Base64 storage
│   └── scripts\                 → init/check/test supabase storage
├── admin-dashboard\             → portal admin (index.html, app.js, style.css)
├── mobile-web\                  → portal karyawan (index.html, karyawan.js)
├── vercel.json                  → konfigurasi build & route Vercel
└── .vercel\project.json         → link ke proyek attendance-system
```

## 4. Konfigurasi Deploy Vercel

- **Proyek**: `attendance-system`
- **projectId**: `prj_DGzxcVo212XQupzAujRzlh0ajkGt`
- **orgId**: `team_tnf8wSihvxe6PRb3wt9MnwD5`
- **Alias produksi**: `attendance-system-eta-opal.vercel.app`
- **Entry**: `api/index.js` → `require('../backend/src/server')`
- OMOS sudah di-link ke proyek via `vercel link` (folder `.vercel` ikut dipindahkan).

## 5. Bug Terakhir yang DIPERBAIKI (Selesai & Terverifikasi)

**Gejala**: "lokasi absen & riwayat absensi tidak bisa dibaca APK dan portal web".

**Root cause**: Regresi saat merge — di `backend/src/server.js`, `absensiRoutes`
di-require tetapi **tidak pernah di-mount** (`app.use('/api/absensi', absensiRoutes)`
hilang). Akibatnya seluruh `/api/absensi/*` mengembalikan 404.

**Perbaikan**:
1. `backend/src/server.js` → tambah `app.use('/api/absensi', absensiRoutes);`
2. `backend/src/services/storage.js` → inisialisasi Supabase dibuat **lazy**
   (`getSupabase()`) agar server tidak crash di module-load bila
   `SUPABASE_SERVICE_ROLE_KEY` belum tersedia.

**Verifikasi produksi** (deploy `okr7h5v59`, alias `attendance-system-eta-opal`):
- `/api/absensi/lokasi-kantor` → 401 (sebelumnya 404) ✅
- `/api/absensi/riwayat` → 401 (sebelumnya 404) ✅
- `/api/absensi/check-lokasi` → 401 (sebelumnya 404) ✅
- `/health` → 200 ✅

## 6. Status Git

- Commit lokal terakhir: `c6698d1` (fix mount /api/absensi + storage resilient)
- **Belum ter-push ke GitHub** karena token GitHub yang tertanam di remote URL
  (`ghp_...`) sudah kedaluwarsa.
- Remote `origin` → `https://github.com/mahabbura-alt/attendance-system.git`
- **Aksi lanjutan yang disarankan**: ganti remote URL dengan token GitHub baru agar
  sinkronisasi GitHub → Vercel otomatis kembali berjalan.

## 7. Catatan Lingkungan & Tool

- OS: Windows 11, shell default `cmd.exe`.
- Workspace VS Code aktif saat file ini dibuat: `C:/Users/PIM - MAINPLAN/Desktop`.
- Tool `list_files`/`search_files` gagal (ripgrep binary tidak ada) → gunakan
  PowerShell/cmd (`dir`, `findstr`, `Select-String`, `curl`).
- `vercel` CLI tersedia global & terautentikasi sebagai `mahabbura-alt`.
- Bahasa komunikasi: **Bahasa Indonesia**.

## 8. Task Baru (Setelah Migrasi Workspace)

- [ ] Buka `D:\OneDrive\Desktop\OMOS` sebagai workspace baru di VS Code.
- [ ] Lanjutkan task baru yang diberikan user dengan konteks di atas.
