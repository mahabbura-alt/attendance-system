'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PeriodicService = require('../src/services/periodicService');

test('due state uses latest completed service HM before policy baseline', () => {
  const state = PeriodicService.calculateDueState({ intervalHm: 250, warningHm: 50, currentHm: 1190, baselineHm: 700, lastServiceHm: 950 });
  assert.equal(state.nextDueHm, 1200);
  assert.equal(state.remainingHm, 10);
  assert.equal(state.status, 'upcoming');
});

test('due state distinguishes exact due, overdue, missing HM and rejects invalid interval', () => {
  assert.equal(PeriodicService.calculateDueState({ intervalHm: 250, currentHm: 1250, baselineHm: 1000 }).status, 'due');
  assert.equal(PeriodicService.calculateDueState({ intervalHm: 250, currentHm: 1250.001, baselineHm: 1000 }).status, 'overdue');
  assert.equal(PeriodicService.calculateDueState({ intervalHm: 250, currentHm: null, baselineHm: 1000 }).status, 'missing_hm');
  assert.throws(() => PeriodicService.calculateDueState({ intervalHm: 0 }), /lebih dari 0/);
});

test('service duration preserves full precision and rejects reversed timestamps', () => {
  assert.equal(PeriodicService.hoursBetween('2026-09-30T01:00:00Z', '2026-09-30T03:30:00Z'), 2.5);
  assert.throws(() => PeriodicService.hoursBetween('2026-09-30T03:00:00Z', '2026-09-30T02:00:00Z'), /lebih awal/);
});

test('dashboard period defaults to month-to-date and validates an inclusive bounded range', () => {
  assert.deepEqual(PeriodicService.resolveDashboardRange({}, '2026-10-03'), {
    dateFrom: '2026-10-01', dateTo: '2026-10-03'
  });
  assert.deepEqual(PeriodicService.resolveDashboardRange({ date_from: '2026-09-20', date_to: '2026-09-30' }, '2026-10-03'), {
    dateFrom: '2026-09-20', dateTo: '2026-09-30'
  });
  assert.throws(() => PeriodicService.resolveDashboardRange({ date_from: '2026-10-03', date_to: '2026-10-02' }, '2026-10-03'), /lebih awal/);
  assert.throws(() => PeriodicService.resolveDashboardRange({ date_from: '2025-01-01', date_to: '2026-10-03' }, '2026-10-03'), /maksimal 366 hari/);
  assert.throws(() => PeriodicService.resolveDashboardRange({ date_from: '2026-02-30', date_to: '2026-10-03' }, '2026-10-03'), /tidak valid/);
});

test('model schedule locks absolute HM milestones and chooses the largest intersecting package', () => {
  const packages = [
    { id: '250', service_code: 'PS250', cycle_hm: 250 },
    { id: '500', service_code: 'PS500', cycle_hm: 500 },
    { id: '1000', service_code: 'PS1000', cycle_hm: 1000 }
  ];
  const at750 = PeriodicService.calculateModelSchedule({ packages, enrollmentHm: 612, currentHm: 740 });
  assert.equal(at750.nextDueHm, 750);
  assert.equal(at750.serviceCode, 'PS250');
  assert.equal(at750.status, 'upcoming');
  const at1000 = PeriodicService.calculateModelSchedule({ packages, enrollmentHm: 612, currentHm: 980, lastCompletedDueHm: 750 });
  assert.equal(at1000.nextDueHm, 1000);
  assert.equal(at1000.serviceCode, 'PS1000');
  assert.equal(at1000.packageId, '1000');
});

test('late realization does not drift the next model milestone', () => {
  const packages = [{ id: '250', service_code: 'PS250', cycle_hm: 250 }];
  const state = PeriodicService.calculateModelSchedule({ packages, enrollmentHm: 612, currentHm: 1010, lastCompletedDueHm: 750 });
  assert.equal(state.nextDueHm, 1000);
  assert.equal(state.status, 'overdue');
  assert.equal(state.remainingHm, -10);
});

test('migration and API preserve PS lineage, audit and functional-failure exclusion', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/058_periodic_service.sql'), 'utf8');
  const modelMigration = fs.readFileSync(path.join(__dirname, '../migrations/059_periodic_service_model_setup.sql'), 'utf8');
  const scheduleMigration = fs.readFileSync(path.join(__dirname, '../migrations/060_periodic_service_schedule_items.sql'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/periodicService.controller.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/production.routes.js'), 'utf8');
  assert.match(migration, /'PS', 'Periodic Service'/);
  assert.match(migration, /counts_as_function_failure[\s\S]*FALSE/);
  assert.match(migration, /periodic_service_time_corrections/);
  assert.match(controller, /Generated otomatis dari Periodic Service/);
  assert.match(controller, /counts_as_breakdown\)\s*VALUES[\s\S]*TRUE/);
  assert.match(routes, /periodic-service\/orders\/:id\/start/);
  assert.match(routes, /periodic-service\/orders\/:id\/time/);
  assert.match(modelMigration, /equipment_model/);
  assert.match(modelMigration, /uq_periodic_service_package_model_active/);
  assert.match(modelMigration, /uq_periodic_service_package_model_cycle_active/);
  assert.match(controller, /sudah memiliki.*pada periode/);
  assert.match(controller, /calculateModelSchedule/);
  assert.match(routes, /periodic-service\/packages\/:id/);
  assert.match(scheduleMigration, /scheduled_start/);
  assert.match(scheduleMigration, /periodic_service_order_items/);
  assert.match(scheduleMigration, /source_type[\s\S]*setup[\s\S]*additional/);
  assert.match(controller, /additional_items/);
  assert.match(controller, /INSERT INTO periodic_service_order_items/);
  assert.match(controller, /FROM periodic_service_order_items WHERE order_id/);
  assert.match(controller, /isDirectRealization/);
  assert.match(controller, /Selesai service harus lebih akhir/);
  assert.match(controller, /Generated otomatis dari realisasi Periodic Service/);
  assert.match(controller, /downtime_hours: downtimeHours/);
  assert.match(controller, /code: 'PS'/);
  assert.match(controller, /resolveDashboardRange/);
  assert.match(controller, /status IN \('scheduled','in_progress','awaiting_verification'\)/);
  assert.match(routes, /router\.put\('\/periodic-service\/orders\/:id'/);
  assert.match(routes, /router\.delete\('\/periodic-service\/orders\/:id'/);
  assert.match(controller, /updateOrder\(req, res\)/);
  assert.match(controller, /deleteOrder\(req, res\)/);
  assert.match(controller, /INSERT INTO periodic_service_findings/);
});

