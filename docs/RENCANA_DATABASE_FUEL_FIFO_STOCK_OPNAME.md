# Rencana Implementasi Database Fuel OMOS

Status: **PROPOSED — belum diimplementasikan**  
Modul sumber: **2. Input Fuel**  
Fitur baru: **Database Fuel**  
Dokumen terkait: `docs/INPUT_FUEL_CARD_REDESIGN.md`

## 1. Ringkasan Keputusan Arsitektur

Database Fuel direkomendasikan menjadi workspace inventory yang dibuka melalui
tombol **Database Fuel** di bagian atas halaman Input Fuel. Workspace ini bukan
modal karena ledger, FIFO, stock opname, dan analitik membutuhkan ruang kerja,
filter, serta tabel yang lebar.

Pembagian sumber data harus tegas:

- `fuel_logs` tetap menjadi sumber pengisian/konsumsi unit, counter HM/KM,
  `L/HM`, dan `L/Km`.
- Inventory Fuel menjadi sumber pergerakan stok, saldo per lokasi/tank, batch
  penerimaan, FIFO, nilai persediaan, transfer, dan stock opname.
- Keduanya dihubungkan melalui referensi `fuel_log_id`; angka Fuel tidak boleh
  diinput ulang pada dua tempat.
- Semua kuantitas inventory menggunakan **Liter** sebagai satuan dasar.
- Rasio konsumsi tetap memakai aturan Input Fuel yang sudah berlaku dan tidak
  dihitung ulang oleh inventory.

Database Fuel tidak boleh dibentuk hanya dari `fuel_logs`, karena data eksisting
belum memiliki penerimaan Fuel, sumber tank, batch, transfer internal, atau
hasil stock opname.

## 2. Tujuan

1. Menyediakan satu sumber kebenaran untuk persediaan Fuel per lokasi.
2. Merekonsiliasi Fuel masuk, keluar, transfer, return, loss, dan adjustment.
3. Mengalokasikan Fuel keluar menggunakan FIFO yang transparan dan auditable.
4. Menghubungkan pengisian unit dari Input Fuel dengan pengurangan stok.
5. Menyediakan stock opname tanpa menimpa histori ledger.
6. Menampilkan tren penggunaan, saldo, variance, dan days of stock.
7. Menjaga histori transaksi posted tetap immutable dan dapat diaudit.
8. Menyediakan jalur pengembangan untuk multi-client, multi-project,
   multi-area, dan operasi offline/degraded.

## 3. Batasan dan Definisi

### 3.1 Kuantitas dan satuan

- Kuantitas dasar inventory: **Liter**.
- Penyimpanan database disarankan `NUMERIC(16,3)` Liter.
- Perhitungan memakai presisi penuh; pembulatan hanya pada tampilan.
- Nilai uang, bila digunakan, disarankan `NUMERIC(18,4)` per Liter dan
  `NUMERIC(20,4)` untuk total nilai.
- Jangan mencampur Liter inventory dengan `L/HM`, `L/Km`, BCM, atau Ton.

### 3.2 Waktu

Setiap transaksi menyimpan:

- `operational_date` untuk hari operasional site.
- `transaction_at` sebagai timestamp aktual dengan zona waktu.
- `shift_id` bila transaksi terkait shift.
- `posted_at` untuk waktu pembukuan.

FIFO harus memakai `transaction_at`/urutan penerimaan aktual, bukan hanya
tanggal kalender.

### 3.3 Status transaksi

- `draft`: masih dapat diedit dan belum memengaruhi saldo.
- `posted`: memengaruhi saldo dan tidak dapat diedit/hapus langsung.
- `reversed`: dibatalkan melalui transaksi reversal, bukan hard-delete.
- `void`: hanya untuk draft yang dibatalkan sebelum posting.

### 3.4 Sumber transaksi

- `manual`
- `input_fuel`
- `import`
- `mobile_offline`
- `integration`
- `stock_opname`
- `system_reversal`

## 4. Mode Tampilan yang Direkomendasikan

