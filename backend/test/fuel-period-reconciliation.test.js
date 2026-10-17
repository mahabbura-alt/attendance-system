'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Integrasi Postgres nyata hanya bila TEST_DATABASE_URL diset (DB sekali pakai, skema 048–051 + stub).
// Jangan pernah mengarahkannya ke database produksi: tes ini menulis transaksi.
const DB_URL = process.env.TEST_DATABASE_URL || null;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const fuelInventory = require('../src/services/fuelInventory');

test('susunRekonsiliasi: saldo buku = awal + masuk − keluar ± penyesuaian (netto reversal di delta)', () => {
  const r = fuelInventory.susunRekonsiliasi({
    location_id: 'L1', product_id: 'P1', opening: '1000',
    d_receipt: '5000', d_transfer_in: '200', d_issue: '-1800', d_transfer_out: '-700',
    d_adj_in: '15', d_adj_out: '-5', d_other: '0',
  });
  assert.equal(r.issue_out, 1800);
  assert.equal(r.transfer_out, 700);
  assert.equal(r.adjustment_out, 5);
  assert.equal(r.closing_book, 1000 + 5000 + 200 - 1800 - 700 + 15 - 5);
  assert.equal(r.last_opname, null);
});

test('susunRekonsiliasi: opname terakhir dipetakan dengan presisi penuh', () => {
  const r = fuelInventory.susunRekonsiliasi({
    location_id: 'L1', product_id: 'P1', opening: '0',
    opname_id: 'O1', opname_date: '2026-10-05', opname_book: '1000.000', opname_physical: '976.500',
    opname_variance: '-23.500', opname_variance_pct: '-2.350000', opname_alert: true, opname_status: 'adjusted',
  });
  assert.deepEqual(r.last_opname, {
    id: 'O1', operational_date: '2026-10-05', book_quantity: 1000, physical_quantity: 976.5,
    variance_quantity: -23.5, variance_percent: -2.35, variance_alert: true, status: 'adjusted',
  });
});

test('rentang tanggal wajib & berurutan untuk kedua endpoint', async () => {
  await assert.rejects(fuelInventory.getPeriodReconciliation({ dari: '2026-10-01' }), /Rentang tanggal/);
  await assert.rejects(fuelInventory.getConsumptionBreakdown({ dari: '2026-10-09', sampai: '2026-10-01' }),
    e => e.status === 422);
});

