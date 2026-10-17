const fs = require('fs');
const path = require('path');

const DEFAULT_MANIFEST_PATH = path.join(__dirname, '../public/mobile-release.json');

function validateMobileRelease(raw, origin) {
  if (!raw || typeof raw !== 'object') throw new Error('Mobile release manifest tidak valid');
  const versionCode = Number(raw.version_code);
  const versionName = String(raw.version_name || '').trim();
  const minimumSupportedVersion = Number(raw.minimum_supported_version);
  const sha256 = String(raw.sha256 || '').trim().toLowerCase();
  const apkPath = String(raw.apk_path || '').trim();

  if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error('version_code tidak valid');
  if (!versionName) throw new Error('version_name wajib diisi');
  if (!Number.isInteger(minimumSupportedVersion) || minimumSupportedVersion < 1 || minimumSupportedVersion > versionCode) {
    throw new Error('minimum_supported_version tidak valid');
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('sha256 APK tidak valid');
  if (!apkPath.startsWith('/') || apkPath.includes('..')) throw new Error('apk_path tidak valid');

  const base = new URL(origin);
  if (base.protocol !== 'https:') throw new Error('Origin update wajib HTTPS');
  return {
    version_code: versionCode,
    version_name: versionName,
    minimum_supported_version: minimumSupportedVersion,
    mandatory: Boolean(raw.mandatory),
    apk_url: new URL(apkPath, base).toString(),
    sha256,
    release_notes: Array.isArray(raw.release_notes)
      ? raw.release_notes.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
      : [],
  };
}

function requestOrigin(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

function loadMobileRelease(req, manifestPath = process.env.MOBILE_RELEASE_MANIFEST || DEFAULT_MANIFEST_PATH) {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return validateMobileRelease(raw, requestOrigin(req));
}

module.exports = {
  DEFAULT_MANIFEST_PATH,
  loadMobileRelease,
  requestOrigin,
  validateMobileRelease,
};
