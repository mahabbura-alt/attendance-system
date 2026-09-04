(function (global) {
  'use strict';

  const METRICS = ['PA', 'UA', 'EWH'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const COLS = [120, 60, 140, 75, 72];
  let initialized = false;
  let saveTimer = null;
  let units = [];
  let jobs = [];
  let spoTablesByJob = {};
  const spoLossCache = new Map();
  const calculationCache = new Map();
  let state = {
    version: 1,
    startYear: new Date().getFullYear(),
    endYear: new Date().getFullYear(),
    activeYear: new Date().getFullYear(),
    weeklyModel: 'week-of-year',
    weekStartDay: 1,
    assignments: {},
    values: {}
  };

  const api = path => typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(path) : path;
  const auth = () => typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const daysOf = (year, month) => Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1);
  const dateAt = (year, month, day) => new Date(year, month - 1, day);
  const unitKey = unit => String(unit.id ?? unit.kode_alat);
  const valueKey = (year, month, day) => `${year}:${month}:${day}`;
  const isManualWeek = () => String(state.weeklyModel).startsWith('manual-');
  const weekStart = () => isManualWeek() ? Number(state.weekStartDay) : 1;

  function invalidateCalculationCache(unit) {
    if (unit === undefined) { calculationCache.clear(); return; }
    const marker = `|${String(unit)}|`;
    [...calculationCache.keys()].forEach(key => { if (key.includes(marker)) calculationCache.delete(key); });
  }

  function periodToken(column) {
    return `${column.type}:${Number(column.month) || 0}:${Number(column.week) || 0}:${Number(column.day) || 0}`;
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
      label: `Week ${state.weeklyModel.endsWith('year') || state.weeklyModel === 'week-of-year' ? weekNumber(dateAt(year, month, days[0]), weekStart()) : index + 1}`
    }));
  }

  function getValue(metric, unit, year, month, day) {
    return state.values?.[metric]?.[unit]?.[valueKey(year, month, day)] ?? '';
  }

  function setValue(metric, unit, year, month, day, value) {
    state.values[metric] ||= {};
    state.values[metric][unit] ||= {};
    state.values[metric][unit][valueKey(year, month, day)] = value;
    if (metric === 'PA') invalidateCalculationCache(unit);
  }

  function extractSpoContext(payload) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${payload?.contentHtml || ''}</div>`, 'text/html');
    const planningTables = payload?.planningData?.tables || {};
    spoTablesByJob = {};
    spoLossCache.clear();
    calculationCache.clear();
    [...doc.querySelectorAll('.spo-table')]
      .filter(table => /^\s*deployed\s*$/i.test(table.querySelector('[data-spo-status]')?.textContent || ''))
      .forEach(table => {
        const job = table.querySelector('[data-spo-job]')?.getAttribute('value')?.trim();
        const id = table.dataset.spoTableId;
        if (job && id && !spoTablesByJob[job]) spoTablesByJob[job] = planningTables[id] || {};
      });
    jobs = Object.keys(spoTablesByJob).sort((a, b) => a.localeCompare(b));
    const tables = Object.values(planningTables);
    if (tables.length) {
      state.startYear = Math.min(...tables.map(table => Number(table.startYear) || new Date().getFullYear()));
      state.endYear = Math.max(...tables.map(table => Number(table.endYear) || state.startYear));
      state.activeYear = Math.min(Math.max(Number(tables[0].activeYear) || state.startYear, state.startYear), state.endYear);
      state.weeklyModel = tables[0].weeklyModel || state.weeklyModel;
      state.weekStartDay = Number(tables[0].weekStartDay ?? state.weekStartDay);
    }
  }

  function normalizeSaved(payload) {
    const saved = payload?.planningData;
    if (!saved || typeof saved !== 'object') return;
    state.assignments = saved.assignments || {};
    state.values = saved.values || {};
    calculationCache.clear();
  }

  function jobOptions(selected) {
    return `<option value="">Pilih JOB</option>${jobs.map(job => `<option value="${esc(job)}" ${job === selected ? 'selected' : ''}>${esc(job)}</option>`).join('')}`;
  }

  function stickyStyle(index, header = false) {
    const left = COLS.slice(0, index).reduce((sum, width) => sum + width, 0);
    return `position:sticky;left:${left}px;z-index:${header ? 50 - index : 30 - index};width:${COLS[index]}px;min-width:${COLS[index]}px;max-width:${COLS[index]}px;background:${header ? '#fbbf24' : '#fff'};box-shadow:1px 0 0 #cbd5e1;`;
  }

  function periodColumns(table) {
    const openMonth = Number(table?.dataset.openMonth || 0);
    const openWeek = Number(table?.dataset.openWeek || 0);
    const result = [];
    for (let month = 1; month <= 12; month += 1) {
      if (month === openMonth) {
        weekGroups(state.activeYear, month).forEach((group, index) => {
          const week = index + 1;
          if (week === openWeek) group.days.forEach(day => result.push({ type: 'day', month, week, day, label: `${day}-${MONTHS[month - 1]}<br><small>${dateAt(state.activeYear, month, day).toLocaleDateString('en-US', { weekday: 'short' })}</small>` }));
          result.push({ type: 'week', month, week, label: `${week === openWeek ? '▼' : '▶'} ${group.label}` });
        });
      }
      result.push({ type: 'month', month, label: `${month === openMonth ? '▼' : '▶'} ${MONTHS[month - 1]}-${String(state.activeYear).slice(-2)}` });
    }
    result.push({ type: 'year', label: `Tahun ${state.activeYear}` });
    return result;
  }

  function selectedWeek(table) {
    const month = Number(table?.dataset.openMonth || 0);
    const week = Number(table?.dataset.openWeek || 0);
    const group = month && week ? weekGroups(state.activeYear, month)[week - 1] : null;
    return group ? { month, week, group } : null;
  }

  // PA memakai MOHH Calendar Hours: setiap hari memiliki bobot 24 jam,
  // independen dari pemilihan JOB dan pengurangan jam pada SPO.
  function paWeightedAverage(unit, days) {
    let weightedTotal = 0;
    let totalHours = 0;
    days.forEach(({ month, day }) => {
      const raw = getValue('PA', unit, state.activeYear, month, day);
      const pa = Number(raw);
      const hours = 24;
      if (raw !== '' && Number.isFinite(pa) && hours > 0) {
        weightedTotal += pa * hours;
        totalHours += hours;
      }
    });
    return totalHours > 0 ? weightedTotal / totalHours : null;
  }

  function paPeriodValue(unit, column) {
    const cacheKey = `PA|${unit}|${state.activeYear}|${periodToken(column)}`;
    let value;
    if (calculationCache.has(cacheKey)) value = calculationCache.get(cacheKey);
    else {
      value = paWeightedAverage(unit, columnDays(column));
      calculationCache.set(cacheKey, value);
    }
    return value === null ? '—' : `${value.toFixed(2)}%`;
  }

  function columnDays(column) {
    if (column.type === 'day') return [{ month: column.month, day: column.day }];
    if (column.type === 'week') return (weekGroups(state.activeYear, column.month)[column.week - 1]?.days || []).map(day => ({ month: column.month, day }));
    if (column.type === 'month') return daysOf(state.activeYear, column.month).map(day => ({ month: column.month, day }));
    if (column.type === 'year') return MONTHS.flatMap((_, index) => daysOf(state.activeYear, index + 1).map(day => ({ month: index + 1, day })));
    return [];
  }

  function spoDailyLoss(job, year, month, day) {
    const cacheKey = `${job}|${year}|${month}|${day}`;
    if (spoLossCache.has(cacheKey)) return spoLossCache.get(cacheKey);
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
    spoLossCache.set(cacheKey, result);
    return result;
  }

  function derivedPeriod(metric, unit, column) {
    const job = state.assignments.PA?.[unit] || '';
    if (!job || !spoTablesByJob[job]) return null;
    const cacheKey = `${metric}|${unit}|${state.activeYear}|${job}|${periodToken(column)}`;
    if (calculationCache.has(cacheKey)) return calculationCache.get(cacheKey);
    const basisKey = `BASIS|${unit}|${state.activeYear}|${job}|${periodToken(column)}`;
    let basis = calculationCache.get(basisKey);
    if (!calculationCache.has(basisKey)) {
      const days = columnDays(column);
      const paValues = days.map(({ month, day }) => getValue('PA', unit, state.activeYear, month, day));
      if (!days.length || paValues.some(value => value === '' || !Number.isFinite(Number(value)))) basis = null;
      else {
        const paPeriod = paValues.reduce((sum, value) => sum + Number(value), 0) / paValues.length;
        const availableAfterPa = days.length * 24 * (paPeriod / 100);
        const loss = days.reduce((sum, { month, day }) => sum + spoDailyLoss(job, state.activeYear, month, day), 0);
        basis = availableAfterPa > 0 ? { availableAfterPa, ewh: Math.max(0, availableAfterPa - loss) } : null;
      }
      calculationCache.set(basisKey, basis);
    }
    if (!basis) { calculationCache.set(cacheKey, null); return null; }
    const result = metric === 'UA' ? (basis.ewh / basis.availableAfterPa) * 100 : basis.ewh;
    calculationCache.set(cacheKey, result);
    return result;
  }

  function derivedDisplay(metric, unit, column) {
    const value = derivedPeriod(metric, unit, column);
    if (value === null) return '—';
    return metric === 'UA' ? `${value.toFixed(2)}%` : value.toFixed(2);
  }

  function normalizePaValue(value) {
    if (value === '') return '';
    return Math.min(100, Math.max(0, Number(value) || 0)).toFixed(2);
  }

  function paImportDates() {
    return MONTHS.flatMap((_, index) => daysOf(state.activeYear, index + 1).map(day => ({ month: index + 1, day, key: `${state.activeYear}-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` })));
  }

  function downloadPaImportTemplate() {
    if (!global.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
    if (!units.length) return alert('Belum ada unit di List Equipment untuk dibuatkan template.');
    const dates = paImportDates();
    const headers = ['Kode Unit', 'Jenis Alat', 'Tipe Model', 'JOB', ...dates.map(date => date.key)];
    const assignment = state.assignments.PA || {};
    const rows = units.map(unit => {
      const key = unitKey(unit);
      return [unit.kode_alat || '', unit.kelas_alat || '', unit.tipe_alat || '', assignment[key] || '', ...dates.map(date => getValue('PA', key, state.activeYear, date.month, date.day))];
    });
    const sheet = global.XLSX.utils.aoa_to_sheet([headers, ...rows]);
    sheet['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 20 }, ...dates.map(() => ({ wch: 12 }))];
    sheet['!autofilter'] = { ref: `A1:${global.XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}` };
    sheet['!freeze'] = { xSplit: 4, ySplit: 1 };
    const guide = global.XLSX.utils.aoa_to_sheet([
      ['PETUNJUK IMPORT PA OMOS'],
      ['Periode', String(state.activeYear)],
      ['Kolom yang diisi', 'Kolom tanggal berformat YYYY-MM-DD; isi PA dalam persen 0 sampai 100, maksimal 2 desimal.'],
      ['Identitas unit', 'Kode Unit wajib dan digunakan untuk pencocokan. Jenis Alat, Tipe Model, serta JOB hanya referensi.'],
      ['Catatan', 'Kolom kosong tidak mengubah data PA yang sudah ada. Jangan mengubah nama header tanggal.']
    ]);
    guide['!cols'] = [{ wch: 22 }, { wch: 105 }];
    const workbook = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(workbook, sheet, 'PA Import');
    global.XLSX.utils.book_append_sheet(workbook, guide, 'Petunjuk');
    global.XLSX.writeFile(workbook, `OMOS_Template_Import_PA_${state.activeYear}.xlsx`);
  }

  async function importPaTemplate(file) {
    if (!file) return;
    if (!global.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
    try {
      const workbook = global.XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });
      const sheet = workbook.Sheets['PA Import'] || workbook.Sheets[workbook.SheetNames[0]];
      const rows = global.XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) throw new Error('File template tidak memiliki data unit.');
      const dateHeaders = Object.keys(rows[0]).map(header => String(header).trim()).filter(header => new RegExp(`^${state.activeYear}-\\d{2}-\\d{2}$`).test(header));
      if (!dateHeaders.length) throw new Error(`Header tanggal periode ${state.activeYear} tidak ditemukan. Gunakan template PA OMOS tahun ${state.activeYear}.`);
      const unitKeysByCode = new Map(units.map(unit => [String(unit.kode_alat || '').trim(), unitKey(unit)]).filter(([code]) => Boolean(code)));
      let updated = 0, skipped = 0, invalid = 0;
      rows.forEach(row => {
        const unit = String(row['Kode Unit'] ?? row['KODE UNIT'] ?? row.kode_unit ?? '').trim();
        if (!unit) return;
        const unitStateKey = unitKeysByCode.get(unit);
        if (!unitStateKey) { skipped += 1; return; }
        dateHeaders.forEach(header => {
          const raw = row[header];
          if (raw === '' || raw === null || raw === undefined) return;
          const number = Number(raw);
          if (!Number.isFinite(number) || number < 0 || number > 100) { invalid += 1; return; }
          const [, month, day] = header.split('-').map(Number);
          setValue('PA', unitStateKey, state.activeYear, month, day, number.toFixed(2));
          updated += 1;
        });
      });
      if (!updated && !skipped) throw new Error('Tidak ada nilai PA yang dapat diimpor.');
      render();
      save(true);
      alert(`Import PA selesai. ${updated} nilai diperbarui${skipped ? `, ${skipped} Kode Unit tidak ditemukan` : ''}${invalid ? `, ${invalid} nilai diabaikan karena harus 0–100` : ''}.`);
    } catch (error) {
      console.error('Gagal import PA:', error);
      alert(error.message || 'Gagal membaca file Excel PA.');
    } finally {
      const input = document.getElementById('paeImportFile');
      if (input) input.value = '';
    }
  }

  function refreshPaAggregates(table, row) {
    if (table?.dataset.metric !== 'PA' || !row) return;
    const unit = row.dataset.paeUnit;
    row.querySelectorAll('[data-pae-aggregate]').forEach(cell => {
      cell.textContent = paPeriodValue(unit, { type: cell.dataset.paeAggregate, month: Number(cell.dataset.month), week: Number(cell.dataset.week) });
    });
    refreshDerivedRows(unit);
  }

  function refreshDerivedRows(unit) {
    ['UA', 'EWH'].forEach(metric => {
      const table = document.querySelector(`[data-pae-table][data-metric="${metric}"]`);
      const row = table?.querySelector(`[data-pae-unit="${CSS.escape(String(unit))}"]`);
      if (!row) return;
      const preview = row.querySelector('[data-pae-job-preview]');
      if (preview) preview.textContent = state.assignments.PA?.[unit] || '';
      row.querySelectorAll('[data-pae-derived]').forEach(cell => {
        const type = cell.dataset.derivedPeriod || 'day';
        cell.textContent = derivedDisplay(metric, unit, { type, month: Number(cell.dataset.month), week: Number(cell.dataset.week), day: Number(cell.dataset.day) });
      });
    });
  }

  function tableHtml(metric, oldTable) {
    const columns = periodColumns(oldTable);
    const assignment = state.assignments.PA || {};
    const rows = units.length ? units.map(unit => {
      const key = unitKey(unit);
      return `<tr data-pae-unit="${esc(key)}">
        <td style="${stickyStyle(0)}padding:5px;border:1px solid #e2e8f0;font-weight:700;color:#0369a1;">${esc(unit.kode_alat || '-')}</td>
        <td style="${stickyStyle(1)}padding:5px;border:1px solid #e2e8f0;">${esc(unit.kelas_alat || '-')}</td>
        <td style="${stickyStyle(2)}padding:5px;border:1px solid #e2e8f0;">${esc(unit.tipe_alat || '-')}</td>
        <td style="${stickyStyle(3)}padding:3px;border:1px solid #e2e8f0;vertical-align:top;${metric === 'PA' ? '' : 'background:#f8fafc;'}">${metric === 'PA' ? `<div style="position:relative;width:18px;height:18px;"><span aria-hidden="true" style="display:block;width:18px;height:18px;line-height:16px;text-align:center;border:1px solid #94a3b8;border-radius:4px;background:#f8fafc;color:#0f172a;font-size:12px;font-weight:800;">⌄</span><select data-pae-job title="Pilih JOB: ${esc(assignment[key] || 'belum dipilih')}" aria-label="Pilih JOB ${esc(unit.kode_alat || '')}" style="position:absolute;inset:0;width:18px;height:18px;opacity:0;cursor:pointer;">${jobOptions(assignment[key] || '')}</select></div>` : ''}<div data-pae-job-preview style="margin-top:3px;font-size:10px;line-height:1.25;color:#334155;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${esc(assignment[key] || '')}</div></td>
        ${metric === 'PA' ? `<td style="${stickyStyle(4)}padding:3px;border:1px solid #e2e8f0;vertical-align:top;"><div style="position:relative;"><input data-pae-quick type="number" min="0" max="100" step="0.01" title="Mengisi seluruh hari pada week yang sedang dibuka" value="${esc((() => { const active = selectedWeek(oldTable); return active ? getValue(metric, key, state.activeYear, active.month, active.group.days[0]) : ''; })())}" placeholder="Week" style="width:100%;box-sizing:border-box;padding:5px 16px 5px 3px;border:1px solid #cbd5e1;border-radius:4px;text-align:right;"><span style="position:absolute;right:4px;top:5px;font-size:10px;color:#64748b;pointer-events:none;">%</span></div></td>` : ''}
        ${columns.map(column => {
          if (column.type === 'day') {
            if (metric !== 'PA') return `<td data-pae-derived="${metric}" data-month="${column.month}" data-day="${column.day}" style="padding:6px;border:1px solid #e2e8f0;text-align:right;background:#f8fafc;color:#0f172a;font-weight:700;">${derivedDisplay(metric, key, column)}</td>`;
            const value = getValue(metric, key, state.activeYear, column.month, column.day);
            return `<td style="padding:2px;border:1px solid #e2e8f0;"><div style="position:relative;"><input data-pae-value type="number" min="0" max="100" step="0.01" data-month="${column.month}" data-day="${column.day}" value="${esc(value)}" style="width:58px;box-sizing:border-box;padding:5px 14px 5px 3px;border:1px solid #cbd5e1;border-radius:4px;text-align:right;"><span style="position:absolute;right:3px;top:5px;font-size:9px;color:#64748b;pointer-events:none;">%</span></div></td>`;
          }
          if (metric === 'PA') return `<td data-pae-aggregate="${column.type}" data-month="${column.month || ''}" data-week="${column.week || ''}" style="padding:6px;border:1px solid #e2e8f0;text-align:right;background:${column.type === 'week' ? '#fffbeb' : column.type === 'year' ? '#eff6ff' : '#fff'};color:#0f172a;font-weight:700;">${paPeriodValue(key, column)}</td>`;
          return `<td data-pae-derived="${metric}" data-derived-period="${column.type}" data-month="${column.month || ''}" data-week="${column.week || ''}" style="padding:6px;border:1px solid #e2e8f0;text-align:right;background:${column.type === 'week' ? '#fffbeb' : column.type === 'year' ? '#eff6ff' : '#f8fafc'};color:#0f172a;font-weight:700;">${derivedDisplay(metric, key, column)}</td>`;
        }).join('')}
      </tr>`;
    }).join('') : `<tr><td colspan="6" style="padding:18px;text-align:center;color:#64748b;">Belum ada unit di List Equipment.</td></tr>`;
    return `<section data-pae-table data-metric="${metric}" data-open-month="${oldTable?.dataset.openMonth || ''}" data-open-week="${oldTable?.dataset.openWeek || ''}" style="background:#fff;border:1px solid #dbe7f5;border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(15,23,42,.04);min-width:0;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap;"><h3 style="margin:0;font-size:17px;color:#0f172a;">Tabel ${metric}</h3><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${metric==='PA'?'<button type="button" class="tombol tombol--ghost" data-pae-download-template style="font-size:12px;padding:6px 9px;">⇩ Download Template Import</button><button type="button" class="tombol tombol--ghost" data-pae-import style="font-size:12px;padding:6px 9px;border-color:#2e7d32;color:#166534;">🟩 Import PA</button>':''}<span style="font-size:12px;color:#64748b;">${units.length} unit${metric==='PA'?' • Input Manual format %':' • Otomatis dari PA + SPO • Read only'}</span></div></div>
      <div data-pae-scroll style="overflow:auto;max-height:68vh;position:relative;border:1px solid #cbd5e1;border-radius:7px;">
        <table style="border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:12px;">
          <thead><tr>${['Kode Unit', 'Jenis Alat', 'Tipe Model', 'JOB'].concat(metric === 'PA' ? ['Input Cepat'] : []).map((label, index) => `<th style="${stickyStyle(index, true)}position:sticky;top:0;padding:7px;border:1px solid #cbd5e1;">${label}</th>`).join('')}${columns.map(column => `<th data-pae-period="${column.type}" data-month="${column.month || ''}" data-week="${column.week || ''}" style="position:sticky;top:0;z-index:20;min-width:${column.type === 'day' ? 64 : 76}px;padding:7px 4px;border:1px solid #cbd5e1;background:${column.type === 'day' ? '#fde68a' : '#fbbf24'};cursor:${column.type === 'month' || column.type === 'week' ? 'pointer' : 'default'};">${column.label}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
  }

  function render() {
    const host = document.getElementById('paeTables');
    if (!host) return;
    const old = Object.fromEntries([...host.querySelectorAll('[data-pae-table]')].map(table => [table.dataset.metric, table]));
    host.innerHTML = METRICS.map(metric => tableHtml(metric, old[metric])).join('');
    const year = document.getElementById('paeGlobalYear');
    if (year) {
      year.innerHTML = Array.from({ length: state.endYear - state.startYear + 1 }, (_, index) => `<option value="${state.startYear + index}">${state.startYear + index}</option>`).join('');
      year.value = String(state.activeYear);
    }
  }

  function renderMetric(metric) {
    const host = document.getElementById('paeTables');
    const oldTable = host?.querySelector(`[data-pae-table][data-metric="${metric}"]`);
    if (!host || !oldTable) return render();
    const oldScroll = oldTable.querySelector('[data-pae-scroll]');
    const scrollLeft = oldScroll?.scrollLeft || 0, scrollTop = oldScroll?.scrollTop || 0;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = tableHtml(metric, oldTable).trim();
    const nextTable = wrapper.firstElementChild;
    oldTable.replaceWith(nextTable);
    const nextScroll = nextTable.querySelector('[data-pae-scroll]');
    if (nextScroll) { nextScroll.scrollLeft = scrollLeft; nextScroll.scrollTop = scrollTop; }
  }

  function save(immediate = false) {
    clearTimeout(saveTimer);
    const run = async () => {
      const status = document.getElementById('paeSaveStatus');
      if (status) status.textContent = 'Menyimpan…';
      try {
        const response = await fetch(api('/api/admin/production/productivity-plans/pa-ua-ewh'), {
          method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify({ contentHtml: '<div data-pae-storage="true"></div>', planningData: state })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (status) status.textContent = 'Tersimpan';
      } catch (error) {
        console.error('Gagal menyimpan PA/UA/EWH:', error);
        if (status) status.textContent = 'Gagal simpan';
      }
    };
    if (immediate) run(); else saveTimer = setTimeout(run, 350);
  }

  function bindOnce() {
    const panel = document.getElementById('tab-prodDelayForecasting');
    if (!panel || panel.dataset.paeBound) return;
    panel.dataset.paeBound = 'true';
    panel.addEventListener('click', event => {
      if (event.target.closest('[data-pae-download-template]')) { downloadPaImportTemplate(); return; }
      if (event.target.closest('[data-pae-import]')) { document.getElementById('paeImportFile')?.click(); return; }
      const header = event.target.closest('[data-pae-period]');
      if (!header || !['month', 'week'].includes(header.dataset.paePeriod)) return;
      const table = header.closest('[data-pae-table]');
      if (header.dataset.paePeriod === 'month') {
        const month = Number(header.dataset.month);
        table.dataset.openMonth = Number(table.dataset.openMonth) === month ? '' : String(month);
        table.dataset.openWeek = '';
      } else {
        const week = Number(header.dataset.week);
        table.dataset.openWeek = Number(table.dataset.openWeek) === week ? '' : String(week);
      }
      renderMetric(table.dataset.metric);
    });
    panel.addEventListener('change', event => {
      if (event.target.matches('#paeImportFile')) { importPaTemplate(event.target.files?.[0]); return; }
      if (event.target.matches('#paeGlobalYear')) {
        state.activeYear = Number(event.target.value);
        calculationCache.clear();
        render(); save(true); return;
      }
      const table = event.target.closest('[data-pae-table]');
      const row = event.target.closest('[data-pae-unit]');
      if (!table || !row) return;
      const metric = table.dataset.metric, unit = row.dataset.paeUnit;
      if (event.target.matches('[data-pae-quick]')) {
        const active = selectedWeek(table);
        if (!active) {
          alert('Buka bulan lalu pilih salah satu Week terlebih dahulu sebelum memakai Input Cepat PA.');
          event.target.value = '';
          return;
        }
        const value = normalizePaValue(event.target.value);
        event.target.value = value;
        active.group.days.forEach(day => setValue('PA', unit, state.activeYear, active.month, day, value));
        row.querySelectorAll(`[data-pae-value][data-month="${active.month}"]`).forEach(input => {
          if (active.group.days.includes(Number(input.dataset.day))) input.value = value;
        });
        refreshPaAggregates(table, row);
        save();
        return;
      }
      if (event.target.matches('[data-pae-job]')) {
        state.assignments[metric] ||= {};
        state.assignments[metric][unit] = event.target.value;
        invalidateCalculationCache(unit);
        const preview = row.querySelector('[data-pae-job-preview]');
        if (preview) preview.textContent = event.target.value;
        event.target.title = `Pilih JOB: ${event.target.value || 'belum dipilih'}`;
        refreshPaAggregates(table, row);
        save();
      }
      if (event.target.matches('[data-pae-value]')) {
        const value = metric === 'PA' ? normalizePaValue(event.target.value) : (event.target.value === '' ? '' : Number(event.target.value).toFixed(2));
        event.target.value = value;
        setValue(metric, unit, state.activeYear, Number(event.target.dataset.month), Number(event.target.dataset.day), value);
        refreshPaAggregates(table, row);
        save();
      }
    });
    panel.addEventListener('input', event => {
      if (event.target.matches('[data-pae-quick]')) {
        const table = event.target.closest('[data-pae-table]'), row = event.target.closest('[data-pae-unit]'), active = selectedWeek(table);
        if (!table || !row || !active) return;
        const value = event.target.value;
        active.group.days.forEach(day => setValue('PA', row.dataset.paeUnit, state.activeYear, active.month, day, value));
        row.querySelectorAll(`[data-pae-value][data-month="${active.month}"]`).forEach(input => {
          if (active.group.days.includes(Number(input.dataset.day))) input.value = value;
        });
        save();
        return;
      }
      if (!event.target.matches('[data-pae-value]')) return;
      const table = event.target.closest('[data-pae-table]'), row = event.target.closest('[data-pae-unit]');
      const value = table.dataset.metric === 'PA' ? (event.target.value === '' ? '' : Math.min(100, Math.max(0, Number(event.target.value) || 0))) : event.target.value;
      setValue(table.dataset.metric, row.dataset.paeUnit, state.activeYear, Number(event.target.dataset.month), Number(event.target.dataset.day), value);
      refreshPaAggregates(table, row);
      save();
    });
    panel.addEventListener('focusout', event => {
      if (event.target.matches('[data-pae-quick]')) {
        const table = event.target.closest('[data-pae-table]'), row = event.target.closest('[data-pae-unit]');
        if (!table || !row) return;
        const active = selectedWeek(table);
        if (!active) return;
        const value = normalizePaValue(event.target.value);
        event.target.value = value;
        active.group.days.forEach(day => setValue('PA', row.dataset.paeUnit, state.activeYear, active.month, day, value));
        row.querySelectorAll(`[data-pae-value][data-month="${active.month}"]`).forEach(input => {
          if (active.group.days.includes(Number(input.dataset.day))) input.value = value;
        });
        refreshPaAggregates(table, row);
        save();
        return;
      }
      if (!event.target.matches('[data-pae-value]')) return;
      const table = event.target.closest('[data-pae-table]'), row = event.target.closest('[data-pae-unit]');
      const value = table.dataset.metric === 'PA' ? normalizePaValue(event.target.value) : (event.target.value === '' ? '' : Number(event.target.value).toFixed(2));
      event.target.value = value;
      setValue(table.dataset.metric, row.dataset.paeUnit, state.activeYear, Number(event.target.dataset.month), Number(event.target.dataset.day), value);
      refreshPaAggregates(table, row);
      save();
    });
  }

  async function init() {
    bindOnce();
    const status = document.getElementById('paeSaveStatus');
    if (status) status.textContent = 'Memuat…';
    try {
      const [masterResponse, spoResponse, savedResponse] = await Promise.all([
        fetch(api('/api/admin/production/master'), { headers: auth() }),
        fetch(api('/api/admin/production/productivity-plans/spo'), { headers: auth() }),
        fetch(api('/api/admin/production/productivity-plans/pa-ua-ewh'), { headers: auth() })
      ]);
      if (!masterResponse.ok) throw new Error(`Master HTTP ${masterResponse.status}`);
      units = (await masterResponse.json()).equipment || [];
      const spo = spoResponse.ok ? await spoResponse.json() : {};
      const saved = savedResponse.ok ? await savedResponse.json() : {};
      extractSpoContext(spo);
      normalizeSaved(saved);
      state.activeYear = Math.min(Math.max(Number(state.activeYear) || state.startYear, state.startYear), state.endYear);
      render();
      if (status) status.textContent = 'Tersimpan';
      initialized = true;
    } catch (error) {
      console.error('Gagal memuat PA/UA/EWH:', error);
      if (status) status.textContent = 'Gagal memuat data';
    }
  }

  global.PaUaEwhPlanning = { init, refresh: init, get initialized() { return initialized; } };
}(window));
