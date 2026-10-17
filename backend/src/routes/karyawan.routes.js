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
  daftarPermintaanReset,
  resetPasswordKaryawan,
} = require('../controllers/karyawanController');
const WorkforceController = require('../controllers/workforceController');
const peopleRoutes = require('./people.routes');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.use('/people', peopleRoutes);
router.get('/', daftarKaryawan);
router.get('/audit-log', daftarAuditLogKaryawan);
router.get('/reset-requests', daftarPermintaanReset);
router.get('/workforce/summary', WorkforceController.summary);
router.get('/workforce/organization', WorkforceController.organization);
router.get('/workforce/movements', WorkforceController.listMovements);
router.get('/workforce/movements/:id', WorkforceController.movementDetail);
router.post('/workforce/movements', WorkforceController.createMovement);
router.post('/workforce/movements/:id/transition', WorkforceController.transitionMovement);
router.patch('/workforce/tasks/:taskId', WorkforceController.updateTask);
router.get('/workforce/mpp', WorkforceController.getMpp);
router.put('/workforce/mpp', WorkforceController.saveMpp);
router.get('/workforce/mpp/actual', WorkforceController.getMppActual);
router.get('/workforce/mpp/history', WorkforceController.getMppHistory);
router.post('/workforce/mpp/:id/transition', WorkforceController.transitionMpp);
router.get('/workforce/mpp/vacancy', WorkforceController.getVacancy);
router.get('/workforce/manpower-requests', WorkforceController.listManpowerRequests);
router.post('/workforce/manpower-requests', WorkforceController.createManpowerRequest);
router.get('/workforce/manpower-requests/:id', WorkforceController.getManpowerRequestDetail);
router.post('/workforce/manpower-requests/:id/transition', WorkforceController.transitionManpowerRequest);
router.post('/workforce/manpower-requests/:id/fulfillments', WorkforceController.addManpowerFulfillment);
router.get('/workforce/mpp/forecast', WorkforceController.getForecast);
router.get('/workforce/mpp/scenarios', WorkforceController.listScenarios);
router.post('/workforce/mpp/scenarios', WorkforceController.createScenario);
router.get('/workforce/mpp/scenarios/:id', WorkforceController.getScenarioDetail);
router.delete('/workforce/mpp/scenarios/:id', WorkforceController.deleteScenario);
router.post('/', buatKaryawan);
router.patch('/:id', updateKaryawan);
router.delete('/:id', hapusKaryawan);
router.post('/:id/reset-password', resetPasswordKaryawan);
router.post('/:id/foto-referensi', imageUpload.single('foto'), uploadFotoReferensi);

module.exports = router;
