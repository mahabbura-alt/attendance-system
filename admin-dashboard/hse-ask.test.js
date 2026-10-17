'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'hse-ask.js'), 'utf8');
const hseJs = fs.readFileSync(path.join(__dirname, 'hse.js'), 'utf8');
const aiJs = fs.readFileSync(path.join(__dirname, 'hse-ai.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const load = () => { const win = {}; vm.runInNewContext(src, { window: win, globalThis: win, console }); return win.OMOSHseAsk; };

test('jawaban: teks di-escape, angka & sumber tampil, tautan halaman', () => {
  const A = load();
  const html = A.renderResult({ ok: true, kind: 'ANSWER', answer: 'Ada <b>5</b> hazard', numbers: [{ label: 'Hazard', value: '5' }], page: 'hazards', request_id: 'r', ai_label: 'Jawaban AI — cek sumbernya', scope_note: 'Dijawab untuk: x', sources: [{ tool: 'hazard', label: 'Hazard', filter: { bulan: '2026-10', q: '' }, cached: false }] }, 0);
  assert.ok(!html.includes('<b>5</b>'));
  assert.match(html, /Ada &lt;b&gt;5&lt;\/b&gt; hazard/);
  assert.match(html, /bulan: 2026-10/);
  assert.match(html, /data-ask-nav="hazards"/);
  assert.match(html, /Jawaban AI — cek sumbernya/);
  assert.match(html, /data-ask-fb="-1"/);
});

test('RAW menampilkan tabel sumber; gagal & di luar cakupan tanpa angka karangan', () => {
  const A = load();
  const raw = A.renderResult({ ok: true, kind: 'RAW', message: 'tidak ditampilkan', sources: [], tables: [{ label: 'Hazard', data: { items: [{ no: 'H1', x: '<i>' }] } }] }, 0);
  assert.match(raw, /<table/); assert.ok(!raw.includes('<i>'));
  assert.match(A.renderResult({ ok: false, message: 'Model lambat' }, 0), /ask-msg-err/);
  assert.match(A.renderResult({ ok: true, kind: 'OUT_OF_SCOPE', message: 'Di luar cakupan' }, 0), /Di luar cakupan/);
});

test('contoh pertanyaan mengikuti halaman; riwayat hanya teks pertanyaan', () => {
  const A = load();
  const inf = { examples: { hazards: ['a', 'b', 'c', 'd', 'e'] }, generic_examples: ['g'] };
  assert.deepEqual(Array.from(A.examplesFor('hazard', inf)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(Array.from(A.examplesFor('setup', inf)), ['g']);
  const h = A.historyForRequest([{ q: '1', res: { ok: true } }, { q: '2', res: { ok: false } }, { q: '3', res: { ok: true } }, { q: '4', res: { ok: true } }, { q: '5', res: { ok: true } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(h)), [{ q: '3' }, { q: '4' }, { q: '5' }]);
});

test('semua halaman hasil punya pemetaan navigasi', () => {
  const A = load();
  for (const p of ['overview', 'hazards', 'actions', 'incidents', 'reports', 'workhours', 'competency', 'ptw', 'inspections', 'hazard-targets', 'events']) assert.ok(A.PAGE_NAV[p], p);
});

test('penyambungan: hse.js memanggil panel, Setup punya pemilih hse_ask, index memuat skrip', () => {
  assert.match(hseJs, /syncAsk\(\);/);
  assert.match(aiJs, /modeSelect\('hse_ask'/);
  assert.match(aiJs, /hse_ask: fd\.get\('hse_ask'\)/);
  assert.ok(indexHtml.indexOf('hse-ask.js') > 0 && indexHtml.indexOf("hse-ask.js") < indexHtml.indexOf("hse.js?v="));
});
