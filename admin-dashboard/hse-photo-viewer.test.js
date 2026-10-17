'use strict';

/** Penampil foto lampiran HSE: foto dibuka langsung di dashboard (bukan tab baru) dari semua titik foto. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const viewerSrc = fs.readFileSync(path.join(__dirname, 'hse-photo-viewer.js'), 'utf8');
const hseJs = fs.readFileSync(path.join(__dirname, 'hse.js'), 'utf8');
const hseCss = fs.readFileSync(path.join(__dirname, 'hse.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('register/attrs: galeri disimpan per kunci, foto kosong diabaikan, atribut aman', () => {
  const win = {};
  vm.runInNewContext(viewerSrc, { window: win, globalThis: win, console });
  const PV = win.OMOSPhotoViewer;
  assert.equal(PV.register('hz:1', ['data:image/webp;base64,AAA', '', null, 'data:image/jpeg;base64,BBB'], 'Hazard X'), 2);
  assert.equal(PV._galleries.get('hz:1').photos.length, 2);
  assert.equal(PV.register('hz:2', []), 0);
  assert.equal(PV._galleries.has('hz:2'), false);
  assert.equal(PV.attrs('a"b', 2), 'data-hpv-key="a&quot;b" data-hpv-index="2"');
});

test('dashboard tidak lagi membuka foto di tab baru; semua titik foto memakai penampil', () => {
  assert.doesNotMatch(hseJs, /window\.open\(this\.src/);
  assert.doesNotMatch(hseJs, /href="\$\{ESC\(pUrl\)\}" target="_blank"/);
  for (const key of ['hzl:', 'evl:', 'hz:', 'ev:', 'capa:', 'inc:', 'insa:', 'att:']) {
    assert.ok(hseJs.includes(`\`${key}`), `galeri ${key} terpasang`);
  }
  assert.match(hseJs, /function photoBadgeHtml/);
  assert.match(hseJs, /function photoThumbsHtml/);
});

test('aksesibilitas penampil: dialog modal, tombol tutup berlabel, navigasi keyboard', () => {
  assert.match(viewerSrc, /role', 'dialog'/);
  assert.match(viewerSrc, /aria-modal', 'true'/);
  assert.match(viewerSrc, /aria-label="Tutup penampil foto"/);
  assert.match(viewerSrc, /ArrowLeft/);
  assert.match(viewerSrc, /Escape/);
  assert.match(hseCss, /\.hpv__btn:focus-visible/);
  assert.match(hseCss, /\.hpv\[hidden\] \{ display: none; \}/);
});

test('index.html memuat penampil sebelum hse-ai.js / hse.js', () => {
  const v = indexHtml.indexOf('hse-photo-viewer.js');
  assert.ok(v > 0 && v < indexHtml.indexOf('hse-ai.js') && v < indexHtml.indexOf('hse.js?v='));
});
