'use strict';

/* Fuel Ratio Leader Board.
   Authority: allocated Input Fuel liters / productive (net) BCM for
   excavators, and saved Input Fuel liters / validated odometer distance for
   dump trucks.
   OB volume is already BCM. Coal volume is converted per material using a
   locked density snapshot when available, otherwise the effective plan density.
   Ratios are always aggregated as ratio-of-sums, never averaged. */

const { pool } = require('../config/db');
const Productivity = require('./productivityRanking');

const FORMULA_VERSION = 'fuel-ratio-ranking-mixed-basis-v2';
const EPS = 1e-9;
const REASONS = Object.freeze({
  MISSING_FUEL_ALLOCATION: 'MISSING_FUEL_ALLOCATION',
  FUEL_WITHOUT_PRODUCTION: 'FUEL_WITHOUT_PRODUCTION',
  PRODUCTION_WITHOUT_FUEL: 'PRODUCTION_WITHOUT_FUEL',
  FUEL_AMBIGUOUS_MATERIAL: 'FUEL_AMBIGUOUS_MATERIAL',
  MISSING_DENSITY: 'MISSING_DENSITY',
  CONFLICTING_DENSITY: 'CONFLICTING_DENSITY',
  ZERO_PRODUCTIVE_BCM: 'ZERO_PRODUCTIVE_BCM',
  MISSING_DISTANCE_KM: 'MISSING_DISTANCE_KM',
  AMBIGUOUS_DISTANCE_ALLOCATION: 'AMBIGUOUS_DISTANCE_ALLOCATION',
  MISSING_TRUCK_FACTOR: 'MISSING_TRUCK_FACTOR',
});

const upper = value => String(value || '').trim().toUpperCase();
const day = value => String(value || '').slice(0, 10);
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 6) => value == null ? null : Number(Number(value).toFixed(digits));
const groupKey = (...values) => values.map(value => String(value ?? '')).join('|');
const entityTypeForClass = value => String(value || '') === 'Excavator' ? 'excavator'
  : String(value || '') === 'Dump Truck' ? 'dumptruck' : 'other';

function canonicalJob(raw, jobs) {
  const input = upper(raw);
  const found = (jobs || []).find(row => upper(row.job_code) === input || upper(row.job_desc) === input);
  return upper(found?.job_code || input);
}

async function loadFuelRatioData(db, filters) {
  const base = await Productivity.loadDomainData(db, filters);
  const range = [filters.dari, filters.sampai];
  const [fuel, allocations, snapshots] = await Promise.all([
    db.query(`/* fr_fuel */
      SELECT f.id, f.tanggal::text AS tanggal, f.shift_id, f.equipment_id,
             f.operator_id, f.fuel_filled::float AS fuel_filled,
             f.distance_km::float AS distance_km,
             e.kode_alat, e.kelas_alat, u.nama AS fuel_operator_name
      FROM fuel_logs f
      JOIN equipment e ON e.id=f.equipment_id
      LEFT JOIN users u ON u.id=f.operator_id
      WHERE f.deleted_at IS NULL AND f.tanggal >= $1 AND f.tanggal <= $2
      ORDER BY f.tanggal,f.created_at,f.id`, range),
    db.query(`/* fr_allocations */
      SELECT a.fuel_log_id,a.allocations,a.revision,a.updated_at
      FROM production_fuel_allocation_sets a
      JOIN fuel_logs f ON f.id=a.fuel_log_id
      WHERE f.deleted_at IS NULL AND f.tanggal >= $1 AND f.tanggal <= $2`, range),
    db.query(`/* fr_density_snapshots */
      SELECT s.fleet_mapping_id,s.density::float AS density,s.plan_ref,s.captured_at
      FROM production_density_snapshots s
      JOIN fleet_mappings fm ON fm.id=s.fleet_mapping_id
      WHERE fm.deleted_at IS NULL AND fm.tanggal >= $1 AND fm.tanggal <= $2`, range),
  ]);
  return { base, fuel: fuel.rows, allocations: allocations.rows, snapshots: snapshots.rows };
}

