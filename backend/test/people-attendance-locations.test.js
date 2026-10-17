'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createPeopleDb } = require('./helpers/peopleFixture');
const People = require('../src/services/peopleEmployees');

const opt = { skip: !available };

function loadController(db) {
  const dbPath = require.resolve('../src/config/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: db } };
  const ctrlPath = require.resolve('../src/controllers/absensiController');
  delete require.cache[ctrlPath];
  return require('../src/controllers/absensiController');
}

function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
    handler({ headers: {}, ...req }, res, reject);
  });
}

test('Absen: lokasi dibatasi sesuai daftar karyawan; tanpa daftar = semua lokasi', opt, async () => {
  const f = await createPeopleDb();
  try {
    const r = await People.createEmployee(f.db, f.scope, f.admin, {
      nama: 'Rizky', email: 'rizky@pim.co.id', position_id: f.positions.operatorDt.id, hire_date: '2026-10-01',
      employment_type: 'PKWTT', lokasi_ids: [f.lokasi.pit3.id], send_invite: false,
    }, { today: '2026-10-12' });
    const C = loadController(f.db);
    const atPit1 = { latitude: -3.40, longitude: 115.90, accuracy: 10 };
    let out = await call(C.checkLokasi, { user: { id: r.user_id }, body: atPit1 });
    assert.equal(out.body.valid, false, 'Pos Pit 1 tidak diizinkan untuk karyawan ini');
    assert.match(out.body.message, /lokasi absen Anda \(Pos Pit 3\)/);
    out = await call(C.checkLokasi, { user: { id: r.user_id }, body: { latitude: -3.50, longitude: 115.95, accuracy: 10 } });
    assert.equal(out.body.valid, true);

    await People.setAttendanceLocations(f.db, f.scope, f.admin, r.user_id, { mode: 'ALL', reason: 'Boleh di semua pos' });
    out = await call(C.checkLokasi, { user: { id: r.user_id }, body: atPit1 });
    assert.equal(out.body.valid, true, 'mode Semua lokasi');
    const mine = await call(C.lokasiKantorSaya, { user: { id: r.user_id } });
    assert.equal(mine.body.lokasi_absen, null);
  } finally { await f.db.close(); }
});