### 4.1 Navigasi

Di header halaman Input Fuel:

`[ Database Fuel ] [ Export ] [ Import ] [ Hapus ] [ Undo ] [ Redo ] [ Simpan ]`

Tombol Database Fuel membuka workspace penuh dengan breadcrumb:

`Input Fuel / Database Fuel`

Workspace menyediakan tombol **Kembali ke Input Fuel** dan lima tab utama.

### 4.2 Tab Overview

Kartu highlight:

1. Stock Buku Saat Ini — Liter.
2. Fuel Masuk dalam periode.
3. Fuel Keluar dalam periode.
4. Stock Fisik terakhir.
5. Selisih Stock Opname.
6. Average Daily Usage.
7. Estimasi Days of Stock.
8. Jumlah alert yang memerlukan tindakan.

Grafik:

- Tren saldo harian.
- Fuel masuk vs Fuel keluar.
- Konsumsi per PIT/Area.
- Konsumsi per class unit.
- Pergerakan variance stock opname.

Panel alert:

- Stock di bawah minimum.
- Saldo negatif atau berpotensi negatif.
- Transaksi draft terlalu lama.
- Pengisian unit belum memperoleh sumber lokasi.
- Stock opname belum disetujui.
- Batch FIFO lama atau tidak lengkap.

### 4.3 Tab Ledger Fuel

Kolom minimum:

| Waktu | Nomor Dokumen | Lokasi/Tank | Jenis | Masuk | Keluar | Saldo | Batch FIFO | Tujuan/Unit | Status |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |

Filter:

- Range periode.
- PIT/Area.
- Lokasi/tank.
- Produk Fuel.
- Jenis transaksi.
- Status.
- Sumber transaksi.
- Nomor dokumen, unit, atau operator.

Setiap baris memiliki detail audit dan referensi sumber. Transaksi posted hanya
menyediakan **Detail** dan **Reversal**, bukan Edit/Hapus.

### 4.4 Tab FIFO & Stock

Tabel layer FIFO per lokasi:

| Batch | Tanggal Masuk | Supplier | Volume Awal | Sisa Volume | Harga/L | Nilai Stock | Umur |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |

Batch dengan penerimaan paling awal tampil paling atas. Detail transaksi keluar
menampilkan komposisi alokasinya, contoh:

`300 L keluar = 100 L Batch A + 200 L Batch B`

Kartu ringkasan per tank:

- Kapasitas maksimum.
- Saldo buku.
- Persentase isi.
- Minimum stock.
- Reserved quantity bila digunakan.
- Nilai inventory.

### 4.5 Tab Stock Opname

Kolom/form:

- Waktu pengukuran.
- Area dan lokasi/tank.
- Produk.
- Stock buku pada waktu pengukuran.
- Stock fisik.
- Selisih Liter.
- Persentase variance.
- Metode pengukuran.
- Petugas.
- Catatan dan bukti.
- Status approval.

Stock opname tidak mengubah saldo secara langsung. Setelah disetujui, sistem
membuat transaksi adjustment yang tertaut ke stock opname.

### 4.6 Tab Analytics

- Tren penggunaan harian, mingguan, dan bulanan.
- Receipt vs issue.
- Penggunaan berdasarkan area, class, dan unit.
- Top unit penggunaan Fuel.
- Average Daily Usage.
- Days of Stock.
- Variance stock opname.
- Nilai inventory dan harga penerimaan.
- Fuel ratio dari Data Produksi sebagai panel terpisah, bukan bagian dari saldo.

## 5. Jenis Transaksi Inventory

| Jenis | Dampak | Keterangan |
| --- | --- | --- |
| `opening_balance` | Masuk | Saldo awal saat go-live |
| `receipt` | Masuk | Penerimaan/pembelian dari supplier |
| `issue_equipment` | Keluar | Pengisian Fuel ke unit |
| `transfer_out` | Keluar | Pengiriman dari tank/lokasi asal |
| `transfer_in` | Masuk | Penerimaan di tank/lokasi tujuan |
| `return` | Masuk | Pengembalian Fuel yang valid |
| `loss` | Keluar | Drain, spill, evaporasi, atau kehilangan terverifikasi |
| `opname_adjustment_in` | Masuk | Fisik lebih besar dari buku |
| `opname_adjustment_out` | Keluar | Fisik lebih kecil dari buku |
| `reversal` | Kebalikan | Membalik transaksi posted |

