'use strict';

/**
 * Daftar pergerakan untuk tab Pergerakan (People v2): dikelompokkan per
 * status kerja HR — bukan per periode — agar pengajuan lama yang belum
 * diputus tidak "hilang" karena tanggal efektifnya di luar bulan berjalan.
 */

const { EXIT_TYPES } = require('./workforce');

const VIEWS = {
  approval: ['SUBMITTED'],
  terjadwal: ['APPROVED'],
  draft: ['DRAFT'],
  riwayat: ['EFFECTIVE', 'CANCELLED', 'REJECTED'],
};
const GROUPS = {
  MASUK: ['HIRE', 'REHIRE'],
  STATUS: ['CONFIRMATION', 'CONTRACT_RENEWAL', 'EMPLOYMENT_TYPE_CHANGE'],
  PENEMPATAN: ['TRANSFER', 'PROMOTION', 'DEMOTION'],
  KELUAR: [...EXIT_TYPES],
};

function groupOf(type) {
  return Object.keys(GROUPS).find(g => GROUPS[g].includes(type)) || 'LAINNYA';
}

async function listMovements(db, scope, query = {}) {
  const view = VIEWS[query.view] ? query.view : 'approval';
  const params = [scope.tenantKey, scope.projectKey, VIEWS[view]];
  let filter = '';
  if (query.group && GROUPS[query.group]) {
    params.push(GROUPS[query.group]);
    filter += ` AND m.movement_type = ANY($${params.length})`;
  }
  if (query.q) {
    params.push(`%${String(query.q).trim()}%`);
    filter += ` AND (u.nama ILIKE $${params.length} OR u.employee_id ILIKE $${params.length} OR m.movement_no ILIKE $${params.length})`;
  }
  if (query.employee_id) {
    params.push(String(query.employee_id));
    filter += ` AND u.id::text = $${params.length}`;
  }
  const limit = view === 'riwayat' ? 200 : 500;
  const [rows, counts, month] = await Promise.all([
    db.query(`SELECT m.id, m.movement_no, m.movement_type, m.status, m.effective_date::text AS effective_date,
        m.last_working_day::text AS last_working_day, m.reason_text, m.notes, m.before_state, m.after_state,
        m.contract_end_date::text AS contract_end_date, m.evaluation_result, m.rehire_eligible,
        m.created_by, m.created_at, mk.nama AS created_by_name, ap.nama AS approved_by_name,
        u.id AS user_id, u.nama, u.employee_id AS nrp, p.employment_status,
        (SELECT COUNT(*)::int FROM workforce_movement_tasks t WHERE t.movement_id = m.id AND t.status IN ('DONE','WAIVED')) AS tasks_done,
        (SELECT COUNT(*)::int FROM workforce_movement_tasks t WHERE t.movement_id = m.id) AS tasks_total
      FROM workforce_employee_movements m
      JOIN workforce_employee_profiles p ON p.id = m.employee_profile_id
      JOIN users u ON u.id = p.user_id
      LEFT JOIN users mk ON mk.id = m.created_by
      LEFT JOIN users ap ON ap.id = m.approved_by
      WHERE m.tenant_key = $1 AND m.project_key = $2 AND m.status = ANY($3)${filter}
      ORDER BY ${view === 'riwayat' ? 'm.effective_date DESC, m.created_at DESC' : 'm.effective_date, m.created_at'}
      LIMIT ${limit}`, params),
    db.query(`SELECT status, COUNT(*)::int AS n FROM workforce_employee_movements
      WHERE tenant_key = $1 AND project_key = $2 AND status IN ('DRAFT','SUBMITTED','APPROVED') GROUP BY status`,
    [scope.tenantKey, scope.projectKey]),
    db.query(`SELECT
        COUNT(*) FILTER (WHERE movement_type = ANY($3))::int AS masuk,
        COUNT(*) FILTER (WHERE movement_type = ANY($4))::int AS keluar
      FROM workforce_employee_movements
      WHERE tenant_key = $1 AND project_key = $2 AND status = 'EFFECTIVE'
        AND date_trunc('month', effective_date) = date_trunc('month', $5::date)`,
    [scope.tenantKey, scope.projectKey, GROUPS.MASUK, GROUPS.KELUAR, query.today || new Date().toISOString().slice(0, 10)]),
  ]);
  const c = Object.fromEntries(counts.rows.map(r => [r.status, r.n]));
  return {
    view,
    counts: { approval: c.SUBMITTED || 0, terjadwal: c.APPROVED || 0, draft: c.DRAFT || 0,
      masuk_bulan_ini: month.rows[0].masuk, keluar_bulan_ini: month.rows[0].keluar },
    rows: rows.rows.map(r => ({ ...r, group: groupOf(r.movement_type) })),
  };
}

module.exports = { VIEWS, GROUPS, groupOf, listMovements };
