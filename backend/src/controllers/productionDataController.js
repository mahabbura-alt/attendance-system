'use strict';
const { pool } = require('../config/db');
const domain = require('../services/productionData');
const MtdReport = require('../services/mtdReport');
const { performance } = require('node:perf_hooks');
const { buildFleetPlanCatalogByDatesData, buildDeployedSpoJobsData, calculateWeightedFleetDistance } = require('./production.controller');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_CACHE_TTL_MS = 60_000;
const REPORT_CACHE_MAX_ENTRIES = 12;
const reportCache = new Map();
const allocationKey = parts => JSON.stringify(parts.map(p => [p.area, p.jobCode, Number(p.liters)])
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

function allocationReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw Object.assign(new Error('Alasan alokasi wajib diisi (5–1000 karakter).'), { status: 422 });
  }
  return reason;
}

function isoDate(value, label) {
  const text = String(value || '');
  const parsed = Date.parse(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== text) {
    throw Object.assign(new Error(`${label} tidak valid.`), { status: 422 });
  }
  return text;
}

function manualOverridesPayload(body = {}) {
  const provided = Object.prototype.hasOwnProperty.call(body, 'overrides');
  if (!provided) return { provided: false, rows: [] };
  if (!Array.isArray(body.overrides)) {
    throw Object.assign(new Error('Daftar nilai manual tidak valid.'), { status: 422 });
  }
  return { provided: true, rows: body.overrides };
}