Transfer antar-lokasi harus diposting atomik sebagai pasangan `transfer_out`
dan `transfer_in` dengan satu `transfer_group_id`.

## 6. Struktur Data yang Direkomendasikan

Semua tabel operasional harus mengevaluasi `tenant_id`, `project_id`, dan
`area_id`. Bila Core tenancy belum tersedia pada implementasi sekarang,
gunakan scope kompatibilitas eksplisit dan siapkan kolom/index untuk migrasi,
bukan mempercayai scope yang dikirim frontend.

### 6.1 `fuel_products`

- `id UUID PK`
- `product_code VARCHAR UNIQUE`
- `product_name VARCHAR`
- `base_uom VARCHAR` — dikunci `L`
- `density_kg_l NUMERIC` — nullable, bukan sumber rasio produksi
- `is_active BOOLEAN`
- audit timestamps

### 6.2 `fuel_storage_locations`

- `id UUID PK`
- tenant/project/area scope
- `location_code`
- `location_name`
- `storage_type` — depot, tank, fuel_truck
- `equipment_id` — nullable; diisi bila lokasi adalah Fuel Truck
- `capacity_liter NUMERIC(16,3)`
- `minimum_stock_liter NUMERIC(16,3)`
- `is_active BOOLEAN`
- `version INTEGER`
- audit timestamps

Unique yang disarankan: scope + `location_code`.

### 6.3 `fuel_inventory_transactions`

- `id UUID PK`
- tenant/project scope
- `transaction_number`
- `transaction_type`
- `operational_date`
- `transaction_at TIMESTAMPTZ`
- `shift_id`
- `product_id`
- `source_location_id`
- `destination_location_id`
- `equipment_id`
- `operator_id`
- `fuel_log_id`
- `document_number`
- `supplier_reference`
- `transfer_group_id`
- `status`
- `source_type`
- `reason`
- `idempotency_key`
- `created_by`, `posted_by`, `reversed_by`
- `created_at`, `posted_at`, `reversed_at`
- `reversal_of_transaction_id`
- `version INTEGER`

Constraints:

- `idempotency_key` unik di dalam tenant/project.
- Transaksi keluar wajib memiliki source location.
- Transaksi masuk wajib memiliki destination location.
- `issue_equipment` wajib memiliki `equipment_id`.
- Satu `fuel_log_id` hanya boleh memiliki satu issue aktif/non-reversed.

### 6.4 `fuel_inventory_lines`

- `id UUID PK`
- `transaction_id FK`
- `direction` — in/out
- `quantity_liter NUMERIC(16,3)`
- `unit_price NUMERIC(18,4)` — nullable
- `total_value NUMERIC(20,4)` — derived/snapshot
- `batch_number`
- `source_reference`
- audit timestamps

Quantity harus lebih besar dari nol. Jangan menyimpan keluar sebagai angka
negatif; arah pergerakan ditentukan oleh `direction`.

### 6.5 `fuel_fifo_layers`

- `id UUID PK`
- `receipt_line_id FK`
- `location_id FK`
- `product_id FK`
- `received_at`
- `initial_quantity NUMERIC(16,3)`
- `remaining_quantity NUMERIC(16,3)`
- `unit_cost NUMERIC(18,4)`
- `batch_number`
- `quality_expiry_at` — nullable
- `status` — open, exhausted, reversed
- `version INTEGER`

Index FIFO: location + product + status + received_at + id.

### 6.6 `fuel_fifo_allocations`

- `id UUID PK`
- `outbound_line_id FK`
- `fifo_layer_id FK`
- `allocated_quantity NUMERIC(16,3)`
- `unit_cost_snapshot NUMERIC(18,4)`
- `allocated_value NUMERIC(20,4)`
- audit timestamp

