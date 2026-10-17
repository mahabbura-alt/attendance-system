const express = require('express');
const { login, lupaSandi, resetSandi, mintaResetSandi, gantiSandi, daftarShiftDanLokasi } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Endpoint publik (tidak butuh auth). Login menerima employee_id atau email.
router.post('/login', login);

// Pendaftaran mandiri dihentikan (OMOS People v2): karyawan baru hanya dibuat
// admin HR lewat dashboard, lalu karyawan mengaktifkan akun dengan kode undangan.
router.post('/daftar', (req, res) => res.status(410).json({
  code: 'SELF_REGISTRATION_REMOVED',
  error: 'Pendaftaran mandiri tidak tersedia lagi. Akun karyawan dibuat oleh admin HR; cek email undangan untuk mengaktifkan akun.',
}));

router.post('/lupa-sandi', lupaSandi);
router.post('/reset-sandi', resetSandi);

// Reset lewat admin untuk karyawan tanpa email (OMOS Safety).
router.post('/minta-reset', mintaResetSandi);
router.post('/ganti-sandi', requireAuth, gantiSandi);

// Endpoint publik: daftar shift & lokasi (untuk form pendaftaran di app)
router.get('/opsi-pendaftaran', daftarShiftDanLokasi);

module.exports = router;