async function loadReport(db, selected) {
  const startedAt = performance.now();
  const diagnostics = { queryCount: 0, sqlMs: 0, sourceMs: 0, catalogMs: 0, domainMs: 0 };
  // One transaction connection cannot execute queries concurrently. Catalog
  // helpers also use Promise.all; serialize them on this same snapshot.
  const connection = db;
  let pending = Promise.resolve();
  db = { query(...args) {
    const task = pending.then(async () => {
      const queryStartedAt = performance.now();
      try { return await connection.query(...args); }
      finally {
        diagnostics.queryCount += 1;
        diagnostics.sqlMs += performance.now() - queryStartedAt;
      }
    });
    pending = task.catch(() => {});
    return task;
  } };
  const p = domain.period(selected.year, selected.month);
  const args = [p.start, p.end];
  let reportQueries;
  try {
    reportQueries = await Promise.all([
    buildDeployedSpoJobsData(db, { productionMode: 'prod', operationalDate: p.start }),
    db.query("SELECT DISTINCT TRIM(lokasi) AS name FROM equipment WHERE deleted_at IS NULL AND NULLIF(TRIM(lokasi), '') IS NOT NULL ORDER BY name"),
    db.query(`SELECT id, nama_shift, operational_start FROM shifts WHERE LOWER(nama_shift) LIKE '%siang%' OR LOWER(nama_shift) LIKE '%malam%'
      OR id IN (SELECT shift_id FROM fleet_mappings WHERE deleted_at IS NULL AND tanggal >= $1 AND tanggal < $2
        UNION SELECT shift_id FROM fuel_logs WHERE deleted_at IS NULL AND tanggal >= $1 AND tanggal < $2
        UNION SELECT shift_id FROM rainfall_logs WHERE deleted_at IS NULL AND operational_date >= $1 AND operational_date < $2)
      ORDER BY CASE WHEN LOWER(nama_shift) LIKE '%siang%' THEN 0 ELSE 1 END, nama_shift`, args),
    db.query(`SELECT fm.*, fm.tanggal::text AS tanggal, e.kode_alat AS excavator_kode FROM fleet_mappings fm
      JOIN equipment e ON e.id=fm.excavator_id WHERE fm.deleted_at IS NULL AND fm.tanggal >= $1 AND fm.tanggal < $2`, args),
    db.query(`SELECT rl.id, rl.fleet_mapping_id, rl.dump_truck_id, rl.period_hour, rl.ritase_count,
      COALESCE(rl.nonprod_ritase_count, 0) AS nonprod_ritase_count, tf.factor_value
      FROM ritase_logs rl JOIN fleet_mappings fm ON fm.id=rl.fleet_mapping_id
      JOIN equipment e ON e.id=rl.dump_truck_id
      LEFT JOIN LATERAL (SELECT factor_value FROM truck_factors WHERE tanggal <= fm.tanggal
        AND kategori=CASE WHEN fm.material_type='Coal' THEN 'Coal' ELSE 'OB' END AND tipe_alat=e.tipe_alat
        AND UPPER(material)=UPPER(COALESCE(fm.material_detail,'')) ORDER BY tanggal DESC LIMIT 1) tf ON TRUE
      WHERE rl.deleted_at IS NULL AND fm.deleted_at IS NULL AND fm.tanggal >= $1 AND fm.tanggal < $2`, args),
    db.query(`SELECT a.* FROM ritase_distance_allocations a JOIN fleet_mappings fm ON fm.id=a.fleet_mapping_id
      WHERE a.deleted_at IS NULL AND fm.deleted_at IS NULL AND fm.tanggal >= $1 AND fm.tanggal < $2`, args),
    db.query(`SELECT r.*, r.operational_date::text AS operational_date, s.operational_start::text FROM rainfall_logs r
      JOIN shifts s ON s.id=r.shift_id WHERE r.deleted_at IS NULL AND r.operational_date >= $1 AND r.operational_date < $2`, args),
    db.query(`SELECT f.id, f.tanggal::text, f.shift_id, f.equipment_id, f.fuel_filled, e.kode_alat
      FROM fuel_logs f JOIN equipment e ON e.id=f.equipment_id WHERE f.deleted_at IS NULL AND f.tanggal >= $1 AND f.tanggal < $2 ORDER BY f.tanggal, e.kode_alat`, args),
    db.query(`SELECT id, tanggal::text, shift_id, equipment_id, area_name, job, remark FROM mining_production_logs
      WHERE deleted_at IS NULL AND tanggal >= $1 AND tanggal < $2`, args),
    db.query(`SELECT a.*,f.equipment_id,f.tanggal::text AS tanggal FROM production_fuel_allocation_sets a JOIN fuel_logs f ON f.id=a.fuel_log_id
      WHERE f.deleted_at IS NULL AND f.tanggal >= $1 AND f.tanggal < $2`, args),
    db.query(`SELECT s.* FROM production_density_snapshots s JOIN fleet_mappings fm ON fm.id=s.fleet_mapping_id
      WHERE fm.deleted_at IS NULL AND fm.tanggal >= $1 AND fm.tanggal < $2`, args),
    db.query(`SELECT r.*, r.effective_from::text AS effective_from, e.kode_alat
      FROM production_fuel_allocation_rules r JOIN equipment e ON e.id=r.equipment_id
      WHERE e.deleted_at IS NULL AND r.effective_from < $1
      ORDER BY r.equipment_id,r.effective_from DESC,r.created_at DESC`, [p.end]),
    db.query(`SELECT DISTINCT ON (f.equipment_id) f.equipment_id,f.tanggal::text,a.allocations,a.updated_at
      FROM production_fuel_allocation_sets a JOIN fuel_logs f ON f.id=a.fuel_log_id
      WHERE f.deleted_at IS NULL AND f.tanggal < $1
      ORDER BY f.equipment_id,f.tanggal DESC,a.updated_at DESC`, [p.start]),
    db.query(`SELECT id,kode_alat FROM equipment WHERE deleted_at IS NULL ORDER BY kode_alat`),
    db.query(`SELECT area, job_code, source FROM production_manual_sources`),
    db.query(`SELECT area, job_code, tanggal::text AS tanggal, shift_id, material, value
      FROM production_manual_overrides WHERE tanggal >= $1 AND tanggal < $2`, args)
    ]);
  } finally {
    // Promise.all rejects on the first SQL error, while serialized queries that
    // were already queued may still be running. Drain the queue before the
    // caller COMMITs/ROLLBACKs the transaction so one pg client never receives
    // overlapping commands.
    await pending;
  }
  diagnostics.sourceMs = performance.now() - startedAt;
  const [jobs, areas, shifts, fleets, hours, distances, rain, fuel, work, manual, snapshots, rules, allocationHistory, ruleUnits, manualSources, manualOverrides] = reportQueries;
  // A monthly report can cross multiple effective planning versions. Resolve
  // the catalog for each operational date represented by a fleet so density
  // and plan provenance remain historically correct.
  const fleetDates = [...new Set(fleets.rows.map(fleet => String(fleet.tanggal).slice(0, 10)))];
  const catalogStartedAt = performance.now();
  const catalog = await buildFleetPlanCatalogByDatesData(db, fleetDates.length ? fleetDates : [p.start]);
  diagnostics.catalogMs = performance.now() - catalogStartedAt;
  const domainStartedAt = performance.now();
  const report = domain.buildReport({ period: p, jobs, catalog, areas: areas.rows.map(a => a.name), shifts: shifts.rows,
    fleets: fleets.rows, hours: hours.rows, distances: distances.rows, rain: rain.rows,
    fuel: fuel.rows, workLogs: work.rows, manual: manual.rows, snapshots: snapshots.rows,
    rules: rules.rows, allocationHistory: allocationHistory.rows, ruleUnits: ruleUnits.rows,
    manualSources: manualSources.rows, manualOverrides: manualOverrides.rows }, calculateWeightedFleetDistance);
  diagnostics.domainMs = performance.now() - domainStartedAt;
  diagnostics.totalMs = performance.now() - startedAt;
  console.info('[Data Produksi Performance]', {
    period: `${p.year}-${String(p.month).padStart(2, '0')}`, fleetDates: fleetDates.length,
    queryCount: diagnostics.queryCount, sqlMs: Math.round(diagnostics.sqlMs),
    sourceMs: Math.round(diagnostics.sourceMs), catalogMs: Math.round(diagnostics.catalogMs),
    domainMs: Math.round(diagnostics.domainMs), totalMs: Math.round(diagnostics.totalMs),
  });
  return report;
}

