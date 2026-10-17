-- 105_fuel_tx_updated_at.sql
-- Perbaikan (ditemukan uji E2E APK OMOS Fuel 17 Okt 2026): kode posting/reversal/void menulis
-- fuel_inventory_transactions.updated_at, tetapi kolom tidak pernah dibuat di migrasi 048,
-- sehingga semua posting draft gagal ("column updated_at does not exist").
-- Aditif & idempoten. Rollback: 105_fuel_tx_updated_at_down.sql

BEGIN;
ALTER TABLE fuel_inventory_transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
COMMIT;
