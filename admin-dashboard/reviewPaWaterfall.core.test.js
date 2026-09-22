const assert = require('node:assert/strict');
const { buildPaWaterfall } = require('./reviewPaWaterfall.core.js');

const near = (actual, expected, tol, label) => {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ~${expected}, got ${actual}`);
};

// Golden case: PPlan 37.800, PA plan 90%, T = 221+119+60 = 400,
// BD Engine 30j, Hydraulic 18j, Electrical 12j (total 60j -> PAact 85%,
// dppa PDF = -2.100). Hitung tangan:
// V100 = 37800/0.9 = 42.000; basis = 4.200;
// Engine: -37800*30/(400*0.9) = -3.150 -> 38.850
// Hydraulic: -37800*18/360 = -1.890 -> 36.960
// Electrical: -37800*12/360 = -1.260 -> 35.700 = 37800 + (-2100) ✓
const hasil = buildPaWaterfall({
  pPlan: 37800, paPlan: 0.9, tHours: 400, dppaServer: -2100,
  bdItems: [
    { kategori: 'Hydraulic', jam: 18, unit: 'EX-01' },
    { kategori: 'Engine', jam: 30, unit: 'EX-01' },
    { kategori: 'Electrical', jam: 12, unit: null },
  ],
});
assert.ok(hasil, 'hasil tidak null');
near(hasil.v100, 42000, 0.001, 'V100');
near(hasil.basis, 4200, 0.001, 'basis normalisasi');
near(hasil.bdTotal, 60, 0.001, 'total BD');
assert.equal(hasil.rows.length, 6, 'Plan + basis + 3 kategori + Ekspektasi');
assert.equal(hasil.rows[2].segmen, 'Engine', 'urut desc');
near(hasil.rows[2].delta, -3150, 0.001, 'Engine');
near(hasil.rows[2].subtotal, 38850, 0.001, 'subtotal Engine');
near(hasil.rows[2].share, 50, 0.001, 'share Engine');
near(hasil.rows[3].delta, -1890, 0.001, 'Hydraulic');
near(hasil.rows[4].delta, -1260, 0.001, 'Electrical');
assert.equal(hasil.rows[hasil.rows.length - 1].segmen, 'Ekspektasi', 'baris akhir Ekspektasi');
near(hasil.rows[hasil.rows.length - 1].subtotal, 35700, 0.001, 'subtotal Ekspektasi');
near(hasil.selisih, 0, 0.001, 'selisih cross-check nol');
assert.equal(hasil.cocok, true, 'badge cocok');
assert.equal(hasil.rows[2].unit, 'EX-01', 'unit dominan');

// Guard: input tak sah -> null
assert.equal(buildPaWaterfall({ pPlan: 37800, paPlan: 0, tHours: 400, bdItems: [] }), null, 'PA plan 0 -> null');
assert.equal(buildPaWaterfall({ pPlan: 37800, paPlan: 0.9, tHours: 0, bdItems: [] }), null, 'T 0 -> null');
assert.equal(buildPaWaterfall({ pPlan: null, paPlan: 0.9, tHours: 400, bdItems: [] }), null, 'Plan null -> null');

// Tanpa event BD: hanya basis, ekspektasi = V100
const kosong = buildPaWaterfall({ pPlan: 1000, paPlan: 0.8, tHours: 100, dppaServer: 250, bdItems: [] });
assert.equal(kosong.rows.length, 3, 'tanpa kategori (+Ekspektasi)');
near(kosong.expected, 1250, 0.001, 'V100 = ekspektasi saat BD nol');
assert.equal(kosong.cocok, true, 'cocok dengan dppa +250');

// Item jam nol/negatif diabaikan
const aneh = buildPaWaterfall({ pPlan: 1000, paPlan: 0.8, tHours: 100, bdItems: [{ kategori: 'X', jam: 0 }] });
assert.equal(aneh.rows.length, 3, 'jam nol diabaikan');

console.log('reviewPaWaterfall.core.test.js: semua assertion lolos');
