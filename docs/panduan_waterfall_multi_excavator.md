# Panduan Perhitungan Waterfall Multi-Excavator

## 1. Tujuan

Jika jumlah excavator lebih dari satu dan setiap unit memiliki **Productivity, PA, dan UA berbeda**, perhitungan harus dilakukan **per unit terlebih dahulu**, kemudian seluruh kontribusi dijumlahkan.

Prinsip dasar:

\[
P_i = N_i \times HM_i \times PA_i \times UA_i \times Productivity_i
\]

Keterangan:

- \(P_i\) = produksi unit ke-
  \(i\).
- \(N_i\) = jumlah unit pada baris perhitungan; biasanya 1 jika data sudah per excavator.
- \(HM_i\) = HM unit ke-\(i\).
- \(PA_i\) = physical availability unit ke-\(i\).
- \(UA_i\) = use of availability unit ke-\(i\).
- \(Productivity_i\) = produktivitas unit ke-\(i\), misalnya ton/jam.

---

## 2. Rumus Produksi per Unit

### Produksi Plan

\[
P_{Plan,i} = N_i \times HM_i \times PA_{Plan,i} \times UA_{Plan,i} \times Prod_{Plan,i}
\]

### Produksi Aktual

\[
P_{Actual,i} = N_i \times HM_i \times PA_{Actual,i} \times UA_{Actual,i} \times Prod_{Actual,i}
\]

### Total Fleet

\[
P_{Plan,Fleet} = \sum_{i=1}^{n} P_{Plan,i}
\]

\[
P_{Actual,Fleet} = \sum_{i=1}^{n} P_{Actual,i}
\]

---

## 3. Dampak Productivity per Unit

Dampak Productivity unit ke-\(i\) dihitung sebagai:

\[
\Delta P_{Prod,i} = N_i \times HM_i \times PA_{Actual,i} \times UA_{Actual,i} \times (Prod_{Actual,i} - Prod_{Plan,i})
\]

Total dampak Productivity fleet:

\[
\boxed{
\Delta P_{Prod,Fleet} = \sum_{i=1}^{n} \left[N_i \times HM_i \times PA_{Actual,i} \times UA_{Actual,i} \times (Prod_{Actual,i} - Prod_{Plan,i})\right]
}
\]

Rumus satu baris seperti berikut hanya boleh digunakan jika seluruh unit memiliki parameter yang sama:

\[
\Delta P_{Prod} = N \times HM \times PA_{Actual} \times UA_{Actual} \times (Prod_{Actual} - Prod_{Plan})
\]

Untuk unit dengan parameter berbeda, gunakan penjumlahan per unit.

---

## 4. Contoh Dua Excavator

| Parameter | EX-01 | EX-02 |
|---|---:|---:|
| Schedule hour | 600 jam | 600 jam |
| PA Aktual | 90% | 80% |
| UA Aktual | 70% | 60% |
| Productivity Plan | 100 ton/jam | 120 ton/jam |
| Productivity Aktual | 95 ton/jam | 110 ton/jam |

### EX-01

\[
\Delta P_{Prod,1} = 600 \times 90\% \times 70\% \times (95 - 100)
\]

\[
\Delta P_{Prod,1} = -1.890\text{ ton}
\]

### EX-02

\[
\Delta P_{Prod,2} = 600 \times 80\% \times 60\% \times (110 - 120)
\]

\[
\Delta P_{Prod,2} = -2.880\text{ ton}
\]

### Total Dampak Productivity

\[
\Delta P_{Prod,Fleet} = -1.890 + (-2.880) = -4.770\text{ ton}
\]

Dampak penurunan Productivity seluruh fleet adalah **-4.770 ton**.

---

## 5. Mengapa Tidak Boleh Menggunakan Rata-rata Sederhana?

Rata-rata sederhana dapat menghasilkan nilai yang keliru karena setiap excavator memiliki effective hours yang berbeda.

Contoh rata-rata sederhana:

\[
PA_{rata-rata} = \frac{90\% + 80\%}{2} = 85\%
\]

\[
UA_{rata-rata} = \frac{70\% + 60\%}{2} = 65\%
\]

\[
Prod_{Plan,rata-rata} = \frac{100 + 120}{2} = 110\text{ ton/jam}
\]

\[
Prod_{Actual,rata-rata} = \frac{95 + 110}{2} = 102,5\text{ ton/jam}
\]

Jika dimasukkan ke formula:

\[
600 \times 85\% \times 65\% \times (102,5 - 110) = -2.486,25\text{ ton}
\]

Hasil tersebut berbeda dari hasil unit-by-unit, yaitu **-4.770 ton**. Oleh karena itu, metode yang benar adalah menerapkan PA dan UA ke masing-masing unit terlebih dahulu.

---

## 6. Weighted Average yang Benar

Jika daHMboard memerlukan satu nilai gabungan, gunakan bobot jam efektif.

### Effective Hours

\[
EH_i = HM_i \times PA_{Actual,i} \times UA_{Actual,i}
\]

Untuk contoh:

\[
EH_1 = 600 \times 90\% \times 70\% = 378\text{ jam}
\]

\[
EH_2 = 600 \times 80\% \times 60\% = 288\text{ jam}
\]

\[
EH_{Fleet} = 378 + 288 = 666\text{ jam}
\]

### Productivity Plan Berbobot

\[
Prod_{Plan,weighted} = \frac{EH_1 \times Prod_{Plan,1} + EH_2 \times Prod_{Plan,2}}{EH_1 + EH_2}
\]

\[
Prod_{Plan,weighted} = \frac{378(100) + 288(120)}{666} = 108,65\text{ ton/jam}
\]

### Productivity Aktual Berbobot

