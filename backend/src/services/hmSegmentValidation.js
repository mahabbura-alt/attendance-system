'use strict';

// Domain service untuk validasi segmen Work Log (pergantian operator /
// pergantian PIT-Area / JOB) pada satu sesi unit-shift.
//
// Satu Work Log adalah SATU segmen penugasan operator, bukan representasi
// tunggal seluruh unit-shift. Dalam satu sesi (scope + tanggal operasional +
// shift + unit) boleh ada beberapa segmen selama interval HM tidak overlap.
//
// Fungsi di sini murni (tanpa akses database) agar create, update, import,
// restore, batch, dan preview memakai rule identik. Layer controller
// bertanggung jawab memuat sesi, mengunci baris, dan memetakan hasil ke HTTP.

// Toleransi kontinuitas HM (jam). Dipertahankan dari kebijakan lama agar
// perubahan tidak diam-diam mengganti ambang.
const HM_CONTINUITY_TOLERANCE = 0.10;
const MOHH_REFERENCE_HOURS = 12;
const DAILY_CALENDAR_HOURS = 24;

const round2 = value => Number(Number(value).toFixed(2));
const hasFiniteBoundary = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

// Interval diperlakukan sebagai rentang setengah terbuka [start, finish).
// Dua segmen yang bersebelahan (finish A === start B) TIDAK overlap.
function overlaps(a, b, tolerance = HM_CONTINUITY_TOLERANCE) {
  return Math.max(0, Math.min(a.finish, b.finish) - Math.max(a.start, b.start)) > tolerance;
}

function hmTotalOf(segment) {
  return round2(Math.max(0, Number(segment.hmFinish) - Number(segment.hmStart)));
}

// Hitung total HM unit-shift dari seluruh segmen aktif (termasuk kandidat).
function sessionTotalHm(segments) {
  return round2(segments.reduce((sum, segment) => sum + hmTotalOf(segment), 0));
}

// Ringkasan sesi untuk konsumsi UI dan agregasi hilir (MOHH, review, dll).
function buildSessionSummary(segments, { hardIssues = [], criticalIssues = [], warnings = [] } = {}) {
  const totalHm = sessionTotalHm(segments);
  const operatorIds = new Set(segments.map(segment => segment.operatorId).filter(Boolean));
  const operatorCount = operatorIds.size;
  const segmentCount = segments.length;
  const handoverCount = Math.max(0, segmentCount - 1);
  const hasGap = warnings.some(issue => issue.code === 'HM_SEGMENT_GAP');
  const hasOverlap =
    hardIssues.some(issue => issue.code === 'HM_SEGMENT_OVERLAP') ||
    criticalIssues.some(issue => issue.code === 'HM_SEGMENT_OVERLAP');
  const hasDraft = segments.some(segment => segment.status === 'draft');
  const hasIncomplete = segments.some(segment => !segment.operatorId || segment.hmStart == null || segment.hmFinish == null);

  let quality = 'normal';
  if (hasOverlap) quality = 'overlap_blocked';
  else if (hasGap) quality = 'gap';
  else if (hasDraft || hasIncomplete) quality = 'draft_incomplete';

  return { totalHm, operatorCount, segmentCount, handoverCount, quality, hasGap, hasOverlap, hasDraft };
}

/**
 * Validasi satu segmen kandidat terhadap sesi unit-shift dan kontinuitas
 * lintas shift.
 *
 * @param {object} candidate
 *   - id (uuid|null): segmen yang sedang diedit (dikecualikan dari duplikat/overlap)
 *   - hmStart, hmFinish (number)
 *   - operatorId (uuid|null)
 *   - status ('draft'|'submitted')
 *   - areaName, job (string|null) — atribut segmen, TIDAK menghapus proteksi overlap
 * @param {object} options
 *   - segments: segmen aktif lain pada unit+tanggal+shift yang sama
 *     (shape: { id, hmStart, hmFinish, operatorId, areaName, job, status })
 *   - previousShiftMaxFinish: HM finish tertinggi segmen pada shift sebelum
 *   - nextShiftMinStart: HM start terendah segmen pada shift sesudah
 *   - dailyOtherTotal: total HM unit pada tanggal yang sama dari shift LAIN
 *   - tolerance
 * @returns {{ hardIssues, criticalIssues, warnings, summary }}
 */
