-- =========================================================
-- 039 — FLEET RITASE: UNIQUE OPERATIONAL CONTEXT
-- =========================================================
-- Satu excavator dapat membentuk lebih dari satu tabel fleet pada
-- tanggal/shift yang sama apabila PIT/Area, JOB, atau materialnya berbeda.
-- Kombinasi yang seluruh konteksnya sama harus tunggal agar ritase, target,
-- dan laporan tetap memiliki sumber yang tidak ambigu.
--
-- Normalisasi BTRIM + LOWER menutup duplikat yang hanya berbeda spasi atau
-- kapitalisasi. Soft-deleted fleet tidak menghalangi setup baru.
--
-- CONCURRENTLY menjaga operasi fleet aktif tidak terkunci lama saat index
-- dibuat di database produksi. Jangan bungkus statement ini dengan BEGIN.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_fleet_mapping_operational_context
  ON fleet_mappings (
    tanggal,
    shift_id,
    excavator_id,
    LOWER(BTRIM(COALESCE(pit_area, ''))),
    LOWER(BTRIM(COALESCE(job_code, ''))),
    LOWER(BTRIM(COALESCE(material_detail, '')))
  )
  WHERE deleted_at IS NULL;

