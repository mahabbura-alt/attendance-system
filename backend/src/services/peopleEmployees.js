'use strict';

/**
 * OMOS People — karyawan: tambah (satu-satunya pintu masuk), direktori,
 * profil, data pribadi, lokasi absen, keluarga, dan Void.
 *
 * `users` tetap identitas login; data HR ada di profil People. Kolom teks
 * `users.jabatan/departemen/employee_id` hanya salinan yang ditulis layanan
 * ini dan mesin pergerakan.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Org = require('./peopleOrg');
const Workforce = require('./workforce');

const { httpError, withTransaction } = Org;
const MARITAL = new Set(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']);
const RELATIONSHIPS = new Set(['SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'OTHER']);
const BLOOD = new Set(['A', 'B', 'AB', 'O']);
const STATUS_FILTERS = new Set(['ACTIVE_ALL', 'ACTIVE', 'PROBATION', 'NOTICE', 'INACTIVE', 'ALL', 'INCOMPLETE', 'ENDING_SOON']);

// ---------------------------------------------------------------------------
// Helper murni
// ---------------------------------------------------------------------------
function clean(value) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function optionalDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return Workforce.dateOnly(value, label);
}

function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 864e5);
}

function maskNik(nik) {
  if (!nik) return null;
  const s = String(nik);
  return s.length === 16 ? `${s.slice(0, 4)}••••••••${s.slice(12)}` : '••••';
}

function formatNrp(pattern, { date, seq }) {
  const p = String(pattern || '');
  const seqMatch = p.match(/\{SEQ([3-6])\}/);
  if (!seqMatch) throw httpError('Pola NRP wajib memuat {SEQ3}–{SEQ6}.');
  const [y, m] = String(date).split('-');
  return p
    .replace(/\{YYYY\}/g, y)
    .replace(/\{YY\}/g, y.slice(2))
    .replace(/\{MM\}/g, m)
    .replace(/\{SEQ([3-6])\}/g, (_, n) => String(seq).padStart(Number(n), '0'));
}

const COMPLETENESS_ITEMS = [
  ['nrp', 'NRP'], ['nik', 'NIK'], ['phone', 'No. HP'], ['birth_date', 'Tanggal lahir'], ['address', 'Alamat'],
  ['blood_type', 'Golongan darah'], ['emergency_contact_name', 'Kontak darurat'], ['has_face', 'Foto wajah'],
  ['has_cv', 'CV'], ['marital_status', 'Data keluarga'],
];

function completeness(row) {
  const missing = COMPLETENESS_ITEMS.filter(([key]) => !row[key]).map(([, label]) => label);
  return { percent: Math.round(((COMPLETENESS_ITEMS.length - missing.length) / COMPLETENESS_ITEMS.length) * 100), missing };
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError('Email login tidak valid.');
  return email;
}

function normalizeNik(value) {
  const nik = clean(value);
  if (!nik) return null;
  const digits = nik.replace(/[\s.-]/g, '');
  if (!/^[0-9]{16}$/.test(digits)) throw httpError('NIK KTP harus 16 digit angka.');
  return digits;
}

function normalizePhone(value) {
  const phone = clean(value);
  if (!phone) return null;
  if (!/^[0-9+() -]{6,20}$/.test(phone)) throw httpError('No. HP tidak valid.');
  return phone;
}

function normalizeBlood(value) {
  const b = clean(value);
  if (!b || b === '-' || b === '—') return null;
  const up = b.toUpperCase();
  if (!BLOOD.has(up)) throw httpError('Golongan darah harus A, B, AB, atau O.');
  return up;
}

// ---------------------------------------------------------------------------
// Akses dasar
// ---------------------------------------------------------------------------
async function readSettings(db, tenantKey) {
  const { rows } = await db.query(`SELECT * FROM people_settings WHERE tenant_key = $1`, [tenantKey]);
  if (rows[0]) return rows[0];
  await db.query(`INSERT INTO people_settings (tenant_key) VALUES ($1) ON CONFLICT DO NOTHING`, [tenantKey]);
  return (await db.query(`SELECT * FROM people_settings WHERE tenant_key = $1`, [tenantKey])).rows[0];
}

async function updateSettings(db, scope, user, input = {}) {
  const sets = [];
  const values = [];
  const add = (c, v) => { values.push(v); sets.push(`${c} = $${values.length}`); };
  if (input.nrp_pattern !== undefined) {
    const pattern = String(input.nrp_pattern || '').trim();
    formatNrp(pattern, { date: '2026-01-01', seq: 1 });
    if (pattern.length > 40) throw httpError('Pola NRP maksimal 40 karakter.');
    add('nrp_pattern', pattern);
  }
  if (input.probation_months !== undefined) {
    const n = Number(input.probation_months);
    if (!Number.isInteger(n) || n < 0 || n > 12) throw httpError('Lama probation 0–12 bulan.');
    add('probation_months', n);
  }
  if (input.require_checklist_before_effective !== undefined) add('require_checklist_before_effective', input.require_checklist_before_effective === true);
  if (input.allow_super_admin_self_approval !== undefined) add('allow_super_admin_self_approval', input.allow_super_admin_self_approval === true);
  await readSettings(db, scope.tenantKey);
  if (sets.length) {
    values.push(user?.id || null, scope.tenantKey);
    await db.query(`UPDATE people_settings SET ${sets.join(', ')}, updated_by = $${values.length - 1}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_key = $${values.length}`, values);
  }
  return getSettings(db, scope);
}

async function getSettings(db, scope, { today = Workforce.todayWib() } = {}) {
  const s = await readSettings(db, scope.tenantKey);
  return {
    nrp_pattern: s.nrp_pattern,
    nrp_next_preview: formatNrp(s.nrp_pattern, { date: today, seq: Number(s.nrp_seq) + 1 }),
    probation_months: Number(s.probation_months),
    require_checklist_before_effective: s.require_checklist_before_effective === true,
    allow_super_admin_self_approval: s.allow_super_admin_self_approval !== false,
    master_version: Number(s.master_version),
  };
}

async function nrpTaken(db, nrp, exceptUserId = null) {
  const { rows } = await db.query(`SELECT 1 FROM users WHERE lower(trim(employee_id)) = lower(trim($1))
    AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`, [nrp, exceptUserId]);
  return Boolean(rows[0]);
}

async function generateNrp(db, scope, hireDate) {
  const s = (await db.query(`SELECT nrp_pattern, nrp_seq FROM people_settings WHERE tenant_key = $1 FOR UPDATE`, [scope.tenantKey])).rows[0]
    || await readSettings(db, scope.tenantKey);
  let seq = Number(s.nrp_seq);
  for (let i = 0; i < 1000; i += 1) {
    seq += 1;
    const nrp = formatNrp(s.nrp_pattern, { date: hireDate, seq });
    if (!(await nrpTaken(db, nrp))) {
      await db.query(`UPDATE people_settings SET nrp_seq = $2 WHERE tenant_key = $1`, [scope.tenantKey, seq]);
      return nrp;
    }
  }
  throw httpError('Gagal membuat NRP unik. Periksa pola NRP.', 409);
}

async function userRow(db, userId) {
  const { rows } = await db.query(`SELECT u.*, p.id AS profile_id FROM users u
    LEFT JOIN workforce_employee_profiles p ON p.user_id = u.id
    WHERE u.id = $1 AND u.role = 'karyawan'`, [userId]);
  if (!rows[0]) throw httpError('Karyawan tidak ditemukan.', 404);
  return rows[0];
}

async function profileFor(db, scope, userId) {
  const u = await userRow(db, userId);
  const profile = u.profile_id ? { id: u.profile_id } : await Workforce.ensureProfile(db, userId, scope.tenantKey);
  return { user: u, profileId: profile.id };
}

async function fieldAudit(db, scope, profileId, entity, field, oldValue, newValue, reason, actorId) {
  await db.query(`INSERT INTO workforce_employee_field_audit
    (tenant_key, employee_profile_id, entity, field, old_value, new_value, reason, actor_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [scope.tenantKey, profileId, entity, field, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), reason || null, actorId || null]);
}

async function validateLocations(db, ids) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
  if (!unique.length) throw httpError('Pilih minimal satu lokasi absen.');
  const { rows } = await db.query(`SELECT id, nama_lokasi FROM lokasi_kantor WHERE id = ANY($1::uuid[])`, [unique])
    .catch(() => { throw httpError('Lokasi absen tidak valid.'); });
  if (rows.length !== unique.length) throw httpError('Sebagian lokasi absen tidak ditemukan.');
  return unique;
}

async function writeLocations(db, profileId, ids, actorId) {
  await db.query(`DELETE FROM employee_attendance_locations WHERE employee_profile_id = $1`, [profileId]);
  for (let i = 0; i < ids.length; i += 1) {
    await db.query(`INSERT INTO employee_attendance_locations (employee_profile_id, lokasi_kantor_id, is_primary, created_by)
      VALUES ($1, $2, $3, $4)`, [profileId, ids[i], i === 0, actorId || null]);
  }
}

// ---------------------------------------------------------------------------
// Tambah karyawan
// ---------------------------------------------------------------------------
function validatePersonal(input) {
  return {
    nik: normalizeNik(input.nik),
    birth_place: clean(input.birth_place),
    birth_date: optionalDate(input.birth_date, 'Tanggal lahir'),
    gender: (() => {
      const g = clean(input.gender);
      if (!g) return null;
      const up = g.toUpperCase().startsWith('L') || g.toUpperCase() === 'M' ? 'M' : g.toUpperCase().startsWith('P') || g.toUpperCase() === 'F' ? 'F' : null;
      if (!up) throw httpError('Jenis kelamin harus L atau P.');
      return up;
    })(),
    phone: normalizePhone(input.phone),
    address: clean(input.address),
    blood_type: normalizeBlood(input.blood_type),
    emergency_contact_name: clean(input.emergency_contact_name),
    emergency_contact_relation: clean(input.emergency_contact_relation),
    emergency_contact_phone: normalizePhone(input.emergency_contact_phone),
  };
}

/**
 * @param {object} input  nama, email, nik?, phone?, birth_date?, ..., position_id (atau department+position),
 *   hire_date, employment_type, contract_end_date (wajib PKWT), probation_end_date?, nrp?, site?,
 *   supervisor_user_id?, lokasi_ids[] (≥1, pertama = utama), shift_id?, password?, manpower_request_id?,
 *   marital_status?, family_members?
 */
