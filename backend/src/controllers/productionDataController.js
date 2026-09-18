'use strict';
const { pool } = require('../config/db');
const domain = require('../services/productionData');
const { buildFleetPlanCatalogData, buildDeployedSpoJobsData, calculateWeightedFleetDistance } = require('./production.controller');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

async function loadReport(db, selected) {
  // One transaction connection cannot execute queries concurrently. Catalog
  // helpers also use Promise.all; serialize them on this same snapshot.
  const connection = db;
  let pending = Promise.resolve();
  db = { query(...args) {
    const task = pending.then(() => connection.query(...args));
    pending = task.catch(() => {});
    return task;
  } };
  const p = domain.period(selected.year, selected.month);
  const args = [p.start, p.end];
  let reportQueries;
  try {
    reportQueries = await Promise.all([
    buildDeployedSpoJobsData(db), buildFleetPlanCatalogData(db),
    db.query("SELECT DISTINCT TRIM(lokasi) AS name FROM equipment WHERE deleted_at IS NULL AND NULLIF(TRIM(lokasi), '') IS NOT NULL ORDER BY name"),
    db.query(`SELECT id, nama_shift, operational_start FROM shifts WHERE LOWER(nama_shift) LIKE '%siang%' OR LOWER(nama_shift) LIKE '%malam%'
      OR id IN (SELECT shift_id FROM fleet_mappings WHERE deleted_at IS NULL AND tanggal >= $1 AND tanggal < $2
        UNION SELECT shift_id FROM fuel_logs WHERE deleted_at IS NULL AND tanggal >= $1 AND tanggal < $2
        UNION SELECT shift_id FROM rainfall_logs WHERE deleted_at IS NULL AND operational_date >= $1 AND operational_date < $2)
      ORDER BY CASE WHEN LOWER(nama_shift) LIKE '%siang%' THEN 0 ELSE 1 END, nama_shift`, args),
    db.query(`SELECT fm.*, fm.tanggal::text AS tanggal, e.kode_alat AS excavator_kode FROM fleet_mappings fm
      JOIN equipment e ON e.id=fm.excavator_id WHERE fm.deleted_at IS NULL AND fm.tanggal >= $1 AND fm.tanggal < $2`, args),
    db.query(`SELECT rl.id, rl.fleet_mapping_id, rl.dump_truck_id, rl.period_hour, rl.ritase_count, tf.factor_value
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
    db.query(`SELECT id,kode_alat FROM equipment WHERE deleted_at IS NULL ORDER BY kode_alat`)
    ]);
  } finally {
    // Promise.all rejects on the first SQL error, while serialized queries that
    // were already queued may still be running. Drain the queue before the
    // caller COMMITs/ROLLBACKs the transaction so one pg client never receives
    // overlapping commands.
    await pending;
  }
  let [jobs, catalog, areas, shifts, fleets, hours, distances, rain, fuel, work, manual, snapshots, rules, allocationHistory, ruleUnits] = reportQueries;
  // A monthly report can cross multiple effective planning versions. Resolve
  // the catalog for each operational date represented by a fleet so density
  // and plan provenance remain historically correct.
  const fleetDates = [...new Set(fleets.rows.map(fleet => String(fleet.tanggal).slice(0, 10)))];
  const datedCatalog = [];
  for (const fleetDate of fleetDates) {
    const rows = await buildFleetPlanCatalogData(db, fleetDate);
    rows.forEach(row => datedCatalog.push({ ...row, catalogDate: fleetDate }));
  }
  if (datedCatalog.length) catalog = datedCatalog;
  return domain.buildReport({ period: p, jobs, catalog, areas: areas.rows.map(a => a.name), shifts: shifts.rows,
    fleets: fleets.rows, hours: hours.rows, distances: distances.rows, rain: rain.rows,
    fuel: fuel.rows, workLogs: work.rows, manual: manual.rows, snapshots: snapshots.rows,
    rules: rules.rows, allocationHistory: allocationHistory.rows, ruleUnits: ruleUnits.rows }, calculateWeightedFleetDistance);
}

function respondError(res, err) {
  if (err.code === '42P01' && /production_fuel_allocation_rules/i.test(err.message || '')) {
    return res.status(503).json({ error: 'Aturan alokasi fuel belum siap. Migrasi 037 perlu diterapkan.' });
  }
  if ((err.code === '42P01' || err.code === '42703') && /production_fuel_allocation_batches|batch_id/i.test(err.message || '')) {
    return res.status(503).json({ error: 'Alokasi Cepat belum siap. Migrasi 036 perlu diterapkan.' });
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
  try {
    db = await pool.connect();
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const report = await loadReport(db, req.query);
    await db.query('COMMIT');
    res.set('Cache-Control', 'no-store').json(report);
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

module.exports = { getReport, saveAllocation, saveAllocationBatch, createAllocationRule, captureDensity, loadReport };
