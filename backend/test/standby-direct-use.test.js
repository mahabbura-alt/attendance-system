'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../src/routes/production.routes.js'), 'utf8');
const ranking = fs.readFileSync(path.join(__dirname, '../src/services/productivityRanking.js'), 'utf8');

test('API Standby tidak lagi menyediakan antrean atau aksi review', () => {
  assert.doesNotMatch(routes, /standby-review|standby\/:id\/review/);
  assert.doesNotMatch(controller, /REVIEW_PENDING|REVIEW_RETURNED|getStandbyReviewQueue|reviewStandbyLog/);
});

test('HM tersimpan dipakai ranking tanpa gerbang draft/submitted', () => {
  assert.doesNotMatch(ranking, /l\.status IN \('submitted', 'draft'\)|s\.status !== 'submitted'|DRAFT_SEGMENT/);
  assert.match(ranking, /WHERE l\.deleted_at IS NULL AND l\.tanggal >= \$1 AND l\.tanggal <= \$2/);
});

test('Review Produksi memakai Standby aktif tanpa status review', () => {
  assert.match(controller, /FROM standby_logs(?: sl)?[\s\S]{0,300}(?:sl\.)?deleted_at IS NULL AND (?:sl\.)?lifecycle_status IN \('open','confirmed'\)/);
  assert.doesNotMatch(controller, /Standby yang telah disetujui harus dikembalikan|kembalikan approval melalui Review/i);
});
