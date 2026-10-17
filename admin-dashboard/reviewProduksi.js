/*
 * Halaman "Review Produksi" — shell filter (judul, slicer periode, tombol
 * Pit/JOB hide-show). Grafik Pencapaian & Waterfall ditambahkan pada tahap
 * berikutnya; modul ini menyiapkan data + kontainer.
 * Read-only: seluruh angka berasal dari endpoint /api/admin/production/review-produksi.
 */
(function (global) {
  'use strict';

  const TZ_OFFSET_MS = 7 * 3600 * 1000; // WIB
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const state = {
    initialized: false,
    memuat: false,
    requestId: 0,
    dari: '',
    sampai: '',
    data: null,
    planningSource: 'flexible',
    pitAktif: new Set(),
    jobAktif: new Set(),
  };

  const root = () => document.getElementById('reviewProduksiRoot');
  const api = path => (typeof global.getProdApiUrl === 'function'
    ? global.getProdApiUrl(`/api/admin/production${path}`)
    : `/api/admin/production${path}`);
  const auth = () => (typeof global.getProdAuthHeaders === 'function' ? global.getProdAuthHeaders() : {});
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  // Operator-date WIB: "hari berjalan - 1" sebagai default periode.
  function tanggalWib(offsetHari) {
    const now = new Date(Date.now() + TZ_OFFSET_MS);
    now.setUTCDate(now.getUTCDate() + (offsetHari || 0));
    return now.toISOString().slice(0, 10);
  }

  function formatTanggal(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) return iso || '—';
    return `${Number(match[3])} ${BULAN[Number(match[2]) - 1]} ${match[1]}`;
  }

  function shell() {
    return `
      <header style="margin-bottom:16px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div>
          <h2 style="margin:0;font-size:20px;font-weight:800;color:#0f172a;">Review Performa Produksi</h2>
          <p style="margin:2px 0 0 0;font-size:13px;color:#64748b;">Analisis pencapaian produksi dan dekomposisi loss &amp; gain (Plan → PA → UA → Productivity → Data Quality → Aktual).</p>
        </div>
        <details id="rpPlanningSourceMenu" style="position:relative;margin-left:auto;z-index:8;">
          <summary id="rpPlanningSourceButton" class="tombol" style="list-style:none;cursor:pointer;background:#0f766e;color:#fff;border:1px solid #0f766e;border-radius:9px;padding:9px 13px;font-weight:800;box-shadow:0 5px 14px rgba(15,118,110,.18);">Source Planning · Aktual ▾</summary>
          <div style="position:absolute;right:0;top:calc(100% + 7px);width:310px;padding:8px;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 14px 35px rgba(15,23,42,.18);display:grid;gap:6px;">
            <button type="button" data-rp-planning-source="flexible" style="text-align:left;border:0;border-radius:8px;padding:10px;background:#ecfdf5;color:#0f172a;cursor:pointer;"><b>Aktual</b><small style="display:block;margin-top:3px;color:#475569;">Plan efektif 0.5/0.6; PIT mengikuti konteks aktual.</small></button>
            <button type="button" data-rp-planning-source="conservative" style="text-align:left;border:0;border-radius:8px;padding:10px;background:#f8fafc;color:#0f172a;cursor:pointer;"><b>Fleet Deployment</b><small style="display:block;margin-top:3px;color:#475569;">Unit, PIT, JOB, dan material wajib cocok dengan 0.8.</small></button>
            <button type="button" data-rp-planning-source="fleet_material" style="text-align:left;border:0;border-radius:8px;padding:10px;background:#f8fafc;color:#0f172a;cursor:pointer;"><b>Fleet x Material</b><small style="display:block;margin-top:3px;color:#475569;">Fleet dari 0.8; material dan productivity dari 0.5/0.6.</small></button>
          </div>
        </details>
      </header>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:#334155;">Periode dari
          <input id="rpDari" type="date" class="input-filter" style="font-weight:700;color:#0f172a;border:1.5px solid #0f3460;background:#fff;">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:#334155;">sampai
          <input id="rpSampai" type="date" class="input-filter" style="font-weight:700;color:#0f172a;border:1.5px solid #0f3460;background:#fff;">
        </label>
        <button id="rpMuatUlang" class="tombol tombol--ghost" type="button">🔄 Muat Ulang</button>
      </div>
      <p id="rpInfoPeriode" style="margin:0 0 5px 0;color:#000;font-weight:700;font-size:13px;"></p>
      <p id="rpInfoPlanningSource" style="margin:0 0 12px 0;color:#475569;font-size:12px;"></p>
      <div id="rpPitBar" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;"></div>
      <div id="rpJobBar" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px;"></div>
      <div id="rpDataArea" hidden>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="tabel-wrap" style="padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
            <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Pencapaian Produksi <span style="font-weight:400;font-size:12px;color:#64748b;">(Plan vs Aktual per Pit &amp; JOB)</span></h3>
            <div id="rpChartPencapaian" style="position:relative;height:340px;"><canvas id="rpCanvasPencapaian"></canvas></div>
          </div>
          <div class="tabel-wrap" style="padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
            <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Pareto</h3>
            <div id="rpPareto"><p class="tabel__kosong">Memuat pareto…</p></div>
          </div>
        </div>
        <div class="tabel-wrap" style="padding:12px;margin-bottom:16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
          <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Ringkasan per Pit &amp; JOB</h3>
          <div id="rpTabelKategori"></div>
        </div>
        <div class="tabel-wrap" style="padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
          <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Waterfall Loss &amp; Gain <span style="font-weight:400;font-size:12px;color:#64748b;">(Plan → ΔPA → ΔUA → Productivity → Other Fleet → Aktual)</span></h3>
          <div style="position:relative;height:380px;"><canvas id="rpCanvasWaterfall"></canvas></div>
          <div id="rpBadgeRekonsiliasi" style="margin-top:8px;font-size:12px;"></div>
        </div>
        <div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);gap:16px;">
          <div class="tabel-wrap" style="padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
            <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Fleet planned <span id="rpFleetPlannedCaption" style="font-weight:400;font-size:12px;color:#64748b;">(plan efektif 0.5/0.6)</span></h3>
            <div id="rpUnitPlanned"></div>
          </div>
          <div class="tabel-wrap" style="padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
            <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Other / Data Quality <span id="rpOtherCaption" style="font-weight:400;font-size:12px;color:#64748b;">(aktual tanpa plan yang cocok)</span></h3>
            <div id="rpUnitOtherFleet"></div>
          </div>
        </div>
        <div class="tabel-wrap" style="padding:12px;margin-top:16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
          <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Waterfall PA <span style="font-weight:400;font-size:12px;color:#64748b;">(bedah ΔPA per kategori breakdown)</span></h3>
          <div id="rpPaWaterfall"><p class="tabel__kosong">Menunggu data…</p></div>
          <div style="position:relative;height:300px;margin-top:12px;"><canvas id="rpCanvasPaWaterfall"></canvas></div>
          <div id="rpPaBadge" style="margin-top:8px;font-size:12px;"></div>
        </div>
        <div class="tabel-wrap" style="padding:12px;margin-top:16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;">
          <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Waterfall UA <span style="font-weight:400;font-size:12px;color:#64748b;">(dampak plan delay SPO vs standby aktual)</span></h3>
          <div id="rpUaWaterfall"><p class="tabel__kosong">Menunggu data…</p></div>
          <div style="position:relative;height:300px;margin-top:12px;"><canvas id="rpCanvasUaWaterfall"></canvas></div>
          <div id="rpUaBadge" style="margin-top:8px;font-size:12px;"></div>
        </div>
      </div>`;
  }

  function tombolAktif(aktif) {
    return aktif
      ? 'background:#0f3460;color:#fff;border:1.5px solid #0f3460;font-weight:800;'
      : 'background:#fff;color:#0f3460;border:1.5px solid #0f3460;font-weight:700;';
  }

  function renderPitBar(pits) {
    const bar = document.getElementById('rpPitBar');
    if (!bar) return;
    bar.innerHTML = `<span style="font-size:12px;font-weight:800;color:#334155;">Pit Area:</span>`
      + (pits.length
        ? pits.map(pit => `<button type="button" class="tombol" data-rp-pit="${esc(pit)}" aria-pressed="${state.pitAktif.has(pit)}" style="${tombolAktif(state.pitAktif.has(pit))}border-radius:8px;padding:6px 12px;">${esc(pit)}</button>`).join('')
        : '<span style="font-size:12px;color:#94a3b8;">Belum ada pit area di List Equipment.</span>');
  }

  function renderJobBar(jobs) {
    const bar = document.getElementById('rpJobBar');
    if (!bar) return;
    bar.innerHTML = `<span style="font-size:12px;font-weight:800;color:#334155;">JOB:</span>`
      + (jobs.length
        ? jobs.map(job => `<button type="button" class="tombol" data-rp-job="${esc(job)}" aria-pressed="${state.jobAktif.has(job)}" style="${tombolAktif(state.jobAktif.has(job))}border-radius:8px;padding:6px 12px;">${esc(job)}</button>`).join('')
        : '<span style="font-size:12px;color:#94a3b8;">Belum ada JOB deployed di SPO.</span>');
  }

  function updateAreaVisibility() {
    const area = document.getElementById('rpDataArea');
    if (!area) return;
    // Data tampil hanya bila pit DAN job sudah terpilih (seleksi tunggal).
    area.hidden = !(state.pitAktif.size && state.jobAktif.size);
  }

  function updateInfoPeriode() {
    const el = document.getElementById('rpInfoPeriode');
    if (!el) return;
    const dari = state.dari ? formatTanggal(state.dari) : '—';
    const sampai = state.sampai ? formatTanggal(state.sampai) : '—';
    el.textContent = `Periode terpilih: ${dari} – ${sampai}`;
  }

  function updatePlanningSourceUi() {
    const configs = {
      flexible: {
        label: 'Aktual',
        info: '<b>Aktual:</b> plan efektif halaman 0.5/0.6 dicocokkan dengan tanggal, unit, JOB, material, dan satuan; PIT mengikuti aktual.',
        planned: '(plan efektif 0.5/0.6)',
        other: '(aktual tanpa plan efektif yang cocok)',
      },
      conservative: {
        label: 'Fleet Deployment',
        info: '<b>Fleet Deployment:</b> plan halaman 0.8 dicocokkan penuh sampai material; konteks di luar plotting masuk Other Fleet.',
        planned: '(plotting penuh 0.8 Fleet Deployment)',
        other: '(unit, PIT, JOB, atau material di luar plotting)',
      },
      fleet_material: {
        label: 'Fleet x Material',
        info: '<b>Fleet x Material:</b> unit, PIT, JOB, dan tanggal mengikuti 0.8; material serta productivity mengikuti plan efektif 0.5/0.6.',
        planned: '(fleet 0.8 × material efektif 0.5/0.6)',
        other: '(Other Fleet hanya unit yang tidak terdeploy; plan material yang hilang ditandai terpisah)',
      },
    };
    const config = configs[state.planningSource] || configs.flexible;
    const button = document.getElementById('rpPlanningSourceButton');
    if (button) button.textContent = `Source Planning · ${config.label} ▾`;
    const info = document.getElementById('rpInfoPlanningSource');
    if (info) info.innerHTML = config.info;
    const planned = document.getElementById('rpFleetPlannedCaption');
    if (planned) planned.textContent = config.planned;
    const other = document.getElementById('rpOtherCaption');
    if (other) other.textContent = config.other;
    document.querySelectorAll('[data-rp-planning-source]').forEach(item => {
      const active = item.dataset.rpPlanningSource === state.planningSource;
      item.setAttribute('aria-pressed', String(active));
      item.style.outline = active ? '2px solid #0f766e' : 'none';
    });
  }

  function kategoriTerpilih() {
    const data = state.data;
    if (!data || !Array.isArray(data.kategori)) return [];
    return data.kategori.filter(k => {
      const pitOk = !state.pitAktif.size || state.pitAktif.has(k.pit);
      const jobOk = !state.jobAktif.size || state.jobAktif.has(k.jobCode);
      return pitOk && jobOk;
    });
  }

  async function muatData() {
    const requestId = ++state.requestId;
    const dari = document.getElementById('rpDari')?.value || state.dari;
    const sampai = document.getElementById('rpSampai')?.value || state.sampai;
    if (!dari || !sampai || sampai < dari) {
      global.OMOSActionFeedback?.status(document.getElementById('rpInfoPeriode'), 'error', 'Periode tidak valid.');
      return;
    }
    state.dari = dari; state.sampai = sampai;
    updateInfoPeriode();
    state.memuat = true;
    try {
      const params = new URLSearchParams({ tanggal_dari: dari, tanggal_sampai: sampai, planning_source: state.planningSource });
      const response = await fetch(api(`/review-produksi?${params.toString()}`), {
        headers: { ...auth() }, cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gagal memuat data review produksi.');
      if (requestId !== state.requestId) return;
      state.data = data;
      renderPitBar(data.pits || []);
      renderJobBar(data.jobs || []);
      updateAreaVisibility();
      if (typeof global.ReviewProduksiRender === 'function') {
        global.ReviewProduksiRender(kategoriTerpilih());
      }
      muatPareto();
    } catch (error) {
      if (requestId !== state.requestId) return;
      state.data = null;
      const el = document.getElementById('rpInfoPeriode');
      if (el) el.textContent = `Gagal memuat: ${error.message}`;
    } finally {
      if (requestId === state.requestId) state.memuat = false;
    }
  }

  function onClick(event) {
    const sourceButton = event.target.closest('[data-rp-planning-source]');
    if (sourceButton) {
      const source = sourceButton.dataset.rpPlanningSource;
      if (!['flexible', 'conservative', 'fleet_material'].includes(source)) return;
      state.planningSource = source;
      document.getElementById('rpPlanningSourceMenu')?.removeAttribute('open');
      updatePlanningSourceUi();
      muatData();
      return;
    }
    const pitBtn = event.target.closest('[data-rp-pit]');
    if (pitBtn) {
      const pit = pitBtn.dataset.rpPit;
      // Seleksi tunggal: klik pindah pilihan, klik yang aktif melepasnya.
      if (state.pitAktif.has(pit)) state.pitAktif.clear(); else { state.pitAktif.clear(); state.pitAktif.add(pit); }
      renderPitBar(state.data?.pits || []);
      updateAreaVisibility();
      if (typeof global.ReviewProduksiRender === 'function') global.ReviewProduksiRender(kategoriTerpilih());
      muatPareto();
      return;
    }
    const jobBtn = event.target.closest('[data-rp-job]');
    if (jobBtn) {
      const job = jobBtn.dataset.rpJob;
      // Seleksi tunggal: klik pindah pilihan, klik yang aktif melepasnya.
      if (state.jobAktif.has(job)) state.jobAktif.clear(); else { state.jobAktif.clear(); state.jobAktif.add(job); }
      renderJobBar(state.data?.jobs || []);
      updateAreaVisibility();
      if (typeof global.ReviewProduksiRender === 'function') global.ReviewProduksiRender(kategoriTerpilih());
      muatPareto();
    }
  }

  async function init() {
    const host = root();
    if (!host) return;
    if (!state.initialized) {
      host.innerHTML = shell();
      updatePlanningSourceUi();
      state.dari = tanggalWib(-1);
      state.sampai = tanggalWib(-1);
      document.getElementById('rpDari').value = state.dari;
      document.getElementById('rpSampai').value = state.sampai;
      document.getElementById('rpDari').addEventListener('change', muatData);
      document.getElementById('rpSampai').addEventListener('change', muatData);
      document.getElementById('rpMuatUlang').addEventListener('click', muatData);
      host.addEventListener('click', onClick);
      state.initialized = true;
    }
    updateInfoPeriode();
    await muatData();
  }

  // ===== Tahap 4 & 5: grafik Pencapaian + Waterfall =====
  let chartPencapaian = null;
  let chartWaterfall = null;
  let kategoriTerakhir = [];
  let hasilTerakhir = [];
  let paretoTerakhir = null;
  let paretoErrorTerakhir = null;

  function panggilPaWaterfall() {
    if (typeof global.ReviewPaWaterfallRender !== 'function') {
      console.error('[ReviewProduksi] modul reviewPaWaterfall.js belum termuat.');
      return;
    }
    global.ReviewPaWaterfallRender({
      kategori: kategoriTerakhir, hasil: hasilTerakhir, pareto: paretoTerakhir, paretoError: paretoErrorTerakhir,
      periode: state.dari && state.sampai ? `${formatTanggal(state.dari)} – ${formatTanggal(state.sampai)}` : '',
      job: [...state.jobAktif].join(', '),
    });
    if (typeof global.ReviewUaWaterfallRender !== 'function') {
      console.error('[ReviewProduksi] modul reviewUaWaterfall.js belum termuat.');
      return;
    }
    global.ReviewUaWaterfallRender({
      kategori: kategoriTerakhir, hasil: hasilTerakhir, pareto: paretoTerakhir, paretoError: paretoErrorTerakhir,
      periode: state.dari && state.sampai ? `${formatTanggal(state.dari)} – ${formatTanggal(state.sampai)}` : '',
      job: [...state.jobAktif].join(', '),
    });
  }

  // Label angka di atas batang (tanpa plugin eksternal): volume hitam tebal,
  // plus % achievement di bawahnya khusus batang Aktual (mode pencapaian).
  // Mode waterfall: tiap segmen menampilkan volumenya (Plan/Aktual = total,
  // segmen lain = delta bertanda).
  const pluginLabelAtas = {
    id: 'rpLabelAtas',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = '#000';
      if (chart.$rpMode === 'waterfall') {
        const meta = chart.getDatasetMeta(0);
        meta.data.forEach((bar, i) => {
          if (!bar) return;
          const raw = chart.data.datasets[0].data[i];
          if (!Array.isArray(raw)) return;
          const label = chart.data.labels[i];
          let teks;
          if (label === 'Plan' || label === 'Aktual') {
            if (!Number.isFinite(Number(raw[1]))) return;
            teks = fmt(raw[1]);
          } else {
            const delta = Number(raw[1]) - Number(raw[0]);
            if (!Number.isFinite(delta)) return;
            teks = `${delta >= 0 ? '+' : ''}${fmt(delta)}`;
          }
          ctx.fillText(teks, bar.x, bar.y - 12);
        });
        ctx.restore();
        return;
      }
      const pct = chart.$rpPct;
      const ds0 = chart.data.datasets[0] || { data: [] };
      const ds1 = chart.data.datasets[1] || { data: [] };
      const meta0 = chart.getDatasetMeta(0);
      const meta1 = chart.getDatasetMeta(1);
      const jumlahBar = Math.max(meta0.data.length, meta1.data.length);
      for (let i = 0; i < jumlahBar; i++) {
        const bar0 = meta0.data[i]; const bar1 = meta1.data[i];
        const v0 = Number(ds0.data[i]); const v1 = Number(ds1.data[i]);
        // Volume hitam tebal tetap di atas tiap batang.
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#000';
        if (bar0 && Number.isFinite(v0)) ctx.fillText(fmt(v0), bar0.x, bar0.y - 12);
        if (bar1 && Number.isFinite(v1)) ctx.fillText(fmt(v1), bar1.x, bar1.y - 12);
        // Lencana % di tengah kedua batang: lingkaran 3D kuning tua.
        if (!bar0 || !bar1) continue;
        if (!Array.isArray(pct) || !Number.isFinite(Number(pct[i]))) continue;
        const angka = Number(pct[i]).toFixed(2);
        ctx.font = 'bold 11px system-ui, sans-serif';
        const r = Math.max(18, ctx.measureText(angka).width / 2 + 6);
        // Horizontal: tengah antara bar Plan & Aktual.
        // Vertikal (top-down): tengah tinggi batang Plan.
        const cx = (bar0.x + bar1.x) / 2;
        const bawahPlan = Number.isFinite(bar0.base) ? bar0.base : chart.chartArea.bottom;
        let cy = (bar0.y + bawahPlan) / 2;
        if (cy - r < chart.chartArea.top) cy = chart.chartArea.top + r;
        if (cy + r > chart.chartArea.bottom) cy = chart.chartArea.bottom - r;
        ctx.save();
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'middle';
        ctx.fillText(angka, cx, cy - 6);
        ctx.fillText('%', cx, cy + 6);
        ctx.restore();
      }
      ctx.restore();
    },
  };

  const fmt = (value, digits) => (value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 }));
  const fmtPersen = value => (value == null || !Number.isFinite(Number(value)) ? 'N/A' : `${Number(value).toFixed(2)}%`);

  // PPlan = totalEWH x Prod_plan (totalEWH sudah menjumlah seluruh unit x hari).
  function nilaiKategori(k) {
    const core = global.ReviewProduksiCore || {};
    const value = key => k[key] != null && Number.isFinite(Number(k[key])) ? Number(k[key]) : null;
    const pPlan = value('pPlan');
    const paAktual = typeof core.hitungPAAktual === 'function' ? core.hitungPAAktual(k.hm, k.standby, k.breakdown) : null;
    const uaAktual = typeof core.hitungUAAktual === 'function' ? core.hitungUAAktual(k.hm, k.standby) : null;
    const dppa = value('dppa'); const dpua = value('dpua'); const dprod = value('dProd');
    const fleet = Number(k.produksiFleet) || 0;
    const other = (Number(k.produksiOtherFleet) || 0) + (Number(k.produksiMissingPlan) || 0);
    const rekonsiliasi = typeof core.cekRekonsiliasi === 'function' ? core.cekRekonsiliasi({ pPlan, dppa, dpua, dprod, aktualFleet: fleet }) : null;
    const achievement = (pPlan != null && pPlan > 0) ? ((fleet + other) / pPlan * 100) : null;
    return { pPlan, paAktual, uaAktual, dppa, dpua, dprod, fleet, other,
      totalAktual: fleet + other, unit: k.unit, rekonsiliasi, achievement };
  }

  function renderTabelKategori(kategori, hasil) {
    const host = document.getElementById('rpTabelKategori');
    if (!host) return;
    if (!kategori.length) { host.innerHTML = '<p class="tabel__kosong">Tidak ada data untuk filter terpilih.</p>'; return; }
    host.innerHTML = `<div class="tabel-wrap"><table class="tabel" style="font-size:12px;">
      <thead><tr><th>Pit</th><th>JOB</th><th>Unit</th><th>Plan</th><th>ΔPA</th><th>ΔUA</th><th>ΔProd</th><th>Aktual (fleet)</th><th>Other Fleet</th><th>Total</th><th>Achievement</th><th>PA aktual</th><th>UA aktual</th><th>Rekonsiliasi</th></tr></thead>
      <tbody>${kategori.map((k, i) => {
        const h = hasil[i];
        return `<tr>
          <td>${esc(k.pit)}</td><td>${esc(k.jobCode)}</td><td>${esc(h.unit)}</td>
          <td>${fmt(h.pPlan)}</td>
          <td>${fmt(h.dppa)}</td><td>${fmt(h.dpua)}</td><td>${fmt(h.dprod)}</td>
          <td>${fmt(h.fleet)}</td><td>${fmt(h.other)}</td><td>${fmt(h.totalAktual)}</td>
          <td>${h.achievement == null ? 'N/A' : fmtPersen(h.achievement)}</td>
          <td>${h.paAktual == null ? '—' : fmtPersen(h.paAktual * 100)}</td>
          <td>${h.uaAktual == null ? '—' : fmtPersen(h.uaAktual * 100)}</td>
          <td>${h.rekonsiliasi && h.rekonsiliasi.reconciled ? '✅' : '⚠️'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function renderPencapaian(kategori, hasil) {
    const chartLib = global.Chart;
    if (!chartLib) return;
    const labels = kategori.map(k => `${k.pit} · ${k.jobCode}`);
    if (chartPencapaian) { chartPencapaian.destroy(); chartPencapaian = null; }
    const canvas = document.getElementById('rpCanvasPencapaian');
    const g2d = canvas.getContext('2d');
    const gradasi = (atas, bawah) => {
      const g = g2d.createLinearGradient(0, 0, 0, 340);
      g.addColorStop(0, atas); g.addColorStop(1, bawah);
      return g;
    };
    const biru = gradasi('#93c5fd', '#2563eb');
    const hijau = gradasi('#4ade80', '#15803d');
    const merah = gradasi('#fca5a5', '#dc2626');
    const netral = gradasi('#cbd5e1', '#64748b');
    // Aktual kondisional vs Plan: >= plan hijau, < plan merah.
    const warnaAktual = hasil.map(h => {
      const plan = Number(h.pPlan); const aktual = Number(h.totalAktual);
      if (!Number.isFinite(plan) || !Number.isFinite(aktual)) return netral;
      return aktual >= plan ? hijau : merah;
    });
    chartPencapaian = new chartLib(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Plan', data: hasil.map(h => h.pPlan), backgroundColor: hasil.map(() => biru), borderColor: '#1d4ed8', borderWidth: 1, borderRadius: 6 },
          { label: 'Aktual', data: hasil.map(h => h.totalAktual), backgroundColor: warnaAktual, borderColor: '#0f172a', borderWidth: 1, borderRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Produksi' } },
        },
      },
      plugins: [pluginLabelAtas],
    });
    chartPencapaian.$rpPct = hasil.map(h => h.achievement);
  }

  function renderWaterfall(kategori, hasil) {
    const chartLib = global.Chart;
    if (!chartLib) return;
    const sum = key => hasil.reduce((total, h) => total + (Number(h[key]) || 0), 0);
    const pPlan = hasil.some(h => h.pPlan != null) ? sum('pPlan') : null;
    const dppa = sum('dppa');
    const dpua = sum('dpua');
    const dprod = sum('dprod');
    const other = sum('other');
    const fleet = sum('fleet');

    const rPlan = pPlan == null ? 0 : pPlan;
    const rPaEnd = rPlan + dppa;
    const rUaEnd = rPaEnd + dpua;
    const rProdEnd = rUaEnd + dprod;
    const rOtherEnd = rProdEnd + other;
    const data = [[0, rPlan], [rPlan, rPaEnd], [rPaEnd, rUaEnd], [rUaEnd, rProdEnd], [rProdEnd, rOtherEnd], [0, fleet + other]];
    const background = ['#3b82f6', dppa >= 0 ? '#16a34a' : '#dc2626', dpua >= 0 ? '#16a34a' : '#dc2626', dprod >= 0 ? '#16a34a' : '#dc2626', '#f59e0b', '#1e3a8a'];

    if (chartWaterfall) { chartWaterfall.destroy(); chartWaterfall = null; }
    chartWaterfall = new chartLib(document.getElementById('rpCanvasWaterfall'), {
      type: 'bar',
      data: {
        labels: ['Plan', 'PA', 'UA', 'Productivity', 'Other Fleet', 'Aktual'],
        datasets: [{ label: 'Waterfall', data, backgroundColor: background, borderRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => {
            const [start, end] = ctx.raw;
            if (ctx.label === 'Plan' || ctx.label === 'Aktual') return `${ctx.label}: ${fmt(end)}`;
            const delta = end - start;
            return `${ctx.label}: ${delta >= 0 ? '+' : ''}${fmt(delta)}`;
          } } },
        },
        scales: {
          x: { ticks: { font: { size: 17, weight: 'bold' }, color: '#000' } },
          y: { beginAtZero: true, title: { display: true, text: 'Produksi' } },
        },
      },
      plugins: [pluginLabelAtas],
    });
    chartWaterfall.$rpMode = 'waterfall';

    const badge = document.getElementById('rpBadgeRekonsiliasi');
    if (badge) {
      if (pPlan == null) {
        badge.innerHTML = '<span style="color:#b45309;font-weight:700;">⚠️ Plan belum dapat dihitung — periksa PA plan, delay SPO dan productivity pada Source Planning terpilih.</span>';
      } else {
        const rek = global.ReviewProduksiCore?.cekRekonsiliasi({ pPlan, dppa, dpua, dprod, aktualFleet: fleet });
        if (rek && rek.reconciled) {
          badge.innerHTML = `<span style="color:#15803d;font-weight:700;">✅ Rekonsiliasi fleet terhitung cocok</span> · Plan ${fmt(pPlan)} + ΔPA ${fmt(dppa)} + ΔUA ${fmt(dpua)} + ΔProd ${fmt(dprod)} = ${fmt(rek.total)} ≈ Aktual ${fmt(fleet)} (selisih ${fmt(rek.selisih)})`;
        } else {
          badge.innerHTML = `<span style="color:#b45309;font-weight:700;">⚠️ Rekonsiliasi tidak persis</span> · fleet-expected ${fmt(rek?.total)} vs Aktual ${fmt(fleet)} (selisih ${fmt(rek?.selisih)})`;
        }
      }
    }
  }

  function renderDaftarUnit(kategori) {
    const plannedHost = document.getElementById('rpUnitPlanned');
    const otherHost = document.getElementById('rpUnitOtherFleet');
    if (!plannedHost || !otherHost) return;
    const plannedMap = new Map();
    const otherMap = new Map();
    for (const k of kategori) {
      for (const u of (Array.isArray(k.unitPlanned) ? k.unitPlanned : [])) {
        const cur = plannedMap.get(u.unit) || { produksi: 0, plan: 0, planAda: false, ewhPlan: 0, hm: 0, mohh: 0,
          paPlanSum: 0, paPlanN: 0, paAktSum: 0, paAktN: 0, uaPlanSum: 0, uaPlanN: 0, uaAktSum: 0, uaAktN: 0 };
        cur.produksi += Number(u.produksi) || 0;
        if (u.plan != null && Number.isFinite(Number(u.plan))) { cur.plan += Number(u.plan); cur.planAda = true; }
        cur.ewhPlan += Number(u.ewhPlan) || 0;
        cur.hm += Number(u.hmAktual) || 0;
        cur.mohh += Number(u.mohhAktual) || 0;
        cur.paPlanSum += Number(u.availablePlanHours) || 0;
        cur.paPlanN += Number(u.schedulePlanHours) || 0;
        cur.paAktSum += Number(u.availableActualHours) || 0;
        cur.paAktN += Number(u.mohhAktual) || 0;
        cur.uaPlanSum += Number(u.ewhPlan) || 0;
        cur.uaPlanN += Number(u.availablePlanHours) || 0;
        cur.uaAktSum += Number(u.hmAktual) || 0;
        cur.uaAktN += Number(u.availableActualHours) || 0;
        plannedMap.set(u.unit, cur);
      }
      for (const u of [...(k.unitOtherFleet || []), ...(k.unitMissingPlan || [])]) {
        const key = `${u.unit}|${u.material || '—'}|${u.reason || 'Unplanned'}`;
        const current = otherMap.get(key) || { unit: u.unit, material: u.material || '—', reason: u.reason || 'Unplanned', produksi: 0 };
        current.produksi += Number(u.produksi) || 0;
        otherMap.set(key, current);
      }
    }
    const plannedRows = [...plannedMap.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (!plannedRows.length) {
      plannedHost.innerHTML = '<p class="tabel__kosong">Tidak ada unit terplotting untuk kriteria ini.</p>';
    } else {
      plannedHost.innerHTML = `<div class="tabel-wrap"><table class="tabel" style="font-size:12px;">
        <thead><tr><th rowspan="2">Unit Excavator</th><th colspan="2" style="text-align:center;">EWH</th><th colspan="2" style="text-align:center;">Productivity</th><th colspan="2" style="text-align:center;">Produksi</th><th colspan="2" style="text-align:center;">PA</th><th colspan="2" style="text-align:center;">UA</th><th rowspan="2" style="text-align:center;">MOHH</th></tr>
        <tr><th style="text-align:right;">Plan</th><th style="text-align:right;">Aktual</th><th style="text-align:right;">Plan</th><th style="text-align:right;">Aktual</th><th style="text-align:right;">Plan</th><th style="text-align:right;">Aktual</th><th style="text-align:right;">Plan</th><th style="text-align:right;">Aktual</th><th style="text-align:right;">Plan</th><th style="text-align:right;">Aktual</th></tr></thead>
        <tbody>${plannedRows.map(([unit, v]) => {
          const prodPlan = (v.planAda && v.ewhPlan > 0) ? fmt(v.plan / v.ewhPlan, 2) : '—';
          const prodAkt = v.hm > 0 ? fmt(v.produksi / v.hm, 2) : '—';
          const persen = (sum, n) => (n > 0 ? fmtPersen((sum / n) * 100) : '—');
          return `<tr><td>${esc(unit)}</td><td style="text-align:right;">${fmt(v.ewhPlan)}</td><td style="text-align:right;">${fmt(v.hm)}</td><td style="text-align:right;">${prodPlan}</td><td style="text-align:right;">${prodAkt}</td><td style="text-align:right;">${v.planAda ? fmt(v.plan) : '—'}</td><td style="text-align:right;">${fmt(v.produksi)}</td><td style="text-align:right;">${persen(v.paPlanSum, v.paPlanN)}</td><td style="text-align:right;">${persen(v.paAktSum, v.paAktN)}</td><td style="text-align:right;">${persen(v.uaPlanSum, v.uaPlanN)}</td><td           style="text-align:right;">${persen(v.uaAktSum, v.uaAktN)}</td><td style="text-align:right;">${fmt(v.mohh)}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    }
    const render = (map, host, kosongMsg) => {
      const rows = [...map.values()].sort((a, b) => String(a.unit).localeCompare(String(b.unit)) || String(a.material).localeCompare(String(b.material)));
      if (!rows.length) { host.innerHTML = `<p class="tabel__kosong">${kosongMsg}</p>`; return; }
      host.innerHTML = `<div class="tabel-wrap"><table class="tabel" style="font-size:12px;">
        <thead><tr><th>Unit Excavator</th><th>Material</th><th>Status</th><th style="text-align:right;">Aktual</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${esc(row.unit)}</td><td>${esc(row.material)}</td><td><span style="display:inline-block;padding:3px 7px;border-radius:999px;background:#fff7ed;color:#9a3412;font-weight:700;">${esc(row.reason)}</span></td><td style="text-align:right;">${fmt(row.produksi)}</td></tr>`).join('')}</tbody></table></div>`;
    };
    render(otherMap, otherHost, 'Tidak ada Other Fleet atau data productivity yang belum lengkap.');
  }

  global.ReviewProduksiRender = function (kategori) {
    const list = Array.isArray(kategori) ? kategori : [];
    if (new Set(list.map(row => row.unit)).size > 1) {
      kategoriTerakhir = []; hasilTerakhir = [];
      for (const chart of [chartPencapaian, chartWaterfall]) if (chart) chart.destroy();
      chartPencapaian = null; chartWaterfall = null;
      panggilPaWaterfall();
      for (const id of ['rpTabelKategori', 'rpUnitPlanned', 'rpUnitOtherFleet', 'rpBadgeRekonsiliasi']) {
        const host = document.getElementById(id);
        if (host) host.innerHTML = '<p class="tabel__kosong">Pilih satu JOB/satuan. BCM dan Ton ditampilkan terpisah.</p>';
      }
      return;
    }
    const hasil = list.map(nilaiKategori);
    kategoriTerakhir = list; hasilTerakhir = hasil;
    renderTabelKategori(list, hasil);
    renderPencapaian(list, hasil);
    renderWaterfall(list, hasil);
    renderDaftarUnit(list);
    panggilPaWaterfall();
  };

  // ===== Pareto Mining Intelligence (sumber: endpoint review-produksi/pareto) =====
  let paretoMemuat = false;
  let paretoRequestId = 0;

  async function muatPareto() {
    const host = document.getElementById('rpPareto');
    if (!host || !state.data) return;
    const requestId = ++paretoRequestId;
    paretoMemuat = true;
    host.innerHTML = '<p class="tabel__kosong">Memuat pareto…</p>';
    try {
      const params = new URLSearchParams({ tanggal_dari: state.dari, tanggal_sampai: state.sampai });
      params.set('planning_source', state.planningSource);
      if (state.pitAktif.size === 1) params.set('pit', [...state.pitAktif][0]);
      if (state.jobAktif.size === 1) params.set('job', [...state.jobAktif][0]);
      const response = await fetch(api(`/review-produksi/pareto?${params.toString()}`), {
        headers: { ...auth() }, cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gagal memuat pareto.');
      if (requestId !== paretoRequestId) return;
      paretoTerakhir = data;
      paretoErrorTerakhir = null;
      renderPareto(data);
      panggilPaWaterfall();
    } catch (error) {
      if (requestId !== paretoRequestId) return;
      paretoErrorTerakhir = error.message;
      host.innerHTML = `<p class="tabel__kosong">Pareto gagal dimuat: ${esc(error.message)}</p>`;
      panggilPaWaterfall();
    } finally {
      if (requestId === paretoRequestId) paretoMemuat = false;
    }
  }

  function renderPareto(data) {
    const host = document.getElementById('rpPareto');
    if (!host) return;
    const core = global.ReviewParetoCore || {};
    const selected = kategoriTerpilih();
    if (new Set(selected.map(row => row.unit)).size > 1) {
      host.innerHTML = '<p class="tabel__kosong">Pilih satu JOB/satuan untuk analisis dampak.</p>';
      return;
    }
    const hasil = selected.map(nilaiKategori);
    const jumlah = key => {
      const nilai = hasil.map(h => Number(h[key])).filter(v => Number.isFinite(v));
      return nilai.length ? nilai.reduce((total, v) => total + v, 0) : null;
    };
    const pPlan = hasil.some(h => h.pPlan != null) ? jumlah('pPlan') : null;
    const periode = state.dari && state.sampai ? `${formatTanggal(state.dari)} – ${formatTanggal(state.sampai)}` : '';
    const jobLabel = [...state.jobAktif].join(', ') || (data && data.filters && data.filters.job) || '';

    const seksi = [];
    const dppa = jumlah('dppa'); const dpua = jumlah('dpua'); const dprod = jumlah('dprod');
    if (typeof core.shouldShow === 'function' && core.shouldShow(dppa, pPlan)) {
      const items = selected.flatMap(row => row.paWaterfall?.items || []).filter(row => row.key.startsWith('BD:'))
        .map(row => ({ kategori: row.description, jam: row.hours }));
      const jadi = core.buildPaText({ delta: dppa, pPlan, periode, job: jobLabel, items });
      if (jadi) jadi.smartText = `Dampak PA/jam tersedia ${fmt(dppa)} ${selected[0]?.unit || ''}. Rincian jam breakdown di atas bersifat deskriptif; budget plan dan selisih cakupan waktu dijelaskan pada Waterfall PA.`;
      if (jadi) seksi.push(jadi);
    }
    if (typeof core.shouldShow === 'function' && core.shouldShow(dpua, pPlan)) {
      const items = selected.flatMap(row => row.uaWaterfall?.items || []).map(row => ({ kategori: row.description, jam: row.actualHours }));
      const jadi = core.buildUaText({ delta: dpua, pPlan, periode, job: jobLabel, items });
      if (jadi) jadi.smartText = `Dampak UA ${fmt(dpua)} ${selected[0]?.unit || ''}, dihitung dari selisih Plan Delay SPO dan aktual × productivity plan per konteks. Jam standby terbesar tidak selalu menjadi loss terbesar; lihat Waterfall UA.`;
      if (jadi) seksi.push(jadi);
    }
    if (typeof core.shouldShow === 'function' && core.shouldShow(dprod, pPlan)) {
      const jadi = core.buildProdText({ delta: dprod, pPlan, periode, job: jobLabel, items: data && data.productivity && data.productivity.items });
      if (jadi) seksi.push(jadi);
    }

    const kepala = (() => {
      const daftarUnit = Array.isArray(data.units) ? data.units : [];
      const kelas = [...new Set(daftarUnit.map(u => String(u.class || '').trim()).filter(Boolean))];
      const infoArmada = `Plan : ${daftarUnit.length} Fleet Running ${esc(kelas.length ? kelas.join(', ') : 'Unit')}`;
      const konteks = `${esc(periode)}${jobLabel ? ` · JOB ${esc(jobLabel)}` : ''}`;
      const totalPlan = fmt(jumlah('pPlan'));
      const totalAktual = fmt((jumlah('fleet') || 0) + (jumlah('other') || 0));
      return `<p style="margin:0 0 10px;font-size:12px;color:#64748b;">${infoArmada} · ${konteks}</p>`
        + `<div style="margin:0 0 12px;padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px;line-height:1.7;">`
        + `<div>Plan : <strong style="color:#000;">${esc(totalPlan)}</strong></div>`
        + `<div>Aktual : <strong style="color:#000;">${esc(totalAktual)}</strong></div>`
        + `</div>`;
    })();
    if (!seksi.length) {
      host.innerHTML = kepala + '<p class="tabel__kosong">Semua atribut dalam toleransi (&gt; 1%): tidak diperlukan analisis akar masalah.</p>';
      return;
    }
    host.innerHTML = kepala + seksi.map(bagian => {
      const bar = (bagian.pareto || []).map(rank => {
        const label = bagian.attribute === 'Productivity'
          ? (rank.data.problem || rank.data.kode || rank.data.kategori)
          : rank.data.kategori;
        const satuan = bagian.attribute === 'Productivity'
          ? `${Number(rank.nilai).toLocaleString('id-ID', { maximumFractionDigits: 0 })} Event`
          : `${Number(rank.nilai).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam`;
        const persen = Number(rank.persen).toLocaleString('id-ID', { maximumFractionDigits: 0 });
        return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px;">
          <span style="width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#0f172a;font-weight:700;" title="${esc(label)}">${esc(label)}</span>
          <span style="flex:1;height:10px;background:#e2e8f0;border-radius:5px;overflow:hidden;"><span style="display:block;height:100%;width:${Math.min(100, Math.max(0, rank.persen))}%;background:#0f3460;"></span></span>
          <span style="width:110px;text-align:right;color:#334155;">${esc(satuan)} · ${esc(persen)}%</span>
        </div>`;
      }).join('');
      const sumber = bagian.attribute === 'PA' ? 'Sumber: hal. 3 Breakdown' : bagian.attribute === 'UA' ? 'Sumber: hal. 4 Standby' : 'Sumber: hal. 5 Problem Productivity';
      return `<div style="margin-bottom:14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:6px;">${esc(bagian.attribute)} <span style="font-weight:400;color:#64748b;">${esc(sumber)}</span></div>
        ${bar}
        <p style="margin:8px 0 0;font-size:12px;line-height:1.55;color:#1e293b;">${esc(bagian.smartText)}</p>
      </div>`;
    }).join('');
  }

  global.ReviewProduksi = { init, state };
})(window);
