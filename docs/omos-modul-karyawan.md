# OMOS — Modul Karyawan: Pergerakan Karyawan + Database Karyawan

Dokumen rancangan layout, fitur, dan skema data untuk tab **Karyawan** di OMOS.

---

## 1. Ringkasan Perubahan

| Sebelumnya | Sekarang |
|---|---|
| Tab Karyawan = tampilan database karyawan (eksisting) | Tab Karyawan = **Pergerakan Karyawan** (tampilan utama / default) |
| — | Tampilan eksisting dipindah ke mode **Database Karyawan** di tab yang sama |

**Alasan:** halaman pertama yang dilihat pengguna HR/manajemen sebaiknya langsung menjawab pertanyaan "apa yang berubah di tenaga kerja kita?" (masuk, mutasi, promosi, keluar), sedangkan daftar master karyawan menjadi tampilan referensi/pencarian.

---

## 2. Struktur Navigasi

```
Karyawan (menu utama)
├── [Mode switch]  Pergerakan  |  Database Karyawan
│
├── Mode: Pergerakan (default)
│   ├── Ringkasan
│   ├── MPP            (Man Power Planning: kebutuhan vs aktual per jabatan & periode)
│   ├── Masuk          (New Hire / Rehire)
│   ├── Mutasi
│   ├── Promosi        (termasuk Demosi)
│   ├── Keluar         (Resign / Terminasi / Kontrak Habis / Pensiun)
│   └── Riwayat        (timeline gabungan)
│
└── Mode: Database Karyawan (tampilan eksisting)
    └── Daftar master karyawan + profil detail
```

**Mode switch** ditempatkan di header halaman sebagai segmented control (dua opsi). Pilihan terakhir pengguna diingat per akun, tetapi default untuk akun baru adalah **Pergerakan**.

**Rekomendasi penamaan:**
- Label mode 1: **Pergerakan** (teknis: `workforce-movement`)
- Label mode 2: **Database Karyawan** (teknis: `employee-database`)
- Hindari istilah "Mob/Demob" karena di tambang biasanya berarti mobilisasi fisik orang/alat ke site.

---

## 3. Layout Halaman

### 3.1 Kerangka Umum (berlaku di kedua mode)

```
┌──────────────────────────────────────────────────────────────────┐
│ Karyawan                      [ Pergerakan | Database Karyawan ] │
│ Site: JMB-DKC ▾   Periode: Okt 2026 ▾        [Ekspor] [+ Catat]  │
├──────────────────────────────────────────────────────────────────┤
│ (konten sesuai mode & sub-tab)                                   │
└──────────────────────────────────────────────────────────────────┘
```

- Filter global (Site, Periode) berada di header dan memengaruhi semua sub-tab.
- Tombol aksi utama (`+ Catat pergerakan`) hanya muncul di mode Pergerakan; di mode Database berubah menjadi `+ Tambah karyawan`.

### 3.2 Mode Pergerakan — Sub-tab Ringkasan

```
┌────────────┬────────────┬────────────┬────────────┬────────────┐
│ Headcount  │ Masuk      │ Mutasi     │ Promosi    │ Keluar     │
│ 248 aktif  │ +12        │ 5          │ 3          │ -7         │
│            │ bulan ini  │ bulan ini  │ bulan ini  │ TO 2,8%    │
└────────────┴────────────┴────────────┴────────────┴────────────┘
┌───────────────────────────────┬──────────────────────────────┐
│ Tren headcount (12 bulan)     │ Komposisi pergerakan bulan   │
│ [line chart]                  │ ini [bar/donut]              │
├───────────────────────────────┼──────────────────────────────┤
│ Turnover per departemen       │ Alasan keluar teratas        │
│ [horizontal bar]              │ [bar]                        │
├───────────────────────────────┴──────────────────────────────┤
│ Perlu tindakan                                               │
│ • 3 pengajuan menunggu approval                              │
│ • 2 offboarding belum selesai clearance                      │
│ • 6 kontrak berakhir ≤ 30 hari                               │
└──────────────────────────────────────────────────────────────┘
```

