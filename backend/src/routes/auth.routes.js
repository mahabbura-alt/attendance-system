const express = require('express');
const { login, daftar, lupaSandi, resetSandi, daftarShiftDanLokasi } = require('../controllers/authController');
const { multiImageUpload } = require('../middleware/upload');

const router = express.Router();

// Endpoint publik (tidak butuh auth)
router.post('/login', login);

// Endpoint daftar dengan 3 sampel foto
router.post('/daftar', multiImageUpload.any(), daftar);

router.post('/lupa-sandi', lupaSandi);
router.post('/reset-sandi', resetSandi);

// Endpoint publik: daftar shift & lokasi (untuk form pendaftaran di app)
router.get('/opsi-pendaftaran', daftarShiftDanLokasi);

module.exports = router;