test('integrasi DB: rekonsiliasi periode & konsumsi per unit/kelas', { skip: !DB_URL && 'TEST_DATABASE_URL tidak diset' }, async () => {
  const { pool } = require('../src/config/db');
  const q = (sql, a) => pool.query(sql, a);
  const id = async (sql, a) => (await q(sql, a)).rows[0].id;
  const user1 = await id(`INSERT INTO users DEFAULT VALUES RETURNING id`);
  const user2 = await id(`INSERT INTO users DEFAULT VALUES RETURNING id`);
  const prod = await id(`INSERT INTO fuel_products (product_code, product_name) VALUES ('BIO-T','Biosolar uji') RETURNING id`);
  const a = await id(`INSERT INTO fuel_storage_locations (location_code, location_name, storage_type) VALUES ('T-A','Tangki A','tank') RETURNING id`);
  const b = await id(`INSERT INTO fuel_storage_locations (location_code, location_name, storage_type) VALUES ('T-B','Tangki B','tank') RETURNING id`);
  const dt1 = await id(`INSERT INTO equipment (kode_alat, kelas_alat) VALUES ('DT-01','Dump Truck') RETURNING id`);
  const dt2 = await id(`INSERT INTO equipment (kode_alat, kelas_alat) VALUES ('DT-02','Dump Truck') RETURNING id`);
  const ex1 = await id(`INSERT INTO equipment (kode_alat, kelas_alat) VALUES ('EX-01','Excavator') RETURNING id`);

  const posted = async input => {
    const d = await fuelInventory.createDraft({ product_id: prod, ...input }, user1);
    return fuelInventory.postTransaction(d.id, user1);
  };
  const masuk = (tgl, qty, extra = {}) => posted({ transaction_type: 'receipt', operational_date: tgl,
    destination_location_id: a, lines: [{ direction: 'in', quantity_liter: qty, unit_price: 15000 }], ...extra });
  const isi = (tgl, qty, eq) => posted({ transaction_type: 'issue_equipment', operational_date: tgl,
    source_location_id: a, equipment_id: eq, lines: [{ direction: 'out', quantity_liter: qty }] });

  await masuk('2026-09-28', 1000);                 // sebelum periode → saldo awal
  await isi('2026-09-29', 200, dt1);               // sebelum periode
  await masuk('2026-10-02', 5000);
  await isi('2026-10-03', 300, dt1);
  await isi('2026-10-03', 450, dt2);
  const salah = await isi('2026-10-04', 999, ex1);
  await fuelInventory.reverseTransaction(salah.id, user1, 'salah input');  // netto 0
  await isi('2026-10-05', 120, ex1);
  await isi('2026-10-12', 70, ex1);                // setelah periode → diabaikan
  const tr = await fuelInventory.transferStock({ from_location_id: a, to_location_id: b, product_id: prod,
    quantity_liter: 600, operational_date: '2026-10-06' }, user1);
  assert.ok(tr.transfer_group_id);

  const op = await fuelInventory.createOpname({ location_id: b, product_id: prod, operational_date: '2026-10-07',
    physical_quantity: 590 }, user1);
  await fuelInventory.submitOpname(op.id, user1);
  await fuelInventory.approveOpname(op.id, user2, { note: 'selisih ukur' });

  const rec = await fuelInventory.getPeriodReconciliation({ dari: '2026-10-01', sampai: '2026-10-10' });
  const ra = rec.rows.find(r => r.location_code === 'T-A');
  const rb = rec.rows.find(r => r.location_code === 'T-B');
  assert.equal(ra.opening, 800);
  assert.equal(ra.receipt_in, 5000);
  assert.equal(ra.issue_out, 870, 'issue netto: reversal 999 tidak ikut');
  assert.equal(ra.transfer_out, 600);
  assert.equal(ra.closing_book, 800 + 5000 - 870 - 600);
  assert.equal(rb.transfer_in, 600);
  assert.equal(rb.closing_book, 600 + rb.adjustment_in - rb.adjustment_out);
  assert.equal(rb.last_opname.physical_quantity, 590);
  assert.equal(rb.last_opname.variance_quantity, -10);

  // Saldo buku pada tanggal hari ini sama dengan ringkasan stok (semua mutasi ≤ hari ini).
  const kini = await fuelInventory.getPeriodReconciliation({ dari: '2026-10-01', sampai: '2099-12-31' });
  const stok = await fuelInventory.getStockSummary({});
  for (const r of kini.rows) {
    const s = stok.find(x => x.location_id === r.location_id && x.product_id === r.product_id);
    assert.ok(Math.abs(s.balance_liter - r.closing_book) < 1e-6, `${r.location_code} cocok stock-summary`);
  }

  const unit = await fuelInventory.getConsumptionBreakdown({ dari: '2026-10-01', sampai: '2026-10-10', group: 'unit', limit: 2 });
  assert.equal(unit.total_liter, 870);
  assert.deepEqual(unit.items.map(i => [i.label, i.liter]), [['DT-02', 450], ['DT-01', 300]]);
  assert.equal(unit.others_liter, 120);
  const kelas = await fuelInventory.getConsumptionBreakdown({ dari: '2026-10-01', sampai: '2026-10-10', group: 'class' });
  assert.deepEqual(kelas.items.map(i => [i.label, i.liter, i.unit_count]), [['Dump Truck', 750, 2], ['Excavator', 120, 1]]);

  // Buku transaksi: tujuan transfer, harga tertimbang, kode unit untuk tampilan workspace.
  const keluar = await fuelInventory.getLedger({ type: 'transfer_out' });
  assert.equal(keluar[0].transfer_to_code, 'T-B');
  const terima = await fuelInventory.getLedger({ type: 'receipt', dari: '2026-10-02', sampai: '2026-10-02' });
  assert.equal(Number(terima[0].unit_price), 15000);
  const isiUnit = await fuelInventory.getLedger({ type: 'issue_equipment', dari: '2026-10-05', sampai: '2026-10-05' });
  assert.equal(isiUnit[0].equipment_code, 'EX-01');
  await pool.end();
});
