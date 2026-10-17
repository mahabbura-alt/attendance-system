'use strict';

/**
 * OMOS People — master Departemen & Jabatan (satu-satunya sumber pilihan).
 *
 * Aturan:
 * - Nama unik per scope tanpa beda huruf besar/kecil & spasi ganda.
 * - Jabatan selalu milik satu departemen; nama boleh sama di departemen lain.
 * - Tidak ada pembuatan master otomatis dari teks bebas (lihat resolvePosition).
 * - Ganti nama memperbarui salinan teks `users.jabatan/departemen` dan
 *   snapshot penempatan aktif pemegangnya, supaya modul yang masih membaca
 *   teks (Cuti, Roster, HSE, Produksi) tetap konsisten.
 * - Yang masih dipegang karyawan aktif tidak bisa dinonaktifkan.
 */

const FUNCTION_TAGS = new Set(['OPERATOR', 'SUPERVISOR', 'MECHANIC', 'DRIVER', 'STAFF', 'OTHER']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(message, statusCode = 422, code = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function cleanName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function nameKey(value) {
  return cleanName(value).toLowerCase();
}

function codeFromName(name) {
  return cleanName(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || null;
}

function requireName(value, label) {
  const name = cleanName(value);
  if (!name) throw httpError(`Nama ${label} wajib diisi.`);
  if (name.length > 100) throw httpError(`Nama ${label} maksimal 100 karakter.`);
  return name;
}

function normalizeFunctionTag(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const tag = String(value).trim().toUpperCase();
  if (!FUNCTION_TAGS.has(tag)) throw httpError('Fungsi jabatan tidak valid.');
  return tag;
}

async function withTransaction(db, work) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const owned = client !== db;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (owned && typeof client.release === 'function') client.release();
  }
}

async function bumpMasterVersion(db, tenantKey) {
  const { rows } = await db.query(`
    INSERT INTO people_settings (tenant_key, master_version) VALUES ($1, 2)
    ON CONFLICT (tenant_key) DO UPDATE SET master_version = people_settings.master_version + 1, updated_at = CURRENT_TIMESTAMP
    RETURNING master_version`, [tenantKey]);
  return Number(rows[0].master_version);
}

async function getMasterVersion(db, tenantKey) {
  const { rows } = await db.query(`SELECT master_version FROM people_settings WHERE tenant_key = $1`, [tenantKey])
    .catch(() => ({ rows: [] }));
  return Number(rows[0]?.master_version || 1);
}

/** Karyawan aktif pemegang jabatan (lewat penempatan aktif atau salinan teks lama). */
const HOLDERS_SQL = `
  SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN workforce_employee_profiles ep ON ep.user_id = u.id AND ep.deleted_at IS NULL
    LEFT JOIN workforce_employee_assignments a ON a.employee_profile_id = ep.id
         AND a.status = 'ACTIVE' AND a.effective_to IS NULL
   WHERE u.role = 'karyawan' AND u.is_active = TRUE
     AND (a.position_id = $1
          OR (a.position_id IS NULL
              AND lower(regexp_replace(trim(COALESCE(u.jabatan, '')), '\\s+', ' ', 'g')) = $2
              AND lower(regexp_replace(trim(COALESCE(u.departemen, '')), '\\s+', ' ', 'g')) = $3))`;

async function positionWithDept(db, scope, id) {
  if (!UUID_RE.test(String(id || ''))) throw httpError('Jabatan tidak ditemukan.', 404);
  const { rows } = await db.query(`
    SELECT p.id, p.name, p.code, p.department_id, p.is_active, p.is_critical, p.function_tag,
           d.name AS department_name, d.is_active AS department_active
      FROM workforce_positions p
      JOIN workforce_departments d ON d.id = p.department_id
     WHERE p.id = $1 AND p.tenant_key = $2 AND p.project_key = $3`, [id, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) throw httpError('Jabatan tidak ditemukan.', 404);
  return rows[0];
}

async function departmentById(db, scope, id) {
  if (!UUID_RE.test(String(id || ''))) throw httpError('Departemen tidak ditemukan.', 422);
  const { rows } = await db.query(`
    SELECT id, name, code, is_active, group_id FROM workforce_departments
     WHERE id = $1 AND tenant_key = $2 AND project_key = $3`, [id, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) throw httpError('Departemen tidak ditemukan.', 422);
  return rows[0];
}

async function countHolders(db, position) {
  const { rows } = await db.query(HOLDERS_SQL, [position.id, nameKey(position.name), nameKey(position.department_name)]);
  return rows.length;
}

async function listOrg(db, scope, { includeInactive = true } = {}) {
  const [deptRes, posRes, countRes, version] = await Promise.all([
    db.query(`SELECT id, name, code, is_active FROM workforce_departments
               WHERE tenant_key = $1 AND project_key = $2 ${includeInactive ? '' : 'AND is_active'}
               ORDER BY lower(name)`, [scope.tenantKey, scope.projectKey]),
    db.query(`SELECT id, department_id, name, code, is_active, is_critical, function_tag FROM workforce_positions
               WHERE tenant_key = $1 AND project_key = $2 ${includeInactive ? '' : 'AND is_active'}
               ORDER BY lower(name)`, [scope.tenantKey, scope.projectKey]),
    db.query(`
      SELECT COALESCE(a.position_id, pos.id) AS position_id, COUNT(DISTINCT u.id)::int AS n
        FROM users u
        LEFT JOIN workforce_employee_profiles ep ON ep.user_id = u.id AND ep.deleted_at IS NULL
        LEFT JOIN workforce_employee_assignments a ON a.employee_profile_id = ep.id
             AND a.status = 'ACTIVE' AND a.effective_to IS NULL
        LEFT JOIN workforce_departments d ON a.position_id IS NULL AND d.tenant_key = $1 AND d.project_key = $2
             AND lower(d.name) = lower(regexp_replace(trim(COALESCE(u.departemen, '')), '\\s+', ' ', 'g'))
        LEFT JOIN workforce_positions pos ON a.position_id IS NULL AND pos.department_id = d.id
             AND lower(pos.name) = lower(regexp_replace(trim(COALESCE(u.jabatan, '')), '\\s+', ' ', 'g'))
       WHERE u.role = 'karyawan' AND u.is_active = TRUE
       GROUP BY 1`, [scope.tenantKey, scope.projectKey]),
    getMasterVersion(db, scope.tenantKey),
  ]);
  const counts = new Map(countRes.rows.filter(r => r.position_id).map(r => [r.position_id, r.n]));
  const departments = deptRes.rows.map(d => {
    const positions = posRes.rows.filter(p => p.department_id === d.id)
      .map(p => ({ ...p, active_employees: counts.get(p.id) || 0 }));
    return { ...d, positions, active_employees: positions.reduce((sum, p) => sum + p.active_employees, 0) };
  });
  return { departments, master_version: version };
}

async function assertDepartmentNameFree(db, scope, name, exceptId = null) {
  const { rows } = await db.query(`
    SELECT id FROM workforce_departments
     WHERE tenant_key = $1 AND project_key = $2 AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $3
       AND ($4::uuid IS NULL OR id <> $4::uuid) LIMIT 1`, [scope.tenantKey, scope.projectKey, nameKey(name), exceptId]);
  if (rows[0]) throw httpError(`Departemen "${name}" sudah ada.`, 409, 'DEPARTMENT_EXISTS');
}

async function assertPositionNameFree(db, scope, departmentId, name, exceptId = null) {
  const { rows } = await db.query(`
    SELECT id FROM workforce_positions
     WHERE tenant_key = $1 AND project_key = $2 AND department_id = $3
       AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $4
       AND ($5::uuid IS NULL OR id <> $5::uuid) LIMIT 1`, [scope.tenantKey, scope.projectKey, departmentId, nameKey(name), exceptId]);
  if (rows[0]) throw httpError(`Jabatan "${name}" sudah ada di departemen ini.`, 409, 'POSITION_EXISTS');
}

async function insertPosition(client, scope, departmentId, input) {
  const name = requireName(input.name, 'jabatan');
  await assertPositionNameFree(client, scope, departmentId, name);
  const functionTag = normalizeFunctionTag(input.function_tag);
  const { rows } = await client.query(`
    INSERT INTO workforce_positions (tenant_key, project_key, department_id, code, name, is_critical, function_tag)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, department_id, name, code, is_active, is_critical, function_tag`,
  [scope.tenantKey, scope.projectKey, departmentId, codeFromName(name), name, input.is_critical === true, functionTag ?? null]);
  return rows[0];
}

async function createDepartment(db, scope, user, input = {}) {
  const name = requireName(input.name, 'departemen');
  const code = cleanName(input.code) ? codeFromName(input.code) : codeFromName(name);
  const initial = [];
  const seen = new Set();
  (Array.isArray(input.positions) ? input.positions : []).forEach(raw => {
    const n = cleanName(typeof raw === 'string' ? raw : raw?.name);
    if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); initial.push(n); }
  });
  return withTransaction(db, async client => {
    await assertDepartmentNameFree(client, scope, name);
    const { rows } = await client.query(`
      INSERT INTO workforce_departments (tenant_key, project_key, code, name, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, code, is_active`, [scope.tenantKey, scope.projectKey, code, name, input.is_active !== false]);
    const department = rows[0];
    department.positions = [];
    for (const positionName of initial) department.positions.push(await insertPosition(client, scope, department.id, { name: positionName }));
    const masterVersion = await bumpMasterVersion(client, scope.tenantKey);
    return { department, master_version: masterVersion, actor_id: user?.id || null };
  });
}

async function createPosition(db, scope, user, input = {}) {
  return withTransaction(db, async client => {
    const department = await departmentById(client, scope, input.department_id);
    if (!department.is_active) throw httpError('Departemen nonaktif; aktifkan dulu sebelum menambah jabatan.');
    const position = await insertPosition(client, scope, department.id, input);
    const masterVersion = await bumpMasterVersion(client, scope.tenantKey);
    return { position: { ...position, department_name: department.name }, master_version: masterVersion, actor_id: user?.id || null };
  });
}

async function updatePosition(db, scope, user, id, input = {}) {
  return withTransaction(db, async client => {
    const current = await positionWithDept(client, scope, id);
    const sets = [];
    const values = [];
    const add = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
    let updatedEmployees = 0;
    const warnings = [];

    if (input.name !== undefined && cleanName(input.name) !== current.name) {
      const name = requireName(input.name, 'jabatan');
      await assertPositionNameFree(client, scope, current.department_id, name, current.id);
      const holders = (await client.query(HOLDERS_SQL, [current.id, nameKey(current.name), nameKey(current.department_name)])).rows.map(r => r.id);
      if (holders.length) {
        await client.query(`UPDATE users SET jabatan = $1 WHERE id = ANY($2::uuid[])`, [name, holders]);
        await client.query(`
          UPDATE workforce_employee_assignments a SET position_snapshot = $1, updated_at = CURRENT_TIMESTAMP
            FROM workforce_employee_profiles ep
           WHERE ep.id = a.employee_profile_id AND ep.user_id = ANY($2::uuid[])
             AND a.status = 'ACTIVE' AND a.effective_to IS NULL`, [name, holders]);
      }
      updatedEmployees = holders.length;
      // Kebijakan roster masih berbasis teks jabatan: ikut dipindah hanya bila
      // tidak ada jabatan aktif lain bernama sama (mis. "Admin" di dept lain).
      const sameName = await client.query(`
        SELECT 1 FROM workforce_positions WHERE tenant_key = $1 AND project_key = $2 AND id <> $3
           AND is_active AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $4 LIMIT 1`,
      [scope.tenantKey, scope.projectKey, current.id, nameKey(current.name)]);
      const roster = await client.query(`SELECT to_regclass('public.roster_jabatan_policies') AS t`);
      if (roster.rows[0]?.t) {
        if (sameName.rows[0]) {
          warnings.push('Kebijakan roster untuk nama jabatan lama tidak dipindah karena masih dipakai jabatan lain bernama sama.');
        } else {
          await client.query(`UPDATE roster_jabatan_policies SET jabatan = $1, jabatan_key = $2, updated_at = now()
                               WHERE jabatan_key = $3`, [name, nameKey(name), nameKey(current.name)]);
        }
      }
      add('name', name);
      add('code', codeFromName(name));
    }
    if (input.is_active !== undefined) {
      const active = input.is_active === true || input.is_active === 'true';
      if (!active && current.is_active) {
        const holders = await countHolders(client, current);
        if (holders) throw httpError(`Jabatan masih dipegang ${holders} karyawan aktif. Pindahkan mereka lewat Pergerakan dulu.`, 409, 'POSITION_IN_USE');
      }
      if (active && !current.department_active) throw httpError('Departemen jabatan ini nonaktif.');
      add('is_active', active);
    }
    if (input.is_critical !== undefined) add('is_critical', input.is_critical === true || input.is_critical === 'true');
    const tag = normalizeFunctionTag(input.function_tag);
    if (tag !== undefined) add('function_tag', tag);
    if (!sets.length) return { position: current, updated_employees: 0, warnings, master_version: await getMasterVersion(client, scope.tenantKey) };

    values.push(current.id);
    const { rows } = await client.query(`
      UPDATE workforce_positions SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length}
       RETURNING id, department_id, name, code, is_active, is_critical, function_tag`, values);
    const masterVersion = await bumpMasterVersion(client, scope.tenantKey);
    return { position: { ...rows[0], department_name: current.department_name }, updated_employees: updatedEmployees, warnings, master_version: masterVersion, actor_id: user?.id || null };
  });
}

async function updateDepartment(db, scope, user, id, input = {}) {
  return withTransaction(db, async client => {
    const current = await departmentById(client, scope, id);
    const sets = [];
    const values = [];
    const add = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
    let updatedEmployees = 0;

    if (input.name !== undefined && cleanName(input.name) !== current.name) {
      const name = requireName(input.name, 'departemen');
      await assertDepartmentNameFree(client, scope, name, current.id);
      const { rows: positions } = await client.query(`SELECT id, name FROM workforce_positions WHERE department_id = $1`, [current.id]);
      const holderIds = new Set();
      for (const p of positions) {
        (await client.query(HOLDERS_SQL, [p.id, nameKey(p.name), nameKey(current.name)])).rows.forEach(r => holderIds.add(r.id));
      }
      // Karyawan dengan teks departemen lama tapi jabatan di luar master tetap ikut diperbarui.
      (await client.query(`SELECT id FROM users WHERE role = 'karyawan'
         AND lower(regexp_replace(trim(COALESCE(departemen, '')), '\\s+', ' ', 'g')) = $1`, [nameKey(current.name)]))
        .rows.forEach(r => holderIds.add(r.id));
      const ids = [...holderIds];
      if (ids.length) {
        await client.query(`UPDATE users SET departemen = $1 WHERE id = ANY($2::uuid[])`, [name, ids]);
        await client.query(`
          UPDATE workforce_employee_assignments a SET department_snapshot = $1, updated_at = CURRENT_TIMESTAMP
            FROM workforce_employee_profiles ep
           WHERE ep.id = a.employee_profile_id AND ep.user_id = ANY($2::uuid[])
             AND a.status = 'ACTIVE' AND a.effective_to IS NULL`, [name, ids]);
      }
      updatedEmployees = ids.length;
      add('name', name);
      if (input.code === undefined) add('code', codeFromName(name));
    }
    if (input.code !== undefined) add('code', codeFromName(input.code));
    if (input.is_active !== undefined) {
      const active = input.is_active === true || input.is_active === 'true';
      if (!active && current.is_active) {
        const { rows: positions } = await client.query(`SELECT id, name FROM workforce_positions WHERE department_id = $1`, [current.id]);
        let holders = 0;
        for (const p of positions) holders += await countHolders(client, { ...p, department_name: current.name });
        if (holders) throw httpError(`Departemen masih memiliki ${holders} karyawan aktif.`, 409, 'DEPARTMENT_IN_USE');
        await client.query(`UPDATE workforce_positions SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE department_id = $1`, [current.id]);
      }
      add('is_active', active);
    }
    if (!sets.length) return { department: current, updated_employees: 0, master_version: await getMasterVersion(client, scope.tenantKey) };
    values.push(current.id);
    const { rows } = await client.query(`
      UPDATE workforce_departments SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING id, name, code, is_active`, values);
    const masterVersion = await bumpMasterVersion(client, scope.tenantKey);
    return { department: rows[0], updated_employees: updatedEmployees, master_version: masterVersion, actor_id: user?.id || null };
  });
}

/**
 * Pasangan departemen–jabatan aktif dari ID (utama) atau nama (kompatibilitas).
 * Tidak pernah membuat master baru — nilai yang tidak dikenal ditolak 422.
 */
async function resolvePosition(db, scope, input = {}) {
  let row = null;
  if (input.position_id) {
    row = await positionWithDept(db, scope, input.position_id).catch(() => null);
    if (!row) throw httpError('Jabatan tidak ditemukan di master.');
    if (input.department_id && input.department_id !== row.department_id) {
      throw httpError('Jabatan tidak berada di departemen terpilih.');
    }
  } else {
    const dept = nameKey(input.department);
    const pos = nameKey(input.position);
    if (!dept || !pos) throw httpError('Departemen dan jabatan wajib dipilih dari master.');
    const { rows } = await db.query(`
      SELECT p.id, p.name, p.department_id, p.is_active, d.name AS department_name, d.is_active AS department_active
        FROM workforce_positions p JOIN workforce_departments d ON d.id = p.department_id
       WHERE p.tenant_key = $1 AND p.project_key = $2
         AND lower(regexp_replace(trim(d.name), '\\s+', ' ', 'g')) = $3
         AND lower(regexp_replace(trim(p.name), '\\s+', ' ', 'g')) = $4`, [scope.tenantKey, scope.projectKey, dept, pos]);
    row = rows[0];
    if (!row) throw httpError(`"${cleanName(input.position)}" tidak ada di departemen "${cleanName(input.department)}". Tambahkan dulu di Setup master.`);
  }
  if (!row.is_active || row.department_active === false) throw httpError(`Jabatan "${row.name}" sedang nonaktif.`);
  return { position_id: row.id, department_id: row.department_id, position_name: row.name, department_name: row.department_name };
}

module.exports = {
  FUNCTION_TAGS,
  cleanName,
  nameKey,
  listOrg,
  createDepartment,
  updateDepartment,
  createPosition,
  updatePosition,
  resolvePosition,
  getMasterVersion,
  bumpMasterVersion,
  withTransaction,
  httpError,
};
