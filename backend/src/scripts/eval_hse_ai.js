'use strict';

/**
 * Evaluasi deteksi hazard ganda: mesin kata kunci lama vs agen AI (H1).
 *
 *   node backend/src/scripts/eval_hse_ai.js [--file gold.jsonl] [--ai] [--runs 3] [--min-conf 0.75]
 *
 * Format gold set (JSON Lines, satu pasangan per baris, TANPA nama orang):
 *   {"id":"P1","label":"SAMA|TERKAIT|BERBEDA",
 *    "a":{"uraian":"...","konsekuensi":"...","area":"...","sub_area":"..."},
 *    "b":{...}}
 * Default: backend/test/fixtures/hse-ai-goldset-hard-cases.jsonl (kasus sulit Lampiran B).
 * Tanpa --ai hanya mesin lama yang diukur (tanpa panggilan jaringan, tanpa biaya).
 * Dengan --ai memakai konfigurasi LLM_* server; tidak menulis ke database.
 * Target lulus (rencana §8.2): presisi SAMA ≥ 90%, recall ≥ mesin lama + 20 poin, konsistensi ≥ 95%.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const hse = require('../services/hse');
const agent = require('../ai/agents/hse/hazardDuplicate.v1');
const { runAgent } = require('../ai/agentRunner');
const { redactText } = require('../ai/redact');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function loadGold(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map((l, i) => {
    const row = JSON.parse(l);
    if (!['SAMA', 'TERKAIT', 'BERBEDA'].includes(row.label)) throw new Error(`Baris ${i + 1}: label "${row.label}" tidak valid — isi SAMA, TERKAIT, atau BERBEDA (ganti "TINJAU" hasil ekspor)`);
    return row;
  });
}

function asHazard(x, id, locKey) {
  return {
    id, status: 'NEW', merged_into_id: null,
    description: x.uraian, potential_consequence: x.konsekuensi || null,
    location_id: locKey, area_id: `area:${x.area || ''}`, sub_area_id: `sub:${x.area || ''}/${x.sub_area || ''}`,
  };
}

function ruleVerdict(pair) {
  const a = pair.a;
  const b = pair.b;
  const sameLoc = (a.area || '') === (b.area || '') && (a.sub_area || '') === (b.sub_area || '');
  const locA = `${a.area}/${a.sub_area}`;
  const locB = sameLoc ? locA : `${b.area}/${b.sub_area}`;
  const r = hse.computeHazardSimilarity(asHazard(a, 'A', locA), asHazard(b, 'B', locB));
  return { same: r.isSameHazard, pct: r.similarityPct };
}

const nullDb = { query: async () => ({ rows: [] }) };

async function aiVerdict(pair) {
  const input = {
    laporan: { ref: 'L', uraian: redactText(pair.a.uraian), konsekuensi: pair.a.konsekuensi ? redactText(pair.a.konsekuensi) : null, area: pair.a.area, sub_area: pair.a.sub_area },
    kandidat: [{ ref: 'K1', uraian: redactText(pair.b.uraian), konsekuensi: pair.b.konsekuensi ? redactText(pair.b.konsekuensi) : null, area: pair.b.area, sub_area: pair.b.sub_area }],
  };
  const started = Date.now();
  const run = await runAgent({ db: nullDb, scope: { tenantKey: 'eval', projectKey: 'eval' }, agent, input, mode: 'EVAL', skipBudget: true });
  const ms = Date.now() - started;
  if (!run.ok) return { error: run.status, ms };
  const r = run.output.find(x => x.ref === 'K1');
  return r ? { verdict: r.verdict, confidence: r.confidence, reason: r.reason, ms } : { error: 'NO_VERDICT', ms };
}

function prf(rows, predictSame) {
  let tp = 0; let fp = 0; let fn = 0;
  for (const r of rows) {
    const p = predictSame(r);
    const t = r.label === 'SAMA';
    if (p && t) tp += 1; else if (p && !t) fp += 1; else if (!p && t) fn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return { tp, fp, fn, precision, recall };
}

const pct = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

async function main() {
  const file = arg('--file', path.resolve(__dirname, '../../test/fixtures/hse-ai-goldset-hard-cases.jsonl'));
  const useAi = arg('--ai', false) === true;
  const runs = Math.max(1, Number(arg('--runs', 1)) || 1);
  const minConf = Number(arg('--min-conf', 0.75)) || 0.75;
  const gold = loadGold(file);
  console.log(`Gold set: ${gold.length} pasangan (${path.basename(file)})`);

  for (const g of gold) g.rule = ruleVerdict(g);
  const rule = prf(gold, g => g.rule.same);
  console.log(`\nMesin kata kunci: presisi ${pct(rule.precision)} · recall ${pct(rule.recall)} (TP ${rule.tp} / FP ${rule.fp} / FN ${rule.fn})`);

  if (!useAi) {
    console.log('\n(Tambahkan --ai untuk mengukur agen AI dengan konfigurasi LLM_* server.)');
    return;
  }
  const status = require('../ai/config').publicStatus();
  if (!status.ready) {
    console.error(`\nAI belum siap di server: ${status.problems.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const latencies = [];
  let consistent = 0;
  const errors = {};
  for (const g of gold) {
    g.ai = [];
    for (let i = 0; i < runs; i += 1) {
      const r = await aiVerdict(g);
      latencies.push(r.ms);
      if (r.error) errors[r.error] = (errors[r.error] || 0) + 1;
      g.ai.push(r);
    }
    const verdicts = g.ai.map(r => r.verdict || r.error);
    if (new Set(verdicts).size === 1) consistent += 1;
  }
  const first = g => g.ai[0] || {};
  const ai = prf(gold, g => first(g).verdict === 'SAMA' && first(g).confidence >= minConf);
  latencies.sort((x, y) => x - y);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null;
  console.log(`Agen AI (ambang ${minConf}): presisi ${pct(ai.precision)} · recall ${pct(ai.recall)} (TP ${ai.tp} / FP ${ai.fp} / FN ${ai.fn})`);
  if (runs > 1) console.log(`Konsistensi ${runs}×: ${pct(consistent / gold.length)}`);
  console.log(`Latensi p95: ${p95 === null ? '—' : `${(p95 / 1000).toFixed(1)} dtk`}`);
  if (Object.keys(errors).length) console.log('Gagal:', JSON.stringify(errors));

  console.log('\nRincian:');
  for (const g of gold) {
    const a = first(g);
    const mark = (a.verdict || a.error) === g.label ? '✓' : '✗';
    console.log(`${mark} ${g.id.padEnd(5)} benar=${g.label.padEnd(8)} AI=${String(a.verdict || a.error).padEnd(8)} ${a.confidence !== undefined ? `(${pct(a.confidence)})` : ''} kata-kunci=${g.rule.same ? 'SAMA' : 'tidak'} ${a.reason ? `— ${a.reason}` : ''}`);
  }
  const pass = (ai.precision === null || ai.precision >= 0.9)
    && (ai.recall !== null && rule.recall !== null ? ai.recall >= Math.min(1, rule.recall + 0.2) : true)
    && (runs === 1 || consistent / gold.length >= 0.95);
  console.log(`\nHasil terhadap target §8.2: ${pass ? 'LULUS' : 'BELUM LULUS'}`);
  process.exitCode = pass ? 0 : 2;
}

main().catch(err => { console.error('Evaluasi gagal:', err.message); process.exitCode = 1; });
