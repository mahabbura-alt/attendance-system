# Rencana Implementasi — Halaman "Review Produksi"
**Project:** OMOS — Admin Dashboard
**Modul terkait:** Fleet Capacity (0.8), PA/UA & EWH (0.4), SPO (0.3), Input Data (1), Breakdown (3), Standby (4)
**Referensi konsep:** `panduan_waterfall_produksi_tambang_batubara.pdf`
**Status:** Draft rencana — belum coding, menunggu konfirmasi asumsi & pertanyaan terbuka

---

## 0. Assumsi Kunci (perlu dikonfirmasi sebelum eksekusi)

| # | Assumsi | Kenapa Penting |
|---|---|---|
| A1 | "Halaman Data Produksi" = tab `1. 📝 Input Data` (bukan Productivity Report / MTD Report) | Menentukan posisi tab baru & skema renumbering sidebar |
| A2 | Unit "loader" yang diplot di Fleet Capacity = unit excavator/loading unit (bukan hauler) | Menentukan filter unit untuk query PA/UA/Actual |
| A3 | Job **FOT** untuk sementara belum punya data Plan (Fleet Capacity belum terhubung ke SPO Job) — grafik waterfall untuk FOT menampilkan status "Plan belum tersedia", bukan chart kosong/error | UX tetap jelas, tidak silently broken |
| A4 | PA Aktual & UA Aktual dihitung per kombinasi **Pit + Job + Periode** (agregat dari unit-unit loader yang di-assign ke Job tersebut di Fleet Capacity), bukan per unit individual | Formula asli PDF per-unit; permintaan user butuh agregasi HM/Standby/Breakdown gabungan dulu |
| A5 | Indikator rekonsiliasi (`Plan + ΔPA + ΔUA + OtherFleet ≈ Actual`) ditampilkan sebagai badge kecil di chart waterfall, bukan validasi yang memblokir tampilan | Sesuai rekomendasi PDF bagian 6 & 8 |

---

## 1. Peta Ketergantungan Data (Data Lineage)

Halaman "Review Produksi" adalah **read-only aggregation layer** — tidak boleh punya sumber data sendiri, murni menampilkan ulang agregat dari 4 halaman lain.

```
┌─────────────────────────┐
│ 0.8 Fleet Capacity       │──► Plan (poin 7a) + daftar unit loader per Pit+Job
│ (fleetCapacity.core.js)  │    Fungsi existing yang bisa dipakai ulang:
│                          │      - summarizePitValues()
│                          │      - calculateCheckedProduction()
│                          │      - deduplicateFleetPlans()
└─────────────────────────┘
┌─────────────────────────┐
│ 0.4 PA, UA & EWH         │──► PA Plan & UA Plan per Job/periode
│ (paUaEwh.core.js)        │    Fungsi existing: getValue(metric, unit, year, month, day)
└─────────────────────────┘
┌─────────────────────────┐
│ 1. Input Data            │──► Aktual produksi (ton) per unit/pit/job
│ 3. Breakdown             │──► Jam breakdown per unit (untuk PA Aktual)
│ 4. Standby               │──► Jam standby per unit (untuk PA & UA Aktual)
└─────────────────────────┘
┌─────────────────────────┐
│ 0.3 SPO                  │──► Master JOB (OB/CG/FOT) & daftar Pit aktif
│ (spo.core.js)            │    Fungsi existing: loadMasterJobs()
└─────────────────────────┘
```

### Gap yang perlu ditutup (belum ada fungsi/endpoint siap pakai)
1. Belum ada fungsi agregasi **HM + Standby + Breakdown per Pit + Job + rentang tanggal**, khusus untuk subset unit yang di-assign di Fleet Capacity. Ini fungsi baru yang menjadi inti kalkulasi poin 7b/7c.
2. Belum ada endpoint/fungsi yang memisahkan "produksi dari unit Fleet Capacity" vs "produksi dari unit lain" per periode — dibutuhkan untuk Other Fleet (7d) & Actual (7e).

---

## 2. Spesifikasi Komponen UI (urutan top-to-bottom sesuai brief)

