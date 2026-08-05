const { pool } = require('../config/db');
const { dalamRadius } = require('../utils/geofence');
const { statusAbsenDatang, statusAbsenPulang } = require('../utils/shiftValidator');
const { verifikasiWajah } = require('../services/compreface');
const { uploadFoto, getUrlFoto } = require('../services/storage');

async function getUserLengkap(userId) {
  const { rows } = await pool.query(
    `SELECT u.*, l.latitude, l.longitude, l.radius_meter
     FROM users u
     JOIN lokasi_kantor l ON l.id = u.lokasi_kantor_id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0];
}

async function getShift(shiftId) {
  const { rows } = await pool.query(
    `SELECT * FROM shifts WHERE id = $1`,
    [shiftId]
  );
  return rows[0];
}

async function getSesiPending(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM absensi WHERE user_id = $1 AND waktu_pulang IS NULL
     ORDER BY tanggal_kerja DESC LIMIT 1`,
    [userId]
  );
  return rows[0];
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

/**
 * POST /api/absensi/datang
 * body: { latitude, longitude }
 * file: foto (multipart, field name 'foto')
 */
async function absenDatang(req, res, next) {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined || !req.file) {
      return res.status(400).json({ error: 'latitude, longitude, dan foto wajib dikirim' });
    }

    const sekarang = new Date();
    const jamSekarang = sekarang.getHours() + (sekarang.getMinutes() / 60);

    let targetShiftName = null;
    // Siang: 04:00 s/d 09:00
    if (jamSekarang >= 4 && jamSekarang <= 9) {
      targetShiftName = 'Siang';
    } 
    // Malam: 16:00 s/d 21:00
    else if (jamSekarang >= 16 && jamSekarang <= 21) {
      targetShiftName = 'Malam';
    } else {
      return res.status(403).json({ error: 'Anda tidak bisa absen. Di luar rentang waktu absen datang (04:00-09:00 untuk Siang, 16:00-21:00 untuk Malam).' });
    }

    // Ambil shift dari database
    const { rows: shiftRows } = await pool.query("SELECT * FROM shifts WHERE nama_shift ILIKE $1 LIMIT 1", [`%${targetShiftName}%`]);
    if (shiftRows.length === 0) {
      return res.status(500).json({ error: `Shift ${targetShiftName} tidak ditemukan di database` });
    }
    const shift = shiftRows[0];
    const shift_id = shift.id;

    const { lat, lng } = parseCoordinates(latitude, longitude);
    const user = await getUserLengkap(req.user.id);
    if (!user) return res.status(404).json({ error: 'Data karyawan tidak ditemukan' });
    if (!user.lokasi_kantor_id) return res.status(400).json({ error: 'Lokasi kantor belum ditetapkan untuk akun ini' });

    // Gabungkan data user dan shift untuk validator
    const userDenganShift = { ...user, ...shift };

    // 1. Cek sesi kemarin yang belum checkout — wajib diselesaikan dulu
    const sesiPending = await getSesiPending(user.id);
    if (sesiPending) {
      return res.status(409).json({
        error: 'Ada sesi absen sebelumnya yang belum checkout. Selesaikan absen pulang dulu.',
        absensi_id_pending: sesiPending.id,
      });
    }

    // 2. Validasi lokasi
    const cekLokasi = dalamRadius(lat, lng, {
      latitude: user.latitude,
      longitude: user.longitude,
      radius_meter: user.radius_meter,
    });
    if (!cekLokasi.valid) {
      return res.status(403).json({
        error: `Di luar radius lokasi kantor (jarak ${cekLokasi.jarak_meter}m, maks ${user.radius_meter}m)`,
      });
    }

    // 3. Validasi wajah via CompreFace
    const hasilWajah = await verifikasiWajah(req.file.buffer, user.compreface_subject);
    if (!hasilWajah.valid) {
      return res.status(403).json({
        error: 'Wajah tidak cocok dengan data akun',
        similarity: hasilWajah.similarity,
      });
    }

    // 4. Tentukan status & simpan
    const yyyy = sekarang.getFullYear();
    const mm = String(sekarang.getMonth() + 1).padStart(2, '0');
    const dd = String(sekarang.getDate()).padStart(2, '0');
    const tanggalKerja = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    const status = statusAbsenDatang(userDenganShift, tanggalKerja, sekarang);

    const fotoKey = await uploadFoto(req.file.buffer, { userId: user.id, jenis: 'datang' });

    const { rows } = await pool.query(
      `INSERT INTO absensi
        (user_id, shift_id, tanggal_kerja, waktu_datang, lokasi_datang_lat, lokasi_datang_lng,
         foto_datang_url, face_match_score_datang, status_datang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        user.id,
        shift_id,
        tanggalKerja,
        sekarang,
        lat,
        lng,
        fotoKey,
        hasilWajah.similarity,
        status,
      ]
    );

    res.status(201).json({ message: 'Absen datang berhasil', status, nama_shift: shift.nama_shift, absensi: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Sesi absen aktif sudah ada. Silakan muat ulang riwayat absensi.' });
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
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined || !req.file) {
      return res.status(400).json({ error: 'latitude, longitude, dan foto wajib dikirim' });
    }

    const { lat, lng } = parseCoordinates(latitude, longitude);
    const user = await getUserLengkap(req.user.id);
    if (!user) return res.status(404).json({ error: 'Data karyawan tidak ditemukan' });

    const sesiPending = await getSesiPending(user.id);
    if (!sesiPending) {
      return res.status(400).json({ error: 'Tidak ada sesi absen datang yang aktif untuk di-checkout' });
    }

    const cekLokasi = dalamRadius(lat, lng, {
      latitude: user.latitude,
      longitude: user.longitude,
      radius_meter: user.radius_meter,
    });
    if (!cekLokasi.valid) {
      return res.status(403).json({
        error: `Di luar radius lokasi kantor (jarak ${cekLokasi.jarak_meter}m, maks ${user.radius_meter}m)`,
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
    const tglKerjaRaw = sesiPending.tanggal_kerja;
    const tglKerjaStr = typeof tglKerjaRaw === 'string'
      ? tglKerjaRaw.split('T')[0]
      : `${tglKerjaRaw.getFullYear()}-${String(tglKerjaRaw.getMonth() + 1).padStart(2, '0')}-${String(tglKerjaRaw.getDate()).padStart(2, '0')}`;
    const tanggalKerjaSesi = new Date(`${tglKerjaStr}T00:00:00`);
    
    let status;
    try {
      status = statusAbsenPulang(shift, tanggalKerjaSesi, sekarang);
    } catch (err) {
      if (err.statusCode === 400 && err.message.includes('Jam pulang belum tersedia')) {
        const selisihMs = sekarang.getTime() - new Date(sesiPending.waktu_datang).getTime();
        const selisihJam = selisihMs / (1000 * 60 * 60);
        
        if (selisihJam <= 5) {
          await pool.query(`UPDATE absensi SET percobaan_pulang_awal = COALESCE(percobaan_pulang_awal, 0) + 1 WHERE id = $1`, [sesiPending.id]);
        }
      }
      throw err;
    }

    const fotoKey = await uploadFoto(req.file.buffer, { userId: user.id, jenis: 'pulang' });

    const { rows } = await pool.query(
      `UPDATE absensi SET
        waktu_pulang = $1, lokasi_pulang_lat = $2, lokasi_pulang_lng = $3,
        foto_pulang_url = $4, face_match_score_pulang = $5, status_pulang = $6,
        updated_at = now()
       WHERE id = $7
       RETURNING *`,
      [sekarang, lat, lng, fotoKey, hasilWajah.similarity, status, sesiPending.id]
    );

    res.json({ message: 'Absen pulang berhasil', status, absensi: rows[0] });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
}

/** GET /api/absensi/riwayat — riwayat absensi milik karyawan yang login */
async function riwayat(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM absensi WHERE user_id = $1 ORDER BY tanggal_kerja DESC LIMIT 100`,
      [req.user.id]
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
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 29); // 30 hari termasuk hari ini

    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const endStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    const { rows: absensiRows } = await pool.query(
      `SELECT tanggal_kerja::text AS tanggal_kerja, status_datang, status_pulang, waktu_datang, waktu_pulang
       FROM absensi
       WHERE user_id = $1
         AND tanggal_kerja >= $2
         AND tanggal_kerja <= $3
       ORDER BY tanggal_kerja ASC`,
      [req.user.id, startStr, endStr]
    );

    const { rows: kpRows } = await pool.query(
      `SELECT tanggal::text AS tanggal, kategori, catatan
       FROM keterangan_presensi
       WHERE user_id = $1
         AND tanggal >= $2
         AND tanggal <= $3`,
      [req.user.id, startStr, endStr]
    );

    // Buat map tanggal -> status untuk 30 hari
    const mapAbsensi = {};
    absensiRows.forEach((r) => {
      const tgl = String(r.tanggal_kerja).split('T')[0];
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
      d.setDate(start.getDate() + i);
      const tgl = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

      hasil.push({ tanggal: tgl, status, ...data, kategori_manual: manualCat });
    }

    res.json(hasil);
  } catch (err) {
    next(err);
  }
}

