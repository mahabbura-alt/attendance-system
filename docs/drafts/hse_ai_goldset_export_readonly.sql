-- Ekspor gold set deteksi hazard ganda dari data nyata — BACA SAJA (transaksi READ ONLY + ROLLBACK).
-- Keluaran: JSON Lines siap untuk backend/src/scripts/eval_hse_ai.js --file <berkas>.
-- Nama pelapor/PIC TIDAK diambil. Tinjau berkas sebelum dipakai; simpan di luar repo.
--
--   psql "$DATABASE_URL" -At -f docs/drafts/hse_ai_goldset_export_readonly.sql > goldset.jsonl
--
-- Bagian 1 = pasangan POSITIF (pernah digabung HSE officer → label SAMA).
-- Bagian 2 = kandidat NEGATIF (Area sama, ≤ 30 hari, tidak digabung) berlabel "TINJAU":
--            HSE officer WAJIB mengganti "TINJAU" menjadi SAMA / TERKAIT / BERBEDA sebelum evaluasi.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT json_build_object(
  'id', 'POS-' || s.report_no,
  'label', 'SAMA',
  'a', json_build_object('uraian', t.description, 'konsekuensi', t.potential_consequence,
        'area', COALESCE(pt.name, lt.name, t.location_name), 'sub_area', CASE WHEN lt.parent_id IS NOT NULL THEN lt.name END),
  'b', json_build_object('uraian', s.description, 'konsekuensi', s.potential_consequence,
        'area', COALESCE(ps.name, ls.name, s.location_name), 'sub_area', CASE WHEN ls.parent_id IS NOT NULL THEN ls.name END)
)::text
FROM hazard_reports s
JOIN hazard_reports t ON t.id = s.merged_into_id
LEFT JOIN hse_locations lt ON lt.id = t.location_id
LEFT JOIN hse_locations pt ON pt.id = lt.parent_id
LEFT JOIN hse_locations ls ON ls.id = s.location_id
LEFT JOIN hse_locations ps ON ps.id = ls.parent_id
WHERE s.merged_into_id IS NOT NULL AND s.deleted_at IS NULL
ORDER BY s.merged_at DESC
LIMIT 200;

SELECT json_build_object(
  'id', 'NEG-' || a.report_no || '-' || b.report_no,
  'label', 'TINJAU',
  'a', json_build_object('uraian', a.description, 'konsekuensi', a.potential_consequence,
        'area', COALESCE(pa.name, la.name, a.location_name), 'sub_area', CASE WHEN la.parent_id IS NOT NULL THEN la.name END),
  'b', json_build_object('uraian', b.description, 'konsekuensi', b.potential_consequence,
        'area', COALESCE(pb.name, lb.name, b.location_name), 'sub_area', CASE WHEN lb.parent_id IS NOT NULL THEN lb.name END)
)::text
FROM hazard_reports a
JOIN hazard_reports b ON b.tenant_key = a.tenant_key AND b.project_key = a.project_key AND b.id > a.id
LEFT JOIN hse_locations la ON la.id = a.location_id
LEFT JOIN hse_locations pa ON pa.id = la.parent_id
LEFT JOIN hse_locations lb ON lb.id = b.location_id
LEFT JOIN hse_locations pb ON pb.id = lb.parent_id
WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
  AND a.merged_into_id IS NULL AND b.merged_into_id IS NULL
  AND a.status <> 'DUPLICATE' AND b.status <> 'DUPLICATE'
  AND COALESCE(la.parent_id, la.id) = COALESCE(lb.parent_id, lb.id)
  AND ABS(a.report_date - b.report_date) <= 30
ORDER BY a.report_date DESC
LIMIT 100;

ROLLBACK;
