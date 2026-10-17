'use strict';

/**
 * Penjaga angka Tanya OMOS: setiap angka di jawaban AI harus berasal dari hasil tool,
 * pertanyaan pengguna, atau tanggal hari ini. Angka lain (hasil hitungan/karangan AI) → jawaban ditolak.
 */

const NUM_RE = /\d[\d.,]*/g;
const FREE_TEXT_KEYS = /^(uraian|description|deskripsi|potential_consequence|catatan|notes|alasan|keterangan|remarks|root_cause)$/i;
const FREE_TEXT_MIN = 40; // string lebih panjang dari ini dianggap teks bebas

/** Semua kandidat nilai dari sebuah token angka (menangani "1.250", "1,250", "0,42", "1.234,5"). */
function candidates(token) {
  const t = token.replace(/[.,]+$/, '');
  if (!t) return [];
  const out = new Set();
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  const asNumber = s => { const n = Number(s); return Number.isFinite(n) ? n : null; };
  if (lastDot >= 0 && lastComma >= 0) {
    // pemisah terakhir = desimal
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    out.add(asNumber(t.split(thouSep).join('').replace(decSep, '.')));
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = t.split(sep);
    // tafsir desimal (hanya bila satu pemisah)
    if (parts.length === 2) out.add(asNumber(`${parts[0]}.${parts[1]}`));
    // tafsir ribuan (grup 3 digit)
    if (parts.slice(1).every(p => p.length === 3)) out.add(asNumber(parts.join('')));
  } else {
    out.add(asNumber(t));
  }
  return Array.from(out).filter(n => n !== null);
}

function decimalsOf(token) {
  const m = token.replace(/[.,]+$/, '').match(/[.,](\d+)$/);
  return m ? m[1].length : 0;
}

/** Kumpulkan semua angka dari objek/teks sumber. */
function collectNumbers(source, set = new Set()) {
  if (source === null || source === undefined) return set;
  if (typeof source === 'number') { if (Number.isFinite(source)) set.add(source); return set; }
  if (typeof source === 'string') {
    // Teks bebas (uraian laporan dsb.) tidak boleh menjadi "sumber angka": isinya bisa disusupi pelapor.
    if (source.length > FREE_TEXT_MIN) return set;
    for (const m of source.match(NUM_RE) || []) for (const c of candidates(m)) set.add(c);
    return set;
  }
  if (Array.isArray(source)) { for (const v of source) collectNumbers(v, set); return set; }
  if (typeof source === 'object') {
    for (const [k, v] of Object.entries(source)) {
      if (FREE_TEXT_KEYS.test(k)) continue;
      collectNumbers(v, set);
    }
  }
  return set;
}

function matches(value, decimals, pool) {
  for (const x of pool) {
    if (Math.abs(x - value) < 1e-9) return true;
    const f = 10 ** decimals;
    if (Math.abs(Math.round(x * f) / f - value) < 1e-9) return true; // pembulatan wajar
  }
  return false;
}

/**
 * @returns {{ok:boolean, unknown:string[]}}
 */
function checkAnswerNumbers(answerTexts, sources) {
  const pool = collectNumbers(sources);
  pool.add(0);
  const unknown = [];
  const text = (Array.isArray(answerTexts) ? answerTexts : [answerTexts]).map(t => String(t ?? '')).join('\n');
  // Abaikan penomoran daftar di awal baris ("1. ", "2) ").
  const cleaned = text.replace(/^\s*\d{1,2}[.)]\s+/gm, '');
  for (const m of cleaned.match(NUM_RE) || []) {
    const cs = candidates(m);
    if (!cs.length) continue;
    const dec = decimalsOf(m);
    const ok = cs.some(c => matches(c, dec, pool) || matches(c, 0, pool));
    if (!ok) unknown.push(m.replace(/[.,]+$/, ''));
  }
  return { ok: unknown.length === 0, unknown: Array.from(new Set(unknown)) };
}

module.exports = { checkAnswerNumbers, collectNumbers, candidates };
