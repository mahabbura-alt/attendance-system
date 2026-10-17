'use strict';

const { productiveRitase } = require('./ritaseProductivity');
const { normalizeMaterialType } = require('./spoPlanning');

const crypto = require('node:crypto');
const key = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
const groupKey = (...parts) => JSON.stringify(parts.map(key));
const positive = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
const fingerprint = fuel => crypto.createHash('sha256').update(JSON.stringify([
  String(fuel.tanggal), fuel.shift_id, fuel.equipment_id, Number(fuel.fuel_filled)
])).digest('hex');
const identity = fleet => groupKey(fleet.excavator_id, fleet.job_code, fleet.material_detail, fleet.material_type);

function period(year, month) {
  year = Number(year); month = Number(month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw Object.assign(new Error('Tahun/bulan tidak valid.'), { status: 422 });
  }
  return { year, month, start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10), days: new Date(Date.UTC(year, month, 0)).getUTCDate() };
}

function validDestination(part, jobs, areas) {
  const area = areas.find(value => key(value) === key(part?.area));
  const job = jobs.find(value => key(value.jobCode) === key(part?.jobCode));
  return area && job ? { area, jobCode: job.jobCode } : null;
}

function allocateFuel(fuel, workLogs, saved, jobs, areas, rules = [], history = []) {
  const source = fingerprint(fuel);
  if (saved) {
    if (saved.source_fingerprint === source) return { allocations: saved.allocations, mode: 'manual', revision: saved.revision, fingerprint: source };
    const suggestions = (saved.allocations || []).map(part => validDestination(part, jobs, areas)).filter(Boolean);
    return { allocations: [], suggestions, suggestionSource: suggestions.length ? 'Alokasi manual sebelumnya' : null,
      reasonCode: 'source_changed', reason: 'Transaksi fuel berubah; alokasi perlu diperiksa kembali.', revision: saved.revision, fingerprint: source };
  }
  const candidates = new Map(); let invalidInput = false;
  for (const log of workLogs) {
    if (String(log.tanggal) !== String(fuel.tanggal) || log.shift_id !== fuel.shift_id || log.equipment_id !== fuel.equipment_id) continue;
    const job = jobs.find(j => key(j.jobCode) === key(log.job));
    const area = areas.find(a => key(a) === key(log.area_name));
    if (!job || !area) { invalidInput = true; continue; }
    candidates.set(groupKey(area, job.jobCode), { area, jobCode: job.jobCode, liters: Number(fuel.fuel_filled) });
  }
  const inputSuggestions = [...candidates.values()].map(({ area, jobCode }) => ({ area, jobCode }));
  if (invalidInput) return { allocations: [], suggestions: inputSuggestions, suggestionSource: inputSuggestions.length ? 'Input Data valid' : null,
    fingerprint: source, revision: 0, reasonCode: 'input_mismatch', reason: 'JOB/area Input Data belum cocok dengan laporan.' };
  if (candidates.size === 1) return { allocations: [...candidates.values()], mode: 'automatic', fingerprint: source, revision: 0 };
  if (candidates.size > 1) return { allocations: [], suggestions: inputSuggestions, suggestionSource: 'Input Data', fingerprint: source,
    revision: 0, reasonCode: 'ambiguous_input', reason: 'Input Data menunjuk lebih dari satu area/JOB.' };

  const rule = rules.filter(item => item.equipment_id === fuel.equipment_id && String(item.effective_from) <= String(fuel.tanggal))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)) || String(b.created_at).localeCompare(String(a.created_at)))[0];
  const ruleDestination = rule?.is_active === false ? null : validDestination({ area: rule?.area_name, jobCode: rule?.job_code }, jobs, areas);
  if (rule && ruleDestination) return { allocations: [{ ...ruleDestination, liters: Number(fuel.fuel_filled) }], mode: 'rule', ruleId: rule.id,
    fingerprint: source, revision: 0 };

  const previous = history.filter(item => item.equipment_id === fuel.equipment_id && String(item.tanggal) < String(fuel.tanggal))
    .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  const historySuggestions = (previous?.allocations || []).map(part => validDestination(part, jobs, areas)).filter(Boolean);
  const invalidRule = Boolean(rule) && rule.is_active !== false && !ruleDestination;
  return { allocations: [], suggestions: historySuggestions, suggestionSource: historySuggestions.length ? 'Alokasi sebelumnya' : null,
    fingerprint: source, revision: 0, reasonCode: invalidRule ? 'rule_invalid' : 'no_input',
    reason: invalidRule ? 'Aturan unit tidak lagi cocok dengan Area/JOB laporan.' : 'Tidak ada Input Data untuk tanggal, shift, dan unit ini.' };
}

