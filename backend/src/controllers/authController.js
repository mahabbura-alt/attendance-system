const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { kirimEmailResetPassword } = require('../services/email');
const { resolveLoginIdentifier, ensurePasswordResetSchema } = require('../services/passwordReset');

// ============================================================
// LOGIN
// ============================================================
async function login(req, res, next) {
  try {
    return await handleLogin(req, res);
  } catch (err) {
    return next(err);
  }
}

async function handleLogin(req, res) {
  const { password } = req.body;
  const identifier = resolveLoginIdentifier(req.body);

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Employee ID / email dan password wajib diisi' });
  }
  const label = identifier.type === 'employee_id' ? 'Employee ID' : 'Email';
  const whereClause = identifier.type === 'employee_id'
    ? 'LOWER(TRIM(employee_id)) = $1'
    : 'LOWER(email) = $1';

  await ensurePasswordResetSchema(pool);
  const { rows } = await pool.query(
    `SELECT id, nama, email, employee_id, jabatan, departemen, password_hash, role, shift_id, lokasi_kantor_id,
            compreface_subject, is_super_admin, permissions, must_change_password
     FROM users WHERE ${whereClause} AND is_active = TRUE`,
    [identifier.value]
  );

  const user = rows[0];
  if (!user) {
    console.warn(`⚠️ Login gagal: ${label} '${identifier.value}' tidak ditemukan / tidak aktif`);
    return res.status(401).json({ error: `${label} atau password salah` });
  }

  const cocok = await bcrypt.compare(password, user.password_hash);
  if (!cocok) {
    console.warn(`⚠️ Login gagal: Password salah untuk ${label} '${identifier.value}'`);
    return res.status(401).json({ error: `${label} atau password salah` });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, lokasi_kantor_id: user.lokasi_kantor_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      nama: user.nama,
      email: user.email,
      employee_id: user.employee_id || null,
      jabatan: user.jabatan || null,
      departemen: user.departemen || null,
      shift_id: user.shift_id || null,
      lokasi_kantor_id: user.lokasi_kantor_id || null,
      must_change_password: Boolean(user.must_change_password),
      role: user.role,
      is_super_admin: Boolean(user.is_super_admin),
      permissions: user.permissions || ["absensi", "karyawan", "performa", "roster", "registrasi", "payroll", "hm", "kalkulasiPayroll", "produksi"],
    },
  });
}

