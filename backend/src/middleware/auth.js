const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const FUEL_MOBILE_PATHS = ['/api/fuel/mobile', '/api/fuel-evidence'];

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      `SELECT id, role, lokasi_kantor_id, is_super_admin, permissions
       FROM users
       WHERE id = $1 AND is_active = TRUE
       LIMIT 1`,
      [payload.id],
    );
    const currentUser = rows[0];
    if (!currentUser) {
      return res.status(401).json({
        code: 'ACCOUNT_INACTIVE',
        error: 'Akun tidak ditemukan atau sudah dinonaktifkan. Silakan masuk kembali.',
      });
    }
    // Identity and authorization always come from current server data, not a stale JWT claim.
    req.user = { ...payload, ...currentUser, token_scope: payload.scope || null };
    // Token APK OMOS Fuel hanya berlaku untuk API Fuel mobile & bukti foto Fuel.
    if (payload.scope === 'fuel_mobile') {
      const path = `${req.baseUrl || ''}${req.path || ''}`;
      if (!FUEL_MOBILE_PATHS.some(prefix => path.startsWith(prefix))) {
        return res.status(403).json({ code: 'TOKEN_SCOPE', error: 'Token APK OMOS Fuel tidak berlaku untuk endpoint ini.' });
      }
      // Hak modul Fuel diberikan oleh akun Fuel (dicek ulang di requireFuelMobile / fuel-evidence).
      req.user.role = 'karyawan';
    }
    next();
  } catch (err) {
    if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError' && err.name !== 'NotBeforeError') {
      return next(err);
    }
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Hanya admin yang boleh mengakses endpoint ini' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