function validateAllocation(parts, liters, jobs, areas) {
  const fail = message => { throw Object.assign(new Error(message), { status: 422 }); };
  if (!Array.isArray(parts) || !parts.length || parts.length > 100) fail('Isi minimal satu alokasi (maksimal 100).');
  const seen = new Set();
  const result = parts.map(part => {
    const area = areas.find(a => key(a) === key(part.area));
    const job = jobs.find(j => key(j.jobCode) === key(part.jobCode));
    if (!area || !job) fail('Area atau JOB tidak tersedia pada laporan.');
    const amount = Number(part.liters);
    if (!positive(part.liters) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) fail('Liter alokasi harus positif, maksimal dua desimal.');
    const id = groupKey(area, job.jobCode);
    if (seen.has(id)) fail('Gabungkan alokasi area/JOB yang sama dalam satu baris.');
    seen.add(id);
    return { area, jobCode: job.jobCode, liters: amount };
  });
  if (Math.abs(result.reduce((sum, p) => sum + p.liters, 0) - Number(liters)) > 0.000001) fail('Total alokasi harus sama dengan liter transaksi fuel.');
  return result;
}

function unionMinutes(rows, startField, finishField) {
  const intervals = rows.filter(r => r[startField] && r[finishField]).map(r => {
    const minutes = time => Number(String(time).slice(0, 2)) * 60 + Number(String(time).slice(3, 5));
    let start = minutes(r[startField]); let finish = minutes(r[finishField]);
    // Use operational shift start as the origin for times after midnight.
    const origin = minutes(r.operational_start || '00:00');
    if (start < origin) start += 1440;
    if (finish < origin) finish += 1440;
    if (finish < start) finish += 1440;
    return [start, finish];
  }).sort((a, b) => a[0] - b[0]);
  if (!intervals.length) return null;
  let total = 0; let [start, finish] = intervals[0];
  for (const next of intervals.slice(1)) {
    if (next[0] <= finish) finish = Math.max(finish, next[1]);
    else { total += finish - start; [start, finish] = next; }
  }
  return total + finish - start;
}

function blankCell() {
  return { materials: {}, production: 0, bcm: 0, hasProduction: false, incomplete: false, densityIncomplete: false,
    distanceIncomplete: false, weightedDistance: 0, distanceWeight: 0, fuel: 0, hasFuel: false, notes: [], sources: [],
    rainMm: null, rainMinutes: null, slipperyMinutes: null };
}

function finishCell(cell) {
  if (cell.manual) {
    // Sumber manual: ritase bukan sumber lagi. Nilai manual menggantikan; sel
    // tanpa nilai manual (manualFilled=false) tampil "—". Fuel tetap dari
    // alokasi fuel sehingga fuel ratio memakai bcm manual.
    const filled = cell.manualFilled;
    return { ...cell, production: filled ? cell.production : null, bcm: filled ? cell.bcm : null,
      distanceKm: cell.distanceIncomplete || !(cell.distanceWeight > 0) ? null : cell.weightedDistance / cell.distanceWeight,
      fuelRatio: filled && cell.hasFuel && cell.bcm != null && cell.bcm > 0 ? cell.fuel / cell.bcm : null,
      fuel: cell.hasFuel ? cell.fuel : null,
      notes: [filled ? 'Produksi manual' : 'Produksi manual belum lengkap', ...cell.notes.filter(n => !/^Produksi manual/i.test(n))] };
  }
  return { ...cell, production: !cell.hasProduction || cell.incomplete ? null : cell.production,
    bcm: !cell.hasProduction || cell.incomplete || cell.densityIncomplete ? null : cell.bcm,
    distanceKm: cell.distanceIncomplete || !(cell.distanceWeight > 0) ? null : cell.weightedDistance / cell.distanceWeight,
    fuelRatio: cell.hasFuel && !cell.incomplete && !cell.densityIncomplete && cell.bcm > 0 ? cell.fuel / cell.bcm : null,
    fuel: cell.hasFuel ? cell.fuel : null, notes: [...new Set(cell.notes)] };
}

