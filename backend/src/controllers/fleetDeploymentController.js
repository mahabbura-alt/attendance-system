'use strict';

const { pool } = require('../config/db');
const ProductionController = require('./production.controller');
const Planner = require('../services/fleetDeployment');

const json = value => (value && typeof value === 'object' ? value : {});
const apiError = (res, error) => {
  const databaseBusy = error.code === 'ECHECKOUTTIMEOUT' || /unable to check out connection from the pool/i.test(String(error.message || ''));
  const status = Number(error.status) || (error.code === '23505' ? 409 : databaseBusy ? 503 : 500);
  const message = error.code === '23505' ? 'Terjadi konflik alokasi fleet. Muat ulang data dan periksa periode.'
    : databaseBusy ? 'Koneksi database sedang sibuk. Silakan ulangi validasi beberapa saat lagi.'
      : error.message || 'Fleet Deployment gagal diproses.';
  return res.status(status).json({ error: message });
};

async function planningContext(db, date) {
  // A preview owns one checked-out pg Client. Keep its reads sequential so the
  // driver never receives concurrent query calls on that client and the small
  // transaction-pooler connection budget remains predictable.
  const catalog = await ProductionController.buildFleetPlanCatalogData(db, date);
  const plans = await db.query("SELECT planning_type,data_json FROM productivity_plans WHERE planning_type IN ('pa-ua-ewh','spo')");
  const pits = await db.query(`SELECT id,kode_pit,nama_pit FROM production_pits WHERE deleted_at IS NULL ORDER BY kode_pit`);
  const excavators = await db.query(`SELECT id,kode_alat,kelas_alat,tipe_alat,class_unit,lokasi
    FROM equipment WHERE deleted_at IS NULL AND COALESCE(is_active,TRUE)=TRUE
      AND LOWER(TRIM(kelas_alat))='excavator' ORDER BY kode_alat`);
  const deployedJobs = await ProductionController.buildDeployedSpoJobsData(db, { productionMode: 'prod', operationalDate: date });
  const byType = new Map(plans.rows.map(row => [row.planning_type, json(row.data_json)]));
  const fallbackPits = await db.query(`SELECT DISTINCT TRIM(lokasi) AS value FROM equipment
    WHERE deleted_at IS NULL AND NULLIF(TRIM(lokasi),'') IS NOT NULL ORDER BY value`);
  const pitOptions = [...pits.rows.map(row => ({ id: row.id, code: row.kode_pit, name: row.nama_pit })),
    ...fallbackPits.rows.filter(row => !pits.rows.some(pit => [pit.kode_pit, pit.nama_pit].includes(row.value)))
      .map(row => ({ id: null, code: row.value, name: row.value }))];
  return { catalog, paData: byType.get('pa-ua-ewh') || {}, spoData: byType.get('spo') || {}, pits: pitOptions,
    jobs: deployedJobs, excavators: excavators.rows };
}

async function catalogTimeline(db, start, end) {
  const changes = await db.query(`SELECT DISTINCT effective_from::text AS effective_from
    FROM productivity_plan_versions
    WHERE planning_type IN ('ob','coal') AND effective_from>$1::date AND effective_from<=$2::date
    ORDER BY effective_from`, [start, end]);
  const references = [...new Set([start, ...changes.rows.map(row => row.effective_from)])].sort();
  const catalogs = new Map();
  for (const date of references) catalogs.set(date, await ProductionController.buildFleetPlanCatalogData(db, date));
  const byDate = new Map();
  for (const date of Planner.expandDates(start, end)) {
    const reference = references.filter(value => value <= date).at(-1) || start;
    byDate.set(date, catalogs.get(reference) || []);
  }
  return byDate;
}

async function resolveContextIds(db, payload) {
  const pit = await db.query(`SELECT id FROM production_pits WHERE deleted_at IS NULL
    AND (UPPER(kode_pit)=UPPER($1) OR UPPER(nama_pit)=UPPER($1)) LIMIT 1`, [payload.pitArea]);
  const job = await db.query(`SELECT id FROM master_job_codes WHERE deleted_at IS NULL AND UPPER(job_code)=UPPER($1) LIMIT 1`, [payload.jobCode]);
  if (!payload.pitArea) throw Object.assign(new Error('PIT / Area wajib dipilih.'), { status: 422 });
  if (!job.rows[0]) throw Object.assign(new Error('JOB tidak tersedia pada Master JOB.'), { status: 422 });
  return { pitId: pit.rows[0]?.id || null, jobId: job.rows[0].id };
}

