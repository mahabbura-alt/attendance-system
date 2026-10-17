const XLSX = require('xlsx');
const { pool } = require('../config/db');
const {
  validatePatternDays,
  buildSimpleRosterCycle,
  calculateRosterResetRange,
  validateDateRange,
  generateRosterRange,
} = require('../services/roster');

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isoTodayWib() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Mencari day_index (1-based) dari awal blok (run) pertama berstatus `status`
// pada larik template_days. Dipakai untuk re-anchor siklus saat admin menetapkan
// satu hari menjadi S/M: hari tsb dianggap sebagai awal blok shift pada pola.
function findRunStartDayIndex(templateDays, status) {
  if (!Array.isArray(templateDays) || templateDays.length === 0) return null;
  for (let index = 0; index < templateDays.length; index += 1) {
    const isRunStart = templateDays[index] === status
      && (index === 0 || templateDays[index - 1] !== status);
    if (isRunStart) return index + 1;
  }
  return null;
}

async function findOrProvisionRosterAssignment({ client, userId, tanggal, adminId }) {
  const userResult = await client.query(
    `SELECT id, COALESCE(NULLIF(TRIM(jabatan), ''), 'Tanpa Jabatan') AS jabatan
     FROM users
     WHERE id=$1 AND role='karyawan' AND is_active=TRUE
     FOR UPDATE`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) throw httpError('Karyawan aktif tidak ditemukan.', 404);

  const assignmentSql = `SELECT a.*,a.effective_from::text AS effective_from_iso,
          a.effective_to::text AS effective_to_iso,
          rt.roster_cuti_hari,rt.cycle_days,rt.nama AS template_nama
     FROM employee_roster_assignments a
     JOIN roster_templates rt ON rt.id=a.template_id AND rt.is_active=TRUE
     WHERE a.user_id=$1 AND a.is_active=TRUE
       AND a.effective_from <= $2::date
       AND (a.effective_to IS NULL OR a.effective_to >= $2::date)
     ORDER BY a.effective_from DESC
     LIMIT 1 FOR UPDATE OF a`;
  const existingResult = await client.query(assignmentSql, [userId, tanggal]);
  if (existingResult.rows[0]) return existingResult.rows[0];

  // Tanggal CP/OFF sengaja tidak memiliki assignment karena siklus berikutnya
  // baru dimulai setelah periode cuti. Gunakan segmen assignment terdekat sebagai
  // sumber template ketika admin melakukan re-anchor di dalam celah tersebut.
  // Jangan membuat assignment policy baru karena dapat menduplikasi segmen lama.
  const adjacentResult = await client.query(
    `SELECT a.*,a.effective_from::text AS effective_from_iso,
            a.effective_to::text AS effective_to_iso,
            rt.roster_cuti_hari,rt.cycle_days,rt.nama AS template_nama
     FROM employee_roster_assignments a
     JOIN roster_templates rt ON rt.id=a.template_id AND rt.is_active=TRUE
     WHERE a.user_id=$1 AND a.is_active=TRUE
     ORDER BY
       CASE WHEN a.effective_from <= $2::date THEN 0 ELSE 1 END,
       CASE WHEN a.effective_from <= $2::date THEN a.effective_from END DESC,
       CASE WHEN a.effective_from > $2::date THEN a.effective_from END ASC,
       a.created_at DESC
     LIMIT 1 FOR UPDATE OF a`,
    [userId, tanggal],
  );
  if (adjacentResult.rows[0]) return adjacentResult.rows[0];

  const policyResult = await client.query(
    `SELECT p.*
     FROM roster_jabatan_policies p
     WHERE p.jabatan_key=LOWER(REGEXP_REPLACE(TRIM($1), '\\s+', ' ', 'g'))
       AND p.is_active=TRUE
       AND p.effective_from <= $2::date
       AND (p.effective_to IS NULL OR p.effective_to >= $2::date)
     ORDER BY p.effective_from DESC
     LIMIT 1`,
    [user.jabatan, tanggal],
  );
  const policy = policyResult.rows[0];
  if (!policy) {
    throw httpError(`Roster jabatan ${user.jabatan} belum memiliki kebijakan aktif untuk tanggal tersebut. Atur Roster Jabatan terlebih dahulu.`);
  }

  const createdResult = await client.query(
    `INSERT INTO employee_roster_assignments
       (user_id,template_id,effective_from,effective_to,anchor_day_index,created_by)
     VALUES ($1,$2,$3::date,$4::date,$5,$6)
     RETURNING id`,
    [userId, policy.template_id, policy.effective_from, policy.effective_to, policy.anchor_day_index, adminId],
  );
  await client.query(
    `INSERT INTO roster_audit_log (admin_id,user_id,aksi,detail)
     VALUES ($1,$2,'auto_assign_from_jabatan_policy',$3::jsonb)`,
    [adminId, userId, JSON.stringify({
      jabatan: user.jabatan,
      policy_id: policy.id,
      assignment_id: createdResult.rows[0].id,
      effective_from: policy.effective_from,
      effective_to: policy.effective_to,
      trigger_date: tanggal,
    })],
  );
  const provisionedResult = await client.query(assignmentSql, [userId, tanggal]);
  if (!provisionedResult.rows[0]) throw httpError('Sinkronisasi roster jabatan gagal.', 500);
  return provisionedResult.rows[0];
}

