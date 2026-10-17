# OMOS — Review Modul HSE & Roadmap Pengembangan Bertahap

**Dokumen yang direview:** `docs/omos-modul-hse (1).md`
**Acuan arsitektur:** `OMOS_MASTER_PROJECT_MILESTONE_V2.6.md` (Architecture Freeze Candidate)
**Acuan kondisi aktual:** `backend/migrations/073` s/d `091` (skema HSE yang sudah termigrasi)
**Tanggal review:** 12 Oktober 2026
**Status:** Draft untuk keputusan Owner OMOS

---

## 0. Ringkasan

Rancangan modul HSE sudah lengkap dari sisi cakupan fungsi (hazard, insiden, PTW, kompetensi, kesehatan, lingkungan, darurat, APD, audit, dokumen) dan sesuai praktik HSE pertambangan. Temuan terbagi lima kelompok, disusun sebagai tahapan:

| Tahap | Kelompok | Jumlah item | Sifat |
|---|---|---|---|
| 1 | Fitur yang belum tersedia | 14 | Penambahan kapabilitas |
| 2 | Penyelarasan dengan Milestone v2.6 | 10 | Arsitektur & governance |
| 3 | Koreksi definisi K3 & regulasi | 9 | Kebenaran angka dan kepatuhan |
| 4 | Perbaikan model data & aturan bisnis | 9 | Integritas data |
| 5 | Perbaikan sintaks/skema yang berkonflik | 18 | Sinkronisasi dokumen ↔ database |

> **Catatan urutan eksekusi.** Dokumen ini disusun sesuai permintaan: dari fitur baru menuju perbaikan sintaks. Namun beberapa fitur Tahap 1 **bergantung** pada perbaikan di Tahap 4–5 (misalnya LTIFR resmi butuh klasifikasi insiden yang benar). Kolom **Prasyarat** di setiap item menunjukkan ketergantungan ini. Rekomendasi urutan *pengerjaan* nyata ada di **Bagian 6**.

**Temuan paling kritis (harus ditangani sebelum go-live HSE):**

1. `ON DELETE CASCADE` dari `users` ke data MCU, FFW, lisensi, pelatihan, APD → menghapus user = menghapus riwayat kesehatan & kompetensi (4-D1).
2. `hse_site_metrics` menyimpan LTIFR/TRIR/kepatuhan sebagai kolom statis dengan nilai dummy mockup (5-K2).
3. Klasifikasi insiden mencampur jenis kejadian dan akibat cedera → LTIFR/TRIR tidak bisa dihitung benar (3-R2).
4. Data kesehatan tanpa RLS/enkripsi, dan dokumen saling bertentangan soal siapa yang boleh melihat (2-M3, 5-K11).

---

## 1. TAHAP 1 — Fitur yang Belum Tersedia

Fitur yang belum ada di rancangan maupun di database, atau baru disebut tanpa desain.

### 1-F1. Klasifikasi kecelakaan tambang sesuai regulasi Indonesia

| | |
|---|---|
| **Temuan** | Insiden hanya memakai klasifikasi internasional (LTI/MTI/FAI). Pelaporan ke KaIT memakai kategori kecelakaan tambang **ringan / berat / mati** dan harus memenuhi kriteria kecelakaan tambang (terjadi di wilayah kegiatan usaha pertambangan, pada jam kerja, akibat kegiatan pertambangan, menimpa pekerja tambang/orang yang diizinkan KTT, benar-benar terjadi). Kewajiban lapor *kejadian berbahaya* dan *penyakit akibat kerja* juga belum dimodelkan. |
| **Dampak** | Laporan ke Inspektur Tambang tetap harus dibuat manual di luar OMOS. |
| **Rekomendasi** | Tambah `regulatory_class` (`RINGAN`, `BERAT`, `MATI`, `NOT_MINING_ACCIDENT`) dan tabel `incident_regulatory_criteria` (checklist kriteria + penilai + waktu). Tambah jenis laporan `DANGEROUS_OCCURRENCE` dan `OCCUPATIONAL_DISEASE` pada pelaporan eksternal. Definisi kriteria disimpan sebagai konfigurasi yang diverifikasi KTT. |
| **Prasyarat** | 3-R2 (pemisahan jenis kejadian & akibat cedera) |
| **Kriteria selesai** | Insiden yang memenuhi kriteria otomatis masuk antrean laporan KaIT dengan tenggat; klasifikasi tersimpan dengan `rule_id` + `reason_code`. |

### 1-F2. HSE Period Close (penguncian statistik bulanan)

