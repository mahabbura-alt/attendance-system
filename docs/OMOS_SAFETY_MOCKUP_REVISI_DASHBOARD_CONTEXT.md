# OMOS Safety — Revisi Mockup & Konteks Fitur Dashboard (14 Okt 2026)

Status: **DIIMPLEMENTASI DI REPO LOKAL (belum di-commit, migration 101 belum dijalankan di DB server).**
Lihat §5 untuk peta implementasi. Bagian §1–§4 adalah keputusan owner yang menjadi dasar kode.

- Mockup: https://claude.ai/artifact/14jS6bG8Zh2k6sZwfRH6hU (privat, versi 40, 29 layar).
- Handoff sesi cloud: `docs/# OMOS Safety — Handoff Sesi 13 Okt via cloud.md`.
- Catatan: backend HSE lokal (migration 073–100, `backend/src/routes/hse.routes.js`) **belum di-commit**
  ke Git; handoff cloud dibuat dari GitHub `main` sehingga menganggap backend HSE belum ada.

## 1. Poin review yang disetujui owner

| # | Poin | Layar mockup |
| --- | --- | --- |
| 1 | Lapor Insiden / Near Miss dari APK | `Insiden.dc.html` (26), tile baru di Beranda |
| 2 | Tindakan segera + Stop Work + eskalasi darurat (risiko Ekstrem / Stop Work) | `Hazard.dc.html` (3) |
| 3 | Antrean kirim: gagal, konflik, sesi berakhir, master berubah | `SyncGagal.dc.html` (25), banner di Riwayat & Beranda |
| 10 | PIC minta pengalihan / perpanjangan; **delegasi hanya oleh Delegator departemen** | `PermintaanPIC.dc.html` (28), `DelegasiPIC.dc.html` (29), tombol di `UntukSaya.dc.html` |
| 12 | Inspeksi terencana dari jadwal yang di-setup admin | `JadwalInspeksi.dc.html` (27), kartu di `Inspeksi.dc.html`, badge di Beranda |
| 14 | Pelapor koreksi / batalkan laporan sebelum diproses | `RiwayatDetail.dc.html` (24) |
| 17 | Peringatan penyimpanan HP | `SyncGagal.dc.html` (25), kartu di `Offline.dc.html` |

Poin yang **tidak** dikerjakan: 4 (aktivasi akun), 5 (HP bersama/PIN), 6 (pemetaan status), 7–9, 11, 13, 15, 16.

## 2. Fitur admin dashboard HSE yang dibutuhkan

### 2.1 Setup Delegator Departemen (BARU — poin 10)
Aturan owner: delegasi/pengalihan PIC **hanya** boleh dilakukan pimpinan tertinggi departemen; Admin HSE
menetapkan siapa delegator tiap departemen di dashboard HSE.

- Lokasi UI: Modul HSE → Setup Master → tab baru **Delegator Departemen**.
- Data: satu baris per departemen (`workforce_departments`, migration 064): delegator utama (wajib),
  delegator cadangan saat cuti (opsional), masa berlaku (`valid_from`, `valid_to`), tenant/project scope.
- Usulan tabel: `hse_department_delegators` (tenant_key, project_key, department_id, delegator_user_id,
  backup_user_id, valid_from, valid_to, is_active, created_by, audit). Soft-delete; riwayat perubahan di `audit_log`.
- Validasi server: delegator harus karyawan aktif di departemen itu; satu delegator aktif per departemen per periode.
- Peringatan dashboard: departemen yang punya PIC hazard tetapi belum punya delegator.
- APK: menu "Delegasi PIC" hanya tampil bila user login adalah delegator aktif (ditentukan server, bukan klien).

