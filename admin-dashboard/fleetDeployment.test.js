'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('./fleetDeployment.core');

test('ringkasan memisahkan BCM dan Ton', () => {
  const result = Core.summarize([
    { status: 'published', fleet_count: 2, warning_count: 0, planned_production: 1200, productivity_unit: 'BCM/Hr' },
    { status: 'draft', fleet_count: 1, warning_count: 3, planned_production: 400, productivity_unit: 'Ton/Hr' },
  ]);
  assert.equal(result.ob, 1200);
  assert.equal(result.coal, 400);
  assert.equal(result.fleets, 3);
  assert.equal(result.warnings, 3);
});

test('filter list bekerja untuk area status dan pencarian', () => {
  const rows = [{ name: 'OB BEI', status: 'published', pit_area_snapshot: 'BEI', job_code_snapshot: 'OB', material_snapshot: 'CLAY', date_start: '2026-09-01', date_end: '2026-09-30' },
    { name: 'Coal DKC', status: 'draft', pit_area_snapshot: 'DKC', job_code_snapshot: 'CG', material_snapshot: 'COAL', date_start: '2026-10-01', date_end: '2026-10-31' }];
  assert.equal(Core.filterRows(rows, { search: 'clay', status: '', area: '' }).length, 1);
  assert.equal(Core.filterRows(rows, { search: '', status: 'draft', area: 'DKC' }).length, 1);
  assert.equal(Core.filterRows(rows, { search: '', from: '2026-09-15', to: '2026-10-05' }).length, 2);
  assert.equal(Core.filterRows(rows, { search: '', from: '2026-10-15', to: '2026-10-20' }).length, 1);
});

test('tanggal planner memakai kalender lokal dan inklusif', () => {
  assert.equal(Core.addDays('2026-09-23', 2), '2026-09-25');
  assert.equal(Core.daysInclusive('2026-09-23', '2026-09-25'), 3);
});

test('periode PostgreSQL timestamp dinormalisasi menjadi tanggal operasional', () => {
  assert.equal(Core.isoDate('2026-09-01T00:00:00.000Z'), '2026-09-01');
  assert.equal(Core.formatPeriod('2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z'), '01–30 Sep 2026');
  assert.equal(Core.daysInclusive('2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z'), 30);
  assert.equal(Core.filterRows([{ date_start: '2026-09-01T00:00:00.000Z', date_end: '2026-09-30T00:00:00.000Z' }],
    { from: '2026-09-30', to: '2026-09-30' }).length, 1);
});

test('wizard menampilkan seluruh Excavator dan memisahkan kelengkapan target', () => {
  const context = { jobCode: 'CG', material: 'SEAM 3', planningType: 'coal' };
  const candidates = Core.fleetCandidates([
    { id: 'ex1', kode_alat: 'EX30 350-14', tipe_alat: 'ZX350' },
    { id: 'ex2', kode_alat: 'EX30 2-26', tipe_alat: 'CAT 329D2' },
  ], [{ equipmentId: 'ex1', loaderCode: 'EX30 350-14', jobCode: 'CG', material: 'SEAM 3', planningType: 'coal',
    fleetProductivity: 177.45, productivityUnit: 'Ton/Hr' }], context);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].complete, true);
  assert.equal(candidates[1].complete, false);
  assert.equal(candidates[1].selectionRef, 'equipment:ex2');
});

test('List View mengikuti header dan highlight visual yang disetujui', () => {
  const source = fs.readFileSync(path.join(__dirname, 'fleetDeployment.js'), 'utf8');
  ['ACTIVE FLEET', 'DRAFT', 'CONFLICT', 'UNASSIGNED', 'PLAN OB', 'PLAN COAL'].forEach(label => assert.ok(source.includes(label)));
  ['<th>Fleet</th>', '<th>Periode</th>', '<th>PIT / Area</th>', '<th>JOB</th>', '<th>Material</th>', '<th>Productivity</th>', '<th>Produksi</th>', '<th>Status</th>']
    .forEach(header => assert.ok(source.includes(header)));
  assert.match(source, /icon\('excavator'\)/);
  assert.match(source, /List View/);
  assert.match(source, /Unit Mapping/);
  assert.match(source, /showView/);
  assert.match(source, /Range Periode/);
  assert.match(source, /params\.set\('from'/);
  assert.match(source, /params\.set\('to'/);
  assert.match(source, /state\.options\?\.excavators/);
  assert.match(source, /Loader Productivity/);
  assert.match(source, /new URLSearchParams\(\{from:state\.wizard\.dateStart,to:state\.wizard\.dateEnd\}\)/);
  assert.match(source, /await request\('\/master'\)/, 'Wizard must recover Excavators from Master Equipment during frontend/backend version skew');
  assert.match(source, /excavatorSource='master-fallback'/);
});

test('Unit Mapping tertanam di Fleet Capacity tanpa halaman dan slicer periode lama', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const production = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
  assert.match(html, /id="fleetUnitMappingView"/);
  assert.doesNotMatch(html, /id="tab-prodUnitMapping"/);
  assert.doesNotMatch(html, /id="unitMappingYear"|id="unitMappingMonth"|id="unitMappingScope"/);
  assert.doesNotMatch(html, /data-tab="prodUnitMapping"[^>]*>0\.9/);
  assert.match(production, /openEmbeddedUnitMapping/);
  assert.match(production, /showView\('mapping'\)/);
});
