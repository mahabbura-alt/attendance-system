'use strict';

/**
 * Menjalankan satu agen: cek budget → bangun prompt → panggil model → validasi skema → audit.
 * Agen = modul { id, version, alias, temperature, maxTokens, timeoutMs, buildMessages(input), validate(raw, input) }.
 * Tidak pernah melempar error provider ke pemanggil: hasil selalu { ok, status, ... }.
 */

const { createLlmClient, parseJsonContent, LlmError } = require('./llmClient');
const { checkBudget } = require('./budget');
const { recordRequest, sha256 } = require('./aiAudit');

let defaultClient = null;
function getDefaultClient() {
  if (!defaultClient) defaultClient = createLlmClient();
  return defaultClient;
}
/** Hanya untuk tes: ganti klien LLM (mis. tiruan). */
function setDefaultClient(client) {
  defaultClient = client;
}

const STATUS_MESSAGES = {
  NOT_CONFIGURED: 'Asisten AI belum dikonfigurasi di server.',
  BUDGET_BLOCKED: 'Batas pemakaian AI tercapai. Coba lagi besok atau naikkan batas di Setup Asisten AI.',
  TIMEOUT: 'Asisten AI tidak merespons tepat waktu. Coba lagi.',
  RATE_LIMITED: 'Provider AI sedang membatasi permintaan. Coba lagi beberapa saat lagi.',
  PROVIDER_ERROR: 'Provider AI sedang bermasalah. Coba lagi nanti.',
  INVALID_OUTPUT: 'Jawaban AI tidak sesuai format. Coba lagi.',
};

async function runAgent({ db, scope, user = null, agent, input, mode = 'ON', source = {}, settings, client, skipBudget = false }) {
  const llm = client || getDefaultClient();
  const messages = agent.buildMessages(input);
  const base = {
    agentId: agent.id,
    agentVersion: agent.version,
    modelAlias: agent.alias,
    provider: llm.providerInfo ? llm.providerInfo().provider : null,
    providerModel: llm.providerInfo ? llm.providerInfo().models?.[agent.alias] : null,
    userId: user?.id || null,
    sourceType: source.type || null,
    sourceId: source.id || null,
    mode: mode === 'EVAL' ? 'EVAL' : (mode === 'SHADOW' ? 'SHADOW' : 'ON'),
    payloadSha256: sha256(messages),
  };

  if (!skipBudget && settings) {
    const budget = await checkBudget(db, scope, settings);
    if (!budget.allowed) {
      const requestId = await recordRequest(db, scope, { ...base, status: 'BUDGET_BLOCKED', errorCode: budget.reason });
      return { ok: false, status: 'BUDGET_BLOCKED', message: STATUS_MESSAGES.BUDGET_BLOCKED, requestId };
    }
  }

  let attempts = 0;
  let totalIn = 0;
  let totalOut = 0;
  let lastErr = null;
  while (attempts < 2) {
    attempts += 1;
    let res;
    try {
      res = await llm.chat({
        alias: agent.alias,
        messages,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        timeoutMs: agent.timeoutMs,
      });
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'PROVIDER_ERROR';
      const requestId = await recordRequest(db, scope, { ...base, status: code, errorCode: err.status ? `HTTP_${err.status}` : code });
      return { ok: false, status: code, message: STATUS_MESSAGES[code] || STATUS_MESSAGES.PROVIDER_ERROR, requestId };
    }
    totalIn += res.usage.input;
    totalOut += res.usage.output;
    try {
      const parsed = parseJsonContent(res.content);
      const output = agent.validate(parsed, input);
      const usage = { input: totalIn, output: totalOut };
      const costUsd = llm.estimateCostUsd ? llm.estimateCostUsd(usage) : 0;
      const requestId = await recordRequest(db, scope, {
        ...base, providerModel: res.model || base.providerModel, status: 'OK', latencyMs: res.latencyMs,
        inputTokens: totalIn, outputTokens: totalOut, costUsd,
      });
      return { ok: true, status: 'OK', output, requestId, model: res.model, latencyMs: res.latencyMs, attempts, usedFallback: Boolean(res.usedFallback) };
    } catch (err) {
      lastErr = err;
      // Satu kali ulang bila format tidak valid.
    }
  }
  const usage = { input: totalIn, output: totalOut };
  const requestId = await recordRequest(db, scope, {
    ...base, status: 'INVALID_OUTPUT', errorCode: 'SCHEMA', inputTokens: totalIn, outputTokens: totalOut,
    costUsd: llm.estimateCostUsd ? llm.estimateCostUsd(usage) : 0,
  });
  return { ok: false, status: 'INVALID_OUTPUT', message: STATUS_MESSAGES.INVALID_OUTPUT, requestId, detail: lastErr?.message };
}

module.exports = { runAgent, setDefaultClient, getDefaultClient, STATUS_MESSAGES };