**Fitur:**
- Kartu KPI bisa diklik → langsung membuka sub-tab terkait dengan filter periode yang sama.
- Perbandingan dengan bulan lalu (panah naik/turun kecil di tiap kartu).
- Panel "Perlu tindakan" sebagai inbox kerja HR.
- Kartu **Fill rate vs MPP** (aktual ÷ kebutuhan) dengan tautan ke sub-tab MPP.

### 3.3 Mode Pergerakan — Sub-tab Masuk / Mutasi / Promosi / Keluar

Semua sub-tab memakai pola yang sama agar konsisten:

```
┌──────────────────────────────────────────────────────────────┐
│ [Cari nama/NIK]  [Departemen ▾] [Status ▾] [Periode ▾]       │
├──────────────────────────────────────────────────────────────┤
│ Tanggal | Karyawan | Jenis | Dari → ke | Status   | Aksi      │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
                                        ┌─────────────────────┐
  (klik baris → panel detail kanan)  →  │ Detail pergerakan   │
                                        │ Timeline karyawan   │
                                        │ Dokumen             │
                                        │ Alur approval       │
                                        └─────────────────────┘
```

Kolom khusus per sub-tab:

| Sub-tab | Kolom tambahan |
|---|---|
| Masuk | Sumber rekrutmen, tipe kontrak, status MCU, status induksi safety, SIMPER/SIO, akhir probation |
| Mutasi | Site/departemen asal → tujuan, jabatan, atasan baru, alasan mutasi |
| Promosi | Jabatan & grade lama → baru, perubahan komponen gaji (jika hak akses ada), SK |
| Keluar | Jenis keluar, Last Working Day, progres clearance (mis. 2/5), eligible rehire |

**Warna badge jenis (konsisten di seluruh modul):**
- Masuk → hijau
- Mutasi → biru
- Promosi → ungu
- Keluar → merah

### 3.4 Sub-tab Riwayat

Timeline vertikal gabungan semua event, bisa difilter per karyawan, jenis, dan periode. Cocok untuk audit dan menjawab pertanyaan "orang ini dulu di mana saja?".

### 3.5 Panel Detail Pergerakan (drawer kanan)

1. Header: foto, nama, NIK, jenis pergerakan, status
2. Perubahan: tabel "Sebelum → Sesudah"
3. Alur approval (stepper: Diajukan → Atasan → HR → Manajemen)
4. Dokumen terlampir (SK, surat resign, dll.)
5. Catatan & komentar
6. Aksi: Setujui / Tolak / Batalkan (sesuai hak akses)

### 3.6 Form "Catat Pergerakan"

Form dinamis: field berubah mengikuti jenis yang dipilih.

| Jenis dipilih | Field yang muncul |
|---|---|
| Masuk | Data pribadi dasar, jabatan, site, departemen, tipe kontrak, tanggal masuk, sumber |
| Mutasi | Karyawan, tujuan (site/dept/crew), atasan baru, tanggal efektif, alasan |
| Promosi | Karyawan, jabatan/grade baru, tanggal efektif, alasan, dokumen SK |
| Keluar | Karyawan, jenis keluar, tanggal pengajuan, Last Working Day, alasan, checklist clearance |

### 3.7 Mode Database Karyawan (tampilan eksisting)

Dipertahankan sebagaimana adanya, dengan penambahan kecil agar terhubung dengan mode Pergerakan:

- Tab/Section **"Riwayat pergerakan"** di profil karyawan (menampilkan timeline karyawan tersebut).
- Tombol cepat di profil: `Ajukan mutasi`, `Ajukan promosi`, `Proses resign` → membuka form Catat Pergerakan dengan karyawan terisi otomatis.
- Badge status di daftar: Aktif, Probation, Dalam proses keluar, Nonaktif.

### 3.8 Mode Pergerakan — Sub-tab MPP (Man Power Planning)

Sub-tab ini berisi **kebutuhan manpower per jabatan**, dikelompokkan berdasarkan **kelompok departemen**, untuk **periode** tertentu. Posisinya tepat setelah Ringkasan karena angka gap di sini menjadi dasar keputusan rekrutmen di sub-tab Masuk.

**Hierarki data:**

