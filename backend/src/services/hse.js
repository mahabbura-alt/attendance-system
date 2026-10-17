'use strict';

const { compressHsePhotos, compressNewPhotos } = require('./hsePhotoCompress');
const Workhours = require('./hseWorkhours');
const { assertCanMergeHazard } = require('./hsePermissions');

function scopeFromUser(user = {}) {
  return {
    tenantKey: String(user.tenant_id || user.tenantId || user.tenant_key || 'default'),
    projectKey: String(user.project_id || user.projectId || user.project_key || 'default'),
  };
}

function calculateRisk(likelihood, consequence) {
  const l = Math.max(1, Math.min(5, Number(likelihood) || 1));
  const c = Math.max(1, Math.min(5, Number(consequence) || 1));
  const score = l * c;
  let level = 'LOW';
  if (score >= 17) {
    level = 'EXTREME';
  } else if (score >= 10) {
    level = 'HIGH';
  } else if (score >= 5) {
    level = 'MEDIUM';
  }
  return { likelihood: l, consequence: c, riskScore: score, riskLevel: level };
}

function formatDocNumber(prefix, yearMonth, counter) {
  return `${prefix}-${yearMonth}-${String(counter).padStart(3, '0')}`;
}

async function nextSequence(db, scope, table, prefix, dateVal = new Date()) {
  const ym = `${String(dateVal.getFullYear()).slice(-2)}${String(dateVal.getMonth() + 1).padStart(2, '0')}`;
  const searchPattern = `${prefix}-${ym}-%`;
  const col = table === 'hazard_reports' ? 'report_no' :
              (table === 'incidents' ? 'incident_no' :
              (table === 'hse_ptw_permits' ? 'permit_no' :
              (table === 'hse_inspections' ? 'inspection_no' :
              (table === 'hse_emergency_drills' ? 'drill_no' :
              (table === 'hse_health_cases' ? 'case_no' :
              ((table === 'hse_p5m_events' || table === 'hse_safetytalk_events') ? 'event_no' : 'action_no'))))));
  const query = `
    SELECT ${col} AS last_no FROM ${table}
    WHERE tenant_key = $1 AND project_key = $2 AND ${col} LIKE $3
    ORDER BY ${col} DESC LIMIT 1
  `;
  const { rows } = await db.query(query, [scope.tenantKey, scope.projectKey, searchPattern]);
  let counter = 1;
  if (rows[0]?.last_no) {
    const parts = rows[0].last_no.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastNum)) counter = lastNum + 1;
  }
  return formatDocNumber(prefix, ym, counter);
}

async function getMasters(db, scope) {
  const locationsRes = await db.query(`
    SELECT l.id, l.code, l.name, l.type, l.parent_id, l.latitude, l.longitude,
           p.name AS parent_name, p.code AS parent_code
    FROM hse_locations l
    LEFT JOIN hse_locations p ON p.id = l.parent_id
    WHERE l.tenant_key = $1 AND l.project_key = $2 AND l.is_active = TRUE AND l.deleted_at IS NULL
    ORDER BY COALESCE(p.name, l.name) ASC, (l.parent_id IS NOT NULL) ASC, l.name ASC
  `, [scope.tenantKey, scope.projectKey]);

  const categoriesRes = await db.query(`
    SELECT id, domain, code, label, sort_order
    FROM hse_categories
    WHERE tenant_key = $1 AND project_key = $2 AND domain = 'HAZARD' AND is_active = TRUE
    ORDER BY sort_order ASC, label ASC
  `, [scope.tenantKey, scope.projectKey]);

  const matrixRes = await db.query(`
    SELECT kind, value, label, description, color, sort_order
    FROM hse_risk_matrix_config
    WHERE tenant_key = $1 AND project_key = $2
    ORDER BY kind ASC, sort_order ASC, value ASC
  `, [scope.tenantKey, scope.projectKey]);

  const [usersRes, posRes, deptRes, shiftRes] = await Promise.all([
    db.query(`
      SELECT id, nama, employee_id, departemen, jabatan
      FROM users
      WHERE is_active = TRUE
      ORDER BY nama ASC
    `),
    db.query(`
      SELECT id, name, department_id
      FROM workforce_positions
      WHERE is_active = TRUE
      ORDER BY name ASC
    `).catch(() => ({ rows: [] })),
    db.query(`
      SELECT id, name
      FROM workforce_departments
      WHERE is_active = TRUE
      ORDER BY name ASC
    `).catch(() => ({ rows: [] })),
    db.query(`
      SELECT id, nama_shift, operational_start, operational_end, lintas_hari
      FROM shifts
      ORDER BY operational_start ASC
    `).catch(() => ({ rows: [] }))
  ]);

  return {
    locations: locationsRes.rows,
    categories: categoriesRes.rows,
    riskMatrix: matrixRes.rows,
    employees: usersRes.rows,
    positions: posRes.rows,
    departments: deptRes.rows,
    shifts: shiftRes.rows,
  };
}

async function getOverview(db, scope) {
  // 1. Site Metrics
  const metricsRes = await db.query(`
    SELECT * FROM hse_site_metrics
    WHERE tenant_key = $1 AND project_key = $2
    LIMIT 1
  `, [scope.tenantKey, scope.projectKey]);
  const metrics = metricsRes.rows[0] || {
    last_lti_date: new Date(Date.now() - 142 * 86400000).toISOString().slice(0, 10),
    site_record_days: 210,
    target_days: 250,
    ltifr: 0.42,
    ltifr_prev: 0.61,
    trir: 1.10,
    trir_trend: 'stabil',
    near_miss_month: 9,
    compliance_training: 94.0,
    compliance_mcu: 97.0,
    compliance_simper: 91.0,
    compliance_inspection: 88.0,
  };

  // Hitung hari tanpa LTI
  const lastLtiDate = new Date(metrics.last_lti_date);
  const diffTime = Math.max(0, Date.now() - lastLtiDate.getTime());
  const daysWithoutLti = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const targetDays = metrics.target_days || 250;
  const percentTarget = Math.min(100, Math.round((daysWithoutLti / targetDays) * 100));

  // 2. Hazard counts per level & status
  const hazardCountsRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_open,
      COUNT(*) FILTER (WHERE risk_level = 'EXTREME')::int AS extreme_count,
      COUNT(*) FILTER (WHERE risk_level = 'HIGH')::int AS high_count,
      COUNT(*) FILTER (WHERE risk_level = 'MEDIUM')::int AS medium_count,
      COUNT(*) FILTER (WHERE risk_level = 'LOW')::int AS low_count
    FROM hazard_reports
    WHERE tenant_key = $1 AND project_key = $2 AND status NOT IN ('CLOSED', 'REJECTED', 'DUPLICATE') AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);
  const openHazardStats = hazardCountsRes.rows[0] || { total_open: 0, extreme_count: 0, high_count: 0, medium_count: 0, low_count: 0 };

  // 3. CAPA overdue & needs action
  const capaOverdueRes = await db.query(`
    SELECT COUNT(*)::int AS overdue_count
    FROM hse_actions
    WHERE tenant_key = $1 AND project_key = $2
      AND status NOT IN ('CLOSED', 'CANCELLED')
      AND (due_date < CURRENT_DATE OR status = 'OVERDUE')
      AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);
  const capaOverdue = capaOverdueRes.rows[0]?.overdue_count || 0;

  // 4. 6 bulan trend laporan hazard
  // Mengambil 6 bulan ke belakang
  const monthlyTrendsRes = await db.query(`
    SELECT
      TO_CHAR(report_date, 'YYYY-MM') AS month_key,
      TO_CHAR(report_date, 'Mon') AS month_label,
      COUNT(*)::int AS count
    FROM hazard_reports
    WHERE tenant_key = $1 AND project_key = $2
      AND report_date >= (CURRENT_DATE - INTERVAL '6 months')
      AND deleted_at IS NULL
    GROUP BY month_key, month_label
    ORDER BY month_key ASC
  `, [scope.tenantKey, scope.projectKey]);

  // Siapkan array 6 bulan default bila data db masih sedikit
  const months = ['Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt'];
  const fallbackValues = [50, 60, 56, 76, 68, 64];
  const monthlyTrends = months.map((m, idx) => {
    const found = monthlyTrendsRes.rows.find(r => r.month_label?.toLowerCase().startsWith(m.slice(0, 3).toLowerCase()));
    return {
      month: m,
      count: found ? found.count : fallbackValues[idx],
    };
  });

  // Action items / Perlu tindakan
  const actionItems = [
    { type: 'danger', icon: 'ti-circle-filled', text: `${capaOverdue || 2} tindakan korektif lewat tenggat`, route: 'hazard', tab: 'capa' },
    { type: 'warning', icon: 'ti-circle-filled', text: '7 SIMPER habis dalam 30 hari', route: 'competency' },
    { type: 'warning', icon: 'ti-circle-filled', text: '5 MCU jatuh tempo bulan ini', route: 'occ-health' },
    { type: 'warning', icon: 'ti-circle-filled', text: '4 APAR perlu inspeksi', route: 'emergency' },
    { type: 'accent', icon: 'ti-circle-filled', text: '3 izin kerja aktif hari ini', route: 'ptw' },
  ];

  // 5. Live incident counts
  const incidentCountsRes = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE incident_type = 'FATALITY')::int AS fatality,
      COUNT(*) FILTER (WHERE incident_type = 'LTI')::int AS lti,
      COUNT(*) FILTER (WHERE incident_type = 'MTI')::int AS mti,
      COUNT(*) FILTER (WHERE incident_type = 'FAI')::int AS fai,
      COUNT(*) FILTER (WHERE incident_type = 'NEAR_MISS')::int AS near_miss,
      COUNT(*) FILTER (WHERE incident_type = 'PROPERTY_DAMAGE')::int AS property_damage,
      COUNT(*)::int AS total
    FROM incidents
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);
  const incidentStats = incidentCountsRes.rows[0] || { fatality: 0, lti: 0, mti: 0, fai: 0, near_miss: 0, property_damage: 0, total: 0 };

  // 6. LTIFR/TRIR/jam kerja: dihitung dari jam kerja Setup Master (bukan angka statis)
  const safety = await computeSafetyKpi(db, scope, metricsRes.rows[0] ? toIsoDateOnly(metrics.last_lti_date) : null);

  return {
    hero: {
      daysWithoutLti: daysWithoutLti || 142,
      recordDays: metrics.site_record_days || 210,
      targetDays: targetDays,
      percentTarget: percentTarget || 57,
    },
    kpi: {
      ltifr: safety.ltifr,
      ltifrPrev: safety.ltifrPrev,
      ltifrTrend: safety.ltifrTrend,
      trir: safety.trir,
      trirPrev: safety.trirPrev,
      trirTrend: safety.trirTrend,
      nearMissMonth: metrics.near_miss_month || 9,
      hazardOpen: openHazardStats.total_open || 18,
      extremeCount: openHazardStats.extreme_count || 1,
    },
    hazardTrend6Months: monthlyTrends,
    hazardRiskLevels: {
      extreme: openHazardStats.extreme_count || 1,
      high: openHazardStats.high_count || 4,
      medium: openHazardStats.medium_count || 8,
      low: openHazardStats.low_count || 5,
    },
    compliance: {
      training: Number(metrics.compliance_training) || 94,
      mcu: Number(metrics.compliance_mcu) || 97,
      simper: Number(metrics.compliance_simper) || 91,
      inspection: Number(metrics.compliance_inspection) || 88,
    },
    incidents: incidentStats,
    workhours: safety.workhours,
    actionItems,
  };
}

function toIsoDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function rateTrend(current, previous, emptyText) {
  if (current == null) return emptyText;
  if (previous == null) return 'tahun berjalan';
  const fmt = n => Number(n).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (current < previous) return `turun dari ${fmt(previous)}`;
  if (current > previous) return `naik dari ${fmt(previous)}`;
  return 'stabil';
}

/**
 * KPI keselamatan untuk Ringkasan, layar besar, dan laporan bulanan.
 * LTIFR/TRIR = tahun berjalan (YTD); pembanding = YTD s/d bulan lalu.
 * Jam kerja aman = jam kerja sejak hari setelah LTI/fatality terakhir (maks. 12 bulan terakhir).
 */
async function computeSafetyKpi(db, scope, lastLtiDate) {
  const empty = {
    ltifr: null, ltifrPrev: null, ltifrTrend: 'jam kerja belum tersedia',
    trir: null, trirPrev: null, trirTrend: 'jam kerja belum tersedia',
    workhours: null,
  };
  let rep;
  try {
    rep = await getSafetyReports(db, scope);
  } catch (err) {
    console.warn('[hse] KPI jam kerja tidak tersedia:', err.message);
    return empty;
  }
  const today = Workhours.todayWib();
  const year = today.slice(0, 4);
  const curKey = today.slice(0, 7);
  const months = rep.monthlyStatistics || [];
  const ytd = rep.summary.ytd;
  const prevYtd = summarizeStats(months.filter(m => m.monthKey.startsWith(year) && m.monthKey < curKey));
  const cur = months.find(m => m.monthKey === curKey) || null;

  // Jam kerja aman sejak LTI/fatality terakhir
  const windowStart = `${months[months.length - 1]?.monthKey || curKey}-01`;
  const sinceRaw = lastLtiDate ? Workhours.addDays(lastLtiDate, 1) : `${year}-01-01`;
  const since = sinceRaw < windowStart ? windowStart : sinceRaw;
  const sinceKey = since.slice(0, 7);
  let safe = 0;
  for (const m of months) {
    if (m.monthKey > sinceKey) safe += m.hours;
  }
  if (since <= today) {
    // bulan saat periode aman dimulai: hanya jam presensi sejak tanggal tersebut
    const partialEnd = Workhours.monthEnd(since) < today ? Workhours.monthEnd(since) : today;
    const partialInternal = await Workhours.fetchLiveHoursTotal(db, scope, since, partialEnd).catch(() => 0);
    const startMonth = months.find(m => m.monthKey === sinceKey);
    const fullMonthStart = since.endsWith('-01');
    safe += fullMonthStart && startMonth ? startMonth.hours : partialInternal;
  }

  return {
    ltifr: ytd.ltifr,
    ltifrPrev: prevYtd.ltifr,
    ltifrTrend: rateTrend(ytd.ltifr, prevYtd.ltifr, 'jam kerja belum tersedia'),
    trir: ytd.trir,
    trirPrev: prevYtd.trir,
    trirTrend: rateTrend(ytd.trir, prevYtd.trir, 'jam kerja belum tersedia'),
    workhours: {
      year: Number(year),
      ytdHours: ytd.hours,
      ytdProvisional: ytd.provisional,
      ltifrYtd: ytd.ltifr,
      trirYtd: ytd.trir,
      srYtd: ytd.sr,
      ytdLti: ytd.lti,
      ytdRecordable: ytd.recordable,
      monthKey: curKey,
      monthLabel: Workhours.monthLabel(curKey),
      monthHours: cur ? cur.hours : 0,
      monthStatus: cur ? cur.hoursStatus : 'KOSONG',
      monthUncountedDays: cur ? cur.uncountedDays : 0,
      ltifrMonth: cur ? cur.ltifr : null,
      trirMonth: cur ? cur.trir : null,
      monthLti: cur ? cur.lti : 0,
      monthRecordable: cur ? cur.fatality + cur.lti + cur.mti : 0,
      safeManhours: Math.round(safe * 100) / 100,
      safeSince: since,
      safeSinceCapped: sinceRaw < windowStart,
    },
  };
}

// ============================================================================
// SMART SEMANTIC CODE ENGINE — Membaca teks manual Uraian Bahaya & Konsekuensi
// menjadi representasi kode/token terstruktur untuk deteksi 1 jenis hazard yang sama
// ============================================================================
const HAZARD_STOPWORDS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'pada', 'untuk', 'dengan', 'atau', 'belum',
  'sudah', 'masih', 'ada', 'oleh', 'karena', 'saat', 'sekitar', 'atas', 'bawah',
  'dekat', 'dalam', 'luar', 'dapat', 'bisa', 'akan', 'ini', 'itu', 'tidak', 'tak',
  'kurang', 'lebih', 'sangat', 'potensi', 'menyebabkan', 'akibat', 'dampak',
  'risiko', 'bahaya', 'kondisi', 'tindakan', 'area', 'kerja', 'lokasi', 'titik',
  'bagian', 'sehingga', 'apabila', 'bila', 'jika', 'terjadi', 'adanya', 'terdapat',
  'mulai', 'sedang', 'telah', 'harus', 'perlu', 'masuk', 'keluar',
  // Kata generik nama lokasi/site agar tidak pernah memicu kecocokan palsu antar hazard berbeda di lokasi yang sama
  'pit', 'utara', 'selatan', 'timur', 'barat', 'blok', 'block', 'km', 'bay',
  'tps', 'gudang', 'kantor', 'office', 'site', 'utama', 'main', 'tambang', 'jmb', 'dkc'
]);

const MINING_CONCEPT_RULES = [
  { code: 'SLOPE_CRACK', words: ['lereng', 'retak', 'retakan', 'longsor', 'tebing', 'dinding', 'runtuh', 'patahan', 'geotek'] },
  { code: 'BERM_SUBSIDENCE', words: ['tanggul', 'berm', 'amblas', 'ambles'] },
  { code: 'ROAD_SLIPPERY_MUD', words: ['jalan', 'hauling', 'haul', 'licin', 'lumpur', 'berlumpur', 'becek', 'grading', 'grader', 'selip', 'tergelincir', 'slip'] },
  { code: 'SEDIMENT_POND', words: ['sedimen', 'sedimentasi', 'kolam', 'trap', 'pengendapan', 'sump'] },
  { code: 'ELECTRICAL_CABLE', words: ['kabel', 'listrik', 'genset', 'panel', 'stop', 'kontak', 'terkelupas', 'kelupas', 'isolasi', 'tegangan', 'setrum', 'konslet', 'korsleting', 'elcb', 'power', 'trafo'] },
  { code: 'PIPE_FUEL_LEAK', words: ['pipa', 'flange', 'tangki', 'solar', 'bbm', 'bocor', 'kebocoran', 'rembes'] },
  { code: 'OIL_SPILL_FLOOR', words: ['oli', 'pelumas', 'tumpah', 'tumpahan', 'ceceran', 'lantai', 'drum'] },
  { code: 'LIGHTING_TOWER', words: ['lampu', 'penerangan', 'tower', 'light', 'bohlam', 'gelap', 'mati', 'redup'] },
  { code: 'SIGN_FALLEN', words: ['rambu', 'roboh', 'tertabrak', 'pohon', 'kecepatan'] },
  { code: 'SIGN_FADED_TAPE', words: ['pita', 'reflektif', 'patok', 'bendera', 'kusam', 'pudar', 'label', 'putus'] },
  { code: 'UNIT_MIRROR_GLASS', words: ['spion', 'kaca', 'blind', 'spot', 'pecah'] },
  { code: 'UNIT_BRAKE_TYRE', words: ['rem', 'brake', 'ban', 'tyre', 'kemudi', 'steering', 'hidrolik'] },
  { code: 'HEIGHT_SCAFFOLD', words: ['tangga', 'perancah', 'scaffolding', 'handrail', 'pin', 'goyang', 'ketinggian', 'pijakan'] },
  { code: 'HOUSEKEEPING_TOOLS', words: ['sapu', 'pembersih', 'rak', 'sampah', 'p3k', 'kassa', 'kotak', 'tertutup', 'berantakan'] },
];

function stemIndonesianWord(word) {
  let w = String(word || '').toLowerCase().trim();
  if (w.length <= 4) return w;
  if (w.endsWith('nya') && w.length > 5) w = w.slice(0, -3);
  if (w.endsWith('kan') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('an') && w.length > 5) w = w.slice(0, -2);
  if (w.startsWith('meng') && w.length > 6) w = w.slice(4);
  else if (w.startsWith('meny') && w.length > 6) w = 's' + w.slice(4);
  else if (w.startsWith('mem') && w.length > 6) w = w.slice(3);
  else if (w.startsWith('men') && w.length > 6) w = w.slice(3);
  else if (w.startsWith('ber') && w.length > 5) w = w.slice(3);
  else if (w.startsWith('ter') && w.length > 5) w = w.slice(3);
  else if (w.startsWith('per') && w.length > 5) w = w.slice(3);
  else if (w.startsWith('di') && w.length > 5) w = w.slice(2);
  return w;
}

function buildHazardSemanticCode(description, potentialConsequence) {
  const combinedRaw = `${description || ''} ${potentialConsequence || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');

  const rawWords = combinedRaw
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !HAZARD_STOPWORDS.has(w) && !/^\d+$/.test(w));

  const concepts = new Set();
  for (const rule of MINING_CONCEPT_RULES) {
    let hitCount = 0;
    for (const w of rawWords) {
      if (rule.words.includes(w) || rule.words.includes(stemIndonesianWord(w))) {
        hitCount += 1;
      }
    }
    if (hitCount >= 2 || (hitCount === 1 && rawWords.length <= 4)) {
      concepts.add(rule.code);
    }
  }

  const rootTokensSet = new Set();
  for (const w of rawWords) {
    const stem = stemIndonesianWord(w);
    if (stem.length >= 3 && !HAZARD_STOPWORDS.has(stem)) {
      rootTokensSet.add(stem);
    }
  }

  const conceptList = Array.from(concepts).sort();
  const rootTokens = Array.from(rootTokensSet).sort();

  const normalizedJoined = rootTokens.join('');
  const trigrams = new Set();
  for (let i = 0; i <= normalizedJoined.length - 3; i++) {
    trigrams.add(normalizedJoined.slice(i, i + 3));
  }

  const signature = `CODE[${conceptList.join(',')}]::ROOT[${rootTokens.join(',')}]`;
  return {
    concepts: conceptList,
    rootTokens,
    trigrams: Array.from(trigrams),
    signature,
  };
}

function extractExplicitSubLocationMarkers(text) {
  const markers = new Map();
  const raw = String(text || '').toLowerCase();
  const regex = /\b(pit|blok|block|km|bay|seam|panel|jalur|lantai)\s*([0-9]+(?:\.[0-9]+)?|[a-z])\b/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const kind = match[1].toLowerCase() === 'block' ? 'blok' : match[1].toLowerCase();
    const val = match[2].toLowerCase();
    markers.set(kind, val);
  }
  return markers;
}

function hasConflictingSubLocationInText(descA, descB) {
  const mA = extractExplicitSubLocationMarkers(descA);
  const mB = extractExplicitSubLocationMarkers(descB);
  for (const [kind, valA] of mA.entries()) {
    if (mB.has(kind) && mB.get(kind) !== valA) {
      return true;
    }
  }
  return false;
}

function isSameHazardArea(hzA, hzB) {
  // Pengecualian ketat: Algoritma pintar HANYA dijalankan jika Area/Lokasi DAN Sub-Area SAMA PERSIS
  if (!hzA || !hzB) return false;

  // 1. Jika salah satu atau keduanya memiliki location_id, keduanya wajib memiliki location_id yang SAMA PERSIS
  if (hzA.location_id || hzB.location_id) {
    if (!hzA.location_id || !hzB.location_id) return false;
    if (String(hzA.location_id) !== String(hzB.location_id)) return false;
  } else {
    const locA = String(hzA.location_name || '').trim().toLowerCase();
    const locB = String(hzB.location_name || '').trim().toLowerCase();
    if (!locA || !locB || locA !== locB) return false;
  }

  // 2. Pastikan Area Induk (area_id) DAN Sub-Area (sub_area_id) keduanya terisi dan SAMA PERSIS
  const hasHierarchyMeta = ('area_id' in hzA) || ('area_id' in hzB) || ('sub_area_id' in hzA) || ('sub_area_id' in hzB);
  if (hasHierarchyMeta) {
    if (!hzA.area_id || !hzB.area_id) return false;
    if (!hzA.sub_area_id || !hzB.sub_area_id) return false;
    if (String(hzA.area_id) !== String(hzB.area_id)) return false;
    if (String(hzA.sub_area_id) !== String(hzB.sub_area_id)) return false;
  }

  // 3. Jika di dalam teks uraian tertulis penyebutan titik/sub-area berbeda (misal KM 2 vs KM 4, Bay 1 vs Bay 3, Blok 1 vs Blok 2), batalkan
  if (hasConflictingSubLocationInText(hzA.description, hzB.description)) {
    return false;
  }

  return true;
}

function isHazardOpenForSmartDetection(hz) {
  if (!hz) return false;
  if (hz.merged_into_id) return false;
  return !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(String(hz.status || '').toUpperCase());
}

function computeHazardSimilarity(hzA, hzB) {
  if (!hzA || !hzB || String(hzA.id) === String(hzB.id)) {
    return { isSameHazard: false, similarityPct: 0, matchedConcepts: [], matchedTokens: [] };
  }
  // Pengecualian utama: Jika Area/Lokasi atau Sub-Area berbeda, algoritma pintar TIDAK dijalankan
  if (!isSameHazardArea(hzA, hzB)) {
    return { isSameHazard: false, similarityPct: 0, matchedConcepts: [], matchedTokens: [] };
  }
  if (!isHazardOpenForSmartDetection(hzA) || !isHazardOpenForSmartDetection(hzB)) {
    return { isSameHazard: false, similarityPct: 0, matchedConcepts: [], matchedTokens: [] };
  }

  const codeA = buildHazardSemanticCode(hzA.description, hzA.potential_consequence);
  const codeB = buildHazardSemanticCode(hzB.description, hzB.potential_consequence);

  const setConceptB = new Set(codeB.concepts);
  const matchedConcepts = codeA.concepts.filter(c => setConceptB.has(c));

  const setTokensB = new Set(codeB.rootTokens);
  const matchedTokens = codeA.rootTokens.filter(t => setTokensB.has(t));

  // Wajib memiliki minimal 2 akar kata bahaya spesifik (non-lokasi) yang sama agar tidak pernah salah mendeteksi 1 kata umum
  if (matchedTokens.length < 2) {
    return { isSameHazard: false, similarityPct: 0, matchedConcepts, matchedTokens };
  }

  const setTrigramsB = new Set(codeB.trigrams);
  const matchedTrigrams = codeA.trigrams.filter(g => setTrigramsB.has(g));

  const minTokens = Math.min(codeA.rootTokens.length, codeB.rootTokens.length);
  const unionTokens = new Set([...codeA.rootTokens, ...codeB.rootTokens]).size;
  const tokenOverlap = minTokens > 0 ? matchedTokens.length / minTokens : 0;
  const tokenJaccard = unionTokens > 0 ? matchedTokens.length / unionTokens : 0;

  const totalTrigrams = codeA.trigrams.length + codeB.trigrams.length;
  const trigramDice = totalTrigrams > 0 ? (2 * matchedTrigrams.length) / totalTrigrams : 0;

  const minConcepts = Math.min(codeA.concepts.length, codeB.concepts.length);
  const conceptOverlap = minConcepts > 0 ? matchedConcepts.length / minConcepts : 0;

  let rawScore = (conceptOverlap * 0.35) + (tokenOverlap * 0.40) + (trigramDice * 0.25);
  if (matchedConcepts.length >= 1 && matchedTokens.length >= 3 && tokenOverlap >= 0.35) {
    rawScore = Math.max(rawScore, 0.65 + Math.min(0.30, matchedTokens.length * 0.06));
  } else if (matchedTokens.length >= 2 && tokenOverlap >= 0.40) {
    rawScore = Math.max(rawScore, 0.58 + tokenJaccard * 0.35);
  }

  const similarityPct = Math.min(99, Math.round(rawScore * 100));
  const isSameHazard = similarityPct >= 55 && matchedTokens.length >= 2 && (tokenOverlap >= 0.34 || tokenJaccard >= 0.25);

  return {
    isSameHazard,
    similarityPct,
    matchedConcepts,
    matchedTokens,
  };
}

function buildReporterEntry(row, isPrimary = false) {
  return {
    hazard_id: row.id,
    report_no: row.report_no,
    reported_by: row.reported_by || null,
    reported_by_name: row.reported_by_name || row.assigned_to_name || 'Personil Tambang',
    reported_by_dept: row.reported_by_dept || 'Operasional',
    reported_by_role: row.reported_by_role || 'Karyawan',
    report_date: row.report_date,
    report_time: row.report_time,
    description: row.description,
    potential_consequence: row.potential_consequence || null,
    is_primary: isPrimary,
  };
}

async function listHazards(db, scope, filters = {}) {
  const conditions = [
    'h.tenant_key = $1',
    'h.project_key = $2',
    'h.deleted_at IS NULL',
  ];
  const params = [scope.tenantKey, scope.projectKey];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`h.status = $${params.length}`);
  }
  if (filters.risk_level) {
    params.push(filters.risk_level);
    conditions.push(`h.risk_level = $${params.length}`);
  }
  if (filters.location_id) {
    params.push(filters.location_id);
    conditions.push(`(h.location_id = $${params.length} OR l.parent_id = $${params.length})`);
  }
  if (filters.category_id) {
    params.push(filters.category_id);
    conditions.push(`h.category_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(h.report_no) LIKE $${params.length} OR
      LOWER(h.description) LIKE $${params.length} OR
      LOWER(COALESCE(h.location_name, '')) LIKE $${params.length} OR
      LOWER(COALESCE(h.category_name, '')) LIKE $${params.length} OR
      LOWER(COALESCE(u.nama, '')) LIKE $${params.length}
    )`);
  }

  const query = `
    SELECT
      h.id, h.report_no, h.report_date, h.report_time,
      h.location_id,
      COALESCE(l.parent_id, l.id) AS area_id,
      COALESCE(p.name, l.name, h.location_name) AS area_name,
      CASE WHEN l.parent_id IS NOT NULL THEN l.id ELSE NULL END AS sub_area_id,
      CASE WHEN l.parent_id IS NOT NULL THEN l.name ELSE NULL END AS sub_area_name,
      CASE
        WHEN p.name IS NOT NULL THEN p.name || ' ▸ ' || l.name
        ELSE COALESCE(l.name, h.location_name)
      END AS location_name,
      h.category_id, COALESCE(c.label, h.category_name) AS category_name,
      h.description, h.potential_consequence, h.photos,
      h.likelihood, h.consequence, h.risk_score, h.risk_level,
      h.assigned_to, COALESCE(u.nama, h.assigned_to_name) AS assigned_to_name,
      h.reported_by, COALESCE(rep.nama, h.reported_by_name) AS reported_by_name,
      COALESCE(rep.departemen, h.reported_by_dept) AS reported_by_dept,
      COALESCE(rep.jabatan, h.reported_by_role) AS reported_by_role,
      h.status, h.closed_at, h.created_at,
      h.merged_into_id, h.merged_at, h.semantic_signature,
      (SELECT COUNT(*)::int FROM hse_actions a WHERE a.source_type = 'HAZARD' AND a.source_id = h.id AND a.deleted_at IS NULL) AS capa_count,
      (SELECT COUNT(*)::int FROM hse_actions a WHERE a.source_type = 'HAZARD' AND a.source_id = h.id AND a.status = 'CLOSED' AND a.deleted_at IS NULL) AS capa_closed_count
    FROM hazard_reports h
    LEFT JOIN hse_locations l ON l.id = h.location_id
    LEFT JOIN hse_locations p ON p.id = l.parent_id
    LEFT JOIN hse_categories c ON c.id = h.category_id
    LEFT JOIN users u ON u.id = h.assigned_to
    LEFT JOIN users rep ON rep.id = h.reported_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY h.report_date DESC, h.created_at DESC
  `;

  const { rows } = await db.query(query, params);

  // Ambil juga laporan child yang telah digabungkan (merged_into_id IS NOT NULL) agar daftar pelapor administrasi selalu utuh
  let mergedChildRows = [];
  try {
    const mergedRes = await db.query(`
      SELECT
        m.id, m.report_no, m.report_date, m.report_time,
        m.description, m.potential_consequence, m.merged_into_id, m.merged_at,
        m.reported_by, COALESCE(rep.nama, m.reported_by_name) AS reported_by_name,
        COALESCE(rep.departemen, m.reported_by_dept) AS reported_by_dept,
        COALESCE(rep.jabatan, m.reported_by_role) AS reported_by_role
      FROM hazard_reports m
      LEFT JOIN users rep ON rep.id = m.reported_by
      WHERE m.tenant_key = $1 AND m.project_key = $2
        AND m.merged_into_id IS NOT NULL
        AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC
    `, [scope.tenantKey, scope.projectKey]);
    mergedChildRows = Array.isArray(mergedRes?.rows) ? mergedRes.rows : [];
  } catch (_) {
    mergedChildRows = [];
  }

  const childrenByParent = new Map();
  for (const child of mergedChildRows) {
    const pid = String(child.merged_into_id);
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(child);
  }

  // Hanya tampilkan laporan utama (bukan baris duplikat yang sudah digabungkan ke hazard lain)
  // kecuali user secara eksplisit memfilter status = 'DUPLICATE'
  const visibleRows = filters.status === 'DUPLICATE'
    ? rows
    : rows.filter(r => !r.merged_into_id && r.status !== 'DUPLICATE');

  for (const row of visibleRows) {
    const children = childrenByParent.get(String(row.id)) || [];
    row.reporters_list = [
      buildReporterEntry(row, true),
      ...children.map(c => buildReporterEntry(c, false)),
    ];
    row.reporter_count = row.reporters_list.length;
    row.merged_reports_count = children.length;
    row.similar_hazards = [];
  }

  // Deteksi pintar 1 jenis hazard yang sama HANYA jika Area/Lokasi & Sub-Area SAMA PERSIS & belum CLOSED
  for (let i = 0; i < visibleRows.length; i++) {
    const a = visibleRows[i];
    if (!isHazardOpenForSmartDetection(a)) continue;
    for (let j = i + 1; j < visibleRows.length; j++) {
      const b = visibleRows[j];
      if (!isHazardOpenForSmartDetection(b)) continue;
      if (!isSameHazardArea(a, b)) continue;
      const sim = computeHazardSimilarity(a, b);
      if (sim.isSameHazard) {
        a.similar_hazards.push({
          id: b.id,
          report_no: b.report_no,
          description: b.description,
          potential_consequence: b.potential_consequence,
          location_name: b.location_name,
          area_name: b.area_name,
          sub_area_name: b.sub_area_name,
          reported_by_name: b.reported_by_name || 'Personil Tambang',
          report_date: b.report_date,
          status: b.status,
          risk_level: b.risk_level,
          similarity_pct: sim.similarityPct,
        });
        b.similar_hazards.push({
          id: a.id,
          report_no: a.report_no,
          description: a.description,
          potential_consequence: a.potential_consequence,
          location_name: a.location_name,
          area_name: a.area_name,
          sub_area_name: a.sub_area_name,
          reported_by_name: a.reported_by_name || 'Personil Tambang',
          report_date: a.report_date,
          status: a.status,
          risk_level: a.risk_level,
          similarity_pct: sim.similarityPct,
        });
      }
    }
  }

  return visibleRows;
}

async function getHazardDetail(db, scope, id) {
  const hazardRes = await db.query(`
    SELECT
      h.*,
      COALESCE(l.parent_id, l.id) AS area_id,
      COALESCE(p.name, l.name, h.location_name) AS area_name,
      CASE WHEN l.parent_id IS NOT NULL THEN l.id ELSE NULL END AS sub_area_id,
      CASE WHEN l.parent_id IS NOT NULL THEN l.name ELSE NULL END AS sub_area_name,
      CASE
        WHEN p.name IS NOT NULL THEN p.name || ' ▸ ' || l.name
        ELSE COALESCE(l.name, h.location_name)
      END AS location_name,
      COALESCE(c.label, h.category_name) AS category_name,
      COALESCE(u.nama, h.assigned_to_name) AS assigned_to_name,
      COALESCE(rep.nama, h.reported_by_name) AS reported_by_name,
      COALESCE(rep.departemen, h.reported_by_dept) AS reported_by_dept,
      COALESCE(rep.jabatan, h.reported_by_role) AS reported_by_role
    FROM hazard_reports h
    LEFT JOIN hse_locations l ON l.id = h.location_id
    LEFT JOIN hse_locations p ON p.id = l.parent_id
    LEFT JOIN hse_categories c ON c.id = h.category_id
    LEFT JOIN users u ON u.id = h.assigned_to
    LEFT JOIN users rep ON rep.id = h.reported_by
    WHERE h.id = $1 AND h.tenant_key = $2 AND h.project_key = $3 AND h.deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!hazardRes.rows[0]) {
    const error = new Error('Laporan hazard tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }
  const hazard = hazardRes.rows[0];

  const actionsRes = await db.query(`
    SELECT
      a.*,
      COALESCE(u.nama, a.pic_name) AS pic_name
    FROM hse_actions a
    LEFT JOIN users u ON u.id = a.pic_employee_id
    WHERE a.source_type = 'HAZARD' AND a.source_id = $1 AND a.tenant_key = $2 AND a.project_key = $3 AND a.deleted_at IS NULL
    ORDER BY a.created_at ASC
  `, [id, scope.tenantKey, scope.projectKey]);

  // Ambil daftar laporan yang digabungkan ke hazard ini (catatan administrasi pelapor)
  let mergedChildRows = [];
  try {
    const mergedRes = await db.query(`
      SELECT
        m.id, m.report_no, m.report_date, m.report_time,
        m.description, m.potential_consequence, m.merged_into_id, m.merged_at,
        m.reported_by, COALESCE(rep.nama, m.reported_by_name) AS reported_by_name,
        COALESCE(rep.departemen, m.reported_by_dept) AS reported_by_dept,
        COALESCE(rep.jabatan, m.reported_by_role) AS reported_by_role
      FROM hazard_reports m
      LEFT JOIN users rep ON rep.id = m.reported_by
      WHERE m.merged_into_id = $1 AND m.tenant_key = $2 AND m.project_key = $3 AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC
    `, [id, scope.tenantKey, scope.projectKey]);
    mergedChildRows = Array.isArray(mergedRes?.rows) ? mergedRes.rows : [];
  } catch (_) {
    mergedChildRows = [];
  }

  const reportersList = [
    buildReporterEntry(hazard, true),
    ...mergedChildRows.map(c => buildReporterEntry(c, false)),
  ];

  // Cari kandidat hazard aktif di Area/Lokasi & Sub-Area yang SAMA PERSIS yang terdeteksi sebagai 1 jenis hazard yang sama
  const similarHazards = [];
  if (isHazardOpenForSmartDetection(hazard) && hazard.location_id) {
    try {
      const candRes = await db.query(`
        SELECT
          cand.id, cand.report_no, cand.report_date, cand.report_time,
          cand.location_id,
          COALESCE(l.parent_id, l.id) AS area_id,
          COALESCE(p.name, l.name, cand.location_name) AS area_name,
          CASE WHEN l.parent_id IS NOT NULL THEN l.id ELSE NULL END AS sub_area_id,
          CASE WHEN l.parent_id IS NOT NULL THEN l.name ELSE NULL END AS sub_area_name,
          CASE
            WHEN p.name IS NOT NULL THEN p.name || ' ▸ ' || l.name
            ELSE COALESCE(l.name, cand.location_name)
          END AS location_name,
          cand.description, cand.potential_consequence, cand.status, cand.risk_level, cand.merged_into_id,
          COALESCE(rep.nama, cand.reported_by_name) AS reported_by_name
        FROM hazard_reports cand
        LEFT JOIN hse_locations l ON l.id = cand.location_id
        LEFT JOIN hse_locations p ON p.id = l.parent_id
        LEFT JOIN users rep ON rep.id = cand.reported_by
        WHERE cand.tenant_key = $1 AND cand.project_key = $2
          AND cand.id != $3
          AND cand.location_id = $4
          AND cand.merged_into_id IS NULL
          AND cand.status NOT IN ('CLOSED', 'REJECTED', 'DUPLICATE')
          AND cand.deleted_at IS NULL
      `, [scope.tenantKey, scope.projectKey, id, hazard.location_id]);
      const candidates = Array.isArray(candRes?.rows) ? candRes.rows : [];
      for (const c of candidates) {
        if (!isSameHazardArea(hazard, c)) continue;
        const sim = computeHazardSimilarity(hazard, c);
        if (sim.isSameHazard) {
          similarHazards.push({
            id: c.id,
            report_no: c.report_no,
            description: c.description,
            potential_consequence: c.potential_consequence,
            location_name: c.location_name,
            area_name: c.area_name,
            sub_area_name: c.sub_area_name,
            reported_by_name: c.reported_by_name || 'Personil Tambang',
            report_date: c.report_date,
            status: c.status,
            risk_level: c.risk_level,
            similarity_pct: sim.similarityPct,
          });
        }
      }
    } catch (_) {}
  }

  return {
    ...hazard,
    actions: actionsRes.rows,
    capa_progress: capaProgressOf(actionsRes.rows),
    reporters_list: reportersList,
    reporter_count: reportersList.length,
    merged_reports_count: mergedChildRows.length,
    similar_hazards: similarHazards,
  };
}

async function createHazard(db, scope, user, input) {
  if (!input.description || !String(input.description).trim()) {
    const error = new Error('Uraian hazard wajib diisi');
    error.statusCode = 422;
    throw error;
  }

  const { likelihood, consequence, riskScore, riskLevel } = calculateRisk(input.likelihood, input.consequence);
  const reportNo = await nextSequence(db, scope, 'hazard_reports', 'HZD');

  let locationName = input.location_name || null;
  if (input.location_id) {
    const locRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [input.location_id]);
    if (locRes.rows[0]) locationName = locRes.rows[0].name;
  }

  let categoryName = input.category_name || null;
  if (input.category_id) {
    const catRes = await db.query('SELECT label FROM hse_categories WHERE id = $1', [input.category_id]);
    if (catRes.rows[0]) categoryName = catRes.rows[0].label;
  }

  let assignedToName = input.assigned_to_name || null;
  if (input.assigned_to) {
    const userRes = await db.query('SELECT nama FROM users WHERE id = $1', [input.assigned_to]);
    if (userRes.rows[0]) assignedToName = userRes.rows[0].nama;
  }

  // Pelapor (Report By)
  let reportedBy = input.reported_by || user?.id || null;
  let reportedByName = input.reported_by_name || user?.nama || user?.email || null;
  let reportedByDept = input.reported_by_dept || user?.departemen || null;
  let reportedByRole = input.reported_by_role || user?.jabatan || null;

  if (input.reported_by) {
    const repRes = await db.query('SELECT nama, departemen, jabatan FROM users WHERE id = $1', [input.reported_by]);
    if (repRes.rows[0]) {
      reportedByName = repRes.rows[0].nama;
      reportedByDept = repRes.rows[0].departemen || null;
      reportedByRole = repRes.rows[0].jabatan || null;
    }
  }

  const cleanDescription = String(input.description).trim();
  const potentialConsequence = input.potential_consequence ? String(input.potential_consequence).trim() : null;
  const photos = await compressHsePhotos(Array.isArray(input.photos) ? input.photos : (input.photo ? [input.photo] : []));
  const semanticCode = buildHazardSemanticCode(cleanDescription, potentialConsequence);

  const recommendation = input.recommendation ? String(input.recommendation).trim() || null : null;

  const insertRes = await db.query(`
    INSERT INTO hazard_reports (
      tenant_key, project_key, report_no, reported_by, reported_by_name,
      reported_by_dept, reported_by_role,
      report_date, report_time, location_id, location_name, category_id, category_name,
      description, potential_consequence, photos, likelihood, consequence, risk_score, risk_level,
      assigned_to, assigned_to_name, status, created_by, semantic_signature, recommendation
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7,
      COALESCE($8, CURRENT_DATE), COALESCE($9, CURRENT_TIME), $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19, $20,
      $21, $22, 'NEW', $23, $24, $25
    ) RETURNING *
  `, [
    scope.tenantKey, scope.projectKey, reportNo, reportedBy, reportedByName,
    reportedByDept, reportedByRole,
    input.report_date || null, input.report_time || null, input.location_id || null, locationName,
    input.category_id || null, categoryName, cleanDescription, potentialConsequence,
    photos, likelihood, consequence, riskScore, riskLevel,
    input.assigned_to || null, assignedToName, user?.id || null, semanticCode.signature, recommendation,
  ]);

  const createdHazard = insertRes.rows[0];

  // CAPA awal: dari initial_action eksplisit, atau otomatis dari Rekomendasi Perbaikan bila PIC dipilih.
  // auto_capa === false dipakai pemanggil yang membuat CAPA sendiri (APK: satu CAPA per PIC).
  let createdAction = null;
  if (input.initial_action && input.initial_action.description) {
    createdAction = await createAction(db, scope, user, {
      source_type: 'HAZARD',
      source_id: createdHazard.id,
      description: input.initial_action.description,
      action_type: input.initial_action.action_type || 'CORRECTIVE',
      pic_employee_id: input.initial_action.pic_employee_id || input.assigned_to || null,
      due_date: input.initial_action.due_date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    });
  } else if (input.auto_capa !== false && recommendation && input.assigned_to) {
    const dueAt = dueAtForRisk(riskLevel);
    createdAction = await createAction(db, scope, user, {
      source_type: 'HAZARD',
      source_id: createdHazard.id,
      description: recommendation,
      action_type: 'CORRECTIVE',
      pic_employee_id: input.assigned_to,
      due_date: wibDateOf(dueAt),
    });
    await db.query('UPDATE hse_actions SET due_at = $1 WHERE id = $2', [dueAt.toISOString(), createdAction.id]);
  }

  return { ...createdHazard, initialAction: createdAction };
}

// ---------------------------------------------------------------
// Rekomendasi → CAPA → status hazard otomatis
// ---------------------------------------------------------------

/** Batas tindak lanjut PIC per tingkat risiko (jam) — keputusan owner OMOS Safety. */
const HAZARD_SLA_HOURS = { EXTREME: 24, HIGH: 72, MEDIUM: 168, LOW: 336 };

function dueAtForRisk(riskLevel, from = new Date()) {
  return new Date(from.getTime() + (HAZARD_SLA_HOURS[riskLevel] || HAZARD_SLA_HOURS.LOW) * 3600 * 1000);
}

function wibDateOf(date) {
  return new Date(date.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const CAPA_STARTED = ['IN_PROGRESS', 'DONE_PENDING_VERIFY', 'CLOSED'];
const HAZARD_TERMINAL = ['CANCELLED', 'DUPLICATE', 'REJECTED'];

/**
 * Status hazard mengikuti progres CAPA-nya (dari APK maupun dashboard):
 * semua Closed → CLOSED; semua bukti terkirim/selesai → VERIFY; ada yang mulai → IN_ACTION; belum ada yang mulai → NEW/ASSESSED.
 * Hazard tanpa CAPA, atau berstatus CANCELLED/DUPLICATE/REJECTED, tidak diubah.
 */
async function syncHazardStatusFromActions(db, hazardId, user = null) {
  const { rows: actions } = await db.query(`
    SELECT status, started_at FROM hse_actions
    WHERE source_type = 'HAZARD' AND source_id = $1 AND deleted_at IS NULL
  `, [hazardId]);
  const live = (actions || []).filter(a => a.status !== 'CANCELLED');
  if (!live.length) return null;
  const { rows } = await db.query('SELECT status FROM hazard_reports WHERE id = $1', [hazardId]);
  const current = rows[0]?.status;
  if (!current || HAZARD_TERMINAL.includes(current)) return current || null;

  let next;
  if (live.every(a => a.status === 'CLOSED')) next = 'CLOSED';
  else if (live.every(a => ['DONE_PENDING_VERIFY', 'CLOSED'].includes(a.status))) next = 'VERIFY';
  else if (live.some(a => a.started_at || CAPA_STARTED.includes(a.status))) next = 'IN_ACTION';
  else next = ['NEW', 'ASSESSED'].includes(current) ? current : 'NEW';

  if (next !== current) {
    await db.query(`
      UPDATE hazard_reports SET status = $1,
        closed_at = CASE WHEN $1 = 'CLOSED' THEN COALESCE(closed_at, now()) ELSE NULL END,
        closed_by = CASE WHEN $1 = 'CLOSED' THEN COALESCE(closed_by, $2::uuid) ELSE NULL END,
        updated_at = now()
      WHERE id = $3 AND status NOT IN ('CANCELLED', 'DUPLICATE', 'REJECTED')
    `, [next, user?.id || null, hazardId]);
  }
  return next;
}

/** Ringkasan progres CAPA sebuah hazard untuk tampilan (dashboard & APK). */
function capaProgressOf(actions) {
  const live = (Array.isArray(actions) ? actions : []).filter(a => a.status !== 'CANCELLED');
  const count = s => live.filter(a => a.status === s).length;
  const closed = count('CLOSED');
  return {
    total: live.length,
    closed,
    waiting_verify: count('DONE_PENDING_VERIFY'),
    in_progress: live.filter(a => a.status === 'IN_PROGRESS' || (a.status !== 'CLOSED' && a.status !== 'DONE_PENDING_VERIFY' && a.started_at)).length,
    open: live.filter(a => ['OPEN', 'OVERDUE'].includes(a.status) && !a.started_at).length,
    percent: live.length ? Math.round((closed / live.length) * 100) : 0,
  };
}

/**
 * Gabungkan laporan sumber ke laporan utama.
 * Syarat (perbaikan K6–K7): izin hse.merge / Admin Utama, alasan wajib, kedua laporan masih terbuka
 * dan belum digabung. Setiap gabung tercatat di hse_hazard_merge_log; saran AI terkait ditandai ACCEPTED.
 */
async function mergeSimilarHazards(db, scope, user, targetHazardId, sourceHazardId, options = {}) {
  const mergeError = (message, statusCode, code) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (code) { error.code = code; error.details = { code }; }
    return error;
  };
  assertCanMergeHazard(user);
  if (!targetHazardId || !sourceHazardId || String(targetHazardId) === String(sourceHazardId)) {
    throw mergeError('ID laporan hazard utama dan laporan yang digabungkan harus valid dan berbeda', 422);
  }
  const reason = String(options.reason || '').trim();
  if (reason.length < 3) {
    throw mergeError('Alasan penggabungan wajib diisi (min. 3 karakter).', 422, 'REASON_REQUIRED');
  }

  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const tx = client !== db;
  try {
    if (tx) await client.query('BEGIN');
    const lockSql = tx ? ' FOR UPDATE' : '';
    const targetRes = await client.query(
      `SELECT id, report_no, status, merged_into_id FROM hazard_reports WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL${lockSql}`,
      [targetHazardId, scope.tenantKey, scope.projectKey]
    );
    const target = targetRes.rows[0];
    if (!target) throw mergeError('Laporan hazard utama tidak ditemukan', 404);

    const sourceRes = await client.query(
      `SELECT id, report_no, status, merged_into_id FROM hazard_reports WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL${lockSql}`,
      [sourceHazardId, scope.tenantKey, scope.projectKey]
    );
    const source = sourceRes.rows[0];
    if (!source) throw mergeError('Laporan hazard yang akan digabungkan tidak ditemukan', 404);

    const closed = ['CLOSED', 'REJECTED', 'DUPLICATE'];
    if (target.merged_into_id || closed.includes(String(target.status || '').toUpperCase())) {
      throw mergeError(`Laporan utama #${target.report_no} sudah ${target.merged_into_id ? 'digabung' : String(target.status).toLowerCase()}; pilih laporan utama yang masih terbuka.`, 409, 'TARGET_NOT_OPEN');
    }
    if (source.merged_into_id || closed.includes(String(source.status || '').toUpperCase())) {
      throw mergeError(`Laporan #${source.report_no} sudah ${source.merged_into_id ? 'digabung' : String(source.status).toLowerCase()} dan tidak bisa digabung lagi.`, 409, 'SOURCE_NOT_OPEN');
    }

    // Tandai laporan kedua sebagai tergabung ke laporan utama, namun tetap tersimpan sebagai catatan administrasi pelapor
    await client.query(`
      UPDATE hazard_reports
      SET merged_into_id = $1,
          status = 'DUPLICATE',
          merged_at = CURRENT_TIMESTAMP,
          merged_by = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND tenant_key = $4 AND project_key = $5
    `, [targetHazardId, user?.id || null, sourceHazardId, scope.tenantKey, scope.projectKey]);

    // Jika laporan kedua sebelumnya punya child yang tergabung padanya, arahkan ke targetHazardId
    await client.query(`
      UPDATE hazard_reports
      SET merged_into_id = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE merged_into_id = $2 AND tenant_key = $3 AND project_key = $4
    `, [targetHazardId, sourceHazardId, scope.tenantKey, scope.projectKey]);

    // Pindahkan CAPA terkait dari sourceHazardId ke targetHazardId agar tindak lanjut terpusat
    await client.query(`
      UPDATE hse_actions
      SET source_id = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE source_type = 'HAZARD' AND source_id = $2 AND tenant_key = $3 AND project_key = $4 AND deleted_at IS NULL
    `, [targetHazardId, sourceHazardId, scope.tenantKey, scope.projectKey]);

    // Audit gabung + status saran AI (migrasi 099). Tanpa migrasi 099 gabung tetap jalan.
    const engine = ['LLM', 'RULE', 'MANUAL'].includes(String(options.engine || '').toUpperCase())
      ? String(options.engine).toUpperCase() : (options.suggestion_id ? 'LLM' : 'MANUAL');
    if (tx) await client.query('SAVEPOINT omos_merge_log');
    try {
      await client.query(`
        INSERT INTO hse_hazard_merge_log (tenant_key, project_key, target_id, source_id, reason, suggestion_id, engine, merged_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [scope.tenantKey, scope.projectKey, targetHazardId, sourceHazardId, reason, options.suggestion_id || null, engine, user?.id || null]);
      await client.query(`
        UPDATE hse_ai_suggestions
        SET status = CASE WHEN (hazard_id = $3 AND candidate_hazard_id = $4) OR (hazard_id = $4 AND candidate_hazard_id = $3)
                          THEN 'ACCEPTED' ELSE 'SUPERSEDED' END,
            decided_by = $5, decided_at = CURRENT_TIMESTAMP,
            decision_note = CASE WHEN (hazard_id = $3 AND candidate_hazard_id = $4) OR (hazard_id = $4 AND candidate_hazard_id = $3)
                                 THEN $6 ELSE decision_note END
        WHERE tenant_key = $1 AND project_key = $2 AND kind = 'DUPLICATE' AND status = 'PENDING'
          AND (hazard_id = $4 OR candidate_hazard_id = $4)
      `, [scope.tenantKey, scope.projectKey, targetHazardId, sourceHazardId, user?.id || null, reason]);
    } catch (logErr) {
      if (logErr.code !== '42P01') throw logErr;
      if (tx) await client.query('ROLLBACK TO SAVEPOINT omos_merge_log');
    }
    if (tx) await client.query('COMMIT');
  } catch (err) {
    if (tx) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (tx && typeof client.release === 'function') client.release();
  }

  return getHazardDetail(db, scope, targetHazardId);
}

async function getHazardReporterStats(db, scope) {
  const summaryRes = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE merged_into_id IS NULL AND status != 'DUPLICATE')::int AS unique_hazard_count,
      COUNT(*) FILTER (WHERE merged_into_id IS NULL AND status NOT IN ('CLOSED', 'REJECTED', 'DUPLICATE'))::int AS active_unique_hazard_count,
      COUNT(*)::int AS total_personnel_reports,
      COUNT(*) FILTER (WHERE merged_into_id IS NOT NULL OR status = 'DUPLICATE')::int AS merged_reports_count
    FROM hazard_reports
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const byReporterRes = await db.query(`
    SELECT
      COALESCE(rep.nama, h.reported_by_name, h.assigned_to_name, 'Personil Tambang') AS reporter_name,
      COALESCE(rep.jabatan, h.reported_by_role, 'Karyawan') AS reporter_role,
      COALESCE(rep.departemen, h.reported_by_dept, 'Operasional') AS reporter_dept,
      COUNT(*)::int AS total_reports,
      COUNT(*) FILTER (WHERE h.merged_into_id IS NOT NULL OR h.status = 'DUPLICATE')::int AS merged_reports
    FROM hazard_reports h
    LEFT JOIN users rep ON rep.id = h.reported_by
    WHERE h.tenant_key = $1 AND h.project_key = $2 AND h.deleted_at IS NULL
    GROUP BY 1, 2, 3
    ORDER BY total_reports DESC, reporter_name ASC
  `, [scope.tenantKey, scope.projectKey]);

  const s = summaryRes.rows[0] || {
    unique_hazard_count: 0,
    active_unique_hazard_count: 0,
    total_personnel_reports: 0,
    merged_reports_count: 0,
  };

  return {
    ...s,
    reporters: byReporterRes.rows,
  };
}

async function cleanupHazardPhotos(photoList) {
  if (!Array.isArray(photoList) || photoList.length === 0) return;
  let storageSvc = null;
  try {
    storageSvc = require('./storage');
  } catch (_) {
    storageSvc = null;
  }
  if (!storageSvc || typeof storageSvc.hapusFoto !== 'function') return;

  for (const item of photoList) {
    const raw = String(item || '').trim();
    if (!raw || raw.startsWith('data:image/')) continue;
    try {
      await storageSvc.hapusFoto(raw);
    } catch (_) {}
  }
}

async function updateHazard(db, scope, user, id, input) {
  const current = await getHazardDetail(db, scope, id);
  const liveCapa = (Array.isArray(current.actions) ? current.actions : []).filter(a => a.status !== 'CANCELLED');
  let nextStatus = input.status || current.status;
  // Bila sudah ada CAPA, status progres (IN_ACTION/VERIFY/CLOSED) dihitung otomatis dari CAPA.
  // Admin tetap boleh memvalidasi (NEW/ASSESSED) atau menolak (REJECTED/DUPLICATE); CLOSED tetap diperiksa aturan #4.
  if (liveCapa.length && nextStatus !== current.status
    && !['NEW', 'ASSESSED', 'REJECTED', 'DUPLICATE', 'CLOSED'].includes(nextStatus)) {
    nextStatus = current.status;
  }

  // Aturan bisnis #4: Penutupan hazard hanya bisa dilakukan bila semua CAPA terkait berstatus CLOSED atau CANCELLED
  if (nextStatus === 'CLOSED' && current.status !== 'CLOSED') {
    const unclosedCapaRes = await db.query(`
      SELECT count(*)::int AS unclosed_count
      FROM hse_actions
      WHERE source_type = 'HAZARD' AND source_id = $1
        AND status NOT IN ('CLOSED', 'CANCELLED')
        AND deleted_at IS NULL
    `, [id]);
    if (unclosedCapaRes.rows[0]?.unclosed_count > 0) {
      const error = new Error('Hazard belum dapat ditutup. Masih ada tindakan korektif (CAPA) yang belum berstatus CLOSED.');
      error.statusCode = 422;
      throw error;
    }
  }

  const { likelihood, consequence, riskScore, riskLevel } = calculateRisk(
    input.likelihood ?? current.likelihood,
    input.consequence ?? current.consequence
  );

  let locationName = current.location_name;
  if (input.location_id && input.location_id !== current.location_id) {
    const locRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [input.location_id]);
    if (locRes.rows[0]) locationName = locRes.rows[0].name;
  }

  let categoryName = current.category_name;
  if (input.category_id && input.category_id !== current.category_id) {
    const catRes = await db.query('SELECT label FROM hse_categories WHERE id = $1', [input.category_id]);
    if (catRes.rows[0]) categoryName = catRes.rows[0].label;
  }

  let assignedTo = input.assigned_to !== undefined ? (input.assigned_to || null) : current.assigned_to;
  let assignedToName = current.assigned_to_name;
  if (input.assigned_to !== undefined) {
    if (input.assigned_to) {
      const userRes = await db.query('SELECT nama FROM users WHERE id = $1', [input.assigned_to]);
      assignedToName = userRes.rows[0]?.nama || input.assigned_to_name || current.assigned_to_name;
    } else {
      assignedToName = null;
    }
  }

  let reportedBy = input.reported_by !== undefined ? (input.reported_by || null) : current.reported_by;
  let reportedByName = input.reported_by_name !== undefined ? input.reported_by_name : current.reported_by_name;
  let reportedByDept = input.reported_by_dept !== undefined ? input.reported_by_dept : current.reported_by_dept;
  let reportedByRole = input.reported_by_role !== undefined ? input.reported_by_role : current.reported_by_role;
  if (input.reported_by && input.reported_by !== current.reported_by) {
    const repRes = await db.query('SELECT nama, departemen, jabatan FROM users WHERE id = $1', [input.reported_by]);
    if (repRes.rows[0]) {
      reportedByName = repRes.rows[0].nama;
      reportedByDept = repRes.rows[0].departemen || reportedByDept || null;
      reportedByRole = repRes.rows[0].jabatan || reportedByRole || null;
    }
  }

  const nextDescription = input.description !== undefined && String(input.description).trim()
    ? String(input.description).trim()
    : current.description;
  const nextConsequence = input.potential_consequence !== undefined
    ? (input.potential_consequence ? String(input.potential_consequence).trim() : null)
    : current.potential_consequence;
  const nextRecommendation = input.recommendation !== undefined
    ? (input.recommendation ? String(input.recommendation).trim() || null : null)
    : (current.recommendation ?? null);

  const currentPhotos = Array.isArray(current.photos) ? current.photos : [];
  let nextPhotos = currentPhotos;
  if (Array.isArray(input.photos)) {
    nextPhotos = await compressNewPhotos(currentPhotos, input.photos);
    const nextPhotoSet = new Set(nextPhotos.map(String));
    const removedPhotos = currentPhotos.filter(p => p && !nextPhotoSet.has(String(p)));
    if (removedPhotos.length > 0) {
      await cleanupHazardPhotos(removedPhotos);
    }
  }

  const semanticCode = buildHazardSemanticCode(nextDescription, nextConsequence);

  const updateRes = await db.query(`
    UPDATE hazard_reports SET
      location_id = COALESCE($1, location_id),
      location_name = COALESCE($2, location_name),
      category_id = COALESCE($3, category_id),
      category_name = COALESCE($4, category_name),
      description = $5,
      potential_consequence = $6,
      photos = $7,
      likelihood = $8,
      consequence = $9,
      risk_score = $10,
      risk_level = $11,
      reported_by = $12,
      reported_by_name = $13,
      reported_by_dept = $14,
      reported_by_role = $15,
      assigned_to = $16,
      assigned_to_name = $17,
      status = $18,
      semantic_signature = $19,
      closed_at = CASE WHEN $18 = 'CLOSED' AND status <> 'CLOSED' THEN CURRENT_TIMESTAMP ELSE closed_at END,
      closed_by = CASE WHEN $18 = 'CLOSED' AND status <> 'CLOSED' THEN $20 ELSE closed_by END,
      close_notes = COALESCE($21, close_notes),
      recommendation = $25,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $22 AND tenant_key = $23 AND project_key = $24 AND deleted_at IS NULL
    RETURNING *
  `, [
    input.location_id || null, locationName,
    input.category_id || null, categoryName,
    nextDescription,
    nextConsequence,
    nextPhotos,
    likelihood, consequence, riskScore, riskLevel,
    reportedBy, reportedByName, reportedByDept, reportedByRole,
    assignedTo, assignedToName,
    nextStatus,
    semanticCode.signature,
    user?.id || null, input.close_notes || null,
    id, scope.tenantKey, scope.projectKey,
    nextRecommendation,
  ]);
  const updated = updateRes.rows[0];
  if (!updated) return updated;

  // --- Rekomendasi Perbaikan ↔ CAPA ---
  const openNotStarted = liveCapa.filter(a => ['OPEN', 'OVERDUE'].includes(a.status) && !a.started_at);
  if (['REJECTED', 'DUPLICATE'].includes(nextStatus) && !['REJECTED', 'DUPLICATE'].includes(current.status)) {
    // Laporan ditolak/duplikat → CAPA yang belum selesai dibatalkan.
    await db.query(`
      UPDATE hse_actions SET status = 'CANCELLED', notes = COALESCE(notes, $2), updated_at = CURRENT_TIMESTAMP
      WHERE source_type = 'HAZARD' AND source_id = $1 AND deleted_at IS NULL
        AND status NOT IN ('CLOSED', 'CANCELLED')
    `, [id, `Hazard ${nextStatus === 'DUPLICATE' ? 'duplikat' : 'ditolak'} oleh admin HSE`]);
  } else if (!['REJECTED', 'DUPLICATE', 'CANCELLED', 'CLOSED'].includes(nextStatus)) {
    if (input.recommendation !== undefined && nextRecommendation && nextRecommendation !== current.recommendation) {
      // CAPA yang belum dikerjakan PIC mengikuti rekomendasi terbaru.
      for (const a of openNotStarted) {
        await db.query('UPDATE hse_actions SET description = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [nextRecommendation, a.id]);
      }
    }
    if (input.assigned_to !== undefined && assignedTo && assignedTo !== current.assigned_to) {
      // PIC utama diganti → CAPA milik PIC lama yang belum dikerjakan dialihkan.
      for (const a of openNotStarted.filter(x => current.assigned_to && x.pic_employee_id === current.assigned_to)) {
        await db.query(
          'UPDATE hse_actions SET pic_employee_id = $1, pic_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [assignedTo, assignedToName, a.id]
        );
      }
    }
    if (!liveCapa.length && nextRecommendation && assignedTo) {
      // Belum ada CAPA → Rekomendasi Perbaikan menjadi CAPA untuk PIC.
      const dueAt = dueAtForRisk(riskLevel);
      const created = await createAction(db, scope, user, {
        source_type: 'HAZARD', source_id: id, description: nextRecommendation,
        action_type: 'CORRECTIVE', pic_employee_id: assignedTo, due_date: wibDateOf(dueAt),
      });
      if (created?.id) await db.query('UPDATE hse_actions SET due_at = $1 WHERE id = $2', [dueAt.toISOString(), created.id]);
    }
  }

  const synced = await syncHazardStatusFromActions(db, id, user);
  if (synced && synced !== updated.status) updated.status = synced;
  return updated;
}

async function deleteHazard(db, scope, user, id) {
  const targetRes = await db.query(
    'SELECT id, report_no, photos FROM hazard_reports WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL',
    [id, scope.tenantKey, scope.projectKey]
  );
  if (!targetRes.rows[0]) {
    const error = new Error('Laporan hazard tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }
  const target = targetRes.rows[0];

  // Ambil seluruh laporan child yang tergabung ke hazard ini (jika ada) agar foto & CAPA-nya ikut dibersihkan
  let childRows = [];
  try {
    const childrenRes = await db.query(
      'SELECT id, photos FROM hazard_reports WHERE merged_into_id = $1 AND tenant_key = $2 AND project_key = $3',
      [id, scope.tenantKey, scope.projectKey]
    );
    childRows = Array.isArray(childrenRes?.rows) ? childrenRes.rows : [];
  } catch (_) {
    childRows = [];
  }

  const allPhotos = [
    ...(Array.isArray(target.photos) ? target.photos : []),
    ...childRows.flatMap(c => (Array.isArray(c.photos) ? c.photos : [])),
  ].filter(Boolean);

  if (allPhotos.length > 0) {
    await cleanupHazardPhotos(allPhotos);
  }

  const allHazardIds = [target.id, ...childRows.map(c => c.id)];

  // 1. Hapus permanen seluruh CAPA (hse_actions) yang terkait dengan hazard ini
  await db.query(
    `DELETE FROM hse_actions
     WHERE source_type = 'HAZARD'
       AND (source_id = $1 OR source_id = ANY($4::uuid[]))
       AND tenant_key = $2 AND project_key = $3`,
    [id, scope.tenantKey, scope.projectKey, allHazardIds]
  );

  // 2. Hapus permanen laporan child (merged) serta laporan hazard utama dari database
  await db.query(
    `DELETE FROM hazard_reports
     WHERE (id = $1 OR merged_into_id = $1)
       AND tenant_key = $2 AND project_key = $3`,
    [id, scope.tenantKey, scope.projectKey]
  );

  return {
    deleted: true,
    id: target.id,
    report_no: target.report_no,
    deleted_photos_count: allPhotos.length,
    deleted_children_count: childRows.length,
  };
}

async function listActions(db, scope, filters = {}) {
  const conditions = [
    'a.tenant_key = $1',
    'a.project_key = $2',
    'a.deleted_at IS NULL',
  ];
  const params = [scope.tenantKey, scope.projectKey];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (filters.source_type) {
    params.push(filters.source_type);
    conditions.push(`a.source_type = $${params.length}`);
  }
  if (filters.source_id) {
    params.push(filters.source_id);
    conditions.push(`a.source_id = $${params.length}`);
  }
  if (filters.pic_employee_id) {
    params.push(filters.pic_employee_id);
    conditions.push(`a.pic_employee_id = $${params.length}`);
  }
  if (filters.overdue) {
    conditions.push(`(a.due_date < CURRENT_DATE AND a.status NOT IN ('CLOSED', 'CANCELLED'))`);
  }
  if (filters.search) {
    params.push(`%${filters.search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(a.action_no) LIKE $${params.length} OR
      LOWER(a.description) LIKE $${params.length} OR
      LOWER(COALESCE(u.nama, a.pic_name, '')) LIKE $${params.length}
    )`);
  }

  const query = `
    SELECT
      a.*,
      COALESCE(u.nama, a.pic_name) AS pic_name,
      CASE
        WHEN a.due_date < CURRENT_DATE AND a.status NOT IN ('CLOSED', 'CANCELLED') THEN TRUE
        ELSE FALSE
      END AS is_overdue
    FROM hse_actions a
    LEFT JOIN users u ON u.id = a.pic_employee_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.due_date ASC, a.created_at DESC
  `;

  const { rows } = await db.query(query, params);
  return rows;
}

async function createAction(db, scope, user, input) {
  if (!input.description || !String(input.description).trim()) {
    const error = new Error('Uraian tindakan wajib diisi');
    error.statusCode = 422;
    throw error;
  }
  if (!input.due_date) {
    const error = new Error('Tenggat waktu (due date) wajib diisi');
    error.statusCode = 422;
    throw error;
  }

  const actionNo = await nextSequence(db, scope, 'hse_actions', 'CAPA');

  let picName = input.pic_name || null;
  if (input.pic_employee_id) {
    const picRes = await db.query('SELECT nama FROM users WHERE id = $1', [input.pic_employee_id]);
    if (picRes.rows[0]) picName = picRes.rows[0].nama;
  }

  const insertRes = await db.query(`
    INSERT INTO hse_actions (
      tenant_key, project_key, action_no, source_type, source_id,
      description, action_type, pic_employee_id, pic_name, due_date,
      status, created_by
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, COALESCE($7, 'CORRECTIVE'), $8, $9, $10,
      'OPEN', $11
    ) RETURNING *
  `, [
    scope.tenantKey, scope.projectKey, actionNo,
    input.source_type || 'HAZARD', input.source_id || null,
    String(input.description).trim(), input.action_type || 'CORRECTIVE',
    input.pic_employee_id || null, picName, input.due_date,
    user.id,
  ]);

  const created = insertRes.rows[0];
  if (created && (input.source_type || 'HAZARD') === 'HAZARD' && input.source_id) {
    await syncHazardStatusFromActions(db, input.source_id, user);
  }
  return created;
}

async function updateAction(db, scope, user, id, input) {
  const currentRes = await db.query(`
    SELECT * FROM hse_actions
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);
  if (!currentRes.rows[0]) {
    const error = new Error('Tindakan korektif (CAPA) tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }
  const current = currentRes.rows[0];

  const nextStatus = input.status || current.status;
  const isClosing = nextStatus === 'CLOSED' && current.status !== 'CLOSED';
  const isPendingVerify = nextStatus === 'DONE_PENDING_VERIFY' && current.status !== 'DONE_PENDING_VERIFY';

  const updateRes = await db.query(`
    UPDATE hse_actions SET
      description = COALESCE($1, description),
      action_type = COALESCE($2, action_type),
      pic_employee_id = COALESCE($3, pic_employee_id),
      due_date = COALESCE($4, due_date),
      status = $5,
      completed_at = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE completed_at END,
      verified_by = CASE WHEN $7 THEN $8 ELSE verified_by END,
      verified_at = CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE verified_at END,
      notes = COALESCE($9, notes),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $10 AND tenant_key = $11 AND project_key = $12 AND deleted_at IS NULL
    RETURNING *
  `, [
    input.description ? String(input.description).trim() : null,
    input.action_type || null,
    input.pic_employee_id || null,
    input.due_date || null,
    nextStatus,
    isPendingVerify || isClosing,
    isClosing,
    user.id,
    input.notes || null,
    id, scope.tenantKey, scope.projectKey,
  ]);

  const updated = updateRes.rows[0];
  if (updated && updated.source_type === 'HAZARD' && updated.source_id) {
    // Progres CAPA dari dashboard ikut menggerakkan status hazard (sama seperti update PIC dari APK).
    await syncHazardStatusFromActions(db, updated.source_id, user);
  }
  return updated;
}

// ==========================================
// FASE 2: INSIDEN, INVESTIGASI, MANHOURS & LAPORAN
// ==========================================

async function listIncidents(db, scope, filters = {}) {
  const conditions = [
    'i.tenant_key = $1',
    'i.project_key = $2',
    'i.deleted_at IS NULL',
  ];
  const params = [scope.tenantKey, scope.projectKey];

  if (filters.incident_type) {
    params.push(filters.incident_type);
    conditions.push(`i.incident_type = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`i.status = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    conditions.push(`i.actual_severity = $${params.length}`);
  }
  if (filters.location_id) {
    params.push(filters.location_id);
    conditions.push(`i.location_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(i.incident_no) LIKE $${params.length} OR
      LOWER(i.description) LIKE $${params.length} OR
      LOWER(COALESCE(i.location_name, '')) LIKE $${params.length} OR
      LOWER(COALESCE(i.department_name, '')) LIKE $${params.length}
    )`);
  }

  const query = `
    SELECT
      i.*,
      COALESCE(l.name, i.location_name) AS location_name,
      COALESCE(u.nama, i.reported_by_name) AS reported_by_name,
      (SELECT COUNT(*)::int FROM incident_persons p WHERE p.incident_id = i.id) AS persons_count,
      (SELECT COALESCE(SUM(p.lost_days), 0)::int FROM incident_persons p WHERE p.incident_id = i.id) AS total_lost_days,
      (SELECT COUNT(*)::int FROM incident_assets a WHERE a.incident_id = i.id) AS assets_count,
      (SELECT v.status FROM incident_investigations v WHERE v.incident_id = i.id LIMIT 1) AS investigation_status,
      (SELECT v.method FROM incident_investigations v WHERE v.incident_id = i.id LIMIT 1) AS investigation_method
    FROM incidents i
    LEFT JOIN hse_locations l ON l.id = i.location_id
    LEFT JOIN users u ON u.id = i.reported_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.occurred_at DESC
  `;

  const { rows } = await db.query(query, params);
  return rows;
}

async function getIncidentDetail(db, scope, id) {
  const incRes = await db.query(`
    SELECT
      i.*,
      COALESCE(l.name, i.location_name) AS location_name,
      COALESCE(u.nama, i.reported_by_name) AS reported_by_name
    FROM incidents i
    LEFT JOIN hse_locations l ON l.id = i.location_id
    LEFT JOIN users u ON u.id = i.reported_by
    WHERE i.id = $1 AND i.tenant_key = $2 AND i.project_key = $3 AND i.deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!incRes.rows[0]) {
    const error = new Error('Insiden tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }
  const incident = incRes.rows[0];

  const [personsRes, assetsRes, invRes, actionsRes] = await Promise.all([
    db.query(`SELECT * FROM incident_persons WHERE incident_id = $1 ORDER BY created_at ASC`, [id]),
    db.query(`SELECT * FROM incident_assets WHERE incident_id = $1 ORDER BY created_at ASC`, [id]),
    db.query(`SELECT * FROM incident_investigations WHERE incident_id = $1 LIMIT 1`, [id]),
    db.query(`SELECT a.*, COALESCE(u.nama, a.pic_name) AS pic_name FROM hse_actions a LEFT JOIN users u ON u.id = a.pic_employee_id WHERE a.source_type = 'INCIDENT' AND a.source_id = $1 AND a.tenant_key = $2 AND a.deleted_at IS NULL`, [id, scope.tenantKey]),
  ]);

  return {
    ...incident,
    persons: personsRes.rows,
    assets: assetsRes.rows,
    investigation: invRes.rows[0] || null,
    actions: actionsRes.rows,
  };
}

async function createIncident(db, scope, user, input) {
  if (!input.description || !String(input.description).trim()) {
    const error = new Error('Uraian insiden wajib diisi');
    error.statusCode = 422;
    throw error;
  }
  if (!input.incident_type) {
    const error = new Error('Jenis insiden wajib dipilih');
    error.statusCode = 422;
    throw error;
  }
  if (!input.occurred_at) {
    const error = new Error('Waktu kejadian (occurred_at) wajib diisi');
    error.statusCode = 422;
    throw error;
  }

  const incidentNo = await nextSequence(db, scope, 'incidents', 'INC');

  let locationName = input.location_name || null;
  if (input.location_id) {
    const locRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [input.location_id]);
    if (locRes.rows[0]) locationName = locRes.rows[0].name;
  }

  const insertRes = await db.query(`
    INSERT INTO incidents (
      tenant_key, project_key, incident_no, incident_type, occurred_at,
      location_id, location_name, department_name, company_name, description,
      weather, lighting, actual_severity, potential_severity, estimated_loss,
      reported_by, reported_by_name, status, external_report_required,
      photos, attachments, created_by
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, COALESCE($13, 'MINOR'), COALESCE($14, 'MODERATE'), COALESCE($15, 0),
      $16, $17, 'REPORTED', COALESCE($18, FALSE),
      $19, $20, $16
    ) RETURNING *
  `, [
    scope.tenantKey, scope.projectKey, incidentNo, input.incident_type, input.occurred_at,
    input.location_id || null, locationName, input.department_name || null, input.company_name || null, String(input.description).trim(),
    input.weather || null, input.lighting || null, input.actual_severity || 'MINOR', input.potential_severity || 'MODERATE', Number(input.estimated_loss) || 0,
    user.id, user.nama || user.email, Boolean(input.external_report_required),
    await compressHsePhotos(Array.isArray(input.photos) ? input.photos : []),
    Array.isArray(input.attachments) ? input.attachments : [],
  ]);

  const createdIncident = insertRes.rows[0];

  // Aturan bisnis #5: Hari tanpa LTI diupdate otomatis bila kejadian Fatality atau LTI
  if (['FATALITY', 'LTI'].includes(input.incident_type)) {
    const incidentDate = new Date(input.occurred_at).toISOString().slice(0, 10);
    await db.query(`
      INSERT INTO hse_site_metrics (tenant_key, project_key, last_lti_date)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_key, project_key) DO UPDATE SET
        last_lti_date = EXCLUDED.last_lti_date,
        updated_at = CURRENT_TIMESTAMP
    `, [scope.tenantKey, scope.projectKey, incidentDate]);
  }

  // Insert persons if any
  if (Array.isArray(input.persons) && input.persons.length > 0) {
    for (const p of input.persons) {
      if (p.person_name) {
        await db.query(`
          INSERT INTO incident_persons (
            tenant_key, project_key, incident_id, employee_id, person_name, company_name,
            role_in_incident, injury_type, body_part, treatment, lost_days, returned_to_work_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          scope.tenantKey, scope.projectKey, createdIncident.id, p.employee_id || null, p.person_name, p.company_name || null,
          p.role_in_incident || 'INJURED', p.injury_type || null, p.body_part || null, p.treatment || 'NONE',
          parseInt(p.lost_days, 10) || 0, p.returned_to_work_at || null,
        ]);
      }
    }
  }

  // Insert assets if any
  if (Array.isArray(input.assets) && input.assets.length > 0) {
    for (const a of input.assets) {
      if (a.asset_code) {
        await db.query(`
          INSERT INTO incident_assets (
            tenant_key, project_key, incident_id, asset_code, asset_name, damage_description, repair_cost
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          scope.tenantKey, scope.projectKey, createdIncident.id, a.asset_code, a.asset_name || null,
          a.damage_description || null, Number(a.repair_cost) || 0,
        ]);
      }
    }
  }

  return createdIncident;
}

async function updateIncident(db, scope, user, id, input) {
  const current = await getIncidentDetail(db, scope, id);

  let locationName = current.location_name;
  if (input.location_id && input.location_id !== current.location_id) {
    const locRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [input.location_id]);
    if (locRes.rows[0]) locationName = locRes.rows[0].name;
  }

  const updateRes = await db.query(`
    UPDATE incidents SET
      location_id = COALESCE($1, location_id),
      location_name = COALESCE($2, location_name),
      department_name = COALESCE($3, department_name),
      company_name = COALESCE($4, company_name),
      description = COALESCE($5, description),
      actual_severity = COALESCE($6, actual_severity),
      potential_severity = COALESCE($7, potential_severity),
      status = COALESCE($8, status),
      external_report_required = COALESCE($9, external_report_required),
      external_report_status = COALESCE($10, external_report_status),
      estimated_loss = COALESCE($11, estimated_loss),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $12 AND tenant_key = $13 AND project_key = $14 AND deleted_at IS NULL
    RETURNING *
  `, [
    input.location_id || null, locationName,
    input.department_name || null, input.company_name || null,
    input.description ? String(input.description).trim() : null,
    input.actual_severity || null, input.potential_severity || null,
    input.status || null,
    input.external_report_required !== undefined ? Boolean(input.external_report_required) : null,
    input.external_report_status || null,
    input.estimated_loss !== undefined ? Number(input.estimated_loss) : null,
    id, scope.tenantKey, scope.projectKey,
  ]);

  return updateRes.rows[0];
}

async function saveInvestigation(db, scope, user, incidentId, input) {
  const incRes = await db.query('SELECT id FROM incidents WHERE id = $1 AND tenant_key = $2 AND project_key = $3', [incidentId, scope.tenantKey, scope.projectKey]);
  if (!incRes.rows[0]) {
    const error = new Error('Insiden tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }

  const existingRes = await db.query('SELECT id FROM incident_investigations WHERE incident_id = $1 AND tenant_key = $2', [incidentId, scope.tenantKey]);
  let result;

  if (existingRes.rows[0]) {
    result = await db.query(`
      UPDATE incident_investigations SET
        method = COALESCE($1, method),
        lead_id = COALESCE($2, lead_id),
        lead_name = COALESCE($3, lead_name),
        team_members = COALESCE($4, team_members),
        immediate_cause = COALESCE($5, immediate_cause),
        root_causes = COALESCE($6, root_causes),
        findings = COALESCE($7, findings),
        lessons_learned = COALESCE($8, lessons_learned),
        status = COALESCE($9, status),
        started_at = COALESCE($10, started_at),
        completed_at = CASE WHEN $9 = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
      WHERE incident_id = $11 AND tenant_key = $12 AND project_key = $13
      RETURNING *
    `, [
      input.method || null, input.lead_id || null, input.lead_name || null, input.team_members || null,
      input.immediate_cause || null, input.root_causes ? JSON.stringify(input.root_causes) : null,
      input.findings || null, input.lessons_learned || null, input.status || null,
      input.started_at || null, incidentId, scope.tenantKey, scope.projectKey,
    ]);
  } else {
    result = await db.query(`
      INSERT INTO incident_investigations (
        tenant_key, project_key, incident_id, method, lead_id, lead_name,
        team_members, immediate_cause, root_causes, findings, lessons_learned,
        started_at, status
      ) VALUES (
        $1, $2, $3, COALESCE($4, 'FIVE_WHY'), $5, $6,
        $7, $8, COALESCE($9, '[]'::jsonb), $10, $11,
        COALESCE($12, CURRENT_TIMESTAMP), COALESCE($13, 'OPEN')
      ) RETURNING *
    `, [
      scope.tenantKey, scope.projectKey, incidentId, input.method || 'FIVE_WHY', input.lead_id || null, input.lead_name || null,
      input.team_members || null, input.immediate_cause || null, input.root_causes ? JSON.stringify(input.root_causes) : null,
      input.findings || null, input.lessons_learned || null, input.started_at || null, input.status || 'OPEN',
    ]);
  }

  await db.query(`
    UPDATE incidents SET
      status = CASE WHEN status = 'REPORTED' THEN 'INVESTIGATING' ELSE status END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [incidentId]);

  return result.rows[0];
}

async function listManhours(db, scope, filters = {}) {
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];
  const params = [scope.tenantKey, scope.projectKey];

  if (filters.year) {
    params.push(Number(filters.year));
    conditions.push(`EXTRACT(YEAR FROM period_month) = $${params.length}`);
  }

  const query = `
    SELECT * FROM hse_manhours
    WHERE ${conditions.join(' AND ')}
    ORDER BY period_month DESC
  `;
  const { rows } = await db.query(query, params);
  return rows;
}

async function saveManhours(db, scope, user, input) {
  if (!input.period_month) {
    const error = new Error('Periode bulan wajib diisi (YYYY-MM-01)');
    error.statusCode = 422;
    throw error;
  }
  const hours = Number(input.hours);
  if (Number.isNaN(hours) || hours < 0) {
    const error = new Error('Total jam kerja (hours) tidak valid');
    error.statusCode = 422;
    throw error;
  }
  const companyName = String(input.company_name || '').trim();
  // Jam kerja karyawan internal dihitung otomatis dari Setup Master → Jam kerja karyawan
  // (presensi Rekap Performa × standar jam per hari). Input manual hanya untuk kontraktor.
  const contractor = Workhours.isInternalCompany(companyName)
    ? null
    : await Workhours.findContractorByName(db, scope, companyName);
  if (!contractor) {
    const error = new Error('Jam kerja karyawan internal dihitung otomatis dari Setup Master → Jam kerja karyawan. Input manual hanya untuk kontraktor yang terdaftar di HSE → Kontraktor.');
    error.statusCode = 422;
    throw error;
  }
  const periodMonth = `${String(input.period_month).slice(0, 7)}-01`;

  const result = await db.query(`
    INSERT INTO hse_manhours (
      tenant_key, project_key, period_month, company_name, department_name, hours, source, created_by
    ) VALUES (
      $1, $2, $3, $4, COALESCE($5, 'Semua departemen'), $6, 'MANUAL', $7
    ) ON CONFLICT (tenant_key, project_key, period_month, company_name, department_name) DO UPDATE SET
      hours = EXCLUDED.hours,
      source = 'MANUAL',
      deleted_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE hse_manhours.source <> 'ATTENDANCE'
    RETURNING *
  `, [
    scope.tenantKey, scope.projectKey, periodMonth, contractor.company_name,
    String(input.department_name || '').trim() || 'Semua departemen', hours, user.id,
  ]);

  if (!result.rows[0]) {
    const error = new Error('Baris jam kerja ini berasal dari rekap presensi yang terkunci dan tidak bisa ditimpa manual.');
    error.statusCode = 409;
    throw error;
  }
  return result.rows[0];
}

const HSE_RATE_FACTOR = 1000000;

function buildMonthStat(monthKey, man, inc = {}, lostDays = 0) {
  const fatality = Number(inc.fatality_count) || 0;
  const lti = Number(inc.lti_count) || 0;
  const mti = Number(inc.mti_count) || 0;
  const hours = man ? man.hours : 0;
  return {
    monthKey,
    monthLabel: Workhours.monthLabel(monthKey),
    hours,
    internalHours: man ? man.internalHours : 0,
    contractorHours: man ? man.contractorHours : 0,
    hoursStatus: man ? man.status : 'KOSONG',
    uncountedDays: man ? man.uncountedDays : 0,
    fatality,
    lti,
    mti,
    fai: Number(inc.fai_count) || 0,
    nm: Number(inc.nm_count) || 0,
    pd: Number(inc.pd_count) || 0,
    lostDays: Number(lostDays) || 0,
    ltifr: Workhours.frequencyRate(lti, hours, HSE_RATE_FACTOR),
    trir: Workhours.frequencyRate(fatality + lti + mti, hours, HSE_RATE_FACTOR),
    sr: Workhours.frequencyRate(lostDays, hours, HSE_RATE_FACTOR),
  };
}

function summarizeStats(stats) {
  const t = stats.reduce((acc, m) => {
    acc.hours += m.hours;
    acc.fatality += m.fatality;
    acc.lti += m.lti;
    acc.mti += m.mti;
    acc.lostDays += m.lostDays;
    if (m.hoursStatus !== 'FINAL' && m.hours > 0) acc.provisional = true;
    if (m.uncountedDays > 0) acc.uncountedDays += m.uncountedDays;
    return acc;
  }, { hours: 0, fatality: 0, lti: 0, mti: 0, lostDays: 0, provisional: false, uncountedDays: 0 });
  t.hours = Math.round(t.hours * 100) / 100;
  t.recordable = t.fatality + t.lti + t.mti;
  t.ltifr = Workhours.frequencyRate(t.lti, t.hours, HSE_RATE_FACTOR);
  t.trir = Workhours.frequencyRate(t.recordable, t.hours, HSE_RATE_FACTOR);
  t.sr = Workhours.frequencyRate(t.lostDays, t.hours, HSE_RATE_FACTOR);
  return t;
}

/**
 * Statistik keselamatan 12 bulan. Jam kerja (pembagi LTIFR/TRIR/SR) berasal dari
 * Setup Master → Jam kerja karyawan (internal) + input manual kontraktor.
 * Bulan tanpa jam kerja → rasio null (tidak dihitung), bukan angka rekaan.
 */
async function getSafetyReports(db, scope, filters = {}) {
  const today = Workhours.todayWib();
  const monthKeys = Workhours.lastMonthKeys(today, 12);
  const fromDate = `${monthKeys[monthKeys.length - 1]}-01`;

  const [manhours, incidentMonthlyRes, lostDaysRes] = await Promise.all([
    Workhours.getMonthlyManhours(db, scope, monthKeys),
    db.query(`
      SELECT
        TO_CHAR(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month_key,
        COUNT(*) FILTER (WHERE incident_type = 'FATALITY')::int AS fatality_count,
        COUNT(*) FILTER (WHERE incident_type = 'LTI')::int AS lti_count,
        COUNT(*) FILTER (WHERE incident_type = 'MTI')::int AS mti_count,
        COUNT(*) FILTER (WHERE incident_type = 'FAI')::int AS fai_count,
        COUNT(*) FILTER (WHERE incident_type = 'NEAR_MISS')::int AS nm_count,
        COUNT(*) FILTER (WHERE incident_type = 'PROPERTY_DAMAGE')::int AS pd_count
      FROM incidents
      WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
        AND occurred_at >= $3::date
      GROUP BY month_key
    `, [scope.tenantKey, scope.projectKey, fromDate]),
    db.query(`
      SELECT
        TO_CHAR(i.occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month_key,
        COALESCE(SUM(p.lost_days), 0)::int AS total_lost_days
      FROM incident_persons p
      JOIN incidents i ON i.id = p.incident_id
      WHERE i.tenant_key = $1 AND i.project_key = $2 AND i.deleted_at IS NULL
        AND i.occurred_at >= $3::date
      GROUP BY month_key
    `, [scope.tenantKey, scope.projectKey, fromDate]),
  ]);

  const incMap = new Map(incidentMonthlyRes.rows.map(r => [r.month_key, r]));
  const lostMap = new Map(lostDaysRes.rows.map(r => [r.month_key, r.total_lost_days]));
  const monthlyStatistics = monthKeys.map(k => buildMonthStat(k, manhours.get(k), incMap.get(k), lostMap.get(k)));

  const year = today.slice(0, 4);
  const ytd = summarizeStats(monthlyStatistics.filter(m => m.monthKey.startsWith(year)));
  const rolling12 = summarizeStats(monthlyStatistics);

  const categoryBreakdownRes = await db.query(`
    SELECT incident_type, COUNT(*)::int AS count
    FROM incidents
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
    GROUP BY incident_type
  `, [scope.tenantKey, scope.projectKey]);

  const locationBreakdownRes = await db.query(`
    SELECT COALESCE(l.name, i.location_name, 'Lainnya') AS location_name, COUNT(*)::int AS count
    FROM incidents i
    LEFT JOIN hse_locations l ON l.id = i.location_id
    WHERE i.tenant_key = $1 AND i.project_key = $2 AND i.deleted_at IS NULL
    GROUP BY COALESCE(l.name, i.location_name, 'Lainnya')
    ORDER BY count DESC
  `, [scope.tenantKey, scope.projectKey]);

  return {
    monthlyStatistics,
    summary: { year: Number(year), ytd, rolling12 },
    rateFactor: HSE_RATE_FACTOR,
    hoursSource: 'Setup Master → Jam kerja karyawan (internal) + input manual kontraktor',
    categoryBreakdown: categoryBreakdownRes.rows,
    locationBreakdown: locationBreakdownRes.rows,
  };
}

// -------------------------------------------------------------
// FASE 3: KOMPETENSI (LISENSI/SIMPER, MATRIKS, INDUKSI, P5M)
// -------------------------------------------------------------

async function getCompetencyOverview(db, scope) {
  // 1. Licenses stats
  const licStatsRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_licenses,
      COUNT(*) FILTER (WHERE (status = 'VALID' OR status IS NULL) AND expiry_date > CURRENT_DATE + INTERVAL '30 days')::int AS valid_licenses,
      COUNT(*) FILTER (WHERE status = 'EXPIRING' OR (expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'))::int AS expiring_licenses,
      COUNT(*) FILTER (WHERE status = 'EXPIRED' OR expiry_date < CURRENT_DATE)::int AS expired_licenses,
      COUNT(DISTINCT employee_id) FILTER (
        WHERE (license_type IN ('SIMPER', 'SIO') OR class_or_unit IS NOT NULL)
          AND (status IN ('EXPIRED', 'SUSPENDED') OR expiry_date < CURRENT_DATE)
      )::int AS unfit_operators_count
    FROM hse_employee_licenses
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const licStats = licStatsRes.rows[0] || {
    total_licenses: 0,
    valid_licenses: 0,
    expiring_licenses: 0,
    expired_licenses: 0,
    unfit_operators_count: 0,
  };

  // 2. Training Compliance Matrix Stats
  const matrixStatsRes = await db.query(`
    WITH active_emp AS (
      SELECT id, jabatan
      FROM users
      WHERE role != 'admin' AND jabatan IS NOT NULL
    ),
    required_slots AS (
      SELECT e.id AS employee_id, r.course_id
      FROM active_emp e
      JOIN hse_training_requirements r 
        ON r.position_name = e.jabatan 
       AND r.tenant_key = $1 
       AND r.project_key = $2 
       AND r.is_mandatory = TRUE
    ),
    fulfilled_slots AS (
      SELECT rs.employee_id, rs.course_id
      FROM required_slots rs
      JOIN hse_training_records rec 
        ON rec.employee_id = rs.employee_id 
       AND rec.course_id = rs.course_id 
       AND rec.tenant_key = $1 
       AND rec.project_key = $2 
       AND rec.result = 'PASSED' 
       AND (rec.valid_until IS NULL OR rec.valid_until >= CURRENT_DATE)
       AND rec.deleted_at IS NULL
    )
    SELECT
      (SELECT COUNT(*)::int FROM required_slots) AS total_required_slots,
      (SELECT COUNT(DISTINCT (employee_id, course_id))::int FROM fulfilled_slots) AS total_fulfilled_slots
  `, [scope.tenantKey, scope.projectKey]);

  const mStats = matrixStatsRes.rows[0] || { total_required_slots: 0, total_fulfilled_slots: 0 };
  const totalReq = mStats.total_required_slots;
  const totalFul = mStats.total_fulfilled_slots;
  const trainingCompliancePct = totalReq > 0 ? Number(((totalFul / totalReq) * 100).toFixed(1)) : 100.0;

  // 3. Inductions stats
  const indStatsRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_inductions,
      COUNT(*) FILTER (WHERE person_type = 'EMPLOYEE')::int AS employee_inductions,
      COUNT(*) FILTER (WHERE person_type = 'CONTRACTOR')::int AS contractor_inductions,
      COUNT(*) FILTER (WHERE person_type = 'VISITOR')::int AS visitor_inductions,
      COUNT(*) FILTER (WHERE result = 'PASSED')::int AS passed_inductions,
      COUNT(*) FILTER (WHERE result = 'FAILED')::int AS failed_inductions
    FROM hse_inductions
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  // 4. Safety talks stats (event P5M + Safety Talk baru, tab Hazard dan Inspeksi)
  const talkStatsRes = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM hse_p5m_events e
        WHERE e.tenant_key = $1 AND e.project_key = $2 AND e.merged_into_id IS NULL)
      + (SELECT COUNT(*)::int FROM hse_safetytalk_events e
        WHERE e.tenant_key = $1 AND e.project_key = $2 AND e.merged_into_id IS NULL)
        AS total_safety_talks,
      (SELECT COUNT(*)::int FROM hse_p5m_event_attendees a
        JOIN hse_p5m_events e ON e.id = a.event_id
        WHERE e.tenant_key = $1 AND e.project_key = $2 AND e.merged_into_id IS NULL)
      + (SELECT COUNT(*)::int FROM hse_safetytalk_event_attendees a
        JOIN hse_safetytalk_events e ON e.id = a.event_id
        WHERE e.tenant_key = $1 AND e.project_key = $2 AND e.merged_into_id IS NULL)
        AS total_attendees
  `, [scope.tenantKey, scope.projectKey]);

  return {
    licenses: {
      total: licStats.total_licenses,
      valid: licStats.valid_licenses,
      expiring: licStats.expiring_licenses,
      expired: licStats.expired_licenses,
      unfitOperators: licStats.unfit_operators_count,
    },
    training: {
      totalRequiredSlots: totalReq,
      fulfilledSlots: totalFul,
      compliancePct: trainingCompliancePct,
    },
    inductions: indStatsRes.rows[0] || {
      total_inductions: 0,
      employee_inductions: 0,
      contractor_inductions: 0,
      visitor_inductions: 0,
      passed_inductions: 0,
      failed_inductions: 0,
    },
    safetyTalks: talkStatsRes.rows[0] || {
      total_safety_talks: 0,
      total_attendees: 0,
    },
  };
}

async function listEmployeeLicenses(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE l.tenant_key = $1 AND l.project_key = $2 AND l.deleted_at IS NULL`;

  if (query.employee_id) {
    params.push(query.employee_id);
    where += ` AND l.employee_id = $${params.length}`;
  }

  if (query.license_type) {
    params.push(query.license_type);
    where += ` AND l.license_type = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (l.license_no ILIKE ${s} OR u.nama ILIKE ${s} OR l.class_or_unit ILIKE ${s} OR l.notes ILIKE ${s})`;
  }

  const baseSql = `
    SELECT
      l.id, l.tenant_key, l.project_key, l.employee_id,
      u.nama AS employee_name,
      u.employee_id AS employee_nrp,
      u.jabatan AS employee_position,
      l.license_type, l.license_no,
      l.class_or_unit,
      l.class_or_unit AS unit_type,
      l.issued_by,
      l.issued_date,
      l.issued_date AS issue_date,
      l.expiry_date,
      CASE
        WHEN l.status = 'SUSPENDED' THEN 'SUSPENDED'
        WHEN l.expiry_date < CURRENT_DATE THEN 'EXPIRED'
        WHEN l.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'EXPIRING'
        ELSE 'VALID'
      END AS computed_status,
      l.status AS stored_status,
      l.file_url,
      l.file_url AS scan_url,
      l.notes, l.created_at, l.updated_at,
      CASE
        WHEN (l.license_type IN ('SIMPER', 'SIO') OR l.class_or_unit IS NOT NULL)
          AND (l.status = 'SUSPENDED' OR l.expiry_date < CURRENT_DATE) THEN FALSE
        ELSE TRUE
      END AS fit_to_operate
    FROM hse_employee_licenses l
    LEFT JOIN users u ON u.id = l.employee_id
    ${where}
  `;

  let finalSql = baseSql;
  if (query.status) {
    const st = query.status.toUpperCase();
    if (st === 'UNFIT') {
      finalSql = `SELECT * FROM (${baseSql}) sub WHERE fit_to_operate = FALSE ORDER BY expiry_date ASC`;
    } else {
      params.push(st);
      finalSql = `SELECT * FROM (${baseSql}) sub WHERE computed_status = $${params.length} ORDER BY expiry_date ASC`;
    }
  } else {
    finalSql = `${baseSql} ORDER BY l.expiry_date ASC, l.created_at DESC`;
  }

  const { rows } = await db.query(finalSql, params);
  return rows;
}

async function createEmployeeLicense(db, scope, user, payload = {}) {
  const employee_id = payload.employee_id;
  const license_type = payload.license_type;
  const license_no = payload.license_no;
  const class_or_unit = payload.class_or_unit || payload.unit_type || null;
  const issued_by = payload.issued_by || null;
  const issued_date = payload.issued_date || payload.issue_date || null;
  const expiry_date = payload.expiry_date;
  const notes = payload.notes || null;
  const file_url = payload.file_url || payload.scan_url || null;

  if (!employee_id || !license_type || !license_no || !expiry_date) {
    const err = new Error('Field employee_id, license_type, license_no, dan expiry_date wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  const exp = new Date(expiry_date);
  const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  let status = 'VALID';
  if (diffDays < 0) {
    status = 'EXPIRED';
  } else if (diffDays <= 30) {
    status = 'EXPIRING';
  }

  const insertSql = `
    INSERT INTO hse_employee_licenses (
      tenant_key, project_key, employee_id, license_type, license_no,
      class_or_unit, issued_by, issued_date, expiry_date, status, file_url, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const { rows } = await db.query(insertSql, [
    scope.tenantKey, scope.projectKey, employee_id, license_type.toUpperCase(),
    license_no, class_or_unit, issued_by, issued_date,
    expiry_date, status, file_url, notes,
  ]);

  const [created] = await listEmployeeLicenses(db, scope, { search: license_no });
  return created || rows[0];
}

async function updateEmployeeLicense(db, scope, user, id, payload = {}) {
  const check = await db.query(`
    SELECT id FROM hse_employee_licenses WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!check.rows[0]) {
    const err = new Error('Lisensi karyawan tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const license_type = payload.license_type ? payload.license_type.toUpperCase() : null;
  const license_no = payload.license_no || null;
  const class_or_unit = payload.class_or_unit !== undefined ? payload.class_or_unit : (payload.unit_type !== undefined ? payload.unit_type : null);
  const issued_by = payload.issued_by !== undefined ? payload.issued_by : null;
  const issued_date = payload.issued_date || payload.issue_date || null;
  const expiry_date = payload.expiry_date || null;
  const status = payload.status || null;
  const notes = payload.notes !== undefined ? payload.notes : null;
  const file_url = payload.file_url !== undefined ? payload.file_url : (payload.scan_url !== undefined ? payload.scan_url : null);

  const updateSql = `
    UPDATE hse_employee_licenses
    SET
      license_type = COALESCE($1, license_type),
      license_no = COALESCE($2, license_no),
      class_or_unit = COALESCE($3, class_or_unit),
      issued_by = COALESCE($4, issued_by),
      issued_date = COALESCE($5, issued_date),
      expiry_date = COALESCE($6, expiry_date),
      status = COALESCE($7, status),
      notes = COALESCE($8, notes),
      file_url = COALESCE($9, file_url),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $10 AND tenant_key = $11 AND project_key = $12
    RETURNING *
  `;

  await db.query(updateSql, [
    license_type,
    license_no,
    class_or_unit,
    issued_by,
    issued_date,
    expiry_date,
    status,
    notes,
    file_url,
    id, scope.tenantKey, scope.projectKey,
  ]);

  const [updated] = await listEmployeeLicenses(db, scope, { search: license_no || check.rows[0].id });
  return updated;
}

async function listCompetencyCourses(db, scope) {
  const { rows } = await db.query(`
    SELECT id, code, name, name AS title, category, validity_months, provider, is_active
    FROM hse_training_courses
    WHERE tenant_key = $1 AND project_key = $2 AND is_active = TRUE AND deleted_at IS NULL
    ORDER BY code ASC
  `, [scope.tenantKey, scope.projectKey]);
  return rows;
}

async function getTrainingMatrix(db, scope) {
  const courses = await listCompetencyCourses(db, scope);

  const reqRes = await db.query(`
    SELECT position_name, course_id, is_mandatory
    FROM hse_training_requirements
    WHERE tenant_key = $1 AND project_key = $2
  `, [scope.tenantKey, scope.projectKey]);

  const reqMap = {};
  for (const r of reqRes.rows) {
    reqMap[`${r.position_name}__${r.course_id}`] = r.is_mandatory;
  }

  const empRes = await db.query(`
    SELECT id, nama, jabatan, employee_id as nrp
    FROM users
    WHERE role != 'admin' AND jabatan IS NOT NULL
    ORDER BY jabatan ASC, nama ASC
  `);
  const employees = empRes.rows;

  const recRes = await db.query(`
    SELECT employee_id, course_id, result, (result = 'PASSED') AS passed, certificate_no, completed_date, valid_until
    FROM hse_training_records
    WHERE tenant_key = $1 AND project_key = $2 AND result = 'PASSED'
      AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
      AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const recordMap = {};
  for (const rec of recRes.rows) {
    recordMap[`${rec.employee_id}__${rec.course_id}`] = rec;
  }

  const positionStats = {};
  const employeeMatrix = employees.map(emp => {
    let reqCount = 0;
    let fulfilledCount = 0;
    const courseStatus = {};

    for (const c of courses) {
      const isReq = reqMap[`${emp.jabatan}__${c.id}`];
      const rec = recordMap[`${emp.id}__${c.id}`];
      const isMandatory = isReq === true;

      if (isMandatory) reqCount += 1;
      if (rec && rec.passed) {
        if (isMandatory) fulfilledCount += 1;
        courseStatus[c.id] = {
          status: 'COMPLETED',
          date: rec.completed_date,
          validUntil: rec.valid_until,
          cert: rec.certificate_no,
          mandatory: isMandatory,
        };
      } else if (isMandatory) {
        courseStatus[c.id] = { status: 'REQUIRED_MISSING', mandatory: true };
      } else {
        courseStatus[c.id] = { status: 'OPTIONAL', mandatory: false };
      }
    }

    const pct = reqCount > 0 ? Number(((fulfilledCount / reqCount) * 100).toFixed(1)) : 100.0;

    if (!positionStats[emp.jabatan]) {
      positionStats[emp.jabatan] = { totalReq: 0, totalFulfilled: 0, employeeCount: 0 };
    }
    positionStats[emp.jabatan].totalReq += reqCount;
    positionStats[emp.jabatan].totalFulfilled += fulfilledCount;
    positionStats[emp.jabatan].employeeCount += 1;

    return {
      ...emp,
      requiredCount: reqCount,
      fulfilledCount,
      compliancePct: pct,
      courses: courseStatus,
    };
  });

  const positionCompliance = Object.entries(positionStats).map(([pos, s]) => {
    const pct = s.totalReq > 0 ? Number(((s.totalFulfilled / s.totalReq) * 100).toFixed(1)) : 100.0;
    return {
      position: pos,
      employeeCount: s.employeeCount,
      compliancePct: pct,
    };
  });

  return {
    courses,
    positions: Object.keys(positionStats),
    positionCompliance,
    employees: employeeMatrix,
  };
}

async function listTrainingRecords(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE r.tenant_key = $1 AND r.project_key = $2 AND r.deleted_at IS NULL`;

  if (query.employee_id) {
    params.push(query.employee_id);
    where += ` AND r.employee_id = $${params.length}`;
  }

  if (query.course_id) {
    params.push(query.course_id);
    where += ` AND r.course_id = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (u.nama ILIKE ${s} OR c.name ILIKE ${s} OR r.certificate_no ILIKE ${s} OR r.notes ILIKE ${s})`;
  }

  const sql = `
    SELECT
      r.id, r.tenant_key, r.project_key, r.employee_id,
      u.nama AS employee_name,
      u.jabatan AS employee_position,
      r.course_id, c.code AS course_code, c.name AS course_title,
      r.completed_date,
      r.completed_date AS completion_date,
      r.valid_until,
      r.valid_until AS expiry_date,
      r.score, r.result,
      (r.result = 'PASSED') AS passed,
      r.certificate_no, r.certificate_url, r.notes, r.created_at
    FROM hse_training_records r
    JOIN hse_training_courses c ON c.id = r.course_id
    JOIN users u ON u.id = r.employee_id
    ${where}
    ORDER BY r.completed_date DESC, r.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createTrainingRecord(db, scope, user, payload = {}) {
  const employee_id = payload.employee_id;
  const course_id = payload.course_id;
  const completed_date = payload.completed_date || payload.completion_date;
  const valid_until = payload.valid_until || payload.expiry_date || null;
  const score = payload.score !== undefined ? payload.score : null;
  const result = payload.result || (payload.passed !== false ? 'PASSED' : 'FAILED');
  const certificate_no = payload.certificate_no || null;
  const certificate_url = payload.certificate_url || null;
  const notes = payload.notes || null;

  if (!employee_id || !course_id || !completed_date) {
    const err = new Error('Field employee_id, course_id, dan completed_date wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const sql = `
    INSERT INTO hse_training_records (
      tenant_key, project_key, employee_id, course_id,
      completed_date, valid_until, score, result,
      certificate_no, certificate_url, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, employee_id, course_id,
    completed_date, valid_until, score, result,
    certificate_no, certificate_url, notes,
  ]);

  return rows[0];
}

async function listInductions(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE i.tenant_key = $1 AND i.project_key = $2 AND i.deleted_at IS NULL`;

  if (query.person_type) {
    params.push(query.person_type.toUpperCase());
    where += ` AND i.person_type = $${params.length}`;
  }

  if (query.result) {
    params.push(query.result.toUpperCase());
    where += ` AND i.result = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (i.person_name ILIKE ${s} OR i.company_name ILIKE ${s} OR i.id_no ILIKE ${s} OR u.nama ILIKE ${s})`;
  }

  const sql = `
    SELECT
      i.id, i.tenant_key, i.project_key, i.person_type, i.employee_id,
      COALESCE(u.nama, i.person_name) AS display_name,
      i.person_name,
      i.company_name, i.id_no, i.induction_date, i.test_score,
      i.result, i.valid_until, i.inductor_name,
      i.notes, i.created_at,
      CASE
        WHEN i.valid_until IS NOT NULL AND i.valid_until < CURRENT_DATE THEN 'EXPIRED'
        ELSE 'VALID'
      END AS validity_status
    FROM hse_inductions i
    LEFT JOIN users u ON u.id = i.employee_id
    ${where}
    ORDER BY i.induction_date DESC, i.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createInduction(db, scope, user, payload = {}) {
  const {
    person_type,
    employee_id,
    person_name,
    company_name,
    id_no,
    induction_date,
    test_score,
    result,
    valid_until,
    inductor_name,
    notes,
  } = payload;

  if (!person_type || !person_name || !induction_date) {
    const err = new Error('Field person_type, person_name, dan induction_date wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const sql = `
    INSERT INTO hse_inductions (
      tenant_key, project_key, person_type, employee_id, person_name,
      company_name, id_no, induction_date, test_score, result,
      valid_until, inductor_name, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, person_type.toUpperCase(),
    employee_id || null, person_name, company_name || null,
    id_no || null, induction_date, test_score !== undefined ? test_score : null,
    result || 'PASSED', valid_until || null, inductor_name || user.nama || null,
    notes || null,
  ]);

  return rows[0];
}

// ---------------------------------------------------------------
// TAB OPERASIONAL P5M & SAFETY TALK (view Hazard dan Inspeksi)
// Event + peserta per-orang; deteksi data ganda + merge manual
// gaya hazard: kunci location_id + event_date + shift_id.
// ---------------------------------------------------------------

const HSE_EVENT_KINDS = {
  p5m: {
    eventsTable: 'hse_p5m_events',
    attendeesTable: 'hse_p5m_event_attendees',
    quotaFn: 'hse_p5m_effective_quota',
    prefix: 'P5M',
    label: 'P5M',
  },
  safetytalk: {
    eventsTable: 'hse_safetytalk_events',
    attendeesTable: 'hse_safetytalk_event_attendees',
    quotaFn: 'hse_safetytalk_effective_quota',
    prefix: 'STK',
    label: 'Safety Talk',
  },
};

function eventError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeTopics(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const out = [];
  for (const item of list) {
    const topic = String(item || '').trim();
    if (topic && !out.includes(topic)) out.push(topic);
  }
  return out;
}

function unionLedBy(rows) {
  const map = new Map();
  for (const row of rows) {
    const ids = Array.isArray(row.led_by_ids) ? row.led_by_ids : [];
    const names = Array.isArray(row.led_by_names) ? row.led_by_names : [];
    const max = Math.max(ids.length, names.length);
    for (let i = 0; i < max; i++) {
      const id = ids[i] || null;
      const name = String(names[i] || '').trim();
      if (!name) continue;
      const key = id ? String(id) : `name:${name.toLowerCase()}`;
      if (!map.has(key)) map.set(key, { id, name });
    }
  }
  return {
    led_by_ids: Array.from(map.values()).filter(p => p.id).map(p => p.id),
    led_by_names: Array.from(map.values()).map(p => p.name),
  };
}

function unionArrays(...lists) {
  const out = [];
  for (const list of lists) {
    for (const item of (Array.isArray(list) ? list : [])) {
      const value = String(item || '');
      if (value && !out.includes(value)) out.push(value);
    }
  }
  return out;
}

async function resolveEventShift(db, shiftId) {
  const { rows } = await db.query('SELECT id, nama_shift FROM shifts WHERE id = $1', [shiftId]);
  if (!rows[0]) throw eventError('Shift tidak valid');
  return rows[0];
}

async function resolveEventLocation(db, scope, locationId) {
  const { rows } = await db.query(`
    SELECT id, name FROM hse_locations
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3
      AND is_active = TRUE AND deleted_at IS NULL
  `, [locationId, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) throw eventError('Area/lokasi tidak valid');
  return rows[0];
}

/**
 * Kuota efektif lintas siklus Setup Target (DAILY/WEEKLY/MONTHLY): aturan WAJIB didahulukan,
 * lalu siklus terpendek. `call(cycleExpr)` menghasilkan pemanggilan fungsi *_effective_quota.
 * Hasil: LEFT JOIN LATERAL beralias `alias` dengan kolom cycle, rule_id, source, quota, status (NULL = belum diatur).
 */
function anyCycleQuotaJoin(call, alias = 'q') {
  return `LEFT JOIN LATERAL (
    SELECT c.cycle, x.rule_id, x.source, x.quota, x.status
    FROM (VALUES ('DAILY', 1), ('WEEKLY', 2), ('MONTHLY', 3)) c(cycle, ord)
    CROSS JOIN LATERAL ${call('c.cycle')} x
    WHERE x.status <> 'BELUM_DIATUR'
    ORDER BY (x.status = 'WAJIB') DESC, c.ord
    LIMIT 1
  ) ${alias} ON TRUE`;
}

/**
 * Join kuota untuk halaman Setup (matriks kewajiban): bila `cycle` diminta → siklus itu saja (parameter ke-`cycleParamIdx`);
 * bila tidak → siklus apa pun yang diatur (target mingguan/harian ikut tampil, bukan "Belum diatur").
 */
function overviewQuotaJoin(call, cycle, cycleParamIdx) {
  if (cycle) {
    return `CROSS JOIN LATERAL (
      SELECT $${cycleParamIdx}::text AS cycle, x.rule_id, x.source, x.quota, x.status
      FROM ${call(`$${cycleParamIdx}::text`)} x
    ) q`;
  }
  return anyCycleQuotaJoin(call);
}

/** Filter "Seleksi Karyawan" Setup P5M / Safety Talk (sama dengan matriks di dashboard). */
function personnelScopeWhere(personnelScope, params, alias = 'u') {
  if (!personnelScope || personnelScope.scope_mode !== 'CUSTOM') return '';
  const inc = personnelScope.included_positions || [];
  const incIds = personnelScope.included_employee_ids || [];
  const exc = personnelScope.excluded_employee_ids || [];
  let where = '';
  const conds = [];
  if (inc.length) {
    params.push(inc.map(p => String(p).toLowerCase().trim()));
    conds.push(`LOWER(TRIM(COALESCE(${alias}.jabatan, ''))) = ANY($${params.length})`);
  }
  if (incIds.length) {
    params.push(incIds);
    conds.push(`${alias}.id = ANY($${params.length}::uuid[])`);
  }
  if (conds.length) where += ` AND (${conds.join(' OR ')})`;
  if (exc.length) {
    params.push(exc);
    where += ` AND NOT (${alias}.id = ANY($${params.length}::uuid[]))`;
  }
  return where;
}

/**
 * Daftar peserta P5M / Safety Talk = karyawan aktif dalam Seleksi Karyawan Setup Master
 * yang berstatus WAJIB (siklus apa pun) pada tanggal kegiatan. Dipakai APK & sama dengan form dashboard.
 */
async function listEventParticipants(db, scope, kind, onDate) {
  const cfg = HSE_EVENT_KINDS[kind];
  if (!cfg) throw eventError('Jenis kegiatan tidak dikenal', 400);
  const personnelScope = kind === 'p5m' ? await getP5mPersonnelScope(db, scope) : await getSafetytalkPersonnelScope(db, scope);
  const params = [onDate];
  const scopeWhere = personnelScopeWhere(personnelScope, params);
  const { rows } = await db.query(`
    SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen, q.cycle, q.quota
    FROM users u
    ${anyCycleQuotaJoin(c => `${cfg.quotaFn}(u.id, ${c}, $1::date)`)}
    WHERE u.is_active = TRUE AND q.status = 'WAJIB' ${scopeWhere}
    ORDER BY u.departemen, u.jabatan, u.nama
  `, params);
  return rows;
}

async function assertWajibParticipants(db, cfg, employeeIds, eventDate, scope = null) {
  if (!employeeIds.length) throw eventError('Minimal 1 peserta wajib dipilih');
  const { rows } = await db.query(`
    SELECT u.id, u.nama, q.status AS quota_status
    FROM users u
    ${anyCycleQuotaJoin(c => `${cfg.quotaFn}(u.id, ${c}, $1)`)}
    WHERE u.id = ANY($2) AND u.is_active = TRUE
  `, [eventDate, employeeIds]);
  if (scope) {
    // Peserta harus termasuk "Seleksi Karyawan" Setup P5M / Safety Talk (sumber daftar peserta APK & dashboard).
    const personnelScope = cfg.prefix === 'P5M' ? await getP5mPersonnelScope(db, scope) : await getSafetytalkPersonnelScope(db, scope);
    const params = [employeeIds];
    const where = personnelScopeWhere(personnelScope, params);
    if (where) {
      const inScope = new Set((await db.query(`SELECT u.id FROM users u WHERE u.id = ANY($1::uuid[]) ${where}`, params)).rows.map(r => String(r.id)));
      const outside = rows.filter(r => !inScope.has(String(r.id)));
      if (outside.length) {
        throw eventError(`Peserta berikut tidak termasuk Seleksi Karyawan Setup ${cfg.label}: ${outside.map(r => r.nama).join(', ')}`);
      }
    }
  }
  const byId = new Map(rows.map(r => [String(r.id), r]));
  const missing = employeeIds.filter(id => !byId.has(String(id)));
  if (missing.length) {
    throw eventError('Peserta tidak ditemukan atau tidak aktif');
  }
  const notWajib = rows.filter(r => r.quota_status !== 'WAJIB');
  if (notWajib.length) {
    throw eventError(
      `Peserta berikut bukan berstatus WAJIB di Setup Master: ${notWajib.map(r => r.nama).join(', ')}`
    );
  }
}

async function resolveLedByUsers(db, ledByIds) {
  const ids = (Array.isArray(ledByIds) ? ledByIds : []).filter(Boolean);
  if (!ids.length) return { led_by_ids: [], led_by_names: [] };
  const { rows } = await db.query(
    'SELECT id, nama FROM users WHERE id = ANY($1) AND is_active = TRUE',
    [ids]
  );
  const byId = new Map(rows.map(r => [String(r.id), r.nama]));
  const led_by_ids = [];
  const led_by_names = [];
  for (const id of ids) {
    const nama = byId.get(String(id));
    if (nama) {
      led_by_ids.push(id);
      led_by_names.push(nama);
    }
  }
  return { led_by_ids, led_by_names };
}

async function insertEventAttendees(db, cfg, scope, eventId, employeeIds) {
  if (!employeeIds.length) return;
  await db.query(`
    INSERT INTO ${cfg.attendeesTable} (tenant_key, project_key, event_id, employee_id, employee_no, nama, jabatan)
    SELECT $1, $2, $3, u.id, u.employee_id, u.nama, u.jabatan
    FROM users u
    WHERE u.id = ANY($4) AND u.is_active = TRUE
    ORDER BY u.nama ASC
  `, [scope.tenantKey, scope.projectKey, eventId, employeeIds]);
}

async function listHseEvents(db, scope, kind, query = {}) {
  const cfg = HSE_EVENT_KINDS[kind];
  if (!cfg) throw eventError('Jenis event tidak dikenal', 400);

  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE ev.tenant_key = $1 AND ev.project_key = $2
    AND ev.status = 'ACTIVE' AND ev.merged_into_id IS NULL`;

  if (query.date_from) {
    params.push(query.date_from);
    where += ` AND ev.event_date >= $${params.length}`;
  }
  if (query.date_to) {
    params.push(query.date_to);
    where += ` AND ev.event_date <= $${params.length}`;
  }
  if (query.location_id) {
    params.push(query.location_id);
    where += ` AND ev.location_id = $${params.length}`;
  }
  if (query.search && String(query.search).trim()) {
    params.push(`%${String(query.search).trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (ev.topics::text ILIKE ${s} OR ev.event_no ILIKE ${s}
      OR EXISTS (SELECT 1 FROM ${cfg.attendeesTable} a WHERE a.event_id = ev.id AND a.nama ILIKE ${s}))`;
  }

  const { rows } = await db.query(`
    SELECT ev.*,
      (SELECT COUNT(*)::int FROM ${cfg.eventsTable} d
        WHERE d.tenant_key = ev.tenant_key AND d.project_key = ev.project_key
          AND d.location_id = ev.location_id AND d.event_date = ev.event_date
          AND d.shift_id = ev.shift_id AND d.id <> ev.id
          AND d.status = 'ACTIVE' AND d.merged_into_id IS NULL) AS duplicate_count,
      COALESCE(att.attendee_count, 0) AS attendee_count,
      COALESCE(att.attendee_names, '{}') AS attendee_names,
      COALESCE(att.attendee_ids, '{}') AS attendee_ids
    FROM ${cfg.eventsTable} ev
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS attendee_count,
             array_agg(a.nama ORDER BY a.nama) AS attendee_names,
             array_agg(a.employee_id ORDER BY a.nama) AS attendee_ids
      FROM ${cfg.attendeesTable} a
      WHERE a.event_id = ev.id
    ) att ON TRUE
    ${where}
    ORDER BY ev.event_date DESC, ev.created_at DESC
  `, params);

  return rows;
}

async function getHseEventDetail(db, scope, kind, id) {
  const cfg = HSE_EVENT_KINDS[kind];
  if (!cfg) throw eventError('Jenis event tidak dikenal', 400);

  const eventRes = await db.query(`
    SELECT * FROM ${cfg.eventsTable}
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);
  const event = eventRes.rows[0];
  if (!event) throw eventError('Event tidak ditemukan', 404);

  const attRes = await db.query(`
    SELECT id, employee_id, employee_no, nama, jabatan
    FROM ${cfg.attendeesTable}
    WHERE event_id = $1
    ORDER BY nama ASC
  `, [id]);

  return { ...event, attendees: attRes.rows };
}

async function createHseEvent(db, scope, user, kind, input = {}) {
  const cfg = HSE_EVENT_KINDS[kind];
  if (!cfg) throw eventError('Jenis event tidak dikenal', 400);

  if (!input.event_date) throw eventError('Tanggal wajib diisi');
  if (!input.shift_id) throw eventError('Shift wajib dipilih');
  if (!input.location_id) throw eventError('Area/lokasi wajib dipilih');

  const topics = normalizeTopics(input.topics !== undefined ? input.topics : input.topic);
  if (!topics.length) throw eventError('Topik wajib diisi');

  const participantIds = Array.isArray(input.participant_ids)
    ? Array.from(new Set(input.participant_ids.filter(Boolean)))
    : [];

  const shift = await resolveEventShift(db, input.shift_id);
  const location = await resolveEventLocation(db, scope, input.location_id);
  await assertWajibParticipants(db, cfg, participantIds, input.event_date, scope);

  const ledBy = await resolveLedByUsers(db, input.led_by_ids || (input.led_by_id ? [input.led_by_id] : []));
  const photos = await compressHsePhotos(input.photos);
  const eventNo = await nextSequence(db, scope, cfg.eventsTable, cfg.prefix);

  const insertRes = await db.query(`
    INSERT INTO ${cfg.eventsTable} (
      tenant_key, project_key, event_no, event_date, shift_id, shift_name,
      location_id, location_name, topics, led_by_ids, led_by_names, photos,
      status, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ACTIVE', $13)
    RETURNING *
  `, [
    scope.tenantKey, scope.projectKey, eventNo, input.event_date,
    shift.id, shift.nama_shift, location.id, location.name, topics,
    ledBy.led_by_ids, ledBy.led_by_names, photos, user?.id || null,
  ]);

  const created = insertRes.rows[0];
  await insertEventAttendees(db, cfg, scope, created.id, participantIds);

  return getHseEventDetail(db, scope, kind, created.id);
}

async function updateHseEvent(db, scope, user, kind, id, input = {}) {
  const cfg = HSE_EVENT_KINDS[kind];
  if (!cfg) throw eventError('Jenis event tidak dikenal', 400);

  const currentRes = await db.query(`
    SELECT * FROM ${cfg.eventsTable}
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);
  const current = currentRes.rows[0];
  if (!current) throw eventError('Event tidak ditemukan', 404);
  if (current.status === 'DUPLICATE' || current.merged_into_id) {
    throw eventError('Event sudah tergabung dengan data lain. Edit melalui event utamanya.');
  }

  const eventDate = input.event_date !== undefined ? input.event_date : current.event_date;
  const shiftId = input.shift_id !== undefined ? input.shift_id : current.shift_id;
  const locationId = input.location_id !== undefined ? input.location_id : current.location_id;
  if (!eventDate) throw eventError('Tanggal wajib diisi');

  const topics = input.topics !== undefined || input.topic !== undefined
    ? normalizeTopics(input.topics !== undefined ? input.topics : input.topic)
    : current.topics;
  if (!topics.length) throw eventError('Topik wajib diisi');

  let shiftName = current.shift_name;
  let shiftRow = null;
  if (String(shiftId) !== String(current.shift_id)) {
    shiftRow = await resolveEventShift(db, shiftId);
    shiftName = shiftRow.nama_shift;
  }
  let locationName = current.location_name;
  if (String(locationId) !== String(current.location_id)) {
    const location = await resolveEventLocation(db, scope, locationId);
    locationName = location.name;
  }

  let ledByIds = current.led_by_ids;
  let ledByNames = current.led_by_names;
  if (input.led_by_ids !== undefined) {
    const resolved = await resolveLedByUsers(db, input.led_by_ids);
    ledByIds = resolved.led_by_ids;
    ledByNames = resolved.led_by_names;
  }

  let nextPhotos = current.photos;
  if (Array.isArray(input.photos)) {
    nextPhotos = await compressNewPhotos(current.photos, input.photos);
  }

  const updateRes = await db.query(`
    UPDATE ${cfg.eventsTable} SET
      event_date = $4,
      shift_id = $5,
      shift_name = $6,
      location_id = $7,
      location_name = $8,
      topics = $9,
      led_by_ids = $10,
      led_by_names = $11,
      photos = $12,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3
    RETURNING *
  `, [
    id, scope.tenantKey, scope.projectKey, eventDate,
    shiftId, shiftName, locationId, locationName, topics,
    ledByIds, ledByNames, nextPhotos,
  ]);

  if (Array.isArray(input.participant_ids)) {
    const participantIds = Array.from(new Set(input.participant_ids.filter(Boolean)));
    await assertWajibParticipants(db, cfg, participantIds, eventDate, scope);
    await db.query(`DELETE FROM ${cfg.attendeesTable} WHERE event_id = $1`, [id]);
    await insertEventAttendees(db, cfg, scope, id, participantIds);
  }

  return getHseEventDetail(db, scope, kind, updateRes.rows[0].id);
}

async function deleteHseEvent(db, scope, kind, id) {
  const cfg = HSE_EVENT_KINDS[kind];
  if (!cfg) throw eventError('Jenis event tidak dikenal', 400);

  const targetRes = await db.query(`
    SELECT id FROM ${cfg.eventsTable}
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);
  if (!targetRes.rows[0]) throw eventError('Event tidak ditemukan', 404);

  const treeRes = await db.query(`
    WITH RECURSIVE event_tree AS (
      SELECT id FROM ${cfg.eventsTable}
      WHERE id = $1 AND tenant_key = $2 AND project_key = $3
      UNION ALL
      SELECT e.id FROM ${cfg.eventsTable} e
      JOIN event_tree t ON e.merged_into_id = t.id
    )
    SELECT id FROM event_tree
  `, [id, scope.tenantKey, scope.projectKey]);
  const ids = treeRes.rows.map(r => r.id);

  const delRes = await db.query(`
    DELETE FROM ${cfg.eventsTable}
    WHERE id = ANY($1) AND tenant_key = $2 AND project_key = $3
    RETURNING id
  `, [ids, scope.tenantKey, scope.projectKey]);

  return { success: true, deleted_count: delRes.rows.length };
}

async function mergeHseEvents(db, scope, user, kind, targetId, sourceIds = []) {
  const cfg = HSE_EVENT_KINDS[kind];
  if (!cfg) throw eventError('Jenis event tidak dikenal', 400);

  const sources = Array.from(new Set((Array.isArray(sourceIds) ? sourceIds : []).filter(Boolean)))
    .filter(sid => String(sid) !== String(targetId));
  if (!sources.length) throw eventError('Pilih minimal 1 data lain untuk digabungkan');

  const targetRes = await db.query(`
    SELECT * FROM ${cfg.eventsTable}
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3
      AND status = 'ACTIVE' AND merged_into_id IS NULL
  `, [targetId, scope.tenantKey, scope.projectKey]);
  const target = targetRes.rows[0];
  if (!target) throw eventError('Event utama tidak ditemukan', 404);

  const sourceRes = await db.query(`
    SELECT * FROM ${cfg.eventsTable}
    WHERE id = ANY($1) AND tenant_key = $2 AND project_key = $3
      AND status = 'ACTIVE' AND merged_into_id IS NULL
  `, [sources, scope.tenantKey, scope.projectKey]);
  const sourceRows = sourceRes.rows;
  if (sourceRows.length !== sources.length) {
    throw eventError('Salah satu data yang digabung tidak ditemukan', 404);
  }

  const sameKey = sourceRows.every(s =>
    String(s.location_id) === String(target.location_id) &&
    String(s.event_date) === String(target.event_date) &&
    String(s.shift_id) === String(target.shift_id)
  );
  if (!sameKey) {
    throw eventError('Hanya event dengan Area, Tanggal, dan Shift sama yang bisa digabung');
  }

  const mergedTopics = unionArrays(target.topics, ...sourceRows.map(s => s.topics));
  const mergedLedBy = unionLedBy([target, ...sourceRows]);
  const mergedPhotos = unionArrays(target.photos, ...sourceRows.map(s => s.photos));

  const existingAtt = await db.query(
    `SELECT employee_id FROM ${cfg.attendeesTable} WHERE event_id = $1`,
    [targetId]
  );
  const existingEmpIds = new Set(existingAtt.rows.map(r => String(r.employee_id)));

  for (const source of sourceRows) {
    const attRes = await db.query(
      `SELECT employee_id, employee_no, nama, jabatan FROM ${cfg.attendeesTable} WHERE event_id = $1`,
      [source.id]
    );
    for (const att of attRes.rows) {
      const key = att.employee_id ? String(att.employee_id) : `n:${String(att.nama).toLowerCase()}`;
      if (existingEmpIds.has(key)) continue;
      existingEmpIds.add(key);
      await db.query(`
        INSERT INTO ${cfg.attendeesTable} (tenant_key, project_key, event_id, employee_id, employee_no, nama, jabatan)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [scope.tenantKey, scope.projectKey, targetId, att.employee_id, att.employee_no, att.nama, att.jabatan]);
    }
    await db.query(`DELETE FROM ${cfg.attendeesTable} WHERE event_id = $1`, [source.id]);
  }

  await db.query(`
    UPDATE ${cfg.eventsTable} SET
      topics = $4,
      led_by_ids = $5,
      led_by_names = $6,
      photos = $7,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [targetId, scope.tenantKey, scope.projectKey, mergedTopics, mergedLedBy.led_by_ids, mergedLedBy.led_by_names, mergedPhotos]);

  await db.query(`
    UPDATE ${cfg.eventsTable} SET
      status = 'DUPLICATE',
      merged_into_id = $4,
      merged_at = CURRENT_TIMESTAMP,
      merged_by = $5,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ANY($1) AND tenant_key = $2 AND project_key = $3
  `, [sources, scope.tenantKey, scope.projectKey, targetId, user?.id || null]);

  await db.query(`
    UPDATE ${cfg.eventsTable} SET
      merged_into_id = $4,
      updated_at = CURRENT_TIMESTAMP
    WHERE merged_into_id = ANY($1) AND id <> ANY($2)
      AND tenant_key = $3 AND project_key = $5
  `, [sources, sources, scope.tenantKey, targetId, scope.projectKey]);

  return getHseEventDetail(db, scope, kind, targetId);
}

// Wrapper eksplisit per jenis event (pola penamaan mandate P5M/SafetyTalk)
const listP5mEvents = (db, scope, query) => listHseEvents(db, scope, 'p5m', query);
const getP5mEventDetail = (db, scope, id) => getHseEventDetail(db, scope, 'p5m', id);
const createP5mEvent = (db, scope, user, input) => createHseEvent(db, scope, user, 'p5m', input);
const updateP5mEvent = (db, scope, user, id, input) => updateHseEvent(db, scope, user, 'p5m', id, input);
const deleteP5mEvent = (db, scope, id) => deleteHseEvent(db, scope, 'p5m', id);
const mergeP5mEvents = (db, scope, user, targetId, sourceIds) => mergeHseEvents(db, scope, user, 'p5m', targetId, sourceIds);

const listSafetytalkEvents = (db, scope, query) => listHseEvents(db, scope, 'safetytalk', query);
const getSafetytalkEventDetail = (db, scope, id) => getHseEventDetail(db, scope, 'safetytalk', id);
const createSafetytalkEvent = (db, scope, user, input) => createHseEvent(db, scope, user, 'safetytalk', input);
const updateSafetytalkEvent = (db, scope, user, id, input) => updateHseEvent(db, scope, user, 'safetytalk', id, input);
const deleteSafetytalkEvent = (db, scope, id) => deleteHseEvent(db, scope, 'safetytalk', id);
const mergeSafetytalkEvents = (db, scope, user, targetId, sourceIds) => mergeHseEvents(db, scope, user, 'safetytalk', targetId, sourceIds);

// -------------------------------------------------------------
// FASE 4: IZIN KERJA (PTW, LOTO, SIMOPS) & INSPEKSI KESELAMATAN
// -------------------------------------------------------------

async function getPtwOverview(db, scope) {
  const statsRes = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'ACTIVE' AND valid_until >= CURRENT_TIMESTAMP)::int AS active_count,
      COUNT(*) FILTER (WHERE status IN ('SUBMITTED', 'HSE_CHECK'))::int AS pending_count,
      COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved_count,
      COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_count,
      COUNT(*) FILTER (WHERE valid_until < CURRENT_TIMESTAMP AND status NOT IN ('CLOSED', 'REJECTED'))::int AS expired_count,
      COUNT(*)::int AS total_count
    FROM hse_ptw_permits
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const simopsRes = await db.query(`
    SELECT
      location_id,
      location_name,
      COUNT(*)::int AS active_permits_count,
      json_agg(json_build_object('id', id, 'permit_no', permit_no, 'permit_type', permit_type, 'work_description', work_description)) AS permits
    FROM hse_ptw_permits
    WHERE tenant_key = $1 AND project_key = $2 AND status = 'ACTIVE' AND valid_until >= CURRENT_TIMESTAMP AND deleted_at IS NULL
    GROUP BY location_id, location_name
    HAVING COUNT(*) >= 2
  `, [scope.tenantKey, scope.projectKey]);

  return {
    stats: statsRes.rows[0] || { active_count: 0, pending_count: 0, approved_count: 0, closed_count: 0, expired_count: 0, total_count: 0 },
    simops: simopsRes.rows || [],
  };
}

async function listPermits(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE p.tenant_key = $1 AND p.project_key = $2 AND p.deleted_at IS NULL`;

  if (query.permit_type) {
    params.push(query.permit_type);
    where += ` AND p.permit_type = $${params.length}`;
  }

  if (query.location_id) {
    params.push(query.location_id);
    where += ` AND p.location_id = $${params.length}`;
  }

  if (query.status) {
    params.push(query.status);
    where += ` AND p.status = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (p.permit_no ILIKE ${s} OR p.work_description ILIKE ${s} OR p.requested_by_name ILIKE ${s} OR p.company_name ILIKE ${s} OR p.location_name ILIKE ${s})`;
  }

  const sql = `
    SELECT
      p.id, p.tenant_key, p.project_key, p.permit_no, p.permit_type,
      p.location_id, COALESCE(l.name, p.location_name) AS location_name,
      p.work_description, p.company_name, p.requested_by_id, p.requested_by_name,
      p.valid_from, p.valid_until, p.hazards_controls,
      CASE
        WHEN p.status NOT IN ('CLOSED', 'REJECTED') AND p.valid_until < CURRENT_TIMESTAMP THEN 'EXPIRED'
        ELSE p.status
      END AS computed_status,
      p.status AS stored_status,
      p.approved_by_name, p.approved_at,
      p.closed_by_name, p.closed_at, p.closure_note,
      p.created_at, p.updated_at,
      (SELECT COUNT(*)::int FROM hse_ptw_workers w WHERE w.permit_id = p.id) AS worker_count,
      (SELECT COUNT(*)::int FROM hse_ptw_isolations iso WHERE iso.permit_id = p.id AND iso.status = 'LOCKED') AS active_loto_count
    FROM hse_ptw_permits p
    LEFT JOIN hse_locations l ON l.id = p.location_id
    ${where}
    ORDER BY p.valid_from DESC, p.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function getPermitDetail(db, scope, id) {
  const permitRes = await db.query(`
    SELECT
      p.*,
      COALESCE(l.name, p.location_name) AS location_name,
      CASE
        WHEN p.status NOT IN ('CLOSED', 'REJECTED') AND p.valid_until < CURRENT_TIMESTAMP THEN 'EXPIRED'
        ELSE p.status
      END AS computed_status
    FROM hse_ptw_permits p
    LEFT JOIN hse_locations l ON l.id = p.location_id
    WHERE p.id = $1 AND p.tenant_key = $2 AND p.project_key = $3 AND p.deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!permitRes.rows[0]) {
    const err = new Error('Izin kerja tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const permit = permitRes.rows[0];

  const workersRes = await db.query(`
    SELECT
      w.id, w.permit_id, w.employee_id, w.worker_name, w.position_name,
      w.competency_check, w.notes,
      u.employee_id AS employee_nrp
    FROM hse_ptw_workers w
    LEFT JOIN users u ON u.id = w.employee_id
    WHERE w.permit_id = $1
    ORDER BY w.worker_name ASC
  `, [id]);

  const isoRes = await db.query(`
    SELECT *
    FROM hse_ptw_isolations
    WHERE permit_id = $1
    ORDER BY applied_at ASC
  `, [id]);

  const handoverRes = await db.query(`
    SELECT *
    FROM hse_ptw_handovers
    WHERE permit_id = $1
    ORDER BY handover_at DESC
  `, [id]);

  let simopsConflict = null;
  if (permit.location_id && permit.status === 'ACTIVE') {
    const simRes = await db.query(`
      SELECT id, permit_no, permit_type, work_description
      FROM hse_ptw_permits
      WHERE tenant_key = $1 AND project_key = $2 AND location_id = $3
        AND status = 'ACTIVE' AND id != $4 AND valid_until >= CURRENT_TIMESTAMP AND deleted_at IS NULL
    `, [scope.tenantKey, scope.projectKey, permit.location_id, id]);
    if (simRes.rows.length > 0) {
      simopsConflict = simRes.rows;
    }
  }

  return {
    ...permit,
    workers: workersRes.rows,
    isolations: isoRes.rows,
    handovers: handoverRes.rows,
    simopsConflict,
  };
}

async function createPermit(db, scope, user, payload = {}) {
  const {
    permit_type,
    location_id,
    company_name,
    valid_from,
    valid_until,
    hazards_controls,
    workers = [],
    isolations = [],
  } = payload;
  const work_description = payload.work_description || payload.title;

  if (!permit_type || !work_description || !valid_from || !valid_until) {
    const err = new Error('Field permit_type, work_description, valid_from, dan valid_until wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  let locationName = null;
  if (location_id) {
    const locRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [location_id]);
    locationName = locRes.rows[0]?.name || null;
  }

  const permitNo = await nextSequence(db, scope, 'hse_ptw_permits', 'PTW', new Date(valid_from));

  const insertSql = `
    INSERT INTO hse_ptw_permits (
      tenant_key, project_key, permit_no, permit_type, location_id, location_name,
      work_description, company_name, requested_by_id, requested_by_name,
      valid_from, valid_until, hazards_controls, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'SUBMITTED')
    RETURNING *
  `;

  const { rows } = await db.query(insertSql, [
    scope.tenantKey, scope.projectKey, permitNo, permit_type,
    location_id || null, locationName, work_description,
    company_name || 'PT Internal Site JMB-DKC', user.id, user.nama || 'User',
    valid_from, valid_until, JSON.stringify(hazards_controls || {})
  ]);

  const permitId = rows[0].id;

  if (Array.isArray(workers) && workers.length > 0) {
    for (const w of workers) {
      if (w.worker_name || w.employee_id) {
        let wName = w.worker_name;
        let posName = w.position_name || null;
        let compCheck = 'OK';

        if (w.employee_id) {
          const uRes = await db.query('SELECT nama, jabatan FROM users WHERE id = $1', [w.employee_id]);
          if (uRes.rows[0]) {
            wName = wName || uRes.rows[0].nama;
            posName = posName || uRes.rows[0].jabatan;
          }
          const licRes = await db.query(`
            SELECT id FROM hse_employee_licenses
            WHERE employee_id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
              AND status != 'SUSPENDED' AND expiry_date >= CURRENT_DATE
            LIMIT 1
          `, [w.employee_id, scope.tenantKey, scope.projectKey]);
          if (licRes.rows.length === 0) {
            compCheck = 'MISSING';
          }
        }

        await db.query(`
          INSERT INTO hse_ptw_workers (permit_id, employee_id, worker_name, position_name, competency_check, notes)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [permitId, w.employee_id || null, wName || 'Pekerja', posName, compCheck, w.notes || null]);
      }
    }
  }

  if (Array.isArray(isolations) && isolations.length > 0) {
    for (const iso of isolations) {
      if (iso.isolation_point && iso.lock_no) {
        await db.query(`
          INSERT INTO hse_ptw_isolations (permit_id, isolation_point, lock_no, applied_by_id, applied_by_name)
          VALUES ($1, $2, $3, $4, $5)
        `, [permitId, iso.isolation_point, iso.lock_no, user.id, user.nama || 'User']);
      }
    }
  }

  return getPermitDetail(db, scope, permitId);
}

async function updatePermitStatus(db, scope, user, id, status, payload = {}) {
  const check = await db.query(`
    SELECT * FROM hse_ptw_permits WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!check.rows[0]) {
    const err = new Error('Izin kerja tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const validStatuses = ['DRAFT', 'SUBMITTED', 'HSE_CHECK', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED'];
  if (!validStatuses.includes(status)) {
    const err = new Error(`Status tidak valid: ${status}`);
    err.statusCode = 400;
    throw err;
  }

  let approverUpdate = '';
  const params = [status, id, scope.tenantKey, scope.projectKey];

  if (status === 'APPROVED') {
    params.push(user.id, user.nama || 'HSE Approver');
    approverUpdate = `, approved_by_id = $${params.length - 1}, approved_by_name = $${params.length}, approved_at = CURRENT_TIMESTAMP`;
  } else if (status === 'CLOSED') {
    params.push(user.id, user.nama || 'HSE Officer', payload.closure_note || 'Pekerjaan selesai dan area aman.');
    approverUpdate = `, closed_by_id = $${params.length - 2}, closed_by_name = $${params.length - 1}, closed_at = CURRENT_TIMESTAMP, closure_note = $${params.length}`;
  }

  const updateSql = `
    UPDATE hse_ptw_permits
    SET status = $1, updated_at = CURRENT_TIMESTAMP ${approverUpdate}
    WHERE id = $2 AND tenant_key = $3 AND project_key = $4
    RETURNING *
  `;

  await db.query(updateSql, params);
  return getPermitDetail(db, scope, id);
}

async function addPtwIsolation(db, scope, user, permitId, payload = {}) {
  const { isolation_point, lock_no, notes } = payload;
  if (!isolation_point || !lock_no) {
    const err = new Error('Field isolation_point dan lock_no wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const sql = `
    INSERT INTO hse_ptw_isolations (permit_id, isolation_point, lock_no, applied_by_id, applied_by_name, notes)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const { rows } = await db.query(sql, [permitId, isolation_point, lock_no, user.id, user.nama || 'User', notes || null]);
  return rows[0];
}

async function releasePtwIsolation(db, scope, user, isolationId, payload = {}) {
  const sql = `
    UPDATE hse_ptw_isolations
    SET status = 'RELEASED', removed_by_id = $1, removed_by_name = $2, removed_at = CURRENT_TIMESTAMP, notes = COALESCE($3, notes)
    WHERE id = $4
    RETURNING *
  `;
  const { rows } = await db.query(sql, [user.id, user.nama || 'User', payload.notes || null, isolationId]);
  return rows[0];
}

async function addPtwHandover(db, scope, user, permitId, payload = {}) {
  const { to_user_id, to_user_name, note, checklist_verified } = payload;
  if (!to_user_name && !to_user_id) {
    const err = new Error('Penerima serah terima shift (to_user) wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  let recipientName = to_user_name;
  if (to_user_id && !recipientName) {
    const uRes = await db.query('SELECT nama FROM users WHERE id = $1', [to_user_id]);
    recipientName = uRes.rows[0]?.nama || 'Penerima';
  }

  const sql = `
    INSERT INTO hse_ptw_handovers (
      permit_id, from_user_id, from_user_name, to_user_id, to_user_name, note, checklist_verified
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const { rows } = await db.query(sql, [
    permitId, user.id, user.nama || 'User', to_user_id || null, recipientName, note || null, checklist_verified !== false
  ]);
  return rows[0];
}

async function listInspectionTemplates(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE t.tenant_key = $1 AND t.project_key = $2 AND t.deleted_at IS NULL`;

  if (query.is_current !== 'false' && query.all_versions !== 'true') {
    where += ` AND t.is_current = TRUE`;
  }
  if (query.is_active !== undefined) {
    params.push(query.is_active === 'true' || query.is_active === true);
    where += ` AND t.is_active = $${params.length}`;
  } else {
    where += ` AND t.is_active = TRUE`;
  }
  if (query.inspection_type) {
    params.push(query.inspection_type);
    where += ` AND t.inspection_type = $${params.length}`;
  }
  if (query.schedule_cycle) {
    params.push(query.schedule_cycle);
    where += ` AND t.schedule_cycle = $${params.length}`;
  }
  if (query.setup_reviewed !== undefined) {
    params.push(query.setup_reviewed === 'true');
    where += ` AND t.setup_reviewed = $${params.length}`;
  }
  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (t.code ILIKE ${s} OR t.name ILIKE ${s} OR t.description ILIKE ${s})`;
  }

  const sql = `
    SELECT 
      t.id, t.root_id, t.version_no, t.is_current, t.locked_at,
      t.code, t.name, t.object_type, t.description,
      t.inspection_type, t.schedule_cycle, t.custom_interval_days,
      t.setup_reviewed, t.is_active, t.created_at, t.updated_at,
      COUNT(i.id)::int AS items_count,
      COUNT(CASE WHEN i.is_critical THEN 1 END)::int AS critical_items_count
    FROM hse_inspection_templates t
    LEFT JOIN hse_inspection_template_items i ON i.template_id = t.id
    ${where}
    GROUP BY t.id
    ORDER BY t.code ASC, t.version_no DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function getInspectionTemplateDetail(db, scope, id) {
  const tmplRes = await db.query(`
    SELECT t.*
    FROM hse_inspection_templates t
    WHERE t.id = $1 AND t.tenant_key = $2 AND t.project_key = $3 AND t.deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!tmplRes.rows[0]) {
    const err = new Error('Templat inspeksi tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  const template = tmplRes.rows[0];

  const itemsRes = await db.query(`
    SELECT id, template_id, sort_order, question, is_critical, guidance, created_at
    FROM hse_inspection_template_items
    WHERE template_id = $1
    ORDER BY sort_order ASC, created_at ASC
  `, [id]);

  const versionsRes = await db.query(`
    SELECT id, root_id, version_no, is_current, locked_at, inspection_type, schedule_cycle, is_active, created_at
    FROM hse_inspection_templates
    WHERE root_id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
    ORDER BY version_no DESC
  `, [template.root_id, scope.tenantKey, scope.projectKey]);

  return {
    ...template,
    items: itemsRes.rows,
    versions: versionsRes.rows,
  };
}

async function createInspectionTemplate(db, scope, user, input) {
  if (!input.code || !input.name) {
    const err = new Error('Kode dan nama templat inspeksi wajib diisi');
    err.statusCode = 400;
    throw err;
  }
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const object_type = input.object_type || 'AREA';
  const inspection_type = input.inspection_type || 'PLANNED';
  const schedule_cycle = inspection_type === 'UNPLANNED' ? 'NONE' : (input.schedule_cycle || 'MONTHLY');
  const custom_interval_days = schedule_cycle === 'CUSTOM_DAYS' ? Number(input.custom_interval_days || 14) : null;
  const description = input.description || null;

  const client = (typeof db.connect === 'function') ? await db.connect() : db;
  const isPoolClient = typeof db.connect === 'function';

  try {
    if (isPoolClient) await client.query('BEGIN');

    const res = await client.query(`
      INSERT INTO hse_inspection_templates (
        tenant_key, project_key, code, name, object_type, description,
        inspection_type, schedule_cycle, custom_interval_days,
        setup_reviewed, version_no, is_current
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 1, TRUE)
      RETURNING *
    `, [
      scope.tenantKey, scope.projectKey, code, name, object_type, description,
      inspection_type, schedule_cycle, custom_interval_days
    ]);

    const created = res.rows[0];

    if (Array.isArray(input.items) && input.items.length > 0) {
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        if (item.question && item.question.trim()) {
          await client.query(`
            INSERT INTO hse_inspection_template_items (
              template_id, sort_order, question, is_critical, guidance
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            created.id,
            item.sort_order || (i + 1),
            item.question.trim(),
            Boolean(item.is_critical),
            item.guidance || null
          ]);
        }
      }
    }

    await client.query(`
      INSERT INTO hse_inspection_setup_audit (
        tenant_key, project_key, entity_type, entity_id, action, new_values, changed_by, reason
      ) VALUES ($1, $2, 'TEMPLATE', $3, 'CREATE', $4, $5, $6)
    `, [
      scope.tenantKey, scope.projectKey, created.id, JSON.stringify(created), user?.id || null, input.reason || 'Pembuatan templat baru'
    ]);

    if (isPoolClient) await client.query('COMMIT');
    return created;
  } catch (err) {
    if (isPoolClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isPoolClient) client.release();
  }
}

async function updateInspectionTemplate(db, scope, user, id, input) {
  const checkRes = await db.query(`
    SELECT * FROM hse_inspection_templates 
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!checkRes.rows[0]) {
    const err = new Error('Templat tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  const oldTmpl = checkRes.rows[0];

  if (oldTmpl.locked_at) {
    const err = new Error('Templat sudah terkunci karena pernah dipakai inspeksi. Gunakan "Simpan sebagai versi baru"');
    err.statusCode = 400;
    throw err;
  }

  const name = input.name !== undefined ? input.name.trim() : oldTmpl.name;
  const description = input.description !== undefined ? input.description : oldTmpl.description;
  const object_type = input.object_type !== undefined ? input.object_type : oldTmpl.object_type;
  const inspection_type = input.inspection_type !== undefined ? input.inspection_type : (oldTmpl.inspection_type || 'PLANNED');
  const schedule_cycle = inspection_type === 'UNPLANNED' ? 'NONE' : (input.schedule_cycle !== undefined ? input.schedule_cycle : (oldTmpl.schedule_cycle || 'MONTHLY'));
  const custom_interval_days = schedule_cycle === 'CUSTOM_DAYS' ? Number(input.custom_interval_days || 14) : null;

  const client = (typeof db.connect === 'function') ? await db.connect() : db;
  const isPoolClient = typeof db.connect === 'function';

  try {
    if (isPoolClient) await client.query('BEGIN');

    const updateRes = await client.query(`
      UPDATE hse_inspection_templates
      SET name = $1, description = $2, object_type = $3,
          inspection_type = $4, schedule_cycle = $5, custom_interval_days = $6,
          setup_reviewed = TRUE, updated_at = now()
      WHERE id = $7
      RETURNING *
    `, [name, description, object_type, inspection_type, schedule_cycle, custom_interval_days, id]);

    const updated = updateRes.rows[0];

    if (Array.isArray(input.items)) {
      await client.query('DELETE FROM hse_inspection_template_items WHERE template_id = $1', [id]);
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        if (item.question && item.question.trim()) {
          await client.query(`
            INSERT INTO hse_inspection_template_items (
              template_id, sort_order, question, is_critical, guidance
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            id,
            item.sort_order || (i + 1),
            item.question.trim(),
            Boolean(item.is_critical),
            item.guidance || null
          ]);
        }
      }
    }

    await client.query(`
      INSERT INTO hse_inspection_setup_audit (
        tenant_key, project_key, entity_type, entity_id, action, old_values, new_values, changed_by, reason
      ) VALUES ($1, $2, 'TEMPLATE', $3, 'UPDATE', $4, $5, $6, $7)
    `, [
      scope.tenantKey, scope.projectKey, id, JSON.stringify(oldTmpl), JSON.stringify(updated), user?.id || null, input.reason || 'Pembaruan templat'
    ]);

    if (isPoolClient) await client.query('COMMIT');
    return updated;
  } catch (err) {
    if (isPoolClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isPoolClient) client.release();
  }
}

async function createInspectionTemplateVersion(db, scope, user, id, input) {
  const prevRes = await db.query(`
    SELECT * FROM hse_inspection_templates 
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!prevRes.rows[0]) {
    const err = new Error('Templat acuan tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  const prev = prevRes.rows[0];

  const maxVerRes = await db.query(`
    SELECT MAX(version_no) as max_v
    FROM hse_inspection_templates
    WHERE root_id = $1 AND tenant_key = $2 AND project_key = $3
  `, [prev.root_id, scope.tenantKey, scope.projectKey]);
  const newVerNo = Number(maxVerRes.rows[0].max_v || 1) + 1;

  const client = (typeof db.connect === 'function') ? await db.connect() : db;
  const isPoolClient = typeof db.connect === 'function';

  try {
    if (isPoolClient) await client.query('BEGIN');

    await client.query(`
      UPDATE hse_inspection_templates
      SET is_current = FALSE, updated_at = now()
      WHERE root_id = $1 AND tenant_key = $2 AND project_key = $3
    `, [prev.root_id, scope.tenantKey, scope.projectKey]);

    const name = input.name ? input.name.trim() : prev.name;
    const object_type = input.object_type || prev.object_type;
    const inspection_type = input.inspection_type || prev.inspection_type || 'PLANNED';
    const schedule_cycle = inspection_type === 'UNPLANNED' ? 'NONE' : (input.schedule_cycle || prev.schedule_cycle || 'MONTHLY');
    const custom_interval_days = schedule_cycle === 'CUSTOM_DAYS' ? Number(input.custom_interval_days || prev.custom_interval_days || 14) : null;
    const description = input.description !== undefined ? input.description : prev.description;

    const insRes = await client.query(`
      INSERT INTO hse_inspection_templates (
        tenant_key, project_key, code, name, object_type, description,
        inspection_type, schedule_cycle, custom_interval_days,
        setup_reviewed, root_id, version_no, is_current, locked_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, $11, TRUE, NULL)
      RETURNING *
    `, [
      scope.tenantKey, scope.projectKey, prev.code, name, object_type, description,
      inspection_type, schedule_cycle, custom_interval_days, prev.root_id, newVerNo
    ]);

    const newTmpl = insRes.rows[0];

    const sourceItems = Array.isArray(input.items) ? input.items : (await client.query(`
      SELECT question, is_critical, guidance, sort_order
      FROM hse_inspection_template_items WHERE template_id = $1 ORDER BY sort_order ASC
    `, [id])).rows;

    for (let i = 0; i < sourceItems.length; i++) {
      const it = sourceItems[i];
      if (it.question && it.question.trim()) {
        await client.query(`
          INSERT INTO hse_inspection_template_items (
            template_id, sort_order, question, is_critical, guidance
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          newTmpl.id, it.sort_order || (i + 1), it.question.trim(), Boolean(it.is_critical), it.guidance || null
        ]);
      }
    }

    await client.query(`
      INSERT INTO hse_inspection_setup_audit (
        tenant_key, project_key, entity_type, entity_id, action, old_values, new_values, changed_by, reason
      ) VALUES ($1, $2, 'TEMPLATE', $3, 'NEW_VERSION', $4, $5, $6, $7)
    `, [
      scope.tenantKey, scope.projectKey, newTmpl.id,
      JSON.stringify({ from_version: prev.version_no, from_id: prev.id }),
      JSON.stringify(newTmpl),
      user?.id || null, input.reason || `Rilis versi ${newVerNo}`
    ]);

    if (isPoolClient) await client.query('COMMIT');
    return newTmpl;
  } catch (err) {
    if (isPoolClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isPoolClient) client.release();
  }
}

async function deactivateInspectionTemplate(db, scope, user, id) {
  const check = await db.query(`
    SELECT * FROM hse_inspection_templates WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!check.rows[0]) {
    const err = new Error('Templat tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  const tmpl = check.rows[0];

  const schedCountRes = await db.query(`
    SELECT count(*)::int as cnt FROM hse_inspection_schedules
    WHERE template_root_id = $1 AND is_active = TRUE AND deleted_at IS NULL
  `, [tmpl.root_id]);
  const activeSchedulesCount = schedCountRes.rows[0].cnt;

  await db.query(`
    UPDATE hse_inspection_templates
    SET is_active = FALSE, updated_at = now()
    WHERE root_id = $1 AND tenant_key = $2 AND project_key = $3
  `, [tmpl.root_id, scope.tenantKey, scope.projectKey]);

  if (activeSchedulesCount > 0) {
    await db.query(`
      UPDATE hse_inspection_schedules
      SET is_active = FALSE, updated_at = now()
      WHERE template_root_id = $1 AND tenant_key = $2 AND project_key = $3
    `, [tmpl.root_id, scope.tenantKey, scope.projectKey]);
  }

  await db.query(`
    INSERT INTO hse_inspection_setup_audit (
      tenant_key, project_key, entity_type, entity_id, action, changed_by, reason
    ) VALUES ($1, $2, 'TEMPLATE', $3, 'DEACTIVATE', $4, $5)
  `, [
    scope.tenantKey, scope.projectKey, id, user?.id || null,
    `Penonaktifan template (${activeSchedulesCount} jadwal terkait dinonaktifkan)`
  ]);

  return { success: true, message: 'Templat dinonaktifkan', activeSchedulesDeactivated: activeSchedulesCount };
}

async function listInspectionTargets(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE t.tenant_key = $1 AND t.project_key = $2 AND t.deleted_at IS NULL`;

  if (query.target_type) {
    params.push(query.target_type);
    where += ` AND t.target_type = $${params.length}`;
  }
  if (query.cycle) {
    params.push(query.cycle);
    where += ` AND t.cycle = $${params.length}`;
  }
  if (query.is_active !== undefined) {
    params.push(query.is_active === 'true' || query.is_active === true);
    where += ` AND t.is_active = $${params.length}`;
  }

  const sql = `
    SELECT 
      t.id, t.target_type, t.position_id, wp.name AS position_name,
      t.department_id, wd.name AS department_name,
      t.employee_id, u.nama AS employee_name, u.employee_id AS employee_nrp,
      t.template_root_id, tmpl.name AS template_name, tmpl.code AS template_code,
      t.cycle, t.target_quota, t.proration_mode,
      t.effective_from, t.effective_to, t.reason_code, t.notes,
      t.is_active, t.created_at, t.updated_at
    FROM hse_inspection_targets t
    LEFT JOIN workforce_positions wp ON wp.id = t.position_id
    LEFT JOIN workforce_departments wd ON wd.id = t.department_id
    LEFT JOIN users u ON u.id = t.employee_id
    LEFT JOIN hse_inspection_templates tmpl ON tmpl.id = t.template_root_id
    ${where}
    ORDER BY t.target_type ASC, t.effective_from DESC, t.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function getInspectionPersonnelScope(db, scope) {
  const { tenantKey, projectKey } = scope;
  const res = await db.query(`
    SELECT id, tenant_key, project_key, scope_mode,
           included_positions, included_employee_ids, excluded_employee_ids,
           notes, updated_at
    FROM hse_inspection_personnel_scopes
    WHERE tenant_key = $1 AND project_key = $2
    LIMIT 1
  `, [tenantKey, projectKey]);

  if (res.rows.length === 0) {
    return {
      scope_mode: 'ALL',
      included_positions: [],
      included_employee_ids: [],
      excluded_employee_ids: [],
      notes: null,
      updated_at: null,
    };
  }

  return res.rows[0];
}

async function saveInspectionPersonnelScope(db, scope, user, input) {
  const { tenantKey, projectKey } = scope;
  const {
    scope_mode = 'CUSTOM',
    included_positions = [],
    included_employee_ids = [],
    excluded_employee_ids = [],
    notes = null,
  } = input || {};

  const incPositions = Array.isArray(included_positions) ? included_positions.map(p => String(p).trim()).filter(Boolean) : [];
  const incEmpIds = Array.isArray(included_employee_ids) ? included_employee_ids.filter(Boolean) : [];
  const excEmpIds = Array.isArray(excluded_employee_ids) ? excluded_employee_ids.filter(Boolean) : [];

  const res = await db.query(`
    INSERT INTO hse_inspection_personnel_scopes (
      tenant_key, project_key, scope_mode,
      included_positions, included_employee_ids, excluded_employee_ids,
      notes, updated_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (tenant_key, project_key) DO UPDATE SET
      scope_mode = EXCLUDED.scope_mode,
      included_positions = EXCLUDED.included_positions,
      included_employee_ids = EXCLUDED.included_employee_ids,
      excluded_employee_ids = EXCLUDED.excluded_employee_ids,
      notes = EXCLUDED.notes,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING *
  `, [
    tenantKey, projectKey, scope_mode,
    incPositions, incEmpIds, excEmpIds,
    notes, user?.id || null,
  ]);

  return res.rows[0];
}

async function getInspectionMandateOverview(db, scope, query = {}) {
  const onDate = query.date || new Date().toISOString().slice(0, 10);
  const cycle = query.cycle || 'MONTHLY';
  const templateRootId = query.template_root_id || null;

  // Cek konfigurasi scope personil jika tidak meminta all_employees=true
  const personnelScope = await getInspectionPersonnelScope(db, scope);
  const isCustomScope = personnelScope.scope_mode === 'CUSTOM' && query.all_employees !== 'true';

  let empWhere = 'WHERE u.is_active = TRUE';
  const empParams = [];

  if (isCustomScope) {
    const incPositions = personnelScope.included_positions || [];
    const incEmpIds = personnelScope.included_employee_ids || [];
    const excEmpIds = personnelScope.excluded_employee_ids || [];

    // Jika scope custom sudah dikonfigurasi (ada posisi atau include id)
    if (incPositions.length > 0 || incEmpIds.length > 0) {
      const conds = [];
      if (incPositions.length > 0) {
        empParams.push(incPositions.map(p => p.toLowerCase().trim()));
        conds.push(`LOWER(TRIM(COALESCE(u.jabatan, ''))) = ANY($${empParams.length})`);
      }
      if (incEmpIds.length > 0) {
        empParams.push(incEmpIds);
        conds.push(`u.id = ANY($${empParams.length})`);
      }
      empWhere += ` AND (${conds.join(' OR ')})`;
    }

    if (excEmpIds.length > 0) {
      empParams.push(excEmpIds);
      empWhere += ` AND NOT (u.id = ANY($${empParams.length}))`;
    }
  }

  if (query.department) {
    empParams.push(query.department);
    empWhere += ` AND u.departemen = $${empParams.length}`;
  }
  if (query.search) {
    empParams.push(`%${query.search.trim()}%`);
    const s = `$${empParams.length}`;
    empWhere += ` AND (u.nama ILIKE ${s} OR u.employee_id ILIKE ${s} OR u.jabatan ILIKE ${s})`;
  }

  const usersRes = await db.query(`
    SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen,
           q.rule_id, q.source, q.quota, q.status AS quota_status, q.cycle AS quota_cycle
    FROM users u
    ${overviewQuotaJoin(c => `hse_effective_quota(u.id, $${empParams.length + 1}::uuid, ${c}, $${empParams.length + 2}::date)`, query.cycle, empParams.length + 3)}
    ${empWhere}
    ORDER BY u.nama ASC
  `, [...empParams, templateRootId, onDate, ...(query.cycle ? [cycle] : [])]);

  const employees = [];
  let countWajib = 0;
  let countBebas = 0;
  let countBelumDiatur = 0;

  for (const row of usersRes.rows) {
    const quotaInfo = {
      rule_id: row.rule_id ?? null,
      source: row.source || 'NONE',
      quota: row.quota ?? null,
      status: row.quota_status || 'BELUM_DIATUR',
    };

    if (quotaInfo.status === 'WAJIB') countWajib++;
    else if (quotaInfo.status === 'BEBAS') countBebas++;
    else countBelumDiatur++;

    employees.push({
      id: row.id,
      nama: row.nama,
      employee_id: row.employee_id,
      jabatan: row.jabatan,
      departemen: row.departemen,
      quota_status: quotaInfo.status,
      target_quota: quotaInfo.quota,
      rule_source: quotaInfo.source,
      rule_id: quotaInfo.rule_id,
      quota_cycle: row.quota_cycle || null,
    });
  }

  let filteredList = employees;
  if (query.status) {
    filteredList = employees.filter(e => e.quota_status === query.status);
  }

  return {
    kpi: {
      totalEmployees: employees.length,
      wajibCount: countWajib,
      bebasCount: countBebas,
      belumDiaturCount: countBelumDiatur,
    },
    scope: personnelScope,
    cycle: query.cycle || null,
    onDate,
    items: filteredList,
  };
}

async function createOrUpdateInspectionTarget(db, scope, user, input) {
  const {
    target_type, position_id, department_id, employee_id,
    template_root_id, cycle = 'MONTHLY', target_quota = 0,
    proration_mode = 'NONE', effective_from = new Date().toISOString().slice(0, 10),
    effective_to = null, reason_code = null, notes = null, close_overlapping = false
  } = input;

  if (!target_type || !['BY_ROLE', 'BY_EMPLOYEE'].includes(target_type)) {
    const err = new Error('Tipe target wajib diisi: BY_ROLE atau BY_EMPLOYEE');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_ROLE' && !position_id) {
    const err = new Error('Jabatan wajib dipilih untuk target berbasis peran');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_EMPLOYEE' && !employee_id) {
    const err = new Error('Karyawan wajib dipilih untuk target individu');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_EMPLOYEE' && !reason_code) {
    const err = new Error('Alasan wajib diisi untuk override individu');
    err.statusCode = 400;
    throw err;
  }
  if (target_quota < 0) {
    const err = new Error('Target kuota tidak boleh bernilai negatif');
    err.statusCode = 400;
    throw err;
  }

  const client = (typeof db.connect === 'function') ? await db.connect() : db;
  const isPoolClient = typeof db.connect === 'function';

  try {
    if (isPoolClient) await client.query('BEGIN');

    if (close_overlapping) {
      if (target_type === 'BY_ROLE') {
        await client.query(`
          UPDATE hse_inspection_targets
          SET effective_to = ($1::date - INTERVAL '1 day')::date, updated_at = now()
          WHERE tenant_key = $2 AND project_key = $3 AND target_type = 'BY_ROLE'
            AND position_id = $4 AND (department_id = $5 OR ($5 IS NULL AND department_id IS NULL))
            AND (template_root_id = $6 OR ($6 IS NULL AND template_root_id IS NULL))
            AND cycle = $7 AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to >= $1::date)
        `, [effective_from, scope.tenantKey, scope.projectKey, position_id, department_id || null, template_root_id || null, cycle]);
      } else {
        await client.query(`
          UPDATE hse_inspection_targets
          SET effective_to = ($1::date - INTERVAL '1 day')::date, updated_at = now()
          WHERE tenant_key = $2 AND project_key = $3 AND target_type = 'BY_EMPLOYEE'
            AND employee_id = $4
            AND (template_root_id = $5 OR ($5 IS NULL AND template_root_id IS NULL))
            AND cycle = $6 AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to >= $1::date)
        `, [effective_from, scope.tenantKey, scope.projectKey, employee_id, template_root_id || null, cycle]);
      }
    }

    const insRes = await client.query(`
      INSERT INTO hse_inspection_targets (
        tenant_key, project_key, target_type, position_id, department_id, employee_id,
        template_root_id, cycle, target_quota, proration_mode,
        effective_from, effective_to, reason_code, notes,
        is_active, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE, $15, $15)
      RETURNING *
    `, [
      scope.tenantKey, scope.projectKey, target_type,
      target_type === 'BY_ROLE' ? position_id : null,
      target_type === 'BY_ROLE' ? (department_id || null) : null,
      target_type === 'BY_EMPLOYEE' ? employee_id : null,
      template_root_id || null, cycle, target_quota, proration_mode,
      effective_from, effective_to || null, reason_code || null, notes || null,
      user?.id || null
    ]);

    const created = insRes.rows[0];

    await client.query(`
      INSERT INTO hse_inspection_setup_audit (
        tenant_key, project_key, entity_type, entity_id, action, new_values, changed_by, reason
      ) VALUES ($1, $2, 'TARGET', $3, 'CREATE', $4, $5, $6)
    `, [
      scope.tenantKey, scope.projectKey, created.id, JSON.stringify(created), user?.id || null,
      target_type === 'BY_ROLE' ? 'Penetapan target per jabatan' : `Override target individu: ${reason_code}`
    ]);

    if (isPoolClient) await client.query('COMMIT');
    return created;
  } catch (err) {
    if (isPoolClient) await client.query('ROLLBACK');
    if (err.code === '23P01') {
      const customErr = new Error('Rentang tanggal aturan bertabrakan dengan aturan aktif lain untuk lingkup yang sama.');
      customErr.statusCode = 409;
      throw customErr;
    }
    throw err;
  } finally {
    if (isPoolClient) client.release();
  }
}

async function deactivateInspectionTarget(db, scope, user, id) {
  const old = await db.query(`
    SELECT * FROM hse_inspection_targets WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!old.rows[0]) {
    const err = new Error('Aturan target tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  await db.query(`
    UPDATE hse_inspection_targets
    SET is_active = FALSE, deleted_at = now(), updated_at = now(), updated_by = $1
    WHERE id = $2
  `, [user?.id || null, id]);

  await db.query(`
    INSERT INTO hse_inspection_setup_audit (
      tenant_key, project_key, entity_type, entity_id, action, old_values, changed_by, reason
    ) VALUES ($1, $2, 'TARGET', $3, 'DEACTIVATE', $4, $5, 'Penonaktifan aturan target')
  `, [scope.tenantKey, scope.projectKey, id, JSON.stringify(old.rows[0]), user?.id || null]);

  return { success: true, message: 'Aturan target berhasil dinonaktifkan' };
}

// ---------------------------------------------------------------------
// Setup Hazard Report: Matriks Target & Kewajiban Pelaporan Hazard
// Cerminan matriks inspeksi TANPA dimensi jenis/template.
// ---------------------------------------------------------------------
async function listHazardReportTargets(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE t.tenant_key = $1 AND t.project_key = $2 AND t.deleted_at IS NULL`;

  if (query.target_type) {
    params.push(query.target_type);
    where += ` AND t.target_type = $${params.length}`;
  }
  if (query.cycle) {
    params.push(query.cycle);
    where += ` AND t.cycle = $${params.length}`;
  }
  if (query.is_active !== undefined) {
    params.push(query.is_active === 'true' || query.is_active === true);
    where += ` AND t.is_active = $${params.length}`;
  }

  const sql = `
    SELECT
      t.id, t.target_type, t.position_id, wp.name AS position_name,
      t.department_id, wd.name AS department_name,
      t.employee_id, u.nama AS employee_name, u.employee_id AS employee_nrp,
      t.cycle, t.target_quota, t.proration_mode,
      t.effective_from, t.effective_to, t.reason_code, t.notes,
      t.is_active, t.created_at, t.updated_at
    FROM hse_hazard_report_targets t
    LEFT JOIN workforce_positions wp ON wp.id = t.position_id
    LEFT JOIN workforce_departments wd ON wd.id = t.department_id
    LEFT JOIN users u ON u.id = t.employee_id
    ${where}
    ORDER BY t.target_type ASC, t.effective_from DESC, t.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function getHazardReportPersonnelScope(db, scope) {
  const { tenantKey, projectKey } = scope;
  const res = await db.query(`
    SELECT id, tenant_key, project_key, scope_mode,
           included_positions, included_employee_ids, excluded_employee_ids,
           notes, updated_at
    FROM hse_hazard_report_scopes
    WHERE tenant_key = $1 AND project_key = $2
    LIMIT 1
  `, [tenantKey, projectKey]);

  if (res.rows.length === 0) {
    return {
      scope_mode: 'ALL',
      included_positions: [],
      included_employee_ids: [],
      excluded_employee_ids: [],
      notes: null,
      updated_at: null,
    };
  }

  return res.rows[0];
}

async function saveHazardReportPersonnelScope(db, scope, user, input) {
  const { tenantKey, projectKey } = scope;
  const {
    scope_mode = 'CUSTOM',
    included_positions = [],
    included_employee_ids = [],
    excluded_employee_ids = [],
    notes = null,
  } = input || {};

  const incPositions = Array.isArray(included_positions) ? included_positions.map(p => String(p).trim()).filter(Boolean) : [];
  const incEmpIds = Array.isArray(included_employee_ids) ? included_employee_ids.filter(Boolean) : [];
  const excEmpIds = Array.isArray(excluded_employee_ids) ? excluded_employee_ids.filter(Boolean) : [];

  const res = await db.query(`
    INSERT INTO hse_hazard_report_scopes (
      tenant_key, project_key, scope_mode,
      included_positions, included_employee_ids, excluded_employee_ids,
      notes, updated_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (tenant_key, project_key) DO UPDATE SET
      scope_mode = EXCLUDED.scope_mode,
      included_positions = EXCLUDED.included_positions,
      included_employee_ids = EXCLUDED.included_employee_ids,
      excluded_employee_ids = EXCLUDED.excluded_employee_ids,
      notes = EXCLUDED.notes,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING *
  `, [
    tenantKey, projectKey, scope_mode,
    incPositions, incEmpIds, excEmpIds,
    notes, user?.id || null,
  ]);

  return res.rows[0];
}

async function getHazardReportMandateOverview(db, scope, query = {}) {
  const onDate = query.date || new Date().toISOString().slice(0, 10);
  const cycle = query.cycle || 'MONTHLY';

  // Cek konfigurasi scope personil jika tidak meminta all_employees=true
  const personnelScope = await getHazardReportPersonnelScope(db, scope);
  const isCustomScope = personnelScope.scope_mode === 'CUSTOM' && query.all_employees !== 'true';

  let empWhere = 'WHERE u.is_active = TRUE';
  const empParams = [];

  if (isCustomScope) {
    const incPositions = personnelScope.included_positions || [];
    const incEmpIds = personnelScope.included_employee_ids || [];
    const excEmpIds = personnelScope.excluded_employee_ids || [];

    // Jika scope custom sudah dikonfigurasi (ada posisi atau include id)
    if (incPositions.length > 0 || incEmpIds.length > 0) {
      const conds = [];
      if (incPositions.length > 0) {
        empParams.push(incPositions.map(p => p.toLowerCase().trim()));
        conds.push(`LOWER(TRIM(COALESCE(u.jabatan, ''))) = ANY($${empParams.length})`);
      }
      if (incEmpIds.length > 0) {
        empParams.push(incEmpIds);
        conds.push(`u.id = ANY($${empParams.length})`);
      }
      empWhere += ` AND (${conds.join(' OR ')})`;
    }

    if (excEmpIds.length > 0) {
      empParams.push(excEmpIds);
      empWhere += ` AND NOT (u.id = ANY($${empParams.length}))`;
    }
  }

  if (query.department) {
    empParams.push(query.department);
    empWhere += ` AND u.departemen = $${empParams.length}`;
  }
  if (query.search) {
    empParams.push(`%${query.search.trim()}%`);
    const s = `$${empParams.length}`;
    empWhere += ` AND (u.nama ILIKE ${s} OR u.employee_id ILIKE ${s} OR u.jabatan ILIKE ${s})`;
  }

  const usersRes = await db.query(`
    SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen,
           q.rule_id, q.source, q.quota, q.status AS quota_status, q.cycle AS quota_cycle
    FROM users u
    ${overviewQuotaJoin(c => `hse_hazard_effective_quota(u.id, ${c}, $${empParams.length + 1}::date)`, query.cycle, empParams.length + 2)}
    ${empWhere}
    ORDER BY u.nama ASC
  `, [...empParams, onDate, ...(query.cycle ? [cycle] : [])]);

  const employees = [];
  let countWajib = 0;
  let countBebas = 0;
  let countBelumDiatur = 0;

  for (const row of usersRes.rows) {
    const quotaInfo = {
      rule_id: row.rule_id ?? null,
      source: row.source || 'NONE',
      quota: row.quota ?? null,
      status: row.quota_status || 'BELUM_DIATUR',
    };

    if (quotaInfo.status === 'WAJIB') countWajib++;
    else if (quotaInfo.status === 'BEBAS') countBebas++;
    else countBelumDiatur++;

    employees.push({
      id: row.id,
      nama: row.nama,
      employee_id: row.employee_id,
      jabatan: row.jabatan,
      departemen: row.departemen,
      quota_status: quotaInfo.status,
      target_quota: quotaInfo.quota,
      rule_source: quotaInfo.source,
      rule_id: quotaInfo.rule_id,
      quota_cycle: row.quota_cycle || null,
    });
  }

  let filteredList = employees;
  if (query.status) {
    filteredList = employees.filter(e => e.quota_status === query.status);
  }

  return {
    kpi: {
      totalEmployees: employees.length,
      wajibCount: countWajib,
      bebasCount: countBebas,
      belumDiaturCount: countBelumDiatur,
    },
    scope: personnelScope,
    cycle: query.cycle || null,
    onDate,
    items: filteredList,
  };
}

async function createOrUpdateHazardReportTarget(db, scope, user, input) {
  const {
    target_type, position_id, department_id, employee_id,
    cycle = 'MONTHLY', target_quota = 0,
    proration_mode = 'NONE', effective_from = new Date().toISOString().slice(0, 10),
    effective_to = null, reason_code = null, notes = null, close_overlapping = false
  } = input;

  if (!target_type || !['BY_ROLE', 'BY_EMPLOYEE'].includes(target_type)) {
    const err = new Error('Tipe target wajib diisi: BY_ROLE atau BY_EMPLOYEE');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_ROLE' && !position_id) {
    const err = new Error('Jabatan wajib dipilih untuk target berbasis peran');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_EMPLOYEE' && !employee_id) {
    const err = new Error('Karyawan wajib dipilih untuk target individu');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_EMPLOYEE' && !reason_code) {
    const err = new Error('Alasan wajib diisi untuk override individu');
    err.statusCode = 400;
    throw err;
  }
  if (target_quota < 0) {
    const err = new Error('Target kuota tidak boleh bernilai negatif');
    err.statusCode = 400;
    throw err;
  }

  const client = (typeof db.connect === 'function') ? await db.connect() : db;
  const isPoolClient = typeof db.connect === 'function';

  try {
    if (isPoolClient) await client.query('BEGIN');

    if (close_overlapping) {
      if (target_type === 'BY_ROLE') {
        await client.query(`
          UPDATE hse_hazard_report_targets
          SET effective_to = ($1::date - INTERVAL '1 day')::date, updated_at = now()
          WHERE tenant_key = $2 AND project_key = $3 AND target_type = 'BY_ROLE'
            AND position_id = $4 AND (department_id = $5 OR ($5 IS NULL AND department_id IS NULL))
            AND cycle = $6 AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to >= $1::date)
        `, [effective_from, scope.tenantKey, scope.projectKey, position_id, department_id || null, cycle]);
      } else {
        await client.query(`
          UPDATE hse_hazard_report_targets
          SET effective_to = ($1::date - INTERVAL '1 day')::date, updated_at = now()
          WHERE tenant_key = $2 AND project_key = $3 AND target_type = 'BY_EMPLOYEE'
            AND employee_id = $4
            AND cycle = $5 AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to >= $1::date)
        `, [effective_from, scope.tenantKey, scope.projectKey, employee_id, cycle]);
      }
    }

    const insRes = await client.query(`
      INSERT INTO hse_hazard_report_targets (
        tenant_key, project_key, target_type, position_id, department_id, employee_id,
        cycle, target_quota, proration_mode,
        effective_from, effective_to, reason_code, notes,
        is_active, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, $14, $14)
      RETURNING *
    `, [
      scope.tenantKey, scope.projectKey, target_type,
      target_type === 'BY_ROLE' ? position_id : null,
      target_type === 'BY_ROLE' ? (department_id || null) : null,
      target_type === 'BY_EMPLOYEE' ? employee_id : null,
      cycle, target_quota, proration_mode,
      effective_from, effective_to || null, reason_code || null, notes || null,
      user?.id || null
    ]);

    const created = insRes.rows[0];

    await client.query(`
      INSERT INTO hse_inspection_setup_audit (
        tenant_key, project_key, entity_type, entity_id, action, new_values, changed_by, reason
      ) VALUES ($1, $2, 'HAZARD_TARGET', $3, 'CREATE', $4, $5, $6)
    `, [
      scope.tenantKey, scope.projectKey, created.id, JSON.stringify(created), user?.id || null,
      target_type === 'BY_ROLE' ? 'Penetapan target lapor hazard per jabatan' : `Override target lapor hazard individu: ${reason_code}`
    ]);

    if (isPoolClient) await client.query('COMMIT');
    return created;
  } catch (err) {
    if (isPoolClient) await client.query('ROLLBACK');
    if (err.code === '23P01') {
      const customErr = new Error('Rentang tanggal aturan bertabrakan dengan aturan aktif lain untuk lingkup yang sama.');
      customErr.statusCode = 409;
      throw customErr;
    }
    throw err;
  } finally {
    if (isPoolClient) client.release();
  }
}

async function deactivateHazardReportTarget(db, scope, user, id) {
  const old = await db.query(`
    SELECT * FROM hse_hazard_report_targets WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!old.rows[0]) {
    const err = new Error('Aturan target tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  await db.query(`
    UPDATE hse_hazard_report_targets
    SET is_active = FALSE, deleted_at = now(), updated_at = now(), updated_by = $1
    WHERE id = $2
  `, [user?.id || null, id]);

  await db.query(`
    INSERT INTO hse_inspection_setup_audit (
      tenant_key, project_key, entity_type, entity_id, action, old_values, changed_by, reason
    ) VALUES ($1, $2, 'HAZARD_TARGET', $3, 'DEACTIVATE', $4, $5, 'Penonaktifan aturan target lapor hazard')
  `, [scope.tenantKey, scope.projectKey, id, JSON.stringify(old.rows[0]), user?.id || null]);

  return { success: true, message: 'Aturan target berhasil dinonaktifkan' };
}

// ---------------------------------------------------------------------
// Setup P5M: Matriks Target & Kewajiban (cerminan Setup Hazard Report)
// ---------------------------------------------------------------------
async function listP5mTargets(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE t.tenant_key = $1 AND t.project_key = $2 AND t.deleted_at IS NULL`;

  if (query.target_type) {
    params.push(query.target_type);
    where += ` AND t.target_type = $${params.length}`;
  }
  if (query.cycle) {
    params.push(query.cycle);
    where += ` AND t.cycle = $${params.length}`;
  }
  if (query.is_active !== undefined) {
    params.push(query.is_active === 'true' || query.is_active === true);
    where += ` AND t.is_active = $${params.length}`;
  }

  const sql = `
    SELECT
      t.id, t.target_type, t.position_id, wp.name AS position_name,
      t.department_id, wd.name AS department_name,
      t.employee_id, u.nama AS employee_name, u.employee_id AS employee_nrp,
      t.cycle, t.target_quota, t.proration_mode,
      t.effective_from, t.effective_to, t.reason_code, t.notes,
      t.is_active, t.created_at, t.updated_at
    FROM hse_p5m_targets t
    LEFT JOIN workforce_positions wp ON wp.id = t.position_id
    LEFT JOIN workforce_departments wd ON wd.id = t.department_id
    LEFT JOIN users u ON u.id = t.employee_id
    ${where}
    ORDER BY t.target_type ASC, t.effective_from DESC, t.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function getP5mPersonnelScope(db, scope) {
  const { tenantKey, projectKey } = scope;
  const res = await db.query(`
    SELECT id, tenant_key, project_key, scope_mode,
           included_positions, included_employee_ids, excluded_employee_ids,
           notes, updated_at
    FROM hse_p5m_scopes
    WHERE tenant_key = $1 AND project_key = $2
    LIMIT 1
  `, [tenantKey, projectKey]);

  if (res.rows.length === 0) {
    return {
      scope_mode: 'ALL',
      included_positions: [],
      included_employee_ids: [],
      excluded_employee_ids: [],
      notes: null,
      updated_at: null,
    };
  }

  return res.rows[0];
}

async function saveP5mPersonnelScope(db, scope, user, input) {
  const { tenantKey, projectKey } = scope;
  const {
    scope_mode = 'CUSTOM',
    included_positions = [],
    included_employee_ids = [],
    excluded_employee_ids = [],
    notes = null,
  } = input || {};

  const incPositions = Array.isArray(included_positions) ? included_positions.map(p => String(p).trim()).filter(Boolean) : [];
  const incEmpIds = Array.isArray(included_employee_ids) ? included_employee_ids.filter(Boolean) : [];
  const excEmpIds = Array.isArray(excluded_employee_ids) ? excluded_employee_ids.filter(Boolean) : [];

  const res = await db.query(`
    INSERT INTO hse_p5m_scopes (
      tenant_key, project_key, scope_mode,
      included_positions, included_employee_ids, excluded_employee_ids,
      notes, updated_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (tenant_key, project_key) DO UPDATE SET
      scope_mode = EXCLUDED.scope_mode,
      included_positions = EXCLUDED.included_positions,
      included_employee_ids = EXCLUDED.included_employee_ids,
      excluded_employee_ids = EXCLUDED.excluded_employee_ids,
      notes = EXCLUDED.notes,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING *
  `, [
    tenantKey, projectKey, scope_mode,
    incPositions, incEmpIds, excEmpIds,
    notes, user?.id || null,
  ]);

  return res.rows[0];
}

async function getP5mMandateOverview(db, scope, query = {}) {
  const onDate = query.date || new Date().toISOString().slice(0, 10);
  const cycle = query.cycle || 'MONTHLY';

  const personnelScope = await getP5mPersonnelScope(db, scope);
  const isCustomScope = personnelScope.scope_mode === 'CUSTOM' && query.all_employees !== 'true';

  let empWhere = 'WHERE u.is_active = TRUE';
  const empParams = [];

  if (isCustomScope) {
    const incPositions = personnelScope.included_positions || [];
    const incEmpIds = personnelScope.included_employee_ids || [];
    const excEmpIds = personnelScope.excluded_employee_ids || [];

    if (incPositions.length > 0 || incEmpIds.length > 0) {
      const conds = [];
      if (incPositions.length > 0) {
        empParams.push(incPositions.map(p => p.toLowerCase().trim()));
        conds.push(`LOWER(TRIM(COALESCE(u.jabatan, ''))) = ANY($${empParams.length})`);
      }
      if (incEmpIds.length > 0) {
        empParams.push(incEmpIds);
        conds.push(`u.id = ANY($${empParams.length})`);
      }
      empWhere += ` AND (${conds.join(' OR ')})`;
    }

    if (excEmpIds.length > 0) {
      empParams.push(excEmpIds);
      empWhere += ` AND NOT (u.id = ANY($${empParams.length}))`;
    }
  }

  if (query.department) {
    empParams.push(query.department);
    empWhere += ` AND u.departemen = $${empParams.length}`;
  }
  if (query.search) {
    empParams.push(`%${query.search.trim()}%`);
    const s = `$${empParams.length}`;
    empWhere += ` AND (u.nama ILIKE ${s} OR u.employee_id ILIKE ${s} OR u.jabatan ILIKE ${s})`;
  }

  const usersRes = await db.query(`
    SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen,
           q.rule_id, q.source, q.quota, q.status AS quota_status, q.cycle AS quota_cycle
    FROM users u
    ${overviewQuotaJoin(c => `hse_p5m_effective_quota(u.id, ${c}, $${empParams.length + 1}::date)`, query.cycle, empParams.length + 2)}
    ${empWhere}
    ORDER BY u.nama ASC
  `, [...empParams, onDate, ...(query.cycle ? [cycle] : [])]);

  const employees = [];
  let countWajib = 0;
  let countBebas = 0;
  let countBelumDiatur = 0;

  for (const row of usersRes.rows) {
    const quotaInfo = {
      rule_id: row.rule_id ?? null,
      source: row.source || 'NONE',
      quota: row.quota ?? null,
      status: row.quota_status || 'BELUM_DIATUR',
    };

    if (quotaInfo.status === 'WAJIB') countWajib++;
    else if (quotaInfo.status === 'BEBAS') countBebas++;
    else countBelumDiatur++;

    employees.push({
      id: row.id,
      nama: row.nama,
      employee_id: row.employee_id,
      jabatan: row.jabatan,
      departemen: row.departemen,
      quota_status: quotaInfo.status,
      target_quota: quotaInfo.quota,
      rule_source: quotaInfo.source,
      rule_id: quotaInfo.rule_id,
      quota_cycle: row.quota_cycle || null,
    });
  }

  let filteredList = employees;
  if (query.status) {
    filteredList = employees.filter(e => e.quota_status === query.status);
  }

  return {
    kpi: {
      totalEmployees: employees.length,
      wajibCount: countWajib,
      bebasCount: countBebas,
      belumDiaturCount: countBelumDiatur,
    },
    scope: personnelScope,
    cycle: query.cycle || null,
    onDate,
    items: filteredList,
  };
}

async function createOrUpdateP5mTarget(db, scope, user, input) {
  const {
    target_type, position_id, department_id, employee_id,
    cycle = 'MONTHLY', target_quota = 0,
    proration_mode = 'NONE', effective_from = new Date().toISOString().slice(0, 10),
    effective_to = null, reason_code = null, notes = null, close_overlapping = false
  } = input;

  if (!target_type || !['BY_ROLE', 'BY_EMPLOYEE'].includes(target_type)) {
    const err = new Error('Tipe target wajib diisi: BY_ROLE atau BY_EMPLOYEE');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_ROLE' && !position_id) {
    const err = new Error('Jabatan wajib dipilih untuk target berbasis peran');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_EMPLOYEE' && !employee_id) {
    const err = new Error('Karyawan wajib dipilih untuk target individu');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_EMPLOYEE' && !reason_code) {
    const err = new Error('Alasan wajib diisi untuk override individu');
    err.statusCode = 400;
    throw err;
  }
  if (target_quota < 0) {
    const err = new Error('Target kuota tidak boleh bernilai negatif');
    err.statusCode = 400;
    throw err;
  }

  const client = (typeof db.connect === 'function') ? await db.connect() : db;
  const isPoolClient = typeof db.connect === 'function';

  try {
    if (isPoolClient) await client.query('BEGIN');

    if (close_overlapping) {
      if (target_type === 'BY_ROLE') {
        await client.query(`
          UPDATE hse_p5m_targets
          SET effective_to = ($1::date - INTERVAL '1 day')::date, updated_at = now()
          WHERE tenant_key = $2 AND project_key = $3 AND target_type = 'BY_ROLE'
            AND position_id = $4 AND (department_id = $5 OR ($5 IS NULL AND department_id IS NULL))
            AND cycle = $6 AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to >= $1::date)
        `, [effective_from, scope.tenantKey, scope.projectKey, position_id, department_id || null, cycle]);
      } else {
        await client.query(`
          UPDATE hse_p5m_targets
          SET effective_to = ($1::date - INTERVAL '1 day')::date, updated_at = now()
          WHERE tenant_key = $2 AND project_key = $3 AND target_type = 'BY_EMPLOYEE'
            AND employee_id = $4
            AND cycle = $5 AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to >= $1::date)
        `, [effective_from, scope.tenantKey, scope.projectKey, employee_id, cycle]);
      }
    }

    const insRes = await client.query(`
      INSERT INTO hse_p5m_targets (
        tenant_key, project_key, target_type, position_id, department_id, employee_id,
        cycle, target_quota, proration_mode,
        effective_from, effective_to, reason_code, notes,
        is_active, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, $14, $14)
      RETURNING *
    `, [
      scope.tenantKey, scope.projectKey, target_type,
      target_type === 'BY_ROLE' ? position_id : null,
      target_type === 'BY_ROLE' ? (department_id || null) : null,
      target_type === 'BY_EMPLOYEE' ? employee_id : null,
      cycle, target_quota, proration_mode,
      effective_from, effective_to || null, reason_code || null, notes || null,
      user?.id || null
    ]);

    const created = insRes.rows[0];

    await client.query(`
      INSERT INTO hse_inspection_setup_audit (
        tenant_key, project_key, entity_type, entity_id, action, new_values, changed_by, reason
      ) VALUES ($1, $2, 'P5M_TARGET', $3, 'CREATE', $4, $5, $6)
    `, [
      scope.tenantKey, scope.projectKey, created.id, JSON.stringify(created), user?.id || null,
      target_type === 'BY_ROLE' ? 'Penetapan target P5M per jabatan' : `Override target P5M individu: ${reason_code}`
    ]);

    if (isPoolClient) await client.query('COMMIT');
    return created;
  } catch (err) {
    if (isPoolClient) await client.query('ROLLBACK');
    if (err.code === '23P01') {
      const customErr = new Error('Rentang tanggal aturan bertabrakan dengan aturan aktif lain untuk lingkup yang sama.');
      customErr.statusCode = 409;
      throw customErr;
    }
    throw err;
  } finally {
    if (isPoolClient) client.release();
  }
}

async function deactivateP5mTarget(db, scope, user, id) {
  const old = await db.query(`
    SELECT * FROM hse_p5m_targets WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!old.rows[0]) {
    const err = new Error('Aturan target tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  await db.query(`
    UPDATE hse_p5m_targets
    SET is_active = FALSE, deleted_at = now(), updated_at = now(), updated_by = $1
    WHERE id = $2
  `, [user?.id || null, id]);

  await db.query(`
    INSERT INTO hse_inspection_setup_audit (
      tenant_key, project_key, entity_type, entity_id, action, old_values, changed_by, reason
    ) VALUES ($1, $2, 'P5M_TARGET', $3, 'DEACTIVATE', $4, $5, 'Penonaktifan aturan target P5M')
  `, [scope.tenantKey, scope.projectKey, id, JSON.stringify(old.rows[0]), user?.id || null]);

  return { success: true, message: 'Aturan target berhasil dinonaktifkan' };
}

// ---------------------------------------------------------------------
// Setup Safety Talk: Matriks Target & Kewajiban (cerminan Setup P5M)
// ---------------------------------------------------------------------
async function listSafetytalkTargets(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE t.tenant_key = $1 AND t.project_key = $2 AND t.deleted_at IS NULL`;

  if (query.target_type) {
    params.push(query.target_type);
    where += ` AND t.target_type = $${params.length}`;
  }
  if (query.cycle) {
    params.push(query.cycle);
    where += ` AND t.cycle = $${params.length}`;
  }
  if (query.is_active !== undefined) {
    params.push(query.is_active === 'true' || query.is_active === true);
    where += ` AND t.is_active = $${params.length}`;
  }

  const sql = `
    SELECT
      t.id, t.target_type, t.position_id, wp.name AS position_name,
      t.department_id, wd.name AS department_name,
      t.employee_id, u.nama AS employee_name, u.employee_id AS employee_nrp,
      t.cycle, t.target_quota, t.proration_mode,
      t.effective_from, t.effective_to, t.reason_code, t.notes,
      t.is_active, t.created_at, t.updated_at
    FROM hse_safetytalk_targets t
    LEFT JOIN workforce_positions wp ON wp.id = t.position_id
    LEFT JOIN workforce_departments wd ON wd.id = t.department_id
    LEFT JOIN users u ON u.id = t.employee_id
    ${where}
    ORDER BY t.target_type ASC, t.effective_from DESC, t.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function getSafetytalkPersonnelScope(db, scope) {
  const { tenantKey, projectKey } = scope;
  const res = await db.query(`
    SELECT id, tenant_key, project_key, scope_mode,
           included_positions, included_employee_ids, excluded_employee_ids,
           notes, updated_at
    FROM hse_safetytalk_scopes
    WHERE tenant_key = $1 AND project_key = $2
    LIMIT 1
  `, [tenantKey, projectKey]);

  if (res.rows.length === 0) {
    return {
      scope_mode: 'ALL',
      included_positions: [],
      included_employee_ids: [],
      excluded_employee_ids: [],
      notes: null,
      updated_at: null,
    };
  }

  return res.rows[0];
}

async function saveSafetytalkPersonnelScope(db, scope, user, input) {
  const { tenantKey, projectKey } = scope;
  const {
    scope_mode = 'CUSTOM',
    included_positions = [],
    included_employee_ids = [],
    excluded_employee_ids = [],
    notes = null,
  } = input || {};

  const incPositions = Array.isArray(included_positions) ? included_positions.map(p => String(p).trim()).filter(Boolean) : [];
  const incEmpIds = Array.isArray(included_employee_ids) ? included_employee_ids.filter(Boolean) : [];
  const excEmpIds = Array.isArray(excluded_employee_ids) ? excluded_employee_ids.filter(Boolean) : [];

  const res = await db.query(`
    INSERT INTO hse_safetytalk_scopes (
      tenant_key, project_key, scope_mode,
      included_positions, included_employee_ids, excluded_employee_ids,
      notes, updated_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (tenant_key, project_key) DO UPDATE SET
      scope_mode = EXCLUDED.scope_mode,
      included_positions = EXCLUDED.included_positions,
      included_employee_ids = EXCLUDED.included_employee_ids,
      excluded_employee_ids = EXCLUDED.excluded_employee_ids,
      notes = EXCLUDED.notes,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING *
  `, [
    tenantKey, projectKey, scope_mode,
    incPositions, incEmpIds, excEmpIds,
    notes, user?.id || null,
  ]);

  return res.rows[0];
}

async function getSafetytalkMandateOverview(db, scope, query = {}) {
  const onDate = query.date || new Date().toISOString().slice(0, 10);
  const cycle = query.cycle || 'MONTHLY';

  const personnelScope = await getSafetytalkPersonnelScope(db, scope);
  const isCustomScope = personnelScope.scope_mode === 'CUSTOM' && query.all_employees !== 'true';

  let empWhere = 'WHERE u.is_active = TRUE';
  const empParams = [];

  if (isCustomScope) {
    const incPositions = personnelScope.included_positions || [];
    const incEmpIds = personnelScope.included_employee_ids || [];
    const excEmpIds = personnelScope.excluded_employee_ids || [];

    if (incPositions.length > 0 || incEmpIds.length > 0) {
      const conds = [];
      if (incPositions.length > 0) {
        empParams.push(incPositions.map(p => p.toLowerCase().trim()));
        conds.push(`LOWER(TRIM(COALESCE(u.jabatan, ''))) = ANY($${empParams.length})`);
      }
      if (incEmpIds.length > 0) {
        empParams.push(incEmpIds);
        conds.push(`u.id = ANY($${empParams.length})`);
      }
      empWhere += ` AND (${conds.join(' OR ')})`;
    }

    if (excEmpIds.length > 0) {
      empParams.push(excEmpIds);
      empWhere += ` AND NOT (u.id = ANY($${empParams.length}))`;
    }
  }

  if (query.department) {
    empParams.push(query.department);
    empWhere += ` AND u.departemen = $${empParams.length}`;
  }
  if (query.search) {
    empParams.push(`%${query.search.trim()}%`);
    const s = `$${empParams.length}`;
    empWhere += ` AND (u.nama ILIKE ${s} OR u.employee_id ILIKE ${s} OR u.jabatan ILIKE ${s})`;
  }

  const usersRes = await db.query(`
    SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen,
           q.rule_id, q.source, q.quota, q.status AS quota_status, q.cycle AS quota_cycle
    FROM users u
    ${overviewQuotaJoin(c => `hse_safetytalk_effective_quota(u.id, ${c}, $${empParams.length + 1}::date)`, query.cycle, empParams.length + 2)}
    ${empWhere}
    ORDER BY u.nama ASC
  `, [...empParams, onDate, ...(query.cycle ? [cycle] : [])]);

  const employees = [];
  let countWajib = 0;
  let countBebas = 0;
  let countBelumDiatur = 0;

  for (const row of usersRes.rows) {
    const quotaInfo = {
      rule_id: row.rule_id ?? null,
      source: row.source || 'NONE',
      quota: row.quota ?? null,
      status: row.quota_status || 'BELUM_DIATUR',
    };

    if (quotaInfo.status === 'WAJIB') countWajib++;
    else if (quotaInfo.status === 'BEBAS') countBebas++;
    else countBelumDiatur++;

    employees.push({
      id: row.id,
      nama: row.nama,
      employee_id: row.employee_id,
      jabatan: row.jabatan,
      departemen: row.departemen,
      quota_status: quotaInfo.status,
      target_quota: quotaInfo.quota,
      rule_source: quotaInfo.source,
      rule_id: quotaInfo.rule_id,
      quota_cycle: row.quota_cycle || null,
    });
  }

  let filteredList = employees;
  if (query.status) {
    filteredList = employees.filter(e => e.quota_status === query.status);
  }

  return {
    kpi: {
      totalEmployees: employees.length,
      wajibCount: countWajib,
      bebasCount: countBebas,
      belumDiaturCount: countBelumDiatur,
    },
    scope: personnelScope,
    cycle: query.cycle || null,
    onDate,
    items: filteredList,
  };
}

async function createOrUpdateSafetytalkTarget(db, scope, user, input) {
  const {
    target_type, position_id, department_id, employee_id,
    cycle = 'MONTHLY', target_quota = 0,
    proration_mode = 'NONE', effective_from = new Date().toISOString().slice(0, 10),
    effective_to = null, reason_code = null, notes = null, close_overlapping = false
  } = input;

  if (!target_type || !['BY_ROLE', 'BY_EMPLOYEE'].includes(target_type)) {
    const err = new Error('Tipe target wajib diisi: BY_ROLE atau BY_EMPLOYEE');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_ROLE' && !position_id) {
    const err = new Error('Jabatan wajib dipilih untuk target berbasis peran');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_EMPLOYEE' && !employee_id) {
    const err = new Error('Karyawan wajib dipilih untuk target individu');
    err.statusCode = 400;
    throw err;
  }
  if (target_type === 'BY_EMPLOYEE' && !reason_code) {
    const err = new Error('Alasan wajib diisi untuk override individu');
    err.statusCode = 400;
    throw err;
  }
  if (target_quota < 0) {
    const err = new Error('Target kuota tidak boleh bernilai negatif');
    err.statusCode = 400;
    throw err;
  }

  const client = (typeof db.connect === 'function') ? await db.connect() : db;
  const isPoolClient = typeof db.connect === 'function';

  try {
    if (isPoolClient) await client.query('BEGIN');

    if (close_overlapping) {
      if (target_type === 'BY_ROLE') {
        await client.query(`
          UPDATE hse_safetytalk_targets
          SET effective_to = ($1::date - INTERVAL '1 day')::date, updated_at = now()
          WHERE tenant_key = $2 AND project_key = $3 AND target_type = 'BY_ROLE'
            AND position_id = $4 AND (department_id = $5 OR ($5 IS NULL AND department_id IS NULL))
            AND cycle = $6 AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to >= $1::date)
        `, [effective_from, scope.tenantKey, scope.projectKey, position_id, department_id || null, cycle]);
      } else {
        await client.query(`
          UPDATE hse_safetytalk_targets
          SET effective_to = ($1::date - INTERVAL '1 day')::date, updated_at = now()
          WHERE tenant_key = $2 AND project_key = $3 AND target_type = 'BY_EMPLOYEE'
            AND employee_id = $4
            AND cycle = $5 AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to >= $1::date)
        `, [effective_from, scope.tenantKey, scope.projectKey, employee_id, cycle]);
      }
    }

    const insRes = await client.query(`
      INSERT INTO hse_safetytalk_targets (
        tenant_key, project_key, target_type, position_id, department_id, employee_id,
        cycle, target_quota, proration_mode,
        effective_from, effective_to, reason_code, notes,
        is_active, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, $14, $14)
      RETURNING *
    `, [
      scope.tenantKey, scope.projectKey, target_type,
      target_type === 'BY_ROLE' ? position_id : null,
      target_type === 'BY_ROLE' ? (department_id || null) : null,
      target_type === 'BY_EMPLOYEE' ? employee_id : null,
      cycle, target_quota, proration_mode,
      effective_from, effective_to || null, reason_code || null, notes || null,
      user?.id || null
    ]);

    const created = insRes.rows[0];

    await client.query(`
      INSERT INTO hse_inspection_setup_audit (
        tenant_key, project_key, entity_type, entity_id, action, new_values, changed_by, reason
      ) VALUES ($1, $2, 'SAFETYTALK_TARGET', $3, 'CREATE', $4, $5, $6)
    `, [
      scope.tenantKey, scope.projectKey, created.id, JSON.stringify(created), user?.id || null,
      target_type === 'BY_ROLE' ? 'Penetapan target Safety Talk per jabatan' : `Override target Safety Talk individu: ${reason_code}`
    ]);

    if (isPoolClient) await client.query('COMMIT');
    return created;
  } catch (err) {
    if (isPoolClient) await client.query('ROLLBACK');
    if (err.code === '23P01') {
      const customErr = new Error('Rentang tanggal aturan bertabrakan dengan aturan aktif lain untuk lingkup yang sama.');
      customErr.statusCode = 409;
      throw customErr;
    }
    throw err;
  } finally {
    if (isPoolClient) client.release();
  }
}

async function deactivateSafetytalkTarget(db, scope, user, id) {
  const old = await db.query(`
    SELECT * FROM hse_safetytalk_targets WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!old.rows[0]) {
    const err = new Error('Aturan target tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  await db.query(`
    UPDATE hse_safetytalk_targets
    SET is_active = FALSE, deleted_at = now(), updated_at = now(), updated_by = $1
    WHERE id = $2
  `, [user?.id || null, id]);

  await db.query(`
    INSERT INTO hse_inspection_setup_audit (
      tenant_key, project_key, entity_type, entity_id, action, old_values, changed_by, reason
    ) VALUES ($1, $2, 'SAFETYTALK_TARGET', $3, 'DEACTIVATE', $4, $5, 'Penonaktifan aturan target Safety Talk')
  `, [scope.tenantKey, scope.projectKey, id, JSON.stringify(old.rows[0]), user?.id || null]);

  return { success: true, message: 'Aturan target berhasil dinonaktifkan' };
}

async function listInspectionSchedules(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE s.tenant_key = $1 AND s.project_key = $2 AND s.deleted_at IS NULL`;

  if (query.is_active !== undefined) {
    params.push(query.is_active === 'true' || query.is_active === true);
    where += ` AND s.is_active = $${params.length}`;
  } else {
    where += ` AND s.is_active = TRUE`;
  }
  if (query.location_id) {
    params.push(query.location_id);
    where += ` AND s.location_id = $${params.length}`;
  }

  const sql = `
    SELECT 
      s.id, s.template_root_id, tmpl.code AS template_code, tmpl.name AS template_name,
      tmpl.schedule_cycle, tmpl.custom_interval_days,
      s.location_id, l.name AS location_name, s.asset_id,
      s.assignee_type, s.assignee_employee_id, u.nama AS assignee_employee_name,
      s.assignee_position_id, wp.name AS assignee_position_name,
      s.start_date, s.next_due_date, s.last_done_at, s.notes, s.is_active,
      CASE
        WHEN s.next_due_date < CURRENT_DATE THEN 'OVERDUE'
        WHEN s.next_due_date = CURRENT_DATE THEN 'TODAY'
        ELSE 'SCHEDULED'
      END AS due_status
    FROM hse_inspection_schedules s
    JOIN hse_inspection_templates tmpl 
      ON (tmpl.root_id = s.template_root_id OR tmpl.id = s.template_root_id) AND tmpl.is_current = TRUE
    LEFT JOIN hse_locations l ON l.id = s.location_id
    LEFT JOIN users u ON u.id = s.assignee_employee_id
    LEFT JOIN workforce_positions wp ON wp.id = s.assignee_position_id
    ${where}
    ORDER BY s.next_due_date ASC NULLS LAST, s.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createInspectionSchedule(db, scope, user, input) {
  const {
    template_root_id, location_id, asset_id, assignee_type,
    assignee_employee_id, assignee_position_id, start_date = new Date().toISOString().slice(0, 10),
    notes
  } = input;

  if (!template_root_id) {
    const err = new Error('Templat inspeksi wajib dipilih');
    err.statusCode = 400;
    throw err;
  }
  if (!location_id && !asset_id) {
    const err = new Error('Objek lokasi atau aset wajib dipilih');
    err.statusCode = 400;
    throw err;
  }
  if (!assignee_type || !['EMPLOYEE', 'POSITION'].includes(assignee_type)) {
    const err = new Error('Tipe penanggung jawab wajib: EMPLOYEE atau POSITION');
    err.statusCode = 400;
    throw err;
  }

  const tmplRes = await db.query(`
    SELECT * FROM hse_inspection_templates 
    WHERE (id = $1 OR root_id = $1) AND is_current = TRUE AND tenant_key = $2 AND project_key = $3
    LIMIT 1
  `, [template_root_id, scope.tenantKey, scope.projectKey]);

  if (!tmplRes.rows[0]) {
    const err = new Error('Templat tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  const tmpl = tmplRes.rows[0];

  if (tmpl.inspection_type === 'UNPLANNED') {
    const err = new Error('Templat Tidak Terencana (Unplanned) tidak dapat dijadwalkan karena bersifat insidental.');
    err.statusCode = 400;
    throw err;
  }

  let nextDueDate = start_date;
  const cycle = tmpl.schedule_cycle || 'MONTHLY';
  const start = new Date(start_date);
  if (cycle === 'DAILY') {
    nextDueDate = start_date;
  } else if (cycle === 'WEEKLY') {
    const d = new Date(start);
    d.setDate(d.getDate() + 7);
    nextDueDate = d.toISOString().slice(0, 10);
  } else if (cycle === 'MONTHLY') {
    const d = new Date(start);
    d.setMonth(d.getMonth() + 1);
    nextDueDate = d.toISOString().slice(0, 10);
  } else if (cycle === 'CUSTOM_DAYS') {
    const interval = Number(tmpl.custom_interval_days || 14);
    const d = new Date(start);
    d.setDate(d.getDate() + interval);
    nextDueDate = d.toISOString().slice(0, 10);
  }

  const actualRootId = tmpl.root_id || tmpl.id;

  const insRes = await db.query(`
    INSERT INTO hse_inspection_schedules (
      tenant_key, project_key, template_root_id, location_id, asset_id,
      assignee_type, assignee_employee_id, assignee_position_id,
      start_date, next_due_date, notes, is_active, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12)
    RETURNING *
  `, [
    scope.tenantKey, scope.projectKey, actualRootId, location_id || null, asset_id || null,
    assignee_type,
    assignee_type === 'EMPLOYEE' ? assignee_employee_id : null,
    assignee_type === 'POSITION' ? assignee_position_id : null,
    start_date, nextDueDate, notes || null, user?.id || null
  ]);

  const created = insRes.rows[0];

  await db.query(`
    INSERT INTO hse_inspection_setup_audit (
      tenant_key, project_key, entity_type, entity_id, action, new_values, changed_by, reason
    ) VALUES ($1, $2, 'SCHEDULE', $3, 'CREATE', $4, $5, 'Pembuatan jadwal inspeksi objek')
  `, [scope.tenantKey, scope.projectKey, created.id, JSON.stringify(created), user?.id || null]);

  return created;
}

async function deactivateInspectionSchedule(db, scope, user, id) {
  const old = await db.query(`
    SELECT * FROM hse_inspection_schedules WHERE id = $1 AND tenant_key = $2 AND project_key = $3
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!old.rows[0]) {
    const err = new Error('Jadwal tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  await db.query(`
    UPDATE hse_inspection_schedules
    SET is_active = FALSE, deleted_at = now(), updated_at = now()
    WHERE id = $1
  `, [id]);

  await db.query(`
    INSERT INTO hse_inspection_setup_audit (
      tenant_key, project_key, entity_type, entity_id, action, old_values, changed_by, reason
    ) VALUES ($1, $2, 'SCHEDULE', $3, 'DEACTIVATE', $4, $5, 'Penonaktifan jadwal objek')
  `, [scope.tenantKey, scope.projectKey, id, JSON.stringify(old.rows[0]), user?.id || null]);

  return { success: true, message: 'Jadwal inspeksi berhasil dinonaktifkan' };
}

async function getInspectionComplianceReport(db, scope, query = {}) {
  const month = Number(query.month || (new Date().getMonth() + 1));
  const year = Number(query.year || new Date().getFullYear());
  const cycle = query.cycle || 'MONTHLY';

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().slice(0, 10);

  const usersRes = await db.query(`
    SELECT u.id, u.nama, u.employee_id, u.jabatan, u.departemen
    FROM users u
    WHERE u.is_active = TRUE
    ORDER BY u.nama ASC
  `);

  const validInspRes = await db.query(`
    SELECT 
      i.inspected_by_id,
      COUNT(i.id)::int as total_valid_inspections
    FROM hse_inspections i
    WHERE i.tenant_key = $1 AND i.project_key = $2
      AND i.status = 'COMPLETED'
      AND i.inspected_at::date >= $3::date AND i.inspected_at::date <= $4::date
      AND i.deleted_at IS NULL
    GROUP BY i.inspected_by_id
  `, [scope.tenantKey, scope.projectKey, startDate, endDate]);

  const validCountByUserId = {};
  for (const r of validInspRes.rows) {
    if (r.inspected_by_id) validCountByUserId[r.inspected_by_id] = r.total_valid_inspections;
  }

  const reports = [];
  let achievedCount = 0;
  let wajibCount = 0;

  for (const u of usersRes.rows) {
    const qRes = await db.query(`
      SELECT quota, status FROM hse_effective_quota($1, NULL, $2, $3)
    `, [u.id, cycle, endDate]);
    const quotaInfo = qRes.rows[0] || { quota: null, status: 'BELUM_DIATUR' };

    if (quotaInfo.status === 'WAJIB') {
      wajibCount++;
      const target = Number(quotaInfo.quota || 1);
      const actual = Number(validCountByUserId[u.id] || 0);
      const complianceRate = Math.min(100, Math.round((actual / target) * 100));
      if (actual >= target) achievedCount++;

      reports.push({
        employee_id: u.id,
        nama: u.nama,
        employee_nrp: u.employee_id,
        jabatan: u.jabatan,
        departemen: u.departemen,
        target_quota: target,
        realization: actual,
        compliance_rate: complianceRate,
        status: actual >= target ? 'TERCAPAI' : 'BERJALAN'
      });
    }
  }

  // Hitung metrik cakupan jadwal objek (Schedule Coverage)
  const schedCoverageRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_active_schedules,
      COUNT(*) FILTER (WHERE next_due_date <= $4::date)::int AS due_in_period,
      COUNT(*) FILTER (WHERE last_done_at::date >= $3::date AND last_done_at::date <= $4::date)::int AS completed_in_period,
      COUNT(*) FILTER (WHERE next_due_date < CURRENT_DATE)::int AS overdue_schedules
    FROM hse_inspection_schedules
    WHERE tenant_key = $1 AND project_key = $2 AND is_active = TRUE AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey, startDate, endDate]);

  const schedStats = schedCoverageRes.rows[0] || {
    total_active_schedules: 0,
    due_in_period: 0,
    completed_in_period: 0,
    overdue_schedules: 0
  };
  const dueCount = schedStats.due_in_period || 0;
  const doneCount = schedStats.completed_in_period || 0;
  const scheduleCoverageRate = dueCount > 0 ? Math.min(100, Math.round((doneCount / dueCount) * 100)) : (schedStats.total_active_schedules > 0 ? 100 : 0);

  const overallRate = wajibCount > 0 ? Math.round((achievedCount / wajibCount) * 100) : 100;

  return {
    period: { cycle, month, year, startDate, endDate },
    summary: {
      totalWajib: wajibCount,
      achievedCount,
      complianceRate: overallRate,
      scheduleCoverage: {
        totalActive: schedStats.total_active_schedules,
        dueInPeriod: dueCount,
        completedInPeriod: doneCount,
        overdueCount: schedStats.overdue_schedules,
        coverageRate: scheduleCoverageRate
      }
    },
    items: reports,
  };
}

async function listInspections(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE i.tenant_key = $1 AND i.project_key = $2 AND i.deleted_at IS NULL`;

  if (query.template_id) {
    params.push(query.template_id);
    where += ` AND i.template_id = $${params.length}`;
  }

  if (query.location_id) {
    params.push(query.location_id);
    where += ` AND i.location_id = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (i.inspection_no ILIKE ${s} OR i.object_identifier ILIKE ${s} OR i.template_name ILIKE ${s} OR i.inspected_by_name ILIKE ${s})`;
  }

  const sql = `
    SELECT
      i.id, i.tenant_key, i.project_key, i.inspection_no,
      i.template_id, i.template_name,
      i.location_id, COALESCE(l.name, i.location_name) AS location_name,
      i.object_identifier, i.inspected_by_id, i.inspected_by_name,
      i.inspected_at, i.status, i.result_summary, i.findings_count,
      i.created_at
    FROM hse_inspections i
    LEFT JOIN hse_locations l ON l.id = i.location_id
    ${where}
    ORDER BY i.inspected_at DESC, i.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function getInspectionDetail(db, scope, id) {
  const inspRes = await db.query(`
    SELECT
      i.*,
      COALESCE(l.name, i.location_name) AS location_name
    FROM hse_inspections i
    LEFT JOIN hse_locations l ON l.id = i.location_id
    WHERE i.id = $1 AND i.tenant_key = $2 AND i.project_key = $3 AND i.deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!inspRes.rows[0]) {
    const err = new Error('Inspeksi tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const inspection = inspRes.rows[0];

  const answersRes = await db.query(`
    SELECT a.*, act.action_no, act.status AS action_status
    FROM hse_inspection_answers a
    LEFT JOIN hse_actions act ON act.id = a.action_id
    WHERE a.inspection_id = $1
    ORDER BY a.created_at ASC
  `, [id]);

  const answers = answersRes.rows.map(row => ({
    ...row,
    item_prompt: row.question,
    notes: row.note,
    category: row.category || null,
  }));

  const yesCount = answers.filter(a => a.answer === 'YES').length;
  const passRatePct = answers.length > 0 ? Math.round((yesCount / answers.length) * 100) : 100;
  const criticalFindings = answers.filter(a => a.is_critical && a.answer === 'NO');

  return {
    ...inspection,
    photos: Array.isArray(inspection.photos) ? inspection.photos : [],
    documents: Array.isArray(inspection.documents) ? inspection.documents : [],
    inspector_name: inspection.inspector_name || inspection.inspected_by_name,
    equipment_tag: inspection.equipment_tag || inspection.object_identifier,
    notes: inspection.notes || inspection.result_summary,
    pass_rate_pct: passRatePct,
    criticalFindings,
    answers,
  };
}

// -------------------------------------------------------------
// Lampiran inspeksi (foto wajib + dokumen opsional)
// Keputusan owner (grilling 2026-10-12): level header, base64 JSON,
// foto >= 1 selalu, dokumen PDF/DOCX/XLSX maks 3 x 2 MB.
// -------------------------------------------------------------

const INSPECTION_DOCUMENT_TYPES = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};
const MAX_INSPECTION_DOCUMENTS = 3;
const MAX_INSPECTION_DOCUMENT_BYTES = 2 * 1024 * 1024;

function inspectionError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

function validateInspectionDocuments(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_INSPECTION_DOCUMENTS) {
    throw inspectionError(`Maksimal ${MAX_INSPECTION_DOCUMENTS} dokumen per inspeksi`);
  }

  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') {
      throw inspectionError('Format dokumen tidak valid');
    }
    const name = String(raw.name || '').trim();
    const mime = String(raw.mime || '').trim().toLowerCase();
    const rawData = typeof raw.data === 'string' ? raw.data.trim() : '';
    if (!name || !rawData) {
      throw inspectionError('Nama file dan isi dokumen wajib diisi');
    }

    const allowedExts = INSPECTION_DOCUMENT_TYPES[mime];
    if (!allowedExts) {
      throw inspectionError(`Format dokumen tidak didukung (PDF/DOCX/XLSX): ${name}`);
    }
    const lowerName = name.toLowerCase();
    if (!allowedExts.some(ext => lowerName.endsWith(ext))) {
      throw inspectionError(`Ekstensi dokumen tidak sesuai format (${mime}): ${name}`);
    }

    const match = /^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(rawData);
    if (!match || match[1].toLowerCase() !== mime) {
      throw inspectionError(`Isi dokumen bukan base64 ${mime} yang valid: ${name}`);
    }
    const base64 = match[2].replace(/[\r\n]+/g, '');
    let buffer = null;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch (_) {
      buffer = null;
    }
    if (!buffer || !buffer.length) {
      throw inspectionError(`Isi dokumen kosong atau rusak: ${name}`);
    }
    if (buffer.length > MAX_INSPECTION_DOCUMENT_BYTES) {
      throw inspectionError(`Dokumen "${name}" melebihi batas 2 MB`);
    }
    out.push({ name, mime, size: buffer.length, data: `data:${mime};base64,${base64}` });
  }
  return out;
}

async function updateInspectionAttachments(db, scope, id, input = {}) {
  const currentRes = await db.query(`
    SELECT id, photos, documents
    FROM hse_inspections
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
  `, [id, scope.tenantKey, scope.projectKey]);

  if (!currentRes.rows[0]) {
    const err = new Error('Inspeksi tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  const current = currentRes.rows[0];

  const photos = Array.isArray(input.photos)
    ? await compressNewPhotos(current.photos, input.photos)
    : (Array.isArray(current.photos) ? current.photos : []);
  if (photos.length === 0) {
    throw inspectionError('Inspeksi wajib memiliki minimal 1 foto');
  }

  const documents = Array.isArray(input.documents)
    ? validateInspectionDocuments(input.documents)
    : (Array.isArray(current.documents) ? current.documents : []);

  await db.query(`
    UPDATE hse_inspections
    SET photos = $1, documents = $2, updated_at = NOW()
    WHERE id = $3 AND tenant_key = $4 AND project_key = $5
  `, [photos, documents, id, scope.tenantKey, scope.projectKey]);

  return getInspectionDetail(db, scope, id);
}

async function createInspection(db, scope, user, payload = {}) {
  const {
    template_id,
    location_id,
    schedule_id = null,
    result_summary,
    answers = [],
    create_capa_for_critical = true,
  } = payload;
  const object_identifier = payload.object_identifier || payload.equipment_tag || 'Unit Lapangan';
  const inspectedById = payload.inspected_by_id || user.id;

  if (!template_id || !object_identifier) {
    const err = new Error('Field template_id dan object_identifier wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const photos = await compressHsePhotos(Array.isArray(payload.photos) ? payload.photos : (payload.photo ? [payload.photo] : []));
  if (photos.length === 0) {
    throw inspectionError('Inspeksi wajib memiliki minimal 1 foto');
  }
  const documents = validateInspectionDocuments(payload.documents);

  const tmplRes = await db.query('SELECT name FROM hse_inspection_templates WHERE id = $1', [template_id]);
  const templateName = tmplRes.rows[0]?.name || 'Inspeksi';

  let locationName = null;
  if (location_id) {
    const locRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [location_id]);
    locationName = locRes.rows[0]?.name || null;
  }

  let inspectorName = user.nama || 'Inspector';
  if (inspectedById && inspectedById !== user.id) {
    const uRes = await db.query('SELECT nama FROM users WHERE id = $1', [inspectedById]);
    if (uRes.rows[0]?.nama) inspectorName = uRes.rows[0].nama;
  }

  const inspectionNo = await nextSequence(db, scope, 'hse_inspections', 'INSP', new Date());

  let findingsCount = 0;
  if (Array.isArray(answers)) {
    findingsCount = answers.filter(a => a.answer === 'NO').length;
  }

  const insertSql = `
    INSERT INTO hse_inspections (
      tenant_key, project_key, inspection_no, template_id, template_name,
      location_id, location_name, object_identifier, inspected_by_id, inspected_by_name,
      status, result_summary, findings_count, schedule_id, completed_at, photos, documents
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'COMPLETED', $11, $12, $13, NOW(), $14, $15)
    RETURNING id
  `;

  const { rows } = await db.query(insertSql, [
    scope.tenantKey, scope.projectKey, inspectionNo, template_id, templateName,
    location_id || null, locationName, object_identifier, inspectedById, inspectorName,
    result_summary || (findingsCount > 0 ? `${findingsCount} temuan ketidaksesuaian` : 'Seluruh butir inspeksi sesuai standar'),
    findingsCount,
    schedule_id || null,
    photos,
    documents
  ]);

  const inspectionId = rows[0].id;

  // Jika terhubung ke jadwal inspeksi objek aktif, perbarui last_done_at dan next_due_date
  if (schedule_id) {
    try {
      const schedRes = await db.query(`
        SELECT s.*, tmpl.schedule_cycle, tmpl.custom_interval_days
        FROM hse_inspection_schedules s
        JOIN hse_inspection_templates tmpl ON tmpl.id = s.template_root_id
        WHERE s.id = $1 AND s.tenant_key = $2 AND s.project_key = $3
      `, [schedule_id, scope.tenantKey, scope.projectKey]);

      if (schedRes.rows[0]) {
        const sched = schedRes.rows[0];
        const cycle = sched.schedule_cycle || 'MONTHLY';
        const now = new Date();
        let nextDue = new Date(now);

        if (cycle === 'DAILY') {
          nextDue.setDate(nextDue.getDate() + 1);
        } else if (cycle === 'WEEKLY') {
          nextDue.setDate(nextDue.getDate() + 7);
        } else if (cycle === 'MONTHLY') {
          nextDue.setMonth(nextDue.getMonth() + 1);
        } else if (cycle === 'CUSTOM_DAYS') {
          const days = Number(sched.custom_interval_days || 14);
          nextDue.setDate(nextDue.getDate() + days);
        }

        const nextDueDateStr = nextDue.toISOString().slice(0, 10);
        await db.query(`
          UPDATE hse_inspection_schedules
          SET last_done_at = NOW(),
              next_due_date = $1,
              updated_at = NOW()
          WHERE id = $2
        `, [nextDueDateStr, schedule_id]);
      }
    } catch (schedErr) {
      console.warn('Gagal memajukan next_due_date jadwal inspeksi:', schedErr.message);
    }
  }

  if (Array.isArray(answers) && answers.length > 0) {
    for (const a of answers) {
      let actionId = null;
      if (a.answer === 'NO' && a.is_critical && create_capa_for_critical) {
        const capaDesc = `Temuan kritis inspeksi ${object_identifier}: ${a.question}. Catatan: ${a.note || 'Perlu perbaikan segera'}`;
        const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        try {
          const act = await createAction(db, scope, user, {
            source_type: 'INSPECTION',
            source_id: inspectionId,
            description: capaDesc,
            action_type: 'CORRECTIVE',
            due_date: dueDate,
            pic_employee_id: user.id,
          });
          actionId = act.id;
        } catch (e) {
          console.warn('Auto CAPA creation from inspection warning:', e.message);
        }
      }

      await db.query(`
        INSERT INTO hse_inspection_answers (
          inspection_id, item_id, question, is_critical, answer, note, action_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        inspectionId, a.item_id || null, a.question, Boolean(a.is_critical),
        a.answer || 'YES', a.note || null, actionId
      ]);
    }
  }

  return getInspectionDetail(db, scope, inspectionId);
}

// -------------------------------------------------------------
// FASE 5: KESEHATAN KERJA (OCCUPATIONAL HEALTH)
// -------------------------------------------------------------

async function getOccHealthOverview(db, scope) {
  const mcuStats = await db.query(`
    SELECT
      COUNT(*)::int AS total_mcu,
      COUNT(*) FILTER (WHERE valid_until >= CURRENT_DATE AND fitness_result IN ('FIT', 'FIT_WITH_NOTES'))::int AS valid_mcu,
      COUNT(*) FILTER (WHERE valid_until >= CURRENT_DATE AND valid_until <= CURRENT_DATE + INTERVAL '30 days')::int AS expiring_mcu,
      COUNT(*) FILTER (WHERE valid_until < CURRENT_DATE)::int AS expired_mcu,
      COUNT(*) FILTER (WHERE fitness_result IN ('TEMP_UNFIT', 'UNFIT'))::int AS unfit_mcu
    FROM hse_mcu_records
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const ffwToday = await db.query(`
    SELECT
      COUNT(*)::int AS total_checked,
      COUNT(*) FILTER (WHERE result = 'FIT')::int AS fit_today,
      COUNT(*) FILTER (WHERE result = 'UNFIT')::int AS unfit_today,
      COUNT(*) FILTER (WHERE result = 'NEED_REVIEW')::int AS review_today
    FROM hse_fit_for_work_checks
    WHERE tenant_key = $1 AND project_key = $2 AND check_date = CURRENT_DATE AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const substanceStats = await db.query(`
    SELECT
      COUNT(*)::int AS total_tests,
      COUNT(*) FILTER (WHERE overall_result = 'POSITIVE')::int AS positive_tests,
      COUNT(*) FILTER (WHERE overall_result = 'NEGATIVE')::int AS negative_tests
    FROM hse_substance_tests
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const caseStats = await db.query(`
    SELECT
      COUNT(*)::int AS total_cases,
      COUNT(*) FILTER (WHERE status != 'CLOSED')::int AS active_cases,
      COUNT(*) FILTER (WHERE is_work_related = true)::int AS work_related_cases,
      COALESCE(SUM(lost_days), 0)::int AS total_lost_days
    FROM hse_health_cases
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const hygieneStats = await db.query(`
    SELECT
      COUNT(*)::int AS total_points,
      COUNT(*) FILTER (WHERE status = 'EXCEEDED')::int AS exceeded_points,
      COUNT(*) FILTER (WHERE status = 'NEAR_LIMIT')::int AS near_limit_points,
      COUNT(*) FILTER (WHERE status = 'OK')::int AS ok_points
    FROM hse_hygiene_measurements
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const mRow = mcuStats.rows[0] || {};
  const compliancePct = mRow.total_mcu > 0 ? Number(((mRow.valid_mcu / mRow.total_mcu) * 100).toFixed(1)) : 100.0;

  return {
    mcu: {
      total: mRow.total_mcu || 0,
      valid: mRow.valid_mcu || 0,
      expiring: mRow.expiring_mcu || 0,
      expired: mRow.expired_mcu || 0,
      unfit: mRow.unfit_mcu || 0,
      compliancePct,
    },
    ffw: ffwToday.rows[0] || { total_checked: 0, fit_today: 0, unfit_today: 0, review_today: 0 },
    substance: substanceStats.rows[0] || { total_tests: 0, positive_tests: 0, negative_tests: 0 },
    cases: caseStats.rows[0] || { total_cases: 0, active_cases: 0, work_related_cases: 0, total_lost_days: 0 },
    hygiene: hygieneStats.rows[0] || { total_points: 0, exceeded_points: 0, near_limit_points: 0, ok_points: 0 },
  };
}

async function listMcuRecords(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE m.tenant_key = $1 AND m.project_key = $2 AND m.deleted_at IS NULL`;

  if (query.mcu_type) {
    params.push(query.mcu_type);
    where += ` AND m.mcu_type = $${params.length}`;
  }

  if (query.fitness_result) {
    params.push(query.fitness_result);
    where += ` AND m.fitness_result = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (m.employee_name ILIKE ${s} OR m.employee_nrp ILIKE ${s} OR m.provider ILIKE ${s} OR u.nama ILIKE ${s})`;
  }

  const sql = `
    SELECT
      m.id, m.tenant_key, m.project_key, m.employee_id,
      COALESCE(u.nama, m.employee_name) AS employee_name,
      COALESCE(u.employee_id, m.employee_nrp) AS employee_nrp,
      COALESCE(u.jabatan, m.employee_position) AS employee_position,
      m.mcu_type, m.mcu_date, m.provider, m.fitness_result,
      m.restrictions, m.valid_until, m.doctor_name, m.notes,
      m.created_at,
      CASE
        WHEN m.fitness_result IN ('TEMP_UNFIT', 'UNFIT') THEN 'UNFIT'
        WHEN m.valid_until < CURRENT_DATE THEN 'EXPIRED'
        WHEN m.valid_until <= CURRENT_DATE + INTERVAL '30 days' THEN 'EXPIRING'
        ELSE 'VALID'
      END AS computed_status
    FROM hse_mcu_records m
    LEFT JOIN users u ON u.id = m.employee_id
    ${where}
    ORDER BY m.mcu_date DESC, m.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createMcuRecord(db, scope, user, payload = {}) {
  const {
    employee_id,
    mcu_type = 'PERIODIC',
    mcu_date,
    provider = 'Klinik Site JMB-DKC',
    fitness_result = 'FIT',
    restrictions = null,
    valid_until,
    doctor_name = null,
    notes = null,
  } = payload;

  if (!employee_id || !mcu_date || !valid_until) {
    const err = new Error('Field employee_id, mcu_date, dan valid_until wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const uRes = await db.query('SELECT nama, employee_id as nrp, jabatan FROM users WHERE id = $1', [employee_id]);
  const u = uRes.rows[0] || {};

  const sql = `
    INSERT INTO hse_mcu_records (
      tenant_key, project_key, employee_id, employee_name, employee_nrp, employee_position,
      mcu_type, mcu_date, provider, fitness_result, restrictions, valid_until, doctor_name, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, employee_id,
    u.nama || null, u.nrp || null, u.jabatan || null,
    mcu_type, mcu_date, provider, fitness_result, restrictions, valid_until,
    doctor_name, notes, user.id,
  ]);

  return rows[0];
}

async function updateMcuRecord(db, scope, user, id, payload = {}) {
  const current = await db.query('SELECT * FROM hse_mcu_records WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL', [id, scope.tenantKey, scope.projectKey]);
  if (!current.rows[0]) {
    const err = new Error('Data MCU tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const {
    fitness_result = current.rows[0].fitness_result,
    restrictions = current.rows[0].restrictions,
    valid_until = current.rows[0].valid_until,
    notes = current.rows[0].notes,
  } = payload;

  const sql = `
    UPDATE hse_mcu_records
    SET fitness_result = $1, restrictions = $2, valid_until = $3, notes = $4, updated_at = CURRENT_TIMESTAMP
    WHERE id = $5 AND tenant_key = $6 AND project_key = $7
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    fitness_result, restrictions, valid_until, notes,
    id, scope.tenantKey, scope.projectKey
  ]);

  return rows[0];
}

async function listFfwChecks(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE f.tenant_key = $1 AND f.project_key = $2 AND f.deleted_at IS NULL`;

  if (query.check_date) {
    params.push(query.check_date);
    where += ` AND f.check_date = $${params.length}`;
  }

  if (query.shift) {
    params.push(query.shift);
    where += ` AND f.shift = $${params.length}`;
  }

  if (query.result) {
    params.push(query.result);
    where += ` AND f.result = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const s = `$${params.length}`;
    where += ` AND (f.employee_name ILIKE ${s} OR f.employee_nrp ILIKE ${s} OR u.nama ILIKE ${s})`;
  }

  const sql = `
    SELECT
      f.*,
      COALESCE(u.nama, f.employee_name) AS employee_name,
      COALESCE(u.employee_id, f.employee_nrp) AS employee_nrp,
      COALESCE(u.jabatan, f.employee_position) AS employee_position
    FROM hse_fit_for_work_checks f
    LEFT JOIN users u ON u.id = f.employee_id
    ${where}
    ORDER BY f.check_date DESC, f.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createFfwCheck(db, scope, user, payload = {}) {
  const {
    employee_id,
    check_date = new Date().toISOString().slice(0, 10),
    shift = 'SHIFT_1',
    sleep_hours = 7.0,
    blood_pressure = '120/80',
    heart_rate = 75,
    body_temperature = 36.5,
    self_declaration = {},
    result = 'FIT',
    action_taken = null,
    checked_by_name = user.nama || 'Petugas FFW',
    notes = null,
  } = payload;

  if (!employee_id) {
    const err = new Error('Field employee_id wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  let finalResult = result;
  let finalAction = action_taken;
  if (Number(sleep_hours) < 5.0 && result === 'FIT') {
    finalResult = 'UNFIT';
    finalAction = finalAction || 'Jam tidur < 5 jam (fatigue risk). Istirahat minimal 2 jam.';
  }

  const uRes = await db.query('SELECT nama, employee_id as nrp, jabatan FROM users WHERE id = $1', [employee_id]);
  const u = uRes.rows[0] || {};

  const sql = `
    INSERT INTO hse_fit_for_work_checks (
      tenant_key, project_key, employee_id, employee_name, employee_nrp, employee_position,
      check_date, shift, sleep_hours, blood_pressure, heart_rate, body_temperature,
      self_declaration, result, action_taken, checked_by_id, checked_by_name, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, employee_id,
    u.nama || null, u.nrp || null, u.jabatan || null,
    check_date, shift, sleep_hours, blood_pressure, heart_rate, body_temperature,
    JSON.stringify(self_declaration), finalResult, finalAction,
    user.id, checked_by_name, notes,
  ]);

  return rows[0];
}

async function listSubstanceTests(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE s.tenant_key = $1 AND s.project_key = $2 AND s.deleted_at IS NULL`;

  if (query.test_type) {
    params.push(query.test_type);
    where += ` AND s.test_type = $${params.length}`;
  }

  if (query.overall_result) {
    params.push(query.overall_result);
    where += ` AND s.overall_result = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const qStr = `$${params.length}`;
    where += ` AND (s.employee_name ILIKE ${qStr} OR s.employee_nrp ILIKE ${qStr} OR u.nama ILIKE ${qStr})`;
  }

  const sql = `
    SELECT
      s.*,
      COALESCE(u.nama, s.employee_name) AS employee_name,
      COALESCE(u.employee_id, s.employee_nrp) AS employee_nrp,
      COALESCE(u.jabatan, s.employee_position) AS employee_position
    FROM hse_substance_tests s
    LEFT JOIN users u ON u.id = s.employee_id
    ${where}
    ORDER BY s.test_date DESC, s.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createSubstanceTest(db, scope, user, payload = {}) {
  const {
    employee_id,
    test_date = new Date().toISOString().slice(0, 10),
    test_type = 'ALCOHOL',
    trigger_reason = 'RANDOM',
    alcohol_level = 0.000,
    drug_panel_result = 'NEGATIVE',
    overall_result = 'NEGATIVE',
    tested_by_name = user.nama || 'Petugas Medis',
    witness_name = null,
    action_taken = null,
    notes = null,
  } = payload;

  if (!employee_id) {
    const err = new Error('Field employee_id wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const uRes = await db.query('SELECT nama, employee_id as nrp, jabatan FROM users WHERE id = $1', [employee_id]);
  const u = uRes.rows[0] || {};

  const sql = `
    INSERT INTO hse_substance_tests (
      tenant_key, project_key, employee_id, employee_name, employee_nrp, employee_position,
      test_date, test_type, trigger_reason, alcohol_level, drug_panel_result, overall_result,
      tested_by_id, tested_by_name, witness_name, action_taken, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, employee_id,
    u.nama || null, u.nrp || null, u.jabatan || null,
    test_date, test_type, trigger_reason, alcohol_level, drug_panel_result, overall_result,
    user.id, tested_by_name, witness_name, action_taken, notes,
  ]);

  return rows[0];
}

async function listHealthCases(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE c.tenant_key = $1 AND c.project_key = $2 AND c.deleted_at IS NULL`;

  if (query.case_type) {
    params.push(query.case_type);
    where += ` AND c.case_type = $${params.length}`;
  }

  if (query.status) {
    params.push(query.status);
    where += ` AND c.status = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const qStr = `$${params.length}`;
    where += ` AND (c.case_no ILIKE ${qStr} OR c.diagnosis_summary ILIKE ${qStr} OR c.employee_name ILIKE ${qStr} OR u.nama ILIKE ${qStr})`;
  }

  const sql = `
    SELECT
      c.*,
      COALESCE(u.nama, c.employee_name) AS employee_name,
      COALESCE(u.employee_id, c.employee_nrp) AS employee_nrp,
      COALESCE(u.jabatan, c.employee_position) AS employee_position
    FROM hse_health_cases c
    LEFT JOIN users u ON u.id = c.employee_id
    ${where}
    ORDER BY c.case_date DESC, c.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createHealthCase(db, scope, user, payload = {}) {
  const {
    employee_id,
    case_date = new Date().toISOString().slice(0, 10),
    case_type = 'COMPLAINT',
    is_work_related = false,
    diagnosis_summary,
    treatment = null,
    lost_days = 0,
    medic_name = user.nama || 'dr. Site Clinic',
    notes = null,
  } = payload;

  if (!employee_id || !diagnosis_summary) {
    const err = new Error('Field employee_id dan diagnosis_summary wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const caseNo = await nextSequence(db, scope, 'hse_health_cases', 'MED', new Date(case_date));

  const uRes = await db.query('SELECT nama, employee_id as nrp, jabatan FROM users WHERE id = $1', [employee_id]);
  const u = uRes.rows[0] || {};

  const sql = `
    INSERT INTO hse_health_cases (
      tenant_key, project_key, case_no, employee_id, employee_name, employee_nrp, employee_position,
      case_date, case_type, is_work_related, diagnosis_summary, treatment, lost_days, medic_name, status, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'OPEN', $15, $16)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, caseNo, employee_id,
    u.nama || null, u.nrp || null, u.jabatan || null,
    case_date, case_type, Boolean(is_work_related), diagnosis_summary, treatment, Number(lost_days) || 0,
    medic_name, notes, user.id,
  ]);

  return rows[0];
}

async function updateHealthCase(db, scope, user, id, payload = {}) {
  const current = await db.query('SELECT * FROM hse_health_cases WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL', [id, scope.tenantKey, scope.projectKey]);
  if (!current.rows[0]) {
    const err = new Error('Kasus kesehatan tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const {
    status = current.rows[0].status,
    treatment = current.rows[0].treatment,
    lost_days = current.rows[0].lost_days,
    notes = current.rows[0].notes,
  } = payload;

  const sql = `
    UPDATE hse_health_cases
    SET status = $1, treatment = $2, lost_days = $3, notes = $4, updated_at = CURRENT_TIMESTAMP
    WHERE id = $5 AND tenant_key = $6 AND project_key = $7
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    status, treatment, Number(lost_days) || 0, notes,
    id, scope.tenantKey, scope.projectKey,
  ]);

  return rows[0];
}

async function listHygieneMeasurements(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  let where = `WHERE h.tenant_key = $1 AND h.project_key = $2 AND h.deleted_at IS NULL`;

  if (query.parameter) {
    params.push(query.parameter);
    where += ` AND h.parameter = $${params.length}`;
  }

  if (query.status) {
    params.push(query.status);
    where += ` AND h.status = $${params.length}`;
  }

  if (query.location_id) {
    params.push(query.location_id);
    where += ` AND h.location_id = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const qStr = `$${params.length}`;
    where += ` AND (h.sampling_point ILIKE ${qStr} OR h.location_name ILIKE ${qStr} OR l.name ILIKE ${qStr})`;
  }

  const sql = `
    SELECT
      h.*,
      COALESCE(l.name, h.location_name) AS location_name
    FROM hse_hygiene_measurements h
    LEFT JOIN hse_locations l ON l.id = h.location_id
    ${where}
    ORDER BY h.measured_at DESC, h.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createHygieneMeasurement(db, scope, user, payload = {}) {
  const {
    location_id = null,
    sampling_point,
    parameter,
    measured_at = new Date().toISOString().slice(0, 10),
    measured_value,
    unit,
    threshold_nab,
    instrument_used = null,
    measured_by = user.nama || 'Hygiene Inspector',
    mitigation_required = null,
  } = payload;

  if (!sampling_point || !parameter || measured_value == null || threshold_nab == null || !unit) {
    const err = new Error('Field sampling_point, parameter, measured_value, threshold_nab, dan unit wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const val = Number(measured_value);
  const nab = Number(threshold_nab);

  let status = 'OK';
  if (parameter === 'LIGHTING') {
    if (val < nab) status = 'EXCEEDED';
    else if (val < nab * 1.1) status = 'NEAR_LIMIT';
    else status = 'OK';
  } else {
    if (val > nab) status = 'EXCEEDED';
    else if (val >= nab * 0.9) status = 'NEAR_LIMIT';
    else status = 'OK';
  }

  let locationName = null;
  if (location_id) {
    const lRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [location_id]);
    locationName = lRes.rows[0]?.name || null;
  }

  const sql = `
    INSERT INTO hse_hygiene_measurements (
      tenant_key, project_key, location_id, location_name, sampling_point, parameter,
      measured_at, measured_value, unit, threshold_nab, status, instrument_used, measured_by, mitigation_required
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, location_id, locationName, sampling_point, parameter,
    measured_at, val, unit, nab, status, instrument_used, measured_by, mitigation_required,
  ]);

  return rows[0];
}

// ============================================================================
// FASE 6: TANGGAP DARURAT (EMERGENCY RESPONSE) & APD / PERALATAN (PPE)
// ============================================================================

// 1. Emergency Overview
async function getEmergencyOverview(db, scope) {
  const teamRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_team,
      COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_team,
      COUNT(*) FILTER (WHERE role = 'COMMANDER' AND is_active = TRUE)::int AS commander_count,
      COUNT(*) FILTER (WHERE role = 'FIRE_FIGHTER' AND is_active = TRUE)::int AS firefighter_count,
      COUNT(*) FILTER (WHERE role = 'FIRST_AIDER' AND is_active = TRUE)::int AS firstaider_count,
      COUNT(*) FILTER (WHERE role = 'RESCUE' AND is_active = TRUE)::int AS rescue_count
    FROM hse_emergency_team_members
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const drillRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_drills_ytd,
      AVG(response_time_sec)::int AS avg_response_time_sec,
      COUNT(*) FILTER (WHERE result = 'GOOD')::int AS good_result,
      COUNT(*) FILTER (WHERE result = 'ADEQUATE')::int AS adequate_result,
      COUNT(*) FILTER (WHERE result = 'NEEDS_IMPROVEMENT')::int AS needs_improvement
    FROM hse_emergency_drills
    WHERE tenant_key = $1 AND project_key = $2
      AND drill_date >= DATE_TRUNC('year', CURRENT_DATE)
      AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const eqRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_equipment,
      COUNT(*) FILTER (WHERE status = 'DEFECTIVE')::int AS defective_count,
      COUNT(*) FILTER (WHERE status = 'RETIRED')::int AS retired_count,
      COUNT(*) FILTER (WHERE status NOT IN ('DEFECTIVE', 'RETIRED') AND next_inspection_date < CURRENT_DATE)::int AS overdue_inspection,
      COUNT(*) FILTER (WHERE status NOT IN ('DEFECTIVE', 'RETIRED') AND next_inspection_date >= CURRENT_DATE AND next_inspection_date <= CURRENT_DATE + INTERVAL '7 days')::int AS due_inspection,
      COUNT(*) FILTER (WHERE status NOT IN ('DEFECTIVE', 'RETIRED') AND (next_inspection_date IS NULL OR next_inspection_date > CURRENT_DATE + INTERVAL '7 days'))::int AS good_count
    FROM hse_emergency_equipment
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const assemblyRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_assembly_points,
      COALESCE(SUM(capacity_persons), 0)::int AS total_capacity
    FROM hse_emergency_assembly_points
    WHERE tenant_key = $1 AND project_key = $2 AND is_active = TRUE AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const contactRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_contacts,
      COUNT(*) FILTER (WHERE category = 'INTERNAL')::int AS internal_contacts,
      COUNT(*) FILTER (WHERE category != 'INTERNAL')::int AS external_contacts
    FROM hse_emergency_contacts
    WHERE tenant_key = $1 AND project_key = $2 AND is_active = TRUE AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  return {
    team: teamRes.rows[0] || {},
    drills: drillRes.rows[0] || {},
    equipment: eqRes.rows[0] || {},
    assembly: assemblyRes.rows[0] || {},
    contacts: contactRes.rows[0] || {},
  };
}

// 2. Tim Tanggap Darurat (ERT Members)
async function listEmergencyTeam(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.role) {
    params.push(query.role);
    conditions.push(`role = $${params.length}`);
  }
  if (query.is_active !== undefined && query.is_active !== '') {
    params.push(query.is_active === 'true' || query.is_active === true);
    conditions.push(`is_active = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(employee_name ILIKE $${params.length} OR employee_nrp ILIKE $${params.length} OR department_name ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_emergency_team_members
    WHERE ${conditions.join(' AND ')}
    ORDER BY CASE role
      WHEN 'COMMANDER' THEN 1
      WHEN 'FIRE_FIGHTER' THEN 2
      WHEN 'FIRST_AIDER' THEN 3
      WHEN 'RESCUE' THEN 4
      WHEN 'COMMUNICATION' THEN 5
      ELSE 6
    END ASC, employee_name ASC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createEmergencyTeamMember(db, scope, user, payload) {
  const {
    employee_id, employee_name, employee_nrp, department_name, position_name,
    role = 'RESCUE', certifications, shift = 'SHIFT_1', phone_no, is_active = true, notes
  } = payload;

  let finalName = employee_name;
  let finalNrp = employee_nrp;
  let finalDept = department_name;
  let finalPos = position_name;

  if (employee_id && !finalName) {
    const uRes = await db.query('SELECT nama, nrp, departemen, jabatan FROM users WHERE id = $1', [employee_id]);
    if (uRes.rows[0]) {
      finalName = uRes.rows[0].nama;
      finalNrp = finalNrp || uRes.rows[0].nrp;
      finalDept = finalDept || uRes.rows[0].departemen;
      finalPos = finalPos || uRes.rows[0].jabatan;
    }
  }

  if (!finalName) {
    const err = new Error('Nama personil ERT wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const sql = `
    INSERT INTO hse_emergency_team_members (
      tenant_key, project_key, employee_id, employee_name, employee_nrp,
      department_name, position_name, role, certifications, shift, phone_no,
      is_active, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, employee_id || null, finalName, finalNrp || null,
    finalDept || null, finalPos || null, role, certifications || null, shift, phone_no || null,
    is_active, notes || null, user.id || null
  ]);

  return rows[0];
}

async function updateEmergencyTeamMember(db, scope, user, id, payload) {
  const {
    role, certifications, shift, phone_no, is_active, notes
  } = payload;

  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [id, scope.tenantKey, scope.projectKey];

  if (role !== undefined) {
    params.push(role);
    sets.push(`role = $${params.length}`);
  }
  if (certifications !== undefined) {
    params.push(certifications);
    sets.push(`certifications = $${params.length}`);
  }
  if (shift !== undefined) {
    params.push(shift);
    sets.push(`shift = $${params.length}`);
  }
  if (phone_no !== undefined) {
    params.push(phone_no);
    sets.push(`phone_no = $${params.length}`);
  }
  if (is_active !== undefined) {
    params.push(is_active);
    sets.push(`is_active = $${params.length}`);
  }
  if (notes !== undefined) {
    params.push(notes);
    sets.push(`notes = $${params.length}`);
  }

  const sql = `
    UPDATE hse_emergency_team_members
    SET ${sets.join(', ')}
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
    RETURNING *
  `;

  const { rows } = await db.query(sql, params);
  if (!rows[0]) {
    const err = new Error('Anggota tim ERT tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

// 3. Simulasi & Latihan (Emergency Drills)
async function listEmergencyDrills(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.scenario) {
    params.push(query.scenario);
    conditions.push(`scenario = $${params.length}`);
  }
  if (query.result) {
    params.push(query.result);
    conditions.push(`result = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(drill_no ILIKE $${params.length} OR scenario_title ILIKE $${params.length} OR location_name ILIKE $${params.length})`);
  }

  const sql = `
    SELECT d.*, a.action_no, a.status AS action_status
    FROM hse_emergency_drills d
    LEFT JOIN hse_actions a ON a.id = d.action_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY d.drill_date DESC, d.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createEmergencyDrill(db, scope, user, payload) {
  const {
    drill_date = new Date().toISOString().split('T')[0],
    scenario, scenario_title, location_id, location_name,
    participant_count = 0, response_time_sec, evaluation, result = 'ADEQUATE',
    report_url, action_id
  } = payload;

  if (!scenario || !scenario_title) {
    const err = new Error('Skenario dan judul drill wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const drillNo = await nextSequence(db, scope, 'hse_emergency_drills', 'DRL', new Date(drill_date));

  let finalLocName = location_name;
  if (location_id && !finalLocName) {
    const lRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [location_id]);
    finalLocName = lRes.rows[0]?.name || null;
  }

  const sql = `
    INSERT INTO hse_emergency_drills (
      tenant_key, project_key, drill_no, drill_date, scenario, scenario_title,
      location_id, location_name, participant_count, response_time_sec, evaluation,
      result, report_url, action_id, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, drillNo, drill_date, scenario, scenario_title,
    location_id || null, finalLocName || null, Number(participant_count) || 0,
    response_time_sec !== undefined && response_time_sec !== '' ? Number(response_time_sec) : null,
    evaluation || null, result, report_url || null, action_id || null, user.id || null
  ]);

  return rows[0];
}

// 4. Peralatan Darurat (Emergency Equipment)
async function listEmergencyEquipment(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.equipment_type) {
    params.push(query.equipment_type);
    conditions.push(`equipment_type = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(equipment_code ILIKE $${params.length} OR serial_no ILIKE $${params.length} OR location_name ILIKE $${params.length})`);
  }

  const sql = `
    SELECT
      id, tenant_key, project_key, equipment_code, equipment_type, serial_no,
      location_id, location_name, capacity, last_inspection_date, next_inspection_date,
      content_expiry_date, inspector_name, notes, created_at, updated_at,
      CASE
        WHEN status IN ('DEFECTIVE', 'RETIRED') THEN status
        WHEN next_inspection_date < CURRENT_DATE THEN 'OVERDUE'
        WHEN next_inspection_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'DUE'
        ELSE status
      END AS computed_status,
      status AS recorded_status
    FROM hse_emergency_equipment
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE
        WHEN status = 'DEFECTIVE' THEN 1
        WHEN next_inspection_date < CURRENT_DATE THEN 2
        WHEN next_inspection_date <= CURRENT_DATE + INTERVAL '7 days' THEN 3
        ELSE 4
      END ASC, equipment_code ASC
  `;

  const { rows } = await db.query(sql, params);
  return rows.map(r => ({
    ...r,
    status: r.computed_status,
  }));
}

async function createEmergencyEquipment(db, scope, user, payload) {
  const {
    equipment_code, equipment_type, serial_no, location_id, location_name,
    capacity, last_inspection_date, next_inspection_date, content_expiry_date,
    status = 'GOOD', inspector_name, notes
  } = payload;

  if (!equipment_code || !equipment_type) {
    const err = new Error('Kode alat dan tipe peralatan darurat wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalLocName = location_name;
  if (location_id && !finalLocName) {
    const lRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [location_id]);
    finalLocName = lRes.rows[0]?.name || null;
  }

  // Evaluasi status awal jika next_inspection_date lewat
  let finalStatus = status;
  if (status !== 'DEFECTIVE' && status !== 'RETIRED') {
    if (next_inspection_date) {
      const today = new Date().toISOString().split('T')[0];
      if (next_inspection_date < today) finalStatus = 'OVERDUE';
    }
  }

  const sql = `
    INSERT INTO hse_emergency_equipment (
      tenant_key, project_key, equipment_code, equipment_type, serial_no,
      location_id, location_name, capacity, last_inspection_date, next_inspection_date,
      content_expiry_date, status, inspector_name, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, equipment_code, equipment_type, serial_no || null,
    location_id || null, finalLocName || '-', capacity || null,
    last_inspection_date || null, next_inspection_date || null, content_expiry_date || null,
    finalStatus, inspector_name || null, notes || null, user.id || null
  ]);

  return rows[0];
}

async function updateEmergencyEquipment(db, scope, user, id, payload) {
  const {
    location_id, location_name, capacity, last_inspection_date, next_inspection_date,
    content_expiry_date, status, inspector_name, notes
  } = payload;

  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [id, scope.tenantKey, scope.projectKey];

  if (location_id !== undefined) {
    params.push(location_id || null);
    sets.push(`location_id = $${params.length}`);
  }
  if (location_name !== undefined) {
    params.push(location_name);
    sets.push(`location_name = $${params.length}`);
  }
  if (capacity !== undefined) {
    params.push(capacity);
    sets.push(`capacity = $${params.length}`);
  }
  if (last_inspection_date !== undefined) {
    params.push(last_inspection_date || null);
    sets.push(`last_inspection_date = $${params.length}`);
  }
  if (next_inspection_date !== undefined) {
    params.push(next_inspection_date || null);
    sets.push(`next_inspection_date = $${params.length}`);
  }
  if (content_expiry_date !== undefined) {
    params.push(content_expiry_date || null);
    sets.push(`content_expiry_date = $${params.length}`);
  }
  if (status !== undefined) {
    params.push(status);
    sets.push(`status = $${params.length}`);
  }
  if (inspector_name !== undefined) {
    params.push(inspector_name);
    sets.push(`inspector_name = $${params.length}`);
  }
  if (notes !== undefined) {
    params.push(notes);
    sets.push(`notes = $${params.length}`);
  }

  const sql = `
    UPDATE hse_emergency_equipment
    SET ${sets.join(', ')}
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
    RETURNING *
  `;

  const { rows } = await db.query(sql, params);
  if (!rows[0]) {
    const err = new Error('Peralatan darurat tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

// 5. Titik Kumpul Evakuasi (Assembly Points)
async function listEmergencyAssemblyPoints(db, scope) {
  const sql = `
    SELECT *
    FROM hse_emergency_assembly_points
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
    ORDER BY code ASC
  `;
  const { rows } = await db.query(sql, [scope.tenantKey, scope.projectKey]);
  return rows;
}

async function createEmergencyAssemblyPoint(db, scope, user, payload) {
  const {
    code, name, location_id, location_name, capacity_persons = 50,
    warden_name, map_url, is_active = true, notes
  } = payload;

  if (!code || !name) {
    const err = new Error('Kode dan nama titik kumpul wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalLocName = location_name;
  if (location_id && !finalLocName) {
    const lRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [location_id]);
    finalLocName = lRes.rows[0]?.name || null;
  }

  const sql = `
    INSERT INTO hse_emergency_assembly_points (
      tenant_key, project_key, code, name, location_id, location_name,
      capacity_persons, warden_name, map_url, is_active, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, code, name, location_id || null, finalLocName || '-',
    Number(capacity_persons) || 50, warden_name || null, map_url || null, is_active, notes || null, user.id || null
  ]);

  return rows[0];
}

// 6. Kontak Darurat (Emergency Contacts)
async function listEmergencyContacts(db, scope) {
  const sql = `
    SELECT *
    FROM hse_emergency_contacts
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
    ORDER BY CASE category
      WHEN 'INTERNAL' THEN 1
      WHEN 'CLINIC' THEN 2
      WHEN 'HOSPITAL' THEN 3
      WHEN 'FIRE_DEPT' THEN 4
      WHEN 'POLICE' THEN 5
      ELSE 6
    END ASC, name ASC
  `;
  const { rows } = await db.query(sql, [scope.tenantKey, scope.projectKey]);
  return rows;
}

async function createEmergencyContact(db, scope, user, payload) {
  const {
    category = 'INTERNAL', name, phone_no, alternate_phone, address, is_active = true, notes
  } = payload;

  if (!name || !phone_no) {
    const err = new Error('Nama instansi/kontak dan nomor telepon wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const sql = `
    INSERT INTO hse_emergency_contacts (
      tenant_key, project_key, category, name, phone_no, alternate_phone,
      address, is_active, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, category, name, phone_no,
    alternate_phone || null, address || null, is_active, notes || null, user.id || null
  ]);

  return rows[0];
}

// 7. PPE Overview
async function getPpeOverview(db, scope) {
  const itemRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_items,
      COUNT(*) FILTER (WHERE current_stock <= minimum_stock)::int AS critical_stock_count,
      COALESCE(SUM(current_stock), 0)::int AS total_stock_on_hand
    FROM hse_ppe_items
    WHERE tenant_key = $1 AND project_key = $2 AND is_active = TRUE AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const issuanceRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_issuances,
      COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_issuances,
      COUNT(*) FILTER (WHERE status = 'ACTIVE' AND replace_due_date <= CURRENT_DATE + INTERVAL '30 days')::int AS due_replacement_count,
      COUNT(*) FILTER (WHERE status = 'ACTIVE' AND replace_due_date < CURRENT_DATE)::int AS overdue_replacement_count
    FROM hse_ppe_issuances
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const stdRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_standards,
      COUNT(DISTINCT position_name)::int AS covered_positions
    FROM hse_ppe_standards
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  return {
    items: itemRes.rows[0] || {},
    issuances: issuanceRes.rows[0] || {},
    standards: stdRes.rows[0] || {},
  };
}

// 8. Master Katalog APD (PPE Items)
async function listPpeItems(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.category) {
    params.push(query.category);
    conditions.push(`category = $${params.length}`);
  }
  if (query.is_critical === 'true') {
    conditions.push(`current_stock <= minimum_stock`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length} OR standard_specification ILIKE $${params.length})`);
  }

  const sql = `
    SELECT
      id, tenant_key, project_key, code, name, category, replace_interval_months,
      standard_specification, inventory_item_id, current_stock, minimum_stock, unit,
      is_active, created_at, updated_at,
      CASE WHEN current_stock <= minimum_stock THEN TRUE ELSE FALSE END AS is_critical_stock
    FROM hse_ppe_items
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE WHEN current_stock <= minimum_stock THEN 1 ELSE 2 END ASC,
      name ASC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createPpeItem(db, scope, user, payload) {
  const {
    code, name, category = 'HEAD', replace_interval_months = 12, standard_specification,
    inventory_item_id, current_stock = 0, minimum_stock = 10, unit = 'PCS', is_active = true
  } = payload;

  if (!code || !name) {
    const err = new Error('Kode dan nama APD wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const sql = `
    INSERT INTO hse_ppe_items (
      tenant_key, project_key, code, name, category, replace_interval_months,
      standard_specification, inventory_item_id, current_stock, minimum_stock,
      unit, is_active, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, code, name, category,
    Number(replace_interval_months) || 12, standard_specification || null,
    inventory_item_id || null, Number(current_stock) || 0, Number(minimum_stock) || 0,
    unit, is_active, user.id || null
  ]);

  return rows[0];
}

// 9. Standar APD per Jabatan (PPE Standards)
async function listPpeStandards(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['s.tenant_key = $1', 's.project_key = $2', 's.deleted_at IS NULL'];

  if (query.position_name) {
    params.push(query.position_name);
    conditions.push(`s.position_name = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(s.position_name ILIKE $${params.length} OR i.name ILIKE $${params.length})`);
  }

  const sql = `
    SELECT
      s.*,
      i.code AS ppe_code,
      i.name AS ppe_name,
      i.category AS ppe_category,
      i.replace_interval_months,
      i.standard_specification
    FROM hse_ppe_standards s
    JOIN hse_ppe_items i ON i.id = s.ppe_item_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.position_name ASC, i.category ASC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createPpeStandard(db, scope, user, payload) {
  const {
    position_name, location_type = 'ALL', ppe_item_id,
    mandatory = true, quantity = 1, notes
  } = payload;

  if (!position_name || !ppe_item_id) {
    const err = new Error('Nama jabatan dan APD wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const sql = `
    INSERT INTO hse_ppe_standards (
      tenant_key, project_key, position_name, location_type, ppe_item_id,
      mandatory, quantity, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, position_name, location_type,
    ppe_item_id, mandatory, Number(quantity) || 1, notes || null, user.id || null
  ]);

  return rows[0];
}

// 10. Distribusi & Penyerahan APD (PPE Issuances)
async function listPpeIssuances(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.employee_id) {
    params.push(query.employee_id);
    conditions.push(`employee_id = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(employee_name ILIKE $${params.length} OR employee_nrp ILIKE $${params.length} OR ppe_item_name ILIKE $${params.length})`);
  }

  const sql = `
    SELECT
      id, tenant_key, project_key, employee_id, employee_name, employee_nrp,
      department_name, position_name, ppe_item_id, ppe_item_name, ppe_category,
      size, quantity, issued_date, replace_due_date, reason, returned_date,
      issued_by_name, notes, created_at,
      CASE
        WHEN status = 'ACTIVE' AND replace_due_date < CURRENT_DATE THEN 'DUE_REPLACEMENT'
        ELSE status
      END AS computed_status,
      status AS recorded_status
    FROM hse_ppe_issuances
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE
        WHEN status = 'ACTIVE' AND replace_due_date < CURRENT_DATE THEN 1
        WHEN status = 'ACTIVE' THEN 2
        ELSE 3
      END ASC,
      issued_date DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows.map(r => ({
    ...r,
    status: r.computed_status,
  }));
}

async function createPpeIssuance(db, scope, user, payload) {
  const {
    employee_id, employee_name, employee_nrp, department_name, position_name,
    ppe_item_id, ppe_item_name, ppe_category, size, quantity = 1,
    issued_date = new Date().toISOString().split('T')[0],
    replace_due_date, reason = 'NEW_HIRE', notes, issued_by_name
  } = payload;

  if (!employee_id || !ppe_item_id) {
    const err = new Error('Karyawan dan Item APD wajib dipilih');
    err.statusCode = 422;
    throw err;
  }

  let finalEmpName = employee_name;
  let finalEmpNrp = employee_nrp;
  let finalDept = department_name;
  let finalPos = position_name;

  if (!finalEmpName) {
    const uRes = await db.query('SELECT nama, nrp, departemen, jabatan FROM users WHERE id = $1', [employee_id]);
    if (uRes.rows[0]) {
      finalEmpName = uRes.rows[0].nama;
      finalEmpNrp = finalEmpNrp || uRes.rows[0].nrp;
      finalDept = finalDept || uRes.rows[0].departemen;
      finalPos = finalPos || uRes.rows[0].jabatan;
    }
  }

  let finalItemName = ppe_item_name;
  let finalCat = ppe_category;
  let intervalMonths = 12;

  const itemRes = await db.query('SELECT name, category, replace_interval_months, current_stock FROM hse_ppe_items WHERE id = $1', [ppe_item_id]);
  if (itemRes.rows[0]) {
    finalItemName = finalItemName || itemRes.rows[0].name;
    finalCat = finalCat || itemRes.rows[0].category;
    intervalMonths = itemRes.rows[0].replace_interval_months || 12;
  }

  let finalDueDate = replace_due_date;
  if (!finalDueDate) {
    const issDateObj = new Date(issued_date);
    issDateObj.setMonth(issDateObj.getMonth() + intervalMonths);
    finalDueDate = issDateObj.toISOString().split('T')[0];
  }

  const sql = `
    INSERT INTO hse_ppe_issuances (
      tenant_key, project_key, employee_id, employee_name, employee_nrp,
      department_name, position_name, ppe_item_id, ppe_item_name, ppe_category,
      size, quantity, issued_date, replace_due_date, reason, status,
      issued_by_name, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'ACTIVE', $16, $17, $18)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, employee_id, finalEmpName || 'Karyawan',
    finalEmpNrp || null, finalDept || null, finalPos || null,
    ppe_item_id, finalItemName || 'Item APD', finalCat || 'OTHER',
    size || null, Number(quantity) || 1, issued_date, finalDueDate,
    reason, issued_by_name || user.nama || 'Petugas HSE', notes || null, user.id || null
  ]);

  // Mengurangi stok item APD bila tersedia
  try {
    await db.query(`
      UPDATE hse_ppe_items
      SET current_stock = GREATEST(0, current_stock - $1), updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND tenant_key = $3 AND project_key = $4
    `, [Number(quantity) || 1, ppe_item_id, scope.tenantKey, scope.projectKey]);
  } catch (stockErr) {
    // Non-blocking log
    console.warn('Gagal update ppe current_stock:', stockErr.message);
  }

  return rows[0];
}

async function returnPpeIssuance(db, scope, user, id, payload = {}) {
  const { returned_date = new Date().toISOString().split('T')[0], notes } = payload;

  const sql = `
    UPDATE hse_ppe_issuances
    SET status = 'RETURNED', returned_date = $1, notes = COALESCE($2, notes), updated_at = CURRENT_TIMESTAMP
    WHERE id = $3 AND tenant_key = $4 AND project_key = $5 AND deleted_at IS NULL
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    returned_date, notes || null, id, scope.tenantKey, scope.projectKey
  ]);

  if (!rows[0]) {
    const err = new Error('Data penyerahan APD tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  return rows[0];
}

// ============================================================================
// FASE 7: KONTRAKTOR (CSMS) & LINGKUNGAN HIDUP
// ============================================================================

// 1. Contractor Overview
async function getContractorOverview(db, scope) {
  const ctrRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_contractors,
      COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_contractors,
      COALESCE(SUM(worker_count), 0)::int AS total_contractor_workers
    FROM hse_contractors
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const assRes = await db.query(`
    SELECT
      AVG(score)::numeric(5,1) AS avg_score,
      COUNT(*) FILTER (WHERE result = 'APPROVED')::int AS approved_count,
      COUNT(*) FILTER (WHERE result = 'CONDITIONAL')::int AS conditional_count,
      COUNT(*) FILTER (WHERE result = 'REJECTED')::int AS rejected_count
    FROM hse_contractor_assessments
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const docRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_docs,
      COUNT(*) FILTER (WHERE expiry_date < CURRENT_DATE)::int AS expired_docs,
      COUNT(*) FILTER (WHERE expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + INTERVAL '30 days')::int AS expiring_docs,
      COUNT(*) FILTER (WHERE expiry_date > CURRENT_DATE + INTERVAL '30 days')::int AS valid_docs
    FROM hse_contractor_documents
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const violRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_violations,
      COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_violations,
      COUNT(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical_violations
    FROM hse_contractor_violations
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  return {
    contractors: ctrRes.rows[0] || {},
    assessments: assRes.rows[0] || {},
    documents: docRes.rows[0] || {},
    violations: violRes.rows[0] || {},
  };
}

// 2. Daftar Kontraktor (Mitra Kerja)
async function listContractors(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['c.tenant_key = $1', 'c.project_key = $2', 'c.deleted_at IS NULL'];

  if (query.business_type) {
    params.push(query.business_type);
    conditions.push(`c.business_type = $${params.length}`);
  }
  if (query.is_active !== undefined && query.is_active !== '') {
    params.push(query.is_active === 'true' || query.is_active === true);
    conditions.push(`c.is_active = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(c.company_code ILIKE $${params.length} OR c.company_name ILIKE $${params.length} OR c.pic_name ILIKE $${params.length})`);
  }

  const sql = `
    SELECT
      c.*,
      (SELECT score FROM hse_contractor_assessments a WHERE a.contractor_id = c.id AND a.deleted_at IS NULL ORDER BY a.assessment_date DESC LIMIT 1) AS latest_score,
      (SELECT result FROM hse_contractor_assessments a WHERE a.contractor_id = c.id AND a.deleted_at IS NULL ORDER BY a.assessment_date DESC LIMIT 1) AS csms_status,
      (SELECT COUNT(*)::int FROM hse_contractor_violations v WHERE v.contractor_id = c.id AND v.status = 'OPEN' AND v.deleted_at IS NULL) AS open_violations_count,
      (SELECT COUNT(*)::int FROM hse_contractor_documents d WHERE d.contractor_id = c.id AND d.expiry_date < CURRENT_DATE AND d.deleted_at IS NULL) AS expired_docs_count
    FROM hse_contractors c
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.company_name ASC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createContractor(db, scope, user, payload) {
  const {
    company_code, company_name, business_type = 'HAULING',
    pic_name, pic_phone, pic_email, office_address, worker_count = 0, is_active = true, notes
  } = payload;

  if (!company_code || !company_name) {
    const err = new Error('Kode dan nama perusahaan kontraktor wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const sql = `
    INSERT INTO hse_contractors (
      tenant_key, project_key, company_code, company_name, business_type,
      pic_name, pic_phone, pic_email, office_address, worker_count, is_active, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, company_code.trim(), company_name.trim(), business_type,
    pic_name || null, pic_phone || null, pic_email || null, office_address || null,
    Number(worker_count) || 0, is_active, notes || null, user.id || null
  ]);

  return rows[0];
}

// 3. CSMS Assessments
async function listContractorAssessments(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.contractor_id) {
    params.push(query.contractor_id);
    conditions.push(`contractor_id = $${params.length}`);
  }
  if (query.result) {
    params.push(query.result);
    conditions.push(`result = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(contractor_name ILIKE $${params.length} OR assessor_name ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_contractor_assessments
    WHERE ${conditions.join(' AND ')}
    ORDER BY assessment_date DESC, created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createContractorAssessment(db, scope, user, payload) {
  const {
    contractor_id, contractor_name, assessment_date = new Date().toISOString().split('T')[0],
    assessment_type = 'PREQUALIFICATION', score = 0, assessor_name, valid_until, notes
  } = payload;

  if (!contractor_id) {
    const err = new Error('Kontraktor wajib dipilih');
    err.statusCode = 422;
    throw err;
  }

  let finalName = contractor_name;
  if (!finalName) {
    const cRes = await db.query('SELECT company_name FROM hse_contractors WHERE id = $1', [contractor_id]);
    finalName = cRes.rows[0]?.company_name || 'Kontraktor';
  }

  const numScore = Number(score) || 0;
  let result = 'REJECTED';
  if (numScore >= 75) result = 'APPROVED';
  else if (numScore >= 60) result = 'CONDITIONAL';

  let finalValidUntil = valid_until;
  if (!finalValidUntil) {
    const vDate = new Date(assessment_date);
    vDate.setFullYear(vDate.getFullYear() + (result === 'APPROVED' ? 1 : (result === 'CONDITIONAL' ? 0.5 : 0)));
    finalValidUntil = vDate.toISOString().split('T')[0];
  }

  const sql = `
    INSERT INTO hse_contractor_assessments (
      tenant_key, project_key, contractor_id, contractor_name, assessment_date,
      assessment_type, score, result, assessor_name, valid_until, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, contractor_id, finalName, assessment_date,
    assessment_type, numScore, result, assessor_name || null, finalValidUntil || null,
    notes || null, user.id || null
  ]);

  return rows[0];
}

// 4. Contractor Documents
async function listContractorDocuments(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.contractor_id) {
    params.push(query.contractor_id);
    conditions.push(`contractor_id = $${params.length}`);
  }
  if (query.doc_type) {
    params.push(query.doc_type);
    conditions.push(`doc_type = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(contractor_name ILIKE $${params.length} OR doc_no ILIKE $${params.length} OR title ILIKE $${params.length})`);
  }

  const sql = `
    SELECT
      id, tenant_key, project_key, contractor_id, contractor_name, doc_type,
      doc_no, title, issued_date, expiry_date, file_url, notes, created_at,
      CASE
        WHEN expiry_date < CURRENT_DATE THEN 'EXPIRED'
        WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'EXPIRING'
        ELSE 'VALID'
      END AS computed_status,
      status AS recorded_status
    FROM hse_contractor_documents
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE
        WHEN expiry_date < CURRENT_DATE THEN 1
        WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 2
        ELSE 3
      END ASC, expiry_date ASC
  `;

  const { rows } = await db.query(sql, params);
  return rows.map(r => ({
    ...r,
    status: r.computed_status,
  }));
}

async function createContractorDocument(db, scope, user, payload) {
  const {
    contractor_id, contractor_name, doc_type = 'SMK3', doc_no,
    title, issued_date, expiry_date, file_url, notes
  } = payload;

  if (!contractor_id || !doc_no || !title) {
    const err = new Error('Kontraktor, nomor dokumen, dan judul dokumen wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalName = contractor_name;
  if (!finalName) {
    const cRes = await db.query('SELECT company_name FROM hse_contractors WHERE id = $1', [contractor_id]);
    finalName = cRes.rows[0]?.company_name || 'Kontraktor';
  }

  let status = 'VALID';
  if (expiry_date) {
    const today = new Date().toISOString().split('T')[0];
    if (expiry_date < today) status = 'EXPIRED';
  }

  const sql = `
    INSERT INTO hse_contractor_documents (
      tenant_key, project_key, contractor_id, contractor_name, doc_type,
      doc_no, title, issued_date, expiry_date, file_url, status, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, contractor_id, finalName, doc_type,
    doc_no.trim(), title.trim(), issued_date || null, expiry_date || null,
    file_url || null, status, notes || null, user.id || null
  ]);

  return rows[0];
}

// 5. Contractor Violations
async function listContractorViolations(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['v.tenant_key = $1', 'v.project_key = $2', 'v.deleted_at IS NULL'];

  if (query.contractor_id) {
    params.push(query.contractor_id);
    conditions.push(`v.contractor_id = $${params.length}`);
  }
  if (query.severity) {
    params.push(query.severity);
    conditions.push(`v.severity = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`v.status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(v.contractor_name ILIKE $${params.length} OR v.description ILIKE $${params.length})`);
  }

  const sql = `
    SELECT v.*, a.action_no, a.status AS action_status
    FROM hse_contractor_violations v
    LEFT JOIN hse_actions a ON a.id = v.action_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY v.violation_date DESC, v.created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createContractorViolation(db, scope, user, payload) {
  const {
    contractor_id, contractor_name, violation_date = new Date().toISOString().split('T')[0],
    location_id, location_name, description, severity = 'MINOR',
    sanction = 'WARNING', action_id, reported_by, notes
  } = payload;

  if (!contractor_id || !description) {
    const err = new Error('Kontraktor dan deskripsi pelanggaran wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalName = contractor_name;
  if (!finalName) {
    const cRes = await db.query('SELECT company_name FROM hse_contractors WHERE id = $1', [contractor_id]);
    finalName = cRes.rows[0]?.company_name || 'Kontraktor';
  }

  let finalLocName = location_name;
  if (location_id && !finalLocName) {
    const lRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [location_id]);
    finalLocName = lRes.rows[0]?.name || null;
  }

  const sql = `
    INSERT INTO hse_contractor_violations (
      tenant_key, project_key, contractor_id, contractor_name, violation_date,
      location_id, location_name, description, severity, sanction, action_id,
      status, reported_by, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'OPEN', $12, $13, $14)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, contractor_id, finalName, violation_date,
    location_id || null, finalLocName || null, description.trim(), severity, sanction,
    action_id || null, reported_by || null, notes || null, user.id || null
  ]);

  return rows[0];
}

async function resolveContractorViolation(db, scope, user, id, payload = {}) {
  const sql = `
    UPDATE hse_contractor_violations
    SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, notes = COALESCE($1, notes), updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND tenant_key = $3 AND project_key = $4 AND deleted_at IS NULL
    RETURNING *
  `;

  const { rows } = await db.query(sql, [payload.notes || null, id, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) {
    const err = new Error('Pelanggaran kontraktor tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

// 6. Environment Overview
async function getEnvironmentOverview(db, scope) {
  const b3Res = await db.query(`
    SELECT
      COUNT(*)::int AS total_logs,
      COUNT(*) FILTER (WHERE status = 'STORED')::int AS stored_count,
      COUNT(*) FILTER (WHERE status = 'STORED' AND storage_deadline < CURRENT_DATE)::int AS overdue_deadline_count,
      COUNT(*) FILTER (WHERE status = 'STORED' AND storage_deadline >= CURRENT_DATE AND storage_deadline <= CURRENT_DATE + INTERVAL '14 days')::int AS due_deadline_count,
      COALESCE(SUM(quantity) FILTER (WHERE status = 'STORED'), 0)::numeric(10,1) AS total_stored_qty
    FROM hse_env_waste_b3_logs
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const measRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_measurements,
      COUNT(*) FILTER (WHERE status = 'COMPLIES')::int AS complies_count,
      COUNT(*) FILTER (WHERE status = 'NEAR_LIMIT')::int AS near_limit_count,
      COUNT(*) FILTER (WHERE status = 'EXCEEDED')::int AS exceeded_count
    FROM hse_env_measurements
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const recRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_records,
      COALESCE(SUM(planned_ha), 0)::numeric(8,2) AS total_planned_ha,
      COALESCE(SUM(actual_ha), 0)::numeric(8,2) AS total_actual_ha,
      COALESCE(SUM(trees_planted_count), 0)::int AS total_trees_planted
    FROM hse_env_reclamation_records
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  const ptRes = await db.query(`
    SELECT
      COUNT(*)::int AS total_points,
      COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_points
    FROM hse_env_monitoring_points
    WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
  `, [scope.tenantKey, scope.projectKey]);

  return {
    waste: b3Res.rows[0] || {},
    measurements: measRes.rows[0] || {},
    reclamation: recRes.rows[0] || {},
    points: ptRes.rows[0] || {},
  };
}

// 7. Limbah B3 (Waste B3 Logs)
async function listWasteB3Logs(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.waste_name) {
    params.push(`%${query.waste_name}%`);
    conditions.push(`waste_name ILIKE $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(waste_name ILIKE $${params.length} OR waste_code ILIKE $${params.length} OR manifest_no ILIKE $${params.length})`);
  }

  const sql = `
    SELECT
      id, tenant_key, project_key, log_date, waste_code, waste_name,
      source_location_id, source_location_name, quantity, unit,
      storage_location_id, storage_location_name, storage_deadline,
      hauler_company, manifest_no, hauled_date, status, pic_name, notes, created_at,
      CASE
        WHEN status = 'STORED' AND storage_deadline < CURRENT_DATE THEN 'OVERDUE'
        WHEN status = 'STORED' AND storage_deadline <= CURRENT_DATE + INTERVAL '14 days' THEN 'DUE'
        ELSE status
      END AS deadline_alert
    FROM hse_env_waste_b3_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE
        WHEN status = 'STORED' AND storage_deadline < CURRENT_DATE THEN 1
        WHEN status = 'STORED' THEN 2
        ELSE 3
      END ASC, log_date DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createWasteB3Log(db, scope, user, payload) {
  const {
    log_date = new Date().toISOString().split('T')[0], waste_code, waste_name,
    source_location_id, source_location_name, quantity = 0, unit = 'KG',
    storage_location_id, storage_location_name, storage_deadline,
    hauler_company, manifest_no, hauled_date, status = 'STORED', pic_name, notes
  } = payload;

  if (!waste_name || !source_location_id) {
    const err = new Error('Nama jenis limbah B3 dan sumber lokasi wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalSourceLoc = source_location_name;
  if (!finalSourceLoc && source_location_id) {
    const lRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [source_location_id]);
    finalSourceLoc = lRes.rows[0]?.name || 'Area Site';
  }

  let finalDeadline = storage_deadline;
  if (!finalDeadline) {
    const dObj = new Date(log_date);
    dObj.setDate(dObj.getDate() + 90); // default 90 hari izin TPS B3
    finalDeadline = dObj.toISOString().split('T')[0];
  }

  const sql = `
    INSERT INTO hse_env_waste_b3_logs (
      tenant_key, project_key, log_date, waste_code, waste_name,
      source_location_id, source_location_name, quantity, unit,
      storage_location_id, storage_location_name, storage_deadline,
      hauler_company, manifest_no, hauled_date, status, pic_name, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, log_date, waste_code || null, waste_name.trim(),
    source_location_id, finalSourceLoc, Number(quantity) || 0, unit,
    storage_location_id || null, storage_location_name || 'TPS Limbah B3 Site',
    finalDeadline, hauler_company || null, manifest_no || null, hauled_date || null,
    status, pic_name || null, notes || null, user.id || null
  ]);

  return rows[0];
}

// 8. Titik Pantau & Parameter Lingkungan
async function listEnvMonitoringPoints(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.media) {
    params.push(query.media);
    conditions.push(`media = $${params.length}`);
  }

  const sql = `
    SELECT *
    FROM hse_env_monitoring_points
    WHERE ${conditions.join(' AND ')}
    ORDER BY media ASC, point_code ASC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createEnvMonitoringPoint(db, scope, user, payload) {
  const {
    point_code, name, media = 'WATER', location_id, location_name,
    latitude, longitude, description
  } = payload;

  if (!point_code || !name) {
    const err = new Error('Kode dan nama titik pantau lingkungan wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalLocName = location_name;
  if (location_id && !finalLocName) {
    const lRes = await db.query('SELECT name FROM hse_locations WHERE id = $1', [location_id]);
    finalLocName = lRes.rows[0]?.name || null;
  }

  const sql = `
    INSERT INTO hse_env_monitoring_points (
      tenant_key, project_key, point_code, name, media, location_id, location_name,
      latitude, longitude, description, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, point_code.trim(), name.trim(), media,
    location_id || null, finalLocName || null,
    latitude !== undefined && latitude !== '' ? Number(latitude) : null,
    longitude !== undefined && longitude !== '' ? Number(longitude) : null,
    description || null, user.id || null
  ]);

  return rows[0];
}

async function listEnvParameters(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.media) {
    params.push(query.media);
    conditions.push(`media = $${params.length}`);
  }

  const sql = `
    SELECT *
    FROM hse_env_parameters
    WHERE ${conditions.join(' AND ')}
    ORDER BY media ASC, parameter_name ASC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

// 9. Pengukuran Kualitas Lingkungan (Measurements)
async function listEnvMeasurements(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.media) {
    params.push(query.media);
    conditions.push(`media = $${params.length}`);
  }
  if (query.point_id) {
    params.push(query.point_id);
    conditions.push(`point_id = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(point_name ILIKE $${params.length} OR parameter_name ILIKE $${params.length} OR lab_name ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_env_measurements
    WHERE ${conditions.join(' AND ')}
    ORDER BY measured_at DESC, created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createEnvMeasurement(db, scope, user, payload) {
  const {
    point_id, parameter_id, measured_at = new Date().toISOString().split('T')[0],
    measured_value, lab_name, report_no, report_url, pic_sampler, corrective_action
  } = payload;

  if (!point_id || !parameter_id || measured_value === undefined) {
    const err = new Error('Titik pantau, parameter, dan nilai hasil uji wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const val = Number(measured_value);

  // Ambil titik pantau
  const ptRes = await db.query('SELECT name, media FROM hse_env_monitoring_points WHERE id = $1', [point_id]);
  const pt = ptRes.rows[0];
  if (!pt) {
    const err = new Error('Titik pantau lingkungan tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  // Ambil parameter & batas baku mutu
  const pRes = await db.query('SELECT parameter_name, unit, limit_min, limit_max FROM hse_env_parameters WHERE id = $1', [parameter_id]);
  const param = pRes.rows[0];
  if (!param) {
    const err = new Error('Parameter lingkungan tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const limitMin = param.limit_min !== null ? Number(param.limit_min) : null;
  const limitMax = Number(param.limit_max);

  // Evaluasi status otomatis: COMPLIES, NEAR_LIMIT, EXCEEDED
  let status = 'COMPLIES';
  if (limitMin !== null) {
    // Parameter dengan rentang minimum & maksimum (mis. pH 6 - 9)
    if (val < limitMin || val > limitMax) {
      status = 'EXCEEDED';
    } else if (val <= limitMin + (limitMax - limitMin) * 0.1 || val >= limitMax - (limitMax - limitMin) * 0.1) {
      status = 'NEAR_LIMIT';
    } else {
      status = 'COMPLIES';
    }
  } else {
    // Parameter ambang atas (mis. TSS <= 200)
    if (val > limitMax) {
      status = 'EXCEEDED';
    } else if (val >= limitMax * 0.85) {
      status = 'NEAR_LIMIT';
    } else {
      status = 'COMPLIES';
    }
  }

  const sql = `
    INSERT INTO hse_env_measurements (
      tenant_key, project_key, point_id, point_name, parameter_id, parameter_name,
      media, measured_at, measured_value, unit, limit_min, limit_max, status,
      lab_name, report_no, report_url, pic_sampler, corrective_action, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, point_id, pt.name, parameter_id, param.parameter_name,
    pt.media, measured_at, val, param.unit, limitMin, limitMax, status,
    lab_name || null, report_no || null, report_url || null, pic_sampler || null,
    corrective_action || null, user.id || null
  ]);

  return rows[0];
}

// 10. Reklamasi Lahan Tambang (Reclamation Records)
async function listReclamationRecords(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.activity) {
    params.push(query.activity);
    conditions.push(`activity = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(area_name ILIKE $${params.length} OR tree_species ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_env_reclamation_records
    WHERE ${conditions.join(' AND ')}
    ORDER BY period_month DESC, created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createReclamationRecord(db, scope, user, payload) {
  const {
    area_name, activity = 'PLANTING', planned_ha = 0, actual_ha = 0,
    period_month = new Date().toISOString().slice(0, 7) + '-01',
    tree_species, trees_planted_count = 0, mortality_rate_percent = 0, notes
  } = payload;

  if (!area_name) {
    const err = new Error('Nama area reklamasi wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const sql = `
    INSERT INTO hse_env_reclamation_records (
      tenant_key, project_key, area_name, activity, planned_ha, actual_ha,
      period_month, tree_species, trees_planted_count, mortality_rate_percent, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, area_name.trim(), activity,
    Number(planned_ha) || 0, Number(actual_ha) || 0, period_month,
    tree_species || null, Number(trees_planted_count) || 0,
    Number(mortality_rate_percent) || 0, notes || null, user.id || null
  ]);

  return rows[0];
}

// ============================================================================
// FASE 8: AUDIT, SMKP MINERBA, DOKUMEN & REGULASI SERVICES
// ============================================================================

// 1. Audit Overview
async function getAuditOverview(db, scope) {
  const [auditsRes, findingsRes, smkpRes] = await Promise.all([
    db.query(`
      SELECT 
        COUNT(*)::int as total_audits,
        COUNT(CASE WHEN status = 'PLANNED' THEN 1 END)::int as planned_audits,
        COUNT(CASE WHEN status IN ('REPORTED', 'CLOSED') THEN 1 END)::int as completed_audits,
        ROUND(AVG(overall_score)::numeric, 1) as avg_score
      FROM hse_audits
      WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
    `, [scope.tenantKey, scope.projectKey]),
    db.query(`
      SELECT
        COUNT(*)::int as total_findings,
        COUNT(CASE WHEN status IN ('OPEN', 'IN_ACTION') THEN 1 END)::int as open_findings,
        COUNT(CASE WHEN category = 'MAJOR' THEN 1 END)::int as major_findings,
        COUNT(CASE WHEN status = 'CLOSED' THEN 1 END)::int as closed_findings
      FROM hse_audit_findings
      WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
    `, [scope.tenantKey, scope.projectKey]),
    db.query(`
      SELECT COUNT(*)::int as element_count FROM hse_smkp_elements
    `),
  ]);

  const a = auditsRes.rows[0] || {};
  const f = findingsRes.rows[0] || {};

  return {
    total_audits: a.total_audits || 0,
    planned_audits: a.planned_audits || 0,
    completed_audits: a.completed_audits || 0,
    avg_score: a.avg_score !== null ? Number(a.avg_score) : null,
    total_findings: f.total_findings || 0,
    open_findings: f.open_findings || 0,
    major_findings: f.major_findings || 0,
    closed_findings: f.closed_findings || 0,
    element_count: smkpRes.rows[0]?.element_count || 7,
  };
}

// 2. Audits (Program & Pelaksanaan Audit)
async function listAudits(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.audit_type) {
    params.push(query.audit_type);
    conditions.push(`audit_type = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    conditions.push(`(audit_no ILIKE $${params.length} OR title ILIKE $${params.length} OR scope ILIKE $${params.length} OR lead_auditor ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_audits
    WHERE ${conditions.join(' AND ')}
    ORDER BY audit_date_start DESC, created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createAudit(db, scope, user, payload) {
  const {
    audit_no, audit_type = 'INTERNAL', scope: auditScope, title,
    audit_date_start = new Date().toISOString().split('T')[0],
    audit_date_end, lead_auditor, auditor_team, overall_score,
    status = 'PLANNED', report_url, notes
  } = payload;

  const finalTitle = title || payload.audit_title;
  const finalScope = auditScope || payload.scope_standard;

  if (!finalTitle || !finalScope || !lead_auditor) {
    const err = new Error('Judul audit, lingkup/standar, dan lead auditor wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalNo = audit_no;
  if (!finalNo) {
    const countRes = await db.query(`SELECT COUNT(*)::int as c FROM hse_audits WHERE tenant_key = $1`, [scope.tenantKey]);
    const num = (countRes.rows[0]?.c || 0) + 1;
    finalNo = `AUD-${new Date().getFullYear().toString().slice(-2)}-${String(num).padStart(3, '0')}`;
  }

  const sql = `
    INSERT INTO hse_audits (
      tenant_key, project_key, audit_no, audit_type, scope, title,
      audit_date_start, audit_date_end, lead_auditor, auditor_team,
      overall_score, status, report_url, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, finalNo, audit_type, finalScope.trim(), finalTitle.trim(),
    audit_date_start, audit_date_end || audit_date_start, lead_auditor.trim(), auditor_team || null,
    overall_score !== undefined && overall_score !== '' ? Number(overall_score) : null,
    status, report_url || null, notes || null, user.id || null
  ]);

  return rows[0];
}

// 3. Audit Findings (Temuan Audit)
async function listAuditFindings(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.audit_id) {
    params.push(query.audit_id);
    conditions.push(`audit_id = $${params.length}`);
  }
  if (query.category) {
    params.push(query.category);
    conditions.push(`category = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    conditions.push(`(finding_no ILIKE $${params.length} OR element_or_clause ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_audit_findings
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createAuditFinding(db, scope, user, payload) {
  const {
    audit_id, finding_no, element_or_clause, category = 'MINOR',
    description, evidence, pic_name, due_date, status = 'OPEN',
    create_capa = false
  } = payload;

  const finalClause = element_or_clause || payload.clause_reference;
  const finalEvidence = evidence || payload.evidence_summary;

  if (!audit_id || !finalClause || !description) {
    const err = new Error('Audit, klausul/elemen, dan uraian temuan wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const aRes = await db.query(`SELECT audit_no FROM hse_audits WHERE id = $1`, [audit_id]);
  const auditNo = aRes.rows[0]?.audit_no || null;

  let finalNo = finding_no;
  if (!finalNo) {
    const cRes = await db.query(`SELECT COUNT(*)::int as c FROM hse_audit_findings WHERE tenant_key = $1`, [scope.tenantKey]);
    const num = (cRes.rows[0]?.c || 0) + 1;
    finalNo = `FND-${new Date().getFullYear().toString().slice(-2)}-${String(num).padStart(3, '0')}`;
  }

  let actionId = null;
  // Jika requested atau kategori MAJOR/MINOR, buat baris tindakan di hse_actions
  if (create_capa || category === 'MAJOR' || category === 'MINOR') {
    try {
      const actRes = await db.query(`
        INSERT INTO hse_actions (
          tenant_key, project_key, action_no, source_type, source_id, title,
          description, action_type, pic_name, due_date, status, created_by
        ) VALUES (
          $1, $2, $3, 'AUDIT', $4, $5, $6, 'CORRECTIVE', $7, $8, 'OPEN', $9
        ) RETURNING id
      `, [
        scope.tenantKey, scope.projectKey, `ACT-${finalNo}`, audit_id,
        `Tindakan Korektif Temuan Audit: ${finalNo}`, description.trim(),
        pic_name || null, due_date || null, user.id || null
      ]);
      actionId = actRes.rows[0]?.id || null;
    } catch (_) {
      // ignore action creation failure gracefully
    }
  }

  const sql = `
    INSERT INTO hse_audit_findings (
      tenant_key, project_key, audit_id, audit_no, finding_no, element_or_clause,
      category, description, evidence, action_id, pic_name, due_date, status, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, audit_id, auditNo, finalNo, element_or_clause.trim(),
    category, description.trim(), evidence || null, actionId, pic_name || null,
    due_date || null, status, user.id || null
  ]);

  return rows[0];
}

async function resolveAuditFinding(db, scope, user, id, payload = {}) {
  const sql = `
    UPDATE hse_audit_findings
    SET status = 'CLOSED', resolved_at = CURRENT_TIMESTAMP,
        resolution_notes = COALESCE($1, resolution_notes), updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND tenant_key = $3 AND project_key = $4 AND deleted_at IS NULL
    RETURNING *
  `;

  const { rows } = await db.query(sql, [payload.resolution_notes || null, id, scope.tenantKey, scope.projectKey]);
  if (!rows[0]) {
    const err = new Error('Temuan audit tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

// 4. Master Elemen SMKP Minerba
async function listSmkpElements(db) {
  const { rows } = await db.query(`SELECT * FROM hse_smkp_elements ORDER BY element_no ASC`);
  return rows;
}

// 5. Dokumen HSE Overview
async function getDocumentsOverview(db, scope) {
  const [docsRes, legRes, repRes] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int as total_docs,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::int as active_docs,
        COUNT(CASE WHEN status = 'UNDER_REVIEW' THEN 1 END)::int as under_review_docs,
        COUNT(CASE WHEN status = 'ACTIVE' AND next_review_date IS NOT NULL AND next_review_date <= (CURRENT_DATE + INTERVAL '30 days') THEN 1 END)::int as review_due_docs
      FROM hse_documents
      WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
    `, [scope.tenantKey, scope.projectKey]),
    db.query(`
      SELECT
        COUNT(*)::int as total_regulations,
        COUNT(CASE WHEN compliance_status = 'COMPLIANT' THEN 1 END)::int as compliant_regulations,
        COUNT(CASE WHEN compliance_status = 'PARTIAL' THEN 1 END)::int as partial_regulations,
        COUNT(CASE WHEN compliance_status = 'NON_COMPLIANT' THEN 1 END)::int as non_compliant_regulations
      FROM hse_legal_register
      WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
    `, [scope.tenantKey, scope.projectKey]),
    db.query(`
      SELECT
        COUNT(*)::int as total_reports,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END)::int as pending_reports,
        COUNT(CASE WHEN status = 'OVERDUE' OR (status = 'PENDING' AND deadline_date < CURRENT_DATE) THEN 1 END)::int as overdue_reports,
        COUNT(CASE WHEN status = 'VERIFIED' THEN 1 END)::int as verified_reports
      FROM hse_mandatory_reports
      WHERE tenant_key = $1 AND project_key = $2 AND deleted_at IS NULL
    `, [scope.tenantKey, scope.projectKey]),
  ]);

  const d = docsRes.rows[0] || {};
  const l = legRes.rows[0] || {};
  const r = repRes.rows[0] || {};

  return {
    total_docs: d.total_docs || 0,
    active_docs: d.active_docs || 0,
    under_review_docs: d.under_review_docs || 0,
    review_due_docs: d.review_due_docs || 0,
    total_regulations: l.total_regulations || 0,
    compliant_regulations: l.compliant_regulations || 0,
    partial_regulations: l.partial_regulations || 0,
    non_compliant_regulations: l.non_compliant_regulations || 0,
    total_reports: r.total_reports || 0,
    pending_reports: r.pending_reports || 0,
    overdue_reports: r.overdue_reports || 0,
    verified_reports: r.verified_reports || 0,
  };
}

// 6. Master Dokumen HSE
async function listDocuments(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.doc_type) {
    params.push(query.doc_type);
    conditions.push(`doc_type = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    conditions.push(`(doc_no ILIKE $${params.length} OR title ILIKE $${params.length} OR owner_name ILIKE $${params.length} OR tags ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_documents
    WHERE ${conditions.join(' AND ')}
    ORDER BY doc_no ASC, created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createDocument(db, scope, user, payload) {
  const {
    doc_no, title, doc_type = 'SOP', revision_no = 0, effective_date = new Date().toISOString().split('T')[0],
    next_review_date, owner_name, file_url, status = 'ACTIVE', tags, summary
  } = payload;

  const finalDocNo = doc_no || payload.doc_number;
  const finalOwner = owner_name || payload.owner || payload.owner_dept;

  if (!finalDocNo || !title || !finalOwner) {
    const err = new Error('Nomor dokumen, judul, dan pemilik/pengesah dokumen wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalReview = next_review_date;
  if (!finalReview) {
    const dObj = new Date(effective_date);
    dObj.setFullYear(dObj.getFullYear() + 1); // default review 1 tahun
    finalReview = dObj.toISOString().split('T')[0];
  }

  const sql = `
    INSERT INTO hse_documents (
      tenant_key, project_key, doc_no, title, doc_type, revision_no,
      effective_date, next_review_date, owner_name, file_url, status, tags, summary, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, finalDocNo.trim().toUpperCase(), title.trim(),
    doc_type, Number(revision_no) || 0, effective_date, finalReview,
    finalOwner.trim(), file_url || null, status, tags || null, summary || null, user.id || null
  ]);

  return rows[0];
}

async function createDocumentRevision(db, scope, user, documentId, payload) {
  const { change_summary, file_url, approved_by_name } = payload;

  if (!change_summary) {
    const err = new Error('Ringkasan perubahan revisi wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const docRes = await db.query(`
    SELECT revision_no FROM hse_documents
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
  `, [documentId, scope.tenantKey, scope.projectKey]);

  if (!docRes.rows[0]) {
    const err = new Error('Dokumen tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const nextRev = (docRes.rows[0].revision_no || 0) + 1;

  const revSql = `
    INSERT INTO hse_document_revisions (
      tenant_key, project_key, document_id, revision_no, change_summary,
      file_url, approved_by_name, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  const { rows } = await db.query(revSql, [
    scope.tenantKey, scope.projectKey, documentId, nextRev, change_summary.trim(),
    file_url || null, approved_by_name || null, user.id || null
  ]);

  // Update revision_no dan file_url di parent document
  await db.query(`
    UPDATE hse_documents
    SET revision_no = $1, file_url = COALESCE($2, file_url), updated_at = CURRENT_TIMESTAMP
    WHERE id = $3 AND tenant_key = $4 AND project_key = $5
  `, [nextRev, file_url || null, documentId, scope.tenantKey, scope.projectKey]);

  return rows[0];
}

// 7. Legal Register (Daftar Kepatuhan Regulasi K3LH)
async function listLegalRegister(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.issuer) {
    params.push(query.issuer);
    conditions.push(`issuer = $${params.length}`);
  }
  if (query.compliance_status) {
    params.push(query.compliance_status);
    conditions.push(`compliance_status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    conditions.push(`(regulation_no ILIKE $${params.length} OR regulation_title ILIKE $${params.length} OR requirement_summary ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_legal_register
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createLegalRegister(db, scope, user, payload) {
  const {
    regulation_title, regulation_no, issuer = 'ESDM_MINERBA', requirement_summary,
    is_applicable = true, compliance_status = 'COMPLIANT', pic_name,
    last_assessed_at = new Date().toISOString().split('T')[0], file_url, notes
  } = payload;

  const finalTitle = regulation_title || payload.title;
  const finalRegNo = regulation_no || payload.reg_number;
  const finalSummary = requirement_summary || payload.compliance_requirements;
  const finalIssuer = issuer || payload.issuing_body || 'ESDM_MINERBA';

  if (!finalTitle || !finalRegNo || !finalSummary) {
    const err = new Error('Judul regulasi, nomor regulasi, dan ringkasan persyaratan wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  const sql = `
    INSERT INTO hse_legal_register (
      tenant_key, project_key, regulation_title, regulation_no, issuer,
      requirement_summary, is_applicable, compliance_status, pic_name,
      last_assessed_at, file_url, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, finalTitle.trim(), finalRegNo.trim(),
    finalIssuer, finalSummary.trim(), is_applicable !== false, compliance_status,
    pic_name || null, last_assessed_at, file_url || null, notes || null, user.id || null
  ]);

  return rows[0];
}

// 8. Pelaporan Wajib Instansi (Mandatory Reports)
async function listMandatoryReports(db, scope, query = {}) {
  const params = [scope.tenantKey, scope.projectKey];
  const conditions = ['tenant_key = $1', 'project_key = $2', 'deleted_at IS NULL'];

  if (query.agency) {
    params.push(query.agency);
    conditions.push(`agency = $${params.length}`);
  }
  if (query.period_type) {
    params.push(query.period_type);
    conditions.push(`period_type = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    conditions.push(`(report_code ILIKE $${params.length} OR report_name ILIKE $${params.length} OR receipt_no ILIKE $${params.length})`);
  }

  const sql = `
    SELECT *
    FROM hse_mandatory_reports
    WHERE ${conditions.join(' AND ')}
    ORDER BY deadline_date ASC, created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createMandatoryReport(db, scope, user, payload) {
  const {
    report_code, report_name, agency = 'ESDM_KAIT', period_type = 'QUARTERLY',
    period_label, deadline_date, submission_date, receipt_no, file_url,
    status = 'PENDING', pic_name, notes
  } = payload;

  if (!report_name || !deadline_date || !period_label) {
    const err = new Error('Nama laporan, batas tenggat, dan label periode wajib diisi');
    err.statusCode = 422;
    throw err;
  }

  let finalCode = report_code;
  if (!finalCode) {
    const countRes = await db.query(`SELECT COUNT(*)::int as c FROM hse_mandatory_reports WHERE tenant_key = $1`, [scope.tenantKey]);
    const num = (countRes.rows[0]?.c || 0) + 1;
    finalCode = `REP-${agency.slice(0, 3)}-${String(num).padStart(3, '0')}`;
  }

  const sql = `
    INSERT INTO hse_mandatory_reports (
      tenant_key, project_key, report_code, report_name, agency, period_type,
      period_label, deadline_date, submission_date, receipt_no, file_url,
      status, pic_name, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey, scope.projectKey, finalCode, report_name.trim(), agency,
    period_type, period_label.trim(), deadline_date, submission_date || null,
    receipt_no || null, file_url || null, status, pic_name || null, notes || null, user.id || null
  ]);

  return rows[0];
}

async function updateMandatoryReportStatus(db, scope, user, id, payload = {}) {
  const { status = 'SUBMITTED', submission_date = new Date().toISOString().split('T')[0], receipt_no, file_url, notes } = payload;

  const sql = `
    UPDATE hse_mandatory_reports
    SET status = $1, submission_date = $2,
        receipt_no = COALESCE($3, receipt_no),
        file_url = COALESCE($4, file_url),
        notes = COALESCE($5, notes),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $6 AND tenant_key = $7 AND project_key = $8 AND deleted_at IS NULL
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    status, submission_date, receipt_no || null, file_url || null, notes || null,
    id, scope.tenantKey, scope.projectKey
  ]);

  if (!rows[0]) {
    const err = new Error('Laporan wajib tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  return rows[0];
}

// IBPR - Register Risiko (HIRADC)
async function getRiskRegisterOverview(db, scope) {
  const statsRes = await db.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE residual_level = 'EXTREME')::int AS extreme_count,
      COUNT(*) FILTER (WHERE residual_level = 'HIGH')::int AS high_count,
      COUNT(*) FILTER (WHERE residual_level = 'MEDIUM')::int AS medium_count,
      COUNT(*) FILTER (WHERE residual_level = 'LOW')::int AS low_count,
      COUNT(*) FILTER (WHERE review_date IS NOT NULL AND review_date <= CURRENT_DATE + INTERVAL '30 days')::int AS review_due_count
    FROM hse_risk_register
    WHERE deleted_at IS NULL
  `);

  const matrixRes = await db.query(`
    SELECT
      residual_likelihood AS l,
      residual_consequence AS c,
      COUNT(*)::int AS count
    FROM hse_risk_register
    WHERE deleted_at IS NULL
    GROUP BY residual_likelihood, residual_consequence
  `);

  const matrix = [];
  for (let l = 1; l <= 5; l++) {
    for (let c = 1; c <= 5; c++) {
      const score = l * c;
      let level = 'LOW';
      if (score >= 17) level = 'EXTREME';
      else if (score >= 10) level = 'HIGH';
      else if (score >= 5) level = 'MEDIUM';
      const row = matrixRes.rows.find(r => Number(r.l) === l && Number(r.c) === c);
      const count = row ? Number(row.count) : 0;
      matrix.push({ likelihood: l, consequence: c, score, level, count });
    }
  }

  const s = statsRes.rows[0] || {};
  return {
    total: s.total || 0,
    totalRisks: s.total || 0,
    extremeCount: s.extreme_count || 0,
    highCount: s.high_count || 0,
    mediumCount: s.medium_count || 0,
    lowCount: s.low_count || 0,
    reviewDueCount: s.review_due_count || 0,
    matrix,
  };
}

async function listRiskRegister(db, scope, query = {}) {
  const params = [];
  let where = `WHERE deleted_at IS NULL`;

  if (query.status) {
    params.push(query.status);
    where += ` AND status = $${params.length}`;
  }

  if (query.initial_level) {
    params.push(query.initial_level);
    where += ` AND initial_level = $${params.length}`;
  }

  if (query.residual_level) {
    params.push(query.residual_level);
    where += ` AND residual_level = $${params.length}`;
  }

  if (query.cell_l && query.cell_c) {
    params.push(Number(query.cell_l));
    where += ` AND residual_likelihood = $${params.length}`;
    params.push(Number(query.cell_c));
    where += ` AND residual_consequence = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search.trim()}%`);
    const qStr = `$${params.length}`;
    where += ` AND (risk_no ILIKE ${qStr} OR activity ILIKE ${qStr} OR hazard ILIKE ${qStr} OR consequence_desc ILIKE ${qStr} OR department_name ILIKE ${qStr} OR owner_name ILIKE ${qStr})`;
  }

  const sql = `
    SELECT *
    FROM hse_risk_register
    ${where}
    ORDER BY residual_score DESC, created_at DESC
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

async function createRiskRegisterItem(db, scope, user, payload = {}) {
  const {
    activity,
    department_id = null,
    department_name = null,
    hazard,
    consequence_desc,
    initial_likelihood,
    initial_consequence,
    controls = [],
    residual_likelihood,
    residual_consequence,
    owner_id = null,
    owner_name = null,
    review_date = null,
    status = 'ACTIVE',
  } = payload;

  if (!activity || !hazard || !consequence_desc || !initial_likelihood || !initial_consequence || !residual_likelihood || !residual_consequence) {
    const err = new Error('Field activity, hazard, consequence_desc, nilai likelihood & consequence (awal & sisa) wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  const initL = Number(initial_likelihood);
  const initC = Number(initial_consequence);
  const resL = Number(residual_likelihood);
  const resC = Number(residual_consequence);

  const initScore = initL * initC;
  const resScore = resL * resC;

  const getLevel = (score) => {
    if (score >= 17) return 'EXTREME';
    if (score >= 10) return 'HIGH';
    if (score >= 5) return 'MEDIUM';
    return 'LOW';
  };

  const initial_level = getLevel(initScore);
  const residual_level = getLevel(resScore);

  const dateStr = new Date().toISOString().slice(2, 7).replace('-', '');
  const countRes = await db.query(`SELECT COUNT(*)::int AS count FROM hse_risk_register WHERE risk_no LIKE 'RSK-${dateStr}-%'`);
  const seq = String((countRes.rows[0]?.count || 0) + 1).padStart(3, '0');
  const risk_no = `RSK-${dateStr}-${seq}`;

  const sql = `
    INSERT INTO hse_risk_register (
      tenant_id, site_id, risk_no, activity, department_id, department_name,
      hazard, consequence_desc, initial_likelihood, initial_consequence, initial_score, initial_level,
      controls, residual_likelihood, residual_consequence, residual_score, residual_level,
      owner_id, owner_name, review_date, status, created_by
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22
    )
    RETURNING *
  `;

  const { rows } = await db.query(sql, [
    scope.tenantKey || '00000000-0000-0000-0000-000000000001',
    scope.projectKey || '00000000-0000-0000-0000-000000000001',
    risk_no, activity, department_id, department_name,
    hazard, consequence_desc, initL, initC, initScore, initial_level,
    JSON.stringify(Array.isArray(controls) ? controls : []),
    resL, resC, resScore, residual_level,
    owner_id, owner_name, review_date || null, status, user.id || null
  ]);

  return rows[0];
}

// Setup Master: Lokasi Hierarkis (Area & Sub-Area)
async function listLocationsTree(db, scope) {
  const query = `
    SELECT l.id, l.code, l.name, l.type, l.parent_id, l.latitude, l.longitude, l.is_active, l.created_at,
           p.name AS parent_name, p.code AS parent_code
    FROM hse_locations l
    LEFT JOIN hse_locations p ON p.id = l.parent_id
    WHERE l.tenant_key = $1 AND l.project_key = $2 AND l.deleted_at IS NULL
    ORDER BY l.name ASC
  `;
  const { rows } = await db.query(query, [scope.tenantKey, scope.projectKey]);

  const parents = [];
  const parentMap = new Map();
  const children = [];

  rows.forEach(item => {
    if (!item.parent_id) {
      const parentObj = { ...item, sub_areas: [], sub_area_count: 0 };
      parents.push(parentObj);
      parentMap.set(item.id, parentObj);
    } else {
      children.push(item);
    }
  });

  children.forEach(child => {
    const parent = parentMap.get(child.parent_id);
    if (parent) {
      parent.sub_areas.push(child);
      parent.sub_area_count++;
    } else {
      parents.push({ ...child, sub_areas: [], sub_area_count: 0 });
    }
  });

  return {
    items: parents,
    totalAreas: parents.length,
    totalSubAreas: children.length,
    rawList: rows,
  };
}

async function createLocation(db, scope, user, payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name) {
    const err = new Error('Nama Area / Sub Area wajib diisi');
    err.statusCode = 400;
    throw err;
  }

  let code = String(payload.code || '').trim().toUpperCase();
  if (!code) {
    const prefix = payload.parent_id ? 'SUB' : 'AREA';
    const slug = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'LOC';
    const rand = Math.floor(100 + Math.random() * 900);
    code = `${prefix}-${slug}-${rand}`;
  }

  let type = payload.type;
  if (payload.parent_id && !type) {
    const parentRes = await db.query(
      `SELECT type FROM hse_locations WHERE id = $1 AND tenant_key = $2 AND project_key = $3 LIMIT 1`,
      [payload.parent_id, scope.tenantKey, scope.projectKey]
    );
    if (parentRes.rows[0]?.type) {
      type = parentRes.rows[0].type;
    }
  }

  const validTypes = ['PIT', 'HAUL_ROAD', 'WORKSHOP', 'WAREHOUSE', 'OFFICE', 'CAMP', 'DISPOSAL', 'OTHER'];
  if (!type || !validTypes.includes(type)) {
    type = 'OTHER';
  }

  const existing = await db.query(
    `SELECT id FROM hse_locations WHERE tenant_key = $1 AND project_key = $2 AND code = $3 AND deleted_at IS NULL LIMIT 1`,
    [scope.tenantKey, scope.projectKey, code]
  );
  if (existing.rows.length > 0) {
    const err = new Error(`Kode lokasi "${code}" sudah digunakan. Gunakan kode lain.`);
    err.statusCode = 400;
    throw err;
  }

  const query = `
    INSERT INTO hse_locations (
      tenant_key, project_key, code, name, type, parent_id,
      latitude, longitude, is_active, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)
    RETURNING *
  `;
  const values = [
    scope.tenantKey,
    scope.projectKey,
    code,
    name,
    type,
    payload.parent_id || null,
    payload.latitude !== undefined && payload.latitude !== '' && payload.latitude !== null ? Number(payload.latitude) : null,
    payload.longitude !== undefined && payload.longitude !== '' && payload.longitude !== null ? Number(payload.longitude) : null,
    user?.id || null,
  ];

  const { rows } = await db.query(query, values);
  return rows[0];
}

async function updateLocation(db, scope, user, id, payload = {}) {
  const existing = await db.query(
    `SELECT * FROM hse_locations WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL LIMIT 1`,
    [id, scope.tenantKey, scope.projectKey]
  );
  if (existing.rows.length === 0) {
    const err = new Error('Data lokasi tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  const curr = existing.rows[0];

  const name = payload.name !== undefined ? String(payload.name).trim() : curr.name;
  if (!name) {
    const err = new Error('Nama Area / Sub Area tidak boleh kosong');
    err.statusCode = 400;
    throw err;
  }

  const code = payload.code !== undefined ? String(payload.code).trim().toUpperCase() : curr.code;
  if (code !== curr.code) {
    const codeCheck = await db.query(
      `SELECT id FROM hse_locations WHERE tenant_key = $1 AND project_key = $2 AND code = $3 AND id != $4 AND deleted_at IS NULL LIMIT 1`,
      [scope.tenantKey, scope.projectKey, code, id]
    );
    if (codeCheck.rows.length > 0) {
      const err = new Error(`Kode lokasi "${code}" sudah digunakan.`);
      err.statusCode = 400;
      throw err;
    }
  }

  let parentId = payload.parent_id !== undefined ? payload.parent_id : curr.parent_id;
  if (parentId === id) {
    const err = new Error('Parent Area tidak boleh merujuk ke dirinya sendiri');
    err.statusCode = 400;
    throw err;
  }

  const validTypes = ['PIT', 'HAUL_ROAD', 'WORKSHOP', 'WAREHOUSE', 'OFFICE', 'CAMP', 'DISPOSAL', 'OTHER'];
  let type = payload.type !== undefined ? payload.type : curr.type;
  if (!validTypes.includes(type)) {
    type = curr.type;
  }

  const query = `
    UPDATE hse_locations
    SET code = $1, name = $2, type = $3, parent_id = $4,
        latitude = $5, longitude = $6, is_active = COALESCE($7, is_active),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $8 AND tenant_key = $9 AND project_key = $10
    RETURNING *
  `;
  const values = [
    code,
    name,
    type,
    parentId || null,
    payload.latitude !== undefined && payload.latitude !== '' && payload.latitude !== null ? Number(payload.latitude) : curr.latitude,
    payload.longitude !== undefined && payload.longitude !== '' && payload.longitude !== null ? Number(payload.longitude) : curr.longitude,
    payload.is_active !== undefined ? Boolean(payload.is_active) : curr.is_active,
    id,
    scope.tenantKey,
    scope.projectKey,
  ];

  const { rows } = await db.query(query, values);
  return rows[0];
}

async function deleteLocation(db, scope, user, id) {
  const childCheck = await db.query(
    `SELECT COUNT(*) AS count FROM hse_locations WHERE parent_id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL`,
    [id, scope.tenantKey, scope.projectKey]
  );
  if (parseInt(childCheck.rows[0]?.count || 0, 10) > 0) {
    const err = new Error('Area ini masih memiliki Sub-Area aktif. Hapus atau pindahkan Sub-Area terlebih dahulu.');
    err.statusCode = 400;
    throw err;
  }

  const query = `
    UPDATE hse_locations
    SET deleted_at = CURRENT_TIMESTAMP, is_active = FALSE
    WHERE id = $1 AND tenant_key = $2 AND project_key = $3 AND deleted_at IS NULL
    RETURNING id, name, code
  `;
  const { rows } = await db.query(query, [id, scope.tenantKey, scope.projectKey]);
  if (rows.length === 0) {
    const err = new Error('Data lokasi tidak ditemukan atau sudah dihapus');
    err.statusCode = 404;
    throw err;
  }
  return { success: true, deleted: rows[0] };
}

module.exports = {
  calculateRisk,
  formatDocNumber,
  scopeFromUser,
  getMasters,
  getOverview,
  listHazards,
  createHazard,
  getHazardDetail,
  updateHazard,
  deleteHazard,
  buildHazardSemanticCode,
  computeHazardSimilarity,
  mergeSimilarHazards,
  getHazardReporterStats,
  listActions,
  createAction,
  updateAction,
  syncHazardStatusFromActions,
  capaProgressOf,
  anyCycleQuotaJoin,
  personnelScopeWhere,
  listEventParticipants,
  dueAtForRisk,
  HAZARD_SLA_HOURS,
  // Fase 2:
  listIncidents,
  getIncidentDetail,
  createIncident,
  updateIncident,
  saveInvestigation,
  listManhours,
  saveManhours,
  getSafetyReports,
  // Fase 3:
  getCompetencyOverview,
  listCompetencyCourses,
  listEmployeeLicenses,
  createEmployeeLicense,
  updateEmployeeLicense,
  getTrainingMatrix,
  listTrainingRecords,
  createTrainingRecord,
  listInductions,
  createInduction,
  // Fase 4:
  getPtwOverview,
  listPermits,
  getPermitDetail,
  createPermit,
  updatePermitStatus,
  addPtwIsolation,
  releasePtwIsolation,
  addPtwHandover,
  listInspectionTemplates,
  listInspections,
  getInspectionDetail,
  createInspection,
  updateInspectionAttachments,
  // Fase 5:
  getOccHealthOverview,
  listMcuRecords,
  createMcuRecord,
  updateMcuRecord,
  listFfwChecks,
  createFfwCheck,
  listSubstanceTests,
  createSubstanceTest,
  listHealthCases,
  createHealthCase,
  updateHealthCase,
  listHygieneMeasurements,
  createHygieneMeasurement,
  // Fase 6:
  getEmergencyOverview,
  listEmergencyTeam,
  createEmergencyTeamMember,
  updateEmergencyTeamMember,
  listEmergencyDrills,
  createEmergencyDrill,
  listEmergencyEquipment,
  createEmergencyEquipment,
  updateEmergencyEquipment,
  listEmergencyAssemblyPoints,
  createEmergencyAssemblyPoint,
  listEmergencyContacts,
  createEmergencyContact,
  getPpeOverview,
  listPpeItems,
  createPpeItem,
  listPpeStandards,
  createPpeStandard,
  listPpeIssuances,
  createPpeIssuance,
  returnPpeIssuance,
  // Fase 7:
  getContractorOverview,
  listContractors,
  createContractor,
  listContractorAssessments,
  createContractorAssessment,
  listContractorDocuments,
  createContractorDocument,
  listContractorViolations,
  createContractorViolation,
  resolveContractorViolation,
  getEnvironmentOverview,
  listWasteB3Logs,
  createWasteB3Log,
  listEnvMonitoringPoints,
  createEnvMonitoringPoint,
  listEnvParameters,
  listEnvMeasurements,
  createEnvMeasurement,
  listReclamationRecords,
  createReclamationRecord,
  // Fase 8:
  getAuditOverview,
  listAudits,
  createAudit,
  listAuditFindings,
  createAuditFinding,
  resolveAuditFinding,
  listSmkpElements,
  getDocumentsOverview,
  listDocuments,
  createDocument,
  createDocumentRevision,
  listLegalRegister,
  createLegalRegister,
  listMandatoryReports,
  createMandatoryReport,
  updateMandatoryReportStatus,
  // IBPR:
  getRiskRegisterOverview,
  listRiskRegister,
  createRiskRegisterItem,
  // Setup Master Lokasi:
  listLocationsTree,
  createLocation,
  updateLocation,
  deleteLocation,
  // Setup Master Inspeksi:
  getInspectionTemplateDetail,
  createInspectionTemplate,
  updateInspectionTemplate,
  createInspectionTemplateVersion,
  deactivateInspectionTemplate,
  listInspectionTargets,
  getInspectionPersonnelScope,
  saveInspectionPersonnelScope,
  getInspectionMandateOverview,
  createOrUpdateInspectionTarget,
  deactivateInspectionTarget,
  // Setup Hazard Report:
  listHazardReportTargets,
  getHazardReportPersonnelScope,
  saveHazardReportPersonnelScope,
  getHazardReportMandateOverview,
  createOrUpdateHazardReportTarget,
  deactivateHazardReportTarget,
  // Setup P5M:
  listP5mTargets,
  getP5mPersonnelScope,
  saveP5mPersonnelScope,
  getP5mMandateOverview,
  createOrUpdateP5mTarget,
  deactivateP5mTarget,
  // Setup Safety Talk:
  listSafetytalkTargets,
  getSafetytalkPersonnelScope,
  saveSafetytalkPersonnelScope,
  getSafetytalkMandateOverview,
  createOrUpdateSafetytalkTarget,
  deactivateSafetytalkTarget,
  listInspectionSchedules,
  createInspectionSchedule,
  deactivateInspectionSchedule,
  getInspectionComplianceReport,
  // Event operasional P5M & Safety Talk (tab Hazard dan Inspeksi):
  listP5mEvents,
  getP5mEventDetail,
  createP5mEvent,
  updateP5mEvent,
  deleteP5mEvent,
  mergeP5mEvents,
  listSafetytalkEvents,
  getSafetytalkEventDetail,
  createSafetytalkEvent,
  updateSafetytalkEvent,
  deleteSafetytalkEvent,
  mergeSafetytalkEvents,
};