| | |
|---|---|
| **Temuan** | Statistik dihitung ulang setiap kali data berubah. Reklasifikasi insiden (mis. MTI → LTI setelah beberapa hari) mengubah angka bulan yang sudah dilaporkan. |
| **Rekomendasi** | Terapkan pola Commercial Period Close (Milestone §66): `OPEN → REVIEW → RECONCILED → CLOSED`. Setelah `CLOSED`, perubahan hanya lewat **HSE adjustment** dengan approval dan dicatat di audit. Tabel `hse_stat_periods` + `hse_stat_adjustments`. |
| **Prasyarat** | 2-M7 (critical audit), 5-K2 (KPI dihitung dari data) |
| **Kriteria selesai** | Angka bulan yang sudah ditutup tidak berubah tanpa entri adjustment yang disetujui. |

### 1-F3. Competency Gate lintas modul

| | |
|---|---|
| **Temuan** | Pengecekan kompetensi hanya dipakai di PTW. Padahal nilai terbesar HSE di OMOS adalah mencegah operator tanpa SIMPER kelas yang sesuai atau FFW `UNFIT` dipasangkan ke unit. |
| **Rekomendasi** | Satu aturan di rule engine (Milestone §37 "Competency Gate") yang dipanggil oleh: PTW, fleet mapping/deployment, entri HM/ritase, dan roster. Mode penegakan per project: `WARN` atau `BLOCK`. Kecocokan dicek dari `class_or_unit` lisensi terhadap `equipment_class`. |
| **Prasyarat** | 2-M6 (decision governance), 4-D1 (FK ke master People) |
| **Kriteria selesai** | Assignment operator dengan SIMPER kedaluwarsa/kelas tidak cocok menghasilkan keputusan `BLOCK`/`WARN` dengan `reason_code`, mis. `COMP-SIMPER-EXPIRED`. |

### 1-F4. Integrasi Maintenance: tag-out dan work order otomatis

| | |
|---|---|
| **Temuan** | Aturan 9 hanya "menandai" objek yang gagal inspeksi kritikal. Tidak ada tautan ke Maintenance (Milestone §67), dan P2H tumpang tindih antara HSE dan Production/Maintenance. |
| **Rekomendasi** | Butir kritikal `NO` → status unit `TAGGED_OUT` + work order otomatis di Maintenance. Unit tidak bisa dipakai di Production/Fleet sampai WO ditutup dan diverifikasi. Tetapkan source-of-truth P2H (usulan: Maintenance pemilik data, HSE pembaca). |
| **Prasyarat** | Keputusan Source-of-Truth (2-M2) |
| **Kriteria selesai** | Unit tag-out tidak muncul di daftar unit tersedia pada fleet deployment planner. |

### 1-F5. Pelaporan offline dengan penomoran dua tahap

| | |
|---|---|
| **Temuan** | Dokumen hanya menulis "offline-first bila memungkinkan". Nomor berurutan (`HZD-2610-001`) tidak bisa dibuat saat device offline. |
| **Rekomendasi** | Form lapangan (hazard, near miss, inspeksi, FFW, P5M, PTW lapangan) memakai event offline: `event_id` dari klien, `business_key`, `device_id`, `operational_date`, `schema_version`. Nomor sementara dari device (`HZD-TMP-<device>-<seq>`), lalu server memberi nomor resmi saat sinkron. |
| **Prasyarat** | 2-M4 |
| **Kriteria selesai** | Retry sinkron tidak menghasilkan hazard ganda; nomor resmi unik per project. |

### 1-F6. Layanan lampiran & bukti (evidence service)

| | |
|---|---|
| **Temuan** | Foto/lampiran disimpan sebagai `TEXT[]` URL di banyak tabel (hazard, insiden, inspeksi, P5M, dsb.). |
| **Rekomendasi** | Tabel inti `attachments` (polimorfik): `hash_sha256`, `captured_at`, `gps`, `device_id`, `mime`, `size`, `retention_class`, `legal_hold`, `priority` (P1/P2 edge). Bukti investigasi bersifat immutable setelah investigasi `COMPLETED`. |
| **Kriteria selesai** | Semua lampiran HSE punya hash dan kelas retensi; foto hazard mengikuti Edge Storage Policy (Milestone §49). |

### 1-F7. Riwayat reklasifikasi insiden

| | |
|---|---|
| **Rekomendasi** | Tabel `incident_classification_history` (dari, ke, alasan, oleh, waktu, approval). Counter hari tanpa LTI dan statistik dihitung ulang dari riwayat ini. |
| **Prasyarat** | 3-R2 |

### 1-F8. Versioning matriks risiko

| | |
|---|---|
| **Temuan** | `hse_risk_matrix_config` tanpa versi/effective date. |
| **Rekomendasi** | `matrix_version` + `effective_from/until`. Setiap hazard/IBPR menyimpan `matrix_version` yang dipakai saat dinilai. Dukung pemetaan per sel 5×5 (`cell_map jsonb`), bukan hanya ambang skor. |

### 1-F9. Approval chain PTW yang dapat dikonfigurasi

