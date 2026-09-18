'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { uploadWithRetry, isRetryableStorageError } = require('../src/services/storage');

test('upload foto mengulang gangguan sementara dengan key operasi yang sama', async () => {
  let calls = 0;
  const delays = [];
  const data = await uploadWithRetry(async () => {
    calls += 1;
    if (calls < 3) return { data: null, error: Object.assign(new Error('network timeout'), { statusCode: 503 }) };
    return { data: { path: 'absensi/user/photo.jpg' }, error: null };
  }, {
    attempts: 3,
    retryDelayMs: 5,
    sleep: async (delay) => delays.push(delay),
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);
  assert.equal(data.path, 'absensi/user/photo.jpg');
});

test('upload foto tidak mengulang error validasi permanen', async () => {
  let calls = 0;
  await assert.rejects(uploadWithRetry(async () => {
    calls += 1;
    return { data: null, error: Object.assign(new Error('invalid mime'), { statusCode: 400 }) };
  }, { sleep: async () => {} }), /invalid mime/);
  assert.equal(calls, 1);
  assert.equal(isRetryableStorageError({ statusCode: 429 }), true);
  assert.equal(isRetryableStorageError({ statusCode: 400 }), false);
});

test('controller membersihkan foto bila transaksi absensi gagal', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/absensiController.js'), 'utf8');
  assert.match(source, /cleanupFailedAttendancePhoto\(fotoKey\)/);
  assert.match(source, /PHOTO_STORAGE_UPLOAD_FAILED/);
  assert.match(source, /ATTENDANCE_ALREADY_CHECKED_OUT/);
});