### 2.2 Alur permintaan PIC (backend, poin 10)
- PIC mengirim `REASSIGN` (bukan area saya; usulan departemen opsional) atau `EXTEND` (usulan tanggal) + alasan wajib.
- Permintaan masuk ke delegator departemen PIC. Selama menunggu: PIC tetap PIC, batas waktu tetap berjalan.
- Delegator: alihkan ke PIC lain di departemennya, teruskan ke delegator departemen lain (lintas departemen),
  setujui/tolak perpanjangan (tolak wajib alasan).
- Aturan (disetujui owner): maks 1 perpanjangan per hazard; risiko Ekstrem tidak bisa diperpanjang; batas waktu tetap berjalan selama menunggu.
- Tab "Macet / lewat batas": eskalasi hazard lewat batas ke delegator departemen PIC; delegator boleh mengalihkan langsung.
- Setiap keputusan → event timeline hazard + notifikasi PIC lama/baru, pelapor, HSE; idempoten via `client_uuid`.

### 2.3 Jadwal Inspeksi Terencana (poin 12) — PERLUAS YANG SUDAH ADA
Sudah ada: tabel `hse_inspection_schedules` (085: template, lokasi **atau** unit, penugasan `EMPLOYEE`/`POSITION`,
`next_due_date`, `last_done_at`), personnel scope (086), endpoint `GET/POST/DELETE /api/hse/inspections/schedules`,
dan UI di `admin-dashboard/hse.js`. Jangan membuat subsistem baru.

Kebutuhan tambahan:
- Frekuensi eksplisit (harian/mingguan/bulanan/per shift) dan jendela waktu (mis. sebelum akhir shift) bila belum ada.
- Endpoint mobile "jadwal saya": jadwal untuk user (EMPLOYEE) + jabatannya (POSITION), dikelompokkan hari ini / minggu ini / terlewat,
  memakai **tanggal operasional** shift, bukan tanggal kalender.
- Menyelesaikan inspeksi dari jadwal → set `last_done_at`, hitung `next_due_date` berikutnya; terlewat masuk statistik.

### 2.4 Lainnya (backend, tanpa UI dashboard baru kecuali disebut)
- **Insiden (poin 1):** pakai tabel `incidents` (074). Pilihan APK dipetakan: Near Miss→`NEAR_MISS`, Orang cedera→`FAI/MTI/LTI`
  (ditetapkan HSE), Kecelakaan unit→`VEHICLE_ACCIDENT`, Kerusakan alat→`PROPERTY_DAMAGE`, Kebakaran→`FIRE`,
  Lingkungan→`ENVIRONMENTAL`. Field baru: tindakan segera, unit terlibat, `client_uuid`. Notifikasi darurat untuk jenis selain Near Miss/Kerusakan alat.
- **Hazard (poin 2):** kolom `immediate_action`, `stop_work` (boolean), notifikasi darurat ke HSE on-duty + pengawas area bila
  skor > 16 atau Stop Work. HSE on-duty dari roster shift HSE (lihat §3.3); nomor ERT + kontak fallback per site di Setup Master.
- **Sync (poin 3):** respons per item outbox dengan kode error stabil: `CONFLICT_CLOSED`, `MASTER_INACTIVE`, `AUTH_EXPIRED`,
  `VALIDATION`, `RETRYABLE`. Bukti untuk hazard yang sudah closed boleh dikirim sebagai catatan (tidak mengubah status).
- **Koreksi/batal (poin 14):** hanya pelapor, hanya saat status `NEW` (sebelum triase/PIC mulai). Koreksi = revisi baru
  (isi lama disimpan); batal = soft-cancel dengan alasan wajib, tetap tercatat, dikeluarkan dari statistik.
- **Penyimpanan (poin 17):** kebijakan di APK: kompres foto ±300 KB, foto terkirim disimpan 7 hari, < 200 MB sisa → maks 1 foto/laporan.
  Nilai ambang sebaiknya bisa diatur dari Setup (endpoint bootstrap).

