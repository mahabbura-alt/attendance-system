/**
 * CONTROLLER PRODUKSI TAMBANG (MINING PRODUCTION)
 * OMOS - One Mining, One System
 * 
 * Menangani 12 Submenu Produksi, Perhitungan Otomatis, Fleet Auto-Mapping,
 * Analisis Performa & KPI, Ekspor Data (Excel/CSV/PDF), dan Integrasi AI Engine.
 */

const { pool } = require('../config/db');
const ProductionAiEngine = require('../services/productionAi.service');

// Helper untuk format tanggal YYYY-MM-DD
function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function parseCapacityValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Value kapasitas unit harus berupa angka.');
  return Number(parsed.toFixed(1));
}

function isDozerEquipmentType(value) {
  return /(?:^|[^a-z])(?:bull)?dozer(?:[^a-z]|$)/i.test(String(value || '').trim());
}

function resolveCapacityUom(equipmentType, capacityValue, suppliedUom) {
  const explicitUom = String(suppliedUom || '').trim();
  if (explicitUom) return explicitUom;
  const hasCapacity = capacityValue !== undefined && capacityValue !== null && String(capacityValue).trim() !== '';
  return hasCapacity && isDozerEquipmentType(equipmentType) ? 'BCM/Hr' : null;
}

function normalizeEquipmentStatus(value) {
  return String(value || 'Ready').trim() || 'Ready';
}

function calculateHmTotal(hmStart, hmFinish) {
  const start = Number(hmStart);
  const finish = Number(hmFinish);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || start < 0 || finish < 0) {
    throw new Error('HM Start dan HM Akhir harus berupa angka positif.');
  }
  if (finish < start) throw new Error('HM Akhir tidak boleh lebih kecil dari HM Start.');
  return Number((finish - start).toFixed(2));
}

function parseOptionalNonNegativeNumber(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} harus berupa angka positif.`);
  return parsed;
}

function nullableFiniteNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const BREAKDOWN_ACTIVE_STATUSES = new Set([
  'mechanic_progress',
  'waiting_part',
  'waiting_tool',
  'waiting_manpower',
  'waiting_vendor'
]);

const BREAKDOWN_READY_CHECKS = [
  'functional_test',
  'no_leak_or_alarm',
  'safety_devices',
  'tools_cleared',
  'safe_to_operate'
];

const SYSTEM_VERIFICATION_STANDBY_CODE = 'STB-SYS-01';
const STANDBY_REVIEW_STATUSES = new Set(['pending', 'approved', 'returned']);
const STANDBY_LIFECYCLE_STATUSES = new Set(['open', 'confirmed', 'reclassified', 'cancelled']);
const OPERATIONAL_DAY_START_HOUR = 6;
const OPERATIONAL_NIGHT_START_HOUR = 18;
const STANDBY_MOHH_TARGET_HOURS = 12;
const STANDBY_MOHH_TOLERANCE_HOURS = 0.01;

function jakartaDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Timestamp operasional tidak valid.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function addOperationalDays(dateValue, days) {
  const parsed = new Date(`${normalizeDateOnly(dateValue)}T12:00:00+07:00`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return jakartaDateParts(parsed).date;
}

function operationalDateForInstant(value) {
  const parts = jakartaDateParts(value);
  return parts.hour < OPERATIONAL_DAY_START_HOUR ? addOperationalDays(parts.date, -1) : parts.date;
}

function operationalShiftKindForInstant(value) {
  const parts = jakartaDateParts(value);
  return parts.hour >= OPERATIONAL_DAY_START_HOUR && parts.hour < OPERATIONAL_NIGHT_START_HOUR ? 'siang' : 'malam';
}

function operationalDayBounds(dateValue) {
  const date = normalizeDateOnly(dateValue, 'Tanggal operasional');
  const nextDate = addOperationalDays(date, 1);
  return {
    start: new Date(`${date}T06:00:00+07:00`),
    dayEnd: new Date(`${date}T18:00:00+07:00`),
    end: new Date(`${nextDate}T06:00:00+07:00`)
  };
}

function calculateIntervalHours(startValue, finishValue) {
  const start = startValue instanceof Date ? startValue : new Date(startValue);
  const finish = finishValue instanceof Date ? finishValue : new Date(finishValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime()) || finish < start) return 0;
  return (finish.getTime() - start.getTime()) / 3600000;
}

function intervalOverlapHours(leftStart, leftFinish, rightStart, rightFinish) {
  const start = Math.max(new Date(leftStart).getTime(), new Date(rightStart).getTime());
  const finish = Math.min(new Date(leftFinish).getTime(), new Date(rightFinish).getTime());
  return Number.isFinite(start) && Number.isFinite(finish) && finish > start ? (finish - start) / 3600000 : 0;
}

function calculateStandbyMohhControl(input = {}) {
  const targetHours = Number.isFinite(Number(input.targetHours)) ? Number(input.targetHours) : STANDBY_MOHH_TARGET_HOURS;
  const hmHours = Math.max(0, Number(input.hmHours) || 0);
  const breakdownHours = Math.max(0, Number(input.breakdownHours) || 0);
  const standbyHours = Math.max(0, Number(input.standbyHours) || 0);
  const hmRecords = Math.max(0, Number(input.hmRecords) || 0);
  const pendingReview = Math.max(0, Number(input.pendingReview) || 0);
  const returnedReview = Math.max(0, Number(input.returnedReview) || 0);
  const overlapHours = Math.max(0, Number(input.overlapHours) || 0);
  const standbyOverlapHours = Math.max(0, Number(input.standbyOverlapHours) || 0);
  const accountedHours = hmHours + breakdownHours + standbyHours;
  const balanceHours = targetHours - accountedHours;
  const requiredStandbyHours = Math.max(0, targetHours - hmHours - breakdownHours);
  const standbyGapHours = requiredStandbyHours - standbyHours;
  const tolerance = STANDBY_MOHH_TOLERANCE_HOURS;
  const issues = [];
  if (!hmRecords) issues.push({ code: 'HM_MISSING', severity: 'error', message: 'HM Input Data belum tercatat.' });
  if (hmRecords > 1) issues.push({ code: 'HM_DUPLICATE', severity: 'error', count: hmRecords, message: `Terdapat ${hmRecords} record HM pada unit-shift yang sama.` });
  if (hmHours > targetHours + tolerance) issues.push({ code: 'HM_OVER_MOHH', severity: 'error', message: 'HM melebihi MOHH 12 jam.' });
  if (breakdownHours > targetHours + tolerance) issues.push({ code: 'BD_OVER_MOHH', severity: 'error', message: 'Jam breakdown melebihi MOHH 12 jam.' });
  if (overlapHours > tolerance) issues.push({ code: 'STANDBY_BD_OVERLAP', severity: 'error', hours: overlapHours, message: 'Interval Standby bertumpang tindih dengan Breakdown.' });
  if (standbyOverlapHours > tolerance) issues.push({ code: 'STANDBY_OVERLAP', severity: 'error', hours: standbyOverlapHours, message: 'Terdapat interval Standby yang saling bertumpang tindih.' });
  if (balanceHours > tolerance) issues.push({ code: 'MOHH_UNDER', severity: 'warning', hours: balanceHours, message: `MOHH masih kurang ${balanceHours.toFixed(2)} jam.` });
  if (balanceHours < -tolerance) issues.push({ code: 'MOHH_OVER', severity: 'error', hours: Math.abs(balanceHours), message: `MOHH melebihi 12 jam sebesar ${Math.abs(balanceHours).toFixed(2)} jam.` });
  if (pendingReview) issues.push({ code: 'REVIEW_PENDING', severity: 'warning', count: pendingReview, message: `${pendingReview} record Standby belum direview.` });
  if (returnedReview) issues.push({ code: 'REVIEW_RETURNED', severity: 'error', count: returnedReview, message: `${returnedReview} record Standby dikembalikan untuk koreksi.` });

  const closure = input.closure || null;
  const snapshotChanged = Boolean(closure?.status === 'closed' && (
    Math.abs(Number(closure.hm_hours_snapshot || 0) - hmHours) > tolerance
    || Math.abs(Number(closure.breakdown_hours_snapshot || 0) - breakdownHours) > tolerance
    || Math.abs(Number(closure.standby_hours_snapshot || 0) - standbyHours) > tolerance
  ));
  if (snapshotChanged) issues.push({ code: 'CLOSURE_STALE', severity: 'error', message: 'HM, Breakdown, atau Standby berubah setelah shift ditutup.' });

  const hasConflict = overlapHours > tolerance || standbyOverlapHours > tolerance || hmRecords > 1;
  let status = 'under';
  if (!hmRecords) status = 'missing_hm';
  else if (snapshotChanged) status = 'stale';
  else if (hasConflict) status = 'conflict';
  else if (balanceHours < -tolerance) status = 'over';
  else if (Math.abs(balanceHours) <= tolerance) status = closure?.status === 'closed' ? 'closed' : 'balanced';
  else if (closure?.status === 'closed') status = 'stale';

  return {
    targetHours,
    hmHours,
    breakdownHours,
    standbyHours,
    accountedHours,
    balanceHours,
    requiredStandbyHours,
    standbyGapHours,
    hmRecords,
    pendingReview,
    returnedReview,
    overlapHours,
    standbyOverlapHours,
    status,
    issues,
    closure,
    canClose: hmRecords > 0 && Math.abs(balanceHours) <= tolerance && !hasConflict && !pendingReview && !returnedReview && !snapshotChanged
  };
}

function validateStandbyBatchWindow(tanggal, shiftKind, startValue, finishValue) {
  const operationalDate = normalizeDateOnly(tanggal, 'Tanggal operasional');
  const kind = String(shiftKind || '').trim().toLowerCase();
  if (!['siang', 'malam'].includes(kind)) throw new Error('Shift Multi Unit harus Shift Siang atau Shift Malam.');
  const start = new Date(startValue);
  const finish = new Date(finishValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime()) || finish <= start) {
    throw new Error('Jam mulai dan selesai Standby Multi Unit tidak valid.');
  }
  const bounds = operationalDayBounds(operationalDate);
  const windowStart = kind === 'siang' ? bounds.start : bounds.dayEnd;
  const windowFinish = kind === 'siang' ? bounds.dayEnd : bounds.end;
  if (start < windowStart || finish > windowFinish) {
    const label = kind === 'siang' ? '06:00–18:00' : '18:00–06:00';
    throw new Error(`Jam standby harus berada dalam periode Shift ${kind === 'siang' ? 'Siang' : 'Malam'} (${label}).`);
  }
  return { start, finish, totalHours: calculateIntervalHours(start, finish) };
}

function splitStandbyIntoOperationalSlices(row, fromDate, toDate, shiftIds = {}) {
  const eventStart = new Date(row.start_time);
  const eventFinish = new Date(row.finish_time || Date.now());
  if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventFinish.getTime()) || eventFinish <= eventStart) return [];
  const counted = !['reclassified', 'cancelled'].includes(String(row.lifecycle_status || '').toLowerCase());
  const slices = [];
  for (let date = normalizeDateOnly(fromDate); date <= normalizeDateOnly(toDate); date = addOperationalDays(date, 1)) {
    const bounds = operationalDayBounds(date);
    const windows = [
      { kind: 'siang', id: shiftIds.siang || null, name: 'Shift Siang', start: bounds.start, finish: bounds.dayEnd },
      { kind: 'malam', id: shiftIds.malam || null, name: 'Shift Malam', start: bounds.dayEnd, finish: bounds.end }
    ];
    windows.forEach(window => {
      const start = new Date(Math.max(eventStart.getTime(), window.start.getTime()));
      const finish = new Date(Math.min(eventFinish.getTime(), window.finish.getTime()));
      if (finish <= start) return;
      const rawHours = calculateIntervalHours(start, finish);
      slices.push({
        ...row,
        standby_log_id: row.id,
        operational_date: date,
        shift_id: window.id,
        shift_name: window.name,
        shift_kind: window.kind,
        slice_start: start.toISOString(),
        slice_finish: finish.toISOString(),
        raw_hours: rawHours,
        counted_hours: counted ? rawHours : 0
      });
    });
  }
  return slices;
}

function normalizeReadyVerification(input = {}) {
  const result = String(input.result || '').trim().toLowerCase();
  if (!['approved', 'rejected'].includes(result)) throw new Error('Hasil Verifikasi Ready tidak valid.');
  const checklistInput = input.checklist && typeof input.checklist === 'object' ? input.checklist : {};
  const checklist = Object.fromEntries(BREAKDOWN_READY_CHECKS.map(key => [key, parseBooleanInput(checklistInput[key])]));
  const note = String(input.note || '').trim() || null;
  const location = String(input.location || '').trim() || null;
  const meterHm = parseOptionalNonNegativeNumber(input.meter_hm, 'HM saat verifikasi');
  if (result === 'approved' && BREAKDOWN_READY_CHECKS.some(key => !checklist[key])) {
    throw new Error('Seluruh checklist kesiapan wajib dinyatakan aman sebelum Release to Operation.');
  }
  if (result === 'approved' && !location) throw new Error('Lokasi unit wajib diisi sebelum Release to Operation.');
  if (result === 'rejected' && !note) throw new Error('Catatan penolakan wajib diisi saat unit dikembalikan ke Maintenance.');
  const rejectionType = result === 'rejected' ? String(input.rejection_type || '').trim().toLowerCase() : null;
  if (result === 'rejected' && !['same_fault', 'new_fault'].includes(rejectionType)) {
    throw new Error('Jenis penolakan wajib dipilih: kerusakan sama atau kerusakan baru.');
  }
  const newFault = rejectionType === 'new_fault' ? {
    breakdownCodeId: String(input.new_breakdown_code_id || '').trim() || null,
    description: String(input.new_description || '').trim() || null,
    picId: String(input.new_pic_id || '').trim() || null
  } : null;
  if (newFault && (!newFault.breakdownCodeId || !newFault.description)) {
    throw new Error('Kode dan deskripsi kerusakan baru wajib diisi.');
  }
  return { result, checklist, note, location, meterHm, rejectionType, newFault };
}

function assertIndependentReadyVerifier(repairCompletedBy, verifierId) {
  if (repairCompletedBy && verifierId && String(repairCompletedBy) === String(verifierId)) {
    const separation = new Error('Verifikasi Ready wajib dilakukan user lain, bukan user yang menyelesaikan perbaikan.');
    separation.statusCode = 403;
    throw separation;
  }
  return true;
}

function assertIndependentStandbyReviewer(createdBy, reviewerId) {
  if (createdBy && reviewerId && String(createdBy) === String(reviewerId)) {
    const separation = new Error('Review Standby wajib dilakukan user lain, bukan user yang membuat record.');
    separation.statusCode = 403;
    throw separation;
  }
  return true;
}

function normalizeBreakdownStatus(value, { allowResolved = false } = {}) {
  const status = String(value || 'mechanic_progress').trim().toLowerCase();
  if (BREAKDOWN_ACTIVE_STATUSES.has(status) || (allowResolved && status === 'resolved')) return status;
  throw new Error('Status breakdown tidak valid.');
}

function normalizeBreakdownTimestamp(value, label) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(`${label} tidak valid.`);
  return parsed;
}

function normalizeBreakdownPart(input = {}) {
  const partDetail = String(input.part_detail || input.partDetail || '').trim();
  if (!partDetail) throw new Error('Detail part wajib diisi saat status Waiting Part.');
  const quantity = parseOptionalNonNegativeNumber(input.quantity, 'Quantity part');
  if (quantity === 0) throw new Error('Quantity part harus lebih besar dari 0.');
  const allowedPoStatuses = new Set(['requested', 'po_process', 'ordered', 'arrived', 'cancelled']);
  const poStatus = String(input.po_status || input.poStatus || 'requested').trim().toLowerCase();
  if (!allowedPoStatuses.has(poStatus)) throw new Error('Status PO tidak valid.');
  return {
    partDetail,
    poNumber: String(input.po_number || input.poNumber || '').trim() || null,
    quantity,
    poStatus,
    etaDate: input.eta_date || input.etaDate ? normalizeDateOnly(input.eta_date || input.etaDate, 'ETA part') : null
  };
}

async function insertBreakdownPart(db, breakdownId, rawPart, actorId) {
  const part = normalizeBreakdownPart(rawPart);
  const result = await db.query(`
    INSERT INTO breakdown_parts (
      breakdown_id, part_detail, po_number, quantity, po_status, eta_date, created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
    RETURNING *
  `, [breakdownId, part.partDetail, part.poNumber, part.quantity, part.poStatus, part.etaDate, actorId]);
  return result.rows[0];
}

function calculateBreakdownCalendarMetrics({ periodDays, activeUnitCount, totalBdHours, totalIncidents, mttrHours }) {
  const days = Math.max(0, Number(periodDays) || 0);
  const units = Math.max(0, Number(activeUnitCount) || 0);
  const downtime = Math.max(0, Number(totalBdHours) || 0);
  const incidents = Math.max(0, Number(totalIncidents) || 0);
  const calendarHours = days * units * 24;
  const uptimeHours = Math.max(0, calendarHours - downtime);
  return {
    calendarHours,
    uptimeHours,
    calendarPa: calendarHours > 0 ? Math.max(0, Math.min(100, (uptimeHours / calendarHours) * 100)) : 0,
    mtbfHours: incidents > 0 ? uptimeHours / incidents : calendarHours,
    mttrHours: Math.max(0, Number(mttrHours) || 0)
  };
}

const MAINTENANCE_EVENT_TYPES = new Set([
  'scheduled_service',
  'inspection',
  'corrective_repair',
  'calendar_exclusion'
]);
const MAINTENANCE_EVENT_STATUSES = new Set(['planned', 'in_progress', 'completed', 'cancelled']);

function normalizeMaintenanceEventType(value) {
  const eventType = String(value || '').trim().toLowerCase();
  if (!MAINTENANCE_EVENT_TYPES.has(eventType)) throw new Error('Jenis maintenance tidak valid.');
  return eventType;
}

function normalizeMaintenanceEventStatus(value) {
  const status = String(value || 'planned').trim().toLowerCase();
  if (!MAINTENANCE_EVENT_STATUSES.has(status)) throw new Error('Status maintenance tidak valid.');
  return status;
}

function maintenanceDurationHours(startValue, finishValue) {
  if (!startValue || !finishValue) return 0;
  const start = normalizeBreakdownTimestamp(startValue, 'Waktu mulai aktual');
  const finish = normalizeBreakdownTimestamp(finishValue, 'Waktu selesai aktual');
  if (finish < start) throw new Error('Waktu selesai aktual tidak boleh lebih awal dari waktu mulai.');
  return (finish.getTime() - start.getTime()) / 3600000;
}

function calculateUnitPerformanceMetrics(input = {}) {
  const calendarHours = Math.max(0, Number(input.calendarHours) || 0);
  const excludedHours = Math.min(calendarHours, Math.max(0, Number(input.excludedHours) || 0));
  const scheduledHours = Math.max(0, calendarHours - excludedHours);
  const breakdownDowntime = Math.max(0, Number(input.breakdownDowntime) || 0);
  const scheduledServiceDowntime = Math.max(0, Number(input.scheduledServiceDowntime) || 0);
  const inspectionDowntime = Math.max(0, Number(input.inspectionDowntime) || 0);
  const correctiveRepairDowntime = Math.max(0, Number(input.correctiveRepairDowntime) || 0);
  const maintenanceDowntimeRaw = breakdownDowntime + scheduledServiceDowntime + inspectionDowntime + correctiveRepairDowntime;
  const physicalDowntime = Math.min(calendarHours, maintenanceDowntimeRaw);
  const scheduledMaintenanceDowntime = Math.min(scheduledHours, maintenanceDowntimeRaw);
  const actualHm = Math.max(0, Number(input.actualHm) || 0);
  const functionalFailures = Math.max(0, Number(input.functionalFailures) || 0);
  const correctiveRepairs = Math.max(0, Number(input.correctiveRepairs) || 0);
  const repairHours = Array.isArray(input.repairHours)
    ? input.repairHours.map(Number).filter(value => Number.isFinite(value) && value >= 0)
    : [];
  const totalRepairHours = repairHours.reduce((sum, value) => sum + value, 0);
  const completedRepairCount = repairHours.length;
  return {
    calendarHours,
    excludedHours,
    scheduledHours,
    physicalDowntime,
    maintenanceDowntime: scheduledMaintenanceDowntime,
    availableHours: Math.max(0, calendarHours - physicalDowntime),
    pa: calendarHours > 0 ? ((calendarHours - physicalDowntime) / calendarHours) * 100 : null,
    ma: scheduledHours > 0 ? ((scheduledHours - scheduledMaintenanceDowntime) / scheduledHours) * 100 : null,
    actualHm,
    functionalFailures,
    correctiveRepairs,
    mtbfHours: functionalFailures > 0 && actualHm > 0 ? actualHm / functionalFailures : null,
    mtbrHours: correctiveRepairs > 0 && actualHm > 0 ? actualHm / correctiveRepairs : null,
    totalRepairHours,
    completedRepairCount,
    mttrHours: completedRepairCount ? totalRepairHours / completedRepairCount : null,
    downtime: {
      breakdown: breakdownDowntime,
      scheduledService: scheduledServiceDowntime,
      inspection: inspectionDowntime,
      correctiveRepair: correctiveRepairDowntime
    }
  };
}

// Form inline mengirim nilai form sebagai string. "false" harus tetap false;
// Boolean("false") bernilai true di JavaScript dan dapat memicu validasi reset
// secara keliru.
function parseBooleanInput(value) {
  return value === true || value === 1 || String(value || '').trim().toLowerCase() === 'true';
}

// DATE adalah kalender operasional, bukan timestamp. Pertahankan string
// YYYY-MM-DD agar tidak bergeser saat melewati zona waktu browser/server.
function normalizeDateOnly(value, label = 'Tanggal') {
  const date = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label} harus berformat YYYY-MM-DD.`);
  const [year, month, day] = date.split('-').map(Number);
  const valid = month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!valid) throw new Error(`${label} tidak valid.`);
  return date;
}

function isFuelDistanceEquipment(equipment) {
  const value = `${equipment?.kelas_alat || ''} ${equipment?.class_unit || ''} ${equipment?.tipe_alat || ''}`.toLowerCase();
  return /dump\s*truck|haul\s*truck|light\s*vehicle|\blv\b|bus|water\s*truck|fuel\s*truck|service\s*truck/.test(value);
}

function fuelShiftOrderSql(alias = 's') {
  return `CASE WHEN LOWER(${alias}.nama_shift) LIKE '%siang%' THEN 1 WHEN LOWER(${alias}.nama_shift) LIKE '%malam%' THEN 2 ELSE 3 END`;
}

async function resolveExistingUserId(db, requestedId) {
  if (!requestedId) return null;
  const result = await db.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [requestedId]);
  return result.rows[0]?.id || null;
}

async function writeStandbyAudit(db, standbyLogId, action, beforeData, afterData, actorId) {
  await db.query(`
    INSERT INTO standby_log_audit (standby_log_id, action, before_data, after_data, changed_by)
    VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)
  `, [standbyLogId, action, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null, actorId || null]);
}

function standbyMohhKey(date, shiftId, equipmentId) {
  return `${String(date).slice(0, 10)}::${String(shiftId)}::${String(equipmentId)}`;
}

async function buildStandbyMohhControls(db, { fromDate, toDate, slices, shiftIds }) {
  const fromBounds = operationalDayBounds(fromDate);
  const toBounds = operationalDayBounds(toDate);
  const rangeFinish = operationalDayBounds(addOperationalDays(toDate, 1)).start;
  const [equipmentResult, hmResult, breakdownResult, closureResult] = await Promise.all([
    db.query(`SELECT id,kode_alat,kelas_alat,class_unit,tipe_alat FROM equipment WHERE deleted_at IS NULL`),
    db.query(`
      SELECT to_char(tanggal,'YYYY-MM-DD') AS operational_date,shift_id,equipment_id,
             COALESCE(MAX(total_hm),0)::float AS hm_hours,COUNT(*)::int AS hm_records
      FROM mining_production_logs
      WHERE deleted_at IS NULL AND tanggal BETWEEN $1::date AND $2::date
      GROUP BY tanggal,shift_id,equipment_id
    `, [fromDate, toDate]),
    db.query(`
      SELECT bl.id AS breakdown_id,bl.equipment_id,h.started_at,COALESCE(h.ended_at,now()) AS ended_at
      FROM breakdown_status_history h
      JOIN breakdown_logs bl ON bl.id=h.breakdown_id
      WHERE bl.deleted_at IS NULL AND h.counts_as_breakdown=TRUE
        AND h.started_at<$2::timestamptz AND COALESCE(h.ended_at,now())>$1::timestamptz
    `, [fromBounds.start.toISOString(), rangeFinish.toISOString()]),
    db.query(`
      SELECT c.*,closer.nama AS closed_by_name,reopener.nama AS reopened_by_name
      FROM standby_shift_closures c
      LEFT JOIN users closer ON closer.id=c.closed_by
      LEFT JOIN users reopener ON reopener.id=c.reopened_by
      WHERE c.operational_date BETWEEN $1::date AND $2::date
    `, [fromDate, toDate])
  ]);
  const equipmentMap = new Map(equipmentResult.rows.map(row => [String(row.id), row]));
  const controls = new Map();
  const ensure = (date, shiftId, equipmentId, shiftName = '') => {
    if (!date || !shiftId || !equipmentId) return null;
    const key = standbyMohhKey(date, shiftId, equipmentId);
    if (!controls.has(key)) {
      const equipment = equipmentMap.get(String(equipmentId)) || {};
      controls.set(key, {
        key, operational_date: String(date).slice(0, 10), shift_id: String(shiftId),
        shift_name: shiftName || (String(shiftId) === String(shiftIds.siang) ? 'Shift Siang' : (String(shiftId) === String(shiftIds.malam) ? 'Shift Malam' : 'Shift')),
        equipment_id: String(equipmentId), kode_alat: equipment.kode_alat || 'Unit', kelas_alat: equipment.kelas_alat || 'Tanpa Jenis',
        class_unit: equipment.class_unit || null, tipe_alat: equipment.tipe_alat || null,
        hmHours: 0, hmRecords: 0, breakdownHours: 0, standbyHours: 0,
        pendingIds: new Set(), returnedIds: new Set(), standbyIntervals: [], breakdownIntervals: [], closure: null
      });
    }
    const control = controls.get(key);
    if (!control.shift_name) control.shift_name = shiftName;
    return control;
  };

  hmResult.rows.forEach(row => {
    const control = ensure(row.operational_date, row.shift_id, row.equipment_id);
    if (!control) return;
    control.hmHours = Math.max(control.hmHours, Number(row.hm_hours || 0));
    control.hmRecords += Number(row.hm_records || 0);
  });

  for (const segment of breakdownResult.rows) {
    for (let date = fromDate; date <= toDate; date = addOperationalDays(date, 1)) {
      const bounds = operationalDayBounds(date);
      const windows = [
        { id: shiftIds.siang, name: 'Shift Siang', start: bounds.start, finish: bounds.dayEnd },
        { id: shiftIds.malam, name: 'Shift Malam', start: bounds.dayEnd, finish: bounds.end }
      ];
      windows.forEach(window => {
        const hours = intervalOverlapHours(segment.started_at, segment.ended_at, window.start, window.finish);
        if (hours <= 0 || !window.id) return;
        const control = ensure(date, window.id, segment.equipment_id, window.name);
        control.breakdownHours += hours;
        control.breakdownIntervals.push({ id: segment.breakdown_id, start: segment.started_at, finish: segment.ended_at });
      });
    }
  }

  (slices || []).forEach(slice => {
    const hours = Math.max(0, Number(slice.counted_hours || 0));
    const control = ensure(slice.operational_date, slice.shift_id, slice.equipment_id, slice.shift_name);
    if (!control) return;
    control.standbyHours += hours;
    if (hours > 0) control.standbyIntervals.push({ id: slice.standby_log_id, start: slice.slice_start, finish: slice.slice_finish });
    if (slice.review_status === 'pending') control.pendingIds.add(String(slice.standby_log_id));
    if (slice.review_status === 'returned') control.returnedIds.add(String(slice.standby_log_id));
  });

  closureResult.rows.forEach(closure => {
    const control = ensure(closure.operational_date, closure.shift_id, closure.equipment_id);
    if (control) control.closure = closure;
  });

  return [...controls.values()].map(control => {
    let overlapHours = 0;
    control.standbyIntervals.forEach(standby => control.breakdownIntervals.forEach(breakdown => {
      overlapHours += intervalOverlapHours(standby.start, standby.finish, breakdown.start, breakdown.finish);
    }));
    let standbyOverlapHours = 0;
    for (let left = 0; left < control.standbyIntervals.length; left += 1) {
      for (let right = left + 1; right < control.standbyIntervals.length; right += 1) {
        if (control.standbyIntervals[left].id === control.standbyIntervals[right].id) continue;
        standbyOverlapHours += intervalOverlapHours(
          control.standbyIntervals[left].start, control.standbyIntervals[left].finish,
          control.standbyIntervals[right].start, control.standbyIntervals[right].finish
        );
      }
    }
    const metrics = calculateStandbyMohhControl({
      hmHours: control.hmHours, hmRecords: control.hmRecords,
      breakdownHours: control.breakdownHours, standbyHours: control.standbyHours,
      pendingReview: control.pendingIds.size, returnedReview: control.returnedIds.size,
      overlapHours, standbyOverlapHours, closure: control.closure
    });
    const { pendingIds, returnedIds, standbyIntervals, breakdownIntervals, ...identity } = control;
    return { ...identity, ...metrics };
  }).sort((left, right) => `${right.operational_date}|${right.shift_name}|${right.kode_alat}`.localeCompare(`${left.operational_date}|${left.shift_name}|${left.kode_alat}`, 'id-ID', { numeric: true }));
}

