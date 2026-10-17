'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const production = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');

test('halaman Standby tidak lagi mengekspos workflow review', () => {
  assert.doesNotMatch(index, /Review Standby|slicerStandbyReview|standbyReviewBadge/);
  assert.doesNotMatch(production, /bukaReviewStandby|reviewStandbyRecord|bukaStandbyPendingKpi|DRAFT_SEGMENT/);
  assert.doesNotMatch(production, /menunggu review|wajib direview ulang|Kembalikan melalui Review/i);
});

test('asset Input Produksi memakai versi direct-use terbaru', () => {
  assert.match(loader, /production\.js\?v=103/);
});
