'use strict';

/**
 * OMOS People — pengingat (tab Pengingat) dan proses harian:
 *   1. terapkan pergerakan yang sudah jatuh tempo (APPROVED → EFFECTIVE),
 *   2. proses people_outbox (efek lintas modul, idempoten).
 */

const Workforce = require('./workforce');

const CONTRACT_WINDOW = 60;
const PROBATION_WINDOW = 30;
const DOCUMENT_WINDOW = 60;

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 864e5);
}

function severity(days) {
  if (days < 0) return 'OVERDUE';
  if (days <= 14) return 'URGENT';
  return 'SOON';
}

/**
 * Daftar pengingat: kontrak berakhir ≤60 hari, probation berakhir ≤30 hari,
 * dokumen kompetensi kedaluwarsa ≤60 hari, dan karyawan masa pemberitahuan.
 * Yang sudah lewat tanggal tetap tampil (OVERDUE) sampai ditindaklanjuti.
 */
async function getReminders(db, scope, opts = {}) {
  const today = opts.today || Workforce.todayWib();
  const [contracts, probation, docs, notice, pending] = await Promise.all([
    db.query(`SELECT u.id AS user_id, u.nama, u.employee_id AS nrp, u.jabatan, u.departemen,
        p.contract_end_date::text AS date, p.employment_type
      FROM workforce_employee_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.tenant_key = $1 AND p.voided_at IS NULL AND u.is_active
        AND p.employment_status IN ('ACTIVE','PROBATION') AND p.contract_end_date IS NOT NULL
        AND p.contract_end_date <= $2::date + $3::int
        AND NOT EXISTS (SELECT 1 FROM workforce_employee_movements m WHERE m.employee_profile_id = p.id
          AND m.status IN ('DRAFT','SUBMITTED','APPROVED')
          AND m.movement_type IN ('CONTRACT_RENEWAL','CONTRACT_END','EMPLOYMENT_TYPE_CHANGE','RESIGN','TERMINATION'))
      ORDER BY p.contract_end_date`, [scope.tenantKey, today, CONTRACT_WINDOW]),
    db.query(`SELECT u.id AS user_id, u.nama, u.employee_id AS nrp, u.jabatan, u.departemen,
        p.probation_end_date::text AS date
      FROM workforce_employee_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.tenant_key = $1 AND p.voided_at IS NULL AND u.is_active
        AND p.employment_status = 'PROBATION' AND p.probation_end_date IS NOT NULL
        AND p.probation_end_date <= $2::date + $3::int
        AND NOT EXISTS (SELECT 1 FROM workforce_employee_movements m WHERE m.employee_profile_id = p.id
          AND m.status IN ('DRAFT','SUBMITTED','APPROVED') AND m.movement_type IN ('CONFIRMATION','TERMINATION','RESIGN'))
      ORDER BY p.probation_end_date`, [scope.tenantKey, today, PROBATION_WINDOW]),
    db.query(`SELECT u.id AS user_id, u.nama, u.employee_id AS nrp, u.jabatan, u.departemen,
        d.id AS document_id, d.title, d.doc_type, d.expiry_date::text AS date
      FROM employee_documents d
      JOIN workforce_employee_profiles p ON p.id = d.employee_profile_id
      JOIN users u ON u.id = p.user_id
      WHERE d.tenant_key = $1 AND d.deleted_at IS NULL AND d.expiry_date IS NOT NULL
        AND d.expiry_date <= $2::date + $3::int
        AND p.voided_at IS NULL AND u.is_active AND p.employment_status <> 'INACTIVE'
        AND NOT EXISTS (SELECT 1 FROM employee_documents n WHERE n.employee_profile_id = d.employee_profile_id
          AND n.deleted_at IS NULL AND n.doc_type = d.doc_type AND lower(n.title) = lower(d.title)
          AND n.expiry_date > d.expiry_date)
      ORDER BY d.expiry_date`, [scope.tenantKey, today, DOCUMENT_WINDOW]),
    db.query(`SELECT u.id AS user_id, u.nama, u.employee_id AS nrp, u.jabatan, u.departemen,
        p.last_working_day::text AS date,
        (SELECT m.movement_type FROM workforce_employee_movements m WHERE m.employee_profile_id = p.id
          AND m.status = 'APPROVED' ORDER BY m.effective_date DESC LIMIT 1) AS movement_type,
        (SELECT COUNT(*)::int FROM workforce_movement_tasks t JOIN workforce_employee_movements m ON m.id = t.movement_id
          WHERE m.employee_profile_id = p.id AND m.status = 'APPROVED' AND t.is_required AND t.status NOT IN ('DONE','WAIVED')) AS open_tasks
      FROM workforce_employee_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.tenant_key = $1 AND p.voided_at IS NULL AND p.employment_status = 'NOTICE'
      ORDER BY p.last_working_day NULLS LAST`, [scope.tenantKey]),
    db.query(`SELECT COUNT(*)::int AS n FROM workforce_employee_movements
      WHERE tenant_key = $1 AND status = 'SUBMITTED'`, [scope.tenantKey]),
  ]);

  const items = [];
  const push = (kind, row, extra = {}) => {
    const days = row.date ? daysBetween(today, row.date) : null;
    items.push({
      kind, user_id: row.user_id, nama: row.nama, nrp: row.nrp, jabatan: row.jabatan, departemen: row.departemen,
      date: row.date, days, severity: days == null ? 'SOON' : severity(days), ...extra,
    });
  };
  contracts.rows.forEach(r => push('CONTRACT_END', r, { employment_type: r.employment_type, action: 'CONTRACT_RENEWAL' }));
  probation.rows.forEach(r => push('PROBATION_END', r, { action: 'CONFIRMATION' }));
  docs.rows.forEach(r => push('DOCUMENT_EXPIRY', r, { document_id: r.document_id, title: r.title, doc_type: r.doc_type, action: 'UPLOAD_DOCUMENT' }));
  notice.rows.forEach(r => push('NOTICE', r, { movement_type: r.movement_type, open_tasks: r.open_tasks, action: 'OFFBOARDING' }));
  const order = { OVERDUE: 0, URGENT: 1, SOON: 2 };
  items.sort((a, b) => (order[a.severity] - order[b.severity]) || ((a.days ?? 999) - (b.days ?? 999)));
  const count = kind => items.filter(i => i.kind === kind).length;
  return {
    today,
    counts: {
      total: items.length,
      contract: count('CONTRACT_END'), probation: count('PROBATION_END'),
      document: count('DOCUMENT_EXPIRY'), notice: count('NOTICE'),
      pending_approval: pending.rows[0].n,
      urgent: items.filter(i => i.severity !== 'SOON').length,
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------
async function tableExists(db, name) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return rows[0].ok;
}

const HANDLERS = {
  /** Karyawan keluar: hapus roster harian setelah hari kerja terakhir, tutup penugasan roster. */
  async EMPLOYEE_EXITED(db, event) {
    const { user_id: userId, last_working_day: lastDay } = event.payload || {};
    if (!userId || !lastDay) return { skipped: 'payload tidak lengkap' };
    let rosterDays = 0;
    let rosterAssignments = 0;
    if (await tableExists(db, 'employee_roster_daily')) {
      const r = await db.query(`DELETE FROM employee_roster_daily WHERE user_id = $1 AND tanggal > $2::date`, [userId, lastDay]);
      rosterDays = r.rowCount || 0;
    }
    if (await tableExists(db, 'employee_roster_assignments')) {
      const closed = await db.query(`UPDATE employee_roster_assignments SET effective_to = $2::date, updated_at = now()
        WHERE user_id = $1 AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to > $2::date)`, [userId, lastDay]);
      const future = await db.query(`UPDATE employee_roster_assignments SET is_active = FALSE, updated_at = now()
        WHERE user_id = $1 AND effective_from > $2::date AND is_active`, [userId, lastDay]);
      rosterAssignments = (closed.rowCount || 0) + (future.rowCount || 0);
    }
    return { roster_days_removed: rosterDays, roster_assignments_closed: rosterAssignments };
  },
};

/** Proses event outbox yang belum selesai. Event tanpa handler ditandai selesai. */
async function processOutbox(pool, opts = {}) {
  const limit = opts.limit || 200;
  const { rows } = await pool.query(`SELECT * FROM people_outbox
    WHERE processed_at IS NULL AND attempts < 10 ORDER BY created_at LIMIT $1`, [limit]);
  const results = [];
  for (const event of rows) {
    const handler = HANDLERS[event.event_type];
    try {
      const outcome = handler ? await handler(pool, event) : { skipped: 'tidak ada handler' };
      await pool.query(`UPDATE people_outbox SET processed_at = CURRENT_TIMESTAMP, attempts = attempts + 1, last_error = NULL
        WHERE id = $1`, [event.id]);
      results.push({ id: event.id, event_type: event.event_type, status: 'DONE', ...outcome });
    } catch (error) {
      await pool.query(`UPDATE people_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
        [event.id, String(error.message || error).slice(0, 500)]);
      results.push({ id: event.id, event_type: event.event_type, status: 'ERROR', error: error.message });
    }
  }
  return results;
}

/** Proses harian: pergerakan jatuh tempo lalu outbox. */
async function runDaily(pool, opts = {}) {
  const today = opts.today || Workforce.todayWib();
  const movements = await Workforce.processDueMovements(pool, today, { today });
  const outbox = await processOutbox(pool, opts);
  return {
    today,
    movements: { processed: movements.length, failed: movements.filter(r => r.status === 'ERROR').length, results: movements },
    outbox: { processed: outbox.length, failed: outbox.filter(r => r.status === 'ERROR').length, results: outbox },
  };
}

module.exports = { getReminders, processOutbox, runDaily, HANDLERS };
