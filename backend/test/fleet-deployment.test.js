'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Planner = require('../src/services/fleetDeployment');

test('rentang deployment inklusif dan dibatasi', () => {
  assert.deepEqual(Planner.expandDates('2026-09-01', '2026-09-03'), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.throws(() => Planner.expandDates('2026-09-03', '2026-09-01'), /Tanggal akhir/);
  assert.throws(() => Planner.expandDates('2026-01-01', '2027-01-02'), /Rentang maksimum/);
});

test('EWH harian memakai PA dikurangi SPO loss', () => {
  const pa = { values: { PA: { ex1: { '2026:9:23': 75 } } } };
  const spo = { tables: { ob: { jobCode: 'OB', daily: { 'table:2026:9:23': 2 } } } };
  assert.equal(Planner.dailyEwh(pa, spo, 'ex1', 'OB', '2026-09-23'), 16);
});

test('build daily menjaga satuan dan snapshot productivity', () => {
  const payload = Planner.normalizePayload({ name: 'A', dateStart: '2026-09-23', dateEnd: '2026-09-24', pitArea: 'BEI',
    jobCode: 'OB', material: 'CLAY', planningType: 'ob', assignments: ['ob:p1'] });
  const catalog = [{ planRef: 'ob:p1', tableId: 'p1', equipmentId: 'ex1', loaderCode: 'EX01', jobCode: 'OB', material: 'CLAY',
    planningType: 'ob', fleetProductivity: 100, productivityUnit: 'BCM/Hr' }];
  const pa = { values: { PA: { ex1: { '2026:9:23': 100, '2026:9:24': 50 } } } };
  const rows = Planner.buildDailyRows(payload, catalog, pa, { tables: {} });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].plannedProduction, 2400);
  assert.equal(rows[1].plannedProduction, 1200);
  assert.equal(rows[0].plan.productivityUnit, 'BCM/Hr');
});

test('semua Excavator aktif dapat menjadi draft meski Loader Productivity konteks belum tersedia', () => {
  const payload = Planner.normalizePayload({ dateStart: '2026-09-01', dateEnd: '2026-09-02', pitArea: 'BEI',
    jobCode: 'CG', material: 'SEAM 3', planningType: 'coal', assignments: ['equipment:ex-missing'] });
  const selected = Planner.resolveFleetCandidates(payload, [], [
    { id: 'ex-missing', kode_alat: 'EX30 2-26', kelas_alat: 'Excavator', tipe_alat: 'CAT 329D2' },
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].loaderCode, 'EX30 2-26');
  assert.equal(selected[0].fleetProductivity, null);
  assert.equal(selected[0].source, 'equipment_missing_plan');
});

test('preview memakai Loader Productivity efektif per hari dan menandai hari yang belum memiliki plan', () => {
  const payload = Planner.normalizePayload({ dateStart: '2026-09-15', dateEnd: '2026-09-16', pitArea: 'BEI',
    jobCode: 'CG', material: 'SEAM 3', planningType: 'coal', assignments: ['equipment:ex1'] });
  const selected = Planner.resolveFleetCandidates(payload, [{ planRef: 'coal:p1', equipmentId: 'ex1', loaderCode: 'EX01',
    jobCode: 'CG', material: 'SEAM 3', planningType: 'coal', fleetProductivity: 200, productivityUnit: 'Ton/Hr' }],
  [{ id: 'ex1', kode_alat: 'EX01', kelas_alat: 'Excavator' }]);
  const catalogs = new Map([
    ['2026-09-15', []],
    ['2026-09-16', [{ planRef: 'coal:p1', equipmentId: 'ex1', loaderCode: 'EX01', jobCode: 'CG', material: 'SEAM 3',
      planningType: 'coal', fleetProductivity: 200, productivityUnit: 'Ton/Hr' }]],
  ]);
  const pa = { values: { PA: { ex1: { '2026:9:15': 100, '2026:9:16': 100 } } } };
  const rows = Planner.buildDailyRowsFromTimeline(payload, selected, catalogs, pa, { tables: {} });
  assert.equal(rows[0].completeness, 'missing-plan');
  assert.equal(rows[0].plannedProduction, null);
  assert.equal(rows[1].completeness, 'complete');
  assert.equal(rows[1].plannedProduction, 4800);
});

test('transisi status bersifat eksplisit', () => {
  assert.equal(Planner.statusTransitionAllowed('draft', 'published'), true);
  assert.equal(Planner.statusTransitionAllowed('published', 'draft'), false);
  assert.equal(Planner.statusTransitionAllowed('closed', 'published'), false);
});

test('endpoint validasi menahan satu koneksi dan membaca versi productivity secara berurutan', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/controllers/fleetDeploymentController.js'), 'utf8');
  assert.match(source, /async preview\(req, res\)[\s\S]*?db = await pool\.connect\(\)/);
  assert.match(source, /async options\(req, res\)[\s\S]*?db = await pool\.connect\(\)/);
  assert.match(source, /for \(const date of references\) catalogs\.set\(date, await ProductionController\.buildFleetPlanCatalogData\(db, date\)\)/);
  assert.match(source, /Koneksi database sedang sibuk\. Silakan ulangi validasi beberapa saat lagi\./);
});
