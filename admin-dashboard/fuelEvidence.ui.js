/*
 * Bukti foto Fuel di kartu Input Fuel — ikon jumlah lampiran per log + pratinjau.
 * File dibaca lewat /api/fuel-evidence (terautentikasi), sehingga gambar diambil
 * sebagai blob dengan header Authorization lalu ditampilkan via object URL.
 * Gagal memuat (mis. migrasi 103 belum jalan) → ikon tidak tampil, kartu tetap normal.
 */
(function (global, factory) {
  const api = factory(global);
  if (global) global.FuelEvidenceUi = api.ui;
  if (typeof module === 'object' && module.exports) module.exports = api.pure;
})(typeof window !== 'undefined' ? window : globalThis, function createFuelEvidenceUi(global) {
  'use strict';

  const BASE = '/api/fuel-evidence';

  /* ---------- fungsi murni ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Lampiran lama (kolom teks attachment_url) hanya ditautkan bila http(s). */
  function safeHttpUrl(value) {
    const s = String(value || '').trim();
    return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
  }

  function chipLabel(count) {
    const n = Number(count) || 0;
    return n > 0 ? `${n} bukti` : '';
  }

  function fmtWaktu(value) {
    const t = Date.parse(value || '');
    if (!Number.isFinite(t)) return '—';
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t));
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  const CLIP = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l8-8"/></svg>';

  /* ---------- browser ---------- */

  const blobUrls = [];

  function apiUrl(path) {
    if (typeof global.getProdApiUrl === 'function') return global.getProdApiUrl(path);
    return path;
  }

  function headers() {
    return typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {};
  }

  async function getJson(path) {
    const res = await fetch(apiUrl(`${BASE}${path}`), { headers: { ...headers() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function getBlobUrl(path) {
    const res = await fetch(apiUrl(path), { headers: { ...headers() } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    blobUrls.push(url);
    return url;
  }

  function lepasBlob() {
    while (blobUrls.length) URL.revokeObjectURL(blobUrls.pop());
  }

  /** Isi placeholder [data-fuel-evidence] di dalam container dengan jumlah bukti. */
  async function hydrate(container) {
    const slots = [...(container || document).querySelectorAll('[data-fuel-evidence]')];
    const ids = [...new Set(slots.map(el => el.dataset.fuelEvidence).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!ids.length) return;
    let rows = [];
    try {
      for (const part of chunk(ids, 200)) {
        rows = rows.concat(await getJson(`/summary?entity_type=fuel_log&ids=${part.join(',')}`));
      }
    } catch (error) {
      return; // skema belum ada / tanpa izin → diam, kartu tetap berfungsi
    }
    const peta = new Map(rows.map(r => [String(r.entity_id), r]));
    slots.forEach(el => {
      const info = peta.get(String(el.dataset.fuelEvidence));
      if (!info || !info.active_count) return;
      el.hidden = false;
      el.innerHTML = `${CLIP}${esc(chipLabel(info.active_count))}${info.duplicate_count ? ' <b title="Foto identik dengan lampiran lain">!</b>' : ''}`;
      el.title = `Lihat bukti: ${(info.slot_codes || []).join(', ')}`;
    });
  }

  /** Galeri bukti (thumbnail via blob ber-auth) ke dalam container mana pun. */
  async function renderGallery(container, entityType, entityId) {
    if (!container) return [];
    container.innerHTML = '<div class="fuel-loading-state">Memuat bukti…</div>';
    const list = await getJson(`/attachments?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`);
    container.innerHTML = list.length ? `<div class="fuel-evidence-grid">${list.map(a => `<figure class="fuel-evidence-item">
        <button type="button" data-evidence-open="${esc(a.id)}" class="fuel-evidence-thumb" aria-label="Buka ${esc(a.slot_code)}">
          ${a.thumbnail_url ? `<img alt="" data-evidence-thumb="${esc(a.id)}">` : `<span>${a.mime_type === 'application/pdf' ? 'PDF' : 'Foto'}</span>`}
        </button>
        <figcaption><b>${esc(a.slot_code)}</b><small>${esc(fmtWaktu(a.captured_at || a.uploaded_at))} · ${esc(a.upload_source === 'mobile' ? 'APK' : 'Dashboard')}${a.server_recompressed ? ' · dikompres server' : ''}</small>
          ${(a.flags || []).map(f => `<small class="fuel-evidence-flag">${esc(f.message)}</small>`).join('')}</figcaption>
      </figure>`).join('')}</div>` : '<p class="tabel__kosong">Belum ada bukti foto.</p>';
    container.querySelectorAll('[data-evidence-open]').forEach(b => b.addEventListener('click', async () => {
      try { global.open(await getBlobUrl(`${BASE}/attachments/${b.dataset.evidenceOpen}/file`), '_blank', 'noopener'); }
      catch (error) { alert(`Gagal membuka file: ${error.message}`); }
    }));
    await Promise.all(list.filter(a => a.thumbnail_url).map(async a => {
      const img = container.querySelector(`[data-evidence-thumb="${CSS.escape(a.id)}"]`);
      if (img) img.src = await getBlobUrl(a.thumbnail_url).catch(() => '');
    }));
    return list;
  }

  async function bukaPratinjau(entityId, entityType = 'fuel_log') {
    const overlay = document.getElementById('modalOverlay');
    const konten = document.getElementById('modalKonten');
    if (!overlay || !konten) return;
    lepasBlob();
    overlay.hidden = false;
    konten.innerHTML = `<div class="fuel-evidence-modal">
        <header><div><small>BUKTI FOTO FUEL</small><h3 data-evidence-title>Lampiran</h3></div><button type="button" class="tombol tombol--ghost" data-evidence-close>Tutup</button></header>
        <div data-evidence-body></div></div>`;
    konten.querySelector('[data-evidence-close]')?.addEventListener('click', tutup);
    try {
      const list = await renderGallery(konten.querySelector('[data-evidence-body]'), entityType, entityId);
      const judul = konten.querySelector('[data-evidence-title]');
      if (judul) judul.textContent = `${list.length} lampiran`;
    } catch (error) {
      const body = konten.querySelector('[data-evidence-body]');
      if (body) body.innerHTML = `<p class="fuel-card-error">Gagal memuat bukti: ${esc(error.message)}</p>`;
    }
  }

  function tutup() {
    lepasBlob();
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.hidden = true;
  }

  return {
    pure: { esc, safeHttpUrl, chipLabel, chunk },
    ui: { hydrate, bukaPratinjau, renderGallery, lepasBlob, tutup, safeHttpUrl },
  };
});