## 3. Keputusan owner (14 Okt 2026)
1. **Perpanjangan batas waktu maksimal 1 kali per hazard; risiko Ekstrem tidak bisa diperpanjang.** — DISETUJUI.
   Validasi wajib di server (bukan hanya APK).
2. **Batas waktu tetap berjalan** selama permintaan pengalihan/perpanjangan menunggu keputusan delegator. — DISETUJUI.
3. **HSE on-duty diambil dari roster shift HSE.** — DISETUJUI.
   - Sumber: roster/jadwal shift karyawan departemen HSE yang sudah ada di OMOS (cek `rosterController.js` dan tabel roster sebelum membuat yang baru).
   - Resolusi berdasarkan **tanggal operasional + shift** saat kejadian, bukan jam kalender (shift malam melewati tengah malam).
   - Bila lebih dari satu HSE on-duty: semua menerima notifikasi darurat; tombol telepon APK memakai urutan prioritas (mis. HSE Supervisor dulu).
   - Fallback bila roster kosong: kontak darurat per site dari Setup Master HSE + peringatan di dashboard "shift tanpa HSE on-duty".
   - APK menyimpan daftar on-duty untuk shift berjalan dan berikutnya di data master offline (untuk kondisi tanpa sinyal).
   - Nomor telepon termasuk data pribadi: hanya dikirim ke user yang login, tidak dicatat di log.

4. **Notifikasi memakai polling, tanpa FCM / push pihak ketiga.** — DIPUTUSKAN OWNER.
   - APK memeriksa `GET` notifikasi baru lewat WorkManager periodik (minimum Android ±15 menit), setiap sync,
     saat aplikasi dibuka/kembali ke depan, dan lewat tarik-untuk-refresh. Notifikasi lokal Android dibuat oleh APK sendiri.
   - Endpoint pakai kursor (`since` / id terakhir) agar ringan dan idempoten; server menyimpan notifikasi di tabel (mis. `hse_notifications`) dengan status baca per user.
   - Konsekuensi yang diterima: notifikasi bisa tertunda ±15 menit atau lebih (mode hemat daya). Karena itu alur **darurat
     (Ekstrem, Stop Work, insiden) tidak boleh bergantung pada notifikasi** — APK wajib menonjolkan tombol telepon HSE on-duty (roster) / ERT.
   - Tidak menambah sistem eksternal; data notifikasi tetap di server Biznet. FCM bisa ditambahkan kelak sebagai "bel" tanpa ubah desain (perlu keputusan owner).

## 4. Keputusan yang masih terbuka
- Tidak ada untuk lingkup mockup ini.

## 5. Implementasi (14 Okt 2026) — VERIFIED_REPO, belum di-deploy

