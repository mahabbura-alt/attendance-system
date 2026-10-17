'use strict';

/**
 * Bukti foto/dokumen Fuel (APK OMOS Fuel + unggah manual dashboard).
 * - File di storage bucket privat fuel-bukti; metadata di fuel_attachments.
 * - Foto dikompres ulang server bila melebihi batas (Q21 opsi a): hash file
 *   yang diterima dan file yang tersimpan sama-sama dicatat.
 * - Slot wajib berversi (fuel_evidence_slots); transaksi offline divalidasi
 *   dengan versi yang berlaku saat dibuat di HP.
 * - Tidak ada hapus permanen: lampiran diganti (replaced) atau ditandai orphan.
 */
const crypto = require('node:crypto');
const sharp = require('sharp');
const { pool } = require('../config/db');
const storage = require('./storage');
const { hasPermission } = require('./hsePermissions');

const OPERATOR_PERMISSION = 'fuel.operator';
const ENTITY_TYPES = new Set(['fuel_log', 'transaction', 'opname', 'shift_session']);
const KINDS = new Set(['issue_equipment', 'transfer', 'receipt', 'opname', 'shift_open', 'shift_close']);
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const THUMB_DIMENSION = 320;
const CAPTURE_GAP_HOURS = 2;
const ORPHAN_AFTER_DAYS = 30;

const err = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status }, extra);

/* ---------- fungsi murni (diuji via node) ---------- */

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Tipe file dari isi (magic bytes), bukan dari nama/mimetype klien. */
function detectMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** Jenis transaksi ledger/entitas → kelompok slot bukti. */
function kindOf(entityType, transactionType) {
  if (entityType === 'fuel_log') return 'issue_equipment';
  if (entityType === 'opname') return 'opname';
  if (entityType === 'shift_session') {
    return ['shift_open', 'shift_close'].includes(String(transactionType)) ? String(transactionType) : null;
  }
  const type = String(transactionType || '');
  if (type === 'receipt') return 'receipt';
  if (type === 'issue_equipment') return 'issue_equipment';
  if (type === 'transfer_out' || type === 'transfer_in') return 'transfer';
  return null;
}

/** Slot wajib yang belum punya lampiran aktif. */
function missingSlots(slots, attachments) {
  const ada = new Set((attachments || []).filter(a => a.status === 'active').map(a => a.slot_code));
  return (slots || []).filter(s => s.is_required && !ada.has(s.slot_code))
    .map(s => ({ slot_code: s.slot_code, label: s.label }));
}

/** Penanda untuk reviewer. GPS sengaja tidak dinilai (keputusan Q13). */
function evaluateFlags(attachment, entityAt) {
  const flags = [];
  if (attachment?.duplicate_of_id) flags.push({ code: 'duplicate_hash', message: 'Foto identik dengan lampiran lain.' });
  const t1 = Date.parse(attachment?.captured_at || '');
  const t2 = Date.parse(entityAt || '');
  if (Number.isFinite(t1) && Number.isFinite(t2)) {
    const jam = Math.abs(t1 - t2) / 3600000;
    if (jam > CAPTURE_GAP_HOURS) {
      flags.push({ code: 'capture_time_gap', hours: Math.round(jam * 10) / 10,
        message: `Jam foto berselisih ${Math.round(jam * 10) / 10} jam dari waktu transaksi.` });
    }
  }
  return flags;
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function isFuelOperator(user) {
  // Token APK OMOS Fuel: akun Fuel & perangkat sudah diverifikasi requireFuelMobile di route.
  return isAdmin(user) || hasPermission(user, OPERATOR_PERMISSION) || user?.token_scope === 'fuel_mobile';
}

function canRead(user, row) {
  return isAdmin(user) || (row && String(row.uploaded_by || '') === String(user?.id || ''));
}

function parseUuid(value) {
  const s = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null;
}

function parseHash(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  if (!/^[0-9a-f]{64}$/.test(s)) throw err('client_sha256 harus 64 karakter heksadesimal.');
  return s;
}

function parseCoordinate(value, min, max) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1e6) / 1e6 : null;
}

