const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { absenDatang, absenPulang, riwayat, rekapKehadiran, lokasiKantorSaya, rekapHmKaryawan, checkLokasi } = require('../controllers/absensiController');
const { getSlipGajiPdf } = require('../controllers/slipGajiController');
const { createRateLimiter } = require('../middleware/security');
const { imageUpload } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);
const absenLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ABSENSI_RATE_LIMIT_MAX || 10),
  key: (req) => `${req.user?.id || req.ip}:${req.path}`,
  message: 'Terlalu banyak percobaan absensi. Hubungi admin bila masalah berlanjut.',
});

router.post('/check-lokasi', checkLokasi);
router.post('/datang', absenLimiter, imageUpload.single('foto'), absenDatang);
router.post('/pulang', absenLimiter, imageUpload.single('foto'), absenPulang);
router.get('/riwayat', riwayat);
router.get('/rekap', rekapKehadiran);
router.get('/rekap-hm', rekapHmKaryawan);
router.get('/lokasi-kantor', lokasiKantorSaya);
router.get('/slip-gaji', getSlipGajiPdf);

module.exports = router;
