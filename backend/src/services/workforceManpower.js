'use strict';

const Workforce = require('./workforce');
const WorkforceMpp = require('./workforceMpp');

const REQUEST_STATUSES = Object.freeze([
  'DRAFT', 'SUBMITTED', 'APPROVED', 'RECRUITING',
  'CANDIDATE_READY', 'ONBOARDING', 'FULFILLED', 'CANCELLED', 'REJECTED',
]);

const REQUEST_TRANSITIONS = Object.freeze({
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['RECRUITING', 'CANCELLED'],
  RECRUITING: ['CANDIDATE_READY', 'CANCELLED'],
  CANDIDATE_READY: ['ONBOARDING', 'CANCELLED'],
  ONBOARDING: ['FULFILLED', 'CANCELLED'],
  FULFILLED: [], CANCELLED: [], REJECTED: [],
});

const TERMINAL_STATUSES = new Set(['FULFILLED', 'CANCELLED', 'REJECTED']);

const MILESTONE_COLUMN = Object.freeze({
  SUBMITTED: 'submitted_at',
  APPROVED: 'approved_at',
  RECRUITING: 'recruiting_at',
  CANDIDATE_READY: 'candidate_ready_at',
  ONBOARDING: 'onboarding_at',
  FULFILLED: 'fulfilled_at',
  CANCELLED: 'cancelled_at',
  REJECTED: 'rejected_at',
});

const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);

function err(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (!REQUEST_STATUSES.includes(status)) {
    throw err(`Status Manpower Request tidak valid: ${value}.`, 422);
  }
  return status;
}

function normalizePriority(value) {
  const text = String(value == null || value === '' ? 'NORMAL' : value).trim().toUpperCase();
  if (!PRIORITIES.has(text)) throw err('Priority harus salah satu dari LOW/NORMAL/HIGH/CRITICAL.', 422);
  return text;
}

async function positionVacancy(db, scope, periodValue, positionId) {
  const workspace = await WorkforceMpp.getMppWorkspace(db, scope, periodValue);
  const line = workspace.lines.find(row => String(row.position_id) === String(positionId));
  if (!line) throw err('Jabatan tidak tersedia pada periode ini.', 404);
  return {
    period: workspace.period,
    snapshot_date: workspace.snapshot_date,
    position_id: line.position_id,
    department_id: line.department_id,
    department_name: line.department_snapshot,
    position_name: line.position_snapshot,
    required_qty: Number(line.required_qty) || 0,
    actual: Number(line.actual) || 0,
    vacancy: Math.max((Number(line.required_qty) || 0) - (Number(line.actual) || 0), 0),
  };
}

async function getVacancy(db, scope, periodValue) {
  const workspace = await WorkforceMpp.getMppWorkspace(db, scope, periodValue);
  const selected = Workforce.monthPeriod(periodValue);
  const agg = await db.query(`SELECT position_id::text AS position_id, status,
      COALESCE(sum(qty), 0)::int AS qty, COALESCE(sum(filled_qty), 0)::int AS filled
    FROM workforce_manpower_requests
    WHERE tenant_key = $1 AND project_key = $2 AND period_month = $3::date
      AND status NOT IN ('FULFILLED','CANCELLED','REJECTED')
    GROUP BY position_id, status`,
  [scope.tenantKey, scope.projectKey, selected.from]);
  const byPosition = new Map();
  for (const row of agg.rows) {
    if (!byPosition.has(row.position_id)) byPosition.set(row.position_id, []);
    byPosition.get(row.position_id).push(row);
  }
  const lines = workspace.lines.map(line => {
    const reqs = byPosition.get(String(line.position_id)) || [];
    const requested = reqs.reduce((sum, row) => sum + Math.max(Number(row.qty) - Number(row.filled), 0), 0);
    const filled = reqs.reduce((sum, row) => sum + Number(row.filled), 0);
    const byStatus = Object.fromEntries(reqs.map(row => [row.status, {
      qty: Number(row.qty), filled: Number(row.filled),
    }]));
    const vacancy = Math.max((Number(line.required_qty) || 0) - (Number(line.actual) || 0), 0);
    return {
      department_id: line.department_id,
      department_snapshot: line.department_snapshot,
      position_id: line.position_id,
      position_snapshot: line.position_snapshot,
      is_critical: Boolean(line.is_critical),
      required_qty: Number(line.required_qty) || 0,
      actual: Number(line.actual) || 0,
      gap: Number(line.gap) || 0,
      status: line.status,
      vacancy,
      requested,
      filled,
      open_vacancy: Math.max(vacancy - filled, 0),
      by_status: byStatus,
    };
  });
  const vacancy = lines.reduce((sum, row) => sum + row.vacancy, 0);
  const linkedFilled = lines.reduce((sum, row) => sum + row.filled, 0);
  return {
    period: workspace.period,
    snapshot_date: workspace.snapshot_date,
    plan: workspace.plan,
    lines,
    summary: {
      actual: workspace.summary.actual,
      required: workspace.summary.required,
      gap: workspace.summary.gap,
      fill_rate: workspace.summary.fill_rate,
      vacancy,
      linked_filled: linkedFilled,
      open_vacancy: lines.reduce((sum, row) => sum + row.open_vacancy, 0),
      critical_positions: workspace.summary.critical_positions,
    },
  };
}

