const test = require('node:test');
const assert = require('node:assert/strict');

const { generateRosterRange } = require('../src/services/roster');

test('generateRosterRange ranks overlapping assignments before upsert', async () => {
  let capturedSql = '';
  const db = {
    async query(sql) {
      capturedSql = sql;
      return { rows: [] };
    },
  };

  await generateRosterRange('2026-09-08', '2026-09-21', null, db, 'Driver DT');

  assert.match(capturedSql, /ROW_NUMBER\(\) OVER/);
  assert.match(capturedSql, /PARTITION BY a\.user_id, hari\.tanggal/);
  assert.match(capturedSql, /WHERE candidate_rank = 1/);
  assert.match(capturedSql, /ON CONFLICT \(user_id, tanggal\) DO UPDATE/);
});