async function loadReportRevision(db, selected) {
  const p = domain.period(selected.year, selected.month);
  const result = await db.query(`SELECT md5(concat_ws('|',
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT * FROM fleet_mappings WHERE tanggal >= $1 AND tanggal < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT rl.* FROM ritase_logs rl JOIN fleet_mappings fm ON fm.id=rl.fleet_mapping_id WHERE fm.tanggal >= $1 AND fm.tanggal < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT a.* FROM ritase_distance_allocations a JOIN fleet_mappings fm ON fm.id=a.fleet_mapping_id WHERE fm.tanggal >= $1 AND fm.tanggal < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT * FROM rainfall_logs WHERE operational_date >= $1 AND operational_date < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT * FROM fuel_logs WHERE tanggal >= $1 AND tanggal < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT * FROM mining_production_logs WHERE tanggal >= $1 AND tanggal < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.fuel_log_id)::text FROM (SELECT a.* FROM production_fuel_allocation_sets a JOIN fuel_logs f ON f.id=a.fuel_log_id WHERE f.tanggal < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.fleet_mapping_id, x.identity_key)::text FROM (SELECT s.* FROM production_density_snapshots s JOIN fleet_mappings fm ON fm.id=s.fleet_mapping_id WHERE fm.tanggal >= $1 AND fm.tanggal < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT * FROM production_fuel_allocation_rules WHERE effective_from < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.planning_type, x.effective_from, x.revision)::text FROM (SELECT * FROM productivity_plan_versions WHERE effective_from < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.planning_type)::text FROM (SELECT * FROM productivity_plans WHERE planning_type IN ('spo','ob','coal','pa-ua-ewh')) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT * FROM equipment) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.job_code)::text FROM (SELECT * FROM master_job_codes) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM (SELECT * FROM shifts) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.area, x.job_code)::text FROM (SELECT * FROM production_manual_sources) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.area, x.job_code, x.tanggal, x.shift_id, x.material)::text FROM (SELECT * FROM production_manual_overrides WHERE tanggal >= $1 AND tanggal < $2) x), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tanggal, x.kategori, x.tipe_alat, x.material)::text FROM (SELECT * FROM truck_factors WHERE tanggal < $2) x), '[]')
  )) AS revision`, [p.start, p.end]);
  return { period: p, revision: result.rows[0]?.revision || 'empty' };
}

function respondError(res, err) {
  if (err.code === '42P01' && /production_fuel_allocation_rules/i.test(err.message || '')) {
    return res.status(503).json({ error: 'Aturan alokasi fuel belum siap. Migrasi 037 perlu diterapkan.' });
  }
  if ((err.code === '42P01' || err.code === '42703') && /production_fuel_allocation_batches|batch_id/i.test(err.message || '')) {
    return res.status(503).json({ error: 'Alokasi Cepat belum siap. Migrasi 036 perlu diterapkan.' });
  }
  if (err.code === '42P01' && /production_manual_sources|production_manual_overrides/i.test(err.message || '')) {
    return res.status(503).json({ error: 'Sumber data manual belum siap. Migrasi 047 perlu diterapkan.' });
  }
  if (err.code === '42P01') return res.status(503).json({ error: 'Data Produksi belum siap. Migrasi 035 perlu diterapkan.' });
  console.error('[Data Produksi]', {
    code: err.code || null,
    status: err.status || null,
    message: err.message || 'Unknown error'
  });
  return res.status(err.status || 500).json({ error: err.status ? err.message : 'Data Produksi gagal diproses. Silakan coba lagi.' });
}

async function getReport(req, res) {
  let db;
  const requestStartedAt = performance.now();
  try {
    db = await pool.connect();
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const revisionStartedAt = performance.now();
    const revision = await loadReportRevision(db, req.query);
    const revisionMs = performance.now() - revisionStartedAt;
    // Version the representation so pre-fix reports are not reused by browsers.
    const etag = `"pd-v3-${revision.period.year}-${revision.period.month}-${revision.revision}"`;
    if (String(req.headers['if-none-match'] || '').split(',').map(value => value.trim()).includes(etag)) {
      await db.query('COMMIT');
      console.info('[Data Produksi Cache]', { state: 'validated', revisionMs: Math.round(revisionMs), totalMs: Math.round(performance.now() - requestStartedAt) });
      return res.status(304).set('ETag', etag).set('Cache-Control', 'private, no-cache, must-revalidate')
        .set('Vary', 'Authorization').set('Server-Timing', `revision;dur=${revisionMs.toFixed(1)}`).end();
    }
    const scope = String(req.user?.tenant_id || req.user?.tenantId || req.user?.project_id || req.user?.projectId || 'isolated-client-db');
    const cacheKey = `${scope}:${revision.period.year}:${revision.period.month}:${revision.revision}`;
    const cached = reportCache.get(cacheKey);
    const cacheHit = Boolean(cached && Date.now() - cached.storedAt <= REPORT_CACHE_TTL_MS);
    const reportStartedAt = performance.now();
    const report = cacheHit ? cached.report : await loadReport(db, req.query);
    const reportMs = performance.now() - reportStartedAt;
    if (!cacheHit) {
      reportCache.set(cacheKey, { storedAt: Date.now(), report });
      while (reportCache.size > REPORT_CACHE_MAX_ENTRIES) reportCache.delete(reportCache.keys().next().value);
    }
    await db.query('COMMIT');
    console.info('[Data Produksi Cache]', { state: cacheHit ? 'hit' : 'miss', revisionMs: Math.round(revisionMs),
      reportMs: Math.round(reportMs), totalMs: Math.round(performance.now() - requestStartedAt) });
    res.set('ETag', etag).set('Cache-Control', 'private, no-cache, must-revalidate')
      .set('Vary', 'Authorization')
      .set('Server-Timing', `revision;dur=${revisionMs.toFixed(1)}, report;dur=${reportMs.toFixed(1)}`).json(report);
  } catch (err) { if (db) await db.query('ROLLBACK'); respondError(res, err); }
  finally { db?.release(); }
}

