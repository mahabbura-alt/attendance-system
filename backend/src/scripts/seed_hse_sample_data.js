'use strict';

require('dotenv').config();
const { pool } = require('../config/db');

async function seed() {
  const adminRes = await pool.query("SELECT id, nama FROM users WHERE role = 'admin' LIMIT 1");
  const admin = adminRes.rows[0] || { id: null, nama: 'Admin HSE' };

  const locsRes = await pool.query("SELECT id, code, name FROM hse_locations WHERE tenant_key='default'");
  const locMap = Object.fromEntries(locsRes.rows.map(l => [l.code, l]));

  const catsRes = await pool.query("SELECT id, code, label FROM hse_categories WHERE tenant_key='default'");
  const catMap = Object.fromEntries(catsRes.rows.map(c => [c.code, c]));

  // Cek apakah hazard sudah ada
  const countRes = await pool.query("SELECT count(*)::int as c FROM hazard_reports WHERE tenant_key='default'");
  if (countRes.rows[0].c > 0) {
    console.log('Hazard reports already seeded, skipping hazard insert.');
  } else {
    console.log('Seeding initial HSE Phase 1 data...');

  const hazards = [
    // 1 EXTREME
    { no: 'HZD-2610-001', date: '2026-10-07', loc: 'PIT-2', cat: 'EQUIP', desc: 'Retakan lereng aktif selebar 20 cm di atas area kerja Excavator EX-201, potensi longsor fatal batuan pit', l: 4, c: 5, score: 20, lvl: 'EXTREME', st: 'IN_ACTION' },
    // 4 HIGH
    { no: 'HZD-2610-002', date: '2026-10-06', loc: 'HAUL-KM2', cat: 'ROAD', desc: 'Safety berm (tanggul pengaman) amblas sepanjang 20 meter pada tikungan menurun KM 2.8', l: 4, c: 4, score: 16, lvl: 'HIGH', st: 'IN_ACTION' },
    { no: 'HZD-2610-003', date: '2026-10-05', loc: 'WSHOP-01', cat: 'ELEC', desc: 'Kabel utama power distribution genset 500 kVA terkelupas dan terendam genangan air bay 3', l: 3, c: 4, score: 12, lvl: 'HIGH', st: 'IN_ACTION' },
    { no: 'HZD-2610-004', date: '2026-10-04', loc: 'GUDANG-B3', cat: 'CHEMICAL', desc: 'Pipa penyalur solar tangki timbun 20.000 L mengalami kebocoran pada sambungan flange', l: 4, c: 3, score: 12, lvl: 'HIGH', st: 'IN_ACTION' },
    { no: 'HZD-2610-005', date: '2026-10-03', loc: 'WSHOP-01', cat: 'HEIGHT', desc: 'Tangga perancah (scaffolding) perawatan dump truck tidak memiliki safety pin dan handrail goyang', l: 3, c: 4, score: 12, lvl: 'HIGH', st: 'ASSESSED' },
    // 8 MEDIUM
    { no: 'HZD-2610-006', date: '2026-10-08', loc: 'PIT-1', cat: 'ROAD', desc: 'Jalan hauling licin berlumpur tebal setelah hujan lebat, grader belum masuk grading', l: 3, c: 3, score: 9, lvl: 'MEDIUM', st: 'NEW' },
    { no: 'HZD-2610-007', date: '2026-10-07', loc: 'WSHOP-01', cat: 'HOUSEKEEP', desc: 'Tumpahan oli pelumas SAE 40 di lantai workshop dekat kompresor belum dibersihkan', l: 3, c: 2, score: 6, lvl: 'MEDIUM', st: 'NEW' },
    { no: 'HZD-2610-008', date: '2026-10-06', loc: 'DISP-TIMUR', cat: 'ROAD', desc: 'Lampu penerangan tower light disposal mati 2 bohlam pada shift malam', l: 2, c: 3, score: 6, lvl: 'MEDIUM', st: 'IN_ACTION' },
    { no: 'HZD-2610-009', date: '2026-10-05', loc: 'PIT-2', cat: 'EQUIP', desc: 'Kaca spion blind spot kiri Dump Truck DT-108 pecah belum diganti', l: 3, c: 2, score: 6, lvl: 'MEDIUM', st: 'ASSESSED' },
    { no: 'HZD-2610-010', date: '2026-10-04', loc: 'HAUL-KM2', cat: 'ROAD', desc: 'Rambu peringatan batas kecepatan 40 km/jam roboh tertabrak ranting pohon', l: 3, c: 2, score: 6, lvl: 'MEDIUM', st: 'VERIFY' },
    { no: 'HZD-2610-011', date: '2026-10-03', loc: 'GUDANG-B3', cat: 'CHEMICAL', desc: 'Label penandaan limbah B3 pada drum oli bekas pudar terkena panas matahari', l: 2, c: 3, score: 6, lvl: 'MEDIUM', st: 'ASSESSED' },
    { no: 'HZD-2610-012', date: '2026-10-02', loc: 'OFFICE-DKC', cat: 'ELEC', desc: 'Sambungan stop kontak over-capacity pada ruang radio dispatch', l: 3, c: 2, score: 6, lvl: 'MEDIUM', st: 'IN_ACTION' },
    { no: 'HZD-2610-013', date: '2026-10-01', loc: 'PIT-1', cat: 'ENV', desc: 'Sediment trap kolam pengendapan lumpur pit 1 mulai penuh sedimentasi', l: 3, c: 2, score: 6, lvl: 'MEDIUM', st: 'ASSESSED' },
    // 5 LOW
    { no: 'HZD-2610-014', date: '2026-10-08', loc: 'OFFICE-DKC', cat: 'HOUSEKEEP', desc: 'Kotak P3K koridor kantor kassa steril menipis', l: 2, c: 1, score: 2, lvl: 'LOW', st: 'NEW' },
    { no: 'HZD-2610-015', date: '2026-10-07', loc: 'WSHOP-01', cat: 'HOUSEKEEP', desc: 'Tempat sampah besi scrub di luar workshop tidak tertutup', l: 1, c: 2, score: 2, lvl: 'LOW', st: 'NEW' },
    { no: 'HZD-2610-016', date: '2026-10-06', loc: 'PIT-1', cat: 'OTHER', desc: 'Tali bendera patok batas elevasi bench tambang putus', l: 1, c: 2, score: 2, lvl: 'LOW', st: 'VERIFY' },
    { no: 'HZD-2610-017', date: '2026-10-05', loc: 'HAUL-KM2', cat: 'OTHER', desc: 'Pita reflektif rambu penunjuk arah pit 1 mulai kusam', l: 2, c: 1, score: 2, lvl: 'LOW', st: 'NEW' },
    { no: 'HZD-2610-018', date: '2026-10-04', loc: 'GUDANG-B3', cat: 'HOUSEKEEP', desc: 'Sapu dan alat pembersih ceceran di TPS B3 diletakkan tidak pada raknya', l: 1, c: 2, score: 2, lvl: 'LOW', st: 'ASSESSED' },
  ];

  for (const h of hazards) {
    const loc = locMap[h.loc] || { id: null, name: h.loc };
    const cat = catMap[h.cat] || { id: null, label: h.cat };
    await pool.query(`
      INSERT INTO hazard_reports (
        tenant_key, project_key, report_no, report_date, report_time,
        location_id, location_name, category_id, category_name,
        description, likelihood, consequence, risk_score, risk_level,
        status, assigned_to, assigned_to_name, created_by
      ) VALUES (
        'default', 'default', $1, $2, '09:00:00',
        $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $13
      )
    `, [
      h.no, h.date, loc.id, loc.name, cat.id, cat.label,
      h.desc, h.l, h.c, h.score, h.lvl,
      h.st, admin.id, admin.nama,
    ]);
  }

  // Ambil ID hazard untuk menghubungkan CAPA
  const hz1Res = await pool.query("SELECT id FROM hazard_reports WHERE report_no = 'HZD-2610-001'");
  const hz1Id = hz1Res.rows[0]?.id;
  const hz2Res = await pool.query("SELECT id FROM hazard_reports WHERE report_no = 'HZD-2610-002'");
  const hz2Id = hz2Res.rows[0]?.id;
  const hz3Res = await pool.query("SELECT id FROM hazard_reports WHERE report_no = 'HZD-2610-003'");
  const hz3Id = hz3Res.rows[0]?.id;

  const actions = [
    // 2 OVERDUE
    { no: 'CAPA-2610-001', srcId: hz2Id, desc: 'Timbun dan padatkan ulang tanggul pengaman haul road KM 2.8 dengan material kompak', pic: admin.nama, due: '2026-10-07', st: 'OPEN' },
    { no: 'CAPA-2610-002', srcId: hz3Id, desc: 'Ganti instalasi kabel power genset dengan tipe armoring submersible dan pasang ELCB', pic: admin.nama, due: '2026-10-06', st: 'OPEN' },
    // In progress
    { no: 'CAPA-2610-003', srcId: hz1Id, desc: 'Evakuasi unit EX-201, pasang barikade radius bahaya 50 meter dan pasang patok ekstensiometer', pic: admin.nama, due: '2026-10-12', st: 'IN_PROGRESS' },
  ];

  for (const a of actions) {
    await pool.query(`
      INSERT INTO hse_actions (
        tenant_key, project_key, action_no, source_type, source_id,
        description, action_type, pic_employee_id, pic_name, due_date,
        status, created_by
      ) VALUES (
        'default', 'default', $1, 'HAZARD', $2,
        $3, 'CORRECTIVE', $4, $5, $6,
        $7, $4
      )
    `, [a.no, a.srcId, a.desc, admin.id, a.pic, a.due, a.st]);
  }

    console.log('Seeding HSE initial data completed successfully!');
  }

  // Fase 2: Seed sample incidents if none exist
  const incCountRes = await pool.query("SELECT count(*)::int as c FROM incidents WHERE tenant_key='default'");
  if (incCountRes.rows[0].c === 0) {
    console.log('Seeding Fase 2 Incidents & Investigations...');
    const pit2Loc = locMap['PIT-2'] || { id: null, name: 'Pit 2 North' };
    const pit1Loc = locMap['PIT-1'] || { id: null, name: 'Pit 1 South' };
    const wshopLoc = locMap['WSHOP-01'] || { id: null, name: 'Main Workshop' };
    const haulLoc = locMap['HAUL-KM2'] || { id: null, name: 'Haul Road KM 2-4' };
    const dispLoc = locMap['DISP-TIMUR'] || { id: null, name: 'Disposal Area Timur' };

    const sampleIncidents = [
      // 1 MTI
      {
        no: 'INC-2610-001', type: 'MTI', date: '2026-10-02 14:15:00', loc: wshopLoc, dept: 'Plant / Workshop',
        desc: 'Mekanik mengalami cedera jepit pada jari telunjuk kanan saat menyetel bracket alternator unit DT-104.',
        actual: 'MODERATE', potential: 'MODERATE', loss: 2500000, status: 'INVESTIGATING',
        persons: [{ name: 'Budi Santoso', role: 'INJURED', injury: 'Crush / Laceration', part: 'Jari telunjuk kanan', treatment: 'MEDICAL', lost: 0 }],
        assets: [{ code: 'DT-104', name: 'Dump Truck CAT 777D', desc: 'Tidak ada kerusakan unit', cost: 0 }]
      },
      // 3 FAI
      {
        no: 'INC-2610-002', type: 'FAI', date: '2026-10-05 09:30:00', loc: pit1Loc, dept: 'Mining Operation',
        desc: 'Operator tergores kawat sling pada sarung tangan saat memasang shackle hook, luka lecet ringan.',
        actual: 'MINOR', potential: 'MINOR', loss: 0, status: 'CLOSED',
        persons: [{ name: 'Ahmad Fauzi', role: 'INJURED', injury: 'Scratch / Abrasion', part: 'Telapak tangan kiri', treatment: 'FIRST_AID', lost: 0 }],
        assets: []
      },
      {
        no: 'INC-2610-003', type: 'FAI', date: '2026-09-28 11:20:00', loc: haulLoc, dept: 'Civil / Road Maintenance',
        desc: 'Pekerja terkena partikel debu halus pada mata kanan saat membersihkan drainase jalan hauling.',
        actual: 'MINOR', potential: 'MINOR', loss: 0, status: 'CLOSED',
        persons: [{ name: 'Rian Pratama', role: 'INJURED', injury: 'Foreign Object in Eye', part: 'Mata kanan', treatment: 'FIRST_AID', lost: 0 }],
        assets: []
      },
      {
        no: 'INC-2610-004', type: 'FAI', date: '2026-09-15 16:40:00', loc: pit2Loc, dept: 'Mining Operation',
        desc: 'Operator tergelincir di tangga akses cabin excavator EX-203 saat hujan gerimis, pergelangan kaki terkilir ringan.',
        actual: 'MINOR', potential: 'MODERATE', loss: 0, status: 'CLOSED',
        persons: [{ name: 'Hendra Gunawan', role: 'INJURED', injury: 'Sprain', part: 'Pergelangan kaki kanan', treatment: 'FIRST_AID', lost: 0 }],
        assets: []
      },
      // 2 PROPERTY DAMAGE
      {
        no: 'INC-2610-005', type: 'PROPERTY_DAMAGE', date: '2026-10-06 18:45:00', loc: pit2Loc, dept: 'Hauling',
        desc: 'DT-112 menyenggol safety berm saat manuver mundur di area loading point karena blind spot dan minim penerangan.',
        actual: 'MODERATE', potential: 'MAJOR', loss: 18500000, status: 'ACTION',
        persons: [],
        assets: [{ code: 'DT-112', name: 'Scania R620 Tipper', desc: 'Bumper belakang penyok dan lampu stop pecah', cost: 18500000 }]
      },
      {
        no: 'INC-2610-006', type: 'PROPERTY_DAMAGE', date: '2026-09-22 08:10:00', loc: haulLoc, dept: 'Hauling',
        desc: 'Ban posisi 3 Dump Truck DT-105 robek terkena pecahan batuan tajam yang jatuh dari muatan unit sebelumnya.',
        actual: 'MODERATE', potential: 'MODERATE', loss: 35000000, status: 'CLOSED',
        persons: [],
        assets: [{ code: 'DT-105', name: 'Komatsu HD785-7', desc: 'Tyre radial 27.00R49 robek sidewall', cost: 35000000 }]
      },
      // 9 NEAR MISS
      { no: 'INC-2610-007', type: 'NEAR_MISS', date: '2026-10-08 10:15:00', loc: haulLoc, dept: 'Hauling', desc: 'Dua dump truck hampir bersenggolan di persimpangan KM 3 karena komunikasi radio channel 2 overload.', actual: 'MINOR', potential: 'MAJOR', loss: 0, status: 'INVESTIGATING', persons: [], assets: [] },
      { no: 'INC-2610-008', type: 'NEAR_MISS', date: '2026-10-07 15:30:00', loc: pit1Loc, dept: 'Mining Operation', desc: 'Bongkahan boulder meluncur dari crest bench atas, berhenti 3 meter sebelum track Dozer DZ-101.', actual: 'MINOR', potential: 'MAJOR', loss: 0, status: 'ACTION', persons: [], assets: [] },
      { no: 'INC-2610-009', type: 'NEAR_MISS', date: '2026-10-04 20:00:00', loc: dispLoc, dept: 'Mining Operation', desc: 'Unit DT mundur mendekati bibir disposal tanpa panduan guide lamp tower light yang mati.', actual: 'MINOR', potential: 'MAJOR', loss: 0, status: 'CLOSED', persons: [], assets: [] },
      { no: 'INC-2610-010', type: 'NEAR_MISS', date: '2026-10-01 07:45:00', loc: haulLoc, dept: 'Civil / Road', desc: 'Mobil LV melintas mendahului Grader di tikungan blind spot KM 1.5 tanpa klakson konfirmasi.', actual: 'MINOR', potential: 'MAJOR', loss: 0, status: 'CLOSED', persons: [], assets: [] },
      { no: 'INC-2610-011', type: 'NEAR_MISS', date: '2026-09-29 13:10:00', loc: wshopLoc, dept: 'Plant / Workshop', desc: 'Tali webbing sling crane overhead 5T terpasang miring pada engine stand, nyaris slip.', actual: 'MINOR', potential: 'MAJOR', loss: 0, status: 'CLOSED', persons: [], assets: [] },
      { no: 'INC-2610-012', type: 'NEAR_MISS', date: '2026-09-25 16:00:00', loc: pit2Loc, dept: 'Drill & Blast', desc: 'Kabel blasting wire terinjak ban LV operasional di perimeter batas isolasi blasting.', actual: 'MINOR', potential: 'MAJOR', loss: 0, status: 'CLOSED', persons: [], assets: [] },
      { no: 'INC-2610-013', type: 'NEAR_MISS', date: '2026-09-18 22:30:00', loc: haulLoc, dept: 'Hauling', desc: 'Dump truck mengalami penurunan tekanan rem angin di turunan KM 2, pengemudi berhasil masuk emergency escape ramp.', actual: 'MINOR', potential: 'CATASTROPHIC', loss: 0, status: 'CLOSED', persons: [], assets: [] },
      { no: 'INC-2610-014', type: 'NEAR_MISS', date: '2026-09-10 11:00:00', loc: wshopLoc, dept: 'Supply Chain', desc: 'Forklift 3T memindahkan palet drum oli yang tidak diikat, 1 drum hampir terjatuh saat belok.', actual: 'MINOR', potential: 'MODERATE', loss: 0, status: 'CLOSED', persons: [], assets: [] },
      { no: 'INC-2610-015', type: 'NEAR_MISS', date: '2026-09-04 14:20:00', loc: pit1Loc, dept: 'Mining Operation', desc: 'Kabel pompa submersible dewatering terbelit rantai jangkar ponton saat debit air naik mendadak.', actual: 'MINOR', potential: 'MODERATE', loss: 0, status: 'CLOSED', persons: [], assets: [] },
    ];

    for (const item of sampleIncidents) {
      const insRes = await pool.query(`
        INSERT INTO incidents (
          tenant_key, project_key, incident_no, incident_type, occurred_at,
          location_id, location_name, department_name, description,
          actual_severity, potential_severity, estimated_loss, status,
          reported_by, reported_by_name, created_by
        ) VALUES (
          'default', 'default', $1, $2, $3,
          $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $12
        ) RETURNING id
      `, [
        item.no, item.type, item.date,
        item.loc.id, item.loc.name, item.dept, item.desc,
        item.actual, item.potential, item.loss, item.status,
        admin.id, admin.nama
      ]);

      const incId = insRes.rows[0].id;

      for (const p of item.persons) {
        await pool.query(`
          INSERT INTO incident_persons (
            tenant_key, project_key, incident_id, person_name,
            role_in_incident, injury_type, body_part, treatment, lost_days
          ) VALUES ('default', 'default', $1, $2, $3, $4, $5, $6, $7)
        `, [incId, p.name, p.role, p.injury, p.part, p.treatment, p.lost]);
      }

      for (const a of item.assets) {
        await pool.query(`
          INSERT INTO incident_assets (
            tenant_key, project_key, incident_id, asset_code,
            asset_name, damage_description, repair_cost
          ) VALUES ('default', 'default', $1, $2, $3, $4, $5)
        `, [incId, a.code, a.name, a.desc, a.cost]);
      }

      // Add 5-Why investigation to INC-2610-001 (MTI)
      if (item.no === 'INC-2610-001') {
        const rootCauses = [
          { why: 1, question: 'Mengapa jari mekanik terjepit bracket alternator?', answer: 'Tangan mekanik menahan alternator saat baut pengunci dikendorkan rekan kerja.' },
          { why: 2, question: 'Mengapa alternator ditahan manual tanpa alat bantu?', answer: 'Peralatan lifting jack alternator portabel sedang dipakai di bay lain.' },
          { why: 3, question: 'Mengapa mekanik tidak menunggu lifting jack tersedia?', answer: 'Target breakdown unit harus keluar sebelum pergantian shift 17:00.' },
          { why: 4, question: 'Mengapa rekan kerja mengendorkan baut tanpa aba-aba?', answer: 'Kurang komunikasi verbal dan tidak ada SOP tandem kerja di area sempit alternator.' },
          { why: 5, question: 'Mengapa tidak ada SOP tandem dan JSEA belum ditinjau?', answer: 'JSEA belum diperbarui untuk prosedur penggantian alternator tipe heavy duty CAT 777D.' }
        ];

        await pool.query(`
          INSERT INTO incident_investigations (
            tenant_key, project_key, incident_id, method, lead_id, lead_name,
            team_members, immediate_cause, root_causes, findings, lessons_learned,
            started_at, status
          ) VALUES (
            'default', 'default', $1, 'FIVE_WHY', $2, $3,
            $4, $5, $6::jsonb, $7, $8,
            '2026-10-03 08:00:00', 'OPEN'
          )
        `, [
          incId, admin.id, admin.nama,
          'Suryadi (Workshop Foreman), Anton (Safety Officer)',
          'Tangan memegang komponen berat yang tidak tertumpu secara mekanis saat baut pengencang dilepas.',
          JSON.stringify(rootCauses),
          'Keterbatasan tools lifting khusus alternator; JSEA pekerjaan alternator belum mendetailkan risiko pinch point.',
          'Pekerjaan komponen bermassa >15 kg wajib menggunakan penyangga mekanis dan JSEA terverifikasi pengawas.'
        ]);

        // Connect a CAPA for this incident
        await pool.query(`
          INSERT INTO hse_actions (
            tenant_key, project_key, action_no, source_type, source_id,
            description, action_type, pic_employee_id, pic_name, due_date,
            status, created_by
          ) VALUES (
            'default', 'default', 'CAPA-2610-004', 'INCIDENT', $1,
            'Pengadaan 2 unit hydraulic bracket jack khusus alternator dan revisi JSEA pekerjaan engine bay CAT 777D',
            'CORRECTIVE', $2, $3, '2026-10-15', 'OPEN', $2
          ) ON CONFLICT (tenant_key, project_key, action_no) DO UPDATE SET
            source_id = EXCLUDED.source_id,
            source_type = EXCLUDED.source_type,
            description = EXCLUDED.description,
            updated_at = CURRENT_TIMESTAMP
        `, [incId, admin.id, admin.nama]);
      }
    }
    console.log('Seeding Fase 2 Incidents completed!');
  }

  // Fase 3: Seed Competency data (Requirements, Licenses, Training records, Inductions, Safety talks)
  const licCountRes = await pool.query("SELECT count(*)::int as c FROM hse_employee_licenses WHERE tenant_key='default'");
  if (licCountRes.rows[0].c === 0) {
    console.log('Seeding Fase 3 Competency (Pelatihan, Lisensi/SIMPER, Induksi, Safety Talk)...');
    const coursesRes = await pool.query("SELECT id, code FROM hse_training_courses WHERE tenant_key='default'");
    const courseMap = Object.fromEntries(coursesRes.rows.map(c => [c.code, c.id]));

    // 1. Requirements
    const reqs = [
      { pos: 'Operator', code: 'TR-IND-01', mandatory: true },
      { pos: 'Operator', code: 'TR-DDT-01', mandatory: true },
      { pos: 'Operator', code: 'TR-WAH-01', mandatory: false },
      { pos: 'Driver DT', code: 'TR-IND-01', mandatory: true },
      { pos: 'Driver DT', code: 'TR-DDT-01', mandatory: true },
      { pos: 'Mekanik', code: 'TR-IND-01', mandatory: true },
      { pos: 'Mekanik', code: 'TR-LOTO-01', mandatory: true },
      { pos: 'Mekanik', code: 'TR-WAH-01', mandatory: true },
      { pos: 'Foreman', code: 'TR-IND-01', mandatory: true },
      { pos: 'Foreman', code: 'TR-FA-01', mandatory: true },
      { pos: 'Foreman', code: 'TR-ENV-01', mandatory: true },
    ];

    for (const r of reqs) {
      if (courseMap[r.code]) {
        await pool.query(`
          INSERT INTO hse_training_requirements (tenant_key, project_key, position_name, course_id, is_mandatory)
          VALUES ('default', 'default', $1, $2, $3)
          ON CONFLICT (tenant_key, project_key, position_name, course_id) DO NOTHING
        `, [r.pos, courseMap[r.code], r.mandatory]);
      }
    }

    // Ambil sampel karyawan
    const usersRes = await pool.query("SELECT id, nama, jabatan FROM users WHERE role != 'admin' LIMIT 6");
    const employees = usersRes.rows;

    if (employees.length >= 2) {
      const e1 = employees[0]; // Antonius Panjaitan
      const e2 = employees[1]; // Sirot Zul Mukminin
      const e3 = employees[2] || employees[0]; // Amriyanto
      const e4 = employees[3] || employees[1]; // Enday / Wiji

      // 2. Licenses (SIMPER / SIO)
      const sampleLicenses = [
        {
          empId: e2.id, type: 'SIMPER', no: 'SIMPER-26-0081', unit: 'Dump Truck Scania R620 / Volvo FMX',
          issuedBy: 'KTT Site JMB-DKC', issued: '2025-11-01', expiry: '2026-11-01', status: 'VALID',
          notes: 'Full permit operasional tambang'
        },
        {
          empId: e1.id, type: 'SIMPER', no: 'SIMPER-26-0042', unit: 'Excavator CAT 390D / PC1250',
          issuedBy: 'KTT Site JMB-DKC', issued: '2025-10-15', expiry: '2026-10-25', status: 'EXPIRING',
          notes: 'Masa berlaku tersisa < 30 hari, perlu perpanjangan'
        },
        {
          empId: e3.id, type: 'SIMPER', no: 'SIMPER-25-0911', unit: 'Dump Truck Hino 500 / Fuso Fighter',
          issuedBy: 'KTT Site JMB-DKC', issued: '2025-09-01', expiry: '2026-09-01', status: 'EXPIRED',
          notes: 'Kedaluwarsa - Tidak layak operasi (Unfit to operate)'
        },
        {
          empId: e4.id, type: 'SIO', no: 'SIO-OP-24892', unit: 'Mobile Crane 25 Ton Kemnaker Kelas II',
          issuedBy: 'Kemenaker RI', issued: '2024-05-20', expiry: '2027-05-20', status: 'VALID',
          notes: 'Sertifikasi Operator Alat Angkat Angkut'
        },
      ];

      for (const lic of sampleLicenses) {
        await pool.query(`
          INSERT INTO hse_employee_licenses (
            tenant_key, project_key, employee_id, license_type, license_no,
            class_or_unit, issued_by, issued_date, expiry_date, status, notes
          ) VALUES ('default', 'default', $1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (tenant_key, project_key, employee_id, license_type, license_no) DO NOTHING
        `, [lic.empId, lic.type, lic.no, lic.unit, lic.issuedBy, lic.issued, lic.expiry, lic.status, lic.notes]);
      }

      // 3. Training records
      if (courseMap['TR-IND-01']) {
        await pool.query(`
          INSERT INTO hse_training_records (tenant_key, project_key, employee_id, course_id, completed_date, score, result, valid_until, certificate_no)
          VALUES
            ('default', 'default', $1, $2, '2026-01-15', 92.5, 'PASSED', '2027-01-15', 'CERT-IND-26-011'),
            ('default', 'default', $3, $2, '2026-02-10', 88.0, 'PASSED', '2027-02-10', 'CERT-IND-26-028')
        `, [e1.id, courseMap['TR-IND-01'], e2.id]);
      }

      if (courseMap['TR-DDT-01']) {
        await pool.query(`
          INSERT INTO hse_training_records (tenant_key, project_key, employee_id, course_id, completed_date, score, result, valid_until, certificate_no)
          VALUES
            ('default', 'default', $1, $2, '2025-11-20', 95.0, 'PASSED', '2027-11-20', 'CERT-DDT-25-089')
        `, [e2.id, courseMap['TR-DDT-01']]);
      }

      // 4. Inductions
      const sampleInductions = [
        { type: 'EMPLOYEE', empId: e1.id, name: e1.nama, company: 'PT JMB-DKC', idNo: 'EMP-B2606', date: '2026-01-15', score: 92.5, result: 'PASSED', valid: '2027-01-15', inductor: admin.nama },
        { type: 'EMPLOYEE', empId: e2.id, name: e2.nama, company: 'PT JMB-DKC', idNo: 'EMP-B2510', date: '2026-02-10', score: 88.0, result: 'PASSED', valid: '2027-02-10', inductor: admin.nama },
        { type: 'CONTRACTOR', empId: null, name: 'Dedi Kurniawan', company: 'PT United Tractors Tbk', idNo: '3201992819280001', date: '2026-09-12', score: 85.0, result: 'PASSED', valid: '2027-03-12', inductor: admin.nama },
        { type: 'VISITOR', empId: null, name: 'Ir. Hendra Wijaya', company: 'Inspektur Tambang Dinas ESDM', idNo: '3171092801920002', date: '2026-10-04', score: 100.0, result: 'PASSED', valid: '2026-10-05', inductor: admin.nama },
      ];

      for (const ind of sampleInductions) {
        await pool.query(`
          INSERT INTO hse_inductions (
            tenant_key, project_key, person_type, employee_id, person_name,
            company_name, id_no, induction_date, test_score, result, valid_until, inductor_name
          ) VALUES ('default', 'default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [ind.type, ind.empId, ind.name, ind.company, ind.idNo, ind.date, ind.score, ind.result, ind.valid, ind.inductor]);
      }
    }

    // 5. Safety talks → event baru di hse_safetytalk_events (migrasi 090)
    const talks = [
      { date: '2026-10-08', topic: 'Waspada Kondisi Blind Spot Dump Truck Saat Manuver Mundur di Front Loading', ledBy: admin.nama, count: 5 },
      { date: '2026-10-07', topic: 'Penerapan Isolasi Energi LOTO Sebelum Masuk ke Ruang Mesin Unit HD', ledBy: admin.nama, count: 4 },
      { date: '2026-10-06', topic: 'Batas Kecepatan Haul Road Maksimal 40 km/jam Saat Kondisi Hujan Lebat', ledBy: admin.nama, count: 3 },
      { date: '2026-10-04', topic: 'Prosedur Menjaga Jarak Aman Beriringan Unit di Haul Road KM 2-4', ledBy: admin.nama, count: 5 },
      { date: '2026-10-02', topic: 'Kesiapan Tanggap Tumpahan Solar dan Pemilahan Limbah B3 Tambang', ledBy: admin.nama, count: 4 },
    ];

    const stShiftRes = await pool.query('SELECT id, nama_shift FROM shifts ORDER BY operational_start ASC LIMIT 1');
    const stShift = stShiftRes.rows[0];
    const stLocRes = await pool.query(`
      SELECT id, name FROM hse_locations
      WHERE tenant_key = 'default' AND is_active = TRUE AND deleted_at IS NULL
      ORDER BY (parent_id IS NOT NULL), name ASC LIMIT 1
    `);
    const stLoc = stLocRes.rows[0];
    const stEmpRes = await pool.query(`
      SELECT id, employee_id, nama, jabatan FROM users
      WHERE is_active = TRUE ORDER BY nama ASC LIMIT 8
    `);
    const stEmployees = stEmpRes.rows;

    if (stShift && stLoc && stEmployees.length > 0) {
      let stCounter = 1;
      for (const t of talks) {
        const yy = t.date.slice(2, 4);
        const mm = t.date.slice(5, 7);
        const evRes = await pool.query(`
          INSERT INTO hse_safetytalk_events (
            tenant_key, project_key, event_no, event_date, shift_id, shift_name,
            location_id, location_name, topics, led_by_ids, led_by_names, photos, created_by
          ) VALUES ('default', 'default', $1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', $10)
          RETURNING id
        `, [
          `STK-${yy}${mm}-${String(stCounter).padStart(3, '0')}`,
          t.date, stShift.id, stShift.nama_shift, stLoc.id, stLoc.name,
          [t.topic], [admin.id], [t.ledBy], admin.id,
        ]);
        stCounter += 1;
        const attendees = stEmployees.slice(0, Math.min(t.count, stEmployees.length));
        for (const emp of attendees) {
          await pool.query(`
            INSERT INTO hse_safetytalk_event_attendees (
              tenant_key, project_key, event_id, employee_id, employee_no, nama, jabatan
            ) VALUES ('default', 'default', $1, $2, $3, $4, $5)
          `, [evRes.rows[0].id, emp.id, emp.employee_id, emp.nama, emp.jabatan]);
        }
      }
    }

    console.log('Seeding Fase 3 Competency completed!');
  }

  // Fase 4: Seed Izin Kerja (PTW, LOTO, Handover) & Inspeksi Keselamatan
  const ptwCountRes = await pool.query("SELECT count(*)::int as c FROM hse_ptw_permits WHERE tenant_key='default'");
  if (ptwCountRes.rows[0].c === 0) {
    console.log('Seeding Fase 4 PTW (Izin Kerja, LOTO, Shift Handover) & Inspeksi...');

    // Ambil lokasi
    const locRes = await pool.query("SELECT id, name FROM hse_locations WHERE tenant_key='default'");
    const locMap = Object.fromEntries(locRes.rows.map(l => [l.name, l.id]));
    const wshopLoc = locMap['Main Workshop & Bay Tambang'] || locRes.rows[0]?.id;
    const pit1Loc = locMap['Pit 1 Selatan'] || locRes.rows[0]?.id;
    const haulLoc = locMap['Main Haul Road KM 2-4'] || locRes.rows[0]?.id;

    // Ambil karyawan
    const usersRes = await pool.query("SELECT id, nama, jabatan FROM users WHERE role != 'admin' LIMIT 6");
    const employees = usersRes.rows;
    const e1 = employees[0] || admin;
    const e2 = employees[1] || admin;
    const e3 = employees[2] || admin;

    // 1. PTW Permits
    const permits = [
      {
        no: 'PTW-2610-001', type: 'HOT_WORK', locId: wshopLoc, locName: 'Main Workshop & Bay Tambang',
        desc: 'Pengelasan chasis stabilizer dan penggantian liner dump box unit Dump Truck DT-104',
        company: 'PT Internal Site JMB-DKC', reqId: e1.id, reqName: e1.nama,
        from: '2026-10-09 08:00:00+07', until: '2026-10-09 17:00:00+07',
        status: 'ACTIVE', approver: admin.nama, approverId: admin.id, approvedAt: '2026-10-09 07:45:00+07',
        hazards: { fire_watch: true, gas_check: false, extinguisher_ready: true, ventilation: true, ppe: ['Welding Shield', 'Leather Gloves', 'Safety Boots'] }
      },
      {
        no: 'PTW-2610-002', type: 'CONFINED_SPACE', locId: wshopLoc, locName: 'Main Workshop & Bay Tambang',
        desc: 'Pembersihan endapan lumpur & inspeksi visual ketebalan plat tangki penampung solar Fuel Station T-01',
        company: 'PT Petro Tambang Mandiri', reqId: e2.id, reqName: e2.nama,
        from: '2026-10-09 10:00:00+07', until: '2026-10-09 14:00:00+07',
        status: 'SUBMITTED', approver: null, approverId: null, approvedAt: null,
        hazards: { gas_detector_calibrated: true, oxygen_level_ok: true, standby_person_ready: true, scba_available: true, harness_rescue: true }
      },
      {
        no: 'PTW-2610-003', type: 'WORK_AT_HEIGHT', locId: pit1Loc, locName: 'Pit 1 Selatan',
        desc: 'Perbaikan sensor inclinometer & penggantian lampu floodlight tower penerangan Pit 1 tinggi 14 meter',
        company: 'PT Internal Site JMB-DKC', reqId: e1.id, reqName: e1.nama,
        from: '2026-10-09 13:00:00+07', until: '2026-10-09 18:00:00+07',
        status: 'APPROVED', approver: admin.nama, approverId: admin.id, approvedAt: '2026-10-09 09:30:00+07',
        hazards: { full_body_harness_double_lanyard: true, lifeline_certified: true, scaffolding_green_tag: true, drop_zone_barricaded: true }
      },
      {
        no: 'PTW-2610-004', type: 'LOTO', locId: wshopLoc, locName: 'Main Workshop & Bay Tambang',
        desc: 'Overhaul transmisi utama dan penggantian pompa hidrolik utama Excavator EX-201',
        company: 'PT Internal Site JMB-DKC', reqId: e3.id, reqName: e3.nama,
        from: '2026-10-09 07:00:00+07', until: '2026-10-09 19:00:00+07',
        status: 'ACTIVE', approver: admin.nama, approverId: admin.id, approvedAt: '2026-10-09 06:50:00+07',
        hazards: { residual_energy_released: true, battery_disconnected: true, lock_tag_applied: true, keys_stored_lockbox: true }
      },
      {
        no: 'PTW-2610-005', type: 'EXCAVATION', locId: haulLoc, locName: 'Main Haul Road KM 2-4',
        desc: 'Penggalian paritan dan pemasangan pipa gorong-gorong baja crossing drainage Haul Road KM 3.2',
        company: 'PT Mitra Konstruksi Nusantara', reqId: e2.id, reqName: e2.nama,
        from: '2026-10-07 08:00:00+07', until: '2026-10-07 17:00:00+07',
        status: 'CLOSED', approver: admin.nama, approverId: admin.id, approvedAt: '2026-10-07 07:30:00+07',
        hazards: { underground_cable_survey: true, trench_shoring_installed: true, safety_berm_maintained: true },
        closedBy: admin.nama, closedById: admin.id, closedAt: '2026-10-07 17:15:00+07',
        closureNote: 'Pekerjaan gorong-gorong selesai, permukaan jalan dipadatkan kembali dan rambu normal.'
      }
    ];

    for (const p of permits) {
      const pRes = await pool.query(`
        INSERT INTO hse_ptw_permits (
          tenant_key, project_key, permit_no, permit_type, location_id, location_name,
          work_description, company_name, requested_by_id, requested_by_name,
          valid_from, valid_until, hazards_controls, status,
          approved_by_id, approved_by_name, approved_at,
          closed_by_id, closed_by_name, closed_at, closure_note
        ) VALUES (
          'default', 'default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        ) RETURNING id
      `, [
        p.no, p.type, p.locId, p.locName, p.desc, p.company, p.reqId, p.reqName,
        p.from, p.until, JSON.stringify(p.hazards), p.status,
        p.approverId, p.approver, p.approvedAt,
        p.closedById || null, p.closedBy || null, p.closedAt || null, p.closureNote || null
      ]);

      const permitId = pRes.rows[0].id;

      // Seed Workers untuk permit ini
      await pool.query(`
        INSERT INTO hse_ptw_workers (permit_id, employee_id, worker_name, position_name, competency_check, notes)
        VALUES
          ($1, $2, $3, $4, 'OK', 'Telah induksi dan memegang sertifikat relevan'),
          ($1, $5, $6, $7, 'OK', 'Telah lulus verifikasi JSEA di lokasi')
      `, [permitId, e1.id, e1.nama, e1.jabatan, e2.id, e2.nama, e2.jabatan]);

      // Seed LOTO jika permit berjenis HOT_WORK atau LOTO
      if (['HOT_WORK', 'LOTO'].includes(p.type)) {
        await pool.query(`
          INSERT INTO hse_ptw_isolations (permit_id, isolation_point, lock_no, applied_by_id, applied_by_name, applied_at, status)
          VALUES
            ($1, 'Main Battery Isolator Switch & Starter Motor', 'LOCK-WSHOP-014', $2, $3, '2026-10-09 07:15:00+07', 'LOCKED'),
            ($1, 'Hydraulic Pressure Relief Valve', 'LOCK-WSHOP-015', $2, $3, '2026-10-09 07:20:00+07', 'LOCKED')
        `, [permitId, e1.id, e1.nama]);
      }

      // Seed Handover untuk PTW-2610-001
      if (p.no === 'PTW-2610-001') {
        await pool.query(`
          INSERT INTO hse_ptw_handovers (permit_id, from_user_id, from_user_name, to_user_id, to_user_name, handover_at, checklist_verified, note)
          VALUES ($1, $2, $3, $4, $5, '2026-10-09 12:30:00+07', TRUE, 'Serah terima pengelasan istirahat siang, tabung oksigen & asetilen terkunci aman.')
        `, [permitId, e1.id, e1.nama, e3.id, e3.nama]);
      }
    }

    // 2. Inspeksi Keselamatan
    const tmplsRes = await pool.query("SELECT id, code, name FROM hse_inspection_templates WHERE tenant_key = 'default'");
    const tmpls = Object.fromEntries(tmplsRes.rows.map(t => [t.code, t]));

    const inspections = [
      {
        no: 'INSP-2610-001', tmplCode: 'TMPL-HD-01', locId: wshopLoc, locName: 'Main Workshop & Bay Tambang',
        obj: 'HD-021 (CAT 777D)', byId: admin.id, byName: admin.nama, at: '2026-10-08 07:30:00+07',
        status: 'COMPLETED', findings: 2, summary: 'Lampu rotary redup dan kaca spion kiri retak kecil, unit tetap aman operasi setelah penggantian bohlam.'
      },
      {
        no: 'INSP-2610-002', tmplCode: 'TMPL-LV-01', locId: pit1Loc, locName: 'Pit 1 Selatan',
        obj: 'LV-04 (Toyota Hilux 4x4)', byId: admin.id, byName: admin.nama, at: '2026-10-08 08:15:00+07',
        status: 'COMPLETED', findings: 0, summary: 'Seluruh sistem pengereman, buggy whip, radio komunikasi, dan APAR dalam kondisi prima.'
      },
      {
        no: 'INSP-2610-003', tmplCode: 'TMPL-APAR-01', locId: wshopLoc, locName: 'Main Workshop & Bay Tambang',
        obj: 'APAR-WSHOP-01 s/d APAR-WSHOP-06 (6 Unit Powder 6kg)', byId: admin.id, byName: admin.nama, at: '2026-10-07 10:00:00+07',
        status: 'COMPLETED', findings: 0, summary: 'Tekanan seluruh tabung di zona hijau, pin pengaman utuh dan segel resmi terpasang rapi.'
      },
      {
        no: 'INSP-2610-004', tmplCode: 'TMPL-WSHOP-01', locId: wshopLoc, locName: 'Main Workshop & Bay Tambang',
        obj: 'Workshop Bay 1-4 & TPS Limbah B3', byId: admin.id, byName: admin.nama, at: '2026-10-06 15:30:00+07',
        status: 'COMPLETED', findings: 1, summary: 'Ditemukan genangan ceceran pelumas di Bay 2 tanpa spill kit terdekat, diterbitkan CAPA perbaikan.'
      }
    ];

    for (const insp of inspections) {
      const tmpl = tmpls[insp.tmplCode];
      if (tmpl) {
        const inspRes = await pool.query(`
          INSERT INTO hse_inspections (
            tenant_key, project_key, inspection_no, template_id, template_name,
            location_id, location_name, object_identifier, inspected_by_id, inspected_by_name,
            inspected_at, status, result_summary, findings_count
          ) VALUES ('default', 'default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          insp.no, tmpl.id, tmpl.name, insp.locId, insp.locName, insp.obj,
          insp.byId, insp.byName, insp.at, insp.status, insp.summary, insp.findings
        ]);

        const inspId = inspRes.rows[0].id;

        // Ambil item template untuk mengisi jawaban
        const itemsRes = await pool.query("SELECT id, question, is_critical FROM hse_inspection_template_items WHERE template_id = $1 ORDER BY sort_order", [tmpl.id]);
        for (let i = 0; i < itemsRes.rows.length; i++) {
          const it = itemsRes.rows[i];
          const isFailed = insp.findings > 0 && i === 0;
          await pool.query(`
            INSERT INTO hse_inspection_answers (
              inspection_id, item_id, question, is_critical, answer, note
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            inspId, it.id, it.question, it.is_critical,
            isFailed ? 'NO' : 'YES',
            isFailed ? 'Memerlukan perbaikan segera' : 'Kondisi baik sesuai standar'
          ]);
        }
      }
    }

    console.log('Seeding Fase 4 PTW & Inspeksi completed!');
  }

  // Seeding Fase 5: Kesehatan Kerja (MCU, FFW, Tes Narkoba/Alkohol, Kasus Kesehatan, Higiene Industri)
  const mcuCount = await pool.query("SELECT count(*)::int as c FROM hse_mcu_records WHERE tenant_key='default'");
  if (mcuCount.rows[0].c > 0) {
    console.log('Fase 5 Occupational Health records already seeded, skipping.');
  } else {
    console.log('Seeding HSE Fase 5: Kesehatan Kerja...');

    const empsRes = await pool.query("SELECT id, nama, employee_id as nrp, jabatan FROM users LIMIT 10");
    const emps = empsRes.rows;
    const e1 = emps[0] || { id: admin.id, nama: 'Budi Mekanik', nrp: 'NRP-001', jabatan: 'Mekanik Tambang' };
    const e2 = emps[1] || { id: admin.id, nama: 'Agus Driver', nrp: 'NRP-002', jabatan: 'Driver DT' };
    const e3 = emps[2] || { id: admin.id, nama: 'Joko Operator', nrp: 'NRP-003', jabatan: 'Operator Excavator' };
    const e4 = emps[3] || { id: admin.id, nama: 'Siti Aminah', nrp: 'NRP-004', jabatan: 'Admin Safety' };

    // 1. MCU Records
    await pool.query(`
      INSERT INTO hse_mcu_records (
        tenant_key, project_key, employee_id, employee_name, employee_nrp, employee_position,
        mcu_type, mcu_date, provider, fitness_result, restrictions, valid_until, doctor_name, notes, created_by
      ) VALUES
      ('default', 'default', $1, $2, $3, $4, 'PERIODIC', '2026-03-12', 'RS Siloam Site Clinic', 'FIT', NULL, '2027-03-12', 'dr. Rian Sp.Ok', 'Kondisi fisik prima tanpa pembatasan.', $5),
      ('default', 'default', $6, $7, $8, $9, 'PERIODIC', '2025-11-02', 'Klinik Utama JMB-DKC', 'FIT_WITH_NOTES', 'Wajib menggunakan kacamata refraksi silinder saat operasional', '2026-11-02', 'dr. Maria Sp.Ok', 'Segera habis dalam waktu kurang dari 30 hari.', $5),
      ('default', 'default', $10, $11, $12, $13, 'PERIODIC', '2025-08-10', 'RSUD Muara Enim', 'TEMP_UNFIT', 'Hipertensi Grade II (160/100). Dilarang mengoperasikan alat berat sampai tekanan darah stabil.', '2026-08-10', 'dr. Hendra Sp.PD', 'Kedaluwarsa dan dinyatakan Unfit.', $5),
      ('default', 'default', $14, $15, $16, $17, 'PRE_EMPLOYMENT', '2026-06-01', 'Klinik Prodia Palembang', 'FIT', NULL, '2027-06-01', 'dr. Anita', 'MCU pra-kerja karyawan baru lengkap.', $5)
    `, [
      e1.id, e1.nama, e1.nrp, e1.jabatan, admin.id,
      e2.id, e2.nama, e2.nrp, e2.jabatan,
      e3.id, e3.nama, e3.nrp, e3.jabatan,
      e4.id, e4.nama, e4.nrp, e4.jabatan
    ]);

    // 2. Fit for Work (FFW) Pra-Shift Hari Ini
    await pool.query(`
      INSERT INTO hse_fit_for_work_checks (
        tenant_key, project_key, employee_id, employee_name, employee_nrp, employee_position,
        check_date, shift, sleep_hours, blood_pressure, heart_rate, body_temperature,
        self_declaration, result, action_taken, checked_by_name, notes
      ) VALUES
      ('default', 'default', $1, $2, $3, $4, CURRENT_DATE, 'SHIFT_1', 7.5, '120/80', 74, 36.5, '{"fatigue": false, "medication": false}'::jsonb, 'FIT', 'Layak operasional shift pagi', 'Paramedis Siti', 'Fit normal.'),
      ('default', 'default', $5, $6, $7, $8, CURRENT_DATE, 'SHIFT_1', 4.0, '135/90', 88, 36.8, '{"fatigue": true, "headache": true}'::jsonb, 'UNFIT', 'Tidur hanya 4 jam dan mengeluh pusing. Diistirahatkan 2 jam di klinik.', 'Paramedis Siti', 'Potensi microsleep tinggi, ditangguhkan.'),
      ('default', 'default', $9, $10, $11, $12, CURRENT_DATE, 'SHIFT_1', 6.5, '128/82', 78, 36.6, '{"fatigue": false, "medication": false}'::jsonb, 'FIT', 'Layak operasional shift pagi', 'Paramedis Siti', 'Kondisi baik.'),
      ('default', 'default', $13, $14, $15, $16, CURRENT_DATE, 'SHIFT_1', 7.0, '118/76', 72, 36.4, '{"fatigue": false, "medication": false}'::jsonb, 'FIT', 'Layak operasional shift pagi', 'Paramedis Siti', 'Fit.')
    `, [
      e1.id, e1.nama, e1.nrp, e1.jabatan,
      e2.id, e2.nama, e2.nrp, e2.jabatan,
      e3.id, e3.nama, e3.nrp, e3.jabatan,
      e4.id, e4.nama, e4.nrp, e4.jabatan
    ]);

    // 3. Tes Alkohol & Narkoba (Substance Tests)
    await pool.query(`
      INSERT INTO hse_substance_tests (
        tenant_key, project_key, employee_id, employee_name, employee_nrp, employee_position,
        test_date, test_type, trigger_reason, alcohol_level, drug_panel_result, overall_result,
        tested_by_name, witness_name, notes
      ) VALUES
      ('default', 'default', $1, $2, $3, $4, CURRENT_DATE, 'ALCOHOL', 'RANDOM', 0.000, 'NEGATIVE', 'NEGATIVE', 'dr. Maria Sp.Ok', 'Foreman Antonius', 'Hasil breathalyzer 0.00 mg/L (Negatif).'),
      ('default', 'default', $5, $6, $7, $8, CURRENT_DATE, 'DRUG', 'RANDOM', 0.000, 'NEGATIVE', 'NEGATIVE', 'dr. Maria Sp.Ok', 'Foreman Antonius', 'Skrining urine 6 parameter negatif THC, AMP, MAMP, MOP, BZO, COC.'),
      ('default', 'default', $9, $10, $11, $12, CURRENT_DATE - INTERVAL '1 day', 'BOTH', 'POST_INCIDENT', 0.000, 'NEGATIVE', 'NEGATIVE', 'dr. Rian Sp.Ok', 'HSE Officer Budi', 'Pemeriksaan pasca insiden Near Miss DT-785. Hasil negatif.')
    `, [
      e1.id, e1.nama, e1.nrp, e1.jabatan,
      e2.id, e2.nama, e2.nrp, e2.jabatan,
      e3.id, e3.nama, e3.nrp, e3.jabatan
    ]);

    // 4. Kasus Kesehatan Kerja (Health Cases)
    await pool.query(`
      INSERT INTO hse_health_cases (
        tenant_key, project_key, case_no, employee_id, employee_name, employee_nrp, employee_position,
        case_date, case_type, is_work_related, diagnosis_summary, treatment, lost_days, medic_name, status, notes
      ) VALUES
      ('default', 'default', 'MED-2610-001', $1, $2, $3, $4, '2026-10-05', 'COMPLAINT', false, 'Faringitis Akut & Flu Musiman', 'Pemberian antibiotik oral, paracetamol, istirahat 1 hari', 0, 'dr. Maria', 'CLOSED', 'Keluhan klinis membaik dan kembali bertugas.'),
      ('default', 'default', 'MED-2610-002', $5, $6, $7, $8, '2026-10-06', 'WORK_RELATED_INJURY', true, 'Vulnus Laceratum Ringan Digiti I Manus Dextra', 'Pembersihan luka steril, balut tekan, tetanus toxoid', 0, 'dr. Maria', 'CLOSED', 'Luka tergores plat saat perawatan bengkel. Telah sembuh.'),
      ('default', 'default', 'MED-2610-003', $9, $10, $11, $12, '2026-10-08', 'OCCUPATIONAL_DISEASE', true, 'Myalgia Lumbal Kronis (Suspek Penyakit Akibat Kerja Getaran Alat)', 'Rujuk fisioterapi RS rekanan, pemberian NSAID, evaluasi ergonomi jok operator', 2, 'dr. Rian Sp.Ok', 'MONITORING', 'Kasus dalam pemantauan tim medis site dan dokter spesialis okupasi.')
    `, [
      e1.id, e1.nama, e1.nrp, e1.jabatan,
      e2.id, e2.nama, e2.nrp, e2.jabatan,
      e3.id, e3.nama, e3.nrp, e3.jabatan
    ]);

    // 5. Higiene Industri (Industrial Hygiene Measurements)
    const wshopLocId = locMap['WSHOP-01']?.id || null;
    const pit1LocId = locMap['PIT-1']?.id || null;
    const pit2LocId = locMap['PIT-2']?.id || null;
    const officeLocId = locMap['OFFICE-DKC']?.id || null;
    const b3LocId = locMap['GUDANG-B3']?.id || null;

    await pool.query(`
      INSERT INTO hse_hygiene_measurements (
        tenant_key, project_key, location_id, location_name, sampling_point, parameter,
        measured_at, measured_value, unit, threshold_nab, status, instrument_used, measured_by, mitigation_required
      ) VALUES
      ('default', 'default', $1, 'Main Workshop & Bay Tambang', 'Bay 3 Area Fabrikasi & Bubut', 'NOISE', CURRENT_DATE, 88.50, 'dBA', 85.00, 'EXCEEDED', 'Sound Level Meter Extech', 'HSE Hygiene Inspector', 'Kebisingan melebihi NAB 85 dBA. Wajib menggunakan earmuff/earplug bagi seluruh teknisi.'),
      ('default', 'default', $2, 'Pit 1 Selatan', 'Front Loading Excavator EX-201', 'DUST', CURRENT_DATE, 2.10, 'mg/m3', 3.00, 'OK', 'Dust Sampler Haz-Dust', 'HSE Hygiene Inspector', 'Kondisi debu respirabel di bawah ambang batas 3 mg/m3.'),
      ('default', 'default', $3, 'Pit 2 Utara', 'Area Loading Malam Pit 2', 'LIGHTING', CURRENT_DATE, 45.00, 'Lux', 100.00, 'EXCEEDED', 'Lux Meter Lutron', 'HSE Hygiene Inspector', 'Penerangan kurang dari standar 100 Lux. Diperlukan penambahan 1 tower lamp pada front loading.'),
      ('default', 'default', $4, 'Kantor Utama Site JMB-DKC', 'Ruang Kontrol Dispatch & Radio', 'LIGHTING', CURRENT_DATE, 320.00, 'Lux', 300.00, 'OK', 'Lux Meter Lutron', 'HSE Hygiene Inspector', 'Penerangan optimal untuk ruang administrasi.'),
      ('default', 'default', $5, 'TPS Limbah B3 & Gudang Site', 'Ruang Penyimpanan B3 Tertutup', 'TEMPERATURE', CURRENT_DATE, 29.50, '°C', 28.00, 'NEAR_LIMIT', 'Heat Stress Meter Quest', 'HSE Hygiene Inspector', 'Suhu mendekati batas ISBB 28°C. Direkomendasikan perbaikan ventilasi atap.')
    `, [wshopLocId, pit1LocId, pit2LocId, officeLocId, b3LocId]);

    console.log('Seeding Fase 5 Kesehatan Kerja completed!');
  }

  // Fase 6: Seed Tanggap Darurat & APD / Peralatan
  const eqCountRes = await pool.query("SELECT count(*)::int as c FROM hse_emergency_equipment WHERE tenant_key='default'");
  if (eqCountRes.rows[0].c === 0) {
    console.log('Seeding Fase 6 Tanggap Darurat (ERT, Drills, Peralatan) & APD...');

    const locRes = await pool.query("SELECT id, name, code FROM hse_locations WHERE tenant_key='default'");
    const locMap = Object.fromEntries(locRes.rows.map(l => [l.name, l.id]));
    const wshopLoc = locMap['Main Workshop & Bay Tambang'] || locRes.rows[0]?.id;
    const pit1Loc = locMap['Pit 1 Selatan'] || locRes.rows[0]?.id;
    const officeLoc = locMap['Kantor Utama Site JMB-DKC'] || locRes.rows[0]?.id;
    const b3Loc = locMap['TPS Limbah B3 & Gudang Site'] || locRes.rows[0]?.id;

    const usersRes = await pool.query("SELECT id, nama, employee_id as nrp, jabatan FROM users WHERE role != 'admin' LIMIT 4");
    const uList = usersRes.rows;
    const u1 = uList[0] || admin;
    const u2 = uList[1] || admin;
    const u3 = uList[2] || admin;
    const u4 = uList[3] || admin;

    // 1. Tim Tanggap Darurat (ERT Members)
    await pool.query(`
      INSERT INTO hse_emergency_team_members (
        tenant_key, project_key, employee_id, employee_name, employee_nrp, department_name, position_name,
        role, certifications, shift, phone_no, is_active, notes, created_by
      ) VALUES
      ('default', 'default', $1, 'Rudi Hartono', 'EMP-003', 'HSE & Safety', 'HSE Superintendent', 'COMMANDER', 'Incident Command System, Fire Fighting Level 2', 'SHIFT_1', '0812-3456-7890', true, 'On-scene Commander', $5),
      ('default', 'default', $2, 'Budi Santoso', 'EMP-002', 'Plant & Maintenance', 'Lead Mechanic', 'FIRE_FIGHTER', 'Kemenaker Fire Class D, SCBA Certified', 'SHIFT_1', '0812-3456-7891', true, 'Attack team leader', $5),
      ('default', 'default', $3, 'Andi Saputra', 'EMP-001', 'Mining Operation', 'Foreman Produksi', 'RESCUE', 'Vehicle Extrication, High Angle Rescue', 'SHIFT_2', '0812-3456-7892', true, 'Rescue squad', $5),
      ('default', 'default', $4, 'Siti Aminah', 'EMP-004', 'Health & Safety', 'Paramedic Site', 'FIRST_AIDER', 'BTCLS, First Aider Tambang BNSP', 'SHIFT_1', '0812-3456-7893', true, 'Triage & medical response', $5)
    `, [u3.id, u2.id, u1.id, u4.id, admin.id]);

    // 2. Simulasi Tanggap Darurat (Drills)
    await pool.query(`
      INSERT INTO hse_emergency_drills (
        tenant_key, project_key, drill_no, drill_date, scenario, scenario_title, location_id, location_name,
        participant_count, response_time_sec, evaluation, result, created_by
      ) VALUES
      ('default', 'default', 'DRL-2610-001', '2026-09-15', 'FIRE', 'Simulasi Penanggulangan Kebakaran Bay Fabrikasi Workshop', $1, 'Main Workshop & Bay Tambang', 28, 210, 'Tim ERT merespon dalam 3,5 menit. Penggunaan APAR & hydrant bekerja lancar. Evakuasi tuntas.', 'GOOD', $3),
      ('default', 'default', 'DRL-2610-002', '2026-10-02', 'ROCKFALL', 'Simulasi Evakuasi dan Penyelamatan Operator Tertimpa Longsoran Pit 1', $2, 'Pit 1 Selatan', 35, 340, 'Respon komunikasi radio dispatch baik, namun waktu mobilisasi rescue kit medan terjal perlu ditingkatkan.', 'ADEQUATE', $3)
    `, [wshopLoc, pit1Loc, admin.id]);

    // 3. Peralatan Darurat (Emergency Equipment)
    await pool.query(`
      INSERT INTO hse_emergency_equipment (
        tenant_key, project_key, equipment_code, equipment_type, serial_no, location_id, location_name,
        capacity, last_inspection_date, next_inspection_date, content_expiry_date, status, inspector_name, notes, created_by
      ) VALUES
      ('default', 'default', 'APAR-WS-01', 'FIRE_EXTINGUISHER', 'FE-9921', $1, 'Main Workshop & Bay Tambang', '6 kg DCP', '2026-09-20', '2026-10-20', '2028-09-20', 'GOOD', 'Budi Santoso', 'Tekanan jarum hijau, segel utuh', $5),
      ('default', 'default', 'APAR-PIT-02', 'FIRE_EXTINGUISHER', 'FE-8842', $2, 'Pit 1 Selatan', '9 kg DCP', '2026-08-30', '2026-09-30', '2028-08-30', 'OVERDUE', 'Andi Saputra', 'Jatuh tempo inspeksi bulanan lewat 9 hari', $5),
      ('default', 'default', 'EYEWASH-B3', 'EYEWASH', 'EW-0012', $4, 'TPS Limbah B3 & Gudang Site', 'Portable 60L', '2026-09-25', '2026-10-25', '2027-03-25', 'GOOD', 'Siti Aminah', 'Aliran air bersih normal, debu tercover', $5),
      ('default', 'default', 'BOX-P3K-01', 'FIRST_AID_BOX', 'P3K-OF-01', $3, 'Kantor Utama Site JMB-DKC', 'Kotak Tipe B (50 Orang)', '2026-09-12', '2026-10-12', '2027-01-01', 'DUE', 'Siti Aminah', 'Inspeksi jatuh tempo dalam 3 hari, stok kasa perlu refill', $5),
      ('default', 'default', 'SPILL-KIT-01', 'SPILL_KIT', 'SK-WS-05', $1, 'Main Workshop & Bay Tambang', '50 Gallon Drum', '2026-10-01', '2026-11-01', NULL, 'GOOD', 'Budi Santoso', 'Absorbent pad dan boom lengkap', $5)
    `, [wshopLoc, pit1Loc, officeLoc, b3Loc, admin.id]);

    // 4. Titik Kumpul (Assembly Points)
    await pool.query(`
      INSERT INTO hse_emergency_assembly_points (
        tenant_key, project_key, code, name, location_id, location_name, capacity_persons, warden_name, is_active, notes, created_by
      ) VALUES
      ('default', 'default', 'AP-01', 'Assembly Point Utama Kantor Site', $1, 'Kantor Utama Site JMB-DKC', 120, 'HSE Officer Joko', true, 'Area lapang depan kantor berjarak aman dari fasilitas bahan bakar', $4),
      ('default', 'default', 'AP-02', 'Assembly Point 2 Samping Workshop', $2, 'Main Workshop & Bay Tambang', 60, 'Foreman Mekanik Budi', true, 'Titik kumpul evakuasi personel workshop dan gudang suku cadang', $4),
      ('default', 'default', 'AP-03', 'Assembly Point 3 Pit Stop Pit 1', $3, 'Pit 1 Selatan', 40, 'Foreman Pit Andi', true, 'Titik kumpul zona aman tanggul terluar Pit 1', $4)
    `, [officeLoc, wshopLoc, pit1Loc, admin.id]);

    // 5. Kontak Darurat (Emergency Contacts)
    await pool.query(`
      INSERT INTO hse_emergency_contacts (
        tenant_key, project_key, category, name, phone_no, alternate_phone, address, is_active, notes, created_by
      ) VALUES
      ('default', 'default', 'INTERNAL', 'Emergency Radio Dispatch Tambang Site', '0811-5555-119', 'Kanal Radio VHF 16', 'Gedung Kontrol Dispatch Site JMB-DKC', true, 'Siaga 24 jam untuk keadaan darurat operasional', $1),
      ('default', 'default', 'CLINIC', 'Paramedic & Klinik Pratama Site', '0812-7777-222', 'Kanal Radio VHF 12', 'Klinik Kesehatan Site JMB-DKC', true, 'Ambulans dan tim medis darurat site', $1),
      ('default', 'default', 'HOSPITAL', 'RSUD Abdul Wahab Sjahranie', '0541-738118', '0541-738052', 'Jl. Palang Merah No. 1, Samarinda', true, 'Rumah sakit rujukan utama trauma center', $1),
      ('default', 'default', 'FIRE_DEPT', 'Dinas Pemadam Kebakaran & Penyelamatan', '0541-113', '0541-741113', 'Pos Damkar Wilayah Tambang', true, 'Bantuan unit armada water supply pemadam', $1),
      ('default', 'default', 'POLICE', 'Polsek Wilayah Tambang Minerba', '0541-110', '0813-8888-0110', 'Polsek Sektor Pertambangan', true, 'Pengamanan dan koordinasi penegakan hukum', $1)
    `, [admin.id]);

    // 6. Master Katalog APD (PPE Items)
    const ppeInsRes = await pool.query(`
      INSERT INTO hse_ppe_items (
        tenant_key, project_key, code, name, category, replace_interval_months, standard_specification,
        current_stock, minimum_stock, unit, is_active, created_by
      ) VALUES
      ('default', 'default', 'PPE-HELM-01', 'Safety Helmet V-Gard ANSI Class E', 'HEAD', 24, 'ANSI Z89.1 Type 1 Class E, Chinstrap 4 titik', 42, 15, 'PCS', true, $1),
      ('default', 'default', 'PPE-BOOT-01', 'Safety Boots King Steel Toe Cap', 'FOOT', 12, 'SNI 7079 / EN ISO 20345 S3 SRC Oil & Chemical Resistant', 26, 12, 'PASANG', true, $1),
      ('default', 'default', 'PPE-VEST-01', 'Rompi Safety Scotlight 3M Hi-Vis', 'BODY', 6, 'EN 471 Class 2 Breathable Mesh with Zipper', 55, 20, 'PCS', true, $1),
      ('default', 'default', 'PPE-GLASS-01', 'Kacamata Safety Clear UV Anti-Fog', 'EYE', 6, 'ANSI Z87.1+ Polycarbonate UV400', 8, 15, 'PCS', true, $1),
      ('default', 'default', 'PPE-GLOVE-01', 'Sarung Tangan Impact & Rigger Kulit', 'HAND', 3, 'EN 388 Level 4 Cut & Impact Protection', 48, 20, 'PASANG', true, $1),
      ('default', 'default', 'PPE-EAR-01', 'Ear Plug Reusable Corded 25 dB', 'EAR', 3, 'ANSI S3.19 NRR 25dB Washable Silicone', 75, 30, 'PASANG', true, $1),
      ('default', 'default', 'PPE-RESP-01', 'Respirator Masker N95 Anti-Debu Tambang', 'RESPIRATORY', 1, 'NIOSH N95 Particulate Filter with Valve', 110, 40, 'BOX', true, $1),
      ('default', 'default', 'PPE-HARN-01', 'Full Body Harness Double Lanyard Absorber', 'FALL_PROTECTION', 24, 'EN 361 / ANSI Z359.11 Shock Absorber Carabiner', 5, 8, 'SET', true, $1)
      RETURNING id, code
    `, [admin.id]);

    const ppeMap = Object.fromEntries(ppeInsRes.rows.map(r => [r.code, r.id]));

    // 7. Standar APD Wajib per Jabatan (PPE Standards)
    if (ppeMap['PPE-HELM-01'] && ppeMap['PPE-BOOT-01'] && ppeMap['PPE-VEST-01']) {
      await pool.query(`
        INSERT INTO hse_ppe_standards (
          tenant_key, project_key, position_name, location_type, ppe_item_id, mandatory, quantity, notes, created_by
        ) VALUES
        ('default', 'default', 'Operator Dump Truck & Alat Berat', 'PIT', $1, true, 1, 'Wajib helm bersertifikat ANSI', $7),
        ('default', 'default', 'Operator Dump Truck & Alat Berat', 'PIT', $2, true, 1, 'Sepatu safety baja anti selip', $7),
        ('default', 'default', 'Operator Dump Truck & Alat Berat', 'PIT', $3, true, 1, 'Rompi reflektor visibilitas tinggi', $7),
        ('default', 'default', 'Operator Dump Truck & Alat Berat', 'PIT', $4, true, 1, 'Pelindung pendengaran front loading', $7),
        ('default', 'default', 'Mekanik & Welder Workshop', 'WORKSHOP', $1, true, 1, 'Helm safety area bengkel', $7),
        ('default', 'default', 'Mekanik & Welder Workshop', 'WORKSHOP', $2, true, 1, 'Sepatu safety tahan oli & tumpahan cairan', $7),
        ('default', 'default', 'Mekanik & Welder Workshop', 'WORKSHOP', $5, true, 1, 'Sarung tangan tahan gesek & panas', $7),
        ('default', 'default', 'Rigger / Pekerja Ketinggian', 'ALL', $6, true, 1, 'Wajib double lanyard saat bekerja > 1,8 meter', $7)
      `, [
        ppeMap['PPE-HELM-01'], ppeMap['PPE-BOOT-01'], ppeMap['PPE-VEST-01'], ppeMap['PPE-EAR-01'],
        ppeMap['PPE-GLOVE-01'], ppeMap['PPE-HARN-01'], admin.id
      ]);
    }

    // 8. Riwayat Distribusi APD Karyawan (PPE Issuances)
    if (ppeMap['PPE-HELM-01'] && ppeMap['PPE-BOOT-01'] && ppeMap['PPE-VEST-01']) {
      await pool.query(`
        INSERT INTO hse_ppe_issuances (
          tenant_key, project_key, employee_id, employee_name, employee_nrp, department_name, position_name,
          ppe_item_id, ppe_item_name, ppe_category, size, quantity, issued_date, replace_due_date, reason, status, issued_by_name, created_by
        ) VALUES
        ('default', 'default', $1, 'Andi Saputra', 'EMP-001', 'Mining Operation', 'Foreman Produksi', $5, 'Safety Helmet V-Gard ANSI Class E', 'HEAD', 'M', 1, '2025-10-15', '2027-10-15', 'NEW_HIRE', 'ACTIVE', 'Admin Logistik HSE', $8),
        ('default', 'default', $1, 'Andi Saputra', 'EMP-001', 'Mining Operation', 'Foreman Produksi', $6, 'Safety Boots King Steel Toe Cap', 'FOOT', '42', 1, '2025-11-01', '2026-11-01', 'NEW_HIRE', 'ACTIVE', 'Admin Logistik HSE', $8),
        ('default', 'default', $2, 'Budi Santoso', 'EMP-002', 'Plant & Maintenance', 'Lead Mechanic', $6, 'Safety Boots King Steel Toe Cap', 'FOOT', '41', 1, '2025-10-20', '2026-10-20', 'REPLACEMENT', 'DUE_REPLACEMENT', 'Admin Logistik HSE', $8),
        ('default', 'default', $3, 'Rudi Hartono', 'EMP-003', 'HSE & Safety', 'HSE Superintendent', $7, 'Rompi Safety Scotlight 3M Hi-Vis', 'BODY', 'L', 1, '2026-06-10', '2026-12-10', 'REPLACEMENT', 'ACTIVE', 'Admin Logistik HSE', $8),
        ('default', 'default', $4, 'Siti Aminah', 'EMP-004', 'Health & Safety', 'Paramedic Site', $5, 'Safety Helmet V-Gard ANSI Class E', 'HEAD', 'S', 1, '2026-02-15', '2028-02-15', 'NEW_HIRE', 'ACTIVE', 'Admin Logistik HSE', $8)
      `, [u1.id, u2.id, u3.id, u4.id, ppeMap['PPE-HELM-01'], ppeMap['PPE-BOOT-01'], ppeMap['PPE-VEST-01'], admin.id]);
    }

    console.log('Seeding Fase 6 Tanggap Darurat & APD completed!');
  }

  // Fase 7: Seed Kontraktor (CSMS) & Lingkungan Hidup
  const ctrCountRes = await pool.query("SELECT count(*)::int as c FROM hse_contractors WHERE tenant_key='default'");
  if (ctrCountRes.rows[0].c === 0) {
    console.log('Seeding Fase 7 Kontraktor (CSMS) & Lingkungan Hidup...');

    // Ambil lokasi
    const locRes = await pool.query("SELECT id, name FROM hse_locations WHERE tenant_key='default'");
    const locMap = Object.fromEntries(locRes.rows.map(l => [l.name, l.id]));
    const wshopLoc = locMap['Main Workshop & Bay Tambang'] || locRes.rows[0]?.id;
    const pit1Loc = locMap['Pit 1 Selatan'] || locRes.rows[0]?.id;
    const haulLoc = locMap['Main Haul Road KM 2-4'] || locRes.rows[0]?.id;
    const tpsLoc = locMap['TPS Limbah B3 & Gudang Site'] || locRes.rows[0]?.id;
    const offLoc = locMap['Kantor Utama Site JMB-DKC'] || locRes.rows[0]?.id;

    // 1. Kontraktor (Mitra Kerja)
    const ctrInsRes = await pool.query(`
      INSERT INTO hse_contractors (
        tenant_key, project_key, company_code, company_name, business_type, pic_name, pic_phone, pic_email, office_address, worker_count, is_active, created_by
      ) VALUES
      ('default', 'default', 'KTR-001', 'PT Petro Tambang Mandiri', 'HAULING', 'Bambang Wijaya', '0812-4455-6677', 'bambang@petrotambang.co.id', 'Jl. Mulawarman No. 45, Balikpapan', 45, true, $1),
      ('default', 'default', 'KTR-002', 'PT Mitra Konstruksi Nusantara', 'CIVIL_WORKS', 'Deni Setiawan', '0813-8899-1122', 'deni@mitrakonstruksi.id', 'Jl. P. Antasari No. 12, Samarinda', 28, true, $1),
      ('default', 'default', 'KTR-003', 'CV Berkah Drilling & Blasting', 'DRILLING_BLASTING', 'Hendra Saputra', '0811-9988-7766', 'hendra@berkahblasting.com', 'Kutai Kartanegara', 16, true, $1)
      RETURNING id, company_code
    `, [admin.id]);

    const ctrMap = Object.fromEntries(ctrInsRes.rows.map(r => [r.company_code, r.id]));

    // 2. CSMS Assessments
    if (ctrMap['KTR-001'] && ctrMap['KTR-002']) {
      await pool.query(`
        INSERT INTO hse_contractor_assessments (
          tenant_key, project_key, contractor_id, contractor_name, assessment_date, assessment_type, score, result, assessor_name, valid_until, notes, created_by
        ) VALUES
        ('default', 'default', $1, 'PT Petro Tambang Mandiri', '2026-03-15', 'PREQUALIFICATION', 88.50, 'APPROVED', 'Tim CSMS Site JMB-DKC', '2027-03-15', 'Kepatuhan HSE sangat baik, armada hauling terawat', $3),
        ('default', 'default', $2, 'PT Mitra Konstruksi Nusantara', '2026-04-10', 'PREQUALIFICATION', 71.00, 'CONDITIONAL', 'Tim CSMS Site JMB-DKC', '2026-10-10', 'Perlu penambahan sertifikasi rigger & peremajaan APD', $3)
      `, [ctrMap['KTR-001'], ctrMap['KTR-002'], admin.id]);

      // 3. Contractor Documents
      await pool.query(`
        INSERT INTO hse_contractor_documents (
          tenant_key, project_key, contractor_id, contractor_name, doc_type, doc_no, title, issued_date, expiry_date, status, notes, created_by
        ) VALUES
        ('default', 'default', $1, 'PT Petro Tambang Mandiri', 'SMK3', 'SMK3-MIN-2024-09', 'Sertifikat Sistem Manajemen K3 Kemnaker', '2024-05-10', '2027-05-10', 'VALID', 'Audit SMK3 skor 87%', $3),
        ('default', 'default', $1, 'PT Petro Tambang Mandiri', 'IUJP', 'IUJP-ESDM-661/2023', 'Izin Usaha Jasa Pertambangan Golongan Pengangkutan', '2023-08-01', '2028-08-01', 'VALID', 'Izin resmi Minerba ESDM', $3),
        ('default', 'default', $2, 'PT Mitra Konstruksi Nusantara', 'INSURANCE', 'POLIS-BPJS-TK-882', 'Jaminan BPJS Ketenagakerjaan Konstruksi', '2025-10-15', '2026-10-20', 'EXPIRING', 'Jatuh tempo dalam 11 hari', $3)
      `, [ctrMap['KTR-001'], ctrMap['KTR-002'], admin.id]);

      // 4. Contractor Violations
      await pool.query(`
        INSERT INTO hse_contractor_violations (
          tenant_key, project_key, contractor_id, contractor_name, violation_date, location_id, location_name, description, severity, sanction, status, reported_by, notes, created_by
        ) VALUES
        ('default', 'default', $1, 'PT Petro Tambang Mandiri', '2026-10-04', $4, 'Main Haul Road KM 2-4', 'Driver DT hauling melaju 48 km/jam melebihi batas kecepatan 40 km/jam', 'MINOR', 'WRITTEN_WARNING', 'RESOLVED', 'Patroli HSE Hauling', 'Driver telah diberikan surat peringatan tertulis dan coaching', $3),
        ('default', 'default', $2, 'PT Mitra Konstruksi Nusantara', '2026-10-08', $5, 'Pit 1 Selatan', 'Pekerja scaffolding tidak mengaitkan double lanyard saat perbaikan menara', 'MAJOR', 'WARNING', 'OPEN', 'HSE Inspector Rudi', 'Ditegur di tempat, pekerjaan diskors 2 jam untuk safety briefing', $3)
      `, [ctrMap['KTR-001'], ctrMap['KTR-002'], admin.id, haulLoc, pit1Loc]);
    }

    // 5. Neraca Limbah B3 (Waste B3 Logs)
    await pool.query(`
      INSERT INTO hse_env_waste_b3_logs (
        tenant_key, project_key, log_date, waste_code, waste_name, source_location_id, source_location_name,
        quantity, unit, storage_location_id, storage_location_name, storage_deadline, hauler_company, manifest_no, hauled_date, status, pic_name, created_by
      ) VALUES
      ('default', 'default', '2026-10-01', 'B105d', 'Oli Bekas (Used Lube Oil)', $1, 'Main Workshop & Bay Tambang', 1250.00, 'LITER', $2, 'TPS Limbah B3 Site', '2026-12-30', NULL, NULL, NULL, 'STORED', 'Admin Lingkungan HSE', $3),
      ('default', 'default', '2026-10-03', 'B107d', 'Filter Oli Bekas (Used Oil Filter)', $1, 'Main Workshop & Bay Tambang', 180.00, 'KG', $2, 'TPS Limbah B3 Site', '2026-12-30', NULL, NULL, NULL, 'STORED', 'Admin Lingkungan HSE', $3),
      ('default', 'default', '2026-10-05', 'B110d', 'Aki Bekas (Used Lead Acid Battery)', $1, 'Main Workshop & Bay Tambang', 350.00, 'KG', $2, 'TPS Limbah B3 Site', '2026-11-05', NULL, NULL, NULL, 'STORED', 'Admin Lingkungan HSE', $3),
      ('default', 'default', '2026-09-15', 'B105d', 'Oli Bekas (Used Lube Oil)', $1, 'Main Workshop & Bay Tambang', 4500.00, 'LITER', $2, 'TPS Limbah B3 Site', '2026-12-15', 'PT Prasadha Pamunah Limbah Industri', 'FEST-KLHK-2026-0988', '2026-09-20', 'HAULED', 'Admin Lingkungan HSE', $3)
    `, [wshopLoc, tpsLoc, admin.id]);

    // 6. Titik Pantau Lingkungan (Monitoring Points)
    const ptInsRes = await pool.query(`
      INSERT INTO hse_env_monitoring_points (
        tenant_key, project_key, point_code, name, media, location_id, location_name, latitude, longitude, description, created_by
      ) VALUES
      ('default', 'default', 'SW-01', 'Outlet Kolam Pengendapan Sedimen 1 (KPL-01)', 'WATER', $1, 'Pit 1 Selatan', -0.5123456, 117.1234567, 'Titik penaatan air limbah tambang menuju badan air', $3),
      ('default', 'default', 'SW-02', 'Inlet Kolam Pengendapan Sedimen 1', 'WATER', $1, 'Pit 1 Selatan', -0.5115555, 117.1223333, 'Pemantauan kualitas air tambang sebelum pengendapan', $3),
      ('default', 'default', 'AMB-01', 'Udara Ambien Simpang Hauling KM 2.5', 'AIR', $2, 'Main Haul Road KM 2-4', -0.5234567, 117.1345678, 'Pemantauan debu dan emisi kendaraan sekitar jalan hauling', $3),
      ('default', 'default', 'NOISE-01', 'Area Workshop & Power Plant', 'NOISE', $4, 'Main Workshop & Bay Tambang', -0.5345678, 117.1456789, 'Tingkat kebisingan lingkungan batas workshop', $3)
      RETURNING id, point_code
    `, [pit1Loc, haulLoc, admin.id, wshopLoc]);

    const ptMap = Object.fromEntries(ptInsRes.rows.map(r => [r.point_code, r.id]));

    // 7. Master Parameter & Baku Mutu Lingkungan
    const paramInsRes = await pool.query(`
      INSERT INTO hse_env_parameters (
        tenant_key, project_key, media, parameter_name, unit, limit_min, limit_max, standard_reference, created_by
      ) VALUES
      ('default', 'default', 'WATER', 'pH', 'pH Unit', 6.00, 9.00, 'Kepmen LH No. 113/2003 Baku Mutu Air Tambang Batubara', $1),
      ('default', 'default', 'WATER', 'TSS (Total Suspended Solids)', 'mg/L', NULL, 200.00, 'Kepmen LH No. 113/2003 Baku Mutu Air Tambang Batubara', $1),
      ('default', 'default', 'WATER', 'Besi Terlarut (Fe)', 'mg/L', NULL, 7.00, 'Kepmen LH No. 113/2003 Baku Mutu Air Tambang Batubara', $1),
      ('default', 'default', 'WATER', 'Mangan Terlarut (Mn)', 'mg/L', NULL, 4.00, 'Kepmen LH No. 113/2003 Baku Mutu Air Tambang Batubara', $1),
      ('default', 'default', 'AIR', 'TSP (Debu Total Tersuspensi)', 'µg/Nm³', NULL, 230.00, 'PP No. 22/2021 Lampiran VII Baku Mutu Udara Ambien 24 Jam', $1),
      ('default', 'default', 'NOISE', 'Tingkat Kebisingan Lingkungan', 'dBA', NULL, 70.00, 'Kepmen LH No. 48/1996 Kawasan Industri & Pertambangan', $1)
      RETURNING id, parameter_name
    `, [admin.id]);

    const paramMap = Object.fromEntries(paramInsRes.rows.map(r => [r.parameter_name, r.id]));

    // 8. Pengukuran Kualitas Lingkungan (Measurements)
    if (ptMap['SW-01'] && paramMap['pH'] && paramMap['TSS (Total Suspended Solids)']) {
      await pool.query(`
        INSERT INTO hse_env_measurements (
          tenant_key, project_key, point_id, point_name, parameter_id, parameter_name, media, measured_at,
          measured_value, unit, limit_min, limit_max, status, lab_name, report_no, pic_sampler, created_by
        ) VALUES
        ('default', 'default', $1, 'Outlet Kolam Pengendapan Sedimen 1 (KPL-01)', $2, 'pH', 'WATER', '2026-10-04', 7.20, 'pH Unit', 6.00, 9.00, 'COMPLIES', 'PT Sucofindo Laboratorium Samarinda', 'SHU-LAB-2610-011', 'Staff Lingkungan Site', $5),
        ('default', 'default', $1, 'Outlet Kolam Pengendapan Sedimen 1 (KPL-01)', $3, 'TSS (Total Suspended Solids)', 'WATER', '2026-10-04', 182.00, 'mg/L', NULL, 200.00, 'NEAR_LIMIT', 'PT Sucofindo Laboratorium Samarinda', 'SHU-LAB-2610-011', 'Staff Lingkungan Site', $5),
        ('default', 'default', $1, 'Outlet Kolam Pengendapan Sedimen 1 (KPL-01)', $4, 'Besi Terlarut (Fe)', 'WATER', '2026-10-04', 2.45, 'mg/L', NULL, 7.00, 'COMPLIES', 'PT Sucofindo Laboratorium Samarinda', 'SHU-LAB-2610-011', 'Staff Lingkungan Site', $5)
      `, [ptMap['SW-01'], paramMap['pH'], paramMap['TSS (Total Suspended Solids)'], paramMap['Besi Terlarut (Fe)'], admin.id]);
    }

    // 9. Reklamasi & Revegetasi Lahan Tambang (Reclamation Records)
    await pool.query(`
      INSERT INTO hse_env_reclamation_records (
        tenant_key, project_key, area_name, activity, planned_ha, actual_ha, period_month, tree_species, trees_planted_count, mortality_rate_percent, notes, created_by
      ) VALUES
      ('default', 'default', 'Disposal Barat Blok 1A', 'PLANTING', 4.50, 4.20, '2026-09-01', 'Sengon Buto, Johar, Trembesi', 2600, 4.50, 'Penanaman bibit pohon perintis berjalan baik', $1),
      ('default', 'default', 'Disposal Barat Blok 1B', 'TOPSOIL', 3.00, 3.10, '2026-10-01', NULL, 0, 0.00, 'Penebaran tanah pucuk tebal rata-rata 50 cm selesai tepat waktu', $1),
      ('default', 'default', 'Bekas Tambang Pit 1 Utara Lereng Atas', 'LANDSCAPING', 5.00, 4.80, '2026-10-01', NULL, 0, 0.00, 'Regrading jenjang stabilisasi kelerengan aman dari erosi', $1)
    `, [admin.id]);

    console.log('Seeding Fase 7 Kontraktor & Lingkungan completed!');
  }

  // Fase 8: Seed Audit (SMKP Minerba), Dokumen HSE, Legal Register, & Pelaporan Wajib
  const auditCountRes = await pool.query("SELECT count(*)::int as c FROM hse_audits WHERE tenant_key='default'");
  if (auditCountRes.rows[0].c === 0) {
    console.log('Seeding Fase 8 Audit & SMKP Minerba, Dokumen & Regulasi...');

    // 1. Audits
    const auditInsRes = await pool.query(`
      INSERT INTO hse_audits (
        tenant_key, project_key, audit_no, audit_type, scope, title, audit_date_start, audit_date_end,
        lead_auditor, auditor_team, overall_score, status, notes, created_by
      ) VALUES
      ('default', 'default', 'AUD-26-001', 'INTERNAL', 'SMKP Minerba Permen ESDM No. 26/2018', 'Audit Internal SMKP Minerba Semester I 2026', '2026-06-10', '2026-06-15', 'Ir. Bambang Sudibyo (Auditor SMKP Terdaftar)', 'Tim Audit Internal Dept HSE OMOS', 84.50, 'REPORTED', 'Audit rutin semesteran evaluasi 7 elemen SMKP Minerba', $1),
      ('default', 'default', 'AUD-26-002', 'EXTERNAL', 'Sistem Manajemen K3 ISO 45001:2018', 'Surveillance Audit Eksternal ISO 45001 Tahun ke-2', '2026-11-20', '2026-11-23', 'Lead Auditor BSI Group Indonesia', 'Tim Auditor Lembaga Sertifikasi Eksternal', NULL, 'PLANNED', 'Surveillance audit pemeliharaan sertifikat ISO 45001 site tambang', $1)
      RETURNING id, audit_no
    `, [admin.id]);

    const auditMap = Object.fromEntries(auditInsRes.rows.map(r => [r.audit_no, r.id]));

    // 2. Audit Findings
    if (auditMap['AUD-26-001']) {
      await pool.query(`
        INSERT INTO hse_audit_findings (
          tenant_key, project_key, audit_id, audit_no, finding_no, element_or_clause, category,
          description, evidence, pic_name, due_date, status, resolution_notes, created_by
        ) VALUES
        ('default', 'default', $1, 'AUD-26-001', 'FND-26-001', 'Elemen IV.1 Operasional Tambang', 'MAJOR', 'Penyimpanan tabung gas bertekanan oksigen dan asetilen di bay workshop belum diikat rantai pengaman dan tanpa tutup pelindung katup', 'Foto dokumentasi area bay workshop 3', 'Supervisor Workshop', '2026-11-15', 'OPEN', NULL, $2),
        ('default', 'default', $1, 'AUD-26-001', 'FND-26-002', 'Elemen II.2 Identifikasi Bahaya & IBPR', 'MINOR', 'Dokumen IBPR untuk aktivitas peledakan (blasting) pit belum dimutakhirkan dengan radius aman terbaru pasca perluasan pit', 'Revisi dokumen IBPR Pit 1', 'Foreman Drill & Blast', '2026-10-30', 'OPEN', NULL, $2),
        ('default', 'default', $1, 'AUD-26-001', 'FND-26-003', 'Elemen I Kebijakan Keselamatan', 'OBSERVATION', 'Papan baliho kebijakan keselamatan pertambangan di pos jaga utama pudar warnanya', 'Papan informasi pos security', 'HSE Officer Media', '2026-07-15', 'CLOSED', 'Papan banner telah diganti dengan akrilik reflektif baru pada 12 Juli 2026', $2)
      `, [auditMap['AUD-26-001'], admin.id]);
    }

    // 3. Dokumen HSE
    const docInsRes = await pool.query(`
      INSERT INTO hse_documents (
        tenant_key, project_key, doc_no, title, doc_type, revision_no, effective_date, next_review_date,
        owner_name, status, tags, summary, created_by
      ) VALUES
      ('default', 'default', 'HSE-POL-001', 'Kebijakan Keselamatan Pertambangan & Lingkungan Hidup', 'POLICY', 2, '2026-01-05', '2027-01-05', 'KTT & Direksi Site', 'ACTIVE', 'kebijakan, smkp, golden rules', 'Komitmen manajemen puncak terhadap zero fatality, perlindungan lingkungan dan kepatuhan perundangan', $1),
      ('default', 'default', 'HSE-SOP-012', 'SOP Kesiapsiagaan & Tanggap Darurat Bencana Tambang', 'EMERGENCY_PLAN', 1, '2025-05-10', '2026-11-01', 'Superintendent HSE', 'UNDER_REVIEW', 'tanggap darurat, ert, evakuasi', 'Prosedur mobilisasi tim ERT, komando insiden dan penanganan kecelakaan tambang kritis', $1),
      ('default', 'default', 'HSE-JSA-004', 'Instruksi Kerja JSA Penggantian Ban Dump Truck HD785', 'WORK_INSTRUCTION', 0, '2025-08-15', '2027-08-15', 'Lead Mechanic Tyre Bay', 'ACTIVE', 'jsa, workshop, tire handling', 'Langkah mitigasi pelepasan rim ban bertekanan tinggi dan pemakaian tyre handler', $1),
      ('default', 'default', 'HSE-FRM-008', 'Formulir Pemeriksaan P5M & Pre-Start Check Dump Truck', 'FORM', 1, '2026-02-01', '2027-02-01', 'Foreman Produksi', 'ACTIVE', 'form, p5m, p2h', 'Checklist harian kelaikan unit sebelum beroperasi di pit', $1)
      RETURNING id, doc_no
    `, [admin.id]);

    const docMap = Object.fromEntries(docInsRes.rows.map(r => [r.doc_no, r.id]));

    // 4. Riwayat Revisi Dokumen
    if (docMap['HSE-POL-001']) {
      await pool.query(`
        INSERT INTO hse_document_revisions (
          tenant_key, project_key, document_id, revision_no, change_summary, approved_by_name, created_by
        ) VALUES
        ('default', 'default', $1, 1, 'Penyelarasan klausul dengan Kepmen ESDM 1827 K/2018', 'Direktur Operasional', $2),
        ('default', 'default', $1, 2, 'Penambahan komitmen dekarbonisasi dan perlindungan keanekaragaman hayati', 'KTT Site Utama', $2)
      `, [docMap['HSE-POL-001'], admin.id]);
    }

    // 5. Legal Register (Kepatuhan Peraturan K3LH)
    await pool.query(`
      INSERT INTO hse_legal_register (
        tenant_key, project_key, regulation_title, regulation_no, issuer, requirement_summary,
        is_applicable, compliance_status, pic_name, last_assessed_at, created_by
      ) VALUES
      ('default', 'default', 'Undang-Undang Keselamatan Kerja', 'UU No. 1 Tahun 1970', 'KEMENAKER', 'Kewajiban pengurus tempat kerja menyediakan APD, pemeriksaan kesehatan tenaga kerja, dan syarat keselamatan kerja', true, 'COMPLIANT', 'HSE Superintendent', '2026-08-01', $1),
      ('default', 'default', 'Penerapan Kaidah Teknik Pertambangan yang Baik dan Pengawasan Pertambangan Minerba', 'Permen ESDM No. 26 Tahun 2018', 'ESDM_MINERBA', 'Kewajiban penerapan Sistem Manajemen Keselamatan Pertambangan (SMKP Minerba) dan pengangkatan KTT/PJO', true, 'COMPLIANT', 'KTT Site', '2026-08-15', $1),
      ('default', 'default', 'Pedoman Pelaksanaan Kaidah Teknik Pertambangan yang Baik', 'Kepmen ESDM No. 1827 K/30/MEM/2018 Lampiran IV', 'ESDM_MINERBA', 'Ketentuan teknis keselamatan operasional jalan hauling, kestabilan lereng tambang, dan sertifikasi kelayakan peralatan', true, 'PARTIAL', 'Bagian K3 Tambang', '2026-09-01', $1),
      ('default', 'default', 'Penyelenggaraan Perlindungan dan Pengelolaan Lingkungan Hidup', 'PP No. 22 Tahun 2021', 'KLHK', 'Pengelolaan limbah B3, baku mutu air limbah tambang, pemantauan kualitas udara dan pelaporan dokumen AMDAL/RKL-RPL', true, 'COMPLIANT', 'Supervisor Lingkungan Hidup', '2026-08-20', $1)
    `, [admin.id]);

    // 6. Pelaporan Wajib Instansi (Mandatory Reports)
    await pool.query(`
      INSERT INTO hse_mandatory_reports (
        tenant_key, project_key, report_code, report_name, agency, period_type, period_label,
        deadline_date, submission_date, receipt_no, status, pic_name, created_by
      ) VALUES
      ('default', 'default', 'REP-ESD-Q1-26', 'Laporan Berkala Triwulan I K3 Pertambangan ke KaIT ESDM', 'ESDM_KAIT', 'QUARTERLY', 'Triwulan I 2026', '2026-04-15', '2026-04-10', 'TANDA-ESDM-MINERBA-2604-091', 'VERIFIED', 'KTT Site', $1),
      ('default', 'default', 'REP-ESD-Q3-26', 'Laporan Berkala Triwulan III K3 Pertambangan ke KaIT ESDM', 'ESDM_KAIT', 'QUARTERLY', 'Triwulan III 2026', '2026-10-15', NULL, NULL, 'PENDING', 'KTT Site', $1),
      ('default', 'default', 'REP-DLH-S1-26', 'Laporan Pelaksanaan RKL-RPL Semester I Tahun 2026 ke DLH & KLHK', 'DLH_KLHK', 'SEMESTER', 'Semester I 2026', '2026-07-31', '2026-07-28', 'BA-SERAH-DLH-2026-S1-042', 'VERIFIED', 'Supervisor Lingkungan Hidup', $1)
    `, [admin.id]);

    console.log('Seeding Fase 8 Audit, Dokumen & Regulasi completed!');
  }
}

seed().then(() => pool.end()).catch(err => {
  console.error('Seeding error:', err);
  pool.end();
  process.exit(1);
});

