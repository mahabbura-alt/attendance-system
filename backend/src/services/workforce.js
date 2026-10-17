'use strict';

/**
 * OMOS People — mesin pergerakan karyawan (satu-satunya penulis penempatan).
 *
 * v2 (2026-10-12):
 * - Alasan wajib diisi manual; site teks bebas; departemen/jabatan WAJIB dari
 *   master (tidak lagi membuat master otomatis dari teks).
 * - Jenis baru: CONFIRMATION (lulus probation), CONTRACT_RENEWAL,
 *   EMPLOYMENT_TYPE_CHANGE.
 * - Keluar memakai hari kerja terakhir: setelah disetujui status NOTICE,
 *   diterapkan (akun nonaktif) H+1 oleh penjadwal harian.
 * - Pemisahan peran: pembuat ≠ penyetuju; penyetuju butuh izin
 *   `people.approve` (super admin selalu boleh; menyetujui pengajuan sendiri
 *   hanya dengan alasan tertulis bila diizinkan pengaturan).
 * - Efek lintas modul ditulis ke `people_outbox` (idempoten).
 */

const Org = require('./peopleOrg');

const MOVEMENT_TYPES = new Set(['HIRE','REHIRE','TRANSFER','PROMOTION','DEMOTION','RESIGN','TERMINATION','CONTRACT_END','RETIREMENT',
  'CONFIRMATION','CONTRACT_RENEWAL','EMPLOYMENT_TYPE_CHANGE']);
const EXIT_TYPES = new Set(['RESIGN','TERMINATION','CONTRACT_END','RETIREMENT']);
const ASSIGNMENT_TYPES = new Set(['HIRE','REHIRE','TRANSFER','PROMOTION','DEMOTION']);
const STATUS_TYPES = new Set(['CONFIRMATION','CONTRACT_RENEWAL','EMPLOYMENT_TYPE_CHANGE']);
const EMPLOYMENT_TYPES = Object.freeze({ PKWT: 'PKWT', PKWTT: 'PKWTT', HARIAN: 'Harian' });
const APPROVE_PERMISSION = 'people.approve';
const MOVEMENT_TRANSITIONS = Object.freeze({
  DRAFT: new Set(['SUBMITTED','CANCELLED']),
  SUBMITTED: new Set(['APPROVED','REJECTED','CANCELLED']),
  APPROVED: new Set(['EFFECTIVE','CANCELLED']),
  REJECTED: new Set(), EFFECTIVE: new Set(), CANCELLED: new Set(),
});

function httpError(message, statusCode = 422, code = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function scopeFromUser(user = {}) {
  return {
    tenantKey: String(user.tenant_id || user.tenantId || 'default'),
    projectKey: String(user.project_id || user.projectId || 'default'),
  };
}

function dateOnly(value, field = 'Tanggal') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    const error = new Error(`${field} harus berformat YYYY-MM-DD.`);
    error.statusCode = 422;
    throw error;
  }
  return text;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Tanggal hari ini menurut WIB (operasional site). */