Unique: outbound line + FIFO layer. Jumlah alokasi wajib sama dengan quantity
transaksi keluar yang diposting.

### 6.7 `fuel_stock_opnames`

- `id UUID PK`
- tenant/project/area scope
- `location_id`, `product_id`
- `counted_at TIMESTAMPTZ`
- `book_quantity_snapshot NUMERIC(16,3)`
- `physical_quantity NUMERIC(16,3)`
- `variance_quantity NUMERIC(16,3)`
- `variance_percent NUMERIC(12,6)` — nullable bila book quantity nol
- `measurement_method`
- `evidence_url`
- `note`
- `status` — draft, submitted, approved, rejected, adjusted
- `counted_by`, `approved_by`
- `adjustment_transaction_id`
- `version INTEGER`
- audit timestamps

### 6.8 `fuel_inventory_audit`

- `id UUID PK`
- `entity_type`
- `entity_id`
- `action`
- `before_data JSONB`
- `after_data JSONB`
- `reason`
- tenant/project scope
- `actor_id`
- `origin_device_id`
- `sync_operation_id`
- `changed_at`

### 6.9 `fuel_daily_balance_snapshots` — opsional

Tabel ini hanya cache laporan, bukan sumber kebenaran:

- scope lokasi/produk/tanggal
- opening, receipts, issues, transfers, adjustments, closing
- inventory value
- calculated_at dan formula version

Saldo authoritative tetap berasal dari transaksi posted.

## 7. Integrasi dengan Input Fuel

Alur target:

```text
Fuel receipt ke tank
  → membentuk FIFO layer
  → Fuel dipindahkan ke Fuel Truck bila diperlukan
  → Input Fuel mencatat dispensing ke unit
  → issue_equipment dibuat dan ditautkan ke fuel_log
  → FIFO mengurangi layer tertua pada lokasi sumber
  → ledger, saldo, dan chart diperbarui
```

### 7.1 Resolusi lokasi sumber

Input Fuel saat ini belum menjadi bukti lokasi/tank sumber. Sistem tidak boleh
menebak sumber stock. Gunakan salah satu mekanisme berikut:

1. Mapping default area/shift ke lokasi aktif, bila hasilnya tunggal.
2. Mapping Fuel Truck/operator ke `fuel_storage_location`.
3. Dropdown lokasi sumber pada Input Fuel.
4. Jika ambigu, kirim ke **Antrian Alokasi Sumber Fuel** dan jangan posting
   inventory sampai user menentukan sumbernya.

Rekomendasi: gunakan mapping otomatis bila unik, kemudian fallback ke antrean.

### 7.2 Perubahan data Input Fuel

- `fuel_log` baru belum otomatis mengurangi stock sebelum lokasi sumber valid.
- Setelah valid, sistem membuat issue dengan idempotency key stabil.
- Edit draft memperbarui draft issue.
- Koreksi setelah posted membuat reversal dan issue baru.
- Soft-delete fuel log membuat reversal inventory bila issue sudah posted.
- Retry tidak boleh membuat issue ganda.

### 7.3 Fuel Truck sebagai inventory location

Fuel Truck diperlakukan sebagai lokasi bergerak:

- Depot → Fuel Truck = transfer.
- Fuel Truck → Unit = issue.
- Stock Fuel Truck dapat di-stock-opname terpisah.

Dengan cara ini stock depot tidak dikurangi dua kali dan saldo Fuel Truck tetap
dapat direkonsiliasi.

## 8. Aturan FIFO

1. FIFO hanya menggunakan layer `open` di lokasi dan produk yang sama.
2. Urutan: `received_at`, kemudian `id` sebagai deterministic tie-breaker.
3. Posting outbound dan alokasi FIFO berlangsung dalam satu transaksi database.
4. Layer dikunci `FOR UPDATE` untuk mencegah dua proses memakai saldo yang sama.
5. Default: blokir negative stock.
6. Emergency override, bila disetujui owner, wajib memiliki permission, alasan,
   audit, dan status rekonsiliasi.