async function conflictRows(db, scope, dailyRows, excludeSchemeId = null) {
  if (!dailyRows.length) return [];
  const dates = [...new Set(dailyRows.map(row => row.operationalDate))];
  const equipmentIds = [...new Set(dailyRows.map(row => row.plan.equipmentId))];
  const result = await db.query(`SELECT d.operational_date::text AS operational_date,d.excavator_id,
      d.loader_code_snapshot,s.name,s.id AS scheme_id
    FROM fleet_deployment_days d JOIN fleet_deployment_schemes s ON s.id=d.scheme_id
    WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.is_published=TRUE AND d.deleted_at IS NULL
      AND d.operational_date=ANY($3::date[]) AND d.excavator_id=ANY($4::uuid[])
      AND ($5::uuid IS NULL OR s.id<>$5::uuid)`,
  [scope.tenantKey, scope.projectKey, dates, equipmentIds, excludeSchemeId]);
  return result.rows;
}

function previewResponse(payload, selected, dailyRows, conflicts) {
  const complete = dailyRows.filter(row => row.completeness === 'complete');
  const totals = complete.reduce((acc, row) => {
    const productionUnit = row.plan.productivityUnit === 'Ton/Hr' ? 'Ton' : 'BCM';
    acc[productionUnit] = (acc[productionUnit] || 0) + Number(row.plannedProduction || 0);
    return acc;
  }, {});
  const warnings = [];
  const missingPlan = dailyRows.filter(row => row.completeness === 'missing-plan').length;
  const missingEwh = dailyRows.filter(row => row.completeness === 'missing-ewh').length;
  if (missingPlan) warnings.push(`${missingPlan} baris tidak memiliki Loader Productivity yang valid.`);
  if (missingEwh) warnings.push(`${missingEwh} baris belum memiliki PA/EWH lengkap.`);
  if (conflicts.length) warnings.push(`${conflicts.length} alokasi bentrok dengan skema Published.`);
  return {
    context: { ...payload, excludedDates: [...payload.excludedDates] },
    fleet: selected.map(plan => ({ planRef: plan.planRef, loaderCode: plan.loaderCode, productivity: plan.fleetProductivity,
      unit: plan.productivityUnit, versionId: plan.versionId || null, effectiveFrom: plan.effectiveFrom || null })),
    dayCount: new Set(dailyRows.map(row => row.operationalDate)).size,
    rowCount: dailyRows.length,
    totals,
    completeRows: complete.length,
    warnings,
    conflicts,
    canPublish: !conflicts.length && !missingPlan && !missingEwh,
  };
}

