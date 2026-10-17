'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dbCfg = require('../src/config/db');
const fuelInventory = require('../src/services/fuelInventory');

function pasangMock() {
  const mem = { seq: 900, tx: new Map(), lines: [], audit: [], layers: [], allocs: [] };
  let snap = null;
  const foto = () => structuredClone({ tx: [...mem.tx], lines: mem.lines, layers: mem.layers, allocs: mem.allocs });
  const pulih = s => { mem.tx = new Map(s.tx); mem.lines = s.lines; mem.layers = s.layers; mem.allocs = s.allocs; };
  const garisAktif = tx => tx.status !== 'reversed' && tx.status !== 'void';
  const oldConnect = dbCfg.pool.connect;
  const lamaQuery = dbCfg.pool.query;
  const palsu = async (sql, args = []) => {
    if (sql === 'BEGIN') { snap = foto(); return { rows: [] }; }
    if (sql === 'COMMIT') { snap = null; return { rows: [] }; }
    // Kunci baris header (ambilTransaksi forUpdate) — tidak mengubah state mock.
    if (sql.includes('SELECT id FROM fuel_inventory_transactions WHERE id = $1 FOR UPDATE')) return { rows: [] };
    if (sql === 'ROLLBACK') { if (snap) pulih(snap); snap = null; return { rows: [] }; }
    if (sql.includes("nextval('fuel_inventory_transaction_seq')")) {
      if (sql.includes('AS a')) { mem.seq += 2; return { rows: [{ a: mem.seq - 1, b: mem.seq }] }; }
      mem.seq += 1; return { rows: [{ seq: mem.seq }] };
    }
    if (sql.includes('FROM fuel_inventory_transactions WHERE idempotency_key')) {
      const ketemu = [...mem.tx.values()].find(t => t.idempotency_key && t.idempotency_key === args[0]
        && t.status !== 'reversed' && t.status !== 'void');
      return { rows: ketemu ? [{ id: ketemu.id, transfer_group_id: ketemu.transfer_group_id || null }] : [] };
    }
    if (sql.includes('FROM fuel_inventory_transactions WHERE fuel_log_id')) {
      const ketemu = [...mem.tx.values()].find(t => String(t.fuel_log_id) === String(args[0]) && garisAktif(t));
      return { rows: ketemu ? [{ ...ketemu }] : [] };
    }
    if (sql.includes('WHERE transfer_group_id = $1')) {
      return { rows: [...mem.tx.values()].filter(t => String(t.transfer_group_id) === String(args[0])) };
    }
    if (sql.includes('SELECT id, transfer_group_id FROM fuel_inventory_transactions WHERE idempotency_key')) {
      const ketemu = [...mem.tx.values()].find(t => t.idempotency_key && t.idempotency_key === args[0]
        && t.status !== 'reversed' && t.status !== 'void');
      return { rows: ketemu ? [{ id: ketemu.id, transfer_group_id: ketemu.transfer_group_id || null }] : [] };
    }
    if (sql.includes('WHERE transfer_group_id = $1')) {
      return { rows: [...mem.tx.values()].filter(t => String(t.transfer_group_id) === String(args[0])).map(t => ({ ...t })) };
    }
    if (sql.includes('INSERT INTO fuel_inventory_transactions') && sql.includes('transfer_group_id,') && !sql.includes('fuel_log_id')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[3], source_location_id: args[4], destination_location_id: args[5],
        transfer_group_id: args[6], status: 'draft', source_type: args[7], reason: args[8],
        idempotency_key: args[9], created_by: args[10], lines: [] });
      return { rows: [{ ...mem.tx.get(id) }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_transactions') && !sql.includes('reversal_of_transaction_id')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[5], source_location_id: args[6], destination_location_id: args[7],
        equipment_id: args[8], operator_id: args[9], fuel_log_id: args[10], document_number: args[11],
        transfer_group_id: args[13] !== undefined ? args[13] : null,
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
      const jml = mem.lines.filter(l => String(l.transaction_id) === String(args[0]))
        .reduce((t, l) => t + Number(l.quantity_liter), 0);
      return { rows: [{ jml }] };
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
    if (sql.includes('SUM(a.allocated_quantity * a.unit_cost_snapshot)')) {
      // Service memanggil dengan $1 = TRANSACTION id (WHERE l.transaction_id = $1).
      let nilai = 0; let qty = 0;
      for (const a of mem.allocs) {
        const line = mem.lines.find(l => String(l.id) === String(a.outbound_line_id));
        if (!line || String(line.transaction_id) !== String(args[0])) continue;
        if (a.unit_cost_snapshot == null) continue;
        nilai += Number(a.allocated_quantity) * Number(a.unit_cost_snapshot);
        qty += Number(a.allocated_quantity);
      }
      return { rows: [{ nilai, qty }] };
    }
    if (sql.includes('UPDATE fuel_inventory_lines SET unit_price')) {
      // Bentuk query: SET unit_price = $2 WHERE transaction_id = $1
      for (const l of mem.lines) {
        if (String(l.transaction_id) === String(args[0])) l.unit_price = args[1];
      }
      return { rows: [] };
    }
    if (sql.includes('FROM fuel_fifo_allocations a')) {
      const lineIds = new Set(mem.lines.filter(l => String(l.transaction_id) === String(args[0])).map(l => String(l.id)));
      return { rows: mem.allocs.filter(a => lineIds.has(String(a.outbound_line_id))).map(a => ({ ...a })) };
    }
    if (sql.includes('FROM fuel_fifo_layers WHERE receipt_line_id IN')) {
      const ids = new Set(mem.lines.filter(l => String(l.transaction_id) === String(args[0])).map(l => String(l.id)));
      return { rows: mem.layers.filter(l => ids.has(String(l.receipt_line_id))).map(l => ({ ...l })) };
    }
    if (sql.includes("UPDATE fuel_fifo_layers SET status = 'reversed'")) {
      const layer = mem.layers.find(l => String(l.id) === String(args[0]));
      if (layer) layer.status = 'reversed';
      return { rows: [] };
    }
    if (sql.includes('UPDATE fuel_fifo_layers SET remaining_quantity = remaining_quantity +')) {
      const layer = mem.layers.find(l => String(l.id) === String(args[0]));
      if (layer) { layer.remaining_quantity = Number(layer.remaining_quantity) + Number(args[1]); layer.status = 'open'; }
      return { rows: [] };
    }
    if (sql.includes('FROM fuel_fifo_layers l')) {
      // Service membangun params dinamis: [location?, product?, status?].
      // Posisi product dilewati bila null, jadi cocokkan tiap arg ke product ATAU status.
      const cocok = (l, a) => a == null || String(l.product_id) === String(a) || String(l.status) === String(a);
      return { rows: mem.layers
        .filter(l => (args[0] == null || String(l.location_id) === String(args[0]))
          && cocok(l, args[1]) && cocok(l, args[2]))
        .map(l => ({ ...l })) };
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

async function terima(tanggal, lokasi, qty, harga, batch, memRef) {
  const draf = await fuelInventory.createDraft({
    transaction_type: 'receipt', operational_date: tanggal, product_id: 'P1',
    destination_location_id: lokasi, document_number: batch,
    lines: [{ direction: 'in', quantity_liter: qty, unit_price: harga, batch_number: batch }],
  }, 'actor-1');
  await fuelInventory.postTransaction(draf.id, 'actor-1');
  return draf.id;
}

test('konsumsi partial + multi-layer oldest-first + cost snapshot', async () => {
  const { mem, lepas } = pasangMock();
  try {
    await terima('2026-09-20', 'DEPOT', 1000, 10, 'B-A');
    await terima('2026-09-21', 'DEPOT', 1000, 12, 'B-B');
    const keluar = await fuelInventory.createDraft({
      transaction_type: 'issue_equipment', operational_date: '2026-09-22', product_id: 'P1',
      source_location_id: 'DEPOT', equipment_id: 'EX-1',
      lines: [{ direction: 'out', quantity_liter: 1500 }],
    }, 'actor-1');
    await fuelInventory.postTransaction(keluar.id, 'actor-1');
    assert.equal(mem.allocs.length, 2, 'terbagi 2 layer');
    assert.deepEqual(mem.allocs.map(a => a.allocated_quantity), [1000, 500]);
    assert.deepEqual(mem.allocs.map(a => a.unit_cost_snapshot), [10, 12]);
    const sisa = Object.fromEntries(mem.layers.filter(l => l.location_id === 'DEPOT').map(l => [l.batch_number, l.remaining_quantity]));
    assert.deepEqual(sisa, { 'B-A': 0, 'B-B': 500 });
    assert.equal(mem.layers.find(l => l.batch_number === 'B-A').status, 'exhausted');
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 500);
  } finally { lepas(); }
});

test('stok negatif diblokir; tidak ada tulisan parsial', async () => {
  const { mem, lepas } = pasangMock();
  try {
    await terima('2026-09-20', 'DEPOT', 100, 10, 'B-A');
    await assert.rejects(() => fuelInventory.createDraft({
      transaction_type: 'issue_equipment', operational_date: '2026-09-22', product_id: 'P1',
      source_location_id: 'DEPOT', equipment_id: 'EX-1',
      lines: [{ direction: 'out', quantity_liter: 9999 }],
    }).then(d => fuelInventory.postTransaction(d.id, 'actor-1')), /tidak mencukupi/);
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 100);
    assert.equal(mem.tx.size, 2, 'draft gagal-post tetap draft, tidak menambah layer');
  } finally { lepas(); }
});

test('transfer atomik depot-truck + retry idempoten', async () => {
  const { mem, lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-SEED');
    await terima('2026-09-20', 'DEPOT', 1000, 10, 'B-A');
    const r1 = await fuelInventory.transferStock({
      from_location_id: 'DEPOT', to_location_id: 'TRUCK-1', product_id: 'P1',
      quantity_liter: 300, operational_date: '2026-09-22', idempotency_key: 'tr-1',
    }, 'actor-1');
    assert.equal(r1.duplicate, false);
    assert.equal(r1.transactions.length, 2);
    const pair = await fuelInventory.getAllocations({ transaction_id: r1.transactions[0] });
    void pair;
    // Seed: 1000 + 1000 = 2000 di DEPOT; transfer 300 → DEPOT 1700, TRUCK-1 300.
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 1700);
    assert.equal(await fuelInventory.getBalance({ location_id: 'TRUCK-1' }), 300);
    const lapisan = await fuelInventory.getFifoLayers({ location_id: 'TRUCK-1' });
    assert.equal(lapisan.length, 1);
    assert.equal(Number(lapisan[0].remaining_quantity), 300);
    assert.equal(Number(lapisan[0].unit_cost), 10, 'cost snapshot dari layer FIFO tertua (B-SEED @10)');
    const r2 = await fuelInventory.transferStock({
      from_location_id: 'DEPOT', to_location_id: 'TRUCK-1', product_id: 'P1',
      quantity_liter: 300, operational_date: '2026-09-22', idempotency_key: 'tr-1',
    }, 'actor-1');
    assert.equal(r2.duplicate, true);
    assert.equal(r2.transactions.length, 2);
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 1700, 'retry tidak ganda');
  } finally { lepas(); }
});

