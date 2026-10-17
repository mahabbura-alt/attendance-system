const express = require('express');
const { pdfUpload, xlsxUpload } = require('../middleware/upload');
const C = require('../controllers/peopleController');

/** OMOS People v2 — dipasang di /api/admin/karyawan/people (sudah requireAuth + requireAdmin). */
const router = express.Router();

router.get('/org', C.getOrg);
router.post('/org/departments', C.createDepartment);
router.patch('/org/departments/:id', C.updateDepartment);
router.post('/org/positions', C.createPosition);
router.patch('/org/positions/:id', C.updatePosition);
router.get('/settings', C.getSettings);
router.put('/settings', C.updateSettings);
router.get('/options', C.getOptions);

router.get('/directory', C.getDirectory);
router.get('/reminders', C.getReminders);
router.get('/movements', C.getMovements);

router.post('/employees', C.createEmployee);
router.get('/employees/:id', C.getProfile);
router.patch('/employees/:id/personal', C.updatePersonal);
router.post('/employees/:id/reveal-nik', C.revealNik);
router.put('/employees/:id/locations', C.setLocations);
router.get('/employees/:id/family', C.getFamily);
router.put('/employees/:id/family', C.saveFamily);
router.post('/employees/:id/void', C.voidEmployee);
router.get('/employees/:id/documents', C.listDocuments);
router.post('/employees/:id/documents', pdfUpload.single('file'), C.uploadDocument);
router.get('/documents/:docId/file', C.viewDocument);
router.delete('/documents/:docId', C.deleteDocument);

router.get('/import/template', C.importTemplate);
router.get('/import/batches', C.importBatches);
router.post('/import/preview', xlsxUpload.single('file'), C.importPreview);
router.post('/import/:batchId/mappings', C.importMappings);
router.post('/import/:batchId/commit', C.importCommit);
router.post('/import/:batchId/cancel', C.importCancel);
router.post('/import/:batchId/void', C.importVoid);

module.exports = router;
