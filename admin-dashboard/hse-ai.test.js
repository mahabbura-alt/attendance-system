'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'hse-ai.js'), 'utf8');
const hseJs = fs.readFileSync(path.join(__dirname, 'hse.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function load() {
  const win = {};
  vm.runInNewContext(src, { window: win, globalThis: win, console });
  return win.OMOSHseAi;
}

const aiSim = {
  id: 'h2', report_no: 'HZD-2610-019', engine: 'LLM', verdict: 'SAMA', confidence: 0.91, confidence_label: 'Tinggi',
  reason: 'Kabel <b>panel</b> yang sama', evidence: ['kabel', '<script>x</script>'], suggestion_id: 's1', agent_version: 'v1',
  similarity_pct: 91, description: 'Panel genset', location_name: 'Workshop',
};
const ruleSim = { id: 'h3', report_no: 'HZD-2610-020', engine: 'RULE', similarity_pct: 72 };

test('Lencana & alasan: AI vs cek kata kunci, isi di-escape', () => {
  const AI = load();
  assert.match(AI.dupBadge(aiSim), /Dicek AI · keyakinan Tinggi \(91%\)/);
  assert.match(AI.dupBadge(ruleSim), /Cek kata kunci · 72% mirip/);
  const meta = AI.dupMeta(aiSim);
  assert.ok(!meta.includes('<b>') && !meta.includes('<script>'));
  assert.match(meta, /Saran AI — perlu dicek/);
  assert.equal(AI.dupMeta(ruleSim), '');
  assert.match(AI.dupChip(aiSim), /Kemungkinan laporan sama · dicek AI/);
  assert.match(AI.mergeAttrs(aiSim), /data-hai-suggestion="s1"/);
  assert.match(AI.rejectButton('h1', aiSim, true, 'modal'), /data-hai-ctx="modal"/);
  assert.equal(AI.rejectButton('h1', aiSim, false), '');
  assert.match(AI.relatedSection([{ ...aiSim, verdict: 'TERKAIT' }]), /Pola berulang \(TERKAIT\)/);
});

test('Tombol Saran AI hanya muncul bila fitur triase aktif (Uji: hanya Admin Utama)', () => {
  const AI = load();
  const ov = (enabled, mode, canEdit) => ({ settings: { enabled, features: { hse_triage: mode } }, can_edit: canEdit });
  assert.equal(AI.triageAvailable(null), false);
  assert.equal(AI.triageAvailable(ov(false, 'ON', true)), false);
  assert.equal(AI.triageAvailable(ov(true, 'ON', false)), true);
  assert.equal(AI.triageAvailable(ov(true, 'SHADOW', false)), false);
  assert.equal(AI.triageAvailable(ov(true, 'SHADOW', true)), true);
  assert.equal(AI.triageAvailable(ov(true, 'OFF', true)), false);
});

test('Setup Asisten AI: status tanpa key, hanya-baca untuk non Admin Utama', () => {
  const AI = load();
  AI._setupState.overview = {
    settings: { enabled: true, features: { hse_duplicate: 'SHADOW', hse_triage: 'OFF' }, duplicate_min_confidence: 0.75,
      duplicate_window_days: 30, monthly_budget_usd: 20, daily_call_limit: 300, migrated: true },
    server: { ready: false, provider: 'nvidia_nim', host: 'integrate.api.nvidia.com', key_present: false, models: {}, problems: ['API key belum terpasang'] },
    usage: { month_calls: 3, month_ok: 2, by_status: { OK: 2, TIMEOUT: 1 } },
    jobs_30d: {}, can_edit: false,
  };
  const html = AI.renderSetup();
  assert.match(html, /Belum siap/);
  assert.match(html, /API key belum terpasang/);
  assert.match(html, /Hanya Admin Utama yang dapat mengubah/);
  assert.ok(!/id="haiSettingsSave"/.test(html), 'tombol simpan tidak ada untuk non Admin Utama');
  assert.match(html, /Uji diam-diam/);
  AI._setupState.overview.can_edit = true;
  const html2 = AI.renderSetup();
  assert.match(html2, /id="haiSettingsSave"/);
  assert.match(html2, /Periksa ulang semua laporan terbuka/);
});

test('hse.js memakai komponen Asisten AI: tab Setup, alasan gabung, Bukan duplikat, Saran AI', () => {
  assert.match(indexHtml, /<script src="hse-ai\.js\?v=\d+"><\/script>\s*<script src="hse\.js\?v=\d+">/);
  assert.match(hseJs, /data-setup-tab="ai"/);
  assert.match(hseJs, /OMOSHseAi\.renderSetup\(\)/);
  assert.match(hseJs, /source_hazard_id: sourceId,\s*reason,/);
  assert.match(hseJs, /bindRejectButtons\(rootEl, \{\s*api,\s*ctx: 'list'/);
  assert.match(hseJs, /bindRejectButtons\(rootEl, \{\s*api,\s*ctx: 'modal'/);
  assert.match(hseJs, /mountTriage\(\{\s*button: 'btnHzFormAi'/);
  assert.match(hseJs, /mountTriage\(\{\s*button: 'btnHzEditAi'/);
  assert.match(hseJs, /mountTriage\(\{\s*button: 'btnHzDetailAi'/);
  assert.match(hseJs, /api\('\/ai\/overview'\)/);
  assert.ok(!/nvapi-|integrate\.api\.nvidia\.com/.test(src + hseJs), 'tidak ada key/host provider di frontend');
});
