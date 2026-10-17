'use strict';

/**
 * Adapter tipis ke provider LLM berformat OpenAI (/v1/chat/completions).
 * Aturan keamanan:
 *  - Base URL hanya https + host di allowlist; redirect DITOLAK (key tidak boleh ikut ke host lain).
 *  - Header Authorization tidak pernah dicatat; error hanya membawa {code, status}.
 *  - Agen memanggil alias (omos-standard, ...), bukan nama model provider.
 */

const { loadConfig, readApiKey } = require('./config');

class LlmError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'LlmError';
    this.code = code; // NOT_CONFIGURED | TIMEOUT | PROVIDER_ERROR | RATE_LIMITED | INVALID_OUTPUT
    this.status = extra.status || null;
  }
}

/** Ambil objek JSON dari teks model: buang blok <think>, pagar ```json, teks sebelum/sesudah. */
function parseJsonContent(content) {
  if (content && typeof content === 'object') return content;
  let text = String(content || '').trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch (_) { /* coba potong */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) { /* gagal */ }
  }
  throw new LlmError('INVALID_OUTPUT', 'Keluaran model bukan JSON yang valid');
}

function classifyHttp(status) {
  if (status === 429) return 'RATE_LIMITED';
  return 'PROVIDER_ERROR';
}

function createLlmClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  async function callModel(cfg, key, model, { messages, temperature, maxTokens, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || cfg.timeoutMs);
    const started = Date.now();
    const body = {
      ...cfg.extraBody,
      model,
      messages,
      temperature: typeof temperature === 'number' ? temperature : 0,
      max_tokens: maxTokens || 800,
      stream: false,
    };
    if (cfg.jsonMode) body.response_format = { type: 'json_object' };
    let res;
    try {
      res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (err && (err.name === 'AbortError' || controller.signal.aborted)) {
        throw new LlmError('TIMEOUT', 'Provider AI tidak merespons dalam batas waktu');
      }
      // Jangan teruskan err.message mentah (bisa memuat detail jaringan); cukup kode.
      throw new LlmError('PROVIDER_ERROR', 'Gagal menghubungi provider AI');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      try { await res.text(); } catch (_) { /* kosongkan body */ }
      throw new LlmError(classifyHttp(res.status), `Provider AI menolak permintaan (HTTP ${res.status})`, { status: res.status });
    }
    let json;
    try {
      json = await res.json();
    } catch (_) {
      throw new LlmError('INVALID_OUTPUT', 'Respons provider bukan JSON');
    }
    const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
    const content = choice?.message?.content;
    if (content === undefined || content === null || content === '') {
      throw new LlmError('INVALID_OUTPUT', 'Respons provider tanpa isi');
    }
    return {
      content,
      model: json.model || model,
      usage: {
        input: Number(json?.usage?.prompt_tokens) || 0,
        output: Number(json?.usage?.completion_tokens) || 0,
      },
      latencyMs: Date.now() - started,
      finishReason: choice?.finish_reason || null,
    };
  }

  async function chat({ alias = 'omos-standard', messages, temperature, maxTokens, timeoutMs } = {}) {
    const cfg = loadConfig(env);
    if (!cfg.enabled) throw new LlmError('NOT_CONFIGURED', 'AI dimatikan di server (LLM_ENABLED)');
    if (!cfg.baseUrl) throw new LlmError('NOT_CONFIGURED', cfg.baseUrlError || 'LLM_BASE_URL belum diatur');
    const model = cfg.models[alias];
    if (!model) throw new LlmError('NOT_CONFIGURED', `Model untuk alias ${alias} belum diatur`);
    const key = readApiKey(env);
    if (!key) throw new LlmError('NOT_CONFIGURED', 'API key belum terpasang di server');
    if (typeof fetchImpl !== 'function') throw new LlmError('NOT_CONFIGURED', 'fetch tidak tersedia');

    const args = { messages, temperature, maxTokens, timeoutMs };
    try {
      return await callModel(cfg, key, model, args);
    } catch (err) {
      const fallback = cfg.fallbacks[alias] || cfg.fallbacks['omos-standard'];
      const retryable = err instanceof LlmError && ['RATE_LIMITED', 'PROVIDER_ERROR', 'TIMEOUT'].includes(err.code);
      if (!fallback || fallback === model || !retryable) throw err;
      const out = await callModel(cfg, key, fallback, args);
      return { ...out, usedFallback: true };
    }
  }

  function estimateCostUsd(usage, env2 = env) {
    const cfg = loadConfig(env2);
    const cost = (usage.input / 1e6) * cfg.priceInputPerMTok + (usage.output / 1e6) * cfg.priceOutputPerMTok;
    return Math.round(cost * 1e6) / 1e6;
  }

  return { chat, estimateCostUsd, providerInfo: () => { const c = loadConfig(env); return { provider: c.provider, models: c.models }; } };
}

module.exports = { createLlmClient, parseJsonContent, LlmError };
