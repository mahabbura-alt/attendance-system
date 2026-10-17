'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dbCfg = require('../src/config/db');
const fuelInventory = require('../src/services/fuelInventory');

function pasangMock(fixture = {}) {
  const mem = {
    seq: 500,
    tx: new Map(),
    lines: [],
    audit: [],
    layers: [{ id: 'lay-depot', receipt_line_id: null, location_id: 'DEPOT', product_id: 'P1',
      received_at: '2026-09-01T00:00:00.000Z', initial_quantity: 5000, remaining_quantity: 5000,
      unit_cost: 10, batch_number: 'B0', status: 'open' },
    { id: 'lay-l1', receipt_line_id: null, location_id: 'L1', product_id: 'P1',
      received_at: '2026-09-01T00:00:00.000Z', initial_quantity: 5000, remaining_quantity: 5000,
      unit_cost: 10, batch_number: 'B0', status: 'open' }],
    allocs: [],
    mappings: fixture.mappings ? [...fixture.mappings] : [],
    fuellogs: fixture.fuellogs ? { ...fixture.fuellogs } : {},
  };
  const garisAktif = tx => tx.status !== 'reversed' && tx.status !== 'void';
  const jumlahBaris = id => mem.lines.filter(l => String(l.transaction_id) === String(id))
    .reduce((t, l) => t + Number(l.quantity_liter), 0);
  const oldConnect = dbCfg.pool.connect;
  const lamaQuery = dbCfg.pool.query;
  const palsu = async (sql, args = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    // Kunci baris header (ambilTransaksi forUpdate) — tidak mengubah state mock.
    if (sql.includes('SELECT id FROM fuel_inventory_transactions WHERE id = $1 FOR UPDATE')) return { rows: [] };
    if (sql.includes("nextval('fuel_inventory_transaction_seq')")) { mem.seq += 1; return { rows: [{ seq: mem.seq }] }; }
    if (sql.includes('FROM fuel_source_mappings m')) {
      return { rows: mem.mappings.filter(m => m.is_active !== false).map(m => ({ ...m })) };
    }
    if (sql.includes('FROM fuel_source_mappings WHERE')) return { rows: mem.mappings.map(m => ({ ...m })) };
    if (sql.includes('INSERT INTO fuel_source_mappings')) {
      const baris = { id: `map-${mem.mappings.length + 1}`, shift_id: args[0], truck_equipment_id: args[1],
        operator_id: args[2], product_id: args[3], location_id: args[4], priority: args[5], is_active: true };
      mem.mappings.push(baris);
      return { rows: [{ ...baris }] };
    }
    if (sql.includes('UPDATE fuel_source_mappings SET')) {
      const baris = mem.mappings.find(m => String(m.id) === String(args[0]));
      if (!baris) return { rows: [] };
      Object.assign(baris, { shift_id: args[1], truck_equipment_id: args[2], operator_id: args[3],
        product_id: args[4], location_id: args[5], priority: args[6] });
      if (args[7] !== null && args[7] !== undefined) baris.is_active = Boolean(args[7]);
      return { rows: [{ ...baris }] };
    }
    if (sql.includes('SELECT * FROM fuel_logs WHERE id')) {
      const log = mem.fuellogs[String(args[0])];
      return { rows: log ? [{ ...log }] : [] };
    }
    if (/FROM fuel_inventory_transactions\s+WHERE idempotency_key/.test(sql)) {
      const ketemu = [...mem.tx.values()].find(t => t.idempotency_key && t.idempotency_key === args[0]
        && t.status !== 'reversed' && t.status !== 'void');
      return { rows: ketemu ? [{ id: ketemu.id }] : [] };
    }
    if (sql.includes('FROM fuel_inventory_transactions WHERE fuel_log_id')) {
      const ketemu = [...mem.tx.values()].find(t => String(t.fuel_log_id) === String(args[0]) && garisAktif(t));
      return { rows: ketemu ? [{ ...ketemu }] : [] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_transactions') && !sql.includes('reversal_of_transaction_id')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[5], source_location_id: args[6], destination_location_id: args[7],
        equipment_id: args[8], operator_id: args[9], fuel_log_id: args[10], document_number: args[11],
        status: 'draft', source_type: args[14], reason: args[15], idempotency_key: args[16],
        created_by: args[17], lines: [] });
      return { rows: [{ ...mem.tx.get(id) }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_lines')) {
      const baris = { id: `ln-${mem.lines.length + 1}`, transaction_id: args[0], direction: args[1],
        quantity_liter: args[2], unit_price: args[3], total_value: args[4], batch_number: args[5] };
      mem.lines.push(baris);
      const induk = mem.tx.get(args[0]);
      if (induk) induk.lines = [...(induk.lines || []), baris];
      return { rows: [baris] };
    }
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
    if (sql.includes('UPDATE fuel_fifo_layers SET remaining_quantity')) {
      const layer = mem.layers.find(l => String(l.id) === String(args[0]));
      if (layer) {
        layer.remaining_quantity = Number(layer.remaining_quantity) - Number(args[1]);
        if (layer.remaining_quantity <= 1e-9) { layer.remaining_quantity = 0; layer.status = 'exhausted'; }
      }
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO fuel_fifo_allocations')) {
      mem.allocs.push({ outbound_line_id: args[0], fifo_layer_id: args[1], allocated_quantity: Number(args[2]) });
      return { rows: [] };
    }
    if (sql.includes('FROM fuel_fifo_allocations a')) {
      return { rows: mem.allocs
        .filter(a => mem.lines.some(l => String(l.id) === String(a.outbound_line_id) && String(l.transaction_id) === String(args[0])))
        .map(a => ({ ...a })) };
    }
    if (sql.includes('FROM fuel_fifo_layers WHERE receipt_line_id IN')) {
      const ids = new Set(mem.lines.filter(l => String(l.transaction_id) === String(args[0])).map(l => String(l.id)));
      return { rows: mem.layers.filter(l => ids.has(String(l.receipt_line_id))).map(l => ({ ...l })) };
    }
    if (sql.includes('UPDATE fuel_fifo_layers SET status = \'reversed\'')) {
      const layer = mem.layers.find(l => String(l.id) === String(args[0]));
      if (layer) layer.status = 'reversed';
      return { rows: [] };
    }
    if (sql.includes('UPDATE fuel_fifo_layers SET remaining_quantity = remaining_quantity +')) {
      const layer = mem.layers.find(l => String(l.id) === String(args[0]));
      if (layer) { layer.remaining_quantity = Number(layer.remaining_quantity) + Number(args[1]); layer.status = 'open'; }
      return { rows: [] };
    }
    if (sql.includes('FROM fuel_inventory_transactions t') && sql.includes('LEFT JOIN fuel_inventory_lines')) {
      const satu = mem.tx.get(args[0]);
      return { rows: satu ? [{ ...satu }] : [] };
    }
    if (sql.includes("SET status = 'posted'")) {
      const t = mem.tx.get(args[0]);
      if (t) { t.status = 'posted'; t.posted_by = args[1]; }
      return { rows: t ? [{ ...t }] : [] };
    }
    if (sql.includes("SET status = 'reversed'")) {
      const t = mem.tx.get(args[0]);
      if (t) { t.status = 'reversed'; t.reversed_by = args[1]; }
      return { rows: [] };
    }
    if (sql.includes("SET status = 'void'")) {
      const t = mem.tx.get(args[0]);
      if (t) t.status = 'void';
      return { rows: t ? [{ ...t }] : [] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_transactions') && sql.includes('reversal_of_transaction_id')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: 'reversal',
        operational_date: args[1], product_id: args[2], source_location_id: args[3],
        destination_location_id: args[4], equipment_id: args[5], status: 'posted',
        source_type: 'system_reversal', reversal_of_transaction_id: args[7], lines: [] });
      return { rows: [{ ...mem.tx.get(id) }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_audit')) {
      mem.audit.push({ action: 'audit' });
      return { rows: [] };
    }
    if (sql.includes('SELECT COALESCE(SUM(quantity_liter), 0) AS jml FROM fuel_inventory_lines WHERE transaction_id')) {
      return { rows: [{ jml: jumlahBaris(args[0]) }] };
    }
    if (sql.includes('NOT EXISTS (SELECT 1 FROM fuel_inventory_transactions t WHERE t.fuel_log_id')) {
      const rows = Object.values(mem.fuellogs)
        .filter(f => !f.deleted_at && Number(f.fuel_filled) > 0
          && ![...mem.tx.values()].some(t => String(t.fuel_log_id) === String(f.id) && garisAktif(t)))
        .map(f => ({ ...f }));
      return { rows };
    }
    if (sql.includes('LEFT JOIN fuel_logs fl ON fl.id = t.fuel_log_id')) {
      const rows = [...mem.tx.values()]
        .filter(t => t.fuel_log_id && garisAktif(t) && !mem.fuellogs[String(t.fuel_log_id)])
        .map(t => ({ id: t.id, transaction_number: t.transaction_number, fuel_log_id: t.fuel_log_id, status: t.status }));
      return { rows };
    }
    if (sql.includes('ABS(COALESCE')) {
      const rows = [];
      for (const t of mem.tx.values()) {
        if (!t.fuel_log_id || !garisAktif(t)) continue;
        const f = mem.fuellogs[String(t.fuel_log_id)];
        if (!f || f.deleted_at) continue;
        const qty = jumlahBaris(t.id);
        if (Math.abs(qty - Number(f.fuel_filled)) > 0.005) {
          rows.push({ id: t.id, transaction_number: t.transaction_number, fuel_log_id: t.fuel_log_id,
            fuel_filled: f.fuel_filled, qty });
        }
      }
      return { rows };
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
    return { rows: [] };
  };
  dbCfg.pool.connect = async () => ({ release() {}, query: palsu });
  dbCfg.pool.query = palsu;
  return { mem, lepas() { dbCfg.pool.connect = oldConnect; dbCfg.pool.query = lamaQuery; } };
}

const LOG = { id: 'LOG-1', tanggal: '2026-09-23', shift_id: 'S1', equipment_id: 'EX-1',
  operator_id: 'OP-1', fuel_filled: 200, fuel_ticket_no: 'T-1', deleted_at: null };

test('resolve unik/spesifik/ambigu/kosong + duplikat mapping ditolak', () => {
  const daftar = [
    { id: 'm1', shift_id: 'S1', truck_equipment_id: null, operator_id: null, product_id: 'P1', location_id: 'L1', priority: 100, is_active: true },
    { id: 'm2', shift_id: 'S1', truck_equipment_id: null, operator_id: 'OP-1', product_id: 'P1', location_id: 'L2', priority: 100, is_active: true },
    { id: 'm3', shift_id: null, truck_equipment_id: null, operator_id: null, product_id: 'P1', location_id: 'L9', priority: 100, is_active: false },
  ];
  let hasil = fuelInventory.resolveSourceLocation(daftar, { shift_id: 'S1', operator_id: 'OP-1' });
  assert.equal(hasil.resolved, true);
  assert.equal(hasil.location_id, 'L2', 'spesifik (2 kunci) menang atas umum');
  hasil = fuelInventory.resolveSourceLocation(
    [...daftar, { id: 'm4', shift_id: 'S1', truck_equipment_id: null, operator_id: 'OP-1', product_id: 'P1', location_id: 'L3', priority: 100, is_active: true }],
    { shift_id: 'S1', operator_id: 'OP-1' });
  assert.equal(hasil.resolved, false);
  assert.equal(hasil.reason, 'ambiguous');
  hasil = fuelInventory.resolveSourceLocation(daftar, { shift_id: 'S9', operator_id: 'OP-9' });
  assert.equal(hasil.resolved, false);
  assert.equal(hasil.reason, 'no_mapping');
});

test('ensureIssue membuat draf terhubung; tanpa mapping masuk antrean; saldo tetap nol', async () => {
  const { mem, lepas } = pasangMock({
    mappings: [{ id: 'm1', shift_id: 'S1', truck_equipment_id: null, operator_id: null,
      product_id: 'P1', location_id: 'L1', priority: 100, is_active: true }],
    fuellogs: { 'LOG-1': { ...LOG }, 'LOG-2': { ...LOG, id: 'LOG-2', shift_id: 'S9' } },
  });
  try {
    const r1 = await fuelInventory.ensureIssueForFuelLog('LOG-1', 'actor-1');
    assert.equal(r1.action, 'created');
    assert.equal(r1.issue.status, 'draft');
    assert.equal(r1.issue.source_location_id, 'L1');
    assert.equal(await fuelInventory.getBalance({ location_id: 'L1' }), 0, 'shadow: stok tidak bergerak');
    const r2 = await fuelInventory.ensureIssueForFuelLog('LOG-2', 'actor-1');
    assert.equal(r2.action, 'no_mapping');
    assert.equal(r2.reason, 'no_mapping');
    assert.equal(mem.tx.size, 1, 'tanpa mapping tidak membuat transaksi');
    const r3 = await fuelInventory.ensureIssueForFuelLog('LOG-1', 'actor-1');
    assert.equal(r3.action, 'synced', 'retry idempoten');
    assert.equal(mem.tx.size, 1);
  } finally { lepas(); }
});

test('update fuel: void + buat ulang; delete: void draf, reversal posted', async () => {
  const { mem, lepas } = pasangMock({
    mappings: [{ id: 'm1', shift_id: 'S1', truck_equipment_id: null, operator_id: null,
      product_id: 'P1', location_id: 'L1', priority: 100, is_active: true }],
    fuellogs: { 'LOG-1': { ...LOG } },
  });
  try {
    await fuelInventory.ensureIssueForFuelLog('LOG-1', 'actor-1');
    mem.fuellogs['LOG-1'] = { ...LOG, fuel_filled: 250 };
    const r = await fuelInventory.ensureIssueForFuelLog('LOG-1', 'actor-1');
    assert.equal(r.action, 'void_recreated');
    assert.equal(await fuelInventory.getBalance({ location_id: 'L1' }), 0);
    const hapus = await fuelInventory.syncFuelLogDelete('LOG-1', 'actor-1', 'salah input');
    assert.equal(hapus.action, 'voided');
    // Posted: reversal, bukan void.
    const draf = await fuelInventory.ensureIssueForFuelLog('LOG-1', 'actor-1');
    assert.equal(draf.action, 'created');
    await fuelInventory.postTransaction(draf.issue.id, 'actor-1');
    const hapus2 = await fuelInventory.syncFuelLogDelete('LOG-1', 'actor-1', 'salah input');
    assert.equal(hapus2.action, 'reversed');
    assert.equal(await fuelInventory.getBalance({ location_id: 'L1' }), 0);
  } finally { lepas(); }
});

test('link manual + rekonsiliasi + mekanik depot-truck-unit', async () => {
  const { lepas } = pasangMock({
    mappings: [],
    fuellogs: { 'LOG-1': { ...LOG } },
  });
  try {
    const link = await fuelInventory.linkIssue({ fuel_log_id: 'LOG-1', location_id: 'L1', product_id: 'P1' }, 'actor-1');
    assert.equal(link.action, 'created');
    let rek = await fuelInventory.getReconciliation({});
    assert.equal(rek.unlinkedLogs.length, 0, 'sudah tertaut');
    assert.equal(rek.mismatched.length, 0);
    // Transfer depot -> truck, lalu issue dari truck (mekanik P2).
    const tr = await fuelInventory.createDraft({
      transaction_type: 'transfer_out', operational_date: '2026-09-23', product_id: 'P1',
      source_location_id: 'DEPOT', lines: [{ direction: 'out', quantity_liter: 1000 }],
    }, 'actor-1');
    await fuelInventory.postTransaction(tr.id, 'actor-1');
    const trIn = await fuelInventory.createDraft({
      transaction_type: 'transfer_in', operational_date: '2026-09-23', product_id: 'P1',
      destination_location_id: 'TRUCK-1', lines: [{ direction: 'in', quantity_liter: 1000 }],
    }, 'actor-1');
    await fuelInventory.postTransaction(trIn.id, 'actor-1');
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), -1000);
    assert.equal(await fuelInventory.getBalance({ location_id: 'TRUCK-1' }), 1000);
    // Fuel log tanpa issue + issue yatim terdeteksi.
    await fuelInventory.createDraft({
      transaction_type: 'receipt', operational_date: '2026-09-23', product_id: 'P1',
      destination_location_id: 'L1', lines: [{ direction: 'in', quantity_liter: 5 }],
    }, 'actor-1');
    rek = await fuelInventory.getReconciliation({});
    assert.ok(rek.unlinkedLogs.some(r => String(r.id) === 'LOG-1') === false, 'LOG-1 tertaut');
  } finally { lepas(); }
});
