'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Forecast = require('../src/services/workforceForecast');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const SCOPE = { tenantKey: 'default', projectKey: 'default' };
const USER = { id: 'admin-1' };

function forecastDb() {
  return { query: async sql => {
    if (sql.includes('FROM workforce_mpp_line_periods mp')) {
      return { rows: [
        { position_id: 'p1', period_month: '2026-11-01', required_qty: 62 },
        { position_id: 'p1', period_month: '2026-12-01', required_qty: 62 },
      ] };
    }
    if (sql.includes('FROM workforce_mpp_plans')) return { rows: [{ id: 'plan-1', version_no: 1, status: 'DRAFT' }] };
    if (sql.includes('FROM workforce_positions pos')) {
      return { rows: [
        { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'p1', position_snapshot: 'Operator',
          line_id: 'l1', is_critical: true, required_qty: 60, actual: 54, revision: 1 },
        { department_id: 'd1', department_snapshot: 'Produksi', position_id: 'p2', position_snapshot: 'Foreman',
          line_id: 'l2', is_critical: false, required_qty: 8, actual: 8, revision: 1 },
      ] };
    }
    if (sql.includes('FROM workforce_mpp_line_periods mp')) {
      return { rows: [
        { position_id: 'p1', period_month: '2026-11-01', required_qty: 62 },
        { position_id: 'p1', period_month: '2026-12-01', required_qty: 62 },
      ] };
    }
    if (sql.includes('FROM workforce_employee_movements m')) {
      return { rows: [
        { id: 'm1', movement_no: 'MOV-2611-000001', movement_type: 'HIRE', effective_date: '2026-11-15',
          before_state: {}, after_state: { department: 'Produksi', position: 'Operator' },
          employee_profile_id: 'prof-1', request_position_id: null },
        { id: 'm2', movement_no: 'MOV-2612-000002', movement_type: 'RESIGN', effective_date: '2026-12-10',
          before_state: { department: 'Produksi', position: 'Foreman' }, after_state: {},
          employee_profile_id: 'prof-2', request_position_id: null },
        { id: 'm3', movement_no: 'MOV-2701-000003', movement_type: 'TRANSFER', effective_date: '2027-01-05',
          before_state: { department: 'Produksi', position: 'Operator' },
          after_state: { department: 'Produksi', position: 'Foreman' },
          employee_profile_id: 'prof-3', request_position_id: null },
      ] };
    }
    if (sql.includes('FROM workforce_employee_assignments a')) {
      return { rows: [
        { employee_profile_id: 'prof-2', position_id: 'p2', department_snapshot: 'Produksi', position_snapshot: 'Foreman' },
        { employee_profile_id: 'prof-3', position_id: 'p1', department_snapshot: 'Produksi', position_snapshot: 'Operator' },
      ] };
    }
    if (sql.includes('FROM workforce_employee_profiles ep')) {
      return { rows: [
        { nama: 'Budi', contract_end_date: '2026-12-20', position_id: 'p1',
          department_snapshot: 'Produksi', position_snapshot: 'Operator' },
      ] };
    }
    throw new Error('Unexpected SQL: ' + String(sql).slice(0, 70));
  } };
}

test('monthRange: leap year, year boundary, invalid span', () => {
  assert.deepEqual(Forecast.monthRange('2023-12', '2024-02').months, ['2024-01', '2024-02']);
  assert.deepEqual(Forecast.monthRange('2026-10', '2027-01').months, ['2026-11', '2026-12', '2027-01']);
  assert.throws(() => Forecast.monthRange('2026-10', '2026-10'), /setelah bulan baseline/);
  assert.throws(() => Forecast.monthRange('2026-10', '2027-11'), /maksimal 12 bulan/);
  assert.equal(Forecast.labelMonth('2026-11'), 'Nov 2026');
});

test('forecast: hire/exit/mutasi deterministik + variance + risiko + lineage', async () => {
  const fc = await Forecast.getForecast(forecastDb(), SCOPE, '2026-10', '2027-01');
  assert.deepEqual(fc.months, ['2026-11', '2026-12', '2027-01']);
  assert.equal(fc.baseline_date, '2026-10-31');
  const op = fc.positions.find(row => row.position_id === 'p1');
  const foreman = fc.positions.find(row => row.position_id === 'p2');
  assert.deepEqual(op.forecast, { '2026-11': 55, '2026-12': 55, '2027-01': 54 });
  assert.deepEqual(foreman.forecast, { '2026-11': 8, '2026-12': 7, '2027-01': 8 });
  assert.equal(op.variance['2026-11'], -7);
  assert.equal(foreman.variance['2026-12'], null);
  assert.equal(op.risk, 'Kritis');
  assert.equal(foreman.risk, 'Aman');
  assert.deepEqual(op.causes['2026-11'], ['+1 masuk']);
  assert.deepEqual(op.causes['2026-12'], ['1 kontrak berakhir']);
  assert.deepEqual(op.lineage['2026-11'], { added: 1, exited: 0, in: 0, out: 0, contracts: 0, movements: ['MOV-2611-000001'] });
  assert.equal(fc.totals['2026-11'].forecast, 63);
  assert.equal(fc.totals['2026-11'].required, null, 'foreman tanpa required -> total required null, bukan angka buatan');
  assert.equal(fc.meta.approved_movements, 3);
  assert.equal(fc.meta.contracts_ending, 1);
  assert.equal(fc.meta.unmapped_events, 0);
});

