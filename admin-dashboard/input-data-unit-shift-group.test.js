'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('Input Data kembali memakai tampilan tabel datar tanpa header grup unit-shift', () => {
  assert.doesNotMatch(source, /function inputShiftGroupHeaderRow/);
  assert.doesNotMatch(source, /function computeInputShiftQuality/);
  assert.doesNotMatch(source, /data-input-group-key/);
  assert.match(source, /data-input-log-row data-log-id=/);
  assert.match(source, /tbody\.innerHTML = logs\.map\(row =>/);
});

test('Rule multi-segmen tetap tersedia di backend meski input baru memakai baris inline', () => {
  assert.match(source, /insertInputDataRow/);
  assert.match(source, /function bukaModalPergantianOperator/);
  assert.match(source, /handover_reason:/);
  assert.match(source, /handover_note:/);
  assert.match(source, /source_log_id:/);
});

test('Input Data hanya mengekspos Insert Data dan satu pintu Simpan Perubahan', () => {
  assert.match(index, /id="btnInsertInputData"[^>]+onclick="insertInputDataRow\(\)"[^>]*>\+ Insert Data<\/button>/);
  assert.doesNotMatch(index, /onclick="bukaModalMultiWorkLog\(\)"/);
  assert.doesNotMatch(index, /onclick="bukaModalInputDataProduksi\(\)"/);
  assert.match(index, /id="btnSimpanPerubahanInputData"[^>]+disabled/);
  assert.match(source, /Data belum disimpan · \$\{count\} baris/);
  assert.match(source, /count \? `Simpan Perubahan \(\$\{count\}\)` : 'Simpan Perubahan'/);
});

test('draft baru memakai POST sedangkan edit record lama tetap PATCH', () => {
  assert.match(source, /isNew \? '\/api\/admin\/production\/logs' : `\/api\/admin\/production\/logs\/\$\{encodeURIComponent\(logId\)\}`/);
  assert.match(source, /isNew \? 'POST' : 'PATCH'/);
  assert.match(source, /data-input-log-new="true" data-save-state="dirty"/);
  assert.match(source, /await muatProdInputData\(\)/);
});

test('Insert Data memakai tanggal lokal H-1 sebagai default', () => {
  assert.match(source, /function defaultInputLogDate\(\)[\s\S]*previousDay\.setDate\(previousDay\.getDate\(\) - 1\)[\s\S]*return localDateIso\(previousDay\)/);
});
