'use strict';

const DEFAULT_PROJECT = 'PIM Mining Project';

const shiftOrderSql = alias => `CASE WHEN LOWER(${alias}.nama_shift) LIKE '%siang%' THEN 1 WHEN LOWER(${alias}.nama_shift) LIKE '%malam%' THEN 2 ELSE 3 END`;
const finiteNonNegative = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const error = new Error(`${label} harus berupa angka nol atau positif.`);
    error.statusCode = 400;
    throw error;
  }
  return Number(parsed.toFixed(2));
};

async function resolveContext(db, input) {
  const projectName = String(input.projectName || DEFAULT_PROJECT).trim() || DEFAULT_PROJECT;
  const result = await db.query(`
    SELECT ev.id, ev.event_type, ev.effective_date::text, ev.effective_shift_id,
           ev.old_meter_final::float, ev.new_meter_initial::float,
           ev.lifetime_offset::float, ev.reason
    FROM equipment_hm_meter_events ev
    JOIN shifts event_shift ON event_shift.id=ev.effective_shift_id
    JOIN shifts input_shift ON input_shift.id=$4
    WHERE ev.project_name=$1 AND ev.equipment_id=$2
      AND (ev.effective_date<$3::date OR
           (ev.effective_date=$3::date AND ${shiftOrderSql('event_shift')}<=${shiftOrderSql('input_shift')}))
    ORDER BY ev.effective_date DESC, ${shiftOrderSql('event_shift')} DESC, ev.created_at DESC
    LIMIT 1
  `, [projectName, input.equipmentId, input.tanggal, input.shiftId]);
  const event = result.rows[0] || null;
  return {
    event,
    offset: Number(event?.lifetime_offset || 0),
    lifetimeStart: Number((Number(input.hmStart) + Number(event?.lifetime_offset || 0)).toFixed(2)),
    lifetimeFinish: Number((Number(input.hmFinish) + Number(event?.lifetime_offset || 0)).toFixed(2)),
  };
}

async function listEvents(db, { equipmentId, projectName = DEFAULT_PROJECT }) {
  const result = await db.query(`
    SELECT ev.*, ev.effective_date::text AS effective_date,
           ev.old_meter_final::float, ev.new_meter_initial::float,
           ev.previous_offset::float, ev.lifetime_offset::float,
           e.kode_alat, s.nama_shift, u.nama AS created_by_name
    FROM equipment_hm_meter_events ev
    JOIN equipment e ON e.id=ev.equipment_id
    JOIN shifts s ON s.id=ev.effective_shift_id
    LEFT JOIN users u ON u.id=ev.created_by
    WHERE ev.project_name=$1 AND ev.equipment_id=$2
    ORDER BY ev.effective_date DESC, ${shiftOrderSql('s')} DESC, ev.created_at DESC
  `, [projectName, equipmentId]);
  return result.rows;
}

