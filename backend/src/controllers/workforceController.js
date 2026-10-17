'use strict';

const { pool } = require('../config/db');
const Workforce = require('../services/workforce');
const WorkforceMpp = require('../services/workforceMpp');
const WorkforceManpower = require('../services/workforceManpower');
const WorkforceForecast = require('../services/workforceForecast');

function queryDate(value, fallback) {
  return value ? Workforce.dateOnly(value, 'Periode') : fallback;
}

function monthBounds(reference = new Date()) {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}

async function summary(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const bounds = monthBounds();
    const from = queryDate(req.query.from, bounds.from);
    const to = queryDate(req.query.to, bounds.to);
    const [headcount, movements, pending, mpp] = await Promise.all([
      pool.query(`SELECT count(*)::int AS total FROM workforce_employee_profiles p
        JOIN users u ON u.id=p.user_id
        WHERE p.tenant_key=$1 AND p.deleted_at IS NULL AND u.is_active=TRUE`, [scope.tenantKey]),
      pool.query(`SELECT movement_type,count(*)::int AS total FROM workforce_employee_movements
        WHERE tenant_key=$1 AND project_key=$2 AND effective_date BETWEEN $3::date AND $4::date
          AND status IN ('APPROVED','EFFECTIVE') GROUP BY movement_type`,
      [scope.tenantKey, scope.projectKey, from, to]),
      pool.query(`SELECT count(*)::int AS total FROM workforce_employee_movements
        WHERE tenant_key=$1 AND project_key=$2 AND status IN ('SUBMITTED','APPROVED')`,
      [scope.tenantKey, scope.projectKey]),
      pool.query(`SELECT p.id,p.name,p.period_year,p.version_no,p.status,
          COALESCE(sum(mp.required_qty),0)::int AS required,
          COALESCE(sum(LEAST(COALESCE(actual.qty,0),mp.required_qty)),0)::int AS filled
        FROM workforce_mpp_plans p
        LEFT JOIN workforce_mpp_lines l ON l.plan_id=p.id
        LEFT JOIN workforce_mpp_line_periods mp ON mp.line_id=l.id
          AND mp.period_month=date_trunc('month',$3::date)::date
        LEFT JOIN LATERAL (
          SELECT count(DISTINCT a.employee_profile_id)::int AS qty FROM workforce_employee_assignments a
          JOIN workforce_employee_profiles ep ON ep.id=a.employee_profile_id
          JOIN users u ON u.id=ep.user_id
          WHERE a.tenant_key=p.tenant_key AND a.project_key=p.project_key
            AND lower(COALESCE(a.department_snapshot,''))=lower(l.department_snapshot)
            AND lower(COALESCE(a.position_snapshot,''))=lower(l.position_snapshot)
            AND a.effective_from <= $4::date AND (a.effective_to IS NULL OR a.effective_to >= $4::date)
            AND a.status IN ('ACTIVE','CLOSED')
            AND ep.deleted_at IS NULL AND ep.employment_status IN ('ACTIVE','PROBATION','NOTICE')
            AND u.is_active=TRUE
        ) actual ON TRUE
        WHERE p.tenant_key=$1 AND p.project_key=$2 AND p.is_current=TRUE
          AND p.period_year=EXTRACT(YEAR FROM $3::date)::int
        GROUP BY p.id ORDER BY p.period_year DESC LIMIT 1`,
      [scope.tenantKey, scope.projectKey, from, to]),
    ]);
    const counts = Object.fromEntries(movements.rows.map(row => [row.movement_type, row.total]));
    const masuk = Number(counts.HIRE || 0) + Number(counts.REHIRE || 0);
    const keluar = ['RESIGN','TERMINATION','CONTRACT_END','RETIREMENT'].reduce((sum, key) => sum + Number(counts[key] || 0), 0);
    const plan = mpp.rows[0] || null;
    res.json({ period: { from, to }, headcount: headcount.rows[0]?.total || 0,
      masuk, keluar, mutasi: Number(counts.TRANSFER || 0),
      promosi: Number(counts.PROMOTION || 0) + Number(counts.DEMOTION || 0),
      net_movement: masuk - keluar, pending_approval: pending.rows[0]?.total || 0,
      mpp: plan ? { ...plan, fill_rate: Number(plan.required) > 0 ? Number(plan.filled) / Number(plan.required) : null } : null });
  } catch (error) { next(error); }
}

