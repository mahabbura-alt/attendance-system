# Panduan Waterfall Produksi Tambang Batubara

## Definisi yang Digunakan

Panduan ini menggunakan enam atribut: **Plan, PA, UA, Productivity, Other Fleet, dan Aktual**.

- **MOHH** adalah basis waktu tetap sebesar **24 jam per hari**.
- **EWH Plan** adalah jam kerja efektif rencana yang diperoleh dari MOHH, PA Plan, dan UA Plan.
- **HM Aktual** adalah jam efektif aktual. HM langsung digunakan sebagai jam efektif dan tidak dikalikan lagi dengan PA atau UA.
- **Productivity** adalah output per jam efektif, misalnya ton/jam.

---

## 1. Rumus Dasar

### Plan

Karena MOHH ditetapkan 24 jam per hari:

```text
EWH Plan = MOHH x PA Plan x UA Plan
EWH Plan = 24 jam x PA Plan x UA Plan
```

Produksi Plan:

```text
Plan = EWH Plan x Productivity Plan
```

### Aktual

HM adalah jam efektif aktual, sehingga:

```text
Aktual = HM Aktual x Productivity Aktual
```

> Jangan mengalikan HM dengan PA atau UA. PA dan UA digunakan untuk menjelaskan pembentukan EWH Plan dan dampak waktu, sedangkan HM sudah merupakan jam efektif aktual.

---

## 2. Perhitungan per Excavator

Jika nilai tiap excavator berbeda, hitung per unit lalu jumlahkan.

Untuk unit ke-i:

```text
EWH Plan_i = MOHH_i x PA Plan_i x UA Plan_i
Plan_i = EWH Plan_i x Productivity Plan_i
Aktual_i = HM Aktual_i x Productivity Aktual_i
```

Total fleet:

```text
Plan Fleet = sum(Plan_i)
Aktual Fleet = sum(Aktual_i)
```

Untuk periode lebih dari satu hari, MOHH menjadi:

```text
MOHH Periode = 24 jam x jumlah hari
```

Contoh periode 7 hari:

```text
MOHH = 24 x 7 = 168 jam
```

---

## 3. Dampak PA

Dengan MOHH sebagai basis waktu tetap:

```text
Delta PA_i = MOHH_i x (PA Aktual_i - PA Plan_i) x UA Plan_i x Productivity Plan_i
```

Dampak PA menunjukkan perubahan produksi akibat ketersediaan fisik aktual yang berbeda dari rencana.

---

## 4. Dampak UA

Dampak UA dihitung menggunakan PA aktual:

```text
Delta UA_i = MOHH_i x PA Aktual_i x (UA Aktual_i - UA Plan_i) x Productivity Plan_i
```

Urutan tersebut mencegah dampak PA dan UA dihitung dua kali.

---

## 5. Dampak Productivity

Karena HM adalah jam efektif aktual, rumusnya adalah:

```text
Delta Productivity_i = HM Aktual_i x (Productivity Aktual_i - Productivity Plan_i)
```

Total dampak Productivity:

```text
Delta Productivity Fleet = sum(Delta Productivity_i)
```

Productivity dipengaruhi oleh payload, cycle time, loading time, hauling time, dumping time, queue time, bucket fill factor, jarak angkut, kondisi jalan, dan faktor operasional lainnya.

---

## 6. Dampak Other Fleet

Setelah Plan, PA, UA, dan Productivity dihitung:

```text
Delta Other Fleet = Aktual - (Plan + Delta PA + Delta UA + Delta Productivity)
```

Other Fleet dapat mencakup perubahan jumlah unit, bantuan fleet lain, perubahan pasangan excavator-hauler, perpindahan pit, perubahan material, jarak angkut, density, stockpile, atau perbedaan metode rekonsiliasi.

---

## 7. Rekonsiliasi Waterfall

Urutan grafik:

1. Plan
2. PA
3. UA
4. Productivity
5. Other Fleet
6. Aktual

Persamaan rekonsiliasi:

```text
Aktual = Plan + Delta PA + Delta UA + Delta Productivity + Delta Other Fleet
```

Pemeriksaan:

```text
Check = Plan + Delta PA + Delta UA + Delta Productivity + Delta Other Fleet - Aktual
```

Nilai `Check` harus nol atau hanya berbeda karena pembulatan.

---

## 8. Contoh Perhitungan Satu Hari

Asumsi satu excavator:

| Parameter | Nilai |
|---|---:|
| MOHH | 24 jam |
| PA Plan | 90% |
| UA Plan | 70% |
| PA Aktual | 88% |
| UA Aktual | 68% |
| HM Aktual | 18 jam efektif |
| Productivity Plan | 100 ton/jam |
| Productivity Aktual | 95 ton/jam |

### EWH Plan

```text
EWH Plan = 24 x 90% x 70%
EWH Plan = 15,12 jam
```

### Produksi Plan

```text
Plan = 15,12 x 100
Plan = 1.512 ton
```

### Produksi Aktual

```text
Aktual = 18 x 95
Aktual = 1.710 ton
```

### Dampak Productivity

```text
Delta Productivity = 18 x (95 - 100)
Delta Productivity = -90 ton
```

Catatan: contoh ini menunjukkan bahwa HM aktual dapat lebih tinggi daripada EWH Plan. Dampak total PA, UA, dan Other Fleet tetap harus dihitung agar seluruh waterfall merekonsiliasi ke Aktual.

---

## 9. Contoh Dua Excavator

| Parameter | EX-01 | EX-02 |
|---|---:|---:|
| MOHH | 24 jam | 24 jam |
| PA Plan | 90% | 88% |
| UA Plan | 70% | 68% |
| PA Aktual | 88% | 80% |
| UA Aktual | 68% | 62% |
| HM Aktual | 18 jam | 16 jam |
| Productivity Plan | 100 ton/jam | 120 ton/jam |
| Productivity Aktual | 95 ton/jam | 110 ton/jam |

Per unit:

```text
EWH Plan EX-01 = 24 x 90% x 70% = 15,12 jam
Plan EX-01 = 15,12 x 100 = 1.512 ton
Aktual EX-01 = 18 x 95 = 1.710 ton
Delta Productivity EX-01 = 18 x (95 - 100) = -90 ton
```

```text
EWH Plan EX-02 = 24 x 88% x 68% = 14,3616 jam
Plan EX-02 = 14,3616 x 120 = 1.723,392 ton
Aktual EX-02 = 16 x 110 = 1.760 ton
Delta Productivity EX-02 = 16 x (110 - 120) = -160 ton
```

Total Productivity impact:

```text
Delta Productivity Fleet = -90 + (-160) = -250 ton
```

---

## 10. Struktur Data Dashboard

| Field | Keterangan |
|---|---|
| `period` | Periode laporan |
| `days_in_period` | Jumlah hari periode |
| `site` | Nama site |
| `pit` | Pit atau area kerja |
| `excavator_id` | ID excavator |
| `fleet_id` | ID fleet |
| `mohh_hour` | MOHH = 24 x jumlah hari |
| `ewh_plan_hour` | EWH Plan |
| `hm_actual_hour` | HM Aktual sebagai jam efektif |
| `pa_plan_pct` | PA Plan |
| `pa_actual_pct` | PA Aktual |
| `ua_plan_pct` | UA Plan |
| `ua_actual_pct` | UA Aktual |
| `productivity_plan_tph` | Productivity Plan |
| `productivity_actual_tph` | Productivity Aktual |
| `plan_ton` | Produksi Plan |
| `pa_impact_ton` | Dampak PA |
| `ua_impact_ton` | Dampak UA |
| `productivity_impact_ton` | Dampak Productivity |
| `other_fleet_ton` | Dampak Other Fleet |
| `actual_ton` | Produksi Aktual |
| `reconciliation_check` | Pemeriksaan rekonsiliasi |

