# Rencana Implementasi Fuel Operations Hub — Role-Based Task Flows

Status: **IMPLEMENTED P0–P4 — selesai 25 Sep 2026 (P5 offline-outbox & P6 pilot ditunda eksplisit)**
Implementasi: `admin-dashboard/fuelOperationsHub.js` (shell 3 mode + wizard
Terima/Transfer/Opname + shift board + control center + lineage + admin
master/mapping/rekon/ledger/export + fallback klasik); backend hanya tambah
kolom `transfer_in/out` di flow-series (aditif). Tanpa migrasi baru.
Modul: **2. Input Fuel → Database Fuel**  
Referensi visual: `admin-dashboard/test-fixtures/fuel-operations-hub-preview.html`  
Referensi domain inventory: `docs/RENCANA_DATABASE_FUEL_FIFO_STOCK_OPNAME.md`

## 1. Ringkasan Keputusan

Database Fuel akan meninggalkan navigasi lima/enam tab datar sebagai pintu
utama dan beralih menjadi **Fuel Operations Hub** berbasis peran dan tugas.

Struktur target terdiri atas tiga mode:

1. **Operasional Hari Ini** — untuk operator lapangan.
2. **Control Center** — untuk admin, supervisor, dan auditor operasional.
3. **Administrasi** — untuk ledger, FIFO, mapping, master data, rekonsiliasi,
   analytics, dan export.

Perubahan ini adalah reorganisasi pengalaman pengguna. Implementasi tahap awal
harus menggunakan API dan aturan transaksi yang sudah tersedia. Formula,
ledger, FIFO, status posting, dan audit tidak boleh dihitung ulang di browser.

## 2. Tujuan

- Mengurangi beban pemahaman operator lapangan.
- Menampilkan aksi berdasarkan pekerjaan pengguna, bukan struktur database.
- Memisahkan pekerjaan operasional dari fungsi audit dan administrasi.
- Mengurangi input salah lokasi, produk, kuantitas, atau jenis transaksi.
- Menjaga transparansi stok melalui drill-down dan data lineage.
- Menyediakan jalur offline/degraded yang tidak menghilangkan input pengguna.
- Mempertahankan integritas ledger, FIFO, maker-checker, dan reversal.
- Tetap mendukung multi-client, multi-project, multi-area, dan multi-location.

## 3. Prinsip UX

### 3.1 Progressive disclosure

Operator hanya melihat istilah operasional:

- Terima Solar.
- Transfer BBM.
- Catat Opname.
- Stok shift.
- Riwayat transaksi pribadi.
- Status sinkronisasi.

Istilah berikut tidak ditampilkan pada mode operator:

- FIFO layer.
- Ledger entry.
- UUID.
- `transfer_group_id`.
- Idempotency key.
- Formula valuasi internal.

Istilah teknis tersebut tetap tersedia untuk admin/auditor pada drill-down.

### 3.2 Server authoritative

- KPI, saldo, ADU, days of stock, FIFO, nilai inventory, dan integrity score
  harus berasal dari API.
- Browser hanya menampilkan hasil dan status yang diberikan backend.
- Browser boleh menghitung preview non-authoritative untuk membantu input,
  tetapi hasilnya wajib diberi label **Estimasi**.
- Nilai posted dan saldo buku tidak boleh dibentuk dari LocalStorage.

### 3.3 Context first

Setiap transaksi selalu memiliki konteks yang terlihat:

- Tenant/project dari sesi pengguna.
- Operational date.
- Shift.
- Lokasi/tank/fuel truck.
- Produk.
- Status online/offline/sinkronisasi.

Tenant dan project harus diturunkan serta divalidasi backend dari identitas
pengguna, bukan dipercaya dari payload frontend.

## 4. Struktur Halaman

### 4.1 Header bersama

Header memuat:

- Judul **Fuel Operations Hub**.
- Tanggal operasional.
- Shift.
- Lokasi aktif.
- Status koneksi dan sinkronisasi.
- Segmented navigation:
  `[Operasional Hari Ini] [Control Center] [Administrasi]`.

Mode yang tidak diizinkan oleh role tidak dirender dan tetap ditolak backend
bila endpoint dipanggil langsung.

### 4.2 Operasional Hari Ini

Komponen utama:

1. Tiga CTA besar:
   - **Terima Solar**.
   - **Transfer BBM**.
   - **Catat Opname**.
2. **Shift Fuel Board**:
   - stock awal;
   - fuel masuk;
   - fuel keluar;
   - transfer masuk/keluar;
   - estimasi stock saat ini;
   - persentase kapasitas;
   - batas reorder.
