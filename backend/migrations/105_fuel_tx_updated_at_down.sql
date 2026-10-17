-- Rollback 105_fuel_tx_updated_at.sql (kode posting kembali gagal tanpa kolom ini).
BEGIN;
ALTER TABLE fuel_inventory_transactions DROP COLUMN IF EXISTS updated_at;
COMMIT;
