'use strict';

const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const hseService = require('../services/hse');
const hseWorkhours = require('../services/hseWorkhours');
const hseAi = require('../services/hseAi');
const hseAsk = require('../services/hseAsk');
const hseMobile = require('../services/hseMobile');
const aiSettings = require('../ai/aiSettings');

const router = express.Router();

router.use(requireAuth);

const handle = fn => async (req, res, next) => {
  try {
    const result = await fn(req);
    res.json(result);
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({
        error: 'Tabel modul HSE belum tersedia. Jalankan migrasi 073.',
        code: 'MIGRATION_REQUIRED',
      });
    }
    if (error.statusCode) {
      const body = { error: error.message };
      if (error.details) {
        body.code = error.code;
        body.details = error.details;
      }
      return res.status(error.statusCode).json(body);
    }
    next(error);
  }
};

router.use((req, res, next) => {
  req.hseScope = hseService.scopeFromUser(req.user);
  next();
});

// Overview & KPI
router.get('/overview', handle(async req => {
  return hseService.getOverview(pool, req.hseScope);
}));

// Masters (Locations, Categories, Matrix, Employees)
router.get('/masters', handle(async req => {
  return hseService.getMasters(pool, req.hseScope);
}));

// Setup Master: Lokasi Hierarkis (Area & Sub Area)
router.get('/locations/tree', handle(async req => {
  return hseService.listLocationsTree(pool, req.hseScope);
}));

router.post('/locations', handle(async req => {
  return hseService.createLocation(pool, req.hseScope, req.user, req.body);
}));

