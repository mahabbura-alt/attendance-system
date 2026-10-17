'use strict';

/**
 * Antrean pekerjaan AI (tabel ai_jobs). Idempoten lewat dedupe_key.
 * Handler: async (db, job) => ({ status: 'DONE'|'SKIPPED'|'RETRY', summary?, error? })
 * Worker berjalan di dalam proses app (setInterval) dan aman bila ada lebih dari satu proses
 * (klaim memakai FOR UPDATE SKIP LOCKED).
 */

const MAX_ATTEMPTS = 3;
const STUCK_MINUTES = 10;

async function enqueue(db, scope, { agentId, sourceType, sourceId, dedupeKey, delaySeconds = 0 }) {
  try {
    const { rows } = await db.query(`
      INSERT INTO ai_jobs (tenant_key, project_key, agent_id, source_type, source_id, dedupe_key, run_after)
      VALUES ($1,$2,$3,$4,$5,$6, CURRENT_TIMESTAMP + ($7 || ' seconds')::interval)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `, [scope.tenantKey, scope.projectKey, agentId, sourceType, String(sourceId), dedupeKey, String(Math.max(0, delaySeconds | 0))]);
    return { queued: Boolean(rows[0]), id: rows[0]?.id || null };
  } catch (err) {
    if (err.code === '42P01') return { queued: false, id: null, reason: 'MIGRATION_REQUIRED' };
    throw err;
  }
}

async function claim(db, limit = 3) {
  await db.query(`
    UPDATE ai_jobs SET status = 'QUEUED', last_error = 'dipulihkan dari RUNNING macet'
    WHERE status = 'RUNNING' AND started_at < CURRENT_TIMESTAMP - interval '${STUCK_MINUTES} minutes'
  `);
  const { rows } = await db.query(`
    UPDATE ai_jobs SET status = 'RUNNING', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP
    WHERE id IN (
      SELECT id FROM ai_jobs
      WHERE status = 'QUEUED' AND run_after <= CURRENT_TIMESTAMP
      ORDER BY run_after ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [limit]);
  return rows;
}

async function finish(db, job, result) {
  const status = result?.status || 'DONE';
  if (status === 'RETRY' && job.attempts < MAX_ATTEMPTS) {
    const backoffSec = 60 * job.attempts * job.attempts;
    await db.query(`
      UPDATE ai_jobs SET status = 'QUEUED', run_after = CURRENT_TIMESTAMP + ($2 || ' seconds')::interval,
        last_error = $3
      WHERE id = $1
    `, [job.id, String(backoffSec), String(result?.error || '').slice(0, 300) || null]);
    return 'QUEUED';
  }
  const finalStatus = status === 'RETRY' ? 'FAILED' : status;
  await db.query(`
    UPDATE ai_jobs SET status = $2, finished_at = CURRENT_TIMESTAMP, last_error = $3, result_summary = $4::jsonb
    WHERE id = $1
  `, [job.id, finalStatus, result?.error ? String(result.error).slice(0, 300) : null,
    result?.summary ? JSON.stringify(result.summary) : null]);
  return finalStatus;
}

async function runPending(db, handlers, { limit = 3 } = {}) {
  let jobs;
  try {
    jobs = await claim(db, limit);
  } catch (err) {
    if (err.code === '42P01') return { processed: 0, reason: 'MIGRATION_REQUIRED' };
    throw err;
  }
  const results = [];
  for (const job of jobs) {
    const handler = handlers[job.agent_id];
    let result;
    if (!handler) {
      result = { status: 'SKIPPED', error: 'handler tidak terdaftar' };
    } else {
      try {
        result = await handler(db, job);
      } catch (err) {
        result = { status: 'RETRY', error: err.code ? `ERR_${err.code}` : 'ERR_HANDLER' };
        console.warn(JSON.stringify({ message: 'ai job gagal', agent: job.agent_id, job: job.id, code: err.code || null }));
      }
    }
    results.push({ id: job.id, status: await finish(db, job, result) });
  }
  return { processed: jobs.length, results };
}

function startWorker(db, handlers, { intervalMs = 5000, limit = 2 } = {}) {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await runPending(db, handlers, { limit });
    } catch (err) {
      console.warn(JSON.stringify({ message: 'ai worker tick gagal', code: err.code || null }));
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return { stop() { stopped = true; clearInterval(timer); }, tick };
}

module.exports = { enqueue, claim, finish, runPending, startWorker, MAX_ATTEMPTS };