async function createEmployee(db, scope, user, input = {}, opts = {}) {
  const today = opts.today || Workforce.todayWib();
  const nama = clean(input.nama);
  if (!nama || nama.length < 2) throw httpError('Nama lengkap wajib diisi.');
  if (nama.length > 150) throw httpError('Nama maksimal 150 karakter.');
  const email = normalizeEmail(input.email);
  const personal = validatePersonal(input);
  const hireDate = Workforce.dateOnly(input.hire_date, 'Tanggal masuk');
  const employmentType = Workforce.normalizeEmploymentType(input.employment_type, { required: true });
  const contractEnd = optionalDate(input.contract_end_date, 'Kontrak berakhir');
  if (employmentType === 'PKWT' && !contractEnd) throw httpError('Tanggal akhir kontrak wajib untuk PKWT.');
  if (contractEnd && contractEnd < hireDate) throw httpError('Akhir kontrak harus setelah tanggal masuk.');
  const password = input.password ? String(input.password) : null;
  if (password && password.length < 8) throw httpError('Password awal minimal 8 karakter.');
  const maritalStatus = clean(input.marital_status) ? String(input.marital_status).toUpperCase() : null;
  if (maritalStatus && !MARITAL.has(maritalStatus)) throw httpError('Status pernikahan tidak valid.');

  const actor = { ...user, tenant_id: scope.tenantKey, project_id: scope.projectKey };
  return withTransaction(db, async client => {
    const org = await Org.resolvePosition(client, scope, {
      position_id: input.position_id || null, department_id: input.position_id ? input.department_id || null : null,
      department: input.department, position: input.position,
    });
    const lokasiIds = await validateLocations(client, input.lokasi_ids);
    const settings = await readSettings(client, scope.tenantKey);
    const probationEnd = optionalDate(input.probation_end_date, 'Probation berakhir')
      || addMonths(hireDate, Number(settings.probation_months));

    if ((await client.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email])).rows[0]) {
      throw httpError(`Email ${email} sudah dipakai akun lain.`, 409, 'EMAIL_TAKEN');
    }
    if (personal.nik && (await client.query(`SELECT 1 FROM workforce_employee_personal WHERE tenant_key = $1 AND nik = $2`,
      [scope.tenantKey, personal.nik])).rows[0]) {
      throw httpError('NIK sudah terdaftar pada karyawan lain.', 409, 'NIK_TAKEN');
    }
    let nrp = clean(input.nrp);
    if (nrp) {
      if (nrp.length > 50) throw httpError('NRP maksimal 50 karakter.');
      if (await nrpTaken(client, nrp)) throw httpError(`NRP ${nrp} sudah dipakai.`, 409, 'NRP_TAKEN');
    } else {
      nrp = await generateNrp(client, scope, hireDate);
    }
    if (input.supervisor_user_id) {
      const sup = await client.query(`SELECT 1 FROM users WHERE id = $1 AND is_active`, [input.supervisor_user_id]).catch(() => ({ rows: [] }));
      if (!sup.rows[0]) throw httpError('Atasan langsung tidak ditemukan.');
    }

    const passwordHash = await bcrypt.hash(password || crypto.randomBytes(24).toString('hex'), password ? 12 : 4);
    const created = (await client.query(`
      INSERT INTO users (employee_id, nama, email, password_hash, role, jabatan, departemen, lokasi_kantor_id, shift_id, is_active)
      VALUES ($1, $2, $3, $4, 'karyawan', $5, $6, $7, $8, TRUE)
      RETURNING id, employee_id, nama, email, jabatan, departemen`,
    [nrp, nama, email, passwordHash, org.position_name, org.department_name, lokasiIds[0], input.shift_id || null])).rows[0];

    const profile = await Workforce.ensureProfile(client, created.id, scope.tenantKey);
    await client.query(`UPDATE workforce_employee_profiles SET employee_number = $2, hire_date = $3, employment_type = $4,
        contract_end_date = $5, probation_end_date = $6, contract_no = $7, source = 'people_v2', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`, [profile.id, nrp, hireDate, employmentType, contractEnd, probationEnd, clean(input.contract_no)]);
    await Workforce.recordInitialHire(client, actor, created, {
      position_id: org.position_id, department_id: org.department_id, effective_date: hireDate,
      employment_type: employmentType, site: clean(input.site), supervisor_user_id: input.supervisor_user_id || null,
      manpower_request_id: input.manpower_request_id || null,
      reason: clean(input.reason) || (opts.source === 'IMPORT' ? 'Import Excel karyawan' : 'Tambah karyawan baru'),
    });
    if (probationEnd < today) {
      await client.query(`UPDATE workforce_employee_profiles SET employment_status = 'ACTIVE' WHERE id = $1`, [profile.id]);
    }
    await client.query(`INSERT INTO workforce_employee_personal
      (employee_profile_id, tenant_key, nik, birth_place, birth_date, gender, phone, address, blood_type,
       emergency_contact_name, emergency_contact_relation, emergency_contact_phone, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (employee_profile_id) DO UPDATE SET nik = EXCLUDED.nik, phone = EXCLUDED.phone, updated_at = CURRENT_TIMESTAMP`,
    [profile.id, scope.tenantKey, personal.nik, personal.birth_place, personal.birth_date, personal.gender, personal.phone,
      personal.address, personal.blood_type, personal.emergency_contact_name, personal.emergency_contact_relation,
      personal.emergency_contact_phone, user?.id || null]);
    await writeLocations(client, profile.id, lokasiIds, user?.id);
    if (maritalStatus) {
      await client.query(`UPDATE workforce_employee_profiles SET marital_status = $2, family_updated_at = CURRENT_TIMESTAMP,
        family_updated_by = $3 WHERE id = $1`, [profile.id, maritalStatus, user?.id || null]);
    }
    if (Array.isArray(input.family_members) && input.family_members.length) {
      await replaceFamilyMembers(client, scope, profile.id, input.family_members, user, 'Data awal');
    }
    await fieldAudit(client, scope, profile.id, opts.source === 'IMPORT' ? 'IMPORT' : 'PROFILE', 'create', null, nrp,
      opts.source === 'IMPORT' ? `Import batch ${opts.batchId || ''}`.trim() : 'Tambah karyawan', user?.id);

    let invite = null;
    if (!password && input.send_invite !== false) {
      const token = crypto.randomInt(100000, 999999).toString();
      await client.query(`INSERT INTO password_reset_tokens (user_id, token, expires_at)
        VALUES ($1, $2, now() + interval '7 days')`, [created.id, token]);
      invite = { email, nama, token, nrp };
    }
    return { user_id: created.id, profile_id: profile.id, nrp, email, invite };
  });
}

