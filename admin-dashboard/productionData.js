(function (global) {
  'use strict';
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const num = (value, digits = 2) => value == null ? '—' : Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const s = { report: null, request: 0, renderToken: 0, initialized: false, selectedArea: '', fuelJobFilter: '', draft: null, bulk: null, manualDraft: {}, busy: false };
  const root = () => document.getElementById('productionDataRoot');
  const metrics = [ ['fuel','FUEL CONSUMPT','L',2], ['fuelRatio','FUEL RATIO','L/BCM',3],
    ['rainMm','INTENSITAS HUJAN','mm',1], ['rainMinutes','DURASI HUJAN','jam',2], ['slipperyMinutes','SLIPPERY','jam',2] ];
  const metricValue = (cell, field) => field.endsWith('Minutes') && cell[field] != null ? cell[field] / 60 : cell[field];

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const response = await fetch(getProdApiUrl(`/api/admin/production${path}`), {
      ...options, headers: { ...getProdAuthHeaders(), 'Content-Type': 'application/json' },
      cache: method === 'GET' ? 'no-cache' : 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Permintaan gagal.');
    return data;
  }
  function setStatus(message, state = 'success') {
    const node = document.getElementById('pdStatus');
    global.OMOSActionFeedback.status(node, state, message);
  }
  function toolbar() {
    const date = new Date();
    root().innerHTML = `<header class="pd-toolbar"><div><h2>Data Produksi</h2><p>Rekap bulanan per area, JOB, material, dan shift operasional.</p></div>
      <div class="pd-controls"><label>Tahun<input id="pdYear" type="number" min="2000" max="2100" value="${date.getFullYear()}"></label>
      <label>Bulan<select id="pdMonth">${months.map((m, i) => `<option value="${i + 1}" ${i === date.getMonth() ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
<button class="tombol" data-pd-action="reload">Perbarui</button><button class="tombol" data-pd-action="export" disabled>Ekspor Excel</button>
       <button class="tombol tombol--utama pd-save-manual" data-pd-action="save-manual" disabled>Simpan</button>
       <span id="pdManualSaveState" class="pd-save-state" aria-live="polite">Tersimpan</span></div></header>
      <div id="pdStatus" role="status" aria-live="polite"></div><nav id="pdTabs" class="pd-tabs" aria-label="Area Data Produksi"></nav><div id="pdSummary" class="pd-summary"></div>
      <div id="pdTables"></div><div id="pdQueue"></div><dialog id="pdDialog" class="pd-dialog"></dialog>`;
  }
  function options(items, selected, isJob = false) {
    return `<option value="">Pilih ${isJob ? 'JOB' : 'area'}</option>` + items.map(item => {
      const value = isJob ? item.jobCode : item;
      return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}${isJob ? ` · ${esc(item.jobDescription)}` : ''}</option>`;
    }).join('');
  }
  function manualSource(areaIndex, jobCode) {
    const src = s.report?.manualSources?.find(x => x.area === s.report.tables[areaIndex].area && x.jobCode === jobCode);
    return src ? src.source : 'ritase';
  }
  function header(jobs, areaIndex) {
    return `<thead><tr><th rowspan="2" class="pd-date">Tanggal</th><th rowspan="2" class="pd-shift">Shift</th>
      ${jobs.map(j => `<th class="pd-job" colspan="${j.materials.length + 2}">${esc(j.jobCode)} · ${esc(j.jobDescription)}
        <button class="pd-gear ${manualSource(areaIndex, j.jobCode) === 'manual' ? 'pd-gear--manual' : ''}" data-pd-source="${esc(j.jobCode)}" data-pd-source-area="${areaIndex}" title="Pilih sumber data ${esc(j.jobCode)}" aria-label="Pilih sumber data ${esc(j.jobCode)}">⚙</button></th>`).join('')}
      ${metrics.map((m, i) => `<th colspan="${jobs.length + (i < 2 ? 1 : 0)}">${m[1]} (${m[2]})</th>`).join('')}<th rowspan="2">Keterangan</th></tr><tr>
      ${jobs.map(j => `${j.materials.map(m => `<th>${esc(m.name)}<small>${esc(m.unit)}</small></th>`).join('')}<th>Total ${esc(j.unit)}</th><th>Jarak (km)</th>`).join('')}
      ${metrics.map((m, i) => jobs.map(j => `<th>${esc(j.jobCode)}</th>`).join('') + (i < 2 ? '<th>ALL</th>' : '')).join('')}</tr></thead>`;
  }
  function rowValues(values, jobs, all) {
    const output = [];
    for (const job of jobs) {
      const c = values[job.jobCode];
      job.materials.forEach(m => output.push(c.materials[m.name] ?? null));
      output.push(job.unit === 'mixed' ? null : c.production, c.distanceKm);
    }
    for (const [field] of metrics) {
      jobs.forEach(j => output.push(metricValue(values[j.jobCode], field)));
      if (field === 'fuel' || field === 'fuelRatio') output.push(all[field]);
    }
    return output;
  }
  function dataCells(values, jobs, context, all) {
    const content = [];
    for (const job of jobs) {
      const c = values[job.jobCode];
      const editable = context && manualSource(context.area, job.jobCode) === 'manual';
      for (const m of job.materials) {
        content.push(editable
          ? `<td class="pd-production">${manualCellInput(context, job.jobCode, m.name, c.materials[m.name])}</td>`
          : `<td class="pd-production">${num(c.materials[m.name])}</td>`);
      }
      if (context) {
        const totalHtml = editable
          ? manualTotalInput(context, job.jobCode)
          : `<button class="pd-cell-button" data-pd-detail="${esc(JSON.stringify({ ...context, job: job.jobCode }))}" title="Lihat sumber perhitungan">${job.unit === 'mixed' ? '—' : num(c.production)}</button>`;
        content.push(`<td class="pd-total">${totalHtml}</td><td>${num(c.distanceKm, 3)}</td>`);
      } else {
        content.push(`<td class="pd-total">${num(job.unit === 'mixed' ? null : c.production)}</td><td>${num(c.distanceKm, 3)}</td>`);
      }
    }
    for (const [field, , , digits] of metrics) {
      jobs.forEach(j => content.push(`<td>${num(metricValue(values[j.jobCode], field), digits)}</td>`));
      if (field === 'fuel' || field === 'fuelRatio') content.push(`<td class="pd-total">${num(all[field], digits)}</td>`);
    }
    const notes = [...new Set(Object.values(values).flatMap(c => c.notes))];
    content.push(`<td class="pd-notes">${esc(notes.join('; ')) || '—'}</td>`);
    return content.join('');
  }
  function tableMarkup(table, r) {
    const index = r.tables.indexOf(table);
    return `<article class="pd-area"><header><h3>${esc(table.area)}</h3><span>${months[r.period.month - 1]} ${r.period.year} · ${r.jobs.length} JOB</span></header>
      <div class="pd-scroll" tabindex="0" aria-label="Tabel Data Produksi ${esc(table.area)}. Geser untuk melihat semua kolom."><table class="pd-table">${header(r.jobs, index)}
      <tbody>${table.rows.map((row, rowIndex) => `<tr><th class="pd-date">${esc(row.date.slice(8))} ${months[r.period.month - 1].slice(0, 3)}</th><th class="pd-shift">${esc(row.shift.replace(/^Shift\s*/i, ''))}</th>${dataCells(row.values, r.jobs, { area: index, row: rowIndex }, row.all)}</tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="2">TOTAL BULAN</th>${dataCells(table.totals, r.jobs, null, table.totalAll)}</tr></tfoot></table></div></article>`;
  }
  function renderTabs() {
    const tabs = [...s.report.areas.map(area => ({ id: area, label: area })), { id: 'fuel', label: 'ALOKASI FUEL' }];
    document.getElementById('pdTabs').innerHTML = tabs.map(tab => `<button type="button" data-pd-tab="${esc(tab.id)}" class="${s.selectedArea === tab.id ? 'is-active' : ''} ${tab.id === 'fuel' ? 'is-fuel' : ''}" aria-selected="${s.selectedArea === tab.id}">${esc(tab.label)}${tab.id !== 'fuel' && manualDirtyCount(tab.id) ? `<small>${manualDirtyCount(tab.id)}</small>` : ''}</button>`).join('');
  }
  function summaryCards(cards) {
    const tones = ['blue', 'cyan', 'amber', 'green', 'violet', 'rose'];
    return cards.map(([label, value, unit], index) => `<div class="pd-summary-card pd-summary-card--${tones[index % tones.length]}"><span>${esc(label)}</span><strong>${num(value, unit === 'isu' || unit === 'transaksi' ? 0 : unit === '%' ? 1 : 2)}</strong><small>${esc(unit)}</small></div>`).join('');
  }
  function fuelJobAllocations() {
    return (s.report?.jobs || []).map(job => {
      const matching = (s.report?.allocated || []).map(item => {
        const parts = (item.allocations || []).filter(part => part.jobCode === job.jobCode);
        const liters = parts.reduce((sum, part) => sum + Number(part.liters || 0), 0);
        return liters > 0 ? { ...item, allocations: parts, displayLiters: liters } : null;
      }).filter(Boolean);
      return { jobCode: job.jobCode, liters: matching.reduce((sum, item) => sum + item.displayLiters, 0),
        units: new Set(matching.map(item => item.equipmentId || item.unit)).size, transactions: matching.length, items: matching };
    });
  }
  function fuelJobCards() {
    return `<section class="pd-fuel-job-summary"><header><div><h3>Alokasi Fuel per JOB</h3><span>Klik indikator untuk melihat unit yang dialokasikan.</span></div>${s.fuelJobFilter ? '<button type="button" class="pd-clear-job-filter" data-pd-fuel-job="">Tampilkan Semua</button>' : ''}</header><div>${fuelJobAllocations().map((job, index) => `<button type="button" class="pd-fuel-job-card pd-summary-card--${['blue','cyan','amber','green','violet','rose'][index % 6]} ${s.fuelJobFilter === job.jobCode ? 'is-active' : ''}" data-pd-fuel-job="${esc(job.jobCode)}" aria-pressed="${s.fuelJobFilter === job.jobCode}"><span>${esc(job.jobCode)}</span><strong>${num(job.liters)}</strong><small>L · ${job.units} unit · ${job.transactions} transaksi</small></button>`).join('')}</div></section>`;
  }
  function renderSummary() {
    const target = document.getElementById('pdSummary');
    if (s.selectedArea === 'fuel') {
      const q = s.report.fuelQuality;
      const cards = [['Fuel periode', s.report.fuelSummary.total, 'L'], ['Teralokasi', s.report.fuelSummary.allocated, 'L'], ['Allocation rate', q.allocationPercent, '%'], ['Menunggu alokasi', s.report.fuelSummary.pending, 'L'], ['Antrean', s.report.queue.length, 'transaksi'], ['Rekonsiliasi', q.reconciled ? 0 : q.reconciliationDifference, q.reconciled ? 'Seimbang' : 'L']];
      target.innerHTML = `${summaryCards(cards)}${fuelJobCards()}`; return;
    }
    const table = s.report.tables.find(item => item.area === s.selectedArea); const summary = table?.summary;
    if (!summary) { target.innerHTML = ''; return; }
    const cards = [...summary.jobs.map(job => [job.jobCode, job.production, job.unit]), ['Fuel consumption', summary.fuel, 'L'], ['Fuel ratio', summary.fuelRatio, 'L/BCM'], ['Data quality', summary.qualityIssueCount, 'isu']];
    target.innerHTML = summaryCards(cards);
  }
  function renderTables() {
    const r = s.report;
    const token = ++s.renderToken;
    const container = document.getElementById('pdTables');
    if (!r.jobs.length) {
      container.innerHTML = '<p class="tabel__kosong">Belum ada JOB. Generate dan deploy tabel JOB di SPO untuk menampilkan rekap.</p>';
      return;
    }
    const tables = r.tables.filter(t => t.area === s.selectedArea);
    if (!tables.length) { container.innerHTML = '<p class="tabel__kosong">Belum ada area. Atur lokasi pada List Equipment.</p>'; return; }
    if (token === s.renderToken) container.innerHTML = tableMarkup(tables[0], r);
  }
  function renderActiveTab() {
    if (!s.report) return;
    renderTabs(); renderSummary();
    if (s.selectedArea === 'fuel') { document.getElementById('pdTables').innerHTML = ''; renderQueue(); }
    else { document.getElementById('pdQueue').innerHTML = ''; renderTables(); }
    refreshManualSave();
  }
  function renderQueue() {
    const r = s.report;
    const jobAllocation = fuelJobAllocations().find(job => job.jobCode === s.fuelJobFilter);
    const allocatedItems = jobAllocation ? jobAllocation.items : r.allocated;
    const shiftName = id => r.shifts.find(shift => shift.id === id)?.nama_shift || id;
    const modeLabel = mode => ({ manual: 'Manual', automatic: 'Input Data', rule: 'Aturan efektif unit' }[mode] || 'Otomatis');
    const markup = items => items.map(item => {
      const suggestions = (item.suggestions || []).map(value => `${value.area} / ${value.jobCode}`).join(', ');
      return `<tr><td>${esc(item.tanggal)}</td><td>${esc(shiftName(item.shiftId))}</td><td>${esc(item.unit)}</td><td>${num(item.displayLiters ?? item.liters)}</td>
      <td>${esc(item.reason || `${modeLabel(item.mode)}: ${item.allocations.map(a => `${a.area} / ${a.jobCode} (${num(a.liters)} L)`).join(', ')}`)}
      ${suggestions ? `<small class="pd-suggestion">Saran ${esc(item.suggestionSource)}: ${esc(suggestions)}</small>` : ''}</td>
      <td><button class="tombol" data-pd-allocate="${esc(item.id)}">${item.allocations.length ? 'Ubah alokasi' : 'Alokasikan'}</button></td></tr>`;
    }).join('');
    const table = items => `<div class="pd-scroll"><table class="pd-queue-table"><thead><tr><th>Tanggal</th><th>Shift</th><th>Unit</th><th>Fuel (L)</th><th>Status / tujuan</th><th>Aksi</th></tr></thead><tbody>${markup(items)}</tbody></table></div>`;
    const q = r.fuelQuality; const qualityState = q.reconciled && q.allocationPercent === 100 ? 'ok' : q.reconciled ? 'warning' : 'error';
    const reasonLabels = { no_input: 'Tanpa Input Data', ambiguous_input: 'Input Data ambigu', input_mismatch: 'JOB/area tidak cocok', source_changed: 'Sumber berubah', rule_invalid: 'Aturan tidak valid', other: 'Lainnya' };
    const quality = `<section class="pd-quality pd-quality--${qualityState}"><header><div><h3>Kualitas Alokasi Fuel</h3><span>Rekonsiliasi dan kelengkapan periode aktif</span></div><div class="pd-quality-actions"><strong>${q.allocationPercent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% teralokasi</strong><button class="tombol" data-pd-action="rules">Aturan Alokasi</button></div></header>
      <div class="pd-quality-grid"><div><span>Status rekonsiliasi</span><strong>${q.reconciled ? 'Seimbang' : `Selisih ${num(q.reconciliationDifference)} L`}</strong></div>
      <div><span>Antrean tertua</span><strong>${q.oldestPendingDate ? `${esc(q.oldestPendingDate)} · ${q.oldestPendingDays} hari` : 'Tidak ada'}</strong></div>
      <div><span>Aturan efektif</span><strong>${q.activeRuleCount} unit</strong></div>
      <div><span>Sumber alokasi</span><strong>${q.modeCounts.automatic || 0} Input Data · ${q.modeCounts.rule || 0} aturan · ${q.modeCounts.manual || 0} manual</strong></div></div>
      ${(q.topUnmappedUnits.length || Object.keys(q.reasonCounts).length) ? `<details><summary>Lihat penyebab dan unit yang perlu ditindaklanjuti</summary><div class="pd-quality-detail"><div><h4>Penyebab antrean</h4><ul>${Object.entries(q.reasonCounts).map(([code, count]) => `<li>${esc(reasonLabels[code] || code)} <strong>${count}</strong></li>`).join('')}</ul></div>
      <div><h4>Unit paling sering tidak terpetakan</h4><ul>${q.topUnmappedUnits.map(unit => `<li>${esc(unit.unit)} <strong>${unit.transactions} transaksi · ${num(unit.liters)} L</strong></li>`).join('') || '<li>Tidak ada</li>'}</ul></div></div></details>` : ''}</section>`;
    document.getElementById('pdQueue').innerHTML = `${quality}<details class="pd-area" ${r.queue.length ? 'open' : ''}><summary>Antrean Alokasi Fuel · ${r.queue.length} transaksi · ${num(r.fuelSummary.pending)} L</summary>
      <div class="pd-queue-intro"><p>Transaksi dalam antrean belum dihitung pada fuel ratio area/JOB. Perbaiki Input Data atau tentukan alokasi di sini.</p>
      ${r.queue.length ? '<button class="tombol tombol--utama" data-pd-action="quick-allocation">⚡ Alokasi Cepat</button>' : ''}</div>${r.queue.length ? table(r.queue) : '<p>Tidak ada transaksi menunggu alokasi.</p>'}</details>
      <details class="pd-area" ${s.fuelJobFilter ? 'open' : ''}><summary>Fuel teralokasi${s.fuelJobFilter ? ` · JOB ${esc(s.fuelJobFilter)} · ${num(jobAllocation?.liters || 0)} L · ${jobAllocation?.units || 0} unit` : ` · ${r.allocated.length} transaksi`}</summary>
      ${allocatedItems.length ? table(allocatedItems) : '<p>Belum ada unit dengan fuel teralokasi pada JOB ini.</p>'}</details>`;
  }
  async function load({ preserveManualDraft = false } = {}) {
    const sequence = ++s.request;
    const year = document.getElementById('pdYear').value; const month = document.getElementById('pdMonth').value;
    s.report = null;
    if (!preserveManualDraft) s.manualDraft = {};
    s.renderToken += 1;
    document.getElementById('pdTables').innerHTML = '<div class="pd-loading" aria-label="Memuat tabel Data Produksi"><span></span><span></span><span></span></div>';
    document.getElementById('pdQueue').innerHTML = '';
    document.getElementById('pdSummary').innerHTML = '';
    root().querySelector('[data-pd-action="export"]').disabled = true;
    refreshManualSave();
    setStatus('Memuat rekap bulanan…', 'loading');
    try {
      const report = await api(`/production-data?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`);
      if (sequence !== s.request) return;
      s.report = report;
      if (s.fuelJobFilter && !report.jobs.some(job => job.jobCode === s.fuelJobFilter)) s.fuelJobFilter = '';
      if (![...report.areas, 'fuel'].includes(s.selectedArea)) s.selectedArea = report.areas[0] || 'fuel';
      renderActiveTab();
      root().querySelector('[data-pd-action="export"]').disabled = false;
      setStatus(`Diperbarui ${new Date(report.generatedAt).toLocaleString('id-ID')} · Jenis material dan formula density mengikuti SPO ter-deploy. Tanda — berarti data belum tersedia.`);
      return report;
    } catch (error) { if (sequence === s.request) setStatus(error.message, 'error'); }
  }
  function openAllocation(id) {
    const item = [...s.report.queue, ...s.report.allocated].find(f => f.id === id);
    if (!item) return;
    const suggestion = item.suggestions?.length === 1 ? item.suggestions[0] : null;
    s.draft = { item, parts: item.allocations.length ? item.allocations.map(a => ({ ...a }))
      : [{ area: suggestion?.area || '', jobCode: suggestion?.jobCode || '', liters: item.liters }], reason: '' };
    drawAllocation(); document.getElementById('pdDialog').showModal();
  }
  function drawAllocation() {
    const d = s.draft;
    document.getElementById('pdDialog').innerHTML = `<form id="pdAllocationForm"><h3>Alokasi Fuel · ${esc(d.item.unit)}</h3><p>${esc(d.item.tanggal)} · Total ${num(d.item.liters)} L</p>
      <div id="pdParts">${d.parts.map((p, index) => `<div class="pd-part"><label>Area<select data-part="${index}" data-field="area" required>${options(s.report.areas, p.area)}</select></label>
      <label>JOB<select data-part="${index}" data-field="jobCode" required>${options(s.report.jobs, p.jobCode, true)}</select></label>
      <label>Liter<input type="number" min="0.01" step="0.01" required data-part="${index}" data-field="liters" value="${esc(p.liters)}"></label>
      <button type="button" data-pd-remove="${index}" aria-label="Hapus bagian alokasi">−</button></div>`).join('')}</div>
      <button type="button" class="tombol" data-pd-action="add-part">+ Bagi alokasi</button>
      <label>Alasan<textarea id="pdReason" required minlength="5" maxlength="1000">${esc(d.reason)}</textarea></label>
      <p id="pdAllocationError" role="alert"></p><footer><button type="button" class="tombol" data-pd-action="close">Batal</button><button type="submit" class="tombol tombol--utama">Simpan alokasi</button></footer></form>`;
  }
  function openBulkAllocation() {
    if (!s.report?.queue.length) return;
    s.bulk = { rows: s.report.queue.map((item, index) => { const suggestion = item.suggestions?.length === 1 ? item.suggestions[0] : null;
      return { item, selected: index < 100, area: suggestion?.area || '', jobCode: suggestion?.jobCode || '' }; }),
      reason: '', query: '', shiftId: '', preview: null, createRules: false,
      effectiveFrom: s.report.queue.map(item => item.tanggal).sort()[0] || s.report.period.start };
    drawBulkAllocation(); document.getElementById('pdDialog').showModal();
  }
  function bulkRows() { return s.bulk?.rows.filter(row => row.selected) || []; }
  function bulkPayload(dryRun) {
    return { dryRun, reason: s.bulk.reason, createRules: s.bulk.createRules, effectiveFrom: s.bulk.effectiveFrom,
      items: bulkRows().map(row => ({ id: row.item.id,
      fingerprint: row.item.fingerprint, revision: row.item.revision || 0, area: row.area, jobCode: row.jobCode })) };
  }
  function bulkSummary() {
    const rows = bulkRows(); const liters = rows.reduce((sum, row) => sum + Number(row.item.liters || 0), 0);
    const incomplete = rows.filter(row => !row.area || !row.jobCode).length;
    return { rows, liters, incomplete };
  }
  function invalidateBulkPreview() {
    if (!s.bulk) return;
    s.bulk.preview = null;
    const preview = document.getElementById('pdBulkPreview');
    if (preview) preview.innerHTML = '<span>Periksa alokasi untuk melihat ringkasan tujuan sebelum menyimpan.</span>';
    const saveButton = root().querySelector('[data-pd-action="save-bulk"]');
    if (saveButton) saveButton.disabled = true;
    updateBulkSummary();
  }
  function updateBulkSummary() {
    const target = document.getElementById('pdBulkSummary'); if (!target || !s.bulk) return;
    const summary = bulkSummary();
    const recommended = summary.rows.filter(row => row.item.suggestions?.length === 1).length;
    target.innerHTML = `<strong>${summary.rows.length} transaksi</strong><span>${num(summary.liters)} L</span><span>${summary.incomplete ? `${summary.incomplete} tujuan belum lengkap` : 'Seluruh tujuan lengkap'}</span><span>${recommended} memiliki rekomendasi</span>`;
  }
  function filterBulkRows() {
    if (!s.bulk) return;
    const query = s.bulk.query.trim().toLocaleLowerCase('id-ID');
    document.querySelectorAll('#pdBulkTable tbody tr').forEach(row => {
      const checkbox = row.querySelector('input[data-bulk-select]');
      if (checkbox) checkbox.checked = s.bulk.rows[Number(checkbox.dataset.bulkSelect)].selected;
      row.hidden = Boolean((query && !row.dataset.search.includes(query)) || (s.bulk.shiftId && row.dataset.shift !== s.bulk.shiftId));
    });
    const visible = [...document.querySelectorAll('#pdBulkTable tbody tr:not([hidden]) input[data-bulk-select]')];
    const all = document.getElementById('pdBulkSelectAll');
    if (all) { all.checked = visible.length > 0 && visible.every(input => input.checked); all.indeterminate = visible.some(input => input.checked) && !all.checked; }
  }
  function drawBulkAllocation() {
    const shiftName = id => s.report.shifts.find(shift => shift.id === id)?.nama_shift || id;
    const dialog = document.getElementById('pdDialog');
    dialog.classList.add('pd-dialog--wide');
    dialog.innerHTML = `<form id="pdBulkForm"><header class="pd-bulk-header"><div><h3>⚡ Alokasi Cepat Fuel</h3><p>Alokasikan maksimal 100 transaksi sekaligus. Setiap transaksi tetap dialokasikan sebesar 100% volume pengisiannya.</p></div></header>
      <div class="pd-bulk-filters"><label>Cari unit, tanggal, atau status<input id="pdBulkQuery" type="search" placeholder="Contoh: DT-01"></label>
      <label>Shift<select id="pdBulkShift"><option value="">Semua shift</option>${s.report.shifts.map(shift => `<option value="${esc(shift.id)}">${esc(shift.nama_shift)}</option>`).join('')}</select></label></div>
      <section class="pd-bulk-apply"><strong>Terapkan tujuan ke transaksi terpilih</strong><label>Area<select id="pdBulkArea">${options(s.report.areas, '')}</select></label>
      <label>JOB<select id="pdBulkJob">${options(s.report.jobs, '', true)}</select></label><button type="button" class="tombol" data-pd-action="apply-bulk-target">Terapkan</button>
      <button type="button" class="tombol" data-pd-action="apply-suggestions">Gunakan Rekomendasi</button></section>
      <div id="pdBulkSummary" class="pd-bulk-summary"></div>
      <div class="pd-scroll pd-bulk-scroll"><table id="pdBulkTable" class="pd-queue-table"><thead><tr><th><input id="pdBulkSelectAll" type="checkbox" checked aria-label="Pilih semua hasil filter"></th><th>Tanggal</th><th>Shift</th><th>Unit</th><th>Fuel (L)</th><th>Status</th><th>Rekomendasi</th><th>Area</th><th>JOB</th></tr></thead><tbody>
      ${s.bulk.rows.map((row, index) => `<tr data-search="${esc(`${row.item.unit} ${row.item.tanggal} ${row.item.reason || ''}`.toLocaleLowerCase('id-ID'))}" data-shift="${esc(row.item.shiftId)}"><td><input type="checkbox" data-bulk-select="${index}" ${row.selected ? 'checked' : ''} aria-label="Pilih ${esc(row.item.unit)} ${esc(row.item.tanggal)}"></td>
      <td>${esc(row.item.tanggal)}</td><td>${esc(shiftName(row.item.shiftId))}</td><td><strong>${esc(row.item.unit)}</strong></td><td>${num(row.item.liters)}</td><td class="pd-bulk-reason">${esc(row.item.reason)}</td>
      <td>${row.item.suggestions?.length ? `${esc(row.item.suggestionSource)}: ${row.item.suggestions.map(value => `${esc(value.area)} / ${esc(value.jobCode)}`).join(', ')}` : '—'}</td>
      <td><select data-bulk-index="${index}" data-bulk-field="area">${options(s.report.areas, row.area)}</select></td><td><select data-bulk-index="${index}" data-bulk-field="jobCode">${options(s.report.jobs, row.jobCode, true)}</select></td></tr>`).join('')}</tbody></table></div>
      <label>Alasan alokasi massal<textarea id="pdBulkReason" required minlength="5" maxlength="1000" placeholder="Contoh: Verifikasi berdasarkan Input Data dan laporan pengawas"></textarea></label>
      <section class="pd-rule-option"><label><input id="pdBulkCreateRules" type="checkbox"> Simpan tujuan sebagai aturan efektif per unit untuk transaksi berikutnya tanpa Input Data</label>
      <label>Berlaku mulai<input id="pdBulkEffectiveFrom" type="date" min="${esc(s.report.period.start)}" max="${esc(new Date(Date.parse(`${s.report.period.end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10))}" value="${esc(s.bulk.effectiveFrom)}" disabled></label>
      <p>Aturan tidak mengubah histori dan tidak mengambil alih Input Data yang unik. Satu unit harus mempunyai satu tujuan dalam batch.</p></section>
      <div id="pdBulkPreview" class="pd-bulk-preview"><span>Periksa alokasi untuk melihat ringkasan tujuan sebelum menyimpan.</span></div>
      <p id="pdAllocationError" role="alert"></p><footer><button type="button" class="tombol" data-pd-action="close">Batal</button>
      <button type="button" class="tombol" data-pd-action="validate-bulk">Periksa Alokasi</button><button type="button" class="tombol tombol--utama" data-pd-action="save-bulk" disabled>Simpan Alokasi</button></footer></form>`;
    updateBulkSummary(); filterBulkRows();
  }
  function setBulkDisabled(disabled, except) {
    document.querySelectorAll('#pdBulkForm input,#pdBulkForm select,#pdBulkForm textarea,#pdBulkForm button').forEach(control => {
      if (control !== except) control.disabled = disabled;
    });
  }
  async function runBulk(button, dryRun) {
    if (s.busy || !s.bulk) return;
    const summary = bulkSummary(); const error = document.getElementById('pdAllocationError'); error.textContent = '';
    if (!summary.rows.length) { error.textContent = 'Pilih minimal satu transaksi fuel.'; return; }
    if (summary.incomplete) { error.textContent = 'Lengkapi Area dan JOB seluruh transaksi terpilih.'; return; }
    if (s.bulk.reason.trim().length < 5) { error.textContent = 'Alasan alokasi wajib diisi minimal 5 karakter.'; return; }
    s.busy = true;
    try {
      let result;
      await global.OMOSActionFeedback.run(button, async () => {
        setBulkDisabled(true, button);
        result = await api('/production-data/fuel/batch', { method: 'POST', body: JSON.stringify(bulkPayload(dryRun)) });
      }, { loadingText: dryRun ? 'Memeriksa…' : 'Mengalokasikan…' });
      if (dryRun) {
        s.bulk.preview = result.summary;
        document.getElementById('pdBulkPreview').innerHTML = `<strong>Valid untuk disimpan</strong><span>${result.summary.transactions} transaksi · ${num(result.summary.totalLiters)} L</span>
          <ul>${result.summary.destinations.map(d => `<li>${esc(d.area)} / ${esc(d.jobCode)}: ${d.transactions} transaksi · ${num(d.liters)} L</li>`).join('')}</ul>
          ${result.summary.rulesToCreate ? `<span>${result.summary.rulesToCreate} aturan efektif baru akan dibuat.</span>` : ''}`;
        root().querySelector('[data-pd-action="save-bulk"]').disabled = false;
      } else {
        document.getElementById('pdDialog').close(); document.getElementById('pdDialog').classList.remove('pd-dialog--wide'); s.bulk = null; await load();
        setStatus(`${result.changed} transaksi berhasil dialokasikan${result.rulesCreated ? ` · ${result.rulesCreated} aturan efektif dibuat` : ''}.`);
      }
    } catch (errorValue) {
      error.textContent = errorValue.message; s.bulk.preview = null;
      const preview = document.getElementById('pdBulkPreview');
      if (preview) preview.innerHTML = '<span>Pemeriksaan tidak lagi valid. Perbaiki data atau muat ulang laporan, lalu periksa kembali.</span>';
    }
    finally { s.busy = false; if (s.bulk) { setBulkDisabled(false); const effective = document.getElementById('pdBulkEffectiveFrom'); if (effective) effective.disabled = !s.bulk.createRules;
      const saveButton = root().querySelector('[data-pd-action="save-bulk"]'); if (saveButton) saveButton.disabled = !s.bulk.preview; } }
  }
  function openRules() {
    const units = new Map((s.report.ruleUnits || []).map(unit => [unit.id, unit.unit]));
    [...s.report.queue, ...s.report.allocated].forEach(item => units.set(item.equipmentId, item.unit));
    s.report.allocationRules.forEach(rule => units.set(rule.equipmentId, rule.unit));
    const rules = s.report.allocationRules.slice().sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)));
    const dialog = document.getElementById('pdDialog'); dialog.classList.add('pd-dialog--wide');
    dialog.innerHTML = `<form id="pdRuleForm"><h3>Aturan Alokasi Fuel Efektif</h3><p>Aturan digunakan hanya ketika Input Data tidak memberikan tujuan. Membuat aturan baru tidak mengubah transaksi historis.</p>
      <div class="pd-rule-form"><label>Unit<select id="pdRuleEquipment" required><option value="">Pilih unit</option>${[...units].sort((a,b) => a[1].localeCompare(b[1])).map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')}</select></label>
      <label>Area<select id="pdRuleArea" required>${options(s.report.areas, '')}</select></label><label>JOB<select id="pdRuleJob" required>${options(s.report.jobs, '', true)}</select></label>
      <label>Berlaku mulai<input id="pdRuleDate" type="date" min="${esc(s.report.period.start)}" max="${esc(new Date(Date.parse(`${s.report.period.end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10))}" value="${esc(s.report.period.start)}" required></label>
      <label>Status<select id="pdRuleActive"><option value="true">Aktif</option><option value="false">Nonaktif mulai tanggal</option></select></label></div>
      <label>Alasan<textarea id="pdRuleReason" required minlength="5" maxlength="1000" placeholder="Contoh: Perubahan penugasan unit berdasarkan keputusan operasional"></textarea></label>
      <p id="pdAllocationError" role="alert"></p><footer><button type="button" class="tombol" data-pd-action="close">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Aturan</button></footer>
      <div class="pd-scroll pd-rule-history"><table class="pd-queue-table"><thead><tr><th>Efektif</th><th>Unit</th><th>Area</th><th>JOB</th><th>Status</th></tr></thead><tbody>${rules.map(rule => `<tr><td>${esc(rule.effectiveFrom)}</td><td>${esc(rule.unit)}</td><td>${esc(rule.area)}</td><td>${esc(rule.jobCode)}</td><td>${rule.active ? 'Aktif' : 'Nonaktif'}</td></tr>`).join('') || '<tr><td colspan="5">Belum ada aturan.</td></tr>'}</tbody></table></div></form>`;
    dialog.showModal();
  }
  async function saveRule(event) {
    event.preventDefault(); if (s.busy) return;
    const form = event.target; const button = event.submitter; const error = document.getElementById('pdAllocationError'); error.textContent = '';
    const payload = { equipmentId: document.getElementById('pdRuleEquipment').value, area: document.getElementById('pdRuleArea').value,
      jobCode: document.getElementById('pdRuleJob').value, effectiveFrom: document.getElementById('pdRuleDate').value,
      active: document.getElementById('pdRuleActive').value === 'true', reason: document.getElementById('pdRuleReason').value };
    s.busy = true;
    try {
      await global.OMOSActionFeedback.run(button, async () => {
        Array.from(form.elements).filter(element => element !== button).forEach(element => { element.disabled = true; });
        await api('/production-data/fuel-allocation-rules', { method: 'POST', body: JSON.stringify(payload) });
      });
      document.getElementById('pdDialog').close(); document.getElementById('pdDialog').classList.remove('pd-dialog--wide'); await load();
      setStatus(`Aturan ${payload.active ? 'aktif' : 'nonaktif'} untuk unit terpilih berhasil disimpan.`);
    } catch (errorValue) { error.textContent = errorValue.message; }
    finally { s.busy = false; Array.from(form.elements).forEach(element => { element.disabled = false; }); }
  }
  async function save(event) {
    event.preventDefault(); if (s.busy || !s.draft) return;
    const form = event.target; const button = event.submitter; const d = s.draft;
    s.busy = true;
    try {
      await global.OMOSActionFeedback.run(button, async () => {
        Array.from(form.elements).filter(el => el !== button).forEach(el => { el.disabled = true; });
        await api(`/production-data/fuel/${encodeURIComponent(d.item.id)}`, { method: 'PUT', body: JSON.stringify({ fingerprint: d.item.fingerprint, revision: d.item.revision || 0, allocations: d.parts, reason: d.reason }) });
      });
      document.getElementById('pdDialog').close(); s.draft = null; await load();
    } catch (error) { document.getElementById('pdAllocationError').textContent = error.message; }
    finally { s.busy = false; Array.from(form.elements).forEach(el => { el.disabled = false; }); }
  }
  function detail(context) {
    const row = s.report.tables[context.area].rows[context.row]; const cell = row.values[context.job];
    const dialog = document.getElementById('pdDialog');
    dialog.innerHTML = `<h3>${esc(context.job)} · ${esc(row.date)} · ${esc(row.shift)}</h3><p>${esc(cell.notes.join('; '))}</p>
      <div class="pd-scroll"><table class="pd-queue-table"><thead><tr><th>Fleet</th><th>Material</th><th>Produksi</th><th>Density (ton/BCM)</th><th>Acuan density</th><th>Jarak final (km)</th></tr></thead>
      <tbody>${cell.sources.map(src => `<tr><td>${esc(src.unit)}</td><td>${esc(src.material)}</td><td>${num(src.production)}</td><td>${num(src.density, 3)}</td><td>${esc(src.densitySource === 'snapshot' ? 'Terkunci' : 'Planning saat ini')}</td><td>${num(src.distanceKm, 3)}</td></tr>`).join('')}</tbody></table></div>
      <p>Coal BCM = ton ÷ density. Fuel ratio = liter teralokasi ÷ BCM. Jarak dibobotkan berdasarkan produksi.</p><button class="tombol" data-pd-action="close">Tutup</button>`;
    dialog.showModal();
  }
  function manualKey(area, row, job, material) { return `${area}|${row}|${job}|${material}`; }
  function manualCellInput(context, job, material, value, cls) {
    const id = manualKey(context.area, context.row, job, material);
    const draftValue = id in s.manualDraft ? s.manualDraft[id] : (value == null ? '' : value);
    return `<input class="pd-manual-input ${cls || ''}" type="number" min="0" step="any" inputmode="decimal"
      data-pd-manual-area="${context.area}" data-pd-manual-row="${context.row}" data-pd-manual-job="${esc(job)}" data-pd-manual-material="${esc(material)}"
      value="${esc(draftValue)}" aria-label="${esc(job)} ${esc(material)} manual">`;
  }
  function manualRowTotal(context, job) {
    const table = s.report?.tables[context.area];
    const row = table?.rows[context.row];
    const jobDefinition = s.report?.jobs.find(item => item.jobCode === job);
    if (!row || !jobDefinition || jobDefinition.unit === 'mixed') return null;
    let total = 0; let hasValue = false;
    for (const material of jobDefinition.materials) {
      const id = manualKey(context.area, context.row, job, material.name);
      const raw = id in s.manualDraft ? s.manualDraft[id] : row.values[job]?.materials[material.name];
      if (raw === '' || raw == null) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return null;
      total += value; hasValue = true;
    }
    return hasValue ? total : null;
  }
  function manualTotalInput(context, job) {
    const total = manualRowTotal(context, job);
    return `<input class="pd-manual-input pd-total-input" type="number" value="${total == null ? '' : esc(total)}" readonly aria-readonly="true"
      data-pd-manual-total-area="${context.area}" data-pd-manual-total-row="${context.row}" data-pd-manual-total-job="${esc(job)}"
      aria-label="Total ${esc(job)} otomatis">`;
  }
  function refreshManualRowTotal(context, job) {
    const total = manualRowTotal(context, job);
    const target = [...root().querySelectorAll('.pd-total-input')].find(input =>
      Number(input.dataset.pdManualTotalArea) === Number(context.area)
      && Number(input.dataset.pdManualTotalRow) === Number(context.row)
      && input.dataset.pdManualTotalJob === job);
    if (target) target.value = total == null ? '' : total;
  }
  // Segmen pertama id draf adalah INDEX tabel (lihat tableMarkup), bukan nama
  // area — konsumen wajib mengonversinya sebelum membandingkan.
  function manualTableIndex(areaSegment) {
    const index = Number(areaSegment);
    if (!Number.isInteger(index) || !s.report?.tables[index]) return -1;
    return index;
  }
  function manualDirtyCount(areaName = '') {
    let count = 0;
    for (const [id, value] of Object.entries(s.manualDraft)) {
      const [area, row, job, material] = id.split('|');
      if (material === 'TOTAL') continue;
      const tableIndex = manualTableIndex(area);
      if (tableIndex < 0 || manualSource(tableIndex, job) !== 'manual') continue;
      if (areaName && s.report.tables[tableIndex]?.area !== areaName) continue;
      const cell = s.report.tables[tableIndex].rows[Number(row)].values[job];
      const current = material === 'TOTAL' ? cell.production : cell.materials[material];
      const draftNum = value === '' ? null : Number(value);
      if (draftNum !== current) count++;
    }
    return count;
  }
  function refreshManualSave() {
    const btn = root().querySelector('[data-pd-action="save-manual"]');
    const status = document.getElementById('pdManualSaveState');
    const n = manualDirtyCount();
    if (btn) { btn.disabled = s.busy || n === 0; btn.textContent = n ? `Simpan (${n})` : 'Simpan'; }
    if (status) {
      status.classList.toggle('is-dirty', n > 0);
      status.textContent = n ? `Data belum disimpan · ${n} perubahan` : 'Tersimpan';
    }
  }
  function onManualInput(event) {
    const el = event.target;
    if (!el.classList.contains('pd-manual-input')) return;
    const id = manualKey(el.dataset.pdManualArea, Number(el.dataset.pdManualRow), el.dataset.pdManualJob, el.dataset.pdManualMaterial);
    s.manualDraft[id] = el.value;
    refreshManualRowTotal({ area: Number(el.dataset.pdManualArea), row: Number(el.dataset.pdManualRow) }, el.dataset.pdManualJob);
    refreshManualSave(); renderTabs();
  }
  function manualSnapshotMatches(report, group) {
    const actual = new Map((report?.manualOverrides || [])
      .filter(row => row.area === group.area && row.jobCode === group.jobCode)
      .map(row => [`${row.tanggal}|${row.shiftId}|${row.material}`, Number(row.value)]));
    if (actual.size !== group.overrides.length) return false;
    return group.overrides.every(row => actual.get(`${row.tanggal}|${row.shiftId}|${row.material}`) === Number(row.value));
  }
  function openManualSource(areaIndex, jobCode) {
    const table = s.report.tables[areaIndex];
    const job = s.report.jobs.find(j => j.jobCode === jobCode);
    if (!table || !job) return;
    const current = manualSource(areaIndex, jobCode);
    const dialog = document.getElementById('pdDialog');
    dialog.innerHTML = `<form id="pdManualSourceForm" data-area="${esc(table.area)}" data-job="${esc(jobCode)}"><h3>Sumber Data · ${esc(jobCode)} · ${esc(table.area)}</h3>
      <p>Pilih sumber data untuk kolom <strong>${esc(jobCode)} · ${esc(job.jobDescription)}</strong> pada area <strong>${esc(table.area)}</strong>.</p>
      <div class="pd-source-options">
        <label class="pd-source-option"><input type="radio" name="pdSource" value="ritase" ${current === 'ritase' ? 'checked' : ''}>
          <span><strong>Input Ritase</strong><small>Sumber default dari sistem (agregasi otomatis Input Ritase).</small></span></label>
        <label class="pd-source-option"><input type="radio" name="pdSource" value="manual" ${current === 'manual' ? 'checked' : ''}>
          <span><strong>Manual</strong><small>Ketik nilai produksi per tanggal/shift dan material. Kolom Total dijumlahkan otomatis.</small></span></label>
      </div>
      <p class="pd-source-note">Mode Manual menggantikan nilai Input Ritase pada rekap bulanan (TOTAL bulan dan fuel ratio). Setelah memilih Manual, ketik nilai pada tabel lalu klik <strong>Simpan</strong>.</p>
      <p id="pdAllocationError" role="alert"></p>
      <footer><button type="button" class="tombol" data-pd-action="close">Batal</button><button type="submit" class="tombol tombol--utama">Terapkan Sumber</button></footer></form>`;
    dialog.showModal();
  }
  async function saveManualSource(event) {
    event.preventDefault(); if (s.busy) return;
    const form = event.target; const button = event.submitter; const error = document.getElementById('pdAllocationError'); error.textContent = '';
    const source = form.querySelector('input[name="pdSource"]:checked')?.value;
    const area = form.dataset.area; const jobCode = form.dataset.job;
    if (!source) { error.textContent = 'Pilih sumber data terlebih dahulu.'; return; }
    s.busy = true;
    try {
      await global.OMOSActionFeedback.run(button, async () => {
        Array.from(form.elements).filter(el => el !== button).forEach(el => { el.disabled = true; });
        await api('/production-data/manual-source', { method: 'PUT', body: JSON.stringify({
          year: s.report.period.year, month: s.report.period.month, area, jobCode, source }) });
      });
      if (source === 'ritase') Object.keys(s.manualDraft).forEach(id => {
        const [a, , j] = id.split('|');
        const table = s.report?.tables[manualTableIndex(a)];
        if (table && table.area === area && j === jobCode) delete s.manualDraft[id];
      });
      document.getElementById('pdDialog').close(); await load();
      setStatus(`Sumber data ${jobCode} · ${area} diterapkan: ${source === 'manual' ? 'Manual' : 'Input Ritase'}.`);
    } catch (errorValue) { error.textContent = errorValue.message; }
    finally { s.busy = false; Array.from(form.elements).forEach(el => { el.disabled = false; }); }
  }
  async function saveManualValues(button) {
    if (s.busy) return;
    const changedGroups = new Map();
    for (const [id] of Object.entries(s.manualDraft)) {
      const [area, , job] = id.split('|');
      const tableIndex = manualTableIndex(area);
      if (tableIndex < 0 || manualSource(tableIndex, job) !== 'manual') continue;
      const table = s.report.tables[tableIndex];
      const k = `${table.area}|${job}`;
      changedGroups.set(k, { tableIndex, area: table.area, jobCode: job });
    }
    const groups = [];
    let invalidMessage = '';
    for (const group of changedGroups.values()) {
      const table = s.report.tables[group.tableIndex];
      const job = s.report.jobs.find(item => item.jobCode === group.jobCode);
      if (!job) continue;
      const snapshot = new Map((s.report.manualOverrides || [])
        .filter(row => row.area === group.area && row.jobCode === group.jobCode && row.material !== 'TOTAL')
        .map(row => [`${row.tanggal}|${row.shiftId}|${row.material}`, { tanggal: row.tanggal, shiftId: row.shiftId, material: row.material, value: Number(row.value) }]));
      Object.entries(s.manualDraft).forEach(([id, raw]) => {
        const [areaSegment, rowSegment, jobCode, material] = id.split('|');
        if (manualTableIndex(areaSegment) !== group.tableIndex || jobCode !== group.jobCode) return;
        if (material === 'TOTAL') return;
        const rowObj = table.rows[Number(rowSegment)];
        if (!rowObj) return;
        const key = `${rowObj.date}|${rowObj.shiftId}|${material}`;
        if (raw === '') { snapshot.delete(key); return; }
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) { invalidMessage = `Nilai ${group.jobCode} harus berupa angka nol atau lebih.`; return; }
        snapshot.set(key, { tanggal: rowObj.date, shiftId: rowObj.shiftId, material, value });
      });
      const overrides = [...snapshot.values()];
      groups.push({ ...group, overrides });
    }
    if (invalidMessage) { setStatus(invalidMessage, 'error'); return refreshManualSave(); }
    if (!groups.length || manualDirtyCount() === 0) return refreshManualSave();
    s.busy = true;
    try {
      await global.OMOSActionFeedback.run(button, async () => {
        for (const { area, jobCode, overrides } of groups) {
          const result = await api('/production-data/manual-source', { method: 'PUT', body: JSON.stringify({
            year: s.report.period.year, month: s.report.period.month, area, jobCode, source: 'manual',
            overrides }) });
          if (!result?.saved || Number(result.overrides) !== overrides.length) {
            throw new Error(`Server belum mengonfirmasi seluruh nilai manual ${jobCode} · ${area}. Draf tetap disimpan di layar.`);
          }
        }
      });
      const refreshed = await load({ preserveManualDraft: true });
      if (!refreshed || groups.some(group => !manualSnapshotMatches(refreshed, group))) {
        throw new Error('Verifikasi setelah simpan gagal. Draf tetap disimpan di layar; silakan coba lagi.');
      }
      s.manualDraft = {};
      renderActiveTab();
      setStatus('Perubahan data produksi manual tersimpan.');
    } catch (error) { setStatus(error.message, 'error'); }
    finally { s.busy = false; refreshManualSave(); }
  }
  async function exportExcel() {
    const report = s.report; if (!report) return;
    const XLSX = await global.OMOSLoadLibrary('xlsx'); const book = XLSX.utils.book_new();
    report.tables.filter(t => s.selectedArea !== 'fuel' && t.area === s.selectedArea).forEach((table, index) => {
      const top = ['Tanggal', 'Shift']; const second = ['', '']; const merges = [];
      const group = (name, labels) => { const start = top.length; top.push(name, ...labels.slice(1).map(() => '')); second.push(...labels); if (labels.length > 1) merges.push({ s: { r: 0, c: start }, e: { r: 0, c: top.length - 1 } }); };
      for (const job of report.jobs) group(job.jobCode, [...job.materials.map(m => `${m.name} (${m.unit})`), `Total (${job.unit})`, 'Jarak (km)']);
      metrics.forEach(([field, label, unit], i) => group(`${label} (${unit})`, [...report.jobs.map(j => j.jobCode), ...(i < 2 ? ['ALL'] : [])]));
      top.push('Keterangan'); second.push('');
      const rows = table.rows.map(row => [row.date, row.shift, ...rowValues(row.values, report.jobs, row.all), [...new Set(Object.values(row.values).flatMap(c => c.notes))].join('; ')]);
      const sheet = XLSX.utils.aoa_to_sheet([top, second, ...rows, ['TOTAL BULAN', '', ...rowValues(table.totals, report.jobs, table.totalAll), '']]);
      const formats = [null, null];
      report.jobs.forEach(j => formats.push(...j.materials.map(() => '#,##0.00'), '#,##0.00', '0.000'));
      metrics.forEach(([field, , , digits], index) => formats.push(...Array(report.jobs.length + (index < 2 ? 1 : 0)).fill(digits === 3 ? '0.000' : digits === 1 ? '0.0' : '#,##0.00')));
      for (let row = 2; row <= rows.length + 2; row++) for (let col = 2; col < formats.length; col++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]; if (cell?.t === 'n') cell.z = formats[col];
      }
      sheet['!merges'] = merges; sheet['!cols'] = top.map((_, i) => ({ wch: i === top.length - 1 ? 60 : 18 }));
      XLSX.utils.book_append_sheet(book, sheet, `${index + 1} ${table.area}`.replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31));
    });
    if (s.selectedArea === 'fuel') {
      const rows = [...report.queue, ...report.allocated].map(item => [item.tanggal, item.unit, item.liters,
        item.allocations.length ? item.allocations.map(a => `${a.area} / ${a.jobCode}`).join('; ') : 'Menunggu alokasi', item.reason || item.mode || '']);
      const sheet = XLSX.utils.aoa_to_sheet([['Tanggal','Unit','Fuel (L)','Tujuan','Status'], ...rows]);
      sheet['!cols'] = [{wch:14},{wch:22},{wch:14},{wch:38},{wch:42}];
      XLSX.utils.book_append_sheet(book, sheet, 'Alokasi Fuel');
    }
    if (book.SheetNames.length) XLSX.writeFile(book, `OMOS_Data_Produksi_${report.period.year}_${String(report.period.month).padStart(2, '0')}.xlsx`);
  }
  function init() {
    if (!s.initialized) {
      toolbar(); s.selectedArea = global.sessionStorage?.getItem('omos.productionData.tab') || ''; s.initialized = true;
      root().addEventListener('change', event => {
        if (['pdYear', 'pdMonth'].includes(event.target.id)) load();
      });
      root().addEventListener('input', event => {
        if (s.busy) return;
        if (event.target.classList.contains('pd-manual-input')) { onManualInput(event); return; }
        if (s.draft) {
          if (event.target.dataset.part != null) s.draft.parts[Number(event.target.dataset.part)][event.target.dataset.field] = event.target.value;
          if (event.target.id === 'pdReason') s.draft.reason = event.target.value;
        }
        if (s.bulk) {
          if (event.target.id === 'pdBulkQuery') { s.bulk.query = event.target.value; filterBulkRows(); return; }
          if (event.target.id === 'pdBulkReason') s.bulk.reason = event.target.value;
          if (event.target.dataset.bulkIndex != null) s.bulk.rows[Number(event.target.dataset.bulkIndex)][event.target.dataset.bulkField] = event.target.value;
          invalidateBulkPreview();
        }
      });
      root().addEventListener('change', event => {
        if (!s.bulk || s.busy) return;
        if (event.target.id === 'pdBulkShift') { s.bulk.shiftId = event.target.value; filterBulkRows(); return; }
        if (event.target.id === 'pdBulkCreateRules') {
          s.bulk.createRules = event.target.checked; document.getElementById('pdBulkEffectiveFrom').disabled = !event.target.checked;
          invalidateBulkPreview(); return;
        }
        if (event.target.id === 'pdBulkEffectiveFrom') { s.bulk.effectiveFrom = event.target.value; invalidateBulkPreview(); return; }
        if (event.target.id === 'pdBulkSelectAll') {
          const visible = [...document.querySelectorAll('#pdBulkTable tbody tr:not([hidden]) input[data-bulk-select]')];
          if (event.target.checked) s.bulk.rows.forEach(row => { row.selected = false; });
          visible.forEach((input, index) => {
            const selected = event.target.checked ? index < 100 : false;
            input.checked = selected; s.bulk.rows[Number(input.dataset.bulkSelect)].selected = selected;
          });
          if (event.target.checked && visible.length > 100) document.getElementById('pdAllocationError').textContent = 'Maksimal 100 transaksi dapat diproses dalam satu batch.';
          invalidateBulkPreview(); filterBulkRows(); return;
        }
        if (event.target.dataset.bulkSelect != null) {
          if (event.target.checked && bulkRows().length >= 100) {
            event.target.checked = false; document.getElementById('pdAllocationError').textContent = 'Maksimal 100 transaksi dapat diproses dalam satu batch.';
          } else s.bulk.rows[Number(event.target.dataset.bulkSelect)].selected = event.target.checked;
          invalidateBulkPreview(); filterBulkRows();
        }
      });
      root().addEventListener('submit', event => {
        if (event.target.id === 'pdAllocationForm') save(event);
        if (event.target.id === 'pdRuleForm') saveRule(event);
        if (event.target.id === 'pdManualSourceForm') saveManualSource(event);
      });
      document.getElementById('pdDialog').addEventListener('cancel', event => { if (s.busy) event.preventDefault(); });
      document.getElementById('pdDialog').addEventListener('close', () => {
        if (!s.busy) { document.getElementById('pdDialog').classList.remove('pd-dialog--wide'); s.draft = null; s.bulk = null; }
      });
      root().addEventListener('click', async event => {
        const button = event.target.closest('button'); if (!button || s.busy) return;
        try {
          if (button.dataset.pdAllocate) return openAllocation(button.dataset.pdAllocate);
          if (button.dataset.pdFuelJob != null) {
            s.fuelJobFilter = button.dataset.pdFuelJob === s.fuelJobFilter ? '' : button.dataset.pdFuelJob;
            renderSummary(); renderQueue();
            document.getElementById('pdQueue')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
          }
          if (button.dataset.pdTab) { s.selectedArea = button.dataset.pdTab; global.sessionStorage?.setItem('omos.productionData.tab', s.selectedArea); renderActiveTab(); return; }
          if (button.dataset.pdDetail) return detail(JSON.parse(button.dataset.pdDetail));
          if (button.dataset.pdSource) return openManualSource(Number(button.dataset.pdSourceArea), button.dataset.pdSource);
          if (button.dataset.pdRemove != null && s.draft.parts.length > 1) { s.draft.parts.splice(Number(button.dataset.pdRemove), 1); return drawAllocation(); }
          switch (button.dataset.pdAction) {
            case 'reload': return load();
            case 'save-manual': return saveManualValues(button);
            case 'close': document.getElementById('pdDialog').close(); document.getElementById('pdDialog').classList.remove('pd-dialog--wide'); s.draft = null; s.bulk = null; break;
            case 'quick-allocation': return openBulkAllocation();
            case 'rules': return openRules();
            case 'apply-bulk-target': {
              const area = document.getElementById('pdBulkArea').value; const jobCode = document.getElementById('pdBulkJob').value;
              if (!area || !jobCode) { document.getElementById('pdAllocationError').textContent = 'Pilih Area dan JOB yang akan diterapkan.'; break; }
              bulkRows().forEach(row => { row.area = area; row.jobCode = jobCode; });
              document.querySelectorAll('[data-bulk-index]').forEach(select => { const row = s.bulk.rows[Number(select.dataset.bulkIndex)]; select.value = row[select.dataset.bulkField]; });
              document.getElementById('pdAllocationError').textContent = ''; invalidateBulkPreview(); break;
            }
            case 'apply-suggestions': {
              let applied = 0;
              bulkRows().forEach(row => { if (row.item.suggestions?.length === 1) { row.area = row.item.suggestions[0].area; row.jobCode = row.item.suggestions[0].jobCode; applied++; } });
              document.querySelectorAll('[data-bulk-index]').forEach(select => { const row = s.bulk.rows[Number(select.dataset.bulkIndex)]; select.value = row[select.dataset.bulkField]; });
              document.getElementById('pdAllocationError').textContent = applied ? '' : 'Tidak ada rekomendasi tunggal pada transaksi terpilih.';
              invalidateBulkPreview(); break;
            }
            case 'validate-bulk': await runBulk(button, true); break;
            case 'save-bulk': await runBulk(button, false); break;
            case 'add-part': if (s.draft.parts.length < 100) { s.draft.parts.push({ area: '', jobCode: '', liters: '' }); drawAllocation(); } break;
            case 'export': await exportExcel(); break;
          }
        } catch (error) { setStatus(error.message, 'error'); }
      });
    }
    return load();
  }
  async function openIssue({ code, year, month, area } = {}) {
    if (!s.initialized) await init();
    const yearInput = document.getElementById('pdYear');
    const monthInput = document.getElementById('pdMonth');
    if (yearInput && year) yearInput.value = String(year);
    if (monthInput && month) monthInput.value = String(month);
    s.selectedArea = code === 'FUEL_UNALLOCATED' ? 'fuel' : String(area || '');
    await load();
    await new Promise(resolve => global.requestAnimationFrame(resolve));
    if (s.selectedArea && s.report?.areas.includes(s.selectedArea)) renderActiveTab();
    let target;
    if (code === 'FUEL_UNALLOCATED') target = document.getElementById('pdQueue');
    else {
      const pattern = code === 'MISSING_DENSITY' ? /density/i
        : code === 'MISSING_DISTANCE' ? /jarak/i
          : code === 'MANUAL_SOURCE_INCOMPLETE' ? /Produksi manual belum lengkap/i : null;
      const note = pattern ? [...root().querySelectorAll('.pd-notes')].find(node => pattern.test(node.textContent || '')) : null;
      target = note?.closest('tr') || document.getElementById('pdTables');
    }
    if (!target) return;
    target.classList.add('pd-deeplink-focus');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    global.setTimeout(() => target.classList.remove('pd-deeplink-focus'), 5000);
  }
  global.ProductionData = { init, openIssue };
})(window);
