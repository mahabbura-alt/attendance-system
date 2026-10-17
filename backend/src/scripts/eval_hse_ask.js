'use strict';

/**
 * Evaluasi perencana Tanya OMOS: apakah model memilih tool yang tepat / menolak dengan benar.
 *
 *   node backend/src/scripts/eval_hse_ask.js [--file gold.jsonl] [--runs 2]
 *
 * Format gold set (JSON Lines): {"id","q","tools":["nama_tool",...],"refuse":true?}
 *   - lulus bila SEMUA tool yang dipilih model ada di daftar "tools" dan minimal satu cocok,
 *   - untuk "refuse":true lulus bila model tidak memilih tool apa pun.
 * Memakai konfigurasi LLM_* server (butuh jaringan). Tidak menulis ke database. Hanya tahap perencana.
 * Target lulus (rencana): akurasi tool >= 85%, penolakan benar 100%, konsistensi antar-run >= 90%.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { runAgent } = require('../ai/agentRunner');
const { getAgent } = require('../ai/agentRegistry');
const { toolCatalog } = require('../ai/ask/tools');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const nullDb = { query: async () => ({ rows: [] }) };

async function plan(q) {
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const run = await runAgent({
    db: nullDb, scope: { tenantKey: 'eval', projectKey: 'eval' }, agent: getAgent('hse.askPlanner'),
    input: { pertanyaan: q, hari_ini: today, konteks_layar: null, riwayat: [], katalog: toolCatalog() },
    mode: 'EVAL', skipBudget: true,
  });
  const ms = Date.now() - started;
  if (!run.ok) return { error: run.status || run.message, ms };
  return { tools: run.output.tools.map(t => t.nama), ms };
}

(async () => {
  const file = arg('--file', path.join(__dirname, '../../test/fixtures/hse-ask-goldset.jsonl'));
  const runs = Number(arg('--runs', 2)) || 1;
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
  let pass = 0; let errors = 0; let refusePass = 0; let refuseTotal = 0; let stable = 0; const lat = []; const fails = [];
  for (const r of rows) {
    const outs = [];
    for (let i = 0; i < runs; i += 1) outs.push(await plan(r.q));
    lat.push(...outs.map(o => o.ms));
    if (outs.some(o => o.error)) { errors += 1; fails.push(`${r.id} ERROR ${outs.find(o => o.error).error}`); continue; }
    const sig = outs.map(o => [...o.tools].sort().join(','));
    if (new Set(sig).size === 1) stable += 1;
    const got = outs[0].tools;
    let ok;
    if (r.refuse) { refuseTotal += 1; ok = got.length === 0; if (ok) refusePass += 1; } else ok = got.length > 0 && got.every(t => r.tools.includes(t));
    if (ok) pass += 1; else fails.push(`${r.id} "${r.q}" -> [${got.join(', ')}] (harap: ${r.refuse ? 'menolak' : r.tools.join('/')})`);
  }
  lat.sort((a, b) => a - b);
  const p = (x) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * x))] : 0;
  console.log(`Pertanyaan: ${rows.length}  Lulus: ${pass}  Gagal panggil: ${errors}`);
  console.log(`Akurasi: ${(100 * pass / rows.length).toFixed(0)}%  Penolakan benar: ${refusePass}/${refuseTotal}  Konsisten: ${(100 * stable / rows.length).toFixed(0)}%`);
  console.log(`Latensi perencana: median ${p(0.5)} ms, p90 ${p(0.9)} ms`);
  if (fails.length) console.log(`\nPerlu dicek:\n- ${fails.join('\n- ')}`);
})().catch(e => { console.error(e.message); process.exit(1); });
