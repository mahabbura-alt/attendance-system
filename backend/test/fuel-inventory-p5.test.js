'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dbCfg = require('../src/config/db');
const fuelInventory = require('../src/services/fuelInventory');

function pasangMock() {
  const mem = { seq: 900, order: 0, tx: new Map(), lines: [], audit: [], layers: [], allocs: [], opnames: [] };
  let snap = null;
  const foto = () => structuredClone({ tx: [...mem.tx], lines: mem.lines, layers: mem.layers, allocs: mem.allocs, opnames: mem.opnames });
  const pulih = s => { mem.tx = new Map(s.tx); mem.lines = s.lines; mem.layers = s.layers; mem.allocs = s.allocs; mem.opnames = s.opnames; };
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
    if (sql === 'BEGIN') { snap = foto(); return { rows: [] }; }
    if (sql === 'COMMIT') { snap = null; return { rows: [] }; }
    // Kunci baris header (ambilTransaksi forUpdate) — tidak mengubah state mock.
    if (sql.includes('SELECT id FROM fuel_inventory_transactions WHERE id = $1 FOR UPDATE')) return { rows: [] };
    if (sql === 'ROLLBACK') { if (snap) pulih(snap); snap = null; return { rows: [] }; }
    if (sql.includes("nextval('fuel_inventory_transaction_seq')")) {
      mem.seq += 1; return { rows: [{ seq: mem.seq }] };
    }
    // --- P5 agregat (hitung di JS, tiru semantik SQL service) ---
    if (sql.includes('fuel_stock_summary')) {
      const combo = new Map();
      for (const t of mem.tx.values()) {
        if (t.status !== 'posted' && t.status !== 'reversed') continue;
        if (t.destination_location_id) combo.set(`${t.destination_location_id}|${t.product_id}`, { location_id: t.destination_location_id, product_id: t.product_id });
        if (t.source_location_id) combo.set(`${t.source_location_id}|${t.product_id}`, { location_id: t.source_location_id, product_id: t.product_id });
      }
      for (const l of mem.layers) combo.set(`${l.location_id}|${l.product_id}`, { location_id: l.location_id, product_id: l.product_id });
      const rows = [];
      for (const c of combo.values()) {
        if (args[0] != null && String(c.location_id) !== String(args[0])) continue;
        if (args[1] != null && String(c.product_id) !== String(args[1])) continue;
        const lapis = mem.layers.filter(l => String(l.location_id) === String(c.location_id)
          && String(l.product_id) === String(c.product_id) && (l.status === 'open' || l.status === 'exhausted'));
        rows.push({ location_id: c.location_id, location_code: c.location_id, location_name: c.location_id,
          product_id: c.product_id, product_code: c.product_id,
          balance_liter: saldoKombinasi(c.location_id, c.product_id),
          fifo_liter: lapis.reduce((t, l) => t + Number(l.remaining_quantity), 0),
          fifo_value_idr: lapis.filter(l => l.unit_cost != null).reduce((t, l) => t + Number(l.remaining_quantity) * Number(l.unit_cost), 0),
          open_layers: lapis.filter(l => l.status === 'open').length,
          unknown_cost_layers: lapis.filter(l => l.unit_cost == null && Number(l.remaining_quantity) > 0).length });
      }
      return { rows };
    }
    if (sql.includes('fuel_flow_series')) {
      const perTanggal = new Map();
      for (const t of mem.tx.values()) {
        if (t.status !== 'posted' && t.status !== 'reversed') continue;
        const tgl = String(t.operational_date).slice(0, 10);
        if (args[2] != null && tgl < String(args[2])) continue;
        if (args[3] != null && tgl > String(args[3])) continue;
        if (args[0] != null && String(t.source_location_id) !== String(args[0]) && String(t.destination_location_id) !== String(args[0])) continue;
        if (args[1] != null && String(t.product_id) !== String(args[1])) continue;
        if (!perTanggal.has(tgl)) perTanggal.set(tgl, { tanggal: tgl, masuk: 0, keluar: 0, issue: 0 });
        const agg = perTanggal.get(tgl);
        for (const l of (t.lines || [])) {
          if (l.direction === 'in' && (args[0] == null || String(t.destination_location_id) === String(args[0]))) agg.masuk += Number(l.quantity_liter);
          if (l.direction === 'out' && (args[0] == null || String(t.source_location_id) === String(args[0]))) {
            agg.keluar += Number(l.quantity_liter);
            if (t.transaction_type === 'issue_equipment') agg.issue += Number(l.quantity_liter);
          }
        }
      }
      return { rows: [...perTanggal.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal)) };
    }
    if (sql.includes('fuel_usage_issue_total')) {
      let total = 0;
      for (const t of mem.tx.values()) {
        if (t.transaction_type !== 'issue_equipment') continue;
        if (t.status !== 'posted' && t.status !== 'reversed') continue;
        const tgl = String(t.operational_date).slice(0, 10);
        if (tgl < String(args[2]) || tgl > String(args[3])) continue;
        if (args[0] != null && String(t.source_location_id) !== String(args[0])) continue;
        if (args[1] != null && String(t.product_id) !== String(args[1])) continue;
        for (const l of (t.lines || [])) if (l.direction === 'out') total += Number(l.quantity_liter);
      }
      return { rows: [{ total }] };
    }
    // --- ledger (dgn running balance; filter dipetakan dari SQL, bukan posisi) ---
    if (sql.includes('running_balance')) {
      const ambil = re => { const m = sql.match(re); return m ? args[Number(m[1]) - 1] : undefined; };
      const fDari = ambil(/t\.operational_date >= \$(\d+)/);
      const fSampai = ambil(/t\.operational_date <= \$(\d+)/);
      const fLok = ambil(/t\.source_location_id = \$(\d+)/);
      const fProd = ambil(/t\.product_id = \$(\d+)/);
      const fType = ambil(/t\.transaction_type = \$(\d+)/);
      const fStatus = ambil(/t\.status = \$(\d+)/);
      const semua = [...mem.tx.values()]
        .filter(t => {
          const tgl = String(t.operational_date).slice(0, 10);
          if (fDari != null && tgl < String(fDari)) return false;
          if (fSampai != null && tgl > String(fSampai)) return false;
          if (fLok != null && String(t.source_location_id) !== String(fLok) && String(t.destination_location_id) !== String(fLok)) return false;
          if (fProd != null && String(t.product_id) !== String(fProd)) return false;
          if (fType != null && String(t.transaction_type) !== String(fType)) return false;
          if (fStatus != null && String(t.status) !== String(fStatus)) return false;
          return true;
        })
        .sort((a, b) => String(a.operational_date).localeCompare(String(b.operational_date)) || a.urutan - b.urutan);
      let jalan = 0;
      const dgnSaldo = semua.map(t => {
        const neto = (t.lines || []).reduce((s, l) => s + (l.direction === 'in' ? Number(l.quantity_liter) : -Number(l.quantity_liter)), 0);
        jalan += neto;
        return { id: t.id, operational_date: t.operational_date, transaction_number: t.transaction_number,
          transaction_type: t.transaction_type, status: t.status,
          source_code: t.source_location_id, destination_code: t.destination_location_id,
          product_code: t.product_id, running_balance: jalan };
      });
      dgnSaldo.sort((a, b) => String(b.operational_date).localeCompare(String(a.operational_date)) || b.id.localeCompare(a.id));
      const off = Number(ambil(/OFFSET \$(\d+)/)) || 0;
      const lim = Number(ambil(/LIMIT \$(\d+)/)) || 200;
      return { rows: dgnSaldo.slice(off, off + lim) };
    }
    // --- opname list (export) ---
    if (sql.includes('FROM fuel_stock_opnames')) {
      return { rows: mem.opnames.map(o => ({ ...o })) };
    }
    // --- transaksi dasar ---
    if (sql.includes('INSERT INTO fuel_inventory_transactions')) {
      const id = `tx-${mem.tx.size + 1}`;
      mem.tx.set(id, { id, transaction_number: args[0], transaction_type: args[1], operational_date: args[2],
        product_id: args[5], source_location_id: args[6], destination_location_id: args[7],
        equipment_id: args[8] || null, status: 'draft', lines: [], urutan: mem.order++ });
      return { rows: [{ ...mem.tx.get(id) }] };
    }
    if (sql.includes('INSERT INTO fuel_inventory_lines')) {
      const baris = { id: `ln-${mem.lines.length + 1}`, transaction_id: args[0], direction: args[1],
        quantity_liter: Number(args[2]), unit_price: args[3] == null ? null : Number(args[3]) };
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
      mem.audit.push({ action: args[2] });
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

async function pakai(tanggal, lokasi, qty) {
  const draf = await fuelInventory.createDraft({ transaction_type: 'issue_equipment', operational_date: tanggal,
    product_id: 'P1', source_location_id: lokasi, equipment_id: 'EX-1',
    lines: [{ direction: 'out', quantity_liter: qty }] }, 'actor-1');
  await fuelInventory.postTransaction(draf.id, 'actor-1');
  return draf.id;
}

test('summary: saldo, FIFO, nilai, unknown-cost', async () => {
  const { lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-A');
    await pakai('2026-09-20', 'DEPOT', 300);
    const ringkas = await fuelInventory.getStockSummary({ location_id: 'DEPOT' });
    assert.equal(ringkas.length, 1);
    assert.equal(ringkas[0].balance_liter, 700);
    assert.equal(ringkas[0].fifo_liter, 700);
    assert.equal(ringkas[0].fifo_value_idr, 7000);
    assert.equal(ringkas[0].open_layers, 1);
    assert.equal(ringkas[0].unknown_cost_layers, 0);
  } finally { lepas(); }
});

test('flow series harian + usage stats kalender', async () => {
  const { lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 1000, 10, 'B-A');
    await pakai('2026-09-20', 'DEPOT', 300);
    const arus = await fuelInventory.getFlowSeries({ dari: '2026-09-19', sampai: '2026-09-22', location_id: 'DEPOT' });
    assert.deepEqual(arus.map(r => r.tanggal), ['2026-09-19', '2026-09-20']);
    assert.deepEqual([arus[0].masuk, arus[0].keluar, arus[0].issue], [1000, 0, 0]);
    assert.deepEqual([arus[1].masuk, arus[1].keluar, arus[1].issue], [0, 300, 300]);
    const stat = await fuelInventory.getUsageStats({ dari: '2026-09-19', sampai: '2026-09-22', location_id: 'DEPOT' });
    assert.equal(stat.day_count, 4);
    assert.equal(stat.total_issue_liter, 300);
    assert.equal(stat.adu_liter_per_day, 75);
    assert.equal(stat.basis, 'calendar');
    assert.equal(stat.formula_version, 'v1');
    assert.equal(stat.closing_stock_liter, 700);
    assert.equal(stat.days_of_stock, 700 / 75);
    const tanpaLokasi = await fuelInventory.getUsageStats({ dari: '2026-09-19', sampai: '2026-09-22' });
    assert.equal(tanpaLokasi.closing_stock_liter, null);
    assert.equal(tanpaLokasi.days_of_stock, null);
    await assert.rejects(() => fuelInventory.getUsageStats({ dari: '2026-09-22', sampai: '2026-09-19' }), /setelah/);
    await assert.rejects(() => fuelInventory.getUsageStats({}), /Rentang/);
  } finally { lepas(); }
});

