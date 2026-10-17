'use strict';

const FleetDeployment = require('./fleetDeployment');

const TOLERANCE = 1e-6;

function finitePositive(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} harus lebih dari 0.`);
  return result;
}

function durationFromOrder(order = {}) {
  if (!order.actual_start || !order.actual_finish) return null;
  const start = new Date(order.actual_start);
  const finish = new Date(order.actual_finish);
  const hours = (finish.getTime() - start.getTime()) / 3600000;
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

function packageForMilestone(packages, milestone) {
  const rows = (Array.isArray(packages) ? packages : [])
    .map(pack => ({ ...pack, cycle_hm: finitePositive(pack.cycle_hm, `Cycle HM ${pack.service_code || ''}`) }))
    .filter(pack => Math.abs((Number(milestone) / pack.cycle_hm) - Math.round(Number(milestone) / pack.cycle_hm)) <= TOLERANCE)
    .sort((left, right) => right.cycle_hm - left.cycle_hm);
  return rows[0] || null;
}

function calculatePeriodPa(days) {
  if (!Array.isArray(days) || !days.length || days.some(day => day.pa === null)) return null;
  const totalMohh = days.length * 24;
  const totalDowntime = days.reduce((sum, day) => sum + Math.min(24, Math.max(0, Number(day.downtimeHours || 0))), 0);
  return totalMohh > 0 ? ((totalMohh - totalDowntime) / totalMohh) * 100 : null;
}

function allocateDowntime(rows, dates, eventDate, event) {
  let remaining = Number(event.durationHours);
  const startIndex = dates.indexOf(eventDate);
  if (!(remaining > 0) || startIndex < 0) return;
  for (let index = startIndex; index < dates.length && remaining > TOLERANCE; index += 1) {
    const day = rows.get(dates[index]);
    const available = Math.max(0, 24 - day.downtimeHours);
    const allocated = Math.min(available, remaining);
    if (!(allocated > 0)) continue;
    day.downtimeHours += allocated;
    day.events.push({
      ...event,
      durationHours: allocated,
      totalDurationHours: Number(event.durationHours),
      continuation: index > startIndex
    });
    remaining -= allocated;
  }
}

function forecastUnit(input = {}) {
  const dates = FleetDeployment.expandDates(input.dateFrom, input.dateTo);
  const currentHm = Number(input.currentHm);
  const nextDue = Number(input.nextDueHm);
  const baseCycle = Number(input.baseCycleHm);
  const packages = Array.isArray(input.packages) ? input.packages : [];
  const ewhByDate = input.ewhByDate || {};
  const hmDate = String(input.hmDate || '');
  const rows = new Map(dates.map(date => [date, { date, ewh: null, downtimeHours: 0, pa: null, complete: true, events: [] }]));
  const reservedMilestones = new Set();

  for (const order of (Array.isArray(input.orders) ? input.orders : [])) {
    if (order.status === 'cancelled' || !rows.has(order.eventDate)) continue;
    const pack = packages.find(item => String(item.id) === String(order.package_id)) || packageForMilestone(packages, order.due_hm);
    const actualHours = durationFromOrder(order);
    const duration = actualHours ?? Number(pack?.estimated_duration_hours);
    if (!(duration > 0)) continue;
    allocateDowntime(rows, dates, order.eventDate, {
      source: actualHours !== null ? 'actual' : 'scheduled',
      serviceCode: order.service_code || pack?.service_code || 'PS',
      dueHm: Number(order.due_hm), durationHours: duration, orderId: order.id || null
    });
    if (Number.isFinite(Number(order.due_hm))) reservedMilestones.add(Number(order.due_hm).toFixed(3));
  }

  let projectedHm = Number.isFinite(currentHm) ? currentHm : null;
  let milestone = Number.isFinite(nextDue) ? nextDue : null;
  let uncertain = projectedHm === null || milestone === null || !(baseCycle > 0);
  for (const date of dates) {
    const day = rows.get(date);
    if (date <= hmDate) {
      day.pa = Math.max(0, ((24 - Math.min(24, day.downtimeHours)) / 24) * 100);
      continue;
    }
    const rawEwh = ewhByDate[date];
    const ewh = rawEwh === null || rawEwh === undefined || rawEwh === '' ? null : Number(rawEwh);
    if (!Number.isFinite(ewh) || ewh < 0 || ewh > 24) uncertain = true;
    if (uncertain) {
      day.complete = false;
      day.ewh = Number.isFinite(ewh) ? ewh : null;
      day.pa = null;
      continue;
    }
    day.ewh = ewh;
    projectedHm += ewh;
    let guard = 0;
    while (projectedHm + TOLERANCE >= milestone && guard < 20) {
      guard += 1;
      const key = Number(milestone).toFixed(3);
      if (!reservedMilestones.has(key)) {
        const pack = packageForMilestone(packages, milestone);
        const duration = Number(pack?.estimated_duration_hours);
        if (!pack || !(duration > 0)) {
          uncertain = true;
          day.complete = false;
          break;
        }
        allocateDowntime(rows, dates, date, {
          source: 'estimate', serviceCode: pack.service_code || 'PS', dueHm: milestone,
          durationHours: duration, orderId: null
        });
      }
      milestone += baseCycle;
    }
    day.pa = day.complete ? Math.max(0, ((24 - Math.min(24, day.downtimeHours)) / 24) * 100) : null;
  }

  const days = dates.map(date => rows.get(date));
  return {
    days,
    periodPa: calculatePeriodPa(days),
    totalMohh: days.length * 24,
    totalDowntimeHours: days.reduce((sum, day) => sum + Number(day.downtimeHours || 0), 0),
    complete: days.every(day => day.pa !== null)
  };
}

module.exports = { durationFromOrder, packageForMilestone, calculatePeriodPa, allocateDowntime, forecastUnit };
