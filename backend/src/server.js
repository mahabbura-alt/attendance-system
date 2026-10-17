require('dotenv').config();
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const express = require('express');
const cors = require('cors');

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
const productionRoutes = require('./routes/production.routes');
const fuelInventoryRoutes = require('./routes/fuelInventory.routes');
const fuelEvidenceRoutes = require('./routes/fuelEvidence.routes');
const fuelMobileRoutes = require('./routes/fuelMobile.routes');
const fuelAccessRoutes = require('./routes/fuelAccess.routes');
const logisticsRoutes = require('./routes/logistics.routes');
const hseRoutes = require('./routes/hse.routes');
const hseMobileRoutes = require('./routes/hseMobile.routes');
const { securityHeaders, requestId, requestTiming, createRateLimiter } = require('./middleware/security');
const { uploadErrorHandler } = require('./middleware/upload');
const { loadMobileRelease } = require('./services/mobileRelease');

const app = express();

app.disable('x-powered-by');
app.use(requestId);
app.use(requestTiming);
app.use(securityHeaders);
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Password', 'X-Request-Id'],
  exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'Server-Timing'],
}));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', serverless: Boolean(process.env.VERCEL) }));

app.get('/api/app/version', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(loadMobileRelease(req));
  } catch (error) {
    console.error(JSON.stringify({ requestId: req.id, message: 'Mobile release manifest unavailable', detail: error.message }));
    res.status(503).json({ error: 'Informasi pembaruan aplikasi belum tersedia', request_id: req.id });
  }
});

app.use('/api/auth', createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 100),
  message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
}), authRoutes);
app.use('/api/absensi', absensiRoutes);
app.use('/api/admin/production', productionRoutes);
app.use('/api/admin/production/fuel-inventory', fuelInventoryRoutes);
app.use('/api/fuel-evidence', fuelEvidenceRoutes);
app.use('/api/fuel/mobile', fuelMobileRoutes);
app.use('/api/admin/fuel-access', fuelAccessRoutes);
app.use('/api/logistics', logisticsRoutes);
app.use('/api/hse/mobile', hseMobileRoutes);
app.use('/api/hse', hseRoutes);
app.use('/api/admin/hse', hseRoutes);
app.use('/api/admin/karyawan', karyawanRoutes);
app.use('/api/admin/lokasi', lokasiRoutes);
app.use('/api/admin/payroll', payrollRoutes);
app.use('/api/admin/hm', hmRoutes);
app.use('/api/admin/kalkulasi-payroll', kalkulasiPayrollRoutes);
app.use('/api/admin', adminRoutes);

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

// APK OMOS Safety (self-hosted; manifest di /api/hse/mobile/app-version). Di bawah /api/ agar
// diteruskan nginx tanpa perubahan konfigurasi.
app.get(['/api/app/omos-safety.apk', '/OMOS_Safety.apk'], (req, res) => {
  const apkPath = require('path').join(__dirname, 'public/OMOS_Safety.apk');
  if (!require('fs').existsSync(apkPath)) return res.status(404).send('File APK belum tersedia');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="OMOS_Safety.apk"');
  return res.sendFile(apkPath);
});

// APK OMOS Fuel (manifest di /api/fuel/mobile/app-version).
app.get(['/api/app/omos-fuel.apk', '/OMOS_Fuel.apk'], (req, res) => {
  const apkPath = require('path').join(__dirname, 'public/OMOS_Fuel.apk');
  if (!require('fs').existsSync(apkPath)) return res.status(404).send('File APK belum tersedia');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="OMOS_Fuel.apk"');
  return res.sendFile(apkPath);
});

// Mobile Web Portal Routes (Fallback & Local Preview)
const pathModule = require('path');
const fsModule = require('fs');
const mobileWebDir = pathModule.join(__dirname, '../../mobile-web');
if (fsModule.existsSync(mobileWebDir)) {
  app.use('/mobile-web', express.static(mobileWebDir));
  app.use('/mobile', express.static(mobileWebDir));
  app.get(['/mobile', '/portal', '/karyawan', '/karyawan.html'], (req, res) => {
    res.sendFile(pathModule.join(mobileWebDir, 'index.html'));
  });
  app.get('/karyawan.js', (req, res) => {
    res.sendFile(pathModule.join(mobileWebDir, 'karyawan.js'));
  });
}

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

assertEnvironment();

async function checkDependencies() {
  try {
    await pool.query('SELECT 1');
    const fs = require('fs');
    const path = require('path');
    const baseSqlPath = path.join(__dirname, '../sql/schema.sql');
    if (fs.existsSync(baseSqlPath)) {
      const baseSqlContent = fs.readFileSync(baseSqlPath, 'utf8');
      await pool.query(baseSqlContent);
    }
    const sqlPath = path.join(__dirname, '../sql/003_mining_production_schema.sql');
    if (fs.existsSync(sqlPath)) {
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');
      await pool.query(sqlContent);
      console.log('⛏️ [Database] Tabel Mining Production Management System siap!');
      if (String(process.env.SEED_PRODUCTION_DUMMY_DATA || '').trim().toLowerCase() === 'true') {
        const seedDummyData = require('./scripts/seedProductionDummyData');
        await seedDummyData();
      }
    }
  } catch (err) {
    console.warn(`[DB Warning] PostgreSQL query test: ${err.message}`);
  }

}

// P1: jangan jalankan DDL, seed, atau pemeriksaan DB pada cold start.
// Infrastruktur database kini disiapkan lewat migration 024 sebelum deployment.

// Preview localhost: buka port hanya saat file dijalankan langsung
// (`node src/server.js`). Di Vercel file ini di-require sebagai handler
// (require.main !== module) sehingga blok ini tidak berjalan dan tidak
// mengubah perilaku produksi.
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Backend preview: http://localhost:${port}`));
  // Worker antrean AI (cek hazard ganda). Matikan dengan AI_WORKER=off.
  if (String(process.env.AI_WORKER || 'on').toLowerCase() !== 'off') {
    const { startWorker } = require('./ai/aiJobs');
    const hseAi = require('./services/hseAi');
    startWorker(pool, { [hseAi.DUP_AGENT_ID]: hseAi.duplicateJobHandler }, {
      intervalMs: Number(process.env.AI_WORKER_INTERVAL_MS || 5000),
    });
  }
  // Eskalasi hazard lewat batas ke Delegator departemen (OMOS Safety). Matikan dengan HSE_ESCALATION=off.
  if (String(process.env.HSE_ESCALATION || 'on').toLowerCase() !== 'off') {
    require('./services/hseMobile').startEscalationWorker(pool, {
      intervalMs: Number(process.env.HSE_ESCALATION_INTERVAL_MS || 10 * 60 * 1000),
    });
  }
}

module.exports = app;
