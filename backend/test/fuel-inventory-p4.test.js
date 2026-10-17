'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dbCfg = require('../src/config/db');
const fuelInventory = require('../src/services/fuelInventory');

function pasangMock() {
  const mem = { seq: 900, tx: new Map(), lines: [], audit: [], layers: [], allocs: [], opnames: [] };
  let snap = null;
  const foto = () => structuredClone({ tx: [...mem.tx], lines: mem.lines, layers: mem.layers, allocs: mem.allocs, opnames: mem.opnames });
  const pulih = s => { mem.tx = new Map(s.tx); mem.lines = s.lines; mem.layers = s.layers; mem.allocs = s.allocs; mem.opnames = s.opnames; };
  const oldConnect = dbCfg.pool.connect;
  const lamaQuery = dbCfg.pool.query;
  const palsu = async (sql, args = []) => {
    if (sql === 'BEGIN') { snap = foto(); return { rows: [] }; }
    if (sql === 'COMMIT') { snap = null; return { rows: [] }; }
    // Kunci baris header (ambilTransaksi forUpdate) — tidak mengubah state mock.
    if (sql.includes('SELECT id FROM fuel_inventory_transactions WHERE id = $1 FOR UPDATE')) return { rows: [] };
    if (sql === 'ROLLBACK') { if (snap) pulih(snap); snap = null; return { rows: [] }; }
    if (sql.includes("nextval('fuel_inventory_transaction_seq')")) {
      mem.seq += 1; return { rows: [{ seq: mem.seq }] };
    }
    // --- opname ---
    if (sql.includes('SELECT id FROM fuel_stock_opnames WHERE location_id')) {
      const ada = mem.opnames.find(o => String(o.location_id) === String(args[0])
        && String(o.product_id) === String(args[1]) && (o.status === 'draft' || o.status === 'submitted'));
      return { rows: ada ? [{ id: ada.id }] : [] };
    }
    if (sql.includes('SELECT * FROM fuel_stock_opnames WHERE id')) {
      const satu = mem.opnames.find(o => String(o.id) === String(args[0]));
      return { rows: satu ? [{ ...satu }] : [] };
    }
    if (sql.includes('INSERT INTO fuel_stock_opnames')) {
      const row = { id: `op-${mem.opnames.length + 1}`, location_id: args[0], product_id: args[1],
        operational_date: args[2], counted_at: new Date().toISOString(),
        book_quantity_snapshot: Number(args[3]), physical_quantity: Number(args[4]),
        variance_quantity: Number(args[5]), variance_percent: args[6], variance_alert: args[7],
        measurement_method: args[8], evidence_url: args[9], note: args[10],
        status: 'draft', counted_by: args[11], submitted_by: null, submitted_at: null,
        approved_by: null, approved_at: null, reject_reason: null,
        adjustment_transaction_id: null, version: 1 };
      mem.opnames.push(row);
      return { rows: [{ ...row }] };
    }
    if (sql.includes('UPDATE fuel_stock_opnames SET')) {
      const row = mem.opnames.find(o => String(o.id) === String(args[0]));
      if (row) {
        for (const m of sql.matchAll(/([a-z_]+)\s*=\s*\$(\d+)/gi)) {
          row[m[1]] = args[Number(m[2]) - 1];
        }
        for (const m of sql.matchAll(/([a-z_]+)\s*=\s*'([a-z]+)'/gi)) {
          if (['draft', 'submitted', 'approved', 'rejected', 'adjusted'].includes(m[2])) row[m[1]] = m[2];
        }
        for (const m of sql.matchAll(/([a-z_]+)\s*=\s*CURRENT_TIMESTAMP/gi)) {
          row[m[1]] = new Date().toISOString();
        }
        row.version = Number(row.version) + 1;
      }
      return { rows: row ? [{ ...row }] : [] };
    }
    if (sql.includes('FROM fuel_stock_opnames')) {
      const syarat = [...sql.matchAll(/([a-z_]+)\s*=\s*\$(\d+)/gi)]
        .filter(m => !/limit/i.test(sql.slice(Math.max(0, m.index - 12), m.index)));
      let rows = mem.opnames.filter(o => syarat.every(m => String(o[m[1]]) === String(args[Number(m[2]) - 1])));
      const lim = Number(args[args.length - 1]);
      if (Number.isFinite(lim)) rows = rows.slice(0, lim);
      return { rows: rows.map(o => ({ ...o })) };
    }
    // --- transaksi: header adjustment (posted langsung) vs draft ---
    if (sql.includes('INSERT INTO fuel_inventory_transactions') && sql.includes("'posted'")) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[3], source_location_id: args[4], destination_location_id: args[5],
        status: 'posted', source_type: 'stock_opname', reason: args[6],
        created_by: args[7], posted_by: args[7], posted_at: new Date().toISOString(), lines: [] });
      return { rows: [{ ...mem.tx.get(id) }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_transactions')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[5], source_location_id: args[6], destination_location_id: args[7],
        status: 'draft', lines: [] });
      return { rows: [{ ...mem.tx.get(id) }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_lines')) {
      const baris = { id: `ln-${mem.lines.length + 1}`, transaction_id: args[0], direction: args[1],
        quantity_liter: Number(args[2]), unit_price: args[3] == null ? null : Number(args[3]),
        batch_number: args[5] || null };
      mem.lines.push(baris);
      mem.tx.get(args[0]).lines.push(baris);
      return { rows: [{ ...baris }] };
    }
    if (sql.includes('WHERE t.id = $1')) {
      const satu = mem.tx.get(args[0]);
      return { rows: satu ? [{ ...satu, lines: (satu.lines || []).map(l => ({ ...l })) }] : [] };
    }
    if (sql.includes("SET status = 'posted'")) {
      const t = mem.tx.get(args[0]);
      if (t) t.status = 'posted';
      return { rows: t ? [{ ...t }] : [] };
    }
    // --- FIFO ---
    if (sql.includes('FROM fuel_fifo_layers') && sql.includes('FOR UPDATE')) {
      return { rows: mem.layers
        .filter(l => String(l.location_id) === String(args[0])
          && (l.product_id == null || args[1] == null || String(l.product_id) === String(args[1]))
          && l.status === 'open' && Number(l.remaining_quantity) > 0)
        .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)) || String(a.id).localeCompare(String(b.id)))
        .map(l => ({ ...l })) };
    }
    if (sql.includes('INSERT INTO fuel_fifo_layers')) {
      const layer = { id: `lay-${mem.layers.length + 1}`, receipt_line_id: args[0], location_id: args[1],
        product_id: args[2], received_at: args[3], initial_quantity: Number(args[4]),
        remaining_quantity: Number(args[4]), unit_cost: args[5], batch_number: args[6], status: 'open' };
      mem.layers.push(layer);
      return { rows: [{ ...layer }] };
    }
    if (sql.includes('UPDATE fuel_fifo_layers SET remaining_quantity = remaining_quantity -')) {
      const layer = mem.layers.find(l => String(l.id) === String(args[0]));
      if (layer) {
        layer.remaining_quantity = Number(layer.remaining_quantity) - Number(args[1]);
        if (layer.remaining_quantity <= 1e-9) { layer.remaining_quantity = 0; layer.status = 'exhausted'; }
      }
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO fuel_fifo_allocations')) {
      mem.allocs.push({ outbound_line_id: args[0], fifo_layer_id: args[1], allocated_quantity: Number(args[2]),
        unit_cost_snapshot: args[3], allocated_value: args[4] });
      return { rows: [] };
    }
    // --- saldo ledger ---
    if (sql.includes('FROM fuel_inventory_lines l')) {
      let saldo = 0;
      for (const t of mem.tx.values()) {
        if (t.status !== 'posted' && t.status !== 'reversed') continue;
        if (args[1] != null && String(t.product_id) !== String(args[1])) continue;
        for (const l of (t.lines || [])) {
          if (l.direction === 'in' && String(t.destination_location_id) === String(args[0])) saldo += Number(l.quantity_liter);
          if (l.direction === 'out' && String(t.source_location_id) === String(args[0])) saldo -= Number(l.quantity_liter);
        }
      }
      return { rows: [{ balance: saldo }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_audit')) {
      mem.audit.push({ entity: args[0], id: args[1], action: args[2] });
      return { rows: [] };
    }
    throw new Error(`Mock tidak mengenali query: ${String(sql).slice(0, 90)}`);
  };
  dbCfg.pool.connect = async () => ({ release() {}, query: palsu });
  dbCfg.pool.query = palsu;
  return { mem, lepas() { dbCfg.pool.connect = oldConnect; dbCfg.pool.query = lamaQuery; } };
}

