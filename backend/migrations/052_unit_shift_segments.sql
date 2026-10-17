BEGIN;

-- Pergantian operator / perpindahan PIT-Area / JOB pada satu unit-shift.
-- Satu Work Log menjadi SATU segmen penugasan operator; satu sesi unit-shift
-- (scope proyek + tanggal operasional + shift + unit) boleh memuat beberapa
-- segmen selama interval HM tidak saling tumpang tindih.
--
-- Migrasi bersifat additive dan reversible:
--   * tabel sesi baru + kolom metadata nullable pada mining_production_logs;
--   * backfill satu sesi per kombinasi aktif (data historis TIDAK diubah:
--     total_hm, operator, HM awal/akhir, payroll tetap utuh);
--   * proteksi overlap dipasang SETELAH backfill bersih.
-- Rollback aplikasi tetap dapat membaca record karena kolom lama tidak dihapus.

-- 1) Tabel induk sesi unit-shift: identitas kelompok + titik lock transaksi.
CREATE TABLE IF NOT EXISTS production_unit_shift_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name     VARCHAR(100) NOT NULL DEFAULT 'PIM Mining Project',
  operational_date DATE NOT NULL,
  shift_id         UUID NOT NULL REFERENCES shifts(id),
  equipment_id     UUID NOT NULL REFERENCES equipment(id),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_name, operational_date, shift_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS idx_unit_shift_sessions_lookup
  ON production_unit_shift_sessions (operational_date, shift_id, equipment_id);

-- 2) Metadata segmen pada Work Log (nullable agar record lama tetap valid).
ALTER TABLE mining_production_logs
  ADD COLUMN IF NOT EXISTS unit_shift_session_id UUID REFERENCES production_unit_shift_sessions(id),
  ADD COLUMN IF NOT EXISTS segment_sequence SMALLINT,
  ADD COLUMN IF NOT EXISTS handover_reason VARCHAR(100),
  ADD COLUMN IF NOT EXISTS handover_note TEXT,
  ADD COLUMN IF NOT EXISTS source_log_id UUID REFERENCES mining_production_logs(id);
CREATE INDEX IF NOT EXISTS idx_prod_logs_session
  ON mining_production_logs (unit_shift_session_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prod_logs_segment
  ON mining_production_logs (equipment_id, tanggal, shift_id, segment_sequence) WHERE deleted_at IS NULL;

-- 3) Backfill: satu sesi per kombinasi scope + tanggal + shift + unit aktif.
--    Seluruh record lama menjadi segmen pertama (segment_sequence = 1).
INSERT INTO production_unit_shift_sessions (id, project_name, operational_date, shift_id, equipment_id, created_by)
SELECT
  gen_random_uuid(),
  COALESCE(mpl.project_name, 'PIM Mining Project'),
  mpl.tanggal,
  mpl.shift_id,
  mpl.equipment_id,
  mpl.created_by
FROM mining_production_logs mpl
WHERE mpl.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM production_unit_shift_sessions s
    WHERE s.project_name = COALESCE(mpl.project_name, 'PIM Mining Project')
      AND s.operational_date = mpl.tanggal
      AND s.shift_id = mpl.shift_id
      AND s.equipment_id = mpl.equipment_id
  )
ON CONFLICT (project_name, operational_date, shift_id, equipment_id) DO NOTHING;

UPDATE mining_production_logs mpl
SET unit_shift_session_id = s.id,
    segment_sequence = 1
FROM production_unit_shift_sessions s
WHERE s.project_name = COALESCE(mpl.project_name, 'PIM Mining Project')
  AND s.operational_date = mpl.tanggal
  AND s.shift_id = mpl.shift_id
  AND s.equipment_id = mpl.equipment_id
  AND mpl.unit_shift_session_id IS NULL;

-- 4) Proteksi database.
--    a) Duplikat persis (operator + interval identik) pada sesi aktif.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_logs_exact_segment
  ON mining_production_logs (unit_shift_session_id, operator_id, hm_start, hm_finish)
  WHERE deleted_at IS NULL AND operator_id IS NOT NULL;

--    b) Overlap interval HM [hm_start, hm_finish) antar segmen aktif dalam
--       satu sesi. Perbedaan operator/PIT-Area/JOB tidak menghapus konflik.
--       btree_gist dibutuhkan untuk exclusion constraint berbasis range.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  END IF;
END
$$;

-- Catatan: draft (Multi Work Log) memakai hm_start=hm_finish=0 sehingga
-- constraint overlap hanya dijaga untuk segmen 'submitted'; draft divalidasi
-- di lapisan aplikasi saat diisi dan disubmit.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_prod_logs_no_hm_overlap') THEN
    ALTER TABLE mining_production_logs DROP CONSTRAINT uq_prod_logs_no_hm_overlap;
  END IF;
  ALTER TABLE mining_production_logs
    ADD CONSTRAINT uq_prod_logs_no_hm_overlap
    EXCLUDE USING gist (
      unit_shift_session_id WITH =,
      int4range((hm_start * 100)::int, (hm_finish * 100)::int) WITH &&
    )
    WHERE (deleted_at IS NULL AND status = 'submitted');
END
$$;

COMMENT ON TABLE production_unit_shift_sessions IS
  'Induk sesi unit-shift: kelompokkan segmen Work Log pada scope + tanggal operasional + shift + unit.';
COMMENT ON COLUMN mining_production_logs.unit_shift_session_id IS
  'Sesi unit-shift tempat segmen Work Log ini berada.';
COMMENT ON COLUMN mining_production_logs.segment_sequence IS
  'Urutan kronologis segmen di dalam sesi (1 = segmen pertama).';
COMMENT ON COLUMN mining_production_logs.handover_reason IS
  'Alasan pergantian: pergantian operator, perpindahan PIT/Area, pergantian JOB, break, koreksi admin.';
COMMENT ON COLUMN mining_production_logs.source_log_id IS
  'Relasi ke segmen sebelumnya ketika record dibuat melalui aksi Pergantian Operator.';

COMMIT;