async function listMovements(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const bounds = monthBounds();
    const from = queryDate(req.query.from, bounds.from);
    const to = queryDate(req.query.to, bounds.to);
    const params = [scope.tenantKey, scope.projectKey, from, to];
    let filter = '';
    if (req.query.type) { params.push(Workforce.normalizeMovementType(req.query.type)); filter += ` AND m.movement_type=$${params.length}`; }
    if (req.query.status) { params.push(String(req.query.status).toUpperCase()); filter += ` AND m.status=$${params.length}`; }
    if (req.query.search) { params.push(`%${String(req.query.search).trim()}%`); filter += ` AND (u.nama ILIKE $${params.length} OR u.employee_id ILIKE $${params.length} OR m.movement_no ILIKE $${params.length})`; }
    const result = await pool.query(`SELECT m.*,m.request_date::text AS request_date,m.effective_date::text AS effective_date,
        u.id AS employee_user_id,u.nama,u.employee_id,u.email,
        p.employment_status,p.grade,p.employment_type,
        COALESCE((SELECT count(*) FROM workforce_movement_tasks t WHERE t.movement_id=m.id AND t.status='DONE'),0)::int AS tasks_done,
        COALESCE((SELECT count(*) FROM workforce_movement_tasks t WHERE t.movement_id=m.id),0)::int AS tasks_total
      FROM workforce_employee_movements m
      JOIN workforce_employee_profiles p ON p.id=m.employee_profile_id
      JOIN users u ON u.id=p.user_id
      WHERE m.tenant_key=$1 AND m.project_key=$2 AND m.effective_date BETWEEN $3::date AND $4::date${filter}
      ORDER BY m.effective_date DESC,m.created_at DESC LIMIT 500`, params);
    res.json({ period: { from, to }, rows: result.rows });
  } catch (error) { next(error); }
}

async function movementDetail(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const [movement, approvals, tasks, attachments, audit] = await Promise.all([
      pool.query(`SELECT m.*,m.request_date::text AS request_date,m.effective_date::text AS effective_date,
        u.id AS employee_user_id,u.nama,u.employee_id,u.email,p.employment_status
        FROM workforce_employee_movements m JOIN workforce_employee_profiles p ON p.id=m.employee_profile_id
        JOIN users u ON u.id=p.user_id WHERE m.id=$1 AND m.tenant_key=$2 AND m.project_key=$3`,
      [req.params.id, scope.tenantKey, scope.projectKey]),
      pool.query(`SELECT a.*,u.nama AS approver_name FROM workforce_movement_approvals a LEFT JOIN users u ON u.id=a.approver_user_id WHERE a.movement_id=$1 ORDER BY a.step_no`, [req.params.id]),
      pool.query(`SELECT * FROM workforce_movement_tasks WHERE movement_id=$1 ORDER BY task_kind,task_code`, [req.params.id]),
      pool.query(`SELECT id,document_type,original_filename,mime_type,size_bytes,uploaded_at FROM workforce_movement_attachments WHERE movement_id=$1 AND deleted_at IS NULL ORDER BY uploaded_at DESC`, [req.params.id]),
      pool.query(`SELECT a.*,u.nama AS actor_name FROM workforce_movement_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.movement_id=$1 ORDER BY a.created_at`, [req.params.id]),
    ]);
    if (!movement.rows[0]) return res.status(404).json({ error: 'Pergerakan tidak ditemukan.' });
    res.json({ movement: movement.rows[0], approvals: approvals.rows, tasks: tasks.rows, attachments: attachments.rows, audit: audit.rows });
  } catch (error) { next(error); }
}

async function createMovement(req, res, next) {
  try {
    const key = String(req.headers['idempotency-key'] || req.body.idempotency_key || '').trim() || null;
    const movement = await Workforce.createMovement(pool, req.user, req.body, key);
    res.status(201).json({ message: 'Draft pergerakan berhasil dibuat.', movement });
  } catch (error) { next(error); }
}

async function transitionMovement(req, res, next) {
  try {
    const movement = await Workforce.transitionMovement(pool, req.user, req.params.id, req.body.status, req.body);
    res.json({ message: `Status pergerakan menjadi ${movement.status}.`, movement });
  } catch (error) { next(error); }
}