async function createEvent(db, input, actorId) {
  const projectName = String(input.projectName || DEFAULT_PROJECT).trim() || DEFAULT_PROJECT;
  const equipmentId = String(input.equipmentId || '').trim();
  const effectiveDate = String(input.effectiveDate || '').trim();
  const effectiveShiftId = String(input.effectiveShiftId || '').trim();
  const reason = String(input.reason || '').trim();
  if (!equipmentId || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !effectiveShiftId) {
    const error = new Error('Unit, tanggal efektif, dan shift efektif wajib diisi.');
    error.statusCode = 400;
    throw error;
  }
  if (reason.length < 5) {
    const error = new Error('Alasan penggantian/reset HM minimal 5 karakter.');
    error.statusCode = 400;
    throw error;
  }
  const oldFinal = finiteNonNegative(input.oldMeterFinal, 'HM akhir meter lama');
  const newInitial = finiteNonNegative(input.newMeterInitial, 'HM awal meter baru');
  const eventType = String(input.eventType || 'replacement').toLowerCase();
  if (!['installation', 'replacement', 'reset'].includes(eventType)) {
    const error = new Error('Jenis event HM tidak valid.');
    error.statusCode = 400;
    throw error;
  }

  const shiftResult = await db.query('SELECT id,nama_shift FROM shifts WHERE id=$1', [effectiveShiftId]);
  const equipmentResult = await db.query('SELECT id,kode_alat FROM equipment WHERE id=$1 AND deleted_at IS NULL', [equipmentId]);
  if (!shiftResult.rows.length || !equipmentResult.rows.length) {
    const error = new Error('Unit atau shift tidak ditemukan.');
    error.statusCode = 404;
    throw error;
  }
  const eventOrder = shiftResult.rows[0].nama_shift.toLowerCase().includes('siang') ? 1 : shiftResult.rows[0].nama_shift.toLowerCase().includes('malam') ? 2 : 3;
  const later = await db.query(`
    SELECT ev.id FROM equipment_hm_meter_events ev JOIN shifts s ON s.id=ev.effective_shift_id
    WHERE ev.project_name=$1 AND ev.equipment_id=$2
      AND (ev.effective_date>$3::date OR (ev.effective_date=$3::date AND ${shiftOrderSql('s')}>=$4))
    LIMIT 1 FOR UPDATE
  `, [projectName, equipmentId, effectiveDate, eventOrder]);
  if (later.rows.length) {
    const error = new Error('Event HM harus lebih baru dari event terakhir unit. Koreksi histori memerlukan proses rekonsiliasi khusus.');
    error.statusCode = 409;
    throw error;
  }
  const previous = await db.query(`
    SELECT ev.lifetime_offset::float FROM equipment_hm_meter_events ev
    JOIN shifts s ON s.id=ev.effective_shift_id
    WHERE ev.project_name=$1 AND ev.equipment_id=$2
      AND (ev.effective_date<$3::date OR (ev.effective_date=$3::date AND ${shiftOrderSql('s')}<$4))
    ORDER BY ev.effective_date DESC, ${shiftOrderSql('s')} DESC, ev.created_at DESC LIMIT 1
  `, [projectName, equipmentId, effectiveDate, eventOrder]);
  const previousOffset = Number(previous.rows[0]?.lifetime_offset || 0);
  const lifetimeOffset = Number((previousOffset + oldFinal - newInitial).toFixed(2));

  const inserted = await db.query(`
    INSERT INTO equipment_hm_meter_events (
      project_name,equipment_id,event_type,effective_date,effective_shift_id,
      old_meter_final,new_meter_initial,previous_offset,lifetime_offset,
      old_meter_serial,new_meter_serial,reason,evidence_url,created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *, effective_date::text AS effective_date
  `, [projectName, equipmentId, eventType, effectiveDate, effectiveShiftId, oldFinal, newInitial,
    previousOffset, lifetimeOffset, String(input.oldMeterSerial || '').trim() || null,
    String(input.newMeterSerial || '').trim() || null, reason,
    String(input.evidenceUrl || '').trim() || null, actorId || null]);
  const event = inserted.rows[0];

  await db.query(`
    UPDATE mining_production_logs mpl
    SET hm_meter_event_id=$1,
        hm_lifetime_start=ROUND((mpl.hm_start+$2)::numeric,2),
        hm_lifetime_finish=ROUND((mpl.hm_finish+$2)::numeric,2),
        updated_at=CURRENT_TIMESTAMP
    FROM shifts log_shift
    WHERE log_shift.id=mpl.shift_id AND mpl.project_name=$3 AND mpl.equipment_id=$4
      AND (mpl.tanggal>$5::date OR (mpl.tanggal=$5::date AND ${shiftOrderSql('log_shift')}>=$6))
  `, [event.id, lifetimeOffset, projectName, equipmentId, effectiveDate, eventOrder]);

  return { ...event, kode_alat: equipmentResult.rows[0].kode_alat, nama_shift: shiftResult.rows[0].nama_shift };
}

module.exports = { DEFAULT_PROJECT, resolveContext, listEvents, createEvent, finiteNonNegative };
