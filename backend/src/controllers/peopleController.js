'use strict';

/**
 * HTTP untuk OMOS People v2 (/api/admin/karyawan/people/...).
 * Semua aturan bisnis ada di services/people*; controller hanya menerjemahkan
 * request ↔ layanan dan mencatat IP untuk log akses dokumen.
 */

const { pool } = require('../config/db');
const Workforce = require('../services/workforce');
const Org = require('../services/peopleOrg');
const People = require('../services/peopleEmployees');
const Docs = require('../services/peopleDocuments');
const Daily = require('../services/peopleDaily');
const Import = require('../services/peopleImport');
const Movements = require('../services/peopleMovements');
const { kirimEmailUndangan } = require('../services/email');
const { hapusSubjectWajah } = require('../services/compreface');

function scopeOf(req) {
  return Workforce.scopeFromUser(req.user);
}

function ipOf(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null;
}

function idList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : String(value).split(',')).map(v => String(v).trim()).filter(Boolean);
}

/** Bungkus handler: error bisnis (4xx) dikirim dengan pesan + kode; 5xx ke handler pusat. */
function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = Number(err.statusCode || 0);
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: err.message, code: err.code || undefined });
      }
      // Pelanggaran unik dari DB yang lolos validasi (balapan dua admin).
      if (err.code === '23505') return res.status(409).json({ error: 'Data yang sama sudah ada. Muat ulang lalu coba lagi.' });
      return next(err);
    }
  };
}

function requireSuperAdmin(req) {
  if (!req.user?.is_super_admin) {
    throw Org.httpError('Hanya Admin Utama yang boleh mengubah pengaturan ini.', 403, 'SUPER_ADMIN_ONLY');
  }
}

async function sendInvites(invites) {
  const sent = [];
  const failed = [];
  for (const inv of invites || []) {
    try {
      await kirimEmailUndangan(inv.email, inv.nama, inv.token, { nrp: inv.nrp });
      sent.push(inv.email);
    } catch (err) {
      console.warn(`[People] Gagal kirim undangan ke ${inv.email}: ${err.message}`);
      failed.push(inv.email);
    }
  }
  return { sent: sent.length, failed };
}

// --------------------------------------------------------------------------- Master & pengaturan
const getOrg = handle(async (req, res) => {
  res.json(await Org.listOrg(pool, scopeOf(req), { includeInactive: req.query.include_inactive !== 'false' }));
});
const createDepartment = handle(async (req, res) => {
  res.status(201).json(await Org.createDepartment(pool, scopeOf(req), req.user, req.body || {}));
});
const updateDepartment = handle(async (req, res) => {
  res.json(await Org.updateDepartment(pool, scopeOf(req), req.user, req.params.id, req.body || {}));
});
const createPosition = handle(async (req, res) => {
  res.status(201).json(await Org.createPosition(pool, scopeOf(req), req.user, req.body || {}));
});
const updatePosition = handle(async (req, res) => {
  res.json(await Org.updatePosition(pool, scopeOf(req), req.user, req.params.id, req.body || {}));
});
const getSettings = handle(async (req, res) => {
  res.json(await People.getSettings(pool, scopeOf(req)));
});
const updateSettings = handle(async (req, res) => {
  requireSuperAdmin(req);
  res.json(await People.updateSettings(pool, scopeOf(req), req.user, req.body || {}));
});

/** Pilihan form: lokasi absen, shift, calon atasan. */
const getOptions = handle(async (req, res) => {
  const [lokasi, shifts, supervisors] = await Promise.all([
    pool.query(`SELECT id, nama_lokasi, radius_meter FROM lokasi_kantor ORDER BY lower(nama_lokasi)`),
    pool.query(`SELECT id, nama_shift FROM shifts ORDER BY nama_shift`).catch(() => ({ rows: [] })),
    pool.query(`SELECT u.id, u.nama, u.jabatan, u.departemen FROM users u
      LEFT JOIN workforce_employee_profiles p ON p.user_id = u.id
      WHERE u.role = 'karyawan' AND u.is_active AND p.voided_at IS NULL ORDER BY lower(u.nama) LIMIT 2000`),
  ]);
  res.json({ lokasi: lokasi.rows, shifts: shifts.rows, supervisors: supervisors.rows });
});

// --------------------------------------------------------------------------- Direktori & pengingat
const getDirectory = handle(async (req, res) => {
  res.json(await People.getDirectory(pool, scopeOf(req), {
    status: req.query.status, q: req.query.q,
    department_ids: idList(req.query.department_ids), position_ids: idList(req.query.position_ids),
  }));
});
const getMovements = handle(async (req, res) => {
  res.json(await Movements.listMovements(pool, scopeOf(req), {
    view: req.query.view, group: req.query.group, q: req.query.q, employee_id: req.query.employee_id,
    today: Workforce.todayWib(),
  }));
});
const getReminders = handle(async (req, res) => {
  res.json(await Daily.getReminders(pool, scopeOf(req)));
});

