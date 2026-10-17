'use strict';

/**
 * Agen LLM modul HSE (trial): AI-1 deteksi hazard ganda, AI-2 asisten triase.
 * Rencana: docs/RENCANA_IMPLEMENTASI_AGEN_LLM_HSE.md.
 *
 * Prinsip:
 *  - AI hanya menyarankan; gabung/tolak/terapkan tetap diklik manusia.
 *  - Skor & level risiko selalu dari hse.calculateRisk().
 *  - Data pribadi disensor; ID laporan diganti ref K1..K10 per panggilan.
 *  - Bila AI mati/gagal/kuota habis → mesin kata kunci lama tetap dipakai.
 */

const crypto = require('crypto');
const hse = require('./hse');
const { getSettings, featureMode, httpError } = require('../ai/aiSettings');
const { runAgent } = require('../ai/agentRunner');
const { getAgent, listAgents } = require('../ai/agentRegistry');
const { redactText } = require('../ai/redact');
const { enqueue } = require('../ai/aiJobs');
const { usageSummary } = require('../ai/aiAudit');
const { publicStatus } = require('../ai/config');
const { MERGE_PERMISSION, canMergeHazard, assertCanMergeHazard } = require('./hsePermissions');

const DUP_AGENT_ID = 'hse.hazardDuplicate';
const TRIAGE_AGENT_ID = 'hse.hazardTriage';
const MAX_CANDIDATES = 10;
const CLOSED_STATUSES = ['CLOSED', 'REJECTED', 'DUPLICATE'];
const AI_LABEL = 'Saran AI — perlu dicek';

/* ------------------------------------------------------------------ util */

function isMissingTable(err) {
  return err && err.code === '42P01';
}

function assertAdmin(user) {
  if (user?.is_super_admin !== true && user?.role !== 'admin') {
    throw httpError('Fitur ini hanya untuk admin.', 403, 'ADMIN_ONLY');
  }
}

function isOpen(h) {
  return h && !h.merged_into_id && !CLOSED_STATUSES.includes(String(h.status || '').toUpperCase());
}

function dateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function contentHash(h) {
  return crypto.createHash('sha256')
    .update([h.description || '', h.potential_consequence || '', h.location_id || '', h.status || ''].join('\u0001'))
    .digest('hex').slice(0, 16);
}

function confidenceLabel(c) {
  const n = Number(c);
  if (n >= 0.85) return 'Tinggi';
  if (n >= 0.6) return 'Sedang';
  return 'Rendah';
}

const HAZARD_SELECT = `
  SELECT h.id, h.report_no, h.report_date, h.report_time, h.location_id,
    COALESCE(l.parent_id, l.id) AS area_id,
    COALESCE(p.name, l.name, h.location_name) AS area_name,
    CASE WHEN l.parent_id IS NOT NULL THEN l.id ELSE NULL END AS sub_area_id,
    CASE WHEN l.parent_id IS NOT NULL THEN l.name ELSE NULL END AS sub_area_name,
    CASE WHEN p.name IS NOT NULL THEN p.name || ' ▸ ' || l.name ELSE COALESCE(l.name, h.location_name) END AS location_name,
    h.category_id, COALESCE(c.label, h.category_name) AS category_name, c.code AS category_code,
    h.description, h.potential_consequence, h.status, h.risk_level, h.risk_score, h.merged_into_id,
    COALESCE(rep.nama, h.reported_by_name) AS reported_by_name,
    COALESCE(u.nama, h.assigned_to_name) AS assigned_to_name
  FROM hazard_reports h
  LEFT JOIN hse_locations l ON l.id = h.location_id
  LEFT JOIN hse_locations p ON p.id = l.parent_id
  LEFT JOIN hse_categories c ON c.id = h.category_id
  LEFT JOIN users rep ON rep.id = h.reported_by
  LEFT JOIN users u ON u.id = h.assigned_to
`;

async function loadHazard(db, scope, id) {
  const { rows } = await db.query(`${HAZARD_SELECT}
    WHERE h.id = $1 AND h.tenant_key = $2 AND h.project_key = $3 AND h.deleted_at IS NULL`,
  [id, scope.tenantKey, scope.projectKey]);
  return rows[0] || null;
}

/* --------------------------------------------- AI-1: penyaring kandidat */

/** Skor kemiripan kata (mesin lama) tanpa syarat lokasi — dipakai hanya untuk MENGURUTKAN kandidat. */
function ruleRankScore(a, b) {
  const ca = hse.buildHazardSemanticCode(a.description, a.potential_consequence);
  const cb = hse.buildHazardSemanticCode(b.description, b.potential_consequence);
  const tb = new Set(cb.rootTokens);
  const kb = new Set(cb.concepts);
  const tokens = ca.rootTokens.filter(t => tb.has(t)).length;
  const concepts = ca.concepts.filter(c => kb.has(c)).length;
  const denom = Math.max(1, Math.min(ca.rootTokens.length, cb.rootTokens.length));
  return concepts * 0.5 + tokens / denom;
}

