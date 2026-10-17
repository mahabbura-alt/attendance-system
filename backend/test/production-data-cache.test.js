'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/config/db');
const { getReport } = require('../src/controllers/productionDataController');

test('ETag revision-aware menghentikan report rebuild ketika sumber belum berubah', async () => {
  const originalConnect = pool.connect;
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes('AS revision')) return { rows: [{ revision: 'same-revision' }] };
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => db;
  const headers = {};
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { headers[name] = value; return this; },
    end() { this.ended = true; return this; },
    json(value) { this.body = value; return this; },
  };
  try {
    await getReport({ query: { year: 2026, month: 9 }, headers: { 'if-none-match': '"pd-v3-2026-9-same-revision"' }, user: {} }, res);
  } finally { pool.connect = originalConnect; }
  assert.equal(res.statusCode, 304);
  assert.equal(headers.ETag, '"pd-v3-2026-9-same-revision"');
  assert.match(headers['Cache-Control'], /must-revalidate/);
  assert.equal(headers.Vary, 'Authorization');
  assert.match(headers['Server-Timing'], /revision/);
  assert.equal(calls.some(sql => sql.includes('FROM fleet_mappings fm') && sql.includes('excavator_kode')), false,
    'query penyusun laporan tidak boleh berjalan pada ETag yang masih valid');
});
