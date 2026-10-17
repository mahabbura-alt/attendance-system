'use strict';

/**
 * Pemadat & penyamar hasil tool Tanya OMOS sebelum dikirim ke penyedia AI.
 *  - Kunci berisi data pribadi/berkas dibuang (nrp, nik, telepon, email, foto, dokumen, token…).
 *  - Nilai pada kunci "nama orang" diganti [ORANG-n] (pemulihan hanya di server setelah jawaban lolos pemeriksaan).
 *  - Teks bebas disensor dengan redactText dan dipotong; array dibatasi; kedalaman dibatasi.
 */

const crypto = require('crypto');
const { redactText } = require('../redact');

const DROP_KEY = /(^|_)(nrp|nik|ktp|phone|telp|telepon|hp|no_hp|email|password|passwd|token|secret|signature|ttd|photo|photos|foto|file|files|attachment|attachments|document|dokumen|url|path|address|alamat|birth|lahir)(_|$)/i;
const PERSON_KEY = /^(nama|name|full_name|reported_by_name|assigned_to_name|pic_name|employee_name|reporter_name|person_name|injured_name|led_by_name|lead_name|requested_by_name|approved_by_name|issuer_name|user_name|created_by_name|inspector_name|auditor_name)$/i;

/**
 * Pseudonimizer: nama → [ORANG-xxxxxx] (hash stabil, jadi hasil tool bisa di-cache lintas permintaan).
 * Pemulihan nama hanya dilakukan di server pada jawaban akhir.
 */
function createAliaser() {
  const toAlias = new Map();
  const toName = new Map();
  return {
    alias(name) {
      const clean = String(name || '').trim();
      if (!clean) return clean;
      const k = clean.toLowerCase();
      if (!toAlias.has(k)) {
        const hash = crypto.createHash('sha256').update(k).digest('hex');
        let len = 6;
        let a = `[ORANG-${hash.slice(0, len)}]`;
        while (toName.has(a) && toName.get(a).toLowerCase() !== k && len < 20) { len += 2; a = `[ORANG-${hash.slice(0, len)}]`; }
        toAlias.set(k, a);
        toName.set(a, clean);
      }
      return toAlias.get(k);
    },
    names() { return Array.from(toName.values()); },
    restore(text) {
      return String(text || '').replace(/\[ORANG-[0-9a-f]+\]/g, m => toName.get(m) || m);
    },
  };
}

function compactValue(value, ctx, { maxItems = 15, maxString = 220, maxDepth = 5, depth = 0, key = '' } = {}) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return Number(value);
  if (t === 'string') {
    if (PERSON_KEY.test(key)) return ctx.aliaser.alias(value);
    const red = redactText(value, { names: ctx.aliaser.names() });
    return red.length > maxString ? `${red.slice(0, maxString)}…` : red;
  }
  if (depth >= maxDepth) return '[dipangkas]';
  if (Array.isArray(value)) {
    const items = value.slice(0, maxItems).map(v => compactValue(v, ctx, { maxItems, maxString, maxDepth, depth: depth + 1, key }));
    return value.length > maxItems ? { total: value.length, ditampilkan: items.length, items } : items;
  }
  if (t === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DROP_KEY.test(k)) continue;
      if (typeof v === 'function') continue;
      out[k] = compactValue(v, ctx, { maxItems, maxString, maxDepth, depth: depth + 1, key: k });
    }
    return out;
  }
  return String(value);
}

module.exports = { compactValue, createAliaser, DROP_KEY, PERSON_KEY };
