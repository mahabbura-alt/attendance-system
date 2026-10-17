'use strict';

const Workforce = require('./workforce');
const WorkforceMpp = require('./workforceMpp');

const ADD_TYPES = new Set(['HIRE', 'REHIRE']);
const EXIT_TYPES = new Set(['RESIGN', 'TERMINATION', 'CONTRACT_END', 'RETIREMENT']);
const MOVE_TYPES = new Set(['TRANSFER', 'PROMOTION', 'DEMOTION']);

const ID_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function err(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function monthRange(fromPeriod, toPeriod) {
  const from = Workforce.monthPeriod(fromPeriod);
  const to = Workforce.monthPeriod(toPeriod);
  if (to.from <= from.from) throw err('Bulan akhir forecast harus setelah bulan baseline.', 422);
  const months = [];
  let year = from.year;
  let month = from.month;
  for (let step = 0; step < 12; step += 1) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    if (`${year}-${String(month).padStart(2, '0')}` === to.period) break;
  }
  if (months[months.length - 1] !== to.period) throw err('Rentang forecast maksimal 12 bulan.', 422);
  return { from, to, months };
}

function labelMonth(period) {
  const [year, month] = period.split('-').map(Number);
  return `${ID_MONTHS[month - 1]} ${year}`;
}

const cleanName = value => String(value || '').trim().toLowerCase();

function buildCatalog(lines) {
  const exact = new Map();
  const byPosition = new Map();
  for (const row of lines) {
    const pid = String(row.position_id);
    exact.set(`${cleanName(row.department_snapshot)}||${cleanName(row.position_snapshot)}`, pid);
    if (!byPosition.has(cleanName(row.position_snapshot))) byPosition.set(cleanName(row.position_snapshot), []);
    byPosition.get(cleanName(row.position_snapshot)).push(pid);
  }
  return { exact, byPosition };
}

function resolveByName(catalog, departmentName, positionName) {
  const exactHit = catalog.exact.get(`${cleanName(departmentName)}||${cleanName(positionName)}`);
  if (exactHit) return exactHit;
  const candidates = catalog.byPosition.get(cleanName(positionName)) || [];
  if (candidates.length === 1) return candidates[0];
  return null;
}