async function findMppLineId(db, scope, year, positionId) {
  const found = await db.query(`SELECT l.id FROM workforce_mpp_lines l
    JOIN workforce_mpp_plans p ON p.id = l.plan_id
    WHERE p.tenant_key = $1 AND p.project_key = $2 AND p.period_year = $3
      AND l.position_id = $4::uuid
    ORDER BY p.version_no DESC LIMIT 1`,
  [scope.tenantKey, scope.projectKey, year, positionId]);
  return found.rows[0] ? found.rows[0].id : null;
}

async function createRequest(pool, user, input = {}, idempotencyKey = null) {
  const scope = Workforce.scopeFromUser(user);
  if (!input.period) throw err('Periode Manpower Request wajib diisi (YYYY-MM).', 422);
  const selected = Workforce.monthPeriod(input.period);
  const positionId = String(input.position_id || '').trim();
  if (!positionId) throw err('Jabatan wajib dipilih.', 422);
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty <= 0) throw err('Jumlah permintaan harus bilangan bulat positif.', 422);
  const priority = normalizePriority(input.priority);
  let neededBy = null;
  if (input.needed_by != null && String(input.needed_by).trim() !== '') {
    neededBy = Workforce.dateOnly(String(input.needed_by).trim(), 'Needed-by');
    if (neededBy < selected.from) throw err('Needed-by minimal awal bulan periode.', 422);
  }
  const key = idempotencyKey ? String(idempotencyKey).trim() || null : null;
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    if (key) {
      const existing = await q(`SELECT * FROM workforce_manpower_requests
        WHERE tenant_key = $1 AND project_key = $2 AND idempotency_key = $3 LIMIT 1`,
      [scope.tenantKey, scope.projectKey, key]);
      if (existing.rows[0]) {
        await q('COMMIT');
        return { request: existing.rows[0], deduped: true };
      }
    }
    const position = (await q(`SELECT p.id, p.name, d.id AS department_id, d.name AS department_name
      FROM workforce_positions p JOIN workforce_departments d ON d.id = p.department_id
      WHERE p.id = $1 AND p.tenant_key = $2 AND p.project_key = $3 AND p.is_active = TRUE
        AND d.tenant_key = $2 AND d.project_key = $3 AND d.is_active = TRUE`,
    [positionId, scope.tenantKey, scope.projectKey])).rows[0];
    if (!position) throw err('Jabatan tidak tersedia pada project ini.', 422);
    const vacancy = await positionVacancy(client, scope, selected.period, position.id);
    const overrideReason = String(input.override_reason || '').trim() || null;
    if (qty > vacancy.vacancy) {
      if (!overrideReason) {
        throw err(`Permintaan ${qty} melebihi vacancy ${vacancy.vacancy}. Isi alasan override atau kecilkan jumlah.`, 422);
      }
      if (!user.is_super_admin) {
        const forbidden = err('Override melebihi vacancy hanya untuk super admin.', 403);
        throw forbidden;
      }
    }
    const mppLineId = await findMppLineId(client, scope, selected.year, position.id);
    const seq = await q(`SELECT nextval('workforce_manpower_request_no_seq')::bigint AS seq`);
    const stamp = new Date().toISOString().slice(2, 7).replace('-', '');
    const requestNo = `MR-${stamp}-${String(seq.rows[0].seq).padStart(6, '0')}`;
    const inserted = await q(`INSERT INTO workforce_manpower_requests
        (tenant_key, project_key, request_no, mpp_line_id, period_month,
         department_id, position_id, qty, needed_by, reason, priority,
         override_reason, status, idempotency_key, requested_by)
      VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9::date,$10,$11,$12,'DRAFT',$13,$14)
      RETURNING *`,
    [scope.tenantKey, scope.projectKey, requestNo, mppLineId, selected.from,
      position.department_id, position.id, qty, neededBy,
      String(input.reason || '').trim() || null, priority, overrideReason, key, user.id]);
    const request = inserted.rows[0];
    await q(`INSERT INTO workforce_manpower_request_events
        (request_id, from_status, to_status, actor_id, reason)
      VALUES ($1, NULL, 'DRAFT', $2, $3)`,
    [request.id, user.id, String(input.reason || overrideReason || '').trim() || null]);
    await q('COMMIT');
    return { request, vacancy: vacancy.vacancy, deduped: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

async function listRequests(db, scope, options = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let filter = '';
  if (options.period) {
    const selected = Workforce.monthPeriod(options.period);
    params.push(selected.from);
    filter += ` AND r.period_month = $${params.length}::date`;
  }
  if (options.status) {
    params.push(normalizeStatus(options.status));
    filter += ` AND r.status = $${params.length}`;
  }
  if (options.position_id) {
    params.push(String(options.position_id));
    filter += ` AND r.position_id = $${params.length}::uuid`;
  }
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));
  params.push(limit);
  const rows = await db.query(`SELECT r.*, r.needed_by::text AS needed_by,
      d.name AS department_name, p.name AS position_name, u.nama AS requester_name
    FROM workforce_manpower_requests r
    LEFT JOIN workforce_departments d ON d.id = r.department_id
    LEFT JOIN workforce_positions p ON p.id = r.position_id
    LEFT JOIN users u ON u.id = r.requested_by
    WHERE r.tenant_key = $1 AND r.project_key = $2${filter}
    ORDER BY r.created_at DESC LIMIT $${params.length}`,
  params);
  return rows.rows;
}

