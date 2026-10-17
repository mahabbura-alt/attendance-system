'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const hseService = require('../src/services/hse');

// PNG 1×1 valid untuk pengujian kompresi foto inspeksi
const HSE_TEST_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const HSE_TEST_PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF').toString('base64')}`;

test('HSE risk calculation computes score and maps levels correctly', () => {
  // Low (1-4)
  assert.deepEqual(hseService.calculateRisk(1, 1), { likelihood: 1, consequence: 1, riskScore: 1, riskLevel: 'LOW' });
  assert.deepEqual(hseService.calculateRisk(2, 2), { likelihood: 2, consequence: 2, riskScore: 4, riskLevel: 'LOW' });

  // Medium (5-9)
  assert.deepEqual(hseService.calculateRisk(1, 5), { likelihood: 1, consequence: 5, riskScore: 5, riskLevel: 'MEDIUM' });
  assert.deepEqual(hseService.calculateRisk(3, 3), { likelihood: 3, consequence: 3, riskScore: 9, riskLevel: 'MEDIUM' });

  // High (10-16)
  assert.deepEqual(hseService.calculateRisk(2, 5), { likelihood: 2, consequence: 5, riskScore: 10, riskLevel: 'HIGH' });
  assert.deepEqual(hseService.calculateRisk(4, 4), { likelihood: 4, consequence: 4, riskScore: 16, riskLevel: 'HIGH' });

  // Extreme (17-25)
  assert.deepEqual(hseService.calculateRisk(4, 5), { likelihood: 4, consequence: 5, riskScore: 20, riskLevel: 'EXTREME' });
  assert.deepEqual(hseService.calculateRisk(5, 5), { likelihood: 5, consequence: 5, riskScore: 25, riskLevel: 'EXTREME' });

  // Clamping
  assert.deepEqual(hseService.calculateRisk(0, 10), { likelihood: 1, consequence: 5, riskScore: 5, riskLevel: 'MEDIUM' });
});

test('HSE scope extracts tenant and project keys with default fallbacks', () => {
  assert.deepEqual(hseService.scopeFromUser({}), { tenantKey: 'default', projectKey: 'default' });
  assert.deepEqual(hseService.scopeFromUser({ tenant_id: 't1', project_id: 'p1' }), { tenantKey: 't1', projectKey: 'p1' });
  assert.deepEqual(hseService.scopeFromUser({ tenantId: 't2', projectId: 'p2' }), { tenantKey: 't2', projectKey: 'p2' });
});

test('HSE createHazard validates description, calculates risk, and preserves potential_consequence and reporter', async () => {
  let insertedData = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT last_no FROM hazard_reports')) {
        return { rows: [{ last_no: 'HZD-2610-005' }] };
      }
      if (sql.includes('SELECT nama, departemen, jabatan FROM users WHERE id = $1')) {
        return { rows: [{ nama: 'Budi Santoso', departemen: 'Produksi', jabatan: 'Foreman PIT' }] };
      }
      if (sql.includes('INSERT INTO hazard_reports')) {
        insertedData = {
          report_no: params[2],
          reported_by: params[3],
          reported_by_name: params[4],
          reported_by_dept: params[5],
          reported_by_role: params[6],
          description: params[13],
          potential_consequence: params[14],
          likelihood: params[16],
          consequence: params[17],
          risk_score: params[18],
          risk_level: params[19],
        };
        return { rows: [insertedData] };
      }
      return { rows: [] };
    },
  };
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Admin HSE' };

  await assert.rejects(
    async () => hseService.createHazard(mockDb, scope, user, { description: '' }),
    { statusCode: 422, message: 'Uraian hazard wajib diisi' }
  );

  const res = await hseService.createHazard(mockDb, scope, user, {
    description: 'Tanggul retak di KM 3',
    potential_consequence: 'Unit DT tergelincir masuk jurang saat berpapasan',
    likelihood: 4,
    consequence: 4,
    reported_by: 'emp-2'
  });

  assert.equal(res.description, 'Tanggul retak di KM 3');
  assert.equal(res.potential_consequence, 'Unit DT tergelincir masuk jurang saat berpapasan');
  assert.equal(res.reported_by, 'emp-2');
  assert.equal(res.reported_by_name, 'Budi Santoso');
  assert.equal(res.reported_by_dept, 'Produksi');
  assert.equal(res.reported_by_role, 'Foreman PIT');
  assert.equal(res.risk_score, 16);
  assert.equal(res.risk_level, 'HIGH');
});

test('HSE createAction validates description and due_date', async () => {
  const mockDb = { query: async () => ({ rows: [] }) };
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  await assert.rejects(
    async () => hseService.createAction(mockDb, scope, user, { description: '', due_date: '2026-10-15' }),
    { statusCode: 422, message: 'Uraian tindakan wajib diisi' }
  );

  await assert.rejects(
    async () => hseService.createAction(mockDb, scope, user, { description: 'Perbaiki rambu', due_date: '' }),
    { statusCode: 422, message: 'Tenggat waktu (due date) wajib diisi' }
  );
});

test('HSE business rule #4 blocks closing hazard if CAPA is still unclosed', async () => {
  let queryCount = 0;
  const mockDb = {
    query: async (sql) => {
      queryCount += 1;
      if (sql.includes('FROM hazard_reports h')) {
        return {
          rows: [{
            id: 'h-1',
            report_no: 'HZD-2610-001',
            status: 'IN_ACTION',
            likelihood: 4,
            consequence: 4,
            risk_score: 16,
            risk_level: 'HIGH',
          }],
        };
      }
      if (sql.includes('FROM hse_actions a')) {
        return { rows: [{ id: 'a-1', status: 'OPEN' }] };
      }
      if (sql.includes('unclosed_count')) {
        return { rows: [{ unclosed_count: 1 }] };
      }
      return { rows: [] };
    },
  };

  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  await assert.rejects(
    async () => hseService.updateHazard(mockDb, scope, user, 'h-1', { status: 'CLOSED' }),
    {
      statusCode: 422,
      message: 'Hazard belum dapat ditutup. Masih ada tindakan korektif (CAPA) yang belum berstatus CLOSED.',
    }
  );
});

test('HSE createIncident validates required fields and sets last_lti_date on LTI or FATALITY', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Safety Officer' };

  // Validation
  await assert.rejects(
    async () => hseService.createIncident({ query: async () => ({ rows: [] }) }, scope, user, { description: '' }),
    { statusCode: 422, message: 'Uraian insiden wajib diisi' }
  );

  await assert.rejects(
    async () => hseService.createIncident({ query: async () => ({ rows: [] }) }, scope, user, { description: 'Insiden', incident_type: '' }),
    { statusCode: 422, message: 'Jenis insiden wajib dipilih' }
  );

  await assert.rejects(
    async () => hseService.createIncident({ query: async () => ({ rows: [] }) }, scope, user, { description: 'Insiden', incident_type: 'MTI', occurred_at: '' }),
    { statusCode: 422, message: 'Waktu kejadian (occurred_at) wajib diisi' }
  );

  // Business Rule #5: last_lti_date is reset on LTI or FATALITY
  const queriesExecuted = [];
  const mockDb = {
    query: async (sql, params) => {
      queriesExecuted.push({ sql, params });
      if (sql.includes('SELECT') && sql.includes('last_no')) {
        return { rows: [{ last_no: null }] };
      }
      if (sql.includes('INSERT INTO incidents')) {
        return { rows: [{ id: 'inc-99', incident_no: 'INC-2610-099', incident_type: 'LTI' }] };
      }
      return { rows: [] };
    },
  };

  const created = await hseService.createIncident(mockDb, scope, user, {
    incident_type: 'LTI',
    occurred_at: '2026-10-09T08:00:00Z',
    description: 'Operator terjepit conveyor',
  });

  assert.equal(created.id, 'inc-99');
  const metricUpdate = queriesExecuted.find(q => q.sql.includes('hse_site_metrics'));
  assert.ok(metricUpdate, 'Query hse_site_metrics must be executed on LTI');
  assert.equal(metricUpdate.params[2], '2026-10-09', 'last_lti_date must be updated to incident date');
});

test('HSE getSafetyReports calculates LTIFR, TRIR, and SR from integrated workhours (Setup Master + kontraktor)', async () => {
  const Workhours = require('../src/services/hseWorkhours');
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const curKey = Workhours.todayWib().slice(0, 7);
  const prevKey = Workhours.lastMonthKeys(Workhours.todayWib(), 2)[1];
  const mockDb = {
    query: async (sql) => {
      if (sql.includes('FROM hse_manhours m')) {
        return {
          rows: [
            // bulan lalu: terkunci (ATTENDANCE) + kontraktor; data manual internal lama diabaikan
            { month_key: prevKey, attendance_hours: '190000', internal_manual_hours: '0', contractor_hours: '10000' },
            // bulan berjalan: hanya data manual internal lama → digantikan jam presensi live
            { month_key: curKey, attendance_hours: '0', internal_manual_hours: '239000', contractor_hours: '0' },
          ],
        };
      }
      if (sql.includes('FROM hse_workhour_periods')) {
        return { rows: [{ month_key: prevKey }] };
      }
      if (sql.includes('FROM present_hours')) {
        return { rows: [{ month_key: curKey, hours: '100000', present_days: 9000, uncounted_days: 3, employee_count: 250 }] };
      }
      if (sql.includes('FROM incidents')) {
        if (sql.includes('GROUP BY incident_type')) return { rows: [{ incident_type: 'MTI', count: 1 }] };
        if (sql.includes('COALESCE(l.name')) return { rows: [{ location_name: 'Workshop', count: 1 }] };
        return {
          rows: [
            { month_key: prevKey, fatality_count: 0, lti_count: 1, mti_count: 1, fai_count: 2, nm_count: 3, pd_count: 1 },
          ],
        };
      }
      if (sql.includes('FROM incident_persons')) {
        return { rows: [{ month_key: prevKey, total_lost_days: 10 }] };
      }
      return { rows: [] };
    },
  };

  const reports = await hseService.getSafetyReports(mockDb, scope);
  assert.equal(reports.monthlyStatistics.length, 12);
  const prev = reports.monthlyStatistics.find(m => m.monthKey === prevKey);
  const cur = reports.monthlyStatistics.find(m => m.monthKey === curKey);

  // Bulan terkunci: 190.000 (rekap presensi) + 10.000 (kontraktor) = 200.000 jam
  assert.equal(prev.hours, 200000);
  assert.equal(prev.hoursStatus, 'FINAL');
  // LTIFR = (1 LTI × 1.000.000) / 200.000 = 5.00
  assert.equal(prev.ltifr, 5.00);
  // TRIR = ((0 + 1 LTI + 1 MTI) × 1.000.000) / 200.000 = 10.00
  assert.equal(prev.trir, 10.00);
  // SR = (10 hari hilang × 1.000.000) / 200.000 = 50.00
  assert.equal(prev.sr, 50.00);

  // Bulan berjalan memakai jam presensi live, bukan input manual internal lama
  assert.equal(cur.hours, 100000);
  assert.equal(cur.hoursStatus, 'BERJALAN');
  assert.equal(cur.uncountedDays, 3);

  // Bulan tanpa jam kerja: rasio tidak dihitung (null), bukan angka rekaan
  const empty = reports.monthlyStatistics.find(m => m.monthKey !== prevKey && m.monthKey !== curKey);
  assert.equal(empty.hours, 0);
  assert.equal(empty.hoursStatus, 'KOSONG');
  assert.equal(empty.ltifr, null);
  assert.ok(reports.summary.rolling12.hours >= 300000);
});

test('HSE saveManhours rejects internal company and only accepts registered contractors', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };
  let inserted = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('FROM hse_contractors')) {
        return { rows: params[2].trim().toLowerCase() === 'cv maju' ? [{ id: 'c1', company_name: 'CV Maju' }] : [] };
      }
      if (sql.includes('INSERT INTO hse_manhours')) {
        assert.ok(sql.includes("WHERE hse_manhours.source <> 'ATTENDANCE'"));
        inserted = params;
        return { rows: [{ id: 'm1', company_name: params[3], hours: params[5], source: 'MANUAL' }] };
      }
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => hseService.saveManhours(mockDb, scope, user, { period_month: '2026-10-01', hours: 100, company_name: 'PT internal' }),
    err => err.statusCode === 422 && /Jam kerja karyawan/.test(err.message),
  );
  await assert.rejects(
    () => hseService.saveManhours(mockDb, scope, user, { period_month: '2026-10-01', hours: 100, company_name: 'PT JMB-DKC' }),
    err => err.statusCode === 422,
  );
  const row = await hseService.saveManhours(mockDb, scope, user, { period_month: '2026-10-15', hours: 500, company_name: ' cv maju ' });
  assert.equal(row.company_name, 'CV Maju');
  assert.equal(inserted[2], '2026-10-01');
});

// Fase 3 Competency Tests
test('HSE createEmployeeLicense validates mandatory fields', async () => {
  const mockDb = { query: async () => ({ rows: [] }) };
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  await assert.rejects(
    async () => hseService.createEmployeeLicense(mockDb, scope, user, { employee_id: '' }),
    { statusCode: 400, message: 'Field employee_id, license_type, license_no, dan expiry_date wajib diisi' }
  );

  await assert.rejects(
    async () => hseService.createEmployeeLicense(mockDb, scope, user, { employee_id: 'u1', license_type: 'SIMPER', license_no: 'SIM-01', expiry_date: '' }),
    { statusCode: 400, message: 'Field employee_id, license_type, license_no, dan expiry_date wajib diisi' }
  );
});

