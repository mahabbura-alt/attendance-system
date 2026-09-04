const { pool } = require('../config/db');
const xlsx = require('xlsx');
const { isJabatanEligibleForHm } = require('../services/hmEligibility');
const { parseHmImportMatrix } = require('../services/hmExcel');
const {
  buildDateRange,
  validateDateRange,
  validateJamOperasi,
  sumDailyHm,
  ensureHmDailySchema,
} = require('../services/hmDaily');

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function isHmRole(jabatan) {
  const normalized = String(jabatan || '').toLowerCase();
  return isJabatanEligibleForHm(jabatan) &&
    (normalized.includes('operator') || normalized.includes('driver'));
}

async function getEligibleUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, employee_id, nama, jabatan FROM users
     WHERE id = $1 AND role = 'karyawan' AND is_active = TRUE`,
    [userId]
  );
  return rows[0] && isHmRole(rows[0].jabatan) ? rows[0] : null;
}

/** GET /api/admin/hm?tanggal_mulai=YYYY-MM-DD&tanggal_akhir=YYYY-MM-DD */
async function daftarHm(req, res, next) {
  try {
    await ensureHmDailySchema(pool);
    const tanggalMulai = req.query.tanggal_mulai || req.query.tanggal || isoToday();
    const tanggalAkhir = req.query.tanggal_akhir || req.query.tanggal || tanggalMulai;
    const tanggalList = buildDateRange(tanggalMulai, tanggalAkhir);

    const { rows } = await pool.query(
      `SELECT
         u.id AS user_id, u.employee_id, u.nama AS nama_karyawan, u.jabatan,
         h.id AS hm_id, h.tanggal::text AS tanggal, h.jam_operasi,
         COALESCE(h.keterangan, '') AS keterangan
       FROM users u
       LEFT JOIN database_hm_harian h
         ON h.user_id = u.id AND h.tanggal BETWEEN $1 AND $2
       WHERE u.role = 'karyawan'
         AND u.is_active = TRUE
         AND LOWER(TRIM(COALESCE(u.jabatan, ''))) <> 'driver sarana'
         AND (
           LOWER(COALESCE(u.jabatan, '')) LIKE '%operator%'
           OR LOWER(COALESCE(u.jabatan, '')) LIKE '%driver%'
         )
       ORDER BY u.nama ASC, h.tanggal ASC`,
      [tanggalMulai, tanggalAkhir]
    );

    const byUser = new Map();
    for (const row of rows) {
      if (!byUser.has(row.user_id)) {
        byUser.set(row.user_id, {
          user_id: row.user_id,
          employee_id: row.employee_id,
          nama_karyawan: row.nama_karyawan,
          jabatan: row.jabatan,
          harian: Object.fromEntries(
            tanggalList.map((tanggal) => [tanggal, { id: null, jam_operasi: 0, keterangan: '' }])
          ),
          total_hm: 0,
        });
      }
      if (row.tanggal) {
        byUser.get(row.user_id).harian[normalizeDate(row.tanggal)] = {
          id: row.hm_id,
          jam_operasi: Number(row.jam_operasi || 0),
          keterangan: row.keterangan || '',
        };
      }
    }

    const rekap = Array.from(byUser.values()).map((item) => ({
      ...item,
      total_hm: sumDailyHm(
        Object.fromEntries(
          Object.entries(item.harian).map(([tanggal, data]) => [tanggal, data.jam_operasi])
        )
      ),
    }));

    res.json({
      periode: 'range_harian',
      tanggal_mulai: tanggalMulai,
      tanggal_akhir: tanggalAkhir,
      tanggal: tanggalList,
      rekap,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/hm/bulk */
async function simpanHmBulk(req, res, next) {
  const client = await pool.connect();
  try {
    await ensureHmDailySchema(pool);
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!entries.length) {
      return res.status(400).json({ error: 'Tidak ada nilai HM harian untuk disimpan' });
    }
    if (entries.length > 5000) {
      return res.status(400).json({ error: 'Maksimal 5000 nilai HM dalam satu penyimpanan' });
    }

    const normalized = entries.map((entry) => {
      validateDateRange(entry.tanggal, entry.tanggal);
      return {
        user_id: entry.user_id,
        tanggal: entry.tanggal,
        jam_operasi: validateJamOperasi(entry.jam_operasi),
        keterangan: entry.keterangan ? String(entry.keterangan).trim() : null,
      };
    });

    const userIds = [...new Set(normalized.map((entry) => entry.user_id))];
    const { rows: userRows } = await client.query(
      `SELECT id, jabatan FROM users
       WHERE id = ANY($1::uuid[]) AND role = 'karyawan' AND is_active = TRUE`,
      [userIds]
    );
    const eligibleIds = new Set(userRows.filter((user) => isHmRole(user.jabatan)).map((user) => user.id));
    if (userIds.some((id) => !eligibleIds.has(id))) {
      return res.status(400).json({ error: 'Terdapat karyawan yang tidak menggunakan Database HM' });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO database_hm_harian (user_id, tanggal, jam_operasi, keterangan)
       SELECT data.user_id::uuid, data.tanggal::date, data.jam_operasi, data.keterangan
       FROM jsonb_to_recordset($1::jsonb)
         AS data(user_id text, tanggal text, jam_operasi numeric, keterangan text)
       ON CONFLICT (user_id, tanggal) DO UPDATE SET
         jam_operasi = EXCLUDED.jam_operasi,
         keterangan = COALESCE(EXCLUDED.keterangan, database_hm_harian.keterangan),
         updated_at = now()
       RETURNING id`,
      [JSON.stringify(normalized)]
    );
    await client.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah)
       VALUES ($1, NULL, $2, $3)`,
      [
        req.user.id,
        `${req.user.nama || 'Admin'} - Simpan HM harian (${rows.length} nilai)`,
        JSON.stringify({ jumlah_nilai: rows.length }),
      ]
    );
    await client.query('COMMIT');
    res.json({ message: `${rows.length} nilai HM harian berhasil disimpan`, jumlah: rows.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

async function buatHm(req, res, next) {
  try {
    await ensureHmDailySchema(pool);
    const { user_id, tanggal = isoToday(), jam_operasi, keterangan } = req.body;
    validateDateRange(tanggal, tanggal);
    const jam = validateJamOperasi(jam_operasi);
    const user = await getEligibleUser(user_id);
    if (!user) return res.status(400).json({ error: 'Karyawan tidak menggunakan Database HM' });
    const { rows } = await pool.query(
      `INSERT INTO database_hm_harian (user_id, tanggal, jam_operasi, keterangan)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, tanggal) DO UPDATE SET
         jam_operasi = EXCLUDED.jam_operasi,
         keterangan = EXCLUDED.keterangan,
         updated_at = now()
       RETURNING *`,
      [user_id, tanggal, jam, keterangan ? String(keterangan).trim() : null]
    );
    res.status(201).json({ message: 'HM harian berhasil disimpan', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateHm(req, res, next) {
  try {
    await ensureHmDailySchema(pool);
    const jam = validateJamOperasi(req.body.jam_operasi);
    const { rows } = await pool.query(
      `UPDATE database_hm_harian SET jam_operasi = $1,
       keterangan = COALESCE($2, keterangan), updated_at = now()
       WHERE id = $3 RETURNING *`,
      [jam, req.body.keterangan !== undefined ? req.body.keterangan : null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Data HM tidak ditemukan' });
    res.json({ message: 'HM harian berhasil diperbarui', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function hapusHm(req, res, next) {
  try {
    await ensureHmDailySchema(pool);
    const { rows } = await pool.query(
      'DELETE FROM database_hm_harian WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Data HM tidak ditemukan' });
    res.json({ message: 'Data HM harian berhasil dihapus' });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/hm/export — template Excel mengikuti range yang sedang tampil. */
async function exportHmExcel(req, res, next) {
  try {
    await ensureHmDailySchema(pool);
    const tanggalMulai = req.query.tanggal_mulai || isoToday();
    const tanggalAkhir = req.query.tanggal_akhir || tanggalMulai;
    const dates = buildDateRange(tanggalMulai, tanggalAkhir);

    const { rows } = await pool.query(
      `SELECT
         u.id AS user_id, u.employee_id, u.nama AS nama_karyawan, u.jabatan,
         h.tanggal::text AS tanggal, h.jam_operasi
       FROM users u
       LEFT JOIN database_hm_harian h
         ON h.user_id = u.id AND h.tanggal BETWEEN $1 AND $2
       WHERE u.role = 'karyawan'
         AND u.is_active = TRUE
         AND LOWER(TRIM(COALESCE(u.jabatan, ''))) <> 'driver sarana'
         AND (
           LOWER(COALESCE(u.jabatan, '')) LIKE '%operator%'
           OR LOWER(COALESCE(u.jabatan, '')) LIKE '%driver%'
         )
       ORDER BY u.nama ASC, h.tanggal ASC`,
      [tanggalMulai, tanggalAkhir]
    );

    const employees = new Map();
    for (const row of rows) {
      if (!employees.has(row.user_id)) {
        employees.set(row.user_id, {
          employee_id: row.employee_id || '',
          nama_karyawan: row.nama_karyawan,
          jabatan: row.jabatan || '',
          daily: Object.fromEntries(dates.map((date) => [date, 0])),
        });
      }
      if (row.tanggal) {
        employees.get(row.user_id).daily[normalizeDate(row.tanggal)] = Number(row.jam_operasi || 0);
      }
    }

    const header = ['No', 'Employee ID', 'Nama Karyawan', 'Jabatan', 'Total HM', ...dates];
    const data = [header];
    Array.from(employees.values()).forEach((employee, index) => {
      const dailyValues = dates.map((date) => employee.daily[date] || 0);
      data.push([
        index + 1,
        employee.employee_id,
        employee.nama_karyawan,
        employee.jabatan,
        sumDailyHm(Object.fromEntries(dates.map((date, dateIndex) => [date, dailyValues[dateIndex]]))),
        ...dailyValues,
      ]);
    });

    const worksheet = xlsx.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 6 }, { wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 14 },
      ...dates.map(() => ({ wch: 13 })),
    ];
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Database HM');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const filename = `database_hm_${tanggalMulai}_${tanggalAkhir}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/hm/import — import template hasil Export Excel. */
async function importHmExcel(req, res, next) {
  let client;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Berkas Excel (.xlsx / .xls) wajib diunggah' });
    }
    await ensureHmDailySchema(pool);

    let workbook;
    try {
      workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    } catch (_) {
      return res.status(400).json({ error: 'Berkas Excel rusak atau tidak dapat dibaca' });
    }
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!worksheet) {
      return res.status(400).json({ error: 'Berkas Excel tidak memiliki lembar data' });
    }
    const matrix = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });

    const { rows: employees } = await pool.query(
      `SELECT id, employee_id, nama, jabatan FROM users
       WHERE role = 'karyawan' AND is_active = TRUE
         AND LOWER(TRIM(COALESCE(jabatan, ''))) <> 'driver sarana'
         AND (
           LOWER(COALESCE(jabatan, '')) LIKE '%operator%'
           OR LOWER(COALESCE(jabatan, '')) LIKE '%driver%'
         )`
    );
    let parsed;
    try {
      parsed = parseHmImportMatrix(matrix, employees);
    } catch (parseError) {
      parseError.statusCode = 400;
      throw parseError;
    }
    if (parsed.entries.length > 5000) {
      return res.status(400).json({ error: 'Maksimal 5000 nilai HM dalam satu import' });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: imported } = await client.query(
      `INSERT INTO database_hm_harian (user_id, tanggal, jam_operasi)
       SELECT data.user_id::uuid, data.tanggal::date, data.jam_operasi
       FROM jsonb_to_recordset($1::jsonb)
         AS data(user_id text, tanggal text, jam_operasi numeric)
       ON CONFLICT (user_id, tanggal) DO UPDATE SET
         jam_operasi = EXCLUDED.jam_operasi,
         updated_at = now()
       RETURNING id`,
      [JSON.stringify(parsed.entries)]
    );
    await client.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah)
       VALUES ($1, NULL, $2, $3)`,
      [
        req.user.id,
        `${req.user.nama || 'Admin'} - Import Excel HM (${imported.length} nilai)`,
        JSON.stringify({
          jumlah_karyawan: parsed.importedRows,
          jumlah_nilai: imported.length,
          tanggal: parsed.dates,
          nama_file: req.file.originalname,
        }),
      ]
    );
    await client.query('COMMIT');

    res.json({
      message: `Import Excel HM berhasil: ${parsed.importedRows} karyawan, ${imported.length} nilai harian diproses.`,
      total_karyawan: parsed.importedRows,
      total_nilai: imported.length,
      tanggal: parsed.dates,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client?.release();
  }
}

module.exports = {
  daftarHm,
  simpanHmBulk,
  buatHm,
  updateHm,
  hapusHm,
  exportHmExcel,
  importHmExcel,
};
