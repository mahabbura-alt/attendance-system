/**
 * Layanan kehadiran terpadu untuk Payroll (Kalkulasi & Slip Gaji).
 *
 * TUJUAN: memastikan seluruh angka kehadiran yang dipakai payroll (hadir, alpa,
 * izin, sakit) BENAR-BENAR mengikuti tolok ukur "Rekap Performa"
 * (adminController.rekapPerforma) untuk rentang cutoff yang sama.
 *
 * Latar belakang: sebelumnya payroll menghitung potongan ALPA/IZIN hanya dari
 * baris MANUAL tabel keterangan_presensi berkategori alpa/izin. Padahal untuk
 * karyawan yang tidak masuk, hari2 tsb dihitung OTOMATIS dari roster (S/M yg tak
 * dihadiri) => hampir selalu 0 sehingga gaji pokok selalu tampil penuh.
 *
 * Aturan yang diadopsi (IDENTIK dgn Rekap Performa):
 *   - status tiap hari pakai services/roster.resolveDailyCategory,
 *   - hari sebelum tanggal created_at akun = "belum terdaftar" (tak dihitung),
 *   - hari sesudah hari ini (WIB) = "belum terjadi",
 *   - alpa = jadwal roster S/M yang tidak dihadiri kamera & tidak ada manual.
 */

"use strict";

const { pool } = require("../config/db");
const { getRosterMap, resolveDailyCategory } = require("./roster");

function pad2(n) { return String(n).padStart(2, "0"); }

