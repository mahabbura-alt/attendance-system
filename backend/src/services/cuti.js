'use strict';

const crypto = require('node:crypto');

// Database Cuti Karyawan — docs/RENCANA_DATABASE_CUTI_KARYAWAN.md
// Keputusan owner 2026-10-08: tahun kalender perusahaan, durasi inklusif,
// realisasi parsial masuk variance, approval Atasan + HR. Hanya CP membentuk
// siklus; CT adalah saldo hari independen dan CK tidak mengubah siklus CP.

const Workforce = require('./workforce');

const LEAVE_TYPES = new Set(['CP', 'CK', 'CT']);
const LEAVE_LABEL = { CP: 'Cuti Periodik', CK: 'Cuti Khusus', CT: 'Cuti Tahunan' };
const REQUEST_NEXT = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['SUPERVISOR_APPROVED', 'REJECTED', 'CANCELLED'],
  SUPERVISOR_APPROVED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['REALIZED', 'CANCELLED'],
  REALIZED: [],
  REJECTED: [],
  CANCELLED: [],
};
const ANNUAL_DEFAULT_DAYS = 12;

function err(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function permissionsOf(user = {}) {
  if (Array.isArray(user.permissions)) return user.permissions;
  try { return JSON.parse(user.permissions || '[]'); } catch (_) { return []; }
}

function hasHrAuthority(user = {}) {
  return user.is_super_admin === true || permissionsOf(user).includes('karyawan');
}

function assertHrAuthority(user = {}) {
  if (!hasHrAuthority(user)) throw err('Aksi ini hanya dapat dilakukan HR atau Super Admin.', 403);
}

function parseDate(value, label) {
  return Workforce.dateOnly(value, label);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

// node-pg mengembalikan kolom DATE sebagai Date (UTC midnight atau local midnight),
// bukan string YYYY-MM-DD. Concat `${date}T00:00:00Z` menghasilkan Invalid Date.
function asIsoDate(value, label = 'Tanggal') {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const localMidnight = value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0;
    const year = localMidnight ? value.getFullYear() : value.getUTCFullYear();
    const month = (localMidnight ? value.getMonth() : value.getUTCMonth()) + 1;
    const day = localMidnight ? value.getDate() : value.getUTCDate();
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }
  const text = String(value == null ? '' : value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match && !Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`))) return match[1];
  throw err(`${label} tidak valid.`, 422);
}

function toUtc(dateText) {
  return new Date(`${asIsoDate(dateText)}T00:00:00Z`);
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = toUtc(dateText);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return toIso(date);
}

// Konvensi terkunci (owner 2026-10-07): kedua batas inklusif.
// 12 Sep s.d. 25 Sep = 14 hari kalender.
function inclusiveDays(startText, endText) {
  const start = parseDate(startText, 'Tanggal mulai');
  const end = parseDate(endText, 'Tanggal selesai');
  const diff = Math.round((toUtc(end) - toUtc(start)) / 86400000) + 1;
  if (diff < 1) throw err('Tanggal selesai tidak boleh sebelum tanggal mulai.', 422);
  return diff;
}

function daysInYear(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2200) throw err('Tahun cuti tidak valid.', 422);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return leap ? 366 : 365;
}

// Entitlement tahunan memakai kebijakan yang berlaku pada tanggal acuan:
// hari ini untuk tahun berjalan, akhir tahun untuk histori, dan awal tahun
// untuk tahun mendatang. Dengan begitu versi yang mulai di tengah tahun segera
// tersinkron tanpa menulis ulang entitlement tahun yang belum berlaku.
function policyReferenceDate(year, now = new Date()) {
  const targetYear = Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2200) {
    throw err('Tahun cuti tidak valid.', 422);
  }
  const today = toIso(now);
  const currentYear = Number(today.slice(0, 4));
  if (targetYear < currentYear) return `${targetYear}-12-31`;
  if (targetYear > currentYear) return `${targetYear}-01-01`;
  return today;
}

// Helper legacy untuk kompatibilitas test/modul lama. Kebijakan baru memakai
// policyPeriodEntitlement karena T0 dapat dimulai di tengah tahun.
function periodEntitlement(workDays, leaveDays, year) {
  const cycle = Number(workDays) + Number(leaveDays);
  if (!Number.isFinite(cycle) || cycle <= 0) return 0;
  return Math.floor(daysInYear(year) / cycle);
}

function policyYearWindow(policy, year) {
  const targetYear = Number(year);
  daysInYear(targetYear);
  const yearStart = `${targetYear}-01-01`;
  const yearEnd = `${targetYear}-12-31`;
  const effectiveFrom = asIsoDate(policy.effective_from, 'T0 kebijakan');
  const effectiveTo = policy.effective_to
    ? asIsoDate(policy.effective_to, 'Akhir kebijakan') : null;
  if (effectiveFrom > yearEnd || (effectiveTo && effectiveTo < yearStart)) return null;
  return {
    start: effectiveFrom > yearStart ? effectiveFrom : yearStart,
    end: effectiveTo && effectiveTo < yearEnd ? effectiveTo : yearEnd,
  };
}

// T0 adalah hari pertama blok kerja. CP pertama dimulai setelah seluruh minggu
// kerja selesai. Tahun kepemilikan mengikuti awal siklus/proyeksi, sehingga CP
// terakhir boleh melintasi tahun. Bila itu terjadi, T0 tahun berikutnya dimulai
// sehari setelah proyeksi CP tersebut berakhir; realisasi tidak menggeser baseline.
function annualCycleProjections(policy, year) {
  const window = policyYearWindow(policy, year);
  if (!window) return [];
  const workDays = Number(policy.work_days);
  const leaveDays = Number(policy.leave_days);
  if (!Number.isInteger(workDays) || workDays <= 0
    || !Number.isInteger(leaveDays) || leaveDays <= 0) return [];
  const cycleDays = workDays + leaveDays;
  const effectiveYear = Number(asIsoDate(policy.effective_from).slice(0, 4));
  if (Number(year) < effectiveYear) return [];
  let anchor = asIsoDate(policy.effective_from);
  let projections = [];
  for (let ownerYear = effectiveYear; ownerYear <= Number(year); ownerYear += 1) {
    const yearStart = `${ownerYear}-01-01`;
    const yearEnd = `${ownerYear}-12-31`;
    if (ownerYear > effectiveYear) {
      const previousEnd = projections.length ? projections[projections.length - 1].projected_end : null;
      anchor = previousEnd && previousEnd > `${ownerYear - 1}-12-31`
        ? addDays(previousEnd, 1) : yearStart;
    }
    const cap = Math.floor(daysInYear(ownerYear) / cycleDays);
    const rows = [];
    let t0 = anchor;
    for (let cycleNo = 1; cycleNo <= cap; cycleNo += 1) {
      const projectedStart = addDays(t0, workDays);
      if (ownerYear === effectiveYear && projectedStart > yearEnd) break;
      const projectedEnd = addDays(projectedStart, leaveDays - 1);
      rows.push({ owning_year: ownerYear, cycle_no: cycleNo, t0_date: t0,
        projected_start: projectedStart, projected_end: projectedEnd,
        cp_days: leaveDays, work_days: workDays });
      t0 = addDays(projectedEnd, 1);
    }
    projections = rows;
  }
  return projections;
}

function periodicCycleStarts(policy, year) {
  return annualCycleProjections(policy, year).map(item => item.projected_start);
}

function policyPeriodEntitlement(policy, year) {
  return policy ? periodicCycleStarts(policy, year).length : 0;
}

function summarizeLeave(input = {}) {
  const hak = Math.max(Number(input.periodEntitlement || 0), 0);
  const aktual = Math.max(Number(input.realisedPeriods || 0), 0);
  const sisa = hak + Number(input.periodAdjustment || 0) - aktual;
  const sisaTahunan = Math.max(Number(input.annualEntitlement || 0), 0)
    + Number(input.carryForward || 0)
    + Number(input.annualAdjustment || 0)
    - Math.max(Number(input.ctDays || 0), 0);
  return { hak, aktual, sisa, sisaTahunan };
}

// Proyeksi = akhir realisasi terakhir + hari kerja kebijakan (kalender).
function projectNextLeave(lastEnd, workDays) {
  if (!lastEnd) return null;
  return addDays(lastEnd, Math.max(Number(workDays) || 0, 0) + 1);
}

function withinDays(dateText, referenceText, days) {
  if (!dateText) return false;
  const diff = Math.round((toUtc(dateText) - toUtc(referenceText)) / 86400000);
  return diff >= 0 && diff <= Number(days);
}

async function audit(q, scope, actorId, action, entity, entityId, before, after, reason) {
  await q(`INSERT INTO leave_audit_log
    (tenant_key, project_key, actor_id, action, entity, entity_id, before_value, after_value, reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
  [scope.tenantKey, scope.projectKey, actorId || null, action, entity, entityId || null,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after), reason || null]);
}

async function getEmployee(db, scope, userId) {
  const { rows } = await db.query(`SELECT u.id, u.employee_id, u.nama, u.jabatan, u.departemen,
      p.hire_date, p.employment_status
    FROM users u LEFT JOIN workforce_employee_profiles p
      ON p.user_id = u.id AND p.deleted_at IS NULL AND p.tenant_key = $2
    WHERE u.id = $1 AND ($2 = 'default' OR p.id IS NOT NULL)`, [userId, scope.tenantKey]);
  return rows[0] || null;
}

async function listPolicies(db, scope, activeOnly = false) {
  const { rows } = await db.query(`SELECT p.*, u.nama AS target_user_name,
      u.employee_id AS target_employee_id
    FROM leave_policy_versions p
    LEFT JOIN users u ON u.id = p.target_user_id
    WHERE (p.tenant_key = $1 OR p.tenant_key = 'default')
      AND (p.project_key = $2 OR p.project_key = 'default')
      ${activeOnly ? ' AND p.is_active = TRUE' : ''}
    ORDER BY p.leave_type, p.department, p.position, u.nama NULLS FIRST, p.version_no DESC`,
  [scope.tenantKey, scope.projectKey]);
  return rows;
}

async function listPolicyScopes(db, scope) {
  const { rows } = await db.query(`SELECT
      u.id, u.employee_id, u.nama,
      TRIM(COALESCE(u.departemen,'')) AS department,
      TRIM(COALESCE(u.jabatan,'')) AS position
    FROM users u
    LEFT JOIN workforce_employee_profiles p
      ON p.user_id = u.id AND p.deleted_at IS NULL AND p.tenant_key = $1
    WHERE u.role = 'karyawan' AND u.is_active = TRUE
      AND TRIM(COALESCE(u.departemen,'')) <> ''
      AND TRIM(COALESCE(u.jabatan,'')) <> ''
      AND ($1 = 'default' OR p.id IS NOT NULL OR u.role = 'karyawan')
    ORDER BY department, position, u.nama`, [scope.tenantKey]);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.department)) grouped.set(row.department, new Map());
    const positions = grouped.get(row.department);
    if (!positions.has(row.position)) positions.set(row.position, []);
    positions.get(row.position).push({ id: row.id, employee_id: row.employee_id, nama: row.nama });
  }
  return [...grouped.entries()].map(([department, positions]) => ({
    department,
    positions: [...positions.entries()].map(([position, employees]) => ({ position, employees })),
  }));
}

