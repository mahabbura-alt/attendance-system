/*
 * Survey Report — Volume by Survey per PIT (input manual).
 * Modul mandiri: slicer, tab PIT, KPI, tabel editable, total live,
 * Enter-navigasi, paste Excel, flag anomali, export, komparasi produksi.
 * Fungsi murni diekspor untuk regression test node.
 */
(function (global, factory) {
  const api = factory(global);
  if (global) global.SurveyReport = api.ui;
  if (typeof module === 'object' && module.exports) module.exports = api.pure;
})(typeof window !== 'undefined' ? window : globalThis, function createSurveyReport(global) {
  'use strict';

  const BASE = '/api/admin/production/survey-volumes';
  const PAGE_SIZE_ANOMALY_FACTOR = 2;

  /* ---------- murni ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function daysInMonth(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function cellKey(tanggal, pit, type, material) {
    return [tanggal, pit, type, material].join('||');
  }

  function fmtVol(value, digits = 2) {
    return Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: digits });
  }

  function numCell(value) {
    const v = Number(value);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }

  function sumRow(values) {
    return (values || []).reduce((s, v) => s + numCell(v), 0);
  }

  function median(values) {
    const nums = (values || []).map(Number).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!nums.length) return 0;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  }

  function isAnomaly(value, med, factor = PAGE_SIZE_ANOMALY_FACTOR) {
    const v = Number(value);
    return med > 0 && Number.isFinite(v) && v > med * factor;
  }

  function parseTsvPaste(text) {
    return String(text || '').replace(/\r\n/g, '\n').split('\n')
      .map(line => line.split('\t').map(cell => cell.trim()))
      .filter(cells => cells.some(cell => cell !== ''));
  }

  function buildExportName(year, month, format) {
    return `survey-volumes-${year}-${String(month).padStart(2, '0')}.${format}`;
  }

  function parseSurveyImportDate(raw) {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
    }
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 90000) {
      if (global?.XLSX?.SSF?.parse_date_code) {
        const parsed = global.XLSX.SSF.parse_date_code(raw);
        if (parsed && parsed.y && parsed.m && parsed.d) {
          return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
        }
      }
      const utcMs = Math.round((raw - 25569) * 86400 * 1000);
      const dt = new Date(utcMs);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toISOString().slice(0, 10);
      }
    }
    const text = String(raw ?? '').trim();
    if (!text || /^total/i.test(text)) return '';
    const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
    }
    const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (dmyMatch) {
      return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
    }
    return '';
  }

  function parseSurveyImportNumber(raw) {
    if (raw === '' || raw === null || raw === undefined) return NaN;
    if (typeof raw === 'number') return raw;
    const text = String(raw).trim().replace(/\s+/g, '');
    if (!text) return NaN;
    // Dukungan format ribuan & koma desimal Indonesia (mis. "1.250,5" atau "512,75")
    const normalized = text.includes(',') && text.includes('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(',', '.');
    return Number(normalized);
  }

  function buildTemplateSheetMatrix({ pit, year, month, materials, values }) {
    const obMats = (materials && materials.ob) || [];
    const coalMats = (materials && materials.coal) || [];
    const groups = [
      obMats.length ? { type: 'ob', title: 'Overburden Removal (BCM)', materials: obMats } : null,
      coalMats.length ? { type: 'coal', title: 'Coal Getting (Ton)', materials: coalMats } : null,
    ].filter(Boolean);

    const row0 = ['Tanggal'];
    const row1 = [''];
    const merges = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }];
    let colCursor = 1;
    groups.forEach(group => {
      const span = group.materials.length + 1;
      row0.push(group.title, ...Array(span - 1).fill(''));
      row1.push(...group.materials, 'Total');
      if (span > 1) {
        merges.push({ s: { r: 0, c: colCursor }, e: { r: 0, c: colCursor + span - 1 } });
      }
      colCursor += span;
    });

    const totalDays = daysInMonth(year, month);
    const monthSum = new Map();
    const dataRows = [];
    for (let d = 1; d <= totalDays; d += 1) {
      const tanggal = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const row = [tanggal];
      groups.forEach(group => {
        let groupSum = 0;
        group.materials.forEach(material => {
          const key = cellKey(tanggal, pit, group.type, material);
          const hasVal = values && typeof values.has === 'function' ? values.has(key) : false;
          const rawVal = hasVal ? values.get(key) : '';
          const hasFilled = hasVal && rawVal !== '' && rawVal !== null && rawVal !== undefined;
          const v = hasFilled ? numCell(rawVal) : '';
          if (v !== '') {
            groupSum += v;
            const mKey = `${group.type}||${material}`;
            monthSum.set(mKey, (monthSum.get(mKey) || 0) + v);
          }
          row.push(v);
        });
        const roundedGroupSum = Math.round(groupSum * 100) / 100;
        row.push(roundedGroupSum);
        const totalKey = `${group.type}||__total__`;
        monthSum.set(totalKey, (monthSum.get(totalKey) || 0) + groupSum);
      });
      dataRows.push(row);
    }

    const footerRow = ['Total Bulan'];
    groups.forEach(group => {
      group.materials.forEach(material => {
        const sumVal = monthSum.get(`${group.type}||${material}`) || 0;
        footerRow.push(Math.round(sumVal * 100) / 100);
      });
      const grpTotal = monthSum.get(`${group.type}||__total__`) || 0;
      footerRow.push(Math.round(grpTotal * 100) / 100);
    });

    const safePit = String(pit || 'PIT').replace(/[\\/?*[\]:]/g, '_').trim() || 'PIT';
    const sheetName = `PIT ${safePit}`.slice(0, 31);
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const filename = `OMOS_Template_Survey_Report_PIT_${safePit}_${ym}.xlsx`;
    const cols = [{ wch: 15 }, ...Array(Math.max(0, row1.length - 1)).fill({ wch: 14 })];

    return {
      sheetName,
      filename,
      aoa: [row0, row1, ...dataRows, footerRow],
      merges,
      cols,
    };
  }

  function parseSurveyImportMatrix(matrix, { pit, materials, existingValues } = {}) {
    if (!Array.isArray(matrix) || !matrix.length) {
      return { volumes: [], skipped: 0, invalid: 0 };
    }
    const obMats = (materials && materials.ob) || [];
    const coalMats = (materials && materials.coal) || [];
    const obLookup = new Map(obMats.map(m => [String(m).trim().toUpperCase(), m]));
    const coalLookup = new Map(coalMats.map(m => [String(m).trim().toUpperCase(), m]));

    // Cek apakah format flat (tanggal, pit_area, planning_type, material, volume)
    const flatHeaderIdx = matrix.findIndex(row => {
      if (!Array.isArray(row)) return false;
      const upper = row.map(c => String(c ?? '').trim().toUpperCase());
      return upper.includes('TANGGAL') && upper.includes('PIT_AREA') && upper.includes('PLANNING_TYPE') && upper.includes('MATERIAL');
    });
    if (flatHeaderIdx >= 0) {
      const hdr = matrix[flatHeaderIdx].map(c => String(c ?? '').trim().toUpperCase());
      const cTgl = hdr.indexOf('TANGGAL');
      const cPit = hdr.indexOf('PIT_AREA');
      const cType = hdr.indexOf('PLANNING_TYPE');
      const cMat = hdr.indexOf('MATERIAL');
      const cVol = hdr.findIndex(h => h.startsWith('VOLUME'));
      const volumes = [];
      let skipped = 0; let invalid = 0;
      for (let r = flatHeaderIdx + 1; r < matrix.length; r += 1) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        const tanggal = parseSurveyImportDate(row[cTgl]);
        const rowPit = String(row[cPit] || pit || '').trim();
        const type = String(row[cType] || '').trim().toLowerCase();
        const material = String(row[cMat] || '').trim();
        const rawVol = row[cVol];
        if (!tanggal || !rowPit || !material) {
          skipped += 1;
          continue;
        }
        if (rawVol === '' || rawVol === null || rawVol === undefined) {
          volumes.push({ tanggal, pit_area: rowPit, planning_type: type, material, volume: 0 });
          continue;
        }
        const num = parseSurveyImportNumber(rawVol);
        if (!Number.isFinite(num) || num < 0 || !['ob', 'coal'].includes(type)) {
          invalid += 1;
          continue;
        }
        volumes.push({ tanggal, pit_area: rowPit, planning_type: type, material, volume: num });
      }
      return { volumes, skipped, invalid };
    }

    // Format tabel halaman Survey Report (2-baris header grup + material atau 1-baris header material)
    let tanggalRowIdx = matrix.findIndex(row => Array.isArray(row) && String(row[0] ?? '').trim().toUpperCase() === 'TANGGAL');
    if (tanggalRowIdx < 0) tanggalRowIdx = 0;
    const rowA = matrix[tanggalRowIdx] || [];
    const rowB = matrix[tanggalRowIdx + 1] || [];
    const rowAHasGroupTitle = rowA.slice(1).some(c => /OVERBURDEN|COAL GETTING|\(BCM\)|\(TON\)/i.test(String(c ?? '')));
    const groupRow = rowAHasGroupTitle ? rowA : [];
    const matRow = rowAHasGroupTitle ? rowB : rowA;
    const dataStartIdx = rowAHasGroupTitle ? tanggalRowIdx + 2 : tanggalRowIdx + 1;

    const colBindings = [];
    let currentGroupType = obMats.length ? 'ob' : 'coal';
    for (let c = 1; c < matRow.length; c += 1) {
      const grpText = String(groupRow[c] ?? '').trim().toUpperCase();
      if (grpText.includes('COAL')) currentGroupType = 'coal';
      else if (grpText.includes('OVERBURDEN') || /\bOB\b/.test(grpText)) currentGroupType = 'ob';

      const rawMat = String(matRow[c] ?? '').trim();
      const upperMat = rawMat.toUpperCase();
      if (!rawMat || upperMat === 'TOTAL' || upperMat === 'TOTAL BULAN') {
        if (upperMat === 'TOTAL' && !groupRow.length && currentGroupType === 'ob') {
          currentGroupType = 'coal';
        }
        continue;
      }

      let resolvedType = currentGroupType;
      let resolvedMat = rawMat;
      if (currentGroupType === 'ob' && obLookup.has(upperMat)) {
        resolvedType = 'ob';
        resolvedMat = obLookup.get(upperMat);
      } else if (currentGroupType === 'coal' && coalLookup.has(upperMat)) {
        resolvedType = 'coal';
        resolvedMat = coalLookup.get(upperMat);
      } else if (obLookup.has(upperMat)) {
        resolvedType = 'ob';
        resolvedMat = obLookup.get(upperMat);
      } else if (coalLookup.has(upperMat)) {
        resolvedType = 'coal';
        resolvedMat = coalLookup.get(upperMat);
      }
      colBindings.push({ colIndex: c, type: resolvedType, material: resolvedMat });
    }

    const volumes = [];
    let skipped = 0;
    let invalid = 0;
    const targetPit = String(pit || '').trim();
    const hasExistingMap = existingValues && typeof existingValues.has === 'function';

    for (let r = dataStartIdx; r < matrix.length; r += 1) {
      const row = matrix[r];
      if (!Array.isArray(row)) continue;
      const firstCell = String(row[0] ?? '').trim();
      if (!firstCell || /^total/i.test(firstCell)) continue;
      const tanggal = parseSurveyImportDate(row[0]);
      if (!tanggal) {
        skipped += 1;
        continue;
      }
      for (const binding of colBindings) {
        const rawVal = row[binding.colIndex];
        const key = cellKey(tanggal, targetPit, binding.type, binding.material);
        if (rawVal === '' || rawVal === null || rawVal === undefined) {
          if (hasExistingMap && existingValues.has(key)) {
            volumes.push({
              tanggal,
              pit_area: targetPit,
              planning_type: binding.type,
              material: binding.material,
              volume: 0,
            });
          }
          continue;
        }
        const num = parseSurveyImportNumber(rawVal);
        if (!Number.isFinite(num) || num < 0) {
          invalid += 1;
          continue;
        }
        volumes.push({
          tanggal,
          pit_area: targetPit,
          planning_type: binding.type,
          material: binding.material,
          volume: num,
        });
      }
    }

    return { volumes, skipped, invalid };
  }

  /* ---------- browser ---------- */

  const state = {
    dibuka: false, year: null, month: null, materials: { ob: [], coal: [] },
    pits: [], values: new Map(), dirty: new Set(), activePit: null, comparison: [], jobs: [],
  };

  function apiUrl(path) {
    if (typeof global.getProdApiUrl === 'function') return global.getProdApiUrl(path);
    throw new Error('API produksi belum tersedia.');
  }

  function authHeaders() {
    if (typeof global.getProdAuthHeaders === 'function') return global.getProdAuthHeaders();
    return {};
  }

  async function fwGet(path) {
    const res = await fetch(apiUrl(path), { headers: { ...authHeaders() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function currentPeriod() {
    const now = new Date();
    return {
      year: Number(document.getElementById('svTahun')?.value || state.year || now.getFullYear()),
      month: Number(document.getElementById('svBulan')?.value || state.month || (now.getMonth() + 1)),
    };
  }

  function sectionUnit(type) {
    return type === 'coal' ? 'Ton' : 'BCM';
  }

  function visiblePits() {
    return state.activePit && state.pits.includes(state.activePit) ? [state.activePit] : [];
  }

  function renderSlicers(host) {
    const now = new Date();
    const years = [];
    for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y += 1) years.push(y);
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const tabs = state.pits.map(p => {
      const label = `PIT ${p}`;
      return `<button type="button" class="sv-tab${state.activePit === p ? ' is-active' : ''}" data-sv-pit="${esc(p)}">${esc(label)}</button>`;
    }).join('');
    return `<div class="sv-filterbar">
      <label>Tahun<br><select id="svTahun" class="input-filter">${years.map(y => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
      <label>Bulan<br><select id="svBulan" class="input-filter">${months.map((label, i) => `<option value="${i + 1}"${i + 1 === state.month ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <button id="btnSimpanSurvey" class="tombol tombol--utama">Simpan</button>
      <button type="button" class="tombol tombol--ghost" id="btnDownloadTemplateSurvey">📥 Download Template</button>
      <button type="button" class="tombol tombol--ghost" id="btnImportExcelSurvey">📤 Import Excel</button>
      <input type="file" id="svImportExcelInput" accept=".xlsx,.xls,.csv" hidden />
    </div>
    <div class="sv-pittabs">${tabs || '<span class="sv-empty-pit">Belum ada PIT aktif pada master produksi.</span>'}</div>
    <p class="sv-source-note">PIT mengikuti Master PIT produksi. Kolom material hanya ditampilkan untuk JOB berklasifikasi <b>Prod</b> pada SPO.</p>
    <div class="sv-kpis" id="svKpis"></div>`;
  }

  function renderKpis() {
    const el = document.getElementById('svKpis');
    if (!el) return;
    let ob = 0; let coal = 0; let filled = 0;
    state.values.forEach((v, key) => {
      const parts = String(key).split('||');
      if (parts[1] !== state.activePit) return;
      if (parts[2] === 'ob') ob += v; else coal += v;
      if (v > 0) filled += 1;
    });
    el.innerHTML = `
      <article><small>Total OB</small><b>${esc(fmtVol(ob))} BCM</b><span>Overburden Removal bulan ini</span></article>
      <article><small>Total Coal</small><b>${esc(fmtVol(coal))} Ton</b><span>Coal Getting bulan ini</span></article>
      <article><small>PIT Terpilih</small><b>${esc(state.activePit || '—')}</b><span>input dan total pada PIT ini</span></article>
      <article><small>Sel Terisi</small><b>${filled}</b><span>dari input manual</span></article>`;
  }

  function renderTables(host) {
    const wrap = document.getElementById('svTables');
    if (!wrap) return;
    const obMats = state.materials.ob || [];
    const coalMats = state.materials.coal || [];
    if (!obMats.length && !coalMats.length) {
      wrap.innerHTML = '<p class="tabel__kosong">Belum ada material untuk JOB berstatus Prod di SPO. Periksa klasifikasi JOB dan parameter material pada 0.5 / 0.6 Productivity Planning.</p>';
      return;
    }
    const pits = visiblePits();
    if (!pits.length) {
      wrap.innerHTML = '<p class="tabel__kosong">Belum ada PIT aktif pada Master PIT produksi.</p>';
      return;
    }
    wrap.innerHTML = pits.map(pit => {
      const dates = [];
      for (let d = 1; d <= daysInMonth(state.year, state.month); d += 1) {
        dates.push(`${state.year}-${String(state.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
      const groups = [
        obMats.length ? { type: 'ob', title: 'Overburden Removal', unit: 'BCM', materials: obMats } : null,
        coalMats.length ? { type: 'coal', title: 'Coal Getting', unit: 'Ton', materials: coalMats } : null,
      ].filter(Boolean);
      const colgroupHtml = groups.map(group => (
        `${group.materials.map(() => '<col class="sv-numbercol">').join('')}<col class="sv-totalcol">`
      )).join('');
      const rows = dates.map(tanggal => {
        const groupCells = groups.map(group => {
          const cells = group.materials.map(material => {
            const key = cellKey(tanggal, pit, group.type, material);
            const val = state.values.has(key) ? state.values.get(key) : '';
            const dirtyCls = state.dirty.has(key) ? ' class="sv-dirty"' : '';
            return `<td><input type="number" min="0" step="0.01"${dirtyCls} value="${val === '' ? '' : esc(val)}" data-sv-cell="${esc(key)}" aria-label="${esc(`${tanggal} ${pit} ${material}`)}" /></td>`;
          }).join('');
          const total = `<td class="is-number sv-rowtotal sv-${group.type}" data-sv-rowtotal="${esc(`${tanggal}||${pit}||${group.type}`)}">0</td>`;
          return `${cells}${total}`;
        }).join('');
        return `<tr><td class="sv-date"><b>${esc(tanggal)}</b></td>${groupCells}</tr>`;
      }).join('');
      const firstHeader = groups.map(group => `<th colspan="${group.materials.length + 1}" class="sv-${group.type}" scope="colgroup">${group.title} (${group.unit})</th>`).join('');
      const secondHeader = groups.map(group => `${group.materials.map(material => `<th class="sv-${group.type}" scope="col">${esc(material)}</th>`).join('')}<th class="sv-${group.type}" scope="col">Total</th>`).join('');
      const footerGroupCells = groups.map(group => {
        const footerCells = group.materials.map(material => `<td class="is-number sv-monthcell" data-sv-monthcell="${esc(`${pit}||${group.type}||${material}`)}">0</td>`).join('');
        const footerTotal = `<td class="is-number sv-monthcell sv-${group.type}" data-sv-monthtotal="${esc(`${pit}||${group.type}`)}">0</td>`;
        return `${footerCells}${footerTotal}`;
      }).join('');
      return `<section class="sv-pit" data-sv-pitsection="${esc(pit)}">
        <header><b>PIT ${esc(pit)}</b></header>
        <div class="sv-scroll"><table class="sv-table">
          <colgroup><col class="sv-datecol">${colgroupHtml}</colgroup>
          <thead><tr><th rowspan="2" scope="col">Tanggal</th>${firstHeader}</tr>
            <tr>${secondHeader}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td><b>Total Bulan</b></td>${footerGroupCells}</tr></tfoot>
        </table></div>
      </section>`;
    }).join('');
    bindInputs(wrap);
    recalcAll();
  }

  function columnValues(pit, type, material) {
    const vals = [];
    document.querySelectorAll('#svTables input[data-sv-cell]').forEach(input => {
      const key = input.dataset.svCell || '';
      const parts = key.split('||');
      if (parts[1] === pit && parts[2] === type && parts[3] === material) vals.push(numCell(input.value));
    });
    return vals;
  }

  function refreshAnomalies() {
    document.querySelectorAll('#svTables input[data-sv-cell]').forEach(input => {
      const parts = String(input.dataset.svCell || '').split('||');
      const med = median(columnValues(parts[1], parts[2], parts[3]));
      input.classList.toggle('sv-anomaly', isAnomaly(input.value, med));
      if (isAnomaly(input.value, med)) input.title = `Anomali: >2× median kolom (${fmtVol(med)})`;
      else input.removeAttribute('title');
    });
  }

  function recalcAll() {
    const host = document.getElementById('svTables');
    if (!host) return;
    const monthSum = new Map();
    host.querySelectorAll('section.sv-pit').forEach(section => {
      const pit = section.dataset.svPitsection;
      section.querySelectorAll('tbody tr').forEach(row => {
        const perType = { ob: 0, coal: 0 };
        row.querySelectorAll('input[data-sv-cell]').forEach(input => {
          const parts = String(input.dataset.svCell || '').split('||');
          const v = numCell(input.value);
          perType[parts[2]] = (perType[parts[2]] || 0) + v;
          const mkey = `${pit}||${parts[2]}||${parts[3]}`;
          monthSum.set(mkey, (monthSum.get(mkey) || 0) + v);
        });
        row.querySelectorAll('td.sv-rowtotal').forEach(cell => {
          const parts = String(cell.dataset.svRowtotal || '').split('||');
          cell.textContent = fmtVol(perType[parts[2]] || 0);
        });
      });
    });
    // footer per kolom material + total seksi
    host.querySelectorAll('section.sv-pit').forEach(section => {
      const pit = section.dataset.svPitsection;
      section.querySelectorAll('[data-sv-monthcell]').forEach(cell => {
        cell.textContent = fmtVol(monthSum.get(cell.dataset.svMonthcell) || 0);
      });
      section.querySelectorAll('[data-sv-monthtotal]').forEach(cell => {
        const [, type] = String(cell.dataset.svMonthtotal || '').split('||');
        let total = 0;
        monthSum.forEach((value, key) => {
          const parts = String(key).split('||');
          if (parts[0] === pit && parts[1] === type) total += value;
        });
        cell.textContent = fmtVol(total);
      });
    });
    renderKpis();
    refreshAnomalies();
  }

  function bindInputs(wrap) {
    wrap.querySelectorAll('input[data-sv-cell]').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.svCell;
        state.dirty.add(key);
        if (String(input.value).trim() === '') state.values.delete(key);
        else state.values.set(key, numCell(input.value));
        input.classList.add('sv-dirty');
        updateSaveButton();
        recalcAll();
      });
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const inputs = [...wrap.querySelectorAll('input[data-sv-cell]')];
        const idx = inputs.indexOf(input);
        if (idx < 0) return;
        const cols = input.closest('tr')?.querySelectorAll('input[data-sv-cell]').length || 1;
        const next = event.key === 'ArrowUp' ? inputs[idx - cols] : inputs[idx + cols];
        if (next) next.focus();
      });
      input.addEventListener('paste', event => {
        const text = (event.clipboardData || window.clipboardData)?.getData('text');
        if (!text || !text.includes('\t')) return;
        event.preventDefault();
        const grid = parseTsvPaste(text);
        const all = [...wrap.querySelectorAll('input[data-sv-cell]')];
        const start = all.indexOf(input);
        if (start < 0) return;
        const cols = input.closest('tr')?.querySelectorAll('input[data-sv-cell]').length || 1;
        grid.forEach((line, r) => line.forEach((val, c) => {
          const target = all[start + r * cols + c];
          if (!target || val === '') return;
          const num = Number(String(val).replace(/[^0-9.,-]/g, '').replace(',', '.'));
          if (!Number.isFinite(num) || num < 0) return;
          target.value = num;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }));
      });
    });
  }

  function updateSaveButton() {
    const button = document.getElementById('btnSimpanSurvey');
    if (!button) return;
    button.disabled = false;
    button.textContent = state.dirty.size ? `Simpan (${state.dirty.size})` : 'Simpan';
  }

  function markClean() {
    state.dirty.clear();
    document.querySelectorAll('#svTables input.sv-dirty').forEach(i => i.classList.remove('sv-dirty'));
    updateSaveButton();
  }

  async function loadPeriod(year, month) {
    const [main, cmp] = await Promise.all([
      fwGet(`${BASE}?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`),
      fwGet(`${BASE}/comparison?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`).catch(() => ({ rows: [] })),
    ]);
    state.year = main.year; state.month = main.month;
    state.materials = main.materials || { ob: [], coal: [] };
    state.pits = main.pits || [];
    state.values = new Map(
      (main.volumes || [])
        .filter(v => Number(v.volume) > 0)
        .map(v => [cellKey(v.tanggal, v.pit_area, v.planning_type, v.material), Number(v.volume)])
    );
    state.comparison = ((cmp && cmp.rows) || []).filter(r => Number(r.survey) > 0 || Number(r.production) > 0);
    state.jobs = main.jobs || [];
    state.dirty = new Set();
    if (!state.pits.includes(state.activePit)) state.activePit = state.pits[0] || null;
  }

  function renderComparison(host) {
    const old = document.getElementById('svCompare');
    if (old) old.remove();
    if (!state.comparison.length) return;
    const byPit = new Map();
    for (const r of state.comparison) {
      if (r.pit_area !== state.activePit) continue;
      if (!byPit.has(r.pit_area)) byPit.set(r.pit_area, []);
      byPit.get(r.pit_area).push(r);
    }
    const sections = [...byPit.entries()].map(([pit, rows]) => {
      const trs = rows.map(r => {
        const tone = (r.selisih || 0) === 0 ? '' : (r.selisih > 0 ? 'color:#15803d;' : 'color:#b91c1c;');
        return `<tr><td>${esc(r.tanggal)}</td><td>${esc(r.material)}</td><td class="is-number">${esc(fmtVol(r.survey))}</td><td class="is-number">${esc(fmtVol(r.production))}</td><td class="is-number" style="font-weight:800;${tone}">${esc(fmtVol(r.selisih))}</td></tr>`;
      }).join('');
      return `<section class="sv-pit"><header><b>Selisih vs Produksi Ritase (Net) — PIT ${esc(pit)}</b></header>
        <div class="sv-scroll"><table class="sv-table"><thead><tr><th>Tanggal</th><th>Material</th><th>Survey</th><th>Produksi</th><th>Selisih</th></tr></thead><tbody>${trs}</tbody></table></div></section>`;
    }).join('');
    host.insertAdjacentHTML('beforeend', `<div id="svCompare">${sections}</div>`);
  }

  const ui = {
    async open() {
      const host = document.getElementById('surveyReportRoot');
      if (!host) return;
      host.innerHTML = '<p class="tabel__kosong">Memuat volume survey…</p>';
      try {
        const now = new Date();
        await loadPeriod(state.year || now.getFullYear(), state.month || (now.getMonth() + 1));
        host.innerHTML = '<div id="svShell"></div><div id="svTables"></div>';
        document.getElementById('svShell').innerHTML = renderSlicers();
        bindShell();
        renderTables();
        renderComparison(host);
      } catch (error) {
        host.innerHTML = `<p class="tabel__kosong teks-error">Gagal memuat volume survey: ${esc(error.message)}</p>`;
      }
    },
    async refresh() {
      const p = currentPeriod();
      const host = document.getElementById('surveyReportRoot');
      if (!host) return;
      host.innerHTML = '<p class="tabel__kosong">Memuat volume survey…</p>';
      try {
        await loadPeriod(p.year, p.month);
        host.innerHTML = '<div id="svShell"></div><div id="svTables"></div>';
        document.getElementById('svShell').innerHTML = renderSlicers();
        bindShell();
        renderTables();
        renderComparison(host);
      } catch (error) {
        host.innerHTML = `<p class="tabel__kosong teks-error">Gagal memuat volume survey: ${esc(error.message)}</p>`;
      }
    },
  };

  async function ensureXlsx() {
    if (global?.XLSX) return global.XLSX;
    if (typeof global?.OMOSLoadLibrary === 'function') {
      return global.OMOSLoadLibrary('xlsx');
    }
    throw new Error('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
  }

  async function downloadTemplate() {
    try {
      if (!state.activePit) {
        alert('Belum ada PIT aktif untuk diunduh templatenya.');
        return;
      }
      const XLSX = await ensureXlsx();
      // Sinkronkan nilai input DOM saat ini ke state.values agar data yang muncul di halaman terekspor utuh
      document.querySelectorAll('#svTables input[data-sv-cell]').forEach(input => {
        const key = input.dataset.svCell;
        if (!key) return;
        if (String(input.value).trim() !== '') {
          state.values.set(key, numCell(input.value));
        } else {
          state.values.delete(key);
        }
      });

      const tpl = buildTemplateSheetMatrix({
        pit: state.activePit,
        year: state.year,
        month: state.month,
        materials: state.materials,
        values: state.values,
      });

      const sheet = XLSX.utils.aoa_to_sheet(tpl.aoa);
      sheet['!merges'] = tpl.merges;
      sheet['!cols'] = tpl.cols;
      sheet['!freeze'] = { xSplit: 1, ySplit: 2 };

      const guide = XLSX.utils.aoa_to_sheet([
        ['PETUNJUK TEMPLATE & IMPORT SURVEY REPORT OMOS'],
        ['PIT', String(state.activePit)],
        ['Periode', `${state.year}-${String(state.month).padStart(2, '0')}`],
        ['Kolom Material', 'Isi angka volume (>= 0) pada kolom material Overburden Removal (BCM) atau Coal Getting (Ton).'],
        ['Kolom Total & Total Bulan', 'Kolom Total dan baris Total Bulan dihitung otomatis oleh sistem dan diabaikan saat Import Excel.'],
        ['Catatan', 'Jangan mengubah urutan atau nama header material pada baris ke-2 agar pencocokan berjalan akurat.'],
      ]);
      guide['!cols'] = [{ wch: 26 }, { wch: 95 }];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, tpl.sheetName);
      XLSX.utils.book_append_sheet(workbook, guide, 'Petunjuk');
      XLSX.writeFile(workbook, tpl.filename);
    } catch (error) {
      alert(`Gagal mengunduh template: ${error.message}`);
    }
  }

  async function importExcelFile(file) {
    if (!file) return;
    const importBtn = document.getElementById('btnImportExcelSurvey');
    const fileInput = document.getElementById('svImportExcelInput');
    try {
      if (importBtn) {
        importBtn.disabled = true;
        importBtn.textContent = '⏳ Mengimpor…';
      }
      const XLSX = await ensureXlsx();
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true });
      const dataSheetNames = (workbook.SheetNames || []).filter(n => !/^petunjuk$/i.test(String(n).trim()));
      if (!dataSheetNames.length) {
        throw new Error('File Excel tidak memiliki sheet data Survey Report.');
      }

      const pitLookup = new Map((state.pits || []).map(p => [String(p).trim().toUpperCase(), p]));
      const allVolumes = [];
      let totalInvalid = 0;

      for (const sheetName of dataSheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        let sheetPit = state.activePit || state.pits[0] || '';
        const pitMatch = String(sheetName).trim().match(/^PIT\s+(.+)$/i);
        if (pitMatch) {
          const candidate = pitMatch[1].trim().toUpperCase();
          if (pitLookup.has(candidate)) sheetPit = pitLookup.get(candidate);
        }
        const parsed = parseSurveyImportMatrix(matrix, {
          pit: sheetPit,
          year: state.year,
          month: state.month,
          materials: state.materials,
          existingValues: state.values,
        });
        allVolumes.push(...parsed.volumes);
        totalInvalid += parsed.invalid;
      }

      // Terapkan langsung ke tabel di halaman & tandai dirty
      allVolumes.forEach(item => {
        const key = cellKey(item.tanggal, item.pit_area, item.planning_type, item.material);
        const vol = Number(item.volume) || 0;
        if (vol > 0) state.values.set(key, vol);
        else state.values.delete(key);
        state.dirty.add(key);
      });
      renderTables();
      updateSaveButton();

      if (!allVolumes.length) {
        markClean();
        alert('Import Excel selesai (seluruh kolom kosong tersimpan).');
        return;
      }

      // Simpan langsung ke backend agar tersinkronisasi penuh
      const res = await fetch(apiUrl(`${BASE}/batch`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ volumes: allVolumes }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);

      markClean();
      alert(`Import Excel berhasil: ${result.saved ?? allVolumes.length} sel volume survey berhasil diimpor dan disimpan${totalInvalid ? ` (${totalInvalid} sel tidak valid diabaikan)` : ''}.`);
      await ui.refresh();
    } catch (error) {
      alert(`Import Excel gagal: ${error.message}`);
    } finally {
      if (fileInput) fileInput.value = '';
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.textContent = '📤 Import Excel';
      }
    }
  }

  function bindShell() {
    document.getElementById('svTahun')?.addEventListener('change', () => ui.refresh());
    document.getElementById('svBulan')?.addEventListener('change', () => ui.refresh());
    document.querySelectorAll('[data-sv-pit]').forEach(btn => btn.addEventListener('click', () => {
      state.activePit = btn.dataset.svPit;
      document.getElementById('svShell').innerHTML = renderSlicers();
      bindShell();
      renderTables();
      const host = document.getElementById('surveyReportRoot');
      if (host) renderComparison(host);
    }));
    const dlTplBtn = document.getElementById('btnDownloadTemplateSurvey');
    if (dlTplBtn) dlTplBtn.addEventListener('click', () => downloadTemplate());
    const impBtn = document.getElementById('btnImportExcelSurvey');
    const impInput = document.getElementById('svImportExcelInput');
    if (impBtn && impInput) {
      impBtn.addEventListener('click', () => {
        impInput.value = '';
        impInput.click();
      });
      impInput.addEventListener('change', () => {
        const file = impInput.files && impInput.files[0];
        if (file) importExcelFile(file);
      });
    }
    document.querySelectorAll('[data-sv-export]').forEach(btn => btn.addEventListener('click', () => {
      const format = btn.dataset.svExport === 'xlsx' ? 'xlsx' : 'csv';
      const url = apiUrl(`${BASE}/export?year=${state.year}&month=${state.month}&format=${format}`);
      const headers = authHeaders();
      fetch(url, { headers }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      }).then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = buildExportName(state.year, state.month, format);
        document.body.appendChild(a);
        a.click();
        a.remove();
      }).catch(error => alert(`Export gagal: ${error.message}`));
    }));
    const saveBtn = document.getElementById('btnSimpanSurvey');
    if (saveBtn) saveBtn.addEventListener('click', () => saveAll(saveBtn));
    updateSaveButton();
  }

  async function saveAll(button) {
    const host = document.getElementById('surveyReportRoot');
    const seen = new Set();
    const volumes = [];
    host?.querySelectorAll('input[data-sv-cell]').forEach(input => {
      const key = input.dataset.svCell;
      if (!state.dirty.has(key)) return;
      seen.add(key);
      const parts = String(key).split('||');
      const raw = String(input.value).trim();
      const vol = raw === '' ? 0 : numCell(raw);
      volumes.push({ tanggal: parts[0], pit_area: parts[1], planning_type: parts[2], material: parts[3], volume: vol });
    });
    state.dirty.forEach(key => {
      if (seen.has(key)) return;
      const parts = String(key).split('||');
      const vol = state.values.has(key) ? numCell(state.values.get(key)) : 0;
      volumes.push({ tanggal: parts[0], pit_area: parts[1], planning_type: parts[2], material: parts[3], volume: vol });
    });
    if (!volumes.length) {
      markClean();
      alert('Data volume survey tersimpan.');
      return;
    }
    const fb = (typeof global.OMOSActionFeedback === 'object' && global.OMOSActionFeedback)
      ? global.OMOSActionFeedback.begin(button, { loadingText: `Menyimpan ${volumes.length} sel…`, resolveDisabled: () => true, onRestore: () => {} })
      : null;
    let completed = false;
    try {
      const res = await fetch(apiUrl(`${BASE}/batch`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ volumes }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
      completed = true;
      markClean();
      alert(`${result.saved} sel volume survey tersimpan.`);
      await ui.refresh();
    } catch (error) {
      alert(`Gagal menyimpan: ${error.message}`);
    } finally {
      if (fb) await fb.finish(completed ? 'success' : 'error', {});
    }
  }

  return {
    pure: {
      esc, daysInMonth, cellKey, fmtVol, numCell, sumRow, median, isAnomaly,
      parseTsvPaste, buildExportName, sectionUnit,
      parseSurveyImportDate, parseSurveyImportNumber, buildTemplateSheetMatrix, parseSurveyImportMatrix,
    },
    ui,
  };
});
