'use strict';

/**
 * Login APK OMOS Fuel: Employee ID + PIN 6 digit (terpisah dari password utama),
 * perangkat wajib disetujui admin, token bercakupan `fuel_mobile`.
 * Keputusan owner (grilling 2026-10-17): salah PIN 5× → terkunci sampai reset admin;
 * perangkat dicabut → transaksi yang dibuat sebelum pencabutan tetap diterima (ditandai).
 */
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { normalizeEmployeeId } = require('./employeeIdentity');

const SCOPE = 'fuel_mobile';
const FUNCTIONS = ['fill', 'transfer', 'receipt', 'opname', 'shift'];
const BCRYPT_COST = 12;
const err = (message, status = 400, code = null, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

/* ---------- fungsi murni ---------- */

function validPinFormat(pin) {
  return /^\d{6}$/.test(String(pin || ''));
}

/** PIN yang terlalu mudah ditebak: semua sama, berurutan naik/turun. */
function isTrivialPin(pin) {
  const s = String(pin || '');
  if (!validPinFormat(s)) return true;
  if (/^(\d)\1{5}$/.test(s)) return true;
  const naik = '01234567890123';
  const turun = '98765432109876';
  return naik.includes(s) || turun.includes(s);
}

/** PIN sementara acak non-trivial (crypto). */
function generateTempPin() {
  for (;;) {
    const pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (!isTrivialPin(pin)) return pin;
  }
}

function tokenTtl() {
  return process.env.FUEL_MOBILE_TOKEN_TTL || '7d';
}

/* ---------- pengaturan ---------- */

async function getSettings(db = pool) {
  const r = await db.query('SELECT * FROM fuel_mobile_settings WHERE id = 1');
  const s = r.rows[0] || {};
  return {
    hm_gap_tolerance_hours: Number(s.hm_gap_tolerance_hours ?? 1),
    totalizer_tolerance_pct: Number(s.totalizer_tolerance_pct ?? 0.5),
    totalizer_tolerance_liter: Number(s.totalizer_tolerance_liter ?? 20),
    offline_pin_days: Number(s.offline_pin_days ?? 7),
    pin_max_attempts: Number(s.pin_max_attempts ?? 5),
    late_entry_grace_hours: Number(s.late_entry_grace_hours ?? 2),
  };
}

/* ---------- login ---------- */

async function upsertDevice(db, { device_uid, device_name, model, app_version }, userId) {
  const uid = String(device_uid || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(uid)) throw err('Identitas perangkat tidak valid.', 400, 'DEVICE_UID_INVALID');
  const r = await db.query(
    `INSERT INTO fuel_devices (device_uid, device_name, model, app_version, registered_by, last_seen_at, last_user_id)
     VALUES ($1,$2,$3,$4,$5,now(),$5)
     ON CONFLICT (device_uid) DO UPDATE SET
       device_name = COALESCE(EXCLUDED.device_name, fuel_devices.device_name),
       model = COALESCE(EXCLUDED.model, fuel_devices.model),
       app_version = COALESCE(EXCLUDED.app_version, fuel_devices.app_version),
       last_seen_at = now(), last_user_id = EXCLUDED.last_user_id
     RETURNING id, device_code, device_name, model, status, approved_at, revoked_at, revoke_reason`,
    [uid, device_name ? String(device_name).slice(0, 100) : null, model ? String(model).slice(0, 100) : null,
      app_version ? String(app_version).slice(0, 40) : null, userId]);
  return r.rows[0];
}

async function login(input = {}) {
  const employeeId = normalizeEmployeeId(input.employee_id);
  const pin = String(input.pin || '');
  if (!employeeId || !validPinFormat(pin)) throw err('Employee ID atau PIN salah.', 401, 'INVALID_CREDENTIALS');
  const settings = await getSettings();
  const r = await pool.query(
    `SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen, u.role,
            a.pin_hash, a.must_change_pin, a.allowed_functions, a.allowed_location_ids,
            a.failed_attempts, a.locked_at
     FROM users u JOIN fuel_operator_accounts a ON a.user_id = u.id
     WHERE LOWER(TRIM(u.employee_id)) = LOWER($1) AND u.is_active = TRUE AND a.is_active = TRUE
     LIMIT 1`, [employeeId]);
  const akun = r.rows[0];
  if (!akun) throw err('Employee ID atau PIN salah.', 401, 'INVALID_CREDENTIALS');
  if (akun.locked_at) throw err('Akun Fuel terkunci. Minta admin Fuel mereset PIN.', 423, 'ACCOUNT_LOCKED');
  const cocok = await bcrypt.compare(pin, akun.pin_hash);
  if (!cocok) {
    const gagal = Number(akun.failed_attempts || 0) + 1;
    const kunci = gagal >= settings.pin_max_attempts;
    await pool.query(`UPDATE fuel_operator_accounts SET failed_attempts = $2, locked_at = CASE WHEN $3 THEN now() ELSE locked_at END,
      updated_at = now() WHERE user_id = $1`, [akun.id, gagal, kunci]);
    if (kunci) throw err('PIN salah terlalu sering. Akun Fuel terkunci; minta admin mereset PIN.', 423, 'ACCOUNT_LOCKED');
    throw err(`Employee ID atau PIN salah. Sisa percobaan ${settings.pin_max_attempts - gagal}.`, 401, 'INVALID_CREDENTIALS',
      { details: { remaining_attempts: settings.pin_max_attempts - gagal } });
  }
  await pool.query('UPDATE fuel_operator_accounts SET failed_attempts = 0, updated_at = now() WHERE user_id = $1', [akun.id]);
  const device = await upsertDevice(pool, input, akun.id);
  if (device.status === 'pending') {
    throw err('Perangkat belum disetujui admin Fuel.', 403, 'DEVICE_PENDING', { details: { device_code: device.device_code } });
  }
  if (device.status === 'revoked') {
    throw err('Perangkat ini sudah dicabut admin Fuel.', 403, 'DEVICE_REVOKED', { details: { device_code: device.device_code } });
  }
  const token = jwt.sign({ id: akun.id, role: akun.role, scope: SCOPE, fuel_device_id: device.id },
    process.env.JWT_SECRET, { expiresIn: tokenTtl() });
  return {
    token,
    must_change_pin: Boolean(akun.must_change_pin),
    user: { id: akun.id, nama: akun.nama, employee_id: akun.employee_id, jabatan: akun.jabatan, departemen: akun.departemen },
    access: { functions: akun.allowed_functions || [], location_ids: akun.allowed_location_ids || [] },
    device: { id: device.id, device_code: device.device_code, device_name: device.device_name, status: device.status },
    offline_pin_days: settings.offline_pin_days,
  };
}

async function changePin(userId, { old_pin, new_pin } = {}) {
  if (!validPinFormat(new_pin)) throw err('PIN baru harus 6 digit angka.', 400, 'PIN_FORMAT');
  if (isTrivialPin(new_pin)) throw err('PIN terlalu mudah ditebak (angka sama/berurutan).', 400, 'PIN_TRIVIAL');
  const r = await pool.query('SELECT pin_hash FROM fuel_operator_accounts WHERE user_id = $1 AND is_active = TRUE', [userId]);
  if (!r.rows.length) throw err('Akun Fuel tidak aktif.', 403, 'ACCOUNT_INACTIVE');
  if (!(await bcrypt.compare(String(old_pin || ''), r.rows[0].pin_hash))) throw err('PIN lama salah.', 401, 'INVALID_CREDENTIALS');
  if (await bcrypt.compare(String(new_pin), r.rows[0].pin_hash)) throw err('PIN baru harus berbeda dari PIN lama.', 400, 'PIN_REUSED');
  const hash = await bcrypt.hash(String(new_pin), BCRYPT_COST);
  await pool.query(`UPDATE fuel_operator_accounts SET pin_hash = $2, must_change_pin = FALSE, pin_changed_at = now(),
    failed_attempts = 0, updated_at = now() WHERE user_id = $1`, [userId, hash]);
  return { ok: true };
}

/* ---------- middleware sesi ---------- */

/**
 * Wajib token cakupan fuel_mobile + akun Fuel aktif + perangkat disetujui.
 * Perangkat dicabut hanya boleh sync/status (transaksi sebelum pencabutan tetap diterima).
 */
function requireFuelMobile({ allowRevokedDevice = false } = {}) {
  return async (req, res, next) => {
    try {
      if (req.user?.token_scope !== SCOPE) {
        return res.status(403).json({ error: 'Gunakan login APK OMOS Fuel.', code: 'TOKEN_SCOPE' });
      }
      const [akun, perangkat] = await Promise.all([
        pool.query(`SELECT allowed_functions, allowed_location_ids, must_change_pin, locked_at
          FROM fuel_operator_accounts WHERE user_id = $1 AND is_active = TRUE`, [req.user.id]),
        pool.query('SELECT id, device_code, status, revoked_at FROM fuel_devices WHERE id = $1', [req.user.fuel_device_id || null]),
      ]);
      const a = akun.rows[0];
      if (!a || a.locked_at) return res.status(401).json({ error: 'Akun Fuel tidak aktif atau terkunci.', code: 'ACCOUNT_INACTIVE' });
      const d = perangkat.rows[0];
      if (!d) return res.status(401).json({ error: 'Perangkat tidak dikenal.', code: 'DEVICE_UNKNOWN' });
      if (d.status === 'revoked' && !allowRevokedDevice) {
        return res.status(403).json({ error: 'Perangkat ini sudah dicabut admin Fuel.', code: 'DEVICE_REVOKED' });
      }
      if (d.status === 'pending') return res.status(403).json({ error: 'Perangkat belum disetujui.', code: 'DEVICE_PENDING' });
      req.fuel = {
        functions: a.allowed_functions || [], locationIds: (a.allowed_location_ids || []).map(String),
        mustChangePin: Boolean(a.must_change_pin), device: d,
      };
      pool.query('UPDATE fuel_devices SET last_seen_at = now(), last_user_id = $2 WHERE id = $1', [d.id, req.user.id]).catch(() => {});
      return next();
    } catch (error) {
      if (error.code === '42P01' || error.code === '42703') {
        return res.status(503).json({ error: 'Skema OMOS Fuel belum tersedia. Jalankan migrasi 104.', code: 'MIGRATION_REQUIRED' });
      }
      return next(error);
    }
  };
}

module.exports = {
  SCOPE, FUNCTIONS, BCRYPT_COST,
  validPinFormat, isTrivialPin, generateTempPin,
  getSettings, login, changePin, requireFuelMobile, upsertDevice,
};
