# Deploy Asisten AI HSE (trial agen LLM, migrasi 099) — runbook

Status: **BELUM DEPLOY.** Diuji di PGlite (migrasi naik → turun → naik), tes backend & dashboard, dan uji browser dengan LLM tiruan.
Rencana & alasan desain: `docs/RENCANA_IMPLEMENTASI_AGEN_LLM_HSE.md`. Provider terpilih: **NVIDIA NIM — GLM-5.3 Flash** (*free endpoint*, untuk uji coba).

Prinsip yang tidak boleh dilanggar saat deploy:
- API key **hanya** di `/opt/omos/secrets/llm_api_key` (0400, uid `node` = 1000). Tidak di git, frontend, chat, log, atau database.
- Setelah deploy, AI **tetap MATI** sampai Admin Utama menyalakannya di **HSE → Setup master → Asisten AI**.
- Bila AI mati / gagal / kuota habis, HSE tetap jalan dengan cek kata kunci lama.

## 0. Urutan
1. Rilis yang memuat People v2 (093–098) dan 092 boleh mendahului atau bersamaan — 099 tidak bergantung pada keduanya.
2. Migrasi 099 (backup terverifikasi otomatis): `sh ops/biznet/run-ai-099-release.sh /opt/omos/releases/$REL`
   Harapan verifikasi: `5 / 1 / 0` (5 tabel AI, kolom `ai_clean_description`, 0 site dengan AI aktif).
3. Pasang key (lihat §1), lalu tambahkan konfigurasi non-rahasia ke `app.env` (§2).
4. Switch release dengan `ops/biznet/release-app.sh` — skrip ini otomatis memasang file key read-only ke container bila file ada.
5. Smoke test (§4), lalu aktifkan bertahap (§5).

Rollback skema (menghapus seluruh saran & audit AI): `099_ai_foundation_hse_down.sql`. Rollback aplikasi: release sebelumnya — kolom/tabel 099 tidak mengganggu kode lama.

## 1. Pasang API key (di server)
```bash
sudo LLM_MODEL_STANDARD='<ID model GLM-5.3 Flash>' bash ops/biznet/install-llm-key.sh
```
- Key diketik/ditempel tanpa tampil, tidak masuk history, diuji dengan header dari stdin (tidak terlihat lewat `ps`).
- ID model persis: `curl -sS https://integrate.api.nvidia.com/v1/models | grep -o '"id":"[^"]*glm[^"]*"'` — jangan ditebak.
- Ganti key kapan saja dengan perintah yang sama; aplikasi membaca ulang tiap 60 detik (tanpa restart).
- Pakai key berbeda untuk staging dan produksi.

## 2. Konfigurasi `app.env` (tidak rahasia)
```
LLM_ENABLED=true
LLM_PROVIDER=nvidia_nim
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_ALLOWED_HOSTS=integrate.api.nvidia.com
LLM_API_KEY_FILE=/run/secrets/llm_api_key
LLM_MODEL_STANDARD=<ID GLM-5.3 Flash>
LLM_TIMEOUT_MS=30000
# opsional:
# LLM_MODEL_STANDARD_FALLBACK=<ID deepseek-v4.1-flash>
# LLM_PRICE_INPUT_PER_MTOK=0
# LLM_PRICE_OUTPUT_PER_MTOK=0
# LLM_EXTRA_BODY={"chat_template_kwargs":{...}}   # parameter khusus model bila diperlukan
# AI_WORKER=on                                      # worker antrean di dalam app (default on)
```
`app.env` dibaca saat container **dibuat**, jadi perubahan di sini perlu switch/recreate container (lewat `release-app.sh`).
Kode menolak base URL non-https, host di luar `LLM_ALLOWED_HOSTS`, dan redirect.

## 3. Yang berubah di aplikasi
- **Daftar & detail hazard:** saran "Kemungkinan laporan sama · dicek AI" dengan alasan & bukti; "Pola berulang" untuk jenis sama di titik berbeda; tombol **Bukan duplikat**.
- **Gabung laporan** kini wajib **alasan**, hanya untuk laporan utama yang masih terbuka, dan tercatat di `hse_hazard_merge_log`.
- **Izin baru `hse.merge`** (Admin Utama selalu boleh): centang di pengaturan sub-admin untuk HSE officer. **Tanpa izin ini sub-admin tidak bisa lagi menggabungkan hazard** — umumkan sebelum rilis.
- **✨ Saran AI** di form lapor, form edit, dan detail hazard: kategori, Kemungkinan × Akibat (skor dihitung OMOS), tindakan segera, pertanyaan kelengkapan, uraian rapi (disimpan terpisah).
- **Setup master → Asisten AI:** sakelar per site, mode per fitur (Mati / Uji diam-diam / Aktif), ambang, jendela hari, batas biaya & panggilan, pemakaian, perbandingan AI vs kata kunci.
- Worker antrean berjalan di dalam app (cek setiap 5 detik). Cadangan sekali jalan: `node backend/src/scripts/run_ai_jobs.js`.

## 4. Smoke test setelah switch
- `GET /api/hse/ai/overview` (login admin) → `server.ready=true`, `key_present=true`, tanpa potongan key.
- HSE → Setup master → Asisten AI tampil "Siap". Admin non-utama: form hanya-baca.
- Lapor hazard percobaan → di detail tidak ada error; `ai_jobs` tidak bertambah selama fitur masih Mati.
- Gabung tanpa alasan → ditolak; dengan alasan → sukses dan tercatat.

## 5. Aktivasi bertahap (trial)
1. Jalankan evaluasi offline dulu (tanpa menulis DB):
   `docker exec omos-app node backend/src/scripts/eval_hse_ai.js --ai --runs 3`
   Gold set data nyata: `psql "$DATABASE_URL" -At -f docs/drafts/hse_ai_goldset_export_readonly.sql > goldset.jsonl`, label "TINJAU" diisi HSE officer, lalu `--file goldset.jsonl`.
2. Setup → Asisten AI: sakelar utama **on**, Deteksi laporan ganda = **Uji diam-diam**, Saran AI triase = **Uji (Admin Utama saja)** → tekan **Periksa ulang semua laporan terbuka**.
3. 2 minggu: tinjau tabel "Perbandingan AI vs cek kata kunci" bersama HSE officer. Go bila presisi teramati ≥ 90%.
4. Go: ubah ke **Aktif**. No-Go: kembali ke Mati — tidak ada data yang hilang.

## 6. Catatan risiko free endpoint
Batas kuota/kecepatan tidak dipublikasikan dan endpoint bisa dibatasi/dicabut. Antrean memakai retry + backoff, dan UI kembali ke cek kata kunci bila AI belum memeriksa.
Syarat layanan NVIDIA untuk data perusahaan perlu disetujui Owner (D10) sebelum data nyata dikirim.
