ALTER TABLE mining_production_logs
  ADD COLUMN IF NOT EXISTS area_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS job VARCHAR(150);

CREATE INDEX IF NOT EXISTS idx_prod_logs_area_name ON mining_production_logs (area_name);
CREATE INDEX IF NOT EXISTS idx_prod_logs_job ON mining_production_logs (job);