test('reversal salah satu kaki transfer membalik kedua kaki secara atomik', async () => {
  const { lepas } = pasangMock();
  try {
    await terima('2026-09-20', 'DEPOT', 1000, 10, 'B-A');
    const transfer = await fuelInventory.transferStock({
      from_location_id: 'DEPOT', to_location_id: 'TRUCK-1', product_id: 'P1',
      quantity_liter: 300, operational_date: '2026-09-22', idempotency_key: 'tr-reverse',
    }, 'actor-1');
    const result = await fuelInventory.reverseTransaction(transfer.transactions[0], 'actor-1', 'transfer dibatalkan');
    assert.equal(result.grouped, true);
    assert.equal(result.original_ids.length, 2);
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 1000);
    assert.equal(await fuelInventory.getBalance({ location_id: 'TRUCK-1' }), 0);
  } finally { lepas(); }
});

test('reversal mengembalikan layer asal; receipt tersentuh-ditolak', async () => {
  const { mem, lepas } = pasangMock();
  try {
    const idR = await terima('2026-09-20', 'DEPOT', 1000, 10, 'B-A');
    const keluar = await fuelInventory.createDraft({
      transaction_type: 'issue_equipment', operational_date: '2026-09-22', product_id: 'P1',
      source_location_id: 'DEPOT', equipment_id: 'EX-1',
      lines: [{ direction: 'out', quantity_liter: 400 }],
    }, 'actor-1');
    await fuelInventory.postTransaction(keluar.id, 'actor-1');
    await fuelInventory.reverseTransaction(keluar.id, 'actor-1', 'salah unit');
    const layer = mem.layers.find(l => l.batch_number === 'B-A');
    assert.equal(Number(layer.remaining_quantity), 1000, 'kembali utuh ke layer asal');
    assert.equal(layer.status, 'open');
    assert.equal(await fuelInventory.getBalance({ location_id: 'DEPOT' }), 1000);
    // Receipt yang layernya sudah terpakai sebagian tidak bisa direversal.
    const keluar2 = await fuelInventory.createDraft({
      transaction_type: 'issue_equipment', operational_date: '2026-09-22', product_id: 'P1',
      source_location_id: 'DEPOT', equipment_id: 'EX-2',
      lines: [{ direction: 'out', quantity_liter: 100 }],
    }, 'actor-1');
    await fuelInventory.postTransaction(keluar2.id, 'actor-1');
    await assert.rejects(() => fuelInventory.reverseTransaction(idR, 'actor-1', 'batal'), /sudah terpakai/);
  } finally { lepas(); }
});
