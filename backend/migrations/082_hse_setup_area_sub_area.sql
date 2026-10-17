BEGIN;

-- -------------------------------------------------------------
-- OMOS HSE: Setup Hierarki Area & Sub Area
-- -------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_hse_locations_parent_id 
  ON hse_locations(parent_id) 
  WHERE deleted_at IS NULL;

-- 1. Pastikan Area Induk (Parent Area) Utama
INSERT INTO hse_locations (id, tenant_key, project_key, code, name, type, parent_id, is_active)
VALUES 
  ('a1111111-1111-4111-8111-111111111111', 'default', 'default', 'PIT', 'PIT', 'PIT', NULL, TRUE),
  ('a2222222-2222-4222-8222-222222222222', 'default', 'default', 'HAUL-ROAD', 'Jalan Hauling', 'HAUL_ROAD', NULL, TRUE),
  ('a3333333-3333-4333-8333-333333333333', 'default', 'default', 'WORKSHOP', 'Workshop', 'WORKSHOP', NULL, TRUE),
  ('a4444444-4444-4444-8444-444444444444', 'default', 'default', 'DISPOSAL', 'Disposal', 'DISPOSAL', NULL, TRUE)
ON CONFLICT (tenant_key, project_key, code) DO UPDATE 
SET name = EXCLUDED.name, type = EXCLUDED.type, is_active = TRUE, deleted_at = NULL;

-- 2. Sub Area untuk PIT (Blok 1, Blok 2, Pit Timur)
INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id, is_active)
VALUES
  ('default', 'default', 'PIT-BLK-1', 'Blok 1', 'PIT', 'a1111111-1111-4111-8111-111111111111', TRUE),
  ('default', 'default', 'PIT-BLK-2', 'Blok 2', 'PIT', 'a1111111-1111-4111-8111-111111111111', TRUE),
  ('default', 'default', 'PIT-EAST', 'Pit Timur', 'PIT', 'a1111111-1111-4111-8111-111111111111', TRUE)
ON CONFLICT (tenant_key, project_key, code) DO UPDATE
SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, is_active = TRUE, deleted_at = NULL;

-- 3. Sub Area untuk Jalan Hauling (KM 1, KM 2)
INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id, is_active)
VALUES
  ('default', 'default', 'HAUL-KM-1', 'KM 1', 'HAUL_ROAD', 'a2222222-2222-4222-8222-222222222222', TRUE),
  ('default', 'default', 'HAUL-KM-2', 'KM 2', 'HAUL_ROAD', 'a2222222-2222-4222-8222-222222222222', TRUE)
ON CONFLICT (tenant_key, project_key, code) DO UPDATE
SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, is_active = TRUE, deleted_at = NULL;

-- 4. Sub Area untuk Workshop
INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id, is_active)
VALUES
  ('default', 'default', 'WS-BAY-1', 'Bay 1 Alat Berat', 'WORKSHOP', 'a3333333-3333-4333-8333-333333333333', TRUE),
  ('default', 'default', 'WS-TYRE', 'Tyre Shop', 'WORKSHOP', 'a3333333-3333-4333-8333-333333333333', TRUE)
ON CONFLICT (tenant_key, project_key, code) DO UPDATE
SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, is_active = TRUE, deleted_at = NULL;

-- 5. Sub Area untuk Disposal
INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id, is_active)
VALUES
  ('default', 'default', 'DISP-BARAT', 'Disposal Barat', 'DISPOSAL', 'a4444444-4444-4444-8444-444444444444', TRUE),
  ('default', 'default', 'DISP-TIMUR', 'Disposal Timur', 'DISPOSAL', 'a4444444-4444-4444-8444-444444444444', TRUE)
ON CONFLICT (tenant_key, project_key, code) DO UPDATE
SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, is_active = TRUE, deleted_at = NULL;

COMMIT;
