const { pool } = require('../config/db');
const People = require('../services/peopleEmployees');
const { dalamRadius, dalamRadiusMultiPoint, validasiAkurasi, MAX_ACCURACY_METER } = require('../utils/geofence');
const { autoCloseExpiredSessions } = require('../services/attendanceSession');
const { getRosterForUserDate } = require('../services/roster');
const {
  getWibClock,
  selectShiftByClock,
  rosterStatusForShift,
} = require('../services/attendancePolicy');
const { statusAbsenDatang, statusAbsenPulang } = require('../utils/shiftValidator');
const { verifikasiWajah } = require('../services/compreface');
const { uploadFoto, getUrlFoto, hapusFoto } = require('../services/storage');
const { ensureHmDailySchema } = require('../services/hmDaily');
const { getHmPayableDailyRows } = require('../services/hmWorklog');
const { cacheGet, cacheSet, cacheDel, LOCATIONS_KEY } = require('../utils/cache');

// ── Cache helper ──────────────────────────────────────────────────────────
// Data lokasi kantor & shift jarang berubah. Cache di memori (TTL) untuk
// menghindari query DB berulang yang menjadi bottleneck latency absensi.

const LOCATIONS_TTL_MS = 60 * 1000; // 60 detik
const SHIFT_ID_CACHE_KEY_PREFIX = 'shift:id:';
const SHIFT_TTL_MS = 10 * 60 * 1000; // 10 menit
const MAX_EMPLOYEE_REPORT_RANGE_DAYS = 366;

function parseEmployeeReportDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${label} wajib memakai format YYYY-MM-DD`);
    error.statusCode = 400;
    throw error;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    const error = new Error(`${label} tidak valid`);
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function resolveEmployeeReportRange(query = {}, fallback = null) {
  const startValue = query.tanggal_mulai;
  const endValue = query.tanggal_akhir;
  if (!startValue && !endValue) return fallback;
  if (!startValue || !endValue) {
    const error = new Error('Tanggal awal dan tanggal akhir wajib diisi bersama');
    error.statusCode = 400;
    throw error;
  }
  const start = parseEmployeeReportDate(startValue, 'Tanggal awal');
  const end = parseEmployeeReportDate(endValue, 'Tanggal akhir');
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < 1) {
    const error = new Error('Tanggal akhir tidak boleh mendahului tanggal awal');
    error.statusCode = 400;
    throw error;
  }
  if (days > MAX_EMPLOYEE_REPORT_RANGE_DAYS) {
    const error = new Error(`Rentang periode maksimal ${MAX_EMPLOYEE_REPORT_RANGE_DAYS} hari`);
    error.statusCode = 400;
    throw error;
  }
  return { start: startValue, end: endValue, days };
}

function currentWibMonthRange() {
  const today = getWibClock().date;
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    days: lastDay,
  };
}

function employeeReportPeriodLabel(startValue, endValue) {
  const start = parseEmployeeReportDate(startValue, 'Tanggal awal');
  const end = parseEmployeeReportDate(endValue, 'Tanggal akhir');
  const short = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (startValue.slice(0, 7) === endValue.slice(0, 7) && start.getUTCDate() === 1) {
    const monthEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    if (end.getUTCDate() === monthEnd) {
      return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
    }
  }
  return `${short.format(start)} – ${short.format(end)}`;
}

async function getUserLengkap(userId) {
  const { rows } = await pool.query(
    `SELECT u.*, l.nama_lokasi, l.latitude, l.longitude, l.radius_meter
     FROM users u
     LEFT JOIN lokasi_kantor l ON l.id = u.lokasi_kantor_id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0];
}

async function getSemuaLokasiKantor() {
  // Cache daftar lokasi kantor → hilangkan query berulang di tiap request.
  const cached = cacheGet(LOCATIONS_KEY);
  if (cached) return cached;

  const { rows } = await pool.query(`SELECT id, nama_lokasi, latitude, longitude, radius_meter FROM lokasi_kantor`);
  const hasil = rows || [];
  cacheSet(LOCATIONS_KEY, hasil, LOCATIONS_TTL_MS);
  return hasil;
}

/**
 * Lokasi absen yang berlaku untuk karyawan (OMOS People v2).
 * Tidak ada baris di employee_attendance_locations = boleh di semua lokasi
 * (perilaku lama). Bila tabel belum dimigrasi, juga jatuh ke semua lokasi.
 */
