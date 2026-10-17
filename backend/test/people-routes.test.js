'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const ExcelJS = require('exceljs');
const { available, createPeopleDb } = require('./helpers/peopleFixture');

const opt = { skip: !available };

async function startApp(f, user) {
  process.env.STORAGE_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'omos-people-'));
  const dbPath = require.resolve('../src/config/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: f.db } };
  for (const k of Object.keys(require.cache)) if (/src[\\/](controllers|routes)[\\/]people/.test(k)) delete require.cache[k];
  const peopleRoutes = require('../src/routes/people.routes');
  const { uploadErrorHandler } = require('../src/middleware/upload');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { ...user, tenant_id: 'default', project_id: 'default' }; next(); });
  app.use('/people', peopleRoutes);
  app.use(uploadErrorHandler);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.statusCode < 500 ? err.message : 'server', detail: err.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/people`;
  return {
    base,
    close: () => new Promise(r => server.close(r)),
    json: async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
  };
}

test('HTTP People: tambah → direktori → profil → unggah & buka PDF → Void; kesalahan bisnis jadi 4xx', opt, async () => {
  const f = await createPeopleDb();
  const app = await startApp(f, f.admin);
  try {
    const bad = await app.json('POST', '/employees', { nama: 'X' });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.error);

    const created = await app.json('POST', '/employees', {
      nama: 'Rizky Ananda', email: 'rizky@pim.co.id', position_id: f.positions.operatorDt.id, hire_date: '2026-10-19',
      employment_type: 'PKWTT', lokasi_ids: [f.lokasi.pit3.id], send_invite: false,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.user_id;
    const dup = await app.json('POST', '/employees', {
      nama: 'Rizky Lagi', email: 'RIZKY@pim.co.id', position_id: f.positions.operatorDt.id, hire_date: '2026-10-19',
      employment_type: 'PKWTT', lokasi_ids: [f.lokasi.pit3.id], send_invite: false,
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'EMAIL_TAKEN');

    const dir = await app.json('GET', `/directory?department_ids=${f.departments.produksi.id}`);
    assert.equal(dir.status, 200);
    assert.equal(dir.body.rows.length, 1);
    const org = await app.json('GET', '/org');
    assert.equal(org.status, 200);
    const opts = await app.json('GET', '/options');
    assert.equal(opts.body.lokasi.length, 3);
    const rem = await app.json('GET', '/reminders');
    assert.equal(rem.status, 200);

    // Unggah PDF (multipart)
    const form = new FormData();
    form.append('doc_type', 'CV');
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }), 'cv rizky.pdf');
    const up = await fetch(`${app.base}/employees/${id}/documents`, { method: 'POST', body: form });
    assert.equal(up.status, 201);
    const doc = await up.json();
    const notPdf = new FormData();
    notPdf.append('doc_type', 'CV');
    notPdf.append('file', new Blob(['hello'], { type: 'text/plain' }), 'cv.txt');
    const rejected = await fetch(`${app.base}/employees/${id}/documents`, { method: 'POST', body: notPdf });
    assert.equal(rejected.status, 400);

    const view = await fetch(`${app.base}/documents/${doc.id}/file`);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'application/pdf');
    assert.match(view.headers.get('content-disposition'), /^inline;/);
    assert.match(Buffer.from(await view.arrayBuffer()).toString(), /^%PDF-/);

    const profile = await app.json('GET', `/employees/${id}`);
    assert.equal(profile.body.documents.length, 1);
    assert.equal(profile.body.personal.nik_masked, null);

    const v = await app.json('POST', `/employees/${id}/void`, { reason: 'Salah input email' });
    assert.equal(v.status, 200, JSON.stringify(v.body));
  } finally {
    await app.close();
    await f.db.close();
  }
});

test('HTTP People: template import bisa diunduh lalu diunggah ulang untuk simulasi', opt, async () => {
  const f = await createPeopleDb();
  const app = await startApp(f, f.admin);
  try {
    const t = await fetch(`${app.base}/import/template`);
    assert.equal(t.status, 200);
    assert.match(t.headers.get('content-disposition'), /template_import_karyawan_/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await t.arrayBuffer()));
    const row = wb.getWorksheet('Karyawan').getRow(2);
    ['Andi', 'andi@pim.co.id', 'Produksi · Operator Dump Truck', '2026-10-19', 'PKWTT', null, 'Pos Pit 3'].forEach((v, i) => { row.getCell(i + 1).value = v; });
    row.commit();
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(await wb.xlsx.writeBuffer())]), 'isi.xlsx');
    const prev = await fetch(`${app.base}/import/preview`, { method: 'POST', body: form });
    assert.equal(prev.status, 200);
    const body = await prev.json();
    assert.equal(body.batch.summary.valid, 1);
    const commit = await app.json('POST', `/import/${body.batch.id}/commit`, { send_invites: false });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    assert.equal(commit.body.committed, 1);
    assert.equal(commit.body.invites, undefined, 'token undangan tidak dikirim ke browser');
    const again = await app.json('POST', `/import/${body.batch.id}/commit`, {});
    assert.equal(again.status, 409);
  } finally {
    await app.close();
    await f.db.close();
  }
});