test('HSE createInduction and createP5mEvent validate mandatory fields', async () => {
  const mockDb = { query: async () => ({ rows: [] }) };
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Trainer HSE' };

  await assert.rejects(
    async () => hseService.createInduction(mockDb, scope, user, { person_type: 'VISITOR', person_name: '', induction_date: '2026-10-10' }),
    { statusCode: 400, message: 'Field person_type, person_name, dan induction_date wajib diisi' }
  );

  await assert.rejects(
    async () => hseService.createP5mEvent(mockDb, scope, user, { topic: 'TBM' }),
    { statusCode: 422, message: 'Tanggal wajib diisi' }
  );

  await assert.rejects(
    async () => hseService.createP5mEvent(mockDb, scope, user, { event_date: '2026-10-10' }),
    { statusCode: 422, message: 'Shift wajib dipilih' }
  );
});

test('HSE getTrainingMatrix computes position compliance percentage accurately', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const mockDb = {
    query: async (sql) => {
      if (sql.includes('FROM hse_training_courses')) {
        return {
          rows: [
            { id: 'c1', code: 'TR-01', title: 'Induksi Dasar' },
            { id: 'c2', code: 'TR-02', title: 'Defensive Driving' },
          ],
        };
      }
      if (sql.includes('FROM hse_training_requirements')) {
        return {
          rows: [
            { position_name: 'Driver DT', course_id: 'c1', is_mandatory: true },
            { position_name: 'Driver DT', course_id: 'c2', is_mandatory: true },
          ],
        };
      }
      if (sql.includes('FROM users')) {
        return {
          rows: [
            { id: 'u1', nama: 'Budi Driver', jabatan: 'Driver DT', nrp: 'NRP001' },
            { id: 'u2', nama: 'Agus Driver', jabatan: 'Driver DT', nrp: 'NRP002' },
          ],
        };
      }
      if (sql.includes('FROM hse_training_records')) {
        return {
          rows: [
            // Budi completed c1 & c2 (100%)
            { employee_id: 'u1', course_id: 'c1', passed: true, certificate_no: 'CERT-1' },
            { employee_id: 'u1', course_id: 'c2', passed: true, certificate_no: 'CERT-2' },
            // Agus only completed c1 (50%)
            { employee_id: 'u2', course_id: 'c1', passed: true, certificate_no: 'CERT-3' },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const matrix = await hseService.getTrainingMatrix(mockDb, scope);
  assert.equal(matrix.courses.length, 2);
  assert.equal(matrix.employees.length, 2);

  const budi = matrix.employees.find(e => e.id === 'u1');
  assert.equal(budi.compliancePct, 100);

  const agus = matrix.employees.find(e => e.id === 'u2');
  assert.equal(agus.compliancePct, 50);

  const posCompliance = matrix.positionCompliance.find(p => p.position === 'Driver DT');
  // Total required = 4 slots (2 per employee * 2 employees). Fulfilled = 3 slots. Pct = 3/4 * 100 = 75.0%
  assert.equal(posCompliance.compliancePct, 75.0);
});

test('HSE Fase 4 PTW createPermit validates required fields and sets worker license status', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Foreman' };

  // Validation failure
  await assert.rejects(
    async () => hseService.createPermit({ query: async () => ({ rows: [] }) }, scope, user, {}),
    { statusCode: 400, message: 'Field permit_type, work_description, valid_from, dan valid_until wajib diisi' }
  );

  // Successful permit creation with license check
  const createdWorkers = [];
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT nextval') || sql.includes('SELECT name FROM hse_locations')) {
        return { rows: [{ name: 'Workshop' }] };
      }
      if (sql.includes('INSERT INTO hse_ptw_permits')) {
        return { rows: [{ id: 'ptw-test-1', permit_no: 'PTW-2610-001' }] };
      }
      if (sql.includes('SELECT nama, jabatan FROM users')) {
        return { rows: [{ nama: 'Budi Mekanik', jabatan: 'Mekanik' }] };
      }
      if (sql.includes('FROM hse_employee_licenses')) {
        // Return empty so license check evaluates to 'MISSING'
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO hse_ptw_workers')) {
        createdWorkers.push({ employee_id: params[1], worker_name: params[2], competency_check: params[4] });
        return { rows: [{ id: 'w-1' }] };
      }
      if (sql.includes('FROM hse_ptw_permits p')) {
        return {
          rows: [{
            id: 'ptw-test-1',
            permit_no: 'PTW-2610-001',
            permit_type: 'HOT_WORK',
            work_description: 'Las Chute',
            valid_from: '2026-10-09T08:00:00Z',
            valid_until: '2026-10-09T17:00:00Z',
            status: 'SUBMITTED',
          }]
        };
      }
      if (sql.includes('FROM hse_ptw_workers w')) {
        return { rows: createdWorkers };
      }
      if (sql.includes('FROM hse_ptw_isolations') || sql.includes('FROM hse_ptw_handovers')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const permit = await hseService.createPermit(mockDb, scope, user, {
    permit_type: 'HOT_WORK',
    work_description: 'Las Chute',
    valid_from: '2026-10-09T08:00:00Z',
    valid_until: '2026-10-09T17:00:00Z',
    workers: [{ employee_id: 'emp-1' }]
  });

  assert.equal(permit.permit_no, 'PTW-2610-001');
  assert.equal(createdWorkers.length, 1);
  assert.equal(createdWorkers[0].competency_check, 'MISSING');
});

test('HSE Fase 4 PTW overview correctly flags SIMOPS conflicts on concurrent active permits', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const mockDb = {
    query: async (sql) => {
      if (sql.includes('COUNT(*) FILTER (WHERE status = \'ACTIVE\'')) {
        return {
          rows: [{
            active_count: 2,
            pending_count: 1,
            approved_count: 1,
            closed_count: 1,
            expired_count: 0,
            total_count: 5,
          }]
        };
      }
      if (sql.includes('HAVING COUNT(*) >= 2')) {
        return {
          rows: [{
            location_id: 'loc-4',
            location_name: 'Main Workshop',
            active_permits_count: 2,
            permits: [
              { id: 'ptw-1', permit_no: 'PTW-2610-001', permit_type: 'HOT_WORK' },
              { id: 'ptw-4', permit_no: 'PTW-2610-004', permit_type: 'LOTO' }
            ]
          }]
        };
      }
      return { rows: [] };
    }
  };

  const overview = await hseService.getPtwOverview(mockDb, scope);
  assert.equal(overview.stats.active_count, 2);
  assert.equal(overview.simops.length, 1);
  assert.equal(overview.simops[0].location_name, 'Main Workshop');
  assert.equal(overview.simops[0].active_permits_count, 2);
});

test('HSE Fase 4 createInspection auto-creates corrective action (CAPA) when critical item is failed (NO)', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Auditor' };

  let actionCreated = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT name FROM hse_inspection_templates')) {
        return { rows: [{ name: 'P2H Dump Truck' }] };
      }
      if (sql.includes('SELECT name FROM hse_locations')) {
        return { rows: [{ name: 'Pit 1' }] };
      }
      if (sql.includes('SELECT nextval')) {
        return { rows: [{ nextval: '1' }] };
      }
      if (sql.includes('INSERT INTO hse_inspections')) {
        return { rows: [{ id: 'insp-1' }] };
      }
      if (sql.includes('INSERT INTO hse_actions')) {
        actionCreated = {
          source_type: params[3],
          source_id: params[4],
          description: params[5],
          action_type: params[6],
        };
        return { rows: [{ id: 'act-auto-1', action_no: 'CAPA-2610-099' }] };
      }
      if (sql.includes('INSERT INTO hse_inspection_answers')) {
        return { rows: [{ id: 'ans-1' }] };
      }
      if (sql.includes('FROM hse_inspections i')) {
        return {
          rows: [{
            id: 'insp-1',
            inspection_no: 'INSP-2610-001',
            status: 'COMPLETED',
            findings_count: 1,
          }]
        };
      }
      if (sql.includes('FROM hse_inspection_answers a')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const insp = await hseService.createInspection(mockDb, scope, user, {
    template_id: 'tmpl-2',
    location_id: 'loc-1',
    object_identifier: 'DT-785',
    photos: [HSE_TEST_PNG],
    answers: [
      {
        question: 'Uji rem utama dan retarder',
        is_critical: true,
        answer: 'NO',
        note: 'Rem amblas dan retarder tidak menggigit',
      }
    ]
  });

  assert.equal(insp.id, 'insp-1');
  assert.notEqual(actionCreated, null);
  assert.equal(actionCreated.source_type, 'INSPECTION');
  assert.equal(actionCreated.source_id, 'insp-1');
  assert.match(actionCreated.description, /Uji rem utama dan retarder/);
});

test('HSE createInspection enforces mandatory photo and validates inspection documents (PDF/DOCX/XLSX max 3 x 2MB)', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Auditor' };

  const baseDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT name FROM hse_inspection_templates')) return { rows: [{ name: 'P2H Dump Truck' }] };
      if (sql.includes('SELECT name FROM hse_locations')) return { rows: [{ name: 'Pit 1' }] };
      if (sql.includes('SELECT nextval')) return { rows: [{ nextval: '2' }] };
      if (sql.includes('INSERT INTO hse_inspections')) return { rows: [{ id: 'insp-3' }] };
      if (sql.includes('FROM hse_inspections i')) {
        return { rows: [{ id: 'insp-3', inspection_no: 'INSP-2610-002', status: 'COMPLETED', photos: [], documents: [] }] };
      }
      if (sql.includes('FROM hse_inspection_answers a')) return { rows: [] };
      return { rows: [] };
    },
  };

  // Foto wajib: tanpa foto -> 422
  await assert.rejects(
    () => hseService.createInspection(baseDb, scope, user, {
      template_id: 'tmpl-2', object_identifier: 'DT-785', answers: [],
    }),
    { statusCode: 422, message: 'Inspeksi wajib memiliki minimal 1 foto' }
  );

  // Dokumen dengan MIME tidak didukung -> 422
  await assert.rejects(
    () => hseService.createInspection(baseDb, scope, user, {
      template_id: 'tmpl-2', object_identifier: 'DT-785', photos: [HSE_TEST_PNG],
      documents: [{ name: 'catatan.txt', mime: 'text/plain', data: 'data:text/plain;base64,aGVsbG8=' }],
    }),
    { statusCode: 422, message: /Format dokumen tidak didukung/ }
  );

  // Dokumen melebihi 2 MB -> 422
  const hugePdf = `data:application/pdf;base64,${Buffer.alloc(2 * 1024 * 1024 + 10).toString('base64')}`;
  await assert.rejects(
    () => hseService.createInspection(baseDb, scope, user, {
      template_id: 'tmpl-2', object_identifier: 'DT-785', photos: [HSE_TEST_PNG],
      documents: [{ name: 'besar.pdf', mime: 'application/pdf', data: hugePdf }],
    }),
    { statusCode: 422, message: /melebihi batas 2 MB/ }
  );

  // Lebih dari 3 dokumen -> 422
  const threeDocs = [1, 2, 3, 4].map(i => ({ name: `dok-${i}.pdf`, mime: 'application/pdf', data: HSE_TEST_PDF }));
  await assert.rejects(
    () => hseService.createInspection(baseDb, scope, user, {
      template_id: 'tmpl-2', object_identifier: 'DT-785', photos: [HSE_TEST_PNG], documents: threeDocs,
    }),
    { statusCode: 422, message: /Maksimal 3 dokumen/ }
  );

  // Create sukses: foto dikompres, dokumen tervalidasi & tersimpan
  let insertedParams = null;
  const okDb = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO hse_inspections')) {
        insertedParams = params;
        return { rows: [{ id: 'insp-3' }] };
      }
      return baseDb.query(sql, params);
    },
  };
  const insp = await hseService.createInspection(okDb, scope, user, {
    template_id: 'tmpl-2', object_identifier: 'DT-785',
    photos: [HSE_TEST_PNG],
    documents: [{ name: 'dokumen-k3.pdf', mime: 'application/pdf', data: HSE_TEST_PDF }],
    answers: [],
  });
  assert.equal(insp.id, 'insp-3');
  assert.equal(insertedParams.length, 15, 'INSERT harus menyertakan photos ($14) dan documents ($15)');
  assert.ok(Array.isArray(insertedParams[13]) && insertedParams[13].length === 1, 'photos tersimpan sebagai array 1 foto');
  assert.match(insertedParams[13][0], /^data:image\//, 'foto dikompresi ke data-URL image');
  assert.equal(insertedParams[14][0].name, 'dokumen-k3.pdf');
  assert.equal(insertedParams[14][0].mime, 'application/pdf');
  assert.ok(insertedParams[14][0].size > 0);
});

