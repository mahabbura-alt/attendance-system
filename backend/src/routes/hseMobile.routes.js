'use strict';

/**
 * API OMOS Safety (APK HSE lapangan) — /api/hse/mobile
 * Semua identitas & hak akses diambil dari token + data server. Tulisan lewat POST /sync (idempoten per client_uuid).
 */

const path = require('path');
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const hseService = require('../services/hse');
const mobile = require('../services/hseMobile');
const { loadMobileRelease } = require('../services/mobileRelease');

const SAFETY_MANIFEST = process.env.SAFETY_RELEASE_MANIFEST || path.join(__dirname, '../public/safety-release.json');

const router = express.Router();

router.use(requireAuth);
router.use((req, res, next) => {
  req.hseScope = hseService.scopeFromUser(req.user);
  next();
});

const handle = fn => async (req, res, next) => {
  try {
    res.json(await fn(req));
  } catch (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return res.status(503).json({ error: 'Skema OMOS Safety belum tersedia. Jalankan migrasi 101.', code: 'MIGRATION_REQUIRED' });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message, code: error.details?.code || error.code || null });
    }
    next(error);
  }
};

router.get('/bootstrap', handle(req => mobile.getBootstrap(pool, req.hseScope, req.user.id)));
router.post('/sync', handle(req => mobile.syncItems(pool, req.hseScope, req.user.id, req.body?.items)));

router.get('/my-reports', handle(req => mobile.getMyReports(pool, req.hseScope, req.user.id)));
router.get('/hazards/:id', handle(req => mobile.getHazardDetailForMobile(pool, req.hseScope, req.user.id, req.params.id)));
router.get('/pic/actions', handle(req => mobile.getPicActions(pool, req.hseScope, req.user.id)));
router.get('/verify/queue', handle(req => mobile.getVerifyQueue(pool, req.hseScope, req.user.id)));
router.get('/delegator/inbox', handle(req => mobile.getDelegatorInbox(pool, req.hseScope, req.user.id)));
router.get('/inspections/schedules', handle(req => mobile.getMySchedules(pool, req.hseScope, req.user.id)));
router.get('/participants', handle(req => mobile.getEventParticipants(pool, req.hseScope, req.query.kind, req.query.date)));
router.get('/stats', handle(req => mobile.getMyStats(pool, req.hseScope, req.user.id, req.query.month)));

router.get('/notifications', handle(req => mobile.listNotifications(pool, req.hseScope, req.user.id, req.query.after_id, req.query.limit)));
router.post('/notifications/read', handle(req => mobile.markNotificationsRead(pool, req.hseScope, req.user.id, req.body || {})));

// Manifest rilis APK OMOS Safety (format & validasi sama dengan APK absensi: HTTPS + SHA-256).
router.get('/app-version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ available: true, ...loadMobileRelease(req, SAFETY_MANIFEST) });
  } catch (error) {
    res.json({ available: false });
  }
});

module.exports = router;