async function getRequestDetail(db, scope, id) {
  const request = (await db.query(`SELECT r.*, r.needed_by::text AS needed_by,
      d.name AS department_name, p.name AS position_name, u.nama AS requester_name
    FROM workforce_manpower_requests r
    LEFT JOIN workforce_departments d ON d.id = r.department_id
    LEFT JOIN workforce_positions p ON p.id = r.position_id
    LEFT JOIN users u ON u.id = r.requested_by
    WHERE r.id = $1 AND r.tenant_key = $2 AND r.project_key = $3`,
  [id, scope.tenantKey, scope.projectKey])).rows[0];
  if (!request) throw err('Manpower Request tidak ditemukan.', 404);
  const [events, fulfillments] = await Promise.all([
    db.query(`SELECT e.*, u.nama AS actor_name FROM workforce_manpower_request_events e
      LEFT JOIN users u ON u.id = e.actor_id WHERE e.request_id = $1 ORDER BY e.created_at`,
    [request.id]),
    db.query(`SELECT f.*, u.nama AS employee_name, u.employee_id, m.movement_no, m.movement_type, m.status AS movement_status
      FROM workforce_manpower_request_fulfillments f
      JOIN workforce_employee_profiles ep ON ep.id = f.employee_profile_id
      JOIN users u ON u.id = ep.user_id
      LEFT JOIN workforce_employee_movements m ON m.id = f.movement_id
      WHERE f.request_id = $1 ORDER BY f.fulfilled_at`,
    [request.id]),
  ]);
  return { request, events: events.rows, fulfillments: fulfillments.rows };
}