3. **Tugas Shift**:
   - stock awal tersedia;
   - receipt tercatat;
   - transaksi belum dimapping;
   - opname akhir shift;
   - transaksi yang belum sinkron.
4. **Stok Cepat per Lokasi**.
5. **Notifikasi Penting**.
6. **Riwayat Saya** dengan status Local Draft, Queued, Synced, Conflict,
   Rejected, Menunggu Approval, dan Posted.

### 4.3 Control Center

KPI minimum:

- Total stock.
- Nilai persediaan.
- ADU.
- Days of stock.
- Integrity/readiness score.

Bagian operasional:

- Stock matrix `lokasi × produk`.
- Book stock vs physical stock.
- Variance Liter dan persen.
- Status integritas.
- Action queue untuk variance, approval, mapping, konflik sinkronisasi, dan
  transaksi yang terlalu lama berstatus draft.
- Drill-down data lineage dari opening balance sampai saldo terakhir.

Setiap baris lokasi/produk dapat membuka side panel yang menampilkan:

- urutan transaksi;
- dokumen sumber;
- actor dan waktu;
- FIFO allocation;
- transfer in/out;
- opname dan adjustment;
- reversal;
- status sinkronisasi dan origin device.

### 4.4 Administrasi

Menu lanjutan dikelompokkan menjadi:

- Ledger & FIFO.
- Mapping sumber.
- Antrean rekonsiliasi.
- Master produk/lokasi/tank.
- Analytics.
- Export dan audit log.

Tab eksisting tidak langsung dihapus. Fungsinya dipindahkan secara bertahap ke
menu administrasi agar API dan workflow yang sudah bekerja tetap dapat dipakai.

## 5. Form Wizard Operator

### 5.1 Pola umum

Semua aksi menggunakan tiga langkah:

1. **Konteks** — lokasi, produk, sumber/tujuan bila diperlukan.
2. **Kuantitas & Bukti** — Liter, nomor dokumen, waktu, foto/struk.
3. **Konfirmasi** — ringkasan bahasa alami sebelum dikirim.

Contoh ringkasan:

`Solar B35 2.000 L diterima di Fuel Station BEI.`

### 5.2 Terima Solar

Field minimum:

- lokasi tujuan;
- produk;
- supplier;
- quantity Liter;
- transaction timestamp;
- nomor DO/dokumen;
- unit cost bila role mengizinkan;
- bukti foto;
- catatan.

Hasil mengikuti workflow receipt eksisting: draft → approval/posting sesuai
kebijakan project. Receipt posted membentuk FIFO layer melalui backend.

### 5.3 Transfer BBM

Field minimum:

- lokasi sumber;
- lokasi tujuan;
- produk;
- quantity Liter;
- waktu;
- bukti;
- catatan.

Transfer harus tetap atomik. UI menampilkan satu transaksi operasional, sedangkan
backend membuat pasangan transfer-out dan transfer-in dengan referensi yang sama.

### 5.4 Catat Opname

Field minimum:

- lokasi;
- produk;
- waktu pengukuran;
- physical quantity;
- metode pengukuran;
- foto/bukti;
- catatan.

UI menampilkan book stock sebagai informasi, bukan nilai yang dapat diedit.
Opname tidak mengubah ledger langsung. Adjustment hanya dibuat setelah approval
sesuai maker-checker.

## 6. Navigasi Responsif

### Desktop

- Sidebar OMOS tetap dipertahankan.
- Segmented navigation berada di header workspace.
- Tabel, action queue, dan lineage dapat tampil bersisian.
- Filter lanjutan muncul sebagai toolbar/drawer.

### Mobile

Bottom navigation:

1. Beranda.
2. Aksi.
3. Riwayat.
4. Lainnya.

Ketentuan mobile:

- CTA minimum nyaman disentuh.
- Form satu kolom.
- Tidak ada tabel lebar yang memaksa horizontal scroll.
- Detail ledger ditampilkan sebagai kartu atau drawer.
- Gunakan skeleton loading, bukan layar kosong.
- Draft tidak boleh hilang akibat refresh atau perpindahan halaman.

## 7. Warna dan Status

| Warna | Fungsi |
| --- | --- |
| Hijau `#10B981` | Aman, valid, approved, synced |
| Biru `#2563EB` | Informasi, transfer, proses normal |
| Kuning/amber | Pending, review, menunggu approval |
| Merah `#EF4444` | Konflik, variance di atas batas, rejected |
| Abu-abu | Draft, belum tersedia, nonaktif |

