/* eslint-disable */
/*
 * Waterfall UA — bedah ΔUA per kategori standby (murni, tanpa I/O).
 * Δ_c = -PPlan x (PAact/PAplan) x jam_c / ((HM+S) x UAplan).
 * Jumlah kategori + basisUA sama dengan ΔUA utama secara eksak bila cakupan
 * standby lengkap. Satuan volume mengikuti scope (BCM/Ton).
 */
(function (root) {
  'use strict';

  const num = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
  const finite = value => Number.isFinite(value);

  // input: { pPlan, paPlan, paAktual, uaPlan, tUaJam (HM+S), dpuaServer,
  //          sbItems: [{kategori, jam, unit}] }
  function buildUaWaterfall(input) {
    const src = input || {};
    const pPlan = num(src.pPlan);
    const paPlan = num(src.paPlan);
    const paAktual = num(src.paAktual);
    const uaPlan = num(src.uaPlan);
    const t = num(src.tUaJam);
    if (!finite(pPlan) || !(pPlan > 0) || !finite(paPlan) || !(paPlan > 0)
      || !finite(paAktual) || !finite(uaPlan) || !(uaPlan > 0) || !finite(t) || !(t > 0)) return null;
    const items = (Array.isArray(src.sbItems) ? src.sbItems : [])
      .map(row => ({ kategori: String(row.kategori || 'Tanpa kategori'), jam: num(row.jam), unit: row.unit || null }))
      .filter(row => finite(row.jam) && row.jam > 0)
      .sort((a, b) => b.jam - a.jam);
    const totalJam = items.reduce((sum, row) => sum + row.jam, 0);
    const faktor = pPlan * (paAktual / paPlan) / (uaPlan * t);
    const cats = items.map(item => ({
      kategori: item.kategori, jam: item.jam,
      delta: -faktor * item.jam,
      share: totalJam > 0 ? (item.jam / totalJam) * 100 : 0,
      unit: item.unit,
    }));
    const totalCat = cats.reduce((sum, row) => sum + row.delta, 0);
    const basisUA = pPlan * paAktual * (1 - uaPlan) / (paPlan * uaPlan);
    const dpua = finite(num(src.dpuaServer)) ? num(src.dpuaServer) : null;
    const selisih = dpua == null ? null : (totalCat + basisUA) - dpua;
    return {
      faktor, totalJam, cats, totalCat, basisUA, dpuaServer: dpua, selisih,
      cocok: selisih == null ? null : Math.abs(selisih) <= 1,
    };
  }

  const api = { buildUaWaterfall };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReviewUaWaterfallCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
