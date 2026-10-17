'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dbCfg = require('../src/config/db');
const fuelInventory = require('../src/services/fuelInventory');

function pasangMock() {
  const mem = { seq: 900, order: 0, tx: new Map(), lines: [], audit: [], layers: [], allocs: [], opnames: [] };
  const oldConnect = dbCfg.pool.connect;
  const lamaQuery = dbCfg.pool.query;
  const saldoKombinasi = (loc, prod) => {
    let saldo = 0;
    for (const t of mem.tx.values()) {
      if (t.status !== 'posted' && t.status !== 'reversed') continue;
      if (String(t.product_id) !== String(prod)) continue;
      for (const l of (t.lines || [])) {
        if (l.direction === 'in' && String(t.destination_location_id) === String(loc)) saldo += Number(l.quantity_liter);
        if (l.direction === 'out' && String(t.source_location_id) === String(loc)) saldo -= Number(l.quantity_liter);
      }
    }
    return saldo;
  };
  const palsu = async (sql, args = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    // Kunci baris header (ambilTransaksi forUpdate) — tidak mengubah state mock.
    if (sql.includes('SELECT id FROM fuel_inventory_transactions WHERE id = $1 FOR UPDATE')) return { rows: [] };
    if (sql.includes("nextval('fuel_inventory_transaction_seq')")) {
      mem.seq += 1; return { rows: [{ seq: mem.seq }] };
    }
    // --- P6: tiga pemeriksaan dihitung di JS ---
    if (sql.includes('fuel_integrity_ledger_fifo')) {
      const combo = new Map();
      for (const t of mem.tx.values()) {
        if (t.status !== 'posted' && t.status !== 'reversed') continue;
        if (t.destination_location_id) combo.set(`${t.destination_location_id}|${t.product_id}`, [t.destination_location_id, t.product_id]);
        if (t.source_location_id) combo.set(`${t.source_location_id}|${t.product_id}`, [t.source_location_id, t.product_id]);
      }
      for (const l of mem.layers) combo.set(`${l.location_id}|${l.product_id}`, [l.location_id, l.product_id]);
      const rows = [];
      for (const [loc, prod] of combo.values()) {
        const bal = saldoKombinasi(loc, prod);
        const fifo = mem.layers.filter(l => String(l.location_id) === String(loc) && String(l.product_id) === String(prod)
          && (l.status === 'open' || l.status === 'exhausted')).reduce((s, l) => s + Number(l.remaining_quantity), 0);
        if (Math.abs(bal - fifo) > 0.001) rows.push({ location_id: loc, product_id: prod, balance_liter: bal, fifo_liter: fifo });
      }
      return { rows: rows.slice(0, Number(args[0]) || 50) };
    }
    if (sql.includes('fuel_integrity_transfers')) {
      const grup = new Map();
      for (const t of mem.tx.values()) {
        if (!t.transfer_group_id || t.status === 'reversed' || t.status === 'void') continue;
        if (!grup.has(t.transfer_group_id)) grup.set(t.transfer_group_id, { transfer_group_id: t.transfer_group_id, legs: 0, out_legs: 0, in_legs: 0, out_qty: 0, in_qty: 0 });
        const g = grup.get(t.transfer_group_id);
        g.legs += 1;
        if (t.transaction_type === 'transfer_out') g.out_legs += 1;
        if (t.transaction_type === 'transfer_in') g.in_legs += 1;
        for (const l of (t.lines || [])) {
          if (l.direction === 'out') g.out_qty += Number(l.quantity_liter);
          if (l.direction === 'in') g.in_qty += Number(l.quantity_liter);
        }
      }
      const rows = [...grup.values()].filter(g => g.legs !== 2 || g.out_legs !== 1 || g.in_legs !== 1 || Math.abs(g.out_qty - g.in_qty) > 0.001);
      return { rows: rows.slice(0, Number(args[0]) || 50) };
    }
    if (sql.includes('fuel_integrity_adjustments')) {
      const rows = [];
      for (const t of mem.tx.values()) {
        if (!['opname_adjustment_in', 'opname_adjustment_out'].includes(t.transaction_type) || t.status === 'void') continue;
        const tertaut = mem.opnames.some(o => String(o.adjustment_transaction_id) === String(t.id));
        if (!tertaut) rows.push({ id: t.id, transaction_number: t.transaction_number, transaction_type: t.transaction_type, masalah: 'tanpa_opname' });
      }
      for (const o of mem.opnames) {
        if (o.status === 'adjusted' && Math.abs(Number(o.variance_quantity)) > 0.0005 && !o.adjustment_transaction_id) {
          rows.push({ id: o.id, transaction_number: o.id, transaction_type: o.status, masalah: 'tanpa_adjustment' });
        }
      }
      return { rows: rows.slice(0, Number(args[0]) || 50) };
    }
    // --- input_fuel: kosong (P2 tercakup di test-nya sendiri) ---
    if (sql.includes('fuel_logs')) return { rows: [] };
    if (sql.includes('FROM fuel_source_mappings m')) return { rows: [] };
    // --- transaksi dasar (receipt/issue via service) ---
    // Cabang 'posted' (adjustment opname) WAJIB sebelum cabang draft generik.
    if (sql.includes('INSERT INTO fuel_inventory_transactions') && sql.includes("'posted'")) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[3], source_location_id: args[4], destination_location_id: args[5],
        status: 'posted', source_type: 'stock_opname', reason: args[6], created_by: args[7], lines: [] });
      return { rows: [{ ...mem.tx.get(id) }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_transactions')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[5], source_location_id: args[6], destination_location_id: args[7],
        equipment_id: args[8] || null, status: 'draft', lines: [] });
      return { rows: [{ ...mem.tx.get(id) }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_lines')) {
      const baris = { id: `ln-${mem.lines.length + 1}`, transaction_id: args[0], direction: args[1], quantity_liter: Number(args[2]) };
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
    if (sql.includes('FROM fuel_fifo_layers') && sql.includes('FOR UPDATE')) {
      return { rows: mem.layers
        .filter(l => String(l.location_id) === String(args[0]) && l.status === 'open' && Number(l.remaining_quantity) > 0)
        .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)))
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
      mem.allocs.push({ outbound_line_id: args[0] });
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_audit')) return { rows: [] };
    // --- opname (untuk alur bersih via service) ---
    if (sql.includes('SELECT id FROM fuel_stock_opnames WHERE location_id')) return { rows: [] };
    if (sql.includes('SELECT * FROM fuel_stock_opnames WHERE id')) {
      const satu = mem.opnames.find(o => String(o.id) === String(args[0]));
      return { rows: satu ? [{ ...satu }] : [] };
    }
    if (sql.includes('INSERT INTO fuel_stock_opnames')) {
      const row = { id: `op-${mem.opnames.length + 1}`, location_id: args[0], product_id: args[1],
        operational_date: args[2], book_quantity_snapshot: Number(args[3]), physical_quantity: Number(args[4]),
        variance_quantity: Number(args[5]), variance_percent: args[6], variance_alert: args[7],
        note: args[10], status: 'draft', counted_by: args[11], adjustment_transaction_id: null, version: 1 };
      mem.opnames.push(row);
      return { rows: [{ ...row }] };
    }
    if (sql.includes('UPDATE fuel_stock_opnames SET')) {
      const row = mem.opnames.find(o => String(o.id) === String(args[0]));
      if (row) {
        for (const m of sql.matchAll(/([a-z_]+)\s*=\s*\$(\d+)/gi)) row[m[1]] = args[Number(m[2]) - 1];
        for (const m of sql.matchAll(/([a-z_]+)\s*=\s*'([a-z]+)'/gi)) {
          if (['draft', 'submitted', 'approved', 'rejected', 'adjusted'].includes(m[2])) row[m[1]] = m[2];
        }
        row.version = Number(row.version) + 1;
      }
      return { rows: row ? [{ ...row }] : [] };
    }
    if (sql.includes('FROM fuel_inventory_lines l')) {
      let saldo = 0;
      for (const t of mem.tx.values()) {
        if (t.status !== 'posted' && t.status !== 'reversed') continue;
        for (const l of (t.lines || [])) {
          if (l.direction === 'in' && String(t.destination_location_id) === String(args[0])) saldo += Number(l.quantity_liter);
          if (l.direction === 'out' && String(t.source_location_id) === String(args[0])) saldo -= Number(l.quantity_liter);
        }
      }
      return { rows: [{ balance: saldo }] };
    }
    throw new Error(`Mock tidak mengenali query: ${String(sql).slice(0, 90)}`);
  };
  dbCfg.pool.connect = async () => ({ release() {}, query: palsu });
  dbCfg.pool.query = palsu;
  return { mem, lepas() { dbCfg.pool.connect = oldConnect; dbCfg.pool.query = lamaQuery; } };
}