Warna tidak boleh menjadi satu-satunya penanda. Selalu sertakan teks status,
ikon, dan reason code yang dapat dibaca pengguna.

## 8. Pemetaan Fitur Eksisting

| Fitur eksisting | Tujuan baru |
| --- | --- |
| Overview | Shift Fuel Board dan Control Center |
| Ledger | Administrasi → Ledger & FIFO |
| FIFO & Stock | Administrasi → Ledger & FIFO + lineage |
| Stock Opname | CTA Catat Opname + antrean approval |
| Analytics | Administrasi → Analytics |
| Mapping Sumber | Administrasi + action queue |

Tidak ada data yang dimigrasikan hanya karena perubahan navigasi. Perubahan
pertama memakai data dan endpoint eksisting, kemudian API gap ditambahkan secara
backward-compatible.

## 9. Arsitektur Frontend

Komponen yang direkomendasikan:

- `FuelOperationsHubPage`.
- `FuelRoleModeSwitcher`.
- `FuelOperationalHome`.
- `FuelControlCenter`.
- `FuelAdministrationHome`.
- `FuelActionWizard`.
- `ShiftFuelBoard`.
- `FuelTaskQueue`.
- `FuelStockMatrix`.
- `FuelLineageDrawer`.
- `FuelSyncStatus`.

State dibagi tegas:

- **Server state:** query KPI, stock, ledger, approval, mapping, lineage.
- **Form state:** input wizard sementara.
- **Offline draft state:** IndexedDB dan outbox lokal.
- **UI state:** tab aktif, drawer, filter, dan step wizard.

Hindari satu state global besar. Cache harus di-key dengan tenant/project,
operational date, lokasi, produk, filter, dan permission context yang relevan.

## 10. API dan Backend

### 10.1 Tahap reuse

Audit dan gunakan endpoint eksisting untuk:

- receipt;
- transfer;
- stock opname;
- posting/reversal;
- ledger/FIFO;
- mapping sumber;
- analytics.

Frontend tidak boleh mengubah kontrak transaksi hanya untuk menyesuaikan layout.

### 10.2 Endpoint agregasi yang direkomendasikan

Jika endpoint eksisting menimbulkan terlalu banyak request, tambahkan endpoint
read-only teragregasi:

- `GET /fuel/operations/context`
- `GET /fuel/operations/shift-board`
- `GET /fuel/operations/tasks`
- `GET /fuel/control-center/summary`
- `GET /fuel/control-center/stock-matrix`
- `GET /fuel/control-center/lineage`

Nama final mengikuti konvensi repository setelah inspeksi. Endpoint agregasi
tidak menjadi source of truth baru; hasilnya berasal dari service/domain fuel
yang sama dengan ledger.

### 10.3 Mutasi

Mutasi harus:

- authenticated dan authorized;
- tenant/project scoped di backend;
- idempotent;
- memiliki stable operation ID;
- tervalidasi terhadap location/product aktif;
- menyimpan actor, device, timestamps, dan source;
- menghasilkan audit event;
- menolak posted record yang diedit langsung;
- menggunakan reversal untuk koreksi posted transaction.

## 11. Offline dan Sinkronisasi

Offline-ready merupakan fase tersendiri, bukan klaim dari sekadar LocalStorage.

### 11.1 Penyimpanan lokal

Gunakan IndexedDB untuk:

- draft wizard;
- cached master terbatas;
- outbox operasi;
- status retry;
- bukti foto yang belum terunggah;
- server version terakhir yang diketahui.

LocalStorage hanya boleh digunakan untuk preferensi UI ringan.

### 11.2 Status operasi

State minimum:

```text
LOCAL_DRAFT → QUEUED → SYNCING → SYNCED
                          ↘ CONFLICT
                          ↘ REJECTED
```

### 11.3 Aturan sinkronisasi

- Client-generated UUID dan idempotency key stabil.
- Retry dengan exponential backoff.
- Satu operasi tidak boleh membentuk transaksi ganda.
- Posting FIFO hanya dilakukan backend/edge authority.
- Konflik saldo, master, atau versi masuk antrean rekonsiliasi.
- User tidak diberi pesan “tersimpan” bila data hanya tersimpan lokal; gunakan
  teks **Tersimpan di perangkat — belum tersinkron**.
- Sync dan backup merupakan proses berbeda.

## 12. RBAC yang Direkomendasikan

