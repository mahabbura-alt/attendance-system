'use strict';

/**
 * Tanya OMOS (modul HSE): tanya-jawab informasi data HSE.
 * Rencana: docs/RENCANA_TANYA_OMOS_HSE.md.
 *
 * Alur: gerbang (mode, rate-limit, budget) → perencana LLM memilih tool → eksekutor menjalankan fungsi
 * baca HSE yang sama dengan halaman → penyusun LLM menulis jawaban → penjaga angka → pulihkan nama.
 * Hanya-baca. Tidak ada SQL bebas. Audit tanpa isi (hash) lewat ai_requests.
 */

const crypto = require('crypto');
const { getSettings, featureMode, httpError } = require('../ai/aiSettings');
const { runAgent } = require('../ai/agentRunner');
const { getAgent } = require('../ai/agentRegistry');
const { redactText } = require('../ai/redact');
const { compactValue, createAliaser } = require('../ai/ask/compact');
const { toolCatalog, runTool, pageOf } = require('../ai/ask/tools');
const { checkAnswerNumbers } = require('../ai/ask/askGuard');

const FEATURE = 'hse_ask';
const PLANNER_ID = 'hse.askPlanner';
const ANSWER_ID = 'hse.askAnswer';
const MAX_QUESTION = 500;
const MIN_QUESTION = 3;
const HOURLY_LIMIT = 20;
const DAILY_LIMIT = 100;
const MAX_HISTORY = 3;
const TOOL_CACHE_MS = 60000;
const NAMES_CACHE_MS = 5 * 60000;
const MAX_RESULT_CHARS = 14000;

const toolCache = new Map();
let namesCache = { exp: 0, names: [] };

const TOOL_LABEL = {
  ringkasan_hse: 'Ringkasan HSE',
  hazard: 'Laporan hazard',
  tindakan_capa: 'Tindakan perbaikan (CAPA)',
  insiden: 'Insiden',
  kpi_keselamatan: 'Statistik keselamatan (LTIFR/TRIR)',
  jam_kerja: 'Jam kerja',
  kompetensi: 'Kompetensi',
  izin_kerja_ptw: 'Izin kerja (PTW)',
  inspeksi: 'Inspeksi',
  mandat_hazard: 'Target pelaporan hazard',
  agenda_event: 'Agenda kegiatan HSE',
};

const EXAMPLES = {
  overview: ['Berapa hari tanpa LTI saat ini?', 'Berapa LTIFR dan TRIR terbaru?'],
  hazards: ['Berapa hazard yang masih terbuka?', 'Hazard risiko tinggi bulan ini ada berapa dan di area mana?'],
  actions: ['Berapa tindakan CAPA yang terlambat?', 'CAPA apa yang jatuh tempo minggu ini?'],
  incidents: ['Berapa insiden bulan ini per jenis?', 'Berapa total hari hilang tahun ini?'],
  reports: ['Bagaimana tren LTIFR 6 bulan terakhir?', 'Berapa jam kerja bulan lalu?'],
  workhours: ['Berapa total jam kerja bulan lalu?', 'Kapan periode jam kerja terakhir dikirim?'],
  competency: ['Lisensi apa yang sudah kedaluwarsa?', 'Berapa karyawan yang belum induksi?'],
  ptw: ['Berapa izin kerja yang aktif?', 'Izin kerja apa yang sudah kedaluwarsa?'],
  inspections: ['Berapa capaian inspeksi bulan ini?', 'Template inspeksi apa yang tersedia?'],
  'hazard-targets': ['Siapa yang belum memenuhi target lapor hazard?', 'Berapa capaian target hazard bulan ini?'],
  events: ['Apa agenda P5M minggu ini?', 'Kegiatan HSE apa yang dijadwalkan bulan ini?'],
};
const GENERIC_EXAMPLES = ['Berapa hazard terbuka saat ini?', 'Berapa LTIFR terbaru?', 'Berapa tindakan CAPA yang terlambat?'];

/* ------------------------------------------------------------------ util */

