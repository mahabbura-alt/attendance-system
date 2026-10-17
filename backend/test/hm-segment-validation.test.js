'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../src/services/hmSegmentValidation');

const seg = (id, hmStart, hmFinish, operatorId = 'op1', extra = {}) => ({
  id, hmStart, hmFinish, operatorId, areaName: 'BEI', job: 'OB', status: 'submitted', ...extra
});
const cand = (hmStart, hmFinish, operatorId = 'op1', extra = {}) => ({
  id: null, hmStart, hmFinish, operatorId, areaName: 'BEI', job: 'OB', status: 'submitted', ...extra
});

const codes = issues => issues.map(issue => issue.code);

test('A 100–105, B 105–110: valid, total unit 10, masing-masing operator 5', () => {
  const a = seg('a', 100, 105, 'opA');
  const result = domain.validateHmSegment(cand(105, 110, 'opB'), { segments: [a] });
  assert.deepEqual(codes(result.hardIssues), []);
  assert.deepEqual(codes(result.criticalIssues), []);
  assert.equal(result.summary.totalHm, 10);
  assert.equal(result.summary.operatorCount, 2);
  assert.equal(result.summary.handoverCount, 1);
  assert.equal(result.summary.quality, 'normal');
});

test('A 100–106, B 105–110: ditolak karena overlap 1 HM', () => {
  const a = seg('a', 100, 106, 'opA');
  const result = domain.validateHmSegment(cand(105, 110, 'opB'), { segments: [a] });
  assert.ok(codes(result.criticalIssues).includes('HM_SEGMENT_OVERLAP'));
  const overlap = result.criticalIssues.find(issue => issue.code === 'HM_SEGMENT_OVERLAP');
  assert.equal(overlap.overlap, 1);
});

test('A 100–105, B 105,5–110: diterima dengan warning gap 0,5 HM', () => {
  const a = seg('a', 100, 105, 'opA');
  const result = domain.validateHmSegment(cand(105.5, 110, 'opB'), { segments: [a] });
  assert.deepEqual(codes(result.hardIssues), []);
  assert.deepEqual(codes(result.criticalIssues), []);
  assert.ok(codes(result.warnings).includes('HM_SEGMENT_GAP'));
  const gap = result.warnings.find(issue => issue.code === 'HM_SEGMENT_GAP');
  assert.equal(gap.gap, 0.5);
});

test('A 100–103, B 103–106, A 106–109: valid; operator A total 6 HM, B 3 HM', () => {
  const a1 = seg('a1', 100, 103, 'opA');
  const b = seg('b', 103, 106, 'opB');
  const result = domain.validateHmSegment(cand(106, 109, 'opA'), { segments: [a1, b] });
  assert.deepEqual(codes(result.hardIssues), []);
  assert.deepEqual(codes(result.criticalIssues), []);
  assert.equal(result.summary.totalHm, 9);
  assert.equal(result.summary.operatorCount, 2);
  const all = [a1, b, cand(106, 109, 'opA')];
  const hmByOperator = {};
  for (const s of all) hmByOperator[s.operatorId] = (hmByOperator[s.operatorId] || 0) + domain.hmTotalOf(s);
  assert.equal(hmByOperator.opA, 6);
  assert.equal(hmByOperator.opB, 3);
});

test('A BEI/OB 100–104; A DKC/CG 104–109: valid; total 9, konteks terbagi', () => {
  const a1 = seg('a1', 100, 104, 'opA', { areaName: 'BEI', job: 'OB' });
  const result = domain.validateHmSegment(cand(104, 109, 'opA', { areaName: 'DKC', job: 'CG' }), { segments: [a1] });
  assert.deepEqual(codes(result.hardIssues), []);
  assert.deepEqual(codes(result.criticalIssues), []);
  assert.equal(result.summary.totalHm, 9);
});

test('BEI/OB 100–105; DKC/CG 104–109: ditolak; perbedaan PIT/Area+JOB tidak menghapus overlap', () => {
  const a1 = seg('a1', 100, 105, 'opA', { areaName: 'BEI', job: 'OB' });
  const result = domain.validateHmSegment(cand(104, 109, 'opB', { areaName: 'DKC', job: 'CG' }), { segments: [a1] });
  assert.ok(codes(result.criticalIssues).includes('HM_SEGMENT_OVERLAP'));
});

