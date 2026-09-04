const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateStandbyMohhControl, intervalOverlapHours } = require('../src/controllers/production.controller');

test('MOHH control balances HM, breakdown, and standby to 12 hours', () => {
  const control = calculateStandbyMohhControl({
    hmHours: 7.25, hmRecords: 1, breakdownHours: 1.75, standbyHours: 3,
    pendingReview: 0, returnedReview: 0
  });
  assert.equal(control.accountedHours, 12);
  assert.equal(control.balanceHours, 0);
  assert.equal(control.requiredStandbyHours, 3);
  assert.equal(control.status, 'balanced');
  assert.equal(control.canClose, true);
});

test('MOHH control retains precision and reports under/over balance', () => {
  const under = calculateStandbyMohhControl({ hmHours: 7.123456, hmRecords: 1, breakdownHours: 1, standbyHours: 2 });
  assert.ok(Math.abs(under.accountedHours - 10.123456) < 1e-10);
  assert.ok(Math.abs(under.balanceHours - 1.876544) < 1e-10);
  assert.equal(under.status, 'under');

  const over = calculateStandbyMohhControl({ hmHours: 9, hmRecords: 1, breakdownHours: 2, standbyHours: 2 });
  assert.equal(over.status, 'over');
  assert.equal(over.canClose, false);
});

test('MOHH control blocks closing while HM is missing or review is pending', () => {
  const missingHm = calculateStandbyMohhControl({ hmHours: 0, hmRecords: 0, breakdownHours: 4, standbyHours: 8 });
  assert.equal(missingHm.status, 'missing_hm');
  assert.equal(missingHm.canClose, false);
  assert.ok(missingHm.issues.some(issue => issue.code === 'HM_MISSING'));

  const pending = calculateStandbyMohhControl({ hmHours: 8, hmRecords: 1, breakdownHours: 1, standbyHours: 3, pendingReview: 1 });
  assert.equal(pending.canClose, false);
  assert.ok(pending.issues.some(issue => issue.code === 'REVIEW_PENDING'));
});

test('MOHH control treats duplicate absolute HM records as data-quality conflict', () => {
  const control = calculateStandbyMohhControl({ hmHours: 8, hmRecords: 3, breakdownHours: 1, standbyHours: 3 });
  assert.equal(control.accountedHours, 12);
  assert.equal(control.status, 'conflict');
  assert.equal(control.canClose, false);
  assert.ok(control.issues.some(issue => issue.code === 'HM_DUPLICATE'));
});

test('MOHH detects standby/breakdown overlap independently from arithmetic balance', () => {
  const overlap = intervalOverlapHours(
    '2026-08-31T08:00:00+07:00', '2026-08-31T10:00:00+07:00',
    '2026-08-31T09:30:00+07:00', '2026-08-31T11:00:00+07:00'
  );
  assert.equal(overlap, 0.5);
  const control = calculateStandbyMohhControl({ hmHours: 8, hmRecords: 1, breakdownHours: 1, standbyHours: 3, overlapHours: overlap });
  assert.equal(control.status, 'conflict');
  assert.equal(control.canClose, false);
});

test('closed MOHH becomes stale when a source value changes', () => {
  const control = calculateStandbyMohhControl({
    hmHours: 8, hmRecords: 1, breakdownHours: 1, standbyHours: 3,
    closure: { status: 'closed', hm_hours_snapshot: 7.5, breakdown_hours_snapshot: 1, standby_hours_snapshot: 3.5 }
  });
  assert.equal(control.status, 'stale');
  assert.ok(control.issues.some(issue => issue.code === 'CLOSURE_STALE'));
});