async function terima(tanggal, lokasi, qty, harga, batch) {
  const draf = await fuelInventory.createDraft({ transaction_type: 'receipt', operational_date: tanggal,
    product_id: 'P1', destination_location_id: lokasi,
    lines: [{ direction: 'in', quantity_liter: qty, unit_price: harga, batch_number: batch }] }, 'actor-1');
  await fuelInventory.postTransaction(draf.id, 'actor-1');
  return draf.id;
}

async function opnameSiap(tanggal, lokasi, fisik, penghitung = 'counter-1', ekstra = {}) {
  const op = await fuelInventory.createOpname({ operational_date: tanggal, location_id: lokasi,
    product_id: 'P1', physical_quantity: fisik, ...ekstra }, penghitung);
  return fuelInventory.submitOpname(op.id, penghitung);
}

test('variance positif → adjustment_in + layer baru + saldo = fisik', async () => {
  const { mem, lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-A');
    const sub = await opnameSiap('2026-09-22', 'DEPOT', 1100);
    assert.equal(sub.status, 'submitted');
    assert.equal(Number(sub.book_quantity_snapshot), 1000);
    assert.equal(Number(sub.variance_quantity), 100);
    assert.equal(Number(sub.variance_percent), 10);
    assert.equal(sub.variance_alert, true);
    const ok = await fuelInventory.approveOpname(sub.id, 'approver-1', { note: 'Selisih segel supplier', unit_price: 11 });
    assert.equal(ok.status, 'adjusted');
    assert.ok(ok.adjustment_transaction_id, 'adjustment tertaut');
    const adj = mem.tx.get(ok.adjustment_transaction_id);
    assert.equal(adj.transaction_type, 'opname_adjustment_in');
    assert.equal(adj.status, 'posted');
    assert.equal(adj.source_type, 'stock_opname');
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 1100);
    const layerBaru = mem.layers.find(l => l.receipt_line_id && mem.lines.some(x => x.id === l.receipt_line_id && String(x.transaction_id) === String(adj.id)));
    assert.ok(layerBaru, 'adjustment_in membuka layer baru');
    assert.equal(Number(layerBaru.remaining_quantity), 100);
    assert.equal(Number(layerBaru.unit_cost), 11);
    assert.ok(mem.audit.some(a => a.action === 'opname_approve'), 'audit approve tercatat');
  } finally { lepas(); }
});

