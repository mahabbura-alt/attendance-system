'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { available, createPeopleDb } = require('./helpers/peopleFixture');
const Import = require('../src/services/peopleImport');
const People = require('../src/services/peopleEmployees');

const opt = { skip: !available };
const TODAY = '2026-10-12';

test('Helper: header, tanggal, NIK/HP sebagai angka, pemecah posisi, kemiripan', () => {
  assert.equal(Import.headerKey('Departemen · Jabatan *'), 'departemen · jabatan');
  assert.equal(Import.headerKey('Tanggal masuk (wajib)'), 'tanggal masuk');
  assert.deepEqual(Import.parseDate('19/10/2026'), { value: '2026-10-19' });
  assert.deepEqual(Import.parseDate('2026-10-19'), { value: '2026-10-19' });
  assert.deepEqual(Import.parseDate(46314), { value: '2026-10-19' });
  assert.ok(Import.parseDate('31/02/2026').error);
  assert.ok(Import.parseDate('besok').error);
  assert.deepEqual(Import.digitsCell(821553011, { phone: true }), { value: '0821553011' });
  assert.ok(Import.digitsCell(6310000000002231).error, 'NIK 16 digit sebagai angka tidak aman');
  assert.deepEqual(Import.splitPosisi('Produksi · Operator DT'), ['Produksi', 'Operator DT']);
  assert.deepEqual(Import.splitPosisi('Produksi - Operator DT'), ['Produksi', 'Operator DT']);
  assert.ok(Import.similarity('Produksi · Operator DT', 'Produksi · Operator Dump Truck') > 0.7);
  assert.ok(Import.similarity('Produksi · Operator DT', 'Logistik · Fuelman') < 0.45);
});

async function workbookFromTemplate(templateBuffer, rows) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);
  const ws = wb.getWorksheet('Karyawan');
  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    Object.entries(r).forEach(([key, value]) => {
      const col = Import.COLUMNS.findIndex(c => c.key === key) + 1;
      row.getCell(col).value = value;
    });
    row.commit();
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('Template: dropdown dari master aktif, kolom wajib, versi master', opt, async () => {
  const f = await createPeopleDb();
  try {
    const buf = await Import.buildTemplate(f.db, f.scope);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Karyawan');
    assert.equal(ws.getRow(1).getCell(3).value, 'Departemen · Jabatan *');
    const master = wb.getWorksheet('Master');
    const posisi = [];
    master.getColumn(1).eachCell((c, n) => { if (n > 1) posisi.push(c.value); });
    assert.ok(posisi.includes('Engineering · Admin') && posisi.includes('Logistik · Admin'), 'Admin dibedakan per departemen');
    assert.equal(ws.getRow(2).getCell(3).dataValidation.type, 'list');
    assert.equal(ws.getRow(2).getCell(11).numFmt, '@', 'NIK berformat teks');
    const meta = wb.getWorksheet('_meta');
    assert.equal(meta.getRow(1).getCell(2).value, Import.TEMPLATE_VERSION);
  } finally { await f.db.close(); }
});

