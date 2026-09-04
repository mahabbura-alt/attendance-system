(function (global) {
  let fleetOptions = [];
  let dumpTruckOptions = [];
  const planSaveTimers = new Map();

  function getPlanStorageType(container) {
    return container?.dataset.planProductivityContainer === 'coal' ? 'coal' : 'ob';
  }

  function serializePlanContainer(container) {
    const snapshot = container.cloneNode(true);
    snapshot.querySelectorAll('input, textarea, select').forEach((field) => {
      if (field.tagName === 'SELECT') {
        Array.from(field.options).forEach((option) => {
          if (option.selected) option.setAttribute('selected', 'selected');
          else option.removeAttribute('selected');
        });
      } else if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.checked) field.setAttribute('checked', 'checked');
        else field.removeAttribute('checked');
      } else {
        field.setAttribute('value', field.value);
      }
    });
    return snapshot.innerHTML;
  }

  function schedulePlanSave(container) {
    if (!container || !container.dataset.initialized) return;
    const planningType = getPlanStorageType(container);
    clearTimeout(planSaveTimers.get(planningType));
    planSaveTimers.set(planningType, setTimeout(async () => {
      try {
        const authHeaders = typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
        const apiPath = `/api/admin/production/productivity-plans/${planningType}`;
        const apiUrl = typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(apiPath) : apiPath;
        const response = await fetch(apiUrl, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ contentHtml: serializePlanContainer(container) }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (error) { console.warn('Gagal menyimpan Productivity Planning:', error); }
    }, 500));
  }

  async function loadSavedPlan(container) {
    const planningType = getPlanStorageType(container);
    try {
      const authHeaders = typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
      const apiPath = `/api/admin/production/productivity-plans/${planningType}`;
      const apiUrl = typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(apiPath) : apiPath;
      const response = await fetch(apiUrl, { headers: authHeaders });
      if (!response.ok) return;
      const savedPlan = await response.json();
      if (savedPlan.contentHtml) {
        container.innerHTML = savedPlan.contentHtml;
        ensureParameterPanel(container);
        const parameterMerged = mergeLegacyFactorTables(container);
        syncParameterToggle(container);
        const legacyIdentifierRemoved = removeLegacyFleetIdentifier(container);
        updateFleetSummary(container);
        if (legacyIdentifierRemoved || parameterMerged) schedulePlanSave(container);
      }
    } catch (error) { console.warn('Gagal memuat Productivity Planning tersimpan:', error); }
  }
  function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  }

  function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function buildFactorTableData(type, rows = []) {
    const normalized = Array.isArray(rows) && rows.length ? rows : [
      { material: 'PASIR', value: type === 'swell' ? 1.2 : 0.8 },
      { material: 'CLAY', value: type === 'swell' ? 1.3 : 0.9 },
      { material: 'SOIL', value: type === 'swell' ? 1.2 : 0.9 },
    ];

    return normalized.map((row, index) => ({
      id: `${type}-${index + 1}`,
      material: row.material || `Material ${index + 1}`,
      value: toNumber(row.value, type === 'swell' ? 1 : 0),
    }));
  }

  function buildFactorTableHtml(type, rows = [], labelOverride = '') {
    const label = labelOverride || (type === 'swell' ? 'Tabel Swell Factor' : 'Tabel Fill Factor');
    const factorRows = buildFactorTableData(type, rows);

    return `
      <div class="plan-productivity-factor-table" data-plan-factor-type="${type}" style="border:1px solid #dbe7f5;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,0.04);padding:14px;min-width:0;width:100%;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <div>
            <div style="font-size:12px;font-weight:700;color:#0f172a;letter-spacing:0.08em;text-transform:uppercase;">Parameter</div>
            <div style="font-size:16px;font-weight:800;color:#0f172a;">${label}</div>
          </div>
          <button type="button" class="tombol tombol--ghost" data-plan-factor-add-row="${type}" style="font-size:11px;padding:6px 10px;">+ Tambah Baris</button>
        </div>

        <div style="overflow:auto;">
          <table style="width:100%;border-collapse:collapse;min-width:260px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:8px 10px;text-align:left;font-size:12px;color:#475569;border:1px solid #e2e8f0;">Material</th>
                <th style="padding:8px 10px;text-align:left;font-size:12px;color:#475569;border:1px solid #e2e8f0;">Value</th>
                <th style="padding:8px 10px;text-align:center;font-size:12px;color:#475569;border:1px solid #e2e8f0;">Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${factorRows.map((row, index) => `
                <tr>
                  <td style="padding:8px 10px;border:1px solid #e2e8f0;">
                    <input data-plan-factor-field="material" data-plan-factor-type="${type}" data-plan-factor-id="${row.id}" value="${escapeHtml(row.material)}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
                  </td>
                  <td style="padding:8px 10px;border:1px solid #e2e8f0;">
                    <input type="number" step="0.01" data-plan-factor-field="value" data-plan-factor-type="${type}" data-plan-factor-id="${row.id}" value="${row.value}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
                  </td>
                  <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;">
                    <button type="button" class="tombol tombol--ghost" data-plan-factor-delete-row="${row.id}" data-plan-factor-type="${type}" style="font-size:11px;padding:5px 8px;">Hapus</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Tabel Parameter gabungan untuk OB: MATERIAL | SWELL FACTOR | FILL FACTOR.
  // Tetap memakai atribut data-plan-factor-* agar sinkronisasi (serialize)
  // dan event add/delete tetap berfungsi tanpa perubahan skema.
  function buildMergedParameterTable(rows = []) {
    const mergedRows = (Array.isArray(rows) && rows.length ? rows : [
      { material: 'PASIR', swell: 1.2, fill: 0.8 },
      { material: 'CLAY', swell: 1.3, fill: 0.9 },
      { material: 'SOIL', swell: 1.2, fill: '' },
      { material: 'BLASTING', swell: '', fill: 0.9 },
    ]).map((row, index) => ({
      id: `merged-${index + 1}`,
      material: row.material || `Material ${index + 1}`,
      swell: row.swell ?? '',
      fill: row.fill ?? '',
    }));

    return `
      <div class="plan-productivity-factor-table" data-plan-factor-type="merged" style="border:1px solid #dbe7f5;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,0.04);padding:14px;min-width:0;width:100%;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <div>
            <div style="font-size:12px;font-weight:700;color:#0f172a;letter-spacing:0.08em;text-transform:uppercase;">Parameter</div>
            <div style="font-size:16px;font-weight:800;color:#0f172a;">Swell &amp; Fill Factor</div>
          </div>
          <button type="button" class="tombol tombol--ghost" data-plan-factor-add-row="merged" style="font-size:11px;padding:6px 10px;">+ Tambah Baris</button>
        </div>
        <div style="overflow:auto;">
          <table style="width:100%;border-collapse:collapse;min-width:420px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:8px 10px;text-align:left;font-size:12px;color:#475569;border:1px solid #e2e8f0;">Material</th>
                <th style="padding:8px 10px;text-align:left;font-size:12px;color:#475569;border:1px solid #e2e8f0;">Swell Factor</th>
                <th style="padding:8px 10px;text-align:left;font-size:12px;color:#475569;border:1px solid #e2e8f0;">Fill Factor</th>
                <th style="padding:8px 10px;text-align:center;font-size:12px;color:#475569;border:1px solid #e2e8f0;">Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${mergedRows.map((row) => `
                <tr>
                  <td style="padding:8px 10px;border:1px solid #e2e8f0;">
                    <input data-plan-factor-field="material" data-plan-factor-type="merged" data-plan-factor-id="${row.id}" value="${escapeHtml(row.material)}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
                  </td>
                  <td style="padding:8px 10px;border:1px solid #e2e8f0;">
                    <input type="number" step="0.01" data-plan-factor-field="swell" data-plan-factor-type="merged" data-plan-factor-id="${row.id}" value="${row.swell}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
                  </td>
                  <td style="padding:8px 10px;border:1px solid #e2e8f0;">
                    <input type="number" step="0.01" data-plan-factor-field="fill" data-plan-factor-type="merged" data-plan-factor-id="${row.id}" value="${row.fill}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
                  </td>
                  <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;">
                    <button type="button" class="tombol tombol--ghost" data-plan-factor-delete-row="${row.id}" data-plan-factor-type="merged" style="font-size:11px;padding:5px 8px;">Hapus</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Migrasi in-memory: gabungkan tabel Swell & Fill lama (OB) menjadi satu
  // tabel 3 kolom, tanpa menyentuh basis data.
  function mergeLegacyFactorTables(container) {
    if (container.dataset.planProductivityContainer === 'coal') return false;
    const swellTable = container.querySelector('[data-plan-factor-type="swell"]');
    const fillTable = container.querySelector('[data-plan-factor-type="fill"]');
    if (!swellTable || !fillTable) return false;
    const read = (table) => Array.from(table.querySelectorAll('tbody tr')).map((tr) => ({
      material: tr.querySelector('[data-plan-factor-field="material"]')?.value.trim() || '',
      value: tr.querySelector('[data-plan-factor-field="value"]')?.value.trim() || '',
    }));
    const map = new Map();
    read(swellTable).forEach((r) => { if (r.material) map.set(r.material, { material: r.material, swell: r.value, fill: '' }); });
    read(fillTable).forEach((r) => {
      if (!r.material) return;
      const e = map.get(r.material) || { material: r.material, swell: '', fill: '' };
      e.fill = r.value;
      map.set(r.material, e);
    });
    fillTable.remove();
    swellTable.outerHTML = buildMergedParameterTable([...map.values()]);
    return true;
  }

  function computeLoaderCap(values) {
    const bucketCapacity = toNumber(values.bucketCapacity);
    const bucketFillFactor = toNumber(values.bucketFillFactor);
    const swellFactor = toNumber(values.swellFactor);
    return swellFactor === 0 ? 0 : (bucketCapacity * bucketFillFactor) / swellFactor;
  }

  function computeNumPass(values) {
    const dumpTruckCapacity = toNumber(values.dumpTruckCapacity);
    const loaderCap = toNumber(values.loaderCap);
    if (loaderCap === 0) return 0;
    return Math.max(1, Math.round(dumpTruckCapacity / loaderCap));
  }

  function computeLoadingTime(values) {
    return (values.numPass * values.cycleTimeLoading) / 60;
  }

  function computeCycleTimeTruck(values) {
    const loadedSpeed = toNumber(values.loadedSpeed);
    const emptySpeed = toNumber(values.emptySpeed);
    const distance = toNumber(values.distance);
    const spotDumpTime = toNumber(values.spotDumpTime);
    const loadingTime = toNumber(values.loadingTime);
    const firstLeg = loadedSpeed === 0 ? 0 : (distance / loadedSpeed) * 60;
    const secondLeg = emptySpeed === 0 ? 0 : (distance / emptySpeed) * 60;
    return firstLeg + secondLeg + spotDumpTime + loadingTime;
  }

  function computeLoaderProductivity(values) {
    const loaderCap = toNumber(values.loaderCap);
    const cycleTimeLoading = toNumber(values.cycleTimeLoading);
    const workEff = toNumber(values.workEffLoader);
    const density = values.density === undefined || values.density === null || values.density === '' ? 1 : toNumber(values.density, 1);
    if (cycleTimeLoading === 0) return 0;
    return (3600 / cycleTimeLoading) * loaderCap * workEff * density;
  }

  function computeTruckProductivity(values) {
    const cycleTimeTruck = toNumber(values.cycleTimeTruck);
    const dumpTruckCapacity = toNumber(values.dumpTruckCapacity);
    const workEff = toNumber(values.workEffFleet);
    const density = values.density === undefined || values.density === null || values.density === '' ? 1 : toNumber(values.density, 1);
    if (cycleTimeTruck === 0) return 0;
    return (60 / cycleTimeTruck) * dumpTruckCapacity * workEff * density;
  }

  function computeFleetMatch(values) {
    const loaderProd = toNumber(values.loaderProductivity);
    const truckProd = toNumber(values.truckProductivity);
    const numberOfTruck = toNumber(values.numberOfTruck);
    if (loaderProd === 0) return 0;
    return (truckProd * numberOfTruck) / loaderProd;
  }

  function computeFleetProductivity(values) {
    const loaderProd = toNumber(values.loaderProductivity);
    const truckProd = toNumber(values.truckProductivity);
    const numberOfTruck = toNumber(values.numberOfTruck);
    return Math.min(loaderProd, truckProd * numberOfTruck);
  }

  function calculateProductivityValues(rawValues = {}) {
    const values = {
      bucketCapacity: toNumber(rawValues.bucketCapacity, 0),
      bucketFillFactor: toNumber(rawValues.bucketFillFactor, 0),
      swellFactor: toNumber(rawValues.swellFactor, 0),
      dumpTruckCapacity: toNumber(rawValues.dumpTruckCapacity, 0),
      workEffLoader: toNumber(rawValues.workEffLoader, 0),
      cycleTimeLoading: toNumber(rawValues.cycleTimeLoading, 0),
      loadedSpeed: toNumber(rawValues.loadedSpeed, 0),
      emptySpeed: toNumber(rawValues.emptySpeed, 0),
      spotDumpTime: toNumber(rawValues.spotDumpTime, 0),
      distance: toNumber(rawValues.distance, 0),
      workEffFleet: toNumber(rawValues.workEffFleet, 0),
      numberOfTruck: toNumber(rawValues.numberOfTruck, 0),
      density: rawValues.density === undefined || rawValues.density === null || rawValues.density === '' ? 1 : toNumber(rawValues.density, 1),
    };

    const loaderCap = computeLoaderCap(values);
    const numPass = computeNumPass({ ...values, loaderCap });
    const loadingTime = computeLoadingTime({ ...values, numPass });
    const cycleTimeTruck = computeCycleTimeTruck({ ...values, loadingTime });
    const loaderProductivity = computeLoaderProductivity({ ...values, loaderCap });
    const truckProductivity = computeTruckProductivity({ ...values, cycleTimeTruck });
    const fleetMatch = computeFleetMatch({ ...values, loaderProductivity, truckProductivity });
    const fleetProductivity = computeFleetProductivity({ ...values, loaderProductivity, truckProductivity });

    return {
      loaderCap,
      numPass,
      loadingTime,
      cycleTimeTruck,
      loaderProductivity,
      truckProductivity,
      fleetMatch,
      fleetProductivity,
    };
  }

  function tableTemplate(id, initial = {}, materialDensityOptions = []) {
    const isCoalPlanning = id.startsWith('coal-productivity');
    const coalMaterials = materialDensityOptions.length ? materialDensityOptions : [
      { material: 'PASIR', value: 1.2 },
      { material: 'CLAY', value: 1.3 },
      { material: 'SOIL', value: 1.2 },
    ];
    const values = {
      fleetName: initial.fleetName || '',
      dumpTruck: initial.dumpTruck || '',
      material: initial.material || 'CLAY',
      bucketCapacity: initial.bucketCapacity ?? 3.2,
      bucketFillFactor: initial.bucketFillFactor ?? 0.9,
      swellFactor: initial.swellFactor ?? 1.3,
      dumpTruckCapacity: initial.dumpTruckCapacity ?? 12,
      workEffLoader: initial.workEffLoader ?? 0.7,
      cycleTimeLoading: initial.cycleTimeLoading ?? 23,
      loadedSpeed: initial.loadedSpeed ?? 15,
      emptySpeed: initial.emptySpeed ?? 30,
      spotDumpTime: initial.spotDumpTime ?? 2,
      distance: initial.distance ?? 1.2,
      workEffFleet: initial.workEffFleet ?? 0.765,
      numberOfTruck: initial.numberOfTruck ?? 5,
      density: initial.density ?? 1,
    };

    if (isCoalPlanning && !coalMaterials.some((row) => row.material === values.material)) {
      values.material = coalMaterials[0]?.material || '';
    }
    const selectedMaterialDensity = coalMaterials.find((row) => row.material === values.material);
    if (isCoalPlanning && selectedMaterialDensity) {
      values.density = selectedMaterialDensity.value;
    }
    const materialOptionsHtml = isCoalPlanning
      ? coalMaterials.map((row) => `<option value="${escapeHtml(row.material)}" data-density="${row.value}" ${values.material === row.material ? 'selected' : ''}>${escapeHtml(row.material)}</option>`).join('')
      : `
          <option value="PASIR" ${values.material === 'PASIR' ? 'selected' : ''}>PASIR</option>
          <option value="CLAY" ${values.material === 'CLAY' ? 'selected' : ''}>CLAY</option>
          <option value="SOIL" ${values.material === 'SOIL' ? 'selected' : ''}>SOIL</option>
          <option value="BLASTING" ${values.material === 'BLASTING' ? 'selected' : ''}>BLASTING</option>`;

    const selectedFleet = fleetOptions.find((option) => option.value === values.fleetName);
    if (selectedFleet) {
      values.bucketCapacity = selectedFleet.capacity === null ? '' : selectedFleet.capacity.toFixed(1);
    }
    const selectedDumpTruck = dumpTruckOptions.find((option) => option.value === values.dumpTruck);
    if (selectedDumpTruck) {
      values.dumpTruckCapacity = selectedDumpTruck.capacity === null ? '' : selectedDumpTruck.capacity.toFixed(1);
    }

    const computed = calculateProductivityValues(values);
    const safeValue = (val, digits) => Number.isFinite(val) ? round(val, digits) : 0;

    return `
      <div class="plan-productivity-table" data-plan-table-id="${id}" style="border:1px solid #dbe7f5;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,0.04);padding:14px;min-width:0;width:100%;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <div>
            <div style="font-size:12px;font-weight:700;color:#0f172a;letter-spacing:0.08em;text-transform:uppercase;">Fleet Planning</div>
            <div style="font-size:16px;font-weight:800;color:#0f172a;">${escapeHtml(values.fleetName || 'Pilih Excavator')}</div>
          </div>
          <button type="button" class="tombol tombol--ghost" style="font-size:11px;padding:6px 10px;" data-delete-plan-table="${id}">Hapus Tabel</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(2, minmax(170px, 1fr));gap:10px;">
          <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
            <div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:10px;">Fleet Setup</div>
            <div class="field-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center;">
              <label style="font-size:12px;color:#475569;">Fleet (Excavator)</label>
              <select data-plan-productivity-field="fleetName" data-plan-table-id="${id}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
                <option value="">Pilih Kode Unit Excavator</option>
                ${fleetOptions.map((option) => `<option value="${escapeHtml(option.value)}" data-bucket-capacity="${option.capacity ?? ''}" ${values.fleetName === option.value ? 'selected' : ''}>${escapeHtml(option.value)}</option>`).join('')}
              </select>

              <label style="font-size:12px;color:#475569;">Dump Truck</label>
              <select data-plan-productivity-field="dumpTruck" data-plan-table-id="${id}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
                <option value="">Pilih Kode Unit Dump Truck</option>
                ${dumpTruckOptions.map((option) => `<option value="${escapeHtml(option.value)}" data-truck-capacity="${option.capacity ?? ''}" ${values.dumpTruck === option.value ? 'selected' : ''}>${escapeHtml(option.value)}</option>`).join('')}
              </select>

              <label style="font-size:12px;color:#475569;">Material</label>
              <select data-plan-productivity-field="material" data-plan-table-id="${id}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
                ${materialOptionsHtml}
              </select>

              ${isCoalPlanning ? `
              <label style="font-size:12px;color:#475569;">Density — Otomatis</label>
              <input type="number" step="0.01" readonly aria-readonly="true" data-plan-productivity-field="density" data-plan-table-id="${id}" value="${values.density}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#e2e8f0;color:#475569;cursor:not-allowed;" />` : ''}

              <label style="font-size:12px;color:#475569;">Bucket Cap (m3) — Otomatis</label>
              <input type="number" step="0.1" readonly aria-readonly="true" data-plan-productivity-field="bucketCapacity" data-plan-table-id="${id}" value="${values.bucketCapacity}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#e2e8f0;color:#475569;cursor:not-allowed;" />

              <label style="font-size:12px;color:#475569;">Bucket Fill Factor</label>
              <input type="number" step="0.1" data-plan-productivity-field="bucketFillFactor" data-plan-table-id="${id}" value="${values.bucketFillFactor}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />

              <label style="font-size:12px;color:#475569;">Swell Factor</label>
              <input type="number" step="0.1" data-plan-productivity-field="swellFactor" data-plan-table-id="${id}" value="${values.swellFactor}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />

              <label style="font-size:12px;color:#475569;">Truck Capacity (BCM) — Otomatis</label>
              <input type="number" step="0.1" readonly aria-readonly="true" data-plan-productivity-field="dumpTruckCapacity" data-plan-table-id="${id}" value="${values.dumpTruckCapacity}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#e2e8f0;color:#475569;cursor:not-allowed;" />

              <label style="font-size:12px;color:#475569;">Number of Truck</label>
              <input type="number" step="1" data-plan-productivity-field="numberOfTruck" data-plan-table-id="${id}" value="${values.numberOfTruck}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
            </div>
          </div>

          <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
            <div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:10px;">Productivity Formula</div>
            <div class="field-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center;">
              <label style="font-size:12px;color:#475569;">Cycle Time Load (Sec)</label>
              <input type="number" step="0.1" data-plan-productivity-field="cycleTimeLoading" data-plan-table-id="${id}" value="${values.cycleTimeLoading}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />

              <label style="font-size:12px;color:#475569;">Work Eff. Loader</label>
              <input type="number" step="0.01" data-plan-productivity-field="workEffLoader" data-plan-table-id="${id}" value="${values.workEffLoader}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />

              <label style="font-size:12px;color:#475569;">Loaded Speed (km/h)</label>
              <input type="number" step="0.1" data-plan-productivity-field="loadedSpeed" data-plan-table-id="${id}" value="${values.loadedSpeed}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />

              <label style="font-size:12px;color:#475569;">Empty Speed (km/h)</label>
              <input type="number" step="0.1" data-plan-productivity-field="emptySpeed" data-plan-table-id="${id}" value="${values.emptySpeed}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />

              <label style="font-size:12px;color:#475569;">Spott & Dump Time</label>
              <input type="number" step="0.1" data-plan-productivity-field="spotDumpTime" data-plan-table-id="${id}" value="${values.spotDumpTime}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />

              <label style="font-size:12px;color:#475569;">Distance (km)</label>
              <input type="number" step="0.1" data-plan-productivity-field="distance" data-plan-table-id="${id}" value="${values.distance}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />

              <label style="font-size:12px;color:#475569;">Work Eff. Fleet</label>
              <input type="number" step="0.01" data-plan-productivity-field="workEffFleet" data-plan-table-id="${id}" value="${values.workEffFleet}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
            </div>
          </div>
        </div>

        <div style="margin-top:14px;padding:12px;border:1px solid #dbeafe;border-radius:10px;background:linear-gradient(180deg,#eff6ff,#f8fbff);overflow:hidden;box-sizing:border-box;">
          <div style="font-size:12px;font-weight:800;color:#1e3a8a;margin-bottom:8px;">Result & Formula Output</div>
          <div style="display:grid;grid-template-columns:repeat(4, minmax(100px, 1fr));gap:8px;max-width:100%;box-sizing:border-box;">
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:6px 7px;min-width:0;overflow:hidden;">
              <div style="font-size:11px;color:#64748b;">Loader Cap</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;">${safeValue(computed.loaderCap, 2)}</div>
            </div>
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:6px 7px;min-width:0;overflow:hidden;">
              <div style="font-size:11px;color:#64748b;">Num of Pass</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;">${safeValue(computed.numPass, 0)}</div>
            </div>
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:6px 7px;min-width:0;overflow:hidden;">
              <div style="font-size:11px;color:#64748b;">Loading Time</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;">${safeValue(computed.loadingTime, 2)} min</div>
            </div>
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:6px 7px;min-width:0;overflow:hidden;">
              <div style="font-size:11px;color:#64748b;">Truck Cycle Time</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;">${safeValue(computed.cycleTimeTruck, 2)} min</div>
            </div>
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:6px 7px;min-width:0;overflow:hidden;">
              <div style="font-size:11px;color:#64748b;">Loader Prod.</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;">${safeValue(computed.loaderProductivity, 2)} ${isCoalPlanning ? 'Ton/Hr' : 'bcm/hr'}</div>
            </div>
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:6px 7px;min-width:0;overflow:hidden;">
              <div style="font-size:11px;color:#64748b;">Truck Prod.</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;">${safeValue(computed.truckProductivity, 2)} ${isCoalPlanning ? 'Ton/Hr' : 'bcm/hr'}</div>
            </div>
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:6px 7px;min-width:0;overflow:hidden;">
              <div style="font-size:11px;color:#64748b;">Fleet Match</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;">${safeValue(computed.fleetMatch, 2)}</div>
            </div>
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:6px 7px;min-width:0;overflow:hidden;">
              <div style="font-size:11px;color:#64748b;">Fleet Prod.</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;">${safeValue(computed.fleetProductivity, 2)} ${isCoalPlanning ? 'Ton/Hr' : 'bcm/hr'}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '\"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function getTableState(container, tableId) {
    const fields = container.querySelectorAll(`[data-plan-table-id="${tableId}"][data-plan-productivity-field]`);
    const state = {};
    fields.forEach((field) => {
      const key = field.dataset.planProductivityField;
      state[key] = field.value;
    });
    return state;
  }

  function removeLegacyFleetIdentifier(container) {
    let changed = false;
    const legacyFieldName = ['fleet', 'Group'].join('');
    [...container.querySelectorAll('.plan-productivity-table')].forEach((table) => {
      if (!table.querySelector(`[data-plan-productivity-field="${legacyFieldName}"]`)) return;
      const tableId = table.dataset.planTableId;
      if (!tableId) return;
      const state = getTableState(container, tableId);
      delete state[legacyFieldName];
      table.outerHTML = tableTemplate(tableId, state, getMaterialDensityOptions(container));
      changed = true;
    });
    return changed;
  }

  function getMaterialDensityOptions(container) {
    if (container?.dataset.planProductivityContainer !== 'coal') return [];
    return Array.from(container.querySelectorAll('[data-plan-factor-type="swell"] tbody tr')).map((row) => ({
      material: row.querySelector('[data-plan-factor-field="material"]')?.value.trim() || '',
      value: toNumber(row.querySelector('[data-plan-factor-field="value"]')?.value, 1),
    })).filter((row) => row.material);
  }

  function refreshTable(container, tableId) {
    const table = container.querySelector(`[data-plan-table-id="${tableId}"]`);
    if (!table) return;

    const state = getTableState(container, tableId);
    const nextHtml = tableTemplate(tableId, state, getMaterialDensityOptions(container));
    table.outerHTML = nextHtml;
  }

  function normalizeEquipmentOptions(options = []) {
    const uniqueOptions = new Map();
    options.forEach((option) => {
      const value = String(typeof option === 'object' ? option.value : option || '').trim();
      if (!value) return;
      const capacity = typeof option === 'object' && option.capacity !== undefined && option.capacity !== null && option.capacity !== ''
        ? Number(option.capacity) : null;
      uniqueOptions.set(value, { value, capacity: Number.isFinite(capacity) ? Number(capacity.toFixed(1)) : null });
    });
    return Array.from(uniqueOptions.values()).sort((a, b) => a.value.localeCompare(b.value));
  }

  function refreshLinkedEquipmentCapacities() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-plan-productivity-container]').forEach((container) => {
      if (container.dataset.initialized !== 'true') return;
      container.querySelectorAll('.plan-productivity-table').forEach((table) => {
        const tableId = table.dataset.planTableId;
        if (!tableId) return;
        const state = getTableState(container, tableId);
        const selectedFleet = fleetOptions.find((option) => option.value === state.fleetName);
        if (selectedFleet) {
          state.bucketCapacity = selectedFleet.capacity === null ? '' : selectedFleet.capacity.toFixed(1);
        }
        const selectedDumpTruck = dumpTruckOptions.find((option) => option.value === state.dumpTruck);
        if (selectedDumpTruck) {
          state.dumpTruckCapacity = selectedDumpTruck.capacity === null ? '' : selectedDumpTruck.capacity.toFixed(1);
        }
        table.outerHTML = tableTemplate(tableId, state, getMaterialDensityOptions(container));
      });
    });
  }

  function setFleetOptions(options = []) {
    fleetOptions = normalizeEquipmentOptions(options);
    refreshLinkedEquipmentCapacities();
  }

  function setDumpTruckOptions(options = []) {
    dumpTruckOptions = normalizeEquipmentOptions(options);
    refreshLinkedEquipmentCapacities();
  }

  function updateFleetSummary(container) {
    const grid = container.querySelector('.plan-productivity-table-grid');
    const total = grid ? grid.querySelectorAll('.plan-productivity-table').length : 0;
    const summary = container.querySelector('[data-plan-fleet-summary]');
    if (summary) {
      const totalNode = summary.querySelector('[data-plan-fleet-total]');
      if (totalNode) totalNode.textContent = String(total);
    }
  }

  function attachTableEvents(container) {
    container.addEventListener('input', (event) => {
      const field = event.target;
      schedulePlanSave(container);
    });

    container.addEventListener('change', (event) => {
      const field = event.target;
      schedulePlanSave(container);
      if (field.dataset.planFactorField && container.dataset.planProductivityContainer === 'coal') {
        container.querySelectorAll('.plan-productivity-table').forEach((table) => {
          const tableId = table.dataset.planTableId;
          if (tableId) refreshTable(container, tableId);
        });
        return;
      }
      if (!field.dataset.planProductivityField) return;
      const { planTableId } = field.dataset;
      if (planTableId) {
        if (field.dataset.planProductivityField === 'fleetName') {
          const selectedOption = field.options[field.selectedIndex];
          const capacity = Number(selectedOption?.dataset.bucketCapacity);
          const bucketInput = container.querySelector(`[data-plan-table-id="${planTableId}"][data-plan-productivity-field="bucketCapacity"]`);
          if (bucketInput) bucketInput.value = Number.isFinite(capacity) && capacity > 0 ? capacity.toFixed(1) : '';
        }
        if (field.dataset.planProductivityField === 'dumpTruck') {
          const selectedOption = field.options[field.selectedIndex];
          const capacity = Number(selectedOption?.dataset.truckCapacity);
          const truckCapacityInput = container.querySelector(`[data-plan-table-id="${planTableId}"][data-plan-productivity-field="dumpTruckCapacity"]`);
          if (truckCapacityInput) truckCapacityInput.value = Number.isFinite(capacity) && capacity > 0 ? capacity.toFixed(1) : '';
        }
        if (field.dataset.planProductivityField === 'material' && planTableId.startsWith('coal-productivity')) {
          const selectedOption = field.options[field.selectedIndex];
          const density = Number(selectedOption?.dataset.density);
          const densityInput = container.querySelector(`[data-plan-table-id="${planTableId}"][data-plan-productivity-field="density"]`);
          if (densityInput) densityInput.value = Number.isFinite(density) && density > 0 ? density.toFixed(2) : '';
        }
        refreshTable(container, planTableId);
      }
    });

    container.addEventListener('click', (event) => {
      const deleteBtn = event.target.closest('[data-delete-plan-table]');
      if (deleteBtn) {
        const tableId = deleteBtn.dataset.deletePlanTable;
        const table = container.querySelector(`[data-plan-table-id="${tableId}"]`);
        if (table) table.remove();
        updateFleetSummary(container);
        schedulePlanSave(container);
        return;
      }

      const factorAddButton = event.target.closest('[data-plan-factor-add-row]');
      if (factorAddButton) {
        const type = factorAddButton.dataset.planFactorAddRow;
        const target = container.querySelector(`[data-plan-factor-type="${type}"]`);
        if (!target) return;
        const tableBody = target.querySelector('tbody');
        if (type === 'merged') {
          const nextId = `merged-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          const label = `Material ${tableBody.querySelectorAll('tr').length + 1}`;
          tableBody.insertAdjacentHTML('beforeend', `
            <tr>
              <td style="padding:8px 10px;border:1px solid #e2e8f0;">
                <input data-plan-factor-field="material" data-plan-factor-type="merged" data-plan-factor-id="${nextId}" value="${escapeHtml(label)}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
              </td>
              <td style="padding:8px 10px;border:1px solid #e2e8f0;">
                <input type="number" step="0.01" data-plan-factor-field="swell" data-plan-factor-type="merged" data-plan-factor-id="${nextId}" value="" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
              </td>
              <td style="padding:8px 10px;border:1px solid #e2e8f0;">
                <input type="number" step="0.01" data-plan-factor-field="fill" data-plan-factor-type="merged" data-plan-factor-id="${nextId}" value="" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
              </td>
              <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;">
                <button type="button" class="tombol tombol--ghost" data-plan-factor-delete-row="${nextId}" data-plan-factor-type="merged" style="font-size:11px;padding:5px 8px;">Hapus</button>
              </td>
            </tr>
          `);
          schedulePlanSave(container);
          return;
        }
        const nextId = `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const newRow = {
          id: nextId,
          material: `Material ${tableBody.querySelectorAll('tr').length + 1}`,
          value: type === 'swell' ? 1 : 0,
        };
        tableBody.insertAdjacentHTML('beforeend', `
          <tr>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;">
              <input data-plan-factor-field="material" data-plan-factor-type="${type}" data-plan-factor-id="${newRow.id}" value="${escapeHtml(newRow.material)}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
            </td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;">
              <input type="number" step="0.01" data-plan-factor-field="value" data-plan-factor-type="${type}" data-plan-factor-id="${newRow.id}" value="${newRow.value}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />
            </td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:center;">
              <button type="button" class="tombol tombol--ghost" data-plan-factor-delete-row="${newRow.id}" data-plan-factor-type="${type}" style="font-size:11px;padding:5px 8px;">Hapus</button>
            </td>
          </tr>
        `);
        if (container.dataset.planProductivityContainer === 'coal') {
          container.querySelectorAll('.plan-productivity-table').forEach((table) => refreshTable(container, table.dataset.planTableId));
        }
        schedulePlanSave(container);
        return;
      }

      const factorDeleteButton = event.target.closest('[data-plan-factor-delete-row]');
      if (factorDeleteButton) {
        const rowId = factorDeleteButton.dataset.planFactorDeleteRow;
        const row = container.querySelector(`[data-plan-factor-id="${rowId}"]`)?.closest('tr');
        if (row) row.remove();
        if (container.dataset.planProductivityContainer === 'coal') {
          container.querySelectorAll('.plan-productivity-table').forEach((table) => refreshTable(container, table.dataset.planTableId));
        }
        schedulePlanSave(container);
      }
    });
  }

  function syncParameterToggle(container) {
    const panel = container.querySelector('[data-plan-parameter-panel]');
    const btn = container.querySelector('[data-plan-parameter-toggle]');
    if (!btn) return;
    const caret = btn.querySelector('[data-plan-parameter-caret]');
    const expanded = panel && !panel.hidden;
    if (caret) caret.textContent = expanded ? '▾' : '▸';
    btn.setAttribute('aria-expanded', String(Boolean(expanded)));
  }

  function attachParameterToggle(container) {
    if (container.dataset.parameterToggleAttached === 'true') return;
    container.dataset.parameterToggleAttached = 'true';
    container.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-plan-parameter-toggle]');
      if (!btn) return;
      const panel = container.querySelector('[data-plan-parameter-panel]');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      syncParameterToggle(container);
    });
  }

  // Migrasi rencana tersimpan lama (tanpa tombol Parameter) agar tabel
  // faktor (Swell/Fill/Material Density) terbungkus panel + tombol.
  function ensureParameterPanel(container) {
    if (container.querySelector('[data-plan-parameter-panel]')) return;
    const factorTables = [...container.querySelectorAll('.plan-productivity-factor-table')];
    if (!factorTables.length) return;
    const parent = factorTables[0].parentNode;
    const panel = document.createElement('div');
    panel.className = 'plan-parameter-panel';
    panel.setAttribute('data-plan-parameter-panel', '');
    panel.hidden = true;
    factorTables.forEach(t => panel.appendChild(t));
    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;align-items:center;';
    btnWrap.innerHTML = '<button type="button" class="plan-parameter-toggle" data-plan-parameter-toggle aria-expanded="false">⚙️ Parameter <span data-plan-parameter-caret>▸</span></button>';
    parent.replaceWith(btnWrap, panel);
  }

  function initPlanProductivityModule(config = {}) {
    const containerId = config.containerId || 'planProductivityTables';
    const addButtonId = config.addButtonId || 'btnAddPlanProductivityTable';
    const idPrefix = config.idPrefix || 'plan-productivity';
    const includeFillFactor = config.includeFillFactor !== false;
    const container = document.getElementById(containerId);
    if (!container) return;
    if (container.dataset.initialized === 'true') return;
    container.dataset.initialized = 'true';

    const swellFactorHtml = buildFactorTableHtml('swell', [
      { material: 'PASIR', value: 1.2 },
      { material: 'CLAY', value: 1.3 },
      { material: 'SOIL', value: 1.2 },
    ], config.swellFactorLabel);
    const fillFactorHtml = buildFactorTableHtml('fill', [
      { material: 'PASIR', value: 0.8 },
      { material: 'CLAY', value: 0.9 },
      { material: 'BLASTING', value: 0.9 },
    ]);
    const parameterContent = includeFillFactor
      ? buildMergedParameterTable([
          { material: 'PASIR', swell: 1.2, fill: 0.8 },
          { material: 'CLAY', swell: 1.3, fill: 0.9 },
          { material: 'SOIL', swell: 1.2, fill: '' },
          { material: 'BLASTING', swell: '', fill: 0.9 },
        ])
      : swellFactorHtml;

    const defaultTableId = `${idPrefix}-${Date.now()}`;
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div data-plan-fleet-summary style="display:flex;justify-content:flex-end;align-items:center;gap:8px;background:#f8fafc;border:1px solid #dbeafe;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;color:#0f172a;">
          <span>Total Fleet</span>
          <span data-plan-fleet-total style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;padding:4px 8px;border-radius:999px;background:#dbeafe;color:#0f172a;font-size:12px;">1</span>
        </div>
        <div style="display:flex;align-items:center;">
          <button type="button" class="plan-parameter-toggle" data-plan-parameter-toggle aria-expanded="false">⚙️ Parameter <span data-plan-parameter-caret>▸</span></button>
        </div>
        <div class="plan-parameter-panel" data-plan-parameter-panel hidden>
          ${parameterContent}
        </div>
        <div class="plan-productivity-table-grid" style="display:grid;grid-template-columns:repeat(3, minmax(260px, 1fr));gap:14px;align-items:start;">
          ${tableTemplate(defaultTableId)}
        </div>
      </div>
    `;
    updateFleetSummary(container);
    attachTableEvents(container);
    attachParameterToggle(container);
    syncParameterToggle(container);
    loadSavedPlan(container);

    const addButton = document.getElementById(addButtonId);
    if (addButton) {
      addButton.addEventListener('click', () => {
        const newId = `${idPrefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const grid = container.querySelector('.plan-productivity-table-grid');
        if (grid) {
          grid.insertAdjacentHTML('beforeend', tableTemplate(newId));
        } else {
          container.insertAdjacentHTML('beforeend', tableTemplate(newId));
        }
        updateFleetSummary(container);
        schedulePlanSave(container);
      });
    }
  }

  function initAllPlanProductivityModules() {
    initPlanProductivityModule();
    initPlanProductivityModule({
      containerId: 'coalProductivityTables',
      addButtonId: 'btnAddCoalProductivityTable',
      idPrefix: 'coal-productivity',
      includeFillFactor: false,
      swellFactorLabel: 'Tabel Material Density',
    });
  }

  const api = {
    toNumber,
    round,
    calculateProductivityValues,
    buildFactorTableData,
    buildFactorTableHtml,
    tableTemplate,
    setFleetOptions,
    setDumpTruckOptions,
    initPlanProductivityModule,
    initAllPlanProductivityModules,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof global !== 'undefined') {
    global.PlanProductivity = api;
  }
}(typeof window !== 'undefined' ? window : globalThis));