async function getForecast(db, scope, fromValue, toValue) {
  const { from, to, months } = monthRange(fromValue, toValue);
  const baselineDate = from.to;
  const horizonEnd = to.to;
  const workspace = await WorkforceMpp.getMppWorkspace(db, scope, from.period);
  const catalog = buildCatalog(workspace.lines);

  const [requiredRows, movements, t0Assignments, contracts] = await Promise.all([
    db.query(`SELECT l.position_id::text AS position_id, mp.period_month::text AS period_month,
        mp.required_qty::int AS required_qty
      FROM workforce_mpp_line_periods mp
      JOIN workforce_mpp_lines l ON l.id = mp.line_id
      JOIN workforce_mpp_plans p ON p.id = l.plan_id
      JOIN (SELECT period_year, max(version_no) AS v FROM workforce_mpp_plans
        WHERE tenant_key = $1 AND project_key = $2 GROUP BY period_year) latest
        ON latest.period_year = p.period_year AND latest.v = p.version_no
      WHERE p.tenant_key = $1 AND p.project_key = $2
        AND mp.period_month > $3::date AND mp.period_month <= $4::date`,
    [scope.tenantKey, scope.projectKey, baselineDate, horizonEnd]),
    db.query(`SELECT m.id::text AS id, m.movement_no, m.movement_type,
        m.effective_date::text AS effective_date, m.before_state, m.after_state,
        m.employee_profile_id::text AS employee_profile_id,
        r.position_id::text AS request_position_id
      FROM workforce_employee_movements m
      LEFT JOIN workforce_manpower_requests r ON r.id = m.manpower_request_id
      WHERE m.tenant_key = $1 AND m.project_key = $2 AND m.status = 'APPROVED'
        AND m.effective_date > $3::date AND m.effective_date <= $4::date
      ORDER BY m.effective_date`,
    [scope.tenantKey, scope.projectKey, baselineDate, horizonEnd]),
    db.query(`SELECT a.employee_profile_id::text AS employee_profile_id,
        a.position_id::text AS position_id,
        a.department_snapshot, a.position_snapshot
      FROM workforce_employee_assignments a
      WHERE a.tenant_key = $1 AND a.project_key = $2
        AND a.effective_from <= $3::date
        AND (a.effective_to IS NULL OR a.effective_to >= $3::date)
        AND a.status IN ('ACTIVE','CLOSED')`,
    [scope.tenantKey, scope.projectKey, baselineDate]),
    db.query(`SELECT u.nama, ep.contract_end_date::text AS contract_end_date,
        a.position_id::text AS position_id,
        a.department_snapshot, a.position_snapshot
      FROM workforce_employee_profiles ep
      JOIN users u ON u.id = ep.user_id
      LEFT JOIN workforce_employee_assignments a ON a.employee_profile_id = ep.id
        AND a.tenant_key = $1 AND a.project_key = $2
        AND a.effective_from <= $3::date
        AND (a.effective_to IS NULL OR a.effective_to >= $3::date)
        AND a.status IN ('ACTIVE','CLOSED')
      WHERE ep.tenant_key = $1 AND ep.deleted_at IS NULL
        AND ep.employment_status IN ('ACTIVE','PROBATION','NOTICE') AND u.is_active = TRUE
        AND ep.contract_end_date > $3::date AND ep.contract_end_date <= $4::date`,
    [scope.tenantKey, scope.projectKey, baselineDate, horizonEnd]),
  ]);

  const requiredByPosMonth = new Map();
  for (const row of requiredRows.rows) {
    requiredByPosMonth.set(`${row.position_id}||${String(row.period_month).slice(0, 7)}`, Number(row.required_qty));
  }
  const t0ByProfile = new Map(t0Assignments.rows.map(row => [row.employee_profile_id, row]));

  const deltas = new Map();
  const take = (positionId, periodMonth) => {
    const key = `${positionId}||${periodMonth}`;
    if (!deltas.has(key)) {
      deltas.set(key, { added: 0, exited: 0, in: 0, out: 0, movements: [], unmapped: 0 });
    }
    return deltas.get(key);
  };
  let unmappedEvents = 0;
  const noteUnmapped = () => { unmappedEvents += 1; };

  const sourceOf = movement => {
    const t0 = t0ByProfile.get(movement.employee_profile_id);
    if (t0 && t0.position_id) return t0.position_id;
    const hit = resolveByName(catalog, movement.before_state?.department, movement.before_state?.position)
      || (t0 ? resolveByName(catalog, t0.department_snapshot, t0.position_snapshot) : null);
    return hit;
  };

  for (const movement of movements.rows) {
    const periodMonth = String(movement.effective_date).slice(0, 7);
    if (ADD_TYPES.has(movement.movement_type)) {
      const target = movement.request_position_id
        || resolveByName(catalog, movement.after_state?.department, movement.after_state?.position);
      if (!target) { noteUnmapped(); continue; }
      const cell = take(target, periodMonth);
      cell.added += 1;
      cell.movements.push(movement.movement_no);
    } else if (EXIT_TYPES.has(movement.movement_type)) {
      const source = sourceOf(movement);
      if (!source) { noteUnmapped(); continue; }
      const cell = take(source, periodMonth);
      cell.exited += 1;
      cell.movements.push(movement.movement_no);
    } else if (MOVE_TYPES.has(movement.movement_type)) {
      const source = sourceOf(movement);
      const target = resolveByName(catalog, movement.after_state?.department, movement.after_state?.position);
      if (source) {
        const cell = take(source, periodMonth);
        cell.out += 1;
        cell.movements.push(movement.movement_no);
      }
      if (target && target !== source) {
        const cell = take(target, periodMonth);
        cell.in += 1;
        cell.movements.push(movement.movement_no);
      }
      if (!source && !target) noteUnmapped();
    }
  }

  const contractRisk = new Map();
  for (const row of contracts.rows) {
    const pid = row.position_id || resolveByName(catalog, row.department_snapshot, row.position_snapshot);
    if (!pid) { noteUnmapped(); continue; }
    const periodMonth = String(row.contract_end_date).slice(0, 7);
    const key = `${pid}||${periodMonth}`;
    if (!contractRisk.has(key)) contractRisk.set(key, { count: 0, earliest: row.contract_end_date });
    const risk = contractRisk.get(key);
    risk.count += 1;
    if (row.contract_end_date < risk.earliest) risk.earliest = row.contract_end_date;
  }

  const positions = workspace.lines.map(line => ({
    department_id: line.department_id,
    department_name: line.department_snapshot,
    position_id: line.position_id,
    position_name: line.position_snapshot,
    is_critical: Boolean(line.is_critical),
    baseline_actual: Number(line.actual) || 0,
    forecast: {},
    required: {},
    variance: {},
    causes: {},
    lineage: {},
    risk: 'Aman',
  }));

  // Kumulatif per jabatan: event efektif pada bulan N mengubah semua bulan >= N.
  for (const position of positions) {
    let running = position.baseline_actual;
    for (const period of months) {
      const parts = [];
      let added = 0; let exited = 0; let movedIn = 0; let movedOut = 0;
      const nos = [];
      for (const [key, cell] of deltas) {
        const sep = key.lastIndexOf('||');
        if (key.slice(0, sep) !== String(position.position_id) || key.slice(sep + 2) !== period) continue;
        added += cell.added; exited += cell.exited; movedIn += cell.in; movedOut += cell.out;
        nos.push(...cell.movements);
      }
      running += added - exited + movedIn - movedOut;
      const required = requiredByPosMonth.has(`${position.position_id}||${period}`)
        ? requiredByPosMonth.get(`${position.position_id}||${period}`)
        : null;
      const risk = contractRisk.get(`${position.position_id}||${period}`) || { count: 0 };
      if (added) parts.push(`+${added} masuk`);
      if (exited) parts.push(`-${exited} keluar`);
      if (movedIn || movedOut) parts.push(`±${movedIn}/${movedOut} mutasi`);
      if (risk.count) parts.push(`${risk.count} kontrak berakhir`);
      position.forecast[period] = running;
      position.required[period] = required;
      position.variance[period] = required == null ? null : running - required;
      position.causes[period] = parts;
      position.lineage[period] = { added, exited, in: movedIn, out: movedOut, contracts: risk.count, movements: nos };
    }
    const critical = months.some(period => position.variance[period] != null && position.variance[period] < 0);
    const watch = months.some(period => (position.lineage[period]?.contracts || 0) > 0);
    position.risk = critical ? 'Kritis' : (watch ? 'Waspada' : 'Aman');
  }

  const totals = {};
  for (const period of months) {
    const known = positions.filter(row => requiredByPosMonth.has(`${row.position_id}||${period}`));
    const forecastSum = positions.reduce((sum, row) => sum + row.forecast[period], 0);
    const requiredSum = known.reduce((sum, row) => sum + requiredByPosMonth.get(`${row.position_id}||${period}`), 0);
    totals[period] = {
      forecast: forecastSum,
      required: known.length === positions.length ? requiredSum : null,
      variance: known.length === positions.length ? forecastSum - requiredSum : null,
    };
  }

  return {
    from: from.period,
    to: to.period,
    baseline_date: baselineDate,
    months,
    month_labels: Object.fromEntries(months.map(period => [period, labelMonth(period)])),
    positions,
    totals,
    meta: {
      approved_movements: movements.rows.length,
      contracts_ending: contracts.rows.length,
      unmapped_events: unmappedEvents,
    },
  };
}