/**
 * Tahap 1 (tanpa AI): laporan terbuka, belum digabung, di lokasi yang sama ATAU satu Area induk,
 * dalam jendela hari, tidak pernah ditolak sebagai pasangan. Maks 10, diurutkan skor mesin lama.
 */
async function findDuplicateCandidates(db, scope, hazard, settings) {
  if (!isOpen(hazard)) return [];
  const windowDays = Number(settings?.duplicate_window_days) || 30;
  const params = [scope.tenantKey, scope.projectKey, hazard.id, dateOnly(hazard.report_date), String(windowDays)];
  let locCond;
  if (hazard.location_id) {
    params.push(hazard.location_id, hazard.area_id || hazard.location_id);
    locCond = `(h.location_id = $6 OR COALESCE(l.parent_id, l.id) = $7)`;
  } else if (hazard.location_name) {
    params.push(String(hazard.location_name).trim().toLowerCase());
    locCond = `LOWER(TRIM(COALESCE(h.location_name, ''))) = $6`;
  } else {
    return [];
  }
  const { rows } = await db.query(`${HAZARD_SELECT}
    WHERE h.tenant_key = $1 AND h.project_key = $2 AND h.id <> $3 AND h.deleted_at IS NULL
      AND h.merged_into_id IS NULL AND h.status NOT IN ('CLOSED','REJECTED','DUPLICATE')
      AND h.report_date BETWEEN ($4::date - ($5 || ' days')::interval)::date AND ($4::date + ($5 || ' days')::interval)::date
      AND ${locCond}
      AND NOT EXISTS (
        SELECT 1 FROM hse_ai_suggestions s
        WHERE s.kind = 'DUPLICATE' AND s.status = 'REJECTED'
          AND ((s.hazard_id = $3 AND s.candidate_hazard_id = h.id) OR (s.hazard_id = h.id AND s.candidate_hazard_id = $3))
      )
    ORDER BY h.report_date DESC, h.created_at DESC
    LIMIT 200`, params);
  return rows
    .map(r => ({ ...r, _rank: ruleRankScore(hazard, r) }))
    .sort((a, b) => b._rank - a._rank || String(b.report_date).localeCompare(String(a.report_date)))
    .slice(0, MAX_CANDIDATES);
}

function hazardForPrompt(h, ref, names) {
  return {
    ref,
    uraian: redactText(h.description, { names }),
    konsekuensi: h.potential_consequence ? redactText(h.potential_consequence, { names }) : null,
    area: h.area_name || h.location_name || null,
    sub_area: h.sub_area_name || null,
    kategori: h.category_name || null,
    tanggal: dateOnly(h.report_date),
    status: h.status,
    level_risiko: h.risk_level || null,
  };
}

function buildDuplicatePayload(hazard, candidates) {
  const names = [hazard, ...candidates].flatMap(h => [h.reported_by_name, h.assigned_to_name]).filter(Boolean);
  const refMap = new Map();
  const kandidat = candidates.map((c, i) => {
    const ref = `K${i + 1}`;
    refMap.set(ref, c);
    return hazardForPrompt(c, ref, names);
  });
  return { input: { laporan: hazardForPrompt(hazard, 'L', names), kandidat }, refMap };
}

/* ------------------------------------------------- AI-1: job & simpan */

async function storeDuplicateResults(db, scope, hazard, refMap, results, meta) {
  const candidateIds = Array.from(refMap.values()).map(c => c.id);
  // Saran lama untuk laporan ini (dua arah) digantikan hasil terbaru.
  await db.query(`
    UPDATE hse_ai_suggestions SET status = 'SUPERSEDED'
    WHERE tenant_key = $1 AND project_key = $2 AND kind = 'DUPLICATE' AND engine = 'LLM' AND status = 'PENDING'
      AND (hazard_id = $3 OR (candidate_hazard_id = $3 AND hazard_id = ANY($4::uuid[])))
  `, [scope.tenantKey, scope.projectKey, hazard.id, candidateIds]);
  let stored = 0;
  for (const r of results) {
    const cand = refMap.get(r.ref);
    if (!cand) continue;
    await db.query(`
      INSERT INTO hse_ai_suggestions (tenant_key, project_key, kind, hazard_id, candidate_hazard_id, verdict, confidence,
        reason, evidence, engine, mode, agent_version, ai_request_id, status)
      VALUES ($1,$2,'DUPLICATE',$3,$4,$5,$6,$7,$8::jsonb,'LLM',$9,$10,$11,'PENDING')
    `, [scope.tenantKey, scope.projectKey, hazard.id, cand.id, r.verdict, r.confidence, r.reason,
      JSON.stringify(r.evidence || []), meta.mode, meta.agentVersion, meta.requestId || null]);
    stored += 1;
  }
  return stored;
}

