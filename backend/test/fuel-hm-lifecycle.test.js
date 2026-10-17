const test = require('node:test');
const assert = require('node:assert/strict');

const FuelHmLifecycle = require('../src/services/fuelHmLifecycle');

test('recalculateChain isolates legacy data and recalculates the derived lifetime chain', async () => {
  const updates = [];
  const db = {
    async query(sql, params) {
      if (sql.includes('SELECT fl.*')) return { rows: [
        { id: 'legacy', hm_reading_value: 54, hm_lifetime_reading_value: null, hm_lineage_status: 'legacy_unreconciled', fuel_filled: 84, fuel_rate_lph: 20 },
        { id: 'baseline', hm_reading_value: 4.8, hm_lifetime_reading_value: 55.8, hm_lineage_status: 'derived', fuel_filled: 44, fuel_rate_lph: 20 },
        { id: 'next', hm_reading_value: 6.8, hm_lifetime_reading_value: 57.8, hm_lineage_status: 'derived', fuel_filled: 40, fuel_rate_lph: 20 },
      ] };
      if (sql.includes('UPDATE fuel_logs')) { updates.push(params); return { rowCount: 1, rows: [] }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const ids = await FuelHmLifecycle.recalculateChain(db, 'unit-1');
  assert.deepEqual(ids, ['baseline', 'next']);
  assert.equal(updates[0][0], null);
  assert.equal(updates[0][2], 'baseline');
  assert.ok(Math.abs(updates[1][0] - 2) < 1e-9);
  assert.ok(Math.abs(updates[1][1] - 20) < 1e-9);
  assert.equal(updates[1][2], 'derived');
});

test('recalculateChain memakai fallback numerik bertipe eksplisit (hindari inconsistent types $1)', async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (sql.includes('SELECT fl.*')) return { rows: [
        { id: 'x', hm_reading_value: 5, hm_lifetime_reading_value: 60, hm_lineage_status: 'derived', fuel_filled: 50, fuel_rate_lph: 20 },
      ] };
      if (sql.includes('UPDATE fuel_logs')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  await FuelHmLifecycle.recalculateChain(db, 'unit-9');
  const update = seen.find(sql => sql.includes('UPDATE fuel_logs'));
  assert.ok(update.includes('COALESCE($1,0::numeric)'),
    'fallback COALESCE harus bertipe numeric agar konsisten dengan kolom hm_delta NUMERIC');
});
