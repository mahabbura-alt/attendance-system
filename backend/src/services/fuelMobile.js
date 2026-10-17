'use strict';

/**
 * Backend APK OMOS Fuel v1 — bootstrap, sinkronisasi antrean offline, status.
 * Keputusan owner & validasi formula (2026-10-17):
 *  V1 HM tidak berurutan → log tetap tersimpan, HM ditahan sampai Event HM (createFuelLogRecord allowHeldHm).
 *  V2 satu pengisian per unit per shift tetap diblokir (aturan server eksisting).
 *  V3 selisih HM > jam berlalu + toleransi → peringatan; dasar waktu = filled_at, atau awal shift
 *     sebelumnya bila data lama tanpa filled_at (paling longgar). Hanya HM, bukan KM.
 *  V4 totalizer: selisih = (akhir − awal) − (pengisian + transfer keluar lokasi selama sesi);
 *     investigasi bila |selisih| > maks(pct × (akhir − awal), liter). Akhir < awal = rollover.
 *  V5 pengisian APK memotong stok lokasi yang dipindai (issue diposting); bila FIFO kurang,
 *     issue tetap draft + tanda ledger_stock_short (FIFO tidak boleh negatif).
 *  V6 estimasi stok = posted + pending masuk − pending keluar (APK mengurangi antrean lokalnya).
 * Satuan Liter observed; presisi penuh, pembulatan hanya di tampilan.
 */
const { pool } = require('../config/db');
const ProductionController = require('../controllers/production.controller');
const fuelInventory = require('./fuelInventory');
const fuelEvidence = require('./fuelEvidence');
const { getSettings } = require('./fuelMobileAuth');