test('laporan bersih bila semua seimbang', async () => {
  const { mem, lepas } = pasangMock();
  try {
    const draf = await fuelInventory.createDraft({ transaction_type: 'receipt', operational_date: '2026-09-19',
      product_id: 'P1', destination_location_id: 'DEPOT',
      lines: [{ direction: 'in', quantity_liter: 1000, unit_price: 10, batch_number: 'B-A' }] }, 'a');
    await fuelInventory.postTransaction(draf.id, 'a');
    const op = await fuelInventory.createOpname({ operational_date: '2026-09-22', location_id: 'DEPOT',
      product_id: 'P1', physical_quantity: 1000 }, 'counter-1');
    await fuelInventory.submitOpname(op.id, 'counter-1');
    await fuelInventory.approveOpname(op.id, 'approver-1', {});
    const lap = await fuelInventory.getIntegrityReport({});
    assert.equal(lap.ok, true);
    assert.deepEqual([lap.ledger_fifo.length, lap.transfers.length, lap.adjustments.length], [0, 0, 0]);
    assert.deepEqual([lap.input_fuel.unlinked, lap.input_fuel.orphan, lap.input_fuel.mismatched], [0, 0, 0]);
    assert.equal(lap.formula_version, 'v1');
    void mem;
  } finally { lepas(); }
});

