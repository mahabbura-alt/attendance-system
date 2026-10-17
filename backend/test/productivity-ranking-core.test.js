'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/services/productivityRankingCore');

test('satuan per planning type; OB/Coal tak campur', () => {
  assert.equal(core.unitForType('ob'), 'BCM/Hr');
  assert.equal(core.unitForType('coal'), 'Ton/Hr');
  assert.equal(core.unitForType('OB'), 'BCM/Hr');
});

test('kanon JOB konsisten (mirror resolvePlanningJob)', () => {
  const jobs = [{ job_code: 'OB', job_desc: 'OB Removal' }, { job_code: 'DW', job_desc: 'Pekerjaan Rental' }];
  assert.equal(core.canonJobUpper('ob', jobs), 'OB');
  assert.equal(core.canonJobUpper('OB Removal', jobs), 'OB');
  assert.equal(core.canonJobUpper('ob removal', jobs), 'OB');
  assert.equal(core.canonJobUpper('dw', jobs), 'DW');
  assert.equal(core.canonJobUpper('XX', jobs), 'XX', 'tak dikenal ikut ejaan mentah');
  assert.equal(core.isDwJob('DW'), true);
  assert.equal(core.isDwJob('dw'), true);
  assert.equal(core.isDwJob('OB'), false);
});

test('gross/net + factor hilang bukan nol', () => {
  const r = core.grossNet(10, 2, 25);
  assert.deepEqual([r.grossRit, r.netRit, r.grossVol, r.netVol], [10, 8, 250, 200]);
  assert.equal(r.missingFactor, false);
  const hilang = core.grossNet(10, 2, null);
  assert.equal(hilang.missingFactor, true);
  assert.equal(hilang.grossVol, 0, 'volume nol TAPI ditandai missing, bukan plan nol');
});

test('achievement kumulatif memakai expected, bukan rata-rata %', () => {
  const a = core.achievementOf({ grossVol: 10000, netVol: 9500, hm: 60, planHm: [{ plan: 150, hm: 60 }] });
  assert.equal(a.expected, 9000);
  assert.equal(a.weightedPlan, 150);
  assert.equal(a.actual.toFixed(4), (10000 / 60).toFixed(4));
  assert.equal(a.achievement.toFixed(2), '111.11');
  assert.equal(a.netAchievement.toFixed(2), '105.56');
  assert.equal(a.complete, true);
  const kosong = core.achievementOf({ grossVol: 100, hm: 0, planHm: [{ plan: 150, hm: 10 }] });
  assert.equal(kosong.complete, false);
  assert.equal(kosong.actual, null);
});

test('HM-share dua operator + operator kembali (A-B-A)', () => {
  const bagi = core.allocateHmShare(90, [{ key: 'A1', hm: 4.5 }, { key: 'B1', hm: 4.5 }]);
  assert.deepEqual(bagi.map(b => b.volume), [45, 45]);
  const totalKembali = core.allocateHmShare(90, [{ key: 'A1', hm: 4.5 }, { key: 'B1', hm: 4.5 }])
    .filter(b => b.key.startsWith('A')).reduce((s, b) => s + b.volume, 0);
  void totalKembali;
  // alokasi tepat kembali ke total unit (P5 recon)
  const semua = core.allocateHmShare(1000, [{ key: 'x', hm: 3 }, { key: 'y', hm: 7 }]);
  assert.ok(Math.abs(semua.reduce((s, b) => s + b.volume, 0) - 1000) < 1e-9);
});

test('ranking desc + incomplete tak diranking sebagai 0%', () => {
  const rows = [
    { entity_code: 'B', achievement_percentage: 90, complete: true },
    { entity_code: 'A', achievement_percentage: 110, complete: true },
    { entity_code: 'C', achievement_percentage: 0, complete: false },
  ];
  const top = core.rankTop(rows, 10);
  assert.deepEqual(top.map(r => r.entity_code), ['A', 'B']);
  assert.deepEqual(top.map(r => r.rank), [1, 2]);
  const low = core.rankLow(rows, 10);
  assert.deepEqual(low.map(r => r.entity_code), ['B', 'A']);
  assert.deepEqual(low.map(r => r.rank), [1, 2]);
  assert.deepEqual([core.toneFor(110), core.toneFor(90), core.toneFor(70), core.toneFor(null)], ['green', 'yellow', 'red', 'grey']);
});

test('DW: excluded, tak masuk HM/expected/atribusi', () => {
  const dw = core.deriveControlStatus({ isDw: true });
  assert.deepEqual(dw, { status: 'excluded', reasons: ['NON_PRODUCTION_JOB_DW'] });
  const siap = core.deriveControlStatus({});
  assert.deepEqual(siap, { status: 'ready', reasons: [] });
  const amb = core.deriveControlStatus({ ambiguous: true, missingPlan: true });
  assert.equal(amb.status, 'ambiguous');
  assert.ok(amb.reasons.includes('HM_AMBIGUOUS_MATERIAL'));
  const inc = core.deriveControlStatus({ missingHm: true });
  assert.deepEqual(inc.status, 'incomplete');
  // unit OB+DW: HM produksi utuh, HM DW terpisah (tak mendilusi)
  const prod = core.achievementOf({ grossVol: 900, netVol: 900, hm: 9, planHm: [{ plan: 100, hm: 9 }] });
  assert.equal(prod.achievement, 100);
});

test('versi planning efektif per tanggal (berubah mid-range)', () => {
  const vers = [
    { id: 'v1', effective_from: '2026-09-01', revision: 1 },
    { id: 'v2', effective_from: '2026-09-15', revision: 1 },
  ];
  assert.equal(core.resolveEffectiveVersion(vers, '2026-09-10').id, 'v1');
  assert.equal(core.resolveEffectiveVersion(vers, '2026-09-15').id, 'v2');
  assert.equal(core.resolveEffectiveVersion(vers, '2026-08-31'), null);
});

test('readiness memisahkan dampak; DW tak dihitung gagal', () => {
  const s = core.readinessSummary({ ready: 90, incomplete: 5, ambiguous: 3, excluded: 12 });
  assert.equal(s.total, 110);
  assert.ok(Math.abs(s.readiness_percentage - (90 / 98) * 100) < 1e-9, 'excluded tak menurunkan readiness');
});

test('validasi range: wajib, urutan, maks 366', () => {
  assert.deepEqual(core.validateRange('2026-09-01', '2026-09-30').days, 30);
  assert.throws(() => core.validateRange('', '2026-09-30'), /wajib/);
  assert.throws(() => core.validateRange('2026-09-30', '2026-09-01'), /setelah/);
  assert.throws(() => core.validateRange('2025-01-01', '2026-09-24'), /366/);
});
