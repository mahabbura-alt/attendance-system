const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  daftarPayroll,
  buatPayroll,
  updatePayroll,
  hapusPayroll,
  exportPayrollExcel,
  importPayrollExcel,
  daftarAuditLogPayroll,
  sinkronKaryawanPayroll,
} = require('../controllers/payrollController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Max 10MB
});

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', daftarPayroll);
router.get('/export', exportPayrollExcel);
router.post('/', buatPayroll);
router.post('/sinkron', sinkronKaryawanPayroll);
router.patch('/:id', updatePayroll);
router.delete('/:id', hapusPayroll);
router.post('/import', upload.single('excel'), importPayrollExcel);
router.get('/audit-log', daftarAuditLogPayroll);

module.exports = router;
