const assert = require('node:assert/strict');
const { buildUaWaterfall, reconcileUaContributions, balanceRoundedImpacts } = require('./reviewUaWaterfall.core.js');

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

const rekonsiliasi = reconcileUaContributions(hasil, -2550, true);
near(rekonsiliasi.rawTotal, -17850, 0.001, 'loss kategori UA');
near(rekonsiliasi.adjustment, 15300, 0.001, 'gain vs plan/scope UA');
near(rekonsiliasi.total, -2550, 0.001, 'total UA sama dengan ΔUA utama');
near(rekonsiliasi.difference, 0, 0.001, 'rekonsiliasi UA tertutup');
assert.equal(rekonsiliasi.rows.at(-1).isAdjustment, true, 'baris penyesuaian UA eksplisit');

// Guard
assert.equal(buildUaWaterfall({ pPlan: 37800, paPlan: 0, paAktual: 0.85, uaPlan: 0.7, tUaJam: 340, sbItems: [] }), null, 'PA plan 0 -> null');
assert.equal(buildUaWaterfall({ pPlan: 37800, paPlan: 0.9, paAktual: 0.85, uaPlan: 0, tUaJam: 340, sbItems: [] }), null, 'UA plan 0 -> null');
assert.equal(buildUaWaterfall({ pPlan: 37800, paPlan: 0.9, paAktual: 0.85, uaPlan: 0.7, tUaJam: 0, sbItems: [] }), null, 'T 0 -> null');

// Tanpa event: total nol, basis = dpua saat UA aktual = plan? (kasus batas)
const kosong = buildUaWaterfall({ pPlan: 1000, paPlan: 0.8, paAktual: 0.8, uaPlan: 0.6, tUaJam: 100, dpuaServer: 0, sbItems: [] });
assert.equal(kosong.cats.length, 0, 'tanpa kategori');
assert.equal(kosong.totalCat, 0, 'total nol');
const kosongRekonsiliasi = reconcileUaContributions(kosong, -400, true);
near(kosongRekonsiliasi.adjustment, -400, 0.001, 'tanpa event seluruh ΔUA menjadi penyesuaian scope');
near(kosongRekonsiliasi.total, -400, 0.001, 'tanpa event tetap cocok ΔUA utama');

const balanced = balanceRoundedImpacts([
  { code: 'S01', impact: -10.4 },
  { code: 'S06', impact: -10.4 },
  { code: 'S05', impact: 0.2 },
], -20.6, 0);
assert.equal(balanced.reduce((sum, row) => sum + row.displayImpact, 0), -21, 'jumlah tampilan sama dengan ΔUA dibulatkan');
assert.deepEqual(balanced.map(row => row.impact), [-10.4, -10.4, 0.2], 'nilai sumber tidak berubah');

console.log('reviewUaWaterfall.core.test.js: semua assertion lolos');
assert.equal(balanceRoundedImpacts([{impact:0}],150,0)[0].displayImpact,0,'never fabricate impact to conceal missing data');
assert.equal(balanceRoundedImpacts([{impact:0},{impact:1.4},{impact:1.4}],2.8,0)[0].displayImpact,0,'zero impact remains zero');
