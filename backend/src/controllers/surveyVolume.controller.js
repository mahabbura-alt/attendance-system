'use strict';

/** Volume survey per PIT (halaman Survey Report). Admin-only via production.routes. */
const { pool } = require('../config/db');
const ProductionController = require('./production.controller');

const err = (message, status = 400) => Object.assign(new Error(message), { status });

function isoDate(value, label) {
  const text = String(value || '');
  const parsed = Date.parse(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== text) {
    throw err(`${label} tidak valid (YYYY-MM-DD).`, 422);
  }
  return text;
}

function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw err('Tahun tidak valid.', 422);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw err('Bulan tidak valid.', 422);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { year: y, month: m, start, end: next };
}

function materialList(dataJson) {
  if (!dataJson || typeof dataJson !== 'object') return [];
  // v8: loaderCatalog[]; v6/v7: parameters/scenarios; legacy: fleetCatalog[].
  const pools = [];
  if (Array.isArray(dataJson.parameters)) pools.push(dataJson.parameters);
  if (Array.isArray(dataJson.scenarios)) pools.push(dataJson.scenarios);
  if (Array.isArray(dataJson.loaderCatalog)) pools.push(dataJson.loaderCatalog);
  if (Array.isArray(dataJson.fleetCatalog)) pools.push(dataJson.fleetCatalog);
  const out = [];
  for (const pool of pools) {
    for (const item of pool) {
      const name = String(item?.material || '').trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

async function getSurveyVolumes(req, res) {
  try {
    const now = new Date();
    const { year, month, start, end } = monthBounds(
      req.query.year || now.getFullYear(), req.query.month || (now.getMonth() + 1));
    const [volRes, planRes, equipmentPitRes, masterPitRes, productionJobs] = await Promise.all([
      pool.query(
        `SELECT tanggal::text AS tanggal, pit_area, planning_type, material, volume::float8 AS volume
         FROM survey_volumes WHERE tanggal >= $1 AND tanggal < $2 AND volume > 0`,
        [start, end]),
      pool.query(
        `SELECT planning_type, data_json FROM productivity_plans WHERE planning_type IN ('ob', 'coal')`),
      pool.query(
        `SELECT DISTINCT TRIM(lokasi) AS pit_area
         FROM equipment
         WHERE deleted_at IS NULL AND NULLIF(TRIM(lokasi), '') IS NOT NULL
         ORDER BY pit_area`),
      // Compatibility fallback for projects that have configured PIT master
      // before assigning an operational location to equipment.
      pool.query(
        `SELECT DISTINCT COALESCE(NULLIF(TRIM(kode_pit), ''), NULLIF(TRIM(nama_pit), '')) AS pit_area
         FROM production_pits
         WHERE deleted_at IS NULL
           AND COALESCE(NULLIF(TRIM(kode_pit), ''), NULLIF(TRIM(nama_pit), '')) IS NOT NULL
         ORDER BY pit_area`),
      ProductionController.buildDeployedSpoJobsData(pool, { productionMode: 'prod', operationalDate: start }),
    ]);
    const byType = new Map(planRes.rows.map(row => [String(row.planning_type), row.data_json]));
    const deployedTypes = new Set(productionJobs
      .filter(job => job && job.materialType && !job.materialTypeConflict && !job.classificationConflict)
      .map(job => String(job.materialType).toLowerCase()));
    res.json({
      year, month,
      // Kolom survey hanya mengikuti JOB yang benar-benar berstatus Prod di SPO.
      // Area operasi tidak bergantung pada ada/tidaknya fleet pada bulan yang dipilih.
      materials: {
        ob: deployedTypes.has('ob') ? materialList(byType.get('ob')) : [],
        coal: deployedTypes.has('coal') ? materialList(byType.get('coal')) : [],
      },
      pits: (equipmentPitRes.rows.length ? equipmentPitRes.rows : masterPitRes.rows).map(row => row.pit_area),
      jobs: productionJobs,
      volumes: volRes.rows,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

async function saveSurveyVolumes(req, res) {
  let client = null;
  try {
    const items = req.body?.volumes;
    if (!Array.isArray(items) || !items.length) throw err('volumes wajib berupa array tidak kosong.');
    if (items.length > 2000) throw err('Maksimal 2000 sel per penyimpanan.', 422);
    const actorId = (req.user && req.user.id) || null;
    const clean = items.map((item, index) => {
      const tanggal = isoDate(item?.tanggal, `Baris ${index + 1}: tanggal`);
      const pit = String(item?.pit_area || '').trim();
      const type = String(item?.planning_type || '').toLowerCase();
      const material = String(item?.material || '').trim();
      const volume = Number(item?.volume);
      if (!pit || pit.length > 150) throw err(`Baris ${index + 1}: pit_area wajib diisi (maks 150).`, 422);
      if (!['ob', 'coal'].includes(type)) throw err(`Baris ${index + 1}: planning_type harus ob/coal.`, 422);
      if (!material || material.length > 100) throw err(`Baris ${index + 1}: material wajib diisi (maks 100).`, 422);
      if (!Number.isFinite(volume) || volume < 0) throw err(`Baris ${index + 1}: volume harus angka ≥ 0.`, 422);
      return { tanggal, pit, type, material, volume };
    });
    client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of clean) {
        await client.query(
          `INSERT INTO survey_volumes (tanggal, pit_area, planning_type, material, volume, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (tanggal, pit_area, planning_type, material)
           DO UPDATE SET volume = EXCLUDED.volume, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
          [row.tanggal, row.pit, row.type, row.material, row.volume, actorId]);
      }
      await client.query('COMMIT');
      res.json({ saved: clean.length });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

function csvSel(daftar) {
  return daftar.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

async function exportSurveyVolumes(req, res) {
  try {
    const now = new Date();
    const { year, month, start, end } = monthBounds(
      req.query.year || now.getFullYear(), req.query.month || (now.getMonth() + 1));
    const format = String(req.query.format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
    const volRes = await pool.query(
      `SELECT tanggal::text AS tanggal, pit_area, planning_type, material, volume::float8 AS volume
       FROM survey_volumes WHERE tanggal >= $1 AND tanggal < $2 AND volume > 0
       ORDER BY tanggal, pit_area, planning_type, material`,
      [start, end]);
    const kolom = ['tanggal', 'pit_area', 'planning_type', 'material', 'volume_liter'];
    const baris = volRes.rows.map(r => [r.tanggal, r.pit_area, r.planning_type, r.material, r.volume]);
    const filename = `survey-volumes-${year}-${String(month).padStart(2, '0')}.${format}`;
    const kepala = [
      `# Volume survey ${year}-${String(month).padStart(2, '0')}`,
      `# generated_at: ${new Date().toISOString()}`,
      '# unit: volume sesuai satuan material planning (OB=BCM, Coal=Ton)',
      `# rows: ${baris.length}`,
    ];
    if (format === 'xlsx') {
      const XLSX = require('xlsx');
      const sheet = XLSX.utils.aoa_to_sheet([kolom, ...baris]);
      sheet['!cols'] = [14, 16, 14, 20, 16].map(wch => ({ wch }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Survey');
      const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(`${kepala.join('\n')}\n${csvSel(kolom)}\n${baris.map(csvSel).join('\n')}\n`);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

/* Perbandingan volume survey vs produksi ritase (net, bertruck-factor). */
async function getSurveyComparison(req, res) {
  try {
    const now = new Date();
    const { start, end } = monthBounds(
      req.query.year || now.getFullYear(), req.query.month || (now.getMonth() + 1));
    const [surveyRes, prodRes] = await Promise.all([
      pool.query(
        `SELECT tanggal::text AS tanggal, TRIM(pit_area) AS pit_area, planning_type,
                UPPER(TRIM(material)) AS material, SUM(volume)::float8 AS volume
         FROM survey_volumes WHERE tanggal >= $1 AND tanggal < $2 AND volume > 0
         GROUP BY 1, 2, 3, 4`,
        [start, end]),
      pool.query(
        `SELECT fm.tanggal::text AS tanggal, TRIM(fm.pit_area) AS pit_area,
                CASE WHEN fm.material_type = 'Coal' THEN 'coal' ELSE 'ob' END AS planning_type,
                UPPER(TRIM(COALESCE(fm.material_detail, ''))) AS material,
                SUM((rl.ritase_count - COALESCE(rl.nonprod_ritase_count, 0)) * tf.factor_value)::float8 AS volume
         FROM ritase_logs rl
         JOIN fleet_mappings fm ON fm.id = rl.fleet_mapping_id
         JOIN equipment e ON e.id = rl.dump_truck_id
         JOIN LATERAL (
           SELECT tf.factor_value FROM truck_factors tf
           WHERE tf.tanggal <= fm.tanggal
             AND tf.kategori = CASE WHEN fm.material_type = 'Coal' THEN 'Coal' ELSE 'OB' END
             AND tf.tipe_alat = e.tipe_alat
             AND UPPER(tf.material) = UPPER(COALESCE(fm.material_detail, ''))
           ORDER BY tf.tanggal DESC LIMIT 1
         ) tf ON TRUE
         WHERE rl.deleted_at IS NULL AND fm.deleted_at IS NULL
           AND fm.tanggal >= $1 AND fm.tanggal < $2
         GROUP BY 1, 2, 3, 4`,
        [start, end]),
    ]);
    const gabung = new Map();
    const kunci = r => [r.tanggal, r.pit_area, r.planning_type, r.material].join('||');
    for (const r of surveyRes.rows) {
      gabung.set(kunci(r), { tanggal: r.tanggal, pit_area: r.pit_area, planning_type: r.planning_type,
        material: r.material, survey: Number(r.volume) || 0, production: 0 });
    }
    for (const r of prodRes.rows) {
      const k = kunci(r);
      if (!gabung.has(k)) {
        gabung.set(k, { tanggal: r.tanggal, pit_area: r.pit_area, planning_type: r.planning_type,
          material: r.material, survey: 0, production: 0 });
      }
      gabung.get(k).production = Number(r.volume) || 0;
    }
    const rows = [...gabung.values()].map(r => ({ ...r, selisih: r.survey - r.production }));
    rows.sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal))
      || String(a.pit_area).localeCompare(String(b.pit_area)) || String(a.material).localeCompare(String(b.material)));
    res.json({ rows });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

module.exports = { getSurveyVolumes, saveSurveyVolumes, exportSurveyVolumes, getSurveyComparison };