function todayWib(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function monthPeriod(value, reference = new Date()) {
  const fallback = `${reference.getUTCFullYear()}-${String(reference.getUTCMonth() + 1).padStart(2, '0')}`;
  const period = String(value || fallback).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    const error = new Error('Periode MPP harus berformat YYYY-MM.');
    error.statusCode = 422;
    throw error;
  }
  const [year, month] = period.split('-').map(Number);
  if (year < 2000 || year > 2200) {
    const error = new Error('Tahun MPP tidak valid.');
    error.statusCode = 422;
    throw error;
  }
  const from = `${period}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { period, year, month, from, to };
}

function normalizeMovementType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (!MOVEMENT_TYPES.has(type)) {
    const error = new Error('Jenis pergerakan tidak valid.');
    error.statusCode = 422;
    throw error;
  }
  return type;
}

function normalizeEmploymentType(value, { required = false } = {}) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) {
    if (required) throw httpError('Tipe kerja wajib dipilih (PKWT / PKWTT / Harian).');
    return null;
  }
  const canonical = EMPLOYMENT_TYPES[raw.toUpperCase()];
  if (!canonical) throw httpError('Tipe kerja harus PKWT, PKWTT, atau Harian.');
  return canonical;
}

const STATE_KEYS = ['department','position','department_id','position_id','site','company','grade',
  'supervisor_user_id','employment_type','work_pattern','probation_end_date'];

function cleanState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(STATE_KEYS
    .filter(key => value[key] !== undefined)
    .map(key => [key, value[key] == null ? null : String(value[key]).replace(/\s+/g, ' ').trim() || null]));
}

function hasPermission(user, permission) {
  let perms = user?.permissions;
  if (typeof perms === 'string') {
    try { perms = JSON.parse(perms); } catch (_) { perms = perms.replace(/[{}"]/g, '').split(','); }
  }
  return Array.isArray(perms) && perms.map(p => String(p).trim()).includes(permission);
}

async function ensureProfile(db, userId, tenantKey = 'default') {
  const result = await db.query(`
    INSERT INTO workforce_employee_profiles
      (tenant_key,user_id,employee_number,hire_date,employment_status,source)
    SELECT $2,u.id,u.employee_id,u.created_at::date,
           CASE WHEN u.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END,'runtime_backfill'
    FROM users u WHERE u.id=$1 AND u.role='karyawan'
    ON CONFLICT (user_id) DO UPDATE SET
      employee_number=EXCLUDED.employee_number,updated_at=CURRENT_TIMESTAMP
    RETURNING *
  `, [userId, tenantKey]);
  if (!result.rows[0]) {
    const error = new Error('Karyawan tidak ditemukan.');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

async function currentState(db, profileId, scope) {
  const result = await db.query(`
    SELECT a.*,u.nama,u.employee_id,u.is_active,u.jabatan AS user_jabatan,u.departemen AS user_departemen
    FROM workforce_employee_profiles p
    JOIN users u ON u.id=p.user_id
    LEFT JOIN workforce_employee_assignments a ON a.employee_profile_id=p.id
      AND a.tenant_key=$2 AND a.project_key=$3 AND a.status='ACTIVE' AND a.effective_to IS NULL
    WHERE p.id=$1 AND p.tenant_key=$2 AND p.deleted_at IS NULL
    ORDER BY a.effective_from DESC NULLS LAST LIMIT 1
  `, [profileId, scope.tenantKey, scope.projectKey]);
  if (!result.rows[0]) {
    const error = new Error('Profil karyawan tidak ditemukan pada scope ini.');
    error.statusCode = 404;
    throw error;
  }
  const row = result.rows[0];
  return {
    department: row.department_snapshot || row.user_departemen || null,
    position: row.position_snapshot || row.user_jabatan || null,
    department_id: row.department_id || null,
    position_id: row.position_id || null,
    site: row.site_name || null,
    company: row.company_name || null,
    grade: row.grade || null,
    supervisor_user_id: row.supervisor_user_id || null,
    employment_type: row.employment_type || null,
    work_pattern: row.work_pattern || null,
  };
}

/**
 * Pasangan departemen–jabatan dari master (ID atau nama). Tidak pernah
 * membuat departemen/jabatan baru — nilai di luar master ditolak 422.
 */
async function ensureOrg(db, scope, state) {
  if (!state.position_id && !(state.department && state.position)) {
    throw httpError('Departemen dan jabatan tujuan wajib dipilih dari master.');
  }
  const resolved = await Org.resolvePosition(db, scope, {
    position_id: state.position_id || null,
    department_id: state.position_id ? state.department_id || null : null,
    department: state.department,
    position: state.position,
  });
  return {
    departmentId: resolved.department_id,
    positionId: resolved.position_id,
    department: resolved.department_name,
    position: resolved.position_name,
  };
}

async function insertAudit(db, movementId, action, before, after, actorId, reason = null) {
  await db.query(`INSERT INTO workforce_movement_audit
    (movement_id,action,previous_value,new_value,actor_id,reason)
    VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6)`,
  [movementId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, actorId, reason]);
}

async function emitOutbox(db, scope, eventType, aggregateId, dedupeKey, payload) {
  await db.query(`INSERT INTO people_outbox (tenant_key,event_type,aggregate_id,dedupe_key,payload)
    VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (tenant_key,event_type,dedupe_key) DO NOTHING`,
  [scope.tenantKey, eventType, aggregateId, dedupeKey, JSON.stringify(payload || {})]);
}

async function nextMovementNo(db, effectiveDate) {
  const numberResult = await db.query(`SELECT nextval('workforce_movement_no_seq')::bigint AS seq`);
  return `MOV-${effectiveDate.slice(2,7).replace('-','')}-${String(numberResult.rows[0].seq).padStart(6,'0')}`;
}

function requireReason(input) {
  const reason = String(input.reason || '').replace(/\s+/g, ' ').trim();
  if (reason.length < 3) throw httpError('Alasan pergerakan wajib diisi (ketik manual, minimal 3 karakter).');
  if (reason.length > 500) throw httpError('Alasan maksimal 500 karakter.');
  return reason;
}

async function createMovement(pool, user, input = {}, idempotencyKey = null) {
  const scope = scopeFromUser(user);
  const type = normalizeMovementType(input.movement_type);
  const employeeUserId = String(input.employee_id || '').trim();
  if (!employeeUserId) throw httpError('Karyawan wajib dipilih.');
  const reason = requireReason(input);

  // Tanggal: keluar memakai hari kerja terakhir; efektif = H+1.
  let effectiveDate;
  let lastWorkingDay = null;
  if (EXIT_TYPES.has(type)) {
    lastWorkingDay = dateOnly(input.last_working_day || input.effective_date, 'Hari kerja terakhir');
    effectiveDate = addDays(lastWorkingDay, 1);
  } else {
    effectiveDate = dateOnly(input.effective_date, 'Tanggal efektif');
  }

  const extra = { contract_no: null, contract_start_date: null, contract_end_date: null, evaluation_result: null,
    rehire_eligible: null };
  if (EXIT_TYPES.has(type) && input.rehire_eligible !== undefined) {
    extra.rehire_eligible = input.rehire_eligible === true || input.rehire_eligible === 'true';
  }
  if (type === 'CONFIRMATION') {
    const result = String(input.evaluation_result || 'PASSED').trim().toUpperCase();
    if (result === 'FAILED') {
      throw httpError('Karyawan tidak lulus probation: catat sebagai pergerakan Terminasi dengan alasan hasil probation.');
    }
    if (!['PASSED','EXTENDED'].includes(result)) throw httpError('Hasil evaluasi harus Lulus atau Diperpanjang.');
    extra.evaluation_result = result;
  }
  if (type === 'CONTRACT_RENEWAL') {
    extra.contract_end_date = dateOnly(input.contract_end_date, 'Tanggal akhir kontrak');
    if (input.contract_start_date) extra.contract_start_date = dateOnly(input.contract_start_date, 'Tanggal mulai kontrak');
    if (extra.contract_start_date && extra.contract_end_date < extra.contract_start_date) {
      throw httpError('Tanggal akhir kontrak harus setelah tanggal mulai.');
    }
    extra.contract_no = String(input.contract_no || '').trim() || null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (idempotencyKey) {
      const existing = await client.query(`SELECT * FROM workforce_employee_movements
        WHERE tenant_key=$1 AND project_key=$2 AND idempotency_key=$3`,
      [scope.tenantKey, scope.projectKey, idempotencyKey]);
      if (existing.rows[0]) { await client.query('COMMIT'); return existing.rows[0]; }
    }
    const profile = await ensureProfile(client, employeeUserId, scope.tenantKey);
    if (profile.voided_at) throw httpError('Karyawan ini sudah di-Void.', 409);
    const conflict = await client.query(`SELECT movement_no,movement_type,status FROM workforce_employee_movements
      WHERE tenant_key=$1 AND project_key=$2 AND employee_profile_id=$3
        AND status IN ('DRAFT','SUBMITTED','APPROVED') LIMIT 1 FOR UPDATE`,
    [scope.tenantKey, scope.projectKey, profile.id]);
    if (conflict.rows[0]) {
      throw httpError(`Masih ada pergerakan aktif ${conflict.rows[0].movement_no}. Selesaikan atau batalkan terlebih dahulu.`, 409);
    }
    if (type === 'REHIRE' && profile.employment_status !== 'INACTIVE') throw httpError('Rehire hanya untuk karyawan yang sudah keluar.', 409);
    if (type !== 'REHIRE' && type !== 'HIRE' && profile.employment_status === 'INACTIVE') {
      throw httpError('Karyawan sudah keluar. Gunakan Rehire.', 409);
    }
    const before = await currentState(client, profile.id, scope);
    const requested = cleanState(input.after_state);
    let after = { ...before, ...requested };

    if (ASSIGNMENT_TYPES.has(type)) {
      const hasNewOrg = requested.position_id || requested.position || requested.department;
      const org = await ensureOrg(client, scope, hasNewOrg ? {
        position_id: requested.position_id, department_id: requested.department_id,
        department: requested.department ?? before.department, position: requested.position ?? before.position,
      } : before);
      after = { ...after, department: org.department, position: org.position, department_id: org.departmentId, position_id: org.positionId };
      if (requested.employment_type !== undefined) after.employment_type = normalizeEmploymentType(requested.employment_type);
      if (['TRANSFER','PROMOTION','DEMOTION'].includes(type)) {
        const same = k => String(after[k] || '').trim().toLowerCase() === String(before[k] || '').trim().toLowerCase();
        if (same('position_id') && same('site') && same('employment_type')) {
          throw httpError('Tidak ada perubahan penempatan: pilih jabatan atau isi site tujuan yang berbeda.');
        }
      }
    } else if (type === 'EMPLOYMENT_TYPE_CHANGE') {
      const next = normalizeEmploymentType(requested.employment_type, { required: true });
      if (next === before.employment_type) throw httpError(`Tipe kerja sudah ${next}.`);
      if (next === 'PKWT') extra.contract_end_date = dateOnly(input.contract_end_date, 'Tanggal akhir kontrak');
      after = { ...before, employment_type: next };
    } else if (type === 'CONFIRMATION') {
      after = { ...before };
      if (extra.evaluation_result === 'EXTENDED') {
        after.probation_end_date = dateOnly(requested.probation_end_date || input.probation_end_date, 'Probation berakhir (baru)');
      }
    } else if (EXIT_TYPES.has(type)) {
      after = { ...before };
    }

    const movementNo = await nextMovementNo(client, effectiveDate);
    let manpowerRequestId = null;
    if (input.manpower_request_id != null && String(input.manpower_request_id).trim() !== '') {
      const linked = await client.query(`SELECT id, status FROM workforce_manpower_requests
        WHERE id=$1 AND tenant_key=$2 AND project_key=$3`,
      [String(input.manpower_request_id).trim(), scope.tenantKey, scope.projectKey]);
      if (!linked.rows[0]) throw httpError('Manpower Request tertaut tidak ditemukan pada scope ini.');
      if (['FULFILLED','CANCELLED','REJECTED'].includes(linked.rows[0].status)) {
        throw httpError(`Manpower Request tertaut sudah ${linked.rows[0].status}.`);
      }
      manpowerRequestId = linked.rows[0].id;
    }
    const result = await client.query(`
      INSERT INTO workforce_employee_movements
        (tenant_key,project_key,movement_no,employee_profile_id,movement_type,request_date,effective_date,
         reason_text,notes,before_state,after_state,status,idempotency_key,manpower_request_id,created_by,updated_by,
         last_working_day,contract_no,contract_start_date,contract_end_date,evaluation_result,rehire_eligible)
      VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6,$7,$8,$9::jsonb,$10::jsonb,'DRAFT',$11,$12,$13,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *
    `, [scope.tenantKey, scope.projectKey, movementNo, profile.id, type, effectiveDate,
      reason, String(input.notes || '').trim() || null,
      JSON.stringify(before), JSON.stringify(after), idempotencyKey || null, manpowerRequestId, user.id,
      lastWorkingDay, extra.contract_no, extra.contract_start_date, extra.contract_end_date, extra.evaluation_result,
      extra.rehire_eligible]);
    const movement = result.rows[0];
    const taskKind = EXIT_TYPES.has(type) ? 'OFFBOARDING' : (type === 'HIRE' || type === 'REHIRE' ? 'ONBOARDING' : null);
    const taskNames = taskKind === 'ONBOARDING'
      ? [['MCU','Medical Check Up'],['INDUCTION','Safety Induction'],['APD','Pembagian APD'],['ACCESS','Akses dan ID Site']]
      : taskKind === 'OFFBOARDING'
        ? [['ACCESS','Cabut akses sistem/site'],['ASSET','Pengembalian aset/APD'],['SETTLEMENT','Final settlement'],['FACE','Arsip foto wajah']]
        : [];
    for (const [code, name] of taskNames) {
      await client.query(`INSERT INTO workforce_movement_tasks
        (movement_id,task_kind,task_code,task_name) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [movement.id, taskKind, code, name]);
    }
    await insertAudit(client, movement.id, 'CREATE', null, movement, user.id);
    await client.query('COMMIT');
    return movement;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

