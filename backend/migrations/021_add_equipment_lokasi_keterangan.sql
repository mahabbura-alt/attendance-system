-- =========================================================
-- 021: Tambah kolom lokasi & keterangan pada tabel equipment
-- ---------------------------------------------------------
-- Controller production (getMasterData, createEquipment,
-- updateEquipment, importEquipment) mereferensikan kolom
-- equipment.lokasi dan equipment.keterangan yang ternyata
-- belum pernah didefinisikan di skema dasar maupun migrasi
-- sebelumnya. Migrasi ini menambahkan kolom tsb secara
-- idempotent (aman dijalankan berulang).
-- =========================================================

ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS lokasi VARCHAR(200) DEFAULT NULL;

ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS keterangan TEXT DEFAULT NULL;
