'use strict';

/**
 * OMOS Safety (APK HSE lapangan) — layanan backend.
 *
 * Prinsip:
 * - Identitas, departemen, dan hak akses selalu dibaca dari server (bukan dari klien).
 * - Setiap tulisan dari APK membawa `client_uuid` dan idempoten: kirim ulang tidak membuat data ganda.
 * - Tulisan per item dijalankan dalam transaksi sendiri; kegagalan satu item tidak menggagalkan item lain.
 * - Kode error stabil untuk antrean APK: VALIDATION, MASTER_INACTIVE, CONFLICT_CLOSED, CONFLICT_STATE,
 *   CONFLICT_PENDING, NO_DELEGATOR, FORBIDDEN, NOT_FOUND, RETRYABLE.
 * Keputusan owner: docs/OMOS_SAFETY_MOCKUP_REVISI_DASHBOARD_CONTEXT.md
 */

const hse = require('./hse');
const { compressHsePhotos } = require('./hsePhotoCompress');
const { getWibClock, selectShiftByClock, rosterStatusForShift, shiftDate } = require('./attendancePolicy');

// Batas tindak lanjut PIC per tingkat risiko (jam).
const SLA_HOURS = hse.HAZARD_SLA_HOURS;
const MAX_EXTENSIONS = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_TYPES = [
  'HAZARD_CREATE', 'HAZARD_CORRECT', 'HAZARD_CANCEL', 'HAZARD_NOTE',
  'ACTION_START', 'ACTION_EVIDENCE', 'VERIFY_DECISION',
  'PIC_REQUEST', 'DELEGATOR_DECISION', 'DELEGATOR_REASSIGN',
  'INCIDENT_CREATE', 'INSPECTION_CREATE', 'P5M_CREATE', 'SAFETYTALK_CREATE', 'MEETING_CREATE',
];
const STORAGE_POLICY = {
  photo_target_kb: 300,
  sent_photo_retention_days: 7,
  low_storage_mb: 1024,
  critical_storage_mb: 200,
  max_photos_when_critical: 1,
};

