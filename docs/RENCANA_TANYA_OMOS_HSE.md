# Rencana Kerja — "Tanya OMOS" (Tanya-Jawab Data HSE)

Status: **RENCANA — belum ada kode.** Tanggal: 2026-10-13.
Dibangun di atas fondasi agen LLM HSE yang sudah ada (`backend/src/ai/`, migrasi 099). Dokumen induk: `docs/RENCANA_IMPLEMENTASI_AGEN_LLM_HSE.md`.

---

## 1. Tujuan dan batas

**Tujuan:** pengguna HSE mengetik pertanyaan dalam bahasa sehari-hari ("Berapa hazard terbuka di Workshop bulan ini?", "LTIFR Oktober berapa dan naik atau turun?", "Izin kerja apa yang kedaluwarsa minggu ini?") dan mendapat jawaban singkat **berdasarkan data HSE di OMOS**, dengan sumber yang bisa ditelusuri.

**Hanya informasi.** Tanya OMOS **tidak pernah mengubah data**, tidak membuat laporan, tidak menggabungkan hazard, tidak memberi keputusan. Ia membaca dan menjelaskan.

**Di luar cakupan (ditolak dengan sopan):** modul lain (keuangan, logistik, HR di luar data yang tampil di HSE), pertanyaan umum di luar OMOS, nasihat hukum/medis, perintah mengubah data, dan pertanyaan tentang dokumen PDF regulasi/SOP (itu agen PDF, tahap H9–H12).

## 2. Keputusan yang sudah disepakati (hasil sesi `/grill`)

| # | Keputusan | Pilihan |
|---|---|---|
| G1 | Cakupan data | **Seluruh data HSE yang boleh dilihat user** (semua tab: hazard, inspeksi, insiden, jam kerja & LTIFR/TRIR, PTW, kompetensi, event/P5M/safety talk, target/mandat) |
| G2 | Cara agen mendapat data | **Tool terbatas, hanya-baca.** LLM memilih fungsi baku; angka dihitung server; LLM hanya menyusun kalimat. **Tanpa SQL bebas.** |
| G3 | Privasi | **Disensor + ikut izin HSE.** Nama/NRP → kode sebelum ke provider, dipulihkan saat ditampilkan. Jawaban hanya dari data yang boleh dilihat penanya. |
| G4 | Kecepatan | **Target ≤ ~20 detik.** Bila model lambat/gagal: pesan "AI sedang sibuk" + saran buka halaman terkait. **Tidak pernah** jawaban karangan. |

## 3. Arsitektur

```
Pengguna → [panel "Tanya OMOS" di halaman HSE]
   POST /api/hse/ask  {pertanyaan, konteks_layar:{tab, filter, periode}}
        │
        ▼
 (1) Gerbang: izin lihat HSE, mode fitur (OFF / ADMIN_ONLY / ON), budget, rate-limit per user
        │
        ▼
 (2) PERENCANA (LLM, panggilan #1, alias omos-cheap/standard)
     Input : pertanyaan (disensor) + katalog tool (nama, deskripsi, parameter) + tanggal hari ini + konteks layar
     Output: JSON {tools:[{nama, args}], tidak_bisa_dijawab?:alasan}   ← divalidasi skema; maks 3 tool
        │
        ▼
 (3) EKSEKUTOR TOOL (kode, bukan LLM)
     - validasi nama & args (whitelist, rentang tanggal maks 24 bulan, batas baris)
     - jalankan fungsi servis HSE yang SUDAH ADA dengan scope + izin user
     - hasil diringkas & disensor; batas ukuran
        │
        ▼
 (4) PENYUSUN JAWABAN (LLM, panggilan #2)
     Input : pertanyaan + hasil tool (data, bukan perintah)
     Output: JSON {jawaban, angka_dipakai:[{label,nilai,sumber_tool}], tindak_lanjut_link?:[...]}
        │
        ▼
 (5) PENJAGA: setiap angka di `jawaban` harus ada di hasil tool (cek kode); bila tidak → jawaban ditolak,
     tampil tabel hasil tool apa adanya
        │
        ▼
 Tampil: jawaban + "Sumber: <tool>, filter, dihitung <waktu>" + tombol "Buka di halaman <tab>"
```

