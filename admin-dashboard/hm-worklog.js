/* Database HM: Input Data HM flows to payroll, with optional audited corrections. */
(() => {
  const state = { rows: [], start: '', end: '', effectiveDate: '', quickFilter: 'all' };
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const fmt = (value) => Number(value || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dates = (start, end) => {
    const result = [];
    const date = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (date <= last && result.length < 31) {
      result.push(date.toISOString().slice(0, 10));
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return result;
  };
  function visibleRows() {
    const q = $('hmWorklogSearch').value.trim().toLocaleLowerCase('id-ID');
    return state.rows.filter((row) => {
      if (state.quickFilter === 'adjusted' && !row.hm_adjusted) return false;
      if (state.quickFilter === 'over' && !(row.payroll_effective && Number(row.payable_hm) > 10)) return false;
      return !q || `${row.nama_operator || ''} ${row.employee_id || ''} ${row.kode_unit || ''}`.toLocaleLowerCase('id-ID').includes(q);
    });
  }
  function renderMatrix(rows) {
    const dayList = dates(state.start, state.end);
    $('hmWorklogMatrixHead').innerHTML = `<tr><th class="hm-worklog-freeze">Operator</th><th>Total HM</th>${dayList.map((day) => `<th>${escape(day.slice(8, 10))} ${escape(new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { month: 'short', timeZone: 'UTC' }))}</th>`).join('')}</tr>`;
    const groups = new Map();
    rows.forEach((row) => {
      const id = row.operator_id || `unknown:${row.id}`;
      if (!groups.has(id)) groups.set(id, { name: row.nama_operator || 'Operator belum dipilih', employeeId: row.employee_id || '', days: new Map(), total: 0 });
      const group = groups.get(id);
      const totalHm = Number(row.payable_hm ?? row.total_hm ?? 0);
      group.days.set(row.tanggal, (group.days.get(row.tanggal) || 0) + totalHm);
      group.total += totalHm;
    });
    $('hmWorklogMatrixBody').innerHTML = groups.size ? [...groups.values()].map((group) => `<tr>
      <th class="hm-worklog-freeze">${escape(group.name)}<small>${escape(group.employeeId)}</small></th>
      <td><strong>${fmt(group.total)}</strong></td>
      ${dayList.map((day) => `<td>${group.days.has(day) ? fmt(group.days.get(day)) : '—'}</td>`).join('')}
    </tr>`).join('') : `<tr><td colspan="${dayList.length + 2}" class="tabel__kosong">Tidak ada data untuk filter ini.</td></tr>`;
  }
  function renderDetails(rows) {
    $('hmWorklogRows').innerHTML = rows.length ? rows.map((row) => {
      const notes = [row.hm_note];
      if (row.hm_adjusted) notes.push(`Diubah admin: ${row.review_reason || ''}`);
      else if (row.adjustment_stale) notes.push('Koreksi lama tidak berlaku; Input Data telah berubah');
      const reason = notes.filter(Boolean).join(' · ') || '—';
      const canEdit = row.payroll_effective && Boolean(row.operator_id)
        && row.total_hm !== null && Number.isFinite(Number(row.total_hm)) && Number(row.total_hm) >= 0;
      return `<tr data-hm-worklog-id="${escape(row.id)}">
        <td>${escape(row.tanggal)}</td><td>${escape(row.nama_shift || '—')}</td>
        <td><strong>${escape(row.nama_operator || 'Belum dipilih')}</strong><small>${escape(row.employee_id || '')}</small></td>
        <td><strong>${escape(row.kode_unit || '—')}</strong></td>
        <td>${fmt(row.hm_start)}</td><td>${fmt(row.hm_finish)}</td>
        <td><strong>${row.payable_hm === null ? fmt(row.total_hm) : fmt(row.payable_hm)}</strong></td>
        <td class="hm-worklog-reason" title="${escape(reason)}">${row.hm_note === 'HM Over, perlu verifikasi' ? `<span class="hm-worklog-pill is-over">${escape(row.hm_note)}</span>${notes.length > 1 ? `<small>${escape(notes[1])}</small>` : ''}` : escape(reason)}</td>
        <td><button type="button" class="tombol tombol--ghost tombol--kecil" data-hm-edit="${escape(row.id)}" ${canEdit ? '' : 'disabled title="Periode historis atau HM sumber belum lengkap"'}>Edit</button>
        ${row.work_log_id ? `<button type="button" class="tombol tombol--ghost tombol--kecil" data-hm-history="${escape(row.id)}">Riwayat</button>` : ''}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="9" class="tabel__kosong">Tidak ada Work Log pada periode atau filter ini.</td></tr>';
  }
  function render() {
    const rows = visibleRows();
    const summaryRows = state.rows;
    renderMatrix(rows);
    renderDetails(rows);
    const total = summaryRows.reduce((sum, row) => sum + Number(row.payable_hm ?? row.total_hm ?? 0), 0);
    $('hmWorklogTotal').textContent = `${fmt(total)} jam`;
    $('hmWorklogAdjusted').textContent = summaryRows.filter((row) => row.hm_adjusted).length.toLocaleString('id-ID');
    $('hmWorklogPending').textContent = summaryRows.filter((row) => row.payroll_effective && Number(row.payable_hm) > 10).length.toLocaleString('id-ID');
    $('hmWorklogAdjustedFilter').classList.toggle('is-active', state.quickFilter === 'adjusted');
    $('hmWorklogOverFilter').classList.toggle('is-active', state.quickFilter === 'over');
    $('hmWorklogAdjustedFilter').setAttribute('aria-pressed', String(state.quickFilter === 'adjusted'));
    $('hmWorklogOverFilter').setAttribute('aria-pressed', String(state.quickFilter === 'over'));
  }
  async function load({ propagateError = false } = {}) {
    const start = $('hmWorklogStart').value;
    const end = $('hmWorklogEnd').value;
    const message = $('hmWorklogMessage');
    if (!start || !end || start > end) { message.textContent = 'Pilih rentang tanggal yang valid.'; return; }
    const count = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
    if (count > 31) { message.textContent = 'Rentang tanggal maksimal 31 hari.'; return; }
    message.textContent = 'Memuat data HM dari Input Data…';
    try {
      const result = await api(`/api/admin/hm/worklogs?tanggal_mulai=${encodeURIComponent(start)}&tanggal_akhir=${encodeURIComponent(end)}`);
      state.rows = result.rows || [];
      state.start = start;
      state.end = end;
      state.effectiveDate = result.effective_date || '';
      message.textContent = `Menampilkan ${state.rows.length} Work Log. Payroll memakai sumber Input Data mulai ${state.effectiveDate || 'tanggal efektif migrasi'}; periode sebelumnya tetap memakai HM historis.`;
      render();
    } catch (error) {
      message.textContent = `Gagal memuat Database HM: ${error.message}`;
      state.rows = [];
      state.start = start;
      state.end = end;
      render();
      $('hmWorklogRows').innerHTML = '<tr><td colspan="9" class="tabel__kosong">Data belum dapat dimuat.</td></tr>';
      if (propagateError) throw error;
    }
  }
  function openEdit(row) {
    bukaModal(`<h3>Edit Total HM</h3><p class="hm-worklog-modal-context">${escape(row.tanggal)} · ${escape(row.nama_operator)} · ${escape(row.kode_unit)} · ${escape(row.nama_shift || '')}</p>
      <form id="hmWorklogEditForm">
        <div class="hm-worklog-edit-grid"><label>HM Input Data<input value="${fmt(row.total_hm)} jam" readonly /></label>
        <label>Total HM<input id="hmWorklogPaidInput" type="number" min="0" max="24" step="0.01" value="${escape(row.hm_adjusted ? row.review_paid_hm : row.total_hm)}" required /></label></div>
        <label class="hm-worklog-edit-reason">Alasan koreksi<input id="hmWorklogReasonInput" value="${escape(row.hm_adjusted ? row.review_reason : '')}" minlength="5" maxlength="500" required placeholder="Jelaskan dasar perubahan Total HM" /></label>
        <p id="hmWorklogEditError" class="modal__pesan modal__pesan--error" hidden></p>
        <div class="modal__aksi"><button type="button" class="tombol tombol--ghost" id="hmWorklogCancel">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Koreksi</button></div>
      </form>`);
    $('hmWorklogCancel').addEventListener('click', tutupModal);
    $('hmWorklogEditForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.submitter || $('hmWorklogEditForm').querySelector('[type=submit]');
      const paid = Number($('hmWorklogPaidInput').value);
      const reason = $('hmWorklogReasonInput').value.trim();
      const errorEl = $('hmWorklogEditError');
      errorEl.hidden = true;
      try {
        await window.OMOSActionFeedback.run(button, async () => {
          await apiJson(`/api/admin/hm/worklogs/${encodeURIComponent(row.id)}/adjustment`, 'PATCH', { paid_hm: paid, reason });
          await load({ propagateError: true });
          tutupModal();
        });
      } catch (error) { errorEl.textContent = error.message; errorEl.hidden = false; }
    });
  }
  async function openHistory(row) {
    const result = await api(`/api/admin/hm/worklogs/${encodeURIComponent(row.id)}/history`);
    bukaModal(`<h3>Riwayat Koreksi HM</h3><p>${escape(row.nama_operator)} · ${escape(row.kode_unit)}</p><div class="hm-worklog-history">${(result.rows || []).map((item) => `<div><strong>${escape(new Date(item.changed_at).toLocaleString('id-ID'))}</strong> · ${escape(item.changed_by_name || 'Admin')}<br>HM dibayar: ${fmt(item.previous_value?.paid_hm || 0)} → ${fmt(item.new_value?.paid_hm)} jam<br>Alasan: ${escape(item.new_value?.reason || '—')}</div>`).join('') || 'Belum ada perubahan.'}</div><div class="modal__aksi"><button type="button" class="tombol tombol--ghost" id="hmWorklogHistoryClose">Tutup</button></div>`);
    $('hmWorklogHistoryClose').addEventListener('click', tutupModal);
  }
  async function exportExcel() {
    const query = `tanggal_mulai=${encodeURIComponent($('hmWorklogStart').value)}&tanggal_akhir=${encodeURIComponent($('hmWorklogEnd').value)}`;
    const response = await fetch(`${getApiBaseUrl()}/api/admin/hm/worklogs/export?${query}`, { headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` } });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Ekspor gagal (${response.status})`); }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `Database_HM_${state.start}_${state.end}.xlsx`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  $('hmWorklogStart').value = `${today.slice(0, 7)}-01`;
  $('hmWorklogEnd').value = today;
  $('hmWorklogLoad').addEventListener('click', load);
  $('hmWorklogSearch').addEventListener('input', render);
  $('hmWorklogAdjustedFilter').addEventListener('click', () => {
    state.quickFilter = state.quickFilter === 'adjusted' ? 'all' : 'adjusted';
    render();
  });
  $('hmWorklogOverFilter').addEventListener('click', () => {
    state.quickFilter = state.quickFilter === 'over' ? 'all' : 'over';
    render();
  });
  $('hmWorklogRows').addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-hm-edit]');
    const history = event.target.closest('[data-hm-history]');
    const row = state.rows.find((item) => item.id === (edit?.dataset.hmEdit || history?.dataset.hmHistory));
    if (!row) return;
    if (edit) openEdit(row);
    else if (history) try { await openHistory(row); } catch (error) { alert(error.message); }
  });
  $('hmWorklogExport').addEventListener('click', async (event) => {
    try { await window.OMOSActionFeedback.run(event.currentTarget, exportExcel, { loadingText: 'Menyiapkan Excel…' }); }
    catch (error) { alert(error.message); }
  });
  $('hmWorklogImport').addEventListener('click', () => $('hmWorklogImportFile').click());
  $('hmWorklogImportFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const button = $('hmWorklogImport');
    try {
      await window.OMOSActionFeedback.run(button, async () => {
        const form = new FormData(); form.append('excel', file);
        const response = await fetch(`${getApiBaseUrl()}/api/admin/hm/worklogs/import`, {
          method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` }, body: form,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Impor gagal (${response.status})`);
        await load({ propagateError: true });
        $('hmWorklogMessage').textContent = result.message;
      });
    } catch (error) { $('hmWorklogMessage').textContent = `Gagal impor: ${error.message}`; }
    finally { event.target.value = ''; }
  });
  window.OMOSHM = { load };
})();
