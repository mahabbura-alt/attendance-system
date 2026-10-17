'use strict';

const DEFAULT_WARNING_HM = 50;
const HM_TOLERANCE = 0.001;

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} harus berupa angka ≥ 0.`);
  return number;
}

function calculateDueState(input = {}) {
  const intervalHm = finiteNonNegative(input.intervalHm, 'Interval HM');
  if (intervalHm <= 0) throw new Error('Interval HM harus lebih dari 0.');
  const warningHm = finiteNonNegative(input.warningHm ?? 0, 'Warning HM');
  const currentHm = input.currentHm === null || input.currentHm === undefined ? null : finiteNonNegative(input.currentHm, 'HM aktual');
  const baselineHm = finiteNonNegative(input.lastServiceHm ?? input.baselineHm ?? 0, 'Baseline HM');
  const nextDueHm = baselineHm + intervalHm;
  if (currentHm === null) return { status: 'missing_hm', currentHm: null, baselineHm, nextDueHm, remainingHm: null, progressPercent: null };
  const remainingHm = nextDueHm - currentHm;
  const progressPercent = Math.max(0, ((currentHm - baselineHm) / intervalHm) * 100);
  let status = 'normal';
  if (remainingHm < 0) status = 'overdue';
  else if (remainingHm === 0) status = 'due';
  else if (remainingHm <= warningHm) status = 'upcoming';
  return { status, currentHm, baselineHm, nextDueHm, remainingHm, progressPercent };
}

function modelKey(equipmentClass, equipmentModel) {
  return `${String(equipmentClass || '').trim().toLocaleLowerCase('id-ID')}::${String(equipmentModel || '').trim().toLocaleLowerCase('id-ID')}`;
}

function positiveCycle(value, label = 'Cycle HM') {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} harus lebih dari 0.`);
  return result;
}

function isCycleMilestone(milestone, cycle) {
  const ratio = milestone / cycle;
  return Math.abs(ratio - Math.round(ratio)) <= HM_TOLERANCE;
}

function calculateModelSchedule(input = {}) {
  const packages = (Array.isArray(input.packages) ? input.packages : [])
    .map(pack => ({ ...pack, cycle_hm: positiveCycle(pack.cycle_hm, `Cycle HM ${pack.service_code || ''}`) }))
    .sort((a, b) => a.cycle_hm - b.cycle_hm || String(a.service_code || '').localeCompare(String(b.service_code || ''), 'id-ID'));
  if (!packages.length) return { status: 'not_configured', packages: [], baseCycleHm: null };
  const baseCycleHm = packages[0].cycle_hm;
  const warningHm = finiteNonNegative(input.warningHm ?? DEFAULT_WARNING_HM, 'Warning HM');
  const currentHm = input.currentHm === null || input.currentHm === undefined ? null : finiteNonNegative(input.currentHm, 'HM aktual');
  const completedDueHm = input.lastCompletedDueHm === null || input.lastCompletedDueHm === undefined
    ? null : finiteNonNegative(input.lastCompletedDueHm, 'Milestone service terakhir');
  const enrollmentHm = input.enrollmentHm === null || input.enrollmentHm === undefined
    ? currentHm : finiteNonNegative(input.enrollmentHm, 'HM saat setup');
  if (currentHm === null || enrollmentHm === null) {
    return { status: 'missing_hm', currentHm: null, baseCycleHm, warningHm, nextDueHm: null, remainingHm: null, progressPercent: null, packages };
  }
  const nextDueHm = completedDueHm === null
    ? Math.ceil((enrollmentHm - HM_TOLERANCE) / baseCycleHm) * baseCycleHm
    : completedDueHm + baseCycleHm;
  const applicable = packages.filter(pack => isCycleMilestone(nextDueHm, pack.cycle_hm));
  const selectedPackage = (applicable.length ? applicable : [packages[0]])
    .sort((a, b) => b.cycle_hm - a.cycle_hm || String(a.service_code || '').localeCompare(String(b.service_code || ''), 'id-ID'))[0];
  const remainingHm = nextDueHm - currentHm;
  const previousMilestone = nextDueHm - baseCycleHm;
  const progressPercent = Math.max(0, ((currentHm - previousMilestone) / baseCycleHm) * 100);
  let status = 'normal';
  if (remainingHm < -HM_TOLERANCE) status = 'overdue';
  else if (Math.abs(remainingHm) <= HM_TOLERANCE) status = 'due';
  else if (remainingHm <= warningHm) status = 'upcoming';
  return {
    status, currentHm, enrollmentHm, baseCycleHm, warningHm, nextDueHm, remainingHm, progressPercent,
    packageId: selectedPackage.id || null,
    serviceCode: selectedPackage.service_code || null,
    serviceName: selectedPackage.service_name || null,
    serviceCycleHm: selectedPackage.cycle_hm,
    packages
  };
}

function hoursBetween(start, finish) {
  const from = new Date(start);
  const to = new Date(finish);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error('Waktu service tidak valid.');
  if (to < from) throw new Error('Waktu selesai service tidak boleh lebih awal dari waktu mulai.');
  return (to.getTime() - from.getTime()) / 3600000;
}

function validIsoDate(value, label) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`${label} harus berformat YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} tidak valid.`);
  }
  return { text, epochDay: Math.floor(date.getTime() / 86400000) };
}

function resolveDashboardRange(input = {}, fallbackDate) {
  const today = validIsoDate(fallbackDate, 'Tanggal acuan').text;
  const from = validIsoDate(input.date_from || `${today.slice(0, 7)}-01`, 'Tanggal mulai');
  const to = validIsoDate(input.date_to || today, 'Tanggal selesai');
  if (to.epochDay < from.epochDay) throw new Error('Tanggal selesai tidak boleh lebih awal dari tanggal mulai.');
  if ((to.epochDay - from.epochDay) > 366) throw new Error('Range Periodic Service maksimal 366 hari.');
  return { dateFrom: from.text, dateTo: to.text };
}

function scopeFromUser(user = {}) {
  return {
    tenantKey: String(user.tenant_id || user.tenantId || 'default'),
    projectKey: String(user.project_id || user.projectId || 'default')
  };
}

module.exports = {
  DEFAULT_WARNING_HM,
  HM_TOLERANCE,
  calculateDueState,
  calculateModelSchedule,
  modelKey,
  hoursBetween,
  resolveDashboardRange,
  scopeFromUser
};
