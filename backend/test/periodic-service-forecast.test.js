'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Forecast = require('../src/services/periodicServiceForecast');

test('forecast memakai hari pertama akumulasi EWH mencapai milestone service', () => {
  const ewhByDate = {};
  for (let day = 1; day <= 31; day += 1) ewhByDate[`2026-10-${String(day).padStart(2, '0')}`] = 14;
  const result = Forecast.forecastUnit({
    dateFrom: '2026-10-01', dateTo: '2026-10-31', hmDate: '2026-10-03', currentHm: 1000,
    nextDueHm: 1250, baseCycleHm: 250, ewhByDate,
    packages: [{ id: 'ps250', service_code: 'PS250', cycle_hm: 250, estimated_duration_hours: 1 }]
  });
  const serviceDay = result.days.find(day => day.events.some(event => event.source === 'estimate'));
  assert.equal(serviceDay.date, '2026-10-21');
  assert.equal(serviceDay.downtimeHours, 1);
  assert.equal(serviceDay.pa, (23 / 24) * 100);
  assert.equal(result.totalDowntimeHours, 1);
  assert.equal(result.periodPa, ((31 * 24 - 1) / (31 * 24)) * 100);
});

test('durasi aktual order mengalahkan estimasi Area Setup', () => {
  const result = Forecast.forecastUnit({
    dateFrom: '2026-10-01', dateTo: '2026-10-31', hmDate: '2026-10-31', currentHm: 1000,
    nextDueHm: 1250, baseCycleHm: 250, ewhByDate: {},
    packages: [{ id: 'ps250', service_code: 'PS250', cycle_hm: 250, estimated_duration_hours: 1 }],
    orders: [{ id: 'wo-1', package_id: 'ps250', service_code: 'PS250', status: 'completed', eventDate: '2026-10-10',
      due_hm: 1000, actual_start: '2026-10-10T01:00:00Z', actual_finish: '2026-10-10T03:30:00Z' }]
  });
  const day = result.days.find(item => item.date === '2026-10-10');
  assert.equal(day.downtimeHours, 2.5);
  assert.equal(day.events[0].source, 'actual');
  assert.equal(day.pa, ((24 - 2.5) / 24) * 100);
});

test('durasi service lebih dari sehari dibagi ke kolom harian tanpa membuat PA negatif', () => {
  const result = Forecast.forecastUnit({
    dateFrom: '2026-10-10', dateTo: '2026-10-12', hmDate: '2026-10-12', currentHm: 1000,
    nextDueHm: 1250, baseCycleHm: 250, ewhByDate: {},
    packages: [{ id: 'ps250', service_code: 'PS250', cycle_hm: 250, estimated_duration_hours: 30 }],
    orders: [{ id: 'wo-1', package_id: 'ps250', service_code: 'PS250', status: 'completed', eventDate: '2026-10-10',
      due_hm: 1000, actual_start: '2026-10-10T00:00:00Z', actual_finish: '2026-10-11T06:00:00Z' }]
  });
  assert.equal(result.days[0].downtimeHours, 24);
  assert.equal(result.days[0].pa, 0);
  assert.equal(result.days[1].downtimeHours, 6);
  assert.equal(result.days[1].events[0].continuation, true);
  assert.equal(result.days[1].pa, 75);
  assert.equal(result.totalDowntimeHours, 30);
  assert.equal(result.periodPa, ((72 - 30) / 72) * 100);
});

test('forecast gagal tertutup setelah EWH harian hilang dan memilih paket terbesar pada milestone beririsan', () => {
  const selected = Forecast.packageForMilestone([
    { service_code: 'PS250', cycle_hm: 250 }, { service_code: 'PS500', cycle_hm: 500 }, { service_code: 'PS1000', cycle_hm: 1000 }
  ], 2000);
  assert.equal(selected.service_code, 'PS1000');
  const result = Forecast.forecastUnit({
    dateFrom: '2026-10-03', dateTo: '2026-10-05', hmDate: '2026-10-03', currentHm: 1000,
    nextDueHm: 1250, baseCycleHm: 250, ewhByDate: { '2026-10-04': null, '2026-10-05': 14 },
    packages: [{ service_code: 'PS250', cycle_hm: 250, estimated_duration_hours: 1 }]
  });
  assert.equal(result.complete, false);
  assert.equal(result.days[1].pa, null);
  assert.equal(result.days[2].pa, null);
  assert.equal(result.periodPa, null);
});

test('API dan migration menyimpan estimasi setup serta membuka endpoint Forecast PA', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/061_periodic_service_forecast_pa.sql'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/periodicService.controller.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/production.routes.js'), 'utf8');
  assert.match(migration, /estimated_duration_hours/);
  assert.match(controller, /estimated_duration_hours/);
  assert.match(controller, /FleetDeployment\.dailyEwh/);
  assert.match(routes, /periodic-service\/forecast-pa/);
});