function toDateKey(value) {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

/** idem Rekap Performa: tanggal created_at akun (WIB YYYY-MM-DD). */
function accountCreatedDateKey(createdAt) {
  if (!createdAt) return null;
  const d = createdAt instanceof Date ? createdAt : new Date(String(createdAt));
  if (isNaN(d.getTime())) return null;
  const datePart = d.toISOString().slice(0, 10);
  return new Date(new Date(`${datePart}T00:00:00Z`).getTime() + 7 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
}

function getWeekdayKey(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

function isLiburReguler(dateKey, mode) {
  const day = getWeekdayKey(dateKey);
  if (mode === "sabtu-minggu") return day === 0 || day === 6;
  return day === 0; // default minggu
}

/**
 * Hitung kehadiran & status alpa/izin/sakit untuk satu karyawan pada rentang
 * [mulai..akhir] dengan semantik Rekap Performa. Dipakai bersama oleh Kalkulasi
 * Payroll dan pembuat Slip Gaji agar angka selalu identik satu sama lain maupun
 * dengan Rekap Performa.
 *
 * @param {object} p
 * @param {string}              p.userId
 * @param {string}              p.mulai             YYYY-MM-DD
 * @param {string}              p.akhir             YYYY-MM-DD
 * @param {Date|string}         [p.accountCreated]  users.created_at
 * @param {"minggu"|"sabtu-minggu"} [p.hariLiburReguler]
 * @param {string[]}            [p.hariLiburNasional]
 * @param {number}              [p.tunjKehadiranPerHari]
 */
async function hitungKehadiranPayroll({
  userId,
  mulai,
  akhir,
  accountCreated,
  hariLiburReguler = "minggu",
  hariLiburNasional = [],
  tunjKehadiranPerHari = 0,
}) {
  const tglBuatStr = accountCreatedDateKey(accountCreated);
  const hariIniStr = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const liburNasionalSet = new Set(hariLiburNasional || []);
  const tkPerHari = Number(tunjKehadiranPerHari || 0);

  // Kumpulkan seluruh tanggal yang tercatat hadir (kamera/absen) di periode.
  const [cameraRes, manualRes] = await Promise.all([
    pool.query(
      `SELECT DISTINCT (COALESCE(waktu_datang, tanggal_kerja) AT TIME ZONE 'Asia/Jakarta')::date::text AS tgl
         FROM absensi
        WHERE user_id = $1
          AND (COALESCE(waktu_datang, tanggal_kerja) AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2::date AND $3::date
          AND waktu_datang IS NOT NULL`,
      [userId, mulai, akhir]
    ),
    pool.query(
      `SELECT DISTINCT tanggal::text AS tgl
         FROM keterangan_presensi
        WHERE user_id = $1 AND tanggal BETWEEN $2::date AND $3::date AND kategori = 'hadir_manual'`,
      [userId, mulai, akhir]
    ),
  ]);

  const kameraSet = new Set(
    cameraRes.rows.map((r) => toDateKey(r.tgl)).filter(Boolean)
  );
  const manualHadirSet = new Set(
    manualRes.rows.map((r) => toDateKey(r.tgl)).filter(Boolean)
  );

  // Label manual non-hadir (alpa/izin/sakit/cuti/off/hadir_manual) per tanggal.
  const [kpRes, rosterMap] = await Promise.all([
    pool.query(
      `SELECT tanggal::text AS tgl, kategori
         FROM keterangan_presensi
        WHERE user_id = $1 AND tanggal BETWEEN $2::date AND $3::date`,
      [userId, mulai, akhir]
    ),
    getRosterMap(mulai, akhir),
  ]);

  const statusManualMap = new Map();
  for (const k of kpRes.rows) {
    const key = toDateKey(k.tgl);
    if (key) statusManualMap.set(key, k.kategori);
  }

  // Bangun resolusi harian (satu hari = satu kategori) selaras Rekap Performa.
  const rincianHari = [];
  const cursor = new Date(`${mulai}T00:00:00Z`);
  const dateEnd = new Date(`${akhir}T00:00:00Z`);

  while (cursor <= dateEnd) {
    const dStr = cursor.toISOString().slice(0, 10);
    const dayOfWeek = cursor.getUTCDay();
    const manualCat = statusManualMap.get(dStr) || null;
    const rosterRec = rosterMap.get(`${userId}_${dStr}`) || null;
    const hasCamera = kameraSet.has(dStr);

    let kategori = null;
    let sumber = "system";
    let expectedWork = false;

    if (dStr > hariIniStr) {
      kategori = "belum_terjadi";
    } else if (tglBuatStr && dStr < tglBuatStr) {
      kategori = "belum_terdaftar";
    } else {
      const resolved = resolveDailyCategory({
        hasAttendance: hasCamera,
        manualCategory: manualCat,
        rosterStatus: rosterRec ? rosterRec.status : null,
        isSunday: dayOfWeek === 0,
      });
      kategori = resolved.category;
      sumber = resolved.source;
      expectedWork = !!resolved.expectedWork;
    }

    const isHadir = kategori === "hadir_kamera" || kategori === "hadir_manual";
    const isOffCounted = kategori === "off" && sumber !== "legacy";

    rincianHari.push({
      tanggal: dStr,
      kategori,
      sumber,
      roster_status: rosterRec ? rosterRec.status : null,
      expected_work: expectedWork,
      hadir: isHadir ? 1 : 0,
      alpa: kategori === "alpa" ? 1 : 0,
      izin: kategori === "izin" ? 1 : 0,
      sakit: kategori === "sakit" ? 1 : 0,
      cuti: kategori === "cuti" ? 1 : 0,
      off: isOffCounted ? 1 : 0,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const totalHadir = rincianHari.reduce((s, h) => s + h.hadir, 0);
  const hariAlpa = rincianHari.reduce((s, h) => s + h.alpa, 0);
  const hariIzin = rincianHari.reduce((s, h) => s + h.izin, 0);
  const hariSakit = rincianHari.reduce((s, h) => s + h.sakit, 0);
  const hariCuti = rincianHari.reduce((s, h) => s + h.cuti, 0);
  const hariOff = rincianHari.reduce((s, h) => s + h.off, 0);
  const totalHariKerjaEff = rincianHari.reduce(
    (s, h) => s + (h.expected_work ? 1 : 0),
    0
  );

  // Tunjangan kehadiran: hanya untuk hari yang tercatat HADIR pada periode (dan
  // pada/dekat tanggal pendaftaran). Hari libur reguler/nasional nilai digandakan.
  let hariKerjaBiasa = 0;
  let hariKerjaLibur = 0;
  let tunjKehadiranTotal = 0;
  for (const h of rincianHari) {
    if (h.hadir !== 1) continue;
    const libur =
      isLiburReguler(h.tanggal, hariLiburReguler) || liburNasionalSet.has(h.tanggal);
    if (libur) {
      hariKerjaLibur += 1;
      tunjKehadiranTotal += tkPerHari * 2;
    } else {
      hariKerjaBiasa += 1;
      tunjKehadiranTotal += tkPerHari;
    }
  }

  return {
    hadir: totalHadir,
    hari_alpa: hariAlpa,
    hari_izin: hariIzin,
    hari_sakit: hariSakit,
    hari_cuti: hariCuti,
    hari_off: hariOff,
    total_hari_kerja_eff: totalHariKerjaEff,
    hari_kerja_actual: totalHadir,
    hari_kerja_biasa: hariKerjaBiasa,
    hari_kerja_libur: hariKerjaLibur,
    tunj_kehadiran_total: Math.round(tunjKehadiranTotal),
    tanggal_buat_akun: tglBuatStr,
    tanggal_hari_ini: hariIniStr,
    rincianHari,
  };
}

module.exports = { hitungKehadiranPayroll, accountCreatedDateKey };