test('ledger paginasi offset + export CSV jujur', async () => {
  const { lepas } = pasangMock();
  try {
    await terima('2026-09-19', 'DEPOT', 100, 10, 'B-1');
    await terima('2026-09-20', 'DEPOT', 200, 10, 'B-2');
    await terima('2026-09-21', 'DEPOT', 300, 10, 'B-3');
    const hal1 = await fuelInventory.getLedger({ limit: 2, offset: 0 });
    const hal2 = await fuelInventory.getLedger({ limit: 2, offset: 2 });
    assert.equal(hal1.length, 2);
    assert.equal(hal2.length, 1);
    assert.ok(!hal1.some(r => hal2.some(s => s.id === r.id)), 'halaman tidak tumpang tindih');
    const ex = await fuelInventory.buildExport({ type: 'ledger', location_id: 'DEPOT' });
    assert.ok(ex.filename.startsWith('database-fuel-ledger-'));
    assert.ok(ex.csv.includes('# unit: L (observed Liter)'));
    assert.ok(ex.csv.includes('# formula_version: v1'));
    assert.ok(ex.csv.includes('"location_id":"DEPOT"'), 'filter tercantum');
    assert.ok(ex.csv.includes('transaction_number'), 'kolom tercantum');
    assert.ok(ex.csv.includes('B-3') || ex.csv.includes('FI-20260921'), 'data terbaris');
    const exSum = await fuelInventory.buildExport({ type: 'summary' });
    assert.ok(exSum.csv.includes('balance_liter'));
    const exFlow = await fuelInventory.buildExport({ type: 'flow', dari: '2026-09-19', sampai: '2026-09-21' });
    assert.ok(exFlow.csv.includes('2026-09-19'));
  } finally { lepas(); }
});
