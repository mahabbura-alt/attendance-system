'use strict';

/* P0 Productivity Report Ranking — inti formula MURNI (tanpa DB).
   Seluruh angka antara memakai presisi penuh; pembulatan hanya di display.
   Keputusan terkunci §12 RENCANA_PRODUCTIVITY_REPORT_RANKING.md:
   Gross utama (Net sekunder), HM di semua board + submitted saja, HM-share,
   ambigu di-exclude, OB/Coal tak campur, DW non-produksi per segmen. */

const FORMULA_VERSION = 'productivity-ranking-gross-v1';
const OPERATOR_SHARE_VERSION = 'operator-volume-hm-share-v1';
const DW_JOB = 'DW';
const EPS = 1e-9;
const MAX_RANGE_DAYS = 366;

const REASONS = Object.freeze({
  MISSING_HM: 'MISSING_HM',
  MISSING_PLAN: 'MISSING_PLAN',
  MISSING_TRUCK_FACTOR: 'MISSING_TRUCK_FACTOR',
  AMBIGUOUS_MATERIAL: 'HM_AMBIGUOUS_MATERIAL',
  EXCLUDED_DW: 'NON_PRODUCTION_JOB_DW',
  RITASE_WITHOUT_HM: 'RITASE_WITHOUT_HM',
  HM_WITHOUT_RITASE: 'HM_WITHOUT_RITASE',
});

const err = (message, status = 400) => Object.assign(new Error(message), { status });

