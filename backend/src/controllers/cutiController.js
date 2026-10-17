'use strict';

const { pool } = require('../config/db');
const Workforce = require('../services/workforce');
const Cuti = require('../services/cuti');

function scope(req) {
  return Workforce.scopeFromUser(req.user);
}

async function dashboard(req, res, next) {
  try {
    const rows = await Cuti.getDashboard(pool, scope(req), {
      year: req.query.year,
      department: req.query.department,
      position: req.query.position,
      status: req.query.status,
      search: req.query.search,
    });
    res.json({ year: Number(req.query.year) || new Date().getUTCFullYear(), rows });
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    res.json(await Cuti.getDetail(pool, scope(req), req.query.user_id, year));
  } catch (error) { next(error); }
}

async function daftarKebijakan(req, res, next) {
  try {
    res.json({ rows: await Cuti.listPolicies(pool, scope(req), req.query.active === '1') });
  } catch (error) { next(error); }
}

async function daftarLingkupKebijakan(req, res, next) {
  try {
    res.json({ rows: await Cuti.listPolicyScopes(pool, scope(req)) });
  } catch (error) { next(error); }
}

async function buatKebijakan(req, res, next) {
  try {
    const policy = await Cuti.createPolicyVersion(pool, scope(req), req.user, req.body);
    res.status(201).json({ message: `Kebijakan ${policy.leave_type} v${policy.version_no} tersimpan.`, policy });
  } catch (error) { next(error); }
}

async function ubahStatusKebijakan(req, res, next) {
  try {
    const policy = await Cuti.setPolicyActive(pool, scope(req), req.user,
      req.params.id, req.body.is_active !== false);
    res.json({ message: 'Status kebijakan diperbarui.', policy });
  } catch (error) { next(error); }
}

async function hapusKebijakan(req, res, next) {
  try {
    const result = await Cuti.deletePolicyVersion(pool, scope(req), req.user,
      req.params.id, req.body?.reason);
    res.json({
      message: result.deleted
        ? 'Kebijakan berhasil dihapus.'
        : `Kebijakan telah diarsipkan karena sudah dipakai oleh ${result.references} data historis.`,
      ...result,
    });
  } catch (error) { next(error); }
}

async function buatPengajuan(req, res, next) {
  try {
    const key = String(req.headers['idempotency-key'] || req.body.idempotency_key || '').trim() || null;
    const result = await Cuti.createRequest(pool, scope(req), req.user, { ...req.body, idempotency_key: key });
    res.status(result.deduped ? 200 : 201).json({
      message: result.deduped ? 'Pengajuan sudah tercatat (duplikat idempoten diabaikan).' : 'Pengajuan cuti tercatat sebagai draft.',
      request: result.request,
    });
  } catch (error) { next(error); }
}

async function opsiSiklus(req, res, next) {
  try {
    res.json(await Cuti.getCycleOptions(pool, scope(req), req.query.user_id,
      Number(req.query.year) || new Date().getUTCFullYear()));
  } catch (error) { next(error); }
}

async function buatPengajuanSiklus(req, res, next) {
  try {
    const key = String(req.headers['idempotency-key'] || req.body.idempotency_key || '').trim();
    const result = await Cuti.createCycleApplication(pool, scope(req), req.user,
      { ...req.body, idempotency_key: key });
    res.status(result.deduped ? 200 : 201).json({
      message: result.deduped ? 'Pengajuan siklus sudah tercatat.' : 'Pengajuan cuti tersimpan pada siklus terpilih.',
      ...result,
    });
  } catch (error) { next(error); }
}

async function ubahPengajuanSiklus(req, res, next) {
  try {
    const result = await Cuti.updateCycleApplication(pool, scope(req), req.user,
      req.params.id, req.body);
    res.json({
      message: 'Pengajuan cuti berhasil diperbarui.',
      ...result,
    });
  } catch (error) { next(error); }
}