async function getLokasiAbsenKaryawan(userId) {
  const semua = await getSemuaLokasiKantor();
  let diizinkan = null;
  try {
    diizinkan = await People.getAllowedLocations(pool, userId);
  } catch (err) {
    if (err.code !== '42P01') throw err; // 42P01 = tabel belum ada (migrasi 094 belum jalan)
  }
  return { lokasi: diizinkan || semua, terbatas: Boolean(diizinkan) };
}

function pesanDiLuarLokasi(lokasiAbsen, jarak) {
  if (lokasiAbsen.terbatas) {
    const nama = lokasiAbsen.lokasi.map(l => l.nama_lokasi).join(', ');
    return `Di luar radius lokasi absen Anda (${nama}); jarak terdekat ${jarak}m`;
  }
  return `Di luar radius seluruh area kantor & tambang resmi (jarak terdekat ${jarak}m)`;
}

async function getShift(shiftId) {
  const cacheKey = SHIFT_ID_CACHE_KEY_PREFIX + shiftId;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const { rows } = await pool.query(
    `SELECT * FROM shifts WHERE id = $1`,
    [shiftId]
  );
  const shift = rows[0];
  if (shift) cacheSet(cacheKey, shift, SHIFT_TTL_MS);
  return shift;
}

async function getSesiPending(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM absensi WHERE user_id = $1 AND waktu_pulang IS NULL
     ORDER BY tanggal_kerja DESC LIMIT 1`,
    [userId]
  );
  return rows[0];
}

async function cleanupFailedAttendancePhoto(value) {
  if (!value) return;
  try {
    await hapusFoto(value);
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'attendance_orphan_photo_cleanup_failed',
      error: error.message,
    }));
  }
}

function parseCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    const error = new Error('Koordinat lokasi tidak valid');
    error.statusCode = 400;
    throw error;
  }
  return { lat, lng };
}

function logAttendanceDecision(req, {
  action,
  outcome,
  reasonCode,
  userId,
  accuracy = null,
  distanceMeter = null,
  locationId = null,
}) {
  const payload = {
    level: outcome === 'rejected' ? 'warn' : 'info',
    event: 'attendance_decision',
    request_id: req.id,
    action,
    outcome,
    reason_code: reasonCode,
    user_id: userId || req.user?.id || null,
  };
  if (accuracy !== null && accuracy !== '' && Number.isFinite(Number(accuracy))) payload.accuracy_meter = Math.round(Number(accuracy));
  if (distanceMeter !== null && distanceMeter !== '' && Number.isFinite(Number(distanceMeter))) payload.distance_meter = Math.round(Number(distanceMeter));
  if (locationId) payload.location_id = locationId;
  const output = JSON.stringify(payload);
  if (outcome === 'rejected') console.warn(output);
  else console.log(output);
}

/**
 * Sinkronkan roster harian agar sesuai dengan shift aktual hasil absen kamera.
 * Hanya beraksi bila terjadi konflik (roster terencana ≠ shift aktual kamera).
 * Seluruh perubahan dicatat ke roster_audit_log untuk traceability.
 */
async function syncRosterFromCamera({ userId, tanggal, shift, rosterPlan, attendanceId }) {
  const actualStatus = rosterStatusForShift(shift);
  const conflict = Boolean(actualStatus && rosterPlan && rosterPlan.status !== actualStatus);
  if (!conflict) return { conflict: false, synced: false, actualStatus };

  const catatan = `Sinkron otomatis hadir kamera: ${rosterPlan.status} -> ${actualStatus}`;
  try {
    await pool.query(
      `INSERT INTO employee_roster_daily
         (user_id,tanggal,status,shift_id,assignment_id,source,catatan,updated_by)
       VALUES ($1,$2::date,$3::varchar,$4,$5,'manual_override',$6,NULL)
       ON CONFLICT (user_id,tanggal) DO UPDATE SET
         status=EXCLUDED.status,
         shift_id=EXCLUDED.shift_id,
         assignment_id=COALESCE(employee_roster_daily.assignment_id,EXCLUDED.assignment_id),
         source='manual_override',
         catatan=EXCLUDED.catatan,
         updated_by=NULL,
         updated_at=now()
       RETURNING status,source`,
      [userId, tanggal, actualStatus, shift.id, rosterPlan.assignment_id || null, catatan],
    );
    await pool.query(
      `INSERT INTO roster_audit_log (admin_id,user_id,aksi,detail)
       VALUES (NULL,$1,'sync_camera_shift',$2::jsonb)`,
      [userId, JSON.stringify({
        tanggal,
        attendance_id: attendanceId,
        roster_before: rosterPlan.status,
        roster_after: actualStatus,
        shift_id: shift.id,
        shift_name: shift.nama_shift,
      })],
    );
    console.log(JSON.stringify({
      level: 'info',
      message: 'attendance_roster_synced',
      userId,
      tanggal,
      rosterBefore: rosterPlan.status,
      rosterAfter: actualStatus,
      attendanceId,
    }));
    return { conflict: true, synced: true, actualStatus };
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'attendance_roster_sync_failed',
      userId,
      tanggal,
      rosterBefore: rosterPlan.status,
      rosterAfter: actualStatus,
      error: error.message,
    }));
    return { conflict: true, synced: false, actualStatus };
  }
}

/**
 * POST /api/absensi/datang
 * body: { latitude, longitude }
 * file: foto (multipart, field name 'foto')
 */
async function absenDatang(req, res, next) {
  let fotoKey = null;
  try {
    const { latitude, longitude, accuracy } = req.body;
    if (latitude === undefined || longitude === undefined || !req.file) {
      return res.status(400).json({ error: 'latitude, longitude, dan foto wajib dikirim' });
    }

    const sekarang = new Date();

    const clockWib = getWibClock(sekarang);

    const { lat, lng } = parseCoordinates(latitude, longitude);

    // Validasi akurasi GPS (bila klien mengirimnya). Tolak bila terlalu kasar.
    const cekAkurasi = validasiAkurasi(accuracy);
    if (!cekAkurasi.valid) {
      logAttendanceDecision(req, { action: 'datang', outcome: 'rejected', reasonCode: 'GPS_ACCURACY_REJECTED', accuracy });
      return res.status(403).json({ code: 'ATTENDANCE_GPS_ACCURACY_REJECTED', error: cekAkurasi.reason });
    }

    const user = await getUserLengkap(req.user.id);
    if (!user) return res.status(404).json({ error: 'Data karyawan tidak ditemukan' });

    const { rows: shifts } = await pool.query('SELECT * FROM shifts ORDER BY operational_start ASC');
    // Shift absen DITENTUKAN dari jam server (anchor 16:00 & 03:00) mengikuti
    // pola PROJECT. Roster hanya dipakai untuk sinkronisasi SETELAH absen
    // tersimpan, bukan sebagai penentu shift. Ini memperbaiki kasus karyawan
    // yang absen 16:00–18:00 seharusnya masuk shift Malam namun sebelumnya
    // ditempatkan ke shift Siang karena shift akun/roster default Siang.
    const { shift, tanggalOperasional } = selectShiftByClock(shifts, clockWib);
    if (!shift) {
      return res.status(503).json({
        code: 'ATTENDANCE_SHIFT_UNCONFIGURED',
        error: 'Master shift absensi belum dikonfigurasi dengan benar oleh admin.',
      });
    }
    const roster = await getRosterForUserDate(user.id, tanggalOperasional);
    const shift_id = shift.id;

    // Gabungkan data user dan shift untuk validator
    const userDenganShift = { ...user, ...shift };

    // 1. Tutup otomatis sesi yang sudah kedaluwarsa (> 13 jam) milik karyawan ini.
    //    Mencegah "sesi menggantung" (mis. absen datang berhasil tapi absen pulang
    //    gagal karena di luar radius) yang memblokir absen datang berikutnya.
    await autoCloseExpiredSessions(user.id);

    // 2. Cek sesi yang masih aktif (belum checkout & belum kedaluwarsa) — wajib diselesaikan dulu
    const sesiPending = await getSesiPending(user.id);
    if (sesiPending) {
      logAttendanceDecision(req, { action: 'datang', outcome: 'rejected', reasonCode: 'ACTIVE_SESSION_EXISTS', userId: user.id });
      return res.status(409).json({
        code: 'ATTENDANCE_ACTIVE_SESSION_EXISTS',
        error: 'Ada sesi absen sebelumnya yang belum checkout. Selesaikan absen pulang dulu.',
        absensi_id_pending: sesiPending.id,
      });
    }

    // 3. Validasi lokasi Multi-Point — hanya lokasi absen yang diizinkan untuk karyawan ini
    const lokasiAbsen = await getLokasiAbsenKaryawan(user.id);
    const cekLokasi = dalamRadiusMultiPoint(lat, lng, lokasiAbsen.lokasi, cekAkurasi.accuracy);
    if (cekLokasi.configuration_error) {
      return res.status(503).json({
        code: 'ATTENDANCE_LOCATION_UNCONFIGURED',
        error: 'Lokasi absensi belum dikonfigurasi oleh admin.',
      });
    }
    if (!cekLokasi.valid) {
      logAttendanceDecision(req, {
        action: 'datang', outcome: 'rejected', reasonCode: 'OUTSIDE_ALL_GEOFENCES', userId: user.id,
        accuracy, distanceMeter: cekLokasi.jarak_meter, locationId: cekLokasi.lokasi_terdekat?.id,
      });
      return res.status(403).json({
        code: 'ATTENDANCE_OUTSIDE_APPROVED_GEOFENCES',
        error: pesanDiLuarLokasi(lokasiAbsen, cekLokasi.jarak_meter),
      });
    }

    // 4. Validasi wajah via CompreFace
    const hasilWajah = await verifikasiWajah(req.file.buffer, user.compreface_subject);
    if (!hasilWajah.valid) {
      return res.status(403).json({
        error: 'Wajah tidak cocok dengan data akun',
        similarity: hasilWajah.similarity,
      });
    }

    // 5. Tentukan status & simpan — tanggal kerja menggunakan tanggal WIB
    const tanggalKerja = new Date(`${tanggalOperasional}T00:00:00+07:00`);
    const status = statusAbsenDatang(userDenganShift, tanggalKerja, sekarang);

    fotoKey = await uploadFoto(req.file.buffer, { userId: user.id, jenis: 'datang' });

    const { rows } = await pool.query(
      `INSERT INTO absensi
        (user_id, shift_id, tanggal_kerja, waktu_datang, lokasi_datang_lat, lokasi_datang_lng,
         foto_datang_url, face_match_score_datang, status_datang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        user.id,
        shift_id,
        // tanggal_kerja kolom DATE: kirim string 'YYYY-MM-DD' (tanggal operasional
        // WIB) apa adanya. Jangan kirim Date ber-suffix +07:00 — di sesi Postgres
        // (UTC) itu bergeser mundur satu hari saat di-cast ke DATE.
        tanggalOperasional,
        sekarang,
        lat,
        lng,
        fotoKey,
        hasilWajah.similarity,
        status,
      ]
    );

    // Sinkronkan roster otomatis dari hasil absen kamera: bila shift kamera
    // (Siang/Malam) berbeda dari status roster terencana, catat override harian
    // + jejak audit agar data roster & kehadiran tetap konsisten.
    const rosterSync = await syncRosterFromCamera({
      userId: user.id,
      tanggal: tanggalOperasional,
      shift,
      rosterPlan: roster,
      attendanceId: rows[0]?.id,
    });

    logAttendanceDecision(req, {
      action: 'datang', outcome: 'accepted', reasonCode: 'ATTENDANCE_RECORDED', userId: user.id,
      accuracy, distanceMeter: cekLokasi.jarak_meter, locationId: cekLokasi.lokasi_terdekat?.id,
    });

    res.status(201).json({
      message: 'Absen datang berhasil',
      status,
      nama_shift: shift.nama_shift,
      roster_status: roster?.status || null,
      roster_actual_status: rosterSync.actualStatus,
      roster_conflict: rosterSync.conflict,
      roster_synced: rosterSync.synced,
      absensi: rows[0],
    });
  } catch (err) {
    await cleanupFailedAttendancePhoto(fotoKey);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Sesi absen aktif sudah ada. Silakan muat ulang riwayat absensi.' });
    }
    if (err.code === 'PHOTO_STORAGE_UPLOAD_FAILED') {
      return res.status(503).json({ code: err.code, error: err.message });
    }
    next(err);
  }
}