async function createScenario(pool, user, input = {}) {
  const scope = Workforce.scopeFromUser(user);
  const name = String(input.name || '').trim();
  if (!name) throw err('Nama simulasi wajib diisi.', 422);
  if (!input.base_period) throw err('Periode baseline simulasi wajib diisi (YYYY-MM).', 422);
  const base = Workforce.monthPeriod(input.base_period);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw err('Minimal satu baris simulasi diperlukan.', 422);
  const seen = new Set();
  const normalized = lines.map(row => {
    const positionId = String(row.position_id || '').trim();
    if (!positionId) throw err('Jabatan simulasi wajib diisi.', 422);
    const periodMonth = String(row.period_month || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodMonth)) {
      throw err('Bulan simulasi harus tanggal pertama bulan (YYYY-MM-01).', 422);
    }
    const qty = Number(row.required_qty);
    if (!Number.isInteger(qty) || qty < 0) throw err('Kebutuhan simulasi harus bilangan non-negatif.', 422);
    const key = `${periodMonth}||${positionId}`;
    if (seen.has(key)) throw err('Baris simulasi duplikat (bulan + jabatan).', 422);
    seen.add(key);
    return { position_id: positionId, period_month: periodMonth, required_qty: qty, notes: String(row.notes || '').trim() || null };
  });
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    const catalog = await q(`SELECT p.id::text AS position_id, p.name AS position_name,
        d.id AS department_id, d.name AS department_name
      FROM workforce_positions p JOIN workforce_departments d ON d.id = p.department_id
      WHERE p.id = ANY($1::uuid[]) AND p.tenant_key = $2 AND p.project_key = $3
        AND p.is_active = TRUE AND d.tenant_key = $2 AND d.project_key = $3 AND d.is_active = TRUE`,
    [[...new Set(normalized.map(row => row.position_id))], scope.tenantKey, scope.projectKey]);
    const catalogMap = new Map(catalog.rows.map(row => [row.position_id, row]));
    for (const row of normalized) {
      if (!catalogMap.has(row.position_id)) throw err('Satu atau lebih jabatan tidak tersedia pada project ini.', 422);
    }
    const scenario = (await q(`INSERT INTO workforce_mpp_scenarios
        (tenant_key, project_key, name, base_period, notes, created_by)
      VALUES ($1, $2, $3, $4::date, $5, $6) RETURNING *`,
    [scope.tenantKey, scope.projectKey, name, base.from, String(input.notes || '').trim() || null, user.id])).rows[0];
    for (const row of normalized) {
      const position = catalogMap.get(row.position_id);
      await q(`INSERT INTO workforce_mpp_scenario_lines
          (scenario_id, period_month, department_id, position_id,
           department_snapshot, position_snapshot, required_qty, notes)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)`,
      [scenario.id, row.period_month, position.department_id, position.id,
        position.department_name, position.position_name, row.required_qty, row.notes]);
    }
    await q('COMMIT');
    return { scenario: { ...scenario, simulation: true } };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