// ---------------------------------------------------------------------------
// Direktori & profil
// ---------------------------------------------------------------------------
const DIRECTORY_SQL = `
  SELECT u.id, u.nama, u.email, u.employee_id AS nrp, u.jabatan, u.departemen, u.is_active,
         (u.compreface_subject IS NOT NULL) AS has_face,
         p.id AS profile_id, p.employment_status, p.employment_type, p.hire_date::text AS hire_date,
         p.contract_end_date::text AS contract_end_date, p.probation_end_date::text AS probation_end_date,
         p.last_working_day::text AS last_working_day, p.marital_status, p.voided_at,
         a.department_id, a.position_id, a.site_name,
         ps.nik, ps.phone, ps.birth_date::text AS birth_date, ps.address, ps.blood_type, ps.emergency_contact_name,
         EXISTS (SELECT 1 FROM employee_documents d WHERE d.employee_profile_id = p.id AND d.doc_type = 'CV' AND d.deleted_at IS NULL) AS has_cv,
         (SELECT d.id FROM employee_documents d WHERE d.employee_profile_id = p.id AND d.doc_type = 'CV' AND d.deleted_at IS NULL LIMIT 1) AS cv_id,
         (SELECT COUNT(*)::int FROM employee_documents d WHERE d.employee_profile_id = p.id AND d.doc_type = 'COMPETENCY' AND d.deleted_at IS NULL) AS competency_count,
         (SELECT d.id FROM employee_documents d WHERE d.employee_profile_id = p.id AND d.doc_type = 'COMPETENCY' AND d.deleted_at IS NULL
           ORDER BY d.uploaded_at DESC LIMIT 1) AS competency_latest_id,
         (SELECT COUNT(*)::int FROM employee_attendance_locations l WHERE l.employee_profile_id = p.id) AS location_count
    FROM users u
    LEFT JOIN workforce_employee_profiles p ON p.user_id = u.id
    LEFT JOIN workforce_employee_assignments a ON a.employee_profile_id = p.id AND a.status = 'ACTIVE' AND a.effective_to IS NULL
    LEFT JOIN workforce_employee_personal ps ON ps.employee_profile_id = p.id
   WHERE u.role = 'karyawan' AND p.voided_at IS NULL`;