/**
 * Catat "Masuk" langsung efektif untuk karyawan baru dari Tambah karyawan /
 * import. Departemen & jabatan wajib dari master.
 */
async function recordInitialHire(db, actor, employee, stateInput = {}) {
  const scope = scopeFromUser(actor);
  const profile = await ensureProfile(db, employee.id, scope.tenantKey);
  const state = cleanState({
    department: stateInput.department || employee.departemen,
    position: stateInput.position || employee.jabatan,
    department_id: stateInput.department_id,
    position_id: stateInput.position_id,
    site: stateInput.site,
    company: stateInput.company,
    grade: stateInput.grade,
    employment_type: stateInput.employment_type,
    work_pattern: stateInput.work_pattern,
    supervisor_user_id: stateInput.supervisor_user_id,
  });
  const org = await ensureOrg(db, scope, state);
  state.department = org.department;
  state.position = org.position;
  state.department_id = org.departmentId;
  state.position_id = org.positionId;
  state.employment_type = normalizeEmploymentType(state.employment_type);
  const effectiveDate = dateOnly(stateInput.effective_date || todayWib(), 'Tanggal masuk');
  const movementNo = await nextMovementNo(db, effectiveDate);
  const movement = (await db.query(`INSERT INTO workforce_employee_movements
    (tenant_key,project_key,movement_no,employee_profile_id,movement_type,request_date,effective_date,
     reason_text,before_state,after_state,status,submitted_at,approved_by,approved_at,effective_by,effective_at,created_by,updated_by,
     manpower_request_id)
    VALUES ($1,$2,$3,$4,'HIRE',CURRENT_DATE,$5,$6,'{}'::jsonb,$7::jsonb,
      'EFFECTIVE',CURRENT_TIMESTAMP,$8,CURRENT_TIMESTAMP,$8,CURRENT_TIMESTAMP,$8,$8,$9)
    RETURNING *`, [scope.tenantKey, scope.projectKey, movementNo, profile.id, effectiveDate,
    stateInput.reason || 'Pendaftaran karyawan baru', JSON.stringify(state), actor.id, stateInput.manpower_request_id || null])).rows[0];
  await db.query(`INSERT INTO workforce_employee_assignments
    (tenant_key,project_key,employee_profile_id,department_id,position_id,department_snapshot,position_snapshot,
     site_name,company_name,grade,supervisor_user_id,employment_type,work_pattern,effective_from,status,source,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE','movement',$15)
    ON CONFLICT DO NOTHING`, [scope.tenantKey, scope.projectKey, profile.id, org.departmentId, org.positionId,
      state.department, state.position, state.site, state.company, state.grade, state.supervisor_user_id || null,
      state.employment_type, state.work_pattern, effectiveDate, actor.id]);
  await db.query(`UPDATE users SET jabatan=$1, departemen=$2 WHERE id=$3`, [state.position, state.department, employee.id]);
  await db.query(`UPDATE workforce_employee_profiles SET employment_status='PROBATION',hire_date=COALESCE(hire_date,$2),
    grade=$3,employment_type=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
  [profile.id, effectiveDate, state.grade, state.employment_type]);
  for (const [code,name] of [['MCU','Medical Check Up'],['INDUCTION','Safety Induction'],['APD','Pembagian APD'],['ACCESS','Akses dan ID Site']]) {
    await db.query(`INSERT INTO workforce_movement_tasks (movement_id,task_kind,task_code,task_name)
      VALUES ($1,'ONBOARDING',$2,$3) ON CONFLICT DO NOTHING`, [movement.id,code,name]);
  }
  await insertAudit(db, movement.id, 'CREATE_EFFECTIVE_HIRE', null, movement, actor.id);
  if (movement.manpower_request_id) {
    const Manpower = require('./workforceManpower');
    await Manpower.linkMovementFulfillment(db, scope, movement, actor.id);
  }
  await emitOutbox(db, scope, 'EMPLOYEE_HIRED', profile.id, movement.id, {
    movement_id: movement.id, user_id: employee.id, effective_date: effectiveDate,
    department_id: org.departmentId, position_id: org.positionId,
  }).catch(() => {});
  return movement;
}

async function applyEffectiveMovement(db, movement, actorId, scope, today = todayWib()) {
  const effectiveDate = isoDate(movement.effective_date);
  if (effectiveDate > today) {
    const error = new Error(EXIT_TYPES.has(movement.movement_type)
      ? 'Karyawan masih dalam masa notice sampai hari kerja terakhir.'
      : 'Pergerakan belum mencapai tanggal efektif.');
    error.statusCode = 409; throw error;
  }
  const profileResult = await db.query(`SELECT p.*,u.id AS user_id FROM workforce_employee_profiles p
    JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND p.tenant_key=$2 FOR UPDATE`,
  [movement.employee_profile_id, scope.tenantKey]);
  const profile = profileResult.rows[0];
  if (!profile) { const error = new Error('Profil karyawan tidak ditemukan.'); error.statusCode = 404; throw error; }
  const state = cleanState(movement.after_state);
  if (ASSIGNMENT_TYPES.has(movement.movement_type)) {
    const org = await ensureOrg(db, scope, state);
    await db.query(`UPDATE workforce_employee_assignments SET
      effective_to=($4::date - 1),status='CLOSED',updated_at=CURRENT_TIMESTAMP
      WHERE tenant_key=$1 AND project_key=$2 AND employee_profile_id=$3
        AND status='ACTIVE' AND effective_to IS NULL`,
    [scope.tenantKey, scope.projectKey, profile.id, effectiveDate]);
    await db.query(`INSERT INTO workforce_employee_assignments
      (tenant_key,project_key,employee_profile_id,department_id,position_id,department_snapshot,
       position_snapshot,site_name,company_name,grade,supervisor_user_id,employment_type,work_pattern,
       effective_from,status,source,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE','movement',$15)`,
    [scope.tenantKey, scope.projectKey, profile.id, org.departmentId, org.positionId,
      org.department, org.position, state.site, state.company, state.grade,
      state.supervisor_user_id || null, state.employment_type, state.work_pattern,
      effectiveDate, actorId]);
    await db.query(`UPDATE users SET departemen=$1,jabatan=$2,is_active=TRUE WHERE id=$3`,
      [org.department, org.position, profile.user_id]);
    await db.query(`UPDATE workforce_employee_profiles SET
      employment_status=CASE WHEN $1 IN ('HIRE','REHIRE') THEN 'PROBATION' ELSE employment_status END,
      grade=COALESCE($2,grade),employment_type=COALESCE($3,employment_type),last_working_day=NULL,
      updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
    [movement.movement_type, state.grade, state.employment_type, profile.id]);
    await emitOutbox(db, scope, ['HIRE','REHIRE'].includes(movement.movement_type) ? 'EMPLOYEE_HIRED' : 'ASSIGNMENT_CHANGED',
      profile.id, movement.id, { movement_id: movement.id, user_id: profile.user_id, effective_date: effectiveDate,
        department_id: org.departmentId, position_id: org.positionId });
  } else if (EXIT_TYPES.has(movement.movement_type)) {
    const lastDay = isoDate(movement.last_working_day) || effectiveDate;
    await db.query(`UPDATE workforce_employee_assignments SET effective_to=$4,status='CLOSED',updated_at=CURRENT_TIMESTAMP
      WHERE tenant_key=$1 AND project_key=$2 AND employee_profile_id=$3 AND status='ACTIVE' AND effective_to IS NULL`,
    [scope.tenantKey, scope.projectKey, profile.id, lastDay]);
    await db.query(`UPDATE users SET is_active=FALSE WHERE id=$1`, [profile.user_id]);
    await db.query(`UPDATE workforce_employee_profiles SET employment_status='INACTIVE',last_working_day=$2,
      rehire_eligible=COALESCE($3,rehire_eligible),updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [profile.id, lastDay, movement.rehire_eligible]);
    await emitOutbox(db, scope, 'EMPLOYEE_EXITED', profile.id, movement.id, {
      movement_id: movement.id, user_id: profile.user_id, movement_type: movement.movement_type, last_working_day: lastDay,
    });
  } else if (movement.movement_type === 'CONFIRMATION') {
    if (movement.evaluation_result === 'EXTENDED') {
      await db.query(`UPDATE workforce_employee_profiles SET probation_end_date=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [profile.id, state.probation_end_date]);
    } else {
      await db.query(`UPDATE workforce_employee_profiles SET employment_status='ACTIVE',
        probation_end_date=COALESCE(probation_end_date,$2),updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [profile.id, effectiveDate]);
    }
  } else if (movement.movement_type === 'CONTRACT_RENEWAL') {
    await db.query(`UPDATE workforce_employee_profiles SET contract_end_date=$2,contract_no=COALESCE($3,contract_no),
      updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [profile.id, isoDate(movement.contract_end_date), movement.contract_no]);
  } else if (movement.movement_type === 'EMPLOYMENT_TYPE_CHANGE') {
    const type = state.employment_type;
    await db.query(`UPDATE workforce_employee_profiles SET employment_type=$2,
      contract_end_date=CASE WHEN $2='PKWT' THEN $3::date ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [profile.id, type, isoDate(movement.contract_end_date)]);
    await db.query(`UPDATE workforce_employee_assignments SET employment_type=$4,updated_at=CURRENT_TIMESTAMP
      WHERE tenant_key=$1 AND project_key=$2 AND employee_profile_id=$3 AND status='ACTIVE' AND effective_to IS NULL`,
    [scope.tenantKey, scope.projectKey, profile.id, type]);
  }
}

