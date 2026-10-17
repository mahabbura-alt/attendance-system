'use strict';

/**
 * Domain inventory Fuel (P1) — validasi transaksi, saldo ledger, draft/post/
 * reverse/void, idempotency. FIFO (P3) dan opname (P4) menyusul di service
 * dan tabelnya sendiri; service ini tidak menghitung average price.
 */
const { pool } = require('../config/db');
const fuelEvidence = require('./fuelEvidence');

const TYPES_IN = new Set(['opening_balance', 'receipt', 'transfer_in', 'return', 'opname_adjustment_in']);
const TYPES_OUT = new Set(['issue_equipment', 'transfer_out', 'loss', 'opname_adjustment_out']);
const SOURCE_TYPES = new Set(['manual', 'input_fuel', 'import', 'mobile_offline', 'integration', 'stock_opname', 'system_reversal']);

const err = (message, status = 400, code = null) => Object.assign(new Error(message), { status }, code ? { code } : {});

function sideOf(type) {
  if (TYPES_IN.has(type)) return 'in';
  if (TYPES_OUT.has(type)) return 'out';
  return null;
}

/**
 * Kolom DATE dari node-pg berupa objek Date (tengah malam waktu lokal server), bukan string;
 * String(Date).slice(0, 10) menghasilkan "Fri Oct 17" sehingga posting/reversal/opname gagal.
 */
function tglIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value == null ? '' : value).slice(0, 10);
}

function nomorTransaksi(seq, tanggal) {
  const digits = String(tanggal || '').replace(/-/g, '').slice(0, 8) || '00000000';
  return `FI-${digits}-${String(seq).padStart(4, '0')}`;
}

function validasiInput(input = {}) {
  const type = String(input.transaction_type || '').trim();
  if (!TYPES_IN.has(type) && !TYPES_OUT.has(type)) throw err('Jenis transaksi tidak valid.');
  const side = sideOf(type);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw err('Minimal satu baris quantity.');
  for (const [index, line] of lines.entries()) {
    if (String(line.direction || '') !== side) throw err(`Arah baris ${index + 1} harus '${side}'.`);
    const qty = Number(line.quantity_liter);
    if (!Number.isFinite(qty) || qty <= 0) throw err(`Quantity baris ${index + 1} harus > 0 Liter.`);
    if (line.unit_price != null && !(Number(line.unit_price) >= 0)) throw err(`Harga baris ${index + 1} tidak valid.`);
  }
  if (!input.operational_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.operational_date))) {
    throw err('Tanggal operasional wajib (YYYY-MM-DD).');
  }
  if (!input.product_id) throw err('Produk Fuel wajib diisi.');
  if (side === 'in' && !input.destination_location_id) throw err('Transaksi masuk wajib memiliki lokasi tujuan.');
  if (side === 'out' && !input.source_location_id) throw err('Transaksi keluar wajib memiliki lokasi sumber.');
  if (type === 'issue_equipment' && !input.equipment_id) throw err('Issue equipment wajib memiliki unit.');
  if (input.source_type != null && !SOURCE_TYPES.has(String(input.source_type))) throw err('Sumber transaksi tidak valid.');
  return { type, side, lines };
}