| | |
|---|---|
| **Temuan** | PTW hanya punya satu `approved_by`. Dokumen menyebut "KTT / Safety Officer", hak akses menyebut Admin HSE dan Kepala Departemen. |
| **Rekomendasi** | Pakai Approval Policy Engine (Milestone §3): rantai approval per jenis izin dan tingkat risiko (mis. kerja panas: Supervisor → HSE → PJO; ruang terbatas: + KTT). Simpan setiap langkah di `hse_ptw_approvals`. |

### 1-F10. Konfigurasi peran perusahaan (kontraktor vs pemilik IUP)

| | |
|---|---|
| **Temuan** | CSMS dirancang dari sudut pandang pemilik IUP. Client OMOS bisa berupa kontraktor (dinilai owner, menilai subkontraktor sendiri). Lingkungan/reklamasi umumnya kewajiban pemegang IUP. |
| **Rekomendasi** | Atur lewat Project Blueprint (`company_role`) + Feature Flag (Milestone §55) per sub-modul. CSMS punya dua arah: `ASSESSED_BY_OWNER` dan `ASSESSING_SUBCONTRACTOR`. |

### 1-F11. Log akses data kesehatan

| | |
|---|---|
| **Rekomendasi** | Setiap pembacaan detail MCU, tes narkoba/alkohol, dan kasus kesehatan dicatat (`hse_health_access_log`: siapa, record, waktu, alasan). Dibutuhkan untuk kepatuhan UU PDP. |
| **Prasyarat** | 2-M3 |

### 1-F12. Usulan hazard dari AI Vision & telemetri Fleet

| | |
|---|---|
| **Rekomendasi** | Deteksi PPE, restricted zone (AI Vision §70), overspeed/geofence (Fleet §69) hanya membuat **usulan hazard** berstatus `PENDING_HUMAN_REVIEW`, lengkap dengan `model_version`, `confidence`, `input_reference` (Milestone §39 & §72). AI tidak menulis data HSE langsung. |
| **Tahap milestone** | P2 — Scale / Intelligence |

### 1-F13. Jam kerja aman (safe man-hours) dan Rasio leading indicator

| | |
|---|---|
| **Rekomendasi** | Tampilkan **jam kerja aman tanpa LTI** di samping hari tanpa LTI. Tambah indikator *leading*: rasio pelaporan hazard per 100 pekerja, kepatuhan target hazard/P5M/inspeksi (tabel target 088–089 sudah ada, KPI-nya belum didefinisikan di dokumen). |

### 1-F14. Templat laporan regulasi

| | |
|---|---|
| **Rekomendasi** | Templat cetak/ekspor untuk laporan berkala K3 ke KaIT, neraca limbah B3, dan laporan kecelakaan, diisi otomatis dari data. Format final diverifikasi tim HSE site. |

---

## 2. TAHAP 2 — Penyelarasan dengan Milestone v2.6

### 2-M1. Hierarki Project / IUP (Milestone §30)

| | |
|---|---|
| **Temuan** | Tabel HSE hanya punya `tenant_key` + `project_key`. Milestone mensyaratkan Tenant → Legal Entity → Project → Site → IUP → PIT. |
| **Dampak** | Laporan KaIT dan tanggung jawab KTT bersifat per IUP/badan usaha; tidak bisa dipisahkan. |
| **Rekomendasi** | Tambah `legal_entity_id`, `site_id`, `iup_id` (nullable bertahap) pada tabel transaksi HSE utama: `incidents`, `hazard_reports`, `hse_ptw_permits`, `hse_manhours`, `hse_mandatory_reports`. |

### 2-M2. Master ganda & Source-of-Truth (Milestone §31, §57)

| Data | Kondisi | Usulan Source-of-Truth |
|---|---|---|
| Lokasi/area | `hse_locations` terpisah dari Geospatial Area Master | Core `Area` (§31); `hse_locations` jadi view/ekstensi atribut HSE |
| Perusahaan kontraktor | `hse_contractors` + nama teks bebas di banyak tabel | MDM Company; `hse_contractors` hanya atribut CSMS |
| Kompetensi/lisensi | Tercantum di People (§61) dan HSE (§68) | Satu pemilik (usulan: HSE pemilik data lisensi K3, People membaca status) |
| Karyawan | FK ke `users` | Master People (NIP, §61) |
| P2H | HSE templat vs Maintenance | Maintenance (lihat 1-F4) |

Tambahkan baris-baris ini ke Source-of-Truth Matrix (Milestone §57).

### 2-M3. Privacy/PDP & Edge Security (Milestone §13, §60)

| | |
|---|---|
| **Temuan** | Tabel kesehatan (077) tidak punya RLS, enkripsi kolom, atau log akses. |
| **Rekomendasi** | (a) Row Level Security per peran untuk tabel `hse_mcu_records`, `hse_substance_tests`, `hse_health_cases`, detail `hse_fit_for_work_checks`; (b) enkripsi kolom sensitif (`restrictions`, `notes`, tanda vital, `self_declaration`); (c) view `v_employee_fitness_status` untuk peran umum; (d) retensi & legal hold; (e) di edge, data kesehatan masuk kategori crypto-erase (§14). |

