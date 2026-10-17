'use strict';

const crypto = require('node:crypto');
const Workforce = require('./workforce');

const MPP_PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
const MPP_AUDIT_ACTIONS = new Set(['CREATE', 'UPDATE', 'REVISION', 'APPROVAL']);

function err(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

function fillRate(actual, required) {
  const req = Number(required);
  if (!Number.isFinite(req) || req <= 0) return null;
  const act = Number(actual) || 0;
  return Math.min(act, req) / req;
}

function gapStatus(gap) {
  const g = Number(gap) || 0;
  if (g > 0) return 'Kurang';
  if (g < 0) return 'Lebih';
  return 'Sesuai';
}

function summarizeLines(lines = []) {
  let actual = 0;
  let required = 0;
  let critical = 0;
  for (const row of lines) {
    const act = Number(row.actual) || 0;
    const req = Number(row.required_qty) || 0;
    actual += act;
    required += req;
    if (row.is_critical && req - act > 0) critical += 1;
  }
  const gap = required - actual;
  return {
    actual, required, gap,
    fill_rate: fillRate(actual, required),
    open_vacancy: Math.max(required - actual, 0),
    critical_positions: critical,
  };
}

function departmentSummaries(lines = []) {
  const groups = new Map();
  for (const row of lines) {
    const key = String(row.department_id || row.department_snapshot || '');
    if (!groups.has(key)) {
      groups.set(key, {
        department_id: row.department_id || null,
        department_name: row.department_snapshot || '',
        lines: [],
      });
    }
    groups.get(key).lines.push(row);
  }
  return [...groups.values()]
    .map(group => ({ ...group, ...summarizeLines(group.lines) }))
    .sort((a, b) => (b.required - b.actual) - (a.required - a.actual)
      || String(a.department_name).localeCompare(String(b.department_name), 'id-ID'));
}

function canonicalLines(lines) {
  return [...lines]
    .map(row => ({ ...row, position_id: String(row.position_id || '') }))
    .sort((a, b) => a.position_id.localeCompare(b.position_id));
}

function payloadHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function getMppWorkspace(db, scope, periodValue) {
  const selected = Workforce.monthPeriod(periodValue);
  const planResult = await db.query(`SELECT * FROM workforce_mpp_plans
    WHERE tenant_key=$1 AND project_key=$2 AND period_year=$3
    ORDER BY version_no DESC LIMIT 1`, [scope.tenantKey, scope.projectKey, selected.year]);
  const plan = planResult.rows[0] || null;
  const lines = await db.query(`SELECT
      d.id AS department_id, d.name AS department_snapshot,
      pos.id AS position_id, pos.name AS position_snapshot,
      l.id AS line_id, l.is_critical, l.notes AS line_notes,
      COALESCE(mp.required_qty, 0)::int AS required_qty,
      mp.reason_code, mp.reason_text, mp.notes AS period_notes,
      mp.priority, mp.needed_by::text AS needed_by, COALESCE(mp.revision, 1)::int AS revision,
      COALESCE(actual.qty, 0)::int AS actual
    FROM workforce_positions pos
    JOIN workforce_departments d ON d.id = pos.department_id
    LEFT JOIN workforce_mpp_lines l ON l.plan_id = $1 AND (
      l.position_id = pos.id OR (l.position_id IS NULL
        AND lower(l.department_snapshot) = lower(d.name)
        AND lower(l.position_snapshot) = lower(pos.name)))
    LEFT JOIN workforce_mpp_line_periods mp ON mp.line_id = l.id AND mp.period_month = $4::date
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT a.employee_profile_id)::int AS qty
      FROM workforce_employee_assignments a
      JOIN workforce_employee_profiles ep ON ep.id = a.employee_profile_id
      JOIN users u ON u.id = ep.user_id
      WHERE a.tenant_key = $2 AND a.project_key = $3
        AND (a.position_id = pos.id OR (a.position_id IS NULL
          AND lower(COALESCE(a.department_snapshot, '')) = lower(d.name)
          AND lower(COALESCE(a.position_snapshot, '')) = lower(pos.name)))
        AND a.status IN ('ACTIVE', 'CLOSED')
        AND a.effective_from <= $5::date
        AND (a.effective_to IS NULL OR a.effective_to >= $5::date)
        AND ep.deleted_at IS NULL AND ep.employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE')
        AND u.is_active = TRUE
    ) actual ON TRUE
    WHERE d.tenant_key = $2 AND d.project_key = $3 AND d.is_active = TRUE
      AND pos.tenant_key = $2 AND pos.project_key = $3 AND pos.is_active = TRUE
    ORDER BY d.name, pos.name`,
  [plan?.id || null, scope.tenantKey, scope.projectKey, selected.from, selected.to]);
  const enriched = lines.rows.map(row => {
    const gap = Number(row.required_qty) - Number(row.actual);
    return {
      ...row,
      gap,
      vacancy: Math.max(gap, 0),
      status: gapStatus(gap),
    };
  });
  return {
    period: selected.period,
    year: selected.year,
    snapshot_date: selected.to,
    plan,
    lines: enriched,
    departments: departmentSummaries(enriched),
    summary: summarizeLines(enriched),
  };
}

async function getActualDetail(db, scope, periodValue, positionId) {
  const selected = Workforce.monthPeriod(periodValue);
  const position = (await db.query(`SELECT p.id, p.name, d.id AS department_id, d.name AS department_name
    FROM workforce_positions p JOIN workforce_departments d ON d.id = p.department_id
    WHERE p.id = $1 AND p.tenant_key = $2 AND p.project_key = $3 AND p.is_active = TRUE
      AND d.tenant_key = $2 AND d.project_key = $3 AND d.is_active = TRUE`,
  [positionId, scope.tenantKey, scope.projectKey])).rows[0];
  if (!position) {
    throw err('Jabatan tidak tersedia pada project ini.', 404);
  }
  const personnel = await db.query(`SELECT u.nama, u.employee_id,
      ep.employment_status, ep.grade, ep.employment_type, ep.contract_end_date::text AS contract_end_date,
      a.department_snapshot, a.position_snapshot, a.effective_from::text AS effective_from
    FROM workforce_employee_assignments a
    JOIN workforce_employee_profiles ep ON ep.id = a.employee_profile_id
    JOIN users u ON u.id = ep.user_id
    WHERE a.tenant_key = $1 AND a.project_key = $2 AND a.position_id = $3
      AND a.status IN ('ACTIVE', 'CLOSED')
      AND a.effective_from <= $4::date
      AND (a.effective_to IS NULL OR a.effective_to >= $4::date)
      AND ep.deleted_at IS NULL AND ep.employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE')
      AND u.is_active = TRUE
    ORDER BY u.nama`,
  [scope.tenantKey, scope.projectKey, position.id, selected.to]);
  return {
    period: selected.period,
    snapshot_date: selected.to,
    position,
    count: personnel.rows.length,
    personnel: personnel.rows,
  };
}

function validatePriority(value, label) {
  const text = String(value == null || value === '' ? 'NORMAL' : value).trim().toUpperCase();
  if (!MPP_PRIORITIES.has(text)) throw err(`${label || 'Priority'} harus salah satu dari LOW/NORMAL/HIGH/CRITICAL.`, 422);
  return text;
}

async function saveMppWorkspace(pool, user, input = {}, idempotencyKey = null) {
  const scope = Workforce.scopeFromUser(user);
  if (!input.period) throw err('Periode bulan MPP wajib dipilih.', 422);
  const selected = Workforce.monthPeriod(input.period);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw err('Minimal satu baris kebutuhan MPP diperlukan.', 422);
  const positionIds = lines.map(row => String(row.position_id || '').trim());
  if (positionIds.some(id => !id) || new Set(positionIds).size !== positionIds.length) {
    throw err('Daftar jabatan MPP tidak valid atau duplikat.', 422);
  }
  const key = idempotencyKey ? String(idempotencyKey).trim() || null : null;
  const canonical = canonicalLines(lines.map(row => ({
    position_id: String(row.position_id || '').trim(),
    required_qty: Number(row.required_qty),
    reason_code: row.reason_code == null ? null : String(row.reason_code).trim() || null,
    reason_text: row.reason_text == null ? null : String(row.reason_text).trim() || null,
    notes: row.notes == null ? null : String(row.notes).trim() || null,
    priority: row.priority == null || row.priority === '' ? 'NORMAL' : String(row.priority),
    needed_by: row.needed_by == null || row.needed_by === '' ? null : String(row.needed_by),
    expected_revision: row.expected_revision == null ? null : Number(row.expected_revision),
  })));
  const fingerprint = payloadHash({ period: selected.period, lines: canonical });
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    if (key) {
      const replay = await q(`SELECT new_value FROM workforce_mpp_requirement_audit
        WHERE tenant_key = $1 AND project_key = $2 AND idempotency_key = $3
          AND action IN ('CREATE','UPDATE') ORDER BY created_at DESC LIMIT 1`,
      [scope.tenantKey, scope.projectKey, key]);
      const prior = replay.rows[0] ? replay.rows[0].new_value : null;
      if (prior && prior.lines
        && payloadHash({ period: prior.period || null, lines: prior.lines }) === fingerprint) {
        await q('COMMIT');
        const current = await q(`SELECT * FROM workforce_mpp_plans
          WHERE tenant_key = $1 AND project_key = $2 AND period_year = $3
          ORDER BY version_no DESC LIMIT 1`, [scope.tenantKey, scope.projectKey, selected.year]);
        return { plan: current.rows[0] || null, deduped: true };
      }
    }
    const catalog = await q(`SELECT pos.id AS position_id, pos.name AS position_name,
        d.id AS department_id, d.name AS department_name
      FROM workforce_positions pos JOIN workforce_departments d ON d.id = pos.department_id
      WHERE pos.id = ANY($1::uuid[]) AND pos.tenant_key = $2 AND pos.project_key = $3
        AND pos.is_active = TRUE AND d.tenant_key = $2 AND d.project_key = $3 AND d.is_active = TRUE`,
    [positionIds, scope.tenantKey, scope.projectKey]);
    if (catalog.rowCount !== positionIds.length) throw err('Satu atau lebih jabatan tidak tersedia pada project ini.', 422);
    const positionMap = new Map(catalog.rows.map(row => [String(row.position_id), row]));
    if (input.expected_version_no != null && input.expected_version_no !== '') {
      const latest = await q(`SELECT version_no FROM workforce_mpp_plans
        WHERE tenant_key = $1 AND project_key = $2 AND period_year = $3
        ORDER BY version_no DESC LIMIT 1 FOR UPDATE`,
      [scope.tenantKey, scope.projectKey, selected.year]);
      if (latest.rows[0] && Number(latest.rows[0].version_no) !== Number(input.expected_version_no)) {
        throw err('Plan berubah oleh pengguna lain. Muat ulang sebelum menyimpan.', 409);
      }
    }
    let plan = (await q(`SELECT * FROM workforce_mpp_plans
      WHERE tenant_key = $1 AND project_key = $2 AND period_year = $3
      ORDER BY version_no DESC LIMIT 1 FOR UPDATE`,
    [scope.tenantKey, scope.projectKey, selected.year])).rows[0];
    const creatingNewVersion = Boolean(plan && plan.status !== 'DRAFT');
    if (creatingNewVersion) {
      const previousPlanId = plan.id;
      const inserted = await q(`INSERT INTO workforce_mpp_plans
        (tenant_key, project_key, name, period_year, version_no, status, revision_note, created_by)
        VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7) RETURNING *`,
      [scope.tenantKey, scope.projectKey, input.name || `MPP ${selected.year}`,
        selected.year, Number(plan.version_no) + 1,
        input.revision_note || `Revisi ${selected.period}`, user.id]);
      plan = inserted.rows[0];
      await q(`INSERT INTO workforce_mpp_lines
          (plan_id, department_id, position_id, department_snapshot, position_snapshot,
           grade, employment_type, is_critical, notes)
        SELECT $1, department_id, position_id, department_snapshot, position_snapshot,
          grade, employment_type, is_critical, notes
        FROM workforce_mpp_lines WHERE plan_id = $2`, [plan.id, previousPlanId]);
      await q(`INSERT INTO workforce_mpp_line_periods
          (line_id, period_month, required_qty, reason_code, reason_text, notes,
           priority, needed_by, revision, updated_by)
        SELECT next_line.id, period.period_month, period.required_qty, period.reason_code,
          period.reason_text, period.notes, period.priority, period.needed_by,
          period.revision, period.updated_by
        FROM workforce_mpp_line_periods period
        JOIN workforce_mpp_lines old_line ON old_line.id = period.line_id
        JOIN workforce_mpp_lines next_line ON next_line.plan_id = $1
          AND lower(next_line.department_snapshot) = lower(old_line.department_snapshot)
          AND lower(next_line.position_snapshot) = lower(old_line.position_snapshot)
          AND next_line.grade = old_line.grade AND next_line.employment_type = old_line.employment_type
        WHERE old_line.plan_id = $2`, [plan.id, previousPlanId]);
    } else if (!plan) {
      plan = (await q(`INSERT INTO workforce_mpp_plans
        (tenant_key, project_key, name, period_year, version_no, status, created_by)
        VALUES ($1, $2, $3, $4, 1, 'DRAFT', $5) RETURNING *`,
      [scope.tenantKey, scope.projectKey, input.name || `MPP ${selected.year}`, selected.year, user.id])).rows[0];
    }
    for (const row of canonical) {
      const position = positionMap.get(String(row.position_id));
      if (!Number.isInteger(row.required_qty) || row.required_qty < 0) {
        throw err(`Kebutuhan ${position.position_name} harus bilangan non-negatif.`, 422);
      }
      const priority = validatePriority(row.priority, `Priority ${position.position_name}`);
      let neededBy = null;
      if (row.needed_by != null) {
        neededBy = Workforce.dateOnly(row.needed_by, `Needed-by ${position.position_name}`);
        if (neededBy < selected.from) throw err(`Needed-by ${position.position_name} minimal awal bulan periode.`, 422);
      }
      let line = (await q(`SELECT l.id, mp.required_qty, mp.revision,
          mp.reason_code, mp.reason_text, mp.notes, mp.priority,
          mp.needed_by::text AS needed_by
        FROM workforce_mpp_lines l
        LEFT JOIN workforce_mpp_line_periods mp ON mp.line_id = l.id AND mp.period_month = $4::date
        WHERE l.plan_id = $1 AND (
          l.position_id = $2 OR (l.position_id IS NULL AND lower(l.department_snapshot) = lower($3)
            AND lower(l.position_snapshot) = lower($5))) LIMIT 1 FOR UPDATE OF l`,
      [plan.id, position.position_id, position.department_name, selected.from, position.position_name])).rows[0];
      const before = line == null || line.required_qty == null ? null : {
        required_qty: Number(line.required_qty),
        revision: line.revision == null ? null : Number(line.revision),
        reason_code: line.reason_code ?? null,
        reason_text: line.reason_text ?? null,
        notes: line.notes ?? null,
        priority: line.priority ?? null,
        needed_by: line.needed_by ?? null,
      };
      const qtyChanged = before == null
        ? Number(row.required_qty) !== 0
        : Number(before.required_qty) !== Number(row.required_qty);
      if (qtyChanged && (row.reason_code == null && row.reason_text == null)) {
        throw err(`Alasan perubahan kebutuhan ${position.position_name} wajib diisi.`, 422);
      }
      // Baris tanpa periode tersimpan dengan kebutuhan 0 dan tanpa metadata
      // (alasan/prioritas non-default/needed-by) bukan perubahan: lewati agar
      // baris yang tidak disentuh tidak memblokir simpan dan tidak menulis noise.
      if (before == null && Number(row.required_qty) === 0
        && row.reason_code == null && row.reason_text == null
        && String(priority).toUpperCase() === 'NORMAL' && neededBy == null) continue;
      if (row.expected_revision != null && before != null && before.revision != null
        && Number(before.revision) !== Number(row.expected_revision)) {
        throw err(`Baris ${position.position_name} berubah oleh pengguna lain. Muat ulang sebelum menyimpan.`, 409);
      }
      if (!line) {
        line = (await q(`INSERT INTO workforce_mpp_lines
          (plan_id, department_id, position_id, department_snapshot, position_snapshot)
          VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [plan.id, position.department_id, position.position_id,
          position.department_name, position.position_name])).rows[0];
      } else {
        await q(`UPDATE workforce_mpp_lines SET department_id = $2, position_id = $3,
          department_snapshot = $4, position_snapshot = $5 WHERE id = $1`,
        [line.id, position.department_id, position.position_id,
          position.department_name, position.position_name]);
      }
      const after = {
        required_qty: Number(row.required_qty),
        reason_code: row.reason_code, reason_text: row.reason_text, notes: row.notes,
        priority, needed_by: neededBy,
        revision: Number(before?.revision || 0) + 1,
      };
      const sameAsBefore = before != null
        && Number(before.required_qty) === Number(after.required_qty)
        && (before.reason_code ?? null) === (after.reason_code ?? null)
        && (before.reason_text ?? null) === (after.reason_text ?? null)
        && (before.notes ?? null) === (after.notes ?? null)
        && String(before.priority ?? 'NORMAL').toUpperCase() === String(after.priority).toUpperCase()
        && (before.needed_by ?? null) === (after.needed_by ?? null);
      if (sameAsBefore) continue;
      await q(`INSERT INTO workforce_mpp_line_periods
          (line_id, period_month, required_qty, reason_code, reason_text, notes,
           priority, needed_by, revision, updated_by, updated_at)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::date, $9, $10, CURRENT_TIMESTAMP)
        ON CONFLICT (line_id, period_month) DO UPDATE SET
          required_qty = EXCLUDED.required_qty, reason_code = EXCLUDED.reason_code,
          reason_text = EXCLUDED.reason_text, notes = EXCLUDED.notes,
          priority = EXCLUDED.priority, needed_by = EXCLUDED.needed_by,
          revision = EXCLUDED.revision, updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP`,
      [line.id, selected.from, after.required_qty, after.reason_code, after.reason_text,
        after.notes, after.priority, after.needed_by, after.revision, user.id]);
      await q(`INSERT INTO workforce_mpp_requirement_audit
          (tenant_key, project_key, plan_id, line_id, period_month, action,
           previous_value, new_value, actor_id, reason, source, idempotency_key)
        VALUES ($1, $2, $3, $4, $5::date, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)`,
      [scope.tenantKey, scope.projectKey, plan.id, line.id, selected.from,
        before == null ? 'CREATE' : 'UPDATE',
        before ? JSON.stringify({ ...before, lines: undefined }) : null,
        JSON.stringify({ ...after, period: selected.period, lines: canonical }),
        user.id, after.reason_text || after.reason_code, 'web', key]);
    }
    await q('COMMIT');
    return { plan, deduped: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

async function getMppHistory(db, scope, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const params = [scope.tenantKey, scope.projectKey];
  let filter = '';
  if (options.period) {
    const selected = Workforce.monthPeriod(options.period);
    params.push(selected.from);
    filter += ` AND a.period_month = $${params.length}::date`;
  }
  if (options.position_id) {
    params.push(String(options.position_id));
    filter += ` AND l.position_id = $${params.length}::uuid`;
  }
  params.push(limit);
  const rows = await db.query(`SELECT a.*, u.nama AS actor_name,
      l.department_snapshot, l.position_snapshot
    FROM workforce_mpp_requirement_audit a
    LEFT JOIN workforce_mpp_lines l ON l.id = a.line_id
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.tenant_key = $1 AND a.project_key = $2${filter}
    ORDER BY a.created_at DESC LIMIT $${params.length}`,
  params);
  return rows.rows;
}

module.exports = {
  MPP_PRIORITIES, fillRate, gapStatus, summarizeLines, departmentSummaries,
  getMppWorkspace, getActualDetail, saveMppWorkspace, getMppHistory,
};
