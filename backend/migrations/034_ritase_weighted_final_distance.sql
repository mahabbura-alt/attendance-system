BEGIN;

-- Penyimpangan jarak aktual per fleet, dump truck, dan jam. Ritase yang tidak
-- dialokasikan di tabel ini tetap memakai fleet_mappings.jarak_km.
CREATE TABLE IF NOT EXISTS ritase_distance_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_mapping_id UUID NOT NULL REFERENCES fleet_mappings(id),
  dump_truck_id UUID NOT NULL REFERENCES equipment(id),
  period_hour SMALLINT NOT NULL CHECK (period_hour BETWEEN 0 AND 23),
  ritase_count INTEGER NOT NULL CHECK (ritase_count > 0),
  input_distance NUMERIC(14,3) NOT NULL CHECK (input_distance > 0),
  input_unit VARCHAR(10) NOT NULL CHECK (input_unit IN ('m', 'km')),
  distance_km NUMERIC(14,6) NOT NULL CHECK (distance_km > 0),
  notes TEXT,
  formula_version VARCHAR(40) NOT NULL DEFAULT 'weighted-final-distance-v1',
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ritase_distance_allocation_active
  ON ritase_distance_allocations (fleet_mapping_id, dump_truck_id, period_hour, distance_km)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ritase_distance_allocation_fleet
  ON ritase_distance_allocations (fleet_mapping_id, period_hour, dump_truck_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE ritase_distance_allocations IS
  'Alokasi ritase pada jarak aktual yang berbeda dari jarak setup fleet; histori perubahan dipertahankan melalui soft delete.';
COMMENT ON COLUMN ritase_distance_allocations.distance_km IS
  'Jarak kanonis dalam kilometer. Nilai input asli dipertahankan pada input_distance dan input_unit.';
COMMENT ON COLUMN ritase_distance_allocations.formula_version IS
  'Versi formula jarak final: sum(volume x distance) / sum(volume), volume = ritase x truck factor efektif.';

COMMIT;
