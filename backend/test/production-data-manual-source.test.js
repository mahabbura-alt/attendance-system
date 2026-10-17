'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { manualOverridesPayload } = require('../src/controllers/productionDataController');

test('perubahan sumber lewat gear boleh disimpan tanpa payload nilai manual', () => {
  assert.deepEqual(manualOverridesPayload({ source: 'manual' }), { provided: false, rows: [] });
  assert.deepEqual(manualOverridesPayload({ source: 'ritase' }), { provided: false, rows: [] });
});

test('payload overrides eksplisit tetap wajib berbentuk array', () => {
  assert.deepEqual(manualOverridesPayload({ overrides: [] }), { provided: true, rows: [] });
  assert.throws(() => manualOverridesPayload({ overrides: null }), error => error.status === 422
    && /Daftar nilai manual tidak valid/.test(error.message));
});

test('kontrak respons penyimpanan menyertakan jumlah nilai yang diverifikasi', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/controllers/productionDataController'), 'utf8');
  assert.match(source, /SELECT COUNT\(\*\)::int AS count FROM production_manual_overrides/);
  assert.match(source, /persistedCount !== overrides\.length/);
  assert.match(source, /res\.json\(\{ saved: true, source, overrides: persistedCount \}\)/);
});