// --------------------------------------------------------------------------- Karyawan
const createEmployee = handle(async (req, res) => {
  const result = await People.createEmployee(pool, scopeOf(req), req.user, req.body || {}, { source: 'UI' });
  const invite = result.invite ? await sendInvites([result.invite]) : null;
  res.status(201).json({
    message: `Karyawan ${result.nrp} dibuat.${invite?.sent ? ' Undangan membuat password sudah dikirim ke email.' : ''}`,
    user_id: result.user_id, profile_id: result.profile_id, nrp: result.nrp, email: result.email,
    invite_sent: Boolean(invite?.sent), invite_failed: Boolean(invite?.failed?.length),
  });
});
const getProfile = handle(async (req, res) => {
  res.json(await People.getProfile(pool, scopeOf(req), req.params.id));
});
const updatePersonal = handle(async (req, res) => {
  res.json(await People.updatePersonal(pool, scopeOf(req), req.user, req.params.id, req.body || {}));
});
const revealNik = handle(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await People.revealNik(pool, scopeOf(req), req.user, req.params.id));
});
const setLocations = handle(async (req, res) => {
  res.json(await People.setAttendanceLocations(pool, scopeOf(req), req.user, req.params.id, req.body || {}));
});
const getFamily = handle(async (req, res) => {
  res.json(await People.getFamily(pool, scopeOf(req), req.params.id));
});
const saveFamily = handle(async (req, res) => {
  res.json(await People.saveFamily(pool, scopeOf(req), req.user, req.params.id, req.body || {}));
});
const voidEmployee = handle(async (req, res) => {
  const result = await People.voidEmployee(pool, scopeOf(req), req.user, req.params.id, req.body || {});
  if (result.compreface_subject) await hapusSubjectWajah(result.compreface_subject).catch(() => {});
  res.json({ message: 'Karyawan di-Void. Akun dinonaktifkan dan email bisa dipakai ulang.', ...result });
});

// --------------------------------------------------------------------------- Dokumen
const listDocuments = handle(async (req, res) => {
  res.json(await Docs.listDocuments(pool, scopeOf(req), req.params.id));
});
const uploadDocument = handle(async (req, res) => {
  const doc = await Docs.uploadDocument(pool, scopeOf(req), req.user, req.params.id, req.file, req.body || {}, { ip: ipOf(req) });
  res.status(201).json(doc);
});
const viewDocument = handle(async (req, res) => {
  const { doc, buffer } = await Docs.openDocument(pool, scopeOf(req), req.user, req.params.docId, { ip: ipOf(req) });
  Docs.sendPdf(res, doc, buffer);
});
const deleteDocument = handle(async (req, res) => {
  res.json(await Docs.deleteDocument(pool, scopeOf(req), req.user, req.params.docId, req.body || {}, { ip: ipOf(req) }));
});

// --------------------------------------------------------------------------- Import
const importTemplate = handle(async (req, res) => {
  const buffer = await Import.buildTemplate(pool, scopeOf(req));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="template_import_karyawan_${Workforce.todayWib()}.xlsx"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
});
const importPreview = handle(async (req, res) => {
  res.json(await Import.previewImport(pool, scopeOf(req), req.user, req.file));
});
const importMappings = handle(async (req, res) => {
  res.json(await Import.applyMappings(pool, scopeOf(req), req.user, req.params.batchId, req.body || {}));
});
const importCommit = handle(async (req, res) => {
  const sendInvites_ = req.body?.send_invites !== false;
  const result = await Import.commitImport(pool, scopeOf(req), req.user, req.params.batchId, { sendInvites: sendInvites_ });
  const invites = sendInvites_ ? await sendInvites(result.invites) : { sent: 0, failed: [] };
  const { invites: _omit, ...rest } = result;
  res.json({ ...rest, invites_sent: invites.sent, invites_failed: invites.failed.length });
});
const importCancel = handle(async (req, res) => {
  res.json(await Import.cancelImport(pool, scopeOf(req), req.user, req.params.batchId));
});
const importVoid = handle(async (req, res) => {
  res.json(await Import.voidImport(pool, scopeOf(req), req.user, req.params.batchId, req.body || {}));
});
const importBatches = handle(async (req, res) => {
  res.json(await Import.listBatches(pool, scopeOf(req), { limit: req.query.limit }));
});

module.exports = {
  handle,
  getOrg, createDepartment, updateDepartment, createPosition, updatePosition,
  getSettings, updateSettings, getOptions,
  getDirectory, getReminders, getMovements,
  createEmployee, getProfile, updatePersonal, revealNik, setLocations, getFamily, saveFamily, voidEmployee,
  listDocuments, uploadDocument, viewDocument, deleteDocument,
  importTemplate, importPreview, importMappings, importCommit, importCancel, importVoid, importBatches,
};
