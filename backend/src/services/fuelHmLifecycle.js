'use strict';

const HmMeterLifecycle = require('./hmMeterLifecycle');

const FORMULA_VERSION = 'fuel-hm-lifecycle-v1';
const COMPARABLE_STATUSES = new Set(['baseline', 'derived', 'needs_reconciliation']);
const shiftOrderSql = alias => `CASE WHEN LOWER(${alias}.nama_shift) LIKE '%siang%' THEN 1 WHEN LOWER(${alias}.nama_shift) LIKE '%malam%' THEN 2 ELSE 3 END`;

function isComparableStatus(value) {
  return COMPARABLE_STATUSES.has(String(value || '').trim());
}

async function resolveReading(db, input) {
  if (input.hmReading === null || input.hmReading === undefined) {
    return { event: null, offset: 0, lifetimeReading: null };
  }
  const context = await HmMeterLifecycle.resolveContext(db, {
    projectName: input.projectName,
    equipmentId: input.equipmentId,
    tanggal: input.tanggal,
    shiftId: input.shiftId,
    hmStart: input.hmReading,
    hmFinish: input.hmReading,
  });
  return {
    event: context.event,
    offset: Number(context.offset || 0),
    lifetimeReading: Number(context.lifetimeFinish),
  };
}

function lineageWarning(status) {
  if (status === 'legacy_unreconciled') return {
    code: 'HM_LEGACY_UNRECONCILED',
    message: 'Basis HM Fuel lama belum direkonsiliasi dengan lifecycle meter.',
  };
  if (status === 'baseline') return {
    code: 'HM_BASELINE_MISSING',
    message: 'Pembacaan menjadi baseline Lifetime HM; rasio dimulai dari transaksi berikutnya.',
  };
  if (status === 'needs_reconciliation') return {
    code: 'HM_LIFETIME_NOT_INCREASING',
    message: 'Lifetime HM tidak meningkat dan perlu direkonsiliasi.',
  };
  return null;
}

async function recalculateChain(db, equipmentId, options = {}) {
  const result = await db.query(`
    SELECT fl.*, fl.hm_reading::float AS hm_reading_value,
           fl.hm_lifetime_reading::float AS hm_lifetime_reading_value,
           fl.hm_lineage_status, fl.fuel_filled::float, e.fuel_rate_lph::float,
           fl.anomaly_details
    FROM fuel_logs fl
    JOIN equipment e ON e.id=fl.equipment_id
    JOIN shifts s ON s.id=fl.shift_id
    WHERE fl.equipment_id=$1 AND fl.deleted_at IS NULL
    ORDER BY fl.tanggal, ${shiftOrderSql('s')}, fl.created_at, fl.id
    FOR UPDATE OF fl
  `, [equipmentId]);

  let previousLifetime = null;
  const updated = [];
  for (const row of result.rows) {
    if (row.hm_lineage_status === 'legacy_unreconciled' || row.hm_lifetime_reading_value === null) {
      previousLifetime = null;
      continue;
    }
    const current = Number(row.hm_lifetime_reading_value);
    const delta = previousLifetime !== null && current > previousLifetime ? current - previousLifetime : null;
    const status = previousLifetime === null ? 'baseline' : delta === null ? 'needs_reconciliation' : 'derived';
    const fuel = Number(row.fuel_filled || 0);
    const rate = Number(row.fuel_rate_lph);
    const fuelPerHm = delta > 0 ? fuel / delta : null;
    const targetFuel = delta > 0 && Number.isFinite(rate) ? rate * delta : null;
    const variancePct = targetFuel > 0 ? ((fuel - targetFuel) / targetFuel) * 100 : null;
    const existing = row.anomaly_details && typeof row.anomaly_details === 'object' ? row.anomaly_details : {};
    const hmCodes = new Set(['HM_BASELINE_MISSING','HM_NOT_INCREASING','HM_LIFETIME_NOT_INCREASING','HM_LEGACY_UNRECONCILED','HIGH_FUEL_VARIANCE','METER_RESET']);
    const warnings = (Array.isArray(existing.warnings) ? existing.warnings : []).filter(item => !hmCodes.has(item?.code));
    const issues = (Array.isArray(existing.issues) ? existing.issues : []).filter(item => !hmCodes.has(item?.code));
    const lineage = lineageWarning(status);
    if (lineage && status !== 'needs_reconciliation') warnings.push(lineage);
    if (variancePct !== null && variancePct > 20) warnings.push({
      code: 'HIGH_FUEL_VARIANCE',
      message: `Fuel ${variancePct.toFixed(1)}% di atas target Standard Fuel Rate.`,
    });
    if (status === 'needs_reconciliation' && lineage) issues.push(lineage);
    const details = {
      formula_version: FORMULA_VERSION,
      warnings,
      issues,
    };
    const saved = await db.query(`
      UPDATE fuel_logs
      SET hm_delta=$1, total_hm=COALESCE($1,0::numeric), fuel_per_hm=$2,
          hm_lineage_status=$3, hm_lineage_reason=$4,
          anomaly_status=$5, anomaly_details=$6::jsonb, updated_at=CURRENT_TIMESTAMP
      WHERE id=$7 RETURNING *
    `, [delta, fuelPerHm, status, lineage?.message || null,
      issues.length ? 'critical' : warnings.length ? 'warning' : 'normal',
      JSON.stringify(details), row.id]);
    const changed = Number(row.hm_delta) !== Number(delta)
      || Number(row.fuel_per_hm) !== Number(fuelPerHm)
      || row.hm_lineage_status !== status
      || String(row.hm_lineage_reason || '') !== String(lineage?.message || '');
    if (changed && options.actorId && saved.rows[0]) {
      await db.query(`INSERT INTO fuel_log_audit (fuel_log_id,action,before_data,after_data,changed_by)
        VALUES ($1,'recalculate:hm-lifecycle',$2::jsonb,$3::jsonb,$4)`,
      [row.id, JSON.stringify(row), JSON.stringify(saved.rows[0]), options.actorId]);
    }
    updated.push(row.id);
    previousLifetime = current;
  }
  return updated;
}

async function attachEventToDerivedLogs(db, event, actorId = null) {
  const shift = await db.query(`SELECT ${shiftOrderSql('shifts')} AS shift_order FROM shifts WHERE id=$1`, [event.effective_shift_id]);
  if (!shift.rows.length) return [];
  const result = await db.query(`
    UPDATE fuel_logs fl
    SET hm_meter_event_id=$1,
        hm_lifetime_reading=ROUND((fl.hm_reading+$2)::numeric,2),
        updated_at=CURRENT_TIMESTAMP
    FROM shifts log_shift
    WHERE log_shift.id=fl.shift_id AND fl.equipment_id=$3
      AND fl.deleted_at IS NULL AND fl.hm_lineage_status<>'legacy_unreconciled'
      AND (fl.tanggal>$4::date OR (fl.tanggal=$4::date AND ${shiftOrderSql('log_shift')}>=$5))
    RETURNING fl.id
  `, [event.id, Number(event.lifetime_offset || 0), event.equipment_id,
    event.effective_date, Number(shift.rows[0].shift_order)]);
  await recalculateChain(db, event.equipment_id, { actorId });
  return result.rows.map(row => row.id);
}

module.exports = {
  FORMULA_VERSION,
  isComparableStatus,
  resolveReading,
  lineageWarning,
  recalculateChain,
  attachEventToDerivedLogs,
};
