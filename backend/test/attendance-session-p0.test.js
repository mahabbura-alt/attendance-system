const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/config/db');
const { riwayat } = require('../src/controllers/absensiController');

test('history reconciles only authenticated user before returning session state', async () => {
  const original = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('UPDATE absensi')) return { rows: [] };
    return { rows: [{ id: 'session', waktu_pulang: '2026-09-08T00:00:00Z', foto_datang_url: null, foto_pulang_url: null }] };
  };
  try {
    const headers = {};
    let body;
    await riwayat({ user: { id: 'authenticated-user' }, query: { user_id: 'another-user' } }, {
      setHeader: (key, value) => { headers[key] = value; }, json: value => { body = value; },
    }, error => { throw error; });
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /UPDATE absensi/);
    assert.match(calls[0].sql, /waktu_pulang IS NULL/);
    assert.match(calls[0].sql, /INTERVAL '13 hours'/);
    for (const call of calls) assert.deepEqual(call.params, ['authenticated-user']);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.ok(body[0].waktu_pulang);
  } finally { pool.query = original; }
});

test('history reconciliation failure is reported rather than returning stale state', async () => {
  const original = pool.query;
  const failure = new Error('database unavailable');
  pool.query = async () => { throw failure; };
  try {
    let received;
    await riwayat({ user: { id: 'user' } }, {
      json: () => assert.fail('must not return stale success'),
    }, error => { received = error; });
    assert.equal(received, failure);
  } finally { pool.query = original; }
});
