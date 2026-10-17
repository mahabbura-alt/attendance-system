/* OMOS HSE — Asisten AI (trial agen LLM)
 * Komponen tampilan untuk: deteksi laporan hazard ganda (AI-1), Saran AI triase (AI-2),
 * dan Setup Master → Asisten AI. Tidak pernah memegang API key: semua lewat /api/hse/ai/*.
 * Dipakai oleh hse.js lewat window.OMOSHseAi.
 */
(function (global) {
  'use strict';

  const AI_LABEL = 'Saran AI — perlu dicek';
  const MODE_LABELS = { OFF: 'Mati', SHADOW: 'Uji diam-diam', ON: 'Aktif' };
  const LEVEL_LABELS = { LOW: 'RENDAH', MEDIUM: 'SEDANG', HIGH: 'TINGGI', EXTREME: 'EKSTREM' };
  const HIERARCHY_LABELS = { ELIMINASI: 'Eliminasi', SUBSTITUSI: 'Substitusi', REKAYASA: 'Rekayasa', ADMINISTRATIF: 'Administratif', APD: 'APD' };
  const CATEGORY_LABELS = { UNSAFE_CONDITION: 'Kondisi Tidak Aman', UNSAFE_ACT: 'Tindakan Tidak Aman' };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtNum(n, d = 0) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtDateTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  }

  function isLlm(sim) {
    return sim && sim.engine === 'LLM';
  }

  /* ---------------------------------------------------- AI-1: duplikat */

  /** Lencana sumber deteksi: "Dicek AI · Tinggi" atau "Cek kata kunci · 72%". */
  function dupBadge(sim) {
    if (isLlm(sim)) {
      const tone = sim.confidence >= 0.85 ? 'high' : 'mid';
      return `<span class="hai-badge hai-badge--ai hai-badge--${tone}" title="${esc(AI_LABEL)}">🤖 Dicek AI · keyakinan ${esc(sim.confidence_label || '')} (${Math.round((sim.confidence || 0) * 100)}%)</span>`;
    }
    return `<span class="hai-badge hai-badge--rule" title="Mesin kata kunci (cadangan)">🔤 Cek kata kunci · ${esc(sim.similarity_pct)}% mirip</span>`;
  }

  /** Penanda di baris tabel daftar hazard. */
  function dupChip(sim) {
    if (!sim) return '';
    if (isLlm(sim)) {
      return `<div class="hai-row-chip hai-row-chip--ai">🤖 Kemungkinan laporan sama · dicek AI (${esc(sim.confidence_label)}) #${esc(sim.report_no)}</div>`;
    }
    return `<div class="hai-row-chip">🔤 Cek kata kunci: ${esc(sim.similarity_pct)}% mirip #${esc(sim.report_no)}</div>`;
  }

  function relatedChip(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return `<div class="hai-row-chip hai-row-chip--related" title="Jenis bahaya sama di titik/objek berbeda">↺ Pola berulang: ${list.length} laporan terkait</div>`;
  }

  /** Alasan & bukti dari AI (kosong untuk mesin lama). */
  function dupMeta(sim) {
    if (!isLlm(sim)) return '';
    const ev = Array.isArray(sim.evidence) ? sim.evidence.filter(Boolean) : [];
    return `
      <div class="hai-meta">
        <div><strong>Alasan AI:</strong> ${esc(sim.reason)}</div>
        ${ev.length ? `<div class="hai-evidence">${ev.map(e => `<mark>${esc(e)}</mark>`).join(' ')}</div>` : ''}
        <div class="hai-foot">${esc(AI_LABEL)} · ${esc(sim.agent_version || 'v1')}</div>
      </div>`;
  }

  /** Tombol "Bukan duplikat" (data-* dibaca oleh bindRejectButtons). */
  function rejectButton(targetId, sim, canMerge, ctx = 'list') {
    if (canMerge === false) return '';
    return `<button type="button" class="hse-btn hai-btn-reject" data-hai-ctx="${esc(ctx)}" data-hai-reject-target="${esc(targetId)}" data-hai-reject-source="${esc(sim.id)}"
      data-hai-suggestion="${esc(sim.suggestion_id || '')}" data-hai-report-no="${esc(sim.report_no)}">✋ Bukan duplikat</button>`;
  }

  /** Atribut tambahan untuk tombol Gabungkan yang sudah ada di hse.js. */
  function mergeAttrs(sim) {
    return `data-hai-suggestion="${esc(sim.suggestion_id || '')}" data-hai-engine="${esc(sim.engine || 'RULE')}" data-hai-report-no="${esc(sim.report_no || '')}"`;
  }

  function relatedSection(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return `
      <div class="hai-related">
        <strong>↺ Pola berulang (TERKAIT) — jenis bahaya sama di titik/objek berbeda</strong>
        <div class="hai-related-note">Tidak disarankan digabung. Pertimbangkan tindakan sistemik bila pola ini terus muncul.</div>
        ${list.map(r => `
          <div class="hai-related-item">
            <div><strong>#${esc(r.report_no)}</strong> · ${esc(r.location_name || r.area_name || '-')} · ${esc(String(r.report_date || '').slice(0, 10))}</div>
            <div class="hai-quote">"${esc(r.description)}"</div>
            ${dupMeta(r)}
          </div>`).join('')}
      </div>`;
  }

  /* --------------------------------------------- dialog alasan (modal) */

  /**
   * Dialog teks kecil di atas modal lain. Resolve string (sudah di-trim) atau null bila batal.
   */
  function askText({ title, message = '', label = 'Alasan', placeholder = '', confirmText = 'Simpan', minLength = 3, value = '' } = {}) {
    return new Promise(resolve => {
      const prevFocus = document.activeElement;
      const wrap = document.createElement('div');
      wrap.className = 'hai-dialog-backdrop';
      wrap.innerHTML = `
        <div class="hai-dialog" role="dialog" aria-modal="true" aria-labelledby="haiDialogTitle">
          <div class="hai-dialog-title" id="haiDialogTitle">${esc(title)}</div>
          ${message ? `<div class="hai-dialog-msg">${message}</div>` : ''}
          <label class="hse-form-label" for="haiDialogInput">${esc(label)}</label>
          <textarea id="haiDialogInput" class="hse-form-textarea" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
          <div class="hai-dialog-err" id="haiDialogErr" hidden></div>
          <div class="hai-dialog-actions">
            <button type="button" class="hse-btn" data-hai-dialog="cancel">Batal</button>
            <button type="button" class="hse-btn hse-btn--primary" data-hai-dialog="ok">${esc(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const input = wrap.querySelector('#haiDialogInput');
      const err = wrap.querySelector('#haiDialogErr');
      const close = result => {
        document.removeEventListener('keydown', onKey, true);
        wrap.remove();
        if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
        resolve(result);
      };
      const submit = () => {
        const v = String(input.value || '').trim();
        if (v.length < minLength) {
          err.textContent = `${label} wajib diisi (min. ${minLength} karakter).`;
          err.hidden = false;
          input.focus();
          return;
        }
        close(v);
      };
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
      }
      document.addEventListener('keydown', onKey, true);
      wrap.addEventListener('click', e => { if (e.target === wrap) close(null); });
      wrap.querySelector('[data-hai-dialog="cancel"]').addEventListener('click', () => close(null));
      wrap.querySelector('[data-hai-dialog="ok"]').addEventListener('click', submit);
      setTimeout(() => input.focus(), 0);
    });
  }

  /** Pasang tombol "Bukan duplikat" di dalam root. */
  function bindRejectButtons(root, { api, onDone, ctx = 'list' }) {
    root.querySelectorAll(`[data-hai-reject-source][data-hai-ctx="${ctx}"]`).forEach(btn => {
      btn.addEventListener('click', async () => {
        const note = await askText({
          title: `Tandai #${btn.dataset.haiReportNo || ''} bukan duplikat`,
          message: 'Pasangan ini tidak akan disarankan lagi. Alasan dipakai untuk mengukur akurasi deteksi.',
          label: 'Alasan',
          placeholder: 'Mis. titik berbeda (KM 2 vs KM 4), unit berbeda',
          confirmText: 'Bukan duplikat',
        });
        if (!note) return;
        const body = { note, hazard_id: btn.dataset.haiRejectTarget, candidate_hazard_id: btn.dataset.haiRejectSource };
        if (btn.dataset.haiSuggestion) body.suggestion_id = btn.dataset.haiSuggestion;
        const work = async () => {
          await api('/ai/duplicates/reject', { method: 'POST', body });
          if (onDone) await onDone();
        };
        if (global.OMOSActionFeedback?.run) {
          await global.OMOSActionFeedback.run(btn, work).catch(err => console.error('Gagal menandai bukan duplikat:', err));
        } else {
          await work().catch(err => console.error('Gagal menandai bukan duplikat:', err));
        }
      });
    });
  }

  /* --------------------------------------------------- AI-2: triase */

  function triageAvailable(overview) {
    if (!overview || !overview.settings) return false;
    const s = overview.settings;
    if (!s.enabled) return false;
    const mode = s.features?.hse_triage || 'OFF';
    if (mode === 'ON') return true;
    return mode === 'SHADOW' && overview.can_edit === true;
  }

  function triageButton(id, label = '✨ Saran AI') {
    return `<button type="button" class="hse-btn hai-btn-ai" id="${esc(id)}" title="Minta saran kategori, risiko, dan tindakan dari AI">${esc(label)}</button>`;
  }

  function levelBadge(level) {
    const cls = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', EXTREME: 'extreme' }[level] || 'medium';
    return `<span class="hse-badge hse-badge--${cls}">${esc(LEVEL_LABELS[level] || level)}</span>`;
  }

  function renderTriage(res, opts, applied) {
    const done = key => applied.has(key);
    const apply = (key, text) => (done(key)
      ? `<span class="hai-applied">✓ Diterapkan</span>`
      : `<button type="button" class="hse-btn hai-apply" data-hai-apply="${esc(key)}">${esc(text)}</button>`);
    const actions = res.immediate_actions || [];
    const questions = res.completeness_questions || [];
    return `
      <div class="hai-triage-head">
        <strong>✨ ${esc(AI_LABEL)}</strong>
        <span class="hai-foot">${esc(res.agent_version || '')}${res.model ? ` · ${esc(res.model)}` : ''}</span>
      </div>
      <div class="hai-triage-row">
        <div>
          <div class="hai-k">Kategori</div>
          <div><strong>${esc(res.category_label || CATEGORY_LABELS[res.category?.code] || res.category?.code)}</strong></div>
          <div class="hai-reason">${esc(res.category?.reason)}</div>
        </div>
        ${opts.canApplyCategory && res.category_id ? apply('kategori', 'Terapkan') : ''}
      </div>
      <div class="hai-triage-row">
        <div>
          <div class="hai-k">Risiko (dihitung OMOS dari matriks)</div>
          <div><strong>Kemungkinan ${esc(res.likelihood?.value)} × Akibat ${esc(res.consequence?.value)} = Skor ${esc(res.risk?.riskScore)}</strong> ${levelBadge(res.risk?.riskLevel)}</div>
          <div class="hai-reason">Kemungkinan: ${esc(res.likelihood?.reason)}</div>
          <div class="hai-reason">Akibat: ${esc(res.consequence?.reason)}</div>
        </div>
        ${opts.canApplyRisk ? apply('risiko', 'Terapkan') : ''}
      </div>
      ${actions.length ? `
        <div class="hai-triage-block">
          <div class="hai-k">Tindakan segera</div>
          ${actions.map((a, i) => `
            <div class="hai-triage-row hai-triage-row--sub">
              <div><span class="hai-tag">${esc(HIERARCHY_LABELS[a.hierarchy] || a.hierarchy)}</span> ${esc(a.description)}</div>
              ${opts.canUseAction ? apply(`capa:${i}`, 'Pakai sebagai CAPA') : ''}
            </div>`).join('')}
        </div>` : ''}
      ${questions.length ? `
        <div class="hai-triage-block">
          <div class="hai-k">Perlu dilengkapi</div>
          <ul class="hai-questions">${questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>
        </div>` : ''}
      ${res.clean_description ? `
        <div class="hai-triage-block">
          <div class="hai-k">Uraian rapi (uraian asli pelapor tidak diubah)</div>
          <div class="hai-triage-row hai-triage-row--sub">
            <div class="hai-quote">${esc(res.clean_description)}</div>
            ${opts.canUseClean ? apply('uraian', 'Pakai uraian rapi') : ''}
          </div>
        </div>` : ''}
      <div class="hai-triage-actions">
        <button type="button" class="hse-btn" data-hai-dismiss>Abaikan saran</button>
      </div>`;
  }

  function friendlyError(err) {
    const msg = err && err.message ? err.message : 'Saran AI tidak tersedia.';
    return `${esc(msg)} <span class="hai-foot">Anda tetap bisa mengisi manual seperti biasa.</span>`;
  }

  /**
   * Pasang tombol Saran AI pada form/detail.
   * opts: { button, panel, api, getDraft(): {description, potential_consequence, location_id}, hazardId,
   *         onApplyCategory(id), onApplyRisk(l, c), onUseAction(text), onUseClean(text) }
   * Mengembalikan controller { finalize(): Promise } untuk dipanggil setelah form disimpan.
   */
  function mountTriage(opts) {
    const btn = typeof opts.button === 'string' ? document.getElementById(opts.button) : opts.button;
    const panel = typeof opts.panel === 'string' ? document.getElementById(opts.panel) : opts.panel;
    const ctl = { suggestionId: null, applied: new Set(), decided: false, result: null };
    if (!btn || !panel) return { finalize: async () => {}, state: ctl };
    const flags = {
      canApplyCategory: typeof opts.onApplyCategory === 'function',
      canApplyRisk: typeof opts.onApplyRisk === 'function',
      canUseAction: typeof opts.onUseAction === 'function',
      canUseClean: typeof opts.onUseClean === 'function',
    };

    const paint = () => {
      panel.innerHTML = renderTriage(ctl.result, flags, ctl.applied);
      panel.hidden = false;
      panel.querySelectorAll('[data-hai-apply]').forEach(b => b.addEventListener('click', async () => {
        const key = b.dataset.haiApply;
        const r = ctl.result;
        try {
          if (key === 'kategori') opts.onApplyCategory(r.category_id, r);
          else if (key === 'risiko') opts.onApplyRisk(r.likelihood.value, r.consequence.value, r);
          else if (key.startsWith('capa:')) await opts.onUseAction(r.immediate_actions[Number(key.slice(5))].description, r);
          else if (key === 'uraian') await opts.onUseClean(r.clean_description, r);
          ctl.applied.add(key);
          paint();
        } catch (err) {
          console.error('Gagal menerapkan saran AI:', err);
          b.textContent = 'Gagal — coba lagi';
        }
      }));
      panel.querySelector('[data-hai-dismiss]')?.addEventListener('click', async () => {
        await decide('REJECTED');
        panel.innerHTML = '<div class="hai-foot">Saran AI diabaikan.</div>';
      });
    };

    async function decide(decision) {
      if (!ctl.suggestionId || ctl.decided) return;
      ctl.decided = true;
      const applied = Array.from(ctl.applied).map(k => (k.startsWith('capa:') ? 'capa' : k));
      await opts.api(`/ai/suggestions/${ctl.suggestionId}/decision`, { method: 'POST', body: { decision, applied } }).catch(() => {});
    }

    btn.addEventListener('click', async () => {
      const draft = opts.getDraft ? opts.getDraft() : {};
      const body = opts.hazardId ? { hazard_id: opts.hazardId } : draft;
      panel.hidden = false;
      panel.innerHTML = '<div class="hai-loading">✨ Meminta saran AI… (± 5–15 detik)</div>';
      const work = async () => {
        const res = await opts.api('/ai/hazards/triage', { method: 'POST', body });
        ctl.result = res;
        ctl.suggestionId = res.suggestion_id;
        ctl.applied = new Set();
        ctl.decided = false;
        paint();
      };
      try {
        if (global.OMOSActionFeedback?.run) await global.OMOSActionFeedback.run(btn, work);
        else await work();
      } catch (err) {
        panel.innerHTML = `<div class="hai-error">${friendlyError(err)}</div>`;
      }
    });

    return {
      state: ctl,
      /** Dipanggil setelah form disimpan: saran yang dipakai → ACCEPTED. */
      async finalize() {
        if (ctl.applied.size) await decide('ACCEPTED');
      },
    };
  }

  /* --------------------------------------- Setup Master → Asisten AI */

  const setup = { overview: null, shadow: null, error: null };

  async function loadSetup(api) {
    try {
      setup.overview = await api('/ai/overview');
      setup.error = null;
      setup.shadow = setup.overview?.settings?.migrated
        ? await api('/ai/shadow-report?days=14').catch(() => null)
        : null;
    } catch (err) {
      setup.error = err.message;
    }
  }

  function modeSelect(name, value, disabled, labels = MODE_LABELS) {
    return `<select class="hse-form-select" name="${esc(name)}" ${disabled ? 'disabled' : ''}>
      ${Object.keys(labels).map(m => `<option value="${m}" ${value === m ? 'selected' : ''}>${esc(labels[m])}</option>`).join('')}
    </select>`;
  }

  function stat(label, value, note = '') {
    return `<div class="hai-stat"><div class="hai-k">${esc(label)}</div><div class="hai-stat-v">${value}</div>${note ? `<div class="hai-foot">${note}</div>` : ''}</div>`;
  }

  function renderShadow(shadow) {
    if (!shadow) return '<div class="hai-foot">Belum ada data perbandingan.</div>';
    const s = shadow.summary || {};
    const items = shadow.items || [];
    const verdict = v => ({ SAMA: 'Sama', TERKAIT: 'Terkait', BERBEDA: 'Berbeda' }[v] || v);
    return `
      <div class="hai-stats">
        ${stat('Pasangan dinilai AI', fmtNum(s.pairs))}
        ${stat('AI = kata kunci', fmtNum(s.agree))}
        ${stat('Hanya AI menyarankan gabung', fmtNum(s.ai_only))}
        ${stat('Hanya kata kunci', fmtNum(s.rule_only))}
        ${stat('Digabung HSE officer', fmtNum(s.human_merged))}
        ${stat('Ditolak HSE officer', fmtNum(s.human_rejected))}
        ${stat('Presisi AI teramati', s.ai_precision_observed === null || s.ai_precision_observed === undefined ? '—' : `${Math.round(s.ai_precision_observed * 100)}%`, 'Target ≥ 90%')}
      </div>
      ${items.length ? `
        <div class="hse-table-wrap"><table class="hse-table hai-table">
          <thead><tr><th>Laporan</th><th>Pasangan</th><th>AI</th><th>Kata kunci</th><th>Keputusan HSE</th></tr></thead>
          <tbody>${items.map(it => `
            <tr>
              <td><strong>#${esc(it.hazard.report_no)}</strong><div class="hai-quote">${esc(it.hazard.description)}</div></td>
              <td><strong>#${esc(it.candidate.report_no)}</strong><div class="hai-quote">${esc(it.candidate.description)}</div></td>
              <td><strong>${esc(verdict(it.ai.verdict))}</strong> (${Math.round((it.ai.confidence || 0) * 100)}%)<div class="hai-reason">${esc(it.ai.reason)}</div></td>
              <td>${it.rule.same ? `Sama (${esc(it.rule.similarity_pct)}%)` : 'Tidak'}</td>
              <td>${it.human === 'MERGED' ? '🔗 Digabung' : (it.human === 'REJECTED' ? '✋ Bukan duplikat' : '—')}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<div class="hai-foot">Tidak ada perbedaan pendapat atau keputusan dalam 14 hari terakhir.</div>'}`;
  }

  function renderSetup() {
    if (setup.error) return `<div class="hse-card hai-card"><div class="hai-error">Gagal memuat Asisten AI: ${esc(setup.error)}</div></div>`;
    const ov = setup.overview;
    if (!ov) return '<div class="hse-card hai-card"><div class="hai-loading">Memuat Asisten AI…</div></div>';
    const s = ov.settings || {};
    const srv = ov.server || {};
    const u = ov.usage || {};
    const ro = !ov.can_edit;
    const dupMode = s.features?.hse_duplicate || 'OFF';
    return `
      <div class="hai-setup">
        <div class="hse-card hai-card">
          <div class="hai-card-head">
            <strong>🤖 Asisten AI — status server</strong>
            <span class="hai-badge ${srv.ready ? 'hai-badge--ok' : 'hai-badge--warn'}">${srv.ready ? 'Siap' : 'Belum siap'}</span>
          </div>
          <div class="hai-stats">
            ${stat('Provider', esc(srv.provider || '—'))}
            ${stat('Host', esc(srv.host || '—'))}
            ${stat('Model standar', esc(srv.models?.['omos-standard'] || '—'))}
            ${stat('API key', srv.key_present ? 'Terpasang' : 'Belum', srv.key_present ? `sumber: ${esc(srv.key_source)}` : 'diisi di server, bukan di sini')}
          </div>
          ${srv.problems && srv.problems.length ? `<ul class="hai-problems">${srv.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
          <div class="hai-foot">API key hanya disimpan di server (<code>/opt/omos/secrets/llm_api_key</code>) dan tidak pernah tampil di dashboard.</div>
          ${s.migrated === false ? '<div class="hai-error">Tabel AI belum tersedia — jalankan migrasi 099.</div>' : ''}
        </div>

        <form class="hse-card hai-card" id="haiSettingsForm">
          <div class="hai-card-head">
            <strong>Pengaturan site ini</strong>
            ${ro ? '<span class="hai-foot">Hanya Admin Utama yang dapat mengubah.</span>' : ''}
          </div>
          <label class="hai-switch">
            <input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''} ${ro ? 'disabled' : ''}>
            <span><strong>Aktifkan Asisten AI untuk site ini</strong> — sakelar utama; bila mati, semua fitur AI mati dan mesin lama dipakai.</span>
          </label>
          <div class="hai-grid">
            <div class="hse-form-group">
              <label class="hse-form-label">Deteksi laporan hazard ganda</label>
              ${modeSelect('hse_duplicate', dupMode, ro)}
              <div class="hai-foot">Uji diam-diam: AI menilai di belakang, tampilan tetap memakai cek kata kunci. Aktif: saran AI tampil di daftar & detail.</div>
            </div>
            <div class="hse-form-group">
              <label class="hse-form-label">Saran AI triase (tombol ✨)</label>
              ${modeSelect('hse_triage', s.features?.hse_triage || 'OFF', ro, { OFF: 'Mati', SHADOW: 'Uji (Admin Utama saja)', ON: 'Aktif' })}
              <div class="hai-foot">Hanya berjalan saat tombol diklik.</div>
            </div>
            <div class="hse-form-group">
              <label class="hse-form-label">Tanya OMOS (tanya-jawab data HSE)</label>
              ${modeSelect('hse_ask', s.features?.hse_ask || 'OFF', ro, { OFF: 'Mati', SHADOW: 'Uji (Admin Utama saja)', ON: 'Aktif (semua admin)' })}
              <div class="hai-foot">Tombol "Tanya OMOS" di halaman HSE. Hanya membaca data; nama disamarkan sebelum dikirim ke AI.</div>
            </div>
            <div class="hse-form-group">
              <label class="hse-form-label">Ambang keyakinan saran "Gabungkan"</label>
              <input class="hse-form-input" type="number" name="duplicate_min_confidence" min="0.5" max="1" step="0.05" value="${esc(s.duplicate_min_confidence)}" ${ro ? 'disabled' : ''}>
              <div class="hai-foot">Di bawah ambang, saran tampil sebagai "Pola berulang", bukan saran gabung.</div>
            </div>
            <div class="hse-form-group">
              <label class="hse-form-label">Jendela pencarian duplikat (hari)</label>
              <input class="hse-form-input" type="number" name="duplicate_window_days" min="1" max="365" value="${esc(s.duplicate_window_days)}" ${ro ? 'disabled' : ''}>
            </div>
            <div class="hse-form-group">
              <label class="hse-form-label">Batas biaya bulanan (USD)</label>
              <input class="hse-form-input" type="number" name="monthly_budget_usd" min="0" step="1" value="${esc(s.monthly_budget_usd)}" ${ro ? 'disabled' : ''}>
            </div>
            <div class="hse-form-group">
              <label class="hse-form-label">Batas panggilan AI per hari</label>
              <input class="hse-form-input" type="number" name="daily_call_limit" min="0" step="10" value="${esc(s.daily_call_limit)}" ${ro ? 'disabled' : ''}>
            </div>
          </div>
          <div class="hai-dialog-err" id="haiSettingsErr" hidden></div>
          ${ro ? '' : `
            <div class="hai-triage-actions">
              ${dupMode !== 'OFF' && s.enabled ? '<button type="button" class="hse-btn" id="haiRecheck">↻ Periksa ulang semua laporan terbuka</button>' : ''}
              <button type="submit" class="hse-btn hse-btn--primary" id="haiSettingsSave">Simpan pengaturan</button>
            </div>`}
          <div class="hai-foot">Terakhir diubah: ${fmtDateTime(s.updated_at)}</div>
        </form>

        <div class="hse-card hai-card">
          <div class="hai-card-head"><strong>Pemakaian bulan ini</strong></div>
          <div class="hai-stats">
            ${stat('Panggilan', fmtNum(u.month_calls), `${fmtNum(u.month_ok)} berhasil`)}
            ${stat('Hari ini', fmtNum(u.today_calls), `batas ${fmtNum(s.daily_call_limit)}`)}
            ${stat('Token masuk / keluar', `${fmtNum(u.month_input_tokens)} / ${fmtNum(u.month_output_tokens)}`)}
            ${stat('Perkiraan biaya', `$${fmtNum(u.month_cost_usd, 2)}`, `batas $${fmtNum(s.monthly_budget_usd, 0)}`)}
            ${stat('Latensi p95 (30 hari)', u.p95_latency_ms ? `${fmtNum(u.p95_latency_ms / 1000, 1)} dtk` : '—')}
            ${stat('Terakhir berhasil', fmtDateTime(u.last_ok_at))}
          </div>
          ${u.by_status && Object.keys(u.by_status).length ? `<div class="hai-foot">Status: ${Object.entries(u.by_status).map(([k, v]) => `${esc(k)} ${fmtNum(v)}`).join(' · ')}</div>` : ''}
          ${ov.jobs_30d && Object.keys(ov.jobs_30d).length ? `<div class="hai-foot">Antrean 30 hari: ${Object.entries(ov.jobs_30d).map(([k, v]) => `${esc(k)} ${fmtNum(v)}`).join(' · ')}</div>` : ''}
        </div>

        <div class="hse-card hai-card">
          <div class="hai-card-head"><strong>Perbandingan AI vs cek kata kunci (14 hari)</strong></div>
          ${renderShadow(setup.shadow)}
        </div>
      </div>`;
  }

  function bindSetup(root, { api, rerender }) {
    const form = root.querySelector('#haiSettingsForm');
    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const err = root.querySelector('#haiSettingsErr');
        if (err) err.hidden = true;
        const fd = new FormData(form);
        const body = {
          enabled: form.querySelector('[name=enabled]').checked,
          features: { hse_duplicate: fd.get('hse_duplicate'), hse_triage: fd.get('hse_triage'), hse_ask: fd.get('hse_ask') },
          duplicate_min_confidence: Number(fd.get('duplicate_min_confidence')),
          duplicate_window_days: Number(fd.get('duplicate_window_days')),
          monthly_budget_usd: Number(fd.get('monthly_budget_usd')),
          daily_call_limit: Number(fd.get('daily_call_limit')),
        };
        const btn = root.querySelector('#haiSettingsSave');
        const work = async () => {
          await api('/ai/settings', { method: 'PUT', body });
          await loadSetup(api);
          rerender();
        };
        try {
          if (global.OMOSActionFeedback?.run) await global.OMOSActionFeedback.run(btn, work);
          else await work();
        } catch (ex) {
          if (err) { err.textContent = ex.message; err.hidden = false; }
        }
      });
    }
    const re = root.querySelector('#haiRecheck');
    if (re) {
      re.addEventListener('click', async () => {
        const work = async () => {
          const r = await api('/ai/recheck', { method: 'POST', body: {} });
          re.textContent = `↻ ${r.queued} laporan masuk antrean`;
        };
        if (global.OMOSActionFeedback?.run) await global.OMOSActionFeedback.run(re, work).catch(ex => { re.textContent = ex.message; });
        else await work().catch(ex => { re.textContent = ex.message; });
      });
    }
  }

  global.OMOSHseAi = Object.freeze({
    AI_LABEL,
    esc,
    dupBadge,
    dupChip,
    relatedChip,
    dupMeta,
    rejectButton,
    mergeAttrs,
    relatedSection,
    askText,
    bindRejectButtons,
    triageAvailable,
    triageButton,
    mountTriage,
    loadSetup,
    renderSetup,
    bindSetup,
    _setupState: setup,
  });
})(typeof window !== 'undefined' ? window : globalThis);
