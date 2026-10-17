'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-yang-panjang-sekali';

const dbCfg = require('../src/config/db');
const mobile = require('../src/services/fuelMobile');
const auth = require('../src/services/fuelMobileAuth');
const access = require('../src/services/fuelAccess');
const fuelInventory = require('../src/services/fuelInventory');
const { requireAuth } = require('../src/middleware/auth');

function mockPool(handler) {
  const lama = { query: dbCfg.pool.query, connect: dbCfg.pool.connect };
  const query = async (sql, args = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    const out = await handler(sql, args);
    if (out === undefined) throw new Error(`SQL tak dikenali mock: ${sql.slice(0, 90)}`);
    return out;
  };
  dbCfg.pool.query = query;
  dbCfg.pool.connect = async () => ({ query, release() {} });
  return () => { dbCfg.pool.query = lama.query; dbCfg.pool.connect = lama.connect; };
}

/* ---------- rumus (validasi formula V3/V4) ---------- */

test('V3 hmGapCheck: dasar filled_at, fallback awal shift (lebih longgar), hanya peringatan bila melebihi', () => {
  const tepat = mobile.hmGapCheck({ previousHm: 12345.5, previousAt: '2026-10-16T15:10:00Z',
    currentHm: 12355, currentAt: '2026-10-16T23:16:00Z', toleranceHours: 1 });
  assert.equal(tepat.basis, 'filled_at');
  assert.ok(Math.abs(tepat.elapsedHours - 8.1) < 1e-9);
  assert.equal(tepat.exceeded, true, '9,5 j > 8,1 j + 1 j');

  const longgar = mobile.hmGapCheck({ previousHm: 100, previousAt: null,
    previousShiftStartAt: mobile.shiftStartIso('2026-10-16', 'siang'), currentHm: 108, currentAt: '2026-10-16T09:00:00Z' });
  assert.equal(longgar.basis, 'shift_start');
  assert.equal(longgar.exceeded, false, 'awal shift 06:00 WIB → 9 jam berlalu, delta 8 j aman');

  assert.equal(mobile.hmGapCheck({ previousHm: 1, previousAt: null, currentHm: 2, currentAt: '2026-10-16T09:00:00Z' }).checked, false);
});

test('V4 totalizerVariance: ambang maks(0,5% × delta, 20 L), dua arah, rollover', () => {
  const contoh = mobile.totalizerVariance({ open: 1284530, close: 1292680, recordedOut: 8060 });
  assert.equal(contoh.meterDelta, 8150);
  assert.equal(contoh.variance, 90);
  assert.ok(Math.abs(contoh.threshold - 40.75) < 1e-9);
  assert.equal(contoh.investigate, true);

  const kecil = mobile.totalizerVariance({ open: 0, close: 1000, recordedOut: 985 });
  assert.equal(kecil.threshold, 20, 'lantai 20 L saat 0,5% < 20 L');
  assert.equal(kecil.investigate, false);

  assert.equal(mobile.totalizerVariance({ open: 0, close: 1000, recordedOut: 1030 }).investigate, true, 'selisih negatif juga diperiksa');
  const roll = mobile.totalizerVariance({ open: 999990, close: 120, recordedOut: 100 });
  assert.equal(roll.rollover, true);
  assert.equal(roll.investigate, true);
});

test('slot operasional mengikuti hari mulai 06:00 WIB', () => {
  assert.deepEqual(mobile.operationalSlot('2026-10-16T22:59:00Z'), { operational_date: '2026-10-16', shift_kind: 'malam' }, '05:59 WIB 17 Okt');
  assert.deepEqual(mobile.operationalSlot('2026-10-16T23:00:00Z'), { operational_date: '2026-10-17', shift_kind: 'siang' }, '06:00 WIB 17 Okt');
  assert.deepEqual(mobile.operationalSlot('2026-10-17T11:00:00Z'), { operational_date: '2026-10-17', shift_kind: 'malam' }, '18:00 WIB');
});

test('entri terlambat, payload QR, akses lokasi', () => {
  assert.equal(mobile.isLateEntry('2026-10-17T00:00:00Z', '2026-10-17T03:00:00Z', 2), true);
  assert.equal(mobile.isLateEntry('2026-10-17T00:00:00Z', '2026-10-17T01:00:00Z', 2), false);
  assert.equal(mobile.parseScanPayload('OMOS:EQ:EQ-7K3M9Q'), 'EQ-7K3M9Q');
  assert.equal(mobile.parseScanPayload('loc-2m8vxa'), 'LOC-2M8VXA');
  assert.equal(mobile.parseScanPayload('EQ-7K3M9O'), null, 'huruf O tidak dipakai');
  assert.equal(mobile.canUseLocation({ locationIds: ['a'] }, 'a'), true);
  assert.equal(mobile.canUseLocation({ locationIds: [] }, 'a'), false);
});

