'use strict';

/**
 * Konfigurasi provider LLM — dibaca dari environment server SAJA.
 *
 *   LLM_ENABLED=true|false               sakelar utama server (default false)
 *   LLM_PROVIDER=nvidia_nim              label provider (untuk audit)
 *   LLM_BASE_URL=https://integrate.api.nvidia.com/v1
 *   LLM_ALLOWED_HOSTS=integrate.api.nvidia.com   (dipisah koma)
 *   LLM_API_KEY_FILE=/run/secrets/llm_api_key    (disarankan)  — atau LLM_API_KEY (cadangan)
 *   LLM_MODEL_STANDARD / LLM_MODEL_CHEAP / LLM_MODEL_VISION     ID model provider per alias
 *   LLM_MODEL_STANDARD_FALLBACK          model cadangan alias standar (opsional)
 *   LLM_TIMEOUT_MS=30000
 *   LLM_PRICE_INPUT_PER_MTOK / LLM_PRICE_OUTPUT_PER_MTOK   USD per 1 juta token (free endpoint = 0)
 *   LLM_EXTRA_BODY='{"chat_template_kwargs":{"thinking":false}}'  parameter tambahan khusus model (opsional)
 *   LLM_JSON_MODE=off|on                 kirim response_format json_object (default off)
 *
 * API key tidak pernah dikembalikan oleh modul ini kecuali lewat readApiKey().
 */

const fs = require('fs');

const ALIASES = ['omos-standard', 'omos-cheap', 'omos-vision'];
const KEY_CACHE_MS = 60 * 1000;
let keyCache = { value: null, at: 0, source: null, origin: null };

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function parseExtraBody(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Kunci yang dikendalikan OMOS tidak boleh ditimpa lewat env tambahan.
    for (const k of ['model', 'messages', 'temperature', 'max_tokens', 'stream']) delete parsed[k];
    return parsed;
  } catch (_) {
    return {};
  }
}

/** Validasi base URL: wajib https, host di allowlist, tanpa kredensial di URL. */
function validateBaseUrl(baseUrl, allowedHosts) {
  let url;
  try {
    url = new URL(String(baseUrl || ''));
  } catch (_) {
    return { ok: false, error: 'LLM_BASE_URL tidak valid' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'LLM_BASE_URL wajib https' };
  if (url.username || url.password) return { ok: false, error: 'LLM_BASE_URL tidak boleh memuat kredensial' };
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.length || !allowedHosts.includes(host)) {
    return { ok: false, error: `Host ${host} tidak ada di LLM_ALLOWED_HOSTS` };
  }
  return { ok: true, url: url.toString().replace(/\/+$/, ''), host };
}

function loadConfig(env = process.env) {
  const allowedHosts = String(env.LLM_ALLOWED_HOSTS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const base = validateBaseUrl(env.LLM_BASE_URL, allowedHosts);
  const models = {
    'omos-standard': String(env.LLM_MODEL_STANDARD || '').trim() || null,
    'omos-cheap': String(env.LLM_MODEL_CHEAP || env.LLM_MODEL_STANDARD || '').trim() || null,
    'omos-vision': String(env.LLM_MODEL_VISION || env.LLM_MODEL_STANDARD || '').trim() || null,
  };
  const fallbacks = {
    'omos-standard': String(env.LLM_MODEL_STANDARD_FALLBACK || '').trim() || null,
  };
  return {
    enabled: bool(env.LLM_ENABLED, false),
    provider: String(env.LLM_PROVIDER || 'openai_compatible').trim(),
    baseUrl: base.ok ? base.url : null,
    host: base.ok ? base.host : null,
    baseUrlError: base.ok ? null : base.error,
    allowedHosts,
    keyFile: String(env.LLM_API_KEY_FILE || '').trim() || null,
    hasInlineKey: Boolean(String(env.LLM_API_KEY || '').trim()),
    models,
    fallbacks,
    timeoutMs: Math.min(120000, Math.max(1000, num(env.LLM_TIMEOUT_MS, 30000))),
    priceInputPerMTok: num(env.LLM_PRICE_INPUT_PER_MTOK, 0),
    priceOutputPerMTok: num(env.LLM_PRICE_OUTPUT_PER_MTOK, 0),
    extraBody: parseExtraBody(env.LLM_EXTRA_BODY),
    jsonMode: bool(env.LLM_JSON_MODE, false),
  };
}

/**
 * Baca API key: file rahasia (dibaca ulang tiap 60 detik → rotasi tanpa restart),
 * lalu LLM_API_KEY sebagai cadangan. Mengembalikan null bila tidak ada.
 */
function readApiKey(env = process.env, now = Date.now()) {
  const file = String(env.LLM_API_KEY_FILE || '').trim();
  if (keyCache.value && keyCache.source === file && now - keyCache.at < KEY_CACHE_MS) return keyCache.value;
  let value = null;
  let origin = null;
  if (file) {
    try {
      value = fs.readFileSync(file, 'utf8').trim() || null;
      if (value) origin = 'file';
    } catch (_) {
      value = null;
    }
  }
  if (!value) {
    value = String(env.LLM_API_KEY || '').trim() || null;
    if (value) origin = 'env';
  }
  keyCache = { value, at: now, source: file, origin };
  return value;
}

function resetKeyCache() {
  keyCache = { value: null, at: 0, source: null, origin: null };
}

/** Ringkasan status yang aman ditampilkan (tanpa potongan key sama sekali). */
function publicStatus(env = process.env) {
  const cfg = loadConfig(env);
  const keyPresent = Boolean(readApiKey(env));
  const problems = [];
  if (!cfg.enabled) problems.push('LLM_ENABLED belum true');
  if (cfg.baseUrlError) problems.push(cfg.baseUrlError);
  if (!keyPresent) problems.push('API key belum terpasang');
  if (!cfg.models['omos-standard']) problems.push('LLM_MODEL_STANDARD belum diisi');
  return {
    ready: problems.length === 0,
    enabled: cfg.enabled,
    provider: cfg.provider,
    host: cfg.host,
    key_present: keyPresent,
    key_source: keyPresent ? keyCache.origin : null,
    models: cfg.models,
    problems,
  };
}

module.exports = { ALIASES, loadConfig, readApiKey, resetKeyCache, publicStatus, validateBaseUrl };
