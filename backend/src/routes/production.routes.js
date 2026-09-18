const express = require('express');
const router = express.Router();
const ProductionController = require('../controllers/production.controller');
const ProductionDataController = require('../controllers/productionDataController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Production endpoints are administrative and must never fall back to an
// artificial identity when the Authorization header is absent or invalid.
router.use(requireAuth, requireAdmin);

// Master Data Lookup & Parameter Management
router.get('/master', ProductionController.getMasterData);
router.get('/productivity-plans/:planningType/history', ProductionController.getProductivityPlanHistory);
router.get('/productivity-plans/:planningType', ProductionController.getProductivityPlan);
router.put('/productivity-plans/:planningType', ProductionController.saveProductivityPlan);
router.get('/fleet-plans/catalog', ProductionController.getFleetPlanCatalog);
router.get('/spo-jobs/deployed', ProductionController.getDeployedSpoJobs);
router.post('/equipment', ProductionController.createEquipment);
router.post('/equipment/import', ProductionController.importEquipment);
router.put('/equipment/:id', ProductionController.updateEquipment);
router.post('/equipment/:id', ProductionController.updateEquipment);
router.delete('/equipment/:id', ProductionController.deleteEquipment);
router.post('/standby-codes', ProductionController.createStandbyCode);
router.post('/breakdown-codes', ProductionController.createBreakdownCode);
router.patch('/standby-codes/:id', ProductionController.updateStandbyCode);
router.delete('/standby-codes/:id', ProductionController.deleteStandbyCode);
router.patch('/breakdown-codes/:id', ProductionController.updateBreakdownCode);
router.delete('/breakdown-codes/:id', ProductionController.deleteBreakdownCode);
router.post('/job-codes', ProductionController.createJobCode);
router.patch('/job-codes/:id', ProductionController.updateJobCode);
router.delete('/job-codes/:id', ProductionController.deleteJobCode);
router.post('/problem-codes', ProductionController.createProblemCode);
router.patch('/problem-codes/:id', ProductionController.updateProblemCode);
router.delete('/problem-codes/:id', ProductionController.deleteProblemCode);
router.post('/apply-template', ProductionController.applyParameterTemplate);
router.post('/clear-parameters', ProductionController.clearAllParameters);

// 1. Input Data (Daily Production Logs)
router.get('/logs', ProductionController.getProductionLogs);
router.get('/log-periods', ProductionController.getProductionLogPeriods);
router.post('/logs', ProductionController.createProductionLog);
router.post('/logs/batch', ProductionController.createProductionLogsBatch);
router.delete('/logs/batch', ProductionController.deleteProductionLogsBatch);
router.patch('/logs/batch/restore', ProductionController.restoreProductionLogsBatch);
router.post('/logs/hm-check', ProductionController.checkProductionLogHm);
router.patch('/logs/:id', ProductionController.updateProductionLog);

// 2. Input Fuel
router.get('/fuel', ProductionController.getFuelLogs);
router.get('/fuel-periods', ProductionController.getFuelLogPeriods);
router.get('/fuel-cards', ProductionController.getFuelCards);
router.post('/fuel', ProductionController.createFuelLog);
router.patch('/fuel/batch/restore', ProductionController.restoreFuelLogsBatch);
router.delete('/fuel/batch', ProductionController.deleteFuelLogsBatch);
router.get('/fuel/:id/audit', ProductionController.getFuelAudit);
router.patch('/fuel/:id/approval', ProductionController.updateFuelApproval);
router.patch('/fuel/:id', ProductionController.updateFuelLog);

// 3. Standby
router.get('/standby', ProductionController.getStandbyLogs);
router.get('/standby-history', ProductionController.getStandbyHistory);
router.get('/standby-review', ProductionController.getStandbyReviewQueue);
router.post('/standby', ProductionController.createStandbyLog);
router.post('/standby/batch', ProductionController.createStandbyLogsBatch);
router.delete('/standby/batch', ProductionController.deleteStandbyLogsBatch);
router.patch('/standby/session', ProductionController.updateStandbyLogsSession);
router.post('/standby/close', ProductionController.closeStandbyShift);
router.post('/standby/reopen', ProductionController.reopenStandbyShift);
router.patch('/standby/:id', ProductionController.updateStandbyLog);
router.patch('/standby/:id/review', ProductionController.reviewStandbyLog);

// 4. Breakdown
router.get('/breakdown', ProductionController.getBreakdownLogs);
router.get('/breakdown-history', ProductionController.getBreakdownHistory);
router.post('/breakdown', ProductionController.createBreakdownLog);
router.patch('/breakdown/:id/status', ProductionController.updateBreakdownStatus);
router.patch('/breakdown/:id/pic', ProductionController.updateBreakdownPic);
router.patch('/breakdown/:id/status-history/:segmentId', ProductionController.editBreakdownStatusSegment);
router.post('/breakdown/:id/ready-verification', ProductionController.verifyBreakdownReady);
router.post('/breakdown/:id/ready-reconciliation', ProductionController.reconcileBreakdownReady);
router.post('/breakdown/:id/parts', ProductionController.addBreakdownPart);
router.delete('/breakdown/:id', ProductionController.deleteBreakdownLog);
router.get('/unit-performance', ProductionController.getUnitPerformance);
router.post('/maintenance-events', ProductionController.createMaintenanceEvent);
router.patch('/maintenance-events/:id', ProductionController.updateMaintenanceEvent);

// 5. Input Ritase & Fleet Auto Mapping
router.get('/fleet-mappings', ProductionController.getFleetMappings);
router.post('/fleet-mappings', ProductionController.createFleetMapping);
router.delete('/fleet-mappings/:id', ProductionController.deleteFleetMapping);
router.get('/ritase/fleet', ProductionController.getRitaseFleetGrid);
router.post('/ritase/hours', ProductionController.saveRitaseHours);
router.get('/ritase/distance-summary', ProductionController.getRitaseDistanceSummary);
router.post('/ritase/distance-allocations', ProductionController.saveRitaseDistanceAllocations);
router.get('/ritase/productivity-exceptions', ProductionController.getRitaseProductivityExceptions);
router.post('/ritase/productivity-exceptions', ProductionController.saveRitaseProductivityException);
router.get('/ritase', ProductionController.getRitaseLogs);
router.post('/ritase', ProductionController.createRitaseLog);
router.get('/truck-factors/previous', ProductionController.getPreviousTruckFactors);
router.get('/truck-factors', ProductionController.getTruckFactors);
router.post('/truck-factors', ProductionController.saveTruckFactors);

// 6. Data Curah Hujan
router.get('/rainfall', ProductionController.getRainfallLogs);
router.post('/rainfall/batch', ProductionController.saveRainfallLogs);
router.get('/daily-dashboard', ProductionController.getDailyDashboard);

// 7. Data Produksi (same authenticated client database boundary as source logs).
router.get('/production-data', ProductionDataController.getReport);
router.post('/production-data/fuel/batch', ProductionDataController.saveAllocationBatch);
router.put('/production-data/fuel/:id', ProductionDataController.saveAllocation);
router.post('/production-data/fuel-allocation-rules', ProductionDataController.createAllocationRule);
router.post('/production-data/density-snapshots', ProductionDataController.captureDensity);

// 8. Productivity Report
router.get('/productivity-report', ProductionController.getProductivityReport);

// 9. MTD Report
router.get('/mtd-report', ProductionController.getMtdReport);

// 10. YTD Report
router.get('/ytd-report', ProductionController.getYtdReport);

// 11. Project To Date
router.get('/project-to-date', ProductionController.getProjectToDateReport);

// 12. Executive Dashboard & AI Engine
router.get('/executive-dashboard', ProductionController.getExecutiveDashboard);
router.get('/ai-insights', ProductionController.getAiInsights);

module.exports = router;