function objectKeys(id, mime, at = new Date()) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime];
  const base = `${storage.EVIDENCE_KEY_PREFIX}${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
  return { file: `${base}.${ext}`, thumb: `${base}-thumb.jpg` };
}

/* ---------- pemrosesan file ---------- */

/**
 * Validasi + kompres. Mengembalikan buffer yang akan disimpan beserta metadata.
 * Foto > 2 MB atau sisi > 1600 px dikompres ulang ke JPEG; selain itu disimpan apa adanya.
 */
async function prepareFile(buffer) {
  const mime = detectMime(buffer);
  if (!mime) throw err('File harus JPEG, PNG, WebP, atau PDF.', 415);
  if (mime === 'application/pdf') {
    if (buffer.length > MAX_PDF_BYTES) throw err('Ukuran PDF maksimal 5 MB.', 413);
    return { stored: buffer, mime, width: null, height: null, recompressed: false, thumb: null };
  }
  let meta;
  try { meta = await sharp(buffer).metadata(); } catch (_) { throw err('Foto rusak atau tidak dapat dibaca.', 422); }
  const terlalu = buffer.length > MAX_PHOTO_BYTES
    || Math.max(Number(meta.width || 0), Number(meta.height || 0)) > MAX_PHOTO_DIMENSION;
  let stored = buffer;
  let storedMime = mime;
  let width = meta.width || null;
  let height = meta.height || null;
  if (terlalu) {
    const out = await sharp(buffer).rotate()
      .resize({ width: MAX_PHOTO_DIMENSION, height: MAX_PHOTO_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    stored = out.data; storedMime = 'image/jpeg'; width = out.info.width; height = out.info.height;
    if (stored.length > MAX_PHOTO_BYTES) throw err('Foto tetap melebihi 2 MB setelah dikompres.', 413);
  }
  const thumb = await sharp(stored).rotate()
    .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 }).toBuffer();
  return { stored, mime: storedMime, width, height, recompressed: terlalu, thumb };
}

/* ---------- konfigurasi slot ---------- */

async function getConfigVersion(db = pool) {
  const r = await db.query('SELECT current_version FROM fuel_evidence_config_state WHERE id = 1');
  return Number(r.rows[0]?.current_version || 1);
}

async function getSlots({ kind = null, version = null } = {}, db = pool) {
  if (kind && !KINDS.has(kind)) throw err('Jenis transaksi bukti tidak valid.');
  const v = version == null ? await getConfigVersion(db) : Number(version);
  if (!Number.isInteger(v) || v < 1) throw err('Versi konfigurasi bukti tidak valid.');
  const r = await db.query(
    `SELECT transaction_kind, slot_code, label, is_required, capture_source, sort_order
     FROM fuel_evidence_slots
     WHERE ($1::text IS NULL OR transaction_kind = $1)
       AND valid_from_version <= $2 AND (valid_to_version IS NULL OR valid_to_version > $2)
     ORDER BY transaction_kind, sort_order, slot_code`,
    [kind, v]);
  return { version: v, slots: r.rows };
}

/** Ganti seluruh slot satu jenis transaksi → versi konfigurasi naik (admin). */
async function saveSlots(kind, slots, actorId) {
  if (!KINDS.has(kind)) throw err('Jenis transaksi bukti tidak valid.');
  const daftar = Array.isArray(slots) ? slots : [];
  const kode = new Set();
  for (const s of daftar) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(String(s.slot_code || ''))) throw err(`Kode slot '${s.slot_code}' tidak valid.`);
    if (kode.has(s.slot_code)) throw err(`Kode slot '${s.slot_code}' ganda.`);
    if (!String(s.label || '').trim()) throw err(`Label slot '${s.slot_code}' wajib diisi.`);
    kode.add(s.slot_code);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const st = await client.query('SELECT current_version FROM fuel_evidence_config_state WHERE id = 1 FOR UPDATE');
    const baru = Number(st.rows[0]?.current_version || 1) + 1;
    await client.query(`UPDATE fuel_evidence_slots SET valid_to_version = $2
      WHERE transaction_kind = $1 AND valid_to_version IS NULL`, [kind, baru]);
    for (const [i, s] of daftar.entries()) {
      await client.query(
        `INSERT INTO fuel_evidence_slots
          (transaction_kind, slot_code, label, is_required, capture_source, sort_order, valid_from_version, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [kind, s.slot_code, String(s.label).trim(), s.is_required !== false,
          s.capture_source === 'camera_or_scan' ? 'camera_or_scan' : 'camera',
          Number.isFinite(Number(s.sort_order)) ? Number(s.sort_order) : (i + 1) * 10, baru, actorId]);
    }
    await client.query('UPDATE fuel_evidence_config_state SET current_version = $1, updated_by = $2, updated_at = now() WHERE id = 1',
      [baru, actorId]);
    await audit(client, { entityType: 'evidence_config', entityId: null, action: 'slot_config_update', after: { kind, version: baru, slots: daftar }, actorId });
    await client.query('COMMIT');
    return getSlots({ kind, version: baru });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* ---------- audit ---------- */