async function tulisAudit(db, { entityType, entityId, action, before, after, reason, actorId }) {
  await db.query(
    `INSERT INTO fuel_inventory_audit (entity_type, entity_id, action, before_data, after_data, reason, actor_id)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
    [entityType, entityId, action, before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null, reason || null, actorId || null]
  );
}

/**
 * Tautkan bukti foto ke entitas di dalam transaksi DB yang sama. Input dari APK
 * (source_type mobile_offline) wajib lengkap sesuai slot versi saat dibuat di HP;
 * input manual dashboard boleh tanpa lampiran.
 */
async function tautkanBukti(client, { entityType, entityId, transactionType = null, input = {}, user = null, actorId = null, table }) {
  const ids = Array.isArray(input.attachment_ids) ? input.attachment_ids : [];
  const mobile = input.source_type === 'mobile_offline';
  if (!mobile && !ids.length) return null;
  const hasil = await fuelEvidence.linkAttachments(client, {
    entityType, entityId, transactionType, attachmentIds: ids,
    configVersion: input.evidence_config_version == null ? null : Number(input.evidence_config_version),
    requireComplete: mobile, user: user || { id: actorId },
  });
  await client.query(`UPDATE ${table} SET evidence_config_version = $2 WHERE id = $1`, [entityId, hasil.config_version]);
  return hasil;
}

async function ambilTransaksi(db, id, forUpdate = false) {
  // PostgreSQL menolak FOR UPDATE bersama GROUP BY: kunci baris header dulu, lalu agregasi baris.
  if (forUpdate) await db.query('SELECT id FROM fuel_inventory_transactions WHERE id = $1 FOR UPDATE', [id]);
  const result = await db.query(
    `SELECT t.*, COALESCE(json_agg(json_build_object(
       'id', l.id, 'direction', l.direction, 'quantity_liter', l.quantity_liter,
       'unit_price', l.unit_price, 'total_value', l.total_value,
       'batch_number', l.batch_number
     ) ORDER BY l.created_at) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lines
     FROM fuel_inventory_transactions t
     LEFT JOIN fuel_inventory_lines l ON l.transaction_id = t.id
     WHERE t.id = $1 GROUP BY t.id`,
    [id]
  );
  return result.rows[0] || null;
}

async function createDraft(input = {}, actorId = null, user = null) {
  const { type, lines } = validasiInput(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.idempotency_key) {
      const ada = await client.query(`SELECT id FROM fuel_inventory_transactions
        WHERE idempotency_key = $1 AND status NOT IN ('reversed', 'void') LIMIT 1`, [input.idempotency_key]);
      if (ada.rows.length) {
        await client.query('ROLLBACK');
        return ambilTransaksi(pool, ada.rows[0].id);
      }
    }
    if (input.fuel_log_id) {
      const ganda = await client.query(
        `SELECT id FROM fuel_inventory_transactions WHERE fuel_log_id = $1 AND status <> 'reversed' AND status <> 'void' LIMIT 1`,
        [input.fuel_log_id]);
      if (ganda.rows.length) throw err('Fuel log sudah memiliki issue aktif (satu log = maksimal satu issue).', 409);
    }
    const seq = await client.query(`SELECT nextval('fuel_inventory_transaction_seq') AS seq`);
    const nomor = nomorTransaksi(seq.rows[0].seq, input.operational_date);
    const head = await client.query(
      `INSERT INTO fuel_inventory_transactions
        (transaction_number, transaction_type, operational_date, transaction_at, shift_id,
         product_id, source_location_id, destination_location_id, equipment_id, operator_id,
         fuel_log_id, document_number, supplier_reference, transfer_group_id,
         status, source_type, reason, idempotency_key, created_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$17,$18)
       RETURNING *`,
      [nomor, type, input.operational_date, input.transaction_at || new Date().toISOString(),
        input.shift_id || null, input.product_id,
        input.source_location_id || null, input.destination_location_id || null,
        input.equipment_id || null, input.operator_id || null, input.fuel_log_id || null,
        input.document_number || null, input.supplier_reference || null, input.transfer_group_id || null,
        input.source_type || 'manual', input.reason || null, input.idempotency_key || null, actorId]);
    const header = head.rows[0];
    for (const line of lines) {
      await client.query(
        `INSERT INTO fuel_inventory_lines
          (transaction_id, direction, quantity_liter, unit_price, total_value, batch_number, source_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [header.id, String(line.direction), Number(line.quantity_liter),
          line.unit_price == null ? null : Number(line.unit_price),
          line.total_value == null ? null : Number(line.total_value),
          line.batch_number || null, line.source_reference || null]);
    }
    await tautkanBukti(client, { entityType: 'transaction', entityId: header.id, transactionType: type, input, user, actorId, table: 'fuel_inventory_transactions' });
    await tulisAudit(client, { entityType: 'transaction', entityId: header.id, action: 'draft_create', after: header, reason: input.reason, actorId });
    await client.query('COMMIT');
    return ambilTransaksi(pool, header.id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function postTransaction(id, actorId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await ambilTransaksi(client, id, true);
    if (!row) throw err('Transaksi tidak ditemukan.', 404);
    if (row.status !== 'draft') throw err(`Hanya draft yang dapat diposting (status: ${row.status}).`, 422);
    if (row.transfer_group_id) throw err('Transfer harus divalidasi per grup (kedua kaki sekaligus).', 422, 'TRANSFER_GROUP');
    validasiInput({ transaction_type: row.transaction_type, operational_date: tglIso(row.operational_date), product_id: row.product_id, source_location_id: row.source_location_id, destination_location_id: row.destination_location_id, equipment_id: row.equipment_id, lines: row.lines });
    const result = await client.query(
      `UPDATE fuel_inventory_transactions SET status = 'posted', posted_by = $2, posted_at = CURRENT_TIMESTAMP,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id, actorId]);
    await prosesFifoPosting(client, result.rows[0]);
    await tulisAudit(client, { entityType: 'transaction', entityId: id, action: 'post', before: row, after: result.rows[0], actorId });
    await client.query('COMMIT');
    return ambilTransaksi(pool, id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function reverseTransaction(id, actorId = null, reason = '') {
  if (!String(reason || '').trim()) throw err('Alasan reversal wajib diisi.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await ambilTransaksi(client, id, true);
    if (!selected) throw err('Transaksi tidak ditemukan.', 404);

    let originals = [selected];
    if (selected.transfer_group_id && ['transfer_in', 'transfer_out'].includes(selected.transaction_type)) {
      const group = await client.query(
        `SELECT id, transaction_type FROM fuel_inventory_transactions
         WHERE transfer_group_id = $1 AND status NOT IN ('void', 'reversed')
         ORDER BY CASE WHEN transaction_type = 'transfer_in' THEN 0 ELSE 1 END, created_at
         FOR UPDATE`, [selected.transfer_group_id]);
      if (group.rows.length !== 2
        || !group.rows.some(row => row.transaction_type === 'transfer_in')
        || !group.rows.some(row => row.transaction_type === 'transfer_out')) {
        throw err('Pasangan transfer tidak lengkap; reversal dibatalkan demi integritas stok.', 409);
      }
      originals = [];
      for (const item of group.rows) originals.push(await ambilTransaksi(client, item.id, false));
    }
    if (originals.some(row => row.status !== 'posted')) {
      throw err('Seluruh transaksi yang direversal harus berstatus posted.', 422);
    }

    const reversalIds = [];
    for (const row of originals) {
      const seq = await client.query(`SELECT nextval('fuel_inventory_transaction_seq') AS seq`);
      const nomor = nomorTransaksi(seq.rows[0].seq, tglIso(row.operational_date));
      const head = await client.query(
        `INSERT INTO fuel_inventory_transactions
          (transaction_number, transaction_type, operational_date, product_id,
           source_location_id, destination_location_id, equipment_id,
           status, source_type, reason, reversal_of_transaction_id, created_by,
           posted_by, posted_at)
         VALUES ($1,'reversal',$2::date,$3,$4,$5,$6,'posted','system_reversal',$7,$8,$9,$9,CURRENT_TIMESTAMP)
         RETURNING *`,
        [nomor, tglIso(row.operational_date), row.product_id,
          row.destination_location_id, row.source_location_id, row.equipment_id,
          String(reason).trim(), row.id, actorId]);
      for (const line of row.lines || []) {
        await client.query(
          `INSERT INTO fuel_inventory_lines (transaction_id, direction, quantity_liter, unit_price, total_value, batch_number)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [head.rows[0].id, line.direction === 'in' ? 'out' : 'in', Number(line.quantity_liter),
            line.unit_price == null ? null : Number(line.unit_price),
            line.total_value == null ? null : Number(line.total_value), line.batch_number || null]);
      }
      await client.query(
        `UPDATE fuel_inventory_transactions SET status = 'reversed', reversed_by = $2, reversed_at = CURRENT_TIMESTAMP,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.id, actorId]);
      await kembalikanFifoReversal(client, row.id);
      await tulisAudit(client, { entityType: 'transaction', entityId: row.id, action: 'reverse', before: row, after: head.rows[0], reason, actorId });
      reversalIds.push(head.rows[0].id);
    }
    await client.query('COMMIT');
    if (originals.length === 1) return ambilTransaksi(pool, reversalIds[0]);
    return { grouped: true, transfer_group_id: selected.transfer_group_id,
      original_ids: originals.map(row => row.id), reversal_ids: reversalIds };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function voidDraft(id, actorId = null, reason = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await ambilTransaksi(client, id, true);
    if (!row) throw err('Transaksi tidak ditemukan.', 404);
    if (row.status !== 'draft') throw err('Hanya draft yang dapat divoid.', 422);
    if (row.transfer_group_id) throw err('Transfer harus ditolak per grup (kedua kaki sekaligus).', 422, 'TRANSFER_GROUP');
    const result = await client.query(
      `UPDATE fuel_inventory_transactions SET status = 'void', void_reason = $2, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id, reason ? String(reason).trim() : null]);
    await tulisAudit(client, { entityType: 'transaction', entityId: id, action: 'void', before: row, after: result.rows[0], reason, actorId });
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getLedger({ dari = null, sampai = null, location_id = null, product_id = null, type = null, status = null, search = null, limit = 200, offset = 0, cap = 1000 } = {}) {
  const clauses = [];
  const params = [];
  if (dari) { params.push(dari); clauses.push(`b.operational_date >= $${params.length}::date`); }
  if (sampai) { params.push(sampai); clauses.push(`b.operational_date <= $${params.length}::date`); }
  if (location_id) {
    params.push(location_id);
    clauses.push(`b.ledger_location_id = $${params.length}::uuid`);
  }
  if (product_id) { params.push(product_id); clauses.push(`b.product_id = $${params.length}::uuid`); }
  if (type) { params.push(type); clauses.push(`b.transaction_type = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`b.status = $${params.length}`); }
  if (search) { params.push(`%${search}%`); clauses.push(`(b.transaction_number ILIKE $${params.length} OR b.document_number ILIKE $${params.length})`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(Math.max(0, Number(offset) || 0));
  params.push(Math.max(1, Math.min(Number(cap) || 1000, Number(limit) || 200)));
  const hasil = await pool.query(
    `WITH transaksi AS (
       SELECT t.*, p.product_code, p.product_name,
              sl.location_code AS source_code, dl.location_code AS destination_code, eq.kode_alat AS equipment_code,
              (SELECT l2.location_code FROM fuel_inventory_transactions t2
                 JOIN fuel_storage_locations l2 ON l2.id = t2.destination_location_id
               WHERE t.transfer_group_id IS NOT NULL AND t2.transfer_group_id = t.transfer_group_id
                 AND t2.transaction_type = 'transfer_in' LIMIT 1) AS transfer_to_code,
              CASE WHEN BOOL_AND(l.direction = 'in') THEN t.destination_location_id
                   WHEN BOOL_AND(l.direction = 'out') THEN t.source_location_id END AS ledger_location_id,
              COALESCE(SUM(l.quantity_liter), 0) AS quantity_liter,
              -- Harga per liter tertimbang volume; NULL bila ada baris tanpa harga (biaya belum lengkap).
              CASE WHEN COUNT(l.id) > 0 AND COUNT(l.unit_price) = COUNT(l.id)
                   THEN SUM(l.quantity_liter * l.unit_price) / NULLIF(SUM(l.quantity_liter), 0) END AS unit_price,
              COALESCE(SUM(CASE WHEN l.direction = 'in' THEN l.quantity_liter ELSE -l.quantity_liter END), 0) AS signed_quantity
       FROM fuel_inventory_transactions t
       LEFT JOIN fuel_products p ON p.id = t.product_id
       LEFT JOIN fuel_storage_locations sl ON sl.id = t.source_location_id
       LEFT JOIN fuel_storage_locations dl ON dl.id = t.destination_location_id
       LEFT JOIN equipment eq ON eq.id = t.equipment_id
       LEFT JOIN fuel_inventory_lines l ON l.transaction_id = t.id
       GROUP BY t.id, p.product_code, p.product_name, sl.location_code, dl.location_code, eq.kode_alat
     ), balance AS (
       SELECT transaksi.*,
              COALESCE(SUM(CASE WHEN status IN ('posted','reversed') THEN signed_quantity ELSE 0 END)
                OVER (PARTITION BY ledger_location_id, product_id
                  ORDER BY operational_date, transaction_at, created_at, id), 0) AS running_balance
       FROM transaksi
     )
     SELECT b.* FROM balance b ${where}
     ORDER BY b.operational_date DESC, b.created_at DESC
     OFFSET $${params.length - 1} LIMIT $${params.length}`,
    params
  );
  return hasil.rows;
}

async function listProducts() {
  return (await pool.query('SELECT * FROM fuel_products ORDER BY product_code')).rows;
}

async function saveProduct(input = {}, actorId = null) {
  const code = String(input.product_code || '').trim().toUpperCase();
  const name = String(input.product_name || '').trim();
  if (!code || !name) throw err('Kode dan nama produk wajib diisi.');
  try {
    if (input.id) {
      const hasil = await pool.query(
        `UPDATE fuel_products SET product_name = $2, density_kg_l = $3,
          is_active = COALESCE($4, is_active), updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [input.id, name, input.density_kg_l == null ? null : Number(input.density_kg_l),
          input.is_active == null ? null : Boolean(input.is_active)]);
      if (!hasil.rows.length) throw err('Produk tidak ditemukan.', 404);
      return hasil.rows[0];
    }
    const hasil = await pool.query(
      `INSERT INTO fuel_products (product_code, product_name, density_kg_l) VALUES ($1,$2,$3) RETURNING *`,
      [code, name, input.density_kg_l == null ? null : Number(input.density_kg_l)]);
    return hasil.rows[0];
  } catch (error) {
    if (error?.code === '23505') throw err('Kode produk sudah dipakai.', 409);
    throw error;
  }
}

async function listLocations() {
  return (await pool.query('SELECT * FROM fuel_storage_locations ORDER BY location_code')).rows;
}

async function saveLocation(input = {}, actorId = null) {
  const code = String(input.location_code || '').trim().toUpperCase();
  const name = String(input.location_name || '').trim();
  const type = String(input.storage_type || 'tank').trim();
  if (!code || !name) throw err('Kode dan nama lokasi wajib diisi.');
  if (!['depot', 'tank', 'fuel_truck'].includes(type)) throw err('Tipe lokasi tidak valid.');
  const num = v => (v == null || v === '' ? null : Number(v));
  if ((input.capacity_liter != null && !(num(input.capacity_liter) >= 0))
    || (input.minimum_stock_liter != null && !(num(input.minimum_stock_liter) >= 0))) {
    throw err('Kapasitas/minimum harus angka ≥ 0.');
  }
  try {
    if (input.id) {
      const hasil = await pool.query(
        `UPDATE fuel_storage_locations SET location_name = $2, storage_type = $3,
          equipment_id = $4, capacity_liter = $5, minimum_stock_liter = $6,
          is_active = COALESCE($7, is_active), version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [input.id, name, type, input.equipment_id || null, num(input.capacity_liter),
          num(input.minimum_stock_liter), input.is_active == null ? null : Boolean(input.is_active)]);
      if (!hasil.rows.length) throw err('Lokasi tidak ditemukan.', 404);
      return hasil.rows[0];
    }
    const hasil = await pool.query(
      `INSERT INTO fuel_storage_locations
        (location_code, location_name, storage_type, equipment_id, capacity_liter, minimum_stock_liter)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code, name, type, input.equipment_id || null, num(input.capacity_liter), num(input.minimum_stock_liter)]);
    return hasil.rows[0];
  } catch (error) {
    if (error?.code === '23505') throw err('Kode lokasi sudah dipakai.', 409);
    throw error;
  }
}

async function saldoLokasi(db, location_id, product_id = null) {
  const hasil = await db.query(
    `SELECT COALESCE(SUM(CASE
        WHEN l.direction = 'in' AND t.destination_location_id = $1 THEN l.quantity_liter
        WHEN l.direction = 'out' AND t.source_location_id = $1 THEN -l.quantity_liter
        ELSE 0 END), 0) AS balance
     FROM fuel_inventory_lines l
     JOIN fuel_inventory_transactions t ON t.id = l.transaction_id
     -- 'reversed' ikut dihitung: original yang direversal tetap tercatat,
     -- diimbangi transaksi reversal yang berlawanan arah.
     WHERE t.status IN ('posted', 'reversed')
       AND (t.source_location_id = $1 OR t.destination_location_id = $1)
       AND ($2::uuid IS NULL OR t.product_id = $2::uuid)`,
    [location_id, product_id]);
  return Number(hasil.rows[0]?.balance || 0);
}

async function getBalance({ location_id, product_id = null } = {}) {
  if (!location_id) throw err('Lokasi wajib diisi.');
  return saldoLokasi(pool, location_id, product_id);
}

/* ---------------- P2: integrasi Input Fuel (mode shadow) ---------------- */
/* Mapping tidak menebak: cocok unik => lokasi+produk; selain itu antrean. */

async function listMappings() {
  return (await pool.query(
    `SELECT m.*, p.product_code, l.location_code FROM fuel_source_mappings m
     LEFT JOIN fuel_products p ON p.id = m.product_id
     LEFT JOIN fuel_storage_locations l ON l.id = m.location_id
     ORDER BY m.priority, m.created_at`)).rows;
}

async function saveMapping(input = {}) {
  const shift = input.shift_id || null;
  const truck = input.truck_equipment_id || null;
  const op = input.operator_id || null;
  if (!shift && !truck && !op) throw err('Minimal satu kunci (shift/truck/operator) wajib diisi.');
  if (!input.product_id) throw err('Produk wajib diisi.');
  if (!input.location_id) throw err('Lokasi wajib diisi.');
  const semua = await pool.query('SELECT * FROM fuel_source_mappings WHERE is_active = TRUE');
  const sama = r => String(r.shift_id || '') === String(shift || '')
    && String(r.truck_equipment_id || '') === String(truck || '')
    && String(r.operator_id || '') === String(op || '');
  if (semua.rows.some(r => String(r.id) !== String(input.id || '') && sama(r))) {
    throw err('Mapping dengan kombinasi kunci yang sama sudah ada.', 409);
  }
  if (input.id) {
    const hasil = await pool.query(
      `UPDATE fuel_source_mappings SET shift_id = $2, truck_equipment_id = $3,
        operator_id = $4, product_id = $5, location_id = $6, priority = $7,
        is_active = COALESCE($8, is_active), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [input.id, shift, truck, op, input.product_id, input.location_id,
        input.priority == null ? 100 : Number(input.priority),
        input.is_active == null ? null : Boolean(input.is_active)]);
    if (!hasil.rows.length) throw err('Mapping tidak ditemukan.', 404);
    return hasil.rows[0];
  }
  const hasil = await pool.query(
    `INSERT INTO fuel_source_mappings
      (shift_id, truck_equipment_id, operator_id, product_id, location_id, priority)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [shift, truck, op, input.product_id, input.location_id,
      input.priority == null ? 100 : Number(input.priority)]);
  return hasil.rows[0];
}

function resolveSourceLocation(mappings, kunci = {}) {
  const skor = m => (m.shift_id ? 1 : 0) + (m.truck_equipment_id ? 1 : 0) + (m.operator_id ? 1 : 0);
  const cocok = (mappings || [])
    .filter(m => m && m.is_active !== false)
    .filter(m => (m.shift_id == null || String(m.shift_id) === String(kunci.shift_id || ''))
      && (m.truck_equipment_id == null || String(m.truck_equipment_id) === String(kunci.truck_equipment_id || ''))
      && (m.operator_id == null || String(m.operator_id) === String(kunci.operator_id || '')))
    .sort((a, b) => (skor(b) - skor(a)) || ((Number(a.priority) || 100) - (Number(b.priority) || 100)));
  if (!cocok.length) return { resolved: false, reason: 'no_mapping' };
  if (cocok.length < 2 || skor(cocok[0]) !== skor(cocok[1])) {
    if (!cocok[0].product_id) return { resolved: false, reason: 'no_product' };
    return { resolved: true, location_id: cocok[0].location_id, product_id: cocok[0].product_id, mapping_id: cocok[0].id };
  }
  return { resolved: false, reason: 'ambiguous' };
}

async function muatFuelLog(id) {
  const hasil = await pool.query('SELECT * FROM fuel_logs WHERE id = $1 LIMIT 1', [id]);
  return hasil.rows[0] || null;
}

async function issueAktif(fuelLogId) {
  const hasil = await pool.query(
    `SELECT * FROM fuel_inventory_transactions WHERE fuel_log_id = $1
     AND status NOT IN ('reversed', 'void') ORDER BY created_at DESC LIMIT 1`,
    [fuelLogId]);
  return hasil.rows[0] || null;
}

async function jumlahIssue(issueId) {
  const hasil = await pool.query(
    'SELECT COALESCE(SUM(quantity_liter), 0) AS jml FROM fuel_inventory_lines WHERE transaction_id = $1',
    [issueId]);
  return Number(hasil.rows[0]?.jml || 0);
}

async function buatIssueDraft(log, butuh, actorId) {
  try {
    return await createDraft({
      transaction_type: 'issue_equipment',
      operational_date: String(log.tanggal).slice(0, 10),
      product_id: butuh.product_id,
      source_location_id: butuh.location_id,
      equipment_id: log.equipment_id,
      operator_id: log.operator_id,
      fuel_log_id: log.id,
      document_number: log.fuel_ticket_no || null,
      source_type: 'input_fuel',
      reason: 'sinkron Input Fuel (shadow)',
      idempotency_key: `fuel-log:${log.id}`,
      lines: [{ direction: 'out', quantity_liter: butuh.qty }],
    }, actorId);
  } catch (error) {
    if (error.status === 409) {
      const ada = await issueAktif(log.id);
      if (ada) return ada;
    }
    throw error;
  }
}

async function ensureIssueForFuelLog(fuelLogId, actorId = null) {
  const log = await muatFuelLog(fuelLogId);
  if (!log || log.deleted_at || !(Number(log.fuel_filled) > 0)) return { action: 'skipped_invalid' };
  const ada = await issueAktif(fuelLogId);
  const mappings = (await listMappings()).filter(m => m.is_active);
  const putus = resolveSourceLocation(mappings, {
    shift_id: log.shift_id, truck_equipment_id: log.equipment_id, operator_id: log.operator_id,
  });
  const butuh = putus.resolved
    ? { location_id: putus.location_id, product_id: putus.product_id, qty: Number(log.fuel_filled) }
    : null;
  if (ada) {
    if (ada.status === 'draft') {
      const qtyLama = await jumlahIssue(ada.id);
      const sama = butuh && String(ada.source_location_id) === String(butuh.location_id)
        && String(ada.product_id) === String(butuh.product_id)
        && Math.abs(qtyLama - butuh.qty) < 0.0005;
      if (sama) return { action: 'synced', issue: ada };
      await voidDraft(ada.id, actorId);
      if (!butuh) return { action: 'voided_no_mapping', reason: putus.reason };
      const baru = await buatIssueDraft(log, butuh, actorId);
      return { action: 'void_recreated', issue: baru };
    }
    if (butuh && Math.abs(Number(await jumlahIssue(ada.id)) - butuh.qty) >= 0.0005) {
      return { action: 'posted_mismatch', issue: ada };
    }
    return { action: 'synced', issue: ada };
  }
  if (!butuh) return { action: 'no_mapping', reason: putus.reason };
  const baru = await buatIssueDraft(log, butuh, actorId);
  return { action: 'created', issue: baru };
}

async function syncFuelLogDelete(fuelLogId, actorId = null, reason = '') {
  const ada = await issueAktif(fuelLogId);
  if (!ada) return { action: 'none' };
  if (ada.status === 'draft') {
    await voidDraft(ada.id, actorId);
    return { action: 'voided', issue: ada };
  }
  await reverseTransaction(ada.id, actorId, reason || 'fuel log dihapus');
  return { action: 'reversed', issue: ada };
}

async function linkIssue({ fuel_log_id, location_id, product_id } = {}, actorId = null) {
  const log = await muatFuelLog(fuel_log_id);
  if (!log || log.deleted_at || !(Number(log.fuel_filled) > 0)) throw err('Log Fuel tidak valid.', 422);
  if (!location_id) throw err('Lokasi wajib diisi.');
  if (!product_id) throw err('Produk wajib diisi.');
  const ada = await issueAktif(fuel_log_id);
  if (ada) {
    if (ada.status !== 'draft') throw err('Issue sudah posted; void/reversal manual dulu via transaksi.', 409);
    await voidDraft(ada.id, actorId);
  }
  const baru = await buatIssueDraft(log,
    { location_id, product_id, qty: Number(log.fuel_filled) }, actorId);
  return { action: ada ? 'void_recreated' : 'created', issue: baru };
}

async function getReconciliation({ limit = 200 } = {}) {
  const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
  const unlinked = await pool.query(
    `SELECT fl.id, fl.tanggal::text AS tanggal, fl.fuel_filled, fl.equipment_id,
            e.kode_alat, fl.shift_id, fl.operator_id
     FROM fuel_logs fl LEFT JOIN equipment e ON e.id = fl.equipment_id
     WHERE fl.deleted_at IS NULL AND fl.fuel_filled > 0
       AND NOT EXISTS (SELECT 1 FROM fuel_inventory_transactions t
         WHERE t.fuel_log_id = fl.id AND t.status NOT IN ('reversed', 'void'))
     ORDER BY fl.tanggal DESC LIMIT $1`,
    [lim]);
  const mappings = (await listMappings()).filter(m => m.is_active);
  for (const row of unlinked.rows) {
    const putus = resolveSourceLocation(mappings, {
      shift_id: row.shift_id, truck_equipment_id: row.equipment_id, operator_id: row.operator_id,
    });
    row.dapatDipetakan = putus.resolved;
    row.alasanMapping = putus.resolved ? null : putus.reason;
  }
  const orphans = await pool.query(
    `SELECT t.id, t.transaction_number, t.fuel_log_id, t.status
     FROM fuel_inventory_transactions t LEFT JOIN fuel_logs fl ON fl.id = t.fuel_log_id
     WHERE t.fuel_log_id IS NOT NULL AND t.status NOT IN ('reversed', 'void') AND fl.id IS NULL
     ORDER BY t.created_at DESC LIMIT $1`,
    [lim]);
  const mismatched = await pool.query(
    `SELECT t.id, t.transaction_number, t.fuel_log_id, fl.fuel_filled,
            COALESCE((SELECT SUM(l.quantity_liter) FROM fuel_inventory_lines l
              WHERE l.transaction_id = t.id), 0) AS qty
     FROM fuel_inventory_transactions t JOIN fuel_logs fl ON fl.id = t.fuel_log_id
     WHERE t.fuel_log_id IS NOT NULL AND t.status NOT IN ('reversed', 'void')
       AND fl.deleted_at IS NULL
       AND ABS(COALESCE((SELECT SUM(l.quantity_liter) FROM fuel_inventory_lines l
         WHERE l.transaction_id = t.id), 0) - fl.fuel_filled) > 0.005
     ORDER BY t.created_at DESC LIMIT $1`,
    [lim]);
  return { unlinkedLogs: unlinked.rows, orphanIssues: orphans.rows, mismatched: mismatched.rows };
}

async function syncUnlinkedFuelLogs({ limit = 200 } = {}, actorId = null) {
  const rekonsiliasi = await getReconciliation({ limit });
  const hasil = { total: rekonsiliasi.unlinkedLogs.length, created: 0, synced: 0, skipped: 0, errors: [] };
  for (const log of rekonsiliasi.unlinkedLogs) {
    if (!log.dapatDipetakan) { hasil.skipped += 1; continue; }
    try {
      const result = await ensureIssueForFuelLog(log.id, actorId);
      if (result.action === 'created' || result.action === 'void_recreated') hasil.created += 1;
      else if (result.action === 'synced') hasil.synced += 1;
      else hasil.skipped += 1;
    } catch (error) {
      hasil.errors.push({ fuel_log_id: log.id, message: error.message });
    }
  }
  return hasil;
}

/* ---------------- P3: FIFO allocator + transfer atomik ---------------- */
/* Konsumsi oldest-first (received_at, id) dengan row lock. Concurrent
   outbound diserialkan PostgreSQL via FOR UPDATE di satu transaksi. */

async function lapisanTersedia(client, { location_id, product_id }) {
  const hasil = await client.query(
    `SELECT * FROM fuel_fifo_layers
     WHERE location_id = $1 AND (product_id = $2 OR ($2::uuid IS NULL AND product_id IS NULL))
       AND status = 'open' AND remaining_quantity > 0
     ORDER BY received_at, id FOR UPDATE`,
    [location_id, product_id]);
  return hasil.rows;
}

async function buatLayer(client, { receipt_line_id, location_id, product_id, received_at, quantity, unit_cost, batch_number }) {
  const hasil = await client.query(
    `INSERT INTO fuel_fifo_layers
      (receipt_line_id, location_id, product_id, received_at, initial_quantity,
       remaining_quantity, unit_cost, batch_number, status)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,'open') RETURNING *`,
    [receipt_line_id, location_id, product_id, received_at || new Date().toISOString(),
      Number(quantity), unit_cost == null ? null : Number(unit_cost), batch_number || null]);
  return hasil.rows[0];
}

async function alokasiFifo(client, { location_id, product_id, quantity, outbound_line_id }) {
  const butuh = Number(quantity);
  if (!(butuh > 0)) throw err('Quantity alokasi harus > 0.');
  const layers = await lapisanTersedia(client, { location_id, product_id });
  const tersedia = layers.reduce((t, l) => t + Number(l.remaining_quantity), 0);
  if (tersedia + 1e-9 < butuh) {
    throw err(`Stok tidak mencukupi di lokasi (tersedia ${tersedia} L).`, 422);
  }
  const hasil = [];
  let sisa = butuh;
  for (const layer of layers) {
    if (sisa <= 1e-9) break;
    const ambil = Math.min(Number(layer.remaining_quantity), sisa);
    if (!(ambil > 0)) continue;
    await client.query(
      `UPDATE fuel_fifo_layers SET remaining_quantity = remaining_quantity - $2::numeric,
        status = CASE WHEN remaining_quantity - $2::numeric <= 0 THEN 'exhausted' ELSE 'open' END,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [layer.id, ambil]);
    const cost = layer.unit_cost == null ? null : Number(layer.unit_cost);
    await client.query(
      `INSERT INTO fuel_fifo_allocations
        (outbound_line_id, fifo_layer_id, allocated_quantity, unit_cost_snapshot, allocated_value)
       VALUES ($1,$2,$3,$4,$5)`,
      [outbound_line_id, layer.id, ambil, cost, cost == null ? null : ambil * cost]);
    hasil.push({ layer_id: layer.id, quantity: ambil, unit_cost: cost });
    sisa -= ambil;
  }
  return hasil;
}

async function prosesFifoPosting(client, header) {
  const detail = await ambilTransaksi(client, header.id);
  for (const line of detail.lines || []) {
    if (line.direction === 'out') {
      await alokasiFifo(client, {
        location_id: detail.source_location_id, product_id: detail.product_id,
        quantity: line.quantity_liter, outbound_line_id: line.id,
      });
    } else {
      await buatLayer(client, {
        receipt_line_id: line.id, location_id: detail.destination_location_id,
        product_id: detail.product_id, received_at: detail.transaction_at,
        quantity: line.quantity_liter, unit_cost: line.unit_price, batch_number: line.batch_number,
      });
    }
  }
}

async function kembalikanFifoReversal(client, originalId) {
  // Kembalikan konsumsi outbound ke layer asal (bukan layer baru).
  const alokasi = await client.query(
    `SELECT a.* FROM fuel_fifo_allocations a
     JOIN fuel_inventory_lines l ON l.id = a.outbound_line_id
     WHERE l.transaction_id = $1`,
    [originalId]);
  for (const row of alokasi.rows) {
    await client.query(
      `UPDATE fuel_fifo_layers SET remaining_quantity = remaining_quantity + $2::numeric,
        status = 'open', version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.fifo_layer_id, row.allocated_quantity]);
  }
  // Layer dari inbound asal hanya boleh dibatalkan bila utuh (belum tersentuh).
  const milik = await client.query(
    `SELECT * FROM fuel_fifo_layers WHERE receipt_line_id IN
      (SELECT id FROM fuel_inventory_lines WHERE transaction_id = $1)`,
    [originalId]);
  for (const layer of milik.rows) {
    if (Number(layer.remaining_quantity) < Number(layer.initial_quantity) - 1e-9) {
      throw err('Layer penerimaan sudah terpakai; reversal ditolak demi integritas FIFO.', 422);
    }
    await client.query(
      `UPDATE fuel_fifo_layers SET status = 'reversed', version = version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [layer.id]);
  }
  return { alokasiDikembalikan: alokasi.rows.length, layerDibatalkan: milik.rows.length };
}

async function transferStock(input = {}, actorId = null, user = null, opts = {}) {
  const qty = Number(input.quantity_liter);
  if (!(qty > 0)) throw err('Quantity transfer harus > 0 Liter.');
  if (!input.from_location_id) throw err('Lokasi asal wajib diisi.');
  if (!input.to_location_id) throw err('Lokasi tujuan wajib diisi.');
  if (String(input.from_location_id) === String(input.to_location_id)) {
    throw err('Lokasi asal dan tujuan tidak boleh sama.');
  }
  if (!input.product_id) throw err('Produk wajib diisi.');
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(input.operational_date || ''))
    ? String(input.operational_date) : new Date().toISOString().slice(0, 10);
  const groupId = input.transfer_group_id || require('node:crypto').randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.idempotency_key) {
      const ada = await client.query(
        `SELECT id, transfer_group_id FROM fuel_inventory_transactions WHERE idempotency_key = $1
         AND status NOT IN ('reversed', 'void') LIMIT 1`,
        [input.idempotency_key]);
      if (ada.rows.length) {
        const pasangan = ada.rows[0].transfer_group_id
          ? (await client.query(
            `SELECT * FROM fuel_inventory_transactions WHERE transfer_group_id = $1 ORDER BY created_at`,
            [ada.rows[0].transfer_group_id])).rows
          : [ada.rows[0]];
        await client.query('ROLLBACK');
        return { duplicate: true, transactions: pasangan };
      }
    }
    const seqAwal = await client.query(`SELECT nextval('fuel_inventory_transaction_seq') AS a, nextval('fuel_inventory_transaction_seq') AS b`);
    const buat = async (type, direction, srcLoc, dstLoc, nomor, idemKey = null) => {
      const head = await client.query(
        `INSERT INTO fuel_inventory_transactions
          (transaction_number, transaction_type, operational_date, product_id,
           source_location_id, destination_location_id, transfer_group_id,
           status, source_type, reason, idempotency_key, created_by)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,'draft',$8,$9,$10,$11) RETURNING *`,
        [nomor, type, tanggal, input.product_id, srcLoc, dstLoc, groupId,
          input.source_type || 'manual', input.reason || null, idemKey, actorId]);
      await client.query(
        `INSERT INTO fuel_inventory_lines (transaction_id, direction, quantity_liter, unit_price)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [head.rows[0].id, direction, qty, input.unit_price == null ? null : Number(input.unit_price)]);
      return head.rows[0];
    };
    const keluar = await buat('transfer_out', 'out', input.from_location_id, null,
      nomorTransaksi(seqAwal.rows[0].a, tanggal), input.idempotency_key || null);
    const masuk = await buat('transfer_in', 'in', null, input.to_location_id,
      nomorTransaksi(seqAwal.rows[0].b, tanggal), null);
    // Bukti transfer (surat jalan, flow meter) melekat pada kaki keluar.
    await tautkanBukti(client, { entityType: 'transaction', entityId: keluar.id, transactionType: 'transfer_out', input, user, actorId, table: 'fuel_inventory_transactions' });
    if (opts.asDraft) {
      // APK: transfer menunggu validasi admin; stok belum berpindah sampai grup diposting.
      await client.query(`UPDATE fuel_inventory_transactions SET device_id = $2, mobile_flags = $3::jsonb
        WHERE transfer_group_id = $1`, [groupId, opts.deviceId || null, JSON.stringify(opts.flags || [])]);
      await client.query('COMMIT');
      return { duplicate: false, status: 'draft', transfer_group_id: groupId, transactions: [keluar.id, masuk.id] };
    }
    await postTransferLegs(client, keluar, masuk, input.unit_price, actorId);
    await client.query('COMMIT');
    return { duplicate: false, transfer_group_id: groupId, transactions: [keluar.id, masuk.id] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Posting kedua kaki transfer (keluar lalu masuk) di dalam transaksi DB pemanggil. */
async function postTransferLegs(client, keluar, masuk, unitPrice, actorId) {
  for (const header of [keluar, masuk]) {
    const penuh = await ambilTransaksi(client, header.id, true);
    validasiInput({ transaction_type: penuh.transaction_type, operational_date: tglIso(penuh.operational_date),
      product_id: penuh.product_id, source_location_id: penuh.source_location_id,
      destination_location_id: penuh.destination_location_id, equipment_id: penuh.equipment_id, lines: penuh.lines });
    const posted = await client.query(
      `UPDATE fuel_inventory_transactions SET status = 'posted', posted_by = $2, posted_at = CURRENT_TIMESTAMP,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [header.id, actorId]);
    await tulisAudit(client, { entityType: 'transaction', entityId: header.id, action: 'post', before: penuh, after: posted.rows[0] || header, actorId });
    await prosesFifoPosting(client, { ...header, source_location_id: penuh.source_location_id,
      destination_location_id: penuh.destination_location_id, product_id: penuh.product_id,
      transaction_at: penuh.transaction_at });
    if (header.id === keluar.id) {
      // Kaki masuk membawa cost snapshot rata-rata tertimbang asal FIFO.
      const ag = await client.query(
        `SELECT COALESCE(SUM(a.allocated_quantity * a.unit_cost_snapshot), 0) AS nilai,
                COALESCE(SUM(a.allocated_quantity), 0) AS qty
         FROM fuel_fifo_allocations a JOIN fuel_inventory_lines l ON l.id = a.outbound_line_id
         WHERE l.transaction_id = $1 AND a.unit_cost_snapshot IS NOT NULL`,
        [keluar.id]);
      const qty = Number(ag.rows[0]?.qty || 0);
      await client.query(`UPDATE fuel_inventory_lines SET unit_price = $2 WHERE transaction_id = $1`,
        [masuk.id, qty > 0 ? Number(ag.rows[0].nilai) / qty : (unitPrice == null ? null : Number(unitPrice))]);
    }
  }
}

async function kakiTransfer(client, groupId) {
  const r = await client.query(
    `SELECT * FROM fuel_inventory_transactions WHERE transfer_group_id = $1 ORDER BY transaction_type DESC FOR UPDATE`, [groupId]);
  const keluar = r.rows.find(x => x.transaction_type === 'transfer_out');
  const masuk = r.rows.find(x => x.transaction_type === 'transfer_in');
  if (!keluar || !masuk) throw err('Grup transfer tidak lengkap.', 404);
  return { keluar, masuk };
}

/** Validasi transfer dari APK: posting kedua kaki secara atomik. */
async function postTransferGroup(groupId, actorId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { keluar, masuk } = await kakiTransfer(client, groupId);
    if (keluar.status !== 'draft' || masuk.status !== 'draft') {
      throw err(`Transfer bukan draft (status: ${keluar.status}/${masuk.status}).`, 422);
    }
    await postTransferLegs(client, keluar, masuk, null, actorId);
    await client.query('COMMIT');
    return { transfer_group_id: groupId, status: 'posted', transactions: [keluar.id, masuk.id] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Tolak transfer draft: kedua kaki void dengan alasan (dikirim balik ke APK). */
async function voidTransferGroup(groupId, actorId = null, reason = '') {
  if (!String(reason || '').trim()) throw err('Alasan penolakan wajib diisi.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { keluar, masuk } = await kakiTransfer(client, groupId);
    if (keluar.status !== 'draft' || masuk.status !== 'draft') throw err('Hanya transfer draft yang dapat ditolak.', 422);
    for (const row of [keluar, masuk]) {
      const hasil = await client.query(`UPDATE fuel_inventory_transactions SET status = 'void', void_reason = $2,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`, [row.id, String(reason).trim()]);
      await tulisAudit(client, { entityType: 'transaction', entityId: row.id, action: 'void', before: row, after: hasil.rows[0], reason, actorId });
    }
    await client.query('COMMIT');
    return { transfer_group_id: groupId, status: 'void' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getFifoLayers({ location_id = null, product_id = null, status = 'open' } = {}) {
  const clauses = [];
  const params = [];
  if (location_id) { params.push(location_id); clauses.push(`location_id = $${params.length}::uuid`); }
  if (product_id) { params.push(product_id); clauses.push(`product_id = $${params.length}::uuid`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  const hasil = await pool.query(
    `SELECT l.*, p.product_code, s.location_code FROM fuel_fifo_layers l
     LEFT JOIN fuel_products p ON p.id = l.product_id
     LEFT JOIN fuel_storage_locations s ON s.id = l.location_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY received_at, id`,
    params);
  return hasil.rows;
}

async function getAllocations({ outbound_line_id = null, transaction_id = null } = {}) {
  if (!outbound_line_id && !transaction_id) throw err('outbound_line_id atau transaction_id wajib diisi.');
  const hasil = await pool.query(
    `SELECT a.*, l.location_code, p.product_code FROM fuel_fifo_allocations a
     JOIN fuel_inventory_lines ol ON ol.id = a.outbound_line_id
     JOIN fuel_inventory_transactions t ON t.id = ol.transaction_id
     LEFT JOIN fuel_fifo_layers fl ON fl.id = a.fifo_layer_id
     LEFT JOIN fuel_storage_locations l ON l.id = fl.location_id
     LEFT JOIN fuel_products p ON p.id = fl.product_id
     WHERE ($1::uuid IS NULL OR a.outbound_line_id = $1::uuid)
       AND ($2::uuid IS NULL OR t.id = $2::uuid)
     ORDER BY a.created_at`,
    [outbound_line_id, transaction_id]);
  return hasil.rows;
}

/* ---------------- P4: stock opname ---------------- */
/* Opname tidak menimpa ledger. Snapshot buku dicatat saat hitung; approval
   membuat satu transaksi adjustment (in/out) yang tertaut ke opname.
   Maker-checker: penghitung tidak boleh menyetujui opname sendiri.
   Status 'approved' dicadangkan untuk alur approve-post terpisah di masa
   depan; approve saat ini langsung 'adjusted' dalam satu transaksi DB. */
const OPNAME_ALERT_PCT = 2;

function hitungVariance(book, physical) {
  const variance = Number(physical) - Number(book);
  const pct = Math.abs(Number(book)) < 1e-9 ? null : (variance / Number(book)) * 100;
  const alert = pct == null ? Math.abs(variance) > 1e-9 : Math.abs(pct) > OPNAME_ALERT_PCT + 1e-9;
  return { variance_quantity: variance, variance_percent: pct, variance_alert: alert };
}

async function ambilOpname(db, id, forUpdate = false) {
  const hasil = await db.query(
    `SELECT * FROM fuel_stock_opnames WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return hasil.rows[0] || null;
}

async function createOpname(input = {}, actorId = null, user = null) {
  if (!input.location_id) throw err('Lokasi opname wajib diisi.');
  if (!input.product_id) throw err('Produk opname wajib diisi.');
  const tanggal = String(input.operational_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw err('Tanggal operasional wajib (YYYY-MM-DD).');
  const fisik = Number(input.physical_quantity);
  if (!Number.isFinite(fisik) || fisik < 0) throw err('Quantity fisik harus angka ≥ 0 Liter.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const aktif = await client.query(
      `SELECT id FROM fuel_stock_opnames WHERE location_id = $1 AND product_id = $2
       AND status IN ('draft', 'submitted') LIMIT 1`,
      [input.location_id, input.product_id]);
    if (aktif.rows.length) throw err('Sudah ada opname aktif untuk lokasi+produk ini.', 409);
    const buku = await saldoLokasi(client, input.location_id, input.product_id);
    const v = hitungVariance(buku, fisik);
    const hasil = await client.query(
      `INSERT INTO fuel_stock_opnames
        (location_id, product_id, operational_date, book_quantity_snapshot, physical_quantity,
         variance_quantity, variance_percent, variance_alert,
         measurement_method, evidence_url, note, status, counted_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12) RETURNING *`,
      [input.location_id, input.product_id, tanggal, buku, fisik,
        v.variance_quantity, v.variance_percent, v.variance_alert,
        input.measurement_method || null, input.evidence_url || null, input.note || null, actorId]);
    await tautkanBukti(client, { entityType: 'opname', entityId: hasil.rows[0].id, input, user, actorId, table: 'fuel_stock_opnames' });
    await tulisAudit(client, { entityType: 'stock_opname', entityId: hasil.rows[0].id, action: 'opname_create', after: hasil.rows[0], actorId });
    await client.query('COMMIT');
    return hasil.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateOpnameDraft(id, input = {}, actorId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await ambilOpname(client, id, true);
    if (!row) throw err('Opname tidak ditemukan.', 404);
    if (row.status !== 'draft') throw err(`Hanya draft yang dapat diubah (status: ${row.status}).`, 422);
    const tanggal = input.operational_date == null ? tglIso(row.operational_date) : String(input.operational_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw err('Tanggal operasional wajib (YYYY-MM-DD).');
    const fisik = input.physical_quantity == null ? Number(row.physical_quantity) : Number(input.physical_quantity);
    if (!Number.isFinite(fisik) || fisik < 0) throw err('Quantity fisik harus angka ≥ 0 Liter.');
    const buku = await saldoLokasi(client, row.location_id, row.product_id);
    const v = hitungVariance(buku, fisik);
    const hasil = await client.query(
      `UPDATE fuel_stock_opnames SET operational_date = $2::date, book_quantity_snapshot = $3,
        physical_quantity = $4, variance_quantity = $5, variance_percent = $6, variance_alert = $7,
        measurement_method = $8, evidence_url = $9, note = $10,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id, tanggal, buku, fisik, v.variance_quantity, v.variance_percent, v.variance_alert,
        input.measurement_method === undefined ? row.measurement_method : (input.measurement_method || null),
        input.evidence_url === undefined ? row.evidence_url : (input.evidence_url || null),
        input.note === undefined ? row.note : (input.note || null)]);
    await tulisAudit(client, { entityType: 'stock_opname', entityId: id, action: 'opname_update', before: row, after: hasil.rows[0], actorId });
    await client.query('COMMIT');
    return hasil.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function submitOpname(id, actorId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await ambilOpname(client, id, true);
    if (!row) throw err('Opname tidak ditemukan.', 404);
    if (row.status !== 'draft') throw err(`Hanya draft yang dapat disubmit (status: ${row.status}).`, 422);
    const hasil = await client.query(
      `UPDATE fuel_stock_opnames SET status = 'submitted', submitted_by = $2,
        submitted_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id, actorId]);
    await tulisAudit(client, { entityType: 'stock_opname', entityId: id, action: 'opname_submit', before: row, after: hasil.rows[0], actorId });
    await client.query('COMMIT');
    return hasil.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function approveOpname(id, actorId = null, opsi = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await ambilOpname(client, id, true);
    if (!row) throw err('Opname tidak ditemukan.', 404);
    if (row.status !== 'submitted') throw err(`Hanya opname submitted yang dapat disetujui (status: ${row.status}).`, 422);
    if (String(row.counted_by || '') === String(actorId || '') && (row.counted_by || actorId)) {
      throw err('Petugas penghitung tidak boleh menyetujui opname sendiri (maker-checker).', 403);
    }
    const catatan = String(opsi.note || '').trim();
    if (row.variance_alert && !catatan) {
      throw err(`Variance di atas ambang ${OPNAME_ALERT_PCT}% wajib disertai alasan approval.`, 422);
    }
    // Konflik approval: buku berubah sejak penghitungan → tolak, buat opname baru.
    const bukuKini = await saldoLokasi(client, row.location_id, row.product_id);
    if (Math.abs(bukuKini - Number(row.book_quantity_snapshot)) > 1e-9) {
      throw err('Stok buku berubah sejak penghitungan; approval ditolak, buat opname baru.', 409);
    }
    const selisih = Number(row.variance_quantity);
    let adjustmentId = null;
    if (Math.abs(selisih) > 1e-9) {
      const masuk = selisih > 0;
      const type = masuk ? 'opname_adjustment_in' : 'opname_adjustment_out';
      const qty = Math.abs(selisih);
      let harga = null;
      if (masuk && opsi.unit_price != null) {
        if (!(Number(opsi.unit_price) >= 0)) throw err('Harga adjustment tidak valid.');
        harga = Number(opsi.unit_price);
      }
      const tanggal = tglIso(row.operational_date);
      const seq = await client.query(`SELECT nextval('fuel_inventory_transaction_seq') AS seq`);
      const alasan = `Opname ${row.id} (${masuk ? '+' : '-'}${qty} L)${catatan ? `: ${catatan}` : ''}`;
      const head = await client.query(
        `INSERT INTO fuel_inventory_transactions
          (transaction_number, transaction_type, operational_date, product_id,
           source_location_id, destination_location_id,
           status, source_type, reason, created_by, posted_by, posted_at)
         VALUES ($1,$2,$3::date,$4,$5,$6,'posted','stock_opname',$7,$8,$8,CURRENT_TIMESTAMP)
         RETURNING *`,
        [nomorTransaksi(seq.rows[0].seq, tanggal), type, tanggal, row.product_id,
          masuk ? null : row.location_id, masuk ? row.location_id : null, alasan, actorId]);
      const header = head.rows[0];
      await client.query(
        `INSERT INTO fuel_inventory_lines (transaction_id, direction, quantity_liter, unit_price)
         VALUES ($1,$2,$3,$4)`,
        [header.id, masuk ? 'in' : 'out', qty, harga]);
      // Adjustment-out mengonsumsi FIFO tertua (blokir bila tak cukup);
      // adjustment-in membuka layer baru (cost eksplisit atau NULL = tak diketahui,
      // tidak pernah di-average).
      await prosesFifoPosting(client, {
        ...header,
        source_location_id: masuk ? null : row.location_id,
        destination_location_id: masuk ? row.location_id : null,
        product_id: row.product_id,
      });
      await tulisAudit(client, { entityType: 'transaction', entityId: header.id, action: 'post', after: header, reason: alasan, actorId });
      adjustmentId = header.id;
    }
    const hasil = await client.query(
      `UPDATE fuel_stock_opnames SET status = 'adjusted', approved_by = $2,
        approved_at = CURRENT_TIMESTAMP, note = $3, adjustment_transaction_id = $4,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id, actorId, catatan || row.note, adjustmentId]);
    await tulisAudit(client, { entityType: 'stock_opname', entityId: id, action: 'opname_approve', before: row, after: hasil.rows[0], reason: catatan, actorId });
    await client.query('COMMIT');
    return hasil.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function rejectOpname(id, actorId = null, reason = '') {
  if (!String(reason || '').trim()) throw err('Alasan reject wajib diisi.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await ambilOpname(client, id, true);
    if (!row) throw err('Opname tidak ditemukan.', 404);
    if (row.status !== 'submitted') throw err(`Hanya opname submitted yang dapat direject (status: ${row.status}).`, 422);
    const hasil = await client.query(
      `UPDATE fuel_stock_opnames SET status = 'rejected', reject_reason = $2,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id, String(reason).trim()]);
    await tulisAudit(client, { entityType: 'stock_opname', entityId: id, action: 'opname_reject', before: row, after: hasil.rows[0], reason, actorId });
    await client.query('COMMIT');
    return hasil.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function listOpnames({ location_id = null, product_id = null, status = null, limit = 200 } = {}) {
  const clauses = [];
  const params = [];
  if (location_id) { params.push(location_id); clauses.push(`location_id = $${params.length}::uuid`); }
  if (product_id) { params.push(product_id); clauses.push(`product_id = $${params.length}::uuid`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  params.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
  const hasil = await pool.query(
    `SELECT * FROM fuel_stock_opnames
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY operational_date DESC, created_at DESC LIMIT $${params.length}`,
    params);
  return hasil.rows;
}

async function getOpname(id) {
  const row = await ambilOpname(pool, id);
  if (!row) throw err('Opname tidak ditemukan.', 404);
  return row;
}

/* ---------------- P5: agregasi server + export ---------------- */
/* Browser tidak pernah memuat seluruh ledger: KPI/chart/tabel memakai
   endpoint agregat ini. Versi formula dicantumkan di setiap ringkasan dan
   file export. ADU memakai basis hari kalender (keputusan P0, terkunci). */
const FUEL_FORMULA_VERSION = 'v1';

async function getStockSummary({ location_id = null, product_id = null } = {}) {
  const hasil = await pool.query(
    `/* fuel_stock_summary */
     WITH combo AS (
       SELECT t.destination_location_id AS location_id, t.product_id
       FROM fuel_inventory_transactions t
       WHERE t.destination_location_id IS NOT NULL AND t.status IN ('posted', 'reversed')
       UNION
       SELECT t.source_location_id, t.product_id
       FROM fuel_inventory_transactions t
       WHERE t.source_location_id IS NOT NULL AND t.status IN ('posted', 'reversed')
       UNION
       SELECT f.location_id, f.product_id FROM fuel_fifo_layers f
     )
     SELECT c.location_id, sl.location_code, sl.location_name,
            c.product_id, p.product_code,
       COALESCE((SELECT SUM(CASE
          WHEN li.direction = 'in' AND t.destination_location_id = c.location_id THEN li.quantity_liter
          WHEN li.direction = 'out' AND t.source_location_id = c.location_id THEN -li.quantity_liter
          ELSE 0 END)
        FROM fuel_inventory_lines li JOIN fuel_inventory_transactions t ON t.id = li.transaction_id
        WHERE t.status IN ('posted', 'reversed')
          AND (t.source_location_id = c.location_id OR t.destination_location_id = c.location_id)
          AND t.product_id = c.product_id), 0) AS balance_liter,
       COALESCE((SELECT SUM(f.remaining_quantity) FROM fuel_fifo_layers f
        WHERE f.location_id = c.location_id AND f.product_id = c.product_id
          AND f.status IN ('open', 'exhausted')), 0) AS fifo_liter,
       COALESCE((SELECT SUM(f.remaining_quantity * f.unit_cost) FROM fuel_fifo_layers f
        WHERE f.location_id = c.location_id AND f.product_id = c.product_id
          AND f.status IN ('open', 'exhausted') AND f.unit_cost IS NOT NULL), 0) AS fifo_value_idr,
       (SELECT COUNT(*) FROM fuel_fifo_layers f
        WHERE f.location_id = c.location_id AND f.product_id = c.product_id AND f.status = 'open') AS open_layers,
       (SELECT COUNT(*) FROM fuel_fifo_layers f
        WHERE f.location_id = c.location_id AND f.product_id = c.product_id
          AND f.status IN ('open', 'exhausted') AND f.remaining_quantity > 0 AND f.unit_cost IS NULL) AS unknown_cost_layers
     FROM combo c
     LEFT JOIN fuel_storage_locations sl ON sl.id = c.location_id
     LEFT JOIN fuel_products p ON p.id = c.product_id
     WHERE ($1::uuid IS NULL OR c.location_id = $1::uuid)
       AND ($2::uuid IS NULL OR c.product_id = $2::uuid)
     ORDER BY sl.location_code, p.product_code`,
    [location_id, product_id]);
  return hasil.rows.map(r => ({
    ...r,
    balance_liter: Number(r.balance_liter || 0),
    fifo_liter: Number(r.fifo_liter || 0),
    fifo_value_idr: Number(r.fifo_value_idr || 0),
    open_layers: Number(r.open_layers || 0),
    unknown_cost_layers: Number(r.unknown_cost_layers || 0),
  }));
}

async function getFlowSeries({ dari = null, sampai = null, location_id = null, product_id = null } = {}) {
  const hasil = await pool.query(
    `/* fuel_flow_series */
     SELECT t.operational_date::text AS tanggal,
       COALESCE(SUM(CASE WHEN li.direction = 'in'
         AND ($1::uuid IS NULL OR t.destination_location_id = $1::uuid)
         THEN li.quantity_liter ELSE 0 END), 0) AS masuk,
       COALESCE(SUM(CASE WHEN li.direction = 'out'
         AND ($1::uuid IS NULL OR t.source_location_id = $1::uuid)
         THEN li.quantity_liter ELSE 0 END), 0) AS keluar,
       COALESCE(SUM(CASE WHEN li.direction = 'out' AND t.transaction_type = 'issue_equipment'
         AND ($1::uuid IS NULL OR t.source_location_id = $1::uuid)
         THEN li.quantity_liter ELSE 0 END), 0) AS issue,
       COALESCE(SUM(CASE WHEN li.direction = 'out' AND t.transaction_type = 'transfer_out'
         AND ($1::uuid IS NULL OR t.source_location_id = $1::uuid)
         THEN li.quantity_liter ELSE 0 END), 0) AS transfer_out,
       COALESCE(SUM(CASE WHEN li.direction = 'in' AND t.transaction_type = 'transfer_in'
         AND ($1::uuid IS NULL OR t.destination_location_id = $1::uuid)
         THEN li.quantity_liter ELSE 0 END), 0) AS transfer_in
     FROM fuel_inventory_lines li
     JOIN fuel_inventory_transactions t ON t.id = li.transaction_id
     WHERE t.status IN ('posted', 'reversed')
       AND ($3::date IS NULL OR t.operational_date >= $3::date)
       AND ($4::date IS NULL OR t.operational_date <= $4::date)
       AND ($1::uuid IS NULL OR t.source_location_id = $1::uuid OR t.destination_location_id = $1::uuid)
       AND ($2::uuid IS NULL OR t.product_id = $2::uuid)
     GROUP BY t.operational_date ORDER BY t.operational_date`,
    [location_id, product_id, dari, sampai]);
  return hasil.rows.map(r => ({
    tanggal: r.tanggal,
    masuk: Number(r.masuk || 0),
    keluar: Number(r.keluar || 0),
    issue: Number(r.issue || 0),
    transfer_in: Number(r.transfer_in || 0),
    transfer_out: Number(r.transfer_out || 0),
  }));
}

async function getUsageStats({ dari = null, sampai = null, location_id = null, product_id = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dari || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(sampai || ''))) {
    throw err('Rentang tanggal (dari/sampai YYYY-MM-DD) wajib diisi.');
  }
  if (String(dari) > String(sampai)) throw err('Tanggal dari tidak boleh setelah sampai.', 422);
  const dayCount = Math.round((new Date(`${sampai}T00:00:00Z`) - new Date(`${dari}T00:00:00Z`)) / 86400000) + 1;
  const total = await pool.query(
    `/* fuel_usage_issue_total */
     SELECT COALESCE(SUM(li.quantity_liter), 0) AS total
     FROM fuel_inventory_lines li
     JOIN fuel_inventory_transactions t ON t.id = li.transaction_id
     WHERE t.transaction_type = 'issue_equipment' AND li.direction = 'out'
       AND t.status IN ('posted', 'reversed')
       AND t.operational_date >= $3::date AND t.operational_date <= $4::date
       AND ($1::uuid IS NULL OR t.source_location_id = $1::uuid)
       AND ($2::uuid IS NULL OR t.product_id = $2::uuid)`,
    [location_id, product_id, dari, sampai]);
  const totalIssue = Number(total.rows[0]?.total || 0);
  const closing = location_id ? await getBalance({ location_id, product_id }) : null;
  const adu = dayCount > 0 ? totalIssue / dayCount : 0;
  return {
    dari, sampai, day_count: dayCount, total_issue_liter: totalIssue,
    adu_liter_per_day: adu, closing_stock_liter: closing,
    days_of_stock: adu > 0 && closing != null ? closing / adu : null,
    basis: 'calendar', formula_version: FUEL_FORMULA_VERSION,
  };
}

const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

function validasiRentang(dari, sampai) {
  if (!TANGGAL_RE.test(String(dari || '')) || !TANGGAL_RE.test(String(sampai || ''))) {
    throw err('Rentang tanggal (dari/sampai YYYY-MM-DD) wajib diisi.');
  }
  if (String(dari) > String(sampai)) throw err('Tanggal dari tidak boleh setelah sampai.', 422);
}

/*
 * Mutasi bertanda per lokasi: baris 'in' dihitung di lokasi tujuan (+), 'out' di lokasi sumber (−).
 * Reversal dikategorikan ke tipe transaksi aslinya sehingga kategori menjadi netto
 * (issue yang direversal mengurangi issue, bukan menambah "masuk").
 */
const MUTASI_CTE = `
  mutasi AS (
    SELECT CASE WHEN li.direction = 'in' THEN t.destination_location_id ELSE t.source_location_id END AS location_id,
           t.product_id, t.operational_date, t.equipment_id,
           CASE WHEN t.transaction_type = 'reversal' THEN o.transaction_type ELSE t.transaction_type END AS tipe,
           CASE WHEN li.direction = 'in' THEN li.quantity_liter ELSE -li.quantity_liter END AS delta
    FROM fuel_inventory_lines li
    JOIN fuel_inventory_transactions t ON t.id = li.transaction_id
    LEFT JOIN fuel_inventory_transactions o ON o.id = t.reversal_of_transaction_id
    WHERE t.status IN ('posted', 'reversed')
  )`;

/** Fungsi murni: susun baris rekonsiliasi dari agregat delta per tipe (liter, presisi penuh). */
function susunRekonsiliasi(row) {
  const n = v => Number(v || 0);
  const opening = n(row.opening);
  const receipt_in = n(row.d_receipt);
  const transfer_in = n(row.d_transfer_in);
  const issue_out = -n(row.d_issue);
  const transfer_out = -n(row.d_transfer_out);
  const adjustment_in = n(row.d_adj_in);
  const adjustment_out = -n(row.d_adj_out);
  const other = n(row.d_other);
  const closing_book = opening + receipt_in + transfer_in - issue_out - transfer_out + adjustment_in - adjustment_out + other;
  const opname = row.opname_id ? {
    id: row.opname_id,
    operational_date: row.opname_date,
    book_quantity: n(row.opname_book),
    physical_quantity: n(row.opname_physical),
    variance_quantity: n(row.opname_variance),
    variance_percent: row.opname_variance_pct == null ? null : Number(row.opname_variance_pct),
    variance_alert: Boolean(row.opname_alert),
    status: row.opname_status,
  } : null;
  return {
    location_id: row.location_id, location_code: row.location_code, location_name: row.location_name,
    storage_type: row.storage_type, capacity_liter: row.capacity_liter == null ? null : Number(row.capacity_liter),
    product_id: row.product_id, product_code: row.product_code,
    opening, receipt_in, transfer_in, issue_out, transfer_out, adjustment_in, adjustment_out, other, closing_book,
    last_opname: opname,
  };
}

/**
 * Rekonsiliasi periode per lokasi×produk:
 * Saldo Awal + Penerimaan + Transfer Masuk − Pengisian Unit − Transfer Keluar + Penyesuaian ± Lainnya = Saldo Buku,
 * dibandingkan opname fisik terakhir (approved/adjusted) s.d. tanggal akhir. Basis operational_date, liter.
 */
async function getPeriodReconciliation({ dari = null, sampai = null, location_id = null, product_id = null } = {}) {
  validasiRentang(dari, sampai);
  const hasil = await pool.query(
    `/* fuel_period_reconciliation */
     WITH ${MUTASI_CTE},
     agg AS (
       SELECT location_id, product_id,
         SUM(CASE WHEN operational_date < $1::date THEN delta ELSE 0 END) AS opening,
         SUM(CASE WHEN operational_date >= $1::date AND tipe = 'receipt' THEN delta ELSE 0 END) AS d_receipt,
         SUM(CASE WHEN operational_date >= $1::date AND tipe = 'transfer_in' THEN delta ELSE 0 END) AS d_transfer_in,
         SUM(CASE WHEN operational_date >= $1::date AND tipe = 'issue_equipment' THEN delta ELSE 0 END) AS d_issue,
         SUM(CASE WHEN operational_date >= $1::date AND tipe = 'transfer_out' THEN delta ELSE 0 END) AS d_transfer_out,
         SUM(CASE WHEN operational_date >= $1::date AND tipe = 'opname_adjustment_in' THEN delta ELSE 0 END) AS d_adj_in,
         SUM(CASE WHEN operational_date >= $1::date AND tipe = 'opname_adjustment_out' THEN delta ELSE 0 END) AS d_adj_out,
         SUM(CASE WHEN operational_date >= $1::date AND tipe NOT IN ('receipt','transfer_in','issue_equipment',
           'transfer_out','opname_adjustment_in','opname_adjustment_out') THEN delta ELSE 0 END) AS d_other
       FROM mutasi
       WHERE operational_date <= $2::date AND location_id IS NOT NULL
         AND ($3::uuid IS NULL OR location_id = $3::uuid)
         AND ($4::uuid IS NULL OR product_id = $4::uuid)
       GROUP BY location_id, product_id
     )
     SELECT a.*, sl.location_code, sl.location_name, sl.storage_type, sl.capacity_liter, p.product_code,
            op.id AS opname_id, op.operational_date::text AS opname_date, op.book_quantity_snapshot AS opname_book,
            op.physical_quantity AS opname_physical, op.variance_quantity AS opname_variance,
            op.variance_percent AS opname_variance_pct, op.variance_alert AS opname_alert, op.status AS opname_status
     FROM agg a
     LEFT JOIN fuel_storage_locations sl ON sl.id = a.location_id
     LEFT JOIN fuel_products p ON p.id = a.product_id
     LEFT JOIN LATERAL (
       SELECT * FROM fuel_stock_opnames so
       WHERE so.location_id = a.location_id AND so.product_id = a.product_id
         AND so.status IN ('approved', 'adjusted') AND so.operational_date <= $2::date
       ORDER BY so.operational_date DESC, so.counted_at DESC LIMIT 1
     ) op ON TRUE
     ORDER BY sl.location_code, p.product_code`,
    [dari, sampai, location_id, product_id]);
  const rows = hasil.rows.map(susunRekonsiliasi);
  const total = rows.reduce((acc, r) => {
    for (const k of ['opening', 'receipt_in', 'transfer_in', 'issue_out', 'transfer_out', 'adjustment_in', 'adjustment_out', 'other', 'closing_book']) acc[k] += r[k];
    return acc;
  }, { opening: 0, receipt_in: 0, transfer_in: 0, issue_out: 0, transfer_out: 0, adjustment_in: 0, adjustment_out: 0, other: 0, closing_book: 0 });
  return { dari, sampai, rows, total, alert_pct: OPNAME_ALERT_PCT, basis: 'operational_date', unit: 'liter', formula_version: FUEL_FORMULA_VERSION };
}

/** Konsumsi (liter netto issue_equipment) per unit atau kelas alat; tanpa rasio L/HM. */
async function getConsumptionBreakdown({ dari = null, sampai = null, location_id = null, product_id = null, group = 'unit', limit = 10 } = {}) {
  validasiRentang(dari, sampai);
  const byClass = group === 'class';
  const batas = Math.max(1, Math.min(200, Number(limit) || 10));
  const hasil = await pool.query(
    `/* fuel_consumption_breakdown */
     WITH ${MUTASI_CTE}
     SELECT ${byClass ? `COALESCE(NULLIF(TRIM(e.kelas_alat), ''), 'Tanpa kelas') AS key, COALESCE(NULLIF(TRIM(e.kelas_alat), ''), 'Tanpa kelas') AS label, NULL::text AS kelas,
            COUNT(DISTINCT m.equipment_id) AS unit_count`
    : `m.equipment_id::text AS key, COALESCE(e.kode_alat, 'Unit tidak dikenal') AS label, e.kelas_alat AS kelas, 1 AS unit_count`},
            -SUM(m.delta) AS liter
     FROM mutasi m
     LEFT JOIN equipment e ON e.id = m.equipment_id
     WHERE m.tipe = 'issue_equipment'
       AND m.operational_date >= $1::date AND m.operational_date <= $2::date
       AND ($3::uuid IS NULL OR m.location_id = $3::uuid)
       AND ($4::uuid IS NULL OR m.product_id = $4::uuid)
     GROUP BY ${byClass ? '1, 2' : 'm.equipment_id, e.kode_alat, e.kelas_alat'}
     HAVING ABS(SUM(m.delta)) > 1e-9
     ORDER BY liter DESC`,
    [dari, sampai, location_id, product_id]);
  const semua = hasil.rows.map(r => ({ key: r.key, label: r.label, kelas: r.kelas || null,
    unit_count: Number(r.unit_count || 0), liter: Number(r.liter || 0) }));
  const total = semua.reduce((s, r) => s + r.liter, 0);
  const items = semua.slice(0, batas).map(r => ({ ...r, share: total > 0 ? r.liter / total : 0 }));
  const others = semua.slice(batas).reduce((s, r) => s + r.liter, 0);
  return { dari, sampai, group: byClass ? 'class' : 'unit', items, others_liter: others, total_liter: total,
    unit: 'liter', formula_version: FUEL_FORMULA_VERSION };
}

function csvSel(daftar) {
  return daftar.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

async function buildExport({ type = 'ledger', dari = null, sampai = null, location_id = null, product_id = null, status = null } = {}) {
  const filter = { dari, sampai, location_id, product_id, status };
  const kepala = [
    `# Database Fuel export — ${type}`,
    `# generated_at: ${new Date().toISOString()}`,
    '# unit: L (observed Liter)',
    `# formula_version: ${FUEL_FORMULA_VERSION}`,
    `# filters: ${JSON.stringify(filter)}`,
  ];
  let kolom = [];
  let baris = [];
  if (type === 'summary') {
    kolom = ['location_code', 'location_name', 'product_code', 'balance_liter', 'fifo_liter', 'fifo_value_idr', 'open_layers', 'unknown_cost_layers'];
    baris = (await getStockSummary({ location_id, product_id })).map(r => kolom.map(k => r[k]));
  } else if (type === 'flow') {
    kolom = ['tanggal', 'masuk_liter', 'keluar_liter', 'issue_liter'];
    baris = (await getFlowSeries({ dari, sampai, location_id, product_id })).map(r => [r.tanggal, r.masuk, r.keluar, r.issue]);
  } else if (type === 'opnames') {
    kolom = ['id', 'operational_date', 'location_id', 'product_id', 'book_quantity_snapshot', 'physical_quantity', 'variance_quantity', 'variance_percent', 'variance_alert', 'status'];
    baris = (await listOpnames({ location_id, product_id, status, limit: 1000 })).map(r => kolom.map(k => r[k]));
  } else {
    kolom = ['operational_date', 'transaction_number', 'transaction_type', 'status', 'source_code', 'destination_code', 'product_code', 'running_balance_liter'];
    const data = await getLedger({ dari, sampai, location_id, product_id, status, limit: 5000, cap: 5000 });
    baris = data.map(r => [tglIso(r.operational_date), r.transaction_number,
      r.transaction_type, r.status, r.source_code, r.destination_code, r.product_code, Number(r.running_balance || 0)]);
  }
  const tanggal = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return {
    filename: `database-fuel-${type}-${tanggal}.csv`,
    csv: `${kepala.join('\n')}\n${csvSel(kolom)}\n${baris.map(csvSel).join('\n')}\n`,
  };
}

/* ---------------- P6: laporan integritas 4 pasangan ---------------- */
/* Rekonsiliasi pra-rilis: ledger vs FIFO, transfer out vs in, adjustment vs
   opname, issue vs Input Fuel. Hanya membaca; tidak menulis koreksi. */
async function getIntegrityReport({ limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const ledgerFifo = (await pool.query(
    `/* fuel_integrity_ledger_fifo */
     WITH combo AS (
       SELECT t.destination_location_id AS location_id, t.product_id
       FROM fuel_inventory_transactions t
       WHERE t.destination_location_id IS NOT NULL AND t.status IN ('posted', 'reversed')
       UNION
       SELECT t.source_location_id, t.product_id
       FROM fuel_inventory_transactions t
       WHERE t.source_location_id IS NOT NULL AND t.status IN ('posted', 'reversed')
       UNION
       SELECT f.location_id, f.product_id FROM fuel_fifo_layers f
     ),
     angka AS (
       SELECT c.location_id, sl.location_code, c.product_id, p.product_code,
         COALESCE((SELECT SUM(CASE
            WHEN li.direction = 'in' AND t.destination_location_id = c.location_id THEN li.quantity_liter
            WHEN li.direction = 'out' AND t.source_location_id = c.location_id THEN -li.quantity_liter
            ELSE 0 END)
          FROM fuel_inventory_lines li JOIN fuel_inventory_transactions t ON t.id = li.transaction_id
          WHERE t.status IN ('posted', 'reversed')
            AND (t.source_location_id = c.location_id OR t.destination_location_id = c.location_id)
            AND t.product_id = c.product_id), 0) AS balance_liter,
         COALESCE((SELECT SUM(f.remaining_quantity) FROM fuel_fifo_layers f
          WHERE f.location_id = c.location_id AND f.product_id = c.product_id
            AND f.status IN ('open', 'exhausted')), 0) AS fifo_liter
       FROM combo c
       LEFT JOIN fuel_storage_locations sl ON sl.id = c.location_id
       LEFT JOIN fuel_products p ON p.id = c.product_id
     )
     SELECT * FROM angka WHERE ABS(balance_liter - fifo_liter) > 0.001
     ORDER BY location_code, product_code LIMIT $1`,
    [lim])).rows;
  const transfers = (await pool.query(
    `/* fuel_integrity_transfers */
     SELECT t.transfer_group_id,
       COUNT(*) AS legs,
       SUM(CASE WHEN t.transaction_type = 'transfer_out' THEN 1 ELSE 0 END) AS out_legs,
       SUM(CASE WHEN t.transaction_type = 'transfer_in' THEN 1 ELSE 0 END) AS in_legs,
       COALESCE(SUM(CASE WHEN li.direction = 'out' THEN li.quantity_liter ELSE 0 END), 0) AS out_qty,
       COALESCE(SUM(CASE WHEN li.direction = 'in' THEN li.quantity_liter ELSE 0 END), 0) AS in_qty
     FROM fuel_inventory_transactions t
     LEFT JOIN fuel_inventory_lines li ON li.transaction_id = t.id
     WHERE t.transfer_group_id IS NOT NULL AND t.status NOT IN ('reversed', 'void')
     GROUP BY t.transfer_group_id
     HAVING COUNT(*) <> 2
       OR SUM(CASE WHEN t.transaction_type = 'transfer_out' THEN 1 ELSE 0 END) <> 1
       OR SUM(CASE WHEN t.transaction_type = 'transfer_in' THEN 1 ELSE 0 END) <> 1
       OR ABS(COALESCE(SUM(CASE WHEN li.direction = 'out' THEN li.quantity_liter ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN li.direction = 'in' THEN li.quantity_liter ELSE 0 END), 0)) > 0.001
     ORDER BY t.transfer_group_id LIMIT $1`,
    [lim])).rows;
  const adjustments = (await pool.query(
    `/* fuel_integrity_adjustments */
     SELECT t.id, t.transaction_number, t.transaction_type, 'tanpa_opname' AS masalah
     FROM fuel_inventory_transactions t
     LEFT JOIN fuel_stock_opnames o ON o.adjustment_transaction_id = t.id
     WHERE t.transaction_type IN ('opname_adjustment_in', 'opname_adjustment_out')
       AND t.status <> 'void' AND o.id IS NULL
     UNION ALL
     SELECT o.id, o.id::text, o.status, 'tanpa_adjustment' AS masalah
     FROM fuel_stock_opnames o
     WHERE o.status = 'adjusted' AND ABS(o.variance_quantity) > 0.0005
       AND o.adjustment_transaction_id IS NULL
     ORDER BY 1 LIMIT $1`,
    [lim])).rows;
  const rek = await getReconciliation({ limit: lim });
  const inputFuel = {
    unlinked: rek.unlinkedLogs.length,
    orphan: rek.orphanIssues.length,
    mismatched: rek.mismatched.length,
    contoh_unlinked: rek.unlinkedLogs.slice(0, 3),
    contoh_orphan: rek.orphanIssues.slice(0, 3),
    contoh_mismatched: rek.mismatched.slice(0, 3),
  };
  const ok = !ledgerFifo.length && !transfers.length && !adjustments.length
    && !inputFuel.unlinked && !inputFuel.orphan && !inputFuel.mismatched;
  return {
    checked_at: new Date().toISOString(), formula_version: FUEL_FORMULA_VERSION, ok,
    ledger_fifo: ledgerFifo, transfers, adjustments, input_fuel: inputFuel,
  };
}

module.exports = {
  TYPES_IN, TYPES_OUT, SOURCE_TYPES, OPNAME_ALERT_PCT, FUEL_FORMULA_VERSION,
  validasiInput, nomorTransaksi, tglIso,
  listProducts, saveProduct, listLocations, saveLocation,
  listMappings, saveMapping, resolveSourceLocation,
  createDraft, postTransaction, reverseTransaction, voidDraft,
  transferStock, postTransferGroup, voidTransferGroup, getFifoLayers, getAllocations,
  ensureIssueForFuelLog, syncFuelLogDelete, linkIssue, getReconciliation, syncUnlinkedFuelLogs,
  getLedger, getBalance, ambilTransaksi,
  createOpname, updateOpnameDraft, submitOpname, approveOpname, rejectOpname,
  listOpnames, getOpname,
  getStockSummary, getFlowSeries, getUsageStats, buildExport, getIntegrityReport,
  getPeriodReconciliation, getConsumptionBreakdown, susunRekonsiliasi,
};
