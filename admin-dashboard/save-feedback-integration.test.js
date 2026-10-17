'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const production = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');
const hmWorklog = fs.readFileSync(path.join(__dirname, 'hm-worklog.js'), 'utf8');

test('P1 HR, roster, dan payroll memakai shared save feedback', () => {
  const requiredContexts = [
    'async function simpanDraftRosterJabatan',
    "getElementById('formPayroll').addEventListener('submit'",
    'async function simpanConfigKalkulasiPayroll',
  ];
  requiredContexts.forEach((marker, index) => {
    const start = app.indexOf(marker);
    const end = index + 1 < requiredContexts.length ? app.indexOf(requiredContexts[index + 1], start) : app.length;
    assert.ok(start >= 0, `marker tidak ditemukan: ${marker}`);
    assert.match(app.slice(start, end > start ? end : app.length), /OMOSActionFeedback\.(?:run|begin)/);
  });
});

test('Database HM memakai shared save feedback untuk koreksi baris dan impor Excel', () => {
  assert.match(hmWorklog, /hmWorklogEditForm[\s\S]*OMOSActionFeedback\.run/);
  assert.match(hmWorklog, /hmWorklogImportFile[\s\S]*OMOSActionFeedback\.run/);
});

test('Database HM dan payroll tidak lagi menampilkan kolom gerbang verifikasi', () => {
  const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const hmSection = index.slice(index.indexOf('id="tabHm"'), index.indexOf('id="tabHm"') + 5500);
  const payrollSection = index.slice(index.indexOf('id="tabKalkulasiPayroll"'), index.indexOf('id="tabKalkulasiPayroll"') + 5500);
  assert.doesNotMatch(hmSection, /<th>Status<\/th>|Perlu Verifikasi/);
  assert.doesNotMatch(payrollSection, /HM Perlu Verifikasi/);
  assert.match(index, /<th>Total HM<\/th>/);
  assert.match(hmWorklog, /HM Over, perlu verifikasi/);
});

test('Kartu Database HM dapat memfilter rincian koreksi dan HM over tanpa dropdown status', () => {
  const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(index, /id="hmWorklogAdjustedFilter"/);
  assert.match(index, /id="hmWorklogOverFilter"/);
  assert.match(hmWorklog, /quickFilter === 'adjusted'/);
  assert.match(hmWorklog, /quickFilter === 'over'/);
  assert.match(hmWorklog, /hmWorklogAdjustedFilter.*addEventListener\('click'/s);
  assert.match(hmWorklog, /hmWorklogOverFilter.*addEventListener\('click'/s);
});

test('P1 Input Data, Fuel, Standby, Breakdown, dan Ritase memakai shared save feedback', () => {
  [
    'async function simpanSemuaPerubahanInputData',
    "getElementById('formMultiWorkLog').addEventListener",
    "getElementById('formInputProdLog').addEventListener",
    'async function simpanPerubahanFuel',
    'async function simpanPerubahanStandby',
    "getElementById('formInputStandby').addEventListener",
    'async function simpanSesiStandby',
    "getElementById('formInsertStandbyUnit').addEventListener",
    "getElementById('formStandbyV2').addEventListener",
    "getElementById('formStandbyMulti').addEventListener",
    "getElementById('formMaintenanceEvent').addEventListener",
    "getElementById('formInputBreakdown').addEventListener",
    "getElementById('formUpdateBreakdownStatus').addEventListener",
    "getElementById('formAddBreakdownPart').addEventListener",
    "getElementById('formEditBreakdownSegment').addEventListener",
    'async function simpanAlokasiJarak',
    'async function simpanPdtyProblem',
    "getElementById('formInputFleet').addEventListener",
    'async function simpanRitaseFleet',
    'async function simpanTruckFactorSetup',
  ].forEach(marker => {
    const start = production.indexOf(marker);
    assert.ok(start >= 0, `marker tidak ditemukan: ${marker}`);
    assert.match(production.slice(start, start + 5000), /OMOSActionFeedback\.(?:run|begin)/, `feedback belum terpasang: ${marker}`);
  });
});

test('asset P1 memakai versi cache terbaru', () => {
  assert.ok(Number(loader.match(/production\.js\?v=(\d+)/)?.[1]) >= 84);
  const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(Number(index.match(/app\.js\?v=(\d+)/)?.[1]) >= 41);
  assert.ok(Number(index.match(/hm-worklog\.js\?v=(\d+)/)?.[1]) >= 4);
});
