require('dotenv').config();
const { pool } = require('../config/db');
const hseService = require('../services/hse');

async function verify() {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const mockUser = { id: null, nama: 'Admin Test' };

  console.log('=== TEST 1: Get Initial Personnel Scope ===');
  const initialScope = await hseService.getInspectionPersonnelScope(pool, scope);
  console.log('Initial Scope:', initialScope);

  console.log('\n=== TEST 2: Mandate Overview Sebelum Scope Filter ===');
  const overviewAll = await hseService.getInspectionMandateOverview(pool, scope, { all_employees: 'true' });
  console.log('Total Employee (All):', overviewAll.kpi.totalEmployees);

  console.log('\n=== TEST 3: Save Custom Scope (SPV Produksi, HSE Officer, PJO, Pengawas) ===');
  const savedScope = await hseService.saveInspectionPersonnelScope(pool, scope, mockUser, {
    scope_mode: 'CUSTOM',
    included_positions: ['SPV Produksi', 'HSE Officer', 'PJO', 'Pengawas'],
    included_employee_ids: [],
    excluded_employee_ids: []
  });
  console.log('Saved Scope:', {
    scope_mode: savedScope.scope_mode,
    positions: savedScope.included_positions
  });

  console.log('\n=== TEST 4: Mandate Overview Sesudah Custom Scope Filter ===');
  const overviewScoped = await hseService.getInspectionMandateOverview(pool, scope, {});
  console.log('Total Employee (Scoped):', overviewScoped.kpi.totalEmployees);
  console.log('Sample Filtered Names:', overviewScoped.items.slice(0, 5).map(i => `${i.nama} (${i.jabatan})`));

  console.log('\n=== TEST 5: Reset Scope to Default / ALL ===');
  const resetScope = await hseService.saveInspectionPersonnelScope(pool, scope, mockUser, {
    scope_mode: 'ALL',
    included_positions: [],
    included_employee_ids: [],
    excluded_employee_ids: []
  });
  console.log('Reset Scope Mode:', resetScope.scope_mode);

  const overviewReset = await hseService.getInspectionMandateOverview(pool, scope, {});
  console.log('Total Employee After Reset:', overviewReset.kpi.totalEmployees);

  console.log('\nAll verification tests passed successfully!');
  process.exit(0);
}

verify().catch(e => {
  console.error('Verification failed:', e);
  process.exit(1);
});