/** Jalankan pemeriksaan duplikat untuk satu laporan (dipanggil worker atau evaluasi). */
async function runDuplicateCheck(db, scope, hazardId, { client, force = false } = {}) {
  const settings = await getSettings(db, scope);
  const mode = featureMode(settings, 'hse_duplicate');
  if (mode === 'OFF' && !force) return { status: 'SKIPPED', summary: { reason: 'FEATURE_OFF' } };
  const hazard = await loadHazard(db, scope, hazardId);
  if (!hazard) return { status: 'SKIPPED', summary: { reason: 'NOT_FOUND' } };
  if (!isOpen(hazard)) return { status: 'SKIPPED', summary: { reason: 'NOT_OPEN' } };

  const candidates = await findDuplicateCandidates(db, scope, hazard, settings);
  if (candidates.length === 0) {
    // Tidak ada kandidat → tidak ada panggilan AI; saran lama untuk laporan ini kedaluwarsa.
    await db.query(`UPDATE hse_ai_suggestions SET status = 'SUPERSEDED'
      WHERE tenant_key = $1 AND project_key = $2 AND kind = 'DUPLICATE' AND engine = 'LLM' AND status = 'PENDING' AND hazard_id = $3`,
    [scope.tenantKey, scope.projectKey, hazard.id]);
    return { status: 'DONE', summary: { ok: true, candidates: 0, calls: 0 } };
  }
  const agent = getAgent(DUP_AGENT_ID);
  const { input, refMap } = buildDuplicatePayload(hazard, candidates);
  const run = await runAgent({
    db, scope, agent, input, settings, client,
    mode: mode === 'SHADOW' ? 'SHADOW' : 'ON',
    source: { type: 'HAZARD', id: hazard.id },
  });
  if (!run.ok) {
    if (['NOT_CONFIGURED', 'BUDGET_BLOCKED'].includes(run.status)) {
      return { status: 'SKIPPED', summary: { ok: false, reason: run.status, candidates: candidates.length } };
    }
    if (run.status === 'INVALID_OUTPUT') {
      return { status: 'FAILED', error: 'INVALID_OUTPUT', summary: { ok: false, reason: run.status } };
    }
    return { status: 'RETRY', error: run.status, summary: { ok: false, reason: run.status } };
  }
  const stored = await storeDuplicateResults(db, scope, hazard, refMap, run.output, {
    mode: mode === 'SHADOW' ? 'SHADOW' : 'ON', agentVersion: agent.version, requestId: run.requestId,
  });
  const counts = run.output.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {});
  return { status: 'DONE', summary: { ok: true, candidates: candidates.length, stored, verdicts: counts, calls: 1 } };
}

/** Handler worker untuk ai_jobs. */
async function duplicateJobHandler(db, job, opts = {}) {
  const scope = { tenantKey: job.tenant_key, projectKey: job.project_key };
  return runDuplicateCheck(db, scope, job.source_id, opts);
}

/** Dipanggil setelah hazard dibuat/diubah. Tidak pernah menggagalkan penyimpanan laporan. */
async function afterHazardSaved(db, scope, hazard) {
  try {
    if (!hazard?.id) return { queued: false };
    const settings = await getSettings(db, scope);
    if (featureMode(settings, 'hse_duplicate') === 'OFF') return { queued: false, reason: 'FEATURE_OFF' };
    const agent = getAgent(DUP_AGENT_ID);
    return await enqueue(db, scope, {
      agentId: DUP_AGENT_ID,
      sourceType: 'HAZARD',
      sourceId: hazard.id,
      dedupeKey: `${DUP_AGENT_ID}:${agent.version}:${hazard.id}:${contentHash(hazard)}`,
    });
  } catch (err) {
    console.warn(JSON.stringify({ message: 'enqueue cek duplikat AI gagal', code: err.code || null }));
    return { queued: false, reason: 'ERROR' };
  }
}

async function recheckOpenHazards(db, scope, user, { limit = 300 } = {}) {
  if (user?.is_super_admin !== true) throw httpError('Hanya Admin Utama.', 403, 'AI_SETTINGS_FORBIDDEN');
  const settings = await getSettings(db, scope);
  if (featureMode(settings, 'hse_duplicate') === 'OFF') {
    throw httpError('Fitur deteksi duplikat AI masih Mati. Ubah ke Uji diam-diam atau Aktif dulu.', 409, 'AI_FEATURE_OFF');
  }
  const { rows } = await db.query(`
    SELECT id, description, potential_consequence, location_id, status FROM hazard_reports
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL AND merged_into_id IS NULL
      AND status NOT IN ('CLOSED','REJECTED','DUPLICATE')
    ORDER BY report_date DESC LIMIT $3
  `, [scope.tenantKey, scope.projectKey, Math.min(1000, Math.max(1, limit))]);
  const agent = getAgent(DUP_AGENT_ID);
  const stamp = Date.now();
  let queued = 0;
  for (const h of rows) {
    const r = await enqueue(db, scope, {
      agentId: DUP_AGENT_ID, sourceType: 'HAZARD', sourceId: h.id,
      dedupeKey: `${DUP_AGENT_ID}:${agent.version}:${h.id}:${contentHash(h)}:manual:${stamp}`,
    });
    if (r.queued) queued += 1;
  }
  return { queued, open_hazards: rows.length };
}

