/* OMOS HSE — Setup Master → Delegator Departemen
 * Delegator = pimpinan tertinggi departemen yang memutuskan permintaan PIC
 * (pengalihan / perpanjangan batas) dari APK OMOS Safety. Satu delegator aktif per departemen,
 * cadangan opsional; riwayat disimpan server. Data lewat /api/hse/delegators (admin).
 * Dipakai oleh hse.js lewat window.OMOSHseDelegators.
 */
(function (global) {
  'use strict';

  const state = { rows: null, employees: [], error: null, editing: null, filter: '' };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(v) {
    if (!v) return '—';
    const s = String(v).slice(0, 10);
    const d = new Date(`${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function todayWib() {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function sameDept(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  /** Karyawan aktif di departemen ini (validasi akhir tetap di server). */
  function membersOf(deptName) {
    return state.employees.filter(e => sameDept(e.departemen, deptName));
  }

  async function loadSetup(api) {
    try {
      const [rows, masters] = await Promise.all([api('/delegators'), api('/masters')]);
      state.rows = Array.isArray(rows) ? rows : [];
      state.employees = Array.isArray(masters?.employees) ? masters.employees : [];
      state.error = null;
    } catch (err) {
      state.error = err.status === 503 || /101/.test(err.message || '')
        ? 'Tabel delegator belum tersedia. Jalankan migrasi 101_hse_mobile_safety.sql.'
        : err.message;
    }
  }

  function personOptions(list, selected, emptyLabel) {
    return `<option value="">${esc(emptyLabel)}</option>${list.map(p => `
      <option value="${esc(p.id)}" ${String(p.id) === String(selected || '') ? 'selected' : ''}>${esc(p.nama)}${p.jabatan ? ` — ${esc(p.jabatan)}` : ''}</option>`).join('')}`;
  }

  function renderEditor(row) {
    const members = membersOf(row.department_name);
    if (!members.length) {
      return `<div class="hdl-editor"><div class="hdl-warn">Belum ada karyawan aktif di departemen ${esc(row.department_name)}. Lengkapi data karyawan dulu.</div></div>`;
    }
    return `
      <form class="hdl-editor" data-hdl-form="${esc(row.department_id)}">
        <div class="hdl-grid">
          <label class="hse-form-label">Delegator (pimpinan tertinggi) <span class="hdl-req">*</span>
            <select class="hse-form-select" name="delegator_user_id" required>${personOptions(members, row.delegator_user_id, 'Pilih karyawan…')}</select>
          </label>
          <label class="hse-form-label">Delegator cadangan (saat cuti)
            <select class="hse-form-select" name="backup_user_id">${personOptions(members, row.backup_user_id, 'Tidak ada')}</select>
          </label>
          <label class="hse-form-label">Berlaku mulai
            <input class="hse-form-input" type="date" name="valid_from" value="${esc(String(row.valid_from || todayWib()).slice(0, 10))}">
          </label>
          <label class="hse-form-label">Berlaku sampai <span class="hdl-muted">(opsional)</span>
            <input class="hse-form-input" type="date" name="valid_to" value="${esc(row.valid_to ? String(row.valid_to).slice(0, 10) : '')}">
          </label>
        </div>
        <label class="hse-form-label">Catatan
          <input class="hse-form-input" type="text" name="notes" maxlength="500" value="${esc(row.notes || '')}" placeholder="mis. Dept Head Produksi sesuai SK 2026">
        </label>
        <div class="hdl-err" data-hdl-err hidden></div>
        <div class="hdl-actions">
          <button type="button" class="hse-btn" data-hdl-cancel>Batal</button>
          <button type="submit" class="hse-btn hse-btn--primary" data-hdl-save>Simpan delegator</button>
        </div>
        <div class="hdl-muted">Menyimpan akan menonaktifkan delegator lama (riwayat tetap tersimpan) dan mengirim notifikasi ke delegator baru.</div>
      </form>`;
  }

  function renderRow(row) {
    const has = Boolean(row.delegator_user_id);
    const editing = String(state.editing || '') === String(row.department_id);
    const risk = !has && Number(row.open_pic_actions) > 0;
    return `
      <div class="hdl-row ${risk ? 'hdl-row--risk' : ''}">
        <div class="hdl-dept">
          <strong>${esc(row.department_name)}</strong>
          <span class="hdl-muted">${Number(row.open_pic_actions) || 0} tindak lanjut PIC terbuka</span>
        </div>
        <div class="hdl-who">
          ${has ? `
            <div><span class="hdl-chip hdl-chip--ok">Delegator</span> ${esc(row.delegator_name)}${row.delegator_jabatan ? ` <span class="hdl-muted">· ${esc(row.delegator_jabatan)}</span>` : ''}</div>
            <div class="hdl-muted">Cadangan: ${row.backup_name ? esc(row.backup_name) : '—'} · berlaku ${fmtDate(row.valid_from)}${row.valid_to ? ` s/d ${fmtDate(row.valid_to)}` : ''}</div>`
    : `<div><span class="hdl-chip ${risk ? 'hdl-chip--risk' : ''}">Belum ada delegator</span></div>
             ${risk ? '<div class="hdl-risk-note">PIC di departemen ini tidak bisa minta pengalihan/perpanjangan.</div>' : ''}`}
        </div>
        <div class="hdl-row-actions">
          <button type="button" class="hse-btn ${has ? '' : 'hse-btn--primary'}" data-hdl-edit="${esc(row.department_id)}">${has ? 'Ganti' : 'Tetapkan'}</button>
          ${has ? `<button type="button" class="hse-btn hse-btn--outline hdl-btn-danger" data-hdl-remove="${esc(row.department_id)}" data-hdl-name="${esc(row.department_name)}">Nonaktifkan</button>` : ''}
        </div>
        ${editing ? renderEditor(row) : ''}
      </div>`;
  }

  function renderSetup() {
    if (state.error) return `<div class="hse-card hdl-card"><div class="hdl-error">Gagal memuat delegator: ${esc(state.error)}</div></div>`;
    if (!state.rows) return '<div class="hse-card hdl-card"><div class="hdl-muted">Memuat delegator departemen…</div></div>';
    const missing = state.rows.filter(r => !r.delegator_user_id && Number(r.open_pic_actions) > 0).length;
    const q = state.filter.trim().toLowerCase();
    const rows = q ? state.rows.filter(r => String(r.department_name).toLowerCase().includes(q)) : state.rows;
    return `
      <div class="hse-card hdl-card">
        <div class="hdl-head">
          <div>
            <strong>Delegator Departemen</strong>
            <div class="hdl-muted">Hanya delegator yang boleh mengalihkan PIC atau menyetujui perpanjangan batas di APK OMOS Safety.
              Perpanjangan maksimal 1 kali per hazard; risiko Ekstrem tidak bisa diperpanjang; batas waktu tetap berjalan selama menunggu keputusan.</div>
          </div>
          <input class="hse-form-input hdl-search" type="search" placeholder="Cari departemen…" value="${esc(state.filter)}" data-hdl-filter aria-label="Cari departemen">
        </div>
        ${missing ? `<div class="hdl-warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${missing} departemen punya PIC aktif tetapi belum punya delegator.</div>` : ''}
        ${rows.length ? `<div class="hdl-list">${rows.map(renderRow).join('')}</div>` : '<div class="hdl-muted">Tidak ada departemen.</div>'}
      </div>`;
  }

  function bindSetup(root, { api, rerender }) {
    const filter = root.querySelector('[data-hdl-filter]');
    if (filter) {
      filter.addEventListener('input', () => {
        state.filter = filter.value;
        const pos = filter.selectionStart;
        rerender();
        const again = document.querySelector('[data-hdl-filter]');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (_) { /* abaikan */ } }
      });
    }
    root.querySelectorAll('[data-hdl-edit]').forEach(btn => btn.addEventListener('click', () => {
      state.editing = btn.dataset.hdlEdit;
      rerender();
    }));
    root.querySelectorAll('[data-hdl-cancel]').forEach(btn => btn.addEventListener('click', () => {
      state.editing = null;
      rerender();
    }));
    root.querySelectorAll('[data-hdl-form]').forEach(form => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const deptId = form.dataset.hdlForm;
      const errEl = form.querySelector('[data-hdl-err]');
      errEl.hidden = true;
      const fd = new FormData(form);
      const body = {
        delegator_user_id: fd.get('delegator_user_id') || null,
        backup_user_id: fd.get('backup_user_id') || null,
        valid_from: fd.get('valid_from') || null,
        valid_to: fd.get('valid_to') || null,
        notes: fd.get('notes') || null,
      };
      if (!body.delegator_user_id) { errEl.textContent = 'Pilih delegator.'; errEl.hidden = false; return; }
      if (body.backup_user_id && body.backup_user_id === body.delegator_user_id) {
        errEl.textContent = 'Delegator cadangan harus orang yang berbeda.'; errEl.hidden = false; return;
      }
      const btn = form.querySelector('[data-hdl-save]');
      const work = async () => {
        await api(`/delegators/${encodeURIComponent(deptId)}`, { method: 'PUT', body });
        state.editing = null;
        await loadSetup(api);
      };
      try {
        if (global.OMOSActionFeedback?.run) await global.OMOSActionFeedback.run(btn, work);
        else await work();
        rerender();
      } catch (ex) {
        errEl.textContent = ex.message;
        errEl.hidden = false;
      }
    }));
    root.querySelectorAll('[data-hdl-remove]').forEach(btn => btn.addEventListener('click', async () => {
      const name = btn.dataset.hdlName;
      if (!global.confirm(`Nonaktifkan delegator Dept. ${name}? PIC di departemen ini tidak bisa mengajukan pengalihan/perpanjangan sampai delegator baru ditetapkan.`)) return;
      const work = async () => {
        await api(`/delegators/${encodeURIComponent(btn.dataset.hdlRemove)}`, { method: 'DELETE' });
        await loadSetup(api);
      };
      try {
        if (global.OMOSActionFeedback?.run) await global.OMOSActionFeedback.run(btn, work);
        else await work();
        rerender();
      } catch (ex) {
        global.alert(`Gagal menonaktifkan: ${ex.message}`);
      }
    }));
  }

  global.OMOSHseDelegators = Object.freeze({
    loadSetup,
    renderSetup,
    bindSetup,
    membersOf,
    _state: state,
  });
})(typeof window !== 'undefined' ? window : globalThis);
