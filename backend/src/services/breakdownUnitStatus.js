'use strict';

const DEFAULT_DURATION_THRESHOLDS = Object.freeze({
  warningHours: 12,
  criticalHours: 24,
  basis: 'Satu shift operasional (12 jam) dan standar kritis Breakdown Report (24 jam).',
});

function text(value) {
  return String(value ?? '').trim();
}

function masterSaysBreakdown(value) {
  return /^breakdown$/i.test(text(value));
}

function durationLevel(hours, thresholds = DEFAULT_DURATION_THRESHOLDS) {
  const value = Number(hours || 0);
  if (value >= Number(thresholds.criticalHours)) return 'critical';
  if (value >= Number(thresholds.warningHours)) return 'warning';
  return 'normal';
}

function naturalCompare(left, right) {
  return text(left).localeCompare(text(right), 'id-ID', { numeric: true, sensitivity: 'base' });
}

function buildBreakdownUnitStatus(equipmentRows, activeBreakdownRows, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const thresholds = { ...DEFAULT_DURATION_THRESHOLDS, ...(options.thresholds || {}) };
  const activeByEquipment = new Map();

  for (const incident of activeBreakdownRows || []) {
    const key = text(incident.equipment_id);
    if (!key) continue;
    const collection = activeByEquipment.get(key) || [];
    collection.push(incident);
    activeByEquipment.set(key, collection);
  }

  const equipmentIds = new Set((equipmentRows || []).map(unit => text(unit.id)).filter(Boolean));
  const issues = [];
  for (const [equipmentId, incidents] of activeByEquipment) {
    if (!equipmentIds.has(equipmentId)) {
      issues.push({
        code: 'ORPHAN_ACTIVE_BREAKDOWN',
        severity: 'critical',
        equipmentId,
        unitCode: text(incidents[0]?.kode_alat) || equipmentId,
        message: 'Breakdown aktif tidak memiliki unit aktif pada List Equipment.',
      });
    }
  }

  const units = (equipmentRows || []).map(unit => {
    const incidents = [...(activeByEquipment.get(text(unit.id)) || [])]
      .sort((a, b) => new Date(b.start_time || 0) - new Date(a.start_time || 0));
    const activeIncident = incidents[0] || null;
    const status = activeIncident ? 'BD' : 'Ready';
    const hours = activeIncident ? Number(activeIncident.elapsed_breakdown_hours || 0) : 0;
    const unitIssues = [];

    if (incidents.length > 1) {
      unitIssues.push({
        code: 'MULTIPLE_ACTIVE_BREAKDOWNS',
        severity: 'critical',
        message: `${incidents.length} breakdown aktif ditemukan pada unit yang sama.`,
      });
    }
    const masterBreakdown = masterSaysBreakdown(unit.status_alat);
    if ((status === 'BD' && !masterBreakdown) || (status === 'Ready' && masterBreakdown)) {
      unitIssues.push({
        code: 'STATUS_MASTER_MISMATCH',
        severity: 'warning',
        message: `Status List Equipment "${text(unit.status_alat) || 'kosong'}" tidak sama dengan status turunan ${status}.`,
      });
    }

    const result = {
      equipmentId: text(unit.id),
      unitCode: text(unit.kode_alat) || 'Unit',
      equipmentType: text(unit.kelas_alat) || 'Tanpa Jenis',
      equipmentClass: text(unit.class_unit),
      model: text(unit.tipe_alat),
      location: text(unit.lokasi),
      masterStatus: text(unit.status_alat),
      status,
      activeBreakdownCount: incidents.length,
      activeIncident: activeIncident ? {
        id: text(activeIncident.id),
        currentStatus: text(activeIncident.current_status),
        startTime: activeIncident.start_time,
        elapsedHours: hours,
        durationLevel: durationLevel(hours, thresholds),
        breakdownCode: text(activeIncident.kode_breakdown),
        breakdownCategory: text(activeIncident.kategori_breakdown),
        description: text(activeIncident.description),
        picName: text(activeIncident.pic_name),
      } : null,
      dataQuality: unitIssues,
    };
    unitIssues.forEach(issue => issues.push({ ...issue, equipmentId: result.equipmentId, unitCode: result.unitCode }));
    return result;
  });

  units.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'BD' ? -1 : 1;
    if (a.status === 'BD') {
      const durationDelta = Number(b.activeIncident?.elapsedHours || 0) - Number(a.activeIncident?.elapsedHours || 0);
      if (durationDelta) return durationDelta;
    }
    return naturalCompare(a.unitCode, b.unitCode);
  });

  const groupMap = new Map();
  for (const unit of units) {
    const group = groupMap.get(unit.equipmentType) || {
      equipmentType: unit.equipmentType,
      total: 0,
      ready: 0,
      breakdown: 0,
      units: [],
    };
    group.total += 1;
    if (unit.status === 'BD') group.breakdown += 1;
    else group.ready += 1;
    group.units.push(unit);
    groupMap.set(unit.equipmentType, group);
  }

  const groups = [...groupMap.values()].sort((a, b) => naturalCompare(a.equipmentType, b.equipmentType));
  const breakdown = units.filter(unit => unit.status === 'BD').length;
  return {
    generatedAt,
    formulaVersion: 'breakdown-unit-status-v1',
    source: {
      population: 'equipment.active',
      breakdown: 'breakdown_logs.open',
      readyDefinition: 'Tidak memiliki breakdown aktif.',
    },
    thresholds,
    summary: { total: units.length, ready: units.length - breakdown, breakdown },
    reconciliation: {
      status: issues.length ? 'needs_attention' : 'matched',
      issueCount: issues.length,
      issues,
    },
    groups,
  };
}

module.exports = {
  DEFAULT_DURATION_THRESHOLDS,
  buildBreakdownUnitStatus,
  durationLevel,
};