---

## 11. Logika untuk Agen AI

1. Hitung MOHH sebagai `24 x jumlah hari`.
2. Hitung EWH Plan sebagai `MOHH x PA Plan x UA Plan`.
3. Hitung Plan sebagai `EWH Plan x Productivity Plan`.
4. Perlakukan HM Aktual sebagai jam efektif aktual.
5. Hitung Aktual sebagai `HM Aktual x Productivity Aktual`.
6. Hitung dampak PA menggunakan MOHH, perubahan PA, UA Plan, dan Productivity Plan.
7. Hitung dampak UA menggunakan MOHH, PA Aktual, perubahan UA, dan Productivity Plan.
8. Hitung dampak Productivity menggunakan HM Aktual.
9. Hitung Other Fleet sebagai residual.
10. Agregasikan unit ke fleet, pit, site, dan periode.
11. Validasi bahwa total waterfall sama dengan Aktual.

Prompt siap pakai:

> Buat dashboard waterfall produksi tambang batubara dengan urutan Plan, PA, UA, Productivity, Other Fleet, dan Aktual. Gunakan MOHH tetap 24 jam per hari; untuk beberapa hari, MOHH = 24 x jumlah hari. Hitung EWH Plan = MOHH x PA Plan x UA Plan. Hitung Plan = EWH Plan x Productivity Plan. Perlakukan HM Aktual sebagai jam efektif aktual dan hitung Aktual = HM Aktual x Productivity Aktual. Jangan mengalikan HM dengan PA atau UA. Untuk setiap excavator, hitung seluruh komponen secara terpisah lalu jumlahkan. Hitung Delta PA = MOHH x (PA Aktual - PA Plan) x UA Plan x Productivity Plan. Hitung Delta UA = MOHH x PA Aktual x (UA Aktual - UA Plan) x Productivity Plan. Hitung Delta Productivity = HM Aktual x (Productivity Aktual - Productivity Plan). Hitung Other Fleet sebagai residual. Tampilkan ton, achievement terhadap Plan, gap ton, tooltip rumus, sumber data, dan indikator rekonsiliasi.

---

## 12. Checklist Validasi

- [ ] MOHH ditetapkan 24 jam per hari.
- [ ] Untuk periode multi-hari, MOHH = 24 x jumlah hari.
- [ ] EWH Plan dihitung dari MOHH, PA Plan, dan UA Plan.
- [ ] HM Aktual ditetapkan sebagai jam efektif aktual.
- [ ] HM tidak dikalikan lagi dengan PA atau UA.
- [ ] Productivity menggunakan satuan konsisten, misalnya ton/jam.
- [ ] Setiap excavator dihitung terpisah jika parameternya berbeda.
- [ ] Other Fleet tidak memasukkan faktor yang sudah dihitung pada PA, UA, atau Productivity.
- [ ] Total waterfall sama dengan Aktual.
- [ ] Selisih rekonsiliasi ditampilkan jika tidak nol.

---

## 13. Ringkasan Formula

```text
MOHH = 24 x jumlah hari
EWH Plan = MOHH x PA Plan x UA Plan
Plan = EWH Plan x Productivity Plan
Aktual = HM Aktual x Productivity Aktual
Delta PA = MOHH x (PA Aktual - PA Plan) x UA Plan x Productivity Plan
Delta UA = MOHH x PA Aktual x (UA Aktual - UA Plan) x Productivity Plan
Delta Productivity = HM Aktual x (Productivity Aktual - Productivity Plan)
Delta Other Fleet = Aktual - (Plan + Delta PA + Delta UA + Delta Productivity)
```

Kunci model: **MOHH selalu 24 jam per hari, EWH digunakan untuk Plan, dan HM adalah jam efektif Aktual.**