router.put('/locations/:id', handle(async req => {
  return hseService.updateLocation(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.delete('/locations/:id', handle(async req => {
  return hseService.deleteLocation(pool, req.hseScope, req.user, req.params.id);
}));

// Hazard Reports
// Hasil deteksi duplikat dilengkapi saran AI (bila fitur Aktif); mesin kata kunci tetap jadi cadangan.
router.get('/hazards', handle(async req => {
  const rows = await hseService.listHazards(pool, req.hseScope, req.query);
  await hseAi.decorateHazards(pool, req.hseScope, rows).catch(err => {
    console.warn(JSON.stringify({ requestId: req.id, message: 'dekorasi AI daftar hazard gagal', code: err.code || null }));
  });
  return rows;
}));

router.get('/hazards/reporter-stats', handle(async req => {
  return hseService.getHazardReporterStats(pool, req.hseScope);
}));

router.get('/hazards/:id', handle(async req => {
  const detail = await hseService.getHazardDetail(pool, req.hseScope, req.params.id);
  await hseAi.decorateHazards(pool, req.hseScope, [detail]).catch(err => {
    console.warn(JSON.stringify({ requestId: req.id, message: 'dekorasi AI detail hazard gagal', code: err.code || null }));
  });
  detail.can_merge = hseAi.canMergeHazard(req.user);
  return detail;
}));

router.post('/hazards', handle(async req => {
  const created = await hseService.createHazard(pool, req.hseScope, req.user, req.body);
  await hseAi.afterHazardSaved(pool, req.hseScope, created);
  return created;
}));

router.put('/hazards/:id', handle(async req => {
  const updated = await hseService.updateHazard(pool, req.hseScope, req.user, req.params.id, req.body);
  await hseAi.afterHazardSaved(pool, req.hseScope, updated);
  return updated;
}));

router.delete('/hazards/:id', handle(async req => {
  return hseService.deleteHazard(pool, req.hseScope, req.user, req.params.id);
}));

router.post('/hazards/:id/merge', handle(async req => {
  return hseService.mergeSimilarHazards(pool, req.hseScope, req.user, req.params.id, req.body?.source_hazard_id, {
    reason: req.body?.reason,
    suggestion_id: req.body?.suggestion_id || null,
    engine: req.body?.engine || null,
  });
}));

router.put('/hazards/:id/clean-description', handle(async req => {
  return hseAi.saveCleanDescription(pool, req.hseScope, req.user, req.params.id, req.body || {});
}));

// Asisten AI (trial agen LLM HSE) — lihat docs/RENCANA_IMPLEMENTASI_AGEN_LLM_HSE.md
router.get('/ai/overview', handle(async req => {
  return hseAi.getAiOverview(pool, req.hseScope, req.user);
}));

router.put('/ai/settings', handle(async req => {
  return aiSettings.updateSettings(pool, req.hseScope, req.user, req.body || {});
}));

router.get('/ai/shadow-report', handle(async req => {
  return hseAi.getShadowReport(pool, req.hseScope, req.user, { days: req.query.days });
}));

router.post('/ai/recheck', handle(async req => {
  return hseAi.recheckOpenHazards(pool, req.hseScope, req.user, { limit: Number(req.body?.limit) || 300 });
}));

router.post('/ai/hazards/triage', handle(async req => {
  return hseAi.triageHazard(pool, req.hseScope, req.user, req.body || {});
}));

router.post('/ai/suggestions/:id/decision', handle(async req => {
  return hseAi.decideSuggestion(pool, req.hseScope, req.user, req.params.id, req.body || {});
}));

router.post('/ai/duplicates/reject', handle(async req => {
  return hseAi.rejectDuplicate(pool, req.hseScope, req.user, req.body || {});
}));

// Tanya OMOS — tanya-jawab informasi data HSE (hanya-baca). Lihat docs/RENCANA_TANYA_OMOS_HSE.md
router.get('/ask/info', handle(async req => {
  return hseAsk.getAskInfo(pool, req.hseScope, req.user);
}));

router.post('/ask', handle(async req => {
  return hseAsk.askHse(pool, req.hseScope, req.user, req.body || {});
}));

router.post('/ask/feedback', handle(async req => {
  return hseAsk.saveAskFeedback(pool, req.hseScope, req.user, req.body || {});
}));

// Centralized CAPA (hse_actions)
router.get('/actions', handle(async req => {
  return hseService.listActions(pool, req.hseScope, req.query);
}));

router.post('/actions', handle(async req => {
  return hseService.createAction(pool, req.hseScope, req.user, req.body);
}));

router.put('/actions/:id', handle(async req => {
  return hseService.updateAction(pool, req.hseScope, req.user, req.params.id, req.body);
}));

// Fase 2: Incidents & Investigations
router.get('/incidents', handle(async req => {
  return hseService.listIncidents(pool, req.hseScope, req.query);
}));

router.get('/incidents/:id', handle(async req => {
  return hseService.getIncidentDetail(pool, req.hseScope, req.params.id);
}));

router.post('/incidents', handle(async req => {
  return hseService.createIncident(pool, req.hseScope, req.user, req.body);
}));

router.put('/incidents/:id', handle(async req => {
  return hseService.updateIncident(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.post('/incidents/:id/investigation', handle(async req => {
  return hseService.saveInvestigation(pool, req.hseScope, req.user, req.params.id, req.body);
}));

// Fase 2: Manhours & Safety Statistics / Reports
router.get('/manhours', handle(async req => {
  return hseService.listManhours(pool, req.hseScope, req.query);
}));

router.post('/manhours', handle(async req => {
  return hseService.saveManhours(pool, req.hseScope, req.user, req.body);
}));

router.get('/reports/safety', handle(async req => {
  return hseService.getSafetyReports(pool, req.hseScope, req.query);
}));

// Setup Master: Jam kerja karyawan (migrasi 092)
// Hari hadir dari sumber Rekap Performa × standar jam per hari → jam kerja HSE (LTIFR/TRIR/SR).
const handleWorkhours = fn => handle(async req => {
  try {
    return await fn(req);
  } catch (error) {
    if (error.code === '42P01') {
      const err = new Error('Tabel jam kerja karyawan belum tersedia. Jalankan migrasi 092.');
      err.statusCode = 503;
      throw err;
    }
    throw error;
  }
});

router.get('/workhours/setup', handleWorkhours(async req => {
  return hseWorkhours.getWorkhourSetup(pool, req.hseScope, req.query);
}));

router.get('/workhours/standards/history', handleWorkhours(async req => {
  return hseWorkhours.listStandardHistory(pool, req.hseScope, req.query);
}));

router.post('/workhours/standards/role', requireAdmin, handleWorkhours(async req => {
  return hseWorkhours.saveRoleStandards(pool, req.hseScope, req.user, req.body);
}));

router.post('/workhours/standards/employee', requireAdmin, handleWorkhours(async req => {
  return hseWorkhours.saveEmployeeOverrides(pool, req.hseScope, req.user, req.body);
}));

router.post('/workhours/standards/:id/end', requireAdmin, handleWorkhours(async req => {
  return hseWorkhours.endWorkhourStandard(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.get('/workhours/recap', handleWorkhours(async req => {
  return hseWorkhours.getWorkhourRecap(pool, req.hseScope, req.query);
}));

router.get('/workhours/recap/:employeeId', handleWorkhours(async req => {
  return hseWorkhours.getWorkhourRecapDetail(pool, req.hseScope, req.params.employeeId, req.query);
}));

router.get('/workhours/periods', handleWorkhours(async req => {
  return hseWorkhours.listWorkhourPeriods(pool, req.hseScope, req.query);
}));

router.get('/workhours/periods/:month/preview', handleWorkhours(async req => {
  return hseWorkhours.getPeriodPreview(pool, req.hseScope, req.params.month);
}));

router.post('/workhours/periods/:month/send', requireAdmin, handleWorkhours(async req => {
  return hseWorkhours.sendWorkhourPeriod(pool, req.hseScope, req.user, req.params.month, req.body);
}));

router.post('/workhours/periods/:id/reopen', requireAdmin, handleWorkhours(async req => {
  return hseWorkhours.reopenWorkhourPeriod(pool, req.hseScope, req.user, req.params.id, req.body);
}));

// Fase 3: Kompetensi (Lisensi/SIMPER, Matriks Pelatihan, Induksi, Safety Talk)
router.get('/competency/overview', handle(async req => {
  return hseService.getCompetencyOverview(pool, req.hseScope);
}));

router.get('/competency/courses', handle(async req => {
  return hseService.listCompetencyCourses(pool, req.hseScope);
}));

router.get('/competency/licenses', handle(async req => {
  return hseService.listEmployeeLicenses(pool, req.hseScope, req.query);
}));

router.post('/competency/licenses', handle(async req => {
  return hseService.createEmployeeLicense(pool, req.hseScope, req.user, req.body);
}));

router.put('/competency/licenses/:id', handle(async req => {
  return hseService.updateEmployeeLicense(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.get('/competency/matrix', handle(async req => {
  return hseService.getTrainingMatrix(pool, req.hseScope);
}));

router.get('/competency/training-records', handle(async req => {
  return hseService.listTrainingRecords(pool, req.hseScope, req.query);
}));

router.post('/competency/training-records', handle(async req => {
  return hseService.createTrainingRecord(pool, req.hseScope, req.user, req.body);
}));

router.get('/competency/inductions', handle(async req => {
  return hseService.listInductions(pool, req.hseScope, req.query);
}));

router.post('/competency/inductions', handle(async req => {
  return hseService.createInduction(pool, req.hseScope, req.user, req.body);
}));

// Catatan: endpoint lama /competency/safety-talks dihapus (migrasi 090).
// Pencatatan sesi dipindah ke tab P5M & Safety Talk (view Hazard dan Inspeksi).

// Fase 4: Izin Kerja (PTW, LOTO, SIMOPS)
router.get('/ptw/overview', handle(async req => {
  return hseService.getPtwOverview(pool, req.hseScope);
}));

router.get('/ptw/permits', handle(async req => {
  return hseService.listPermits(pool, req.hseScope, req.query);
}));

router.get('/ptw/permits/:id', handle(async req => {
  return hseService.getPermitDetail(pool, req.hseScope, req.params.id);
}));

router.post('/ptw/permits', handle(async req => {
  return hseService.createPermit(pool, req.hseScope, req.user, req.body);
}));

router.put('/ptw/permits/:id/status', handle(async req => {
  return hseService.updatePermitStatus(pool, req.hseScope, req.user, req.params.id, req.body?.status, req.body);
}));

router.post('/ptw/permits/:id/isolations', handle(async req => {
  return hseService.addPtwIsolation(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.put('/ptw/isolations/:id/release', handle(async req => {
  return hseService.releasePtwIsolation(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.post('/ptw/permits/:id/handovers', handle(async req => {
  return hseService.addPtwHandover(pool, req.hseScope, req.user, req.params.id, req.body);
}));

// Fase 4: Inspeksi Keselamatan (Inspection)
router.get('/inspections/templates', handle(async req => {
  return hseService.listInspectionTemplates(pool, req.hseScope, req.query);
}));

router.get('/inspections/templates/:id', handle(async req => {
  return hseService.getInspectionTemplateDetail(pool, req.hseScope, req.params.id);
}));

router.post('/inspections/templates', handle(async req => {
  return hseService.createInspectionTemplate(pool, req.hseScope, req.user, req.body);
}));

router.put('/inspections/templates/:id', handle(async req => {
  return hseService.updateInspectionTemplate(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.post('/inspections/templates/:id/version', handle(async req => {
  return hseService.createInspectionTemplateVersion(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.delete('/inspections/templates/:id', handle(async req => {
  return hseService.deactivateInspectionTemplate(pool, req.hseScope, req.user, req.params.id);
}));

// Setup Inspeksi: Lingkup Personil Seleksi Kewajiban
router.get('/inspections/mandates/scope', handle(async req => {
  return hseService.getInspectionPersonnelScope(pool, req.hseScope);
}));

router.post('/inspections/mandates/scope', handle(async req => {
  return hseService.saveInspectionPersonnelScope(pool, req.hseScope, req.user, req.body);
}));

// Setup Inspeksi: Matriks Target & Kewajiban
router.get('/inspections/targets', handle(async req => {
  return hseService.listInspectionTargets(pool, req.hseScope, req.query);
}));

router.get('/inspections/mandates/overview', handle(async req => {
  return hseService.getInspectionMandateOverview(pool, req.hseScope, req.query);
}));

router.post('/inspections/targets', handle(async req => {
  return hseService.createOrUpdateInspectionTarget(pool, req.hseScope, req.user, req.body);
}));

router.delete('/inspections/targets/:id', handle(async req => {
  return hseService.deactivateInspectionTarget(pool, req.hseScope, req.user, req.params.id);
}));

// Setup Hazard Report: Lingkup Personil Seleksi Kewajiban
router.get('/hazard/mandates/scope', handle(async req => {
  return hseService.getHazardReportPersonnelScope(pool, req.hseScope);
}));

router.post('/hazard/mandates/scope', handle(async req => {
  return hseService.saveHazardReportPersonnelScope(pool, req.hseScope, req.user, req.body);
}));

// Setup Hazard Report: Matriks Target & Kewajiban Pelaporan
router.get('/hazard/targets', handle(async req => {
  return hseService.listHazardReportTargets(pool, req.hseScope, req.query);
}));

router.get('/hazard/mandates/overview', handle(async req => {
  return hseService.getHazardReportMandateOverview(pool, req.hseScope, req.query);
}));

router.post('/hazard/targets', handle(async req => {
  return hseService.createOrUpdateHazardReportTarget(pool, req.hseScope, req.user, req.body);
}));

router.delete('/hazard/targets/:id', handle(async req => {
  return hseService.deactivateHazardReportTarget(pool, req.hseScope, req.user, req.params.id);
}));

// Setup P5M: Lingkup Personil Seleksi Kewajiban
router.get('/p5m/mandates/scope', handle(async req => {
  return hseService.getP5mPersonnelScope(pool, req.hseScope);
}));

router.post('/p5m/mandates/scope', handle(async req => {
  return hseService.saveP5mPersonnelScope(pool, req.hseScope, req.user, req.body);
}));

// Setup P5M: Matriks Target & Kewajiban
router.get('/p5m/targets', handle(async req => {
  return hseService.listP5mTargets(pool, req.hseScope, req.query);
}));

router.get('/p5m/mandates/overview', handle(async req => {
  return hseService.getP5mMandateOverview(pool, req.hseScope, req.query);
}));

router.post('/p5m/targets', handle(async req => {
  return hseService.createOrUpdateP5mTarget(pool, req.hseScope, req.user, req.body);
}));

router.delete('/p5m/targets/:id', handle(async req => {
  return hseService.deactivateP5mTarget(pool, req.hseScope, req.user, req.params.id);
}));

// Setup Safety Talk: Lingkup Personil Seleksi Kewajiban
router.get('/safetytalk/mandates/scope', handle(async req => {
  return hseService.getSafetytalkPersonnelScope(pool, req.hseScope);
}));

router.post('/safetytalk/mandates/scope', handle(async req => {
  return hseService.saveSafetytalkPersonnelScope(pool, req.hseScope, req.user, req.body);
}));

// Setup Safety Talk: Matriks Target & Kewajiban
router.get('/safetytalk/targets', handle(async req => {
  return hseService.listSafetytalkTargets(pool, req.hseScope, req.query);
}));

router.get('/safetytalk/mandates/overview', handle(async req => {
  return hseService.getSafetytalkMandateOverview(pool, req.hseScope, req.query);
}));

router.post('/safetytalk/targets', handle(async req => {
  return hseService.createOrUpdateSafetytalkTarget(pool, req.hseScope, req.user, req.body);
}));

router.delete('/safetytalk/targets/:id', handle(async req => {
  return hseService.deactivateSafetytalkTarget(pool, req.hseScope, req.user, req.params.id);
}));

// Event Operasional P5M (tab Hazard dan Inspeksi)
router.get('/p5m/events', handle(async req => {
  return hseService.listP5mEvents(pool, req.hseScope, req.query);
}));

router.get('/p5m/events/:id', handle(async req => {
  return hseService.getP5mEventDetail(pool, req.hseScope, req.params.id);
}));

router.post('/p5m/events', handle(async req => {
  return hseService.createP5mEvent(pool, req.hseScope, req.user, req.body);
}));

router.put('/p5m/events/:id', handle(async req => {
  return hseService.updateP5mEvent(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.delete('/p5m/events/:id', handle(async req => {
  return hseService.deleteP5mEvent(pool, req.hseScope, req.params.id);
}));

router.post('/p5m/events/:id/merge', handle(async req => {
  return hseService.mergeP5mEvents(pool, req.hseScope, req.user, req.params.id, req.body?.source_ids);
}));

// Event Operasional Safety Talk (tab Hazard dan Inspeksi)
router.get('/safetytalk/events', handle(async req => {
  return hseService.listSafetytalkEvents(pool, req.hseScope, req.query);
}));

router.get('/safetytalk/events/:id', handle(async req => {
  return hseService.getSafetytalkEventDetail(pool, req.hseScope, req.params.id);
}));

router.post('/safetytalk/events', handle(async req => {
  return hseService.createSafetytalkEvent(pool, req.hseScope, req.user, req.body);
}));

router.put('/safetytalk/events/:id', handle(async req => {
  return hseService.updateSafetytalkEvent(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.delete('/safetytalk/events/:id', handle(async req => {
  return hseService.deleteSafetytalkEvent(pool, req.hseScope, req.params.id);
}));

router.post('/safetytalk/events/:id/merge', handle(async req => {
  return hseService.mergeSafetytalkEvents(pool, req.hseScope, req.user, req.params.id, req.body?.source_ids);
}));

// Setup Master: Delegator Departemen (OMOS Safety — pengalihan/perpanjangan PIC)
router.get('/delegators', requireAdmin, handle(async req => {
  return hseMobile.listDepartmentDelegators(pool, req.hseScope);
}));

router.get('/delegators/:departmentId/history', requireAdmin, handle(async req => {
  return hseMobile.listDelegatorHistory(pool, req.hseScope, req.params.departmentId);
}));

router.put('/delegators/:departmentId', requireAdmin, handle(async req => {
  return hseMobile.setDepartmentDelegator(pool, req.hseScope, req.user, req.params.departmentId, req.body || {});
}));

router.delete('/delegators/:departmentId', requireAdmin, handle(async req => {
  return hseMobile.removeDepartmentDelegator(pool, req.hseScope, req.user, req.params.departmentId);
}));

// Setup Inspeksi: Jadwal Objek
router.get('/inspections/schedules', handle(async req => {
  return hseService.listInspectionSchedules(pool, req.hseScope, req.query);
}));

router.post('/inspections/schedules', handle(async req => {
  return hseService.createInspectionSchedule(pool, req.hseScope, req.user, req.body);
}));

router.delete('/inspections/schedules/:id', handle(async req => {
  return hseService.deactivateInspectionSchedule(pool, req.hseScope, req.user, req.params.id);
}));

// Laporan Kepatuhan Kuota (Realisasi vs Target)
router.get('/inspections/compliance', handle(async req => {
  return hseService.getInspectionComplianceReport(pool, req.hseScope, req.query);
}));

router.get('/inspections', handle(async req => {
  return hseService.listInspections(pool, req.hseScope, req.query);
}));

router.get('/inspections/:id', handle(async req => {
  return hseService.getInspectionDetail(pool, req.hseScope, req.params.id);
}));

router.post('/inspections', handle(async req => {
  return hseService.createInspection(pool, req.hseScope, req.user, req.body);
}));

// Lampiran inspeksi (replace-set atomik: foto wajib >= 1, dokumen opsional)
router.put('/inspections/:id/lampiran', handle(async req => {
  return hseService.updateInspectionAttachments(pool, req.hseScope, req.params.id, req.body || {});
}));
// Fase 5: Kesehatan Kerja (Occupational Health)
router.get('/health/overview', handle(async req => {
  return hseService.getOccHealthOverview(pool, req.hseScope);
}));

router.get('/health/mcu', handle(async req => {
  return hseService.listMcuRecords(pool, req.hseScope, req.query);
}));

router.post('/health/mcu', handle(async req => {
  return hseService.createMcuRecord(pool, req.hseScope, req.user, req.body);
}));

router.put('/health/mcu/:id', handle(async req => {
  return hseService.updateMcuRecord(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.get('/health/ffw', handle(async req => {
  return hseService.listFfwChecks(pool, req.hseScope, req.query);
}));

router.post('/health/ffw', handle(async req => {
  return hseService.createFfwCheck(pool, req.hseScope, req.user, req.body);
}));

router.get('/health/substance-tests', handle(async req => {
  return hseService.listSubstanceTests(pool, req.hseScope, req.query);
}));

router.post('/health/substance-tests', handle(async req => {
  return hseService.createSubstanceTest(pool, req.hseScope, req.user, req.body);
}));

router.get('/health/cases', handle(async req => {
  return hseService.listHealthCases(pool, req.hseScope, req.query);
}));

router.post('/health/cases', handle(async req => {
  return hseService.createHealthCase(pool, req.hseScope, req.user, req.body);
}));

router.put('/health/cases/:id', handle(async req => {
  return hseService.updateHealthCase(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.get('/health/hygiene', handle(async req => {
  return hseService.listHygieneMeasurements(pool, req.hseScope, req.query);
}));

router.post('/health/hygiene', handle(async req => {
  return hseService.createHygieneMeasurement(pool, req.hseScope, req.user, req.body);
}));

// ============================================================================
// Fase 6: Tanggap Darurat (Emergency Response)
// ============================================================================
router.get('/emergency/overview', handle(async req => {
  return hseService.getEmergencyOverview(pool, req.hseScope);
}));

router.get('/emergency/team', handle(async req => {
  return hseService.listEmergencyTeam(pool, req.hseScope, req.query);
}));

router.post('/emergency/team', handle(async req => {
  return hseService.createEmergencyTeamMember(pool, req.hseScope, req.user, req.body);
}));

router.put('/emergency/team/:id', handle(async req => {
  return hseService.updateEmergencyTeamMember(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.get('/emergency/drills', handle(async req => {
  return hseService.listEmergencyDrills(pool, req.hseScope, req.query);
}));

router.post('/emergency/drills', handle(async req => {
  return hseService.createEmergencyDrill(pool, req.hseScope, req.user, req.body);
}));

router.get('/emergency/equipment', handle(async req => {
  return hseService.listEmergencyEquipment(pool, req.hseScope, req.query);
}));

router.post('/emergency/equipment', handle(async req => {
  return hseService.createEmergencyEquipment(pool, req.hseScope, req.user, req.body);
}));

router.put('/emergency/equipment/:id', handle(async req => {
  return hseService.updateEmergencyEquipment(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.get('/emergency/assembly-points', handle(async req => {
  return hseService.listEmergencyAssemblyPoints(pool, req.hseScope);
}));

router.post('/emergency/assembly-points', handle(async req => {
  return hseService.createEmergencyAssemblyPoint(pool, req.hseScope, req.user, req.body);
}));

router.get('/emergency/contacts', handle(async req => {
  return hseService.listEmergencyContacts(pool, req.hseScope);
}));

router.post('/emergency/contacts', handle(async req => {
  return hseService.createEmergencyContact(pool, req.hseScope, req.user, req.body);
}));

// ============================================================================
// Fase 6: APD dan Peralatan (PPE)
// ============================================================================
router.get('/ppe/overview', handle(async req => {
  return hseService.getPpeOverview(pool, req.hseScope);
}));

router.get('/ppe/items', handle(async req => {
  return hseService.listPpeItems(pool, req.hseScope, req.query);
}));

router.post('/ppe/items', handle(async req => {
  return hseService.createPpeItem(pool, req.hseScope, req.user, req.body);
}));

router.get('/ppe/standards', handle(async req => {
  return hseService.listPpeStandards(pool, req.hseScope, req.query);
}));

router.post('/ppe/standards', handle(async req => {
  return hseService.createPpeStandard(pool, req.hseScope, req.user, req.body);
}));

router.get('/ppe/issuances', handle(async req => {
  return hseService.listPpeIssuances(pool, req.hseScope, req.query);
}));

router.post('/ppe/issuances', handle(async req => {
  return hseService.createPpeIssuance(pool, req.hseScope, req.user, req.body);
}));

router.put('/ppe/issuances/:id/return', handle(async req => {
  return hseService.returnPpeIssuance(pool, req.hseScope, req.user, req.params.id, req.body);
}));

// ============================================================================
// Fase 7: Kontraktor (CSMS)
// ============================================================================
router.get('/contractors/overview', handle(async req => {
  return hseService.getContractorOverview(pool, req.hseScope);
}));

router.get('/contractors', handle(async req => {
  return hseService.listContractors(pool, req.hseScope, req.query);
}));

router.post('/contractors', handle(async req => {
  return hseService.createContractor(pool, req.hseScope, req.user, req.body);
}));

router.get('/contractors/assessments', handle(async req => {
  return hseService.listContractorAssessments(pool, req.hseScope, req.query);
}));

router.post('/contractors/assessments', handle(async req => {
  return hseService.createContractorAssessment(pool, req.hseScope, req.user, req.body);
}));

router.get('/contractors/documents', handle(async req => {
  return hseService.listContractorDocuments(pool, req.hseScope, req.query);
}));

router.post('/contractors/documents', handle(async req => {
  return hseService.createContractorDocument(pool, req.hseScope, req.user, req.body);
}));

router.get('/contractors/violations', handle(async req => {
  return hseService.listContractorViolations(pool, req.hseScope, req.query);
}));

router.post('/contractors/violations', handle(async req => {
  return hseService.createContractorViolation(pool, req.hseScope, req.user, req.body);
}));

router.put('/contractors/violations/:id/resolve', handle(async req => {
  return hseService.resolveContractorViolation(pool, req.hseScope, req.user, req.params.id, req.body);
}));

// ============================================================================
// Fase 7: Lingkungan Hidup (Environment)
// ============================================================================
router.get('/environment/overview', handle(async req => {
  return hseService.getEnvironmentOverview(pool, req.hseScope);
}));

router.get('/environment/waste-b3', handle(async req => {
  return hseService.listWasteB3Logs(pool, req.hseScope, req.query);
}));

router.post('/environment/waste-b3', handle(async req => {
  return hseService.createWasteB3Log(pool, req.hseScope, req.user, req.body);
}));

router.get('/environment/points', handle(async req => {
  return hseService.listEnvMonitoringPoints(pool, req.hseScope, req.query);
}));

router.post('/environment/points', handle(async req => {
  return hseService.createEnvMonitoringPoint(pool, req.hseScope, req.user, req.body);
}));

router.get('/environment/parameters', handle(async req => {
  return hseService.listEnvParameters(pool, req.hseScope, req.query);
}));

router.get('/environment/measurements', handle(async req => {
  return hseService.listEnvMeasurements(pool, req.hseScope, req.query);
}));

router.post('/environment/measurements', handle(async req => {
  return hseService.createEnvMeasurement(pool, req.hseScope, req.user, req.body);
}));

router.get('/environment/reclamation', handle(async req => {
  return hseService.listReclamationRecords(pool, req.hseScope, req.query);
}));

router.post('/environment/reclamation', handle(async req => {
  return hseService.createReclamationRecord(pool, req.hseScope, req.user, req.body);
}));

// ============================================================================
// Fase 8: Audit, SMKP Minerba & Dokumen Regulasi
// ============================================================================
router.get('/audits/overview', handle(async req => {
  return hseService.getAuditOverview(pool, req.hseScope);
}));

router.get('/audits', handle(async req => {
  return hseService.listAudits(pool, req.hseScope, req.query);
}));

router.post('/audits', handle(async req => {
  return hseService.createAudit(pool, req.hseScope, req.user, req.body);
}));

router.get('/audits/findings', handle(async req => {
  return hseService.listAuditFindings(pool, req.hseScope, req.query);
}));

router.post('/audits/findings', handle(async req => {
  return hseService.createAuditFinding(pool, req.hseScope, req.user, req.body);
}));

router.put('/audits/findings/:id/resolve', handle(async req => {
  return hseService.resolveAuditFinding(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.get('/audits/smkp-elements', handle(async () => {
  return hseService.listSmkpElements(pool);
}));

router.get('/docs/overview', handle(async req => {
  return hseService.getDocumentsOverview(pool, req.hseScope);
}));

router.get('/docs', handle(async req => {
  return hseService.listDocuments(pool, req.hseScope, req.query);
}));

router.post('/docs', handle(async req => {
  return hseService.createDocument(pool, req.hseScope, req.user, req.body);
}));

router.post('/docs/:id/revisions', handle(async req => {
  return hseService.createDocumentRevision(pool, req.hseScope, req.user, req.params.id, req.body);
}));

router.get('/legal-register', handle(async req => {
  return hseService.listLegalRegister(pool, req.hseScope, req.query);
}));

router.post('/legal-register', handle(async req => {
  return hseService.createLegalRegister(pool, req.hseScope, req.user, req.body);
}));

router.get('/mandatory-reports', handle(async req => {
  return hseService.listMandatoryReports(pool, req.hseScope, req.query);
}));

router.post('/mandatory-reports', handle(async req => {
  return hseService.createMandatoryReport(pool, req.hseScope, req.user, req.body);
}));

router.put('/mandatory-reports/:id/status', handle(async req => {
  return hseService.updateMandatoryReportStatus(pool, req.hseScope, req.user, req.params.id, req.body);
}));

// Register Risiko (IBPR / HIRADC)
router.get('/risk-register/overview', handle(async req => {
  return hseService.getRiskRegisterOverview(pool, req.hseScope);
}));

router.get('/risk-register', handle(async req => {
  return hseService.listRiskRegister(pool, req.hseScope, req.query);
}));

router.post('/risk-register', handle(async req => {
  return hseService.createRiskRegisterItem(pool, req.hseScope, req.user, req.body);
}));

module.exports = router;



