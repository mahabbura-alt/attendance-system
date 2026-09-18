const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pool } = require('../src/config/db');
const { riwayat, rekapKehadiran } = require('../src/controllers/absensiController');
const { editAbsensiManual } = require('../src/controllers/adminController');

test('riwayat memakai tanggal operasional tersimpan untuk shift lintas tengah malam', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('UPDATE absensi')) return { rows: [] };
    return { rows: [{ tanggal_kerja: '2026-09-17', waktu_datang: '2026-09-17T18:15:00Z', foto_datang_url: null, foto_pulang_url: null }] };
  };
  try {
    let body;
    await riwayat({ user: { id: 'user-1' } }, { setHeader() {}, json(value) { body = value; } }, error => { throw error; });
    assert.equal(body[0].tanggal_kerja, '2026-09-17');
    assert.match(calls[1].sql, /kp\.tanggal = a\.tanggal_kerja/);
    assert.match(calls[1].sql, /COALESCE\(a\.tanggal_kerja, kp\.tanggal\)::text/);
    assert.deepEqual(calls[1].params, ['user-1']);
  } finally { pool.query = originalQuery; }
});

test('rekap 30 hari memfilter DATE operasional langsung, termasuk keterangan presensi', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; };
  try {
    await rekapKehadiran({ user: { id: 'user-1' } }, { json() {} }, error => { throw error; });
    assert.match(calls[0].sql, /tanggal_kerja >= \$2::date/);
    assert.match(calls[1].sql, /tanggal >= \$2::date/);
    assert.doesNotMatch(calls[0].sql, /waktu_datang.*AT TIME ZONE/s);
  } finally { pool.query = originalQuery; }
});

test('edit manual menolak timestamp tanpa zona sebelum transaksi database', async () => {
  const originalConnect = pool.connect;
  let queryCount = 0;
  let released = false;
  pool.connect = async () => ({ query: async () => { queryCount++; }, release: () => { released = true; } });
  try {
    let response;
    await editAbsensiManual({ params: { id: 'row-1' }, body: {
      perubahan: { waktu_datang: '2026-09-18T01:15' }, alasan: 'Koreksi jam'
    } }, {
      status(code) { return { json(body) { response = { code, body }; } }; }
    }, error => { throw error; });
    assert.equal(response.code, 400);
    assert.match(response.body.error, /zona waktu eksplisit/);
    assert.equal(queryCount, 0);
    assert.equal(released, true);
  } finally { pool.connect = originalConnect; }
});

test('portal dan admin mengonversi instant yang sama menjadi WIB walau host UTC', () => {
  const mobileSource = fs.readFileSync(path.resolve(__dirname, '../../mobile-web/karyawan.js'), 'utf8');
  const mobileFunctions = mobileSource.slice(mobileSource.indexOf('const ATTENDANCE_TIME_ZONE'), mobileSource.indexOf('let userToken'));
  const mobileContext = vm.createContext({ Date });
  vm.runInContext(`${mobileFunctions}\nthis.formatTime = formatAttendanceTime; this.formatDate = formatAttendanceWorkDate;`, mobileContext);
  assert.match(mobileContext.formatTime('2026-09-17T18:15:00Z'), /01\.15 WIB|01:15 WIB/);
  assert.equal(mobileContext.formatDate('2026-09-17'), '17 Sep');

  const adminSource = fs.readFileSync(path.resolve(__dirname, '../../admin-dashboard/app.js'), 'utf8');
  const helper = adminSource.match(/function datetimeLocalWibToIso\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const adminContext = vm.createContext({ Date, Error, Number });
  vm.runInContext(`${helper}\nthis.convert = datetimeLocalWibToIso;`, adminContext);
  assert.equal(adminContext.convert('2026-09-18T01:15'), '2026-09-17T18:15:00.000Z');
  assert.throws(() => adminContext.convert('2026-09-18T01:15Z'));
});
