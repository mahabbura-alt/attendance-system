# 📄 DOKUMEN HANDOVER FITUR: REPORT BREAKDOWN (JPEG)
**One Mining Operating System (OMOS) — Enterprise Mining Intelligence Platform**  
**Tanggal Handover:** 09 September 2026  
**Target Deployment Tool:** VS Code + Roo Code  
**Status QA:** ✅ 100% Passed (Unit Tests & Integration Verified)

---

## 1. 📌 Ringkasan Eksekutif & Tujuan Fitur

Fitur **"Report Breakdown"** menambahkan kapabilitas bagi **Admin, Maintenance Planner, dan Superintendent Tambang** untuk menghasilkan resume visual status breakdown armada unit alat berat dalam format **JPEG Enterprise-Grade (1600px @1.5x scale)** secara instan (1-klik) langsung dari tab **`3. 🛠️ Breakdown (MTBF / MTTR)`**.

### Highlight Utama Dokumen yang Dihasilkan:
1. **Header Perusahaan & Sistem:**
   - Logo resmi **PT. Prima Indojaya Mandiri** (`assets/reports/prima-company-logo.jpg`) di sisi kiri atas.
   - Judul laporan `BREAKDOWN STATUS REPORT` dengan periode aktif & badge `STATUS: REAL-TIME OPERASIONAL`.
   - Identitas brand **OMOS (One Mining, One System)** dengan gradien navy corporate (`#062a53 → #0a447d`).
2. **5 Kartu Ringkasan KPI:**
   - `TOTAL BD` · `AKTIF SAAT INI` · `MTTR RATA-RATA (Jam / BD)` · `MTBF RATA-RATA (Jam Antar BD)` · `CALENDAR PA (%)`.
3. **Zona A — 🔴 Unit Breakdown Aktif:**
   - Tabel detail unit dalam perbaikan: *No, Kode Unit, Jenis / Tipe, Kategori BD, Mulai BD, Durasi, Status Progres, PIC Mekanik, Outstanding Spare Part / PO*.
   - Baris status *Waiting Part* diberi highlight oranye muda (`#fff7ed`).
   - Unit dengan durasi breakdown $ge 24$ Jam ditandai teks merah tebal dan peringatan `⚠️ >24 Jam Kritis`.
   - Diurutkan otomatis dari durasi downtime terlama ke terpendek.
4. **Zona B & C — Layout Bersebelahan (Side-by-Side 2 Kolom):**
   - **Kolom Kiri (58% Lebar): ✅ Unit Ready to Use (RTU)** — Daftar unit yang telah selesai perbaikan pada periode berjalan, dikelompokkan per kategori alat (*Excavator*, *Dump Truck*, *Support/Lainnya*), menampilkan total jam downtime yang telah dilalui.
   - **Kolom Kanan (42% Lebar): 📊 Top 5 Penyebab Breakdown (Pareto)** — Diagram batang horizontal yang menganalisis 5 kategori kerusakan dengan akumulasi jam downtime terbesar beserta persentase kontribusinya.
5. **Footer:**
   - `System Generated Report • OMOS Breakdown Module` · `Report ID: OMOS-BD-YYYYMMDD-HHMM` · `Generated Timestamp`.

---

## 2. 📁 Daftar Berkas yang Dibuat & Dimodifikasi

| No | File Path | Status | Deskripsi Perubahan |
|---|---|---|---|
| 1 | `admin-dashboard/breakdownReport.js` | **BARU (NEW)** | Module IIFE pengolah data snapshot, generator HTML/CSS inline, render `html2canvas`, dan downloader JPEG. |
| 2 | `admin-dashboard/assets/reports/prima-company-logo.jpg` | **BARU (NEW)** | Aset logo resmi PT. Prima Indojaya Mandiri (sesuai lampiran user). |
| 3 | `admin-dashboard/index.html` | **MODIFIED** | Menambahkan tombol `📄 Report Breakdown` di header tab Breakdown serta penyesuaian term `BD`. |
| 4 | `admin-dashboard/production.loader.js` | **MODIFIED** | Mendaftarkan `breakdownReport.js?v=1` ke pipeline lazy-load modul produksi. |
| 5 | `admin-dashboard/production.js` | **MODIFIED** | Penyesuaian counter badge dan teks label `insiden` menjadi `BD`. |
| 6 | `admin-dashboard/breakdown-report.test.js` | **BARU (NEW)** | Unit test suite (6 skenario pengujian) untuk memastikan stabilitas fitur. |

---

## 3. 🔍 Rincian Perubahan Kode (Code Change Details)

### A. File Baru: `admin-dashboard/breakdownReport.js`
- **Pola Arsitektur:** IIFE (Immediately Invoked Function Expression) yang mengekspos `global.bukaLaporanBreakdown` dan `global.OMOSBreakdownReport`.
- **Fungsi Utama:**
  - `buildReportModel(rawLogs, equipmentList, metrics, year, month)`: Memproses data mentah dari API/cache, memisahkan log aktif vs resolved, mengelompokkan RTU per kelas alat, dan menghitung ranking Pareto 5 besar.
  - `reportMarkup(model)`: Menghasilkan string HTML & CSS inline beresolusi 1600px dengan layout responsive grid.
  - `generateBreakdownJpeg(model)`: Menggunakan `html2canvas` (@1.5x scale) untuk mengonversi DOM ke canvas dan mengunduh blob sebagai `OMOS_Breakdown_Report_YYYY_MM_*.jpg`.
  - `bukaLaporanBreakdown()`: Membuka modal dialog pilihan periode Tahun & Bulan dengan status loading real-time.
