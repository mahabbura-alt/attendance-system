const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { uploadFoto, getUrlFoto, hapusFoto } = require('../services/storage');
const { daftarkanWajahReferensi, hapusSubjectWajah } = require('../services/compreface');

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
 * POST /api/admin/karyawan
 * body: { employee_id, nama, email, password, shift_id, lokasi_kantor_id }
 * Membuat akun karyawan baru oleh Admin.
 */
async function buatKaryawan(req, res, next) {
  try {
    const { employee_id, nama, email, password, jabatan, departemen, shift_id, lokasi_kantor_id } = req.body;

    if (!nama || !email || !password || !lokasi_kantor_id) {
      return res.status(400).json({
        error: 'nama, email, password, dan lokasi_kantor_id wajib diisi',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      `INSERT INTO users (employee_id, nama, email, password_hash, role, jabatan, departemen, shift_id, lokasi_kantor_id)
       VALUES ($1, $2, $3, $4, 'karyawan', $5, $6, $7, $8)
       RETURNING id, employee_id, nama, email, role, jabatan, departemen, shift_id, lokasi_kantor_id, created_at`,
      [employee_id || null, nama, email, passwordHash, jabatan || null, departemen || null, shift_id || null, lokasi_kantor_id]
    );

    // Audit Log
    const logText = `${req.user?.nama || 'Admin Utama'} - [DB KARYAWAN] Menambah karyawan baru "${nama}" (${email}), NRP: ${employee_id || '-'}, Jabatan: ${jabatan || '-'}`;
    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah) VALUES ($1, NULL, $2, $3)`,
      [req.user?.id || null, logText, JSON.stringify({ employee_id, nama, email, jabatan, departemen })]
    ).catch(e => console.warn('Gagal simpan audit log karyawan:', e.message));

    res.status(201).json({
      message: 'Karyawan berhasil dibuat. Selanjutnya upload foto referensi wajahnya.',
      karyawan: rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email sudah terdaftar' });
    }
    next(err);
  }
}

/**
 * POST /api/admin/karyawan/:id/foto-referensi
 * multipart file field: 'foto'
 *
 * Mendaftarkan foto wajah karyawan sebagai subject baru di CompreFace,
 * sekaligus menyimpan foto ke MinIO untuk arsip/audit.
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

    // 1. Daftarkan wajah ke CompreFace
    await daftarkanWajahReferensi(req.file.buffer, subject);

    // 2. Simpan juga foto ke MinIO untuk arsip (bukan sumber verifikasi, hanya dokumentasi)
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
    const updates = [];
    const values = [];
    const add = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (employee_id !== undefined) add('employee_id', employee_id ? employee_id.trim() : null);
    if (nama !== undefined) {
      if (typeof nama !== 'string' || !nama.trim()) return res.status(400).json({ error: 'Nama tidak valid' });
      add('nama', nama.trim());
    }
    if (email !== undefined) {
      if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email tidak valid' });
      add('email', email.trim().toLowerCase());
    }
    if (jabatan !== undefined) add('jabatan', jabatan ? jabatan.trim() : null);
    if (departemen !== undefined) add('departemen', departemen ? departemen.trim() : null);
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' });
      add('password_hash', await bcrypt.hash(password, 12));
    }
    if (shift_id !== undefined) add('shift_id', shift_id);
    if (lokasi_kantor_id !== undefined) add('lokasi_kantor_id', lokasi_kantor_id);
    if (is_active !== undefined) {
      if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active harus bernilai true atau false' });
      add('is_active', is_active);
    }
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
    if (err.code === '23505') return res.status(409).json({ error: 'Email sudah terdaftar' });
    if (err.code === '23503') return res.status(400).json({ error: 'Shift atau lokasi kantor tidak ditemukan' });
    next(err);
  }
}

/** DELETE /api/admin/karyawan/:id — Menghapus data karyawan secara permanen & bersih beserta seluruh data turunannya. */
async function hapusKaryawan(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    // 1. Cari data karyawan
    const { rows } = await client.query(
      `SELECT id, employee_id, nama, email, compreface_subject, foto_referensi_url FROM users WHERE id = $1 AND role = 'karyawan'`,
      [id]
    );

    const user = rows[0];
    if (!user) {
      client.release();
      return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
    }

    // 2. Hapus subject dari CompreFace (jika terdaftar)
    if (user.compreface_subject) {
      await hapusSubjectWajah(user.compreface_subject).catch(e => console.warn('[CompreFace Delete Warning]:', e.message));
    }

    // 3. Cari & hapus file foto dari MinIO Storage (foto_referensi, foto absensi, foto registrasi_pending)
    const photosToDelete = [];
    if (user.foto_referensi_url) {
      photosToDelete.push(user.foto_referensi_url);
    }

    // Cari foto absensi karyawan ini
    const { rows: absensiPhotos } = await client.query(
      `SELECT foto_datang_url, foto_pulang_url FROM absensi WHERE user_id = $1`,
      [id]
    );
    absensiPhotos.forEach((a) => {
      if (a.foto_datang_url) photosToDelete.push(a.foto_datang_url);
      if (a.foto_pulang_url) photosToDelete.push(a.foto_pulang_url);
    });

    // Cari foto registrasi_pending dengan email sama
    const { rows: regPhotos } = await client.query(
      `SELECT foto_referensi_1_url, foto_referensi_2_url, foto_referensi_3_url FROM registrasi_pending WHERE email = $1`,
      [user.email]
    );
    regPhotos.forEach((r) => {
      if (r.foto_referensi_1_url) photosToDelete.push(r.foto_referensi_1_url);
      if (r.foto_referensi_2_url) photosToDelete.push(r.foto_referensi_2_url);
      if (r.foto_referensi_3_url) photosToDelete.push(r.foto_referensi_3_url);
    });

    // Hapus file foto dari storage MinIO
    for (const photoKey of photosToDelete) {
      try {
        await hapusFoto(photoKey);
      } catch (e) {
        console.warn(`[Delete Storage Fallback] Gagal hapus foto ${photoKey}:`, e.message);
      }
    }

    // 4. Hapus data dari Database PostgreSQL secara transactional (termasuk seluruh data turunan)
    await client.query('BEGIN');

    // Hapus audit_log turunan absensi
    await client.query(
      `DELETE FROM audit_log WHERE absensi_id IN (SELECT id FROM absensi WHERE user_id = $1)`,
      [id]
    );

    // Hapus absensi
    await client.query(`DELETE FROM absensi WHERE user_id = $1`, [id]);

    // Hapus keterangan_presensi
    await client.query(`DELETE FROM keterangan_presensi WHERE user_id = $1`, [id]);

    // Hapus password_reset_tokens
    await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [id]);

    // Hapus registrasi_pending yang terkait dengan email karyawan ini
    await client.query(`DELETE FROM registrasi_pending WHERE email = $1`, [user.email]);

    // Hapus database_hm terkait (by user_id or employee_id)
    if (user.employee_id) {
      await client.query(`DELETE FROM database_hm WHERE user_id = $1 OR employee_id = $2`, [id, user.employee_id]);
    } else {
      await client.query(`DELETE FROM database_hm WHERE user_id = $1`, [id]);
    }

    // Hapus database payroll terkait (by employee_id or nama_karyawan)
    if (user.employee_id) {
      await client.query(`DELETE FROM payroll WHERE employee_id = $1 OR LOWER(nama_karyawan) = LOWER($2)`, [user.employee_id, user.nama]);
    } else {
      await client.query(`DELETE FROM payroll WHERE LOWER(nama_karyawan) = LOWER($1)`, [user.nama]);
    }

    // Hapus user
    await client.query(`DELETE FROM users WHERE id = $1`, [id]);

    await client.query('COMMIT');
    client.release();

    // Log Audit Hapus Karyawan
    let adminId = req.user?.id || null;
    if (adminId) {
      const adminCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [adminId]);
      if (!adminCheck.rows.length) adminId = null;
    }

    const logText = `${req.user?.nama || 'Admin Utama'} - [DB KARYAWAN] Menghapus permanen karyawan "${user.nama}" (${user.email}), NRP: ${user.employee_id || '-'}`;
    await pool.query(
      `INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sebelum) VALUES ($1, NULL, $2, $3)`,
      [adminId, logText, JSON.stringify({ id: user.id, nama: user.nama, email: user.email, employee_id: user.employee_id })]
    ).catch(e => console.warn('Gagal simpan audit log hapus karyawan:', e.message));

    res.json({ message: `Data karyawan ${user.nama} (Email: ${user.email}) beserta seluruh data turunannya berhasil dihapus permanen` });
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    next(err);
  }
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

module.exports = { daftarKaryawan, buatKaryawan, uploadFotoReferensi, updateKaryawan, hapusKaryawan, daftarAuditLogKaryawan };