**Kenapa dua panggilan, bukan function-calling bawaan model:** model free endpoint belum tentu mendukung tool-calling dengan baik; format JSON + validasi skema sudah terbukti di agen lama dan portabel antar provider. Jika nanti model mendukung tool-calling stabil, perencana bisa diganti tanpa mengubah eksekutor/penjaga.

**Catatan kecepatan:** dua panggilan ≈ 2× latensi. Uji tadi menunjukkan `glm-5.3-flash` timeout 45 dtk. Target 20 dtk **belum tentu tercapai** dengan model itu — lihat §9 (syarat awal).

## 4. Katalog tool (semua hanya-baca, memakai fungsi servis yang sudah ada)

| Tool | Menjawab | Sumber fungsi (services/hse.js, hseWorkhours.js) |
|---|---|---|
| `ringkasan_hse` | gambaran umum angka utama | `getOverview` |
| `daftar_hazard` | jumlah/daftar hazard per status, lokasi, kategori, periode, risiko | `listHazards`, `getHazardDetail` |
| `statistik_pelapor_hazard` | siapa/berapa pelapor hazard | `getHazardReporterStats` |
| `daftar_tindakan` | CAPA terbuka/terlambat | `listActions` |
| `daftar_insiden` | insiden per jenis/periode/severity | `listIncidents`, `getIncidentDetail` |
| `kpi_keselamatan` | LTI, LTIFR, TRIR, tren | `computeSafetyKpi`, `getSafetyReports` |
| `jam_kerja` | jam kerja periode, rekap per karyawan/departemen | `listManhours`, workhours recap |
| `kompetensi` | lisensi hampir/sudah kedaluwarsa, matriks pelatihan, induksi | `getCompetencyOverview`, `listEmployeeLicenses`, `getTrainingMatrix`, `listInductions` |
| `izin_kerja_ptw` | izin aktif/kedaluwarsa/status | `getPtwOverview`, `listPermits` |
| `inspeksi` | template, target, capaian mandat inspeksi | `listInspectionTemplates`, `getInspectionMandateOverview` |
| `mandat_laporan` | capaian target hazard/P5M/safety talk | `getHazardReportMandateOverview`, dst |
| `agenda_event` | P5M, safety talk, event HSE | `listHseEvents` |

Aturan tool:
- Setiap tool punya skema argumen ketat (rentang tanggal, status, lokasi_id, `limit` ≤ 50, tanpa teks bebas ke query).
- Tool memanggil fungsi servis yang sama dengan halaman HSE → **angka di jawaban = angka di layar**. Tidak ada logika hitung ganda.
- Tool baru = berkas baru + tes; perubahan perilaku = versi baru (`askPlanner.v2`), versi lama dipertahankan untuk audit.

## 5. Keamanan dan privasi

1. **Izin:** gunakan izin lihat HSE yang sama dengan halaman. Scope site/departemen user dibawa ke setiap tool (`scopeFromUser`). User tidak bisa "meminjam" data yang tidak boleh dilihatnya lewat AI.
2. **Hanya-baca:** eksekutor tidak punya jalur tulis; tool tidak boleh memanggil fungsi `create*/update*/delete*/merge*`. Ada tes yang gagal bila tool terdaftar menunjuk fungsi bukan-baca.
3. **Sensor (G3):** `redact.js` yang sudah ada dipakai pada pertanyaan dan hasil tool: nama karyawan/NRP/nomor HP → `K1..Kn`, dipulihkan hanya di tampilan oleh server setelah jawaban lolos penjaga.
4. **Prompt injection:** uraian hazard/insiden adalah teks bebas dari lapangan dan bisa berisi kalimat berbahaya ("abaikan instruksi…"). Hasil tool dikirim sebagai **data bertanda** (bukan instruksi), prompt melarang mengikuti instruksi dalam data, dan keluaran divalidasi skema + penjaga angka. Tool tidak bisa memicu aksi, jadi dampak terburuk injeksi = jawaban salah yang ditolak penjaga atau tampil tabel mentah.
5. **Batas:** rate-limit per user (mis. 20/jam), budget harian/bulanan dari `ai_settings`, panjang pertanyaan maks ~500 karakter, maks 3 tool/pertanyaan.
6. **Audit:** `ai_requests` mencatat agen, versi, user, status, token, hash — **tanpa isi pertanyaan/jawaban** (konsisten dengan agen lama). Opsi riwayat: lihat §10.
7. **Penyedia luar negeri:** data HSE tersensor tetap meninggalkan negara. Keputusan D2/D8/D10 (syarat layanan & lokasi data) masih menunggu Anda; fitur ini **tidak boleh ON untuk semua user** sebelum itu diputuskan.

