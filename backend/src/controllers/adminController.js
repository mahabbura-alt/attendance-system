const { pool } = require('../config/db');
const { getUrlFoto } = require('../services/storage');
const bcrypt = require('bcrypt');

/** GET /api/admin/shifts — daftar shift untuk dropdown form karyawan */
async function daftarShift(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM shifts ORDER BY nama_shift');
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/absensi — semua data absensi, join nama karyawan dan shift */
async function semuaAbsensi(req, res, next) {
  try {
    // Filter opsional: tanggal_dari, tanggal_sampai
    const { tanggal_dari, tanggal_sampai } = req.query;
    let queryStr = `
      SELECT a.*, u.nama, u.email, s.nama_shift
      FROM absensi a
      JOIN users u ON u.id = a.user_id
      JOIN shifts s ON s.id = a.shift_id
      WHERE 1=1
    `;
    const params = [];

    if (tanggal_dari) {
      params.push(tanggal_dari);
      queryStr += ` AND a.tanggal_kerja >= $${params.length}`;
    }
    if (tanggal_sampai) {
      params.push(tanggal_sampai);
      queryStr += ` AND a.tanggal_kerja <= $${params.length}`;
    }
    queryStr += ' ORDER BY a.tanggal_kerja DESC LIMIT 500';

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

    await client.query('BEGIN');

    const { rows: dataLama } = await client.query('SELECT * FROM absensi WHERE id = $1 FOR UPDATE', [id]);
    if (!dataLama[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Data absensi tidak ditemukan' });
    }

    const kolomDiizinkan = [
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

/** GET /api/admin/audit-log/:absensiId */
async function auditLogAbsensi(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT al.*, u.nama AS admin_nama
       FROM audit_log al
       JOIN users u ON u.id = al.admin_id
       WHERE al.absensi_id = $1
       ORDER BY al.waktu_perubahan DESC`,
      [req.params.absensiId]
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
    const { periode = 'bulanan', tanggal_referensi, user_id } = req.query;

    const ref = tanggal_referensi ? new Date(tanggal_referensi) : new Date();

    let tanggalMulai, tanggalAkhir;

    if (periode === 'harian') {
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

    const totalHariKerja = (periode === 'harian') ? (ref.getDay() === 0 ? 0 : 1) : hitungHariKerja(tanggalMulai, tanggalAkhir);

    const params = [mulaiStr, akhirStr];
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
           WHERE kp2.user_id = u.id AND kp2.tanggal = $1 LIMIT 1
         ) AS kategori_harian
       FROM users u
       LEFT JOIN absensi a ON a.user_id = u.id AND a.tanggal_kerja BETWEEN $1 AND $2
       LEFT JOIN keterangan_presensi kp ON kp.user_id = u.id AND kp.tanggal BETWEEN $1 AND $2
       WHERE u.role = 'karyawan' AND u.is_active = TRUE
       ${whereUser}
       GROUP BY u.id, u.nama, u.jabatan, u.departemen, u.created_at
       ORDER BY u.nama`,
      params
    );

    const rekap = rows.map((r) => {
      // Total hari kerja dihitung semenjak tanggal akun dibuat (bukan awal tahun/periode jika akun dibuat belakangan)
      const tglBuat = r.tgl_buat_akun ? new Date(r.tgl_buat_akun) : tanggalMulai;
      const effTglMulai = (tglBuat > tanggalMulai) ? tglBuat : tanggalMulai;

      let hariKerjaIndiv = 0;
      if (periode === 'harian') {
        const isSun = (ref.getDay() === 0);
        hariKerjaIndiv = (isSun || effTglMulai > tanggalAkhir) ? 0 : 1;
      } else {
        hariKerjaIndiv = (effTglMulai > tanggalAkhir) ? 0 : hitungHariKerja(effTglMulai, tanggalAkhir);
      }

      const hadirAbsen = Number(r.hadir);
      const hadirManual = Number(r.hadir_manual);
      const hadir = hadirAbsen + hadirManual;

      const izin = Number(r.izin);
      const sakit = Number(r.sakit);
      const cuti = Number(r.cuti);
      const off = Number(r.off);
      const alpaManual = Number(r.alpa_manual);

      // Hari OFF mengurangi total kewajiban hari kerja karyawan
      const effHariKerja = Math.max(0, hariKerjaIndiv - off);

      const alpaOtomatis = Math.max(0, effHariKerja - hadir - izin - sakit - cuti - alpaManual);
      const alpa = alpaManual + alpaOtomatis;
      const tidakHadir = alpa + izin + sakit + cuti;

      let katHarian = r.kategori_harian;
      if (!katHarian) {
        katHarian = (hadirAbsen > 0) ? 'hadir_kamera' : 'alpa';
      }

      return {
        id: r.id,
        nama: r.nama,
        jabatan: r.jabatan || '—',
        departemen: r.departemen || '—',
        total_hari_kerja: effHariKerja,
        hadir,
        hadir_absen: hadirAbsen,
        hadir_manual: hadirManual,
        tidak_hadir: tidakHadir,
        kategori_harian: katHarian,
        telat: Number(r.telat),
        checkout_lewat: Number(r.checkout_lewat),
        percobaan_pulang_awal: Number(r.percobaan_pulang_awal || 0),
        izin,
        sakit,
        cuti,
        off,
        alpa,
        tidak_hadir: tidakHadir,
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
      // Buat akun karyawan dari data pendaftar
      const finalShiftId = shiftOverride || reg.shift_id;
      const finalLokasiId = lokasiOverride || reg.lokasi_kantor_id;
      const comprefaceSubject = reg.email;

      const { rows: newUser } = await client.query(
        `INSERT INTO users
           (nama, email, jabatan, departemen, password_hash, role, shift_id, lokasi_kantor_id, foto_referensi_url, compreface_subject)
         VALUES ($1,$2,$3,$4,$5,'karyawan',$6,$7,$8,$9)
         RETURNING id, nama, email, jabatan, departemen`,
        [
          reg.nama, reg.email, reg.jabatan, reg.departemen, reg.password_hash,
          finalShiftId || null, finalLokasiId || null,
          reg.foto_referensi_1_url || null,
          comprefaceSubject
        ]
      );
      karyawanBaru = newUser[0];
    }

    await client.query('COMMIT');

    // Daftarkan sampel foto ke CompreFace di background (TANPA memblokir response ke klien)
    if (aksi === 'disetujui') {
      const { daftarkanWajahReferensi } = require('../services/compreface');
      const { minioClient, BUCKET } = require('../config/minio');
      const fotoKeys = [reg.foto_referensi_1_url, reg.foto_referensi_2_url, reg.foto_referensi_3_url].filter(Boolean);
      const comprefaceSubject = reg.email;
      
      Promise.resolve().then(async () => {
        for (const key of fotoKeys) {
          try {
            const stream = await minioClient.getObject(BUCKET, key);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            await daftarkanWajahReferensi(buffer, comprefaceSubject);
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
    const perms = Array.isArray(permissions) ? JSON.stringify(permissions) : JSON.stringify(["absensi", "karyawan", "performa", "registrasi", "payroll", "hm", "kalkulasiPayroll"]);

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
    const perms = Array.isArray(permissions) ? JSON.stringify(permissions) : JSON.stringify(target.permissions || []);
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

module.exports = {
  semuaAbsensi, editAbsensiManual, auditLogAbsensi, daftarShift,
  rekapPerforma, simpanKeteranganPresensi, daftarAuditLogPerforma, daftarRegistrasiPending, prosesRegistrasi,
  getProfilMe, updateProfilMe, daftarSubAdmins, buatSubAdmin, updateSubAdmin, hapusSubAdmin,
};
