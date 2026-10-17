'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'planProductivity.workspace.js'), 'utf8');

test('tabel parameter material selalu open (tidak hide setelah isi 1 kolom)', () => {
  assert.match(source, /<details class="ppw-parameters" open/);
  assert.doesNotMatch(source, /<details class="ppw-parameters" data-plan-factor-type/);
});

test('edit kolom parameter memicu render ulang (penyebab hide bila details tertutup)', () => {
  assert.match(source, /parameter\[event\.target\.dataset\.parameterField\] = event\.target\.value/);
  assert.match(source, /markDirty\(context\); return render\(context\);/);
});
