'use strict';

(function cutiModule() {
  const stateData = { view: 'jadwal', year: String(new Date().getFullYear()), department: '', position: '',
    status: 'all', search: '', mode: localStorage.getItem('omos_cuti_mode') || 'list',
    dashboard: [], detail: null, detailYear: '', policies: [], recon: [],
    calMonth: '', calRows: [], employees: null, policyScopes: null, loaded: false };
  const TYPE_LABEL = { CP: 'Periodik', CK: 'Khusus', CT: 'Tahunan' };
  const STATUS_LABEL = { DRAFT: 'Draft', SUBMITTED: 'Diajukan', SUPERVISOR_APPROVED: 'Disetujui Atasan',
    APPROVED: 'Terjadwal / Disetujui HR', REALIZED: 'Terealisasi', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan' };
  const ROW_STATUS_LABEL = { AMAN: 'Aman', JATUH_TEMPO: 'Jatuh tempo ≤30 hari',
    REKONSILIASI: 'Perlu rekonsiliasi', HABIS: 'Sisa habis', BELUM_SETUP: 'Belum setup kebijakan' };
  const ID_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const esc = value => String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const fmtDate = value => value ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`)) : '—';
  const addIsoDays = (value, days) => {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(days));
    return date.toISOString().slice(0, 10);
  };
  const weeks = days => Number(days || 0) / 7;
  const policyLabel = row => row && row.policy_version_id
    ? `${weeks(row.policy_work_days)}:${weeks(row.policy_leave_days)} minggu`
    : 'Belum setup';
  const idempotency = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

  async function request(path, options) {
    if (!options && typeof api === 'function') return api(path);
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(state?.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options?.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function runFeedback(button, task, texts) {
    if (window.OMOSActionFeedback) return window.OMOSActionFeedback.run(button, task, texts);
    return task();
  }

  async function setView(view) {
    stateData.view = view;
    ['jadwal', 'cuti', 'kebijakan'].forEach(name => {
      const section = document.getElementById(name === 'jadwal' ? 'rosterScheduleView' : name === 'cuti' ? 'cutiView' : 'cutiPolicyView');
      if (section) section.hidden = name !== view;
    });
    document.querySelectorAll('[data-cuti-view]').forEach(button => button.classList.toggle('is-active', button.dataset.cutiView === view));
    if (view === 'kebijakan') {
      try {
        const [polRes, scopes] = await Promise.all([
          request('/api/admin/cuti/policies'),
          policyScopeOptions(true),
        ]);
        stateData.policies = polRes.rows || polRes || [];
        stateData.policyScopes = scopes;
      } catch (err) {
        console.error('Gagal memuat kebijakan:', err);
      }
      render();
    } else if (view !== 'jadwal' && !stateData.loaded) {
      loadDashboard();
    } else {
      render();
    }
  }

  function dashboardQuery() {
    const params = new URLSearchParams({ year: stateData.year });
    if (stateData.department) params.set('department', stateData.department);
    if (stateData.position) params.set('position', stateData.position);
    if (stateData.status && stateData.status !== 'all') params.set('status', stateData.status);
    if (stateData.search) params.set('search', stateData.search);
    return params.toString();
  }

  async function loadDashboard() {
    const container = document.getElementById('cutiView');
    if (container && !stateData.dashboard.length) container.querySelector('.cuti-dynamic').innerHTML = '<div class="tabel__kosong">Memuat Database Cuti...</div>';
    try {
      const [data, policies, scopes] = await Promise.all([
        request(`/api/admin/cuti/dashboard?${dashboardQuery()}`),
        request('/api/admin/cuti/policies'),
        request('/api/admin/cuti/policy-scopes'),
      ]);
      stateData.dashboard = data.rows || [];
      stateData.policies = policies.rows || policies || [];
      stateData.policyScopes = scopes.rows || scopes || [];
      stateData.loaded = true;
    } catch (error) {
      const requestedMode = new URLSearchParams(window.location.search).get('api_mode')
        || sessionStorage.getItem('omos_local_api_mode') || '';
      const modeHint = requestedMode === 'local'
        ? `<p style="margin:10px 0 0;color:#64748b">Mode API lokal dapat memakai database pengembangan yang belum memiliki modul cuti. `
          + `<a href="${esc(`${window.location.pathname}?api_mode=biznet`)}" style="color:#0f766e;font-weight:800">Buka data Biznet</a>.</p>`
        : '';
      const failure = `<div class="cuti-card"><div class="tabel__kosong" style="color:#b91c1c"><b>Database Cuti tidak dapat dimuat.</b>`
        + `<p style="margin:8px 0 0">${esc(error.message)}</p>${modeHint}</div></div>`;
      if (container) container.querySelector('.cuti-dynamic').innerHTML = failure;
      const policyView = document.getElementById('cutiPolicyView');
      if (policyView && stateData.view === 'kebijakan') policyView.innerHTML = failure;
      return;
    }
    render();
  }

  function kpi(label, value, sub, accent, isHighlight = false) {
    return `<div class="cuti-kpi${isHighlight ? ' cuti-kpi--highlight' : ''}" style="--accent:${accent}"><span>${label}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;
  }

  function countAktual(row) {
    const events = eventsOf(row);
    const cpActive = events.filter(item =>
      item.leave_type === 'CP' && !['REJECTED', 'CANCELLED'].includes(item.request_status || item.status)
    );
    const cycleCount = new Set(cpActive.map(item => item.cycle_no || item.request_id || item.id)).size;
    return Math.max(Number(row.aktual || 0), cycleCount);
  }

  function latestRealisasiHtml(row) {
    const events = eventsOf(row);
    const valid = events.filter(item =>
      item.request_status !== 'REJECTED' && item.request_status !== 'CANCELLED' && item.realisation_status !== 'CANCELLED'
    );
    if (!valid.length) return '<span style="color:#94a3b8">—</span>';

    const sorted = [...valid].sort((a, b) => {
      const dateA = a.actual_start || a.planned_start || '';
      const dateB = b.actual_start || b.planned_start || '';
      return dateB.localeCompare(dateA);
    });

    const latest = sorted[0];
    const cycleNo = latest.cycle_no;
    const cycleEvents = cycleNo ? valid.filter(e => Number(e.cycle_no) === Number(cycleNo)) : [latest];
    const startDate = cycleEvents.map(e => e.actual_start || e.planned_start).filter(Boolean).sort()[0];
    const endDate = cycleEvents.map(e => e.actual_end || e.planned_end).filter(Boolean).sort().at(-1);
    const hasActual = cycleEvents.some(e => e.actual_start && e.realisation_id);

    if (!startDate || !endDate) return '<span style="color:#94a3b8">—</span>';

    const cycleLabel = cycleNo ? `Cuti ${cycleNo}` : (latest.leave_type || 'CP');
    const badgeClass = hasActual ? 'cuti-badge--ok' : 'cuti-badge--warn';
    const statusLabel = hasActual ? 'Aktual' : 'Jadwal';

    return `<div style="line-height:1.3">`
      + `<b>${rangeText(startDate, endDate)}</b>`
      + `<br><small class="cuti-sub-info">${esc(cycleLabel)} · <span class="cuti-badge ${badgeClass}" style="font-size:10px;padding:1px 5px">${statusLabel}</span></small>`
      + `</div>`;
  }

  function summaryKpis() {
    const rows = stateData.dashboard;
    const aktif = rows.length;
    const hak = rows.reduce((sum, row) => sum + Number(row.hak_periode || 0), 0);
    const totalAktual = rows.reduce((sum, row) => sum + countAktual(row), 0);
    const totalSisa = rows.reduce((sum, row) => sum + Math.max(Number(row.hak_periode || 0) - countAktual(row), 0), 0);
    const tempo = rows.filter(row => row.status === 'JATUH_TEMPO').length;
    const recon = rows.filter(row => row.status === 'REKONSILIASI').length;
    return `<div class="cuti-kpis">${kpi('Karyawan aktif', aktif, 'dalam filter', '#0f766e')}`
      + `${kpi('Hak periode', hak, `tahun ${esc(stateData.year)}`, '#0284c7')}`
      + `${kpi('Aktual', totalAktual, 'periode terealisasi / diajukan', '#7c3aed', true)}`
      + `${kpi('Sisa cuti', totalSisa, 'periode', '#059669')}`
      + `${kpi('Jatuh tempo ≤30 hari', tempo, 'karyawan', '#d97706')}`
      + `${kpi('Perlu rekonsiliasi', recon, 'CP vs roster', '#dc2626')}</div>`;
  }

  function badgeFor(status) {
    return `<span class="cuti-badge cuti-badge--${status}">${esc(ROW_STATUS_LABEL[status] || status)}</span>`;
  }

  function eventsOf(row) {
    if (Array.isArray(row.leave_events)) return row.leave_events;
    try { return JSON.parse(row.leave_events || '[]'); } catch (_) { return []; }
  }

  function inclusiveEventDays(event) {
    if (event.actual_days != null) return Number(event.actual_days) || 0;
    if (!event.planned_start || !event.planned_end) return 0;
    const start = new Date(`${String(event.planned_start).slice(0, 10)}T00:00:00Z`);
    const end = new Date(`${String(event.planned_end).slice(0, 10)}T00:00:00Z`);
    return Math.max(0, Math.round((end - start) / 86400000) + 1);
  }

  function rangeText(start, end) {
    return start && end ? `${fmtDate(start)} s.d. ${fmtDate(end)}` : '—';
  }

  function listHtml() {
    if (!stateData.dashboard.length) return '<div class="tabel__kosong">Tidak ada karyawan pada filter ini.</div>';
    return `<div class="cuti-wrap"><table class="cuti-table"><thead><tr><th>Karyawan</th><th>Departemen / Jabatan</th><th>Kebijakan</th><th>Hak</th><th>Realisasi</th><th>Aktual</th><th>Sisa cuti</th><th>Proyeksi berikutnya</th><th>Status</th></tr></thead><tbody>`
      + stateData.dashboard.map(row => {
        const aktualVal = countAktual(row);
        const sisaVal = Math.max(Number(row.hak_periode || 0) - aktualVal, 0);
        return `<tr class="cuti-row" data-cuti-card-modal="${esc(row.id)}" style="cursor:pointer" title="Klik untuk membuka kartu cuti ${esc(row.nama)}">`
          + `<td data-label="Karyawan"><b>${esc(row.nama)}</b><br><small>${esc(row.employee_id || '—')}</small></td>`
          + `<td data-label="Dept/Jabatan">${esc(row.departemen || '—')}<br><small>${esc(row.jabatan || '—')}</small></td>`
          + `<td data-label="Kebijakan">${policyLabel(row)}</td>`
          + `<td data-label="Hak">${row.hak_periode} periode</td>`
          + `<td data-label="Realisasi">${latestRealisasiHtml(row)}</td>`
          + `<td data-label="Aktual"><span class="cuti-aktual-highlight">${aktualVal} periode</span></td>`
          + `<td data-label="Sisa">${sisaVal} periode · ${row.sisa_tahunan} hari/thn</td>`
          + `<td data-label="Proyeksi">${row.next_leave_start ? fmtDate(row.next_leave_start) : '—'}</td>`
          + `<td data-label="Status">${badgeFor(row.status)}</td></tr>`;
      }).join('') + `</tbody></table></div>`;
  }

  function personCardHtml(row) {
    const events = eventsOf(row);
    const aktualVal = countAktual(row);
    const sisaVal = Math.max(Number(row.hak_periode || 0) - aktualVal, 0);
    const maxCycle = Math.max(Number(row.hak_periode || 0), ...events.map(item => Number(item.cycle_no || 0)), 1);
    let annualRemaining = Number(row.annual_entitlement_days || 12)
      + Number(row.carry_forward_days || 0) + Number(row.annual_adjustment_days || 0);
    const cycleRows = Array.from({ length: maxCycle }, (_, index) => {
      const cycle = index + 1;
      const group = events.filter(item => Number(item.cycle_no || 0) === cycle);
      const projection = (row.cycle_projections || []).find(item => Number(item.cycle_no) === cycle);
      const cp = group.find(item => item.leave_type === 'CP');
      const ck = group.filter(item => item.leave_type === 'CK');
      const ct = group.filter(item => item.leave_type === 'CT');
      const cpDays = Number(row.policy_leave_days || 0);
      const ckScheduledDays = ck.reduce((sum, item) => sum + inclusiveEventDays(item), 0);
      const ctScheduledDays = ct.reduce((sum, item) => sum + inclusiveEventDays(item), 0);
      const ckRealisedDays = ck.filter(item => item.realisation_id).reduce((sum, item) => sum + inclusiveEventDays(item), 0);
      const ctRealisedDays = ct.filter(item => item.realisation_id).reduce((sum, item) => sum + inclusiveEventDays(item), 0);
      annualRemaining -= ctRealisedDays;
      const parts = [`CP ${cpDays || '—'} hari`];
      if (ckScheduledDays) parts.push(`CK ${ckScheduledDays} hari`);
      if (ctScheduledDays) parts.push(`CT ${ctScheduledDays} hari`);
      const cpVariance = cp && cp.realisation_id ? Number(cp.variance_days || 0) : null;
      const cpBadge = cpVariance == null ? '' : cpVariance === 0
        ? '<span class="cuti-badge cuti-badge--ok">Sesuai</span>'
        : `<span class="cuti-badge cuti-badge--warn">${esc(cp.counting_status || 'VARIANCE')} ${cpVariance > 0 ? '+' : ''}${cpVariance}</span>`;
      const planned = group.length ? rangeText(group.map(item => item.planned_start).sort()[0], group.map(item => item.planned_end).sort().at(-1)) : '—';
      const targetId = cp?.application_group_id || cp?.request_id || group[0]?.application_group_id || group[0]?.request_id;
      const isEditable = group.length > 0 && group.every(item => (item.request_status || item.status || 'DRAFT') === 'DRAFT');
      const hasRealized = group.some(item => (item.request_status || item.status) === 'REALIZED' || item.realisation_id);
      const actionButtons = [];
      if (!cp && projection) {
        actionButtons.push(`<button type="button" class="tombol tombol--utama tombol--kecil" data-cuti-cycle-apply="${esc(row.id)}" data-cuti-cycle-no="${cycle}">+ Pengajuan Cuti</button>`);
      }
      if (group.length > 0) {
        if (isEditable) {
          actionButtons.push(`<button type="button" class="tombol tombol--ghost tombol--kecil" data-cuti-cycle-edit="${esc(targetId)}" data-cuti-cycle-user="${esc(row.id)}" data-cuti-cycle-no="${cycle}" title="Edit Pengajuan Cuti ${cycle}">Edit</button>`);
        }
        if (!hasRealized) {
          actionButtons.push(`<button type="button" class="tombol tombol--danger tombol--kecil" data-cuti-cycle-delete="${esc(targetId)}" data-cuti-cycle-user="${esc(row.id)}" data-cuti-cycle-no="${cycle}" title="Hapus Pengajuan Cuti ${cycle}">Hapus</button>`);
        }
      }
      return `<tr data-cuti-detail="${esc(row.id)}" title="Buka detail pengajuan, approval, dan audit"><td><b>Cuti ${cycle}</b>${actionButtons.length ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${actionButtons.join('')}</div>` : ''}</td>`
        + `<td>${planned}<br><small>${parts.join(' + ')} = ${cpDays + ckScheduledDays + ctScheduledDays} hari</small></td>`
        + `<td>${projection ? rangeText(projection.projected_start, projection.projected_end) : '—'}</td>`
        + `<td>${cp && cp.realisation_id ? rangeText(cp.actual_start, cp.actual_end) : '—'} ${cpBadge}</td>`
        + `<td>${ckRealisedDays || '—'}</td><td>${ck.map(item => esc(item.reason || '—')).join('<br>') || '—'}</td>`
        + `<td>${ctRealisedDays || '—'}</td><td>${Math.max(annualRemaining, 0)} hari</td></tr>`;
    }).join('');

    return `<article class="cuti-person"><div class="cuti-person-head"><b>${esc(row.nama)}</b>`
      + `DEPARTEMEN: ${esc(row.departemen || '—')} · JABATAN: ${esc(row.jabatan || '—')}<br>PERIODE CUTI: ${policyLabel(row)}<br>`
      + `HAK: ${row.hak_periode} periode · AKTUAL: <span class="cuti-aktual-highlight">${aktualVal} periode</span> · SISA: ${sisaVal} periode · ${row.sisa_tahunan} hari/thn<br>`
      + `PROYEKSI: ${row.next_leave_start ? fmtDate(row.next_leave_start) : '—'} · ${badgeFor(row.status)}</div>`
      + `<div class="cuti-cycle-wrap"><table class="cuti-cycle"><thead><tr><th rowspan="2">Siklus</th><th rowspan="2">Jadwal Cuti</th><th colspan="2">Cuti Periodik</th><th colspan="2">Cuti Khusus</th><th colspan="2">Cuti Tahunan</th></tr><tr><th>Proyeksi</th><th>Realisasi</th><th>Realisasi</th><th>Ket.</th><th>Realisasi</th><th>Sisa</th></tr></thead><tbody>${cycleRows}</tbody></table></div>`
      + `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="tombol tombol--ghost" data-cuti-detail="${esc(row.id)}">Detail &amp; Audit</button></div></article>`;
  }

  function cardHtml() {
    if (!stateData.dashboard.length) return '<div class="tabel__kosong">Tidak ada karyawan pada filter ini.</div>';
    const legend = '<p style="font-size:12px;color:#64748b;margin:0 0 10px">Legenda — CP: Proyeksi/realisasi cuti periodik dari kebijakan roster · CK: cuti khusus, tidak mengurangi hak tahunan · CT: cuti tahunan, mengurangi saldo tahunan.</p>';
    return legend + `<div class="cuti-person-cards">` + stateData.dashboard.map(row => personCardHtml(row)).join('') + `</div>`;
  }

  function drawerHtml() {
    const detail = stateData.detail;
    if (!detail) return '';
    const emp = detail.employee;
    const reqRows = (detail.requests || []).map(item => {
      const isDraft = item.status === 'DRAFT';
      const isRealized = item.status === 'REALIZED';
      const targetId = item.application_group_id || item.id;
      return `<li><b>${esc(TYPE_LABEL[item.leave_type] || item.leave_type)}</b> `
        + `${fmtDate(item.planned_start)} s.d. ${fmtDate(item.planned_end)} — ${esc(STATUS_LABEL[item.status] || item.status)}`
        + (item.supervisor_at ? ` · Atasan ${fmtDate(item.supervisor_at)}` : '')
        + (item.hr_at ? ` · HR ${fmtDate(item.hr_at)}` : '')
        + (item.reject_reason ? ` · Alasan: ${esc(item.reject_reason)}` : '')
        + ` <button type="button" class="tombol tombol--ghost tombol--kecil" data-cuti-trx="${esc(item.id)}" data-cuti-status="${esc(item.status)}">Kelola</button>`
        + (isDraft ? ` <button type="button" class="tombol tombol--ghost tombol--kecil" data-cuti-cycle-edit="${esc(targetId)}" data-cuti-cycle-user="${esc(emp.id)}" data-cuti-cycle-no="${item.cycle_no || ''}">Edit</button>` : '')
        + (!isRealized ? ` <button type="button" class="tombol tombol--danger tombol--kecil" data-cuti-cycle-delete="${esc(targetId)}" data-cuti-cycle-user="${esc(emp.id)}" data-cuti-cycle-no="${item.cycle_no || ''}">Hapus</button>` : '')
        + `</li>`;
    }).join('');
    const realRows = (detail.realisations || []).map(item => `<li>${fmtDate(item.actual_start)} s.d. ${fmtDate(item.actual_end)} `
      + `(${item.actual_days} hari, ${item.period_count} periode, ${esc(item.counting_status || '—')}, varians ${item.variance_days >= 0 ? '+' : ''}${item.variance_days}) — ${esc(item.status)}`
      + ` <button type="button" class="tombol tombol--ghost" data-cuti-koreksi="${esc(item.id)}">Koreksi</button>`
      + (item.status !== 'CANCELLED' ? ` <button type="button" class="tombol tombol--ghost" data-cuti-batal-realisasi="${esc(item.id)}">Batalkan</button>` : '') + `</li>`).join('');
    const cpRows = (detail.roster_cp || []).map(item => `${fmtDate(item.tanggal)}${item.source === 'leave_sync' ? '' : ` (${esc(item.source)})`}`).join(', ');
    const auditRows = (detail.audits || []).slice(0, 20).map(item => `<li>${fmtDate(item.created_at)} · ${esc(item.actor_nama || 'sistem')} · ${esc(item.action)} ${esc(item.entity)}${item.reason ? ` · ${esc(item.reason)}` : ''}</li>`).join('');
    return `<div class="cuti-drawer"><h4>${esc(emp.nama)} — ${esc(stateData.detailYear)}</h4>`
      + `<p class="cuti-drawer-sub">Hak ${detail.entitlement ? detail.entitlement.period_entitlement : '—'} periode · Sisa tahunan terlampir pada ringkasan.</p>`
      + `<h4>Pengajuan &amp; Approval</h4><ul class="cuti-timeline">${reqRows || '<li>Belum ada pengajuan.</li>'}</ul>`
      + `<h4>Realisasi</h4><ul class="cuti-timeline">${realRows || '<li>Belum ada realisasi.</li>'}</ul>`
      + `<h4>CP Roster turunan</h4><p style="font-size:13px">${cpRows ? esc(cpRows) : '—'}</p>`
      + `<h4>Audit (20 terbaru)</h4><ul class="cuti-timeline">${auditRows || '<li>—</li>'}</ul>`
      + `<div style="margin-top:8px"><button type="button" class="tombol tombol--ghost" data-cuti-drawer-tutup>Tutup</button></div></div>`;
  }

  function policyHtml() {
    const rows = (stateData.policies || []).filter(item => item.leave_type === 'CP').map(item => `<tr><td data-label="Dept/Jabatan">${esc(item.department || '—')}<br><small>${esc(item.position || '—')}</small></td>`
      + `<td data-label="Karyawan">${item.target_user_id ? `${esc(item.target_user_name || 'Karyawan spesifik')}<br><small>${esc(item.target_employee_id || '')}</small>` : 'Semua karyawan pada jabatan'}</td>`
      + `<td data-label="Cuti Periodik">${weeks(item.work_days)}:${weeks(item.leave_days)} minggu<br><small>Siklus ${weeks(Number(item.work_days) + Number(item.leave_days))} minggu</small></td>`
      + `<td data-label="Cuti Tahunan">${Number(item.annual_days || 0)} hari</td>`
      + `<td data-label="Berlaku">${fmtDate(item.effective_from)}${item.effective_to ? ` s.d. ${fmtDate(item.effective_to)}` : ' →'} · v${item.version_no}</td>`
      + `<td data-label="Status">${item.is_active ? '<span class="cuti-badge cuti-badge--ok">Aktif</span>' : '<span class="cuti-badge cuti-badge--info">Nonaktif</span>'}</td>`
      + `<td data-label="Aksi"><div class="cuti-policy-actions"><button type="button" class="tombol tombol--ghost" data-cuti-policy-edit="${esc(item.id)}">Edit</button>`
      + `<button type="button" class="tombol tombol--danger" data-cuti-policy-delete="${esc(item.id)}">Hapus</button></div></td></tr>`).join('');
    return `<div class="cuti-card"><h3>Atur Roster Cuti</h3><p class="sub">CP mengikuti siklus kerja/cuti dalam minggu. CT adalah saldo hari independen; CK dan CT tidak memengaruhi hitungan siklus CP.</p>`
      + `<div class="cuti-actions" style="margin-bottom:12px"><button type="button" class="tombol tombol--utama" data-cuti-policy-baru>+ Kebijakan Baru</button></div>`
      + `<div class="cuti-wrap"><table class="cuti-table"><thead><tr><th>Dept / Jabatan</th><th>Karyawan</th><th>Cuti Periodik</th><th>Cuti Tahunan</th><th>T0</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7">Belum ada kebijakan.</td></tr>'}</tbody></table></div></div>`;
  }

  function reconHtml() {
    const rows = (stateData.recon || []).map(item => `<tr><td data-label="Tanggal">${fmtDate(item.tanggal)}</td>`
      + `<td data-label="Karyawan">${esc(item.nama)}<br><small>${esc(item.departemen || '')}</small></td>`
      + `<td data-label="Harapan">CP</td><td data-label="Aktual">${esc(item.actual_status || '—')}</td>`
      + `<td data-label="Status"><span class="cuti-badge ${item.state === 'OVERRIDDEN' ? 'cuti-badge--warn' : 'cuti-badge--bad'}">${esc(item.state)}</span></td></tr>`).join('');
    return `<div class="cuti-card"><h3>Rekonsiliasi Roster</h3><p class="sub">Jadwal/realisasi Database Cuti yang belum sama dengan CP roster. Override manual yang sah tidak dihapus; selesaikan manual di Jadwal Roster.</p>`
      + `<div class="cuti-actions" style="margin-bottom:12px"><button type="button" class="tombol tombol--ghost" data-cuti-recon-jalan>Jalankan Rekonsiliasi</button></div>`
      + `<div class="cuti-wrap"><table class="cuti-table"><thead><tr><th>Tanggal</th><th>Karyawan</th><th>Harapan</th><th>Aktual</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Tidak ada perbedaan. Database Cuti dan roster selaras.</td></tr>'}</tbody></table></div></div>`;
  }

  function render() {
    if (stateData.view === 'jadwal') return;
    const view = document.getElementById('cutiView');
    if (view && stateData.view === 'cuti') {
      const yearOptions = [];
      const currentYear = new Date().getFullYear();
      for (let year = currentYear - 1; year <= currentYear + 1; year += 1) yearOptions.push(`<option value="${year}"${String(year) === stateData.year ? ' selected' : ''}>${year}</option>`);
      const departments = stateData.policyScopes || [];
      const selectedDepartment = departments.find(item => item.department === stateData.department);
      const departmentOptions = departments.map(item => `<option value="${esc(item.department)}"${item.department === stateData.department ? ' selected' : ''}>${esc(item.department)}</option>`).join('');
      const positionOptions = (selectedDepartment?.positions || []).map(item => `<option value="${esc(item.position)}"${item.position === stateData.position ? ' selected' : ''}>${esc(item.position)}</option>`).join('');
      view.querySelector('.cuti-dynamic').innerHTML = summaryKpis()
        + `<div class="cuti-card"><div class="cuti-toolbar" style="padding:0;border:0;margin-bottom:12px"><div class="cuti-filters">`
        + `<select id="cutiYear" class="input-filter">${yearOptions.join('')}</select>`
        + `<select id="cutiDept" class="input-filter" aria-label="Filter Departemen"><option value="">Departemen: Semua</option>${departmentOptions}</select>`
        + `<select id="cutiPos" class="input-filter" aria-label="Filter Jabatan"${selectedDepartment ? '' : ' disabled'}><option value="">${selectedDepartment ? 'Jabatan: Semua' : 'Pilih Departemen dahulu'}</option>${positionOptions}</select>`
        + `<select id="cutiStatus" class="input-filter"><option value="all">Status: Semua</option>`
        + ['AMAN', 'JATUH_TEMPO', 'REKONSILIASI', 'HABIS', 'BELUM_SETUP'].map(value => `<option value="${value}"${stateData.status === value ? ' selected' : ''}>${ROW_STATUS_LABEL[value]}</option>`).join('') + `</select>`
        + `<input id="cutiSearch" class="input-filter" placeholder="Cari nama/NIK" value="${esc(stateData.search)}" />`
        + `<button type="button" class="tombol tombol--utama" data-cuti-tampilkan>Tampilkan</button></div>`
        + `<div class="cuti-actions"><button type="button" class="tombol tombol--utama" data-cuti-pengajuan-umum>+ Pengajuan Cuti</button><div class="cuti-segmented" style="margin:0"><button type="button" data-cuti-mode="list" class="${stateData.mode === 'list' ? 'is-active' : ''}">List</button><button type="button" data-cuti-mode="card" class="${stateData.mode === 'card' ? 'is-active' : ''}">Card</button></div>`
        + `<button type="button" class="tombol tombol--ghost" data-cuti-kalender>Kalender Cuti</button>`
        + `<button type="button" class="tombol tombol--ghost" data-cuti-export>Export</button></div></div>`
        + (stateData.mode === 'list' ? listHtml() : cardHtml()) + drawerHtml() + `</div>`
        + reconHtml();
      bindDynamic(view);
    }
    const policyView = document.getElementById('cutiPolicyView');
    if (policyView && stateData.view === 'kebijakan') {
      policyView.innerHTML = policyHtml();
      bindDynamic(policyView);
    }
  }

  async function openDetail(userId) {
    stateData.detailYear = stateData.year;
    try {
      stateData.detail = await request(`/api/admin/cuti/detail?user_id=${encodeURIComponent(userId)}&year=${encodeURIComponent(stateData.year)}`);
    } catch (error) { window.alert(error.message); return; }
    if (stateData.mode !== 'card') {
      // Pada mode List, tampilkan drawer di bawah tabel.
      render();
      const drawer = document.querySelector('#cutiView .cuti-drawer');
      if (drawer) drawer.scrollIntoView({ block: 'nearest' });
    } else {
      // Mode Card butuh realisasi per baris: muat ulang dashboard + detail tiap kartu terlihat.
      render();
    }
  }

  function transitionOptions(status) {
    return { DRAFT: ['SUBMITTED', 'CANCELLED'], SUBMITTED: ['SUPERVISOR_APPROVED', 'REJECTED', 'CANCELLED'], SUPERVISOR_APPROVED: ['APPROVED', 'REJECTED', 'CANCELLED'], APPROVED: ['REALIZED', 'CANCELLED'], REALIZED: [], REJECTED: [], CANCELLED: [] }[status] || [];
  }

  function openTransition(requestId, status) {
    const options = transitionOptions(status);
    if (!options.length) { window.alert('Pengajuan pada status akhir tidak dapat diubah.'); return; }
    const source = stateData.detail?.requests?.find(item => String(item.id) === String(requestId));
    bukaModal(`<h3>Kelola Pengajuan</h3><form id="cutiTrxForm"><div class="cuti-modal-grid">`
      + `<label class="span-2">Target<select id="cutiTrxTarget">${options.map(value => `<option value="${value}">${esc(STATUS_LABEL[value] || value)}</option>`).join('')}</select></label>`
      + `<div id="cutiTrxActual" class="span-2 cuti-modal-grid" hidden><label>Realisasi mulai<input id="cutiTrxStart" type="date" value="${esc(String(source?.planned_start || '').slice(0, 10))}" /></label>`
      + `<label>Realisasi selesai<input id="cutiTrxEnd" type="date" value="${esc(String(source?.planned_end || '').slice(0, 10))}" /></label>`
      + `<p class="span-2 cuti-form-note">Tanggal aktual hanya digunakan saat target <b>Terealisasi</b>. Durasi yang berbeda dari kebijakan masuk variance dan tidak otomatis dihitung satu periode.</p></div>`
      + `<label class="span-2">Alasan (wajib untuk Tolak/Batal)<input id="cutiTrxReason" placeholder="Alasan keputusan" /></label></div>`
      + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan</button></div><p id="cutiTrxMessage" class="modal__pesan" hidden></p></form>`);
    const targetInput = document.getElementById('cutiTrxTarget');
    const toggleActual = () => {
      const active = targetInput.value === 'REALIZED';
      document.getElementById('cutiTrxActual').hidden = !active;
      document.getElementById('cutiTrxStart').required = active;
      document.getElementById('cutiTrxEnd').required = active;
    };
    targetInput.addEventListener('change', toggleActual);
    toggleActual();
    document.getElementById('cutiTrxForm').addEventListener('submit', event => {
      event.preventDefault();
      const message = document.getElementById('cutiTrxMessage');
      runFeedback(event.target.querySelector('[type="submit"]'), async () => {
        const result = await request(`/api/admin/cuti/requests/${encodeURIComponent(requestId)}/transition`, {
          method: 'POST', body: JSON.stringify({
            target: targetInput.value,
            reason: document.getElementById('cutiTrxReason').value || null,
            actual_start: targetInput.value === 'REALIZED' ? document.getElementById('cutiTrxStart').value : null,
            actual_end: targetInput.value === 'REALIZED' ? document.getElementById('cutiTrxEnd').value : null,
          }),
        });
        tutupModal(); await loadDashboard();
        if (stateData.detail) await openDetail(stateData.detail.employee.id);
        window.alert(result.message);
      }).catch(error => { message.hidden = false; message.textContent = error.message; });
    });
  }

  async function employeeOptions() {
    if (!stateData.employees) {
      const data = await request('/api/admin/karyawan');
      stateData.employees = Array.isArray(data) ? data : (data.rows || []);
    }
    return stateData.employees;
  }

  async function openPengajuan(presetUserId, presetCycle) {
    let scopes;
    try { scopes = await policyScopeOptions(); }
    catch (error) { window.alert(error.message); return; }
    const presetRow = stateData.dashboard.find(item => String(item.id) === String(presetUserId || ''));
    const scoped = Boolean(presetRow && presetCycle);
    const departmentOptions = scopes.map(item => `<option value="${esc(item.department)}">${esc(item.department)}</option>`).join('');
    bukaModal(`<h3>Pengajuan Cuti</h3><p class="cuti-form-note">CP wajib mengikuti siklus terpilih. CK dan CT bersifat tambahan dan tidak mengubah baseline proyeksi.</p><form id="cutiReqForm"><div class="cuti-modal-grid">`
      + (scoped
        ? `<label class="span-2">Nama karyawan<input id="cutiReqEmployeeName" value="${esc(presetRow.nama)} — ${esc(presetRow.jabatan || '')}" readonly /><input id="cutiReqUser" type="hidden" value="${esc(presetRow.id)}" /></label>`
        : `<label>Departemen<select id="cutiReqDept" required><option value="">Pilih departemen</option>${departmentOptions}</select></label><label>Jabatan<select id="cutiReqPos" required disabled><option value="">Pilih departemen dahulu</option></select></label><label class="span-2">Nama karyawan<select id="cutiReqUser" required disabled><option value="">Pilih jabatan dahulu</option></select></label>`)
      + `<label class="span-2">Periode cuti<select id="cutiReqCycle" required><option value="">Memuat periode...</option></select></label>`
      + `<label class="span-2">Tanggal mulai (Cuti Periodik)<input id="cutiReqStart" type="date" required /></label>`
      + `<label>Keterangan cuti khusus<input id="cutiReqCkReason" placeholder="Kosongkan jika tidak ada CK" /></label>`
      + `<label>Jumlah hari CK<input id="cutiReqCkDays" type="number" min="0" step="1" value="0" /></label>`
      + `<label class="span-2">Jumlah hari Cuti Tahunan (CT)<input id="cutiReqCtDays" type="number" min="0" step="1" value="0" /></label>`
      + `<div class="span-2 cuti-request-summary"><b id="cutiReqRange">Pilih karyawan dan periode cuti.</b><strong id="cutiReqTotal">Total 0 hari cuti</strong></div></div>`
      + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Pengajuan</button></div><p id="cutiReqMessage" class="modal__pesan" hidden></p></form>`);
    const userInput = document.getElementById('cutiReqUser');
    const cycleInput = document.getElementById('cutiReqCycle');
    const startInput = document.getElementById('cutiReqStart');
    let cycleData = [];
    const updateSummary = () => {
      const option = cycleInput.selectedOptions[0];
      const cpDays = Number(option?.dataset.cpDays || 0);
      const ckDays = Number(document.getElementById('cutiReqCkDays').value || 0);
      const ctDays = Number(document.getElementById('cutiReqCtDays').value || 0);
      const total = cpDays + ckDays + ctDays;
      const end = startInput.value && total > 0 ? addIsoDays(startInput.value, total - 1) : null;
      document.getElementById('cutiReqRange').textContent = end
        ? `${fmtDate(startInput.value)} s.d. ${fmtDate(end)}` : 'Pilih karyawan dan periode cuti.';
      document.getElementById('cutiReqTotal').textContent = `Total ${total} hari cuti`;
    };
    const loadCycles = async (desiredCycle) => {
      if (!userInput.value) { cycleInput.innerHTML = '<option value="">Pilih karyawan dahulu</option>'; return; }
      const data = await request(`/api/admin/cuti/cycle-options?user_id=${encodeURIComponent(userInput.value)}&year=${encodeURIComponent(stateData.year)}`);
      cycleData = data.cycles || [];
      cycleInput.innerHTML = `<option value="">Pilih periode cuti</option>${cycleData.map(item => `<option value="${item.cycle_no}" data-cp-days="${item.cp_days}"${item.occupied ? ' disabled' : ''}${Number(desiredCycle) === Number(item.cycle_no) ? ' selected' : ''}>Cuti ${item.cycle_no} — ${fmtDate(item.projected_start)}${item.occupied ? ' (sudah diajukan)' : ''}</option>`).join('')}`;
      const selected = cycleData.find(item => Number(item.cycle_no) === Number(cycleInput.value));
      startInput.value = selected ? selected.projected_start : '';
      updateSummary();
    };
    if (!scoped) {
      const dept = document.getElementById('cutiReqDept');
      const pos = document.getElementById('cutiReqPos');
      dept.addEventListener('change', () => {
        const selected = scopes.find(item => item.department === dept.value);
        pos.innerHTML = selected ? `<option value="">Pilih jabatan</option>${selected.positions.map(item => `<option value="${esc(item.position)}">${esc(item.position)}</option>`).join('')}` : '<option value="">Pilih departemen dahulu</option>';
        pos.disabled = !selected; userInput.disabled = true; userInput.innerHTML = '<option value="">Pilih jabatan dahulu</option>';
      });
      pos.addEventListener('change', () => {
        const selected = scopes.find(item => item.department === dept.value)?.positions.find(item => item.position === pos.value);
        userInput.innerHTML = selected ? `<option value="">Pilih karyawan</option>${selected.employees.map(item => `<option value="${esc(item.id)}">${esc(item.nama)}${item.employee_id ? ` — ${esc(item.employee_id)}` : ''}</option>`).join('')}` : '<option value="">Pilih jabatan dahulu</option>';
        userInput.disabled = !selected;
      });
      userInput.addEventListener('change', () => loadCycles().catch(error => window.alert(error.message)));
    } else await loadCycles(presetCycle).catch(error => window.alert(error.message));
    cycleInput.addEventListener('change', () => {
      const selected = cycleData.find(item => Number(item.cycle_no) === Number(cycleInput.value));
      startInput.value = selected ? selected.projected_start : '';
      updateSummary();
    });
    [startInput, document.getElementById('cutiReqCkDays'), document.getElementById('cutiReqCtDays')]
      .forEach(input => input.addEventListener('input', updateSummary));
    document.getElementById('cutiReqForm').addEventListener('submit', event => {
      event.preventDefault();
      const message = document.getElementById('cutiReqMessage');
      const key = idempotency();
      const savedUserId = userInput.value;
      runFeedback(event.target.querySelector('[type="submit"]'), async () => {
        await request('/api/admin/cuti/cycle-applications', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({
          user_id: savedUserId, owning_year: Number(stateData.year), cycle_no: Number(cycleInput.value),
          planned_start: startInput.value, ck_reason: document.getElementById('cutiReqCkReason').value.trim(),
          ck_days: Number(document.getElementById('cutiReqCkDays').value || 0),
          ct_days: Number(document.getElementById('cutiReqCtDays').value || 0), idempotency_key: key,
        }) });
        tutupModal(); stateData.loaded = false; await loadDashboard();
        if (savedUserId) openCardModal(savedUserId);
      }).catch(error => { message.hidden = false; message.textContent = error.message; });
    });
  }

  async function openEditPengajuan(targetId, presetUserId, presetCycle) {
    const presetRow = stateData.dashboard.find(item => String(item.id) === String(presetUserId || ''));
    let events = presetRow ? eventsOf(presetRow) : [];
    if (!events.length && stateData.detail && String(stateData.detail.employee?.id) === String(presetUserId)) {
      events = (stateData.detail.requests || []).map(r => ({
        ...r,
        request_id: r.id,
        request_status: r.status,
      }));
    }
    const group = events.filter(item =>
      (item.application_group_id && item.application_group_id === targetId) ||
      (item.request_id && item.request_id === targetId) ||
      (presetCycle && Number(item.cycle_no) === Number(presetCycle))
    );
    const cp = group.find(item => item.leave_type === 'CP');
    const ck = group.filter(item => item.leave_type === 'CK');
    const ct = group.filter(item => item.leave_type === 'CT');
    const employeeName = presetRow?.nama || stateData.detail?.employee?.nama || 'Karyawan';
    const employeeInfo = `${employeeName}${presetRow?.jabatan ? ` — ${presetRow.jabatan}` : ''}`;
    const initialCycle = presetCycle || cp?.cycle_no || group[0]?.cycle_no || 1;
    const initialStart = cp?.planned_start ? String(cp.planned_start).slice(0, 10) : (group[0]?.planned_start ? String(group[0].planned_start).slice(0, 10) : '');
    const initialCkReason = ck[0]?.reason || '';
    const initialCkDays = ck.reduce((sum, item) => sum + inclusiveEventDays(item), 0);
    const initialCtDays = ct.reduce((sum, item) => sum + inclusiveEventDays(item), 0);
    const cpDays = Number(presetRow?.policy_leave_days || (cp ? inclusiveEventDays(cp) : 0) || 14);

    bukaModal(`<h3>Edit Pengajuan Cuti — Cuti ${esc(initialCycle)}</h3>`
      + `<p class="cuti-form-note">Perbarui tanggal mulai atau penyesuaian hari CK dan CT. Hanya pengajuan berstatus Draft yang dapat diedit langsung.</p>`
      + `<form id="cutiEditReqForm"><div class="cuti-modal-grid">`
      + `<label class="span-2">Nama karyawan<input value="${esc(employeeInfo)}" readonly /></label>`
      + `<label class="span-2">Periode cuti<input value="Cuti ${esc(initialCycle)}" readonly /></label>`
      + `<label class="span-2">Tanggal mulai (Cuti Periodik)<input id="cutiEditReqStart" type="date" value="${esc(initialStart)}" required /></label>`
      + `<label>Keterangan cuti khusus<input id="cutiEditReqCkReason" value="${esc(initialCkReason)}" placeholder="Kosongkan jika tidak ada CK" /></label>`
      + `<label>Jumlah hari CK<input id="cutiEditReqCkDays" type="number" min="0" step="1" value="${initialCkDays}" /></label>`
      + `<label class="span-2">Jumlah hari Cuti Tahunan (CT)<input id="cutiEditReqCtDays" type="number" min="0" step="1" value="${initialCtDays}" /></label>`
      + `<div class="span-2 cuti-request-summary"><b id="cutiEditReqRange">—</b><strong id="cutiEditReqTotal">Total 0 hari cuti</strong></div></div>`
      + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Perubahan</button></div><p id="cutiEditReqMessage" class="modal__pesan" hidden></p></form>`);

    const startInput = document.getElementById('cutiEditReqStart');
    const ckDaysInput = document.getElementById('cutiEditReqCkDays');
    const ckReasonInput = document.getElementById('cutiEditReqCkReason');
    const ctDaysInput = document.getElementById('cutiEditReqCtDays');
    const rangeDisplay = document.getElementById('cutiEditReqRange');
    const totalDisplay = document.getElementById('cutiEditReqTotal');

    const updateSummary = () => {
      const ckVal = Number(ckDaysInput.value || 0);
      const ctVal = Number(ctDaysInput.value || 0);
      const total = cpDays + ckVal + ctVal;
      const end = startInput.value && total > 0 ? addIsoDays(startInput.value, total - 1) : null;
      rangeDisplay.textContent = end ? `${fmtDate(startInput.value)} s.d. ${fmtDate(end)}` : 'Tentukan tanggal mulai cuti.';
      totalDisplay.textContent = `Total ${total} hari cuti (CP: ${cpDays} + CK: ${ckVal} + CT: ${ctVal})`;
    };
    updateSummary();

    [startInput, ckDaysInput, ctDaysInput].forEach(inp => inp.addEventListener('input', updateSummary));

    document.getElementById('cutiEditReqForm').addEventListener('submit', event => {
      event.preventDefault();
      const message = document.getElementById('cutiEditReqMessage');
      runFeedback(event.target.querySelector('[type="submit"]'), async () => {
        const result = await request(`/api/admin/cuti/cycle-applications/${encodeURIComponent(targetId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            user_id: presetUserId,
            owning_year: Number(stateData.year),
            cycle_no: Number(initialCycle),
            planned_start: startInput.value,
            ck_reason: ckReasonInput.value.trim(),
            ck_days: Number(ckDaysInput.value || 0),
            ct_days: Number(ctDaysInput.value || 0),
          }),
        });
        tutupModal();
        stateData.loaded = false;
        await loadDashboard();
        if (presetUserId) openCardModal(presetUserId);
        if (stateData.detail) await openDetail(presetUserId);
        window.alert(result.message || 'Pengajuan cuti berhasil diperbarui.');
      }).catch(error => { message.hidden = false; message.textContent = error.message; });
    });
  }

  function openCardModal(userId) {
    const row = stateData.dashboard.find(r => String(r.id) === String(userId));
    if (!row) return;
    const cardContent = personCardHtml(row);
    bukaModal(`<h3>Kartu Cuti Karyawan · ${esc(row.nama)}</h3>`
      + `<div class="cuti-person-modal-wrap">${cardContent}</div>`
      + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button></div>`);

    const modal = document.getElementById('modalKonten') || document.querySelector('.modal');
    if (modal) {
      modal.querySelectorAll('[data-cuti-cycle-apply]').forEach(button => button.addEventListener('click', event => {
        event.stopPropagation();
        openPengajuan(button.dataset.cutiCycleApply, Number(button.dataset.cutiCycleNo));
      }));
      modal.querySelectorAll('[data-cuti-cycle-edit]').forEach(button => button.addEventListener('click', event => {
        event.stopPropagation();
        openEditPengajuan(button.dataset.cutiCycleEdit, button.dataset.cutiCycleUser, Number(button.dataset.cutiCycleNo));
      }));
      modal.querySelectorAll('[data-cuti-cycle-delete]').forEach(button => button.addEventListener('click', event => {
        event.stopPropagation();
        const targetId = button.dataset.cutiCycleDelete;
        const cycleNo = button.dataset.cutiCycleNo ? `Cuti ${button.dataset.cutiCycleNo}` : 'pengajuan cuti ini';
        if (!window.confirm(`Hapus ${cycleNo}? Seluruh permohonan CP, CK, dan CT pada pengajuan siklus ini akan dihapus.`)) return;
        const reason = window.prompt('Alasan penghapusan pengajuan (opsional):', 'Dihapus oleh user');
        if (reason === null) return;
        runFeedback(button, async () => {
          const result = await request(`/api/admin/cuti/cycle-applications/${encodeURIComponent(targetId)}`, {
            method: 'DELETE',
            body: JSON.stringify({ reason: reason.trim() || 'Dihapus oleh user' }),
          });
          tutupModal();
          stateData.loaded = false;
          await loadDashboard();
          const targetUser = button.dataset.cutiCycleUser;
          if (targetUser) openCardModal(targetUser);
          if (stateData.detail) await openDetail(stateData.detail.employee.id);
          window.alert(result.message || 'Pengajuan cuti berhasil dihapus.');
        }).catch(error => window.alert(error.message));
      }));
      modal.querySelectorAll('[data-cuti-detail]').forEach(button => button.addEventListener('click', () => {
        tutupModal();
        openDetail(button.dataset.cutiDetail);
      }));
    }
  }

  function openKoreksi(realisationId) {
    const source = stateData.detail?.realisations?.find(item => String(item.id) === String(realisationId));
    bukaModal(`<h3>Koreksi Realisasi</h3><p style="color:#64748b;font-size:13px">CP roster milik realisasi ini ditulis ulang pada rentang koreksi.</p><form id="cutiCorForm"><div class="cuti-modal-grid">`
      + `<label>Realisasi mulai<input id="cutiCorStart" type="date" value="${esc(String(source?.actual_start || '').slice(0, 10))}" required /></label>`
      + `<label>Realisasi selesai<input id="cutiCorEnd" type="date" value="${esc(String(source?.actual_end || '').slice(0, 10))}" required /></label>`
      + `<label class="span-2">Keputusan periode HR (opsional)<select id="cutiCorPeriods"><option value="">Otomatis sesuai kebijakan</option><option value="0">0 periode / tidak dihitung</option><option value="1">1 periode</option></select></label>`
      + `<label class="span-2">Catatan<input id="cutiCorNote" placeholder="Alasan koreksi" /></label></div>`
      + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Koreksi</button></div><p id="cutiCorMessage" class="modal__pesan" hidden></p></form>`);
    document.getElementById('cutiCorForm').addEventListener('submit', event => {
      event.preventDefault();
      const message = document.getElementById('cutiCorMessage');
      runFeedback(event.target.querySelector('[type="submit"]'), async () => {
        const periodValue = document.getElementById('cutiCorPeriods').value;
        const result = await request(`/api/admin/cuti/realisations/${encodeURIComponent(realisationId)}`, { method: 'PATCH', body: JSON.stringify({
          actual_start: document.getElementById('cutiCorStart').value,
          actual_end: document.getElementById('cutiCorEnd').value,
          ...(periodValue === '' ? {} : { period_count: Number(periodValue) }),
          note: document.getElementById('cutiCorNote').value || null,
        }) });
        tutupModal(); await loadDashboard();
        if (stateData.detail) await openDetail(stateData.detail.employee.id);
        window.alert(result.message);
      }).catch(error => { message.hidden = false; message.textContent = error.message; });
    });
  }

  async function policyScopeOptions(force = false) {
    if (force || !stateData.policyScopes || !stateData.policyScopes.length) {
      const data = await request('/api/admin/cuti/policy-scopes');
      stateData.policyScopes = data.rows || data || [];
    }
    return stateData.policyScopes;
  }

  async function openPolicyForm(source = null) {
    let scopes;
    try { scopes = await policyScopeOptions(true); }
    catch (error) { window.alert(`Gagal memuat master departemen/jabatan: ${error.message}`); return; }
    const editing = Boolean(source);
    const departmentOptions = scopes.map(item => `<option value="${esc(item.department)}">${esc(item.department)}</option>`).join('');
    bukaModal(`<h3>${editing ? 'Edit Kebijakan Cuti' : 'Kebijakan Cuti Baru'}</h3><p style="color:#64748b;font-size:13px">${editing ? 'Perubahan disimpan sebagai versi baru agar histori kebijakan tetap utuh. Lingkup departemen, jabatan, dan karyawan tidak diubah.' : 'T0 adalah hari pertama minggu kerja. Siklus CP direset setiap 1 Januari; CT hanya menjadi saldo hari.'}</p><form id="cutiPolForm"><div class="cuti-modal-grid">`
      + `<label>Departemen<select id="cutiPolDept" required><option value="">Pilih departemen</option>${departmentOptions}</select></label>`
      + `<label>Jabatan<select id="cutiPolPos" required disabled><option value="">Pilih departemen dahulu</option></select></label>`
      + `<label class="span-2">Karyawan<select id="cutiPolEmployee" disabled><option value="">Pilih jabatan dahulu</option></select><small>Default berlaku untuk semua karyawan pada jabatan terpilih.</small></label>`
      + `<div class="span-2 cuti-policy-cycle-intro"><b>Pengaturan Siklus Cuti Periodik</b><small>Atur pola minggu kerja dan minggu cuti. Hanya Cuti Periodik (CP) yang dihitung sebagai siklus.</small></div>`
      + `<label>Minggu kerja<input id="cutiPolWorkWeeks" type="number" min="1" step="1" value="${editing ? weeks(source.work_days) : 8}" required /></label>`
      + `<label>Minggu cuti<input id="cutiPolLeaveWeeks" type="number" min="1" step="1" value="${editing ? weeks(source.leave_days) : 2}" required /></label>`
      + `<label class="span-2">Total siklus cuti periodik<input id="cutiPolCycleWeeks" value="${editing ? weeks(Number(source.work_days) + Number(source.leave_days)) : 10} minggu" readonly /></label>`
      + `<label>Cuti tahunan (CT)<input id="cutiPolAnnual" type="number" min="0" step="1" value="${editing ? Number(source.annual_days || 0) : 12}" required /><small>Saldo hari; tidak memengaruhi siklus CP.</small></label>`
      + `<label>Berlaku mulai (T0)<input id="cutiPolFrom" type="date" value="${editing ? esc(String(source.effective_from || '').slice(0, 10)) : ''}" required /><small>Hari pertama minggu kerja.</small></label>`
      + `<label class="span-2">Catatan<input id="cutiPolNote" value="${editing ? esc(source.note || '') : ''}" /></label></div>`
      + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Versi</button></div><p id="cutiPolMessage" class="modal__pesan" hidden></p></form>`);
    const departmentInput = document.getElementById('cutiPolDept');
    const positionInput = document.getElementById('cutiPolPos');
    const employeeInput = document.getElementById('cutiPolEmployee');
    const syncPositions = () => {
      const selected = scopes.find(item => item.department === departmentInput.value);
      positionInput.innerHTML = selected
        ? `<option value="">Pilih jabatan</option>${selected.positions.map(item => `<option value="${esc(item.position)}">${esc(item.position)}</option>`).join('')}`
        : '<option value="">Pilih departemen dahulu</option>';
      positionInput.disabled = !selected;
      employeeInput.innerHTML = '<option value="">Pilih jabatan dahulu</option>';
      employeeInput.disabled = true;
    };
    const syncEmployees = () => {
      const selected = scopes.find(item => item.department === departmentInput.value);
      const position = selected && selected.positions.find(item => item.position === positionInput.value);
      employeeInput.innerHTML = position
        ? `<option value="">Semua karyawan pada jabatan ini</option>${position.employees.map(item => `<option value="${esc(item.id)}">${esc(item.nama)}${item.employee_id ? ` — ${esc(item.employee_id)}` : ''}</option>`).join('')}`
        : '<option value="">Pilih jabatan dahulu</option>';
      employeeInput.disabled = !position;
    };
    const syncCycle = () => {
      const total = Number(document.getElementById('cutiPolWorkWeeks').value || 0)
        + Number(document.getElementById('cutiPolLeaveWeeks').value || 0);
      document.getElementById('cutiPolCycleWeeks').value = `${total} minggu`;
    };
    departmentInput.addEventListener('change', syncPositions);
    positionInput.addEventListener('change', syncEmployees);
    document.getElementById('cutiPolWorkWeeks').addEventListener('input', syncCycle);
    document.getElementById('cutiPolLeaveWeeks').addEventListener('input', syncCycle);
    if (editing) {
      departmentInput.value = source.department || '';
      syncPositions();
      positionInput.value = source.position || '';
      syncEmployees();
      employeeInput.value = source.target_user_id || '';
      departmentInput.disabled = true;
      positionInput.disabled = true;
      employeeInput.disabled = true;
    } else syncPositions();
    document.getElementById('cutiPolForm').addEventListener('submit', event => {
      event.preventDefault();
      const message = document.getElementById('cutiPolMessage');
      runFeedback(event.target.querySelector('[type="submit"]'), async () => {
        const result = await request('/api/admin/cuti/policies', { method: 'POST', body: JSON.stringify({
          department: document.getElementById('cutiPolDept').value,
          position: document.getElementById('cutiPolPos').value,
          target_user_id: document.getElementById('cutiPolEmployee').value || null,
          work_weeks: Number(document.getElementById('cutiPolWorkWeeks').value),
          leave_weeks: Number(document.getElementById('cutiPolLeaveWeeks').value),
          annual_days: Number(document.getElementById('cutiPolAnnual').value),
          effective_from: document.getElementById('cutiPolFrom').value,
          note: document.getElementById('cutiPolNote').value || null,
        }) });
        tutupModal();
        stateData.policies = (await request('/api/admin/cuti/policies')).rows || [];
        stateData.policyScopes = await policyScopeOptions(true);
        stateData.loaded = false;
        await loadDashboard();
        render();
        window.alert(result.message);
      }).catch(error => { message.hidden = false; message.textContent = error.message; });
    });
  }

  function openCalendar() {
    const month = stateData.calMonth || `${stateData.year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    request(`/api/admin/cuti/calendar?month=${encodeURIComponent(month)}`).then(data => {
      stateData.calMonth = data.month;
      stateData.calRows = data.rows || [];
      const [year, mon] = data.month.split('-').map(Number);
      const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
      const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
      const cells = [];
      for (let i = 0; i < firstWeekday; i += 1) cells.push('<div class="cuti-cal-day is-other"></div>');
      for (let day = 1; day <= lastDay; day += 1) {
        const iso = `${data.month}-${String(day).padStart(2, '0')}`;
        const marks = stateData.calRows.filter(row => row.mulai <= iso && iso <= row.selesai)
          .map(row => `<span class="cuti-cal-mark${row.phase === 'PLANNED' ? ' is-plan' : ''}">${esc(row.nama)} (${esc(row.leave_type)} · ${row.phase === 'PLANNED' ? 'Rencana' : 'Aktual'})</span>`).join('');
        cells.push(`<div class="cuti-cal-day"><b>${day}</b>${marks}</div>`);
      }
      bukaModal(`<h3>Kalender Cuti · ${esc(data.month)}</h3><div class="cuti-cal">${cells.join('')}</div>`
        + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button></div>`);
    }).catch(error => window.alert(error.message));
  }

  function bindDynamic(root) {
    const departmentFilter = root.querySelector('#cutiDept');
    const positionFilter = root.querySelector('#cutiPos');
    departmentFilter?.addEventListener('change', () => {
      const selected = (stateData.policyScopes || []).find(item => item.department === departmentFilter.value);
      positionFilter.innerHTML = selected
        ? `<option value="">Jabatan: Semua</option>${selected.positions.map(item => `<option value="${esc(item.position)}">${esc(item.position)}</option>`).join('')}`
        : '<option value="">Pilih Departemen dahulu</option>';
      positionFilter.disabled = !selected;
    });
    root.querySelector('[data-cuti-tampilkan]')?.addEventListener('click', () => {
      stateData.year = root.querySelector('#cutiYear').value;
      stateData.department = root.querySelector('#cutiDept').value;
      stateData.position = root.querySelector('#cutiPos').value;
      stateData.status = root.querySelector('#cutiStatus').value;
      stateData.search = root.querySelector('#cutiSearch').value.trim();
      stateData.detail = null;
      loadDashboard();
    });
    root.querySelectorAll('[data-cuti-mode]').forEach(button => button.addEventListener('click', () => {
      stateData.mode = button.dataset.cutiMode;
      localStorage.setItem('omos_cuti_mode', stateData.mode);
      render();
    }));
    root.querySelector('[data-cuti-kalender]')?.addEventListener('click', openCalendar);
    root.querySelector('[data-cuti-export]')?.addEventListener('click', async () => {
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/admin/cuti/export?year=${encodeURIComponent(stateData.year)}`, {
          headers: { ...(state?.token ? { Authorization: `Bearer ${state.token}` } : {}) },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `cuti-${stateData.year}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      } catch (error) { window.alert(error.message); }
    });
    root.querySelector('[data-cuti-pengajuan-umum]')?.addEventListener('click', () => openPengajuan());
    root.querySelectorAll('[data-cuti-card-modal]').forEach(tr => tr.addEventListener('click', () => openCardModal(tr.dataset.cutiCardModal)));
    root.querySelectorAll('[data-cuti-detail]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.cutiDetail)));
    root.querySelectorAll('[data-cuti-cycle-apply]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      openPengajuan(button.dataset.cutiCycleApply, Number(button.dataset.cutiCycleNo));
    }));
    root.querySelectorAll('[data-cuti-cycle-edit]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      openEditPengajuan(button.dataset.cutiCycleEdit, button.dataset.cutiCycleUser, Number(button.dataset.cutiCycleNo));
    }));
    root.querySelectorAll('[data-cuti-cycle-delete]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const targetId = button.dataset.cutiCycleDelete;
      const cycleNo = button.dataset.cutiCycleNo ? `Cuti ${button.dataset.cutiCycleNo}` : 'pengajuan cuti ini';
      if (!window.confirm(`Hapus ${cycleNo}? Seluruh permohonan CP, CK, dan CT pada pengajuan siklus ini akan dihapus.`)) return;
      const reason = window.prompt('Alasan penghapusan pengajuan (opsional):', 'Dihapus oleh user');
      if (reason === null) return;
      runFeedback(button, async () => {
        const result = await request(`/api/admin/cuti/cycle-applications/${encodeURIComponent(targetId)}`, {
          method: 'DELETE',
          body: JSON.stringify({ reason: reason.trim() || 'Dihapus oleh user' }),
        });
        window.alert(result.message || 'Pengajuan cuti berhasil dihapus.');
        stateData.loaded = false;
        await loadDashboard();
        if (stateData.detail) await openDetail(stateData.detail.employee.id);
      }).catch(error => window.alert(error.message));
    }));
    root.querySelectorAll('[data-cuti-trx]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      openTransition(button.dataset.cutiTrx, button.dataset.cutiStatus);
    }));
    root.querySelectorAll('[data-cuti-koreksi]').forEach(button => button.addEventListener('click', () => openKoreksi(button.dataset.cutiKoreksi)));
    root.querySelectorAll('[data-cuti-batal-realisasi]').forEach(button => button.addEventListener('click', () => {
      const reason = window.prompt('Alasan pembatalan realisasi:');
      if (!reason) return;
      request(`/api/admin/cuti/realisations/${encodeURIComponent(button.dataset.cutiBatalRealisasi)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) })
        .then(async result => { window.alert(result.message); await loadDashboard(); if (stateData.detail) await openDetail(stateData.detail.employee.id); })
        .catch(error => window.alert(error.message));
    }));
    root.querySelector('[data-cuti-drawer-tutup]')?.addEventListener('click', () => { stateData.detail = null; render(); });
    root.querySelector('[data-cuti-policy-baru]')?.addEventListener('click', openPolicyForm);
    root.querySelectorAll('[data-cuti-policy-edit]').forEach(button => button.addEventListener('click', () => {
      const source = stateData.policies.find(item => String(item.id) === String(button.dataset.cutiPolicyEdit));
      if (source) openPolicyForm(source);
    }));
    root.querySelectorAll('[data-cuti-policy-delete]').forEach(button => button.addEventListener('click', () => {
      if (!window.confirm('Hapus kebijakan ini? Kebijakan yang sudah dipakai data cuti akan diarsipkan agar histori tetap aman.')) return;
      const reason = window.prompt('Alasan penghapusan kebijakan:');
      if (!String(reason || '').trim()) return;
      runFeedback(button, async () => {
        const result = await request(`/api/admin/cuti/policies/${encodeURIComponent(button.dataset.cutiPolicyDelete)}`, {
          method: 'DELETE', body: JSON.stringify({ reason: String(reason).trim() }),
        });
        stateData.policies = (await request('/api/admin/cuti/policies')).rows || [];
        stateData.loaded = false;
        await loadDashboard();
        render();
        window.alert(result.message);
      }).catch(error => window.alert(error.message));
    }));
    root.querySelector('[data-cuti-recon-jalan]')?.addEventListener('click', () => {
      request('/api/admin/cuti/reconciliation/run', { method: 'POST', body: JSON.stringify({ from: `${stateData.year}-01-01`, to: `${stateData.year}-12-31` }) })
        .then(async result => {
          window.alert(result.message);
          stateData.recon = (await request('/api/admin/cuti/reconciliation')).rows || [];
          render();
        })
        .catch(error => window.alert(error.message));
    });
  }

  async function loadRecon() {
    try {
      stateData.recon = (await request('/api/admin/cuti/reconciliation')).rows || [];
    } catch (error) { stateData.recon = []; }
  }

  function init() {
    document.querySelectorAll('[data-cuti-view]').forEach(button => {
      if (button.dataset.cutiInit) return;
      button.dataset.cutiInit = '1';
      button.addEventListener('click', () => { setView(button.dataset.cutiView); if (stateData.view === 'cuti') loadRecon().then(render); });
    });
    const schedule = document.getElementById('rosterScheduleView');
    if (schedule) schedule.hidden = stateData.view !== 'jadwal';
  }

  window.OMOSCuti = { init, setView, load: loadDashboard };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
