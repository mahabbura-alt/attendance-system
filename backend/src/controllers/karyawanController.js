const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { uploadFoto, getUrlFoto } = require('../services/storage');
const { daftarkanWajahReferensi, cariWajahSerupa } = require('../services/compreface');
const People = require('../services/peopleEmployees');
const { kirimEmailUndangan } = require('../services/email');
const {
  ensureEmployeeIdAvailable,
  isEmployeeIdUniqueViolation,
} = require('../services/employeeIdentity');
const Workforce = require('../services/workforce');
const { generateTemporaryPassword, ensurePasswordResetSchema } = require('../services/passwordReset');

/** GET /api/admin/karyawan — daftar semua karyawan (tanpa password) */
async function daftarKaryawan(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.employee_id, u.nama, u.email, u.role, u.is_active, u.compreface_subject,
              u.jabatan, u.departemen,
              u.foto_referensi_url, s.nama_shift, l.nama_lokasi
       FROM users u
       LEFT JOIN shifts s ON s.id = u.shift_id
       LEFT JOIN lokasi_kantor l ON l.id = u.lokasi_kantor_id
       WHERE u.role = 'karyawan'
       ORDER BY u.nama`
    );

    const rowsDenganUrlFoto = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        wajah_terdaftar: Boolean(row.compreface_subject),
        foto_referensi_url: await getUrlFoto(row.foto_referensi_url),
      }))
    );

    res.json(rowsDenganUrlFoto);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/karyawan — kompatibilitas: diteruskan ke People v2
 * (satu-satunya pintu tambah karyawan; jabatan harus dari master, NRP otomatis).
 * Bentuk lama { employee_id, jabatan, departemen, lokasi_kantor_id } diterjemahkan.
 */
async function buatKaryawan(req, res, next) {
  try {
    const body = req.body || {};
    const input = {
      ...body,
      nrp: body.nrp || body.employee_id || null,
      department: body.department || body.departemen,
      position: body.position || body.jabatan,
      lokasi_ids: body.lokasi_ids || (body.lokasi_kantor_id ? [body.lokasi_kantor_id] : []),
    };
    const result = await People.createEmployee(pool, Workforce.scopeFromUser(req.user), req.user, input, { source: 'UI' });
    if (result.invite) {
      await kirimEmailUndangan(result.invite.email, result.invite.nama, result.invite.token, { nrp: result.nrp })
        .catch(e => console.warn('[People] Gagal kirim undangan:', e.message));
    }
    res.status(201).json({
      message: 'Karyawan berhasil dibuat. Selanjutnya upload foto referensi wajahnya.',
      karyawan: { id: result.user_id, employee_id: result.nrp, email: result.email },
    });
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    if (err.code === '23505') return res.status(409).json({ error: 'Email atau NRP sudah terdaftar' });
    next(err);
  }
}

/**
 * POST /api/admin/karyawan/:id/foto-referensi
 * multipart file field: 'foto'
 *
 * Mendaftarkan foto wajah karyawan sebagai subject baru di CompreFace,
 * sekaligus menyimpan foto ke Supabase Storage untuk arsip/audit.
 *
 * Boleh dipanggil berkali-kali untuk menambah sampel wajah yang sama
 * (CompreFace mendukung beberapa foto per subject untuk akurasi lebih baik) —
 * subject id (berupa user.id) tetap sama setiap kali.
 */
async function uploadFotoReferensi(req, res, next) {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'File foto wajib dikirim (field "foto")' });
    }

    const { rows } = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'karyawan'`,
      [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
    }

    const subject = id; // pakai user.id sebagai subject id CompreFace, konsisten & unik

    // 0. Cegah satu orang punya dua akun: cari wajah serupa milik karyawan aktif lain.
    const allowDuplicate = String(req.body?.allow_duplicate || req.query?.allow_duplicate || '') === 'true';
    const mirip = await cariWajahSerupa(req.file.buffer);
    const lain = (mirip || []).filter(m => m.subject && m.subject !== subject);
    if (lain.length) {
      const { rows: pemilik } = await pool.query(
        `SELECT id, nama, employee_id FROM users WHERE id::text = ANY($1) AND is_active = TRUE`,
        [lain.map(m => m.subject)]
      );
      if (pemilik.length && !allowDuplicate) {
        return res.status(409).json({
          code: 'FACE_DUPLICATE',
          error: `Wajah ini mirip dengan karyawan aktif: ${pemilik.map(p => `${p.nama}${p.employee_id ? ` (${p.employee_id})` : ''}`).join(', ')}. Pastikan bukan akun ganda.`,
          matches: pemilik.map(p => ({ id: p.id, nama: p.nama, nrp: p.employee_id })),
        });
      }
    }

    // 1. Daftarkan wajah ke CompreFace
    await daftarkanWajahReferensi(req.file.buffer, subject);

    // 2. Simpan juga foto ke Supabase Storage untuk arsip (bukan sumber verifikasi, hanya dokumentasi)
    const fotoKey = await uploadFoto(req.file.buffer, { userId: id, jenis: 'referensi' });

    // 3. Update data karyawan
    await pool.query(
      `UPDATE users SET compreface_subject = $1, foto_referensi_url = $2 WHERE id = $3`,
      [subject, fotoKey, id]
    );

    res.json({ message: 'Foto referensi berhasil didaftarkan ke CompreFace', subject });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/karyawan/:id — ubah data atau nonaktifkan akun karyawan. */
async function updateKaryawan(req, res, next) {
  try {
    const { id } = req.params;
    const { employee_id, nama, email, password, jabatan, departemen, shift_id, lokasi_kantor_id, is_active } = req.body;
    if (jabatan !== undefined || departemen !== undefined || is_active !== undefined) {
      return res.status(409).json({
        code: 'WORKFORCE_MOVEMENT_REQUIRED',
        error: 'Jabatan, departemen, dan status aktif hanya dapat diubah melalui Pergerakan Karyawan.',
      });
    }
    const updates = [];
    const values = [];
    const add = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (employee_id !== undefined) {
      add('employee_id', await ensureEmployeeIdAvailable(pool, employee_id, id));
    }
    if (nama !== undefined) {
      if (typeof nama !== 'string' || !nama.trim()) return res.status(400).json({ error: 'Nama tidak valid' });
      add('nama', nama.trim());
    }
    if (email !== undefined) {
      if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email tidak valid' });
      add('email', email.trim().toLowerCase());
    }
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' });
      add('password_hash', await bcrypt.hash(password, 12));
    }
    if (shift_id !== undefined) add('shift_id', shift_id);
    if (lokasi_kantor_id !== undefined) add('lokasi_kantor_id', lokasi_kantor_id);
    if (!updates.length) return res.status(400).json({ error: 'Tidak ada perubahan yang dikirim' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(', ')}
       WHERE id = $${values.length} AND role = 'karyawan'
       RETURNING id, employee_id, nama, email, jabatan, departemen, shift_id, lokasi_kantor_id, is_active`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

    // Audit Log
    const logText = `${req.user?.nama || 'Admin Utama'} - [DB KARYAWAN] Memperbarui data karyawan "${rows[0].nama}" (${rows[0].email}), NRP: ${rows[0].employee_id || '-'}`;
    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, $3)`,
      [req.user?.id || null, logText, JSON.stringify(rows[0])]
    ).catch(e => console.warn('Gagal simpan audit log update karyawan:', e.message));

    res.json({ message: rows[0].is_active ? 'Data karyawan diperbarui' : 'Karyawan dinonaktifkan', karyawan: rows[0] });
  } catch (err) {
    if (isEmployeeIdUniqueViolation(err)) {
      return res.status(409).json({ error: 'Employee ID sudah digunakan oleh karyawan lain' });
    }
    if (err.code === '23505') return res.status(409).json({ error: 'Email sudah terdaftar' });
    if (err.code === '23503') return res.status(400).json({ error: 'Shift atau lokasi kantor tidak ditemukan' });
    next(err);
  }
}