test('HSE updateInspectionAttachments replace-set: rejects empty photos, keeps photos when omitted, and getInspectionDetail enriches modal fields', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Auditor' };

  let updateParams = null;
  let missingLookup = false;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('id, photos, documents')) {
        if (missingLookup) return { rows: [] };
        return { rows: [{ id: 'insp-9', photos: [HSE_TEST_PNG], documents: [] }] };
      }
      if (sql.includes('UPDATE hse_inspections')) {
        updateParams = params;
        return { rows: [{ id: 'insp-9' }] };
      }
      if (sql.includes('FROM hse_inspections i')) {
        return {
          rows: [{
            id: 'insp-9',
            inspection_no: 'INSP-2610-009',
            status: 'COMPLETED',
            inspected_by_name: 'Andi Saputra',
            object_identifier: 'EX-01',
            result_summary: 'Kondisi unit baik',
            photos: updateParams ? updateParams[0] : [HSE_TEST_PNG],
            documents: updateParams ? updateParams[1] : [],
          }],
        };
      }
      if (sql.includes('FROM hse_inspection_answers a')) {
        return {
          rows: [
            { question: 'Uji rem utama', note: 'Normal', answer: 'YES', is_critical: true },
            { question: 'Cek APAR', note: 'Tabung kosong', answer: 'NO', is_critical: true },
          ],
        };
      }
      return { rows: [] };
    },
  };

  // 404 saat inspeksi tidak ada
  missingLookup = true;
  await assert.rejects(
    () => hseService.updateInspectionAttachments(mockDb, scope, 'missing-id', { photos: [HSE_TEST_PNG] }),
    { statusCode: 404, message: 'Inspeksi tidak ditemukan' }
  );
  missingLookup = false;

  // Kosongkan foto -> 422 (tidak pernah tersimpan)
  await assert.rejects(
    () => hseService.updateInspectionAttachments(mockDb, scope, 'insp-9', { photos: [], documents: [] }),
    { statusCode: 422, message: 'Inspeksi wajib memiliki minimal 1 foto' }
  );
  assert.equal(updateParams, null, 'foto kosong tidak boleh menulis UPDATE');

  // Tanpa field photos -> pertahankan foto lama (compressNewPhotos keep-current)
  const kept = await hseService.updateInspectionAttachments(mockDb, scope, 'insp-9', { documents: [] });
  assert.equal(updateParams[0].length, 1, 'foto lama dipertahankan saat photos tidak dikirim');

  // Replace-set sukses dengan foto baru + dokumen
  updateParams = null;
  const doc = { name: 'laporan-inspeksi.pdf', mime: 'application/pdf', data: HSE_TEST_PDF };
  const res = await hseService.updateInspectionAttachments(mockDb, scope, 'insp-9', {
    photos: [HSE_TEST_PNG],
    documents: [doc],
  });
  assert.ok(updateParams, 'UPDATE harus dieksekusi');
  assert.equal(updateParams[0].length, 1);
  assert.equal(updateParams[1][0].name, 'laporan-inspeksi.pdf');
  assert.equal(updateParams[1][0].mime, 'application/pdf');

  // Enrichment getInspectionDetail untuk modal
  assert.equal(res.inspector_name, 'Andi Saputra');
  assert.equal(res.equipment_tag, 'EX-01');
  assert.equal(res.notes, 'Kondisi unit baik');
  assert.equal(res.pass_rate_pct, 50, 'pass rate = YES / total jawaban');
  assert.equal(res.criticalFindings.length, 1, 'temuan kritis = is_critical && NO');
  assert.equal(res.answers[0].item_prompt, 'Uji rem utama', 'item_prompt = question');
  assert.equal(res.answers[1].notes, 'Tabung kosong', 'notes = note');
});

// -------------------------------------------------------------
// FASE 5: OCCUPATIONAL HEALTH (KESEHATAN KERJA) UNIT TESTS
// -------------------------------------------------------------

test('HSE Fase 5 createMcuRecord validates required fields and inserts MCU', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Medic Site' };

  await assert.rejects(
    async () => hseService.createMcuRecord({ query: async () => ({ rows: [] }) }, scope, user, { employee_id: '' }),
    { statusCode: 400, message: 'Field employee_id, mcu_date, dan valid_until wajib diisi' }
  );

  let inserted = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT nama')) {
        return { rows: [{ nama: 'Andi', nrp: 'EMP-01', jabatan: 'Foreman' }] };
      }
      if (sql.includes('INSERT INTO hse_mcu_records')) {
        inserted = {
          employee_id: params[2],
          mcu_type: params[6],
          mcu_date: params[7],
          valid_until: params[11],
          fitness_result: params[9],
        };
        return { rows: [{ id: 'mcu-123', fitness_result: 'FIT' }] };
      }
      return { rows: [] };
    }
  };

  const res = await hseService.createMcuRecord(mockDb, scope, user, {
    employee_id: 'emp-01',
    mcu_type: 'PERIODIC',
    mcu_date: '2026-10-09',
    valid_until: '2027-10-09',
    fitness_result: 'FIT',
  });

  assert.equal(res.id, 'mcu-123');
  assert.equal(inserted.employee_id, 'emp-01');
  assert.equal(inserted.mcu_type, 'PERIODIC');
  assert.equal(inserted.fitness_result, 'FIT');
});

test('HSE Fase 5 createFfwCheck enforces fatigue safeguard (sleep_hours < 5 auto-sets UNFIT)', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Safety Officer' };

  let insertedFfw = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT nama')) {
        return { rows: [{ nama: 'Budi', nrp: 'EMP-02', jabatan: 'Operator' }] };
      }
      if (sql.includes('INSERT INTO hse_fit_for_work_checks')) {
        insertedFfw = {
          employee_id: params[2],
          sleep_hours: params[8],
          result: params[13],
          action_taken: params[14],
        };
        return { rows: [{ id: 'ffw-101', result: params[13] }] };
      }
      return { rows: [] };
    }
  };

  // User explicitly selects FIT, but sleep_hours is 4.0 (< 5.0)
  const res = await hseService.createFfwCheck(mockDb, scope, user, {
    employee_id: 'emp-02',
    check_date: '2026-10-09',
    shift: 'SHIFT_1',
    sleep_hours: 4.0,
    result: 'FIT',
    action_taken: '',
    checked_by_name: 'Medic',
  });

  assert.equal(res.id, 'ffw-101');
  assert.equal(insertedFfw.result, 'UNFIT', 'Fatigue safeguard must override result to UNFIT');
  assert.match(insertedFfw.action_taken, /Jam tidur < 5 jam/);
});

test('HSE Fase 5 createHealthCase generates sequential case_no MED-YYMM-NNN', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Doctor Site' };

  let insertedCase = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT') && sql.includes('case_no')) {
        return { rows: [{ last_no: 'MED-2610-004' }] };
      }
      if (sql.includes('SELECT nama')) {
        return { rows: [{ nama: 'Rudi', nrp: 'EMP-03', jabatan: 'Mekanik' }] };
      }
      if (sql.includes('INSERT INTO hse_health_cases')) {
        insertedCase = {
          case_no: params[2],
          employee_id: params[3],
          case_type: params[8],
          diagnosis_summary: params[10],
        };
        return { rows: [{ id: 'case-555', case_no: params[2] }] };
      }
      return { rows: [] };
    }
  };

  const res = await hseService.createHealthCase(mockDb, scope, user, {
    employee_id: 'emp-03',
    case_date: '2026-10-09',
    case_type: 'WORK_RELATED',
    diagnosis_summary: 'Nyeri pergelangan tangan berulang',
  });

  assert.equal(res.id, 'case-555');
  assert.equal(insertedCase.case_no, 'MED-2610-005', 'Sequence generator must produce MED-2610-005');
  assert.equal(insertedCase.case_type, 'WORK_RELATED');
});

test('HSE Fase 5 createHygieneMeasurement evaluates NAB thresholds correctly', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Industrial Hygienist' };

  const testCases = [
    // Noise: NAB = 85. 88.5 is EXCEEDED. 75.0 is OK.
    { param: 'NOISE', val: 88.5, nab: 85.0, unit: 'dBA', expected: 'EXCEEDED' },
    { param: 'NOISE', val: 75.0, nab: 85.0, unit: 'dBA', expected: 'OK' },
    // Lighting: NAB = 100. For lighting, LOWER than NAB is EXCEEDED. 45 Lux is EXCEEDED. 150 Lux is OK.
    { param: 'LIGHTING', val: 45.0, nab: 100.0, unit: 'Lux', expected: 'EXCEEDED' },
    { param: 'LIGHTING', val: 150.0, nab: 100.0, unit: 'Lux', expected: 'OK' },
  ];

  for (const tc of testCases) {
    let insertedStatus = null;
    const mockDb = {
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO hse_hygiene_measurements')) {
          insertedStatus = params[10];
          return { rows: [{ id: 'hyg-' + tc.param, status: insertedStatus }] };
        }
        return { rows: [] };
      }
    };

    await hseService.createHygieneMeasurement(mockDb, scope, user, {
      sampling_point: 'Pit 1 Area',
      parameter: tc.param,
      measured_value: tc.val,
      threshold_nab: tc.nab,
      unit: tc.unit,
    });

    assert.equal(insertedStatus, tc.expected, `Parameter ${tc.param} with val=${tc.val} nab=${tc.nab} should evaluate to ${tc.expected}`);
  }
});

// ============================================================================
// FASE 6: TANGGAP DARURAT & APD / PERALATAN TESTS
// ============================================================================

test('HSE Fase 6 createEmergencyDrill generates sequential drill_no DRL-YYMM-NNN', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'ERT Commander' };

  let insertedDrill = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT') && sql.includes('drill_no')) {
        return { rows: [{ last_no: 'DRL-2610-002' }] };
      }
      if (sql.includes('SELECT name FROM hse_locations')) {
        return { rows: [{ name: 'Pit 1 Selatan' }] };
      }
      if (sql.includes('INSERT INTO hse_emergency_drills')) {
        insertedDrill = {
          drill_no: params[2],
          drill_date: params[3],
          scenario: params[4],
          scenario_title: params[5],
          participant_count: params[8],
          result: params[11],
        };
        return { rows: [{ id: 'drl-999', drill_no: params[2] }] };
      }
      return { rows: [] };
    }
  };

  const res = await hseService.createEmergencyDrill(mockDb, scope, user, {
    drill_date: '2026-10-09',
    scenario: 'FIRE',
    scenario_title: 'Simulasi Tanggap Darurat Kebakaran Workshop Fuel Bay',
    location_id: 'loc-1',
    participant_count: 20,
    result: 'GOOD',
  });

  assert.equal(res.id, 'drl-999');
  assert.equal(insertedDrill.drill_no, 'DRL-2610-003', 'Sequence generator must produce DRL-2610-003');
  assert.equal(insertedDrill.scenario, 'FIRE');
  assert.equal(insertedDrill.result, 'GOOD');
});

test('HSE Fase 6 listEmergencyEquipment computes OVERDUE and DUE statuses dynamically', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };

  const mockDb = {
    query: async (sql) => {
      if (sql.includes('FROM hse_emergency_equipment')) {
        return {
          rows: [
            {
              id: 'eq-1', equipment_code: 'APAR-WS-01', equipment_type: 'FIRE_EXTINGUISHER',
              recorded_status: 'GOOD', computed_status: 'OVERDUE'
            },
            {
              id: 'eq-2', equipment_code: 'BOX-P3K-01', equipment_type: 'FIRST_AID_BOX',
              recorded_status: 'GOOD', computed_status: 'DUE'
            },
            {
              id: 'eq-3', equipment_code: 'APAR-PIT-02', equipment_type: 'FIRE_EXTINGUISHER',
              recorded_status: 'GOOD', computed_status: 'GOOD'
            },
            {
              id: 'eq-4', equipment_code: 'EYEWASH-01', equipment_type: 'EYEWASH',
              recorded_status: 'DEFECTIVE', computed_status: 'DEFECTIVE'
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const list = await hseService.listEmergencyEquipment(mockDb, scope);
  assert.equal(list.length, 4);
  assert.equal(list[0].status, 'OVERDUE');
  assert.equal(list[1].status, 'DUE');
  assert.equal(list[2].status, 'GOOD');
  assert.equal(list[3].status, 'DEFECTIVE');
});

test('HSE Fase 6 createPpeIssuance calculates replace_due_date from catalog interval and updates stock', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Logistik HSE' };

  let insertedIssuance = null;
  let stockUpdated = false;

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT nama, nrp')) {
        return { rows: [{ nama: 'Andi Saputra', nrp: 'EMP-001', departemen: 'Mining', jabatan: 'Foreman' }] };
      }
      if (sql.includes('SELECT name, category, replace_interval_months')) {
        return { rows: [{ name: 'Safety Helmet V-Gard', category: 'HEAD', replace_interval_months: 24, current_stock: 40 }] };
      }
      if (sql.includes('INSERT INTO hse_ppe_issuances')) {
        insertedIssuance = {
          employee_id: params[2],
          employee_name: params[3],
          ppe_item_name: params[8],
          issued_date: params[12],
          replace_due_date: params[13],
          status: 'ACTIVE',
        };
        return { rows: [{ id: 'iss-777', ...insertedIssuance }] };
      }
      if (sql.includes('UPDATE hse_ppe_items')) {
        stockUpdated = true;
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const res = await hseService.createPpeIssuance(mockDb, scope, user, {
    employee_id: 'emp-01',
    ppe_item_id: 'ppe-helm-01',
    issued_date: '2026-10-01',
    quantity: 1,
    reason: 'NEW_HIRE',
  });

  assert.equal(res.id, 'iss-777');
  assert.equal(insertedIssuance.employee_name, 'Andi Saputra');
  // 2026-10-01 + 24 months = 2028-10-01
  assert.equal(insertedIssuance.replace_due_date, '2028-10-01', 'Replace due date must be 24 months ahead');
  assert.equal(stockUpdated, true, 'Stock must be deducted');
});

test('HSE Fase 6 returnPpeIssuance updates status to RETURNED', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('UPDATE hse_ppe_issuances')) {
        return { rows: [{ id: params[2], status: 'RETURNED', returned_date: params[0] }] };
      }
      return { rows: [] };
    }
  };

  const res = await hseService.returnPpeIssuance(mockDb, scope, user, 'iss-777', {
    returned_date: '2026-10-09',
    notes: 'Karyawan mutasi site',
  });

  assert.equal(res.id, 'iss-777');
  assert.equal(res.status, 'RETURNED');
  assert.equal(res.returned_date, '2026-10-09');
});