async function legacyDeploymentRows(db, from = null, to = null) {
  const [stored, catalog] = await Promise.all([
    db.query("SELECT data_json FROM productivity_plans WHERE planning_type='fleet-capacity' LIMIT 1"),
    ProductionController.buildFleetPlanCatalogData(db),
  ]);
  const data = json(stored.rows[0]?.data_json);
  const managed = new Set((Array.isArray(data.deploymentManaged) ? data.deploymentManaged : [])
    .map(item => `${item.tableId}|${item.dateKey}`));
  const groups = new Map();
  for (const plan of catalog) {
    const tableId = String(plan.tableId || '');
    const selection = json(data.periodicSelections?.[tableId]);
    const loaderKey = `fleet:${String(plan.loaderCode || '').trim().toLowerCase()}`;
    const pitStore = json(data.pitAssignments?.[loaderKey]);
    for (const [key, selected] of Object.entries(selection)) {
      if (selected !== true || managed.has(`${tableId}|${key}`)) continue;
      const parts = key.split(':').map(Number);
      if (parts.length !== 3 || parts.some(value => !Number.isInteger(value))) continue;
      const date = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
      if ((from && date < from) || (to && date > to)) continue;
      const pit = String(pitStore[key] || '').trim();
      if (!pit) continue;
      const groupKey = `${tableId}|${pit}`;
      const current = groups.get(groupKey) || { dates: [], plan, pit };
      current.dates.push(date);
      groups.set(groupKey, current);
    }
  }
  return [...groups.values()].map((group, index) => {
    group.dates.sort();
    return {
      id: `legacy:${group.plan.tableId}:${index}`,
      name: `Legacy · ${group.plan.loaderCode}`,
      date_start: group.dates[0], date_end: group.dates[group.dates.length - 1],
      pit_area_snapshot: group.pit, job_code_snapshot: group.plan.jobCode || '-',
      material_snapshot: group.plan.material, planning_type: group.plan.planningType,
      productivity_unit: group.plan.productivityUnit, status: 'legacy', revision: 1,
      fleet_count: 1, day_count: group.dates.length, planned_production: null, warning_count: 0,
      conflict_count: 0, loader_codes: group.plan.loaderCode,
      min_target_productivity: group.plan.fleetProductivity,
      max_target_productivity: group.plan.fleetProductivity,
      source: 'legacy',
    };
  });
}

async function buildPreview(db, raw, scope, excludeSchemeId = null) {
  const payload = Planner.normalizePayload(raw);
  const periodEnd = await ProductionController.getSpoPeriodEnd(db);
  if (periodEnd && payload.dateEnd > periodEnd) {
    throw Object.assign(new Error(`Tanggal akhir melewati periode SPO aktif (${periodEnd}).`), { status: 422 });
  }
  const context = await planningContext(db, payload.dateEnd);
  if (!context.jobs.some(job => String(job.jobCode || '').toUpperCase() === String(payload.jobCode || '').toUpperCase())) {
    throw Object.assign(new Error(`JOB ${payload.jobCode || '-'} bukan JOB Prod aktif pada SPO untuk periode terpilih.`), { status: 422 });
  }
  const catalogs = await catalogTimeline(db, payload.dateStart, payload.dateEnd);
  const selected = Planner.resolveFleetCandidates(payload, context.catalog, context.excavators);
  const dailyRows = Planner.buildDailyRowsFromTimeline(payload, selected, catalogs, context.paData, context.spoData);
  const conflicts = await conflictRows(db, scope, dailyRows, excludeSchemeId);
  return { payload, context, selected, dailyRows, conflicts, preview: previewResponse(payload, selected, dailyRows, conflicts) };
}

