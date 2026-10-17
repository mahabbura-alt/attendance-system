'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ProductionController = require('../src/controllers/production.controller');

const masterJobs = [
  { job_code: 'OB', job_desc: 'Overburden Removal' },
  { job_code: 'CG', job_desc: 'Coal Getting' },
  { job_code: 'GNR', job_desc: 'General' },
];

test('fleet catalog HTTP handler is not overwritten by its data builder export', () => {
  assert.equal(typeof ProductionController.getFleetPlanCatalog, 'function');
  assert.equal(typeof ProductionController.buildFleetPlanCatalogData, 'function');
  assert.notEqual(ProductionController.getFleetPlanCatalog, ProductionController.buildFleetPlanCatalogData);
});

test('legacy SPO job labels map to canonical Master JOB codes', () => {
  assert.equal(ProductionController.resolvePlanningJob('OB Removal', masterJobs)?.job_code, 'OB');
  assert.equal(ProductionController.resolvePlanningJob('Coal Getting', masterJobs)?.job_code, 'CG');
  assert.equal(ProductionController.resolvePlanningJob('GNR', masterJobs)?.job_code, 'GNR');
});

test('deployed SPO jobs are read from planningData v5 only when deployed', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM productivity_plans')) return { rows: [{ data_json: {
        deployedJobs: [{ jobCode: 'OB', jobDescription: 'Overburden Removal' }],
        tables: { draft: { jobCode: 'GNR', deployed: false } },
      }, content_html: '' }] };
      return { rows: masterJobs };
    },
  };
  assert.deepEqual([...(await ProductionController.getDeployedSpoJobCodes(db))], ['OB']);
});

test('deployed SPO JOB endpoint data returns canonical codes with descriptions', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM productivity_plans')) return { rows: [{ data_json: {
        deployedJobs: [{ jobCode: 'CG', jobDescription: 'Coal Getting' }],
      }, content_html: '' }] };
      return { rows: masterJobs };
    },
  };
  assert.deepEqual(await ProductionController.buildDeployedSpoJobsData(db), [
    { jobCode: 'CG', jobDescription: 'Coal Getting', productionMode: 'prod',
      materialType: 'coal', classificationSource: 'legacy_default', materialTypeSource: 'legacy_default',
      classificationConflict: false, materialTypeConflict: false },
  ]);
});

test('hanya SPO Deployed berklasifikasi Prod menjadi sumber modul produksi', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM productivity_plans')) return { rows: [{ data_json: {
        version: 6,
        tables: {
          ob: { jobCode: 'OB', deployed: true, productionMode: 'prod' },
          cg: { jobCode: 'CG', deployed: true, productionMode: 'prod' },
          general: { jobCode: 'GNR', deployed: true, productionMode: 'non_prod' },
        },
      }, content_html: '' }] };
      return { rows: masterJobs };
    },
  };
  assert.deepEqual([...(await ProductionController.getProductionSpoJobCodes(db))].sort(), ['CG', 'OB']);
  assert.deepEqual([...(await ProductionController.getDeployedSpoJobCodes(db))].sort(), ['CG', 'GNR', 'OB']);
});

test('legacy deployed SPO HTML remains compatible during migration', async () => {
  const content = `
    <div class="spo-table"><span data-spo-status>Deployed</span><input data-spo-job value="OB Removal"><span data-spo-job-label>OB Removal</span></div>
    <div class="spo-table"><span data-spo-status>Deployed</span><input data-spo-job value="Coal Getting"><span data-spo-job-label>Coal Getting</span></div>
    <div class="spo-table"><span data-spo-status>Draft</span><input data-spo-job value="General"></div>`;
  const db = {
    async query(sql) {
      if (sql.includes('FROM productivity_plans')) return { rows: [{ data_json: { version: 4, tables: {} }, content_html: content }] };
      return { rows: masterJobs };
    },
  };
  assert.deepEqual([...(await ProductionController.getDeployedSpoJobCodes(db))].sort(), ['CG', 'OB']);
});