## 6. UI

- **Tombol "Tanya OMOS"** di pojok halaman HSE (semua tab) → panel samping (bukan halaman baru), kelas CSS `ask-*` (terpisah dari `hai-*`).
- Isi panel: kotak tanya, **contoh pertanyaan sesuai tab aktif** (klik untuk mengisi), jawaban dengan angka tebal, baris **Sumber** (tool + filter + waktu hitung), tombol **"Buka di halaman …"**, tombol 👍/👎 + alasan singkat (untuk evaluasi).
- Konteks layar (tab, periode, filter) dikirim otomatis agar "bulan ini"/"di sini" bermakna; ditampilkan ke user ("Dijawab untuk: Oktober 2026 · Workshop").
- Keadaan: memuat (dengan indikator + batas waktu), gagal (pesan jelas + coba lagi), di luar cakupan (pesan sopan + contoh yang bisa dijawab), AI mati (panel tidak tampil).
- Tampilan mengikuti pola `hse-ai.js` (`window.OMOSHseAsk`), tes jsdom seperti `hse-ai.test.js`.

## 7. Data dan migrasi

Minimal, aditif, idempoten, dengan `_down.sql` (pola 099):

- **`100_ai_ask_hse.sql`:** tambah mode fitur `ask` di `ai_settings` (default OFF), tabel `ai_ask_feedback` (request_id, user_id, rating, alasan, dibuat). Tidak menyimpan isi pertanyaan/jawaban kecuali keputusan §10 mengubahnya.
- Tanpa perubahan tabel HSE.
- Mode fitur: **OFF** → **ADMIN_ONLY** (hanya Admin Utama, untuk uji; pengganti SHADOW karena jawaban tidak punya "mode bayangan") → **ON** (user ber-izin HSE).

## 8. Evaluasi (syarat naik mode)

- **Set uji emas (gold set):** ≥ 60 pertanyaan nyata HSE JMB-DKC (hazard, LTIFR, PTW, kompetensi, jam kerja, inspeksi, termasuk pertanyaan jebakan: di luar cakupan, data tak ada, ambigu, injeksi, minta ubah data, minta data departemen lain). Tiap pertanyaan punya jawaban acuan **dihitung dari query langsung**.
- **Metrik & ambang:**
  - Akurasi angka: **100%** (angka salah = gagal rilis; penjaga harus menangkap sisanya).
  - Ketepatan pilihan tool: ≥ 90%.
  - Penolakan benar untuk pertanyaan di luar cakupan/ubah data: 100%.
  - Kebocoran lintas-izin: **0** (tes dengan user ber-scope berbeda).
  - Latensi p95: ≤ 20 dtk (G4); bila tidak tercapai, syarat §9 belum terpenuhi.
- Alat: perluas `eval_hse_ai.js` dengan mode `ask` (jalankan gold set terhadap model sungguhan, laporan akurasi per kategori).
- Pantau di produksi: rasio 👎, rasio ditolak penjaga, p95 latensi, biaya/hari.

## 9. Syarat awal (blocker) sebelum build dimulai

1. **Model yang cukup cepat.** Uji server tadi: `z-ai/glm-5.3-flash` timeout 45 dtk (belum diukur ulang). Jalankan ukur latensi (perintah di balasan sebelumnya). Bila p50 > ~8 dtk per panggilan, target 20 dtk dengan dua panggilan tidak realistis → pilih model lain/alias `omos-cheap` untuk perencana, atau gabung perencana+penyusun untuk pertanyaan sederhana.
2. **Keputusan D2/D8/D10** (data keluar negeri) minimal untuk mode ADMIN_ONLY dengan data tersensor.
3. Migrasi 099 sudah live dan jalur AI HSE (key + `app.env`) berfungsi.

## 10. Pertanyaan terbuka (default dipakai bila tidak dijawab)