async function updateTask(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const status = String(req.body.status || '').toUpperCase();
    if (!['OPEN','IN_PROGRESS','DONE','WAIVED'].includes(status)) return res.status(422).json({ error: 'Status checklist tidak valid.' });
    const result = await pool.query(`UPDATE workforce_movement_tasks t SET status=$4,
      completed_by=CASE WHEN $4 IN ('DONE','WAIVED') THEN $5 ELSE NULL END,
      completed_at=CASE WHEN $4 IN ('DONE','WAIVED') THEN CURRENT_TIMESTAMP ELSE NULL END,
      notes=$6
      FROM workforce_employee_movements m
      WHERE t.id=$1 AND t.movement_id=m.id AND m.tenant_key=$2 AND m.project_key=$3 RETURNING t.*`,
    [req.params.taskId, scope.tenantKey, scope.projectKey, status, req.user.id, String(req.body.notes || '').trim() || null]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Checklist tidak ditemukan.' });
    res.json({ message: 'Checklist diperbarui.', task: result.rows[0] });
  } catch (error) { next(error); }
}

async function organization(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const [departments, positions, reasons] = await Promise.all([
      pool.query(`SELECT * FROM workforce_departments WHERE tenant_key=$1 AND project_key=$2 AND is_active=TRUE ORDER BY name`, [scope.tenantKey, scope.projectKey]),
      pool.query(`SELECT p.*,d.name AS department_name FROM workforce_positions p JOIN workforce_departments d ON d.id=p.department_id WHERE p.tenant_key=$1 AND p.project_key=$2 AND p.is_active=TRUE ORDER BY d.name,p.name`, [scope.tenantKey, scope.projectKey]),
      pool.query(`SELECT * FROM workforce_movement_reasons WHERE tenant_key=$1 AND is_active=TRUE ORDER BY movement_type,label`, [scope.tenantKey]),
    ]);
    res.json({ departments: departments.rows, positions: positions.rows, reasons: reasons.rows });
  } catch (error) { next(error); }
}

async function getMpp(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const workspace = await WorkforceMpp.getMppWorkspace(
      pool, scope, req.query.period || (req.query.year ? `${req.query.year}-01` : null));
    res.json(workspace);
  } catch (error) { next(error); }
}

async function saveMpp(req, res, next) {
  try {
    const key = String(req.headers['idempotency-key'] || req.body.idempotency_key || '').trim() || null;
    const result = await WorkforceMpp.saveMppWorkspace(pool, req.user, req.body, key);
    res.json({ message: `MPP ${req.body.period} tersimpan.${result.deduped ? ' (duplikat idempoten diabaikan)' : ''}`, period: req.body.period, plan: result.plan });
  } catch (error) { next(error); }
}

async function getMppActual(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    if (!req.query.position_id) return res.status(422).json({ error: 'position_id wajib diisi.' });
    const detail = await WorkforceMpp.getActualDetail(pool, scope, req.query.period, req.query.position_id);
    res.json(detail);
  } catch (error) { next(error); }
}

async function getMppHistory(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const rows = await WorkforceMpp.getMppHistory(pool, scope, {
      period: req.query.period || null,
      position_id: req.query.position_id || null,
      limit: req.query.limit || 50,
    });
    res.json({ rows });
  } catch (error) { next(error); }
}

async function transitionMpp(req, res, next) {
  const scope = Workforce.scopeFromUser(req.user);
  const target = String(req.body.status || '').toUpperCase();
  const allowed = { DRAFT: ['SUBMITTED','CANCELLED'], SUBMITTED: ['APPROVED','CANCELLED'] };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = (await client.query(`SELECT * FROM workforce_mpp_plans WHERE id=$1 AND tenant_key=$2 AND project_key=$3 FOR UPDATE`, [req.params.id, scope.tenantKey, scope.projectKey])).rows[0];
    if (!plan) { const error=new Error('MPP tidak ditemukan.'); error.statusCode=404; throw error; }
    if (!allowed[plan.status]?.includes(target)) { const error=new Error(`Transisi MPP ${plan.status} → ${target} tidak diizinkan.`); error.statusCode=409; throw error; }
    if (target === 'APPROVED') await client.query(`UPDATE workforce_mpp_plans SET status='SUPERSEDED',is_current=FALSE,updated_at=CURRENT_TIMESTAMP WHERE tenant_key=$1 AND project_key=$2 AND period_year=$3 AND id<>$4 AND is_current=TRUE`, [scope.tenantKey, scope.projectKey, plan.period_year, plan.id]);
    const updated = await client.query(`UPDATE workforce_mpp_plans SET status=$2,is_current=CASE WHEN $2='APPROVED' THEN TRUE ELSE is_current END,approved_by=CASE WHEN $2='APPROVED' THEN $3 ELSE approved_by END,approved_at=CASE WHEN $2='APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`, [plan.id,target,req.user.id]);
    await client.query('COMMIT');
    res.json({ message:`MPP menjadi ${target}.`, plan:updated.rows[0] });
  } catch(error) { await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
}

