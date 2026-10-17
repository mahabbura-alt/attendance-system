/* Tanya OMOS — panel tanya-jawab informasi data HSE (hanya-baca).
 * Backend: GET /ask/info, POST /ask, POST /ask/feedback. Lihat docs/RENCANA_TANYA_OMOS_HSE.md */
(function (global) {
  'use strict';

  const ESC = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const VIEW_TO_EXAMPLE = {
    overview: 'overview', reports: 'reports', hazard: 'hazards', incident: 'incidents', ptw: 'ptw', competency: 'competency',
  };
  const PAGE_NAV = {
    overview: { label: 'Ringkasan', view: 'overview' },
    hazards: { label: 'Hazard', view: 'hazard', hazardSubTab: 'hazards' },
    actions: { label: 'Tindakan (CAPA)', view: 'hazard', hazardSubTab: 'capa' },
    incidents: { label: 'Insiden', view: 'incident' },
    reports: { label: 'Laporan dan statistik', view: 'reports' },
    workhours: { label: 'Jam kerja (Setup)', view: 'setup', setupTab: 'workhours' },
    competency: { label: 'Kompetensi', view: 'competency' },
    ptw: { label: 'Izin kerja', view: 'ptw' },
    inspections: { label: 'Inspeksi', view: 'hazard', hazardSubTab: 'inspection' },
    'hazard-targets': { label: 'Target hazard (Setup)', view: 'setup', setupTab: 'hazard' },
    events: { label: 'Agenda P5M / Safety Talk', view: 'hazard', hazardSubTab: 'safetytalk' },
  };

  let info = null;      // hasil /ask/info
  let infoFor = null;   // token pengguna saat info dimuat
  let open = false;
  let busy = false;
  let thread = [];      // [{q, res}]
  let env = null;       // {api, host, getContext, navigate}
  let nodes = null;

  function exampleKey(view) { return VIEW_TO_EXAMPLE[view] || null; }

  function examplesFor(view, inf) {
    const i = inf || info || {};
    const k = exampleKey(view);
    const list = (k && i.examples && i.examples[k]) || i.generic_examples || [];
    return list.slice(0, 4);
  }

  function historyForRequest(t) {
    return (t || thread).filter(x => x.res && x.res.ok !== false).slice(-3).map(x => ({ q: x.q }));
  }

  function errorText(e) {
    if (!e) return 'Terjadi kesalahan. Coba lagi.';
    return e.message || 'Terjadi kesalahan. Coba lagi.';
  }

  function srcLine(s) {
    const f = s && s.filter && typeof s.filter === 'object' ? Object.entries(s.filter).filter(([, v]) => v !== '' && v != null && v !== false).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
    return `${ESC(s.label || s.tool)}${f ? ` <span class="ask-src-f">(${ESC(f)})</span>` : ''}${s.cached ? ' <span class="ask-src-f">· cache</span>' : ''}`;
  }

  function renderTable(t) {
    const d = t.data;
    const rows = Array.isArray(d) ? d : (d && Array.isArray(d.items) ? d.items : null);
    let body;
    if (rows && rows.length && typeof rows[0] === 'object') {
      const cols = Object.keys(rows[0]).slice(0, 8);
      body = `<table class="ask-tbl"><thead><tr>${cols.map(c => `<th>${ESC(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 20).map(r => `<tr>${cols.map(c => `<td>${ESC(typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else {
      body = `<pre class="ask-pre">${ESC(JSON.stringify(d, null, 1).slice(0, 1500))}</pre>`;
    }
    return `<div class="ask-tbl-wrap"><div class="ask-tbl-title">${ESC(t.label)}</div>${body}</div>`;
  }

  function renderResult(res, idx) {
    if (!res) return '';
    if (res.ok === false) {
      return `<div class="ask-msg ask-msg-err">${ESC(res.message || 'Asisten sedang tidak dapat menjawab. Coba lagi sebentar lagi.')}</div>`;
    }
    const nav = res.page && PAGE_NAV[res.page]
      ? `<button type="button" class="ask-link" data-ask-nav="${ESC(res.page)}">Buka di halaman ${ESC(PAGE_NAV[res.page].label)}</button>` : '';
    if (res.kind === 'OUT_OF_SCOPE' || res.kind === 'NO_DATA') {
      return `<div class="ask-msg ask-msg-info">${ESC(res.message)}</div>`;
    }
    const src = (res.sources || []).length
      ? `<div class="ask-src"><strong>Sumber:</strong> ${(res.sources).map(srcLine).join('; ')}</div>` : '';
    if (res.kind === 'RAW') {
      return `<div class="ask-msg ask-msg-warn">${ESC(res.message)}</div>${src}${(res.tables || []).map(renderTable).join('')}`;
    }
    const nums = (res.numbers || []).length
      ? `<ul class="ask-nums">${res.numbers.map(n => `<li><span>${ESC(n.label)}</span><strong>${ESC(n.value)}</strong></li>`).join('')}</ul>` : '';
    const fb = res.request_id
      ? `<span class="ask-fb"><button type="button" data-ask-fb="1" data-ask-i="${idx}" title="Membantu">👍</button><button type="button" data-ask-fb="-1" data-ask-i="${idx}" title="Kurang tepat">👎</button></span>` : '';
    return `<div class="ask-msg ask-msg-a">${ESC(res.answer).replace(/\n/g, '<br>')}</div>${nums}
      ${res.scope_note ? `<div class="ask-scope">${ESC(res.scope_note)}</div>` : ''}${src}
      <div class="ask-foot"><span class="ask-ai">${ESC(res.ai_label || 'Jawaban AI — cek sumbernya')}</span>${nav}${fb}</div>`;
  }

  function renderBody(view) {
    if (!info) return '<div class="ask-msg ask-msg-info">Memuat…</div>';
    if (!info.available) return `<div class="ask-msg ask-msg-info">${ESC(info.reason || 'Tanya OMOS belum aktif.')}</div>`;
    const ex = examplesFor(view);
    const th = thread.map((t, i) => `<div class="ask-q">${ESC(t.q)}</div>${t.pending ? '<div class="ask-msg ask-msg-info ask-wait">Sedang mencari datanya… (bisa sampai ±20 detik)</div>' : renderResult(t.res, i)}`).join('');
    const shadow = info.mode === 'SHADOW' ? '<div class="ask-scope">Mode uji — hanya Admin Utama yang melihat fitur ini.</div>' : '';
    return `${shadow}
      <div class="ask-thread" id="askThread">${th || '<div class="ask-hint">Tanyakan informasi dari data HSE. Saya hanya membaca, tidak mengubah data.</div>'}</div>
      ${!thread.length ? `<div class="ask-ex">${ex.map(e => `<button type="button" class="ask-chip" data-ask-ex="${ESC(e)}">${ESC(e)}</button>`).join('')}</div>` : ''}`;
  }

  function renderPanel(view) {
    const max = (info && info.limits && info.limits.max_question_chars) || 500;
    return `<div class="ask-head"><strong>Tanya OMOS</strong><span class="ask-head-sub">informasi data HSE · hanya-baca</span>
        <button type="button" class="ask-x" data-ask-close="1" aria-label="Tutup">×</button></div>
      <div class="ask-body">${renderBody(view)}</div>
      ${info && info.available ? `<form class="ask-form" id="askForm"><textarea id="askInput" maxlength="${max}" rows="2" placeholder="Tulis pertanyaan…" ${busy ? 'disabled' : ''}></textarea>
        <button type="submit" class="ask-send" ${busy ? 'disabled' : ''}>Kirim</button></form>` : ''}`;
  }

  async function ensureInfo() {
    const tok = (global.localStorage && global.localStorage.getItem('admin_token')) || '';
    if (info && infoFor === tok) return info;
    try { info = await env.api('/ask/info'); } catch (e) { info = { available: false, reason: null, hidden: true }; }
    infoFor = tok;
    return info;
  }

  function currentView() { return (env && env.getContext ? env.getContext() : {}).view; }

  function paint() {
    if (!nodes) return;
    const v = currentView();
    nodes.btn.hidden = !(info && info.available);
    nodes.panel.hidden = !open;
    if (open) { nodes.panel.innerHTML = renderPanel(v); bind(); const t = nodes.panel.querySelector('#askThread'); if (t) t.scrollTop = t.scrollHeight; }
  }

  async function submit(question) {
    const q = String(question || '').trim();
    if (!q || busy) return;
    const ctx = env.getContext ? env.getContext() : {};
    const history = historyForRequest();
    const entry = { q, pending: true, res: null };
    thread.push(entry); busy = true; paint();
    try {
      entry.res = await env.api('/ask', { method: 'POST', body: { question: q, context: { page: ctx.view, period: ctx.period || '', filter: ctx.filter || '' }, history } });
    } catch (e) {
      entry.res = { ok: false, message: errorText(e) };
    }
    entry.pending = false; busy = false; paint();
  }

  function navigateTo(page) {
    const n = PAGE_NAV[page];
    if (n && env.navigate) env.navigate(n);
  }

  function bind() {
    const p = nodes.panel;
    p.querySelector('[data-ask-close]')?.addEventListener('click', () => { open = false; paint(); });
    p.querySelector('#askForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const ta = p.querySelector('#askInput');
      submit(ta.value);
    });
    p.querySelector('#askInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.querySelector('#askForm').requestSubmit(); }
    });
    p.querySelectorAll('[data-ask-ex]').forEach(b => b.addEventListener('click', () => submit(b.dataset.askEx)));
    p.querySelectorAll('[data-ask-nav]').forEach(b => b.addEventListener('click', () => navigateTo(b.dataset.askNav)));
    p.querySelectorAll('[data-ask-fb]').forEach(b => b.addEventListener('click', async () => {
      const t = thread[Number(b.dataset.askI)];
      if (!t || !t.res || !t.res.request_id) return;
      try { await env.api('/ask/feedback', { method: 'POST', body: { request_id: t.res.request_id, rating: Number(b.dataset.askFb) } }); b.parentElement.innerHTML = '<em>Terima kasih.</em>'; } catch (e) { b.parentElement.innerHTML = `<em>${ESC(errorText(e))}</em>`; }
    }));
  }

  function mount(host) {
    if (nodes && nodes.btn.isConnected) return;
    const doc = host.ownerDocument;
    const btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'ask-fab'; btn.hidden = true; btn.textContent = '✨ Tanya OMOS';
    const panel = doc.createElement('aside');
    panel.className = 'ask-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Tanya OMOS');
    btn.addEventListener('click', () => { open = !open; paint(); });
    host.appendChild(btn); host.appendChild(panel);
    nodes = { btn, panel };
  }

  /* Dipanggil hse.js di akhir render(). */
  async function sync(opts) {
    env = opts;
    if (!env || !env.host) return;
    mount(env.host);
    await ensureInfo();
    paint();
  }

  global.OMOSHseAsk = { sync, examplesFor, renderResult, renderTable, historyForRequest, exampleKey, PAGE_NAV, _reset() { info = null; infoFor = null; open = false; busy = false; thread = []; nodes = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
