'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

test('P2 autosave Planning memakai status bersama dan antrean request', () => {
  [
    ['planProductivity.core.js', 'planSaveQueues'],
    ['spo.core.js', 'saveQueue'],
    ['paUaEwh.core.js', 'saveQueue'],
    ['fleetCapacity.core.js', 'saveQueue'],
    ['unitMapping.core.js', 'saveQueue'],
  ].forEach(([file, queueMarker]) => {
    const source = read(file);
    assert.match(source, /OMOSActionFeedback\?\.status|OMOSActionFeedback\.status/, `${file} belum memakai status bersama`);
    assert.ok(source.includes(queueMarker), `${file} belum mengantrekan request simpan`);
  });
});

test('P2 tombol simpan Data Curah Hujan memakai feedback bersama', () => {
  const source = read('rainfall.core.js');
  assert.match(source, /OMOSActionFeedback\?\.begin/);
  assert.match(source, /feedback\.finish\(outcome, detail\)/);
});

test('P2 simpan master Parameter memakai feedback bersama', () => {
  const source = read('production.js');
  [
    'async function simpanDelayMaster',
    'async function simpanJobCode',
    'async function simpanProblemCode',
    "getElementById('formInputJobCode').addEventListener",
    "getElementById('formInputProblemCode').addEventListener",
    "getElementById('formEditParamEquipment').addEventListener",
    "getElementById('formInputParamEquipment').addEventListener",
    "getElementById('formInputParamStb').addEventListener",
    "getElementById('formInputParamBd').addEventListener",
  ].forEach(marker => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `marker tidak ditemukan: ${marker}`);
    assert.match(source.slice(start, start + 5000), /OMOSActionFeedback\.(?:run|begin)|OMOSActionFeedback\?\.begin/, `feedback belum terpasang: ${marker}`);
  });
});

test('asset P2 menggunakan versi cache terbaru', () => {
  const loader = read('production.loader.js');
  [
    'planProductivity.core.js?v=23',
    'spo.core.js?v=51',
    'paUaEwh.core.js?v=19',
    'fleetCapacity.core.js?v=15',
    'unitMapping.core.js?v=12',
    'rainfall.core.js?v=3',
    'production.js?v=84',
  ].forEach(asset => {
    const [name, minimum] = asset.split('?v=');
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const version = Number(loader.match(new RegExp(`${escaped}\\?v=(\\d+)`))?.[1]);
    assert.ok(version >= Number(minimum), `versi asset belum dinaikkan: ${asset}`);
  });
  const index = read('index.html');
  assert.match(index, /ui-action-feedback\.js\?v=3/);
  assert.ok(Number(index.match(/style\.css\?v=(\d+)/)?.[1]) >= 52);
});
