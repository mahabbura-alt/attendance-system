'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

test('indikator Calendar PA diganti Calendar MA yang bisa diklik', () => {
  assert.match(html, /Calendar MA/);
  assert.doesNotMatch(html, /Calendar PA/);
  assert.match(html, /id="metricMa"/);
  assert.match(html, /bukaBreakdownMaKpi\(\)/);
  assert.doesNotMatch(html, /id="metricPa"/);
  assert.match(css, /\.breakdown-kpi-link/);
});

test('formula MA = HM / (HM + BD) dengan guard nol', () => {
  assert.match(source, /function hitungBreakdownMa\(hmHours, bdHours\)/);
  assert.match(source, /\(hm \/ \(hm \+ bd\)\) \* 100/);
  assert.match(source, /if \(\!\(hm \+ bd > 0\)\) return null/);
});

test('modal MA dikelompokkan per jenis equipment dari HM Input Data + BD breakdown', () => {
  assert.match(source, /function bukaBreakdownMaKpi\(\)/);
  assert.match(source, /\/api\/admin\/production\/logs\?year=/);
  assert.match(source, /elapsed_breakdown_hours/);
  assert.match(source, /equipmentType/);
  // agregasi tingkat jenis konsisten dengan formula per unit (jumlah HM dibagi jumlah HM+BD)
  assert.match(source, /group\.hm \+= row\.hm/);
});