function statusOf(row) {
  if (!row.is_active || row.employment_status === 'INACTIVE') return 'INACTIVE';
  return row.employment_status || 'ACTIVE';
}

function keyDate(row, today) {
  const status = statusOf(row);
  if (status === 'NOTICE' && row.last_working_day) return { kind: 'LAST_DAY', date: row.last_working_day, days: daysBetween(today, row.last_working_day) };
  if (status === 'INACTIVE') return { kind: 'EXITED', date: row.last_working_day, days: null };
  if (status === 'PROBATION' && row.probation_end_date) return { kind: 'PROBATION', date: row.probation_end_date, days: daysBetween(today, row.probation_end_date) };
  if (row.contract_end_date) return { kind: 'CONTRACT', date: row.contract_end_date, days: daysBetween(today, row.contract_end_date) };
  return { kind: 'PERMANENT', date: null, days: null };
}

function shapeDirectoryRow(row, today) {
  const status = statusOf(row);
  const comp = completeness(row);
  const key = keyDate(row, today);
  return {
    id: row.id, profile_id: row.profile_id, nama: row.nama, email: row.email, nrp: row.nrp,
    jabatan: row.jabatan, departemen: row.departemen, department_id: row.department_id, position_id: row.position_id,
    site: row.site_name, status, employment_type: row.employment_type, hire_date: row.hire_date,
    tenure_days: row.hire_date ? Math.max(0, daysBetween(row.hire_date, row.last_working_day && status === 'INACTIVE' ? row.last_working_day : today)) : null,
    key_date: key, has_face: row.has_face, has_cv: row.has_cv, cv_id: row.cv_id,
    competency_count: row.competency_count, competency_latest_id: row.competency_latest_id,
    location_count: row.location_count, completeness: comp,
  };
}

