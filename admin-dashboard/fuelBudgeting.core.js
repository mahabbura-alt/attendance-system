(function (global) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FIXED_WIDTHS = [120, 70, 145, 90];
  const SESSION_CACHE_KEY = 'omos:fuel-budgeting:calculation-cache:v1';
  const calculationCache = new Map();
  let cacheSaveTimer = null;
  let loadingPromise = null;
  let equipment = [];
  let assignments = {};
  let paValues = {};
  let spoTablesByJob = {};
  let jobs = [];
  let sourceSignature = '';
  let context = {
    startYear: new Date().getFullYear(),
    endYear: new Date().getFullYear(),
    activeYear: new Date().getFullYear(),
    weeklyModel: 'week-of-year',
    weekStartDay: 1
  };

  const api = path => typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(path) : path;
  const auth = () => typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const daysOf = (year, month) => Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1);
  const dateAt = (year, month, day) => new Date(year, month - 1, day);
  const unitKey = unit => String(unit.id ?? unit.kode_alat);
  const valueKey = (year, month, day) => `${year}:${month}:${day}`;
  const periodToken = column => `${column.type}:${Number(column.month) || 0}:${Number(column.week) || 0}:${Number(column.day) || 0}`;
  const isManualWeek = () => String(context.weeklyModel).startsWith('manual-');
  const weekStart = () => isManualWeek() ? Number(context.weekStartDay) : 1;

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function restoreCalculationCache() {
    calculationCache.clear();
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) || 'null');
      if (saved?.signature !== sourceSignature || !Array.isArray(saved.entries)) return;
      saved.entries.forEach(([key, value]) => calculationCache.set(key, value));
    } catch (error) {
      console.warn('Cache Fuel Budgeting tidak dapat dipulihkan:', error);
    }
  }

  function persistCalculationCache() {
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = setTimeout(() => {
      try {
        const entries = [...calculationCache.entries()].slice(-25000);
        sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ signature: sourceSignature, entries }));
      } catch (error) {
        console.warn('Cache Fuel Budgeting tidak dapat disimpan:', error);
      }
    }, 150);
  }

  function weekNumber(date, startDay) {
    const first = new Date(date.getFullYear(), 0, 1);
    const offset = (first.getDay() - startDay + 7) % 7;
    return Math.floor((Math.floor((date - first) / 86400000) + offset) / 7) + 1;
  }

  function weekGroups(year, month) {
    const groups = [];
    let current = [];
    daysOf(year, month).forEach(day => {
      const date = dateAt(year, month, day);
      if (current.length && date.getDay() === weekStart()) {
        groups.push(current);
        current = [];
      }
      current.push(day);
    });
    if (current.length) groups.push(current);
    return groups.map((days, index) => ({
      days,
      label: `Week ${context.weeklyModel.endsWith('year') || context.weeklyModel === 'week-of-year' ? weekNumber(dateAt(year, month, days[0]), weekStart()) : index + 1}`
    }));
  }

  function periodColumns(table) {
    const openMonth = Number(table?.dataset.openMonth || 0);
    const openWeek = Number(table?.dataset.openWeek || 0);
    const columns = [];
    for (let month = 1; month <= 12; month += 1) {
      if (month === openMonth) {
        weekGroups(context.activeYear, month).forEach((group, index) => {
          const week = index + 1;
          if (week === openWeek) {
            group.days.forEach(day => columns.push({
              type: 'day', month, week, day,
              label: `${day}-${MONTHS[month - 1]}<br><small>${dateAt(context.activeYear, month, day).toLocaleDateString('en-US', { weekday: 'short' })}</small>`
            }));
          }
          columns.push({ type: 'week', month, week, label: `${week === openWeek ? '▼' : '▶'} ${group.label}` });
        });
      }
      columns.push({ type: 'month', month, label: `${month === openMonth ? '▼' : '▶'} ${MONTHS[month - 1]}-${String(context.activeYear).slice(-2)}` });
    }
    columns.push({ type: 'year', label: `Tahun ${context.activeYear}` });
    return columns;
  }

  function columnDays(column) {
    if (column.type === 'day') return [{ month: column.month, day: column.day }];
    if (column.type === 'week') return (weekGroups(context.activeYear, column.month)[column.week - 1]?.days || []).map(day => ({ month: column.month, day }));
    if (column.type === 'month') return daysOf(context.activeYear, column.month).map(day => ({ month: column.month, day }));
    if (column.type === 'year') return MONTHS.flatMap((_, index) => daysOf(context.activeYear, index + 1).map(day => ({ month: index + 1, day })));
    return [];
  }

  function extractSpoContext(payload) {
    const parser = new DOMParser();
    const documentCopy = parser.parseFromString(`<div>${payload?.contentHtml || ''}</div>`, 'text/html');
    const planningTables = payload?.planningData?.tables || {};
    spoTablesByJob = {};
    [...documentCopy.querySelectorAll('.spo-table')]
      .filter(table => /^\s*deployed\s*$/i.test(table.querySelector('[data-spo-status]')?.textContent || ''))
      .forEach(table => {
        const job = table.querySelector('[data-spo-job]')?.getAttribute('value')?.trim();
        const id = table.dataset.spoTableId;
        if (job && id && !spoTablesByJob[job]) spoTablesByJob[job] = planningTables[id] || {};
      });
    jobs = Object.keys(spoTablesByJob).sort((first, second) => first.localeCompare(second));
    const tables = Object.values(planningTables);
    if (!tables.length) return;
    context.startYear = Math.min(...tables.map(table => Number(table.startYear) || new Date().getFullYear()));
    context.endYear = Math.max(...tables.map(table => Number(table.endYear) || context.startYear));
    context.activeYear = Math.min(Math.max(Number(context.activeYear) || Number(tables[0].activeYear) || context.startYear, context.startYear), context.endYear);
    context.weeklyModel = tables[0].weeklyModel || context.weeklyModel;
    context.weekStartDay = Number(tables[0].weekStartDay ?? context.weekStartDay);
  }

  function spoDailyLoss(job, year, month, day) {
    const cacheKey = `LOSS|${sourceSignature}|${job}|${year}|${month}|${day}`;
    if (calculationCache.has(cacheKey)) return calculationCache.get(cacheKey);
    const daily = spoTablesByJob[job]?.daily || {};
    const suffix = `:${year}:${month}:${day}`;
    const legacySuffix = `:${month}:${day}`;
    let total = 0;
    let hasCurrentYearKeys = false;
    Object.entries(daily).forEach(([key, raw]) => {
      if (key.startsWith('system:') || !key.endsWith(suffix)) return;
      hasCurrentYearKeys = true;
      total += Math.max(0, Number(raw) || 0);
    });
    if (!hasCurrentYearKeys) Object.entries(daily).forEach(([key, raw]) => {
      if (!key.startsWith('system:') && key.endsWith(legacySuffix) && key.split(':').length === 3) total += Math.max(0, Number(raw) || 0);
    });
    const result = Math.min(24, total);
    calculationCache.set(cacheKey, result);
    return result;
  }

  function fuelRate(unit) {
    const raw = unit?.fuel_rate_lph;
    if (raw === '' || raw === null || raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function ewhValue(job, unit, column) {
    const key = unitKey(unit);
    const cacheKey = `EWH|${sourceSignature}|${job}|${key}|${context.activeYear}|${periodToken(column)}`;
    if (calculationCache.has(cacheKey)) return calculationCache.get(cacheKey);
    const days = columnDays(column);
    const values = paValues?.[key] || {};
    const dailyPa = days.map(({ month, day }) => values[valueKey(context.activeYear, month, day)] ?? '');
    let result = null;
    if (days.length && dailyPa.every(value => value !== '' && Number.isFinite(Number(value)))) {
      const paPeriod = dailyPa.reduce((sum, value) => sum + Number(value), 0) / dailyPa.length;
      const availableAfterPa = days.length * 24 * (paPeriod / 100);
      const loss = days.reduce((sum, date) => sum + spoDailyLoss(job, context.activeYear, date.month, date.day), 0);
      if (availableAfterPa > 0) result = Math.max(0, availableAfterPa - loss);
    }
    calculationCache.set(cacheKey, result);
    return result;
  }

  function fuelConsumption(job, unit, column) {
    const key = unitKey(unit);
    const cacheKey = `FUEL|${sourceSignature}|${job}|${key}|${context.activeYear}|${periodToken(column)}`;
    if (calculationCache.has(cacheKey)) return calculationCache.get(cacheKey);
    const rate = fuelRate(unit);
    const ewh = ewhValue(job, unit, column);
    const result = rate === null || ewh === null ? null : rate * ewh;
    calculationCache.set(cacheKey, result);
    return result;
  }

  function unitsForJob(job) {
    return equipment.filter(unit => assignments[unitKey(unit)] === job);
  }

  function periodTotal(job, jobUnits, column) {
    if (!jobUnits.length) return null;
    const values = jobUnits.map(unit => fuelConsumption(job, unit, column));
    if (values.some(value => value === null)) return null;
    return values.reduce((sum, value) => sum + value, 0);
  }

  const formatNumber = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const displayFuelRate = value => value === null ? '—' : `${formatNumber(value)} L/Jam`;
  const displayFuel = value => value === null ? '—' : `${formatNumber(value)} L`;

  function syncFixedColumnWidths() {
    const canvas = document.createElement('canvas');
    const measure = canvas.getContext('2d');
    if (!measure) return;
    measure.font = '12px "IBM Plex Sans", sans-serif';
    const labels = ['Jenis Alat', ...equipment.map(unit => String(unit.kelas_alat || '-'))];
    FIXED_WIDTHS[1] = Math.max(90, Math.ceil(Math.max(...labels.map(label => measure.measureText(label).width)) + 26));
  }

  function stickyStyle(index, header = false) {
    const left = FIXED_WIDTHS.slice(0, index).reduce((sum, width) => sum + width, 0);
    return `position:sticky;left:${left}px;z-index:${header ? 60 - index : 40 - index};width:${FIXED_WIDTHS[index]}px;min-width:${FIXED_WIDTHS[index]}px;max-width:${FIXED_WIDTHS[index]}px;background:${header ? '#fbbf24' : '#fff'};box-shadow:1px 0 0 #cbd5e1;`;
  }

  function tableHtml(job, oldTable) {
    const columns = periodColumns(oldTable);
    const jobUnits = unitsForJob(job);
    const rows = jobUnits.length ? jobUnits.map(unit => `<tr data-fuel-unit="${esc(unitKey(unit))}">
      <td style="${stickyStyle(0)}padding:5px;border:1px solid #e2e8f0;font-weight:700;color:#0369a1;">${esc(unit.kode_alat || '-')}</td>
      <td style="${stickyStyle(1)}padding:5px;border:1px solid #e2e8f0;white-space:nowrap;">${esc(unit.kelas_alat || '-')}</td>
      <td style="${stickyStyle(2)}padding:5px;border:1px solid #e2e8f0;white-space:normal;overflow-wrap:anywhere;">${esc(unit.tipe_alat || '-')}</td>
      <td style="${stickyStyle(3)}padding:5px;border:1px solid #e2e8f0;text-align:right;background:#f8fafc;font-weight:700;white-space:nowrap;">${displayFuelRate(fuelRate(unit))}</td>
      ${columns.map(column => `<td data-fuel-value="${column.type}" data-month="${column.month || ''}" data-week="${column.week || ''}" data-day="${column.day || ''}" style="padding:6px;border:1px solid #e2e8f0;text-align:right;white-space:nowrap;background:${column.type === 'week' ? '#fffbeb' : column.type === 'year' ? '#eff6ff' : column.type === 'month' ? '#fffdf5' : '#f8fafc'};color:#0f172a;font-weight:${column.type === 'day' ? '600' : '700'};">${displayFuel(fuelConsumption(job, unit, column))}</td>`).join('')}
    </tr>`).join('') : `<tr><td colspan="${columns.length + 4}" style="padding:18px;text-align:center;color:#64748b;">Belum ada unit dengan JOB ${esc(job)} pada tabel PA.</td></tr>`;
    const fixedTotalWidth = FIXED_WIDTHS.reduce((sum, width) => sum + width, 0);
    return `<section data-fuel-table data-job="${esc(job)}" data-open-month="${oldTable?.dataset.openMonth || ''}" data-open-week="${oldTable?.dataset.openWeek || ''}" style="background:#fff;border:1px solid #dbe7f5;border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(15,23,42,.04);min-width:0;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap;"><h3 style="margin:0;font-size:17px;color:#0f172a;">Fuel Consumption — ${esc(job)}</h3><span style="font-size:12px;color:#64748b;">${jobUnits.length} unit • Otomatis • Read only • Liter</span></div>
      <div data-fuel-scroll style="overflow:auto;height:68vh;max-height:68vh;position:relative;border:1px solid #cbd5e1;border-radius:7px;overscroll-behavior:contain;">
        <table style="border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:12px;table-layout:fixed;">
          <thead><tr>${['Kode Unit', 'Jenis Alat', 'Tipe Model', 'Fuel Rate<br><small>L/Jam</small>'].map((label, index) => `<th style="${stickyStyle(index, true)}top:0;padding:7px;border:1px solid #cbd5e1;white-space:nowrap;">${label}</th>`).join('')}${columns.map(column => `<th data-fuel-period="${column.type}" data-month="${column.month || ''}" data-week="${column.week || ''}" style="position:sticky;top:0;z-index:20;min-width:${column.type === 'day' ? 86 : 112}px;padding:7px 4px;border:1px solid #cbd5e1;background:${column.type === 'day' ? '#fde68a' : '#fbbf24'};cursor:${column.type === 'month' || column.type === 'week' ? 'pointer' : 'default'};">${column.label}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>${`<td colspan="4" style="position:sticky;left:0;bottom:0;z-index:70;width:${fixedTotalWidth}px;min-width:${fixedTotalWidth}px;padding:7px;border:1px solid #cbd5e1;background:#dbeafe;font-weight:800;box-shadow:1px -1px 0 #94a3b8;white-space:nowrap;">Total Fuel Consumption — ${esc(job)}</td>`}${columns.map(column => `<td style="position:sticky;bottom:0;z-index:45;padding:7px;border:1px solid #cbd5e1;text-align:right;white-space:nowrap;background:#dbeafe;font-weight:800;box-shadow:0 -1px 0 #94a3b8;">${displayFuel(periodTotal(job, jobUnits, column))}</td>`).join('')}</tr></tfoot>
        </table>
      </div>
    </section>`;
  }

  function findTable(job) {
    return [...document.querySelectorAll('#fuelBudgetTables [data-fuel-table]')].find(table => table.dataset.job === job);
  }

  function syncYearControl() {
    const select = document.getElementById('fuelBudgetYear');
    if (!select) return;
    select.innerHTML = Array.from({ length: context.endYear - context.startYear + 1 }, (_, index) => `<option value="${context.startYear + index}">${context.startYear + index}</option>`).join('');
    select.value = String(context.activeYear);
  }

  function render() {
    const host = document.getElementById('fuelBudgetTables');
    if (!host) return;
    const oldTables = new Map([...host.querySelectorAll('[data-fuel-table]')].map(table => [table.dataset.job, table]));
    if (!jobs.length) host.innerHTML = '<div style="background:#fff;padding:24px;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;color:#64748b;">Belum ada JOB berstatus Deployed pada dashboard SPO.</div>';
    else host.innerHTML = jobs.map(job => tableHtml(job, oldTables.get(job))).join('');
    syncYearControl();
    persistCalculationCache();
  }

  function renderJob(job) {
    const oldTable = findTable(job);
    if (!oldTable) return render();
    const scroll = oldTable.querySelector('[data-fuel-scroll]');
    const scrollLeft = scroll?.scrollLeft || 0;
    const scrollTop = scroll?.scrollTop || 0;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = tableHtml(job, oldTable).trim();
    const nextTable = wrapper.firstElementChild;
    oldTable.replaceWith(nextTable);
    const nextScroll = nextTable.querySelector('[data-fuel-scroll]');
    if (nextScroll) {
      nextScroll.scrollLeft = scrollLeft;
      nextScroll.scrollTop = scrollTop;
    }
    persistCalculationCache();
  }

  function bindOnce() {
    const panel = document.getElementById('tab-prodBudgetingCosting');
    if (!panel || panel.dataset.fuelBudgetBound) return;
    panel.dataset.fuelBudgetBound = 'true';
    panel.addEventListener('click', event => {
      const header = event.target.closest('[data-fuel-period]');
      if (!header || !['month', 'week'].includes(header.dataset.fuelPeriod)) return;
      const table = header.closest('[data-fuel-table]');
      if (!table) return;
      if (header.dataset.fuelPeriod === 'month') {
        const month = Number(header.dataset.month);
        table.dataset.openMonth = Number(table.dataset.openMonth) === month ? '' : String(month);
        table.dataset.openWeek = '';
      } else {
        const week = Number(header.dataset.week);
        table.dataset.openWeek = Number(table.dataset.openWeek) === week ? '' : String(week);
      }
      renderJob(table.dataset.job);
    });
    panel.addEventListener('change', event => {
      if (!event.target.matches('#fuelBudgetYear')) return;
      context.activeYear = Number(event.target.value);
      render();
    });
  }

  async function loadSources() {
    const responses = await Promise.all([
      fetch(api('/api/admin/production/master'), { headers: auth() }),
      fetch(api('/api/admin/production/productivity-plans/spo'), { headers: auth() }),
      fetch(api('/api/admin/production/productivity-plans/pa-ua-ewh'), { headers: auth() })
    ]);
    if (!responses[0].ok) throw new Error(`Master HTTP ${responses[0].status}`);
    if (!responses[1].ok) throw new Error(`SPO HTTP ${responses[1].status}`);
    if (!responses[2].ok) throw new Error(`PA/EWH HTTP ${responses[2].status}`);
    const [master, spo, pae] = await Promise.all(responses.map(response => response.json()));
    equipment = master.equipment || [];
    syncFixedColumnWidths();
    const saved = pae.planningData || {};
    assignments = saved.assignments?.PA || {};
    paValues = saved.values?.PA || {};
    extractSpoContext(spo);
    sourceSignature = hashString(JSON.stringify({
      spoUpdatedAt: spo.updatedAt || '',
      paeUpdatedAt: pae.updatedAt || '',
      equipment: equipment.map(unit => [unitKey(unit), unit.kode_alat, unit.kelas_alat, unit.tipe_alat, unit.fuel_rate_lph]),
      jobs,
      period: [context.startYear, context.endYear, context.weeklyModel, context.weekStartDay]
    }));
    restoreCalculationCache();
  }

  async function init() {
    bindOnce();
    if (loadingPromise) return loadingPromise;
    const status = document.getElementById('fuelBudgetStatus');
    if (status) status.textContent = 'Memuat sumber data…';
    loadingPromise = (async () => {
      try {
        await loadSources();
        context.activeYear = Math.min(Math.max(Number(context.activeYear) || context.startYear, context.startYear), context.endYear);
        render();
        if (status) status.textContent = 'Tersinkron • Cache kalkulasi aktif';
      } catch (error) {
        console.error('Gagal memuat Fuel Budgeting:', error);
        const host = document.getElementById('fuelBudgetTables');
        if (host) host.innerHTML = `<div style="padding:18px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;">Gagal memuat Fuel Budgeting: ${esc(error.message)}</div>`;
        if (status) status.textContent = 'Gagal memuat data';
      } finally {
        loadingPromise = null;
      }
    })();
    return loadingPromise;
  }

  global.FuelBudgetingPlanning = { init, refresh: init };
}(window));