test('legacy productivity HTML is converted into a fleet plan catalog', () => {
  const content = `<div class="plan-productivity-table" data-plan-table-id="ob-1" data-fleet-productivity="455.1170568561873" data-fleet-productivity-unit="BCM/Hr">
    <select data-plan-productivity-field="fleetName"><option value="EX-01" selected>EX-01</option></select>
    <select data-plan-productivity-field="material"><option value="CLAY" selected>CLAY</option></select>
  </div>`;
  const catalog = ProductionController.legacyFleetCatalog(content, 'ob');
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].loaderCode, 'EX-01');
  assert.equal(catalog[0].material, 'CLAY');
  assert.equal(catalog[0].fleetProductivity, 455.1170568561873);
  assert.equal(catalog[0].productivityUnit, 'BCM/Hr');
});

test('legacy Coal v2 keeps CG binding while recalculating Loader Productivity from HTML', () => {
  const content = `<div class="plan-productivity-table" data-plan-table-id="coal-1" data-fleet-productivity="166.77" data-fleet-productivity-unit="Ton/Hr">
    <select data-plan-productivity-field="fleetName"><option value="EX-01" selected>EX-01</option></select>
    <select data-plan-productivity-field="material"><option value="SEAM 3" selected>SEAM 3</option></select>
    <input data-plan-productivity-field="density" value="1.2">
    <input data-plan-productivity-field="bucketCapacity" value="2.1">
    <input data-plan-productivity-field="bucketFillFactor" value="0.9">
    <input data-plan-productivity-field="swellFactor" value="1.4">
    <input data-plan-productivity-field="cycleTimeLoading" value="23">
    <input data-plan-productivity-field="workEffLoader" value="0.725">
  </div>`;
  const rows = [
    { planning_type: 'coal', id: 'coal-v2', effective_from: '2026-09-16', content_html: content,
      data_json: { version: 2, fleetCatalog: [{ tableId: 'coal-1', planRef: 'coal:coal-1',
        loaderCode: 'EX-01', material: 'SEAM 3', jobCode: 'CG', fleetProductivity: 166.77 }] } },
    { planning_type: 'pa-ua-ewh', data_json: { assignments: { PA: { 'eq-1': 'OB' } } } },
  ];
  const catalog = ProductionController.buildFleetPlanCatalogFromRows(rows,
    [{ id: 'eq-1', kode_alat: 'EX-01', tipe_alat: 'EX30', class_unit: 'EX30 T' }], masterJobs);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].jobCode, 'CG', 'JOB tersimpan harus menang atas fallback PA');
  assert.equal(catalog[0].jobDescription, 'Coal Getting');
  assert.equal(catalog[0].productivityUnit, 'Ton/Hr');
  assert.ok(Math.abs(catalog[0].loaderProductivity - 183.83478260869566) < 1e-9);
  assert.equal(catalog[0].fleetProductivity, catalog[0].loaderProductivity);
  assert.notEqual(catalog[0].fleetProductivity, 166.77, 'target Fleet lama tidak boleh dipakai');
});

test('loader catalog joins Loader Productivity with PA JOB assignments', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM productivity_plans')) return { rows: [
        { planning_type: 'ob', updated_at: '2026-09-07T00:00:00Z', content_html: '', data_json: { scenarios: [{ id: 'p1', loaderCode: 'EX-01', material: 'CLAY', loaderProductivity: 455.117, complete: true }] } },
        { planning_type: 'pa-ua-ewh', content_html: '', data_json: { assignments: { PA: { 'eq-1': 'OB Removal' } } } },
      ] };
      if (sql.includes('FROM equipment')) return { rows: [{ id: 'eq-1', kode_alat: 'EX-01', tipe_alat: 'PC2000', class_unit: 'EX 200 T' }] };
      return { rows: [{ job_code: 'OB', job_desc: 'Overburden Removal' }] };
    },
  };
  const catalog = await ProductionController.buildFleetPlanCatalogData(db);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].equipmentId, 'eq-1');
  assert.equal(catalog[0].jobCode, 'OB');
  assert.equal(catalog[0].fleetProductivity, 455.117);
});