async function saveAllocation(req, res) {
  let db;
  try {
    if (!UUID_PATTERN.test(req.params.id || '')) {
      throw Object.assign(new Error('ID transaksi fuel tidak valid.'), { status: 422 });
    }
    if (!Number.isInteger(req.body.revision) || req.body.revision < 0) {
      throw Object.assign(new Error('Versi alokasi tidak valid. Muat ulang laporan.'), { status: 422 });
    }
    db = await pool.connect(); await db.query('BEGIN');
    const found = await db.query(`SELECT id, tanggal::text, shift_id, equipment_id, fuel_filled FROM fuel_logs WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [req.params.id]);
    const fuel = found.rows[0];
    if (!fuel) throw Object.assign(new Error('Transaksi fuel tidak ditemukan.'), { status: 404 });
    const previous = (await db.query('SELECT * FROM production_fuel_allocation_sets WHERE fuel_log_id=$1', [fuel.id])).rows[0];
    if (req.body.fingerprint !== domain.fingerprint(fuel)) throw Object.assign(new Error('Transaksi fuel berubah. Muat ulang laporan sebelum mengalokasikan.'), { status: 409 });
    const month = { year: Number(fuel.tanggal.slice(0, 4)), month: Number(fuel.tanggal.slice(5, 7)) };
    const report = await loadReport(db, month);
    const allocations = domain.validateAllocation(req.body.allocations, fuel.fuel_filled, report.jobs, report.areas);
    const reason = allocationReason(req.body.reason);
    // Identical retry succeeds without another revision/audit event.
    if (previous?.source_fingerprint === req.body.fingerprint && allocationKey(previous.allocations) === allocationKey(allocations) && previous.reason === reason) {
      await db.query('COMMIT'); return res.json({ saved: true, revision: previous.revision });
    }
    if (Number(req.body.revision) !== (previous?.revision || 0)) throw Object.assign(new Error('Alokasi sudah diubah admin lain. Muat ulang laporan.'), { status: 409 });
    const saved = (await db.query(`INSERT INTO production_fuel_allocation_sets(fuel_log_id,source_fingerprint,allocations,reason,updated_by)
      VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(fuel_log_id) DO UPDATE SET source_fingerprint=EXCLUDED.source_fingerprint,
      allocations=EXCLUDED.allocations,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now(),revision=production_fuel_allocation_sets.revision+1 RETURNING *`,
    [fuel.id, req.body.fingerprint, JSON.stringify(allocations), reason, req.user.id])).rows[0];
    await db.query(`INSERT INTO production_fuel_allocation_audit(fuel_log_id,previous_value,new_value,actor_id) VALUES($1,$2::jsonb,$3::jsonb,$4)`,
      [fuel.id, JSON.stringify(previous || null), JSON.stringify(saved), req.user.id]);
    await db.query('COMMIT'); res.json({ saved: true, revision: saved.revision });
  } catch (err) { if (db) await db.query('ROLLBACK'); respondError(res, err); }
  finally { db?.release(); }
}

async function saveAllocationBatch(req, res) {
  let db; let transactionActive = false;
  try {
    const items = req.body?.items;
    if (!Array.isArray(items) || !items.length || items.length > 100) {
      throw Object.assign(new Error('Pilih 1–100 transaksi fuel untuk Alokasi Cepat.'), { status: 422 });
    }
    const ids = items.map(item => String(item.id || ''));
    if (ids.some(id => !UUID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
      throw Object.assign(new Error('Daftar transaksi fuel berisi ID tidak valid atau duplikat.'), { status: 422 });
    }
    for (const item of items) {
      if (!Number.isInteger(item.revision) || item.revision < 0) {
        throw Object.assign(new Error('Versi alokasi tidak valid. Muat ulang laporan.'), { status: 422 });
      }
    }
    const reason = allocationReason(req.body.reason);
    db = await pool.connect(); await db.query('BEGIN'); transactionActive = true;
    const found = await db.query(`SELECT f.id, f.tanggal::text, f.shift_id, f.equipment_id, f.fuel_filled, e.kode_alat
      FROM fuel_logs f JOIN equipment e ON e.id=f.equipment_id
      WHERE f.id=ANY($1::uuid[]) AND f.deleted_at IS NULL ORDER BY f.id FOR UPDATE OF f`, [ids]);
    if (found.rows.length !== ids.length) {
      throw Object.assign(new Error('Satu atau lebih transaksi fuel tidak ditemukan. Muat ulang laporan.'), { status: 404 });
    }
    const fuels = new Map(found.rows.map(row => [row.id, row]));
    const periods = new Set(found.rows.map(row => String(row.tanggal).slice(0, 7)));
    if (periods.size !== 1) {
      throw Object.assign(new Error('Alokasi Cepat hanya dapat memproses transaksi dalam bulan operasional yang sama.'), { status: 422 });
    }
    const firstDate = String(found.rows[0].tanggal);
    const report = await loadReport(db, { year: Number(firstDate.slice(0, 4)), month: Number(firstDate.slice(5, 7)) });
    const previousRows = (await db.query('SELECT * FROM production_fuel_allocation_sets WHERE fuel_log_id=ANY($1::uuid[])', [ids])).rows;
    const previousMap = new Map(previousRows.map(row => [row.fuel_log_id, row]));
    const validated = items.map(item => {
      const fuel = fuels.get(item.id); const previous = previousMap.get(item.id);
      if (item.fingerprint !== domain.fingerprint(fuel)) {
        throw Object.assign(new Error(`Transaksi ${fuel.kode_alat} tanggal ${fuel.tanggal} berubah. Muat ulang laporan sebelum mengalokasikan.`), { status: 409 });
      }
      const allocations = domain.validateAllocation(
        [{ area: item.area, jobCode: item.jobCode, liters: Number(fuel.fuel_filled) }],
        fuel.fuel_filled, report.jobs, report.areas
      );
      const identical = previous?.source_fingerprint === item.fingerprint
        && allocationKey(previous.allocations) === allocationKey(allocations)
        && previous.reason === reason;
      if (!identical && Number(item.revision) !== (previous?.revision || 0)) {
        throw Object.assign(new Error(`Alokasi ${fuel.kode_alat} tanggal ${fuel.tanggal} sudah diubah admin lain. Muat ulang laporan.`), { status: 409 });
      }
      return { item, fuel, previous, allocations, identical };
    });
    const destinations = new Map(); let totalLiters = 0;
    for (const row of validated) {
      const liters = Number(row.fuel.fuel_filled); totalLiters += liters;
      const destination = row.allocations[0]; const id = `${destination.area}\u0000${destination.jobCode}`;
      destinations.set(id, { area: destination.area, jobCode: destination.jobCode,
        transactions: (destinations.get(id)?.transactions || 0) + 1,
        liters: (destinations.get(id)?.liters || 0) + liters });
    }
    const rulesToCreate = [];
    if (req.body.createRules === true) {
      const effectiveFrom = isoDate(req.body.effectiveFrom, 'Tanggal efektif aturan');
      if (effectiveFrom.slice(0, 7) !== firstDate.slice(0, 7)) {
        throw Object.assign(new Error('Tanggal efektif aturan harus berada dalam bulan transaksi yang dipilih.'), { status: 422 });
      }
      const requested = new Map();
      for (const row of validated) {
        const destination = row.allocations[0]; const existing = requested.get(row.fuel.equipment_id);
        if (existing && (existing.area !== destination.area || existing.jobCode !== destination.jobCode)) {
          throw Object.assign(new Error(`${row.fuel.kode_alat} memiliki lebih dari satu tujuan dalam batch; aturan unit tidak dapat dibuat.`), { status: 422 });
        }
        requested.set(row.fuel.equipment_id, { equipmentId: row.fuel.equipment_id, unit: row.fuel.kode_alat,
          area: destination.area, jobCode: destination.jobCode, effectiveFrom });
      }
      const existingRules = (await db.query(`SELECT equipment_id,effective_from::text,area_name,job_code,is_active
        FROM production_fuel_allocation_rules WHERE equipment_id=ANY($1::uuid[]) AND effective_from=$2`,
      [[...requested.keys()], effectiveFrom])).rows;
      const existingMap = new Map(existingRules.map(rule => [rule.equipment_id, rule]));
      for (const rule of requested.values()) {
        const existing = existingMap.get(rule.equipmentId);
        if (existing && (existing.is_active === false || domain.key(existing.area_name) !== domain.key(rule.area)
          || domain.key(existing.job_code) !== domain.key(rule.jobCode))) {
          throw Object.assign(new Error(`Aturan ${rule.unit} pada ${effectiveFrom} sudah tersedia dengan tujuan berbeda.`), { status: 409 });
        }
        if (!existing) rulesToCreate.push(rule);
      }
    }
    const summary = { transactions: validated.length, totalLiters, destinations: [...destinations.values()], rulesToCreate: rulesToCreate.length };
    if (req.body.dryRun === true) {
      await db.query('ROLLBACK'); transactionActive = false;
      return res.json({ valid: true, summary });
    }
    const changes = validated.filter(row => !row.identical);
    let batchId = null;
    if (changes.length || rulesToCreate.length) {
      batchId = (await db.query(`INSERT INTO production_fuel_allocation_batches(transaction_count,total_liters,reason,created_by)
        VALUES($1,$2,$3,$4) RETURNING id`, [validated.length, totalLiters, reason, req.user.id])).rows[0].id;
    }
    for (const row of changes) {
      const saved = (await db.query(`INSERT INTO production_fuel_allocation_sets(fuel_log_id,source_fingerprint,allocations,reason,updated_by)
        VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(fuel_log_id) DO UPDATE SET source_fingerprint=EXCLUDED.source_fingerprint,
        allocations=EXCLUDED.allocations,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now(),revision=production_fuel_allocation_sets.revision+1 RETURNING *`,
      [row.fuel.id, row.item.fingerprint, JSON.stringify(row.allocations), reason, req.user.id])).rows[0];
      await db.query(`INSERT INTO production_fuel_allocation_audit(fuel_log_id,previous_value,new_value,actor_id,batch_id)
        VALUES($1,$2::jsonb,$3::jsonb,$4,$5)`, [row.fuel.id, JSON.stringify(row.previous || null), JSON.stringify(saved), req.user.id, batchId]);
    }
    for (const rule of rulesToCreate) {
      await db.query(`INSERT INTO production_fuel_allocation_rules(equipment_id,area_name,job_code,effective_from,reason,source_batch_id,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [rule.equipmentId, rule.area, rule.jobCode, rule.effectiveFrom, reason, batchId, req.user.id]);
    }
    await db.query('COMMIT'); transactionActive = false;
    res.json({ saved: true, batchId, changed: changes.length, rulesCreated: rulesToCreate.length, summary });
  } catch (err) { if (db && transactionActive) await db.query('ROLLBACK'); respondError(res, err); }
  finally { db?.release(); }
}

