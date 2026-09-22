/*
 * Waterfall UA — bedah ΔUA per kategori standby (render tabel + chart + badge).
 * Murni display: angka dari respons review-produksi & pareto. Atribut baris
 * otomatis dari sistem (kategori standby unit plotting, periode, pit, JOB).
 * Satuan volume mengikuti scope (BCM untuk OB, Ton untuk Coal).
 */
(function (global) {
  'use strict';

  let chartUa = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fmt = (value, digits) => (value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 }));
  const fmtPersenRasio = value => (value == null || !Number.isFinite(Number(value))
    ? 'N/A' : `${(Number(value) * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

  const pluginUaLabel = {
    id: 'rpUaLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillStyle = '#000';
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, i) => {
        if (!bar) return;
        const v = Number(chart.data.datasets[0].data[i]);
        if (!Number.isFinite(v)) return;
        ctx.fillText(`${v >= 0 ? '+' : ''}${fmt(v)}`, bar.x, bar.y - 10);
      });
      ctx.restore();
    },
  };

  global.ReviewUaWaterfallRender = function (ctx) {
    const host = document.getElementById('rpUaWaterfall');
    if (!host) return;
    const src = ctx || {};
    const core = global.ReviewUaWaterfallCore || {};
    const paretoCore = global.ReviewParetoCore || {};
    const kategori = Array.isArray(src.kategori) ? src.kategori : [];
    const hasil = Array.isArray(src.hasil) ? src.hasil : [];
    const pareto = src.pareto || null;

    const jumlah = key => {
      const nilai = hasil.map(h => Number(h[key])).filter(v => Number.isFinite(v));
      return nilai.length ? nilai.reduce((total, v) => total + v, 0) : null;
    };
    const pPlan = hasil.some(h => h.pPlan != null) ? jumlah('pPlan') : null;
    const dpua = jumlah('dpua');
    const satuan = (hasil[0] && hasil[0].unit) || (kategori[0] && kategori[0].unit) || '';

    if (!kategori.length || pPlan == null) {
      host.innerHTML = '<p class="tabel__kosong">Waterfall UA membutuhkan Plan — pilih pit &amp; JOB dengan Plan tersedia.</p>';
      lukisChart(null);
      badge(null);
      return;
    }
    if (typeof paretoCore.shouldShow === 'function' && !paretoCore.shouldShow(dpua, pPlan)) {
      host.innerHTML = '<p class="tabel__kosong">ΔUA dalam toleransi (&gt; 1%): tidak diperlukan bedah akar masalah.</p>';
      lukisChart(null);
      badge(null);
      return;
    }
    if (!pareto) {
      host.innerHTML = src.paretoError
        ? `<p class="tabel__kosong">Data pareto gagal dimuat (${esc(src.paretoError)}); tabel UA menunggu. Restart backend lalu muat ulang halaman.</p>`
        : '<p class="tabel__kosong">Menunggu data…</p>';
      lukisChart(null);
      badge(null);
      return;
    }

    let hm = 0; let standby = 0; let breakdown = 0;
    for (const k of kategori) {
      const w = Number(k.hm); const s = Number(k.standby); const r = Number(k.breakdown);
      if (Number.isFinite(w)) hm += w;
      if (Number.isFinite(s)) standby += s;
      if (Number.isFinite(r)) breakdown += r;
    }
    const tUa = hm + standby;
    let paNum = 0; let paDen = 0; let uaNum = 0; let uaDen = 0;
    for (const k of kategori) {
      const pp = Number(k.paPlan); const up = Number(k.uaPlan); const ew = Number(k.totalEwh);
      if (Number.isFinite(pp) && pp > 0 && Number.isFinite(ew) && ew > 0) { paNum += pp * ew; paDen += ew; }
      if (Number.isFinite(up) && up > 0 && Number.isFinite(ew) && ew > 0) { uaNum += up * ew; uaDen += ew; }
    }
    const paPlan = paDen > 0 ? paNum / paDen : null;
    const uaPlan = uaDen > 0 ? uaNum / uaDen : null;
    const paAktual = (hm + standby + breakdown) > 0 ? (hm + standby) / (hm + standby + breakdown) : null;
    const uaAktual = tUa > 0 ? hm / tUa : null;
    const sbItems = ((pareto.ua && pareto.ua.items) || []).map(item => ({
      kategori: item.kategori, jam: item.jam, unit: (item.units && item.units[0] && item.units[0].unit) || null,
    }));
    const bangun = typeof core.buildUaWaterfall === 'function'
      ? core.buildUaWaterfall({ pPlan, paPlan, paAktual, uaPlan, tUaJam: tUa, dpuaServer: dpua, sbItems })
      : null;
    if (!bangun) {
      host.innerHTML = '<p class="tabel__kosong">Data jam/UA belum lengkap untuk Waterfall UA.</p>';
      lukisChart(null);
      badge(null);
      return;
    }

    host.innerHTML = `<p style="margin:0 0 10px;font-size:12px;color:#64748b;">Scope: ${esc(src.periode || '')}${src.job ? ` · JOB ${esc(src.job)}` : ''} · UA Plan ${fmtPersenRasio(uaPlan)} → UA Aktual ${fmtPersenRasio(uaAktual)} · HM+S ${fmt(tUa, 1)} jam · STB ${fmt(bangun.totalJam, 1)} jam</p>`
      + (bangun.cats.length ? `<div class="tabel-wrap"><table class="tabel" style="font-size:12px;">
        <thead><tr><th>Kategori Standby</th><th style="text-align:right;">Jam</th><th style="text-align:right;">Δ (${esc(satuan || 'vol')})</th><th style="text-align:right;">Share STB</th><th>Unit dominan</th></tr></thead>
        <tbody>${bangun.cats.map(row => `<tr>
          <td>${esc(row.kategori)}</td>
          <td style="text-align:right;">${fmt(row.jam, 1)}</td>
          <td style="text-align:right;">${row.delta >= 0 ? '+' : ''}${fmt(row.delta)}</td>
          <td style="text-align:right;">${fmtPersenRasio(row.share / 100)}</td>
          <td>${esc(row.unit || '—')}</td>
        </tr>`).join('')}
        <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>${fmt(bangun.totalJam, 1)}</strong></td><td style="text-align:right;"><strong>${bangun.totalCat >= 0 ? '+' : ''}${fmt(bangun.totalCat)}</strong></td><td style="text-align:right;"><strong>100%</strong></td><td>—</td></tr></tbody></table></div>`
        : '<p class="tabel__kosong">Tidak ada event standby tercatat pada scope ini.</p>');

    lukisChart(bangun);
    badge(bangun, dpua);

    function lukisChart(bangun) {
      const chartLib = global.Chart;
      const canvas = document.getElementById('rpCanvasUaWaterfall');
      if (chartUa) { chartUa.destroy(); chartUa = null; }
      if (!chartLib || !canvas || !bangun || !bangun.cats.length) return;
      const labels = bangun.cats.map(row => (row.kategori.length > 14 ? `${row.kategori.slice(0, 13)}…` : row.kategori));
      chartUa = new chartLib(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'ΔUA per kategori', data: bangun.cats.map(row => row.delta), backgroundColor: bangun.cats.map(row => (row.delta || 0) >= 0 ? '#16a34a' : '#dc2626'), borderRadius: 4 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { title: { display: true, text: `Δ Produksi (${satuan || 'vol'})` } } },
        },
        plugins: [pluginUaLabel],
      });
    }

    function badge(bangun, delta) {
      const el = document.getElementById('rpUaBadge');
      if (!el) return;
      if (!bangun) { el.innerHTML = ''; return; }
      if (bangun.cocok == null) {
        el.innerHTML = `<span style="color:#64748b;">Total loss kategori ${fmt(bangun.totalCat)} — ΔUA utama tak tersedia untuk cross-check.</span>`;
      } else if (bangun.cocok) {
        el.innerHTML = `<span style="color:#15803d;font-weight:700;">✅ Total cocok ΔUA utama</span> · total kategori ${fmt(bangun.totalCat)} + basis ${fmt(bangun.basisUA)} = ΔUA ${fmt(delta)}`;
      } else {
        el.innerHTML = `<span style="color:#b45309;font-weight:700;">⚠️ Selisih vs ΔUA utama</span> · total kategori ${fmt(bangun.totalCat)} + basis ${fmt(bangun.basisUA)} vs ΔUA ${fmt(delta)} (selisih ${fmt(bangun.selisih)})`;
      }
    }
  };
})(window);
