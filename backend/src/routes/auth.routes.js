const express = require('express');
const { login, daftar, lupaSandi, resetSandi, mintaResetSandi, gantiSandi, daftarShiftDanLokasi } = require('../controllers/authController');
const { multiImageUpload } = require('../middleware/upload');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Endpoint publik (tidak butuh auth). Login menerima employee_id atau email.
router.post('/login', login);

// Endpoint daftar dengan 3 sampel foto
router.post('/daftar', multiImageUpload.any(), daftar);

router.post('/lupa-sandi', lupaSandi);
router.post('/reset-sandi', resetSandi);

// Reset lewat admin untuk karyawan tanpa email (OMOS Safety).
router.post('/minta-reset', mintaResetSandi);
router.post('/ganti-sandi', requireAuth, gantiSandi);

// Endpoint publik: daftar shift & lokasi (untuk form pendaftaran di app)
router.get('/opsi-pendaftaran', daftarShiftDanLokasi);

module.exports = router;
