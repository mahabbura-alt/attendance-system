'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Workforce = require('../src/services/workforce');
const { updateKaryawan } = require('../src/controllers/karyawanController');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('workforce scope is derived from authenticated user with isolated compatibility defaults', () => {
  assert.deepEqual(Workforce.scopeFromUser({ tenant_id: 'tenant-a', project_id: 'project-a' }), { tenantKey: 'tenant-a', projectKey: 'project-a' });
  assert.deepEqual(Workforce.scopeFromUser({}), { tenantKey: 'default', projectKey: 'default' });
});

test('movement type and operational dates are strictly validated', () => {
  assert.equal(Workforce.normalizeMovementType(' promotion '), 'PROMOTION');
  assert.throws(() => Workforce.normalizeMovementType('unknown'), /tidak valid/i);
  assert.equal(Workforce.dateOnly('2026-10-06'), '2026-10-06');
  assert.throws(() => Workforce.dateOnly('06/10/2026'), /YYYY-MM-DD/);
  assert.deepEqual(Workforce.monthPeriod('2026-02'), {
    period: '2026-02', year: 2026, month: 2, from: '2026-02-01', to: '2026-02-28',
  });
  assert.throws(() => Workforce.monthPeriod('2026-13'), /YYYY-MM/);
});

test('MPP is monthly, catalog-driven, active-headcount only, and preserves other months', () => {
  const controller = read('src/controllers/workforceController.js');
  const service = read('src/services/workforceMpp.js');
  // Controller tetap tipis: delegasi ke WorkforceMpp (target §8 rencana enterprise).
  assert.match(controller, /WorkforceMpp\.getMppWorkspace/);
  assert.match(controller, /WorkforceMpp\.saveMppWorkspace/);
  assert.match(controller, /WorkforceMpp\.getActualDetail/);
  assert.match(controller, /WorkforceMpp\.getMppHistory/);
  // Domain service owns periode bulanan, agregasi katalog, headcount aktif, upsert per bulan.
  assert.match(service, /monthPeriod/);
  assert.match(service, /FROM workforce_positions pos/);
  // Karyawan berstatus NOTICE (sudah resign, belum hari kerja terakhir) masih dihitung headcount.
  assert.match(service, /ep\.employment_status IN \('ACTIVE',\s*'PROBATION',\s*'NOTICE'\)/);
  assert.match(service, /u\.is_active\s*=\s*TRUE/);
  assert.match(service, /ON CONFLICT \(line_id,\s*period_month\)/);
  assert.doesNotMatch(controller, /DELETE FROM workforce_mpp_lines WHERE plan_id/);
  assert.doesNotMatch(service, /DELETE FROM workforce_mpp_lines WHERE plan_id/);
});

test('migration 064 separates identity, assignment, immutable movement, checklist, audit and MPP', () => {
  const sql = read('migrations/064_workforce_movements_mpp.sql');
  for (const table of ['workforce_employee_profiles','workforce_employee_assignments','workforce_employee_movements','workforce_movement_approvals','workforce_movement_tasks','workforce_movement_audit','workforce_mpp_plans','workforce_mpp_lines','workforce_mpp_line_periods']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /uq_workforce_movement_idempotency/);
  assert.match(sql, /legacy_backfill/);
  assert.doesNotMatch(sql, /DELETE FROM users/);
});

test('workforce routes remain behind existing admin auth and expose movement/MPP workflow', () => {
  const routes = read('src/routes/karyawan.routes.js');
  assert.ok(routes.indexOf('router.use(requireAuth, requireAdmin)') < routes.indexOf("router.get('/workforce/summary'"));
  assert.match(routes, /workforce\/movements\/:id\/transition/);
  assert.match(routes, /workforce\/mpp\/:id\/transition/);
});

test('direct master edit rejects department, position and active-state mutation', async () => {
  let response;
  await updateKaryawan({ params: { id: 'employee' }, body: { departemen: 'HSE' } }, {
    status(code) { return { json(body) { response = { code, body }; } }; },
  }, error => { throw error; });
  assert.equal(response.code, 409);
  assert.equal(response.body.code, 'WORKFORCE_MOVEMENT_REQUIRED');
});

test('scheduled effective processor and Option C milestone are explicit', () => {
  const service = read('src/services/workforce.js');
  const future = fs.readFileSync(path.resolve(__dirname, '../../docs/OMOS_PEOPLE_ENTERPRISE_OPTION_C_MILESTONE.md'), 'utf8');
  assert.match(service, /async function processDueMovements/);
  assert.match(service, /status='APPROVED' AND effective_date <= \$1::date/);
  assert.match(future, /FUTURE MILESTONE \/ NOT YET IMPLEMENTED/);
});
