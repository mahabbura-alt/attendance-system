require('dotenv').config();
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const express = require('express');
const cors = require('cors');

const { pastikanBucketTersedia } = require('./config/minio');
const { pool } = require('./config/db');
const { assertEnvironment } = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const absensiRoutes = require('./routes/absensi.routes');
const adminRoutes = require('./routes/admin.routes');
const karyawanRoutes = require('./routes/karyawan.routes');
const lokasiRoutes = require('./routes/lokasi.routes');
const payrollRoutes = require('./routes/payroll.routes');
const hmRoutes = require('./routes/hm.routes');
const kalkulasiPayrollRoutes = require('./routes/kalkulasiPayroll.routes');
const { securityHeaders, requestId, createRateLimiter } = require('./middleware/security');
const { uploadErrorHandler } = require('./middleware/upload');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
app.disable('x-powered-by');
app.use(requestId);
app.use(securityHeaders);
app.use(cors({
  origin(origin, callback) {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('192.168.') ||
      origin.includes('10.') ||
      origin.includes('172.')
    ) {
      return callback(null, true);
    }
    callback(Object.assign(new Error('Origin tidak diizinkan'), { statusCode: 403 }));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Password'],
  exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
}), authRoutes);
app.use('/api/absensi', absensiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/karyawan', karyawanRoutes);
app.use('/api/admin/lokasi', lokasiRoutes);
app.use('/api/admin/payroll', payrollRoutes);
app.use('/api/admin/hm', hmRoutes);
app.use('/api/admin/kalkulasi-payroll', kalkulasiPayrollRoutes);

const storageRoutes = require('./routes/storage.routes');
app.use('/api/storage', storageRoutes);

app.use(uploadErrorHandler);

// Error handler terpusat. Jangan kirim detail internal ke klien.
app.use((err, req, res, next) => {
  console.error(JSON.stringify({ requestId: req.id, message: err.message, stack: err.stack }));
  const status = err.statusCode || 500;
  res.status(status).json({
    error: status >= 500 ? 'Terjadi kesalahan pada server' : err.message,
    request_id: req.id,
  });
});

const PORT = process.env.PORT || 3000;

assertEnvironment();

async function checkDependencies() {
  try {
    await pool.query('SELECT 1');
    
    // Auto-Migration
    await pool.query(`
      ALTER TABLE absensi 
      ADD COLUMN IF NOT EXISTS percobaan_pulang_awal INTEGER DEFAULT 0;
      ALTER TABLE users DROP COLUMN IF EXISTS nik_ktp;
      ALTER TABLE registrasi_pending DROP COLUMN IF EXISTS nik_ktp;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '["absensi", "karyawan", "performa", "registrasi", "payroll", "hm", "kalkulasiPayroll"]';
      UPDATE users SET is_super_admin = TRUE WHERE role = 'admin' AND (email = 'admin@perusahaan.com' OR is_super_admin IS TRUE OR id IN (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1));
    `);
  } catch (err) {
    throw new Error(`PostgreSQL tidak terhubung di ${process.env.DATABASE_URL || 'localhost:5432'} (${err.code || err.message}). Pastikan PostgreSQL sudah dinyalakan.`);
  }

  try {
    await pastikanBucketTersedia();
  } catch (err) {
    console.warn(`[MinIO Warning] MinIO belum aktif (${err.message}).`);
  }
}

assertEnvironment();

checkDependencies()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server berjalan di http://0.0.0.0:${PORT} (dapat diakses dari HP via IP local)`);
    });
  })
  .catch((err) => {
    console.error('❌ Gagal startup backend:', err.message);
    process.exit(1);
  });
