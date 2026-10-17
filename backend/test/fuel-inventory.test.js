'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Uji service dengan pool mock (tanpa database). Meniru pola
// production-fuel-batch-api.test.js: alihkan pool.connect ke klien palsu.
const dbCfg = require('../src/config/db');
const fuelInventory = require('../src/services/fuelInventory');

function pasangMock(tabel) {
  const mem = {
    seq: 100,
    tx: new Map(),
    lines: [],
    audit: [],
    ...tabel,
  };
  const oldConnect = dbCfg.pool.connect;
  const lamaQuery = dbCfg.pool.query;
  const palsu = async (sql, args = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    // Kunci baris header (ambilTransaksi forUpdate) — tidak mengubah state mock.
    if (sql.includes('SELECT id FROM fuel_inventory_transactions WHERE id = $1 FOR UPDATE')) return { rows: [] };
    if (sql.includes("nextval('fuel_inventory_transaction_seq')")) {
      mem.seq += 1;
      return { rows: [{ seq: mem.seq }] };
    }
    if (/FROM fuel_inventory_transactions\s+WHERE idempotency_key/.test(sql)) {
      const ketemu = [...mem.tx.values()].find(t => t.idempotency_key && t.idempotency_key === args[0]);
      return { rows: ketemu ? [{ id: ketemu.id }] : [] };
    }
    if (sql.includes('FROM fuel_inventory_transactions WHERE fuel_log_id')) {
      const ketemu = [...mem.tx.values()].find(t => t.fuel_log_id === args[0] && t.status !== 'reversed' && t.status !== 'void');
      return { rows: ketemu ? [{ id: ketemu.id }] : [] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_transactions') && !sql.includes('reversal_of_transaction_id')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, {
        id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[5], source_location_id: args[6], destination_location_id: args[7],
        equipment_id: args[8], fuel_log_id: args[10], status: 'draft', source_type: args[14],
        reason: args[15], idempotency_key: args[16], created_by: args[17], lines: [],
      });
      return { rows: [mem.tx.get(id)] };
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
      return { rows: t ? [t] : [] };
    }
    if (sql.includes("SET status = 'reversed'")) {
      const target = mem.tx.get(args[0]);
      if (target) { target.status = 'reversed'; target.reversed_by = args[1]; }
      return { rows: [] };
    }
    if (sql.includes("SET status = 'void'")) {
      const target = mem.tx.get(args[0]);
      if (target) target.status = 'void';
      return { rows: [{ ...target }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_transactions') && sql.includes('reversal_of_transaction_id')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: 'reversal',
        operational_date: args[1], product_id: args[2], source_location_id: args[3],
        destination_location_id: args[4], equipment_id: args[5], status: 'posted',
        source_type: 'system_reversal', reversal_of_transaction_id: args[7], lines: [] });
      return { rows: [mem.tx.get(id)] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_audit')) {
      mem.audit.push({ entity: args[0], id: args[1], action: args[2] });
      return { rows: [] };
    }
    if (sql.includes('FROM fuel_inventory_lines l')) {
      // Saldo menghitung posted + reversed (original yang direversal tetap tercatat).
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

test('validasi menolak input tak sah', async () => {
  const { lepas } = pasangMock();
  try {
    await assert.rejects(() => fuelInventory.createDraft({ transaction_type: 'X', lines: [] }), /Jenis transaksi/);
    await assert.rejects(() => fuelInventory.createDraft(
      { transaction_type: 'receipt', operational_date: '2026-09-23', product_id: 'p1', lines: [] }),
      /Minimal satu baris/);
    await assert.rejects(() => fuelInventory.createDraft(
      { transaction_type: 'receipt', operational_date: '2026-09-23', product_id: 'p1',
        destination_location_id: 'L1', lines: [{ direction: 'in', quantity_liter: 0 }] }),
      /harus > 0/);
    await assert.rejects(() => fuelInventory.createDraft(
      { transaction_type: 'receipt', operational_date: '2026-09-23', product_id: 'p1',
        lines: [{ direction: 'in', quantity_liter: 10 }] }),
      /lokasi tujuan/);
  } finally { lepas(); }
});

test('draft -> post memengaruhi saldo; idempotency mencegah ganda', async () => {
  const { mem, lepas } = pasangMock();
  try {
    const draf = await fuelInventory.createDraft({
      transaction_type: 'receipt', operational_date: '2026-09-23', product_id: 'P1',
      destination_location_id: 'L1', document_number: 'PO-1', idempotency_key: 'k-1',
      lines: [{ direction: 'in', quantity_liter: 1000 }],
    }, 'actor-1');
    assert.match(draf.transaction_number, /^FI-20260923-\d+$/);
    assert.equal(draf.status, 'draft');
    const ulang = await fuelInventory.createDraft({
      transaction_type: 'receipt', operational_date: '2026-09-23', product_id: 'P1',
      destination_location_id: 'L1', idempotency_key: 'k-1',
      lines: [{ direction: 'in', quantity_liter: 1000 }],
    }, 'actor-1');
    assert.equal(ulang.id, draf.id, 'kunci sama = transaksi sama');
    assert.equal(mem.tx.size, 1);
    await fuelInventory.postTransaction(draf.id, 'actor-1');
    assert.equal((await fuelInventory.getBalance({ location_id: 'L1' })), 1000);
    await assert.rejects(() => fuelInventory.postTransaction(draf.id, 'actor-1'), /Hanya draft/);
  } finally { lepas(); }
});

test('satu fuel_log = maksimal satu issue aktif', async () => {
  const { lepas } = pasangMock();
  try {
    await fuelInventory.createDraft({
      transaction_type: 'issue_equipment', operational_date: '2026-09-23', product_id: 'P1',
      source_location_id: 'L1', equipment_id: 'EX-1', fuel_log_id: 'LOG-1',
      lines: [{ direction: 'out', quantity_liter: 100 }],
    }, 'actor-1');
    await assert.rejects(() => fuelInventory.createDraft({
      transaction_type: 'issue_equipment', operational_date: '2026-09-23', product_id: 'P1',
      source_location_id: 'L1', equipment_id: 'EX-1', fuel_log_id: 'LOG-1',
      lines: [{ direction: 'out', quantity_liter: 50 }],
    }), /maksimal satu issue/);
  } finally { lepas(); }
});

test('reversal mengembalikan saldo + audit; void hanya untuk draft', async () => {
  const { mem, lepas } = pasangMock();
  try {
    const draf = await fuelInventory.createDraft({
      transaction_type: 'receipt', operational_date: '2026-09-23', product_id: 'P1',
      destination_location_id: 'L1', lines: [{ direction: 'in', quantity_liter: 500 }],
    }, 'actor-1');
    await fuelInventory.postTransaction(draf.id, 'actor-1');
    assert.equal(await fuelInventory.getBalance({ location_id: 'L1' }), 500);
    await assert.rejects(() => fuelInventory.reverseTransaction(draf.id, 'actor-1', ''), /Alasan reversal/);
    const balik = await fuelInventory.reverseTransaction(draf.id, 'actor-1', 'salah tank');
    assert.equal(balik.transaction_type, 'reversal');
    assert.equal(await fuelInventory.getBalance({ location_id: 'L1' }), 0);
    assert.ok(mem.audit.some(a => a.action === 'reverse'));
    const draf2 = await fuelInventory.createDraft({
      transaction_type: 'receipt', operational_date: '2026-09-23', product_id: 'P1',
      destination_location_id: 'L1', lines: [{ direction: 'in', quantity_liter: 10 }],
    }, 'actor-1');
    const batal = await fuelInventory.voidDraft(draf2.id, 'actor-1');
    assert.equal(batal.status, 'void');
    await assert.rejects(() => fuelInventory.postTransaction(draf2.id, 'actor-1'), /Hanya draft/);
  } finally { lepas(); }
});