async function audit(db, scope, schemeId, action, previousValue, newValue, actorId, reason = null) {
  await db.query(`INSERT INTO fleet_deployment_audit
    (scheme_id,tenant_key,project_key,action,previous_value,new_value,reason,actor_id)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
  [schemeId, scope.tenantKey, scope.projectKey, action, previousValue ? JSON.stringify(previousValue) : null,
    newValue ? JSON.stringify(newValue) : null, reason, actorId]);
}

async function schemeSnapshot(db, schemeId, scope) {
  const scheme = await db.query(`SELECT s.*,COALESCE(json_agg(json_build_object(
      'id',a.id,'planRef',a.fleet_plan_ref,'tableId',a.plan_table_id,'loaderCode',a.loader_code_snapshot,
      'equipmentId',a.excavator_id,
      'productivity',a.plan_productivity,'unit',a.productivity_unit,'versionId',a.productivity_plan_version_id
    ) ORDER BY a.loader_code_snapshot) FILTER (WHERE a.id IS NOT NULL),'[]') AS assignments
    FROM fleet_deployment_schemes s LEFT JOIN fleet_deployment_assignments a ON a.scheme_id=s.id
    WHERE s.id=$1 AND s.tenant_key=$2 AND s.project_key=$3 AND s.deleted_at IS NULL GROUP BY s.id`,
  [schemeId, scope.tenantKey, scope.projectKey]);
  return scheme.rows[0] || null;
}

async function writeScheme(db, scope, actorId, built, status = 'draft', schemeId = null, expectedRevision = null) {
  const { payload, selected, dailyRows } = built;
  const ids = await resolveContextIds(db, payload);
  let id = schemeId;
  if (schemeId) {
    const current = await schemeSnapshot(db, schemeId, scope);
    if (!current) throw Object.assign(new Error('Skema tidak ditemukan.'), { status: 404 });
    if (['published', 'closed', 'cancelled'].includes(current.status)) throw Object.assign(new Error('Skema yang sudah dipublikasi/ditutup tidak dapat ditimpa.'), { status: 409 });
    if (expectedRevision && Number(current.revision) !== Number(expectedRevision)) throw Object.assign(new Error('Skema telah diubah pengguna lain. Muat ulang halaman.'), { status: 409 });
    await db.query(`UPDATE fleet_deployment_schemes SET name=$1,date_start=$2,date_end=$3,pit_id=$4,
      pit_area_snapshot=$5,job_id=$6,job_code_snapshot=$7,material_snapshot=$8,planning_type=$9,
      productivity_unit=$10,status=$11,revision=revision+1,updated_by=$12,updated_at=now() WHERE id=$13`,
    [payload.name || `Deployment ${payload.pitArea} ${payload.jobCode}`, payload.dateStart, payload.dateEnd, ids.pitId,
      payload.pitArea, ids.jobId, payload.jobCode, payload.material, payload.planningType,
      payload.planningType === 'coal' ? 'Ton/Hr' : 'BCM/Hr', status, actorId, schemeId]);
    await db.query('DELETE FROM fleet_deployment_assignments WHERE scheme_id=$1', [schemeId]);
  } else {
    const inserted = await db.query(`INSERT INTO fleet_deployment_schemes
      (tenant_key,project_key,name,date_start,date_end,pit_id,pit_area_snapshot,job_id,job_code_snapshot,
       material_snapshot,planning_type,productivity_unit,status,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING id`,
    [scope.tenantKey, scope.projectKey, payload.name || `Deployment ${payload.pitArea} ${payload.jobCode}`,
      payload.dateStart, payload.dateEnd, ids.pitId, payload.pitArea, ids.jobId, payload.jobCode, payload.material,
      payload.planningType, payload.planningType === 'coal' ? 'Ton/Hr' : 'BCM/Hr', status, actorId]);
    id = inserted.rows[0].id;
  }
  const assignmentByRef = new Map();
  const assignmentByEquipment = new Map();
  for (const plan of selected) {
    const inserted = await db.query(`INSERT INTO fleet_deployment_assignments
      (scheme_id,tenant_key,project_key,excavator_id,fleet_plan_ref,plan_table_id,loader_code_snapshot,
       productivity_plan_version_id,plan_productivity,productivity_unit,formula_version,density_snapshot)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [id, scope.tenantKey, scope.projectKey, plan.equipmentId, plan.planRef, plan.tableId, plan.loaderCode,
      plan.versionId || null, plan.fleetProductivity, plan.productivityUnit, 'loader-productivity-v1', plan.density || null]);
    assignmentByRef.set(String(plan.planRef), inserted.rows[0].id);
    // Satu assignment per unit: versi plan bisa berganti mid-periode sehingga
    // planRef harian belum tentu sama dengan planRef terpilih. Nilai versi per
    // hari tetap tersimpan di baris day (version + productivity).
    if (!assignmentByEquipment.has(String(plan.equipmentId))) {
      assignmentByEquipment.set(String(plan.equipmentId), inserted.rows[0].id);
    }
  }
  for (const row of dailyRows) {
    const assignmentId = assignmentByEquipment.get(String(row.plan.equipmentId))
      || assignmentByRef.get(String(row.plan.planRef));
    if (!assignmentId) throw Object.assign(new Error(
      `Fleet ${row.plan.loaderCode || ''} pada ${row.operationalDate} tidak memiliki assignment tersimpan.`), { status: 422 });
    await db.query(`INSERT INTO fleet_deployment_days
    (scheme_id,assignment_id,tenant_key,project_key,operational_date,excavator_id,loader_code_snapshot,
     pit_area_snapshot,job_code_snapshot,material_snapshot,planning_type,productivity_plan_version_id,
     plan_productivity,productivity_unit,planned_ewh,planned_production,completeness,reason_code,is_published)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
  [id, assignmentId, scope.tenantKey, scope.projectKey, row.operationalDate,
    row.plan.equipmentId, row.plan.loaderCode, payload.pitArea, payload.jobCode, payload.material, payload.planningType,
    row.plan.versionId || null, row.plan.fleetProductivity, row.plan.productivityUnit, row.ewh, row.plannedProduction,
    row.completeness, row.reasonCode, status === 'published']);
  }
  if (status === 'published') await db.query(`UPDATE fleet_deployment_schemes SET published_by=$1,published_at=now() WHERE id=$2`, [actorId, id]);
  return id;
}

async function syncLegacyProjection(db, scope) {
  const current = await db.query("SELECT content_html,data_json FROM productivity_plans WHERE planning_type='fleet-capacity' LIMIT 1");
  const data = json(current.rows[0]?.data_json);
  const periodic = json(data.periodicSelections);
  const pits = json(data.pitAssignments);
  const retainedManaged = [];
  for (const managed of Array.isArray(data.deploymentManaged) ? data.deploymentManaged : []) {
    if (managed.tenantKey && (managed.tenantKey !== scope.tenantKey || managed.projectKey !== scope.projectKey)) {
      retainedManaged.push(managed);
      continue;
    }
    if (periodic[managed.tableId]) delete periodic[managed.tableId][managed.dateKey];
    if (pits[managed.loaderKey]) delete pits[managed.loaderKey][managed.dateKey];
  }
  const published = await db.query(`SELECT d.operational_date::text AS date,d.loader_code_snapshot,d.pit_area_snapshot,
      a.plan_table_id FROM fleet_deployment_days d JOIN fleet_deployment_assignments a ON a.id=d.assignment_id
    WHERE d.tenant_key=$1 AND d.project_key=$2 AND d.is_published=TRUE AND d.deleted_at IS NULL`,
  [scope.tenantKey, scope.projectKey]);
  const managed = [...retainedManaged];
  for (const row of published.rows) {
    const [year, month, day] = row.date.split('-').map(Number);
    const dateKey = `${year}:${month}:${day}`;
    const tableId = String(row.plan_table_id);
    const loaderKey = `fleet:${String(row.loader_code_snapshot).trim().toLowerCase()}`;
    if (!periodic[tableId]) periodic[tableId] = {};
    if (!pits[loaderKey]) pits[loaderKey] = {};
    periodic[tableId][dateKey] = true;
    pits[loaderKey][dateKey] = row.pit_area_snapshot;
    managed.push({ tenantKey: scope.tenantKey, projectKey: scope.projectKey, tableId, loaderKey, dateKey });
  }
  const next = { ...data, version: Math.max(4, Number(data.version) || 0), periodicSelections: periodic,
    pitAssignments: pits, deploymentManaged: managed, source: 'fleet-deployment-planner' };
  await db.query(`INSERT INTO productivity_plans (planning_type,content_html,data_json,updated_at)
    VALUES ('fleet-capacity',$1,$2::jsonb,now()) ON CONFLICT (planning_type) DO UPDATE
    SET content_html=EXCLUDED.content_html,data_json=EXCLUDED.data_json,updated_at=now()`,
  [current.rows[0]?.content_html || '', JSON.stringify(next)]);
}

const FleetDeploymentController = {
  async options(req, res) {
    let db;
    try {
      db = await pool.connect();
      const from = req.query.from ? Planner.isoDate(req.query.from) : null;
      const to = req.query.to ? Planner.isoDate(req.query.to) : null;
      if (from && to && from > to) throw Object.assign(new Error('Tanggal mulai tidak boleh melewati tanggal akhir.'), { status: 422 });
      const date = Planner.isoDate(to || req.query.date || from || new Date().toISOString().slice(0, 10));
      const context = await planningContext(db, date);
      res.json({ catalog: context.catalog, excavators: context.excavators, pits: context.pits, jobs: context.jobs,
        periodEnd: await ProductionController.getSpoPeriodEnd(db) });
    } catch (error) { apiError(res, error); } finally { db?.release(); }
  },
  async list(req, res) {
    try {
      const scope = Planner.scopeFromUser(req.user);
      const args = [scope.tenantKey, scope.projectKey];
      let where = '';
      let dayRange = '';
      let conflictRange = '';
      const from = req.query.from ? Planner.isoDate(req.query.from) : null;
      const to = req.query.to ? Planner.isoDate(req.query.to) : null;
      if (from && to && from > to) return res.status(422).json({ error: 'Tanggal mulai tidak boleh melewati tanggal akhir.' });
      if (from) { args.push(from); const ref = `$${args.length}`; where += ` AND s.date_end >= ${ref}`; dayRange += ` AND d.operational_date >= ${ref}`; conflictRange += ` AND own.operational_date >= ${ref}`; }
      if (to) { args.push(to); const ref = `$${args.length}`; where += ` AND s.date_start <= ${ref}`; dayRange += ` AND d.operational_date <= ${ref}`; conflictRange += ` AND own.operational_date <= ${ref}`; }
      const result = await pool.query(`SELECT s.*,COUNT(DISTINCT a.id)::int AS fleet_count,
          COUNT(DISTINCT d.operational_date)::int AS day_count,
          COALESCE(SUM(d.planned_production) FILTER (WHERE d.completeness='complete'),0)::float AS planned_production,
          COUNT(*) FILTER (WHERE d.completeness<>'complete')::int AS warning_count,
          MIN(a.plan_productivity)::float AS min_target_productivity,
          MAX(a.plan_productivity)::float AS max_target_productivity,
          STRING_AGG(DISTINCT a.loader_code_snapshot, ', ' ORDER BY a.loader_code_snapshot) AS loader_codes,
          (SELECT COUNT(*)::int FROM fleet_deployment_days own
            WHERE own.scheme_id=s.id AND own.deleted_at IS NULL ${conflictRange} AND EXISTS (
              SELECT 1 FROM fleet_deployment_days other
              WHERE other.scheme_id<>own.scheme_id AND other.is_published=TRUE AND other.deleted_at IS NULL
                AND other.tenant_key=own.tenant_key AND other.project_key=own.project_key
                AND other.operational_date=own.operational_date AND other.excavator_id=own.excavator_id
            )) AS conflict_count
        FROM fleet_deployment_schemes s
        LEFT JOIN fleet_deployment_assignments a ON a.scheme_id=s.id
        LEFT JOIN fleet_deployment_days d ON d.assignment_id=a.id AND d.deleted_at IS NULL ${dayRange}
        WHERE s.tenant_key=$1 AND s.project_key=$2 AND s.deleted_at IS NULL ${where}
        GROUP BY s.id ORDER BY s.date_start DESC,s.created_at DESC`, args);
      const legacy = await legacyDeploymentRows(pool, from, to);
      res.json({ rows: [...result.rows, ...legacy], legacyCount: legacy.length });
    } catch (error) { apiError(res, error); }
  },
  async detail(req, res) {
    try {
      const scope = Planner.scopeFromUser(req.user);
      const row = await schemeSnapshot(pool, req.params.id, scope);
      if (!row) return res.status(404).json({ error: 'Skema tidak ditemukan.' });
      res.json(row);
    } catch (error) { apiError(res, error); }
  },
  async preview(req, res) {
    let db;
    try {
      db = await pool.connect();
      const built = await buildPreview(db, req.body, Planner.scopeFromUser(req.user), req.body?.id || null);
      res.json(built.preview);
    } catch (error) { apiError(res, error); } finally { db?.release(); }
  },
  async create(req, res) {
    const db = await pool.connect();
    try {
      const scope = Planner.scopeFromUser(req.user);
      const requested = req.body?.publish === true ? 'published' : 'draft';
      const built = await buildPreview(db, req.body, scope);
      if (requested === 'published' && !built.preview.canPublish) throw Object.assign(new Error('Skema belum lolos validasi untuk dipublikasi.'), { status: 422 });
      await db.query('BEGIN');
      const id = await writeScheme(db, scope, req.user.id, built, requested);
      const snapshot = await schemeSnapshot(db, id, scope);
      await audit(db, scope, id, requested === 'published' ? 'CREATE_AND_PUBLISH' : 'CREATE_DRAFT', null, snapshot, req.user.id);
      if (requested === 'published') await syncLegacyProjection(db, scope);
      await db.query('COMMIT');
      res.status(201).json({ id, status: requested, preview: built.preview });
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); apiError(res, error); } finally { db.release(); }
  },
  async update(req, res) {
    const db = await pool.connect();
    try {
      const scope = Planner.scopeFromUser(req.user);
      const before = await schemeSnapshot(db, req.params.id, scope);
      if (!before) return res.status(404).json({ error: 'Skema tidak ditemukan.' });
      const built = await buildPreview(db, req.body, scope, req.params.id);
      await db.query('BEGIN');
      const id = await writeScheme(db, scope, req.user.id, built, 'draft', req.params.id, req.body?.revision);
      const after = await schemeSnapshot(db, id, scope);
      await audit(db, scope, id, 'UPDATE_DRAFT', before, after, req.user.id, req.body?.reason || null);
      await db.query('COMMIT');
      res.json({ id, status: 'draft', preview: built.preview });
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); apiError(res, error); } finally { db.release(); }
  },
  async transition(req, res) {
    const db = await pool.connect();
    try {
      const scope = Planner.scopeFromUser(req.user);
      const next = String(req.body?.status || '').toLowerCase();
      const before = await schemeSnapshot(db, req.params.id, scope);
      if (!before) return res.status(404).json({ error: 'Skema tidak ditemukan.' });
      if (!Planner.statusTransitionAllowed(before.status, next)) throw Object.assign(new Error(`Transisi ${before.status} ke ${next} tidak diizinkan.`), { status: 409 });
      await db.query('BEGIN');
      if (['validated', 'published'].includes(next)) {
        const conflicts = await db.query(`SELECT 1 FROM fleet_deployment_days d JOIN fleet_deployment_days other
          ON other.operational_date=d.operational_date AND other.excavator_id=d.excavator_id
          AND other.tenant_key=d.tenant_key AND other.project_key=d.project_key
          AND other.is_published=TRUE AND other.deleted_at IS NULL AND other.scheme_id<>d.scheme_id
          WHERE d.scheme_id=$1 LIMIT 1`, [req.params.id]);
        if (conflicts.rows.length) throw Object.assign(new Error('Validasi gagal karena terdapat konflik excavator dan tanggal.'), { status: 409 });
        const incomplete = await db.query(`SELECT 1 FROM fleet_deployment_days WHERE scheme_id=$1 AND completeness<>'complete' LIMIT 1`, [req.params.id]);
        if (incomplete.rows.length) throw Object.assign(new Error('Validasi gagal karena data plan atau PA/EWH belum lengkap.'), { status: 422 });
      }
      await db.query(`UPDATE fleet_deployment_schemes SET status=$1,revision=revision+1,updated_by=$2,updated_at=now(),
        published_by=CASE WHEN $1='published' THEN $2 ELSE published_by END,
        published_at=CASE WHEN $1='published' THEN now() ELSE published_at END,
        closed_by=CASE WHEN $1='closed' THEN $2 ELSE closed_by END,
        closed_at=CASE WHEN $1='closed' THEN now() ELSE closed_at END WHERE id=$3`, [next, req.user.id, req.params.id]);
      await db.query(`UPDATE fleet_deployment_days SET is_published=$1,updated_at=now() WHERE scheme_id=$2`,
        [['published', 'closed'].includes(next), req.params.id]);
      const after = await schemeSnapshot(db, req.params.id, scope);
      await audit(db, scope, req.params.id, `STATUS_${next.toUpperCase()}`, before, after, req.user.id, req.body?.reason || null);
      await syncLegacyProjection(db, scope);
      await db.query('COMMIT');
      res.json({ id: req.params.id, status: next });
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); apiError(res, error); } finally { db.release(); }
  },
};

module.exports = FleetDeploymentController;
module.exports.writeScheme = writeScheme;
