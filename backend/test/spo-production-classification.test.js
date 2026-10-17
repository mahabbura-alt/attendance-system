'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SpoPlanning = require('../src/services/spoPlanning');

const jobs = [
  { job_code: 'OB', job_desc: 'Overburden Removal' },
  { job_code: 'CG', job_desc: 'Coal Getting' },
  { job_code: 'FOT', job_desc: 'Fleet On Truck' },
  { job_code: 'GNR', job_desc: 'General' },
];

const standbyCodes = [
  { id: 'code-s01', kode: 'S01', kategori: 'Rain', deskripsi: 'Hujan', planning_type: 'unplanned', control_class: 'uncontrollable', owner_department: 'Production', deleted_at: null, is_system: false },
  { id: 'code-s02', kode: 'S02', kategori: 'Slippery', deskripsi: 'Slippery', planning_type: 'unplanned', control_class: 'controllable', owner_department: 'Production', deleted_at: null, is_system: false },
];

test('legacy OB, CG, dan FOT diperlakukan sebagai Prod tanpa mengklasifikasikan JOB lain', () => {
  const plan = { data_json: { deployedJobs: ['OB', 'CG', 'FOT', 'GNR'] } };
  assert.deepEqual([...SpoPlanning.extractProductionJobCodes(plan, jobs)].sort(), ['CG', 'FOT', 'OB']);
  const general = SpoPlanning.extractDeployedJobs(plan, jobs).find(row => row.jobCode === 'GNR');
  assert.equal(general.productionMode, null);
});

test('validasi SPO v6 mempertahankan Prod dan Non Prod sebagai dimensi terpisah dari deployed', () => {
  const data = SpoPlanning.validatePlanningData({ tables: {
    ob: { jobCode: 'OB', deployed: true, productionMode: 'prod' },
    general: { jobCode: 'GNR', deployed: true, productionMode: 'non_prod' },
  } }, jobs);
  assert.equal(data.version, 8);
  assert.deepEqual(data.deployedJobs.map(row => [row.jobCode, row.productionMode]), [
    ['OB', 'prod'], ['GNR', 'non_prod'],
  ]);
});

test('SPO menolak deployed JOB tanpa klasifikasi dan konflik klasifikasi JOB sama', () => {
  assert.throws(() => SpoPlanning.validatePlanningData({ tables: {
    general: { jobCode: 'GNR', deployed: true },
  } }, jobs), /Klasifikasi Prod\/Non Prod wajib/);
  assert.throws(() => SpoPlanning.validatePlanningData({ tables: {
    one: { jobCode: 'OB', deployed: true, productionMode: 'prod' },
    two: { jobCode: 'OB', deployed: true, productionMode: 'non_prod' },
  } }, jobs), /bertentangan/);
});

test('SPO Prod mewajibkan jenis material dan menguncinya setelah deploy', () => {
  assert.throws(() => SpoPlanning.validatePlanningData({ tables: {
    general: { jobCode: 'GNR', deployed: true, productionMode: 'prod' },
  } }, jobs), /Jenis Material OB\/Coal wajib/);
  const previousData = { version: 8, tables: {
    general: { jobCode: 'GNR', deployed: true, productionMode: 'prod', materialType: 'ob' },
  } };
  assert.throws(() => SpoPlanning.validatePlanningData({ version: 8, tables: {
    general: { jobCode: 'GNR', deployed: true, productionMode: 'prod', materialType: 'coal' },
  } }, jobs, { previousData }), error => error.status === 409 && /Jenis Material JOB GNR tidak dapat diubah/.test(error.message));
});

test('SPO menolak perubahan klasifikasi setelah tabel pernah di-deploy', () => {
  const previousData = { tables: {
    locked: { jobCode: 'GNR', deployed: true, productionMode: 'non_prod' },
  } };
  assert.throws(() => SpoPlanning.validatePlanningData({ tables: {
    locked: { jobCode: 'GNR', deployed: true, productionMode: 'prod' },
  } }, jobs, { previousData }), error => error.status === 409
    && /tidak dapat diubah setelah tabel SPO di-deploy/.test(error.message));
  const unchanged = SpoPlanning.validatePlanningData({ tables: {
    locked: { jobCode: 'GNR', deployed: true, productionMode: 'non_prod' },
  } }, jobs, { previousData });
  assert.equal(unchanged.tables.locked.productionMode, 'non_prod');
  assert.throws(() => SpoPlanning.validatePlanningData({ tables: {
    replacement: { jobCode: 'GNR', deployed: true, productionMode: 'prod' },
  } }, jobs, { previousData }), /tidak dapat diubah setelah tabel SPO di-deploy/);
});

