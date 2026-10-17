'use strict';

/**
 * Proses antrean AI sekali jalan (cadangan bila worker di dalam app dimatikan, AI_WORKER=off).
 *   node backend/src/scripts/run_ai_jobs.js [--limit 20]
 */
require('dotenv').config();
const { pool } = require('../config/db');
const { runPending } = require('../ai/aiJobs');
const hseAi = require('../services/hseAi');

async function main() {
  const i = process.argv.indexOf('--limit');
  const limit = i > 0 ? Math.max(1, Number(process.argv[i + 1]) || 20) : 20;
  let total = 0;
  for (;;) {
    const r = await runPending(pool, { [hseAi.DUP_AGENT_ID]: hseAi.duplicateJobHandler }, { limit: Math.min(5, limit - total) });
    total += r.processed;
    if (!r.processed || total >= limit) break;
  }
  console.log(`Antrean AI diproses: ${total} pekerjaan.`);
}

main()
  .catch(err => { console.error('Gagal memproses antrean AI:', err.code || err.message); process.exitCode = 1; })
  .finally(() => pool.end().catch(() => {}));