async function getDirectory(db, scope, query = {}) {
  const today = query.today || Workforce.todayWib();
  const status = STATUS_FILTERS.has(String(query.status || '').toUpperCase()) ? String(query.status).toUpperCase() : 'ACTIVE_ALL';
  const { rows } = await db.query(`${DIRECTORY_SQL} ORDER BY lower(u.nama)`);
  const all = rows.map(r => shapeDirectoryRow(r, today));
  const active = all.filter(r => r.status !== 'INACTIVE');
  const endingSoon = r => r.key_date.days != null && r.key_date.days <= 30 && ['CONTRACT', 'PROBATION'].includes(r.key_date.kind);
  const incomplete = r => r.completeness.percent < 80 || !r.has_face || !r.has_cv;
  const summary = {
    active: active.length,
    probation: active.filter(r => r.status === 'PROBATION').length,
    notice: active.filter(r => r.status === 'NOTICE').length,
    ending_soon: active.filter(endingSoon).length,
    incomplete: active.filter(incomplete).length,
    exited: all.length - active.length,
    total: all.length,
  };
  const depts = new Set((query.department_ids || []).map(String));
  const positions = new Set((query.position_ids || []).map(String));
  const q = String(query.q || '').trim().toLowerCase();
  const filtered = all.filter(r => {
    if (status === 'ACTIVE_ALL' && r.status === 'INACTIVE') return false;
    if (status === 'INCOMPLETE' && (r.status === 'INACTIVE' || !incomplete(r))) return false;
    if (status === 'ENDING_SOON' && (r.status === 'INACTIVE' || !endingSoon(r))) return false;
    if (['ACTIVE', 'PROBATION', 'NOTICE', 'INACTIVE'].includes(status) && r.status !== status) return false;
    if (depts.size && !depts.has(String(r.department_id))) return false;
    if (positions.size && !positions.has(String(r.position_id))) return false;
    if (q && !`${r.nama} ${r.nrp || ''} ${r.jabatan || ''} ${r.departemen || ''} ${r.email}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return { today, summary, rows: filtered };
}

async function getProfile(db, scope, userId, opts = {}) {
  const today = opts.today || Workforce.todayWib();
  const { rows } = await db.query(`${DIRECTORY_SQL} AND u.id = $1`, [userId]);
  if (!rows[0]) throw httpError('Karyawan tidak ditemukan.', 404);
  const row = rows[0];
  const base = shapeDirectoryRow(row, today);
  const profileId = row.profile_id;
  const [personal, extra, locations, history, docs, family, audit, attendance] = await Promise.all([
    db.query(`SELECT * FROM workforce_employee_personal WHERE employee_profile_id = $1`, [profileId]),
    db.query(`SELECT p.contract_no, p.grade, p.rehire_eligible, a.supervisor_user_id, sup.nama AS supervisor_name,
        u.shift_id, u.lokasi_kantor_id
      FROM workforce_employee_profiles p JOIN users u ON u.id = p.user_id
      LEFT JOIN workforce_employee_assignments a ON a.employee_profile_id = p.id AND a.status = 'ACTIVE' AND a.effective_to IS NULL
      LEFT JOIN users sup ON sup.id = a.supervisor_user_id
      WHERE p.id = $1`, [profileId]),
    db.query(`SELECT l.id, l.nama_lokasi, l.radius_meter, el.is_primary
      FROM employee_attendance_locations el JOIN lokasi_kantor l ON l.id = el.lokasi_kantor_id
      WHERE el.employee_profile_id = $1 ORDER BY el.is_primary DESC, l.nama_lokasi`, [profileId]),
    db.query(`SELECT id, movement_no, movement_type, status, effective_date::text AS effective_date,
        last_working_day::text AS last_working_day, reason_text, before_state, after_state, created_at
      FROM workforce_employee_movements WHERE employee_profile_id = $1
      ORDER BY effective_date DESC, created_at DESC`, [profileId]),
    db.query(`SELECT id, doc_type, title, doc_number, issued_date::text AS issued_date, expiry_date::text AS expiry_date,
        original_filename, size_bytes, uploaded_at FROM employee_documents
      WHERE employee_profile_id = $1 AND deleted_at IS NULL ORDER BY doc_type, uploaded_at DESC`, [profileId]),
    getFamily(db, scope, userId),
    db.query(`SELECT a.entity, a.field, a.old_value, a.new_value, a.reason, a.created_at, u.nama AS actor_name
      FROM workforce_employee_field_audit a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.employee_profile_id = $1 ORDER BY a.created_at DESC LIMIT 50`, [profileId]),
    db.query(`SELECT COUNT(*) FILTER (WHERE waktu_datang IS NOT NULL)::int AS present,
        COUNT(*) FILTER (WHERE status_datang = 'telat')::int AS late
      FROM absensi WHERE user_id = $1 AND tanggal_kerja >= date_trunc('month', $2::date)::date AND tanggal_kerja <= $2::date`, [userId, today]),
  ]);
  const ps = personal.rows[0] || {};
  const ex = extra.rows[0] || {};
  return {
    employee: {
      ...base, employment_status: base.status, contract_end_date: row.contract_end_date, probation_end_date: row.probation_end_date,
      last_working_day: row.last_working_day, contract_no: ex.contract_no || null, supervisor_user_id: ex.supervisor_user_id || null,
      supervisor_name: ex.supervisor_name || null, rehire_eligible: ex.rehire_eligible, shift_id: ex.shift_id || null,
    },
    personal: {
      nik_masked: maskNik(ps.nik), has_nik: Boolean(ps.nik), birth_place: ps.birth_place || null,
      birth_date: isoDate(ps.birth_date), gender: ps.gender || null, phone: ps.phone || null, address: ps.address || null,
      blood_type: ps.blood_type || null, emergency_contact_name: ps.emergency_contact_name || null,
      emergency_contact_relation: ps.emergency_contact_relation || null, emergency_contact_phone: ps.emergency_contact_phone || null,
    },
    locations: locations.rows,
    location_mode: locations.rows.length ? 'ASSIGNED' : 'ALL',
    history: history.rows,
    documents: docs.rows,
    family,
    audit: audit.rows,
    attendance_month: attendance.rows[0] || { present: 0, late: 0 },
  };
}

// ---------------------------------------------------------------------------
// Data pribadi
// ---------------------------------------------------------------------------
const PERSONAL_FIELDS = ['nik', 'birth_place', 'birth_date', 'gender', 'phone', 'address', 'blood_type',
  'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone'];
const SENSITIVE_FIELDS = new Set(['nik']);

async function updatePersonal(db, scope, user, userId, input = {}) {
  const reason = clean(input.reason);
  return withTransaction(db, async client => {
    const { user: u, profileId } = await profileFor(client, scope, userId);
    const current = (await client.query(`SELECT * FROM workforce_employee_personal WHERE employee_profile_id = $1`, [profileId])).rows[0] || {};
    const next = validatePersonal({ ...Object.fromEntries(PERSONAL_FIELDS.map(f => [f, current[f] instanceof Date ? isoDate(current[f]) : current[f]])), ...input });
    const changes = PERSONAL_FIELDS.filter(f => input[f] !== undefined && String(next[f] ?? '') !== String((current[f] instanceof Date ? isoDate(current[f]) : current[f]) ?? ''));
    const accountChanges = [];
    if (input.nama !== undefined && clean(input.nama) !== u.nama) {
      if (!clean(input.nama)) throw httpError('Nama tidak boleh kosong.');
      accountChanges.push(['nama', u.nama, clean(input.nama)]);
    }
    if (input.email !== undefined && normalizeEmail(input.email) !== u.email) accountChanges.push(['email', u.email, normalizeEmail(input.email)]);
    if (!changes.length && !accountChanges.length) return getProfile(client, scope, userId);
    const needReason = changes.some(f => SENSITIVE_FIELDS.has(f)) || accountChanges.some(([f]) => f === 'email');
    if (needReason && (!reason || reason.length < 5)) throw httpError('Perubahan NIK atau email wajib disertai alasan.');
    if (changes.includes('nik') && next.nik) {
      const dup = await client.query(`SELECT 1 FROM workforce_employee_personal WHERE tenant_key = $1 AND nik = $2 AND employee_profile_id <> $3`,
        [scope.tenantKey, next.nik, profileId]);
      if (dup.rows[0]) throw httpError('NIK sudah terdaftar pada karyawan lain.', 409, 'NIK_TAKEN');
    }
    for (const [field, , value] of accountChanges) {
      if (field === 'email') {
        const dup = await client.query(`SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2`, [value, userId]);
        if (dup.rows[0]) throw httpError(`Email ${value} sudah dipakai akun lain.`, 409, 'EMAIL_TAKEN');
      }
    }
    await client.query(`INSERT INTO workforce_employee_personal (employee_profile_id, tenant_key, ${PERSONAL_FIELDS.join(', ')}, updated_by)
      VALUES ($1, $2, ${PERSONAL_FIELDS.map((_, i) => `$${i + 3}`).join(', ')}, $${PERSONAL_FIELDS.length + 3})
      ON CONFLICT (employee_profile_id) DO UPDATE SET ${PERSONAL_FIELDS.map(f => `${f} = EXCLUDED.${f}`).join(', ')},
        updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [profileId, scope.tenantKey, ...PERSONAL_FIELDS.map(f => next[f]), user?.id || null]);
    for (const f of changes) {
      const oldV = current[f] instanceof Date ? isoDate(current[f]) : current[f];
      await fieldAudit(client, scope, profileId, 'PERSONAL', f, f === 'nik' ? maskNik(oldV) : oldV, f === 'nik' ? maskNik(next[f]) : next[f], reason, user?.id);
    }
    for (const [field, oldV, newV] of accountChanges) {
      await client.query(`UPDATE users SET ${field === 'email' ? 'email' : 'nama'} = $1 WHERE id = $2`, [newV, userId]);
      await fieldAudit(client, scope, profileId, 'ACCOUNT', field, oldV, newV, reason, user?.id);
    }
    return getProfile(client, scope, userId);
  });
}