/* ------------------------------------------- AI-1: tampilan & keputusan */

async function loadDuplicateState(db, scope, ids) {
  const empty = { suggestions: [], rejectedPairs: new Set(), checks: new Map() };
  if (!ids.length) return empty;
  try {
    const sugg = await db.query(`
      SELECT s.id, s.hazard_id, s.candidate_hazard_id, s.verdict, s.confidence, s.reason, s.evidence,
        s.engine, s.mode, s.status, s.agent_version, s.created_at
      FROM hse_ai_suggestions s
      WHERE s.tenant_key = $1 AND s.project_key = $2 AND s.kind = 'DUPLICATE'
        AND (s.hazard_id = ANY($3::uuid[]) OR s.candidate_hazard_id = ANY($3::uuid[]))
        AND s.status IN ('PENDING','REJECTED')
    `, [scope.tenantKey, scope.projectKey, ids]);
    const rejectedPairs = new Set();
    const suggestions = [];
    for (const s of sugg.rows) {
      const key = [String(s.hazard_id), String(s.candidate_hazard_id)].sort().join('::');
      if (s.status === 'REJECTED') rejectedPairs.add(key);
      else if (s.engine === 'LLM') suggestions.push({ ...s, pairKey: key });
    }
    const jobs = await db.query(`
      SELECT DISTINCT ON (source_id) source_id, status, finished_at, result_summary
      FROM ai_jobs WHERE agent_id = $1 AND source_type = 'HAZARD' AND source_id = ANY($2::text[])
        AND tenant_key = $3 AND project_key = $4
      ORDER BY source_id, created_at DESC
    `, [DUP_AGENT_ID, ids.map(String), scope.tenantKey, scope.projectKey]);
    const checks = new Map(jobs.rows.map(j => [String(j.source_id), j]));
    return { suggestions, rejectedPairs, checks };
  } catch (err) {
    if (isMissingTable(err)) return empty;
    throw err;
  }
}

function partnerEntry(partner, s, viewerId, minConfidence) {
  const conf = Number(s.confidence);
  const effectiveVerdict = s.verdict === 'SAMA' && conf < minConfidence ? 'TERKAIT' : s.verdict;
  return {
    id: partner.id,
    report_no: partner.report_no,
    description: partner.description,
    potential_consequence: partner.potential_consequence,
    location_name: partner.location_name,
    area_name: partner.area_name,
    sub_area_name: partner.sub_area_name,
    reported_by_name: partner.reported_by_name || 'Personil Tambang',
    report_date: partner.report_date,
    status: partner.status,
    risk_level: partner.risk_level,
    similarity_pct: Math.round(conf * 100),
    engine: 'LLM',
    verdict: effectiveVerdict,
    raw_verdict: s.verdict,
    confidence: conf,
    confidence_label: confidenceLabel(conf),
    reason: s.reason,
    evidence: Array.isArray(s.evidence) ? s.evidence : [],
    suggestion_id: s.id,
    agent_version: s.agent_version,
    label: AI_LABEL,
    viewer_id: viewerId,
  };
}

/**
 * Lengkapi hazard (daftar/detail) dengan hasil AI.
 *  - Selalu: pasangan yang pernah ditolak ("Bukan duplikat") disembunyikan; entri mesin lama diberi engine RULE.
 *  - Mode ON: hazard yang sudah dicek AI memakai saran AI (SAMA ≥ ambang); TERKAIT → related_hazards.
 *    Hazard yang belum/gagal dicek tetap memakai hasil mesin lama (cadangan).
 */
