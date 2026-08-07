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

app.disable('x-powered-by');
app.use(requestId);
app.use(securityHeaders);
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Password'],
  exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', serverless: Boolean(process.env.VERCEL) }));

app.use('/api/auth', createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 100),
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

// Public APK Download Route
app.get(['/Absensi_PIM.apk', '/Absensi%20PIM.apk', '/download-apk', '/api/download-apk'], (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const candidatePaths = [
    path.join(__dirname, 'public/Absensi_PIM.apk'),
    path.join(__dirname, '../public/Absensi_PIM.apk'),
    path.join(__dirname, '../../api/Absensi_PIM.apk'),
    path.join(__dirname, '../../Absensi PIM.apk'),
    path.join(__dirname, '../../admin-dashboard/Absensi_PIM.apk'),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="Absensi_PIM.apk"');
      return res.sendFile(p);
    }
  }
  res.status(404).send('File APK belum tersedia');
});

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

try {
  assertEnvironment();
} catch (e) {
  console.warn('[Env Warning]', e.message);
}

async function checkDependencies() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.warn(`[DB Warning] PostgreSQL query test: ${err.message}`);
  }

  try {
    await pastikanBucketTersedia();
  } catch (err) {
    console.warn(`[MinIO Warning] MinIO belum aktif: ${err.message}`);
  }
}

checkDependencies().catch(err => console.warn('[CheckDep Error]', err.message));

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