test('PIN: format, PIN trivial ditolak, PIN sementara acak non-trivial', () => {
  assert.equal(auth.validPinFormat('123456'), true);
  assert.equal(auth.validPinFormat('12345'), false);
  for (const pin of ['000000', '123456', '654321', '345678']) assert.equal(auth.isTrivialPin(pin), true, pin);
  assert.equal(auth.isTrivialPin('482915'), false);
  for (let i = 0; i < 50; i += 1) {
    const pin = auth.generateTempPin();
    assert.equal(auth.validPinFormat(pin), true);
    assert.equal(auth.isTrivialPin(pin), false);
  }
});

test('fungsi akun hanya dari daftar yang dikenal', () => {
  assert.deepEqual(access.normalizeFunctions(['fill', 'fill', 'shift']), ['fill', 'shift']);
  assert.throws(() => access.normalizeFunctions(['fill', 'hapus']), /tidak dikenal/);
  assert.equal(access.qrPayload('equipment', 'EQ-7K3M9Q'), 'OMOS:EQ:EQ-7K3M9Q');
});

/* ---------- login PIN + perangkat ---------- */

test('login: PIN salah dihitung lalu terkunci; perangkat pending ditolak; sukses → token fuel_mobile', async () => {
  const hash = await bcrypt.hash('482915', 4);
  const akun = { id: 'u-1', nama: 'Andi', employee_id: 'PIM-02117', role: 'karyawan', pin_hash: hash, must_change_pin: false,
    allowed_functions: ['fill'], allowed_location_ids: ['loc-1'], failed_attempts: 3, locked_at: null };
  const device = { id: 'dev-1', device_code: 'DV-AB2C3D', status: 'pending' };
  const pulih = mockPool(async (sql, args) => {
    if (sql.includes('FROM fuel_mobile_settings')) return { rows: [{ pin_max_attempts: 5 }] };
    if (sql.includes('JOIN fuel_operator_accounts a')) {
      // Employee ID dibandingkan case-insensitive di SQL (regresi E2E: ID huruf besar tidak cocok).
      assert.match(sql, /LOWER\(TRIM\(u\.employee_id\)\) = LOWER\(\$1\)/);
      return { rows: [{ ...akun }] };
    }
    if (sql.includes('UPDATE fuel_operator_accounts SET failed_attempts = $2')) {
      akun.failed_attempts = args[1]; if (args[2]) akun.locked_at = new Date(); return { rows: [] };
    }
    if (sql.includes('UPDATE fuel_operator_accounts SET failed_attempts = 0')) { akun.failed_attempts = 0; return { rows: [] }; }
    if (sql.includes('INSERT INTO fuel_devices')) return { rows: [{ ...device }] };
    return undefined;
  });
  try {
    const dasar = { employee_id: 'PIM-02117', device_uid: 'android-abc12345' };
    await assert.rejects(auth.login({ ...dasar, pin: '111222' }), e => e.code === 'INVALID_CREDENTIALS' && e.details.remaining_attempts === 1);
    await assert.rejects(auth.login({ ...dasar, pin: '111222' }), e => e.code === 'ACCOUNT_LOCKED' && e.status === 423);
    await assert.rejects(auth.login({ ...dasar, pin: '482915' }), e => e.code === 'ACCOUNT_LOCKED', 'tetap terkunci walau PIN benar');

    akun.locked_at = null; akun.failed_attempts = 0;
    await assert.rejects(auth.login({ ...dasar, pin: '482915' }), e => e.code === 'DEVICE_PENDING' && e.details.device_code === 'DV-AB2C3D');

    device.status = 'approved';
    const ok = await auth.login({ ...dasar, pin: '482915' });
    const claim = jwt.verify(ok.token, process.env.JWT_SECRET);
    assert.equal(claim.scope, 'fuel_mobile');
    assert.equal(claim.fuel_device_id, 'dev-1');
    assert.deepEqual(ok.access, { functions: ['fill'], location_ids: ['loc-1'] });
    assert.equal(ok.user.pin_hash, undefined, 'hash PIN tidak bocor ke respons');
  } finally {
    pulih();
  }
});

/* ---------- cakupan token ---------- */

async function jalankanAuth(token, baseUrl) {
  const req = { headers: { authorization: `Bearer ${token}` }, baseUrl, path: '/x' };
  let status = null; let lanjut = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  await requireAuth(req, res, () => { lanjut = true; });
  return { status, lanjut, req };
}

