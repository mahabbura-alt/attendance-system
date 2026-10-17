'use strict';

/**
 * OMOS People — dokumen karyawan (CV, sertifikat kompetensi, KTP, kontrak,
 * MCU, lainnya). Hanya PDF ≤ 5 MB; isi file dicek (%PDF), bukan hanya
 * ekstensi/MIME dari browser. Disimpan di bucket privat terpisah dan dibuka
 * hanya lewat endpoint ber-login; setiap unggah/lihat/hapus dicatat.
 */

const crypto = require('crypto');
const People = require('./peopleEmployees');
const { httpError, withTransaction } = require('./peopleOrg');

const MAX_BYTES = 5 * 1024 * 1024;
const DOC_TYPES = {
  CV: 'CV',
  COMPETENCY: 'Sertifikat kompetensi',
  KTP: 'KTP',
  CONTRACT: 'Kontrak kerja',
  MCU: 'Hasil MCU',
  OTHER: 'Lainnya',
};

function defaultStorage() {
  // eslint-disable-next-line global-require
  return require('./storage');
}

function isPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

function safeFilename(name) {
  const base = String(name || 'dokumen.pdf').split(/[\\/]/).pop().replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  return /\.pdf$/i.test(base) ? base : `${base || 'dokumen'}.pdf`;
}

function validateFile(file) {
  if (!file || !file.buffer || !file.buffer.length) throw httpError('Pilih file PDF untuk diunggah.');
  if (file.buffer.length > MAX_BYTES) throw httpError('Ukuran file maksimal 5 MB.', 413, 'DOCUMENT_TOO_LARGE');
  if (!isPdf(file.buffer)) throw httpError('File harus berformat PDF.', 415, 'DOCUMENT_NOT_PDF');
}

async function logAccess(db, documentId, action, actorId, ip) {
  await db.query(`INSERT INTO employee_document_access_log (document_id, action, actor_id, ip_address)
    VALUES ($1, $2, $3, $4)`, [documentId, action, actorId || null, ip || null]);
}

async function listDocuments(db, scope, userId) {
  const { profileId } = await People.profileFor(db, scope, userId);
  const { rows } = await db.query(`SELECT d.id, d.doc_type, d.title, d.doc_number,
      d.issued_date::text AS issued_date, d.expiry_date::text AS expiry_date,
      d.original_filename, d.size_bytes, d.uploaded_at, u.nama AS uploaded_by_name
    FROM employee_documents d LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.employee_profile_id = $1 AND d.tenant_key = $2 AND d.deleted_at IS NULL
    ORDER BY CASE d.doc_type WHEN 'CV' THEN 0 WHEN 'COMPETENCY' THEN 1 ELSE 2 END, d.uploaded_at DESC`,
  [profileId, scope.tenantKey]);
  return rows;
}

/**
 * Unggah dokumen. CV bersifat tunggal: CV lama dinonaktifkan (soft delete)
 * dalam transaksi yang sama sehingga selalu ada tepat satu CV aktif.
 */
