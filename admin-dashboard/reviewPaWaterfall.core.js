/* eslint-disable */
/*
 * Waterfall PA — bedah ΔPA menjadi jembatan volume (murni, tanpa I/O).
 * Skema: Plan -> normalisasi PA 100% -> loss per kategori breakdown ->
 * ekspektasi pada PA aktual (= Plan + ΔPA). Rekonsiliasi eksak by
 * construction karena PAact = 1 - BD/T. Satuan volume mengikuti scope
 * (BCM untuk OB, Ton untuk Coal) — rumus tidak berubah.
 */
(function (root) {
  'use strict';

  const num = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
  const finite = value => Number.isFinite(value);

  // input: { pPlan, paPlan, tHours, dppaServer, bdItems: [{kategori, jam, unit}] }
  function buildPaWaterfall(input) {
    const src = input || {};
    const pPlan = num(src.pPlan);
    const paPlan = num(src.paPlan);
    const t = num(src.tHours);
    if (!finite(pPlan) || !(pPlan > 0) || !finite(paPlan) || !(paPlan > 0) || !finite(t) || !(t > 0)) return null;
    const items = (Array.isArray(src.bdItems) ? src.bdItems : [])
      .map(row => ({ kategori: String(row.kategori || 'Tanpa kategori'), jam: num(row.jam), unit: row.unit || null }))
      .filter(row => finite(row.jam) && row.jam > 0)
      .sort((a, b) => b.jam - a.jam);
    const bdTotal = items.reduce((sum, row) => sum + row.jam, 0);
    const v100 = pPlan / paPlan;
    const basis = v100 - pPlan;
    const rows = [
      { segmen: 'Plan', jam: null, delta: null, subtotal: pPlan, share: null, unit: null },
      { segmen: 'Normalisasi PA 100%', jam: null, delta: basis, subtotal: v100, share: null, unit: null },
    ];
    let berjalan = v100;
    for (const item of items) {
      const delta = -pPlan * item.jam / (t * paPlan);
      berjalan += delta;
      rows.push({
        segmen: item.kategori, jam: item.jam, delta, subtotal: berjalan,
        share: bdTotal > 0 ? (item.jam / bdTotal) * 100 : 0, unit: item.unit,
      });
    }
    const expected = berjalan;
    const dppa = finite(num(src.dppaServer)) ? num(src.dppaServer) : null;
    const selisih = dppa == null ? null : expected - (pPlan + dppa);
    rows.push({ segmen: 'Ekspektasi', jam: null, delta: null, subtotal: expected, share: null, unit: null });
    return {
      v100, basis, bdTotal, rows, expected, dppaServer: dppa, selisih,
      cocok: selisih == null ? null : Math.abs(selisih) <= 1,
    };
  }

  function reconcilePaContributions(result, authoritativeDelta, enabled) {
    if (!result) return null;
    const rows = result.rows.filter(row => row.jam != null).map(row => ({ ...row }));
    const rawTotal = rows.reduce((sum, row) => sum + (finite(num(row.delta)) ? num(row.delta) : 0), 0);
    const delta = num(authoritativeDelta);
    if (!enabled || !finite(delta)) {
      return { rows, rawTotal, adjustment: 0, total: rawTotal, difference: finite(delta) ? rawTotal - delta : null };
    }
    const adjustment = delta - rawTotal;
    if (Math.abs(adjustment) > 1e-9) {
      rows.push({
        segmen: adjustment >= 0 ? 'Gain vs Plan / Penyesuaian Scope' : 'Loss vs Plan / Penyesuaian Scope',
        jam: null, delta: adjustment, share: null, unit: null, isAdjustment: true,
      });
    }
    const total = rows.reduce((sum, row) => sum + (finite(num(row.delta)) ? num(row.delta) : 0), 0);
    return { rows, rawTotal, adjustment, total, difference: total - delta };
  }

  const api = { buildPaWaterfall, reconcilePaContributions };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReviewPaWaterfallCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