```
Kelompok Departemen   (mis. Produksi, Maintenance & Engineering, HSE, Logistik, GA & HR, Finance)
 └── Departemen       (mis. Hauling, Loading, Workshop)
      └── Jabatan     (mis. Operator HD, Operator Excavator, Mekanik, Welder)
```

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MPP 2026 · Site JMB-DKC · Versi: Revisi 2 (Disetujui) ▾    [Ekspor][Edit]│
│ Tampilan: ( Bulanan | Kuartal | Tahunan )   Periode: Okt–Des 2026 ▾      │
├────────────┬────────────┬────────────┬────────────┬─────────────────────┤
│ Kebutuhan  │ Aktual     │ Gap        │ Fill rate  │ Permintaan terbuka  │
│ 275        │ 248        │ kurang 27  │ 90,2%      │ 14                  │
└────────────┴────────────┴────────────┴────────────┴─────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ [Cari jabatan] [Kelompok ▾] [Departemen ▾] [Status ▾]   [Hanya yang kurang]│
├──────────────────────┬───────┬─────┬─────┬─────┬──────┬────────┬────────┤
│ Kelompok / Jabatan   │Aktual │ Okt │ Nov │ Des │ Gap  │ Proses │ Status │
├──────────────────────┼───────┼─────┼─────┼─────┼──────┼────────┼────────┤
│ ▾ PRODUKSI           │  86   │ 93  │ 95  │ 95  │  7   │   3    │ Kurang │
│    Operator HD       │  54   │ 60  │ 62  │ 62  │  6   │   2    │ Kurang │
│    Operator Exca     │  24   │ 25  │ 25  │ 25  │  1   │   1    │ Kurang │
│    Foreman           │   8   │  8  │  8  │  8  │  0   │   0    │ Sesuai │
│ ▾ MAINTENANCE & ENG  │  41   │ 40  │ 40  │ 42  │ -1   │   0    │ Lebih  │
│    Mekanik           │  26   │ 26  │ 26  │ 28  │  0   │   0    │ Sesuai │
│    Welder            │   6   │  5  │  5  │  5  │ -1   │   0    │ Lebih  │
│ ▸ HSE                │  ...  │ ... │ ... │ ... │ ...  │  ...   │  ...   │
└──────────────────────┴───────┴─────┴─────┴─────┴──────┴────────┴────────┘
        (klik baris jabatan → panel detail di kanan)
