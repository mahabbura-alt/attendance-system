const xlsx = require('xlsx');
const { pool } = require('../config/db');

/** GET /api/admin/payroll — Daftar seluruh database payroll karyawan */
async function daftarPayroll(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              u.id AS user_id,
              u.nama AS nama_user_linked,
              u.is_active AS is_user_active
       FROM payroll p
       LEFT JOIN users u ON u.employee_id = p.employee_id
       ORDER BY p.nama_karyawan ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/**
 * Helper untuk memvalidasi employee_id dengan Master Karyawan
 */
async function validasiEmployeeId(client, employee_id, nama_karyawan) {
  if (!employee_id) return;
  const { rows } = await client.query("SELECT nama FROM users WHERE employee_id = $1 AND role = 'karyawan'", [employee_id]);
  if (rows.length > 0 && rows[0].nama.toLowerCase() !== nama_karyawan.trim().toLowerCase()) {
    const err = new Error(`ID ${employee_id} sudah dimiliki oleh Karyawan bernama "${rows[0].nama}" di Master Data. Tidak bisa digunakan untuk "${nama_karyawan}".`);
    err.statusCode = 400;
    throw err;
  }
}

/** POST /api/admin/payroll — Tambah data payroll manual oleh Admin */
async function buatPayroll(req, res, next) {
  try {
    const {
      employee_id,
      nama_karyawan,
      date_in,
      site,
      kota,
      jabatan,
      gaji_pokok,
      tunjangan_kehadiran_per_hari,
      tunjangan_jabatan,
      insentif_hm_per_jam,
    } = req.body;

    if (!nama_karyawan || !nama_karyawan.trim()) {
      return res.status(400).json({ error: 'Nama karyawan wajib diisi' });
    }

    if (employee_id) {
      try {
        await validasiEmployeeId(pool, employee_id, nama_karyawan);
      } catch (e) {
        return res.status(e.statusCode || 400).json({ error: e.message });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO payroll (
         employee_id, nama_karyawan, date_in, site, kota, jabatan,
         gaji_pokok, tunjangan_kehadiran_per_hari, tunjangan_jabatan, insentif_hm_per_jam
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (employee_id)
       DO UPDATE SET
         nama_karyawan = EXCLUDED.nama_karyawan,
         date_in = EXCLUDED.date_in,
         site = EXCLUDED.site,
         kota = EXCLUDED.kota,
         jabatan = EXCLUDED.jabatan,
         gaji_pokok = EXCLUDED.gaji_pokok,
         tunjangan_kehadiran_per_hari = EXCLUDED.tunjangan_kehadiran_per_hari,
         tunjangan_jabatan = EXCLUDED.tunjangan_jabatan,
         insentif_hm_per_jam = EXCLUDED.insentif_hm_per_jam,
         updated_at = NOW()
       RETURNING *`,
      [
        employee_id ? employee_id.trim() : null,
        nama_karyawan.trim(),
        date_in || null,
        site || null,
        kota || null,
        jabatan || null,
        Number(gaji_pokok || 0),
        Number(tunjangan_kehadiran_per_hari || 0),
        Number(tunjangan_jabatan || 0),
        Number(insentif_hm_per_jam || 0),
      ]
    );

    // Audit Log
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const jamTglStr = `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const adminNama = req.user?.nama || 'Admin Utama';
    const logText = `${adminNama} - ${jamTglStr} - Manual Edit Payroll - ${nama_karyawan.trim()} (${employee_id || 'Tanpa ID'})`.trim();

    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah)
       VALUES ($1, NULL, $2, $3)`,
      [req.user.id, logText, JSON.stringify(rows[0])]
    );

    res.status(201).json({ message: 'Data payroll berhasil disimpan', data: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Employee ID sudah terdaftar di database payroll' });
    }
    next(err);
  }
}

/** PATCH /api/admin/payroll/:id — Update data payroll manual oleh Admin */
async function updatePayroll(req, res, next) {
  try {
    const { id } = req.params;
    const {
      employee_id,
      nama_karyawan,
      date_in,
      site,
      kota,
      jabatan,
      gaji_pokok,
      tunjangan_kehadiran_per_hari,
      tunjangan_jabatan,
      insentif_hm_per_jam,
    } = req.body;

    const { rows: prevRows } = await pool.query('SELECT * FROM payroll WHERE id = $1', [id]);
    if (!prevRows[0]) {
      return res.status(404).json({ error: 'Data payroll tidak ditemukan' });
    }
    const prevData = prevRows[0];
    
    const finalEmpId = employee_id !== undefined ? (employee_id ? employee_id.trim() : null) : prevData.employee_id;
    const finalNama = nama_karyawan !== undefined ? nama_karyawan.trim() : prevData.nama_karyawan;

    if (finalEmpId) {
      try {
        await validasiEmployeeId(pool, finalEmpId, finalNama);
      } catch (e) {
        return res.status(e.statusCode || 400).json({ error: e.message });
      }
    }

    const { rows } = await pool.query(
      `UPDATE payroll SET
         employee_id = COALESCE($1, employee_id),
         nama_karyawan = COALESCE($2, nama_karyawan),
         date_in = COALESCE($3, date_in),
         site = COALESCE($4, site),
         kota = COALESCE($5, kota),
         jabatan = COALESCE($6, jabatan),
         gaji_pokok = COALESCE($7, gaji_pokok),
         tunjangan_kehadiran_per_hari = COALESCE($8, tunjangan_kehadiran_per_hari),
         tunjangan_jabatan = COALESCE($9, tunjangan_jabatan),
         insentif_hm_per_jam = COALESCE($10, insentif_hm_per_jam),
         updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        employee_id !== undefined ? (employee_id ? employee_id.trim() : null) : prevData.employee_id,
        nama_karyawan !== undefined ? nama_karyawan.trim() : prevData.nama_karyawan,
        date_in !== undefined ? date_in : prevData.date_in,
        site !== undefined ? site : prevData.site,
        kota !== undefined ? kota : prevData.kota,
        jabatan !== undefined ? jabatan : prevData.jabatan,
        gaji_pokok !== undefined ? Number(gaji_pokok) : prevData.gaji_pokok,
        tunjangan_kehadiran_per_hari !== undefined ? Number(tunjangan_kehadiran_per_hari) : prevData.tunjangan_kehadiran_per_hari,
        tunjangan_jabatan !== undefined ? Number(tunjangan_jabatan) : prevData.tunjangan_jabatan,
        insentif_hm_per_jam !== undefined ? Number(insentif_hm_per_jam) : prevData.insentif_hm_per_jam,
        id,
      ]
    );

    // Audit Log
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const jamTglStr = `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const adminNama = req.user?.nama || 'Admin Utama';
    const logText = `${adminNama} - ${jamTglStr} - Update Payroll - ${rows[0].nama_karyawan} (${rows[0].employee_id || 'Tanpa ID'})`.trim();

    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sebelum, data_sesudah)
       VALUES ($1, NULL, $2, $3, $4)`,
      [req.user.id, logText, JSON.stringify(prevData), JSON.stringify(rows[0])]
    );

    res.json({ message: 'Data payroll berhasil diperbarui', data: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Employee ID sudah terdaftar pada karyawan lain' });
    }
    next(err);
  }
}

/** DELETE /api/admin/payroll/:id — Hapus data payroll */
async function hapusPayroll(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('DELETE FROM payroll WHERE id = $1 RETURNING *', [id]);
    if (!rows[0]) {
      return res.status(404).json({ error: 'Data payroll tidak ditemukan' });
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const jamTglStr = `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const adminNama = req.user?.nama || 'Admin Utama';
    const logText = `${adminNama} - ${jamTglStr} - Hapus Payroll - ${rows[0].nama_karyawan} (${rows[0].employee_id || 'Tanpa ID'})`.trim();

    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sebelum)
       VALUES ($1, NULL, $2, $3)`,
      [req.user.id, logText, JSON.stringify(rows[0])]
    );

    res.json({ message: `Data payroll ${rows[0].nama_karyawan} berhasil dihapus` });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/payroll/import — Import Excel DATABASE PAYROLL.xlsx */
async function importPayrollExcel(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Berkas Excel (.xlsx / .xls) wajib diunggah' });
    }

    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.includes('Data Base') ? 'Data Base' : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws);

    if (!rows.length) {
      return res.status(400).json({ error: 'Berkas Excel kosong atau format tidak sesuai' });
    }

    let countProcessed = 0;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const row of rows) {
        // Ambil nama karyawan
        const nama = row['Nama Karyawan'] || row['NAMA KARYAWAN'] || row['Nama'] || row['nama'];
        if (!nama || typeof nama !== 'string' || !nama.trim()) continue;

        const empIdRaw = row['EMPLOYEE ID'] || row['Employee ID'] || row['employee_id'];
        const empId = empIdRaw ? String(empIdRaw).trim() : null;

        const dateIn = row['Date in'] || row['DATE IN'] || row['date_in'] || null;
        const site = row['Site'] || row['SITE'] || row['site'] || null;
        const kota = row['Kota'] || row['KOTA'] || row['kota'] || null;
        const jabatan = row['JABATAN'] || row['Jabatan'] || row['jabatan'] || null;

        const gajiPokok = Number(row['GAJI POKOK'] || row['Gaji Pokok'] || 0);
        const tunjKehadiran = Number(row['Tunjangan Kehadiran/Hari '] || row['Tunjangan Kehadiran/Hari'] || row['Tunjangan Kehadiran'] || 0);
        const tunjJabatan = Number(row['Tunjangan Jabatan'] || 0);
        const insentifHm = Number(row['Insentif HM / JAM'] || row['Insentif HM/JAM'] || row['Insentif HM'] || 0);

        if (empId) {
          try {
            await validasiEmployeeId(client, empId, nama);
          } catch (e) {
            throw new Error(`Baris Excel dengan Nama "${nama}": ${e.message}`);
          }
          // Upsert berdasarkan employee_id
          await client.query(
            `INSERT INTO payroll (
               employee_id, nama_karyawan, date_in, site, kota, jabatan,
               gaji_pokok, tunjangan_kehadiran_per_hari, tunjangan_jabatan, insentif_hm_per_jam
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (employee_id)
             DO UPDATE SET
               nama_karyawan = EXCLUDED.nama_karyawan,
               date_in = COALESCE(EXCLUDED.date_in, payroll.date_in),
               site = COALESCE(EXCLUDED.site, payroll.site),
               kota = COALESCE(EXCLUDED.kota, payroll.kota),
               jabatan = COALESCE(EXCLUDED.jabatan, payroll.jabatan),
               gaji_pokok = EXCLUDED.gaji_pokok,
               tunjangan_kehadiran_per_hari = EXCLUDED.tunjangan_kehadiran_per_hari,
               tunjangan_jabatan = EXCLUDED.tunjangan_jabatan,
               insentif_hm_per_jam = EXCLUDED.insentif_hm_per_jam,
               updated_at = NOW()`,
            [empId, nama.trim(), dateIn ? String(dateIn) : null, site ? String(site) : null, kota ? String(kota) : null, jabatan ? String(jabatan) : null, gajiPokok, tunjKehadiran, tunjJabatan, insentifHm]
          );
        } else {
          // Insert jika tanpa employee_id
          await client.query(
            `INSERT INTO payroll (
               nama_karyawan, date_in, site, kota, jabatan,
               gaji_pokok, tunjangan_kehadiran_per_hari, tunjangan_jabatan, insentif_hm_per_jam
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [nama.trim(), dateIn ? String(dateIn) : null, site ? String(site) : null, kota ? String(kota) : null, jabatan ? String(jabatan) : null, gajiPokok, tunjKehadiran, tunjJabatan, insentifHm]
          );
        }

        countProcessed++;
      }

      // Audit Log
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const jamTglStr = `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
      const adminNama = req.user?.nama || 'Admin Utama';
      const logText = `${adminNama} - ${jamTglStr} - Import Excel Payroll - ${countProcessed} Data Berhasil Diproses`.trim();

      await client.query(
        `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah)
         VALUES ($1, NULL, $2, $3)`,
        [req.user.id, logText, JSON.stringify({ total_imported: countProcessed })]
      );

      await client.query('COMMIT');
      client.release();

      res.json({
        message: `Import Excel Payroll Berhasil! ${countProcessed} data karyawan diproses.`,
        total_imported: countProcessed,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/payroll/audit-log — Audit Log khusus modul Payroll */
async function daftarAuditLogPayroll(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.alasan, a.waktu_perubahan, a.data_sebelum, a.data_sesudah, u.nama AS admin_nama
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.admin_id
       WHERE a.alasan LIKE '%Payroll%'
       ORDER BY a.waktu_perubahan DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/payroll/sinkron — Sinkronisasi Data Master Karyawan ke Database Payroll */
async function sinkronKaryawanPayroll(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: karyawans } = await client.query(
      `SELECT id, employee_id, nama, jabatan FROM users WHERE role = 'karyawan' AND is_active = TRUE`
    );

    let insertedCount = 0;
    let updatedCount = 0;

    for (const k of karyawans) {
      let matchQuery = `SELECT id FROM payroll WHERE LOWER(nama_karyawan) = LOWER($1)`;
      let matchParams = [k.nama];
      if (k.employee_id) {
        matchQuery = `SELECT id FROM payroll WHERE employee_id = $1 OR LOWER(nama_karyawan) = LOWER($2)`;
        matchParams = [k.employee_id, k.nama];
      }

      const { rows: match } = await client.query(matchQuery, matchParams);

      if (match.length > 0) {
        // Karyawan sudah ada di payroll -> Update nama dan jabatan, TANPA menyentuh gaji/tunjangan
        await client.query(
          `UPDATE payroll
           SET employee_id = COALESCE($1, employee_id),
               nama_karyawan = $2,
               jabatan = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [k.employee_id || null, k.nama, k.jabatan || null, match[0].id]
        );
        updatedCount++;
      } else {
        // Karyawan belum ada di payroll -> Insert default 0
        await client.query(
          `INSERT INTO payroll (employee_id, nama_karyawan, jabatan, gaji_pokok, tunjangan_kehadiran_per_hari, tunjangan_jabatan, insentif_hm_per_jam)
           VALUES ($1, $2, $3, 0, 0, 0, 0)`,
          [k.employee_id || null, k.nama, k.jabatan || null]
        );
        insertedCount++;
      }
    }

    const adminNama = req.user?.nama || 'Admin Utama';
    const logText = `${adminNama} - Sinkronisasi Master Karyawan ke Payroll (${insertedCount} ditambah, ${updatedCount} diupdate)`;
    await client.query(`INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, '{}')`, [req.user.id, logText]);

    await client.query('COMMIT');
    res.json({
      message: 'Sinkronisasi berhasil!',
      inserted: insertedCount,
      updated: updatedCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

module.exports = {
  daftarPayroll,
  buatPayroll,
  updatePayroll,
  hapusPayroll,
  importPayrollExcel,
  daftarAuditLogPayroll,
  sinkronKaryawanPayroll,
};