async function audit(db, { entityType = 'attachment', entityId, action, before = null, after = null, reason = null, actorId = null, deviceId = null }) {
  await db.query(
    `INSERT INTO fuel_inventory_audit (entity_type, entity_id, action, before_data, after_data, reason, actor_id, origin_device_id)
     VALUES ($8, $1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
    [entityId || '00000000-0000-0000-0000-000000000000', action,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason, actorId, deviceId, entityType]);
}

/* ---------- unggah ---------- */

const KOLOM = `id, client_uuid, entity_type, entity_id, slot_code, mime_type, byte_size, width, height,
  original_byte_size, client_sha256, received_sha256, stored_sha256, server_recompressed, duplicate_of_id,
  captured_at, gps_lat, gps_lng, device_id, app_version, upload_source, status, replaced_by_id,
  status_reason, uploaded_by, uploaded_at, linked_at, (thumbnail_key IS NOT NULL) AS has_thumbnail`;

/**
 * Simpan satu lampiran (belum tertaut). Idempoten per client_uuid.
 * meta: { client_uuid, slot_code, client_sha256, captured_at, gps_lat, gps_lng, device_id, app_version, upload_source }
 */
async function uploadAttachment(buffer, meta = {}, user = {}) {
  if (!isFuelOperator(user)) throw err('Tidak memiliki izin mengunggah bukti Fuel.', 403);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw err('File wajib diunggah.');
  const slot = String(meta.slot_code || '').trim();
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(slot)) throw err('Kode slot bukti wajib diisi.');
  const clientUuid = meta.client_uuid ? parseUuid(meta.client_uuid) : null;
  if (meta.client_uuid && !clientUuid) throw err('client_uuid tidak valid.');
  const clientHash = parseHash(meta.client_sha256);
  const receivedHash = sha256(buffer);

  if (clientUuid) {
    const ada = await pool.query(`SELECT ${KOLOM} FROM fuel_attachments WHERE client_uuid = $1`, [clientUuid]);
    if (ada.rows.length) {
      if (String(ada.rows[0].uploaded_by || '') !== String(user.id || '')) throw err('client_uuid sudah dipakai pengguna lain.', 409);
      return { ...ada.rows[0], idempotent_replay: true };
    }
  }
  if (clientHash && clientHash !== receivedHash) {
    throw err('File berubah/rusak saat dikirim (hash tidak cocok). Unggah ulang.', 422, { code: 'FILE_HASH_MISMATCH' });
  }

  const file = await prepareFile(buffer);
  const storedHash = file.recompressed ? sha256(file.stored) : receivedHash;
  const id = crypto.randomUUID();
  const keys = objectKeys(id, file.mime);
  await storage.putEvidenceObject(keys.file, file.stored, file.mime);
  if (file.thumb) await storage.putEvidenceObject(keys.thumb, file.thumb, 'image/jpeg');

  const dup = await pool.query(
    `SELECT id FROM fuel_attachments
     WHERE (stored_sha256 = $1 OR received_sha256 = $2 OR client_sha256 = $2) AND status IN ('active', 'replaced')
     ORDER BY uploaded_at LIMIT 1`, [storedHash, receivedHash]);
  const capturedAt = Number.isFinite(Date.parse(meta.captured_at || '')) ? new Date(meta.captured_at).toISOString() : null;
  try {
    const r = await pool.query(
      `INSERT INTO fuel_attachments
        (id, client_uuid, slot_code, storage_key, thumbnail_key, mime_type, byte_size, width, height,
         original_byte_size, client_sha256, received_sha256, stored_sha256, server_recompressed, duplicate_of_id,
         captured_at, gps_lat, gps_lng, device_id, app_version, upload_source, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING ${KOLOM}`,
      [id, clientUuid, slot, keys.file, file.thumb ? keys.thumb : null, file.mime, file.stored.length,
        file.width, file.height, buffer.length, clientHash, receivedHash, storedHash, file.recompressed,
        dup.rows[0]?.id || null, capturedAt,
        parseCoordinate(meta.gps_lat, -90, 90), parseCoordinate(meta.gps_lng, -180, 180),
        meta.device_id ? String(meta.device_id).slice(0, 100) : null,
        meta.app_version ? String(meta.app_version).slice(0, 40) : null,
        meta.upload_source === 'mobile' ? 'mobile' : 'dashboard', user.id || null]);
    await audit(pool, { entityId: id, action: 'upload', after: r.rows[0], actorId: user.id, deviceId: meta.device_id || null });
    return r.rows[0];
  } catch (error) {
    // Balapan client_uuid yang sama: kembalikan baris pemenang. File kita jadi
    // tanpa baris dan akan terlapor oleh skrip rekonsiliasi.
    if (error.code === '23505' && clientUuid) {
      const ada = await pool.query(`SELECT ${KOLOM} FROM fuel_attachments WHERE client_uuid = $1`, [clientUuid]);
      if (ada.rows.length) return { ...ada.rows[0], idempotent_replay: true };
    }
    throw error;
  }
}

/* ---------- tautan ke entitas + validasi slot wajib ---------- */

/**
 * Tautkan lampiran ke entitas dalam transaksi DB pemanggil (db = client BEGIN).
 * requireComplete → tolak bila slot wajib (versi configVersion) belum lengkap.
 */
async function linkAttachments(db, {
  entityType, entityId, transactionType = null, attachmentIds = [], configVersion = null,
  requireComplete = false, user = {},
} = {}) {
  if (!ENTITY_TYPES.has(entityType) || !entityId) throw err('Entitas lampiran tidak valid.');
  const kind = kindOf(entityType, transactionType);
  if (!kind) throw err('Jenis transaksi ini tidak mendukung bukti.');
  const ids = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : []).map(parseUuid))];
  if (ids.includes(null)) throw err('attachment_ids berisi ID tidak valid.');
  const { version, slots } = await getSlots({ kind, version: configVersion }, db);
  const slotCodes = new Set(slots.map(s => s.slot_code));

  if (ids.length) {
    const r = await db.query(`SELECT id, slot_code, status, entity_type, entity_id, uploaded_by
      FROM fuel_attachments WHERE id = ANY($1::uuid[]) FOR UPDATE`, [ids]);
    if (r.rows.length !== ids.length) throw err('Sebagian lampiran tidak ditemukan.', 404);
    for (const a of r.rows) {
      if (a.status !== 'active') throw err(`Lampiran ${a.id} tidak aktif (${a.status}).`, 422);
      if (a.entity_id && !(a.entity_type === entityType && String(a.entity_id) === String(entityId))) {
        throw err(`Lampiran ${a.id} sudah tertaut ke entitas lain.`, 409);
      }
      if (!isAdmin(user) && String(a.uploaded_by || '') !== String(user.id || '')) {
        throw err('Hanya lampiran milik sendiri yang dapat ditautkan.', 403);
      }
      if (!slotCodes.has(a.slot_code)) throw err(`Slot '${a.slot_code}' tidak berlaku untuk ${kind} (versi ${version}).`, 422);
    }
    await db.query(`UPDATE fuel_attachments SET entity_type = $1, entity_id = $2, linked_at = COALESCE(linked_at, now())
      WHERE id = ANY($3::uuid[])`, [entityType, entityId, ids]);
    for (const id of ids) await audit(db, { entityId: id, action: 'link', after: { entityType, entityId, version }, actorId: user.id });
  }

  if (requireComplete) {
    const semua = await db.query(`SELECT slot_code, status FROM fuel_attachments
      WHERE entity_type = $1 AND entity_id = $2`, [entityType, entityId]);
    const kurang = missingSlots(slots, semua.rows);
    if (kurang.length) {
      throw err(`Bukti wajib belum lengkap: ${kurang.map(k => k.label).join(', ')}.`, 422,
        { code: 'EVIDENCE_INCOMPLETE', details: { code: 'EVIDENCE_INCOMPLETE', missing: kurang, config_version: version } });
    }
  }
  return { config_version: version, linked: ids.length };
}

/** Tautkan unggahan dashboard ke entitas yang sudah ada (admin; tanpa syarat kelengkapan). */
async function linkToExisting({ entityType, entityId, attachmentIds } = {}, user = {}) {
  if (!isAdmin(user)) throw err('Hanya admin yang dapat menautkan lampiran ke transaksi yang sudah ada.', 403);
  const id = parseUuid(entityId);
  if (!ENTITY_TYPES.has(entityType) || !id) throw err('entity_type dan entity_id wajib valid.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let transactionType = null;
    if (entityType === 'transaction') {
      const r = await client.query('SELECT transaction_type FROM fuel_inventory_transactions WHERE id = $1', [id]);
      if (!r.rows.length) throw err('Transaksi tidak ditemukan.', 404);
      transactionType = r.rows[0].transaction_type;
    } else {
      const tabel = { opname: 'fuel_stock_opnames', fuel_log: 'fuel_logs', shift_session: 'fuel_shift_sessions' }[entityType];
      const r = await client.query(`SELECT id FROM ${tabel} WHERE id = $1`, [id]);
      if (!r.rows.length) throw err('Entitas tidak ditemukan.', 404);
    }
    const hasil = await linkAttachments(client, { entityType, entityId: id, transactionType, attachmentIds, user });
    await client.query('COMMIT');
    return hasil;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* ---------- baca ---------- */

async function entityTimestamp(entityType, entityId) {
  const sql = {
    transaction: 'SELECT transaction_at AS at FROM fuel_inventory_transactions WHERE id = $1',
    opname: 'SELECT counted_at AS at FROM fuel_stock_opnames WHERE id = $1',
    fuel_log: 'SELECT COALESCE(filled_at, created_at) AS at FROM fuel_logs WHERE id = $1',
    shift_session: 'SELECT opened_at AS at FROM fuel_shift_sessions WHERE id = $1',
  }[entityType];
  if (!sql) return null;
  const r = await pool.query(sql, [entityId]);
  return r.rows[0]?.at || null;
}

function withLinks(row, entityAt) {
  return {
    ...row,
    file_url: `/api/fuel-evidence/attachments/${row.id}/file`,
    thumbnail_url: row.has_thumbnail ? `/api/fuel-evidence/attachments/${row.id}/file?variant=thumb` : null,
    flags: evaluateFlags(row, entityAt),
  };
}

async function listAttachments({ entityType, entityId, includeInactive = false } = {}, user = {}) {
  if (!ENTITY_TYPES.has(entityType) || !parseUuid(entityId)) throw err('entity_type dan entity_id wajib valid.');
  const r = await pool.query(
    `SELECT ${KOLOM} FROM fuel_attachments WHERE entity_type = $1 AND entity_id = $2
       AND ($3::boolean OR status = 'active')
       AND ($4::boolean OR uploaded_by = $5)
     ORDER BY slot_code, uploaded_at`,
    [entityType, entityId, Boolean(includeInactive), isAdmin(user), user.id || null]);
  const at = await entityTimestamp(entityType, entityId);
  return r.rows.map(row => withLinks(row, at));
}

/** Ringkasan jumlah lampiran aktif per entitas (untuk ikon di tabel/kartu). */
async function summarize({ entityType, ids = [] } = {}, user = {}) {
  if (!ENTITY_TYPES.has(entityType)) throw err('entity_type tidak valid.');
  const daftar = [...new Set((Array.isArray(ids) ? ids : String(ids || '').split(',')).map(parseUuid).filter(Boolean))];
  if (!daftar.length) return [];
  if (daftar.length > 500) throw err('Maksimal 500 entitas per permintaan.');
  const r = await pool.query(
    `SELECT entity_id, COUNT(*)::int AS active_count,
            COUNT(*) FILTER (WHERE duplicate_of_id IS NOT NULL)::int AS duplicate_count,
            array_agg(slot_code ORDER BY slot_code) AS slot_codes
     FROM fuel_attachments
     WHERE entity_type = $1 AND entity_id = ANY($2::uuid[]) AND status = 'active'
       AND ($3::boolean OR uploaded_by = $4)
     GROUP BY entity_id`,
    [entityType, daftar, isAdmin(user), user.id || null]);
  return r.rows;
}

async function getAttachment(id, user = {}) {
  const uid = parseUuid(id);
  if (!uid) throw err('ID lampiran tidak valid.');
  const r = await pool.query(`SELECT ${KOLOM}, storage_key, thumbnail_key FROM fuel_attachments WHERE id = $1`, [uid]);
  const row = r.rows[0];
  if (!row || !canRead(user, row)) throw err('Lampiran tidak ditemukan.', 404);
  return row;
}

async function readAttachmentFile(id, variant, user = {}) {
  const row = await getAttachment(id, user);
  const thumb = variant === 'thumb' && row.thumbnail_key;
  const buffer = await storage.readEvidenceObject(thumb ? row.thumbnail_key : row.storage_key);
  if (!buffer) throw err('File lampiran tidak ditemukan di storage.', 404);
  return { buffer, mime: thumb ? 'image/jpeg' : row.mime_type, row };
}

/* ---------- ganti lampiran ---------- */

async function entityPending(db, entityType, entityId) {
  if (entityType === 'transaction') {
    const r = await db.query('SELECT status FROM fuel_inventory_transactions WHERE id = $1', [entityId]);
    return r.rows[0]?.status === 'draft';
  }
  if (entityType === 'opname') {
    const r = await db.query('SELECT status FROM fuel_stock_opnames WHERE id = $1', [entityId]);
    return ['draft', 'submitted'].includes(r.rows[0]?.status);
  }
  if (entityType === 'shift_session') {
    const r = await db.query('SELECT status FROM fuel_shift_sessions WHERE id = $1', [entityId]);
    return r.rows[0]?.status === 'open';
  }
  return false;
}

/** Ganti lampiran tertaut: versi lama → replaced (tetap tersimpan). */
async function replaceAttachment(id, buffer, meta = {}, user = {}) {
  const lama = await getAttachment(id, user);
  if (lama.status !== 'active') throw err('Hanya lampiran aktif yang dapat diganti.', 422);
  const reason = String(meta.reason || '').trim();
  if (isAdmin(user)) {
    if (!reason) throw err('Alasan penggantian wajib diisi.');
  } else if (!lama.entity_id || !(await entityPending(pool, lama.entity_type, lama.entity_id))) {
    throw err('Lampiran hanya dapat diganti pengunggah selama transaksi menunggu validasi.', 403);
  }
  const baru = await uploadAttachment(buffer, { ...meta, client_uuid: meta.client_uuid, slot_code: lama.slot_code }, user);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cek = await client.query('SELECT status FROM fuel_attachments WHERE id = $1 FOR UPDATE', [lama.id]);
    if (cek.rows[0]?.status !== 'active') throw err('Lampiran sudah diganti oleh proses lain.', 409);
    await client.query(`UPDATE fuel_attachments SET status = 'replaced', replaced_by_id = $2, status_reason = $3,
      status_changed_by = $4, status_changed_at = now() WHERE id = $1`, [lama.id, baru.id, reason || null, user.id || null]);
    if (lama.entity_id) {
      await client.query(`UPDATE fuel_attachments SET entity_type = $2, entity_id = $3, linked_at = now() WHERE id = $1`,
        [baru.id, lama.entity_type, lama.entity_id]);
    }
    await audit(client, { entityId: lama.id, action: 'replace', before: { id: lama.id, stored_sha256: lama.stored_sha256 },
      after: { id: baru.id, stored_sha256: baru.stored_sha256 }, reason: reason || null, actorId: user.id });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getAttachment(baru.id, user);
}

module.exports = {
  OPERATOR_PERMISSION, MAX_PHOTO_BYTES, MAX_PHOTO_DIMENSION, MAX_PDF_BYTES, ORPHAN_AFTER_DAYS, CAPTURE_GAP_HOURS,
  sha256, detectMime, kindOf, missingSlots, evaluateFlags, isFuelOperator, canRead, prepareFile,
  getConfigVersion, getSlots, saveSlots,
  uploadAttachment, linkAttachments, linkToExisting, listAttachments, summarize, getAttachment, readAttachmentFile, replaceAttachment,
};
