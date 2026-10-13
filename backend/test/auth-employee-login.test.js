'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveLoginIdentifier,
  generateTemporaryPassword,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
} = require('../src/services/passwordReset');

test('login OMOS Safety memakai Employee ID yang dinormalisasi', () => {
  assert.deepEqual(resolveLoginIdentifier({ employee_id: '  EMP-0001 ', password: 'x' }), {
    type: 'employee_id',
    value: 'emp-0001',
  });
});

test('Employee ID didahulukan bila email juga dikirim', () => {
  assert.equal(resolveLoginIdentifier({ employee_id: 'EMP-1', email: 'a@b.co' }).type, 'employee_id');
});

test('login lama dengan email tetap didukung', () => {
  assert.deepEqual(resolveLoginIdentifier({ email: ' User@Site.ID ' }), { type: 'email', value: 'user@site.id' });
});

test('identitas kosong ditolak', () => {
  assert.equal(resolveLoginIdentifier({}), null);
  assert.equal(resolveLoginIdentifier({ employee_id: '   ', email: '' }), null);
  assert.equal(resolveLoginIdentifier({ email: 123 }), null);
});

test('sandi sementara memakai panjang tetap dan alfabet tanpa karakter ambigu', () => {
  const pwd = generateTemporaryPassword();
  assert.equal(pwd.length, TEMP_PASSWORD_LENGTH);
  for (const ch of pwd) assert.ok(TEMP_PASSWORD_ALPHABET.includes(ch));
  assert.ok(!/[0O1lI]/.test(TEMP_PASSWORD_ALPHABET));
});

test('sandi sementara memakai sumber acak yang diberikan', () => {
  const pwd = generateTemporaryPassword(() => 0);
  assert.equal(pwd, TEMP_PASSWORD_ALPHABET[0].repeat(TEMP_PASSWORD_LENGTH));
});
