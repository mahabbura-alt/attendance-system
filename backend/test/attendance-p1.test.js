const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { pool } = require('../src/config/db');
const { requireAuth } = require('../src/middleware/auth');
const {
  getWibClock,
  selectAttendanceShift,
  operationalDateForShift,
  rosterStatusForShift,
} = require('../src/services/attendancePolicy');

test('shift attendance tersedia sepanjang hari tanpa window datang', () => {
  const shifts = [
    { id: 'day', nama_shift: 'Regu Alpha', operational_start: '06:00:00', lintas_hari: false },
    { id: 'night', nama_shift: 'Regu Beta', operational_start: '18:00:00', lintas_hari: true },
  ];
  assert.equal(selectAttendanceShift(shifts, 4 * 60)?.id, 'night');
  assert.equal(selectAttendanceShift(shifts, 12 * 60)?.id, 'day');
  assert.equal(selectAttendanceShift(shifts, 16 * 60, 'night')?.id, 'night');
  assert.equal(selectAttendanceShift(shifts, 23 * 60, 'day')?.id, 'day');
  assert.equal(operationalDateForShift(
    { date: '2026-09-09', minutes: 60 },
    shifts[1],
  ), '2026-09-08');
});

test('tanggal dan jam operasional menggunakan WIB secara deterministik', () => {
  assert.deepEqual(getWibClock(new Date('2026-09-07T18:30:00Z')), {
    date: '2026-09-08', minutes: 90, display: '01:30',
  });
});

test('status roster mengikuti konfigurasi lintas hari, bukan nama shift', () => {
  assert.equal(rosterStatusForShift({ nama_shift: 'Regu Alpha', lintas_hari: false }), 'S');
  assert.equal(rosterStatusForShift({ nama_shift: 'Regu Beta', lintas_hari: true }), 'M');
  assert.equal(rosterStatusForShift({ operational_start: '18:00', operational_end: '06:00' }), 'M');
});

test('middleware mengambil status dan role terbaru dari database', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p1-test-secret-at-least-16';
  const token = jwt.sign({ id: 'employee', role: 'admin' }, process.env.JWT_SECRET);
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [{ id: 'employee', role: 'karyawan', lokasi_kantor_id: null }] });
  try {
    const req = { headers: { authorization: `Bearer ${token}` } };
    await new Promise((resolve, reject) => requireAuth(req, {
      status: () => ({ json: reject }),
    }, (error) => error ? reject(error) : resolve()));
    assert.equal(req.user.role, 'karyawan');
  } finally {
    pool.query = originalQuery;
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('middleware menolak token lama milik akun nonaktif', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'p1-test-secret-at-least-16';
  const token = jwt.sign({ id: 'inactive' }, process.env.JWT_SECRET);
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    let response;
    await requireAuth({ headers: { authorization: `Bearer ${token}` } }, {
      status(code) { return { json(body) { response = { code, body }; } }; },
    }, (error) => { if (error) throw error; });
    assert.equal(response.code, 401);
    assert.equal(response.body.code, 'ACCOUNT_INACTIVE');
  } finally {
    pool.query = originalQuery;
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('checkout update memiliki compare-and-set terhadap sesi yang masih terbuka', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/absensiController.js'), 'utf8');
  assert.match(source, /WHERE id = \$7 AND waktu_pulang IS NULL/);
  assert.match(source, /ATTENDANCE_ALREADY_CHECKED_OUT/);
});

test('attendance tidak lagi mengikat lokasi akun atau nama shift hardcoded', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/absensiController.js'), 'utf8');
  assert.doesNotMatch(source, /if \(!user\.lokasi_kantor_id\)/);
  assert.doesNotMatch(source, /targetShiftName|nama_shift ILIKE/);
  assert.match(source, /getRosterForUserDate/);
  // Shift absen ditentukan dari jam server (anchor 16:00 & 03:00) via
  // selectShiftByClock, bukan dari shift akun/roster.
  assert.match(source, /selectShiftByClock/);
  assert.doesNotMatch(source, /ATTENDANCE_NOT_SCHEDULED/);
  assert.doesNotMatch(source, /ATTENDANCE_OUTSIDE_SHIFT_WINDOW/);
  assert.match(source, /syncRosterFromCamera/);
});

test('production API tidak memiliki identitas admin fallback tanpa token', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/routes/production.routes.js'), 'utf8');
  assert.match(source, /router\.use\(requireAuth, requireAdmin\)/);
  assert.doesNotMatch(source, /req\.user\s*=\s*\{[^}]*role:\s*['"]admin['"]/s);
  assert.doesNotMatch(source, /Opsional fallback/i);
});

test('sinkronisasi roster admin dan generator tidak bergantung nama Siang/Malam', () => {
  const adminSource = fs.readFileSync(path.resolve(__dirname, '../src/controllers/adminController.js'), 'utf8');
  const rosterSource = fs.readFileSync(path.resolve(__dirname, '../src/services/roster.js'), 'utf8');
  assert.match(adminSource, /rosterStatusForShift\(shiftDipilih\)/);
  assert.doesNotMatch(adminSource, /\/siang\/i\.test\(shiftDipilih\.nama_shift\)/);
  assert.match(rosterSource, /WHERE lintas_hari = FALSE/);
  assert.match(rosterSource, /WHERE lintas_hari = TRUE/);
  assert.doesNotMatch(rosterSource, /nama_shift ILIKE '%Siang%'/);
  assert.doesNotMatch(rosterSource, /nama_shift ILIKE '%Malam%'/);
});
