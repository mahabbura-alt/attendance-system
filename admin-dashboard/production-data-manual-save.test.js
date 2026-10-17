'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'productionData.js'), 'utf8');

test('id draf manual memakai index tabel dan dikonversi konsisten di semua konsumen', () => {
  assert.match(source, /function manualTableIndex\(areaSegment\)/);
  const pemakai = source.match(/manualTableIndex\(/g) || [];
  assert.ok(pemakai.length >= 4, 'dipakai di dirty-count, save, dan cleanup sumber (min. 4 kemunculan)');
});

test('tidak ada lagi perbandingan nama area vs segmen index', () => {
  assert.doesNotMatch(source, /findIndex\(t => t\.area === area\)/);
  assert.doesNotMatch(source, /if \(a === area && j === jobCode\)/);
});

test('tombol Simpan mendeteksi perubahan nilai produksi manual', () => {
  assert.match(source, /data-pd-action="save-manual"/);
  assert.match(source, /`Simpan \(\$\{n\}\)`/);
  assert.match(source, /Data belum disimpan · \$\{n\} perubahan/);
  assert.match(source, /pd-manual-input/);
});

test('Total manual read-only dan dihitung dari seluruh input material', () => {
  assert.match(source, /function manualRowTotal\(context, job\)/);
  assert.match(source, /for \(const material of jobDefinition\.materials\)/);
  assert.match(source, /total \+= value/);
  assert.match(source, /readonly aria-readonly="true"/);
  assert.match(source, /refreshManualRowTotal/);
  assert.match(source, /row\.material !== 'TOTAL'/,
    'snapshot simpan tidak boleh mempertahankan override TOTAL lama');
});

test('save mengirim snapshot penuh area dan JOB agar edit tunggal tidak menghapus nilai lain', () => {
  assert.match(source, /changedGroups/);
  assert.match(source, /s\.report\.manualOverrides/);
  assert.match(source, /snapshot\.set/);
  assert.match(source, /snapshot\.delete/);
  assert.match(source, /year: s\.report\.period\.year, month: s\.report\.period\.month, area, jobCode, source: 'manual'/);
});

test('draf hanya dibuang setelah jumlah dan snapshot hasil simpan terverifikasi', () => {
  assert.match(source, /Number\(result\.overrides\) !== overrides\.length/);
  assert.match(source, /load\(\{ preserveManualDraft: true \}\)/);
  assert.match(source, /manualSnapshotMatches\(refreshed, group\)/);
  assert.match(source, /Verifikasi setelah simpan gagal/);
});

test('request simpan tidak dibatalkan karena tombol dinonaktifkan sebelum helper berjalan', () => {
  const saveStart = source.indexOf('async function saveManualValues(button)');
  const saveEnd = source.indexOf('async function exportExcel()', saveStart);
  const saveSource = source.slice(saveStart, saveEnd);
  const busyIndex = saveSource.indexOf('s.busy = true;');
  const feedbackIndex = saveSource.indexOf('global.OMOSActionFeedback.run(button');

  assert.ok(busyIndex >= 0 && feedbackIndex > busyIndex, 'alur simpan memakai busy guard dan helper feedback');
  assert.doesNotMatch(saveSource.slice(busyIndex, feedbackIndex), /refreshManualSave\(\)/,
    'refreshManualSave akan men-disable tombol dan membuat helper melewati request');
});
