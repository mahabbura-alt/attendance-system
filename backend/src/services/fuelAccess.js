'use strict';

/**
 * Admin Akses Fuel (panel di halaman Input Fuel): akun Fuel per karyawan + PIN,
 * persetujuan perangkat, pengaturan ambang, review tutup shift, ID scan & label QR.
 * Semua perubahan tercatat di fuel_inventory_audit (entity_type 'fuel_access').
 */
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const { pool } = require('../config/db');
const { FUNCTIONS, BCRYPT_COST, generateTempPin, getSettings } = require('./fuelMobileAuth');

const err = (message, status = 400, code = null) => Object.assign(new Error(message), { status }, code ? { code } : {});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value, label) {
  const s = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(s)) throw err(`${label} tidak valid.`);
  return s;
}

function normalizeFunctions(list) {
  const arr = [...new Set((Array.isArray(list) ? list : []).map(String))];
  const salah = arr.filter(f => !FUNCTIONS.includes(f));
  if (salah.length) throw err(`Fungsi tidak dikenal: ${salah.join(', ')}.`);
  return arr;
}

function normalizeLocations(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(x => uuid(x, 'Lokasi')))];
}

async function audit(db, { entityId, action, before = null, after = null, reason = null, actorId }) {
  await db.query(
    `INSERT INTO fuel_inventory_audit (entity_type, entity_id, action, before_data, after_data, reason, actor_id)
     VALUES ('fuel_access', $1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
    [entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason, actorId || null]);
}

/* ---------- akun ---------- */

async function listAccounts() {
  const r = await pool.query(
    `SELECT a.user_id, u.nama, u.employee_id, u.jabatan, u.departemen, u.is_active AS user_active,
            a.allowed_functions, a.allowed_location_ids, a.is_active, a.must_change_pin,
            a.failed_attempts, a.locked_at, a.pin_changed_at, a.created_at, a.updated_at,
            (SELECT d.device_code FROM fuel_devices d WHERE d.last_user_id = a.user_id ORDER BY d.last_seen_at DESC NULLS LAST LIMIT 1) AS last_device_code,
            (SELECT MAX(d.last_seen_at) FROM fuel_devices d WHERE d.last_user_id = a.user_id) AS last_seen_at
     FROM fuel_operator_accounts a JOIN users u ON u.id = a.user_id
     ORDER BY u.nama`);
  return r.rows;
}

/** Karyawan aktif yang belum punya akun Fuel (pencarian nama / Employee ID). */
async function listCandidates(q = '') {
  const cari = `%${String(q || '').trim().toLowerCase()}%`;
  const r = await pool.query(
    `SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen
     FROM users u LEFT JOIN fuel_operator_accounts a ON a.user_id = u.id
     WHERE u.is_active = TRUE AND a.user_id IS NULL AND u.employee_id IS NOT NULL AND TRIM(u.employee_id) <> ''
       AND (LOWER(u.nama) LIKE $1 OR LOWER(u.employee_id) LIKE $1)
     ORDER BY (LOWER(COALESCE(u.jabatan, '')) LIKE '%fuel%') DESC, u.nama LIMIT 50`, [cari]);
  return r.rows;
}

/** Buat akun → PIN sementara dikembalikan SEKALI (tidak disimpan dalam bentuk asli). */
async function createAccount({ user_id, functions, location_ids } = {}, actorId) {
  const userId = uuid(user_id, 'Karyawan');
  const u = (await pool.query('SELECT id, nama, employee_id, is_active FROM users WHERE id = $1', [userId])).rows[0];
  if (!u || !u.is_active) throw err('Karyawan tidak ditemukan atau tidak aktif.', 404);
  if (!String(u.employee_id || '').trim()) throw err('Karyawan belum memiliki Employee ID (dipakai untuk login APK).');
  const fungsi = normalizeFunctions(functions ?? ['fill', 'transfer', 'shift']);
  const lokasi = normalizeLocations(location_ids);
  const pin = generateTempPin();
  const hash = await bcrypt.hash(pin, BCRYPT_COST);
  try {
    await pool.query(
      `INSERT INTO fuel_operator_accounts (user_id, pin_hash, must_change_pin, allowed_functions, allowed_location_ids, created_by, updated_by)
       VALUES ($1,$2,TRUE,$3::text[],$4::uuid[],$5,$5)`, [userId, hash, fungsi, lokasi, actorId]);
  } catch (error) {
    if (error.code === '23505') throw err('Karyawan ini sudah memiliki akun Fuel.', 409);
    throw error;
  }
  await audit(pool, { entityId: userId, action: 'account_create', after: { functions: fungsi, location_ids: lokasi }, actorId });
  return { user_id: userId, nama: u.nama, employee_id: u.employee_id, temp_pin: pin, must_change_pin: true };
}

async function updateAccount(userId, { functions, location_ids, is_active } = {}, actorId) {
  const id = uuid(userId, 'Akun');
  const lama = (await pool.query('SELECT allowed_functions, allowed_location_ids, is_active FROM fuel_operator_accounts WHERE user_id = $1', [id])).rows[0];
  if (!lama) throw err('Akun Fuel tidak ditemukan.', 404);
  const baru = {
    allowed_functions: functions === undefined ? lama.allowed_functions : normalizeFunctions(functions),
    allowed_location_ids: location_ids === undefined ? lama.allowed_location_ids : normalizeLocations(location_ids),
    is_active: is_active === undefined ? lama.is_active : Boolean(is_active),
  };
  await pool.query(
    `UPDATE fuel_operator_accounts SET allowed_functions = $2::text[], allowed_location_ids = $3::uuid[], is_active = $4,
       updated_by = $5, updated_at = now() WHERE user_id = $1`,
    [id, baru.allowed_functions, baru.allowed_location_ids, baru.is_active, actorId]);
  await audit(pool, { entityId: id, action: 'account_update', before: lama, after: baru, actorId });
  return { user_id: id, ...baru };
}

/** Reset PIN: PIN sementara baru, buka kunci, wajib ganti saat login berikutnya. */
async function resetPin(userId, actorId) {
  const id = uuid(userId, 'Akun');
  const pin = generateTempPin();
  const hash = await bcrypt.hash(pin, BCRYPT_COST);
  const r = await pool.query(
    `UPDATE fuel_operator_accounts SET pin_hash = $2, must_change_pin = TRUE, failed_attempts = 0, locked_at = NULL,
       updated_by = $3, updated_at = now() WHERE user_id = $1 RETURNING user_id`, [id, hash, actorId]);
  if (!r.rows.length) throw err('Akun Fuel tidak ditemukan.', 404);
  await audit(pool, { entityId: id, action: 'pin_reset', actorId });
  return { user_id: id, temp_pin: pin, must_change_pin: true };
}

/* ---------- perangkat ---------- */

async function listDevices() {
  const r = await pool.query(
    `SELECT d.id, d.device_code, d.device_name, d.model, d.app_version, d.status, d.created_at,
            d.approved_at, d.revoked_at, d.revoke_reason, d.last_seen_at,
            ur.nama AS registered_by_nama, ul.nama AS last_user_nama
     FROM fuel_devices d
     LEFT JOIN users ur ON ur.id = d.registered_by
     LEFT JOIN users ul ON ul.id = d.last_user_id
     ORDER BY CASE d.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, d.created_at DESC`);
  return r.rows;
}

async function approveDevice(id, actorId) {
  const r = await pool.query(
    `UPDATE fuel_devices SET status = 'approved', approved_by = $2, approved_at = now(),
       revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL
     WHERE id = $1 AND status IN ('pending', 'revoked') RETURNING id, device_code, status`, [uuid(id, 'Perangkat'), actorId]);
  if (!r.rows.length) throw err('Perangkat tidak ditemukan atau sudah disetujui.', 404);
  await audit(pool, { entityId: r.rows[0].id, action: 'device_approve', after: r.rows[0], actorId });
  return r.rows[0];
}

async function revokeDevice(id, reason, actorId) {
  if (!String(reason || '').trim()) throw err('Alasan pencabutan wajib diisi.');
  const r = await pool.query(
    `UPDATE fuel_devices SET status = 'revoked', revoked_by = $2, revoked_at = now(), revoke_reason = $3
     WHERE id = $1 AND status <> 'revoked' RETURNING id, device_code, status, revoked_at`,
    [uuid(id, 'Perangkat'), actorId, String(reason).trim()]);
  if (!r.rows.length) throw err('Perangkat tidak ditemukan atau sudah dicabut.', 404);
  await audit(pool, { entityId: r.rows[0].id, action: 'device_revoke', after: r.rows[0], reason, actorId });
  return r.rows[0];
}

/* ---------- pengaturan ---------- */

const SETTING_KEYS = {
  hm_gap_tolerance_hours: [0, 24], totalizer_tolerance_pct: [0, 10], totalizer_tolerance_liter: [0, 1000],
  offline_pin_days: [1, 30], pin_max_attempts: [3, 10], late_entry_grace_hours: [0, 72],
};

async function updateSettings(input = {}, actorId) {
  const lama = await getSettings();
  const baru = { ...lama };
  for (const [k, [min, max]] of Object.entries(SETTING_KEYS)) {
    if (input[k] === undefined) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < min || n > max) throw err(`${k} harus antara ${min} dan ${max}.`);
    baru[k] = n;
  }
  await pool.query(
    `UPDATE fuel_mobile_settings SET hm_gap_tolerance_hours = $1, totalizer_tolerance_pct = $2, totalizer_tolerance_liter = $3,
       offline_pin_days = $4, pin_max_attempts = $5, late_entry_grace_hours = $6, updated_by = $7, updated_at = now() WHERE id = 1`,
    [baru.hm_gap_tolerance_hours, baru.totalizer_tolerance_pct, baru.totalizer_tolerance_liter,
      Math.round(baru.offline_pin_days), Math.round(baru.pin_max_attempts), baru.late_entry_grace_hours, actorId]);
  await audit(pool, { entityId: '00000000-0000-0000-0000-000000000000', action: 'settings_update', before: lama, after: baru, actorId });
  return baru;
}

/* ---------- review tutup shift ---------- */

async function listShiftSessions({ status = null, limit = 100 } = {}) {
  const r = await pool.query(
    `SELECT s.*, s.operational_date::text AS operational_date, l.location_code, sh.nama_shift,
            uo.nama AS opened_by_nama, uc.nama AS closed_by_nama, ur.nama AS reviewed_by_nama
     FROM fuel_shift_sessions s
     JOIN fuel_storage_locations l ON l.id = s.location_id
     LEFT JOIN shifts sh ON sh.id = s.shift_id
     LEFT JOIN users uo ON uo.id = s.opened_by
     LEFT JOIN users uc ON uc.id = s.closed_by
     LEFT JOIN users ur ON ur.id = s.reviewed_by
     WHERE ($1::text IS NULL OR s.status = $1)
     ORDER BY s.opened_at DESC LIMIT $2`, [status || null, Math.min(Number(limit) || 100, 500)]);
  return r.rows;
}

async function reviewShiftSession(id, note, actorId) {
  if (!String(note || '').trim()) throw err('Catatan review wajib diisi.');
  const r = await pool.query(
    `UPDATE fuel_shift_sessions SET status = 'reviewed', review_note = $2, reviewed_by = $3, reviewed_at = now()
     WHERE id = $1 AND status = 'investigation' RETURNING id, status`, [uuid(id, 'Sesi'), String(note).trim(), actorId]);
  if (!r.rows.length) throw err('Sesi tidak ditemukan atau tidak berstatus investigasi.', 404);
  await audit(pool, { entityId: r.rows[0].id, action: 'shift_review', after: { note }, actorId });
  return r.rows[0];
}

/* ---------- ID scan & label ---------- */

/** Cabut ID lama (stiker hilang/dicuri) dan buat ID baru. */
async function regenerateScanId({ target_type, target_id, reason } = {}, actorId) {
  if (!['equipment', 'location'].includes(target_type)) throw err('target_type harus equipment atau location.');
  if (!String(reason || '').trim()) throw err('Alasan pembuatan ulang ID wajib diisi.');
  const tabel = target_type === 'equipment' ? 'equipment' : 'fuel_storage_locations';
  const prefix = target_type === 'equipment' ? 'EQ' : 'LOC';
  const id = uuid(target_id, 'Target');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lama = (await client.query(`SELECT scan_id FROM ${tabel} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!lama) throw err('Data tidak ditemukan.', 404);
    let baru = null;
    for (let i = 0; i < 5 && !baru; i += 1) {
      const calon = (await client.query('SELECT omos_gen_scan_id($1) AS v', [prefix])).rows[0].v;
      const bentrok = await client.query(
        `SELECT 1 FROM ${tabel} WHERE scan_id = $1 UNION SELECT 1 FROM fuel_scan_id_revocations WHERE scan_id = $1`, [calon]);
      if (!bentrok.rows.length) baru = calon;
    }
    if (!baru) throw err('Gagal membuat ID unik, coba lagi.', 503);
    await client.query(`UPDATE ${tabel} SET scan_id = $2 WHERE id = $1`, [id, baru]);
    if (lama.scan_id) {
      await client.query(
        `INSERT INTO fuel_scan_id_revocations (scan_id, target_type, target_id, replaced_by, reason, revoked_by)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (scan_id) DO NOTHING`,
        [lama.scan_id, target_type, id, baru, String(reason).trim(), actorId]);
    }
    await audit(client, { entityId: id, action: 'scan_id_regenerate', before: { scan_id: lama.scan_id }, after: { scan_id: baru }, reason, actorId });
    await client.query('COMMIT');
    return { target_type, target_id: id, old_scan_id: lama.scan_id, scan_id: baru, qr_payload: qrPayload(target_type, baru) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function qrPayload(targetType, scanId) {
  return `OMOS:${targetType === 'equipment' ? 'EQ' : 'LOC'}:${scanId}`;
}

/** QR SVG (ECC level M, quiet zone 1 modul) — dirender server agar cetak label tidak butuh library browser. */
async function qrSvg(payload) {
  return QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

async function withQr(rows) {
  return Promise.all(rows.map(async row => ({ ...row, qr_svg: row.scan_id ? await qrSvg(row.qr_payload) : null })));
}

/** Data label untuk dicetak (QR dirender di dashboard). */
async function labelData({ target_type = 'equipment', ids = [], kelas = null } = {}) {
  const daftar = (Array.isArray(ids) ? ids : String(ids || '').split(',')).map(x => String(x).trim()).filter(x => UUID_RE.test(x));
  if (target_type === 'location') {
    const r = await pool.query(
      `SELECT id, location_code AS kode, location_name AS nama, storage_type AS kelas, scan_id FROM fuel_storage_locations
       WHERE is_active IS NOT FALSE AND (cardinality($1::uuid[]) = 0 OR id = ANY($1::uuid[])) ORDER BY location_code`, [daftar]);
    return withQr(r.rows.map(x => ({ ...x, target_type: 'location', qr_payload: qrPayload('location', x.scan_id) })));
  }
  if (!daftar.length && !kelas) throw err('Pilih unit (ids) atau kelas untuk dicetak.');
  const r = await pool.query(
    `SELECT id, kode_alat AS kode, tipe_alat AS nama, kelas_alat AS kelas, class_unit, scan_id FROM equipment
     WHERE deleted_at IS NULL AND (cardinality($1::uuid[]) = 0 OR id = ANY($1::uuid[]))
       AND ($2::text IS NULL OR kelas_alat = $2 OR class_unit = $2)
     ORDER BY kode_alat LIMIT 1000`, [daftar, kelas || null]);
  return withQr(r.rows.map(x => ({ ...x, target_type: 'equipment', qr_payload: qrPayload('equipment', x.scan_id) })));
}

/* ---------- antrean validasi dari APK ---------- */

/**
 * Transaksi APK yang menunggu tindakan admin:
 *  - receipt draft (mobile_offline) → validasi = posting, tolak = void + alasan;
 *  - transfer draft per grup → validasi/tolak kedua kaki sekaligus;
 *  - issue draft bertanda ledger_stock_short → posting setelah stok tersedia.
 */
async function listPendingValidations() {
  const r = await pool.query(
    `SELECT t.id, t.transaction_number, t.transaction_type, t.operational_date::text AS operational_date, t.transaction_at,
            t.transfer_group_id, t.document_number, t.supplier_reference, t.reason, t.mobile_flags, t.created_at,
            ls.location_code AS source_code, ld.location_code AS destination_code, p.product_code,
            COALESCE(eq.kode_alat, NULL) AS kode_alat, u.nama AS created_by_nama, d.device_code,
            (SELECT SUM(li.quantity_liter) FROM fuel_inventory_lines li WHERE li.transaction_id = t.id)::float AS quantity_liter,
            (SELECT tin.destination_location_id FROM fuel_inventory_transactions tin
              WHERE tin.transfer_group_id = t.transfer_group_id AND tin.transaction_type = 'transfer_in' LIMIT 1) AS transfer_to_id,
            (SELECT l2.location_code FROM fuel_inventory_transactions tin JOIN fuel_storage_locations l2 ON l2.id = tin.destination_location_id
              WHERE tin.transfer_group_id = t.transfer_group_id AND tin.transaction_type = 'transfer_in' LIMIT 1) AS transfer_to_code,
            (SELECT COUNT(*) FROM fuel_attachments a WHERE a.entity_type = 'transaction' AND a.entity_id = t.id AND a.status = 'active')::int AS attachment_count
     FROM fuel_inventory_transactions t
     LEFT JOIN fuel_storage_locations ls ON ls.id = t.source_location_id
     LEFT JOIN fuel_storage_locations ld ON ld.id = t.destination_location_id
     LEFT JOIN fuel_products p ON p.id = t.product_id
     LEFT JOIN equipment eq ON eq.id = t.equipment_id
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN fuel_devices d ON d.id = t.device_id
     WHERE t.status = 'draft' AND (
       (t.source_type = 'mobile_offline' AND t.transaction_type IN ('receipt', 'transfer_out'))
       OR (t.transaction_type = 'issue_equipment' AND t.mobile_flags ? 'ledger_stock_short'))
     ORDER BY t.created_at`);
  return r.rows.map(row => ({
    ...row,
    kind: row.transaction_type === 'transfer_out' ? 'transfer' : row.transaction_type === 'receipt' ? 'receipt' : 'issue_short',
  }));
}

async function setTankCapacity(equipmentId, value, actorId) {
  const id = uuid(equipmentId, 'Unit');
  const cap = value === null || value === '' ? null : Number(value);
  if (cap !== null && !(Number.isFinite(cap) && cap > 0)) throw err('Kapasitas tangki harus > 0 liter atau dikosongkan.');
  const r = await pool.query(`UPDATE equipment SET fuel_tank_capacity_liter = $2 WHERE id = $1 AND deleted_at IS NULL
    RETURNING id, kode_alat, fuel_tank_capacity_liter::float AS fuel_tank_capacity_liter`, [id, cap]);
  if (!r.rows.length) throw err('Unit tidak ditemukan.', 404);
  await audit(pool, { entityId: id, action: 'tank_capacity_update', after: r.rows[0], actorId });
  return r.rows[0];
}

module.exports = {
  listAccounts, listCandidates, createAccount, updateAccount, resetPin,
  listDevices, approveDevice, revokeDevice,
  getSettings, updateSettings,
  listShiftSessions, reviewShiftSession,
  regenerateScanId, labelData, qrPayload, qrSvg, setTankCapacity, normalizeFunctions, listPendingValidations,
};
