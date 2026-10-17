'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Planner = require('../src/services/fleetDeployment');
const FleetDeploymentController = require('../src/controllers/fleetDeploymentController');

function versionEntry(planRef, versionId, productivity) {
  return { planRef, tableId: planRef, equipmentId: 'ex1', loaderCode: 'EX01',
    jobCode: 'CG', material: 'SEAM 3', planningType: 'coal',
    fleetProductivity: productivity, productivityUnit: 'Ton/Hr', versionId, density: 1.2 };
}

// Regresi: versi plan berubah mid-periode (ganti planRef) — simpan scheme
// tidak boleh menghasilkan assignment_id null. Assignment milik unit,
// nilai versi per hari tetap tersimpan di baris day.
test('writeScheme memetakan day ke assignment unit saat planRef berganti versi', async () => {
  const payload = Planner.normalizePayload({ name: 'monthly sep', dateStart: '2026-09-15',
    dateEnd: '2026-09-16', pitArea: 'BEI', jobCode: 'CG', material: 'SEAM 3',
    planningType: 'coal', assignments: ['equipment:ex1'] });
  const selected = Planner.resolveFleetCandidates(payload,
    [versionEntry('coal:p1', 'ver-A', 200)],
    [{ id: 'ex1', kode_alat: 'EX01', kelas_alat: 'Excavator' }]);
  assert.equal(selected[0].planRef, 'coal:p1');
  const catalogs = new Map([
    ['2026-09-15', [versionEntry('coal:p1', 'ver-A', 200)]],
    ['2026-09-16', [versionEntry('coal:p2', 'ver-B', 250)]],
  ]);
  const pa = { values: { PA: { ex1: { '2026:9:15': 100, '2026:9:16': 100 } } } };
  const dailyRows = Planner.buildDailyRowsFromTimeline(payload, selected, catalogs, pa, { tables: {} });
  assert.equal(dailyRows.length, 2);
  assert.equal(dailyRows[1].plan.planRef, 'coal:p2', 'hari kedua memakai versi baru');

  const dayInserts = [];
  let assignmentSeq = 0;
  const db = { query: async (sql, args = []) => {
    if (sql.includes('FROM production_pits')) return { rows: [] };
    if (sql.includes('FROM master_job_codes')) return { rows: [{ id: 'job-1' }] };
    if (sql.includes('INSERT INTO fleet_deployment_schemes')) return { rows: [{ id: 'scheme-1' }] };
    if (sql.includes('INSERT INTO fleet_deployment_assignments')) {
      assignmentSeq += 1;
      return { rows: [{ id: `asg-${assignmentSeq}` }] };
    }
    if (sql.includes('INSERT INTO fleet_deployment_days')) {
      dayInserts.push(args);
      return { rows: [] };
    }
    throw new Error('query tak dikenal: ' + String(sql).slice(0, 60));
  } };
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const id = await FleetDeploymentController.writeScheme(db, scope, 'actor-1',
    { payload, selected, dailyRows }, 'draft');
  assert.equal(id, 'scheme-1');
  assert.equal(assignmentSeq, 1, 'satu assignment per unit meski versi berganti');
  assert.equal(dayInserts.length, 2);
  for (const args of dayInserts) {
    assert.ok(args[1], `assignment_id hari ${args[4]} tidak boleh null`);
    assert.equal(args[1], 'asg-1', 'kedua hari menunjuk assignment unit yang sama');
  }
  const byDate = Object.fromEntries(dayInserts.map(args => [args[4], args]));
  assert.equal(byDate['2026-09-15'][11], 'ver-A');
  assert.equal(byDate['2026-09-15'][12], 200);
  assert.equal(byDate['2026-09-16'][11], 'ver-B', 'versi hari kedua tetap versi B');
  assert.equal(byDate['2026-09-16'][12], 250, 'productivity hari kedua tetap versi B');
});