async function listScenarios(db, scope, options = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let filter = '';
  if (options.from) {
    const base = Workforce.monthPeriod(options.from);
    params.push(base.from);
    filter += ` AND s.base_period >= $${params.length}::date`;
  }
  if (options.to) {
    const base = Workforce.monthPeriod(options.to);
    params.push(base.from);
    filter += ` AND s.base_period <= $${params.length}::date`;
  }
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  params.push(limit);
  const rows = await db.query(`SELECT s.*, u.nama AS creator_name,
      COALESCE((SELECT count(*) FROM workforce_mpp_scenario_lines l WHERE l.scenario_id = s.id), 0)::int AS line_count
    FROM workforce_mpp_scenarios s
    LEFT JOIN users u ON u.id = s.created_by
    WHERE s.tenant_key = $1 AND s.project_key = $2${filter}
    ORDER BY s.created_at DESC LIMIT $${params.length}`,
  params);
  return rows.rows.map(row => ({ ...row, simulation: true }));
}

async function getScenario(db, scope, id) {
  const scenario = (await db.query(`SELECT s.*, u.nama AS creator_name
    FROM workforce_mpp_scenarios s LEFT JOIN users u ON u.id = s.created_by
    WHERE s.id = $1 AND s.tenant_key = $2 AND s.project_key = $3`,
  [id, scope.tenantKey, scope.projectKey])).rows[0];
  if (!scenario) throw err('Simulasi tidak ditemukan.', 404);
  const lines = (await db.query(`SELECT l.*, l.period_month::text AS period_month
    FROM workforce_mpp_scenario_lines l WHERE l.scenario_id = $1 ORDER BY l.period_month, l.position_snapshot`,
  [scenario.id])).rows;
  const months = [...new Set(lines.map(row => String(row.period_month).slice(0, 7)))].sort();
  let approved = [];
  if (months.length) {
    const years = [...new Set(months.map(period => Number(period.slice(0, 4))))];
    const approvedRows = await db.query(`SELECT l.position_id::text AS position_id,
        mp.period_month::text AS period_month, mp.required_qty::int AS required_qty
      FROM workforce_mpp_line_periods mp
      JOIN workforce_mpp_lines l ON l.id = mp.line_id
      JOIN workforce_mpp_plans p ON p.id = l.plan_id
      JOIN (SELECT period_year, max(version_no) AS v FROM workforce_mpp_plans
        WHERE tenant_key = $1 AND project_key = $2 GROUP BY period_year) latest
        ON latest.period_year = p.period_year AND latest.v = p.version_no
      WHERE p.tenant_key = $1 AND p.project_key = $2 AND p.period_year = ANY($3::int[])
        AND mp.period_month >= $4::date AND mp.period_month <= $5::date`,
    [scope.tenantKey, scope.projectKey, years,
      `${months[0]}-01`, `${months[months.length - 1]}-01`]);
    approved = approvedRows.rows;
  }
  const approvedMap = new Map(approved.map(row => [`${row.position_id}||${String(row.period_month).slice(0, 7)}`, Number(row.required_qty)]));
  return {
    scenario: { ...scenario, simulation: true },
    lines: lines.map(row => {
      const key = `${row.position_id}||${String(row.period_month).slice(0, 7)}`;
      const official = approvedMap.has(key) ? approvedMap.get(key) : null;
      return { ...row, approved_required_qty: official, delta_vs_approved: official == null ? null : Number(row.required_qty) - official };
    }),
  };
}

async function deleteScenario(pool, user, id) {
  const scope = Workforce.scopeFromUser(user);
  const removed = (await pool.query(`DELETE FROM workforce_mpp_scenarios
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 RETURNING id`,
  [id, scope.tenantKey, scope.projectKey])).rows[0];
  if (!removed) throw err('Simulasi tidak ditemukan.', 404);
  return { deleted: true };
}

module.exports = {
  ADD_TYPES, EXIT_TYPES, MOVE_TYPES,
  monthRange, labelMonth,
  getForecast, createScenario, listScenarios, getScenario, deleteScenario,
};