function filteredFleet(fleet, filters, jobs) {
  const category = String(fleet.material_type || '').toLowerCase() === 'coal' ? 'coal' : 'ob';
  if (category !== filters.planning_type) return false;
  if (filters.area && String(fleet.pit_area || '').trim() !== filters.area) return false;
  const job = canonicalJob(fleet.job_code, jobs);
  const deployedJobs = new Set((filters.deployedJobs || []).map(upper));
  if (!deployedJobs.has(job)) return false;
  if (filters.job && job !== canonicalJob(filters.job, jobs)) return false;
  return true;
}

function materialContexts(base, filters) {
  const jobs = base.jobs || [];
  const scopedFilters = { ...filters, deployedJobs: base.deployedJobs || [] };
  const result = new Map();
  const ritaseByFleet = new Map();
  for (const row of base.ritase || []) {
    if (!ritaseByFleet.has(String(row.fleet_mapping_id))) ritaseByFleet.set(String(row.fleet_mapping_id), new Set());
    ritaseByFleet.get(String(row.fleet_mapping_id)).add(String(row.dump_truck_id));
  }
  const add = (fleet, equipmentId) => {
    const job = canonicalJob(fleet.job_code, jobs);
    const key = groupKey(day(fleet.tanggal), fleet.shift_id, equipmentId, String(fleet.pit_area || '').trim(), job);
    if (!result.has(key)) result.set(key, new Set());
    result.get(key).add(upper(fleet.material_detail));
  };
  for (const fleet of base.fleets || []) {
    if (!filteredFleet(fleet, scopedFilters, jobs)) continue;
    add(fleet, fleet.excavator_id);
    for (const dtId of (ritaseByFleet.get(String(fleet.id)) || [])) add(fleet, dtId);
  }
  return result;
}

function allocationParts(fuel, allocation, base) {
  const liters = finite(fuel.fuel_filled);
  if (!(liters > 0)) return [];
  const deployedJobs = new Set((base.deployedJobs || []).map(upper));
  const explicit = Array.isArray(allocation?.allocations) ? allocation.allocations : [];
  if (explicit.length) return explicit.map(part => ({
    area: String(part.area || part.area_name || '').trim(),
    job: canonicalJob(part.jobCode || part.job_code || part.job, base.jobs),
    liters: finite(part.liters), source: 'manual', allocationRevision: allocation.revision,
  })).filter(part => part.area && deployedJobs.has(part.job) && part.liters > 0);

  const destinations = new Map();
  for (const segment of base.segments || []) {
    if (day(segment.tanggal) !== day(fuel.tanggal)
      || String(segment.shift_id) !== String(fuel.shift_id)
      || String(segment.equipment_id) !== String(fuel.equipment_id)) continue;
    const job = canonicalJob(segment.job, base.jobs);
    if (!job || !deployedJobs.has(job) || job === 'DW' || !String(segment.area_name || '').trim()) continue;
    destinations.set(groupKey(String(segment.area_name).trim(), job), { area: String(segment.area_name).trim(), job });
  }
  return destinations.size === 1
    ? [{ ...[...destinations.values()][0], liters, source: 'worklog', allocationRevision: null }]
    : [];
}

function aggregateProductionCells(productivityDomain) {
  const map = new Map();
  for (const cell of productivityDomain.cells || []) {
    if (!['excavator', 'dumptruck'].includes(cell.entity_type) || cell.job === 'DW') continue;
    const key = groupKey(cell.entity_type, cell.tanggal, cell.shift_id, cell.entity_id, cell.area, cell.job, upper(cell.material));
    let row = map.get(key);
    if (!row) {
      row = {
        key, entity_type: cell.entity_type, tanggal: cell.tanggal, shift: cell.shift, shift_id: cell.shift_id,
        entity_id: String(cell.entity_id), entity_code: cell.entity_code, entity_name: cell.entity_name,
        parent_unit_id: cell.parent_unit_id, parent_unit_code: cell.parent_unit_code,
        area: cell.area, job: cell.job, material: upper(cell.material),
        gross_volume: 0, net_volume: 0, hm_hours: 0, liters: 0, distance_km: 0,
        fleet_ids: new Set(), segment_ids: new Set(), fuel_ids: new Set(),
        fuel_sources: new Set(), source_counts: { ritaseRows: 0, workLogSegments: 0, fuelLogs: 0 },
        source_reason_codes: new Set(),
      };
      map.set(key, row);
    }
    row.gross_volume += Number(cell.gross_volume) || 0;
    row.net_volume += Number(cell.net_volume) || 0;
    row.hm_hours += Number(cell.hm_hours) || 0;
    for (const id of (cell.lineage?.fleet_ids || [])) row.fleet_ids.add(String(id));
    for (const id of (cell.lineage?.segment_ids || [])) row.segment_ids.add(String(id));
    row.source_counts.ritaseRows += Number(cell.source_counts?.ritaseRows) || 0;
    row.source_counts.workLogSegments += Number(cell.source_counts?.workLogSegments) || 0;
    if ((cell.reason_codes || []).includes('MISSING_TRUCK_FACTOR')) row.source_reason_codes.add(REASONS.MISSING_TRUCK_FACTOR);
    if ((cell.reason_codes || []).includes('HM_AMBIGUOUS_MATERIAL')) row.source_reason_codes.add(REASONS.FUEL_AMBIGUOUS_MATERIAL);
  }
  return map;
}

