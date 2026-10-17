'use strict';

/**
 * HSE — Jam kerja karyawan (Setup Master).
 *
 * Sumber hari hadir = sumber yang sama dengan Rekap Performa:
 *   - keterangan_presensi (manual admin) menimpa presensi kamera;
 *   - hadir = kategori 'hadir_manual', atau presensi kamera (absensi.waktu_datang)
 *     tanpa keterangan manual pada tanggal tersebut;
 *   - tanggal kerja = absensi.tanggal_kerja (tanggal shift dimulai);
 *   - hanya role 'karyawan', sejak tanggal akun dibuat (WIB) dan tidak di masa depan.
 * Perbedaan yang disengaja: karyawan yang kini nonaktif TETAP dihitung untuk hari
 * hadirnya di masa lalu, agar total jam kerja (pembagi LTIFR) tidak berkurang.
 *
 * Jam per hari: BY_EMPLOYEE > BY_ROLE + departemen > BY_ROLE tanpa departemen.
 * Tanpa aturan = "Belum diatur" (hari hadir tercatat, jam tidak dihitung — bukan 0).
 */

const { resolveDailyCategory } = require('./roster');

const INTERNAL_COMPANY = 'PT internal';
const PARTIAL_ROLE_REASON = 'ATURAN_JABATAN_SEBAGIAN';
const NO_DEPT = '__none__';
const OVERRIDE_REASONS = ['ALIH_TUGAS_SEMENTARA', 'PENUGASAN_KHUSUS', 'POLA_KERJA_KHUSUS', 'LAINNYA', PARTIAL_ROLE_REASON];
const MAX_RANGE_DAYS = 366;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function httpError(message, statusCode = 422, extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

// ---------------------------------------------------------------------------
// Tanggal (WIB, string YYYY-MM-DD)
// ---------------------------------------------------------------------------
function todayWib(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);
}

function monthStart(iso) { return `${iso.slice(0, 7)}-01`; }