### 2-M4. Event Architecture & Offline Sync (Milestone §40–47)

| | |
|---|---|
| **Rekomendasi** | Tetapkan event schema HSE (`HazardReported`, `InspectionCompleted`, `FfwChecked`, `IncidentReported`, `PtwStatusChanged`, `LotoApplied/Released`) dengan idempotency level 1 & 2, tombstone, DLQ. Daftarkan di `OMOS_EVENT_SPECIFICATION.md`. |

### 2-M5. Operational Date (Milestone §29)

| | |
|---|---|
| **Temuan** | `incidents.occurred_at` tanpa `operational_date`; FFW memakai `shift VARCHAR 'SHIFT_1'`. P5M sudah benar memakai `shift_id`. |
| **Rekomendasi** | Tambah `operational_date` + `shift_instance_id` + `timezone` pada insiden, hazard, FFW, inspeksi, PTW. Insiden pukul 02:15 di shift malam tercatat pada tanggal operasional sebelumnya. |

### 2-M6. Automated Decision Governance (Milestone §37–38)

| | |
|---|---|
| **Temuan** | Keputusan otomatis (risk level, `fit_to_operate`, auto-UNFIT FFW, competency check PTW, auto-CAPA, status baku mutu, duplikat/smart merge hazard) belum mencatat `rule_id`, `rule_version`, `reason_code`. |
| **Rekomendasi** | Semua keputusan di atas lewat Policy/Rule Engine dan menghasilkan record keputusan. KPI milestone: *Critical Rule Decision Without Reason Code = 0*. |

### 2-M7. Critical Audit & Full Gate (Milestone §59, §76)

| | |
|---|---|
| **Temuan** | Aturan 15 hanya "perubahan dicatat". Milestone mewajibkan Full Gate untuk *Critical HSE*. Audit setup inspeksi (084) sudah ada, tetapi bukan append-only + hash chain. |
| **Rekomendasi** | Critical audit (append-only, hash chain, restricted writer) untuk: insiden & klasifikasinya, investigasi, approval/penutupan PTW, LOTO, hasil MCU, statistik periode tertutup. |

### 2-M8. Prioritas data edge (Milestone §50)

| Prioritas | Data HSE |
|---|---|
| P0 | Status PTW/LOTO aktif, laporan insiden berat (fatality/LTI) |
| P1 | Laporan insiden lain, hazard ekstrem/tinggi, FFW `UNFIT` |
| P2 | Foto hazard/inspeksi, P5M |
| P3 | Pengukuran higiene/lingkungan mentah |
| P4 | Media sementara AI |

### 2-M9. Posisi HSE dalam Thin Vertical Slice (Milestone §77–78)

| | |
|---|---|
| **Temuan** | Milestone menempatkan HSE Certification di P2 dan HSE belum masuk slice mana pun, sementara 8 fase skema HSE sudah dibangun. HSE bergantung pada People (employee, shift, attendance → manhours). |
| **Rekomendasi** | Tetapkan **Slice 5 — HSE** setelah Slice 2 (People): `Employee → Shift → Hazard (offline) → CAPA → Insiden → Manhours dari Attendance → LTIFR/TRIFR → Period Close → Audit`. Fase hazard/CAPA boleh pilot dengan **Lite Gate**; insiden, statistik resmi, PTW/LOTO, kesehatan wajib **Full Gate**. |

### 2-M10. Entitlement & Feature Flag (Milestone §17–20, §55)

| | |
|---|---|
| **Rekomendasi** | Modul HSE dan sub-modulnya (Kesehatan, Lingkungan, Kontraktor, PTW) didaftarkan sebagai entitlement `MODULE`; metrik tambahan opsional (`HSE_ACTIVE_CONTRACTOR`, `STORAGE_GB` untuk lampiran). |

---

## 3. TAHAP 3 — Koreksi Definisi K3 & Regulasi

> Rujukan regulasi di bagian ini perlu diverifikasi oleh KTT/tim HSE site sebelum dijadikan konfigurasi final.

### 3-R1. TRIR vs TRIFR

| | |
|---|---|
| **Tertulis** | TRIR = (fatality + LTI + MTI) × 1.000.000 ÷ jam kerja |
| **Koreksi** | Dengan pengali 1.000.000 namanya **TRIFR**; TRIR memakai **200.000**. Kasus tercatat juga mencakup **RWC** (restricted work / alih tugas). Sediakan keduanya dengan pengali yang dapat dikonfigurasi. |

### 3-R2. Klasifikasi insiden bercampur

