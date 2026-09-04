const VALID_STATUSES = new Set(['S', 'M', 'C', 'CP', 'OFF']);

function parseIsoDate(value, label = 'Tanggal') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`${label} harus berformat YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} tidak valid`);
  }
  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function calculatePeriodicLeaveReset(start, leaveDays) {
  const range = calculateRosterResetRange('CP', start, leaveDays);
  return {
    cpStart: range.startDate,
    cpEnd: range.endDate,
    resetDate: range.resetDate,
  };
}

function calculateRosterResetRange(status, start, leaveDays) {
  const cpStartDate = parseIsoDate(start, 'Tanggal CP');
  const normalizedStatus = String(status || '').trim().toUpperCase();
  if (!['CP', 'OFF'].includes(normalizedStatus)) {
    throw new Error('Reset siklus hanya berlaku untuk CP atau OFF');
  }
  const totalLeaveDays = normalizedStatus === 'OFF' ? 1 : Number(leaveDays);
  if (!Number.isInteger(totalLeaveDays) || totalLeaveDays < 1) {
    throw new Error('Jumlah hari cuti periodik harus minimal 1 hari');
  }
  const cpEndDate = new Date(cpStartDate);
  cpEndDate.setUTCDate(cpEndDate.getUTCDate() + totalLeaveDays - 1);
  const resetDateValue = new Date(cpEndDate);
  resetDateValue.setUTCDate(resetDateValue.getUTCDate() + 1);
  return {
    startDate: toIsoDate(cpStartDate),
    endDate: toIsoDate(cpEndDate),
    resetDate: toIsoDate(resetDateValue),
  };
}

function validatePatternDays(days) {
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error('Pola roster wajib memiliki sedikitnya satu hari');
  }
  if (days.length > 366) throw new Error('Pola roster maksimal 366 hari');
  return days.map((raw) => {
    const status = String(raw || '').trim().toUpperCase();
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`Status roster "${raw}" tidak valid. Gunakan S, M, C, CP, atau OFF`);
    }
    return status;
  });
}

function buildSimpleRosterCycle(rosterCuti, hariKerja) {
  const ratioMatch = String(rosterCuti || '').trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!ratioMatch) {
    throw new Error('Roster Cuti harus berformat seperti 84:14');
  }
  const workDays = Number(ratioMatch[1]);
  const leaveDays = Number(ratioMatch[2]);
  if (!Number.isInteger(workDays) || workDays < 1 || !Number.isInteger(leaveDays) || leaveDays < 0) {
    throw new Error('Roster Cuti harus berisi jumlah hari yang valid');
  }
  if (workDays + leaveDays > 366) {
    throw new Error('Total siklus roster maksimal 366 hari');
  }

  const tokens = String(hariKerja || '').trim().toUpperCase().split(/[,+\s]+/).filter(Boolean);
  if (!tokens.length) throw new Error('Hari Kerja wajib diisi, contoh 7S,6M,OFF');
  const workPattern = [];
  const normalizedTokens = [];
  tokens.forEach((token) => {
    const match = token.match(/^(\d+)?(OFF|S|M)$/);
    if (!match) {
      throw new Error(`Hari Kerja "${token}" tidak valid. Gunakan S, M, atau OFF`);
    }
    const count = Number(match[1] || 1);
    if (!Number.isInteger(count) || count < 1 || count > 366) {
      throw new Error('Jumlah hari pada pola Hari Kerja harus 1-366');
    }
    normalizedTokens.push(`${count === 1 ? '' : count}${match[2]}`);
    for (let index = 0; index < count; index += 1) workPattern.push(match[2]);
  });

  const days = Array.from({ length: workDays }, (_, index) => workPattern[index % workPattern.length]);
  days.push(...Array(leaveDays).fill('CP'));
  return {
    days,
    workDays,
    leaveDays,
    ratio: `${workDays}:${leaveDays}`,
    workPattern: normalizedTokens.join(','),
  };
}

function resolvePatternDay(days, effectiveFrom, targetDate, anchorDayIndex = 1) {
  const pattern = validatePatternDays(days);
  const start = parseIsoDate(effectiveFrom, 'Tanggal mulai roster');
  const target = parseIsoDate(targetDate, 'Tanggal roster');
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86400000);
  if (diffDays < 0) return null;
  const anchor = Math.max(1, Math.min(Number(anchorDayIndex) || 1, pattern.length));
  const index = ((diffDays + anchor - 1) % pattern.length + pattern.length) % pattern.length;
  return pattern[index];
}

