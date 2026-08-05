const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { hitungKalkulasiPayroll, simpanConfigPayroll } = require('../controllers/kalkulasiPayrollController');
const { cetakSlipGajiPdfAdmin } = require('../controllers/slipGajiController');

const router = express.Router();
router.use(requireAdmin);

router.get('/', hitungKalkulasiPayroll);
router.post('/config', simpanConfigPayroll);
router.get('/slip-pdf', cetakSlipGajiPdfAdmin);

module.exports = router;