- **Dukungan Test:** Menyertakan blok `if (typeof module !== 'undefined' && module.exports)` untuk eksekusi via Node.js test runner.

### B. Modifikasi: `admin-dashboard/index.html`
- Menambahkan tombol aksi pada section `#tab-prodBreakdown`:
```html
<button class="tombol breakdown-history-button" onclick="bukaBreakdownHistory()">📚 Breakdown History</button>
<button class="tombol unit-performance-button" onclick="bukaUnitPerformance()">📈 Unit Performance</button>
<button class="tombol" onclick="bukaLaporanBreakdown()" style="background:#0284c7;color:#fff;font-weight:700;border-color:#0284c7;">📄 Report Breakdown</button>
<button class="tombol tombol--utama" onclick="bukaModalInputBreakdown()">+ Breakdown Baru</button>
```
- Mengganti teks istilah `insiden` menjadi `BD` pada KPI dan header breakdown table.

### C. Modifikasi: `admin-dashboard/production.loader.js`
- Menambahkan `breakdownReport.js?v=1` pada daftar `productionModules`:
```javascript
  const productionModules = [
    'planProductivity.core.js?v=24',
    'spo.core.js?v=51',
    'paUaEwh.core.js?v=19',
    'fuelBudgeting.core.js?v=5',
    'fleetCapacity.core.js?v=15',
    'unitMapping.core.js?v=12',
    'rainfall.core.js?v=3',
    'production.js?v=85',
    'productionData.js?v=1',
    'ritaseReport.js?v=6',
    'breakdownReport.js?v=1',
  ];
```

---

## 4. 🧪 Panduan Verifikasi & Testing di VS Code / Roo Code

Untuk memverifikasi integrasi kode di environment lokal menggunakan terminal VS Code:

### 1. Jalankan Unit Test Otomatis
```bash
# Jalankan test suite khusus fitur Report Breakdown
node --test admin-dashboard/breakdown-report.test.js

# Atau jalankan bersama test suite Report Ritase untuk memastikan tidak ada regresi
node --test admin-dashboard/breakdown-report.test.js admin-dashboard/ritase-report.test.js
```

**Ekspektasi Output:**
```text
✔ buildReportModel correctly splits active vs resolved units and sorts active by downtime descending
✔ buildReportModel groups Ready to Use units by equipment class
✔ buildReportModel calculates Pareto top 5 breakdown causes
✔ reportMarkup generates complete HTML structure with brandings and badges
✔ index.html contains Report Breakdown button wired to bukaLaporanBreakdown()
✔ production.loader.js loads breakdownReport.js
ℹ tests 6 | pass 6 | fail 0
```

### 2. Jalankan Environment Aplikasi
- **Backend API (Port 3000):**
  ```bash
  cd backend
  npm run dev # atau node src/server.js
  ```
- **Frontend Dashboard (Port 8080):**
  Buka server statis di root project atau folder `admin-dashboard` menggunakan Live Server / `npx serve -p 8080`.

### 3. Verifikasi UI & Generate JPEG di Browser
1. Buka browser di `http://localhost:8080` (tekan `Ctrl + F5` untuk hard refresh).
2. Navigasikan ke menu **MINING PRODUCTION** → **`3. 🛠️ Breakdown`**.
3. Pastikan tombol biru **`📄 Report Breakdown`** tampil di baris atas.
4. Klik tombol tersebut, pilih periode Tahun & Bulan, lalu klik **`📥 Download Report JPEG`**.
5. Verifikasi file JPEG yang terunduh:
   - Header memuat logo PT. Prima Indojaya Mandiri dan OMOS.
   - 5 KPI tampil dengan term `TOTAL BD` dan `Jam / BD`.
   - Tabel Unit Breakdown Aktif menampilkan kolom lengkap, status chip part, dan highlight merah jika $ge 24$ jam.
   - Bagian bawah tersusun **bersebelahan (2 kolom)**: Kolom Kiri = Unit Ready to Use per kategori, Kolom Kanan = Top 5 Penyebab Breakdown.

---

## 5. 🛡️ Catatan Deployment & Best Practices

1. **CORS & Asset Loading:**
   File logo perusahaan berada di `assets/reports/prima-company-logo.jpg`. `html2canvas` dikonfigurasi dengan `useCORS: true` untuk memastikan render gambar kanvas tidak mengalami *tainted canvas error*.
2. **Backward Compatibility:**
   Tidak ada perubahan skema database atau penambahan kolom baru di PostgreSQL; fitur membaca endpoint eksisting `GET /api/admin/production/breakdown`.
3. **Session & Filter Sync:**
   Sistem modal secara otomatis membaca nilai `slicerBreakdownTahun` dan `slicerBreakdownBulan` yang sedang aktif di sesi user, sehingga pengguna tidak perlu memilih ulang jika sudah berada pada bulan yang diinginkan.

---
*Dokumen ini dibuat otomatis sebagai panduan serah terima (handover) fitur One Mining Operating System.*
