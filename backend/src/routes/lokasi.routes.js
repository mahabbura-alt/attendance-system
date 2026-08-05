const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { daftarLokasi, buatLokasi } = require('../controllers/lokasiController');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', daftarLokasi);
router.post('/', buatLokasi);

module.exports = router;