// Resolusi: karyawan spesifik → dept+jabatan → departemen → global.
async function resolvePolicy(db, scope, { userId, department, position, leaveType, date }) {
  if (!LEAVE_TYPES.has(leaveType)) throw err('Jenis cuti harus CP, CK, atau CT.', 422);
  const refDate = date ? parseDate(date, 'Tanggal acuan') : toIso(new Date());
  if (userId) {
    const targeted = await db.query(`SELECT * FROM leave_policy_versions
      WHERE tenant_key = $1 AND project_key = $2 AND leave_type = $3
        AND target_user_id = $4 AND is_active = TRUE
        AND effective_from <= $5::date AND (effective_to IS NULL OR effective_to >= $5::date)
      ORDER BY version_no DESC LIMIT 1`,
    [scope.tenantKey, scope.projectKey, leaveType, userId, refDate]);
    if (targeted.rows[0]) return targeted.rows[0];
  }
  const keys = [
    [department || '', position || ''],
    [department || '', ''],
    ['', ''],
  ];
  for (const [dept, pos] of keys) {
    const { rows } = await db.query(`SELECT * FROM leave_policy_versions
      WHERE tenant_key = $1 AND project_key = $2 AND leave_type = $3
        AND target_user_id IS NULL AND department = $4 AND position = $5 AND is_active = TRUE
        AND effective_from <= $6::date AND (effective_to IS NULL OR effective_to >= $6::date)
      ORDER BY version_no DESC LIMIT 1`,
    [scope.tenantKey, scope.projectKey, leaveType, dept, pos, refDate]);
    if (rows[0]) return rows[0];
  }
  return null;
}