async function hapusPengajuanSiklus(req, res, next) {
  try {
    const reason = String(req.body?.reason || req.query?.reason || 'Dihapus oleh user').trim();
    const result = await Cuti.deleteCycleApplication(pool, scope(req), req.user,
      req.params.id, reason);
    res.json({
      message: 'Pengajuan cuti berhasil dihapus.',
      ...result,
    });
  } catch (error) { next(error); }
}

async function transisiPengajuan(req, res, next) {
  try {
    const result = await Cuti.transitionRequest(pool, scope(req), req.user,
      req.params.id, req.body.target, req.body.reason, req.body);
    res.json({
      message: `Pengajuan ${result.request.status}.`
        + (result.request.status === 'APPROVED' ? ' Jadwal CP resmi ditulis; belum dihitung sebagai Aktual.' : '')
        + (result.realisation ? ' Realisasi dikonfirmasi dan Aktual diperbarui.' : ''),
      request: result.request, realisation: result.realisation, roster: result.roster,
    });
  } catch (error) { next(error); }
}

async function koreksiRealisasi(req, res, next) {
  try {
    const result = await Cuti.correctRealisation(pool, scope(req), req.user, req.params.id, req.body);
    res.json({ message: 'Realisasi dikoreksi dan CP roster diselaraskan.', ...result });
  } catch (error) { next(error); }
}

async function batalRealisasi(req, res, next) {
  try {
    const result = await Cuti.cancelRealisation(pool, scope(req), req.user, req.params.id, req.body.reason);
    res.json({ message: `Realisasi dibatalkan (${result.roster_removed} hari CP dihapus).`, ...result });
  } catch (error) { next(error); }
}

async function kalender(req, res, next) {
  try {
    res.json(await Cuti.getCalendar(pool, scope(req), { month: req.query.month }));
  } catch (error) { next(error); }
}

async function jalankanRekonsiliasi(req, res, next) {
  try {
    const summary = await Cuti.runReconciliation(pool, scope(req), { from: req.body.from, to: req.body.to });
    res.json({ message: `Rekonsiliasi selesai: ${summary.matched} cocok, ${summary.mismatch} beda, ${summary.overridden} override.`, ...summary });
  } catch (error) { next(error); }
}

async function daftarRekonsiliasi(req, res, next) {
  try {
    const { rows } = await pool.query(`SELECT rc.*, u.nama, u.departemen
      FROM leave_roster_reconciliation rc JOIN users u ON u.id = rc.user_id
      WHERE rc.tenant_key = $1 AND rc.project_key = $2 AND rc.state IN ('MISMATCH','OVERRIDDEN')
      ORDER BY rc.tanggal DESC LIMIT 500`,
    [scope(req).tenantKey, scope(req).projectKey]);
    res.json({ rows });
  } catch (error) { next(error); }
}

async function exportCsv(req, res, next) {
  try {
    const rows = await Cuti.getDashboard(pool, scope(req), { year: req.query.year });
    const header = 'Nama;NIK;Jabatan;Departemen;Kebijakan;Hak Periode;Aktual;Sisa;Sisa Tahunan;Proyeksi;Status';
    const lines = rows.map(row => [row.nama, row.employee_id || '', row.jabatan || '', row.departemen || '',
      row.policy_version_id ? `${Number(row.policy_work_days || 0) / 7}:${Number(row.policy_leave_days || 0) / 7} minggu` : '',
      row.hak_periode, row.aktual, row.sisa, row.sisa_tahunan,
      row.next_leave_start || '', row.status].map(value => String(value ?? '').replace(/;/g, ',')).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cuti-${req.query.year || new Date().getUTCFullYear()}.csv"`);
    res.send(`\ufeff${header}\r\n${lines.join('\r\n')}`);
  } catch (error) { next(error); }
}

module.exports = {
  dashboard, detail, daftarKebijakan, daftarLingkupKebijakan, buatKebijakan, ubahStatusKebijakan,
  hapusKebijakan,
  buatPengajuan, opsiSiklus, buatPengajuanSiklus, ubahPengajuanSiklus, hapusPengajuanSiklus, transisiPengajuan, koreksiRealisasi, batalRealisasi,
  kalender, jalankanRekonsiliasi, daftarRekonsiliasi, exportCsv,
};
