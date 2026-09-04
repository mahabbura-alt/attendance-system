ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS class_unit VARCHAR(100) DEFAULT NULL;

COMMENT ON COLUMN equipment.class_unit IS 'Class unit, berupa kombinasi teks dan angka, misalnya DT 30 T';
