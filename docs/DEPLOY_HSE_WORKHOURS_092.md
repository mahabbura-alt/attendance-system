# Deploy HSE Jam Kerja (migrasi 092) — runbook

Status: BELUM DEPLOY. Jalankan dari laptop (PowerShell/Git Bash) dengan kunci SSH Anda sendiri.
Server: `adminbiznet@103.58.101.240`, root `/opt/omos`. DB staging: container `omos-postgres-staging`, db `omos_staging`.

## 1. Kirim kode (dari folder OMOS)
```bash
REL=$(date +%Y%m%d-%H%M%S)-hse-workhours
tar --exclude=.git --exclude=node_modules --exclude='.env*' --exclude=.vercel --exclude=mobile-android --exclude=omos-key.pem \
    -czf /tmp/$REL.tgz .
scp -i omos-key.pem /tmp/$REL.tgz adminbiznet@103.58.101.240:/tmp/
ssh -i omos-key.pem adminbiznet@103.58.101.240 "mkdir -p /opt/omos/releases/$REL && tar -xzf /tmp/$REL.tgz -C /opt/omos/releases/$REL"
```

## 2. Backup DB sebelum migrasi (di server)
```bash
docker exec omos-postgres-staging pg_dump -U <DB_USER> -Fc omos_staging > /opt/omos/backups/manual/$(date +%Y%m%d-%H%M%S)-pre-hse-workhours-092.dump
pg_restore -l <file.dump> | head   # pastikan terbaca
```

## 3. Jalankan migrasi 092 (di server, sebelum switch release)
Migrasi bersifat aditif (tabel baru + 1 kolom nullable + 2 indeks) sehingga aman untuk aplikasi lama.
```bash
cd /opt/omos/releases/$REL/backend
docker run --rm --network biznet_omos_data --env-file /opt/omos/secrets/app.env \
  -v "$PWD/..":/app -w /app/backend omos-app:<IMAGE_SAAT_INI> node src/scripts/run_migration_092_hse_workhours.js
```
Harapan: `Verified tables: [4 tabel]` dan `Migration 092 completed successfully!`.
Butuh `CREATE EXTENSION btree_gist` (sudah dipakai 084/088/089; user DB harus berhak).

## 4. Rilis aplikasi
```bash
sh /opt/omos/releases/$REL/ops/biznet/release-app.sh /opt/omos/releases/$REL omos-app:$REL $REL
```
Rollback otomatis bila health gagal. Rollback migrasi manual: `092_hse_workhours_down.sql`.

## 5. Verifikasi
- `curl -s https://<domain>/health` → 200
- `curl -s -o /dev/null -w '%{http_code}' https://<domain>/api/hse/workhours/setup` → 401 tanpa token
- Hard refresh dashboard (cache bust `hse.js?v=7`, `hse.css?v=2`), buka HSE → Setup Master → Jam kerja.
- Login admin: isi standar jam/hari per jabatan, cek tab Rekap, baru "Kirim ke jam kerja HSE" untuk bulan yang sudah selesai.

## Catatan
- Jam kerja karyawan internal otomatis diganti rekap; input manual internal ditolak (422). Kontraktor tetap manual.
- Sebelum ada standar, rasio LTIFR/TRIR/SR tampil kosong (bukan 0).
- Setelah sukses, catat bukti deploy di `OMOS_WORKING_CONTEXT_AND_HANDOVER.md`.
