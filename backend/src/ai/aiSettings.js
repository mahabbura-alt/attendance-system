'use strict';

/** Pengaturan AI per tenant/project (tabel ai_settings, migrasi 099). Default: semua MATI. */

const FEATURES = ['hse_duplicate', 'hse_triage', 'hse_ask'];
const MODES = ['OFF', 'SHADOW', 'ON'];

const DEFAULTS = Object.freeze({
  enabled: false,
  features: { hse_duplicate: 'OFF', hse_triage: 'OFF', hse_ask: 'OFF' },
  monthly_budget_usd: 20,
  daily_call_limit: 300,
  duplicate_window_days: 30,
  duplicate_min_confidence: 0.75,
  updated_at: null,
  updated_by: null,
  migrated: true,
});

function httpError(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) { e.code = code; e.details = { code }; }
  return e;
}

function normalizeRow(row) {
  if (!row) return { ...DEFAULTS, features: { ...DEFAULTS.features } };
  let features = row.features;
  if (typeof features === 'string') {
    try { features = JSON.parse(features); } catch (_) { features = {}; }
  }
  const f = { ...DEFAULTS.features };
  for (const k of FEATURES) if (MODES.includes(features?.[k])) f[k] = features[k];
  return {
    enabled: row.enabled === true,
    features: f,
    monthly_budget_usd: Number(row.monthly_budget_usd ?? DEFAULTS.monthly_budget_usd),
    daily_call_limit: Number(row.daily_call_limit ?? DEFAULTS.daily_call_limit),
    duplicate_window_days: Number(row.duplicate_window_days ?? DEFAULTS.duplicate_window_days),
    duplicate_min_confidence: Number(row.duplicate_min_confidence ?? DEFAULTS.duplicate_min_confidence),
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
    migrated: true,
  };
}

async function getSettings(db, scope) {
  try {
    const { rows } = await db.query(
      'SELECT * FROM ai_settings WHERE tenant_key = $1 AND project_key = $2',
      [scope.tenantKey, scope.projectKey],
    );
    return normalizeRow(rows[0]);
  } catch (err) {
    if (err.code === '42P01') return { ...DEFAULTS, features: { ...DEFAULTS.features }, migrated: false };
    throw err;
  }
}

/** Mode efektif sebuah fitur: OFF bila sakelar tenant mati. */
function featureMode(settings, feature) {
  if (!settings?.enabled) return 'OFF';
  return settings.features?.[feature] || 'OFF';
}

function assertSuperAdmin(user) {
  if (user?.is_super_admin !== true) {
    throw httpError('Hanya Admin Utama yang boleh mengubah pengaturan Asisten AI.', 403, 'AI_SETTINGS_FORBIDDEN');
  }
}

function clampNumber(v, min, max, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(`${label} harus di antara ${min} dan ${max}.`, 422);
  return n;
}

async function updateSettings(db, scope, user, input = {}) {
  assertSuperAdmin(user);
  const current = await getSettings(db, scope);
  if (!current.migrated) throw httpError('Tabel AI belum tersedia. Jalankan migrasi 099.', 503, 'MIGRATION_REQUIRED');
  const next = { ...current, features: { ...current.features } };
  if ('enabled' in input) next.enabled = input.enabled === true;
  if (input.features && typeof input.features === 'object') {
    for (const k of FEATURES) {
      if (k in input.features) {
        const m = String(input.features[k] || '').toUpperCase();
        if (!MODES.includes(m)) throw httpError(`Mode ${k} tidak valid (OFF/SHADOW/ON).`, 422);
        next.features[k] = m;
      }
    }
  }
  if ('monthly_budget_usd' in input) next.monthly_budget_usd = clampNumber(input.monthly_budget_usd, 0, 10000, 'Batas biaya bulanan');
  if ('daily_call_limit' in input) next.daily_call_limit = Math.round(clampNumber(input.daily_call_limit, 0, 100000, 'Batas panggilan harian'));
  if ('duplicate_window_days' in input) next.duplicate_window_days = Math.round(clampNumber(input.duplicate_window_days, 1, 365, 'Jendela hari'));
  if ('duplicate_min_confidence' in input) next.duplicate_min_confidence = clampNumber(input.duplicate_min_confidence, 0.5, 1, 'Ambang keyakinan');

  await db.query(`
    INSERT INTO ai_settings (tenant_key, project_key, enabled, features, monthly_budget_usd, daily_call_limit,
      duplicate_window_days, duplicate_min_confidence, updated_by, updated_at)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_key, project_key) DO UPDATE SET
      enabled = EXCLUDED.enabled, features = EXCLUDED.features,
      monthly_budget_usd = EXCLUDED.monthly_budget_usd, daily_call_limit = EXCLUDED.daily_call_limit,
      duplicate_window_days = EXCLUDED.duplicate_window_days, duplicate_min_confidence = EXCLUDED.duplicate_min_confidence,
      updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
  `, [scope.tenantKey, scope.projectKey, next.enabled, JSON.stringify(next.features), next.monthly_budget_usd,
    next.daily_call_limit, next.duplicate_window_days, next.duplicate_min_confidence, user?.id || null]);
  return getSettings(db, scope);
}

module.exports = { FEATURES, MODES, DEFAULTS, getSettings, updateSettings, featureMode, assertSuperAdmin, httpError };
