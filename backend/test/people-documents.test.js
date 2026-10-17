'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createPeopleDb } = require('./helpers/peopleFixture');
const People = require('../src/services/peopleEmployees');
const Docs = require('../src/services/peopleDocuments');
const Storage = require('../src/services/storage');

const opt = { skip: !available };

function memoryStorage() {
  const files = new Map();
  return {
    files,
    async uploadDocument(buffer, { profileId, docType }) {
      const key = `people/${profileId}/${files.size + 1}-${docType.toLowerCase()}.pdf`;
      files.set(key, Buffer.from(buffer));
      return key;
    },
    async readDocument(key) { return files.get(key) || null; },
    async removeDocument(key) { files.delete(key); },
  };
}

const pdf = (text) => ({ originalname: `${text}.pdf`, buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`) });

async function newEmployee(f) {
  return People.createEmployee(f.db, f.scope, f.admin, {
    nama: 'Rizky Ananda', email: 'rizky@pim.co.id', position_id: f.positions.operatorDt.id,
    hire_date: '2026-10-19', employment_type: 'PKWTT', lokasi_ids: [f.lokasi.pit3.id],
  }, { today: '2026-10-12' });
}

test('isPdf & safeFilename', () => {
  assert.equal(Docs.isPdf(Buffer.from('%PDF-1.7 ...')), true);
  assert.equal(Docs.isPdf(Buffer.from('<html>%PDF-')), false);
  assert.equal(Docs.safeFilename('../../etc/passwd'), 'passwd.pdf');
  assert.equal(Docs.safeFilename('CV Rizky "final".pdf'), 'CV Rizky _final_.pdf');
});

test('Storage: kunci dokumen tidak bisa dibaca lewat /api/storage/view (publik)', async () => {
  let status = null;
  const res = { status(code) { status = code; return this; }, send() { return this; } };
  await Storage.streamFoto('people/abc/1-cv.pdf', res);
  assert.equal(status, 404);
  assert.equal(Storage.isDocumentKey('/people/x.pdf'), true);
  assert.equal(Storage.isDocumentKey('absensi/x.jpg'), false);
});

test('Dokumen: hanya PDF ≤5 MB; CV tunggal (CV lama diganti); log unggah/lihat/hapus', opt, async () => {
  const f = await createPeopleDb();
  const storage = memoryStorage();
  try {
    const r = await newEmployee(f);
    await assert.rejects(Docs.uploadDocument(f.db, f.scope, f.admin, r.user_id,
      { originalname: 'cv.pdf', buffer: Buffer.from('<html>bukan pdf') }, { doc_type: 'CV' }, { storage }), /PDF/);
    await assert.rejects(Docs.uploadDocument(f.db, f.scope, f.admin, r.user_id,
      { originalname: 'big.pdf', buffer: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(Docs.MAX_BYTES)]) }, { doc_type: 'CV' }, { storage }), /5 MB/);
    await assert.rejects(Docs.uploadDocument(f.db, f.scope, f.admin, r.user_id, pdf('x'), { doc_type: 'SIM' }, { storage }), /Jenis/);

    const cv1 = await Docs.uploadDocument(f.db, f.scope, f.admin, r.user_id, pdf('cv-lama'), { doc_type: 'CV' }, { storage });
    assert.equal(cv1.title, 'Curriculum Vitae');
    const cv2 = await Docs.uploadDocument(f.db, f.scope, f.admin, r.user_id, pdf('cv-baru'), { doc_type: 'CV' }, { storage });
    assert.equal(cv2.replaced_id, cv1.id);
    await assert.rejects(Docs.uploadDocument(f.db, f.scope, f.admin, r.user_id, pdf('cv-baru'),
      { doc_type: 'COMPETENCY', title: 'SIO' }, { storage }), /sudah diunggah/);
    const sio = await Docs.uploadDocument(f.db, f.scope, f.admin, r.user_id, pdf('sio'),
      { doc_type: 'COMPETENCY', title: 'SIO Dump Truck', doc_number: 'SIO-1', issued_date: '2026-01-01', expiry_date: '2027-01-01' }, { storage });

    const list = await Docs.listDocuments(f.db, f.scope, r.user_id);
    assert.deepEqual(list.map(d => d.doc_type), ['CV', 'COMPETENCY']);
    assert.equal(list[0].id, cv2.id);

    const opened = await Docs.openDocument(f.db, f.scope, f.admin, sio.id, { storage, ip: '10.0.0.1' });
    assert.match(opened.buffer.toString(), /sio/);
    const headers = {};
    const res = { setHeader(k, v) { headers[k] = v; }, send(b) { this.body = b; return this; } };
    Docs.sendPdf(res, opened.doc, opened.buffer);
    assert.equal(headers['Content-Type'], 'application/pdf');
    assert.match(headers['Content-Disposition'], /^inline;/);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');

    await assert.rejects(Docs.deleteDocument(f.db, f.scope, f.admin, sio.id, {}), /Alasan/);
    await Docs.deleteDocument(f.db, f.scope, f.admin, sio.id, { reason: 'Salah unggah' });
    await assert.rejects(Docs.openDocument(f.db, f.scope, f.admin, sio.id, { storage }), /tidak ditemukan/);

    const log = await f.db.query(`SELECT action, COUNT(*)::int AS n FROM employee_document_access_log GROUP BY action ORDER BY action`);
    assert.deepEqual(log.rows, [{ action: 'DELETE', n: 2 }, { action: 'UPLOAD', n: 3 }, { action: 'VIEW', n: 1 }]);
    const profile = await People.getProfile(f.db, f.scope, r.user_id, { today: '2026-10-12' });
    assert.equal(profile.documents.length, 1);
    const dir = await People.getDirectory(f.db, f.scope, { today: '2026-10-12' });
    assert.ok(!dir.rows[0].completeness.missing.includes('CV'));
  } finally { await f.db.close(); }
});

test('Dokumen: bila simpan DB gagal, file di storage dibersihkan', opt, async () => {
  const f = await createPeopleDb();
  const storage = memoryStorage();
  try {
    const r = await newEmployee(f);
    await assert.rejects(Docs.uploadDocument(f.db, f.scope, f.admin, r.user_id, pdf('x'),
      { doc_type: 'COMPETENCY', title: 'SIO', issued_date: '2026-01-01', expiry_date: '2025-01-01' }, { storage }), /berlaku/);
    // Validasi tanggal ditolak sebelum menyimpan file.
    assert.equal(storage.files.size, 0);
    const failing = { ...storage, uploadDocument: storage.uploadDocument };
    const badUser = { id: '00000000-0000-0000-0000-000000000000' }; // FK uploaded_by gagal
    await assert.rejects(Docs.uploadDocument(f.db, f.scope, badUser, r.user_id, pdf('y'), { doc_type: 'CV' }, { storage: failing }));
    assert.equal(storage.files.size, 0);
  } finally { await f.db.close(); }
});