function resolveDensity(row, data, filters) {
  if (filters.planning_type === 'ob') return { value: 1, source: 'ob-native', versionId: null };
  const snapshots = (data.snapshots || []).filter(snapshot => row.fleet_ids.has(String(snapshot.fleet_mapping_id)));
  const unique = [...new Set(snapshots.map(snapshot => finite(snapshot.density)).filter(value => value > 0).map(value => value.toFixed(9)))];
  if (unique.length > 1) return { value: null, source: 'conflict', reason: REASONS.CONFLICTING_DENSITY, versionId: null };
  if (unique.length === 1) return { value: Number(unique[0]), source: 'snapshot', versionId: null };
  const index = Productivity.indexPlansForDate(data.base.versions || [], 'coal', row.tanggal);
  const value = index.densities?.get(upper(row.material));
  return value > 0
    ? { value, source: 'effective-plan', versionId: index.version?.id || null }
    : { value: null, source: 'missing', reason: REASONS.MISSING_DENSITY, versionId: index.version?.id || null };
}

function buildFuelRatioDomain(data, filters) {
  const productivity = Productivity.buildDomain(data.base, filters);
  const production = aggregateProductionCells(productivity);
  const contexts = materialContexts(data.base, filters);
  const allocations = new Map((data.allocations || []).map(row => [String(row.fuel_log_id), row]));
  const issues = [];

  for (const fuel of data.fuel || []) {
    const liters = finite(fuel.fuel_filled);
    if (!(liters > 0)) continue;
    const parts = allocationParts(fuel, allocations.get(String(fuel.id)), data.base);
    if (!parts.length) {
      // Fuel tanpa JOB deployed berada di luar scope Leader Board. Antrean
      // alokasi operasional tetap ditangani oleh Data Produksi/Input Fuel.
      continue;
    }
    for (const part of parts) {
      if (!(part.liters > 0)) continue;
      if (filters.area && part.area !== filters.area) continue;
      const canonicalFilterJob = filters.job ? canonicalJob(filters.job, data.base.jobs) : '';
      if (canonicalFilterJob && part.job !== canonicalFilterJob) continue;
      const contextKey = groupKey(day(fuel.tanggal), fuel.shift_id, fuel.equipment_id, part.area, part.job);
      const materials = contexts.get(contextKey) || new Set();
      if (!materials.size) {
        issues.push({ fuel, part, reason: REASONS.FUEL_WITHOUT_PRODUCTION, liters: part.liters });
        continue;
      }
      if (materials.size > 1) {
        issues.push({ fuel, part, reason: REASONS.FUEL_AMBIGUOUS_MATERIAL, liters: part.liters });
        continue;
      }
      const material = [...materials][0];
      if (filters.material && material !== upper(filters.material)) continue;
      const entityType = entityTypeForClass(fuel.kelas_alat);
      const prodKey = groupKey(entityType, day(fuel.tanggal), fuel.shift_id, fuel.equipment_id, part.area, part.job, material);
      const target = production.get(prodKey);
      if (!target) {
        issues.push({ fuel, part, material, reason: REASONS.FUEL_WITHOUT_PRODUCTION, liters: part.liters });
        continue;
      }
      target.liters += part.liters;
      if (entityType === 'dumptruck') {
        const distanceKm = finite(fuel.distance_km);
        if (parts.length > 1) target.source_reason_codes.add(REASONS.AMBIGUOUS_DISTANCE_ALLOCATION);
        else if (distanceKm > EPS) target.distance_km += distanceKm;
        else target.source_reason_codes.add(REASONS.MISSING_DISTANCE_KM);
      }
      target.fuel_ids.add(String(fuel.id));
      target.fuel_sources.add(part.source);
      target.source_counts.fuelLogs += 1;
    }
  }

  const controls = [];
  const unitControlByKey = new Map();
  for (const row of production.values()) {
    const distanceBased = row.entity_type === 'dumptruck';
    const density = resolveDensity(row, data, filters);
    const reasons = new Set([...row.source_reason_codes]
      .filter(reason => !distanceBased || reason !== REASONS.MISSING_TRUCK_FACTOR));
    if (!distanceBased && !density.value) reasons.add(density.reason || REASONS.MISSING_DENSITY);
    const grossBcm = density.value ? row.gross_volume / density.value : null;
    const netBcm = density.value ? row.net_volume / density.value : null;
    if (!(row.liters > EPS)) reasons.add(REASONS.PRODUCTION_WITHOUT_FUEL);
    if (!distanceBased && row.liters > EPS && !(netBcm > EPS)) reasons.add(REASONS.ZERO_PRODUCTIVE_BCM);
    if (distanceBased && row.liters > EPS && !(row.distance_km > EPS)) reasons.add(REASONS.MISSING_DISTANCE_KM);
    const status = (reasons.has(REASONS.FUEL_AMBIGUOUS_MATERIAL)
      || reasons.has(REASONS.AMBIGUOUS_DISTANCE_ALLOCATION)) ? 'ambiguous'
      : reasons.size ? 'incomplete' : 'ready';
    const control = {
      control_key: `fuel|${row.key}`, metric: 'fuel_ratio', control_status: status,
      reason_codes: [...reasons], entity_type: row.entity_type,
      tanggal: row.tanggal, shift: row.shift, shift_id: row.shift_id,
      entity_id: row.entity_id, entity_code: row.entity_code, entity_name: row.entity_name,
      parent_unit_id: row.parent_unit_id, parent_unit_code: row.parent_unit_code,
      area: row.area, job: row.job, material: row.material, unit: distanceBased ? 'L/Km' : 'L/BCM',
      liters: row.liters, gross_bcm: grossBcm, net_bcm: netBcm,
      distance_km: distanceBased ? row.distance_km : null,
      denominator_value: distanceBased ? row.distance_km : netBcm,
      denominator_unit: distanceBased ? 'Km' : 'BCM',
      hm_hours: row.hm_hours,
      actual_fuel_ratio: row.liters > EPS && (distanceBased ? row.distance_km > EPS : netBcm > EPS)
        ? row.liters / (distanceBased ? row.distance_km : netBcm) : null,
      complete: status === 'ready', density: density.value, density_source: density.source,
      source_counts: row.source_counts,
      lineage: {
        fleet_ids: [...row.fleet_ids], segment_ids: [...row.segment_ids], fuel_log_ids: [...row.fuel_ids],
        allocation_sources: [...row.fuel_sources], density_source: distanceBased ? null : density.source,
        denominator_source: distanceBased ? 'fuel_logs.distance_km' : 'net_productive_bcm',
        plan_version_id: density.versionId, formula_version: FORMULA_VERSION, calculated_at: new Date().toISOString(),
      },
    };
    controls.push(control);
    unitControlByKey.set(row.key, { source: row, control });
  }

  // Personel memakai HM-share dari cell Productivity yang sudah direkonsiliasi.
  for (const { source: unit, control: unitControl } of unitControlByKey.values()) {
    const personType = unit.entity_type === 'excavator' ? 'operator' : 'driver';
    const people = (productivity.cells || []).filter(cell => cell.entity_type === personType
      && day(cell.tanggal) === day(unit.tanggal)
      && String(cell.shift_id) === String(unit.shift_id)
      && String(cell.parent_unit_id) === String(unit.entity_id)
      && String(cell.area || '') === String(unit.area || '')
      && canonicalJob(cell.job, data.base.jobs) === canonicalJob(unit.job, data.base.jobs)
      && upper(cell.material) === upper(unit.material));
    const totalHm = people.reduce((sum, cell) => sum + (Number(cell.hm_hours) || 0), 0);
    if (!(totalHm > EPS)) continue;
    for (const person of people) {
      const hm = Number(person.hm_hours) || 0;
      if (!(hm > EPS)) continue;
      const share = hm / totalHm;
      const reasons = [...unitControl.reason_codes];
      controls.push({
        ...unitControl,
        control_key: `fuel-person|${personType}|${unit.tanggal}|${unit.shift_id}|${person.entity_id}|${unit.entity_id}|${unit.job}|${unit.material}`,
        entity_type: personType, entity_id: String(person.entity_id), entity_code: person.entity_code,
        entity_name: person.entity_name, parent_unit_id: unit.entity_id, parent_unit_code: unit.entity_code,
        liters: unitControl.liters * share, gross_bcm: unitControl.gross_bcm * share,
        net_bcm: unitControl.net_bcm * share, hm_hours: hm,
        distance_km: unit.entity_type === 'dumptruck' ? unitControl.distance_km * share : null,
        denominator_value: unitControl.denominator_value * share,
        actual_fuel_ratio: unitControl.actual_fuel_ratio, reason_codes: reasons,
        source_counts: { ...unitControl.source_counts, workLogSegments: person.source_counts?.workLogSegments || 1 },
        lineage: { ...unitControl.lineage, operator_share: share, operator_share_version: 'hm-share-v1',
          person_attribution_version: 'hm-share-v1' },
      });
    }
  }

  for (const issue of issues) {
    const fuel = issue.fuel;
    const distanceBased = entityTypeForClass(fuel.kelas_alat) === 'dumptruck';
    controls.push({
      control_key: `fuel-issue|${fuel.id}|${issue.reason}`, metric: 'fuel_ratio', control_status: issue.reason === REASONS.FUEL_AMBIGUOUS_MATERIAL ? 'ambiguous' : 'incomplete',
      reason_codes: [issue.reason], entity_type: entityTypeForClass(fuel.kelas_alat),
      tanggal: day(fuel.tanggal), shift: '', shift_id: fuel.shift_id,
      entity_id: String(fuel.equipment_id), entity_code: fuel.kode_alat, entity_name: null,
      area: issue.part?.area || '', job: issue.part?.job || '', material: issue.material || '', unit: distanceBased ? 'L/Km' : 'L/BCM',
      liters: issue.liters, gross_bcm: null, net_bcm: null, hm_hours: null,
      distance_km: distanceBased ? finite(fuel.distance_km) : null,
      denominator_value: null, denominator_unit: distanceBased ? 'Km' : 'BCM',
      actual_fuel_ratio: null, complete: false, density: null, density_source: null,
      source_counts: { ritaseRows: 0, workLogSegments: 0, fuelLogs: 1 },
      lineage: { fleet_ids: [], segment_ids: [], fuel_log_ids: [String(fuel.id)], formula_version: FORMULA_VERSION, calculated_at: new Date().toISOString() },
    });
  }

  const aggregate = new Map();
  for (const cell of controls) {
    if (!['excavator', 'dumptruck', 'operator', 'driver'].includes(cell.entity_type)) continue;
    const key = groupKey(cell.entity_type, cell.entity_id, cell.job, upper(cell.material));
    let row = aggregate.get(key);
    if (!row) {
      row = { entity_type: cell.entity_type, entity_id: cell.entity_id, entity_code: cell.entity_code,
        entity_name: cell.entity_name, parent_unit_code: cell.parent_unit_code,
        job: cell.job, material: upper(cell.material), unit: cell.unit, liters: 0,
        gross_bcm: 0, net_bcm: 0, distance_km: 0, hm_hours: 0, completeCells: 0, incompleteCells: 0 };
      aggregate.set(key, row);
    }
    row.liters += Number(cell.liters) || 0;
    row.gross_bcm += Number(cell.gross_bcm) || 0;
    row.net_bcm += Number(cell.net_bcm) || 0;
    row.distance_km += Number(cell.distance_km) || 0;
    row.hm_hours += Number(cell.hm_hours) || 0;
    if (cell.complete) row.completeCells += 1;
    else if ((cell.liters || 0) > EPS || (cell.denominator_value || 0) > EPS
      || (cell.gross_bcm || 0) > EPS || (cell.hm_hours || 0) > EPS) row.incompleteCells += 1;
  }
  const rows = [...aggregate.values()].map(row => {
    const distanceBased = ['dumptruck', 'driver'].includes(row.entity_type);
    const denominator = distanceBased ? row.distance_km : row.net_bcm;
    return ({
    ...row, denominator_value: denominator, denominator_unit: distanceBased ? 'Km' : 'BCM',
    actual_fuel_ratio: denominator > EPS && row.liters > EPS ? row.liters / denominator : null,
    complete: row.completeCells > 0 && row.incompleteCells === 0,
    data_quality: row.completeCells > 0 && row.incompleteCells === 0 ? 'complete' : 'incomplete',
  }); });
  const ranked = type => rows.filter(row => row.entity_type === type && row.complete && row.actual_fuel_ratio != null)
    .sort((a, b) => a.actual_fuel_ratio - b.actual_fuel_ratio || b.denominator_value - a.denominator_value)
    .slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }));
  const rankings = {
    excavators: ranked('excavator'), dumpTrucks: ranked('dumptruck'),
    excavatorOperators: ranked('operator'), dumpTruckDrivers: ranked('driver'),
  };
  const countReason = reason => controls.filter(row => row.reason_codes.includes(reason)).length;
  const ready = controls.filter(row => row.control_status === 'ready');
  const incomplete = controls.filter(row => row.control_status === 'incomplete');
  const ambiguous = controls.filter(row => row.control_status === 'ambiguous');
  const quality = {
    missingFuelAllocation: countReason(REASONS.MISSING_FUEL_ALLOCATION),
    fuelWithoutProduction: countReason(REASONS.FUEL_WITHOUT_PRODUCTION),
    productionWithoutFuel: countReason(REASONS.PRODUCTION_WITHOUT_FUEL),
    ambiguousMaterial: countReason(REASONS.FUEL_AMBIGUOUS_MATERIAL),
    missingDensity: countReason(REASONS.MISSING_DENSITY) + countReason(REASONS.CONFLICTING_DENSITY),
    zeroProductiveBcm: countReason(REASONS.ZERO_PRODUCTIVE_BCM),
    missingDistanceKm: countReason(REASONS.MISSING_DISTANCE_KM),
    ambiguousDistanceAllocation: countReason(REASONS.AMBIGUOUS_DISTANCE_ALLOCATION),
    missingTruckFactor: countReason(REASONS.MISSING_TRUCK_FACTOR),
  };
  const impact = (list, field) => round(list.reduce((sum, row) => sum + (Number(row[field]) || 0), 0), 3);
  const controlHighlights = [
    { key: 'readiness', label: 'Kesiapan Data', count: controls.length ? round(ready.length / controls.length * 100, 1) : 100, suffix: '%', filter: {} },
    { key: 'ready', label: 'Siap Ranking', count: ready.length, impact_value: impact(ready, 'liters'), impact_unit: 'L', filter: { control_status: 'ready' } },
    { key: 'fuel_unallocated', label: 'Fuel Belum Dialokasikan', count: quality.missingFuelAllocation, filter: { reason_code: REASONS.MISSING_FUEL_ALLOCATION } },
    { key: 'fuel_without_production', label: 'Fuel Tanpa Produksi', count: quality.fuelWithoutProduction, filter: { reason_code: REASONS.FUEL_WITHOUT_PRODUCTION } },
    { key: 'production_without_fuel', label: 'Produksi Tanpa Fuel', count: quality.productionWithoutFuel, filter: { reason_code: REASONS.PRODUCTION_WITHOUT_FUEL } },
    { key: 'distance', label: 'Jarak DT Bermasalah', count: quality.missingDistanceKm + quality.ambiguousDistanceAllocation,
      filter: { reason_code: `${REASONS.MISSING_DISTANCE_KM},${REASONS.AMBIGUOUS_DISTANCE_ALLOCATION}` } },
    { key: 'density', label: 'Density Hilang', count: quality.missingDensity, filter: { reason_code: `${REASONS.MISSING_DENSITY},${REASONS.CONFLICTING_DENSITY}` } },
    { key: 'material', label: 'Material Ambigu', count: quality.ambiguousMaterial, filter: { reason_code: REASONS.FUEL_AMBIGUOUS_MATERIAL } },
  ];
  return { controls, rankings, quality, controlHighlights,
    deployedJobs: [...new Set((data.base.deployedJobs || []).map(upper))] };
}

