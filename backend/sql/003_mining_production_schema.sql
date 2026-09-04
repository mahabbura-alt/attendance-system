-- =========================================================
-- SKEMA DATABASE TAHAP 2: MINING PRODUCTION MANAGEMENT SYSTEM (OMOS)
-- Target: PostgreSQL 13+
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- 1. MASTER PITS, LOADING POINTS, DISPOSALS
-- =========================================================
CREATE TABLE IF NOT EXISTS production_pits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_pit        VARCHAR(100) NOT NULL,
    kode_pit        VARCHAR(20) UNIQUE NOT NULL,
    lokasi_kantor_id UUID REFERENCES lokasi_kantor(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS loading_points (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_loading_point  VARCHAR(100) NOT NULL,
    pit_id              UUID REFERENCES production_pits(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS disposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_disposal   VARCHAR(100) NOT NULL,
    pit_id          UUID REFERENCES production_pits(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- =========================================================
-- 2. MASTER EQUIPMENT (ALAT BERAT & TRANSPORTATION)
-- =========================================================
CREATE TABLE IF NOT EXISTS equipment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode_alat       VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'EXC-01', 'DT-05', 'DZR-02'
    kelas_alat      VARCHAR(50) NOT NULL,        -- 'Excavator', 'Dump Truck', 'Dozer', 'Grader', 'Wheel Loader'
    tipe_alat       VARCHAR(100) NOT NULL,       -- 'CAT 6020B', 'Komatsu HD785-7', 'CAT D8R', 'Komatsu GD705'
    brand           VARCHAR(100) NOT NULL DEFAULT 'Caterpillar', -- 'Caterpillar', 'Komatsu', 'Scania', 'Volvo', 'Hitachi'
    date_in         DATE NOT NULL DEFAULT CURRENT_DATE,
    fuel_rate_lph   NUMERIC(8,2) NOT NULL DEFAULT 35.0, -- Fuel Rate Liter / Jam (LPH)
    kapasitas_unit  NUMERIC(10,2),               -- Kapasitas unit: Dump Truck (ton), Excavator (m³), dll
    status_alat     VARCHAR(20) NOT NULL DEFAULT 'Ready' CHECK (status_alat IN ('Ready', 'Working', 'Standby', 'Breakdown')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- =========================================================
-- 3. MASTER STANDBY & BREAKDOWN CODES
-- =========================================================
ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS kapasitas_unit_uom VARCHAR(20) DEFAULT NULL;

ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS class_unit VARCHAR(100) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS master_standby_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode        VARCHAR(20) UNIQUE NOT NULL, -- e.g. 'STB-01'
    kategori    VARCHAR(100) NOT NULL,       -- e.g. 'Waiting Truck', 'Weather', 'No Operator', 'Road Repair'
    deskripsi   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS master_breakdown_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode        VARCHAR(20) UNIQUE NOT NULL, -- e.g. 'BD-ENG'
    kategori    VARCHAR(100) NOT NULL,       -- 'Electrical', 'Hydraulic', 'Engine', 'Transmission', 'Undercarriage', 'Bucket', 'Tyre', 'Pump', 'Fuel', 'Cooling', 'Others'
    deskripsi   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE master_standby_codes
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE master_standby_codes
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE master_breakdown_codes
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE master_breakdown_codes
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE master_standby_codes
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE master_standby_codes
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE master_breakdown_codes
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE master_breakdown_codes
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- =========================================================
-- 4. LOG PRODUKSI HARIAN (INPUT DATA / WORK LOG)
-- =========================================================
CREATE TABLE IF NOT EXISTS mining_production_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal           DATE NOT NULL,
    shift_id          UUID NOT NULL REFERENCES shifts(id),
    project_name      VARCHAR(100) NOT NULL DEFAULT 'PIM Mining Project',
    pit_id            UUID REFERENCES production_pits(id),
    loading_point_id  UUID REFERENCES loading_points(id),
    disposal_id       UUID REFERENCES disposals(id),
    equipment_id      UUID NOT NULL REFERENCES equipment(id),
    operator_id       UUID REFERENCES users(id),
    area_name         VARCHAR(150),
    job               VARCHAR(150),
    job_description   TEXT NOT NULL,
    hm_start          NUMERIC(10,2) NOT NULL DEFAULT 0,
    hm_finish         NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_hm          NUMERIC(10,2) NOT NULL GENERATED ALWAYS AS (GREATEST(0, hm_finish - hm_start)) STORED,
    remark            TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted')),
    created_by        UUID REFERENCES users(id),
    updated_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prod_logs_tgl_shift ON mining_production_logs (tanggal, shift_id);
CREATE INDEX IF NOT EXISTS idx_prod_logs_equip ON mining_production_logs (equipment_id);

ALTER TABLE mining_production_logs
ADD COLUMN IF NOT EXISTS hm_anomaly_status VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE mining_production_logs
ADD COLUMN IF NOT EXISTS hm_anomaly_reason TEXT;
ALTER TABLE mining_production_logs
ADD COLUMN IF NOT EXISTS hm_anomaly_details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE mining_production_logs
ADD COLUMN IF NOT EXISTS hm_validated_at TIMESTAMPTZ;

-- =========================================================
-- 5. FUEL LOGS (INPUT FUEL)
-- =========================================================
CREATE TABLE IF NOT EXISTS fuel_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal           DATE NOT NULL,
    shift_id          UUID NOT NULL REFERENCES shifts(id),
    equipment_id      UUID NOT NULL REFERENCES equipment(id),
    operator_id       UUID REFERENCES users(id),
    hm_start          NUMERIC(10,2) NOT NULL DEFAULT 0,
    hm_finish         NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_hm          NUMERIC(10,2) NOT NULL DEFAULT 0,
    fuel_filled       NUMERIC(10,2) NOT NULL DEFAULT 0, -- Liter
    fuel_remaining    NUMERIC(10,2) NOT NULL DEFAULT 0, -- Liter
    fuel_consumption  NUMERIC(10,2) NOT NULL DEFAULT 0, -- Liter
    -- NULL saat baseline HM belum tersedia. Jangan gunakan 0 karena itu
    -- bermakna konsumsi nol, bukan rasio yang belum dapat dihitung.
    fuel_per_hm       NUMERIC(14,6), -- Liter / HM
    remark            TEXT,
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fuel_logs_tgl ON fuel_logs (tanggal, shift_id);

-- Fuel card model: cumulative readings are entered at the actual refuelling event.
-- Legacy columns remain available so historical records are preserved.
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS hm_reading NUMERIC(12,2);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS odometer_reading NUMERIC(14,2);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS hm_delta NUMERIC(12,4);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS distance_km NUMERIC(14,4);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS fuel_per_km NUMERIC(14,6);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS source_type VARCHAR(24) NOT NULL DEFAULT 'manual';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS fuel_ticket_no VARCHAR(100);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS record_status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS is_meter_reset BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS meter_reset_reason TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS anomaly_status VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS anomaly_details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE fuel_logs
SET hm_reading = COALESCE(hm_reading, hm_finish),
    hm_delta = COALESCE(hm_delta, NULLIF(total_hm, 0)),
    record_status = CASE WHEN record_status = 'draft' THEN 'migrated' ELSE record_status END,
    source_type = CASE WHEN source_type = 'manual' THEN 'legacy' ELSE source_type END
WHERE hm_reading IS NULL OR hm_delta IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_equipment_period
ON fuel_logs (equipment_id, tanggal, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_status
ON fuel_logs (approval_status, anomaly_status)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fuel_log_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_log_id     UUID NOT NULL REFERENCES fuel_logs(id),
    action          VARCHAR(30) NOT NULL,
    before_data     JSONB,
    after_data      JSONB,
    changed_by      UUID REFERENCES users(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fuel_log_audit_log
ON fuel_log_audit (fuel_log_id, changed_at DESC);

-- Fuel card model: cumulative readings are entered at the actual refuelling event.
-- Legacy columns remain available so historical records are preserved.
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS hm_reading NUMERIC(12,2);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS odometer_reading NUMERIC(14,2);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS hm_delta NUMERIC(12,4);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS distance_km NUMERIC(14,4);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS fuel_per_km NUMERIC(14,6);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS source_type VARCHAR(24) NOT NULL DEFAULT 'manual';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS fuel_ticket_no VARCHAR(100);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS record_status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS is_meter_reset BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS meter_reset_reason TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS anomaly_status VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS anomaly_details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE fuel_logs
SET hm_reading = COALESCE(hm_reading, hm_finish),
    hm_delta = COALESCE(hm_delta, NULLIF(total_hm, 0)),
    record_status = CASE WHEN record_status = 'draft' THEN 'migrated' ELSE record_status END,
    source_type = CASE WHEN source_type = 'manual' THEN 'legacy' ELSE source_type END
WHERE hm_reading IS NULL OR hm_delta IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_equipment_period
ON fuel_logs (equipment_id, tanggal, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_status
ON fuel_logs (approval_status, anomaly_status)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fuel_log_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_log_id     UUID NOT NULL REFERENCES fuel_logs(id),
    action          VARCHAR(30) NOT NULL,
    before_data     JSONB,
    after_data      JSONB,
    changed_by      UUID REFERENCES users(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fuel_log_audit_log
ON fuel_log_audit (fuel_log_id, changed_at DESC);

-- =========================================================
-- 6. STANDBY LOGS (INPUT STANDBY)
-- =========================================================
CREATE TABLE IF NOT EXISTS standby_logs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal               DATE NOT NULL,
    shift_id              UUID NOT NULL REFERENCES shifts(id),
    equipment_id          UUID NOT NULL REFERENCES equipment(id),
    standby_code_id       UUID NOT NULL REFERENCES master_standby_codes(id),
    description           TEXT,
    start_time            TIMESTAMPTZ NOT NULL,
    finish_time           TIMESTAMPTZ NOT NULL,
    total_standby_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stb_logs_tgl ON standby_logs (tanggal, shift_id);

-- =========================================================
-- 7. BREAKDOWN LOGS (INPUT BREAKDOWN)
-- =========================================================
CREATE TABLE IF NOT EXISTS breakdown_logs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal                 DATE NOT NULL,
    shift_id                UUID NOT NULL REFERENCES shifts(id),
    equipment_id            UUID NOT NULL REFERENCES equipment(id),
    breakdown_code_id       UUID NOT NULL REFERENCES master_breakdown_codes(id),
    description             TEXT,
    remark                  TEXT,
    start_time              TIMESTAMPTZ NOT NULL,
    finish_time             TIMESTAMPTZ,
    total_breakdown_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,
    status                  VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    current_status          VARCHAR(30) NOT NULL DEFAULT 'mechanic_progress' CHECK (current_status IN ('mechanic_progress', 'waiting_part', 'waiting_tool', 'waiting_manpower', 'waiting_vendor', 'resolved')),
    reported_by             UUID REFERENCES users(id),
    pic_id                  UUID REFERENCES users(id),
    created_by              UUID REFERENCES users(id),
    updated_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bd_logs_tgl ON breakdown_logs (tanggal, shift_id);

CREATE TABLE IF NOT EXISTS breakdown_status_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    breakdown_id    UUID NOT NULL REFERENCES breakdown_logs(id) ON DELETE CASCADE,
    status          VARCHAR(30) NOT NULL CHECK (status IN ('mechanic_progress', 'waiting_part', 'waiting_tool', 'waiting_manpower', 'waiting_vendor')),
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    note            TEXT,
    changed_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_breakdown_status_open_segment ON breakdown_status_history (breakdown_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_breakdown_status_history_incident ON breakdown_status_history (breakdown_id, started_at);

CREATE TABLE IF NOT EXISTS breakdown_parts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    breakdown_id    UUID NOT NULL REFERENCES breakdown_logs(id) ON DELETE CASCADE,
    part_detail     TEXT NOT NULL,
    po_number       VARCHAR(100),
    quantity        NUMERIC(12,2),
    po_status       VARCHAR(30) NOT NULL DEFAULT 'requested' CHECK (po_status IN ('requested', 'po_process', 'ordered', 'arrived', 'cancelled')),
    eta_date        DATE,
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CHECK (quantity IS NULL OR quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_breakdown_parts_incident ON breakdown_parts (breakdown_id) WHERE deleted_at IS NULL;

-- =========================================================
-- 7B. MAINTENANCE EVENTS (SERVICE, INSPECTION & REPAIR)
-- =========================================================
-- Breakdown tetap menjadi sumber functional failure. Tabel ini mencatat
-- pekerjaan maintenance yang sebelumnya belum memiliki record terstruktur,
-- terutama service berkala, inspeksi, corrective running repair, serta
-- calendar exclusion yang disetujui untuk basis Scheduled Hours.
CREATE TABLE IF NOT EXISTS maintenance_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal                 DATE NOT NULL,
    shift_id                UUID REFERENCES shifts(id),
    equipment_id            UUID NOT NULL REFERENCES equipment(id),
    event_type              VARCHAR(30) NOT NULL CHECK (event_type IN ('scheduled_service', 'inspection', 'corrective_repair', 'calendar_exclusion')),
    status                  VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    title                   VARCHAR(180) NOT NULL,
    component               VARCHAR(150),
    description             TEXT,
    failure_mode            VARCHAR(180),
    failure_cause           TEXT,
    corrective_action       TEXT,
    scheduled_start         TIMESTAMPTZ NOT NULL,
    scheduled_finish        TIMESTAMPTZ NOT NULL,
    actual_start            TIMESTAMPTZ,
    actual_finish           TIMESTAMPTZ,
    downtime_hours          NUMERIC(14,6) NOT NULL DEFAULT 0,
    affects_availability    BOOLEAN NOT NULL DEFAULT TRUE,
    functional_failure      BOOLEAN NOT NULL DEFAULT FALSE,
    service_interval_hm     NUMERIC(12,2),
    meter_hm                NUMERIC(12,2),
    reported_by             UUID REFERENCES users(id),
    pic_id                  UUID REFERENCES users(id),
    remark                  TEXT,
    created_by              UUID REFERENCES users(id),
    updated_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    CHECK (scheduled_finish >= scheduled_start),
    CHECK (actual_finish IS NULL OR (actual_start IS NOT NULL AND actual_finish >= actual_start)),
    CHECK (downtime_hours >= 0),
    CHECK (service_interval_hm IS NULL OR service_interval_hm > 0),
    CHECK (meter_hm IS NULL OR meter_hm >= 0)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_events_period ON maintenance_events (tanggal, event_type, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_events_equipment ON maintenance_events (equipment_id, scheduled_start) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_events_pic ON maintenance_events (pic_id, scheduled_start) WHERE deleted_at IS NULL;

-- =========================================================
-- 8. FLEET MAPPING & RITASE LOGS (INPUT RITASE & AUTO FLEET)
-- =========================================================
CREATE TABLE IF NOT EXISTS fleet_mappings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal           DATE NOT NULL,
    shift_id          UUID NOT NULL REFERENCES shifts(id),
    nama_fleet        VARCHAR(100) NOT NULL, -- e.g. 'Fleet Alpha (EXC-01)'
    excavator_id      UUID NOT NULL REFERENCES equipment(id),
    loading_point_id  UUID REFERENCES loading_points(id),
    disposal_id       UUID REFERENCES disposals(id),
    material_type     VARCHAR(50) NOT NULL DEFAULT 'Overburden' CHECK (material_type IN ('Coal', 'Overburden')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fleet_mapping_trucks (
    fleet_mapping_id  UUID NOT NULL REFERENCES fleet_mappings(id) ON DELETE CASCADE,
    dump_truck_id     UUID NOT NULL REFERENCES equipment(id),
    PRIMARY KEY (fleet_mapping_id, dump_truck_id)
);

CREATE TABLE IF NOT EXISTS ritase_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal             DATE NOT NULL,
    shift_id            UUID NOT NULL REFERENCES shifts(id),
    fleet_mapping_id    UUID REFERENCES fleet_mappings(id),
    excavator_id        UUID NOT NULL REFERENCES equipment(id),
    dump_truck_id       UUID NOT NULL REFERENCES equipment(id),
    operator_id         UUID REFERENCES users(id),
    material            VARCHAR(50) NOT NULL CHECK (material IN ('Coal', 'Overburden')),
    loading_point_id    UUID REFERENCES loading_points(id),
    disposal_id         UUID REFERENCES disposals(id),
    ritase_count        INTEGER NOT NULL DEFAULT 0,
    production_volume   NUMERIC(10,2) NOT NULL DEFAULT 0, -- MT untuk Coal, BCM untuk Overburden
    average_cycle_time  NUMERIC(10,2) NOT NULL DEFAULT 0, -- Menit per rit
    remark              TEXT,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ritase_tgl ON ritase_logs (tanggal, shift_id);

-- =========================================================
-- 9. TARGET PRODUKSI & COSTS
-- =========================================================
CREATE TABLE IF NOT EXISTS production_targets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    periode           DATE NOT NULL UNIQUE, -- First day of month (YYYY-MM-01)
    target_coal_mt    NUMERIC(12,2) NOT NULL DEFAULT 50000,
    target_ob_bcm     NUMERIC(12,2) NOT NULL DEFAULT 200000,
    target_fuel_liter NUMERIC(12,2) NOT NULL DEFAULT 80000,
    target_hm_unit    NUMERIC(12,2) NOT NULL DEFAULT 500,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- SEED MASTER DATA AWAL PRODUKSI TAMBANG
-- =========================================================

-- Pits
INSERT INTO production_pits (nama_pit, kode_pit) VALUES
    ('Pit Central Alpha', 'PIT-A'),
    ('Pit South Bravo', 'PIT-B')
ON CONFLICT (kode_pit) DO NOTHING;

-- Loading Points & Disposals
INSERT INTO loading_points (nama_loading_point, pit_id)
SELECT 'Loading Point Seam 3A', id FROM production_pits WHERE kode_pit = 'PIT-A'
ON CONFLICT DO NOTHING;

INSERT INTO loading_points (nama_loading_point, pit_id)
SELECT 'Loading Point Seam 5B', id FROM production_pits WHERE kode_pit = 'PIT-B'
ON CONFLICT DO NOTHING;

INSERT INTO disposals (nama_disposal, pit_id)
SELECT 'Disposal North Outpit', id FROM production_pits WHERE kode_pit = 'PIT-A'
ON CONFLICT DO NOTHING;

INSERT INTO disposals (nama_disposal, pit_id)
SELECT 'Disposal South Inpit', id FROM production_pits WHERE kode_pit = 'PIT-B'
ON CONFLICT DO NOTHING;

-- Master Equipment
INSERT INTO equipment (kode_alat, kelas_alat, tipe_alat, brand, date_in, fuel_rate_lph, status_alat) VALUES
    ('EXC-01', 'Excavator', 'CAT 6020B (20 Ton)', 'Caterpillar', '2024-01-15', 55.0, 'Working'),
    ('EXC-02', 'Excavator', 'Komatsu PC1250-8', 'Komatsu', '2024-03-10', 48.5, 'Working'),
    ('DT-01', 'Dump Truck', 'Komatsu HD785-7 (100T)', 'Komatsu', '2024-02-01', 38.0, 'Working'),
    ('DT-02', 'Dump Truck', 'Komatsu HD785-7 (100T)', 'Komatsu', '2024-02-01', 38.0, 'Working'),
    ('DT-03', 'Dump Truck', 'CAT 777E (100T)', 'Caterpillar', '2024-04-12', 42.0, 'Working'),
    ('DT-04', 'Dump Truck', 'CAT 777E (100T)', 'Caterpillar', '2024-04-12', 42.0, 'Working'),
    ('DT-05', 'Dump Truck', 'Scania P410 (40T)', 'Scania', '2024-05-20', 28.0, 'Standby'),
    ('DZR-01', 'Dozer', 'CAT D8R', 'Caterpillar', '2024-01-10', 32.5, 'Working'),
    ('GRD-01', 'Grader', 'Komatsu GD705-5', 'Komatsu', '2024-03-01', 25.0, 'Working')
ON CONFLICT (kode_alat) DO NOTHING;

-- Master Standby Codes
INSERT INTO master_standby_codes (kode, kategori, deskripsi) VALUES
    ('STB-01', 'Waiting Truck', 'Excavator menunggu antrian truk'),
    ('STB-02', 'No Operator', 'Unit tidak ada operator shift'),
    ('STB-03', 'Rain / Hujan', 'Hujan deras menghambat jalur haul road'),
    ('STB-04', 'Refueling', 'Pengisian bahan bakar solar di lapangan'),
    ('STB-05', 'Road Repair', 'Perbaikan jalan tambang oleh grader/dozer'),
    ('STB-06', 'Safety Meeting', 'Safety P5M / P2H sebelum kerja'),
    ('STB-07', 'Inspection', 'Inspeksi berkala mekanik / supervisor')
ON CONFLICT (kode) DO NOTHING;

-- Master Breakdown Codes
INSERT INTO master_breakdown_codes (kode, kategori, deskripsi) VALUES
    ('BD-01', 'Engine', 'Kerusakan mesin / overheat'),
    ('BD-02', 'Hydraulic', 'Kebocoran selang / pompa hidrolik'),
    ('BD-03', 'Transmission', 'Masalah transmisi & gerak transmisi'),
    ('BD-04', 'Electrical', 'Kelistrikan / sensor / aki terputus'),
    ('BD-05', 'Undercarriage', 'Track shoe / roller rantai aus/lepas'),
    ('BD-06', 'Tyre', 'Ban pecah / tertusuk batuan kars'),
    ('BD-07', 'Bucket', 'Gigi bucket patah / pengelasan bucket'),
    ('BD-08', 'Cooling', 'Radiator bocor / kipas terganggu')
ON CONFLICT (kode) DO NOTHING;

-- Target Produksi Default
INSERT INTO production_targets (periode, target_coal_mt, target_ob_bcm, target_fuel_liter, target_hm_unit)
VALUES (DATE_TRUNC('month', CURRENT_DATE), 65000, 250000, 95000, 600)
ON CONFLICT (periode) DO NOTHING;

-- =========================================================
-- 10. STANDBY MOHH CONTROL & SHIFT CLOSING
-- =========================================================
ALTER TABLE master_standby_codes
  ADD COLUMN IF NOT EXISTS planning_type VARCHAR(20) NOT NULL DEFAULT 'unplanned',
  ADD COLUMN IF NOT EXISTS control_class VARCHAR(20) NOT NULL DEFAULT 'controllable',
  ADD COLUMN IF NOT EXISTS owner_department VARCHAR(80) NOT NULL DEFAULT 'Production',
  ADD COLUMN IF NOT EXISTS requires_description BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requires_evidence BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE master_standby_codes ADD CONSTRAINT master_standby_codes_planning_type_check
    CHECK (planning_type IN ('planned','unplanned'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE master_standby_codes ADD CONSTRAINT master_standby_codes_control_class_check
    CHECK (control_class IN ('controllable','uncontrollable'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS standby_shift_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_date DATE NOT NULL,
  shift_id UUID NOT NULL REFERENCES shifts(id),
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  status VARCHAR(20) NOT NULL DEFAULT 'closed' CHECK (status IN ('closed','reopened')),
  target_mohh_hours NUMERIC(14,6) NOT NULL DEFAULT 12,
  hm_hours_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0,
  breakdown_hours_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0,
  standby_hours_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0,
  accounted_hours_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0,
  balance_hours_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0,
  close_note TEXT,
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES users(id),
  reopened_at TIMESTAMPTZ,
  reopen_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (operational_date, shift_id, equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_standby_shift_closures_scope
  ON standby_shift_closures (operational_date, shift_id, equipment_id, status);

CREATE TABLE IF NOT EXISTS standby_shift_closure_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_id UUID NOT NULL REFERENCES standby_shift_closures(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_standby_shift_closure_audit
  ON standby_shift_closure_audit (closure_id, changed_at DESC);
