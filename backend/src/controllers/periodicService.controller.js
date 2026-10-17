'use strict';

const { pool } = require('../config/db');
const PeriodicService = require('../services/periodicService');
const PeriodicServiceForecast = require('../services/periodicServiceForecast');
const FleetDeployment = require('../services/fleetDeployment');

function timestamp(value, label) {
  const result = new Date(value);
  if (!value || Number.isNaN(result.getTime())) throw new Error(`${label} tidak valid.`);
  return result;
}

function positiveNumber(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} harus lebih dari 0.`);
  return result;
}

function nonNegativeNumber(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} harus berupa angka ≥ 0.`);
  return result;
}

function localDate(value) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function actorId(db, user) {
  if (!user?.id) return null;
  const result = await db.query('SELECT id FROM users WHERE id=$1 LIMIT 1', [user.id]);
  return result.rows[0]?.id || null;
}

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

async function assertEquipment(db, equipmentId) {
  const result = await db.query(`SELECT id,kode_alat,kelas_alat,class_unit,tipe_alat
    FROM equipment WHERE id=$1 AND deleted_at IS NULL`, [equipmentId]);
  if (!result.rows[0]) throw httpError('Unit tidak ditemukan.', 404);
  return result.rows[0];
}

function equipmentModel(row = {}) {
  return String(row.tipe_alat || row.class_unit || row.kode_alat || 'Tanpa Model').trim();
}

async function assertEquipmentModel(db, equipmentClass, equipmentModelName) {
  const equipmentClassName = String(equipmentClass || '').trim();
  const modelName = String(equipmentModelName || '').trim();
  if (!equipmentClassName || !modelName) throw new Error('Jenis equipment dan Tipe Model wajib dipilih.');
  const result = await db.query(`SELECT kelas_alat,
      COALESCE(NULLIF(TRIM(tipe_alat),''),NULLIF(TRIM(class_unit),''),kode_alat) AS tipe_alat,
      COUNT(*)::int AS unit_count
    FROM equipment
    WHERE deleted_at IS NULL AND COALESCE(is_active,TRUE)=TRUE
      AND LOWER(TRIM(kelas_alat))=LOWER(TRIM($1))
      AND LOWER(TRIM(COALESCE(NULLIF(TRIM(tipe_alat),''),NULLIF(TRIM(class_unit),''),kode_alat)))=LOWER(TRIM($2))
    GROUP BY kelas_alat,COALESCE(NULLIF(TRIM(tipe_alat),''),NULLIF(TRIM(class_unit),''),kode_alat)`,
  [equipmentClassName, modelName]);
  if (!result.rows[0]) throw httpError('Tipe Model tidak tersedia pada List Equipment aktif.', 404);
  return result.rows[0];
}

function validatePackageItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) throw new Error('Paket service minimal memiliki satu task/part/oli.');
  return items.map((source, index) => {
    const item = source || {};
    const itemName = String(item.item_name || '').trim();
    const itemType = String(item.item_type || 'task').trim().toLowerCase();
    if (!itemName || !['task', 'part', 'lubricant', 'consumable', 'other'].includes(itemType)) {
      throw new Error(`Item paket baris ${index + 1} tidak valid.`);
    }
    return {
      itemType,
      itemName,
      itemCode: String(item.item_code || '').trim() || null,
      specification: String(item.specification || '').trim() || null,
      qty: item.planned_qty === '' || item.planned_qty === null || item.planned_qty === undefined
        ? null : positiveNumber(item.planned_qty, `Qty ${itemName}`),
      uom: String(item.uom || '').trim() || null,
      isRequired: item.is_required !== false
    };
  });
}

function validateAdditionalOrderItems(rawItems) {
  if (rawItems === undefined || rawItems === null) return [];
  if (!Array.isArray(rawItems)) throw new Error('Daftar part/task tambahan tidak valid.');
  if (!rawItems.length) return [];
  return validatePackageItems(rawItems);
}

