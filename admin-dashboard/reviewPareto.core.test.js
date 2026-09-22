const assert = require('node:assert/strict');
const core = require('./reviewPareto.core.js');

// --- Ambang tampil: |Δ| > 1% Plan ---
assert.equal(core.shouldShow(-200, 10000), true, '2% -> tampil');
assert.equal(core.shouldShow(-100, 10000), false, 'tepat 1% -> tidak tampil');
assert.equal(core.shouldShow(150, 10000), true, 'positif 1,5% -> tampil (aturan ambang)');
assert.equal(core.shouldShow(-50, 10000), false, '0,5% -> sembunyi');
assert.equal(core.shouldShow(-200, null), false, 'Plan null -> sembunyi');
assert.equal(core.shouldShow(null, 10000), false, 'Delta null -> sembunyi');

// --- Pareto: kumulatif ~80%, urut desc ---
const items = [
  { kategori: 'Engine', jam: 24, kejadian: 3, units: [{ unit: 'EX-01', jam: 24 }], contoh: 'Turbo' },
  { kategori: 'Hydraulic', jam: 15, kejadian: 2, units: [{ unit: 'EX-01', jam: 15 }], contoh: '' },
  { kategori: 'Electrical', jam: 9, kejadian: 1, units: [], contoh: '' },
  { kategori: 'Tyre', jam: 7, kejadian: 1, units: [], contoh: '' },
  { kategori: 'Others', jam: 5, kejadian: 4, units: [], contoh: '' },
];
const rank = core.paretoRank(items, 'jam');
assert.equal(rank.total, 60, 'total jam 60');
assert.equal(rank.ranked[0].data.kategori, 'Engine', 'peringkat 1 Engine');
assert.equal(rank.ranked[0].persen, 40, 'Engine 40%');
assert.ok(rank.ranked[rank.ranked.length - 1].kumulatif >= 80, 'kumulatif menutup ~80%');
assert.ok(rank.ranked.length <= 4, 'maks 4 baris');

// --- Smart text PA memuat fakta (bukan karangan) ---
const pa = core.buildPaText({ delta: -2100, pPlan: 37800, periode: '1–6 Sep 2026', job: 'OB', items });
assert.equal(pa.attribute, 'PA');
assert.equal(pa.status, 'negative');
assert.ok(pa.smartText.includes('Engine'), 'menyebut kontributor terbesar');
assert.ok(pa.smartText.includes('24 jam'), 'menyebut jam');
assert.ok(pa.smartText.includes('EX-01'), 'menyebut unit (where)');
assert.ok(pa.smartText.includes('1–6 Sep 2026'), 'menyebut periode (when)');
assert.ok(pa.smartText.includes('Turbo'), 'menyebut contoh kejadian');

// --- Kosong -> null (jujur, tidak dikarang) ---
assert.equal(core.buildPaText({ delta: -5, pPlan: 100, items: [] }), null, 'tanpa event -> null');
assert.equal(core.buildUaText({ delta: -5, pPlan: 100, items: [{ kategori: 'X', jam: 0 }] }), null, 'nol jam -> null');

// --- UA ---
const ua = core.buildUaText({ delta: -2550, pPlan: 37800, periode: '1–6 Sep 2026', job: 'OB',
  items: [{ kategori: 'Waiting Front', jam: 20, kejadian: 5, units: [{ unit: 'DT-01', jam: 20 }], contoh: '' }] });
assert.equal(ua.attribute, 'UA');
assert.ok(ua.smartText.includes('Waiting Front') && ua.smartText.includes('20 jam'), 'fakta UA lengkap');

// --- Productivity: sorot Problem, hitung EVENT (bukan estimasi) ---
const prod = core.buildProdText({ delta: -500, pPlan: 10000, periode: '1–6 Sep 2026', job: 'OB',
  items: [
    { kategori: 'Queue', kode: 'QUEUE', problem: 'Antre di disposal', kejadian: 5, units: [{ unit: 'EX-01', kejadian: 5 }] },
    { kategori: 'Road', kode: 'ROAD', problem: 'Jalan rusak', kejadian: 2, units: [{ unit: 'EX-01', kejadian: 2 }] },
  ] });
assert.equal(prod.attribute, 'Productivity');
assert.ok(prod.smartText.includes('Antre di disposal'), 'menyorot Problem, bukan Kategori');
assert.ok(prod.smartText.includes('5 kejadian'), 'menyebut hitungan event');
assert.ok(prod.smartText.includes('Queue'), 'kategori tetap disebut sebagai konteks');
assert.ok(!/estimasi|ton/i.test(prod.smartText), 'tanpa estimasi volume');
// --- Fallback: tanpa problem/kode tak dihitung ---
assert.equal(core.buildProdText({ delta: -5, pPlan: 100, items: [] }), null, 'tanpa event -> null');

console.log('reviewPareto.core.test.js: semua assertion lolos');