/**
 * DELETE /api/admin/karyawan/:id — hapus permanen DIHENTIKAN (People v2).
 * Salah input sebelum ada transaksi → Void; karyawan keluar → Pergerakan Keluar.
 */
async function hapusKaryawan(req, res) {
  return res.status(410).json({
    code: 'EMPLOYEE_DELETE_REMOVED',
    error: 'Hapus permanen tidak tersedia lagi. Gunakan Void (salah input, belum ada transaksi) atau Pergerakan Keluar.',
  });
}

/** GET /api/admin/karyawan/audit-log — Audit log perubahan database karyawan */
async function daftarAuditLogKaryawan(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.alasan, a.waktu_perubahan, a.data_sebelum, a.data_sesudah, u.nama AS admin_nama
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.admin_id
       WHERE a.alasan LIKE '%KARYAWAN%' OR a.alasan LIKE '%karyawan%'
       ORDER BY a.waktu_perubahan DESC
       LIMIT 150`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/karyawan/reset-requests — permintaan reset sandi yang menunggu admin */
async function daftarPermintaanReset(req, res, next) {
  try {
    await ensurePasswordResetSchema(pool);
    const { rows } = await pool.query(
      `SELECT r.id, r.user_id, r.source, r.requested_at,
              u.employee_id, u.nama, u.jabatan, u.departemen
       FROM password_reset_requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'pending' AND u.is_active = TRUE
       ORDER BY r.requested_at ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/karyawan/:id/reset-password — admin membuat sandi sementara.
 * Sandi sementara hanya dikembalikan sekali di respons ini (tidak disimpan/di-log)
 * dan karyawan wajib menggantinya setelah login.
 */
async function resetPasswordKaryawan(req, res, next) {
  const client = await pool.connect();
  try {
    await ensurePasswordResetSchema(pool);
    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE
       WHERE id = $2 AND role = 'karyawan' AND is_active = TRUE
       RETURNING id, employee_id, nama`,
      [passwordHash, req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Karyawan aktif tidak ditemukan' });
    }
    await client.query(
      `UPDATE password_reset_requests
       SET status = 'done', handled_by = $2, handled_at = now()
       WHERE user_id = $1 AND status = 'pending'`,
      [rows[0].id, req.user?.id || null]
    );
    await client.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, $3)`,
      [
        req.user?.id || null,
        `${req.user?.nama || 'Admin'} - [DB KARYAWAN] Reset sandi karyawan "${rows[0].nama}", NRP: ${rows[0].employee_id || '-'}`,
        JSON.stringify({ id: rows[0].id, employee_id: rows[0].employee_id, must_change_password: true }),
      ]
    );
    await client.query('COMMIT');

    res.json({
      message: 'Sandi sementara dibuat. Sampaikan langsung ke karyawan; karyawan wajib menggantinya setelah login.',
      karyawan: rows[0],
      temp_password: tempPassword,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

module.exports = {
  daftarKaryawan,
  buatKaryawan,
  uploadFotoReferensi,
  updateKaryawan,
  hapusKaryawan,
  daftarAuditLogKaryawan,
  daftarPermintaanReset,
  resetPasswordKaryawan,
};