test('SPO v7 mengikat parameter deployed ke Standby Codes aktif dan menyegarkan snapshot dari master', () => {
  const data = SpoPlanning.validatePlanningData({ version: 7, tables: {
    ob: { jobCode: 'OB', deployed: true, productionMode: 'prod', parameters: [
      { rowId: '1', standbyCodeId: 'code-s01', codeSnapshot: 'LAMA', descriptionSnapshot: 'Lama' },
      { rowId: '2', standbyCodeId: 'code-s02' },
    ] },
  } }, jobs, { standbyCodes });
  assert.equal(data.version, 8);
  assert.deepEqual(data.tables.ob.parameters[0], {
    rowId: '1', standbyCodeId: 'code-s01', codeSnapshot: 'S01', descriptionSnapshot: 'Hujan',
    planningTypeSnapshot: 'unplanned', controlClassSnapshot: 'uncontrollable', ownerDepartmentSnapshot: 'Production',
  });
});

test('SPO v7 menolak parameter tanpa Standby Code aktif atau rowId duplikat', () => {
  assert.throws(() => SpoPlanning.validatePlanningData({ version: 7, tables: {
    ob: { jobCode: 'OB', deployed: true, productionMode: 'prod', parameters: [] },
  } }, jobs, { standbyCodes }), /wajib menggunakan Standby Codes/);
  assert.throws(() => SpoPlanning.validatePlanningData({ version: 7, tables: {
    ob: { jobCode: 'OB', deployed: true, productionMode: 'prod', parameters: [
      { rowId: '1', standbyCodeId: 'tidak-ada' },
    ] },
  } }, jobs, { standbyCodes }), /tidak aktif atau tidak tersedia/);
  assert.throws(() => SpoPlanning.validatePlanningData({ version: 7, tables: {
    ob: { jobCode: 'OB', deployed: true, productionMode: 'prod', parameters: [
      { rowId: '1', standbyCodeId: 'code-s01' }, { rowId: '1', standbyCodeId: 'code-s02' },
    ] },
  } }, jobs, { standbyCodes }), /duplikat/);
  assert.throws(() => SpoPlanning.validatePlanningData({ version: 7, tables: {
    ob: { jobCode: 'OB', deployed: true, productionMode: 'prod', parameters: [
      { rowId: '1', standbyCodeId: 'code-s01' }, { rowId: '2', standbyCodeId: 'code-s01' },
    ] },
  } }, jobs, { standbyCodes }), /Standby Code S01 duplikat/);
});

test('SPO deployed mengunci identitas parameter dan tetap mengizinkan perubahan jam delay', () => {
  const previousData = { version: 7, tables: { ob: {
    jobCode: 'OB', deployed: true, productionMode: 'prod', daily: { '1:2026:9:1': 2.5 },
    parameters: [{ rowId: '1', standbyCodeId: 'code-s01' }, { rowId: '2', standbyCodeId: 'code-s02' }],
  } } };
  const changedHours = SpoPlanning.validatePlanningData({ version: 7, tables: { ob: {
    jobCode: 'OB', deployed: true, productionMode: 'prod', daily: { '1:2026:9:1': 3.25 },
    parameters: [{ rowId: '1', standbyCodeId: 'code-s01' }, { rowId: '2', standbyCodeId: 'code-s02' }],
  } } }, jobs, { previousData, standbyCodes });
  assert.equal(changedHours.tables.ob.daily['1:2026:9:1'], 3.25);
  for (const parameters of [
    [{ rowId: '1', standbyCodeId: 'code-s02' }, { rowId: '2', standbyCodeId: 'code-s01' }],
    [{ rowId: '1', standbyCodeId: 'code-s01' }],
    [{ rowId: '2', standbyCodeId: 'code-s02' }, { rowId: '1', standbyCodeId: 'code-s01' }],
  ]) assert.throws(() => SpoPlanning.validatePlanningData({ version: 7, tables: { ob: {
    jobCode: 'OB', deployed: true, productionMode: 'prod', parameters,
  } } }, jobs, { previousData, standbyCodes }), error => error.status === 409 && /Hanya jam delay/.test(error.message));
});