| | |
|---|---|
| **Tertulis** | `incident_type`: `FATALITY, LTI, MTI, FAI, NEAR_MISS, PROPERTY_DAMAGE, FIRE, ENVIRONMENTAL, VEHICLE_ACCIDENT` |
| **Masalah** | Mencampur *jenis kejadian* dengan *akibat cedera*. Kecelakaan kendaraan yang menyebabkan LTI tidak bisa dicatat keduanya. LTIFR menghitung **orang** yang LTI, bukan jumlah insiden. |
| **Koreksi** | `incidents.event_type` (`VEHICLE`, `FIRE`, `SPILL`, `FALL`, `STRUCK_BY`, `CAUGHT_BETWEEN`, `ELECTRICAL`, `GROUND_FAILURE`, `OTHER`) + `incidents.highest_outcome` (turunan) + `incident_persons.injury_class` (`FATALITY`, `LTI`, `RWC`, `MTI`, `FAI`, `NONE`). Near miss & property damage tetap sebagai `outcome` tanpa korban. |

### 3-R3. Severity rate

| | |
|---|---|
| **Koreksi** | Fatality umumnya dibebankan **6.000 hari** (ANSI Z16.1). Tambah pengaturan `fatality_charged_days` dan `lost_day_basis` (`CALENDAR` / `SCHEDULED`). |

### 3-R4. Hari tanpa LTI

| | |
|---|---|
| **Konflik** | §4.1 menyebut "Hari **kerja** tanpa LTI", aturan bisnis 5 menghitung selisih **hari kalender**. |
| **Koreksi** | Tetapkan definisi dalam pengaturan (`CALENDAR_DAYS` / `WORKED_DAYS`), tampilkan juga jam kerja aman (1-F13). Hitung dari data insiden (bukan `last_lti_date` manual) agar reklasifikasi otomatis tercermin. |

### 3-R5. Rujukan SMKP

| | |
|---|---|
| **Tertulis** | "7 Elemen baku SMKP Permen ESDM No. 26/2018" |
| **Koreksi** | Permen ESDM 26/2018 adalah dasar kewajiban; rincian elemen & kriteria SMKP ada di **Kepmen ESDM 1827 K/30/MEM/2018** (pedoman penerapan SMKP). Bobot seed (5/15/15/25/20/10/10) perlu diverifikasi terhadap kriteria audit yang dipakai. Contoh `legal_basis` "Kepmen 1827/2018 Lamp. III" perlu dicek nomor lampirannya. Nama elemen 3, 5, 7 disesuaikan: *Organisasi dan Personel*, *Evaluasi dan Tindak Lanjut*, *Tinjauan Manajemen dan Peningkatan Kinerja*. |

### 3-R6. Batas simpan limbah B3

| | |
|---|---|
| **Tertulis** | `storage_deadline` default 90 hari |
| **Koreksi** | Bergantung timbulan dan kategori (90 / 180 / 365 hari, PP 22/2021). Komentar di migrasi 079 sudah benar; dokumen belum. Jadikan aturan per jenis limbah (`hse_waste_types.max_storage_days`). |

### 3-R7. Nomenklatur instansi & perizinan lingkungan

| | |
|---|---|
| **Koreksi** | KLHK telah dipecah (Kementerian Lingkungan Hidup dan Kementerian Kehutanan) sejak Oktober 2024; "izin lingkungan" kini **Persetujuan Lingkungan**, ditambah Persetujuan Teknis/SLO untuk pembuangan. Ganti enum `KLHK`/`DLH_KLHK` dengan master `hse_agencies` agar tidak perlu migrasi saat nomenklatur berubah. |

### 3-R8. Kewajiban & tenggat pelaporan kecelakaan

| | |
|---|---|
| **Tertulis** | "ESDM/KAIT ≤ 24 jam" |
| **Koreksi** | Simpan tenggat sebagai konfigurasi per jenis laporan (laporan awal vs laporan tertulis lanjutan), diverifikasi KTT, bukan teks tetap. |

### 3-R9. KPI kepatuhan pelatihan

| | |
|---|---|
| **Koreksi** | Penyebut "total karyawan aktif" seharusnya "karyawan aktif yang **memiliki** persyaratan pelatihan" agar jabatan tanpa kursus wajib tidak mendistorsi angka. |

---

## 4. TAHAP 4 — Perbaikan Model Data & Aturan Bisnis

### 4-D1. Referensi karyawan dan `ON DELETE CASCADE`

| | |
|---|---|
| **Temuan** | `employee_id` → `users(id)` dengan `ON DELETE CASCADE` di 075 (2 tabel), 077 (4 tabel), 078 (1 tabel). |
| **Dampak** | Menghapus user menghapus riwayat MCU, FFW, tes narkoba, kasus kesehatan, lisensi, pelatihan, APD. Operator tanpa akun login tidak bisa dicatat. |
| **Perbaikan** | FK ke master People (`employees`/NIP), `ON DELETE RESTRICT`, offboarding memakai status, bukan hapus. |