test('HSE Fase 7 createContractorAssessment automatically calculates result (APPROVED >= 75, CONDITIONAL 60-74, REJECTED < 60)', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  let insertedAssessment = null;

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT company_name FROM hse_contractors')) {
        return { rows: [{ company_name: 'PT Petro Tambang Mandiri' }] };
      }
      if (sql.includes('INSERT INTO hse_contractor_assessments')) {
        insertedAssessment = {
          contractor_id: params[2],
          score: params[6],
          result: params[7],
          valid_until: params[9],
        };
        return { rows: [{ id: 'ass-1', ...insertedAssessment }] };
      }
      return { rows: [] };
    }
  };

  // Test Approved (score 85)
  const resAppr = await hseService.createContractorAssessment(mockDb, scope, user, {
    contractor_id: 'ctr-1',
    score: 85,
    assessor_name: 'Tim CSMS',
  });
  assert.equal(resAppr.result, 'APPROVED');

  // Test Conditional (score 70)
  const resCond = await hseService.createContractorAssessment(mockDb, scope, user, {
    contractor_id: 'ctr-1',
    score: 70,
    assessor_name: 'Tim CSMS',
  });
  assert.equal(resCond.result, 'CONDITIONAL');

  // Test Rejected (score 50)
  const resRej = await hseService.createContractorAssessment(mockDb, scope, user, {
    contractor_id: 'ctr-1',
    score: 50,
    assessor_name: 'Tim CSMS',
  });
  assert.equal(resRej.result, 'REJECTED');
});

test('HSE Fase 7 createContractorViolation and resolveContractorViolation', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  let violationInserted = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT company_name FROM hse_contractors')) {
        return { rows: [{ company_name: 'PT Petro Tambang Mandiri' }] };
      }
      if (sql.includes('INSERT INTO hse_contractor_violations')) {
        violationInserted = {
          contractor_id: params[2],
          severity: params[8],
          status: 'OPEN',
        };
        return { rows: [{ id: 'viol-1', ...violationInserted }] };
      }
      if (sql.includes('UPDATE hse_contractor_violations')) {
        return { rows: [{ id: params[1], status: 'RESOLVED' }] };
      }
      return { rows: [] };
    }
  };

  const created = await hseService.createContractorViolation(mockDb, scope, user, {
    contractor_id: 'ctr-1',
    violation_date: '2026-10-09',
    severity: 'CRITICAL',
    description: 'Unit hauling overspeeding',
    sanction_type: 'STOP_WORK',
  });

  assert.equal(created.id, 'viol-1');
  assert.equal(created.severity, 'CRITICAL');

  const resolved = await hseService.resolveContractorViolation(mockDb, scope, user, 'viol-1', {
    resolution_notes: 'Pengemudi telah ditindak dan dire-training K3',
  });
  assert.equal(resolved.status, 'RESOLVED');
});

test('HSE Fase 7 createWasteB3Log sets storage deadline default 90 days', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  let wasteInserted = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT name FROM hse_locations')) {
        return { rows: [{ name: 'Workshop Utama' }] };
      }
      if (sql.includes('INSERT INTO hse_env_waste_b3_logs')) {
        wasteInserted = {
          waste_code: params[3],
          quantity: params[7],
          unit: params[8],
          storage_deadline: params[11],
          status: params[15],
        };
        return { rows: [{ id: 'b3-1', ...wasteInserted }] };
      }
      return { rows: [] };
    }
  };

  const res = await hseService.createWasteB3Log(mockDb, scope, user, {
    log_date: '2026-10-01',
    waste_code: 'B105d',
    waste_name: 'Oli Bekas',
    source_location_id: 'loc-workshop',
    quantity: 200,
    unit: 'LITER',
  });

  assert.equal(res.id, 'b3-1');
  assert.equal(wasteInserted.waste_code, 'B105d');
  assert.equal(wasteInserted.status, 'STORED');
  // 2026-10-01 + 90 days = 2026-12-30
  assert.equal(wasteInserted.storage_deadline, '2026-12-30');
});

test('HSE Fase 7 createEnvMeasurement evaluates compliance status automatically (COMPLIES, NEAR_LIMIT, EXCEEDED)', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  let evaluatedStatus = null;
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('FROM hse_env_monitoring_points')) {
        return { rows: [{ name: 'Outlet KPL Pit 1', media: 'WATER' }] };
      }
      if (sql.includes('FROM hse_env_parameters')) {
        // pH 6.0 - 9.0
        if (params[0] === 'param-ph') {
          return { rows: [{ parameter_name: 'pH', unit: 'pH', limit_min: 6.0, limit_max: 9.0 }] };
        }
        // TSS max 200
        return { rows: [{ parameter_name: 'TSS', unit: 'mg/L', limit_min: null, limit_max: 200.0 }] };
      }
      if (sql.includes('INSERT INTO hse_env_measurements')) {
        evaluatedStatus = params[12];
        return { rows: [{ id: 'meas-1', status: evaluatedStatus }] };
      }
      return { rows: [] };
    }
  };

  // pH normal (7.5) -> COMPLIES
  await hseService.createEnvMeasurement(mockDb, scope, user, {
    point_id: 'pt-1',
    parameter_id: 'param-ph',
    measured_value: 7.5,
  });
  assert.equal(evaluatedStatus, 'COMPLIES');

  // pH melebihi batas atas (9.5) -> EXCEEDED
  await hseService.createEnvMeasurement(mockDb, scope, user, {
    point_id: 'pt-1',
    parameter_id: 'param-ph',
    measured_value: 9.5,
  });
  assert.equal(evaluatedStatus, 'EXCEEDED');

  // TSS mendekati batas (180 >= 85% of 200 = 170) -> NEAR_LIMIT
  await hseService.createEnvMeasurement(mockDb, scope, user, {
    point_id: 'pt-1',
    parameter_id: 'param-tss',
    measured_value: 180,
  });
  assert.equal(evaluatedStatus, 'NEAR_LIMIT');

  // TSS melebihi batas (240 > 200) -> EXCEEDED
  await hseService.createEnvMeasurement(mockDb, scope, user, {
    point_id: 'pt-1',
    parameter_id: 'param-tss',
    measured_value: 240,
  });
  assert.equal(evaluatedStatus, 'EXCEEDED');
});

// Fase 8 Audit, SMKP, Dokumen & Regulasi Tests
test('HSE Fase 8 createAudit validates mandatory fields and inserts audit', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO hse_audits')) {
        return {
          rows: [{
            id: 'aud-test-1',
            audit_no: params[2],
            title: params[5],
            audit_type: params[3],
            status: params[11],
          }],
        };
      }
      return { rows: [] };
    }
  };

  await assert.rejects(
    async () => hseService.createAudit(mockDb, scope, user, { title: 'Audit SMKP' }),
    { statusCode: 422, message: 'Judul audit, lingkup/standar, dan lead auditor wajib diisi' }
  );

  const res = await hseService.createAudit(mockDb, scope, user, {
    audit_no: 'AUD-2026-003',
    title: 'Audit Internal SMKP Semester I',
    audit_type: 'INTERNAL',
    scope: 'SMKP Minerba Permen ESDM 26/2018',
    audit_date_start: '2026-05-10',
    audit_date_end: '2026-05-14',
    lead_auditor: 'Bambang Sudibyo',
  });

  assert.equal(res.id, 'aud-test-1');
  assert.equal(res.audit_no, 'AUD-2026-003');
  assert.equal(res.status, 'PLANNED');
});

test('HSE Fase 8 createAuditFinding automatically links to CAPA (hse_actions) for MAJOR/MINOR findings', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  let capaCreated = null;
  let findingInserted = null;

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('FROM hse_audits')) {
        return { rows: [{ id: 'aud-1', audit_no: 'AUD-2026-001' }] };
      }
      if (sql.includes('INSERT INTO hse_actions')) {
        capaCreated = {
          action_no: params[2],
          source_type: 'AUDIT',
          action_type: 'CORRECTIVE',
          description: params[5],
          due_date: params[7],
        };
        return { rows: [{ id: 'act-capa-01', action_no: params[2] }] };
      }
      if (sql.includes('INSERT INTO hse_audit_findings')) {
        findingInserted = {
          finding_no: params[4],
          category: params[6],
          description: params[7],
          action_id: params[9],
        };
        return { rows: [{ id: 'fnd-test-01', finding_no: params[4], action_id: params[9] }] };
      }
      return { rows: [] };
    }
  };

  await assert.rejects(
    async () => hseService.createAuditFinding(mockDb, scope, user, { audit_id: 'aud-1', finding_no: 'FND-01' }),
    { statusCode: 422, message: 'Audit, klausul/elemen, dan uraian temuan wajib diisi' }
  );

  const res = await hseService.createAuditFinding(mockDb, scope, user, {
    audit_id: 'aud-1',
    finding_no: 'FND-2026-010',
    element_or_clause: 'Klausul IV.3 Izin Kerja',
    category: 'MAJOR',
    description: 'Pekerjaan panas tanpa izin hot work',
    pic_name: 'Budi Santoso',
    due_date: '2026-04-01',
    create_capa: true,
  });

  assert.equal(res.id, 'fnd-test-01');
  assert.ok(capaCreated, 'CAPA action should be created for MAJOR finding');
  assert.equal(capaCreated.source_type, 'AUDIT');
  assert.equal(capaCreated.action_type, 'CORRECTIVE');
  assert.equal(findingInserted.action_id, 'act-capa-01');
});

test('HSE Fase 8 resolveAuditFinding updates finding status and resolution notes', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  let updatedNotes = null;

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('UPDATE hse_audit_findings')) {
        if (params[1] === 'non-existent') {
          return { rows: [] };
        }
        updatedNotes = params[0];
        return { rows: [{ id: params[1], status: 'CLOSED', resolution_notes: updatedNotes }] };
      }
      return { rows: [] };
    }
  };

  await assert.rejects(
    async () => hseService.resolveAuditFinding(mockDb, scope, user, 'non-existent', {}),
    { statusCode: 404, message: 'Temuan audit tidak ditemukan' }
  );

  const res = await hseService.resolveAuditFinding(mockDb, scope, user, 'fnd-1', {
    resolution_notes: 'Tindakan perbaikan telah diverifikasi efektif oleh Lead Auditor',
  });

  assert.equal(res.status, 'CLOSED');
  assert.match(updatedNotes, /diverifikasi efektif/);
});

test('HSE Fase 8 createDocument and createDocumentRevision manage documents lifecycle', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  let revisionCreated = null;
  let docUpdatedRev = null;

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO hse_documents')) {
        return {
          rows: [{
            id: 'doc-test-1',
            doc_number: params[2],
            title: params[3],
            doc_type: params[4],
            revision_no: params[5],
            status: params[10],
          }],
        };
      }
      if (sql.includes('FROM hse_documents')) {
        return { rows: [{ revision_no: 0 }] };
      }
      if (sql.includes('INSERT INTO hse_document_revisions')) {
        revisionCreated = {
          document_id: params[2],
          revision_no: params[3],
          change_summary: params[4],
        };
        return { rows: [{ id: 'rev-01', ...revisionCreated }] };
      }
      if (sql.includes('UPDATE hse_documents')) {
        docUpdatedRev = params[0];
        return { rows: [{ id: 'doc-test-1', revision_no: docUpdatedRev }] };
      }
      return { rows: [] };
    }
  };

  await assert.rejects(
    async () => hseService.createDocument(mockDb, scope, user, { doc_number: 'SOP-001' }),
    { statusCode: 422, message: 'Nomor dokumen, judul, dan pemilik/pengesah dokumen wajib diisi' }
  );

  const newDoc = await hseService.createDocument(mockDb, scope, user, {
    doc_number: 'SOP-HSE-MINE-012',
    title: 'SOP Penanganan Tumpahan B3 di Pit',
    doc_type: 'SOP',
    effective_date: '2026-04-01',
    owner: 'K3LH',
  });

  assert.equal(newDoc.doc_number, 'SOP-HSE-MINE-012');
  assert.equal(newDoc.revision_no, 0);

  // Buat revisi baru Rev 1
  const rev = await hseService.createDocumentRevision(mockDb, scope, user, 'doc-test-1', {
    change_summary: 'Penambahan klausul APD penanganan ceceran solar',
    approved_by_name: 'Budi Santoso',
  });

  assert.equal(rev.revision_no, 1);
  assert.equal(docUpdatedRev, 1);
  assert.match(revisionCreated.change_summary, /Penambahan klausul/);
});