| Persona | Kemampuan utama |
| --- | --- |
| Fuel Operator | membuat draft receipt/transfer/opname, melihat riwayat sendiri |
| Fuel Supervisor | review, approve sesuai policy, melihat shift/location |
| Fuel Admin | posting, reversal, mapping, master, rekonsiliasi |
| Auditor | read-only ledger, FIFO, lineage, audit, export |
| Project Admin | konfigurasi scope, role, threshold, dan workflow |

Permission menggunakan capability existing/yang direncanakan dalam dokumen
inventory. UI hiding bukan pengganti otorisasi backend.

## 13. Performa dan Ketahanan

- Muat data mode aktif saja.
- KPI menggunakan server aggregation.
- Stock matrix memakai pagination atau virtual rendering bila besar.
- Lineage dimuat saat baris dibuka.
- Master lokasi/produk boleh di-cache dengan version/ETag.
- Batasi ukuran foto, kompres di client, dan upload terpisah dari ledger post.
- Tampilkan last updated dan stale indicator.
- Abort request lama ketika filter/context berubah.
- Sediakan retry non-destructive ketika request gagal.

## 14. Urutan Implementasi

### P0 — Discovery dan kontrak UX

1. Audit halaman Database Fuel, komponen, endpoint, dan permission eksisting.
2. Petakan role aktual dan scope lokasi setiap role.
3. Petakan receipt, transfer, opname, approval, posting, reversal, mapping,
   ledger, FIFO, dan analytics.
4. Identifikasi gap antara preview dan API aktual.
5. Kunci terminology serta acceptance criteria dengan user operasional.
6. Pastikan tidak ada formula inventory yang berpindah ke browser.

Output:

- endpoint/permission matrix;
- component map;
- UX decision record;
- daftar gap tanpa perubahan database.

### P1 — Shell dan navigasi role-based

1. Bangun `FuelOperationsHubPage` di belakang feature flag.
2. Tambahkan tiga mode berdasarkan permission.
3. Pertahankan route/komponen lama sebagai fallback sementara.
4. Bangun responsive shell, context bar, semantic badge, loading/error/empty
   states, dan mobile bottom navigation.
5. Tambahkan telemetry event tanpa menyimpan data sensitif.

Exit criteria:

- navigasi konsisten desktop/mobile;
- user hanya melihat mode yang diizinkan;
- belum mengubah workflow transaksi.

### P2 — Operator task flows

1. Implement wizard Terima Solar menggunakan API receipt eksisting.
2. Implement wizard Transfer BBM menggunakan API transfer atomik eksisting.
3. Implement wizard Catat Opname menggunakan workflow maker-checker eksisting.
4. Tambahkan summary confirmation dan field validation.
5. Tambahkan Riwayat Saya serta status approval/posting.
6. Tambahkan upload bukti bila storage contract telah tersedia.

Exit criteria:

- semua aksi menghasilkan transaksi yang sama dengan halaman lama;
- posted transaction tetap immutable;
- save/retry tidak membentuk duplikasi;
- kegagalan menampilkan reason yang dapat ditindaklanjuti.

### P3 — Shift Fuel Board dan Control Center

1. Bangun endpoint agregasi hanya jika API eksisting tidak memadai.
2. Implement Shift Fuel Board dan Tugas Shift.
3. Implement KPI Control Center.
4. Implement stock matrix, action queue, dan filters.
5. Implement lineage drawer.
6. Pastikan angka ringkasan dapat direkonsiliasi ke ledger.

Exit criteria:

- setiap KPI memiliki source, timestamp, dan formula version bila relevan;
- stock matrix sama dengan query ledger pada filter yang sama;
- anomaly/action queue berupa hyperlink/drill-down ke data sumber.

### P4 — Administrasi dan migrasi tab

1. Pindahkan Ledger/FIFO ke menu Administrasi.
2. Pindahkan Mapping Sumber dan action queue.
3. Pindahkan Analytics dan Export.
4. Pertahankan deep link lama selama masa transisi.
5. Tambahkan redirect dan migration notice setelah adopsi stabil.
6. Hapus navigasi tab lama hanya setelah paritas fitur dan audit tercapai.

Exit criteria:

- tidak ada fitur tab lama yang hilang;
- deep link tidak rusak selama compatibility window;
- role operator tidak terpapar fungsi admin.

### P5 — Offline outbox

1. Definisikan operation envelope dan sync protocol.
2. Implement IndexedDB draft/outbox.
3. Implement cache master versioned.
4. Implement retry/idempotency/conflict states.
5. Implement upload bukti bertahap.
6. Implement reconciliation queue dan audit origin device.
7. Uji offline, reconnect, duplicate retry, conflict, logout, dan device storage
   pressure.