async function savePackageVersion(client, scope, body, actor, sourcePackageId = null) {
  const model = await assertEquipmentModel(client, body.equipment_class, body.equipment_model);
  const serviceCode = String(body.service_code || '').trim().toUpperCase();
  const serviceName = String(body.service_name || '').trim();
  if (!serviceCode || !serviceName) throw new Error('Kode dan nama paket service wajib diisi.');
  const cycleHm = positiveNumber(body.cycle_hm, 'Cycle HM paket');
  const estimatedDurationHours = body.estimated_duration_hours === '' || body.estimated_duration_hours === null
    || body.estimated_duration_hours === undefined ? null : positiveNumber(body.estimated_duration_hours, 'Estimasi pekerjaan');
  const items = validatePackageItems(body.items);
  let sourcePackage = null;
  if (sourcePackageId) {
    const source = await client.query(`SELECT * FROM periodic_service_packages
      WHERE id=$1 AND tenant_key=$2 AND project_key=$3 AND deleted_at IS NULL FOR UPDATE`,
    [sourcePackageId, scope.tenantKey, scope.projectKey]);
    sourcePackage = source.rows[0];
    if (!sourcePackage) throw httpError('Area Setup Periodic Service tidak ditemukan.', 404);
  }
  const lockKey = `periodic-service-package:${scope.tenantKey}:${scope.projectKey}:${model.kelas_alat}:${model.tipe_alat}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
  const conflict = await client.query(`SELECT id,service_code,cycle_hm
    FROM periodic_service_packages
    WHERE tenant_key=$1 AND project_key=$2 AND deleted_at IS NULL AND is_active=TRUE
      AND LOWER(TRIM(equipment_class))=LOWER(TRIM($3))
      AND LOWER(TRIM(equipment_model))=LOWER(TRIM($4))
      AND (UPPER(TRIM(service_code))=UPPER(TRIM($5)) OR cycle_hm=$6)
      AND ($7::uuid IS NULL OR id<>$7::uuid)
    LIMIT 1`, [scope.tenantKey, scope.projectKey, model.kelas_alat, model.tipe_alat,
    serviceCode, cycleHm, sourcePackage?.id || null]);
  if (conflict.rows[0]) {
    const existing = conflict.rows[0];
    throw httpError(`Tipe Model ini sudah memiliki ${existing.service_code} pada periode ${Number(existing.cycle_hm)} HM.`, 409);
  }
  const versionResult = await client.query(`SELECT COALESCE(MAX(version),0)+1 AS next_version
    FROM periodic_service_packages
    WHERE tenant_key=$1 AND project_key=$2
      AND LOWER(TRIM(equipment_class))=LOWER(TRIM($3))
      AND LOWER(TRIM(equipment_model))=LOWER(TRIM($4))
      AND UPPER(TRIM(service_code))=UPPER(TRIM($5))`,
  [scope.tenantKey, scope.projectKey, model.kelas_alat, model.tipe_alat, serviceCode]);
  if (sourcePackage && sourcePackage.is_active) {
    await client.query(`UPDATE periodic_service_packages SET is_active=FALSE,updated_by=$1,updated_at=now() WHERE id=$2`, [actor, sourcePackage.id]);
  }
  const packageResult = await client.query(`INSERT INTO periodic_service_packages
    (tenant_key,project_key,equipment_id,equipment_class,equipment_model,service_code,service_name,cycle_hm,
     estimated_duration_hours,version,created_by,updated_by)
    VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
  [scope.tenantKey, scope.projectKey, model.kelas_alat, model.tipe_alat, serviceCode, serviceName, cycleHm,
    estimatedDurationHours, versionResult.rows[0].next_version, actor]);
  const pack = packageResult.rows[0];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    await client.query(`INSERT INTO periodic_service_package_items
      (package_id,item_type,item_code,item_name,specification,planned_qty,uom,is_required,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [pack.id, item.itemType, item.itemCode, item.itemName,
      item.specification, item.qty, item.uom, item.isRequired, index]);
  }
  return pack;
}

class PeriodicServiceController {
  static async dashboard(req, res) {
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const period = PeriodicService.resolveDashboardRange(req.query, localDate(new Date()));
      const [unitsResult, packagesResult, ordersResult, findingsResult, shiftsResult, personnelResult] = await Promise.all([
        pool.query(`
          SELECT e.id,e.kode_alat,e.kelas_alat,e.class_unit,e.tipe_alat,e.status_alat,
                 hm.current_hm::float,hm.hm_date::text,
                 setup.setup_date::text,enrollment.enrollment_hm::float,enrollment.enrollment_date::text,
                 last_service.actual_service_hm::float AS last_service_hm,last_service.actual_finish AS last_service_at,
                 last_service.due_hm::float AS last_completed_due_hm,
                 open_order.id AS open_order_id,open_order.status AS open_order_status,open_order.due_hm::float AS open_order_due_hm
          FROM equipment e
          LEFT JOIN LATERAL (
            SELECT mpl.tanggal AS hm_date,MAX(COALESCE(mpl.hm_lifetime_finish,mpl.hm_finish)) AS current_hm
            FROM mining_production_logs mpl
            WHERE mpl.equipment_id=e.id AND mpl.deleted_at IS NULL AND mpl.hm_finish IS NOT NULL
              AND mpl.tanggal=(SELECT MAX(m2.tanggal) FROM mining_production_logs m2
                WHERE m2.equipment_id=e.id AND m2.deleted_at IS NULL AND m2.hm_finish IS NOT NULL)
            GROUP BY mpl.tanggal
          ) hm ON TRUE
          LEFT JOIN LATERAL (
            SELECT MIN(p.created_at)::date AS setup_date
            FROM periodic_service_packages p
            WHERE p.tenant_key=$1 AND p.project_key=$2 AND p.deleted_at IS NULL
              AND LOWER(TRIM(p.equipment_class))=LOWER(TRIM(e.kelas_alat))
              AND LOWER(TRIM(p.equipment_model))=LOWER(TRIM(COALESCE(NULLIF(TRIM(e.tipe_alat),''),NULLIF(TRIM(e.class_unit),''),e.kode_alat)))
          ) setup ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(mpl.hm_lifetime_start,mpl.hm_start,mpl.hm_lifetime_finish,mpl.hm_finish) AS enrollment_hm,mpl.tanggal AS enrollment_date
            FROM mining_production_logs mpl
            WHERE mpl.equipment_id=e.id AND mpl.deleted_at IS NULL
              AND COALESCE(mpl.hm_start,mpl.hm_finish) IS NOT NULL
              AND (setup.setup_date IS NULL OR mpl.tanggal>=setup.setup_date)
            ORDER BY mpl.tanggal ASC,mpl.created_at ASC LIMIT 1
          ) enrollment ON TRUE
          LEFT JOIN LATERAL (
            SELECT actual_service_hm,actual_finish,due_hm FROM periodic_service_orders o
            WHERE o.equipment_id=e.id AND o.tenant_key=$1 AND o.project_key=$2
              AND o.status='completed' AND o.actual_service_hm IS NOT NULL
            ORDER BY o.actual_finish DESC,o.updated_at DESC LIMIT 1
          ) last_service ON TRUE
          LEFT JOIN LATERAL (
            SELECT id,status,due_hm FROM periodic_service_orders o
            WHERE o.equipment_id=e.id AND o.tenant_key=$1 AND o.project_key=$2
              AND o.status IN ('scheduled','in_progress','awaiting_verification')
            ORDER BY o.created_at DESC LIMIT 1
          ) open_order ON TRUE
          WHERE e.deleted_at IS NULL AND COALESCE(e.is_active,TRUE)=TRUE
          ORDER BY e.kelas_alat,e.kode_alat
        `, [scope.tenantKey, scope.projectKey]),
        pool.query(`
          SELECT p.*,
                 COALESCE(jsonb_agg(jsonb_build_object(
                   'id',i.id,'item_type',i.item_type,'item_code',i.item_code,'item_name',i.item_name,
                   'specification',i.specification,'planned_qty',i.planned_qty,'uom',i.uom,
                   'is_required',i.is_required,'sort_order',i.sort_order
                 ) ORDER BY i.sort_order,i.item_name) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) AS items
          FROM periodic_service_packages p
          LEFT JOIN periodic_service_package_items i ON i.package_id=p.id
          WHERE p.tenant_key=$1 AND p.project_key=$2 AND p.deleted_at IS NULL AND p.is_active=TRUE
          GROUP BY p.id ORDER BY p.equipment_class,p.equipment_model,p.cycle_hm,p.version DESC
        `, [scope.tenantKey, scope.projectKey]),
        pool.query(`
          SELECT o.*,e.kode_alat,e.kelas_alat,p.service_code,p.service_name,
                 bc.kode AS breakdown_code,
                 COALESCE((SELECT jsonb_agg(to_jsonb(oi) ORDER BY oi.sort_order) FROM periodic_service_order_items oi WHERE oi.order_id=o.id),'[]'::jsonb) AS planned_items,
                 COALESCE((SELECT jsonb_agg(to_jsonb(ai) ORDER BY ai.created_at) FROM periodic_service_actual_items ai WHERE ai.order_id=o.id),'[]'::jsonb) AS actual_items,
                 COALESCE((SELECT COUNT(*) FROM periodic_service_findings f WHERE f.order_id=o.id AND f.status IN ('open','in_progress')),0)::int AS open_findings
          FROM periodic_service_orders o JOIN equipment e ON e.id=o.equipment_id
          LEFT JOIN periodic_service_packages p ON p.id=o.package_id
          LEFT JOIN breakdown_logs bl ON bl.id=o.breakdown_id
          LEFT JOIN master_breakdown_codes bc ON bc.id=bl.breakdown_code_id
          WHERE o.tenant_key=$1 AND o.project_key=$2
            AND (o.status IN ('scheduled','in_progress','awaiting_verification')
              OR COALESCE(o.actual_finish,o.actual_start,o.scheduled_start,o.scheduled_date::timestamp,o.created_at)::date
                BETWEEN $3::date AND $4::date)
          ORDER BY CASE o.status WHEN 'in_progress' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,o.updated_at DESC
          LIMIT 500
        `, [scope.tenantKey, scope.projectKey, period.dateFrom, period.dateTo]),
        pool.query(`
          SELECT f.*,e.kode_alat,u.nama AS pic_name
          FROM periodic_service_findings f JOIN equipment e ON e.id=f.equipment_id
          JOIN periodic_service_orders finding_order ON finding_order.id=f.order_id
          LEFT JOIN users u ON u.id=f.pic_id
          WHERE f.tenant_key=$1 AND f.project_key=$2
            AND (f.status IN ('open','in_progress')
              OR COALESCE(finding_order.actual_finish,finding_order.actual_start,finding_order.scheduled_start,
                finding_order.scheduled_date::timestamp,finding_order.created_at)::date BETWEEN $3::date AND $4::date)
          ORDER BY CASE f.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
                   CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,f.created_at DESC
          LIMIT 500
        `, [scope.tenantKey, scope.projectKey, period.dateFrom, period.dateTo]),
        pool.query(`SELECT id,nama_shift FROM shifts ORDER BY nama_shift`),
        pool.query(`SELECT id,nama FROM users WHERE is_active=TRUE
          AND LOWER(TRIM(COALESCE(departemen,'')))='maintenance' ORDER BY nama`)
      ]);

      const packages = packagesResult.rows;
      const packagesByModel = new Map();
      for (const pack of packages) {
        const key = PeriodicService.modelKey(pack.equipment_class, pack.equipment_model);
        if (!packagesByModel.has(key)) packagesByModel.set(key, []);
        packagesByModel.get(key).push(pack);
      }
      const units = unitsResult.rows.map(row => {
        const modelPackages = packagesByModel.get(PeriodicService.modelKey(row.kelas_alat, equipmentModel(row))) || [];
        return { ...row, due: PeriodicService.calculateModelSchedule({
          packages: modelPackages,
          currentHm: row.current_hm,
          enrollmentHm: row.enrollment_hm,
          lastCompletedDueHm: row.last_completed_due_hm,
          warningHm: PeriodicService.DEFAULT_WARNING_HM
        }) };
      });
      const counts = units.reduce((acc, unit) => {
        const key = unit.open_order_status === 'in_progress' ? 'in_progress' : unit.due.status;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      res.json({ scope, period, units, packages, orders: ordersResult.rows,
        findings: findingsResult.rows, shifts: shiftsResult.rows, personnel: personnelResult.rows, counts });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }

  static async forecastPa(req, res) {
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const period = PeriodicService.resolveDashboardRange(req.body, localDate(new Date()));
      const dates = FleetDeployment.expandDates(period.dateFrom, period.dateTo);
      const source = String(req.body.source || 'mine_plan').trim().toLowerCase();
      if (!['mine_plan', 'manual'].includes(source)) throw new Error('Sumber EWH Forecast PA tidak valid.');
      const manualEwh = req.body.manual_ewh && typeof req.body.manual_ewh === 'object' ? req.body.manual_ewh : {};
      const [unitsResult, packagesResult, ordersResult, plansResult] = await Promise.all([
        pool.query(`
          SELECT e.id,e.kode_alat,e.kelas_alat,e.class_unit,e.tipe_alat,
                 hm.current_hm::float,hm.hm_date::text,
                 setup.setup_date::text,enrollment.enrollment_hm::float,
                 last_service.due_hm::float AS last_completed_due_hm
          FROM equipment e
          LEFT JOIN LATERAL (
            SELECT mpl.tanggal AS hm_date,MAX(COALESCE(mpl.hm_lifetime_finish,mpl.hm_finish)) AS current_hm
            FROM mining_production_logs mpl
            WHERE mpl.equipment_id=e.id AND mpl.deleted_at IS NULL AND mpl.hm_finish IS NOT NULL
              AND mpl.tanggal=(SELECT MAX(m2.tanggal) FROM mining_production_logs m2
                WHERE m2.equipment_id=e.id AND m2.deleted_at IS NULL AND m2.hm_finish IS NOT NULL)
            GROUP BY mpl.tanggal
          ) hm ON TRUE
          LEFT JOIN LATERAL (
            SELECT MIN(p.created_at)::date AS setup_date FROM periodic_service_packages p
            WHERE p.tenant_key=$1 AND p.project_key=$2 AND p.deleted_at IS NULL
              AND LOWER(TRIM(p.equipment_class))=LOWER(TRIM(e.kelas_alat))
              AND LOWER(TRIM(p.equipment_model))=LOWER(TRIM(COALESCE(NULLIF(TRIM(e.tipe_alat),''),NULLIF(TRIM(e.class_unit),''),e.kode_alat)))
          ) setup ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(mpl.hm_lifetime_start,mpl.hm_start,mpl.hm_lifetime_finish,mpl.hm_finish) AS enrollment_hm
            FROM mining_production_logs mpl
            WHERE mpl.equipment_id=e.id AND mpl.deleted_at IS NULL
              AND COALESCE(mpl.hm_start,mpl.hm_finish) IS NOT NULL
              AND (setup.setup_date IS NULL OR mpl.tanggal>=setup.setup_date)
            ORDER BY mpl.tanggal ASC,mpl.created_at ASC LIMIT 1
          ) enrollment ON TRUE
          LEFT JOIN LATERAL (
            SELECT due_hm FROM periodic_service_orders o
            WHERE o.equipment_id=e.id AND o.tenant_key=$1 AND o.project_key=$2
              AND o.status='completed' AND o.actual_service_hm IS NOT NULL
            ORDER BY o.actual_finish DESC,o.updated_at DESC LIMIT 1
          ) last_service ON TRUE
          WHERE e.deleted_at IS NULL AND COALESCE(e.is_active,TRUE)=TRUE
          ORDER BY e.kelas_alat,e.tipe_alat,e.kode_alat
        `, [scope.tenantKey, scope.projectKey]),
        pool.query(`SELECT * FROM periodic_service_packages
          WHERE tenant_key=$1 AND project_key=$2 AND deleted_at IS NULL AND is_active=TRUE
          ORDER BY equipment_class,equipment_model,cycle_hm`, [scope.tenantKey, scope.projectKey]),
        pool.query(`SELECT o.*,p.service_code,p.estimated_duration_hours
          FROM periodic_service_orders o LEFT JOIN periodic_service_packages p ON p.id=o.package_id
          WHERE o.tenant_key=$1 AND o.project_key=$2 AND o.status<>'cancelled'
            AND (COALESCE(o.actual_start,o.scheduled_start,o.scheduled_date::timestamptz,o.created_at)
              AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $3::date AND $4::date`,
        [scope.tenantKey, scope.projectKey, period.dateFrom, period.dateTo]),
        pool.query(`SELECT DISTINCT ON (planning_type) planning_type,data_json
          FROM productivity_plans WHERE planning_type IN ('pa-ua-ewh','spo')
          ORDER BY planning_type,updated_at DESC`)
      ]);
      const planByType = new Map(plansResult.rows.map(row => [row.planning_type, row.data_json || {}]));
      const paData = planByType.get('pa-ua-ewh') || {};
      const spoData = planByType.get('spo') || {};
      const packagesByModel = new Map();
      for (const pack of packagesResult.rows) {
        const key = PeriodicService.modelKey(pack.equipment_class, pack.equipment_model);
        if (!packagesByModel.has(key)) packagesByModel.set(key, []);
        packagesByModel.get(key).push(pack);
      }
      const ordersByUnit = new Map();
      for (const order of ordersResult.rows) {
        if (!ordersByUnit.has(String(order.equipment_id))) ordersByUnit.set(String(order.equipment_id), []);
        ordersByUnit.get(String(order.equipment_id)).push({ ...order,
          eventDate: localDate(order.actual_start || order.scheduled_start || order.scheduled_date || order.created_at) });
      }
      const rows = unitsResult.rows.map(unit => {
        const model = equipmentModel(unit);
        const packages = packagesByModel.get(PeriodicService.modelKey(unit.kelas_alat, model)) || [];
        const due = PeriodicService.calculateModelSchedule({ packages, currentHm: unit.current_hm,
          enrollmentHm: unit.enrollment_hm, lastCompletedDueHm: unit.last_completed_due_hm,
          warningHm: PeriodicService.DEFAULT_WARNING_HM });
        const ewhByDate = {};
        let sourceJob = null;
        if (source === 'manual') {
          const raw = manualEwh[unit.id] ?? manualEwh[unit.kode_alat];
          if (raw !== '' && raw !== null && raw !== undefined) {
            const value = Number(raw);
            if (!Number.isFinite(value) || value < 0 || value > 24) throw new Error(`EWH manual ${unit.kode_alat} harus 0–24 jam/hari.`);
            dates.forEach(date => { ewhByDate[date] = value; });
          }
        } else {
          const assignments = paData?.assignments?.PA || {};
          const paValues = paData?.values?.PA || {};
          const planUnitKey = paValues[String(unit.id)] ? String(unit.id) : (paValues[unit.kode_alat] ? unit.kode_alat : String(unit.id));
          sourceJob = assignments[String(unit.id)] || assignments[unit.kode_alat] || null;
          dates.forEach(date => { ewhByDate[date] = sourceJob
            ? FleetDeployment.dailyEwh(paData, spoData, planUnitKey, sourceJob, date) : null; });
        }
        const forecast = PeriodicServiceForecast.forecastUnit({ dateFrom: period.dateFrom, dateTo: period.dateTo,
          hmDate: unit.hm_date, currentHm: unit.current_hm, nextDueHm: due.nextDueHm,
          baseCycleHm: due.baseCycleHm, packages, ewhByDate, orders: ordersByUnit.get(String(unit.id)) || [] });
        return { equipmentId: unit.id, unitCode: unit.kode_alat, equipmentClass: unit.kelas_alat,
          equipmentModel: model, currentHm: unit.current_hm, hmDate: unit.hm_date, sourceJob,
          nextDueHm: due.nextDueHm, remainingHm: due.remainingHm, serviceCode: due.serviceCode,
          packages: packages.map(pack => ({ id: pack.id, serviceCode: pack.service_code, cycleHm: Number(pack.cycle_hm),
            estimatedDurationHours: pack.estimated_duration_hours == null ? null : Number(pack.estimated_duration_hours) })),
          ...forecast };
      });
      res.json({ period, source, dates, rows, formulaVersion: 'periodic-service-pa-forecast-v1',
        formula: 'PA = (Σ MOHH - Σ downtime PS) / Σ MOHH; MOHH = 24 jam/hari' });
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  }

  static async savePolicy(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const equipment = await assertEquipment(client, req.params.equipmentId);
      const intervalHm = positiveNumber(req.body.interval_hm, 'Interval service');
      const warningHm = nonNegativeNumber(req.body.warning_hm ?? 50, 'Warning HM');
      if (warningHm >= intervalHm) throw new Error('Warning HM harus lebih kecil dari interval service.');
      const baselineHm = nonNegativeNumber(req.body.baseline_hm ?? 0, 'Baseline HM');
      const actor = await actorId(client, req.user);
      const expectedRevision = req.body.revision === undefined ? null : Number(req.body.revision);
      await client.query('BEGIN');
      const current = await client.query(`SELECT * FROM periodic_service_policies
        WHERE tenant_key=$1 AND project_key=$2 AND equipment_id=$3 AND deleted_at IS NULL FOR UPDATE`,
      [scope.tenantKey, scope.projectKey, equipment.id]);
      if (current.rows[0] && expectedRevision !== null && expectedRevision !== Number(current.rows[0].revision)) {
        throw httpError('Konfigurasi service telah diubah user lain. Muat ulang data.', 409);
      }
      const result = current.rows[0]
        ? await client.query(`UPDATE periodic_service_policies SET interval_hm=$1,warning_hm=$2,baseline_hm=$3,
            is_enabled=$4,revision=revision+1,updated_by=$5,updated_at=now() WHERE id=$6 RETURNING *`,
          [intervalHm, warningHm, baselineHm, req.body.is_enabled !== false, actor, current.rows[0].id])
        : await client.query(`INSERT INTO periodic_service_policies
            (tenant_key,project_key,equipment_id,interval_hm,warning_hm,baseline_hm,is_enabled,created_by,updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
          [scope.tenantKey, scope.projectKey, equipment.id, intervalHm, warningHm, baselineHm, req.body.is_enabled !== false, actor]);
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.statusCode || 400).json({ error: error.message });
    } finally { client.release(); }
  }

  static async createPackage(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const actor = await actorId(client, req.user);
      await client.query('BEGIN');
      const pack = await savePackageVersion(client, scope, req.body, actor);
      await client.query('COMMIT');
      res.status(201).json(pack);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.code === '23505' ? 409 : (error.statusCode || 400)).json({
        error: error.code === '23505' ? 'Kode atau periode service tersebut sudah digunakan pada Tipe Model ini.' : error.message
      });
    } finally { client.release(); }
  }

  static async updatePackage(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const actor = await actorId(client, req.user);
      await client.query('BEGIN');
      const pack = await savePackageVersion(client, scope, req.body, actor, req.params.id);
      await client.query('COMMIT');
      res.json(pack);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.code === '23505' ? 409 : (error.statusCode || 400)).json({
        error: error.code === '23505' ? 'Area Setup dengan Tipe Model dan kode service tersebut sudah tersedia.' : error.message
      });
    } finally { client.release(); }
  }

  static async createOrder(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const equipment = await assertEquipment(client, req.body.equipment_id);
      const actor = await actorId(client, req.user);
      const isDirectRealization = req.body.actual_start !== undefined || req.body.actual_finish !== undefined;
      const actualStart = isDirectRealization ? timestamp(req.body.actual_start, 'Mulai service') : null;
      const actualFinish = isDirectRealization ? timestamp(req.body.actual_finish, 'Selesai service') : null;
      const downtimeHours = isDirectRealization ? PeriodicService.hoursBetween(actualStart, actualFinish) : null;
      if (isDirectRealization && downtimeHours <= 0) throw new Error('Selesai service harus lebih akhir dari mulai service.');
      if (isDirectRealization && actualFinish.getTime() > Date.now() + 24 * 3600 * 1000) {
        throw new Error('Selesai service tidak boleh melebihi 24 jam ke depan.');
      }
      if (isDirectRealization && !req.body.shift_id) throw new Error('Shift service wajib dipilih.');
      if (isDirectRealization && !actor) throw new Error('User tidak ditemukan. Silakan login ulang.');
      const serviceHm = isDirectRealization ? nonNegativeNumber(req.body.actual_service_hm, 'HM saat service') : null;
      const scheduledStart = isDirectRealization ? actualStart : timestamp(req.body.scheduled_start, 'Waktu service');
      const additionalItems = validateAdditionalOrderItems(req.body.additional_items);
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`periodic-service:${equipment.id}`]);
      const packagesResult = await client.query(`SELECT * FROM periodic_service_packages
        WHERE tenant_key=$1 AND project_key=$2 AND deleted_at IS NULL AND is_active=TRUE
          AND LOWER(TRIM(equipment_class))=LOWER(TRIM($3))
          AND LOWER(TRIM(equipment_model))=LOWER(TRIM($4))
        ORDER BY cycle_hm,service_code`, [scope.tenantKey, scope.projectKey, equipment.kelas_alat, equipmentModel(equipment)]);
      if (!packagesResult.rows.length) throw new Error('Area Setup Periodic Service untuk Tipe Model unit ini belum tersedia.');
      const setupResult = await client.query(`SELECT MIN(created_at)::date AS setup_date
        FROM periodic_service_packages
        WHERE tenant_key=$1 AND project_key=$2 AND deleted_at IS NULL
          AND LOWER(TRIM(equipment_class))=LOWER(TRIM($3))
          AND LOWER(TRIM(equipment_model))=LOWER(TRIM($4))`,
      [scope.tenantKey, scope.projectKey, equipment.kelas_alat, equipmentModel(equipment)]);
      const setupDate = setupResult.rows[0]?.setup_date;
      const hmResult = await client.query(`
        SELECT
          (SELECT MAX(COALESCE(hm_lifetime_finish,hm_finish))::float FROM mining_production_logs
            WHERE equipment_id=$1 AND deleted_at IS NULL AND hm_finish IS NOT NULL
              AND tanggal=(SELECT MAX(tanggal) FROM mining_production_logs WHERE equipment_id=$1 AND deleted_at IS NULL AND hm_finish IS NOT NULL)) AS current_hm,
          (SELECT COALESCE(hm_lifetime_start,hm_start,hm_lifetime_finish,hm_finish)::float FROM mining_production_logs
            WHERE equipment_id=$1 AND deleted_at IS NULL AND COALESCE(hm_start,hm_finish) IS NOT NULL
              AND ($2::date IS NULL OR tanggal >= $2::date)
            ORDER BY tanggal ASC,created_at ASC LIMIT 1) AS enrollment_hm`, [equipment.id, setupDate || null]);
      const lastDueResult = await client.query(`SELECT due_hm::float FROM periodic_service_orders
        WHERE tenant_key=$1 AND project_key=$2 AND equipment_id=$3 AND status='completed'
        ORDER BY actual_finish DESC,updated_at DESC LIMIT 1`, [scope.tenantKey, scope.projectKey, equipment.id]);
      const schedule = PeriodicService.calculateModelSchedule({
        packages: packagesResult.rows,
        currentHm: hmResult.rows[0]?.current_hm,
        enrollmentHm: hmResult.rows[0]?.enrollment_hm,
        lastCompletedDueHm: lastDueResult.rows[0]?.due_hm,
        warningHm: PeriodicService.DEFAULT_WARNING_HM
      });
      if (!schedule.packageId || schedule.nextDueHm === null) throw new Error('HM Input Data belum tersedia untuk mengunci milestone service unit ini.');
      let pack = req.body.package_id ? packagesResult.rows.find(item => String(item.id) === String(req.body.package_id)) : null;
      if (!pack) {
        pack = packagesResult.rows.find(item => String(item.id) === String(schedule.packageId)) || packagesResult.rows[0];
      }
      const dueHm = req.body.due_hm !== undefined && req.body.due_hm !== null && req.body.due_hm !== ''
        ? nonNegativeNumber(req.body.due_hm, 'Target HM Servis')
        : schedule.nextDueHm;
      const result = await client.query(`INSERT INTO periodic_service_orders
        (tenant_key,project_key,equipment_id,policy_id,package_id,due_hm,warning_hm_snapshot,scheduled_date,scheduled_start,notes,created_by,updated_by)
        VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [scope.tenantKey, scope.projectKey, equipment.id, pack.id, dueHm, PeriodicService.DEFAULT_WARNING_HM,
        localDate(scheduledStart), scheduledStart.toISOString(), String(req.body.notes || '').trim() || null, actor]);
      const noteTrimmed = String(req.body.notes || '').trim();
      if (noteTrimmed) {
        await client.query(`INSERT INTO periodic_service_findings
          (tenant_key,project_key,order_id,equipment_id,category,severity,description,recommendation,follow_up_type,due_date,pic_id,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [scope.tenantKey, scope.projectKey, result.rows[0].id, equipment.id,
          'Temuan Service', req.body.finding_severity || 'medium',
          noteTrimmed, req.body.finding_recommendation || null,
          'monitor', req.body.finding_due_date || null,
          req.body.pic_id || null, actor]);
      }
      const setupItems = (await client.query(`SELECT id AS package_item_id,item_type,item_code,item_name,
          specification,planned_qty,uom,is_required
        FROM periodic_service_package_items WHERE package_id=$1 ORDER BY sort_order,created_at,id`, [pack.id])).rows;
      const orderItems = [
        ...setupItems.map(item => ({ ...item, sourceType: 'setup' })),
        ...additionalItems.map(item => ({
          package_item_id: null, item_type: item.itemType, item_code: item.itemCode,
          item_name: item.itemName, specification: item.specification, planned_qty: item.qty,
          uom: item.uom, is_required: item.isRequired, sourceType: 'additional'
        }))
      ];
      for (let index = 0; index < orderItems.length; index += 1) {
        const item = orderItems[index];
        await client.query(`INSERT INTO periodic_service_order_items
          (order_id,package_item_id,source_type,item_type,item_code,item_name,specification,planned_qty,uom,is_required,sort_order,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [result.rows[0].id, item.package_item_id,
          item.sourceType, item.item_type, item.item_code || null, item.item_name, item.specification || null,
          item.planned_qty ?? null, item.uom || null, item.is_required !== false, index, actor]);
      }
      let directResult = null;
      if (isDirectRealization) {
        const overlap = await client.query(`SELECT id FROM breakdown_logs
          WHERE equipment_id=$1 AND deleted_at IS NULL
            AND start_time<$3::timestamptz AND COALESCE(finish_time,now())>$2::timestamptz
          LIMIT 1`, [equipment.id, actualStart.toISOString(), actualFinish.toISOString()]);
        if (overlap.rows.length) throw httpError('Waktu service bertabrakan dengan breakdown lain pada unit yang sama.', 409);
        const serviceDate = localDate(actualFinish);
        const loggedHmResult = await client.query(`SELECT MAX(COALESCE(hm_lifetime_finish,hm_finish))::float AS hm FROM mining_production_logs
          WHERE equipment_id=$1 AND deleted_at IS NULL AND tanggal=(SELECT MAX(tanggal) FROM mining_production_logs
            WHERE equipment_id=$1 AND deleted_at IS NULL AND tanggal<=$2::date)`, [equipment.id, serviceDate]);
        const loggedHm = Number(loggedHmResult.rows[0]?.hm);
        if (Number.isFinite(loggedHm) && serviceHm + PeriodicService.HM_TOLERANCE < loggedHm) {
          throw new Error(`HM service (${serviceHm}) tidak boleh lebih kecil dari HM terakhir Input Data (${loggedHm}).`);
        }
        const codeResult = await client.query(`SELECT id FROM master_breakdown_codes
          WHERE UPPER(kode)='PS' AND deleted_at IS NULL LIMIT 1`);
        if (!codeResult.rows[0]) throw new Error('Master Breakdown PS belum tersedia. Jalankan migrasi 058.');
        const note = String(req.body.notes || '').trim() || null;
        const breakdown = await client.query(`INSERT INTO breakdown_logs
          (tanggal,shift_id,equipment_id,breakdown_code_id,description,remark,start_time,finish_time,
           repair_completed_at,repair_completed_by,total_breakdown_hours,status,current_status,reported_by,pic_id,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,'resolved','resolved',$9,$11,$9,$9) RETURNING *`,
        [localDate(actualStart), req.body.shift_id, equipment.id, codeResult.rows[0].id,
          `Periodic Service ${equipment.kode_alat}`, note, actualStart.toISOString(), actualFinish.toISOString(), actor,
          downtimeHours, req.body.pic_id || null]);
        await client.query(`INSERT INTO breakdown_status_history
          (breakdown_id,status,started_at,ended_at,note,changed_by,counts_as_breakdown)
          VALUES ($1,'mechanic_progress',$2,$3,$4,$5,TRUE)`, [breakdown.rows[0].id, actualStart.toISOString(),
          actualFinish.toISOString(), 'Generated otomatis dari realisasi Periodic Service', actor]);
        await client.query(`UPDATE periodic_service_orders SET status='completed',breakdown_id=$1,
          actual_start=$2,actual_finish=$3,actual_service_hm=$4,completed_by=$5,updated_by=$5,updated_at=now()
          WHERE id=$6`, [breakdown.rows[0].id, actualStart.toISOString(), actualFinish.toISOString(), serviceHm,
          actor, result.rows[0].id]);
        for (const item of orderItems) {
          await client.query(`INSERT INTO periodic_service_actual_items
            (order_id,package_item_id,item_type,item_name,planned_qty,actual_qty,uom,completion_status,note)
            VALUES ($1,$2,$3,$4,$5,$5,$6,'completed',NULL)`, [result.rows[0].id, item.package_item_id,
            item.item_type, item.item_name, item.planned_qty ?? null, item.uom || null]);
        }
        directResult = { breakdown_id: breakdown.rows[0].id, status: 'completed', actual_start: actualStart.toISOString(),
          actual_finish: actualFinish.toISOString(), actual_service_hm: serviceHm, downtime_hours: downtimeHours, code: 'PS' };
      }
      await client.query('COMMIT');
      res.status(201).json({ ...result.rows[0], ...directResult, planned_items: orderItems });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.code === '23505' ? 409 : (error.statusCode || 400)).json({ error: error.code === '23505' ? 'Unit sudah memiliki work order service aktif.' : error.message });
    } finally { client.release(); }
  }

  static async updateOrder(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const actor = await actorId(client, req.user);
      if (!actor) throw new Error('User tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');
      const orderResult = await client.query(`SELECT o.* FROM periodic_service_orders o
        WHERE o.id=$1 AND o.tenant_key=$2 AND o.project_key=$3 FOR UPDATE`,
      [req.params.id, scope.tenantKey, scope.projectKey]);
      const order = orderResult.rows[0];
      if (!order) throw httpError('Work order service tidak ditemukan.', 404);

      let actualStart = order.actual_start;
      let actualFinish = order.actual_finish;
      let scheduledStart = order.scheduled_start;
      let downtimeHours = null;

      if (req.body.actual_start !== undefined) {
        actualStart = req.body.actual_start ? timestamp(req.body.actual_start, 'Mulai service') : null;
      }
      if (req.body.actual_finish !== undefined) {
        actualFinish = req.body.actual_finish ? timestamp(req.body.actual_finish, 'Selesai service') : null;
      }
      if (actualStart && actualFinish) {
        downtimeHours = PeriodicService.hoursBetween(actualStart, actualFinish);
        if (downtimeHours <= 0) throw new Error('Selesai service harus lebih akhir dari mulai service.');
      }
      if (req.body.scheduled_start !== undefined) {
        scheduledStart = req.body.scheduled_start ? timestamp(req.body.scheduled_start, 'Waktu service') : null;
      }

      const serviceHm = req.body.actual_service_hm !== undefined
        ? (req.body.actual_service_hm === null || req.body.actual_service_hm === '' ? null : nonNegativeNumber(req.body.actual_service_hm, 'HM saat service'))
        : order.actual_service_hm;

      const dueHm = req.body.due_hm !== undefined && req.body.due_hm !== null && req.body.due_hm !== ''
        ? nonNegativeNumber(req.body.due_hm, 'Target HM service')
        : order.due_hm;

      const notes = req.body.notes !== undefined ? (String(req.body.notes || '').trim() || null) : order.notes;
      const packageId = req.body.package_id || order.package_id;

      await client.query(`UPDATE periodic_service_orders
        SET package_id=$1, due_hm=$2, scheduled_start=$3, scheduled_date=$4,
            actual_start=$5, actual_finish=$6, actual_service_hm=$7, notes=$8,
            updated_by=$9, updated_at=now()
        WHERE id=$10`,
      [packageId, dueHm, scheduledStart ? scheduledStart.toISOString() : null,
        scheduledStart ? localDate(scheduledStart) : (actualStart ? localDate(actualStart) : order.scheduled_date),
        actualStart ? actualStart.toISOString() : null, actualFinish ? actualFinish.toISOString() : null,
        serviceHm, notes, actor, order.id]);

      if (order.breakdown_id) {
        const shiftId = req.body.shift_id || null;
        await client.query(`UPDATE breakdown_logs
          SET start_time=COALESCE($1, start_time), finish_time=COALESCE($2, finish_time),
              repair_completed_at=COALESCE($2, repair_completed_at),
              total_breakdown_hours=COALESCE($3, total_breakdown_hours),
              shift_id=COALESCE($4, shift_id),
              updated_by=$5, updated_at=now()
          WHERE id=$6`,
        [actualStart ? actualStart.toISOString() : null,
          actualFinish ? actualFinish.toISOString() : null,
          downtimeHours, shiftId, actor, order.breakdown_id]);

        if (actualStart && actualFinish) {
          await client.query(`UPDATE breakdown_status_history
            SET started_at=$1, ended_at=$2, changed_by=$3
            WHERE breakdown_id=$4 AND ended_at IS NOT NULL`,
          [actualStart.toISOString(), actualFinish.toISOString(), actor, order.breakdown_id]);
        }
      }

      if (notes) {
        const existingFinding = await client.query(`SELECT id FROM periodic_service_findings WHERE order_id=$1 LIMIT 1`, [order.id]);
        if (!existingFinding.rows.length) {
          await client.query(`INSERT INTO periodic_service_findings
            (tenant_key,project_key,order_id,equipment_id,category,severity,description,follow_up_type,created_by,updated_by)
            VALUES ($1,$2,$3,$4,'Temuan Service','medium',$5,'monitor',$6,$6)`,
          [scope.tenantKey, scope.projectKey, order.id, order.equipment_id, notes, actor]);
        } else {
          await client.query(`UPDATE periodic_service_findings SET description=$1, updated_by=$2, updated_at=now() WHERE id=$3`,
          [notes, actor, existingFinding.rows[0].id]);
        }
      }

      await client.query('COMMIT');
      res.json({ success: true, message: 'Work order service berhasil diperbarui.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.statusCode || 400).json({ error: error.message });
    } finally { client.release(); }
  }

  static async deleteOrder(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const actor = await actorId(client, req.user);
      if (!actor) throw new Error('User tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');
      const orderResult = await client.query(`SELECT o.* FROM periodic_service_orders o
        WHERE o.id=$1 AND o.tenant_key=$2 AND o.project_key=$3 FOR UPDATE`,
      [req.params.id, scope.tenantKey, scope.projectKey]);
      const order = orderResult.rows[0];
      if (!order) throw httpError('Work order service tidak ditemukan.', 404);

      await client.query(`DELETE FROM periodic_service_time_corrections WHERE order_id=$1`, [order.id]);
      await client.query(`DELETE FROM periodic_service_actual_items WHERE order_id=$1`, [order.id]);
      await client.query(`DELETE FROM periodic_service_order_items WHERE order_id=$1`, [order.id]);
      await client.query(`DELETE FROM periodic_service_findings WHERE order_id=$1`, [order.id]);

      const breakdownId = order.breakdown_id;
      if (breakdownId) {
        await client.query(`UPDATE periodic_service_orders SET breakdown_id=NULL WHERE id=$1`, [order.id]);
        await client.query(`DELETE FROM breakdown_status_history WHERE breakdown_id=$1`, [breakdownId]);
        await client.query(`DELETE FROM breakdown_logs WHERE id=$1`, [breakdownId]);
      }

      await client.query(`DELETE FROM periodic_service_orders WHERE id=$1`, [order.id]);

      const otherActive = await client.query(`SELECT 1 FROM breakdown_logs
        WHERE equipment_id=$1 AND status='open' AND deleted_at IS NULL LIMIT 1`, [order.equipment_id]);
      if (!otherActive.rows.length) {
        await client.query(`UPDATE equipment SET status_alat='Ready' WHERE id=$1`, [order.equipment_id]);
      }

      await client.query('COMMIT');
      res.json({ success: true, message: 'Work order service dan log terkait berhasil dihapus.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.statusCode || 400).json({ error: error.message });
    } finally { client.release(); }
  }

  static async startOrder(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const startedAt = timestamp(req.body.started_at || new Date().toISOString(), 'Waktu mulai');
      if (startedAt.getTime() > Date.now() + 300000) throw new Error('Waktu mulai tidak boleh berada di masa depan.');
      if (!req.body.shift_id) throw new Error('Shift wajib dipilih.');
      const actor = await actorId(client, req.user);
      if (!actor) throw new Error('User tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');
      const orderResult = await client.query(`SELECT o.*,e.kode_alat FROM periodic_service_orders o
        JOIN equipment e ON e.id=o.equipment_id WHERE o.id=$1 AND o.tenant_key=$2 AND o.project_key=$3 FOR UPDATE`,
      [req.params.id, scope.tenantKey, scope.projectKey]);
      const order = orderResult.rows[0];
      if (!order) throw httpError('Work order service tidak ditemukan.', 404);
      if (order.status !== 'scheduled') throw httpError('Hanya work order Scheduled yang dapat dimulai.', 409);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(order.equipment_id)]);
      const active = await client.query(`SELECT id FROM breakdown_logs WHERE equipment_id=$1 AND status='open' AND deleted_at IS NULL LIMIT 1`, [order.equipment_id]);
      if (active.rows.length) throw httpError('Unit masih memiliki breakdown aktif. Selesaikan insiden tersebut sebelum memulai Periodic Service.', 409);
      const codeResult = await client.query(`SELECT id FROM master_breakdown_codes WHERE UPPER(kode)='PS' AND deleted_at IS NULL LIMIT 1`);
      if (!codeResult.rows[0]) throw new Error('Master Breakdown PS belum tersedia. Jalankan migrasi 058.');
      const breakdown = await client.query(`INSERT INTO breakdown_logs
        (tanggal,shift_id,equipment_id,breakdown_code_id,description,remark,start_time,total_breakdown_hours,status,current_status,reported_by,pic_id,created_by,updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,0,'open','mechanic_progress',$8,$9,$8,$8) RETURNING *`,
      [localDate(startedAt), req.body.shift_id, order.equipment_id, codeResult.rows[0].id,
        `Periodic Service ${order.kode_alat}`, String(req.body.note || '').trim() || null, startedAt.toISOString(), actor,
        req.body.pic_id || null]);
      await client.query(`INSERT INTO breakdown_status_history
        (breakdown_id,status,started_at,note,changed_by,counts_as_breakdown)
        VALUES ($1,'mechanic_progress',$2,$3,$4,TRUE)`,
      [breakdown.rows[0].id, startedAt.toISOString(), 'Generated otomatis dari Periodic Service', actor]);
      await client.query(`UPDATE periodic_service_orders SET status='in_progress',breakdown_id=$1,actual_start=$2,updated_by=$3,updated_at=now() WHERE id=$4`,
      [breakdown.rows[0].id, startedAt.toISOString(), actor, order.id]);
      await client.query(`UPDATE equipment SET status_alat='Breakdown' WHERE id=$1`, [order.equipment_id]);
      await client.query('COMMIT');
      res.json({ success: true, order_id: order.id, breakdown_id: breakdown.rows[0].id, code: 'PS' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.statusCode || 400).json({ error: error.message });
    } finally { client.release(); }
  }

  static async completeOrder(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const finishedAt = timestamp(req.body.finished_at || new Date().toISOString(), 'Waktu selesai');
      const serviceHm = nonNegativeNumber(req.body.actual_service_hm, 'HM saat service');
      const actor = await actorId(client, req.user);
      if (!actor) throw new Error('User tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');
      const orderResult = await client.query(`SELECT * FROM periodic_service_orders
        WHERE id=$1 AND tenant_key=$2 AND project_key=$3 FOR UPDATE`, [req.params.id, scope.tenantKey, scope.projectKey]);
      const order = orderResult.rows[0];
      if (!order) throw httpError('Work order service tidak ditemukan.', 404);
      if (order.status !== 'in_progress' || !order.breakdown_id) throw httpError('Service belum dimulai atau sudah selesai.', 409);
      const startedAt = new Date(order.actual_start);
      const downtime = PeriodicService.hoursBetween(startedAt, finishedAt);
      const serviceDate = localDate(finishedAt);
      const currentHmResult = await client.query(`SELECT MAX(COALESCE(hm_lifetime_finish,hm_finish))::float AS hm FROM mining_production_logs
        WHERE equipment_id=$1 AND deleted_at IS NULL AND tanggal=(SELECT MAX(tanggal) FROM mining_production_logs
          WHERE equipment_id=$1 AND deleted_at IS NULL AND tanggal<=$2::date)`, [order.equipment_id, serviceDate]);
      const loggedHm = Number(currentHmResult.rows[0]?.hm);
      if (Number.isFinite(loggedHm) && serviceHm + 0.001 < loggedHm) throw new Error(`HM service (${serviceHm}) tidak boleh lebih kecil dari HM terakhir Input Data (${loggedHm}).`);
      await client.query(`UPDATE breakdown_status_history SET ended_at=$2,note=concat_ws(E'\n',note,$3),changed_by=$4
        WHERE breakdown_id=$1 AND ended_at IS NULL`, [order.breakdown_id, finishedAt.toISOString(), String(req.body.note || '').trim() || 'Periodic Service selesai', actor]);
      await client.query(`UPDATE breakdown_logs SET status='resolved',current_status='resolved',finish_time=$2,
        repair_completed_at=$2,repair_completed_by=$3,total_breakdown_hours=$4,updated_by=$3,updated_at=now()
        WHERE id=$1`, [order.breakdown_id, finishedAt.toISOString(), actor, downtime]);
      await client.query(`UPDATE periodic_service_orders SET status='completed',actual_finish=$2,actual_service_hm=$3,
        completed_by=$4,updated_by=$4,notes=concat_ws(E'\n',notes,$5),updated_at=now() WHERE id=$1`,
      [order.id, finishedAt.toISOString(), serviceHm, actor, String(req.body.note || '').trim() || null]);

      const suppliedItems = Array.isArray(req.body.items) ? req.body.items : [];
      const items = suppliedItems.length ? suppliedItems : (await client.query(`SELECT package_item_id,item_type,item_name,planned_qty,uom
        FROM periodic_service_order_items WHERE order_id=$1 ORDER BY sort_order`, [order.id])).rows;
      for (const item of items) {
        await client.query(`INSERT INTO periodic_service_actual_items
          (order_id,package_item_id,item_type,item_name,planned_qty,actual_qty,uom,completion_status,note)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [order.id, item.package_item_id || item.id || null,
          item.item_type || 'task', String(item.item_name || '').trim(), item.planned_qty || null,
          item.actual_qty ?? item.planned_qty ?? null, item.uom || null, item.completion_status || 'completed',
          String(item.note || '').trim() || null]);
      }
      for (const finding of (Array.isArray(req.body.findings) ? req.body.findings : [])) {
        if (!String(finding.description || '').trim()) continue;
        await client.query(`INSERT INTO periodic_service_findings
          (tenant_key,project_key,order_id,equipment_id,category,severity,description,recommendation,follow_up_type,due_date,pic_id,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`, [scope.tenantKey, scope.projectKey, order.id,
          order.equipment_id, String(finding.category || '').trim() || null, finding.severity || 'medium',
          String(finding.description).trim(), String(finding.recommendation || '').trim() || null,
          finding.follow_up_type || 'monitor', finding.due_date || null, finding.pic_id || null, actor]);
      }
      const otherActive = await client.query(`SELECT 1 FROM breakdown_logs WHERE equipment_id=$1 AND id<>$2 AND status='open' AND deleted_at IS NULL LIMIT 1`, [order.equipment_id, order.breakdown_id]);
      if (!otherActive.rows.length) await client.query(`UPDATE equipment SET status_alat='Ready' WHERE id=$1`, [order.equipment_id]);
      await client.query('COMMIT');
      res.json({ success: true, order_id: order.id, breakdown_id: order.breakdown_id, downtime_hours: downtime, actual_service_hm: serviceHm });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.statusCode || 400).json({ error: error.message });
    } finally { client.release(); }
  }

  static async correctTime(req, res) {
    const client = await pool.connect();
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const correctedStart = timestamp(req.body.started_at, 'Waktu mulai koreksi');
      const correctedFinish = timestamp(req.body.finished_at, 'Waktu selesai koreksi');
      const correctedHours = PeriodicService.hoursBetween(correctedStart, correctedFinish);
      const reason = String(req.body.reason || '').trim();
      if (!reason) throw new Error('Alasan koreksi waktu wajib diisi.');
      const actor = await actorId(client, req.user);
      if (!actor) throw new Error('User tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');
      const orderResult = await client.query(`SELECT o.*,bl.start_time,bl.finish_time FROM periodic_service_orders o
        JOIN breakdown_logs bl ON bl.id=o.breakdown_id
        WHERE o.id=$1 AND o.tenant_key=$2 AND o.project_key=$3 FOR UPDATE`, [req.params.id, scope.tenantKey, scope.projectKey]);
      const order = orderResult.rows[0];
      if (!order) throw httpError('Realisasi Periodic Service tidak ditemukan.', 404);
      if (order.status !== 'completed') throw httpError('Koreksi waktu hanya tersedia untuk service yang sudah selesai.', 409);
      const overlap = await client.query(`SELECT id FROM breakdown_logs WHERE equipment_id=$1 AND id<>$2 AND deleted_at IS NULL
        AND start_time<$4::timestamptz AND COALESCE(finish_time,now())>$3::timestamptz LIMIT 1`,
      [order.equipment_id, order.breakdown_id, correctedStart.toISOString(), correctedFinish.toISOString()]);
      if (overlap.rows.length) throw httpError('Interval koreksi bertabrakan dengan breakdown lain pada unit yang sama.', 409);
      const previousHours = PeriodicService.hoursBetween(order.start_time, order.finish_time);
      await client.query(`INSERT INTO periodic_service_time_corrections
        (order_id,breakdown_id,previous_start,previous_finish,corrected_start,corrected_finish,previous_hours,corrected_hours,reason,changed_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [order.id, order.breakdown_id, order.start_time, order.finish_time,
        correctedStart.toISOString(), correctedFinish.toISOString(), previousHours, correctedHours, reason, actor]);
      await client.query(`UPDATE breakdown_status_history SET started_at=$2,ended_at=$3,
        note=concat_ws(E'\n',note,'Koreksi PS: ' || $4),changed_by=$5 WHERE breakdown_id=$1`,
      [order.breakdown_id, correctedStart.toISOString(), correctedFinish.toISOString(), reason, actor]);
      await client.query(`UPDATE breakdown_logs SET tanggal=$2,start_time=$3,finish_time=$4,repair_completed_at=$4,
        total_breakdown_hours=$5,updated_by=$6,updated_at=now() WHERE id=$1`, [order.breakdown_id, localDate(correctedStart),
        correctedStart.toISOString(), correctedFinish.toISOString(), correctedHours, actor]);
      await client.query(`UPDATE periodic_service_orders SET actual_start=$2,actual_finish=$3,updated_by=$4,updated_at=now() WHERE id=$1`,
      [order.id, correctedStart.toISOString(), correctedFinish.toISOString(), actor]);
      await client.query('COMMIT');
      res.json({ success: true, previous_hours: previousHours, corrected_hours: correctedHours,
        mohh_note: 'Selisih waktu PS tidak dihapus; rekonsiliasikan sebagai HM, Standby, breakdown lain, atau gap MOHH.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.statusCode || 400).json({ error: error.message });
    } finally { client.release(); }
  }

  static async updateFinding(req, res) {
    try {
      const scope = PeriodicService.scopeFromUser(req.user);
      const status = String(req.body.status || '').trim();
      if (!['open', 'in_progress', 'resolved', 'cancelled'].includes(status)) throw new Error('Status temuan tidak valid.');
      const actor = await actorId(pool, req.user);
      const result = await pool.query(`UPDATE periodic_service_findings SET status=$1,pic_id=COALESCE($2,pic_id),
        recommendation=COALESCE($3,recommendation),updated_by=$4,updated_at=now()
        WHERE id=$5 AND tenant_key=$6 AND project_key=$7 RETURNING *`, [status, req.body.pic_id || null,
        String(req.body.recommendation || '').trim() || null, actor, req.params.id, scope.tenantKey, scope.projectKey]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Temuan tidak ditemukan.' });
      res.json(result.rows[0]);
    } catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
  }
}

module.exports = PeriodicServiceController;
