'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./ritaseNonProd.core.js');
const { buildScopes, buildReportModel, reportMarkup } = require('./ritaseReport.js');

test('frontend helper menghitung contoh 6-2 dan 5-3 secara deterministik', () => {
  assert.equal(core.productive(6, 2), 4);
  assert.equal(core.productive(5, 3), 2);
  assert.throws(() => core.productive(5, 6), /tidak boleh melebihi/);
});

test('JPEG memakai ritase produktif serta tetap membawa bruto dan Non Prod', () => {
  const fleet = {
    id: 'fleet-1', tanggal: '2026-09-23', shift_id: 'day', nama_shift: 'Shift Siang',
    operational_start: '06:00:00', operational_end: '18:00:00', lintas_hari: false,
    excavator_kode: 'EX-01', pit_area: 'BEI', job_code: 'OB', job_desc: 'Overburden Removal',
    material_type: 'Overburden', material_detail: 'CLAY', plan_status: 'synced',
    plan_productivity: 100, plan_productivity_unit: 'BCM/Hr', productivity_exceptions: [],
    trucks: [
      { dump_truck_id: 'dt-30', kode_alat: 'DT 30', tipe_alat: 'DT', hours: { 7: 6 }, nonprod_hours: { 7: 2 } },
      { dump_truck_id: 'dt-31', kode_alat: 'DT 31', tipe_alat: 'DT', hours: { 7: 5 }, nonprod_hours: { 7: 3 } }
    ]
  };
  const snapshot = { tanggal: '2026-09-23', fleets: [fleet], truckFactors: { 'OB|DT|CLAY': 11 } };
  const scope = buildScopes(snapshot.fleets)[0];
  const model = buildReportModel(snapshot, scope.key, 8);
  assert.equal(model.grossRitase, 11);
  assert.equal(model.nonprodRitase, 5);
  assert.equal(model.ritase, 6);
  assert.equal(model.actual, 66);
  assert.deepEqual(model.fleets[0].truckTotals.map(row => row.ritase), [4, 2]);
  assert.match(reportMarkup(model), /RITASE PRODUKTIF/);
  assert.match(reportMarkup(model), /Non Prod 5/);
});

test('Input Ritase merender row, tombol, modal, dan payload Non Prod', () => {
  const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
  const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');
  assert.match(source, /NON PROD \/ INPIT/);
  assert.match(source, /data-nonprod-button-hour/);
  assert.match(source, /function bukaNonProdInpit/);
  assert.match(source, /nonprod_ritase_count: nonprod/);
  assert.match(source, /OMOSActionFeedback\.run\(saveButton/);
  assert.match(loader, /ritaseNonProd\.core\.js\?v=1/);
});