```sql
-- sketsa, sesuaikan nama constraint aktual
ALTER TABLE hse_mcu_records
  DROP CONSTRAINT hse_mcu_records_employee_id_fkey,
  ADD CONSTRAINT hse_mcu_records_employee_fk
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
```

### 4-D2. Status turunan disimpan sebagai status

| | |
|---|---|
| **Temuan** | `OVERDUE` (CAPA, laporan wajib), `DUE/OVERDUE` (peralatan darurat), `EXPIRING/EXPIRED` (lisensi, dokumen kontraktor) disimpan sebagai status. |
| **Dampak** | Status asli hilang (CAPA `IN_PROGRESS` sekaligus terlambat tidak terbaca); data basi bila job harian gagal. |
| **Perbaikan** | Status = keadaan alur kerja saja. Keterlambatan/kedaluwarsa dihitung: kolom generated atau view (`is_overdue`, `validity_state`). |

### 4-D3. Unique `hse_manhours` berbasis teks

| | |
|---|---|
| **Temuan** | `UNIQUE (tenant_key, project_key, period_month, company_name, department_name)` dengan default teks. |
| **Perbaikan** | Unique pada `company_id`, `department_id` (FK master). Bila salah satu nullable, pakai `UNIQUE NULLS NOT DISTINCT` (PostgreSQL 15+). Tambah `source` `CONTRACTOR_REPORT` dan status `DRAFT/APPROVED/LOCKED`. |

### 4-D4. `source_type` CAPA belum lengkap

| | |
|---|---|
| **Temuan** | Aturan 12 menyarankan CAPA dari pengukuran lingkungan, tetapi `source_type` tidak punya `ENVIRONMENT`. |
| **Perbaikan** | Tambah `ENVIRONMENT`, `PTW`, `CONTRACTOR_VIOLATION`, `FFW`, `HEALTH`, `MANAGEMENT_REVIEW`. Pertimbangkan tabel `hse_action_source_types` agar tidak perlu migrasi CHECK setiap kali bertambah. |

### 4-D5. Array FK tanpa integritas referensial

| | |
|---|---|
| **Temuan** | `team_member_ids uuid[]`, `certification_ids uuid[]`, `led_by_ids uuid[]` (P5M), `evidence_url text[]`. |
| **Perbaikan** | Tabel junction (`incident_investigation_members`, `hse_ert_certifications`, `hse_p5m_event_leaders`). Pola peserta P5M (090) sudah benar dan bisa dijadikan acuan. |

### 4-D6. Nilai ambang tertanam di kode/dokumen

| Nilai | Lokasi | Pindah ke |
|---|---|---|
| Tidur < 5 jam → UNFIT | 5.7 FFW | Policy FFW per project |
| CSMS ≥75 / 60–74 / <60 | 5.8 | `hse_csms_grading_policy` |
| Alert 60/30/7 hari | 4.6, 10 | `hse_alert_policy` |
| Pengali LTIFR/TRIR | 7 | Project Operational Policy (§28) |

### 4-D7. Penutupan hazard/insiden vs CAPA

| | |
|---|---|
| **Perbaikan** | Aturan 4 diperluas ke audit finding dan inspeksi; pembatalan CAPA wajib `cancel_reason` + approval. |

### 4-D8. Kolom denormalisasi nama (`*_name`)

| | |
|---|---|
| **Temuan** | Banyak tabel menyimpan `location_name`, `category_name`, `assigned_to_name`, `company_name` di samping FK. |
| **Perbaikan** | Boleh dipertahankan sebagai **snapshot historis**, tetapi dokumentasikan sebagai snapshot (tidak diperbarui) dan jangan dipakai sebagai kunci unique/grouping statistik. |

### 4-D9. `hse_smkp_elements` global

| | |
|---|---|
| **Temuan** | `element_no UNIQUE` global, tanpa tenant/versi. |
| **Perbaikan** | Tambah `standard_version` (bila kriteria SMKP berubah) dan izinkan override bobot per tenant lewat tabel terpisah. |

---

## 5. TAHAP 5 — Perbaikan Sintaks & Skema yang Berkonflik

Konflik antara dokumen `omos-modul-hse (1).md`, migrasi database, dan antarbagian dokumen.

