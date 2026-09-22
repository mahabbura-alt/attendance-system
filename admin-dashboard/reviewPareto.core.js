/* eslint-disable */
/*
 * Pareto + Smart Text waterfall (murni, tanpa I/O).
 *
 * Konsep teks mengacu docs/OMOS_MINING_INTELLIGENCE_SMART_TEXT_WATERFALL.md
 * dan HANYA konsepnya: router atribut->event, trigger atribut minus,
 * pareto kumulatif ~80%, template rule-based TANPA LLM, struktur output
 * {attribute, variance, status, source, filters, pareto, smartText}.
 * Tidak memakai tabel mi_* baru; fakta berasal dari endpoint pareto.
 * Prinsip: tidak ada event tercatat -> sampaikan jujur, jangan karang.
 */
(function (root) {
  'use strict';

  const num = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
  const finite = value => Number.isFinite(value);

  const fmtJam = value => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 1 });
  const fmtMenit = value => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  const fmtPct = (value, digits) => `${Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 })}%`;
  const fmtVar = value => `${Number(value).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

  // Ambang tampil (keputusan owner): |Δ| > 1% dari Plan.
  function shouldShow(delta, pPlan) {
    const d = num(delta); const p = num(pPlan);
    if (!finite(d) || !finite(p) || !(p > 0)) return false;
    return (Math.abs(d) / p) * 100 > 1;
  }

  function variancePct(delta, pPlan) {
    const d = num(delta); const p = num(pPlan);
    if (!finite(d) || !finite(p) || !(p > 0)) return null;
    return (d / p) * 100;
  }

  // Pareto: items backend (urut desc) -> persen & kumulatif; ambil sampai
  // kumulatif >= 80% (maks 4). valueKey: 'jam' (PA/UA) | 'menitDampak' (Prod).
  function paretoRank(items, valueKey) {
    const list = (Array.isArray(items) ? items : [])
      .map(item => ({ item, value: num(item ? item[valueKey] : null) }))
      .filter(entry => finite(entry.value) && entry.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = list.reduce((sum, entry) => sum + entry.value, 0);
    if (!(total > 0)) return { total: 0, ranked: [], count: 0 };
    let kumulatif = 0;
    const ranked = list.map((entry, index) => {
      const persen = (entry.value / total) * 100;
      kumulatif += persen;
      return { rank: index + 1, data: entry.item, nilai: entry.value, persen, kumulatif };
    });
    const top = [];
    for (const rank of ranked) {
      top.push(rank);
      if (rank.kumulatif >= 80 || top.length >= 4) break;
    }
    return { total, ranked: top, count: list.length };
  }

  const namaUnit = item => (Array.isArray(item?.units) ? item.units.map(u => u?.unit).filter(Boolean).slice(0, 3).join(', ') : '');

  function kalimatContoh(contoh) {
    const text = String(contoh || '').trim();
    return text ? ` Contoh kejadian: ${text}.` : '';
  }

  function konteks(periode, job) {
    const rentang = periode ? `periode ${periode}` : 'periode terpilih';
    return job ? `${rentang} (JOB ${job})` : rentang;
  }

  function buildPaText(input) {
    const src = input || {};
    const ranked = paretoRank(src.items, 'jam');
    if (!ranked.ranked.length) return null;
    const varPct = variancePct(src.delta, src.pPlan);
    const [satu, dua] = ranked.ranked;
    const gabungan = ranked.ranked.length > 1
      ? ` Kedua event tersebut menyumbang ${fmtPct(ranked.ranked[ranked.ranked.length - 1].kumulatif)} dari total ${fmtJam(ranked.total)} jam breakdown`
      : ` Event tersebut menyumbang ${fmtPct(satu.kumulatif)} dari total ${fmtJam(ranked.total)} jam breakdown`;
    const unitInfo = namaUnit(satu.data) ? ` pada ${namaUnit(satu.data)}` : '';
    const kalimatDua = dua
      ? `, diikuti ${dua.data.kategori} sebesar ${fmtJam(dua.nilai)} jam (${fmtPct(dua.persen)})${namaUnit(dua.data) ? ` pada ${namaUnit(dua.data)}` : ''}`
      : '';
    return {
      attribute: 'PA', variance: varPct, status: 'negative', source: '3. Breakdown',
      filters: { periode: src.periode || null, job: src.job || null },
      pareto: ranked.ranked, cumulativeContribution: ranked.ranked[ranked.ranked.length - 1].kumulatif,
      smartText: `Physical Availability menyimpang ${varPct == null ? 'N/A' : fmtVar(varPct)} dari target.`
        + ` Kontributor breakdown terbesar ${satu.data.kategori} sebesar ${fmtJam(satu.nilai)} jam (${fmtPct(satu.persen)})${unitInfo}${kalimatDua}.`
        + `${gabungan} ${konteks(src.periode, src.job)}.${kalimatContoh(satu.data.contoh)} Menjadi area utama tindak lanjut.`,
    };
  }

  function buildUaText(input) {
    const src = input || {};
    const ranked = paretoRank(src.items, 'jam');
    if (!ranked.ranked.length) return null;
    const varPct = variancePct(src.delta, src.pPlan);
    const [satu, dua] = ranked.ranked;
    const gabungan = ranked.ranked.length > 1
      ? ` Kedua event tersebut menyumbang ${fmtPct(ranked.ranked[ranked.ranked.length - 1].kumulatif)} dari total ${fmtJam(ranked.total)} jam standby`
      : ` Event tersebut menyumbang ${fmtPct(satu.kumulatif)} dari total ${fmtJam(ranked.total)} jam standby`;
    const unitInfo = namaUnit(satu.data) ? ` pada ${namaUnit(satu.data)}` : '';
    const kalimatDua = dua
      ? `, diikuti ${dua.data.kategori} sebesar ${fmtJam(dua.nilai)} jam (${fmtPct(dua.persen)})${namaUnit(dua.data) ? ` pada ${namaUnit(dua.data)}` : ''}`
      : '';
    return {
      attribute: 'UA', variance: varPct, status: 'negative', source: '4. Standby',
      filters: { periode: src.periode || null, job: src.job || null },
      pareto: ranked.ranked, cumulativeContribution: ranked.ranked[ranked.ranked.length - 1].kumulatif,
      smartText: `Use of Availability menyimpang ${varPct == null ? 'N/A' : fmtVar(varPct)} dari target.`
        + ` Standby terbesar berasal dari ${satu.data.kategori} sebesar ${fmtJam(satu.nilai)} jam (${fmtPct(satu.persen)})${unitInfo}${kalimatDua}.`
        + `${gabungan} ${konteks(src.periode, src.job)}.${kalimatContoh(satu.data.contoh)} Menjadi area utama tindak lanjut.`,
    };
  }

  function buildProdText(input) {
    const src = input || {};
    const ranked = paretoRank(src.items, 'kejadian');
    if (!ranked.ranked.length) return null;
    const varPct = variancePct(src.delta, src.pPlan);
    const labelProd = d => d.problem || d.kode || d.kategori;
    const katInfo = d => (d.kategori && d.kategori !== labelProd(d) ? ` (kategori ${d.kategori})` : '');
    const [satu, dua] = ranked.ranked;
    const topCount = ranked.ranked.reduce((t, r) => t + r.nilai, 0);
    const topKum = ranked.ranked[ranked.ranked.length - 1].kumulatif;
    const gabungan = ` muncul ${fmtMenit(topCount)} kali (${fmtPct(topKum)}) dari total ${fmtMenit(ranked.total)} kejadian`;
    const unitInfo = namaUnit(satu.data) ? ` pada ${namaUnit(satu.data)}` : '';
    const kalimatDua = dua
      ? `, diikuti ${labelProd(dua.data)}${katInfo(dua.data)} (${fmtMenit(dua.nilai)} kejadian)`
      : '';
    return {
      attribute: 'Productivity', variance: varPct, status: 'negative', source: '5. Input Ritase - Problem Productivity',
      filters: { periode: src.periode || null, job: src.job || null },
      pareto: ranked.ranked, cumulativeContribution: topKum,
      smartText: `Productivity berada ${varPct == null ? 'N/A' : fmtVar(Math.abs(varPct))} di bawah target.`
        + ` Problem paling sering muncul ${labelProd(satu.data)}${katInfo(satu.data)} sebanyak ${fmtMenit(satu.nilai)} kejadian (${fmtPct(satu.persen)})${unitInfo}${kalimatDua}.`
        + ` Gabungan teratas${gabungan} ${konteks(src.periode, src.job)}. Menjadi area utama tindak lanjut.`,
    };
  }

  const api = { shouldShow, variancePct, paretoRank, buildPaText, buildUaText, buildProdText };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReviewParetoCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