function resolvePlannedShiftName(rosterStatus, fallbackShiftName) {
  if (rosterStatus === 'S') return 'Siang';
  if (rosterStatus === 'M') return 'Malam';
  return fallbackShiftName;
}

function resolveDailyCategory({
  hasAttendance = false,
  manualCategory = null,
  rosterStatus = null,
  isSunday = false,
} = {}) {
  const expectedWork = rosterStatus === 'S' || rosterStatus === 'M';
  if (hasAttendance) return { category: 'hadir_kamera', source: 'camera', expectedWork: true };
  if (manualCategory) {
    return {
      category: manualCategory,
      source: 'manual',
      expectedWork: manualCategory === 'hadir_manual'
        ? true
        : (rosterStatus ? expectedWork : manualCategory !== 'off'),
    };
  }
  if (rosterStatus === 'C') return { category: 'cuti', source: 'roster', expectedWork: false };
  if (rosterStatus === 'CP') return { category: 'cuti', source: 'roster_periodik', expectedWork: false };
  if (rosterStatus === 'OFF') return { category: 'off', source: 'roster', expectedWork: false };
  if (expectedWork) return { category: 'alpa', source: 'roster', expectedWork: true };
  if (isSunday) return { category: 'off', source: 'legacy', expectedWork: false };
  return { category: 'alpa', source: 'legacy', expectedWork: true };
}

let schemaPromise = null;

