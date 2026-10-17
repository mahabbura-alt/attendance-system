(function (global) {
  'use strict';

  const legacyApi = global.PlanProductivity || {};
  const contexts = new Map();
  let excavators = [];
  let dumpTrucks = [];
  // Jarak pendek front/backfill tetap sah: 0,1 km = 100 meter.
  const DISTANCES = Array.from({ length: 20 }, (_, index) => 100 + index * 100);
  const DEFAULT_CAPACITY_UOM = { ob: 'BCM', coal: 'Ton' };
  const FORMULA_VERSION = 'loader-hauler-database-v2';
  const HAULER_FORMULA_VERSION = 'hauler-distance-matrix-v1';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const num = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const capacityKind = value => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'bcm' || normalized === 'ton' ? normalized : null;
  };
  const today = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const apiUrl = path => typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(path) : path;
  const auth = () => typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const normalizeOption = (option, kind) => {
    const object = typeof option === 'object' ? option : { value: option };
    const code = String(object.code || object.value || '').trim();
    if (!code) return null;
    return {
      id: String(object.id || code), code,
      classUnit: String(object.classUnit || object.class_unit || '').trim(),
      type: String(object.type || object.tipe_alat || '').trim(),
      capacity: object.capacity === '' || object.capacity == null ? null : num(object.capacity, null),
      capacityUom: String(object.capacityUom || object.kapasitas_unit_uom || '').trim(),
      active: object.active !== false && String(object.status || '').toLowerCase() !== 'nonaktif'
    };
  };
  const uniqueOptions = (options, kind) => [...new Map((options || []).map(option => normalizeOption(option, kind)).filter(Boolean).map(option => [option.id, option])).values()]
    .sort((a, b) => a.code.localeCompare(b.code));

  function defaultParameters(type) {
    return type === 'coal'
      ? [{ id: 'coal-clay', material: 'CLAY', density: 1.3, fill: 0.9, swell: 1.3 }]
      : [{ id: 'ob-clay', material: 'CLAY', density: null, fill: 0.9, swell: 1.3 }];
  }

  function parameterFor(context, material) {
    return context.parameters.find(row => row.material === material) || {};
  }

  function selectedTrucks(scenario) {
    const ids = new Set((scenario.dumpTruckIds || []).map(String));
    return dumpTrucks.filter(truck => ids.has(String(truck.id)));
  }

  const haulerKey = (loaderId, truckId, material) => `${loaderId}|${truckId}|${String(material || '').trim().toLocaleLowerCase('id-ID')}`;
  function haulerRow(context, loaderId, truck, material) {
    return (context.haulerRows || []).find(row => haulerKey(row.loaderId, row.truckId, row.material) === haulerKey(loaderId, truck.id, material)) || null;
  }
  function ensureHaulerRow(context, loaderId, truck, material) {
    let row = haulerRow(context, loaderId, truck, material);
    if (!row) {
      row = { loaderId, truckId: truck.id, material, capacity: '',
        capacityUom: DEFAULT_CAPACITY_UOM[context.type],
        loadedSpeed: '', emptySpeed: '', spotDumpTime: '', workEfficiency: '' };
      context.haulerRows.push(row);
    }
    return row;
  }
  function assignHaulerField(context, row, field, value) {
    if (field === 'capacity') {
      const expectedUom = DEFAULT_CAPACITY_UOM[context.type];
      if (capacityKind(row.capacityUom) !== capacityKind(expectedUom)) {
        // Jangan reinterpretasi capacity legacy (mis. M3) sebagai Ton/BCM.
        // Pertahankan sumbernya untuk audit, lalu nilai yang diketik user
        // menjadi override eksplisit dalam satuan planning yang terlihat.
        if (row.sourceCapacity == null) row.sourceCapacity = row.capacity;
        if (row.sourceCapacityUom == null) row.sourceCapacityUom = row.capacityUom;
        row.capacityUom = expectedUom;
      }
    }
    row[field] = value;
  }
  // Cerminan aturan backend validateLoaderFleetDatabase agar baris invalid
  // terlihat SEBELUM Simpan (UI selalu menyimpan versi 8 → aturan coal v7+
  // berlaku). Kembalikan daftar {field, note} per sel input yang salah.
  function haulerRowInvalidFields(row, planningType) {
    if (!row) return [];
    const sup = value => String(value ?? '').trim() !== '';
    const bad = [];
    const push = (field, note) => bad.push({ field, note });
    if (sup(row.capacity) && !(Number(row.capacity) > 0)) push('capacity', 'capacity harus angka > 0');
    const uom = String(row.capacityUom || '').toLowerCase();
    if (sup(row.capacityUom) && !['bcm', 'ton'].includes(uom)) push('capacity', `capacityUom '${row.capacityUom}' tidak dikenal`);
    if (sup(row.loadedSpeed) && !(Number(row.loadedSpeed) > 0)) push('loadedSpeed', 'loadedSpeed harus angka > 0');
    if (sup(row.emptySpeed) && !(Number(row.emptySpeed) > 0)) push('emptySpeed', 'emptySpeed harus angka > 0');
    if (sup(row.spotDumpTime) && !(Number(row.spotDumpTime) >= 0)) push('spotDumpTime', 'spotDumpTime harus angka ≥ 0');
    if (sup(row.workEfficiency) && !(Number(row.workEfficiency) > 0 && Number(row.workEfficiency) <= 1)) push('workEfficiency', 'workEfficiency harus desimal 0–1 (mis. 0.85)');
    if (planningType === 'ob' && sup(row.capacityUom) && uom !== 'bcm') push('capacity', "OB wajib satuan 'BCM'");
    if (planningType === 'coal' && sup(row.capacityUom) && uom !== 'ton') push('capacity', "coal wajib satuan 'Ton' — isi density material agar konversi otomatis");
    return bad;
  }
  function normalizeHaulerUnits(context) {
    context.haulerRows.forEach(row => {
      const kind = capacityKind(row.capacityUom);
      // Capacity kosong belum bermakna apa-apa: paksa ke satuan ekspektasi
      // agar sel input muncul dan baris bisa dilengkapi (anti-deadlock).
      if (!(num(row.capacity) > 0)) {
        row.capacityUom = context.type === 'coal' ? 'Ton' : 'BCM';
        return;
      }
      if (context.type === 'ob') {
        if (kind === 'bcm' || (!kind && !(num(row.capacity) > 0))) row.capacityUom = 'BCM';
        return;
      }
      if (kind === 'ton' || (!kind && !(num(row.capacity) > 0))) { row.capacityUom = 'Ton'; return; }
      if (!kind) return;
      const density = num(parameterFor(context, row.material).density);
      if (density > 0 && num(row.capacity) > 0) {
        row.sourceCapacityBcm = row.capacity;
        row.capacity = num(row.capacity) * density;
        row.capacityUom = 'Ton';
      }
    });
  }
  function distanceHeaders(context) {
    return context.distanceHeadersMeters?.length ? context.distanceHeadersMeters : DISTANCES;
  }
  function loadingFor(context, loaderId, truck, material, row) {
    const scenario = context.scenarios.find(item => String(item.loaderId) === String(loaderId) && item.material === material);
    const loader = excavators.find(unit => String(unit.id) === String(loaderId));
    const parameter = parameterFor(context, material);
    const loaderCap = num(parameter.swell) > 0 ? num(loader?.capacity) * num(parameter.fill) / num(parameter.swell) : 0;
    const density = context.type === 'coal' ? num(parameter.density) : 1;
    const capacity = num(row?.capacity);
    const kind = capacityKind(row?.capacityUom);
    const volume = context.type === 'coal' && kind === 'ton' && density > 0 ? capacity / density
      : kind === 'bcm' ? capacity : 0;
    const cycle = num(scenario?.cycleTimeLoading);
    return loaderCap > 0 && volume > 0 && cycle > 0 ? Math.max(1, Math.round(volume / loaderCap)) * cycle / 60 : null;
  }

  function computeScenario(context, scenario) {
    const loader = excavators.find(unit => String(unit.id) === String(scenario.loaderId) || unit.code === scenario.loaderCode);
    const parameter = parameterFor(context, scenario.material);
    const bucketCapacity = num(loader?.capacity, 0);
    const fill = num(parameter.fill, 0);
    const swell = num(parameter.swell, 0);
    const density = context.type === 'coal' ? num(parameter.density, 0) : 1;
    const loaderCap = swell > 0 ? bucketCapacity * fill / swell : 0;
    const validOperations = num(scenario.cycleTimeLoading) > 0 && num(scenario.workEffLoader) > 0 && num(scenario.workEffLoader) <= 1;
    const loaderProductivity = validOperations && loaderCap > 0 && density > 0
      ? (3600 / num(scenario.cycleTimeLoading)) * loaderCap * num(scenario.workEffLoader) * density : 0;
    return { bucketCapacity, fill, swell, density, loaderCap, loaderProductivity,
      complete: loaderProductivity > 0 };
  }

  function computeFleetSetup(context, setting) {
    const scenario = context.scenarios.find(item => item.id === setting.loaderScenarioId);
    if (!scenario) return { loaderProductivity: 0, truckFleetProductivity: 0, fleetMatch: 0, fleetProductivity: 0, complete: false, truckResults: [] };
    const loaderResult = computeScenario(context, scenario);
    const selected = selectedTrucks(setting);
    const truckResults = selected.map(truck => {
      const row = haulerRow(context, scenario.loaderId, truck, scenario.material);
      const capacity = num(row?.capacity);
      const kind = capacityKind(row?.capacityUom);
      const effectiveCapacity = context.type === 'coal'
        ? (kind === 'ton' ? capacity : kind === 'bcm' ? capacity * loaderResult.density : 0)
        : (kind === 'bcm' ? capacity : 0);
      const volume = context.type === 'coal' && kind === 'ton' && loaderResult.density > 0
        ? capacity / loaderResult.density : kind === 'bcm' ? capacity : 0;
      const passes = loaderResult.loaderCap > 0 && volume > 0 ? Math.max(1, Math.round(volume / loaderResult.loaderCap)) : 0;
      const loadingTime = passes && num(scenario.cycleTimeLoading) > 0 ? passes * num(scenario.cycleTimeLoading) / 60 : null;
      const distanceKm = num(setting.benchmarkDistanceMeters) / 1000;
      const cycleTime = loadingTime != null && distanceKm > 0 && num(row?.loadedSpeed) > 0 && num(row?.emptySpeed) > 0
        ? loadingTime + distanceKm / num(row.loadedSpeed) * 60 + distanceKm / num(row.emptySpeed) * 60 + num(row.spotDumpTime) : null;
      const productivity = cycleTime > 0 && effectiveCapacity > 0 && String(row?.spotDumpTime ?? '').trim() !== ''
        && num(row?.workEfficiency) > 0 && num(row?.workEfficiency) <= 1
        ? 60 / cycleTime * effectiveCapacity * num(row.workEfficiency) : 0;
      return { id: truck.id, capacity, effectiveCapacity, passes, loadingTime, cycleTime, productivity };
    });
    const truckFleetProductivity = truckResults.reduce((sum, item) => sum + item.productivity, 0);
    const complete = Boolean(setting.jobCode && (scenario.jobCodes || []).includes(setting.jobCode)
      && loaderResult.complete && selected.length && selected.every(item => item.active)
      && truckResults.every(item => item.productivity > 0));
    return { loaderProductivity: loaderResult.loaderProductivity, truckFleetProductivity,
      fleetMatch: loaderResult.loaderProductivity > 0 ? truckFleetProductivity / loaderResult.loaderProductivity : 0,
      fleetProductivity: complete ? Math.min(loaderResult.loaderProductivity, truckFleetProductivity) : 0,
      complete, truckResults };
  }

  function haulerProductivity(context, truck, profile, distanceMeters) {
    const material = parameterFor(context, profile?.material);
    const capacity = num(profile?.capacity, 0);
    const density = context.type === 'coal' ? num(material.density, 0) : 1;
    const kind = capacityKind(profile?.capacityUom);
    const loadingTime = loadingFor(context, profile?.loaderId, truck, profile?.material, profile);
    if (!(capacity > 0) || !(num(profile?.loadedSpeed) > 0) || !(num(profile?.emptySpeed) > 0)
      || !(num(profile?.workEfficiency) > 0 && num(profile?.workEfficiency) <= 1)
      || loadingTime == null || String(profile?.spotDumpTime ?? '').trim() === '' || num(profile?.spotDumpTime) < 0
      || (context.type === 'coal' && !(density > 0)) || !kind || (context.type === 'ob' && kind !== 'bcm')) return null;
    const effectiveCapacity = context.type === 'coal' && kind === 'bcm' ? capacity * density : capacity;
    const distanceKm = distanceMeters / 1000;
    const cycleTime = loadingTime + distanceKm / num(profile.loadedSpeed) * 60
      + distanceKm / num(profile.emptySpeed) * 60 + num(profile.spotDumpTime);
    return cycleTime > 0 ? (60 / cycleTime) * effectiveCapacity * num(profile.workEfficiency) : null;
  }

  function scenarioSnapshot(context, scenario) {
    const result = computeScenario(context, scenario);
    return {
      id: scenario.id, loaderId: scenario.loaderId, loaderCode: scenario.loaderCode,
      material: scenario.material, jobCodes: [...new Set(scenario.jobCodes || [])],
      cycleTimeLoading: scenario.cycleTimeLoading, workEffLoader: scenario.workEffLoader,
      ...result, formulaVersion: 'loader-productivity-v1', effectiveFrom: context.effectiveFrom
    };
  }

  function buildPlanningData(context) {
    const scenarios = context.scenarios.map(scenario => scenarioSnapshot(context, scenario));
    const loaderCatalog = scenarios.flatMap(scenario => (scenario.jobCodes || []).map(jobCode => ({
      planRef: `${context.type}:loader:${scenario.id}:${jobCode}`,
      tableId: scenario.id,
      planningType: context.type,
      jobCode,
      loaderCode: scenario.loaderCode,
      material: scenario.material,
      density: context.type === 'coal' ? scenario.density : null,
      loaderProductivity: scenario.loaderProductivity,
      fleetProductivity: scenario.loaderProductivity,
      complete: scenario.complete,
      productivityUnit: context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr',
      formulaVersion: scenario.formulaVersion,
      targetSource: 'loader_productivity',
      effectiveFrom: context.effectiveFrom
    })));
    return {
      version: 8,
      formulaVersion: FORMULA_VERSION,
      effectiveFrom: context.effectiveFrom,
      fleets: context.fleets,
      parameters: context.parameters,
      scenarios,
      loaderCatalog,
      haulerRows: context.haulerRows,
      haulerFormulaVersion: HAULER_FORMULA_VERSION,
      distanceHeadersMeters: distanceHeaders(context)
    };
  }

  function serialize(container) {
    const clone = container.cloneNode(true);
    clone.querySelectorAll('input,select,textarea').forEach(field => {
      if (field.tagName === 'SELECT') [...field.options].forEach(option => option.toggleAttribute('selected', option.selected));
      else if (field.type === 'checkbox') field.toggleAttribute('checked', field.checked);
      else field.setAttribute('value', field.value);
    });
    return clone.innerHTML;
  }

  function parseLegacy(type, payload) {
    const doc = new DOMParser().parseFromString(`<div>${payload.contentHtml || ''}</div>`, 'text/html');
    const value = (root, name) => {
      const field = root.querySelector(`[data-plan-productivity-field="${name}"]`);
      return field?.value || field?.getAttribute('value') || '';
    };
    const parameters = [];
    doc.querySelectorAll('[data-plan-factor-type="merged"] tbody tr,[data-plan-factor-type="coal"] tbody tr').forEach((row, index) => {
      const get = name => row.querySelector(`[data-plan-factor-field="${name}"]`)?.value || row.querySelector(`[data-plan-factor-field="${name}"]`)?.getAttribute('value') || '';
      const material = get('material').trim();
      if (material) parameters.push({ id: `${type}-material-${index + 1}`, material, density: type === 'coal' ? get('density') : null, fill: get('fill'), swell: get('swell') });
    });
    const catalog = Array.isArray(payload.planningData?.fleetCatalog) ? payload.planningData.fleetCatalog : [];
    const byTable = new Map(catalog.map(item => [String(item.tableId), item]));
    const scenarios = [...doc.querySelectorAll('.plan-productivity-table')].map((table, index) => {
      const id = table.dataset.planTableId || `${type}-${index + 1}`;
      const catalogItem = byTable.get(String(id)) || {};
      const loaderCode = value(table, 'fleetName') || catalogItem.loaderCode || '';
      const dumpCode = value(table, 'dumpTruck') || catalogItem.dumpTruckCode || '';
      const loader = excavators.find(unit => unit.code === loaderCode);
      const truck = dumpTrucks.find(unit => unit.code === dumpCode);
      return {
        id, planRef: catalogItem.planRef || `${type}:${id}`,
        loaderId: loader?.id || loaderCode, loaderCode,
        material: value(table, 'material') || catalogItem.material || parameters[0]?.material || '',
        jobCode: table.dataset.planJobCode || catalogItem.jobCode || '',
        jobDescription: table.dataset.planJobDescription || catalogItem.jobDescription || '',
        dumpTruckIds: Array.isArray(catalogItem.dumpTruckIds) ? catalogItem.dumpTruckIds : (truck ? [truck.id] : []),
        cycleTimeLoading: value(table, 'cycleTimeLoading') || 23,
        workEffLoader: value(table, 'workEffLoader') || 0.7,
        loadedSpeed: value(table, 'loadedSpeed') || 15,
        emptySpeed: value(table, 'emptySpeed') || 30,
        spotDumpTime: value(table, 'spotDumpTime') || 2,
        distance: value(table, 'distance') || 1.2,
        workEffFleet: value(table, 'workEffFleet') || 0.765
      };
    });
    if (!scenarios.length && catalog.length) catalog.forEach((item, index) => {
      const loader = excavators.find(unit => unit.code === item.loaderCode);
      scenarios.push({ id: item.tableId || `${type}-${index + 1}`, planRef: item.planRef,
        loaderId: loader?.id || item.loaderCode, loaderCode: item.loaderCode, material: item.material,
        jobCode: item.jobCode || '', jobDescription: item.jobDescription || '', dumpTruckIds: item.dumpTruckIds || [],
        cycleTimeLoading: 23, workEffLoader: 0.7, loadedSpeed: 15, emptySpeed: 30, spotDumpTime: 2, distance: 1.2, workEffFleet: 0.765 });
    });
    return {
      parameters: parameters.length ? parameters : defaultParameters(type), scenarios,
      fleets: [...new Map(scenarios.map(item => [item.loaderId, { loaderId: item.loaderId, loaderCode: item.loaderCode }])).values()],
      haulerProfiles: payload.planningData?.haulerProfiles || []
    };
  }

  function legacyHaulerRows(scenarios, profiles = []) {
    const rows = new Map();
    scenarios.forEach(scenario => {
      (scenario.dumpTruckIds || []).forEach(truckId => {
        const truck = dumpTrucks.find(unit => String(unit.id) === String(truckId) || unit.code === truckId);
        if (!truck) return;
        const profile = profiles.find(item => item.material === scenario.material
          && item.classUnit === truck.classUnit && item.type === truck.type) || {};
        const row = { loaderId: scenario.loaderId, truckId: truck.id, material: scenario.material,
          capacity: truck.capacity ?? '', capacityUom: truck.capacityUom || '',
          loadedSpeed: profile.loadedSpeed || scenario.loadedSpeed || '',
          emptySpeed: profile.emptySpeed || scenario.emptySpeed || '',
          spotDumpTime: profile.spotDumpTime ?? scenario.spotDumpTime ?? '',
          workEfficiency: profile.workEfficiency || scenario.workEffFleet || '' };
        rows.set(haulerKey(row.loaderId, row.truckId, row.material), row);
      });
    });
    return [...rows.values()];
  }

  function normalizeLoaded(type, payload) {
    const data = payload.planningData || {};
    if (Number(data.version) >= 4 && Array.isArray(data.scenarios)) {
      const oldScenarios = data.scenarios.map(item => ({ ...item, id: item.id || item.tableId,
        loaderId: item.loaderId || excavators.find(unit => unit.code === item.loaderCode)?.id || item.loaderCode }));
      const scenarios = oldScenarios.map(item => ({ id: item.id, loaderId: item.loaderId,
        loaderCode: item.loaderCode, material: item.material,
        jobCodes: Array.isArray(item.jobCodes) ? item.jobCodes : item.jobCode ? [item.jobCode] : [],
        cycleTimeLoading: item.cycleTimeLoading, workEffLoader: item.workEffLoader }));
      const legacyRows = Number(data.version) < 5 ? legacyHaulerRows(oldScenarios, data.haulerProfiles || []) : [];
      return {
        parameters: Array.isArray(data.parameters) && data.parameters.length ? data.parameters : defaultParameters(type),
        scenarios,
        fleets: Array.isArray(data.fleets) ? data.fleets : [],
        haulerProfiles: Array.isArray(data.haulerProfiles) ? data.haulerProfiles : [],
        distanceHeadersMeters: Array.isArray(data.distanceHeadersMeters) && data.distanceHeadersMeters.length
          ? data.distanceHeadersMeters : [...DISTANCES],
        haulerRows: Number(data.version) >= 5 && Array.isArray(data.haulerRows) ? data.haulerRows : legacyRows
      };
    }
    const legacy = parseLegacy(type, payload);
    return { ...legacy,
      scenarios: legacy.scenarios.map(item => ({ id: item.id, loaderId: item.loaderId,
        loaderCode: item.loaderCode, material: item.material, jobCodes: item.jobCode ? [item.jobCode] : [],
        cycleTimeLoading: item.cycleTimeLoading, workEffLoader: item.workEffLoader })),
      haulerRows: legacyHaulerRows(legacy.scenarios, legacy.haulerProfiles),
      distanceHeadersMeters: [...DISTANCES] };
  }

  async function fetchJobs(operationalDate) {
    const response = await fetch(apiUrl(`/api/admin/production/spo-jobs/deployed?scope=production&operational_date=${encodeURIComponent(operationalDate || '')}`), { headers: auth() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.jobs || [];
  }

  function markDirty(context) {
    context.dirty = true;
    const status = document.getElementById(context.type === 'coal' ? 'coalProductivitySaveStatus' : 'planProductivitySaveStatus');
    global.OMOSActionFeedback?.status(status, 'loading', 'Perubahan belum disimpan');
  }

  function readonlyAttr(context) { return context.view !== 'setting' && context.periodEnd && context.effectiveFrom > context.periodEnd ? 'disabled aria-disabled="true"' : ''; }

  function renderHighlight(context) {
    const materials = context.parameters.map(item => item.material);
    const rows = context.fleets.map(fleet => {
      const cells = materials.map(material => {
        const scenarios = context.scenarios.filter(item => String(item.loaderId) === String(fleet.loaderId) && item.material === material);
        if (!scenarios.length) return '<td class="ppw-empty">—</td>';
        return `<td>${scenarios.map(item => { const result = computeScenario(context, item); return `<div title="${esc(`${item.loaderCode} · ${item.material}`)}"><strong>${result.loaderProductivity > 0 ? result.loaderProductivity.toFixed(2) : '—'}</strong></div>`; }).join('')}</td>`;
      }).join('');
      return `<tr><th>${esc(fleet.loaderCode)}</th>${cells}</tr>`;
    }).join('');
    return `<section class="ppw-highlight"><div class="ppw-section-title"><div><small>HIGHLIGHT</small><h3>Loader Material Productivity</h3></div><span>${esc(context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr')} · efektif ${esc(context.sourceEffectiveFrom || context.effectiveFrom)}</span></div><div class="ppw-scroll"><table><thead><tr><th>EXCAVATOR</th>${materials.map(item => `<th>${esc(item)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${materials.length + 1}" class="ppw-empty">Belum ada excavator.</td></tr>`}</tbody></table></div></section>`;
  }

  function renderParameterTable(context) {
    return `<details class="ppw-parameters" open data-plan-factor-type="${context.type === 'coal' ? 'coal' : 'merged'}"><summary>⚙ Parameter Material</summary><div class="ppw-scroll"><table><thead><tr><th>Material</th>${context.type === 'coal' ? '<th>Density (Ton/BCM)</th>' : ''}<th>Bucket Fill Factor</th><th>Swell Factor</th><th></th></tr></thead><tbody>${context.parameters.map(row => `<tr data-parameter-id="${esc(row.id)}"><td><input data-parameter-field="material" data-plan-factor-field="material" value="${esc(row.material)}" ${readonlyAttr(context)}></td>${context.type === 'coal' ? `<td><input type="number" step="0.01" data-parameter-field="density" data-plan-factor-field="density" value="${esc(row.density)}" ${readonlyAttr(context)}></td>` : ''}<td><input type="number" step="0.01" data-parameter-field="fill" data-plan-factor-field="fill" value="${esc(row.fill)}" ${readonlyAttr(context)}></td><td><input type="number" step="0.01" data-parameter-field="swell" data-plan-factor-field="swell" value="${esc(row.swell)}" ${readonlyAttr(context)}></td><td><button type="button" class="tombol tombol--ghost" data-delete-parameter ${readonlyAttr(context)}>Hapus</button></td></tr>`).join('')}</tbody></table></div><button type="button" class="tombol tombol--ghost" data-add-parameter ${readonlyAttr(context)}>+ Material</button></details>`;
  }

  function scenarioCard(context, scenario) {
    const result = computeScenario(context, scenario);
    const classes = [...new Set(dumpTrucks.map(item => item.classUnit).filter(Boolean))];
    const selected = new Set((scenario.dumpTruckIds || []).map(String));
    const selectedUnits = dumpTrucks.filter(truck => selected.has(String(truck.id)));
    const selectedGroups = [...new Map(selectedUnits.map(truck => [truck.classUnit || 'Tanpa Class', []])).entries()];
    selectedUnits.forEach(truck => selectedGroups.find(([name]) => name === (truck.classUnit || 'Tanpa Class'))[1].push(truck));
    const classFilters = new Set((scenario.classFilters || []).map(String));
    const jobs = context.jobs || [];
    const unit = context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr';
    const inputs = [
      ['cycleTimeLoading', 'Cycle Time Load (detik)', '0.1'], ['workEffLoader', 'Work Efficiency Loader', '0.01']
    ];
    return `<article class="plan-productivity-table ppw-scenario" data-scenario-id="${esc(scenario.id)}" data-plan-table-id="${esc(scenario.id)}" data-plan-job-code="${esc(scenario.jobCode)}" data-plan-job-description="${esc(scenario.jobDescription)}" data-fleet-productivity="${result.fleetProductivity || ''}" data-fleet-productivity-unit="${unit}">
      <header><div><small>FLEET MATERIAL DATABASE</small><strong>${esc(scenario.jobCode || 'JOB belum dipilih')} · ${esc(scenario.material)}</strong></div><button type="button" class="tombol tombol--ghost" data-delete-scenario ${readonlyAttr(context)}>Hapus Material Fleet</button></header>
      <div class="ppw-scenario-grid"><section><h4>Fleet Setup</h4>
        <label>Fleet (Excavator)<select data-plan-productivity-field="fleetName" data-scenario-field="loaderCode" disabled><option selected value="${esc(scenario.loaderCode)}">${esc(scenario.loaderCode)}</option></select></label>
        <label>JOB<select data-scenario-field="jobCode" ${readonlyAttr(context)}><option value="">Pilih JOB dari SPO</option>${jobs.map(job => `<option value="${esc(job.jobCode)}" data-desc="${esc(job.jobDescription)}" ${job.jobCode === scenario.jobCode ? 'selected' : ''}>${esc(job.jobCode)} · ${esc(job.jobDescription)}</option>`).join('')}</select></label>
        <label>Material<select data-plan-productivity-field="material" disabled><option selected value="${esc(scenario.material)}">${esc(scenario.material)}</option></select></label>
        <div class="ppw-readonly"><span>Bucket Capacity</span><b>${result.bucketCapacity || '—'} m³</b><span>Bucket Fill Factor</span><b>${result.fill || '—'}</b><span>Swell Factor</span><b>${result.swell || '—'}</b>${context.type === 'coal' ? `<span>Density</span><b>${result.density || '—'} Ton/BCM</b>` : ''}<span>Number of Truck</span><b>${selected.size}</b></div>
        <details class="ppw-truck-picker"><summary>Pilih Dump Truck (${selected.size} unit)</summary><label>Filter Class<select multiple data-class-slicer size="${Math.min(4, Math.max(2, classes.length))}">${classes.map(value => `<option value="${esc(value)}" ${classFilters.has(value) ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><div class="ppw-truck-tools"><input type="search" data-truck-search placeholder="Cari kode atau model"><button type="button" data-select-filtered ${readonlyAttr(context)}>Pilih Semua Hasil</button><button type="button" data-clear-trucks ${readonlyAttr(context)}>Kosongkan</button></div><div data-truck-options>${dumpTrucks.filter(truck => truck.active || selected.has(String(truck.id))).map(truck => `<label data-truck-class="${esc(truck.classUnit)}" data-truck-search-text="${esc(`${truck.code} ${truck.type} ${truck.classUnit}`.toLowerCase())}" data-truck-active="${truck.active ? 'true' : 'false'}" ${classFilters.size && !classFilters.has(truck.classUnit) ? 'hidden' : ''}><input type="checkbox" data-truck-id="${esc(truck.id)}" ${selected.has(String(truck.id)) ? 'checked' : ''} ${readonlyAttr(context)}><span><b>${esc(truck.code)}</b><small>${esc(truck.classUnit)} · ${esc(truck.type)} · ${truck.capacity ?? '—'} ${esc(truck.capacityUom)}${truck.active ? '' : ' · Nonaktif — perlu ditinjau'}</small></span></label>`).join('')}</div></details>
        <div class="ppw-selected-trucks">${selectedGroups.length ? selectedGroups.map(([name, trucks]) => `<div><b>${esc(name)}</b>${trucks.map(truck => `<span class="${truck.active ? '' : 'is-inactive'}">${esc(truck.code)}${truck.active ? '' : ' · Nonaktif'}</span>`).join('')}</div>`).join('') : '<small>Belum ada Dump Truck dipilih.</small>'}${selected.size > selectedUnits.length ? `<small class="is-missing">${selected.size - selectedUnits.length} unit tersimpan tidak ditemukan di List Equipment. Tinjau sebelum menyimpan.</small>` : ''}</div>
      </section><section><h4>Productivity Excavator</h4>${inputs.map(([key, label, step]) => `<label>${label}<input type="number" step="${step}" data-scenario-field="${key}" value="${esc(scenario[key])}" ${readonlyAttr(context)}></label>`).join('')}<div class="ppw-formula-proof">Bucket efektif = ${num(result.bucketCapacity).toFixed(2)} × ${num(result.fill).toFixed(2)} ÷ ${num(result.swell).toFixed(2)} = ${num(result.loaderCap).toFixed(3)} BCM<br>Loader = (3.600 ÷ ${num(scenario.cycleTimeLoading).toFixed(1)} detik) × ${num(result.loaderCap).toFixed(3)} × ${num(scenario.workEffLoader).toFixed(3)}${context.type === 'coal' ? ` × ${num(result.density).toFixed(3)} Ton/BCM` : ''}<br><b>${result.loaderProductivity > 0 ? result.loaderProductivity.toFixed(2) : '—'} ${unit}</b></div><small>Truck Productivity memakai parameter Hauler pada excavator dan material ini, di jarak acuan ${(num(scenario.benchmarkDistanceMeters) / 1000).toFixed(1)} km.</small></section></div>
      <footer><div><span>Loader Productivity</span><b>${result.loaderProductivity ? result.loaderProductivity.toFixed(2) : '—'} ${unit}</b></div><div><span>Truck Fleet Productivity</span><b>${result.truckFleetProductivity ? result.truckFleetProductivity.toFixed(2) : '—'} ${unit}</b></div><div><span>Fleet Match</span><b>${result.fleetMatch ? result.fleetMatch.toFixed(2) : '—'}</b></div><div class="${result.complete ? 'is-complete' : 'is-incomplete'}"><span>Fleet Productivity</span><b>${result.fleetProductivity ? result.fleetProductivity.toFixed(2) : '—'} ${unit}</b></div></footer>
    </article>`;
  }

  function renderFleetWorkspace(context) {
    return context.fleets.map(fleet => {
      const scenarios = context.scenarios.filter(item => String(item.loaderId) === String(fleet.loaderId));
      const configured = new Set(scenarios.map(item => item.material));
      const products = scenarios.map(item => computeScenario(context, item).fleetProductivity).filter(Boolean);
      const active = String(context.activeFleetId) === String(fleet.loaderId);
      return `<section class="ppw-fleet ${active ? 'is-open' : ''}" data-fleet-id="${esc(fleet.loaderId)}"><button type="button" class="ppw-fleet-head" data-toggle-fleet><span><b>${esc(fleet.loaderCode)}</b><small>${configured.size}/${context.parameters.length} material · ${products.length ? `${Math.min(...products).toFixed(2)}–${Math.max(...products).toFixed(2)}` : 'belum dihitung'} ${context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr'}</small></span><i>${configured.size === context.parameters.length && scenarios.length ? 'Lengkap' : scenarios.length ? 'Perlu dilengkapi' : 'Belum diset'} ${active ? '▾' : '▸'}</i></button>${active ? `<div class="ppw-fleet-body"><div class="ppw-material-overview"><table><thead><tr><th>Material</th><th>Parameter Sumber</th><th>Fleet Productivity</th></tr></thead><tbody>${context.parameters.map(parameter => { const item = scenarios.find(row => row.material === parameter.material); const result = item ? computeScenario(context, item) : null; return `<tr data-add-scenario="${esc(parameter.material)}" class="ppw-material-row"><td><b>${esc(parameter.material)}</b></td><td>BFF ${esc(parameter.fill || '—')} · Swell ${esc(parameter.swell || '—')}${context.type === 'coal' ? ` · Density ${esc(parameter.density || '—')}` : ''}</td><td>${result?.fleetProductivity ? result.fleetProductivity.toFixed(2) : item ? 'Perlu dilengkapi' : '+ Klik untuk mengisi'}</td></tr>`; }).join('')}</tbody></table></div><div class="ppw-card-grid">${scenarios.map(item => scenarioCard(context, item)).join('') || '<div class="ppw-empty-state">Klik material pada tabel untuk menambahkan data Fleet.</div>'}</div><button type="button" class="tombol tombol--ghost ppw-delete-fleet" data-delete-fleet ${readonlyAttr(context)}>Hapus Fleet</button></div>` : ''}</section>`;
    }).join('') || '<div class="ppw-empty-state">Belum ada fleet. Klik <b>+ Tambah Fleet</b> untuk memilih excavator.</div>';
  }

  function profileKey(material, truck) { return `${material}|${truck.classUnit}|${truck.type}`; }
  function getProfile(context, material, truck) {
    const key = profileKey(material, truck);
    let profile = context.haulerProfiles.find(item => item.key === key);
    if (!profile) {
      profile = { key, material, classUnit: truck.classUnit, type: truck.type, loadingTime: '', loadedSpeed: '', emptySpeed: '', spotDumpTime: '', workEfficiency: '' };
      context.haulerProfiles.push(profile);
    }
    return profile;
  }

  function renderHauler(context) {
    const material = context.haulerMaterial || context.parameters[0]?.material || '';
    context.haulerMaterial = material;
    const filters = context.haulerFilters || (context.haulerFilters = { search: '', classUnit: '', model: '', status: 'all', benchmarkDistance: 1000 });
    const classes = [...new Set(dumpTrucks.map(item => item.classUnit).filter(Boolean))].sort();
    const models = [...new Set(dumpTrucks.map(item => item.type).filter(Boolean))].sort();
    const visibleTrucks = dumpTrucks.filter(truck => {
      const text = `${truck.code} ${truck.classUnit} ${truck.type}`.toLowerCase();
      if (filters.search && !text.includes(String(filters.search).toLowerCase())) return false;
      if (filters.classUnit && truck.classUnit !== filters.classUnit) return false;
      if (filters.model && truck.type !== filters.model) return false;
      if (filters.status === 'active' && !truck.active) return false;
      if (filters.status === 'inactive' && truck.active) return false;
      return true;
    });
    const profiles = [...new Map(visibleTrucks.map(truck => [profileKey(material, truck), getProfile(context, material, truck)])).values()];
    const unit = context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr';
    const benchmark = Number(filters.benchmarkDistance) || 1000;
    const benchmarkValues = visibleTrucks.map(truck => haulerProductivity(context, truck, getProfile(context, material, truck), benchmark)).filter(value => value != null).sort((a, b) => a - b);
    const median = benchmarkValues.length ? benchmarkValues[Math.floor(benchmarkValues.length / 2)] : null;
    const compareIds = new Set((context.haulerCompare || []).map(String));
    const detail = context.haulerDetail;
    const detailTruck = detail ? dumpTrucks.find(truck => String(truck.id) === String(detail.truckId)) : null;
    const detailProfile = detailTruck ? getProfile(context, material, detailTruck) : null;
    const detailValue = detailTruck ? haulerProductivity(context, detailTruck, detailProfile, detail.distance) : null;
    return `<section class="ppw-hauler"><div class="ppw-hauler-toolbar"><label>Material<select data-hauler-material>${context.parameters.map(item => `<option value="${esc(item.material)}" ${item.material === material ? 'selected' : ''}>${esc(item.material)}</option>`).join('')}</select></label><label>Cari Unit<input data-hauler-filter="search" type="search" value="${esc(filters.search)}" placeholder="Kode, class, model"></label><label>Class<select data-hauler-filter="classUnit"><option value="">Semua Class</option>${classes.map(value => `<option ${filters.classUnit === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label>Model<select data-hauler-filter="model"><option value="">Semua Model</option>${models.map(value => `<option ${filters.model === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label>Status<select data-hauler-filter="status"><option value="all" ${filters.status === 'all' ? 'selected' : ''}>Semua</option><option value="active" ${filters.status === 'active' ? 'selected' : ''}>Aktif</option><option value="inactive" ${filters.status === 'inactive' ? 'selected' : ''}>Nonaktif</option></select></label><label>Benchmark<select data-hauler-filter="benchmarkDistance">${DISTANCES.map(distance => `<option value="${distance}" ${benchmark === distance ? 'selected' : ''}>${(distance / 1000).toFixed(1)} km</option>`).join('')}</select></label></div><div class="ppw-hauler-kpis"><div><span>Unit tampil</span><b>${visibleTrucks.length}</b></div><div><span>Parameter siap</span><b>${benchmarkValues.length}</b></div><div><span>Median @ ${(benchmark / 1000).toFixed(1)} km</span><b>${median == null ? '—' : median.toFixed(2)} ${unit}</b></div><div><span>Rentang</span><b>${benchmarkValues.length ? `${benchmarkValues[0].toFixed(2)}–${benchmarkValues.at(-1).toFixed(2)}` : '—'} ${unit}</b></div></div><p class="ppw-hauler-note">Jarak 0,5–2,0 km dengan interval 100 meter. Pilih maksimal empat unit pada kolom Compare; klik nilai productivity untuk melihat rincian sumber perhitungan.</p><details class="ppw-hauler-params"><summary>Parameter Hauler — Material + Class + Model</summary><div class="ppw-scroll"><table><thead><tr><th>Class</th><th>Model</th><th>Loading Time (min)</th><th>Loaded Speed</th><th>Empty Speed</th><th>Spot & Dump</th><th>Work Efficiency</th></tr></thead><tbody>${profiles.map(profile => `<tr data-profile-key="${esc(profile.key)}"><td>${esc(profile.classUnit || '—')}</td><td>${esc(profile.type || '—')}</td>${['loadingTime','loadedSpeed','emptySpeed','spotDumpTime','workEfficiency'].map(field => `<td><input type="number" step="0.01" data-profile-field="${field}" value="${esc(profile[field])}" ${readonlyAttr(context)}></td>`).join('')}</tr>`).join('') || '<tr><td colspan="7">Tidak ada unit sesuai filter.</td></tr>'}</tbody></table></div></details><div class="ppw-scroll ppw-matrix"><table><thead><tr><th>Compare</th><th>Unit</th><th>Class</th><th>Model</th><th>Capacity</th>${DISTANCES.map(distance => `<th>${(distance / 1000).toFixed(1)} km</th>`).join('')}</tr></thead><tbody>${visibleTrucks.map(truck => { const profile = getProfile(context, material, truck); return `<tr><td><input type="checkbox" data-hauler-compare="${esc(truck.id)}" ${compareIds.has(String(truck.id)) ? 'checked' : ''}></td><th>${esc(truck.code)}${truck.active ? '' : '<small>Nonaktif</small>'}</th><td>${esc(truck.classUnit || '—')}</td><td>${esc(truck.type || '—')}</td><td>${truck.capacity ?? '—'} ${esc(truck.capacityUom)}</td>${DISTANCES.map(distance => { const value = haulerProductivity(context, truck, profile, distance); return `<td class="${distance === benchmark ? 'is-benchmark' : ''}" data-hauler-detail="${esc(truck.id)}" data-distance="${distance}" title="${value == null ? 'Parameter atau UoM belum lengkap' : `${value.toFixed(4)} ${unit} · ${distance} m`}"><b>${value == null ? '—' : value.toFixed(2)}</b></td>`; }).join('')}</tr>`; }).join('') || `<tr><td colspan="${DISTANCES.length + 5}">Tidak ada unit sesuai filter.</td></tr>`}</tbody></table></div>${compareIds.size ? `<div class="ppw-hauler-compare"><b>Perbandingan @ ${(benchmark / 1000).toFixed(1)} km</b>${dumpTrucks.filter(truck => compareIds.has(String(truck.id))).map(truck => { const value = haulerProductivity(context, truck, getProfile(context, material, truck), benchmark); return `<span>${esc(truck.code)} <strong>${value == null ? '—' : value.toFixed(2)} ${unit}</strong></span>`; }).join('')}</div>` : ''}${detailTruck ? `<aside class="ppw-hauler-detail"><button type="button" data-close-hauler-detail>×</button><b>${esc(detailTruck.code)} · ${(detail.distance / 1000).toFixed(1)} km</b><span>${esc(material)} · ${esc(detailTruck.capacityUom)} · formula ${HAULER_FORMULA_VERSION}</span><dl><dt>Loading</dt><dd>${esc(detailProfile.loadingTime || '—')} min</dd><dt>Loaded / Empty speed</dt><dd>${esc(detailProfile.loadedSpeed || '—')} / ${esc(detailProfile.emptySpeed || '—')} km/jam</dd><dt>Spot & Dump</dt><dd>${esc(detailProfile.spotDumpTime || '—')} min</dd><dt>Work Efficiency</dt><dd>${esc(detailProfile.workEfficiency || '—')}</dd><dt>Productivity</dt><dd><strong>${detailValue == null ? '—' : detailValue.toFixed(4)} ${unit}</strong></dd></dl></aside>` : ''}</section>`;
  }

  function visibleHaulerTrucks(context) {
    const filters = context.haulerFilters;
    return dumpTrucks.filter(truck => {
      if (filters.search && !`${truck.code} ${truck.classUnit} ${truck.type}`.toLowerCase().includes(String(filters.search).toLowerCase())) return false;
      if (filters.classUnit && truck.classUnit !== filters.classUnit) return false;
      if (filters.model && truck.type !== filters.model) return false;
      if (filters.status === 'active' && !truck.active) return false;
      if (filters.status === 'inactive' && truck.active) return false;
      return true;
    });
  }

  function renderHaulerDatabase(context) {
    const loaderId = context.haulerLoaderId || excavators[0]?.id || '';
    context.haulerLoaderId = loaderId;
    const trucks = visibleHaulerTrucks(context);
    const materials = context.parameters.map(item => item.material);
    const distances = distanceHeaders(context);
    const classes = [...new Set(dumpTrucks.map(item => item.classUnit).filter(Boolean))].sort();
    const models = [...new Set(dumpTrucks.map(item => item.type).filter(Boolean))].sort();
    const unit = context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr';
    const capacityUom = DEFAULT_CAPACITY_UOM[context.type];
    const ready = trucks.reduce((count, truck) => count + materials.filter(material =>
      haulerProductivity(context, truck, haulerRow(context, loaderId, truck, material)
        || { loaderId, material }, distances[0]) != null).length, 0);
    const input = (row, field, step = '0.01', bad = []) => {
      const hit = bad.find(item => item.field === field);
      return '<input type="number" min="0" step="' + step + '" data-hauler-row-field="' + field
      + '" value="' + esc(row?.[field] ?? '') + '" ' + readonlyAttr(context)
      + (hit ? ' class="ppw-invalid" title="' + esc(hit.note) + '"' : '') + '>';
    };
    const rows = trucks.flatMap(truck => materials.map((material, materialIndex) => {
      const row = haulerRow(context, loaderId, truck, material);
      const bad = haulerRowInvalidFields(row, context.type);
      const legacyUnit = row && capacityKind(row.capacityUom) !== capacityKind(capacityUom);
      const loadingTime = loadingFor(context, loaderId, truck, material, row);
      const start = '<tr data-hauler-truck-id="' + esc(truck.id) + '" data-hauler-material="' + esc(material)
        + '" class="' + [materialIndex === 0 ? 'ppw-unit-start' : '', bad.length ? 'ppw-row-invalid' : ''].filter(Boolean).join(' ') + '"'
        + (bad.length ? ' title="Belum valid: ' + esc(bad.map(item => item.note).join('; ')) + '"' : '') + '>';
      const identity = '<th>' + esc(truck.code) + (truck.active ? '' : '<small>Nonaktif</small>') + '</th>'
        + '<td class="ppw-material-cell">' + esc(material) + '</td>'
        + '<td>' + esc(truck.classUnit || '—') + '</td><td>' + esc(truck.type || '—') + '</td>';
      const legacySource = legacyUnit
        ? '<small class="ppw-unit-warning">Sumber lama: ' + esc(row.capacity ?? '—') + ' '
          + esc(row.capacityUom || 'tanpa satuan') + '. Masukkan Capacity ' + capacityUom + '.</small>'
        : '';
      const capacityInputRow = legacyUnit ? { ...row, capacity: '' } : row;
      const capacity = '<td class="ppw-capacity-cell">' + legacySource
        + input(capacityInputRow, 'capacity', '0.1', bad) + '<span>' + capacityUom + '</span></td>';
      const operations = '<td>' + (loadingTime == null ? '—' : loadingTime.toFixed(2)) + '</td>'
        + '<td>' + input(row, 'loadedSpeed', '0.01', bad) + '</td><td>' + input(row, 'emptySpeed', '0.01', bad) + '</td>'
        + '<td>' + input(row, 'spotDumpTime', '0.01', bad) + '</td><td>' + input(row, 'workEfficiency', '0.01', bad) + '</td>';
      const values = distances.map(distance => {
        const value = haulerProductivity(context, truck, row || { loaderId, material }, distance);
        return '<td data-hauler-detail="' + esc(truck.id) + '" data-distance="' + distance
          + '" data-material="' + esc(material) + '"><b>' + (value == null ? '—' : value.toFixed(2)) + '</b></td>';
      }).join('');
      return start + identity + capacity + operations + values + '</tr>';
    })).join('');
    const headers = distances.map(distance => '<th>' + (distance / 1000).toFixed(1) + ' km'
      + '<button type="button" data-remove-distance="' + distance + '" aria-label="Hapus kolom jarak '
      + distance + ' meter" ' + readonlyAttr(context) + '>×</button></th>').join('');
    const toolbar = '<div class="ppw-hauler-toolbar"><label>Cari unit<input type="search" data-hauler-filter="search" value="'
      + esc(context.haulerFilters.search) + '" placeholder="Kode, class, model"></label>'
      + '<label>Class<select data-hauler-filter="classUnit"><option value="">Semua Class</option>'
      + classes.map(value => '<option value="' + esc(value) + '" ' + (context.haulerFilters.classUnit === value ? 'selected' : '')
        + '>' + esc(value) + '</option>').join('') + '</select></label>'
      + '<label>Model<select data-hauler-filter="model"><option value="">Semua Model</option>'
      + models.map(value => '<option value="' + esc(value) + '" ' + (context.haulerFilters.model === value ? 'selected' : '')
        + '>' + esc(value) + '</option>').join('') + '</select></label>'
      + '<label>Status<select data-hauler-filter="status"><option value="all" ' + (context.haulerFilters.status === 'all' ? 'selected' : '') + '>Semua</option>'
      + '<option value="active" ' + (context.haulerFilters.status === 'active' ? 'selected' : '') + '>Aktif</option>'
      + '<option value="inactive" ' + (context.haulerFilters.status === 'inactive' ? 'selected' : '') + '>Nonaktif</option></select></label></div>';
    const quick = context.quickOpen ? '<div class="ppw-quick-panel"><label>Kolom<select data-quick-field>'
      + ['capacity', 'loadedSpeed', 'emptySpeed', 'spotDumpTime', 'workEfficiency'].map(field =>
        '<option value="' + field + '">' + field + '</option>').join('') + '</select></label>'
      + '<label>Material<select data-quick-material><option value="">Semua material</option>'
      + materials.map(material => '<option value="' + esc(material) + '">' + esc(material) + '</option>').join('')
      + '</select></label><label>Nilai<input type="number" min="0" step="0.01" data-quick-value></label>'
      + '<label>Mode<select data-quick-mode><option value="empty">Isi yang kosong</option>'
      + '<option value="overwrite">Timpa nilai terisi</option></select></label>'
      + '<button type="button" data-apply-quick class="tombol tombol--utama">Terapkan</button></div>' : '';
    return '<section class="ppw-hauler"><div class="ppw-excavator-tabs" aria-label="Pilih excavator">'
      + excavators.map(item => '<button type="button" data-hauler-loader="' + esc(item.id) + '" class="'
        + (String(item.id) === String(loaderId) ? 'is-active' : '') + '">' + esc(item.code) + '</button>').join('')
      + '</div>' + toolbar + '<div class="ppw-hauler-kpis"><div><span>Excavator</span><b>'
      + esc(excavators.find(item => String(item.id) === String(loaderId))?.code || '—')
      + '</b></div><div><span>Unit tampil</span><b>' + trucks.length + '</b></div>'
      + '<div><span>Material per unit</span><b>' + materials.length + '</b></div>'
      + '<div><span>Baris siap @ ' + (distances[0] / 1000).toFixed(1) + ' km</span><b>'
      + ready + '/' + (trucks.length * materials.length) + '</b></div></div>'
      + '<div class="ppw-quick-tools"><button type="button" data-toggle-quick class="tombol tombol--ghost" '
      + readonlyAttr(context) + '>Input Cepat</button><button type="button" data-copy-hauler class="tombol tombol--ghost">Salin Data'
      + '</button><button type="button" data-paste-hauler class="tombol tombol--ghost" '
      + (context.haulerClipboard ? readonlyAttr(context) : 'disabled') + '>Tempel ke Excavator Ini</button>'
      + '<span>' + trucks.length + ' unit × ' + materials.length + ' material pada filter aktif.</span></div>'
      + quick + '<div class="ppw-distance-tools"><label>Tambah header jarak (meter)'
      + '<input type="number" min="100" step="100" data-new-distance value="' + (Math.max(...distances) + 100) + '" '
      + readonlyAttr(context) + '></label><button type="button" data-add-distance class="tombol tombol--ghost" '
      + readonlyAttr(context) + '>+ Jarak</button><span>Interval 100 meter · '
      + distances.length + ' kolom</span></div>'
      + '<p class="ppw-hauler-note">Setiap unit menampilkan seluruh material Parameter. Capacity '
      + capacityUom + '; Loading Time dihitung otomatis dari jumlah pass × Cycle Time Loading ÷ 60.</p>'
      + '<div class="ppw-scroll ppw-matrix"><table><thead><tr><th>Unit</th><th>Material</th>'
      + '<th>Class</th><th>Model</th><th>Capacity (' + capacityUom + ')</th><th>Loading Time (min)</th>'
      + '<th>Loaded Speed (km/jam)</th><th>Empty Speed (km/jam)</th><th>Spot & Dump (min)</th>'
      + '<th>Work Efficiency</th>' + headers + '</tr></thead><tbody>'
      + (rows || '<tr><td colspan="' + (distances.length + 10) + '">Tidak ada unit pada filter aktif.</td></tr>')
      + '</tbody></table></div></section>';
  }

  function loaderCard(context, scenario) {
    const result = computeScenario(context, scenario);
    const unit = context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr';
    const selectedJobs = new Set(scenario.jobCodes || []);
    return `<article class="ppw-loader-card" data-scenario-id="${esc(scenario.id)}">
      <header><div><small>LOADER DATABASE</small><strong>${esc(scenario.loaderCode)} · ${esc(scenario.material)}</strong></div><button type="button" data-delete-scenario aria-label="Hapus Loader ${esc(scenario.loaderCode)} ${esc(scenario.material)}" ${readonlyAttr(context)}>×</button></header>
      <div class="ppw-loader-fields"><div><span>Bucket Capacity</span><b>${result.bucketCapacity || '—'} m³</b></div><div><span>Bucket Fill Factor</span><b>${result.fill || '—'}</b></div><div><span>Swell Factor</span><b>${result.swell || '—'}</b></div>${context.type === 'coal' ? `<div><span>Density</span><b>${result.density || '—'} Ton/BCM</b></div>` : ''}</div>
      <label>Cycle Time Load (detik)<input type="number" min="0" step="0.1" data-scenario-field="cycleTimeLoading" value="${esc(scenario.cycleTimeLoading)}" ${readonlyAttr(context)}></label>
      <label>Work Efficiency Loader<input type="number" min="0" max="1" step="0.01" data-scenario-field="workEffLoader" value="${esc(scenario.workEffLoader)}" ${readonlyAttr(context)}></label>
      <details class="ppw-loader-jobs"><summary>JOB SPO (${selectedJobs.size} dipilih)</summary><div>${context.jobs.map(job => `<label><input type="checkbox" data-loader-job="${esc(job.jobCode)}" ${selectedJobs.has(job.jobCode) ? 'checked' : ''} ${readonlyAttr(context)}><span>${esc(job.jobCode)} · ${esc(job.jobDescription)}</span></label>`).join('') || '<small>Belum ada JOB SPO Deployed.</small>'}</div></details>
      <p class="ppw-loader-proof">Bucket efektif ${num(result.bucketCapacity).toFixed(2)} × ${num(result.fill).toFixed(2)} ÷ ${num(result.swell).toFixed(2)} = ${num(result.loaderCap).toFixed(3)} BCM<br>Produktivitas = 3.600 ÷ ${num(scenario.cycleTimeLoading).toFixed(1)} detik × ${num(result.loaderCap).toFixed(3)} × ${num(scenario.workEffLoader).toFixed(3)}${context.type === 'coal' ? ` × ${num(result.density).toFixed(3)} Ton/BCM` : ''}</p>
      <footer><span>Loader Productivity</span><strong>${result.loaderProductivity > 0 ? result.loaderProductivity.toFixed(2) : '—'} ${unit}</strong></footer>
    </article>`;
  }

  function renderLoaderWorkspace(context) {
    return context.fleets.map(fleet => {
      const scenarios = context.scenarios.filter(item => String(item.loaderId) === String(fleet.loaderId));
      const active = String(context.activeFleetId) === String(fleet.loaderId);
      const products = scenarios.map(item => computeScenario(context, item).loaderProductivity).filter(Boolean);
      return `<section class="ppw-fleet" data-fleet-id="${esc(fleet.loaderId)}"><button type="button" class="ppw-fleet-head" data-toggle-fleet><span><b>${esc(fleet.loaderCode)}</b><small>${scenarios.length}/${context.parameters.length} material · ${products.length ? `${Math.min(...products).toFixed(2)}–${Math.max(...products).toFixed(2)}` : 'belum dihitung'} ${context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr'}</small></span><i>${active ? '▾' : '▸'}</i></button>${active ? `<div class="ppw-fleet-body"><div class="ppw-material-overview"><table><thead><tr><th>Material</th><th>Parameter Sumber</th><th>Loader Productivity</th></tr></thead><tbody>${context.parameters.map(parameter => { const item = scenarios.find(row => row.material === parameter.material); const value = item ? computeScenario(context, item).loaderProductivity : 0; return `<tr data-add-scenario="${esc(parameter.material)}" class="ppw-material-row"><td><b>${esc(parameter.material)}</b></td><td>BFF ${esc(parameter.fill || '—')} · Swell ${esc(parameter.swell || '—')}${context.type === 'coal' ? ` · Density ${esc(parameter.density || '—')}` : ''}</td><td>${value > 0 ? value.toFixed(2) : item ? 'Perlu dilengkapi' : '+ Klik untuk mengisi'}</td></tr>`; }).join('')}</tbody></table></div><div class="ppw-card-grid">${scenarios.map(item => loaderCard(context, item)).join('') || '<div class="ppw-empty-state">Klik material untuk membuat Loader record.</div>'}</div><button type="button" class="tombol tombol--ghost ppw-delete-fleet" data-delete-fleet ${readonlyAttr(context)}>Hapus Excavator</button></div>` : ''}</section>`;
    }).join('') || '<div class="ppw-empty-state">Belum ada excavator. Klik <b>+ Tambah Fleet</b>.</div>';
  }

  function renderSettingFleet(context) {
    const selectedScenario = context.scenarios.find(item => item.id === context.settingLoaderChoice) || context.scenarios[0];
    context.settingLoaderChoice = selectedScenario?.id || '';
    const jobs = selectedScenario?.jobCodes || [];
    if (!jobs.includes(context.settingJobChoice)) context.settingJobChoice = jobs[0] || '';
    const unit = context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr';
    const classes = [...new Set(dumpTrucks.map(item => item.classUnit).filter(Boolean))].sort();
    const cards = context.simulationSetups.map(setting => {
      const scenario = context.scenarios.find(item => item.id === setting.loaderScenarioId);
      const result = computeFleetSetup(context, setting);
      const selected = new Set((setting.dumpTruckIds || []).map(String));
      const classFilters = new Set(setting.classFilters || []);
      return `<article class="ppw-setting-card" data-setting-id="${esc(setting.id)}">
        <header><div><small>SIMULASI FLEET</small><strong>${esc(scenario?.loaderCode || 'Excavator tidak ditemukan')} · ${esc(scenario?.material || 'Material tidak ditemukan')} · ${esc(setting.jobCode)}</strong></div><button type="button" data-delete-setting>Hapus</button></header>
        <div class="ppw-setting-meta"><label>Jarak acuan<select data-setting-field="benchmarkDistanceMeters">${distanceHeaders(context).map(distance => `<option value="${distance}" ${Number(setting.benchmarkDistanceMeters) === distance ? 'selected' : ''}>${(distance / 1000).toFixed(1)} km</option>`).join('')}</select></label><span>${selected.size} Dump Truck dipilih</span></div>
        <details class="ppw-truck-picker"><summary>Pilih Dump Truck (${selected.size} unit)</summary><label>Filter Class<select multiple data-setting-class-slicer size="${Math.min(4, Math.max(2, classes.length))}">${classes.map(value => `<option value="${esc(value)}" ${classFilters.has(value) ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><div class="ppw-truck-tools"><input type="search" data-truck-search placeholder="Cari kode atau model"><button type="button" data-select-filtered>Pilih Semua Hasil</button><button type="button" data-clear-trucks>Kosongkan</button></div><div data-truck-options>${dumpTrucks.filter(truck => truck.active || selected.has(String(truck.id))).map(truck => `<label data-truck-class="${esc(truck.classUnit)}" data-truck-search-text="${esc(`${truck.code} ${truck.type} ${truck.classUnit}`.toLowerCase())}" data-truck-active="${truck.active ? 'true' : 'false'}" ${classFilters.size && !classFilters.has(truck.classUnit) ? 'hidden' : ''}><input type="checkbox" data-truck-id="${esc(truck.id)}" ${selected.has(String(truck.id)) ? 'checked' : ''}><span><b>${esc(truck.code)}</b><small>${esc(truck.classUnit)} · ${esc(truck.type)}${truck.active ? '' : ' · Nonaktif'}</small></span></label>`).join('')}</div></details>
        <div class="ppw-setting-kpis"><div><span>Loader</span><b>${result.loaderProductivity > 0 ? result.loaderProductivity.toFixed(2) : '—'}</b></div><div><span>Truck Fleet</span><b>${result.truckFleetProductivity > 0 ? result.truckFleetProductivity.toFixed(2) : '—'}</b></div><div><span>Fleet Match</span><b>${result.fleetMatch > 0 ? result.fleetMatch.toFixed(2) : '—'}</b></div><div class="${result.complete ? 'is-ready' : ''}"><span>Hasil Simulasi</span><b>${result.fleetProductivity > 0 ? result.fleetProductivity.toFixed(2) : '—'} ${unit}</b></div></div>
        <small class="ppw-setting-note">Hanya simulasi. Target operasional seluruh modul membaca Loader Productivity secara langsung.</small>
      </article>`;
    }).join('');
    return `<section class="ppw-setting"><div class="ppw-setting-create"><div><h3>Setting Fleet Simulation</h3><p>Simulasi sesi aktif: bandingkan Loader dengan kombinasi Dump Truck tanpa menyimpan hasil, tanpa periode efektif, dan tanpa menjadi sumber halaman operasional.</p></div><label>Excavator · Material<select data-setting-loader-choice><option value="">Pilih Loader</option>${context.scenarios.map(item => `<option value="${esc(item.id)}" ${item.id === context.settingLoaderChoice ? 'selected' : ''}>${esc(item.loaderCode)} · ${esc(item.material)}</option>`).join('')}</select></label><label>JOB<select data-setting-job-choice><option value="">Pilih JOB</option>${jobs.map(code => `<option value="${esc(code)}" ${code === context.settingJobChoice ? 'selected' : ''}>${esc(code)}</option>`).join('')}</select></label><button type="button" data-add-setting class="tombol tombol--utama">+ Tambah Simulasi</button></div><div class="ppw-setting-grid">${cards || '<div class="ppw-empty-state">Belum ada simulasi pada sesi ini.</div>'}</div></section>`;
  }

  function render(context) {
    const status = context.sourceEffectiveFrom
      ? `Data periode ini update dari ${context.sourceEffectiveFrom}` : 'Belum ada setup periode';
    const expired = Boolean(context.periodEnd && context.effectiveFrom > context.periodEnd);
    const periodBar = context.view === 'setting'
      ? '<div class="ppw-period"><strong>SIMULASI NON-PERIODE</strong><span>Tidak tersimpan · tidak menjadi source target modul lain</span></div>'
      : `<div class="ppw-period"><label>Tanggal Berlaku<input type="date" data-effective-date value="${esc(context.effectiveFrom)}" ${context.periodEnd ? `max="${esc(context.periodEnd)}"` : ''}></label><span class="${context.inherited ? 'is-inherited' : ''}">${esc(status)}${context.revision ? ` · revisi ${context.revision}` : ''}${context.periodEnd ? ` · berlaku sampai ${esc(context.periodEnd)}` : ''}</span><div><button type="button" class="tombol tombol--ghost" data-open-note>Note</button>${context.dirty && !expired ? '<button type="button" class="tombol tombol--utama" data-save-period>Simpan Setup Periode</button>' : ''}</div></div>`;
    context.container.innerHTML = `<div class="ppw-root">${periodBar}<div class="ppw-tabs"><button type="button" data-view="fleet" class="${context.view === 'fleet' ? 'is-active' : ''}">Loader Productivity</button><button type="button" data-view="hauler" class="${context.view === 'hauler' ? 'is-active' : ''}">Hauler Productivity</button><button type="button" data-view="setting" class="${context.view === 'setting' ? 'is-active' : ''}">Setting Fleet Simulation</button></div>${context.view === 'setting' ? renderSettingFleet(context) : expired ? '<div class="ppw-empty-state is-error">Tanggal berada di luar periode SPO. Pilih tanggal dalam periode yang tersedia.</div>' : context.view === 'hauler' ? renderHaulerDatabase(context) : `${renderHighlight(context)}${renderParameterTable(context)}<div class="ppw-fleet-list">${renderLoaderWorkspace(context)}</div>`}</div>`;
  }

  async function loadContext(context, effectiveFrom) {
    const response = await fetch(apiUrl(`/api/admin/production/productivity-plans/${context.type}?effectiveFrom=${encodeURIComponent(effectiveFrom)}`), { headers: auth() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const normalized = normalizeLoaded(context.type, payload);
    Object.assign(context, normalized, {
      effectiveFrom, sourceEffectiveFrom: payload.effectiveFrom || null,
      revision: payload.revision || null, inherited: Boolean(payload.isInherited), dirty: false, draftNew: false,
      periodEnd: payload.periodEnd || null
    });
    normalizeHaulerUnits(context);
    context.jobs = await fetchJobs(context.effectiveFrom);
    if (!context.fleets.length && context.scenarios.length) context.fleets = [...new Map(context.scenarios.map(item => [item.loaderId, { loaderId: item.loaderId, loaderCode: item.loaderCode }])).values()];
    render(context);
  }

  async function saveContext(context, button) {
    const planningData = buildPlanningData(context);
    const task = async () => {
      const response = await fetch(apiUrl(`/api/admin/production/productivity-plans/${context.type}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ contentHtml: serialize(context.container), planningData, effectiveFrom: context.effectiveFrom, revision: context.revision })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      context.revision = payload.revision;
      context.sourceEffectiveFrom = payload.effective_from || context.effectiveFrom;
      context.inherited = false; context.dirty = false; context.draftNew = false;
      render(context);
      return payload;
    };
    try {
      if (global.OMOSActionFeedback?.run) await global.OMOSActionFeedback.run(button, task, { successText: 'Tersimpan' });
      else await task();
    } catch (error) { alert(`Gagal menyimpan setup periode: ${error.message}`); }
  }

  function chooseExcavator(context) {
    const used = new Set(context.fleets.map(item => String(item.loaderId)));
    const available = excavators.filter(item => item.active && !used.has(String(item.id)));
    if (!available.length) return alert('Semua excavator aktif sudah ditambahkan pada halaman ini.');
    const overlay = document.createElement('div');
    overlay.className = 'ppw-modal';
    overlay.innerHTML = `<div><h3>Tambah Fleet ${context.type.toUpperCase()}</h3><p>Pilih excavator dari List Equipment. Setiap material hanya memiliki satu data Fleet pada periode aktif.</p><select data-excavator><option value="">Pilih Excavator</option>${available.map(item => `<option value="${esc(item.id)}">${esc(item.code)} · ${esc(item.classUnit)} · ${esc(item.type)}</option>`).join('')}</select><footer><button class="tombol tombol--ghost" data-cancel>Batal</button><button class="tombol tombol--utama" data-confirm>Tambah Fleet</button></footer></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').onclick = close;
    overlay.querySelector('[data-confirm]').onclick = () => {
      const loader = excavators.find(item => String(item.id) === overlay.querySelector('[data-excavator]').value);
      if (!loader) return;
      context.fleets.push({ loaderId: loader.id, loaderCode: loader.code }); context.activeFleetId = loader.id;
      markDirty(context); close(); render(context);
    };
  }
  function showPeriodNote() {
    const overlay = document.createElement('div');
    overlay.className = 'ppw-modal';
    overlay.innerHTML = '<div><h3>Catatan Setup Periode</h3>'
      + '<p>Setup data berdasarkan periode harian. Data otomatis berlaku pada hari berikutnya sampai akhir periode SPO, kecuali ada pembaruan baru. Pembaruan tidak mengubah data pada tanggal sebelumnya.</p>'
      + '<p><b>Contoh:</b> Kecepatan angkut diatur 25 km/jam pada 16 September. Jika diubah menjadi 28 km/jam mulai 20 September, tanggal 16–19 tetap memakai 25 km/jam; tanggal 20 dan seterusnya memakai 28 km/jam sampai ada pembaruan berikutnya.</p>'
      + '<footer><button type="button" class="tombol tombol--utama" data-close-note>Tutup</button></footer></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-close-note]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
  }

  function attachEvents(context) {
    const container = context.container;
    container.addEventListener('click', async event => {
      if (event.target.closest('[data-save-period]')) return saveContext(context, event.target.closest('[data-save-period]'));
      if (event.target.closest('[data-open-note]')) return showPeriodNote();
      if (event.target.closest('[data-add-distance]')) {
        const distance = Number(container.querySelector('[data-new-distance]')?.value);
        if (!Number.isInteger(distance) || distance < 100 || distance > 50000 || distance % 100 !== 0)
          return alert('Jarak harus 100–50.000 meter dalam kelipatan 100 meter.');
        if (distanceHeaders(context).includes(distance)) return alert('Header jarak tersebut sudah ada.');
        if (distanceHeaders(context).length >= 80) return alert('Maksimal 80 header jarak dalam satu setup.');
        context.distanceHeadersMeters = [...distanceHeaders(context), distance].sort((a, b) => a - b);
        markDirty(context); return render(context);
      }
      const removeDistance = event.target.closest('[data-remove-distance]');
      if (removeDistance) {
        const distance = Number(removeDistance.dataset.removeDistance);
        if (distanceHeaders(context).length <= 1) return alert('Minimal satu header jarak harus tersedia.');
        context.distanceHeadersMeters = distanceHeaders(context).filter(item => item !== distance);
        markDirty(context); return render(context);
      }
      if (event.target.closest('[data-copy-hauler]')) {
        const loaderId = context.haulerLoaderId;
        const truckIds = new Set(visibleHaulerTrucks(context).map(item => String(item.id)));
        const rows = context.haulerRows.filter(row => String(row.loaderId) === String(loaderId)
          && truckIds.has(String(row.truckId)) && context.parameters.some(item => item.material === row.material));
        if (!rows.length) return alert('Belum ada data Hauler yang dapat disalin pada filter aktif.');
        context.haulerClipboard = { loaderId, rows: rows.map(row => ({ truckId: row.truckId,
          material: row.material, capacity: row.capacity, capacityUom: row.capacityUom,
          loadedSpeed: row.loadedSpeed, emptySpeed: row.emptySpeed,
          spotDumpTime: row.spotDumpTime, workEfficiency: row.workEfficiency })) };
        return alert(rows.length + ' baris input Hauler disalin. Pilih excavator tujuan lalu klik Tempel.');
      }
      if (event.target.closest('[data-paste-hauler]')) {
        const copied = context.haulerClipboard;
        if (!copied || String(copied.loaderId) === String(context.haulerLoaderId))
          return alert('Pilih excavator tujuan yang berbeda.');
        const truckIds = new Set(dumpTrucks.map(item => String(item.id)));
        const valid = copied.rows.filter(row => truckIds.has(String(row.truckId))
          && context.parameters.some(item => item.material === row.material));
        if (!valid.length) return alert('Tidak ada unit dan material yang cocok di excavator tujuan.');
        if (!confirm('Tempel ' + valid.length + ' baris ke excavator ini? Input yang sudah ada akan ditimpa. Loading Time tetap dihitung ulang.')) return;
        valid.forEach(source => {
          const truck = dumpTrucks.find(item => String(item.id) === String(source.truckId));
          const target = ensureHaulerRow(context, context.haulerLoaderId, truck, source.material);
          ['capacity', 'capacityUom', 'loadedSpeed', 'emptySpeed', 'spotDumpTime', 'workEfficiency']
            .forEach(field => { target[field] = source[field]; });
        });
        // Normalisasi langsung: BCM yang density-nya tersedia terkonversi ke
        // Ton saat itu juga (tidak menunggu edit density berikutnya).
        normalizeHaulerUnits(context);
        markDirty(context); render(context);
        const bermasalah = [];
        valid.forEach(source => {
          const target = haulerRow(context, context.haulerLoaderId, { id: source.truckId }, source.material);
          const bad = haulerRowInvalidFields(target, context.type);
          if (bad.length) {
            const truck = dumpTrucks.find(item => String(item.id) === String(source.truckId));
            bermasalah.push(`${truck?.code || source.truckId} / ${source.material}: ${bad.map(item => item.note).join('; ')}`);
          }
        });
        if (bermasalah.length) alert('Tempel selesai, tetapi baris berikut belum valid dan akan menggagalkan Simpan:\n' + bermasalah.slice(0, 8).join('\n') + (bermasalah.length > 8 ? `\n...dan ${bermasalah.length - 8} baris lainnya.` : '') + '\nPerbaiki sel bertanda merah (mis. isi density agar satuan Ton otomatis).');
        return;
      }
      if (event.target.closest('[data-close-hauler-detail]')) { context.haulerDetail = null; return render(context); }
      const loaderButton = event.target.closest('[data-hauler-loader]');
      if (loaderButton) { context.haulerLoaderId = loaderButton.dataset.haulerLoader; return render(context); }
      if (event.target.closest('[data-toggle-quick]')) { context.quickOpen = !context.quickOpen; return render(context); }
      if (event.target.closest('[data-apply-quick]')) {
        const field = container.querySelector('[data-quick-field]')?.value;
        const value = container.querySelector('[data-quick-value]')?.value;
        const mode = container.querySelector('[data-quick-mode]')?.value;
        if (!['capacity', 'loadedSpeed', 'emptySpeed', 'spotDumpTime', 'workEfficiency'].includes(field)
          || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0
          || (field !== 'spotDumpTime' && Number(value) <= 0)
          || (field === 'workEfficiency' && Number(value) > 1)) return alert('Nilai Input Cepat tidak valid.');
        const materialScope = container.querySelector('[data-quick-material]')?.value;
        const targets = visibleHaulerTrucks(context).flatMap(truck => context.parameters
          .filter(item => !materialScope || item.material === materialScope)
          .map(item => ({ truck, material: item.material })));
        if (!targets.length) return alert('Tidak ada baris pada filter aktif.');
        const affected = targets.filter(({ truck, material }) => mode === 'overwrite'
          || String(haulerRow(context, context.haulerLoaderId, truck, material)?.[field] ?? '').trim() === '');
        if (!affected.length) return alert('Tidak ada kolom kosong pada filter aktif.');
        if (!confirm(`Terapkan ${field} = ${value} ke ${affected.length} baris pada excavator aktif?`)) return;
        affected.forEach(({ truck, material }) => { const row = ensureHaulerRow(context, context.haulerLoaderId, truck, material);
          assignHaulerField(context, row, field, value); });
        markDirty(context); return render(context);
      }
      const haulerCell = event.target.closest('[data-hauler-detail]');
      if (haulerCell) {
        const truck = dumpTrucks.find(item => String(item.id) === haulerCell.dataset.haulerDetail);
        const material = haulerCell.dataset.material;
        const row = truck && haulerRow(context, context.haulerLoaderId, truck, material);
        const value = truck && haulerProductivity(context, truck, row || { loaderId: context.haulerLoaderId, material }, Number(haulerCell.dataset.distance));
        return alert(`${truck?.code || 'Unit'} · ${material} · ${haulerCell.dataset.distance} m\nLoading Time: ${loadingFor(context, context.haulerLoaderId, truck, material, row)?.toFixed(2) || '—'} menit\nProductivity: ${value == null ? '—' : value.toFixed(4)} ${context.type === 'coal' ? 'Ton/Hr' : 'BCM/Hr'}`);
      }
      const view = event.target.closest('[data-view]')?.dataset.view;
      if (view) { context.view = view; return render(context); }
      if (event.target.closest('[data-add-setting]')) {
        const scenario = context.scenarios.find(item => item.id === context.settingLoaderChoice);
        const jobCode = context.settingJobChoice;
        if (!scenario || !jobCode || !(scenario.jobCodes || []).includes(jobCode))
          return alert('Pilih Loader record dan JOB SPO pada kartu Loader terlebih dahulu.');
        if (context.simulationSetups.some(item => item.loaderScenarioId === scenario.id && item.jobCode === jobCode))
          return alert('Simulasi untuk excavator, material, dan JOB ini sudah ada.');
        context.simulationSetups.push({ id: uid(`${context.type}-simulation`), loaderScenarioId: scenario.id,
          jobCode, dumpTruckIds: [], benchmarkDistanceMeters: 1000, classFilters: [] });
        return render(context);
      }
      const settingRoot = event.target.closest('[data-setting-id]');
      if (settingRoot) {
        const setting = context.simulationSetups.find(item => item.id === settingRoot.dataset.settingId);
        if (!setting) return;
        if (event.target.closest('[data-delete-setting]')) {
          if (!confirm(`Hapus simulasi ${setting.jobCode} dari sesi ini?`)) return;
          context.simulationSetups = context.simulationSetups.filter(item => item.id !== setting.id);
          return render(context);
        }
        if (event.target.closest('[data-select-filtered]')) {
          const selected = new Set((setting.dumpTruckIds || []).map(String));
          settingRoot.querySelectorAll('[data-truck-options] label:not([hidden])[data-truck-active="true"] input[data-truck-id]')
            .forEach(input => selected.add(String(input.dataset.truckId)));
          setting.dumpTruckIds = [...selected]; return render(context);
        }
        if (event.target.closest('[data-clear-trucks]')) {
          setting.dumpTruckIds = []; return render(context);
        }
      }
      const fleetRoot = event.target.closest('[data-fleet-id]');
      if (event.target.closest('[data-toggle-fleet]') && fleetRoot) { context.activeFleetId = String(context.activeFleetId) === fleetRoot.dataset.fleetId ? null : fleetRoot.dataset.fleetId; return render(context); }
      if (event.target.closest('[data-delete-fleet]') && fleetRoot) {
        if (!confirm('Hapus fleet dan seluruh scenario pada versi periode ini?')) return;
        context.fleets = context.fleets.filter(item => String(item.loaderId) !== fleetRoot.dataset.fleetId);
        const removed = new Set(context.scenarios.filter(item => String(item.loaderId) === fleetRoot.dataset.fleetId).map(item => item.id));
        context.simulationSetups = context.simulationSetups.filter(item => !removed.has(item.loaderScenarioId));
        context.scenarios = context.scenarios.filter(item => String(item.loaderId) !== fleetRoot.dataset.fleetId);
        markDirty(context); return render(context);
      }
      const addMaterial = event.target.closest('[data-add-scenario]');
      if (addMaterial && fleetRoot) {
        const fleet = context.fleets.find(item => String(item.loaderId) === fleetRoot.dataset.fleetId);
        const existing = context.scenarios.find(item => String(item.loaderId) === String(fleet.loaderId)
          && String(item.material).trim().toLocaleLowerCase('id-ID') === String(addMaterial.dataset.addScenario).trim().toLocaleLowerCase('id-ID'));
        if (existing) return [...fleetRoot.querySelectorAll('[data-scenario-id]')]
          .find(card => card.dataset.scenarioId === existing.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        context.scenarios.push({ id: uid(`${context.type}-scenario`), loaderId: fleet.loaderId, loaderCode: fleet.loaderCode,
          material: addMaterial.dataset.addScenario, jobCodes: [], cycleTimeLoading: '', workEffLoader: '' });
        markDirty(context); return render(context);
      }
      const scenarioRoot = event.target.closest('[data-scenario-id]');
      if (scenarioRoot && event.target.closest('[data-select-filtered]')) {
        const scenario = context.scenarios.find(item => item.id === scenarioRoot.dataset.scenarioId);
        const selected = new Set((scenario.dumpTruckIds || []).map(String));
        scenarioRoot.querySelectorAll('[data-truck-options] label:not([hidden])[data-truck-active="true"] input[data-truck-id]').forEach(input => selected.add(String(input.dataset.truckId)));
        scenario.dumpTruckIds = [...selected]; markDirty(context); return render(context);
      }
      if (scenarioRoot && event.target.closest('[data-clear-trucks]')) {
        const scenario = context.scenarios.find(item => item.id === scenarioRoot.dataset.scenarioId);
        scenario.dumpTruckIds = []; markDirty(context); return render(context);
      }
      if (event.target.closest('[data-delete-scenario]') && scenarioRoot) {
        context.simulationSetups = context.simulationSetups.filter(item => item.loaderScenarioId !== scenarioRoot.dataset.scenarioId);
        context.scenarios = context.scenarios.filter(item => item.id !== scenarioRoot.dataset.scenarioId); markDirty(context); return render(context);
      }
      if (event.target.closest('[data-add-parameter]')) {
        context.parameters.push({ id: uid(`${context.type}-material`), material: `Material ${context.parameters.length + 1}`, density: context.type === 'coal' ? '' : null, fill: '', swell: '' }); markDirty(context); return render(context);
      }
      const parameterRoot = event.target.closest('[data-parameter-id]');
      if (event.target.closest('[data-delete-parameter]') && parameterRoot) {
        const parameter = context.parameters.find(item => item.id === parameterRoot.dataset.parameterId);
        if (context.scenarios.some(item => item.material === parameter?.material)) return alert('Material masih digunakan scenario. Hapus scenario terkait terlebih dahulu.');
        const linkedHaulerCount = context.haulerRows.filter(item => item.material === parameter?.material).length;
        if (linkedHaulerCount && !confirm(`Hapus material ${parameter.material} dan ${linkedHaulerCount} data Hauler pada versi periode ini?`)) return;
        context.haulerProfiles = context.haulerProfiles.filter(item => item.material !== parameter?.material);
        context.haulerRows = context.haulerRows.filter(item => item.material !== parameter?.material);
        context.parameters = context.parameters.filter(item => item.id !== parameterRoot.dataset.parameterId);
        if (context.haulerMaterial === parameter?.material) context.haulerMaterial = context.parameters[0]?.material || '';
        markDirty(context); return render(context);
      }
    });
    container.addEventListener('input', event => {
      if (!event.target.matches('[data-truck-search]')) return;
      const scenarioRoot = event.target.closest('[data-setting-id]');
      const setting = context.simulationSetups.find(item => item.id === scenarioRoot?.dataset.settingId);
      const query = event.target.value.trim().toLowerCase();
      const classes = new Set((setting?.classFilters || []).map(String));
      scenarioRoot?.querySelectorAll('[data-truck-options] label').forEach(label => {
        const classVisible = !classes.size || classes.has(label.dataset.truckClass);
        label.hidden = !classVisible || (query && !String(label.dataset.truckSearchText || '').includes(query));
      });
    });
    container.addEventListener('change', async event => {
      if (event.target.matches('[data-effective-date]')) {
        if (context.dirty && !confirm('Perubahan periode ini belum disimpan. Tetap pindah periode?')) { event.target.value = context.effectiveFrom; return; }
        if (context.periodEnd && event.target.value > context.periodEnd) {
          event.target.value = context.effectiveFrom;
          return alert('Tanggal melebihi akhir periode SPO (' + context.periodEnd + ').');
        }
        try { await loadContext(context, event.target.value); } catch (error) { alert(error.message); }
        return;
      }
      if (event.target.matches('[data-setting-loader-choice]')) {
        context.settingLoaderChoice = event.target.value; context.settingJobChoice = '';
        return render(context);
      }
      if (event.target.matches('[data-setting-job-choice]')) {
        context.settingJobChoice = event.target.value; return render(context);
      }
      const haulerRoot = event.target.closest('[data-hauler-truck-id]');
      if (haulerRoot && event.target.dataset.haulerRowField) {
        const truck = dumpTrucks.find(item => String(item.id) === haulerRoot.dataset.haulerTruckId);
        if (!truck) return;
        const row = ensureHaulerRow(context, context.haulerLoaderId, truck, haulerRoot.dataset.haulerMaterial);
        assignHaulerField(context, row, event.target.dataset.haulerRowField, event.target.value);
        markDirty(context); return render(context);
      }
      if (event.target.matches('[data-hauler-filter]')) {
        context.haulerFilters[event.target.dataset.haulerFilter] = event.target.value;
        return render(context);
      }
      if (event.target.matches('[data-hauler-compare]')) {
        const selected = new Set((context.haulerCompare || []).map(String));
        if (event.target.checked && selected.size >= 4) { event.target.checked = false; return alert('Maksimal empat unit dapat dibandingkan sekaligus.'); }
        event.target.checked ? selected.add(String(event.target.dataset.haulerCompare)) : selected.delete(String(event.target.dataset.haulerCompare));
        context.haulerCompare = [...selected]; return render(context);
      }
      const settingRoot = event.target.closest('[data-setting-id]');
      if (settingRoot) {
        const setting = context.simulationSetups.find(item => item.id === settingRoot.dataset.settingId);
        if (!setting) return;
        if (event.target.dataset.settingField === 'benchmarkDistanceMeters') {
          setting.benchmarkDistanceMeters = Number(event.target.value); return render(context);
        }
        if (event.target.dataset.truckId) {
          const selected = new Set((setting.dumpTruckIds || []).map(String));
          event.target.checked ? selected.add(String(event.target.dataset.truckId)) : selected.delete(String(event.target.dataset.truckId));
          setting.dumpTruckIds = [...selected]; return render(context);
        }
        if (event.target.matches('[data-setting-class-slicer]')) {
          const classes = new Set([...event.target.selectedOptions].map(item => item.value));
          setting.classFilters = [...classes];
          settingRoot.querySelectorAll('[data-truck-class]').forEach(label => { label.hidden = classes.size > 0 && !classes.has(label.dataset.truckClass); });
          return;
        }
      }
      const scenarioRoot = event.target.closest('[data-scenario-id]');
      if (scenarioRoot) {
        const scenario = context.scenarios.find(item => item.id === scenarioRoot.dataset.scenarioId);
        if (event.target.dataset.loaderJob) {
          const selected = new Set(scenario.jobCodes || []);
          event.target.checked ? selected.add(event.target.dataset.loaderJob) : selected.delete(event.target.dataset.loaderJob);
          if (!event.target.checked) context.simulationSetups = context.simulationSetups.filter(item =>
            item.loaderScenarioId !== scenario.id || item.jobCode !== event.target.dataset.loaderJob);
          scenario.jobCodes = [...selected]; markDirty(context); return render(context);
        }
        if (event.target.dataset.scenarioField) {
          scenario[event.target.dataset.scenarioField] = event.target.value;
          if (event.target.dataset.scenarioField === 'jobCode') scenario.jobDescription = event.target.selectedOptions[0]?.dataset.desc || '';
          markDirty(context); return render(context);
        }
        if (event.target.dataset.truckId) {
          const selected = new Set((scenario.dumpTruckIds || []).map(String));
          event.target.checked ? selected.add(String(event.target.dataset.truckId)) : selected.delete(String(event.target.dataset.truckId));
          scenario.dumpTruckIds = [...selected]; markDirty(context); return render(context);
        }
        if (event.target.matches('[data-class-slicer]')) {
          const classes = new Set([...event.target.selectedOptions].map(item => item.value));
          scenario.classFilters = [...classes];
          scenarioRoot.querySelectorAll('[data-truck-class]').forEach(label => { label.hidden = classes.size > 0 && !classes.has(label.dataset.truckClass); });
          return;
        }
      }
      const parameterRoot = event.target.closest('[data-parameter-id]');
      if (parameterRoot && event.target.dataset.parameterField) {
        const parameter = context.parameters.find(item => item.id === parameterRoot.dataset.parameterId);
        const oldMaterial = parameter.material;
        parameter[event.target.dataset.parameterField] = event.target.value;
        if (event.target.dataset.parameterField === 'material') {
          context.scenarios.filter(item => item.material === oldMaterial).forEach(item => { item.material = event.target.value; });
          context.haulerProfiles.filter(item => item.material === oldMaterial).forEach(item => {
            item.material = event.target.value;
            item.key = `${item.material}|${item.classUnit}|${item.type}`;
          });
          context.haulerRows.filter(item => item.material === oldMaterial).forEach(item => { item.material = event.target.value; });
          if (context.haulerMaterial === oldMaterial) context.haulerMaterial = event.target.value;
        }
        if (event.target.dataset.parameterField === 'density') normalizeHaulerUnits(context);
        markDirty(context); return render(context);
      }
      const profileRoot = event.target.closest('[data-profile-key]');
      if (profileRoot && event.target.dataset.profileField) {
        const profile = context.haulerProfiles.find(item => item.key === profileRoot.dataset.profileKey);
        profile[event.target.dataset.profileField] = event.target.value; markDirty(context); return render(context);
      }
    });
  }

  async function initModule(config = {}) {
    const container = document.getElementById(config.containerId || 'planProductivityTables');
    if (!container) return null;
    if (container.dataset.workspaceInitialized === 'true') return container;
    container.dataset.workspaceInitialized = 'true';
    const type = container.dataset.planProductivityContainer === 'coal' ? 'coal' : 'ob';
    const context = { type, container, effectiveFrom: today(), sourceEffectiveFrom: null, revision: null,
      inherited: false, dirty: false, draftNew: false, parameters: defaultParameters(type), fleets: [], scenarios: [], simulationSetups: [], haulerProfiles: [], haulerRows: [], jobs: [], view: 'fleet', activeFleetId: null, haulerLoaderId: null, settingLoaderChoice: '', settingJobChoice: '', quickOpen: false,
      distanceHeadersMeters: [...DISTANCES], periodEnd: null,
      haulerFilters: { search: '', classUnit: '', model: '', status: 'all', benchmarkDistance: 1000 }, haulerCompare: [], haulerDetail: null };
    contexts.set(type, context);
    if (!global.__omosPlanningUnsavedGuard) {
      global.__omosPlanningUnsavedGuard = true;
      global.addEventListener('beforeunload', event => {
        if (![...contexts.values()].some(item => item.dirty)) return;
        event.preventDefault();
        event.returnValue = '';
      });
      document.addEventListener('click', event => {
        const destination = event.target.closest('.sidebar__tab[data-tab], [onclick^="bukaTabProduksi"]');
        if (!destination) return;
        const active = [...contexts.values()].find(item => item.dirty
          && item.container.closest('.tab-konten')?.hidden === false);
        if (!active) return;
        const ownTab = active.type === 'coal' ? 'prodCoalProductivity' : 'prodPlanProductivity';
        const targetTab = destination.dataset.tab || destination.getAttribute('onclick')?.match(/bukaTabProduksi\(['"]([^'"]+)/)?.[1];
        if (targetTab === ownTab) return;
        if (confirm('Perubahan setup periode belum disimpan. Tetap pindah halaman dan abaikan perubahan?')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
    attachEvents(context);
    const button = document.getElementById(config.addButtonId || (type === 'coal' ? 'btnAddCoalProductivityTable' : 'btnAddPlanProductivityTable'));
    if (button && button.dataset.workspaceAttached !== 'true') {
      button.dataset.workspaceAttached = 'true'; button.textContent = '+ Tambah Fleet';
      button.addEventListener('click', () => readonlyAttr(context) ? alert('Tanggal di luar periode SPO.') : chooseExcavator(context));
    }
    container.innerHTML = '<div class="ppw-empty-state">Memuat setup Productivity Planning…</div>';
    try { await loadContext(context, context.effectiveFrom); }
    catch (error) { container.innerHTML = `<div class="ppw-empty-state is-error">Gagal memuat planning: ${esc(error.message)}</div>`; }
    return container;
  }

  function setFleetOptions(options) {
    excavators = uniqueOptions(options, 'excavator');
    contexts.forEach(context => {
      context.fleets.forEach(fleet => { const match = excavators.find(unit => unit.code === fleet.loaderCode); if (match) fleet.loaderId = match.id; });
      context.scenarios.forEach(scenario => { const match = excavators.find(unit => unit.code === scenario.loaderCode); if (match) scenario.loaderId = match.id; });
      render(context);
    });
  }
  function setDumpTruckOptions(options) {
    dumpTrucks = uniqueOptions(options, 'dumpTruck');
    contexts.forEach(context => {
      context.scenarios.forEach(scenario => {
        scenario.dumpTruckIds = (scenario.dumpTruckIds || []).map(id => dumpTrucks.find(unit => String(unit.id) === String(id) || unit.code === id)?.id || id);
      });
      render(context);
    });
  }

  global.PlanProductivity = {
    ...legacyApi,
    setFleetOptions,
    setDumpTruckOptions,
    initPlanProductivityModule: initModule,
    initAllPlanProductivityModules: async () => {
      await initModule();
      await initModule({ containerId: 'coalProductivityTables', addButtonId: 'btnAddCoalProductivityTable' });
    },
    calculateHeterogeneousScenario: computeScenario,
    calculateHaulerProductivity: haulerProductivity
  };
}(window));