async function domainFor(query) {
  const filters = Productivity.parseFilters(query);
  const data = await loadFuelRatioData(pool, filters);
  return { filters, domain: buildFuelRatioDomain(data, filters) };
}

async function getRankingReport(query = {}) {
  const { filters, domain } = await domainFor(query);
  return {
    meta: { tanggal_dari: filters.dari, tanggal_sampai: filters.sampai, planning_type: filters.planning_type,
      unit: 'L/BCM (Excavator) · L/Km (Dump Truck)',
      unit_by_entity: { excavator: 'L/BCM', operator: 'L/BCM', dumptruck: 'L/Km', driver: 'L/Km' },
      production_basis: 'excavator=net_productive_bcm; dumptruck=validated_odometer_distance_km', formula_version: FORMULA_VERSION,
      data_source: 'data_control', aggregation_method: 'ratio_of_sums_by_entity_basis',
      job_scope: 'spo_deployed_only', deployed_jobs: domain.deployedJobs || [],
      ranking_direction: 'ascending', generated_at: new Date().toISOString() },
    rankings: domain.rankings, quality: domain.quality, controlHighlights: domain.controlHighlights,
  };
}

function applyControlFilters(controls, query) {
  let rows = controls;
  if (query.entity_type) rows = rows.filter(row => String(row.entity_type) === String(query.entity_type));
  const statuses = String(query.control_status || '').split(',').map(value => value.trim()).filter(Boolean);
  if (statuses.length) rows = rows.filter(row => statuses.includes(String(row.control_status)));
  const reasons = String(query.reason_code || '').split(',').map(value => value.trim()).filter(Boolean);
  if (reasons.length) rows = rows.filter(row => row.reason_codes.some(reason => reasons.includes(String(reason))));
  const sorters = {
    tanggal: (a, b) => String(b.tanggal).localeCompare(String(a.tanggal)),
    actual_fuel_ratio: (a, b) => (Number(a.actual_fuel_ratio) || Infinity) - (Number(b.actual_fuel_ratio) || Infinity),
    liters: (a, b) => (Number(b.liters) || 0) - (Number(a.liters) || 0),
    net_bcm: (a, b) => (Number(b.net_bcm) || 0) - (Number(a.net_bcm) || 0),
  };
  rows = [...rows].sort(sorters[query.sort] || sorters.tanggal);
  if (String(query.dir || '').toLowerCase() === 'asc' && query.sort !== 'actual_fuel_ratio') rows.reverse();
  if (String(query.dir || '').toLowerCase() === 'desc' && query.sort === 'actual_fuel_ratio') rows.reverse();
  return rows;
}

