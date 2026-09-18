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
    { jobCode: 'CG', jobDescription: 'Coal Getting' },
  ]);
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

test('fleet catalog joins planning entries with PA JOB assignments', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM productivity_plans')) return { rows: [
        { planning_type: 'ob', updated_at: '2026-09-07T00:00:00Z', content_html: '', data_json: { fleetCatalog: [{ planRef: 'ob:p1', tableId: 'p1', loaderCode: 'EX-01', material: 'CLAY', fleetProductivity: 455.117 }] } },
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

test('table-level JOB binding takes precedence over legacy PA assignment', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM productivity_plans')) return { rows: [
        { planning_type: 'coal', updated_at: '2026-09-07T00:00:00Z', content_html: '', data_json: { fleetCatalog: [{ planRef: 'coal:p1', tableId: 'p1', jobCode: 'CG', loaderCode: 'EX-01', material: 'SEAM 1', fleetProductivity: 163.3 }] } },
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