| ID | Bagian dokumen | Tertulis di dokumen | Kondisi aktual / konflik | Perbaikan |
|---|---|---|---|---|
| **5-K1** | §5 standar kolom | `tenant_id` (uuid), `site_id` (uuid) | Migrasi 073–091 memakai `tenant_key` / `project_key` TEXT default `'default'`; hanya 081 memakai `tenant_id UUID` + `site_id` | Pilih satu konvensi; migrasikan `hse_risk_register` (081) ke konvensi yang sama; perbarui §5 |
| **5-K2** | §5.1 `hse_site_metrics`, §4.2, §7 | Hanya `last_lti_date`, `record_days`, `target_days`; statistik "dihitung otomatis" | Tabel juga punya `ltifr` (default 0.42), `ltifr_prev` (0.61), `trir` (1.10), `trir_trend`, `near_miss_month` (9), `compliance_*` (94/97/91/88) — nilai mockup | Hapus kolom KPI statis; buat view/materialized view KPI. `site_record_days` & `target_days` jangan punya default angka |
| **5-K3** | §5 pengantar | "termigrasi `073_hse_fase1` s/d `080_hse_fase8`" | Sudah sampai **091** | Perbarui rujukan dan tambah subbagian untuk 081–091 |
| **5-K4** | §4.6, §5.6 | `hse_safety_talks` dengan `attendee_ids uuid[]`; P5M = toolbox | `hse_safety_talks` dihapus permanen (090); diganti `hse_p5m_events`, `hse_p5m_event_attendees`, `hse_safetytalk_events`, `hse_safetytalk_event_attendees` + target (089) | Tulis ulang §4.6 tab Safety talk dan §5.6; P5M dan Safety Talk sebagai dua entitas |
| **5-K5** | §5 (belum ada) | — | Belum terdokumentasi: `hse_inspection_targets`, `hse_inspection_setup_audit`, versioning templat (`root_id`, `version_no`, `is_current`, `locked_at`), `hse_inspection_personnel_scopes`, `hse_hazard_report_targets`, `hse_hazard_report_scopes`, `hse_p5m_targets/scopes`, `hse_safetytalk_targets/scopes`, kolom hazard `potential_consequence`, `reported_by_dept/role`, `merged_into_id`, `semantic_signature`, inspeksi `photos`/`documents` | Tambah subbagian skema + aturan bisnis target & smart merge |
| **5-K6** | §5.1 `hse_manhours` | `company_id`, unik termasuk `department_id` | Unik pada `company_name`, `department_name` | Lihat 4-D3 |
| **5-K7** | §5.6 `hse_training_requirements` | `position_id uuid`, unik `(position_id, course_id)` | Unik pada `position_name` | Samakan ke FK jabatan master |
| **5-K8** | §5.6 `hse_employee_licenses.license_type` | `SIMPER, KIMPER, SIO, OPERATOR_CERT, FIRST_AID, OTHER` | DB menambah `BNSP`, `BLASTING_KIM` | Perbarui dokumen |
| **5-K9** | §5.13 `hse_documents.doc_type` | `POLICY, MANUAL, SOP, WI, JSA, FORM, ERP` | DB: `POLICY, SOP, WORK_INSTRUCTION, FORM, EMERGENCY_PLAN, OTHER` | Putuskan satu set; usulan gabungan: `POLICY, MANUAL, SOP, WORK_INSTRUCTION, JSA, FORM, EMERGENCY_PLAN, OTHER` |
| **5-K10** | §5.13 `hse_mandatory_reports`, `hse_legal_register` | Kolom `recipient_agency` (+`OTHER`); `period_type` tanpa `INCIDENT`; issuer tanpa `KEMENKES` | DB: kolom `agency` tanpa `OTHER`; `period_type` punya `INCIDENT`; issuer punya `KEMENKES` | Samakan nama kolom & enum; lihat juga 3-R7 |
| **5-K11** | §4.7 vs §8 | §4.7 & §8 (Petugas medis): "satu-satunya yang melihat detail medis" | §8 (Admin HSE): "akses penuh termasuk data kesehatan" | Kontradiksi. Usulan: Admin HSE hanya status kelayakan; detail medis hanya Petugas medis (+ akses darurat ber-log) |
| **5-K12** | §4.1 vs §6 aturan 5 | "Hari kerja tanpa LTI" | Rumus = selisih hari kalender | Lihat 3-R4 |
| **5-K13** | §5.8, §5.9, §5.4 | Notasi LaTeX: `$\le$ 24 jam`, `($\ge 75$)`, `($60-74$)`, `($< 60$)`, `$\mu$g/Nm³` | Tidak dirender di sebagian besar viewer markdown | Ganti: `≤ 24 jam`, `(≥ 75)`, `(60–74)`, `(< 60)`, `µg/Nm³` |
| **5-K14** | §0 | Path absolut `D:\OneDrive\Desktop\OMOS\admin-dashboard\...` | Tidak portabel antar mesin/repo | Ganti path relatif repo: `admin-dashboard/assets/sample page/omos_hse_dashboard_layout.html` |
| **5-K15** | §0 aturan 2 | "Bila berbeda, file HTML yang berlaku" | Ambigu: bisa ditafsirkan berlaku juga untuk data/aturan | Tegaskan: HTML berlaku untuk **tampilan**; aturan data & bisnis mengikuti dokumen ini |
| **5-K16** | §9 Integrasi | Nama modul: Karyawan, Pergerakan Karyawan, MPP, Absensi, Alat berat/produksi | Milestone §4: People, Production, Commercial, Maintenance, HSE, Fleet | Pakai nama modul milestone; MPP/Pergerakan/Absensi sebagai sub-fitur People |
| **5-K17** | §3.5 | Level Ekstrem 17–25 | Skor L×C yang mungkin di rentang itu hanya 20 dan 25 | Tidak salah, tetapi beri catatan atau beralih ke pemetaan per sel (1-F8) |
| **5-K18** | §5.2 vs §6 | `OVERDUE` sebagai status CAPA | Bertentangan dengan prinsip status alur kerja | Lihat 4-D2 |