test('Import: simulasi → padanan (ingat) → simpan; duplikat & nilai asing ditolak per baris; Void batch', opt, async () => {
  const f = await createPeopleDb();
  try {
    await People.createEmployee(f.db, f.scope, f.admin, { nama: 'Sudah Ada', email: 'ada@pim.co.id', position_id: f.positions.fuelman.id,
      hire_date: '2025-01-01', employment_type: 'PKWTT', lokasi_ids: [f.lokasi.office.id] }, { today: TODAY });
    const template = await Import.buildTemplate(f.db, f.scope);
    const file = await workbookFromTemplate(template, [
      { nama: 'Andi Pratama', email: 'andi@pim.co.id', posisi: 'Produksi · Operator Dump Truck', hire_date: new Date('2026-10-19'),
        employment_type: 'PKWT', contract_end_date: new Date('2027-10-18'), lokasi1: 'Pos Pit 3', lokasi2: 'pos pit 1', nik: '6310000000001111', phone: '0821-1111-2222' },
      { nama: 'Budi Santoso', email: 'budi@pim.co.id', posisi: 'Produksi · Operator DT', hire_date: '19/10/2026',
        employment_type: 'PKWTT', lokasi1: 'Pit 3', gender: 'L', marital_status: 'Menikah' },
      { nama: 'Citra', email: 'ADA@pim.co.id', posisi: 'Logistik · Fuelman', hire_date: '2026-10-19', employment_type: 'PKWTT', lokasi1: 'Office Batulicin' },
      { nama: 'Dedi', email: 'andi@pim.co.id', posisi: 'Logistik · Admin', hire_date: '2026-10-19', employment_type: 'PKWT', lokasi1: 'Office Batulicin' },
    ]);
    const prev = await Import.previewImport(f.db, f.scope, f.admin, { buffer: file, originalname: 'karyawan.xlsx' }, { today: TODAY });
    assert.deepEqual(prev.batch.summary, { total: 4, valid: 1, warning: 0, error: 3 });
    const byRow = n => prev.rows.find(r => r.row_no === n);
    assert.deepEqual(byRow(2).lokasi, ['Pos Pit 3', 'Pos Pit 1']);
    assert.match(byRow(4).messages.map(m => m.text).join(' '), /sudah terdaftar/);
    const dedi = byRow(5).messages.map(m => m.text).join(' ');
    assert.match(dedi, /sama dengan baris 2/);
    assert.match(dedi, /Akhir kontrak wajib/);
    assert.equal(prev.unknown.positions[0].raw, 'Produksi · Operator DT');
    assert.equal(prev.unknown.positions[0].suggestions[0].id, f.positions.operatorDt.id, 'saran terdekat');
    assert.equal(prev.unknown.locations[0].raw, 'Pit 3');
    assert.equal(prev.unknown.locations[0].suggestions[0].id, f.lokasi.pit3.id);
    const count = async () => (await f.db.query(`SELECT COUNT(*)::int AS n FROM users WHERE role='karyawan'`)).rows[0].n;
    assert.equal(await count(), 1, 'simulasi tidak menyimpan karyawan');

    const mapped = await Import.applyMappings(f.db, f.scope, f.admin, prev.batch.id, {
      positions: { 'Produksi · Operator DT': f.positions.operatorDt.id }, locations: { 'Pit 3': f.lokasi.pit3.id }, remember: true,
    }, { today: TODAY });
    assert.equal(mapped.batch.summary.error, 2);
    assert.equal(mapped.rows.find(r => r.row_no === 3).status, 'WARNING', 'dibaca sebagai … diberi tanda');
    assert.equal(mapped.unknown.positions.length, 0);

    const done = await Import.commitImport(f.db, f.scope, f.admin, prev.batch.id, { today: TODAY });
    assert.equal(done.status, 'PARTIAL');
    assert.equal(done.committed, 2);
    assert.equal(done.skipped, 2);
    assert.equal(done.invites.length, 2);
    await assert.rejects(Import.commitImport(f.db, f.scope, f.admin, prev.batch.id, { today: TODAY }), err => err.statusCode === 409);
    assert.equal(await count(), 3);
    const budi = (await People.getDirectory(f.db, f.scope, { q: 'Budi', today: TODAY })).rows[0];
    assert.equal(budi.jabatan, 'Operator Dump Truck');
    const audit = (await f.db.query(`SELECT entity FROM workforce_employee_field_audit WHERE field = 'create' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.equal(audit.entity, 'IMPORT');

    // Padanan yang diingat langsung dipakai pada import berikutnya.
    const file2 = await workbookFromTemplate(template, [
      { nama: 'Eka', email: 'eka@pim.co.id', posisi: 'produksi · operator dt', hire_date: '2026-10-19', employment_type: 'PKWTT', lokasi1: 'PIT 3' },
    ]);
    const prev2 = await Import.previewImport(f.db, f.scope, f.admin, { buffer: file2, originalname: 'b.xlsx' }, { today: TODAY });
    assert.equal(prev2.rows[0].status, 'WARNING');
    assert.ok(prev2.notices.some(n => /master versi/.test(n)), 'master berubah setelah template dibuat');

    const v = await Import.voidImport(f.db, f.scope, f.admin, prev.batch.id, { reason: 'Salah file import' }, { today: TODAY });
    assert.equal(v.voided, 2);
    assert.equal(await count(), 3, 'Void tidak menghapus baris users');
    const active = (await People.getDirectory(f.db, f.scope, { today: TODAY })).rows.map(r => r.nama);
    assert.deepEqual(active, ['Sudah Ada']);
    const hist = await Import.listBatches(f.db, f.scope);
    assert.equal(hist.find(b => b.id === prev.batch.id).status, 'VOIDED');
  } finally { await f.db.close(); }
});

test('Import: file bukan xlsx / kolom wajib hilang ditolak dengan pesan jelas', opt, async () => {
  const f = await createPeopleDb();
  try {
    await assert.rejects(Import.previewImport(f.db, f.scope, f.admin, { buffer: Buffer.from('nama,email\n'), originalname: 'a.csv' }), /xlsx/);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Karyawan');
    ws.addRow(['Nama', 'Email']);
    ws.addRow(['X', 'x@pim.co.id']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await assert.rejects(Import.previewImport(f.db, f.scope, f.admin, { buffer: buf, originalname: 'a.xlsx' }), /Departemen · Jabatan/);
  } finally { await f.db.close(); }
});