| # | Komponen | Perilaku |
|---|---|---|
| 1 | Judul "Review Performa Produksi" | Statis, `<h2>`, konsisten dengan style header halaman lain |
| 2 | Slicer range tanggal | Dua date input (dari–sampai). Default saat pertama dibuka / belum ada pilihan tersimpan = **hari berjalan −1** (kemarin s.d. kemarin). Simpan pilihan terakhir (localStorage/dataset) agar tidak reset saat pindah tab |
| 3 | Teks "tanggal periode terpilih" | `color:#000; font-weight:700` (hitam, bold). Update reaktif setiap slicer berubah. Format: `Periode: 17 Sep 2026 – 17 Sep 2026` |
| 4 | Tombol Pit Area | **Auto-generate** dari List Equipment (bukan hardcode) — query unit unik, ambil field pit/area (contoh saat ini: BEI, DKC). Toggle show/hide (`aria-pressed`); area di bawah hanya render jika ≥1 pit aktif |
| 5 | Tombol JOB | Auto-generate dari Master JOB SPO (pakai `loadMasterJobs()` yang sudah ada — contoh saat ini: OB, CG, FOT). Toggle show/hide; hanya expand jika Pit di atasnya sudah dipilih |
| 6 | Grafik Pencapaian Produksi | Bar/line chart (Chart.js): Plan vs Actual per Pit+Job terpilih dalam rentang tanggal terpilih. Label ton + %achievement di atas bar. Warna konsisten dengan Executive Dashboard yang sudah ada |
| 7 | Grafik Waterfall Loss & Gain | Chart.js floating-bar technique (Chart.js tidak punya tipe waterfall native — dibangun dari bar dataset `[start, end]` per kategori). Kategori berurutan: **Plan → PA impact → UA impact → Other Fleet → Actual**. Warna: hijau/biru = positif, merah/oranye = negatif. Tooltip: nilai ton, rumus yang dipakai, sumber data, status rekonsiliasi (✅/⚠️) |

---

## 3. Mesin Kalkulasi (Calculation Engine)

### Langkah 1 — Resolve konteks
Dari filter aktif: `{pit, job, tanggalMulai, tanggalSelesai}` → resolve daftar unit loader yang di-assign ke Job tersebut di Fleet Capacity.

### Langkah 2 — Plan (poin 7a)
```
Plan(ton) = ambil dari Fleet Capacity / Production Planning
            filter by {pit, job, periode}
            (khusus job FOT: data belum tersedia → tampilkan "N/A", bukan 0)
```

### Langkah 3 — PA Plan & UA Plan (bagian dari 7b/7c)
```
PA_Plan(%), UA_Plan(%) = getValue() dari halaman 0.4 PA/UA/EWH
                          filter {job, periode}
```

### Langkah 4 — PA Aktual & UA Aktual (formula sesuai brief user)
```
HM_total, Standby_total, Breakdown_total =
    SUM per unit-loader-terassign,
    diambil dari halaman 1 (Input Data), 3 (Breakdown), 4 (Standby)
    filter {pit, job, periode}

PA_Aktual (%) = (HM_total + Standby_total) / (HM_total + Standby_total + Breakdown_total)
UA_Aktual (%) = HM_total / (HM_total + Standby_total)
```

### Langkah 5 — Dampak PA & UA (rumus resmi dari PDF bab 3)
```
ΔPA = N × SH × (PA_Aktual − PA_Plan) × UA_Plan × Prod_Plan
ΔUA = N × SH × PA_Aktual × (UA_Aktual − UA_Plan) × Prod_Plan
```
> ⚠️ **Catatan penting**: rumus ini butuh `N` (jumlah unit), `SH` (schedule hour), dan `Prod_Plan` (produktivitas rencana ton/jam) sebagai input eksplisit. Sumber pastinya **belum ditentukan** di brief — kemungkinan `N` & `SH` dari Fleet Capacity, `Prod_Plan` dari halaman 0.5/0.6 (OB/Coal Productivity Planning). Lihat Pertanyaan Terbuka #1.

