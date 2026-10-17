# Panduan SSH Tunnel OMOS Biznet

## Tujuan

Menjalankan dashboard dari source lokal sambil memakai backend dan data Biznet
secara langsung, tanpa membuka PostgreSQL atau API internal ke internet.

## Menjalankan

Klik dua kali:

```text
D:\OneDrive\Desktop\OMOS\start_biznet_tunnel.bat
```

Launcher akan:

1. memverifikasi SSH menggunakan `omos-key.pem`;
2. menemukan alamat internal container PostgreSQL secara dinamis;
3. membuka API Biznet pada `127.0.0.1:13000`;
4. membuka PostgreSQL Biznet pada `127.0.0.1:15432`;
5. menjalankan dashboard lokal pada port 8080 bila belum aktif;
6. membuka `http://localhost:8080/?api_mode=biznet`.

Login dan seluruh operasi dashboard berjalan melalui API Biznet. Dengan demikian
RBAC, audit, storage, dan formula tetap memakai runtime production Biznet.

## Menghentikan

Klik dua kali:

```text
D:\OneDrive\Desktop\OMOS\stop_biznet_tunnel.bat
```

Stopper hanya menghentikan PID tunnel dan dashboard yang dibuat launcher serta
tercatat di `.runtime`. Proses lain tidak dihentikan berdasarkan port secara
sembarangan.

## Endpoint Lokal

| Kebutuhan | Endpoint |
| --- | --- |
| Dashboard | `http://localhost:8080/?api_mode=biznet` |
| API Biznet melalui SSH | `http://127.0.0.1:13000` |
| PostgreSQL Biznet melalui SSH | `127.0.0.1:15432` |

Semua listener tunnel menggunakan loopback. Port 13000 dan 15432 tidak dapat
diakses perangkat lain di LAN.

## Pemeriksaan

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:13000/health
Get-NetTCPConnection -State Listen -LocalPort 13000,15432
```

Health API harus menghasilkan HTTP 200. Endpoint admin tanpa token harus tetap
menghasilkan HTTP 401.

## Keamanan

- Jangan menyalin private key, password database, JWT secret, atau isi
  `/opt/omos/secrets/app.env` ke dokumentasi/repository.
- Jangan mengubah bind tunnel menjadi `0.0.0.0`.
- Dashboard menggunakan API tunnel sebagai jalur utama. Jangan menjalankan
  backend lokal langsung terhadap database production karena upload/storage dan
  versi aplikasi dapat terpisah dari runtime Biznet.
- Port database disediakan hanya untuk inspeksi terkontrol oleh alat admin yang
  memang memiliki credential sah.

## Troubleshooting

- `SSH Biznet gagal`: cek internet, port 22, Fail2Ban, dan private key.
- `Port lokal ... dipakai`: hentikan tunnel lama menggunakan stopper, kemudian
  jalankan launcher kembali.
- API tunnel tidak sehat: periksa container `omos-app` dan health server Biznet.
- PostgreSQL tidak tersambung: periksa container `omos-postgres-staging` dan
  network `biznet_omos_data` di server.

