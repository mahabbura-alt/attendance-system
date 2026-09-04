-- Migration: Add Kapasitas Unit column to equipment table
-- This adds capacity field for dump truck payload capacity (tonnes) or excavator bucket capacity (m³)

ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS kapasitas_unit NUMERIC(10,2) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN equipment.kapasitas_unit IS 'Kapasitas unit: Untuk Dump Truck = Kapasitas muatan (ton), Untuk Excavator = Kapasitas bucket (m³), Untuk alat lain = Kapasitas operasional standar';