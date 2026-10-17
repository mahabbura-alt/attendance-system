'use strict';

(function workforceModule() {
  const rootId = 'workforceMovementView';
  const typeLabels = { HIRE:'Masuk',REHIRE:'Rehire',TRANSFER:'Mutasi',PROMOTION:'Promosi',DEMOTION:'Demosi',RESIGN:'Resign',TERMINATION:'Terminasi',CONTRACT_END:'Kontrak Habis',RETIREMENT:'Pensiun' };
  const stateData = { mode:'movement', tab:'summary', period:'', from:'', to:'', summary:null, movements:[], organization:null, employees:[], mpp:null, mppHistory:[], mppVacancy:null, mppRequests:[], mppForecast:null, mppScenarios:[], mppDeptFilter:'', mppView:'headcount', mppDrawer:null, mppDrawerData:null, mppIdem:'', loaded:false };
  const MPP_REASONS = [['','— Pilih alasan —'],['FLEET_EXPANSION','Ekspansi fleet'],['REPLACEMENT','Pengganti'],['OPERATIONAL_NEED','Kebutuhan operasional'],['ORGANIZATION_REVIEW','Evaluasi organisasi'],['OTHER','Lainnya']];
  const MPP_PRIORITIES = ['LOW','NORMAL','HIGH','CRITICAL'];
  const ID_MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const shiftPeriod = (period, delta) => { let [year, month] = String(period).split('-').map(Number); month += delta; while (month > 12) { month -= 12; year += 1; } while (month < 1) { month += 12; year -= 1; } return `${year}-${String(month).padStart(2,'0')}`; };
  const shortMonth = period => { const [year, month] = String(period).split('-').map(Number); return `${ID_MONTHS[month-1]} ${year}`; };
  const esc = value => String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const today = () => new Date().toISOString().slice(0,10);
  const periodBounds = period => { const [year,month]=String(period).split('-').map(Number); return { from:`${period}-01`,to:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10) }; };
  const applyPeriod = period => { stateData.period=period;Object.assign(stateData,periodBounds(period)); };
  const idempotency = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const labelType = type => typeLabels[type] || type;
  const labelStatus = status => ({DRAFT:'Draft',SUBMITTED:'Menunggu Approval',APPROVED:'Disetujui/Terjadwal',REJECTED:'Ditolak',EFFECTIVE:'Efektif',CANCELLED:'Dibatalkan'}[status] || status);
  const fmtDate = value => value ? new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${String(value).slice(0,10)}T00:00:00Z`)) : '—';

  async function request(path, options) {
    if (!options && typeof api === 'function') return api(path);
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: { 'Content-Type':'application/json', ...(state?.token ? { Authorization:`Bearer ${state.token}` } : {}), ...(options?.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function setMode(mode) {
    stateData.mode = mode === 'database' ? 'database' : 'movement';
    localStorage.setItem('omos_people_mode', stateData.mode);
    const movementRoot = document.getElementById(rootId);
    if (movementRoot) movementRoot.hidden = stateData.mode !== 'movement';
    const databaseRoot = document.getElementById('employeeDatabaseView');
    if (databaseRoot) databaseRoot.hidden = stateData.mode !== 'database';
    document.querySelectorAll('[data-workforce-mode]').forEach(button => button.classList.toggle('is-active', button.dataset.workforceMode === stateData.mode));
    if (stateData.mode === 'movement') render();
  }

  function query() { return `from=${encodeURIComponent(stateData.from)}&to=${encodeURIComponent(stateData.to)}`; }
  async function fetchAll() {
    const type = tabTypes()[stateData.tab];
    const movementQuery = `${query()}${type ? `&type=${encodeURIComponent(type)}` : ''}`;
    const [summaryData, movementData, org, employees] = await Promise.all([
      request(`/api/admin/karyawan/workforce/summary?${query()}`),
      request(`/api/admin/karyawan/workforce/movements?${movementQuery}`),
      stateData.organization || request('/api/admin/karyawan/workforce/organization'),
      request('/api/admin/karyawan'),
    ]);
    stateData.summary = summaryData;
    stateData.movements = movementData.rows || [];
    stateData.organization = org;
    stateData.employees = employees || [];
    if (stateData.tab === 'mpp') {
      const forecastTo = shiftPeriod(stateData.period, 2);
      const [mppData, historyData, vacancyData, requestData, forecastData, scenarioData] = await Promise.all([
        request(`/api/admin/karyawan/workforce/mpp?period=${stateData.period}`),
        request(`/api/admin/karyawan/workforce/mpp/history?period=${stateData.period}&limit=50`).catch(() => ({ rows: [] })),
        request(`/api/admin/karyawan/workforce/mpp/vacancy?period=${stateData.period}`).catch(() => null),
        request(`/api/admin/karyawan/workforce/manpower-requests?period=${stateData.period}`).catch(() => ({ rows: [] })),
        request(`/api/admin/karyawan/workforce/mpp/forecast?from=${stateData.period}&to=${forecastTo}`).catch(() => null),
        request(`/api/admin/karyawan/workforce/mpp/scenarios?from=${stateData.period}&to=${forecastTo}`).catch(() => ({ rows: [] })),
      ]);
      stateData.mpp = mppData;
      stateData.mppHistory = historyData.rows || [];
      stateData.mppVacancy = vacancyData;
      stateData.mppRequests = requestData.rows || [];
      stateData.mppForecast = forecastData;
      stateData.mppScenarios = scenarioData.rows || [];
      stateData.mppDeptFilter = '';
      stateData.mppDrawer = null;
      stateData.mppDrawerData = null;
      stateData.mppIdem = idempotency();
    }
  }

  // Grouped lifecycle tabs are filtered client-side so related movement types
  // (for example REHIRE or CONTRACT_END) are not hidden by a narrow API filter.
  function tabTypes() { return { mutasi:'TRANSFER' }; }
  function tabButtons() {
    return [['summary','Ringkasan'],['mpp','MPP'],['masuk','Masuk'],['mutasi','Mutasi'],['promosi','Promosi'],['keluar','Keluar'],['history','Riwayat']]
      .map(([key,label]) => `<button type="button" data-workforce-tab="${key}" class="${stateData.tab===key?'is-active':''}">${label}</button>`).join('');
  }

  function kpi(label, value, note, accent, tab) {
    return `<button class="workforce-kpi" type="button" data-kpi-tab="${tab}" style="--accent:${accent};--soft:${accent}0d"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></button>`;
  }

  function summaryHtml() {
    const s = stateData.summary || {};
    const fill = s.mpp?.fill_rate == null ? '—' : `${(Number(s.mpp.fill_rate)*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`;
    return `<div class="workforce-kpis">
      ${kpi('Headcount aktif',s.headcount||0,'karyawan aktif','#0f766e','history')}
      ${kpi('Masuk',`+${s.masuk||0}`,'periode terpilih','#16a34a','masuk')}
      ${kpi('Keluar',`-${s.keluar||0}`,'periode terpilih','#dc2626','keluar')}
      ${kpi('Net movement',s.net_movement>0?`+${s.net_movement}`:(s.net_movement||0),'masuk − keluar','#0284c7','history')}
      ${kpi('Fill rate MPP',fill,s.mpp?`${s.mpp.filled}/${s.mpp.required} terisi`:'MPP belum tersedia','#7c3aed','mpp')}
      ${kpi('Perlu approval',s.pending_approval||0,'submitted / approved','#d97706','history')}
    </div><div class="workforce-grid">
      <div class="workforce-card"><h3>Rotasi terbaru</h3>${movementTable(stateData.movements.slice(0,8))}</div>
      <div class="workforce-card"><h3>Perlu tindakan</h3><div class="workforce-attention">
        <button type="button" data-kpi-tab="history"><span>Pengajuan menunggu approval</span><b>${s.pending_approval||0}</b></button>
        <button type="button" data-kpi-tab="mpp"><span>Fill rate MPP</span><b>${fill}</b></button>
        <button type="button" data-kpi-tab="keluar"><span>Offboarding periode ini</span><b>${s.keluar||0}</b></button>
      </div></div></div>`;
  }

  function movementTable(rows) {
    if (!rows.length) return '<div class="tabel__kosong">Belum ada rotasi pada periode ini.</div>';
    return `<div class="tabel-wrap"><table class="workforce-table"><thead><tr><th>Tanggal</th><th>Karyawan</th><th>Jenis</th><th>Dari → Menjadi</th><th>Status</th></tr></thead><tbody>${rows.map(row => {
      const before=row.before_state||{}, after=row.after_state||{};
      return `<tr class="workforce-row" data-movement-id="${esc(row.id)}">
        <td data-label="Tanggal">${fmtDate(row.effective_date)}</td><td data-label="Karyawan"><b>${esc(row.nama)}</b><br><small>${esc(row.employee_id||'Tanpa ID')}</small></td>
        <td data-label="Jenis"><span class="workforce-badge workforce-badge--${esc(row.movement_type)}">${esc(labelType(row.movement_type))}</span></td>
        <td data-label="Dari → Menjadi" class="workforce-change"><b>${esc(before.department||'—')} · ${esc(before.position||'—')}</b><br>→ ${esc(after.department||before.department||'—')} · ${esc(after.position||before.position||'—')}</td>
        <td data-label="Status"><span class="workforce-status">${esc(labelStatus(row.status))}</span><br><small>${esc(row.movement_no)}</small></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function filteredRows() {
    if (stateData.tab === 'keluar') return stateData.movements.filter(row => ['RESIGN','TERMINATION','CONTRACT_END','RETIREMENT'].includes(row.movement_type));
    if (stateData.tab === 'promosi') return stateData.movements.filter(row => ['PROMOTION','DEMOTION'].includes(row.movement_type));
    if (stateData.tab === 'masuk') return stateData.movements.filter(row => ['HIRE','REHIRE'].includes(row.movement_type));
    return stateData.movements;
  }

  function listHtml() {
    const title = ({masuk:'Karyawan Masuk',mutasi:'Mutasi',promosi:'Promosi & Demosi',keluar:'Karyawan Keluar',history:'Riwayat Rotasi'}[stateData.tab] || 'Rotasi');
    return `<div class="workforce-card"><h3>${title}</h3>${movementTable(filteredRows())}</div>`;
  }

  const fmtPct = value => value == null ? '—' : `${(Number(value)*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`;
  const gapKlass = gap => gap>0?'less':gap<0?'more':'fit';
  const gapLabel = gap => gap>0?`-${gap} Kurang`:gap<0?`+${Math.abs(gap)} Lebih`:'0 Sesuai';

  function mppDeptCards() {
    const data = stateData.mpp || {};
    const depts = data.departments || [];
    const all = { department_id:'', department_name:'Semua Departemen',
      actual:data.summary?.actual||0, required:data.summary?.required||0,
      gap:data.summary?.gap||0, fill_rate:data.summary?.fill_rate ?? null };
    return `<div class="workforce-depts" role="list">${[all,...depts].map(dept=>{
      const klass = gapKlass(Number(dept.gap)||0);
      const active = (stateData.mppDeptFilter||'') === String(dept.department_id||'');
      return `<button type="button" role="listitem" class="workforce-dept workforce-gap--${klass}${active?' is-active':''}" data-mpp-dept="${esc(dept.department_id||'')}">
        <b>${esc(dept.department_name)}</b>
        <span>Aktual <strong>${esc(dept.actual)}</strong> · Kebutuhan <strong>${esc(dept.required)}</strong></span>
        <span>Gap <strong>${esc(gapLabel(Number(dept.gap)||0))}</strong> · Fill Rate <strong>${esc(fmtPct(dept.fill_rate))}</strong></span>
      </button>`;
    }).join('')}</div>`;
  }

  function mppHeadcountRows(rows) {
    let department = '';
    return rows.map(row => {
      const group = row.department_snapshot !== department ? `<tr class="workforce-mpp-department"><th colspan="8">${esc(row.department_snapshot)}</th></tr>` : '';
      department = row.department_snapshot;
      const need = Number(row.required_qty||0), current = Number(row.actual||0), gap = need - current, klass = gapKlass(gap);
      const reasonOptions = MPP_REASONS.map(([value,label])=>`<option value="${value}" ${(row.reason_code||'')===value?'selected':''}>${esc(label)}</option>`).join('');
      const priorityOptions = MPP_PRIORITIES.map(value=>`<option value="${value}" ${String(row.priority||'NORMAL').toUpperCase()===value?'selected':''}>${esc(value)}</option>`).join('');
      return `${group}<tr data-mpp-position="${esc(row.position_id)}" data-revision="${esc(row.revision ?? 1)}">`
        + `<td><b>${esc(row.position_snapshot)}</b>${row.is_critical?'<br><small class="workforce-critical">Kritis</small>':''}</td>`
        + `<td class="workforce-mpp-actual"><button type="button" class="workforce-actual-link" data-mpp-actual="${esc(row.position_id)}" title="Lihat daftar karyawan">${current}</button></td>`
        + `<td><input class="workforce-mpp-need" type="number" min="0" step="1" inputmode="numeric" data-mpp-need value="${need}" data-initial="${need}" aria-label="Kebutuhan ${esc(row.position_snapshot)}"></td>`
        + `<td data-mpp-gap class="workforce-gap--${klass}">${gap>0?`-${gap}`:gap<0?`+${Math.abs(gap)}`:'0'}</td>`
        + `<td data-mpp-status class="workforce-gap--${klass}">${gap>0?'Kurang':gap<0?'Lebih':'Sesuai'}</td>`
        + `<td><select data-mpp-reason data-initial="${esc(row.reason_code||'')}" aria-label="Alasan ${esc(row.position_snapshot)}">${reasonOptions}</select>`
        + `<input data-mpp-reason-text data-initial="${esc(row.reason_text||'')}" value="${esc(row.reason_text||'')}" placeholder="Rincian alasan / catatan" aria-label="Rincian alasan ${esc(row.position_snapshot)}"></td>`
        + `<td><select data-mpp-priority data-initial="${esc(String(row.priority||'NORMAL').toUpperCase())}" aria-label="Prioritas ${esc(row.position_snapshot)}">${priorityOptions}</select></td>`
        + `<td><input data-mpp-needed data-initial="${esc(row.needed_by||'')}" value="${esc(row.needed_by||'')}" type="date" min="${esc(stateData.from)}" aria-label="Dibutuhkan tanggal ${esc(row.position_snapshot)}"></td></tr>`;
    }).join('');
  }

  const MR_STAGES = ['DRAFT','SUBMITTED','APPROVED','RECRUITING','CANDIDATE_READY','ONBOARDING','FULFILLED'];
  const MR_LABEL = { DRAFT:'Draft', SUBMITTED:'Diajukan', APPROVED:'Disetujui', RECRUITING:'Rekrutmen', CANDIDATE_READY:'Kandidat Siap', ONBOARDING:'Onboarding', FULFILLED:'Terpenuhi', CANCELLED:'Dibatalkan', REJECTED:'Ditolak' };
  const MR_NEXT = { DRAFT:['SUBMITTED','CANCELLED'], SUBMITTED:['APPROVED','REJECTED','CANCELLED'], APPROVED:['RECRUITING','CANCELLED'], RECRUITING:['CANDIDATE_READY','CANCELLED'], CANDIDATE_READY:['ONBOARDING','CANCELLED'], ONBOARDING:['FULFILLED','CANCELLED'] };

  function vacancyHtml() {
    const vacancy = stateData.mppVacancy;
    if (!vacancy) return '<div class="tabel__kosong">Data vacancy belum tersedia. Pastikan migration 068 sudah diterapkan.</div>';
    const summary = vacancy.summary || {};
    const rows = (vacancy.lines || []).filter(row => !stateData.mppDeptFilter || String(row.department_id||'') === stateData.mppDeptFilter);
    const table = rows.length ? `<div class="workforce-mpp-wrap"><table class="workforce-table workforce-mpp-table"><thead><tr><th>Jabatan</th><th>Gap</th><th>Request sisa</th><th>Rekrutmen</th><th>Kandidat Siap</th><th>Onboarding</th><th>Terisi</th><th>Aksi</th></tr></thead><tbody>${rows.map(row=>{
      const st = key => { const s = (row.by_status||{})[key] || {}; return Math.max(Number(s.qty||0) - Number(s.filled||0), 0); };
      const dept = row.department_snapshot !== vacancy._dept ? `<tr class="workforce-mpp-department"><th colspan="8">${esc(row.department_snapshot)}</th></tr>` : '';
      vacancy._dept = row.department_snapshot;
      const progress = Number(row.vacancy) > 0 ? Math.min(Number(row.filled) / Number(row.vacancy), 1) : 1;
      return `${dept}<tr><td><b>${esc(row.position_snapshot)}</b>${row.is_critical?'<br><small class="workforce-critical">Kritis</small>':''}<br><small>Vacancy ${row.vacancy} · Open ${row.open_vacancy}</small><span class="workforce-progress"><span style="width:${Math.round(progress*100)}%"></span></span></td>`
        + `<td data-label="Gap">${row.gap > 0 ? `-${row.gap}` : row.gap}</td><td data-label="Request sisa"><b>${row.requested}</b></td>`
        + `<td data-label="Rekrutmen">${st('RECRUITING')}</td><td data-label="Kandidat Siap">${st('CANDIDATE_READY')}</td><td data-label="Onboarding">${st('ONBOARDING')}</td>`
        + `<td data-label="Terisi"><b>${row.filled}</b>/${row.vacancy}</td>`
        + `<td><button type="button" class="tombol tombol--ghost" data-vac-request="${esc(row.position_id)}" data-vacancy="${row.open_vacancy}">Buat Request</button></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="tabel__kosong">Tidak ada vacancy pada filter ini.</div>';
    const open = stateData.mppRequests.filter(req => !['FULFILLED','CANCELLED','REJECTED'].includes(req.status));
    const reqRows = open.length ? `<div class="workforce-mpp-wrap"><table class="workforce-table workforce-history-table"><thead><tr><th>No Request</th><th>Jabatan</th><th>Qty</th><th>Status</th><th>Butuh tgl</th></tr></thead><tbody>${open.map(req=>`<tr class="workforce-row" data-mr-detail="${esc(req.id)}"><td data-label="No"><b>${esc(req.request_no)}</b></td><td data-label="Jabatan">${esc(req.position_name||'—')}<br><small>${esc(req.department_name||'')}</small></td><td data-label="Qty">${req.filled_qty}/${req.qty}</td><td data-label="Status">${esc(MR_LABEL[req.status]||req.status)}</td><td data-label="Butuh">${esc(fmtDate(req.needed_by))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="tabel__kosong">Belum ada request aktif pada periode ini. Buat dari tombol di tabel vacancy.</div>';
    return `<div class="workforce-kpis">${kpi('Vacancy',summary.vacancy||0,'kebutuhan − aktual','#d97706','mpp')}${kpi('Terisi request',summary.linked_filled||0,'via fulfillment','#0284c7','mpp')}${kpi('Open vacancy',summary.open_vacancy||0,'belum terpenuhi','#dc2626','mpp')}${kpi('Request aktif',open.length,'periode ini','#0f766e','mpp')}</div>`
      + `<div class="workforce-card"><div class="workforce-mpp-head"><div><h3>Vacancy · ${esc(stateData.period)}</h3><p>Klik angka baris request untuk detail pipeline. HIRE/REHIRE efektif yang tertaut otomatis mengisi request Onboarding.</p></div></div>${table}<h3 style="margin-top:14px">Request aktif</h3>${reqRows}</div>`;
  }

  async function refreshVacancy() {
    const [vacancyData, requestData] = await Promise.all([
      request(`/api/admin/karyawan/workforce/mpp/vacancy?period=${stateData.period}`).catch(() => null),
      request(`/api/admin/karyawan/workforce/manpower-requests?period=${stateData.period}`).catch(() => ({ rows: [] })),
    ]);
    stateData.mppVacancy = vacancyData;
    stateData.mppRequests = requestData.rows || [];
  }

  function openVacancyRequest(positionId, openQty) {
    const line = (stateData.mppVacancy?.lines || []).find(row => String(row.position_id) === String(positionId));
    bukaModal(`<h3>Buat Manpower Request</h3><p style="color:#64748b;font-size:13px">${esc(line?.position_snapshot||'')} · ${esc(line?.department_snapshot||'')} · Vacancy ${line?.vacancy ?? '—'} · Open ${line?.open_vacancy ?? '—'}</p><form id="vacRequestForm"><div class="workforce-modal-grid">
      <label>Jumlah<input id="vacQty" type="number" min="1" step="1" value="${Math.max(Number(openQty)||0, 1)}" required></label>
      <label>Dibutuhkan tanggal<input id="vacNeeded" type="date" min="${esc(stateData.from)}" value="${esc(stateData.from)}"></label>
      <label>Prioritas<select id="vacPriority">${MPP_PRIORITIES.map(value=>`<option value="${value}" ${value==='NORMAL'?'selected':''}>${value}</option>`).join('')}</select></label>
      <label>Alasan<input id="vacReason" required placeholder="Contoh: tambah 1 fleet OB"></label>
      <label class="span-2">Alasan override (wajib bila jumlah &gt; vacancy, khusus super admin)<input id="vacOverride" placeholder="Diisi bila melebihi vacancy"></label></div>
      <div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button><button type="submit" id="vacSave" class="tombol tombol--utama">Simpan Draft</button></div><p id="vacMessage" class="modal__pesan" hidden></p></form>`);
    document.getElementById('vacRequestForm').addEventListener('submit', event => { event.preventDefault(); const button = document.getElementById('vacSave'); window.OMOSActionFeedback.run(button, async () => {
      const payload = { period: stateData.period, position_id: positionId, qty: Number(document.getElementById('vacQty').value||0),
        needed_by: document.getElementById('vacNeeded').value || null, priority: document.getElementById('vacPriority').value,
        reason: document.getElementById('vacReason').value, override_reason: document.getElementById('vacOverride').value || null };
      await request('/api/admin/karyawan/workforce/manpower-requests', { method:'POST', headers:{'Idempotency-Key':idempotency()}, body:JSON.stringify(payload) });
      tutupModal(); await refreshVacancy(); render();
    }, { successText:'Tersimpan', onRestore:()=>{} }).catch(error => { const msg = document.getElementById('vacMessage'); if (msg) { msg.hidden = false; msg.className = 'modal__pesan modal__pesan--error'; msg.textContent = error.message; } }); });
  }

  async function openRequestDetail(id) {
    bukaModal('<h3>Manpower Request</h3><div class="tabel__kosong">Memuat...</div>');
    try {
      const data = await request(`/api/admin/karyawan/workforce/manpower-requests/${encodeURIComponent(id)}`);
      const req = data.request;
      const stageIndex = MR_STAGES.indexOf(req.status);
      const transitions = MR_NEXT[req.status] || [];
      document.getElementById('modalKonten').innerHTML = `<h3>${esc(req.request_no)} · ${esc(MR_LABEL[req.status]||req.status)}</h3>`
        + `<p><b>${esc(req.position_name||'—')}</b> · ${esc(req.department_name||'')} · Qty ${req.filled_qty}/${req.qty} · Rev ${req.revision}<br><small>Butuh ${esc(fmtDate(req.needed_by))} · Prioritas ${esc(req.priority||'NORMAL')} · ${esc(req.reason||req.override_reason||'')}</small></p>`
        + `<div class="workforce-detail-steps">${MR_STAGES.map((stage, index)=>`<span class="workforce-step ${stageIndex >= 0 && index <= stageIndex?'is-done':''}">${esc(MR_LABEL[stage])}</span>`).join('')}</div>`
        + `<h4>Fulfillment (${(data.fulfillments||[]).length})</h4>${(data.fulfillments||[]).length ? `<ul class="workforce-drawer-list">${data.fulfillments.map(f=>`<li><b>${esc(f.employee_name)}</b> · ${esc(f.employee_id||'Tanpa ID')}<br><small>${esc(f.movement_no||'manual')} · ${esc(f.movement_type||'')} · qty ${f.qty}</small></li>`).join('')}</ul>` : '<p style="color:#64748b">Belum ada fulfillment.</p>'}`
        + (req.status === 'ONBOARDING' ? `<form id="mrFulfillForm"><div class="workforce-modal-grid"><label class="span-2">Karyawan pemenuh<select id="mrEmployee" required><option value="">Pilih karyawan</option>${employeeOptions()}</select></label></div><div class="modal__aksi"><button type="submit" id="mrFulfillSave" class="tombol tombol--utama">Catat fulfillment</button></div><p id="mrFulfillMsg" class="modal__pesan" hidden></p></form>` : '')
        + `<h4>Riwayat</h4>${(data.events||[]).map(ev=>`<p style="font-size:12px;color:#475569">${esc(fmtDate(ev.created_at))} · ${esc(ev.from_status||'—')} → <b>${esc(ev.to_status)}</b> · ${esc(ev.actor_name||'')} · ${esc(ev.reason||'')}</p>`).join('') || '<p style="color:#64748b">-</p>'}`
        + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>${transitions.map(status=>`<button type="button" class="tombol ${status==='FULFILLED'||status==='APPROVED'?'tombol--utama':'tombol--ghost'}" data-mr-transition="${status}" data-mr-revision="${req.revision}">${esc(MR_LABEL[status])}</button>`).join('')}</div>`;
      document.querySelectorAll('[data-mr-transition]').forEach(button => button.addEventListener('click', () => window.OMOSActionFeedback.run(button, async () => {
        await request(`/api/admin/karyawan/workforce/manpower-requests/${id}/transition`, { method:'POST', body:JSON.stringify({ status: button.dataset.mrTransition, expected_revision: Number(button.dataset.mrRevision) }) });
        await refreshVacancy(); tutupModal(); render();
      }, { successText:'Tersimpan' })));
      document.getElementById('mrFulfillForm')?.addEventListener('submit', event => { event.preventDefault(); const button = document.getElementById('mrFulfillSave'); window.OMOSActionFeedback.run(button, async () => {
        await request(`/api/admin/karyawan/workforce/manpower-requests/${id}/fulfillments`, { method:'POST', body:JSON.stringify({ employee_user_id: document.getElementById('mrEmployee').value }) });
        await refreshVacancy(); openRequestDetail(id); render();
      }, { successText:'Tersimpan' }).catch(error => { const msg = document.getElementById('mrFulfillMsg'); if (msg) { msg.hidden = false; msg.className = 'modal__pesan modal__pesan--error'; msg.textContent = error.message; } }); });
    } catch (error) { document.getElementById('modalKonten').innerHTML = `<h3>Manpower Request</h3><p style="color:#b91c1c">${esc(error.message)}</p>`; }
  }

  function forecastHtml() {
    const fc = stateData.mppForecast;
    if (!fc) return '<div class="tabel__kosong">Forecast belum tersedia. Pastikan migration 068–069 sudah diterapkan.</div>';
    const months = fc.months || [];
    const rows = (fc.positions || []).filter(row => !stateData.mppDeptFilter || String(row.department_id||'') === stateData.mppDeptFilter);
    let dept = '';
    const body = rows.map(row => {
      const group = row.department_name !== dept ? `<tr class="workforce-mpp-department"><th colspan="${5 + months.length}">${esc(row.department_name)}</th></tr>` : '';
      dept = row.department_name;
      const cells = months.map(period => {
        const val = row.forecast?.[period] ?? 0;
        const variance = row.variance?.[period];
        const klass = variance == null ? '' : variance < 0 ? 'workforce-gap--less' : 'workforce-gap--fit';
        return `<td data-label="${esc(shortMonth(period))}" class="${klass}"><b>${val}</b>${variance == null ? '<br><small>tanpa plan</small>' : `<br><small>${variance >= 0 ? '+' : ''}${variance} vs butuh</small>`}</td>`;
      }).join('');
      const causes = months.map(period => (row.causes?.[period] || []).join('; ') || '—').join(' · ');
      return `${group}<tr><td><b>${esc(row.position_name)}</b>${row.is_critical?'<br><small class="workforce-critical">Kritis</small>':''}</td><td data-label="Aktual">${row.baseline_actual}</td>${cells}<td data-label="Risiko" class="${row.risk==='Kritis'?'workforce-gap--less':row.risk==='Waspada'?'workforce-gap--more':'workforce-gap--fit'}"><b>${esc(row.risk)}</b></td><td data-label="Penyebab"><small>${esc(causes)}</small></td></tr>`;
    }).join('');
    const totals = months.map(period => {
      const t = fc.totals?.[period] || {};
      return `<td><b>${t.forecast ?? 0}</b>${t.variance == null ? '' : `<br><small>${t.variance >= 0 ? '+' : ''}${t.variance}</small>`}</td>`;
    }).join('');
    const baseActual = rows.reduce((sum, row) => sum + Number(row.baseline_actual||0), 0);
    const scenarios = stateData.mppScenarios || [];
    return `<div class="workforce-kpis">${months.map(period => kpi(shortMonth(period), fc.totals?.[period]?.forecast ?? 0, fc.totals?.[period]?.variance == null ? 'tanpa plan pembanding' : `variance ${fc.totals[period].variance >= 0 ? '+' : ''}${fc.totals[period].variance}`, '#0284c7', 'mpp')).join('')}</div>`
      + `<div class="workforce-card"><div class="workforce-mpp-head"><div><h3>Forecast Headcount · ${esc(shortMonth(fc.from))} → ${esc(shortMonth(fc.to))}</h3><p>Deterministik dari rotasi APPROVED + kontrak berakhir; baseline aktual ${esc(fmtDate(fc.baseline_date))}. AI tidak ikut menghitung. ${fc.meta ? `${fc.meta.approved_movements} movement terjadwal, ${fc.meta.contracts_ending} kontrak berakhir.` : ''}${fc.meta?.unmapped_events ? ` <b class="workforce-gap--more">${fc.meta.unmapped_events} event tak terpetakan.</b>` : ''}</p></div><div class="workforce-actions"><button type="button" class="tombol tombol--utama" id="forecastScenarioBtn">+ Buat Simulasi</button></div></div>`
      + (rows.length ? `<div class="workforce-mpp-wrap"><table class="workforce-table workforce-mpp-table"><thead><tr><th>Jabatan</th><th>Aktual Saat Ini</th>${months.map(period=>`<th>${esc(shortMonth(period))}</th>`).join('')}<th>Risiko</th><th>Penyebab</th></tr></thead><tbody>${body}<tr class="workforce-mpp-department"><th>TOTAL</th><th>${baseActual}</th>${totals}<th colspan="2"></th></tr></tbody></table></div>` : '<div class="tabel__kosong">Tidak ada jabatan pada filter ini.</div>')
      + `<h3 style="margin-top:14px">Simulasi <span class="workforce-sim-badge">Simulation</span></h3>${scenarios.length ? `<div class="workforce-mpp-wrap"><table class="workforce-table workforce-history-table"><thead><tr><th>Nama</th><th>Baseline</th><th>Baris</th><th>Pembuat</th></tr></thead><tbody>${scenarios.map(sc=>`<tr class="workforce-row" data-sc-detail="${esc(sc.id)}"><td data-label="Nama"><b>${esc(sc.name)}</b> <span class="workforce-sim-badge">Simulation</span></td><td data-label="Baseline">${esc(shortMonth(String(sc.base_period).slice(0,7)))}</td><td data-label="Baris">${sc.line_count}</td><td data-label="Pembuat">${esc(sc.creator_name||'—')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="tabel__kosong">Belum ada simulasi. Simulasi tersimpan terpisah dan tidak mengubah approved MPP.</div>'}</div>`;
  }

  async function refreshForecast() {
    const forecastTo = shiftPeriod(stateData.period, 2);
    const [forecastData, scenarioData] = await Promise.all([
      request(`/api/admin/karyawan/workforce/mpp/forecast?from=${stateData.period}&to=${forecastTo}`).catch(() => null),
      request(`/api/admin/karyawan/workforce/mpp/scenarios?from=${stateData.period}&to=${forecastTo}`).catch(() => ({ rows: [] })),
    ]);
    stateData.mppForecast = forecastData;
    stateData.mppScenarios = scenarioData.rows || [];
  }

  function openScenarioForm() {
    const fc = stateData.mppForecast;
    if (!fc || !(fc.months || []).length) { window.alert('Forecast belum tersedia.'); return; }
    const months = fc.months;
    const rows = (fc.positions || []).map(row => `<tr><td><b>${esc(row.position_name)}</b><br><small>${esc(row.department_name)}</small></td>${months.map(period => {
      const prefill = row.required?.[period] ?? row.forecast?.[period] ?? row.baseline_actual;
      return `<td><input type="number" min="0" step="1" data-sc-position="${esc(row.position_id)}" data-sc-month="${period}" value="${prefill}" aria-label="Simulasi ${esc(row.position_name)} ${esc(shortMonth(period))}"></td>`;
    }).join('')}</tr>`).join('');
    bukaModal(`<h3>Buat Simulasi <span class="workforce-sim-badge">Simulation</span></h3><p style="color:#64748b;font-size:13px">Simulasi tersimpan terpisah; approved MPP tidak berubah.</p><form id="scenarioForm"><div class="workforce-modal-grid"><label class="span-2">Nama simulasi<input id="scName" required placeholder="Contoh: Tambah 1 fleet Q1"></label></div><div class="workforce-mpp-wrap"><table class="workforce-table workforce-mpp-table"><thead><tr><th>Jabatan</th>${months.map(period=>`<th>${esc(shortMonth(period))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button><button type="submit" id="scSave" class="tombol tombol--utama">Simpan Simulasi</button></div><p id="scMessage" class="modal__pesan" hidden></p></form>`);
    document.getElementById('scenarioForm').addEventListener('submit', event => { event.preventDefault(); const button = document.getElementById('scSave'); window.OMOSActionFeedback.run(button, async () => {
      const lines = [...document.querySelectorAll('[data-sc-position]')].map(input => ({ position_id: input.dataset.scPosition, period_month: `${input.dataset.scMonth}-01`, required_qty: Number(input.value||0) }));
      await request('/api/admin/karyawan/workforce/mpp/scenarios', { method:'POST', body:JSON.stringify({ name: document.getElementById('scName').value, base_period: stateData.period, lines }) });
      tutupModal(); await refreshForecast(); render();
    }, { successText:'Tersimpan', onRestore:()=>{} }).catch(error => { const msg = document.getElementById('scMessage'); if (msg) { msg.hidden = false; msg.className = 'modal__pesan modal__pesan--error'; msg.textContent = error.message; } }); });
  }

  async function openScenarioDetail(id) {
    bukaModal('<h3>Simulasi</h3><div class="tabel__kosong">Memuat...</div>');
    try {
      const data = await request(`/api/admin/karyawan/workforce/mpp/scenarios/${encodeURIComponent(id)}`);
      const sc = data.scenario;
      document.getElementById('modalKonten').innerHTML = `<h3>${esc(sc.name)} <span class="workforce-sim-badge">Simulation</span></h3><p><small>Baseline ${esc(shortMonth(String(sc.base_period).slice(0,7)))} · ${esc(sc.creator_name||'—')}</small></p>`
        + `<div class="workforce-mpp-wrap"><table class="workforce-table workforce-history-table"><thead><tr><th>Bulan</th><th>Jabatan</th><th>Simulasi</th><th>Approved</th><th>Delta</th></tr></thead><tbody>${(data.lines||[]).map(line=>`<tr><td data-label="Bulan">${esc(shortMonth(String(line.period_month).slice(0,7)))}</td><td data-label="Jabatan"><b>${esc(line.position_snapshot)}</b></td><td data-label="Simulasi">${line.required_qty}</td><td data-label="Approved">${line.approved_required_qty ?? '—'}</td><td data-label="Delta" class="${line.delta_vs_approved == null ? '' : line.delta_vs_approved !== 0 ? 'workforce-gap--less' : 'workforce-gap--fit'}">${line.delta_vs_approved == null ? '—' : (line.delta_vs_approved >= 0 ? '+' : '') + line.delta_vs_approved}</td></tr>`).join('')}</tbody></table></div>`
        + `<div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button><button type="button" class="tombol tombol--ghost" id="scDelete">Hapus Simulasi</button></div>`;
      document.getElementById('scDelete')?.addEventListener('click', event => window.OMOSActionFeedback.run(event.currentTarget, async () => {
        await request(`/api/admin/karyawan/workforce/mpp/scenarios/${encodeURIComponent(id)}`, { method:'DELETE' });
        tutupModal(); await refreshForecast(); render();
      }, { successText:'Tersimpan' }));
    } catch (error) { document.getElementById('modalKonten').innerHTML = `<h3>Simulasi</h3><p style="color:#b91c1c">${esc(error.message)}</p>`; }
  }

  function mppHistoryHtml() {
    const rows = stateData.mppHistory || [];
    if (!rows.length) return '<div class="tabel__kosong">Belum ada riwayat perubahan kebutuhan pada periode ini.</div>';
    return `<div class="workforce-mpp-wrap"><table class="workforce-table workforce-history-table"><thead><tr><th>Waktu</th><th>Jabatan</th><th>Sebelum</th><th>Sesudah</th><th>User</th><th>Alasan</th></tr></thead><tbody>${rows.map(row=>{
      const before = row.previous_value?.required_qty ?? '—';
      const after = row.new_value?.required_qty ?? '—';
      return `<tr><td data-label="Waktu">${esc(fmtDate(row.created_at))}</td><td data-label="Jabatan"><b>${esc(row.position_snapshot||'—')}</b><br><small>${esc(row.department_snapshot||'')}</small></td>`
        + `<td data-label="Sebelum">${esc(before)}</td><td data-label="Sesudah">${esc(after)}</td>`
        + `<td data-label="User">${esc(row.actor_name||'—')}</td><td data-label="Alasan">${esc(row.reason||row.new_value?.reason_text||row.new_value?.reason_code||'—')}<br><small>${esc(row.action||'')}</small></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function mppDrawerHtml() {
    const data = stateData.mppDrawerData;
    if (!stateData.mppDrawer) return '';
    const body = !data ? '<div class="tabel__kosong">Memuat daftar karyawan...</div>'
      : data.personnel.length ? `<p class="workforce-drawer-sub">${esc(data.count)} karyawan · snapshot ${esc(fmtDate(data.snapshot_date))}</p><ul class="workforce-drawer-list">${data.personnel.map(person=>`<li><b>${esc(person.nama)}</b><br><small>${esc(person.employee_id||'Tanpa ID')} · ${esc(person.employment_status||'')} · ${esc(person.grade||'—')} · efektif ${esc(fmtDate(person.effective_from))}${person.contract_end_date?` · kontrak s/d ${esc(fmtDate(person.contract_end_date))}`:''}</small></li>`).join('')}</ul>`
      : '<div class="tabel__kosong">Tidak ada karyawan aktif pada snapshot ini.</div>';
    return `<div class="workforce-drawer" role="dialog" aria-label="Daftar karyawan aktual"><div class="workforce-drawer-head"><div><h4>${esc(data?.position?.name || 'Aktual')}</h4><p>${esc(data?.position?.department_name || '')}</p></div><button type="button" class="tombol tombol--ghost" id="workforceDrawerClose">Tutup</button></div>${body}</div>`;
  }

  function mppHtml() {
    const data = stateData.mpp || { plan:null, lines:[], summary:null, departments:[] };
    const summary = data.summary || { actual:0, required:0, gap:0, open_vacancy:0, critical_positions:0, fill_rate:null };
    const rows = data.lines || [];
    const filtered = stateData.mppDeptFilter ? rows.filter(row => String(row.department_id||'') === stateData.mppDeptFilter) : rows;
    const transitions = data.plan ? ({ DRAFT:['SUBMITTED','CANCELLED'], SUBMITTED:['APPROVED','CANCELLED'] }[data.plan.status] || []) : [];
    return `<div class="workforce-kpis">
      ${kpi('Aktual',summary.actual,'karyawan aktif','#0284c7','mpp')}${kpi('Kebutuhan',summary.required,stateData.period,'#0f766e','mpp')}${kpi('Gap',summary.gap,Number(summary.gap)>0?'kekurangan':Number(summary.gap)<0?'surplus':'imbang','#dc2626','mpp')}${kpi('Vacancy aktif',summary.open_vacancy,'belum terpenuhi','#d97706','mpp')}${kpi('Posisi kritis',summary.critical_positions,'kurang & kritis','#7c3aed','mpp')}${kpi('Fill Rate',fmtPct(summary.fill_rate),data.plan?`Rev ${data.plan.version_no} · ${data.plan.status}`:'Belum disimpan','#16a34a','mpp')}
    </div>${mppDeptCards()}
    <div class="workforce-card"><div class="workforce-mpp-head"><div><h3>Man Power Planning · ${esc(stateData.period)}</h3><p>Snapshot aktual pada akhir bulan (${esc(fmtDate(data.snapshot_date))}) · ${data.plan?`Draft/Revisi ${data.plan.version_no} · ${data.plan.status}`:'Belum ada plan'} · Aktual server-side, tidak dapat diedit.</p></div><div class="workforce-actions"><div class="workforce-segmented" role="tablist"><button type="button" role="tab" data-mpp-view="headcount" class="${stateData.mppView==='headcount'?'is-active':''}">Headcount</button><button type="button" role="tab" data-mpp-view="vacancy" class="${stateData.mppView==='vacancy'?'is-active':''}">Vacancy</button><button type="button" role="tab" data-mpp-view="forecast" class="${stateData.mppView==='forecast'?'is-active':''}">Forecast</button><button type="button" role="tab" data-mpp-view="riwayat" class="${stateData.mppView==='riwayat'?'is-active':''}">Riwayat</button></div><button type="button" class="tombol tombol--utama" id="workforceMppSave" hidden>Simpan Perubahan</button>${transitions.map(status=>`<button type="button" class="tombol ${status==='APPROVED'?'tombol--utama':'tombol--ghost'}" data-mpp-transition="${status}">${esc(status==='SUBMITTED'?'Ajukan':status==='APPROVED'?'Setujui':status==='CANCELLED'?'Batalkan':status)}</button>`).join('')}</div></div>
      ${stateData.mppView==='riwayat'?mppHistoryHtml():stateData.mppView==='vacancy'?vacancyHtml():stateData.mppView==='forecast'?forecastHtml():(filtered.length?`<div class="workforce-mpp-wrap"><table class="workforce-table workforce-mpp-table"><thead><tr><th>Jabatan</th><th>Aktual</th><th>Kebutuhan</th><th>Gap</th><th>Status</th><th>Alasan</th><th>Prioritas</th><th>Butuh tgl</th></tr></thead><tbody>${mppHeadcountRows(filtered)}</tbody></table></div>`:'<div class="tabel__kosong">Master jabatan aktif belum tersedia.</div>')}
      ${mppDrawerHtml()}</div>`;
  }

  function periodControls() {
    const [selectedYear,selectedMonth]=stateData.period.split('-').map(Number),currentYear=Number(today().slice(0,4));
    const monthNames=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const years=Array.from({length:11},(_,index)=>currentYear-5+index);
    return `<label>Bulan<select id="workforceMonth" class="input-filter">${monthNames.map((name,index)=>`<option value="${index+1}" ${index+1===selectedMonth?'selected':''}>${name}</option>`).join('')}</select></label><label>Tahun<select id="workforceYear" class="input-filter">${years.map(year=>`<option value="${year}" ${year===selectedYear?'selected':''}>${year}</option>`).join('')}</select></label>`;
  }

  function render() {
    const root=document.getElementById(rootId); if(!root) return;
    root.innerHTML=`<div class="workforce-toolbar"><div class="workforce-filters">${periodControls()}<button type="button" class="tombol tombol--ghost" id="workforceApply">Terapkan</button></div><div class="workforce-actions"><button type="button" class="tombol tombol--ghost" id="workforceExport">Ekspor CSV</button><button type="button" class="tombol tombol--utama" id="workforceCreate">+ Catat Rotasi</button></div></div>
      <div class="workforce-tabs">${tabButtons()}</div>${stateData.tab==='summary'?summaryHtml():stateData.tab==='mpp'?mppHtml():listHtml()}`;
    bindRendered();
  }

  async function reload() {
    const root=document.getElementById(rootId); if(root) root.innerHTML='<div class="tabel__kosong">Memuat data Rotasi Karyawan...</div>';
    try { await fetchAll(); render(); } catch(error) { if(root) root.innerHTML=`<div class="tabel__kosong" style="color:#b91c1c">${esc(error.message)}</div>`; throw error; }
  }

  function bindRendered() {
    document.querySelectorAll('[data-workforce-tab]').forEach(button=>button.addEventListener('click',async()=>{stateData.tab=button.dataset.workforceTab;await reload()}));
    document.querySelectorAll('[data-kpi-tab]').forEach(button=>button.addEventListener('click',async()=>{stateData.tab=button.dataset.kpiTab;await reload()}));
    document.querySelectorAll('[data-movement-id]').forEach(row=>row.addEventListener('click',()=>openDetail(row.dataset.movementId)));
    document.getElementById('workforceApply')?.addEventListener('click',async()=>{const year=document.getElementById('workforceYear').value,month=String(document.getElementById('workforceMonth').value).padStart(2,'0');applyPeriod(`${year}-${month}`);await reload()});
    document.getElementById('workforceCreate')?.addEventListener('click',openMovementForm);
    document.getElementById('workforceExport')?.addEventListener('click',exportCsv);
    document.querySelectorAll('[data-mpp-need],[data-mpp-reason],[data-mpp-reason-text],[data-mpp-priority],[data-mpp-needed]').forEach(input=>input.addEventListener('input',()=>{syncMppRow(input);syncMppDirty()}));
    document.querySelectorAll('[data-mpp-dept]').forEach(button=>button.addEventListener('click',()=>{stateData.mppDeptFilter=button.dataset.mppDept||'';render()}));
    document.querySelectorAll('[data-mpp-view]').forEach(button=>button.addEventListener('click',()=>{stateData.mppView=button.dataset.mppView;render()}));
    document.querySelectorAll('[data-vac-request]').forEach(button=>button.addEventListener('click',()=>openVacancyRequest(button.dataset.vacRequest,button.dataset.vacancy)));
    document.querySelectorAll('[data-mr-detail]').forEach(row=>row.addEventListener('click',()=>openRequestDetail(row.dataset.mrDetail)));
    document.getElementById('forecastScenarioBtn')?.addEventListener('click',openScenarioForm);
    document.querySelectorAll('[data-sc-detail]').forEach(row=>row.addEventListener('click',()=>openScenarioDetail(row.dataset.scDetail)));
    document.querySelectorAll('[data-mpp-actual]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();openMppDrawer(button.dataset.mppActual)}));
    document.getElementById('workforceDrawerClose')?.addEventListener('click',()=>{stateData.mppDrawer=null;stateData.mppDrawerData=null;render()});
    document.getElementById('workforceMppSave')?.addEventListener('click',saveMppMonth);
    document.querySelectorAll('[data-mpp-transition]').forEach(button=>button.addEventListener('click',()=>window.OMOSActionFeedback.run(button,async()=>{
      await request(`/api/admin/karyawan/workforce/mpp/${stateData.mpp.plan.id}/transition`,{method:'POST',body:JSON.stringify({status:button.dataset.mppTransition})});
      const [mppData, historyData] = await Promise.all([
        request(`/api/admin/karyawan/workforce/mpp?period=${stateData.period}`),
        request(`/api/admin/karyawan/workforce/mpp/history?period=${stateData.period}&limit=50`).catch(() => ({ rows: [] })),
      ]);
      stateData.mpp=mppData;stateData.mppHistory=historyData.rows||[];stateData.mppIdem=idempotency();render();
    },{successText:'Tersimpan'})));
  }

  function movementOptions() { return Object.entries(typeLabels).map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join(''); }
  function employeeOptions() { return stateData.employees.map(row=>`<option value="${esc(row.id)}">${esc(row.nama)} · ${esc(row.employee_id||'Tanpa ID')} · ${esc(row.departemen||'Tanpa dept')}</option>`).join(''); }
  function departmentOptions(selected='') { return (stateData.organization?.departments||[]).map(row=>`<option ${row.name===selected?'selected':''}>${esc(row.name)}</option>`).join(''); }

  function openMovementForm(defaults = {}) {
    // People v2: form pergerakan baru (jabatan dari master, jenis lengkap, hari kerja terakhir).
    if (window.OMOSPeople?.openMove) { window.OMOSPeople.openMove(defaults.employeeId || null, defaults.type || 'TRANSFER'); return; }
    bukaModal(`<h3>Catat Rotasi Karyawan</h3><p style="color:#64748b;font-size:13px">Disimpan sebagai Draft. Perubahan master baru berlaku setelah approval dan status Efektif.</p><form id="workforceMovementForm"><div class="workforce-modal-grid">
      <label>Jenis<select id="wfType" required>${movementOptions()}</select></label><label>Karyawan<select id="wfEmployee" required><option value="">Pilih karyawan</option>${employeeOptions()}</select></label>
      <label>Tanggal efektif<input id="wfEffective" type="date" value="${today()}" required></label><label>Departemen tujuan<input id="wfDepartment" list="wfDepartments" required><datalist id="wfDepartments">${departmentOptions()}</datalist></label>
      <label>Jabatan tujuan<input id="wfPosition" required></label><label>Site/Area<input id="wfSite"></label><label>Grade<input id="wfGrade"></label><label>Tipe kerja<input id="wfEmploymentType" placeholder="PKWT / PKWTT / Harian"></label>
      <label class="span-2">Alasan<input id="wfReason" required></label><label class="span-2">Catatan<textarea id="wfNotes" rows="3"></textarea></label></div>
      <div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Batal</button><button type="submit" id="wfSave" class="tombol tombol--utama">Simpan Draft</button></div><p id="wfMessage" class="modal__pesan" hidden></p></form>`);
    const type=document.getElementById('wfType'), employee=document.getElementById('wfEmployee');
    const syncEmployee=()=>{const row=stateData.employees.find(item=>item.id===employee.value);if(!row)return;document.getElementById('wfDepartment').value=row.departemen||'';document.getElementById('wfPosition').value=row.jabatan||''};
    const syncRequired=()=>{const exit=['RESIGN','TERMINATION','CONTRACT_END','RETIREMENT'].includes(type.value);document.getElementById('wfDepartment').required=!exit;document.getElementById('wfPosition').required=!exit};
    if(defaults.type) type.value=defaults.type;if(defaults.employeeId) employee.value=defaults.employeeId;
    employee.addEventListener('change',syncEmployee);type.addEventListener('change',syncRequired);syncEmployee();syncRequired();
    document.getElementById('workforceMovementForm').addEventListener('submit',event=>{event.preventDefault();const button=document.getElementById('wfSave');window.OMOSActionFeedback.run(button,async()=>{
      const payload={movement_type:type.value,employee_id:employee.value,effective_date:document.getElementById('wfEffective').value,reason:document.getElementById('wfReason').value,notes:document.getElementById('wfNotes').value,after_state:{department:document.getElementById('wfDepartment').value,position:document.getElementById('wfPosition').value,site:document.getElementById('wfSite').value,grade:document.getElementById('wfGrade').value,employment_type:document.getElementById('wfEmploymentType').value}};
      await request('/api/admin/karyawan/workforce/movements',{method:'POST',headers:{'Idempotency-Key':idempotency()},body:JSON.stringify(payload)});tutupModal();await reload();
    },{successText:'Tersimpan',onRestore:()=>{}}).catch(error=>{const msg=document.getElementById('wfMessage');if(msg){msg.hidden=false;msg.className='modal__pesan modal__pesan--error';msg.textContent=error.message}})});
  }

  async function openDetail(id) {
    bukaModal('<h3>Detail Rotasi</h3><div class="tabel__kosong">Memuat...</div>');
    try {
      const data=await request(`/api/admin/karyawan/workforce/movements/${encodeURIComponent(id)}`),m=data.movement,b=m.before_state||{},a=m.after_state||{};
      const transitions={DRAFT:['SUBMITTED','CANCELLED'],SUBMITTED:['APPROVED','REJECTED','CANCELLED'],APPROVED:['EFFECTIVE','CANCELLED']}[m.status]||[];
      document.getElementById('modalKonten').innerHTML=`<h3>${esc(m.movement_no)} · ${esc(labelType(m.movement_type))}</h3><p><b>${esc(m.nama)}</b> · ${esc(m.employee_id||'Tanpa ID')} <span class="workforce-status">${esc(labelStatus(m.status))}</span></p>
        <table class="workforce-table"><thead><tr><th>Data</th><th>Sebelum</th><th>Sesudah</th></tr></thead><tbody>${['department','position','site','grade','employment_type'].map(key=>`<tr><td>${esc(key)}</td><td>${esc(b[key]||'—')}</td><td>${esc(a[key]||'—')}</td></tr>`).join('')}</tbody></table>
        <div class="workforce-detail-steps"><span class="workforce-step is-done">Draft</span><span class="workforce-step ${['SUBMITTED','APPROVED','EFFECTIVE'].includes(m.status)?'is-done':''}">Diajukan</span><span class="workforce-step ${['APPROVED','EFFECTIVE'].includes(m.status)?'is-done':''}">Disetujui</span><span class="workforce-step ${m.status==='EFFECTIVE'?'is-done':''}">Efektif</span></div>
        <h4>Checklist</h4>${data.tasks.length?data.tasks.map(task=>`<div class="workforce-task"><span><b>${esc(task.task_name)}</b><br><small>${esc(task.task_kind)}</small></span><select data-task-id="${esc(task.id)}"><option value="OPEN" ${task.status==='OPEN'?'selected':''}>Open</option><option value="IN_PROGRESS" ${task.status==='IN_PROGRESS'?'selected':''}>Proses</option><option value="DONE" ${task.status==='DONE'?'selected':''}>Selesai</option><option value="WAIVED" ${task.status==='WAIVED'?'selected':''}>Dikecualikan</option></select></div>`).join(''):'<p style="color:#64748b">Tidak ada checklist untuk jenis ini.</p>'}
        <div class="modal__aksi"><button type="button" class="tombol tombol--ghost" onclick="tutupModal()">Tutup</button>${transitions.map(status=>`<button type="button" class="tombol ${status==='EFFECTIVE'?'tombol--utama':'tombol--ghost'}" data-transition="${status}">${esc(labelStatus(status))}</button>`).join('')}</div>`;
      document.querySelectorAll('[data-task-id]').forEach(select=>select.addEventListener('change',async()=>{await request(`/api/admin/karyawan/workforce/tasks/${select.dataset.taskId}`,{method:'PATCH',body:JSON.stringify({status:select.value})})}));
      document.querySelectorAll('[data-transition]').forEach(button=>button.addEventListener('click',()=>window.OMOSActionFeedback.run(button,async()=>{await request(`/api/admin/karyawan/workforce/movements/${id}/transition`,{method:'POST',body:JSON.stringify({status:button.dataset.transition})});tutupModal();await reload()},{successText:'Tersimpan'})));
    } catch(error) { document.getElementById('modalKonten').innerHTML=`<h3>Detail Rotasi</h3><p style="color:#b91c1c">${esc(error.message)}</p>`; }
  }

  function syncMppRow(input) {
    const row=input.closest('[data-mpp-position]'),actual=Number(row?.querySelector('.workforce-mpp-actual')?.textContent||0);
    const required=Number(input.value||0),gap=required-actual,klass=gap>0?'less':gap<0?'more':'fit';
    const gapCell=row?.querySelector('[data-mpp-gap]'),statusCell=row?.querySelector('[data-mpp-status]');
    if(gapCell){gapCell.className=`workforce-gap--${klass}`;gapCell.textContent=gap>0?`-${gap}`:gap<0?`+${Math.abs(gap)}`:'0'}
    if(statusCell){statusCell.className=`workforce-gap--${klass}`;statusCell.textContent=gap>0?'Kurang':gap<0?'Lebih':'Sesuai'}
  }

  function rowDirty(row) {
    const need = row.querySelector('[data-mpp-need]');
    if (need && Number(need.value||0) !== Number(need.dataset.initial||0)) return true;
    return [...row.querySelectorAll('[data-mpp-reason],[data-mpp-reason-text],[data-mpp-priority],[data-mpp-needed]')]
      .some(input => String(input.value ?? '') !== String(input.dataset.initial ?? ''));
  }

  function syncMppDirty() {
    const dirty=[...document.querySelectorAll('[data-mpp-position]')].some(rowDirty);
    const button=document.getElementById('workforceMppSave');if(button)button.hidden=!dirty;
    document.querySelectorAll('[data-mpp-transition]').forEach(control=>{control.disabled=dirty;control.title=dirty?'Simpan perubahan kebutuhan terlebih dahulu.':''});
  }

  async function openMppDrawer(positionId) {
    stateData.mppDrawer = positionId;
    stateData.mppDrawerData = null;
    render();
    try {
      stateData.mppDrawerData = await request(`/api/admin/karyawan/workforce/mpp/actual?period=${stateData.period}&position_id=${encodeURIComponent(positionId)}`);
    } catch (error) {
      stateData.mppDrawerData = { position:{ name:'Aktual', department_name:'' }, count:0, personnel:[], snapshot_date:'', error:error.message };
    }
    if (stateData.mppDrawer === positionId) render();
  }

  function collectMppLines() {
    return [...document.querySelectorAll('[data-mpp-position]')].map(row=>({
      position_id: row.dataset.mppPosition,
      required_qty: Number(row.querySelector('[data-mpp-need]').value||0),
      reason_code: row.querySelector('[data-mpp-reason]').value || null,
      reason_text: row.querySelector('[data-mpp-reason-text]').value.trim() || null,
      notes: row.querySelector('[data-mpp-reason-text]').value.trim() || null,
      priority: row.querySelector('[data-mpp-priority]').value,
      needed_by: row.querySelector('[data-mpp-needed]').value || null,
      expected_revision: Number(row.dataset.revision||1),
      changed: rowDirty(row),
    }));
  }

  async function saveMppMonth() {
    const button=document.getElementById('workforceMppSave');if(!button)return;
    const lines = collectMppLines();
    const missing = lines.filter(row => row.changed && Number(row.required_qty) !== Number(document.querySelector(`[data-mpp-position="${CSS.escape(row.position_id)}"] [data-mpp-need]`).dataset.initial||0) && !row.reason_code && !row.reason_text);
    if (missing.length) { window.alert('Alasan perubahan kebutuhan wajib diisi pada baris yang diubah.'); return; }
    try {
      const saved=await window.OMOSActionFeedback.run(button,async()=>{
        const payload = { period: stateData.period, name:`MPP ${stateData.period.slice(0,4)}`,
          expected_version_no: stateData.mpp?.plan?.version_no ?? null,
          idempotency_key: stateData.mppIdem,
          lines: lines.map(({ changed, ...row }) => row) };
        return request('/api/admin/karyawan/workforce/mpp',{method:'PUT',headers:{'Idempotency-Key':stateData.mppIdem},body:JSON.stringify(payload)});
      },{successText:'Tersimpan',resolveDisabled:()=>true});
      if(saved){stateData.mpp=await request(`/api/admin/karyawan/workforce/mpp?period=${stateData.period}`);stateData.mppIdem=idempotency();render()}
    } catch(error) {
      if (/409|berubah oleh pengguna lain|Muat ulang/i.test(error.message)) {
        window.alert(`${error.message} Muat ulang data terlebih dahulu — input Anda tetap tampil dan tidak hilang.`);
        syncMppDirty();
      } else window.alert(error.message);
    }
  }

  function exportCsv() {
    if (stateData.tab === 'mpp') {
      const data = stateData.mpp || {};
      const rows = [['Periode','Departemen','Jabatan','Aktual','Kebutuhan','Gap','Status','Vacancy','Prioritas','Dibutuhkan tgl','Kritis']];
      (data.lines||[]).forEach(row=>rows.push([stateData.period,row.department_snapshot,row.position_snapshot,row.actual,row.required_qty,
        Number(row.required_qty||0)-Number(row.actual||0),row.status ?? '',Math.max(Number(row.required_qty||0)-Number(row.actual||0),0),
        row.priority||'NORMAL',row.needed_by||'',row.is_critical?'Ya':'Tidak']));
      const csv=rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));a.download=`mpp-${stateData.period}.csv`;a.click();URL.revokeObjectURL(a.href);
      return;
    }
    filteredRows().forEach(row=>rows.push([row.effective_date,row.movement_no,row.nama,row.employee_id,labelType(row.movement_type),labelStatus(row.status),row.before_state?.department,row.before_state?.position,row.after_state?.department,row.after_state?.position]));
    const csv=rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));a.download=`rotasi-karyawan-${stateData.from}-${stateData.to}.csv`;a.click();URL.revokeObjectURL(a.href);
  }

  document.querySelectorAll('[data-workforce-mode]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.workforceMode)));
  window.OMOSWorkforce={ async load(){if(!stateData.period){applyPeriod(today().slice(0,7));stateData.mode=localStorage.getItem('omos_people_mode')||'movement'}setMode(stateData.mode);if(stateData.mode==='movement'||!stateData.loaded){await reload();stateData.loaded=true}return stateData}, setMode,
    openForEmployee(employeeId,type){if(window.OMOSPeople?.openMove){window.OMOSPeople.openMove(employeeId,type);return}setMode('movement');openMovementForm({employeeId,type})},
    // Dipakai tab MPP di halaman People v2 (people.js): tampilkan MPP tanpa tab rotasi lama.
    async showMpp(){if(!stateData.period)applyPeriod(today().slice(0,7));stateData.mode='movement';stateData.tab='mpp';const root=document.getElementById(rootId);if(root)root.hidden=false;await reload();stateData.loaded=true;return stateData} };
})();
