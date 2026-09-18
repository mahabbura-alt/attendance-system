'use strict';

// Regression tests untuk fitur "+ Tambah Karyawan" tanpa wajib memilih lokasi (OMOS).
// Memverifikasi bahwa:
//   - Backend (POST /api/admin/karyawan) tidak lagi mewajibkan lokasi_kantor_id
//     dan menormalkan nilainya ke null bila tidak dikirim / tidak valid UUID.
//   - Frontend (modal "+ Tambah Karyawan" di app.js) tidak lagi menampilkan
//     field "Lokasi kantor" dan tidak mengirim lokasi_kantor_id saat submit.
//
// Pola pengujian mengikuti manpower-filter.test.js / spo-job-integration.test.js:
// membaca source file dan menegaskan keberadaan + perilaku kunci lewat pola regex
// (tanpa DOM runtime / koneksi database).

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const appJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const controller = fs.readFileSync(
  path.join(__dirname, '..', 'backend', 'src', 'controllers', 'karyawanController.js'),
  'utf8'
);

// --- Backend: lokasi_kantor_id tidak lagi wajib saat membuat karyawan ---
assert.doesNotMatch(
  controller,
  /!lokasi_kantor_id/,
  'validasi backend tidak boleh lagi mewajibkan lokasi_kantor_id'
);
assert.match(
  controller,
  /if \(!nama \|\| !email \|\| !password\)/,
  'validasi backend hanya mewajibkan nama, email, dan password'
);
assert.match(
  controller,
  /'nama, email, dan password wajib diisi'/,
  'pesan error backend harus tanpa menyebut lokasi_kantor_id'
);

// --- Backend: lokasi_kantor_id dinormalkan ke null bila tidak valid UUID ---
assert.match(
  controller,
  /const isUuid = \(str\) => typeof str === 'string'/,
  'harus ada helper isUuid untuk memvalidasi lokasi_kantor_id'
);
assert.match(
  controller,
  /const cleanLokasiId = isUuid\(lokasi_kantor_id\) \? lokasi_kantor_id : null;/,
  'lokasi_kantor_id yang tidak valid / tidak dikirim harus dinormalkan ke null'
);
assert.match(
  controller,
  /cleanLokasiId\]/,
  'INSERT harus memakai nilai lokasi yang sudah dinormalkan (cleanLokasiId)'
);

// --- Frontend: field "Lokasi kantor" dihapus dari modal + Tambah Karyawan ---
assert.doesNotMatch(
  appJs,
  /id="tkLokasi"/,
  'modal + Tambah Karyawan tidak boleh lagi memiliki select lokasi (tkLokasi)'
);
assert.doesNotMatch(
  appJs,
  /Lokasi kantor<\/label>/,
  'label "Lokasi kantor" tidak boleh lagi tampil di modal + Tambah Karyawan'
);

// --- Frontend: submit tidak lagi mengirim lokasi_kantor_id ---
assert.doesNotMatch(
  appJs,
  /lokasi_kantor_id: document\.getElementById\('tkLokasi'\)/,
  'payload submit tidak boleh lagi mengirim lokasi_kantor_id dari tkLokasi'
);
assert.doesNotMatch(
  appJs,
  /const opsiLokasi = /,
  'variabel opsiLokasi yang tidak terpakai harus dihapus'
);

console.log('Karyawan "+ Tambah Karyawan" lokasi-optional tests passed');
