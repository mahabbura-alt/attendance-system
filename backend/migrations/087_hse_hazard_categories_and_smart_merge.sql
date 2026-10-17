BEGIN;

-- 1. Tambahkan kolom penggabungan (smart merge) & kode semantik pada hazard_reports
ALTER TABLE hazard_reports
  ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES hazard_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS semantic_signature TEXT;

CREATE INDEX IF NOT EXISTS idx_hazard_reports_merged_into
  ON hazard_reports(merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- 2. Pastikan 2 kategori utama Hazard tersedia: Kondisi Tidak Aman & Tindakan Tidak Aman
INSERT INTO hse_categories (tenant_key, project_key, domain, code, label, is_active, sort_order)
VALUES
  ('default', 'default', 'HAZARD', 'UNSAFE_CONDITION', 'Kondisi Tidak Aman', TRUE, 1),
  ('default', 'default', 'HAZARD', 'UNSAFE_ACT', 'Tindakan Tidak Aman', TRUE, 2)
ON CONFLICT (tenant_key, project_key, domain, code) DO UPDATE
SET label = EXCLUDED.label,
    is_active = TRUE,
    sort_order = EXCLUDED.sort_order;

-- 3. Nonaktifkan kategori HAZARD lama selain 2 kategori baru
UPDATE hse_categories
SET is_active = FALSE
WHERE domain = 'HAZARD'
  AND code NOT IN ('UNSAFE_CONDITION', 'UNSAFE_ACT');

-- 4. Migrasikan seluruh data hazard_reports eksisting ke Kondisi Tidak Aman atau Tindakan Tidak Aman
WITH target_cats AS (
  SELECT
    MAX(id::text) FILTER (WHERE code = 'UNSAFE_CONDITION')::uuid AS cond_id,
    MAX(id::text) FILTER (WHERE code = 'UNSAFE_ACT')::uuid AS act_id
  FROM hse_categories
  WHERE tenant_key = 'default' AND project_key = 'default' AND domain = 'HAZARD'
)
UPDATE hazard_reports h
SET
  category_id = CASE
    WHEN h.description ILIKE '%diletakkan tidak%'
      OR h.description ILIKE '%tanpa safety pin%'
      OR h.description ILIKE '%over-capacity%'
      OR h.description ILIKE '%tidak tertutup%'
      OR h.description ILIKE '%tanpa APD%'
      OR h.description ILIKE '%tidak memakai%'
      OR h.description ILIKE '%melanggar%'
      OR h.description ILIKE '%kecepatan%'
    THEN target_cats.act_id
    ELSE target_cats.cond_id
  END,
  category_name = CASE
    WHEN h.description ILIKE '%diletakkan tidak%'
      OR h.description ILIKE '%tanpa safety pin%'
      OR h.description ILIKE '%over-capacity%'
      OR h.description ILIKE '%tidak tertutup%'
      OR h.description ILIKE '%tanpa APD%'
      OR h.description ILIKE '%tidak memakai%'
      OR h.description ILIKE '%melanggar%'
      OR h.description ILIKE '%kecepatan%'
    THEN 'Tindakan Tidak Aman'
    ELSE 'Kondisi Tidak Aman'
  END
FROM target_cats
WHERE h.tenant_key = 'default';

-- 5. Normalisasi hierarki Area Induk & Sub-Area pada hse_locations agar setiap lokasi memiliki Area & Sub-Area yang konsisten
UPDATE hse_locations p_child
SET parent_id = p_parent.id
FROM hse_locations p_parent
WHERE p_child.tenant_key = 'default'
  AND p_parent.tenant_key = 'default'
  AND p_child.code IN ('PIT-1', 'PIT-2')
  AND p_parent.code = 'PIT'
  AND p_child.parent_id IS NULL;

UPDATE hse_locations p_child
SET parent_id = p_parent.id
FROM hse_locations p_parent
WHERE p_child.tenant_key = 'default'
  AND p_parent.tenant_key = 'default'
  AND p_child.code = 'HAUL-KM2'
  AND p_parent.code = 'HAUL-ROAD'
  AND p_child.parent_id IS NULL;

UPDATE hse_locations p_child
SET parent_id = p_parent.id
FROM hse_locations p_parent
WHERE p_child.tenant_key = 'default'
  AND p_parent.tenant_key = 'default'
  AND p_child.code = 'WSHOP-01'
  AND p_parent.code = 'WORKSHOP'
  AND p_child.parent_id IS NULL;

-- Tambahkan Sub-Area spesifik untuk Area TPS Limbah B3 & Gudang Site serta Kantor Utama Site
INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id, is_active)
SELECT 'default', 'default', 'B3-TPS', 'Area TPS Limbah B3', p.type, p.id, TRUE
FROM hse_locations p
WHERE p.tenant_key = 'default' AND p.code = 'GUDANG-B3'
ON CONFLICT (tenant_key, project_key, code) DO UPDATE
SET parent_id = EXCLUDED.parent_id, is_active = TRUE;

INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id, is_active)
SELECT 'default', 'default', 'B3-SOLAR', 'Area Tangki Timbun BBM & Solar', p.type, p.id, TRUE
FROM hse_locations p
WHERE p.tenant_key = 'default' AND p.code = 'GUDANG-B3'
ON CONFLICT (tenant_key, project_key, code) DO UPDATE
SET parent_id = EXCLUDED.parent_id, is_active = TRUE;

INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id, is_active)
SELECT 'default', 'default', 'OFF-RADIO', 'Ruang Radio Dispatch', p.type, p.id, TRUE
FROM hse_locations p
WHERE p.tenant_key = 'default' AND p.code = 'OFFICE-DKC'
ON CONFLICT (tenant_key, project_key, code) DO UPDATE
SET parent_id = EXCLUDED.parent_id, is_active = TRUE;

INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id, is_active)
SELECT 'default', 'default', 'OFF-KORIDOR', 'Koridor & Klinik Kantor', p.type, p.id, TRUE
FROM hse_locations p
WHERE p.tenant_key = 'default' AND p.code = 'OFFICE-DKC'
ON CONFLICT (tenant_key, project_key, code) DO UPDATE
SET parent_id = EXCLUDED.parent_id, is_active = TRUE;

-- Petakan laporan hazard yang sebelumnya masih di level Area Induk ke Sub-Area spesifiknya
UPDATE hazard_reports h
SET location_id = sub.id
FROM hse_locations sub
WHERE h.tenant_key = 'default'
  AND sub.tenant_key = 'default'
  AND sub.code = 'B3-SOLAR'
  AND h.report_no = 'HZD-2610-004';

UPDATE hazard_reports h
SET location_id = sub.id
FROM hse_locations sub
WHERE h.tenant_key = 'default'
  AND sub.tenant_key = 'default'
  AND sub.code = 'B3-TPS'
  AND h.report_no IN ('HZD-2610-011', 'HZD-2610-018');

UPDATE hazard_reports h
SET location_id = sub.id
FROM hse_locations sub
WHERE h.tenant_key = 'default'
  AND sub.tenant_key = 'default'
  AND sub.code = 'OFF-RADIO'
  AND h.report_no = 'HZD-2610-012';

UPDATE hazard_reports h
SET location_id = sub.id
FROM hse_locations sub
WHERE h.tenant_key = 'default'
  AND sub.tenant_key = 'default'
  AND sub.code = 'OFF-KORIDOR'
  AND h.report_no = 'HZD-2610-014';

COMMIT;