test('token fuel_mobile hanya berlaku untuk API Fuel; peran admin tidak terbawa', async () => {
  const pulih = mockPool(async sql => (sql.includes('FROM users') ? { rows: [{ id: 'u-1', role: 'admin', permissions: [] }] } : undefined));
  try {
    const token = jwt.sign({ id: 'u-1', role: 'admin', scope: 'fuel_mobile', fuel_device_id: 'dev-1' }, process.env.JWT_SECRET);
    const absensi = await jalankanAuth(token, '/api/absensi');
    assert.equal(absensi.status, 403);
    assert.equal(absensi.lanjut, false);
    const fuel = await jalankanAuth(token, '/api/fuel/mobile');
    assert.equal(fuel.lanjut, true);
    assert.equal(fuel.req.user.role, 'karyawan');
    assert.equal(fuel.req.user.token_scope, 'fuel_mobile');
    const bukti = await jalankanAuth(token, '/api/fuel-evidence');
    assert.equal(bukti.lanjut, true);
    const biasa = await jalankanAuth(jwt.sign({ id: 'u-1', role: 'admin' }, process.env.JWT_SECRET), '/api/absensi');
    assert.equal(biasa.lanjut, true, 'token login biasa tidak terpengaruh');
  } finally {
    pulih();
  }
});

/* ---------- sinkronisasi: gerbang hak akses ---------- */

test('sync: item ditolak per item (fungsi, PIN sementara, client_uuid) tanpa menggagalkan item lain', async () => {
  const pulih = mockPool(async sql => (sql.includes('FROM fuel_mobile_settings') ? { rows: [{}] } : undefined));
  try {
    const fuel = { functions: ['fill'], locationIds: [], mustChangePin: false, device: { id: 'dev-1', status: 'approved' } };
    const uuid = () => require('node:crypto').randomUUID();
    const out = await mobile.sync([
      { client_uuid: 'bukan-uuid', type: 'fill', payload: {} },
      { client_uuid: uuid(), type: 'receipt', payload: {} },
      { client_uuid: uuid(), type: 'fill', payload: { filled_at: '2026-10-17T00:00:00Z', source_location_id: uuid() } },
    ], { id: 'u-1' }, fuel);
    assert.deepEqual(out.results.map(r => r.result), ['rejected', 'rejected', 'rejected']);
    assert.deepEqual(out.results.map(r => r.code), ['BAD_REQUEST', 'FUNCTION_FORBIDDEN', 'LOCATION_FORBIDDEN']);

    const wajibGanti = await mobile.sync([{ client_uuid: uuid(), type: 'fill', payload: {} }], { id: 'u-1' }, { ...fuel, mustChangePin: true });
    assert.equal(wajibGanti.results[0].code, 'PIN_CHANGE_REQUIRED');
  } finally {
    pulih();
  }
});

test('perangkat dicabut: transaksi sesudah pencabutan ditolak', async () => {
  const pulih = mockPool(async sql => (sql.includes('FROM fuel_mobile_settings') ? { rows: [{}] } : undefined));
  try {
    const fuel = { functions: ['fill'], locationIds: ['x'], mustChangePin: false,
      device: { id: 'dev-1', status: 'revoked', revoked_at: '2026-10-17T00:00:00Z' } };
    const out = await mobile.sync([{ client_uuid: require('node:crypto').randomUUID(), type: 'fill',
      payload: { filled_at: '2026-10-17T02:00:00Z', recorded_at: '2026-10-17T02:00:00Z' } }], { id: 'u-1' }, fuel);
    assert.equal(out.results[0].code, 'DEVICE_REVOKED');
  } finally {
    pulih();
  }
});

/* ---------- transfer: validasi per grup ---------- */

test('kaki transfer tidak bisa diposting/void satu per satu', async () => {
  const baris = { id: 't-1', status: 'draft', transfer_group_id: 'g-1', transaction_type: 'transfer_out', lines: [] };
  const pulih = mockPool(async sql => (sql.includes('FROM fuel_inventory_transactions t') ? { rows: [baris] }
    : sql.includes('WHERE id = $1 FOR UPDATE') ? { rows: [] } : undefined));
  try {
    await assert.rejects(fuelInventory.postTransaction('t-1', 'admin'), e => e.code === 'TRANSFER_GROUP');
    await assert.rejects(fuelInventory.voidDraft('t-1', 'admin', 'x'), e => e.code === 'TRANSFER_GROUP');
    await assert.rejects(fuelInventory.voidTransferGroup('g-1', 'admin', ''), /Alasan/);
  } finally {
    pulih();
  }
});

test('QR label dirender server sebagai SVG berisi payload OMOS', async () => {
  const svg = await access.qrSvg(access.qrPayload('equipment', 'EQ-7K3M9Q'));
  assert.match(svg, /^<svg[^>]+viewBox/);
  assert.ok(svg.length > 500);
});

test('tglIso: kolom DATE node-pg (objek Date) jadi YYYY-MM-DD (regresi E2E posting)', () => {
  assert.equal(fuelInventory.tglIso(new Date(2026, 9, 17)), '2026-10-17');
  assert.equal(fuelInventory.tglIso('2026-10-17T00:00:00.000Z'), '2026-10-17');
  assert.equal(fuelInventory.tglIso(null), '');
});