### Langkah 6 — Other Fleet (poin 7d)
```
OtherFleet(ton) = SUM produksi unit excavator DI LUAR assignment Fleet Capacity
                  filter {pit, job, periode}, dari halaman 1 (Input Data)
```

### Langkah 7 — Aktual (poin 7e)
```
Aktual(ton) = SUM produksi unit-loader-terassign di Fleet Capacity
              filter {pit, job, periode}, dari halaman 1 (Input Data)
```

### Langkah 8 — Rekonsiliasi (validasi silang)
```
Cek: Plan + ΔPA + ΔUA + OtherFleet ≈ Aktual   (toleransi pembulatan kecil, sesuai PDF bab 8)
```
> Karena poin 7d & 7e dihitung **langsung** dari data mentah, sementara ΔPA/ΔUA dihitung **terpisah** lewat rumus formal, ada risiko selisih jika ada kesalahan kategori unit. Badge ✅/⚠️ di tooltip **wajib ada**, bukan opsional.

---

## 4. Urutan Pengerjaan (Staged Development)

1. **Tahap Data Layer** — bangun & uji fungsi agregasi baru (Langkah 1–4, 6–7), lepas dari UI. Validasi manual dengan 1 contoh Pit+Job+tanggal nyata sebelum lanjut.
2. **Tahap Filter Shell** — bangun UI poin 1–5 (judul, slicer, teks periode, tombol Pit/Job hide-show) dengan data dummy dulu. Pastikan auto-generate Pit & Job sudah benar dari master data.
3. **Tahap Chart Pencapaian** (poin 6) — sambungkan ke data layer tahap 1. Lebih sederhana (2 series: Plan vs Actual).
4. **Tahap Chart Waterfall** (poin 7) — paling kompleks, dikerjakan terakhir setelah semua sumber data di tahap 1 terverifikasi akurat.
5. **Tahap Rekonsiliasi & Polish** — indikator validasi, tooltip rumus, penempatan tab final + renumbering sidebar.

---

## 5. Pertanyaan Terbuka (jawab sebelum/selama coding)

1. Sumber `N`, `SH`, `Prod_Plan` untuk rumus ΔPA/ΔUA (Langkah 5) — dari Fleet Capacity + halaman mana persisnya?
2. Penomoran tab baru di sidebar: nomor baru (`13`) di paling bawah, atau disisipkan jadi `2` dengan semua nomor setelahnya digeser?
3. Kalau rentang tanggal slicer melewati batas bulan (misal Plan hanya tersedia per-bulan di Fleet Capacity), bagaimana pro-rate Plan-nya — dibagi rata per hari, atau ambil bulan penuh yang overlap?

---

## 6. Referensi Fungsi Existing yang Bisa Dipakai Ulang

| File | Fungsi | Kegunaan untuk halaman ini |
|---|---|---|
| `fleetCapacity.core.js` | `summarizePitValues()` | Agregasi nilai per pit |
| `fleetCapacity.core.js` | `calculateCheckedProduction()` | Hitung produksi tervalidasi per fleet |
| `fleetCapacity.core.js` | `deduplicateFleetPlans()` | Hindari double-count plan |
| `paUaEwh.core.js` | `getValue(metric, unit, year, month, day)` | Ambil PA/UA/EWH per unit per hari |
| `spo.core.js` | `loadMasterJobs()` | Ambil daftar Job aktif (OB/CG/FOT) untuk generate tombol |

---

## 7. Catatan untuk Sesi Coding (Kimi K3 / VS Code)

- Halaman baru murni **agregasi & visualisasi** — jangan buat tabel/state penyimpanan baru di backend untuk data yang sudah ada di 4 halaman sumber.
- Reuse fungsi di atas dulu sebelum menulis fungsi agregasi baru dari nol.
- Chart.js sudah dipakai di `production.js` (lihat pola `new Chart(ctx, {...})` untuk pareto & pie chart) — ikuti pola styling yang sama untuk konsistensi visual.
- Selesaikan Pertanyaan Terbuka #1–3 di atas dulu sebelum mulai Tahap 3 (Chart Waterfall), karena itu bagian paling rawan salah kalau sumber datanya keliru.