async function readSettings(db, tenantKey) {
  const { rows } = await db.query(`SELECT allow_super_admin_self_approval, require_checklist_before_effective
    FROM people_settings WHERE tenant_key=$1`, [tenantKey]).catch(() => ({ rows: [] }));
  return {
    allowSelfApproval: rows[0] ? rows[0].allow_super_admin_self_approval !== false : true,
    requireChecklist: rows[0] ? rows[0].require_checklist_before_effective === true : false,
  };
}

/** Maker ≠ checker. Super admin boleh menyetujui pengajuan sendiri hanya dengan alasan. */
function assertCanDecide(user, movement, target, input, settings) {
  const isSuper = user?.is_super_admin === true;
  if (!isSuper && !hasPermission(user, APPROVE_PERMISSION)) {
    throw httpError('Anda tidak memiliki izin menyetujui pergerakan karyawan (people.approve).', 403, 'PEOPLE_APPROVE_FORBIDDEN');
  }
  if (target === 'APPROVED' && String(movement.created_by) === String(user.id)) {
    const reason = String(input.self_approval_reason || '').trim();
    if (!isSuper || !settings.allowSelfApproval) {
      throw httpError('Pengajuan yang Anda buat sendiri harus disetujui admin lain.', 403, 'SELF_APPROVAL_FORBIDDEN');
    }
    if (reason.length < 5) {
      throw httpError('Menyetujui pengajuan sendiri wajib disertai alasan tertulis.', 403, 'SELF_APPROVAL_REASON_REQUIRED');
    }
    return reason;
  }
  return null;
}

