const { pool } = require('../config/db');
const { validateDateRange } = require('../services/hmDaily');
const { classifyHmWorklog, getHmCutover } = require('../services/hmWorklog');
const xlsx = require('xlsx');

function todayJakarta() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function fetchWorklogs(start, end, db = pool) {
  const { rows } = await db.query(`
    SELECT mpl.id, mpl.tanggal::text AS tanggal, mpl.shift_id, s.nama_shift,
           mpl.operator_id, u.employee_id, u.nama AS nama_operator, u.jabatan,
           mpl.equipment_id, e.kode_alat AS kode_unit, mpl.hm_start,
           mpl.hm_finish, mpl.total_hm, mpl.status, mpl.hm_anomaly_status,
           mpl.hm_anomaly_reason, mpl.hm_validated_at, mpl.updated_at,
           review.work_log_id, review.paid_hm AS review_paid_hm, review.reason AS review_reason,
           review.source_updated_at, review.reviewed_at, reviewer.nama AS reviewed_by_name
    FROM mining_production_logs mpl
    LEFT JOIN shifts s ON s.id = mpl.shift_id
    LEFT JOIN users u ON u.id = mpl.operator_id
    LEFT JOIN equipment e ON e.id = mpl.equipment_id
    LEFT JOIN hm_worklog_reviews review ON review.work_log_id = mpl.id
    LEFT JOIN users reviewer ON reviewer.id = review.reviewed_by
    WHERE mpl.tanggal BETWEEN $1::date AND $2::date AND mpl.deleted_at IS NULL
      AND mpl.operator_id IS NOT NULL
    ORDER BY mpl.tanggal, u.nama, e.kode_alat, s.nama_shift, mpl.id
    LIMIT 5001`, [start, end]);
  if (rows.length > 5000) {
    const error = new Error('Periode memiliki lebih dari 5000 Work Log. Pilih rentang tanggal yang lebih singkat.');
    error.statusCode = 422;
    throw error;
  }
  return rows.map((row) => ({ ...row, ...classifyHmWorklog(row) }));
}

async function listWorklogs(req, res, next) {
  try {
    const start = req.query.tanggal_mulai || todayJakarta();
    const end = req.query.tanggal_akhir || start;
    validateDateRange(start, end);
    const [rows, effectiveDate] = await Promise.all([fetchWorklogs(start, end), getHmCutover(pool)]);
    res.json({ tanggal_mulai: start, tanggal_akhir: end, effective_date: effectiveDate,
      rows: rows.map((row) => row.tanggal < effectiveDate
        ? { ...row, payroll_effective: false, payable_hm: null, hm_note: 'Payroll historis' }
        : { ...row, payroll_effective: true }) });
  } catch (error) { next(error); }
}