async function assertStandbyShiftNotClosed(db, operationalDate, shiftId, equipmentIds) {
  const ids = [...new Set((Array.isArray(equipmentIds) ? equipmentIds : [equipmentIds]).map(String).filter(Boolean))];
  if (!ids.length) return true;
  const result = await db.query(`
    SELECT c.equipment_id,e.kode_alat FROM standby_shift_closures c
    LEFT JOIN equipment e ON e.id=c.equipment_id
    WHERE c.operational_date=$1::date AND c.shift_id=$2 AND c.equipment_id=ANY($3::uuid[]) AND c.status='closed'
  `, [operationalDate, shiftId, ids]);
  if (result.rows.length) {
    const names = result.rows.slice(0, 8).map(row => row.kode_alat || row.equipment_id).join(', ');
    const frozen = new Error(`Shift Standby sudah ditutup/freeze untuk ${names}. Buka kembali shift sebelum mengubah data.`);
    frozen.statusCode = 409;
    throw frozen;
  }
  return true;
}

async function loadStandbyMohhControl(db, operationalDate, shiftId, equipmentId) {
  const date = normalizeDateOnly(operationalDate, 'Tanggal operasional');
  const bounds = operationalDayBounds(date);
  const shifts = await db.query(`SELECT id,nama_shift FROM shifts WHERE LOWER(nama_shift) LIKE '%siang%' OR LOWER(nama_shift) LIKE '%malam%'`);
  const shiftIds = {};
  shifts.rows.forEach(shift => {
    if (/siang/i.test(shift.nama_shift)) shiftIds.siang = shift.id;
    if (/malam/i.test(shift.nama_shift)) shiftIds.malam = shift.id;
  });
  const standbyResult = await db.query(`
    SELECT sl.*,e.kode_alat,e.kelas_alat,e.class_unit,e.tipe_alat,msc.kode AS kode_standby,msc.kategori AS kategori_standby
    FROM standby_logs sl JOIN equipment e ON e.id=sl.equipment_id JOIN master_standby_codes msc ON msc.id=sl.standby_code_id
    WHERE sl.deleted_at IS NULL AND sl.equipment_id=$1
      AND sl.start_time<$3::timestamptz AND COALESCE(sl.finish_time,now())>$2::timestamptz
  `, [equipmentId, bounds.start.toISOString(), bounds.end.toISOString()]);
  const slices = standbyResult.rows.flatMap(row => splitStandbyIntoOperationalSlices(row, date, date, shiftIds));
  const controls = await buildStandbyMohhControls(db, { fromDate: date, toDate: date, slices, shiftIds });
  return controls.find(control => String(control.shift_id) === String(shiftId) && String(control.equipment_id) === String(equipmentId)) || null;
}

async function resolveOperationalShift(db, instant) {
  const kind = operationalShiftKindForInstant(instant);
  const result = await db.query(`
    SELECT id, nama_shift, operational_start, operational_end FROM shifts
    WHERE LOWER(nama_shift) LIKE $1
    ORDER BY created_at LIMIT 1
  `, [`%${kind}%`]);
  if (!result.rows.length) throw new Error(`Master Shift ${kind === 'siang' ? 'Siang' : 'Malam'} tidak ditemukan.`);
  return result.rows[0];
}

async function getSystemVerificationStandbyCode(db) {
  const result = await db.query(`
    SELECT * FROM master_standby_codes
    WHERE kode=$1 AND deleted_at IS NULL AND is_system=TRUE AND is_locked=TRUE
    LIMIT 1
  `, [SYSTEM_VERIFICATION_STANDBY_CODE]);
  if (!result.rows.length) throw new Error('Kode sistem STB-SYS-01 belum tersedia. Jalankan migration Standby Verification Workflow.');
  return result.rows[0];
}

async function createVerificationStandby(db, incident, releaseAt, actorId, attempt) {
  const code = await getSystemVerificationStandbyCode(db);
  const shift = await resolveOperationalShift(db, releaseAt);
  const operationalDate = operationalDateForInstant(releaseAt);
  const result = await db.query(`
    INSERT INTO standby_logs (
      tanggal, shift_id, equipment_id, standby_code_id, description,
      start_time, finish_time, total_standby_hours, created_by,
      source_type, source_reference_id, source_sequence, lifecycle_status,
      is_system_generated, review_status, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,NULL,0,$7,'breakdown_verification',$8,$9,'open',TRUE,'pending',$7)
    ON CONFLICT (source_type, source_reference_id, source_sequence)
      WHERE source_reference_id IS NOT NULL AND is_system_generated=TRUE
    DO UPDATE SET deleted_at=NULL, lifecycle_status='open', finish_time=NULL,
                  total_standby_hours=0, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
    RETURNING *
  `, [operationalDate, shift.id, incident.equipment_id, code.id,
    `Menunggu verifikasi Produksi untuk breakdown ${incident.id}, release ke-${attempt}.`,
    releaseAt.toISOString(), actorId, incident.id, attempt]);
  await writeStandbyAudit(db, result.rows[0].id, 'system_open', null, result.rows[0], actorId);
  return result.rows[0];
}

async function closeVerificationStandby(db, incidentId, attempt, finishAt, lifecycleStatus, reason, actorId) {
  if (!STANDBY_LIFECYCLE_STATUSES.has(lifecycleStatus) || lifecycleStatus === 'open') {
    throw new Error('Status penutupan standby verifikasi tidak valid.');
  }
  const before = await db.query(`
    SELECT * FROM standby_logs
    WHERE source_type='breakdown_verification' AND source_reference_id=$1
      AND source_sequence=$2 AND deleted_at IS NULL
    FOR UPDATE
  `, [incidentId, attempt]);
  if (!before.rows.length) throw new Error('Standby verifikasi aktif tidak ditemukan. Jalankan migration terbaru.');
  const current = before.rows[0];
  if (finishAt < new Date(current.start_time)) throw new Error('Waktu verifikasi tidak boleh mendahului waktu release Maintenance.');
  const rawHours = calculateIntervalHours(current.start_time, finishAt);
  const result = await db.query(`
    UPDATE standby_logs SET
      finish_time=$3::timestamptz,
      total_standby_hours=$4,
      lifecycle_status=$5::varchar,
      reclassified_at=CASE WHEN $5::text='reclassified' THEN $3::timestamptz ELSE NULL END,
      reclassified_reason=CASE WHEN $5::text='reclassified' THEN $6::text ELSE NULL END,
      updated_by=$7,
      updated_at=CURRENT_TIMESTAMP
    WHERE source_type='breakdown_verification' AND source_reference_id=$1
      AND source_sequence=$2 AND deleted_at IS NULL
    RETURNING *
  `, [incidentId, attempt, finishAt.toISOString(), rawHours, lifecycleStatus, reason || null, actorId]);
  await writeStandbyAudit(db, result.rows[0].id,
    lifecycleStatus === 'reclassified' ? 'reclassify_to_breakdown' : 'system_close',
    current, result.rows[0], actorId);
  return result.rows[0];
}

async function calculateStoredBreakdownHours(db, breakdownId, throughAt = new Date()) {
  const result = await db.query(`
    SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at,$2) - started_at)) / 3600)),0)::float AS hours
    FROM breakdown_status_history
    WHERE breakdown_id=$1 AND counts_as_breakdown=TRUE
  `, [breakdownId, throughAt.toISOString()]);
  return Number(result.rows[0]?.hours || 0);
}

async function assertNoStandbyOverlap(db, equipmentId, startAt, finishAt, excludeId = null) {
  const result = await db.query(`
    SELECT id FROM standby_logs
    WHERE equipment_id=$1 AND deleted_at IS NULL
      AND lifecycle_status IN ('open','confirmed')
      AND ($4::uuid IS NULL OR id<>$4)
      AND start_time < $3
      AND COALESCE(finish_time, 'infinity'::timestamptz) > $2
    LIMIT 1
  `, [equipmentId, startAt.toISOString(), finishAt.toISOString(), excludeId]);
  if (result.rows.length) {
    const conflict = new Error('Waktu standby bertumpang tindih dengan record aktif unit yang sama.');
    conflict.statusCode = 409;
    throw conflict;
  }
}

function assertStandbySessionIntervals(records) {
  const grouped = new Map();
  for (const record of records || []) {
    const start = record.start instanceof Date ? record.start : new Date(record.start);
    const finish = record.finish instanceof Date ? record.finish : new Date(record.finish);
    if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime()) || finish <= start) {
      throw new Error('Jam selesai harus lebih akhir dari jam mulai.');
    }
    const key = String(record.equipmentId || record.equipment_id || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ ...record, start, finish });
  }
  for (const rows of grouped.values()) {
    rows.sort((left, right) => left.start - right.start);
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index].start < rows[index - 1].finish) {
        const conflict = new Error('Perubahan sesi menghasilkan waktu standby yang bertumpang tindih pada unit yang sama.');
        conflict.statusCode = 409;
        throw conflict;
      }
    }
  }
}

function assertStandbyLogDeletable(row) {
  if (row?.is_system_generated || row?.code_is_system || row?.code_is_locked) {
    const forbidden = new Error('Record Standby sistem tidak dapat dihapus manual.');
    forbidden.statusCode = 403;
    throw forbidden;
  }
  if (row?.lifecycle_status !== 'confirmed') {
    throw new Error('Hanya Standby berstatus Tercatat yang dapat dihapus.');
  }
  if (row?.review_status === 'approved') {
    throw new Error('Standby yang telah disetujui harus dikembalikan melalui Review sebelum dihapus.');
  }
  return true;
}

async function assertNoStandbyOverlapOutsideSession(db, equipmentId, startAt, finishAt, excludedIds) {
  const result = await db.query(`
    SELECT id FROM standby_logs
    WHERE equipment_id=$1 AND deleted_at IS NULL
      AND lifecycle_status IN ('open','confirmed')
      AND NOT (id=ANY($4::uuid[]))
      AND start_time < $3
      AND COALESCE(finish_time, 'infinity'::timestamptz) > $2
    LIMIT 1
  `, [equipmentId, startAt.toISOString(), finishAt.toISOString(), excludedIds]);
  if (result.rows.length) {
    const conflict = new Error('Waktu standby bertumpang tindih dengan record lain pada unit yang sama.');
    conflict.statusCode = 409;
    throw conflict;
  }
}

async function getFuelReadingContext(db, input) {
  const shiftOrder = fuelShiftOrderSql('s');
  const [equipmentResult, duplicateResult, previousResult, nextResult] = await Promise.all([
    db.query(`SELECT id, kode_alat, kelas_alat, class_unit, tipe_alat, fuel_rate_lph::float AS fuel_rate_lph
              FROM equipment WHERE id=$1 AND deleted_at IS NULL LIMIT 1`, [input.equipmentId]),
    db.query(`SELECT COUNT(*)::int AS total FROM fuel_logs
              WHERE equipment_id=$1 AND tanggal=$2 AND shift_id=$3 AND deleted_at IS NULL
                AND ($4::uuid IS NULL OR id<>$4)`, [input.equipmentId, input.tanggal, input.shiftId, input.logId || null]),
    db.query(`SELECT fl.id, fl.tanggal, COALESCE(fl.hm_reading, fl.hm_finish)::float AS hm_reading,
                     fl.odometer_reading::float AS odometer_reading, s.nama_shift
              FROM fuel_logs fl JOIN shifts s ON s.id=fl.shift_id
              WHERE fl.equipment_id=$1 AND fl.deleted_at IS NULL
                AND ($3::uuid IS NULL OR fl.id<>$3)
                AND (fl.tanggal<$2 OR (fl.tanggal=$2 AND ${shiftOrder}<$4))
              ORDER BY fl.tanggal DESC, ${shiftOrder} DESC, fl.created_at DESC LIMIT 1`,
      [input.equipmentId, input.tanggal, input.logId || null, input.shiftOrder]),
    db.query(`SELECT fl.id, fl.tanggal, COALESCE(fl.hm_reading, fl.hm_finish)::float AS hm_reading,
                     fl.odometer_reading::float AS odometer_reading, s.nama_shift
              FROM fuel_logs fl JOIN shifts s ON s.id=fl.shift_id
              WHERE fl.equipment_id=$1 AND fl.deleted_at IS NULL
                AND ($3::uuid IS NULL OR fl.id<>$3)
                AND (fl.tanggal>$2 OR (fl.tanggal=$2 AND ${shiftOrder}>$4))
              ORDER BY fl.tanggal ASC, ${shiftOrder} ASC, fl.created_at ASC LIMIT 1`,
      [input.equipmentId, input.tanggal, input.logId || null, input.shiftOrder]),
  ]);
  return {
    equipment: equipmentResult.rows[0] || null,
    duplicateCount: Number(duplicateResult.rows[0]?.total || 0),
    previous: previousResult.rows[0] || null,
    next: nextResult.rows[0] || null,
  };
}

function calculateFuelReadingMetrics(input, context) {
  const issues = [];
  const warnings = [];
  const previousHm = nullableFiniteNumber(context.previous?.hm_reading);
  const previousKm = nullableFiniteNumber(context.previous?.odometer_reading);
  const nextHm = nullableFiniteNumber(context.next?.hm_reading);
  const nextKm = nullableFiniteNumber(context.next?.odometer_reading);
  const hasPreviousHm = previousHm !== null;
  const hasPreviousKm = previousKm !== null;
  const hasNextHm = nextHm !== null;
  const hasNextKm = nextKm !== null;
  let hmDelta = hasPreviousHm ? input.hmReading - previousHm : null;
  let distanceKm = input.odometerReading !== null && hasPreviousKm ? input.odometerReading - previousKm : null;

  if (context.duplicateCount > 0) issues.push({ code: 'DUPLICATE_UNIT_SHIFT', message: 'Unit sudah memiliki pengisian pada tanggal dan shift yang sama.' });
  if (input.isMeterReset) {
    if (String(input.meterResetReason || '').trim().length < 5) issues.push({ code: 'RESET_REASON_REQUIRED', message: 'Alasan reset/penggantian meter minimal 5 karakter.' });
    hmDelta = null;
    distanceKm = null;
    warnings.push({ code: 'METER_RESET', message: 'Rasio periode ini tidak dihitung karena reset/penggantian meter.' });
  } else {
    if (hmDelta !== null && hmDelta <= 0) issues.push({ code: 'HM_NOT_INCREASING', message: `HM harus lebih besar dari pembacaan sebelumnya (${previousHm.toFixed(2)}).` });
    if (distanceKm !== null && distanceKm <= 0) issues.push({ code: 'KM_NOT_INCREASING', message: `KM harus lebih besar dari pembacaan sebelumnya (${previousKm.toFixed(2)}).` });
    if (hasNextHm && input.hmReading >= nextHm) issues.push({ code: 'HM_OVERLAPS_NEXT', message: `HM harus lebih kecil dari pembacaan berikutnya (${nextHm.toFixed(2)}).` });
    if (input.odometerReading !== null && hasNextKm && input.odometerReading >= nextKm) issues.push({ code: 'KM_OVERLAPS_NEXT', message: `KM harus lebih kecil dari pembacaan berikutnya (${nextKm.toFixed(2)}).` });
  }

  const fuelPerHm = hmDelta > 0 ? input.fuelFilled / hmDelta : null;
  const fuelPerKm = distanceKm > 0 ? input.fuelFilled / distanceKm : null;
  const standardRate = Number(context.equipment?.fuel_rate_lph);
  const targetFuel = hmDelta > 0 && Number.isFinite(standardRate) ? standardRate * hmDelta : null;
  const variance = targetFuel !== null ? input.fuelFilled - targetFuel : null;
  const variancePct = targetFuel > 0 ? (variance / targetFuel) * 100 : null;
  if (variancePct !== null && variancePct > 20) warnings.push({ code: 'HIGH_FUEL_VARIANCE', message: `Fuel ${variancePct.toFixed(1)}% di atas target Standard Fuel Rate.` });
  if (!hasPreviousHm) warnings.push({ code: 'HM_BASELINE_MISSING', message: 'Belum ada baseline HM sebelumnya; Ltr/Jam belum dapat dihitung.' });
  if (isFuelDistanceEquipment(context.equipment) && input.odometerReading === null) warnings.push({ code: 'KM_REQUIRED_FOR_MOBILE', message: 'Unit mobile belum memiliki pembacaan KM.' });
  if (input.odometerReading !== null && !hasPreviousKm) warnings.push({ code: 'KM_BASELINE_MISSING', message: 'Belum ada baseline KM sebelumnya; Ltr/Km belum dapat dihitung.' });

  return {
    hmDelta: hmDelta > 0 ? hmDelta : null,
    distanceKm: distanceKm > 0 ? distanceKm : null,
    fuelPerHm,
    fuelPerKm,
    targetFuel,
    variance,
    variancePct,
    issues,
    warnings,
    anomalyStatus: issues.length ? 'critical' : warnings.length ? 'warning' : 'normal',
  };
}

async function writeFuelAudit(db, fuelLogId, action, beforeData, afterData, actorId) {
  await db.query(`INSERT INTO fuel_log_audit (fuel_log_id, action, before_data, after_data, changed_by)
                  VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)`, [fuelLogId, action, JSON.stringify(beforeData || null), JSON.stringify(afterData || null), actorId || null]);
}

