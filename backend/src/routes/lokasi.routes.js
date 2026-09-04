const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { daftarLokasi, buatLokasi, updateLokasi, hapusLokasi } = require('../controllers/lokasiController');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', daftarLokasi);
router.post('/', buatLokasi);
router.patch('/:id', updateLokasi);
router.delete('/:id', hapusLokasi);

module.exports = router;