async function decorateHazards(db, scope, hazards, { partnersById = null } = {}) {
  const list = Array.isArray(hazards) ? hazards : [];
  for (const h of list) {
    h.similar_hazards = (Array.isArray(h.similar_hazards) ? h.similar_hazards : []).map(s => ({ ...s, engine: s.engine || 'RULE' }));
    h.related_hazards = [];
    h.ai_duplicate = { mode: 'OFF', checked: false };
  }
  if (!list.length) return { mode: 'OFF' };
  const settings = await getSettings(db, scope);
  const mode = featureMode(settings, 'hse_duplicate');
  const ids = list.map(h => String(h.id));
  const state = await loadDuplicateState(db, scope, ids);

  for (const h of list) {
    h.similar_hazards = h.similar_hazards.filter(s => !state.rejectedPairs.has([String(h.id), String(s.id)].sort().join('::')));
    const check = state.checks.get(String(h.id));
    h.ai_duplicate = {
      mode,
      checked: Boolean(check && check.status === 'DONE' && check.result_summary?.ok),
      job_status: check?.status || null,
      checked_at: check?.finished_at || null,
    };
  }
  if (mode !== 'ON' || state.suggestions.length === 0) {
    return { mode };
  }

  // Data mitra pasangan yang tidak ada di daftar (mis. detail satu laporan).
  const byId = new Map(list.map(h => [String(h.id), h]));
  if (partnersById) for (const [k, v] of partnersById) byId.set(String(k), v);
  const missing = new Set();
  for (const s of state.suggestions) {
    for (const id of [s.hazard_id, s.candidate_hazard_id]) if (!byId.has(String(id))) missing.add(String(id));
  }
  if (missing.size) {
    const { rows } = await db.query(`${HAZARD_SELECT}
      WHERE h.id = ANY($1::uuid[]) AND h.tenant_key = $2 AND h.project_key = $3 AND h.deleted_at IS NULL`,
    [Array.from(missing), scope.tenantKey, scope.projectKey]);
    for (const r of rows) byId.set(String(r.id), r);
  }

  // Satu saran terbaru per pasangan.
  const latest = new Map();
  for (const s of state.suggestions) {
    const prev = latest.get(s.pairKey);
    if (!prev || new Date(s.created_at) > new Date(prev.created_at)) latest.set(s.pairKey, s);
  }
  const minConf = Number(settings.duplicate_min_confidence) || 0.75;
  const aiByHazard = new Map();
  for (const s of latest.values()) {
    if (s.verdict === 'BERBEDA') continue;
    if (state.rejectedPairs.has(s.pairKey)) continue;
    for (const [selfId, otherId] of [[s.hazard_id, s.candidate_hazard_id], [s.candidate_hazard_id, s.hazard_id]]) {
      const self = byId.get(String(selfId));
      const other = byId.get(String(otherId));
      if (!self || !other || !isOpen(self) || !isOpen(other)) continue;
      if (!aiByHazard.has(String(selfId))) aiByHazard.set(String(selfId), []);
      aiByHazard.get(String(selfId)).push(partnerEntry(other, s, selfId, minConf));
    }
  }
  for (const h of list) {
    const entries = aiByHazard.get(String(h.id)) || [];
    const usesAi = h.ai_duplicate.checked || entries.length > 0;
    if (!usesAi) continue; // cadangan: tetap hasil mesin lama
    const same = entries.filter(e => e.verdict === 'SAMA').sort((a, b) => b.confidence - a.confidence);
    const related = entries.filter(e => e.verdict === 'TERKAIT').sort((a, b) => b.confidence - a.confidence);
    h.similar_hazards = same;
    h.related_hazards = related;
    h.ai_duplicate.source = 'LLM';
  }
  return { mode };
}

async function rejectDuplicate(db, scope, user, input = {}) {
  assertCanMergeHazard(user);
  const note = String(input.note || input.reason || '').trim();
  if (note.length < 3) throw httpError('Alasan "Bukan duplikat" wajib diisi (min. 3 karakter).', 422, 'REASON_REQUIRED');
  let hazardId = input.hazard_id;
  let candidateId = input.candidate_hazard_id;
  if (input.suggestion_id) {
    const { rows } = await db.query(`SELECT * FROM hse_ai_suggestions WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND kind = 'DUPLICATE'`,
      [input.suggestion_id, scope.tenantKey, scope.projectKey]);
    if (!rows[0]) throw httpError('Saran tidak ditemukan.', 404);
    hazardId = rows[0].hazard_id;
    candidateId = rows[0].candidate_hazard_id;
  }
  if (!hazardId || !candidateId || String(hazardId) === String(candidateId)) {
    throw httpError('Pasangan laporan tidak valid.', 422);
  }
  const both = await db.query(`SELECT id FROM hazard_reports WHERE id = ANY($1::uuid[]) AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL`,
    [[hazardId, candidateId], scope.tenantKey, scope.projectKey]);
  if (both.rows.length !== 2) throw httpError('Laporan hazard tidak ditemukan.', 404);

  const upd = await db.query(`
    UPDATE hse_ai_suggestions SET status = 'REJECTED', decided_by = $4, decided_at = CURRENT_TIMESTAMP, decision_note = $5
    WHERE tenant_key = $1 AND project_key = $2 AND kind = 'DUPLICATE' AND status = 'PENDING'
      AND ((hazard_id = $3 AND candidate_hazard_id = $6) OR (hazard_id = $6 AND candidate_hazard_id = $3))
    RETURNING id
  `, [scope.tenantKey, scope.projectKey, hazardId, user?.id || null, note, candidateId]);
  if (upd.rows.length === 0) {
    // Pasangan dari mesin lama (RULE): catat penolakan agar tidak disarankan lagi & bisa diukur.
    await db.query(`
      INSERT INTO hse_ai_suggestions (tenant_key, project_key, kind, hazard_id, candidate_hazard_id, engine, status,
        decided_by, decided_at, decision_note, created_by, reason)
      VALUES ($1,$2,'DUPLICATE',$3,$4,'RULE','REJECTED',$5,CURRENT_TIMESTAMP,$6,$5,'Ditolak dari saran cek kata kunci')
    `, [scope.tenantKey, scope.projectKey, hazardId, candidateId, user?.id || null, note]);
  }
  return { ok: true, rejected: Math.max(1, upd.rows.length) };
}

/* ------------------------------------------------------- AI-2: triase */

