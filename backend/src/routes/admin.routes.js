const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  semuaAbsensi, exportAbsensiExcel, editAbsensiManual, auditLogAbsensi, daftarShift,
  rekapPerforma, simpanKeteranganPresensi, daftarAuditLogPerforma, daftarRegistrasiPending, prosesRegistrasi,
  getProfilMe, updateProfilMe, daftarSubAdmins, buatSubAdmin, updateSubAdmin, hapusSubAdmin,
} = require('../controllers/adminController');

const {
  daftarRoster, daftarJabatanRoster, daftarTemplate, buatTemplate, assignRoster, assignRosterJabatan,
  overrideRosterDaily, overrideRosterDailyBatch, exportRoster, importRoster,
} = require('../controllers/rosterController');
const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const router = express.Router();

const { updateTunnelUrl } = require('../controllers/adminController');

// Public webhook route for auto-syncing Cloudflare Quick Tunnel URL
router.post('/update-tunnel-url', updateTunnelUrl);

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
router.get('/absensi/export.xlsx', exportAbsensiExcel);
router.patch('/absensi/:id', editAbsensiManual);
router.get('/audit-log/:absensiId', auditLogAbsensi);

// Shifts
router.get('/shifts', daftarShift);

// Rekap Performa (query: periode=harian|mingguan|bulanan|tahunan&tanggal_referensi=YYYY-MM-DD&user_id=)
router.get('/rekap-performa', rekapPerforma);
router.post('/keterangan-presensi', simpanKeteranganPresensi);
router.get('/audit-log-performa', daftarAuditLogPerforma);

// Roster Karyawan
router.get('/roster', daftarRoster);
router.get('/roster/jabatan', daftarJabatanRoster);
router.get('/roster/templates', daftarTemplate);
router.post('/roster/templates', buatTemplate);
router.post('/roster/assignments', assignRoster);
router.post('/roster/assignments/jabatan', assignRosterJabatan);
router.patch('/roster/daily', overrideRosterDaily);
router.patch('/roster/daily/batch', overrideRosterDailyBatch);
router.get('/roster/export', exportRoster);
router.post('/roster/import', rosterUpload.single('excel'), importRoster);

// Database Cuti Karyawan
const cutiController = require('../controllers/cutiController');
router.get('/cuti/dashboard', cutiController.dashboard);
router.get('/cuti/detail', cutiController.detail);
router.get('/cuti/policies', cutiController.daftarKebijakan);
router.get('/cuti/policy-scopes', cutiController.daftarLingkupKebijakan);
router.post('/cuti/policies', cutiController.buatKebijakan);
router.patch('/cuti/policies/:id', cutiController.ubahStatusKebijakan);
router.delete('/cuti/policies/:id', cutiController.hapusKebijakan);
router.post('/cuti/requests', cutiController.buatPengajuan);
router.get('/cuti/cycle-options', cutiController.opsiSiklus);
router.post('/cuti/cycle-applications', cutiController.buatPengajuanSiklus);
router.put('/cuti/cycle-applications/:id', cutiController.ubahPengajuanSiklus);
router.delete('/cuti/cycle-applications/:id', cutiController.hapusPengajuanSiklus);
router.post('/cuti/requests/:id/transition', cutiController.transisiPengajuan);
router.patch('/cuti/realisations/:id', cutiController.koreksiRealisasi);
router.post('/cuti/realisations/:id/cancel', cutiController.batalRealisasi);
router.get('/cuti/calendar', cutiController.kalender);
router.get('/cuti/reconciliation', cutiController.daftarRekonsiliasi);
router.post('/cuti/reconciliation/run', cutiController.jalankanRekonsiliasi);
router.get('/cuti/export', cutiController.exportCsv);

// Registrasi Pending (approve / tolak pendaftar baru)
router.get('/registrasi-pending', daftarRegistrasiPending);
router.patch('/registrasi-pending/:id', prosesRegistrasi);

module.exports = router;
