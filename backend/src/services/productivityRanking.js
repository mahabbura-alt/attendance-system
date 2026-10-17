'use strict';

/* P1 Productivity Report Ranking — domain service backend.
   Satu domain result dipakai response ranking DAN Data Control (kontrak §7).
   Keputusan §12 terkunci: Gross utama, submitted saja, HM-share, ambigu exclude,
   OB/Coal pisah, DW per-segmen exclude (NON_PRODUCTION_JOB_DW).
   Reuse formula tervalidasi: productiveRitase, loader/hauler calculators
   (via data plan tersimpan — TIDAK dihitung ulang di sini). */

const { pool } = require('../config/db');
const core = require('./productivityRankingCore');
const ProductivityPlanning = require('./productivityPlanning');
const SpoPlanning = require('./spoPlanning');

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const EPS = core.EPS;

const upper = v => String(v || '').trim().toUpperCase();
const num = v => Number(v);

function canonOf(raw, masterJobs) {
  return core.canonJobUpper(raw, masterJobs);
}

function kategoriOf(materialType) {
  return String(materialType || '').trim().toLowerCase() === 'coal' ? 'Coal' : 'OB';
}

/* ---- filter ---- */

function parseFilters(q = {}) {
  const { dari, sampai } = q.tanggal_dari || q.tanggal_sampai
    ? core.validateRange(q.tanggal_dari, q.tanggal_sampai)
    : core.defaultRange();
  const planningType = String(q.planning_type || q.jenis || 'ob').toLowerCase();
  if (!['ob', 'coal'].includes(planningType)) throw err('planning_type harus ob atau coal.', 422);
  return {
    dari, sampai,
    planning_type: planningType,
    unit: core.unitForType(planningType),
    area: String(q.area || '').trim(),
    job: String(q.job || '').trim(),
    material: String(q.material || '').trim(),
  };
}

/* ---- load batch (satu query per sumber, tanpa N+1) ---- */

async function loadDomainData(db, f) {
  const range = [f.dari, f.sampai];
  const fleets = await db.query(
    `/* pr_fleets */
     SELECT fm.id, fm.tanggal::text AS tanggal, fm.shift_id, s.nama_shift,
            fm.excavator_id, e.kode_alat AS excavator_code,
            fm.job_code, fm.pit_area, fm.material_detail, fm.material_type, fm.jarak_km
     FROM fleet_mappings fm
     JOIN equipment e ON e.id = fm.excavator_id
     LEFT JOIN shifts s ON s.id = fm.shift_id
     WHERE fm.deleted_at IS NULL AND fm.tanggal >= $1 AND fm.tanggal <= $2`,
    range);
  const ritase = await db.query(
    `/* pr_ritase */
     SELECT rl.id, rl.fleet_mapping_id, rl.dump_truck_id, rl.period_hour,
            rl.ritase_count, COALESCE(rl.nonprod_ritase_count, 0) AS nonprod_count,
            e.kode_alat AS dt_code, e.tipe_alat AS dt_tipe
     FROM ritase_logs rl
     JOIN fleet_mappings fm ON fm.id = rl.fleet_mapping_id
     JOIN equipment e ON e.id = rl.dump_truck_id
     WHERE rl.deleted_at IS NULL AND fm.deleted_at IS NULL
       AND fm.tanggal >= $1 AND fm.tanggal <= $2`,
    range);
  const segments = await db.query(
    `/* pr_segments */
     SELECT l.id, l.tanggal::text AS tanggal, l.shift_id, s.nama_shift,
            l.equipment_id, e.kode_alat, e.tipe_alat, e.kelas_alat,
            l.operator_id, u.nama AS operator_nama,
             l.job, l.area_name, l.total_hm
     FROM mining_production_logs l
     JOIN equipment e ON e.id = l.equipment_id
     LEFT JOIN users u ON u.id = l.operator_id
     LEFT JOIN shifts s ON s.id = l.shift_id
      WHERE l.deleted_at IS NULL AND l.tanggal >= $1 AND l.tanggal <= $2`,
    range);
  const factors = await db.query(
    `/* pr_factors */
     SELECT tanggal::text AS tanggal, kategori, tipe_alat, material, factor_value
     FROM truck_factors ORDER BY tanggal`);
  const versions = await db.query(
    `/* pr_plan_versions */
     SELECT id, planning_type, effective_from::text AS effective_from, revision, data_json
     FROM productivity_plan_versions WHERE effective_from <= $1
     ORDER BY planning_type, effective_from`,
    [f.sampai]);
  const jobs = await db.query(
    `/* pr_jobs */
     SELECT job_code, job_desc FROM master_job_codes WHERE deleted_at IS NULL`);
  const spo = await db.query(
    `/* pr_spo */
     SELECT content_html, data_json FROM productivity_plans
     WHERE planning_type = 'spo' LIMIT 1`);
  const deployedJobs = [...SpoPlanning.extractProductionJobCodes(spo.rows[0] || {}, jobs.rows)];
  return {
    fleets: fleets.rows, ritase: ritase.rows, segments: segments.rows,
    factors: factors.rows, versions: versions.rows, jobs: jobs.rows,
    deployedJobs,
  };
}

/* ---- plan resolution (per tanggal, batch di JS) ---- */

