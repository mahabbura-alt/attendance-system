process.env.TZ = 'Asia/Jakarta';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dalamRadius, dalamRadiusMultiPoint, validasiAkurasi, MAX_ACCURACY_METER } = require('../src/utils/geofence');
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

// --- Window checkout wajar harus simetris (~6 jam grace dari jam_pulang_min) ---

test('shift lintas hari: window checkout wajar berakhir 11:59:59 (grace 6 jam), bukan 23:59:59', () => {
  const shift = { jam_masuk_maks: '18:10:00', jam_pulang_min: '06:00:00', lintas_hari: true };
  const tanggal = new Date('2026-07-29T00:00:00');
  // masih dalam window (06:00 s.d. 11:59:59)
  assert.equal(statusAbsenPulang(shift, tanggal, new Date('2026-07-30T11:59:00')), 'tepat waktu');
  // lewat window -> checkout lewat (perbaikan bug grace ~18 jam)
  assert.equal(statusAbsenPulang(shift, tanggal, new Date('2026-07-30T12:00:00')), 'checkout lewat');
});

test('shift reguler: window checkout wajar tetap sampai 23:59:59 (tidak berubah)', () => {
  const shift = { jam_masuk_maks: '06:10:00', jam_pulang_min: '18:00:00', lintas_hari: false };
  const tanggal = new Date('2026-07-29T00:00:00');
  assert.equal(statusAbsenPulang(shift, tanggal, new Date('2026-07-29T23:59:00')), 'tepat waktu');
  assert.equal(statusAbsenPulang(shift, tanggal, new Date('2026-07-30T00:00:00')), 'checkout lewat');
});

// --- Multi-point geofence (mendukung perbaikan checkLokasi jujur) ---
// Lokasi nyata produksi: KANTOR (-1.746067, 102.972139) & PARKIRAN TAMBANG (-1.742654, 102.977618)
const lokasiProduksi = [
  { nama_lokasi: 'KANTOR', latitude: -1.746067, longitude: 102.972139, radius_meter: 100 },
  { nama_lokasi: 'PARKIRAN TAMBANG', latitude: -1.742654, longitude: 102.977618, radius_meter: 100 },
];

test('multi-point: valid bila dalam radius salah satu lokasi resmi', () => {
  // Persis di KANTOR
  assert.equal(dalamRadiusMultiPoint(-1.746067, 102.972139, lokasiProduksi).valid, true);
  // Persis di PARKIRAN TAMBANG
  assert.equal(dalamRadiusMultiPoint(-1.742654, 102.977618, lokasiProduksi).valid, true);
  // Di dalam radius 100m KANTOR
  assert.equal(dalamRadiusMultiPoint(-1.746067 + 0.0005, 102.972139, lokasiProduksi).valid, true);
});

test('multi-point: TIDAK valid bila di luar radius seluruh lokasi (jarak terdekat dilaporkan)', () => {
  // ~1.1 km dari KANTOR, di luar radius 100m KANTOR & PARKIRAN TAMBANG
  const hasil = dalamRadiusMultiPoint(-1.746067 + 0.01, 102.972139, lokasiProduksi);
  assert.equal(hasil.valid, false);
  assert.ok(hasil.jarak_meter > 100);
  assert.ok(hasil.lokasi_terdekat); // tetap melaporkan lokasi terdekat untuk pesan jarak
});

test('multi-point: tanpa lokasi resmi gagal tertutup sebagai kesalahan konfigurasi', () => {
  const hasil = dalamRadiusMultiPoint(-1.746067, 102.972139, []);
  assert.equal(hasil.valid, false);
  assert.equal(hasil.configuration_error, true);
});

test('akurasi GPS menggunakan kebijakan server tunggal sampai 500 meter', () => {
  assert.equal(MAX_ACCURACY_METER, 500);
  assert.equal(validasiAkurasi(150).valid, true);
  assert.equal(validasiAkurasi(500).valid, true);
  assert.equal(validasiAkurasi(501).valid, false);
});

test('multi-point mengabaikan konfigurasi lokasi yang koordinatnya tidak valid', () => {
  const hasil = dalamRadiusMultiPoint(-1.746067, 102.972139, [
    { nama_lokasi: 'INVALID', latitude: null, longitude: null, radius_meter: 100 },
    ...lokasiProduksi,
  ]);
  assert.equal(hasil.valid, true);
  assert.equal(hasil.lokasi_terdekat.nama_lokasi, 'KANTOR');
});