async function uploadDocument(db, scope, user, userId, file, meta = {}, opts = {}) {
  const storage = opts.storage || defaultStorage();
  const docType = String(meta.doc_type || '').trim().toUpperCase();
  if (!DOC_TYPES[docType]) throw httpError('Jenis dokumen tidak dikenal.');
  validateFile(file);
  const title = People.clean(meta.title) || (docType === 'CV' ? 'Curriculum Vitae' : null);
  if (!title) throw httpError('Nama dokumen wajib diisi.');
  const issued = People.optionalDate(meta.issued_date, 'Tanggal terbit');
  const expiry = People.optionalDate(meta.expiry_date, 'Berlaku sampai');
  if (issued && expiry && expiry < issued) throw httpError('Tanggal berlaku sampai tidak boleh sebelum tanggal terbit.');

  const { profileId } = await People.profileFor(db, scope, userId);
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const dup = await db.query(`SELECT id, title FROM employee_documents
    WHERE employee_profile_id = $1 AND sha256 = $2 AND deleted_at IS NULL LIMIT 1`, [profileId, sha256]);
  if (dup.rows[0]) throw httpError(`File yang sama sudah diunggah sebagai "${dup.rows[0].title}".`, 409, 'DOCUMENT_DUPLICATE');

  // Simpan file dulu; bila transaksi DB gagal, file dihapus lagi.
  const storageKey = await storage.uploadDocument(file.buffer, { profileId, docType });
  try {
    return await withTransaction(db, async (client) => {
      let replaced = null;
      if (docType === 'CV') {
        const old = await client.query(`UPDATE employee_documents
          SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $2, delete_reason = 'Diganti CV baru'
          WHERE employee_profile_id = $1 AND doc_type = 'CV' AND deleted_at IS NULL
          RETURNING id, original_filename`, [profileId, user.id]);
        replaced = old.rows[0] || null;
        if (replaced) await logAccess(client, replaced.id, 'DELETE', user.id, opts.ip);
      }
      const { rows } = await client.query(`INSERT INTO employee_documents
        (tenant_key, employee_profile_id, doc_type, title, doc_number, issued_date, expiry_date,
         storage_key, original_filename, size_bytes, sha256, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, doc_type, title, doc_number, issued_date::text AS issued_date, expiry_date::text AS expiry_date,
          original_filename, size_bytes, uploaded_at`,
      [scope.tenantKey, profileId, docType, title, People.clean(meta.doc_number), issued, expiry,
        storageKey, safeFilename(file.originalname), file.buffer.length, sha256, user.id]);
      const doc = rows[0];
      await logAccess(client, doc.id, 'UPLOAD', user.id, opts.ip);
      await People.fieldAudit(client, scope, profileId, 'DOCUMENT', docType,
        replaced ? replaced.original_filename : null, `${doc.title} (${doc.original_filename})`, null, user.id);
      return { ...doc, replaced_id: replaced ? replaced.id : null };
    });
  } catch (err) {
    await Promise.resolve(storage.removeDocument(storageKey)).catch(() => {});
    throw err;
  }
}

async function findDocument(db, scope, documentId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(documentId || ''))) throw httpError('Dokumen tidak ditemukan.', 404);
  const { rows } = await db.query(`SELECT d.*, p.user_id FROM employee_documents d
    JOIN workforce_employee_profiles p ON p.id = d.employee_profile_id
    WHERE d.id = $1 AND d.tenant_key = $2`, [documentId, scope.tenantKey]);
  if (!rows[0] || rows[0].deleted_at) throw httpError('Dokumen tidak ditemukan.', 404);
  return rows[0];
}

/** Buka dokumen: kembalikan buffer + metadata, dan catat siapa yang melihat. */
async function openDocument(db, scope, user, documentId, opts = {}) {
  const storage = opts.storage || defaultStorage();
  const doc = await findDocument(db, scope, documentId);
  const buffer = await storage.readDocument(doc.storage_key);
  if (!buffer || !isPdf(buffer)) throw httpError('File dokumen tidak ditemukan di penyimpanan.', 404, 'DOCUMENT_FILE_MISSING');
  await logAccess(db, doc.id, 'VIEW', user.id, opts.ip);
  return { doc, buffer };
}

/** Kirim PDF ke browser untuk ditampilkan langsung (inline), bukan diunduh. */
function sendPdf(res, doc, buffer) {
  const name = safeFilename(doc.original_filename);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `inline; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Tanpa 'sandbox': penampil PDF bawaan Chrome menolak dokumen ber-sandbox.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(buffer);
}

async function deleteDocument(db, scope, user, documentId, input = {}, opts = {}) {
  const reason = People.clean(input.reason);
  if (!reason || reason.length < 3) throw httpError('Alasan menghapus dokumen wajib diisi.');
  const doc = await findDocument(db, scope, documentId);
  return withTransaction(db, async (client) => {
    await client.query(`UPDATE employee_documents SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $2, delete_reason = $3
      WHERE id = $1 AND deleted_at IS NULL`, [doc.id, user.id, reason]);
    await logAccess(client, doc.id, 'DELETE', user.id, opts.ip);
    await People.fieldAudit(client, scope, doc.employee_profile_id, 'DOCUMENT', doc.doc_type,
      `${doc.title} (${doc.original_filename})`, null, reason, user.id);
    // File fisik disimpan (soft delete) agar jejak audit tetap bisa ditelusuri.
    return { id: doc.id, deleted: true };
  });
}

module.exports = {
  DOC_TYPES,
  MAX_BYTES,
  isPdf,
  safeFilename,
  listDocuments,
  uploadDocument,
  openDocument,
  sendPdf,
  deleteDocument,
};
