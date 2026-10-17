# OMOS APK Reverse-Proxy Audit

Status: `VERIFIED_ARTIFACT / PROXY NOT YET DEPLOYED`  
Audit date: 2026-10-05  
Artifact source: `D:\OneDrive\Desktop\PROJECT`

## Scope

Audit memastikan APK yang pernah dibangun dapat tetap berfungsi setelah backend
OMOS dipindah ke Biznet, tanpa langsung memaksa seluruh karyawan memasang APK baru.
Tidak ada APK yang dimodifikasi atau ditandatangani ulang.

## Artifact inventory

| Artifact | Version | Version code | SHA-256 | Embedded operational base URL |
| --- | ---: | ---: | --- | --- |
| `Absensi PIM.apk` | 1.0 | 1 | `9F89F793...41B4B9` | `https://attendance-system-eta-opal.vercel.app/` |
| `Absensi_PIM_V2.0.apk` | 2.0 | 2 | `A56E9545...7D5730` | `https://attendance-system-eta-opal.vercel.app/` |
| `Absensi_PIM_V2.1.apk` | 2.1 | 3 | `5647202A...03164` | `https://attendance-system-eta-opal.vercel.app/` |
| `Absensi_PIM_V2.2.apk` | 2.2 | 4 | `A24BE3FD...D6B20` | `https://attendance-system-eta-opal.vercel.app/` |
| `app-release.apk` | 1.0 | 1 | `F7B8F5BA...018F4` | `https://attendance-system-eta-opal.vercel.app/` |

Semua build publik di atas:

- memakai package `com.perusahaan.absensi`;
- target Android SDK 34 dan minimum SDK 26;
- memiliki izin internet;
- ditandatangani oleh sertifikat release yang sama;
- menggunakan HTTPS menuju hostname Vercel yang sama.

Salinan `admin-dashboard/Absensi PIM.apk` identik dengan artifact root berdasarkan
SHA-256, sehingga bukan versi kedua. Ditemukan pula build sangat awal
`mobile-android/Absensi PIM.apk` yang hanya menunjuk ke alamat LAN
`http://192.168.1.82:3000/`; build tersebut tidak dapat dibantu oleh proxy Vercel
dan tidak boleh dianggap APK produksi.

## Keputusan kompatibilitas

**APK V1.0–V2.2 dapat dilayani melalui reverse-proxy Vercel ke Biznet.**

APK tetap membuka hostname Vercel dan membuat koneksi TLS ke Vercel. Vercel lalu
melakukan external rewrite ke hostname HTTPS Biznet. Karena URL pada perangkat
tidak berubah, APK tidak perlu mengikuti redirect dan tidak perlu mengenal alamat
Biznet.

```text
APK V1.0–V2.2
  -> https://attendance-system-eta-opal.vercel.app/api/*
  -> Vercel external rewrite (reverse proxy)
  -> https://api.<domain-omos>/api/*
  -> OMOS Biznet
```

Vercel mendokumentasikan external rewrite sebagai reverse proxy ke external
origin. Implementasi final harus memakai rewrite, bukan response redirect.

## Mengapa redirect biasa tidak dipakai untuk API

Absensi datang/pulang mengirim request `POST` multipart dengan foto, koordinat,
dan token. Redirect `301/302` dapat mengubah method atau kehilangan body/header
pada sebagian client. Rewrite/proxy mempertahankan request pada sisi server dan
lebih aman untuk APK lama.

Redirect tetap boleh digunakan untuk halaman web dan link download APK.

## Konfigurasi target

Setelah Biznet memiliki domain HTTPS, routing Vercel dibuat secara konseptual:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://api.<domain-omos>/api/:path*"
    }
  ]
}
```

Konfigurasi aktual harus digabung dengan route static/admin/mobile yang sudah ada,
diuji pada preview deployment, dan baru dipromosikan setelah seluruh test lulus.
API authenticated/private tidak boleh di-cache.

## Syarat kompatibilitas backend Biznet

1. Path dan kontrak response `/api/*` harus identik dengan Vercel.
2. JWT secret awal harus sama agar sesi existing tidak langsung logout. Rotasi
   dilakukan terkontrol setelah masa transisi.
3. Batas request harus menerima ukuran foto APK existing.
4. Proxy harus meneruskan `Authorization`, method, query, content type, body, dan
   status response.
5. Timezone dan operational-date tetap Asia/Jakarta.
6. `/api/storage/*` dan URL foto lama harus memiliki fallback yang kompatibel.
7. Biznet harus menggunakan sertifikat HTTPS valid; jangan memakai alamat IP HTTP.
8. IP pada log Biznet dapat merepresentasikan edge proxy. Validasi absensi tetap
   memakai GPS/aturan aplikasi, bukan asumsi alamat IP client.

## Acceptance test per APK yang benar-benar tersebar

- [ ] Startup tanpa error TLS/network.
- [ ] Opsi pendaftaran/shift terbaca.
- [ ] Login dan sesi lama tetap valid.
- [ ] Check lokasi berhasil.
- [ ] Absen datang dengan foto dan GPS berhasil tepat satu kali.
- [ ] Retry tidak menggandakan transaksi.
- [ ] Absen pulang berhasil.
- [ ] Riwayat dan rekap tampil.
- [ ] Foto dapat dibaca kembali.
- [ ] Unauthorized/expired token tetap menghasilkan respons yang sama.
- [ ] Request ID dan audit record tersedia di Biznet.
- [ ] Vercel proxy tidak meng-cache response authenticated.

## Rollout

1. Tentukan dua file/hash yang benar-benar terpasang pada perangkat karyawan.
2. Deploy Biznet dan uji endpoint langsung.
3. Tambahkan external rewrite pada Vercel preview.
4. Uji kedua APK fisik end-to-end melalui preview/host compatibility yang aman.
5. Aktifkan rewrite produksi saat cutover.
6. Pantau trafik hostname lama selama 30–60 hari.
7. Rilis APK baru yang memakai domain API permanen.
8. Hentikan proxy hanya setelah tidak ada trafik versi lama.

## Kesimpulan

Reverse-proxy layak dan merupakan cara paling aman mempertahankan APK lama selama
migrasi. Ini tetap membutuhkan Vercel sebagai compatibility gateway sementara;
seluruh business logic, database, storage baru, dan pemrosesan transaksi berada di
Biznet. Build LAN lama merupakan pengecualian dan harus diganti.

