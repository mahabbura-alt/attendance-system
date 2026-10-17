BEGIN;

-- Kebijakan cuti periodik dapat berlaku untuk seluruh karyawan pada satu
-- jabatan atau menjadi pengecualian satu karyawan. Nilai periode tetap
-- disimpan dalam hari agar kompatibel dengan histori; API baru menerima minggu
-- dan mengonversinya secara deterministik (minggu * 7).
ALTER TABLE leave_policy_versions
  ADD COLUMN IF NOT EXISTS target_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leave_policy_versions'::regclass
      AND conname = 'leave_policy_versions_target_user_id_fkey'
  ) THEN
    ALTER TABLE leave_policy_versions
      ADD CONSTRAINT leave_policy_versions_target_user_id_fkey
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE leave_policy_versions
  DROP CONSTRAINT IF EXISTS leave_policy_versions_tenant_key_project_key_department_pos_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policy_group_version
  ON leave_policy_versions
    (tenant_key, project_key, department, position, leave_type, version_no)
  WHERE target_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policy_employee_version
  ON leave_policy_versions
    (tenant_key, project_key, target_user_id, leave_type, version_no)
  WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leave_policy_target_user
  ON leave_policy_versions(tenant_key, project_key, target_user_id, leave_type, is_active)
  WHERE target_user_id IS NOT NULL;

-- Model lama memakai policy CT terpisah dan CP sering menyimpan annual_days=0.
-- Nilai default historis modul adalah 12 hari; sesudah migrasi saldo CT menjadi
-- atribut independen pada kontrak CP yang sama.
UPDATE leave_policy_versions
SET annual_days = 12
WHERE leave_type = 'CP' AND annual_days = 0;

-- Form baru tidak memiliki tanggal selesai. Hanya versi CP aktif terbaru per
-- scope yang dibuat open-ended; versi historis tetap tertutup dan auditable.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_key, project_key,
      COALESCE(target_user_id::text, 'GROUP:' || department || ':' || position), leave_type
    ORDER BY version_no DESC, created_at DESC
  ) AS rn
  FROM leave_policy_versions
  WHERE leave_type = 'CP' AND is_active = TRUE
)
UPDATE leave_policy_versions p
SET effective_to = NULL
FROM ranked r
WHERE p.id = r.id AND r.rn = 1;

-- Proyeksi adalah data turunan. Kosongkan agar pembacaan pertama membangun
-- ulang memakai T0 kebijakan, bukan basis tanggal masuk model lama.
DELETE FROM employee_leave_projections;

COMMIT;
