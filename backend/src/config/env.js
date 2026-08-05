const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'MINIO_ENDPOINT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'COMPREFACE_BASE_URL',
  'COMPREFACE_RECOGNITION_API_KEY',
];

function assertEnvironment() {
  const missing = required.filter((name) => !process.env[name] || process.env[name].startsWith('ganti_'));
  if (missing.length) {
    throw new Error(`Konfigurasi environment belum lengkap: ${missing.join(', ')}`);
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET harus memiliki minimal 32 karakter acak');
  }
}

module.exports = { assertEnvironment };
