# Deploy OMOS People v2 (migrasi 093–098) — runbook

Status: **BELUM DEPLOY, belum dijalankan di DB mana pun** (hanya diuji di PGlite: naik → ulang → turun → naik).
Server: `adminbiznet@103.58.101.240`, root `/opt/omos`. DB staging: container `omos-postgres-staging`, db `omos_staging`.
Jalankan dari laptop dengan kunci SSH Anda sendiri. Langkah kirim kode, backup, dan switch release sama seperti
`docs/DEPLOY_HSE_WORKHOURS_092.md` — di bawah hanya bagian yang berbeda.

## 0. Urutan
1. **092 dulu** (HSE jam kerja) bila belum — 097 tidak bergantung padanya, tapi rilis kode ini memuat perbaikan T0 di `hseWorkhours.js`.
2. Backup DB.
3. Pre-flight read-only (`docs/drafts/karyawan_preflight_readonly.sql`, P1–P21; hanya SELECT dalam transaksi READ ONLY + ROLLBACK, output tanpa nama/NIK). Dari laptop, folder OMOS, **Git Bash**:
   ```bash
   ssh -i omos-key.pem adminbiznet@103.58.101.240 \
     "docker run --rm -i --network biznet_omos_data --env-file /opt/omos/secrets/app.env postgres:17-alpine sh -ec 'psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -P pager=off'" \
     < docs/drafts/karyawan_preflight_readonly.sql > preflight.txt
   ```
   PowerShell: `Get-Content docs\drafts\karyawan_preflight_readonly.sql | ssh -i omos-key.pem adminbiznet@103.58.101.240 "<perintah docker yang sama>" > preflight.txt`.
   Di server: `sh ops/biznet/run-people-preflight.sh <path SQL>`. Bila `--env-file` ditolak (izin), jalankan dengan `sudo`.
   Wajib nol sebelum migrasi: **P17** (NRP ganda), **P18** (email ganda), **P19** (nama departemen/jabatan ganda), **P21** (tabel People v2 sudah ada). Tinjau **P5** (jabatan teks tanpa master → lengkapi di Setup master setelah migrasi), **P9** (pergerakan jatuh tempo), **P11** (registrasi tertunda yang harus diinput ulang).
4. Migrasi 093–098 **sebelum** switch release (aditif & idempoten; kode lama tetap jalan di atas skema baru).
5. `npm ci` di image baru — dependensi baru: `exceljs@^4.4.0` (root dan `backend/`, lockfile sudah diperbarui).
6. Switch release, smoke test, pasang cron harian.

## 1. Migrasi
```bash
cd /opt/omos/releases/$REL/backend
docker run --rm --network biznet_omos_data --env-file /opt/omos/secrets/app.env \
  -v "$PWD/..":/app -w /app/backend omos-app:<IMAGE> node src/scripts/run_migration_093_098_people_v2.js
# cek saja (tanpa mengubah):  ... node src/scripts/run_migration_093_098_people_v2.js --check
```
Harapan: `Migrasi People v2 lengkap: 12 tabel + kolom pergerakan v2.`
Tiap file berjalan dalam transaksinya sendiri; bila satu gagal, file sebelumnya tetap tersimpan dan aman diulang.

Rollback (urut terbalik, hanya bila belum ada data People v2 yang perlu dipertahankan):
`098_..._down.sql` → `097` → `096` → `095` → `094` → `093`.

## 2. Penyimpanan dokumen PDF
- Lokal (`STORAGE_PROVIDER=local`): folder `${STORAGE_LOCAL_ROOT}/people-dokumen` dibuat otomatis; pastikan ikut volume persisten dan backup.
- Supabase: buat bucket **privat** `people-dokumen` (bukan public). Dokumen tidak pernah dilayani lewat `/api/storage/view`.

## 3. Cron harian (pergerakan jatuh tempo + outbox)
```cron
# 00:10 WIB = 17:10 UTC
10 17 * * * docker run --rm --network biznet_omos_data --env-file /opt/omos/secrets/app.env omos-app:<IMAGE> \
  node backend/src/scripts/run_people_daily.js >> /var/log/omos/people_daily.log 2>&1
```
Menggantikan `process_due_workforce_movements.js` (yang lama boleh dihentikan; keduanya idempoten).

## 4. Smoke test setelah switch
- Karyawan → Direktori tampil; KPI terisi; filter Departemen/Jabatan.
- Setup master: cek departemen & jabatan hasil backfill; lengkapi bila ada jabatan teks lama yang belum punya master.
- Tambah karyawan percobaan (lokasi absen 1 titik) → NRP otomatis → buka profil → Void.
- Import: unduh template → isi 1 baris → simulasi → Batalkan.
- Mobile web: tombol "Aktifkan akun" muncul; `POST /api/auth/daftar` = 410.
- Absen dari karyawan yang dibatasi lokasi: di luar lokasinya ditolak dengan nama lokasi yang diizinkan.

## 5. Perubahan perilaku yang perlu diumumkan
- Pendaftaran mandiri dari aplikasi dihentikan. Pengajuan "Registrasi Pending" yang masih menunggu **tidak bisa disetujui lagi** —
  input ulang lewat Karyawan → Tambah karyawan (atau Import Excel), lalu tolak pengajuan lamanya.
- Hapus permanen karyawan diganti **Void** (hanya bila belum ada absensi/HM/payroll) atau **Proses keluar**.
- Penyetuju pergerakan butuh izin `people.approve` (centang di pengaturan sub-admin) atau Admin Utama.
- Karyawan tanpa daftar lokasi absen tetap boleh absen di semua lokasi (perilaku lama); begitu lokasi diisi, absen dibatasi.
