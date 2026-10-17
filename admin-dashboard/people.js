'use strict';

/*
 * OMOS People v2 — halaman Karyawan (Direktori, Pergerakan, MPP, Pengingat, Setup master).
 * Acuan tampilan: assets/sample page/omos_karyawan_layout.html
 * Semua aturan bisnis ada di backend (/api/admin/karyawan/people/...); browser
 * hanya menampilkan dan mengirim isian. Setiap aksi simpan memakai OMOSActionFeedback.
 */
(function peopleModule(global) {
  const API = '/api/admin/karyawan/people';
  const WF = '/api/admin/karyawan/workforce';
  const MAX_PDF = 5 * 1024 * 1024;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  const STATUS = { ACTIVE: ['Aktif', 'success'], PROBATION: ['Probation', 'accent'], NOTICE: ['Notice', 'warning'], INACTIVE: ['Keluar', 'muted'] };
  const MOV_ST = { DRAFT: ['Draft', 'muted'], SUBMITTED: ['Menunggu persetujuan', 'warning'], APPROVED: ['Terjadwal', 'accent'],
    EFFECTIVE: ['Efektif', 'success'], CANCELLED: ['Dibatalkan', 'muted'], REJECTED: ['Ditolak', 'danger'] };
  const TYPE_LABEL = { HIRE: 'Masuk', REHIRE: 'Rehire', TRANSFER: 'Mutasi', PROMOTION: 'Promosi', DEMOTION: 'Demosi',
    RESIGN: 'Resign', TERMINATION: 'Terminasi', CONTRACT_END: 'Kontrak habis', RETIREMENT: 'Pensiun',
    CONFIRMATION: 'Lulus probation', CONTRACT_RENEWAL: 'Perpanjangan kontrak', EMPLOYMENT_TYPE_CHANGE: 'Ubah status kerja' };
  const TYPE_GROUPS = [
    ['STATUS', 'Status kerja', ['CONFIRMATION', 'CONTRACT_RENEWAL', 'EMPLOYMENT_TYPE_CHANGE']],
    ['PENEMPATAN', 'Penempatan', ['TRANSFER', 'PROMOTION', 'DEMOTION']],
    ['KELUAR', 'Keluar', ['RESIGN', 'TERMINATION', 'CONTRACT_END', 'RETIREMENT']],
    ['MASUK', 'Masuk kembali', ['REHIRE']],
  ];
  const GROUP_LABEL = { MASUK: 'Masuk', STATUS: 'Status kerja', PENEMPATAN: 'Penempatan', KELUAR: 'Keluar', LAINNYA: 'Lainnya' };
  const EXIT = ['RESIGN', 'TERMINATION', 'CONTRACT_END', 'RETIREMENT'];
  const REASON_HINT = { PENEMPATAN: 'mis. kebutuhan pengawas Pit 1 selama OB removal', KELUAR: 'mis. pindah domisili ikut keluarga',
    STATUS: 'mis. evaluasi kinerja memenuhi target', MASUK: 'mis. kebutuhan operator berpengalaman' };
  const MARITAL = { SINGLE: 'Lajang', MARRIED: 'Menikah', DIVORCED: 'Cerai hidup', WIDOWED: 'Cerai mati' };
  const REL = { SPOUSE: 'Suami/istri', CHILD: 'Anak', PARENT: 'Orang tua/mertua', SIBLING: 'Saudara kandung', OTHER: 'Lainnya' };
  const DOC_TYPES = { CV: 'CV', COMPETENCY: 'Sertifikat kompetensi', KTP: 'KTP', CONTRACT: 'Kontrak kerja', MCU: 'Hasil MCU', OTHER: 'Lainnya' };
  const FUNCTION_TAGS = { '': '— Tidak ditandai —', OPERATOR: 'Operator', SUPERVISOR: 'Pengawas', MECHANIC: 'Mekanik', DRIVER: 'Driver', STAFF: 'Staf', OTHER: 'Lainnya' };
  const TYPE_KERJA = { PKWT: 'PKWT', PKWTT: 'PKWTT', HARIAN: 'Harian' };
  const AUDIT_LABEL = { nik: 'NIK', phone: 'No. HP', birth_date: 'Tanggal lahir', birth_place: 'Tempat lahir', address: 'Alamat', gender: 'Jenis kelamin',
    blood_type: 'Golongan darah', emergency_contact_name: 'Kontak darurat', emergency_contact_relation: 'Hubungan kontak darurat',
    emergency_contact_phone: 'HP kontak darurat', email: 'Email login', nama: 'Nama', lokasi_absen: 'Lokasi absen', void: 'Void', create: 'Dibuat',
    CV: 'CV', COMPETENCY: 'Sertifikat kompetensi', KTP: 'KTP', CONTRACT: 'Kontrak', MCU: 'MCU', OTHER: 'Dokumen' };

  const S = {
    tab: 'direktori',
    dir: { status: 'ACTIVE_ALL', q: '', depts: [], positions: [] },
    mov: { view: 'approval', group: '' },
    data: { org: null, settings: null, options: null, directory: null, reminders: null, movements: null, everyone: null },
    profile: null,
    started: false,
    qTimer: null,
  };

  // ------------------------------------------------------------------ helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const fmt = d => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
  const fmtTime = t => { if (!t) return '—'; const d = new Date(t); return `${fmt(d.toISOString().slice(0, 10))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
  const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const addMonths = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d, last));
    return t.toISOString().slice(0, 10);
  };
  const tenure = n => { if (n == null) return '—'; const y = Math.floor(n / 365); const m = Math.floor((n % 365) / 30.4); return y ? `${y} th ${m} bln` : (m ? `${m} bln` : `${n} hari`); };
  const initials = n => String(n || '?').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
  const kb = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const idem = () => (global.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const me = () => (typeof state !== 'undefined' && state.user) || {};
  function perms() {
    let p = me().permissions;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (_) { p = []; } }
    return Array.isArray(p) ? p : [];
  }
  const isSuper = () => Boolean(me().is_super_admin);
  const canApprove = () => isSuper() || perms().includes('people.approve');
  const run = (button, task, opts) => (global.OMOSActionFeedback ? global.OMOSActionFeedback.run(button, task, { successText: 'Tersimpan', ...(opts || {}) }) : task());

  function apiCall(path, options) { return api(path, options); }
  function apiSend(path, method, data, headers) {
    return api(path, { method, headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(data || {}) });
  }
  async function fetchBlob(path) {
    const res = await fetch(`${getApiBaseUrl()}${path}`, { headers: state.token ? { Authorization: `Bearer ${state.token}` } : {} });
    if (!res.ok) {
      let msg = `Gagal membuka file (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch (_) { /* bukan JSON */ }
      throw new Error(msg);
    }
    return res.blob();
  }

  function toast(msg, bad) {
    let t = $('#ppToast');
    if (!t) { t = document.createElement('div'); t.id = 'ppToast'; t.className = 'pp-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = `<i class="ti ${bad ? 'ti-alert-circle' : 'ti-check'}"></i><span>${esc(msg)}</span>`;
    t.classList.toggle('bad', Boolean(bad));
    t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), bad ? 4200 : 2600);
  }

  function layer(id) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'pp-layer'; document.body.appendChild(el); }
    return el;
  }
  const L1 = () => layer('ppLayer');
  const L2 = () => layer('ppLayer2');
  function closeL1() { L1().innerHTML = ''; S.profile = null; }
  function closeL2() { const l = L2(); if (l._cleanup) { l._cleanup(); l._cleanup = null; } l.innerHTML = ''; }
  function modal(target, { title, sub = '', body, foot, size = '' }) {
    target.innerHTML = `<div class="pp-overlay ${target.id === 'ppLayer2' ? 'top' : ''}" data-pp-close><div class="pp-modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="pp-m-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="pp-icon-btn" data-pp-close aria-label="Tutup"><i class="ti ti-x"></i></button></div>
      <div class="pp-m-body">${body}</div>${foot ? `<div class="pp-m-foot">${foot}</div>` : ''}</div></div>`;
    const first = target.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return target.querySelector('.pp-modal');
  }
  function showMsg(box, text, ok) { if (!box) return; box.hidden = !text; box.className = `pp-msg${ok ? ' ok' : ''}`; box.textContent = text || ''; }

  // ------------------------------------------------------------------ data
  async function loadBase() {
    const [org, settings, options] = await Promise.all([
      apiCall(`${API}/org`), apiCall(`${API}/settings`), apiCall(`${API}/options`),
    ]);
    S.data.org = org; S.data.settings = settings; S.data.options = options;
  }
  function dirQuery() {
    const p = new URLSearchParams();
    p.set('status', S.dir.status === 'ACTIVE_ALL' ? 'ACTIVE_ALL' : S.dir.status);
    if (S.dir.q) p.set('q', S.dir.q);
    if (S.dir.depts.length) p.set('department_ids', S.dir.depts.join(','));
    if (S.dir.positions.length) p.set('position_ids', S.dir.positions.join(','));
    return p.toString();
  }
  async function loadDirectory() { S.data.directory = await apiCall(`${API}/directory?${dirQuery()}`); }
  async function loadReminders() { S.data.reminders = await apiCall(`${API}/reminders`); }
  async function loadMovements() {
    const p = new URLSearchParams({ view: S.mov.view });
    if (S.mov.group) p.set('group', S.mov.group);
    S.data.movements = await apiCall(`${API}/movements?${p}`);
  }
  async function loadEveryone() { S.data.everyone = (await apiCall(`${API}/directory?status=ALL`)).rows; return S.data.everyone; }

  const departments = (activeOnly = true) => (S.data.org?.departments || []).filter(d => !activeOnly || d.is_active);
  const positionsOf = (deptId, activeOnly = true) => (departments(false).find(d => d.id === deptId)?.positions || []).filter(p => !activeOnly || p.is_active);
  function positionById(id) {
    for (const d of departments(false)) { const p = d.positions.find(x => x.id === id); if (p) return { ...p, department_name: d.name }; }
    return null;
  }

  // ------------------------------------------------------------------ shell
  function shell() {
    const rootEl = document.getElementById('peopleRoot');
    if (!rootEl) return null;
    if (!rootEl.dataset.ready) {
      rootEl.innerHTML = `
        <div class="pp-head">
          <div><h1>Karyawan</h1><p>Data karyawan dari masuk sampai keluar, dengan riwayat yang bisa ditelusuri.</p></div>
          <div class="pp-acts">
            <button type="button" class="pp-btn" data-pp-act="export"><i class="ti ti-download"></i>Ekspor</button>
            <button type="button" class="pp-btn" data-pp-act="import"><i class="ti ti-file-spreadsheet"></i>Import Excel</button>
            <button type="button" class="pp-btn" data-pp-act="move"><i class="ti ti-arrows-exchange"></i>Ajukan pergerakan</button>
            <button type="button" class="pp-btn primary" data-pp-act="add"><i class="ti ti-user-plus"></i>Tambah karyawan</button>
          </div>
        </div>
        <div class="pp-tabs" role="tablist" id="ppTabs"></div>
        <section id="ppPane-direktori"></section>
        <section id="ppPane-pergerakan" hidden></section>
        <section id="ppPane-mpp" hidden><div class="pp-mpp-host" id="ppMppHost"></div></section>
        <section id="ppPane-pengingat" hidden></section>
        <section id="ppPane-setup" hidden></section>`;
      rootEl.dataset.ready = '1';
      const wf = document.getElementById('workforceMovementView');
      if (wf) { $('#ppMppHost').appendChild(wf); wf.hidden = false; }
    }
    return rootEl;
  }

  function renderTabs() {
    const pending = S.data.movements?.counts?.approval || 0;
    const urgent = S.data.reminders?.counts?.urgent || 0;
    const tabs = [['direktori', 'Direktori', ''], ['pergerakan', 'Pergerakan', pending ? `<span class="pp-count warn">${pending}</span>` : ''],
      ['mpp', 'MPP', ''], ['pengingat', 'Pengingat', urgent ? `<span class="pp-count danger">${urgent}</span>` : ''], ['setup', 'Setup master', '']];
    $('#ppTabs').innerHTML = tabs.map(([k, l, b]) => `<button type="button" role="tab" aria-selected="${S.tab === k}" class="pp-tab ${S.tab === k ? 'on' : ''}" data-pp-tab="${k}">${l}${b}</button>`).join('');
  }

  async function showTab(tab) {
    S.tab = tab;
    try { localStorage.setItem('omos_people_tab', tab); } catch (_) { /* opsional */ }
    renderTabs();
    ['direktori', 'pergerakan', 'mpp', 'pengingat', 'setup'].forEach(t => { const p = $(`#ppPane-${t}`); if (p) p.hidden = t !== tab; });
    const pane = $(`#ppPane-${tab}`);
    try {
      if (tab === 'direktori') { if (!S.data.directory) { pane.innerHTML = loading(); await loadDirectory(); } renderDirectory(); }
      if (tab === 'pergerakan') { pane.innerHTML = loading(); await loadMovements(); renderMovements(); renderTabs(); }
      if (tab === 'pengingat') { pane.innerHTML = loading(); await loadReminders(); renderReminders(); renderTabs(); }
      if (tab === 'setup') { renderSetup(); }
      if (tab === 'mpp') { await global.OMOSWorkforce?.showMpp?.(); }
    } catch (error) {
      pane.innerHTML = `<div class="pp-error">${esc(error.message)}</div>`;
    }
  }
  const loading = () => '<div class="pp-card pp-empty"><i class="ti ti-loader-2"></i>Memuat…</div>';

  async function load() {
    const rootEl = shell();
    if (!rootEl) return;
    if (!S.started) {
      S.started = true;
      try { S.tab = localStorage.getItem('omos_people_tab') || 'direktori'; } catch (_) { S.tab = 'direktori'; }
      if (!['direktori', 'pergerakan', 'mpp', 'pengingat', 'setup'].includes(S.tab)) S.tab = 'direktori';
    }
    $(`#ppPane-${S.tab}`).innerHTML = S.tab === 'mpp' ? $(`#ppPane-mpp`).innerHTML : loading();
    try {
      await loadBase();
      const jobs = [loadDirectory(), loadReminders(), loadMovements()];
      await Promise.allSettled(jobs);
    } catch (error) {
      $(`#ppPane-${S.tab}`).innerHTML = `<div class="pp-error">Gagal memuat data karyawan: ${esc(error.message)}</div>`;
      throw error;
    }
    await showTab(S.tab);
  }

  async function refreshAll() {
    await Promise.allSettled([loadBase(), loadDirectory(), loadReminders(), loadMovements()]);
    S.data.everyone = null;
    renderTabs();
    if (S.tab === 'direktori') renderDirectory();
    if (S.tab === 'pergerakan') renderMovements();
    if (S.tab === 'pengingat') renderReminders();
    if (S.tab === 'setup') renderSetup();
    if (typeof muatKaryawan === 'function') muatKaryawan().catch(() => {});
  }

  // ------------------------------------------------------------------ multi-select
  function msRender(el, label, groups, selected, onChange) {
    const open = el.dataset.open === '1';
    const flat = groups.flatMap(g => g.items);
    const draw = () => msRender(el, label, groups, selected, onChange);
    el._redraw = draw;
    el.innerHTML = `<button type="button" aria-expanded="${open}" aria-haspopup="listbox"><span>${esc(label)}</span>${selected.length ? `<span class="n">${selected.length}</span>` : `<span style="color:var(--pp-muted)">${el.dataset.emptyLabel || 'Semua'}</span>`}<i class="ti ti-chevron-down"></i></button>` +
      (open ? `<div class="pp-ms-pop" role="listbox">${groups.map(g => `${g.title ? `<div class="grp">${esc(g.title)}</div>` : ''}${g.items.map(o => `<label><input type="checkbox" value="${esc(o.value)}" ${selected.includes(o.value) ? 'checked' : ''}>${esc(o.label)}${o.count != null ? `<span class="c">${esc(o.count)}</span>` : ''}</label>`).join('')}`).join('') || '<div class="pp-empty" style="padding:10px">Tidak ada pilihan</div>'}
        <div class="pp-ms-foot"><button type="button" class="pp-linkbtn" data-ms="clear">Kosongkan</button><button type="button" class="pp-linkbtn" data-ms="close">Selesai</button></div></div>` : '');
    el.querySelector('button').onclick = ev => {
      ev.stopPropagation();
      $$('.pp-ms').forEach(m => { if (m !== el && m.dataset.open) { m.dataset.open = ''; m._redraw && m._redraw(); } });
      el.dataset.open = open ? '' : '1'; draw();
    };
    $$('input', el).forEach(i => { i.onchange = () => onChange($$('input:checked', el).map(x => x.value).filter(v => flat.some(o => o.value === v))); });
    const clr = el.querySelector('[data-ms=clear]'); if (clr) clr.onclick = ev => { ev.stopPropagation(); onChange([]); };
    const cls = el.querySelector('[data-ms=close]'); if (cls) cls.onclick = ev => { ev.stopPropagation(); el.dataset.open = ''; draw(); };
    const pop = el.querySelector('.pp-ms-pop'); if (pop) pop.onclick = ev => ev.stopPropagation();
  }
  document.addEventListener('click', () => { $$('.pp-ms').forEach(m => { if (m.dataset.open) { m.dataset.open = ''; m._redraw && m._redraw(); } }); });

  // ------------------------------------------------------------------ DIREKTORI
  function keyDateText(r) {
    const k = r.key_date || {};
    const type = TYPE_KERJA[r.employment_type] || r.employment_type || '';
    if (k.kind === 'LAST_DAY') return `Hari terakhir ${fmt(k.date)}`;
    if (k.kind === 'EXITED') return k.date ? `Keluar · hari terakhir ${fmt(k.date)}` : 'Keluar';
    if (k.kind === 'PROBATION') return `Probation s/d ${fmt(k.date)}`;
    if (k.kind === 'CONTRACT') return `${type} s/d ${fmt(k.date)}`;
    return `${type || '—'} · tetap`;
  }
  function daysChip(days) {
    if (days == null) return '';
    if (days < 0) return `<span class="pp-chip danger">lewat ${Math.abs(days)} hari</span>`;
    return `<span class="pp-chip ${days <= 14 ? 'danger' : days <= 30 ? 'warning' : 'muted'}">${days} hari</span>`;
  }
  function docCell(r) {
    const cv = r.has_cv ? `<button type="button" class="pp-dchip has" data-pp-view="${esc(r.cv_id)}" title="Lihat CV"><i class="ti ti-file-type-pdf"></i>CV</button>`
      : `<button type="button" class="pp-dchip miss" data-pp-upload="CV" data-pp-emp="${esc(r.id)}" title="Unggah CV (PDF)"><i class="ti ti-upload"></i>CV</button>`;
    const comp = r.competency_count
      ? (r.competency_count > 1 ? `<button type="button" class="pp-dchip has" data-pp-open-docs="${esc(r.id)}" title="Lihat daftar kompetensi"><i class="ti ti-certificate"></i>Kompetensi ${r.competency_count}</button>`
        : `<button type="button" class="pp-dchip has" data-pp-view="${esc(r.competency_latest_id)}" title="Lihat sertifikat"><i class="ti ti-certificate"></i>Kompetensi 1</button>`)
      : `<button type="button" class="pp-dchip" data-pp-upload="COMPETENCY" data-pp-emp="${esc(r.id)}" title="Unggah sertifikat kompetensi (PDF)"><i class="ti ti-upload"></i>Kompetensi</button>`;
    return `<span class="pp-dcell">${cv}${comp}</span>`;
  }
  function renderDirectory() {
    const pane = $('#ppPane-direktori');
    const d = S.data.directory;
    if (!d) { pane.innerHTML = loading(); return; }
    const s = d.summary;
    const kpis = [
      ['Karyawan aktif', s.active, 'termasuk probation & notice', '', 'ACTIVE_ALL'],
      ['Probation', s.probation, 'perlu keputusan lulus', '', 'PROBATION'],
      ['Notice', s.notice, 'sudah resign, masih bekerja', 'warn', 'NOTICE'],
      ['Kontrak/probation ≤ 30 hari', s.ending_soon, 'perlu tindakan', s.ending_soon ? 'danger' : '', 'ENDING_SOON'],
      ['Data belum lengkap', s.incomplete, 'tanpa wajah / CV / < 80%', s.incomplete ? 'warn' : '', 'INCOMPLETE'],
    ];
    const chips = [['ACTIVE_ALL', 'Semua aktif', s.active], ['ACTIVE', 'Aktif', s.active - s.probation - s.notice], ['PROBATION', 'Probation', s.probation],
      ['NOTICE', 'Notice', s.notice], ['INACTIVE', 'Keluar (alumni)', s.exited], ['ALL', 'Semua', s.total]];
    const extra = { INCOMPLETE: 'Data belum lengkap', ENDING_SOON: 'Kontrak/probation ≤ 30 hari' }[S.dir.status];
    const rows = d.rows || [];
    pane.innerHTML = `<div class="pp-kpis">${kpis.map(([l, v, sub, c, k]) => `<button type="button" class="pp-card pp-kpi ${c}" data-pp-dstatus="${k}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></button>`).join('')}</div>
      <div class="pp-card">
        <div class="pp-toolbar">
          <div class="pp-search"><i class="ti ti-search"></i><input type="text" id="ppQ" value="${esc(S.dir.q)}" placeholder="Cari nama, NRP, jabatan, email…" aria-label="Cari karyawan"></div>
          <div class="pp-ms" id="ppMsDept"></div>
          <div class="pp-ms" id="ppMsPos"></div>
        </div>
        <div class="pp-toolbar" style="padding-top:8px">
          <div class="pp-fchips">${chips.map(([k, l, n]) => `<button type="button" class="pp-fchip ${S.dir.status === k ? 'on' : ''}" data-pp-dstatus="${k}">${l} <b>${n}</b></button>`).join('')}
            ${extra ? `<button type="button" class="pp-fchip on" data-pp-dstatus="ACTIVE_ALL">${extra} <b>✕</b></button>` : ''}</div>
          <span class="grow"></span><span class="pp-hint" style="margin:0">${rows.length} karyawan</span>
        </div>
        <div class="pp-tbl-wrap"><table class="pp-tbl" style="min-width:980px">
          <thead><tr><th>Karyawan</th><th>Jabatan · Departemen</th><th>Status</th><th>Masa kerja</th><th>Kontrak / tanggal penting</th><th>Wajah</th><th>CV &amp; kompetensi</th><th>Kelengkapan</th></tr></thead>
          <tbody>${rows.length ? rows.map(r => {
            const [sl, sc] = STATUS[r.status] || [r.status, 'muted'];
            const pct = r.completeness?.percent ?? 0;
            const bar = pct >= 90 ? '' : pct >= 75 ? 'warn' : 'low';
            return `<tr class="click" tabindex="0" data-pp-emp="${esc(r.id)}">
              <td><div class="pp-person"><span class="pp-avatar s-${esc(r.status)}">${esc(initials(r.nama))}</span><div><span class="n">${esc(r.nama)}</span><span class="sub">${esc(r.nrp || 'Tanpa NRP')}</span></div></div></td>
              <td>${esc(r.jabatan || '—')}<span class="sub">${esc(r.departemen || '—')}${r.site ? ` · ${esc(r.site)}` : ''}</span></td>
              <td><span class="pp-chip ${sc}">${sl}</span></td>
              <td>${r.status === 'INACTIVE' ? '—' : tenure(r.tenure_days)}<span class="sub">sejak ${fmt(r.hire_date)}</span></td>
              <td>${esc(keyDateText(r))}${r.status !== 'INACTIVE' && r.key_date?.days != null ? `<span class="sub" style="margin-top:2px">${daysChip(r.key_date.days)}</span>` : ''}</td>
              <td>${r.has_face ? '<span class="pp-face-ok"><i class="ti ti-face-id"></i> Ada</span>' : '<span class="pp-face-no"><i class="ti ti-face-id-error"></i> Belum</span>'}</td>
              <td>${docCell(r)}</td>
              <td title="${esc((r.completeness?.missing || []).length ? `Belum ada: ${r.completeness.missing.join(', ')}` : 'Lengkap')}"><span class="pp-bar ${bar}"><i style="width:${pct}%"></i></span>${pct}%</td></tr>`;
          }).join('') : `<tr><td colspan="8"><div class="pp-empty"><i class="ti ti-users"></i>${S.dir.q || S.dir.depts.length || S.dir.positions.length ? 'Tidak ada karyawan yang cocok dengan filter.' : 'Belum ada karyawan. Tambahkan lewat tombol Tambah karyawan atau Import Excel.'}</div></td></tr>`}</tbody>
        </table></div>
        <div class="pp-tfoot"><span>Klik baris untuk membuka profil · klik CV/kompetensi untuk melihat PDF.</span><span>Jabatan &amp; departemen hanya berubah lewat Pergerakan</span></div>
      </div>`;
    drawDirFilters();
    const q = $('#ppQ');
    q.oninput = () => {
      clearTimeout(S.qTimer);
      S.qTimer = setTimeout(async () => {
        S.dir.q = q.value.trim();
        await reloadDirectory(true);
      }, 300);
    };
  }
  async function reloadDirectory(keepFocus) {
    const pos = keepFocus ? ($('#ppQ')?.selectionStart ?? null) : null;
    try { await loadDirectory(); } catch (error) { toast(error.message, true); return; }
    renderDirectory();
    if (keepFocus) { const q = $('#ppQ'); if (q) { q.focus(); if (pos != null) q.setSelectionRange(pos, pos); } }
  }
  function drawDirFilters() {
    const deptEl = $('#ppMsDept'); const posEl = $('#ppMsPos');
    if (!deptEl || !posEl) return;
    const depts = departments(false);
    msRender(deptEl, 'Departemen', [{ items: depts.map(d => ({ value: d.id, label: d.name + (d.is_active ? '' : ' (nonaktif)'), count: d.active_employees })) }], S.dir.depts, async v => {
      S.dir.depts = v;
      const allowed = new Set(depts.filter(d => !v.length || v.includes(d.id)).flatMap(d => d.positions.map(p => p.id)));
      S.dir.positions = S.dir.positions.filter(p => allowed.has(p));
      deptEl.dataset.open = '1';
      await reloadDirectory(false);
      const n = $('#ppMsDept'); if (n) { n.dataset.open = '1'; n._redraw && n._redraw(); }
    });
    const pool = depts.filter(d => !S.dir.depts.length || S.dir.depts.includes(d.id));
    msRender(posEl, 'Jabatan', pool.map(d => ({ title: d.name, items: d.positions.map(p => ({ value: p.id, label: p.name + (p.is_active ? '' : ' (nonaktif)'), count: p.active_employees })) })), S.dir.positions, async v => {
      S.dir.positions = v;
      await reloadDirectory(false);
      const n = $('#ppMsPos'); if (n) { n.dataset.open = '1'; n._redraw && n._redraw(); }
    });
  }

  function exportCsv() {
    const rows = S.data.directory?.rows || [];
    const head = ['NRP', 'Nama', 'Email', 'Departemen', 'Jabatan', 'Site', 'Status', 'Tipe kerja', 'Tanggal masuk', 'Tanggal penting', 'Wajah', 'CV', 'Kompetensi', 'Kelengkapan %'];
    const lines = [head].concat(rows.map(r => [r.nrp, r.nama, r.email, r.departemen, r.jabatan, r.site, (STATUS[r.status] || [r.status])[0],
      TYPE_KERJA[r.employment_type] || r.employment_type, r.hire_date, keyDateText(r), r.has_face ? 'Ada' : 'Belum', r.has_cv ? 'Ada' : 'Belum',
      r.competency_count, r.completeness?.percent]));
    const csv = lines.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `karyawan-${todayIso()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------------ PROFIL
  async function openProfile(userId, sub = 'ringkasan') {
    S.profile = { id: userId, sub, data: S.profile?.id === userId ? S.profile.data : null, nik: null };
    if (!S.profile.data) {
      L1().innerHTML = `<div class="pp-drawer-wrap" data-pp-close><aside class="pp-drawer" role="dialog" aria-modal="true" aria-label="Profil karyawan"><div class="pp-d-body">${loading()}</div></aside></div>`;
      try { S.profile.data = await apiCall(`${API}/employees/${encodeURIComponent(userId)}`); } catch (error) {
        L1().innerHTML = `<div class="pp-drawer-wrap" data-pp-close><aside class="pp-drawer" role="dialog"><div class="pp-d-head"><h2>Profil</h2><button class="pp-icon-btn" data-pp-close aria-label="Tutup"><i class="ti ti-x"></i></button></div><div class="pp-d-body"><div class="pp-error">${esc(error.message)}</div></div></aside></div>`;
        return;
      }
    }
    renderProfile();
  }
  async function reloadProfile() {
    if (!S.profile) return;
    try { S.profile.data = await apiCall(`${API}/employees/${encodeURIComponent(S.profile.id)}`); } catch (error) { toast(error.message, true); }
    renderProfile();
  }
  function pdfRow(doc) {
    const exp = doc.expiry_date ? daysBetween(todayIso(), doc.expiry_date) : null;
    const chip = exp == null ? '' : exp < 0 ? '<span class="pp-chip danger">Kedaluwarsa</span>' : exp <= 60 ? `<span class="pp-chip warning">${exp} hari lagi</span>` : '';
    return `<button type="button" class="pp-pdf-row click" data-pp-view="${esc(doc.id)}"><span class="ic">PDF</span><span>${esc(doc.doc_type === 'CV' ? 'Curriculum vitae' : doc.title)} ${chip}<span class="sub">${esc(doc.original_filename)} · ${kb(doc.size_bytes)} · diunggah ${fmt(String(doc.uploaded_at || '').slice(0, 10))}${doc.doc_number ? ` · No. ${esc(doc.doc_number)}` : ''}${doc.expiry_date ? ` · berlaku s/d ${fmt(doc.expiry_date)}` : ''}</span></span><span class="go">Lihat <i class="ti ti-eye"></i></span></button>`;
  }
  function renderProfile() {
    const P = S.profile; if (!P || !P.data) return;
    const { employee: e, personal: ps, family: fam } = P.data;
    const [sl, sc] = STATUS[e.employment_status] || STATUS[e.status] || ['—', 'muted'];
    const docs = P.data.documents || [];
    const cv = docs.find(d => d.doc_type === 'CV');
    const comps = docs.filter(d => d.doc_type === 'COMPETENCY');
    const others = docs.filter(d => !['CV', 'COMPETENCY'].includes(d.doc_type));
    const subs = [['ringkasan', 'Ringkasan'], ['pribadi', 'Data pribadi'], ['keluarga', `Keluarga${fam?.marital_status ? '' : ' <span class="pp-count warn">!</span>'}`],
      ['kepegawaian', 'Kepegawaian'], ['dokumen', `Dokumen <span class="pp-count">${docs.length}</span>`], ['audit', 'Audit']];
    const sub = P.sub;
    let body = '';
    if (sub === 'ringkasan') {
      const missing = e.completeness?.missing || [];
      const att = P.data.attendance_month || {};
      body = `<div class="pp-sum">
          <div><div class="l">Status</div><div class="v">${sl}</div></div>
          <div><div class="l">Masa kerja</div><div class="v">${e.employment_status === 'INACTIVE' ? 'Keluar' : tenure(e.tenure_days)}</div></div>
          <div><div class="l">Hubungan kerja</div><div class="v">${esc(keyDateText(e))}</div></div>
          <div><div class="l">Atasan langsung</div><div class="v">${esc(e.supervisor_name || '—')}</div></div>
        </div>
        ${missing.length ? `<div class="pp-preview warn"><i class="ti ti-alert-triangle"></i><div><b>Kelengkapan ${e.completeness.percent}%</b> — belum ada: ${esc(missing.join(', '))}.</div></div>` : '<div class="pp-preview"><i class="ti ti-circle-check"></i><div>Data lengkap.</div></div>'}
        <div><div class="pp-sec-title">CV &amp; kompetensi <button type="button" class="pp-linkbtn" data-pp-sub="dokumen">Semua dokumen</button></div><div class="pp-list">
          ${cv ? pdfRow(cv) : `<div class="pp-upl"><span>Belum ada CV<span class="sub">PDF, maks. 5 MB</span></span><button type="button" class="pp-btn sm" data-pp-upload="CV" data-pp-emp="${esc(e.id)}"><i class="ti ti-upload"></i>Unggah CV</button></div>`}
          ${comps.slice(0, 2).map(pdfRow).join('')}
        </div></div>
        <div><div class="pp-sec-title">Terhubung ke modul lain</div><div class="pp-links">
          <div><div class="l"><i class="ti ti-chart-bar"></i>Absensi bulan ini</div><div class="v">${e.employment_status === 'INACTIVE' ? '—' : `${att.present || 0} hadir · ${att.late || 0} telat`}</div></div>
          <div><div class="l"><i class="ti ti-map-pin"></i>Lokasi absen</div><div class="v">${P.data.location_mode === 'ALL' ? 'Semua lokasi' : esc(P.data.locations.map(l => l.nama_lokasi).join(', '))}</div></div>
          <div><div class="l"><i class="ti ti-users"></i>Tanggungan</div><div class="v">${fam?.summary ? `${fam.summary.dependent_count} orang · PTKP ${esc(fam.summary.ptkp_estimate || '—')}` : 'Belum diisi'}</div></div>
          <div><div class="l"><i class="ti ti-id-badge-2"></i>Email login</div><div class="v" style="overflow-wrap:anywhere">${esc(e.email)}</div></div>
        </div></div>`;
    } else if (sub === 'pribadi') {
      const val = (v, warn) => (v ? esc(v) : warn ? '<span class="pp-chip warning">Belum diisi</span>' : '—');
      const darurat = [ps.emergency_contact_name, ps.emergency_contact_relation, ps.emergency_contact_phone].filter(Boolean).join(' · ');
      body = `<div><div class="pp-sec-title">Identitas <button type="button" class="pp-btn sm" data-pp-edit-personal><i class="ti ti-pencil"></i>Edit</button></div>
        <div class="pp-dl">
          <div class="k">Nama lengkap</div><div>${esc(e.nama)}</div>
          <div class="k">NIK KTP</div><div>${ps.has_nik ? `<span id="ppNikVal">${esc(P.nik || ps.nik_masked)}</span> ${P.nik ? '' : '<button type="button" class="pp-linkbtn" data-pp-reveal-nik>Tampilkan</button>'}` : '<span class="pp-chip warning">Belum diisi</span>'}</div>
          <div class="k">Tempat, tanggal lahir</div><div>${esc([ps.birth_place, ps.birth_date ? fmt(ps.birth_date) : null].filter(Boolean).join(', ')) || '<span class="pp-chip warning">Belum diisi</span>'}</div>
          <div class="k">Jenis kelamin</div><div>${ps.gender === 'M' ? 'Laki-laki' : ps.gender === 'F' ? 'Perempuan' : '—'}</div>
          <div class="k">No. HP</div><div>${val(ps.phone, true)}</div>
          <div class="k">Email login</div><div>${esc(e.email)} <span class="pp-lock"><i class="ti ti-lock"></i> ubah butuh alasan</span></div>
          <div class="k">Alamat</div><div>${val(ps.address, true)}</div>
          <div class="k">Golongan darah</div><div>${val(ps.blood_type, true)}</div>
          <div class="k">Kontak darurat</div><div>${val(darurat, true)}</div>
        </div></div>
        <div class="pp-privacy"><i class="ti ti-lock"></i>NIK disamarkan. Menampilkan NIK lengkap tercatat di Audit.</div>`;
    } else if (sub === 'keluarga') {
      const st = fam?.summary;
      body = !fam?.marital_status && !(fam?.members || []).length
        ? `<div class="pp-upl"><span>Data keluarga belum diisi<span class="sub">Opsional. Dipakai untuk tanggungan BPJS, PTKP payroll, dan kontak darurat.</span></span><button type="button" class="pp-btn sm primary" data-pp-fam-edit><i class="ti ti-plus"></i>Isi sekarang</button></div>`
        : `<div><div class="pp-sec-title">Ringkasan <button type="button" class="pp-btn sm" data-pp-fam-edit><i class="ti ti-pencil"></i>Edit</button></div>
          <div class="pp-sum"><div><div class="l">Status pernikahan</div><div class="v">${esc(MARITAL[fam.marital_status] || 'Belum diisi')}</div></div><div><div class="l">Jumlah tanggungan</div><div class="v">${st ? `${st.dependent_count} orang` : '—'}</div></div>
          <div><div class="l">Jumlah anak</div><div class="v">${st ? st.child_count : '—'}</div></div><div><div class="l">Perkiraan PTKP</div><div class="v">${esc(st?.ptkp_estimate || '—')}</div></div></div></div>
          <div><div class="pp-sec-title">Anggota keluarga</div>${fam.members.length ? `<table class="pp-fam-tbl"><thead><tr><th>Nama</th><th>Hubungan</th><th>Tanggal lahir</th><th>Tanggungan</th></tr></thead><tbody>${fam.members.map(m => `<tr><td>${esc(m.full_name)}</td><td>${esc(REL[m.relationship] || m.relationship)}</td><td>${fmt(m.birth_date)}</td><td>${m.is_dependent ? '<span class="pp-chip success">Ya</span>' : '<span class="pp-chip muted">Tidak</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="pp-hint" style="margin:0">Belum ada anggota keluarga yang dicatat.</div>'}
          <div class="pp-hint">PTKP dihitung dari status pernikahan + anak &amp; orang tua/mertua yang ditanggung (maks. 3). Perkiraan — keputusan akhir di Payroll.</div></div>`;
      body += '<div class="pp-privacy"><i class="ti ti-lock"></i>Data keluarga hanya untuk HR dan Payroll. Perubahan tercatat di Audit.</div>';
    } else if (sub === 'kepegawaian') {
      const active = e.employment_status !== 'INACTIVE';
      body = `<div><div class="pp-sec-title">Penempatan saat ini</div><div class="pp-dl">
          <div class="k">NRP</div><div>${esc(e.nrp || '—')} <span class="pp-lock"><i class="ti ti-lock"></i> tetap</span></div>
          <div class="k">Departemen · jabatan</div><div>${esc(e.departemen || '—')} · ${esc(e.jabatan || '—')} <span class="pp-lock"><i class="ti ti-lock"></i> via Pergerakan</span></div>
          <div class="k">Site</div><div>${esc(e.site || '—')}</div>
          <div class="k">Lokasi absen</div><div>${P.data.location_mode === 'ALL' ? '<span class="pp-chip">Semua lokasi</span>' : `<span class="pp-lok-chips">${P.data.locations.map(l => `<span class="pp-chip accent"><i class="ti ti-map-pin"></i>${esc(l.nama_lokasi)}${l.is_primary ? ' · utama' : ''}</span>`).join('')}</span>`} ${active ? '<button type="button" class="pp-linkbtn" data-pp-edit-loc>Ubah</button>' : ''}</div>
          <div class="k">Tipe kerja</div><div>${esc(TYPE_KERJA[e.employment_type] || e.employment_type || '—')}${e.contract_end_date ? ` · s/d ${fmt(e.contract_end_date)}` : ''}${e.contract_no ? `<span class="sub">No. ${esc(e.contract_no)}</span>` : ''}</div>
          <div class="k">Tanggal masuk</div><div>${fmt(e.hire_date)}</div>
          <div class="k">Probation</div><div>${e.employment_status === 'PROBATION' && e.probation_end_date ? `s/d ${fmt(e.probation_end_date)}` : 'Lulus / tidak berlaku'}</div>
          ${e.last_working_day ? `<div class="k">Hari kerja terakhir</div><div>${fmt(e.last_working_day)}</div>` : ''}
        </div></div>
        <div><div class="pp-sec-title">Riwayat</div>${historyHtml(P.data.history)}</div>
        ${active ? `<div class="pp-upl"><span>Salah input sebelum ada transaksi?<span class="sub">Void menonaktifkan akun dan membebaskan email. Bila sudah ada absensi/payroll, gunakan Proses keluar.</span></span><button type="button" class="pp-btn sm danger" data-pp-void><i class="ti ti-ban"></i>Void</button></div>` : ''}`;
    } else if (sub === 'dokumen') {
      body = `<div><div class="pp-sec-title">Curriculum vitae ${cv ? `<button type="button" class="pp-btn sm" data-pp-upload="CV" data-pp-emp="${esc(e.id)}"><i class="ti ti-replace"></i>Ganti</button>` : ''}</div>
          ${cv ? pdfRow(cv) : `<div class="pp-upl"><span>Belum ada CV<span class="sub">PDF, maks. 5 MB</span></span><button type="button" class="pp-btn sm primary" data-pp-upload="CV" data-pp-emp="${esc(e.id)}"><i class="ti ti-upload"></i>Unggah CV</button></div>`}</div>
        <div><div class="pp-sec-title">Kompetensi &amp; sertifikat <button type="button" class="pp-btn sm" data-pp-upload="COMPETENCY" data-pp-emp="${esc(e.id)}"><i class="ti ti-upload"></i>Unggah PDF</button></div>
          <div class="pp-list">${comps.length ? comps.map(pdfRow).join('') : '<div class="pp-upl"><span>Belum ada sertifikat kompetensi<span class="sub">Bisa lebih dari satu file PDF</span></span></div>'}</div>
          <div class="pp-hint">Sertifikat dengan masa berlaku muncul di tab Pengingat.</div></div>
        <div><div class="pp-sec-title">Dokumen kepegawaian <button type="button" class="pp-btn sm" data-pp-upload="CONTRACT" data-pp-emp="${esc(e.id)}"><i class="ti ti-upload"></i>Unggah PDF</button></div>
          <div class="pp-list">${others.length ? others.map(pdfRow).join('') : '<div class="pp-hint" style="margin:0">Belum ada (KTP, kontrak, MCU, lainnya).</div>'}</div></div>`;
    } else {
      const audit = P.data.audit || [];
      body = audit.length ? `<div class="pp-tl">${audit.map(a => {
        const label = AUDIT_LABEL[a.field] || a.field;
        const change = a.old_value || a.new_value ? `${esc(a.old_value || '—')} → ${esc(a.new_value || '—')}` : '';
        return `<div class="pp-tl-item"><span class="pp-tl-dot"></span><div><div class="t">${esc(a.entity === 'DOCUMENT' ? `Dokumen ${label}` : label)}${a.field === 'nik' && !change ? ' ditampilkan' : ''}</div><div class="d">${esc(a.actor_name || 'Sistem')} · ${fmtTime(a.created_at)}</div>${change ? `<div class="c">${change}</div>` : ''}${a.reason ? `<div class="d">Alasan: ${esc(a.reason)}</div>` : ''}</div></div>`;
      }).join('')}</div><div class="pp-hint">Audit per kolom: nilai lama, nilai baru, pengubah, alasan (50 terakhir).</div>` : '<div class="pp-empty">Belum ada perubahan tercatat.</div>';
    }
    const st = e.employment_status;
    const acts = st === 'INACTIVE'
      ? `<button type="button" class="pp-btn sm" data-pp-move="REHIRE" data-pp-emp="${esc(e.id)}"><i class="ti ti-user-check"></i>Proses rehire</button>`
      : `<button type="button" class="pp-btn sm" data-pp-move="TRANSFER" data-pp-emp="${esc(e.id)}"><i class="ti ti-arrows-exchange"></i>Mutasi / promosi</button>
         ${st === 'PROBATION' ? `<button type="button" class="pp-btn sm" data-pp-move="CONFIRMATION" data-pp-emp="${esc(e.id)}"><i class="ti ti-rosette"></i>Lulus probation</button>` : ''}
         ${e.contract_end_date && st !== 'NOTICE' ? `<button type="button" class="pp-btn sm" data-pp-move="CONTRACT_RENEWAL" data-pp-emp="${esc(e.id)}"><i class="ti ti-file-plus"></i>Perpanjang kontrak</button>` : ''}
         ${st !== 'NOTICE' ? `<button type="button" class="pp-btn sm danger" data-pp-move="RESIGN" data-pp-emp="${esc(e.id)}"><i class="ti ti-door-exit"></i>Proses keluar</button>` : ''}`;
    L1().innerHTML = `<div class="pp-drawer-wrap" data-pp-close><aside class="pp-drawer" role="dialog" aria-modal="true" aria-label="Profil ${esc(e.nama)}">
      <div class="pp-d-head"><div class="who"><span class="pp-avatar lg s-${esc(st)}">${esc(initials(e.nama))}</span><div><h2>${esc(e.nama)}</h2><div class="meta">${esc(e.nrp || '—')} · ${esc(e.jabatan || '—')} · ${esc(e.departemen || '—')} <span class="pp-chip ${sc}">${sl}</span></div></div></div><button type="button" class="pp-icon-btn" data-pp-close aria-label="Tutup"><i class="ti ti-x"></i></button></div>
      <div class="pp-d-acts">${acts}<span style="flex:1"></span><button type="button" class="pp-btn sm" data-pp-face><i class="ti ti-face-id"></i>${e.has_face ? 'Tambah sampel wajah' : 'Foto wajah'}</button></div>
      <div class="pp-d-body"><div class="pp-seg" role="tablist">${subs.map(([k, l]) => `<button type="button" role="tab" class="${sub === k ? 'on' : ''}" data-pp-sub="${k}">${l}</button>`).join('')}</div>${body}</div>
    </aside></div>`;
  }
  function historyHtml(history) {
    if (!history || !history.length) return '<div class="pp-hint" style="margin:0">Belum ada riwayat.</div>';
    return `<div class="pp-tl">${history.map(m => {
      const b = m.before_state || {}; const a = m.after_state || {};
      const [ml, mc] = MOV_ST[m.status] || [m.status, 'muted'];
      const exit = EXIT.includes(m.movement_type);
      let change = '';
      if (m.movement_type === 'HIRE' || m.movement_type === 'REHIRE') change = `${esc(a.department || '—')} · ${esc(a.position || '—')} · ${esc(TYPE_KERJA[a.employment_type] || a.employment_type || '')}`;
      else if (exit) change = `Hari kerja terakhir ${fmt(m.last_working_day)}`;
      else if (m.movement_type === 'CONTRACT_RENEWAL' || m.movement_type === 'EMPLOYMENT_TYPE_CHANGE') change = `${esc(TYPE_KERJA[b.employment_type] || b.employment_type || '—')} → ${esc(TYPE_KERJA[a.employment_type] || a.employment_type || '—')}`;
      else if (m.movement_type === 'CONFIRMATION') change = 'Probation → Aktif';
      else change = `${esc(b.department || '—')} · ${esc(b.position || '—')} → ${esc(a.department || '—')} · ${esc(a.position || '—')}`;
      return `<div class="pp-tl-item"><span class="pp-tl-dot ${exit ? 'exit' : m.status === 'EFFECTIVE' ? '' : 'wait'}"></span><div><div class="t">${esc(TYPE_LABEL[m.movement_type] || m.movement_type)} <span class="pp-chip ${mc}">${ml}</span></div><div class="d">${esc(m.movement_no)} · efektif ${fmt(m.effective_date)}</div><div class="c">${change}</div>${m.reason_text ? `<div class="d">Alasan: ${esc(m.reason_text)}</div>` : ''}</div></div>`;
    }).join('')}</div>`;
  }

  async function revealNik() {
    try {
      const nik = await apiSend(`${API}/employees/${encodeURIComponent(S.profile.id)}/reveal-nik`, 'POST', {});
      S.profile.nik = nik || '—';
      renderProfile();
    } catch (error) { toast(error.message, true); }
  }

  function openPersonalEdit() {
    const { employee: e, personal: ps } = S.profile.data;
    const box = modal(L2(), {
      title: `Data pribadi · ${esc(e.nama)}`, sub: 'Perubahan tercatat per kolom di Audit. Ubah NIK atau email wajib disertai alasan.', size: 'wide',
      body: `<div class="pp-row2"><div class="pp-fld"><label class="lb">Nama lengkap <em>*</em></label><input type="text" name="nama" value="${esc(e.nama)}" required></div>
          <div class="pp-fld"><label class="lb">Email login <em>*</em></label><input type="email" name="email" value="${esc(e.email)}" required></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">NIK KTP</label><input type="text" name="nik" inputmode="numeric" maxlength="20" placeholder="${ps.has_nik ? 'Kosongkan bila tidak diubah' : '16 digit'}"><div class="pp-hint">${ps.has_nik ? `Tersimpan: ${esc(ps.nik_masked)}` : 'Belum diisi'}</div></div>
          <div class="pp-fld"><label class="lb">No. HP</label><input type="text" name="phone" value="${esc(ps.phone || '')}" placeholder="08xx"></div></div>
        <div class="pp-row3"><div class="pp-fld"><label class="lb">Tempat lahir</label><input type="text" name="birth_place" value="${esc(ps.birth_place || '')}"></div>
          <div class="pp-fld"><label class="lb">Tanggal lahir</label><input type="date" name="birth_date" value="${esc(ps.birth_date || '')}"></div>
          <div class="pp-fld"><label class="lb">Jenis kelamin</label><select name="gender"><option value="">—</option><option value="M" ${ps.gender === 'M' ? 'selected' : ''}>Laki-laki</option><option value="F" ${ps.gender === 'F' ? 'selected' : ''}>Perempuan</option></select></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Golongan darah</label><select name="blood_type"><option value="">—</option>${['A', 'B', 'AB', 'O'].map(b => `<option ${ps.blood_type === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
          <div class="pp-fld"><label class="lb">Alamat</label><input type="text" name="address" value="${esc(ps.address || '')}"></div></div>
        <div class="pp-row3"><div class="pp-fld"><label class="lb">Kontak darurat</label><input type="text" name="emergency_contact_name" value="${esc(ps.emergency_contact_name || '')}" placeholder="Nama"></div>
          <div class="pp-fld"><label class="lb">Hubungan</label><input type="text" name="emergency_contact_relation" value="${esc(ps.emergency_contact_relation || '')}" placeholder="mis. istri"></div>
          <div class="pp-fld"><label class="lb">No. HP darurat</label><input type="text" name="emergency_contact_phone" value="${esc(ps.emergency_contact_phone || '')}"></div></div>
        <div class="pp-fld"><label class="lb">Alasan perubahan</label><input type="text" name="reason" placeholder="Wajib bila NIK atau email diubah"></div>
        <div id="ppPersonalMsg" hidden></div>`,
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppPersonalSave">Simpan</button>',
    });
    $('#ppPersonalSave').onclick = () => {
      const val = n => box.querySelector(`[name=${n}]`).value.trim();
      const payload = { nama: val('nama'), email: val('email'), reason: val('reason') };
      ['phone', 'birth_place', 'birth_date', 'gender', 'blood_type', 'address', 'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone']
        .forEach(k => { payload[k] = val(k) || null; });
      if (val('nik')) payload.nik = val('nik');
      run($('#ppPersonalSave'), async () => {
        S.profile.data = await apiSend(`${API}/employees/${encodeURIComponent(S.profile.id)}/personal`, 'PATCH', payload);
        closeL2(); renderProfile(); toast('Data pribadi disimpan'); reloadDirectory(false);
      }).catch(err => showMsg($('#ppPersonalMsg'), err.message));
    };
  }

  function openLocationEdit() {
    const P = S.profile.data;
    const lok = S.data.options?.lokasi || [];
    let mode = P.location_mode;
    let selected = P.locations.map(l => l.id);
    const draw = () => {
      const msBox = $('#ppLocMs');
      if (!msBox) return;
      msBox.hidden = mode === 'ALL';
      msRender($('#ppLocPick'), 'Pilih lokasi', [{ items: lok.map(l => ({ value: l.id, label: l.nama_lokasi, count: `radius ${l.radius_meter} m` })) }], selected, v => {
        selected = v; draw(); const n = $('#ppLocPick'); if (n) { n.dataset.open = '1'; n._redraw && n._redraw(); }
      });
      $('#ppLocChips').innerHTML = selected.map((id, i) => `<span class="pp-chip accent"><i class="ti ti-map-pin"></i>${esc(lok.find(l => l.id === id)?.nama_lokasi || '?')}${i === 0 ? ' · utama' : ''}</span>`).join('');
    };
    modal(L2(), {
      title: 'Lokasi absen', sub: 'Karyawan bisa absen di lokasi mana pun yang dicentang. Lokasi pertama = lokasi utama.',
      body: `<div class="pp-radios"><label><input type="radio" name="ppLocMode" value="ASSIGNED" ${mode !== 'ALL' ? 'checked' : ''}><span>Lokasi tertentu</span></label><label><input type="radio" name="ppLocMode" value="ALL" ${mode === 'ALL' ? 'checked' : ''}><span>Semua lokasi</span></label></div>
        <div id="ppLocMs"><div class="pp-ms full" id="ppLocPick"></div><div class="pp-lok-chips" id="ppLocChips" style="margin-top:6px"></div></div>
        <div class="pp-fld"><label class="lb">Alasan</label><input type="text" id="ppLocReason" placeholder="mis. ditugaskan juga di Pit 1"></div><div id="ppLocMsg" hidden></div>`,
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppLocSave">Simpan</button>',
    });
    $$('input[name=ppLocMode]').forEach(r => { r.onchange = () => { mode = r.value; draw(); }; });
    draw();
    $('#ppLocSave').onclick = () => {
      if (mode !== 'ALL' && !selected.length) { showMsg($('#ppLocMsg'), 'Pilih minimal satu lokasi absen.'); return; }
      run($('#ppLocSave'), async () => {
        await apiSend(`${API}/employees/${encodeURIComponent(S.profile.id)}/locations`, 'PUT', { mode, lokasi_ids: selected, reason: $('#ppLocReason').value.trim() || null });
        closeL2(); await reloadProfile(); toast('Lokasi absen disimpan');
      }).catch(err => showMsg($('#ppLocMsg'), err.message));
    };
  }

  // ------------------------------------------------------------------ keluarga (editor dipakai wizard & profil)
  function famStats(f) {
    if (!f || !f.marital) return null;
    const deps = f.members.filter(m => m.dep && m.name.trim());
    const ptkp = Math.min(3, deps.filter(m => m.rel === 'CHILD' || m.rel === 'PARENT').length);
    return { total: deps.length, ptkp: `${f.marital === 'MARRIED' ? 'K' : 'TK'}/${ptkp}` };
  }
  function famEditorHtml(f) {
    const st = famStats(f);
    return `<div class="pp-fam-head"><b>Data keluarga <span class="opt">opsional · boleh diisi belakangan</span></b><button type="button" class="pp-btn sm" data-fam-add><i class="ti ti-plus"></i>Anggota keluarga</button></div>
      <div class="pp-row2"><div class="pp-fld"><label class="lb">Status pernikahan</label><select data-fam-marital><option value="">— Belum diisi —</option>${Object.entries(MARITAL).map(([k, v]) => `<option value="${k}" ${f.marital === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="pp-fld"><label class="lb">Ringkasan</label><div class="pp-fam-sum">${st ? `<span>Tanggungan <b>${st.total}</b> orang</span><span>Perkiraan PTKP <b>${st.ptkp}</b></span>` : '<span style="color:var(--pp-muted)">Isi status pernikahan dulu</span>'}</div></div></div>
      <div class="pp-fam-rows">${f.members.length ? '<div class="pp-fam-row h"><span>Nama</span><span>Hubungan</span><span>Tanggal lahir</span><span>Tanggungan</span><span></span></div>' : ''}
        ${f.members.map((m, i) => `<div class="pp-fam-row" data-fam-i="${i}"><input type="text" data-fam-f="name" value="${esc(m.name)}" placeholder="Nama lengkap" aria-label="Nama anggota keluarga"><select data-fam-f="rel" aria-label="Hubungan">${Object.entries(REL).map(([k, v]) => `<option value="${k}" ${m.rel === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input type="date" data-fam-f="birth" value="${esc(m.birth || '')}" aria-label="Tanggal lahir"><label class="dep"><input type="checkbox" data-fam-f="dep" ${m.dep ? 'checked' : ''}>Ditanggung</label><button type="button" class="pp-icon-btn" data-fam-del="${i}" aria-label="Hapus anggota"><i class="ti ti-trash"></i></button></div>`).join('') || '<div class="pp-hint" style="margin:0">Belum ada anggota keluarga. Bisa dilewati dan dilengkapi dari profil karyawan.</div>'}
      </div>
      <div class="pp-hint" style="margin:0">Tanggungan dihitung dari anggota yang dicentang. PTKP hanya menghitung anak &amp; orang tua/mertua yang ditanggung (maks. 3) — perkiraan.</div>`;
  }
  function bindFam(box, f) {
    const draw = () => { box.innerHTML = famEditorHtml(f); };
    box.addEventListener('click', ev => {
      const add = ev.target.closest('[data-fam-add]'); const del = ev.target.closest('[data-fam-del]');
      if (add) { f.members.push({ id: null, name: '', rel: f.members.some(m => m.rel === 'SPOUSE') ? 'CHILD' : 'SPOUSE', birth: '', dep: true }); draw(); const ins = $$('[data-fam-f=name]', box); ins[ins.length - 1]?.focus(); }
      if (del) { f.members.splice(Number(del.dataset.famDel), 1); draw(); }
    });
    box.addEventListener('input', ev => {
      const t = ev.target; const row = t.closest('[data-fam-i]');
      if (row && t.dataset.famF === 'name') f.members[Number(row.dataset.famI)].name = t.value;
    });
    box.addEventListener('change', ev => {
      const t = ev.target;
      if (t.matches('[data-fam-marital]')) { f.marital = t.value; draw(); return; }
      const row = t.closest('[data-fam-i]'); if (!row) return;
      const m = f.members[Number(row.dataset.famI)]; const k = t.dataset.famF;
      m[k] = k === 'dep' ? t.checked : t.value;
      if (k === 'dep' || k === 'rel') draw();
    });
    draw();
  }
  const famPayload = f => ({
    marital_status: f.marital || null,
    family_members: f.members.filter(m => m.name.trim()).map(m => ({ id: m.id || undefined, full_name: m.name.trim(), relationship: m.rel, birth_date: m.birth || null, is_dependent: Boolean(m.dep) })),
  });
  function openFamilyEdit() {
    const fam = S.profile.data.family || { marital_status: null, members: [] };
    const draft = { marital: fam.marital_status || '', members: (fam.members || []).map(m => ({ id: m.id, name: m.full_name, rel: m.relationship, birth: m.birth_date || '', dep: m.is_dependent })) };
    modal(L2(), {
      title: `Data keluarga · ${esc(S.profile.data.employee.nama)}`, sub: 'Boleh disimpan sebagian dan dilengkapi nanti.', size: 'wide',
      body: '<div class="pp-fam-box" id="ppFamEdit"></div><div class="pp-fld"><label class="lb">Alasan perubahan</label><input type="text" id="ppFamReason" placeholder="mis. kelahiran anak kedua"></div><div id="ppFamMsg" hidden></div>',
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppFamSave">Simpan</button>',
    });
    bindFam($('#ppFamEdit'), draft);
    $('#ppFamSave').onclick = () => {
      const p = famPayload(draft);
      run($('#ppFamSave'), async () => {
        await apiSend(`${API}/employees/${encodeURIComponent(S.profile.id)}/family`, 'PUT', { marital_status: p.marital_status, members: p.family_members, reason: $('#ppFamReason').value.trim() || null });
        closeL2(); await reloadProfile(); const st = famStats(draft);
        toast(st ? `Data keluarga disimpan · tanggungan ${st.total} · PTKP ${st.ptkp}` : 'Data keluarga disimpan');
      }).catch(err => showMsg($('#ppFamMsg'), err.message));
    };
  }

  function openVoid() {
    const e = S.profile.data.employee;
    modal(L2(), {
      title: `Void · ${esc(e.nama)}`, sub: 'Untuk salah input sebelum ada transaksi. Akun dinonaktifkan, email dibebaskan, data tetap tersimpan untuk audit.',
      body: `<div class="pp-preview danger"><i class="ti ti-alert-triangle"></i><div>Void ditolak bila karyawan sudah punya absensi, keterangan presensi, HM, atau payroll — gunakan <b>Proses keluar</b>.</div></div>
        <div class="pp-fld"><label class="lb">Alasan Void <em>*</em></label><input type="text" id="ppVoidReason" placeholder="mis. email salah, sudah diinput ulang"></div><div id="ppVoidMsg" hidden></div>`,
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppVoidSave" style="background:var(--pp-danger-fill);border-color:var(--pp-danger-fill)">Void karyawan</button>',
    });
    $('#ppVoidSave').onclick = () => {
      const reason = $('#ppVoidReason').value.trim();
      if (reason.length < 5) { showMsg($('#ppVoidMsg'), 'Alasan minimal 5 karakter.'); return; }
      run($('#ppVoidSave'), async () => {
        await apiSend(`${API}/employees/${encodeURIComponent(e.id)}/void`, 'POST', { reason });
        closeL2(); closeL1(); toast(`${e.nama} di-Void`); await refreshAll();
      }).catch(err => showMsg($('#ppVoidMsg'), err.message));
    };
  }

  function openFaceUpload() {
    const e = S.profile.data.employee;
    modal(L2(), {
      title: `Foto wajah · ${esc(e.nama)}`, sub: 'Didaftarkan ke CompreFace. Bisa diunggah beberapa kali untuk menambah sampel wajah yang sama.',
      body: `<div class="pp-fld"><label class="lb">Foto wajah (JPEG/PNG, jelas, pencahayaan cukup)</label><input type="file" id="ppFaceFile" accept="image/jpeg,image/png"></div>
        <label class="pp-check" id="ppFaceDupWrap" hidden><input type="checkbox" id="ppFaceDup"><span>Saya sudah memeriksa — ini orang yang berbeda<span class="d">Centang hanya bila yakin bukan akun ganda.</span></span></label>
        <div id="ppFaceMsg" hidden></div>`,
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppFaceSave">Unggah &amp; daftarkan</button>',
    });
    $('#ppFaceSave').onclick = () => {
      const file = $('#ppFaceFile').files[0];
      if (!file) { showMsg($('#ppFaceMsg'), 'Pilih foto dulu.'); return; }
      const fd = new FormData(); fd.append('foto', file);
      const dup = $('#ppFaceDup').checked;
      run($('#ppFaceSave'), async () => {
        await uploadFace(e.id, file, dup);
        closeL2(); await reloadProfile(); reloadDirectory(false); toast('Foto wajah didaftarkan');
      }).catch(err => {
        if (/mirip/i.test(err.message)) $('#ppFaceDupWrap').hidden = false;
        showMsg($('#ppFaceMsg'), err.message);
      });
    };
  }
  function uploadFace(userId, file, allowDuplicate) {
    const fd = new FormData(); fd.append('foto', file);
    return apiCall(`/api/admin/karyawan/${encodeURIComponent(userId)}/foto-referensi${allowDuplicate ? '?allow_duplicate=true' : ''}`, { method: 'POST', body: fd });
  }

  // ------------------------------------------------------------------ dokumen PDF
  function checkPdf(file) {
    if (!file) return 'Pilih file PDF.';
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return 'Hanya file PDF yang bisa diunggah.';
    if (file.size > MAX_PDF) return 'Ukuran PDF maksimal 5 MB.';
    return null;
  }
  function openUpload(userId, docType) {
    const isCv = docType === 'CV';
    modal(L2(), {
      title: isCv ? 'Unggah CV' : 'Unggah dokumen', sub: 'Hanya PDF, maksimal 5 MB. File dibuka langsung di OMOS, tidak publik.',
      body: `<div class="pp-row2"><div class="pp-fld"><label class="lb">Jenis dokumen</label><select id="ppDocType">${Object.entries(DOC_TYPES).map(([k, v]) => `<option value="${k}" ${k === docType ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="pp-fld"><label class="lb">Nama dokumen <em id="ppDocTitleReq">*</em></label><input type="text" id="ppDocTitle" placeholder="mis. SIO Dump Truck HD785"></div></div>
        <div class="pp-row3" id="ppDocMeta"><div class="pp-fld"><label class="lb">Nomor</label><input type="text" id="ppDocNo"></div>
          <div class="pp-fld"><label class="lb">Tanggal terbit</label><input type="date" id="ppDocIssued"></div>
          <div class="pp-fld"><label class="lb">Berlaku sampai</label><input type="date" id="ppDocExpiry"><div class="pp-hint">Kosong = tanpa masa berlaku</div></div></div>
        <div class="pp-fld"><label class="lb">File PDF <em>*</em></label><input type="file" id="ppDocFile" accept="application/pdf,.pdf"></div>
        <div class="pp-hint" id="ppDocCvHint" style="margin:0">${isCv ? 'Mengganti CV: CV lama dinonaktifkan dan tetap tercatat di audit.' : ''}</div>
        <div id="ppDocMsg" hidden></div>`,
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppDocSave">Unggah</button>',
    });
    const sync = () => {
      const t = $('#ppDocType').value;
      $('#ppDocTitleReq').hidden = t === 'CV';
      $('#ppDocMeta').hidden = t === 'CV';
      $('#ppDocCvHint').textContent = t === 'CV' ? 'Mengganti CV: CV lama dinonaktifkan dan tetap tercatat di audit.' : '';
    };
    $('#ppDocType').onchange = sync; sync();
    $('#ppDocFile').onchange = () => {
      const f = $('#ppDocFile').files[0];
      if (f && !$('#ppDocTitle').value) $('#ppDocTitle').value = f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
    };
    $('#ppDocSave').onclick = () => {
      const file = $('#ppDocFile').files[0];
      const bad = checkPdf(file); if (bad) { showMsg($('#ppDocMsg'), bad); return; }
      const type = $('#ppDocType').value;
      const fd = new FormData();
      fd.append('doc_type', type);
      fd.append('title', $('#ppDocTitle').value.trim());
      if (type !== 'CV') {
        fd.append('doc_number', $('#ppDocNo').value.trim());
        fd.append('issued_date', $('#ppDocIssued').value);
        fd.append('expiry_date', $('#ppDocExpiry').value);
      }
      fd.append('file', file, file.name);
      run($('#ppDocSave'), async () => {
        await apiCall(`${API}/employees/${encodeURIComponent(userId)}/documents`, { method: 'POST', body: fd });
        closeL2(); toast(type === 'CV' ? 'CV diunggah' : 'Dokumen diunggah');
        if (S.profile && S.profile.id === userId) await reloadProfile();
        reloadDirectory(false);
      }, { loadingText: 'Mengunggah…' }).catch(err => showMsg($('#ppDocMsg'), err.message));
    };
  }

  async function openViewer(docId) {
    const target = L2();
    closeL2();
    const doc = (S.profile?.data?.documents || []).find(d => d.id === docId);
    modal(target, { title: '<i class="ti ti-file-type-pdf" style="color:var(--pp-danger)"></i> Dokumen', size: 'viewer', body: loading() });
    let url = null;
    try {
      const blob = await fetchBlob(`${API}/documents/${encodeURIComponent(docId)}/file`);
      url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    } catch (error) {
      modal(target, { title: 'Dokumen', body: `<div class="pp-error">${esc(error.message)}</div>`, foot: '<button type="button" class="pp-btn primary" data-pp-close>Tutup</button>' });
      return;
    }
    const title = doc ? (doc.doc_type === 'CV' ? 'Curriculum vitae' : doc.title) : 'Dokumen PDF';
    const sub = doc ? `${esc(doc.original_filename)} · ${kb(doc.size_bytes)} · diunggah ${fmt(String(doc.uploaded_at).slice(0, 10))}` : 'Dibuka dari penyimpanan privat OMOS';
    modal(target, {
      title: `<i class="ti ti-file-type-pdf" style="color:var(--pp-danger)"></i> ${esc(title)}`, sub, size: 'viewer',
      body: `<iframe class="pp-viewer-frame" src="${url}" title="${esc(title)}"></iframe>`,
      foot: `<span class="pp-sod"><i class="ti ti-lock"></i>Akses tercatat di log dokumen</span>
        <a class="pp-btn" href="${url}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i>Buka tab baru</a>
        <a class="pp-btn" href="${url}" download="${esc(doc?.original_filename || 'dokumen.pdf')}"><i class="ti ti-download"></i>Unduh</a>
        ${doc ? `<button type="button" class="pp-btn danger" data-pp-doc-del="${esc(doc.id)}"><i class="ti ti-trash"></i>Hapus</button>` : ''}
        <button type="button" class="pp-btn primary" data-pp-close>Tutup</button>`,
    });
    target._cleanup = () => setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function openDocDelete(docId) {
    modal(L2(), {
      title: 'Hapus dokumen', sub: 'Dokumen dinonaktifkan (tidak dihapus permanen) dan tercatat di audit.',
      body: '<div class="pp-fld"><label class="lb">Alasan <em>*</em></label><input type="text" id="ppDelReason" placeholder="mis. salah unggah, file buram"></div><div id="ppDelMsg" hidden></div>',
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppDelSave" style="background:var(--pp-danger-fill);border-color:var(--pp-danger-fill)">Hapus</button>',
    });
    $('#ppDelSave').onclick = () => {
      const reason = $('#ppDelReason').value.trim();
      if (reason.length < 3) { showMsg($('#ppDelMsg'), 'Alasan wajib diisi.'); return; }
      run($('#ppDelSave'), async () => {
        await api(`${API}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
        closeL2(); toast('Dokumen dihapus'); if (S.profile) await reloadProfile(); reloadDirectory(false);
      }).catch(err => showMsg($('#ppDelMsg'), err.message));
    };
  }

  // ------------------------------------------------------------------ WIZARD tambah karyawan
  let W = null;
  function openWizard() {
    const today = todayIso();
    const dept = departments()[0];
    W = {
      step: 1, nama: '', nik: '', birth_place: '', birth_date: '', gender: '', phone: '', email: '', blood_type: '', address: '',
      emergency_contact_name: '', emergency_contact_relation: '', emergency_contact_phone: '',
      fam: { marital: '', members: [] },
      department_id: dept?.id || '', position_id: positionsOf(dept?.id)[0]?.id || '', hire_date: today, nrp: '',
      employment_type: 'PKWT', contract_end_date: addDays(addMonths(today, 12), -1), probation_end_date: '', probation_touched: false,
      supervisor_user_id: '', site: '', manpower_request_id: '', lokasi_ids: [], shift_id: '', access: 'invite', password: '',
      face: null, cv: null, comps: [], requests: null, error: '',
    };
    renderWizard();
    apiCall(`${WF}/manpower-requests?limit=200`).then(r => { W && (W.requests = (r.rows || r || []).filter(x => ['APPROVED', 'IN_PROGRESS'].includes(x.status) && Number(x.filled_qty) < Number(x.qty))); if (W && W.step === 2) renderWizard(); }).catch(() => { if (W) W.requests = []; });
  }
  function probationDefault() { return W.hire_date ? addDays(addMonths(W.hire_date, Number(S.data.settings?.probation_months ?? 3)), 0) : ''; }
  function collectWizard() {
    const box = $('#ppWizBody'); if (!box) return;
    $$('[data-w]', box).forEach(el => {
      const k = el.dataset.w;
      if (el.type === 'radio') { if (el.checked) W[k] = el.value; } else if (el.type !== 'file') W[k] = el.value;
    });
  }
  function wizardErrors(step) {
    const e = [];
    if (step === 1) {
      if (W.nama.trim().length < 2) e.push('Nama lengkap wajib diisi.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(W.email.trim())) e.push('Email login tidak valid.');
      if (W.nik.trim() && !/^[0-9]{16}$/.test(W.nik.replace(/[\s.-]/g, ''))) e.push('NIK harus 16 digit angka.');
    }
    if (step === 2) {
      if (!W.position_id) e.push('Pilih departemen dan jabatan.');
      if (!W.hire_date) e.push('Tanggal masuk wajib diisi.');
      if (W.employment_type === 'PKWT' && !W.contract_end_date) e.push('Tanggal akhir kontrak wajib untuk PKWT.');
      if (W.contract_end_date && W.hire_date && W.contract_end_date < W.hire_date) e.push('Akhir kontrak harus setelah tanggal masuk.');
    }
    if (step === 3) {
      if (!W.lokasi_ids.length) e.push('Pilih minimal satu lokasi absen.');
      if (W.access === 'password' && W.password.length < 8) e.push('Password awal minimal 8 karakter.');
    }
    return e;
  }
  function wizPdfRow(doc, kind, idx) {
    return `<div class="pp-pdf-row"><span class="ic">PDF</span><span>${esc(kind === 'cv' ? 'Curriculum vitae' : doc.title)}<span class="sub">${esc(doc.file.name)} · ${kb(doc.file.size)}</span></span><button type="button" class="pp-icon-btn" data-wiz-del="${kind}" data-idx="${idx}" aria-label="Hapus"><i class="ti ti-x"></i></button></div>`;
  }
  function renderWizard() {
    if (!W) return;
    const step = W.step;
    const steps = ['Identitas', 'Kepegawaian', 'Absensi & dokumen'];
    let body = '';
    if (step === 1) {
      body = `<div class="pp-row2"><div class="pp-fld"><label class="lb">Nama lengkap <em>*</em></label><input type="text" data-w="nama" value="${esc(W.nama)}" placeholder="Sesuai KTP"></div>
          <div class="pp-fld"><label class="lb">NIK KTP</label><input type="text" data-w="nik" value="${esc(W.nik)}" inputmode="numeric" maxlength="20" placeholder="16 digit"><div class="pp-hint">Dicek unik saat disimpan. Boleh dilengkapi nanti.</div></div></div>
        <div class="pp-row3"><div class="pp-fld"><label class="lb">Tempat lahir</label><input type="text" data-w="birth_place" value="${esc(W.birth_place)}"></div>
          <div class="pp-fld"><label class="lb">Tanggal lahir</label><input type="date" data-w="birth_date" value="${esc(W.birth_date)}"></div>
          <div class="pp-fld"><label class="lb">Jenis kelamin</label><select data-w="gender"><option value="">—</option><option value="M" ${W.gender === 'M' ? 'selected' : ''}>Laki-laki</option><option value="F" ${W.gender === 'F' ? 'selected' : ''}>Perempuan</option></select></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Email login <em>*</em></label><input type="email" data-w="email" value="${esc(W.email)}" placeholder="nama@perusahaan.co.id"></div>
          <div class="pp-fld"><label class="lb">No. HP</label><input type="text" data-w="phone" value="${esc(W.phone)}" placeholder="08xx"></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Golongan darah</label><select data-w="blood_type"><option value="">—</option>${['A', 'B', 'AB', 'O'].map(b => `<option ${W.blood_type === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
          <div class="pp-fld"><label class="lb">Alamat</label><input type="text" data-w="address" value="${esc(W.address)}"></div></div>
        <div class="pp-row3"><div class="pp-fld"><label class="lb">Kontak darurat</label><input type="text" data-w="emergency_contact_name" value="${esc(W.emergency_contact_name)}" placeholder="Nama"></div>
          <div class="pp-fld"><label class="lb">Hubungan</label><input type="text" data-w="emergency_contact_relation" value="${esc(W.emergency_contact_relation)}" placeholder="mis. istri"></div>
          <div class="pp-fld"><label class="lb">No. HP darurat</label><input type="text" data-w="emergency_contact_phone" value="${esc(W.emergency_contact_phone)}"></div></div>
        <div class="pp-fam-box" id="ppFamWiz"></div>`;
    } else if (step === 2) {
      const depts = departments();
      const pos = positionsOf(W.department_id);
      if (!pos.some(p => p.id === W.position_id)) W.position_id = pos[0]?.id || '';
      if (!W.probation_touched) W.probation_end_date = probationDefault();
      const mrs = (W.requests || []).filter(r => !W.position_id || r.position_id === W.position_id);
      const sups = S.data.options?.supervisors || [];
      body = `<div class="pp-row2"><div class="pp-fld"><label class="lb">Departemen <em>*</em></label><select data-w="department_id" id="ppWDept">${depts.map(d => `<option value="${esc(d.id)}" ${d.id === W.department_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
          <div class="pp-fld"><label class="lb">Jabatan <em>*</em></label><select data-w="position_id" id="ppWPos">${pos.map(p => `<option value="${esc(p.id)}" ${p.id === W.position_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option value="">— Belum ada jabatan aktif —</option>'}</select><div class="pp-hint">Pilihan dari Setup master. Tidak ada di daftar? Tambahkan dulu di Setup master.</div></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Tanggal masuk <em>*</em></label><input type="date" data-w="hire_date" id="ppWHire" value="${esc(W.hire_date)}"></div>
          <div class="pp-fld"><label class="lb">NRP</label><input type="text" data-w="nrp" value="${esc(W.nrp)}" placeholder="Otomatis: ${esc(S.data.settings?.nrp_next_preview || '')}"><div class="pp-hint">Kosongkan agar dibuat otomatis dari pola NRP.</div></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Tipe kerja <em>*</em></label><div class="pp-radios">${Object.entries(TYPE_KERJA).map(([k, v]) => `<label><input type="radio" name="ppWType" data-w="employment_type" value="${k}" ${W.employment_type === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></div>
          <div class="pp-fld"><label class="lb">Kontrak berakhir ${W.employment_type === 'PKWT' ? '<em>*</em>' : ''}</label><input type="date" data-w="contract_end_date" value="${esc(W.contract_end_date)}" ${W.employment_type === 'PKWTT' ? 'disabled' : ''}></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Probation berakhir</label><input type="date" data-w="probation_end_date" id="ppWProb" value="${esc(W.probation_end_date)}"><div class="pp-hint">Default ${esc(S.data.settings?.probation_months ?? 3)} bulan dari tanggal masuk.</div></div>
          <div class="pp-fld"><label class="lb">Atasan langsung</label><select data-w="supervisor_user_id"><option value="">— Belum ditentukan —</option>${sups.map(u => `<option value="${esc(u.id)}" ${u.id === W.supervisor_user_id ? 'selected' : ''}>${esc(u.nama)} · ${esc(u.jabatan || '—')}</option>`).join('')}</select></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Site</label><input type="text" data-w="site" value="${esc(W.site)}" placeholder="Isi manual, mis. Pit 3"></div>
          <div class="pp-fld"><label class="lb">Manpower Request</label><select data-w="manpower_request_id"><option value="">— Tanpa MR —</option>${mrs.map(r => `<option value="${esc(r.id)}" ${r.id === W.manpower_request_id ? 'selected' : ''}>${esc(r.request_no)} · ${esc(r.position_name || '')} · sisa ${Number(r.qty) - Number(r.filled_qty)}</option>`).join('')}</select><div class="pp-hint">${W.requests == null ? 'Memuat MR…' : 'Mengisi fill rate MPP saat karyawan masuk.'}</div></div></div>`;
    } else {
      const lok = S.data.options?.lokasi || [];
      const shifts = S.data.options?.shifts || [];
      body = `<div class="pp-row2"><div class="pp-fld"><label class="lb">Lokasi absen <em>*</em></label><div class="pp-ms full" id="ppWLok"></div><div class="pp-hint">Boleh lebih dari satu. Lokasi pertama = lokasi utama.</div></div>
          <div class="pp-fld"><label class="lb">Shift</label><select data-w="shift_id"><option value="">— Ikut roster —</option>${shifts.map(s => `<option value="${esc(s.id)}" ${s.id === W.shift_id ? 'selected' : ''}>${esc(s.nama_shift)}</option>`).join('')}</select></div></div>
        ${W.lokasi_ids.length ? `<div class="pp-lok-chips" style="margin-top:-4px">${W.lokasi_ids.map((id, i) => `<span class="pp-chip accent"><i class="ti ti-map-pin"></i>${esc(lok.find(l => l.id === id)?.nama_lokasi || '?')}${i === 0 ? ' · utama' : ''}</span>`).join('')}</div>` : ''}
        <div class="pp-fld"><label class="lb">Foto wajah referensi</label>${W.face ? `<div class="pp-pdf-row"><span class="ic" style="background:var(--pp-accent-bg);color:var(--pp-accent)">IMG</span><span>${esc(W.face.name)}<span class="sub">${kb(W.face.size)} · dicek kemiripan dengan karyawan aktif saat disimpan</span></span><button type="button" class="pp-icon-btn" data-wiz-del="face" aria-label="Hapus"><i class="ti ti-x"></i></button></div>`
          : '<div class="pp-upl"><span>Belum ada foto wajah<span class="sub">JPEG/PNG. Bisa juga diunggah nanti dari profil.</span></span><label class="pp-btn sm"><i class="ti ti-camera"></i>Pilih foto<input type="file" accept="image/jpeg,image/png" data-wiz-file="face" class="pp-file-input"></label></div>'}</div>
        <div class="pp-fld"><label class="lb">CV</label>${W.cv ? wizPdfRow(W.cv, 'cv', 0) : '<div class="pp-upl"><span>Belum ada CV<span class="sub">PDF, maks. 5 MB</span></span><label class="pp-btn sm"><i class="ti ti-upload"></i>Unggah CV<input type="file" accept="application/pdf,.pdf" data-wiz-file="cv" class="pp-file-input"></label></div>'}</div>
        <div class="pp-fld"><label class="lb">Kompetensi &amp; sertifikat</label><div class="pp-list">${W.comps.map((d, i) => wizPdfRow(d, 'comp', i)).join('')}<div class="pp-upl"><span>${W.comps.length ? 'Tambah sertifikat lain' : 'Belum ada sertifikat'}<span class="sub">PDF, bisa lebih dari satu. Masa berlaku diisi dari profil.</span></span><label class="pp-btn sm"><i class="ti ti-upload"></i>Unggah PDF<input type="file" accept="application/pdf,.pdf" data-wiz-file="comp" multiple class="pp-file-input"></label></div></div></div>
        <div class="pp-fld"><label class="lb">Akses aplikasi</label><div class="pp-radios"><label><input type="radio" name="ppWAccess" data-w="access" value="invite" ${W.access === 'invite' ? 'checked' : ''}><span>Kirim undangan ke email</span></label><label><input type="radio" name="ppWAccess" data-w="access" value="password" ${W.access === 'password' ? 'checked' : ''}><span>Buat password awal</span></label></div>
          ${W.access === 'password' ? `<input type="password" data-w="password" value="${esc(W.password)}" placeholder="Minimal 8 karakter" autocomplete="new-password" style="margin-top:6px">` : '<div class="pp-hint">Karyawan menerima kode lewat email, lalu membuat password sendiri (Aktifkan akun di aplikasi). Berlaku 7 hari.</div>'}</div>
        <div class="pp-preview"><i class="ti ti-list-check"></i><div>Saat disimpan: akun dibuat, penempatan tercatat sebagai pergerakan <b>Masuk</b>, dan checklist onboarding (MCU, induksi, APD, akses) dibuat.</div></div>`;
    }
    const target = L1();
    const scrollTop = target.querySelector('.pp-overlay')?.scrollTop || 0;
    target.innerHTML = `<div class="pp-overlay" data-pp-close><div class="pp-modal wide" role="dialog" aria-modal="true" aria-label="Tambah karyawan">
      <div class="pp-m-head"><div><h2>Tambah karyawan</h2><p>Satu-satunya pintu masuk karyawan baru. Jabatan &amp; lokasi dipilih dari master.</p></div><button type="button" class="pp-icon-btn" data-pp-close aria-label="Tutup"><i class="ti ti-x"></i></button></div>
      <div class="pp-wsteps">${steps.map((s, i) => `<span class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>
      <div class="pp-m-body" id="ppWizBody">${body}${W.error ? `<div class="pp-msg">${esc(W.error)}</div>` : ''}</div>
      <div class="pp-m-foot">${step > 1 ? `<button type="button" class="pp-btn" data-wstep="${step - 1}">Kembali</button>` : '<button type="button" class="pp-btn" data-pp-close>Batal</button>'}${step < 3 ? `<button type="button" class="pp-btn primary" data-wstep="${step + 1}">Lanjut</button>` : '<button type="button" class="pp-btn primary" id="ppWizSave">Simpan karyawan</button>'}</div>
    </div></div>`;
    const ov = target.querySelector('.pp-overlay'); if (ov) ov.scrollTop = scrollTop;
    if (step === 1) bindFam($('#ppFamWiz'), W.fam);
    const wd = $('#ppWDept'); if (wd) wd.onchange = () => { collectWizard(); W.position_id = positionsOf(W.department_id)[0]?.id || ''; renderWizard(); };
    const wp = $('#ppWPos'); if (wp) wp.onchange = () => { collectWizard(); W.manpower_request_id = ''; renderWizard(); };
    const wh = $('#ppWHire'); if (wh) wh.onchange = () => { collectWizard(); renderWizard(); };
    const wpr = $('#ppWProb'); if (wpr) wpr.oninput = () => { W.probation_touched = true; };
    $$('input[name=ppWType], input[name=ppWAccess]').forEach(r => { r.onchange = () => { collectWizard(); renderWizard(); }; });
    const lokEl = $('#ppWLok');
    if (lokEl) {
      const lok = S.data.options?.lokasi || [];
      msRender(lokEl, 'Pilih lokasi', [{ items: lok.map(l => ({ value: l.id, label: l.nama_lokasi, count: `radius ${l.radius_meter} m` })) }], W.lokasi_ids, v => {
        // jaga urutan pilihan: yang pertama dicentang = utama
        W.lokasi_ids = W.lokasi_ids.filter(id => v.includes(id)).concat(v.filter(id => !W.lokasi_ids.includes(id)));
        if (W.lokasi_ids.length && /lokasi absen/.test(W.error)) W.error = '';
        collectWizard(); renderWizard(); const n = $('#ppWLok'); if (n) { n.dataset.open = '1'; n._redraw && n._redraw(); }
      });
    }
    $$('[data-wiz-file]', target).forEach(inp => {
      inp.onchange = () => {
        const kind = inp.dataset.wizFile; const files = Array.from(inp.files || []);
        collectWizard();
        for (const f of files) {
          if (kind === 'face') {
            if (!/^image\/(jpeg|png)$/.test(f.type)) { toast('Foto harus JPEG atau PNG', true); continue; }
            if (f.size > MAX_PDF) { toast('Ukuran foto maksimal 5 MB', true); continue; }
            W.face = f;
          } else {
            const bad = checkPdf(f); if (bad) { toast(bad, true); continue; }
            const doc = { file: f, title: f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ') };
            if (kind === 'cv') W.cv = doc; else W.comps.push(doc);
          }
        }
        renderWizard();
      };
    });
    const save = $('#ppWizSave'); if (save) save.onclick = () => saveWizard(save);
  }
  async function saveWizard(button) {
    collectWizard();
    const errs = [1, 2, 3].flatMap(wizardErrors);
    if (errs.length) { W.error = errs[0]; renderWizard(); return; }
    W.error = '';
    const fam = famPayload(W.fam);
    const payload = {
      nama: W.nama.trim(), email: W.email.trim(), nik: W.nik.trim() || null, birth_place: W.birth_place || null, birth_date: W.birth_date || null,
      gender: W.gender || null, phone: W.phone || null, blood_type: W.blood_type || null, address: W.address || null,
      emergency_contact_name: W.emergency_contact_name || null, emergency_contact_relation: W.emergency_contact_relation || null,
      emergency_contact_phone: W.emergency_contact_phone || null,
      position_id: W.position_id, department_id: W.department_id, hire_date: W.hire_date, nrp: W.nrp.trim() || null,
      employment_type: W.employment_type, contract_end_date: W.employment_type === 'PKWTT' ? null : (W.contract_end_date || null),
      probation_end_date: W.probation_end_date || null, supervisor_user_id: W.supervisor_user_id || null, site: W.site || null,
      manpower_request_id: W.manpower_request_id || null, lokasi_ids: W.lokasi_ids, shift_id: W.shift_id || null,
      password: W.access === 'password' ? W.password : undefined, send_invite: W.access === 'invite',
      marital_status: fam.marital_status, family_members: fam.family_members,
    };
    let created = null;
    try {
      await run(button, async () => { created = await apiSend(`${API}/employees`, 'POST', payload); });
    } catch (error) {
      W.error = error.message; renderWizard(); return;
    }
    // Lampiran setelah akun ada: kegagalan tidak membatalkan karyawan yang sudah tersimpan.
    const warnings = [];
    if (W.face) {
      try { await uploadFace(created.user_id, W.face, false); } catch (e) { warnings.push(`Foto wajah: ${e.message}`); }
    }
    const docs = [];
    if (W.cv) docs.push(['CV', W.cv]);
    W.comps.forEach(d => docs.push(['COMPETENCY', d]));
    for (const [type, d] of docs) {
      const fd = new FormData(); fd.append('doc_type', type); fd.append('title', type === 'CV' ? '' : d.title); fd.append('file', d.file, d.file.name);
      try { await apiCall(`${API}/employees/${encodeURIComponent(created.user_id)}/documents`, { method: 'POST', body: fd }); } catch (e) { warnings.push(`${d.file.name}: ${e.message}`); }
    }
    const nama = W.nama; const lokCount = W.lokasi_ids.length;
    W = null;
    await refreshAll();
    if (warnings.length) {
      openProfile(created.user_id, 'ringkasan').then(() => {
        modal(L2(), { title: 'Karyawan tersimpan, sebagian lampiran gagal', body: `<div class="pp-preview warn"><i class="ti ti-alert-triangle"></i><div>${warnings.map(esc).join('<br>')}</div></div><div class="pp-hint">Unggah ulang dari profil karyawan.</div>`, foot: '<button type="button" class="pp-btn primary" data-pp-close>Mengerti</button>' });
      });
    } else {
      closeL1();
      toast(`${nama} disimpan · NRP ${created.nrp} · absen di ${lokCount} lokasi${created.invite_sent ? ' · undangan terkirim' : created.invite_failed ? ' · undangan gagal dikirim' : ''}`, Boolean(created.invite_failed));
    }
  }

  // ------------------------------------------------------------------ PERGERAKAN
  function changeText(m) {
    const b = m.before_state || {}; const a = m.after_state || {};
    if (m.group === 'KELUAR') return [`${b.position || '—'} · ${b.department || '—'}`, `Hari kerja terakhir ${fmt(m.last_working_day)}${m.rehire_eligible === false ? ' · tidak boleh rehire' : ''}`];
    if (m.movement_type === 'CONFIRMATION') return ['Probation', m.evaluation_result === 'EXTENDED' ? `Diperpanjang s/d ${fmt(a.probation_end_date)}` : 'Aktif'];
    if (m.movement_type === 'CONTRACT_RENEWAL') return [`${TYPE_KERJA[b.employment_type] || b.employment_type || '—'}`, `s/d ${fmt(m.contract_end_date)}`];
    if (m.movement_type === 'EMPLOYMENT_TYPE_CHANGE') return [TYPE_KERJA[b.employment_type] || b.employment_type || '—', TYPE_KERJA[a.employment_type] || a.employment_type || '—'];
    if (m.movement_type === 'HIRE') return ['—', `${a.position || '—'} · ${a.department || '—'}`];
    return [`${b.position || '—'} · ${b.department || '—'}${b.site ? ` · ${b.site}` : ''}`, `${a.position || '—'} · ${a.department || '—'}${a.site ? ` · ${a.site}` : ''}`];
  }
  function renderMovements() {
    const pane = $('#ppPane-pergerakan');
    const d = S.data.movements;
    if (!d) { pane.innerHTML = loading(); return; }
    const c = d.counts;
    const myId = me().id;
    const views = [['approval', 'Menunggu persetujuan', c.approval, 'warn'], ['terjadwal', 'Terjadwal', c.terjadwal, ''], ['draft', 'Draft', c.draft, ''], ['riwayat', 'Riwayat', null, '']];
    pane.innerHTML = `<div class="pp-kpis four">
        <div class="pp-card pp-kpi ${c.approval ? 'warn' : ''}"><div class="l">Menunggu persetujuan</div><div class="v">${c.approval}</div><div class="s">butuh approver selain pembuat</div></div>
        <div class="pp-card pp-kpi"><div class="l">Terjadwal</div><div class="v">${c.terjadwal}</div><div class="s">diterapkan otomatis saat jatuh tempo</div></div>
        <div class="pp-card pp-kpi"><div class="l">Masuk bulan ini</div><div class="v">${c.masuk_bulan_ini}</div><div class="s">efektif</div></div>
        <div class="pp-card pp-kpi"><div class="l">Keluar bulan ini</div><div class="v">${c.keluar_bulan_ini}</div><div class="s">efektif</div></div></div>
      <div class="pp-card">
        <div class="pp-toolbar"><div class="pp-seg">${views.map(([k, l, n, w]) => `<button type="button" class="${S.mov.view === k ? 'on' : ''}" data-pp-mview="${k}">${l}${n != null ? ` <span class="pp-count ${n && w ? w : ''}">${n}</span>` : ''}</button>`).join('')}</div>
          <span class="grow"></span>
          <select id="ppMovGroup" aria-label="Jenis pergerakan"><option value="">Semua jenis</option>${Object.entries(GROUP_LABEL).filter(([k]) => k !== 'LAINNYA').map(([k, v]) => `<option value="${k}" ${S.mov.group === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="pp-tbl-wrap"><table class="pp-tbl"><thead><tr><th>No · tanggal efektif</th><th>Karyawan</th><th>Jenis</th><th>Perubahan &amp; alasan</th><th>Checklist</th><th>Status</th><th></th></tr></thead>
          <tbody>${d.rows.length ? d.rows.map(m => {
            const [sl, sc] = MOV_ST[m.status] || [m.status, 'muted'];
            const [from, to] = changeText(m);
            const mine = String(m.created_by) === String(myId);
            let act = `<button type="button" class="pp-btn sm" data-pp-mdetail="${esc(m.id)}">Lihat</button>`;
            if (m.status === 'SUBMITTED' && canApprove()) act = `<button type="button" class="pp-btn sm" data-pp-mtrans="REJECTED" data-id="${esc(m.id)}">Tolak</button> <button type="button" class="pp-btn sm primary" data-pp-mtrans="APPROVED" data-id="${esc(m.id)}" data-mine="${mine ? '1' : ''}" ${mine && !isSuper() ? 'disabled title="Pengajuan Anda harus disetujui admin lain"' : ''}>Setujui</button>`;
            if (m.status === 'DRAFT') act = `<button type="button" class="pp-btn sm" data-pp-mtrans="CANCELLED" data-id="${esc(m.id)}">Batalkan</button> <button type="button" class="pp-btn sm primary" data-pp-mtrans="SUBMITTED" data-id="${esc(m.id)}">Ajukan</button>`;
            return `<tr><td><span class="code">${esc(m.movement_no)}</span><span class="sub">efektif ${fmt(m.effective_date)}</span></td>
              <td><div class="pp-person"><span class="pp-avatar s-${esc(m.employment_status)}">${esc(initials(m.nama))}</span><div><span class="n">${esc(m.nama)}</span><span class="sub">${esc(m.nrp || '—')}</span></div></div></td>
              <td><span class="pp-chip ${m.group === 'KELUAR' ? 'danger' : m.group === 'MASUK' ? 'success' : 'accent'}">${esc(TYPE_LABEL[m.movement_type] || m.movement_type)}</span><span class="sub">${esc(GROUP_LABEL[m.group] || '')}</span></td>
              <td>${esc(from)} → ${esc(to)}${m.reason_text ? `<span class="sub">Alasan: ${esc(m.reason_text)}</span>` : ''}</td>
              <td>${m.tasks_total ? `<span class="pp-chip ${m.tasks_done === m.tasks_total ? 'success' : 'warning'}">${m.tasks_done}/${m.tasks_total} selesai</span>` : '<span class="sub">—</span>'}</td>
              <td><span class="pp-chip ${sc}">${sl}</span><span class="sub">oleh ${esc(m.created_by_name || 'Sistem')}</span></td>
              <td class="act">${act}</td></tr>`;
          }).join('') : '<tr><td colspan="7"><div class="pp-empty"><i class="ti ti-arrows-exchange"></i>Tidak ada pergerakan di kategori ini.</div></td></tr>'}</tbody></table></div>
        <div class="pp-tfoot"><span>Pergerakan yang disetujui diterapkan otomatis tiap hari setelah tanggal efektif.</span><span>Pembuat tidak bisa menyetujui pengajuannya sendiri${isSuper() ? ' (Admin Utama boleh dengan alasan tertulis)' : ''}</span></div>
      </div>`;
    $('#ppMovGroup').onchange = async ev => { S.mov.group = ev.target.value; await reloadMovements(); };
  }
  async function reloadMovements() {
    try { await loadMovements(); } catch (error) { toast(error.message, true); return; }
    renderMovements(); renderTabs();
  }

  function transition(button, id, status, extra = {}) {
    const needText = status === 'REJECTED' || status === 'CANCELLED' || (status === 'APPROVED' && button.dataset.mine === '1');
    const go = body => run(button, async () => {
      await apiSend(`${WF}/movements/${encodeURIComponent(id)}/transition`, 'POST', { status, ...body });
      closeL2();
      toast({ SUBMITTED: 'Diajukan ke approver', APPROVED: 'Disetujui · dijadwalkan', REJECTED: 'Pengajuan ditolak', CANCELLED: 'Pergerakan dibatalkan', EFFECTIVE: 'Diterapkan' }[status] || 'Tersimpan');
      await refreshAll();
      if (S.profile) await reloadProfile();
    });
    if (!needText) { go(extra).catch(err => toast(err.message, true)); return; }
    const self = status === 'APPROVED';
    modal(L2(), {
      title: self ? 'Setujui pengajuan sendiri' : status === 'REJECTED' ? 'Tolak pengajuan' : 'Batalkan pergerakan',
      sub: self ? 'Hanya Admin Utama, dengan alasan tertulis yang tercatat di audit.' : 'Alasan tampil di riwayat pergerakan.',
      body: `<div class="pp-fld"><label class="lb">Alasan <em>*</em></label><input type="text" id="ppTransReason" placeholder="${self ? 'mis. admin HR tunggal di site' : 'Tulis alasan'}"></div><div id="ppTransMsg" hidden></div>`,
      foot: `<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppTransSave">${self ? 'Setujui' : status === 'REJECTED' ? 'Tolak' : 'Batalkan pergerakan'}</button>`,
    });
    $('#ppTransSave').onclick = () => {
      const reason = $('#ppTransReason').value.trim();
      if (reason.length < (self ? 5 : 3)) { showMsg($('#ppTransMsg'), self ? 'Alasan minimal 5 karakter.' : 'Alasan wajib diisi.'); return; }
      const btn = $('#ppTransSave');
      btn.dataset.mine = '';
      run(btn, async () => {
        await apiSend(`${WF}/movements/${encodeURIComponent(id)}/transition`, 'POST', { status, ...(self ? { self_approval_reason: reason, comment: reason } : { comment: reason, reason }) });
        closeL2(); toast(self ? 'Disetujui dengan alasan tercatat' : status === 'REJECTED' ? 'Pengajuan ditolak' : 'Pergerakan dibatalkan');
        await refreshAll(); if (S.profile) await reloadProfile();
      }).catch(err => showMsg($('#ppTransMsg'), err.message));
    };
  }

  async function openMovementDetail(id) {
    modal(L2(), { title: 'Detail pergerakan', body: loading(), size: 'wide' });
    let data;
    try { data = await apiCall(`${WF}/movements/${encodeURIComponent(id)}`); } catch (error) {
      modal(L2(), { title: 'Detail pergerakan', body: `<div class="pp-error">${esc(error.message)}</div>`, foot: '<button type="button" class="pp-btn primary" data-pp-close>Tutup</button>' }); return;
    }
    const m = data.movement; const b = m.before_state || {}; const a = m.after_state || {};
    const [sl, sc] = MOV_ST[m.status] || [m.status, 'muted'];
    const keys = [['department', 'Departemen'], ['position', 'Jabatan'], ['site', 'Site'], ['employment_type', 'Tipe kerja']];
    const allowed = { DRAFT: ['CANCELLED', 'SUBMITTED'], SUBMITTED: canApprove() ? ['REJECTED', 'APPROVED'] : [], APPROVED: ['CANCELLED'] }[m.status] || [];
    const mine = String(m.created_by) === String(me().id);
    modal(L2(), {
      title: `${esc(m.movement_no)} · ${esc(TYPE_LABEL[m.movement_type] || m.movement_type)}`, size: 'wide',
      sub: `${esc(m.nama)} · ${esc(m.employee_id || '—')} · efektif ${fmt(m.effective_date)} <span class="pp-chip ${sc}">${sl}</span>`,
      body: `<div class="pp-compare"><div class="h">Data</div><div class="h">Sebelum</div><div class="h arr"></div><div class="h">Sesudah</div>${keys.map(([k, l]) => `<div>${l}</div><div>${esc(b[k] || '—')}</div><div class="arr">→</div><div class="${(b[k] || '') !== (a[k] || '') ? 'chg' : ''}">${esc(a[k] || '—')}</div>`).join('')}</div>
        ${m.last_working_day ? `<div class="pp-preview warn"><i class="ti ti-calendar-time"></i><div>Hari kerja terakhir <b>${fmt(m.last_working_day)}</b> · akun nonaktif mulai ${fmt(m.effective_date)}.</div></div>` : ''}
        ${m.reason_text ? `<div><div class="pp-group-title">Alasan</div><div>${esc(m.reason_text)}</div>${m.notes ? `<div class="pp-hint">${esc(m.notes)}</div>` : ''}</div>` : ''}
        <div><div class="pp-sec-title">Checklist</div>${data.tasks.length ? `<div class="pp-list">${data.tasks.map(t => `<div class="pp-pdf-row" style="grid-template-columns:1fr auto"><span><b style="font-weight:500">${esc(t.task_name)}</b><span class="sub">${t.task_kind === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'}${t.is_required ? ' · wajib' : ''}</span></span>
            <select data-pp-task="${esc(t.id)}" style="width:auto" ${['EFFECTIVE', 'CANCELLED', 'REJECTED'].includes(m.status) ? 'disabled' : ''}>${[['OPEN', 'Belum'], ['IN_PROGRESS', 'Proses'], ['DONE', 'Selesai'], ['WAIVED', 'Dikecualikan']].map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('')}</div>` : '<div class="pp-hint" style="margin:0">Tidak ada checklist untuk jenis ini.</div>'}</div>
        ${data.audit.length ? `<div><div class="pp-sec-title">Jejak</div><div class="pp-tl">${data.audit.map(x => `<div class="pp-tl-item"><span class="pp-tl-dot"></span><div><div class="t">${esc(auditAction(x.action || x.to_status))}</div><div class="d">${esc(x.actor_name || 'Sistem')} · ${fmtTime(x.created_at)}</div>${x.comment ? `<div class="c">${esc(x.comment)}</div>` : ''}</div></div>`).join('')}</div></div>` : ''}`,
      foot: `<button type="button" class="pp-btn" data-pp-close>Tutup</button>${allowed.map(s => `<button type="button" class="pp-btn ${s === 'APPROVED' || s === 'SUBMITTED' ? 'primary' : ''}" data-pp-mtrans="${s}" data-id="${esc(m.id)}" data-mine="${s === 'APPROVED' && mine ? '1' : ''}" ${s === 'APPROVED' && mine && !isSuper() ? 'disabled' : ''}>${{ CANCELLED: 'Batalkan', SUBMITTED: 'Ajukan', REJECTED: 'Tolak', APPROVED: 'Setujui' }[s]}</button>`).join('')}`,
    });
    $$('[data-pp-task]').forEach(sel => {
      sel.onchange = async () => {
        try { await apiSend(`${WF}/tasks/${encodeURIComponent(sel.dataset.ppTask)}`, 'PATCH', { status: sel.value }); toast('Checklist diperbarui'); } catch (error) { toast(error.message, true); }
      };
    });
  }

  function auditAction(a) {
    const code = String(a || '').replace(/^TRANSITION_/, '');
    return { CREATE: 'Dibuat (draft)', SUBMITTED: 'Diajukan', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan',
      EFFECTIVE: 'Diterapkan (efektif)', DRAFT: 'Draft' }[code] || code || '—';
  }

  // ---- form ajukan pergerakan
  let M = null;
  async function openMove(userId = null, type = 'TRANSFER') {
    if (!S.data.everyone) { try { await loadEveryone(); } catch (error) { toast(error.message, true); return; } }
    M = { userId, type, search: '', draft: {} };
    renderMove();
  }
  const groupOfType = t => TYPE_GROUPS.find(g => g[2].includes(t))?.[0];
  function renderMove() {
    const e = M.userId ? S.data.everyone.find(x => x.id === M.userId) : null;
    const grp = groupOfType(M.type);
    const D = M.draft;
    const pool = S.data.everyone.filter(x => (M.type === 'REHIRE' ? x.status === 'INACTIVE' : x.status !== 'INACTIVE')
      && (!M.search || `${x.nama} ${x.nrp || ''} ${x.jabatan || ''}`.toLowerCase().includes(M.search.toLowerCase()))).slice(0, 60);
    const today = todayIso();
    let fields = '';
    if (!e) fields = '<div class="pp-preview"><i class="ti ti-user-search"></i><div>Pilih karyawan dulu untuk menampilkan isian.</div></div>';
    else if (grp === 'PENEMPATAN' || M.type === 'REHIRE') {
      const deptId = D.department_id ?? e.department_id ?? departments()[0]?.id;
      const pos = positionsOf(deptId);
      const posId = D.position_id && pos.some(p => p.id === D.position_id) ? D.position_id : (pos.some(p => p.id === e.position_id) ? e.position_id : pos[0]?.id);
      D.department_id = deptId; D.position_id = posId;
      fields = `<div class="pp-row2"><div class="pp-fld"><label class="lb">Departemen ${M.type === 'REHIRE' ? '' : 'tujuan '}<em>*</em></label><select id="ppMDept">${departments().map(d => `<option value="${esc(d.id)}" ${d.id === deptId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
          <div class="pp-fld"><label class="lb">Jabatan ${M.type === 'REHIRE' ? '' : 'tujuan '}<em>*</em></label><select id="ppMPos">${pos.map(p => `<option value="${esc(p.id)}" ${p.id === posId ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option value="">— Belum ada jabatan aktif —</option>'}</select><div class="pp-hint">Hanya jabatan di departemen terpilih.</div></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Site${M.type === 'REHIRE' ? '' : ' tujuan'}</label><input type="text" id="ppMSite" value="${esc(D.site || '')}" placeholder="Isi manual${e.site ? `, kosongkan jika tetap (${esc(e.site)})` : ''}"></div>
          <div class="pp-fld"><label class="lb">Tanggal efektif <em>*</em></label><input type="date" id="ppMEff" value="${esc(D.effective_date || addDays(today, 1))}"></div></div>
        ${M.type === 'REHIRE' ? `<div class="pp-row2"><div class="pp-fld"><label class="lb">Tipe kerja</label><select id="ppMType">${Object.entries(TYPE_KERJA).map(([k, v]) => `<option value="${k}" ${(D.employment_type || 'PKWT') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div></div></div>
          <div class="pp-preview"><i class="ti ti-user-check"></i><div>Rehire membuka periode kerja baru dengan NRP yang sama. Riwayat periode lama, CV, dan sertifikat tetap tersimpan.</div></div>`
          : `<div><div class="pp-group-title">Sebelum → sesudah</div><div class="pp-compare" id="ppMCompare"></div></div>
          <div class="pp-preview"><i class="ti ti-plug-connected"></i><div>Mulai tanggal efektif: roster, aturan cuti, dan jam kerja HSE mengikuti penempatan baru. Data sebelum tanggal itu tetap memakai penempatan lama.</div></div>`}`;
    } else if (grp === 'KELUAR') {
      const lwd = D.last_working_day || addDays(today, 30);
      fields = `<div class="pp-row2"><div class="pp-fld"><label class="lb">Hari kerja terakhir <em>*</em></label><input type="date" id="ppMLwd" value="${esc(lwd)}"><div class="pp-hint">Masih bisa absen sampai tanggal ini.</div></div>
          <div class="pp-fld"><label class="lb">Boleh direhire?</label><div class="pp-radios"><label><input type="radio" name="ppMRh" value="true" ${D.rehire_eligible !== false ? 'checked' : ''}><span>Ya</span></label><label><input type="radio" name="ppMRh" value="false" ${D.rehire_eligible === false ? 'checked' : ''}><span>Tidak</span></label></div></div></div>
        <div class="pp-preview warn" id="ppMExitInfo"><i class="ti ti-calendar-time"></i><div><b>Alur:</b> status jadi <b>Notice</b> setelah disetujui → akun nonaktif otomatis <b>${fmt(addDays(lwd, 1))}</b> → roster setelah hari terakhir ditutup. CV &amp; sertifikat tetap tersimpan di arsip alumni.</div></div>
        <div><div class="pp-group-title">Checklist offboarding yang akan dibuat</div><div class="pp-fchips"><span class="pp-chip">Cabut akses</span><span class="pp-chip">Pengembalian aset/APD</span><span class="pp-chip">Final settlement</span><span class="pp-chip">Arsip wajah</span></div></div>`;
    } else if (M.type === 'CONFIRMATION') {
      const res = D.evaluation_result || 'PASSED';
      const eff = D.effective_date || (e.key_date?.kind === 'PROBATION' && e.key_date.date ? addDays(e.key_date.date, 1) : today);
      fields = `<div class="pp-row2"><div class="pp-fld"><label class="lb">Tanggal efektif <em>*</em></label><input type="date" id="ppMEff" value="${esc(eff)}"></div>
          <div class="pp-fld"><label class="lb">Hasil evaluasi</label><div class="pp-radios"><label><input type="radio" name="ppMEval" value="PASSED" ${res === 'PASSED' ? 'checked' : ''}><span>Lulus</span></label><label><input type="radio" name="ppMEval" value="EXTENDED" ${res === 'EXTENDED' ? 'checked' : ''}><span>Diperpanjang</span></label></div></div></div>
        ${res === 'EXTENDED' ? `<div class="pp-fld"><label class="lb">Probation berakhir (baru) <em>*</em></label><input type="date" id="ppMProb" value="${esc(D.probation_end_date || addMonths(eff, 1))}"></div>` : ''}
        <div class="pp-preview"><i class="ti ti-info-circle"></i><div>Tidak lulus probation? Pilih <b>Terminasi</b> di kelompok Keluar dengan alasan hasil evaluasi.</div></div>`;
    } else if (M.type === 'CONTRACT_RENEWAL') {
      const curEnd = e.key_date?.kind === 'CONTRACT' ? e.key_date.date : null;
      const start = D.contract_start_date || (curEnd ? addDays(curEnd, 1) : today);
      fields = `<div class="pp-row2"><div class="pp-fld"><label class="lb">Nomor kontrak</label><input type="text" id="ppMCno" value="${esc(D.contract_no || '')}" placeholder="mis. PKWT/PIM/2026/1187"></div><div class="pp-fld"><label class="lb">Kontrak saat ini</label><div class="pp-hint" style="margin-top:8px">${curEnd ? `s/d ${fmt(curEnd)}` : '—'}</div></div></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Mulai <em>*</em></label><input type="date" id="ppMCstart" value="${esc(start)}"></div><div class="pp-fld"><label class="lb">Berakhir <em>*</em></label><input type="date" id="ppMCend" value="${esc(D.contract_end_date || addDays(addMonths(start, 12), -1))}"></div></div>
        <div class="pp-hint" style="margin:0">Dokumen kontrak PDF bisa diunggah dari profil → Dokumen.</div>`;
    } else if (M.type === 'EMPLOYMENT_TYPE_CHANGE') {
      const nt = D.employment_type || (e.employment_type === 'PKWTT' ? 'PKWT' : 'PKWTT');
      fields = `<div class="pp-row2"><div class="pp-fld"><label class="lb">Tipe kerja baru <em>*</em></label><div class="pp-radios">${Object.entries(TYPE_KERJA).map(([k, v]) => `<label><input type="radio" name="ppMNt" value="${k}" ${nt === k ? 'checked' : ''} ${e.employment_type === k ? 'disabled' : ''}><span>${v}</span></label>`).join('')}</div><div class="pp-hint">Saat ini: ${esc(TYPE_KERJA[e.employment_type] || e.employment_type || '—')}</div></div>
          <div class="pp-fld"><label class="lb">Tanggal efektif <em>*</em></label><input type="date" id="ppMEff" value="${esc(D.effective_date || addDays(today, 1))}"></div></div>
        ${nt === 'PKWT' ? `<div class="pp-row2"><div class="pp-fld"><label class="lb">Kontrak berakhir <em>*</em></label><input type="date" id="ppMCend" value="${esc(D.contract_end_date || '')}"></div><div class="pp-fld"><label class="lb">Nomor kontrak</label><input type="text" id="ppMCno" value="${esc(D.contract_no || '')}"></div></div>` : ''}`;
    }
    const reason = e ? `<div class="pp-fld"><label class="lb">Alasan <em>*</em></label><input type="text" id="ppMReason" value="${esc(D.reason || '')}" placeholder="Tulis alasan, ${esc(REASON_HINT[grp] || '')}"><div class="pp-hint">Diisi manual · tampil di riwayat, daftar pergerakan, dan dibaca approver.</div></div>
        <div class="pp-fld"><label class="lb">Catatan tambahan</label><textarea id="ppMNotes" placeholder="Opsional">${esc(D.notes || '')}</textarea></div>` : '';
    L1().innerHTML = `<div class="pp-overlay" data-pp-close><div class="pp-modal wide" role="dialog" aria-modal="true" aria-label="Ajukan pergerakan">
      <div class="pp-m-head"><div><h2>Ajukan pergerakan</h2><p>Disimpan sebagai draft, lalu diajukan ke approver.</p></div><button type="button" class="pp-icon-btn" data-pp-close aria-label="Tutup"><i class="ti ti-x"></i></button></div>
      <div class="pp-m-body">
        <div class="pp-typegrid">${TYPE_GROUPS.map(([g, label, list]) => `<div><div class="grp-l">${label}</div><div class="pp-typerow">${list.map(t => `<label class="pp-typecard ${g === 'KELUAR' ? 'exit' : ''}"><input type="radio" name="ppMt" value="${t}" ${t === M.type ? 'checked' : ''}><span>${TYPE_LABEL[t]}</span></label>`).join('')}</div></div>`).join('')}</div>
        <div class="pp-fld"><label class="lb">Karyawan <em>*</em></label>${e
          ? `<div class="pp-pick"><button type="button" class="pp-pick-item on" data-pp-pick-clear><span class="pp-avatar s-${esc(e.status)}">${esc(initials(e.nama))}</span><span><b style="font-weight:500">${esc(e.nama)}</b> <span class="sub">${esc(e.nrp || '—')} · ${esc(e.jabatan || '—')} · ${esc(e.departemen || '—')}</span></span><i class="ti ti-x" style="margin-left:auto"></i></button></div>`
          : `<div class="pp-pick"><input type="text" id="ppPickQ" placeholder="Cari nama atau NRP…" value="${esc(M.search)}"><div class="pp-pick-list">${pool.map(x => `<button type="button" class="pp-pick-item" data-pp-pick="${esc(x.id)}"><span class="pp-avatar s-${esc(x.status)}">${esc(initials(x.nama))}</span><span>${esc(x.nama)} <span class="sub">${esc(x.nrp || '—')} · ${esc(x.jabatan || '—')}</span></span></button>`).join('') || '<div class="pp-empty" style="padding:12px">Tidak ditemukan</div>'}</div></div>`}</div>
        ${fields}
        ${reason}
        <div id="ppMMsg" hidden></div>
      </div>
      <div class="pp-m-foot"><span class="pp-sod"><i class="ti ti-shield-lock"></i>Disetujui oleh approver selain Anda</span><button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn" id="ppMDraft" ${e ? '' : 'disabled'}>Simpan draft</button><button type="button" class="pp-btn primary" id="ppMSubmit" ${e ? '' : 'disabled'}>Ajukan</button></div>
    </div></div>`;
    $$('input[name=ppMt]').forEach(r => { r.onchange = () => { saveMoveDraft(); const keep = e && (r.value === 'REHIRE' ? e.status === 'INACTIVE' : e.status !== 'INACTIVE'); M.type = r.value; if (!keep) M.userId = null; M.draft = { reason: M.draft.reason, notes: M.draft.notes }; renderMove(); }; });
    $$('[data-pp-pick]').forEach(btn => { btn.onclick = () => { M.userId = btn.dataset.ppPick; M.draft = {}; renderMove(); }; });
    const pc = $('[data-pp-pick-clear]'); if (pc) pc.onclick = () => { M.userId = null; renderMove(); };
    const pq = $('#ppPickQ'); if (pq) { pq.oninput = () => { M.search = pq.value; renderMove(); const n = $('#ppPickQ'); n.focus(); n.setSelectionRange(M.search.length, M.search.length); }; if (!M.search) setTimeout(() => pq.focus(), 30); }
    const md = $('#ppMDept'); if (md) md.onchange = () => { saveMoveDraft(); M.draft.department_id = md.value; M.draft.position_id = null; renderMove(); };
    const mp = $('#ppMPos'); if (mp) mp.onchange = () => { saveMoveDraft(); drawCompare(e); };
    const ms = $('#ppMSite'); if (ms) ms.oninput = () => drawCompare(e);
    const lwd = $('#ppMLwd'); if (lwd) lwd.onchange = () => { saveMoveDraft(); renderMove(); };
    $$('input[name=ppMEval], input[name=ppMNt]').forEach(r => { r.onchange = () => { saveMoveDraft(); renderMove(); }; });
    drawCompare(e);
    const draftBtn = $('#ppMDraft'); if (draftBtn) draftBtn.onclick = () => submitMove(draftBtn, false);
    const subBtn = $('#ppMSubmit'); if (subBtn) subBtn.onclick = () => submitMove(subBtn, true);
  }
  function drawCompare(e) {
    const cmp = $('#ppMCompare'); if (!cmp || !e) return;
    const p = positionById($('#ppMPos')?.value);
    const site = $('#ppMSite')?.value.trim() || e.site || '—';
    const row = (k, a, b) => `<div>${k}</div><div>${esc(a)}</div><div class="arr">→</div><div class="${a !== b ? 'chg' : ''}">${esc(b)}</div>`;
    cmp.innerHTML = '<div class="h">Data</div><div class="h">Sekarang</div><div class="h arr"></div><div class="h">Menjadi</div>'
      + row('Departemen', e.departemen || '—', p?.department_name || '—') + row('Jabatan', e.jabatan || '—', p?.name || '—') + row('Site', e.site || '—', site);
  }
  function saveMoveDraft() {
    const D = M.draft; const v = id => { const el = $(id); return el ? el.value : undefined; };
    const set = (k, val) => { if (val !== undefined) D[k] = val; };
    set('department_id', v('#ppMDept')); set('position_id', v('#ppMPos')); set('site', v('#ppMSite')); set('effective_date', v('#ppMEff'));
    set('last_working_day', v('#ppMLwd')); set('probation_end_date', v('#ppMProb')); set('contract_no', v('#ppMCno'));
    set('contract_start_date', v('#ppMCstart')); set('contract_end_date', v('#ppMCend')); set('reason', v('#ppMReason')); set('notes', v('#ppMNotes'));
    const rh = $('input[name=ppMRh]:checked'); if (rh) D.rehire_eligible = rh.value === 'true';
    const ev = $('input[name=ppMEval]:checked'); if (ev) D.evaluation_result = ev.value;
    const nt = $('input[name=ppMNt]:checked'); if (nt) D.employment_type = nt.value;
    const mt = $('#ppMType'); if (mt) D.employment_type = mt.value;
  }
  function submitMove(button, submit) {
    saveMoveDraft();
    const D = M.draft; const grp = groupOfType(M.type);
    const msg = $('#ppMMsg');
    if (!D.reason || D.reason.trim().length < 3) { showMsg(msg, 'Alasan wajib diisi (minimal 3 karakter).'); $('#ppMReason')?.focus(); return; }
    const payload = { movement_type: M.type, employee_id: M.userId, reason: D.reason.trim(), notes: (D.notes || '').trim() || null };
    if (grp === 'KELUAR') { payload.last_working_day = D.last_working_day; payload.rehire_eligible = D.rehire_eligible !== false; }
    else payload.effective_date = D.effective_date || D.contract_start_date;
    if (grp === 'PENEMPATAN' || M.type === 'REHIRE') {
      if (!D.position_id) { showMsg(msg, 'Pilih jabatan tujuan dari master.'); return; }
      payload.after_state = { position_id: D.position_id, department_id: D.department_id, site: (D.site || '').trim() || undefined };
      if (M.type === 'REHIRE') payload.after_state.employment_type = D.employment_type || 'PKWT';
    }
    if (M.type === 'CONFIRMATION') { payload.evaluation_result = D.evaluation_result || 'PASSED'; if (payload.evaluation_result === 'EXTENDED') payload.after_state = { probation_end_date: D.probation_end_date }; }
    if (M.type === 'CONTRACT_RENEWAL') { payload.contract_no = D.contract_no || null; payload.contract_start_date = D.contract_start_date; payload.contract_end_date = D.contract_end_date; payload.effective_date = D.contract_start_date; }
    if (M.type === 'EMPLOYMENT_TYPE_CHANGE') { payload.after_state = { employment_type: D.employment_type }; payload.contract_end_date = D.contract_end_date || null; payload.contract_no = D.contract_no || null; }
    run(button, async () => {
      const created = await apiSend(`${WF}/movements`, 'POST', payload, { 'Idempotency-Key': idem() });
      if (submit) await apiSend(`${WF}/movements/${encodeURIComponent(created.movement.id)}/transition`, 'POST', { status: 'SUBMITTED' });
      closeL1(); M = null;
      toast(submit ? `Diajukan ke approver · ${created.movement.movement_no}` : `Draft disimpan · ${created.movement.movement_no}`);
      S.mov.view = submit ? 'approval' : 'draft';
      await refreshAll();
    }).catch(err => showMsg(msg, err.message));
  }

  // ------------------------------------------------------------------ PENGINGAT
  function renderReminders() {
    const pane = $('#ppPane-pengingat');
    const r = S.data.reminders;
    if (!r) { pane.innerHTML = loading(); return; }
    const by = k => r.items.filter(i => i.kind === k);
    const card = (title, sub, items, render) => `<div class="pp-card"><div class="pp-card-h"><div><h3>${title}</h3><p>${sub}</p></div><span class="pp-count ${items.length ? 'warn' : ''}">${items.length}</span></div>
      ${items.length ? items.map(render).join('') : '<div class="pp-empty" style="padding:16px">Tidak ada.</div>'}</div>`;
    const days = i => `<div class="pp-days ${i.days != null && i.days <= 14 ? 'danger' : i.days != null && i.days <= 30 ? 'warn' : ''}">${i.days == null ? '—' : i.days < 0 ? `Lewat ${Math.abs(i.days)} hari` : i.days === 0 ? 'Hari ini' : `${i.days} hari`}</div>`;
    const row = (i, line, action) => `<div class="pp-rem"><div><button type="button" class="pp-linkbtn" style="padding:0;color:inherit;font-weight:500" data-pp-emp="${esc(i.user_id)}">${esc(i.nama)}</button><span class="sub">${line}</span>${action}</div>${days(i)}</div>`;
    pane.innerHTML = `${r.counts.pending_approval ? `<div class="pp-preview warn" style="margin-bottom:10px"><i class="ti ti-clock"></i><div>${r.counts.pending_approval} pengajuan pergerakan menunggu persetujuan. <button type="button" class="pp-linkbtn" data-pp-tab="pergerakan">Buka Pergerakan</button></div></div>` : ''}
      <div class="pp-rem-grid">
      ${card('Kontrak berakhir', 'H-60 sampai lewat tanggal, belum ada pengajuan', by('CONTRACT_END'), i => row(i, `${esc(i.jabatan || '—')} · ${esc(TYPE_KERJA[i.employment_type] || i.employment_type || '')} s/d ${fmt(i.date)}`,
        `<span class="sub"><button type="button" class="pp-linkbtn" style="padding:0" data-pp-move="CONTRACT_RENEWAL" data-pp-emp="${esc(i.user_id)}">Perpanjang</button> · <button type="button" class="pp-linkbtn" style="padding:0" data-pp-move="CONTRACT_END" data-pp-emp="${esc(i.user_id)}">Akhiri kontrak</button></span>`))}
      ${card('Probation berakhir', 'H-30 sampai lewat tanggal, belum ada keputusan', by('PROBATION_END'), i => row(i, `${esc(i.jabatan || '—')} · probation s/d ${fmt(i.date)}`,
        `<span class="sub"><button type="button" class="pp-linkbtn" style="padding:0" data-pp-move="CONFIRMATION" data-pp-emp="${esc(i.user_id)}">Catat hasil probation</button></span>`))}
      ${card('Dokumen &amp; sertifikat kedaluwarsa', 'Berlaku ≤ 60 hari lagi atau sudah lewat', by('DOCUMENT_EXPIRY'), i => row(i, `${esc(i.title)} · s/d ${fmt(i.date)}`,
        `<span class="sub"><button type="button" class="pp-linkbtn" style="padding:0" data-pp-emp="${esc(i.user_id)}" data-pp-emp-sub="dokumen">Unggah yang baru</button></span>`))}
      ${card('Keluar terjadwal', 'Akun nonaktif otomatis sehari setelah hari terakhir', by('NOTICE'), i => row(i, `${esc(TYPE_LABEL[i.movement_type] || 'Keluar')} · hari kerja terakhir ${fmt(i.date)}`,
        i.open_tasks ? `<span class="sub" style="color:var(--pp-warning)">${i.open_tasks} checklist offboarding belum selesai</span>` : '<span class="sub" style="color:var(--pp-success)">Checklist offboarding selesai</span>'))}
      </div>`;
  }

  // ------------------------------------------------------------------ SETUP master
  function renderSetup() {
    const pane = $('#ppPane-setup');
    const depts = departments(false);
    const st = S.data.settings || {};
    pane.innerHTML = `<div class="pp-setup-grid">
      <div class="pp-card"><div class="pp-card-h"><div><h3>Departemen &amp; jabatan</h3><p>Satu-satunya sumber pilihan jabatan untuk tambah karyawan, pergerakan, import, Cuti, Roster, dan HSE.</p></div><button type="button" class="pp-btn sm primary" data-pp-dept-add><i class="ti ti-plus"></i>Departemen</button></div>
        <div class="pp-card-b">${depts.length ? depts.map(d => `<div class="pp-dept ${d.is_active ? '' : 'off'}"><div class="top"><span><b>${esc(d.name)}</b>${d.is_active ? '' : ' <span class="pp-chip muted">nonaktif</span>'}</span><span class="pp-hint" style="margin:0">${d.active_employees} aktif · ${d.positions.length} jabatan <button type="button" class="pp-linkbtn" data-pp-dept-edit="${esc(d.id)}">Ubah</button></span></div>
          <div class="jabs">${d.positions.map(p => `<button type="button" class="pp-chip pp-jab ${p.is_active ? '' : 'off'}" data-pp-pos-edit="${esc(p.id)}" title="Ubah jabatan">${esc(p.name)} <b style="font-weight:500">${p.active_employees}</b>${p.is_critical ? ' <i class="ti ti-alert-triangle" title="Kritis"></i>' : ''}</button>`).join('')}${d.is_active ? `<button type="button" class="pp-linkbtn" data-pp-pos-add="${esc(d.id)}">+ Jabatan</button>` : ''}</div></div>`).join('') : '<div class="pp-empty">Belum ada departemen.</div>'}
          <div class="pp-hint" style="margin:0"><i class="ti ti-info-circle"></i> Jabatan yang masih dipakai tidak bisa dinonaktifkan. Mengganti nama ikut memperbarui karyawan pemegang jabatan; aturan Cuti/Roster/HSE merujuk ke ID jabatan.</div></div></div>
      <div style="display:grid;gap:10px">
        <div class="pp-card"><div class="pp-card-h"><div><h3>Pola NRP &amp; probation</h3><p>NRP dibuat otomatis saat menambah karyawan, tetap bisa diisi manual.</p></div></div>
          <div class="pp-card-b">
            <div class="pp-fld"><label class="lb" for="ppNrpPattern">Pola</label><input type="text" id="ppNrpPattern" value="${esc(st.nrp_pattern || '')}" ${isSuper() ? '' : 'disabled'}></div>
            <div><div class="pp-group-title">Contoh NRP berikutnya</div><div class="pp-nrp-prev" id="ppNrpPrev">${esc(st.nrp_next_preview || '')}</div></div>
            <div class="pp-hint" style="margin:0">Token: {YYYY}/{YY} tahun masuk, {MM} bulan masuk, {SEQ3}–{SEQ6} nomor urut. NRP tidak dipakai ulang walau karyawan keluar.</div>
            <div class="pp-fld"><label class="lb" for="ppProbMonths">Lama probation default (bulan)</label><input type="number" id="ppProbMonths" min="0" max="12" value="${esc(st.probation_months ?? 3)}" ${isSuper() ? '' : 'disabled'} style="max-width:120px"></div>
            <label class="pp-switch"><span>Wajibkan checklist selesai sebelum status Efektif<span class="d">Kalau mati, sistem hanya memberi peringatan.</span></span><input type="checkbox" id="ppReqChecklist" ${st.require_checklist_before_effective ? 'checked' : ''} ${isSuper() ? '' : 'disabled'}></label>
            <label class="pp-switch"><span>Admin Utama boleh menyetujui pengajuannya sendiri<span class="d">Wajib dengan alasan tertulis. Untuk site dengan admin HR tunggal.</span></span><input type="checkbox" id="ppSelfApprove" ${st.allow_super_admin_self_approval ? 'checked' : ''} ${isSuper() ? '' : 'disabled'}></label>
            ${isSuper() ? '<div style="display:flex;justify-content:flex-end"><button type="button" class="pp-btn primary sm" id="ppSettingsSave">Simpan pengaturan</button></div>' : '<div class="pp-hint" style="margin:0"><i class="ti ti-lock"></i> Hanya Admin Utama yang bisa mengubah pengaturan ini.</div>'}
            <div id="ppSettingsMsg" hidden></div>
          </div></div>
        <div class="pp-card"><div class="pp-card-h"><div><h3>Checklist otomatis</h3><p>Dibuat per jenis pergerakan.</p></div></div>
          <div class="pp-card-b" style="font-size:12px">
            <div><div class="pp-group-title">Onboarding (Masuk/Rehire)</div><div class="pp-fchips"><span class="pp-chip">MCU</span><span class="pp-chip">Safety induction</span><span class="pp-chip">APD</span><span class="pp-chip">ID card &amp; akses site</span></div></div>
            <div><div class="pp-group-title">Offboarding (Keluar)</div><div class="pp-fchips"><span class="pp-chip">Cabut akses</span><span class="pp-chip">Pengembalian aset/APD</span><span class="pp-chip">Final settlement</span><span class="pp-chip">Arsip wajah</span></div></div>
          </div></div>
      </div></div>`;
    const pat = $('#ppNrpPattern');
    if (pat) pat.oninput = () => { $('#ppNrpPrev').textContent = previewNrp(pat.value); };
    const save = $('#ppSettingsSave');
    if (save) save.onclick = () => run(save, async () => {
      S.data.settings = await apiSend(`${API}/settings`, 'PUT', {
        nrp_pattern: pat.value.trim(), probation_months: Number($('#ppProbMonths').value),
        require_checklist_before_effective: $('#ppReqChecklist').checked, allow_super_admin_self_approval: $('#ppSelfApprove').checked,
      });
      showMsg($('#ppSettingsMsg'), ''); renderSetup(); toast('Pengaturan disimpan');
    }).catch(err => showMsg($('#ppSettingsMsg'), err.message));
  }
  function previewNrp(pattern) {
    const t = todayIso(); const [y, m] = t.split('-');
    if (!/\{SEQ[3-6]\}/.test(pattern)) return 'Pola wajib memuat {SEQ3}–{SEQ6}';
    const seq = Number(String(S.data.settings?.nrp_next_preview || '').match(/(\d+)$/)?.[1] || 1);
    return pattern.replace(/\{YYYY\}/g, y).replace(/\{YY\}/g, y.slice(2)).replace(/\{MM\}/g, m).replace(/\{SEQ([3-6])\}/g, (_, n) => String(seq).padStart(Number(n), '0'));
  }
  function openDeptForm(deptId) {
    const d = deptId ? departments(false).find(x => x.id === deptId) : null;
    modal(L2(), {
      title: d ? `Ubah departemen · ${esc(d.name)}` : 'Tambah departemen', sub: 'Langsung tersedia di filter Direktori, Tambah karyawan, Pergerakan, dan template import.',
      body: `<div class="pp-fld"><label class="lb" for="ppDName">Nama departemen <em>*</em></label><input type="text" id="ppDName" value="${esc(d?.name || '')}" placeholder="mis. Plant, Mine Control, Security"></div>
        ${d ? `<label class="pp-switch"><span>Aktif<span class="d">Departemen nonaktif tidak muncul di pilihan baru. Ditolak bila masih ada karyawan aktif.</span></span><input type="checkbox" id="ppDActive" ${d.is_active ? 'checked' : ''}></label>`
          : '<div class="pp-fld"><label class="lb" for="ppDJabs">Jabatan awal</label><input type="text" id="ppDJabs" placeholder="Pisahkan dengan koma, mis. Security Officer, Komandan Regu"><div class="pp-hint">Opsional. Bisa ditambah nanti lewat "+ Jabatan".</div></div>'}
        <div id="ppDMsg" hidden></div>`,
      foot: `<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppDSave">Simpan departemen</button>`,
    });
    const save = () => {
      const name = $('#ppDName').value.trim().replace(/\s+/g, ' ');
      if (!name) { showMsg($('#ppDMsg'), 'Nama departemen wajib diisi.'); return; }
      run($('#ppDSave'), async () => {
        if (d) await apiSend(`${API}/org/departments/${encodeURIComponent(d.id)}`, 'PATCH', { name, is_active: $('#ppDActive').checked });
        else {
          const positions = [...new Set($('#ppDJabs').value.split(',').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean))].map(n => ({ name: n }));
          await apiSend(`${API}/org/departments`, 'POST', { name, positions });
        }
        closeL2(); await refreshAll(); toast(d ? 'Departemen diperbarui' : `Departemen ${name} ditambahkan`);
      }).catch(err => showMsg($('#ppDMsg'), err.message));
    };
    $('#ppDSave').onclick = save;
    $('#ppDName').onkeydown = ev => { if (ev.key === 'Enter') save(); };
  }
  function openPosForm(deptId, posId) {
    const p = posId ? positionById(posId) : null;
    const d = departments(false).find(x => x.id === (p ? p.department_id : deptId));
    modal(L2(), {
      title: p ? `Ubah jabatan · ${esc(p.name)}` : `Tambah jabatan · ${esc(d?.name || '')}`, sub: p ? `${p.active_employees} karyawan aktif memegang jabatan ini.` : 'Jabatan baru langsung bisa dipilih di form karyawan, pergerakan, dan template import.',
      body: `<div class="pp-fld"><label class="lb" for="ppJName">Nama jabatan <em>*</em></label><input type="text" id="ppJName" value="${esc(p?.name || '')}"></div>
        <div class="pp-row2"><div class="pp-fld"><label class="lb">Fungsi (untuk modul lain)</label><select id="ppJTag">${Object.entries(FUNCTION_TAGS).map(([k, v]) => `<option value="${k}" ${(p?.function_tag || '') === k ? 'selected' : ''}>${v}</option>`).join('')}</select><div class="pp-hint">Dipakai Produksi/HSE untuk mengenali operator, pengawas, dll.</div></div>
          <div class="pp-fld" style="display:grid;gap:8px;align-content:start;padding-top:20px"><label class="pp-check"><input type="checkbox" id="ppJCrit" ${p?.is_critical ? 'checked' : ''}><span>Jabatan kritis<span class="d">Ditandai di MPP bila kosong.</span></span></label>
          ${p ? `<label class="pp-check"><input type="checkbox" id="ppJActive" ${p.is_active ? 'checked' : ''}><span>Aktif<span class="d">Tidak bisa dinonaktifkan selama masih dipegang karyawan.</span></span></label>` : ''}</div></div>
        <div id="ppJMsg" hidden></div>`,
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppJSave">Simpan jabatan</button>',
    });
    const save = () => {
      const name = $('#ppJName').value.trim().replace(/\s+/g, ' ');
      if (!name) { showMsg($('#ppJMsg'), 'Nama jabatan wajib diisi.'); return; }
      const body = { name, is_critical: $('#ppJCrit').checked, function_tag: $('#ppJTag').value || null };
      run($('#ppJSave'), async () => {
        let res;
        if (p) res = await apiSend(`${API}/org/positions/${encodeURIComponent(p.id)}`, 'PATCH', { ...body, is_active: $('#ppJActive').checked });
        else res = await apiSend(`${API}/org/positions`, 'POST', { ...body, department_id: d.id });
        closeL2(); await refreshAll();
        toast(res?.warning || (p ? 'Jabatan diperbarui' : `Jabatan ${name} ditambahkan ke ${d.name}`), Boolean(res?.warning));
      }).catch(err => showMsg($('#ppJMsg'), err.message));
    };
    $('#ppJSave').onclick = save;
    $('#ppJName').onkeydown = ev => { if (ev.key === 'Enter') save(); };
  }

  // ------------------------------------------------------------------ IMPORT Excel
  let I = null;
  function openImport() {
    I = { step: 'upload', preview: null, filter: 'ALL', mappings: { positions: {}, locations: {} }, remember: true, invites: true, history: null, result: null };
    renderImport();
    apiCall(`${API}/import/batches?limit=10`).then(rows => { if (I) { I.history = rows; if (I.step === 'upload') renderImport(); } }).catch(() => {});
  }
  function renderImport() {
    if (!I) return;
    let body = ''; let foot = '';
    if (I.step === 'upload') {
      body = `<div class="pp-imp-steps">
          <div class="pp-imp-step"><b>1. Unduh template</b><span class="pp-hint" style="margin:0">Dropdown Departemen · Jabatan dan Lokasi diambil dari master saat ini.</span><button type="button" class="pp-btn sm" id="ppImpTpl"><i class="ti ti-download"></i>Template .xlsx</button></div>
          <div class="pp-imp-step"><b>2. Isi kolom wajib</b><span class="pp-hint" style="margin:0">Nama, email, Departemen · Jabatan, tanggal masuk, status kerja, lokasi absen. Lainnya boleh menyusul.</span></div>
          <div class="pp-imp-step"><b>3. Unggah &amp; cek</b><span class="pp-hint" style="margin:0">OMOS mensimulasikan dulu. Tidak ada yang tersimpan sebelum Anda menekan Simpan.</span><label class="pp-btn sm primary"><i class="ti ti-upload"></i>Pilih file .xlsx<input type="file" id="ppImpFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="pp-file-input"></label></div>
        </div>
        <div id="ppImpMsg" hidden></div>
        <div><div class="pp-sec-title">Riwayat import</div>${I.history == null ? '<div class="pp-hint" style="margin:0">Memuat…</div>' : I.history.length ? `<div class="pp-tbl-wrap"><table class="pp-tbl" style="min-width:640px"><thead><tr><th>File</th><th>Waktu</th><th>Baris</th><th>Disimpan</th><th>Status</th><th></th></tr></thead><tbody>${I.history.map(b => `<tr><td>${esc(b.file_name)}<span class="sub">oleh ${esc(b.created_by_name || '—')}</span></td><td>${fmtTime(b.created_at)}</td><td>${b.total_rows}</td><td>${b.committed_rows}</td><td><span class="pp-chip ${{ COMMITTED: 'success', PARTIAL: 'warning', VOIDED: 'muted', CANCELLED: 'muted', VALIDATED: 'accent' }[b.status] || ''}">${esc({ COMMITTED: 'Tersimpan', PARTIAL: 'Sebagian', VOIDED: 'Di-Void', CANCELLED: 'Dibatalkan', VALIDATED: 'Simulasi' }[b.status] || b.status)}</span></td><td class="act">${['COMMITTED', 'PARTIAL'].includes(b.status) ? `<button type="button" class="pp-btn sm danger" data-pp-imp-void="${esc(b.id)}">Void batch</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="pp-hint" style="margin:0">Belum ada import.</div>'}</div>`;
      foot = '<button type="button" class="pp-btn" data-pp-close>Tutup</button>';
    } else if (I.step === 'preview') {
      const p = I.preview; const s = p.batch.summary;
      const rows = p.rows.filter(r => I.filter === 'ALL' || r.status === I.filter);
      const ready = s.valid + s.warning;
      const unknown = [...p.unknown.positions.map(u => ['positions', u]), ...p.unknown.locations.map(u => ['locations', u])];
      body = `<div class="pp-imp-sum"><span class="pp-chip">${s.total} baris</span><span class="pp-chip success">${s.valid} siap</span><span class="pp-chip warning">${s.warning} perlu dicek</span><span class="pp-chip danger">${s.error} error</span><span class="pp-hint" style="margin:0 0 0 auto">${esc(p.batch.file_name)}</span></div>
        ${p.notices.map(n => `<div class="pp-preview warn"><i class="ti ti-alert-triangle"></i><div>${esc(n)}</div></div>`).join('')}
        ${unknown.length ? `<div class="pp-card" style="padding:10px 12px"><div class="pp-sec-title" style="margin-bottom:2px">Nilai yang tidak ada di master <span class="pp-hint" style="margin:0">Pilih padanannya — tidak pernah ditebak otomatis</span></div>
          ${unknown.map(([kind, u]) => {
            const opts = kind === 'positions' ? p.master.positions : p.master.locations.map(l => ({ id: l.id, label: l.label }));
            const sel = I.mappings[kind][u.raw] || '';
            const sugg = new Set(u.suggestions.map(x => x.id));
            return `<div class="pp-imp-map"><div><b style="font-weight:500">${esc(u.raw)}</b><span class="sub">${kind === 'positions' ? 'Departemen · Jabatan' : 'Lokasi'} · baris ${u.rows.slice(0, 6).join(', ')}${u.rows.length > 6 ? '…' : ''} (${u.rows.length})</span></div><i class="ti ti-arrow-right" style="color:var(--pp-muted)"></i>
              <select data-pp-imp-map="${kind}" data-raw="${esc(u.raw)}"><option value="">— Biarkan error / perbaiki di Excel —</option>${u.suggestions.length ? `<optgroup label="Saran terdekat">${u.suggestions.map(x => `<option value="${esc(x.id)}" ${sel === x.id ? 'selected' : ''}>${esc(x.label)} (${Math.round(x.score * 100)}%)</option>`).join('')}</optgroup>` : ''}<optgroup label="Semua">${opts.filter(o => !sugg.has(o.id)).map(o => `<option value="${esc(o.id)}" ${sel === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</optgroup></select></div>`;
          }).join('')}
          <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:8px;flex-wrap:wrap"><label class="pp-check"><input type="checkbox" id="ppImpRemember" ${I.remember ? 'checked' : ''}><span>Ingat padanan untuk import berikutnya</span></label><button type="button" class="pp-btn sm primary" id="ppImpApply">Terapkan padanan</button></div></div>` : ''}
        <div class="pp-seg">${[['ALL', 'Semua', s.total], ['ERROR', 'Error', s.error], ['WARNING', 'Perlu dicek', s.warning], ['VALID', 'Siap', s.valid]].map(([k, l, n]) => `<button type="button" class="${I.filter === k ? 'on' : ''}" data-pp-imp-filter="${k}">${l} <span class="pp-count">${n}</span></button>`).join('')}</div>
        <div class="pp-imp-rows"><table class="pp-tbl"><thead><tr><th>Baris</th><th>Karyawan</th><th>Departemen · Jabatan</th><th>Lokasi</th><th>Masuk · status</th><th>Hasil cek</th></tr></thead><tbody>
          ${rows.length ? rows.map(r => `<tr><td>${r.row_no}</td><td>${esc(r.nama || '—')}<span class="sub">${esc(r.email || '—')}</span></td><td>${esc(r.posisi || '—')}</td><td>${esc((r.lokasi || []).join(', ') || '—')}</td><td>${r.hire_date ? fmt(r.hire_date) : '—'}<span class="sub">${esc(TYPE_KERJA[r.employment_type] || r.employment_type || '')}</span></td>
            <td><span class="pp-chip ${{ VALID: 'success', WARNING: 'warning', ERROR: 'danger' }[r.status]}">${{ VALID: 'Siap', WARNING: 'Perlu dicek', ERROR: 'Error' }[r.status]}</span><div class="msgs">${r.messages.map(m => `<span class="${m.level === 'error' ? 'e' : 'w'}">${esc(m.text)}</span>`).join('')}</div></td></tr>`).join('') : '<tr><td colspan="6"><div class="pp-empty">Tidak ada baris.</div></td></tr>'}
        </tbody></table></div>
        <label class="pp-check"><input type="checkbox" id="ppImpInvite" ${I.invites ? 'checked' : ''}><span>Kirim undangan membuat password ke email karyawan<span class="d">Tanpa centang, karyawan bisa meminta kode lewat Lupa password.</span></span></label>
        <div id="ppImpMsg" hidden></div>`;
      foot = `<span class="pp-sod">Baris error dilewati. Email/NIK/NRP yang sudah ada tidak dibuat ulang.</span><button type="button" class="pp-btn" id="ppImpCancel">Batalkan</button><button type="button" class="pp-btn primary" id="ppImpCommit" ${ready ? '' : 'disabled'}>Simpan ${ready} karyawan</button>`;
    } else {
      const r = I.result;
      body = `<div class="pp-preview ${r.failed ? 'warn' : ''}"><i class="ti ${r.failed ? 'ti-alert-triangle' : 'ti-circle-check'}"></i><div><b>${r.committed} karyawan tersimpan</b>${r.skipped ? ` · ${r.skipped} baris error dilewati` : ''}${r.failed ? ` · ${r.failed} gagal disimpan` : ''}${r.invites_sent ? ` · ${r.invites_sent} undangan terkirim` : ''}${r.invites_failed ? ` · ${r.invites_failed} undangan gagal` : ''}.</div></div>
        ${r.results.filter(x => x.status === 'ERROR').map(x => `<div class="pp-msg">Baris ${x.row_no}: ${esc(x.error)}</div>`).join('')}
        <div class="pp-hint" style="margin:0">Lengkapi foto wajah, CV, dan data keluarga dari profil masing-masing. Salah file? Void batch dari riwayat import (hanya karyawan yang belum punya transaksi).</div>`;
      foot = '<button type="button" class="pp-btn primary" data-pp-close>Selesai</button>';
    }
    L1().innerHTML = `<div class="pp-overlay" data-pp-close><div class="pp-modal xwide" role="dialog" aria-modal="true" aria-label="Import karyawan">
      <div class="pp-m-head"><div><h2>Import karyawan dari Excel</h2><p>Untuk menambah banyak karyawan sekaligus. Jabatan dan lokasi harus sudah ada di master.</p></div><button type="button" class="pp-icon-btn" data-pp-close aria-label="Tutup"><i class="ti ti-x"></i></button></div>
      <div class="pp-m-body">${body}</div><div class="pp-m-foot">${foot}</div></div></div>`;
    const tpl = $('#ppImpTpl');
    if (tpl) tpl.onclick = () => run(tpl, async () => {
      const blob = await fetchBlob(`${API}/import/template`);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `template_import_karyawan_${todayIso()}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, { loadingText: 'Menyiapkan…', successText: 'Terunduh' }).catch(err => showMsg($('#ppImpMsg'), err.message));
    const file = $('#ppImpFile');
    if (file) file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      if (!/\.xlsx$/i.test(f.name)) { showMsg($('#ppImpMsg'), 'File harus .xlsx (unduh template di langkah 1).'); return; }
      if (f.size > 5 * 1024 * 1024) { showMsg($('#ppImpMsg'), 'Ukuran file maksimal 5 MB.'); return; }
      const label = file.closest('label');
      const fd = new FormData(); fd.append('file', f, f.name);
      try {
        if (label) { label.classList.add('omos-action-feedback--busy'); label.firstChild.nextSibling && (label.childNodes[1].textContent = 'Memeriksa…'); }
        I.preview = await apiCall(`${API}/import/preview`, { method: 'POST', body: fd });
        I.step = 'preview'; I.filter = I.preview.batch.summary.error ? 'ERROR' : 'ALL'; I.mappings = { positions: {}, locations: {} };
        renderImport();
      } catch (error) { renderImport(); showMsg($('#ppImpMsg'), error.message); }
    };
    $$('[data-pp-imp-map]').forEach(sel => { sel.onchange = () => { I.mappings[sel.dataset.ppImpMap][sel.dataset.raw] = sel.value; }; });
    $$('[data-pp-imp-filter]').forEach(b => { b.onclick = () => { I.filter = b.dataset.ppImpFilter; renderImport(); }; });
    const rem = $('#ppImpRemember'); if (rem) rem.onchange = () => { I.remember = rem.checked; };
    const inv = $('#ppImpInvite'); if (inv) inv.onchange = () => { I.invites = inv.checked; };
    const apply = $('#ppImpApply');
    if (apply) apply.onclick = () => run(apply, async () => {
      I.preview = await apiSend(`${API}/import/${encodeURIComponent(I.preview.batch.id)}/mappings`, 'POST', { ...I.mappings, remember: I.remember });
      if (I.remember) loadBase().catch(() => {});
      renderImport();
    }, { successText: 'Diterapkan' }).catch(err => showMsg($('#ppImpMsg'), err.message));
    const cancel = $('#ppImpCancel');
    if (cancel) cancel.onclick = () => run(cancel, async () => {
      await apiSend(`${API}/import/${encodeURIComponent(I.preview.batch.id)}/cancel`, 'POST', {});
      openImport();
    }, { successText: 'Dibatalkan' }).catch(err => showMsg($('#ppImpMsg'), err.message));
    const commit = $('#ppImpCommit');
    if (commit) commit.onclick = () => run(commit, async () => {
      I.result = await apiSend(`${API}/import/${encodeURIComponent(I.preview.batch.id)}/commit`, 'POST', { send_invites: I.invites });
      I.step = 'done'; renderImport(); await refreshAll();
    }, { loadingText: 'Menyimpan…' }).catch(err => showMsg($('#ppImpMsg'), err.message));
  }
  function openImportVoid(batchId) {
    modal(L2(), {
      title: 'Void batch import', sub: 'Semua karyawan dari batch ini di-Void — kecuali yang sudah punya absensi/payroll (tetap dipertahankan).',
      body: '<div class="pp-fld"><label class="lb">Alasan <em>*</em></label><input type="text" id="ppIvReason" placeholder="mis. salah file, data dobel"></div><div id="ppIvMsg" hidden></div>',
      foot: '<button type="button" class="pp-btn" data-pp-close>Batal</button><button type="button" class="pp-btn primary" id="ppIvSave" style="background:var(--pp-danger-fill);border-color:var(--pp-danger-fill)">Void batch</button>',
    });
    $('#ppIvSave').onclick = () => {
      const reason = $('#ppIvReason').value.trim();
      if (reason.length < 5) { showMsg($('#ppIvMsg'), 'Alasan minimal 5 karakter.'); return; }
      run($('#ppIvSave'), async () => {
        const r = await apiSend(`${API}/import/${encodeURIComponent(batchId)}/void`, 'POST', { reason });
        closeL2(); toast(`${r.voided} karyawan di-Void${r.kept ? ` · ${r.kept} dipertahankan karena sudah ada transaksi` : ''}`, Boolean(r.kept));
        await refreshAll(); openImport();
      }).catch(err => showMsg($('#ppIvMsg'), err.message));
    };
  }

  // ------------------------------------------------------------------ event delegation
  document.addEventListener('click', ev => {
    const inPeople = ev.target.closest('#peopleRoot, #ppLayer, #ppLayer2');
    if (!inPeople) return;
    const el = ev.target.closest('button, a, tr[data-pp-emp], [data-pp-close]');
    if (!el) return;
    const ds = el.dataset;
    if (el.hasAttribute('data-pp-close')) {
      if ((el.classList.contains('pp-overlay') || el.classList.contains('pp-drawer-wrap')) && ev.target !== el) return;
      if (el.closest('#ppLayer2')) closeL2();
      else { closeL1(); W = null; M = null; I = null; }
      return;
    }
    if (ds.ppTab) { closeL1(); showTab(ds.ppTab); return; }
    if (ds.ppAct === 'add') return openWizard();
    if (ds.ppAct === 'move') return openMove(null, 'TRANSFER');
    if (ds.ppAct === 'export') return exportCsv();
    if (ds.ppAct === 'import') return openImport();
    if (ds.ppDstatus) { S.dir.status = ds.ppDstatus; reloadDirectory(false); return; }
    if (ds.ppView) { ev.stopPropagation(); openViewer(ds.ppView); return; }
    if (ds.ppUpload) { ev.stopPropagation(); openUpload(ds.ppEmp, ds.ppUpload); return; }
    if (ds.ppOpenDocs) { ev.stopPropagation(); openProfile(ds.ppOpenDocs, 'dokumen'); return; }
    if (ds.ppMove) { const uid = ds.ppEmp; closeL2(); openMove(uid, ds.ppMove); return; }
    if (ds.ppSub && S.profile) { S.profile.sub = ds.ppSub; renderProfile(); return; }
    if (ds.ppEmp && !ds.ppMove && !ds.ppUpload) { openProfile(ds.ppEmp, ds.ppEmpSub || 'ringkasan'); return; }
    if (el.hasAttribute('data-pp-reveal-nik')) return revealNik();
    if (el.hasAttribute('data-pp-edit-personal')) return openPersonalEdit();
    if (el.hasAttribute('data-pp-edit-loc')) return openLocationEdit();
    if (el.hasAttribute('data-pp-fam-edit')) return openFamilyEdit();
    if (el.hasAttribute('data-pp-void')) return openVoid();
    if (el.hasAttribute('data-pp-face')) return openFaceUpload();
    if (ds.ppDocDel) return openDocDelete(ds.ppDocDel);
    if (ds.ppMview) { S.mov.view = ds.ppMview; reloadMovements(); return; }
    if (ds.ppMtrans) return transition(el, ds.id, ds.ppMtrans);
    if (ds.ppMdetail) return openMovementDetail(ds.ppMdetail);
    if (el.hasAttribute('data-pp-dept-add')) return openDeptForm(null);
    if (ds.ppDeptEdit) return openDeptForm(ds.ppDeptEdit);
    if (ds.ppPosAdd) return openPosForm(ds.ppPosAdd, null);
    if (ds.ppPosEdit) return openPosForm(null, ds.ppPosEdit);
    if (ds.ppImpVoid) return openImportVoid(ds.ppImpVoid);
    if (ds.wstep) {
      collectWizard();
      const next = Number(ds.wstep);
      if (next > W.step) { const errs = wizardErrors(W.step); if (errs.length) { W.error = errs[0]; renderWizard(); return; } }
      W.error = ''; W.step = next; renderWizard(); return;
    }
    if (ds.wizDel) {
      collectWizard();
      if (ds.wizDel === 'face') W.face = null; else if (ds.wizDel === 'cv') W.cv = null; else W.comps.splice(Number(ds.idx), 1);
      renderWizard();
    }
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (L2().innerHTML) { closeL2(); return; }
      if (L1().innerHTML) { closeL1(); W = null; M = null; I = null; }
    }
    if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('#peopleRoot tr[data-pp-emp]')) openProfile(ev.target.dataset.ppEmp);
  });

  global.OMOSPeople = { load, openProfile, openMove, refresh: refreshAll, _state: S };
})(typeof window !== 'undefined' ? window : globalThis);