async function revealNik(db, scope, user, userId) {
  const { profileId } = await profileFor(db, scope, userId);
  const { rows } = await db.query(`SELECT nik FROM workforce_employee_personal WHERE employee_profile_id = $1`, [profileId]);
  await fieldAudit(db, scope, profileId, 'ACCOUNT', 'nik', null, null, 'Tampilkan NIK lengkap', user?.id);
  return rows[0]?.nik || null;
}

// ---------------------------------------------------------------------------
// Lokasi absen
// ---------------------------------------------------------------------------
async function setAttendanceLocations(db, scope, user, userId, input = {}) {
  const mode = String(input.mode || 'ASSIGNED').toUpperCase();
  return withTransaction(db, async client => {
    const { profileId } = await profileFor(client, scope, userId);
    const before = (await client.query(`SELECT l.nama_lokasi FROM employee_attendance_locations el
      JOIN lokasi_kantor l ON l.id = el.lokasi_kantor_id WHERE el.employee_profile_id = $1 ORDER BY el.is_primary DESC, l.nama_lokasi`, [profileId]))
      .rows.map(r => r.nama_lokasi).join(', ') || 'Semua lokasi';
    if (mode === 'ALL') {
      await client.query(`DELETE FROM employee_attendance_locations WHERE employee_profile_id = $1`, [profileId]);
    } else {
      const ids = await validateLocations(client, input.lokasi_ids);
      await writeLocations(client, profileId, ids, user?.id);
      await client.query(`UPDATE users SET lokasi_kantor_id = $1 WHERE id = $2`, [ids[0], userId]);
    }
    const after = (await client.query(`SELECT l.nama_lokasi FROM employee_attendance_locations el
      JOIN lokasi_kantor l ON l.id = el.lokasi_kantor_id WHERE el.employee_profile_id = $1 ORDER BY el.is_primary DESC, l.nama_lokasi`, [profileId]))
      .rows.map(r => r.nama_lokasi).join(', ') || 'Semua lokasi';
    if (before !== after) await fieldAudit(client, scope, profileId, 'LOCATIONS', 'lokasi_absen', before, after, clean(input.reason), user?.id);
    return { mode: after === 'Semua lokasi' ? 'ALL' : 'ASSIGNED', locations: after };
  });
}

/** Lokasi yang boleh dipakai absen; null = semua lokasi (belum dibatasi). */
async function getAllowedLocations(db, userId) {
  const { rows } = await db.query(`
    SELECT l.id, l.nama_lokasi, l.latitude, l.longitude, l.radius_meter, el.is_primary
      FROM workforce_employee_profiles p
      JOIN employee_attendance_locations el ON el.employee_profile_id = p.id
      JOIN lokasi_kantor l ON l.id = el.lokasi_kantor_id
     WHERE p.user_id = $1
     ORDER BY el.is_primary DESC, l.nama_lokasi`, [userId]);
  return rows.length ? rows : null;
}