test('variance negatif → adjustment_out konsumsi oldest-first', async () => {
  const { mem, lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-A');
    await terima('2026-09-20', 'DEPOT', 1000, 12, 'B-B');
    const sub = await opnameSiap('2026-09-22', 'DEPOT', 1500);
    assert.equal(Number(sub.variance_quantity), -500);
    assert.equal(Number(sub.variance_percent), -25);
    const ok = await fuelInventory.approveOpname(sub.id, 'approver-1', { note: 'Evaporasi + spill terdokumentasi' });
    assert.equal(ok.status, 'adjusted');
    const adj = mem.tx.get(ok.adjustment_transaction_id);
    assert.equal(adj.transaction_type, 'opname_adjustment_out');
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 1500);
    const sisa = Object.fromEntries(mem.layers.filter(l => l.location_id === 'DEPOT').map(l => [l.batch_number, Number(l.remaining_quantity)]));
    assert.deepEqual(sisa['B-A'], 500, 'layer tertua terkonsumsi dulu');
    assert.deepEqual(sisa['B-B'], 1000, 'layer baru utuh');
  } finally { lepas(); }
});

test('variance nol → approve tanpa adjustment', async () => {
  const { mem, lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-A');
    const sub = await opnameSiap('2026-09-22', 'DEPOT', 1000);
    assert.equal(sub.variance_alert, false);
    const ok = await fuelInventory.approveOpname(sub.id, 'approver-1', {});
    assert.equal(ok.status, 'adjusted');
    assert.equal(ok.adjustment_transaction_id, null);
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 1000);
    assert.equal(mem.tx.size, 1, 'tidak ada transaksi adjustment');
  } finally { lepas(); }
});