test('forecast: movement DRAFT/SUBMITTED tidak ikut; hanya APPROVED', async () => {
  const db = forecastDb();
  const origQuery = db.query;
  db.query = async sql => {
    if (sql.includes('FROM workforce_employee_movements m')) return { rows: [] };
    return origQuery(sql);
  };
  const fc = await Forecast.getForecast(db, SCOPE, '2026-10', '2026-11');
  const op = fc.positions.find(row => row.position_id === 'p1');
  assert.equal(op.forecast['2026-11'], 54);
  assert.equal(fc.meta.approved_movements, 0);
});

test('forecast: jabatan tak terpetakan tercatat unmapped, bukan crash', async () => {
  const db = forecastDb();
  const origQuery = db.query;
  db.query = async sql => {
    if (sql.includes('FROM workforce_employee_movements m')) {
      return { rows: [{ id: 'mx', movement_no: 'MOV-2611-000009', movement_type: 'HIRE',
        effective_date: '2026-11-20', before_state: {}, after_state: { department: 'X', position: 'Y' },
        employee_profile_id: 'prof-9', request_position_id: null }] };
    }
    return origQuery(sql);
  };
  const fc = await Forecast.getForecast(db, SCOPE, '2026-10', '2026-11');
  assert.equal(fc.meta.unmapped_events, 1);
});

function scenarioPool() {
  const log = [];
  const client = {
    release() {},
    async query(sql, params) {
      log.push({ sql, params });
      if (sql.includes('FROM workforce_positions p JOIN')) {
        return { rows: [{ position_id: 'pos-1', position_name: 'Operator', department_id: 'dep-1', department_name: 'Produksi' }] };
      }
      if (sql.startsWith('INSERT INTO workforce_mpp_scenarios')) return { rows: [{ id: 'sc-1', name: 'Tambah fleet' }] };
      if (sql.startsWith('INSERT INTO workforce_mpp_scenario_lines')) return { rows: [] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      throw new Error('Unexpected SQL: ' + String(sql).slice(0, 70));
    },
  };
  return { log, pool: { connect: async () => client, query: (sql, params) => client.query(sql, params) } };
}

test('scenario: tersimpan terpisah + validasi duplikat/jabatan', async () => {
  const { pool } = scenarioPool();
  const { scenario } = await Forecast.createScenario(pool, USER, { name: 'Tambah fleet', base_period: '2026-10',
    lines: [{ position_id: 'pos-1', period_month: '2026-11-01', required_qty: 65 }] });
  assert.equal(scenario.simulation, true);
  await assert.rejects(Forecast.createScenario(scenarioPool().pool, USER, { name: 'X', base_period: '2026-10',
    lines: [
      { position_id: 'pos-1', period_month: '2026-11-01', required_qty: 65 },
      { position_id: 'pos-1', period_month: '2026-11-01', required_qty: 66 },
    ] }), /duplikat/);
  await assert.rejects(Forecast.createScenario(scenarioPool().pool, USER, { name: 'X', base_period: '2026-10',
    lines: [{ position_id: 'pos-unknown', period_month: '2026-11-01', required_qty: 65 }] }),
    /tidak tersedia pada project/);
  await assert.rejects(Forecast.deleteScenario({ query: async () => ({ rows: [] }) }, SCOPE, 'sc-x'), /tidak ditemukan/);
});

test('scenario: detail membandingkan delta vs approved, bukan menimpa', async () => {
  const db = { query: async sql => {
    if (sql.includes('FROM workforce_mpp_scenarios s')) {
      return { rows: [{ id: 'sc-1', name: 'Tambah fleet', base_period: '2026-10-01' }] };
    }
    if (sql.includes('FROM workforce_mpp_scenario_lines')) {
      return { rows: [{ scenario_id: 'sc-1', period_month: '2026-11-01', position_id: 'p1',
        position_snapshot: 'Operator', required_qty: 65 }] };
    }
    if (sql.includes('FROM workforce_mpp_line_periods mp')) {
      return { rows: [{ position_id: 'p1', period_month: '2026-11-01', required_qty: 62 }] };
    }
    throw new Error('Unexpected SQL: ' + String(sql).slice(0, 70));
  } };
  const detail = await Forecast.getScenario(db, SCOPE, 'sc-1');
  assert.equal(detail.scenario.simulation, true);
  assert.equal(detail.lines[0].approved_required_qty, 62);
  assert.equal(detail.lines[0].delta_vs_approved, 3);
});

test('migration 069 hanya scenario terpisah; tidak menyentuh approved MPP', () => {
  const sql = read('migrations/069_workforce_mpp_scenarios.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workforce_mpp_scenarios/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workforce_mpp_scenario_lines/);
  assert.doesNotMatch(sql, /(ALTER|INSERT INTO|UPDATE|DELETE FROM) workforce_mpp_plans/);
  assert.doesNotMatch(sql, /(ALTER|INSERT INTO|UPDATE|DELETE FROM) workforce_mpp_lines /);
  assert.doesNotMatch(sql, /(ALTER|INSERT INTO|UPDATE|DELETE FROM) workforce_mpp_line_periods/);
});

test('forecast routes behind admin auth', () => {
  const routes = read('src/routes/karyawan.routes.js');
  assert.ok(routes.indexOf('router.use(requireAuth, requireAdmin)') < routes.indexOf("router.get('/workforce/mpp/forecast'"));
  for (const path of ['/workforce/mpp/forecast', '/workforce/mpp/scenarios', '/workforce/mpp/scenarios/:id']) {
    assert.match(routes, new RegExp(path.replace(/[/:]/g, '\\$&')));
  }
});
