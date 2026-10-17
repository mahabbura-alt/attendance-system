'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const hseCss = fs.readFileSync(path.join(__dirname, 'hse.css'), 'utf8');
const hseJs = fs.readFileSync(path.join(__dirname, 'hse.js'), 'utf8');
const previewHtml = fs.readFileSync(path.join(__dirname, 'test-fixtures', 'hse-preview.html'), 'utf8');

test('index.html provides HSE tab button, root section, stylesheet, and script', () => {
  assert.match(indexHtml, /data-tab="hse"/);
  assert.match(indexHtml, /id="tabHse"/);
  assert.match(indexHtml, /id="hseRoot"/);
  assert.match(indexHtml, /href="hse\.css\?v=\d+"/);
  assert.match(indexHtml, /src="hse\.js\?v=\d+"/);
  assert.match(indexHtml, /tabler-icons/);
});

test('app.js integrates HSE tab loader and makes it visible for logged-in admin', () => {
  assert.match(appJs, /case 'hse': result = await window\.OMOSHSE\?\.load\(\); break;/);
  assert.match(appJs, /tabName === 'hse'/);
});

test('hse.css defines exact layout and visual tokens from reference specification', () => {
  assert.match(hseCss, /grid-template-columns:\s*152px\s*minmax\(0,\s*1fr\)/);
  assert.match(hseCss, /--hse-bg-success/);
  assert.match(hseCss, /--hse-fill-accent/);
  assert.match(hseCss, /\.hse-hero/);
  assert.match(hseCss, /\.hse-kpi-grid/);
  assert.match(hseCss, /\.hse-bar-chart/);
  assert.match(hseCss, /\.hse-compliance-row/);
});