Exit criteria:

- refresh/offline tidak menghilangkan draft;
- satu operasi hanya menghasilkan satu transaksi backend;
- konflik tidak mengubah saldo diam-diam;
- user dapat membedakan local save dan server sync.

### P6 — Pilot dan rollout

1. Aktifkan feature flag untuk satu role/lokasi pilot.
2. Jalankan parallel comparison dengan halaman lama.
3. Rekonsiliasi receipt, transfer, opname, FIFO, saldo, dan audit.
4. Kumpulkan completion time, error rate, abandon rate, dan feedback operator.
5. Perbaiki blocker lalu perluas rollout per project/lokasi.
6. Nonaktifkan UI lama setelah exit criteria terpenuhi.

## 15. Pengujian

### Unit/domain

- validasi quantity dan location/product;
- permission dan scope tenant/project;
- idempotent retry;
- transfer atomicity;
- maker-checker opname;
- reversal posted transaction;
- status sync transition.

### Integration/API

- operator tidak dapat menjalankan fungsi admin;
- Tenant A tidak dapat membaca/mutasi Tenant B;
- receipt menghasilkan FIFO sesuai service authoritative;
- transfer tidak mengubah total stock project;
- opname approval menghasilkan adjustment yang tertaut;
- endpoint agregasi sama dengan ledger source.

### Browser/E2E

- tiga CTA sampai hasil akhir;
- responsive desktop dan mobile;
- slow connection dan skeleton state;
- error, empty state, offline, reconnect, conflict;
- refresh saat form belum selesai;
- keyboard navigation dan accessible label;
- tidak ada console error atau horizontal body overflow.

## 16. Acceptance Criteria

- Operator menyelesaikan tiga aksi utama tanpa membuka tab ledger/FIFO.
- Semua ringkasan stok berasal dari backend authoritative.
- Tidak ada perubahan pada formula fuel dan inventory akibat redesign.
- Role dan area scope divalidasi server.
- Posted transaction tidak dapat diedit/hapus langsung.
- Action queue dapat membuka data sumber yang relevan.
- KPI dan stock matrix dapat direkonsiliasi ke ledger.
- Layout dapat dipakai pada ponsel tanpa horizontal scrolling.
- Draft tidak hilang pada refresh setelah fase offline diaktifkan.
- Status local, queued, synced, conflict, dan rejected dapat dibedakan jelas.
- Retry tidak menciptakan transaksi ganda.
- UI lama baru dinonaktifkan setelah feature parity terverifikasi.

## 17. Risiko dan Mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Redesign memutus fitur lama | Feature flag, route fallback, parity checklist |
| KPI browser berbeda dari ledger | Server aggregation dan reconciliation test |
| Role hanya disembunyikan di UI | Backend RBAC untuk setiap endpoint |
| Cache mencampur client/project | Scope seluruh cache key dan clear saat logout |
| LocalStorage dianggap offline-ready | Gunakan IndexedDB, outbox, idempotency, conflict flow |
| Foto menghambat posting | Upload terpisah, retry, ukuran maksimum |
| Operator salah memahami status | Teks eksplisit local vs synced vs posted |
| Transaksi ganda saat reconnect | Stable operation ID dan unique idempotency key |
| Tab lama dihapus terlalu cepat | Compatibility window dan pilot comparison |
| Terlalu banyak request dashboard | Endpoint agregasi read-only dan lazy loading |

## 18. Keputusan Implementasi

1. Preview visual adalah referensi UX, bukan bukti fitur produksi.
2. Arsitektur ledger/FIFO yang sudah ada tetap menjadi source of truth.
3. Implementasi dimulai dengan reuse API dan feature flag.
4. Mode default mengikuti role: operator ke **Operasional Hari Ini**, admin ke
   mode terakhir yang diizinkan atau Control Center.
5. Offline outbox dikerjakan sebagai fase tersendiri dan tidak diklaim selesai
   sebelum uji reconnect, retry, conflict, serta reconciliation lulus.
6. Tidak ada database migration pada fase shell/navigasi kecuali audit endpoint
   menemukan kebutuhan yang nyata.

Dokumen ini menjadi panduan implementasi UI/flow. Detail schema, transaksi,
FIFO, stock opname, formula, dan deployment inventory tetap merujuk pada
`docs/RENCANA_DATABASE_FUEL_FIFO_STOCK_OPNAME.md` serta repository aktual.