// ---------------------------------------------------------------------------
// Keluarga
// ---------------------------------------------------------------------------
async function getFamily(db, scope, userId) {
  const { profileId } = await profileFor(db, scope, userId);
  const [p, members, summary] = await Promise.all([
    db.query(`SELECT marital_status, family_updated_at FROM workforce_employee_profiles WHERE id = $1`, [profileId]),
    db.query(`SELECT id, full_name, relationship, gender, birth_date::text AS birth_date, is_dependent, is_emergency_contact, phone, notes
      FROM employee_family_members WHERE employee_profile_id = $1 AND deleted_at IS NULL
      ORDER BY CASE relationship WHEN 'SPOUSE' THEN 0 WHEN 'CHILD' THEN 1 WHEN 'PARENT' THEN 2 ELSE 3 END, birth_date NULLS LAST, full_name`, [profileId]),
    db.query(`SELECT dependent_count, child_count, ptkp_estimate FROM v_employee_family_summary WHERE employee_profile_id = $1`, [profileId]),
  ]);
  const marital = p.rows[0]?.marital_status || null;
  return {
    marital_status: marital,
    members: members.rows,
    summary: marital ? {
      dependent_count: Number(summary.rows[0]?.dependent_count || 0),
      child_count: Number(summary.rows[0]?.child_count || 0),
      ptkp_estimate: summary.rows[0]?.ptkp_estimate || null,
    } : null,
  };
}

function normalizeMember(m) {
  const fullName = clean(m.full_name ?? m.name);
  if (!fullName) return null;
  const relationship = String(m.relationship || m.rel || '').toUpperCase();
  if (!RELATIONSHIPS.has(relationship)) throw httpError(`Hubungan keluarga untuk ${fullName} tidak valid.`);
  return {
    id: m.id || null, full_name: fullName, relationship,
    gender: clean(m.gender) ? String(m.gender).toUpperCase().slice(0, 1) === 'L' ? 'M' : String(m.gender).toUpperCase().slice(0, 1) === 'P' ? 'F' : String(m.gender).toUpperCase() : null,
    birth_date: optionalDate(m.birth_date ?? m.birth, `Tanggal lahir ${fullName}`),
    is_dependent: m.is_dependent === true || m.dep === true,
    is_emergency_contact: m.is_emergency_contact === true,
    phone: normalizePhone(m.phone),
    nik: m.nik ? normalizeNik(m.nik) : null,
    notes: clean(m.notes),
  };
}

