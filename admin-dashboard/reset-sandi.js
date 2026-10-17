/* OMOS — Permintaan reset sandi dari APK OMOS Safety (karyawan lapangan tanpa email).
 * Admin membuat sandi sementara; sandi hanya tampil sekali di layar ini dan karyawan wajib menggantinya
 * setelah login. Endpoint: GET /api/admin/karyawan/reset-requests, POST /api/admin/karyawan/:id/reset-password.
 */
(function (global) {
  'use strict';

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function baseUrl() {
    return typeof global.getApiBaseUrl === 'function' ? global.getApiBaseUrl() : '';
  }

  async function call(path, method = 'GET') {
    const token = global.localStorage?.getItem('admin_token') || global.state?.token || '';
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function renderItems(items) {
    return items.map(r => `
      <div class="rs-item">
        <div class="rs-who">
          <strong>${esc(r.nama)}</strong>
          <span class="rs-muted">${esc(r.employee_id || '-')} · ${esc(r.jabatan || '-')} / ${esc(r.departemen || '-')} · diminta
            ${esc(new Date(r.requested_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
        </div>
        <button type="button" class="tombol tombol--utama tombol--kecil" data-rs-reset="${esc(r.user_id)}" data-rs-nama="${esc(r.nama)}">Buat sandi sementara</button>
        <div class="rs-result" data-rs-result="${esc(r.user_id)}" hidden></div>
      </div>`).join('');
  }

  async function load() {
    const panel = global.document.getElementById('panelResetSandi');
    if (!panel) return;
    try {
      const items = await call('/api/admin/karyawan/reset-requests');
      const list = Array.isArray(items) ? items : [];
      panel.hidden = list.length === 0;
      panel.querySelector('[data-rs-count]').textContent = String(list.length);
      const box = panel.querySelector('[data-rs-list]');
      box.innerHTML = renderItems(list);
      box.querySelectorAll('[data-rs-reset]').forEach(btn => btn.addEventListener('click', () => reset(btn)));
    } catch (err) {
      panel.hidden = true;
      console.warn('Gagal memuat permintaan reset sandi:', err.message);
    }
  }

  async function reset(btn) {
    const id = btn.dataset.rsReset;
    const nama = btn.dataset.rsNama;
    if (!global.confirm(`Buat sandi sementara untuk "${nama}"?\n\nSandi lama tidak berlaku lagi dan karyawan wajib menggantinya setelah login.`)) return;
    const out = btn.parentElement.querySelector(`[data-rs-result="${CSS.escape(id)}"]`);
    let result = null;
    const work = async () => { result = await call(`/api/admin/karyawan/${encodeURIComponent(id)}/reset-password`, 'POST'); };
    try {
      if (global.OMOSActionFeedback?.run) await global.OMOSActionFeedback.run(btn, work, { resolveDisabled: () => true });
      else await work();
      out.hidden = false;
      out.innerHTML = `Sandi sementara: <code class="rs-pass">${esc(result.temp_password)}</code>
        <span class="rs-muted">Sampaikan langsung ke ${esc(nama)}. Hanya tampil sekali — jangan kirim lewat grup chat.</span>`;
    } catch (err) {
      out.hidden = false;
      out.textContent = `Gagal reset sandi: ${err.message}`;
    }
  }

  global.OMOSResetSandi = Object.freeze({ load, renderItems });

  // Muat saat tab Karyawan dibuka.
  global.document?.addEventListener('click', (e) => {
    const tab = e.target.closest?.('[data-tab="karyawan"]');
    if (tab) setTimeout(load, 0);
  });
})(typeof window !== 'undefined' ? window : globalThis);
