'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'hse-delegators.js'), 'utf8');
const resetSrc = fs.readFileSync(path.join(__dirname, 'reset-sandi.js'), 'utf8');
const hseJs = fs.readFileSync(path.join(__dirname, 'hse.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function load(file) {
  const win = {};
  vm.runInNewContext(file, { window: win, globalThis: win, console, CSS: { escape: s => s } });
  return win;
}

const ROWS = [
  { department_id: 'd1', department_name: 'Produksi', delegator_user_id: 'u1', delegator_name: 'Dedi <b>Kepala</b>', delegator_jabatan: 'Superintendent',
    backup_user_id: null, backup_name: null, valid_from: '2026-10-14', valid_to: null, open_pic_actions: 3 },
  { department_id: 'd2', department_name: 'Engineering', delegator_user_id: null, open_pic_actions: 2 },
  { department_id: 'd3', department_name: 'Logistik', delegator_user_id: null, open_pic_actions: 0 },
];
const EMPLOYEES = [
  { id: 'u1', nama: 'Dedi Kepala', departemen: 'Produksi', jabatan: 'Superintendent' },
  { id: 'u2', nama: 'Pita', departemen: ' produksi ', jabatan: 'Foreman' },
  { id: 'u3', nama: 'Eko', departemen: 'Engineering', jabatan: 'Engineer' },
];

test('Delegator Departemen: daftar, peringatan, escape, dan editor hanya berisi anggota departemen', async () => {
  const D = load(src).OMOSHseDelegators;
  await D.loadSetup(async (p) => (p === '/delegators' ? ROWS : { employees: EMPLOYEES }));
  const html = D.renderSetup();
  assert.match(html, /1 departemen punya PIC aktif tetapi belum punya delegator/);
  assert.ok(!html.includes('<b>Kepala</b>'), 'nama harus di-escape');
  assert.match(html, /data-hdl-edit="d2">Tetapkan/);
  assert.match(html, /data-hdl-remove="d1"/);
  assert.match(html, /PIC di departemen ini tidak bisa minta pengalihan/);
  assert.deepEqual(D.membersOf('Produksi').map(e => e.id), ['u1', 'u2']);

  D._state.editing = 'd1';
  const edit = D.renderSetup();
  assert.match(edit, /data-hdl-form="d1"/);
  assert.ok(edit.includes('value="u2"'));
  assert.ok(!edit.includes('value="u3"'), 'karyawan departemen lain tidak boleh muncul');
  assert.match(edit, /Perpanjangan maksimal 1 kali per hazard; risiko Ekstrem tidak bisa diperpanjang/);

  D._state.filter = 'engin';
  assert.ok(!D.renderSetup().includes('data-hdl-edit="d1"'));
});

test('Delegator Departemen: galat migrasi ditampilkan jelas', async () => {
  const D = load(src).OMOSHseDelegators;
  await D.loadSetup(async () => { const e = new Error('Tabel'); e.status = 503; throw e; });
  assert.match(D.renderSetup(), /Jalankan migrasi 101_hse_mobile_safety\.sql/);
});

test('Integrasi: tab Setup Master, skrip, dan aksi simpan memakai OMOSActionFeedback', () => {
  assert.match(hseJs, /data-setup-tab="delegators"/);
  assert.match(hseJs, /OMOSHseDelegators\.bindSetup\(rootEl/);
  assert.match(indexHtml, /<script src="hse-delegators\.js\?v=\d+"><\/script>/);
  assert.match(indexHtml, /<script src="reset-sandi\.js\?v=\d+"><\/script>/);
  assert.match(indexHtml, /id="panelResetSandi"/);
  assert.match(src, /OMOSActionFeedback\.run\(btn, work\)/);
  assert.match(resetSrc, /OMOSActionFeedback\.run\(btn, work/);
});

test('Reset sandi: data permintaan di-escape', () => {
  const R = load(resetSrc).OMOSResetSandi;
  const html = R.renderItems([{ user_id: 'x"1', nama: '<img src=x>', employee_id: 'EMP-1', jabatan: 'Op', departemen: 'Prod', requested_at: '2026-10-14T01:00:00Z' }]);
  assert.ok(!html.includes('<img src=x>'));
  assert.match(html, /data-rs-reset="x&quot;1"/);
});
