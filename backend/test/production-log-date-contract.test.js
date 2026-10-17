'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/config/db');
const ProductionController = require('../src/controllers/production.controller');

test('Input Data API returns operational DATE as YYYY-MM-DD without UTC date shift', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    return {
      rows: [{
        id: 'sample-log',
        tanggal: '2026-10-02',
        nama_shift: 'Shift Malam',
        kode_alat: 'EX20 2-18',
        hm_start: '2024.60',
        hm_finish: '2027.20'
      }]
    };
  };

  try {
    let response;
    await ProductionController.getProductionLogs(
      { query: { year: '2026', month: '10' } },
      {
        json(value) { response = value; },
        status(code) {
          return { json(value) { response = { code, ...value }; } };
        }
      }
    );

    assert.match(calls[0].sql, /mpl\.tanggal::text AS tanggal/);
    assert.equal(response[0].tanggal, '2026-10-02');
    assert.equal(JSON.parse(JSON.stringify(response))[0].tanggal, '2026-10-02');
    assert.equal(response[0].nama_shift, 'Shift Malam');
  } finally {
    pool.query = originalQuery;
  }
});
