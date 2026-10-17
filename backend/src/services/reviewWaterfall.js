'use strict';

const FORMULA_VERSION = 'review-waterfall-direct-delay-v3';
const valid = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

// All inputs refer to one date/unit/PIT/JOB/material/UoM allocation.
// No percentage substitution, residual distribution or clipping of SPO hours.
function calculateCell(input = {}) {
  const keys = ['availablePlanHours', 'delayPlanHours', 'productivityPlan', 'hmActual', 'standbyActual', 'actualProduction'];
  if (keys.some(key => !valid(input[key]) || Number(input[key]) < 0)) return null;
  const a = Number(input.availablePlanHours); const s = Number(input.delayPlanHours);
  const q = Number(input.productivityPlan); const h = Number(input.hmActual);
  const d = Number(input.standbyActual); const v = Number(input.actualProduction);
  if (!(q > 0) || s > a + 1e-9) return null;
  const plan = (a - s) * q;
  const dppa = (h + d - a) * q;
  const dpua = (s - d) * q;
  const afterPa = plan + dppa;
  const afterUa = h * q;
  return { plan, afterPa, afterUa, dppa, dpua, dProd: v - afterUa, actualProduction: v,
    ewhPlan: a - s, availablePlanHours: a, delayPlanHours: s,
    uaPlan: a > 0 ? (a - s) / a : null, formulaVersion: FORMULA_VERSION };
}

// PA/available-hour impact = planned BD - actual BD + observed-time difference.
// Keeping the latter separate prevents missing schedule hours being called BD.
function paItems({ scheduleHours, availablePlanHours, hmActual, standbyActual, breakdownActual, productivityPlan, actualItems = [], actualShare = 1, unit }) {
  const q = productivityPlan;
  const rows = [{ key: 'PLAN_BD', description: 'Budget breakdown plan', hours: scheduleHours - availablePlanHours,
    impact: (scheduleHours - availablePlanHours) * q, units: [unit] }];
  let mapped = 0;
  for (const item of actualItems) {
    const hours = item.hours * actualShare; mapped += hours;
    rows.push({ key: `BD:${item.description}`, description: item.description, hours, impact: -hours * q, units: [unit] });
  }
  if (Math.abs(breakdownActual - mapped) > 1e-9) rows.push({ key: 'UNMAPPED_BD', description: 'Breakdown belum terpetakan',
    hours: breakdownActual - mapped, impact: -(breakdownActual - mapped) * q, units: [unit] });
  const timeGap = hmActual + standbyActual + breakdownActual - scheduleHours;
  rows.push({ key: 'TIME_COVERAGE', description: 'Selisih jam tercatat terhadap jadwal', hours: timeGap, impact: timeGap * q, units: [unit] });
  return rows;
}

function aggregatePa(items, authoritativeDeltaPa) {
  const map = new Map();
  for (const item of items) {
    const row = map.get(item.key) || { ...item, hours: 0, impact: 0, units: new Set() };
    row.hours += item.hours; row.impact += item.impact;
    for (const unit of item.units) if (unit) row.units.add(unit);
    map.set(item.key, row);
  }
  const rows = [...map.values()].map(row => ({ ...row, units: [...row.units] }));
  const total = rows.reduce((sum, row) => sum + row.impact, 0);
  const difference = authoritativeDeltaPa == null ? null : total - authoritativeDeltaPa;
  return { formulaVersion: FORMULA_VERSION, items: rows, authoritativeDeltaPa, total, difference,
    reconciled: difference != null && Math.abs(difference) <= Math.max(1e-8, Math.abs(authoritativeDeltaPa) * 1e-10) };
}

module.exports = { FORMULA_VERSION, calculateCell, paItems, aggregatePa };
