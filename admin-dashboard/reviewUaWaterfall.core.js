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

  function reconcileUaContributions(result, authoritativeDelta, enabled) {
    if (!result) return null;
    const rows = result.cats.map(row => ({ ...row }));
    const rawTotal = rows.reduce((sum, row) => sum + (finite(num(row.delta)) ? num(row.delta) : 0), 0);
    const delta = num(authoritativeDelta);
    if (!enabled || !finite(delta)) {
      return { rows, rawTotal, adjustment: 0, total: rawTotal, difference: finite(delta) ? rawTotal - delta : null };
    }
    const adjustment = delta - rawTotal;
    if (Math.abs(adjustment) > 1e-9) {
      rows.push({
        kategori: adjustment >= 0 ? 'Gain vs Plan / Penyesuaian Scope' : 'Loss vs Plan / Penyesuaian Scope',
        jam: null, delta: adjustment, share: null, unit: null, isAdjustment: true,
      });
    }
    const total = rows.reduce((sum, row) => sum + (finite(num(row.delta)) ? num(row.delta) : 0), 0);
    return { rows, rawTotal, adjustment, total, difference: total - delta };
  }

  // Menjaga jumlah angka yang terlihat user tetap sama dengan ΔUA utama.
  // Nilai sumber tidak diubah; koreksi pembulatan maksimum ditempatkan pada
  // baris dengan dampak absolut terbesar.
  function balanceRoundedImpacts(items, authoritativeDelta, digits) {
    const decimals = Number.isInteger(digits) && digits >= 0 ? digits : 0;
    const factor = 10 ** decimals;
    const rows = (Array.isArray(items) ? items : []).map(item => ({
      ...item,
      displayImpact: Math.round((Number(item.impact) || 0) * factor) / factor,
    }));
    if (!rows.length || !finite(num(authoritativeDelta))) return rows;
    const raw = rows.reduce((sum, row) => sum + (Number(row.impact) || 0), 0);
    if (Math.abs(raw - num(authoritativeDelta)) > Math.max(1e-8, Math.abs(raw) * 1e-10)) return rows;
    const target = Math.round(num(authoritativeDelta) * factor) / factor;
    const total = rows.reduce((sum, row) => sum + row.displayImpact, 0);
    const difference = Math.round((target - total) * factor) / factor;
    if (difference && rows.some(row => Math.abs(Number(row.impact) || 0) > 1e-12)) {
      const index = rows.reduce((best, row, current) => (
        Math.abs(Number(row.impact) || 0) > Math.abs(Number(rows[best]?.impact) || 0) ? current : best
      ), 0);
      rows[index].displayImpact = Math.round((rows[index].displayImpact + difference) * factor) / factor;
    }
    return rows;
  }

  const api = { buildUaWaterfall, reconcileUaContributions, balanceRoundedImpacts };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReviewUaWaterfallCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
