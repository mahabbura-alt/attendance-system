(function (root) {
  'use strict';

  // Review Produksi — mesin kalkulasi waterfall (murni, tanpa I/O).
  // Basis jam: EWH (plan, page 0.4) dan HM (aktual, Input Data). Formula
  // ekuivalen PDF bab 3 setelah SH = EWH_plan / (PA_plan x UA_plan) disubstitusi.
  // Semua fungsi mengembalikan number penuh presisi, atau null bila input tidak sah.

  const num = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
  const finite = value => Number.isFinite(value);

  // PA aktual (%) = (HM + Standby) / (HM + Standby + Breakdown)
  function hitungPAAktual(hm, standby, breakdown) {
    const w = num(hm); const s = num(standby); const r = num(breakdown);
    const denom = w + s + r;
    if (!finite(w) || !finite(s) || !finite(r) || !(denom > 0)) return null;
    return (w + s) / denom;
  }

  // UA aktual (%) = HM / (HM + Standby)
  function hitungUAAktual(hm, standby) {
    const w = num(hm); const s = num(standby);
    const denom = w + s;
    if (!finite(w) || !finite(s) || !(denom > 0)) return null;
    return w / denom;
  }

  // PPlan = N x EWH_plan x Prod_plan
  function hitungPPlan(n, ewhPlan, prodPlan) {
    const a = num(n); const b = num(ewhPlan); const c = num(prodPlan);
    if (!finite(a) || !finite(b) || !finite(c)) return null;
    return a * b * c;
  }

  // Dampak PA = PPlan x (PA_aktual - PA_plan) / PA_plan
  function hitungDppa(pPlan, paPlan, paAktual) {
    const p = num(pPlan); const plan = num(paPlan); const act = num(paAktual);
    if (!finite(p) || !finite(plan) || !finite(act) || !(plan > 0)) return null;
    return p * ((act - plan) / plan);
  }

  // Dampak UA = PPlan x (PA_aktual / PA_plan) x (UA_aktual - UA_plan) / UA_plan
  // PA_aktual dipakai sebagai basis agar dampak PA tidak dihitung dua kali (PDF bab 3).
  function hitungDpua(pPlan, paPlan, paAktual, uaPlan, uaAktual) {
    const p = num(pPlan); const paP = num(paPlan); const paA = num(paAktual);
    const uaP = num(uaPlan); const uaA = num(uaAktual);
    if (!finite(p) || !finite(paP) || !finite(paA) || !finite(uaP) || !finite(uaA)) return null;
    if (!(paP > 0) || !(uaP > 0)) return null;
    return p * (paA / paP) * ((uaA - uaP) / uaP);
  }

  // Dampak Productivity = EH_actual x (Prod_actual - Prod_plan)  [panduan multi-excavator]
  function hitungDprod(ehAktual, prodPlan, prodAktual) {
    const eh = num(ehAktual); const plan = num(prodPlan); const act = num(prodAktual);
    if (!finite(eh) || !finite(plan) || !finite(act)) return null;
    return eh * (act - plan);
  }

  // Jumlah produksi untuk sekumpulan unit (mis. Other Fleet) — diukur langsung.
  function jumlahProduksi(daftarNilai) {    if (!Array.isArray(daftarNilai)) return 0;
    return daftarNilai.reduce((sum, value) => {
      const v = num(value);
      return sum + (finite(v) ? v : 0);
    }, 0);
  }

  // Rekonsiliasi: PPlan + Dampak PA + Dampak UA  vs  Aktual fleet.
  function cekRekonsiliasi(input) {
    const pPlan = num(input && input.pPlan);
    const dppa = num(input && input.dppa);
    const dpua = num(input && input.dpua);
    const dprod = finite(num(input && input.dprod)) ? num(input && input.dprod) : 0;
    const aktualFleet = num(input && input.aktualFleet);
    if (!finite(pPlan) || !finite(dppa) || !finite(dpua) || !finite(aktualFleet)) {
      return { total: null, aktual: finite(aktualFleet) ? aktualFleet : null, selisih: null, selisihPersen: null, reconciled: false };
    }
    const toleransiPersen = finite(num(input && input.toleransiPersen)) ? num(input && input.toleransiPersen) : null;
    const total = pPlan + dppa + dpua + dprod;
    const selisih = aktualFleet - total;
    const selisihPersen = pPlan > 0 ? Math.abs(selisih) / pPlan * 100 : (selisih === 0 ? 0 : 100);
    const tolerance = Math.max(1e-8, Math.abs(aktualFleet) * 1e-10);
    return { total, aktual: aktualFleet, selisih, selisihPersen, reconciled: toleransiPersen == null ? Math.abs(selisih) <= tolerance : selisihPersen <= toleransiPersen };
  }

  // Orkestrator: hitung seluruh komponen waterfall dari input agregat.
  // input: { n, ewhPlan, prodPlan, paPlan, uaPlan, hm, standby, breakdown, aktualFleet, otherFleet }
  function hitungWaterfall(input) {
    const src = input || {};
    const paAktual = hitungPAAktual(src.hm, src.standby, src.breakdown);
    const uaAktual = hitungUAAktual(src.hm, src.standby);
    const pPlan = hitungPPlan(src.n, src.ewhPlan, src.prodPlan);
    const dppa = paAktual === null ? null : hitungDppa(pPlan, src.paPlan, paAktual);
    const dpua = (paAktual === null || uaAktual === null)
      ? null
      : hitungDpua(pPlan, src.paPlan, paAktual, src.uaPlan, uaAktual);
    const aktualFleet = finite(num(src.aktualFleet)) ? num(src.aktualFleet) : null;
    const otherFleet = finite(num(src.otherFleet)) ? num(src.otherFleet) : 0;
    const rekonsiliasi = cekRekonsiliasi({ pPlan, dppa, dpua, aktualFleet, toleransiPersen: src.toleransiPersen });
    const totalAktual = (aktualFleet === null ? 0 : aktualFleet) + otherFleet;
    const achievementFleet = (finite(pPlan) && pPlan > 0 && aktualFleet !== null) ? (aktualFleet / pPlan) * 100 : null;
    const achievementTotal = (finite(pPlan) && pPlan > 0) ? (totalAktual / pPlan) * 100 : null;
    return { paAktual, uaAktual, pPlan, dppa, dpua, otherFleet, aktualFleet, totalAktual, achievementFleet, achievementTotal, rekonsiliasi };
  }

  // Format persen untuk display (presisi penuh dihitung, pembulatan hanya di sini).
  function formatPersen(value, digits) {
    const v = num(value);
    if (!finite(v)) return '—';
    return `${(v * 100).toFixed(digits == null ? 2 : digits)}%`;
  }

  const api = {
    hitungPAAktual,
    hitungUAAktual,
    hitungPPlan,
    hitungDppa,
    hitungDpua,
    hitungDprod,
    jumlahProduksi,
    cekRekonsiliasi,
    hitungWaterfall,
    formatPersen,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReviewProduksiCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
