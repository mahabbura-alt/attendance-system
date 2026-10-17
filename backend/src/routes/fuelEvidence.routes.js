'use strict';

/**
 * Bukti foto/dokumen Fuel — dipakai APK OMOS Fuel (izin fuel.operator) dan dashboard (admin).
 * File hanya dilayani lewat endpoint ini (terautentikasi), tidak lewat /api/storage/view.
 */
const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { evidenceUpload } = require('../middleware/upload');
const evidence = require('../services/fuelEvidence');

const router = express.Router();
const { requireFuelMobile } = require('../services/fuelMobileAuth');

router.use(requireAuth);
const sesiApk = requireFuelMobile();
router.use((req, res, next) => {
  if (req.user?.token_scope === 'fuel_mobile') return sesiApk(req, res, next);
  if (!evidence.isFuelOperator(req.user)) {
    return res.status(403).json({ error: 'Tidak memiliki izin modul Fuel (fuel.operator).' });
  }
  next();
});

const handle = fn => async (req, res, next) => {
  try {
    const hasil = await fn(req, res);
    if (!res.headersSent) res.json(hasil);
  } catch (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return res.status(503).json({ error: 'Skema bukti Fuel belum tersedia. Jalankan migrasi 103.', code: 'MIGRATION_REQUIRED' });
    }
    const status = error.status || error.statusCode;
    if (status) return res.status(status).json({ error: error.message, code: error.code || null, details: error.details || null });
    next(error);
  }
};

function terimaFile(req, res, next) {
  evidenceUpload.single('file')(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const pesan = error.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file maksimal 15 MB.' : 'Upload file tidak valid.';
      return res.status(400).json({ error: pesan, code: error.code });
    }
    return next(error);
  });
}

const metaDari = (body = {}) => ({
  client_uuid: body.client_uuid, slot_code: body.slot_code, client_sha256: body.client_sha256,
  captured_at: body.captured_at, gps_lat: body.gps_lat, gps_lng: body.gps_lng,
  device_id: body.device_id, app_version: body.app_version, upload_source: body.upload_source,
  reason: body.reason,
});

router.get('/slots', handle(req => evidence.getSlots({
  kind: req.query.kind || null,
  version: req.query.version == null ? null : Number(req.query.version),
})));

router.put('/slots/:kind', requireAdmin, handle(req => evidence.saveSlots(req.params.kind, req.body?.slots, req.user.id)));

router.post('/attachments', terimaFile, handle(async (req, res) => {
  const row = await evidence.uploadAttachment(req.file?.buffer, metaDari(req.body), req.user);
  res.status(row.idempotent_replay ? 200 : 201).json(row);
}));

router.post('/link', requireAdmin, handle(req => evidence.linkToExisting({
  entityType: req.body?.entity_type, entityId: req.body?.entity_id, attachmentIds: req.body?.attachment_ids,
}, req.user)));

router.get('/summary', handle(req => evidence.summarize({
  entityType: req.query.entity_type, ids: req.query.ids,
}, req.user)));

router.get('/attachments', handle(req => evidence.listAttachments({
  entityType: req.query.entity_type, entityId: req.query.entity_id,
  includeInactive: req.query.include_inactive === '1' || req.query.include_inactive === 'true',
}, req.user)));

router.get('/attachments/:id', handle(req => evidence.getAttachment(req.params.id, req.user)
  .then(({ storage_key, thumbnail_key, ...row }) => row)));

router.get('/attachments/:id/file', handle(async (req, res) => {
  const { buffer, mime, row } = await evidence.readAttachmentFile(req.params.id, req.query.variant, req.user);
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${row.id}${mime === 'application/pdf' ? '.pdf' : ''}"`);
  res.send(buffer);
}));

router.post('/attachments/:id/replace', terimaFile, handle(async (req, res) => {
  const row = await evidence.replaceAttachment(req.params.id, req.file?.buffer, metaDari(req.body), req.user);
  const { storage_key, thumbnail_key, ...aman } = row;
  res.status(201).json(aman);
}));

module.exports = router;