| Bagian | File |
| --- | --- |
| Migration | `backend/migrations/101_hse_mobile_safety.sql` (+ `_down.sql`), npm `migration:hse-mobile-safety`. Diuji PGlite naik→turun→naik. **Belum dijalankan di DB `backend/.env` (server remote).** |
| Login Employee ID & reset sandi (port PR #1) | `backend/src/services/passwordReset.js`, `authController.js` (`login`, `mintaResetSandi`, `gantiSandi`), `auth.routes.js`, `karyawanController.js` + `karyawan.routes.js` (`reset-requests`, `:id/reset-password`), test `backend/test/auth-employee-login.test.js` |
| API mobile | `backend/src/services/hseMobile.js`, `backend/src/routes/hseMobile.routes.js` → `/api/hse/mobile/*` (bootstrap, sync idempoten, my-reports, hazards/:id, pic/actions, verify/queue, delegator/inbox, inspections/schedules, participants, stats, notifications, app-version). APK di `/OMOS_Safety.apk` (`server.js`). |
| Admin delegator | API `GET/PUT/DELETE /api/hse/delegators[/:departmentId]` (+ `/history`) di `hse.routes.js` (requireAdmin); UI `admin-dashboard/hse-delegators.js` (tab Setup Master → Delegator Departemen), fixture `admin-dashboard/test-fixtures/hse-delegators-preview.html`, test `hse-delegators.test.js` |
| Admin reset sandi | `admin-dashboard/reset-sandi.js` + panel `#panelResetSandi` di tab Karyawan |
| APK | `mobile-safety/` (README berisi build, rilis, dan hasil uji) |
| Test | `backend/test/hse-mobile.test.js` (4 test PGlite), suite backend 538/538, admin `hse-delegators.test.js` 4/4, APK `RiskTest` |

Aturan yang ditegakkan server (bukan hanya APK): perpanjangan maks 1×, Ekstrem tidak bisa diperpanjang, hanya delegator
(utama/cadangan, periode berlaku) yang memutuskan, PIC baru harus satu departemen, PIC tidak memverifikasi pekerjaannya
sendiri (kecuali HSE), koreksi/batal hanya pelapor saat status NEW & PIC belum mulai, bukti ke hazard closed → `CONFLICT_CLOSED`,
lokasi/templat/jadwal nonaktif → `MASTER_INACTIVE`, idempotensi `client_uuid` per tabel.

Pemetaan status: hazard NEW → IN_ACTION (PIC mulai) → VERIFY (semua bukti dikirim) → CLOSED (semua aksi disetujui);
CANCELLED = dibatalkan pelapor. Aksi PIC memakai `hse_actions` (OPEN / IN_PROGRESS / DONE_PENDING_VERIFY / CLOSED).

Keterbatasan yang diketahui:
- P5M / Safety Talk tetap memakai aturan server lama: peserta wajib berstatus WAJIB, lokasi wajib dari master (mockup minta
  lintas departemen & lokasi "Lainnya" — hanya tersedia di Pertemuan K3).
- Eskalasi otomatis: worker di backend (`hseMobile.startEscalationWorker`, tiap 10 menit, matikan dengan `HSE_ESCALATION=off`, interval `HSE_ESCALATION_INTERVAL_MS`) + skrip cadangan `node src/scripts/run_hse_escalation.js`. Sekali per batas waktu (kolom `escalated_at`, direset saat perpanjangan disetujui); notifikasi ke PIC, delegator utama+cadangan, dan HSE on-duty bila Ekstrem. Aman multi-instance (FOR UPDATE SKIP LOCKED).
- "Pengawas area" pada notifikasi darurat belum ada sumber datanya; yang dinotifikasi = HSE on-duty roster.
- Foto dikirim sebagai data URL (pola HSE yang ada), maks 3 per laporan, dikompres server ±110 KB.
- Keystore rilis OMOS Safety belum dibuat; `safety-release.json` belum ada (endpoint app-version mengembalikan `available:false`).

## 6. Revisi v1.0.1 (14 Okt 2026) — Konsekuensi + Rekomendasi → CAPA → status otomatis
- Keputusan owner: kolom **Konsekuensi / potensi dampak** wajib di APK (sama dengan dashboard); **Rekomendasi perbaikan** terhubung ke CAPA dan hazard close otomatis mengikuti update PIC di APK.
- Rekomendasi disimpan di `hazard_reports.recommendation` (migration 102) dan menjadi deskripsi CAPA tiap PIC.
- Status hazard dihitung `hse.syncHazardStatusFromActions` untuk APK & dashboard: NEW/ASSESSED → IN_ACTION (PIC mulai) → VERIFY (semua bukti terkirim) → CLOSED (semua CAPA disetujui). Verifikasi pelapor/HSE tetap wajib sebelum CLOSED.
- Dashboard: Status Validasi manual hanya untuk validasi/tolak/duplikat saat CAPA sudah ada; tolak/duplikat membatalkan CAPA terbuka.
- Detail implementasi & verifikasi: `docs/OMOS_WORKING_CONTEXT_AND_HANDOVER.md` (entri v1.0.1).
