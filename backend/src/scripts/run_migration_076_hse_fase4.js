'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function run() {
  console.log('Running Migration 076: HSE Fase 4 - Izin Kerja (PTW) & Inspeksi Keselamatan...');
  const sqlPath = path.join(__dirname, '../../migrations/076_hse_fase4_ptw_inspections.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);

  // Seed item pertanyaan untuk template inspeksi
  const tmplsRes = await pool.query("SELECT id, code FROM hse_inspection_templates WHERE tenant_key = 'default'");
  const tmpls = Object.fromEntries(tmplsRes.rows.map(t => [t.code, t.id]));

  const templateQuestions = [
    // 1. TMPL-LV-01: Kendaraan Ringan (LV)
    { code: 'TMPL-LV-01', order: 1, q: 'Apakah rem utama dan rem tangan berfungsi dengan pakem?', critical: true },
    { code: 'TMPL-LV-01', order: 2, q: 'Apakah lampu utama, lampu sign, dan lampu rotary berfungsi?', critical: true },
    { code: 'TMPL-LV-01', order: 3, q: 'Apakah sabuk pengaman (seat belt) terpasang baik untuk semua kursi?', critical: true },
    { code: 'TMPL-LV-01', order: 4, q: 'Apakah radio komunikasi dua arah dapat memancar & menerima sinyal?', critical: true },
    { code: 'TMPL-LV-01', order: 5, q: 'Apakah bendera buggy whip (tinggi 3,5m) terpasang kokoh & menyala?', critical: false },
    { code: 'TMPL-LV-01', order: 6, q: 'Apakah APAR dan kotak P3K tersedia dan dalam masa berlaku?', critical: false },

    // 2. TMPL-HD-01: Alat Berat (HD/Excavator)
    { code: 'TMPL-HD-01', order: 1, q: 'Apakah sistem pengereman (service & emergency brake) berfungsi normal?', critical: true },
    { code: 'TMPL-HD-01', order: 2, q: 'Apakah sistem steering kemudi responsif dan tidak ada kebocoran oli?', critical: true },
    { code: 'TMPL-HD-01', order: 3, q: 'Apakah alarm mundur dan klakson berbunyi keras?', critical: true },
    { code: 'TMPL-HD-01', order: 4, q: 'Apakah kaca spion, kamera belakang, dan blind spot radar bersih?', critical: false },
    { code: 'TMPL-HD-01', order: 5, q: 'Apakah tangga naik/turun dan handrail kokoh tanpa retak/kerusakan?', critical: false },
    { code: 'TMPL-HD-01', order: 6, q: 'Apakah sistem pemadam otomatis (Fire Suppression System) bertekanan baik?', critical: true },

    // 3. TMPL-WSHOP-01: Workshop & 5R
    { code: 'TMPL-WSHOP-01', order: 1, q: 'Apakah jalur evakuasi dan pintu darurat bebas dari halangan barang?', critical: true },
    { code: 'TMPL-WSHOP-01', order: 2, q: 'Apakah drum oli dan limbah B3 memiliki secondary containment & spill kit?', critical: true },
    { code: 'TMPL-WSHOP-01', order: 3, q: 'Apakah perkakas kerja dan selang angin tertata rapi pada tempatnya?', critical: false },
    { code: 'TMPL-WSHOP-01', order: 4, q: 'Apakah panel listrik tertutup rapat dan terpasang rambu bahaya listrik?', critical: true },

    // 4. TMPL-APAR-01: APAR
    { code: 'TMPL-APAR-01', order: 1, q: 'Apakah jarum indikator tekanan berada di zona hijau?', critical: true },
    { code: 'TMPL-APAR-01', order: 2, q: 'Apakah pin pengaman dan segel masih utuh belum terbuka?', critical: true },
    { code: 'TMPL-APAR-01', order: 3, q: 'Apakah selang dan nozzle bebas dari sumbatan atau keretakan fisik?', critical: false },
    { code: 'TMPL-APAR-01', order: 4, q: 'Apakah posisi APAR mudah dijangkau dan rambu tanda APAR terlihat jelas?', critical: false },
  ];

  for (const item of templateQuestions) {
    if (tmpls[item.code]) {
      const existing = await pool.query(
        "SELECT id FROM hse_inspection_template_items WHERE template_id = $1 AND sort_order = $2",
        [tmpls[item.code], item.order]
      );
      if (existing.rows.length === 0) {
        await pool.query(
          "INSERT INTO hse_inspection_template_items (template_id, sort_order, question, is_critical) VALUES ($1, $2, $3, $4)",
          [tmpls[item.code], item.order, item.q, item.critical]
        );
      }
    }
  }

  // Verifikasi tabel
  const tables = [
    'hse_ptw_permits', 'hse_ptw_workers', 'hse_ptw_isolations', 'hse_ptw_handovers',
    'hse_inspection_templates', 'hse_inspection_template_items', 'hse_inspections', 'hse_inspection_answers'
  ];
  for (const t of tables) {
    const res = await pool.query(`SELECT to_regclass('public.${t}') as tbl`);
    if (!res.rows[0].tbl) throw new Error(`Table ${t} failed to create`);
  }

  console.log(JSON.stringify({
    migration: '076_hse_fase4_ptw_inspections',
    tables_ok: tables.length,
    templates_count: tmplsRes.rows.length,
  }));
}

run()
  .then(() => pool.end())
  .catch(err => {
    console.error('Migration 076 error:', err);
    pool.end();
    process.exit(1);
  });
