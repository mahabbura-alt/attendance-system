# Rencana Implementasi FINAL — Halaman "Review Produksi"

**Project:** OMOS — Admin Dashboard
**Modul sumber:** Fleet Capacity (0.8), PA/UA & EWH (0.4), SPO (0.3), Input Data (1, HM), **Input Ritase (5, produksi Other Fleet & Aktual)**, Breakdown (3), Standby (4), Productivity Planning (0.5/0.6)
**Referensi konsep:** `panduan_waterfall_produksi_tambang_batubara.pdf`
**Supersedes:** `rencana_implementasi_review_produksi.md` (draft)
**Status:** FINAL — keputusan terkunci, siap coding
**Revisi 2026-09-18:** poin **7d (Other Fleet)** & **7e (Aktual)** — sumber produksi = **Input Ritase (page 5)**, bukan Input Data (page 1). Kriteria logika tidak berubah. Implementasi endpoint memang sudah memakai `ritase_logs` × `truck_factors` (bukan `mining_production_logs`).

---

## 0. Keputusan Terkunci (dari konfirmasi owner)

| # | Keputusan |
| --- | --- |
| D1 | **Other Fleet** = produksi unit excavator **di luar plotting** Fleet Capacity. Diukur langsung dari **Input Ritase (page 5)**. Tidak ada PA/UA untuk unit ini. |
| D2 | **Basis jam** = **EWH (plan)** dari page 0.4 dan **HM (aktual)** dari Input Data. Bukan "SH". |
| D3 | **Satuan** = native per job: OB → BCM, Coal Getting → Ton. Waterfall multi-job ditampilkan per-job (tidak dicampur). |
| D4 | **Formula waterfall** = rekomendasi EWH/HM (ekuivalen PDF bab 3). |
| D5 | **Prod_plan** diambil dari **Productivity Planning OB/Coal** (page 0.5/0.6), per job/material. |
| D6 | **FOT** sementara tampil "Plan belum tersedia" (Fleet Capacity belum terhubung SPO Job; assignment PA baru OB & CG). |
| D7 | Halaman murni **read-only aggregation** — tidak membuat tabel/state penyimpanan baru di backend. |

---

## 1. Data Lineage (terverifikasi di codebase)

| Kebutuhan | Sumber (verified) |
| --- | --- |
| HM (working hours aktual) | `mining_production_logs.total_hm` (per unit, per tanggal) |
| Standby (S) | `standby_logs` + `standby_shift_closures` |
| Breakdown/repair (R) | `breakdown_logs.total_breakdown_hours` |
| EWH/PA/UA plan | plan `pa-ua-ewh` (`state.values[metric][unit][year:month:day]`) — `paUaEwh.core.js:getValue` |
| **JOB per unit loader** | **assignments PA plan `pa-ua-ewh`** → `jobOfUnit(unit) = paAssignments[unitKey(unit)]` (`fleetCapacity.core.js:40`); `plan.job = plan.jobCode \|\| jobOfUnit(plan.loaderUnit)` |
| Plan produksi | Fleet Capacity / Production Planning (page 0.8) |
| Pit area | `equipment.lokasi` |
| Master JOB | SPO via `loadMasterJobs()` → `GET /api/admin/production/master` (`jobCodes`) |
| Produksi **Other Fleet & Aktual** (7d & 7e) | **Input Ritase (page 5)**: `fleet_mappings` + `ritase_logs.ritase_count` × `truck_factors.factor_value` |

**Fungsi existing untuk dipakai ulang:** `summarizePitValues()`, `deduplicateFleetPlans()`, `calculateCheckedProduction()` (fleetCapacity.core.js); `getValue()` (paUaEwh.core.js); `loadMasterJobs()` (spo.core.js).

**Gap yang dibangun baru:**
1. Agregasi `HM + Standby + Breakdown` per Pit+Job+periode untuk subset unit fleet-capacity.
2. Pemisahan produksi unit fleet-capacity vs unit di luar plotting.

---

## 2. Formula (terkonfirmasi)

```
W = HM (aktual)        S = Standby        R = Breakdown
SH          = W + S + R
PA_aktual   = (HM + Standby) / (HM + Standby + Breakdown)
UA_aktual   = HM / (HM + Standby)

N           = jumlah unit loader fleet-capacity untuk job
EWH_plan    = page 0.4 (per unit/hari)
PA_plan, UA_plan = page 0.4 (per unit/hari)
Prod_plan   = Productivity Planning OB/Coal (per job/material)

PPlan        = N × EWH_plan × Prod_plan
ΔPPA         = PPlan × (PA_aktual − PA_plan) / PA_plan
ΔPUA         = PPlan × (PA_aktual / PA_plan) × (UA_aktual − UA_plan) / UA_plan
OtherFleet   = Σ produksi unit di luar plotting (terukur langsung)
Aktual(fleet)= Σ produksi unit fleet-capacity (terukur langsung)
Rekonsiliasi = PPlan + ΔPPA + ΔPUA  vs  Aktual(fleet)  → badge ✅/⚠️
```