/** GET /api/absensi/lokasi-kantor — koordinat & radius kantor untuk minimap karyawan */
async function lokasiKantorSaya(req, res, next) {
  try {
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
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/** GET /api/absensi/rekap-hm — rekapitulasi HM bulan berjalan khusus milik karyawan bersangkutan */
async function rekapHmKaryawan(req, res, next) {
  try {
    const userId = req.user.id;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    const tglMulai = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const tglAkhirDate = new Date(y, m + 1, 0);
    const tglAkhir = `${y}-${String(m + 1).padStart(2, '0')}-${String(tglAkhirDate.getDate()).padStart(2, '0')}`;

    const { rows } = await pool.query(
      `SELECT h.id, h.tanggal, h.kode_unit, h.hm_awal, h.hm_akhir, h.total_hm, h.keterangan
       FROM database_hm h
       WHERE h.user_id = $1 AND h.tanggal BETWEEN $2 AND $3
       ORDER BY h.tanggal ASC, h.created_at ASC`,
      [userId, tglMulai, tglAkhir]
    );

    const totalHmBulanIni = rows.reduce((acc, r) => acc + Number(r.total_hm || 0), 0);
    const uniqueDays = new Set(rows.map((r) => (r.tanggal ? new Date(r.tanggal).toISOString().split('T')[0] : ''))).size;

    res.json({
      periode: 'bulanan',
      bulan_tahun: `${now.toLocaleString('id-ID', { month: 'long' })} ${y}`,
      tanggal_mulai: tglMulai,
      tanggal_akhir: tglAkhir,
      total_hm_bulan_ini: Number(totalHmBulanIni.toFixed(2)),
      total_hari_operasi: uniqueDays,
      list_harian: rows.map((r) => ({
        id: r.id,
        tanggal: r.tanggal ? new Date(r.tanggal).toISOString().split('T')[0] : '',
        kode_unit: r.kode_unit,
        hm_awal: Number(r.hm_awal),
        hm_akhir: Number(r.hm_akhir),
        total_hm: Number(r.total_hm),
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
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ valid: false, message: 'latitude dan longitude wajib dikirim' });
    }

    const { lat, lng } = parseCoordinates(latitude, longitude);
    const user = await getUserLengkap(req.user.id);
    if (!user) return res.status(404).json({ valid: false, message: 'Data karyawan tidak ditemukan' });

    const cekLokasiObj = dalamRadius(lat, lng, {
      latitude: user.latitude,
      longitude: user.longitude,
      radius_meter: user.radius_meter,
    });

    if (!cekLokasiObj.valid) {
      return res.json({
        valid: false,
        message: `Di luar radius lokasi kantor (jarak ${cekLokasiObj.jarak_meter}m, maks ${user.radius_meter}m)`
      });
    }

    return res.json({ valid: true, message: 'Lokasi sah' });
  } catch (err) {
    next(err);
  }
}

module.exports = { absenDatang, absenPulang, riwayat, rekapKehadiran, lokasiKantorSaya, rekapHmKaryawan, checkLokasi };