function mobileError(message, code = 'VALIDATION', statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = { code };
  return error;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function requireUuid(value, label) {
  if (!isUuid(value)) throw mobileError(`${label} tidak valid`);
  return value;
}

function cleanText(value, max = 4000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function wibDate(date = new Date()) {
  return getWibClock(date).date;
}

/** ISO waktu kejadian → { date, time } WIB untuk kolom report_date/report_time. */
function wibDateTime(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) throw mobileError('Waktu kejadian tidak valid');
  if (d.getTime() > Date.now() + 10 * 60 * 1000) throw mobileError('Waktu kejadian tidak boleh di masa depan');
  const clock = getWibClock(d);
  return { iso: d.toISOString(), date: clock.date, time: `${clock.display}:00` };
}

function dueAtFor(riskLevel, from = new Date()) {
  const hours = SLA_HOURS[riskLevel] || SLA_HOURS.LOW;
  return new Date(from.getTime() + hours * 3600 * 1000);
}

/** Akhir hari (23:59:59 WIB) untuk tanggal YYYY-MM-DD. */
function endOfWibDay(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) throw mobileError('Tanggal tidak valid');
  return new Date(`${isoDate}T23:59:59+07:00`);
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// Profil, peran, dan delegator
// ---------------------------------------------------------------

async function loadProfile(db, scope, userId) {
  const { rows } = await db.query(`
    SELECT u.id, u.nama, u.email, u.employee_id, u.jabatan, u.departemen, u.role,
           COALESCE(u.is_super_admin, FALSE) AS is_super_admin,
           wd.id AS department_id, wd.name AS department_name,
           wp.id AS position_id
    FROM users u
    LEFT JOIN workforce_departments wd
      ON lower(trim(wd.name)) = lower(trim(COALESCE(u.departemen, '')))
     AND wd.tenant_key = $2 AND wd.project_key = $3 AND wd.is_active
    LEFT JOIN workforce_positions wp
      ON lower(trim(wp.name)) = lower(trim(COALESCE(u.jabatan, '')))
     AND wp.is_active AND (wd.id IS NULL OR wp.department_id = wd.id)
    WHERE u.id = $1 AND u.is_active = TRUE
    LIMIT 1
  `, [userId, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) throw mobileError('Akun tidak aktif', 'FORBIDDEN', 403);
  return rows[0];
}

function isHseStaff(profile) {
  const dept = String(profile?.departemen || '').trim().toLowerCase();
  return dept.startsWith('hse') || dept === 'k3' || dept === 'safety';
}

function isAdmin(profile) {
  return profile?.role === 'admin' || profile?.is_super_admin === true;
}

async function delegatorDepartments(db, scope, userId, onDate = wibDate()) {
  const { rows } = await db.query(`
    SELECT d.department_id, wd.name AS department_name
    FROM hse_department_delegators d
    JOIN workforce_departments wd ON wd.id = d.department_id
    WHERE d.tenant_key = $1 AND d.project_key = $2 AND d.is_active
      AND (d.delegator_user_id = $3 OR d.backup_user_id = $3)
      AND d.valid_from <= $4::date AND (d.valid_to IS NULL OR d.valid_to >= $4::date)
    ORDER BY wd.name
  `, [scope.tenantKey, scope.projectKey, userId, onDate]);
  return rows;
}

async function delegatorsOf(db, scope, departmentId, onDate = wibDate()) {
  if (!departmentId) return null;
  const { rows } = await db.query(`
    SELECT d.delegator_user_id, d.backup_user_id, u.nama AS delegator_name
    FROM hse_department_delegators d
    JOIN users u ON u.id = d.delegator_user_id
    WHERE d.tenant_key = $1 AND d.project_key = $2 AND d.department_id = $3 AND d.is_active
      AND d.valid_from <= $4::date AND (d.valid_to IS NULL OR d.valid_to >= $4::date)
    LIMIT 1
  `, [scope.tenantKey, scope.projectKey, departmentId, onDate]);
  return rows[0] || null;
}

async function assertDelegatorOf(db, scope, userId, departmentId) {
  const depts = await delegatorDepartments(db, scope, userId);
  if (!depts.some(d => String(d.department_id) === String(departmentId))) {
    throw mobileError('Hanya Delegator departemen ini yang boleh memutuskan.', 'FORBIDDEN', 403);
  }
}

// ---------------------------------------------------------------
// Shift operasional & HSE on-duty (roster shift HSE)
// ---------------------------------------------------------------

async function shiftContext(db, now = new Date()) {
  const { rows: shifts } = await db.query(
    'SELECT id, nama_shift, operational_start, operational_end, lintas_hari FROM shifts ORDER BY operational_start'
  ).catch(() => ({ rows: [] }));
  const clock = getWibClock(now);
  const { shift, tanggalOperasional } = selectShiftByClock(shifts, clock);
  const operationalDate = tanggalOperasional || clock.date;
  let next = null;
  if (shift) {
    const isNight = Boolean(shift.lintas_hari) || rosterStatusForShift(shift) === 'M';
    const other = shifts.find(s => String(s.id) !== String(shift.id)
      && (isNight ? !(s.lintas_hari || rosterStatusForShift(s) === 'M') : (s.lintas_hari || rosterStatusForShift(s) === 'M')));
    if (other) next = { shift: other, operationalDate: isNight ? shiftDate(operationalDate, 1) : operationalDate };
  }
  return { shifts, clock, shift, operationalDate, next };
}

/** Cek tabel tanpa memicu error (aman dipakai di dalam transaksi). */
async function tableExists(db, name) {
  const { rows } = await db.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`]);
  return Boolean(rows[0]?.ok);
}

/** Query opsional di dalam transaksi: gagal tidak membatalkan transaksi induk. */
async function optionalInTx(db, sql, params) {
  await db.query('SAVEPOINT omos_optional');
  try {
    await db.query(sql, params);
    await db.query('RELEASE SAVEPOINT omos_optional');
  } catch (_) {
    await db.query('ROLLBACK TO SAVEPOINT omos_optional');
  }
}

async function hseOnDuty(db, operationalDate, shift) {
  const status = rosterStatusForShift(shift);
  if (!operationalDate || !status) return [];
  if (!(await tableExists(db, 'employee_roster_daily'))) return [];
  const withPhone = (await tableExists(db, 'workforce_employee_personal')) && (await tableExists(db, 'workforce_employee_profiles'));
  const base = `
    FROM employee_roster_daily rd
    JOIN users u ON u.id = rd.user_id AND u.is_active = TRUE
    WHERE rd.tanggal = $1::date AND rd.status = $2
      AND (lower(trim(COALESCE(u.departemen, ''))) LIKE 'hse%' OR lower(trim(COALESCE(u.departemen, ''))) IN ('k3', 'safety'))
    ORDER BY CASE WHEN u.jabatan ILIKE '%spv%' OR u.jabatan ILIKE '%supervisor%' THEN 0
                  WHEN u.jabatan ILIKE '%officer%' THEN 1 ELSE 2 END, u.nama`;
  const phoneCol = withPhone
    ? `(SELECT ps.phone FROM workforce_employee_profiles p
         JOIN workforce_employee_personal ps ON ps.employee_profile_id = p.id
        WHERE p.user_id = u.id LIMIT 1)`
    : 'NULL::text';
  const { rows } = await db.query(`SELECT u.id, u.nama, u.jabatan, ${phoneCol} AS phone ${base}`, [operationalDate, status]);
  return rows;
}

async function currentOnDutyIds(db) {
  const ctx = await shiftContext(db);
  const list = ctx.shift ? await hseOnDuty(db, ctx.operationalDate, ctx.shift) : [];
  return list.map(r => r.id);
}

// ---------------------------------------------------------------
// Notifikasi (polling) & timeline
// ---------------------------------------------------------------

async function notify(db, scope, userIds, n, excludeUserId = null) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean).map(String)))
    .filter(id => !excludeUserId || id !== String(excludeUserId));
  if (!ids.length) return 0;
  await db.query(`
    INSERT INTO hse_notifications (tenant_key, project_key, user_id, kind, title, body, ref_type, ref_id, is_urgent)
    SELECT $1, $2, x, $4, $5, $6, $7, $8, $9 FROM unnest($3::uuid[]) AS x
  `, [scope.tenantKey, scope.projectKey, ids, n.kind, n.title, n.body || null, n.ref_type || null, n.ref_id || null, Boolean(n.is_urgent)]);
  return ids.length;
}

async function addHazardEvent(db, scope, hazardId, { actionId = null, type, actor = null, note = null, data = {}, clientUuid = null }) {
  await db.query(`
    INSERT INTO hse_hazard_events (tenant_key, project_key, hazard_id, action_id, event_type, actor_id, actor_name, note, data, client_uuid)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
  `, [scope.tenantKey, scope.projectKey, hazardId, actionId, type, actor?.id || null, actor?.nama || null, note,
    JSON.stringify(data || {}), clientUuid]);
}

async function findEventByClientUuid(db, scope, clientUuid) {
  const { rows } = await db.query(`
    SELECT id, hazard_id, action_id, event_type FROM hse_hazard_events
    WHERE tenant_key = $1 AND project_key = $2 AND client_uuid = $3 LIMIT 1
  `, [scope.tenantKey, scope.projectKey, clientUuid]);
  return rows[0] || null;
}

// ---------------------------------------------------------------
// Master: lokasi, kategori, risiko
// ---------------------------------------------------------------

async function assertActiveLocation(db, scope, locationId) {
  requireUuid(locationId, 'Lokasi');
  const { rows } = await db.query(`
    SELECT id, name FROM hse_locations
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND is_active = TRUE AND deleted_at IS NULL
  `, [locationId, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) throw mobileError('Lokasi sudah dinonaktifkan admin. Pilih lokasi yang masih aktif lalu kirim ulang.', 'MASTER_INACTIVE');
  return rows[0];
}

async function resolveCategory(db, scope, code) {
  const wanted = code === 'UNSAFE_ACT' ? 'UNSAFE_ACT' : 'UNSAFE_CONDITION';
  const { rows } = await db.query(`
    SELECT id, label FROM hse_categories
    WHERE tenant_key = $1 AND project_key = $2 AND domain = 'HAZARD' AND code = $3 AND is_active = TRUE LIMIT 1
  `, [scope.tenantKey, scope.projectKey, wanted]);
  if (!rows[0]) throw mobileError('Kategori hazard belum disiapkan di Setup Master.', 'MASTER_INACTIVE');
  return rows[0];
}

async function assertActiveUsers(db, ids, label) {
  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(isUuid)));
  if (!list.length) return [];
  const { rows } = await db.query('SELECT id, nama, departemen FROM users WHERE id = ANY($1::uuid[]) AND is_active = TRUE', [list]);
  if (rows.length !== list.length) throw mobileError(`${label} tidak aktif atau tidak ditemukan. Pilih ulang.`, 'MASTER_INACTIVE');
  return rows;
}

function normalizePhotos(photos, { min = 0, max = 3 } = {}) {
  const list = (Array.isArray(photos) ? photos : []).filter(p => typeof p === 'string' && p.startsWith('data:image/'));
  if (list.length < min) throw mobileError(min === 1 ? 'Minimal 1 foto wajib dilampirkan.' : `Minimal ${min} foto wajib dilampirkan.`);
  if (list.length > max) throw mobileError(`Maksimal ${max} foto.`);
  return list;
}

// ---------------------------------------------------------------
// Bootstrap (data master offline)
// ---------------------------------------------------------------

async function getBootstrap(db, scope, userId) {
  const profile = await loadProfile(db, scope, userId);
  const today = wibDate();
  const [masters, delegatorOf, ctx, templates, contacts] = await Promise.all([
    hse.getMasters(db, scope),
    delegatorDepartments(db, scope, userId, today),
    shiftContext(db),
    db.query(`
      SELECT t.id, t.root_id, t.code, t.name, t.inspection_type, t.object_type, t.schedule_cycle,
             COALESCE(json_agg(json_build_object('id', i.id, 'question', i.question, 'is_critical', i.is_critical,
               'guidance', i.guidance, 'sort_order', i.sort_order) ORDER BY i.sort_order) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
      FROM hse_inspection_templates t
      LEFT JOIN hse_inspection_template_items i ON i.template_id = t.id
      WHERE t.tenant_key = $1 AND t.project_key = $2 AND t.is_active = TRUE AND t.deleted_at IS NULL
        AND COALESCE(t.is_current, TRUE) = TRUE
      GROUP BY t.id ORDER BY t.name
    `, [scope.tenantKey, scope.projectKey]).then(r => r.rows).catch(() => []),
    db.query(`
      SELECT category, name, phone_no, alternate_phone FROM hse_emergency_contacts
      WHERE tenant_key = $1 AND project_key = $2 AND is_active = TRUE AND deleted_at IS NULL
      ORDER BY CASE category WHEN 'INTERNAL' THEN 0 WHEN 'CLINIC' THEN 1 ELSE 2 END, name
    `, [scope.tenantKey, scope.projectKey]).then(r => r.rows).catch(() => []),
  ]);

  const [onDutyNow, onDutyNext] = await Promise.all([
    ctx.shift ? hseOnDuty(db, ctx.operationalDate, ctx.shift) : [],
    ctx.next ? hseOnDuty(db, ctx.next.operationalDate, ctx.next.shift) : [],
  ]);

  // Lokasi bertingkat Main Area → Sub Area.
  const areas = masters.locations.filter(l => !l.parent_id).map(a => ({
    id: a.id, name: a.name,
    subs: masters.locations.filter(s => String(s.parent_id) === String(a.id)).map(s => ({ id: s.id, name: s.name })),
  }));

  return {
    server_time: new Date().toISOString(),
    master_version: `${today}:${masters.locations.length}:${templates.length}`,
    me: {
      id: profile.id, nama: profile.nama, employee_id: profile.employee_id, jabatan: profile.jabatan,
      departemen: profile.departemen, department_id: profile.department_id, position_id: profile.position_id,
      is_hse: isHseStaff(profile), is_admin: isAdmin(profile),
      delegator_departments: delegatorOf,
    },
    shift: {
      current: ctx.shift ? { id: ctx.shift.id, name: ctx.shift.nama_shift, operational_date: ctx.operationalDate } : null,
      next: ctx.next ? { id: ctx.next.shift.id, name: ctx.next.shift.nama_shift, operational_date: ctx.next.operationalDate } : null,
      list: ctx.shifts.map(s => ({ id: s.id, name: s.nama_shift, start: s.operational_start, end: s.operational_end })),
    },
    hse_on_duty: { current: onDutyNow, next: onDutyNext },
    emergency_contacts: contacts,
    areas,
    categories: masters.categories.map(c => ({ id: c.id, label: c.label })),
    risk_matrix: masters.riskMatrix,
    sla_hours: SLA_HOURS,
    max_extensions: MAX_EXTENSIONS,
    departments: masters.departments,
    employees: masters.employees.map(e => ({ id: e.id, nama: e.nama, employee_id: e.employee_id, departemen: e.departemen, jabatan: e.jabatan })),
    inspection_templates: templates,
    storage_policy: STORAGE_POLICY,
    notification_poll_minutes: 15,
  };
}

// ---------------------------------------------------------------
// Hazard: buat, koreksi, batal, catatan
// ---------------------------------------------------------------

async function findHazardByClientUuid(db, scope, clientUuid) {
  const { rows } = await db.query(`
    SELECT id, report_no, status FROM hazard_reports
    WHERE tenant_key = $1 AND project_key = $2 AND client_uuid = $3 LIMIT 1
  `, [scope.tenantKey, scope.projectKey, clientUuid]);
  return rows[0] || null;
}

async function createHazardTx(db, scope, profile, clientUuid, p, { source = 'MOBILE' } = {}) {
  const existing = await findHazardByClientUuid(db, scope, clientUuid);
  if (existing) return { server_id: existing.id, server_no: existing.report_no, duplicate: true };

  const description = cleanText(p.description);
  if (!description) throw mobileError('Uraian temuan wajib diisi');
  const location = await assertActiveLocation(db, scope, p.location_id);
  const category = await resolveCategory(db, scope, p.category_code);
  const photos = normalizePhotos(p.photos, { min: 1, max: 3 });
  const pics = await assertActiveUsers(db, p.pic_ids, 'PIC');
  if (!pics.length) throw mobileError('Pilih minimal 1 PIC tindak lanjut');
  const when = wibDateTime(p.occurred_at);
  const risk = hse.calculateRisk(p.likelihood, p.consequence);
  const stopWork = Boolean(p.stop_work);
  const urgent = risk.riskLevel === 'EXTREME' || stopWork;

  // APK ≥ 1.0.1 mewajibkan konsekuensi & rekomendasi di form; antrean dari 1.0.0 (tanpa kolom ini) tetap diterima.
  const recommendation = cleanText(p.recommendation, 2000);
  const created = await hse.createHazard(db, scope, profile, {
    description,
    potential_consequence: cleanText(p.potential_consequence, 2000),
    recommendation,
    auto_capa: false, // CAPA dibuat di bawah: satu per PIC, batas sesuai SLA
    category_id: category.id,
    location_id: location.id,
    likelihood: risk.likelihood,
    consequence: risk.consequence,
    photos,
    report_date: when.date,
    report_time: when.time,
    assigned_to: pics[0].id,
  });

  await db.query(`
    UPDATE hazard_reports
    SET client_uuid = $1, source = $2, immediate_action = $3, stop_work = $4, is_urgent = $5, occurred_at = $6
    WHERE id = $7
  `, [clientUuid, source, cleanText(p.immediate_action), stopWork, urgent, when.iso, created.id]);

  const createdAt = new Date();
  const dueAt = dueAtFor(risk.riskLevel, createdAt);
  const actionDesc = recommendation || `Tindak lanjut hazard: ${description}`;
  for (const pic of pics) {
    const action = await hse.createAction(db, scope, profile, {
      source_type: 'HAZARD', source_id: created.id, description: actionDesc, action_type: 'CORRECTIVE',
      pic_employee_id: pic.id, due_date: wibDate(dueAt),
    });
    await db.query('UPDATE hse_actions SET due_at = $1 WHERE id = $2', [dueAt.toISOString(), action.id]);
  }

  await addHazardEvent(db, scope, created.id, {
    type: 'REPORTED', actor: profile,
    note: stopWork ? 'Stop Work dilaporkan' : null,
    data: { pic_ids: pics.map(x => x.id), risk_level: risk.riskLevel, source },
  });
  if (pics.length) {
    await addHazardEvent(db, scope, created.id, {
      type: 'ASSIGNED', actor: profile, note: `Ditugaskan ke ${pics.map(x => x.nama).join(', ')}`,
    });
  }

  await notify(db, scope, pics.map(x => x.id), {
    kind: 'HAZARD_ASSIGNED', title: `Hazard baru untuk Anda · ${created.report_no}`,
    body: `${description.slice(0, 120)} · batas ${wibDate(dueAt)}`, ref_type: 'HAZARD', ref_id: created.id, is_urgent: urgent,
  }, profile.id);
  if (urgent) {
    await notify(db, scope, await currentOnDutyIds(db), {
      kind: 'HAZARD_URGENT', title: `DARURAT · ${stopWork ? 'Stop Work' : 'Risiko Ekstrem'} · ${created.report_no}`,
      body: `${location.name}: ${description.slice(0, 120)}`, ref_type: 'HAZARD', ref_id: created.id, is_urgent: true,
    }, profile.id);
  }

  return { server_id: created.id, server_no: created.report_no, created };
}

async function loadHazardForUpdate(db, scope, hazardId) {
  requireUuid(hazardId, 'Hazard');
  const { rows } = await db.query(`
    SELECT * FROM hazard_reports
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
    FOR UPDATE
  `, [hazardId, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) throw mobileError('Laporan hazard tidak ditemukan', 'NOT_FOUND', 404);
  return rows[0];
}

async function hazardActions(db, hazardId) {
  const { rows } = await db.query(`
    SELECT * FROM hse_actions WHERE source_type = 'HAZARD' AND source_id = $1 AND deleted_at IS NULL ORDER BY created_at
  `, [hazardId]);
  return rows;
}

/** Koreksi/batal hanya oleh pelapor, sebelum HSE triase/PIC mulai, laporan belum digabung. */
function canReporterEdit(hazard, actions, userId) {
  if (String(hazard.reported_by) !== String(userId)) return false;
  if (hazard.status !== 'NEW' || hazard.merged_into_id) return false;
  return actions.every(a => a.status === 'OPEN' && !a.started_at);
}

async function correctHazardTx(db, scope, profile, clientUuid, p) {
  if (await findEventByClientUuid(db, scope, clientUuid)) return { duplicate: true };
  const hazard = await loadHazardForUpdate(db, scope, p.hazard_id);
  const actions = await hazardActions(db, hazard.id);
  if (!canReporterEdit(hazard, actions, profile.id)) {
    throw mobileError('Laporan sudah diproses, koreksi tidak bisa lagi. Kirim tambahan informasi lewat catatan ke HSE.', 'CONFLICT_STATE', 409);
  }
  const f = p.fields || {};
  const next = {};
  if (f.description !== undefined) {
    next.description = cleanText(f.description);
    if (!next.description) throw mobileError('Uraian temuan wajib diisi');
  }
  if (f.location_id !== undefined) {
    const loc = await assertActiveLocation(db, scope, f.location_id);
    next.location_id = loc.id;
    next.location_name = loc.name;
  }
  if (f.category_code !== undefined) {
    const cat = await resolveCategory(db, scope, f.category_code);
    next.category_id = cat.id;
    next.category_name = cat.label;
  }
  if (f.potential_consequence !== undefined) {
    next.potential_consequence = cleanText(f.potential_consequence, 2000);
    if (!next.potential_consequence) throw mobileError('Konsekuensi / potensi dampak wajib diisi');
  }
  if (f.recommendation !== undefined) {
    next.recommendation = cleanText(f.recommendation, 2000);
    if (!next.recommendation) throw mobileError('Rekomendasi perbaikan wajib diisi');
  }
  if (f.immediate_action !== undefined) next.immediate_action = cleanText(f.immediate_action);
  if (f.stop_work !== undefined) next.stop_work = Boolean(f.stop_work);
  if (f.occurred_at !== undefined) {
    const when = wibDateTime(f.occurred_at);
    next.occurred_at = when.iso;
    next.report_date = when.date;
    next.report_time = when.time;
  }
  if (f.likelihood !== undefined || f.consequence !== undefined) {
    const risk = hse.calculateRisk(f.likelihood ?? hazard.likelihood, f.consequence ?? hazard.consequence);
    Object.assign(next, { likelihood: risk.likelihood, consequence: risk.consequence, risk_score: risk.riskScore, risk_level: risk.riskLevel });
  }
  if (f.photos !== undefined) next.photos = await compressHsePhotos(normalizePhotos(f.photos, { min: 1, max: 3 }));
  const fields = Object.keys(next);
  if (!fields.length) throw mobileError('Tidak ada perubahan untuk disimpan');

  const revisionNo = Number(hazard.revision_no || 0) + 1;
  const snapshot = { ...hazard };
  delete snapshot.photos; // foto lama tetap di revisi sebagai jumlah agar snapshot ringan
  snapshot.photo_count = Array.isArray(hazard.photos) ? hazard.photos.length : 0;
  await db.query(`
    INSERT INTO hse_hazard_revisions (tenant_key, project_key, hazard_id, revision_no, snapshot, changed_fields, changed_by)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
  `, [scope.tenantKey, scope.projectKey, hazard.id, revisionNo, JSON.stringify(snapshot), fields, profile.id]);

  const stopWork = next.stop_work ?? hazard.stop_work;
  const riskLevel = next.risk_level || hazard.risk_level;
  next.is_urgent = riskLevel === 'EXTREME' || Boolean(stopWork);
  next.revision_no = revisionNo;
  const cols = Object.keys(next);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  await db.query(`UPDATE hazard_reports SET ${sets.join(', ')}, updated_at = now() WHERE id = $${cols.length + 1}`,
    [...cols.map(c => next[c]), hazard.id]);

  if (next.risk_level && next.risk_level !== hazard.risk_level) {
    const dueAt = dueAtFor(next.risk_level, new Date(hazard.created_at));
    await db.query(`UPDATE hse_actions SET due_at = $1, due_date = $2, updated_at = now()
                    WHERE source_type = 'HAZARD' AND source_id = $3 AND status = 'OPEN'`, [dueAt.toISOString(), wibDate(dueAt), hazard.id]);
  }
  if (next.recommendation && next.recommendation !== hazard.recommendation) {
    // Koreksi hanya boleh sebelum PIC mulai → seluruh CAPA masih OPEN, ikut rekomendasi baru.
    await db.query(`UPDATE hse_actions SET description = $1, updated_at = now()
                    WHERE source_type = 'HAZARD' AND source_id = $2 AND status = 'OPEN' AND started_at IS NULL`,
    [next.recommendation, hazard.id]);
  }
  await addHazardEvent(db, scope, hazard.id, {
    type: 'CORRECTED', actor: profile, note: `Revisi ${revisionNo}: ${fields.join(', ')}`, data: { fields }, clientUuid,
  });
  return { server_id: hazard.id, server_no: hazard.report_no, revision_no: revisionNo };
}

async function cancelHazardTx(db, scope, profile, clientUuid, p) {
  if (await findEventByClientUuid(db, scope, clientUuid)) return { duplicate: true };
  const reason = cleanText(p.reason, 500);
  if (!reason) throw mobileError('Alasan pembatalan wajib diisi');
  const hazard = await loadHazardForUpdate(db, scope, p.hazard_id);
  if (hazard.status === 'CANCELLED') return { server_id: hazard.id, server_no: hazard.report_no };
  const actions = await hazardActions(db, hazard.id);
  if (!canReporterEdit(hazard, actions, profile.id)) {
    throw mobileError('Laporan sudah diproses, tidak bisa dibatalkan lagi.', 'CONFLICT_STATE', 409);
  }
  await db.query(`
    UPDATE hazard_reports SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $1, cancel_reason = $2, updated_at = now()
    WHERE id = $3
  `, [profile.id, reason, hazard.id]);
  await db.query(`
    UPDATE hse_actions SET status = 'CANCELLED', notes = COALESCE(notes || E'\\n', '') || $1, updated_at = now()
    WHERE source_type = 'HAZARD' AND source_id = $2 AND status NOT IN ('CLOSED', 'CANCELLED')
  `, [`Dibatalkan pelapor: ${reason}`, hazard.id]);
  await addHazardEvent(db, scope, hazard.id, { type: 'CANCELLED', actor: profile, note: reason, clientUuid });
  await notify(db, scope, actions.map(a => a.pic_employee_id), {
    kind: 'HAZARD_CANCELLED', title: `Laporan dibatalkan pelapor · ${hazard.report_no}`, body: reason, ref_type: 'HAZARD', ref_id: hazard.id,
  }, profile.id);
  return { server_id: hazard.id, server_no: hazard.report_no };
}

async function assertHazardParticipant(db, scope, profile, hazard, actions) {
  if (isAdmin(profile) || isHseStaff(profile)) return;
  if (String(hazard.reported_by) === String(profile.id)) return;
  if (actions.some(a => String(a.pic_employee_id) === String(profile.id))) return;
  const depts = await delegatorDepartments(db, scope, profile.id);
  if (depts.length) {
    const picDepts = await picDepartmentIds(db, scope, actions.map(a => a.pic_employee_id));
    if (depts.some(d => picDepts.includes(String(d.department_id)))) return;
  }
  throw mobileError('Anda tidak terlibat pada laporan ini.', 'FORBIDDEN', 403);
}

async function picDepartmentIds(db, scope, userIds) {
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return [];
  const { rows } = await db.query(`
    SELECT DISTINCT wd.id FROM users u
    JOIN workforce_departments wd ON lower(trim(wd.name)) = lower(trim(COALESCE(u.departemen, '')))
     AND wd.tenant_key = $2 AND wd.project_key = $3
    WHERE u.id = ANY($1::uuid[])
  `, [ids, scope.tenantKey, scope.projectKey]);
  return rows.map(r => String(r.id));
}

async function hazardNoteTx(db, scope, profile, clientUuid, p) {
  if (await findEventByClientUuid(db, scope, clientUuid)) return { duplicate: true };
  const note = cleanText(p.note, 2000);
  if (!note) throw mobileError('Catatan wajib diisi');
  const hazard = await loadHazardForUpdate(db, scope, p.hazard_id);
  const actions = await hazardActions(db, hazard.id);
  await assertHazardParticipant(db, scope, profile, hazard, actions);
  const photos = await compressHsePhotos(normalizePhotos(p.photos, { min: 0, max: 3 }));
  await addHazardEvent(db, scope, hazard.id, { type: 'NOTE', actor: profile, note, data: { photos }, clientUuid });
  return { server_id: hazard.id, server_no: hazard.report_no };
}

// ---------------------------------------------------------------
// Tindak lanjut PIC & verifikasi
// ---------------------------------------------------------------

async function loadActionForUpdate(db, scope, actionId) {
  requireUuid(actionId, 'Tindak lanjut');
  const { rows } = await db.query(`
    SELECT a.*, h.id AS hazard_id, h.report_no, h.reported_by, h.status AS hazard_status, h.risk_level, h.description AS hazard_description
    FROM hse_actions a
    JOIN hazard_reports h ON h.id = a.source_id AND a.source_type = 'HAZARD'
    WHERE a.id = $1 AND a.tenant_key = $2 AND a.project_key = $3 AND a.deleted_at IS NULL AND h.deleted_at IS NULL
    FOR UPDATE OF a
  `, [actionId, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) throw mobileError('Tindak lanjut tidak ditemukan', 'NOT_FOUND', 404);
  return rows[0];
}

function assertIsPic(action, profile) {
  if (String(action.pic_employee_id) !== String(profile.id)) {
    throw mobileError('Anda bukan PIC tindak lanjut ini (mungkin sudah dialihkan).', 'FORBIDDEN', 403);
  }
}

function assertActionOpen(action) {
  if (['CLOSED', 'CANCELLED'].includes(action.status) || ['CLOSED', 'CANCELLED', 'DUPLICATE'].includes(action.hazard_status)) {
    throw mobileError('Hazard ini sudah ditutup/dibatalkan sebelum data Anda terkirim. Data tidak bisa lagi mengubah status.', 'CONFLICT_CLOSED', 409);
  }
}

/** Status hazard mengikuti progres CAPA — aturan tunggal di hse.syncHazardStatusFromActions (dipakai juga dashboard). */
function syncHazardStatus(db, hazardId, profile) {
  return hse.syncHazardStatusFromActions(db, hazardId, profile);
}

async function startActionTx(db, scope, profile, clientUuid, p) {
  const action = await loadActionForUpdate(db, scope, p.action_id);
  assertIsPic(action, profile);
  assertActionOpen(action);
  if (action.status !== 'OPEN') return { server_id: action.id, record_status: action.status };
  await db.query(`UPDATE hse_actions SET status = 'IN_PROGRESS', started_at = now(), updated_at = now() WHERE id = $1`, [action.id]);
  await syncHazardStatus(db, action.hazard_id, profile);
  await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'STARTED', actor: profile, note: `${profile.nama} mulai tindak lanjut`, clientUuid });
  await notify(db, scope, [action.reported_by], {
    kind: 'ACTION_STARTED', title: `Laporan Anda mulai ditindaklanjuti · ${action.report_no}`, body: `PIC ${profile.nama}`, ref_type: 'HAZARD', ref_id: action.hazard_id,
  }, profile.id);
  return { server_id: action.id, record_status: 'IN_PROGRESS' };
}

async function submitEvidenceTx(db, scope, profile, clientUuid, p) {
  if (await findEventByClientUuid(db, scope, clientUuid)) return { duplicate: true };
  const action = await loadActionForUpdate(db, scope, p.action_id);
  assertIsPic(action, profile);
  assertActionOpen(action);
  if (action.status === 'DONE_PENDING_VERIFY') {
    throw mobileError('Bukti sudah terkirim dan menunggu verifikasi.', 'CONFLICT_STATE', 409);
  }
  const photos = await compressHsePhotos(normalizePhotos(p.photos, { min: 1, max: 3 }));
  const note = cleanText(p.note, 2000);
  await db.query(`
    UPDATE hse_actions SET status = 'DONE_PENDING_VERIFY', evidence_url = $1, evidence_note = $2,
      started_at = COALESCE(started_at, now()), completed_at = now(), rejected_at = NULL, updated_at = now()
    WHERE id = $3
  `, [photos, note, action.id]);
  const hazardStatus = await syncHazardStatus(db, action.hazard_id, profile);
  await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'EVIDENCE_SUBMITTED', actor: profile, note, clientUuid });
  await notify(db, scope, [action.reported_by, ...(await currentOnDutyIds(db))], {
    kind: 'VERIFY_NEEDED', title: `Bukti perbaikan menunggu verifikasi · ${action.report_no}`, body: `PIC ${profile.nama}`,
    ref_type: 'HAZARD', ref_id: action.hazard_id,
  }, profile.id);
  return { server_id: action.id, record_status: 'DONE_PENDING_VERIFY', hazard_status: hazardStatus };
}

async function verifyDecisionTx(db, scope, profile, clientUuid, p) {
  if (await findEventByClientUuid(db, scope, clientUuid)) return { duplicate: true };
  const action = await loadActionForUpdate(db, scope, p.action_id);
  const isReporter = String(action.reported_by) === String(profile.id);
  if (!isReporter && !isHseStaff(profile) && !isAdmin(profile)) {
    throw mobileError('Verifikasi hanya oleh pelapor atau HSE.', 'FORBIDDEN', 403);
  }
  if (String(action.pic_employee_id) === String(profile.id) && !isHseStaff(profile)) {
    throw mobileError('PIC tidak boleh memverifikasi pekerjaannya sendiri.', 'FORBIDDEN', 403);
  }
  assertActionOpen(action);
  if (action.status !== 'DONE_PENDING_VERIFY') throw mobileError('Belum ada bukti yang menunggu verifikasi.', 'CONFLICT_STATE', 409);

  const decision = String(p.decision || '').toUpperCase();
  if (decision === 'APPROVE') {
    await db.query(`UPDATE hse_actions SET status = 'CLOSED', verified_by = $1, verified_at = now(), updated_at = now() WHERE id = $2`, [profile.id, action.id]);
    const status = await syncHazardStatus(db, action.hazard_id, profile);
    await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'VERIFIED', actor: profile, note: cleanText(p.reason, 500), clientUuid });
    await notify(db, scope, [action.pic_employee_id, action.reported_by], {
      kind: 'ACTION_CLOSED', title: `Tindak lanjut disetujui · ${action.report_no}`, body: `Diverifikasi ${profile.nama}`, ref_type: 'HAZARD', ref_id: action.hazard_id,
    }, profile.id);
    return { server_id: action.id, record_status: 'CLOSED', hazard_status: status };
  }
  if (decision === 'REJECT') {
    const reason = cleanText(p.reason, 1000);
    if (!reason) throw mobileError('Alasan penolakan wajib diisi');
    await db.query(`
      UPDATE hse_actions SET status = 'IN_PROGRESS', rejected_at = now(), rejected_reason = $1, completed_at = NULL, updated_at = now()
      WHERE id = $2
    `, [reason, action.id]);
    const status = await syncHazardStatus(db, action.hazard_id, profile);
    await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'REJECTED', actor: profile, note: reason, clientUuid });
    await notify(db, scope, [action.pic_employee_id], {
      kind: 'ACTION_REJECTED', title: `Bukti ditolak, perlu perbaikan · ${action.report_no}`, body: reason, ref_type: 'HAZARD', ref_id: action.hazard_id,
    }, profile.id);
    return { server_id: action.id, record_status: 'IN_PROGRESS', hazard_status: status };
  }
  throw mobileError('Keputusan verifikasi tidak dikenal');
}

// ---------------------------------------------------------------
// Permintaan PIC → Delegator Departemen
// ---------------------------------------------------------------

async function picRequestTx(db, scope, profile, clientUuid, p) {
  const existing = await db.query(`SELECT id, status FROM hse_pic_requests WHERE tenant_key = $1 AND project_key = $2 AND client_uuid = $3`,
    [scope.tenantKey, scope.projectKey, clientUuid]);
  if (existing.rows[0]) return { server_id: existing.rows[0].id, record_status: existing.rows[0].status, duplicate: true };

  const action = await loadActionForUpdate(db, scope, p.action_id);
  assertIsPic(action, profile);
  assertActionOpen(action);
  const type = String(p.request_type || '').toUpperCase();
  if (!['REASSIGN', 'EXTEND'].includes(type)) throw mobileError('Jenis permintaan tidak dikenal');
  const reason = cleanText(p.reason, 1000);
  if (!reason) throw mobileError('Alasan wajib diisi');
  if (!profile.department_id) throw mobileError('Departemen Anda belum terdaftar di master departemen. Hubungi Admin HSE.', 'NO_DELEGATOR');
  const delegator = await delegatorsOf(db, scope, profile.department_id);
  if (!delegator) throw mobileError(`Departemen ${profile.departemen} belum punya Delegator. Hubungi Admin HSE.`, 'NO_DELEGATOR');

  let proposedDue = null;
  let proposedDept = null;
  if (type === 'EXTEND') {
    if (action.risk_level === 'EXTREME') throw mobileError('Hazard risiko Ekstrem tidak bisa diperpanjang.', 'VALIDATION');
    if (Number(action.extension_count || 0) >= MAX_EXTENSIONS) throw mobileError('Batas waktu sudah pernah diperpanjang (maksimal 1 kali).', 'VALIDATION');
    proposedDue = String(p.proposed_due_date || '');
    const due = endOfWibDay(proposedDue);
    const current = action.due_at ? new Date(action.due_at) : endOfWibDay(String(action.due_date).slice(0, 10));
    if (due <= current) throw mobileError('Usulan batas baru harus setelah batas saat ini.');
  } else if (p.proposed_department_id) {
    proposedDept = requireUuid(p.proposed_department_id, 'Departemen tujuan');
  }

  let inserted;
  try {
    inserted = await db.query(`
      INSERT INTO hse_pic_requests (tenant_key, project_key, client_uuid, hazard_id, action_id, requester_id, department_id,
        request_type, reason, proposed_department_id, proposed_due_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
    `, [scope.tenantKey, scope.projectKey, clientUuid, action.hazard_id, action.id, profile.id, profile.department_id,
      type, reason, proposedDept, proposedDue]);
  } catch (error) {
    if (error.code === '23505') throw mobileError('Masih ada permintaan yang menunggu keputusan delegator.', 'CONFLICT_PENDING', 409);
    throw error;
  }
  await addHazardEvent(db, scope, action.hazard_id, {
    actionId: action.id, type: type === 'EXTEND' ? 'EXTEND_REQUESTED' : 'REASSIGN_REQUESTED', actor: profile, note: reason,
    data: { proposed_due_date: proposedDue, proposed_department_id: proposedDept },
  });
  await notify(db, scope, [delegator.delegator_user_id, delegator.backup_user_id], {
    kind: 'PIC_REQUEST', title: `${type === 'EXTEND' ? 'Minta perpanjangan' : 'Minta dialihkan'} · ${action.report_no}`,
    body: `${profile.nama}: ${reason.slice(0, 120)}`, ref_type: 'PIC_REQUEST', ref_id: inserted.rows[0].id,
  }, profile.id);
  return { server_id: inserted.rows[0].id, record_status: 'PENDING', delegator_name: delegator.delegator_name };
}

async function assertSameDepartment(db, scope, userId, departmentId) {
  const depts = await picDepartmentIds(db, scope, [userId]);
  if (!depts.includes(String(departmentId))) throw mobileError('PIC baru harus karyawan aktif di departemen ini.', 'VALIDATION');
}

async function reassignAction(db, scope, profile, action, newPicId, note) {
  const [newPic] = await assertActiveUsers(db, [requireUuid(newPicId, 'PIC baru')], 'PIC baru');
  if (String(newPic.id) === String(action.pic_employee_id)) throw mobileError('PIC baru sama dengan PIC saat ini.');
  await db.query(`UPDATE hse_actions SET pic_employee_id = $1, pic_name = $2, status = CASE WHEN status = 'OPEN' THEN 'OPEN' ELSE 'IN_PROGRESS' END,
                  updated_at = now() WHERE id = $3`, [newPic.id, newPic.nama, action.id]);
  await db.query(`UPDATE hazard_reports SET assigned_to = $1, assigned_to_name = $2, updated_at = now()
                  WHERE id = $3 AND assigned_to = $4`, [newPic.id, newPic.nama, action.hazard_id, action.pic_employee_id]);
  await addHazardEvent(db, scope, action.hazard_id, {
    actionId: action.id, type: 'REASSIGNED', actor: profile, note: note || `Dialihkan ke ${newPic.nama}`,
    data: { from: action.pic_employee_id, to: newPic.id },
  });
  await notify(db, scope, [newPic.id], {
    kind: 'HAZARD_ASSIGNED', title: `Hazard dialihkan ke Anda · ${action.report_no}`, body: (action.hazard_description || '').slice(0, 120),
    ref_type: 'HAZARD', ref_id: action.hazard_id, is_urgent: action.risk_level === 'EXTREME',
  });
  await notify(db, scope, [action.pic_employee_id, action.reported_by], {
    kind: 'PIC_CHANGED', title: `PIC diganti · ${action.report_no}`, body: `PIC baru: ${newPic.nama}`, ref_type: 'HAZARD', ref_id: action.hazard_id,
  }, profile.id);
  return newPic;
}

async function delegatorDecisionTx(db, scope, profile, clientUuid, p) {
  if (await findEventByClientUuid(db, scope, clientUuid)) return { duplicate: true };
  const requestId = requireUuid(p.request_id, 'Permintaan');
  const { rows } = await db.query(`SELECT * FROM hse_pic_requests WHERE id = $1 AND tenant_key = $2 AND project_key = $3 FOR UPDATE`,
    [requestId, scope.tenantKey, scope.projectKey]);
  const request = rows[0];
  if (!request) throw mobileError('Permintaan tidak ditemukan', 'NOT_FOUND', 404);
  await assertDelegatorOf(db, scope, profile.id, request.department_id);
  if (request.status !== 'PENDING') throw mobileError('Permintaan ini sudah diputuskan.', 'CONFLICT_STATE', 409);
  const action = await loadActionForUpdate(db, scope, request.action_id);
  assertActionOpen(action);

  const decision = String(p.decision || '').toUpperCase();
  const note = cleanText(p.note, 1000);
  const finish = (status, extra = {}) => db.query(`
    UPDATE hse_pic_requests SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3,
      new_pic_id = $4, forwarded_department_id = $5, approved_due_date = $6, updated_at = now()
    WHERE id = $7
  `, [status, profile.id, note, extra.newPicId || null, extra.forwardDept || null, extra.dueDate || null, request.id]);

  if (decision === 'REJECT') {
    if (!note) throw mobileError('Alasan penolakan wajib diisi');
    await finish('REJECTED');
    await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'REQUEST_REJECTED', actor: profile, note, clientUuid });
    await notify(db, scope, [request.requester_id], {
      kind: 'PIC_REQUEST_DECIDED', title: `Permintaan ditolak delegator · ${action.report_no}`, body: note, ref_type: 'HAZARD', ref_id: action.hazard_id,
    });
    return { server_id: request.id, record_status: 'REJECTED' };
  }

  if (request.request_type === 'EXTEND' && decision === 'APPROVE') {
    if (action.risk_level === 'EXTREME') throw mobileError('Hazard risiko Ekstrem tidak bisa diperpanjang.');
    if (Number(action.extension_count || 0) >= MAX_EXTENSIONS) throw mobileError('Batas waktu sudah pernah diperpanjang (maksimal 1 kali).');
    const dueDate = String(p.approved_due_date || (request.proposed_due_date ? wibDate(new Date(request.proposed_due_date)) : '') || '').slice(0, 10);
    const dueAt = endOfWibDay(dueDate);
    await db.query(`UPDATE hse_actions SET due_at = $1, due_date = $2, extension_count = extension_count + 1, escalated_at = NULL, updated_at = now() WHERE id = $3`,
      [dueAt.toISOString(), dueDate, action.id]);
    await finish('APPROVED', { dueDate });
    await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'EXTENDED', actor: profile, note: note || `Batas baru ${dueDate}`, clientUuid });
    await notify(db, scope, [request.requester_id, action.reported_by], {
      kind: 'PIC_REQUEST_DECIDED', title: `Perpanjangan disetujui · ${action.report_no}`, body: `Batas baru ${dueDate}`, ref_type: 'HAZARD', ref_id: action.hazard_id,
    }, profile.id);
    return { server_id: request.id, record_status: 'APPROVED', due_date: dueDate };
  }

  if (request.request_type === 'REASSIGN' && decision === 'APPROVE') {
    await assertSameDepartment(db, scope, p.new_pic_id, request.department_id);
    const newPic = await reassignAction(db, scope, profile, action, p.new_pic_id, note);
    await finish('APPROVED', { newPicId: newPic.id });
    await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'REQUEST_APPROVED', actor: profile, note, clientUuid });
    return { server_id: request.id, record_status: 'APPROVED', new_pic_id: newPic.id };
  }

  if (request.request_type === 'REASSIGN' && decision === 'FORWARD') {
    const targetDept = requireUuid(p.forward_department_id, 'Departemen tujuan');
    if (String(targetDept) === String(request.department_id)) throw mobileError('Departemen tujuan sama dengan departemen saat ini.');
    const target = await delegatorsOf(db, scope, targetDept);
    if (!target) throw mobileError('Departemen tujuan belum punya Delegator.', 'NO_DELEGATOR');
    await finish('FORWARDED', { forwardDept: targetDept });
    const fwd = await db.query(`
      INSERT INTO hse_pic_requests (tenant_key, project_key, hazard_id, action_id, requester_id, department_id, request_type, reason)
      VALUES ($1, $2, $3, $4, $5, $6, 'REASSIGN', $7) RETURNING id
    `, [scope.tenantKey, scope.projectKey, action.hazard_id, action.id, request.requester_id, targetDept,
      `Diteruskan oleh ${profile.nama}: ${request.reason}${note ? ` · ${note}` : ''}`]);
    await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'REQUEST_FORWARDED', actor: profile, note, data: { to_department_id: targetDept }, clientUuid });
    await notify(db, scope, [target.delegator_user_id, target.backup_user_id], {
      kind: 'PIC_REQUEST', title: `Pengalihan diteruskan ke departemen Anda · ${action.report_no}`, body: request.reason.slice(0, 120),
      ref_type: 'PIC_REQUEST', ref_id: fwd.rows[0].id,
    }, profile.id);
    return { server_id: request.id, record_status: 'FORWARDED', forwarded_request_id: fwd.rows[0].id };
  }
  throw mobileError('Keputusan tidak sesuai jenis permintaan');
}

/** Delegator mengalihkan langsung tindak lanjut yang macet/lewat batas di departemennya. */
async function delegatorReassignTx(db, scope, profile, clientUuid, p) {
  if (await findEventByClientUuid(db, scope, clientUuid)) return { duplicate: true };
  const action = await loadActionForUpdate(db, scope, p.action_id);
  assertActionOpen(action);
  const [picDept] = await picDepartmentIds(db, scope, [action.pic_employee_id]);
  if (!picDept) throw mobileError('Departemen PIC tidak dikenali.', 'VALIDATION');
  await assertDelegatorOf(db, scope, profile.id, picDept);
  await assertSameDepartment(db, scope, p.new_pic_id, picDept);
  const newPic = await reassignAction(db, scope, profile, action, p.new_pic_id, cleanText(p.note, 1000));
  await db.query(`UPDATE hse_pic_requests SET status = 'CANCELLED', decision_note = 'Dialihkan langsung oleh delegator', updated_at = now()
                  WHERE action_id = $1 AND status = 'PENDING'`, [action.id]);
  await addHazardEvent(db, scope, action.hazard_id, { actionId: action.id, type: 'DELEGATOR_REASSIGNED', actor: profile, clientUuid });
  return { server_id: action.id, new_pic_id: newPic.id };
}

// ---------------------------------------------------------------
// Insiden, inspeksi, P5M/Safety Talk, Pertemuan K3
// ---------------------------------------------------------------

const INCIDENT_CATEGORIES = ['NEAR_MISS', 'INJURY', 'VEHICLE', 'PROPERTY', 'FIRE', 'ENVIRONMENTAL'];
const TREATMENTS = ['NONE', 'FIRST_AID', 'MEDICAL', 'HOSPITALIZED'];

/** Kategori lapangan → incidents.incident_type. LTI/Fatality hanya ditetapkan HSE setelah investigasi. */
function incidentTypeFor(category, treatment) {
  switch (category) {
    case 'NEAR_MISS': return 'NEAR_MISS';
    case 'INJURY': return ['MEDICAL', 'HOSPITALIZED'].includes(treatment) ? 'MTI' : 'FAI';
    case 'VEHICLE': return 'VEHICLE_ACCIDENT';
    case 'PROPERTY': return 'PROPERTY_DAMAGE';
    case 'FIRE': return 'FIRE';
    case 'ENVIRONMENTAL': return 'ENVIRONMENTAL';
    default: throw mobileError('Jenis kejadian tidak dikenal');
  }
}

async function createIncidentTx(db, scope, profile, clientUuid, p) {
  const existing = await db.query(`SELECT id, incident_no FROM incidents WHERE tenant_key = $1 AND project_key = $2 AND client_uuid = $3`,
    [scope.tenantKey, scope.projectKey, clientUuid]);
  if (existing.rows[0]) return { server_id: existing.rows[0].id, server_no: existing.rows[0].incident_no, duplicate: true };

  const category = String(p.category || '').toUpperCase();
  if (!INCIDENT_CATEGORIES.includes(category)) throw mobileError('Jenis kejadian tidak dikenal');
  const description = cleanText(p.description);
  if (!description) throw mobileError('Kronologi wajib diisi');
  const immediate = cleanText(p.immediate_action);
  if (!immediate) throw mobileError('Tindakan segera wajib diisi');
  const location = await assertActiveLocation(db, scope, p.location_id);
  const when = wibDateTime(p.occurred_at);
  const victim = p.victim || null;
  const treatment = TREATMENTS.includes(String(victim?.treatment || '').toUpperCase()) ? String(victim.treatment).toUpperCase() : 'NONE';
  const photos = normalizePhotos(p.photos, { min: 0, max: 5 });

  const persons = [];
  if (victim && (victim.user_id || cleanText(victim.name))) {
    let name = cleanText(victim.name);
    if (victim.user_id) {
      const [u] = await assertActiveUsers(db, [requireUuid(victim.user_id, 'Korban')], 'Korban');
      name = u.nama;
    }
    persons.push({ employee_id: victim.user_id || null, person_name: name, company_name: cleanText(victim.company), role_in_incident: 'INJURED',
      body_part: cleanText(victim.body_part, 200), treatment });
  }
  for (const w of (Array.isArray(p.witnesses) ? p.witnesses : []).slice(0, 10)) {
    const name = cleanText(typeof w === 'string' ? w : w?.name, 200);
    if (name) persons.push({ person_name: name, role_in_incident: 'WITNESS' });
  }

  const created = await hse.createIncident(db, scope, profile, {
    incident_type: incidentTypeFor(category, treatment),
    occurred_at: when.iso,
    location_id: location.id,
    department_name: profile.departemen || null,
    description,
    actual_severity: category === 'NEAR_MISS' ? 'NONE' : 'MINOR',
    photos,
    persons,
    assets: cleanText(p.unit_code, 50) ? [{ asset_code: cleanText(p.unit_code, 50) }] : [],
  });
  const urgent = !['NEAR_MISS', 'PROPERTY'].includes(category);
  await db.query(`
    UPDATE incidents SET client_uuid = $1, source = 'MOBILE', immediate_action = $2, unit_code = $3, reported_category = $4, is_urgent = $5
    WHERE id = $6
  `, [clientUuid, immediate, cleanText(p.unit_code, 50), category, urgent, created.id]);
  await notify(db, scope, await currentOnDutyIds(db), {
    kind: urgent ? 'INCIDENT_URGENT' : 'INCIDENT_REPORTED',
    title: `${urgent ? 'DARURAT · ' : ''}Insiden ${category.replace('_', ' ').toLowerCase()} · ${created.incident_no}`,
    body: `${location.name}: ${description.slice(0, 120)}`, ref_type: 'INCIDENT', ref_id: created.id, is_urgent: urgent,
  }, profile.id);
  return { server_id: created.id, server_no: created.incident_no };
}

async function createInspectionTx(db, scope, profile, clientUuid, p) {
  const existing = await db.query(`SELECT id, inspection_no FROM hse_inspections WHERE tenant_key = $1 AND project_key = $2 AND client_uuid = $3`,
    [scope.tenantKey, scope.projectKey, clientUuid]);
  if (existing.rows[0]) return { server_id: existing.rows[0].id, server_no: existing.rows[0].inspection_no, duplicate: true };

  const templateId = requireUuid(p.template_id, 'Jenis inspeksi');
  const tmpl = await db.query(`SELECT id FROM hse_inspection_templates WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND is_active = TRUE AND deleted_at IS NULL`,
    [templateId, scope.tenantKey, scope.projectKey]);
  if (!tmpl.rows[0]) throw mobileError('Jenis inspeksi sudah dinonaktifkan admin.', 'MASTER_INACTIVE');
  const location = p.location_id ? await assertActiveLocation(db, scope, p.location_id) : null;
  if (p.schedule_id) {
    const sched = await db.query(`SELECT id FROM hse_inspection_schedules WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND is_active AND deleted_at IS NULL`,
      [requireUuid(p.schedule_id, 'Jadwal'), scope.tenantKey, scope.projectKey]);
    if (!sched.rows[0]) throw mobileError('Jadwal inspeksi sudah dinonaktifkan admin.', 'MASTER_INACTIVE');
  }
  const answers = [...(Array.isArray(p.answers) ? p.answers : []), ...(Array.isArray(p.custom_items) ? p.custom_items : [])]
    .map(a => ({
      item_id: isUuid(a.item_id) ? a.item_id : null,
      question: cleanText(a.question, 500),
      is_critical: Boolean(a.is_critical),
      answer: ['YES', 'NO', 'NA'].includes(String(a.answer || '').toUpperCase()) ? String(a.answer).toUpperCase() : null,
      note: cleanText(a.note, 1000),
      photo: typeof a.photo === 'string' ? a.photo : null,
      make_hazard: Boolean(a.make_hazard),
      hazard_pic_ids: a.hazard_pic_ids,
    }));
  if (!answers.length) throw mobileError('Checklist inspeksi kosong');
  if (answers.some(a => !a.question || !a.answer)) throw mobileError('Semua butir checklist wajib dijawab');
  if (answers.some(a => a.answer === 'NO' && (!a.note || !a.photo))) throw mobileError('Butir "Tidak OK" wajib diberi catatan dan foto');

  const participants = await assertActiveUsers(db, p.participant_ids, 'Peserta inspeksi');
  const summaryParts = [cleanText(p.result_summary, 500)];
  if (participants.length) summaryParts.push(`Tim: ${participants.map(x => x.nama).join(', ')}`);
  const detail = await hse.createInspection(db, scope, profile, {
    template_id: templateId,
    location_id: location?.id || null,
    schedule_id: p.schedule_id || null,
    object_identifier: cleanText(p.object_identifier, 200) || location?.name || 'Unit Lapangan',
    result_summary: summaryParts.filter(Boolean).join(' · ') || undefined,
    answers: answers.map(a => ({ item_id: a.item_id, question: a.question, is_critical: a.is_critical, answer: a.answer, note: a.note })),
    photos: normalizePhotos(p.photos, { min: 1, max: 3 }),
  });
  await db.query('UPDATE hse_inspections SET client_uuid = $1 WHERE id = $2', [clientUuid, detail.id]);
  for (const a of answers) {
    if (a.answer !== 'NO' || !a.photo) continue;
    const [photo] = await compressHsePhotos([a.photo], { maxPhotos: 1 });
    await db.query(`
      UPDATE hse_inspection_answers SET photo = $1
      WHERE id = (SELECT id FROM hse_inspection_answers WHERE inspection_id = $2 AND question = $3 AND answer = 'NO' AND photo IS NULL LIMIT 1)
    `, [photo, detail.id, a.question]);
  }

  const hazards = [];
  let idx = 0;
  for (const a of answers) {
    idx += 1;
    if (a.answer !== 'NO' || !a.make_hazard) continue;
    const res = await createHazardTx(db, scope, profile, deriveUuid(clientUuid, idx), {
      category_code: 'UNSAFE_CONDITION',
      location_id: location?.id || p.location_id,
      occurred_at: new Date().toISOString(),
      description: `Temuan inspeksi ${detail.inspection_no}: ${a.question}. ${a.note || ''}`.trim(),
      photos: [a.photo],
      pic_ids: a.hazard_pic_ids,
      likelihood: a.is_critical ? 4 : 3,
      consequence: a.is_critical ? 4 : 3,
    }, { source: 'INSPECTION' });
    hazards.push(res.server_no);
  }
  return { server_id: detail.id, server_no: detail.inspection_no, hazards };
}

/** UUID turunan yang stabil (untuk hazard dari temuan inspeksi) agar kirim ulang tetap idempoten. */
function deriveUuid(base, n) {
  const hex = require('crypto').createHash('sha1').update(`${base}:${n}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function createEventTx(db, scope, profile, clientUuid, kind, p) {
  const table = kind === 'p5m' ? 'hse_p5m_events' : 'hse_safetytalk_events';
  const existing = await db.query(`SELECT id, event_no FROM ${table} WHERE tenant_key = $1 AND project_key = $2 AND client_uuid = $3`,
    [scope.tenantKey, scope.projectKey, clientUuid]);
  if (existing.rows[0]) return { server_id: existing.rows[0].id, server_no: existing.rows[0].event_no, duplicate: true };
  await assertActiveLocation(db, scope, p.location_id);
  const create = kind === 'p5m' ? hse.createP5mEvent : hse.createSafetytalkEvent;
  const detail = await create(db, scope, profile, {
    event_date: p.event_date,
    shift_id: p.shift_id,
    location_id: p.location_id,
    topics: p.topics,
    participant_ids: p.participant_ids,
    led_by_ids: Array.isArray(p.led_by_ids) && p.led_by_ids.length ? p.led_by_ids : [profile.id],
    photos: normalizePhotos(p.photos, { min: 1, max: 3 }),
  });
  await db.query(`UPDATE ${table} SET client_uuid = $1 WHERE id = $2`, [clientUuid, detail.id]);
  return { server_id: detail.id, server_no: detail.event_no };
}

async function nextMeetingNo(db, scope) {
  const clock = getWibClock();
  const ym = clock.date.slice(2, 4) + clock.date.slice(5, 7);
  const { rows } = await db.query(`
    SELECT meeting_no FROM hse_meetings WHERE tenant_key = $1 AND project_key = $2 AND meeting_no LIKE $3
    ORDER BY meeting_no DESC LIMIT 1
  `, [scope.tenantKey, scope.projectKey, `MTG-${ym}-%`]);
  const last = rows[0] ? parseInt(rows[0].meeting_no.split('-').pop(), 10) : 0;
  return hse.formatDocNumber('MTG', ym, (Number.isNaN(last) ? 0 : last) + 1);
}

async function createMeetingTx(db, scope, profile, clientUuid, p) {
  const existing = await db.query(`SELECT id, meeting_no FROM hse_meetings WHERE tenant_key = $1 AND project_key = $2 AND client_uuid = $3`,
    [scope.tenantKey, scope.projectKey, clientUuid]);
  if (existing.rows[0]) return { server_id: existing.rows[0].id, server_no: existing.rows[0].meeting_no, duplicate: true };
  const kind = String(p.meeting_kind || 'K3').toUpperCase() === 'UMUM' ? 'UMUM' : 'K3';
  const title = cleanText(p.title, 300);
  if (!title) throw mobileError('Agenda/topik pertemuan wajib diisi');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.meeting_date || ''))) throw mobileError('Tanggal pertemuan wajib diisi');
  let location = null;
  if (p.location_id) location = await assertActiveLocation(db, scope, p.location_id);
  const locationName = location?.name || cleanText(p.location_other, 200);
  if (!locationName) throw mobileError('Lokasi wajib dipilih atau diisi manual (Lainnya)');
  const participants = await assertActiveUsers(db, p.participant_ids, 'Peserta');
  const externals = (Array.isArray(p.external_participants) ? p.external_participants : []).map(x => cleanText(x, 200)).filter(Boolean).slice(0, 50);
  if (!participants.length && !externals.length) throw mobileError('Minimal 1 peserta');
  let leaderId = null;
  let leaderName = cleanText(p.leader_external_name, 200);
  if (p.leader_user_id) {
    const [leader] = await assertActiveUsers(db, [requireUuid(p.leader_user_id, 'Pimpinan')], 'Pimpinan');
    leaderId = leader.id;
    leaderName = leader.nama;
  }
  if (!leaderName) throw mobileError('Pemateri/pimpinan wajib diisi');
  const photos = await compressHsePhotos(normalizePhotos(p.photos, { min: 1, max: 3 }));
  const meetingNo = await nextMeetingNo(db, scope);
  const { rows } = await db.query(`
    INSERT INTO hse_meetings (tenant_key, project_key, client_uuid, meeting_no, meeting_kind, title, meeting_date, start_time,
      location_id, location_name, leader_user_id, leader_name, leader_is_external, participant_ids, participant_names,
      external_participants, notes, photos, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid[], $15, $16, $17, $18, $19)
    RETURNING id, meeting_no
  `, [scope.tenantKey, scope.projectKey, clientUuid, meetingNo, kind, title, p.meeting_date,
    /^\d{2}:\d{2}/.test(String(p.start_time || '')) ? String(p.start_time).slice(0, 5) : null,
    location?.id || null, locationName, leaderId, leaderName, !leaderId,
    participants.map(x => x.id), participants.map(x => x.nama), externals, cleanText(p.notes, 4000), photos, profile.id]);
  return { server_id: rows[0].id, server_no: rows[0].meeting_no };
}

// ---------------------------------------------------------------
// Sinkronisasi antrean (outbox) APK
// ---------------------------------------------------------------

const HANDLERS = {
  HAZARD_CREATE: (db, s, u, id, p) => createHazardTx(db, s, u, id, p),
  HAZARD_CORRECT: correctHazardTx,
  HAZARD_CANCEL: cancelHazardTx,
  HAZARD_NOTE: hazardNoteTx,
  ACTION_START: startActionTx,
  ACTION_EVIDENCE: submitEvidenceTx,
  VERIFY_DECISION: verifyDecisionTx,
  PIC_REQUEST: picRequestTx,
  DELEGATOR_DECISION: delegatorDecisionTx,
  DELEGATOR_REASSIGN: delegatorReassignTx,
  INCIDENT_CREATE: createIncidentTx,
  INSPECTION_CREATE: createInspectionTx,
  P5M_CREATE: (db, s, u, id, p) => createEventTx(db, s, u, id, 'p5m', p),
  SAFETYTALK_CREATE: (db, s, u, id, p) => createEventTx(db, s, u, id, 'safetytalk', p),
  MEETING_CREATE: createMeetingTx,
};

async function processSyncItem(pool, scope, userId, item) {
  const clientUuid = item?.client_uuid;
  const type = String(item?.type || '');
  if (!isUuid(clientUuid)) return { client_uuid: clientUuid || null, status: 'ERROR', code: 'VALIDATION', message: 'client_uuid tidak valid' };
  if (!HANDLERS[type]) return { client_uuid: clientUuid, status: 'ERROR', code: 'VALIDATION', message: `Jenis data tidak dikenal: ${type}` };
  try {
    const result = await withTransaction(pool, async (db) => {
      const profile = await loadProfile(db, scope, userId);
      return HANDLERS[type](db, scope, profile, clientUuid, item.payload || {});
    });
    return { client_uuid: clientUuid, ...result, status: 'OK' };
  } catch (error) {
    if (error.code === '23505') {
      return { client_uuid: clientUuid, status: 'ERROR', code: 'RETRYABLE', message: 'Data sedang diproses, coba lagi.' };
    }
    if (error.statusCode && error.statusCode < 500) {
      return { client_uuid: clientUuid, status: 'ERROR', code: error.details?.code || error.code || 'VALIDATION', message: error.message };
    }
    console.error(JSON.stringify({ message: 'hse mobile sync gagal', type, code: error.code || null, error: error.message }));
    return { client_uuid: clientUuid, status: 'ERROR', code: 'RETRYABLE', message: 'Server sedang bermasalah, dicoba ulang otomatis.' };
  }
}

async function syncItems(pool, scope, userId, items) {
  const list = Array.isArray(items) ? items.slice(0, 20) : [];
  const results = [];
  for (const item of list) results.push(await processSyncItem(pool, scope, userId, item));
  return { results, server_time: new Date().toISOString() };
}

// ---------------------------------------------------------------
// Bacaan untuk APK
// ---------------------------------------------------------------

const HAZARD_LIST_COLS = `h.id, h.report_no, h.status, h.risk_level, h.risk_score, h.description, h.category_name,
  h.location_name, h.report_date, h.report_time, h.occurred_at, h.stop_work, h.is_urgent, h.created_at, h.updated_at,
  h.revision_no, h.client_uuid, COALESCE(rep.nama, h.reported_by_name) AS reported_by_name`;

async function getMyReports(db, scope, userId) {
  const since = shiftDate(wibDate(), -90);
  const params = [scope.tenantKey, scope.projectKey, userId, since];
  const safe = (sql) => db.query(sql, params).then(r => r.rows).catch(() => []);
  const [hazards, incidents, inspections, p5m, safetytalk, meetings] = await Promise.all([
    safe(`SELECT ${HAZARD_LIST_COLS} FROM hazard_reports h LEFT JOIN users rep ON rep.id = h.reported_by
          WHERE h.tenant_key = $1 AND h.project_key = $2 AND h.reported_by = $3 AND h.report_date >= $4::date AND h.deleted_at IS NULL
          ORDER BY h.created_at DESC LIMIT 200`),
    safe(`SELECT id, incident_no, incident_type, reported_category, status, description, location_name, occurred_at, client_uuid
          FROM incidents WHERE tenant_key = $1 AND project_key = $2 AND reported_by = $3 AND occurred_at >= $4::date
          ORDER BY occurred_at DESC LIMIT 100`),
    safe(`SELECT id, inspection_no, template_name, location_name, object_identifier, findings_count, inspected_at, client_uuid,
                 (SELECT COUNT(*)::int FROM hse_inspection_answers a WHERE a.inspection_id = i.id AND a.answer = 'YES') AS ok_count,
                 (SELECT COUNT(*)::int FROM hse_inspection_answers a WHERE a.inspection_id = i.id AND a.answer <> 'NA') AS answered_count
          FROM hse_inspections i WHERE tenant_key = $1 AND project_key = $2 AND inspected_by_id = $3 AND inspected_at >= $4::date
            AND deleted_at IS NULL ORDER BY inspected_at DESC LIMIT 100`),
    safe(`SELECT id, event_no, event_date, location_name, topics, client_uuid FROM hse_p5m_events
          WHERE tenant_key = $1 AND project_key = $2 AND created_by = $3 AND event_date >= $4::date AND status = 'ACTIVE'
          ORDER BY event_date DESC LIMIT 100`),
    safe(`SELECT id, event_no, event_date, location_name, topics, client_uuid FROM hse_safetytalk_events
          WHERE tenant_key = $1 AND project_key = $2 AND created_by = $3 AND event_date >= $4::date AND status = 'ACTIVE'
          ORDER BY event_date DESC LIMIT 100`),
    safe(`SELECT id, meeting_no, meeting_kind, title, meeting_date, location_name, client_uuid FROM hse_meetings
          WHERE tenant_key = $1 AND project_key = $2 AND created_by = $3 AND meeting_date >= $4::date
          ORDER BY meeting_date DESC LIMIT 100`),
  ]);
  return { hazards, incidents, inspections, p5m, safetytalk, meetings };
}

async function getHazardDetailForMobile(db, scope, userId, hazardId) {
  requireUuid(hazardId, 'Hazard');
  const profile = await loadProfile(db, scope, userId);
  const { rows } = await db.query(`
    SELECT h.*, COALESCE(rep.nama, h.reported_by_name) AS reported_by_name,
      COALESCE(p.name || ' ▸ ' || l.name, l.name, h.location_name) AS location_label
    FROM hazard_reports h
    LEFT JOIN users rep ON rep.id = h.reported_by
    LEFT JOIN hse_locations l ON l.id = h.location_id
    LEFT JOIN hse_locations p ON p.id = l.parent_id
    WHERE h.id = $1 AND h.tenant_key = $2 AND h.project_key = $3 AND h.deleted_at IS NULL
  `, [hazardId, scope.tenantKey, scope.projectKey]);
  const hazard = rows[0];
  if (!hazard) throw mobileError('Laporan hazard tidak ditemukan', 'NOT_FOUND', 404);
  const actions = await hazardActions(db, hazardId);
  await assertHazardParticipant(db, scope, profile, hazard, actions);
  const [events, revisions] = await Promise.all([
    db.query(`SELECT id, action_id, event_type, actor_name, note, data, created_at FROM hse_hazard_events
              WHERE hazard_id = $1 ORDER BY created_at DESC, id DESC`, [hazardId]).then(r => r.rows),
    db.query(`SELECT revision_no, changed_fields, changed_at FROM hse_hazard_revisions WHERE hazard_id = $1 ORDER BY revision_no DESC`, [hazardId]).then(r => r.rows),
  ]);
  const isReporter = String(hazard.reported_by) === String(userId);
  return {
    hazard: { ...hazard, location_name: hazard.location_label },
    actions: actions.map(a => ({
      id: a.id, action_no: a.action_no, pic_employee_id: a.pic_employee_id, pic_name: a.pic_name, status: a.status,
      description: a.description, due_at: a.due_at, due_date: a.due_date, started_at: a.started_at, completed_at: a.completed_at,
      evidence_url: a.evidence_url, evidence_note: a.evidence_note, rejected_reason: a.rejected_reason, extension_count: a.extension_count,
    })),
    capa_progress: hse.capaProgressOf(actions),
    events,
    revisions,
    permissions: {
      can_correct: canReporterEdit(hazard, actions, userId),
      can_cancel: canReporterEdit(hazard, actions, userId),
      can_verify: (isReporter || isHseStaff(profile) || isAdmin(profile))
        && actions.some(a => a.status === 'DONE_PENDING_VERIFY' && (String(a.pic_employee_id) !== String(userId) || isHseStaff(profile))),
      can_note: true,
    },
  };
}

const ACTION_JOIN = `
  FROM hse_actions a
  JOIN hazard_reports h ON h.id = a.source_id AND a.source_type = 'HAZARD' AND h.deleted_at IS NULL
  LEFT JOIN users rep ON rep.id = h.reported_by
  LEFT JOIN LATERAL (
    SELECT r.id, r.request_type, r.status, r.created_at FROM hse_pic_requests r
    WHERE r.action_id = a.id AND r.status = 'PENDING' ORDER BY r.created_at DESC LIMIT 1
  ) pr ON TRUE`;
const ACTION_COLS = `a.id AS action_id, a.action_no, a.status AS action_status, a.description AS action_description,
  a.due_at, a.due_date, a.started_at, a.completed_at, a.rejected_reason, a.rejected_at, a.extension_count, a.evidence_url, a.evidence_note,
  a.pic_employee_id, a.pic_name, h.id AS hazard_id, h.report_no, h.status AS hazard_status, h.risk_level, h.description,
  h.category_name, h.location_name, h.report_date, h.report_time, h.photos, h.stop_work, h.immediate_action,
  h.potential_consequence, h.recommendation,
  (SELECT COUNT(*)::int FROM hse_actions x WHERE x.source_type = 'HAZARD' AND x.source_id = h.id AND x.deleted_at IS NULL AND x.status <> 'CANCELLED') AS capa_total,
  (SELECT COUNT(*)::int FROM hse_actions x WHERE x.source_type = 'HAZARD' AND x.source_id = h.id AND x.deleted_at IS NULL AND x.status = 'CLOSED') AS capa_closed,
  COALESCE(rep.nama, h.reported_by_name) AS reported_by_name, h.reported_by,
  pr.id AS pending_request_id, pr.request_type AS pending_request_type,
  (COALESCE(a.due_at, (a.due_date + 1)::timestamptz) < now() AND a.status IN ('OPEN','IN_PROGRESS')) AS is_overdue`;

async function getPicActions(db, scope, userId) {
  const { rows } = await db.query(`
    SELECT ${ACTION_COLS} ${ACTION_JOIN}
    WHERE a.tenant_key = $1 AND a.project_key = $2 AND a.pic_employee_id = $3 AND a.deleted_at IS NULL
      AND (a.status <> 'CLOSED' OR a.verified_at >= now() - interval '30 days')
      AND a.status <> 'CANCELLED'
    ORDER BY (a.status = 'CLOSED'), COALESCE(a.due_at, a.due_date::timestamptz) ASC
  `, [scope.tenantKey, scope.projectKey, userId]);
  return rows;
}

async function getVerifyQueue(db, scope, userId) {
  const profile = await loadProfile(db, scope, userId);
  const canVerifyAll = isHseStaff(profile) || isAdmin(profile);
  const { rows } = await db.query(`
    SELECT ${ACTION_COLS} ${ACTION_JOIN}
    WHERE a.tenant_key = $1 AND a.project_key = $2 AND a.status = 'DONE_PENDING_VERIFY' AND a.deleted_at IS NULL
      AND ($4::boolean OR (h.reported_by = $3 AND a.pic_employee_id <> $3))
    ORDER BY a.completed_at ASC
    LIMIT 100
  `, [scope.tenantKey, scope.projectKey, userId, canVerifyAll]);
  return rows;
}

async function getDelegatorInbox(db, scope, userId) {
  const depts = await delegatorDepartments(db, scope, userId);
  if (!depts.length) return { departments: [], requests: [], stalled: [], candidates: {} };
  const deptIds = depts.map(d => d.department_id);
  const [requests, stalled, candidates] = await Promise.all([
    db.query(`
      SELECT r.id AS request_id, r.request_type, r.reason, r.proposed_due_date, r.proposed_department_id, r.created_at AS requested_at,
             r.department_id, req.nama AS requester_name, pd.name AS proposed_department_name, ${ACTION_COLS}
      FROM hse_pic_requests r
      JOIN users req ON req.id = r.requester_id
      LEFT JOIN workforce_departments pd ON pd.id = r.proposed_department_id
      JOIN hse_actions a ON a.id = r.action_id
      JOIN hazard_reports h ON h.id = a.source_id AND h.deleted_at IS NULL
      LEFT JOIN users rep ON rep.id = h.reported_by
      LEFT JOIN LATERAL (SELECT NULL::uuid AS id, NULL::text AS request_type) pr ON TRUE
      WHERE r.tenant_key = $1 AND r.project_key = $2 AND r.status = 'PENDING' AND r.department_id = ANY($3::uuid[])
      ORDER BY r.created_at ASC
    `, [scope.tenantKey, scope.projectKey, deptIds]).then(r => r.rows),
    db.query(`
      SELECT ${ACTION_COLS} ${ACTION_JOIN}
      JOIN users pic ON pic.id = a.pic_employee_id
      JOIN workforce_departments wd ON lower(trim(wd.name)) = lower(trim(COALESCE(pic.departemen, '')))
       AND wd.tenant_key = $1 AND wd.project_key = $2
      WHERE a.tenant_key = $1 AND a.project_key = $2 AND a.deleted_at IS NULL AND wd.id = ANY($3::uuid[])
        AND a.status IN ('OPEN', 'IN_PROGRESS')
        AND (COALESCE(a.due_at, (a.due_date + 1)::timestamptz) < now()
             OR (a.rejected_at IS NOT NULL AND a.rejected_at < now() - interval '24 hours'))
      ORDER BY COALESCE(a.due_at, a.due_date::timestamptz) ASC
      LIMIT 100
    `, [scope.tenantKey, scope.projectKey, deptIds]).then(r => r.rows),
    db.query(`
      SELECT wd.id AS department_id, u.id, u.nama, u.jabatan,
        (SELECT COUNT(*)::int FROM hse_actions x WHERE x.pic_employee_id = u.id AND x.status IN ('OPEN','IN_PROGRESS') AND x.deleted_at IS NULL) AS active_count
      FROM users u
      JOIN workforce_departments wd ON lower(trim(wd.name)) = lower(trim(COALESCE(u.departemen, '')))
       AND wd.tenant_key = $1 AND wd.project_key = $2
      WHERE u.is_active = TRUE AND wd.id = ANY($3::uuid[])
      ORDER BY u.nama
    `, [scope.tenantKey, scope.projectKey, deptIds]).then(r => r.rows),
  ]);
  const byDept = {};
  for (const c of candidates) (byDept[c.department_id] = byDept[c.department_id] || []).push({ id: c.id, nama: c.nama, jabatan: c.jabatan, active_count: c.active_count });
  const forwardTargets = await db.query(`
    SELECT wd.id, wd.name FROM hse_department_delegators d JOIN workforce_departments wd ON wd.id = d.department_id
    WHERE d.tenant_key = $1 AND d.project_key = $2 AND d.is_active AND NOT (d.department_id = ANY($3::uuid[]))
    ORDER BY wd.name
  `, [scope.tenantKey, scope.projectKey, deptIds]).then(r => r.rows);
  return { departments: depts, requests, stalled, candidates: byDept, forward_departments: forwardTargets };
}

async function getMySchedules(db, scope, userId) {
  const profile = await loadProfile(db, scope, userId);
  const today = wibDate();
  const { rows } = await db.query(`
    SELECT s.id, s.template_root_id, tmpl.id AS template_id, tmpl.name AS template_name, tmpl.schedule_cycle, tmpl.custom_interval_days,
           s.location_id, l.name AS location_name, s.asset_id, s.assignee_type, wp.name AS assignee_position_name,
           s.next_due_date, s.last_done_at, s.notes,
           CASE WHEN s.next_due_date < $4::date THEN 'OVERDUE'
                WHEN s.next_due_date = $4::date THEN 'TODAY'
                WHEN s.next_due_date <= ($4::date + 6) THEN 'WEEK'
                ELSE 'LATER' END AS due_status
    FROM hse_inspection_schedules s
    JOIN hse_inspection_templates tmpl ON (tmpl.root_id = s.template_root_id OR tmpl.id = s.template_root_id) AND tmpl.is_current = TRUE
    LEFT JOIN hse_locations l ON l.id = s.location_id
    LEFT JOIN workforce_positions wp ON wp.id = s.assignee_position_id
    WHERE s.tenant_key = $1 AND s.project_key = $2 AND s.is_active AND s.deleted_at IS NULL
      AND ((s.assignee_type = 'EMPLOYEE' AND s.assignee_employee_id = $3)
        OR (s.assignee_type = 'POSITION' AND $5::uuid IS NOT NULL AND s.assignee_position_id = $5::uuid))
    ORDER BY s.next_due_date ASC NULLS LAST
  `, [scope.tenantKey, scope.projectKey, userId, today, profile.position_id || null]);
  return { operational_date: today, schedules: rows };
}

async function getEventParticipants(db, scope, kind, onDate) {
  if (!['p5m', 'safetytalk'].includes(kind)) throw mobileError('Jenis kegiatan tidak dikenal', 'VALIDATION', 400);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(onDate || '')) ? onDate : wibDate();
  return hse.listEventParticipants(db, scope, kind, date);
}

/** Periode berjalan sebuah siklus target (tanggal WIB, inklusif). Minggu = Senin–Minggu. */
function cyclePeriod(cycle, today = wibDate()) {
  if (cycle === 'DAILY') return { from: today, to: today };
  if (cycle === 'WEEKLY') {
    const d = new Date(`${today}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400e3);
    return { from: monday.toISOString().slice(0, 10), to: new Date(monday.getTime() + 6 * 86400e3).toISOString().slice(0, 10) };
  }
  const from = `${today.slice(0, 7)}-01`;
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { from, to: new Date(end.getTime() - 86400e3).toISOString().slice(0, 10) };
}

/**
 * Pencapaian pribadi vs Setup Target HSE per kategori & per individu (aturan individu > jabatan,
 * siklus harian/mingguan/bulanan sesuai setup). Aktual dihitung pada periode berjalan siklus tersebut.
 */
async function getMyStats(db, scope, userId) {
  const today = wibDate();
  const { tenantKey, projectKey } = scope;
  const quotaOf = async (fn) => (await db.query(`
    SELECT q.cycle, q.quota, q.status, q.source FROM (SELECT $1::uuid AS id) u
    ${hse.anyCycleQuotaJoin(c => `${fn}(u.id, ${c}, $2::date)`)}
  `, [userId, today])).rows[0] || {};
  const inScope = async (kind) => {
    const ps = kind === 'p5m' ? await hse.getP5mPersonnelScope(db, scope) : await hse.getSafetytalkPersonnelScope(db, scope);
    const params = [userId];
    const where = hse.personnelScopeWhere(ps, params);
    if (!where) return true;
    return (await db.query(`SELECT 1 FROM users u WHERE u.id = $1 ${where}`, params)).rows.length > 0;
  };
  const count = async (sql, period, extra = []) => Number((await db.query(sql, [tenantKey, projectKey, userId, period.from, period.to, ...extra])).rows[0]?.n) || 0;

  const rows = [];
  const pushRow = (key, label, q, actual, period, extra = {}) => rows.push({
    key, label, cycle: q.cycle || null, source: q.source || null,
    status: q.status || 'BELUM_DIATUR',
    target: q.status === 'WAJIB' ? Number(q.quota) || 0 : 0,
    actual, period_from: period?.from || null, period_to: period?.to || null, ...extra,
  });

  // Hazard Report
  const hq = await quotaOf('hse_hazard_effective_quota');
  const hp = cyclePeriod(hq.cycle || 'MONTHLY', today);
  pushRow('hazard', 'Hazard Report', hq, await count(`
    SELECT COUNT(*)::int AS n FROM hazard_reports WHERE tenant_key = $1 AND project_key = $2 AND reported_by = $3
      AND report_date BETWEEN $4::date AND $5::date AND deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'CANCELLED'`, hp), hp);

  // Inspeksi: aturan per jenis (templat) + aturan "semua jenis".
  const { rows: inspRules } = await db.query(`
    SELECT tmpl.root_id, tmpl.name, q.cycle, q.quota, q.status, q.source
    FROM (SELECT DISTINCT ON (COALESCE(t.root_id, t.id)) COALESCE(t.root_id, t.id) AS root_id, t.name
          FROM hse_inspection_templates t
          WHERE t.tenant_key = $3 AND t.project_key = $4 AND t.is_active AND t.deleted_at IS NULL AND COALESCE(t.is_current, TRUE)
          ORDER BY COALESCE(t.root_id, t.id), t.created_at DESC) tmpl
    ${hse.anyCycleQuotaJoin(c => `hse_effective_quota($1::uuid, tmpl.root_id, ${c}, $2::date)`)}
    JOIN hse_inspection_targets r ON r.id = q.rule_id AND r.template_root_id IS NOT NULL
    ORDER BY tmpl.name
  `, [userId, today, tenantKey, projectKey]);
  const inspActual = (period, rootId) => count(`
    SELECT COUNT(*)::int AS n FROM hse_inspections i JOIN hse_inspection_templates tt ON tt.id = i.template_id
    WHERE i.tenant_key = $1 AND i.project_key = $2 AND i.inspected_by_id = $3 AND i.status = 'COMPLETED' AND i.deleted_at IS NULL
      AND (i.inspected_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $4::date AND $5::date
      AND ($6::uuid IS NULL OR COALESCE(tt.root_id, tt.id) = $6::uuid)`, period, [rootId]);
  for (const r of inspRules) {
    const period = cyclePeriod(r.cycle, today);
    pushRow('inspection', `Inspeksi · ${r.name}`, r, await inspActual(period, r.root_id), period, { template_root_id: r.root_id });
  }
  const iq = (await db.query(`
    SELECT q.cycle, q.quota, q.status, q.source FROM (SELECT $1::uuid AS id) u
    ${hse.anyCycleQuotaJoin(c => `hse_effective_quota(u.id, NULL, ${c}, $2::date)`)}
  `, [userId, today])).rows[0] || {};
  if (iq.status || !inspRules.length) {
    const period = cyclePeriod(iq.cycle || 'MONTHLY', today);
    pushRow('inspection', inspRules.length ? 'Inspeksi · semua jenis' : 'Inspeksi', iq, await inspActual(period, null), period);
  }

  // P5M & Safety Talk: hanya karyawan dalam Seleksi Karyawan Setup Master.
  for (const [key, label, fn, events, attendees] of [
    ['p5m', 'P5M', 'hse_p5m_effective_quota', 'hse_p5m_events', 'hse_p5m_event_attendees'],
    ['safetytalk', 'Safety Talk', 'hse_safetytalk_effective_quota', 'hse_safetytalk_events', 'hse_safetytalk_event_attendees'],
  ]) {
    const selected = await inScope(key);
    const q = selected ? await quotaOf(fn) : { status: 'TIDAK_DISELEKSI' };
    const period = cyclePeriod(q.cycle || 'MONTHLY', today);
    pushRow(key, label, q, await count(`
      SELECT COUNT(DISTINCT e.id)::int AS n FROM ${events} e JOIN ${attendees} a ON a.event_id = e.id
      WHERE e.tenant_key = $1 AND e.project_key = $2 AND a.employee_id = $3 AND e.status = 'ACTIVE'
        AND e.event_date BETWEEN $4::date AND $5::date`, period), period);
  }

  return {
    month: today.slice(0, 7),
    today,
    rows,
    note: 'Target dari Setup Master HSE (Hazard Report, Inspeksi, P5M, Safety Talk) untuk Anda. Data yang masih di HP belum terhitung di server.',
  };
}

async function listNotifications(db, scope, userId, afterId, limit = 50) {
  const after = Number.isFinite(Number(afterId)) ? Number(afterId) : 0;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [items, unread] = await Promise.all([
    db.query(`
      SELECT id, kind, title, body, ref_type, ref_id, is_urgent, read_at, created_at FROM hse_notifications
      WHERE tenant_key = $1 AND project_key = $2 AND user_id = $3 AND id > $4
      ORDER BY id ASC LIMIT $5
    `, [scope.tenantKey, scope.projectKey, userId, after, lim]).then(r => r.rows),
    db.query(`SELECT COUNT(*)::int AS n FROM hse_notifications WHERE tenant_key = $1 AND project_key = $2 AND user_id = $3 AND read_at IS NULL`,
      [scope.tenantKey, scope.projectKey, userId]).then(r => r.rows[0].n),
  ]);
  return { items: items.map(i => ({ ...i, id: Number(i.id) })), unread_count: unread, poll_minutes: 15 };
}

async function markNotificationsRead(db, scope, userId, body = {}) {
  if (body.all === true) {
    await db.query(`UPDATE hse_notifications SET read_at = now() WHERE tenant_key = $1 AND project_key = $2 AND user_id = $3 AND read_at IS NULL`,
      [scope.tenantKey, scope.projectKey, userId]);
    return { ok: true };
  }
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isFinite).slice(0, 500);
  if (ids.length) {
    await db.query(`UPDATE hse_notifications SET read_at = now() WHERE tenant_key = $1 AND project_key = $2 AND user_id = $3 AND id = ANY($4::bigint[]) AND read_at IS NULL`,
      [scope.tenantKey, scope.projectKey, userId, ids]);
  }
  return { ok: true };
}

// ---------------------------------------------------------------
// Eskalasi otomatis tindak lanjut lewat batas → Delegator departemen PIC
// ---------------------------------------------------------------

/**
 * Tandai tindak lanjut yang lewat batas (sekali per batas waktu, lewat kolom escalated_at) lalu kirim notifikasi
 * ke PIC, delegator (utama + cadangan) departemen PIC, dan — untuk risiko Ekstrem — HSE on-duty.
 * Aman dijalankan paralel di beberapa instance: baris dikunci FOR UPDATE SKIP LOCKED.
 */
async function escalateOverdueActions(pool, { now = new Date(), limit = 200 } = {}) {
  return withTransaction(pool, async (db) => {
    const { rows } = await db.query(`
      UPDATE hse_actions a SET escalated_at = now(), updated_at = now()
      FROM hazard_reports h
      WHERE h.id = a.source_id AND a.id IN (
        SELECT a2.id FROM hse_actions a2
        JOIN hazard_reports h2 ON h2.id = a2.source_id AND a2.source_type = 'HAZARD'
        WHERE a2.status IN ('OPEN', 'IN_PROGRESS') AND a2.deleted_at IS NULL AND a2.escalated_at IS NULL
          AND h2.deleted_at IS NULL AND h2.status NOT IN ('CLOSED', 'CANCELLED', 'DUPLICATE', 'REJECTED')
          AND COALESCE(a2.due_at, (a2.due_date + 1)::timestamptz) < $1::timestamptz
        ORDER BY COALESCE(a2.due_at, a2.due_date::timestamptz)
        LIMIT $2
        FOR UPDATE OF a2 SKIP LOCKED
      )
      RETURNING a.id, a.tenant_key, a.project_key, a.pic_employee_id, a.pic_name,
                h.id AS hazard_id, h.report_no, h.reported_by, h.risk_level, h.description
    `, [now.toISOString(), limit]);

    let onDuty = null;
    for (const r of rows) {
      const scope = { tenantKey: r.tenant_key, projectKey: r.project_key };
      const [deptId] = await picDepartmentIds(db, scope, [r.pic_employee_id]);
      const delegator = deptId ? await delegatorsOf(db, scope, deptId) : null;
      const urgent = r.risk_level === 'EXTREME';
      await addHazardEvent(db, scope, r.hazard_id, {
        actionId: r.id, type: 'ESCALATED',
        note: delegator ? `Lewat batas · dieskalasi ke ${delegator.delegator_name}` : 'Lewat batas · departemen PIC belum punya delegator',
      });
      await notify(db, scope, [r.pic_employee_id], {
        kind: 'ACTION_OVERDUE', title: `Lewat batas tindak lanjut · ${r.report_no}`,
        body: 'Segera kirim bukti perbaikan atau ajukan permintaan ke delegator.', ref_type: 'HAZARD', ref_id: r.hazard_id, is_urgent: urgent,
      });
      const targets = [delegator?.delegator_user_id, delegator?.backup_user_id];
      if (urgent) {
        onDuty = onDuty || await currentOnDutyIds(db);
        targets.push(...onDuty);
      }
      await notify(db, scope, targets, {
        kind: 'ACTION_ESCALATED', title: `${urgent ? 'DARURAT · ' : ''}Hazard lewat batas · ${r.report_no}`,
        body: `PIC ${r.pic_name || '-'}: ${String(r.description || '').slice(0, 100)}`, ref_type: 'HAZARD', ref_id: r.hazard_id, is_urgent: urgent,
      }, r.pic_employee_id);
    }
    return { escalated: rows.length };
  });
}

/** Worker di dalam proses backend (pola sama dengan worker AI). Matikan dengan HSE_ESCALATION=off. */
function startEscalationWorker(pool, { intervalMs = 10 * 60 * 1000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { escalated } = await escalateOverdueActions(pool);
      if (escalated) console.log(JSON.stringify({ message: 'hse escalation', escalated }));
    } catch (error) {
      // Tabel belum ada (migration 101 belum jalan) → diam; error lain dicatat tanpa data sensitif.
      if (error.code !== '42P01' && error.code !== '42703') console.error(JSON.stringify({ message: 'hse escalation gagal', code: error.code || null }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(tick, 30 * 1000).unref?.();
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------
// Admin HSE: Setup Delegator Departemen
// ---------------------------------------------------------------

async function listDepartmentDelegators(db, scope) {
  const { rows } = await db.query(`
    SELECT wd.id AS department_id, wd.name AS department_name,
           d.id, d.delegator_user_id, du.nama AS delegator_name, du.jabatan AS delegator_jabatan,
           d.backup_user_id, bu.nama AS backup_name, d.valid_from, d.valid_to, d.notes, d.updated_at,
           (SELECT COUNT(*)::int FROM hse_actions a JOIN users pu ON pu.id = a.pic_employee_id
             WHERE lower(trim(COALESCE(pu.departemen, ''))) = lower(trim(wd.name)) AND a.status IN ('OPEN','IN_PROGRESS')
               AND a.deleted_at IS NULL AND a.source_type = 'HAZARD') AS open_pic_actions
    FROM workforce_departments wd
    LEFT JOIN hse_department_delegators d ON d.department_id = wd.id AND d.is_active
      AND d.tenant_key = $1 AND d.project_key = $2
    LEFT JOIN users du ON du.id = d.delegator_user_id
    LEFT JOIN users bu ON bu.id = d.backup_user_id
    WHERE wd.tenant_key = $1 AND wd.project_key = $2 AND wd.is_active
    ORDER BY wd.name
  `, [scope.tenantKey, scope.projectKey]);
  return rows;
}

async function listDelegatorHistory(db, scope, departmentId) {
  requireUuid(departmentId, 'Departemen');
  const { rows } = await db.query(`
    SELECT d.id, du.nama AS delegator_name, bu.nama AS backup_name, d.valid_from, d.valid_to, d.is_active, d.notes,
           cu.nama AS created_by_name, d.created_at, uu.nama AS updated_by_name, d.updated_at
    FROM hse_department_delegators d
    LEFT JOIN users du ON du.id = d.delegator_user_id
    LEFT JOIN users bu ON bu.id = d.backup_user_id
    LEFT JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users uu ON uu.id = d.updated_by
    WHERE d.tenant_key = $1 AND d.project_key = $2 AND d.department_id = $3
    ORDER BY d.created_at DESC
  `, [scope.tenantKey, scope.projectKey, departmentId]);
  return rows;
}

async function setDepartmentDelegator(pool, scope, adminUser, departmentId, input = {}) {
  requireUuid(departmentId, 'Departemen');
  return withTransaction(pool, async (db) => {
    const dept = await db.query(`SELECT id, name FROM workforce_departments WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND is_active`,
      [departmentId, scope.tenantKey, scope.projectKey]);
    if (!dept.rows[0]) throw mobileError('Departemen tidak ditemukan', 'NOT_FOUND', 404);
    const deptName = dept.rows[0].name;
    const delegatorId = requireUuid(input.delegator_user_id, 'Delegator');
    const backupId = input.backup_user_id ? requireUuid(input.backup_user_id, 'Delegator cadangan') : null;
    if (backupId && backupId === delegatorId) throw mobileError('Delegator cadangan harus orang yang berbeda');
    const members = await db.query(`
      SELECT id, nama FROM users WHERE id = ANY($1::uuid[]) AND is_active = TRUE
        AND lower(trim(COALESCE(departemen, ''))) = lower(trim($2))
    `, [[delegatorId, backupId].filter(Boolean), deptName]);
    if (!members.rows.some(r => String(r.id) === delegatorId)) throw mobileError(`Delegator harus karyawan aktif di departemen ${deptName}`);
    if (backupId && !members.rows.some(r => String(r.id) === backupId)) throw mobileError(`Delegator cadangan harus karyawan aktif di departemen ${deptName}`);
    const validFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(input.valid_from || '')) ? input.valid_from : wibDate();
    const validTo = /^\d{4}-\d{2}-\d{2}$/.test(String(input.valid_to || '')) ? input.valid_to : null;
    if (validTo && validTo < validFrom) throw mobileError('Tanggal akhir harus setelah tanggal mulai');

    await db.query(`UPDATE hse_department_delegators SET is_active = FALSE, valid_to = COALESCE(valid_to, $4::date), updated_by = $5, updated_at = now()
                    WHERE tenant_key = $1 AND project_key = $2 AND department_id = $3 AND is_active`,
    [scope.tenantKey, scope.projectKey, departmentId, wibDate(), adminUser.id]);
    const { rows } = await db.query(`
      INSERT INTO hse_department_delegators (tenant_key, project_key, department_id, delegator_user_id, backup_user_id, valid_from, valid_to, notes, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *
    `, [scope.tenantKey, scope.projectKey, departmentId, delegatorId, backupId, validFrom, validTo, cleanText(input.notes, 500), adminUser.id]);
    await optionalInTx(db, `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, $3)`, [
      adminUser.id, `[HSE] Set Delegator Departemen ${deptName}`,
      JSON.stringify({ department_id: departmentId, delegator_user_id: delegatorId, backup_user_id: backupId, valid_from: validFrom, valid_to: validTo }),
    ]);
    await notify(db, scope, [delegatorId, backupId], {
      kind: 'DELEGATOR_ASSIGNED', title: `Anda ditetapkan sebagai Delegator Dept. ${deptName}`,
      body: 'Menu Delegasi PIC kini tersedia di OMOS Safety.', ref_type: 'DEPARTMENT', ref_id: departmentId,
    });
    return rows[0];
  });
}

async function removeDepartmentDelegator(pool, scope, adminUser, departmentId) {
  requireUuid(departmentId, 'Departemen');
  return withTransaction(pool, async (db) => {
    const { rowCount } = await db.query(`
      UPDATE hse_department_delegators SET is_active = FALSE, valid_to = COALESCE(valid_to, $4::date), updated_by = $5, updated_at = now()
      WHERE tenant_key = $1 AND project_key = $2 AND department_id = $3 AND is_active
    `, [scope.tenantKey, scope.projectKey, departmentId, wibDate(), adminUser.id]);
    await optionalInTx(db, `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, $3)`, [
      adminUser.id, '[HSE] Nonaktifkan Delegator Departemen', JSON.stringify({ department_id: departmentId }),
    ]);
    return { ok: true, deactivated: rowCount };
  });
}

module.exports = {
  SLA_HOURS,
  MAX_EXTENSIONS,
  ITEM_TYPES,
  STORAGE_POLICY,
  dueAtFor,
  endOfWibDay,
  incidentTypeFor,
  deriveUuid,
  canReporterEdit,
  loadProfile,
  isHseStaff,
  getBootstrap,
  syncItems,
  processSyncItem,
  getMyReports,
  getHazardDetailForMobile,
  getPicActions,
  getVerifyQueue,
  getDelegatorInbox,
  getMySchedules,
  getEventParticipants,
  getMyStats,
  listNotifications,
  markNotificationsRead,
  escalateOverdueActions,
  startEscalationWorker,
  listDepartmentDelegators,
  listDelegatorHistory,
  setDepartmentDelegator,
  removeDepartmentDelegator,
};
