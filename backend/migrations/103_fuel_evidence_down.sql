-- Rollback 103_fuel_evidence.sql
-- PERINGATAN: menghapus metadata lampiran Fuel. File di bucket fuel-bukti TIDAK dihapus;
-- backup tabel fuel_attachments sebelum rollback bila sudah berisi data produksi.

BEGIN;

ALTER TABLE fuel_stock_opnames DROP COLUMN IF EXISTS evidence_config_version;
ALTER TABLE fuel_inventory_transactions DROP COLUMN IF EXISTS evidence_config_version;
DROP INDEX IF EXISTS uq_fuel_logs_client_uuid;
ALTER TABLE fuel_logs
  DROP COLUMN IF EXISTS evidence_config_version,
  DROP COLUMN IF EXISTS client_uuid;

DROP TABLE IF EXISTS fuel_attachments;
DROP TABLE IF EXISTS fuel_evidence_slots;
DROP TABLE IF EXISTS fuel_evidence_config_state;

COMMIT;