const FORMULA_TOTALIZER = 'fuel-totalizer v1';
const MANUAL_REASONS = new Set(['stiker_rusak', 'tidak_ada', 'kamera']);
const ITEM_TYPES = new Set(['fill', 'transfer', 'receipt', 'opname', 'shift_open', 'shift_close']);
const FUNCTION_OF = { fill: 'fill', transfer: 'transfer', receipt: 'receipt', opname: 'opname', shift_open: 'shift', shift_close: 'shift' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const err = (message, status = 422, code = 'VALIDATION', extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

/* ---------- fungsi murni (diuji via node) ---------- */

/** Tanggal operasional & jenis shift dari waktu kejadian (hari mulai 06:00 WIB). */
function operationalSlot(instant) {
  return {
    operational_date: ProductionController.operationalDateForInstant(instant),
    shift_kind: ProductionController.operationalShiftKindForInstant(instant),
  };
}

/** Awal shift dalam ISO (WIB) — dipakai sebagai dasar waktu paling longgar untuk data lama. */
function shiftStartIso(operationalDate, shiftKind) {
  const date = String(operationalDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return new Date(`${date}T${shiftKind === 'malam' ? '18' : '06'}:00:00+07:00`).toISOString();
}

/**
 * V3: HM tidak boleh bertambah melebihi jam yang berlalu + toleransi.
 * previousAt = filled_at pengisian sebelumnya; bila kosong, previousShiftStartAt (lebih longgar).
 */
function hmGapCheck({ previousHm, previousAt, previousShiftStartAt, currentHm, currentAt, toleranceHours = 1 }) {
  const prev = Number(previousHm);
  const cur = Number(currentHm);
  const dasar = previousAt || previousShiftStartAt;
  const t0 = Date.parse(dasar || '');
  const t1 = Date.parse(currentAt || '');
  if (!Number.isFinite(prev) || !Number.isFinite(cur) || !Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
    return { checked: false };
  }
  const deltaHm = cur - prev;
  const elapsedHours = (t1 - t0) / 3600000;
  const limitHours = elapsedHours + Number(toleranceHours || 0);
  return {
    checked: true, deltaHm, elapsedHours, limitHours,
    basis: previousAt ? 'filled_at' : 'shift_start',
    exceeded: deltaHm > limitHours,
  };
}

/** V4: selisih totalizer. */
function totalizerVariance({ open, close, recordedOut, tolerancePct = 0.5, toleranceLiter = 20 }) {
  const a = Number(open);
  const b = Number(close);
  const out = Number(recordedOut || 0);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw err('Totalizer awal/akhir wajib angka.');
  if (b < a) {
    return { rollover: true, meterDelta: b - a, variance: null, variancePct: null, threshold: null, investigate: true };
  }
  const meterDelta = b - a;
  const variance = meterDelta - out;
  const threshold = Math.max(meterDelta * Number(tolerancePct) / 100, Number(toleranceLiter));
  return {
    rollover: false, meterDelta, variance,
    variancePct: meterDelta > 0 ? (variance / meterDelta) * 100 : null,
    threshold, investigate: Math.abs(variance) > threshold,
  };
}

/** Entri terlambat: kejadian dicatat > grace jam setelah terjadi (backdate) → alasan wajib. */
function isLateEntry(occurredAt, recordedAt, graceHours = 2) {
  const t0 = Date.parse(occurredAt || '');
  const t1 = Date.parse(recordedAt || '');
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
  return (t1 - t0) / 3600000 > Number(graceHours);
}

/** Kode QR → ID scan. Menerima "OMOS:EQ:EQ-7K3M9Q", "OMOS:LOC:LOC-...", atau ID polos. */
function parseScanPayload(value) {
  const s = String(value || '').trim().toUpperCase();
  const m = s.match(/^(?:OMOS:(?:EQ|LOC):)?((?:EQ|LOC)-[2-9A-HJKMNP-TV-Z]{6})$/);
  return m ? m[1] : null;
}

function canUseLocation(fuel, locationId) {
  return Boolean(locationId) && (fuel?.locationIds || []).includes(String(locationId));
}

/* ---------- konteks bersama ---------- */

async function shiftForInstant(db, instant) {
  const slot = operationalSlot(instant);
  const r = await db.query(
    `SELECT id, nama_shift FROM shifts WHERE LOWER(nama_shift) LIKE $1 ORDER BY created_at LIMIT 1`, [`%${slot.shift_kind}%`]);
  if (!r.rows.length) throw err(`Master Shift ${slot.shift_kind === 'siang' ? 'Siang' : 'Malam'} tidak ditemukan.`, 503, 'SHIFT_MASTER_MISSING');
  return { ...slot, shift_id: r.rows[0].id, shift_name: r.rows[0].nama_shift };
}

async function pendingByLocation(db) {
  const r = await db.query(
    `SELECT CASE WHEN t.transaction_type = 'transfer_out' THEN t.source_location_id ELSE t.destination_location_id END AS location_id,
            t.product_id,
            COALESCE(SUM(li.quantity_liter) FILTER (WHERE t.transaction_type IN ('receipt', 'transfer_in')), 0) AS pending_in,
            COALESCE(SUM(li.quantity_liter) FILTER (WHERE t.transaction_type = 'transfer_out'), 0) AS pending_out
     FROM fuel_inventory_transactions t JOIN fuel_inventory_lines li ON li.transaction_id = t.id
     WHERE t.status = 'draft' AND t.transaction_type IN ('receipt', 'transfer_in', 'transfer_out')
     GROUP BY 1, 2`);
  return r.rows;
}

/* ---------- bootstrap ---------- */

async function getBootstrap(user, fuel) {
  const now = new Date();
  const [settings, me, shifts, products, locations, summary, pending, equipment, slots, revoked, sessions, current] = await Promise.all([
    getSettings(),
    pool.query('SELECT id, nama, employee_id, jabatan, departemen FROM users WHERE id = $1', [user.id]),
    pool.query('SELECT id, nama_shift, operational_start, operational_end, lintas_hari FROM shifts ORDER BY operational_start'),
    pool.query('SELECT id, product_code, product_name FROM fuel_products WHERE is_active IS NOT FALSE ORDER BY product_code'),
    pool.query(`SELECT l.id, l.location_code, l.location_name, l.storage_type, l.scan_id, l.equipment_id,
                       e.scan_id AS equipment_scan_id, l.capacity_liter, l.minimum_stock_liter
                FROM fuel_storage_locations l LEFT JOIN equipment e ON e.id = l.equipment_id
                WHERE l.is_active IS NOT FALSE ORDER BY l.location_code`),
    fuelInventory.getStockSummary(),
    pendingByLocation(pool),
    pool.query(`SELECT e.id, e.kode_alat, e.kelas_alat, e.class_unit, e.tipe_alat, e.scan_id,
                       COALESCE(e.km_only, FALSE) AS km_only, e.fuel_tank_capacity_liter::float AS fuel_tank_capacity_liter,
                       last.tanggal::text AS last_tanggal, last.shift_id AS last_shift_id, last.filled_at AS last_filled_at,
                       last.hm::float AS last_hm, last.km::float AS last_km
                FROM equipment e
                LEFT JOIN LATERAL (
                  SELECT fl.tanggal, fl.shift_id, fl.filled_at, COALESCE(fl.hm_reading, fl.hm_finish) AS hm, fl.odometer_reading AS km
                  FROM fuel_logs fl WHERE fl.equipment_id = e.id AND fl.deleted_at IS NULL
                  ORDER BY fl.tanggal DESC, COALESCE(fl.filled_at, fl.created_at) DESC LIMIT 1
                ) last ON TRUE
                WHERE e.deleted_at IS NULL AND e.is_active IS NOT FALSE
                ORDER BY e.kode_alat`),
    fuelEvidence.getSlots({}),
    pool.query('SELECT scan_id FROM fuel_scan_id_revocations'),
    pool.query(`SELECT id, client_uuid, location_id, shift_id, operational_date::text AS operational_date, opened_at,
                       totalizer_open::float AS totalizer_open, opened_by
                FROM fuel_shift_sessions WHERE status = 'open' AND location_id = ANY($1::uuid[])`, [fuel.locationIds]),
    shiftForInstant(pool, now).catch(() => null),
  ]);
  const saldo = new Map(summary.map(r => [`${r.location_id}|${r.product_id}`, Number(r.balance_liter || 0)]));
  const tunda = new Map(pending.map(r => [`${r.location_id}|${r.product_id}`, r]));
  const stok = [];
  for (const loc of locations.rows) {
    for (const p of products.rows) {
      const key = `${loc.id}|${p.id}`;
      const posted = saldo.get(key) || 0;
      const t = tunda.get(key);
      const pendingIn = Number(t?.pending_in || 0);
      const pendingOut = Number(t?.pending_out || 0);
      if (!posted && !pendingIn && !pendingOut) continue;
      stok.push({ location_id: loc.id, product_id: p.id, posted_liter: posted, pending_in_liter: pendingIn,
        pending_out_liter: pendingOut, estimate_liter: posted + pendingIn - pendingOut });
    }
  }
  return {
    server_time: now.toISOString(),
    me: me.rows[0] || null,
    access: { functions: fuel.functions, location_ids: fuel.locationIds, must_change_pin: fuel.mustChangePin },
    device: { id: fuel.device.id, device_code: fuel.device.device_code, status: fuel.device.status },
    settings,
    current_shift: current,
    shifts: shifts.rows,
    products: products.rows,
    locations: locations.rows,
    stock: stok,
    equipment: equipment.rows,
    evidence: slots,
    revoked_scan_ids: revoked.rows.map(r => r.scan_id),
    open_sessions: sessions.rows,
    formula: { totalizer: FORMULA_TOTALIZER, fuel_ledger: fuelInventory.FUEL_FORMULA_VERSION },
  };
}

/* ---------- sinkronisasi ---------- */

function reqUuid(value, label) {
  const s = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(s)) throw err(`${label} tidak valid.`, 400, 'BAD_REQUEST');
  return s;
}

function reqLiter(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw err(`${label} harus lebih dari 0 liter.`);
  return n;
}

function assertDevice(fuel, recordedAt) {
  if (fuel.device.status !== 'revoked') return [];
  const dicabut = Date.parse(fuel.device.revoked_at || '');
  const dicatat = Date.parse(recordedAt || '');
  if (!Number.isFinite(dicatat) || !Number.isFinite(dicabut) || dicatat > dicabut) {
    throw err('Perangkat dicabut; transaksi setelah pencabutan ditolak.', 403, 'DEVICE_REVOKED');
  }
  return ['device_revoked'];
}

async function productFor(payload) {
  if (payload.product_id) return reqUuid(payload.product_id, 'Produk');
  const r = await pool.query('SELECT id FROM fuel_products WHERE is_active IS NOT FALSE LIMIT 2');
  if (r.rows.length !== 1) throw err('Produk fuel wajib dipilih.');
  return r.rows[0].id;
}

async function prosesFill(item, user, fuel, settings) {
  const p = item.payload || {};
  const filledAt = p.filled_at;
  if (!Number.isFinite(Date.parse(filledAt || ''))) throw err('Waktu pengisian (filled_at) wajib.');
  const flags = assertDevice(fuel, p.recorded_at || filledAt);
  const sourceLocationId = reqUuid(p.source_location_id, 'Lokasi sumber');
  if (!canUseLocation(fuel, sourceLocationId)) throw err('Lokasi sumber tidak ditugaskan ke akun Anda.', 403, 'LOCATION_FORBIDDEN');
  const equipmentId = reqUuid(p.equipment_id, 'Unit');
  const liter = reqLiter(p.fuel_filled, 'Fuel diisi');
  const productId = await productFor(p);
  const slot = await shiftForInstant(pool, filledAt);
  const warnings = [];
  const butuhAlasan = [];

  if (p.unit_input === 'manual') {
    if (!MANUAL_REASONS.has(String(p.unit_input_reason || ''))) throw err('Alasan input unit manual wajib dipilih.');
    flags.push('manual_unit');
  }
  if (isLateEntry(filledAt, p.recorded_at, settings.late_entry_grace_hours)) {
    flags.push('late_entry');
    butuhAlasan.push('pengisian dicatat terlambat');
  }
  const unit = (await pool.query(`SELECT fuel_tank_capacity_liter::float AS cap FROM equipment WHERE id = $1`, [equipmentId])).rows[0];
  if (unit?.cap && liter > unit.cap) {
    flags.push('over_tank_capacity');
    butuhAlasan.push('liter melebihi kapasitas tangki');
    warnings.push({ code: 'OVER_TANK_CAPACITY', message: `Fuel ${liter} L melebihi kapasitas tangki ${unit.cap} L.` });
  }
  if (p.hm_reading != null && p.hm_reading !== '') {
    const prev = (await pool.query(
      `SELECT COALESCE(fl.hm_reading, fl.hm_finish)::float AS hm, fl.filled_at, fl.tanggal::text AS tanggal, LOWER(s.nama_shift) AS shift
       FROM fuel_logs fl JOIN shifts s ON s.id = fl.shift_id
       WHERE fl.equipment_id = $1 AND fl.deleted_at IS NULL AND COALESCE(fl.hm_reading, fl.hm_finish) IS NOT NULL
         AND COALESCE(fl.filled_at, fl.created_at) < $2::timestamptz
       ORDER BY fl.tanggal DESC, COALESCE(fl.filled_at, fl.created_at) DESC LIMIT 1`, [equipmentId, filledAt])).rows[0];
    if (prev) {
      const cek = hmGapCheck({
        previousHm: prev.hm, previousAt: prev.filled_at,
        previousShiftStartAt: shiftStartIso(prev.tanggal, prev.shift.includes('malam') ? 'malam' : 'siang'),
        currentHm: p.hm_reading, currentAt: filledAt, toleranceHours: settings.hm_gap_tolerance_hours,
      });
      if (cek.exceeded) {
        flags.push('hm_gap_exceeded');
        butuhAlasan.push('selisih HM melebihi waktu berlalu');
        warnings.push({ code: 'HM_GAP_EXCEEDS_ELAPSED',
          message: `Selisih HM ${cek.deltaHm.toFixed(2)} j > waktu berlalu ${cek.elapsedHours.toFixed(2)} j + toleransi ${settings.hm_gap_tolerance_hours} j.` });
      }
    }
  }
  if (butuhAlasan.length && !String(p.mobile_reason || '').trim()) {
    throw err(`Alasan wajib diisi: ${butuhAlasan.join(', ')}.`, 422, 'REASON_REQUIRED', { details: { code: 'REASON_REQUIRED', reasons: butuhAlasan } });
  }
  const session = (await pool.query(`SELECT id FROM fuel_shift_sessions WHERE location_id = $1 AND status = 'open'`, [sourceLocationId])).rows[0];

  const client = await pool.connect();
  let hasil;
  try {
    hasil = await ProductionController.createFuelLogRecord(client, {
      tanggal: slot.operational_date, shift_id: slot.shift_id, equipment_id: equipmentId,
      operator_id: p.operator_id || null, hm_reading: p.hm_reading, odometer_reading: p.odometer_reading,
      fuel_filled: liter, remark: p.remark || '', source_type: 'mobile_offline', client_uuid: item.client_uuid,
      attachment_ids: p.attachment_ids || [], evidence_config_version: p.evidence_config_version,
    }, user, { mobile: { allowHeldHm: true, extraWarnings: warnings, columns: {
      filled_at: new Date(filledAt).toISOString(), source_location_id: sourceLocationId,
      unit_input: p.unit_input === 'manual' ? 'manual' : 'scan', unit_input_reason: p.unit_input === 'manual' ? p.unit_input_reason : null,
      device_id: fuel.device.id, shift_session_id: session?.id || null, mobile_flags: flags,
      mobile_reason: String(p.mobile_reason || '').trim() || null,
    } } });
  } finally {
    client.release();
  }
  if (hasil.status >= 400) throw err(hasil.body.error, hasil.status, hasil.body.code || 'VALIDATION', { details: hasil.body.validation || null });
  const log = hasil.log;
  if (hasil.created) await postIssue(log, { productId, sourceLocationId, liter, slot, actorId: hasil.actorId, deviceId: fuel.device.id });
  const segar = (await pool.query('SELECT mobile_flags FROM fuel_logs WHERE id = $1', [log.id])).rows[0];
  return { server_id: log.id, replay: Boolean(hasil.replay), held_hm: Boolean(hasil.heldHm), flags: segar?.mobile_flags || [] };
}

/** V5: issue dari lokasi yang dipindai langsung diposting; FIFO kurang → tetap draft + tanda. */
async function postIssue(log, { productId, sourceLocationId, liter, slot, actorId, deviceId }) {
  const draft = await fuelInventory.createDraft({
    transaction_type: 'issue_equipment', operational_date: slot.operational_date, shift_id: slot.shift_id,
    transaction_at: log.filled_at || undefined, product_id: productId, source_location_id: sourceLocationId,
    equipment_id: log.equipment_id, operator_id: log.operator_id, fuel_log_id: log.id,
    source_type: 'input_fuel', reason: 'APK OMOS Fuel', idempotency_key: `fuel-log:${log.id}`,
    lines: [{ direction: 'out', quantity_liter: liter }],
  }, actorId);
  await pool.query('UPDATE fuel_inventory_transactions SET device_id = $2 WHERE id = $1', [draft.id, deviceId]);
  if (draft.status !== 'draft') return draft;
  try {
    return await fuelInventory.postTransaction(draft.id, actorId);
  } catch (error) {
    if (error.status !== 422) throw error;
    await pool.query(`UPDATE fuel_logs SET mobile_flags = mobile_flags || '["ledger_stock_short"]'::jsonb WHERE id = $1`, [log.id]);
    await pool.query(`UPDATE fuel_inventory_transactions SET mobile_flags = mobile_flags || '["ledger_stock_short"]'::jsonb WHERE id = $1`, [draft.id]);
    return draft;
  }
}

async function prosesTransfer(item, user, fuel) {
  const p = item.payload || {};
  const flags = assertDevice(fuel, p.recorded_at);
  const dari = reqUuid(p.from_location_id, 'Lokasi asal');
  const ke = reqUuid(p.to_location_id, 'Lokasi tujuan');
  if (!canUseLocation(fuel, dari)) throw err('Lokasi asal tidak ditugaskan ke akun Anda.', 403, 'LOCATION_FORBIDDEN');
  const slot = await shiftForInstant(pool, p.transferred_at || p.recorded_at || new Date());
  const hasil = await fuelInventory.transferStock({
    from_location_id: dari, to_location_id: ke, product_id: await productFor(p),
    quantity_liter: reqLiter(p.quantity_liter, 'Jumlah transfer'), operational_date: slot.operational_date,
    reason: [p.document_number, p.note].filter(Boolean).join(' · ') || null, source_type: 'mobile_offline',
    idempotency_key: `m:${item.client_uuid}`, attachment_ids: p.attachment_ids || [], evidence_config_version: p.evidence_config_version,
  }, user.id, user, { asDraft: true, deviceId: fuel.device.id, flags });
  return { server_id: hasil.transfer_group_id || hasil.transactions?.[0]?.transfer_group_id || null, replay: Boolean(hasil.duplicate), status: 'pending_validation' };
}

async function prosesReceipt(item, user, fuel) {
  const p = item.payload || {};
  const flags = assertDevice(fuel, p.recorded_at);
  const tujuan = reqUuid(p.destination_location_id, 'Lokasi tujuan');
  if (!canUseLocation(fuel, tujuan)) throw err('Lokasi tujuan tidak ditugaskan ke akun Anda.', 403, 'LOCATION_FORBIDDEN');
  const slot = await shiftForInstant(pool, p.received_at || p.recorded_at || new Date());
  const tx = await fuelInventory.createDraft({
    transaction_type: 'receipt', operational_date: slot.operational_date, shift_id: slot.shift_id,
    transaction_at: p.received_at || undefined, product_id: await productFor(p), destination_location_id: tujuan,
    document_number: p.document_number || null, supplier_reference: p.transporter || null, reason: p.note || null,
    source_type: 'mobile_offline', idempotency_key: `m:${item.client_uuid}`,
    attachment_ids: p.attachment_ids || [], evidence_config_version: p.evidence_config_version,
    lines: [{ direction: 'in', quantity_liter: reqLiter(p.quantity_liter, 'Jumlah diterima') }],
  }, user.id, user);
  await pool.query('UPDATE fuel_inventory_transactions SET device_id = $2, mobile_flags = $3::jsonb WHERE id = $1',
    [tx.id, fuel.device.id, JSON.stringify(flags)]);
  return { server_id: tx.id, status: 'pending_validation' };
}

async function prosesOpname(item, user, fuel) {
  const p = item.payload || {};
  assertDevice(fuel, p.recorded_at);
  const ada = (await pool.query('SELECT id, status FROM fuel_stock_opnames WHERE client_uuid = $1', [item.client_uuid])).rows[0];
  if (ada) return { server_id: ada.id, replay: true, status: ada.status };
  const lokasi = reqUuid(p.location_id, 'Lokasi');
  if (!canUseLocation(fuel, lokasi)) throw err('Lokasi tidak ditugaskan ke akun Anda.', 403, 'LOCATION_FORBIDDEN');
  const slot = await shiftForInstant(pool, p.counted_at || p.recorded_at || new Date());
  const op = await fuelInventory.createOpname({
    location_id: lokasi, product_id: await productFor(p), operational_date: slot.operational_date,
    physical_quantity: p.physical_quantity, measurement_method: p.measurement_method || null, note: p.note || null,
    source_type: 'mobile_offline', attachment_ids: p.attachment_ids || [], evidence_config_version: p.evidence_config_version,
  }, user.id, user);
  await pool.query('UPDATE fuel_stock_opnames SET client_uuid = $2, device_id = $3 WHERE id = $1', [op.id, item.client_uuid, fuel.device.id]);
  const diajukan = await fuelInventory.submitOpname(op.id, user.id);
  return { server_id: op.id, status: diajukan.status };
}

async function prosesShiftOpen(item, user, fuel) {
  const p = item.payload || {};
  assertDevice(fuel, p.recorded_at);
  const ada = (await pool.query('SELECT id, status FROM fuel_shift_sessions WHERE client_uuid = $1', [item.client_uuid])).rows[0];
  if (ada) return { server_id: ada.id, replay: true, status: ada.status };
  const lokasi = reqUuid(p.location_id, 'Lokasi');
  if (!canUseLocation(fuel, lokasi)) throw err('Lokasi tidak ditugaskan ke akun Anda.', 403, 'LOCATION_FORBIDDEN');
  const totalizer = Number(p.totalizer_open);
  if (!Number.isFinite(totalizer) || totalizer < 0) throw err('Totalizer awal wajib angka ≥ 0.');
  const openedAt = Number.isFinite(Date.parse(p.opened_at || '')) ? new Date(p.opened_at).toISOString() : new Date().toISOString();
  const slot = await shiftForInstant(pool, openedAt);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const buka = await client.query(`SELECT s.id, u.nama FROM fuel_shift_sessions s LEFT JOIN users u ON u.id = s.opened_by
      WHERE s.location_id = $1 AND s.status = 'open' FOR UPDATE OF s`, [lokasi]);
    if (buka.rows.length) throw err(`Shift lokasi ini masih terbuka (dibuka ${buka.rows[0].nama || 'petugas lain'}). Tutup dulu.`, 409, 'SESSION_OPEN');
    const r = await client.query(
      `INSERT INTO fuel_shift_sessions (client_uuid, location_id, shift_id, operational_date, device_id, opened_by, opened_at, totalizer_open, formula_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [item.client_uuid, lokasi, slot.shift_id, slot.operational_date, fuel.device.id, user.id, openedAt, totalizer, FORMULA_TOTALIZER]);
    await fuelEvidence.linkAttachments(client, { entityType: 'shift_session', entityId: r.rows[0].id, transactionType: 'shift_open',
      attachmentIds: p.attachment_ids || [], configVersion: p.evidence_config_version ?? null, requireComplete: true, user });
    await client.query('COMMIT');
    return { server_id: r.rows[0].id, status: 'open' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function prosesShiftClose(item, user, fuel, settings) {
  const p = item.payload || {};
  assertDevice(fuel, p.recorded_at);
  const ada = (await pool.query('SELECT id, status FROM fuel_shift_sessions WHERE close_client_uuid = $1', [item.client_uuid])).rows[0];
  if (ada) return { server_id: ada.id, replay: true, status: ada.status };
  const closedAt = Number.isFinite(Date.parse(p.closed_at || '')) ? new Date(p.closed_at).toISOString() : new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cari = p.session_id
      ? await client.query('SELECT * FROM fuel_shift_sessions WHERE id = $1 FOR UPDATE', [reqUuid(p.session_id, 'Sesi shift')])
      : await client.query('SELECT * FROM fuel_shift_sessions WHERE client_uuid = $1 FOR UPDATE', [reqUuid(p.session_client_uuid, 'Sesi shift')]);
    const s = cari.rows[0];
    if (!s) throw err('Sesi shift tidak ditemukan (buka shift belum tersinkron?).', 409, 'SESSION_NOT_FOUND');
    if (s.status !== 'open') throw err('Sesi shift sudah ditutup.', 409, 'SESSION_CLOSED');
    if (!canUseLocation(fuel, s.location_id)) throw err('Lokasi tidak ditugaskan ke akun Anda.', 403, 'LOCATION_FORBIDDEN');
    const keluar = await client.query(
      `SELECT
         COALESCE((SELECT SUM(fl.fuel_filled) FROM fuel_logs fl
           WHERE fl.deleted_at IS NULL AND fl.source_location_id = $1
             AND (fl.shift_session_id = $4 OR fl.filled_at BETWEEN $2 AND $3)), 0)::float AS isi,
         COALESCE((SELECT SUM(li.quantity_liter) FROM fuel_inventory_transactions t JOIN fuel_inventory_lines li ON li.transaction_id = t.id
           WHERE t.transaction_type = 'transfer_out' AND t.source_location_id = $1 AND t.status NOT IN ('void', 'reversed')
             AND t.transaction_at BETWEEN $2 AND $3), 0)::float AS transfer`,
      [s.location_id, s.opened_at, closedAt, s.id]);
    const recordedOut = Number(keluar.rows[0].isi) + Number(keluar.rows[0].transfer);
    const v = totalizerVariance({ open: s.totalizer_open, close: p.totalizer_close, recordedOut,
      tolerancePct: settings.totalizer_tolerance_pct, toleranceLiter: settings.totalizer_tolerance_liter });
    const alasan = String(p.reason || '').trim();
    if (v.investigate && !alasan) {
      throw err(v.rollover ? 'Totalizer akhir lebih kecil dari awal (rollover/reset): alasan wajib.' : 'Selisih totalizer melewati ambang: alasan wajib.',
        422, 'REASON_REQUIRED', { details: { code: 'REASON_REQUIRED', variance: v, recorded_out_liter: recordedOut } });
    }
    await client.query(
      `UPDATE fuel_shift_sessions SET close_client_uuid = $2, closed_by = $3, closed_at = $4, totalizer_close = $5,
         meter_delta_liter = $6, recorded_out_liter = $7, variance_liter = $8, variance_pct = $9, threshold_liter = $10,
         status = $11, close_reason = $12 WHERE id = $1`,
      [s.id, item.client_uuid, user.id, closedAt, Number(p.totalizer_close), v.meterDelta, recordedOut, v.variance,
        v.variancePct, v.threshold, v.investigate ? 'investigation' : 'closed', alasan || null]);
    await fuelEvidence.linkAttachments(client, { entityType: 'shift_session', entityId: s.id, transactionType: 'shift_close',
      attachmentIds: p.attachment_ids || [], configVersion: p.evidence_config_version ?? null, requireComplete: true, user });
    await client.query('COMMIT');
    return { server_id: s.id, status: v.investigate ? 'investigation' : 'closed', variance: { ...v, recorded_out_liter: recordedOut } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const HANDLERS = {
  fill: prosesFill, transfer: prosesTransfer, receipt: prosesReceipt, opname: prosesOpname,
  shift_open: prosesShiftOpen, shift_close: prosesShiftClose,
};

/**
 * Proses antrean berurutan (urutan HP dipertahankan: buka shift → pengisian → tutup shift).
 * Hasil per item: ok | rejected (tidak perlu dikirim ulang) | error (coba lagi nanti).
 */
async function sync(items, user, fuel) {
  const daftar = Array.isArray(items) ? items.slice(0, 50) : [];
  const settings = await getSettings();
  const hasil = [];
  for (const item of daftar) {
    const clientUuid = String(item?.client_uuid || '').toLowerCase();
    try {
      if (!UUID_RE.test(clientUuid)) throw err('client_uuid tidak valid.', 400, 'BAD_REQUEST');
      if (!ITEM_TYPES.has(item.type)) throw err(`Jenis item '${item.type}' tidak dikenal.`, 400, 'BAD_REQUEST');
      if (!fuel.functions.includes(FUNCTION_OF[item.type])) throw err('Fungsi ini tidak diizinkan untuk akun Anda.', 403, 'FUNCTION_FORBIDDEN');
      if (fuel.mustChangePin) throw err('Ganti PIN sementara terlebih dahulu.', 403, 'PIN_CHANGE_REQUIRED');
      const out = await HANDLERS[item.type]({ ...item, client_uuid: clientUuid }, user, fuel, settings);
      hasil.push({ client_uuid: clientUuid, result: 'ok', ...out });
    } catch (error) {
      const status = Number(error.status || error.statusCode || 500);
      const retry = status >= 500 || status === 429 || error.code === '40001' || error.code === '40P01';
      if (retry) console.error('[fuel-mobile] sync item gagal:', item?.type, error.message);
      hasil.push({
        client_uuid: clientUuid, result: retry ? 'error' : 'rejected',
        code: error.code || null, message: retry ? 'Server sedang bermasalah; dicoba lagi otomatis.' : error.message,
        details: error.details || null,
      });
    }
  }
  return { processed: hasil.length, results: hasil };
}

/* ---------- status antrean yang sudah terkirim ---------- */

async function getStatuses(clientUuids, user) {
  const ids = [...new Set((Array.isArray(clientUuids) ? clientUuids : []).map(x => String(x).toLowerCase()).filter(x => UUID_RE.test(x)))].slice(0, 200);
  if (!ids.length) return [];
  const [logs, txs, ops, sesi] = await Promise.all([
    pool.query(`SELECT client_uuid::text AS cu, id, mobile_flags, deleted_at FROM fuel_logs WHERE client_uuid = ANY($1::uuid[]) AND created_by = $2`, [ids, user.id]),
    pool.query(`SELECT substring(idempotency_key from 3) AS cu, id, status, void_reason, transfer_group_id FROM fuel_inventory_transactions
                WHERE idempotency_key = ANY($1::text[]) AND created_by = $2`, [ids.map(i => `m:${i}`), user.id]),
    pool.query(`SELECT client_uuid::text AS cu, id, status, reject_reason FROM fuel_stock_opnames WHERE client_uuid = ANY($1::uuid[])`, [ids]),
    pool.query(`SELECT client_uuid::text AS cu, close_client_uuid::text AS ccu, id, status FROM fuel_shift_sessions
                WHERE client_uuid = ANY($1::uuid[]) OR close_client_uuid = ANY($1::uuid[])`, [ids]),
  ]);
  const peta = new Map();
  for (const r of logs.rows) peta.set(r.cu, { server_id: r.id, status: r.deleted_at ? 'deleted' : 'recorded', flags: r.mobile_flags || [] });
  for (const r of txs.rows) {
    const status = r.status === 'draft' ? 'pending_validation' : r.status === 'void' ? 'rejected' : r.status;
    peta.set(r.cu, { server_id: r.transfer_group_id || r.id, status, reason: r.void_reason || null });
  }
  for (const r of ops.rows) peta.set(r.cu, { server_id: r.id, status: r.status === 'rejected' ? 'rejected' : r.status, reason: r.reject_reason || null });
  for (const r of sesi.rows) {
    if (r.cu && ids.includes(r.cu)) peta.set(r.cu, { server_id: r.id, status: r.status });
    if (r.ccu && ids.includes(r.ccu)) peta.set(r.ccu, { server_id: r.id, status: r.status });
  }
  return ids.map(id => ({ client_uuid: id, ...(peta.get(id) || { status: 'unknown' }) }));
}

module.exports = {
  FORMULA_TOTALIZER, MANUAL_REASONS,
  operationalSlot, shiftStartIso, hmGapCheck, totalizerVariance, isLateEntry, parseScanPayload, canUseLocation,
  getBootstrap, sync, getStatuses, postIssue,
};