async function replaceFamilyMembers(client, scope, profileId, list, user, reason) {
  const members = (Array.isArray(list) ? list : []).map(normalizeMember).filter(Boolean);
  if (members.filter(m => m.relationship === 'SPOUSE').length > 1) {
    // Diperbolehkan secara data, tapi dicatat di audit agar terlihat.
    await fieldAudit(client, scope, profileId, 'FAMILY', 'spouse_count', null, String(members.filter(m => m.relationship === 'SPOUSE').length), reason, user?.id);
  }
  const existing = (await client.query(`SELECT * FROM employee_family_members WHERE employee_profile_id = $1 AND deleted_at IS NULL`, [profileId])).rows;
  const keep = new Set();
  for (const m of members) {
    const match = m.id && existing.find(e => e.id === m.id);
    if (match) {
      keep.add(match.id);
      await client.query(`UPDATE employee_family_members SET full_name = $2, relationship = $3, gender = $4, birth_date = $5,
          is_dependent = $6, is_emergency_contact = $7, phone = $8, nik = COALESCE($9, nik), notes = $10, updated_by = $11, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`, [match.id, m.full_name, m.relationship, m.gender, m.birth_date, m.is_dependent, m.is_emergency_contact, m.phone, m.nik, m.notes, user?.id || null]);
      await client.query(`INSERT INTO employee_family_audit (tenant_key, employee_profile_id, family_member_id, action, old_values, new_values, reason, changed_by)
        VALUES ($1, $2, $3, 'UPDATE', $4::jsonb, $5::jsonb, $6, $7)`,
      [scope.tenantKey, profileId, match.id, JSON.stringify({ full_name: match.full_name, relationship: match.relationship, is_dependent: match.is_dependent }),
        JSON.stringify({ full_name: m.full_name, relationship: m.relationship, is_dependent: m.is_dependent }), reason || null, user?.id || null]);
    } else {
      const ins = (await client.query(`INSERT INTO employee_family_members
        (tenant_key, employee_profile_id, full_name, relationship, gender, birth_date, nik, is_dependent, is_emergency_contact, phone, notes, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
      [scope.tenantKey, profileId, m.full_name, m.relationship, m.gender, m.birth_date, m.nik, m.is_dependent, m.is_emergency_contact, m.phone, m.notes, user?.id || null])).rows[0];
      keep.add(ins.id);
      await client.query(`INSERT INTO employee_family_audit (tenant_key, employee_profile_id, family_member_id, action, new_values, reason, changed_by)
        VALUES ($1, $2, $3, 'CREATE', $4::jsonb, $5, $6)`,
      [scope.tenantKey, profileId, ins.id, JSON.stringify({ full_name: m.full_name, relationship: m.relationship, is_dependent: m.is_dependent }), reason || null, user?.id || null]);
    }
  }
  for (const e of existing.filter(x => !keep.has(x.id))) {
    await client.query(`UPDATE employee_family_members SET deleted_at = CURRENT_TIMESTAMP, deleted_reason = $2, updated_by = $3 WHERE id = $1`,
      [e.id, reason || 'Dihapus dari daftar keluarga', user?.id || null]);
    await client.query(`INSERT INTO employee_family_audit (tenant_key, employee_profile_id, family_member_id, action, old_values, reason, changed_by)
      VALUES ($1, $2, $3, 'DELETE', $4::jsonb, $5, $6)`,
    [scope.tenantKey, profileId, e.id, JSON.stringify({ full_name: e.full_name, relationship: e.relationship }), reason || null, user?.id || null]);
  }
}

async function saveFamily(db, scope, user, userId, input = {}) {
  const marital = clean(input.marital_status) ? String(input.marital_status).toUpperCase() : null;
  if (marital && !MARITAL.has(marital)) throw httpError('Status pernikahan tidak valid.');
  const reason = clean(input.reason);
  await withTransaction(db, async client => {
    const { profileId } = await profileFor(client, scope, userId);
    const prev = (await client.query(`SELECT marital_status FROM workforce_employee_profiles WHERE id = $1`, [profileId])).rows[0];
    if ((prev?.marital_status || null) !== marital) {
      await client.query(`INSERT INTO employee_family_audit (tenant_key, employee_profile_id, action, old_values, new_values, reason, changed_by)
        VALUES ($1, $2, 'MARITAL_CHANGE', $3::jsonb, $4::jsonb, $5, $6)`,
      [scope.tenantKey, profileId, JSON.stringify({ marital_status: prev?.marital_status || null }), JSON.stringify({ marital_status: marital }), reason, user?.id || null]);
    }
    await client.query(`UPDATE workforce_employee_profiles SET marital_status = $2, family_updated_at = CURRENT_TIMESTAMP, family_updated_by = $3
      WHERE id = $1`, [profileId, marital, user?.id || null]);
    await replaceFamilyMembers(client, scope, profileId, input.members, user, reason);
  });
  return getFamily(db, scope, userId);
}

// ---------------------------------------------------------------------------
// Void (pengganti hapus permanen)
// ---------------------------------------------------------------------------
const VOID_IGNORED_TABLES = new Set(['workforce_employee_profiles', 'password_reset_tokens', 'audit_log',
  'workforce_employee_assignments', 'workforce_employee_movements', 'workforce_movement_audit', 'workforce_movement_approvals',
  'workforce_movement_tasks', 'workforce_movement_attachments', 'employee_import_rows', 'workforce_employee_field_audit',
  'workforce_employee_personal', 'employee_family_members', 'employee_family_audit', 'employee_documents',
  'employee_document_access_log', 'employee_attendance_locations', 'people_settings', 'workforce_mpp_plans',
  'workforce_manpower_requests', 'employee_import_batches', 'master_aliases', 'workforce_mpp_scenarios']);

async function findTransactions(db, userId, nrp) {
  // Semua kolom FK yang merujuk users(id) — kecuali tabel People sendiri.
  const { rows: fks } = await db.query(`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND array_length(c.conkey, 1) = 1`);
  const hits = [];
  for (const fk of fks) {
    const table = fk.tbl.replace(/^public\./, '').replace(/"/g, '');
    if (VOID_IGNORED_TABLES.has(table)) continue;
    const r = await db.query(`SELECT 1 FROM ${fk.tbl} WHERE ${JSON.stringify(fk.col)} = $1 LIMIT 1`, [userId]).catch(() => ({ rows: [] }));
    if (r.rows[0]) hits.push(table);
  }
  if (nrp) {
    const payroll = await db.query(`SELECT to_regclass('public.payroll') AS t`);
    if (payroll.rows[0]?.t) {
      const r = await db.query(`SELECT 1 FROM payroll WHERE lower(trim(employee_id)) = lower(trim($1)) LIMIT 1`, [nrp]).catch(() => ({ rows: [] }));
      if (r.rows[0]) hits.push('payroll');
    }
  }
  return [...new Set(hits)];
}

const TABLE_LABEL = { absensi: 'absensi', keterangan_presensi: 'keterangan presensi', payroll: 'payroll', database_hm: 'HM' };

async function voidEmployee(db, scope, user, userId, input = {}, opts = {}) {
  const reason = clean(input.reason);
  if (!reason || reason.length < 5) throw httpError('Alasan Void wajib diisi (minimal 5 karakter).');
  const today = opts.today || Workforce.todayWib();
  return withTransaction(db, async client => {
    const { user: u, profileId } = await profileFor(client, scope, userId);
    const used = await findTransactions(client, userId, u.employee_id);
    if (used.length) {
      throw httpError(`Karyawan sudah punya data ${used.map(t => TABLE_LABEL[t] || t).join(', ')}. Gunakan pergerakan Keluar, bukan Void.`, 409, 'EMPLOYEE_HAS_TRANSACTIONS');
    }
    const [local, domain] = u.email.split('@');
    const suffix = crypto.randomBytes(3).toString('hex');
    const voidEmail = `${local.split('+')[0]}+void-${today.replace(/-/g, '')}-${suffix}@${domain}`;
    await client.query(`UPDATE users SET is_active = FALSE, email = $2 WHERE id = $1`, [userId, voidEmail]);
    await client.query(`UPDATE workforce_employee_profiles SET voided_at = CURRENT_TIMESTAMP, voided_by = $2, void_reason = $3,
      employment_status = 'INACTIVE', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [profileId, user?.id || null, reason]);
    await client.query(`UPDATE workforce_employee_assignments SET status = 'CANCELLED', effective_to = effective_from, updated_at = CURRENT_TIMESTAMP
      WHERE employee_profile_id = $1 AND status = 'ACTIVE'`, [profileId]);
    await client.query(`UPDATE workforce_employee_movements SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP,
      cancellation_reason = $3 WHERE employee_profile_id = $1 AND status IN ('DRAFT','SUBMITTED','APPROVED')`, [profileId, user?.id || null, `Void: ${reason}`]);
    await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
    await fieldAudit(client, scope, profileId, 'ACCOUNT', 'void', u.email, voidEmail, reason, user?.id);
    await Workforce.emitOutbox(client, scope, 'EMPLOYEE_VOIDED', profileId, profileId, { user_id: userId, compreface_subject: u.compreface_subject || null });
    return { user_id: userId, email: voidEmail, compreface_subject: u.compreface_subject || null };
  });
}

module.exports = {
  formatNrp,
  completeness,
  maskNik,
  addMonths,
  getSettings,
  updateSettings,
  createEmployee,
  getDirectory,
  getProfile,
  updatePersonal,
  revealNik,
  setAttendanceLocations,
  getAllowedLocations,
  getFamily,
  saveFamily,
  voidEmployee,
  findTransactions,
  // dipakai layanan People lain (dokumen, import)
  profileFor,
  fieldAudit,
  clean,
  optionalDate,
};