test('ketidakseimbangan ledger-FIFO, transfer, adjustment terdeteksi', async () => {
  const { mem, lepas } = pasangMock();
  try {
    // Seed langsung: receipt posted 1000 + layer dirusak (sisa 100, bukan 1000).
    mem.tx.set('tx-1', { id: 'tx-1', transaction_number: 'FI-X', transaction_type: 'receipt',
      operational_date: '2026-09-19', product_id: 'P1', source_location_id: null,
      destination_location_id: 'DEPOT', status: 'posted',
      lines: [{ id: 'ln-1', transaction_id: 'tx-1', direction: 'in', quantity_liter: 1000 }] });
    mem.layers.push({ id: 'lay-1', location_id: 'DEPOT', product_id: 'P1', remaining_quantity: 100,
      initial_quantity: 1000, unit_cost: 10, status: 'open' });
    // Layer tujuan transfer utuh agar hanya DEPOT yang flag.
    mem.layers.push({ id: 'lay-2', location_id: 'TRUCK-1', product_id: 'P1', remaining_quantity: 250,
      initial_quantity: 250, unit_cost: 10, status: 'open' });
    // Pasangan transfer pincang: keluar 300, masuk 250.
    mem.tx.set('tx-2', { id: 'tx-2', transaction_type: 'transfer_out', product_id: 'P1',
      source_location_id: 'DEPOT', destination_location_id: null, status: 'posted',
      transfer_group_id: 'g-1', lines: [{ id: 'ln-2', transaction_id: 'tx-2', direction: 'out', quantity_liter: 300 }] });
    mem.tx.set('tx-3', { id: 'tx-3', transaction_type: 'transfer_in', product_id: 'P1',
      source_location_id: null, destination_location_id: 'TRUCK-1', status: 'posted',
      transfer_group_id: 'g-1', lines: [{ id: 'ln-3', transaction_id: 'tx-3', direction: 'in', quantity_liter: 250 }] });
    // Adjustment tanpa opname + opname adjusted tanpa adjustment.
    mem.tx.set('tx-4', { id: 'tx-4', transaction_number: 'FI-Y', transaction_type: 'opname_adjustment_out',
      product_id: 'P1', source_location_id: 'DEPOT', status: 'posted',
      lines: [{ id: 'ln-4', transaction_id: 'tx-4', direction: 'out', quantity_liter: 50 }] });
    mem.opnames.push({ id: 'op-1', status: 'adjusted', variance_quantity: -20, adjustment_transaction_id: null });
    const lap = await fuelInventory.getIntegrityReport({});
    assert.equal(lap.ok, false);
    assert.equal(lap.ledger_fifo.length, 1);
    assert.equal(lap.ledger_fifo[0].balance_liter, 650);
    assert.equal(lap.ledger_fifo[0].fifo_liter, 100);
    assert.equal(lap.transfers.length, 1);
    assert.equal(lap.transfers[0].transfer_group_id, 'g-1');
    assert.deepEqual(lap.adjustments.map(a => a.masalah).sort(), ['tanpa_adjustment', 'tanpa_opname']);
  } finally { lepas(); }
});
