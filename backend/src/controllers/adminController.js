const { pool } = require('../config/db');
const { getUrlFoto } = require('../services/storage');
const { autoCloseExpiredSessions } = require('../services/attendanceSession');
const { getRosterMap, resolveDailyCategory } = require('../services/roster');
const { rosterStatusForShift } = require('../services/attendancePolicy');
const { statusAbsenDatang } = require('../utils/shiftValidator');
const { buatWorkbookAbsensi } = require('../services/attendanceExcel');
const bcrypt = require('bcrypt');
const Workforce = require('../services/workforce');

/** GET /api/admin/shifts — daftar shift untuk dropdown form karyawan */
async function daftarShift(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM shifts ORDER BY nama_shift');
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

function buatQueryAbsensiTerfilter(filter = {}, { batasi = true, tampilkanKamera = false } = {}) {
  const { tanggal_dari, tanggal_sampai, shift, departemen, jabatan, nama, q } = filter;
  // Aturan mutlak Rekap Performa: bila keterangan manual admin menimpa presensi
  // kamera, kolom Shift/Datang/Status Datang/Pulang/Status Pulang disembunyikan
  // dari tampilan (NULL). Record kamera TIDAK dihapus dari tabel absensi — data
  // asli tetap tersimpan sebagai histori untuk pengembalian (pilih "Hadir
  // (Kamera)" di Rekap Performa). Export Excel memakai tampilkanKamera=true agar
  // histori kamera tetap bisa diambil.
  const params = [tampilkanKamera];
  const maskFlag = 1;
  let queryStr = `
      SELECT
        COALESCE(a.id::text, kp.id::text) AS id,
        COALESCE(a.user_id, kp.user_id) AS user_id,
        u.nama,
        u.email,
        u.departemen,
        u.jabatan,
        CASE WHEN a.id IS NOT NULL AND kp.kategori IS NOT NULL AND NOT $${maskFlag}
             THEN NULL ELSE COALESCE(s.nama_shift, '-') END AS nama_shift,
        COALESCE(a.tanggal_kerja, kp.tanggal)::text AS tanggal_kerja,
        CASE WHEN a.id IS NOT NULL AND kp.kategori IS NOT NULL AND NOT $${maskFlag}
             THEN NULL ELSE a.waktu_datang END AS waktu_datang,
        COALESCE(kp.kategori, a.status_datang) AS status_datang,
        CASE WHEN a.id IS NOT NULL AND kp.kategori IS NOT NULL AND NOT $${maskFlag}
             THEN NULL ELSE a.waktu_pulang END AS waktu_pulang,
        CASE WHEN a.id IS NOT NULL AND kp.kategori IS NOT NULL AND NOT $${maskFlag}
             THEN NULL ELSE a.status_pulang END AS status_pulang,
        a.foto_datang_url,
        a.foto_pulang_url,
        kp.kategori AS kategori_manual,
        (a.id IS NULL) AS manual_only,
        (a.id IS NOT NULL AND kp.kategori IS NOT NULL AND NOT $${maskFlag}) AS kamera_ditimpa
      FROM absensi a
      FULL OUTER JOIN keterangan_presensi kp
        ON kp.user_id = a.user_id
       AND kp.tanggal = a.tanggal_kerja
      LEFT JOIN users u ON u.id = COALESCE(a.user_id, kp.user_id)
      LEFT JOIN shifts s ON s.id = COALESCE(a.shift_id, u.shift_id)
      WHERE 1=1
        AND (a.id IS NOT NULL OR kp.kategori = 'hadir_manual')
    `;

  if (tanggal_dari) {
    params.push(tanggal_dari);
    queryStr += ` AND COALESCE(a.tanggal_kerja, kp.tanggal) >= $${params.length}::date`;
  }
  if (tanggal_sampai) {
    params.push(tanggal_sampai);
    queryStr += ` AND COALESCE(a.tanggal_kerja, kp.tanggal) <= $${params.length}::date`;
  }
  const filterKolom = [
    ['shift', shift, "COALESCE(s.nama_shift, '-')"],
    ['departemen', departemen, "COALESCE(u.departemen, '')"],
    ['jabatan', jabatan, "COALESCE(u.jabatan, '')"],
    ['nama', nama, "COALESCE(u.nama, '')"],
  ];
  filterKolom.forEach(([, value, column]) => {
    if (!value) return;
    params.push(value);
    queryStr += ` AND LOWER(${column}) = LOWER($${params.length})`;
  });
  if (q) {
    params.push(`%${q}%`);
    queryStr += ` AND (COALESCE(u.nama, '') ILIKE $${params.length} OR COALESCE(u.departemen, '') ILIKE $${params.length} OR COALESCE(u.jabatan, '') ILIKE $${params.length})`;
  }
  queryStr += ' ORDER BY COALESCE(a.tanggal_kerja, kp.tanggal) DESC, a.waktu_datang DESC NULLS LAST';
  if (batasi) queryStr += ' LIMIT 500';
  return { queryStr, params };
}

/** GET /api/admin/absensi - data absensi sesuai filter periode */
async function semuaAbsensi(req, res, next) {
  try {
    await autoCloseExpiredSessions();
    // Batas 500 baris hanya bila rentang tanggal tidak eksplisit; bila user
    // memilih periode, seluruh baris periode itu dikembalikan (pola export).
    const rentangEksplisit = Boolean(req.query.tanggal_dari && req.query.tanggal_sampai);
    const { queryStr, params } = buatQueryAbsensiTerfilter(req.query, { batasi: !rentangEksplisit });

    const { rows } = await pool.query(queryStr, params);

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

function validasiRangeAbsensi(filter) {
  const { tanggal_dari, tanggal_sampai } = filter;
  if (!tanggal_dari || !tanggal_sampai) return 'Tanggal awal dan tanggal akhir wajib diisi';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal_dari) || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_sampai)) return 'Format tanggal harus YYYY-MM-DD';
  if (tanggal_sampai < tanggal_dari) return 'Tanggal akhir tidak boleh sebelum tanggal awal';
  return null;
}