async function ensureRosterSchema() {
  if (schemaPromise) return schemaPromise;
  const { pool } = require('../config/db');
  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roster_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nama VARCHAR(150) NOT NULL UNIQUE,
        roster_kerja_hari INTEGER NOT NULL DEFAULT 0 CHECK (roster_kerja_hari >= 0),
        roster_cuti_hari INTEGER NOT NULL DEFAULT 0 CHECK (roster_cuti_hari >= 0),
        pola_shift VARCHAR(150),
        cycle_days INTEGER NOT NULL CHECK (cycle_days BETWEEN 1 AND 366),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS roster_template_days (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id UUID NOT NULL REFERENCES roster_templates(id) ON DELETE CASCADE,
        day_index INTEGER NOT NULL CHECK (day_index BETWEEN 1 AND 366),
        status VARCHAR(4) NOT NULL CHECK (status IN ('S','M','C','CP','OFF')),
        UNIQUE(template_id, day_index)
      );

      CREATE TABLE IF NOT EXISTS employee_roster_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_id UUID NOT NULL REFERENCES roster_templates(id),
        effective_from DATE NOT NULL,
        effective_to DATE,
        anchor_day_index INTEGER NOT NULL DEFAULT 1 CHECK (anchor_day_index BETWEEN 1 AND 366),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
      );

      CREATE INDEX IF NOT EXISTS idx_roster_assignment_user_dates
        ON employee_roster_assignments(user_id, effective_from, effective_to);

      CREATE TABLE IF NOT EXISTS employee_roster_daily (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tanggal DATE NOT NULL,
        status VARCHAR(4) NOT NULL CHECK (status IN ('S','M','C','CP','OFF')),
        shift_id UUID REFERENCES shifts(id),
        assignment_id UUID REFERENCES employee_roster_assignments(id) ON DELETE SET NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','manual_override')),
        catatan TEXT,
        updated_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, tanggal)
      );

      CREATE INDEX IF NOT EXISTS idx_roster_daily_date_user
        ON employee_roster_daily(tanggal, user_id);

      CREATE TABLE IF NOT EXISTS roster_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID REFERENCES users(id),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        aksi VARCHAR(50) NOT NULL,
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

    `);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

function validateDateRange(start, end, maxDays = 366) {
  const startDate = parseIsoDate(start, 'Tanggal awal');
  const endDate = parseIsoDate(end, 'Tanggal akhir');
  const days = Math.floor((endDate - startDate) / 86400000) + 1;
  if (days < 1) throw new Error('Tanggal akhir tidak boleh sebelum tanggal awal');
  if (days > maxDays) throw new Error(`Rentang roster maksimal ${maxDays} hari`);
  return { startDate, endDate, days };
}

async function generateRosterRange(start, end, userId = null, dbClient = null, jabatan = null) {
  validateDateRange(start, end, Number.MAX_SAFE_INTEGER);
  await ensureRosterSchema();
  const { pool } = require('../config/db');
  const db = dbClient || pool;
  const params = [start, end];
  let userFilter = '';
  if (userId) {
    params.push(userId);
    userFilter = `AND a.user_id = $${params.length}`;
  }
  let jabatanFilter = '';
  if (jabatan) {
    params.push(jabatan);
    jabatanFilter = `AND COALESCE(NULLIF(trim(roster_user.jabatan), ''), 'Tanpa Jabatan') = $${params.length}`;
  }
  await db.query(
    `INSERT INTO employee_roster_daily
       (user_id, tanggal, status, shift_id, assignment_id, source, updated_at)
     SELECT
       a.user_id,
       hari.tanggal,
       td.status,
       CASE
         WHEN td.status = 'S' THEN shift_siang.id
         WHEN td.status = 'M' THEN shift_malam.id
         ELSE NULL
       END,
       a.id,
       'generated',
       now()
     FROM employee_roster_assignments a
     JOIN users roster_user ON roster_user.id = a.user_id
     JOIN roster_templates rt ON rt.id = a.template_id AND rt.is_active = TRUE
     CROSS JOIN LATERAL generate_series(
       GREATEST(a.effective_from, $1::date),
       LEAST(COALESCE(a.effective_to, $2::date), $2::date),
       interval '1 day'
     ) AS seri(tanggal_ts)
     CROSS JOIN LATERAL (SELECT seri.tanggal_ts::date AS tanggal) hari
     JOIN roster_template_days td
       ON td.template_id = rt.id
      AND td.day_index = MOD(
        ((hari.tanggal - a.effective_from) + a.anchor_day_index - 1),
        rt.cycle_days
      ) + 1
     LEFT JOIN LATERAL (
       SELECT id FROM shifts WHERE nama_shift ILIKE '%Siang%' ORDER BY created_at LIMIT 1
     ) shift_siang ON TRUE
     LEFT JOIN LATERAL (
       SELECT id FROM shifts WHERE nama_shift ILIKE '%Malam%' ORDER BY created_at LIMIT 1
     ) shift_malam ON TRUE
     WHERE a.is_active = TRUE
       AND a.effective_from <= $2::date
       AND (a.effective_to IS NULL OR a.effective_to >= $1::date)
       ${userFilter}
       ${jabatanFilter}
     ON CONFLICT (user_id, tanggal) DO UPDATE SET
       status = EXCLUDED.status,
       shift_id = EXCLUDED.shift_id,
       assignment_id = EXCLUDED.assignment_id,
       updated_at = now()
     WHERE employee_roster_daily.source = 'generated'`,
    params,
  );
}

async function getRosterForUserDate(userId, date) {
  parseIsoDate(date, 'Tanggal roster');
  try {
    await generateRosterRange(date, date, userId);
    const { pool } = require('../config/db');
    const { rows } = await pool.query(
      `SELECT rd.*, s.nama_shift
       FROM employee_roster_daily rd
       LEFT JOIN shifts s ON s.id = rd.shift_id
       WHERE rd.user_id = $1 AND rd.tanggal = $2::date
       LIMIT 1`,
      [userId, date],
    );
    return rows[0] || null;
  } catch (error) {
    // Roster adalah penentu jadwal, bukan pengunci absensi. Jika modul roster
    // sedang tidak tersedia, alur lama berbasis jam harus tetap dapat dipakai.
    console.warn('[roster] fallback shift berdasarkan jam:', error.message);
    return null;
  }
}

async function getRosterMap(start, end) {
  validateDateRange(start, end, 366);
  try {
    await generateRosterRange(start, end);
    const { pool } = require('../config/db');
    const { rows } = await pool.query(
      `SELECT user_id, tanggal::text AS tanggal, status, shift_id, source, catatan
       FROM employee_roster_daily
       WHERE tanggal BETWEEN $1::date AND $2::date`,
      [start, end],
    );
    return new Map(rows.map((row) => [`${row.user_id}_${row.tanggal}`, row]));
  } catch (error) {
    // Rekap historis lama tetap harus dapat dibuka saat tabel roster belum ada
    // atau sedang bermasalah. Runtime log tetap menyimpan penyebab teknisnya.
    console.warn('[roster] rekap memakai data legacy:', error.message);
    return new Map();
  }
}

module.exports = {
  VALID_STATUSES,
  parseIsoDate,
  toIsoDate,
  calculatePeriodicLeaveReset,
  calculateRosterResetRange,
  validatePatternDays,
  buildSimpleRosterCycle,
  resolvePatternDay,
  resolvePlannedShiftName,
  resolveDailyCategory,
  validateDateRange,
  ensureRosterSchema,
  generateRosterRange,
  getRosterForUserDate,
  getRosterMap,
};