test('HSE Fase 8 createLegalRegister and updateMandatoryReportStatus operate correctly', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1' };

  let updatedReportStatus = null;

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO hse_legal_register')) {
        return {
          rows: [{
            id: 'leg-test-1',
            reg_number: params[3],
            title: params[2],
            issuing_body: params[4],
            compliance_status: params[7],
          }],
        };
      }
      if (sql.includes('UPDATE hse_mandatory_reports')) {
        if (params[5] === 'non-existent') {
          return { rows: [] };
        }
        updatedReportStatus = params[0];
        return {
          rows: [{
            id: params[5],
            status: updatedReportStatus,
            submission_date: params[1],
            receipt_no: params[2],
          }],
        };
      }
      return { rows: [] };
    }
  };

  await assert.rejects(
    async () => hseService.createLegalRegister(mockDb, scope, user, { reg_number: 'UU 1/1970' }),
    { statusCode: 422, message: 'Judul regulasi, nomor regulasi, dan ringkasan persyaratan wajib diisi' }
  );

  const leg = await hseService.createLegalRegister(mockDb, scope, user, {
    reg_number: 'Permen ESDM 26/2018',
    title: 'Kaidah Pertambangan Yang Baik',
    issuing_body: 'ESDM_MINERBA',
    compliance_requirements: 'Penerapan SMKP Minerba',
    compliance_status: 'COMPLIANT',
  });

  assert.equal(leg.reg_number, 'Permen ESDM 26/2018');
  assert.equal(leg.compliance_status, 'COMPLIANT');

  await assert.rejects(
    async () => hseService.updateMandatoryReportStatus(mockDb, scope, user, 'non-existent', {
      status: 'SUBMITTED',
      submission_date: '2026-04-08',
    }),
    { statusCode: 404, message: 'Laporan wajib tidak ditemukan' }
  );

  const rep = await hseService.updateMandatoryReportStatus(mockDb, scope, user, 'rep-test-1', {
    status: 'SUBMITTED',
    submission_date: '2026-04-08',
    receipt_no: 'TT-ESDM-009',
  });

  assert.equal(rep.status, 'SUBMITTED');
  assert.equal(updatedReportStatus, 'SUBMITTED');
  assert.equal(rep.receipt_no, 'TT-ESDM-009');
});

test('HSE IBPR risk register validates fields, calculates score & level, and aggregates overview', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'HSE Superintendent' };

  const mockDb = {
    query: async (sql, params = []) => {
      const q = String(sql).toLowerCase();
      if (q.includes('count(*)::int as count from hse_risk_register where risk_no like')) {
        return { rows: [{ count: 0 }] };
      }
      if (q.includes('insert into hse_risk_register')) {
        return {
          rows: [{
            id: 'rsk-test-1',
            risk_no: params[2],
            activity: params[3],
            department_name: params[5],
            hazard: params[6],
            consequence_desc: params[7],
            initial_likelihood: params[8],
            initial_consequence: params[9],
            initial_score: params[10],
            initial_level: params[11],
            controls: typeof params[12] === 'string' ? JSON.parse(params[12]) : params[12],
            residual_likelihood: params[13],
            residual_consequence: params[14],
            residual_score: params[15],
            residual_level: params[16],
            owner_name: params[18],
            review_date: params[19],
            status: params[20],
          }]
        };
      }
      if (q.includes('select') && q.includes('from hse_risk_register') && q.includes('residual_score desc')) {
        return {
          rows: [{
            id: 'rsk-test-1',
            risk_no: 'RSK-2610-001',
            activity: 'Pengisian Bahan Bakar di Fuel Station',
            initial_score: 16,
            initial_level: 'HIGH',
            residual_score: 6,
            residual_level: 'MEDIUM',
          }]
        };
      }
      if (q.includes('count(*)::int as total') || q.includes("residual_level = 'extreme'")) {
        return {
          rows: [{
            total: 1,
            extreme_count: 0,
            high_count: 0,
            medium_count: 1,
            low_count: 0,
            review_due_count: 0,
          }]
        };
      }
      if (q.includes('residual_likelihood as l') || q.includes('group by residual_likelihood')) {
        return {
          rows: [{
            l: 2,
            c: 3,
            count: 1,
          }]
        };
      }
      return { rows: [] };
    }
  };

  // Validasi field wajib
  await assert.rejects(
    async () => hseService.createRiskRegisterItem(mockDb, scope, user, { activity: '' }),
    { statusCode: 400, message: 'Field activity, hazard, consequence_desc, nilai likelihood & consequence (awal & sisa) wajib diisi' }
  );

  // Berhasil membuat item risiko dengan kalkulasi skor dan level
  const created = await hseService.createRiskRegisterItem(mockDb, scope, user, {
    activity: 'Pengisian Bahan Bakar di Fuel Station',
    department_name: 'Mining Operations',
    hazard: 'Tumpahan hidrokarbon / solar',
    consequence_desc: 'Kebakaran dispenser fuel dan luka bakar',
    initial_likelihood: 4,
    initial_consequence: 4,
    controls: [
      { hierarchy: 'ENGINEERING', description: 'Emergency shut-off valve otomatis' },
      { hierarchy: 'ADMINISTRATIVE', description: 'SOP Refueling No. SOP-MIN-012' },
      { hierarchy: 'PPE', description: 'Wearpack tahan api' }
    ],
    residual_likelihood: 2,
    residual_consequence: 3,
    owner_name: 'Budi Santoso',
    review_date: '2026-11-01',
    status: 'ACTIVE'
  });

  assert.equal(created.initial_score, 16);
  assert.equal(created.initial_level, 'HIGH');
  assert.equal(created.residual_score, 6);
  assert.equal(created.residual_level, 'MEDIUM');
  assert.equal(created.controls.length, 3);
  assert.match(created.risk_no, /^RSK-/);

  // List register risiko
  const list = await hseService.listRiskRegister(mockDb, scope, { status: 'ACTIVE' });
  assert.equal(list.length, 1);
  assert.equal(list[0].initial_level, 'HIGH');

  // Overview aggregasi dan matriks 5x5
  const overview = await hseService.getRiskRegisterOverview(mockDb, scope);
  assert.equal(overview.totalRisks, 1);
  assert.equal(overview.mediumCount, 1);
  assert.equal(overview.matrix.length, 25);
  const cell2_3 = overview.matrix.find(m => m.likelihood === 2 && m.consequence === 3);
  assert.ok(cell2_3);
  assert.equal(cell2_3.score, 6);
  assert.equal(cell2_3.level, 'MEDIUM');
  assert.equal(cell2_3.count, 1);
});