async function createPolicyVersion(db, scope, user, input = {}) {
  assertHrAuthority(user);
  const leaveType = 'CP';
  const department = String(input.department || '').trim();
  const position = String(input.position || '').trim();
  const targetUserId = input.target_user_id ? String(input.target_user_id).trim() : null;
  if (!department || !position) throw err('Departemen dan jabatan wajib dipilih.', 422);
  const workWeeks = Number(input.work_weeks);
  const leaveWeeks = Number(input.leave_weeks);
  if (!Number.isInteger(workWeeks) || workWeeks < 1) throw err('Minggu kerja wajib berupa bilangan bulat minimal 1.', 422);
  if (!Number.isInteger(leaveWeeks) || leaveWeeks < 1) throw err('Minggu cuti wajib berupa bilangan bulat minimal 1.', 422);
  const workDays = workWeeks * 7;
  const leaveDays = leaveWeeks * 7;
  const effectiveFrom = parseDate(input.effective_from, 'Berlaku mulai');
  const effectiveTo = null;
  const basis = 'policy_effective';
  const annualDays = Number(input.annual_days);
  if (!Number.isInteger(annualDays) || annualDays < 0) throw err('Cuti tahunan wajib berupa jumlah hari bulat minimal 0.', 422);
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    const validScope = await q(`SELECT u.id, u.nama FROM users u
        LEFT JOIN workforce_employee_profiles p
          ON p.user_id = u.id AND p.deleted_at IS NULL AND p.tenant_key = $1
        WHERE u.role = 'karyawan' AND u.is_active = TRUE
          AND TRIM(COALESCE(u.departemen,'')) = $2
          AND TRIM(COALESCE(u.jabatan,'')) = $3
          AND ($4::uuid IS NULL OR u.id = $4::uuid)
          AND ($1 = 'default' OR p.id IS NOT NULL OR u.role = 'karyawan')
        ORDER BY u.nama`, [scope.tenantKey, department, position, targetUserId]);
    if (!validScope.rows.length) {
      throw err(targetUserId
        ? 'Karyawan tidak tersedia pada departemen dan jabatan terpilih.'
        : 'Kombinasi departemen dan jabatan tidak memiliki karyawan aktif.', 422);
    }
    const current = await q(`SELECT COALESCE(MAX(version_no),0)::int AS max_no FROM leave_policy_versions
      WHERE tenant_key = $1 AND project_key = $2 AND leave_type = $3
        AND target_user_id IS NOT DISTINCT FROM $4::uuid
        AND ($4::uuid IS NOT NULL OR (department = $5 AND position = $6))`,
    [scope.tenantKey, scope.projectKey, leaveType, targetUserId, department, position]);
    const versionNo = Number(current.rows[0].max_no) + 1;
    const { rows } = await q(`INSERT INTO leave_policy_versions
      (tenant_key, project_key, department, position, target_user_id, leave_type, work_days, leave_days,
       annual_days, basis, prorata, carry_forward, carry_max_days,
       effective_from, effective_to, version_no, note, created_by)
      VALUES ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10,FALSE,FALSE,0,$11::date,$12::date,$13,$14,$15) RETURNING *`,
    [scope.tenantKey, scope.projectKey, department, position, targetUserId,
      leaveType, workDays, leaveDays, annualDays, basis,
      effectiveFrom, effectiveTo, versionNo, input.note || null, user.id]);
    // Tutup versi aktif sebelumnya yang masih terbuka pada kunci yang sama.
    await q(`UPDATE leave_policy_versions
      SET effective_to = CASE WHEN effective_from < $3::date
            THEN ($3::date - INTERVAL '1 day')::date ELSE effective_to END,
          is_active = CASE WHEN effective_from >= $3::date THEN FALSE ELSE is_active END
      WHERE tenant_key = $1 AND project_key = $2
        AND leave_type = $6
        AND (($7::uuid IS NOT NULL AND target_user_id = $7::uuid)
          OR ($7::uuid IS NULL AND target_user_id IS NULL AND department = $4 AND position = $5))
        AND id <> $8 AND effective_to IS NULL AND is_active = TRUE`,
    [scope.tenantKey, scope.projectKey, effectiveFrom, department, position,
      leaveType, targetUserId, rows[0].id]);
    await q(`DELETE FROM employee_leave_projections
      WHERE tenant_key=$1 AND project_key=$2 AND year >= $3`,
    [scope.tenantKey, scope.projectKey, Number(effectiveFrom.slice(0, 4))]);
    await audit(q, scope, user.id, 'CREATE', 'leave_policy_versions', rows[0].id, null, rows[0], input.note);
    if (client) await q('COMMIT');
    return rows[0];
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function deletePolicyVersion(db, scope, user, id, reason) {
  assertHrAuthority(user);
  const deleteReason = String(reason || '').trim();
  if (!deleteReason) throw err('Alasan penghapusan kebijakan wajib diisi.', 422);
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    const selected = await q(`SELECT * FROM leave_policy_versions
      WHERE id = $1 AND tenant_key = $2 AND project_key = $3
      FOR UPDATE`, [id, scope.tenantKey, scope.projectKey]);
    const policy = selected.rows[0];
    if (!policy) throw err('Versi kebijakan tidak ditemukan.', 404);

    const references = await q(`SELECT
        (SELECT COUNT(*)::int FROM employee_leave_entitlements
          WHERE tenant_key = $2 AND project_key = $3 AND policy_version_id = $1) AS entitlements,
        (SELECT COUNT(*)::int FROM employee_leave_realisations
          WHERE tenant_key = $2 AND project_key = $3 AND policy_version_id = $1) AS realisations`,
    [id, scope.tenantKey, scope.projectKey]);
    const referenceCount = Number(references.rows[0]?.entitlements || 0)
      + Number(references.rows[0]?.realisations || 0);
    let result;
    if (referenceCount > 0) {
      const archived = await q(`UPDATE leave_policy_versions SET is_active = FALSE
        WHERE id = $1 AND tenant_key = $2 AND project_key = $3 RETURNING *`,
      [id, scope.tenantKey, scope.projectKey]);
      result = { policy: archived.rows[0], deleted: false, archived: true, references: referenceCount };
      await audit(q, scope, user.id, 'ARCHIVE_DELETE', 'leave_policy_versions', id,
        policy, archived.rows[0], deleteReason);
    } else {
      await audit(q, scope, user.id, 'DELETE', 'leave_policy_versions', id,
        policy, null, deleteReason);
      await q(`DELETE FROM leave_policy_versions
        WHERE id = $1 AND tenant_key = $2 AND project_key = $3`,
      [id, scope.tenantKey, scope.projectKey]);
      result = { policy, deleted: true, archived: false, references: 0 };
    }
    await q(`DELETE FROM employee_leave_projections
      WHERE tenant_key = $1 AND project_key = $2 AND year >= $3`,
    [scope.tenantKey, scope.projectKey, Number(asIsoDate(policy.effective_from).slice(0, 4))]);
    if (client) await q('COMMIT');
    return result;
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function setPolicyActive(db, scope, user, id, isActive) {
  assertHrAuthority(user);
  const { rows } = await db.query(`UPDATE leave_policy_versions SET is_active = $4
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 RETURNING *`,
  [id, scope.tenantKey, scope.projectKey, Boolean(isActive)]);
  if (!rows[0]) throw err('Versi kebijakan tidak ditemukan.', 404);
  await audit(db.query.bind(db), scope, user.id, isActive ? 'ACTIVATE' : 'DEACTIVATE',
    'leave_policy_versions', id, null, { is_active: rows[0].is_active }, null);
  return rows[0];
}

async function ensureEntitlement(q, scope, userId, year, actorId) {
  const employee = await getEmployee({ query: q }, scope, userId);
  if (!employee) throw err('Karyawan tidak ditemukan.', 404);
  const policy = await resolvePolicy({ query: q }, scope, {
    userId: employee.id, department: employee.departemen, position: employee.jabatan, leaveType: 'CP',
    date: policyReferenceDate(year),
  });
  const periodEnt = policyPeriodEntitlement(policy, year);
  // CT adalah saldo hari independen yang disimpan pada kontrak CP; CT tidak
  // pernah membentuk atau mengurangi hitungan siklus periodik.
  const annualEnt = policy ? Number(policy.annual_days) : ANNUAL_DEFAULT_DAYS;
  const { rows } = await q(`INSERT INTO employee_leave_entitlements
    (tenant_key, project_key, user_id, year, policy_version_id, period_entitlement,
     annual_entitlement_days, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (tenant_key, project_key, user_id, year) DO UPDATE SET
      policy_version_id = COALESCE(EXCLUDED.policy_version_id, employee_leave_entitlements.policy_version_id),
      period_entitlement = EXCLUDED.period_entitlement,
      annual_entitlement_days = EXCLUDED.annual_entitlement_days,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
  [scope.tenantKey, scope.projectKey, userId, year,
    policy ? policy.id : null, periodEnt, annualEnt, actorId || null]);
  return { entitlement: rows[0], policy, ctPolicy: null };
}

async function createRequest(db, scope, user, input = {}) {
  const targetUser = input.user_id || user.id;
  const leaveType = String(input.leave_type || 'CP').trim().toUpperCase();
  if (!LEAVE_TYPES.has(leaveType)) throw err('Jenis cuti harus CP, CK, atau CT.', 422);
  const plannedStart = parseDate(input.planned_start, 'Rencana mulai');
  const plannedEnd = parseDate(input.planned_end, 'Rencana selesai');
  if (plannedEnd < plannedStart) throw err('Rencana selesai tidak boleh sebelum rencana mulai.', 422);
  let cycleNo = input.cycle_no == null || input.cycle_no === '' ? null : Number(input.cycle_no);
  if (cycleNo != null && (!Number.isInteger(cycleNo) || cycleNo < 1)) throw err('Nomor siklus cuti tidak valid.', 422);
  if (leaveType !== 'CP' && cycleNo == null) {
    throw err('Nomor siklus wajib dipilih untuk melekatkan CK/CT ke jadwal cuti yang benar.', 422);
  }
  const key = input.idempotency_key ? String(input.idempotency_key).trim() || null : null;
  const employee = await getEmployee(db, scope, targetUser);
  if (!employee) throw err('Karyawan tidak ditemukan.', 404);
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    if (key) {
      const replay = await q(`SELECT * FROM employee_leave_requests
        WHERE tenant_key = $1 AND project_key = $2 AND idempotency_key = $3 LIMIT 1`,
      [scope.tenantKey, scope.projectKey, key]);
      if (replay.rows[0]) {
        if (client) await q('COMMIT');
        return { request: replay.rows[0], deduped: true };
      }
    }
    const overlap = await q(`SELECT id FROM employee_leave_requests
      WHERE tenant_key = $1 AND project_key = $2 AND user_id = $3
        AND status NOT IN ('REJECTED','CANCELLED')
        AND planned_start <= $5::date AND planned_end >= $4::date
      LIMIT 1 FOR UPDATE`,
    [scope.tenantKey, scope.projectKey, targetUser, plannedStart, plannedEnd]);
    if (overlap.rows[0]) throw err('Rentang cuti bertumpang tindih dengan pengajuan aktif lain.', 409);
    if (cycleNo == null && leaveType === 'CP') {
      const sequence = await q(`SELECT COALESCE(MAX(cycle_no),0)::int + 1 AS next_cycle
        FROM employee_leave_requests WHERE tenant_key=$1 AND project_key=$2 AND user_id=$3
          AND leave_type='CP' AND EXTRACT(YEAR FROM planned_start)=$4`,
      [scope.tenantKey, scope.projectKey, targetUser, Number(plannedStart.slice(0, 4))]);
      cycleNo = Number(sequence.rows[0].next_cycle || 1);
    }
    const { rows } = await q(`INSERT INTO employee_leave_requests
      (tenant_key, project_key, user_id, leave_type, planned_start, planned_end,
       cycle_no, reason, idempotency_key, created_by)
      VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10) RETURNING *`,
    [scope.tenantKey, scope.projectKey, targetUser, leaveType, plannedStart, plannedEnd,
      cycleNo, input.reason || null, key, user.id]);
    await audit(q, scope, user.id, 'CREATE', 'employee_leave_requests', rows[0].id, null, rows[0], input.reason);
    if (client) await q('COMMIT');
    return { request: rows[0], deduped: false };
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function getCycleOptions(db, scope, userId, year) {
  const ownerYear = Number(year);
  daysInYear(ownerYear);
  const employee = await getEmployee(db, scope, userId);
  if (!employee) throw err('Karyawan tidak ditemukan.', 404);
  const policy = await resolvePolicy(db, scope, { userId, department: employee.departemen,
    position: employee.jabatan, leaveType: 'CP', date: policyReferenceDate(ownerYear) });
  if (!policy) return { employee, policy: null, cycles: [] };
  const existing = await db.query(`SELECT cycle_no,status,planned_start,planned_end,application_group_id
    FROM employee_leave_requests WHERE tenant_key=$1 AND project_key=$2 AND user_id=$3
      AND owning_year=$4 AND leave_type='CP' AND status NOT IN ('REJECTED','CANCELLED')`,
  [scope.tenantKey, scope.projectKey, userId, ownerYear]);
  const byCycle = new Map(existing.rows.map(row => [Number(row.cycle_no), row]));
  const cycles = annualCycleProjections(policy, ownerYear).map(item => ({
    ...item, policy_version_id: policy.id, policy_version: policy.version_no,
    occupied: byCycle.has(item.cycle_no), request: byCycle.get(item.cycle_no) || null,
  }));
  return { employee, policy, cycles };
}

async function createCycleApplication(db, scope, user, input = {}) {
  const targetUser = String(input.user_id || user.id);
  if (targetUser !== String(user.id)) assertHrAuthority(user);
  const ownerYear = Number(input.owning_year);
  const cycleNo = Number(input.cycle_no);
  daysInYear(ownerYear);
  if (!Number.isInteger(cycleNo) || cycleNo < 1) throw err('Periode cuti wajib dipilih.', 422);
  const options = await getCycleOptions(db, scope, targetUser, ownerYear);
  const cycle = options.cycles.find(item => item.cycle_no === cycleNo);
  if (!cycle) throw err('Siklus cuti tidak tersedia pada tahun terpilih.', 422);
  if (cycle.occupied) throw err(`Cuti ${cycleNo} sudah memiliki pengajuan aktif.`, 409);
  const start = parseDate(input.planned_start || cycle.projected_start, 'Tanggal mulai cuti periodik');
  const ckDays = Number(input.ck_days || 0);
  const ctDays = Number(input.ct_days || 0);
  if (!Number.isInteger(ckDays) || ckDays < 0) throw err('Jumlah hari cuti khusus tidak valid.', 422);
  if (!Number.isInteger(ctDays) || ctDays < 0) throw err('Jumlah hari cuti tahunan tidak valid.', 422);
  const ckReason = String(input.ck_reason || '').trim();
  if (ckDays > 0 && !ckReason) throw err('Keterangan cuti khusus wajib diisi.', 422);
  const cpEnd = addDays(start, Number(cycle.cp_days) - 1);
  const ckStart = ckDays ? addDays(cpEnd, 1) : null;
  const ckEnd = ckDays ? addDays(ckStart, ckDays - 1) : null;
  const ctStart = ctDays ? addDays(ckEnd || cpEnd, 1) : null;
  const ctEnd = ctDays ? addDays(ctStart, ctDays - 1) : null;
  const totalEnd = ctEnd || ckEnd || cpEnd;
  const key = String(input.idempotency_key || '').trim();
  if (!key) throw err('Idempotency key pengajuan wajib tersedia.', 422);
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    const replay = await q(`SELECT * FROM employee_leave_requests
      WHERE tenant_key=$1 AND project_key=$2 AND idempotency_key = ANY($3::text[])
      ORDER BY leave_type`, [scope.tenantKey, scope.projectKey, [`${key}:CP`, `${key}:CK`, `${key}:CT`]]);
    if (replay.rows.length) {
      if (client) await q('COMMIT');
      return { requests: replay.rows, deduped: true };
    }
    const locked = await q(`SELECT id FROM employee_leave_requests
      WHERE tenant_key=$1 AND project_key=$2 AND user_id=$3
        AND status NOT IN ('REJECTED','CANCELLED')
        AND ((leave_type='CP' AND owning_year=$4 AND cycle_no=$5)
          OR (planned_start <= $7::date AND planned_end >= $6::date))
      LIMIT 1 FOR UPDATE`, [scope.tenantKey, scope.projectKey, targetUser, ownerYear, cycleNo, start, totalEnd]);
    if (locked.rows[0]) throw err('Siklus atau rentang cuti sudah memiliki pengajuan aktif.', 409);
    const groupId = crypto.randomUUID();
    const specs = [
      { type: 'CP', from: start, to: cpEnd, reason: `Cuti periodik ${cycleNo}` },
      ...(ckDays ? [{ type: 'CK', from: ckStart, to: ckEnd, reason: ckReason }] : []),
      ...(ctDays ? [{ type: 'CT', from: ctStart, to: ctEnd, reason: 'Cuti tahunan' }] : []),
    ];
    const requests = [];
    for (const spec of specs) {
      const inserted = await q(`INSERT INTO employee_leave_requests
        (tenant_key,project_key,user_id,leave_type,planned_start,planned_end,cycle_no,reason,
         idempotency_key,created_by,application_group_id,projection_start,projection_end,owning_year)
        VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12::date,$13::date,$14)
        RETURNING *`, [scope.tenantKey, scope.projectKey, targetUser, spec.type, spec.from, spec.to,
        cycleNo, spec.reason, `${key}:${spec.type}`, user.id, groupId,
        cycle.projected_start, cycle.projected_end, ownerYear]);
      requests.push(inserted.rows[0]);
      await audit(q, scope, user.id, 'CREATE', 'employee_leave_requests', inserted.rows[0].id,
        null, inserted.rows[0], `Pengajuan gabungan ${groupId}`);
    }
    if (client) await q('COMMIT');
    return { requests, deduped: false, application_group_id: groupId,
      projected_start: cycle.projected_start, projected_end: cycle.projected_end,
      total_start: start, total_end: totalEnd, total_days: inclusiveDays(start, totalEnd) };
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function updateCycleApplication(db, scope, user, targetIdentifier, input = {}) {
  // targetIdentifier can be an application_group_id or a request_id
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    const lookup = await q(`SELECT * FROM employee_leave_requests
      WHERE tenant_key = $1 AND project_key = $2
        AND (application_group_id = $3::uuid OR id = $3::uuid)
      ORDER BY leave_type FOR UPDATE`,
    [scope.tenantKey, scope.projectKey, targetIdentifier]);
    if (!lookup.rows.length) throw err('Pengajuan cuti tidak ditemukan.', 404);

    const existingRows = lookup.rows;
    const firstRow = existingRows[0];
    const targetUser = firstRow.user_id;
    if (String(targetUser) !== String(user.id)) assertHrAuthority(user);

    // Cek apakah ada pengajuan yang sudah di status akhir atau sudah disetujui
    const nonDraft = existingRows.find(item => item.status !== 'DRAFT');
    if (nonDraft) {
      throw err(`Pengajuan pada status ${nonDraft.status} tidak dapat diedit langsung. Gunakan transisi status atau pembatalan.`, 422);
    }

    const ownerYear = Number(input.owning_year || firstRow.owning_year || new Date(firstRow.planned_start).getUTCFullYear());
    const cycleNo = Number(input.cycle_no || firstRow.cycle_no);
    daysInYear(ownerYear);
    if (!Number.isInteger(cycleNo) || cycleNo < 1) throw err('Periode cuti wajib dipilih.', 422);

    const options = await getCycleOptions(db, scope, targetUser, ownerYear);
    const cycle = options.cycles.find(item => item.cycle_no === cycleNo);
    if (!cycle) throw err('Siklus cuti tidak tersedia pada tahun terpilih.', 422);

    // Cek occupied oleh group lain
    const currentGroupId = firstRow.application_group_id;
    const otherOccupied = await q(`SELECT id FROM employee_leave_requests
      WHERE tenant_key = $1 AND project_key = $2 AND user_id = $3
        AND status NOT IN ('REJECTED','CANCELLED')
        AND leave_type = 'CP' AND owning_year = $4 AND cycle_no = $5
        AND (application_group_id IS NULL OR application_group_id <> $6::uuid)
      LIMIT 1`, [scope.tenantKey, scope.projectKey, targetUser, ownerYear, cycleNo, currentGroupId || crypto.randomUUID()]);
    if (otherOccupied.rows[0]) throw err(`Cuti ${cycleNo} sudah memiliki pengajuan aktif lain.`, 409);

    const start = parseDate(input.planned_start || firstRow.planned_start, 'Tanggal mulai cuti periodik');
    const ckDays = input.ck_days !== undefined ? Number(input.ck_days) : (existingRows.find(item => item.leave_type === 'CK') ? inclusiveDays(existingRows.find(item => item.leave_type === 'CK').planned_start, existingRows.find(item => item.leave_type === 'CK').planned_end) : 0);
    const ctDays = input.ct_days !== undefined ? Number(input.ct_days) : (existingRows.find(item => item.leave_type === 'CT') ? inclusiveDays(existingRows.find(item => item.leave_type === 'CT').planned_start, existingRows.find(item => item.leave_type === 'CT').planned_end) : 0);
    if (!Number.isInteger(ckDays) || ckDays < 0) throw err('Jumlah hari cuti khusus tidak valid.', 422);
    if (!Number.isInteger(ctDays) || ctDays < 0) throw err('Jumlah hari cuti tahunan tidak valid.', 422);
    const ckReason = String(input.ck_reason !== undefined ? input.ck_reason : (existingRows.find(item => item.leave_type === 'CK')?.reason || '')).trim();
    if (ckDays > 0 && !ckReason) throw err('Keterangan cuti khusus wajib diisi.', 422);

    const cpEnd = addDays(start, Number(cycle.cp_days) - 1);
    const ckStart = ckDays ? addDays(cpEnd, 1) : null;
    const ckEnd = ckDays ? addDays(ckStart, ckDays - 1) : null;
    const ctStart = ctDays ? addDays(ckEnd || cpEnd, 1) : null;
    const ctEnd = ctDays ? addDays(ctStart, ctDays - 1) : null;
    const totalEnd = ctEnd || ckEnd || cpEnd;

    // Hapus baris lama dalam grup / pengajuan ini
    const idsToDelete = existingRows.map(r => r.id);
    for (const oldRow of existingRows) {
      await audit(q, scope, user.id, 'DELETE', 'employee_leave_requests', oldRow.id,
        oldRow, null, `Dihapus sebelum update pengajuan siklus ${cycleNo}`);
    }
    await q(`DELETE FROM employee_leave_requests WHERE id = ANY($1::uuid[])`, [idsToDelete]);

    const groupId = currentGroupId || crypto.randomUUID();
    const key = `update-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const specs = [
      { type: 'CP', from: start, to: cpEnd, reason: `Cuti periodik ${cycleNo}` },
      ...(ckDays ? [{ type: 'CK', from: ckStart, to: ckEnd, reason: ckReason }] : []),
      ...(ctDays ? [{ type: 'CT', from: ctStart, to: ctEnd, reason: 'Cuti tahunan' }] : []),
    ];
    const newRequests = [];
    for (const spec of specs) {
      const inserted = await q(`INSERT INTO employee_leave_requests
        (tenant_key,project_key,user_id,leave_type,planned_start,planned_end,cycle_no,reason,
         idempotency_key,created_by,application_group_id,projection_start,projection_end,owning_year)
        VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12::date,$13::date,$14)
        RETURNING *`, [scope.tenantKey, scope.projectKey, targetUser, spec.type, spec.from, spec.to,
        cycleNo, spec.reason, `${key}:${spec.type}`, user.id, groupId,
        cycle.projected_start, cycle.projected_end, ownerYear]);
      newRequests.push(inserted.rows[0]);
      await audit(q, scope, user.id, 'CREATE', 'employee_leave_requests', inserted.rows[0].id,
        null, inserted.rows[0], `Pembaruan pengajuan siklus ${groupId}`);
    }
    if (client) await q('COMMIT');
    return { requests: newRequests, application_group_id: groupId,
      total_start: start, total_end: totalEnd, total_days: inclusiveDays(start, totalEnd) };
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function deleteCycleApplication(db, scope, user, targetIdentifier, reason = 'Dihapus oleh user') {
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    const lookup = await q(`SELECT * FROM employee_leave_requests
      WHERE tenant_key = $1 AND project_key = $2
        AND (application_group_id = $3::uuid OR id = $3::uuid)
      ORDER BY leave_type FOR UPDATE`,
    [scope.tenantKey, scope.projectKey, targetIdentifier]);
    if (!lookup.rows.length) throw err('Pengajuan cuti tidak ditemukan.', 404);

    const existingRows = lookup.rows;
    const targetUser = existingRows[0].user_id;
    if (String(targetUser) !== String(user.id)) assertHrAuthority(user);

    // Cek apakah ada pengajuan yang sudah terealisasi
    const hasRealized = existingRows.find(item => item.status === 'REALIZED');
    if (hasRealized) {
      throw err('Pengajuan yang sudah terealisasi tidak dapat dihapus. Batalkan realisasi terlebih dahulu.', 422);
    }

    // Jika ada yang APPROVED, bersihkan jadwal dari roster
    for (const row of existingRows) {
      if (row.status === 'APPROVED') {
        await restoreRosterForRequest(q, scope, row.id, row.user_id);
      }
      await audit(q, scope, user.id, 'DELETE', 'employee_leave_requests', row.id,
        row, null, reason || 'Penghapusan pengajuan cuti');
    }

    const idsToDelete = existingRows.map(r => r.id);
    await q(`DELETE FROM leave_roster_reconciliation WHERE request_id = ANY($1::uuid[])`, [idsToDelete]);
    await q(`DELETE FROM leave_roster_snapshots WHERE request_id = ANY($1::uuid[])`, [idsToDelete]);
    await q(`DELETE FROM employee_leave_requests WHERE id = ANY($1::uuid[])`, [idsToDelete]);

    const ownerYear = Number(existingRows[0].owning_year || new Date(existingRows[0].planned_start).getUTCFullYear());
    await refreshProjection(q, scope, targetUser, ownerYear);

    if (client) await q('COMMIT');
    return { success: true, deleted_count: idsToDelete.length, ids: idsToDelete };
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}


function enumerateDates(startText, endText) {
  const days = inclusiveDays(startText, endText);
  const out = [];
  for (let i = 0; i < days; i += 1) out.push(addDays(startText, i));
  return out;
}

// Database Cuti mengambil alih roster generated, tetapi tidak pernah menimpa
// manual_override. Snapshot membuat pembatalan/koreksi dapat memulihkan jadwal.
async function syncRosterForLeave(q, scope, leave) {
  if (leave.leave_type !== 'CP') return { written: 0, skipped: 0 };
  const dates = enumerateDates(leave.start, leave.end);
  let written = 0;
  let skipped = 0;
  for (const tanggal of dates) {
    const existing = await q(`SELECT id, status, shift_id, assignment_id, source, catatan,
        leave_request_id, leave_realisation_id
      FROM employee_roster_daily
      WHERE user_id = $1 AND tanggal = $2::date LIMIT 1 FOR UPDATE`, [leave.user_id, tanggal]);
    const row = existing.rows[0];
    let actual = row ? row.status : null;
    let state = 'MISMATCH';
    if (row && row.source === 'manual_override') {
      skipped += 1;
      state = 'OVERRIDDEN';
    } else if (row && row.source === 'leave_sync' && row.leave_request_id !== leave.request_id) {
      skipped += 1;
    } else {
      await q(`INSERT INTO leave_roster_snapshots
        (tenant_key, project_key, request_id, realisation_id, user_id, tanggal,
         previous_exists, previous_status, previous_shift_id, previous_assignment_id,
         previous_source, previous_catatan)
        VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (request_id, tanggal) DO UPDATE SET
          realisation_id=EXCLUDED.realisation_id, restored_at=NULL`,
      [scope.tenantKey, scope.projectKey, leave.request_id, leave.realisation_id || null,
        leave.user_id, tanggal, Boolean(row), row ? row.status : null, row ? row.shift_id : null,
        row ? row.assignment_id : null, row ? row.source : null, row ? row.catatan : null]);
      const note = `cuti-request:${leave.request_id}`;
      if (!row) {
        await q(`INSERT INTO employee_roster_daily
          (user_id,tanggal,status,source,catatan,updated_by,leave_request_id,leave_realisation_id)
          VALUES ($1,$2::date,'CP','leave_sync',$3,$4,$5,$6)`,
        [leave.user_id, tanggal, note, leave.created_by || null, leave.request_id, leave.realisation_id || null]);
      } else {
        await q(`UPDATE employee_roster_daily SET status='CP', source='leave_sync', catatan=$2,
          updated_by=$3, leave_request_id=$4, leave_realisation_id=$5,
          updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [row.id, note, leave.created_by || null, leave.request_id, leave.realisation_id || null]);
      }
      written += 1;
      actual = 'CP';
      state = 'MATCHED';
    }
    await q(`INSERT INTO leave_roster_reconciliation
      (tenant_key,project_key,request_id,realisation_id,user_id,tanggal,expected_status,actual_status,state)
      VALUES ($1,$2,$3,$4,$5,$6::date,'CP',$7,$8)
      ON CONFLICT (request_id,tanggal) DO UPDATE SET realisation_id=EXCLUDED.realisation_id,
        actual_status=EXCLUDED.actual_status,state=EXCLUDED.state,checked_at=CURRENT_TIMESTAMP`,
    [scope.tenantKey, scope.projectKey, leave.request_id, leave.realisation_id || null,
      leave.user_id, tanggal, actual, state]);
  }
  return { written, skipped };
}

async function syncRosterForRequest(q, scope, request, actorId) {
  return syncRosterForLeave(q, scope, {
    request_id: request.id, user_id: request.user_id, leave_type: request.leave_type,
    start: request.planned_start, end: request.planned_end, created_by: actorId,
  });
}

async function syncRosterForRealisation(q, scope, real) {
  return syncRosterForLeave(q, scope, {
    request_id: real.request_id, realisation_id: real.id, user_id: real.user_id,
    leave_type: real.leave_type, start: real.actual_start, end: real.actual_end,
    created_by: real.created_by,
  });
}

async function restoreRosterForRequest(q, scope, requestId, userId) {
  const snapshots = await q(`SELECT * FROM leave_roster_snapshots
    WHERE tenant_key=$1 AND project_key=$2 AND request_id=$3 AND restored_at IS NULL
    ORDER BY tanggal FOR UPDATE`, [scope.tenantKey, scope.projectKey, requestId]);
  let restored = 0;
  for (const snapshot of snapshots.rows) {
    const current = await q(`SELECT id,source,leave_request_id FROM employee_roster_daily
      WHERE user_id=$1 AND tanggal=$2::date LIMIT 1 FOR UPDATE`, [userId, snapshot.tanggal]);
    const row = current.rows[0];
    if (row && row.source === 'leave_sync' && row.leave_request_id === requestId) {
      if (snapshot.previous_exists) {
        await q(`UPDATE employee_roster_daily SET status=$2,shift_id=$3,assignment_id=$4,
          source=$5,catatan=$6,leave_request_id=NULL,leave_realisation_id=NULL,
          updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [row.id, snapshot.previous_status, snapshot.previous_shift_id,
          snapshot.previous_assignment_id, snapshot.previous_source, snapshot.previous_catatan]);
      } else {
        await q('DELETE FROM employee_roster_daily WHERE id=$1', [row.id]);
      }
      restored += 1;
    }
    await q(`UPDATE leave_roster_snapshots SET restored_at=CURRENT_TIMESTAMP WHERE id=$1`, [snapshot.id]);
  }
  return restored;
}

async function removeRosterForRealisation(q, scope, real) {
  return restoreRosterForRequest(q, scope, real.request_id, real.user_id);
}

async function refreshProjection(q, scope, userId, year) {
  const employee = await getEmployee({ query: q }, scope, userId);
  const policy = await resolvePolicy({ query: q }, scope, {
    userId,
    department: employee ? employee.departemen : '', position: employee ? employee.jabatan : '',
    leaveType: 'CP', date: policyReferenceDate(year),
  });
  const occupied = await q(`SELECT cycle_no FROM employee_leave_requests
    WHERE tenant_key=$1 AND project_key=$2 AND user_id=$3 AND leave_type='CP'
      AND COALESCE(owning_year,EXTRACT(YEAR FROM planned_start)::int)=$4
      AND status NOT IN ('REJECTED','CANCELLED')`,
  [scope.tenantKey, scope.projectKey, userId, year]);
  const used = new Set(occupied.rows.map(row => Number(row.cycle_no)));
  const nextCycle = policy ? annualCycleProjections(policy, year).find(item => !used.has(item.cycle_no)) : null;
  const next = nextCycle ? nextCycle.projected_start : null;
  const basis = nextCycle
    ? `baseline tetap Cuti ${nextCycle.cycle_no}; T0 ${nextCycle.t0_date} (v${policy.version_no})`
    : '';
  await q(`INSERT INTO employee_leave_projections
    (tenant_key, project_key, user_id, year, next_leave_start, basis)
    VALUES ($1,$2,$3,$4,$5::date,$6)
    ON CONFLICT (tenant_key, project_key, user_id, year) DO UPDATE SET
      next_leave_start = EXCLUDED.next_leave_start, basis = EXCLUDED.basis,
      computed_at = CURRENT_TIMESTAMP`,
  [scope.tenantKey, scope.projectKey, userId, year, next, basis]);
  return { next_leave_start: next, basis };
}

async function buildRealisation(q, scope, actor, requestRow, actualStart, actualEnd, note, source) {
  const days = inclusiveDays(actualStart, actualEnd);
  const employee = await getEmployee({ query: q }, scope, requestRow.user_id);
  const isCp = requestRow.leave_type === 'CP';
  const activePolicy = isCp ? await resolvePolicy({ query: q }, scope, {
    userId: requestRow.user_id,
    department: employee ? employee.departemen : '',
    position: employee ? employee.jabatan : '',
    leaveType: 'CP', date: actualStart,
  }) : null;
  const variance = activePolicy ? days - Number(activePolicy.leave_days) : 0;
  const periodCount = isCp && activePolicy && variance === 0 ? 1 : 0;
  const countingStatus = !isCp ? 'EXCLUDED'
    : !activePolicy || variance > 0 ? 'VARIANCE'
      : variance < 0 ? 'PARTIAL' : 'COUNTED';
  const { rows } = await q(`INSERT INTO employee_leave_realisations
    (tenant_key, project_key, request_id, user_id, actual_start, actual_end,
     actual_days, period_count, variance_days, counting_status, policy_version_id, source, note, created_by)
    VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
  [scope.tenantKey, scope.projectKey, requestRow.id, requestRow.user_id,
    actualStart, actualEnd, days, periodCount, variance, countingStatus,
    activePolicy ? activePolicy.id : null, source, note || null, actor.id]);
  return rows[0];
}

async function assertSupervisorAuthority(q, scope, actor, requestRow) {
  if (actor.is_super_admin === true) return;
  const { rows } = await q(`SELECT a.supervisor_user_id
    FROM workforce_employee_profiles p
    LEFT JOIN workforce_employee_assignments a ON a.employee_profile_id=p.id
      AND a.tenant_key=$2 AND a.project_key=$3 AND a.status='ACTIVE' AND a.effective_to IS NULL
    WHERE p.user_id=$1 AND p.tenant_key=$2 AND p.deleted_at IS NULL LIMIT 1`,
  [requestRow.user_id, scope.tenantKey, scope.projectKey]);
  if (!rows[0] || rows[0].supervisor_user_id !== actor.id) {
    throw err('Hanya atasan aktif karyawan atau Super Admin yang dapat memberi approval Atasan.', 403);
  }
}

async function assertApprovalCapacity(q, scope, requestRow, actorId) {
  // CP, CK, dan CT pada satu pengajuan komposit memakai tahun pemilik siklus.
  // Ini menjaga saldo 2026 tetap menjadi pemilik ketika rangkaian cuti melewati
  // 31 Desember, serta mencegah realisasi menggeser saldo ke tahun berikutnya.
  const year = Number(requestRow.owning_year
    || String(requestRow.planned_start).slice(0, 4));
  const { entitlement } = await ensureEntitlement(q, scope, requestRow.user_id, year, actorId);
  if (requestRow.leave_type === 'CP') {
    const reserved = await q(`SELECT COALESCE(SUM(CASE WHEN req.status='APPROVED' THEN 1
        ELSE COALESCE(real.period_count,0) END),0)::int AS used
      FROM employee_leave_requests req
      LEFT JOIN employee_leave_realisations real
        ON real.request_id=req.id AND real.status IN ('REALIZED','CORRECTED')
      WHERE req.tenant_key=$1 AND req.project_key=$2 AND req.user_id=$3 AND req.leave_type='CP'
        AND req.status IN ('APPROVED','REALIZED') AND req.id<>$4
        AND COALESCE(req.owning_year,EXTRACT(YEAR FROM req.planned_start)::int)=$5`,
    [scope.tenantKey, scope.projectKey, requestRow.user_id, requestRow.id, year]);
    const available = Number(entitlement.period_entitlement) + Number(entitlement.period_adjustment || 0);
    if (Number(reserved.rows[0].used || 0) + 1 > available) {
      throw err(`Hak cuti periodik tidak cukup (${reserved.rows[0].used || 0}/${available} periode telah terpakai/terjadwal).`, 422);
    }
  }
  if (requestRow.leave_type === 'CT') {
    const reserved = await q(`SELECT COALESCE(SUM((planned_end-planned_start)+1),0)::int AS used
      FROM employee_leave_requests WHERE tenant_key=$1 AND project_key=$2 AND user_id=$3
        AND leave_type='CT' AND status IN ('APPROVED','REALIZED') AND id<>$4
        AND COALESCE(owning_year,EXTRACT(YEAR FROM planned_start)::int)=$5`,
    [scope.tenantKey, scope.projectKey, requestRow.user_id, requestRow.id, year]);
    const available = Number(entitlement.annual_entitlement_days)
      + Number(entitlement.carry_forward_days || 0) + Number(entitlement.annual_adjustment_days || 0);
    const requested = inclusiveDays(requestRow.planned_start, requestRow.planned_end);
    if (Number(reserved.rows[0].used || 0) + requested > available) {
      throw err(`Saldo cuti tahunan tidak cukup (${reserved.rows[0].used || 0}/${available} hari telah terpakai/terjadwal).`, 422);
    }
  }
}

async function transitionRequest(db, scope, user, id, target, reason, input = {}) {
  const next = String(target || '').trim().toUpperCase();
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    const current = await q(`SELECT * FROM employee_leave_requests
      WHERE id = $1 AND tenant_key = $2 AND project_key = $3 LIMIT 1 FOR UPDATE`,
    [id, scope.tenantKey, scope.projectKey]);
    const row = current.rows[0];
    if (!row) throw err('Pengajuan cuti tidak ditemukan.', 404);
    if (!(REQUEST_NEXT[row.status] || []).includes(next)) {
      throw err(`Transisi ${row.status} → ${next} tidak diizinkan.`, 422);
    }
    if ((next === 'REJECTED' || next === 'CANCELLED') && !reason) {
      throw err('Alasan penolakan/pembatalan wajib diisi.', 422);
    }
    if (next === 'SUPERVISOR_APPROVED') await assertSupervisorAuthority(q, scope, user, row);
    if (next === 'APPROVED') {
      assertHrAuthority(user);
      if (row.supervisor_by === user.id) throw err('Approval HR harus dilakukan oleh pengguna berbeda dari approver Atasan.', 403);
      await assertApprovalCapacity(q, scope, row, user.id);
    }
    if (next === 'REALIZED') {
      assertHrAuthority(user);
      const actualStart = parseDate(input.actual_start || row.planned_start, 'Realisasi mulai');
      const actualEnd = parseDate(input.actual_end || row.planned_end, 'Realisasi selesai');
      const overlap = await q(`SELECT r.id FROM employee_leave_realisations r
        JOIN employee_leave_requests req ON req.id=r.request_id
        WHERE r.tenant_key=$1 AND r.project_key=$2 AND r.user_id=$3
          AND r.status IN ('REALIZED','CORRECTED') AND req.id<>$4
          AND r.actual_start <= $6::date AND r.actual_end >= $5::date
        LIMIT 1 FOR UPDATE`,
      [scope.tenantKey, scope.projectKey, row.user_id, row.id, actualStart, actualEnd]);
      if (overlap.rows[0]) throw err('Tanggal realisasi bertumpang tindih dengan realisasi cuti lain.', 409);
    }
    const patch = { status: next };
    if (next === 'SUPERVISOR_APPROVED') { patch.supervisor_by = user.id; patch.supervisor_at = 'CURRENT_TIMESTAMP'; }
    if (next === 'APPROVED') { patch.hr_by = user.id; patch.hr_at = 'CURRENT_TIMESTAMP'; }
    if (next === 'REJECTED') patch.reject_reason = reason;
    if (next === 'CANCELLED') patch.reject_reason = reason;
    const sets = ['status = $4'];
    const params = [row.id, scope.tenantKey, scope.projectKey, next];
    let index = 5;
    if (patch.supervisor_by) { sets.push(`supervisor_by = $${index}, supervisor_at = CURRENT_TIMESTAMP`); params.push(user.id); index += 1; }
    if (patch.hr_by) { sets.push(`hr_by = $${index}, hr_at = CURRENT_TIMESTAMP`); params.push(user.id); index += 1; }
    if (patch.reject_reason != null) { sets.push(`reject_reason = $${index}`); params.push(reason || null); index += 1; }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    const { rows } = await q(`UPDATE employee_leave_requests SET ${sets.join(', ')}
      WHERE id = $1 AND tenant_key = $2 AND project_key = $3 RETURNING *`, params);
    await audit(q, scope, user.id, next, 'employee_leave_requests', id, { status: row.status }, { status: next }, reason);
    let realisation = null;
    let roster = null;
    if (next === 'APPROVED') {
      // Approval HR membentuk jadwal resmi, belum dihitung sebagai Aktual.
      roster = await syncRosterForRequest(q, scope, rows[0], user.id);
    }
    if (next === 'REALIZED') {
      const actualStart = parseDate(input.actual_start || row.planned_start, 'Realisasi mulai');
      const actualEnd = parseDate(input.actual_end || row.planned_end, 'Realisasi selesai');
      await restoreRosterForRequest(q, scope, row.id, row.user_id);
      realisation = await buildRealisation(q, scope, user, rows[0], actualStart, actualEnd,
        input.note || reason || null, 'approval');
      roster = await syncRosterForRealisation(q, scope, { ...realisation, leave_type: rows[0].leave_type });
      await refreshProjection(q, scope, rows[0].user_id, Number(actualStart.slice(0, 4)));
      await audit(q, scope, user.id, 'REALIZE', 'employee_leave_realisations',
        realisation.id, null, realisation, input.note || 'konfirmasi realisasi HR');
    }
    if (next === 'CANCELLED' && row.status === 'APPROVED') {
      roster = { restored: await restoreRosterForRequest(q, scope, row.id, row.user_id) };
    }
    if (client) await q('COMMIT');
    return { request: rows[0], realisation, roster };
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function correctRealisation(db, scope, user, id, input = {}) {
  assertHrAuthority(user);
  const actualStart = parseDate(input.actual_start, 'Realisasi mulai');
  const actualEnd = parseDate(input.actual_end, 'Realisasi selesai');
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    const current = await q(`SELECT r.*, q.leave_type FROM employee_leave_realisations r
      JOIN employee_leave_requests q ON q.id = r.request_id
      WHERE r.id = $1 AND r.tenant_key = $2 AND r.project_key = $3 LIMIT 1 FOR UPDATE`,
    [id, scope.tenantKey, scope.projectKey]);
    const row = current.rows[0];
    if (!row) throw err('Realisasi cuti tidak ditemukan.', 404);
    if (row.status === 'CANCELLED') throw err('Realisasi yang dibatalkan tidak dapat dikoreksi.', 422);
    const days = inclusiveDays(actualStart, actualEnd);
    const before = { ...row };
    // Hapus CP lama milik realisasi ini, tulis ulang pada rentang koreksi.
    await removeRosterForRealisation(q, scope, row);
    const policyDays = row.policy_version_id
      ? (((await q('SELECT leave_days FROM leave_policy_versions WHERE id = $1',
        [row.policy_version_id])).rows[0] || {}).leave_days)
      : null;
    const variance = policyDays == null ? row.variance_days : days - Number(policyDays);
    let periodCount = row.leave_type === 'CP' && policyDays != null && variance === 0 ? 1 : 0;
    let countingStatus = row.leave_type !== 'CP' ? 'EXCLUDED'
      : policyDays == null || variance > 0 ? 'VARIANCE' : variance < 0 ? 'PARTIAL' : 'COUNTED';
    if (input.period_count != null) {
      const resolved = Number(input.period_count);
      if (!Number.isInteger(resolved) || resolved < 0) throw err('Keputusan jumlah periode tidak valid.', 422);
      if (!input.note) throw err('Alasan keputusan HR wajib diisi saat menetapkan jumlah periode.', 422);
      periodCount = resolved;
      countingStatus = resolved > 0 ? 'COUNTED' : 'EXCLUDED';
    }
    const { rows } = await q(`UPDATE employee_leave_realisations
      SET actual_start = $4::date, actual_end = $5::date, actual_days = $6,
        variance_days = $7, period_count=$8, counting_status=$9,
        status = 'CORRECTED', note = COALESCE($10, note)
      WHERE id = $1 AND tenant_key = $2 AND project_key = $3 RETURNING *`,
    [id, scope.tenantKey, scope.projectKey, actualStart, actualEnd, days, variance,
      periodCount, countingStatus, input.note || null]);
    const fixed = rows[0];
    const roster = await syncRosterForRealisation(q, scope, { ...fixed, leave_type: row.leave_type });
    await refreshProjection(q, scope, row.user_id, Number(String(actualStart).slice(0, 4)));
    await audit(q, scope, user.id, 'CORRECT', 'employee_leave_realisations', id, before, fixed, input.note);
    if (client) await q('COMMIT');
    return { realisation: fixed, roster };
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function cancelRealisation(db, scope, user, id, reason) {
  assertHrAuthority(user);
  if (!reason) throw err('Alasan pembatalan realisasi wajib diisi.', 422);
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  try {
    if (client) await q('BEGIN');
    const current = await q(`SELECT * FROM employee_leave_realisations
      WHERE id = $1 AND tenant_key = $2 AND project_key = $3 LIMIT 1 FOR UPDATE`,
    [id, scope.tenantKey, scope.projectKey]);
    const row = current.rows[0];
    if (!row) throw err('Realisasi cuti tidak ditemukan.', 404);
    if (row.status === 'CANCELLED') throw err('Realisasi sudah dibatalkan.', 422);
    const removed = await removeRosterForRealisation(q, scope, row);
    const { rows } = await q(`UPDATE employee_leave_realisations SET status = 'CANCELLED'
      WHERE id = $1 RETURNING *`, [id]);
    await q(`UPDATE employee_leave_requests SET status='CANCELLED',reject_reason=$2,
      updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='REALIZED'`, [row.request_id, reason]);
    await refreshProjection(q, scope, row.user_id, Number(String(row.actual_start).slice(0, 4)));
    await audit(q, scope, user.id, 'CANCEL', 'employee_leave_realisations', id,
      { status: row.status }, { status: 'CANCELLED' }, reason);
    if (client) await q('COMMIT');
    return { realisation: rows[0], roster_removed: removed };
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

function policyAt(policies, employee, leaveType, date) {
  const iso = asIsoDate(date, 'Tanggal acuan kebijakan');
  return policies
    .filter(policy => policy.leave_type === leaveType && policy.is_active
      && (!policy.target_user_id || String(policy.target_user_id) === String(employee.id))
      && asIsoDate(policy.effective_from, 'Berlaku mulai kebijakan') <= iso
      && (!policy.effective_to || asIsoDate(policy.effective_to, 'Berlaku sampai kebijakan') >= iso))
    .map(policy => ({ policy, score: policy.target_user_id ? 100
      : (policy.department === employee.departemen ? 2 : policy.department === '' ? 0 : -100)
        + (policy.position === employee.jabatan ? 2 : policy.position === '' ? 0 : -100) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score || Number(b.policy.version_no) - Number(a.policy.version_no))[0]?.policy || null;
}

async function prepareDashboardYear(db, scope, year) {
  const employees = await db.query(`SELECT u.id,u.departemen,u.jabatan
    FROM users u LEFT JOIN workforce_employee_profiles p
      ON p.user_id=u.id AND p.deleted_at IS NULL AND p.tenant_key=$1
    WHERE u.role='karyawan' AND u.is_active=TRUE AND ($1='default' OR p.id IS NOT NULL)`,
  [scope.tenantKey]);
  const policies = await listPolicies(db, scope, true);
  const referenceDate = policyReferenceDate(year);
  const entitlementRows = await db.query(`SELECT user_id, policy_version_id
    FROM employee_leave_entitlements
    WHERE tenant_key=$1 AND project_key=$2 AND year=$3`,
  [scope.tenantKey, scope.projectKey, year]);
  const previousPolicy = new Map(entitlementRows.rows.map(row => [String(row.user_id), row.policy_version_id ? String(row.policy_version_id) : null]));
  const projectionRows = await db.query(`SELECT user_id FROM employee_leave_projections
    WHERE tenant_key=$1 AND project_key=$2 AND year=$3`, [scope.tenantKey, scope.projectKey, year]);
  const projected = new Set(projectionRows.rows.map(row => String(row.user_id)));
  for (const employee of employees.rows) {
    const cp = policyAt(policies, employee, 'CP', referenceDate);
    await db.query(`INSERT INTO employee_leave_entitlements
      (tenant_key,project_key,user_id,year,policy_version_id,period_entitlement,
       annual_entitlement_days)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (tenant_key,project_key,user_id,year) DO UPDATE SET
        policy_version_id=EXCLUDED.policy_version_id,
        period_entitlement=EXCLUDED.period_entitlement,
        annual_entitlement_days=EXCLUDED.annual_entitlement_days,
        updated_at=CURRENT_TIMESTAMP`,
    [scope.tenantKey, scope.projectKey, employee.id, year, cp ? cp.id : null,
      policyPeriodEntitlement(cp, year),
      cp ? Number(cp.annual_days) : ANNUAL_DEFAULT_DAYS]);
    const nextPolicyId = cp ? String(cp.id) : null;
    if (!projected.has(String(employee.id)) || previousPolicy.get(String(employee.id)) !== nextPolicyId) {
      await refreshProjection(db.query.bind(db), scope, employee.id, year);
    }
  }
}

async function getDashboard(db, scope, options = {}) {
  const year = Number(options.year) || new Date().getUTCFullYear();
  if (year < 2000 || year > 2200) throw err('Tahun cuti tidak valid.', 422);
  await prepareDashboardYear(db, scope, year);
  const filters = [scope.tenantKey, scope.projectKey];
  let where = 'u.role = \'karyawan\' AND u.is_active = TRUE';
  if (options.department) { filters.push(String(options.department)); where += ` AND COALESCE(u.departemen,'') = $${filters.length}`; }
  if (options.position) { filters.push(String(options.position)); where += ` AND COALESCE(u.jabatan,'') = $${filters.length}`; }
  if (options.search) {
    filters.push(`%${String(options.search).trim()}%`);
    where += ` AND (u.nama ILIKE $${filters.length} OR COALESCE(u.employee_id,'') ILIKE $${filters.length})`;
  }
  const { rows } = await db.query(`SELECT u.id, u.employee_id, u.nama, u.jabatan, u.departemen,
      e.policy_version_id, e.period_entitlement, e.period_adjustment, e.annual_entitlement_days,
      e.carry_forward_days, e.annual_adjustment_days,
      pr.next_leave_start, pr.basis AS projection_basis,
      lp.work_days AS policy_work_days, lp.leave_days AS policy_leave_days,
      lp.effective_from AS policy_effective_from, lp.effective_to AS policy_effective_to,
      lp.version_no AS policy_version_no, lp.annual_days AS policy_annual_days,
      COALESCE(cp.realisasi,0)::int AS aktual_periode,
      COALESCE(ct.hari,0)::int AS ct_hari,
      COALESCE(rc.belum,0)::int AS belum_rekonsiliasi,
      COALESCE(ev.events,'[]'::jsonb) AS leave_events
    FROM users u
    LEFT JOIN workforce_employee_profiles wp
      ON wp.user_id=u.id AND wp.deleted_at IS NULL AND wp.tenant_key=$1
    LEFT JOIN employee_leave_entitlements e
      ON e.user_id = u.id AND e.year = ${year} AND e.tenant_key = $1 AND e.project_key = $2
    LEFT JOIN leave_policy_versions lp ON lp.id=e.policy_version_id
    LEFT JOIN employee_leave_projections pr
      ON pr.user_id = u.id AND pr.year = ${year} AND pr.tenant_key = $1 AND pr.project_key = $2
    LEFT JOIN LATERAL (
      SELECT GREATEST(
        COALESCE(SUM(r.period_count),0)::int,
        COUNT(DISTINCT CASE WHEN q.leave_type = 'CP' AND q.status NOT IN ('REJECTED','CANCELLED') THEN COALESCE(q.cycle_no, 1) END)::int
      ) AS realisasi FROM employee_leave_requests q
      LEFT JOIN employee_leave_realisations r ON r.request_id = q.id AND r.status IN ('REALIZED','CORRECTED')
      WHERE q.user_id = u.id AND q.tenant_key = $1 AND q.project_key = $2
        AND COALESCE(q.owning_year,EXTRACT(YEAR FROM q.planned_start)::int) = ${year}
    ) cp ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(r.actual_days),0) AS hari FROM employee_leave_realisations r
      JOIN employee_leave_requests q ON q.id = r.request_id
      WHERE r.user_id = u.id AND r.tenant_key = $1 AND r.project_key = $2
        AND r.status IN ('REALIZED','CORRECTED') AND q.leave_type = 'CT'
        AND COALESCE(q.owning_year,EXTRACT(YEAR FROM q.planned_start)::int) = ${year}
    ) ct ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS belum FROM leave_roster_reconciliation rc
      WHERE rc.user_id = u.id AND rc.tenant_key = $1 AND rc.project_key = $2
        AND rc.state IN ('MISMATCH','OVERRIDDEN')
    ) rc ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'request_id',q.id,'cycle_no',q.cycle_no,'owning_year',q.owning_year,'application_group_id',q.application_group_id,
        'projection_start',q.projection_start,'projection_end',q.projection_end,'leave_type',q.leave_type,
        'request_status',q.status,'planned_start',q.planned_start,'planned_end',q.planned_end,
        'reason',q.reason,'realisation_id',r.id,'actual_start',r.actual_start,
        'actual_end',r.actual_end,'actual_days',r.actual_days,'period_count',r.period_count,
        'variance_days',r.variance_days,'counting_status',r.counting_status,'realisation_status',r.status
      ) ORDER BY COALESCE(q.cycle_no,9999),q.planned_start,q.leave_type) AS events
      FROM employee_leave_requests q
      LEFT JOIN employee_leave_realisations r ON r.request_id=q.id AND r.status<>'CANCELLED'
      WHERE q.user_id=u.id AND q.tenant_key=$1 AND q.project_key=$2
        AND q.status NOT IN ('REJECTED','CANCELLED')
        AND COALESCE(q.owning_year,EXTRACT(YEAR FROM q.planned_start)::int) = ${year}
    ) ev ON TRUE
    WHERE ${where} AND ($1='default' OR wp.id IS NOT NULL)
    ORDER BY u.departemen NULLS LAST, u.jabatan NULLS LAST, u.nama`,
  filters);
  const today = toIso(new Date());
  return rows.map(row => {
    const calc = summarizeLeave({
      periodEntitlement: row.period_entitlement || 0,
      periodAdjustment: row.period_adjustment || 0,
      realisedPeriods: row.aktual_periode,
      annualEntitlement: row.annual_entitlement_days ?? ANNUAL_DEFAULT_DAYS,
      carryForward: row.carry_forward_days || 0,
      annualAdjustment: row.annual_adjustment_days || 0,
      ctDays: row.ct_hari,
    });
    const nextLeave = row.next_leave_start ? asIsoDate(row.next_leave_start, 'Proyeksi cuti') : null;
    const dueSoon = withinDays(nextLeave, today, 30);
    const status = !row.policy_version_id ? 'BELUM_SETUP'
      : row.belum_rekonsiliasi > 0 ? 'REKONSILIASI'
      : calc.sisa <= 0 && calc.hak > 0 ? 'HABIS'
      : dueSoon ? 'JATUH_TEMPO' : 'AMAN';
    const policy = row.policy_version_id ? {
      effective_from: row.policy_effective_from, effective_to: row.policy_effective_to,
      work_days: row.policy_work_days, leave_days: row.policy_leave_days,
    } : null;
    return {
      ...row,
      hak_periode: calc.hak,
      aktual: calc.aktual,
      sisa: calc.sisa,
      sisa_tahunan: calc.sisaTahunan,
      next_leave_start: nextLeave,
      cycle_projections: policy ? annualCycleProjections(policy, year) : [],
      status,
    };
  }).filter(row => !options.status || options.status === 'all' || row.status === String(options.status).toUpperCase());
}

async function getDetail(db, scope, userId, year) {
  const employee = await getEmployee(db, scope, userId);
  if (!employee) throw err('Karyawan tidak ditemukan.', 404);
  const ent = await ensureEntitlement(db.query.bind(db), scope, userId, year, null).catch(() => null);
  const requests = await db.query(`SELECT r.*, s.nama AS supervisor_nama, h.nama AS hr_nama
    FROM employee_leave_requests r
    LEFT JOIN users s ON s.id = r.supervisor_by LEFT JOIN users h ON h.id = r.hr_by
    WHERE r.user_id = $1 AND r.tenant_key = $2 AND r.project_key = $3
      AND COALESCE(r.owning_year,EXTRACT(YEAR FROM r.planned_start)::int) = $4
    ORDER BY r.planned_start DESC`,
  [userId, scope.tenantKey, scope.projectKey, year]);
  const realisations = await db.query(`SELECT r.*, q.leave_type, q.planned_start, q.planned_end,
      q.cycle_no, q.owning_year, q.application_group_id
    FROM employee_leave_realisations r JOIN employee_leave_requests q ON q.id = r.request_id
    WHERE r.user_id = $1 AND r.tenant_key = $2 AND r.project_key = $3
      AND COALESCE(q.owning_year,EXTRACT(YEAR FROM q.planned_start)::int) = $4
    ORDER BY r.actual_start`,
  [userId, scope.tenantKey, scope.projectKey, year]);
  const rosterCp = await db.query(`SELECT tanggal::text AS tanggal, status, source, catatan
    FROM employee_roster_daily
    WHERE user_id = $1 AND tanggal >= $2::date AND tanggal <= $3::date AND status = 'CP'
    ORDER BY tanggal`,
  [userId, `${year}-01-01`, `${year}-12-31`]);
  const policies = await db.query(`SELECT * FROM leave_policy_versions
    WHERE tenant_key = $1 AND project_key = $2
      AND (target_user_id::text = $5 OR (target_user_id IS NULL
        AND (department = '' OR department = $3) AND (position = '' OR position = $4)))
    ORDER BY leave_type, version_no DESC`,
  [scope.tenantKey, scope.projectKey, employee.departemen || '', employee.jabatan || '', String(userId)]);
  const audits = await db.query(`SELECT a.*, u.nama AS actor_nama FROM leave_audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.tenant_key = $1 AND a.project_key = $2
      AND (a.entity_id::text = $3 OR a.after_value->>'user_id' = $3 OR a.before_value->>'user_id' = $3)
    ORDER BY a.created_at DESC LIMIT 100`,
  [scope.tenantKey, scope.projectKey, String(userId)]);
  return {
    employee, entitlement: ent ? ent.entitlement : null,
    requests: requests.rows, realisations: realisations.rows,
    roster_cp: rosterCp.rows, policies: policies.rows, audits: audits.rows,
  };
}

async function getCalendar(db, scope, { month }) {
  const period = String(month || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw err('Bulan kalender harus YYYY-MM.', 422);
  const [year, mon] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const from = `${period}-01`;
  const to = `${period}-${String(lastDay).padStart(2, '0')}`;
  const { rows } = await db.query(`SELECT req.user_id,u.nama,u.departemen,
      COALESCE(real.actual_start,req.planned_start)::text AS mulai,
      COALESCE(real.actual_end,req.planned_end)::text AS selesai,req.leave_type,
      CASE WHEN real.id IS NULL THEN 'PLANNED' ELSE 'REALIZED' END AS phase
    FROM employee_leave_requests req
    JOIN users u ON u.id=req.user_id
    LEFT JOIN workforce_employee_profiles wp
      ON wp.user_id=u.id AND wp.deleted_at IS NULL AND wp.tenant_key=$1
    LEFT JOIN employee_leave_realisations real
      ON real.request_id=req.id AND real.status IN ('REALIZED','CORRECTED')
    WHERE req.tenant_key=$1 AND req.project_key=$2
      AND req.status IN ('SUPERVISOR_APPROVED','APPROVED','REALIZED')
      AND ($1='default' OR wp.id IS NOT NULL)
      AND COALESCE(real.actual_start,req.planned_start) <= $4::date
      AND COALESCE(real.actual_end,req.planned_end) >= $3::date
    ORDER BY mulai`,
  [scope.tenantKey, scope.projectKey, from, to]);
  return { month: period, from, to, rows };
}

async function runReconciliation(db, scope, { from, to }) {
  const start = from ? parseDate(from, 'Tanggal mulai') : toIso(new Date());
  const end = to ? parseDate(to, 'Tanggal selesai') : start;
  if (end < start) throw err('Tanggal selesai tidak boleh sebelum tanggal mulai.', 422);
  const { rows } = await db.query(`SELECT req.id AS request_id,req.user_id,req.leave_type,
      real.id AS realisation_id,COALESCE(real.actual_start,req.planned_start) AS range_start,
      COALESCE(real.actual_end,req.planned_end) AS range_end
    FROM employee_leave_requests req
    LEFT JOIN employee_leave_realisations real
      ON real.request_id=req.id AND real.status IN ('REALIZED','CORRECTED')
    WHERE req.tenant_key=$1 AND req.project_key=$2
      AND req.status IN ('APPROVED','REALIZED') AND req.leave_type='CP'
      AND COALESCE(real.actual_start,req.planned_start) <= $4::date
      AND COALESCE(real.actual_end,req.planned_end) >= $3::date`,
  [scope.tenantKey, scope.projectKey, start, end]);
  const client = db.connect ? await db.connect() : null;
  const q = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
  const summary = { checked: 0, matched: 0, mismatch: 0, overridden: 0 };
  try {
    if (client) await q('BEGIN');
    for (const real of rows) {
      const dates = enumerateDates(
        real.range_start > start ? real.range_start : start,
        real.range_end < end ? real.range_end : end);
      for (const tanggal of dates) {
        const existing = await q(`SELECT status, source FROM employee_roster_daily
          WHERE user_id = $1 AND tanggal = $2::date LIMIT 1`, [real.user_id, tanggal]);
        const actual = existing.rows[0] ? existing.rows[0].status : null;
        const source = existing.rows[0] ? existing.rows[0].source : null;
        const state = actual === 'CP' ? 'MATCHED' : (source === 'manual_override' ? 'OVERRIDDEN' : 'MISMATCH');
        await q(`INSERT INTO leave_roster_reconciliation
          (tenant_key,project_key,request_id,realisation_id,user_id,tanggal,expected_status,actual_status,state)
          VALUES ($1,$2,$3,$4,$5,$6::date,'CP',$7,$8)
          ON CONFLICT (request_id,tanggal) DO UPDATE SET realisation_id=EXCLUDED.realisation_id,
            actual_status = EXCLUDED.actual_status, state = EXCLUDED.state, checked_at = CURRENT_TIMESTAMP`,
        [scope.tenantKey, scope.projectKey, real.request_id, real.realisation_id, real.user_id, tanggal, actual, state]);
        summary.checked += 1;
        if (state === 'MATCHED') summary.matched += 1;
        else if (state === 'OVERRIDDEN') summary.overridden += 1;
        else summary.mismatch += 1;
      }
    }
    if (client) await q('COMMIT');
    return summary;
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rollbackError) { void rollbackError; } }
    throw error;
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  LEAVE_TYPES, LEAVE_LABEL, REQUEST_NEXT, ANNUAL_DEFAULT_DAYS,
  inclusiveDays, daysInYear, periodEntitlement, policyYearWindow, annualCycleProjections, periodicCycleStarts,
  policyPeriodEntitlement, summarizeLeave, policyReferenceDate,
  projectNextLeave, withinDays, asIsoDate, enumerateDates,
  getEmployee, listPolicies, listPolicyScopes, policyAt, resolvePolicy, createPolicyVersion, setPolicyActive,
  deletePolicyVersion,
  ensureEntitlement, createRequest, getCycleOptions, createCycleApplication, updateCycleApplication, deleteCycleApplication, transitionRequest,
  syncRosterForLeave, syncRosterForRequest, syncRosterForRealisation,
  restoreRosterForRequest, removeRosterForRealisation, refreshProjection,
  hasHrAuthority, prepareDashboardYear, buildRealisation,
  correctRealisation, cancelRealisation,
  getDashboard, getDetail, getCalendar, runReconciliation,
};
