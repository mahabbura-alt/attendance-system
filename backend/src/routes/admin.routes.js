const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  semuaAbsensi, editAbsensiManual, auditLogAbsensi, daftarShift,
  rekapPerforma, simpanKeteranganPresensi, daftarAuditLogPerforma, daftarRegistrasiPending, prosesRegistrasi,
  getProfilMe, updateProfilMe, daftarSubAdmins, buatSubAdmin, updateSubAdmin, hapusSubAdmin,
} = require('../controllers/adminController');

const router = express.Router();

router.use(requireAuth, requireAdmin);

// Profil Admin & Otoritas Sub-Admin
router.get('/me', getProfilMe);
router.patch('/me', updateProfilMe);

router.get('/sub-admins', daftarSubAdmins);
router.post('/sub-admins', buatSubAdmin);
router.patch('/sub-admins/:id', updateSubAdmin);
router.delete('/sub-admins/:id', hapusSubAdmin);

// Absensi
router.get('/absensi', semuaAbsensi);
router.patch('/absensi/:id', editAbsensiManual);
router.get('/audit-log/:absensiId', auditLogAbsensi);

// Shifts
router.get('/shifts', daftarShift);

// Rekap Performa (query: periode=harian|mingguan|bulanan|tahunan&tanggal_referensi=YYYY-MM-DD&user_id=)
router.get('/rekap-performa', rekapPerforma);
router.post('/keterangan-presensi', simpanKeteranganPresensi);
router.get('/audit-log-performa', daftarAuditLogPerforma);

// Registrasi Pending (approve / tolak pendaftar baru)
router.get('/registrasi-pending', daftarRegistrasiPending);
router.patch('/registrasi-pending/:id', prosesRegistrasi);

module.exports = router;
