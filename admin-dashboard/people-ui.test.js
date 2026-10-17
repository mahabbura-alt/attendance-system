'use strict';

// Regression OMOS People v2 — halaman Karyawan (people.js).
// Menggantikan karyawan-tambah-lokasi-optional.test.js: sejak People v2 lokasi absen
// WAJIB (boleh lebih dari satu) dan password awal opsional (default undangan email).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const js = read('people.js');
const css = read('people.css');
const html = read('index.html');
const app = read('app.js');
const controller = fs.readFileSync(path.join(__dirname, '..', 'backend', 'src', 'controllers', 'karyawanController.js'), 'utf8');

test('Tambah karyawan: satu pintu masuk lewat People API; lokasi absen wajib; tanpa daftar jabatan di kode', () => {
  assert.match(js, /apiSend\(`\$\{API\}\/employees`, 'POST', payload\)/);
  assert.match(js, /Pilih minimal satu lokasi absen\./);
  assert.match(js, /send_invite: W\.access === 'invite'/);
  assert.doesNotMatch(js, /DEPARTEMEN_JABATAN_MAP/, 'jabatan harus dari master API, bukan daftar tetap');
  assert.match(controller, /People\.createEmployee\(pool/, 'POST /api/admin/karyawan lama diteruskan ke People v2');
  assert.match(controller, /EMPLOYEE_DELETE_REMOVED/, 'hapus permanen diganti Void');
});

test('Dokumen PDF dibuka lewat endpoint ber-login, bukan /api/storage/view publik', () => {
  assert.match(js, /\/documents\/\$\{encodeURIComponent\(docId\)\}\/file/);
  assert.doesNotMatch(js, /\/api\/storage\/view/);
  assert.match(js, /Ukuran PDF maksimal 5 MB/);
  assert.match(js, /URL\.revokeObjectURL/);
});

test('Semua aksi simpan memakai OMOSActionFeedback (tanpa spinner sendiri)', () => {
  assert.match(js, /global\.OMOSActionFeedback\.run\(button, task/);
  const saves = js.match(/run\(\$\('#pp\w+Save'\)/g) || [];
  assert.ok(saves.length >= 8, `ditemukan ${saves.length} tombol simpan terbungkus feedback`);
  assert.doesNotMatch(js, /spinner/i);
});

test('Pergerakan: jenis lengkap, alasan manual wajib, pembuat ≠ penyetuju', () => {
  for (const t of ['CONFIRMATION', 'CONTRACT_RENEWAL', 'EMPLOYMENT_TYPE_CHANGE', 'TRANSFER', 'PROMOTION', 'DEMOTION', 'RESIGN', 'TERMINATION', 'CONTRACT_END', 'RETIREMENT', 'REHIRE']) {
    assert.match(js, new RegExp(`'${t}'`), t);
  }
  assert.match(js, /Alasan wajib diisi \(minimal 3 karakter\)\./);
  assert.match(js, /self_approval_reason: reason/);
  assert.match(js, /'Idempotency-Key': idem\(\)/);
});

test('Import Excel: template, simulasi, padanan diingat, simpan, Void batch', () => {
  for (const ep of ['/import/template', '/import/preview', '/mappings', '/commit', '/cancel', '/void']) assert.ok(js.includes(ep), ep);
  assert.match(js, /tidak pernah ditebak otomatis/);
});

test('Halaman terpasang di dashboard; registrasi mandiri dihapus; izin approver tersedia', () => {
  assert.match(html, /people\.css\?v=\d+/);
  assert.match(html, /people\.js\?v=\d+/);
  assert.doesNotMatch(html, /data-tab="registrasi"/);
  assert.doesNotMatch(app, /setInterval\(cekRegistrasiPendingNotifikasi/);
  assert.match(app, /'people\.approve': /);
  assert.match(app, /document\.getElementById\('btnTambahKaryawan'\)\?\.addEventListener/);
});

test('Gaya People terisolasi dengan awalan pp- dan responsif', () => {
  assert.doesNotMatch(css, /^\.(card|chip|modal|tab|btn)\b/m, 'tidak boleh menimpa kelas global');
  assert.match(css, /@media \(max-width: 860px\)/);
});
