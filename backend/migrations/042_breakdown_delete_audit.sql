-- 042: Audit penghapusan breakdown massal per unit.
-- Baris absensi/riwayat penghapusan tidak boleh hilang tanpa jejak:
-- setiap eksekusi hapus breakdown (preview TIDAK dicatat, eksekusi dicatat)
-- menyimpan siapa, kapan, unit + insiden apa saja, dan alasan.
CREATE TABLE IF NOT EXISTS breakdown_delete_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id        UUID REFERENCES users(id),
  tanggal_dari    DATE,
  tanggal_sampai  DATE,
  unit_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  incident_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  counts          JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_breakdown_delete_audit_executed
  ON breakdown_delete_audit (executed_at DESC);

COMMENT ON TABLE breakdown_delete_audit IS 'Jejak audit eksekusi hapus breakdown massal (1 baris per eksekusi).';