test('hse.js exposes OMOSHSE controller and implements all 13 subpages in sidebar', () => {
  assert.match(hseJs, /global\.OMOSHSE\s*=\s*\{/);
  assert.match(hseJs, /overview:\s*\{ label:\s*'Ringkasan'/);
  assert.match(hseJs, /reports:\s*\{ label:\s*'Laporan dan statistik'/);
  assert.match(hseJs, /hazard:\s*\{ label:\s*'Hazard dan inspeksi'/);
  assert.match(hseJs, /incident:\s*\{ label:\s*'Insiden dan investigasi'/);
  assert.match(hseJs, /ptw:\s*\{ label:\s*'Izin kerja'/);
  assert.match(hseJs, /competency:\s*\{ label:\s*'Kompetensi'/);
  assert.match(hseJs, /['"]?occ-health['"]?:\s*\{ label:\s*'Kesehatan kerja'/);
  assert.match(hseJs, /contractor:\s*\{ label:\s*'Kontraktor'/);
  assert.match(hseJs, /environment:\s*\{ label:\s*'Lingkungan'/);
  assert.match(hseJs, /emergency:\s*\{ label:\s*'Tanggap darurat'/);
  assert.match(hseJs, /ppe:\s*\{ label:\s*'APD dan peralatan'/);
  assert.match(hseJs, /audit:\s*\{ label:\s*'Audit dan temuan'/);
  assert.match(hseJs, /documents:\s*\{ label:\s*'Dokumen dan regulasi'/);
});

test('hse.js wraps async actions with OMOSActionFeedback and provides modal forms', () => {
  assert.match(hseJs, /OMOSActionFeedback\.run/);
  assert.match(hseJs, /formHseCreateHazard/);
  assert.match(hseJs, /inHzPotentialConsequence/);
  assert.match(hseJs, /inHzReportedBy/);
  assert.match(hseJs, /inHzReporterDetail/);
  assert.match(hseJs, /inHzMatrixPreview/);
  assert.match(hseJs, /formHseCreateAction/);
  assert.match(hseJs, /formHseUpdateAction/);
  assert.match(hseJs, /formHseCreateIncident/);
  assert.match(hseJs, /formHseSaveInvestigation/);
  assert.match(hseJs, /formHseSaveManhours/);
  assert.match(hseJs, /formHseSaveLicense/);
  assert.match(hseJs, /formHseSaveTrainingRecord/);
  assert.match(hseJs, /formHseSaveInduction/);
  assert.match(hseJs, /formHseSaveHseEvent/);
});

test('hse.js implements Fase 2 incident and safety statistics views with formulas', () => {
  assert.match(hseJs, /renderIncidentView/);
  assert.match(hseJs, /renderReportsView/);
  assert.match(hseJs, /openIncidentDetailModal/);
  assert.match(hseJs, /openCreateIncidentModal/);
  assert.match(hseJs, /openInputManhoursModal/);
  assert.match(hseJs, /5-Why Root Cause/);
  assert.match(hseJs, /Tabel Rekapitulasi Statistik Keselamatan Tambang/);
  assert.match(hseJs, /LTIFR/);
  assert.match(hseJs, /TRIR/);
  assert.match(hseJs, /Severity Rate/);
});

test('hse.js implements Fase 3 competency (SIMPER, training matrix, inductions) views and modals', () => {
  assert.match(hseJs, /renderCompetencyView/);
  assert.match(hseJs, /renderLicensesTab/);
  assert.match(hseJs, /renderTrainingMatrixTab/);
  assert.match(hseJs, /renderInductionsTab/);
  assert.doesNotMatch(hseJs, /renderSafetyTalksTab/);
  assert.match(hseJs, /openCreateLicenseModal/);
  assert.match(hseJs, /openCreateTrainingRecordModal/);
  assert.match(hseJs, /openCreateInductionModal/);
  assert.doesNotMatch(hseJs, /openCreateSafetyTalkModal/);
  assert.doesNotMatch(hseJs, /competency\/safety-talks/);
  assert.match(hseJs, /TIDAK LAYAK \(UNFIT\)/);
  assert.match(hseJs, /LAYAK \(FIT\)/);
  assert.match(hseJs, /value="BNSP"[^>]*>Sertifikasi BNSP<\/option>/);
});

test('hse.css defines Fase 2 incident and report styling classes', () => {
  assert.match(hseCss, /\.hse-incident-stats/);
  assert.match(hseCss, /\.hse-stat-pill/);
  assert.match(hseCss, /\.hse-why-chain/);
  assert.match(hseCss, /\.hse-tab-pills/);
  assert.match(hseCss, /\.hse-stat-col-rate/);
});

test('hse.css defines Fase 3 competency badge classes', () => {
  assert.match(hseCss, /\.hse-badge--valid/);
  assert.match(hseCss, /\.hse-badge--expiring/);
  assert.match(hseCss, /\.hse-badge--expired/);
  assert.match(hseCss, /\.hse-badge--unfit/);
  assert.match(hseCss, /\.hse-matrix-emp-row/);
});

test('test-fixtures/hse-preview.html is standalone and loads mock datasets matching approved layout', () => {
  assert.match(previewHtml, /id="hseRoot"/);
  assert.match(previewHtml, /mockOverview/);
  assert.match(previewHtml, /mockHazards/);
  assert.match(previewHtml, /mockActions/);
  assert.match(previewHtml, /mockIncidents/);
  assert.match(previewHtml, /mockSafetyReports/);
  assert.match(previewHtml, /mockCourses/);
  assert.match(previewHtml, /mockLicenses/);
  assert.match(previewHtml, /mockMatrix/);
  assert.match(previewHtml, /mockInductions/);
  assert.match(previewHtml, /mockP5mEvents/);
  assert.match(previewHtml, /mockStEvents/);
  assert.match(previewHtml, /mockPtwOverview/);
  assert.match(previewHtml, /mockPermits/);
  assert.match(previewHtml, /mockInspectionTemplates/);
  assert.match(previewHtml, /mockInspections/);
  assert.match(previewHtml, /window\.OMOSHSE\.load/);
});

test('hse.js implements Fase 4 PTW (permit, LOTO, SIMOPS) and Inspection views, modals, and controllers', () => {
  assert.match(hseJs, /renderPtwView/);
  assert.match(hseJs, /renderInspectionTab/);
  assert.match(hseJs, /openCreatePermitModal/);
  assert.match(hseJs, /openPermitDetailModal/);
  assert.match(hseJs, /openAddLotoModal/);
  assert.match(hseJs, /openReleaseLotoModal/);
  assert.match(hseJs, /openAddHandoverModal/);
  assert.match(hseJs, /openCreateInspectionModal/);
  assert.match(hseJs, /openInspectionDetailModal/);
  assert.match(hseJs, /PERINGATAN SIMOPS/);
  assert.match(hseJs, /KRITIKAL \(Auto-CAPA jika GAGAL\)/);
});

test('hse.css defines Fase 4 PTW, LOTO, SIMOPS, and Inspection styling classes', () => {
  assert.match(hseCss, /\.hse-badge--simops/);
  assert.match(hseCss, /\.hse-simops-alert/);
  assert.match(hseCss, /\.hse-badge--loto-locked/);
  assert.match(hseCss, /\.hse-badge--loto-released/);
  assert.match(hseCss, /\.hse-checklist-row/);
  assert.match(hseCss, /\.hse-checklist-opt/);
});

test('hse.js implements Fase 5 Occupational Health views, modals, and controllers', () => {
  assert.match(hseJs, /renderOccHealthView/);
  assert.match(hseJs, /renderOccHealthMcuTab/);
  assert.match(hseJs, /renderOccHealthFfwTab/);
  assert.match(hseJs, /renderOccHealthSubstanceTab/);
  assert.match(hseJs, /renderOccHealthCasesTab/);
  assert.match(hseJs, /renderOccHealthHygieneTab/);
  assert.match(hseJs, /openCreateMcuModal/);
  assert.match(hseJs, /openCreateFfwModal/);
  assert.match(hseJs, /openCreateSubstanceModal/);
  assert.match(hseJs, /openCreateHealthCaseModal/);
  assert.match(hseJs, /openCreateHygieneModal/);
  assert.match(hseJs, /PERINGATAN FATIGUE/);
  assert.match(hseJs, /Kadar Alkohol Breathalyzer/);
  assert.match(hseJs, /Nilai Ambang Batas \(NAB Baku Mutu\)/);
});

test('test-fixtures/hse-preview.html includes Fase 5 occupational health mock datasets and API handlers', () => {
  assert.match(previewHtml, /mockOccHealthOverview/);
  assert.match(previewHtml, /mockMcuRecords/);
  assert.match(previewHtml, /mockFfwChecks/);
  assert.match(previewHtml, /mockSubstanceTests/);
  assert.match(previewHtml, /mockHealthCases/);
  assert.match(previewHtml, /mockHygieneMeasurements/);
  assert.match(previewHtml, /\/api\/hse\/health\/overview/);
  assert.match(previewHtml, /\/api\/hse\/health\/mcu/);
  assert.match(previewHtml, /\/api\/hse\/health\/ffw/);
  assert.match(previewHtml, /\/api\/hse\/health\/substance-tests/);
  assert.match(previewHtml, /\/api\/hse\/health\/cases/);
  assert.match(previewHtml, /\/api\/hse\/health\/hygiene/);
});

test('hse.js implements Fase 6 Emergency Response and PPE views, modals, and controllers', () => {
  assert.match(hseJs, /renderEmergencyView/);
  assert.match(hseJs, /renderEmergencyTeamTab/);
  assert.match(hseJs, /renderEmergencyDrillsTab/);
  assert.match(hseJs, /renderEmergencyEquipmentTab/);
  assert.match(hseJs, /renderEmergencyAssemblyTab/);
  assert.match(hseJs, /renderEmergencyContactsTab/);
  assert.match(hseJs, /renderPpeView/);
  assert.match(hseJs, /renderPpeIssuancesTab/);
  assert.match(hseJs, /renderPpeStandardsTab/);
  assert.match(hseJs, /renderPpeItemsTab/);
  assert.match(hseJs, /openCreateErtMemberModal/);
  assert.match(hseJs, /openCreateDrillModal/);
  assert.match(hseJs, /openCreateEquipmentModal/);
  assert.match(hseJs, /openCreateAssemblyPointModal/);
  assert.match(hseJs, /openCreateEmergencyContactModal/);
  assert.match(hseJs, /openCreatePpeItemModal/);
  assert.match(hseJs, /openCreatePpeStandardModal/);
  assert.match(hseJs, /openCreatePpeIssuanceModal/);
});

test('hse.css defines Fase 6 ERT, Emergency, and PPE styling classes', () => {
  assert.match(hseCss, /\.hse-ert-grid/);
  assert.match(hseCss, /\.hse-ert-card/);
  assert.match(hseCss, /\.hse-ert-role-badge/);
  assert.match(hseCss, /\.hse-contact-grid/);
  assert.match(hseCss, /\.hse-contact-card/);
  assert.match(hseCss, /\.hse-stock-pill/);
});

test('test-fixtures/hse-preview.html includes Fase 6 Emergency and PPE mock datasets and API handlers', () => {
  assert.match(previewHtml, /mockEmergencyOverview/);
  assert.match(previewHtml, /mockEmergencyTeam/);
  assert.match(previewHtml, /mockEmergencyDrills/);
  assert.match(previewHtml, /mockEmergencyEquipment/);
  assert.match(previewHtml, /mockAssemblyPoints/);
  assert.match(previewHtml, /mockEmergencyContacts/);
  assert.match(previewHtml, /mockPpeOverview/);
  assert.match(previewHtml, /mockPpeItems/);
  assert.match(previewHtml, /mockPpeStandards/);
  assert.match(previewHtml, /mockPpeIssuances/);
  assert.match(previewHtml, /\/api\/hse\/emergency\/overview/);
  assert.match(previewHtml, /\/api\/hse\/emergency\/team/);
  assert.match(previewHtml, /\/api\/hse\/emergency\/drills/);
  assert.match(previewHtml, /\/api\/hse\/emergency\/equipment/);
  assert.match(previewHtml, /\/api\/hse\/emergency\/assembly-points/);
  assert.match(previewHtml, /\/api\/hse\/emergency\/contacts/);
  assert.match(previewHtml, /\/api\/hse\/ppe\/overview/);
  assert.match(previewHtml, /\/api\/hse\/ppe\/items/);
  assert.match(previewHtml, /\/api\/hse\/ppe\/standards/);
  assert.match(previewHtml, /\/api\/hse\/ppe\/issuances/);
});

test('hse.js implements Fase 7 Contractor (CSMS) and Environment views, modals, and controllers', () => {
  assert.match(hseJs, /renderContractorView/);
  assert.match(hseJs, /renderContractorCompaniesTab/);
  assert.match(hseJs, /renderContractorAssessmentsTab/);
  assert.match(hseJs, /renderContractorDocumentsTab/);
  assert.match(hseJs, /renderContractorViolationsTab/);
  assert.match(hseJs, /renderEnvironmentView/);
  assert.match(hseJs, /renderEnvironmentWasteTab/);
  assert.match(hseJs, /renderEnvironmentMonitoringTab/);
  assert.match(hseJs, /renderEnvironmentReclamationTab/);
  assert.match(hseJs, /openCreateContractorModal/);
  assert.match(hseJs, /openCreateContractorAssessmentModal/);
  assert.match(hseJs, /openCreateContractorDocModal/);
  assert.match(hseJs, /openCreateContractorViolationModal/);
  assert.match(hseJs, /openCreateWasteB3Modal/);
  assert.match(hseJs, /openCreateEnvPointModal/);
  assert.match(hseJs, /openCreateEnvMeasurementModal/);
  assert.match(hseJs, /openCreateReclamationModal/);
});

test('hse.css defines Fase 7 CSMS, Contractor, and Environment styling classes', () => {
  assert.match(hseCss, /\.hse-csms-badge/);
  assert.match(hseCss, /\.hse-ctr-grid/);
  assert.match(hseCss, /\.hse-ctr-card/);
  assert.match(hseCss, /\.hse-env-status/);
  assert.match(hseCss, /\.hse-progress-track/);
  assert.match(hseCss, /\.hse-progress-fill/);
});

test('test-fixtures/hse-preview.html includes Fase 7 Contractor and Environment mock datasets and API handlers', () => {
  assert.match(previewHtml, /mockContractorOverview/);
  assert.match(previewHtml, /mockContractors/);
  assert.match(previewHtml, /mockContractorAssessments/);
  assert.match(previewHtml, /mockContractorDocuments/);
  assert.match(previewHtml, /mockContractorViolations/);
  assert.match(previewHtml, /mockEnvironmentOverview/);
  assert.match(previewHtml, /mockWasteB3Logs/);
  assert.match(previewHtml, /mockEnvPoints/);
  assert.match(previewHtml, /mockEnvParameters/);
  assert.match(previewHtml, /mockEnvMeasurements/);
  assert.match(previewHtml, /mockReclamationRecords/);
  assert.match(previewHtml, /\/api\/hse\/contractors\/overview/);
  assert.match(previewHtml, /\/api\/hse\/contractors\/assessments/);
  assert.match(previewHtml, /\/api\/hse\/contractors\/documents/);
  assert.match(previewHtml, /\/api\/hse\/contractors\/violations/);
  assert.match(previewHtml, /\/api\/hse\/contractors/);
  assert.match(previewHtml, /\/api\/hse\/environment\/overview/);
  assert.match(previewHtml, /\/api\/hse\/environment\/waste-b3/);
  assert.match(previewHtml, /\/api\/hse\/environment\/points/);
  assert.match(previewHtml, /\/api\/hse\/environment\/parameters/);
  assert.match(previewHtml, /\/api\/hse\/environment\/measurements/);
  assert.match(previewHtml, /\/api\/hse\/environment\/reclamation/);
});

test('hse.js implements Fase 8 Audit, SMKP Minerba, Documents, and Legal Register views and modals', () => {
  assert.match(hseJs, /renderAuditView/);
  assert.match(hseJs, /renderAuditProgramTab/);
  assert.match(hseJs, /renderAuditFindingsTab/);
  assert.match(hseJs, /renderAuditSmkpTab/);
  assert.match(hseJs, /renderDocumentsView/);
  assert.match(hseJs, /renderDocumentsTab/);
  assert.match(hseJs, /renderRegulationsTab/);
  assert.match(hseJs, /renderMandatoryReportsTab/);
  assert.match(hseJs, /openCreateAuditModal/);
  assert.match(hseJs, /openCreateAuditFindingModal/);
  assert.match(hseJs, /openResolveAuditFindingModal/);
  assert.match(hseJs, /openCreateDocumentModal/);
  assert.match(hseJs, /openCreateDocumentRevisionModal/);
  assert.match(hseJs, /openCreateLegalRegisterModal/);
  assert.match(hseJs, /openCreateMandatoryReportModal/);
  assert.match(hseJs, /openUpdateMandatoryReportModal/);
  assert.match(hseJs, /Standar Evaluasi SMKP Minerba \(Permen ESDM No\. 26\/2018\)/);
});

test('hse.css defines Fase 8 SMKP, Finding, Document Revision, and Legal Status styling classes', () => {
  assert.match(hseCss, /\.hse-smkp-grid/);
  assert.match(hseCss, /\.hse-smkp-card/);
  assert.match(hseCss, /\.hse-smkp-card-title/);
  assert.match(hseCss, /\.hse-finding-pill/);
  assert.match(hseCss, /\.hse-doc-rev-badge/);
  assert.match(hseCss, /\.hse-legal-status/);
});

test('test-fixtures/hse-preview.html includes Fase 8 Audit, SMKP, and Documents mock datasets and API handlers', () => {
  assert.match(previewHtml, /mockAuditOverview/);
  assert.match(previewHtml, /mockSmkpElements/);
  assert.match(previewHtml, /mockAudits/);
  assert.match(previewHtml, /mockAuditFindings/);
  assert.match(previewHtml, /mockDocsOverview/);
  assert.match(previewHtml, /mockDocuments/);
  assert.match(previewHtml, /mockLegalRegister/);
  assert.match(previewHtml, /mockMandatoryReports/);
  assert.match(previewHtml, /\/api\/hse\/audits\/overview/);
  assert.match(previewHtml, /\/api\/hse\/audits\/smkp-elements/);
  assert.match(previewHtml, /\/api\/hse\/audits\/findings/);
  assert.match(previewHtml, /\/api\/hse\/audits/);
  assert.match(previewHtml, /\/api\/hse\/docs\/overview/);
  assert.match(previewHtml, /\/api\/hse\/docs/);
  assert.match(previewHtml, /\/api\/hse\/legal-register/);
  assert.match(previewHtml, /\/api\/hse\/mandatory-reports/);
});

test('hse.css defines big screen mode (TV Pos HSE) and print layout styling classes', () => {
  assert.match(hseCss, /\.hse-big-screen-container/);
  assert.match(hseCss, /\.hse-tv-header/);
  assert.match(hseCss, /\.hse-tv-badge-live/);
  assert.match(hseCss, /\.hse-tv-hero/);
  assert.match(hseCss, /\.hse-tv-hero-number/);
  assert.match(hseCss, /\.hse-tv-metrics-grid/);
  assert.match(hseCss, /\.hse-tv-card/);
  assert.match(hseCss, /\.hse-tv-ticker/);
  assert.match(hseCss, /\.hse-print-doc/);
  assert.match(hseCss, /\.hse-print-header/);
  assert.match(hseCss, /\.hse-print-table/);
  assert.match(hseCss, /\.hse-print-signatures/);
  assert.match(hseCss, /\.hse-print-sign-box/);
  assert.match(hseCss, /@media print/);
  assert.match(hseCss, /\.hse-print-area/);
});

test('hse.js implements Big Screen Mode (TV Briefing Pos HSE) and standard print modals', () => {
  assert.match(hseJs, /id="btnHseBigScreen"/);
  assert.match(hseJs, /id="btnHsePrintDocSelector"/);
  assert.match(hseJs, /renderBigScreenMode/);
  assert.match(hseJs, /formatBigScreenClock/);
  assert.match(hseJs, /startBigScreenTimers/);
  assert.match(hseJs, /stopBigScreenTimers/);
  assert.match(hseJs, /toggleBigScreenMode/);
  assert.match(hseJs, /openPrintSelectorModal/);
  assert.match(hseJs, /openPrintPtwModal/);
  assert.match(hseJs, /openPrintIncidentModal/);
  assert.match(hseJs, /openPrintMonthlyReportModal/);
  assert.match(hseJs, /PUSAT KOMANDO K3L &amp; P5M TAMBANG/);
  assert.match(hseJs, /SURAT IZIN KERJA KHUSUS \/ BERISIKO TINGGI \(PERMIT TO WORK\)/);
  assert.match(hseJs, /LAPORAN INVESTIGASI KECELAKAAN PERTAMBANGAN \(ESDM \/ SMKP MINERBA\)/);
  assert.match(hseJs, /LAPORAN KINERJA KESELAMATAN PERTAMBANGAN \(MONTHLY HSE PERFORMANCE REPORT\)/);
  assert.match(hseJs, /window\.addEventListener\('keydown'/);
});

test('hse.js, hse.css, and preview fixture implement IBPR / HIRADC risk register and 5x5 interactive matrix', () => {
  // CSS styling
  assert.match(hseCss, /\.hse-matrix-container/);
  assert.match(hseCss, /\.hse-matrix-table/);
  assert.match(hseCss, /\.hse-matrix-cell/);
  assert.match(hseCss, /\.hse-matrix-cell--extreme/);
  assert.match(hseCss, /\.hse-matrix-cell--high/);
  assert.match(hseCss, /\.hse-matrix-cell--medium/);
  assert.match(hseCss, /\.hse-matrix-cell--low/);
  assert.match(hseCss, /\.hse-matrix-cell\.is-selected/);
  assert.match(hseCss, /\.hse-hierarchy-badge--elimination/);
  assert.match(hseCss, /\.hse-hierarchy-badge--substitution/);
  assert.match(hseCss, /\.hse-hierarchy-badge--engineering/);
  assert.match(hseCss, /\.hse-hierarchy-badge--administrative/);
  assert.match(hseCss, /\.hse-hierarchy-badge--ppe/);

  // Frontend controller & views
  assert.match(hseJs, /renderRiskRegisterTab/);
  assert.match(hseJs, /openCreateRiskModal/);
  assert.match(hseJs, /openRiskDetailModal/);
  assert.match(hseJs, /loadRiskRegisterData/);
  assert.match(hseJs, /data-risk-cell-l/);
  assert.match(hseJs, /id="btnHseResetRiskMatrixCell"/);
  assert.match(hseJs, /id="btnHseOpenCreateRisk"/);
  assert.match(hseJs, /formHseCreateRisk/);
  assert.match(hseJs, /api\('\/risk-register\/overview'\)/);
  assert.match(hseJs, /api\('\/risk-register/);

  // Preview fixture mock endpoints
  assert.match(previewHtml, /mockRiskRegister/);
  assert.match(previewHtml, /mockRiskOverview/);
  assert.match(previewHtml, /\/api\/hse\/risk-register\/overview/);
  assert.match(previewHtml, /\/api\/hse\/risk-register/);
});

test('hse.js, hse.css, and preview fixture implement Setup Master (Hierarki Area & Sub Area) with split-panel layout and optgroup options', () => {
  // CSS layout & styling
  assert.match(hseCss, /\.hse-setup-layout/);
  assert.match(hseCss, /\.hse-setup-col/);
  assert.match(hseCss, /\.hse-setup-area-card/);
  assert.match(hseCss, /\.hse-setup-area-card\.is-active/);
  assert.match(hseCss, /\.hse-setup-badge-count/);
  assert.match(hseCss, /\.hse-setup-detail-banner/);

  // Frontend controller, metadata, views, modals
  assert.match(hseJs, /setup:\s*\{\s*label:\s*'Setup master'/);
  assert.match(hseJs, /loadSetupLocations/);
  assert.match(hseJs, /renderSetupLocationsView/);
  assert.match(hseJs, /openParentAreaModal/);
  assert.match(hseJs, /openSubAreaModal/);
  assert.match(hseJs, /deleteLocationItem/);
  assert.match(hseJs, /renderLocationHierarchyOptions/);
  assert.match(hseJs, /api\('\/locations\/tree'\)/);
  assert.match(hseJs, /id="btnHseAddParentArea"/);
  assert.match(hseJs, /id="btnHseAddSubArea"/);

  // Preview fixture mock endpoints
  assert.match(previewHtml, /mockLocationsList/);
  assert.match(previewHtml, /\/api\/hse\/locations\/tree/);
  assert.match(previewHtml, /\/api\/hse\/locations/);
});

test('hse.js, hse.css, and preview fixture implement Setup Master Inspeksi (Templat, Mandat Kewajiban Karyawan, dan Jadwal Objek)', () => {
  // CSS layout & styling tokens
  assert.match(hseCss, /\.hse-segmented-control/);
  assert.match(hseCss, /\.hse-segmented-btn/);
  assert.match(hseCss, /\.hse-stats-bar/);
  assert.match(hseCss, /\.hse-stat-card/);
  assert.match(hseCss, /\.hse-stat-val/);

  // Frontend controller & renderers
  assert.match(hseJs, /renderSetupView/);
  assert.match(hseJs, /renderSetupInspectionsView/);
  assert.match(hseJs, /renderSetupInspectionTemplatesTab/);
  assert.match(hseJs, /renderSetupInspectionMandatesTab/);
  assert.match(hseJs, /renderSetupInspectionSchedulesTab/);
  assert.match(hseJs, /loadSetupInspectionsData/);

  // Modals & form operations
  assert.match(hseJs, /openAddInspectionTemplateModal/);
  assert.match(hseJs, /openSetRoleMandateModal/);
  assert.match(hseJs, /openSetIndividualOverrideModal/);
  assert.match(hseJs, /openAddInspectionScheduleModal/);
  assert.match(hseJs, /deactivateInspectionTemplateAction/);
  assert.match(hseJs, /deactivateInspectionScheduleAction/);

  // Interactive UI elements
  assert.match(hseJs, /id="btnHseAddInspTemplate"/);
  assert.match(hseJs, /id="btnHseSetRoleMandate"/);
  assert.match(hseJs, /id="btnHseSetEmpOverride"/);
  assert.match(hseJs, /id="btnHseAddInspSchedule"/);
  assert.match(hseJs, /data-setup-tab/);
  assert.match(hseJs, /data-insp-subtab/);

  // Endpoints consumption
  assert.match(hseJs, /api\(`\/inspections\/templates/);
  assert.match(hseJs, /api\(`\/inspections\/mandates\/overview/);
  assert.match(hseJs, /endpoint: '\/inspections\/targets'/);
  assert.match(hseJs, /api\(`\/inspections\/schedules/);

  // Preview fixture mock endpoints
  assert.match(previewHtml, /mockInspectionTemplates/);
  assert.match(previewHtml, /mockInspectionTargets/);
  assert.match(previewHtml, /mockInspectionSchedules/);
  assert.match(previewHtml, /\/api\/hse\/inspections\/templates/);
  assert.match(previewHtml, /\/api\/hse\/inspections\/mandates\/overview/);
  assert.match(previewHtml, /\/api\/hse\/inspections\/schedules/);
});

test('hse.js and preview fixture implement Setup Hazard Report tab (matriks kewajiban pelaporan)', () => {
  // Tab-level navigation (tanpa sub-tab jenis/jadwal)
  assert.match(hseJs, /data-setup-tab="hazard"/);
  assert.match(hseJs, /Setup Hazard Report/);
  assert.match(hseJs, /renderSetupHazardView/);
  assert.match(hseJs, /renderSetupHazardMandatesTab/);
  assert.match(hseJs, /loadSetupHazardData/);

  // Modals & form operations (cerminan Kewajiban Karyawan)
  assert.match(hseJs, /openSetHzRoleMandateModal/);
  assert.match(hseJs, /openSetHzIndividualOverrideModal/);
  assert.match(hseJs, /openHzPersonnelScopeModal/);

  // Interactive UI elements
  assert.match(hseJs, /id="btnHseSetHzRoleMandate"/);
  assert.match(hseJs, /id="btnHseSetHzEmpOverride"/);
  assert.match(hseJs, /id="btnHseHzPersonnelScope"/);
  assert.match(hseJs, /id="selHseHzMandateFilterDept"/);
  assert.match(hseJs, /id="selHseHzMandateFilterStatus"/);
  assert.match(hseJs, /id="inHseHzMandateSearch"/);
  assert.match(hseJs, /btn-hz-emp-override/);

  // Save actions memakai shared feedback helper (aturan admin-dashboard)
  assert.match(hseJs, /runHseActionFeedback/);

  // Endpoints consumption
  assert.match(hseJs, /api\(`\/hazard\/mandates\/overview/);
  assert.match(hseJs, /endpoint: '\/hazard\/targets'/);
  assert.match(hseJs, /api\('\/hazard\/mandates\/scope'/);

  // Preview fixture mock endpoints
  assert.match(previewHtml, /mockHazardReportTargets/);
  assert.match(previewHtml, /mockHazardReportScope/);
  assert.match(previewHtml, /\/api\/hse\/hazard\/mandates\/overview/);
  assert.match(previewHtml, /\/api\/hse\/hazard\/targets/);
  assert.match(previewHtml, /\/api\/hse\/hazard\/mandates\/scope/);

  // Tombol primer: hover harus warna solid lebih gelap (kontras), bukan opacity
  assert.match(hseCss, /\.hse-btn--primary:hover\s*\{[^}]*background:\s*#[0-9a-fA-F]{6}/);
  assert.doesNotMatch(hseCss, /\.hse-btn--primary:hover\s*\{[^}]*opacity/);
});

test('hse.js and preview fixture implement Setup P5M and Setup Safety Talk tabs', () => {
  // Tab-level navigation
  assert.match(hseJs, /data-setup-tab="p5m"/);
  assert.match(hseJs, /data-setup-tab="safetytalk"/);
  assert.match(hseJs, /Setup P5M/);
  assert.match(hseJs, /Setup Safety Talk/);
  assert.match(hseJs, /renderSetupP5mView/);
  assert.match(hseJs, /renderSetupP5mMandatesTab/);
  assert.match(hseJs, /renderSetupStView/);
  assert.match(hseJs, /renderSetupStMandatesTab/);
  assert.match(hseJs, /loadSetupP5mData/);
  assert.match(hseJs, /loadSetupStData/);

  // Modals & form operations
  assert.match(hseJs, /openSetP5mRoleMandateModal/);
  assert.match(hseJs, /openSetP5mIndividualOverrideModal/);
  assert.match(hseJs, /openP5mPersonnelScopeModal/);
  assert.match(hseJs, /openSetStRoleMandateModal/);
  assert.match(hseJs, /openSetStIndividualOverrideModal/);
  assert.match(hseJs, /openStPersonnelScopeModal/);

  // Interactive UI elements
  assert.match(hseJs, /id="btnHseSetP5mRoleMandate"/);
  assert.match(hseJs, /id="btnHseSetP5mEmpOverride"/);
  assert.match(hseJs, /id="btnHseP5mPersonnelScope"/);
  assert.match(hseJs, /id="btnHseSetStRoleMandate"/);
  assert.match(hseJs, /id="btnHseSetStEmpOverride"/);
  assert.match(hseJs, /id="btnHseStPersonnelScope"/);
  assert.match(hseJs, /btn-p5m-emp-override/);
  assert.match(hseJs, /btn-st-emp-override/);

  // Endpoints consumption
  assert.match(hseJs, /api\(`\/p5m\/mandates\/overview/);
  assert.match(hseJs, /endpoint: '\/p5m\/targets'/);
  assert.match(hseJs, /api\('\/p5m\/mandates\/scope'/);
  assert.match(hseJs, /api\(`\/safetytalk\/mandates\/overview/);
  assert.match(hseJs, /endpoint: '\/safetytalk\/targets'/);
  assert.match(hseJs, /api\('\/safetytalk\/mandates\/scope'/);

  // Preview fixture mock endpoints
  assert.match(previewHtml, /mockP5mTargets/);
  assert.match(previewHtml, /mockP5mScope/);
  assert.match(previewHtml, /mockStTargets/);
  assert.match(previewHtml, /mockStScope/);
  assert.match(previewHtml, /\/api\/hse\/p5m\/mandates\/overview/);
  assert.match(previewHtml, /\/api\/hse\/p5m\/targets/);
  assert.match(previewHtml, /\/api\/hse\/safetytalk\/mandates\/overview/);
  assert.match(previewHtml, /\/api\/hse\/safetytalk\/targets/);
});

test('hse.js implements multi-select ceklist for mandate & override modals (4 tab Setup HSE)', () => {
  // Komponen reusable dropdown ceklist multi-pilih
  assert.match(hseJs, /function bindHseMultiSelect\(/);
  assert.match(hseJs, /function hseMsTriggerHtml\(/);
  assert.match(hseJs, /hse-ms-trigger/);
  assert.match(hseJs, /hse-ms-panel/);
  assert.match(hseJs, /hse-ms-cb/);
  assert.match(hseJs, /Pilih Semua/);
  assert.match(hseJs, /Kosongkan/);
  assert.match(hseJs, /hse-ms-search/);

  // Modal bersama & loop batch + kompensasi DELETE
  assert.match(hseJs, /function openHseRoleMandateModalShared\(/);
  assert.match(hseJs, /function openHseOverrideModalShared\(/);
  assert.match(hseJs, /async function saveHseMandateBatch\(/);
  assert.match(hseJs, /Tidak ada aturan tersimpan/);
  assert.match(hseJs, /method: 'DELETE'/);

  // Konfirmasi ringkasan bila jumlah pilihan > 1
  assert.match(hseJs, /window\.confirm\(/);
  assert.match(hseJs, /Simpan \$\{combos\.length\} aturan sekaligus\?/);
  assert.match(hseJs, /Terapkan override ke \$\{empIds\.length\} karyawan sekaligus\?/);

  // "Semua Departemen" mutual-exclusive (tanpa centang = semua)
  assert.match(hseJs, /label: 'Semua Departemen'/);
  assert.match(hseJs, /isAllNone\(\)/);

  // 8 modal lama kini wrapper tipis ke shared — nama & wiring tetap
  assert.match(hseJs, /function openSetRoleMandateModal\(\) \{\s*openHseRoleMandateModalShared\('inspection'\);/);
  assert.match(hseJs, /function openSetHzRoleMandateModal\(\) \{\s*openHseRoleMandateModalShared\('hazard'\);/);
  assert.match(hseJs, /function openSetP5mRoleMandateModal\(\) \{\s*openHseRoleMandateModalShared\('p5m'\);/);
  assert.match(hseJs, /function openSetStRoleMandateModal\(\) \{\s*openHseRoleMandateModalShared\('safetytalk'\);/);
  assert.match(hseJs, /function openSetIndividualOverrideModal\(preselectedEmployeeId = null\) \{\s*openHseOverrideModalShared\('inspection', preselectedEmployeeId\);/);
  assert.match(hseJs, /function openSetHzIndividualOverrideModal\(preselectedEmployeeId = null\) \{\s*openHseOverrideModalShared\('hazard', preselectedEmployeeId\);/);
  assert.match(hseJs, /function openSetP5mIndividualOverrideModal\(preselectedEmployeeId = null\) \{\s*openHseOverrideModalShared\('p5m', preselectedEmployeeId\);/);
  assert.match(hseJs, /function openSetStIndividualOverrideModal\(preselectedEmployeeId = null\) \{\s*openHseOverrideModalShared\('safetytalk', preselectedEmployeeId\);/);

  // Endpoint batch per tab di konfigurasi shared (loop POST per kombinasi)
  assert.match(hseJs, /endpoint: '\/inspections\/targets'/);
  assert.match(hseJs, /endpoint: '\/hazard\/targets'/);
  assert.match(hseJs, /endpoint: '\/p5m\/targets'/);
  assert.match(hseJs, /endpoint: '\/safetytalk\/targets'/);

  // Validasi minimal 1 pilihan (jabatan / karyawan)
  assert.match(hseJs, /Pilih minimal satu jabatan\./);
  assert.match(hseJs, /Pilih minimal satu karyawan\./);

  // Save tetap lewat shared feedback helper (kunci tombol anti double-submit)
  assert.match(hseJs, /runHseActionFeedback\(form, async \(\) => \{\s*await saveHseMandateBatch/);
});

test('hse.js implements P5M and Safety Talk event tabs in Hazard dan Inspeksi with dedupe merge and WAJIB-only form', () => {
  // Subnav tabs (setelah Inspeksi) & dispatcher
  assert.match(hseJs, /data-hazard-tab="p5m"/);
  assert.match(hseJs, /data-hazard-tab="safetytalk"/);
  assert.match(hseJs, /function renderHseEventTab\(/);
  assert.match(hseJs, /function loadHseEvents\(/);

  // Kolom & filter tabel
  assert.match(hseJs, /data-ev-filter/);
  assert.match(hseJs, /Area \/ Lokasi/);
  assert.match(hseJs, /duplikat/);

  // Tombol aksi baris
  assert.match(hseJs, /data-btn-hse-add-event/);
  assert.match(hseJs, /data-btn-hse-event-detail/);
  assert.match(hseJs, /data-btn-hse-event-edit/);
  assert.match(hseJs, /data-btn-hse-event-delete/);
  assert.match(hseJs, /data-btn-hse-event-merge/);

  // Modals & form
  assert.match(hseJs, /function openHseEventFormModal\(/);
  assert.match(hseJs, /function openHseEventDetailModal\(/);
  assert.match(hseJs, /function openHseEventMergeModal\(/);
  assert.match(hseJs, /async function deleteHseEventAction\(/);
  assert.match(hseJs, /id="formHseSaveHseEvent"/);
  assert.match(hseJs, /id="formHseMergeEvent"/);

  // Form hanya menerima karyawan WAJIB; blokir + shortcut bila 0 WAJIB
  assert.match(hseJs, /Belum ada karyawan berstatus/);
  assert.match(hseJs, /data-btn-hse-event-goto-setup/);
  assert.match(hseJs, /hanya karyawan berstatus WAJIB/);

  // Semua aksi simpan memakai shared feedback helper (aturan admin-dashboard)
  assert.match(hseJs, /runHseActionFeedback/);

  // Endpoints consumption
  assert.match(hseJs, /hseEventBase\(kind\)/);
  assert.match(hseJs, /events\/\$\{targetId\}\/merge/);
  assert.match(hseJs, /mandates\/overview\?status=WAJIB/);

  // Preview fixture mock datasets & endpoints
  assert.match(previewHtml, /mockP5mEvents/);
  assert.match(previewHtml, /mockStEvents/);
  assert.match(previewHtml, /\/api\/hse\/p5m\/events/);
  assert.match(previewHtml, /\/api\/hse\/safetytalk\/events/);
  assert.match(previewHtml, /shift-siang/);
  assert.match(previewHtml, /mockMasters = \{[\s\S]*?shifts:/);

  // Tab lama di Kompetensi sudah dihapus (dipindah ke Hazard dan Inspeksi)
  assert.doesNotMatch(previewHtml, /competency\/safety-talks/);
});

test('hse.js and preview fixture implement unified Inspection Field sub-views (History, Tasks, Compliance)', () => {
  // Sub-view renderers
  assert.match(hseJs, /renderInspectionHistoryList/);
  assert.match(hseJs, /renderInspectionDueTasksList/);
  assert.match(hseJs, /renderInspectionComplianceTab/);
  assert.match(hseJs, /data-insp-view/);
  assert.match(hseJs, /btn-start-scheduled-inspection/);
  assert.match(hseJs, /selHseComplianceMonth/);
  assert.match(hseJs, /selHseComplianceYear/);

  // Pre-fill schedule in modal
  assert.match(hseJs, /openCreateInspectionModal/);
  assert.match(hseJs, /preselectedSchedule/);
  assert.match(hseJs, /schedule_id/);

  // Compliance API mock fixture
  assert.match(previewHtml, /\/api\/hse\/inspections\/compliance/);
});

test('hse.js implements client-side compressed hazard photo upload, manual admin edit modal, and full cascade delete action', () => {
  assert.match(hseJs, /function compressHazardImage\(/);
  assert.match(hseJs, /function bindPhotoAttachmentController\(/);
  assert.match(hseJs, /id="inHzPhotos"/);
  assert.match(hseJs, /id="inHzPhotoPreviewList"/);
  assert.match(hseJs, /async function openEditHazardModal\(/);
  assert.match(hseJs, /id="formHseEditHazard"/);
  assert.match(hseJs, /id="inHzEditPhotos"/);
  assert.match(hseJs, /async function deleteHazardAction\(/);
  assert.match(hseJs, /data-btn-hazard-edit/);
  assert.match(hseJs, /data-btn-hazard-delete/);
});

test('hse.js implements inspection attachments: mandatory photo + optional documents in create form', () => {
  assert.match(hseJs, /id="inInsPhotos"/);
  assert.match(hseJs, /id="inInsPhotoPreviewList"/);
  assert.match(hseJs, /id="inInsDocs"/);
  assert.match(hseJs, /id="inInsDocList"/);
  assert.match(hseJs, /Inspeksi wajib memiliki minimal 1 foto/);
  assert.match(hseJs, /const photos = insPhotoCtrl\.getPhotos\(\)/);
  assert.match(hseJs, /documents: insDocCtrl\.getDocuments\(\)/);
  assert.match(hseJs, /function bindPhotoAttachmentController\(fileInputId, previewContainerId, initialPhotos = \[\], onChange = null\)/);
  assert.match(hseJs, /function bindDocumentAttachmentController\(/);
  assert.match(hseJs, /function readInspectionDocumentFile\(/);
  assert.match(hseJs, /function hseDownloadDataUrl\(/);
  assert.match(hseJs, /const HSE_DOC_TYPES/);
  assert.match(hseJs, /const HSE_MAX_DOCUMENTS = 3/);
  assert.match(hseJs, /const HSE_MAX_DOCUMENT_BYTES/);
});

test('hse.js implements staged detail inspection lampiran edit with save, popup guard, and beforeunload', () => {
  assert.match(hseJs, /id="inInsDetailPhotos"/);
  assert.match(hseJs, /id="inInsDetailPhotoList"/);
  assert.match(hseJs, /id="inInsDetailDocs"/);
  assert.match(hseJs, /id="inInsDetailDocList"/);
  assert.match(hseJs, /id="btnHseInsSaveLampiran"/);
  assert.match(hseJs, /id="btnHseInsDetailClose"/);
  assert.match(hseJs, /id="hseInsLampiranError"/);
  assert.match(hseJs, /id="hseInsLampiranDirtyHint"/);
  assert.match(hseJs, /id="hseInsPhotoCount"/);
  assert.match(hseJs, /let dirty = false/);
  assert.match(hseJs, /saveBtn\.disabled = !\(dirty && photos\.length > 0\)/);
  assert.match(hseJs, /method: 'PUT',\s*\n\s*body: \{ photos, documents: docCtrl\.getDocuments\(\) \}/);
  assert.match(hseJs, /global\.addEventListener\('beforeunload', onBeforeUnload\)/);
  assert.match(hseJs, /global\.removeEventListener\('beforeunload', onBeforeUnload\)/);
  assert.match(hseJs, /Tinggalkan tanpa simpan\?/);
  assert.match(hseJs, /runHseActionFeedback\(saveBtn, work\)/);
});

test('preview fixture exposes inspection attachment mocks and PUT lampiran handler', () => {
  assert.match(previewHtml, /const MOCK_INSP_PNG/);
  assert.match(previewHtml, /const MOCK_INSP_PDF/);
  assert.match(previewHtml, /photos: \[MOCK_INSP_PNG\]/);
  assert.match(previewHtml, /documents: \[\{ name: 'laporan-p2h-oktober\.pdf'/);
  assert.match(previewHtml, /if \(!Array\.isArray\(body\.photos\) \|\| body\.photos\.length === 0\)/);
  assert.match(previewHtml, /urlStr\.includes\('\/api\/hse\/inspections\/'\) && urlStr\.includes\('\/lampiran'\)/);
  assert.match(previewHtml, /found\.photos = body\.photos/);
  assert.match(previewHtml, /found\.documents = Array\.isArray\(body\.documents\) \? body\.documents : \[\]/);
  assert.match(previewHtml, /Inspeksi wajib memiliki minimal 1 foto/);
});





test('Setup Master memiliki tab Jam Kerja Karyawan dengan 3 sub-tab dan dropdown checklist', () => {
  assert.match(hseJs, /data-setup-tab="workhours"/);
  assert.match(hseJs, /Jam Kerja Karyawan/);
  assert.match(hseJs, /data-wh-subtab="positions"/);
  assert.match(hseJs, /data-wh-subtab="employees"/);
  assert.match(hseJs, /data-wh-subtab="recap"/);
  assert.match(hseJs, /function whMultiSelect\(/);
  assert.match(hseJs, /msHseWhPos/);
  assert.match(hseJs, /msHseWhDept/);
  assert.match(hseJs, /msHseWhEmp/);
  assert.match(hseJs, /\/workhours\/standards\/role/);
  assert.match(hseJs, /\/workhours\/standards\/employee/);
  assert.match(hseJs, /\/workhours\/periods\/\$\{encodeURIComponent\(monthKey\)\}\/send/);
  assert.match(hseCss, /\.hse-wh-ms-pop/);
  assert.match(hseCss, /\.hse-wh-kpis/);
});

test('Statistik keselamatan memakai jam kerja terintegrasi (tanpa angka jam kerja statis)', () => {
  assert.doesNotMatch(hseJs, /2\.845\.200/);
  assert.doesNotMatch(hseJs, /178\.400 Man-Hours/);
  assert.match(hseJs, /o\.workhours\.safeManhours/);
  assert.match(hseJs, /HSE_HOURS_STATUS/);
  assert.match(hseJs, /Input Jam Kerja Kontraktor/);
  assert.match(hseJs, /rep\.summary\?\.ytd/);
});
