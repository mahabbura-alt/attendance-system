'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fw = require('./fuelWorkspace.js');

test('format angka id-ID, tanda minus tipografis, dan tanpa em-dash', () => {
  assert.equal(fw.fmtL(16000), '16.000 L');
  assert.equal(fw.fmtL(null), '-');
  assert.equal(fw.fmtSigned(-250, ' L'), '−250 L');
  assert.equal(fw.fmtSigned(3.44, '%'), '+3,4%');
  assert.equal(fw.fmtSigned(0), '0');
  assert.equal(fw.fmtRp(2080000000), 'Rp2,08 M');
  assert.equal(fw.fmtRp(14050), 'Rp14.050');
  assert.ok(!/—/.test(fw.fmtL(undefined) + fw.fmtTgl('x') + fw.fmtPeriode('', '')));
});

test('periode: preset bulan ini / 30 hari / bulan lalu dan label', () => {
  const t = new Date(2026, 9, 17);
  assert.deepEqual(fw.presetPeriode('bulan_ini', t), { dari: '2026-10-01', sampai: '2026-10-17' });
  assert.deepEqual(fw.presetPeriode('30_hari', t), { dari: '2026-09-18', sampai: '2026-10-17' });
  assert.deepEqual(fw.presetPeriode('bulan_lalu', t), { dari: '2026-09-01', sampai: '2026-09-30' });
  assert.equal(fw.fmtPeriode('2026-10-01', '2026-10-17'), '1-17 Okt 2026');
  assert.equal(fw.jumlahHari('2026-10-01', '2026-10-17'), 17);
  assert.equal(fw.jumlahHari('2026-10-17', '2026-10-01'), 0);
});

test('glosarium: istilah teknis menjadi bahasa operasional', () => {
  assert.equal(fw.tipeLabel('issue_equipment'), 'Pengisian unit');
  assert.equal(fw.tipeLabel('reversal'), 'Pembatalan');
  assert.deepEqual(fw.statusInfo('draft', 'mobile_offline'), ['Menunggu validasi', 'wr']);
  assert.deepEqual(fw.statusInfo('draft', 'manual'), ['Draf', 'wr']);
  assert.deepEqual(fw.statusInfo('reversed'), ['Dibatalkan', 'mu']);
  assert.deepEqual(fw.sumberInfo('mobile_offline'), ['APK', 'apk']);
});

test('status stok: kosong, di bawah minimum, aman; posisi minimum relatif kapasitas', () => {
  assert.equal(fw.statusStok(0, 1000, 100).tone, 'bd');
  const rendah = fw.statusStok(80, 1000, 100);
  assert.equal(rendah.label, 'Di bawah minimum');
  assert.equal(rendah.minPct, 10);
  assert.equal(fw.statusStok(500, null, null).pct, null);
  assert.equal(fw.statusStok(500, 1000, 100).tone, 'ok');
  assert.equal(fw.statusStok(1200, 1000, 100).label, 'Melebihi kapasitas');
});

test('posisi lokasi: gabung lokasi×produk per lokasi, filter produk, lokasi tanpa stok tetap tampil', () => {
  const lokasi = [{ id: 'A', location_code: 'FT-A', capacity_liter: 1000, minimum_stock_liter: 100 }, { id: 'B', location_code: 'FT-B' }, { id: 'C', location_code: 'X', is_active: false }];
  const sum = [
    { location_id: 'A', product_id: 'P1', product_code: 'B40', balance_liter: 400, fifo_value_idr: 100, unknown_cost_layers: 1 },
    { location_id: 'A', product_id: 'P2', product_code: 'PX', balance_liter: 50, fifo_value_idr: 0 },
  ];
  const semua = fw.posisiLokasi(sum, lokasi);
  assert.deepEqual(semua.map(p => [p.location.location_code, p.balance]), [['FT-A', 450], ['FT-B', 0]]);
  assert.equal(semua[1].status.tone, 'bd');
  assert.equal(fw.posisiLokasi(sum, lokasi, 'P1')[0].balance, 400);
});

