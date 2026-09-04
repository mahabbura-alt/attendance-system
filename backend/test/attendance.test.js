process.env.TZ = 'Asia/Jakarta';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dalamRadius } = require('../src/utils/geofence');
const { statusAbsenDatang, statusAbsenPulang } = require('../src/utils/shiftValidator');

test('geofence menerima titik di dalam radius dan menolak titik di luar radius', () => {
  const kantor = { latitude: -6.2, longitude: 106.816666, radius_meter: 100 };
  assert.equal(dalamRadius(-6.2, 106.816666, kantor).valid, true);
  assert.equal(dalamRadius(-6.2015, 106.816666, kantor).valid, false);
});

test('shift reguler menandai keterlambatan dan checkout terlalu dini', () => {
  const shift = { jam_masuk_maks: '06:10:00', jam_pulang_min: '18:00:00', lintas_hari: false };
  const tanggal = new Date('2026-07-29T00:00:00');
  assert.equal(statusAbsenDatang(shift, tanggal, new Date('2026-07-29T06:10:00')), 'tepat waktu');
  assert.equal(statusAbsenDatang(shift, tanggal, new Date('2026-07-29T06:11:00')), 'telat');
  assert.equal(statusAbsenPulang(shift, tanggal, new Date('2026-07-29T17:59:00')), 'pulang awal');
});

test('shift lintas hari menerima checkout setelah tengah malam', () => {
  const shift = { jam_masuk_maks: '18:10:00', jam_pulang_min: '06:00:00', lintas_hari: true };
  const tanggal = new Date('2026-07-29T00:00:00');
  assert.equal(statusAbsenPulang(shift, tanggal, new Date('2026-07-30T06:00:00')), 'tepat waktu');
});