```

*(Angka pada wireframe hanya contoh ilustrasi.)*

**Cara membaca kolom:**

| Kolom | Arti |
|---|---|
| Aktual | Headcount aktif saat ini pada jabatan tersebut (otomatis dari Database Karyawan) |
| Okt / Nov / Des | Kebutuhan per bulan sesuai MPP (kolom mengikuti periode terpilih) |
| Gap | Kebutuhan periode berjalan − Aktual (positif = kurang, negatif = lebih) |
| Proses | Permintaan rekrut terbuka + kandidat yang sedang onboarding |
| Status | Kurang / Sesuai / Lebih |

**Panel detail jabatan (drawer kanan):**
1. Grafik kebutuhan vs aktual per bulan (garis kebutuhan, batang aktual, proyeksi putus-putus)
2. Daftar karyawan yang menduduki jabatan ini (tautan ke profil)
3. Pergerakan terkait (siapa yang akan keluar, kontrak berakhir, mutasi masuk/keluar)
4. Permintaan rekrut terbuka
5. Catatan perencanaan dan riwayat revisi angka kebutuhan
6. Aksi: `Buat permintaan rekrut` (nilai awal = gap)

**Fitur khusus MPP:**
- Tiga mode tampilan periode: bulanan, kuartal, tahunan (kuartal/tahunan diagregasi otomatis).
- Subtotal otomatis per departemen dan kelompok departemen, baris kelompok bisa di-collapse.
- Mode **Edit grid** seperti spreadsheet: ubah angka kebutuhan langsung di sel, tempel dari Excel, isi serentak satu baris.
- **Salin dari periode/versi sebelumnya** sebagai titik awal.
- **Versi MPP** (Draft → Diajukan → Disetujui; revisi disimpan sebagai versi baru), jadi angka lama tidak hilang.
- **Proyeksi aktual**: aktual sekarang + rencana masuk − perkiraan keluar (kontrak berakhir, resign terjadwal, mutasi keluar). Dari sini terlihat bulan mana yang akan kekurangan.
- Indikator warna status: kurang (merah), sesuai (hijau), lebih (kuning/amber).
- Filter "Hanya yang kurang" untuk fokus ke posisi yang perlu direkrut.
- Impor dan ekspor Excel dengan template baku.
- Tautan dua arah dengan sub-tab Masuk: pergerakan masuk dan keluar otomatis mengubah angka aktual dan gap.
- Komentar per baris untuk diskusi antara HR, Ops, dan manajemen.

---

## 4. Fitur Lengkap

### 4.1 Inti (MVP)
- [ ] Mode switch Pergerakan / Database Karyawan (preferensi tersimpan)
- [ ] Ringkasan KPI + tren headcount
- [ ] CRUD pergerakan 4 jenis (masuk, mutasi, promosi, keluar)
- [ ] Status workflow: Draft → Diajukan → Disetujui/Ditolak → Efektif / Dibatalkan
- [ ] Tabel dengan filter, pencarian, dan sort
- [ ] Panel detail + timeline karyawan
- [ ] Lampiran dokumen
- [ ] Sinkronisasi otomatis ke Database Karyawan saat pergerakan menjadi **Efektif** (jabatan, site, status)

### 4.2 Lanjutan
- [ ] Alur approval multi-level yang dapat dikonfigurasi
- [ ] Checklist clearance offboarding yang dapat dikonfigurasi per perusahaan/site
- [ ] Checklist onboarding (MCU, induksi, SIMPER/SIO, ID tambang)
- [ ] Alert kontrak berakhir (30/14/7 hari) dan akhir probation
- [ ] Ekspor Excel/PDF (laporan bulanan, SK)
- [ ] Notifikasi (in-app/email/WhatsApp) untuk approval dan pengingat
- [ ] Efektif terjadwal: pergerakan dengan tanggal efektif di masa depan otomatis berlaku pada tanggalnya
- [ ] Analitik turnover per departemen, alasan, masa kerja, dan kontraktor

### 4.3 MPP (Man Power Planning)
- [ ] Master kelompok departemen, departemen, dan jabatan (hierarki)
- [ ] Rencana MPP per periode (tahun) dengan kebutuhan per jabatan per bulan
- [ ] Tampilan bulanan, kuartal, dan tahunan dengan subtotal per departemen dan kelompok
- [ ] Aktual dihitung otomatis dari Database Karyawan; gap dan status dihitung otomatis
- [ ] Edit grid ala spreadsheet, impor/ekspor Excel, salin dari periode atau versi sebelumnya
- [ ] Versi dan workflow persetujuan MPP (Draft → Diajukan → Disetujui, revisi = versi baru)
- [ ] Permintaan rekrut dari baris gap, terhubung ke pergerakan Masuk
- [ ] Proyeksi aktual (memperhitungkan kontrak berakhir, resign terjadwal, rencana masuk)
- [ ] Alert: jabatan kritikal kurang, kelebihan manpower, permintaan rekrut melewati target waktu

### 4.4 Hak Akses (contoh peran)

| Peran | Lihat | Buat | Approve | Lihat gaji/grade |
|---|---|---|---|---|
| Admin HR | Semua | Ya | Ya (level HR) | Ya |
| Supervisor / Atasan | Timnya | Ajukan | Level atasan | Tidak |
| Manajemen | Semua (ringkasan) | Tidak | Level akhir | Sesuai kebijakan |
| Karyawan | Dirinya sendiri | Ajukan resign | Tidak | Dirinya sendiri |

Khusus MPP:

| Peran | Lihat MPP | Edit kebutuhan | Setujui MPP | Buat permintaan rekrut |
|---|---|---|---|---|
| Admin HR | Semua | Ya | Level HR | Ya |
| Kepala departemen | Departemennya | Usul revisi | Level departemen | Ajukan |
| Manajemen | Semua | Tidak | Level akhir | Tidak |
| Supervisor | Departemennya (baca saja) | Tidak | Tidak | Ajukan |

---

## 5. Skema Data

**Prinsip:** pola **event log**. Setiap pergerakan adalah satu baris event yang tidak ditimpa. Kondisi karyawan saat ini diturunkan dari event efektif terakhir. Riwayat utuh dan mudah diaudit.

### 5.1 `employee_movements` (tabel utama)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | Multi-tenant (OMOS SaaS) |
| `movement_no` | text | Mis. `MOV-2610-001` |
| `employee_id` | uuid | FK → employees |
| `movement_type` | enum | `HIRE`, `REHIRE`, `TRANSFER`, `PROMOTION`, `DEMOTION`, `RESIGN`, `TERMINATION`, `CONTRACT_END`, `RETIREMENT` |
| `request_date` | date | Tanggal diajukan |
| `effective_date` | date | Tanggal berlaku |
| `from_company_id` / `to_company_id` | uuid | Perusahaan / kontraktor |
| `from_site_id` / `to_site_id` | uuid | Site |
| `from_department_id` / `to_department_id` | uuid | Departemen |
| `from_position_id` / `to_position_id` | uuid | Jabatan |
| `from_grade` / `to_grade` | text | Grade |
| `from_supervisor_id` / `to_supervisor_id` | uuid | Atasan langsung |
| `from_employment_type` / `to_employment_type` | enum | PKWT / PKWTT / Harian |
| `from_work_pattern` / `to_work_pattern` | text | Pola rotasi kerja |
| `reason_code` | text | FK → movement_reasons |
| `notes` | text | Catatan |
| `status` | enum | `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`, `EFFECTIVE`, `CANCELLED` |
| `attachment_url` | text[] | SK, surat, dll. |
| `created_by`, `created_at`, `updated_at` | — | Audit |

Indeks yang disarankan: `(tenant_id, employee_id, effective_date)`, `(tenant_id, movement_type, effective_date)`, `(tenant_id, status)`.

### 5.2 `employee_exit_details` (khusus keluar)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `movement_id` | uuid | PK/FK → employee_movements |
| `last_working_day` | date | LWD |
| `exit_category` | enum | `VOLUNTARY`, `INVOLUNTARY` |
| `exit_reason` | text | Gaji, jenjang karier, pindah perusahaan, disiplin, kesehatan, dst. |
| `rehire_eligible` | boolean | Boleh dipekerjakan kembali |
| `exit_interview_notes` | text | Catatan wawancara keluar |
| `final_settlement_status` | enum | Status kompensasi akhir |

### 5.3 `exit_clearance_items`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | PK |
| `movement_id` | uuid | FK |
| `item_name` | text | ID tambang, APD, unit/alat, kunci, pinjaman, SIMPER |
| `pic_id` | uuid | Penanggung jawab |
| `is_cleared` | boolean | Sudah selesai |
| `cleared_at` | timestamp | — |

### 5.4 `employee_onboarding` (khusus masuk)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `movement_id` | uuid | PK/FK |
| `source` | text | Referral, vendor, walk-in |
| `mcu_status` | enum | Belum / Proses / Lulus / Tidak lulus |
| `safety_induction_done` | boolean | Induksi safety |
| `license_status` | text | SIMPER / SIO |
| `probation_end_date` | date | Akhir probation |

### 5.5 `movement_approvals`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | PK |
| `movement_id` | uuid | FK |
| `step` | int | Urutan level |
| `approver_id` | uuid | Pemberi keputusan |
| `decision` | enum | `PENDING`, `APPROVED`, `REJECTED` |
| `decided_at` | timestamp | — |
| `comment` | text | — |

### 5.6 `movement_reasons` (master)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `code` | text | PK |
| `movement_type` | enum | Berlaku untuk jenis apa |
| `label` | text | Teks alasan |
| `is_active` | boolean | — |

### 5.7 Relasi Ringkas

```
employees 1 ──< employee_movements 1 ──1 employee_exit_details
                      │         └──1 employee_onboarding
                      ├──< exit_clearance_items
                      └──< movement_approvals