async function updateWorklogReview(req, res, next) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const paidHm = Number(req.body?.paid_hm);
    const reason = String(req.body?.reason || '').trim();
    if (!Number.isFinite(paidHm) || paidHm < 0 || paidHm > 24 || Math.abs(Math.round(paidHm * 100) - paidHm * 100) > 1e-8) {
      return res.status(400).json({ error: 'HM dibayar harus 0–24 jam dengan maksimal dua angka desimal.' });
    }
    if (reason.length < 5) return res.status(400).json({ error: 'Alasan penyesuaian minimal 5 karakter.' });
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(req.params.id))) {
      return res.status(400).json({ error: 'ID Work Log tidak valid.' });
    }
    await client.query('BEGIN');
    transactionStarted = true;
    const { rows: sourceRows } = await client.query(`
      SELECT id, tanggal::text AS tanggal, operator_id, equipment_id, total_hm, status,
             hm_anomaly_status, hm_validated_at, updated_at
      FROM mining_production_logs WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [req.params.id]);
    const source = sourceRows[0];
    if (!source) { await client.query('ROLLBACK'); transactionStarted = false; return res.status(404).json({ error: 'Work Log tidak ditemukan.' }); }
    const cutover = await getHmCutover(client);
    if (source.tanggal < cutover) {
      await client.query('ROLLBACK'); transactionStarted = false;
      return res.status(409).json({ error: 'Periode historis masih memakai HM payroll lama; koreksi Work Log untuk periode ini belum diaktifkan.' });
    }
    if (!source.operator_id || source.total_hm === null || !Number.isFinite(Number(source.total_hm)) || Number(source.total_hm) < 0) {
      await client.query('ROLLBACK'); transactionStarted = false;
      return res.status(409).json({ error: 'Work Log belum memiliki operator atau total HM yang valid.' });
    }
    const { rows: previousRows } = await client.query(
      'SELECT paid_hm, reason, source_updated_at, reviewed_by, reviewed_at FROM hm_worklog_reviews WHERE work_log_id = $1',
      [source.id]);
    const previous = previousRows[0] || null;
    if (previous && Number(previous.paid_hm) === paidHm && previous.reason === reason &&
        new Date(previous.source_updated_at).getTime() === new Date(source.updated_at).getTime()) {
      await client.query('COMMIT'); transactionStarted = false;
      return res.json({ message: 'Koreksi HM sudah tersimpan.', unchanged: true });
    }
    const { rows: saved } = await client.query(`
      INSERT INTO hm_worklog_reviews (work_log_id, paid_hm, reason, source_updated_at, reviewed_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (work_log_id) DO UPDATE SET paid_hm = EXCLUDED.paid_hm,
        reason = EXCLUDED.reason, source_updated_at = EXCLUDED.source_updated_at,
        reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now(), updated_at = now()
      RETURNING *`, [source.id, paidHm, reason, source.updated_at, req.user.id]);
    await client.query(`INSERT INTO hm_worklog_review_audit
      (work_log_id, previous_value, new_value, changed_by) VALUES ($1, $2::jsonb, $3::jsonb, $4)`,
      [source.id, JSON.stringify(previous), JSON.stringify({ ...saved[0], source }), req.user.id]);
    await client.query('COMMIT'); transactionStarted = false;
    res.json({ message: 'Koreksi HM dibayar berhasil disimpan.', data: saved[0] });
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
}

async function getWorklogReviewHistory(req, res, next) {
  try {
    const { rows } = await pool.query(`
      SELECT audit.previous_value, audit.new_value, audit.changed_at, u.nama AS changed_by_name
      FROM hm_worklog_review_audit audit LEFT JOIN users u ON u.id = audit.changed_by
      WHERE audit.work_log_id = $1 ORDER BY audit.changed_at DESC LIMIT 100`, [req.params.id]);
    res.json({ rows });
  } catch (error) { next(error); }
}

async function exportWorklogs(req, res, next) {
  try {
    const start = req.query.tanggal_mulai || todayJakarta();
    const end = req.query.tanggal_akhir || start;
    validateDateRange(start, end);
    const rows = await fetchWorklogs(start, end);
    const effectiveDate = await getHmCutover(pool);
    const records = rows.map((row) => ({
      Tanggal: row.tanggal, Shift: row.nama_shift || '', 'Employee ID': row.employee_id || '',
      Operator: row.nama_operator || '', 'Kode Unit': row.kode_unit || '',
      'HM Awal': Number(row.hm_start), 'HM Akhir': Number(row.hm_finish),
      'HM Sumber': Number(row.total_hm),
      'HM Dibayar': row.tanggal < effectiveDate || row.payable_hm === null ? '' : Number(row.payable_hm),
      Keterangan: row.tanggal < effectiveDate ? 'Payroll historis' : row.hm_note,
      'Alasan Koreksi': row.tanggal < effectiveDate || !row.hm_adjusted ? '' : (row.review_reason || ''),
      'ID Work Log': row.id, 'Versi Sumber': new Date(row.updated_at).toISOString(),
    }));
    const workbook = xlsx.utils.book_new();
    const sheet = xlsx.utils.json_to_sheet(records.length ? records : [{ Keterangan: 'Tidak ada Work Log pada periode ini.' }]);
    sheet['!cols'] = [13, 18, 16, 27, 16, 13, 13, 13, 13, 18, 42, 38, 27].map((w) => ({ wch: w }));
    xlsx.utils.book_append_sheet(workbook, sheet, 'Database HM');
    const file = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Database_HM_${start}_${end}.xlsx"`);
    res.send(file);
  } catch (error) { next(error); }
}