async function transitionRequest(pool, user, id, target, input = {}) {
  const scope = Workforce.scopeFromUser(user);
  const next = normalizeStatus(target);
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    const current = (await q(`SELECT * FROM workforce_manpower_requests
      WHERE id = $1 AND tenant_key = $2 AND project_key = $3 FOR UPDATE`,
    [id, scope.tenantKey, scope.projectKey])).rows[0];
    if (!current) throw err('Manpower Request tidak ditemukan.', 404);
    if (current.status === next) {
      await q('COMMIT');
      return { request: current, unchanged: true };
    }
    if (!REQUEST_TRANSITIONS[current.status].includes(next)) {
      throw err(`Transisi ${current.status} → ${next} tidak diizinkan.`, 409);
    }
    if (input.expected_revision != null && input.expected_revision !== ''
      && Number(current.revision) !== Number(input.expected_revision)) {
      throw err('Request berubah oleh pengguna lain. Muat ulang sebelum melanjutkan.', 409);
    }
    if (next === 'FULFILLED' && Number(current.filled_qty) < Number(current.qty)) {
      throw err(`Belum terpenuhi penuh (${current.filled_qty}/${current.qty}). Catat fulfillment terlebih dahulu.`, 422);
    }
    const milestone = MILESTONE_COLUMN[next];
    const updated = (await q(`UPDATE workforce_manpower_requests SET status = $2,
        revision = revision + 1,
        approved_by = CASE WHEN $2 = 'APPROVED' THEN $3 ELSE approved_by END,
        ${milestone} = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [current.id, next, user.id])).rows[0];
    await q(`INSERT INTO workforce_manpower_request_events
        (request_id, from_status, to_status, actor_id, reason)
      VALUES ($1, $2, $3, $4, $5)`,
    [current.id, current.status, next, user.id, String(input.reason || '').trim() || null]);
    await q('COMMIT');
    return { request: updated, unchanged: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

async function insertFulfillmentRow(q, scope, request, profileId, movementId, qty, actorId) {
  await q(`INSERT INTO workforce_manpower_request_fulfillments
      (tenant_key, project_key, request_id, employee_profile_id, movement_id, qty, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [scope.tenantKey, scope.projectKey, request.id, profileId, movementId, qty, actorId]);
  const updated = (await q(`UPDATE workforce_manpower_requests
    SET filled_qty = filled_qty + $2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 RETURNING *`,
  [request.id, qty])).rows[0];
  return updated;
}

async function recordAutoFulfillment(q, scope, request, profileId, movement, actorId) {
  const updated = await insertFulfillmentRow(q, scope, request, profileId, movement.id, 1, actorId);
  let finalRequest = updated;
  if (Number(updated.filled_qty) >= Number(updated.qty) && updated.status === 'ONBOARDING') {
    finalRequest = (await q(`UPDATE workforce_manpower_requests
      SET status = 'FULFILLED', fulfilled_at = CURRENT_TIMESTAMP,
        revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`, [request.id])).rows[0];
    await q(`INSERT INTO workforce_manpower_request_events
        (request_id, from_status, to_status, actor_id, reason)
      VALUES ($1, 'ONBOARDING', 'FULFILLED', $2, 'Terpenuhi penuh via HIRE/REHIRE efektif.')`,
    [request.id, actorId]);
  }
  return finalRequest;
}

async function addFulfillment(pool, user, requestId, input = {}) {
  const scope = Workforce.scopeFromUser(user);
  const qty = input.qty == null || input.qty === '' ? 1 : Number(input.qty);
  if (!Number.isInteger(qty) || qty <= 0) throw err('Jumlah fulfillment harus bilangan bulat positif.', 422);
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    const request = (await q(`SELECT * FROM workforce_manpower_requests
      WHERE id = $1 AND tenant_key = $2 AND project_key = $3 FOR UPDATE`,
    [requestId, scope.tenantKey, scope.projectKey])).rows[0];
    if (!request) throw err('Manpower Request tidak ditemukan.', 404);
    if (request.status !== 'ONBOARDING') {
      throw err(`Fulfillment hanya dapat dicatat pada status ONBOARDING (saat ini ${request.status}).`, 409);
    }
    if (Number(request.filled_qty) + qty > Number(request.qty)) {
      throw err(`Melebihi kebutuhan request (${request.filled_qty}/${request.qty}).`, 422);
    }
    const employeeUserId = String(input.employee_user_id || input.employee_id || '').trim();
    if (!employeeUserId) throw err('Karyawan pemenuh wajib dipilih.', 422);
    const profile = (await q(`SELECT p.id FROM workforce_employee_profiles p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1 AND p.tenant_key = $2 AND p.deleted_at IS NULL`,
    [employeeUserId, scope.tenantKey])).rows[0];
    if (!profile) throw err('Profil karyawan tidak ditemukan pada scope ini.', 404);
    let movementId = null;
    if (input.movement_id != null && String(input.movement_id).trim() !== '') {
      const movement = (await q(`SELECT * FROM workforce_employee_movements
        WHERE id = $1 AND tenant_key = $2 AND project_key = $3`,
      [String(input.movement_id).trim(), scope.tenantKey, scope.projectKey])).rows[0];
      if (!movement) throw err('Movement tidak ditemukan pada scope ini.', 404);
      if (!['HIRE', 'REHIRE'].includes(movement.movement_type)) {
        throw err('Fulfillment hanya menaut movement HIRE/REHIRE.', 422);
      }
      if (movement.status !== 'EFFECTIVE') throw err('Movement penaut harus sudah Efektif.', 422);
      if (String(movement.employee_profile_id) !== String(profile.id)) {
        throw err('Movement tidak milik karyawan tersebut.', 422);
      }
      movementId = movement.id;
    }
    let updated;
    try {
      updated = await insertFulfillmentRow(q, scope, request, profile.id, movementId, qty, user.id);
    } catch (dbError) {
      if (dbError && dbError.code === '23505') throw err('Karyawan ini sudah tercatat memenuhi request tersebut.', 409);
      throw dbError;
    }
    let finalRequest = updated;
    if (Number(updated.filled_qty) >= Number(updated.qty)) {
      finalRequest = (await q(`UPDATE workforce_manpower_requests
        SET status = 'FULFILLED', fulfilled_at = CURRENT_TIMESTAMP,
          revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING *`, [request.id])).rows[0];
      await q(`INSERT INTO workforce_manpower_request_events
          (request_id, from_status, to_status, actor_id, reason)
        VALUES ($1, 'ONBOARDING', 'FULFILLED', $2, 'Terpenuhi penuh.')`,
      [request.id, user.id]);
    }
    await q('COMMIT');
    return { request: finalRequest };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

// Dipanggil di dalam transaksi movement EFFECTIVE (workforce.js).
// Tidak pernah memblokir hire: kondisi belum siap dicatat sebagai audit skip.
async function linkMovementFulfillment(client, scope, movement, actorId) {
  const q = (text, params) => client.query(text, params);
  if (!movement || !movement.manpower_request_id) return { linked: false, reason: 'no-link' };
  if (!['HIRE', 'REHIRE'].includes(movement.movement_type)) return { linked: false, reason: 'not-hire' };
  const request = (await q(`SELECT * FROM workforce_manpower_requests
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 FOR UPDATE`,
  [movement.manpower_request_id, scope.tenantKey, scope.projectKey])).rows[0];
  const skip = async why => {
    await q(`INSERT INTO workforce_movement_audit
        (movement_id, action, previous_value, new_value, actor_id, reason)
      VALUES ($1, 'FULFILLMENT_SKIPPED', NULL, $2::jsonb, $3, $4)`,
    [movement.id, JSON.stringify({ request_id: movement.manpower_request_id, why }), actorId, why]);
    return { linked: false, reason: why };
  };
  if (!request) return skip('request-not-found');
  if (request.status !== 'ONBOARDING') return skip(`request-status-${request.status}`);
  if (Number(request.filled_qty) >= Number(request.qty)) return skip('request-already-full');
  try {
    const finalRequest = await recordAutoFulfillment(q, scope, request, movement.employee_profile_id, movement, actorId);
    return { linked: true, request: finalRequest };
  } catch (dbError) {
    if (dbError && (dbError.code === '23505' || dbError.code === '23514')) {
      return skip(dbError.code === '23505' ? 'duplicate-fulfillment' : 'over-request-qty');
    }
    throw dbError;
  }
}

module.exports = {
  REQUEST_STATUSES,
  REQUEST_TRANSITIONS,
  TERMINAL_STATUSES,
  positionVacancy,
  getVacancy,
  listRequests,
  getRequestDetail,
  createRequest,
  transitionRequest,
  addFulfillment,
  linkMovementFulfillment,
};
