'use strict';

/** Admin Akses Fuel (`/api/admin/fuel-access`) — akun PIN, perangkat, ambang, review shift, ID scan. */
const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const access = require('../services/fuelAccess');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const handle = fn => async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await fn(req));
  } catch (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return res.status(503).json({ error: 'Skema OMOS Fuel belum tersedia. Jalankan migrasi 104.', code: 'MIGRATION_REQUIRED' });
    }
    const status = error.status || error.statusCode;
    if (status) return res.status(status).json({ error: error.message, code: error.code || null });
    next(error);
  }
};
const aktor = req => req.user?.id || null;

router.get('/accounts', handle(() => access.listAccounts()));
router.get('/candidates', handle(req => access.listCandidates(req.query.q)));
router.post('/accounts', handle(req => access.createAccount(req.body || {}, aktor(req))));
router.patch('/accounts/:userId', handle(req => access.updateAccount(req.params.userId, req.body || {}, aktor(req))));
router.post('/accounts/:userId/reset-pin', handle(req => access.resetPin(req.params.userId, aktor(req))));

router.get('/devices', handle(() => access.listDevices()));
router.post('/devices/:id/approve', handle(req => access.approveDevice(req.params.id, aktor(req))));
router.post('/devices/:id/revoke', handle(req => access.revokeDevice(req.params.id, req.body?.reason, aktor(req))));

router.get('/settings', handle(() => access.getSettings()));
router.put('/settings', handle(req => access.updateSettings(req.body || {}, aktor(req))));

router.get('/shift-sessions', handle(req => access.listShiftSessions({ status: req.query.status, limit: req.query.limit })));
router.post('/shift-sessions/:id/review', handle(req => access.reviewShiftSession(req.params.id, req.body?.note, aktor(req))));

router.get('/pending-validations', handle(() => access.listPendingValidations()));

router.post('/scan-ids/regenerate', handle(req => access.regenerateScanId(req.body || {}, aktor(req))));
router.get('/labels', handle(req => access.labelData({ target_type: req.query.target_type, ids: req.query.ids, kelas: req.query.kelas })));
// Banyak unit sekaligus (ID di body agar tidak melewati batas panjang URL).
router.post('/labels', handle(req => access.labelData({ target_type: req.body?.target_type, ids: req.body?.ids, kelas: req.body?.kelas })));
router.put('/equipment/:id/tank-capacity', handle(req => access.setTankCapacity(req.params.id, req.body?.fuel_tank_capacity_liter, aktor(req))));

module.exports = router;
