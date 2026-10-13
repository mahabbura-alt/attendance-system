const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const {
  daftarKaryawan,
  buatKaryawan,
  uploadFotoReferensi,
  updateKaryawan,
  hapusKaryawan,
  daftarAuditLogKaryawan,
  daftarPermintaanReset,
  resetPasswordKaryawan,
} = require('../controllers/karyawanController');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', daftarKaryawan);
router.get('/audit-log', daftarAuditLogKaryawan);
router.get('/reset-requests', daftarPermintaanReset);
router.post('/', buatKaryawan);
router.patch('/:id', updateKaryawan);
router.delete('/:id', hapusKaryawan);
router.post('/:id/reset-password', resetPasswordKaryawan);
router.post('/:id/foto-referensi', imageUpload.single('foto'), uploadFotoReferensi);

module.exports = router;
