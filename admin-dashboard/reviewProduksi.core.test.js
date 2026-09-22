const assert = require('node:assert/strict');
const {
  hitungPAAktual,
  hitungUAAktual,
  hitungPPlan,
  hitungDppa,
  hitungDpua,
  hitungDprod,
  jumlahProduksi,
  cekRekonsiliasi,
  hitungWaterfall,
  formatPersen,
} = require('./reviewProduksi.core.js');

const near = (actual, expected, tol, label) => {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ~${expected}, got ${actual}`);
};

// --- Golden case PDF bab 4 ---
// SH=600, PA plan=90%, PA aktual=85%, UA plan=70%, UA aktual=65%, Prod=100 ton/jam, N=1
// EWH_plan = SH x PA_plan x UA_plan = 600 x 0.9 x 0.7 = 378
const ewhPlan = 600 * 0.9 * 0.7;

const pPlan = hitungPPlan(1, ewhPlan, 100);
near(pPlan, 37800, 0.001, 'PPlan (PDF: 37.800)');

const dppa = hitungDppa(pPlan, 0.9, 0.85);
near(dppa, -2100, 0.001, 'Dppa (PDF: -2.100)');

const dpua = hitungDpua(pPlan, 0.9, 0.85, 0.7, 0.65);
near(dpua, -2550, 0.001, 'Dpua (PDF: -2.550)');

// Rekonsiliasi fleet: PPlan + Dppa + Dpua = 37.800 - 2.100 - 2.550 = 33.150
const rekonsiliasi = cekRekonsiliasi({ pPlan, dppa, dpua, aktualFleet: 33150 });
near(rekonsiliasi.total, 33150, 0.001, 'Total fleet-expected');
assert.equal(rekonsiliasi.reconciled, true, 'Rekonsiliasi harus true saat aktual = total');

// PDF: Actual total 34.000 dengan OtherFleet 850 -> achievement 89.95%
const hasil = hitungWaterfall({
  n: 1, ewhPlan, prodPlan: 100, paPlan: 0.9, uaPlan: 0.7,
  // hm=221, standby=119, breakdown=60 -> PA=(340)/(400)=0.85, UA=221/340=0.65 (sama dgn PDF)
  hm: 221, standby: 119, breakdown: 60,
  aktualFleet: 33150, otherFleet: 850,
});
near(hasil.totalAktual, 34000, 0.001, 'Total aktual (fleet + other)');
near(hasil.achievementTotal, 34000 / 37800 * 100, 0.001, 'Achievement total');
near(hasil.achievementTotal, 89.95, 0.01, 'Achievement ~89.95% (PDF)');
assert.equal(hasil.rekonsiliasi.reconciled, true, 'Fleet reconcile saat aktualFleet = 33.150');

// PA/UA aktual dari HM/Standby/Breakdown
near(hitungPAAktual(400, 100, 50), 500 / 550, 1e-12, 'PA aktual = (HM+S)/(HM+S+R)');
near(hitungUAAktual(400, 100), 0.8, 1e-12, 'UA aktual = HM/(HM+S)');

// --- Golden case panduan_waterfall_multi_excavator.md bab 4 (per unit, bukan rata-rata) ---
// EX-01: HM 600, PA 90%, UA 70%, Prod plan 100, Prod aktual 95 -> -1.890
// EX-02: HM 600, PA 80%, UA 60%, Prod plan 120, Prod aktual 110 -> -2.880
near(hitungDprod(600 * 0.9 * 0.7, 100, 95), -1890, 0.001, 'Dprod EX-01 (doc: -1.890)');
near(hitungDprod(600 * 0.8 * 0.6, 120, 110), -2880, 0.001, 'Dprod EX-02 (doc: -2.880)');
near(hitungDprod(600 * 0.9 * 0.7, 100, 95) + hitungDprod(600 * 0.8 * 0.6, 120, 110), -4770, 0.001, 'Total Dprod fleet (doc: -4.770)');
// Rata-rata sederhana memberi hasil berbeda (doc bab 5) -> -2.486,25 (bukan -4.770).
near(hitungDprod(600 * 0.85 * 0.65, 110, 102.5), -2486.25, 0.01, 'Dprod rata-rata (doc: -2.486,25)');

// --- Kasus batas: pembagi nol -> null (bukan Infinity/NaN) ---
assert.equal(hitungPAAktual(0, 0, 0), null, 'PA null saat semua nol');
assert.equal(hitungUAAktual(0, 0), null, 'UA null saat nol');
assert.equal(hitungDppa(1000, 0, 0.9), null, 'Dppa null saat PA plan 0');
assert.equal(hitungDpua(1000, 0.9, 0.85, 0, 0.6), null, 'Dpua null saat UA plan 0');
assert.equal(hitungPPlan(null, 10, 5), null, 'PPlan null saat N tidak ada');

// --- Rekonsiliasi tidak cocok -> badge warning ---
const mismatch = cekRekonsiliasi({ pPlan: 37800, dppa: -2100, dpua: -2550, aktualFleet: 35000 });
assert.equal(mismatch.reconciled, false, 'Rekonsiliasi false saat selisih > toleransi');
near(mismatch.selisih, 1850, 0.001, 'Selisih = 35.000 - 33.150');

// --- Jumlah produksi (Other Fleet diukur langsung) ---
assert.equal(jumlahProduksi([100, 250, 0, null, undefined, 50]), 400, 'Jumlah produksi mengabaikan null');
assert.equal(jumlahProduksi(null), 0, 'Jumlah produksi null -> 0');

// --- Format persen (pembulatan hanya di display) ---
assert.equal(formatPersen(0.89947), '89.95%', 'Format persen 2 desimal');
assert.equal(formatPersen(null), '—', 'Format persen null -> em dash');

console.log('reviewProduksi.core.test.js: semua assertion lolos');