async function createAllocationRule(req, res) {
  let db; let transactionActive = false;
  try {
    const equipmentId = String(req.body?.equipmentId || '');
    if (!UUID_PATTERN.test(equipmentId)) throw Object.assign(new Error('Unit aturan tidak valid.'), { status: 422 });
    const effectiveFrom = isoDate(req.body.effectiveFrom, 'Tanggal efektif aturan');
    const reason = allocationReason(req.body.reason); const active = req.body.active !== false;
    db = await pool.connect(); await db.query('BEGIN'); transactionActive = true;
    const equipment = (await db.query(`SELECT id,kode_alat FROM equipment WHERE id=$1 AND deleted_at IS NULL FOR SHARE`, [equipmentId])).rows[0];
    if (!equipment) throw Object.assign(new Error('Unit tidak ditemukan atau sudah tidak aktif.'), { status: 404 });
    const report = await loadReport(db, { year: Number(effectiveFrom.slice(0, 4)), month: Number(effectiveFrom.slice(5, 7)) });
    const destination = domain.validateAllocation([{ area: req.body.area, jobCode: req.body.jobCode, liters: 1 }], 1, report.jobs, report.areas)[0];
    const previous = (await db.query(`SELECT * FROM production_fuel_allocation_rules WHERE equipment_id=$1 AND effective_from=$2`,
      [equipmentId, effectiveFrom])).rows[0];
    if (previous) {
      const identical = domain.key(previous.area_name) === domain.key(destination.area)
        && domain.key(previous.job_code) === domain.key(destination.jobCode) && previous.is_active === active && previous.reason === reason;
      if (!identical) throw Object.assign(new Error(`Aturan ${equipment.kode_alat} pada ${effectiveFrom} sudah tersedia. Gunakan tanggal efektif lain.`), { status: 409 });
      await db.query('COMMIT'); transactionActive = false; return res.json({ saved: true, id: previous.id, idempotent: true });
    }
    const saved = (await db.query(`INSERT INTO production_fuel_allocation_rules(equipment_id,area_name,job_code,effective_from,is_active,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [equipmentId, destination.area, destination.jobCode, effectiveFrom, active, reason, req.user.id])).rows[0];
    await db.query('COMMIT'); transactionActive = false; res.status(201).json({ saved: true, id: saved.id });
  } catch (err) { if (db && transactionActive) await db.query('ROLLBACK'); respondError(res, err); }
  finally { db?.release(); }
}

async function captureDensity(req, res) {
  let db;
  try {
    db = await pool.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const report = await loadReport(db, req.body);
    let captured = 0;
    for (const item of report.densityCandidates) {
      const result = await db.query(`INSERT INTO production_density_snapshots(fleet_mapping_id,identity_key,density,plan_ref,plan_updated_at,captured_by)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [item.fleetId, item.identityKey, item.density, item.planRef, item.planUpdatedAt, req.user.id]);
      captured += result.rowCount;
    }
    await db.query('COMMIT'); res.json({ captured });
  } catch (err) { if (db) await db.query('ROLLBACK'); respondError(res, err); }
  finally { db?.release(); }
}