async function importWorklogReviews(req, res, next) {
  if (!req.file?.buffer) return res.status(400).json({ error: 'Pilih berkas Excel hasil Export Database HM.' });
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: false });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    if (!rows.length || rows.length > 500) return res.status(400).json({ error: 'Import membutuhkan 1–500 baris.' });
    const correctionReason = (row) => String(row['Alasan Koreksi'] || row['Alasan Verifikasi'] || '').trim();
    const missingReason = rows.some((row) => !correctionReason(row) &&
      row['HM Dibayar'] !== '' && Number(row['HM Dibayar']) !== Number(row['HM Sumber']));
    if (missingReason) return res.status(400).json({ error: 'HM Dibayar yang berubah wajib memiliki Alasan Koreksi.' });
    const changes = rows.filter((row) => correctionReason(row).length > 0);
    if (!changes.length) return res.status(400).json({ error: 'Isi kolom Alasan Koreksi pada baris yang ingin diubah.' });
    const ids = changes.map((row) => String(row['ID Work Log'] || '').trim());
    if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'ID Work Log kosong, tidak valid, atau duplikat.' });
    }
    await client.query('BEGIN'); transactionStarted = true;
    const cutover = await getHmCutover(client);
    let savedCount = 0;
    for (const row of changes) {
      const id = String(row['ID Work Log']).trim();
      const reason = correctionReason(row);
      const paidHm = Number(row['HM Dibayar']);
      if (reason.length < 5 || !Number.isFinite(paidHm) || paidHm < 0 || paidHm > 24 ||
          Math.abs(Math.round(paidHm * 100) - paidHm * 100) > 1e-8 || !row['Versi Sumber']) {
        const error = new Error(`Nilai HM, alasan, atau versi sumber tidak valid untuk Work Log ${id}.`);
        error.statusCode = 400; throw error;
      }
      const { rows: sourceRows } = await client.query(`SELECT id, tanggal::text AS tanggal, operator_id, status, hm_validated_at,
        hm_anomaly_status, total_hm, updated_at FROM mining_production_logs
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      const source = sourceRows[0];
      if (source && source.tanggal < cutover) {
        const error = new Error(`Work Log ${id} berada sebelum tanggal efektif Database HM.`); error.statusCode = 409; throw error;
      }
      if (!source || !source.operator_id || source.total_hm === null ||
          !Number.isFinite(Number(source.total_hm)) || Number(source.total_hm) < 0) {
        const error = new Error(`Work Log ${id} belum memiliki operator atau total HM yang valid.`); error.statusCode = 409; throw error;
      }
      if (new Date(row['Versi Sumber']).getTime() !== new Date(source.updated_at).getTime()) {
        const error = new Error(`Work Log ${id} berubah setelah Excel diekspor. Unduh ulang data.`);
        error.statusCode = 409; throw error;
      }
      const { rows: previousRows } = await client.query(
        'SELECT paid_hm, reason, source_updated_at, reviewed_by, reviewed_at FROM hm_worklog_reviews WHERE work_log_id = $1', [id]);
      const previous = previousRows[0] || null;
      if (previous && Number(previous.paid_hm) === paidHm && previous.reason === reason &&
          new Date(previous.source_updated_at).getTime() === new Date(source.updated_at).getTime()) continue;
      const { rows: saved } = await client.query(`INSERT INTO hm_worklog_reviews
        (work_log_id, paid_hm, reason, source_updated_at, reviewed_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (work_log_id) DO UPDATE SET paid_hm = EXCLUDED.paid_hm,
          reason = EXCLUDED.reason, source_updated_at = EXCLUDED.source_updated_at,
          reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now(), updated_at = now()
        RETURNING *`, [id, paidHm, reason, source.updated_at, req.user.id]);
      await client.query(`INSERT INTO hm_worklog_review_audit
        (work_log_id, previous_value, new_value, changed_by) VALUES ($1,$2::jsonb,$3::jsonb,$4)`,
        [id, JSON.stringify(previous), JSON.stringify({ ...saved[0], source }), req.user.id]);
      savedCount += 1;
    }
    await client.query('COMMIT'); transactionStarted = false;
    res.json({ message: `${savedCount} koreksi HM berhasil disimpan dari Excel.`, count: savedCount });
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
}

module.exports = { fetchWorklogs, listWorklogs, updateWorklogReview, getWorklogReviewHistory, exportWorklogs, importWorklogReviews };
