function parseTimeMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function getWibClock(date = new Date()) {
  const shifted = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  return {
    date: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`,
    minutes: (shifted.getUTCHours() * 60) + shifted.getUTCMinutes(),
    display: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`,
  };
}

function selectAttendanceShift(shifts, currentMinutes, preferredShiftId = null) {
  const candidates = (Array.isArray(shifts) ? shifts : [])
    .map((shift) => ({ shift, start: parseTimeMinutes(shift?.operational_start) }))
    .filter((candidate) => candidate.start !== null)
    .sort((a, b) => a.start - b.start);
  if (preferredShiftId) {
    return candidates.find(({ shift }) => String(shift.id) === String(preferredShiftId))?.shift || null;
  }
  if (!candidates.length) return null;

  const normalizedCurrent = ((currentMinutes % 1440) + 1440) % 1440;
  // Tanpa pembatasan jam absensi: bila karyawan tidak memiliki shift roster/
  // akun, gunakan shift operasional terakhir yang sudah mulai.
  return (candidates.filter(({ start }) => start <= normalizedCurrent).at(-1) || candidates.at(-1)).shift;
}

// Anchor perpindahan shift berbasis jam WIB (mengikuti pola PROJECT):
//   - 03:00–15:59  → Shift Siang (hari kalender yang sama)
//   - 16:00–02:59  → Shift Malam
// Shift absen DITENTUKAN dari jam server, bukan dari shift akun/roster.
// Roster hanya dipakai untuk sinkronisasi SETELAH absen tersimpan.
// Tanggal operasional shift malam:
//   - absen 16:00–23:59 → hari kalender yang sama (shift malam hari ini)
//   - absen 00:00–02:59 → hari kalender sebelumnya (masih shift malam kemarin)
function selectShiftByClock(shifts, clock) {
  const minutes = Number(clock?.minutes);
  if (!Number.isFinite(minutes)) return { shift: null, tanggalOperasional: null };
  const isMalam = !(minutes >= 180 && minutes < 960); // 03:00=180, 16:00=960
  const target = isMalam ? 'malam' : 'siang';
  const list = Array.isArray(shifts) ? shifts : [];
  const shift = list.find((s) => String(s?.nama_shift || '').toLowerCase().includes(target)) || null;
  if (!shift) return { shift: null, tanggalOperasional: null };

  let tanggalOperasional = String(clock.date || '');
  if (shift.lintas_hari && minutes < 960) {
    // Dini hari (00:00–02:59) masih merupakan shift malam hari sebelumnya.
    tanggalOperasional = shiftDate(tanggalOperasional, -1);
  }
  return { shift, tanggalOperasional };
}

function shiftDate(isoDate, deltaDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return String(isoDate || '');
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function operationalDateForShift(clock, shift) {
  const date = String(clock?.date || '');
  const start = parseTimeMinutes(shift?.operational_start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || start === null) return date;
  if (!shift?.lintas_hari || Number(clock.minutes) >= start) return date;
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function rosterStatusForShift(shift) {
  if (!shift) return null;
  if (typeof shift.lintas_hari === 'boolean') {
    return shift.lintas_hari ? 'M' : 'S';
  }
  const start = parseTimeMinutes(shift.operational_start);
  const end = parseTimeMinutes(shift.operational_end);
  if (start === null || end === null || start === end) return null;
  return end < start ? 'M' : 'S';
}

module.exports = {
  parseTimeMinutes,
  getWibClock,
  selectAttendanceShift,
  selectShiftByClock,
  shiftDate,
  operationalDateForShift,
  rosterStatusForShift,
};