function indexPlansForDate(versions, planningType, tanggal) {
  const v = core.resolveEffectiveVersion(
    (versions || []).filter(x => String(x.planning_type) === planningType), tanggal);
  if (!v) return { version: null, loaders: new Map(), haulers: new Map(),
    hasHaulerDatabase: false, densities: new Map() };
  const data = v.data_json && typeof v.data_json === 'object' ? v.data_json : {};
  const loaders = new Map();
  const densities = new Map();
  const parameters = new Map();
  for (const parameter of (Array.isArray(data.parameters) ? data.parameters : [])) {
    const material = upper(parameter?.material);
    const density = Number(parameter?.density);
    if (material) parameters.set(material, parameter);
    if (material && Number.isFinite(density) && density > 0) densities.set(material, density);
  }
  const pushLoader = (loaderCode, material, jobCodes, productivity, complete) => {
    const code = String(loaderCode || '').trim();
    const mat = upper(material);
    if (!code || !mat) return;
    for (const j of (Array.isArray(jobCodes) ? jobCodes : [jobCodes])) {
      const job = upper(j);
      if (!job) continue;
      loaders.set(`${code}|${mat}|${job}`, {
        productivity: complete === false ? null : (Number(productivity) > 0 ? Number(productivity) : null),
      });
    }
  };
  if (Array.isArray(data.loaderCatalog) && data.loaderCatalog.length) {
    for (const e of data.loaderCatalog) {
      pushLoader(e.loaderCode, e.material, [e.jobCode], e.loaderProductivity, e.complete);
    }
  } else if (Array.isArray(data.scenarios)) {
    for (const s of data.scenarios) {
      pushLoader(s.loaderCode, s.material, s.jobCodes, s.loaderProductivity, true);
    }
  } else if (Array.isArray(data.fleetCatalog)) {
    for (const e of data.fleetCatalog) {
      pushLoader(e.loaderCode, e.material, [e.jobCode], e.loaderProductivity, e.complete);
    }
  }
  // Database Hauler adalah sumber plan DT. Satu baris dipilih dengan excavator
  // aktual yang melakukan loading + DT + material pada versi efektif. Setting
  // Fleet tidak membatasi eligibility DT di Leader Board.
  const haulers = new Map();
  const hasHaulerDatabase = Array.isArray(data.haulerRows);
  if (hasHaulerDatabase && Array.isArray(data.scenarios)) {
    const rowsByLoaderMaterial = new Map();
    for (const row of data.haulerRows) {
      const key = `${String(row?.loaderId || '')}|${upper(row?.material)}`;
      if (!rowsByLoaderMaterial.has(key)) rowsByLoaderMaterial.set(key, []);
      rowsByLoaderMaterial.get(key).push(row);
    }
    const distanceHeaders = new Set((Array.isArray(data.distanceHeadersMeters)
      ? data.distanceHeadersMeters : []).map(Number).filter(Number.isFinite));
    for (const scenario of data.scenarios) {
      const loaderCode = String(scenario?.loaderCode || '').trim();
      const loaderId = String(scenario?.loaderId || '');
      const material = upper(scenario?.material);
      if (!loaderCode || !loaderId || !material) continue;
      const parameter = parameters.get(material) || {};
      for (const row of (rowsByLoaderMaterial.get(`${loaderId}|${material}`) || [])) {
        const truckId = String(row?.truckId || '');
        if (!truckId) continue;
        haulers.set(`${loaderCode}|${material}|${truckId}`, {
          planningType, scenario, parameter, row, distanceHeaders,
        });
      }
    }
  }
  return { version: v, loaders, haulers, hasHaulerDatabase, densities };
}

function resolveLoaderPlan(idx, loaderCode, material, canonJob) {
  const hit = idx.loaders.get(`${String(loaderCode || '').trim()}|${upper(material)}|${upper(canonJob)}`);
  return hit && hit.productivity != null
    ? { productivity: hit.productivity, versionId: idx.version ? idx.version.id : null }
    : { productivity: null, versionId: idx.version ? idx.version.id : null };
}

function resolveDtPlan(idx, loaderCode, material, canonJob, dtId, fleetJarakKm) {
  if (idx.hasHaulerDatabase) {
    const source = idx.haulers.get(`${String(loaderCode || '').trim()}|${upper(material)}|${String(dtId)}`);
    const distanceMeters = Math.round(Number(fleetJarakKm) * 1000);
    if (!source || !(distanceMeters > 0)
      || (source.distanceHeaders.size && !source.distanceHeaders.has(distanceMeters))) {
      return { productivity: null, versionId: idx.version ? idx.version.id : null };
    }
    const { planningType, scenario, parameter, row } = source;
    const capacity = Number(row?.capacity);
    const density = planningType === 'coal' ? Number(parameter?.density) : 1;
    const capacityUom = String(row?.capacityUom || '').trim().toLowerCase();
    const volumeCapacity = planningType === 'coal' && capacityUom === 'ton' && density > 0
      ? capacity / density : capacityUom === 'bcm' ? capacity : 0;
    const loaderCap = Number(scenario?.loaderCap) > 0 ? Number(scenario.loaderCap)
      : Number(scenario?.swell) > 0
        ? Number(scenario?.bucketCapacity) * Number(scenario?.fill) / Number(scenario.swell) : 0;
    const cycleSeconds = Number(scenario?.cycleTimeLoading);
    const passes = loaderCap > 0 && volumeCapacity > 0
      ? Math.max(1, Math.round(volumeCapacity / loaderCap)) : 0;
    const loadingTime = passes > 0 && cycleSeconds > 0 ? passes * cycleSeconds / 60 : null;
    const calculated = loadingTime == null ? null : ProductivityPlanning.calculateHaulerProductivity({
      planningType, distanceMeters,
      truck: { capacity, capacityUom: row.capacityUom },
      parameter,
      profile: { ...row, loadingTime },
    });
    return {
      productivity: calculated?.productivity > 0 ? calculated.productivity : null,
      versionId: idx.version ? idx.version.id : null,
    };
  }

  // Snapshot tanpa database Hauler tidak boleh kembali membaca Setting Fleet
  // Simulation. Data Control menandainya sebagai plan DT yang belum tersedia.
  return { productivity: null, versionId: idx.version ? idx.version.id : null };
}