\[
Prod_{Actual,weighted} = \frac{EH_1 \times Prod_{Actual,1} + EH_2 \times Prod_{Actual,2}}{EH_1 + EH_2}
\]

\[
Prod_{Actual,weighted} = \frac{378(95) + 288(110)}{666} = 101,49\text{ ton/jam}
\]

### Verifikasi Dampak

\[
EH_{Fleet} \times (Prod_{Actual,weighted} - Prod_{Plan,weighted})
\]

\[
= 666 \times (101,49 - 108,65) \approx -4.770\text{ ton}
\]

Hasilnya sama dengan metode unit-by-unit.

> Untuk perhitungan waterfall, metode yang paling aman adalah menghitung per unit kemudian menjumlahkan.

---

## 7. PA dan UA Fleet

### PA Fleet

Gunakan bobot schedule hour:

\[
PA_{Fleet} = \frac{\sum_i(HM_i \times PA_i)}{\sum_i HM_i}
\]

Untuk contoh:

\[
PA_{Fleet} = \frac{600(90\%) + 600(80\%)}{1.200} = 85\%
\]

### UA Fleet

Karena UA dihitung dari available hours, gunakan:

\[
UA_{Fleet} = \frac{\sum_i(HM_i \times PA_i \times UA_i)}{\sum_i(HM_i \times PA_i)}
\]

Untuk contoh:

\[
UA_{Fleet} = \frac{600(90\%)(70\%) + 600(80\%)(60\%)}{600(90\%) + 600(80\%)}
\]

\[
UA_{Fleet} = \frac{666}{1.020} = 65,29\%
\]

Validasi:

\[
PA_{Fleet} \times UA_{Fleet} = 85\% \times 65,29\% \approx 55,50\%
\]

\[
\frac{EH_{Fleet}}{HM_{Fleet}} = \frac{666}{1.200} = 55,50\%
\]

---

## 8. Waterfall Lengkap per Unit

### Plan

\[
P_{Plan,i} = N_i \times HM_i \times PA_{Plan,i} \times UA_{Plan,i} \times Prod_{Plan,i}
\]

### Dampak PA

\[
\Delta P_{PA,i} = N_i \times HM_i \times (PA_{Actual,i} - PA_{Plan,i}) \times UA_{Plan,i} \times Prod_{Plan,i}
\]

### Dampak UA

\[
\Delta P_{UA,i} = N_i \times HM_i \times PA_{Actual,i} \times (UA_{Actual,i} - UA_{Plan,i}) \times Prod_{Plan,i}
\]

### Dampak Productivity

\[
\Delta P_{Prod,i} = N_i \times HM_i \times PA_{Actual,i} \times UA_{Actual,i} \times (Prod_{Actual,i} - Prod_{Plan,i})
\]

### Dampak Other Fleet

\[
\Delta P_{Other} = P_{Actual} - \sum_i(P_{Plan,i} + \Delta P_{PA,i} + \Delta P_{UA,i} + \Delta P_{Prod,i})
\]

### Rekonsiliasi

\[
P_{Actual} = \sum_iP_{Plan,i} + \sum_i\Delta P_{PA,i} + \sum_i\Delta P_{UA,i} + \sum_i\Delta P_{Prod,i} + \Delta P_{Other}
\]

---

## 9. Struktur Data DaHMboard

Gunakan satu baris untuk satu unit per periode.

| Field | Keterangan |
|---|---|
| `period` | Periode, misalnya 2026-09 |
| `excavator_id` | ID unit, misalnya EX-01 |
| `HM` | Schedule hour |
| `PA_plan` | PA rencana |
| `PA_actual` | PA aktual |
| `UA_plan` | UA rencana |
| `UA_actual` | UA aktual |
| `productivity_plan_tph` | Produktivitas rencana, ton/jam |
| `productivity_actual_tph` | Produktivitas aktual, ton/jam |
| `plan_ton_unit` | Hasil Plan per unit |
| `pa_impact_ton_unit` | Dampak PA per unit |
| `ua_impact_ton_unit` | Dampak UA per unit |
| `productivity_impact_ton_unit` | Dampak Productivity per unit |
| `other_fleet_ton` | Residual faktor lain |
| `actual_ton_unit` | Produksi aktual per unit |
| `reconciliation_check` | Pemeriksaan selisih rekonsiliasi |

---

## 10. Agregasi untuk Grafik Waterfall

Untuk grafik utama, jumlahkan kontribusi setiap unit:

\[
Total\ PA\ Impact = \sum_i \Delta P_{PA,i}
\]

\[
Total\ UA\ Impact = \sum_i \Delta P_{UA,i}
\]

\[
Total\ Productivity\ Impact = \sum_i \Delta P_{Prod,i}
\]

Urutan grafik yang direkomendasikan:

1. Plan.
2. PA Impact.
3. UA Impact.
4. Productivity Impact.
5. Other Fleet.
6. Actual.

Sediakan drill-down dari total fleet ke:

- Site.
- Pit.
- Fleet.
- Excavator ID.
- HMift.
- Penyebab Productivity.

---

## 11. Kesimpulan

Jika setiap excavator memiliki parameter berbeda, gunakan:

\[
\boxed{
\Delta P_{Prod,Fleet} = \sum_i \left[HM_i \times PA_{Actual,i} \times UA_{Actual,i} \times (Prod_{Actual,i} - Prod_{Plan,i})\right]
}
\]

Jangan menggunakan rata-rata PA, UA, dan Productivity secara sederhana. Untuk daHMboard, tampilkan total fleet pada waterfall, tetapi sediakan drill-down ke kontribusi masing-masing excavator agar penyebab gap produksi dapat ditelusuri.