test('HSE location management handles tree structure, creation, validation, and child deletion blocking', async () => {
  const locationsDb = [
    { id: 'loc-1', code: 'PIT', name: 'PIT', type: 'PIT', parent_id: null, is_active: true, deleted_at: null },
    { id: 'loc-2', code: 'PIT-BLK1', name: 'Blok 1', type: 'PIT', parent_id: 'loc-1', is_active: true, deleted_at: null },
    { id: 'loc-3', code: 'ROAD', name: 'Jalan Hauling', type: 'HAUL_ROAD', parent_id: null, is_active: true, deleted_at: null }
  ];

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('FROM hse_locations l')) {
        const rows = locationsDb.filter(l => !l.deleted_at).map(l => {
          const parent = locationsDb.find(p => p.id === l.parent_id);
          return {
            ...l,
            parent_name: parent ? parent.name : null,
            parent_code: parent ? parent.code : null
          };
        });
        return { rows };
      }
      if (sql.includes('SELECT id FROM hse_locations WHERE') && sql.includes('code = $3')) {
        const code = params[2];
        const excludeId = params[3];
        const match = locationsDb.find(l => l.code === code && (!excludeId || l.id !== excludeId) && !l.deleted_at);
        return { rows: match ? [match] : [] };
      }
      if (sql.includes('SELECT type FROM hse_locations WHERE id = $1')) {
        const parent = locationsDb.find(l => l.id === params[0]);
        return { rows: parent ? [{ type: parent.type }] : [] };
      }
      if (sql.includes('INSERT INTO hse_locations')) {
        const row = {
          id: `loc-${locationsDb.length + 1}`,
          code: params[2],
          name: params[3],
          type: params[4],
          parent_id: params[5],
          latitude: params[6],
          longitude: params[7],
          is_active: true,
          deleted_at: null
        };
        locationsDb.push(row);
        return { rows: [row] };
      }
      if (sql.includes('SELECT * FROM hse_locations WHERE id = $1')) {
        const row = locationsDb.find(l => l.id === params[0] && !l.deleted_at);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('UPDATE hse_locations') && sql.includes('SET code = $1')) {
        const idx = locationsDb.findIndex(l => l.id === params[7]);
        if (idx >= 0) {
          locationsDb[idx] = {
            ...locationsDb[idx],
            code: params[0],
            name: params[1],
            type: params[2],
            parent_id: params[3]
          };
          return { rows: [locationsDb[idx]] };
        }
        return { rows: [] };
      }
      if (sql.includes('SELECT COUNT(*) AS count FROM hse_locations WHERE parent_id = $1')) {
        const count = locationsDb.filter(l => l.parent_id === params[0] && !l.deleted_at).length;
        return { rows: [{ count }] };
      }
      if (sql.includes('UPDATE hse_locations') && sql.includes('SET deleted_at = CURRENT_TIMESTAMP')) {
        const row = locationsDb.find(l => l.id === params[0] && !l.deleted_at);
        if (row) {
          row.deleted_at = new Date();
          return { rows: [row] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Admin' };

  // 1. List Tree
  const tree = await hseService.listLocationsTree(mockDb, scope);
  assert.equal(tree.totalAreas, 2);
  assert.equal(tree.totalSubAreas, 1);
  const pit = tree.items.find(i => i.code === 'PIT');
  assert.ok(pit);
  assert.equal(pit.sub_areas.length, 1);
  assert.equal(pit.sub_areas[0].code, 'PIT-BLK1');

  // 2. Create Area Induk
  const newArea = await hseService.createLocation(mockDb, scope, user, {
    name: 'Workshop Baru',
    type: 'WORKSHOP',
    code: 'WS-NEW'
  });
  assert.equal(newArea.code, 'WS-NEW');
  assert.equal(newArea.parent_id, null);

  // 3. Create Sub Area (inherits parent type)
  const newSub = await hseService.createLocation(mockDb, scope, user, {
    name: 'Bay 1',
    parent_id: newArea.id
  });
  assert.equal(newSub.parent_id, newArea.id);
  assert.equal(newSub.type, 'WORKSHOP');

  // 4. Block deleting parent that has child
  await assert.rejects(
    async () => hseService.deleteLocation(mockDb, scope, user, newArea.id),
    { message: 'Area ini masih memiliki Sub-Area aktif. Hapus atau pindahkan Sub-Area terlebih dahulu.' }
  );

  // 5. Delete child first, then parent can be deleted
  const delChild = await hseService.deleteLocation(mockDb, scope, user, newSub.id);
  assert.equal(delChild.success, true);
  const delParent = await hseService.deleteLocation(mockDb, scope, user, newArea.id);
  assert.equal(delParent.success, true);
});

test('HSE Setup Inspeksi template management handles creation, validation, lock guard, and versioning', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'usr-1', nama: 'Safety Admin' };

  const templates = [];
  const items = [];
  const audits = [];

  const mockDb = {
    connect: async () => ({
      query: async (sql, params) => mockDb.query(sql, params),
      release: () => {},
    }),
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO hse_inspection_templates')) {
        const id = 'tmpl-' + (templates.length + 1);
        const root_id = params[9] || id;
        const row = {
          id,
          root_id,
          version_no: params[10] || 1,
          is_current: true,
          locked_at: null,
          tenant_key: params[0],
          project_key: params[1],
          code: params[2],
          name: params[3],
          object_type: params[4],
          description: params[5],
          inspection_type: params[6],
          schedule_cycle: params[7],
          custom_interval_days: params[8],
          setup_reviewed: true,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        };
        templates.push(row);
        return { rows: [row] };
      }
      if (sql.includes('INSERT INTO hse_inspection_template_items')) {
        const row = { id: 'item-' + (items.length + 1), template_id: params[0], sort_order: params[1], question: params[2], is_critical: params[3], guidance: params[4] };
        items.push(row);
        return { rows: [row] };
      }
      if (sql.includes('INSERT INTO hse_inspection_setup_audit')) {
        audits.push({ entity_type: params[2], entity_id: params[3], action: params[4] });
        return { rows: [] };
      }
      if (sql.includes('FROM hse_inspection_templates') && sql.includes('WHERE id = $1')) {
        const row = templates.find(t => t.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('UPDATE hse_inspection_templates') && sql.includes('is_current = FALSE')) {
        templates.forEach(t => { if (t.root_id === params[0]) t.is_current = false; });
        return { rows: [] };
      }
      if (sql.includes('SELECT MAX(version_no) as max_v')) {
        const maxV = templates.filter(t => t.root_id === params[0]).reduce((m, t) => Math.max(m, t.version_no), 1);
        return { rows: [{ max_v: maxV }] };
      }
      if (sql.includes('SELECT count(*)::int as cnt FROM hse_inspection_schedules')) {
        return { rows: [{ cnt: 0 }] };
      }
      if (sql.includes('UPDATE hse_inspection_templates') && sql.includes('is_active = FALSE')) {
        templates.forEach(t => { if (t.root_id === params[0]) t.is_active = false; });
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  // 1. Validasi mandatory
  await assert.rejects(
    async () => hseService.createInspectionTemplate(mockDb, scope, user, { code: '' }),
    { message: 'Kode dan nama templat inspeksi wajib diisi' }
  );

  // 2. Buat template baru
  const tmpl = await hseService.createInspectionTemplate(mockDb, scope, user, {
    code: 'TMPL-PIT-01',
    name: 'Inspeksi Pit Harian',
    object_type: 'AREA',
    inspection_type: 'PLANNED',
    schedule_cycle: 'DAILY',
    items: [
      { question: 'Tinggi bench sesuai standar?', is_critical: true },
      { question: 'Penerangan cukup?', is_critical: false }
    ]
  });
  assert.equal(tmpl.code, 'TMPL-PIT-01');
  assert.equal(tmpl.version_no, 1);
  assert.equal(tmpl.is_current, true);

  // 3. Simpan versi baru
  const v2 = await hseService.createInspectionTemplateVersion(mockDb, scope, user, tmpl.id, {
    name: 'Inspeksi Pit Harian Revisi',
    items: [
      { question: 'Tinggi bench sesuai standar?', is_critical: true },
      { question: 'Penerangan cukup?', is_critical: false },
      { question: 'Jalur evakuasi bebas hambatan?', is_critical: true }
    ]
  });
  assert.equal(v2.version_no, 2);
  assert.equal(v2.root_id, tmpl.root_id);
  assert.equal(v2.is_current, true);
  assert.equal(tmpl.is_current, false);

  // 4. Nonaktifkan template
  const deact = await hseService.deactivateInspectionTemplate(mockDb, scope, user, v2.id);
  assert.equal(deact.success, true);
  assert.equal(v2.is_active, false);
});

test('HSE Setup Inspeksi target mandate and schedules validate parameters and handle deactivation', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'usr-1', nama: 'Safety Admin' };

  const targets = [];
  const schedules = [];

  const mockDb = {
    connect: async () => ({
      query: async (sql, params) => mockDb.query(sql, params),
      release: () => {},
    }),
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO hse_inspection_targets')) {
        const row = {
          id: 'target-' + (targets.length + 1),
          target_type: params[2],
          position_id: params[3],
          department_id: params[4],
          employee_id: params[5],
          template_root_id: params[6],
          cycle: params[7],
          target_quota: params[8],
          proration_mode: params[9],
          effective_from: params[10],
          is_active: true
        };
        targets.push(row);
        return { rows: [row] };
      }
      if (sql.includes('FROM hse_inspection_templates') && (sql.includes('WHERE id = $1') || sql.includes('WHERE (id = $1 OR root_id = $1)'))) {
        return { rows: [{ id: params[0], inspection_type: 'PLANNED', schedule_cycle: 'WEEKLY' }] };
      }
      if (sql.includes('INSERT INTO hse_inspection_schedules')) {
        const row = {
          id: 'sched-' + (schedules.length + 1),
          template_root_id: params[2],
          location_id: params[3],
          assignee_type: params[5],
          next_due_date: params[9],
          is_active: true
        };
        schedules.push(row);
        return { rows: [row] };
      }
      if (sql.includes('INSERT INTO hse_inspection_setup_audit')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  // 1. Validasi target: BY_ROLE tanpa position_id
  await assert.rejects(
    async () => hseService.createOrUpdateInspectionTarget(mockDb, scope, user, { target_type: 'BY_ROLE' }),
    { message: 'Jabatan wajib dipilih untuk target berbasis peran' }
  );

  // 2. Validasi target: BY_EMPLOYEE tanpa reason_code
  await assert.rejects(
    async () => hseService.createOrUpdateInspectionTarget(mockDb, scope, user, { target_type: 'BY_EMPLOYEE', employee_id: 'emp-1' }),
    { message: 'Alasan wajib diisi untuk override individu' }
  );

  // 3. Buat role target kuota = 0 (BEBAS)
  const roleTarget = await hseService.createOrUpdateInspectionTarget(mockDb, scope, user, {
    target_type: 'BY_ROLE',
    position_id: 'pos-operator',
    cycle: 'MONTHLY',
    target_quota: 0
  });
  assert.equal(roleTarget.target_quota, 0);

  // 4. Buat jadwal objek
  const sched = await hseService.createInspectionSchedule(mockDb, scope, user, {
    template_root_id: 'tmpl-1',
    location_id: 'loc-pit2',
    assignee_type: 'POSITION',
    assignee_position_id: 'pos-spv',
    start_date: '2026-10-10'
  });
  assert.equal(sched.location_id, 'loc-pit2');
  assert.ok(sched.next_due_date);
});

test('HSE Setup Hazard Report targets validate parameters and handle deactivation', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'usr-1', nama: 'Safety Admin' };

  const targets = [];

  const mockDb = {
    connect: async () => ({
      query: async (sql, params) => mockDb.query(sql, params),
      release: () => {},
    }),
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO hse_hazard_report_targets')) {
        const row = {
          id: 'hzt-' + (targets.length + 1),
          target_type: params[2],
          position_id: params[3],
          department_id: params[4],
          employee_id: params[5],
          cycle: params[6],
          target_quota: params[7],
          proration_mode: params[8],
          effective_from: params[9],
          is_active: true
        };
        targets.push(row);
        return { rows: [row] };
      }
      if (sql.includes('INSERT INTO hse_inspection_setup_audit')) {
        assert.match(sql, /HAZARD_TARGET/);
        return { rows: [] };
      }
      if (sql.includes('FROM hse_hazard_report_targets WHERE id = $1')) {
        return { rows: targets.filter(t => t.id === params[0]) };
      }
      if (sql.includes('UPDATE hse_hazard_report_targets')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  // 1. Validasi target: tipe tidak valid
  await assert.rejects(
    async () => hseService.createOrUpdateHazardReportTarget(mockDb, scope, user, { target_type: 'BY_UNIT' }),
    { message: 'Tipe target wajib diisi: BY_ROLE atau BY_EMPLOYEE' }
  );

  // 2. Validasi target: BY_ROLE tanpa position_id
  await assert.rejects(
    async () => hseService.createOrUpdateHazardReportTarget(mockDb, scope, user, { target_type: 'BY_ROLE' }),
    { message: 'Jabatan wajib dipilih untuk target berbasis peran' }
  );

  // 3. Validasi target: BY_EMPLOYEE tanpa reason_code
  await assert.rejects(
    async () => hseService.createOrUpdateHazardReportTarget(mockDb, scope, user, { target_type: 'BY_EMPLOYEE', employee_id: 'emp-1' }),
    { message: 'Alasan wajib diisi untuk override individu' }
  );

  // 4. Validasi target: kuota negatif
  await assert.rejects(
    async () => hseService.createOrUpdateHazardReportTarget(mockDb, scope, user, { target_type: 'BY_ROLE', position_id: 'pos-1', target_quota: -1 }),
    { message: 'Target kuota tidak boleh bernilai negatif' }
  );

  // 5. Buat role target kuota = 2 (tanpa dimensi template)
  const roleTarget = await hseService.createOrUpdateHazardReportTarget(mockDb, scope, user, {
    target_type: 'BY_ROLE',
    position_id: 'pos-operator',
    cycle: 'MONTHLY',
    target_quota: 2
  });
  assert.equal(roleTarget.target_quota, 2);
  assert.equal(roleTarget.cycle, 'MONTHLY');

  // 6. Nonaktifkan target
  const deact = await hseService.deactivateHazardReportTarget(mockDb, scope, user, roleTarget.id);
  assert.equal(deact.success, true);

  // 7. Nonaktifkan target yang tidak ada
  await assert.rejects(
    async () => hseService.deactivateHazardReportTarget(mockDb, scope, user, 'hzt-missing'),
    { message: 'Aturan target tidak ditemukan' }
  );

  // 8. Scope default saat tabel kosong
  const emptyScopeDb = { query: async () => ({ rows: [] }) };
  const defScope = await hseService.getHazardReportPersonnelScope(emptyScopeDb, scope);
  assert.equal(defScope.scope_mode, 'ALL');
});

test('HSE hazard mandate overview resolves quotas in a single set-based query', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  let queryCount = 0;

  const mockDb = {
    query: async (sql) => {
      queryCount++;
      if (sql.includes('hse_hazard_report_scopes')) return { rows: [] };
      if (sql.includes('CROSS JOIN LATERAL')) {
        assert.match(sql, /hse_hazard_effective_quota/);
        return { rows: [
          { id: 'e-1', nama: 'Ahmad', employee_id: 'N-1', jabatan: 'Operator', departemen: 'Produksi', rule_id: 'r-1', source: 'ROLE', quota: 2, quota_status: 'WAJIB' },
          { id: 'e-2', nama: 'Budi', employee_id: 'N-2', jabatan: 'Supir', departemen: 'Produksi', rule_id: null, source: 'NONE', quota: null, quota_status: 'BELUM_DIATUR' }
        ] };
      }
      return { rows: [] };
    }
  };

  const ov = await hseService.getHazardReportMandateOverview(mockDb, scope, {});
  assert.equal(queryCount, 2); // 1 scope + 1 overview (tanpa N+1 per karyawan)
  assert.equal(ov.items.length, 2);
  assert.equal(ov.kpi.totalEmployees, 2);
  assert.equal(ov.kpi.wajibCount, 1);
  assert.equal(ov.kpi.belumDiaturCount, 1);
  assert.equal(ov.items[0].target_quota, 2);
  assert.equal(ov.items[0].rule_source, 'ROLE');
});

test('HSE Setup P5M targets validate parameters and resolve overview in one query', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'usr-1', nama: 'Safety Admin' };

  const targets = [];
  let queryCount = 0;

  const mockDb = {
    connect: async () => ({
      query: async (sql, params) => mockDb.query(sql, params),
      release: () => {},
    }),
    query: async (sql, params) => {
      queryCount++;
      if (sql.includes('hse_p5m_scopes')) return { rows: [] };
      if (sql.includes('INSERT INTO hse_p5m_targets')) {
        const row = {
          id: 'p5m-' + (targets.length + 1),
          target_type: params[2],
          position_id: params[3],
          department_id: params[4],
          employee_id: params[5],
          cycle: params[6],
          target_quota: params[7],
          is_active: true
        };
        targets.push(row);
        return { rows: [row] };
      }
      if (sql.includes('INSERT INTO hse_inspection_setup_audit')) {
        assert.match(sql, /P5M_TARGET/);
        return { rows: [] };
      }
      if (sql.includes('CROSS JOIN LATERAL')) {
        assert.match(sql, /hse_p5m_effective_quota/);
        return { rows: [
          { id: 'e-1', nama: 'Ahmad', employee_id: 'N-1', jabatan: 'Operator', departemen: 'Produksi', rule_id: 'r-1', source: 'ROLE', quota: 2, quota_status: 'WAJIB' }
        ] };
      }
      if (sql.includes('FROM hse_p5m_targets WHERE id = $1')) {
        return { rows: targets.filter(t => t.id === params[0]) };
      }
      if (sql.includes('UPDATE hse_p5m_targets')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  await assert.rejects(
    async () => hseService.createOrUpdateP5mTarget(mockDb, scope, user, { target_type: 'BY_ROLE' }),
    { message: 'Jabatan wajib dipilih untuk target berbasis peran' }
  );

  await assert.rejects(
    async () => hseService.createOrUpdateP5mTarget(mockDb, scope, user, { target_type: 'BY_EMPLOYEE', employee_id: 'emp-1' }),
    { message: 'Alasan wajib diisi untuk override individu' }
  );

  const created = await hseService.createOrUpdateP5mTarget(mockDb, scope, user, {
    target_type: 'BY_ROLE',
    position_id: 'pos-operator',
    cycle: 'MONTHLY',
    target_quota: 2
  });
  assert.equal(created.target_quota, 2);

  const deact = await hseService.deactivateP5mTarget(mockDb, scope, user, created.id);
  assert.equal(deact.success, true);

  const before = queryCount;
  const ov = await hseService.getP5mMandateOverview(mockDb, scope, {});
  assert.equal(queryCount - before, 2);
  assert.equal(ov.items.length, 1);
  assert.equal(ov.kpi.wajibCount, 1);
});

test('HSE Setup Safety Talk targets validate parameters and handle deactivation', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'usr-1', nama: 'Safety Admin' };

  const targets = [];

  const mockDb = {
    connect: async () => ({
      query: async (sql, params) => mockDb.query(sql, params),
      release: () => {},
    }),
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO hse_safetytalk_targets')) {
        const row = {
          id: 'stt-' + (targets.length + 1),
          target_type: params[2],
          position_id: params[3],
          department_id: params[4],
          employee_id: params[5],
          cycle: params[6],
          target_quota: params[7],
          is_active: true
        };
        targets.push(row);
        return { rows: [row] };
      }
      if (sql.includes('INSERT INTO hse_inspection_setup_audit')) {
        assert.match(sql, /SAFETYTALK_TARGET/);
        return { rows: [] };
      }
      if (sql.includes('FROM hse_safetytalk_targets WHERE id = $1')) {
        return { rows: targets.filter(t => t.id === params[0]) };
      }
      if (sql.includes('UPDATE hse_safetytalk_targets')) {
        return { rows: [] };
      }
      if (sql.includes('hse_safetytalk_scopes')) return { rows: [] };
      return { rows: [] };
    }
  };

  await assert.rejects(
    async () => hseService.createOrUpdateSafetytalkTarget(mockDb, scope, user, { target_type: 'BY_EMPLOYEE', employee_id: 'emp-9' }),
    { message: 'Alasan wajib diisi untuk override individu' }
  );

  await assert.rejects(
    async () => hseService.createOrUpdateSafetytalkTarget(mockDb, scope, user, { target_type: 'BY_ROLE', position_id: 'pos-1', target_quota: -2 }),
    { message: 'Target kuota tidak boleh bernilai negatif' }
  );

  const created = await hseService.createOrUpdateSafetytalkTarget(mockDb, scope, user, {
    target_type: 'BY_EMPLOYEE',
    employee_id: 'emp-9',
    reason_code: 'SAFETY_CHAMPION',
    cycle: 'WEEKLY',
    target_quota: 1
  });
  assert.equal(created.target_quota, 1);
  assert.equal(created.cycle, 'WEEKLY');

  const deact = await hseService.deactivateSafetytalkTarget(mockDb, scope, user, created.id);
  assert.equal(deact.success, true);

  await assert.rejects(
    async () => hseService.deactivateSafetytalkTarget(mockDb, scope, user, 'stt-missing'),
    { message: 'Aturan target tidak ditemukan' }
  );

  const defScope = await hseService.getSafetytalkPersonnelScope({ query: async () => ({ rows: [] }) }, scope);
  assert.equal(defScope.scope_mode, 'ALL');
});

