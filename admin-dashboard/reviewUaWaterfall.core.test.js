const assert = require('node:assert/strict');
const { buildUaWaterfall } = require('./reviewUaWaterfall.core.js');

const near = (actual, expected, tol, label) => {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ~${expected}, got ${actual}`);
};

// Golden case: PPlan 37.800, PA 90%->85%, UA 70%->65%,
// T_ua = HM+S = 221+119 = 340. STB: Waiting Front 70j, Waiting Exc 49j.
// faktor = 37800*(0.85/0.9)/(0.7*340) = 35700/238 = 150.
// WF: -150*70 = -10.500; WE: -150*49 = -7.350; total -17.850.
// basisUA = 37800*0.85*0.3/(0.9*0.7) = 15.300.
// -17.850 + 15.300 = -2.550 = dpua PDF ✓
const hasil = buildUaWaterfall({
  pPlan: 37800, paPlan: 0.9, paAktual: 0.85, uaPlan: 0.7, tUaJam: 340, dpuaServer: -2550,
  sbItems: [
    { kategori: 'Waiting Excavator', jam: 49, unit: 'EX-01' },
    { kategori: 'Waiting Front', jam: 70, unit: 'EX-02' },
  ],
});
assert.ok(hasil, 'hasil tidak null');
near(hasil.faktor, 150, 0.001, 'faktor');
near(hasil.totalJam, 119, 0.001, 'total standby');
assert.equal(hasil.cats[0].kategori, 'Waiting Front', 'urut desc');
near(hasil.cats[0].delta, -10500, 0.001, 'WF');
near(hasil.cats[0].share, 70 / 119 * 100, 0.001, 'share WF');
near(hasil.cats[1].delta, -7350, 0.001, 'WE');
near(hasil.totalCat, -17850, 0.001, 'total kategori');
near(hasil.basisUA, 15300, 0.001, 'basis UA');
near(hasil.selisih, 0, 0.001, 'selisih cross-check nol');
assert.equal(hasil.cocok, true, 'badge cocok');
assert.equal(hasil.cats[0].unit, 'EX-02', 'unit dominan');

// Guard
assert.equal(buildUaWaterfall({ pPlan: 37800, paPlan: 0, paAktual: 0.85, uaPlan: 0.7, tUaJam: 340, sbItems: [] }), null, 'PA plan 0 -> null');
assert.equal(buildUaWaterfall({ pPlan: 37800, paPlan: 0.9, paAktual: 0.85, uaPlan: 0, tUaJam: 340, sbItems: [] }), null, 'UA plan 0 -> null');
assert.equal(buildUaWaterfall({ pPlan: 37800, paPlan: 0.9, paAktual: 0.85, uaPlan: 0.7, tUaJam: 0, sbItems: [] }), null, 'T 0 -> null');

// Tanpa event: total nol, basis = dpua saat UA aktual = plan? (kasus batas)
const kosong = buildUaWaterfall({ pPlan: 1000, paPlan: 0.8, paAktual: 0.8, uaPlan: 0.6, tUaJam: 100, dpuaServer: 0, sbItems: [] });
assert.equal(kosong.cats.length, 0, 'tanpa kategori');
assert.equal(kosong.totalCat, 0, 'total nol');

console.log('reviewUaWaterfall.core.test.js: semua assertion lolos');