function resolveFactor(factors, kategori, dtTipe, material, tanggal) {
  let best = null;
  for (const r of factors || []) {
    if (String(r.kategori) !== kategori || String(r.tipe_alat) !== String(dtTipe || '')) continue;
    if (upper(r.material) !== upper(material || '')) continue;
    if (String(r.tanggal).slice(0, 10) > String(tanggal).slice(0, 10)) continue;
    if (!best || String(r.tanggal) > String(best.tanggal)) best = r;
  }
  const v = best ? Number(best.factor_value) : NaN;
  return Number.isFinite(v) && v > 0 ? { value: v, tanggal: String(best.tanggal).slice(0, 10) } : null;
}

/* ---- domain build (murni dari data termuat; dapat diuji tanpa DB) ---- */

function buildDomain(input, f) {
  const { fleets, ritase, segments, factors, versions, jobs } = input;
  const deployedJobs = new Set((input.deployedJobs || []).map(upper));
  const jobIsDeployed = job => deployedJobs.has(upper(job));
  const canonJobFilter = f.job ? canonOf(f.job, jobs) : '';
  const matchArea = v => !f.area || String(v || '').trim() === f.area;
  const matchMaterial = v => !f.material || upper(v) === upper(f.material);
  const katWanted = f.planning_type === 'coal' ? 'Coal' : 'OB';

  const fleetById = new Map((fleets || []).map(x => [String(x.id), x]));
  const planIdxByDate = new Map();
  const planIdx = tanggal => {
    const t = String(tanggal).slice(0, 10);
    if (!planIdxByDate.has(t)) {
      planIdxByDate.set(t, indexPlansForDate(versions, f.planning_type, t));
    }
    return planIdxByDate.get(t);
  };

  /* 1) volume per fleet + flag factor */
  const fleetVol = new Map(); // fleetId -> {gross, net, rows, missingFactorRows, dtIds:Set}
  let missingTruckFactorRows = 0;
  for (const r of ritase || []) {
    const fm = fleetById.get(String(r.fleet_mapping_id));
    if (!fm) continue;
    if (kategoriOf(fm.material_type) !== katWanted) continue;
    if (!matchArea(fm.pit_area)) continue;
    const canonJob = canonOf(fm.job_code, jobs);
    if (!jobIsDeployed(canonJob)) continue;
    if (canonJobFilter && canonJob !== canonJobFilter) continue;
    if (!matchMaterial(fm.material_detail)) continue;
    const g = core.grossNet(r.ritase_count, r.nonprod_count, null);
    const fac = resolveFactor(factors, kategoriOf(fm.material_type), r.dt_tipe, fm.material_detail, fm.tanggal);
    let cell = fleetVol.get(String(fm.id));
    if (!cell) { cell = { gross: 0, net: 0, rows: 0, missingFactorRows: 0, dtIds: new Set(), fm }; fleetVol.set(String(fm.id), cell); }
    cell.rows += 1;
    cell.dtIds.add(String(r.dump_truck_id));
    if (!fac) { cell.missingFactorRows += 1; missingTruckFactorRows += 1; continue; }
    cell.gross += g.grossRit * fac.value;
    cell.net += g.netRit * fac.value;
    cell.factorTanggal = fac.tanggal;
  }

  /* 2) kelompok HM: date|shift|equip|canonJob (DW dipisah dulu) */
  const groups = new Map(); // key -> {segs:[], materials:Set(fleet), ...}
  const dwGroups = new Map();
  let excludedDwSegments = 0;
  let excludedDwHm = 0;
  for (const s of segments || []) {
    const hm = Number(s.total_hm);
    if (!Number.isFinite(hm) || hm < 0) continue;
    const canonJob = canonOf(s.job, jobs);
    if (!jobIsDeployed(canonJob)) continue;
    if (canonJobFilter && canonJob !== canonJobFilter) continue;
    if (!matchArea(s.area_name)) continue;
    const key = `${String(s.tanggal).slice(0, 10)}|${String(s.shift_id)}|${String(s.equipment_id)}|${canonJob}`;
    if (core.isDwJob(canonJob)) {
      let g = dwGroups.get(key);
      if (!g) { g = { key, tanggal: String(s.tanggal).slice(0, 10), shift_id: s.shift_id, shift: s.nama_shift, equipment_id: s.equipment_id, code: s.kode_alat, kelas: s.kelas_alat, operators: new Set(), segments: 0, hm: 0, ids: [] }; dwGroups.set(key, g); }
      g.segments += 1; g.hm += hm; excludedDwSegments += 1; excludedDwHm += hm;
      if (s.operator_id) g.operators.add(String(s.operator_nama || s.operator_id));
      g.ids.push(String(s.id));
      continue;
    }
    let g = groups.get(key);
    if (!g) { g = { key, tanggal: String(s.tanggal).slice(0, 10), shift_id: s.shift_id, shift: s.nama_shift, equipment_id: s.equipment_id, code: s.kode_alat, kelas: s.kelas_alat, segs: [], ids: [] }; groups.set(key, g); }
    g.segs.push(s); g.ids.push(String(s.id));
  }
  // material per grup dari fleet yang cocok konteksnya
  for (const g of groups.values()) {
    g.materials = new Set();
    g.fleetIds = [];
    for (const [fid, cell] of fleetVol) {
      const fm = cell.fm;
      if (String(fm.tanggal).slice(0, 10) !== g.tanggal) continue;
      if (String(fm.shift_id) !== String(g.shift_id)) continue;
      if (String(fm.excavator_id) !== String(g.equipment_id) && ![...cell.dtIds].includes(String(g.equipment_id))) continue;
      if (canonOf(fm.job_code, jobs) !== g.key.split('|')[3]) continue;
      // hanya fleet kategori sesuai planning_type (sudah difilter saat volume)
      g.materials.add(upper(fm.material_detail || ''));
      g.fleetIds.push(String(fid));
    }
    g.ambiguous = g.materials.size > 1;
  }

  /* 3) sel kontrol */
  const cells = [];
  const pushCell = c => cells.push(c);
  let ritaseWithoutHmCells = 0;
  let hmWithoutRitaseCells = 0;
  let ambiguousGroups = 0;
  const countedAmbiguous = new Set();

  const hmFor = (key, material) => {
    const g = groups.get(key);
    if (!g || !g.segs.length) return { hm: 0, group: null, ambiguous: false };
    if (g.ambiguous) {
      if (!countedAmbiguous.has(key)) { countedAmbiguous.add(key); ambiguousGroups += 1; }
      return { hm: 0, group: g, ambiguous: true };
    }
    if (material && ![...g.materials].includes(upper(material))) return { hm: 0, group: g, ambiguous: false };
    const hm = g.segs.reduce((s, x) => s + (Number(x.total_hm) || 0), 0);
    return { hm, group: g, ambiguous: false };
  };

  // sel excavator per fleet
  for (const [fid, cell] of fleetVol) {
    const fm = cell.fm;
    const tanggal = String(fm.tanggal).slice(0, 10);
    const canonJob = canonOf(fm.job_code, jobs);
    const material = String(fm.material_detail || '').trim();
    const idx = planIdx(tanggal);
    const plan = resolveLoaderPlan(idx, fm.excavator_code, material, canonJob);
    const hmKey = `${tanggal}|${String(fm.shift_id)}|${String(fm.excavator_id)}|${canonJob}`;
    const hmInfo = hmFor(hmKey, material);
    const st = core.deriveControlStatus({
      ambiguous: hmInfo.ambiguous,
      missingPlan: plan.productivity == null,
      missingHm: !hmInfo.ambiguous && hmInfo.hm <= EPS && cell.gross > EPS,
      missingFactor: cell.missingFactorRows > 0,
    });
    const reasons = [...st.reasons];
    if (!hmInfo.ambiguous && hmInfo.hm <= EPS && cell.gross > EPS) {
      reasons.push(core.REASONS.RITASE_WITHOUT_HM);
      ritaseWithoutHmCells += 1;
    }
    const ach = core.achievementOf({ grossVol: cell.gross, netVol: cell.net, hm: hmInfo.hm,
      planHm: plan.productivity != null && hmInfo.hm > EPS ? [{ plan: plan.productivity, hm: hmInfo.hm }] : [] });
    const key = `excavator|${tanggal}|${String(fm.shift_id)}|${String(fm.excavator_id)}|${canonJob}|${upper(material)}`;
    pushCell({
      control_key: key, entity_type: 'excavator', tanggal, shift: fm.nama_shift, shift_id: fm.shift_id,
      entity_id: String(fm.excavator_id), entity_code: fm.excavator_code, entity_name: null,
      area: fm.pit_area, job: canonJob, material, unit: f.unit,
      plan_productivity: plan.productivity, plan_version_id: plan.versionId,
      gross_volume: cell.gross, net_volume: cell.net, hm_hours: hmInfo.hm,
      actual_productivity: ach.actual, net_productivity: ach.netActual,
      weighted_plan_productivity: ach.weightedPlan, expected_production: ach.expected,
      achievement_percentage: ach.achievement, net_achievement_percentage: ach.netAchievement,
      complete: ach.complete && st.status === 'ready',
      control_status: st.status, reason_codes: reasons,
      source_counts: { ritaseRows: cell.rows, workLogSegments: hmInfo.group ? hmInfo.group.segs.length : 0, planningVersions: plan.versionId ? 1 : 0, truckFactors: cell.rows - cell.missingFactorRows },
      lineage: { fleet_ids: [String(fid)], segment_ids: hmInfo.group ? hmInfo.group.ids.slice(0, 20) : [], plan_version_id: plan.versionId, formula_version: core.FORMULA_VERSION, calculated_at: new Date().toISOString() },
    });
    // sel personel operator excavator (HM-share)
    if (hmInfo.group && !hmInfo.ambiguous && hmInfo.hm > EPS) {
      const byOp = new Map();
      for (const s of hmInfo.group.segs) {
        if (!s.operator_id) continue;
        const k = String(s.operator_id);
        if (!byOp.has(k)) byOp.set(k, { key: k, hm: 0, nama: s.operator_nama });
        byOp.get(k).hm += Number(s.total_hm) || 0;
      }
      const shares = core.allocateHmShare(cell.gross, [...byOp.values()]);
      const netShares = core.allocateHmShare(cell.net, [...byOp.values()]);
      for (const m of shares) {
        const netM = netShares.find(x => x.key === m.key);
        const a = core.achievementOf({ grossVol: m.volume, netVol: netM ? netM.volume : 0, hm: m.hm,
          planHm: plan.productivity != null && m.hm > EPS ? [{ plan: plan.productivity, hm: m.hm }] : [] });
        const pst = core.deriveControlStatus({ missingPlan: plan.productivity == null, missingHm: m.hm <= EPS, missingFactor: cell.missingFactorRows > 0 });
        pushCell({
          control_key: `operator|${tanggal}|${String(fm.shift_id)}|${m.key}|${canonJob}|${upper(material)}`,
          entity_type: 'operator', tanggal, shift: fm.nama_shift, shift_id: fm.shift_id,
          entity_id: m.key, entity_code: m.nama || m.key, entity_name: m.nama || null,
          parent_unit_id: String(fm.excavator_id), parent_unit_code: fm.excavator_code,
          area: fm.pit_area, job: canonJob, material, unit: f.unit,
          plan_productivity: plan.productivity, plan_version_id: plan.versionId,
          gross_volume: m.volume, net_volume: netM ? netM.volume : 0, hm_hours: m.hm,
          actual_productivity: a.actual, net_productivity: a.netActual,
          weighted_plan_productivity: a.weightedPlan, expected_production: a.expected,
          achievement_percentage: a.achievement, net_achievement_percentage: a.netAchievement,
          complete: a.complete && pst.status === 'ready',
          control_status: pst.status, reason_codes: pst.reasons,
          source_counts: { ritaseRows: cell.rows, workLogSegments: hmInfo.group.segs.length, planningVersions: plan.versionId ? 1 : 0, truckFactors: cell.rows - cell.missingFactorRows },
          lineage: { fleet_ids: [String(fid)], segment_ids: hmInfo.group.ids.slice(0, 20), plan_version_id: plan.versionId, formula_version: core.FORMULA_VERSION, operator_share_version: core.OPERATOR_SHARE_VERSION, calculated_at: new Date().toISOString() },
        });
      }
    }
  }

  // sel dump truck per (fleet, dt)
  const dtCellByKey = new Map();
  for (const r of ritase || []) {
    const fm = fleetById.get(String(r.fleet_mapping_id));
    if (!fm || kategoriOf(fm.material_type) !== katWanted) continue;
    if (!matchArea(fm.pit_area)) continue;
    const canonJob = canonOf(fm.job_code, jobs);
    if (!jobIsDeployed(canonJob)) continue;
    if (canonJobFilter && canonJob !== canonJobFilter) continue;
    if (!matchMaterial(fm.material_detail)) continue;
    const tanggal = String(fm.tanggal).slice(0, 10);
    const material = String(fm.material_detail || '').trim();
    const idx = planIdx(tanggal);
    const plan = resolveDtPlan(idx, fm.excavator_code, material, canonJob, r.dump_truck_id, fm.jarak_km);
    const g = core.grossNet(r.ritase_count, r.nonprod_count, null);
    const fac = resolveFactor(factors, kategoriOf(fm.material_type), r.dt_tipe, material, tanggal);
    const key = `dumptruck|${tanggal}|${String(fm.shift_id)}|${String(r.dump_truck_id)}|${canonJob}|${upper(material)}`;
    let cell = dtCellByKey.get(key);
    if (!cell) {
      const hmKey = `${tanggal}|${String(fm.shift_id)}|${String(r.dump_truck_id)}|${canonJob}`;
      const hmInfo = hmFor(hmKey, material);
      cell = { key, tanggal, shift: fm.nama_shift, shift_id: fm.shift_id, dtId: String(r.dump_truck_id),
        dtCode: r.dt_code, parentExcavator: fm.excavator_code, parentExcavatorId: String(fm.excavator_id),
        area: fm.pit_area, job: canonJob, material, gross: 0, net: 0, rows: 0, missingFactorRows: 0,
        hmInfo, plan, fleetIds: new Set(), rids: [] };
      dtCellByKey.set(key, cell);
    }
    cell.rows += 1;
    cell.fleetIds.add(String(fm.id));
    cell.rids.push(String(r.id));
    if (!fac) { cell.missingFactorRows += 1; continue; }
    cell.gross += g.grossRit * fac.value;
    cell.net += g.netRit * fac.value;
  }
  for (const cell of dtCellByKey.values()) {
    const st = core.deriveControlStatus({
      ambiguous: cell.hmInfo.ambiguous,
      missingPlan: cell.plan.productivity == null,
      missingHm: !cell.hmInfo.ambiguous && cell.hmInfo.hm <= EPS && cell.gross > EPS,
      missingFactor: cell.missingFactorRows > 0,
    });
    const reasons = [...st.reasons];
    if (!cell.hmInfo.ambiguous && cell.hmInfo.hm <= EPS && cell.gross > EPS) {
      reasons.push(core.REASONS.RITASE_WITHOUT_HM);
      ritaseWithoutHmCells += 1;
    }
    const ach = core.achievementOf({ grossVol: cell.gross, netVol: cell.net, hm: cell.hmInfo.hm,
      planHm: cell.plan.productivity != null && cell.hmInfo.hm > EPS ? [{ plan: cell.plan.productivity, hm: cell.hmInfo.hm }] : [] });
    pushCell({
      control_key: cell.key, entity_type: 'dumptruck', tanggal: cell.tanggal, shift: cell.shift, shift_id: cell.shift_id,
      entity_id: cell.dtId, entity_code: cell.dtCode, entity_name: null,
      parent_unit_id: cell.parentExcavatorId, parent_unit_code: cell.parentExcavator,
      area: cell.area, job: cell.job, material: cell.material, unit: f.unit,
      plan_productivity: cell.plan.productivity, plan_version_id: cell.plan.versionId,
      gross_volume: cell.gross, net_volume: cell.net, hm_hours: cell.hmInfo.hm,
      actual_productivity: ach.actual, net_productivity: ach.netActual,
      weighted_plan_productivity: ach.weightedPlan, expected_production: ach.expected,
      achievement_percentage: ach.achievement, net_achievement_percentage: ach.netAchievement,
      complete: ach.complete && st.status === 'ready',
      control_status: st.status, reason_codes: reasons,
      source_counts: { ritaseRows: cell.rows, workLogSegments: cell.hmInfo.group ? cell.hmInfo.group.segs.length : 0, planningVersions: cell.plan.versionId ? 1 : 0, truckFactors: cell.rows - cell.missingFactorRows },
      lineage: { fleet_ids: [...cell.fleetIds], ritase_ids: cell.rids.slice(0, 20), segment_ids: cell.hmInfo.group ? cell.hmInfo.group.ids.slice(0, 20) : [], plan_version_id: cell.plan.versionId, formula_version: core.FORMULA_VERSION, calculated_at: new Date().toISOString() },
    });
    if (cell.hmInfo.group && !cell.hmInfo.ambiguous && cell.hmInfo.hm > EPS) {
      const byDr = new Map();
      for (const s of cell.hmInfo.group.segs) {
        if (!s.operator_id) continue;
        const k = String(s.operator_id);
        if (!byDr.has(k)) byDr.set(k, { key: k, hm: 0, nama: s.operator_nama });
        byDr.get(k).hm += Number(s.total_hm) || 0;
      }
      const shares = core.allocateHmShare(cell.gross, [...byDr.values()]);
      const netShares = core.allocateHmShare(cell.net, [...byDr.values()]);
      for (const m of shares) {
        const netM = netShares.find(x => x.key === m.key);
        const a = core.achievementOf({ grossVol: m.volume, netVol: netM ? netM.volume : 0, hm: m.hm,
          planHm: cell.plan.productivity != null && m.hm > EPS ? [{ plan: cell.plan.productivity, hm: m.hm }] : [] });
        const pst = core.deriveControlStatus({ missingPlan: cell.plan.productivity == null, missingHm: m.hm <= EPS, missingFactor: cell.missingFactorRows > 0 });
        pushCell({
          control_key: `driver|${cell.tanggal}|${String(cell.shift_id)}|${m.key}|${cell.job}|${upper(cell.material)}`,
          entity_type: 'driver', tanggal: cell.tanggal, shift: cell.shift, shift_id: cell.shift_id,
          entity_id: m.key, entity_code: m.nama || m.key, entity_name: m.nama || null,
          parent_unit_id: cell.dtId, parent_unit_code: cell.dtCode,
          area: cell.area, job: cell.job, material: cell.material, unit: f.unit,
          plan_productivity: cell.plan.productivity, plan_version_id: cell.plan.versionId,
          gross_volume: m.volume, net_volume: netM ? netM.volume : 0, hm_hours: m.hm,
          actual_productivity: a.actual, net_productivity: a.netActual,
          weighted_plan_productivity: a.weightedPlan, expected_production: a.expected,
          achievement_percentage: a.achievement, net_achievement_percentage: a.netAchievement,
          complete: a.complete && pst.status === 'ready',
          control_status: pst.status, reason_codes: pst.reasons,
          source_counts: { ritaseRows: cell.rows, workLogSegments: cell.hmInfo.group.segs.length, planningVersions: cell.plan.versionId ? 1 : 0, truckFactors: cell.rows - cell.missingFactorRows },
          lineage: { fleet_ids: [...cell.fleetIds], segment_ids: cell.hmInfo.group.ids.slice(0, 20), plan_version_id: cell.plan.versionId, formula_version: core.FORMULA_VERSION, operator_share_version: core.OPERATOR_SHARE_VERSION, calculated_at: new Date().toISOString() },
        });
      }
    }
  }

  // HM tanpa ritase
  for (const g of groups.values()) {
    if (g.ambiguous || !g.segs.length) continue;
    const hm = g.segs.reduce((s, x) => s + (Number(x.total_hm) || 0), 0);
    if (!(hm > EPS)) continue;
    if (g.fleetIds && g.fleetIds.length) continue;
    if (f.job && upper(g.key.split('|')[3]) !== upper(canonJobFilter)) continue;
    hmWithoutRitaseCells += 1;
    const kelas = String(g.kelas || '');
    pushCell({
      control_key: `hm-saja|${g.tanggal}|${String(g.shift_id)}|${String(g.equipment_id)}|${g.key.split('|')[3]}|`,
      entity_type: kelas === 'Excavator' ? 'excavator' : 'dumptruck',
      tanggal: g.tanggal, shift: g.shift, shift_id: g.shift_id,
      entity_id: String(g.equipment_id), entity_code: g.code, entity_name: null,
      area: g.segs[0].area_name, job: g.key.split('|')[3], material: '', unit: f.unit,
      plan_productivity: null, plan_version_id: null,
      gross_volume: 0, net_volume: 0, hm_hours: hm,
      actual_productivity: null, net_productivity: null,
      weighted_plan_productivity: null, expected_production: 0,
      achievement_percentage: null, net_achievement_percentage: null,
      complete: false, control_status: 'incomplete', reason_codes: [core.REASONS.HM_WITHOUT_RITASE],
      source_counts: { ritaseRows: 0, workLogSegments: g.segs.length, planningVersions: 0, truckFactors: 0 },
      lineage: { fleet_ids: [], segment_ids: g.ids.slice(0, 20), plan_version_id: null, formula_version: core.FORMULA_VERSION, calculated_at: new Date().toISOString() },
    });
  }

  // DW exclusion rows (entity_type mengikuti kelas unit)
  const dwEntityType = kelas => (String(kelas) === 'Dump Truck' ? 'dumptruck'
    : String(kelas) === 'Excavator' ? 'excavator' : 'other');
  for (const g of dwGroups.values()) {
    pushCell({
      control_key: `dw|${g.tanggal}|${String(g.shift_id)}|${String(g.equipment_id)}|DW|`,
      entity_type: dwEntityType(g.kelas),
      tanggal: g.tanggal, shift: g.shift, shift_id: g.shift_id,
      entity_id: String(g.equipment_id), entity_code: g.code, entity_name: null,
      area: '', job: 'DW', material: '', unit: f.unit,
      plan_productivity: null, plan_version_id: null,
      gross_volume: 0, net_volume: 0, hm_hours: g.hm,
      actual_productivity: null, net_productivity: null,
      weighted_plan_productivity: null, expected_production: 0,
      achievement_percentage: null, net_achievement_percentage: null,
      complete: false, control_status: 'excluded', reason_codes: [core.REASONS.EXCLUDED_DW],
      source_counts: { ritaseRows: 0, workLogSegments: g.segments, planningVersions: 0, truckFactors: 0 },
      lineage: { fleet_ids: [], segment_ids: g.ids.slice(0, 20), plan_version_id: null, formula_version: core.FORMULA_VERSION, calculated_at: new Date().toISOString() },
      operators: [...g.operators],
    });
  }

  /* 4) agregat ranking per (entity_type, entity, job, material) */
  const agg = new Map();
  for (const c of cells) {
    if (!['excavator', 'dumptruck', 'operator', 'driver'].includes(c.entity_type)) continue;
    if (c.control_status === 'excluded' || c.control_status === 'ambiguous') continue;
    const k = `${c.entity_type}|${c.entity_id}|${c.job}|${upper(c.material)}`;
    let a = agg.get(k);
    if (!a) {
      a = { entity_type: c.entity_type, entity_id: c.entity_id, entity_code: c.entity_code, entity_name: c.entity_name,
        parent_unit_code: c.parent_unit_code, job: c.job, material: upper(c.material), unit: c.unit,
        gross_volume: 0, net_volume: 0, hm_hours: 0, planHm: [], incompleteCells: 0, completeCells: 0 };
      agg.set(k, a);
    }
    a.gross_volume += c.gross_volume || 0;
    a.net_volume += c.net_volume || 0;
    a.hm_hours += c.hm_hours || 0;
    // Hanya sel ready yang membentuk expected; sel incomplete menandai baris
    // agar tak masuk ranking (tidak dirata-rata, tidak jadi 0%).
    if (c.complete) {
      if (c.plan_productivity != null && (c.hm_hours || 0) > EPS) {
        a.planHm.push({ plan: c.plan_productivity, hm: c.hm_hours });
      }
      a.completeCells += 1;
    } else if ((c.hm_hours || 0) > EPS || (c.gross_volume || 0) > EPS) {
      a.incompleteCells += 1;
    }
  }
  const rows = [...agg.values()].map(a => {
    const ach = core.achievementOf({ grossVol: a.gross_volume, netVol: a.net_volume, hm: a.hm_hours, planHm: a.planHm });
    return { ...a, planHm: undefined, expected_production: ach.expected,
      weighted_plan_productivity: ach.weightedPlan, actual_productivity: ach.actual,
      net_productivity: ach.netActual, achievement_percentage: ach.achievement,
      net_achievement_percentage: ach.netAchievement,
      complete: ach.complete && a.incompleteCells === 0,
      data_quality: ach.complete && a.incompleteCells === 0 ? 'complete' : 'incomplete' };
  });

  const byType = t => core.rankTop(rows.filter(r => r.entity_type === t), 10);
  const lowByType = t => core.rankLow(rows.filter(r => r.entity_type === t), 10);
  const rankings = {
    excavators: byType('excavator'),
    dumpTrucks: byType('dumptruck'),
    excavatorOperators: byType('operator'),
    dumpTruckDrivers: byType('driver'),
    lowExcavatorOperators: lowByType('operator'),
    lowDumpTruckDrivers: lowByType('driver'),
  };

  const missingHm = rows.filter(r => (r.gross_volume || 0) > EPS && (r.hm_hours || 0) <= EPS).length;
  const missingPlan = cells.filter(c => c.control_status === 'incomplete' && (c.reason_codes || []).includes(core.REASONS.MISSING_PLAN)).length;
  const quality = {
    missingHm,
    missingPlan,
    missingTruckFactor: missingTruckFactorRows,
    ambiguousMaterial: ambiguousGroups,
    ritaseWithoutHm: ritaseWithoutHmCells,
    hmWithoutRitase: hmWithoutRitaseCells,
    excludedDwSegments,
    excludedDwHmHours: Math.round(excludedDwHm * 1000) / 1000,
  };

  const sumImpact = (list, field) => list.filter(c => c.control_status === 'ready').reduce((s, c) => s + (Number(c[field]) || 0), 0);
  const readyCells = cells.filter(c => c.control_status === 'ready');
  const exclCells = cells.filter(c => c.control_status === 'excluded');
  const dwCells = cells.filter(c => (c.reason_codes || []).includes(core.REASONS.EXCLUDED_DW));
  const controlHighlights = [
    { key: 'ready', label: 'Siap Ranking', count: readyCells.length,
      impact_value: Math.round(sumImpact(readyCells, 'gross_volume') * 1000) / 1000, impact_unit: f.unit === 'Ton/Hr' ? 'Ton' : 'BCM',
      filter: { control_status: 'ready' } },
    { key: 'excluded', label: 'Dikecualikan', count: exclCells.length,
      impact_value: 0, impact_unit: f.unit === 'Ton/Hr' ? 'Ton' : 'BCM', filter: { control_status: 'excluded' } },
    { key: 'excluded_dw', label: 'JOB DW Dikecualikan', count: dwCells.length,
      impact_value: Math.round(dwCells.reduce((s, c) => s + (Number(c.hm_hours) || 0), 0) * 1000) / 1000, impact_unit: 'HM',
      filter: { control_status: 'excluded', reason_code: core.REASONS.EXCLUDED_DW } },
    { key: 'missing_plan', label: 'Plan Hilang', count: quality.missingPlan,
      impact_value: 0, impact_unit: f.unit === 'Ton/Hr' ? 'Ton' : 'BCM', filter: { reason_code: core.REASONS.MISSING_PLAN } },
    { key: 'missing_hm', label: 'HM Hilang', count: quality.missingHm,
      impact_value: 0, impact_unit: f.unit === 'Ton/Hr' ? 'Ton' : 'BCM', filter: { reason_code: core.REASONS.MISSING_HM } },
    { key: 'missing_factor', label: 'Truck Factor Hilang', count: quality.missingTruckFactor,
      impact_value: 0, impact_unit: f.unit === 'Ton/Hr' ? 'Ton' : 'BCM', filter: { reason_code: core.REASONS.MISSING_TRUCK_FACTOR } },
    { key: 'ambiguous', label: 'Material Ambigu', count: quality.ambiguousMaterial,
      impact_value: 0, impact_unit: f.unit === 'Ton/Hr' ? 'Ton' : 'BCM', filter: { reason_code: core.REASONS.AMBIGUOUS_MATERIAL } },
  ];

  return { cells, rankings, quality, controlHighlights, filters: f };
}