function aggregateFuel(values) {
  const cells = Object.values(values);
  const productionCells = cells.filter(cell => cell.hasProduction);
  const fuel = cells.some(cell => cell.hasFuel) ? cells.reduce((sum, cell) => sum + (cell.fuel || 0), 0) : null;
  // Fuel Ratio ALL adalah rasio agregat, bukan rata-rata rasio per JOB:
  // seluruh fuel teralokasi (L) / seluruh produksi valid yang dinormalisasi ke BCM.
  // JOB tanpa transaksi fuel berkontribusi 0 L, tetapi produksinya tetap masuk
  // denominator. Density/produksi yang belum lengkap tetap memblokir rasio agar
  // sistem tidak menampilkan KPI semu.
  const complete = fuel !== null && productionCells.length > 0
    && productionCells.every(cell => cell.bcm !== null && !cell.incomplete && !cell.densityIncomplete);
  const bcm = productionCells.reduce((sum, cell) => sum + (cell.bcm || 0), 0);
  return { fuel, fuelRatio: complete && bcm > 0 ? fuel / bcm : null };
}

function buildReport(data, calculateDistance) {
  const productionJobCodes = new Set((data.jobs || []).map(job => key(job.jobCode)));
  const isProductionJob = value => productionJobCodes.has(key(value));
  data = { ...data,
    catalog: (data.catalog || []).filter(row => isProductionJob(row.jobCode)),
    fleets: (data.fleets || []).filter(row => isProductionJob(row.job_code)),
    rain: (data.rain || []).filter(row => isProductionJob(row.job_code)),
    workLogs: (data.workLogs || []).filter(row => isProductionJob(row.job)),
    manual: (data.manual || []).map(row => ({ ...row,
      allocations: (row.allocations || []).filter(part => isProductionJob(part.jobCode)) })),
  };
  const jobsMap = new Map(data.jobs.map(j => [key(j.jobCode), { ...j,
    materialType: normalizeMaterialType(j.materialType, j.jobCode, j.productionMode || 'prod'), materials: [] }]));
  const areas = [...new Map([...data.areas, ...data.fleets.map(f => f.pit_area), ...data.rain.map(r => r.area_name),
    ...data.manual.flatMap(m => (m.allocations || []).map(a => a.area))]
    .filter(Boolean).map(a => [key(a), a])).values()].sort();
  const jobs = [...jobsMap.values()];
  const addMaterial = (job, name, unit) => {
    if (!job) return;
    const existing = job.materials.find(m => key(m.name) === key(name));
    if (!existing) job.materials.push({ name, unit });
    else if (existing.unit !== unit) existing.unit = 'mixed';
  };
  for (const plan of data.catalog) {
    const job = jobsMap.get(key(plan.jobCode));
    if (!job || key(plan.planningType) !== job.materialType) continue;
    addMaterial(job, plan.material, job.materialType === 'coal' ? 'ton' : 'BCM');
  }
  for (const fleet of data.fleets) {
    const job = jobsMap.get(key(fleet.job_code));
    addMaterial(job, fleet.material_detail || 'Material belum diatur', job?.materialType === 'coal' ? 'ton' : 'BCM');
  }
  jobs.forEach(j => { j.unit = new Set(j.materials.map(m => m.unit)).size > 1 ? 'mixed' : j.materials[0]?.unit || 'BCM'; });
  const cells = new Map();
  const getCell = (area, date, shift, job) => {
    const id = groupKey(area, date, shift, job);
    if (!cells.has(id)) cells.set(id, blankCell());
    return cells.get(id);
  };
  const hourMap = new Map(); const allocationMap = new Map();
  for (const row of data.hours) { if (!hourMap.has(row.fleet_mapping_id)) hourMap.set(row.fleet_mapping_id, []); hourMap.get(row.fleet_mapping_id).push(row); }
  for (const row of data.distances) { if (!allocationMap.has(row.fleet_mapping_id)) allocationMap.set(row.fleet_mapping_id, []); allocationMap.get(row.fleet_mapping_id).push(row); }
  const snapshots = new Map(data.snapshots.map(s => [groupKey(s.fleet_mapping_id, s.identity_key), s]));
  const densityCandidates = [];
  for (const fleet of data.fleets) {
    const cell = getCell(fleet.pit_area, fleet.tanggal, fleet.shift_id, fleet.job_code);
    const job = jobsMap.get(key(fleet.job_code));
    const planningType = job?.materialType;
    const rows = hourMap.get(fleet.id) || [];
    if (!rows.length) continue;
    const trucks = new Map(); let volume = 0; let valid = true;
    for (const row of rows) {
      const productive = productiveRitase(row.ritase_count, row.nonprod_ritase_count || 0);
      if (productive > 0 && !positive(row.factor_value)) valid = false;
      volume += productive * (positive(row.factor_value) ? Number(row.factor_value) : 0);
      if (!trucks.has(row.dump_truck_id)) trucks.set(row.dump_truck_id, {
        dump_truck_id: row.dump_truck_id, factor_value: row.factor_value, hours: {}, nonprod_hours: {}
      });
      trucks.get(row.dump_truck_id).hours[row.period_hour] = Number(row.ritase_count);
      trucks.get(row.dump_truck_id).nonprod_hours[row.period_hour] = Number(row.nonprod_ritase_count) || 0;
    }
    const matches = data.catalog.filter(p => (!p.catalogDate || String(p.catalogDate) === String(fleet.tanggal))
      && p.equipmentId === fleet.excavator_id && key(p.jobCode) === key(fleet.job_code)
      && key(p.material) === key(fleet.material_detail)
      && key(p.planningType) === planningType);
    const snap = snapshots.get(groupKey(fleet.id, identity(fleet)));
    const plan = matches.length === 1 ? matches[0] : null;
    const density = snap?.density ?? plan?.density;
    const coal = planningType === 'coal';
    if (planningType !== 'ob' && planningType !== 'coal') {
      valid = false;
      cell.notes.push('Jenis Material JOB belum ditentukan di SPO');
    }
    if (coal && !snap && positive(density)) densityCandidates.push({ fleetId: fleet.id, identityKey: identity(fleet), density: Number(density), planRef: plan.planRef, planUpdatedAt: plan.updatedAt });
    cell.hasProduction = true;
    cell.incomplete ||= !valid;
    cell.densityIncomplete ||= coal && volume > 0 && !positive(density);
    cell.production += volume;
    cell.bcm += coal ? (positive(density) ? volume / Number(density) : 0) : volume;
    const material = jobsMap.get(key(fleet.job_code))?.materials.find(m => key(m.name) === key(fleet.material_detail || 'Material belum diatur'));
    const materialKey = material?.name || fleet.material_detail || 'Material belum diatur';
    const previous = cell.materials[materialKey];
    cell.materials[materialKey] = !valid || previous === null || material?.unit === 'mixed' ? null : (previous || 0) + volume;
    if (material?.unit === 'mixed') cell.notes.push('Material memiliki satuan campuran; periksa JOB/planning');
    if (!valid) cell.notes.push('Truck factor belum lengkap');
    if (coal && !positive(density)) cell.notes.push('Density belum tersedia / planning ambigu');
    let distance;
    try { distance = calculateDistance({ setupDistanceKm: fleet.jarak_km, trucks: [...trucks.values()], allocations: allocationMap.get(fleet.id) || [] }); }
    catch (error) { distance = { complete: false, error: error.message }; }
    if (volume > 0 && !distance.complete) { cell.distanceIncomplete = true; cell.notes.push(distance.error || 'Jarak final belum lengkap'); }
    const bcmWeight = coal ? (positive(density) ? volume / Number(density) : null) : volume;
    if (volume > 0 && bcmWeight === null) cell.distanceIncomplete = true;
    if (distance.complete && valid && bcmWeight !== null) { cell.weightedDistance += bcmWeight * distance.finalDistanceKm; cell.distanceWeight += bcmWeight; }
    cell.sources.push({ fleetId: fleet.id, unit: fleet.excavator_kode, material: materialKey, production: valid ? volume : null,
      density: coal && positive(density) ? Number(density) : null, densitySource: snap ? 'snapshot' : 'planning', planRef: snap?.plan_ref || plan?.planRef,
      distanceKm: distance.complete ? distance.finalDistanceKm : null });
  }
  const queue = []; const allocated = []; let totalFuel = 0; let allocatedFuel = 0;
  const manualMap = new Map(data.manual.map(m => [m.fuel_log_id, m]));
  const suggestionHistory = [...(data.allocationHistory || []), ...data.manual];
  const workIndex = new Map();
  for (const log of data.workLogs) {
    const id = groupKey(log.tanggal, log.shift_id, log.equipment_id);
    if (!workIndex.has(id)) workIndex.set(id, []);
    workIndex.get(id).push(log);
  }
  for (const fuel of data.fuel) {
    totalFuel += Number(fuel.fuel_filled);
    const workLogs = workIndex.get(groupKey(fuel.tanggal, fuel.shift_id, fuel.equipment_id)) || [];
    const allocation = allocateFuel(fuel, workLogs, manualMap.get(fuel.id), jobs, areas, data.rules || [], suggestionHistory);
    const item = { id: fuel.id, tanggal: fuel.tanggal, shiftId: fuel.shift_id, equipmentId: fuel.equipment_id,
      unit: fuel.kode_alat, liters: Number(fuel.fuel_filled), ...allocation };
    if (!allocation.allocations.length) { queue.push(item); continue; }
    allocated.push(item);
    for (const part of allocation.allocations) {
      const cell = getCell(part.area, fuel.tanggal, fuel.shift_id, part.jobCode);
      cell.fuel += Number(part.liters); cell.hasFuel = true; allocatedFuel += Number(part.liters);
    }
  }
  const rainMap = new Map();
  for (const log of data.workLogs) {
    if (log.remark && jobsMap.has(key(log.job)) && areas.some(area => key(area) === key(log.area_name))) {
      getCell(log.area_name, log.tanggal, log.shift_id, log.job).notes.push(String(log.remark));
    }
  }
  for (const rain of data.rain) {
    const id = groupKey(rain.area_name, rain.operational_date, rain.shift_id, rain.job_code);
    if (!rainMap.has(id)) rainMap.set(id, []);
    rainMap.get(id).push(rain);
  }
  for (const rows of rainMap.values()) {
    const row = rows[0]; const cell = getCell(row.area_name, row.operational_date, row.shift_id, row.job_code);
    cell.rainMinutes = unionMinutes(rows, 'rain_start', 'rain_finish');
    cell.slipperyMinutes = unionMinutes(rows, 'slippery_start', 'slippery_finish');
    const events = new Map(); let incomplete = false;
    for (const r of rows.filter(r => r.rain_start)) {
      const eventKey = groupKey(r.rain_start, r.rain_finish);
      if (r.intensity_mm == null || (events.has(eventKey) && events.get(eventKey) !== Number(r.intensity_mm))) incomplete = true;
      events.set(eventKey, Number(r.intensity_mm));
    }
    cell.rainMm = events.size && !incomplete ? [...events.values()].reduce((a, b) => a + b, 0) : null;
    if (incomplete) cell.notes.push('Pengukuran hujan belum lengkap / bertentangan');
  }
  // Sumber data manual per area+JOB: nilai produksi diketik admin menggantikan
  // agregasi Input Ritase pada rekap bulanan (TOTAL bulan dan fuel ratio).
  const manualSources = new Map((data.manualSources || []).map(m => [groupKey(m.area, m.job_code), m]));
  const manualOverride = new Map((data.manualOverrides || []).map(o =>
    [groupKey(o.area, o.job_code, o.tanggal, o.shift_id, o.material), Number(o.value)]));
  // Persisted manual values are independent production sources, even when
  // no fleet, fuel or rainfall record has created a cell for this shift.
  for (const row of data.manualOverrides || []) {
    if (manualSources.get(groupKey(row.area, row.job_code))?.source === 'manual') {
      getCell(row.area, row.tanggal, row.shift_id, row.job_code);
    }
  }
  for (const area of areas) {
    for (const job of jobs) {
      const source = manualSources.get(groupKey(area, job.jobCode));
      if (!source || source.source !== 'manual') continue;
      const coal = job.unit === 'ton';
      for (let day = 1; day <= data.period.days; day++) {
        const date = `${data.period.start.slice(0, 8)}${String(day).padStart(2, '0')}`;
        for (const shift of data.shifts) {
          // Cells include independent manual entries as well as operational data.
          const cell = cells.get(groupKey(area, date, shift.id, job.jobCode));
          if (!cell) continue;
          // Sumber manual: ritase bukan sumber lagi. Nilai manual menggantikan;
          // sel tanpa nilai manual (manualFilled=false) tampil "—".
          cell.manual = true;
          cell.production = 0; cell.bcm = 0;
          const byMaterial = {}; let hasAny = false;
          for (const material of job.materials) {
            const v = manualOverride.get(groupKey(area, job.jobCode, date, shift.id, material.name));
            if (v == null) continue;
            hasAny = true; byMaterial[material.name] = v;
            cell.production += v;
            if (coal) {
              const density = (cell.sources.find(s => key(s.material) === key(material.name)) || {}).density;
              if (positive(density)) cell.bcm += v / Number(density);
            } else cell.bcm += v;
          }
          const totalOverride = manualOverride.get(groupKey(area, job.jobCode, date, shift.id, 'TOTAL'));
          // TOTAL lama hanya fallback untuk data sebelum total menjadi kolom
          // turunan. Jika rincian material tersedia, jumlah material berwenang.
          if (!hasAny && totalOverride != null) {
            hasAny = true; cell.production = totalOverride;
            if (coal) {
              const density = (cell.sources.find(s => s.density != null) || {}).density;
              cell.bcm = positive(density) ? totalOverride / Number(density) : null;
            } else cell.bcm = totalOverride;
          }
          cell.manualFilled = hasAny;
          cell.hasProduction = true;
          // Sumber manual: hanya nilai yang diketik admin yang tampil; material
          // tanpa nilai manual tampil "—" (tidak memakai nilai ritase).
          cell.materials = byMaterial;
        }
      }
    }
  }
  const areaTables = areas.map(area => {
    const totals = Object.fromEntries(jobs.map(j => [j.jobCode, blankCell()]));
    const rows = [];
    for (let day = 1; day <= data.period.days; day++) {
      const date = `${data.period.start.slice(0, 8)}${String(day).padStart(2, '0')}`;
      for (const shift of data.shifts) {
        const values = {};
        for (const job of jobs) {
          const cell = getCell(area, date, shift.id, job.jobCode); const total = totals[job.jobCode];
          values[job.jobCode] = finishCell(cell);
          for (const field of ['production', 'bcm', 'fuel', 'weightedDistance', 'distanceWeight']) total[field] += cell[field];
          for (const field of ['hasProduction', 'hasFuel', 'incomplete', 'densityIncomplete', 'distanceIncomplete']) total[field] ||= cell[field];
          if (cell.manual) { total.manual = true; total.manualFilled ||= cell.manualFilled; }
          for (const field of ['rainMm', 'rainMinutes', 'slipperyMinutes']) if (cell[field] != null) total[field] = (total[field] || 0) + cell[field];
          for (const [material, amount] of Object.entries(cell.materials)) total.materials[material] = amount === null || total.materials[material] === null ? null : (total.materials[material] || 0) + amount;
        }
        rows.push({ date, shiftId: shift.id, shift: shift.nama_shift, values, all: aggregateFuel(values) });
      }
    }
    const finishedTotals = Object.fromEntries(Object.entries(totals).map(([job, value]) => [job, finishCell(value)]));
    const totalAll = aggregateFuel(finishedTotals);
    const totalCells = Object.values(finishedTotals);
    const distanceWeight = totalCells.reduce((sum, cell) => sum + (cell.distanceWeight || 0), 0);
    const distanceIncomplete = totalCells.some(cell => cell.hasProduction && cell.distanceIncomplete);
    const qualityIssues = [...new Set(totalCells.flatMap(cell => cell.notes || []))];
    const summary = {
      jobs: jobs.map(job => ({ jobCode: job.jobCode, unit: job.unit,
        production: job.unit === 'mixed' ? null : finishedTotals[job.jobCode]?.production ?? null })),
      fuel: totalAll.fuel,
      fuelRatio: totalAll.fuelRatio,
      distanceKm: distanceIncomplete || !(distanceWeight > 0) ? null
        : totalCells.reduce((sum, cell) => sum + (cell.weightedDistance || 0), 0) / distanceWeight,
      qualityIssueCount: qualityIssues.length,
      qualityIssues,
    };
    return { area, rows, totals: finishedTotals, totalAll, summary };
  });
  const pendingFuel = totalFuel - allocatedFuel;
  const reasonCounts = queue.reduce((counts, item) => { const code = item.reasonCode || 'other'; counts[code] = (counts[code] || 0) + 1; return counts; }, {});
  const modeCounts = allocated.reduce((counts, item) => { const mode = item.mode || 'other'; counts[mode] = (counts[mode] || 0) + 1; return counts; }, {});
  const unitMap = new Map();
  queue.forEach(item => { const current = unitMap.get(item.equipmentId) || { equipmentId: item.equipmentId, unit: item.unit, transactions: 0, liters: 0 };
    current.transactions++; current.liters += item.liters; unitMap.set(item.equipmentId, current); });
  const oldestPendingDate = queue.map(item => item.tanggal).sort()[0] || null;
  const today = new Date(); const oldestPendingDays = oldestPendingDate == null ? 0
    : Math.max(0, Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.parse(`${oldestPendingDate}T00:00:00Z`)) / 86400000));
  const reconciliationDifference = totalFuel - allocatedFuel - pendingFuel;
  const allocationRules = (data.rules || []).map(rule => ({ id: rule.id, equipmentId: rule.equipment_id, unit: rule.kode_alat,
    area: rule.area_name, jobCode: rule.job_code, effectiveFrom: rule.effective_from, active: rule.is_active !== false }));
  const latestRules = new Map();
  allocationRules.slice().sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))).forEach(rule => {
    if (!latestRules.has(rule.equipmentId)) latestRules.set(rule.equipmentId, rule);
  });
  return { period: data.period, jobs, areas, shifts: data.shifts, tables: areaTables, queue, allocated,
    ruleUnits: (data.ruleUnits || []).map(unit => ({ id: unit.id, unit: unit.kode_alat })),
    fuelSummary: { total: totalFuel, allocated: allocatedFuel, pending: totalFuel - allocatedFuel }, densityCandidates,
    allocationRules,
    manualSources: (data.manualSources || []).map(m => ({ area: m.area,
      jobCode: m.jobCode || m.job_code, source: m.source })),
    manualOverrides: (data.manualOverrides || []).map(row => ({
      area: row.area, jobCode: row.jobCode || row.job_code,
      tanggal: row.tanggal, shiftId: row.shiftId || row.shift_id,
      material: row.material, value: Number(row.value)
    })),
    fuelQuality: { allocationPercent: totalFuel > 0 ? allocatedFuel / totalFuel * 100 : 100, oldestPendingDate, oldestPendingDays,
      reasonCounts, modeCounts, reconciliationDifference, reconciled: Math.abs(reconciliationDifference) < 0.000001,
      activeRuleCount: [...latestRules.values()].filter(rule => rule.active).length,
      topUnmappedUnits: [...unitMap.values()].sort((a, b) => b.transactions - a.transactions || b.liters - a.liters).slice(0, 10) },
    generatedAt: new Date().toISOString() };
}

module.exports = { key, groupKey, period, fingerprint, identity, allocateFuel, validateAllocation, unionMinutes, buildReport };
