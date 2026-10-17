BEGIN;

ALTER TABLE periodic_service_packages
  ADD COLUMN IF NOT EXISTS estimated_duration_hours NUMERIC(12,3);

ALTER TABLE periodic_service_packages
  DROP CONSTRAINT IF EXISTS periodic_service_packages_estimated_duration_hours_check;

ALTER TABLE periodic_service_packages
  ADD CONSTRAINT periodic_service_packages_estimated_duration_hours_check
  CHECK (estimated_duration_hours IS NULL OR estimated_duration_hours > 0);

COMMENT ON COLUMN periodic_service_packages.estimated_duration_hours IS
  'Estimasi durasi pekerjaan service dalam jam. Digunakan hanya untuk Forecast PA; realisasi tetap memakai actual_start sampai actual_finish.';

COMMIT;
