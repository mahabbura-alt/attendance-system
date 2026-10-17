'use strict';

/**
 * API APK OMOS Fuel (`/api/fuel/mobile`). Login PIN + perangkat disetujui; semua endpoint
 * lain memakai token bercakupan fuel_mobile. Logika di services/fuelMobile & fuelMobileAuth.
 */
const express = require('express');
const path = require('node:path');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/security');
const { loadMobileRelease } = require('../services/mobileRelease');
const auth = require('../services/fuelMobileAuth');
const mobile = require('../services/fuelMobile');

const FUEL_MANIFEST = process.env.FUEL_RELEASE_MANIFEST || path.join(__dirname, '../public/fuel-release.json');

const router = express.Router();

const handle = fn => async (req, res, next) => {
  try {
    res.json(await fn(req));
  } catch (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return res.status(503).json({ error: 'Skema OMOS Fuel belum tersedia. Jalankan migrasi 104.', code: 'MIGRATION_REQUIRED' });
    }
    const status = error.status || error.statusCode;
    if (status) return res.status(status).json({ error: error.message, code: error.code || null, details: error.details || null });
    next(error);
  }
};

// Manifest rilis APK (format & validasi sama dengan APK absensi/Safety: HTTPS + SHA-256).
router.get('/app-version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ available: true, ...loadMobileRelease(req, FUEL_MANIFEST) });
  } catch (error) {
    res.json({ available: false });
  }
});

router.post('/login', createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.FUEL_LOGIN_RATE_LIMIT_MAX || 30),
  message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
}), handle(req => auth.login(req.body || {})));

router.use(requireAuth);

router.post('/change-pin', auth.requireFuelMobile(), handle(req => auth.changePin(req.user.id, req.body || {})));
router.get('/bootstrap', auth.requireFuelMobile(), handle(req => mobile.getBootstrap(req.user, req.fuel)));
// Perangkat yang dicabut tetap boleh mengirim antrean lama (ditandai) & menanyakan status.
router.post('/sync', auth.requireFuelMobile({ allowRevokedDevice: true }), handle(req => mobile.sync(req.body?.items, req.user, req.fuel)));
router.post('/status', auth.requireFuelMobile({ allowRevokedDevice: true }), handle(req => mobile.getStatuses(req.body?.client_uuids, req.user)));

module.exports = router;