const DEFAULT_MATRIX = {
  LIKELIHOOD: [
    [1, 'Hampir tidak mungkin', 'Kurang dari 1x per 5 tahun'], [2, 'Kecil kemungkinan', '1x dalam 1-5 tahun'],
    [3, 'Mungkin', '1x dalam 1 tahun'], [4, 'Sangat mungkin', 'Beberapa kali dalam 1 tahun'], [5, 'Hampir pasti', 'Berulang dalam 1 bulan'],
  ],
  CONSEQUENCE: [
    [1, 'Tidak signifikan', 'P3K ringan, tanpa kerusakan alat / stop operasi'], [2, 'Kecil', 'Perawatan medis ringan, kerusakan unit minor'],
    [3, 'Sedang', 'Cedera hari kerja hilang (LTI ringan), stop shift'], [4, 'Berat', 'Cacat tetap, kerusakan unit berat / stop berhari-hari'],
    [5, 'Bencana / Fatal', 'Kematian, kerusakan lingkungan luas'],
  ],
};

async function loadMatrix(db, scope) {
  let rows = [];
  try {
    const res = await db.query(`
      SELECT kind, value, label, description, tenant_key, project_key FROM hse_risk_matrix_config
      WHERE kind IN ('LIKELIHOOD','CONSEQUENCE')
        AND ((tenant_key = $1 AND project_key = $2) OR (tenant_key = 'default' AND project_key = 'default'))
      ORDER BY kind, value
    `, [scope.tenantKey, scope.projectKey]);
    rows = res.rows;
  } catch (_) { rows = []; }
  const pick = kind => {
    const own = rows.filter(r => r.kind === kind && r.tenant_key === scope.tenantKey && r.project_key === scope.projectKey);
    const src = own.length ? own : rows.filter(r => r.kind === kind);
    if (src.length >= 5) return src.map(r => ({ nilai: Number(r.value), label: r.label, definisi: r.description || '' }));
    return DEFAULT_MATRIX[kind].map(([nilai, label, definisi]) => ({ nilai, label, definisi }));
  };
  return { kemungkinan: pick('LIKELIHOOD'), akibat: pick('CONSEQUENCE') };
}

async function resolveLocationNames(db, locationId) {
  if (!locationId) return { area: null, sub_area: null };
  const { rows } = await db.query(`
    SELECT l.name, l.parent_id, p.name AS parent_name FROM hse_locations l
    LEFT JOIN hse_locations p ON p.id = l.parent_id WHERE l.id = $1`, [locationId]);
  const r = rows[0];
  if (!r) return { area: null, sub_area: null };
  return r.parent_id ? { area: r.parent_name, sub_area: r.name } : { area: r.name, sub_area: null };
}

async function triageHazard(db, scope, user, input = {}, { client } = {}) {
  assertAdmin(user);
  const settings = await getSettings(db, scope);
  if (!settings.migrated) throw httpError('Tabel AI belum tersedia. Jalankan migrasi 099.', 503, 'MIGRATION_REQUIRED');
  const mode = featureMode(settings, 'hse_triage');
  if (mode === 'OFF') throw httpError('Saran AI triase sedang dimatikan (Setup → Asisten AI).', 409, 'AI_FEATURE_OFF');
  if (mode === 'SHADOW' && user?.is_super_admin !== true) {
    throw httpError('Saran AI triase masih tahap uji (hanya Admin Utama).', 409, 'AI_FEATURE_SHADOW');
  }

  let hazard = null;
  if (input.hazard_id) {
    hazard = await loadHazard(db, scope, input.hazard_id);
    if (!hazard) throw httpError('Laporan hazard tidak ditemukan.', 404);
  }
  const description = String(hazard ? hazard.description : input.description || '').trim();
  if (description.length < 10) throw httpError('Isi uraian bahaya minimal 10 karakter sebelum meminta Saran AI.', 422, 'DESCRIPTION_TOO_SHORT');
  const consequence = String(hazard ? hazard.potential_consequence || '' : input.potential_consequence || '').trim();
  const loc = hazard
    ? { area: hazard.area_name || hazard.location_name, sub_area: hazard.sub_area_name }
    : await resolveLocationNames(db, input.location_id);
  const names = hazard ? [hazard.reported_by_name, hazard.assigned_to_name] : [input.reported_by_name, input.assigned_to_name];

  const agent = getAgent(TRIAGE_AGENT_ID);
  const agentInput = {
    laporan: {
      uraian: redactText(description, { names }),
      konsekuensi: consequence ? redactText(consequence, { names }) : null,
      area: loc.area || null,
      sub_area: loc.sub_area || null,
    },
    matriks: await loadMatrix(db, scope),
  };
  const run = await runAgent({
    db, scope, user, agent, input: agentInput, settings, client,
    mode: mode === 'SHADOW' ? 'SHADOW' : 'ON',
    source: { type: 'HAZARD', id: hazard?.id || null },
  });
  if (!run.ok) {
    const status = run.status === 'BUDGET_BLOCKED' ? 429 : 503;
    throw httpError(run.message, status, `AI_${run.status}`);
  }
  const out = run.output;
  const risk = hse.calculateRisk(out.likelihood.value, out.consequence.value);
  let category = null;
  try {
    const { rows } = await db.query(`
      SELECT id, label FROM hse_categories WHERE domain = 'HAZARD' AND code = $1 AND is_active = TRUE
        AND ((tenant_key = $2 AND project_key = $3) OR (tenant_key = 'default' AND project_key = 'default'))
      ORDER BY (tenant_key = $2 AND project_key = $3) DESC LIMIT 1`, [out.category.code, scope.tenantKey, scope.projectKey]);
    category = rows[0] || null;
  } catch (_) { category = null; }

  const payload = { ...out, risk, category_id: category?.id || null, category_label: category?.label || null };
  const ins = await db.query(`
    INSERT INTO hse_ai_suggestions (tenant_key, project_key, kind, hazard_id, payload, engine, mode, agent_version,
      ai_request_id, status, created_by)
    VALUES ($1,$2,'TRIAGE',$3,$4::jsonb,'LLM',$5,$6,$7,'PENDING',$8) RETURNING id, created_at
  `, [scope.tenantKey, scope.projectKey, hazard?.id || null, JSON.stringify(payload), mode === 'SHADOW' ? 'SHADOW' : 'ON',
    agent.version, run.requestId || null, user?.id || null]);
  return {
    suggestion_id: ins.rows[0].id,
    ...payload,
    hazard_id: hazard?.id || null,
    agent_version: `${agent.id}.${agent.version}`,
    model: run.model || null,
    latency_ms: run.latencyMs,
    label: AI_LABEL,
  };
}

