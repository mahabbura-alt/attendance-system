-- Migration 081: Modul HSE - Register Risiko (IBPR / HIRADC)
-- Identifikasi Bahaya, Penilaian Risiko, dan Pengendalian Risiko

CREATE TABLE IF NOT EXISTS hse_risk_register (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID,
    risk_no VARCHAR(64) NOT NULL,
    activity VARCHAR(255) NOT NULL,
    department_id UUID,
    department_name VARCHAR(120),
    hazard TEXT NOT NULL,
    consequence_desc TEXT NOT NULL,
    initial_likelihood INT NOT NULL CHECK (initial_likelihood BETWEEN 1 AND 5),
    initial_consequence INT NOT NULL CHECK (initial_consequence BETWEEN 1 AND 5),
    initial_score INT NOT NULL,
    initial_level VARCHAR(32) NOT NULL, -- LOW, MEDIUM, HIGH, EXTREME
    controls JSONB DEFAULT '[]'::jsonb, -- array of { type: string, description: string }
    residual_likelihood INT NOT NULL CHECK (residual_likelihood BETWEEN 1 AND 5),
    residual_consequence INT NOT NULL CHECK (residual_consequence BETWEEN 1 AND 5),
    residual_score INT NOT NULL,
    residual_level VARCHAR(32) NOT NULL, -- LOW, MEDIUM, HIGH, EXTREME
    owner_id UUID,
    owner_name VARCHAR(150),
    review_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, UNDER_REVIEW, RETIRED
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hse_risk_reg_tenant_status ON hse_risk_register(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_risk_reg_levels ON hse_risk_register(initial_level, residual_level) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hse_risk_reg_matrix ON hse_risk_register(residual_likelihood, residual_consequence) WHERE deleted_at IS NULL;

-- Seed Data Register Risiko (IBPR) Pertambangan Nyata
INSERT INTO hse_risk_register (
    tenant_id, site_id, risk_no, activity, department_name, hazard, consequence_desc,
    initial_likelihood, initial_consequence, initial_score, initial_level,
    controls,
    residual_likelihood, residual_consequence, residual_score, residual_level,
    owner_name, review_date, status
)
VALUES
(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
    'RSK-2610-001', 'Operasi Pengangkutan Batubara (Hauling)', 'Mining Operations',
    'Jalan hauling licin pasca hujan & tikungan turunan tajam KM 12',
    'Unit Dump Truck selip, tabrakan beruntun, atau terbalik ke jurang (Potensi Fatality / Kerusakan Berat)',
    4, 5, 20, 'EXTREME',
    '[
        {"type": "ENGINEERING", "description": "Pemasangan tanggul pengaman (safety bund) tinggi min 3/4 roda (1.8m) & super-elevasi tikungan"},
        {"type": "ADMINISTRATIVE", "description": "SOP Siaga Basah, batas kecepatan max 20 km/jam saat hujan, radio call komunikasi dua arah"},
        {"type": "PPE", "description": "Seatbelt 3-titik wajib terpasang dan rompi reflektif"}
    ]'::jsonb,
    2, 4, 8, 'MEDIUM',
    'Budi Santoso, ST (Mine Superintendent)', '2026-11-15', 'ACTIVE'
),
(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
    'RSK-2610-002', 'Penggalian & Pemuatan Front Tambang (Pit Loading)', 'Mining Operations',
    'Longsoran lereng pit (Slope Failure) pada dinding highwall',
    'Alat berat Excavator & Dump Truck tertimbun material batuan, korban jiwa operator',
    4, 5, 20, 'EXTREME',
    '[
        {"type": "ENGINEERING", "description": "Pemasangan radar geoteknik real-time (Slope Stability Radar) & prisma monitoring lereng"},
        {"type": "ADMINISTRATIVE", "description": "Inspeksi geoteknik harian sebelum penggalian, penentuan batas aman radius kerja 1.5x tinggi jenjang"},
        {"type": "PPE", "description": "Kabin alat berat bersertifikasi FOPS/ROPS, helm & radio HT siaga darurat"}
    ]'::jsonb,
    2, 4, 8, 'MEDIUM',
    'Ir. Hendra Gunawan, IPM (KTT)', '2026-10-30', 'ACTIVE'
),
(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
    'RSK-2610-003', 'Peledakan Batuan Penutup (Overburden Blasting)', 'Drill & Blast',
    'Batuan terbang (Flyrock) & getaran berlebih melebihi batas clearance radius',
    'Pekerja atau unit terkena lontaran batu, kerusakan infrastruktur hauling & genset',
    3, 5, 15, 'HIGH',
    '[
        {"type": "ENGINEERING", "description": "Perhitungan burden-spacing akurat, stemming batu pecah berkualitas, dan delay detonator elektronik"},
        {"type": "ADMINISTRATIVE", "description": "Clearance zona aman 500m manusia & 300m unit, sirine 3x peringatan, blokade total jalan tambang"},
        {"type": "PPE", "description": "Safety glass & safety helmet impact-resistant"}
    ]'::jsonb,
    1, 4, 4, 'LOW',
    'Rahmat Hidayat, SKM (Blast Safety Spv)', '2026-12-01', 'ACTIVE'
),
(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
    'RSK-2610-004', 'Penggantian & Pemompaan Ban HD (Tyre Maintenance)', 'Plant & Maintenance',
    'Ledakan ban bertekanan tinggi (Tyre Explosion / Bead Failure) saat pengisian angin',
    'Mekanik terhempas pecahan velg (Trajectory Zone) mengakibatkan cidera fatal/cacat tetap',
    3, 5, 15, 'HIGH',
    '[
        {"type": "ENGINEERING", "description": "Penggunaan keranjang pengaman ban (Tyre Inflation Safety Cage) & selang pengisi angin jarak jauh (remote inflator min 5m)"},
        {"type": "ADMINISTRATIVE", "description": "SOP penggantian ban, sertifikasi kompetensi mekanik tyre, larangan berada di garis lintasan ban"},
        {"type": "PPE", "description": "Face shield, ear plug/muff, safety boots pelindung metatarsal"}
    ]'::jsonb,
    1, 4, 4, 'LOW',
    'Dedi Pratama, ST (Workshop Foreman)', '2026-11-20', 'ACTIVE'
),
(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
    'RSK-2610-005', 'Pembersihan Tangki Bahan Bakar / Fuel Storage', 'Warehouse & Fuel',
    'Gas atmosfer mudah terbakar & kekurangan oksigen di dalam ruang terbatas (Confined Space)',
    'Asfiksia, keracunan gas hidrokarbon, atau ledakan/kebakaran di dalam tangki',
    3, 5, 15, 'HIGH',
    '[
        {"type": "ENGINEERING", "description": "Blowing forced ventilation (exhaust blower explosion-proof) selama pekerjaan"},
        {"type": "ADMINISTRATIVE", "description": "Izin kerja PTW Confined Space, gas test clearance (O2 19.5-23.5%, LEL 0%), Fire Watcher standby"},
        {"type": "PPE", "description": "Full body harness dengan tali rescue lifeline, respirator cartridge organik"}
    ]'::jsonb,
    1, 4, 4, 'LOW',
    'Agus Setiawan, ST (HSE Head)', '2026-10-25', 'ACTIVE'
),
(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
    'RSK-2610-006', 'Pekerjaan Fabrikasi Pengelasan di Workshop', 'Plant & Maintenance',
    'Percikan bunga api las mengenai ceceran oli/majun kotor',
    'Kebakaran area workshop dan luka bakar pada welder',
    3, 3, 9, 'MEDIUM',
    '[
        {"type": "ENGINEERING", "description": "Pemasangan partisi tahan api (welding screen) dan pembersihan area radius 10 meter"},
        {"type": "ADMINISTRATIVE", "description": "PTW Hot Work, 1 unit APAR 6kg standby dalam jarak 3 meter, inspeksi 30 menit pasca kerja"},
        {"type": "PPE", "description": "Kedok las otomatis, sarung tangan las kulit panjang, apron kulit"}
    ]'::jsonb,
    1, 2, 2, 'LOW',
    'Dedi Pratama, ST (Workshop Foreman)', '2026-12-15', 'ACTIVE'
)
ON CONFLICT DO NOTHING;
