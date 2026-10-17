# Review Produksi — direct delay v3

Implementasi lokal, 27 September 2026. Belum deploy.

## Formula authoritative

Per tanggal operasional + excavator + PIT + JOB + material + satuan:

- `T`: jam jadwal plan yang dialokasikan ke konteks.
- `Ap = T × PAplan`: available hours plan.
- `Dp`: jumlah jam parameter delay SPO untuk konteks tersebut.
- `H`: HM aktual; `Da`: standby aktual; `B`: breakdown aktual.
- `Q`: productivity plan efektif (BCM/jam atau Ton/jam).
- `V`: produksi aktual sesuai kalkulasi ritase produktif eksisting.

```text
EWH plan = Ap − Dp
UA plan = (Ap − Dp) / Ap
Plan = (Ap − Dp) × Q
ΔPA/jam tersedia = (H + Da − Ap) × Q
ΔUA per parameter = (Dp_parameter − Da_parameter) × Q
ΔProductivity = V − H × Q
Plan + ΔPA + ΣΔUA + ΔProductivity = V
```

Rincian PA menggunakan budget breakdown `(T−Ap)×Q`, kehilangan breakdown
aktual `−B×Q`, dan selisih cakupan waktu `(H+Da+B−T)×Q`. Komponen terakhir
ditampilkan terpisah: kekurangan jam pencatatan bukan otomatis breakdown.
Persentase PA aktual tetap `(H+Da)/(H+Da+B)`; UA aktual `H/(H+Da)`.

Contoh: Ap 20 jam, Dp 8 jam, Da 7 jam, H 8 jam, Q 150 BCM/jam,
V 1.200 BCM: Plan 1.800, ΔPA −750, ΔUA +150, ΔProductivity 0.
S01 plan 5 vs aktual 4 menghasilkan +150; S10 3 vs 3 menghasilkan 0.

Perbedaan rate dihitung pada setiap grain dahulu, baru dijumlahkan.
Kesamaan *total* jam lintas grain dengan rate berbeda tidak selalu berarti
total dampak nol; kesamaan plan-aktual pada setiap grain pasti menghasilkan nol.
Productivity plan agregat berbobot EWH plan; productivity aktual = ΣV/ΣH.
Rasio PA/UA agregat dihitung dari jumlah pembilang/penyebut, bukan rata-rata persen.
BCM dan Ton tidak dijumlahkan; UI meminta satu satuan/JOB yang kompatibel.

## Ketiga Source Planning

| Sumber | Scope dan rate |
| --- | --- |
| Aktual | Grain aktual; rate efektif 0.5/0.6 sesuai tanggal/unit/JOB/material/satuan; PIT dari aktual. |
| Fleet Deployment | Grain deployment, termasuk material; rate snapshot 0.8. Material tidak sesuai masuk Other/Unplanned. Plan tetap ada walau tidak ada HM material tersebut. |
| Fleet x Material | Eligibility unit/tanggal/PIT/JOB dari 0.8; material/rate efektif 0.5/0.6. Di luar deployment menjadi Other; plan material yang tidak tersedia menjadi data quality. |

Semua mode memakai fungsi domain yang sama di `backend/src/services/reviewWaterfall.js`.
Rincian UA menggunakan `reviewUaImpact.js`. Renderer tidak menghitung ulang
dampak memakai formula rasio lama. Versi: `review-waterfall-direct-delay-v3`
dan `review-ua-spo-direct-v3`.

## Alokasi dan batasan

- Basis jadwal eksisting tetap 24 jam/unit/hari; bukan model roster baru.
- Beberapa konteks deployment pada unit/hari membagi plan secara rata.
- Aktual/Fleet x Material menggunakan porsi HM konteks terhadap HM unit/hari;
  tanpa HM menggunakan pembagian rata. HM material masih estimasi dari span
  ritase eksisting, bukan pencatatan HM material langsung.
- Standby/breakdown belum mempunyai seluruh dimensi material/JOB; dialokasikan
  menurut HM konteks, atau porsi plan ketika HM harian nol.
- Delay SPO dialokasikan dengan porsi plan; nilai per unit/material bukan
  penggandaan penuh total SPO ketika unit mempunyai beberapa konteks.
- `Dp > Ap`, PA plan tidak tersedia, atau SPO tidak tersedia tidak dinormalisasi.
  Volume aktual tetap terlihat pada Other/Data Quality di luar dekomposisi valid.
- Snapshot SPO efektif tetap dipakai. Fallback historis eksisting ditandai
  `SPO_HISTORY_FALLBACK`; bukan klaim bahwa versi pada tanggal tersebut terkunci.
- Deployed OB/CG/FOT memakai 12 identitas parameter yang dikunci. Snapshot lama
  membaca katalog terverifikasi dari snapshot aktif. Sistem tidak lagi membuat
  kode sintetis `SPO_ROW_n`; jika katalog benar-benar tidak tersedia, grain
  ditandai `MISSING_SPO_PARAMETER_DETAIL` dan tidak didekomposisi dengan tebakan.
- Seluruh kalkulasi full precision. Koreksi pembulatan hanya jika nilai mentah
  sudah rekonsiliasi, tidak mengubah baris berdampak nol atau menutup gap sumber.

## Bukti verifikasi

Pembacaan langsung controller/database, BEI–OB, 20–23 Sep 2026:

| Sumber | Plan | ΔPA | ΔUA | ΔProductivity | Aktual planned | Other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Aktual | 24.174,989426 | 2.090,742920 | −10.260,903878 | 3.581,171532 | 19.586 | 0 |
| Fleet Deployment | 18.894,834887 | −18.398,277897 | 4.988,999238 | −613,556227 | 4.872 | 14.714 |
| Fleet x Material | 15.591,823982 | 584,924421 | −5.377,858311 | 2.163,109908 | 12.962 | 6.624 |

Semua jumlah rincian PA/UA sama dengan delta utama pada presisi floating-point.
Data sampel memiliki flag historical SPO dan menggunakan katalog parameter aktif
yang sudah diverifikasi untuk membaca row identity snapshot lama.
Uji browser memakai fixture sintetis yang diberi label di source, bukan data produksi:
ketiga pilihan memperbarui angka, parameter plan=aktual tetap nol, tabel dapat
di-scroll horizontal, batang PA/UA dibatasi lebarnya, console error/warn kosong.

Tidak ada migrasi atau mutasi data operasional. Endpoint reporting yang sama;
penambahan detail PA, kualitas sumber, dan denominasi rasio pada response.
Middleware autentikasi dan batas database client eksisting tidak diubah;
pekerjaan ini bukan implementasi tenancy baru atau perubahan jalur offline/sync.
