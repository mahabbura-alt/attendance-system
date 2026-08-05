const required = [
  'DATABASE_URL',
  'JWT_SECRET',
];

function assertEnvironment() {
  const missing = required.filter((name) => !process.env[name] || process.env[name].startsWith('ganti_'));
  if (missing.length) {
    throw new Error(`Konfigurasi environment belum lengkap: ${missing.join(', ')}`);
  }
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 16) {
    throw new Error('JWT_SECRET harus memiliki minimal 16 karakter acak');
  }
}

module.exports = { assertEnvironment };