test('book nol + fisik > 0 → alert, pct null, cost null bila tanpa harga', async () => {
  const { mem, lepas } = pasangMock();
  try {
    const sub = await opnameSiap('2026-09-22', 'DEPOT', 50);
    assert.equal(Number(sub.book_quantity_snapshot), 0);
    assert.equal(sub.variance_percent, null);
    assert.equal(sub.variance_alert, true);
    const ok = await fuelInventory.approveOpname(sub.id, 'approver-1', { note: 'Temuan fisik awal' });
    const layerBaru = mem.layers.find(l => String(l.location_id) === 'DEPOT');
    assert.ok(layerBaru);
    assert.equal(Number(layerBaru.remaining_quantity), 50);
    assert.equal(layerBaru.unit_cost, null, 'tanpa harga eksplisit = NULL, bukan average');
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 50);
    void ok;
  } finally { lepas(); }
});

test('maker-checker + note wajib saat alert + guard status', async () => {
  const { lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-A');
    const sub = await opnameSiap('2026-09-22', 'DEPOT', 1100, 'counter-1');
    await assert.rejects(() => fuelInventory.approveOpname(sub.id, 'counter-1', { note: 'x' }), /sendiri|maker-checker/);
    await assert.rejects(() => fuelInventory.approveOpname(sub.id, 'approver-1', {}), /alasan approval/);
    await assert.rejects(() => fuelInventory.submitOpname(sub.id, 'counter-1'), /Hanya draft/);
    await assert.rejects(() => fuelInventory.approveOpname(sub.id, 'approver-1', { note: 'ok' }).then(o => fuelInventory.approveOpname(o.id, 'approver-2', { note: 'lagi' })), /submitted/);
    const draf = await fuelInventory.createOpname({ operational_date: '2026-09-23', location_id: 'DEPOT', product_id: 'P1', physical_quantity: 900 }, 'counter-2');
    await assert.rejects(() => fuelInventory.approveOpname(draf.id, 'approver-1', { note: 'x' }), /submitted/);
    await assert.rejects(() => fuelInventory.rejectOpname(sub.id, 'approver-1', ''), /Alasan reject/);
  } finally { lepas(); }
});

test('konflik approval bila buku berubah setelah hitung', async () => {
  const { lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-A');
    const sub = await opnameSiap('2026-09-22', 'DEPOT', 1000);
    await terima('2026-09-22', 'DEPOT', 200, 10, 'B-C');
    await assert.rejects(() => fuelInventory.approveOpname(sub.id, 'approver-1', {}), /berubah/);
    const cek = await fuelInventory.getOpname(sub.id);
    assert.equal(cek.status, 'submitted', 'tetap submitted, tidak parsial');
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 1200);
  } finally { lepas(); }
});

test('opname aktif ganda ditolak; reject + update draft + history', async () => {
  const { mem, lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-A');
    const draf = await fuelInventory.createOpname({ operational_date: '2026-09-22', location_id: 'DEPOT', product_id: 'P1', physical_quantity: 900 }, 'counter-1');
    await assert.rejects(() => fuelInventory.createOpname({ operational_date: '2026-09-22', location_id: 'DEPOT', product_id: 'P1', physical_quantity: 800 }, 'counter-2'), /aktif/);
    const ubah = await fuelInventory.updateOpnameDraft(draf.id, { physical_quantity: 950 }, 'counter-1');
    assert.equal(Number(ubah.physical_quantity), 950);
    assert.equal(Number(ubah.book_quantity_snapshot), 1000);
    assert.equal(Number(ubah.variance_quantity), -50);
    const sub = await fuelInventory.submitOpname(draf.id, 'counter-1');
    await assert.rejects(() => fuelInventory.updateOpnameDraft(draf.id, { physical_quantity: 1 }, 'counter-1'), /draft/);
    const tolak = await fuelInventory.rejectOpname(sub.id, 'approver-1', 'Ukur ulang dengan dipstick kalibrasi');
    assert.equal(tolak.status, 'rejected');
    const riwayat = await fuelInventory.listOpnames({ location_id: 'DEPOT', status: 'rejected' });
    assert.equal(riwayat.length, 1);
    // Setelah final, opname baru boleh dibuat lagi.
    const baru = await fuelInventory.createOpname({ operational_date: '2026-09-23', location_id: 'DEPOT', product_id: 'P1', physical_quantity: 1000 }, 'counter-1');
    assert.equal(baru.status, 'draft');
    void mem;
  } finally { lepas(); }
});