async function decideSuggestion(db, scope, user, id, input = {}) {
  assertAdmin(user);
  const decision = String(input.decision || '').toUpperCase();
  if (!['ACCEPTED', 'REJECTED'].includes(decision)) throw httpError('Keputusan harus ACCEPTED atau REJECTED.', 422);
  const applied = Array.isArray(input.applied) ? input.applied.map(String).slice(0, 10) : [];
  const note = [applied.length ? `diterapkan: ${applied.join(', ')}` : null, String(input.note || '').trim() || null]
    .filter(Boolean).join(' · ').slice(0, 500) || null;
  const { rows } = await db.query(`
    UPDATE hse_ai_suggestions SET status = $4, decided_by = $5, decided_at = CURRENT_TIMESTAMP, decision_note = $6
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND kind = 'TRIAGE' AND status = 'PENDING'
    RETURNING id, status
  `, [id, scope.tenantKey, scope.projectKey, decision, user?.id || null, note]);
  if (!rows[0]) throw httpError('Saran tidak ditemukan atau sudah diputuskan.', 404);
  return rows[0];
}

async function saveCleanDescription(db, scope, user, hazardId, input = {}) {
  assertAdmin(user);
  const text = String(input.text || '').trim();
  if (text.length > 2000) throw httpError('Uraian rapi maksimal 2000 karakter.', 422);
  const { rows } = await db.query(`
    UPDATE hazard_reports SET ai_clean_description = $4, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
    RETURNING id, ai_clean_description
  `, [hazardId, scope.tenantKey, scope.projectKey, text || null]);
  if (!rows[0]) throw httpError('Laporan hazard tidak ditemukan.', 404);
  return rows[0];
}

/* ---------------------------------------------- Setup "Asisten AI" */

async function getAiOverview(db, scope, user) {
  assertAdmin(user);
  const settings = await getSettings(db, scope);
  const server = publicStatus();
  let usage = null;
  let jobs = {};
  let decisions = {};
  if (settings.migrated) {
    usage = await usageSummary(db, scope);
    const j = await db.query(`SELECT status, COUNT(*)::int AS n FROM ai_jobs
      WHERE tenant_key = $1 AND project_key = $2 AND created_at >= CURRENT_TIMESTAMP - interval '30 days' GROUP BY status`,
    [scope.tenantKey, scope.projectKey]);
    jobs = Object.fromEntries(j.rows.map(r => [r.status, r.n]));
    const d = await db.query(`SELECT kind, status, COUNT(*)::int AS n FROM hse_ai_suggestions
      WHERE tenant_key = $1 AND project_key = $2 AND created_at >= CURRENT_TIMESTAMP - interval '30 days'
      GROUP BY kind, status`, [scope.tenantKey, scope.projectKey]);
    for (const r of d.rows) decisions[`${r.kind}_${r.status}`] = r.n;
  }
  return {
    settings,
    server,
    usage,
    jobs_30d: jobs,
    suggestions_30d: decisions,
    agents: listAgents(),
    can_edit: user?.is_super_admin === true,
    can_merge: canMergeHazard(user),
  };
}

/**
 * Laporan uji diam-diam: bandingkan putusan AI dengan mesin lama dan keputusan akhir HSE officer.
 */