async function daftarTemplate(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT rt.*,
              COALESCE(json_agg(rtd.status ORDER BY rtd.day_index)
                FILTER (WHERE rtd.id IS NOT NULL), '[]'::json) AS days
       FROM roster_templates rt
       LEFT JOIN roster_template_days rtd ON rtd.template_id = rt.id
       WHERE rt.is_active = TRUE
       GROUP BY rt.id
       ORDER BY rt.nama`,
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

async function daftarJabatanRoster(req, res, next) {
  try {
    const tanggalMulai = req.query.tanggal_mulai || isoTodayWib();
    const tanggalAkhir = req.query.tanggal_akhir || addDaysIso(tanggalMulai, 30);
    const { days } = validateDateRange(tanggalMulai, tanggalAkhir, 366);
    // Pastikan statistik sinkronisasi membaca proyeksi terbaru. Hanya assignment
    // yang sah yang digenerate; jabatan tanpa policy tetap tampil sebagai gap.
    await generateRosterRange(tanggalMulai, tanggalAkhir);
    const { rows } = await pool.query(
      `WITH active_users AS (
         SELECT u.id,
                COALESCE(NULLIF(trim(u.jabatan), ''), 'Tanpa Jabatan') AS jabatan,
                LOWER(REGEXP_REPLACE(TRIM(COALESCE(NULLIF(u.jabatan, ''), 'Tanpa Jabatan')), '\\s+', ' ', 'g')) AS jabatan_key
         FROM users u
         WHERE u.role='karyawan' AND u.is_active=TRUE
       ), coverage AS (
         SELECT au.id,
                COUNT(rd.id)::int AS filled_days
         FROM active_users au
         LEFT JOIN employee_roster_daily rd
           ON rd.user_id=au.id
          AND rd.tanggal BETWEEN $1::date AND $2::date
         GROUP BY au.id
       )
       SELECT au.jabatan,
              COUNT(*)::int AS jumlah_karyawan,
              COUNT(*) FILTER (WHERE c.filled_days=$3)::int AS jumlah_karyawan_sinkron,
              COUNT(*) FILTER (WHERE c.filled_days<$3)::int AS jumlah_karyawan_belum_sinkron,
              SUM(c.filled_days)::int AS jumlah_sel_sinkron,
              SUM($3-c.filled_days)::int AS jumlah_sel_belum_sinkron,
              BOOL_OR(p.id IS NOT NULL) AS memiliki_policy,
              MAX(rt.nama) FILTER (WHERE p.id IS NOT NULL) AS template_policy
       FROM active_users au
       JOIN coverage c ON c.id=au.id
       LEFT JOIN LATERAL (
         SELECT rp.id,rp.template_id
         FROM roster_jabatan_policies rp
         WHERE rp.jabatan_key=au.jabatan_key AND rp.is_active=TRUE
           AND rp.effective_from <= $2::date
           AND (rp.effective_to IS NULL OR rp.effective_to >= $1::date)
         ORDER BY rp.effective_from DESC
         LIMIT 1
       ) p ON TRUE
       LEFT JOIN roster_templates rt ON rt.id=p.template_id
       GROUP BY au.jabatan
       ORDER BY au.jabatan`,
      [tanggalMulai, tanggalAkhir, days],
    );
    res.json(rows.map(row => ({
      ...row,
      tanggal_mulai: tanggalMulai,
      tanggal_akhir: tanggalAkhir,
      jumlah_hari: days,
    })));
  } catch (error) {
    next(error);
  }
}

async function buatTemplate(req, res, next) {
  const client = await pool.connect();
  try {
    const simpleRoster = buildSimpleRosterCycle(req.body.roster_cuti, req.body.hari_kerja);
    const days = validatePatternDays(simpleRoster.days);
    const rosterKerjaHari = simpleRoster.workDays;
    const rosterCutiHari = simpleRoster.leaveDays;
    const polaShift = simpleRoster.workPattern;
    const nama = `Roster ${simpleRoster.ratio} | ${polaShift}`;

    await client.query('BEGIN');
    const existingResult = await client.query(
      'SELECT id FROM roster_templates WHERE nama=$1 LIMIT 1',
      [nama],
    );
    const isNew = !existingResult.rows[0];
    const { rows } = await client.query(
      `INSERT INTO roster_templates
         (nama, roster_kerja_hari, roster_cuti_hari, pola_shift, cycle_days, created_by, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       ON CONFLICT (nama) DO UPDATE SET
         roster_kerja_hari=EXCLUDED.roster_kerja_hari,
         roster_cuti_hari=EXCLUDED.roster_cuti_hari,
         pola_shift=EXCLUDED.pola_shift,
         cycle_days=EXCLUDED.cycle_days,
         is_active=TRUE,
         updated_at=now()
       RETURNING *`,
      [nama, rosterKerjaHari, rosterCutiHari, polaShift, days.length, req.user.id],
    );
    const template = rows[0];
    await client.query('DELETE FROM roster_template_days WHERE template_id=$1', [template.id]);
    const values = [];
    const tuples = days.map((status, index) => {
      const base = values.length;
      values.push(template.id, index + 1, status);
      return `($${base + 1},$${base + 2},$${base + 3})`;
    });
    await client.query(
      `INSERT INTO roster_template_days (template_id, day_index, status)
       VALUES ${tuples.join(',')}`,
      values,
    );
    await client.query(
      `INSERT INTO roster_audit_log (admin_id, aksi, detail)
       VALUES ($1,$2,$3::jsonb)`,
      [req.user.id, isNew ? 'create_template' : 'update_template', JSON.stringify({
        template_id: template.id,
        roster_cuti: simpleRoster.ratio,
        hari_kerja: simpleRoster.workPattern,
      })],
    );
    await client.query('COMMIT');
    res.status(isNew ? 201 : 200).json({ ...template, days });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') error.statusCode = 409;
    next(error);
  } finally {
    client.release();
  }
}

async function daftarRoster(req, res, next) {
  try {
    const tanggalMulai = req.query.tanggal_mulai || isoTodayWib();
    const tanggalAkhir = req.query.tanggal_akhir || addDaysIso(tanggalMulai, 30);
    const jabatan = String(req.query.jabatan || '').trim();
    if (!jabatan) throw httpError('Jabatan wajib dipilih sebelum memuat tabel roster');
    validateDateRange(tanggalMulai, tanggalAkhir, Number.MAX_SAFE_INTEGER);
    await generateRosterRange(tanggalMulai, tanggalAkhir, null, null, jabatan);

    const [usersResult, dailyResult] = await Promise.all([
      pool.query(
        `SELECT u.id, u.employee_id, u.nama, u.jabatan, u.departemen,
                a.id AS assignment_id, a.template_id, a.effective_from::text,
                a.effective_to::text, a.anchor_day_index,
                rt.nama AS template_nama, rt.roster_kerja_hari,
                rt.roster_cuti_hari, rt.pola_shift, rt.cycle_days,
                COALESCE(td.template_days, '[]'::json) AS template_days
         FROM users u
         LEFT JOIN LATERAL (
           SELECT era.*
           FROM employee_roster_assignments era
           WHERE era.user_id = u.id
             AND era.is_active = TRUE
             AND era.effective_from <= $2::date
             AND (era.effective_to IS NULL OR era.effective_to >= $1::date)
           ORDER BY era.effective_from DESC
           LIMIT 1
         ) a ON TRUE
         LEFT JOIN roster_templates rt ON rt.id = a.template_id
         LEFT JOIN LATERAL (
           SELECT json_agg(rtd.status ORDER BY rtd.day_index) AS template_days
           FROM roster_template_days rtd
           WHERE rtd.template_id = a.template_id
         ) td ON TRUE
         WHERE u.role = 'karyawan' AND u.is_active = TRUE
           AND COALESCE(NULLIF(trim(u.jabatan), ''), 'Tanpa Jabatan') = $3
         ORDER BY COALESCE(u.jabatan, 'Tanpa Jabatan'), u.nama`,
        [tanggalMulai, tanggalAkhir, jabatan],
      ),
      pool.query(
        `SELECT rd.user_id, rd.tanggal::text, rd.status, rd.source, rd.catatan
         FROM employee_roster_daily rd
         JOIN users u ON u.id=rd.user_id
         WHERE rd.tanggal BETWEEN $1::date AND $2::date
           AND u.role='karyawan' AND u.is_active=TRUE
           AND COALESCE(NULLIF(trim(u.jabatan), ''), 'Tanpa Jabatan') = $3
         ORDER BY tanggal`,
        [tanggalMulai, tanggalAkhir, jabatan],
      ),
    ]);

    const schedules = new Map();
    dailyResult.rows.forEach((row) => {
      if (!schedules.has(row.user_id)) schedules.set(row.user_id, {});
      schedules.get(row.user_id)[row.tanggal] = {
        status: row.status,
        source: row.source,
        catatan: row.catatan,
      };
    });

    res.json({
      tanggal_mulai: tanggalMulai,
      tanggal_akhir: tanggalAkhir,
      employees: usersResult.rows.map(user => ({
        ...user,
        schedule: schedules.get(user.id) || {},
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function assignRosterJabatan(req, res, next) {
  const client = await pool.connect();
  try {
    const jabatan = String(req.body.jabatan || '').trim();
    const templateId = req.body.template_id;
    const effectiveFrom = req.body.effective_from || isoTodayWib();
    const effectiveTo = req.body.effective_to || null;
    const anchorDayIndex = Number(req.body.anchor_day_index || 1);
    if (!jabatan) throw httpError('Jabatan wajib dipilih');
    validateDateRange(effectiveFrom, effectiveTo || effectiveFrom, Number.MAX_SAFE_INTEGER);

    await client.query('BEGIN');
    const templateResult = await client.query(
      'SELECT id,cycle_days FROM roster_templates WHERE id=$1 AND is_active=TRUE',
      [templateId],
    );
    const template = templateResult.rows[0];
    if (!template) throw httpError('Template roster tidak ditemukan', 404);
    if (!Number.isInteger(anchorDayIndex) || anchorDayIndex < 1 || anchorDayIndex > template.cycle_days) {
      throw httpError(`Mulai hari harus antara 1 dan ${template.cycle_days}`);
    }
    const usersResult = await client.query(
      `SELECT id FROM users
       WHERE role='karyawan' AND is_active=TRUE
         AND COALESCE(NULLIF(trim(jabatan), ''), 'Tanpa Jabatan')=$1
       ORDER BY nama`,
      [jabatan],
    );
    const userIds = usersResult.rows.map(row => row.id);
    if (!userIds.length) throw httpError('Tidak ada karyawan aktif pada jabatan tersebut', 404);

    const jabatanKey = jabatan.replace(/\s+/g, ' ').trim().toLocaleLowerCase('id-ID');
    await client.query(
      `UPDATE roster_jabatan_policies
       SET is_active=FALSE,updated_at=now()
       WHERE jabatan_key=$1 AND is_active=TRUE`,
      [jabatanKey],
    );
    const policyResult = await client.query(
      `INSERT INTO roster_jabatan_policies
         (jabatan,jabatan_key,template_id,effective_from,effective_to,anchor_day_index,created_by)
       VALUES ($1,$2,$3,$4::date,$5::date,$6,$7)
       RETURNING id`,
      [jabatan, jabatanKey, templateId, effectiveFrom, effectiveTo, anchorDayIndex, req.user.id],
    );

    await client.query(
      `UPDATE employee_roster_assignments
       SET effective_to=$2::date-1,updated_at=now()
       WHERE user_id=ANY($1::uuid[]) AND is_active=TRUE
         AND effective_from<$2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [userIds, effectiveFrom],
    );
    await client.query(
      `UPDATE employee_roster_assignments
       SET is_active=FALSE,updated_at=now()
       WHERE user_id=ANY($1::uuid[]) AND is_active=TRUE AND effective_from >= $2::date`,
      [userIds, effectiveFrom],
    );
    await client.query(
      `INSERT INTO employee_roster_assignments
         (user_id,template_id,effective_from,effective_to,anchor_day_index,created_by)
       SELECT user_id,$2,$3::date,$4::date,$5,$6
       FROM unnest($1::uuid[]) AS daftar(user_id)`,
      [userIds, templateId, effectiveFrom, effectiveTo, anchorDayIndex, req.user.id],
    );
    await client.query(
      `DELETE FROM employee_roster_daily
       WHERE user_id=ANY($1::uuid[]) AND tanggal >= $2::date AND source='generated'`,
      [userIds, effectiveFrom],
    );
    await client.query(
      `INSERT INTO roster_audit_log (admin_id,aksi,detail)
       VALUES ($1,'assign_roster_jabatan',$2::jsonb)`,
      [req.user.id, JSON.stringify({
        jabatan, template_id: templateId, effective_from: effectiveFrom,
        effective_to: effectiveTo, anchor_day_index: anchorDayIndex,
        jumlah_karyawan: userIds.length, policy_id: policyResult.rows[0].id,
      })],
    );
    await client.query('COMMIT');

    await generateRosterRange(
      effectiveFrom,
      effectiveTo || addDaysIso(effectiveFrom, 365),
      null,
      null,
      jabatan,
    );
    res.status(201).json({
      message: `Roster berhasil diterapkan ke ${userIds.length} karyawan dengan jabatan ${jabatan}`,
      jumlah_karyawan: userIds.length,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function assignRoster(req, res, next) {
  const client = await pool.connect();
  try {
    const userId = req.body.user_id;
    const templateId = req.body.template_id;
    const effectiveFrom = req.body.effective_from || isoTodayWib();
    const effectiveTo = req.body.effective_to || null;
    const anchorDayIndex = Number(req.body.anchor_day_index || 1);
    validateDateRange(effectiveFrom, effectiveTo || effectiveFrom, 3660);

    await client.query('BEGIN');
    const valid = await client.query(
      `SELECT u.id, rt.cycle_days
       FROM users u CROSS JOIN roster_templates rt
       WHERE u.id=$1 AND u.role='karyawan' AND u.is_active=TRUE
         AND rt.id=$2 AND rt.is_active=TRUE`,
      [userId, templateId],
    );
    if (!valid.rows[0]) throw httpError('Karyawan aktif atau template roster tidak ditemukan', 404);
    if (!Number.isInteger(anchorDayIndex) || anchorDayIndex < 1 || anchorDayIndex > valid.rows[0].cycle_days) {
      throw httpError(`Anchor hari harus antara 1 dan ${valid.rows[0].cycle_days}`);
    }

    await client.query(
      `UPDATE employee_roster_assignments
       SET effective_to = $2::date - 1, updated_at = now()
       WHERE user_id=$1 AND is_active=TRUE
         AND effective_from < $2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [userId, effectiveFrom],
    );
    await client.query(
      `UPDATE employee_roster_assignments
       SET is_active=FALSE, updated_at=now()
       WHERE user_id=$1 AND is_active=TRUE AND effective_from >= $2::date`,
      [userId, effectiveFrom],
    );
    const { rows } = await client.query(
      `INSERT INTO employee_roster_assignments
         (user_id, template_id, effective_from, effective_to, anchor_day_index, created_by)
       VALUES ($1,$2,$3::date,$4::date,$5,$6)
       RETURNING *`,
      [userId, templateId, effectiveFrom, effectiveTo, anchorDayIndex, req.user.id],
    );
    await client.query(
      `DELETE FROM employee_roster_daily
       WHERE user_id=$1 AND tanggal >= $2::date AND source='generated'`,
      [userId, effectiveFrom],
    );
    await client.query(
      `INSERT INTO roster_audit_log (admin_id,user_id,aksi,detail)
       VALUES ($1,$2,'assign_roster',$3::jsonb)`,
      [req.user.id, userId, JSON.stringify(rows[0])],
    );
    await client.query('COMMIT');

    const generateUntil = effectiveTo || addDaysIso(effectiveFrom, 365);
    await generateRosterRange(effectiveFrom, generateUntil, userId);
    res.status(201).json({ message: 'Roster karyawan berhasil ditetapkan', assignment: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function applyRosterDailyOverride({ client, userId, tanggal, statusValue, catatan, adminId }) {
  const status = validatePatternDays([statusValue])[0];
  validateDateRange(tanggal, tanggal, 1);
    const currentRosterResult = await client.query(
      `SELECT source
       FROM employee_roster_daily
       WHERE user_id=$1 AND tanggal=$2::date
       LIMIT 1
       FOR UPDATE`,
      [userId, tanggal],
    );
    if (currentRosterResult.rows[0]?.source === 'leave_sync') {
      throw httpError('Jadwal CP ini bersumber dari Database Cuti. Koreksi realisasi cuti dari Database Cuti agar roster tetap sinkron.', 409);
    }
    if (status === 'CP' || status === 'OFF') {
      const assignment = await findOrProvisionRosterAssignment({ client, userId, tanggal, adminId });
      const leaveDays = status === 'CP' ? Number(assignment.roster_cuti_hari) : 1;
      const { startDate, endDate, resetDate } = calculateRosterResetRange(status, tanggal, leaveDays);
      if (assignment.effective_to_iso && assignment.effective_to_iso < resetDate) {
        throw httpError(`Periode assignment roster berakhir sebelum reset ${status} selesai`);
      }

      await client.query(
        `UPDATE employee_roster_assignments
         SET effective_to=CASE WHEN effective_from<$2::date THEN $2::date-1 ELSE effective_to END,
             is_active=CASE WHEN effective_from=$2::date THEN FALSE ELSE is_active END,
             updated_at=now()
         WHERE id=$1`,
        [assignment.id, startDate],
      );
      await client.query(
        `UPDATE employee_roster_assignments
         SET is_active=FALSE,updated_at=now()
         WHERE user_id=$1 AND is_active=TRUE AND id<>$2
           AND effective_from >= $3::date`,
        [userId, assignment.id, startDate],
      );
      await client.query(
        `DELETE FROM employee_roster_daily
         WHERE user_id=$1 AND tanggal >= $2::date`,
        [userId, startDate],
      );
      const newAssignmentResult = await client.query(
        `INSERT INTO employee_roster_assignments
           (user_id,template_id,effective_from,effective_to,anchor_day_index,created_by)
         VALUES ($1,$2,$3::date,$4::date,1,$5)
         RETURNING *`,
        [userId, assignment.template_id, resetDate, assignment.effective_to_iso, adminId],
      );
      await client.query(
        `INSERT INTO employee_roster_daily
           (user_id,tanggal,status,shift_id,source,catatan,updated_by)
         SELECT $1,hari::date,$4::varchar,NULL,'manual_override',$5,$6
         FROM generate_series($2::date,$3::date,interval '1 day') AS hari
         ON CONFLICT (user_id,tanggal) DO UPDATE SET
           status=EXCLUDED.status,shift_id=NULL,assignment_id=NULL,source='manual_override',
           catatan=EXCLUDED.catatan,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [
          userId, startDate, endDate, status,
          catatan || (status === 'CP' ? 'Reset siklus cuti periodik' : 'Reset siklus setelah OFF'),
          adminId,
        ],
      );
      const generateUntil = assignment.effective_to_iso
        ? assignment.effective_to_iso
        : addDaysIso(resetDate, 365);
      await generateRosterRange(resetDate, generateUntil, userId, client);
      const detail = {
        status,
        start_date: startDate,
        end_date: endDate,
        reset_date: resetDate,
        duration_days: leaveDays,
        previous_assignment_id: assignment.id,
        new_assignment_id: newAssignmentResult.rows[0].id,
      };
      await client.query(
        `INSERT INTO roster_audit_log (admin_id,user_id,aksi,detail)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [adminId, userId, status === 'CP' ? 'reset_cycle_cp' : 'reset_cycle_off', JSON.stringify(detail)],
      );
      return {
        message: status === 'CP'
          ? `CP diterapkan ${startDate} s/d ${endDate}. Siklus kerja dimulai ulang ${resetDate}.`
          : `OFF diterapkan ${startDate}. Siklus kerja dimulai ulang ${resetDate}.`,
        ...detail,
      };
    }

    // --- Re-anchor siklus untuk S/M ---
    // Saat admin menetapkan satu hari menjadi S/M, hari tsb dianggap sebagai awal
    // blok shift pada pola template. Assignment dibuat ulang mulai dari tanggal tsb
    // dengan anchor_day_index = awal blok (run) berstatus tsb, sehingga hari-hari
    // berikutnya otomatis mengikuti pola template (mis. set 6 Sep=M -> 6-11 Sep=M).
    const assignment = await findOrProvisionRosterAssignment({ client, userId, tanggal, adminId });
    const templateDaysResult = await client.query(
      `SELECT status FROM roster_template_days
       WHERE template_id=$1
       ORDER BY day_index`,
      [assignment.template_id],
    );
    const templateDays = templateDaysResult.rows.map((r) => r.status);
    const anchorDayIndex = findRunStartDayIndex(templateDays, status);
    if (!anchorDayIndex) {
      // Template tidak memiliki blok berstatus tsb -> fallback override satu hari.
      const { rows } = await client.query(
        `INSERT INTO employee_roster_daily
           (user_id,tanggal,status,shift_id,source,catatan,updated_by)
         VALUES (
           $1,$2::date,$3::varchar,
           CASE
             WHEN $3::varchar='S' THEN (SELECT id FROM shifts WHERE nama_shift ILIKE '%Siang%' LIMIT 1)
             WHEN $3::varchar='M' THEN (SELECT id FROM shifts WHERE nama_shift ILIKE '%Malam%' LIMIT 1)
             ELSE NULL
           END,
           'manual_override',$4,$5
         )
         ON CONFLICT (user_id,tanggal) DO UPDATE SET
           status=EXCLUDED.status, shift_id=EXCLUDED.shift_id,
           source='manual_override', catatan=EXCLUDED.catatan,
           updated_by=EXCLUDED.updated_by, updated_at=now()
         RETURNING *`,
        [userId, tanggal, status, catatan || null, adminId],
      );
      await client.query(
        `INSERT INTO roster_audit_log (admin_id,user_id,aksi,detail)
         VALUES ($1,$2,'override_daily',$3::jsonb)`,
        [adminId, userId, JSON.stringify(rows[0])],
      );
      return { message: 'Roster harian berhasil diperbarui', roster: rows[0] };
    }

    // Jika re-anchor dilakukan di dalam celah CP/OFF, assignment sumber sudah
    // berakhir sebelum tanggal pilihan. Ambil horizon dari assignment reset
    // berikutnya agar assignment pengganti tidak berakhir sebelum dimulai.
    let replacementEffectiveTo = assignment.effective_to_iso || null;
    if (replacementEffectiveTo && replacementEffectiveTo < tanggal) {
      const continuationResult = await client.query(
        `SELECT effective_to::text AS effective_to_iso
         FROM employee_roster_assignments
         WHERE user_id=$1 AND is_active=TRUE AND id<>$2
           AND effective_from > $3::date
         ORDER BY effective_from ASC,created_at DESC
         LIMIT 1 FOR UPDATE`,
        [userId, assignment.id, tanggal],
      );
      replacementEffectiveTo = continuationResult.rows[0]?.effective_to_iso || null;
    }

    // Tutup assignment aktif pada tanggal-1 (atau nonaktifkan bila mulai hari tsb).
    await client.query(
      `UPDATE employee_roster_assignments
       SET effective_to=CASE WHEN effective_from<$2::date THEN $2::date-1 ELSE effective_to END,
           is_active=CASE WHEN effective_from=$2::date THEN FALSE ELSE is_active END,
           updated_at=now()
       WHERE id=$1`,
      [assignment.id, tanggal],
    );
    // Nonaktifkan assignment lain yang mulai dari tanggal tsb ke depan.
    await client.query(
      `UPDATE employee_roster_assignments
       SET is_active=FALSE,updated_at=now()
       WHERE user_id=$1 AND is_active=TRUE AND id<>$2
         AND effective_from >= $3::date`,
      [userId, assignment.id, tanggal],
    );
    // Re-anchor S/M mengganti seluruh proyeksi roster mulai tanggal yang dipilih.
    // Simpan nilai manual lama ke audit sebelum dihapus agar preview dan hasil
    // persistensi konsisten tanpa kehilangan jejak perubahan CP/OFF/C sebelumnya.
    const supersededManualOverridesResult = await client.query(
      `SELECT tanggal::text,status,catatan
       FROM employee_roster_daily
       WHERE user_id=$1 AND tanggal >= $2::date AND source='manual_override'
       ORDER BY tanggal`,
      [userId, tanggal],
    );
    await client.query(
      `DELETE FROM employee_roster_daily
       WHERE user_id=$1 AND tanggal >= $2::date`,
      [userId, tanggal],
    );
    // Buat assignment baru: mulai tanggal tsb dengan anchor = awal blok shift tsb.
    const newAssignmentResult = await client.query(
      `INSERT INTO employee_roster_assignments
         (user_id,template_id,effective_from,effective_to,anchor_day_index,created_by)
       VALUES ($1,$2,$3::date,$4::date,$5,$6)
       RETURNING *`,
      [userId, assignment.template_id, tanggal, replacementEffectiveTo, anchorDayIndex, adminId],
    );
    const generateUntil = replacementEffectiveTo
      ? replacementEffectiveTo
      : addDaysIso(tanggal, 365);
    await generateRosterRange(tanggal, generateUntil, userId, client);

    const detail = {
      status,
      tanggal,
      anchor_day_index: anchorDayIndex,
      previous_assignment_id: assignment.id,
      new_assignment_id: newAssignmentResult.rows[0].id,
      effective_to: replacementEffectiveTo,
      superseded_manual_overrides: supersededManualOverridesResult.rows,
    };
    await client.query(
      `INSERT INTO roster_audit_log (admin_id,user_id,aksi,detail)
       VALUES ($1,$2,'reanchor_shift',$3::jsonb)`,
      [adminId, userId, JSON.stringify(detail)],
    );
    return {
      message: `${status === 'S' ? 'Siang' : 'Malam'} diterapkan mulai ${tanggal}. Siklus shift disesuaikan mengikuti pola template.`,
      ...detail,
    };
}

async function overrideRosterDaily(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await applyRosterDailyOverride({
      client,
      userId: req.body.user_id,
      tanggal: req.body.tanggal,
      statusValue: req.body.status,
      catatan: req.body.catatan,
      adminId: req.user.id,
    });
    await client.query('COMMIT');
    res.json(result);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function overrideRosterDailyBatch(req, res, next) {
  const client = await pool.connect();
  try {
    const rawChanges = req.body.changes;
    if (!Array.isArray(rawChanges) || rawChanges.length < 1) {
      throw httpError('Tidak ada perubahan roster untuk disimpan');
    }
    if (rawChanges.length > 2000) {
      throw httpError('Maksimal 2000 perubahan roster dalam satu sesi');
    }
    const changes = rawChanges.map((change) => {
      if (!change || !change.user_id || typeof change.tanggal !== 'string' || typeof change.status !== 'string') {
        throw httpError('Format perubahan roster tidak valid');
      }
      return {
        user_id: change.user_id,
        tanggal: change.tanggal,
        status: change.status,
      };
    }).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
    const uniqueKeys = new Set(changes.map(change => `${change.user_id}_${change.tanggal}`));
    if (uniqueKeys.size !== changes.length) {
      throw httpError('Terdapat perubahan roster ganda untuk karyawan dan tanggal yang sama');
    }

    await client.query('BEGIN');
    const results = [];
    for (const change of changes) {
      if (!change.user_id) throw httpError('Karyawan pada perubahan roster tidak valid');
      results.push(await applyRosterDailyOverride({
        client,
        userId: change.user_id,
        tanggal: change.tanggal,
        statusValue: change.status,
        catatan: null,
        adminId: req.user.id,
      }));
    }
    await client.query('COMMIT');
    res.json({
      message: `${changes.length} perubahan roster berhasil disimpan`,
      updated: changes.length,
      results,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function exportRoster(req, res, next) {
  try {
    const tanggalMulai = req.query.tanggal_mulai || isoTodayWib();
    const tanggalAkhir = req.query.tanggal_akhir || addDaysIso(tanggalMulai, 30);
    const { days } = validateDateRange(tanggalMulai, tanggalAkhir, Number.MAX_SAFE_INTEGER);
    await generateRosterRange(tanggalMulai, tanggalAkhir);
    const [users, daily] = await Promise.all([
      pool.query(
        `SELECT id, employee_id, nama, jabatan, departemen
         FROM users WHERE role='karyawan' AND is_active=TRUE ORDER BY jabatan,nama`,
      ),
      pool.query(
        `SELECT user_id,tanggal::text,status FROM employee_roster_daily
         WHERE tanggal BETWEEN $1::date AND $2::date`,
        [tanggalMulai, tanggalAkhir],
      ),
    ]);
    const byKey = new Map(daily.rows.map(row => [`${row.user_id}_${row.tanggal}`, row.status]));
    const dates = Array.from({ length: days }, (_, index) => addDaysIso(tanggalMulai, index));
    const rows = users.rows.map(user => {
      const row = {
        'EMPLOYEE ID': user.employee_id || '',
        'NAMA KARYAWAN': user.nama,
        'JABATAN': user.jabatan || '',
        'DEPARTEMEN': user.departemen || '',
      };
      dates.forEach(date => { row[date] = byKey.get(`${user.id}_${date}`) || ''; });
      return row;
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Roster Karyawan');
    const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="roster_${tanggalMulai}_${tanggalAkhir}.xlsx"`);
    res.send(output);
  } catch (error) {
    next(error);
  }
}

async function importRoster(req, res, next) {
  const client = await pool.connect();
  try {
    if (!req.file) throw httpError('Berkas Excel roster wajib diunggah');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    if (!rows.length) throw httpError('Berkas Excel roster tidak berisi data');
    const dateColumns = Object.keys(rows[0]).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key));
    if (!dateColumns.length) throw httpError('Template harus memiliki kolom tanggal YYYY-MM-DD');
    dateColumns.forEach(date => validateDateRange(date, date, 1));

    await client.query('BEGIN');
    let imported = 0;
    for (const row of rows) {
      const employeeId = String(row['EMPLOYEE ID'] || '').trim();
      if (!employeeId) continue;
      const userResult = await client.query(
        `SELECT id FROM users
         WHERE role='karyawan' AND is_active=TRUE
           AND lower(trim(employee_id))=lower(trim($1)) LIMIT 1`,
        [employeeId],
      );
      if (!userResult.rows[0]) throw httpError(`Employee ID ${employeeId} tidak ditemukan atau nonaktif`);
      for (const date of dateColumns) {
        const rawStatus = String(row[date] || '').trim();
        if (!rawStatus) continue;
        const status = validatePatternDays([rawStatus])[0];
        const importedRow = await client.query(
          `INSERT INTO employee_roster_daily
             (user_id,tanggal,status,shift_id,source,catatan,updated_by)
           VALUES ($1,$2::date,$3::varchar,
             CASE WHEN $3::varchar='S' THEN (SELECT id FROM shifts WHERE nama_shift ILIKE '%Siang%' LIMIT 1)
                  WHEN $3::varchar='M' THEN (SELECT id FROM shifts WHERE nama_shift ILIKE '%Malam%' LIMIT 1)
                  ELSE NULL END,
             'manual_override','Import Excel',$4)
           ON CONFLICT (user_id,tanggal) DO UPDATE SET
             status=EXCLUDED.status,shift_id=EXCLUDED.shift_id,source='manual_override',
             catatan='Import Excel',updated_by=EXCLUDED.updated_by,updated_at=now()
           WHERE employee_roster_daily.source <> 'leave_sync'
           RETURNING id`,
          [userResult.rows[0].id, date, status, req.user.id],
        );
        if (!importedRow.rows[0]) {
          throw httpError(`Roster ${employeeId} tanggal ${date} bersumber dari Database Cuti dan tidak dapat ditimpa melalui import.`, 409);
        }
        imported += 1;
      }
    }
    await client.query(
      `INSERT INTO roster_audit_log (admin_id,aksi,detail)
       VALUES ($1,'import_excel',$2::jsonb)`,
      [req.user.id, JSON.stringify({ imported })],
    );
    await client.query('COMMIT');
    res.json({ message: `Import roster berhasil: ${imported} jadwal diperbarui`, imported });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = {
  daftarRoster,
  daftarJabatanRoster,
  daftarTemplate,
  buatTemplate,
  assignRoster,
  assignRosterJabatan,
  overrideRosterDaily,
  overrideRosterDailyBatch,
  exportRoster,
  importRoster,
  findOrProvisionRosterAssignment,
  applyRosterDailyOverride,
};
