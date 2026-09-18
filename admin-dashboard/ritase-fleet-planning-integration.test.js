'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');

test('Tambah Fleet reads excavators from the authoritative fleet plan catalog', () => {
  assert.match(source, /\/api\/admin\/production\/fleet-plans\/catalog/);
  assert.match(source, /Pilih Excavator dari Productivity Planning/);
  assert.doesNotMatch(source.slice(source.indexOf('async function bukaModalInputFleet'), source.indexOf('async function muatFleetUntukEdit')), /filter\(e => e\.kelas_alat === 'Excavator'\)/);
});

test('fleet creation sends the selected plan reference and exact material', () => {
  assert.match(source, /fleet_plan_ref:\s*materialSel\.value/);
  assert.match(source, /material_detail:\s*selectedPlanOption\.dataset\.material/);
  assert.match(source, /fleet_mapping_id:\s*fleet\?\.id \|\| null/);
});

test('Input Ritase source is cache-versioned after fleet identity changes', () => {
  const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(loader, /production\.js\?v=86/);
  assert.match(index, /production\.loader\.js\?v=20/);
});

test('edit fleet sends its identity so backend can update the selected table', () => {
  const editStart = source.indexOf('function muatFleetUntukEdit');
  const editSource = source.slice(editStart, source.indexOf('async function simpanRitaseFleet', editStart));
  assert.match(editSource, /id:\s*fleetId/);
  assert.match(editSource, /bukaModalInputFleet\(fleet\)/);
});

test('Ritase card shows read-only planned Fleet Productivity', () => {
  assert.match(source, /Plan Fleet Productivity:/);
  assert.match(source, /fleet\.plan_productivity_unit/);
  assert.match(source, /Plan tidak ditemukan/);
});

test('saving Truck Factor refreshes the Ritase grid immediately', () => {
  const start = source.indexOf('async function simpanTruckFactorSetup(');
  const end = source.indexOf('// 5b. TRUCK FACTOR COPY / PASTE', start);
  const saveSource = source.slice(start, end);
  assert.match(saveSource, /await muatRitaseFleetGrid\(\)/);
});

test('Truck Factor effective-dated setup does not copy inherited values into a new period', () => {
  const start = source.indexOf('async function simpanTruckFactorSetup(');
  const end = source.indexOf('// 5b. TRUCK FACTOR COPY / PASTE', start);
  const saveSource = source.slice(start, end);
  const modalStart = source.indexOf('async function bukaModalTruckFactor()');
  const modalEnd = source.indexOf('async function simpanTruckFactorSetup(', modalStart);
  const modalSource = source.slice(modalStart, modalEnd);

  assert.match(modalSource, /source_tanggal/);
  assert.match(modalSource, /otomatis dipakai pada periode berikutnya/);
  assert.match(saveSource, /if \(factorValue === originalValue\) return/);
  assert.match(saveSource, /if \(!factorValue && !hasCurrentVersion\) return/);
  assert.doesNotMatch(modalSource, /truck-factors\/previous/);
});

test('fleet production total stays unavailable while a truck factor is incomplete', () => {
  assert.match(source, /const fleetFactorsComplete = fleetTrucks\.length > 0/);
  assert.match(source, /const fleetTotalProduksi = fleetFactorsComplete/);
  assert.match(source, /fleetFactorComplete \? fleetProduksi\.toLocaleString\('id-ID'\) : '\\u2014'/);
});
