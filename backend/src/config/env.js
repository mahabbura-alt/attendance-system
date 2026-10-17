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

  const provider = String(process.env.STORAGE_PROVIDER || 'supabase').toLowerCase();
  if (provider === 'supabase') {
    const storageMissing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
      .filter((name) => !process.env[name] || process.env[name].startsWith('ganti_'));
    if (storageMissing.length) {
      throw new Error(`Konfigurasi Supabase Storage belum lengkap: ${storageMissing.join(', ')}`);
    }
  } else if (provider === 'local') {
    if (!process.env.STORAGE_LOCAL_ROOT || !process.env.PUBLIC_BASE_URL) {
      throw new Error('STORAGE_LOCAL_ROOT dan PUBLIC_BASE_URL wajib untuk local storage');
    }
  } else {
    throw new Error(`STORAGE_PROVIDER tidak didukung: ${provider}`);
  }
}

module.exports = { assertEnvironment };