7. Reversal outbound mengembalikan quantity ke layer asal berdasarkan allocation,
   bukan membuat layer acak baru.
8. Transfer keluar mengonsumsi FIFO asal; transfer masuk membuat layer baru yang
   membawa cost snapshot hasil FIFO asal.
9. Stock opname adjustment-in membutuhkan keputusan cost policy yang eksplisit.
10. Tidak boleh menghitung average price sebagai pengganti FIFO.

## 9. Formula Ringkasan

Seluruh formula memakai transaksi `posted` dan tidak `reversed`.

```text
Closing Stock = Opening + Receipt + Transfer In + Return
                + Adjustment In
                - Issue - Transfer Out - Loss - Adjustment Out
```

```text
Average Daily Usage = Total Issue Equipment / jumlah hari basis
Days of Stock       = Closing Stock / Average Daily Usage
```

Basis hari untuk Average Daily Usage harus dipilih saat implementasi:

- hari kalender dalam periode; atau
- hari yang memiliki aktivitas.

Rekomendasi: gunakan hari kalender operasional dengan label basis yang terlihat.
Jangan menampilkan Days of Stock bila Average Daily Usage nol/tidak tersedia.

```text
Variance Opname = Physical Stock - Book Stock Snapshot
Variance %      = Variance / Book Stock Snapshot × 100%
```

Variance % harus `NULL/—` bila book stock nol.

## 10. Workflow dan Hak Akses

Role/permission yang disarankan:

- `fuel.inventory.view`
- `fuel.inventory.create_draft`
- `fuel.inventory.post`
- `fuel.inventory.reverse`
- `fuel.opname.count`
- `fuel.opname.approve`
- `fuel.inventory.export`
- `fuel.inventory.configure`

Maker-checker:

- Petugas yang membuat stock opname tidak menyetujui opname yang sama.
- User yang membuat adjustment material tidak menyetujui postingnya sendiri,
  bila organisasi mengaktifkan approval.
- Scope tenant/project/area harus divalidasi backend dari identity/session.

## 11. Offline, Retry, dan Sinkronisasi

- Gunakan UUID client-generated untuk draft lapangan.
- Gunakan `idempotency_key` stabil untuk setiap operasi.
- Draft dapat disimpan lokal saat offline.
- Posting FIFO memerlukan otoritas server/edge node yang memiliki ledger terkini.
- Bila stock berubah sebelum sync, transaksi masuk antrean konflik dan tidak
  diam-diam mengganti saldo.
- Simpan `device_id`, `client_created_at`, `server_received_at`, dan version.
- Tampilkan status: Local Draft, Queued, Synced, Conflict, Rejected.
- Sync dan backup diperlakukan sebagai proses terpisah.

## 12. Urutan Rencana Pengerjaan

### P0 — Discovery dan keputusan domain

Tujuan: mengunci kontrak bisnis sebelum membuat schema.

1. Inventarisasi `fuel_logs`, import/export, audit, Data Produksi, payroll/HM,
   dan seluruh consumer Fuel.
2. Petakan lokasi sumber Fuel aktual: depot, tank, dan Fuel Truck.
3. Tentukan apakah transaksi mencatat Liter observed atau standard/temperature
   compensated. Jangan mencampur keduanya.
4. Tentukan apakah FIFO hanya volume atau juga costing.
5. Tentukan currency, precision cost, dan kebijakan adjustment-in cost.
6. Tentukan kebijakan negative stock dan emergency override.
7. Tentukan periode cutover dan opening balance per lokasi.
8. Tentukan role/approval serta threshold variance opname.
9. Dokumentasikan source-of-truth dan data lineage.

Output P0:

- Decision record disetujui.
- Data mapping eksisting.
- Acceptance criteria final.
- Tidak ada perubahan database.

### P1 — Fondasi master dan ledger