movement_reasons 1 ──< employee_movements

department_groups 1 ──< departments 1 ──< positions
mpp_plans 1 ──< mpp_plan_lines 1 ──< mpp_line_periods
mpp_plan_lines 1 ──< manpower_requests 1 ──< employee_movements (HIRE, via mpp_line_id)
```

### 5.8 Aturan Bisnis Penting

1. Saat `status` berubah menjadi `EFFECTIVE`, sistem memperbarui field "posisi saat ini" di `employees` (site, dept, jabatan, grade, atasan, status aktif).
2. Pergerakan dengan `effective_date` di masa depan diproses oleh job harian.
3. Event tidak dihapus; pembatalan = status `CANCELLED` dengan alasan.
4. Karyawan dengan event keluar `EFFECTIVE` otomatis menjadi nonaktif, dan clearance wajib selesai sebelum status final.
5. Satu karyawan tidak boleh punya dua pergerakan aktif (belum efektif) dengan jenis yang bertentangan (mis. promosi dan resign bersamaan) tanpa konfirmasi.
6. Aktual MPP tidak diinput manual; selalu dihitung dari karyawan aktif per jabatan pada tanggal akhir periode.
7. MPP berstatus `APPROVED` tidak diubah langsung; perubahan dilakukan lewat versi revisi baru. Hanya satu versi per rencana yang berstatus "berlaku" pada satu waktu.
8. Permintaan rekrut tidak boleh melebihi gap yang tersisa (kebutuhan − aktual − permintaan terbuka), kecuali dengan override dan alasan tertulis.
9. Pergerakan `HIRE` yang efektif otomatis menutup satu slot di permintaan rekrut yang terhubung.

### 5.9 Skema MPP

**`department_groups`** (master kelompok departemen)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | Multi-tenant |
| `code`, `name` | text | Mis. `PROD` / Produksi |
| `sort_order` | int | Urutan tampil |

Tabel `departments` memiliki kolom `department_group_id` (FK), dan `positions` memiliki `department_id` (FK).

**`mpp_plans`** (header rencana)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | — |
| `site_id` | uuid | Site yang direncanakan |
| `name` | text | Mis. `MPP 2026 JMB-DKC` |
| `period_year` | int | Tahun rencana |
| `version_no` | int | 1, 2, 3, dst. |
| `is_current` | boolean | Versi yang berlaku |
| `status` | enum | `DRAFT`, `SUBMITTED`, `APPROVED`, `SUPERSEDED` |
| `revision_note` | text | Alasan revisi |
| `approved_by`, `approved_at` | — | Persetujuan |
| `created_by`, `created_at` | — | Audit |

**`mpp_plan_lines`** (satu baris per jabatan dalam rencana)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | PK |
| `plan_id` | uuid | FK → mpp_plans |
| `department_group_id` | uuid | Kelompok departemen |
| `department_id` | uuid | Departemen |
| `position_id` | uuid | Jabatan |
| `grade` | text | Opsional, jika kebutuhan dibedakan per grade |
| `employment_type` | enum | Opsional: PKWT / PKWTT / Harian |
| `is_critical` | boolean | Jabatan kritikal (untuk alert) |
| `notes` | text | Catatan perencanaan |

Unik: `(plan_id, department_id, position_id, grade)`.

**`mpp_line_periods`** (kebutuhan per bulan)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `line_id` | uuid | FK → mpp_plan_lines |
| `period_month` | date | Hari pertama bulan (mis. `2026-10-01`) |
| `required_qty` | int | Kebutuhan manpower bulan itu |

PK: `(line_id, period_month)`. Tampilan kuartal dan tahunan diagregasi dari tabel ini, sehingga tidak perlu kolom terpisah.

**`manpower_requests`** (permintaan rekrut dari gap)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | PK |
| `request_no` | text | Mis. `MPR-2610-001` |
| `mpp_line_id` | uuid | FK → mpp_plan_lines |
| `qty` | int | Jumlah yang diminta |
| `needed_by` | date | Target karyawan mulai bekerja |
| `reason` | text | Penambahan baru / pengganti / ekspansi |
| `status` | enum | `DRAFT`, `SUBMITTED`, `APPROVED`, `IN_PROGRESS`, `FULFILLED`, `CANCELLED` |
| `filled_qty` | int | Terisi (bertambah saat HIRE efektif) |
| `requested_by`, `approved_by` | uuid | — |

Kolom tambahan di `employee_movements`: `manpower_request_id` (nullable, diisi untuk `HIRE`/`REHIRE`).

**Perhitungan turunan (tidak disimpan, dihitung saat query/view):**

```
aktual(position, tanggal)   = jumlah karyawan aktif di jabatan itu pada tanggal tersebut
gap                         = required_qty − aktual            (positif = kurang)
kurang                      = max(gap, 0)
lebih                       = max(−gap, 0)
open_request                = Σ (qty − filled_qty) dari permintaan rekrut berstatus aktif
proyeksi_aktual(bulan M)    = aktual sekarang
                              + rencana masuk s/d M
                              − keluar terjadwal s/d M (kontrak berakhir, resign, mutasi keluar)