async function saveManualSource(req, res) {
  let db; let transactionActive = false;
  try {
    const area = String(req.body?.area || '').trim();
    const jobCode = String(req.body?.jobCode || '').trim();
    const source = String(req.body?.source || '');
    if (!area || !jobCode) throw Object.assign(new Error('Area dan JOB wajib diisi.'), { status: 422 });
    if (!['ritase', 'manual'].includes(source)) throw Object.assign(new Error('Sumber data tidak valid.'), { status: 422 });
    const overridePayload = manualOverridesPayload(req.body);
    const overridesRaw = overridePayload.rows;
    const overrides = []; const seen = new Set();
    for (const item of overridesRaw) {
      const material = String(item?.material || '').trim();
      const value = Number(item?.value);
      const tanggal = isoDate(item?.tanggal, 'Tanggal nilai manual');
      const shiftId = String(item?.shiftId || '');
      if (!material || !shiftId) throw Object.assign(new Error('Material, tanggal, dan shift nilai manual wajib diisi.'), { status: 422 });
      if (material !== 'TOTAL' && (!Number.isFinite(value) || value < 0)) {
        throw Object.assign(new Error('Nilai manual harus angka tidak negatif.'), { status: 422 });
      }
      const id = `${tanggal}\u0000${shiftId}\u0000${material}`;
      if (seen.has(id)) throw Object.assign(new Error('Ada nilai manual duplikat (tanggal/shift/material sama).'), { status: 422 });
      seen.add(id);
      overrides.push({ tanggal, shiftId, material, value });
    }
    db = await pool.connect(); await db.query('BEGIN'); transactionActive = true;
    const report = await loadReport(db, { year: req.body.year, month: req.body.month });
    if (!report.areas.some(a => domain.key(a) === domain.key(area))) {
      throw Object.assign(new Error('Area tidak tersedia pada laporan.'), { status: 422 });
    }
    if (!report.jobs.some(j => domain.key(j.jobCode) === domain.key(jobCode))) {
      throw Object.assign(new Error('JOB tidak tersedia pada laporan.'), { status: 422 });
    }
    const shiftIds = new Set(report.shifts.map(s => s.id));
    for (const o of overrides) {
      if (!shiftIds.has(o.shiftId)) throw Object.assign(new Error('Shift nilai manual tidak tersedia pada laporan.'), { status: 422 });
    }
    const previousSource = (await db.query('SELECT * FROM production_manual_sources WHERE area=$1 AND job_code=$2 FOR UPDATE',
      [area, jobCode])).rows[0];
    const previousOverrides = (await db.query('SELECT * FROM production_manual_overrides WHERE area=$1 AND job_code=$2',
      [area, jobCode])).rows;
    const sameSource = previousSource?.source === source;
    const sameOverrides = !overridePayload.provided || (previousOverrides.length === overrides.length
      && overrides.every(o => previousOverrides.some(p => p.tanggal === o.tanggal && p.shift_id === o.shiftId
        && domain.key(p.material) === domain.key(o.material) && Number(p.value) === o.value)));
    if (sameSource && sameOverrides) {
      await db.query('COMMIT'); transactionActive = false;
      return res.json({ saved: true, idempotent: true, source,
        overrides: overridePayload.provided ? overrides.length : previousOverrides.length });
    }
    await db.query(`INSERT INTO production_manual_sources(area, job_code, source, updated_by, updated_at)
      VALUES($1,$2,$3,$4,now()) ON CONFLICT(area, job_code) DO UPDATE SET source=EXCLUDED.source,
      updated_by=EXCLUDED.updated_by, updated_at=now()`, [area, jobCode, source, req.user.id]);
    if (overridePayload.provided) {
      await db.query('DELETE FROM production_manual_overrides WHERE area=$1 AND job_code=$2', [area, jobCode]);
      for (const o of overrides) {
        await db.query(`INSERT INTO production_manual_overrides(area, job_code, tanggal, shift_id, material, value, updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [area, jobCode, o.tanggal, o.shiftId, o.material, o.value, req.user.id]);
      }
    }
    const persistedCount = overridePayload.provided
      ? Number((await db.query('SELECT COUNT(*)::int AS count FROM production_manual_overrides WHERE area=$1 AND job_code=$2',
        [area, jobCode])).rows[0]?.count || 0)
      : previousOverrides.length;
    if (overridePayload.provided && persistedCount !== overrides.length) {
      throw Object.assign(new Error('Jumlah nilai manual tersimpan tidak sesuai payload.'), { status: 409 });
    }
    await db.query('COMMIT'); transactionActive = false;
    res.json({ saved: true, source, overrides: persistedCount });
  } catch (err) { if (db && transactionActive) await db.query('ROLLBACK'); respondError(res, err); }
  finally { db?.release(); }
}

async function loadMtdSources(db, filters) {
  const productionReport = await loadReport(db, { year: filters.year, month: filters.month });
  const planRows = (await db.query(`SELECT d.*, d.operational_date::text AS operational_date
    FROM fleet_deployment_days d
    WHERE d.deleted_at IS NULL AND d.is_published=TRUE
      AND d.operational_date >= $1 AND d.operational_date < $2
    ORDER BY d.operational_date, d.loader_code_snapshot`, [filters.start, filters.end])).rows;
  const targetRow = (await db.query(`SELECT * FROM production_targets
    WHERE periode=DATE_TRUNC('month', $1::date) LIMIT 1`, [filters.start])).rows[0] || null;
  const workRows = (await db.query(`SELECT l.tanggal::text AS tanggal, l.shift_id, l.equipment_id,
      l.area_name, l.job, l.total_hm::float, e.kode_alat
    FROM mining_production_logs l JOIN equipment e ON e.id=l.equipment_id
    WHERE l.deleted_at IS NULL AND l.tanggal >= $1 AND l.tanggal < $2
    ORDER BY l.tanggal, e.kode_alat`, [filters.start, filters.end])).rows;
  const breakdownRows = (await db.query(`SELECT tanggal::text AS tanggal, shift_id, equipment_id,
      total_breakdown_hours::float
    FROM breakdown_logs WHERE deleted_at IS NULL AND tanggal >= $1 AND tanggal < $2`, [filters.start, filters.end])).rows;
  const standbyRows = (await db.query(`SELECT tanggal::text AS tanggal, shift_id, equipment_id,
      total_standby_hours::float
    FROM standby_logs WHERE deleted_at IS NULL AND lifecycle_status IN ('open','confirmed')
      AND tanggal >= $1 AND tanggal < $2`, [filters.start, filters.end])).rows;
  const nonprodRows = (await db.query(`SELECT fm.tanggal::text AS tanggal, fm.shift_id, fm.pit_area,
      fm.job_code, fm.material_detail,
      CASE WHEN LOWER(COALESCE(fm.material_type,''))='coal' THEN 'coal' ELSE 'ob' END AS planning_type,
      COALESCE(SUM(rl.nonprod_ritase_count * COALESCE(tf.factor_value,0)),0)::float AS nonprod_volume
    FROM ritase_logs rl
    JOIN fleet_mappings fm ON fm.id=rl.fleet_mapping_id
    JOIN equipment e ON e.id=rl.dump_truck_id
    LEFT JOIN LATERAL (
      SELECT factor_value FROM truck_factors
      WHERE tanggal <= fm.tanggal
        AND kategori=CASE WHEN LOWER(COALESCE(fm.material_type,''))='coal' THEN 'Coal' ELSE 'OB' END
        AND tipe_alat=e.tipe_alat
        AND UPPER(material)=UPPER(COALESCE(fm.material_detail,''))
      ORDER BY tanggal DESC LIMIT 1
    ) tf ON TRUE
    WHERE rl.deleted_at IS NULL AND fm.deleted_at IS NULL
      AND fm.tanggal >= $1 AND fm.tanggal < $2
    GROUP BY fm.tanggal, fm.shift_id, fm.pit_area, fm.job_code, fm.material_detail, fm.material_type
    ORDER BY fm.tanggal`, [filters.start, filters.end])).rows;
  return { productionReport, planRows, targetRow, workRows, breakdownRows, standbyRows, nonprodRows };
}

async function getMtdReport(req, res) {
  let db;
  try {
    const filters = MtdReport.parseFilters(req.query || {});
    db = await pool.connect();
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const sources = await loadMtdSources(db, filters);
    const report = MtdReport.buildReport({ ...sources, filters });
    if (filters.compare) {
      const previousDate = new Date(Date.UTC(filters.year, filters.month - 2, 1));
      const previousYear = previousDate.getUTCFullYear();
      const previousMonth = previousDate.getUTCMonth() + 1;
      const previousLastDay = new Date(Date.UTC(previousYear, previousMonth, 0)).toISOString().slice(0, 10);
      const previousFilters = MtdReport.parseFilters({ year: previousYear, month: previousMonth, cutoff: previousLastDay,
        area: filters.area, job: filters.job, material: filters.material, shift_id: filters.shiftId });
      const previousSources = await loadMtdSources(db, previousFilters);
      const previousReport = MtdReport.buildReport({ ...previousSources, filters: previousFilters });
      report.comparison = { period: { year: previousYear, month: previousMonth }, summary: previousReport.summary };
    }
    await db.query('COMMIT');
    res.set('Cache-Control', 'private, no-cache, must-revalidate').set('Vary', 'Authorization').json(report);
  } catch (err) {
    if (db) await db.query('ROLLBACK').catch(() => {});
    respondError(res, err);
  } finally { db?.release(); }
}

module.exports = { getReport, saveAllocation, saveAllocationBatch, createAllocationRule, captureDensity,
  saveManualSource, getMtdReport, loadReport, loadReportRevision, manualOverridesPayload };
