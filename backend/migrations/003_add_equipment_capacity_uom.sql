-- Kapasitas unit dipisahkan menjadi nilai dan satuan ukur.
-- Kolom kapasitas_unit yang sudah ada dipertahankan sebagai Value agar data lama tetap kompatibel.

ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS kapasitas_unit_uom VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN equipment.kapasitas_unit IS 'Value kapasitas unit (angka dengan presisi satu desimal), diisi manual oleh admin';
COMMENT ON COLUMN equipment.kapasitas_unit_uom IS 'Unit of Measure kapasitas unit, diisi manual oleh admin';
