(function attachFleetDeploymentCore(root, factory) {
  const api = factory();
  if (root) root.FleetDeploymentCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFleetDeploymentCore() {
  'use strict';

  const STATUS_LABEL = Object.freeze({ draft: 'Draft', validated: 'Validated', published: 'Published', closed: 'Closed', cancelled: 'Cancelled', legacy: 'Legacy read-only' });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const localIso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  function isoDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return localIso(value);
    const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }
  function addDays(value, count) { const iso = isoDate(value); if (!iso) return ''; const date = new Date(`${iso}T12:00:00`); date.setDate(date.getDate() + count); return localIso(date); }
  function daysInclusive(start, end) { const from = isoDate(start); const to = isoDate(end); if (!from || !to) return 0; return Math.max(0, Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1); }
  function number(value, digits = 0) { return Number(value || 0).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
  function formatPeriod(start, end) {
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const parts = value => isoDate(value).split('-').map(Number);
    const [sy, sm, sd] = parts(start); const [ey, em, ed] = parts(end);
    if (![sy, sm, sd, ey, em, ed].every(Number.isFinite)) return `${start || '-'} → ${end || '-'}`;
    if (sy === ey && sm === em) return `${String(sd).padStart(2, '0')}–${String(ed).padStart(2, '0')} ${months[sm - 1]} ${sy}`;
    return `${String(sd).padStart(2, '0')} ${months[sm - 1]} ${sy} – ${String(ed).padStart(2, '0')} ${months[em - 1]} ${ey}`;
  }
  function summarize(rows) {
    const active = rows.filter(row => !['cancelled'].includes(row.status));
    return {
      schemes: active.length,
      fleets: active.reduce((sum, row) => sum + Number(row.fleet_count || 0), 0),
      drafts: active.filter(row => row.status === 'draft').length,
      conflicts: active.reduce((sum, row) => sum + Number(row.conflict_count || 0), 0),
      unassigned: active.reduce((sum, row) => sum + Number(row.warning_count || 0), 0),
      published: active.filter(row => ['published', 'closed'].includes(row.status)).length,
      warnings: active.reduce((sum, row) => sum + Number(row.warning_count || 0), 0),
      ob: active.filter(row => row.productivity_unit === 'BCM/Hr').reduce((sum, row) => sum + Number(row.planned_production || 0), 0),
      coal: active.filter(row => row.productivity_unit === 'Ton/Hr').reduce((sum, row) => sum + Number(row.planned_production || 0), 0),
    };
  }
  function filterRows(rows, filters) {
    const query = String(filters.search || '').trim().toLocaleLowerCase('id-ID');
    return rows.filter(row => (!filters.status || row.status === filters.status)
      && (!filters.area || row.pit_area_snapshot === filters.area)
      && (!filters.job || row.job_code_snapshot === filters.job)
      && (!filters.material || row.material_snapshot === filters.material)
      && (!filters.from || isoDate(row.date_end) >= filters.from)
      && (!filters.to || isoDate(row.date_start) <= filters.to)
      && (!query || [row.name, row.pit_area_snapshot, row.job_code_snapshot, row.material_snapshot]
        .some(value => String(value || '').toLocaleLowerCase('id-ID').includes(query))));
  }
  function defaultDates() { const today = localIso(new Date()); return { start: today, end: addDays(today, 6) }; }
  const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID');
  function catalogForContext(catalog, context) {
    return (catalog || []).filter(plan => (!context.jobCode || String(plan.jobCode || '').toUpperCase() === String(context.jobCode).toUpperCase())
      && (!context.material || normalize(plan.material) === normalize(context.material))
      && (!context.planningType || plan.planningType === context.planningType));
  }
  function fleetCandidates(excavators, catalog, context) {
    const matching = catalogForContext(catalog, context);
    return (excavators || []).map(unit => {
      const plan = matching.find(item => String(item.equipmentId || '') === String(unit.id)
        || normalize(item.loaderCode) === normalize(unit.kode_alat));
      return {
        selectionRef: `equipment:${unit.id}`,
        equipmentId: unit.id,
        loaderCode: unit.kode_alat,
        equipmentType: unit.tipe_alat,
        equipmentClass: unit.class_unit,
        plan: plan || null,
        complete: Boolean(plan && Number(plan.fleetProductivity) > 0),
      };
    });
  }
  return { STATUS_LABEL, esc, localIso, isoDate, addDays, daysInclusive, number, formatPeriod, summarize, filterRows, defaultDates,
    catalogForContext, fleetCandidates };
});
