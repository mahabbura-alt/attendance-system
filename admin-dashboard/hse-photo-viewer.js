/**
 * OMOS HSE — Penampil foto lampiran langsung di dashboard (tanpa tab baru).
 *
 * Foto HSE disimpan sebagai data URL; membukanya di tab baru diblokir browser modern,
 * jadi semua foto (hazard, CAPA, P5M/Safety Talk, inspeksi, insiden) dibuka lewat overlay ini.
 *
 * Pemakaian:
 *   - Elemen dengan atribut `data-hpv-key="<kunci>"` (+ opsional `data-hpv-index`) membuka galeri
 *     yang didaftarkan lewat `OMOSPhotoViewer.register(kunci, foto[], judul)`.
 *   - Atau langsung: `OMOSPhotoViewer.open(foto[], indeks, judul)`.
 * Klik ditangani satu listener terdelegasi di document, jadi aman untuk HTML yang dirender ulang.
 */
(function (global) {
  'use strict';

  const galleries = new Map();
  let overlay = null;
  let state = { photos: [], index: 0, title: '', zoom: false, returnFocus: null };

  function cleanList(photos) {
    return (Array.isArray(photos) ? photos : [photos]).filter(p => typeof p === 'string' && p.trim());
  }

  function register(key, photos, title = '') {
    const list = cleanList(photos);
    if (!key) return 0;
    if (list.length) galleries.set(String(key), { photos: list, title });
    else galleries.delete(String(key));
    return list.length;
  }

  function attrs(key, index = 0) {
    return `data-hpv-key="${String(key).replace(/"/g, '&quot;')}" data-hpv-index="${Number(index) || 0}"`;
  }

  function estimateBytes(dataUrl) {
    const i = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || i < 0) return 0;
    const b64 = dataUrl.slice(i + 1);
    return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  }

  function fmtBytes(n) {
    if (!n) return '';
    return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  function extOf(dataUrl) {
    const m = /^data:image\/([\w.+-]+)/.exec(dataUrl);
    return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'jpg';
  }

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'hpv';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'hpvTitle');
    overlay.innerHTML = `
      <div class="hpv__bar">
        <div class="hpv__meta">
          <strong id="hpvTitle" class="hpv__title"></strong>
          <span class="hpv__count" aria-live="polite"></span>
        </div>
        <div class="hpv__tools">
          <button type="button" class="hpv__btn" data-hpv-act="zoom" aria-pressed="false" title="Perbesar (Z)">Perbesar</button>
          <a class="hpv__btn" data-hpv-act="download" download>Unduh</a>
          <button type="button" class="hpv__btn hpv__btn--close" data-hpv-act="close" title="Tutup (Esc)" aria-label="Tutup penampil foto">✕</button>
        </div>
      </div>
      <div class="hpv__stage" data-hpv-act="backdrop">
        <button type="button" class="hpv__nav hpv__nav--prev" data-hpv-act="prev" aria-label="Foto sebelumnya">‹</button>
        <img class="hpv__img" alt="" draggable="false">
        <button type="button" class="hpv__nav hpv__nav--next" data-hpv-act="next" aria-label="Foto berikutnya">›</button>
      </div>
      <div class="hpv__thumbs" role="tablist" aria-label="Daftar foto"></div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', onOverlayClick);
  }

  function render() {
    const { photos, index, title, zoom } = state;
    const src = photos[index];
    const img = overlay.querySelector('.hpv__img');
    img.src = src;
    img.alt = `${title || 'Foto lampiran'} — foto ${index + 1} dari ${photos.length}`;
    overlay.classList.toggle('hpv--zoom', zoom);
    overlay.querySelector('.hpv__title').textContent = title || 'Foto lampiran';
    const size = fmtBytes(estimateBytes(src));
    overlay.querySelector('.hpv__count').textContent = `${index + 1} / ${photos.length}${size ? ` · ${size}` : ''}`;
    const zoomBtn = overlay.querySelector('[data-hpv-act="zoom"]');
    zoomBtn.setAttribute('aria-pressed', String(zoom));
    zoomBtn.textContent = zoom ? 'Pas layar' : 'Perbesar';
    const dl = overlay.querySelector('[data-hpv-act="download"]');
    dl.href = src;
    dl.setAttribute('download', `${(title || 'foto-hse').replace(/[^\w.-]+/g, '-').toLowerCase()}-${index + 1}.${extOf(src)}`);
    const multi = photos.length > 1;
    overlay.querySelectorAll('.hpv__nav').forEach(b => { b.hidden = !multi; });
    const thumbs = overlay.querySelector('.hpv__thumbs');
    thumbs.hidden = !multi;
    thumbs.innerHTML = multi ? photos.map((p, i) => `
      <button type="button" class="hpv__thumb${i === index ? ' is-active' : ''}" role="tab" aria-selected="${i === index}"
        data-hpv-act="goto" data-hpv-goto="${i}" aria-label="Foto ${i + 1}">
        <img src="${p.replace(/"/g, '&quot;')}" alt="">
      </button>`).join('') : '';
  }

  function open(photos, index = 0, title = '') {
    const list = cleanList(photos);
    if (!list.length) return false;
    if (!overlay) build();
    state = {
      photos: list,
      index: Math.min(Math.max(Number(index) || 0, 0), list.length - 1),
      title,
      zoom: false,
      returnFocus: document.activeElement,
    };
    render();
    overlay.hidden = false;
    document.documentElement.classList.add('hpv-open');
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('[data-hpv-act="close"]').focus();
    return true;
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    overlay.querySelector('.hpv__img').removeAttribute('src');
    document.documentElement.classList.remove('hpv-open');
    document.removeEventListener('keydown', onKey, true);
    if (state.returnFocus && typeof state.returnFocus.focus === 'function') state.returnFocus.focus();
  }

  function go(delta) {
    const n = state.photos.length;
    if (n < 2) return;
    state.index = (state.index + delta + n) % n;
    state.zoom = false;
    render();
  }

  function onOverlayClick(e) {
    if (e.target.classList && e.target.classList.contains('hpv__img')) { state.zoom = !state.zoom; render(); return; }
    const el = e.target.closest('[data-hpv-act]');
    if (!el) return;
    const act = el.dataset.hpvAct;
    if (act === 'backdrop') { if (e.target === el) close(); return; }
    if (act === 'download') return; // biarkan browser mengunduh
    e.preventDefault();
    if (act === 'close') close();
    else if (act === 'prev') go(-1);
    else if (act === 'next') go(1);
    else if (act === 'zoom') { state.zoom = !state.zoom; render(); }
    else if (act === 'goto') { state.index = Number(el.dataset.hpvGoto) || 0; state.zoom = false; render(); }
  }

  function onKey(e) {
    if (!overlay || overlay.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'z' || e.key === 'Z') { state.zoom = !state.zoom; render(); }
    else if (e.key === 'Tab') {
      // Jaga fokus tetap di dalam penampil.
      const items = Array.from(overlay.querySelectorAll('button:not([hidden]), a[href]')).filter(x => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  // Delegasi klik untuk semua pemicu galeri di dashboard.
  function onDocumentClick(e) {
    const trigger = e.target.closest && e.target.closest('[data-hpv-key]');
    if (!trigger) return;
    const gallery = galleries.get(trigger.dataset.hpvKey);
    if (!gallery) return;
    e.preventDefault();
    e.stopPropagation();
    open(gallery.photos, Number(trigger.dataset.hpvIndex) || 0, gallery.title);
  }

  function onDocumentKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const trigger = e.target.closest && e.target.closest('[data-hpv-key]');
    if (!trigger || trigger.tagName === 'BUTTON' || trigger.tagName === 'A') return;
    onDocumentClick(e);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKey);
  }

  global.OMOSPhotoViewer = { register, attrs, open, close, _galleries: galleries };
})(typeof window !== 'undefined' ? window : globalThis);
