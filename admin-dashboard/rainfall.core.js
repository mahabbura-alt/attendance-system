(function initRainfallData(global) {
  'use strict';

  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const state = { initialized: false, loading: false, year: null, month: null, areas: [], shifts: [], jobs: [], rows: [], sequence: 0 };

  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const keyFor = row => row._key || row.id;
  const newRow = area => ({ _key: `rain-new-${++state.sequence}`, area_name: area, _dirty: false });
  const fields = ['operational_date','shift_id','job_code','rain_start','rain_finish','intensity_mm','slippery_start','slippery_finish'];
  const isTouched = row => fields.some(field => String(row[field] || '').trim());
  const dirtyRows = () => state.rows.filter(row => row._dirty && isTouched(row));

  function selected(value, current) { return String(value || '') === String(current || '') ? ' selected' : ''; }
  function timeValue(value) { return String(value || '').slice(0, 5); }
  function shiftOptions(current) {
    return `<option value="">Pilih Shift</option>${state.shifts.map(item => `<option value="${esc(item.id)}"${selected(item.id,current)}>${esc(item.nama_shift)}</option>`).join('')}`;
  }
  function jobOptions(current) {
    return `<option value="">Pilih JOB</option>${state.jobs.map(item => `<option value="${esc(item.jobCode)}"${selected(item.jobCode,current)}>${esc(item.jobCode)} · ${esc(item.jobDescription)}</option>`).join('')}`;
  }
  function rowMarkup(row) {
    const key = esc(keyFor(row));
    return `<tr data-rainfall-row="${key}" class="${row._dirty ? 'is-dirty' : ''}">
      <td><input type="date" data-rain-field="operational_date" value="${esc(row.operational_date || '')}" aria-label="Tanggal"></td>
      <td><select data-rain-field="shift_id" aria-label="Shift">${shiftOptions(row.shift_id)}</select></td>
      <td><select data-rain-field="job_code" aria-label="JOB">${jobOptions(row.job_code)}</select></td>
      <td><input type="time" data-rain-field="rain_start" value="${esc(timeValue(row.rain_start))}" aria-label="Jam hujan mulai"></td>
      <td><input type="time" data-rain-field="rain_finish" value="${esc(timeValue(row.rain_finish))}" aria-label="Jam hujan selesai"></td>
      <td><div class="rainfall-intensity-input"><input type="number" min="0" step="0.1" inputmode="decimal" data-rain-field="intensity_mm" value="${esc(row.intensity_mm ?? '')}" placeholder="0.0" aria-label="Intensitas dalam milimeter"><span>mm</span></div></td>
      <td><input type="time" data-rain-field="slippery_start" value="${esc(timeValue(row.slippery_start))}" aria-label="Slippery mulai"></td>
      <td><input type="time" data-rain-field="slippery_finish" value="${esc(timeValue(row.slippery_finish))}" aria-label="Slippery selesai"></td>
    </tr>`;
  }

  function tableMarkup(area) {
    const rows = state.rows.filter(row => row.area_name === area);
    return `<article class="rainfall-area-card">
      <header><div><span>AREA OPERASIONAL</span><h3>📍 ${esc(area)}</h3></div><strong>${rows.filter(row => row.id).length} data tersimpan</strong></header>
      <div class="rainfall-table-scroll"><table class="rainfall-table">
        <thead><tr><th rowspan="2">Tanggal</th><th rowspan="2">Shift</th><th rowspan="2">JOB</th><th colspan="2">Jam Hujan</th><th rowspan="2">Intensitas (mm)</th><th colspan="2">Slippery</th></tr>
        <tr><th>Mulai</th><th>Selesai</th><th>Mulai</th><th>Selesai</th></tr></thead>
        <tbody data-rainfall-area="${esc(area)}">${rows.map(rowMarkup).join('')}</tbody>
      </table></div>
    </article>`;
  }

  function updateSaveUi(message = '') {
    const count = dirtyRows().length;
    const button = document.getElementById('rainfallSaveButton');
    const status = document.getElementById('rainfallSaveStatus');
    if (button) {
      button.disabled = state.loading || count === 0;
      button.textContent = count ? `Simpan Data (${count})` : 'Simpan Data';
    }
    if (status) {
      status.textContent = message || (count ? `${count} baris belum disimpan.` : 'Semua perubahan tersimpan.');
      status.className = `rainfall-save-status ${count ? 'is-dirty' : 'is-saved'}`;
    }
  }

  function render() {
    const host = document.getElementById('rainfallTables');
    if (!host) return;
    if (!state.areas.length) {
      host.innerHTML = '<div class="rainfall-empty">Belum ada area. Isi kolom Lokasi pada List Equipment terlebih dahulu.</div>';
    } else if (!state.jobs.length) {
      host.innerHTML = '<div class="rainfall-empty">Belum ada JOB SPO berstatus Deployed. Deploy minimal satu tabel SPO terlebih dahulu.</div>';
    } else {
      host.innerHTML = state.areas.map(tableMarkup).join('');
    }
    updateSaveUi();
  }

  function findRow(key) { return state.rows.find(row => String(keyFor(row)) === String(key)); }
  function onFieldInput(event) {
    const input = event.target.closest('[data-rain-field]');
    if (!input) return;
    const rowElement = input.closest('[data-rainfall-row]');
    const row = findRow(rowElement?.dataset.rainfallRow);
    if (!row) return;
    let value = input.value;
    if (event.type === 'change' && input.dataset.rainField === 'intensity_mm' && String(value).trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        value = parsed.toFixed(1);
        input.value = value;
      }
    }
    row[input.dataset.rainField] = value;
    row._dirty = true;
    rowElement.classList.add('is-dirty');
    const areaRows = state.rows.filter(item => item.area_name === row.area_name);
    if (areaRows[areaRows.length - 1] === row && isTouched(row)) {
      const blank = newRow(row.area_name);
      state.rows.push(blank);
      rowElement.closest('tbody').insertAdjacentHTML('beforeend', rowMarkup(blank));
    }
    updateSaveUi();
  }

  function validateRow(row) {
    const missing = ['operational_date','shift_id','job_code'].filter(field => !String(row[field] || '').trim());
    if (missing.length) return 'Tanggal, Shift, dan JOB wajib diisi.';
    const rainAny = row.rain_start || row.rain_finish;
    const slipAny = row.slippery_start || row.slippery_finish;
    if (Boolean(row.rain_start) !== Boolean(row.rain_finish)) return 'Jam Hujan Mulai dan Selesai harus lengkap.';
    if (Boolean(row.slippery_start) !== Boolean(row.slippery_finish)) return 'Jam Slippery Mulai dan Selesai harus lengkap.';
    if (!rainAny && !slipAny) return 'Isi minimal satu interval Jam Hujan atau Slippery.';
    const intensityText = String(row.intensity_mm ?? '').trim();
    const intensityMm = Number(intensityText);
    if (rainAny && !intensityText) return 'Intensitas hujan (mm) wajib diisi untuk kejadian hujan.';
    if (intensityText && (!Number.isFinite(intensityMm) || intensityMm < 0)) return 'Intensitas hujan harus berupa angka non-negatif dalam mm.';
    return '';
  }

  async function save() {
    const rows = dirtyRows();
    if (!rows.length || state.loading) return;
    document.querySelectorAll('[data-rainfall-row].is-invalid').forEach(row => row.classList.remove('is-invalid'));
    for (const row of rows) {
      const error = validateRow(row);
      if (error) {
        document.querySelector(`[data-rainfall-row="${CSS.escape(String(keyFor(row)))}"]`)?.classList.add('is-invalid');
        updateSaveUi(`Periksa area ${row.area_name}: ${error}`);
        return;
      }
    }
    const saveButton = document.getElementById('rainfallSaveButton');
    const feedback = global.OMOSActionFeedback?.begin(saveButton, {
      loadingText: 'Menyimpan…',
      successText: 'Tersimpan',
      errorText: 'Gagal',
      resolveDisabled: () => dirtyRows().length === 0,
      onRestore: () => updateSaveUi(document.getElementById('rainfallSaveStatus')?.textContent || ''),
    });
    if (!feedback) return;
    state.loading = true;
    updateSaveUi('Menyimpan data...');
    let outcome = 'success';
    let detail = null;
    try {
      const response = await fetch(getProdApiUrl('/api/admin/production/rainfall/batch'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify({ year: state.year, month: state.month, rows: rows.map(row => Object.fromEntries(['id','area_name',...fields].map(field => [field, row[field] || null]))) })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      state.loading = false;
      await load();
      updateSaveUi(`${result.saved?.length || rows.length} baris berhasil disimpan.`);
    } catch (error) {
      outcome = 'error';
      detail = error;
      updateSaveUi(`Gagal menyimpan: ${error.message}`);
    } finally {
      state.loading = false;
      updateSaveUi(document.getElementById('rainfallSaveStatus')?.textContent || '');
      await feedback.finish(outcome, detail);
    }
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    const host = document.getElementById('rainfallTables');
    if (host) host.innerHTML = '<p class="tabel__kosong">Memuat data curah hujan...</p>';
    try {
      const response = await fetch(getProdApiUrl(`/api/admin/production/rainfall?year=${state.year}&month=${state.month}`), { headers: { ...getProdAuthHeaders() } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      state.areas = Array.isArray(data.areas) ? data.areas.sort((a,b) => String(a).localeCompare(String(b),'id-ID',{numeric:true})) : [];
      state.shifts = Array.isArray(data.shifts) ? data.shifts : [];
      state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
      state.rows = (Array.isArray(data.rows) ? data.rows : []).map(row => ({ ...row, intensity_mm: row.intensity_mm == null ? '' : Number(row.intensity_mm).toFixed(1), _key: row.id, _dirty: false }));
      state.areas.forEach(area => state.rows.push(newRow(area)));
      render();
    } catch (error) {
      if (host) host.innerHTML = `<div class="rainfall-empty is-error">Gagal memuat data: ${esc(error.message)}</div>`;
    } finally {
      state.loading = false;
      updateSaveUi();
    }
  }

  function populatePeriods() {
    const now = new Date();
    const yearSelect = document.getElementById('rainfallYear');
    const monthSelect = document.getElementById('rainfallMonth');
    if (!state.year) state.year = now.getFullYear();
    if (!state.month) state.month = now.getMonth() + 1;
    yearSelect.innerHTML = Array.from({length:8},(_,i)=>now.getFullYear()-2+i).map(year => `<option value="${year}"${selected(year,state.year)}>${year}</option>`).join('');
    monthSelect.innerHTML = monthNames.map((name,index) => `<option value="${index+1}"${selected(index+1,state.month)}>${name}</option>`).join('');
  }

  async function changePeriod() {
    if (dirtyRows().length && !global.confirm('Ada perubahan yang belum disimpan. Abaikan perubahan dan pindah periode?')) {
      document.getElementById('rainfallYear').value = String(state.year);
      document.getElementById('rainfallMonth').value = String(state.month);
      return;
    }
    state.year = Number(document.getElementById('rainfallYear').value);
    state.month = Number(document.getElementById('rainfallMonth').value);
    await load();
  }

  async function init() {
    if (!state.initialized) {
      state.initialized = true;
      populatePeriods();
      document.getElementById('rainfallTables')?.addEventListener('input', onFieldInput);
      document.getElementById('rainfallTables')?.addEventListener('change', onFieldInput);
      document.getElementById('rainfallSaveButton')?.addEventListener('click', save);
      document.getElementById('rainfallYear')?.addEventListener('change', changePeriod);
      document.getElementById('rainfallMonth')?.addEventListener('change', changePeriod);
      global.addEventListener('beforeunload', event => {
        if (!dirtyRows().length) return;
        event.preventDefault();
        event.returnValue = '';
      });
    }
    await load();
  }

  global.RainfallData = { init, save };
  if (typeof module !== 'undefined' && module.exports) module.exports = { isTouched, validateRow: row => validateRow(row) };
})(typeof window !== 'undefined' ? window : globalThis);