test('HSE createInspection advances schedule next_due_date and getInspectionComplianceReport computes schedule coverage', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u-spv1', nama: 'Supervisor Lapangan' };

  let updatedSchedule = null;

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT name FROM hse_inspection_templates')) {
        return { rows: [{ name: 'Inspeksi Pit & Front Loading' }] };
      }
      if (sql.includes('SELECT name FROM hse_locations')) {
        return { rows: [{ name: 'Pit 2 South' }] };
      }
      if (sql.includes('SELECT nextval')) {
        return { rows: [{ nextval: '10' }] };
      }
      if (sql.includes('INSERT INTO hse_inspections')) {
        return { rows: [{ id: 'insp-sched-1' }] };
      }
      if (sql.includes('SELECT s.*, tmpl.schedule_cycle')) {
        return {
          rows: [{
            id: 'sched-101',
            template_root_id: 'tmpl-1',
            schedule_cycle: 'WEEKLY',
            next_due_date: '2026-10-10',
          }]
        };
      }
      if (sql.includes('UPDATE hse_inspection_schedules')) {
        updatedSchedule = {
          id: params[1],
          next_due_date: params[0],
          last_done_at: 'NOW()',
        };
        return { rows: [updatedSchedule] };
      }
      if (sql.includes('FROM hse_inspections i')) {
        return {
          rows: [{
            id: 'insp-sched-1',
            inspection_no: 'INSP-2610-010',
            status: 'COMPLETED',
            findings_count: 0,
          }]
        };
      }
      if (sql.includes('FROM workforce_positions')) {
        return { rows: [{ id: 'pos-1', name: 'Supervisor Pit' }] };
      }
      if (sql.includes('FROM users u')) {
        return { rows: [{ id: 'u-spv1', nama: 'Supervisor Lapangan', jabatan: 'Supervisor Pit', departemen: 'PRODUKSI' }] };
      }
      if (sql.includes('FROM hse_effective_quota')) {
        return { rows: [{ employee_id: 'u-spv1', effective_quota: 4, is_exempt: false, override_reason: null }] };
      }
      if (sql.includes('GROUP BY i.inspected_by_id')) {
        return { rows: [{ inspected_by_id: 'u-spv1', total_inspections: 4 }] };
      }
      if (sql.includes('total_active_schedules') || (sql.includes('FROM hse_inspection_schedules') && sql.includes('COUNT(*)'))) {
        return {
          rows: [{
            total_active_schedules: 5,
            due_in_period: 4,
            completed_in_period: 4,
            overdue_schedules: 0,
          }]
        };
      }
      return { rows: [] };
    }
  };

  const insp = await hseService.createInspection(mockDb, scope, user, {
    template_id: 'tmpl-1',
    location_id: 'loc-pit2',
    schedule_id: 'sched-101',
    object_identifier: 'Front Loading Pit 2',
    photos: [HSE_TEST_PNG],
    answers: []
  });

  assert.equal(insp.id, 'insp-sched-1');
  assert.ok(updatedSchedule, 'Jadwal objek harus diperbarui');
  assert.equal(updatedSchedule.id, 'sched-101');
  assert.ok(updatedSchedule.next_due_date > '2026-10-10', 'next_due_date harus dimajukan sesuai siklus WEEKLY');

  // Tes report kepatuhan
  const report = await hseService.getInspectionComplianceReport(mockDb, scope, { month: 10, year: 2026 });
  assert.equal(report.summary.complianceRate, 100);
  assert.equal(report.summary.scheduleCoverage.dueInPeriod, 4);
  assert.equal(report.summary.scheduleCoverage.coverageRate, 100);
});

test('HSE Smart Semantic Code & Similarity Engine detects same hazard in same open area and ignores different area or closed hazard', () => {
  const hz1 = {
    id: 'hz-1',
    report_no: 'HZD-2610-006',
    location_id: 'sub-pit1',
    area_id: 'area-pit',
    area_name: 'PIT',
    sub_area_id: 'sub-pit1',
    sub_area_name: 'Pit 1 Selatan',
    location_name: 'PIT ▸ Pit 1 Selatan',
    description: 'Jalan hauling licin berlumpur tebal setelah hujan lebat, grader belum masuk grading',
    potential_consequence: 'Unit dump truck slip dan tergelincir di jalur hauling',
    status: 'NEW',
    merged_into_id: null,
  };

  const hz2SameAreaAndSubArea = {
    id: 'hz-2',
    report_no: 'HZD-2610-019',
    location_id: 'sub-pit1',
    area_id: 'area-pit',
    area_name: 'PIT',
    sub_area_id: 'sub-pit1',
    sub_area_name: 'Pit 1 Selatan',
    location_name: 'PIT ▸ Pit 1 Selatan',
    description: 'Kondisi jalan hauling sangat berlumpur dan licin sehabis hujan, belum ada grading',
    potential_consequence: 'Berpotensi menyebabkan unit DT selip saat melintas',
    status: 'IN_ACTION',
    merged_into_id: null,
  };

  const hz3SameAreaDiffSubArea = {
    ...hz2SameAreaAndSubArea,
    id: 'hz-3-sub',
    location_id: 'sub-pit2',
    sub_area_id: 'sub-pit2',
    sub_area_name: 'Pit 2 Utara',
    location_name: 'PIT ▸ Pit 2 Utara',
  };

  const hz3DiffArea = {
    ...hz2SameAreaAndSubArea,
    id: 'hz-3',
    location_id: 'sub-wshop1',
    area_id: 'area-wshop',
    area_name: 'Workshop',
    sub_area_id: 'sub-wshop1',
    sub_area_name: 'Main Workshop',
    location_name: 'Workshop ▸ Main Workshop',
  };

  const hzMissingSubArea = {
    ...hz2SameAreaAndSubArea,
    id: 'hz-no-sub',
    location_id: 'area-pit',
    sub_area_id: null,
    sub_area_name: null,
  };

  const hz4Closed = {
    ...hz2SameAreaAndSubArea,
    id: 'hz-4',
    status: 'CLOSED',
  };

  const simMatch = hseService.computeHazardSimilarity(hz1, hz2SameAreaAndSubArea);
  assert.equal(simMatch.isSameHazard, true, 'Harus mendeteksi sebagai 1 jenis hazard yang sama jika Area dan Sub-Area sama');
  assert.ok(simMatch.similarityPct >= 65, `Persentase kemiripan harus tinggi, dapat: ${simMatch.similarityPct}%`);

  const simDiffSubArea = hseService.computeHazardSimilarity(hz1, hz3SameAreaDiffSubArea);
  assert.equal(simDiffSubArea.isSameHazard, false, 'Area sama tapi Sub-Area berbeda TIDAK BOLEH menjalankan algoritma pintar');

  const simDiffArea = hseService.computeHazardSimilarity(hz1, hz3DiffArea);
  assert.equal(simDiffArea.isSameHazard, false, 'Area berbeda tidak boleh dianggap 1 hazard yang sama');

  const simMissingSubArea = hseService.computeHazardSimilarity(hz1, hzMissingSubArea);
  assert.equal(simMissingSubArea.isSameHazard, false, 'Tanpa Sub-Area spesifik tidak boleh menjalankan algoritma pintar');

  const simClosed = hseService.computeHazardSimilarity(hz1, hz4Closed);
  assert.equal(simClosed.isSameHazard, false, 'Hazard yang sudah CLOSED tidak boleh direkomendasikan gabung');
});

test('HSE mergeSimilarHazards combines 2 reports into 1 unique hazard while preserving 2 personnel reporters in administrative records', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'admin-1', nama: 'Admin HSE', role: 'admin', permissions: ['hse.merge'] };

  const dbRows = [
    {
      id: 'hz-main',
      report_no: 'HZD-2610-006',
      report_date: '2026-10-08',
      report_time: '08:30:00',
      location_id: 'loc-pit1',
      location_name: 'Pit 1 Selatan',
      category_id: 'cat-cond',
      category_name: 'Kondisi Tidak Aman',
      description: 'Jalan hauling licin berlumpur tebal setelah hujan lebat',
      potential_consequence: 'Unit slip',
      likelihood: 3,
      consequence: 3,
      risk_score: 9,
      risk_level: 'MEDIUM',
      reported_by: 'emp-1',
      reported_by_name: 'Budi Santoso',
      reported_by_role: 'Driver DT',
      reported_by_dept: 'Produksi',
      status: 'NEW',
      merged_into_id: null,
    },
    {
      id: 'hz-dup',
      report_no: 'HZD-2610-019',
      report_date: '2026-10-08',
      report_time: '09:15:00',
      location_id: 'loc-pit1',
      location_name: 'Pit 1 Selatan',
      category_id: 'cat-cond',
      category_name: 'Kondisi Tidak Aman',
      description: 'Jalur hauling Pit 1 berlumpur dan licin pasca hujan, perlu grading',
      potential_consequence: 'DT tergelincir',
      likelihood: 3,
      consequence: 3,
      risk_score: 9,
      risk_level: 'MEDIUM',
      reported_by: 'emp-2',
      reported_by_name: 'Andi Wijaya',
      reported_by_role: 'Pengawas Pit',
      reported_by_dept: 'Produksi',
      status: 'NEW',
      merged_into_id: null,
    }
  ];

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, report_no, status, merged_into_id FROM hazard_reports WHERE id = $1')) {
        const found = dbRows.find(r => r.id === params[0]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('UPDATE hazard_reports') && sql.includes("status = 'DUPLICATE'")) {
        const src = dbRows.find(r => r.id === params[2]);
        if (src) {
          src.merged_into_id = params[0];
          src.status = 'DUPLICATE';
        }
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('FROM hazard_reports m') && sql.includes('m.merged_into_id = $1')) {
        return { rows: dbRows.filter(r => r.merged_into_id === params[0]) };
      }
      if (sql.includes('FROM hazard_reports m') && sql.includes('m.merged_into_id IS NOT NULL')) {
        return { rows: dbRows.filter(r => r.merged_into_id !== null) };
      }
      if (sql.includes('FROM hazard_reports h') && sql.includes('WHERE h.id = $1')) {
        const found = dbRows.find(r => r.id === params[0]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('FROM hazard_reports h')) {
        return { rows: dbRows };
      }
      return { rows: [] };
    }
  };

  // Sebelum digabungkan: listHazards menampilkan 2 baris dan mendeteksi similar_hazards
  const beforeMerge = await hseService.listHazards(mockDb, scope, {});
  assert.equal(beforeMerge.length, 2);
  assert.equal(beforeMerge[0].similar_hazards.length, 1);
  assert.equal(beforeMerge[0].similar_hazards[0].report_no, 'HZD-2610-019');

  // Eksekusi penggabungan
  // Tanpa izin hse.merge / tanpa alasan → ditolak
  await assert.rejects(hseService.mergeSimilarHazards(mockDb, scope, { id: 'k-1', role: 'karyawan' }, 'hz-main', 'hz-dup', { reason: 'sama' }), /hse\.merge/);
  await assert.rejects(hseService.mergeSimilarHazards(mockDb, scope, user, 'hz-main', 'hz-dup', {}), /Alasan/);
  const mergedDetail = await hseService.mergeSimilarHazards(mockDb, scope, user, 'hz-main', 'hz-dup', { reason: 'Ruas hauling yang sama' });
  assert.equal(mergedDetail.reporter_count, 2, 'Personil pelapor harus terhitung 2 secara administrasi');
  assert.equal(mergedDetail.reporters_list.length, 2);
  assert.equal(mergedDetail.reporters_list[0].reported_by_name, 'Budi Santoso');
  assert.equal(mergedDetail.reporters_list[1].reported_by_name, 'Andi Wijaya');

  // Setelah digabungkan: listHazards membaca sebagai 1 jenis hazard unik namun memiliki 2 pelapor
  const afterMerge = await hseService.listHazards(mockDb, scope, {});
  assert.equal(afterMerge.length, 1, 'Sistem membaca menjadi 1 jenis hazard unik di tabel aktif');
  assert.equal(afterMerge[0].id, 'hz-main');
  assert.equal(afterMerge[0].reporter_count, 2, 'Baris hazard unik tetap mencatat 2 pelapor');
});