---

## 6. Rekomendasi Urutan Pengerjaan

Urutan dokumen (Tahap 1→5) mengikuti permintaan. Urutan **pengerjaan** yang disarankan, mengikuti dependensi dan prioritas Milestone v2.6:

### Gelombang A — Stabilisasi data (P0, sebelum fitur baru)

1. 4-D1 FK karyawan + hapus `CASCADE` *(kritis)*
2. 5-K2 hapus KPI statis, buat view KPI *(kritis)*
3. 5-K1 satukan konvensi scope, migrasi 081
4. 3-R2 pisahkan `event_type` & `injury_class` + 3-R1 TRIFR/RWC
5. 2-M3 RLS & enkripsi data kesehatan + 5-K11 putuskan hak akses
6. 5-K3 s/d 5-K10, 5-K13 s/d 5-K16 sinkronisasi dokumen ↔ DB

### Gelombang B — Selaras arsitektur (P0/P1)

7. 2-M5 Operational Date
8. 2-M6 Decision governance (reason code)
9. 2-M4 + 1-F5 Event & offline hazard/inspeksi
10. 2-M7 Critical audit
11. 4-D2, 4-D3, 4-D4, 4-D6 perbaikan model data
12. 2-M1 hierarki IUP, 2-M2 Source-of-Truth

### Gelombang C — Fitur bernilai tinggi (P1)

13. 1-F1 klasifikasi regulasi + 1-F7 riwayat reklasifikasi
14. 1-F2 HSE Period Close
15. 1-F3 Competency Gate lintas modul
16. 1-F4 integrasi Maintenance (tag-out)
17. 1-F9 approval chain PTW
18. 1-F6 evidence service

### Gelombang D — Skala & intelligence (P2)

19. 1-F10 peran perusahaan via Blueprint, 2-M10 entitlement
20. 1-F11 log akses kesehatan, 1-F13 leading indicator, 1-F14 templat laporan
21. 1-F12 usulan hazard dari AI Vision/Fleet

### Penempatan dalam Thin Vertical Slice

```text
Slice 1  Client Onboarding
Slice 2  People  ──────────────┐  (prasyarat HSE: employee, shift, attendance)
Slice 3  Production            │
Slice 4  Commercial            │
Slice 5  HSE  ◄────────────────┘
         Employee → Shift → Hazard (offline) → CAPA → Insiden
         → Manhours dari Attendance → LTIFR/TRIFR → Period Close → Audit
         Gate: Hazard/CAPA = Lite Gate · Insiden/Statistik/PTW/Kesehatan = Full Gate
```

---

## 7. Usulan Pembaruan Kriteria Freeze & KPI

Tambahan untuk Milestone §79–80 (bila HSE masuk scope freeze):

| KPI HSE | Target |
|---|---|
| Statistik HSE periode tertutup berubah tanpa adjustment | 0 |
| Data kesehatan terbaca tanpa log akses | 0 |
| Keputusan Competency Gate tanpa reason code | 0 |
| Hazard/inspeksi ganda akibat retry sinkron | Mendekati 0 |
| Insiden kecelakaan tambang tanpa klasifikasi regulasi | 0 |
| Riwayat HSE terhapus akibat penghapusan user | 0 |

```text
[ ] Konvensi scope HSE final (tenant/project/IUP)
[ ] Klasifikasi insiden final (event_type, injury_class, regulatory_class)
[ ] Source-of-Truth kompetensi, lokasi, kontraktor, P2H final
[ ] Model akses data kesehatan final
[ ] HSE Period Close final
```

---

## 8. Keputusan yang Dibutuhkan dari Owner OMOS

1. Konvensi scope: `tenant_key/project_key` TEXT atau `tenant_id/project_id` UUID?
2. Pemilik data kompetensi/lisensi: People atau HSE?
3. Admin HSE boleh melihat detail medis atau tidak?
4. Definisi hari tanpa LTI: kalender atau hari kerja?
5. Pengali statistik default: 1.000.000 (TRIFR) dan/atau 200.000 (TRIR)?
6. Mode Competency Gate default: `WARN` atau `BLOCK`?
7. HSE masuk scope Architecture Freeze v2.6 atau ditetapkan sebagai Slice 5 pasca-freeze?

---

*Dokumen ini adalah hasil review dan belum mengubah `omos-modul-hse (1).md` maupun migrasi database.*
