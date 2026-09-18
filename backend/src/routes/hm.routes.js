const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  listWorklogs, updateWorklogReview, getWorklogReviewHistory, exportWorklogs, importWorklogReviews,
} = require('../controllers/hmWorklogController');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/worklogs', listWorklogs);
router.get('/worklogs/export', exportWorklogs);
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, /\.xlsx$/i.test(file.originalname || '')) });
router.post('/worklogs/import', excelUpload.single('excel'), importWorklogReviews);
router.patch('/worklogs/:id/adjustment', updateWorklogReview);
// Cached dashboard clients may still call the previous path; it now performs
// the same audited correction and does not gate payroll eligibility.
router.patch('/worklogs/:id/review', updateWorklogReview);
router.get('/worklogs/:id/history', getWorklogReviewHistory);
const legacyWriteRemoved = (_req, res) => res.status(410).json({
  error: 'Endpoint HM manual lama telah diganti. Gunakan /api/admin/hm/worklogs untuk data Input Data.',
});
router.get('/', legacyWriteRemoved);
router.post('/', legacyWriteRemoved);
router.patch('/:id', legacyWriteRemoved);
router.delete('/:id', legacyWriteRemoved);

module.exports = router;
