/* PA detail consumes the same daily contributions as the main waterfall. */
(function (global) {
  'use strict';
  let chartPa = null;
  const PARETO_BAR_MAX_THICKNESS = 40;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (value, digits = 0) => value == null ? '—' : Number(value).toLocaleString('id-ID', { maximumFractionDigits: digits });
  global.ReviewPaWaterfallRender = function (ctx = {}) {
    const host = document.getElementById('rpPaWaterfall');
    const badge = document.getElementById('rpPaBadge');
    if (!host) return;
    if (chartPa) { chartPa.destroy(); chartPa = null; }
    if (badge) badge.textContent = '';
    const payloads = (ctx.kategori || []).map(row => row.paWaterfall).filter(Boolean);
    if (!payloads.length) { host.innerHTML = '<p class="tabel__kosong">Rincian PA belum tersedia untuk scope ini.</p>'; return; }
    const map = new Map(); let target = 0;
    for (const payload of payloads) {
      target += payload.authoritativeDeltaPa || 0;
      for (const item of payload.items || []) {
        const row = map.get(item.key) || { ...item, hours: 0, impact: 0, units: new Set() };
        row.hours += item.hours; row.impact += item.impact;
        for (const unit of item.units || []) row.units.add(unit);
        map.set(item.key, row);
      }
    }
    const items = [...map.values()];
    const rows = global.ReviewUaWaterfallCore.balanceRoundedImpacts(items, target, 0);
    const difference = items.reduce((sum, row) => sum + row.impact, 0) - target;
    const ok = Math.abs(difference) <= Math.max(1e-8, Math.abs(target) * 1e-10);
    const unit = ctx.kategori?.[0]?.unit || '';
    host.innerHTML = '<p style="font-size:12px;color:#64748b;">Dampak jam tersedia = budget breakdown plan − breakdown aktual + selisih jam tercatat terhadap jadwal, masing-masing × Productivity Plan harian. Selisih jam tercatat perlu ditinjau sebagai cakupan waktu, bukan otomatis breakdown.</p>'
      + `<div class="tabel-wrap"><table class="tabel" style="font-size:12px;"><thead><tr><th>Komponen PA / Jam tersedia</th><th>Jam</th><th>Dampak (${esc(unit)})</th><th>Unit terkait</th></tr></thead><tbody>`
      + rows.map(row => `<tr><td>${esc(row.description)}</td><td>${fmt(row.hours, 2)}</td><td>${row.displayImpact > 0 ? '+' : ''}${fmt(row.displayImpact)}</td><td>${esc([...row.units].join(', '))}</td></tr>`).join('')
      + `<tr><td><strong>Total ΔPA</strong></td><td>—</td><td><strong>${fmt(target)}</strong></td><td>${ok ? 'Terekonsiliasi' : 'Perlu diperiksa'}</td></tr></tbody></table></div>`;
    if (badge) badge.innerHTML = `${ok ? '✅' : '⚠️'} Waterfall PA ${ok ? 'cocok' : 'berbeda dengan'} ΔPA utama · selisih ${fmt(difference, 8)}`;
    const canvas = document.getElementById('rpCanvasPaWaterfall');
    if (canvas && global.Chart) chartPa = new global.Chart(canvas, {
      type: 'bar', data: { labels: rows.map(row => row.description), datasets: [{ label: 'ΔPA',
        data: rows.map(row => row.displayImpact), backgroundColor: rows.map(row => row.displayImpact >= 0 ? '#16a34a' : '#dc2626'),
        borderRadius: 4, maxBarThickness: PARETO_BAR_MAX_THICKNESS }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { y: { title: { display: true, text: `Δ Produksi (${unit})` } } } },
    });
  };
})(window);
