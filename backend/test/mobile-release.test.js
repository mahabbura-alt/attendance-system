const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requestOrigin,
  validateMobileRelease,
} = require('../src/services/mobileRelease');

const HASH = 'a'.repeat(64);

test('manifest update membentuk URL APK pada origin Biznet HTTPS', () => {
  const release = validateMobileRelease({
    version_code: 5,
    version_name: '3.0',
    minimum_supported_version: 4,
    mandatory: false,
    apk_path: '/Absensi_PIM.apk',
    sha256: HASH,
    release_notes: ['GPS', 'Update'],
  }, 'https://omos-mining.com');

  assert.equal(release.apk_url, 'https://omos-mining.com/Absensi_PIM.apk');
  assert.equal(release.sha256, HASH);
  assert.deepEqual(release.release_notes, ['GPS', 'Update']);
});

test('manifest menolak hash, path, atau minimum version yang tidak aman', () => {
  const base = {
    version_code: 5,
    version_name: '3.0',
    minimum_supported_version: 4,
    apk_path: '/Absensi_PIM.apk',
    sha256: HASH,
  };
  assert.throws(() => validateMobileRelease({ ...base, sha256: '' }, 'https://omos-mining.com'), /sha256/);
  assert.throws(() => validateMobileRelease({ ...base, apk_path: '/../secret' }, 'https://omos-mining.com'), /apk_path/);
  assert.throws(() => validateMobileRelease({ ...base, minimum_supported_version: 6 }, 'https://omos-mining.com'), /minimum_supported/);
  assert.throws(() => validateMobileRelease(base, 'http://omos-mining.com'), /HTTPS/);
});

test('origin memakai forwarded HTTPS dari reverse proxy', () => {
  const req = {
    protocol: 'http',
    get(name) {
      return name === 'x-forwarded-proto' ? 'https' : 'omos-mining.com';
    },
  };
  assert.equal(requestOrigin(req), 'https://omos-mining.com');
});
