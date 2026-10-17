'use strict';

/** Audit panggilan AI ke ai_requests — tanpa isi prompt/jawaban, hanya hash SHA-256. */

const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

async function recordRequest(db, scope, entry) {
  try {
    const { rows } = await db.query(`
      INSERT INTO ai_requests (tenant_key, project_key, agent_id, agent_version, model_alias, provider, provider_model,
        user_id, source_type, source_id, mode, status, latency_ms, input_tokens, output_tokens, cost_usd, error_code, payload_sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id
    `, [scope.tenantKey, scope.projectKey, entry.agentId, entry.agentVersion, entry.modelAlias, entry.provider || null,
      entry.providerModel || null, entry.userId || null, entry.sourceType || null,
      entry.sourceId ? String(entry.sourceId) : null, entry.mode || 'ON', entry.status,
      entry.latencyMs ?? null, entry.inputTokens ?? null, entry.outputTokens ?? null, entry.costUsd || 0,
      entry.errorCode || null, entry.payloadSha256 || null]);
    return rows[0]?.id || null;
  } catch (err) {
    // Audit tidak boleh menggagalkan pekerjaan utama, tapi kegagalan dicatat (tanpa data sensitif).
    console.warn(JSON.stringify({ message: 'ai_requests insert gagal', code: err.code || null }));
    return null;
  }
}

/** Pemakaian: bulan berjalan & hari ini (Asia/Jakarta). */
async function usageSummary(db, scope) {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta')::int AS month_calls,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta' AND status = 'OK')::int AS month_ok,
      COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta'), 0)::bigint AS month_input_tokens,
      COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta'), 0)::bigint AS month_output_tokens,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta'), 0)::numeric AS month_cost_usd,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', (now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta'
        AND status NOT IN ('BUDGET_BLOCKED','DISABLED','NOT_CONFIGURED'))::int AS today_calls,
      MAX(created_at) FILTER (WHERE status = 'OK') AS last_ok_at,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'OK'
        AND created_at >= now() - interval '30 days') AS p95_latency_ms
    FROM ai_requests
    WHERE tenant_key = $1 AND project_key = $2
  `, [scope.tenantKey, scope.projectKey]);
  const r = rows[0] || {};
  const byStatus = await db.query(`
    SELECT status, COUNT(*)::int AS n FROM ai_requests
    WHERE tenant_key = $1 AND project_key = $2
      AND created_at >= date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta'
    GROUP BY status
  `, [scope.tenantKey, scope.projectKey]);
  return {
    month_calls: Number(r.month_calls) || 0,
    month_ok: Number(r.month_ok) || 0,
    month_input_tokens: Number(r.month_input_tokens) || 0,
    month_output_tokens: Number(r.month_output_tokens) || 0,
    month_cost_usd: Number(r.month_cost_usd) || 0,
    today_calls: Number(r.today_calls) || 0,
    last_ok_at: r.last_ok_at || null,
    p95_latency_ms: r.p95_latency_ms === null || r.p95_latency_ms === undefined ? null : Math.round(Number(r.p95_latency_ms)),
    by_status: Object.fromEntries(byStatus.rows.map(x => [x.status, Number(x.n)])),
  };
}

module.exports = { sha256, recordRequest, usageSummary };