test('HSE updateHazard supports manual admin validation with compressed photos and deleteHazard cascades cleanup', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'admin-1', nama: 'Admin HSE' };

  let hazardStore = [
    {
      id: 'hz-edit-1',
      report_no: 'HZD-2610-099',
      report_date: '2026-10-11',
      report_time: '10:00:00',
      location_id: 'sub-pit1',
      location_name: 'Pit 1 Selatan',
      category_id: 'cat-cond',
      category_name: 'Kondisi Tidak Aman',
      description: 'Tanggul pengaman jalan hauling retak',
      potential_consequence: 'Unit terperosok',
      photos: ['data:image/webp;base64,AAA'],
      likelihood: 2,
      consequence: 3,
      risk_score: 6,
      risk_level: 'MEDIUM',
      reported_by: 'emp-1',
      reported_by_name: 'Budi Santoso',
      reported_by_dept: 'Produksi',
      reported_by_role: 'Operator',
      assigned_to: 'emp-2',
      assigned_to_name: 'Pengawas A',
      status: 'NEW',
      merged_into_id: null,
    },
  ];
  let capaStore = [
    { id: 'capa-1', source_type: 'HAZARD', source_id: 'hz-edit-1', status: 'OPEN' },
  ];

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('FROM hazard_reports h') && sql.includes('WHERE h.id = $1')) {
        const found = hazardStore.find(r => r.id === params[0]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('SELECT id, report_no, photos FROM hazard_reports WHERE id = $1')) {
        const found = hazardStore.find(r => r.id === params[0]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('SELECT name FROM hse_locations WHERE id = $1')) {
        return { rows: [{ name: 'Pit 2 Utara' }] };
      }
      if (sql.includes('SELECT label FROM hse_categories WHERE id = $1')) {
        return { rows: [{ label: 'Tindakan Tidak Aman' }] };
      }
      if (sql.includes('UPDATE hazard_reports SET')) {
        const target = hazardStore.find(r => r.id === params[21]);
        if (target) {
          target.location_id = params[0] || target.location_id;
          target.location_name = params[1] || target.location_name;
          target.category_id = params[2] || target.category_id;
          target.category_name = params[3] || target.category_name;
          target.description = params[4];
          target.potential_consequence = params[5];
          target.photos = params[6];
          target.likelihood = params[7];
          target.consequence = params[8];
          target.risk_score = params[9];
          target.risk_level = params[10];
          target.status = params[17];
          target.semantic_signature = params[18];
        }
        return { rows: target ? [target] : [] };
      }
      if (sql.includes('DELETE FROM hse_actions')) {
        capaStore = capaStore.filter(c => c.source_id !== params[0]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('DELETE FROM hazard_reports')) {
        hazardStore = hazardStore.filter(h => h.id !== params[0] && h.merged_into_id !== params[0]);
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    },
  };

  // 1. Validasi manual Admin (Edit)
  const updated = await hseService.updateHazard(mockDb, scope, user, 'hz-edit-1', {
    location_id: 'sub-pit2',
    category_id: 'cat-act',
    status: 'ASSESSED',
    description: 'Operator mengemudi melebihi batas kecepatan di tikungan pit',
    potential_consequence: 'Tabrakan antar unit',
    photos: ['data:image/webp;base64,AAA', 'data:image/webp;base64,BBB'],
    likelihood: 4,
    consequence: 4,
  });

  assert.equal(updated.status, 'ASSESSED');
  assert.equal(updated.category_name, 'Tindakan Tidak Aman');
  assert.equal(updated.risk_score, 16);
  assert.equal(updated.risk_level, 'HIGH');
  assert.equal(updated.photos.length, 2);
  assert.ok(updated.semantic_signature.includes('ROOT['));

  // 2. Hapus menyeluruh (Delete Hazard + Foto + CAPA)
  const delRes = await hseService.deleteHazard(mockDb, scope, user, 'hz-edit-1');
  assert.equal(delRes.deleted, true);
  assert.equal(delRes.deleted_photos_count, 2);
  assert.equal(hazardStore.length, 0, 'Record hazard harus terhapus dari database');
  assert.equal(capaStore.length, 0, 'CAPA terkait harus ikut terhapus');
});

test('HSE createP5mEvent only accepts WAJIB participants and persists event with attendees', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Admin HSE' };

  const buildDb = (quotaStatus) => {
    let inserted = null;
    const db = {
      query: async (sql, params) => {
        if (sql.includes('FROM shifts WHERE id = $1')) {
          return { rows: [{ id: 'sh-1', nama_shift: 'SIANG (06:00-18:00)' }] };
        }
        if (sql.includes('FROM hse_locations')) {
          return { rows: [{ id: 'loc-1', name: 'Blok 1' }] };
        }
        if (sql.includes('hse_p5m_effective_quota')) {
          return {
            rows: (params[1] || []).map(id => ({ id, nama: 'Karyawan Uji', quota_status: quotaStatus })),
          };
        }
        if (sql.includes('SELECT id, nama FROM users WHERE id = ANY($1)')) {
          return { rows: [] };
        }
        if (sql.includes('AS last_no FROM hse_p5m_events')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO hse_p5m_events')) {
          inserted = {
            id: 'ev-1',
            event_no: params[2],
            event_date: params[3],
            shift_id: params[4],
            shift_name: params[5],
            location_id: params[6],
            location_name: params[7],
            topics: params[8],
            led_by_ids: params[9],
            led_by_names: params[10],
            photos: params[11],
            status: 'ACTIVE',
            merged_into_id: null,
          };
          return { rows: [inserted] };
        }
        if (sql.includes('SELECT * FROM hse_p5m_events')) {
          return { rows: inserted ? [inserted] : [] };
        }
        return { rows: [] };
      },
    };
    return { db, getInserted: () => inserted };
  };

  // 1. Peserta berstatus BEBAS ditolak dengan pesan Setup Master
  const rejected = buildDb('BEBAS');
  await assert.rejects(
    async () => hseService.createP5mEvent(rejected.db, scope, user, {
      event_date: '2026-10-10',
      shift_id: 'sh-1',
      location_id: 'loc-1',
      topics: ['APD wajib'],
      participant_ids: ['emp-9'],
    }),
    (err) => err.statusCode === 422 && /berstatus WAJIB/.test(err.message)
  );
  assert.equal(rejected.getInserted(), null, 'Event tidak boleh tersimpan saat peserta non-WAJIB');

  // 2. Peserta WAJIB diterima, event tersimpan dengan nomor urut & shift/lokasi tervalidasi
  const accepted = buildDb('WAJIB');
  const created = await hseService.createP5mEvent(accepted.db, scope, user, {
    event_date: '2026-10-10',
    shift_id: 'sh-1',
    location_id: 'loc-1',
    topics: ['APD wajib', 'Jarak aman'],
    participant_ids: ['emp-1', 'emp-2'],
    led_by_ids: [],
  });

  const row = accepted.getInserted();
  assert.ok(row, 'Event harus terinsert');
  assert.match(row.event_no, /^P5M-\d{4}-\d{3,}$/);
  assert.equal(row.shift_name, 'SIANG (06:00-18:00)');
  assert.equal(row.location_name, 'Blok 1');
  assert.deepEqual(row.topics, ['APD wajib', 'Jarak aman']);
  assert.equal(created.id, 'ev-1');
});

test('HSE mergeP5mEvents enforces Area+Tanggal+Shift key, unions data, and marks sources DUPLICATE', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const user = { id: 'u1', nama: 'Admin HSE' };

  const baseEvent = {
    id: 'ev-target',
    event_no: 'P5M-2610-0001',
    event_date: '2026-10-10',
    shift_id: 'sh-1',
    shift_name: 'SIANG',
    location_id: 'loc-1',
    location_name: 'Blok 1',
    topics: ['Topik Utama'],
    led_by_ids: [],
    led_by_names: [],
    photos: ['data:image/webp;base64,AAA'],
    status: 'ACTIVE',
    merged_into_id: null,
  };
  const otherKeySource = {
    ...baseEvent,
    id: 'ev-src-far',
    event_no: 'P5M-2610-0002',
    location_id: 'loc-9',
    location_name: 'Lain Area',
    topics: ['Topik Sumber'],
  };
  const sameKeySource = {
    ...baseEvent,
    id: 'ev-src-near',
    event_no: 'P5M-2610-0003',
    topics: ['Topik Sumber'],
    photos: ['data:image/webp;base64,BBB'],
  };

  const buildDb = (sourceRows) => {
    const calls = { duplicateUpdates: 0, mergedTopics: null, insertedAttendees: [] };
    const db = {
      query: async (sql, params) => {
        if (sql.includes('SELECT * FROM hse_p5m_events') && sql.includes('id = ANY($1)')) {
          const wanted = new Set((params[0] || []).map(String));
          return { rows: sourceRows.filter(r => wanted.has(String(r.id))) };
        }
        if (sql.includes('SELECT * FROM hse_p5m_events') && sql.includes('WHERE id = $1')) {
          return { rows: [baseEvent] };
        }
        if (sql.includes('SELECT employee_id FROM hse_p5m_event_attendees')) {
          return { rows: [{ employee_id: 'emp-1' }] };
        }
        if (sql.includes('SELECT employee_id, employee_no, nama, jabatan FROM hse_p5m_event_attendees')) {
          return {
            rows: [
              { employee_id: 'emp-1', employee_no: 'EMP-001', nama: 'Andi Saputra', jabatan: 'Foreman' },
              { employee_id: 'emp-9', employee_no: 'EMP-009', nama: 'Peserta Sumber', jabatan: 'Operator' },
            ],
          };
        }
        if (sql.includes('INSERT INTO hse_p5m_event_attendees')) {
          calls.insertedAttendees.push(params[3]);
          return { rows: [] };
        }
        if (sql.includes('topics = $4')) {
          calls.mergedTopics = params[3];
          return { rows: [] };
        }
        if (sql.includes("status = 'DUPLICATE'")) {
          calls.duplicateUpdates += 1;
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    return { db, calls };
  };

  // 1. Key berbeda (lokasi beda) ditolak
  const wrongKey = buildDb([otherKeySource]);
  await assert.rejects(
    async () => hseService.mergeP5mEvents(wrongKey.db, scope, user, 'ev-target', ['ev-src-far']),
    { statusCode: 422, message: 'Hanya event dengan Area, Tanggal, dan Shift sama yang bisa digabung' }
  );
  assert.equal(wrongKey.calls.duplicateUpdates, 0, 'Tidak boleh menandai DUPLICATE saat key berbeda');

  // 2. Key sama: topik diunion, peserta baru diinsert, sumber ditandai DUPLICATE
  const ok = buildDb([sameKeySource]);
  const merged = await hseService.mergeP5mEvents(ok.db, scope, user, 'ev-target', ['ev-src-near']);

  assert.deepEqual(ok.calls.mergedTopics, ['Topik Utama', 'Topik Sumber']);
  assert.equal(ok.calls.duplicateUpdates, 1, 'Sumber harus ditandai status DUPLICATE');
  assert.deepEqual(ok.calls.insertedAttendees, ['emp-9'], 'Hanya peserta baru yang diinsert ke event utama');
  assert.equal(merged.id, 'ev-target');
});

test('HSE deleteP5mEvent cascades the whole merge tree permanently', async () => {
  const scope = { tenantKey: 'default', projectKey: 'default' };
  const deletedIds = [];
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('WITH RECURSIVE event_tree')) {
        return { rows: [{ id: 'ev-1' }, { id: 'ev-2' }, { id: 'ev-3' }] };
      }
      if (sql.includes('SELECT id FROM hse_p5m_events')) {
        return { rows: [{ id: 'ev-1' }] };
      }
      if (sql.includes('DELETE FROM hse_p5m_events')) {
        deletedIds.push(...(params[0] || []));
        return { rows: (params[0] || []).map(id => ({ id })) };
      }
      return { rows: [] };
    },
  };

  const res = await hseService.deleteP5mEvent(mockDb, scope, 'ev-1');
  assert.equal(res.success, true);
  assert.equal(res.deleted_count, 3, 'Event utama + seluruh data yang digabung harus ikut terhapus');
  assert.deepEqual(deletedIds, ['ev-1', 'ev-2', 'ev-3']);
});



