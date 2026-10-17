'use strict';

/**
 * Sensor data pribadi sebelum teks dikirim ke provider AI.
 * Mengganti: email, NIK/nomor 16 digit, nomor HP Indonesia, nama yang diketahui
 * (pelapor/PIC dari database), dan pola sapaan + nama ("Pak Budi", "Bu Sari").
 * Kode unit/lokasi (DT 785-12, KM 4, LT-05) sengaja DIPERTAHANKAN — itu inti bukti duplikat.
 */

const HONORIFICS = ['pak', 'bapak', 'bu', 'ibu', 'mas', 'mbak', 'bang', 'sdr', 'sdri', 'saudara', 'saudari', 'mr', 'mrs', 'ms'];
// Kata setelah sapaan yang BUKAN nama (jabatan/peran umum di tambang).
const NOT_NAMES = new Set(['pengawas', 'operator', 'driver', 'mekanik', 'foreman', 'supervisor', 'safety', 'hse',
  'kepala', 'ketua', 'manager', 'manajer', 'admin', 'petugas', 'satpam', 'security', 'karyawan', 'pjo', 'ktt', 'gl', 'spv']);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(text, { names = [] } = {}) {
  if (text === null || text === undefined) return text;
  let out = String(text);

  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
  // NIK / nomor identitas 16 digit (boleh dengan spasi/titik pemisah).
  out = out.replace(/\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g, '[NIK]');
  // Nomor HP Indonesia: +62 / 62 / 08 diikuti 7–12 digit (boleh spasi/strip).
  out = out.replace(/(?:\+62|\b62|\b0)8[\d\s-]{7,14}\d\b/g, '[NO_HP]');

  const uniqueNames = Array.from(new Set((names || [])
    .map(n => String(n || '').trim())
    .filter(n => n.length >= 3)))
    .sort((a, b) => b.length - a.length);
  for (const name of uniqueNames) {
    out = out.replace(new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi'), '[NAMA]');
    // Nama depan saja (≥ 4 huruf) juga sering ditulis di uraian.
    const first = name.split(/\s+/)[0];
    if (first && first.length >= 4 && first.toLowerCase() !== name.toLowerCase()) {
      out = out.replace(new RegExp(`\\b${escapeRegex(first)}\\b`, 'gi'), '[NAMA]');
    }
  }

  // Sapaan tanpa peka huruf besar; kata ke-1 bebas, kata ke-2 hanya bila berhuruf kapital (nama belakang).
  const honor = HONORIFICS.map(h => `[${h[0].toUpperCase()}${h[0]}]${h.slice(1)}`).join('|');
  out = out.replace(new RegExp(`\\b(${honor})\\.?\\s+([A-Za-z][a-zA-Z'-]{1,30})(\\s+[A-Z][a-zA-Z'-]{1,30})?`, 'g'), (m, h, w1, w2) => {
    if (NOT_NAMES.has(w1.toLowerCase()) || w1.startsWith('[')) return m;
    return `${h} [NAMA]`;
  });
  out = out.replace(/\[NAMA\](\s+\[NAMA\])+/g, '[NAMA]');
  return out;
}

module.exports = { redactText };
