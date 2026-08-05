const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  daftarHm,
  buatHm,
  updateHm,
  hapusHm,
} = require('../controllers/hmController');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', daftarHm);
router.post('/', buatHm);
router.patch('/:id', updateHm);
router.delete('/:id', hapusHm);

module.exports = router;
