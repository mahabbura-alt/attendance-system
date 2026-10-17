(function (global) {
  'use strict';
  const Core = global.FleetDeploymentCore;
  const state = { rows: [], options: null, filters: { search: '', from: '', to: '', status: '', area: '', job: '', material: '' }, view: 'list', loading: false,
    wizard: null, preview: null, dirty: false, initialized: false };
  const api = path => typeof global.getProdApiUrl === 'function' ? global.getProdApiUrl(path) : path;
  const auth = () => typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  const root = () => document.getElementById('fleetDeploymentRoot');
  const E = Core.esc;
  const icon = name => ({
    fleet: '<svg viewBox="0 0 24 24"><path d="M3 15h12V7H6l-3 4v4Zm12-5h3l3 3v2h-6v-5ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>',
    excavator: '<svg viewBox="0 0 24 24"><path d="M2 17h12l2-4h3l3 2v2h-4a3 3 0 0 1-5 2H7a3 3 0 0 1-5-2Zm5-2V8h5l3 7H7Zm7-6 2-5h2l-2 7-2-2Z"/><circle cx="5" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    draft: '<svg viewBox="0 0 24 24"><path d="M6 2h9l4 4v16H6V2Zm8 1.5V7h3.5M9 11h7M9 15h7M9 19h5"/></svg>',
    conflict: '<svg viewBox="0 0 24 24"><path d="M12 3 2.5 21h19L12 3Zm0 6v6m0 3v.2"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>',
    ob: '<svg viewBox="0 0 24 24"><path d="m2 20 7-11 3 5 3-8 7 14H2Z"/></svg>',
    coal: '<svg viewBox="0 0 24 24"><path d="m3 19 5-12 4 4 3-7 6 15H3Z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s6-6.1 6-12a6 6 0 1 0-12 0c0 5.9 6 12 6 12Z"/><circle cx="12" cy="9" r="2"/></svg>',
    job: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3m-13 5h18"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h12M9 12h12M9 18h12M3 6h2M3 12h2M3 18h2"/></svg>',
  }[name] || '');

  async function request(path, options = {}) {
    const response = await fetch(api(`/api/admin/production${path}`), { ...options,
      headers: { ...auth(), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }
  function setDirty(value) { state.dirty = Boolean(value); }
  global.addEventListener('beforeunload', event => { if (!state.dirty) return; event.preventDefault(); event.returnValue = ''; });

  function statusBadge(status) { return `<span class="fdp-status fdp-status--${E(status)}">${E(Core.STATUS_LABEL[status] || status)}</span>`; }
  function pageHeader() {
    return `<div class="fdp-head"><div class="fdp-title"><span class="fdp-title-icon">${icon('fleet')}</span><div><h2>Fleet Deployment Planner</h2>
      <p>Kelola skema running fleet berdasarkan periode, area, JOB, dan material.</p></div></div>
      <button class="fdp-primary fdp-3d" data-action="new">＋ Buat Skema</button></div>`;
  }
  function kpis(rows = state.rows) {
    const sum = Core.summarize(rows);
    return `<div class="fdp-kpis">
      <article class="is-fleet"><i>${icon('fleet')}</i><small>ACTIVE FLEET</small><strong>${sum.fleets}</strong><span>fleet terplot</span></article>
      <article class="is-draft"><i>${icon('draft')}</i><small>DRAFT</small><strong>${sum.drafts}</strong><span>belum dipublikasi</span></article>
      <article class="is-conflict"><i>${icon('conflict')}</i><small>CONFLICT</small><strong>${sum.conflicts}</strong><span>alokasi bertabrakan</span></article>
      <article class="is-unassigned"><i>${icon('clock')}</i><small>UNASSIGNED</small><strong>${sum.unassigned}</strong><span>data belum lengkap</span></article>
      <article class="is-ob"><i>${icon('ob')}</i><small>PLAN OB</small><strong>${Core.number(sum.ob)}</strong><span>BCM</span></article>
      <article class="is-coal"><i>${icon('coal')}</i><small>PLAN COAL</small><strong>${Core.number(sum.coal)}</strong><span>Ton</span></article>
    </div>`;
  }
  function toolbar() {
    const areas = [...new Set(state.rows.map(row => row.pit_area_snapshot).filter(Boolean))].sort();
    const jobs = [...new Set(state.rows.map(row => row.job_code_snapshot).filter(Boolean))].sort();
    const materials = [...new Set(state.rows.map(row => row.material_snapshot).filter(Boolean))].sort();
    return `<div class="fdp-filter-panel"><div class="fdp-filters">
      <label class="fdp-range-filter"><span>Range Periode</span><div><input type="date" data-filter="from" value="${E(state.filters.from)}" max="${E(state.filters.to)}" aria-label="Tanggal mulai"><i>→</i><input type="date" data-filter="to" value="${E(state.filters.to)}" min="${E(state.filters.from)}" aria-label="Tanggal akhir"></div></label>
      <label><span>PIT / Area</span><select data-filter="area"><option value="">Semua area</option>${areas.map(area => `<option ${state.filters.area === area ? 'selected' : ''}>${E(area)}</option>`).join('')}</select></label>
      <label><span>JOB</span><select data-filter="job"><option value="">Semua JOB</option>${jobs.map(job => `<option ${state.filters.job === job ? 'selected' : ''}>${E(job)}</option>`).join('')}</select></label>
      <label><span>Material</span><select data-filter="material"><option value="">Semua material</option>${materials.map(material => `<option ${state.filters.material === material ? 'selected' : ''}>${E(material)}</option>`).join('')}</select></label>
      <label><span>Status</span><select data-filter="status"><option value="">Semua status</option>${Object.entries(Core.STATUS_LABEL).map(([value, label]) => `<option value="${value}" ${state.filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      <div class="fdp-view-tabs">${[['list',`${icon('list')} List View`],['timeline','▥ Timeline'],['calendar','▦ Calendar'],['summary','▥ Production Summary'],['mapping','▦ Unit Mapping']].map(([value,label]) => `<button data-view="${value}" class="${state.view === value ? 'is-active' : ''}">${label}</button>`).join('')}</div></div>`;
  }
  function legacyNotice() { const count=state.rows.filter(row=>row.source==='legacy').length;return count?`<div class="fdp-legacy"><strong>${count} setup Fleet Capacity lama tetap aktif.</strong><span>Ditampilkan read-only dan tetap menjadi sumber kompatibilitas. Gunakan wizard untuk membuat skema baru yang tervalidasi.</span></div>`:''; }
  function rowActions(row) {
    if (row.status === 'draft') return `<button data-edit="${row.id}">Edit</button><button data-transition="${row.id}" data-status="validated">Validasi</button><button data-transition="${row.id}" data-status="published" class="is-publish">Publish</button><button data-transition="${row.id}" data-status="cancelled">Batalkan</button>`;
    if (row.status === 'validated') return `<button data-edit="${row.id}">Edit</button><button data-transition="${row.id}" data-status="published" class="is-publish">Publish</button><button data-transition="${row.id}" data-status="cancelled">Batalkan</button>`;
    if (row.status === 'published') return `<button data-transition="${row.id}" data-status="closed">Tutup</button><button data-transition="${row.id}" data-status="cancelled">Batalkan</button>`;
    return '<span class="fdp-muted">Arsip</span>';
  }
  function listView(rows) {
    if (!rows.length) return emptyState();
    return `<div class="fdp-table-wrap"><table class="fdp-table"><thead><tr><th>Fleet</th><th>Periode</th><th>PIT / Area</th><th>JOB</th><th>Material</th><th>Productivity</th><th>Produksi</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(row => { const min=Number(row.min_target_productivity||0);const max=Number(row.max_target_productivity||0);const target=max>0?(Math.abs(max-min)<.001?Core.number(max,2):`${Core.number(min,2)}–${Core.number(max,2)}`):'—';return `<tr><td><div class="fdp-fleet-name"><span>${icon('excavator')}</span><div><strong>${E(row.loader_codes || row.name.replace(/^Legacy · /,''))}</strong><small>${row.source==='legacy'?'Setup lama':E(row.name)} · ${row.fleet_count} fleet</small></div></div></td>
        <td><strong>${E(Core.formatPeriod(row.date_start,row.date_end))}</strong><small>${row.day_count} hari terplot</small></td>
        <td><span class="fdp-cell-icon">${icon('pin')}</span>${E(row.pit_area_snapshot)}</td>
        <td><span class="fdp-cell-icon">${icon('job')}</span>${E(row.job_code_snapshot)}</td>
        <td><span class="fdp-material is-${E(row.planning_type)}">${E(row.material_snapshot)}</span></td>
        <td><strong>${target}</strong><small>${row.productivity_unit === 'Ton/Hr' ? 'Ton/Jam' : 'BCM/Jam'}</small></td>
        <td><strong>${row.planned_production === null || row.planned_production === undefined ? '—' : Core.number(row.planned_production)}</strong><small>${row.productivity_unit === 'Ton/Hr' ? 'Ton' : 'BCM'}</small></td>
        <td>${statusBadge(row.status)}${Number(row.warning_count) ? `<small class="fdp-alert">${row.warning_count} alert</small>` : ''}</td>
        <td><div class="fdp-row-actions">${rowActions(row)}</div></td></tr>`;}).join('')}</tbody></table></div>`;
  }
  function timelineView(rows) {
    if (!rows.length) return emptyState();
    const min = rows.reduce((value, row) => row.date_start < value ? row.date_start : value, rows[0].date_start);
    const max = rows.reduce((value, row) => row.date_end > value ? row.date_end : value, rows[0].date_end);
    const span = Math.max(1, Core.daysInclusive(min, max));
    return `<div class="fdp-panel"><div class="fdp-panel-title"><strong>Timeline Deployment</strong><span>${E(min)} — ${E(max)}</span></div><div class="fdp-timeline">
      ${rows.map(row => { const left = ((Core.daysInclusive(min, row.date_start) - 1) / span) * 100; const width = (Core.daysInclusive(row.date_start, row.date_end) / span) * 100;
        return `<div class="fdp-timeline-row"><div><strong>${E(row.name)}</strong><small>${E(row.pit_area_snapshot)} · ${E(row.job_code_snapshot)}</small></div><div class="fdp-track"><span class="is-${E(row.planning_type)}" style="left:${left}%;width:${Math.max(2,width)}%">${row.fleet_count} fleet</span></div></div>`; }).join('')}</div></div>`;
  }
  function calendarView(rows) {
    if (!rows.length) return emptyState();
    const dates = [...new Set(rows.flatMap(row => { const out=[]; for(let d=row.date_start; d<=row.date_end; d=Core.addDays(d,1)) out.push(d); return out; }))].sort().slice(0, 42);
    return `<div class="fdp-panel"><div class="fdp-panel-title"><strong>Kalender Operasi</strong><span>Maks. 6 minggu pada tampilan</span></div><div class="fdp-calendar">${dates.map(date => { const active=rows.filter(row=>date>=row.date_start&&date<=row.date_end&&!['cancelled'].includes(row.status)); return `<article><small>${E(date.slice(5))}</small><strong>${active.length}</strong><span>skema</span>${active.slice(0,2).map(row=>`<i class="is-${row.planning_type}">${E(row.job_code_snapshot)}</i>`).join('')}</article>`; }).join('')}</div></div>`;
  }
  function summaryView(rows) {
    const groups = new Map(); rows.forEach(row => { const key=`${row.pit_area_snapshot}|${row.job_code_snapshot}|${row.material_snapshot}|${row.productivity_unit}`; const current=groups.get(key)||{...row,count:0,total:0}; current.count+=1;current.total+=Number(row.planned_production||0);groups.set(key,current); });
    return `<div class="fdp-summary-grid">${[...groups.values()].map(group=>`<article><div><span>${E(group.pit_area_snapshot)}</span>${statusBadge(group.status)}</div><h3>${E(group.job_code_snapshot)} · ${E(group.material_snapshot)}</h3><strong>${Core.number(group.total)}</strong><small>${group.productivity_unit==='Ton/Hr'?'Ton':'BCM'} · ${group.count} skema</small></article>`).join('') || emptyState()}</div>`;
  }
  function emptyState() { return `<div class="fdp-empty"><span>◫</span><h3>Belum ada skema deployment</h3><p>Buat skema pertama untuk memplot fleet berdasarkan periode dan konteks operasi.</p><button class="fdp-primary" data-action="new">Buat Skema Fleet</button></div>`; }
  function render() {
    if (!root()) return;
    const rows = Core.filterRows(state.rows, state.filters);
    const content = state.view === 'mapping' ? '' : state.view === 'timeline' ? timelineView(rows) : state.view === 'calendar' ? calendarView(rows) : state.view === 'summary' ? summaryView(rows) : listView(rows);
    root().innerHTML = `${pageHeader()}${kpis(rows)}${legacyNotice()}${toolbar()}${content}${state.wizard ? wizard() : ''}`;
    const mapping = document.getElementById('fleetUnitMappingView');
    if (mapping) mapping.hidden = state.view !== 'mapping';
  }

  function freshWizard() { const dates=Core.defaultDates(); return { step:1,id:null,revision:null,name:'',dateStart:dates.start,dateEnd:dates.end,pitArea:'',jobCode:'',material:'',planningType:'',assignments:[],excludedDates:[] }; }
  function catalogForContext() { return Core.catalogForContext(state.options?.catalog || [], state.wizard); }
  function candidatesForContext() { return Core.fleetCandidates(state.options?.excavators || [], state.options?.catalog || [], state.wizard); }
  function wizardSteps() { return ['Periode','Konteks','Fleet','Validasi','Preview'].map((label,index)=>`<div class="${state.wizard.step===index+1?'is-active':state.wizard.step>index+1?'is-done':''}"><span>${state.wizard.step>index+1?'✓':index+1}</span><b>${label}</b></div>`).join(''); }
  function wizardBody() {
    const w=state.wizard;
    if(w.step===1) return `<div class="fdp-form"><label class="is-wide">Nama skema<input data-w="name" value="${E(w.name)}" placeholder="Contoh: Fleet OB BEI Minggu 39"></label><label>Tanggal mulai<input type="date" data-w="dateStart" value="${w.dateStart}"></label><label>Tanggal akhir<input type="date" data-w="dateEnd" value="${w.dateEnd}"></label><div class="fdp-callout is-wide"><strong>Basis perencanaan harian</strong><span>PA/EWH dan Loader Productivity akan disnapshot untuk menjaga histori target.</span></div></div>`;
    if(w.step===2){ const jobs=(state.options?.jobs||[]).map(job=>({jobCode:job.jobCode||job.job_code,jobDescription:job.jobDescription||job.job_desc})).filter(job=>job.jobCode); const mats=[...new Map((state.options?.catalog||[]).filter(p=>!w.jobCode||String(p.jobCode||'').toUpperCase()===w.jobCode.toUpperCase()).map(p=>[`${p.planningType}|${p.material}`,p])).values()]; return `<div class="fdp-form"><label>PIT / Area<select data-w="pitArea"><option value="">Pilih area</option>${(state.options?.pits||[]).map(p=>`<option value="${E(p.code)}" ${w.pitArea===p.code?'selected':''}>${E(p.code)} · ${E(p.name)}</option>`).join('')}</select></label><label>JOB dari SPO<select data-w="jobCode"><option value="">Pilih JOB</option>${jobs.map(p=>`<option value="${E(p.jobCode)}" ${w.jobCode===p.jobCode?'selected':''}>${E(p.jobCode)} · ${E(p.jobDescription||'')}</option>`).join('')}</select></label><label class="is-wide">Material<select data-w="material"><option value="">Pilih material</option>${mats.map(p=>`<option value="${E(p.material)}" data-type="${p.planningType}" ${w.material===p.material&&w.planningType===p.planningType?'selected':''}>${E(p.material)} · ${p.planningType.toUpperCase()} · ${E(p.productivityUnit)}</option>`).join('')}</select></label><div class="fdp-callout is-wide"><strong>Konteks mengikat rencana</strong><span>Semua Excavator aktif dapat dipilih. Target diambil dari Loader Productivity efektif per hari; target yang belum tersedia akan ditandai saat validasi.</span></div></div>`; }
    if(w.step===3){ const candidates=candidatesForContext(); return `<div class="fdp-fleet-picker"><div class="fdp-picker-head"><strong>Pilih Excavator · Loader Productivity</strong><span>${w.assignments.length} dipilih</span></div>${candidates.length?candidates.map(item=>`<label class="fdp-fleet-card ${w.assignments.includes(item.selectionRef)?'is-selected':''} ${item.complete?'':'is-incomplete'}"><input type="checkbox" data-plan="${E(item.selectionRef)}" ${w.assignments.includes(item.selectionRef)?'checked':''}><span>🚜</span><div><strong>${E(item.loaderCode)}</strong><small>${E(item.equipmentType||item.equipmentClass||'Excavator')}</small></div>${item.complete?`<b>${Core.number(item.plan.fleetProductivity,2)}<small>${E(item.plan.productivityUnit)} · Loader</small></b>`:'<b class="fdp-plan-missing">Belum tersedia<small>Loader Productivity</small></b>'}</label>`).join(''):`<div class="fdp-warning">Tidak ada Excavator aktif pada List Equipment.</div>`}</div>`; }
    if(w.step===4) return state.preview?validationContent():`<div class="fdp-validation-wait"><span class="fdp-spinner"></span><h3>Menjalankan validasi</h3><p>Memeriksa konflik periode, sumber plan, PA/EWH, dan satuan.</p></div>`;
    return previewContent();
  }
  function validationContent(){const p=state.preview;return `<div class="fdp-validation"><div class="fdp-validation-score ${p.canPublish?'is-ok':'is-bad'}"><strong>${p.canPublish?'✓ Siap dipublikasi':'! Perlu tindakan'}</strong><span>${p.rowCount} baris harian · ${p.completeRows} lengkap</span></div>${p.warnings.length?`<ul>${p.warnings.map(x=>`<li>${E(x)}</li>`).join('')}</ul>`:'<p class="fdp-ok">Tidak ditemukan konflik atau data yang belum lengkap.</p>'}</div>`;}
  function previewContent(){const p=state.preview||{};const w=state.wizard;return `<div class="fdp-preview"><div><small>SKEMA</small><strong>${E(w.name||`${w.pitArea} ${w.jobCode}`)}</strong></div><div><small>PERIODE</small><strong>${E(w.dateStart)} — ${E(w.dateEnd)}</strong></div><div><small>KONTEKS</small><strong>${E(w.pitArea)} · ${E(w.jobCode)} · ${E(w.material)}</strong></div><div><small>FLEET / HARI</small><strong>${w.assignments.length} / ${p.dayCount||0}</strong></div>${Object.entries(p.totals||{}).map(([unit,total])=>`<div class="is-total"><small>PLAN ${E(unit)}</small><strong>${Core.number(total)}</strong></div>`).join('')}</div>`;}
  function wizard(){const w=state.wizard;const nextDisabled=(w.step===1&&(!w.dateStart||!w.dateEnd))||(w.step===2&&(!w.pitArea||!w.jobCode||!w.material))||(w.step===3&&!w.assignments.length)||(w.step===4&&!state.preview);return `<div class="fdp-overlay"><aside class="fdp-drawer"><header><div><span>FLEET DEPLOYMENT WIZARD</span><h2>${w.id?'Edit Skema':'Buat Skema Fleet'}</h2></div><button data-action="close" aria-label="Tutup">×</button></header><div class="fdp-steps">${wizardSteps()}</div><main>${wizardBody()}</main><footer><button data-action="back" ${w.step===1?'disabled':''}>← Kembali</button><div>${w.step===5?`<button data-action="save-draft">Simpan Draft</button><button class="fdp-primary" data-action="publish" ${state.preview?.canPublish?'':'disabled'}>Publish Skema</button>`:`<button class="fdp-primary" data-action="next" ${nextDisabled?'disabled':''}>${w.step===4?'Lihat Preview':'Lanjut'} →</button>`}</div></footer></aside></div>`;}

  function wizardPayload(){const w=state.wizard;return { id:w.id,name:w.name,dateStart:w.dateStart,dateEnd:w.dateEnd,pitArea:w.pitArea,jobCode:w.jobCode,material:w.material,planningType:w.planningType,assignments:w.assignments,excludedDates:w.excludedDates,revision:w.revision };}
  async function loadOptions(){
    const params=new URLSearchParams({from:state.wizard.dateStart,to:state.wizard.dateEnd});
    const options=await request(`/fleet-deployments/options?${params}`);
    if(!Array.isArray(options.excavators)||!options.excavators.length){
      const master=await request('/master');
      options.excavators=(master.equipment||[]).filter(unit=>String(unit.kelas_alat||'').trim().toLowerCase()==='excavator'
        && unit.deleted_at==null&&unit.is_active!==false);
      options.excavatorSource='master-fallback';
    }
    state.options=options;
  }
  async function runPreview(){state.preview=null;render();state.preview=await request('/fleet-deployments/preview',{method:'POST',body:JSON.stringify(wizardPayload())});render();}
  async function save(publish, button){const execute=async()=>{const w=state.wizard;const path=w.id?`/fleet-deployments/${w.id}`:'/fleet-deployments';const result=await request(path,{method:w.id?'PUT':'POST',body:JSON.stringify({...wizardPayload(),publish})});if(publish&&w.id&&result.status==='draft')await request(`/fleet-deployments/${w.id}/status`,{method:'POST',body:JSON.stringify({status:'published'})});state.wizard=null;state.preview=null;setDirty(false);await loadRows();};if(global.OMOSActionFeedback?.run)return global.OMOSActionFeedback.run(button,execute,{loadingText:publish?'Mempublikasi…':'Menyimpan…'});return execute();}
  async function transition(id,status,button){if(!confirm(`${status==='closed'?'Tutup':'Ubah status'} skema ini?`))return;let reason='';if(['closed','cancelled'].includes(status)){reason=prompt('Tuliskan alasan perubahan status untuk audit:')||'';if(!reason.trim())return;}const run=async()=>{await request(`/fleet-deployments/${id}/status`,{method:'POST',body:JSON.stringify({status,reason})});await loadRows();};if(global.OMOSActionFeedback?.run)return global.OMOSActionFeedback.run(button,run,{loadingText:'Memproses…'});return run();}
  async function edit(id){const detail=await request(`/fleet-deployments/${id}`);state.wizard={step:1,id:detail.id,revision:detail.revision,name:detail.name,dateStart:String(detail.date_start).slice(0,10),dateEnd:String(detail.date_end).slice(0,10),pitArea:detail.pit_area_snapshot,jobCode:detail.job_code_snapshot,material:detail.material_snapshot,planningType:detail.planning_type,assignments:(detail.assignments||[]).map(a=>`equipment:${a.equipmentId}`),excludedDates:[]};await loadOptions();setDirty(false);render();}
  async function loadRows(){state.loading=true;render();try{const params=new URLSearchParams();if(state.filters.from)params.set('from',state.filters.from);if(state.filters.to)params.set('to',state.filters.to);const query=params.toString();const result=await request(`/fleet-deployments${query?`?${query}`:''}`);state.rows=(result.rows||[]).map(row=>({...row,date_start:Core.isoDate(row.date_start)||row.date_start,date_end:Core.isoDate(row.date_end)||row.date_end}));}catch(error){root().innerHTML=`${pageHeader()}<div class="fdp-error"><strong>Fleet Deployment gagal dimuat</strong><span>${E(error.message)}</span><button data-action="retry">Coba lagi</button></div>`;throw error;}finally{state.loading=false;render();}}

  function ensureMappingRange() {
    if (state.filters.from && state.filters.to) return false;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    state.filters.from = state.filters.from || Core.localIso(new Date(year, month, 1));
    state.filters.to = state.filters.to || Core.localIso(new Date(year, month + 1, 0));
    return true;
  }
  async function activateMappingView() {
    if (ensureMappingRange()) await loadRows();
    if (!global.UnitMappingPlanning) throw new Error('Modul Unit Mapping belum tersedia.');
    await global.UnitMappingPlanning.setRange(state.filters.from, state.filters.to);
    await global.UnitMappingPlanning.init();
  }
  async function showView(view) {
    state.view = ['list','timeline','calendar','summary','mapping'].includes(view) ? view : 'list';
    render();
    if (state.view === 'mapping') await activateMappingView();
  }

  function bind(){if(root()?.dataset.bound)return;root().dataset.bound='true';root().addEventListener('input',event=>{if(event.target.dataset.filter){state.filters[event.target.dataset.filter]=event.target.value;if(!['from','to'].includes(event.target.dataset.filter))render();}else if(event.target.dataset.w){state.wizard[event.target.dataset.w]=event.target.value;setDirty(true);}});root().addEventListener('change',async event=>{if(event.target.dataset.filter){state.filters[event.target.dataset.filter]=event.target.value;if(['from','to'].includes(event.target.dataset.filter)){if(state.filters.from&&state.filters.to&&state.filters.from>state.filters.to){alert('Tanggal mulai tidak boleh melewati tanggal akhir.');render();return;}await loadRows();if(state.view==='mapping')await activateMappingView();}else render();return;}if(event.target.dataset.w){const key=event.target.dataset.w;state.wizard[key]=event.target.value;if(['dateStart','dateEnd'].includes(key)){if(state.wizard.dateStart&&state.wizard.dateEnd&&state.wizard.dateStart<=state.wizard.dateEnd){await loadOptions();state.wizard.assignments=[];}}if(key==='jobCode'){state.wizard.material='';state.wizard.planningType='';state.wizard.assignments=[];}if(key==='material'){const option=event.target.selectedOptions[0];state.wizard.planningType=option?.dataset.type||'';state.wizard.assignments=[];}setDirty(true);render();}if(event.target.dataset.plan){const ref=event.target.dataset.plan;state.wizard.assignments=event.target.checked?[...new Set([...state.wizard.assignments,ref])]:state.wizard.assignments.filter(x=>x!==ref);setDirty(true);render();}});root().addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;try{if(button.dataset.view){await showView(button.dataset.view);return;}if(button.dataset.edit)return edit(button.dataset.edit);if(button.dataset.transition)return transition(button.dataset.transition,button.dataset.status,button);const action=button.dataset.action;if(action==='new'){state.wizard=freshWizard();state.preview=null;await loadOptions();render();}else if(action==='retry')await loadRows();else if(action==='close'){if(state.dirty&&!confirm('Perubahan belum disimpan. Tutup wizard?'))return;state.wizard=null;state.preview=null;setDirty(false);render();}else if(action==='back'){state.wizard.step=Math.max(1,state.wizard.step-1);render();}else if(action==='next'){if(state.wizard.step===3){state.wizard.step=4;await runPreview();}else state.wizard.step=Math.min(5,state.wizard.step+1);render();}else if(action==='save-draft')await save(false,button);else if(action==='publish')await save(true,button);}catch(error){console.error(error);alert(error.message);}});}
  async function init(){if(!root())return;bind();if(state.initialized)return loadRows();state.initialized=true;root().innerHTML=`${pageHeader()}<div class="fdp-loading"><span class="fdp-spinner"></span>Memuat deployment planner…</div>`;await loadRows();}
  global.FleetCapacityPlanning={init,refresh:loadRows,showView};
})(typeof window!=='undefined'?window:globalThis);