/**
 * POST /api/absensi/pulang
 * body: { latitude, longitude }
 * file: foto (multipart, field name 'foto')
 */
async function absenPulang(req, res, next) {
  let fotoKey = null;
  try {
    const { latitude, longitude, accuracy } = req.body;
    if (latitude === undefined || longitude === undefined || !req.file) {
      return res.status(400).json({ error: 'latitude, longitude, dan foto wajib dikirim' });
    }

    const { lat, lng } = parseCoordinates(latitude, longitude);

    const cekAkurasi = validasiAkurasi(accuracy);
    if (!cekAkurasi.valid) {
      logAttendanceDecision(req, { action: 'pulang', outcome: 'rejected', reasonCode: 'GPS_ACCURACY_REJECTED', accuracy });
      return res.status(403).json({ code: 'ATTENDANCE_GPS_ACCURACY_REJECTED', error: cekAkurasi.reason });
    }

    const user = await getUserLengkap(req.user.id);
    if (!user) return res.status(404).json({ error: 'Data karyawan tidak ditemukan' });

    const sesiPending = await getSesiPending(user.id);
    if (!sesiPending) {
      return res.status(400).json({ error: 'Tidak ada sesi absen datang yang aktif untuk di-checkout' });
    }

    const lokasiAbsen = await getLokasiAbsenKaryawan(user.id);
    const cekLokasi = dalamRadiusMultiPoint(lat, lng, lokasiAbsen.lokasi, cekAkurasi.accuracy);
    if (cekLokasi.configuration_error) {
      return res.status(503).json({
        code: 'ATTENDANCE_LOCATION_UNCONFIGURED',
        error: 'Lokasi absensi belum dikonfigurasi oleh admin.',
      });
    }
    if (!cekLokasi.valid) {
      logAttendanceDecision(req, {
        action: 'pulang', outcome: 'rejected', reasonCode: 'OUTSIDE_ALL_GEOFENCES', userId: user.id,
        accuracy, distanceMeter: cekLokasi.jarak_meter, locationId: cekLokasi.lokasi_terdekat?.id,
      });
      return res.status(403).json({
        code: 'ATTENDANCE_OUTSIDE_APPROVED_GEOFENCES',
        error: pesanDiLuarLokasi(lokasiAbsen, cekLokasi.jarak_meter),
      });
    }

    const hasilWajah = await verifikasiWajah(req.file.buffer, user.compreface_subject);
    if (!hasilWajah.valid) {
      return res.status(403).json({
        error: 'Wajah tidak cocok dengan data akun',
        similarity: hasilWajah.similarity,
      });
    }

    const shift = await getShift(sesiPending.shift_id);
    if (!shift) return res.status(400).json({ error: 'Data shift untuk sesi ini tidak ditemukan' });

    const sekarang = new Date();

    // Proteksi minimal durasi 15 menit: cegah checkout tak sengaja jika baru
    // absen datang < 15 menit. Bisa dilewati hanya lewat konfigurasi
    // pengujian/operasional (ABSENSI_ALLOW_ANYTIME=1).
    const allowAnyTimePulang = process.env.ABSENSI_ALLOW_ANYTIME === '1';
    const selisihMenit = sesiPending.waktu_datang
      ? (sekarang.getTime() - new Date(sesiPending.waktu_datang).getTime()) / (1000 * 60)
      : 999;
    if (!allowAnyTimePulang && selisihMenit < 15) {
      return res.status(400).json({
        error: `Absen pulang belum dapat dilakukan. Anda baru saja absen datang ${Math.round(selisihMenit)} menit lalu. Minimal durasi kerja adalah 15 menit.`,
      });
    }

    const status = statusAbsenPulang(shift, sesiPending.tanggal_kerja, sekarang);

    if (status === 'pulang awal') {
      await pool.query(`UPDATE absensi SET percobaan_pulang_awal = COALESCE(percobaan_pulang_awal, 0) + 1 WHERE id = $1`, [sesiPending.id]);
    }

    fotoKey = await uploadFoto(req.file.buffer, { userId: user.id, jenis: 'pulang' });

    const { rows } = await pool.query(
      `UPDATE absensi SET
        waktu_pulang = $1, lokasi_pulang_lat = $2, lokasi_pulang_lng = $3,
        foto_pulang_url = $4, face_match_score_pulang = $5, status_pulang = $6,
        updated_at = now()
       WHERE id = $7 AND waktu_pulang IS NULL
       RETURNING *`,
      [sekarang, lat, lng, fotoKey, hasilWajah.similarity, status, sesiPending.id]
    );

    if (!rows[0]) {
      await cleanupFailedAttendancePhoto(fotoKey);
      fotoKey = null;
      return res.status(409).json({
        code: 'ATTENDANCE_ALREADY_CHECKED_OUT',
        error: 'Sesi ini sudah di-checkout dari permintaan lain. Muat ulang riwayat absensi.',
      });
    }

    logAttendanceDecision(req, {
      action: 'pulang', outcome: 'accepted', reasonCode: 'ATTENDANCE_RECORDED', userId: user.id,
      accuracy, distanceMeter: cekLokasi.jarak_meter, locationId: cekLokasi.lokasi_terdekat?.id,
    });

    res.json({ message: 'Absen pulang berhasil', status, absensi: rows[0] });
  } catch (err) {
    await cleanupFailedAttendancePhoto(fotoKey);
    if (err.code === 'PHOTO_STORAGE_UPLOAD_FAILED') {
      return res.status(503).json({ code: err.code, error: err.message });
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}

/** GET /api/absensi/riwayat — riwayat absensi milik karyawan yang login.
 *  Aturan mutlak Rekap Performa: bila keterangan manual admin menimpa presensi
 *  kamera, karyawan melihat data update terbaru admin — jam datang/pulang dan
 *  status pulang disembunyikan (NULL), status mengikuti kategori admin. Record
 *  kamera tetap tersimpan di tabel absensi sebagai histori (pengembalian oleh
 *  admin). is_pending_session sengaja TIDAK di-mask agar manajemen sesi
 *  checkout tetap berfungsi. */
async function riwayat(req, res, next) {
  try {
    const range = resolveEmployeeReportRange(req.query || {});
    await autoCloseExpiredSessions(req.user.id);
    res.setHeader('Cache-Control', 'no-store');
    const rangeSql = range
      ? 'AND COALESCE(a.tanggal_kerja, kp.tanggal) BETWEEN $2::date AND $3::date'
      : '';
    const params = range ? [req.user.id, range.start, range.end] : [req.user.id];
    const { rows } = await pool.query(
      `SELECT COALESCE(a.id::text, kp.id::text) AS id,
              COALESCE(a.user_id, kp.user_id) AS user_id,
              (a.id IS NOT NULL) AS is_attendance_record,
              (a.waktu_datang IS NOT NULL AND a.waktu_pulang IS NULL) AS is_pending_session,
              a.shift_id,
              COALESCE(a.tanggal_kerja, kp.tanggal)::text AS tanggal,
              COALESCE(a.tanggal_kerja, kp.tanggal)::text AS tanggal_kerja,
              CASE WHEN a.id IS NOT NULL AND kp.kategori IS NOT NULL THEN NULL ELSE a.waktu_datang END AS waktu_datang,
              CASE WHEN a.id IS NOT NULL AND kp.kategori IS NOT NULL THEN NULL ELSE a.waktu_pulang END AS waktu_pulang,
              COALESCE(kp.kategori, a.status_datang) AS status_datang,
              CASE WHEN a.id IS NOT NULL AND kp.kategori IS NOT NULL THEN NULL ELSE a.status_pulang END AS status_pulang,
              a.foto_datang_url,
              a.foto_pulang_url,
              kp.kategori AS kategori_manual,
              (a.id IS NOT NULL AND kp.kategori IS NOT NULL) AS kamera_ditimpa
        FROM absensi a
        FULL OUTER JOIN keterangan_presensi kp ON kp.user_id = a.user_id AND kp.tanggal = a.tanggal_kerja
        WHERE COALESCE(a.user_id, kp.user_id) = $1
          ${rangeSql}
        ORDER BY COALESCE(a.tanggal_kerja, kp.tanggal) DESC, a.waktu_datang DESC NULLS LAST
        LIMIT ${range ? 400 : 100}`,
      params
    );

    const rowsDenganUrlFoto = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        foto_datang_url: await getUrlFoto(row.foto_datang_url),
        foto_pulang_url: await getUrlFoto(row.foto_pulang_url),
      }))
    );

    res.json(rowsDenganUrlFoto);
  } catch (err) {
    next(err);
  }
}

