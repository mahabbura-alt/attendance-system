/*
 * Waterfall UA — kontribusi ΔUA per parameter delay SPO.
 * Backend menghitung pada grain tanggal+unit+PIT+JOB+material+UoM+standby code;
 * modul ini hanya mengagregasi scope terpilih dan menampilkan hasilnya.
 */
(function (global) {
  'use strict';

  let chartUa = null;
  const PARETO_BAR_MAX_THICKNESS = 40;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fmt = (value, digits) => (value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 }));

  const pluginUaLabel = {
    id: 'rpUaLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.fillStyle = '#000';
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, index) => {
        if (!bar) return;
        const value = Number(chart.data.datasets[0].data[index]);
        if (Number.isFinite(value)) ctx.fillText(`${value >= 0 ? '+' : ''}${fmt(value)}`, bar.x, bar.y - 10);
      });
      ctx.restore();
    },
  };

  function aggregate(kategori) {
    const payloads = (Array.isArray(kategori) ? kategori : []).map(row => row?.uaWaterfall).filter(Boolean);
    if (!payloads.length) return null;
    const map = new Map(); const flags = new Set(); const lineage = new Map();
    let authoritative = 0; let hasAuthoritative = false;
    for (const payload of payloads) {
      if (Number.isFinite(Number(payload.authoritativeDeltaUa))) {
        authoritative += Number(payload.authoritativeDeltaUa); hasAuthoritative = true;
      }
      for (const flag of payload.flags || []) flags.add(flag);
      for (const item of payload.lineage || []) lineage.set(`${item.versionId || 'snapshot'}|${item.effectiveFrom || 'current'}|${item.revision || ''}`, item);
      for (const item of payload.items || []) {
        const key = item.key || item.standbyCodeId || item.code || item.description;
        const row = map.get(key) || { ...item, rawPlanHours: 0, planHours: 0, actualHours: 0, allowanceHours: 0, varianceHours: 0, impact: 0, flags: new Set(), units: new Set() };
        row.rawPlanHours += Number(item.rawPlanHours) || 0;
        row.planHours += Number(item.planHours) || 0;
        row.actualHours += Number(item.actualHours) || 0;
        row.allowanceHours += Number(item.allowanceHours) || 0;
        row.varianceHours += Number(item.varianceHours) || 0;
        row.impact += Number(item.impact) || 0;
        for (const flag of item.flags || []) row.flags.add(flag);
        for (const unit of item.units || []) row.units.add(unit);
        map.set(key, row);
      }
    }
    const items = [...map.values()].map(row => ({ ...row, flags: [...row.flags], units: [...row.units] }))
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
    const total = items.reduce((sum, row) => sum + row.impact, 0);
    const difference = hasAuthoritative ? total - authoritative : null;
    const tolerance = Math.max(1e-8, Math.abs(authoritative) * 1e-10);
    return {
      items, flags: [...flags], lineage: [...lineage.values()], total,
      authoritative: hasAuthoritative ? authoritative : null,
      difference,
      reconciled: difference != null && Math.abs(difference) <= tolerance,
      formulaVersion: payloads[0].formulaVersion,
    };
  }

  function statusOf(row) {
    if ((row.flags || []).some(flag => /^UNMAPPED_/.test(flag))) return ['Perlu dilengkapi', '#fff7ed', '#9a3412'];
    if (row.impact < -1e-8) return ['Melebihi Plan', '#fee2e2', '#b91c1c'];
    if (row.impact > 1e-8) return ['Di Bawah Plan', '#dcfce7', '#15803d'];
    return ['Sesuai Plan', '#e2e8f0', '#475569'];
  }

  global.ReviewUaWaterfallRender = function ReviewUaWaterfallRender(ctx) {
    const host = document.getElementById('rpUaWaterfall');
    if (!host) return;
    const src = ctx || {};
    const result = aggregate(src.kategori);
    const core = global.ReviewUaWaterfallCore || {};

    if (!result) {
      host.innerHTML = '<p class="tabel__kosong">Detail parameter UA belum tersedia dari backend.</p>';
      draw(null, []); badge(null); return;
    }
    if (!result.items.length) {
      host.innerHTML = '<p class="tabel__kosong">Tidak ada plan delay SPO maupun standby aktual pada scope ini.</p>';
      draw(result, []); badge(result); return;
    }

    const displayRows = typeof core.balanceRoundedImpacts === 'function'
      ? core.balanceRoundedImpacts(result.items, result.authoritative, 0)
      : result.items.map(row => ({ ...row, displayImpact: Math.round(row.impact) }));
    const unit = (src.hasil?.[0]?.unit) || (src.kategori?.[0]?.unit) || 'volume';
    const versions = result.lineage.map(item => `${item.effectiveFrom || 'current'}${item.revision ? ` r${item.revision}` : ''}`).join(', ') || 'snapshot aktif';
    const totals = displayRows.reduce((sum, row) => ({
      rawPlanHours: sum.rawPlanHours + (Number(row.rawPlanHours) || 0),
      planHours: sum.planHours + (Number(row.planHours) || 0),
      allowanceHours: sum.allowanceHours + (Number(row.allowanceHours) || 0),
      actualHours: sum.actualHours + (Number(row.actualHours) || 0),
      varianceHours: sum.varianceHours + (Number(row.varianceHours) || 0),
    }), { rawPlanHours: 0, planHours: 0, allowanceHours: 0, actualHours: 0, varianceHours: 0 });
    host.innerHTML = `<p style="margin:0 0 10px;font-size:12px;color:#64748b;">Scope: ${esc(src.periode || '')}${src.job ? ` · JOB ${esc(src.job)}` : ''} · Formula ${esc(result.formulaVersion || 'review-ua-spo-direct-v3')} · SPO ${esc(versions)}</p>`
      + '<p style="margin:0 0 10px;font-size:11px;color:#64748b;">Dampak = (Plan Delay SPO − Aktual) × Productivity Plan per tanggal/unit/material. Jam SPO dialokasikan sesuai porsi konteks unit; plan sama dengan aktual menghasilkan nol.</p>'
      + (result.flags.length ? `<p style="color:#92400e;font-size:12px;">Kualitas sumber: ${esc(result.flags.join(', '))}. Parameter tanpa mapping kode belum dapat dibandingkan langsung per kode standby; rekonsiliasi total tidak berarti mapping sudah lengkap.</p>` : '')
      + `<div class="tabel-wrap"><table class="tabel" style="font-size:12px;">
        <thead><tr><th>Kode</th><th>Parameter SPO</th><th style="text-align:right;">Plan Delay SPO</th><th style="text-align:right;">Aktual</th><th style="text-align:right;">Deviasi</th><th style="text-align:right;">Dampak (${esc(unit)})</th><th>Status</th><th>Unit terkait</th></tr></thead>
        <tbody>${displayRows.map(row => {
    const status = statusOf(row);
    return `<tr><td><strong>${esc(row.code || '—')}</strong></td><td>${esc(row.description || '—')}</td>
          <td style="text-align:right;">${fmt(row.rawPlanHours, 2)} jam</td>
          <td style="text-align:right;">${fmt(row.actualHours, 2)} jam</td>
          <td style="text-align:right;">${row.varianceHours >= 0 ? '+' : ''}${fmt(row.varianceHours, 2)} jam</td>
          <td style="text-align:right;font-weight:800;color:${row.displayImpact >= 0 ? '#15803d' : '#b91c1c'};">${row.displayImpact >= 0 ? '+' : ''}${fmt(row.displayImpact)}</td>
          <td><span style="display:inline-block;padding:3px 7px;border-radius:999px;background:${status[1]};color:${status[2]};font-weight:700;">${status[0]}</span></td>
          <td>${esc((row.units || []).join(', ') || '—')}</td></tr>`;
  }).join('')}
        <tr><td colspan="2"><strong>Total ΔUA</strong></td>
          <td style="text-align:right;"><strong>${fmt(totals.rawPlanHours, 2)} jam</strong></td>
          <td style="text-align:right;"><strong>${fmt(totals.actualHours, 2)} jam</strong></td>
          <td style="text-align:right;"><strong>${totals.varianceHours >= 0 ? '+' : ''}${fmt(totals.varianceHours, 2)} jam</strong></td>
          <td style="text-align:right;"><strong>${result.authoritative >= 0 ? '+' : ''}${fmt(result.authoritative)}</strong></td><td colspan="2">${result.reconciled ? 'Terekonsiliasi' : 'Perlu diperiksa'}</td></tr>
        </tbody></table></div>`;
    draw(result, displayRows); badge(result);

    function draw(data, rows) {
      const canvas = document.getElementById('rpCanvasUaWaterfall');
      if (chartUa) { chartUa.destroy(); chartUa = null; }
      if (!global.Chart || !canvas || !data || !rows.length) return;
      chartUa = new global.Chart(canvas, {
        type: 'bar',
        data: {
          labels: rows.map(row => `${row.code || ''}${row.description ? ` · ${row.description}` : ''}`.slice(0, 24)),
          datasets: [{ label: 'Dampak UA per parameter SPO', data: rows.map(row => row.displayImpact), backgroundColor: rows.map(row => row.displayImpact >= 0 ? '#16a34a' : '#dc2626'), borderRadius: 4, maxBarThickness: PARETO_BAR_MAX_THICKNESS }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: `Δ Produksi (${unit})` } } } },
        plugins: [pluginUaLabel],
      });
    }

    function badge(data) {
      const element = document.getElementById('rpUaBadge');
      if (!element) return;
      if (!data) { element.innerHTML = ''; return; }
      if (data.reconciled) {
        element.innerHTML = `<span style="color:#15803d;font-weight:700;">✅ Total dampak parameter sama dengan ΔUA Waterfall Loss &amp; Gain</span> · parameter ${fmt(data.total, 4)} = ΔUA ${fmt(data.authoritative, 4)} (selisih ${fmt(data.difference, 8)})`;
      } else {
        element.innerHTML = `<span style="color:#b45309;font-weight:700;">⚠️ Rekonsiliasi UA gagal</span> · parameter ${fmt(data.total, 4)} vs ΔUA ${fmt(data.authoritative, 4)} (selisih ${fmt(data.difference, 8)})`;
      }
    }
  };
})(window);
