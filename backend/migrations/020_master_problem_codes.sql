BEGIN;

-- =========================================================
-- 020 — PARAMETER PROBLEM PRODUCTIVITY
-- =========================================================
-- Master kode problem operasional tambang, dikelompokkan dalam
-- 5 kategori: MACHINE, MAN, METHOD, MATERIAL, ENVIRO.
-- Konsep sama dengan master_job_codes (referensi awal, dapat
-- disesuaikan dengan standar perusahaan).
-- =========================================================

CREATE TABLE IF NOT EXISTS master_problem_codes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kategori      VARCHAR(20) NOT NULL,
    kode          VARCHAR(20) NOT NULL UNIQUE,
    problem       VARCHAR(200) NOT NULL,
    is_reference  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_problem_codes_kategori ON master_problem_codes (kategori);

INSERT INTO master_problem_codes (kategori, kode, problem, is_reference) VALUES
  ('MACHINE','PF01','Engine low power',TRUE),
  ('MACHINE','PF02','Teeth bucket tumpul',TRUE),
  ('MACHINE','PF03','Track problem',TRUE),
  ('MACHINE','PRO1','DT kurang karena BD > plan',TRUE),
  ('MACHINE','PRO2','DT refueling',TRUE),
  ('MACHINE','PRO3','DT habis fuel',TRUE),
  ('MACHINE','PD01','Dozer didisposal BD',TRUE),
  ('MACHINE','PD02','Dozer under dumping capacity',TRUE),

  ('MAN','PF21','Operator baru (orientasi)',TRUE),
  ('MAN','PF22','Operator baru (naik class)',TRUE),
  ('MAN','PR21','Driver DT cek fatigue',TRUE),
  ('MAN','PR22','Driver DT fatigue',TRUE),
  ('MAN','PR23','Driver DT sholat',TRUE),
  ('MAN','PR24','Driver DT ke toilet (ganggu putaran)',TRUE),
  ('MAN','PR25','DT over rest (telat balik ke front)',TRUE),
  ('MAN','PR26','DT no driver (pengaturan awal shift)',TRUE),
  ('MAN','PR27','DT no driver (sakit atau izin sesuai peraturan)',TRUE),
  ('MAN','PR28','Driver DT baru (orientasi)',TRUE),
  ('MAN','PR29','Driver DT baru (naik class)',TRUE),
  ('MAN','PD21','Tidak ada dumpman',TRUE),

  ('METHOD','PF41','Top loading',TRUE),
  ('METHOD','PF42','Back loading',TRUE),
  ('METHOD','PF43','Double bench loading',TRUE),
  ('METHOD','PF44','Coal expose',TRUE),
  ('METHOD','PF45','V-cut',TRUE),
  ('METHOD','PF46','Finalisasi design',TRUE),
  ('METHOD','PF47','Mengawali front',TRUE),
  ('METHOD','PF48','Progress lowest point',TRUE),
  ('METHOD','PR41','Jalan crowded (ada alat BD dijalan)',TRUE),
  ('METHOD','PR42','Jalan crowded (pekerjaan maintenance)',TRUE),

  ('MATERIAL','PF61','Material keras non blasting',TRUE),
  ('MATERIAL','PF62','Material keras ripping',TRUE),
  ('MATERIAL','PF63','Material keras blasting layer 1',TRUE),
  ('MATERIAL','PF64','Material keras blasting layer 2',TRUE),
  ('MATERIAL','PF65','Material keras expose',TRUE),
  ('MATERIAL','PF66','Material keras floor',TRUE),
  ('MATERIAL','PF67','Material keras final design',TRUE),
  ('MATERIAL','PF68','Material tipis',TRUE),
  ('MATERIAL','PF69','Material sisipan (geologi)',TRUE),
  ('MATERIAL','PF70','Material boulder',TRUE),
  ('MATERIAL','PF71','Material lembek/lengket',TRUE),
  ('MATERIAL','PR61','DT kerok vessel (material lengket)',TRUE),

  ('ENVIRO','PF81','Front lembek/berair',TRUE),
  ('ENVIRO','PF82','Front sempit (geometri)',TRUE),
  ('ENVIRO','PF83','Front undulating',TRUE),
  ('ENVIRO','PF84','Front crowded',TRUE),
  ('ENVIRO','PR81','Jalan undulating',TRUE),
  ('ENVIRO','PR82','Jalan sempit',TRUE),
  ('ENVIRO','PR83','Jalan licin (penyiraman)',TRUE),
  ('ENVIRO','PR84','Jalan licin (pasca hujan)',TRUE),
  ('ENVIRO','PR85','Jalan licin (material lembek tumpah)',TRUE),
  ('ENVIRO','PR86','Jalan lembek/basah',TRUE),
  ('ENVIRO','PR87','Jalan berdebu',TRUE),
  ('ENVIRO','PR88','Jalan berkabut',TRUE),
  ('ENVIRO','PR89','Jalan crowded (persimpangan)',TRUE),
  ('ENVIRO','PR90','Jalan overgrade (>10%)',TRUE),
  ('ENVIRO','PD81','Disposal sempit (geometri)',TRUE),
  ('ENVIRO','PD82','Disposal undulating',TRUE),
  ('ENVIRO','PD83','Disposal lembek/berair',TRUE)
ON CONFLICT (kode) DO NOTHING;

COMMIT;