// ============================================================
// DAFTAR AKUN (Karyawan mendaftar mandiri → admin approve)
// ============================================================
async function daftar(req, res, next) {
  try {
    console.log('DAFTAR BODY:', req.body);
    console.log('DAFTAR FILES:', req.files);
    const { nama, email, jabatan, departemen, password, shift_id, lokasi_kantor_id } = req.body;

    if (!nama || !email || !password) {
      return res.status(400).json({ error: 'nama, email, dan password wajib diisi' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password minimal 8 karakter' });
    }

    const { uploadFoto } = require('../services/storage');

    let foto1Url = null;
    let foto2Url = null;
    let foto3Url = null;

    const files = req.files || [];
    const file1 = Array.isArray(files) ? files.find(f => f.fieldname === 'foto1') : req.files?.foto1?.[0];
    const file2 = Array.isArray(files) ? files.find(f => f.fieldname === 'foto2') : req.files?.foto2?.[0];
    const file3 = Array.isArray(files) ? files.find(f => f.fieldname === 'foto3') : req.files?.foto3?.[0];

    const safeEmail = email.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');

    if (file1) foto1Url = await uploadFoto(file1.buffer, { userId: `reg_${safeEmail}`, jenis: 'sample1' });
    if (file2) foto2Url = await uploadFoto(file2.buffer, { userId: `reg_${safeEmail}`, jenis: 'sample2' });
    if (file3) foto3Url = await uploadFoto(file3.buffer, { userId: `reg_${safeEmail}`, jenis: 'sample3' });

    const passwordHash = await bcrypt.hash(password, 12);

    const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const cleanShiftId = isUuid(shift_id) ? shift_id : null;
    const cleanLokasiId = isUuid(lokasi_kantor_id) ? lokasi_kantor_id : null;

    await pool.query(
      `INSERT INTO registrasi_pending
         (nama, email, jabatan, departemen, password_hash, shift_id, lokasi_kantor_id,
          foto_referensi_1_url, foto_referensi_2_url, foto_referensi_3_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        nama.trim(), email.toLowerCase().trim(),
        jabatan || null, departemen || null, passwordHash,
        cleanShiftId, cleanLokasiId,
        foto1Url, foto2Url, foto3Url
      ]
    );

    res.status(201).json({
      message: 'Pendaftaran berhasil dikirim. Akun Anda akan aktif setelah disetujui admin.',
    });
  } catch (err) {
    if (err.code === '23505') {
      const detail = err.detail || '';
      if (detail.includes('email')) return res.status(409).json({ error: 'Email sudah terdaftar atau sedang dalam proses pendaftaran' });
    }
    next(err);
  }
}

// ============================================================
// LUPA SANDI — Kirim token reset ke email karyawan
// ============================================================
async function lupaSandi(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email wajib diisi' });

    const cleanEmail = email.toLowerCase().trim();
    const { rows } = await pool.query(
      `SELECT id, nama FROM users WHERE email = $1 AND is_active = TRUE`,
      [cleanEmail]
    );

    let generatedToken = null;

    if (rows[0]) {
      const user = rows[0];
      const token = crypto.randomInt(100000, 999999).toString(); // 6-digit OTP
      generatedToken = token;
      const expiresMenit = Number(process.env.RESET_TOKEN_EXPIRES_MINUTES) || 60;

      await pool.query(
        `DELETE FROM password_reset_tokens WHERE user_id = $1 AND used = FALSE`,
        [user.id]
      );

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES ($1, $2, now() + $3 * interval '1 minute')`,
        [user.id, token, expiresMenit]
      );

      console.log(`🔑 [RESET PASSWORD OTP] Email: ${cleanEmail} | Kode OTP: ${token}`);

      kirimEmailResetPassword(cleanEmail, user.nama, token).catch((err) => {
        console.error('Gagal mengirim email reset:', err.message);
      });
    }

    res.json({
      message: 'Kode OTP Reset Password telah dikirim. Silakan cek email Anda atau masukkan OTP.',
      otp_demo: generatedToken
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// RESET SANDI — Verifikasi token dan set password baru
// ============================================================
async function resetSandi(req, res, next) {
  try {
    const { email, token, password_baru } = req.body;

    if (!email || !token || !password_baru) {
      return res.status(400).json({ error: 'email, token, dan password_baru wajib diisi' });
    }
    if (password_baru.length < 8) {
      return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
    }

    // Cari token valid milik user ini
    const { rows } = await pool.query(
      `SELECT prt.id, prt.user_id
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE u.email = $1
         AND prt.token = $2
         AND prt.used = FALSE
         AND prt.expires_at > now()`,
      [email.toLowerCase().trim(), token]
    );

    if (!rows[0]) {
      return res.status(400).json({ error: 'Token tidak valid atau sudah kedaluwarsa' });
    }

    const { id: tokenId, user_id } = rows[0];
    const passwordHash = await bcrypt.hash(password_baru, 12);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [passwordHash, user_id]
      );
      await client.query(
        `UPDATE password_reset_tokens SET used = TRUE WHERE id = $1`,
        [tokenId]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ message: 'Password berhasil direset. Silakan login dengan password baru.' });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// MINTA RESET SANDI — karyawan lapangan (tanpa email) minta reset ke admin
// ============================================================
async function mintaResetSandi(req, res, next) {
  try {
    const { employee_id } = req.body;
    const identifier = resolveLoginIdentifier({ employee_id });
    if (!identifier) return res.status(400).json({ error: 'Employee ID wajib diisi' });

    await ensurePasswordResetSchema(pool);
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE LOWER(TRIM(employee_id)) = $1 AND is_active = TRUE LIMIT 1`,
      [identifier.value]
    );
    if (rows[0]) {
      await pool.query(
        `INSERT INTO password_reset_requests (user_id, source)
         VALUES ($1, $2)
         ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING`,
        [rows[0].id, req.body.source === 'web' ? 'web' : 'mobile']
      );
    }

    // Respons sama untuk ID terdaftar maupun tidak, agar ID karyawan tidak bisa ditebak.
    res.json({
      message: 'Permintaan reset sandi dikirim ke admin. Hubungi admin/atasan untuk menerima sandi sementara.',
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GANTI SANDI — dipakai setelah login dengan sandi sementara
// ============================================================
async function gantiSandi(req, res, next) {
  try {
    const { password_lama, password_baru } = req.body;
    if (!password_lama || !password_baru) {
      return res.status(400).json({ error: 'password_lama dan password_baru wajib diisi' });
    }
    if (typeof password_baru !== 'string' || password_baru.length < 8) {
      return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
    }
    if (password_baru === password_lama) {
      return res.status(400).json({ error: 'Password baru harus berbeda dari password lama' });
    }

    await ensurePasswordResetSchema(pool);
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE`, [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(password_lama, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Password lama salah' });
    }

    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2`,
      [await bcrypt.hash(password_baru, 12), req.user.id]
    );
    res.json({ message: 'Password berhasil diganti.' });
  } catch (err) {
    next(err);
  }
}

const DEPARTEMEN_JABATAN_MAP = {
  'Produksi': ['SPV Produksi', 'Pengawas', 'Operator', 'Driver DT', 'Driver WT', 'Checker'],
  'Engineering': ['SPV Engineering', 'Mine Plan', 'Foreman Moco', 'Admin', 'Surveyor', 'Ast Survey', 'Helper Survey'],
  'Logistik': ['Foreman Logistik', 'Logistik', 'Admin', 'Fuelman', 'Ekspeditor'],
  'HSE': ['SPV HSE', 'HSE Officer', 'Safety Patrol', 'Helper HSE'],
  'Maintenance': ['SPV Maintenance', 'Foreman Maintenance', 'Mekanik', 'Welder', 'Auto Electrician', 'Admin Maintenance', 'Helper Maintenance', 'Helper Mekanik'],
  'HRGA & Finance': ['Foreman HR', 'Admin HR', 'Admin Finance', 'Driver Sarana'],
  'Management': ['PJO'],
};

// ============================================================
// Endpoint publik: daftar shift, lokasi, dan struktur dept-jabatan
// ============================================================
async function daftarShiftDanLokasi(req, res, next) {
  try {
    const [shiftsResult, lokasiResult] = await Promise.all([
      pool.query('SELECT id, nama_shift, jam_masuk_maks, jam_pulang_min, operational_start, operational_end, lintas_hari FROM shifts ORDER BY nama_shift'),
      pool.query('SELECT id, nama_lokasi FROM lokasi_kantor ORDER BY nama_lokasi'),
    ]);
    res.json({
      shifts: shiftsResult.rows,
      lokasi: lokasiResult.rows,
      departemen_jabatan: DEPARTEMEN_JABATAN_MAP,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, daftar, lupaSandi, resetSandi, mintaResetSandi, gantiSandi, daftarShiftDanLokasi };