/** GET /api/absensi/rekap — rekap kehadiran 30 hari terakhir untuk kalender karyawan */
async function rekapKehadiran(req, res, next) {
  try {
    const sekarangWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const yyyy = sekarangWIB.getUTCFullYear();
    const mm = String(sekarangWIB.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(sekarangWIB.getUTCDate()).padStart(2, '0');
    const todayWIB = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);

    const start = new Date(todayWIB);
    start.setUTCDate(todayWIB.getUTCDate() - 29);

    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;
    const endStr = `${yyyy}-${mm}-${dd}`;

    const { rows: absensiRows } = await pool.query(
      `SELECT tanggal_kerja::text AS tanggal_kerja,
              status_datang, status_pulang, waktu_datang, waktu_pulang
       FROM absensi
       WHERE user_id = $1
         AND tanggal_kerja >= $2::date
         AND tanggal_kerja <= $3::date
       ORDER BY tanggal_kerja ASC`,
      [req.user.id, startStr, endStr]
    );

    const { rows: kpRows } = await pool.query(
      `SELECT tanggal::text AS tanggal, kategori, catatan
       FROM keterangan_presensi
       WHERE user_id = $1
         AND tanggal >= $2::date
         AND tanggal <= $3::date`,
      [req.user.id, startStr, endStr]
    );

    // Buat map tanggal -> status untuk 30 hari
    const mapAbsensi = {};
    absensiRows.forEach((r) => {
      const tgl = String(r.tanggal_kerja).split('T')[0].split(' ')[0];
      mapAbsensi[tgl] = {
        status_datang: r.status_datang,
        status_pulang: r.status_pulang,
        waktu_datang: r.waktu_datang,
        waktu_pulang: r.waktu_pulang,
      };
    });

    const mapKeterangan = {};
    kpRows.forEach((r) => {
      const tgl = String(r.tanggal).split('T')[0];
      mapKeterangan[tgl] = r.kategori;
    });

    // Generate array 30 hari
    const hasil = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const tgl = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      const data = mapAbsensi[tgl] || null;
      const manualCat = mapKeterangan[tgl] || null;

      let status = 'tidak_absen';
      if (manualCat) {
        if (manualCat === 'hadir_manual') {
          status = 'hadir';
        } else if (manualCat === 'alpa') {
          status = 'tidak_absen';
        } else {
          status = manualCat; // 'izin', 'sakit', 'cuti', 'off'
        }
      } else if (data) {
        const adaTelat = data.status_datang === 'telat' || data.status_pulang === 'checkout lewat';
        status = adaTelat ? 'telat' : 'hadir';
      }

      // Aturan mutlak Rekap Performa: hari yang ditimpa admin tidak lagi
      // menampilkan jam/status kamera; karyawan melihat data update terbaru.
      const ditimpa = Boolean(manualCat && data);
      hasil.push({
        tanggal: tgl,
        status,
        ...(ditimpa ? { status_datang: null, status_pulang: null, waktu_datang: null, waktu_pulang: null } : data),
        kategori_manual: manualCat,
      });
    }

    res.json(hasil);
  } catch (err) {
    next(err);
  }
}