async function transitionMovement(pool, user, movementId, nextStatus, input = {}, opts = {}) {
  const scope = scopeFromUser(user);
  const target = String(nextStatus || '').trim().toUpperCase();
  const today = opts.today || todayWib();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT m.*,m.effective_date::text AS effective_date,
        m.last_working_day::text AS last_working_day,m.contract_end_date::text AS contract_end_date
      FROM workforce_employee_movements m
      WHERE id=$1 AND tenant_key=$2 AND project_key=$3 FOR UPDATE`,
    [movementId, scope.tenantKey, scope.projectKey]);
    const movement = result.rows[0];
    if (!movement) { const error = new Error('Pergerakan tidak ditemukan.'); error.statusCode = 404; throw error; }
    if (movement.status === target) {
      await client.query('COMMIT');
      return movement;
    }
    if (!MOVEMENT_TRANSITIONS[movement.status]?.has(target)) {
      const error = new Error(`Transisi ${movement.status} → ${target} tidak diizinkan.`); error.statusCode = 409; throw error;
    }
    const settings = await readSettings(client, scope.tenantKey);
    let selfReason = null;
    if (target === 'APPROVED' || target === 'REJECTED') selfReason = assertCanDecide(user, movement, target, input, settings);
    if (target === 'SUBMITTED') {
      await client.query(`INSERT INTO workforce_movement_approvals
        (movement_id,step_no,step_label,decision) VALUES ($1,1,'Persetujuan HR','PENDING') ON CONFLICT DO NOTHING`, [movement.id]);
    }
    if (target === 'APPROVED' || target === 'REJECTED') {
      await client.query(`UPDATE workforce_movement_approvals SET decision=$4,approver_user_id=$2,
        decided_at=CURRENT_TIMESTAMP,comment=$3 WHERE movement_id=$1 AND step_no=1`,
      [movement.id, user.id, String(input.comment || selfReason || '').trim() || null, target]);
    }
    if (target === 'APPROVED' && EXIT_TYPES.has(movement.movement_type)) {
      await client.query(`UPDATE workforce_employee_profiles SET employment_status='NOTICE',
        last_working_day=COALESCE($2::date,last_working_day),updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND employment_status <> 'INACTIVE'`, [movement.employee_profile_id, movement.last_working_day]);
    }
    if (target === 'CANCELLED' && movement.status === 'APPROVED' && EXIT_TYPES.has(movement.movement_type)) {
      await client.query(`UPDATE workforce_employee_profiles SET employment_status='ACTIVE',last_working_day=NULL,
        updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND employment_status='NOTICE'`, [movement.employee_profile_id]);
    }
    if (target === 'EFFECTIVE') {
      if (settings.requireChecklist) {
        const open = await client.query(`SELECT COUNT(*)::int AS n FROM workforce_movement_tasks
          WHERE movement_id=$1 AND is_required AND status NOT IN ('DONE','WAIVED')`, [movement.id]);
        if (open.rows[0].n) throw httpError(`Masih ada ${open.rows[0].n} checklist wajib yang belum selesai.`, 409, 'CHECKLIST_OPEN');
      }
      await applyEffectiveMovement(client, movement, user.id, scope, today);
    }
    if (target === 'EFFECTIVE' && ['HIRE', 'REHIRE'].includes(movement.movement_type) && movement.manpower_request_id) {
      const Manpower = require('./workforceManpower');
      await Manpower.linkMovementFulfillment(client, scope, movement, user.id);
    }
    const updated = await client.query(`UPDATE workforce_employee_movements SET status=$2,
      submitted_at=CASE WHEN $2='SUBMITTED' THEN CURRENT_TIMESTAMP ELSE submitted_at END,
      approved_by=CASE WHEN $2='APPROVED' THEN $3 ELSE approved_by END,
      approved_at=CASE WHEN $2='APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END,
      effective_by=CASE WHEN $2='EFFECTIVE' THEN $3 ELSE effective_by END,
      effective_at=CASE WHEN $2='EFFECTIVE' THEN CURRENT_TIMESTAMP ELSE effective_at END,
      cancelled_by=CASE WHEN $2='CANCELLED' THEN $3 ELSE cancelled_by END,
      cancelled_at=CASE WHEN $2='CANCELLED' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
      cancellation_reason=CASE WHEN $2='CANCELLED' THEN $4 ELSE cancellation_reason END,
      self_approval_reason=CASE WHEN $2='APPROVED' THEN $5 ELSE self_approval_reason END,
      revision=revision+1,updated_by=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
    [movement.id, target, user.id, String(input.reason || input.comment || '').trim() || null, selfReason]);
    await insertAudit(client, movement.id, `TRANSITION_${target}`, movement, updated.rows[0], user.id, input.comment || input.reason || selfReason || null);
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/**
 * Penjadwal harian (00:05 WIB): terapkan pergerakan disetujui yang jatuh
 * tempo. Untuk keluar, tanggal efektif = H+1 hari kerja terakhir.
 */