function medianHm(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return 0;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function hmShiftOrder(name) {
  const value = String(name || '').toLowerCase();
  if (value.includes('siang')) return 1;
  if (value.includes('malam')) return 2;
  return 1;
}

async function analyzeHmHybrid(db, input) {
  const tolerance = 0.10;
  const hmStart = Number(input.hmStart);
  const hmFinish = Number(input.hmFinish);
  const totalHm = calculateHmTotal(hmStart, hmFinish);
  const logId = input.logId || null;
  const hardIssues = [];
  const criticalIssues = [];
  const warnings = [];

  const context = await db.query(`
    SELECT e.kode_alat, s.nama_shift
    FROM equipment e CROSS JOIN shifts s
    WHERE e.id = $1 AND s.id = $2 LIMIT 1
  `, [input.equipmentId, input.shiftId]);
  const unitCode = context.rows[0]?.kode_alat || 'Unit';
  const shiftOrder = hmShiftOrder(context.rows[0]?.nama_shift);

  const duplicate = await db.query(`
    SELECT COUNT(*)::int AS total FROM mining_production_logs
    WHERE equipment_id = $1 AND tanggal = $2 AND shift_id = $3
      AND deleted_at IS NULL AND ($4::uuid IS NULL OR id <> $4)
  `, [input.equipmentId, input.tanggal, input.shiftId, logId]);
  if (duplicate.rows[0]?.total > 0) {
    hardIssues.push({ code: 'DUPLICATE_UNIT_SHIFT', message: `${unitCode} sudah memiliki Work Log pada hari dan shift yang sama.` });
  }

  const daily = await db.query(`
    SELECT COALESCE(SUM(total_hm), 0)::float AS total FROM mining_production_logs
    WHERE equipment_id = $1 AND tanggal = $2 AND deleted_at IS NULL
      AND ($3::uuid IS NULL OR id <> $3)
  `, [input.equipmentId, input.tanggal, logId]);
  const dailyTotal = Number(daily.rows[0]?.total || 0) + totalHm;
  if (dailyTotal > 24.01) {
    hardIssues.push({ code: 'DAILY_OVER_24', message: `Total HM harian ${unitCode} menjadi ${dailyTotal.toFixed(2)} jam dan melebihi Calendar Hours 24 jam.` });
  }

  const shiftOrderSql = `CASE WHEN LOWER(s.nama_shift) LIKE '%siang%' THEN 1 WHEN LOWER(s.nama_shift) LIKE '%malam%' THEN 2 ELSE 1 END`;
  const previous = await db.query(`
    SELECT mpl.tanggal, mpl.hm_finish::float AS hm_finish, s.nama_shift
    FROM mining_production_logs mpl JOIN shifts s ON s.id = mpl.shift_id
    WHERE mpl.equipment_id = $1 AND mpl.deleted_at IS NULL
      AND ($3::uuid IS NULL OR mpl.id <> $3)
      AND (mpl.tanggal < $2 OR (mpl.tanggal = $2 AND ${shiftOrderSql} < $4))
    ORDER BY mpl.tanggal DESC, ${shiftOrderSql} DESC, mpl.created_at DESC LIMIT 1
  `, [input.equipmentId, input.tanggal, logId, shiftOrder]);
  const next = await db.query(`
    SELECT mpl.tanggal, mpl.hm_start::float AS hm_start, s.nama_shift
    FROM mining_production_logs mpl JOIN shifts s ON s.id = mpl.shift_id
    WHERE mpl.equipment_id = $1 AND mpl.deleted_at IS NULL
      AND ($3::uuid IS NULL OR mpl.id <> $3)
      AND (mpl.tanggal > $2 OR (mpl.tanggal = $2 AND ${shiftOrderSql} > $4))
    ORDER BY mpl.tanggal ASC, ${shiftOrderSql} ASC, mpl.created_at ASC LIMIT 1
  `, [input.equipmentId, input.tanggal, logId, shiftOrder]);

  const previousRow = previous.rows[0] || null;
  const nextRow = next.rows[0] || null;
  if (previousRow) {
    const gap = Number((hmStart - Number(previousRow.hm_finish)).toFixed(2));
    const detail = { code: gap < 0 ? 'HM_ROLLBACK' : 'HM_CONTINUITY_GAP', previousFinish: previousRow.hm_finish, currentStart: hmStart, gap, previousDate: previousRow.tanggal, previousShift: previousRow.nama_shift };
    if (gap < -tolerance) {
      criticalIssues.push({ ...detail, message: `HM Start ${hmStart.toFixed(2)} lebih rendah dari HM Finish terakhir ${Number(previousRow.hm_finish).toFixed(2)} (${previousRow.nama_shift}). Selisih ${gap.toFixed(2)} HM.` });
    } else if (Math.abs(gap) > tolerance) {
      warnings.push({ ...detail, message: `Ada jeda ${gap.toFixed(2)} HM dari HM Finish terakhir ${Number(previousRow.hm_finish).toFixed(2)} ke HM Start saat ini ${hmStart.toFixed(2)}.` });
    }
  }
  if (nextRow) {
    const overlap = Number((hmFinish - Number(nextRow.hm_start)).toFixed(2));
    if (overlap > tolerance) {
      criticalIssues.push({ code: 'HM_OVERLAPS_NEXT', nextStart: nextRow.hm_start, currentFinish: hmFinish, overlap, nextDate: nextRow.tanggal, nextShift: nextRow.nama_shift, message: `HM Akhir ${hmFinish.toFixed(2)} melewati HM Start log berikutnya ${Number(nextRow.hm_start).toFixed(2)} (${nextRow.nama_shift}) sebesar ${overlap.toFixed(2)} HM.` });
    }
  }
  if (totalHm > 12) {
    warnings.push({ code: 'SHIFT_OVER_12', totalHm, message: `HM Total ${totalHm.toFixed(2)} jam melebihi acuan 12 jam per shift.` });
  }

  const history = await db.query(`
    SELECT total_hm::float AS total_hm FROM mining_production_logs
    WHERE equipment_id = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id <> $2)
    ORDER BY tanggal DESC, created_at DESC LIMIT 14
  `, [input.equipmentId, logId]);
  const historicalTotals = history.rows.map(row => Number(row.total_hm)).filter(Number.isFinite);
  if (historicalTotals.length >= 5) {
    const historicalMedian = medianHm(historicalTotals);
    const mad = medianHm(historicalTotals.map(value => Math.abs(value - historicalMedian)));
    const threshold = Math.max(2, 3 * 1.4826 * mad);
    const deviation = Math.abs(totalHm - historicalMedian);
    if (deviation > threshold) {
      warnings.push({ code: 'HISTORICAL_OUTLIER', median: historicalMedian, mad, totalHm, deviation, message: `HM Total ${totalHm.toFixed(2)} berbeda jauh dari median 14 log terakhir ${historicalMedian.toFixed(2)} jam.` });
    }
  }

  const status = hardIssues.length ? 'blocked' : criticalIssues.length ? 'critical' : warnings.length ? 'warning' : 'normal';
  return { status, tolerance, totalHm, dailyTotal, unitCode, previous: previousRow, next: nextRow, hardIssues, criticalIssues, warnings };
}

class ProductionController {

  static async ensureProductivityPlanStorage() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS productivity_plans (
        planning_type VARCHAR(20) PRIMARY KEY,
        content_html TEXT NOT NULL,
        data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE productivity_plans ADD COLUMN IF NOT EXISTS data_json JSONB NOT NULL DEFAULT '{}'::jsonb`);
  }

  static async getProductivityPlan(req, res) {
    try {
      const planningType = String(req.params.planningType || '').toLowerCase();
      if (!['ob', 'coal', 'spo', 'pa-ua-ewh', 'fleet-capacity', 'unit-mapping'].includes(planningType)) return res.status(400).json({ error: 'Jenis planning tidak valid.' });
      await ProductionController.ensureProductivityPlanStorage();
      const result = await pool.query('SELECT content_html, data_json, updated_at FROM productivity_plans WHERE planning_type = $1', [planningType]);
      res.json({ contentHtml: result.rows[0]?.content_html || null, planningData: result.rows[0]?.data_json || null, updatedAt: result.rows[0]?.updated_at || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }

  static async saveProductivityPlan(req, res) {
    try {
      const planningType = String(req.params.planningType || '').toLowerCase();
      const contentHtml = String(req.body?.contentHtml || '');
      const planningData = req.body?.planningData && typeof req.body.planningData === 'object' ? req.body.planningData : {};
      if (!['ob', 'coal', 'spo', 'pa-ua-ewh', 'fleet-capacity', 'unit-mapping'].includes(planningType) || !contentHtml) return res.status(400).json({ error: 'Data planning tidak valid.' });
      await ProductionController.ensureProductivityPlanStorage();
      const result = await pool.query(`
        INSERT INTO productivity_plans (planning_type, content_html, data_json, updated_at) VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (planning_type) DO UPDATE SET content_html = EXCLUDED.content_html, data_json = EXCLUDED.data_json, updated_at = CURRENT_TIMESTAMP
        RETURNING updated_at`, [planningType, contentHtml, JSON.stringify(planningData)]);
      res.json({ success: true, updatedAt: result.rows[0].updated_at });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }

  // =========================================================
  // MASTER DATA LOOKUP & PARAMETER CRUD
  // =========================================================
  static async getMasterData(req, res) {
    try {
      const pits = await pool.query("SELECT * FROM production_pits WHERE deleted_at IS NULL ORDER BY nama_pit");
      const loadingPoints = await pool.query("SELECT lp.*, p.nama_pit FROM loading_points lp LEFT JOIN production_pits p ON lp.pit_id = p.id WHERE lp.deleted_at IS NULL ORDER BY lp.nama_loading_point");
      const disposals = await pool.query("SELECT d.*, p.nama_pit FROM disposals d LEFT JOIN production_pits p ON d.pit_id = p.id WHERE d.deleted_at IS NULL ORDER BY d.nama_disposal");
      const equipment = await pool.query("SELECT * FROM equipment WHERE deleted_at IS NULL ORDER BY kelas_alat, kode_alat");
      const standbyCodes = await pool.query("SELECT * FROM master_standby_codes WHERE deleted_at IS NULL ORDER BY kode");
      const breakdownCodes = await pool.query("SELECT * FROM master_breakdown_codes WHERE deleted_at IS NULL ORDER BY kode");
      const shifts = await pool.query("SELECT * FROM shifts ORDER BY nama_shift");
      const jobCodes = await pool.query("SELECT * FROM master_job_codes WHERE deleted_at IS NULL ORDER BY job_code");
      const problemCodes = await pool.query("SELECT * FROM master_problem_codes WHERE deleted_at IS NULL ORDER BY kategori, kode");
      // PIT / Area untuk dropdown ritase: nilai distinct dari INPUT DATA (area_name),
      // fallback ke lokasi List Equipment bila belum ada log tercatat.
      const pitAreaRows = await pool.query(`
        SELECT DISTINCT area_name AS nama FROM mining_production_logs
        WHERE deleted_at IS NULL AND area_name IS NOT NULL AND TRIM(area_name) <> ''
        ORDER BY area_name
      `);
      let pitAreas = pitAreaRows.rows.map(r => r.nama);
      if (!pitAreas.length) {
        const eqAreaRows = await pool.query(`
          SELECT DISTINCT lokasi AS nama FROM equipment
          WHERE deleted_at IS NULL AND lokasi IS NOT NULL AND TRIM(lokasi) <> ''
          ORDER BY lokasi
        `);
        pitAreas = eqAreaRows.rows.map(r => r.nama);
      }
      const operators = await pool.query(`
        SELECT id, nama, jabatan, is_active
        FROM users
        WHERE role = 'karyawan'
          AND is_active = TRUE
          AND (
            LOWER(COALESCE(jabatan, '')) LIKE '%operator%'
            OR LOWER(TRIM(COALESCE(jabatan, ''))) = 'driver dt'
          )
        ORDER BY nama
      `);
      const personnel = await pool.query(`
        SELECT id, nama, jabatan, departemen, role
        FROM users
        WHERE is_active = TRUE
          AND LOWER(TRIM(COALESCE(departemen, ''))) = 'maintenance'
        ORDER BY nama
      `);

      res.json({
        pits: pits.rows,
        loadingPoints: loadingPoints.rows,
        disposals: disposals.rows,
        equipment: equipment.rows,
        standbyCodes: standbyCodes.rows,
        breakdownCodes: breakdownCodes.rows,
        shifts: shifts.rows,
        jobCodes: jobCodes.rows,
        operators: operators.rows,
        personnel: personnel.rows,
        pitAreas,
        problemCodes: problemCodes.rows
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Tambah / Update Unit Alat Berat (Parameter List Unit)
  static async createEquipment(req, res) {
    try {
      const { kode_alat, kelas_alat, class_unit, tipe_alat, brand, date_in, fuel_rate_lph, status_alat, lokasi, keterangan, kapasitas_unit, kapasitas_unit_uom } = req.body;
      if (!kode_alat || !kelas_alat || !tipe_alat) {
        return res.status(400).json({ error: 'Kode Unit, Kelas, dan Tipe Wajib diisi.' });
      }

      const query = `
        INSERT INTO equipment (kode_alat, kelas_alat, class_unit, tipe_alat, brand, date_in, fuel_rate_lph, status_alat, lokasi, keterangan, kapasitas_unit, kapasitas_unit_uom)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (kode_alat) DO UPDATE SET
          kelas_alat = EXCLUDED.kelas_alat,
          class_unit = EXCLUDED.class_unit,
          tipe_alat = EXCLUDED.tipe_alat,
          brand = EXCLUDED.brand,
          date_in = EXCLUDED.date_in,
          fuel_rate_lph = EXCLUDED.fuel_rate_lph,
          status_alat = EXCLUDED.status_alat,
          lokasi = EXCLUDED.lokasi,
          keterangan = EXCLUDED.keterangan,
          kapasitas_unit = EXCLUDED.kapasitas_unit,
          kapasitas_unit_uom = EXCLUDED.kapasitas_unit_uom,
          deleted_at = NULL
        RETURNING *
      `;
      const result = await pool.query(query, [
        kode_alat.toUpperCase(), kelas_alat, (class_unit || '').trim() || null, tipe_alat, brand || 'Caterpillar',
        date_in || getTodayString(), parseFloat(fuel_rate_lph || 35.0), normalizeEquipmentStatus(status_alat),
        lokasi || '', keterangan || '', parseCapacityValue(kapasitas_unit), resolveCapacityUom(kelas_alat, kapasitas_unit, kapasitas_unit_uom)
      ]);

      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateEquipment(req, res) {
    try {
      const { id } = req.params;
      const { kode_alat, kelas_alat, class_unit, tipe_alat, brand, date_in, fuel_rate_lph, status_alat, lokasi, keterangan, kapasitas_unit, kapasitas_unit_uom } = req.body;
      const query = `
        UPDATE equipment
        SET kode_alat = $1, kelas_alat = $2, class_unit = $3, tipe_alat = $4, brand = $5, date_in = $6, fuel_rate_lph = $7, status_alat = $8, lokasi = $9, keterangan = $10, kapasitas_unit = $11, kapasitas_unit_uom = $12, deleted_at = NULL
        WHERE id = $13
        RETURNING *
      `;
      const result = await pool.query(query, [
        kode_alat.toUpperCase(), kelas_alat, (class_unit || '').trim() || null, tipe_alat, brand || 'Caterpillar',
        date_in ? date_in.split('T')[0] : getTodayString(), parseFloat(fuel_rate_lph || 35.0), normalizeEquipmentStatus(status_alat),
        lokasi || '', keterangan || '', parseCapacityValue(kapasitas_unit), resolveCapacityUom(kelas_alat, kapasitas_unit, kapasitas_unit_uom), id
      ]);
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteEquipment(req, res) {
    try {
      const { id } = req.params;
      await pool.query("UPDATE equipment SET deleted_at = NOW() WHERE id = $1", [id]);
      res.json({ message: 'Unit berhasil dihapus dari master parameter.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async importEquipment(req, res) {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'File Excel tidak berisi data unit.' });
    }
    if (rows.length > 500) {
      return res.status(400).json({ error: 'Maksimal 500 unit untuk satu kali impor.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const imported = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] || {};
        const kodeAlat = String(row.kode_alat || '').trim().toUpperCase();
        const jenisAlat = String(row.kelas_alat || '').trim();
        const tipeAlat = String(row.tipe_alat || '').trim();
        if (!kodeAlat || !jenisAlat || !tipeAlat) {
          throw new Error(`Baris ${index + 2}: Kode Unit, Jenis Alat, dan Tipe Model wajib diisi.`);
        }

        const result = await client.query(`
          INSERT INTO equipment (kode_alat, kelas_alat, class_unit, tipe_alat, brand, date_in, fuel_rate_lph, status_alat, lokasi, keterangan, kapasitas_unit, kapasitas_unit_uom)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (kode_alat) DO UPDATE SET
            kelas_alat = EXCLUDED.kelas_alat,
            class_unit = EXCLUDED.class_unit,
            tipe_alat = EXCLUDED.tipe_alat,
            brand = EXCLUDED.brand,
            date_in = EXCLUDED.date_in,
            fuel_rate_lph = EXCLUDED.fuel_rate_lph,
            status_alat = EXCLUDED.status_alat,
            lokasi = EXCLUDED.lokasi,
            keterangan = EXCLUDED.keterangan,
            kapasitas_unit = EXCLUDED.kapasitas_unit,
            kapasitas_unit_uom = EXCLUDED.kapasitas_unit_uom,
            deleted_at = NULL
          RETURNING id, kode_alat
        `, [
          kodeAlat, jenisAlat, String(row.class_unit || '').trim() || null, tipeAlat,
          String(row.brand || 'Caterpillar').trim() || 'Caterpillar', row.date_in || getTodayString(),
          Number(row.fuel_rate_lph || 35), normalizeEquipmentStatus(row.status_alat),
          String(row.lokasi || '').trim(), String(row.keterangan || '').trim(),
          parseCapacityValue(row.kapasitas_unit), resolveCapacityUom(jenisAlat, row.kapasitas_unit, row.kapasitas_unit_uom),
        ]);
        imported.push(result.rows[0]);
      }
      await client.query('COMMIT');
      res.status(201).json({ message: `${imported.length} unit berhasil diimpor.`, total: imported.length, units: imported });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async clearAllParameters(req, res) {
    try {
      await pool.query("UPDATE equipment SET deleted_at = NOW()");
      await pool.query("UPDATE master_standby_codes SET deleted_at = NOW() WHERE COALESCE(is_locked,FALSE)=FALSE");
      await pool.query("UPDATE master_breakdown_codes SET deleted_at = NOW()");
      await pool.query("UPDATE mining_production_logs SET deleted_at = NOW()");
      await pool.query("UPDATE fuel_logs SET deleted_at = NOW()");
      await pool.query("UPDATE standby_logs SET deleted_at = NOW()");
      await pool.query("UPDATE breakdown_logs SET deleted_at = NOW()");
      await pool.query("UPDATE ritase_logs SET deleted_at = NOW()");
      await pool.query("UPDATE fleet_mappings SET deleted_at = NOW()");
      res.json({ message: 'Seluruh data parameter dan log produksi lama berhasil dihapus.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Tambah Kode Standby
  static async createStandbyCode(req, res) {
    try {
      const kode = String(req.body?.kode || '').trim().toUpperCase();
      const kategori = String(req.body?.kategori || '').trim();
      const deskripsi = String(req.body?.deskripsi || '').trim();
      const planningType = ['planned','unplanned'].includes(String(req.body?.planning_type || '').toLowerCase()) ? String(req.body.planning_type).toLowerCase() : 'unplanned';
      const controlClass = ['controllable','uncontrollable'].includes(String(req.body?.control_class || '').toLowerCase()) ? String(req.body.control_class).toLowerCase() : 'controllable';
      const ownerDepartment = String(req.body?.owner_department || 'Production').trim() || 'Production';
      const requiresDescription = parseBooleanInput(req.body?.requires_description);
      const requiresEvidence = parseBooleanInput(req.body?.requires_evidence);
      if (!kode || !kategori) return res.status(400).json({ error: 'Kode dan kategori standby wajib diisi.' });
      const query = `
        INSERT INTO master_standby_codes (kode,kategori,deskripsi,planning_type,control_class,owner_department,requires_description,requires_evidence,deleted_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,CURRENT_TIMESTAMP)
        ON CONFLICT (kode) DO UPDATE SET kategori = EXCLUDED.kategori, deskripsi = EXCLUDED.deskripsi,
          planning_type=EXCLUDED.planning_type,control_class=EXCLUDED.control_class,owner_department=EXCLUDED.owner_department,
          requires_description=EXCLUDED.requires_description,requires_evidence=EXCLUDED.requires_evidence,
          deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE master_standby_codes.is_locked=FALSE
        RETURNING *
      `;
      const result = await pool.query(query, [kode,kategori,deskripsi,planningType,controlClass,ownerDepartment,requiresDescription,requiresEvidence]);
      if (!result.rows.length) return res.status(409).json({ error: 'Kode standby tersebut dicadangkan dan dikunci oleh sistem.' });
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Tambah Kode Breakdown
  static async createBreakdownCode(req, res) {
    try {
      const kode = String(req.body?.kode || '').trim().toUpperCase();
      const kategori = String(req.body?.kategori || '').trim();
      const deskripsi = String(req.body?.deskripsi || '').trim();
      if (!kode || !kategori) return res.status(400).json({ error: 'Kode dan kategori breakdown wajib diisi.' });
      const query = `
        INSERT INTO master_breakdown_codes (kode, kategori, deskripsi, deleted_at, updated_at)
        VALUES ($1, $2, $3, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (kode) DO UPDATE SET kategori = EXCLUDED.kategori, deskripsi = EXCLUDED.deskripsi,
          deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;
      const result = await pool.query(query, [kode, kategori, deskripsi]);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateStandbyCode(req, res) {
    try {
      const kode = String(req.body?.kode || '').trim().toUpperCase();
      const kategori = String(req.body?.kategori || '').trim();
      const deskripsi = String(req.body?.deskripsi || '').trim();
      const planningType = ['planned','unplanned'].includes(String(req.body?.planning_type || '').toLowerCase()) ? String(req.body.planning_type).toLowerCase() : 'unplanned';
      const controlClass = ['controllable','uncontrollable'].includes(String(req.body?.control_class || '').toLowerCase()) ? String(req.body.control_class).toLowerCase() : 'controllable';
      const ownerDepartment = String(req.body?.owner_department || 'Production').trim() || 'Production';
      const requiresDescription = parseBooleanInput(req.body?.requires_description);
      const requiresEvidence = parseBooleanInput(req.body?.requires_evidence);
      if (!kode || !kategori) return res.status(400).json({ error: 'Kode dan kategori standby wajib diisi.' });
      const result = await pool.query(`
        UPDATE master_standby_codes SET kode=$1,kategori=$2,deskripsi=$3,planning_type=$4,control_class=$5,
          owner_department=$6,requires_description=$7,requires_evidence=$8,updated_at=CURRENT_TIMESTAMP
        WHERE id=$9 AND deleted_at IS NULL AND COALESCE(is_locked,FALSE)=FALSE RETURNING *
      `, [kode,kategori,deskripsi,planningType,controlClass,ownerDepartment,requiresDescription,requiresEvidence,req.params.id]);
      if (!result.rows.length) {
        const locked = await pool.query('SELECT is_locked FROM master_standby_codes WHERE id=$1', [req.params.id]);
        if (locked.rows[0]?.is_locked) return res.status(403).json({ error: 'Kode standby sistem bersifat read only.' });
        return res.status(404).json({ error: 'Kode standby tidak ditemukan.' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Kode standby sudah digunakan.' });
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteStandbyCode(req, res) {
    try {
      const result = await pool.query(`UPDATE master_standby_codes SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL AND COALESCE(is_locked,FALSE)=FALSE RETURNING id`, [req.params.id]);
      if (!result.rows.length) {
        const locked = await pool.query('SELECT is_locked FROM master_standby_codes WHERE id=$1', [req.params.id]);
        if (locked.rows[0]?.is_locked) return res.status(403).json({ error: 'Kode standby sistem tidak dapat dihapus.' });
        return res.status(404).json({ error: 'Kode standby tidak ditemukan.' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateBreakdownCode(req, res) {
    try {
      const kode = String(req.body?.kode || '').trim().toUpperCase();
      const kategori = String(req.body?.kategori || '').trim();
      const deskripsi = String(req.body?.deskripsi || '').trim();
      if (!kode || !kategori) return res.status(400).json({ error: 'Kode dan kategori breakdown wajib diisi.' });
      const result = await pool.query(`
        UPDATE master_breakdown_codes SET kode = $1, kategori = $2, deskripsi = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND deleted_at IS NULL RETURNING *
      `, [kode, kategori, deskripsi, req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Kode breakdown tidak ditemukan.' });
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Kode breakdown sudah digunakan.' });
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteBreakdownCode(req, res) {
    try {
      const result = await pool.query(`UPDATE master_breakdown_codes SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Kode breakdown tidak ditemukan.' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createJobCode(req, res) {
    try {
      const jobCode = String(req.body?.job_code || '').trim().toUpperCase();
      const jobDesc = String(req.body?.job_desc || '').trim();
      if (!jobCode || !jobDesc) return res.status(400).json({ error: 'JOB dan JOB DESC wajib diisi.' });
      const result = await pool.query(`
        INSERT INTO master_job_codes (job_code, job_desc, is_reference, deleted_at, updated_at)
        VALUES ($1, $2, FALSE, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (job_code) DO UPDATE SET
          job_desc = EXCLUDED.job_desc,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [jobCode, jobDesc]);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateJobCode(req, res) {
    try {
      const jobCode = String(req.body?.job_code || '').trim().toUpperCase();
      const jobDesc = String(req.body?.job_desc || '').trim();
      if (!jobCode || !jobDesc) return res.status(400).json({ error: 'JOB dan JOB DESC wajib diisi.' });
      const result = await pool.query(`
        UPDATE master_job_codes
        SET job_code = $1, job_desc = $2, is_reference = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND deleted_at IS NULL
        RETURNING *
      `, [jobCode, jobDesc, req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Master JOB tidak ditemukan.' });
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Kode JOB sudah digunakan.' });
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteJobCode(req, res) {
    try {
      const result = await pool.query(`
        UPDATE master_job_codes
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `, [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Master JOB tidak ditemukan.' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Master Problem Productivity (kategori problem operasional tambang)
  static async createProblemCode(req, res) {
    try {
      const kategori = String(req.body?.kategori || '').trim().toUpperCase();
      const kode = String(req.body?.kode || '').trim().toUpperCase();
      const problem = String(req.body?.problem || '').trim();
      if (!kategori || !kode || !problem) return res.status(400).json({ error: 'Kategori, Kode, dan Problem wajib diisi.' });
      const result = await pool.query(`
        INSERT INTO master_problem_codes (kategori, kode, problem, is_reference, deleted_at, updated_at)
        VALUES ($1, $2, $3, FALSE, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (kode) DO UPDATE SET
          kategori = EXCLUDED.kategori,
          problem = EXCLUDED.problem,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [kategori, kode, problem]);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateProblemCode(req, res) {
    try {
      const kategori = String(req.body?.kategori || '').trim().toUpperCase();
      const kode = String(req.body?.kode || '').trim().toUpperCase();
      const problem = String(req.body?.problem || '').trim();
      if (!kategori || !kode || !problem) return res.status(400).json({ error: 'Kategori, Kode, dan Problem wajib diisi.' });
      const result = await pool.query(`
        UPDATE master_problem_codes
        SET kategori = $1, kode = $2, problem = $3, is_reference = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND deleted_at IS NULL
        RETURNING *
      `, [kategori, kode, problem, req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Kode problem tidak ditemukan.' });
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Kode problem sudah digunakan.' });
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteProblemCode(req, res) {
    try {
      const result = await pool.query(`
        UPDATE master_problem_codes
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `, [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Kode problem tidak ditemukan.' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Apply Standard Mine Master Parameter Template (PARAMETER.xlsx)
  static async applyParameterTemplate(req, res) {
    try {
      const importExcel = require('../scripts/importParameterExcel');
      await importExcel();
      res.json({ message: 'Template Master Parameter dari PARAMETER.xlsx berhasil diterapkan!' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 1. INPUT DATA (EQUIPMENT WORK LOG)
  // =========================================================
  static async getProductionLogs(req, res) {
    try {
      const { tanggal, shift_id, equipment_id, search, year, month } = req.query;
      let query = `
        SELECT mpl.*, 
               s.nama_shift, 
               e.kode_alat, e.kelas_alat, e.class_unit, e.tipe_alat,
               p.nama_pit, lp.nama_loading_point, d.nama_disposal,
               u.nama as nama_operator
        FROM mining_production_logs mpl
        LEFT JOIN shifts s ON mpl.shift_id = s.id
        LEFT JOIN equipment e ON mpl.equipment_id = e.id
        LEFT JOIN production_pits p ON mpl.pit_id = p.id
        LEFT JOIN loading_points lp ON mpl.loading_point_id = lp.id
        LEFT JOIN disposals d ON mpl.disposal_id = d.id
        LEFT JOIN users u ON mpl.operator_id = u.id
        WHERE mpl.deleted_at IS NULL
      `;
      const params = [];
      let idx = 1;

      if (year) {
        const normalizedYear = String(year).trim();
        const normalizedMonth = month == null || month === '' ? '' : String(month).padStart(2, '0');
        if (!/^\d{4}$/.test(normalizedYear)) {
          return res.status(400).json({ error: 'Format tahun harus 4 digit.' });
        }
        if (normalizedMonth && !/^(0[1-9]|1[0-2])$/.test(normalizedMonth)) {
          return res.status(400).json({ error: 'Format bulan harus 01 sampai 12.' });
        }
        const periodStart = `${normalizedYear}-${normalizedMonth || '01'}-01`;
        query += ` AND mpl.tanggal >= $${idx++}::date`;
        params.push(periodStart);
        if (normalizedMonth) {
          query += ` AND mpl.tanggal < ($${idx++}::date + INTERVAL '1 month')`;
          params.push(periodStart);
        } else {
          query += ` AND mpl.tanggal < ($${idx++}::date + INTERVAL '1 year')`;
          params.push(periodStart);
        }
      }

      if (tanggal) {
        query += ` AND mpl.tanggal = $${idx++}`;
        params.push(tanggal);
      }
      if (shift_id) {
        query += ` AND mpl.shift_id = $${idx++}`;
        params.push(shift_id);
      }
      if (equipment_id) {
        query += ` AND mpl.equipment_id = $${idx++}`;
        params.push(equipment_id);
      }
      if (search) {
        query += ` AND (e.kode_alat ILIKE $${idx} OR mpl.job_description ILIKE $${idx} OR u.nama ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }

      query += ` ORDER BY mpl.tanggal DESC, mpl.created_at DESC LIMIT 200`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getProductionLogPeriods(req, res) {
    try {
      const result = await pool.query(`
        SELECT
          EXTRACT(YEAR FROM tanggal)::int AS year,
          EXTRACT(MONTH FROM tanggal)::int AS month,
          COUNT(*)::int AS total
        FROM mining_production_logs
        WHERE deleted_at IS NULL
        GROUP BY 1, 2
        ORDER BY 1 DESC, 2 DESC
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createProductionLog(req, res) {
    try {
      const {
        tanggal, shift_id, project_name, pit_id, loading_point_id, disposal_id,
        equipment_id, operator_id, area_name, job, job_description, hm_start, hm_finish, remark, status,
        acknowledge_hm_anomaly, hm_anomaly_reason
      } = req.body;

      if (!tanggal || !shift_id || !equipment_id || !operator_id || !area_name || !job || !job_description) {
        return res.status(400).json({ error: 'Tanggal, Shift, Kode Unit, Operator, PIT/Area, JOB, dan Job Description wajib diisi.' });
      }

      const requestedUserId = req.user?.id || null;
      const creatorResult = requestedUserId
        ? await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [requestedUserId])
        : { rows: [] };
      const userId = creatorResult.rows[0]?.id || null;
      const hmS = parseFloat(hm_start || 0);
      const hmF = parseFloat(hm_finish || 0);
      try {
        calculateHmTotal(hmS, hmF);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      const hmAnalysis = await analyzeHmHybrid(pool, {
        tanggal,
        shiftId: shift_id,
        equipmentId: equipment_id,
        hmStart: hmS,
        hmFinish: hmF,
      });
      if (hmAnalysis.hardIssues.length) {
        return res.status(422).json({ code: 'HM_HARD_BLOCK', error: hmAnalysis.hardIssues[0].message, anomaly: hmAnalysis });
      }
      const anomalyReason = String(hm_anomaly_reason || '').trim();
      if (hmAnalysis.criticalIssues.length && (!acknowledge_hm_anomaly || anomalyReason.length < 5)) {
        return res.status(409).json({ code: 'HM_CONFIRMATION_REQUIRED', error: 'Anomali HM kritis memerlukan konfirmasi dan alasan.', anomaly: hmAnalysis });
      }
      const persistedHmStatus = hmAnalysis.criticalIssues.length ? 'confirmed' : hmAnalysis.warnings.length ? 'warning' : 'normal';

      const query = `
        INSERT INTO mining_production_logs (
          tanggal, shift_id, project_name, pit_id, loading_point_id, disposal_id,
          equipment_id, operator_id, area_name, job, job_description, hm_start, hm_finish, remark, status, created_by,
          hm_anomaly_status, hm_anomaly_reason, hm_anomaly_details, hm_validated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, CURRENT_TIMESTAMP)
        RETURNING *
      `;
      const result = await pool.query(query, [
        tanggal, shift_id, project_name || 'PIM Mining Project', pit_id || null, loading_point_id || null, disposal_id || null,
        equipment_id, operator_id, String(area_name).trim(), String(job).trim(), job_description, hmS, hmF, remark || '', status || 'submitted', userId,
        persistedHmStatus, hmAnalysis.criticalIssues.length ? anomalyReason : null, JSON.stringify(hmAnalysis)
      ]);

      res.status(201).json({ ...result.rows[0], hm_analysis: hmAnalysis });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createProductionLogsBatch(req, res) {
    const client = await pool.connect();
    try {
      const tanggal = String(req.body?.tanggal || '').trim();
      const shiftId = String(req.body?.shift_id || '').trim();
      const areaName = String(req.body?.area_name || '').trim();
      const jobCode = String(req.body?.job || '').trim().toUpperCase();
      const equipmentIds = [...new Set((Array.isArray(req.body?.equipment_ids) ? req.body.equipment_ids : [])
        .map(value => String(value || '').trim()).filter(Boolean))];
      if (!tanggal || !shiftId || !areaName || !jobCode || !equipmentIds.length) {
        return res.status(400).json({ error: 'Hari, shift, minimal satu unit, PIT/Area, dan JOB wajib diisi.' });
      }
      if (equipmentIds.length > 500) return res.status(400).json({ error: 'Maksimal 500 unit dalam satu proses Multi Work Log.' });

      await client.query('BEGIN');
      const jobResult = await client.query(`
        SELECT job_code, job_desc FROM master_job_codes
        WHERE UPPER(job_code) = $1 AND deleted_at IS NULL LIMIT 1
      `, [jobCode]);
      if (!jobResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'JOB tidak ditemukan pada Master JOB.' });
      }
      const validUnits = await client.query(`
        SELECT id FROM equipment WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
      `, [equipmentIds]);
      if (validUnits.rows.length !== equipmentIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Sebagian unit tidak ditemukan atau sudah tidak aktif.' });
      }

      const existing = await client.query(`
        SELECT equipment_id FROM mining_production_logs
        WHERE tanggal = $1 AND shift_id = $2 AND equipment_id = ANY($3::uuid[]) AND deleted_at IS NULL
      `, [tanggal, shiftId, equipmentIds]);
      const existingIds = new Set(existing.rows.map(row => String(row.equipment_id)));
      const insertIds = equipmentIds.filter(id => !existingIds.has(id));
      let inserted = [];
      if (insertIds.length) {
        const requestedUserId = req.user?.id || null;
        const creatorResult = requestedUserId
          ? await client.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [requestedUserId])
          : { rows: [] };
        const userId = creatorResult.rows[0]?.id || null;
        const result = await client.query(`
          INSERT INTO mining_production_logs (
            tanggal, shift_id, equipment_id, operator_id, area_name, job, job_description,
            hm_start, hm_finish, status, created_by
          )
          SELECT $1, $2, unit_id, NULL, $3, $4, $5, 0, 0, 'draft', $6
          FROM unnest($7::uuid[]) AS unit_id
          RETURNING *
        `, [tanggal, shiftId, areaName, jobResult.rows[0].job_code, jobResult.rows[0].job_desc, userId, insertIds]);
        inserted = result.rows;
      }
      await client.query('COMMIT');
      res.status(201).json({
        success: true,
        inserted: inserted.length,
        skipped: existingIds.size,
        logs: inserted,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async deleteProductionLogsBatch(req, res) {
    try {
      const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map(value => String(value || '').trim()).filter(Boolean))];
      if (!ids.length) return res.status(400).json({ error: 'Pilih minimal satu Work Log untuk dihapus.' });
      if (ids.length > 500) return res.status(400).json({ error: 'Maksimal 500 Work Log dalam satu proses hapus.' });
      const result = await pool.query(`
        UPDATE mining_production_logs
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
        RETURNING id
      `, [ids]);
      res.json({ success: true, deleted: result.rowCount, ids: result.rows.map(row => row.id) });
    } catch (err) {
      if (err.code === '22P02') return res.status(400).json({ error: 'ID Work Log tidak valid.' });
      res.status(500).json({ error: err.message });
    }
  }

  static async restoreProductionLogsBatch(req, res) {
    try {
      const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map(value => String(value || '').trim()).filter(Boolean))];
      if (!ids.length) return res.status(400).json({ error: 'Tidak ada Work Log yang dipilih untuk dipulihkan.' });
      if (ids.length > 500) return res.status(400).json({ error: 'Maksimal 500 Work Log dalam satu proses restore.' });
      const result = await pool.query(`
        UPDATE mining_production_logs
        SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL
        RETURNING id
      `, [ids]);
      res.json({ success: true, restored: result.rowCount, ids: result.rows.map(row => row.id) });
    } catch (err) {
      if (err.code === '22P02') return res.status(400).json({ error: 'ID Work Log tidak valid.' });
      res.status(500).json({ error: err.message });
    }
  }

  static async checkProductionLogHm(req, res) {
    try {
      const { tanggal, shift_id, equipment_id, hm_start, hm_finish, log_id } = req.body || {};
      if (!tanggal || !shift_id || !equipment_id || hm_start === '' || hm_finish === '') {
        return res.status(400).json({ error: 'Tanggal, shift, unit, HM Start, dan HM Akhir wajib tersedia untuk pemeriksaan.' });
      }
      const analysis = await analyzeHmHybrid(pool, {
        logId: log_id || null,
        tanggal,
        shiftId: shift_id,
        equipmentId: equipment_id,
        hmStart: hm_start,
        hmFinish: hm_finish,
      });
      res.json(analysis);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  static async updateProductionLog(req, res) {
    try {
      const {
        tanggal, shift_id, equipment_id, operator_id, area_name, job,
        job_description, hm_start, hm_finish, acknowledge_hm_anomaly, hm_anomaly_reason,
      } = req.body;
      if (!tanggal || !shift_id || !equipment_id || !operator_id || !area_name || !job || !job_description) {
        return res.status(400).json({ error: 'Tanggal, Shift, Kode Unit, Operator, PIT/Area, JOB, dan Job Description wajib diisi.' });
      }
      const hmS = parseFloat(hm_start);
      const hmF = parseFloat(hm_finish);
      try {
        calculateHmTotal(hmS, hmF);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      const hmAnalysis = await analyzeHmHybrid(pool, {
        logId: req.params.id,
        tanggal,
        shiftId: shift_id,
        equipmentId: equipment_id,
        hmStart: hmS,
        hmFinish: hmF,
      });
      if (hmAnalysis.hardIssues.length) {
        return res.status(422).json({ code: 'HM_HARD_BLOCK', error: hmAnalysis.hardIssues[0].message, anomaly: hmAnalysis });
      }
      const anomalyReason = String(hm_anomaly_reason || '').trim();
      if (hmAnalysis.criticalIssues.length && (!acknowledge_hm_anomaly || anomalyReason.length < 5)) {
        return res.status(409).json({ code: 'HM_CONFIRMATION_REQUIRED', error: 'Anomali HM kritis memerlukan konfirmasi dan alasan.', anomaly: hmAnalysis });
      }
      const persistedHmStatus = hmAnalysis.criticalIssues.length ? 'confirmed' : hmAnalysis.warnings.length ? 'warning' : 'normal';
      const requestedUpdaterId = req.user?.id || null;
      const updaterResult = requestedUpdaterId
        ? await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [requestedUpdaterId])
        : { rows: [] };
      const updaterId = updaterResult.rows[0]?.id || null;
      const result = await pool.query(`
        UPDATE mining_production_logs SET
          tanggal = $1,
          shift_id = $2,
          equipment_id = $3,
          operator_id = $4,
          area_name = $5,
          job = $6,
          job_description = $7,
          hm_start = $8,
          hm_finish = $9,
          updated_by = $10,
          hm_anomaly_status = $11,
          hm_anomaly_reason = $12,
          hm_anomaly_details = $13::jsonb,
          hm_validated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $14 AND deleted_at IS NULL
        RETURNING *
      `, [
        tanggal, shift_id, equipment_id, operator_id, String(area_name).trim(), String(job).trim(),
        String(job_description).trim(), hmS, hmF, updaterId, persistedHmStatus,
        hmAnalysis.criticalIssues.length ? anomalyReason : null, JSON.stringify(hmAnalysis), req.params.id,
      ]);
      if (!result.rows.length) return res.status(404).json({ error: 'Work log tidak ditemukan.' });
      res.json({ ...result.rows[0], hm_analysis: hmAnalysis });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 2. INPUT FUEL
  // =========================================================
  static async getFuelLogs(req, res) {
    try {
      const { tanggal, shift_id, equipment_id, year, month } = req.query;
      const shiftOrder = fuelShiftOrderSql('s');
      let query = `WITH ordered AS (
        SELECT fl.*, TO_CHAR(fl.tanggal, 'YYYY-MM-DD') AS calendar_date,
          COALESCE(fl.hm_reading, fl.hm_finish)::float AS current_hm,
          fl.odometer_reading::float AS current_km,
          LAG(COALESCE(fl.hm_reading, fl.hm_finish)::float) OVER (
            PARTITION BY fl.equipment_id ORDER BY fl.tanggal, ${shiftOrder}, fl.created_at, fl.id
          ) AS previous_hm,
          LAG(fl.odometer_reading::float) OVER (
            PARTITION BY fl.equipment_id ORDER BY fl.tanggal, ${shiftOrder}, fl.created_at, fl.id
          ) AS previous_km,
          COUNT(*) OVER (PARTITION BY fl.equipment_id, fl.tanggal, fl.shift_id)::int AS duplicate_count,
          e.kode_alat, e.kelas_alat, e.class_unit, e.tipe_alat, e.fuel_rate_lph::float AS fuel_rate_lph,
          s.nama_shift, u.nama AS nama_operator
        FROM fuel_logs fl
        LEFT JOIN equipment e ON fl.equipment_id=e.id
        LEFT JOIN shifts s ON fl.shift_id=s.id
        LEFT JOIN users u ON fl.operator_id=u.id
        WHERE fl.deleted_at IS NULL
      ) SELECT * FROM ordered WHERE 1=1`;
      const params = [];
      let idx = 1;
      if (year) {
        const normalizedYear = String(year).trim();
        const normalizedMonth = month == null || month === '' ? '' : String(month).padStart(2, '0');
        if (!/^\d{4}$/.test(normalizedYear)) return res.status(400).json({ error: 'Format tahun harus 4 digit.' });
        if (normalizedMonth && !/^(0[1-9]|1[0-2])$/.test(normalizedMonth)) return res.status(400).json({ error: 'Format bulan harus 01 sampai 12.' });
        const startDate = `${normalizedYear}-${normalizedMonth || '01'}-01`;
        query += ` AND tanggal >= $${idx++}::date`;
        params.push(startDate);
        query += normalizedMonth
          ? ` AND tanggal < ($${idx++}::date + INTERVAL '1 month')`
          : ` AND tanggal < ($${idx++}::date + INTERVAL '1 year')`;
        params.push(startDate);
      }
      if (tanggal) {
        query += ` AND tanggal = $${idx++}`;
        params.push(tanggal);
      }
      if (shift_id) {
        query += ` AND shift_id = $${idx++}`;
        params.push(shift_id);
      }
      if (equipment_id) {
        query += ` AND equipment_id = $${idx++}`;
        params.push(equipment_id);
      }
      query += ` ORDER BY tanggal ASC, created_at ASC LIMIT 2000`;

      const result = await pool.query(query, params);
      const logs = result.rows.map(row => {
        const currentHm = nullableFiniteNumber(row.current_hm);
        const previousHm = nullableFiniteNumber(row.previous_hm);
        const currentKm = nullableFiniteNumber(row.current_km);
        const previousKm = nullableFiniteNumber(row.previous_km);
        const hmDelta = !row.is_meter_reset && previousHm !== null && currentHm !== null && currentHm > previousHm ? currentHm - previousHm : null;
        const distanceKm = !row.is_meter_reset && currentKm !== null && previousKm !== null && currentKm > previousKm ? currentKm - previousKm : null;
        const fuel = Number(row.fuel_filled || 0);
        const targetFuel = hmDelta > 0 && Number.isFinite(Number(row.fuel_rate_lph)) ? Number(row.fuel_rate_lph) * hmDelta : null;
        const variance = targetFuel !== null ? fuel - targetFuel : null;
        const variancePct = targetFuel > 0 ? variance / targetFuel * 100 : null;
        const computedWarnings = [];
        if (Number(row.duplicate_count) > 1) computedWarnings.push('DUPLICATE_UNIT_SHIFT');
        if (previousHm === null) computedWarnings.push('HM_BASELINE_MISSING');
        if (previousHm !== null && currentHm !== null && currentHm <= previousHm && !row.is_meter_reset) computedWarnings.push('HM_NOT_INCREASING');
        if (variancePct !== null && variancePct > 20) computedWarnings.push('HIGH_FUEL_VARIANCE');
        if (isFuelDistanceEquipment(row) && currentKm === null) computedWarnings.push('KM_REQUIRED_FOR_MOBILE');
        return {
          ...row,
          // Kirim DATE sebagai string kalender, bukan JavaScript timestamp.
          tanggal: row.calendar_date,
          hm_reading: currentHm,
          odometer_reading: currentKm,
          previous_hm: previousHm,
          previous_km: previousKm,
          hm_delta: hmDelta,
          distance_km: distanceKm,
          fuel_per_hm: hmDelta > 0 ? fuel / hmDelta : null,
          fuel_per_km: distanceKm > 0 ? fuel / distanceKm : null,
          target_fuel: targetFuel,
          variance_fuel: variance,
          variance_pct: variancePct,
          supports_distance: isFuelDistanceEquipment(row),
          computed_warnings: computedWarnings,
          computed_status: computedWarnings.some(code => code === 'DUPLICATE_UNIT_SHIFT' || code === 'HM_NOT_INCREASING') ? 'critical' : computedWarnings.length ? 'warning' : 'normal',
        };
      });

      const totalFuelFilled = logs.reduce((acc, row) => acc + Number(row.fuel_filled || 0), 0);
      const totalHm = logs.reduce((acc, row) => acc + Number(row.hm_delta || 0), 0);
      const totalDistance = logs.reduce((acc, row) => acc + Number(row.distance_km || 0), 0);

      res.json({
        logs,
        summary: {
          totalFuelFilled,
          totalHm,
          totalDistance,
          weightedFuelPerHm: totalHm > 0 ? totalFuelFilled / totalHm : null,
          weightedFuelPerKm: totalDistance > 0 ? totalFuelFilled / totalDistance : null,
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getFuelCards(req, res) {
    try {
      const now = new Date();
      const year = /^\d{4}$/.test(String(req.query.year || '')) ? String(req.query.year) : String(now.getFullYear());
      const month = /^(0[1-9]|1[0-2])$/.test(String(req.query.month || '')) ? String(req.query.month) : String(now.getMonth() + 1).padStart(2, '0');
      const startDate = `${year}-${month}-01`;
      const shiftOrder = fuelShiftOrderSql('s');
      const [equipmentResult, logResult] = await Promise.all([
        pool.query(`SELECT id, kode_alat, kelas_alat, class_unit, tipe_alat, fuel_rate_lph::float AS fuel_rate_lph,
                           status_alat, lokasi
                    FROM equipment WHERE deleted_at IS NULL AND COALESCE(is_active,TRUE)=TRUE
                    ORDER BY kelas_alat, kode_alat`),
        pool.query(`WITH ordered AS (
          SELECT fl.*, TO_CHAR(fl.tanggal, 'YYYY-MM-DD') AS calendar_date,
            COALESCE(fl.hm_reading,fl.hm_finish)::float AS current_hm,
            fl.odometer_reading::float AS current_km,
            LAG(COALESCE(fl.hm_reading,fl.hm_finish)::float) OVER (
              PARTITION BY fl.equipment_id ORDER BY fl.tanggal, ${shiftOrder}, fl.created_at, fl.id
            ) AS previous_hm,
            LAG(fl.odometer_reading::float) OVER (
              PARTITION BY fl.equipment_id ORDER BY fl.tanggal, ${shiftOrder}, fl.created_at, fl.id
            ) AS previous_km,
            COUNT(*) OVER (PARTITION BY fl.equipment_id,fl.tanggal,fl.shift_id)::int AS duplicate_count
          FROM fuel_logs fl JOIN shifts s ON s.id=fl.shift_id WHERE fl.deleted_at IS NULL
        ) SELECT * FROM ordered WHERE tanggal >= $1::date AND tanggal < ($1::date + INTERVAL '1 month')`, [startDate]),
      ]);
      const logsByEquipment = new Map();
      logResult.rows.forEach(row => {
        const key = String(row.equipment_id);
        if (!logsByEquipment.has(key)) logsByEquipment.set(key, []);
        logsByEquipment.get(key).push(row);
      });
      const query = String(req.query.q || '').trim().toLowerCase();
      const jenis = String(req.query.jenis || '').trim();
      const classUnit = String(req.query.class_unit || '').trim();
      const status = String(req.query.status || '').trim();
      let cards = equipmentResult.rows.map(equipment => {
        const unitLogs = logsByEquipment.get(String(equipment.id)) || [];
        let totalFuel = 0; let totalHm = 0; let totalDistance = 0; let targetFuel = 0; let targetRows = 0; let anomalyCount = 0;
        unitLogs.forEach(row => {
          const fuel = Number(row.fuel_filled || 0);
          const currentHm = nullableFiniteNumber(row.current_hm); const previousHm = nullableFiniteNumber(row.previous_hm);
          const currentKm = nullableFiniteNumber(row.current_km); const previousKm = nullableFiniteNumber(row.previous_km);
          const hmDelta = !row.is_meter_reset && previousHm !== null && currentHm !== null && currentHm > previousHm ? currentHm - previousHm : null;
          const distance = !row.is_meter_reset && currentKm !== null && previousKm !== null && currentKm > previousKm ? currentKm - previousKm : null;
          totalFuel += fuel;
          if (hmDelta > 0) {
            totalHm += hmDelta;
            if (Number.isFinite(Number(equipment.fuel_rate_lph))) { targetFuel += Number(equipment.fuel_rate_lph) * hmDelta; targetRows += 1; }
          }
          if (distance > 0) totalDistance += distance;
          const variancePct = hmDelta > 0 && Number(equipment.fuel_rate_lph) > 0 ? (fuel - Number(equipment.fuel_rate_lph) * hmDelta) / (Number(equipment.fuel_rate_lph) * hmDelta) * 100 : null;
          if (Number(row.duplicate_count) > 1 || (previousHm !== null && currentHm !== null && currentHm <= previousHm && !row.is_meter_reset) || (variancePct !== null && variancePct > 20)) anomalyCount += 1;
        });
        const variance = targetRows ? totalFuel - targetFuel : null;
        return {
          ...equipment,
          supports_distance: isFuelDistanceEquipment(equipment),
          log_count: unitLogs.length,
          anomaly_count: anomalyCount,
          total_fuel: totalFuel,
          total_hm: totalHm,
          total_distance: totalDistance,
          weighted_fuel_per_hm: totalHm > 0 ? totalFuel / totalHm : null,
          weighted_fuel_per_km: totalDistance > 0 ? totalFuel / totalDistance : null,
          target_fuel: targetRows ? targetFuel : null,
          variance_fuel: variance,
          variance_pct: targetFuel > 0 ? variance / targetFuel * 100 : null,
          connection_status: unitLogs.length ? (anomalyCount ? 'warning' : 'connected') : 'empty',
        };
      });
      if (query) cards = cards.filter(card => `${card.kode_alat} ${card.class_unit} ${card.tipe_alat}`.toLowerCase().includes(query));
      if (jenis) cards = cards.filter(card => card.kelas_alat === jenis);
      if (classUnit) cards = cards.filter(card => card.class_unit === classUnit);
      if (status === 'anomaly') cards = cards.filter(card => card.anomaly_count > 0);
      if (status === 'empty') cards = cards.filter(card => card.log_count === 0);
      if (status === 'connected') cards = cards.filter(card => card.log_count > 0 && card.anomaly_count === 0);
      cards.sort((a, b) => String(a.kelas_alat || '').localeCompare(String(b.kelas_alat || ''), 'id-ID') || String(a.kode_alat || '').localeCompare(String(b.kode_alat || ''), 'id-ID', { numeric: true }));
      const groups = [...new Set(cards.map(card => card.kelas_alat || 'Jenis Alat Belum Diisi'))];
      const totalFuel = cards.reduce((sum, card) => sum + card.total_fuel, 0);
      const totalHm = cards.reduce((sum, card) => sum + card.total_hm, 0);
      const totalDistance = cards.reduce((sum, card) => sum + card.total_distance, 0);
      const totalTarget = cards.reduce((sum, card) => sum + Number(card.target_fuel || 0), 0);
      res.json({
        period: { year: Number(year), month: Number(month) }, cards, groups,
        summary: {
          total_units: cards.length,
          units_with_logs: cards.filter(card => card.log_count > 0).length,
          anomaly_units: cards.filter(card => card.anomaly_count > 0).length,
          total_fuel: totalFuel,
          total_hm: totalHm,
          total_distance: totalDistance,
          weighted_fuel_per_hm: totalHm > 0 ? totalFuel / totalHm : null,
          weighted_fuel_per_km: totalDistance > 0 ? totalFuel / totalDistance : null,
          target_fuel: totalTarget || null,
          variance_fuel: totalTarget ? totalFuel - totalTarget : null,
          variance_pct: totalTarget ? (totalFuel - totalTarget) / totalTarget * 100 : null,
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getFuelLogPeriods(req, res) {
    try {
      const result = await pool.query(`
        SELECT EXTRACT(YEAR FROM tanggal)::int AS year, EXTRACT(MONTH FROM tanggal)::int AS month, COUNT(*)::int AS total
        FROM fuel_logs WHERE deleted_at IS NULL
        GROUP BY 1, 2 ORDER BY 1 DESC, 2 DESC
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createFuelLog(req, res) {
    const client = await pool.connect();
    try {
      const body = req.body || {};
      const { shift_id, equipment_id, operator_id } = body;
      const tanggal = normalizeDateOnly(body.tanggal);
      if (!tanggal || !shift_id || !equipment_id) return res.status(400).json({ error: 'Tanggal, shift, dan kode unit wajib diisi.' });
      const hmReading = parseOptionalNonNegativeNumber(body.hm_reading ?? body.hm_finish, 'HM aktual');
      const odometerReading = parseOptionalNonNegativeNumber(body.odometer_reading, 'KM/Odometer');
      const fuelFilled = parseOptionalNonNegativeNumber(body.fuel_filled, 'Fuel diisikan');
      if (hmReading === null) return res.status(400).json({ error: 'HM aktual saat pengisian wajib diisi.' });
      if (fuelFilled === null || fuelFilled <= 0) return res.status(400).json({ error: 'Volume Fuel diisikan harus lebih besar dari 0 liter.' });
      const shiftResult = await client.query(`SELECT nama_shift, ${fuelShiftOrderSql('shifts')} AS shift_order FROM shifts WHERE id=$1 LIMIT 1`, [shift_id]);
      if (!shiftResult.rows.length) return res.status(400).json({ error: 'Shift tidak ditemukan.' });
      const isMeterReset = parseBooleanInput(body.is_meter_reset);
      const context = await getFuelReadingContext(client, {
        tanggal, shiftId: shift_id, equipmentId: equipment_id, logId: null,
        shiftOrder: Number(shiftResult.rows[0].shift_order),
      });
      if (!context.equipment) return res.status(400).json({ error: 'Kode unit tidak ditemukan.' });
      const metrics = calculateFuelReadingMetrics({
        hmReading, odometerReading, fuelFilled, isMeterReset,
        meterResetReason: body.meter_reset_reason,
      }, context);
      if (metrics.issues.length) return res.status(422).json({ code: metrics.issues[0].code, error: metrics.issues[0].message, validation: metrics });
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const hmStart = Number.isFinite(Number(context.previous?.hm_reading)) ? Number(context.previous.hm_reading) : hmReading;
      await client.query('BEGIN');
      const result = await client.query(`
        INSERT INTO fuel_logs (
          tanggal,shift_id,equipment_id,operator_id,hm_start,hm_finish,total_hm,hm_reading,
          odometer_reading,hm_delta,distance_km,fuel_filled,fuel_remaining,fuel_consumption,
          fuel_per_hm,fuel_per_km,remark,source_type,fuel_ticket_no,record_status,approval_status,
          is_meter_reset,meter_reset_reason,anomaly_status,anomaly_details,attachment_url,created_by,updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$6,$8,$7,$9,$10,0,$10,$11,$12,$13,$14,$15,'draft','draft',$16,$17,$18,$19::jsonb,$20,$21,$21)
        RETURNING *
      `, [
        tanggal, shift_id, equipment_id, operator_id || null, hmStart, hmReading, metrics.hmDelta || 0,
        odometerReading, metrics.distanceKm, fuelFilled, metrics.fuelPerHm, metrics.fuelPerKm,
        String(body.remark || '').trim(), String(body.source_type || 'manual').trim() || 'manual',
        String(body.fuel_ticket_no || '').trim() || null, isMeterReset, String(body.meter_reset_reason || '').trim() || null,
        metrics.anomalyStatus, JSON.stringify({ warnings: metrics.warnings, issues: metrics.issues }),
        String(body.attachment_url || '').trim() || null, actorId,
      ]);
      await writeFuelAudit(client, result.rows[0].id, 'create', null, result.rows[0], actorId);
      await client.query('COMMIT');
      res.status(201).json({ ...result.rows[0], calculation: metrics });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async updateFuelLog(req, res) {
    const client = await pool.connect();
    try {
      const body = req.body || {};
      const beforeResult = await client.query('SELECT * FROM fuel_logs WHERE id=$1 AND deleted_at IS NULL LIMIT 1', [req.params.id]);
      if (!beforeResult.rows.length) return res.status(404).json({ error: 'Log Fuel tidak ditemukan.' });
      const before = beforeResult.rows[0];
      const tanggal = normalizeDateOnly(body.tanggal || before.tanggal);
      const shiftId = body.shift_id || before.shift_id;
      const equipmentId = body.equipment_id || before.equipment_id;
      const hmReading = parseOptionalNonNegativeNumber(body.hm_reading ?? body.hm_finish ?? before.hm_reading ?? before.hm_finish, 'HM aktual');
      const odometerReading = parseOptionalNonNegativeNumber(body.odometer_reading ?? before.odometer_reading, 'KM/Odometer');
      const fuelFilled = parseOptionalNonNegativeNumber(body.fuel_filled ?? before.fuel_filled, 'Fuel diisikan');
      if (hmReading === null || fuelFilled === null || fuelFilled <= 0) return res.status(400).json({ error: 'HM aktual dan volume Fuel wajib diisi.' });
      const shiftResult = await client.query(`SELECT ${fuelShiftOrderSql('shifts')} AS shift_order FROM shifts WHERE id=$1 LIMIT 1`, [shiftId]);
      if (!shiftResult.rows.length) return res.status(400).json({ error: 'Shift tidak ditemukan.' });
      const isMeterReset = body.is_meter_reset === undefined ? Boolean(before.is_meter_reset) : parseBooleanInput(body.is_meter_reset);
      const meterResetReason = body.meter_reset_reason ?? before.meter_reset_reason;
      const context = await getFuelReadingContext(client, {
        tanggal, shiftId, equipmentId, logId: req.params.id,
        shiftOrder: Number(shiftResult.rows[0].shift_order),
      });
      if (!context.equipment) return res.status(400).json({ error: 'Kode unit tidak ditemukan.' });
      const metrics = calculateFuelReadingMetrics({ hmReading, odometerReading, fuelFilled, isMeterReset, meterResetReason }, context);
      if (metrics.issues.length) return res.status(422).json({ code: metrics.issues[0].code, error: metrics.issues[0].message, validation: metrics });
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const hmStart = Number.isFinite(Number(context.previous?.hm_reading)) ? Number(context.previous.hm_reading) : hmReading;
      await client.query('BEGIN');
      const result = await client.query(`
        UPDATE fuel_logs SET tanggal=$1,shift_id=$2,equipment_id=$3,operator_id=$4,
          hm_start=$5,hm_finish=$6,total_hm=$7,hm_reading=$6,odometer_reading=$8,hm_delta=$7,
          distance_km=$9,fuel_filled=$10,fuel_remaining=0,fuel_consumption=$10,fuel_per_hm=$11,
          fuel_per_km=$12,remark=$13,source_type=$14,fuel_ticket_no=$15,record_status='draft',
          approval_status='draft',approved_by=NULL,approved_at=NULL,is_meter_reset=$16,meter_reset_reason=$17,
          anomaly_status=$18,anomaly_details=$19::jsonb,attachment_url=$20,updated_by=$21,updated_at=CURRENT_TIMESTAMP
        WHERE id=$22 AND deleted_at IS NULL RETURNING *
      `, [
        tanggal, shiftId, equipmentId, body.operator_id ?? before.operator_id, hmStart, hmReading, metrics.hmDelta || 0,
        odometerReading, metrics.distanceKm, fuelFilled, metrics.fuelPerHm, metrics.fuelPerKm,
        String(body.remark ?? before.remark ?? '').trim(), String(body.source_type ?? before.source_type ?? 'manual').trim(),
        String(body.fuel_ticket_no ?? before.fuel_ticket_no ?? '').trim() || null, isMeterReset,
        String(meterResetReason || '').trim() || null, metrics.anomalyStatus,
        JSON.stringify({ warnings: metrics.warnings, issues: metrics.issues }), String(body.attachment_url ?? before.attachment_url ?? '').trim() || null,
        actorId, req.params.id,
      ]);
      await writeFuelAudit(client, req.params.id, 'update', before, result.rows[0], actorId);
      await client.query('COMMIT');
      res.json({ ...result.rows[0], calculation: metrics });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async updateFuelApproval(req, res) {
    const client = await pool.connect();
    try {
      const status = String(req.body?.status || '').trim().toLowerCase();
      if (!['draft', 'submitted', 'verified', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status approval tidak valid.' });
      const beforeResult = await client.query('SELECT * FROM fuel_logs WHERE id=$1 AND deleted_at IS NULL LIMIT 1', [req.params.id]);
      if (!beforeResult.rows.length) return res.status(404).json({ error: 'Log Fuel tidak ditemukan.' });
      const actorId = await resolveExistingUserId(client, req.user?.id);
      await client.query('BEGIN');
      const result = await client.query(`UPDATE fuel_logs SET approval_status=$1,
        approved_by=CASE WHEN $1='verified' THEN $2 ELSE NULL END,
        approved_at=CASE WHEN $1='verified' THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_by=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING *`, [status, actorId, req.params.id]);
      await writeFuelAudit(client, req.params.id, `approval:${status}`, beforeResult.rows[0], result.rows[0], actorId);
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(400).json({ error: err.message });
    } finally { client.release(); }
  }

  static async getFuelAudit(req, res) {
    try {
      const result = await pool.query(`SELECT fla.*, u.nama AS changed_by_name FROM fuel_log_audit fla
        LEFT JOIN users u ON u.id=fla.changed_by WHERE fla.fuel_log_id=$1 ORDER BY fla.changed_at DESC LIMIT 100`, [req.params.id]);
      res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  }

  static async deleteFuelLogsBatch(req, res) {
    const client = await pool.connect();
    try {
      const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(value => String(value || '').trim()).filter(Boolean))];
      if (!ids.length) return res.status(400).json({ error: 'Pilih minimal satu Log Fuel.' });
      if (ids.length > 500) return res.status(400).json({ error: 'Maksimal 500 Log Fuel dalam satu proses hapus.' });
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const before = await client.query('SELECT * FROM fuel_logs WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL', [ids]);
      await client.query('BEGIN');
      const result = await client.query(`UPDATE fuel_logs SET deleted_at=CURRENT_TIMESTAMP,updated_by=$2,updated_at=CURRENT_TIMESTAMP WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL RETURNING *`, [ids, actorId]);
      for (const row of before.rows) await writeFuelAudit(client, row.id, 'delete', row, result.rows.find(item => item.id === row.id) || null, actorId);
      await client.query('COMMIT');
      res.json({ success: true, deleted: result.rowCount, ids: result.rows.map(row => row.id) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(400).json({ error: err.message });
    } finally { client.release(); }
  }

  static async restoreFuelLogsBatch(req, res) {
    const client = await pool.connect();
    try {
      const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(value => String(value || '').trim()).filter(Boolean))];
      if (!ids.length) return res.status(400).json({ error: 'Tidak ada Log Fuel untuk dipulihkan.' });
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const before = await client.query('SELECT * FROM fuel_logs WHERE id=ANY($1::uuid[]) AND deleted_at IS NOT NULL', [ids]);
      await client.query('BEGIN');
      const result = await client.query(`UPDATE fuel_logs SET deleted_at=NULL,updated_by=$2,updated_at=CURRENT_TIMESTAMP WHERE id=ANY($1::uuid[]) AND deleted_at IS NOT NULL RETURNING *`, [ids, actorId]);
      for (const row of before.rows) await writeFuelAudit(client, row.id, 'restore', row, result.rows.find(item => item.id === row.id) || null, actorId);
      await client.query('COMMIT');
      res.json({ success: true, restored: result.rowCount, ids: result.rows.map(row => row.id) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(400).json({ error: err.message });
    } finally { client.release(); }
  }

  // =========================================================
  // 3. STANDBY
  // =========================================================
  static async getStandbyLogs(req, res) {
    try {
      const calendarToday = jakartaDateParts(new Date()).date;
      const defaultDate = addOperationalDays(calendarToday, -1);
      const fromDate = normalizeDateOnly(req.query.from || req.query.tanggal || defaultDate, 'Periode awal');
      const toDate = normalizeDateOnly(req.query.to || req.query.tanggal || fromDate, 'Periode akhir');
      if (toDate < fromDate) throw new Error('Periode akhir tidak boleh lebih awal dari periode awal.');
      const requestedDays = Math.round((operationalDayBounds(toDate).start - operationalDayBounds(fromDate).start) / 86400000) + 1;
      if (requestedDays > 366) throw new Error('Rentang Standby maksimal 366 hari.');
      const fromTs = operationalDayBounds(fromDate).start;
      const toTs = operationalDayBounds(addOperationalDays(toDate, 1)).start;
      const params = [fromTs.toISOString(), toTs.toISOString()];
      const filters = [];
      const addFilter = (sql, value) => {
        if (value === undefined || value === null || String(value).trim() === '') return;
        params.push(String(value).trim());
        filters.push(sql.replace('?', `$${params.length}`));
      };
      addFilter('e.kelas_alat = ?', req.query.jenis_unit);
      addFilter("COALESCE(e.class_unit,'') = ?", req.query.class_unit);
      addFilter('sl.equipment_id = ?::uuid', req.query.equipment_id);
      addFilter('sl.standby_code_id = ?::uuid', req.query.standby_code_id);
      addFilter('sl.review_status = ?', req.query.review_status);
      addFilter('sl.source_type = ?', req.query.source_type);
      addFilter('sl.lifecycle_status = ?', req.query.lifecycle_status);
      const result = await pool.query(`
        SELECT sl.*, e.kode_alat, e.kelas_alat, e.class_unit, e.tipe_alat,
               msc.kode AS kode_standby, msc.kategori AS kategori_standby,
               msc.is_system AS kode_is_system, msc.is_locked AS kode_is_locked,
               msc.planning_type,msc.control_class,msc.owner_department,
               msc.requires_description,msc.requires_evidence,
               s.nama_shift, creator.nama AS created_by_name, reviewer.nama AS reviewed_by_name,
               GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(sl.finish_time,now())-sl.start_time))/3600)::float AS raw_duration_hours,
               audit.items AS audit_history
        FROM standby_logs sl
        JOIN equipment e ON sl.equipment_id = e.id
        JOIN master_standby_codes msc ON sl.standby_code_id = msc.id
        LEFT JOIN shifts s ON sl.shift_id = s.id
        LEFT JOIN users creator ON creator.id=sl.created_by
        LEFT JOIN users reviewer ON reviewer.id=sl.reviewed_by
        LEFT JOIN LATERAL (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'action',a.action,'changed_at',a.changed_at,'changed_by_name',u.nama,
            'before_data',a.before_data,'after_data',a.after_data
          ) ORDER BY a.changed_at DESC),'[]'::jsonb) AS items
          FROM standby_log_audit a LEFT JOIN users u ON u.id=a.changed_by
          WHERE a.standby_log_id=sl.id
        ) audit ON TRUE
        WHERE sl.deleted_at IS NULL
          AND sl.start_time < $2::timestamptz
          AND COALESCE(sl.finish_time,now()) > $1::timestamptz
          ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
        ORDER BY sl.start_time DESC
        LIMIT 5000
      `, params);
      const shifts = await pool.query(`SELECT id,nama_shift FROM shifts WHERE LOWER(nama_shift) LIKE '%siang%' OR LOWER(nama_shift) LIKE '%malam%' ORDER BY nama_shift`);
      const shiftIds = {};
      shifts.rows.forEach(shift => {
        if (/siang/i.test(shift.nama_shift)) shiftIds.siang = shift.id;
        if (/malam/i.test(shift.nama_shift)) shiftIds.malam = shift.id;
      });
      let slices = result.rows.flatMap(row => splitStandbyIntoOperationalSlices(row, fromDate, toDate, shiftIds));
      if (req.query.shift_id) slices = slices.filter(slice => String(slice.shift_id) === String(req.query.shift_id));
      const activeResult = await pool.query(`
        SELECT sl.*,e.kode_alat,e.kelas_alat,e.class_unit,e.tipe_alat,msc.kode AS kode_standby,msc.kategori AS kategori_standby,
               GREATEST(0,EXTRACT(EPOCH FROM (now()-sl.start_time))/3600)::float AS raw_duration_hours
        FROM standby_logs sl JOIN equipment e ON e.id=sl.equipment_id
        JOIN master_standby_codes msc ON msc.id=sl.standby_code_id
        WHERE sl.deleted_at IS NULL AND sl.lifecycle_status='open'
        ORDER BY sl.start_time
      `);
      const controls = await buildStandbyMohhControls(pool, { fromDate, toDate, slices, shiftIds });
      const paretoCodeMap = new Map();
      const paretoUnitMap = new Map();
      slices.forEach(row => {
        const hours = Math.max(0, Number(row.counted_hours || 0));
        if (!hours) return;
        const codeKey = String(row.standby_code_id);
        const codeItem = paretoCodeMap.get(codeKey) || {
          standby_code_id: row.standby_code_id, kode: row.kode_standby, kategori: row.kategori_standby,
          planning_type: row.planning_type || 'unplanned', control_class: row.control_class || 'controllable',
          owner_department: row.owner_department || 'Production', hours: 0, events: new Set(), units: new Set()
        };
        codeItem.hours += hours; codeItem.events.add(String(row.standby_log_id)); codeItem.units.add(String(row.equipment_id));
        paretoCodeMap.set(codeKey, codeItem);
        const unitKey = String(row.equipment_id);
        const unitItem = paretoUnitMap.get(unitKey) || { equipment_id: row.equipment_id, kode_alat: row.kode_alat, kelas_alat: row.kelas_alat, class_unit: row.class_unit, hours: 0, events: new Set() };
        unitItem.hours += hours; unitItem.events.add(String(row.standby_log_id)); paretoUnitMap.set(unitKey, unitItem);
      });
      const paretoByCode = [...paretoCodeMap.values()].map(item => ({ ...item, events: item.events.size, units: item.units.size })).sort((a, b) => b.hours - a.hours);
      const paretoByUnit = [...paretoUnitMap.values()].map(item => ({ ...item, events: item.events.size })).sort((a, b) => b.hours - a.hours);
      const controlSummary = controls.reduce((summary, control) => {
        summary.total += 1;
        summary[control.status] = (summary[control.status] || 0) + 1;
        if (control.issues.length) summary.withIssues += 1;
        if (control.closure?.status === 'closed') summary.closed += 1;
        return summary;
      }, { total: 0, balanced: 0, under: 0, over: 0, missing_hm: 0, conflict: 0, stale: 0, closed: 0, withIssues: 0 });
      const countedHours = slices.reduce((sum, row) => sum + Number(row.counted_hours || 0), 0);
      res.json({
        logs: result.rows,
        slices,
        active: activeResult.rows,
        controls,
        dataQuality: controls.filter(control => control.issues.length > 0),
        pareto: { byCode: paretoByCode, byUnit: paretoByUnit },
        period: { from: fromDate, to: toDate, days: requestedDays, timezone: 'Asia/Jakarta', shiftBoundary: '06:00' },
        summary: {
          totalHours: countedHours,
          totalEvents: new Set(slices.filter(row => Number(row.counted_hours) > 0).map(row => String(row.standby_log_id))).size,
          affectedUnits: new Set(slices.filter(row => Number(row.counted_hours) > 0).map(row => String(row.equipment_id))).size,
          pendingReview: new Set(slices.filter(row => row.review_status === 'pending').map(row => String(row.standby_log_id))).size,
          reclassifiedEvents: new Set(slices.filter(row => row.lifecycle_status === 'reclassified').map(row => String(row.standby_log_id))).size,
          mohh: controlSummary
        }
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  static async getStandbyHistory(req, res) {
    const calendarToday = jakartaDateParts(new Date()).date;
    req.query.from = req.query.from || addOperationalDays(calendarToday, -30);
    req.query.to = req.query.to || calendarToday;
    return ProductionController.getStandbyLogs(req, res);
  }

  static async getStandbyReviewQueue(req, res) {
    req.query.review_status = req.query.review_status || 'pending';
    const calendarToday = jakartaDateParts(new Date()).date;
    req.query.from = req.query.from || addOperationalDays(calendarToday, -30);
    req.query.to = req.query.to || calendarToday;
    return ProductionController.getStandbyLogs(req, res);
  }

  static async createStandbyLog(req, res) {
    const client = await pool.connect();
    try {
      const { tanggal, shift_id, equipment_id, standby_code_id, description, start_time, finish_time } = req.body;
      if (!tanggal || !shift_id || !equipment_id || !standby_code_id || !start_time || !finish_time) {
        throw new Error('Tanggal, Shift, Unit, Kode Standby, Jam Mulai, dan Jam Selesai wajib diisi.');
      }
      const start = new Date(start_time);
      const finish = new Date(finish_time);
      if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime()) || finish <= start) throw new Error('Rentang waktu standby tidak valid.');
      const userId = await resolveExistingUserId(client, req.user?.id);
      await client.query('BEGIN');
      const derivedDate = operationalDateForInstant(start);
      const derivedShift = await resolveOperationalShift(client, start);
      if (normalizeDateOnly(tanggal) !== derivedDate || String(shift_id) !== String(derivedShift.id)) {
        throw new Error(`Tanggal/shift harus mengikuti waktu mulai: ${derivedDate}, ${derivedShift.nama_shift}.`);
      }
      await assertStandbyShiftNotClosed(client, derivedDate, derivedShift.id, equipment_id);
      const code = await client.query('SELECT is_system,is_locked,requires_description FROM master_standby_codes WHERE id=$1 AND deleted_at IS NULL', [standby_code_id]);
      if (!code.rows.length) throw new Error('Kode standby tidak ditemukan.');
      if (code.rows[0].is_system || code.rows[0].is_locked) {
        const forbidden = new Error('Kode STB-SYS-01 hanya dapat dibuat otomatis oleh workflow Breakdown.');
        forbidden.statusCode = 403;
        throw forbidden;
      }
      if (code.rows[0].requires_description && !String(description || '').trim()) throw new Error('Keterangan wajib diisi untuk kode Standby terpilih.');
      await assertNoStandbyOverlap(client, equipment_id, start, finish);
      const totalHours = calculateIntervalHours(start, finish);
      const result = await client.query(`
        INSERT INTO standby_logs (
          tanggal, shift_id, equipment_id, standby_code_id, description, start_time, finish_time,
          total_standby_hours, created_by, updated_by, source_type, lifecycle_status, review_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'manual','confirmed','pending')
        RETURNING *
      `, [normalizeDateOnly(tanggal), shift_id, equipment_id, standby_code_id, description || '', start.toISOString(), finish.toISOString(), totalHours, userId]);
      await writeStandbyAudit(client, result.rows[0].id, 'create', null, result.rows[0], userId);
      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async createStandbyLogsBatch(req, res) {
    const client = await pool.connect();
    try {
      const tanggal = normalizeDateOnly(req.body?.tanggal, 'Tanggal operasional');
      const shiftId = String(req.body?.shift_id || '').trim();
      const description = String(req.body?.description || '').trim();
      const records = Array.isArray(req.body?.records) ? req.body.records : [];
      if (!shiftId || !records.length) throw new Error('Tanggal, shift, dan minimal satu isian standby wajib dipilih.');
      if (records.length > 500) throw new Error('Maksimal 500 isian standby dalam satu proses Multi Unit.');

      const shiftResult = await client.query('SELECT id,nama_shift FROM shifts WHERE id=$1 LIMIT 1', [shiftId]);
      if (!shiftResult.rows.length) throw new Error('Master shift tidak ditemukan.');
      const shiftName = String(shiftResult.rows[0].nama_shift || '');
      const shiftKind = /siang/i.test(shiftName) ? 'siang' : (/malam/i.test(shiftName) ? 'malam' : null);
      if (!shiftKind) throw new Error('Multi Unit hanya mendukung Shift Siang dan Shift Malam.');

      const normalized = records.map((record, index) => {
        const equipmentId = String(record?.equipment_id || '').trim();
        const standbyCodeId = String(record?.standby_code_id || '').trim();
        if (!equipmentId || !standbyCodeId || !record?.start_time || !record?.finish_time) {
          throw new Error(`Isian ke-${index + 1} belum memiliki unit, kode, jam mulai, atau jam selesai.`);
        }
        const window = validateStandbyBatchWindow(tanggal, shiftKind, record.start_time, record.finish_time);
        return {
          equipmentId,
          standbyCodeId,
          start: window.start,
          finish: window.finish,
          totalHours: window.totalHours,
          description: String(record?.description || description || '').trim()
        };
      });
      const duplicatePairs = new Set();
      normalized.forEach(record => {
        const key = `${record.equipmentId}:${record.standbyCodeId}`;
        if (duplicatePairs.has(key)) throw new Error('Satu unit hanya boleh memiliki satu rentang untuk setiap kode standby dalam satu batch.');
        duplicatePairs.add(key);
      });

      const equipmentIds = [...new Set(normalized.map(record => record.equipmentId))];
      const codeIds = [...new Set(normalized.map(record => record.standbyCodeId))];
      await client.query('BEGIN');
      await assertStandbyShiftNotClosed(client, tanggal, shiftId, equipmentIds);
      // Kunci unit dalam urutan stabil agar dua batch bersamaan tidak lolos validasi overlap.
      const equipmentResult = await client.query(`
        SELECT id,kode_alat,kelas_alat FROM equipment
        WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL
        ORDER BY id FOR UPDATE
      `, [equipmentIds]);
      const codeResult = await client.query(`
        SELECT id,kode,kategori,is_system,is_locked,requires_description FROM master_standby_codes
        WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL
      `, [codeIds]);
      if (equipmentResult.rows.length !== equipmentIds.length) throw new Error('Satu atau lebih unit tidak ditemukan pada List Equipment.');
      if (codeResult.rows.length !== codeIds.length) throw new Error('Satu atau lebih kode standby tidak ditemukan.');
      if (codeResult.rows.some(code => code.is_system || code.is_locked)) {
        const forbidden = new Error('Kode STB-SYS-01 tidak dapat digunakan pada input Multi Unit.');
        forbidden.statusCode = 403;
        throw forbidden;
      }
      const equipmentMap = new Map(equipmentResult.rows.map(row => [String(row.id), row]));
      const codeMap = new Map(codeResult.rows.map(row => [String(row.id), row]));
      const actorId = await resolveExistingUserId(client, req.user?.id);

      const inserted = [];
      const skipped = [];
      for (const record of normalized) {
        const equipment = equipmentMap.get(record.equipmentId);
        const code = codeMap.get(record.standbyCodeId);
        if (code?.requires_description && !record.description) throw new Error(`${code.kode}: keterangan wajib diisi.`);
        try {
          await assertNoStandbyOverlap(client, record.equipmentId, record.start, record.finish);
        } catch (error) {
          if (error.statusCode !== 409) throw error;
          skipped.push({
            equipment_id: record.equipmentId,
            standby_code_id: record.standbyCodeId,
            kode_alat: equipment?.kode_alat || 'Unit',
            kode_standby: code?.kode || 'Kode',
            reason: error.message
          });
          continue;
        }
        const result = await client.query(`
          INSERT INTO standby_logs (
            tanggal,shift_id,equipment_id,standby_code_id,description,start_time,finish_time,
            total_standby_hours,created_by,updated_by,source_type,lifecycle_status,review_status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'manual_batch','confirmed','pending')
          RETURNING *
        `, [tanggal, shiftId, record.equipmentId, record.standbyCodeId, record.description,
          record.start.toISOString(), record.finish.toISOString(), record.totalHours, actorId]);
        await writeStandbyAudit(client, result.rows[0].id, 'batch_create', null, result.rows[0], actorId);
        inserted.push({ ...result.rows[0], kode_alat: equipment?.kode_alat, kode_standby: code?.kode });
      }
      if (!inserted.length) {
        const conflictNames = skipped.slice(0, 5).map(item => `${item.kode_alat} / ${item.kode_standby}`).join(', ');
        const conflict = new Error(`Seluruh ${skipped.length} record bertumpang tindih dengan data Standby yang sudah ada${conflictNames ? ` (${conflictNames}${skipped.length > 5 ? ', …' : ''})` : ''}. Ubah jam atau unit yang dipilih.`);
        conflict.statusCode = 409;
        conflict.skipped = skipped;
        throw conflict;
      }
      await client.query('COMMIT');
      console.info('[standby:batch] saved', {
        actor_id: req.user?.id || null,
        tanggal,
        shift_id: shiftId,
        requested: normalized.length,
        inserted: inserted.length,
        skipped: skipped.length
      });
      res.status(201).json({ success: true, inserted: inserted.length, skipped, logs: inserted });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.warn('[standby:batch] rejected', {
        actor_id: req.user?.id || null,
        tanggal: req.body?.tanggal || null,
        shift_id: req.body?.shift_id || null,
        requested: Array.isArray(req.body?.records) ? req.body.records.length : 0,
        error: err.message
      });
      res.status(err.statusCode || 400).json({ error: err.message, skipped: err.skipped || [] });
    } finally {
      client.release();
    }
  }

  static async updateStandbyLog(req, res) {
    const client = await pool.connect();
    try {
      const { tanggal, shift_id, equipment_id, standby_code_id, description, start_time, finish_time } = req.body;
      if (!tanggal || !shift_id || !equipment_id || !standby_code_id || !start_time || !finish_time) {
        return res.status(400).json({ error: 'Tanggal, Shift, Unit, Kode Standby, Jam Mulai, dan Jam Selesai wajib diisi.' });
      }
      const start = new Date(start_time);
      const finish = new Date(finish_time);
      if (isNaN(start.getTime()) || isNaN(finish.getTime())) {
        return res.status(400).json({ error: 'Format jam mulai/selesai tidak valid.' });
      }
      if (finish <= start) throw new Error('Jam selesai harus lebih akhir dari jam mulai.');
      const actorId = await resolveExistingUserId(client, req.user?.id);
      await client.query('BEGIN');
      const derivedDate = operationalDateForInstant(start);
      const derivedShift = await resolveOperationalShift(client, start);
      if (normalizeDateOnly(tanggal) !== derivedDate || String(shift_id) !== String(derivedShift.id)) {
        throw new Error(`Tanggal/shift harus mengikuti waktu mulai: ${derivedDate}, ${derivedShift.nama_shift}.`);
      }
      const before = await client.query('SELECT * FROM standby_logs WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
      if (!before.rows.length) throw new Error('Standby log tidak ditemukan.');
      await assertStandbyShiftNotClosed(client, before.rows[0].tanggal, before.rows[0].shift_id, before.rows[0].equipment_id);
      await assertStandbyShiftNotClosed(client, derivedDate, derivedShift.id, equipment_id);
      if (before.rows[0].is_system_generated) {
        const forbidden = new Error('Standby verifikasi dibuat sistem dan tidak dapat diedit manual.');
        forbidden.statusCode = 403;
        throw forbidden;
      }
      if (before.rows[0].review_status === 'approved') throw new Error('Standby yang telah disetujui harus dikembalikan melalui Review sebelum dikoreksi.');
      const code = await client.query('SELECT is_system,is_locked,requires_description FROM master_standby_codes WHERE id=$1 AND deleted_at IS NULL', [standby_code_id]);
      if (!code.rows.length || code.rows[0].is_system || code.rows[0].is_locked) throw new Error('Kode standby manual tidak valid.');
      if (code.rows[0].requires_description && !String(description || '').trim()) throw new Error('Keterangan wajib diisi untuk kode Standby terpilih.');
      await assertNoStandbyOverlap(client, equipment_id, start, finish, req.params.id);
      const totalHours = calculateIntervalHours(start, finish);
      const result = await client.query(`
        UPDATE standby_logs SET
          tanggal = $1,
          shift_id = $2,
          equipment_id = $3,
          standby_code_id = $4,
          description = $5,
          start_time = $6,
          finish_time = $7,
          total_standby_hours = $8,
          review_status = 'pending', reviewed_by=NULL, reviewed_at=NULL, review_note=NULL,
          updated_by=$10, updated_at=CURRENT_TIMESTAMP
        WHERE id = $9 AND deleted_at IS NULL
        RETURNING *
      `, [normalizeDateOnly(tanggal), shift_id, equipment_id, standby_code_id, description || '', start.toISOString(), finish.toISOString(), totalHours, req.params.id, actorId]);
      if (!result.rows.length) return res.status(404).json({ error: 'Standby log tidak ditemukan.' });
      await writeStandbyAudit(client, result.rows[0].id, 'update', before.rows[0], result.rows[0], actorId);
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async updateStandbyLogsSession(req, res) {
    const client = await pool.connect();
    try {
      const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
      if (!changes.length) throw new Error('Tidak ada perubahan Standby untuk disimpan.');
      if (changes.length > 200) throw new Error('Maksimal 200 record Standby dalam satu sesi edit.');
      const ids = changes.map(item => String(item?.id || '').trim());
      if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('ID record Standby dalam sesi tidak valid atau duplikat.');

      await client.query('BEGIN');
      const beforeResult = await client.query(`
        SELECT sl.*,to_char(sl.tanggal,'YYYY-MM-DD') AS operational_date_text,s.nama_shift,e.kode_alat
        FROM standby_logs sl
        LEFT JOIN shifts s ON s.id=sl.shift_id
        LEFT JOIN equipment e ON e.id=sl.equipment_id
        WHERE sl.id=ANY($1::uuid[]) AND sl.deleted_at IS NULL
        ORDER BY sl.id FOR UPDATE OF sl
      `, [ids]);
      if (beforeResult.rows.length !== ids.length) throw new Error('Satu atau lebih record Standby tidak ditemukan atau sudah dihapus.');
      const beforeMap = new Map(beforeResult.rows.map(row => [String(row.id), row]));

      for (const row of beforeResult.rows) {
        await assertStandbyShiftNotClosed(client, row.operational_date_text, row.shift_id, row.equipment_id);
      }

      const equipmentIds = [...new Set(beforeResult.rows.map(row => String(row.equipment_id)))];
      await client.query(`SELECT id FROM equipment WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [equipmentIds]);
      const codeIds = [...new Set(changes.map(item => String(item?.standby_code_id || '').trim()))];
      if (codeIds.some(id => !id)) throw new Error('Kode Standby wajib dipilih pada seluruh perubahan.');
      const codeResult = await client.query(`
        SELECT id,kode,is_system,is_locked,requires_description FROM master_standby_codes
        WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL
      `, [codeIds]);
      if (codeResult.rows.length !== codeIds.length || codeResult.rows.some(code => code.is_system || code.is_locked)) {
        const forbidden = new Error('Sesi edit hanya dapat menggunakan kode standby manual yang aktif.');
        forbidden.statusCode = 403;
        throw forbidden;
      }
      const sessionCodeMap = new Map(codeResult.rows.map(code => [String(code.id), code]));

      const normalized = changes.map((change, index) => {
        const before = beforeMap.get(ids[index]);
        if (before.is_system_generated || before.kode_is_system || before.kode_is_locked) {
          const forbidden = new Error(`${before.kode_alat || 'Unit'}: record Standby sistem tidak dapat diedit manual.`);
          forbidden.statusCode = 403;
          throw forbidden;
        }
        if (before.lifecycle_status !== 'confirmed') throw new Error(`${before.kode_alat || 'Unit'}: hanya Standby berstatus Tercatat yang dapat diedit.`);
        if (before.review_status === 'approved') throw new Error(`${before.kode_alat || 'Unit'}: kembalikan approval melalui Review sebelum mengoreksi record.`);
        const shiftKind = /siang/i.test(before.nama_shift || '') ? 'siang' : (/malam/i.test(before.nama_shift || '') ? 'malam' : null);
        if (!shiftKind) throw new Error(`${before.kode_alat || 'Unit'}: master shift record tidak valid.`);
        const window = validateStandbyBatchWindow(before.operational_date_text, shiftKind, change.start_time, change.finish_time);
        if (sessionCodeMap.get(String(change.standby_code_id))?.requires_description && !String(change.description || '').trim()) {
          throw new Error(`${before.kode_alat || 'Unit'}: keterangan wajib diisi untuk kode Standby terpilih.`);
        }
        return {
          id: ids[index],
          before,
          equipmentId: String(before.equipment_id),
          standbyCodeId: String(change.standby_code_id),
          description: String(change.description || '').trim(),
          start: window.start,
          finish: window.finish,
          totalHours: window.totalHours
        };
      });

      assertStandbySessionIntervals(normalized);
      for (const record of normalized) {
        await assertNoStandbyOverlapOutsideSession(client, record.equipmentId, record.start, record.finish, ids);
      }

      const actorId = await resolveExistingUserId(client, req.user?.id);
      const updated = [];
      for (const record of normalized) {
        const result = await client.query(`
          UPDATE standby_logs SET
            standby_code_id=$2,description=$3,start_time=$4,finish_time=$5,total_standby_hours=$6,
            review_status='pending',reviewed_by=NULL,reviewed_at=NULL,review_note=NULL,
            updated_by=$7,updated_at=CURRENT_TIMESTAMP
          WHERE id=$1 AND deleted_at IS NULL RETURNING *
        `, [record.id, record.standbyCodeId, record.description, record.start.toISOString(), record.finish.toISOString(), record.totalHours, actorId]);
        await writeStandbyAudit(client, record.id, 'session_update', record.before, result.rows[0], actorId);
        updated.push(result.rows[0]);
      }
      await client.query('COMMIT');
      console.info('[standby:session-update] saved', { actor_id: req.user?.id || null, updated: updated.length, ids });
      res.json({ success: true, updated: updated.length, logs: updated });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.warn('[standby:session-update] rejected', {
        actor_id: req.user?.id || null,
        requested: Array.isArray(req.body?.changes) ? req.body.changes.length : 0,
        error: err.message
      });
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async deleteStandbyLogsBatch(req, res) {
    const client = await pool.connect();
    try {
      const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(value => String(value || '').trim()).filter(Boolean))];
      if (!ids.length) throw new Error('Pilih minimal satu record Standby untuk dihapus.');
      if (ids.length > 500) throw new Error('Maksimal 500 record Standby dalam satu proses hapus.');
      await client.query('BEGIN');
      const beforeResult = await client.query(`
        SELECT sl.*,e.kode_alat,msc.kode AS kode_standby,
               msc.is_system AS code_is_system,msc.is_locked AS code_is_locked
        FROM standby_logs sl
        LEFT JOIN equipment e ON e.id=sl.equipment_id
        LEFT JOIN master_standby_codes msc ON msc.id=sl.standby_code_id
        WHERE sl.id=ANY($1::uuid[]) AND sl.deleted_at IS NULL
        ORDER BY sl.id FOR UPDATE OF sl
      `, [ids]);
      if (beforeResult.rows.length !== ids.length) throw new Error('Satu atau lebih record Standby tidak ditemukan atau sudah dihapus.');
      for (const row of beforeResult.rows) {
        await assertStandbyShiftNotClosed(client, row.tanggal, row.shift_id, row.equipment_id);
      }
      beforeResult.rows.forEach(assertStandbyLogDeletable);
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const result = await client.query(`
        UPDATE standby_logs SET deleted_at=CURRENT_TIMESTAMP,updated_by=$2,updated_at=CURRENT_TIMESTAMP
        WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL RETURNING *
      `, [ids, actorId]);
      for (const before of beforeResult.rows) {
        const after = result.rows.find(row => String(row.id) === String(before.id)) || null;
        await writeStandbyAudit(client, before.id, 'batch_delete', before, after, actorId);
      }
      await client.query('COMMIT');
      console.info('[standby:batch-delete] saved', { actor_id: req.user?.id || null, deleted: result.rowCount, ids });
      res.json({ success: true, deleted: result.rowCount, ids: result.rows.map(row => row.id) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.warn('[standby:batch-delete] rejected', {
        actor_id: req.user?.id || null,
        requested: Array.isArray(req.body?.ids) ? req.body.ids.length : 0,
        error: err.message
      });
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async reviewStandbyLog(req, res) {
    const client = await pool.connect();
    try {
      const reviewStatus = String(req.body?.status || '').trim().toLowerCase();
      const note = String(req.body?.note || '').trim() || null;
      if (!STANDBY_REVIEW_STATUSES.has(reviewStatus) || reviewStatus === 'pending') throw new Error('Hasil review Standby tidak valid.');
      if (reviewStatus === 'returned' && !note) throw new Error('Catatan wajib diisi saat Standby dikembalikan.');
      const actorId = await resolveExistingUserId(client, req.user?.id);
      if (!actorId) throw new Error('User reviewer tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');
      const before = await client.query('SELECT * FROM standby_logs WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
      if (!before.rows.length) throw new Error('Standby log tidak ditemukan.');
      assertIndependentStandbyReviewer(before.rows[0].created_by, actorId);
      const result = await client.query(`
        UPDATE standby_logs SET review_status=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,
          review_note=$4,updated_by=$3,updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING *
      `, [req.params.id, reviewStatus, actorId, note]);
      await writeStandbyAudit(client, req.params.id, `review_${reviewStatus}`, before.rows[0], result.rows[0], actorId);
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async closeStandbyShift(req, res) {
    const client = await pool.connect();
    try {
      const operationalDate = normalizeDateOnly(req.body?.operational_date, 'Tanggal operasional');
      const shiftId = String(req.body?.shift_id || '').trim();
      const equipmentId = String(req.body?.equipment_id || '').trim();
      const note = String(req.body?.note || '').trim() || null;
      if (!shiftId || !equipmentId) throw new Error('Shift dan unit wajib dipilih untuk Tutup Shift.');
      await client.query('BEGIN');
      await client.query('SELECT id FROM equipment WHERE id=$1 FOR UPDATE', [equipmentId]);
      const control = await loadStandbyMohhControl(client, operationalDate, shiftId, equipmentId);
      if (!control) throw new Error('Data HM/Breakdown/Standby unit pada shift ini belum tersedia.');
      if (!control.canClose) {
        const detail = control.issues.map(issue => issue.message).join(' ');
        const invalid = new Error(`Shift belum dapat ditutup. ${detail || 'MOHH belum tepat 12 jam.'}`);
        invalid.statusCode = 422;
        invalid.control = control;
        throw invalid;
      }
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const result = await client.query(`
        INSERT INTO standby_shift_closures (
          operational_date,shift_id,equipment_id,status,target_mohh_hours,hm_hours_snapshot,
          breakdown_hours_snapshot,standby_hours_snapshot,accounted_hours_snapshot,balance_hours_snapshot,
          close_note,closed_by,closed_at,reopened_by,reopened_at,reopen_reason,updated_at
        ) VALUES ($1,$2,$3,'closed',$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP,NULL,NULL,NULL,CURRENT_TIMESTAMP)
        ON CONFLICT (operational_date,shift_id,equipment_id) DO UPDATE SET
          status='closed',target_mohh_hours=EXCLUDED.target_mohh_hours,hm_hours_snapshot=EXCLUDED.hm_hours_snapshot,
          breakdown_hours_snapshot=EXCLUDED.breakdown_hours_snapshot,standby_hours_snapshot=EXCLUDED.standby_hours_snapshot,
          accounted_hours_snapshot=EXCLUDED.accounted_hours_snapshot,balance_hours_snapshot=EXCLUDED.balance_hours_snapshot,
          close_note=EXCLUDED.close_note,closed_by=EXCLUDED.closed_by,closed_at=CURRENT_TIMESTAMP,
          reopened_by=NULL,reopened_at=NULL,reopen_reason=NULL,updated_at=CURRENT_TIMESTAMP
        RETURNING *
      `, [operationalDate, shiftId, equipmentId, control.targetHours, control.hmHours, control.breakdownHours,
        control.standbyHours, control.accountedHours, control.balanceHours, note, actorId]);
      await client.query(`INSERT INTO standby_shift_closure_audit (closure_id,action,snapshot,note,changed_by) VALUES ($1,'close',$2::jsonb,$3,$4)`,
        [result.rows[0].id, JSON.stringify(control), note, actorId]);
      await client.query('COMMIT');
      res.json({ success: true, closure: result.rows[0], control: { ...control, status: 'closed' } });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message, control: err.control || null });
    } finally { client.release(); }
  }

  static async reopenStandbyShift(req, res) {
    const client = await pool.connect();
    try {
      const operationalDate = normalizeDateOnly(req.body?.operational_date, 'Tanggal operasional');
      const shiftId = String(req.body?.shift_id || '').trim();
      const equipmentId = String(req.body?.equipment_id || '').trim();
      const reason = String(req.body?.reason || '').trim();
      if (!shiftId || !equipmentId || !reason) throw new Error('Shift, unit, dan alasan buka kembali wajib diisi.');
      const actorId = await resolveExistingUserId(client, req.user?.id);
      await client.query('BEGIN');
      const result = await client.query(`
        UPDATE standby_shift_closures SET status='reopened',reopened_by=$4,reopened_at=CURRENT_TIMESTAMP,
          reopen_reason=$5,updated_at=CURRENT_TIMESTAMP
        WHERE operational_date=$1::date AND shift_id=$2 AND equipment_id=$3 AND status='closed'
        RETURNING *
      `, [operationalDate, shiftId, equipmentId, actorId, reason]);
      if (!result.rows.length) throw new Error('Shift belum ditutup atau sudah dibuka kembali.');
      await client.query(`INSERT INTO standby_shift_closure_audit (closure_id,action,snapshot,note,changed_by) VALUES ($1,'reopen',$2::jsonb,$3,$4)`,
        [result.rows[0].id, JSON.stringify(result.rows[0]), reason, actorId]);
      await client.query('COMMIT');
      res.json({ success: true, closure: result.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally { client.release(); }
  }

  // =========================================================
  // 4. BREAKDOWN (MTBF, MTTR, AVAILABILITY PA/UA)
  // =========================================================
  static async getBreakdownLogs(req, res) {
    try {
      const now = new Date();
      const year = Math.max(2000, Math.min(2100, Number.parseInt(req.query.year, 10) || now.getFullYear()));
      const month = Math.max(1, Math.min(12, Number.parseInt(req.query.month, 10) || (now.getMonth() + 1)));
      const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const periodEndDate = new Date(Date.UTC(year, month, 1));
      const periodEnd = periodEndDate.toISOString().slice(0, 10);
      const periodDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

      const query = `
        SELECT
          bl.*,
          e.kode_alat,
          e.kelas_alat,
          e.class_unit,
          e.tipe_alat,
          mbc.kode AS kode_breakdown,
          mbc.kategori AS kategori_breakdown,
          s.nama_shift,
          reporter.nama AS report_by_name,
          pic.nama AS pic_name,
          completer.nama AS repair_completed_by_name,
          COALESCE(bd_time.hours,0)::float AS elapsed_breakdown_hours,
          CASE WHEN bl.repair_completed_at IS NOT NULL
            THEN GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(bl.finish_time, now()) - bl.repair_completed_at)) / 3600)::float
            ELSE 0::float END AS verification_lead_hours,
          durations.mechanic_progress_hours,
          durations.waiting_part_hours,
          durations.waiting_tool_hours,
          durations.waiting_manpower_hours,
          durations.waiting_vendor_hours,
          parts.items AS parts,
          history.items AS status_history,
          verifications.items AS ready_verifications
        FROM breakdown_logs bl
        LEFT JOIN equipment e ON bl.equipment_id = e.id
        LEFT JOIN master_breakdown_codes mbc ON bl.breakdown_code_id = mbc.id
        LEFT JOIN shifts s ON bl.shift_id = s.id
        LEFT JOIN users reporter ON reporter.id = COALESCE(bl.reported_by, bl.created_by)
        LEFT JOIN users pic ON pic.id = bl.pic_id
        LEFT JOIN users completer ON completer.id = bl.repair_completed_by
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(h.ended_at,now())-h.started_at))/3600)),0) AS hours
          FROM breakdown_status_history h
          WHERE h.breakdown_id=bl.id AND h.counts_as_breakdown=TRUE
        ) bd_time ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'mechanic_progress'), 0)::float AS mechanic_progress_hours,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'waiting_part'), 0)::float AS waiting_part_hours,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'waiting_tool'), 0)::float AS waiting_tool_hours,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'waiting_manpower'), 0)::float AS waiting_manpower_hours,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'waiting_vendor'), 0)::float AS waiting_vendor_hours
          FROM breakdown_status_history h
          WHERE h.breakdown_id = bl.id
        ) durations ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', bp.id, 'part_detail', bp.part_detail, 'po_number', bp.po_number,
            'quantity', bp.quantity, 'po_status', bp.po_status, 'eta_date', bp.eta_date
          ) ORDER BY bp.created_at) FILTER (WHERE bp.id IS NOT NULL), '[]'::jsonb) AS items
          FROM breakdown_parts bp
          WHERE bp.breakdown_id = bl.id AND bp.deleted_at IS NULL
        ) parts ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', h.id, 'status', h.status, 'started_at', h.started_at,
            'ended_at', h.ended_at, 'note', h.note, 'counts_as_breakdown', h.counts_as_breakdown,
            'changed_by_name', changer.nama
          ) ORDER BY h.started_at) FILTER (WHERE h.id IS NOT NULL), '[]'::jsonb) AS items
          FROM breakdown_status_history h
          LEFT JOIN users changer ON changer.id = h.changed_by
          WHERE h.breakdown_id = bl.id
        ) history ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', v.id, 'result', v.result, 'checklist', v.checklist,
            'meter_hm', v.meter_hm, 'location', v.location, 'note', v.note,
            'verified_at', v.verified_at, 'verified_by_name', verifier.nama,
            'rejection_type',v.rejection_type,'standby_log_id',v.standby_log_id,
            'related_breakdown_id',v.related_breakdown_id,'ready_effective_at',v.ready_effective_at
          ) ORDER BY v.verified_at) FILTER (WHERE v.id IS NOT NULL), '[]'::jsonb) AS items
          FROM breakdown_ready_verifications v
          LEFT JOIN users verifier ON verifier.id = v.verified_by
          WHERE v.breakdown_id = bl.id
        ) verifications ON TRUE
        WHERE bl.deleted_at IS NULL
          AND bl.tanggal >= $1::date
          AND bl.tanggal < $2::date
        ORDER BY e.kode_alat, bl.start_time DESC
        LIMIT 500
      `;
      const [result, equipmentSummary, bdSummary] = await Promise.all([
        pool.query(query, [periodStart, periodEnd]),
        pool.query(`SELECT COUNT(*)::int AS total FROM equipment WHERE deleted_at IS NULL`),
        pool.query(`
          WITH bounds AS (
            SELECT
              ($1::date AT TIME ZONE 'Asia/Jakarta') AS from_ts,
              ($2::date AT TIME ZONE 'Asia/Jakarta') AS to_ts
          ), scoped AS (
            SELECT bl.*, bounds.from_ts, bounds.to_ts
            FROM breakdown_logs bl CROSS JOIN bounds
            WHERE bl.deleted_at IS NULL
              AND bl.start_time < bounds.to_ts
              AND COALESCE(bl.finish_time, now()) > bounds.from_ts
          ), breakdown_time AS (
            SELECT scoped.id,COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (
              LEAST(COALESCE(h.ended_at,now()),scoped.to_ts)-GREATEST(h.started_at,scoped.from_ts)
            ))/3600)) FILTER (
              WHERE h.counts_as_breakdown=TRUE AND h.started_at<scoped.to_ts
                AND COALESCE(h.ended_at,now())>scoped.from_ts
            ),0)::float AS hours
            FROM scoped LEFT JOIN breakdown_status_history h ON h.breakdown_id=scoped.id
            GROUP BY scoped.id
          )
          SELECT
            COUNT(*)::int AS total_incidents,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open_incidents,
            COUNT(DISTINCT equipment_id)::int AS affected_units,
            COALESCE(SUM(breakdown_time.hours),0)::float AS total_bd_hours,
            COALESCE(AVG(EXTRACT(EPOCH FROM (repair_completed_at - start_time)) / 3600)
              FILTER (WHERE repair_completed_at IS NOT NULL AND repair_completed_at >= from_ts AND repair_completed_at < to_ts), 0)::float AS mttr_hours
          FROM scoped LEFT JOIN breakdown_time ON breakdown_time.id=scoped.id
        `, [periodStart, periodEnd])
      ]);

      const summary = bdSummary.rows[0] || {};
      const activeUnitCount = Number(equipmentSummary.rows[0]?.total || 0);
      const totalBdHours = Number(summary.total_bd_hours || 0);
      const totalBdCount = Number(summary.total_incidents || 0);
      const calculatedMetrics = calculateBreakdownCalendarMetrics({ periodDays, activeUnitCount, totalBdHours, totalIncidents: totalBdCount, mttrHours: summary.mttr_hours });

      res.json({
        logs: result.rows,
        period: { year, month, days: periodDays, start: periodStart, endExclusive: periodEnd },
        metrics: {
          mttrHours: calculatedMetrics.mttrHours,
          mtbfHours: calculatedMetrics.mtbfHours,
          calendarPa: calculatedMetrics.calendarPa,
          totalBreakdowns: totalBdCount,
          openBreakdowns: Number(summary.open_incidents || 0),
          affectedUnits: Number(summary.affected_units || 0),
          totalBdHours,
          activeUnitCount,
          calendarHours: calculatedMetrics.calendarHours
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getBreakdownHistory(req, res) {
    try {
      const result = await pool.query(`
        SELECT
          bl.id, bl.tanggal, TO_CHAR(bl.tanggal, 'YYYY-MM') AS period_key,
          bl.shift_id, bl.equipment_id, bl.breakdown_code_id,
          bl.description, bl.remark, bl.start_time, bl.finish_time,
          bl.status, bl.current_status, bl.created_at,
          e.kode_alat, e.kelas_alat, e.class_unit, e.tipe_alat,
          mbc.kode AS kode_breakdown, mbc.kategori AS kategori_breakdown,
          s.nama_shift,
          reporter.nama AS report_by_name,
          pic.nama AS pic_name,
          COALESCE(bd_time.hours,0)::float AS elapsed_breakdown_hours,
          durations.mechanic_progress_hours,
          durations.waiting_part_hours,
          durations.waiting_tool_hours,
          durations.waiting_manpower_hours,
          durations.waiting_vendor_hours,
          parts.items AS parts
        FROM breakdown_logs bl
        LEFT JOIN equipment e ON e.id = bl.equipment_id
        LEFT JOIN master_breakdown_codes mbc ON mbc.id = bl.breakdown_code_id
        LEFT JOIN shifts s ON s.id = bl.shift_id
        LEFT JOIN users reporter ON reporter.id = COALESCE(bl.reported_by, bl.created_by)
        LEFT JOIN users pic ON pic.id = bl.pic_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(h.ended_at,now())-h.started_at))/3600)),0) AS hours
          FROM breakdown_status_history h
          WHERE h.breakdown_id=bl.id AND h.counts_as_breakdown=TRUE
        ) bd_time ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'mechanic_progress'), 0)::float AS mechanic_progress_hours,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'waiting_part'), 0)::float AS waiting_part_hours,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'waiting_tool'), 0)::float AS waiting_tool_hours,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'waiting_manpower'), 0)::float AS waiting_manpower_hours,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(h.ended_at, now()) - h.started_at)) / 3600) FILTER (WHERE h.status = 'waiting_vendor'), 0)::float AS waiting_vendor_hours
          FROM breakdown_status_history h
          WHERE h.breakdown_id = bl.id
        ) durations ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', bp.id, 'part_detail', bp.part_detail, 'po_number', bp.po_number,
            'quantity', bp.quantity, 'po_status', bp.po_status, 'eta_date', bp.eta_date
          ) ORDER BY bp.created_at) FILTER (WHERE bp.id IS NOT NULL), '[]'::jsonb) AS items
          FROM breakdown_parts bp
          WHERE bp.breakdown_id = bl.id AND bp.deleted_at IS NULL
        ) parts ON TRUE
        WHERE bl.deleted_at IS NULL
        ORDER BY bl.tanggal DESC, e.kelas_alat, e.kode_alat, bl.start_time DESC
        LIMIT 5000
      `);
      const periods = [...new Set(result.rows.map(row => row.period_key).filter(Boolean))].sort().reverse();
      res.json({ logs: result.rows, periods, total: result.rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createBreakdownLog(req, res) {
    const client = await pool.connect();
    try {
      const { tanggal, shift_id, equipment_id, breakdown_code_id, description, remark, start_time, initial_status, pic_id, parts } = req.body;
      const operationalDate = normalizeDateOnly(tanggal);
      if (!shift_id || !equipment_id || !breakdown_code_id) throw new Error('Tanggal, shift, unit, dan jenis kerusakan wajib diisi.');
      if (!String(description || '').trim()) throw new Error('Deskripsi kerusakan wajib diisi.');
      const start = normalizeBreakdownTimestamp(start_time, 'Waktu mulai breakdown');
      if (start.getTime() > Date.now() + 5 * 60 * 1000) throw new Error('Waktu mulai breakdown tidak boleh berada di masa depan.');
      const initialStatus = normalizeBreakdownStatus(initial_status);
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const picId = await resolveExistingUserId(client, pic_id);

      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(equipment_id)]);
      const activeIncident = await client.query(`
        SELECT id FROM breakdown_logs
        WHERE equipment_id = $1 AND status = 'open' AND deleted_at IS NULL
        LIMIT 1
      `, [equipment_id]);
      if (activeIncident.rows.length) {
        const conflict = new Error('Unit masih memiliki breakdown aktif. Selesaikan insiden tersebut sebelum membuat laporan baru.');
        conflict.statusCode = 409;
        throw conflict;
      }

      const result = await client.query(`
        INSERT INTO breakdown_logs (
          tanggal, shift_id, equipment_id, breakdown_code_id, description, remark,
          start_time, total_breakdown_hours, status, current_status,
          reported_by, pic_id, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,'open',$8,$9,$10,$9,$9)
        RETURNING *
      `, [operationalDate, shift_id, equipment_id, breakdown_code_id, String(description || '').trim(), String(remark || '').trim(), start.toISOString(), initialStatus, actorId, picId]);
      const incident = result.rows[0];
      await client.query(`
        INSERT INTO breakdown_status_history (breakdown_id, status, started_at, note, changed_by)
        VALUES ($1,$2,$3,$4,$5)
      `, [incident.id, initialStatus, start.toISOString(), String(remark || '').trim() || null, actorId]);

      if (initialStatus === 'waiting_part') {
        const partInputs = Array.isArray(parts) && parts.length ? parts : [req.body];
        for (const part of partInputs) await insertBreakdownPart(client, incident.id, part, actorId);
      }

      await client.query("UPDATE equipment SET status_alat = 'Breakdown' WHERE id = $1", [equipment_id]);
      await client.query('COMMIT');

      res.status(201).json(incident);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async updateBreakdownStatus(req, res) {
    const client = await pool.connect();
    try {
      const nextStatus = normalizeBreakdownStatus(req.body.status, { allowResolved: true });
      const changedAt = normalizeBreakdownTimestamp(req.body.changed_at || new Date().toISOString(), 'Waktu perubahan status');
      if (changedAt.getTime() > Date.now() + 5 * 60 * 1000) throw new Error('Waktu perubahan status tidak boleh berada di masa depan.');
      const actorId = await resolveExistingUserId(client, req.user?.id);
      if (!actorId) throw new Error('User penyelesai breakdown tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');

      const incidentResult = await client.query(`
        SELECT * FROM breakdown_logs WHERE id = $1 AND deleted_at IS NULL FOR UPDATE
      `, [req.params.id]);
      const incident = incidentResult.rows[0];
      if (!incident) {
        const missing = new Error('Insiden breakdown tidak ditemukan.');
        missing.statusCode = 404;
        throw missing;
      }
      if (incident.status === 'resolved') throw new Error('Breakdown yang sudah selesai tidak dapat diubah statusnya.');
      if (incident.current_status === 'awaiting_verification') throw new Error('Unit sedang menunggu Verifikasi Ready dan tidak dapat diubah melalui Update Status.');

      const activeSegmentResult = await client.query(`
        SELECT * FROM breakdown_status_history
        WHERE breakdown_id = $1 AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1 FOR UPDATE
      `, [incident.id]);
      const activeSegment = activeSegmentResult.rows[0];
      if (!activeSegment) throw new Error('Histori status aktif tidak ditemukan. Jalankan migrasi Breakdown Workflow terlebih dahulu.');
      if (changedAt < new Date(activeSegment.started_at)) throw new Error('Waktu perubahan tidak boleh lebih awal dari awal status aktif.');
      if (nextStatus === incident.current_status) throw new Error('Status baru sama dengan status yang sedang aktif.');

      await client.query(`UPDATE breakdown_status_history SET ended_at = $2 WHERE id = $1`, [activeSegment.id, changedAt.toISOString()]);
      const note = String(req.body.note || '').trim() || null;

      if (nextStatus === 'resolved') {
        const releaseAttempt = Number(incident.release_attempt || 0) + 1;
        await client.query(`
          INSERT INTO breakdown_status_history (breakdown_id, status, started_at, note, changed_by, counts_as_breakdown)
          VALUES ($1,'awaiting_verification',$2,$3,$4,FALSE)
        `, [incident.id, changedAt.toISOString(), note || 'Perbaikan selesai dan diajukan untuk Verifikasi Ready.', actorId]);
        await client.query(`
          UPDATE breakdown_logs
          SET status = 'open', current_status = 'awaiting_verification', finish_time = NULL,
              repair_completed_at = $2, repair_completed_by = $3,
              release_attempt = $5,
              updated_by = $3, updated_at = now(), pic_id = COALESCE($4, pic_id)
          WHERE id = $1
        `, [incident.id, changedAt.toISOString(), actorId, req.body.pic_id || null, releaseAttempt]);
        await createVerificationStandby(client, incident, changedAt, actorId, releaseAttempt);
      } else {
        await client.query(`
          INSERT INTO breakdown_status_history (breakdown_id, status, started_at, note, changed_by)
          VALUES ($1,$2,$3,$4,$5)
        `, [incident.id, nextStatus, changedAt.toISOString(), note, actorId]);
        await client.query(`
          UPDATE breakdown_logs
          SET current_status = $2, updated_by = $3, updated_at = now(), pic_id = COALESCE($4, pic_id)
          WHERE id = $1
        `, [incident.id, nextStatus, actorId, req.body.pic_id || null]);
        if (nextStatus === 'waiting_part') {
          const partInputs = Array.isArray(req.body.parts) && req.body.parts.length ? req.body.parts : [req.body];
          for (const part of partInputs) await insertBreakdownPart(client, incident.id, part, actorId);
        }
      }

      await client.query('COMMIT');
      res.json({ success: true, id: incident.id, status: nextStatus === 'resolved' ? 'awaiting_verification' : nextStatus });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async verifyBreakdownReady(req, res) {
    const client = await pool.connect();
    try {
      const verification = normalizeReadyVerification(req.body);
      const verifiedAt = normalizeBreakdownTimestamp(req.body.verified_at || new Date().toISOString(), 'Waktu verifikasi');
      if (verifiedAt.getTime() > Date.now() + 5 * 60 * 1000) throw new Error('Waktu verifikasi tidak boleh berada di masa depan.');
      const actorId = await resolveExistingUserId(client, req.user?.id);
      if (!actorId) throw new Error('User validator tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');

      const incidentResult = await client.query(`
        SELECT * FROM breakdown_logs WHERE id = $1 AND deleted_at IS NULL FOR UPDATE
      `, [req.params.id]);
      const incident = incidentResult.rows[0];
      if (!incident) {
        const missing = new Error('Insiden breakdown tidak ditemukan.');
        missing.statusCode = 404;
        throw missing;
      }
      if (incident.status !== 'open' || incident.current_status !== 'awaiting_verification' || !incident.repair_completed_at) {
        throw new Error('Unit tidak sedang menunggu Verifikasi Ready.');
      }
      assertIndependentReadyVerifier(incident.repair_completed_by, actorId);
      const activeSegmentResult = await client.query(`
        SELECT * FROM breakdown_status_history
        WHERE breakdown_id = $1 AND status = 'awaiting_verification' AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1 FOR UPDATE
      `, [incident.id]);
      const activeSegment = activeSegmentResult.rows[0];
      if (!activeSegment) throw new Error('Timeline Menunggu Verifikasi tidak ditemukan. Jalankan migrasi terbaru.');
      if (verifiedAt < new Date(activeSegment.started_at)) throw new Error('Waktu verifikasi tidak boleh lebih awal dari waktu selesai perbaikan.');

      await client.query(`UPDATE breakdown_status_history SET ended_at = $2 WHERE id = $1`, [activeSegment.id, verifiedAt.toISOString()]);

      if (verification.result === 'approved') {
        const standby = await closeVerificationStandby(client, incident.id, incident.release_attempt, verifiedAt, 'confirmed', null, actorId);
        await client.query(`
          INSERT INTO breakdown_ready_verifications (
            breakdown_id, result, checklist, meter_hm, location, note, verified_by, verified_at,
            rejection_type, standby_log_id, ready_effective_at
          ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,NULL,$9,$8)
        `, [incident.id, verification.result, JSON.stringify(verification.checklist), verification.meterHm, verification.location, verification.note, actorId, verifiedAt.toISOString(), standby.id]);
        const elapsedHours = await calculateStoredBreakdownHours(client, incident.id, verifiedAt);
        await client.query(`
          UPDATE breakdown_logs
          SET status = 'resolved', current_status = 'resolved', finish_time = $2,
              total_breakdown_hours = $3, updated_by = $4, updated_at = now()
          WHERE id = $1
        `, [incident.id, verifiedAt.toISOString(), elapsedHours, actorId]);
        const otherActive = await client.query(`
          SELECT 1 FROM breakdown_logs
          WHERE equipment_id = $1 AND id <> $2 AND status = 'open' AND deleted_at IS NULL LIMIT 1
        `, [incident.equipment_id, incident.id]);
        if (!otherActive.rows.length) await client.query("UPDATE equipment SET status_alat = 'Ready' WHERE id = $1", [incident.equipment_id]);
      } else if (verification.rejectionType === 'same_fault') {
        await client.query(`UPDATE breakdown_status_history SET counts_as_breakdown=TRUE WHERE id=$1`, [activeSegment.id]);
        const standby = await closeVerificationStandby(client, incident.id, incident.release_attempt, verifiedAt, 'reclassified', verification.note, actorId);
        await client.query(`
          INSERT INTO breakdown_ready_verifications (
            breakdown_id, result, checklist, meter_hm, location, note, verified_by, verified_at,
            rejection_type, standby_log_id
          ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)
        `, [incident.id, verification.result, JSON.stringify(verification.checklist), verification.meterHm, verification.location, verification.note, actorId, verifiedAt.toISOString(), verification.rejectionType, standby.id]);
        await client.query(`
          INSERT INTO breakdown_status_history (breakdown_id, status, started_at, note, changed_by, counts_as_breakdown)
          VALUES ($1,'mechanic_progress',$2,$3,$4,TRUE)
        `, [incident.id, verifiedAt.toISOString(), `Ditolak saat Verifikasi Ready: ${verification.note}`, actorId]);
        await client.query(`
          UPDATE breakdown_logs
          SET status = 'open', current_status = 'mechanic_progress', finish_time = NULL,
              repair_completed_at = NULL, repair_completed_by = NULL,
              updated_by = $2, updated_at = now()
          WHERE id = $1
        `, [incident.id, actorId]);
        await client.query("UPDATE equipment SET status_alat = 'Breakdown' WHERE id = $1", [incident.equipment_id]);
      } else {
        const standby = await closeVerificationStandby(client, incident.id, incident.release_attempt, verifiedAt, 'confirmed', null, actorId);
        const originalBreakdownHours = await calculateStoredBreakdownHours(client, incident.id, verifiedAt);
        await client.query(`
          UPDATE breakdown_logs SET status='resolved',current_status='resolved',finish_time=repair_completed_at,
            total_breakdown_hours=$2,updated_by=$3,updated_at=now()
          WHERE id=$1
        `, [incident.id, originalBreakdownHours, actorId]);
        const newShift = await resolveOperationalShift(client, verifiedAt);
        const newPicId = await resolveExistingUserId(client, verification.newFault.picId) || incident.pic_id || null;
        const newIncidentResult = await client.query(`
          INSERT INTO breakdown_logs (
            tanggal,shift_id,equipment_id,breakdown_code_id,description,remark,start_time,
            total_breakdown_hours,status,current_status,reported_by,pic_id,created_by,updated_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,'open','mechanic_progress',$8,$9,$8,$8)
          RETURNING *
        `, [operationalDateForInstant(verifiedAt), newShift.id, incident.equipment_id,
          verification.newFault.breakdownCodeId, verification.newFault.description,
          `Temuan kerusakan baru saat Verifikasi Ready insiden ${incident.id}: ${verification.note}`,
          verifiedAt.toISOString(), actorId, newPicId]);
        const newIncident = newIncidentResult.rows[0];
        await client.query(`
          INSERT INTO breakdown_status_history (breakdown_id,status,started_at,note,changed_by,counts_as_breakdown)
          VALUES ($1,'mechanic_progress',$2,$3,$4,TRUE)
        `, [newIncident.id, verifiedAt.toISOString(), `Breakdown baru dari Verifikasi Ready: ${verification.note}`, actorId]);
        await client.query(`
          INSERT INTO breakdown_ready_verifications (
            breakdown_id,result,checklist,meter_hm,location,note,verified_by,verified_at,
            rejection_type,standby_log_id,related_breakdown_id
          ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [incident.id, verification.result, JSON.stringify(verification.checklist), verification.meterHm,
          verification.location, verification.note, actorId, verifiedAt.toISOString(), verification.rejectionType, standby.id, newIncident.id]);
        await client.query("UPDATE equipment SET status_alat='Breakdown' WHERE id=$1", [incident.equipment_id]);
      }

      await client.query('COMMIT');
      res.json({
        success: true,
        id: incident.id,
        result: verification.result,
        rejectionType: verification.rejectionType,
        status: verification.result === 'approved' ? 'resolved' : (verification.rejectionType === 'new_fault' ? 'new_breakdown_created' : 'mechanic_progress')
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async reconcileBreakdownReady(req, res) {
    const client = await pool.connect();
    try {
      const effectiveAt = normalizeBreakdownTimestamp(req.body?.effective_at, 'Waktu operasi aktual');
      if (effectiveAt.getTime() > Date.now() + 5 * 60 * 1000) throw new Error('Waktu operasi aktual tidak boleh berada di masa depan.');
      const source = String(req.body?.evidence_source || '').trim().toLowerCase();
      if (!['production_log','hm_movement','dispatch','manual_supervisor'].includes(source)) throw new Error('Sumber bukti operasi tidak valid.');
      const note = String(req.body?.note || '').trim();
      if (!note) throw new Error('Catatan rekonsiliasi wajib diisi.');
      const actorId = await resolveExistingUserId(client, req.user?.id);
      if (!actorId) throw new Error('User rekonsiliasi tidak ditemukan. Silakan login ulang.');
      await client.query('BEGIN');
      const incidentResult = await client.query('SELECT * FROM breakdown_logs WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
      const incident = incidentResult.rows[0];
      if (!incident || incident.status !== 'open' || incident.current_status !== 'awaiting_verification' || !incident.repair_completed_at) {
        throw new Error('Unit tidak sedang menunggu Verifikasi Ready.');
      }
      assertIndependentReadyVerifier(incident.repair_completed_by, actorId);
      if (effectiveAt < new Date(incident.repair_completed_at)) throw new Error('Waktu operasi aktual tidak boleh lebih awal dari release Maintenance.');
      const active = await client.query(`SELECT * FROM breakdown_status_history WHERE breakdown_id=$1 AND status='awaiting_verification' AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1 FOR UPDATE`, [incident.id]);
      if (!active.rows.length) throw new Error('Timeline Menunggu Verifikasi tidak ditemukan.');
      await client.query('UPDATE breakdown_status_history SET ended_at=$2,counts_as_breakdown=FALSE WHERE id=$1', [active.rows[0].id, effectiveAt.toISOString()]);
      const standby = await closeVerificationStandby(client, incident.id, incident.release_attempt, effectiveAt, 'confirmed', null, actorId);
      const recordedAt = new Date();
      const checklist = { operational_evidence: true, evidence_source: source };
      await client.query(`
        INSERT INTO breakdown_ready_verifications (
          breakdown_id,result,checklist,location,note,verified_by,verified_at,
          standby_log_id,ready_effective_at
        ) VALUES ($1,'approved',$2::jsonb,$3,$4,$5,$6,$7,$8)
      `, [incident.id, JSON.stringify(checklist), 'Operational Evidence', note, actorId, recordedAt.toISOString(), standby.id, effectiveAt.toISOString()]);
      const elapsedHours = await calculateStoredBreakdownHours(client, incident.id, effectiveAt);
      await client.query(`UPDATE breakdown_logs SET status='resolved',current_status='resolved',finish_time=$2,total_breakdown_hours=$3,updated_by=$4,updated_at=now() WHERE id=$1`, [incident.id, effectiveAt.toISOString(), elapsedHours, actorId]);
      const otherActive = await client.query(`SELECT 1 FROM breakdown_logs WHERE equipment_id=$1 AND id<>$2 AND status='open' AND deleted_at IS NULL LIMIT 1`, [incident.equipment_id, incident.id]);
      if (!otherActive.rows.length) await client.query("UPDATE equipment SET status_alat='Ready' WHERE id=$1", [incident.equipment_id]);
      await client.query('COMMIT');
      res.json({ success: true, id: incident.id, status: 'resolved', readyEffectiveAt: effectiveAt.toISOString(), recordedAt: recordedAt.toISOString(), source });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(err.statusCode || 400).json({ error: err.message });
    } finally { client.release(); }
  }

  static async addBreakdownPart(req, res) {
    const client = await pool.connect();
    try {
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const incident = await client.query(`SELECT id FROM breakdown_logs WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]);
      if (!incident.rows.length) return res.status(404).json({ error: 'Insiden breakdown tidak ditemukan.' });
      const part = await insertBreakdownPart(client, req.params.id, req.body, actorId);
      res.status(201).json(part);
    } catch (err) {
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  // =========================================================
  // 4B. UNIT PERFORMANCE & MAINTENANCE EVENTS
  // =========================================================
  static async getUnitPerformance(req, res) {
    try {
      const now = new Date();
      const year = Math.max(2000, Math.min(2100, Number.parseInt(req.query.year, 10) || now.getFullYear()));
      const month = Math.max(1, Math.min(12, Number.parseInt(req.query.month, 10) || (now.getMonth() + 1)));
      const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const periodEnd = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      const periodStartInstant = new Date(`${periodStart}T00:00:00+07:00`);
      const periodEndInstant = new Date(`${periodEnd}T00:00:00+07:00`);

      const [equipmentResult, hmResult, breakdownResult, maintenanceResult, personnelResult] = await Promise.all([
        pool.query(`
          SELECT id, kode_alat, kelas_alat, class_unit, tipe_alat, brand, date_in, is_active, status_alat
          FROM equipment
          WHERE deleted_at IS NULL AND date_in < $1::date
          ORDER BY kelas_alat, kode_alat
        `, [periodEnd]),
        pool.query(`
          SELECT equipment_id, COALESCE(SUM(total_hm), 0)::float AS actual_hm
          FROM mining_production_logs
          WHERE deleted_at IS NULL AND tanggal >= $1::date AND tanggal < $2::date
          GROUP BY equipment_id
        `, [periodStart, periodEnd]),
        pool.query(`
          WITH bounds AS (
            SELECT ($1::date AT TIME ZONE 'Asia/Jakarta') AS from_ts,
                   ($2::date AT TIME ZONE 'Asia/Jakarta') AS to_ts
          )
          SELECT bl.id, bl.equipment_id, bl.breakdown_code_id, bl.description, bl.remark,
                 bl.start_time, bl.finish_time, bl.repair_completed_at, bl.status, bl.pic_id,
                 mbc.kode AS breakdown_code, mbc.kategori AS breakdown_category,
                 pic.nama AS pic_name,
                 COALESCE(bd_period.hours,0)::float AS period_downtime_hours,
                 COALESCE(mechanic.hours, 0)::float AS mechanic_hours
          FROM breakdown_logs bl
          CROSS JOIN bounds
          LEFT JOIN master_breakdown_codes mbc ON mbc.id = bl.breakdown_code_id
          LEFT JOIN users pic ON pic.id = bl.pic_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (
              LEAST(COALESCE(h.ended_at,now()),bounds.to_ts)-GREATEST(h.started_at,bounds.from_ts)
            ))/3600)) FILTER (
              WHERE h.counts_as_breakdown=TRUE AND h.started_at<bounds.to_ts
                AND COALESCE(h.ended_at,now())>bounds.from_ts
            ),0) AS hours
            FROM breakdown_status_history h WHERE h.breakdown_id=bl.id
          ) bd_period ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
              LEAST(COALESCE(h.ended_at, now()), bounds.to_ts) - GREATEST(h.started_at, bounds.from_ts)
            )) / 3600)) FILTER (
              WHERE h.status = 'mechanic_progress'
                AND h.started_at < bounds.to_ts
                AND COALESCE(h.ended_at, now()) > bounds.from_ts
            ), 0) AS hours
            FROM breakdown_status_history h WHERE h.breakdown_id = bl.id
          ) mechanic ON TRUE
          WHERE bl.deleted_at IS NULL
            AND ((bl.start_time < bounds.to_ts AND COALESCE(bl.finish_time, now()) > bounds.from_ts)
              OR (bl.start_time >= bounds.from_ts - INTERVAL '30 day' AND bl.start_time < bounds.to_ts))
          ORDER BY bl.equipment_id, bl.start_time
        `, [periodStart, periodEnd]),
        pool.query(`
          SELECT me.*, e.kode_alat, e.kelas_alat, e.class_unit, e.tipe_alat,
                 s.nama_shift, reporter.nama AS report_by_name, pic.nama AS pic_name,
                 CASE
                   WHEN me.event_type = 'calendar_exclusion' AND me.status <> 'cancelled' THEN
                     GREATEST(0, EXTRACT(EPOCH FROM (
                       LEAST(me.scheduled_finish, ($2::date AT TIME ZONE 'Asia/Jakarta')) -
                       GREATEST(me.scheduled_start, ($1::date AT TIME ZONE 'Asia/Jakarta'))
                     )) / 3600)
                   WHEN me.status IN ('in_progress', 'completed') AND me.actual_start IS NOT NULL THEN
                     GREATEST(0, EXTRACT(EPOCH FROM (
                       LEAST(COALESCE(me.actual_finish, now()), ($2::date AT TIME ZONE 'Asia/Jakarta')) -
                       GREATEST(me.actual_start, ($1::date AT TIME ZONE 'Asia/Jakarta'))
                     )) / 3600)
                   ELSE 0
                 END::float AS period_event_hours
          FROM maintenance_events me
          JOIN equipment e ON e.id = me.equipment_id
          LEFT JOIN shifts s ON s.id = me.shift_id
          LEFT JOIN users reporter ON reporter.id = COALESCE(me.reported_by, me.created_by)
          LEFT JOIN users pic ON pic.id = me.pic_id
          WHERE me.deleted_at IS NULL
            AND me.scheduled_start < ($2::date AT TIME ZONE 'Asia/Jakarta')
            AND me.scheduled_finish >= ($1::date AT TIME ZONE 'Asia/Jakarta')
          ORDER BY me.scheduled_start DESC
        `, [periodStart, periodEnd]),
        pool.query(`
          SELECT id, nama, jabatan
          FROM users
          WHERE is_active = TRUE AND LOWER(TRIM(COALESCE(departemen, ''))) = 'maintenance'
          ORDER BY nama
        `)
      ]);

      const hmByEquipment = new Map(hmResult.rows.map(row => [String(row.equipment_id), Number(row.actual_hm || 0)]));
      const breakdowns = breakdownResult.rows;
      const maintenanceEvents = maintenanceResult.rows.map(row => ({ ...row, period_event_hours: Number(row.period_event_hours || 0) }));
      const currentBreakdowns = breakdowns.filter(row => {
        const started = new Date(row.start_time);
        return started >= periodStartInstant && started < periodEndInstant;
      });

      const repeatedBreakdownIds = new Set();
      currentBreakdowns.forEach(current => {
        const currentStart = new Date(current.start_time).getTime();
        const repeated = breakdowns.some(previous => previous.id !== current.id
          && String(previous.equipment_id) === String(current.equipment_id)
          && String(previous.breakdown_code_id || '') === String(current.breakdown_code_id || '')
          && new Date(previous.start_time).getTime() < currentStart
          && currentStart - new Date(previous.start_time).getTime() <= 30 * 86400000);
        if (repeated) repeatedBreakdownIds.add(String(current.id));
      });

      const unitInputs = new Map();
      equipmentResult.rows.forEach(unit => {
        const dateIn = new Date(unit.date_in);
        const dateInTime = Number.isNaN(dateIn.getTime()) ? periodStartInstant.getTime() : dateIn.getTime();
        const activeStart = new Date(Math.max(periodStartInstant.getTime(), dateInTime));
        const activeHours = Math.max(0, (periodEndInstant.getTime() - activeStart.getTime()) / 3600000);
        unitInputs.set(String(unit.id), {
          unit,
          calendarHours: activeHours,
          excludedHours: 0,
          breakdownDowntime: 0,
          scheduledServiceDowntime: 0,
          inspectionDowntime: 0,
          correctiveRepairDowntime: 0,
          actualHm: hmByEquipment.get(String(unit.id)) || 0,
          functionalFailures: 0,
          correctiveRepairs: 0,
          repairHours: [],
          eventCounts: { scheduled_service: 0, inspection: 0, corrective_repair: 0 },
          repeatFailures: 0
        });
      });

      breakdowns.forEach(row => {
        const input = unitInputs.get(String(row.equipment_id));
        if (!input) return;
        input.breakdownDowntime += Number(row.period_downtime_hours || 0);
      });
      currentBreakdowns.forEach(row => {
        const input = unitInputs.get(String(row.equipment_id));
        if (!input) return;
        input.functionalFailures += 1;
        input.correctiveRepairs += 1;
        if (row.repair_completed_at) {
          input.repairHours.push(Math.max(0, (new Date(row.repair_completed_at) - new Date(row.start_time)) / 3600000));
        }
        if (repeatedBreakdownIds.has(String(row.id))) input.repeatFailures += 1;
      });

      maintenanceEvents.forEach(event => {
        const input = unitInputs.get(String(event.equipment_id));
        if (!input || event.status === 'cancelled') return;
        const hours = Number(event.period_event_hours || 0);
        if (event.event_type === 'calendar_exclusion') input.excludedHours += hours;
        if (event.event_type === 'scheduled_service') {
          input.eventCounts.scheduled_service += 1;
          if (event.affects_availability) input.scheduledServiceDowntime += hours;
        }
        if (event.event_type === 'inspection') {
          input.eventCounts.inspection += 1;
          if (event.affects_availability) input.inspectionDowntime += hours;
        }
        if (event.event_type === 'corrective_repair') {
          input.eventCounts.corrective_repair += 1;
          input.correctiveRepairs += 1;
          if (event.functional_failure) input.functionalFailures += 1;
          if (event.affects_availability) input.correctiveRepairDowntime += hours;
          if (event.status === 'completed' && hours >= 0) input.repairHours.push(hours);
        }
      });

      const units = [...unitInputs.values()].map(input => ({
        ...input.unit,
        ...calculateUnitPerformanceMetrics(input),
        eventCounts: input.eventCounts,
        repeatFailures: input.repeatFailures
      }));

      const fleetInput = units.reduce((summary, unit) => {
        summary.calendarHours += unit.calendarHours;
        summary.excludedHours += unit.excludedHours;
        summary.breakdownDowntime += unit.downtime.breakdown;
        summary.scheduledServiceDowntime += unit.downtime.scheduledService;
        summary.inspectionDowntime += unit.downtime.inspection;
        summary.correctiveRepairDowntime += unit.downtime.correctiveRepair;
        summary.actualHm += unit.actualHm;
        summary.functionalFailures += unit.functionalFailures;
        summary.correctiveRepairs += unit.correctiveRepairs;
        if (unit.mttrHours !== null) summary.repairHours.push(...unitInputs.get(String(unit.id)).repairHours);
        return summary;
      }, { calendarHours: 0, excludedHours: 0, breakdownDowntime: 0, scheduledServiceDowntime: 0, inspectionDowntime: 0, correctiveRepairDowntime: 0, actualHm: 0, functionalFailures: 0, correctiveRepairs: 0, repairHours: [] });
      const fleet = calculateUnitPerformanceMetrics(fleetInput);
      fleet.totalUnits = units.length;
      fleet.unitsWithHm = units.filter(unit => unit.actualHm > 0).length;
      fleet.repeatFailures = units.reduce((sum, unit) => sum + unit.repeatFailures, 0);
      fleet.scheduledServices = maintenanceEvents.filter(event => event.event_type === 'scheduled_service' && event.status !== 'cancelled').length;
      fleet.inspections = maintenanceEvents.filter(event => event.event_type === 'inspection' && event.status !== 'cancelled').length;

      const typeMap = new Map();
      units.forEach(unit => {
        const type = String(unit.kelas_alat || unit.class_unit || unit.tipe_alat || 'Lainnya');
        if (!typeMap.has(type)) typeMap.set(type, { type, units: [], input: { calendarHours: 0, excludedHours: 0, breakdownDowntime: 0, scheduledServiceDowntime: 0, inspectionDowntime: 0, correctiveRepairDowntime: 0, actualHm: 0, functionalFailures: 0, correctiveRepairs: 0, repairHours: [] } });
        const group = typeMap.get(type);
        group.units.push(unit);
        group.input.calendarHours += unit.calendarHours;
        group.input.excludedHours += unit.excludedHours;
        group.input.breakdownDowntime += unit.downtime.breakdown;
        group.input.scheduledServiceDowntime += unit.downtime.scheduledService;
        group.input.inspectionDowntime += unit.downtime.inspection;
        group.input.correctiveRepairDowntime += unit.downtime.correctiveRepair;
        group.input.actualHm += unit.actualHm;
        group.input.functionalFailures += unit.functionalFailures;
        group.input.correctiveRepairs += unit.correctiveRepairs;
        group.input.repairHours.push(...unitInputs.get(String(unit.id)).repairHours);
      });
      const unitTypes = [...typeMap.values()].map(group => ({ type: group.type, totalUnits: group.units.length, ...calculateUnitPerformanceMetrics(group.input) }));

      const personnelMap = new Map(personnelResult.rows.map(person => [String(person.id), {
        id: person.id, name: person.nama, position: person.jabatan, jobs: 0, completedJobs: 0,
        activeRepairHours: 0, repairDurations: [], breakdownJobs: 0, scheduledServices: 0,
        inspections: 0, correctiveRepairs: 0, repeatFailures: 0, documentedJobs: 0
      }]));
      currentBreakdowns.forEach(row => {
        const person = personnelMap.get(String(row.pic_id || ''));
        if (!person) return;
        person.jobs += 1;
        person.breakdownJobs += 1;
        person.activeRepairHours += Number(row.mechanic_hours || 0);
        if (row.repair_completed_at) person.completedJobs += 1;
        if (Number(row.mechanic_hours || 0) > 0) person.repairDurations.push(Number(row.mechanic_hours));
        if (repeatedBreakdownIds.has(String(row.id))) person.repeatFailures += 1;
        if (String(row.description || '').trim() && String(row.breakdown_category || '').trim()) person.documentedJobs += 1;
      });
      maintenanceEvents.forEach(event => {
        const person = personnelMap.get(String(event.pic_id || ''));
        if (!person || event.status === 'cancelled') return;
        person.jobs += 1;
        if (event.status === 'completed') person.completedJobs += 1;
        if (event.event_type === 'scheduled_service') person.scheduledServices += 1;
        if (event.event_type === 'inspection') person.inspections += 1;
        if (event.event_type === 'corrective_repair') person.correctiveRepairs += 1;
        if (event.status === 'completed') {
          person.activeRepairHours += Number(event.period_event_hours || 0);
          person.repairDurations.push(Number(event.period_event_hours || 0));
        }
        if (String(event.description || '').trim() || String(event.corrective_action || '').trim()) person.documentedJobs += 1;
      });
      const median = values => {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      };
      const personnel = [...personnelMap.values()].map(person => ({
        ...person,
        medianActiveRepairHours: median(person.repairDurations),
        completionRate: person.jobs ? (person.completedJobs / person.jobs) * 100 : null,
        firstTimeFixRate: person.breakdownJobs ? Math.max(0, ((person.breakdownJobs - person.repeatFailures) / person.breakdownJobs) * 100) : null,
        documentationRate: person.jobs ? (person.documentedJobs / person.jobs) * 100 : null
      }));

      res.json({
        period: { year, month, start: periodStart, endExclusive: periodEnd, days: (periodEndInstant - periodStartInstant) / 86400000 },
        definitions: {
          pa: '(Calendar Hours - seluruh downtime fisik) / Calendar Hours',
          ma: '(Scheduled Hours - maintenance downtime) / Scheduled Hours',
          mtbf: 'Actual operating HM / functional failure',
          mtbr: 'Actual operating HM / corrective repair event',
          personnel: 'Waiting part/tool/manpower/vendor tidak masuk active repair hours personel'
        },
        fleet,
        unitTypes,
        units,
        personnel,
        maintenanceEvents,
        dataQuality: {
          hmCoveragePercent: units.length ? (fleet.unitsWithHm / units.length) * 100 : 0,
          unitsWithoutHm: units.filter(unit => unit.actualHm <= 0).map(unit => unit.kode_alat),
          unassignedMaintenanceEvents: maintenanceEvents.filter(event => !event.pic_id && event.status !== 'cancelled').length,
          note: 'MTBF dan MTBR ditampilkan kosong jika actual HM atau event pembaginya belum tersedia.'
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createMaintenanceEvent(req, res) {
    const client = await pool.connect();
    try {
      const body = req.body || {};
      const eventType = normalizeMaintenanceEventType(body.event_type);
      const status = normalizeMaintenanceEventStatus(body.status);
      const tanggal = normalizeDateOnly(body.tanggal, 'Tanggal maintenance');
      const title = String(body.title || '').trim();
      if (!body.equipment_id || !title) throw new Error('Unit dan judul pekerjaan wajib diisi.');
      const scheduledStart = normalizeBreakdownTimestamp(body.scheduled_start, 'Rencana mulai');
      const scheduledFinish = normalizeBreakdownTimestamp(body.scheduled_finish, 'Rencana selesai');
      if (scheduledFinish < scheduledStart) throw new Error('Rencana selesai tidak boleh lebih awal dari rencana mulai.');
      if (['in_progress', 'completed'].includes(status) && !body.actual_start) throw new Error('Waktu mulai aktual wajib diisi untuk pekerjaan berjalan/selesai.');
      if (status === 'completed' && !body.actual_finish) throw new Error('Waktu selesai aktual wajib diisi untuk pekerjaan selesai.');
      const actualStart = body.actual_start ? normalizeBreakdownTimestamp(body.actual_start, 'Waktu mulai aktual') : null;
      const actualFinish = body.actual_finish ? normalizeBreakdownTimestamp(body.actual_finish, 'Waktu selesai aktual') : null;
      const downtimeHours = maintenanceDurationHours(actualStart, actualFinish || (status === 'in_progress' ? new Date() : null));
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const picId = await resolveExistingUserId(client, body.pic_id);
      const result = await client.query(`
        INSERT INTO maintenance_events (
          tanggal, shift_id, equipment_id, event_type, status, title, component, description,
          failure_mode, failure_cause, corrective_action, scheduled_start, scheduled_finish,
          actual_start, actual_finish, downtime_hours, affects_availability, functional_failure,
          service_interval_hm, meter_hm, reported_by, pic_id, remark, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$21,$21)
        RETURNING *
      `, [tanggal, body.shift_id || null, body.equipment_id, eventType, status, title,
        String(body.component || '').trim() || null, String(body.description || '').trim() || null,
        String(body.failure_mode || '').trim() || null, String(body.failure_cause || '').trim() || null,
        String(body.corrective_action || '').trim() || null, scheduledStart.toISOString(), scheduledFinish.toISOString(),
        actualStart?.toISOString() || null, actualFinish?.toISOString() || null, downtimeHours,
        body.affects_availability !== false, body.functional_failure === true,
        parseOptionalNonNegativeNumber(body.service_interval_hm, 'Interval service HM'),
        parseOptionalNonNegativeNumber(body.meter_hm, 'Meter HM'), actorId, picId,
        String(body.remark || '').trim() || null]);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async updateMaintenanceEvent(req, res) {
    const client = await pool.connect();
    try {
      const body = req.body || {};
      const existing = await client.query('SELECT * FROM maintenance_events WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: 'Record maintenance tidak ditemukan.' });
      const current = existing.rows[0];
      const eventType = normalizeMaintenanceEventType(body.event_type ?? current.event_type);
      const status = normalizeMaintenanceEventStatus(body.status ?? current.status);
      const scheduledStart = normalizeBreakdownTimestamp(body.scheduled_start ?? current.scheduled_start, 'Rencana mulai');
      const scheduledFinish = normalizeBreakdownTimestamp(body.scheduled_finish ?? current.scheduled_finish, 'Rencana selesai');
      if (scheduledFinish < scheduledStart) throw new Error('Rencana selesai tidak boleh lebih awal dari rencana mulai.');
      const actualStartRaw = body.actual_start !== undefined ? body.actual_start : current.actual_start;
      const actualFinishRaw = body.actual_finish !== undefined ? body.actual_finish : current.actual_finish;
      if (['in_progress', 'completed'].includes(status) && !actualStartRaw) throw new Error('Waktu mulai aktual wajib diisi untuk pekerjaan berjalan/selesai.');
      if (status === 'completed' && !actualFinishRaw) throw new Error('Waktu selesai aktual wajib diisi untuk pekerjaan selesai.');
      const actualStart = actualStartRaw ? normalizeBreakdownTimestamp(actualStartRaw, 'Waktu mulai aktual') : null;
      const actualFinish = actualFinishRaw ? normalizeBreakdownTimestamp(actualFinishRaw, 'Waktu selesai aktual') : null;
      const downtimeHours = maintenanceDurationHours(actualStart, actualFinish || (status === 'in_progress' ? new Date() : null));
      const actorId = await resolveExistingUserId(client, req.user?.id);
      const picId = await resolveExistingUserId(client, body.pic_id !== undefined ? body.pic_id : current.pic_id);
      const result = await client.query(`
        UPDATE maintenance_events SET tanggal=$1, shift_id=$2, equipment_id=$3, event_type=$4, status=$5,
          title=$6, component=$7, description=$8, failure_mode=$9, failure_cause=$10,
          corrective_action=$11, scheduled_start=$12, scheduled_finish=$13, actual_start=$14,
          actual_finish=$15, downtime_hours=$16, affects_availability=$17, functional_failure=$18,
          service_interval_hm=$19, meter_hm=$20, pic_id=$21, remark=$22, updated_by=$23, updated_at=now()
        WHERE id=$24 AND deleted_at IS NULL RETURNING *
      `, [normalizeDateOnly(body.tanggal ?? current.tanggal, 'Tanggal maintenance'), body.shift_id ?? current.shift_id,
        body.equipment_id ?? current.equipment_id, eventType, status, String(body.title ?? current.title).trim(),
        String(body.component ?? current.component ?? '').trim() || null, String(body.description ?? current.description ?? '').trim() || null,
        String(body.failure_mode ?? current.failure_mode ?? '').trim() || null, String(body.failure_cause ?? current.failure_cause ?? '').trim() || null,
        String(body.corrective_action ?? current.corrective_action ?? '').trim() || null, scheduledStart.toISOString(), scheduledFinish.toISOString(),
        actualStart?.toISOString() || null, actualFinish?.toISOString() || null, downtimeHours,
        body.affects_availability !== undefined ? body.affects_availability === true : current.affects_availability,
        body.functional_failure !== undefined ? body.functional_failure === true : current.functional_failure,
        parseOptionalNonNegativeNumber(body.service_interval_hm ?? current.service_interval_hm, 'Interval service HM'),
        parseOptionalNonNegativeNumber(body.meter_hm ?? current.meter_hm, 'Meter HM'), picId,
        String(body.remark ?? current.remark ?? '').trim() || null, actorId, req.params.id]);
      res.json(result.rows[0]);
    } catch (err) {
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  // =========================================================
  // 5. INPUT RITASE & FLEET AUTO MAPPING
  // =========================================================
  static async getFleetMappings(req, res) {
    try {
      const { tanggal, shift_id } = req.query;
      let query = `
        SELECT fm.*, e.kode_alat as excavator_kode, lp.nama_loading_point, d.nama_disposal, s.nama_shift
        FROM fleet_mappings fm
        LEFT JOIN equipment e ON fm.excavator_id = e.id
        LEFT JOIN loading_points lp ON fm.loading_point_id = lp.id
        LEFT JOIN disposals d ON fm.disposal_id = d.id
        LEFT JOIN shifts s ON fm.shift_id = s.id
        WHERE fm.deleted_at IS NULL
      `;
      const params = [];
      if (tanggal) {
        query += ` AND fm.tanggal = $1`;
        params.push(tanggal);
      }
      query += ` ORDER BY fm.created_at DESC`;

      const result = await pool.query(query, params);

      // Ambil daftar dump truck untuk setiap fleet
      for (const fleet of result.rows) {
        const truckRes = await pool.query(
          `SELECT fmt.dump_truck_id, e.kode_alat
           FROM fleet_mapping_trucks fmt
           JOIN equipment e ON fmt.dump_truck_id = e.id
           WHERE fmt.fleet_mapping_id = $1`,
          [fleet.id]
        );
        fleet.trucks = truckRes.rows;
      }

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createFleetMapping(req, res) {
    try {
      const { tanggal, shift_id, nama_fleet, excavator_id, loading_point_id, disposal_id, material_type, dump_truck_ids, pit_area, job_code, jarak_km, material_detail } = req.body;

      if (!tanggal || !shift_id || !excavator_id) {
        return res.status(400).json({ error: 'Tanggal, Shift, dan Excavator wajib diisi.' });
      }

      const nama = (nama_fleet || '').trim() || null;
      const matType = material_type || 'Overburden';
      const area = (pit_area || '').trim() || null;
      const job = (job_code || '').trim() || null;
      const jarak = (jarak_km === '' || jarak_km == null) ? null : Number(jarak_km);
      const materialDetail = (material_detail || '').trim() || null;

      // Upsert: satu fleet per (tanggal, shift, excavator). Hindari duplikat fleet
      // saat "Tambah Fleet" atau "Edit Fleet" dipakai berulang pada shift yang sama.
      const find = await pool.query(
        `SELECT id FROM fleet_mappings
         WHERE deleted_at IS NULL AND tanggal = $1 AND shift_id = $2 AND excavator_id = $3
         ORDER BY created_at DESC LIMIT 1`,
        [tanggal, shift_id, excavator_id]
      );

      let fleetId;
      if (find.rows.length) {
        fleetId = find.rows[0].id;
        await pool.query(
          `UPDATE fleet_mappings
           SET nama_fleet = COALESCE($1, nama_fleet),
               pit_area = COALESCE($2, pit_area),
               job_code = COALESCE($3, job_code),
               jarak_km = COALESCE($4, jarak_km),
               material_type = $5,
               material_detail = COALESCE($6, material_detail),
               loading_point_id = COALESCE($7, loading_point_id),
               disposal_id = COALESCE($8, disposal_id),
               deleted_at = NULL
           WHERE id = $9`,
          [nama, area, job, jarak, matType, materialDetail, loading_point_id || null, disposal_id || null, fleetId]
        );
      } else {
        const ins = await pool.query(
          `INSERT INTO fleet_mappings
             (tanggal, shift_id, nama_fleet, excavator_id, loading_point_id, disposal_id, material_type, material_detail, pit_area, job_code, jarak_km)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [tanggal, shift_id, nama, excavator_id, loading_point_id || null, disposal_id || null, matType, materialDetail, area, job, jarak]
        );
        fleetId = ins.rows[0].id;
      }

      // Ganti seluruh ikatan dump truck fleet dengan daftar baru
      await pool.query("DELETE FROM fleet_mapping_trucks WHERE fleet_mapping_id = $1", [fleetId]);
      if (Array.isArray(dump_truck_ids) && dump_truck_ids.length) {
        for (const truckId of [...new Set(dump_truck_ids)]) {
          await pool.query("INSERT INTO fleet_mapping_trucks (fleet_mapping_id, dump_truck_id) VALUES ($1, $2)", [fleetId, truckId]);
        }
      }

      const fleet = (await pool.query("SELECT * FROM fleet_mappings WHERE id = $1", [fleetId])).rows[0];
      res.status(201).json(fleet);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Grid ritase baru: satu fleet = header (EXC, PIT/Area, JOB, material, jarak)
  // + baris per dump truck dengan map ritase per jam (period_hour).
  static async getRitaseFleetGrid(req, res) {
    try {
      const { tanggal, shift_id } = req.query;
      if (!tanggal) return res.status(400).json({ error: 'Parameter tanggal wajib diisi.' });

      const fleetRes = await pool.query(`
        SELECT fm.*, e.kode_alat AS excavator_kode, e.tipe_alat AS excavator_tipe,
               jc.job_desc, s.nama_shift, s.operational_start, s.operational_end, s.lintas_hari
        FROM fleet_mappings fm
        LEFT JOIN equipment e ON fm.excavator_id = e.id
        LEFT JOIN master_job_codes jc ON fm.job_code = jc.job_code
        LEFT JOIN shifts s ON fm.shift_id = s.id
        WHERE fm.deleted_at IS NULL AND fm.tanggal = $1
        ${shift_id ? 'AND fm.shift_id = $2' : ''}
        ORDER BY fm.created_at ASC
      `, shift_id ? [tanggal, shift_id] : [tanggal]);

      const fleets = fleetRes.rows;
      for (const fleet of fleets) {
        const truckRes = await pool.query(`
          SELECT fmt.dump_truck_id, e.kode_alat, e.tipe_alat
          FROM fleet_mapping_trucks fmt
          JOIN equipment e ON fmt.dump_truck_id = e.id
          WHERE fmt.fleet_mapping_id = $1
          ORDER BY e.kode_alat
        `, [fleet.id]);

        const hourRes = await pool.query(`
          SELECT dump_truck_id, period_hour, ritase_count
          FROM ritase_logs
          WHERE deleted_at IS NULL AND fleet_mapping_id = $1
        `, [fleet.id]);

        const hoursByTruck = {};
        for (const h of hourRes.rows) {
          if (!hoursByTruck[h.dump_truck_id]) hoursByTruck[h.dump_truck_id] = {};
          hoursByTruck[h.dump_truck_id][h.period_hour] = Number(h.ritase_count);
        }

        fleet.trucks = truckRes.rows.map(t => ({
          dump_truck_id: t.dump_truck_id,
          kode_alat: t.kode_alat,
          tipe_alat: t.tipe_alat,
          hours: hoursByTruck[t.dump_truck_id] || {},
          total_ritase: Object.values(hoursByTruck[t.dump_truck_id] || {}).reduce((a, b) => a + b, 0)
        }));
        fleet.total_ritase = fleet.trucks.reduce((a, t) => a + t.total_ritase, 0);
      }

      res.json(fleets);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Simpan batch ritase per jam per dump truck untuk satu fleet (upsert idempoten).
  static async saveRitaseHours(req, res) {
    const client = await pool.connect();
    try {
      const { tanggal, shift_id, fleet_mapping_id, excavator_id, material, rows } = req.body;
      if (!tanggal || !shift_id || !fleet_mapping_id) {
        return res.status(400).json({ error: 'tanggal, shift_id, dan fleet_mapping_id wajib diisi.' });
      }
      if (!Array.isArray(rows) || !rows.length) {
        return res.status(400).json({ error: 'Tidak ada baris ritase untuk disimpan.' });
      }
      const userId = req.user?.id || null;
      const mat = material || 'Overburden';

      await client.query('BEGIN');
      let saved = 0;
      for (const row of rows) {
        const { dump_truck_id, period_hour, ritase_count } = row;
        if (!dump_truck_id || period_hour == null) continue;
        const hour = Number(period_hour);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
        const count = Math.max(0, Math.floor(Number(ritase_count) || 0));
        await client.query(`
          INSERT INTO ritase_logs
            (tanggal, shift_id, fleet_mapping_id, excavator_id, dump_truck_id, material, period_hour, ritase_count, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (tanggal, shift_id, fleet_mapping_id, dump_truck_id, period_hour)
            WHERE deleted_at IS NULL AND fleet_mapping_id IS NOT NULL
          DO UPDATE SET ritase_count = EXCLUDED.ritase_count, material = EXCLUDED.material
        `, [tanggal, shift_id, fleet_mapping_id, excavator_id, dump_truck_id, mat, hour, count, userId]);
        saved++;
      }
      await client.query('COMMIT');
      res.json({ ok: true, saved });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  // Truck Factor: acuan payload per ritase -> produksi, per periode.
  static async getTruckFactors(req, res) {
    try {
      const { tanggal } = req.query;
      if (!tanggal) return res.status(400).json({ error: 'Parameter tanggal wajib diisi.' });
      const result = await pool.query(
        `SELECT kategori, tipe_alat, material, factor_value
         FROM truck_factors
         WHERE tanggal = $1
         ORDER BY kategori, tipe_alat, material`,
        [tanggal]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Periode terakhir sebelum <tanggal> yang memiliki data truck factor (untuk carry-over).
  static async getPreviousTruckFactors(req, res) {
    try {
      const { tanggal } = req.query;
      if (!tanggal) return res.status(400).json({ error: 'Parameter tanggal wajib diisi.' });
      const prev = await pool.query(
        `SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal
         FROM truck_factors
         WHERE tanggal < $1::date
         ORDER BY tanggal DESC LIMIT 1`,
        [tanggal]
      );
      if (!prev.rows.length) return res.json({ tanggal: null, rows: [] });
      const p = prev.rows[0].tanggal;
      const rows = await pool.query(
        `SELECT kategori, tipe_alat, material, factor_value
         FROM truck_factors
         WHERE tanggal = $1::date
         ORDER BY kategori, tipe_alat, material`,
        [p]
      );
      res.json({ tanggal: p, rows: rows.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async saveTruckFactors(req, res) {
    const client = await pool.connect();
    try {
      const { tanggal, entries } = req.body;
      if (!tanggal) return res.status(400).json({ error: 'Parameter tanggal wajib diisi.' });
      if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'Tidak ada data truck factor.' });
      const userId = req.user?.id || null;

      await client.query('BEGIN');
      let saved = 0, removed = 0;
      for (const e of entries) {
        const katRaw = String(e.kategori || '').trim().toLowerCase();
        const kategori = katRaw === 'coal' ? 'Coal' : (katRaw === 'ob' ? 'OB' : null);
        const tipe = String(e.tipe_alat || '').trim();
        const mat = String(e.material || '').trim().toUpperCase();
        if (!kategori || !tipe || !mat) continue;
        const raw = String(e.factor_value ?? '').trim();
        if (raw === '') {
          await client.query(
            'DELETE FROM truck_factors WHERE tanggal = $1 AND kategori = $2 AND tipe_alat = $3 AND material = $4',
            [tanggal, kategori, tipe, mat]
          );
          removed++;
        } else {
          const val = Number(raw);
          if (!Number.isFinite(val)) continue;
          await client.query(`
            INSERT INTO truck_factors (tanggal, kategori, tipe_alat, material, factor_value, created_by, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, now())
            ON CONFLICT (tanggal, kategori, tipe_alat, material)
            DO UPDATE SET factor_value = EXCLUDED.factor_value, updated_at = now()
          `, [tanggal, kategori, tipe, mat, val, userId]);
          saved++;
        }
      }
      await client.query('COMMIT');
      res.json({ ok: true, saved, removed });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  static async getRitaseLogs(req, res) {
    try {
      const { tanggal } = req.query;
      let query = `
        SELECT rl.*, 
               exc.kode_alat as excavator_kode, 
               dt.kode_alat as dump_truck_kode, 
               u.nama as nama_operator,
               lp.nama_loading_point, d.nama_disposal, s.nama_shift
        FROM ritase_logs rl
        LEFT JOIN equipment exc ON rl.excavator_id = exc.id
        LEFT JOIN equipment dt ON rl.dump_truck_id = dt.id
        LEFT JOIN users u ON rl.operator_id = u.id
        LEFT JOIN loading_points lp ON rl.loading_point_id = lp.id
        LEFT JOIN disposals d ON rl.disposal_id = d.id
        LEFT JOIN shifts s ON rl.shift_id = s.id
        WHERE rl.deleted_at IS NULL
      `;
      const params = [];
      if (tanggal) {
        query += ` AND rl.tanggal = $1`;
        params.push(tanggal);
      }
      query += ` ORDER BY rl.created_at DESC LIMIT 200`;

      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createRitaseLog(req, res) {
    try {
      const { tanggal, shift_id, fleet_mapping_id, excavator_id, dump_truck_id, operator_id, material, loading_point_id, disposal_id, ritase_count, production_volume, average_cycle_time, remark } = req.body;
      const userId = req.user?.id || null;

      const query = `
        INSERT INTO ritase_logs (
          tanggal, shift_id, fleet_mapping_id, excavator_id, dump_truck_id, operator_id,
          material, loading_point_id, disposal_id, ritase_count, production_volume, average_cycle_time, remark, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `;
      const result = await pool.query(query, [
        tanggal, shift_id, fleet_mapping_id || null, excavator_id, dump_truck_id, operator_id || null,
        material, loading_point_id || null, disposal_id || null, parseInt(ritase_count || 0), parseFloat(production_volume || 0), parseFloat(average_cycle_time || 0), remark || '', userId
      ]);

      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 6. DAILY DASHBOARD
  // =========================================================
  static async getDailyDashboard(req, res) {
    try {
      const tgl = req.query.tanggal || getTodayString();
      const operationalBounds = operationalDayBounds(tgl);

      // Aggregate Coal & OB Production
      const prodSum = await pool.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN material = 'Coal' THEN production_volume ELSE 0 END), 0) as actual_coal,
          COALESCE(SUM(CASE WHEN material = 'Overburden' THEN production_volume ELSE 0 END), 0) as actual_ob,
          COALESCE(SUM(ritase_count), 0) as total_ritase,
          COALESCE(AVG(average_cycle_time), 0) as avg_cycle_time
        FROM ritase_logs 
        WHERE deleted_at IS NULL AND tanggal = $1
      `, [tgl]);

      // Aggregate Fuel & HM
      const fuelSum = await pool.query(`
        SELECT 
          COALESCE(SUM(fuel_filled), 0) as total_fuel,
          COALESCE(SUM(total_hm), 0) as total_hm
        FROM fuel_logs 
        WHERE deleted_at IS NULL AND tanggal = $1
      `, [tgl]);

      // Standby & Breakdown Hours
      const stbSum = await pool.query(`
        SELECT COALESCE(SUM(
          GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(COALESCE(finish_time, NOW()), $2::timestamptz)
            - GREATEST(start_time, $1::timestamptz)
          )) / 3600)
        ), 0) AS total_standby
        FROM standby_logs
        WHERE deleted_at IS NULL
          AND lifecycle_status IN ('open','confirmed')
          AND start_time < $2::timestamptz
          AND COALESCE(finish_time, NOW()) > $1::timestamptz
      `, [operationalBounds.start.toISOString(), operationalBounds.end.toISOString()]);
      const bdSum = await pool.query(`SELECT COALESCE(SUM(total_breakdown_hours), 0) as total_bd FROM breakdown_logs WHERE deleted_at IS NULL AND tanggal = $1`, [tgl]);

      // Targets
      const targetRes = await pool.query(`SELECT * FROM production_targets WHERE periode = DATE_TRUNC('month', $1::date) LIMIT 1`, [tgl]);
      const targetCoalDay = targetRes.rows[0] ? (parseFloat(targetRes.rows[0].target_coal_mt) / 30).toFixed(0) : 2100;
      const targetObDay = targetRes.rows[0] ? (parseFloat(targetRes.rows[0].target_ob_bcm) / 30).toFixed(0) : 8300;

      const actualCoal = parseFloat(prodSum.rows[0]?.actual_coal || 0);
      const actualOb = parseFloat(prodSum.rows[0]?.actual_ob || 0);
      const achievementCoal = Math.min(100, ((actualCoal / targetCoalDay) * 100)).toFixed(1);
      const achievementOb = Math.min(100, ((actualOb / targetObDay) * 100)).toFixed(1);

      res.json({
        tanggal: tgl,
        kpi: {
          coal: { actual: actualCoal, target: targetCoalDay, achievement: achievementCoal },
          ob: { actual: actualOb, target: targetObDay, achievement: achievementOb },
          fuel: parseFloat(fuelSum.rows[0]?.total_fuel || 0),
          totalHm: parseFloat(fuelSum.rows[0]?.total_hm || 0),
          totalRitase: parseInt(prodSum.rows[0]?.total_ritase || 0),
          avgCycleTime: parseFloat(prodSum.rows[0]?.avg_cycle_time || 0).toFixed(1),
          standbyHours: parseFloat(stbSum.rows[0]?.total_standby || 0),
          breakdownHours: parseFloat(bdSum.rows[0]?.total_bd || 0),
          weather: 'Cerah Berawan (29°C)'
        },
        hourlyChart: [
          { jam: '06:00', coal: 120, ob: 450 },
          { jam: '09:00', coal: 280, ob: 820 },
          { jam: '11:00', coal: 310, ob: 910 },
          { jam: '13:00', coal: 240, ob: 780 },
          { jam: '15:00', coal: 350, ob: 1050 },
          { jam: '17:00', coal: 290, ob: 890 }
        ]
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 7. SHIFT REPORT
  // =========================================================
  static async getShiftReport(req, res) {
    try {
      const { tanggal, shift_id } = req.query;
      const tgl = tanggal || getTodayString();
      const operationalBounds = operationalDayBounds(tgl);
      let standbyWindowStart = operationalBounds.start;
      let standbyWindowEnd = operationalBounds.end;
      if (shift_id) {
        const shiftResult = await pool.query('SELECT nama_shift FROM shifts WHERE id=$1 LIMIT 1', [shift_id]);
        const shiftName = String(shiftResult.rows[0]?.nama_shift || '');
        if (/siang/i.test(shiftName)) {
          standbyWindowEnd = operationalBounds.dayEnd;
        } else if (/malam/i.test(shiftName)) {
          standbyWindowStart = operationalBounds.dayEnd;
        }
      }

      const prod = await pool.query(`
        SELECT material, SUM(ritase_count) as total_rit, SUM(production_volume) as total_vol
        FROM ritase_logs WHERE deleted_at IS NULL AND tanggal = $1 GROUP BY material
      `, [tgl]);

      const stb = await pool.query(`
        SELECT msc.kategori, COALESCE(SUM(
          GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(COALESCE(sl.finish_time, NOW()), $2::timestamptz)
            - GREATEST(sl.start_time, $1::timestamptz)
          )) / 3600)
        ), 0) AS hours
        FROM standby_logs sl JOIN master_standby_codes msc ON sl.standby_code_id = msc.id
        WHERE sl.deleted_at IS NULL
          AND sl.lifecycle_status IN ('open','confirmed')
          AND sl.start_time < $2::timestamptz
          AND COALESCE(sl.finish_time, NOW()) > $1::timestamptz
        GROUP BY msc.kategori
      `, [standbyWindowStart.toISOString(), standbyWindowEnd.toISOString()]);

      const bd = await pool.query(`
        SELECT e.kode_alat, mbc.kategori, bl.total_breakdown_hours
        FROM breakdown_logs bl JOIN equipment e ON bl.equipment_id = e.id JOIN master_breakdown_codes mbc ON bl.breakdown_code_id = mbc.id
        WHERE bl.deleted_at IS NULL AND bl.tanggal = $1
      `, [tgl]);

      res.json({
        tanggal: tgl,
        production: prod.rows,
        standby: stb.rows,
        breakdown: bd.rows,
        supervisorNote: 'Shift berjalan dengan lancar tanpa kendala K3. P2H alat berat dilaksanakan 100% tepat waktu.'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 8. PRODUCTIVITY REPORT (TOP 10 / BOTTOM 10)
  // =========================================================
  static async getProductivityReport(req, res) {
    try {
      const excRank = await pool.query(`
        SELECT e.kode_alat, e.tipe_alat, SUM(rl.production_volume) as total_prod, COUNT(rl.id) as total_rit
        FROM ritase_logs rl JOIN equipment e ON rl.excavator_id = e.id
        WHERE rl.deleted_at IS NULL GROUP BY e.id, e.kode_alat, e.tipe_alat ORDER BY total_prod DESC LIMIT 10
      `);

      const dtRank = await pool.query(`
        SELECT e.kode_alat, e.tipe_alat, SUM(rl.production_volume) as total_prod, COUNT(rl.id) as total_rit
        FROM ritase_logs rl JOIN equipment e ON rl.dump_truck_id = e.id
        WHERE rl.deleted_at IS NULL GROUP BY e.id, e.kode_alat, e.tipe_alat ORDER BY total_prod DESC LIMIT 10
      `);

      const opRank = await pool.query(`
        SELECT u.nama, SUM(rl.production_volume) as total_prod, COUNT(rl.id) as total_rit
        FROM ritase_logs rl JOIN users u ON rl.operator_id = u.id
        WHERE rl.deleted_at IS NULL GROUP BY u.id, u.nama ORDER BY total_prod DESC LIMIT 10
      `);

      res.json({
        topExcavators: excRank.rows,
        topDumpTrucks: dtRank.rows,
        topOperators: opRank.rows
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 9. MTD REPORT (MONTH TO DATE)
  // =========================================================
  static async getMtdReport(req, res) {
    try {
      const result = await pool.query(`
        SELECT tanggal,
               SUM(CASE WHEN material = 'Coal' THEN production_volume ELSE 0 END) as coal,
               SUM(CASE WHEN material = 'Overburden' THEN production_volume ELSE 0 END) as ob
        FROM ritase_logs
        WHERE deleted_at IS NULL AND DATE_TRUNC('month', tanggal) = DATE_TRUNC('month', CURRENT_DATE)
        GROUP BY tanggal ORDER BY tanggal ASC
      `);

      const totalCoalMtd = result.rows.reduce((acc, row) => acc + parseFloat(row.coal || 0), 0);
      const totalObMtd = result.rows.reduce((acc, row) => acc + parseFloat(row.ob || 0), 0);

      res.json({
        dailyTrend: result.rows,
        summary: {
          totalCoalMtd,
          totalObMtd,
          targetCoalMtd: 65000,
          targetObMtd: 250000,
          achievementRate: ((totalCoalMtd / 65000) * 100).toFixed(1)
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 10. YTD REPORT (YEAR TO DATE)
  // =========================================================
  static async getYtdReport(req, res) {
    try {
      const result = await pool.query(`
        SELECT TO_CHAR(tanggal, 'Mon') as bulan,
               SUM(CASE WHEN material = 'Coal' THEN production_volume ELSE 0 END) as coal,
               SUM(CASE WHEN material = 'Overburden' THEN production_volume ELSE 0 END) as ob
        FROM ritase_logs
        WHERE deleted_at IS NULL AND DATE_TRUNC('year', tanggal) = DATE_TRUNC('year', CURRENT_DATE)
        GROUP BY TO_CHAR(tanggal, 'Mon'), DATE_TRUNC('month', tanggal)
        ORDER BY DATE_TRUNC('month', tanggal) ASC
      `);

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 11. PROJECT TO DATE
  // =========================================================
  static async getProjectToDateReport(req, res) {
    try {
      const prod = await pool.query(`
        SELECT 
          SUM(CASE WHEN material = 'Coal' THEN production_volume ELSE 0 END) as total_coal,
          SUM(CASE WHEN material = 'Overburden' THEN production_volume ELSE 0 END) as total_ob
        FROM ritase_logs WHERE deleted_at IS NULL
      `);
      const fuel = await pool.query(`SELECT SUM(fuel_filled) as total_fuel FROM fuel_logs WHERE deleted_at IS NULL`);

      res.json({
        totalCoalMt: parseFloat(prod.rows[0]?.total_coal || 0),
        totalObBcm: parseFloat(prod.rows[0]?.total_ob || 0),
        totalFuelLiter: parseFloat(fuel.rows[0]?.total_fuel || 0),
        avgPhysicalAvailability: '92.4%',
        avgUtilization: '84.8%'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // =========================================================
  // 12. EXECUTIVE DASHBOARD (DARK MODE MINE CONTROL ROOM)
  // =========================================================
  static async getExecutiveDashboard(req, res) {
    try {
      const aiIntelligence = await ProductionAiEngine.analyzeOperationalIntelligence();
      const dailyDash = await pool.query(`
        SELECT 
          SUM(CASE WHEN material = 'Coal' THEN production_volume ELSE 0 END) as coal,
          SUM(CASE WHEN material = 'Overburden' THEN production_volume ELSE 0 END) as ob
        FROM ritase_logs WHERE deleted_at IS NULL AND tanggal = CURRENT_DATE
      `);

      const equipStatus = await pool.query(`
        SELECT status_alat, COUNT(id) as count FROM equipment WHERE deleted_at IS NULL GROUP BY status_alat
      `);

      res.json({
        controlRoomStatus: 'ACTIVE - OPERATIONAL',
        todayCoal: parseFloat(dailyDash.rows[0]?.coal || 0),
        todayOb: parseFloat(dailyDash.rows[0]?.ob || 0),
        equipmentStatus: equipStatus.rows,
        criticalAlarms: [
          { id: 1, level: 'HIGH', message: 'Konsumsi Solar EXC-01 melonjak di atas 45 L/HM', time: '10:15' },
          { id: 2, level: 'MEDIUM', message: 'Antrian Standby Dump Truck di LP Seam 3A melebihi 15 menit', time: '11:40' }
        ],
        dailyCostEstimateRp: '142,500,000',
        aiInsights: aiIntelligence
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // AI Assistant Call Endpoint
  static async getAiInsights(req, res) {
    try {
      const { tanggal, shift_id } = req.query;
      const intelligence = await ProductionAiEngine.analyzeOperationalIntelligence(tanggal, shift_id);
      res.json(intelligence);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = ProductionController;
module.exports.isDozerEquipmentType = isDozerEquipmentType;
module.exports.resolveCapacityUom = resolveCapacityUom;
module.exports.calculateHmTotal = calculateHmTotal;
module.exports.calculateFuelReadingMetrics = calculateFuelReadingMetrics;
module.exports.calculateBreakdownCalendarMetrics = calculateBreakdownCalendarMetrics;
module.exports.calculateUnitPerformanceMetrics = calculateUnitPerformanceMetrics;
module.exports.maintenanceDurationHours = maintenanceDurationHours;
module.exports.normalizeReadyVerification = normalizeReadyVerification;
module.exports.assertIndependentReadyVerifier = assertIndependentReadyVerifier;
module.exports.assertIndependentStandbyReviewer = assertIndependentStandbyReviewer;
module.exports.splitStandbyIntoOperationalSlices = splitStandbyIntoOperationalSlices;
module.exports.operationalDateForInstant = operationalDateForInstant;
module.exports.validateStandbyBatchWindow = validateStandbyBatchWindow;
module.exports.assertStandbySessionIntervals = assertStandbySessionIntervals;
module.exports.assertStandbyLogDeletable = assertStandbyLogDeletable;
module.exports.calculateStandbyMohhControl = calculateStandbyMohhControl;
module.exports.intervalOverlapHours = intervalOverlapHours;