/** GET /api/absensi/lokasi-kantor — koordinat & radius kantor untuk minimap karyawan */
async function lokasiKantorSaya(req, res, next) {
  try {
    const { rows: uRows } = await pool.query(
      `SELECT u.id, u.nama, u.email, u.jabatan, u.departemen, u.lokasi_kantor_id
       FROM users u WHERE u.id = $1`,
      [req.user.id]
    );
    const userObj = uRows[0] || null;

    let { rows } = await pool.query(
      `SELECT l.id, l.nama_lokasi, l.latitude, l.longitude, l.radius_meter
       FROM users u
       JOIN lokasi_kantor l ON l.id = u.lokasi_kantor_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!rows[0]) {
      const defRes = await pool.query(`SELECT id, nama_lokasi, latitude, longitude, radius_meter FROM lokasi_kantor ORDER BY created_at ASC LIMIT 1`);
      rows = defRes.rows;
    }
    if (!rows[0]) return res.status(404).json({ error: 'Lokasi kantor belum diset di sistem' });

    // People v2: daftar lokasi absen yang diizinkan (null = semua lokasi).
    let lokasiAbsen = null;
    try { lokasiAbsen = await People.getAllowedLocations(pool, req.user.id); } catch (err) { if (err.code !== '42P01') throw err; }

    res.json({
      ...rows[0],
      user: userObj,
      lokasi_absen: lokasiAbsen,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/absensi/rekap-hm — rekapitulasi HM bulan berjalan khusus milik karyawan bersangkutan */
async function rekapHmKaryawan(req, res, next) {
  try {
    await ensureHmDailySchema(pool);
    const userId = req.user.id;
    const range = resolveEmployeeReportRange(req.query || {}, currentWibMonthRange());
    const tglMulai = range.start;
    const tglAkhir = range.end;

    const rows = await getHmPayableDailyRows(pool, userId, tglMulai, tglAkhir);

    const totalHmBulanIni = rows.reduce((acc, r) => acc + Number(r.jam_operasi || 0), 0);
    const uniqueDays = new Set(rows.map((r) => (r.tanggal ? new Date(r.tanggal).toISOString().split('T')[0] : ''))).size;

    res.json({
      periode: 'rentang_tanggal',
      bulan_tahun: employeeReportPeriodLabel(tglMulai, tglAkhir),
      tanggal_mulai: tglMulai,
      tanggal_akhir: tglAkhir,
      total_hm_bulan_ini: Number(totalHmBulanIni.toFixed(2)),
      total_hari_operasi: uniqueDays,
      list_harian: rows.map((r) => ({
        id: r.id || null,
        tanggal: r.tanggal,
        // Field legacy dipertahankan untuk APK lama sampai seluruh perangkat diperbarui.
        kode_unit: null,
        hm_awal: 0,
        hm_akhir: Number(r.jam_operasi),
        total_hm: Number(r.jam_operasi),
        jam_operasi: Number(r.jam_operasi),
        keterangan: r.keterangan || '',
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/absensi/check-lokasi
 * body: { latitude, longitude }
 */
async function checkLokasi(req, res, next) {
  try {
    const { latitude, longitude, accuracy } = req.body;
    const { lat, lng } = parseCoordinates(latitude, longitude);

    const cekAkurasi = validasiAkurasi(accuracy);
    if (!cekAkurasi.valid) {
      logAttendanceDecision(req, { action: 'check-lokasi', outcome: 'rejected', reasonCode: 'GPS_ACCURACY_REJECTED', accuracy });
      return res.status(403).json({ valid: false, code: 'ATTENDANCE_GPS_ACCURACY_REJECTED', error: cekAkurasi.reason, message: cekAkurasi.reason });
    }

    const user = await getUserLengkap(req.user.id);
    if (!user) return res.status(404).json({ valid: false, message: 'Data karyawan tidak ditemukan' });
    const lokasiAbsen = await getLokasiAbsenKaryawan(user.id);

    const cekLokasiObj = dalamRadiusMultiPoint(lat, lng, lokasiAbsen.lokasi, cekAkurasi.accuracy);
    if (cekLokasiObj.configuration_error) {
      return res.status(503).json({
        valid: false,
        code: 'ATTENDANCE_LOCATION_UNCONFIGURED',
        error: 'Lokasi absensi belum dikonfigurasi oleh admin.',
        message: 'Lokasi absensi belum dikonfigurasi oleh admin.',
      });
    }
    const namaLok = cekLokasiObj.lokasi_terdekat ? cekLokasiObj.lokasi_terdekat.nama_lokasi : 'Area Kerja';

    logAttendanceDecision(req, {
      action: 'check-lokasi',
      outcome: cekLokasiObj.valid ? 'accepted' : 'rejected',
      reasonCode: cekLokasiObj.valid ? 'INSIDE_APPROVED_GEOFENCE' : 'OUTSIDE_ALL_GEOFENCES',
      userId: user.id,
      accuracy,
      distanceMeter: cekLokasiObj.jarak_meter,
      locationId: cekLokasiObj.lokasi_terdekat?.id,
    });

    // Jujur: valid mencerminkan hasil radius nyata (konsisten dengan absenDatang/absenPulang).
    // Sebelumnya valid di-hardcode true sehingga badge selalu hijau padahal absen ditolak.
    return res.json({
      valid: cekLokasiObj.valid,
      code: cekLokasiObj.valid ? 'ATTENDANCE_LOCATION_ACCEPTED' : 'ATTENDANCE_OUTSIDE_APPROVED_GEOFENCES',
      jarakMeter: cekLokasiObj.jarak_meter,
      namaLokasi: namaLok,
      lokasiId: cekLokasiObj.lokasi_terdekat?.id || null,
      radiusMeter: cekLokasiObj.lokasi_terdekat?.radius_meter || null,
      maxAccuracyMeter: MAX_ACCURACY_METER,
      message: cekLokasiObj.valid
        ? `Lokasi sah (${namaLok})`
        : pesanDiLuarLokasi(lokasiAbsen, Math.round(cekLokasiObj.jarak_meter)),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { absenDatang, absenPulang, riwayat, rekapKehadiran, lokasiKantorSaya, rekapHmKaryawan, checkLokasi };