module.exports = { summary, listMovements, movementDetail, createMovement, transitionMovement, updateTask, organization, getMpp, saveMpp, getMppActual, getMppHistory, transitionMpp,
  getVacancy, listManpowerRequests, getManpowerRequestDetail, createManpowerRequest, transitionManpowerRequest, addManpowerFulfillment,
  getForecast, listScenarios, getScenarioDetail, createScenario, deleteScenario };

async function getVacancy(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const vacancy = await WorkforceManpower.getVacancy(pool, scope, req.query.period || null);
    res.json(vacancy);
  } catch (error) { next(error); }
}

async function listManpowerRequests(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const rows = await WorkforceManpower.listRequests(pool, scope, {
      period: req.query.period || null,
      status: req.query.status || null,
      position_id: req.query.position_id || null,
      limit: req.query.limit || 200,
    });
    res.json({ rows });
  } catch (error) { next(error); }
}

async function getManpowerRequestDetail(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const detail = await WorkforceManpower.getRequestDetail(pool, scope, req.params.id);
    res.json(detail);
  } catch (error) { next(error); }
}

async function createManpowerRequest(req, res, next) {
  try {
    const key = String(req.headers['idempotency-key'] || req.body.idempotency_key || '').trim() || null;
    const result = await WorkforceManpower.createRequest(pool, req.user, req.body, key);
    res.status(201).json({ message: `Manpower Request ${result.request.request_no} tersimpan sebagai DRAFT.${result.deduped ? ' (duplikat idempoten diabaikan)' : ''}`, vacancy: result.vacancy, request: result.request });
  } catch (error) { next(error); }
}

async function transitionManpowerRequest(req, res, next) {
  try {
    const result = await WorkforceManpower.transitionRequest(pool, req.user, req.params.id, req.body.status, req.body);
    res.json({ message: `Manpower Request menjadi ${result.request.status}.`, request: result.request });
  } catch (error) { next(error); }
}

async function addManpowerFulfillment(req, res, next) {
  try {
    const result = await WorkforceManpower.addFulfillment(pool, req.user, req.params.id, req.body);
    res.status(201).json({ message: `Fulfillment tercatat. Status request: ${result.request.status}.`, request: result.request });
  } catch (error) { next(error); }
}

async function getForecast(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const forecast = await WorkforceForecast.getForecast(pool, scope, req.query.from || null, req.query.to || null);
    res.json({ ...forecast, simulation: false });
  } catch (error) { next(error); }
}

async function listScenarios(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const rows = await WorkforceForecast.listScenarios(pool, scope, {
      from: req.query.from || null, to: req.query.to || null, limit: req.query.limit || 50,
    });
    res.json({ rows });
  } catch (error) { next(error); }
}

async function getScenarioDetail(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const detail = await WorkforceForecast.getScenario(pool, scope, req.params.id);
    res.json(detail);
  } catch (error) { next(error); }
}

async function createScenario(req, res, next) {
  try {
    const result = await WorkforceForecast.createScenario(pool, req.user, req.body);
    res.status(201).json({ message: `Simulasi ${result.scenario.name} tersimpan (terpisah dari approved MPP).`, scenario: result.scenario });
  } catch (error) { next(error); }
}

async function deleteScenario(req, res, next) {
  try {
    const scope = Workforce.scopeFromUser(req.user);
    const result = await WorkforceForecast.deleteScenario(pool, scope, req.params.id);
    res.json({ message: 'Simulasi dihapus. Approved MPP tidak berubah.', ...result });
  } catch (error) { next(error); }
}
