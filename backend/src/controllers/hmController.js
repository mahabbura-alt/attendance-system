const { pool } = require('../config/db');

function getStartOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function getEndOfWeek(d) {
  const start = getStartOfWeek(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

function formatTgl(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** GET /api/admin/hm — List & recap database HM (Harian, Mingguan, Bulanan) */
async function daftarHm(req, res, next) {
  try {
    const { periode = 'harian', tanggal } = req.query;
    const refDate = tanggal ? new Date(tanggal) : new Date();
    const refStr = formatTgl(refDate);

    let tglMulai = refStr;
    let tglAkhir = refStr;

    if (periode === 'mingguan') {
      tglMulai = formatTgl(getStartOfWeek(refDate));
      tglAkhir = formatTgl(getEndOfWeek(refDate));
    } else if (periode === 'bulanan') {
      const y = refDate.getFullYear();
      const m = refDate.getMonth();
      tglMulai = formatTgl(new Date(y, m, 1));
      tglAkhir = formatTgl(new Date(y, m + 1, 0));
    }

    if (periode === 'harian') {
      const { rows } = await pool.query(
        `SELECT
           u.id AS user_id,
           COALESCE(u.employee_id, h.employee_id) AS employee_id,
           u.nama AS nama_karyawan,
           COALESCE(u.jabatan, h.jabatan) AS jabatan,
           h.id AS hm_id,
           $1::date AS tanggal,
           COALESCE(h.kode_unit, '') AS kode_unit,
           COALESCE(h.hm_awal, 0) AS hm_awal,
           COALESCE(h.hm_akhir, 0) AS hm_akhir,
           COALESCE(h.total_hm, 0) AS total_hm,
           COALESCE(h.keterangan, '') AS keterangan,
           (h.id IS NOT NULL) AS is_saved
         FROM users u
         LEFT JOIN database_hm h ON h.user_id = u.id AND h.tanggal = $1
         WHERE u.role = 'karyawan'
           AND u.is_active = TRUE
           AND (
             LOWER(u.jabatan) IN ('operator', 'driver dt', 'driver wt')
             OR LOWER(u.jabatan) LIKE '%operator%'
             OR LOWER(u.jabatan) LIKE '%driver%'
             OR h.id IS NOT NULL
           )
         ORDER BY u.nama ASC`,
        [tglMulai]
      );

      return res.json({
        periode,
        tanggal_mulai: tglMulai,
        tanggal_akhir: tglAkhir,
        rekap: rows,
      });
    }

    // Rekapitulasi Mingguan / Bulanan (Aggregated)
    const { rows } = await pool.query(
      `SELECT
         h.user_id,
         h.employee_id,
         h.nama_karyawan,
         h.jabatan,
         h.kode_unit,
         COUNT(DISTINCT h.tanggal)::int AS total_hari_operasi,
         MIN(h.hm_awal) AS hm_awal_periode,
         MAX(h.hm_akhir) AS hm_akhir_periode,
         SUM(h.total_hm) AS total_hm_periode,
         ROUND(AVG(h.total_hm), 2) AS avg_hm_per_hari
       FROM database_hm h
       WHERE h.tanggal BETWEEN $1 AND $2
       GROUP BY h.user_id, h.employee_id, h.nama_karyawan, h.jabatan, h.kode_unit
       ORDER BY h.nama_karyawan, h.kode_unit`,
      [tglMulai, tglAkhir]
    );

    res.json({
      periode,
      tanggal_mulai: tglMulai,
      tanggal_akhir: tglAkhir,
      rekap: rows,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/hm — Tambah data HM harian manual */
async function buatHm(req, res, next) {
  try {
    const { user_id, employee_id, nama_karyawan, jabatan, tanggal, kode_unit, hm_awal, hm_akhir, keterangan } = req.body;

    let finalEmpId = employee_id;
    let finalNama = nama_karyawan;
    let finalJabatan = jabatan;
    let finalUserId = user_id || null;

    if (user_id) {
      const { rows: empRows } = await pool.query(
        'SELECT id, employee_id, nama, jabatan FROM users WHERE id = $1',
        [user_id]
      );
      if (empRows[0]) {
        finalUserId = empRows[0].id;
        finalEmpId = empRows[0].employee_id || employee_id;
        finalNama = empRows[0].nama || nama_karyawan;
        finalJabatan = empRows[0].jabatan || jabatan;
      }
    }

    if (!finalNama || !finalNama.trim()) {
      return res.status(400).json({ error: 'Nama karyawan wajib diisi atau pilih dari dropdown' });
    }
    if (!kode_unit || !kode_unit.trim()) {
      return res.status(400).json({ error: 'Kode unit wajib diisi' });
    }

    const valHmAwal = Number(hm_awal || 0);
    const valHmAkhir = Number(hm_akhir || 0);

    if (valHmAkhir < valHmAwal) {
      return res.status(400).json({ error: 'HM Akhir tidak boleh lebih kecil dari HM Awal' });
    }

    const tglInput = tanggal || formatTgl(new Date());

    const { rows } = await pool.query(
      `INSERT INTO database_hm (user_id, employee_id, nama_karyawan, jabatan, tanggal, kode_unit, hm_awal, hm_akhir, keterangan)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        finalUserId,
        finalEmpId ? finalEmpId.trim() : null,
        finalNama.trim(),
        finalJabatan ? finalJabatan.trim() : null,
        tglInput,
        kode_unit.trim().toUpperCase(),
        valHmAwal,
        valHmAkhir,
        keterangan ? keterangan.trim() : null,
      ]
    );

    // Audit Log
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const jamTglStr = `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const adminNama = req.user?.nama || 'Admin Utama';
    const logText = `${adminNama} - ${jamTglStr} - Input HM - ${rows[0].nama_karyawan} (Unit ${rows[0].kode_unit}: HM ${valHmAwal} -> ${valHmAkhir})`;

    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah)
       VALUES ($1, NULL, $2, $3)`,
      [req.user.id, logText, JSON.stringify(rows[0])]
    );

    res.status(201).json({ message: 'Data HM berhasil dicatat', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/hm/:id — Update data HM manual */
async function updateHm(req, res, next) {
  try {
    const { id } = req.params;
    const { tanggal, kode_unit, hm_awal, hm_akhir, keterangan } = req.body;

    const { rows: prevRows } = await pool.query('SELECT * FROM database_hm WHERE id = $1', [id]);
    if (!prevRows[0]) {
      return res.status(404).json({ error: 'Data HM tidak ditemukan' });
    }
    const prevData = prevRows[0];

    const valHmAwal = hm_awal !== undefined ? Number(hm_awal) : Number(prevData.hm_awal);
    const valHmAkhir = hm_akhir !== undefined ? Number(hm_akhir) : Number(prevData.hm_akhir);

    if (valHmAkhir < valHmAwal) {
      return res.status(400).json({ error: 'HM Akhir tidak boleh lebih kecil dari HM Awal' });
    }

    const { rows } = await pool.query(
      `UPDATE database_hm SET
         tanggal = COALESCE($1, tanggal),
         kode_unit = COALESCE($2, kode_unit),
         hm_awal = $3,
         hm_akhir = $4,
         keterangan = COALESCE($5, keterangan),
         updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        tanggal || prevData.tanggal,
        kode_unit ? kode_unit.trim().toUpperCase() : prevData.kode_unit,
        valHmAwal,
        valHmAkhir,
        keterangan !== undefined ? (keterangan ? keterangan.trim() : null) : prevData.keterangan,
        id,
      ]
    );

    // Audit Log
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const jamTglStr = `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const adminNama = req.user?.nama || 'Admin Utama';
    const logText = `${adminNama} - ${jamTglStr} - Update HM - ${rows[0].nama_karyawan} (Unit ${rows[0].kode_unit}: Total HM ${rows[0].total_hm})`;

    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sebelum, data_sesudah)
       VALUES ($1, NULL, $2, $3, $4)`,
      [req.user.id, logText, JSON.stringify(prevData), JSON.stringify(rows[0])]
    );

    res.json({ message: 'Data HM berhasil diperbarui', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/hm/:id — Hapus data HM */
async function hapusHm(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('DELETE FROM database_hm WHERE id = $1 RETURNING *', [id]);
    if (!rows[0]) {
      return res.status(404).json({ error: 'Data HM tidak ditemukan' });
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const jamTglStr = `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const adminNama = req.user?.nama || 'Admin Utama';
    const logText = `${adminNama} - ${jamTglStr} - Hapus HM - ${rows[0].nama_karyawan} (Unit ${rows[0].kode_unit})`;

    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sebelum)
       VALUES ($1, NULL, $2, $3)`,
      [req.user.id, logText, JSON.stringify(rows[0])]
    );

    res.json({ message: `Data HM unit ${rows[0].kode_unit} (${rows[0].nama_karyawan}) berhasil dihapus` });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  daftarHm,
  buatHm,
  updateHm,
  hapusHm,
};