test('Segmen identik dikirim dua kali: EXACT_SEGMENT_DUPLICATE', () => {
  const a1 = seg('a1', 100, 105, 'opA');
  const result = domain.validateHmSegment(cand(100, 105, 'opA'), { segments: [a1] });
  assert.ok(codes(result.hardIssues).includes('EXACT_SEGMENT_DUPLICATE'));
});

test('Edit segmen yang sama tidak menandai dirinya sendiri sebagai duplikat/overlap', () => {
  const a1 = seg('a1', 100, 105, 'opA');
  const result = domain.validateHmSegment({ ...a1, id: 'a1' }, { segments: [a1] });
  assert.deepEqual(codes(result.hardIssues), []);
  assert.deepEqual(codes(result.criticalIssues), []);
});

test('Kontinuitas lintas shift: HM start di bawah finish shift sebelumnya = HM_ROLLBACK', () => {
  const result = domain.validateHmSegment(cand(100, 105, 'opA'), { previousShiftMaxFinish: 102 });
  assert.ok(codes(result.criticalIssues).includes('HM_ROLLBACK'));
});

test('Kontinuitas lintas shift: jeda > toleransi = HM_CONTINUITY_GAP', () => {
  const result = domain.validateHmSegment(cand(100, 105, 'opA'), { previousShiftMaxFinish: 98 });
  assert.ok(codes(result.warnings).includes('HM_CONTINUITY_GAP'));
});

test('Batas shift null tidak dikonversi menjadi HM 0 atau memicu konflik palsu', () => {
  const result = domain.validateHmSegment(cand(1937.3, 1939.3, 'opA'), {
    previousShiftMaxFinish: 1937.3,
    nextShiftMinStart: null,
  });
  assert.deepEqual(codes(result.hardIssues), []);
  assert.deepEqual(codes(result.criticalIssues), []);
  assert.ok(!codes(result.warnings).includes('HM_CONTINUITY_GAP'));
});

test('Ketiadaan kedua batas lintas shift tidak menambah rollback, overlap, atau gap', () => {
  const result = domain.validateHmSegment(cand(100, 102, 'opA'), {
    previousShiftMaxFinish: null,
    nextShiftMinStart: undefined,
  });
  assert.deepEqual(codes(result.criticalIssues), []);
  assert.deepEqual(codes(result.warnings), []);
});

test('Total unit-shift > 12 HM memicu UNIT_SHIFT_OVER_LIMIT pada total, bukan per segmen', () => {
  const a1 = seg('a1', 100, 106, 'opA');
  const result = domain.validateHmSegment(cand(106, 113, 'opB'), { segments: [a1] });
  assert.ok(codes(result.warnings).includes('UNIT_SHIFT_OVER_LIMIT'));
  assert.equal(result.summary.totalHm, 13);
});

test('Total harian > 24 HM dari shift lain = DAILY_OVER_24 (hard block)', () => {
  const a1 = seg('a1', 100, 108, 'opA');
  const result = domain.validateHmSegment(cand(108, 117, 'opB'), { segments: [a1], dailyOtherTotal: 10 });
  assert.ok(codes(result.hardIssues).includes('DAILY_OVER_24'));
});

test('Submitted tanpa operator = OPERATOR_REQUIRED_FOR_SUBMIT; draft tanpa operator tidak', () => {
  const submitted = domain.validateHmSegment(cand(100, 105, null, { status: 'submitted' }), {});
  assert.ok(codes(submitted.hardIssues).includes('OPERATOR_REQUIRED_FOR_SUBMIT'));
  const draft = domain.validateHmSegment(cand(100, 105, null, { status: 'draft' }), {});
  assert.ok(!codes(draft.hardIssues).includes('OPERATOR_REQUIRED_FOR_SUBMIT'));
  assert.equal(draft.summary.quality, 'draft_incomplete');
});

test('Meter rollback (finish < start) = HM_ROLLBACK, bukan dianggap pergantian operator', () => {
  const result = domain.validateHmSegment(cand(105, 100, 'opA'), {});
  assert.ok(codes(result.criticalIssues).includes('HM_ROLLBACK'));
});

test('buildSessionSummary menghitung total, jumlah operator, dan kualitas', () => {
  const segments = [seg('a', 100, 104, 'opA'), seg('b', 104, 109, 'opB')];
  const summary = domain.buildSessionSummary(segments);
  assert.equal(summary.totalHm, 9);
  assert.equal(summary.operatorCount, 2);
  assert.equal(summary.segmentCount, 2);
  assert.equal(summary.handoverCount, 1);
  assert.equal(summary.quality, 'normal');
});
