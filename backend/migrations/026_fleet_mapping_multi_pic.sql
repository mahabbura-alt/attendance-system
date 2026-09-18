BEGIN;

CREATE TABLE IF NOT EXISTS fleet_mapping_pics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_mapping_id UUID NOT NULL REFERENCES fleet_mappings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_mapping_active_pic
  ON fleet_mapping_pics (fleet_mapping_id, user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fleet_mapping_pics_active_fleet
  ON fleet_mapping_pics (fleet_mapping_id)
  WHERE deleted_at IS NULL;

-- Backward compatibility: preserve the previous single PIC as the first
-- active member of the new multi-PIC relation.
INSERT INTO fleet_mapping_pics (fleet_mapping_id, user_id)
SELECT fm.id, fm.pic_user_id
FROM fleet_mappings fm
WHERE fm.pic_user_id IS NOT NULL
  AND fm.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM fleet_mapping_pics fmp
    WHERE fmp.fleet_mapping_id = fm.id
      AND fmp.user_id = fm.pic_user_id
      AND fmp.deleted_at IS NULL
  );

COMMIT;