/** GET /api/admin/absensi/export.xlsx - workbook sesuai seluruh filter aktif */
async function exportAbsensiExcel(req, res, next) {
  try {
    await autoCloseExpiredSessions();
    const errorRange = validasiRangeAbsensi(req.query);
    if (errorRange) return res.status(400).json({ error: errorRange });
    // Export menampilkan histori kamera mentah (tanpa masking) agar data
    // presensi asli tetap bisa diambil meski sudah ditimpa Rekap Performa.
    const { queryStr, params } = buatQueryAbsensiTerfilter(req.query, { batasi: false, tampilkanKamera: true });
    const { rows } = await pool.query(queryStr, params);
    const output = buatWorkbookAbsensi(rows, req.query);
    const namaFile = `absensi_${req.query.tanggal_dari}_${req.query.tanggal_sampai}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${namaFile}"`);
    return res.send(output);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/admin/absensi/:id
 * body: { perubahan: {...kolom yang mau diubah}, alasan: string }
 */
async function editAbsensiManual(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { perubahan, alasan } = req.body;

    if (!perubahan || typeof perubahan !== 'object') {
      return res.status(400).json({ error: 'Field "perubahan" wajib diisi (object kolom yang diubah)' });
    }
    if (!alasan) {
      return res.status(400).json({ error: 'Field "alasan" wajib diisi untuk keperluan audit' });
    }

    // datetime-local tidak membawa zona waktu. Klien wajib mengirim instant
    // dengan offset eksplisit agar edit admin tidak bergantung pada zona browser.
    for (const field of ['waktu_datang', 'waktu_pulang']) {
      if (!Object.prototype.hasOwnProperty.call(perubahan, field)) continue;
      const value = perubahan[field];
      if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || Number.isNaN(Date.parse(value))) {
        return res.status(400).json({ error: `${field} harus berupa tanggal-jam dengan zona waktu eksplisit (WIB +07:00 atau UTC Z)` });
      }
      perubahan[field] = new Date(value).toISOString();
    }

    await client.query('BEGIN');

    const { rows: dataLama } = await client.query(
      'SELECT *, tanggal_kerja::text AS tanggal_kerja_iso FROM absensi WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!dataLama[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Data absensi tidak ditemukan' });
    }

    let shiftDipilih = null;
    if (Object.prototype.hasOwnProperty.call(perubahan, 'shift_id')) {
      const { rows: shiftRows } = await client.query('SELECT * FROM shifts WHERE id = $1', [perubahan.shift_id]);
      shiftDipilih = shiftRows[0] || null;
      if (!shiftDipilih) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Shift yang dipilih tidak ditemukan' });
      }

      // Jika status tidak dipilih manual, hitung ulang memakai waktu datang
      // yang tersimpan/perubahannya agar kombinasi shift dan status tetap konsisten.
      const waktuDatang = perubahan.waktu_datang || dataLama[0].waktu_datang;
      if (!Object.prototype.hasOwnProperty.call(perubahan, 'status_datang') && waktuDatang) {
        perubahan.status_datang = statusAbsenDatang(
          shiftDipilih,
          dataLama[0].tanggal_kerja_iso,
          new Date(waktuDatang)
        );
      }
    }

    const kolomDiizinkan = [
      'shift_id',
      'waktu_datang', 'lokasi_datang_lat', 'lokasi_datang_lng', 'status_datang',
      'waktu_pulang', 'lokasi_pulang_lat', 'lokasi_pulang_lng', 'status_pulang',
    ];
    const setClauses = [];
    const values = [];
    let i = 1;

    for (const kolom of Object.keys(perubahan)) {
      if (!kolomDiizinkan.includes(kolom)) continue;
      setClauses.push(`${kolom} = $${i}`);
      values.push(perubahan[kolom]);
      i += 1;
    }

    if (setClauses.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Tidak ada kolom valid yang diubah' });
    }

    values.push(id);
    const { rows: dataBaru } = await client.query(
      `UPDATE absensi SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
      values
    );

    if (shiftDipilih) {
      const rosterStatus = rosterStatusForShift(shiftDipilih);
      if (rosterStatus) {
        const catatanRoster = `Sinkron manual dari Edit Absensi: ${alasan}`;
        await client.query(
          `INSERT INTO employee_roster_daily
             (user_id,tanggal,status,shift_id,assignment_id,source,catatan,updated_by)
           VALUES (
             $1,$2::date,$3,$4,
             (SELECT assignment_id FROM employee_roster_daily WHERE user_id=$1 AND tanggal=$2::date LIMIT 1),
             'manual_override',$5,$6
           )
           ON CONFLICT (user_id,tanggal) DO UPDATE SET
             status=EXCLUDED.status,
             shift_id=EXCLUDED.shift_id,
             source='manual_override',
             catatan=EXCLUDED.catatan,
             updated_by=EXCLUDED.updated_by,
             updated_at=now()`,
          [dataBaru[0].user_id, dataBaru[0].tanggal_kerja, rosterStatus, shiftDipilih.id, catatanRoster, req.user.id]
        );
        await client.query(
          `INSERT INTO roster_audit_log (admin_id,user_id,aksi,detail)
           VALUES ($1,$2,'sync_admin_shift',$3::jsonb)`,
          [req.user.id, dataBaru[0].user_id, JSON.stringify({
            tanggal: dataBaru[0].tanggal_kerja,
            absensi_id: id,
            shift_before: dataLama[0].shift_id,
            shift_after: shiftDipilih.id,
            roster_after: rosterStatus,
            alasan,
          })]
        );
      }
    }

    await client.query(
      `INSERT INTO audit_log (admin_id, absensi_id, data_sebelum, data_sesudah, alasan)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, id, JSON.stringify(dataLama[0]), JSON.stringify(dataBaru[0]), alasan]
    );

    await client.query('COMMIT');
    res.json({ message: 'Data absensi berhasil diperbarui', absensi: dataBaru[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/** GET /api/admin/audit-log/:absensiId
 *  Histori lengkap satu baris absensi: perubahan manual (absensi_id) +
 *  penimpaan Rekap Performa (absensi_id NULL, dicocokkan user_id & tanggal
 *  dari payload audit). Dipakai modal Histori untuk antisipasi pengembalian
 *  ke presensi kamera. */
async function auditLogAbsensi(req, res, next) {
  try {
    const { rows: absRows } = await pool.query(
      'SELECT user_id, tanggal_kerja::text AS tanggal FROM absensi WHERE id = $1',
      [req.params.absensiId]
    );
    const abs = absRows[0];
    const { rows } = await pool.query(
      `SELECT al.*, u.nama AS admin_nama
       FROM audit_log al
       JOIN users u ON u.id = al.admin_id
       WHERE al.absensi_id = $1
          OR ($2::uuid IS NOT NULL AND al.absensi_id IS NULL
              AND al.data_sesudah->>'user_id' = $2
              AND al.data_sesudah->>'tanggal' = $3)
       ORDER BY al.waktu_perubahan DESC`,
      [req.params.absensiId, abs?.user_id || null, abs?.tanggal || null]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// REKAP PERFORMA INDIVIDU
// ============================================================
/**
 * GET /api/admin/rekap-performa
 * query: periode=mingguan|bulanan|tahunan
 *        tanggal_referensi (opsional, default: hari ini)
 *        user_id (opsional, untuk 1 karyawan saja)
 *
 * Contoh output per karyawan:
 * { nama, hadir, tidak_hadir, telat, checkout_lewat }
 */
async function rekapPerforma(req, res, next) {
  try {
    await autoCloseExpiredSessions();
    const { periode = 'bulanan', tanggal_referensi, tanggal_mulai, tanggal_akhir, user_id } = req.query;

    const ref = tanggal_referensi ? new Date(tanggal_referensi) : new Date();

    let tanggalMulai, tanggalAkhir;

    if (periode === 'rentang' && tanggal_mulai && tanggal_akhir) {
      tanggalMulai = new Date(`${tanggal_mulai}T00:00:00Z`);
      tanggalAkhir = new Date(`${tanggal_akhir}T00:00:00Z`);
    } else if (periode === 'harian') {
      tanggalMulai = new Date(ref);
      tanggalAkhir = new Date(ref);
    } else if (periode === 'mingguan') {
      // Minggu berjalan: Senin s/d Minggu
      const hari = ref.getDay(); // 0=minggu, 1=senin, ...
      const selisihSenin = (hari === 0) ? -6 : 1 - hari;
      tanggalMulai = new Date(ref);
      tanggalMulai.setDate(ref.getDate() + selisihSenin);
      tanggalAkhir = new Date(tanggalMulai);
      tanggalAkhir.setDate(tanggalMulai.getDate() + 6);
    } else if (periode === 'tahunan') {
      tanggalMulai = new Date(ref.getFullYear(), 0, 1);
      tanggalAkhir = new Date(ref.getFullYear(), 11, 31);
    } else {
      // bulanan (default)
      tanggalMulai = new Date(ref.getFullYear(), ref.getMonth(), 1);
      tanggalAkhir = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    }

    const mulaiStr = tanggalMulai.toISOString().split('T')[0];
    const akhirStr = tanggalAkhir.toISOString().split('T')[0];
    const isHariTunggal = mulaiStr === akhirStr;

    const tanggalTunggal = new Date(`${mulaiStr}T00:00:00Z`);
    const totalHariKerja = isHariTunggal ? (tanggalTunggal.getUTCDay() === 0 ? 0 : 1) : hitungHariKerja(tanggalMulai, tanggalAkhir);

    const refWIB = new Date(ref.getTime() + 7 * 60 * 60 * 1000);
    const refStr = (mulaiStr === akhirStr) ? mulaiStr : refWIB.toISOString().split('T')[0];

    const params = [mulaiStr, akhirStr, refStr];
    let whereUser = '';
    if (user_id) {
      params.push(user_id);
      whereUser = `AND u.id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT
         u.id,
         u.nama,
         u.jabatan,
         u.departemen,
         u.created_at::date AS tgl_buat_akun,
         COUNT(DISTINCT a.id) FILTER (WHERE a.waktu_datang IS NOT NULL)            AS hadir,
         COUNT(DISTINCT a.id) FILTER (WHERE a.status_datang = 'telat')             AS telat,
         COUNT(DISTINCT a.id) FILTER (WHERE a.status_pulang = 'checkout lewat')    AS checkout_lewat,
         SUM(COALESCE(a.percobaan_pulang_awal, 0))                                 AS percobaan_pulang_awal,
         COUNT(DISTINCT kp.id) FILTER (WHERE kp.kategori = 'hadir_manual')         AS hadir_manual,
         COUNT(DISTINCT kp.id) FILTER (WHERE kp.kategori = 'izin')                AS izin,
         COUNT(DISTINCT kp.id) FILTER (WHERE kp.kategori = 'sakit')               AS sakit,
         COUNT(DISTINCT kp.id) FILTER (WHERE kp.kategori = 'cuti')                AS cuti,
         COUNT(DISTINCT kp.id) FILTER (WHERE kp.kategori = 'off')                 AS off,
         COUNT(DISTINCT kp.id) FILTER (WHERE kp.kategori = 'alpa')                AS alpa_manual,
         (
           SELECT kp2.kategori FROM keterangan_presensi kp2
           WHERE kp2.user_id = u.id AND kp2.tanggal = $3 LIMIT 1
         ) AS kategori_harian
       FROM users u
       LEFT JOIN absensi a ON a.user_id = u.id AND a.tanggal_kerja BETWEEN $1::date AND $2::date
       LEFT JOIN keterangan_presensi kp ON kp.user_id = u.id AND kp.tanggal BETWEEN $1 AND $2
       WHERE u.role = 'karyawan' AND u.is_active = TRUE
       ${whereUser}
       GROUP BY u.id, u.nama, u.jabatan, u.departemen, u.created_at
       ORDER BY u.nama`,
      params
    );

    const [absensiRes, kpRes, rosterMap] = await Promise.all([
      pool.query(
        `SELECT user_id,
                tanggal_kerja::text AS tgl_str,
                waktu_datang, status_datang, status_pulang, COALESCE(percobaan_pulang_awal, 0) AS percobaan_pulang_awal
         FROM absensi
         WHERE tanggal_kerja BETWEEN $1::date AND $2::date`,
        [mulaiStr, akhirStr]
      ),
      pool.query(
        `SELECT user_id, tanggal::text AS tgl_str, kategori, catatan
         FROM keterangan_presensi
         WHERE tanggal BETWEEN $1 AND $2`,
        [mulaiStr, akhirStr]
      ),
      getRosterMap(mulaiStr, akhirStr),
    ]);

    const mapAbsensi = new Map();
    absensiRes.rows.forEach((a) => {
      const tgl = a.tgl_str ? a.tgl_str.split('T')[0] : '';
      mapAbsensi.set(`${a.user_id}_${tgl}`, a);
    });

    const mapKp = new Map();
    kpRes.rows.forEach((kp) => {
      const tgl = kp.tgl_str ? kp.tgl_str.split('T')[0] : '';
      mapKp.set(`${kp.user_id}_${tgl}`, kp);
    });

    const sekarangWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const hariIniStr = sekarangWIB.toISOString().split('T')[0];

    const rekap = rows.map((r) => {
      // 1. Tanggal pendaftaran akun (WIB YYYY-MM-DD)
      const tglBuatWIB = r.tgl_buat_akun
        ? new Date(new Date(r.tgl_buat_akun).getTime() + 7 * 60 * 60 * 1000)
        : null;
      const tglBuatStr = tglBuatWIB
        ? tglBuatWIB.toISOString().split('T')[0]
        : mulaiStr;

      // Batas awal hitungan: max(mulaiStr, tglBuatStr)
      const effMulaiStr = (tglBuatStr > mulaiStr) ? tglBuatStr : mulaiStr;
      // Batas akhir hitungan: min(akhirStr, hariIniStr)
      const effAkhirStr = (akhirStr > hariIniStr) ? hariIniStr : akhirStr;

      const effMulaiDate = new Date(`${effMulaiStr}T00:00:00Z`);
      const effAkhirDate = new Date(`${effAkhirStr}T00:00:00Z`);

      let hariKerjaIndiv = 0;
      if (effMulaiStr <= effAkhirStr) {
        if (isHariTunggal) {
          const refDate = new Date(`${mulaiStr}T00:00:00Z`);
          const isSun = (refDate.getUTCDay() === 0);
          if (isSun || mulaiStr < tglBuatStr || mulaiStr > hariIniStr) {
            hariKerjaIndiv = 0;
          } else {
            hariKerjaIndiv = 1;
          }
        } else {
          hariKerjaIndiv = hitungHariKerja(effMulaiDate, effAkhirDate);
        }
      }

      let hadirAbsen = Number(r.hadir);
      let hadirManual = Number(r.hadir_manual);
      let hadir = hadirAbsen + hadirManual;

      let izin = Number(r.izin);
      let sakit = Number(r.sakit);
      let cuti = Number(r.cuti);
      let off = Number(r.off);
      const alpaManual = Number(r.alpa_manual);

      let effHariKerja = Math.max(0, hariKerjaIndiv - off);
      const alpaOtomatis = Math.max(0, effHariKerja - hadir - izin - sakit - cuti - alpaManual);
      let alpa = alpaManual + alpaOtomatis;
      let tidakHadir = alpa + izin + sakit + cuti;

      let katHarian = r.kategori_harian;
      if (isHariTunggal) {
        if (mulaiStr > hariIniStr) {
          katHarian = 'belum_terjadi';
        } else if (mulaiStr < tglBuatStr) {
          katHarian = 'belum_terdaftar';
        } else if (!katHarian) {
          katHarian = (hadirAbsen > 0) ? 'hadir_kamera' : 'alpa';
        }
      }

      // Rincian Harian Per Hari (Slicer Mode)
      const rincianHarian = [];
      const curDate = new Date(`${mulaiStr}T00:00:00Z`);
      const endDate = new Date(`${akhirStr}T00:00:00Z`);
      const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

      while (curDate <= endDate) {
        const dStr = curDate.toISOString().split('T')[0];
        const dayOfWeek = curDate.getUTCDay();
        const key = `${r.id}_${dStr}`;
        const absRec = mapAbsensi.get(key);
        const kpRec = mapKp.get(key);
        const rosterRec = rosterMap.get(key);

        let hHadir = 0, hAlpa = 0, hIzin = 0, hSakit = 0, hCuti = 0, hOff = 0;
        let katHarianRow = '';
        let ketTextRow = '-';
        let sumberRow = '';
        let expectedWork = false;

        if (dStr > hariIniStr) {
          katHarianRow = 'belum_terjadi';
          ketTextRow = '- (Belum Terjadi)';
          sumberRow = rosterRec ? 'roster' : 'system';
        } else if (dStr < tglBuatStr) {
          katHarianRow = 'belum_terdaftar';
          ketTextRow = '- (Belum Terdaftar)';
          sumberRow = 'system';
        } else {
          const resolved = resolveDailyCategory({
            hasAttendance: Boolean(absRec && absRec.waktu_datang),
            manualCategory: kpRec?.kategori || null,
            rosterStatus: rosterRec?.status || null,
            isSunday: dayOfWeek === 0,
          });
          katHarianRow = resolved.category;
          sumberRow = resolved.source;
          expectedWork = resolved.expectedWork;
          if (resolved.category === 'hadir_kamera') {
            hHadir = 1;
            const konflik = rosterRec && ['C', 'OFF'].includes(rosterRec.status)
              ? ` - Masuk saat roster ${rosterRec.status}` : '';
            ketTextRow = `${absRec.status_datang === 'telat' ? 'Hadir (Telat)' : 'Hadir (Kamera)'}${konflik}`;
          } else if (resolved.category === 'hadir_manual') {
            hHadir = 1;
            ketTextRow = 'Hadir Manual';
          } else if (resolved.category === 'izin') {
            hIzin = 1;
            ketTextRow = 'Izin';
          } else if (resolved.category === 'sakit') {
            hSakit = 1;
            ketTextRow = 'Sakit';
          } else if (resolved.category === 'cuti') {
            hCuti = 1;
            ketTextRow = rosterRec?.status === 'CP' ? 'Cuti Periodik' : (rosterRec ? 'Cuti Khusus' : 'Cuti');
          } else if (resolved.category === 'off') {
            hOff = 1;
            ketTextRow = rosterRec ? 'OFF Roster' : (kpRec ? 'OFF / Hari Libur' : 'OFF (Hari Minggu)');
          } else {
            hAlpa = 1;
            ketTextRow = rosterRec ? `Alpa - Jadwal Shift ${rosterRec.status}` : 'Alpa';
          }
        }

        const hTidakHadir = hAlpa + hIzin + hSakit + (sumberRow.startsWith('roster') ? 0 : hCuti);

        rincianHarian.push({
          tanggal: dStr,
          hari: NAMA_HARI[dayOfWeek],
          hadir: hHadir,
          tidak_hadir: hTidakHadir,
          alpa: hAlpa,
          izin: hIzin,
          sakit: hSakit,
          cuti: hCuti,
          off: hOff,
          expected_work: expectedWork ? 1 : 0,
          roster_status: rosterRec?.status || null,
          sumber: sumberRow,
          telat: (absRec && absRec.status_datang === 'telat') ? 1 : 0,
          checkout_lewat: (absRec && absRec.status_pulang === 'checkout lewat') ? 1 : 0,
          percobaan_pulang_awal: (absRec && absRec.percobaan_pulang_awal) ? Number(absRec.percobaan_pulang_awal) : 0,
          kategori: katHarianRow,
          keterangan: ketTextRow,
        });

        curDate.setUTCDate(curDate.getUTCDate() + 1);
      }

      // KPI wajib berasal dari status harian yang sudah dideduplikasi. Satu tanggal hanya
      // boleh menyumbang satu kategori; keterangan manual Rekap Performa adalah sumber
      // mutlak dan menimpa presensi kamera (lihat resolveDailyCategory).
      hadirAbsen = rincianHarian.filter((h) => h.kategori === 'hadir_kamera').length;
      hadirManual = rincianHarian.filter((h) => h.kategori === 'hadir_manual').length;
      hadir = rincianHarian.reduce((total, h) => total + h.hadir, 0);
      izin = rincianHarian.reduce((total, h) => total + h.izin, 0);
      sakit = rincianHarian.reduce((total, h) => total + h.sakit, 0);
      cuti = rincianHarian.reduce((total, h) => total + h.cuti, 0);
      alpa = rincianHarian.reduce((total, h) => total + h.alpa, 0);
      tidakHadir = rincianHarian.reduce((total, h) => total + h.tidak_hadir, 0);
      off = rincianHarian.filter((h) => h.kategori === 'off' && h.sumber !== 'legacy').length;
      effHariKerja = rincianHarian.reduce((total, h) => total + h.expected_work, 0);
      if (isHariTunggal && rincianHarian[0]) katHarian = rincianHarian[0].kategori;
      const telat = rincianHarian.reduce((total, h) => total + h.telat, 0);
      const checkoutLewat = rincianHarian.reduce((total, h) => total + h.checkout_lewat, 0);
      const percobaanPulangAwal = rincianHarian.reduce((total, h) => total + h.percobaan_pulang_awal, 0);

      return {
        id: r.id,
        nama: r.nama,
        jabatan: r.jabatan || '—',
        departemen: r.departemen || '—',
        tgl_buat_akun: tglBuatStr,
        total_hari_kerja: effHariKerja,
        hadir,
        hadir_absen: hadirAbsen,
        hadir_manual: hadirManual,
        tidak_hadir: tidakHadir,
        kategori_harian: katHarian,
        telat,
        checkout_lewat: checkoutLewat,
        percobaan_pulang_awal: percobaanPulangAwal,
        izin,
        sakit,
        cuti,
        off,
        alpa,
        rincian_harian: rincianHarian,
        kpi_breakdown: {
          hadir,
          izin,
          sakit,
          cuti,
          alpa,
          tidakHadir
        },
        kpi_tidak_hadir_percentage: (effHariKerja > 0) ? (tidakHadir / effHariKerja) * 100 : 0
      };
    });

    res.json({
      periode,
      tanggal_mulai: mulaiStr,
      tanggal_akhir: akhirStr,
      total_hari_kerja: totalHariKerja,
      rekap,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/keterangan-presensi — checklist/simpan status presensi manual (hadir_manual, alpa, izin, sakit, cuti, off) */
async function simpanKeteranganPresensi(req, res, next) {
  try {
    const { user_id, tanggal, kategori, catatan } = req.body;
    if (!user_id || !tanggal) {
      return res.status(400).json({ error: 'user_id dan tanggal wajib diisi' });
    }

    const { rows: empRows } = await pool.query('SELECT nama, jabatan, departemen FROM users WHERE id = $1', [user_id]);
    const emp = empRows[0] || { nama: 'Karyawan', jabatan: '', departemen: '' };

    const { rows: prevRows } = await pool.query('SELECT kategori FROM keterangan_presensi WHERE user_id = $1 AND tanggal = $2', [user_id, tanggal]);
    const prevKategori = prevRows[0]?.kategori || 'tanpa_keterangan';

    if (!kategori) {
      await pool.query('DELETE FROM keterangan_presensi WHERE user_id = $1 AND tanggal = $2', [user_id, tanggal]);
      if (prevKategori === 'hadir_manual') {
        await pool.query(
          `DELETE FROM absensi
           WHERE user_id = $1 AND tanggal_kerja = $2::date
             AND foto_datang_url IS NULL AND lokasi_datang_lat IS NULL AND lokasi_datang_lng IS NULL
             AND face_match_score_datang IS NULL`,
          [user_id, tanggal]
        );
      }
      return res.json({ message: 'Keterangan presensi berhasil dihapus' });
    }

    const validKategori = ['hadir_manual', 'alpa', 'izin', 'sakit', 'cuti', 'off'];
    if (!validKategori.includes(kategori)) {
      return res.status(400).json({ error: 'Kategori harus salah satu dari: hadir_manual, alpa, izin, sakit, cuti, off' });
    }

    const { rows } = await pool.query(
      `INSERT INTO keterangan_presensi (user_id, tanggal, kategori, catatan)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, tanggal)
       DO UPDATE SET kategori = EXCLUDED.kategori, catatan = EXCLUDED.catatan, created_at = now()
       RETURNING *`,
      [user_id, tanggal, kategori, catatan || null]
    );

    // Hadir manual hanya disimpan di keterangan_presensi. Dashboard Absensi dan portal
    // menggabungkan tabel ini saat membaca data, sehingga tidak perlu jam datang/pulang palsu.
    const tglClean = String(tanggal).split('T')[0];

    const { rows: existingAbs } = await pool.query(
      `SELECT id, status_datang, foto_datang_url, lokasi_datang_lat, lokasi_datang_lng, face_match_score_datang
       FROM absensi
       WHERE user_id = $1
         AND tanggal_kerja = $2::date
       LIMIT 1`,
      [user_id, tglClean]
    );

    // Bersihkan record sintetis dari versi lama. Bukti kamera/GPS/biometrik tidak disentuh.
    const syntheticManual = existingAbs[0]
      && prevKategori === 'hadir_manual'
      && !existingAbs[0].foto_datang_url
      && existingAbs[0].lokasi_datang_lat == null
      && existingAbs[0].lokasi_datang_lng == null
      && existingAbs[0].face_match_score_datang == null;
    if (syntheticManual) {
      await pool.query(`DELETE FROM absensi WHERE id = $1`, [existingAbs[0].id]);
    }

    // Format Audit Log string: contoh: admin utama - 08:12 30/07/26 - manual cuti - ilham SPV Produksi Produksi
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const jamTglStr = `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const adminNama = req.user?.nama || 'Admin Utama';

    const mapLabel = {
      hadir_manual: 'manual hadir',
      alpa: 'manual alpa',
      izin: 'manual izin',
      sakit: 'manual sakit',
      cuti: 'manual cuti',
      off: 'manual off',
    };
    const labelKategori = mapLabel[kategori] || `manual ${kategori}`;
    const logText = `${adminNama} - ${jamTglStr} - ${labelKategori} - ${emp.nama} ${emp.jabatan || ''} ${emp.departemen || ''}`.replace(/\s+/g, ' ').trim();

    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sebelum, data_sesudah)
       VALUES ($1, NULL, $2, $3, $4)`,
      [
        req.user.id,
        logText,
        JSON.stringify({ user_id, tanggal, kategori_sebelum: prevKategori }),
        JSON.stringify({ user_id, tanggal, kategori_sesudah: kategori }),
      ]
    );

    res.json({ message: 'Keterangan presensi berhasil disimpan', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/audit-log-performa — daftar audit log perubahan manual rekap performa */
async function daftarAuditLogPerforma(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.alasan, a.waktu_perubahan, a.data_sebelum, a.data_sesudah, u.nama AS admin_nama
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.admin_id
       WHERE a.absensi_id IS NULL
       ORDER BY a.waktu_perubahan DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/** Hitung jumlah hari Senin–Sabtu dalam rentang tanggal */
function hitungHariKerja(mulai, akhir) {
  let count = 0;
  const cur = new Date(mulai);
  while (cur <= akhir) {
    const hari = cur.getDay();
    if (hari !== 0) count++; // 0 = Minggu
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ============================================================
// REGISTRASI PENDING — approve / tolak pendaftar baru
// ============================================================

/** GET /api/admin/registrasi-pending */
async function daftarRegistrasiPending(req, res, next) {
  try {
    const { status = 'menunggu' } = req.query;
    const { rows } = await pool.query(
      `SELECT rp.*, s.nama_shift, l.nama_lokasi
       FROM registrasi_pending rp
       LEFT JOIN shifts s ON s.id = rp.shift_id
       LEFT JOIN lokasi_kantor l ON l.id = rp.lokasi_kantor_id
       WHERE rp.status = $1
       ORDER BY rp.created_at DESC`,
      [status]
    );

    const rowsDenganFoto = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        foto_1_url: await getUrlFoto(r.foto_referensi_1_url),
        foto_2_url: await getUrlFoto(r.foto_referensi_2_url),
        foto_3_url: await getUrlFoto(r.foto_referensi_3_url),
      }))
    );

    res.json(rowsDenganFoto);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/registrasi-pending/:id
 * body: { aksi: 'disetujui'|'ditolak', catatan_admin?, shift_id?, lokasi_kantor_id? }
 *
 * Saat disetujui → buat akun karyawan baru di tabel users
 */
async function prosesRegistrasi(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { aksi, catatan_admin, shift_id: shiftOverride, lokasi_kantor_id: lokasiOverride } = req.body;

    if (!['disetujui', 'ditolak'].includes(aksi)) {
      return res.status(400).json({ error: 'aksi harus "disetujui" atau "ditolak"' });
    }
    if (aksi === 'disetujui') {
      // People v2: akun hanya dibuat lewat Tambah karyawan (jabatan dari master, NRP otomatis, lokasi absen).
      return res.status(410).json({
        code: 'REGISTRATION_APPROVAL_REMOVED',
        error: 'Persetujuan pendaftaran dihentikan. Tolak pengajuan ini lalu input ulang lewat Karyawan → Tambah karyawan.',
      });
    }

    const { rows } = await client.query(
      `SELECT * FROM registrasi_pending WHERE id = $1 AND status = 'menunggu'`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Data pendaftaran tidak ditemukan atau sudah diproses' });

    const reg = rows[0];

    await client.query('BEGIN');

    // Update status pendaftaran
    await client.query(
      `UPDATE registrasi_pending
       SET status = $1, catatan_admin = $2, diproses_at = now()
       WHERE id = $3`,
      [aksi, catatan_admin || null, id]
    );

    let karyawanBaru = null;
    if (aksi === 'disetujui') {
      // ── Cek duplikat wajah via CompreFace sebelum membuat akun ──────────────
      const fotoUrl = reg.foto_referensi_1_url;
      if (fotoUrl) {
        try {
          const axios = require('axios');
          const FormData = require('form-data');
          const { verifikasiWajah } = require('../services/compreface');

          // Download foto dari Supabase storage (URL publik)
          const fotoResp = await axios.get(fotoUrl, { responseType: 'arraybuffer', timeout: 10000 });
          const fotoBuffer = Buffer.from(fotoResp.data);

          // Cek apakah wajah ini sudah ada di CompreFace (match ke subject manapun)
          const { getComprefaceBaseUrl } = require('../services/compreface');
          const BASE_URL = await getComprefaceBaseUrl();
          const API_KEY = process.env.COMPREFACE_RECOGNITION_API_KEY || '00000000-0000-0000-0000-000000000000';
          const form = new FormData();
          form.append('file', fotoBuffer, { filename: 'check.jpg' });
          const cfResp = await axios.post(
            `${BASE_URL}/api/v1/recognition/recognize`,
            form,
            { headers: { ...form.getHeaders(), 'x-api-key': API_KEY }, params: { limit: 1 }, timeout: 8000 }
          );
          const bestMatch = cfResp.data?.result?.[0]?.subjects?.[0];
          const THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.85);
          if (bestMatch && bestMatch.similarity >= THRESHOLD && bestMatch.subject !== reg.email) {
            await client.query('ROLLBACK');
            // Kembalikan status pending agar bisa diproses ulang
            await pool.query(
              `UPDATE registrasi_pending SET status = 'menunggu', catatan_admin = $1, diproses_at = NULL WHERE id = $2`,
              [`[AUTO-TOLAK] Wajah terdeteksi mirip dengan akun: ${bestMatch.subject} (similarity: ${(bestMatch.similarity*100).toFixed(1)}%)`, id]
            );
            return res.status(409).json({
              error: `Pendaftaran ditolak otomatis: wajah pendaftar terdeteksi sudah terdaftar pada akun "${bestMatch.subject}" (kemiripan ${(bestMatch.similarity*100).toFixed(1)}%). Tidak boleh ada 2 akun dengan wajah yang sama.`,
            });
          }
        } catch (cfErr) {
          // CompreFace tidak bisa diakses — lanjutkan approval (non-blocking) agar Admin tidak pernah terhambat
          console.warn('[CompreFace] Cek duplikat wajah dilewati karena CompreFace offline:', cfErr.message);
        }
      }
      // ── Buat akun karyawan dari data pendaftar ──────────────────────────────
      const finalShiftId = shiftOverride || reg.shift_id;
      const finalLokasiId = lokasiOverride || reg.lokasi_kantor_id;
      const comprefaceSubject = reg.email;

      const { rows: newUser } = await client.query(
        `INSERT INTO users
           (nama, email, jabatan, departemen, password_hash, role, shift_id, lokasi_kantor_id, foto_referensi_url, compreface_subject)
         VALUES ($1,$2,$3,$4,$5,'karyawan',$6,$7,$8,$9)
         RETURNING id, employee_id, nama, email, jabatan, departemen`,
        [
          reg.nama, reg.email, reg.jabatan, reg.departemen, reg.password_hash,
          finalShiftId || null, finalLokasiId || null,
          reg.foto_referensi_1_url || null,
          comprefaceSubject
        ]
      );
      karyawanBaru = newUser[0];
      await Workforce.recordInitialHire(client, req.user, karyawanBaru, {
        department: reg.departemen,
        position: reg.jabatan,
      });
    }

    await client.query('COMMIT');

    // Daftarkan sampel foto ke CompreFace di background (TANPA memblokir response ke klien)
    if (aksi === 'disetujui') {
      const { daftarkanWajahReferensi } = require('../services/compreface');
      const { getUrlFoto } = require('../services/storage');
      const fotoKeys = [reg.foto_referensi_1_url, reg.foto_referensi_2_url, reg.foto_referensi_3_url].filter(Boolean);
      const comprefaceSubject = reg.email;
      
      Promise.resolve().then(async () => {
        for (const key of fotoKeys) {
          try {
            let buffer;
            const axios = require('axios');
            const photoUrl = await getUrlFoto(key);
            const resp = await axios.get(photoUrl, { responseType: 'arraybuffer', timeout: 10000 });
            buffer = Buffer.from(resp.data);
            if (buffer) {
              await daftarkanWajahReferensi(buffer, comprefaceSubject);
            }
          } catch (e) {
            console.warn(`[CompreFace] Gagal mendaftarkan sampel foto ${key}:`, e.message);
          }
        }
      }).catch(err => console.error('[CompreFace] Background task error:', err));
    }

    res.json({
      message: aksi === 'disetujui'
        ? `Pendaftaran disetujui. Akun karyawan ${reg.nama} berhasil dibuat.`
        : `Pendaftaran ditolak.`,
      karyawan: karyawanBaru,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Email sudah terdaftar di sistem' });
    next(err);
  } finally {
    client.release();
  }
}

/** GET /api/admin/me — Ambil data profil admin yang sedang login & otoritasnya */
async function getProfilMe(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT id, nama, email, role, is_super_admin, permissions, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Admin tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/me — Admin mengedit email & password sendiri */
async function updateProfilMe(req, res, next) {
  try {
    const { email, password_lama, password_baru, nama } = req.body;
    const adminId = req.user.id;

    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [adminId]);
    const admin = rows[0];
    if (!admin) return res.status(404).json({ error: 'Admin tidak ditemukan' });

    if (password_baru) {
      if (!password_lama) {
        return res.status(400).json({ error: 'Password lama wajib diisi untuk mengubah password' });
      }
      const cocok = await bcrypt.compare(password_lama, admin.password_hash);
      if (!cocok) {
        return res.status(401).json({ error: 'Password lama salah' });
      }
    }

    let passwordHash = admin.password_hash;
    if (password_baru && password_baru.trim()) {
      if (password_baru.length < 6) {
        return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
      }
      passwordHash = await bcrypt.hash(password_baru.trim(), 10);
    }

    const newNama = nama && nama.trim() ? nama.trim() : admin.nama;
    const newEmail = email && email.trim() ? email.trim() : admin.email;

    const updateRes = await pool.query(
      `UPDATE users SET nama = $1, email = $2, password_hash = $3 WHERE id = $4 RETURNING id, nama, email, role, is_super_admin, permissions`,
      [newNama, newEmail, passwordHash, adminId]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, $3)`,
      [adminId, `${admin.nama} memperbarui profil/password admin-nya sendiri`, JSON.stringify(updateRes.rows[0])]
    ).catch(e => console.warn('Audit log error:', e.message));

    res.json({ message: 'Profil admin berhasil diperbarui', admin: updateRes.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email sudah digunakan oleh akun lain' });
    next(err);
  }
}

/** GET /api/admin/sub-admins — (Khusus Admin Utama) Daftar akun sub-admin */
async function daftarSubAdmins(req, res, next) {
  try {
    const { rows: meRows } = await pool.query(`SELECT is_super_admin FROM users WHERE id = $1`, [req.user.id]);
    if (!meRows[0]?.is_super_admin) {
      return res.status(403).json({ error: 'Hanya Admin Utama yang berhak mengelola akun admin' });
    }

    const { rows } = await pool.query(
      `SELECT id, nama, email, role, is_super_admin, permissions, is_active, created_at FROM users WHERE role = 'admin' ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/sub-admins — (Khusus Admin Utama) Buat akun admin baru & tentukan otoritas akses */
async function buatSubAdmin(req, res, next) {
  try {
    const { rows: meRows } = await pool.query(`SELECT is_super_admin FROM users WHERE id = $1`, [req.user.id]);
    if (!meRows[0]?.is_super_admin) {
      return res.status(403).json({ error: 'Hanya Admin Utama yang berhak membuat akun admin baru' });
    }

    const { nama, email, password, permissions } = req.body;
    if (!nama || !email || !password) {
      return res.status(400).json({ error: 'Nama, email, dan password wajib diisi' });
    }

    const passwordHash = await bcrypt.hash(password.trim(), 10);
    // Kolom permissions bertipe text[] (ARRAY), jadi kirim array JS langsung (pg meng-serialize otomatis)
    const perms = Array.isArray(permissions)
      ? permissions
      : ["absensi", "karyawan", "performa", "roster", "registrasi", "payroll", "hm", "kalkulasiPayroll", "produksi"];

    const { rows } = await pool.query(
      `INSERT INTO users (nama, email, password_hash, role, is_super_admin, permissions, is_active)
       VALUES ($1, $2, $3, 'admin', FALSE, $4, TRUE)
       RETURNING id, nama, email, role, is_super_admin, permissions, is_active, created_at`,
      [nama.trim(), email.trim(), passwordHash, perms]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, $3)`,
      [req.user.id, `Admin Utama membuat akun admin baru "${nama}" (${email})`, JSON.stringify(rows[0])]
    ).catch(e => console.warn('Audit log error:', e.message));

    res.status(201).json({ message: `Akun Admin Baru "${nama}" berhasil dibuat`, admin: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email sudah terdaftar di sistem' });
    next(err);
  }
}

/** PATCH /api/admin/sub-admins/:id — (Khusus Admin Utama) Update otoritas akses/password sub-admin */
async function updateSubAdmin(req, res, next) {
  try {
    const { rows: meRows } = await pool.query(`SELECT is_super_admin FROM users WHERE id = $1`, [req.user.id]);
    if (!meRows[0]?.is_super_admin) {
      return res.status(403).json({ error: 'Hanya Admin Utama yang berhak mengubah otoritas admin' });
    }

    const { id } = req.params;
    const { nama, email, password, permissions, is_active } = req.body;

    const { rows: existing } = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'admin'`, [id]);
    const target = existing[0];
    if (!target) return res.status(404).json({ error: 'Akun admin tidak ditemukan' });

    let passwordHash = target.password_hash;
    if (password && password.trim()) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    const newNama = nama && nama.trim() ? nama.trim() : target.nama;
    const newEmail = email && email.trim() ? email.trim() : target.email;
    // Kolom permissions bertipe text[] (ARRAY), jadi kirim array JS langsung (pg meng-serialize otomatis)
    const perms = Array.isArray(permissions) ? permissions : (target.permissions || []);
    const activeState = typeof is_active === 'boolean' ? is_active : target.is_active;

    const { rows: updated } = await pool.query(
      `UPDATE users SET nama = $1, email = $2, password_hash = $3, permissions = $4, is_active = $5 WHERE id = $6 RETURNING id, nama, email, role, is_super_admin, permissions, is_active`,
      [newNama, newEmail, passwordHash, perms, activeState, id]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, $3)`,
      [req.user.id, `Admin Utama memperbarui otoritas/data admin "${newNama}"`, JSON.stringify(updated[0])]
    ).catch(e => console.warn('Audit log error:', e.message));

    res.json({ message: `Data admin "${newNama}" berhasil diperbarui`, admin: updated[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email sudah terdaftar di sistem' });
    next(err);
  }
}

/** DELETE /api/admin/sub-admins/:id — (Khusus Admin Utama) Hapus akun sub-admin */
async function hapusSubAdmin(req, res, next) {
  try {
    const { rows: meRows } = await pool.query(`SELECT is_super_admin FROM users WHERE id = $1`, [req.user.id]);
    if (!meRows[0]?.is_super_admin) {
      return res.status(403).json({ error: 'Hanya Admin Utama yang berhak menghapus akun admin' });
    }

    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Anda tidak dapat menghapus akun Anda sendiri' });
    }

    const { rows: target } = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'admin'`, [id]);
    if (!target[0]) return res.status(404).json({ error: 'Akun admin tidak ditemukan' });

    if (target[0].is_super_admin) {
      return res.status(400).json({ error: 'Akun Admin Utama tidak dapat dihapus' });
    }

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sebelum) VALUES ($1, NULL, $2, $3)`,
      [req.user.id, `Admin Utama menghapus akun admin "${target[0].nama}" (${target[0].email})`, JSON.stringify(target[0])]
    ).catch(e => console.warn('Audit log error:', e.message));

    res.json({ message: `Akun Admin "${target[0].nama}" berhasil dihapus` });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/update-tunnel-url — Update URL Cloudflare Tunnel CompreFace secara otomatis */
async function updateTunnelUrl(req, res, next) {
  try {
    const { url, secret } = req.body;
    const expectedSecret = process.env.TUNNEL_SECRET || 'PimAbsensi2026!';
    if (secret !== expectedSecret) {
      return res.status(403).json({ error: 'Secret token tidak valid' });
    }
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'URL tunnel tidak valid' });
    }

    const cleanUrl = url.trim().replace(/\/$/, '');
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('compreface_url', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [cleanUrl]
    );

    console.log(`[Tunnel Sync] ✅ CompreFace URL updated dynamically to: ${cleanUrl}`);
    res.json({ message: 'URL CompreFace berhasil diperbarui otomatis', url: cleanUrl });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  semuaAbsensi, exportAbsensiExcel, editAbsensiManual, buatQueryAbsensiTerfilter, auditLogAbsensi, daftarShift,
  rekapPerforma, simpanKeteranganPresensi, daftarAuditLogPerforma, daftarRegistrasiPending, prosesRegistrasi,
  getProfilMe, updateProfilMe, daftarSubAdmins, buatSubAdmin, updateSubAdmin, hapusSubAdmin, updateTunnelUrl
};