async function getDataControl(query = {}) {
  const { domain } = await domainFor(query);
  const rows = applyControlFilters(domain.controls, query);
  const pageSize = Math.max(1, Math.min(200, Number(query.page_size) || 50));
  const page = Math.max(1, Number(query.page) || 1);
  const count = status => domain.controls.filter(row => row.control_status === status).length;
  const ready = count('ready'); const incomplete = count('incomplete'); const ambiguous = count('ambiguous');
  const total = ready + incomplete + ambiguous;
  return {
    meta: { formula_version: FORMULA_VERSION, generated_at: new Date().toISOString(), page, page_size: pageSize, total_rows: rows.length, metric: 'fuel_ratio',
      unit_by_entity: { excavator: 'L/BCM', operator: 'L/BCM', dumptruck: 'L/Km', driver: 'L/Km' },
      aggregation_method: 'ratio_of_sums_by_entity_basis',
      job_scope: 'spo_deployed_only', deployed_jobs: domain.deployedJobs || [] },
    summary: { ready, incomplete, ambiguous, excluded: 0, readiness_percentage: total ? ready / total * 100 : 100, ...domain.quality },
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
  };
}

module.exports = {
  FORMULA_VERSION, REASONS, loadFuelRatioData, buildFuelRatioDomain,
  getRankingReport, getDataControl, applyControlFilters,
};
