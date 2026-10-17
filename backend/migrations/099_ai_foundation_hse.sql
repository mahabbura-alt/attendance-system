-- 099_ai_foundation_hse.sql
-- Fondasi agen LLM OMOS + trial HSE (deteksi hazard ganda, asisten triase).
-- Aditif & idempoten. Pasangan rollback: 099_ai_foundation_hse_down.sql.
-- Rencana: docs/RENCANA_IMPLEMENTASI_AGEN_LLM_HSE.md §4.
-- Catatan: API key TIDAK disimpan di database (hanya di file rahasia server).

BEGIN;

-- 1. Pengaturan AI per tenant/project. Default MATI.
CREATE TABLE IF NOT EXISTS ai_settings (
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  features JSONB NOT NULL DEFAULT '{"hse_duplicate":"OFF","hse_triage":"OFF"}'::jsonb,
  monthly_budget_usd NUMERIC(10,2) NOT NULL DEFAULT 20,
  daily_call_limit INTEGER NOT NULL DEFAULT 300 CHECK (daily_call_limit BETWEEN 0 AND 100000),
  duplicate_window_days INTEGER NOT NULL DEFAULT 30 CHECK (duplicate_window_days BETWEEN 1 AND 365),
  duplicate_min_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.75 CHECK (duplicate_min_confidence BETWEEN 0 AND 1),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_key, project_key)
);

-- 2. Audit setiap panggilan model. Tanpa isi prompt/jawaban; hanya hash.
CREATE TABLE IF NOT EXISTS ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  provider TEXT,
  provider_model TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_type TEXT,
  source_id TEXT,
  mode TEXT NOT NULL DEFAULT 'ON' CHECK (mode IN ('ON','SHADOW','EVAL')),
  status TEXT NOT NULL CHECK (status IN ('OK','INVALID_OUTPUT','TIMEOUT','PROVIDER_ERROR','RATE_LIMITED','BUDGET_BLOCKED','DISABLED','NOT_CONFIGURED')),
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  error_code TEXT,
  payload_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_scope_time ON ai_requests(tenant_key, project_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_agent ON ai_requests(agent_id, created_at DESC);

-- 3. Antrean pekerjaan AI (asinkron, idempoten lewat dedupe_key).
CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED','SKIPPED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  result_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_queue ON ai_jobs(status, run_after) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX IF NOT EXISTS idx_ai_jobs_source ON ai_jobs(source_type, source_id, created_at DESC);

-- 4. Saran AI untuk HSE. Satu baris per pasangan (DUPLICATE) atau per permintaan (TRIAGE).
CREATE TABLE IF NOT EXISTS hse_ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL CHECK (kind IN ('DUPLICATE','TRIAGE')),
  hazard_id UUID REFERENCES hazard_reports(id) ON DELETE CASCADE,
  candidate_hazard_id UUID REFERENCES hazard_reports(id) ON DELETE CASCADE,
  verdict TEXT CHECK (verdict IN ('SAMA','TERKAIT','BERBEDA')),
  confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB,
  engine TEXT NOT NULL DEFAULT 'LLM' CHECK (engine IN ('LLM','RULE')),
  mode TEXT NOT NULL DEFAULT 'ON' CHECK (mode IN ('ON','SHADOW')),
  agent_version TEXT,
  ai_request_id UUID REFERENCES ai_requests(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','SUPERSEDED','EXPIRED')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_hse_ai_dup_pair CHECK (kind <> 'DUPLICATE' OR (hazard_id IS NOT NULL AND candidate_hazard_id IS NOT NULL AND hazard_id <> candidate_hazard_id))
);
-- Satu saran PENDING per pasangan & mesin.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hse_ai_dup_pending
  ON hse_ai_suggestions(kind, engine, hazard_id, candidate_hazard_id) WHERE status = 'PENDING' AND kind = 'DUPLICATE';
CREATE INDEX IF NOT EXISTS idx_hse_ai_sugg_hazard ON hse_ai_suggestions(tenant_key, project_key, hazard_id, status);
CREATE INDEX IF NOT EXISTS idx_hse_ai_sugg_cand ON hse_ai_suggestions(tenant_key, project_key, candidate_hazard_id, status);

-- 5. Uraian rapi hasil triase (uraian asli pelapor tidak pernah ditimpa).
ALTER TABLE hazard_reports ADD COLUMN IF NOT EXISTS ai_clean_description TEXT;

-- 6. Audit gabung laporan hazard (siapa, kapan, alasan, dari saran mana).
CREATE TABLE IF NOT EXISTS hse_hazard_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL DEFAULT 'default',
  project_key TEXT NOT NULL DEFAULT 'default',
  target_id UUID NOT NULL REFERENCES hazard_reports(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES hazard_reports(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  suggestion_id UUID REFERENCES hse_ai_suggestions(id) ON DELETE SET NULL,
  engine TEXT CHECK (engine IN ('LLM','RULE','MANUAL')),
  merged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hse_merge_log_target ON hse_hazard_merge_log(tenant_key, project_key, target_id);

COMMIT;