function normalizeJob(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/* Cerminan resolvePlanningJob (production.controller) agar kanon JOB konsisten:
   cocokkan job_code, lalu job_desc; label legacy "OB Removal" → "OB". */
function canonJobUpper(raw, masterJobs = []) {
  const key = normalizeJob(raw);
  if (!key) return '';
  const hit = (masterJobs || []).find(job => normalizeJob(job.job_code) === key
    || normalizeJob(job.job_desc) === key
    || (String(job.job_code).toUpperCase() === 'OB' && key === 'ob removal'));
  if (hit) return String(hit.job_code).trim().toUpperCase();
  return String(raw).trim().toUpperCase();
}

function isDwJob(canonUpper) {
  return String(canonUpper || '').trim().toUpperCase() === DW_JOB;
}

function unitForType(planningType) {
  return String(planningType || '').toLowerCase() === 'coal' ? 'Ton/Hr' : 'BCM/Hr';
}

/* Gross/Net dari satu baris ritase. Factor null/<=0 → missing (TIDAK jadi nol). */
function grossNet(ritaseCount, nonprodCount, factorValue) {
  const gross = Math.max(0, Number(ritaseCount) || 0);
  const nonprod = Math.max(0, Math.min(Number(nonprodCount) || 0, gross));
  const factor = Number(factorValue);
  if (!Number.isFinite(factor) || factor <= 0) {
    return { grossRit: gross, netRit: gross - nonprod, grossVol: 0, netVol: 0, missingFactor: true };
  }
  return {
    grossRit: gross, netRit: gross - nonprod,
    grossVol: gross * factor, netVol: (gross - nonprod) * factor, missingFactor: false,
  };
}

/* Achievement kumulatif: total actual ÷ total expected (TIDAK rata-rata %). */
function achievementOf({ grossVol = 0, netVol = 0, hm = 0, planHm = [] } = {}) {
  const H = Number(hm) || 0;
  let expected = 0;
  for (const p of planHm || []) {
    const plan = Number(p.plan);
    const h = Number(p.hm) || 0;
    if (Number.isFinite(plan) && plan > 0 && h > 0) expected += plan * h;
  }
  const actual = H > EPS ? Number(grossVol) / H : null;
  const netActual = H > EPS ? Number(netVol) / H : null;
  const weightedPlan = H > EPS ? expected / H : null;
  const achievement = expected > EPS ? (Number(grossVol) / expected) * 100 : null;
  const netAchievement = expected > EPS ? (Number(netVol) / expected) * 100 : null;
  const complete = H > EPS && expected > EPS;
  return { expected, weightedPlan, actual, netActual, achievement, netAchievement, complete };
}

/* HM-share v1: volume dibagi proporsional terhadap HM anggota konteks. */
function allocateHmShare(totalVolume, members = []) {
  const list = (members || []).map(m => ({ ...m, hm: Math.max(0, Number(m.hm) || 0) }));
  const totalHm = list.reduce((s, m) => s + m.hm, 0);
  return list.map(m => ({
    ...m,
    share: totalHm > EPS ? m.hm / totalHm : 0,
    volume: totalHm > EPS ? Number(totalVolume) * (m.hm / totalHm) : 0,
  }));
}

function rankTop(rows = [], limit = 10) {
  const siap = (rows || []).filter(r => r && r.complete && Number.isFinite(Number(r.achievement_percentage)));
  siap.sort((a, b) => Number(b.achievement_percentage) - Number(a.achievement_percentage));
  return siap.slice(0, Math.max(1, Number(limit) || 10)).map((r, i) => ({ ...r, rank: i + 1 }));
}

function rankLow(rows = [], limit = 10) {
  const siap = (rows || []).filter(r => r && r.complete && Number.isFinite(Number(r.achievement_percentage)));
  siap.sort((a, b) => Number(a.achievement_percentage) - Number(b.achievement_percentage));
  return siap.slice(0, Math.max(1, Number(limit) || 10)).map((r, i) => ({ ...r, rank: i + 1 }));
}

function toneFor(achievement) {
  if (achievement == null) return 'grey';
  const a = Number(achievement);
  if (!Number.isFinite(a)) return 'grey';
  if (a >= 100) return 'green';
  if (a >= 80) return 'yellow';
  return 'red';
}

/* Status kontrol satu sel (entity-day): ready hanya bila lengkap & bukan DW/ambigu. */
function deriveControlStatus({ isDw = false, ambiguous = false, missingPlan = false, missingHm = false, missingFactor = false } = {}) {
  const reasons = [];
  if (isDw) return { status: 'excluded', reasons: [REASONS.EXCLUDED_DW] };
  if (ambiguous) reasons.push(REASONS.AMBIGUOUS_MATERIAL);
  if (missingPlan) reasons.push(REASONS.MISSING_PLAN);
  if (missingHm) reasons.push(REASONS.MISSING_HM);
  if (missingFactor) reasons.push(REASONS.MISSING_TRUCK_FACTOR);
  if (reasons.includes(REASONS.AMBIGUOUS_MATERIAL)) return { status: 'ambiguous', reasons };
  if (!reasons.length) return { status: 'ready', reasons };
  return { status: 'incomplete', reasons };
}

function readinessSummary({ ready = 0, incomplete = 0, ambiguous = 0, excluded = 0 } = {}) {
  const total = ready + incomplete + ambiguous + excluded;
  const denom = ready + incomplete + ambiguous;
  return {
    ready, incomplete, ambiguous, excluded, total,
    readiness_percentage: denom > 0 ? (ready / denom) * 100 : null,
  };
}

/* Versi planning efektif untuk satu tanggal: effective_from terbaru yang <= tanggal. */
function resolveEffectiveVersion(versions = [], tanggal) {
  const t = String(tanggal || '').slice(0, 10);
  let best = null;
  for (const v of versions || []) {
    const eff = String(v.effective_from || '').slice(0, 10);
    if (!eff || eff > t) continue;
    if (!best || eff > String(best.effective_from).slice(0, 10)
      || (eff === String(best.effective_from).slice(0, 10) && Number(v.revision) > Number(best.revision))) {
      best = v;
    }
  }
  return best;
}

function validateRange(dari, sampai, maxDays = MAX_RANGE_DAYS) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(String(dari || '')) || !iso.test(String(sampai || ''))) {
    throw err('tanggal_dari dan tanggal_sampai wajib (YYYY-MM-DD).');
  }
  if (String(dari) > String(sampai)) throw err('tanggal_dari tidak boleh setelah tanggal_sampai.', 422);
  const days = Math.round((new Date(`${sampai}T00:00:00Z`) - new Date(`${dari}T00:00:00Z`)) / 86400000) + 1;
  if (days > maxDays) throw err(`Range maksimum ${maxDays} hari.`, 422);
  return { dari: String(dari), sampai: String(sampai), days };
}

function defaultRange() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const sampai = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { dari: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, sampai };
}

module.exports = {
  FORMULA_VERSION, OPERATOR_SHARE_VERSION, DW_JOB, EPS, MAX_RANGE_DAYS, REASONS,
  normalizeJob, canonJobUpper, isDwJob, unitForType,
  grossNet, achievementOf, allocateHmShare, rankTop, rankLow, toneFor,
  deriveControlStatus, readinessSummary, resolveEffectiveVersion,
  validateRange, defaultRange,
};