sisa_kebutuhan_rekrut       = gap − open_request
```

---

## 6. Definisi KPI

| KPI | Rumus |
|---|---|
| Headcount aktif | Jumlah karyawan berstatus aktif pada akhir periode |
| Turnover rate | Jumlah keluar dalam periode ÷ rata-rata headcount × 100% |
| Retention rate | 100% − turnover rate |
| Masa kerja rata-rata (yang keluar) | Rata-rata (LWD − tanggal masuk) |
| Early turnover | Keluar dalam < 6 bulan masa kerja ÷ total keluar |
| Rasio promosi | Jumlah promosi ÷ rata-rata headcount |
| Net movement | Masuk − Keluar |
| Fill rate MPP | Σ min(aktual, kebutuhan) ÷ Σ kebutuhan × 100% |
| Total gap (kekurangan) | Σ kekurangan semua jabatan pada periode |
| Kelebihan manpower | Σ kelebihan semua jabatan pada periode |
| Vacancy kritikal | Jumlah jabatan `is_critical` yang masih kurang |
| Time to fill | Rata-rata hari dari permintaan rekrut disetujui sampai HIRE efektif |
| Akurasi MPP | 1 − \|aktual akhir tahun − kebutuhan rencana\| ÷ kebutuhan rencana |

---

## 7. Tahapan Implementasi

| Fase | Cakupan |
|---|---|
| 1 | Skema database inti (`employee_movements`, master alasan), mode switch, sub-tab Masuk & Keluar, sinkronisasi ke Database Karyawan |
| 2 | Sub-tab Mutasi & Promosi, panel detail, lampiran dokumen, Riwayat |
| 3 | **MPP dasar**: master kelompok departemen, rencana MPP + kebutuhan per bulan, tampilan aktual vs kebutuhan vs gap, edit grid, impor/ekspor Excel |
| 4 | Workflow approval (pergerakan dan MPP), versi MPP, permintaan rekrut terhubung ke Masuk, checklist onboarding/offboarding, alert kontrak |
| 5 | Proyeksi aktual, alert vacancy kritikal, ringkasan analitik lengkap, ekspor laporan, notifikasi, efektif terjadwal |

---

## 8. Catatan UX

- Gunakan warna badge yang sama di tabel, timeline, dan grafik agar pengguna cepat mengenali jenis pergerakan.
- Kolom **"Dari → ke"** adalah kolom paling informatif, jadi beri lebar yang cukup dan jangan dipotong.
- Empty state yang ramah: *"Belum ada pergerakan di periode ini"* + tombol `Catat pergerakan`.
- Data sensitif (gaji, grade) disembunyikan sesuai peran, bukan sekadar dikosongkan.
- Mobile: tabel berubah menjadi kartu per pergerakan; panel detail menjadi halaman penuh.
- MPP: tabel dibuat sticky di kolom Jabatan dan Aktual agar tetap terlihat saat menggulir kolom bulan ke samping. Di mobile, tampilkan satu bulan terpilih dengan kartu per jabatan.
- MPP: status Kurang/Sesuai/Lebih selalu disertai angka, jangan hanya warna, supaya terbaca juga saat dicetak hitam-putih.