test('antrean tindakan: urut dampak, rekonsiliasi alert dan stok rendah ikut', () => {
  const items = fw.antreanTindakan({
    pending: [{ kind: 'receipt' }, { kind: 'transfer' }],
    unlinked: [{ fuel_filled: 640 }, { fuel_filled: 60 }],
    submitted: [{}],
    rekon: [{ location_code: 'FTR-01', last_opname: { variance_alert: true, variance_percent: -3.4, operational_date: '2026-10-17' } }],
    posisi: [{ location: { location_code: 'FTR-01' }, balance: 30, status: { tone: 'wr', label: 'Di bawah minimum' } }],
  });
  assert.equal(items[0].title, '2 transaksi APK menunggu validasi foto');
  assert.match(items.find(i => /belum ber-sumber/.test(i.title)).sub, /700 L/);
  assert.ok(items.some(i => i.title === 'Selisih FTR-01 −3,4%'));
  assert.equal(items.at(-1).go, 'alok');
  assert.deepEqual(fw.antreanTindakan({}), []);
});

test('selisih rekonsiliasi: belum opname, cocok, dan melewati ambang', () => {
  assert.equal(fw.selisihView({ last_opname: null }).label, 'Belum opname');
  const ok = fw.selisihView({ last_opname: { variance_quantity: -250, variance_percent: -0.29, variance_alert: false, physical_quantity: 86150, operational_date: '2026-10-17' } });
  assert.deepEqual([ok.tone, ok.label], ['ok', '−250 L · −0,3%']);
  assert.equal(fw.selisihView({ last_opname: { variance_quantity: -120, variance_percent: -3.4, variance_alert: true } }).tone, 'bd');
  assert.equal(fw.penyesuaianBersih({ adjustment_in: 15, adjustment_out: 5, other: 0 }), 10);
});

test('harga rata-rata tertimbang volume hanya dari baris posted ber-harga', () => {
  const r = fw.hargaRataRata([
    { status: 'posted', quantity_liter: 1000, unit_price: 14000 },
    { status: 'posted', quantity_liter: 3000, unit_price: 15000 },
    { status: 'posted', quantity_liter: 500, unit_price: null },
    { status: 'draft', quantity_liter: 9999, unit_price: 1 },
  ]);
  assert.equal(r.harga, 14750);
  assert.equal(r.tanpaHarga, 1);
});

test('aturan sumber ditulis dalam kalimat, bukan UUID', () => {
  const masters = { equipment: [{ id: 'e1', kode_alat: 'FTR-01' }], shifts: [{ id: 's1', nama_shift: 'Siang' }], operators: [] };
  assert.equal(fw.mappingKalimat({ truck_equipment_id: 'e1', shift_id: 's1' }, masters), 'Unit/truck FTR-01, shift Siang');
  assert.equal(fw.mappingKalimat({ operator_id: 'zz' }, masters), 'operator tidak dikenal, semua shift');
});

test('validasi form dan payload penerimaan', () => {
  const f = { operational_date: '2026-10-17', destination_location_id: 'L', product_id: 'P', quantity_liter: '16000', unit_price: '', document_number: 'DO-1' };
  assert.equal(fw.validasiTerima(f), null);
  assert.match(fw.validasiTerima({ ...f, quantity_liter: '0' }), /lebih dari 0/);
  const p = fw.payloadTerima(f);
  assert.equal(p.transaction_type, 'receipt');
  assert.deepEqual(p.lines, [{ direction: 'in', quantity_liter: 16000, unit_price: null, batch_number: null }]);
  assert.equal(fw.payloadTerima(f, 'opening_balance').transaction_type, 'opening_balance');
  assert.match(fw.validasiTransfer({ operational_date: 'x', from_location_id: 'A', to_location_id: 'A', product_id: 'P', quantity_liter: 1 }), /tidak boleh sama/);
  assert.equal(fw.validasiOpname({ operational_date: 'x', location_id: 'A', product_id: 'P', physical_quantity: '0' }), null);
  assert.match(fw.validasiOpname({ operational_date: 'x', location_id: 'A', product_id: 'P', physical_quantity: '' }), /fisik/);
});

test('batang konsumsi relatif terhadap nilai terbesar dan html di-escape', () => {
  const b = fw.batangKonsumsi([{ liter: 200 }, { liter: 50 }, { liter: 0 }]);
  assert.deepEqual(b.map(x => x.width), [100, 25, 2]);
  assert.equal(fw.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