test('Loader JOB binding takes precedence over legacy PA assignment', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM productivity_plans')) return { rows: [
        { planning_type: 'coal', updated_at: '2026-09-07T00:00:00Z', content_html: '', data_json: { scenarios: [{ id: 'p1', jobCodes: ['CG'], loaderCode: 'EX-01', material: 'SEAM 1', loaderProductivity: 163.3, complete: true }] } },
        { planning_type: 'pa-ua-ewh', content_html: '', data_json: { assignments: { PA: { 'eq-1': 'OB' } } } },
      ] };
      if (sql.includes('FROM equipment')) return { rows: [{ id: 'eq-1', kode_alat: 'EX-01', tipe_alat: 'PC2000', class_unit: 'EX 200 T' }] };
      return { rows: masterJobs };
    },
  };
  const catalog = await ProductionController.buildFleetPlanCatalogData(db);
  assert.equal(catalog[0].jobCode, 'CG');
  assert.equal(catalog[0].jobDescription, 'Coal Getting');
});

test('operational catalog ignores Setting Fleet result and uses Loader Productivity directly', () => {
  const rows = [{ planning_type: 'ob', id: 'v-loader', effective_from: '2026-09-01', data_json: {
    scenarios: [{ id: 'loader-1', loaderCode: 'EX-01', material: 'CLAY', jobCodes: ['OB'],
      loaderProductivity: 180, complete: true }],
    fleetCatalog: [{ tableId: 'simulation-1', loaderCode: 'EX-01', material: 'CLAY', jobCode: 'OB',
      loaderProductivity: 180, fleetProductivity: 100, complete: true }],
    fleetSetups: [{ id: 'simulation-1', loaderScenarioId: 'loader-1', jobCode: 'OB' }],
  } }];
  const catalog = ProductionController.buildFleetPlanCatalogFromRows(rows,
    [{ id: 'eq-1', kode_alat: 'EX-01', tipe_alat: 'PC2000', class_unit: 'EX 200 T' }], masterJobs);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].fleetProductivity, 180);
  assert.equal(catalog[0].loaderProductivity, 180);
  assert.equal(catalog[0].targetSource, 'loader_productivity');
});

test('katalog planning satu bulan dibaca batch dan memilih versi efektif per tanggal', async () => {
  let queries = 0;
  const entry = (ref, productivity) => ({ id: ref, jobCodes: ['OB'], loaderCode: 'EX-01',
    material: 'CLAY', loaderProductivity: productivity, complete: true });
  const db = { async query(sql) {
    queries += 1;
    if (sql.includes("planning_type = 'spo'")) return { rows: [{ data_json: { tables: { ob: { deployed: true, endYear: 2026 } } } }] };
    if (sql.includes('FROM productivity_plan_versions')) return { rows: [
      { id: 'v2', planning_type: 'ob', effective_from: '2026-09-15', revision: 2, data_json: { scenarios: [entry('new', 200)] } },
      { id: 'v1', planning_type: 'ob', effective_from: '2026-09-01', revision: 1, data_json: { scenarios: [entry('old', 100)] } },
    ] };
    if (sql.includes("planning_type = 'pa-ua-ewh'")) return { rows: [] };
    if (sql.includes('FROM equipment')) return { rows: [{ id: 'eq-1', kode_alat: 'EX-01', tipe_alat: 'PC2000', class_unit: 'EX 200 T' }] };
    if (sql.includes('FROM master_job_codes')) return { rows: masterJobs };
    throw new Error(`Query tidak dikenali: ${sql}`);
  } };
  const catalog = await ProductionController.buildFleetPlanCatalogByDatesData(db, ['2026-09-05', '2026-09-20']);
  assert.equal(queries, 5, 'lookup master/version harus konstan, bukan lima query per tanggal');
  assert.equal(catalog.find(row => row.catalogDate === '2026-09-05').fleetProductivity, 100);
  assert.equal(catalog.find(row => row.catalogDate === '2026-09-20').fleetProductivity, 200);
});