async function getShadowReport(db, scope, user, { days = 14 } = {}) {
  assertAdmin(user);
  const d = Math.min(90, Math.max(1, Number(days) || 14));
  const { rows } = await db.query(`
    SELECT s.id, s.hazard_id, s.candidate_hazard_id, s.verdict, s.confidence, s.reason, s.status, s.mode, s.created_at
    FROM hse_ai_suggestions s
    WHERE s.tenant_key = $1 AND s.project_key = $2 AND s.kind = 'DUPLICATE' AND s.engine = 'LLM'
      AND s.created_at >= CURRENT_TIMESTAMP - ($3 || ' days')::interval
    ORDER BY s.created_at DESC LIMIT 500
  `, [scope.tenantKey, scope.projectKey, String(d)]);
  const latest = new Map();
  for (const s of rows) {
    const key = [String(s.hazard_id), String(s.candidate_hazard_id)].sort().join('::');
    if (!latest.has(key)) latest.set(key, s);
  }
  const ids = Array.from(new Set(Array.from(latest.values()).flatMap(s => [s.hazard_id, s.candidate_hazard_id]))).map(String);
  const hazards = new Map();
  if (ids.length) {
    const h = await db.query(`${HAZARD_SELECT} WHERE h.id = ANY($1::uuid[]) AND h.tenant_key = $2 AND h.project_key = $3`,
      [ids, scope.tenantKey, scope.projectKey]);
    for (const r of h.rows) hazards.set(String(r.id), r);
  }
  const merges = ids.length ? (await db.query(`SELECT target_id, source_id FROM hse_hazard_merge_log
    WHERE tenant_key = $1 AND project_key = $2 AND (target_id = ANY($3::uuid[]) OR source_id = ANY($3::uuid[]))`,
  [scope.tenantKey, scope.projectKey, ids])).rows : [];
  const mergedPairs = new Set(merges.map(m => [String(m.target_id), String(m.source_id)].sort().join('::')));
  const rejected = ids.length ? (await db.query(`SELECT hazard_id, candidate_hazard_id FROM hse_ai_suggestions
    WHERE tenant_key = $1 AND project_key = $2 AND kind = 'DUPLICATE' AND status = 'REJECTED'
      AND (hazard_id = ANY($3::uuid[]) OR candidate_hazard_id = ANY($3::uuid[]))`, [scope.tenantKey, scope.projectKey, ids])).rows : [];
  const rejectedPairs = new Set(rejected.map(r => [String(r.hazard_id), String(r.candidate_hazard_id)].sort().join('::')));

  const settings = await getSettings(db, scope);
  const minConf = Number(settings.duplicate_min_confidence) || 0.75;
  const items = [];
  const summary = { pairs: 0, agree: 0, ai_only: 0, rule_only: 0, human_merged: 0, human_rejected: 0, ai_same_merged: 0, ai_same_rejected: 0 };
  for (const [key, s] of latest) {
    const a = hazards.get(String(s.hazard_id));
    const b = hazards.get(String(s.candidate_hazard_id));
    if (!a || !b) continue;
    const rule = hse.computeHazardSimilarity({ ...a, status: 'NEW', merged_into_id: null }, { ...b, status: 'NEW', merged_into_id: null });
    const aiSame = s.verdict === 'SAMA' && Number(s.confidence) >= minConf;
    const human = mergedPairs.has(key) ? 'MERGED' : (rejectedPairs.has(key) ? 'REJECTED' : null);
    summary.pairs += 1;
    if (aiSame === rule.isSameHazard) summary.agree += 1;
    else if (aiSame) summary.ai_only += 1;
    else summary.rule_only += 1;
    if (human === 'MERGED') summary.human_merged += 1;
    if (human === 'REJECTED') summary.human_rejected += 1;
    if (aiSame && human === 'MERGED') summary.ai_same_merged += 1;
    if (aiSame && human === 'REJECTED') summary.ai_same_rejected += 1;
    if (aiSame !== rule.isSameHazard || human) {
      items.push({
        hazard: { id: a.id, report_no: a.report_no, description: a.description, location_name: a.location_name },
        candidate: { id: b.id, report_no: b.report_no, description: b.description, location_name: b.location_name },
        ai: { verdict: s.verdict, confidence: Number(s.confidence), reason: s.reason, mode: s.mode },
        rule: { same: rule.isSameHazard, similarity_pct: rule.similarityPct },
        human,
        created_at: s.created_at,
      });
    }
  }
  const decided = summary.ai_same_merged + summary.ai_same_rejected;
  summary.ai_precision_observed = decided ? Math.round((summary.ai_same_merged / decided) * 100) / 100 : null;
  return { days: d, summary, items: items.slice(0, 100) };
}

module.exports = {
  DUP_AGENT_ID,
  TRIAGE_AGENT_ID,
  MERGE_PERMISSION,
  AI_LABEL,
  canMergeHazard,
  assertCanMergeHazard,
  contentHash,
  findDuplicateCandidates,
  buildDuplicatePayload,
  runDuplicateCheck,
  duplicateJobHandler,
  afterHazardSaved,
  recheckOpenHazards,
  decorateHazards,
  rejectDuplicate,
  triageHazard,
  decideSuggestion,
  saveCleanDescription,
  getAiOverview,
  getShadowReport,
  loadMatrix,
};
