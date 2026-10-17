# Deploy Tanya OMOS (migrasi 100)

Prasyarat: migrasi 099 sudah jalan, key & `app.env` LLM terpasang (`ops/biznet/deploy_llm_agent.py`), uji model HTTP 200.

## Urutan
1. **Backup DB** (prosedur biasa).
2. **Preflight**: `node backend/src/scripts/run_migration_100_ai_ask_hse.js --check` (memastikan 099 ada).
3. **Migrasi**: `node backend/src/scripts/run_migration_100_ai_ask_hse.js`. Rollback: `backend/migrations/100_ai_ask_hse_down.sql`.
4. **Rilis ulang container** (`release-app.sh`) agar kode baru + mount key/env terbaca.
5. Dashboard: naikkan versi aset (`hse-ask.js?v=1`, `hse.js?v=9`, `hse.css?v=4` sudah di `index.html`).

## Uji bertahap
1. Setup master → Asisten AI → Tanya OMOS = **Uji** (hanya Admin Utama).
2. Jalankan evaluasi perencana (butuh jaringan ke LLM, tanpa menulis DB):
   `node backend/src/scripts/eval_hse_ask.js --runs 2`
   Target: akurasi tool ≥ 85%, penolakan benar 100%, konsisten ≥ 90%. Catat latensi median/p90.
3. Smoke test manual (Admin Utama): tanya 1 pertanyaan per halaman (contoh bawaan), cek Sumber, klik "Buka di halaman", beri 👍.
4. Cek akun admin biasa saat mode Uji → tombol tidak muncul, `POST /ask` = 403 `ASK_ADMIN_ONLY`.
5. Bila latensi > ~20 dtk atau sering gagal: ganti model/key (`deploy_llm_agent.py`), ulangi langkah 2.
6. Mode **Aktif** setelah lulus.

## Pemantauan
- Audit: tabel `ai_requests` (agen `hse.askPlanner`/`hse.askAnswer`), hanya hash, tanpa isi pertanyaan.
- Biaya/budget memakai pengaturan Asisten AI yang sama (batas bulanan & harian).
- Mematikan cepat: Tanya OMOS = Mati (atau sakelar utama Asisten AI).

## Catatan
- Data keluar negeri: pertanyaan + ringkasan data HSE (nama disamarkan) dikirim ke penyedia LLM (disetujui D2/D8/D10).
- Gold set: `backend/test/fixtures/hse-ask-goldset.jsonl` (28 pertanyaan awal; rencana ≥ 60, tambahkan dari pertanyaan nyata saat mode Uji).
