-- Rollback 104_fuel_mobile.sql
-- PERINGATAN: menghapus akun Fuel, perangkat, sesi shift, pengaturan, dan ID scan.
-- Label QR yang sudah dicetak menjadi tidak berlaku. Backup sebelum rollback.

BEGIN;

DELETE FROM fuel_evidence_slots WHERE transaction_kind IN ('shift_open', 'shift_close');
UPDATE fuel_attachments SET entity_type = NULL, entity_id = NULL WHERE entity_type = 'shift_session';
ALTER TABLE fuel_attachments DROP CONSTRAINT IF EXISTS fuel_attachments_entity_type_check;
ALTER TABLE fuel_attachments ADD CONSTRAINT fuel_attachments_entity_type_check
  CHECK (entity_type IN ('fuel_log', 'transaction', 'opname'));
ALTER TABLE fuel_evidence_slots DROP CONSTRAINT IF EXISTS fuel_evidence_slots_transaction_kind_check;
ALTER TABLE fuel_evidence_slots ADD CONSTRAINT fuel_evidence_slots_transaction_kind_check
  CHECK (transaction_kind IN ('issue_equipment', 'transfer', 'receipt', 'opname'));

DROP INDEX IF EXISTS uq_fuel_stock_opnames_client_uuid;
ALTER TABLE fuel_stock_opnames DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS client_uuid;
ALTER TABLE fuel_inventory_transactions
  DROP COLUMN IF EXISTS void_reason, DROP COLUMN IF EXISTS mobile_flags, DROP COLUMN IF EXISTS device_id;
DROP INDEX IF EXISTS idx_fuel_logs_mobile_flags;
ALTER TABLE fuel_logs
  DROP COLUMN IF EXISTS reported_hm, DROP COLUMN IF EXISTS mobile_reason, DROP COLUMN IF EXISTS mobile_flags,
  DROP COLUMN IF EXISTS shift_session_id, DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS unit_input_reason,
  DROP COLUMN IF EXISTS unit_input, DROP COLUMN IF EXISTS source_location_id, DROP COLUMN IF EXISTS filled_at;

DROP TABLE IF EXISTS fuel_shift_sessions;
DROP TABLE IF EXISTS fuel_devices;
DROP TABLE IF EXISTS fuel_operator_accounts;
DROP TABLE IF EXISTS fuel_mobile_settings;
DROP TABLE IF EXISTS fuel_scan_id_revocations;

DROP INDEX IF EXISTS uq_fuel_locations_scan_id;
DROP INDEX IF EXISTS uq_equipment_scan_id;
ALTER TABLE fuel_storage_locations DROP COLUMN IF EXISTS scan_id;
ALTER TABLE equipment DROP COLUMN IF EXISTS fuel_tank_capacity_liter, DROP COLUMN IF EXISTS scan_id;
DROP FUNCTION IF EXISTS omos_gen_scan_id(TEXT);

COMMIT;