| # | Pertanyaan | Default |
|---|---|---|
| Q1 | Simpan riwayat percakapan? | **Tidak** — hanya sesi di layar; audit tanpa isi. (Alternatif: simpan teks 30 hari untuk evaluasi, wajib pemberitahuan ke user.) |
| Q2 | Izin khusus `hse.ask` atau cukup izin lihat HSE? | Cukup izin lihat HSE; tambah `hse.ask` bila ingin membatasi per orang |
| Q3 | Percakapan multi-giliran ("bandingkan dengan bulan lalu")? | Ya, sampai 4 giliran terakhir di layar, tanpa disimpan |
| Q4 | Batas pemakaian per user | 20 pertanyaan/jam, 100/hari |
| Q5 | Bahasa | Indonesia; menjawab bahasa Inggris bila ditanya bahasa Inggris |

## 11. Tahapan kerja

| Tahap | Pekerjaan | Keluaran | Kriteria selesai |
|---|---|---|---|
| **T0** | Ukur latensi model; putuskan model perencana/penyusun; ambil keputusan §9 | Catatan hasil ukur + keputusan | p50/p95 terukur; model dipilih |
| **T1** | Kerangka tool: registri, skema argumen, eksekutor dengan scope+izin, tes "hanya-baca" | `ai/ask/tools/*.js`, `toolRegistry.js` + tes | Semua tool lolos tes izin lintas-scope; tes menolak fungsi tulis |
| **T2** | Agen `askPlanner.v1` & `askAnswer.v1`, penjaga angka, sensor | `ai/agents/hse/ask*.v1.js`, `askGuard.js` + tes LLM tiruan | Penjaga menolak angka yang tak ada di hasil tool |
| **T3** | Endpoint `POST /api/hse/ask`, rate-limit, budget, mode, audit; migrasi 100 | rute + migrasi + runner + tes PGlite | Mode OFF → 404/403; budget & rate-limit berfungsi |
| **T4** | Gold set + `eval_hse_ai.js --ask`; jalankan ke model sungguhan | Fixture ≥ 60 pertanyaan + laporan | Metrik §8 terpenuhi (atau daftar celah) |
| **T5** | UI panel "Tanya OMOS" | `hse-ask.js`, CSS, tombol di `index.html`, tes jsdom + uji browser | Semua keadaan UI tampil benar, dua tema, ponsel |
| **T6** | Panduan pengguna + runbook deploy | Bab baru di `PANDUAN_PENGGUNA_OMOS.md`, `DEPLOY_ASK_HSE_100.md` | Admin bisa menyalakan/mematikan tanpa developer |
| **T7** | ADMIN_ONLY di staging 2 minggu → tinjau 👎, penjaga, latensi → ON bertahap | Laporan tinjauan | Metrik stabil; keputusan ON dari Admin Utama |

Urutan T1→T2→T3 bisa dites penuh tanpa model sungguhan (LLM tiruan); hanya T0 dan T4 membutuhkan provider.

## 12. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Model lambat / kuota free habis | Fitur terasa rusak | Batas waktu + pesan jelas; fallback tanpa jawaban karangan; ganti model lewat alias |
| LLM salah memilih tool/argumen | Jawaban salah periode/lokasi | Konteks layar ditampilkan ("Dijawab untuk…"); gold set; 👎 |
| LLM salah menulis angka | Informasi menyesatkan | **Penjaga angka**; tampil tabel sumber |
| Injeksi lewat uraian hazard | Jawaban dimanipulasi | Data bertanda, tool hanya-baca, validasi skema |
| Kebocoran lintas-scope | Pelanggaran akses | Scope dibawa ke tiap tool; tes lintas-scope wajib |
| Data pribadi ke penyedia luar negeri | Kepatuhan | Sensor; mode ADMIN_ONLY dulu; keputusan D2/D8/D10 |
| Beban query berat | Kinerja DB | Batas rentang/limit; timeout query; cache hasil 60 dtk per (user, tool, args) |

## 13. Estimasi

T1–T3 ≈ 3–4 hari kerja pengembangan; T4 ≈ 1–2 hari (tergantung kecepatan menyusun gold set bersama Anda); T5 ≈ 2 hari; T6 ≈ 0,5 hari; T7 = 2 minggu pengamatan. Total ke ADMIN_ONLY ≈ 1,5 minggu, di luar waktu penyelesaian blocker §9.