async function processDueMovements(pool, throughDate = todayWib(), opts = {}) {
  const dueDate = dateOnly(throughDate, 'Tanggal proses');
  const due = await pool.query(`SELECT id,tenant_key,project_key,COALESCE(approved_by,created_by) AS actor_id
    FROM workforce_employee_movements WHERE status='APPROVED' AND effective_date <= $1::date
    ORDER BY effective_date,created_at`, [dueDate]);
  const results = [];
  for (const row of due.rows) {
    try {
      const actorRow = (await pool.query(`SELECT id, is_super_admin, permissions FROM users WHERE id=$1`, [row.actor_id])).rows[0] || { id: row.actor_id };
      const movement = await transitionMovement(pool, {
        ...actorRow, tenant_id: row.tenant_key, project_id: row.project_key,
      }, row.id, 'EFFECTIVE', { comment: 'Diterapkan otomatis pada tanggal efektif.' }, { today: opts.today || dueDate });
      results.push({ id: row.id, status: movement.status });
    } catch (error) {
      results.push({ id: row.id, status: 'ERROR', error: error.message });
    }
  }
  return results;
}

module.exports = {
  MOVEMENT_TYPES, EXIT_TYPES, ASSIGNMENT_TYPES, STATUS_TYPES, APPROVE_PERMISSION,
  scopeFromUser, dateOnly, addDays, todayWib, monthPeriod, normalizeMovementType, normalizeEmploymentType,
  hasPermission, ensureProfile, currentState, ensureOrg, emitOutbox, createMovement, recordInitialHire,
  transitionMovement, processDueMovements,
};