function monthEnd(iso) {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${y}`;
}

/** Daftar month key (YYYY-MM) dari `count` bulan terakhir s/d bulan `endIso`, terbaru dulu. */
function lastMonthKeys(endIso, count = 12) {
  const out = [];
  let y = Number(endIso.slice(0, 4));
  let m = Number(endIso.slice(5, 7));
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

function normalizeMonth(value) {
  const v = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(v) && isIsoDate(`${v}-01`)) return `${v}-01`;
  if (isIsoDate(v)) return monthStart(v);
  throw httpError('Periode bulan tidak valid (format YYYY-MM).');
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function parseHours(value) {
  const h = Number(value);
  if (!Number.isFinite(h) || h <= 0 || h > 24) throw httpError('Jam kerja per hari harus lebih dari 0 dan paling banyak 24.');
  return round2(h);
}

function validateRange(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) throw httpError('Tanggal periode tidak valid (format YYYY-MM-DD).');
  if (from > to) throw httpError('Tanggal awal tidak boleh setelah tanggal akhir.');
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw httpError(`Rentang periode maksimal ${MAX_RANGE_DAYS} hari.`);
}

function isInternalCompany(name) {
  const n = String(name || '').trim().toLowerCase();
  return !n || n === INTERNAL_COMPANY.toLowerCase() || n === 'internal';
}

/**
 * Baris hse_manhours dianggap jam kerja KONTRAKTOR hanya bila nama perusahaannya terdaftar
 * di HSE → Kontraktor (hse_contractors). Selain itu = internal (termasuk data seed lama
 * "PT JMB-DKC"), yang digantikan oleh rekap presensi.
 */
function contractorMatchSql(alias = 'm') {
  return `EXISTS (
    SELECT 1 FROM hse_contractors c
     WHERE c.tenant_key = ${alias}.tenant_key AND c.project_key = ${alias}.project_key
       AND c.deleted_at IS NULL
       AND lower(trim(c.company_name)) = lower(trim(COALESCE(${alias}.company_name, '')))
  )`;
}

function normKey(v) { return String(v || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/** Rumus frekuensi per 1.000.000 jam. Null bila jam kerja 0 (tidak dihitung, bukan 0). */
function frequencyRate(count, hours, factor = 1000000) {
  const h = Number(hours) || 0;
  if (h <= 0) return null;
  return Number((((Number(count) || 0) * factor) / h).toFixed(2));
}

// ---------------------------------------------------------------------------
// SQL inti: hari hadir (versi Rekap Performa) + aturan jam yang berlaku
// Parameter: $1 tenant_key, $2 project_key, $3 from, $4 to
// ---------------------------------------------------------------------------
function ruleLateral(userAlias, dateExpr) {
  return `
    LEFT JOIN LATERAL (
      SELECT s.id, s.hours_per_day, s.target_type, s.department_id, s.effective_from
        FROM hse_workhour_standards s
        LEFT JOIN workforce_positions sp ON sp.id = s.position_id
        LEFT JOIN workforce_departments sd ON sd.id = s.department_id
        LEFT JOIN workforce_departments spd ON spd.id = sp.department_id
       WHERE s.tenant_key = $1 AND s.project_key = $2
         AND s.is_active AND s.deleted_at IS NULL
         AND s.effective_from <= ${dateExpr}
         AND (s.effective_to IS NULL OR s.effective_to >= ${dateExpr})
         AND (
              (s.target_type = 'BY_EMPLOYEE' AND s.employee_id = ${userAlias}.id)
           OR (s.target_type = 'BY_ROLE'
               AND lower(trim(sp.name)) = lower(trim(COALESCE(${userAlias}.jabatan, '')))
               -- Jabatan bernama sama bisa ada di beberapa departemen ("Admin"):
               -- jabatan milik aturan harus berada di departemen karyawan.
               AND (spd.id IS NULL OR NULLIF(trim(COALESCE(${userAlias}.departemen, '')), '') IS NULL
                    OR lower(trim(spd.name)) = lower(trim(${userAlias}.departemen)))
               AND (s.department_id IS NULL
                    OR lower(trim(sd.name)) = lower(trim(COALESCE(${userAlias}.departemen, '')))))
         )
       ORDER BY CASE WHEN s.target_type = 'BY_EMPLOYEE' THEN 0
                     WHEN s.department_id IS NOT NULL THEN 1 ELSE 2 END,
                s.effective_from DESC
       LIMIT 1
    ) r ON TRUE`;
}

const PRESENT_DAYS_CTE = `
  present AS (
    SELECT d.user_id, d.work_date
      FROM (
        SELECT a.user_id, a.tanggal_kerja::date AS work_date
          FROM absensi a
         WHERE a.waktu_datang IS NOT NULL
           AND a.tanggal_kerja BETWEEN $3::date AND $4::date
        UNION
        SELECT kp.user_id, kp.tanggal::date
          FROM keterangan_presensi kp
         WHERE kp.kategori = 'hadir_manual'
           AND kp.tanggal BETWEEN $3::date AND $4::date
      ) d
      LEFT JOIN keterangan_presensi k ON k.user_id = d.user_id AND k.tanggal::date = d.work_date
     WHERE k.user_id IS NULL OR k.kategori = 'hadir_manual'
  ),
  present_hours AS (
    SELECT p.user_id, p.work_date, r.id AS rule_id, r.hours_per_day, r.target_type
      FROM present p
      JOIN users u ON u.id = p.user_id AND u.role = 'karyawan'
      ${ruleLateral('u', 'p.work_date')}
     WHERE p.work_date >= (u.created_at AT TIME ZONE 'Asia/Jakarta')::date
       AND p.work_date <= (now() AT TIME ZONE 'Asia/Jakarta')::date
  )`;

async function fetchPresentHours(db, scope, from, to) {
  const { rows } = await db.query(`
    WITH ${PRESENT_DAYS_CTE}
    SELECT user_id, work_date::text AS work_date, rule_id, hours_per_day, target_type
      FROM present_hours
     ORDER BY user_id, work_date
  `, [scope.tenantKey, scope.projectKey, from, to]);
  return rows;
}

/** Jam kerja internal (live dari presensi) per bulan pada rentang [from, to]. */
async function fetchMonthlyLiveHours(db, scope, from, to) {
  const { rows } = await db.query(`
    WITH ${PRESENT_DAYS_CTE}
    SELECT to_char(work_date, 'YYYY-MM') AS month_key,
           COALESCE(SUM(hours_per_day), 0)::numeric(14,2) AS hours,
           COUNT(*)::int AS present_days,
           COUNT(*) FILTER (WHERE hours_per_day IS NULL)::int AS uncounted_days,
           COUNT(DISTINCT user_id)::int AS employee_count
      FROM present_hours
     GROUP BY month_key
  `, [scope.tenantKey, scope.projectKey, from, to]);
  const map = new Map();
  rows.forEach(r => map.set(r.month_key, {
    hours: Number(r.hours) || 0,
    presentDays: Number(r.present_days) || 0,
    uncountedDays: Number(r.uncounted_days) || 0,
    employeeCount: Number(r.employee_count) || 0,
  }));
  return map;
}

async function fetchLiveHoursTotal(db, scope, from, to) {
  if (from > to) return 0;
  const { rows } = await db.query(`
    WITH ${PRESENT_DAYS_CTE}
    SELECT COALESCE(SUM(hours_per_day), 0)::numeric(16,2) AS hours FROM present_hours
  `, [scope.tenantKey, scope.projectKey, from, to]);
  return Number(rows[0]?.hours) || 0;
}

// ---------------------------------------------------------------------------
// Rekap (murni JS, dapat diuji tanpa database)
// ---------------------------------------------------------------------------
const CATEGORY_LABEL = {
  hadir_kamera: 'Hadir', hadir_manual: 'Hadir (manual)', izin: 'Izin', sakit: 'Sakit',
  cuti: 'Cuti', off: 'OFF', alpa: 'Alpa', belum_terdaftar: 'Belum terdaftar', belum_terjadi: 'Belum terjadi',
};

/**
 * @param {object} p
 * @param {Array} p.employees     [{id, nama, employee_id, jabatan, departemen, is_active, created_date}]
 * @param {Array} p.presentRows   hasil fetchPresentHours
 * @param {Map}   p.manualMap     key `${userId}_${date}` → kategori
 * @param {Map}   p.rosterMap     key `${userId}_${date}` → status S/M/C/CP/OFF
 * @param {string} p.from, p.to, p.today
 * @param {boolean} p.withDays    sertakan rincian harian
 */
function buildRecap({ employees, presentRows, manualMap = new Map(), rosterMap = new Map(), from, to, today, withDays = false }) {
  const presentByUser = new Map();
  presentRows.forEach(r => {
    if (!presentByUser.has(r.user_id)) presentByUser.set(r.user_id, new Map());
    presentByUser.get(r.user_id).set(String(r.work_date).slice(0, 10), r);
  });

  const items = [];
  for (const e of employees) {
    const days = presentByUser.get(e.id) || new Map();
    if (!e.is_active && days.size === 0) continue; // nonaktif tanpa kehadiran di periode: tidak relevan

    const created = e.created_date || from;
    const effFrom = created > from ? created : from;
    let effTo = to > today ? today : to;
    if (!e.is_active) {
      // Tanggal nonaktif tidak tercatat: ketidakhadiran hanya dihitung s/d hari hadir terakhir
      const lastPresent = Array.from(days.keys()).sort().pop();
      if (lastPresent && lastPresent < effTo) effTo = lastPresent;
    }

    let present = 0, counted = 0, uncounted = 0, absent = 0, hours = 0;
    const breakdown = new Map(); // hours → {hours, days, sources:Set}
    const dayRows = [];

    for (let d = from; d <= to; d = addDays(d, 1)) {
      const pr = days.get(d);
      let category;
      let source = null;
      if (d > today) category = 'belum_terjadi';
      else if (d < created) category = 'belum_terdaftar';
      else if (pr) category = manualMap.get(`${e.id}_${d}`) === 'hadir_manual' ? 'hadir_manual' : 'hadir_kamera';
      else {
        const rosterStatus = rosterMap.get(`${e.id}_${d}`) || null;
        const res = resolveDailyCategory({
          hasAttendance: false,
          manualCategory: manualMap.get(`${e.id}_${d}`) || null,
          rosterStatus,
          isSunday: new Date(`${d}T00:00:00Z`).getUTCDay() === 0,
        });
        category = res.category;
        source = res.source;
        if (category === 'hadir_manual') category = 'hadir_manual'; // tidak terjadi: hadir_manual selalu ada di presentRows
        if (['alpa', 'izin', 'sakit'].includes(category) || (category === 'cuti' && !String(source).startsWith('roster'))) {
          if (d >= effFrom && d <= effTo) absent += 1;
        }
      }

      let dayHours = null;
      let ruleSource = null;
      if (pr) {
        present += 1;
        if (pr.hours_per_day == null) {
          uncounted += 1;
          ruleSource = 'NONE';
        } else {
          dayHours = Number(pr.hours_per_day);
          counted += 1;
          hours += dayHours;
          ruleSource = pr.target_type === 'BY_EMPLOYEE' ? 'INDIVIDUAL' : 'ROLE';
          const k = String(dayHours);
          if (!breakdown.has(k)) breakdown.set(k, { hours: dayHours, days: 0, sources: new Set() });
          const b = breakdown.get(k);
          b.days += 1;
          b.sources.add(ruleSource);
        }
      }
      if (withDays) {
        dayRows.push({
          date: d,
          category,
          label: CATEGORY_LABEL[category] || category,
          present: Boolean(pr),
          hours_per_day: pr ? (pr.hours_per_day == null ? null : Number(pr.hours_per_day)) : null,
          counted_hours: dayHours || 0,
          rule_id: pr?.rule_id || null,
          rule_source: ruleSource,
        });
      }
    }

    const breakdownArr = Array.from(breakdown.values())
      .map(b => ({ hours: b.hours, days: b.days, sources: Array.from(b.sources) }));
    let status = 'COUNTED';
    if (present === 0) status = 'NO_ATTENDANCE';
    else if (uncounted === present) status = 'NOT_SET';
    else if (uncounted > 0) status = 'PARTIAL';
    else if (breakdownArr.length > 1) status = 'MIXED';

    const item = {
      employee_id: e.id,
      nama: e.nama,
      employee_no: e.employee_id || null,
      jabatan: e.jabatan || null,
      departemen: e.departemen || null,
      is_active: Boolean(e.is_active),
      present_days: present,
      counted_days: counted,
      uncounted_days: uncounted,
      absent_days: absent,
      counted_hours: round2(hours),
      breakdown: breakdownArr,
      status,
    };
    if (withDays) item.days = dayRows;
    items.push(item);
  }

  items.sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id'));
  const summary = items.reduce((s, it) => {
    s.total_hours += it.counted_hours;
    s.present_days += it.present_days;
    s.absent_days += it.absent_days;
    s.uncounted_days += it.uncounted_days;
    if (it.uncounted_days > 0) s.uncounted_employees += 1;
    if (it.present_days > 0) s.employees_with_attendance += 1;
    if (!it.is_active) s.inactive_employees += 1;
    return s;
  }, { total_hours: 0, present_days: 0, absent_days: 0, uncounted_days: 0, uncounted_employees: 0, employees_with_attendance: 0, inactive_employees: 0 });
  summary.total_hours = round2(summary.total_hours);
  summary.employee_count = items.length;
  return { items, summary };
}

async function loadRecapInputs(db, scope, from, to, employeeId = null) {
  const params = [from, to];
  let empFilter = '';
  if (employeeId) { params.push(employeeId); empFilter = `AND u.id = $${params.length}`; }

  const [empRes, presentRows, manualRes, rosterRes] = await Promise.all([
    db.query(`
      SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen, u.is_active,
             to_char((u.created_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS created_date
        FROM users u
       WHERE u.role = 'karyawan'
         AND (u.is_active = TRUE OR EXISTS (
               SELECT 1 FROM absensi a WHERE a.user_id = u.id AND a.waktu_datang IS NOT NULL
                  AND a.tanggal_kerja BETWEEN $1::date AND $2::date
             ) OR EXISTS (
               SELECT 1 FROM keterangan_presensi kp WHERE kp.user_id = u.id AND kp.kategori = 'hadir_manual'
                  AND kp.tanggal BETWEEN $1::date AND $2::date
             ))
         ${empFilter}
       ORDER BY u.nama ASC
    `, params),
    fetchPresentHours(db, scope, from, to),
    db.query(`
      SELECT user_id, tanggal::text AS tanggal, kategori
        FROM keterangan_presensi
       WHERE tanggal BETWEEN $1::date AND $2::date
    `, [from, to]),
    db.query(`
      SELECT user_id, tanggal::text AS tanggal, status
        FROM employee_roster_daily
       WHERE tanggal BETWEEN $1::date AND $2::date
    `, [from, to]).catch(() => ({ rows: [] })),
  ]);

  const manualMap = new Map(manualRes.rows.map(r => [`${r.user_id}_${String(r.tanggal).slice(0, 10)}`, r.kategori]));
  const rosterMap = new Map(rosterRes.rows.map(r => [`${r.user_id}_${String(r.tanggal).slice(0, 10)}`, r.status]));
  const rows = employeeId ? presentRows.filter(r => r.user_id === employeeId) : presentRows;
  return { employees: empRes.rows, presentRows: rows, manualMap, rosterMap };
}

async function findContractorByName(db, scope, name) {
  const { rows } = await db.query(`
    SELECT id, company_name FROM hse_contractors
     WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
       AND lower(trim(company_name)) = lower(trim($3))
     LIMIT 1
  `, [scope.tenantKey, scope.projectKey, String(name || '')]);
  return rows[0] || null;
}

async function getWorkhourRecap(db, scope, query = {}) {
  const today = todayWib();
  const from = query.from || monthStart(today);
  const to = query.to || today;
  validateRange(from, to);
  const inputs = await loadRecapInputs(db, scope, from, to);
  const recap = buildRecap({ ...inputs, from, to, today });
  return { from, to, today, source: 'REKAP_PERFORMA', ...recap };
}

async function getWorkhourRecapDetail(db, scope, employeeId, query = {}) {
  const today = todayWib();
  const from = query.from || monthStart(today);
  const to = query.to || today;
  validateRange(from, to);
  const inputs = await loadRecapInputs(db, scope, from, to, employeeId);
  const recap = buildRecap({ ...inputs, from, to, today, withDays: true });
  const item = recap.items[0];
  if (!item) throw httpError('Karyawan tidak ditemukan atau tidak punya data pada periode ini.', 404);
  return { from, to, today, item };
}

// ---------------------------------------------------------------------------
// Setup: standar per jabatan & per karyawan
// ---------------------------------------------------------------------------
async function listMasterPositions(db, scope) {
  const [posRes, deptRes] = await Promise.all([
    db.query(`
      SELECT wp.id, wp.name, wp.department_id, wd.name AS department_name
        FROM workforce_positions wp
        LEFT JOIN workforce_departments wd ON wd.id = wp.department_id
       WHERE wp.is_active = TRUE AND wp.tenant_key = $1 AND wp.project_key = $2
       ORDER BY wp.name ASC
    `, [scope.tenantKey, scope.projectKey]).catch(() => ({ rows: [] })),
    db.query(`
      SELECT id, name FROM workforce_departments
       WHERE is_active = TRUE AND tenant_key = $1 AND project_key = $2
       ORDER BY name ASC
    `, [scope.tenantKey, scope.projectKey]).catch(() => ({ rows: [] })),
  ]);
  return { positions: posRes.rows, departments: deptRes.rows };
}

/** Petakan karyawan ke id jabatan/departemen master (berdasarkan nama, pola migrasi 084). */
function mapEmployeeToMaster(emp, positions, departments) {
  const dept = departments.find(d => normKey(d.name) === normKey(emp.departemen)) || null;
  const candidates = positions.filter(p => normKey(p.name) === normKey(emp.jabatan));
  // Jabatan bernama sama bisa ada di beberapa departemen: jangan meminjam
  // jabatan departemen lain. Tanpa departemen, hanya nama yang unik.
  const hasDeptText = Boolean(normKey(emp.departemen));
  const pos = dept
    ? candidates.find(p => p.department_id === dept.id) || null
    : (!hasDeptText && candidates.length === 1 ? candidates[0] : null);
  return { position_id: pos?.id || null, department_id: dept?.id || null };
}

async function getWorkhourSetup(db, scope, query = {}) {
  const date = query.date && isIsoDate(query.date) ? query.date : todayWib();
  const { positions, departments } = await listMasterPositions(db, scope);

  const [empRes, rulesRes] = await Promise.all([
    db.query(`
      SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen,
             r.id AS rule_id, r.hours_per_day, r.target_type, r.department_id AS rule_department_id,
             r.effective_from::text AS rule_from
        FROM users u
        ${ruleLateral('u', '$3::date')}
       WHERE u.role = 'karyawan' AND u.is_active = TRUE
       ORDER BY u.nama ASC
    `, [scope.tenantKey, scope.projectKey, date]),
    db.query(`
      SELECT s.id, s.target_type, s.position_id, s.department_id, s.employee_id, s.hours_per_day,
             s.effective_from::text AS effective_from, s.effective_to::text AS effective_to,
             s.reason_code, s.notes, s.is_active, s.created_at,
             wd.name AS department_name
        FROM hse_workhour_standards s
        LEFT JOIN workforce_departments wd ON wd.id = s.department_id
       WHERE s.tenant_key = $1 AND s.project_key = $2 AND s.deleted_at IS NULL
       ORDER BY s.effective_from DESC, s.created_at DESC
    `, [scope.tenantKey, scope.projectKey]),
  ]);

  const rules = rulesRes.rows.map(r => ({ ...r, hours_per_day: Number(r.hours_per_day) }));
  const activeRuleOn = r => r.is_active && r.effective_from <= date && (!r.effective_to || r.effective_to >= date);
  const ruleById = new Map(rules.map(r => [r.id, r]));

  const employees = empRes.rows.map(u => {
    const map = mapEmployeeToMaster(u, positions, departments);
    let source = 'NONE';
    if (u.rule_id) source = u.target_type === 'BY_EMPLOYEE' ? 'INDIVIDUAL' : 'ROLE';
    const rule = u.rule_id ? ruleById.get(u.rule_id) : null;
    const roleRule = source === 'INDIVIDUAL'
      ? rules.find(r => r.target_type === 'BY_ROLE' && activeRuleOn(r) && r.position_id === map.position_id
          && (!r.department_id || r.department_id === map.department_id)) || null
      : null;
    return {
      id: u.id,
      nama: u.nama,
      employee_no: u.employee_id || null,
      jabatan: u.jabatan || null,
      departemen: u.departemen || null,
      position_id: map.position_id,
      department_id: map.department_id,
      source,
      hours_per_day: u.hours_per_day == null ? null : Number(u.hours_per_day),
      rule_id: u.rule_id || null,
      effective_from: rule?.effective_from || u.rule_from || null,
      effective_to: rule?.effective_to || null,
      reason_code: rule?.reason_code || null,
      notes: rule?.notes || null,
      role_hours_per_day: roleRule ? roleRule.hours_per_day : null,
    };
  });

  const positionRows = positions.map(p => {
    const emps = employees.filter(e => e.position_id === p.id);
    const posRules = rules.filter(r => r.target_type === 'BY_ROLE' && r.position_id === p.id);
    const current = posRules.filter(activeRuleOn);
    const upcoming = posRules.filter(r => r.is_active && r.effective_from > date);
    const previous = posRules
      .filter(r => r.effective_to && r.effective_to < date)
      .sort((a, b) => b.effective_to.localeCompare(a.effective_to))[0] || null;
    return {
      id: p.id,
      name: p.name,
      department_id: p.department_id,
      department_name: p.department_name || null,
      employee_count: emps.length,
      override_count: emps.filter(e => e.source === 'INDIVIDUAL').length,
      not_set_count: emps.filter(e => e.source === 'NONE').length,
      status: current.length ? 'SET' : 'NONE',
      current_rules: current.map(r => ({
        id: r.id, department_id: r.department_id, department_name: r.department_name || null,
        hours_per_day: r.hours_per_day, effective_from: r.effective_from, effective_to: r.effective_to,
      })),
      upcoming_rules: upcoming.map(r => ({
        id: r.id, department_id: r.department_id, department_name: r.department_name || null,
        hours_per_day: r.hours_per_day, effective_from: r.effective_from,
      })),
      previous_rule: previous ? { hours_per_day: previous.hours_per_day, effective_to: previous.effective_to } : null,
      version_count: posRules.length,
    };
  }).filter(p => p.employee_count > 0 || p.version_count > 0);

  const unmapped = new Map();
  employees.filter(e => !e.position_id).forEach(e => {
    const k = e.jabatan || '(tanpa jabatan)';
    unmapped.set(k, (unmapped.get(k) || 0) + 1);
  });

  const monthStartCur = monthStart(date);
  const changedThisMonth = rules.filter(r => r.target_type === 'BY_ROLE' && r.is_active
    && r.effective_from >= monthStartCur && r.effective_from <= monthEnd(date)).length;

  return {
    date,
    departments,
    positions: positionRows,
    employees,
    unmapped_positions: Array.from(unmapped.entries()).map(([name, count]) => ({ name, count })),
    override_reasons: OVERRIDE_REASONS.filter(r => r !== PARTIAL_ROLE_REASON),
    kpi: {
      active_positions: positionRows.filter(p => p.employee_count > 0).length,
      positions_set: positionRows.filter(p => p.employee_count > 0 && p.status === 'SET').length,
      positions_not_set: positionRows.filter(p => p.employee_count > 0 && p.status === 'NONE').length,
      positions_changed_this_month: changedThisMonth,
      active_employees: employees.length,
      employees_role: employees.filter(e => e.source === 'ROLE').length,
      employees_individual: employees.filter(e => e.source === 'INDIVIDUAL').length,
      employees_not_set: employees.filter(e => e.source === 'NONE').length,
    },
  };
}

async function assertNotLocked(db, scope, fromDate) {
  const { rows } = await db.query(`
    SELECT to_char(period_month, 'YYYY-MM') AS month_key
      FROM hse_workhour_periods
     WHERE tenant_key = $1 AND project_key = $2 AND status = 'LOCKED'
       AND period_month >= date_trunc('month', $3::date)::date
     ORDER BY period_month DESC
     LIMIT 1
  `, [scope.tenantKey, scope.projectKey, fromDate]);
  if (rows[0]) {
    throw httpError(`Jam kerja ${monthLabel(rows[0].month_key)} sudah dikirim dan dikunci. Tanggal berlaku harus setelah periode terkunci terakhir, atau buka kunci periode itu dulu.`, 409);
  }
}

async function withTransaction(db, work) {
  const isPool = typeof db.connect === 'function';
  const client = isPool ? await db.connect() : db;
  try {
    if (isPool) await client.query('BEGIN');
    const result = await work(client);
    if (isPool) await client.query('COMMIT');
    return result;
  } catch (err) {
    if (isPool) await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23P01') {
      throw httpError('Rentang tanggal aturan bertabrakan dengan aturan aktif lain untuk lingkup yang sama.', 409);
    }
    throw err;
  } finally {
    if (isPool) client.release();
  }
}

async function audit(client, scope, entry) {
  await client.query(`
    INSERT INTO hse_workhour_audit (tenant_key, project_key, entity_type, entity_id, action, old_values, new_values, reason, changed_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    scope.tenantKey, scope.projectKey, entry.entity_type, entry.entity_id || null, entry.action,
    entry.old_values ? JSON.stringify(entry.old_values) : null,
    entry.new_values ? JSON.stringify(entry.new_values) : null,
    entry.reason || null, entry.changed_by || null,
  ]);
}

/**
 * Akhiri / gantikan aturan lama yang tumpang tindih dengan aturan baru mulai `from`.
 * Aturan yang mulai sebelum `from` diakhiri sehari sebelumnya; yang mulai pada/after `from` dinonaktifkan.
 */
async function supersedeOverlapping(client, scope, user, { target_type, position_id, department_id, employee_id }, from) {
  const params = [scope.tenantKey, scope.projectKey, from];
  let scopeCond;
  if (target_type === 'BY_ROLE') {
    params.push(position_id, department_id || null);
    scopeCond = `target_type = 'BY_ROLE' AND position_id = $4 AND department_id IS NOT DISTINCT FROM $5::uuid`;
  } else {
    params.push(employee_id);
    scopeCond = `target_type = 'BY_EMPLOYEE' AND employee_id = $4`;
  }
  const { rows } = await client.query(`
    SELECT *, effective_from::text AS effective_from_text FROM hse_workhour_standards
     WHERE tenant_key = $1 AND project_key = $2 AND is_active AND deleted_at IS NULL
       AND ${scopeCond}
       AND (effective_to IS NULL OR effective_to >= $3::date)
     FOR UPDATE
  `, params);
  for (const old of rows) {
    const oldFrom = String(old.effective_from_text).slice(0, 10);
    if (oldFrom >= from) {
      await client.query(`UPDATE hse_workhour_standards SET is_active = FALSE, updated_by = $2, updated_at = now() WHERE id = $1`, [old.id, user?.id || null]);
      await audit(client, scope, { entity_type: 'STANDARD', entity_id: old.id, action: 'SUPERSEDE', old_values: old, reason: `Digantikan aturan mulai ${from}`, changed_by: user?.id });
    } else {
      const endDate = addDays(from, -1);
      await client.query(`UPDATE hse_workhour_standards SET effective_to = $2::date, updated_by = $3, updated_at = now() WHERE id = $1`, [old.id, endDate, user?.id || null]);
      await audit(client, scope, { entity_type: 'STANDARD', entity_id: old.id, action: 'END', old_values: old, new_values: { effective_to: endDate }, reason: `Diakhiri karena aturan baru mulai ${from}`, changed_by: user?.id });
    }
  }
}

async function insertStandard(client, scope, user, rule) {
  const { rows } = await client.query(`
    INSERT INTO hse_workhour_standards (
      tenant_key, project_key, target_type, position_id, department_id, employee_id,
      hours_per_day, effective_from, effective_to, reason_code, notes, batch_id, created_by, updated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
    RETURNING *
  `, [
    scope.tenantKey, scope.projectKey, rule.target_type,
    rule.target_type === 'BY_ROLE' ? rule.position_id : null,
    rule.target_type === 'BY_ROLE' ? (rule.department_id || null) : null,
    rule.target_type === 'BY_EMPLOYEE' ? rule.employee_id : null,
    rule.hours_per_day, rule.effective_from, rule.effective_to || null,
    rule.reason_code || null, rule.notes || null, rule.batch_id || null, user?.id || null,
  ]);
  await audit(client, scope, { entity_type: 'STANDARD', entity_id: rows[0].id, action: 'CREATE', new_values: rows[0], reason: rule.reason_code || 'Aturan jabatan', changed_by: user?.id });
  return rows[0];
}

function uniqueStrings(arr) {
  return Array.from(new Set((Array.isArray(arr) ? arr : []).map(v => String(v || '').trim()).filter(Boolean)));
}

/**
 * Simpan aturan dari form "Aturan jabatan" (multi jabatan, departemen, karyawan).
 * - Semua karyawan pada kombinasi terpilih dicentang → aturan BY_ROLE per (jabatan, departemen).
 * - Hanya sebagian → aturan BY_EMPLOYEE untuk karyawan terpilih (karyawan lain tidak berubah).
 * Karyawan dengan override individu aktif tidak ikut diubah.
 */
async function saveRoleStandards(db, scope, user, input = {}) {
  const positionIds = uniqueStrings(input.position_ids);
  const departmentIds = uniqueStrings(input.department_ids);
  const employeeIds = uniqueStrings(input.employee_ids);
  if (!positionIds.length) throw httpError('Pilih minimal satu jabatan.');
  if (!departmentIds.length) throw httpError('Pilih minimal satu departemen.');
  if (!employeeIds.length) throw httpError('Pilih minimal satu karyawan.');
  const hours = parseHours(input.hours_per_day);
  const from = input.effective_from;
  if (!isIsoDate(from)) throw httpError('Tanggal berlaku mulai wajib diisi (YYYY-MM-DD).');
  const notes = input.notes ? String(input.notes).slice(0, 1000) : null;

  await assertNotLocked(db, scope, from);
  const setup = await getWorkhourSetup(db, scope, { date: from });
  const posSet = new Set(positionIds);
  const deptSet = new Set(departmentIds);
  const pool = setup.employees.filter(e => e.position_id && posSet.has(e.position_id)
    && (e.department_id ? deptSet.has(e.department_id) : deptSet.has(NO_DEPT)));
  const eligible = pool.filter(e => e.source !== 'INDIVIDUAL');
  if (!eligible.length) throw httpError('Tidak ada karyawan aktif (tanpa override individu) pada kombinasi jabatan dan departemen ini.');

  const eligibleIds = new Set(eligible.map(e => e.id));
  const invalid = employeeIds.filter(id => !eligibleIds.has(id));
  if (invalid.length) throw httpError('Sebagian karyawan terpilih tidak termasuk jabatan/departemen terpilih atau memiliki override individu.');

  const isFull = employeeIds.length === eligible.length;
  const batchId = require('crypto').randomUUID();

  return withTransaction(db, async client => {
    const created = [];
    if (isFull) {
      const pairs = new Map();
      eligible.forEach(e => {
        const key = `${e.position_id}|${e.department_id || ''}`;
        if (!pairs.has(key)) pairs.set(key, { position_id: e.position_id, department_id: e.department_id || null });
      });
      for (const pair of pairs.values()) {
        const rule = { target_type: 'BY_ROLE', ...pair, hours_per_day: hours, effective_from: from, notes, batch_id: batchId };
        await supersedeOverlapping(client, scope, user, rule, from);
        created.push(await insertStandard(client, scope, user, rule));
      }
    } else {
      for (const employeeId of employeeIds) {
        const rule = {
          target_type: 'BY_EMPLOYEE', employee_id: employeeId, hours_per_day: hours, effective_from: from,
          reason_code: PARTIAL_ROLE_REASON, notes, batch_id: batchId,
        };
        await supersedeOverlapping(client, scope, user, rule, from);
        created.push(await insertStandard(client, scope, user, rule));
      }
    }
    return { mode: isFull ? 'BY_ROLE' : 'BY_EMPLOYEE', batch_id: batchId, created_count: created.length, employee_count: employeeIds.length, rules: created };
  });
}

/** Override individu dari tab "Standar per karyawan". */
async function saveEmployeeOverrides(db, scope, user, input = {}) {
  const employeeIds = uniqueStrings(input.employee_ids);
  if (!employeeIds.length) throw httpError('Pilih minimal satu karyawan.');
  const hours = parseHours(input.hours_per_day);
  const from = input.effective_from;
  if (!isIsoDate(from)) throw httpError('Tanggal berlaku mulai wajib diisi (YYYY-MM-DD).');
  const to = input.effective_to || null;
  if (to && (!isIsoDate(to) || to < from)) throw httpError('Tanggal akhir override tidak valid.');
  const reason = String(input.reason_code || '').trim();
  if (!reason) throw httpError('Alasan wajib diisi untuk override individu.');
  if (!OVERRIDE_REASONS.includes(reason)) throw httpError('Alasan override tidak dikenal.');
  const notes = input.notes ? String(input.notes).slice(0, 1000) : null;

  await assertNotLocked(db, scope, from);
  const { rows } = await db.query(`SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role = 'karyawan' AND is_active = TRUE`, [employeeIds]);
  if (rows.length !== employeeIds.length) throw httpError('Sebagian karyawan tidak ditemukan atau tidak aktif.');

  const batchId = require('crypto').randomUUID();
  return withTransaction(db, async client => {
    const created = [];
    for (const employeeId of employeeIds) {
      const rule = { target_type: 'BY_EMPLOYEE', employee_id: employeeId, hours_per_day: hours, effective_from: from, effective_to: to, reason_code: reason, notes, batch_id: batchId };
      await supersedeOverlapping(client, scope, user, rule, from);
      created.push(await insertStandard(client, scope, user, rule));
    }
    return { mode: 'BY_EMPLOYEE', batch_id: batchId, created_count: created.length, rules: created };
  });
}

/** Akhiri aturan (mis. override individu) pada tanggal tertentu (default hari ini WIB). */
async function endWorkhourStandard(db, scope, user, id, input = {}) {
  const endDate = input.end_date || todayWib();
  if (!isIsoDate(endDate)) throw httpError('Tanggal akhir tidak valid.');
  await assertNotLocked(db, scope, addDays(endDate, 1));
  return withTransaction(db, async client => {
    const { rows } = await client.query(`
      SELECT *, effective_from::text AS effective_from_text FROM hse_workhour_standards
       WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND is_active AND deleted_at IS NULL
       FOR UPDATE
    `, [id, scope.tenantKey, scope.projectKey]);
    const old = rows[0];
    if (!old) throw httpError('Aturan tidak ditemukan atau sudah tidak aktif.', 404);
    const oldFrom = String(old.effective_from_text).slice(0, 10);
    let updated;
    if (endDate < oldFrom) {
      ({ rows: [updated] } = await client.query(`UPDATE hse_workhour_standards SET is_active = FALSE, updated_by = $2, updated_at = now() WHERE id = $1 RETURNING *`, [id, user?.id || null]));
    } else {
      ({ rows: [updated] } = await client.query(`UPDATE hse_workhour_standards SET effective_to = $2::date, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING *`, [id, endDate, user?.id || null]));
    }
    await audit(client, scope, { entity_type: 'STANDARD', entity_id: id, action: 'END', old_values: old, new_values: updated, reason: input.reason || 'Diakhiri dari Setup Master', changed_by: user?.id });
    return updated;
  });
}

async function listStandardHistory(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conds = ['s.tenant_key = $1', 's.project_key = $2', 's.deleted_at IS NULL'];
  if (query.position_id) { params.push(query.position_id); conds.push(`s.position_id = $${params.length}`); }
  if (query.employee_id) { params.push(query.employee_id); conds.push(`s.employee_id = $${params.length}`); }
  const { rows } = await db.query(`
    SELECT s.id, s.target_type, s.hours_per_day, s.effective_from::text AS effective_from, s.effective_to::text AS effective_to,
           s.reason_code, s.notes, s.is_active, s.created_at, u.nama AS created_by_name, wd.name AS department_name
      FROM hse_workhour_standards s
      LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN workforce_departments wd ON wd.id = s.department_id
     WHERE ${conds.join(' AND ')}
     ORDER BY s.effective_from DESC, s.created_at DESC
     LIMIT 100
  `, params);
  return rows.map(r => ({ ...r, hours_per_day: Number(r.hours_per_day) }));
}

// ---------------------------------------------------------------------------
// Periode bulanan: kirim ke jam kerja HSE (hse_manhours) & kunci
// ---------------------------------------------------------------------------
async function listWorkhourPeriods(db, scope, query = {}) {
  const today = todayWib();
  const count = Math.min(24, Math.max(1, Number(query.months) || 6));
  const keys = lastMonthKeys(today, count);
  const from = `${keys[keys.length - 1]}-01`;
  const [periodRes, live] = await Promise.all([
    db.query(`
      SELECT p.id, to_char(p.period_month, 'YYYY-MM') AS month_key, p.status, p.total_hours, p.employee_count,
             p.present_days, p.uncounted_days, p.sent_at, u.nama AS sent_by_name
        FROM hse_workhour_periods p
        LEFT JOIN users u ON u.id = p.sent_by
       WHERE p.tenant_key = $1 AND p.project_key = $2 AND p.status = 'LOCKED'
         AND p.period_month >= $3::date
    `, [scope.tenantKey, scope.projectKey, from]),
    fetchMonthlyLiveHours(db, scope, from, today),
  ]);
  const locked = new Map(periodRes.rows.map(r => [r.month_key, r]));
  const currentKey = today.slice(0, 7);
  return keys.map(k => {
    const l = locked.get(k);
    const lv = live.get(k) || { hours: 0, presentDays: 0, uncountedDays: 0, employeeCount: 0 };
    if (l) {
      return {
        month_key: k, label: monthLabel(k), status: 'LOCKED', period_id: l.id,
        total_hours: Number(l.total_hours) || 0, present_days: l.present_days, uncounted_days: l.uncounted_days,
        employee_count: l.employee_count, sent_at: l.sent_at, sent_by_name: l.sent_by_name || null,
      };
    }
    return {
      month_key: k, label: monthLabel(k),
      status: k === currentKey ? 'RUNNING' : (lv.presentDays > 0 ? 'READY' : 'EMPTY'),
      total_hours: round2(lv.hours), present_days: lv.presentDays, uncounted_days: lv.uncountedDays,
      employee_count: lv.employeeCount, sent_at: null, sent_by_name: null,
    };
  });
}

function groupByDepartment(items) {
  const map = new Map();
  items.forEach(it => {
    const dept = (it.departemen || '').trim() || 'Tanpa departemen';
    if (!map.has(dept)) map.set(dept, { department_name: dept, employee_count: 0, present_days: 0, counted_hours: 0, uncounted_days: 0 });
    const g = map.get(dept);
    if (it.present_days > 0) g.employee_count += 1;
    g.present_days += it.present_days;
    g.counted_hours = round2(g.counted_hours + it.counted_hours);
    g.uncounted_days += it.uncounted_days;
  });
  return Array.from(map.values()).sort((a, b) => a.department_name.localeCompare(b.department_name, 'id'));
}

async function getPeriodPreview(db, scope, month) {
  const start = normalizeMonth(month);
  const end = monthEnd(start);
  const today = todayWib();
  const inputs = await loadRecapInputs(db, scope, start, end);
  const recap = buildRecap({ ...inputs, from: start, to: end, today });
  const [lockRes, manualRes] = await Promise.all([
    db.query(`
      SELECT id FROM hse_workhour_periods
       WHERE tenant_key = $1 AND project_key = $2 AND period_month = $3::date AND status = 'LOCKED'
    `, [scope.tenantKey, scope.projectKey, start]),
    db.query(`
      SELECT COUNT(*)::int AS rows, COALESCE(SUM(hours), 0)::numeric(14,2) AS hours
        FROM hse_manhours m
       WHERE m.tenant_key = $1 AND m.project_key = $2 AND m.period_month = $3::date AND m.deleted_at IS NULL
         AND m.source = 'MANUAL' AND NOT ${contractorMatchSql('m')}
    `, [scope.tenantKey, scope.projectKey, start]),
  ]);
  const monthEnded = end < today;
  return {
    month_key: start.slice(0, 7),
    label: monthLabel(start.slice(0, 7)),
    from: start,
    to: end,
    locked: Boolean(lockRes.rows[0]),
    month_ended: monthEnded,
    can_send: monthEnded && !lockRes.rows[0] && recap.summary.present_days > 0,
    departments: groupByDepartment(recap.items.filter(i => i.present_days > 0)),
    summary: recap.summary,
    uncounted_employees: recap.items.filter(i => i.uncounted_days > 0)
      .map(i => ({ employee_id: i.employee_id, nama: i.nama, jabatan: i.jabatan, uncounted_days: i.uncounted_days })),
    replaced_manual: { rows: manualRes.rows[0]?.rows || 0, hours: Number(manualRes.rows[0]?.hours) || 0 },
  };
}

async function sendWorkhourPeriod(db, scope, user, month, input = {}) {
  const preview = await getPeriodPreview(db, scope, month);
  if (preview.locked) throw httpError(`Jam kerja ${preview.label} sudah dikirim dan terkunci.`, 409);
  if (!preview.month_ended) throw httpError(`Periode ${preview.label} belum berakhir. Pengiriman hanya untuk bulan yang sudah selesai.`, 422);
  if (preview.summary.present_days === 0) throw httpError(`Tidak ada data kehadiran pada ${preview.label}.`, 422);
  const note = input.note ? String(input.note).trim().slice(0, 1000) : '';
  if (preview.summary.uncounted_days > 0) {
    if (!input.acknowledge_uncounted) {
      throw httpError(`${preview.summary.uncounted_days} hari hadir dari ${preview.summary.uncounted_employees} karyawan belum punya standar jam kerja. Atur standarnya dulu, atau konfirmasi pengiriman dengan catatan.`, 422, { code: 'UNCOUNTED_DAYS', details: preview.uncounted_employees });
    }
    if (!note) throw httpError('Catatan wajib diisi bila mengirim dengan hari hadir yang belum terhitung.', 422);
  }

  const start = `${preview.month_key}-01`;
  const inputs = await loadRecapInputs(db, scope, start, monthEnd(start));
  const recap = buildRecap({ ...inputs, from: start, to: monthEnd(start), today: todayWib() });
  const lines = recap.items.filter(i => i.present_days > 0);
  const departments = groupByDepartment(lines);

  return withTransaction(db, async client => {
    let period;
    try {
      ({ rows: [period] } = await client.query(`
        INSERT INTO hse_workhour_periods (
          tenant_key, project_key, period_month, status, total_hours, employee_count, present_days, uncounted_days, uncounted_note, sent_by
        ) VALUES ($1, $2, $3::date, 'LOCKED', $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [scope.tenantKey, scope.projectKey, start, recap.summary.total_hours, lines.length,
        recap.summary.present_days, recap.summary.uncounted_days, note || null, user?.id || null]));
    } catch (err) {
      if (err.code === '23505') throw httpError(`Jam kerja ${preview.label} sudah dikirim dan terkunci.`, 409);
      throw err;
    }

    for (const it of lines) {
      await client.query(`
        INSERT INTO hse_workhour_period_lines (
          period_id, employee_id, employee_name, employee_no, position_name, department_name,
          present_days, counted_days, counted_hours, standard_breakdown
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [period.id, it.employee_id, it.nama, it.employee_no, it.jabatan, it.departemen,
        it.present_days, it.counted_days, it.counted_hours, JSON.stringify(it.breakdown)]);
    }

    // Jam kerja internal manual bulan ini digantikan (soft delete, jejak tetap ada)
    await client.query(`
      UPDATE hse_manhours m SET deleted_at = now(), updated_at = now()
       WHERE m.tenant_key = $1 AND m.project_key = $2 AND m.period_month = $3::date AND m.deleted_at IS NULL
         AND m.source = 'MANUAL' AND NOT ${contractorMatchSql('m')}
    `, [scope.tenantKey, scope.projectKey, start]);

    for (const d of departments) {
      await client.query(`
        INSERT INTO hse_manhours (
          tenant_key, project_key, period_month, company_name, department_name, hours, source, created_by, workhour_period_id
        ) VALUES ($1, $2, $3::date, $4, $5, $6, 'ATTENDANCE', $7, $8)
        ON CONFLICT (tenant_key, project_key, period_month, company_name, department_name) DO UPDATE SET
          hours = EXCLUDED.hours, source = 'ATTENDANCE', workhour_period_id = EXCLUDED.workhour_period_id,
          deleted_at = NULL, updated_at = now()
      `, [scope.tenantKey, scope.projectKey, start, INTERNAL_COMPANY, d.department_name, d.counted_hours, user?.id || null, period.id]);
    }

    await audit(client, scope, {
      entity_type: 'PERIOD', entity_id: period.id, action: 'LOCK',
      new_values: { month: preview.month_key, total_hours: recap.summary.total_hours, departments },
      reason: note || null, changed_by: user?.id,
    });
    return { period, departments, summary: recap.summary };
  });
}

async function reopenWorkhourPeriod(db, scope, user, periodId, input = {}) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) throw httpError('Alasan buka kunci wajib diisi (minimal 5 karakter).');
  return withTransaction(db, async client => {
    const { rows } = await client.query(`
      SELECT * FROM hse_workhour_periods
       WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND status = 'LOCKED'
       FOR UPDATE
    `, [periodId, scope.tenantKey, scope.projectKey]);
    const period = rows[0];
    if (!period) throw httpError('Periode terkunci tidak ditemukan.', 404);
    const { rows: [updated] } = await client.query(`
      UPDATE hse_workhour_periods
         SET status = 'REOPENED', reopened_by = $2, reopened_at = now(), reopen_reason = $3
       WHERE id = $1 RETURNING *
    `, [periodId, user?.id || null, reason]);
    await client.query(`
      UPDATE hse_manhours SET deleted_at = now(), updated_at = now()
       WHERE workhour_period_id = $1 AND deleted_at IS NULL
    `, [periodId]);
    await audit(client, scope, { entity_type: 'PERIOD', entity_id: periodId, action: 'REOPEN', old_values: period, new_values: updated, reason, changed_by: user?.id });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Integrasi statistik keselamatan: jam kerja per bulan untuk LTIFR/TRIR/SR
// ---------------------------------------------------------------------------
/**
 * Jam kerja per bulan (12 bulan s/d bulan berjalan):
 *  - FINAL       : periode terkunci → hse_manhours ATTENDANCE + kontraktor (MANUAL non-internal)
 *  - SEMENTARA   : bulan selesai belum dikirim → jam live presensi + kontraktor
 *  - BERJALAN    : bulan berjalan → jam live presensi s/d hari ini + kontraktor
 *  - MANUAL_LAMA : belum ada data presensi → input manual internal lama (yang diinput pengguna,
 *                  bukan seed migrasi 074) + kontraktor
 *  - KOSONG      : tidak ada jam kerja sama sekali (rasio tidak dihitung)
 */
async function getMonthlyManhours(db, scope, monthKeys) {
  const keys = [...monthKeys].sort();
  const from = `${keys[0]}-01`;
  const to = monthEnd(`${keys[keys.length - 1]}-01`);
  const today = todayWib();
  const [manRes, lockRes, live] = await Promise.all([
    db.query(`
      SELECT month_key,
             COALESCE(SUM(hours) FILTER (WHERE source = 'ATTENDANCE'), 0)::numeric(14,2) AS attendance_hours,
             COALESCE(SUM(hours) FILTER (WHERE source <> 'ATTENDANCE' AND NOT is_contractor), 0)::numeric(14,2) AS internal_manual_hours,
             COALESCE(SUM(hours) FILTER (WHERE source <> 'ATTENDANCE' AND is_contractor), 0)::numeric(14,2) AS contractor_hours
        FROM (
          SELECT to_char(m.period_month, 'YYYY-MM') AS month_key, m.hours, m.source,
                 ${contractorMatchSql('m')} AS is_contractor
            FROM hse_manhours m
           WHERE m.tenant_key = $1 AND m.project_key = $2 AND m.deleted_at IS NULL
             AND m.period_month BETWEEN $3::date AND $4::date
             -- Baris seed migrasi 074 (created_by NULL, nilai contoh) bukan input nyata: diabaikan.
             AND (m.source = 'ATTENDANCE' OR m.created_by IS NOT NULL OR ${contractorMatchSql('m')})
        ) x
       GROUP BY month_key
    `, [scope.tenantKey, scope.projectKey, from, to]),
    db.query(`
      SELECT to_char(period_month, 'YYYY-MM') AS month_key
        FROM hse_workhour_periods
       WHERE tenant_key = $1 AND project_key = $2 AND status = 'LOCKED'
         AND period_month BETWEEN $3::date AND $4::date
    `, [scope.tenantKey, scope.projectKey, from, to]).catch(err => {
      if (err.code === '42P01') return { rows: [] };
      throw err;
    }),
    fetchMonthlyLiveHours(db, scope, from, to > today ? today : to).catch(err => {
      if (err.code === '42P01') return new Map();
      throw err;
    }),
  ]);
  const man = new Map(manRes.rows.map(r => [r.month_key, r]));
  const locked = new Set(lockRes.rows.map(r => r.month_key));
  const currentKey = today.slice(0, 7);

  const out = new Map();
  for (const k of monthKeys) {
    const m = man.get(k) || {};
    const contractor = Number(m.contractor_hours) || 0;
    const lv = live.get(k) || { hours: 0, presentDays: 0, uncountedDays: 0 };
    let internal = 0;
    let status;
    if (locked.has(k)) {
      internal = Number(m.attendance_hours) || 0;
      status = 'FINAL';
    } else if (lv.presentDays > 0) {
      internal = lv.hours;
      status = k === currentKey ? 'BERJALAN' : 'SEMENTARA';
    } else if ((Number(m.internal_manual_hours) || 0) > 0) {
      internal = Number(m.internal_manual_hours) || 0;
      status = 'MANUAL_LAMA';
    } else {
      status = contractor > 0 ? (k === currentKey ? 'BERJALAN' : 'SEMENTARA') : 'KOSONG';
    }
    out.set(k, {
      hours: round2(internal + contractor),
      internalHours: round2(internal),
      contractorHours: round2(contractor),
      uncountedDays: locked.has(k) ? 0 : lv.uncountedDays,
      status,
    });
  }
  return out;
}

module.exports = {
  INTERNAL_COMPANY,
  NO_DEPT,
  OVERRIDE_REASONS,
  PARTIAL_ROLE_REASON,
  // util (diuji)
  todayWib,
  isIsoDate,
  addDays,
  monthStart,
  monthEnd,
  monthLabel,
  lastMonthKeys,
  isInternalCompany,
  contractorMatchSql,
  findContractorByName,
  frequencyRate,
  buildRecap,
  mapEmployeeToMaster,
  groupByDepartment,
  // data
  fetchLiveHoursTotal,
  fetchMonthlyLiveHours,
  getMonthlyManhours,
  getWorkhourSetup,
  getWorkhourRecap,
  getWorkhourRecapDetail,
  saveRoleStandards,
  saveEmployeeOverrides,
  endWorkhourStandard,
  listStandardHistory,
  listWorkhourPeriods,
  getPeriodPreview,
  sendWorkhourPeriod,
  reopenWorkhourPeriod,
};