function validateHmSegment(candidate, options = {}) {
  const tolerance = Number.isFinite(Number(options.tolerance)) ? Number(options.tolerance) : HM_CONTINUITY_TOLERANCE;
  const segments = Array.isArray(options.segments) ? options.segments : [];
  const hardIssues = [];
  const criticalIssues = [];
  const warnings = [];

  const start = Number(candidate.hmStart);
  const finish = Number(candidate.hmFinish);
  const candidateTotal = round2(Math.max(0, finish - start));
  const candidateKey = candidate.id || null;

  // Nilai HM tidak valid (meter rollback / negatif) — mengikuti mekanisme
  // meter reset yang sudah ada; TIDAK otomatis dianggap pergantian operator.
  if (!Number.isFinite(start) || !Number.isFinite(finish) || start < 0 || finish < 0) {
    hardIssues.push({ code: 'HM_INVALID', message: 'HM Start dan HM Akhir harus berupa angka positif.' });
  } else if (finish < start) {
    criticalIssues.push({ code: 'HM_ROLLBACK', message: 'HM Akhir tidak boleh lebih kecil dari HM Start (kemungkinan meter reset).' });
  }

  const others = segments.filter(segment => segment.id !== candidateKey);

  // 1) Duplikat persis: operator, unit, tanggal, shift, dan interval identik.
  const exact = others.find(segment =>
    String(segment.operatorId || '') === String(candidate.operatorId || '') &&
    round2(Number(segment.hmStart)) === round2(start) &&
    round2(Number(segment.hmFinish)) === round2(finish)
  );
  if (exact) {
    hardIssues.push({ code: 'EXACT_SEGMENT_DUPLICATE', message: 'Segmen dengan operator dan interval HM yang sama sudah ada pada unit, tanggal, dan shift ini.' });
  }

  // 2) Overlap terhadap segmen lain pada sesi yang sama. Perbedaan operator,
  //    PIT/Area, atau JOB TIDAK menghapus konflik karena satu unit fisik tidak
  //    dapat mencatat dua kenaikan HM pada saat yang sama.
  for (const segment of others) {
    if (overlaps({ start, finish }, { start: Number(segment.hmStart), finish: Number(segment.hmFinish) }, tolerance)) {
      const overlapAmount = round2(Math.min(finish, Number(segment.hmFinish)) - Math.max(start, Number(segment.hmStart)));
      criticalIssues.push({
        code: 'HM_SEGMENT_OVERLAP',
        conflictId: segment.id,
        overlap: overlapAmount,
        message: `Interval HM ${start.toFixed(2)}–${finish.toFixed(2)} tumpang tindih dengan segmen ${Number(segment.hmStart).toFixed(2)}–${Number(segment.hmFinish).toFixed(2)} sebesar ${overlapAmount.toFixed(2)} HM.`
      });
      break;
    }
  }

  // 3) Gap antarsegmen dalam sesi = peringatan (unit dapat berhenti).
  //    Hanya dihitung bila kandidat adalah segmen paling awal yang mulai
  //    setelah finish tertinggi segmen sebelumnya, agar segmen lain yang
  //    sudah menjembatani jeda tidak memicu peringatan ganda.
  let maxPreviousFinish = null;
  for (const segment of others) {
    const segFinish = Number(segment.hmFinish);
    if (segFinish <= start + tolerance && (maxPreviousFinish === null || segFinish > maxPreviousFinish)) {
      maxPreviousFinish = segFinish;
    }
  }
  if (maxPreviousFinish !== null && start > maxPreviousFinish + tolerance) {
    const earliestStartAfter = others
      .filter(segment => Number(segment.hmStart) > maxPreviousFinish + tolerance)
      .map(segment => Number(segment.hmStart));
    const candidateIsEarliest = earliestStartAfter.length === 0 || Math.min(...earliestStartAfter) >= start - tolerance;
    if (candidateIsEarliest) {
      const gap = round2(start - maxPreviousFinish);
      warnings.push({ code: 'HM_SEGMENT_GAP', gap, previousFinish: maxPreviousFinish, message: `Ada jeda ${gap.toFixed(2)} HM dari segmen sebelumnya (${maxPreviousFinish.toFixed(2)}) ke segmen ini (${start.toFixed(2)}).` });
    }
  }

  // 4) Kontinuitas lintas shift memakai segmen terakhir shift sebelumnya dan
  //    segmen pertama shift sesudah (bukan created_at).
  if (hasFiniteBoundary(options.previousShiftMaxFinish)) {
    const prevFinish = Number(options.previousShiftMaxFinish);
    const gap = round2(start - prevFinish);
    const detail = { previousFinish: prevFinish, currentStart: start, gap };
    if (gap < -tolerance) {
      criticalIssues.push({ code: 'HM_ROLLBACK', ...detail, message: `HM Start ${start.toFixed(2)} lebih rendah dari HM Finish terakhir shift sebelumnya ${prevFinish.toFixed(2)}. Selisih ${gap.toFixed(2)} HM.` });
    } else if (gap > tolerance) {
      warnings.push({ code: 'HM_CONTINUITY_GAP', ...detail, message: `Ada jeda ${gap.toFixed(2)} HM dari HM Finish shift terakhir ${prevFinish.toFixed(2)} ke HM Start ${start.toFixed(2)}.` });
    }
  }
  if (hasFiniteBoundary(options.nextShiftMinStart)) {
    const nextStart = Number(options.nextShiftMinStart);
    const overlapAmount = round2(finish - nextStart);
    if (overlapAmount > tolerance) {
      criticalIssues.push({ code: 'HM_OVERLAPS_NEXT', nextStart, currentFinish: finish, overlap: overlapAmount, message: `HM Akhir ${finish.toFixed(2)} melewati HM Start shift berikutnya ${nextStart.toFixed(2)} sebesar ${overlapAmount.toFixed(2)} HM.` });
    }
  }

  // 5) Peringatan >12 HM dievaluasi pada TOTAL unit-shift, bukan per segmen.
  const allSegments = [...others, { hmStart: start, hmFinish: finish, operatorId: candidate.operatorId, status: candidate.status }];
  const totalHm = sessionTotalHm(allSegments);
  if (totalHm > MOHH_REFERENCE_HOURS) {
    warnings.push({ code: 'UNIT_SHIFT_OVER_LIMIT', totalHm, message: `Total HM unit-shift menjadi ${totalHm.toFixed(2)} jam dan melebihi acuan ${MOHH_REFERENCE_HOURS} jam.` });
  }

  // 6) Total harian (seluruh shift pada tanggal operasional) tetap dibatasi 24.
  const dailyOtherTotal = Number(options.dailyOtherTotal) || 0;
  const dailyTotal = round2(dailyOtherTotal + totalHm);
  if (dailyTotal > DAILY_CALENDAR_HOURS + 0.01) {
    hardIssues.push({ code: 'DAILY_OVER_24', dailyTotal, message: `Total HM harian unit menjadi ${dailyTotal.toFixed(2)} jam dan melebihi Calendar Hours 24 jam.` });
  }

  // 7) Record submitted wajib memiliki operator dan interval HM valid.
  if (candidate.status === 'submitted' && !candidate.operatorId) {
    hardIssues.push({ code: 'OPERATOR_REQUIRED_FOR_SUBMIT', message: 'Operator wajib diisi sebelum Work Log dapat disubmit.' });
  }

  const summary = buildSessionSummary(allSegments, { hardIssues, criticalIssues, warnings });
  return { hardIssues, criticalIssues, warnings, summary };
}

module.exports = {
  HM_CONTINUITY_TOLERANCE,
  MOHH_REFERENCE_HOURS,
  DAILY_CALENDAR_HOURS,
  round2,
  overlaps,
  hmTotalOf,
  sessionTotalHm,
  buildSessionSummary,
  validateHmSegment
};