1. Tambahkan migration tabel produk, lokasi, transaksi, line, dan audit.
2. Tambahkan constraint, FK, tenant/project boundary, dan index.
3. Buat service domain untuk validasi transaksi dan saldo.
4. Buat nomor transaksi yang aman dari race.
5. Implement draft, post, reversal, dan idempotency.
6. Implement opening balance terkontrol.
7. Tambahkan API master lokasi dan ledger.
8. Tambahkan unit tests normal, invalid, unauthorized, tenant isolation,
   retry, duplicate, dan concurrency.

Exit criteria P1:

- Ledger dapat merekonsiliasi saldo secara deterministik.
- Posted transaction immutable.
- Reversal menjaga audit.
- Belum terhubung otomatis ke Input Fuel.

### P2 — Integrasi Input Fuel

1. Tambahkan mapping area/shift/Fuel Truck ke lokasi sumber.
2. Tambahkan `fuel_log_id` dan unique active linkage.
3. Buat antrian alokasi sumber bila mapping ambigu.
4. Hubungkan create/update/delete Input Fuel ke draft/reversal inventory.
5. Terapkan idempotency untuk retry/save ganda.
6. Pastikan konsumsi unit dan rasio eksisting tidak berubah.
7. Tambahkan rekonsiliasi Fuel log tanpa issue dan issue tanpa Fuel log.
8. Uji alur depot → Fuel Truck → unit.

Exit criteria P2:

- Satu Input Fuel menghasilkan maksimal satu issue aktif.
- Tidak ada pengurangan stok ganda.
- Data ambigu tidak memakai lokasi hasil tebakan.

### P3 — FIFO dan transfer

1. Tambahkan migration FIFO layer dan allocation.
2. Implement posting receipt menjadi FIFO layer.
3. Implement allocator FIFO dengan database row lock.
4. Implement transfer atomik keluar/masuk.
5. Implement reversal yang mengembalikan layer asal.
6. Blokir stock negatif sesuai kebijakan.
7. Tambahkan tampilan FIFO & Stock serta detail alokasi.
8. Uji partial layer, multi-layer, transfer, reversal, retry, dan concurrent
   outbound.

Exit criteria P3:

- Jumlah allocation sama dengan outbound.
- Saldo layer sama dengan saldo ledger.
- Cost/volume traceable ke receipt asal.

### P4 — Stock opname

1. Tambahkan migration dan service stock opname.
2. Capture book stock snapshot pada waktu opname.
3. Implement draft, submit, approve, reject.
4. Buat adjustment otomatis setelah approval.
5. Terapkan maker-checker dan evidence.
6. Tambahkan variance alert dan history.
7. Uji book zero, positive/negative variance, concurrent transaction, dan
   approval conflict.

Exit criteria P4:

- Opname tidak pernah menimpa ledger lama.
- Adjustment memiliki referensi opname dan audit lengkap.

### P5 — Workspace UI, dashboard, dan analytics

1. Tambahkan tombol Database Fuel di header Input Fuel.
2. Bangun workspace Overview, Ledger, FIFO & Stock, Stock Opname, Analytics.
3. Tambahkan filter range, area, lokasi, produk, status, dan source.
4. Tambahkan KPI cards dan conditional alert.
5. Tambahkan grafik saldo, receipt vs issue, usage, dan variance.
6. Tambahkan pagination/virtual table dan server aggregation.
7. Tambahkan export yang menyertakan filter, waktu, unit, dan formula version.
8. Lakukan desktop/mobile browser review dan console review.

Exit criteria P5:

- UI tidak memuat seluruh ledger ke browser.
- Saldo tabel, KPI, dan chart berasal dari source/filter yang sama.
- Tidak ada body overflow atau console error.

### P6 — Migrasi, rekonsiliasi, dan release

1. Backup dan dry-run migration.
2. Buat opening balance dari stock fisik yang disetujui; jangan menebak dari
   total historis `fuel_logs`.
3. Link Fuel log historis hanya bila sumber lokasi dapat dibuktikan.
4. Data historis ambigu tetap terbaca sebagai konsumsi unit tetapi tidak
   dipaksakan menjadi ledger stock.