Urutan: PA dulu, lalu UA dengan PA_aktual sebagai basis (PDF bab 3) — agar tidak double-count.
Retensi presisi penuh untuk intermediate; pembulatan hanya di display.

---

## 3. Spesifikasi Komponen UI (top-to-bottom)

| # | Komponen | Perilaku |
| --- | --- | --- |
| 1 | Judul "Review Performa Produksi" | `<h2>`, konsisten header halaman lain |
| 2 | Slicer range periode | Dua date input (dari–sampai). Default pertama = **hari berjalan −1** (H−1 s.d. H−1). Simpan pilihan terakhir |
| 3 | Teks "tanggal periode terpilih" | `color:#000; font-weight:700`. Format: `Periode: 17 Sep 2026 – 17 Sep 2026`. Update reaktif |
| 4 | Tombol Pit Area | Auto-generate dari `equipment.lokasi` (contoh: BEI, DKC). Toggle hide/show (`aria-pressed`) |
| 5 | Tombol JOB | Auto-generate dari `loadMasterJobs()` → OB, CG, FOT. Toggle hide/show; hanya expand bila Pit dipilih |
| 6 | Grafik Pencapaian Produksi | Chart.js Bar/Line: Plan vs Aktual per Pit+Job + label ton & %achievement. Warna konsisten Executive Dashboard |
| 7 | Grafik Waterfall Loss & Gain | Chart.js floating-bar: Plan → ΔPPA → ΔPUA → OtherFleet → Aktual. Hijau/biru positif, merah/oranye negatif. Tooltip: nilai ton, rumus, sumber data, badge rekonsiliasi |

Penempatan tab: **setelah "Data Produksi"**. FOT → label "Plan belum tersedia".

---

## 4. Rencana Implementasi Bertahap

### Tahap 1 — Data layer (backend)
- Endpoint baru: `GET /api/admin/production/review-produksi?tanggal_dari&tanggal_sampai&pit&job`
- Return per Pit+Job: daftar unit loader fleet-capacity; `hm_total`, `standby_total`, `breakdown_total`; EWH/PA/UA plan agregat (weighted); plan produksi; produksi fleet; produksi non-fleet.
- Reuse fungsi existing; agregasi baru terpisah & teruji.
- File: `backend/src/controllers/production.controller.js`, `backend/src/routes/production.routes.js`.

### Tahap 2 — Core calc (murni + tes)
- `reviewProduksi.core.js`: `hitungPAAktual`, `hitungUAAktual`, `hitungPPlan`, `hitungDppa`, `hitungDpua`, `hitungOtherFleet`, `cekRekonsiliasi`.
- Tes: `reviewProduksi.core.test.js` (kasus PDF bab 4 sebagai golden case + kasus batas).

### Tahap 3 — Filter shell UI
- `reviewProduksi.js`: judul, slicer, teks periode (hitam bold), tombol Pit & JOB (hide/show), state filter.
- `index.html` + `app.js`: sisipkan tab setelah "Data Produksi"; muat modul.
- Auto-generate Pit dari `equipment.lokasi`, JOB dari `loadMasterJobs()`.

### Tahap 4 — Grafik Pencapaian Produksi
- Chart.js Plan vs Aktual + %achievement; sambungkan ke Tahap 1.

### Tahap 5 — Grafik Waterfall
- Chart.js floating-bar (dataset `[start,end]` per kategori); warna positif/negatif; tooltip rumus + sumber + badge rekonsiliasi.

### Tahap 6 — Polish + review browser
- Badge rekonsiliasi; penempatan tab final; verifikasi visual + console (wajib sebelum deploy).

---

## 5. Rencana Verifikasi

1. `node --test backend/test/review-produksi*.test.js` + `admin-dashboard/reviewProduksi.core.test.js` (golden case PDF: PPlan 37.800; ΔPPA −2.100; ΔPUA −2.550).
2. Validasi manual 1 Pit+Job+tanggal nyata vs data halaman sumber.
3. `npm test` backend (131 tes) tetap lolos.
4. Review browser: tab muncul setelah Data Produksi; slicer default H−1; teks periode hitam bold; toggle Pit/JOB; chart render tanpa console error.

---

## 6. Risiko & Catatan

- **Rekonsiliasi tidak dijamin** karena OtherFleet & Aktual diukur langsung (bukan residual) → badge ✅/⚠️ wajib ditampilkan, bukan opsional.
- **JOB mapping** bergantung pada assignments PA (page 0.4). Jika assignment unit belum diisi, unit tidak terhitung ke job mana pun → tampilkan peringatan.
- **EWH/PA/UA plan per unit/hari** → agregasi job perlu rata-rata berbobot (bukan rata-rata sederhana).
- **Satuan**: jangan mencampur BCM (OB) dan Ton (Coal). Multi-job → tampilkan per-job terpisah.
- **FOT** belum ada Plan → "Plan belum tersedia".

---

## 7. Pertanyaan yang Sudah Dijawab
- OtherFleet & Aktual → D1 (diukur langsung).
- Sumber N/SH/Prod_plan → D2 (EWH/HM) + D5 (Productivity Planning).
- Satuan multi-job → D3.
- Formula waterfall → D4.