async function getRankingReport(query = {}) {
  const f = parseFilters(query);
  const data = await loadDomainData(pool, f);
  const domain = buildDomain(data, f);
  return {
    meta: {
      tanggal_dari: f.dari, tanggal_sampai: f.sampai, planning_type: f.planning_type,
      unit: f.unit, production_basis: 'gross_including_nonprod',
      data_source: 'data_control', aggregation_method: 'hm_weighted_average',
      job_scope: 'spo_deployed_only', deployed_jobs: data.deployedJobs,
      formula_version: core.FORMULA_VERSION, operator_share_version: core.OPERATOR_SHARE_VERSION,
      generated_at: new Date().toISOString(),
    },
    rankings: domain.rankings,
    quality: domain.quality,
    controlHighlights: domain.controlHighlights,
  };
}

async function getDataControl(query = {}) {
  const f = parseFilters(query);
  const data = await loadDomainData(pool, f);
  const domain = buildDomain(data, f);
  let rows = domain.cells;
  if (query.entity_type) rows = rows.filter(c => String(c.entity_type) === String(query.entity_type));
  const statuses = String(query.control_status || '').split(',').map(s => s.trim()).filter(Boolean);
  if (statuses.length) rows = rows.filter(c => statuses.includes(String(c.control_status)));
  const reasons = String(query.reason_code || '').split(',').map(s => s.trim()).filter(Boolean);
  if (reasons.length) rows = rows.filter(c => (c.reason_codes || []).some(r => reasons.includes(String(r))));
  const sorts = {
    tanggal: (a, b) => String(b.tanggal).localeCompare(String(a.tanggal)),
    achievement_percentage: (a, b) => (Number(b.achievement_percentage) || -Infinity) - (Number(a.achievement_percentage) || -Infinity),
    actual_productivity: (a, b) => (Number(b.actual_productivity) || -Infinity) - (Number(a.actual_productivity) || -Infinity),
    gross_volume: (a, b) => (Number(b.gross_volume) || 0) - (Number(a.gross_volume) || 0),
  };
  const sortFn = sorts[query.sort] || sorts.tanggal;
  rows = [...rows].sort(sortFn);
  if (String(query.dir || '').toLowerCase() === 'asc') rows.reverse();
  const pageSize = Math.max(1, Math.min(200, Number(query.page_size) || 50));
  const page = Math.max(1, Number(query.page) || 1);
  const total = rows.length;
  const summarySrc = domain.cells;
  const count = pred => summarySrc.filter(pred).length;
  return {
    meta: {
      formula_version: core.FORMULA_VERSION, operator_share_version: core.OPERATOR_SHARE_VERSION,
      data_source: 'authoritative_inputs', row_formula: 'actual_productivity=gross_volume/hm_hours',
      job_scope: 'spo_deployed_only', deployed_jobs: data.deployedJobs,
      generated_at: new Date().toISOString(), page, page_size: pageSize, total_rows: total,
    },
    summary: {
      ...core.readinessSummary({
        ready: count(c => c.control_status === 'ready'),
        incomplete: count(c => c.control_status === 'incomplete'),
        ambiguous: count(c => c.control_status === 'ambiguous'),
        excluded: count(c => c.control_status === 'excluded'),
      }),
      missingPlan: domain.quality.missingPlan,
      missingHm: domain.quality.missingHm,
      missingTruckFactor: domain.quality.missingTruckFactor,
      ambiguousMaterial: domain.quality.ambiguousMaterial,
      excludedDwSegments: domain.quality.excludedDwSegments,
      excludedDwHmHours: domain.quality.excludedDwHmHours,
    },
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
  };
}

module.exports = {
  parseFilters, loadDomainData, buildDomain,
  getRankingReport, getDataControl,
  indexPlansForDate, resolveLoaderPlan, resolveDtPlan, resolveFactor,
};
