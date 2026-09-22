/*
 * Waterfall PA — bedah ΔPA (render tabel + mini chart + badge cross-check).
 * Murni display: angka dari respons review-produksi & pareto. Satuan volume
 * mengikuti scope (BCM untuk OB, Ton untuk Coal).
 */
(function (global) {
  'use strict';

  let chartPa = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fmt = (value, digits) => (value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 }));
  const fmtPersenRasio = value => (value == null || !Number.isFinite(Number(value))
    ? 'N/A' : `${(Number(value) * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

  // Label nilai di atas batang (bar biasa, bukan floating).
  const pluginPaLabel = {
    id: 'rpPaLabel',
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

  global.ReviewPaWaterfallRender = function (ctx) {
    const host = document.getElementById('rpPaWaterfall');
    if (!host) return;
    const src = ctx || {};
    const core = global.ReviewPaWaterfallCore || {};
    const paretoCore = global.ReviewParetoCore || {};
    const kategori = Array.isArray(src.kategori) ? src.kategori : [];
    const hasil = Array.isArray(src.hasil) ? src.hasil : [];
    const pareto = src.pareto || null;

    const jumlah = key => {
      const nilai = hasil.map(h => Number(h[key])).filter(v => Number.isFinite(v));
      return nilai.length ? nilai.reduce((total, v) => total + v, 0) : null;
    };
    const pPlan = hasil.some(h => h.pPlan != null) ? jumlah('pPlan') : null;
    const dppa = jumlah('dppa');
    const satuan = (hasil[0] && hasil[0].unit) || (kategori[0] && kategori[0].unit) || '';

    if (!kategori.length || pPlan == null) {
      host.innerHTML = '<p class="tabel__kosong">Waterfall PA membutuhkan Plan — pilih pit &amp; JOB dengan Plan tersedia.</p>';
      lukisChart(null);
      badge(null);
      return;
    }
    if (typeof paretoCore.shouldShow === 'function' && !paretoCore.shouldShow(dppa, pPlan)) {
      host.innerHTML = '<p class="tabel__kosong">ΔPA dalam toleransi (&gt; 1%): tidak diperlukan bedah akar masalah.</p>';
      lukisChart(null);
      badge(null);
      return;
    }
    if (!pareto) {
      host.innerHTML = src.paretoError
        ? `<p class="tabel__kosong">Data pareto gagal dimuat (${esc(src.paretoError)}); tabel PA menunggu. Restart backend lalu muat ulang halaman.</p>`
        : '<p class="tabel__kosong">Menunggu data…</p>';
      lukisChart(null);
      badge(null);
      return;
    }

    let tHours = 0;
    for (const k of kategori) {
      for (const key of ['hm', 'standby', 'breakdown']) {
        const v = Number(k[key]);
        if (Number.isFinite(v)) tHours += v;
      }
    }
    let paNum = 0; let paDen = 0;
    for (const k of kategori) {
      const pp = Number(k.paPlan); const ew = Number(k.totalEwh);
      if (Number.isFinite(pp) && pp > 0 && Number.isFinite(ew) && ew > 0) { paNum += pp * ew; paDen += ew; }
    }
    const paPlan = paDen > 0 ? paNum / paDen : null;
    const bdItems = ((pareto.pa && pareto.pa.items) || []).map(item => ({
      kategori: item.kategori, jam: item.jam, unit: (item.units && item.units[0] && item.units[0].unit) || null,
    }));
    const bangun = typeof core.buildPaWaterfall === 'function'
      ? core.buildPaWaterfall({ pPlan, paPlan, tHours, dppaServer: dppa, bdItems })
      : null;
    if (!bangun) {
      host.innerHTML = '<p class="tabel__kosong">Data jam/PA belum lengkap untuk Waterfall PA.</p>';
      lukisChart(null);
      badge(null);
      return;
    }

    const paAkt = tHours > 0 && bangun.bdTotal >= 0 ? 1 - bangun.bdTotal / tHours : null;
    const katRows = bangun.rows.filter(row => row.jam != null);
    const totalKat = katRows.reduce((total, row) => total + (row.delta || 0), 0);
    host.innerHTML = `<p style="margin:0 0 10px;font-size:12px;color:#64748b;">Scope: ${esc(src.periode || '')}${src.job ? ` · JOB ${esc(src.job)}` : ''} · PA Plan ${fmtPersenRasio(paPlan)} → PA Aktual ${fmtPersenRasio(paAkt)} · T ${fmt(tHours, 1)} jam · BD ${fmt(bangun.bdTotal, 1)} jam</p>`
      + (katRows.length ? `<div class="tabel-wrap"><table class="tabel" style="font-size:12px;">
        <thead><tr><th>Kategori Breakdown</th><th style="text-align:right;">Jam</th><th style="text-align:right;">Δ (${esc(satuan || 'vol')})</th><th style="text-align:right;">Share BD</th><th>Unit dominan</th></tr></thead>
        <tbody>${katRows.map(row => `<tr>
          <td>${esc(row.segmen)}</td>
          <td style="text-align:right;">${fmt(row.jam, 1)}</td>
          <td style="text-align:right;">${row.delta >= 0 ? '+' : ''}${fmt(row.delta)}</td>
          <td style="text-align:right;">${fmtPersenRasio(row.share / 100)}</td>
          <td>${esc(row.unit || '—')}</td>
        </tr>`).join('')}
        <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>${fmt(bangun.bdTotal, 1)}</strong></td><td style="text-align:right;"><strong>${totalKat >= 0 ? '+' : ''}${fmt(totalKat)}</strong></td><td style="text-align:right;"><strong>100%</strong></td><td>—</td></tr></tbody></table></div>`
        : '<p class="tabel__kosong">Tidak ada event breakdown tercatat pada scope ini.</p>');

    lukisChart(bangun, katRows);
    badge(bangun, totalKat, dppa);

    function lukisChart(bangun, katRows) {
      const chartLib = global.Chart;
      const canvas = document.getElementById('rpCanvasPaWaterfall');
      if (chartPa) { chartPa.destroy(); chartPa = null; }
      if (!chartLib || !canvas || !bangun || !katRows.length) return;
      const labels = katRows.map(row => (row.segmen.length > 14 ? `${row.segmen.slice(0, 13)}…` : row.segmen));
      const data = katRows.map(row => row.delta);
      const warna = katRows.map(row => (row.delta || 0) >= 0 ? '#16a34a' : '#dc2626');
      chartPa = new chartLib(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'ΔPA per kategori', data, backgroundColor: warna, borderRadius: 4 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { title: { display: true, text: `Δ Produksi (${satuan || 'vol'})` } } },
        },
        plugins: [pluginPaLabel],
      });
    }

    function badge(bangun, totalKat, delta) {
      const el = document.getElementById('rpPaBadge');
      if (!el) return;
      if (!bangun) { el.innerHTML = ''; return; }
      if (bangun.cocok == null) {
        el.innerHTML = `<span style="color:#64748b;">Total loss kategori ${fmt(totalKat)} — ΔPA utama tak tersedia untuk cross-check.</span>`;
      } else if (bangun.cocok) {
        el.innerHTML = `<span style="color:#15803d;font-weight:700;">✅ Total cocok ΔPA utama</span> · total kategori ${fmt(totalKat)} + basis normalisasi ${fmt(bangun.basis)} = ΔPA ${fmt(delta)}`;
      } else {
        el.innerHTML = `<span style="color:#b45309;font-weight:700;">⚠️ Selisih vs ΔPA utama</span> · total kategori ${fmt(totalKat)} + basis ${fmt(bangun.basis)} vs ΔPA ${fmt(delta)} (selisih ${fmt(bangun.selisih)})`;
      }
    }
  };
})(window);
