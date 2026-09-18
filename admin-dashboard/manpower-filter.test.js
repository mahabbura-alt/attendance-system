'use strict';

// Regression tests untuk fitur "List Manpower" pada tab Input Data (OMOS).
// Memverifikasi bahwa filter jabatan manpower tersimpan & diterapkan ke daftar
// Operator (tabel inline Input Data & tombol + Tambah Work Log) tanpa kehilangan
// nilai operator lama yang jabatannya sedang difilter.
//
// Pola pengujian mengikuti spo-job-integration.test.js: membaca source file dan
// menegaskan keberadaan + perilaku kunci lewat pola regex (tanpa DOM runtime).

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const production = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// --- State & helper inti ---
assert.match(production, /let cachedInputManpower = \[\];/, 'harus ada cache seluruh manpower aktif');
assert.match(production, /let selectedManpowerJabatan = null;/, 'seleksi jabatan default = semua (null)');
assert.match(production, /function isInputManpowerActive/, 'harus ada helper karyawan aktif');
assert.match(production, /function manpowerJabatanOf/, 'harus ada helper ekstraksi jabatan');
assert.match(production, /function getManpowerJabatanList/, 'harus ada helper daftar jabatan unik');
assert.match(production, /function isManpowerJabatanSelected/, 'harus ada helper cek jabatan terpilih');
assert.match(production, /function recomputeInputOperators/, 'harus ada helper rekomputasi operator');

// --- Persistensi seleksi (localStorage) ---
assert.match(production, /function manpowerJabatanStorageKey/, 'harus ada kunci penyimpanan seleksi');
assert.match(production, /'omos_input_manpower_jabatan'/, 'kunci penyimpanan seleksi jabatan harus stabil');
assert.match(production, /function readManpowerJabatanSelection/, 'harus ada pembaca seleksi tersimpan');
assert.match(production, /function persistManpowerJabatanSelection/, 'harus ada penulis seleksi tersimpan');
assert.match(production, /function applySavedManpowerJabatanSelection/, 'harus ada penerap seleksi tersimpan');
assert.match(production, /manpowerJabatanLoaded/, 'penerapan seleksi tersimpan harus hanya sekali');

// --- Sinkronisasi dari data karyawan: simpan SEMUA jabatan aktif, lalu filter ---
assert.match(production, /cachedInputManpower = \(Array\.isArray\(employees\)/, 'sync harus menyimpan seluruh karyawan aktif');
assert.match(production, /applySavedManpowerJabatanSelection\(\)/, 'sync harus menerapkan seleksi tersimpan');
assert.match(production, /recomputeInputOperators\(\)/, 'sync harus merekomputasi operator');
assert.match(production, /refreshManpowerFilterUi\(\)/, 'sync harus memperbarui UI filter');

// --- UI checklist jabatan ---
assert.match(production, /function refreshManpowerFilterUi/, 'harus ada pembaru UI filter');
assert.match(production, /function renderManpowerFilterList/, 'harus ada renderer daftar jabatan');
assert.match(production, /function toggleManpowerFilterPanel/, 'harus ada pembuka/tutup panel');
assert.match(production, /function setAllManpowerJabatan/, 'harus ada toggle semua jabatan');
assert.match(production, /function applyManpowerJabatanSelection/, 'harus ada penerap satu jabatan');
assert.match(production, /function reapplyManpowerFilterToUi/, 'harus ada penerap ulang filter ke UI');

// --- Dropdown Operator mempertahankan nilai lama yang jabatannya difilter ---
assert.match(production, /selectedStillListed/, 'dropdown harus cek apakah operator terpilih masih terdaftar');
assert.match(production, /Data lama/, 'operator lama yang terfilter harus tetap tampil sebagai opsi data lama');

// --- Tombol & panel "List Manpower" di header Input Data (index.html) ---
assert.match(html, /id="btnListManpower"/, 'tombol List Manpower harus ada di header Input Data');
assert.match(html, /onclick="toggleManpowerFilterPanel\(\)"/, 'tombol harus memanggil toggle panel');
assert.match(html, /id="panelManpowerFilter"/, 'panel checklist jabatan harus ada');
assert.match(html, /id="manpowerJabatanList"/, 'kontainer daftar jabatan harus ada');
assert.match(html, /id="manpowerCheckAll"/, 'checkbox "Semua Jabatan" harus ada');
assert.match(html, /id="manpowerFilterSummary"/, 'ringkasan seleksi harus ada');

console.log('Manpower "List Manpower" filter tests passed');
