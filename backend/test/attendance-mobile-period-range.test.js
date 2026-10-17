const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/config/db');
const { riwayat, rekapHmKaryawan } = require('../src/controllers/absensiController');

test('Riwayat Absensi memfilter periode milik user terautentikasi', async () => {
  const original = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('UPDATE absensi')) return { rows: [] };
    return { rows: [] };
  };
  try {
    let body;
    await riwayat({
      user: { id: 'employee-1' },
      query: { tanggal_mulai: '2026-09-01', tanggal_akhir: '2026-09-30', user_id: 'employee-2' },
    }, {
      setHeader() {},
      json(value) { body = value; },
    }, error => { throw error; });

    const select = calls.find(call => call.sql.includes('FULL OUTER JOIN keterangan_presensi'));
    assert.ok(select);
    assert.match(select.sql, /COALESCE\(a\.tanggal_kerja, kp\.tanggal\) BETWEEN \$2::date AND \$3::date/);
    assert.deepEqual(select.params, ['employee-1', '2026-09-01', '2026-09-30']);
    assert.deepEqual(body, []);
  } finally {
    pool.query = original;
  }
});

test('range mobile menolak tanggal parsial, terbalik, dan lebih dari 366 hari', async () => {
  const original = pool.query;
  let queryCount = 0;
  pool.query = async () => { queryCount += 1; return { rows: [] }; };
  try {
    for (const query of [
      { tanggal_mulai: '2026-09-01' },
      { tanggal_mulai: '2026-09-30', tanggal_akhir: '2026-09-01' },
      { tanggal_mulai: '2025-01-01', tanggal_akhir: '2026-01-02' },
    ]) {
      let received;
      await riwayat({ user: { id: 'employee-1' }, query }, {
        setHeader() {},
        json() { assert.fail('range invalid tidak boleh menghasilkan response sukses'); },
      }, error => { received = error; });
      assert.equal(received?.statusCode, 400);
    }
    assert.equal(queryCount, 0);
  } finally {
    pool.query = original;
  }
});

test('Rekap HM memakai periode pilihan dan menghitung agregat pada server', async () => {
  const original = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM hm_worklog_cutover')) return { rows: [{ effective_date: '2026-09-15' }] };
    if (sql.includes('GROUP BY tanggal ORDER BY tanggal')) {
      return { rows: [
        { tanggal: '2026-09-20', jam_operasi: '4.25', keterangan: '' },
        { tanggal: '2026-09-21', jam_operasi: '5.75', keterangan: 'Koreksi' },
      ] };
    }
    return { rows: [] };
  };
  try {
    let body;
    await rekapHmKaryawan({
      user: { id: 'employee-1' },
      query: { tanggal_mulai: '2026-09-20', tanggal_akhir: '2026-09-23' },
    }, {
      json(value) { body = value; },
    }, error => { throw error; });

    const aggregate = calls.find(call => call.sql.includes('GROUP BY tanggal ORDER BY tanggal'));
    assert.deepEqual(aggregate.params.slice(0, 3), ['employee-1', '2026-09-20', '2026-09-23']);
    assert.equal(body.total_hm_bulan_ini, 10);
    assert.equal(body.total_hari_operasi, 2);
    assert.equal(body.periode, 'rentang_tanggal');
    assert.match(body.bulan_tahun, /20.*23.*2026/);
  } finally {
    pool.query = original;
  }
});