5. Jalankan reconciliation report:
   - saldo ledger vs FIFO layer;
   - issue vs Input Fuel;
   - transfer out vs transfer in;
   - adjustment vs stock opname.
6. Jalankan backend, dashboard, API, authorization, dan browser E2E tests.
7. Deploy aplikasi dan migration dalam urutan kompatibel.
8. Verifikasi health, logs, saldo awal, transaksi uji, reversal, dan chart.
9. Siapkan rollback aplikasi dan prosedur koreksi ledger, bukan hard-delete.

## 13. Urutan Deployment Aman

1. Deploy schema backward-compatible.
2. Deploy backend endpoint/service baru dalam keadaan feature flag off.
3. Seed master lokasi dan produk.
4. Input serta approve opening balance.
5. Aktifkan Database Fuel untuk admin terbatas.
6. Jalankan rekonsiliasi shadow tanpa mengurangi stock dari Input Fuel.
7. Aktifkan integrasi Input Fuel → inventory per area secara bertahap.
8. Pantau duplicate, negative stock, queue, dan variance.
9. Aktifkan seluruh user setelah hasil pilot sesuai.

## 14. Acceptance Criteria Utama

- Saldo lokasi dapat dijelaskan oleh ledger dari opening hingga closing.
- Fuel keluar memiliki sumber lokasi yang valid.
- FIFO selalu dapat ditelusuri ke batch penerimaan.
- Satu Fuel log tidak menghasilkan issue ganda.
- Transfer tidak mengubah total stock project, hanya memindahkan lokasi.
- Stock opname menghasilkan adjustment terpisah.
- Posted record tidak dapat diedit/hard-delete.
- Reversal mempertahankan audit sebelum/sesudah.
- Tidak ada cross-tenant/cross-project access.
- Retry/offline sync bersifat idempotent.
- KPI dan chart sama dengan hasil query ledger untuk filter yang sama.
- Fuel ratio Input Fuel/Data Produksi tidak berubah akibat inventory feature.

## 15. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Menganggap `fuel_logs` sebagai stok | Saldo awal dan saldo tank salah | Gunakan opening balance fisik dan ledger baru |
| Sumber tank tidak tersedia di Input Fuel | Stock lokasi yang salah | Mapping unik atau antrian alokasi |
| Save/retry membuat issue ganda | Saldo berkurang dua kali | Idempotency key dan unique `fuel_log_id` |
| Dua issue memakai layer sama | Negative/incorrect FIFO | Transaction + `FOR UPDATE` |
| Edit transaksi posted | Audit dan saldo berubah diam-diam | Reversal-only correction |
| Transfer dicatat satu sisi | Stock project berubah palsu | Atomic transfer pair |
| Opname menimpa saldo | Histori hilang | Approved adjustment transaction |
| Cost policy tidak jelas | Nilai inventory tidak sah | Decision gate sebelum P1/P3 |
| Offline data terlambat | Urutan FIFO berubah | Queue, conflict, reconciliation |
| Query ledger terlalu besar | UI lambat | Server aggregation, pagination, snapshots |

## 16. Keputusan yang Wajib Dikonfirmasi Sebelum Implementasi

1. Fuel inventory memakai Liter observed atau standard Liter?
2. Apakah FIFO mencakup costing atau hanya volume?
3. Mata uang dan presisi harga.
4. Daftar lokasi/tank/Fuel Truck yang menjadi inventory location.
5. Kebijakan negative stock dan siapa yang dapat override.
6. Basis Average Daily Usage: kalender atau hari aktivitas.
7. Threshold alert variance stock opname.
8. Approval chain receipt, reversal, dan stock opname.
9. Tanggal cutover serta opening balance yang disetujui.

Dokumen ini menjadi panduan implementasi. Repository tetap menjadi sumber
kebenaran implementasi aktual, dan setiap fase harus memperbarui handover OMOS
dengan bukti migration, test, browser review, dan status deployment.
