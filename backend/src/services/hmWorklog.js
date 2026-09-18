const PAYABLE_HM_SQL = `CASE
  WHEN review.work_log_id IS NOT NULL
       AND review.source_updated_at IS NOT DISTINCT FROM mpl.updated_at THEN review.paid_hm
  ELSE mpl.total_hm END`;

function classifyHmWorklog(log) {
  const sourceReady = Boolean(log.operator_id) && log.total_hm !== null && log.total_hm !== undefined
    && Number.isFinite(Number(log.total_hm)) && Number(log.total_hm) >= 0;
  const stale = Boolean(log.work_log_id && new Date(log.source_updated_at).getTime() !== new Date(log.updated_at).getTime());
  const adjusted = Boolean(log.work_log_id) && !stale;
  const payableHm = sourceReady ? adjusted ? Number(log.review_paid_hm) : Number(log.total_hm) : null;
  return {
    payable_hm: payableHm,
    hm_adjusted: adjusted,
    adjustment_stale: stale,
    hm_note: !sourceReady ? 'HM sumber belum lengkap'
      : payableHm > 10 ? 'HM Over, perlu verifikasi' : '',
  };
}

async function getHmCutover(db) {
  const { rows } = await db.query('SELECT effective_date::text AS effective_date FROM hm_worklog_cutover WHERE id = TRUE');
  if (!rows.length) throw new Error('Tanggal efektif Database HM belum tersedia; jalankan migrasi 040.');
  return rows[0].effective_date;
}

async function getHmPayableDailyRows(db, userId, startDate, endDate) {
  // Payroll period may exceed 31 days; the 31-day limit applies only to the UI.
  const cutover = await getHmCutover(db);
  const { rows } = await db.query(`
    SELECT tanggal, SUM(jam_operasi)::numeric AS jam_operasi,
           STRING_AGG(NULLIF(keterangan, ''), '; ') AS keterangan
    FROM (
      SELECT h.tanggal::text AS tanggal, h.jam_operasi,
             COALESCE(h.keterangan, '') AS keterangan
      FROM database_hm_harian h
      WHERE h.user_id = $1 AND h.tanggal BETWEEN $2::date AND $3::date
        AND h.tanggal < $4::date
      UNION ALL
      SELECT mpl.tanggal::text AS tanggal, ${PAYABLE_HM_SQL} AS jam_operasi,
             CASE WHEN review.work_log_id IS NOT NULL
                       AND review.source_updated_at IS NOT DISTINCT FROM mpl.updated_at
                  THEN 'Diubah admin: ' || review.reason ELSE '' END AS keterangan
      FROM mining_production_logs mpl
      LEFT JOIN hm_worklog_reviews review ON review.work_log_id = mpl.id
      WHERE mpl.operator_id = $1 AND mpl.tanggal BETWEEN $2::date AND $3::date
        AND mpl.tanggal >= $4::date AND mpl.deleted_at IS NULL
        AND mpl.total_hm IS NOT NULL AND mpl.total_hm >= 0
    ) payable
    GROUP BY tanggal ORDER BY tanggal`, [userId, startDate, endDate, cutover]);
  return rows;
}

async function getHmPayableSum(db, userId, startDate, endDate) {
  const rows = await getHmPayableDailyRows(db, userId, startDate, endDate);
  return rows.reduce((total, row) => total + Number(row.jam_operasi || 0), 0);
}

async function getHmPayrollSummary(db, userId, startDate, endDate) {
  const cutover = await getHmCutover(db);
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(source_hm), 0)::numeric AS source_hm,
           COALESCE(SUM(payable_hm), 0)::numeric AS payable_hm
    FROM (
      SELECT h.jam_operasi AS source_hm, h.jam_operasi AS payable_hm
      FROM database_hm_harian h
      WHERE h.user_id = $1 AND h.tanggal BETWEEN $2::date AND $3::date
        AND h.tanggal < $4::date
      UNION ALL
      SELECT mpl.total_hm AS source_hm,
             ${PAYABLE_HM_SQL} AS payable_hm
      FROM mining_production_logs mpl
      LEFT JOIN hm_worklog_reviews review ON review.work_log_id = mpl.id
      WHERE mpl.operator_id = $1 AND mpl.tanggal BETWEEN $2::date AND $3::date
        AND mpl.tanggal >= $4::date AND mpl.deleted_at IS NULL
        AND mpl.total_hm IS NOT NULL AND mpl.total_hm >= 0
    ) hm`, [userId, startDate, endDate, cutover]);
  return {
    source_hm: Number(rows[0]?.source_hm || 0),
    payable_hm: Number(rows[0]?.payable_hm || 0),
  };
}

module.exports = { PAYABLE_HM_SQL, classifyHmWorklog, getHmCutover, getHmPayableDailyRows, getHmPayableSum, getHmPayrollSummary };