function todayWib(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function isSuperAdmin(user) {
  return user?.is_super_admin === true;
}

function isAdmin(user) {
  return user?.is_super_admin === true || user?.role === 'admin';
}

function resolveMode(settings, user) {
  if (!isAdmin(user)) return { allowed: false, mode: 'OFF', code: 'ASK_ADMIN_ONLY', message: 'Tanya OMOS hanya untuk admin.' };
  const mode = featureMode(settings, FEATURE);
  if (mode === 'OFF') return { allowed: false, mode, code: 'ASK_DISABLED', message: 'Tanya OMOS belum diaktifkan.' };
  if (mode === 'SHADOW' && !isSuperAdmin(user)) {
    return { allowed: false, mode, code: 'ASK_ADMIN_ONLY', message: 'Tanya OMOS sedang dalam uji terbatas (hanya Admin Utama).' };
  }
  return { allowed: true, mode };
}

async function knownNames(db) {
  if (namesCache.exp > Date.now()) return namesCache.names;
  try {
    const { rows } = await db.query(`SELECT nama FROM users WHERE nama IS NOT NULL AND length(trim(nama)) >= 3 LIMIT 3000`);
    namesCache = { exp: Date.now() + NAMES_CACHE_MS, names: rows.map(r => r.nama) };
  } catch (_) {
    namesCache = { exp: Date.now() + 30000, names: [] };
  }
  return namesCache.names;
}

function cleanQuestion(raw) {
  return String(raw || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Angka yang sah dari pertanyaan: tahun & "N bulan/minggu/hari/tahun". */
function questionNumbers(question) {
  const out = [];
  for (const m of question.matchAll(/\b(20\d\d)\b/g)) out.push(Number(m[1]));
  for (const m of question.matchAll(/\b(\d{1,3})\s*(bulan|minggu|hari|tahun)\b/gi)) out.push(Number(m[1]));
  return out;
}

async function recentAskCount(db, scope, user, seconds) {
  try {
    const { rows } = await db.query(`
      SELECT COUNT(*)::int AS n FROM ai_requests
      WHERE tenant_key = $1 AND project_key = $2 AND user_id = $3 AND agent_id = $4
        AND created_at > now() - ($5 || ' seconds')::interval
    `, [scope.tenantKey, scope.projectKey, user.id, PLANNER_ID, String(seconds)]);
    return rows[0]?.n || 0;
  } catch (err) {
    if (err.code === '42P01') return 0;
    throw err;
  }
}

function sizeGuard(results) {
  // Pangkas bila hasil gabungan terlalu besar untuk prompt.
  let text = JSON.stringify(results);
  if (text.length <= MAX_RESULT_CHARS) return results;
  const trimmed = results.map(r => ({ ...r, data: compactValue(r.data, { aliaser: createAliaser() }, { maxItems: 5, maxString: 120, maxDepth: 4 }) }));
  text = JSON.stringify(trimmed);
  return text.length <= MAX_RESULT_CHARS ? trimmed : trimmed.map(r => ({ tool: r.tool, args: r.args, data: '[terlalu besar; persempit pertanyaan]' }));
}

/* ------------------------------------------------------------------ info untuk UI */

async function getAskInfo(db, scope, user) {
  const settings = await getSettings(db, scope);
  const mode = resolveMode(settings, user);
  return {
    available: mode.allowed,
    mode: mode.mode,
    reason: mode.allowed ? null : mode.message,
    limits: { max_question_chars: MAX_QUESTION, per_hour: HOURLY_LIMIT, per_day: DAILY_LIMIT },
    examples: EXAMPLES,
    generic_examples: GENERIC_EXAMPLES,
  };
}

/* ------------------------------------------------------------------ inti */

async function askHse(db, scope, user, input = {}, { client, now = new Date() } = {}) {
  const started = Date.now();
  const settings = await getSettings(db, scope);
  const mode = resolveMode(settings, user);
  if (!mode.allowed) throw httpError(mode.message, 403, mode.code);

  const question = cleanQuestion(input.question);
  if (question.length < MIN_QUESTION) throw httpError('Tulis pertanyaan Anda terlebih dahulu.', 422, 'ASK_EMPTY');
  if (question.length > MAX_QUESTION) throw httpError(`Pertanyaan terlalu panjang (maksimal ${MAX_QUESTION} karakter).`, 422, 'ASK_TOO_LONG');

  if (!isSuperAdmin(user)) {
    if (await recentAskCount(db, scope, user, 3600) >= HOURLY_LIMIT) throw httpError(`Batas ${HOURLY_LIMIT} pertanyaan per jam tercapai. Coba lagi nanti.`, 429, 'ASK_RATE_LIMIT');
    if (await recentAskCount(db, scope, user, 86400) >= DAILY_LIMIT) throw httpError(`Batas ${DAILY_LIMIT} pertanyaan per hari tercapai.`, 429, 'ASK_RATE_LIMIT');
  }

  const names = await knownNames(db);
  const safe = t => redactText(t, { names });
  const today = todayWib(now);
  const ctx = { aliaser: createAliaser() };

  const screen = input.context && typeof input.context === 'object' ? {
    halaman: String(input.context.page || '').slice(0, 30) || null,
    periode: String(input.context.period || '').slice(0, 40) || null,
    filter: String(input.context.filter || '').slice(0, 80) || null,
  } : null;
  const history = (Array.isArray(input.history) ? input.history : []).slice(-MAX_HISTORY)
    .map(h => safe(cleanQuestion(typeof h === 'string' ? h : h?.q)).slice(0, 300)).filter(Boolean);

  const planner = getAgent(PLANNER_ID);
  const planRes = await runAgent({
    db, scope, user, agent: planner, settings, client, source: { type: 'ask' },
    input: { pertanyaan: safe(question), hari_ini: today, konteks_layar: screen, riwayat: history, katalog: toolCatalog() },
  });
  if (!planRes.ok) return { ok: false, status: planRes.status, message: planRes.message, request_id: planRes.requestId };
  const plan = planRes.output;

  if (!plan.tools.length) {
    return { ok: true, kind: 'OUT_OF_SCOPE', message: plan.tidak_bisa_dijawab, request_id: planRes.requestId, latency_ms: Date.now() - started };
  }

  const results = [];
  for (const t of plan.tools) {
    try {
      const r = await runTool(t.nama, t.args, { db, scope, ctx, cache: toolCache, ttlMs: TOOL_CACHE_MS });
      for (const n of r.aliases || []) ctx.aliaser.alias(n);
      results.push({ tool: t.nama, args: r.args, data: r.data, cached: r.cached });
    } catch (err) {
      results.push({ tool: t.nama, args: t.args, error: err.code === 'BAD_ARGS' ? err.message : 'Data tidak dapat dibaca saat ini.' });
      if (err.code !== 'BAD_ARGS') console.warn(JSON.stringify({ message: 'tool Tanya OMOS gagal', tool: t.nama, code: err.code || null }));
    }
  }
  const okResults = results.filter(r => !r.error);
  if (!okResults.length) {
    return { ok: true, kind: 'NO_DATA', message: 'Saya belum bisa mengambil data untuk pertanyaan itu. Coba persempit pertanyaan (misalnya sebut periode atau lokasinya).', details: results.map(r => r.error), request_id: planRes.requestId, latency_ms: Date.now() - started };
  }

  const forPrompt = sizeGuard(okResults.map(r => ({ tool: r.tool, args: r.args, data: r.data })));
  const answerAgent = getAgent(ANSWER_ID);
  const ansRes = await runAgent({
    db, scope, user, agent: answerAgent, settings, client, source: { type: 'ask' },
    input: { pertanyaan: safe(question), hari_ini: today, hasil: forPrompt },
  });

  const sources = okResults.map(r => ({ tool: r.tool, label: TOOL_LABEL[r.tool] || r.tool, filter: r.args, cached: r.cached, page: pageOf(r.tool) }));
  const tables = () => okResults.map(r => ({ label: TOOL_LABEL[r.tool] || r.tool, filter: r.args, data: JSON.parse(ctx.aliaser.restore(JSON.stringify(r.data))) }));

  if (!ansRes.ok) {
    return { ok: false, status: ansRes.status, message: ansRes.message, request_id: ansRes.requestId, sources };
  }

  const out = ansRes.output;
  const guard = checkAnswerNumbers(
    [out.answer, ...out.numbers.map(n => n.value)],
    [forPrompt, today, questionNumbers(question)],
  );
  if (!guard.ok) {
    return {
      ok: true, kind: 'RAW', guard_rejected: guard.unknown,
      message: 'Jawaban AI memuat angka yang tidak ada di data, jadi tidak ditampilkan. Berikut data sumbernya.',
      sources, tables: tables(), request_id: ansRes.requestId, latency_ms: Date.now() - started,
    };
  }

  return {
    ok: true,
    kind: 'ANSWER',
    answer: ctx.aliaser.restore(out.answer),
    numbers: out.numbers.map(n => ({ label: ctx.aliaser.restore(n.label), value: ctx.aliaser.restore(n.value) })),
    page: out.page || sources[0]?.page || null,
    sources,
    scope_note: screen ? `Dijawab untuk: ${[screen.periode, screen.filter].filter(Boolean).join(' · ') || 'data HSE'}` : null,
    request_id: ansRes.requestId,
    latency_ms: Date.now() - started,
    ai_label: 'Jawaban AI — cek sumbernya',
  };
}

/* ------------------------------------------------------------------ umpan balik */

async function saveAskFeedback(db, scope, user, input = {}) {
  const rating = Number(input.rating);
  if (![1, -1].includes(rating)) throw httpError('Penilaian harus 1 (membantu) atau -1 (kurang tepat).', 422);
  const requestId = String(input.request_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw httpError('request_id tidak valid.', 422);
  const reason = String(input.reason || '').trim().slice(0, 300) || null;
  try {
    const owned = await db.query(
      `SELECT id FROM ai_requests WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND user_id = $4 AND agent_id IN ($5, $6)`,
      [requestId, scope.tenantKey, scope.projectKey, user.id, PLANNER_ID, ANSWER_ID],
    );
    if (!owned.rows.length) throw httpError('Permintaan tidak ditemukan.', 404);
    await db.query(`
      INSERT INTO ai_ask_feedback (tenant_key, project_key, request_id, user_id, rating, reason)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (request_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, reason = EXCLUDED.reason, created_at = CURRENT_TIMESTAMP
    `, [scope.tenantKey, scope.projectKey, requestId, user.id, rating, reason]);
  } catch (err) {
    if (err.code === '42P01') throw httpError('Tabel Tanya OMOS belum tersedia. Jalankan migrasi 100.', 503, 'MIGRATION_REQUIRED');
    throw err;
  }
  return { ok: true };
}

function _resetCachesForTests() {
  toolCache.clear();
  namesCache = { exp: 0, names: [] };
}

module.exports = { askHse, getAskInfo, saveAskFeedback, resolveMode, questionNumbers, FEATURE, PLANNER_ID, ANSWER_ID, _resetCachesForTests };
