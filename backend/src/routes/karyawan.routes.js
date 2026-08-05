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
} = require('../controllers/karyawanController');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', daftarKaryawan);
router.get('/audit-log', daftarAuditLogKaryawan);
router.post('/', buatKaryawan);
router.patch('/:id', updateKaryawan);
router.delete('/:id', hapusKaryawan);
router.post('/:id/foto-referensi', imageUpload.single('foto'), uploadFotoReferensi);

module.exports = router;
